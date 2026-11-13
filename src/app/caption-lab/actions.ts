"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import {
  buildCaptionMessages,
  CAPTION_PROMPT_VERSION,
  captionResponseFormat,
  chooseStyles,
  DAILY_CAPTION_LIMIT,
  isValidUploadDataUrl,
  parseGeneratedCaptions,
  type LabRating,
} from "@/lib/caption-generation";
import { generateHumorSummary } from "@/lib/humor-summary";
import { createChatCompletion, moderateImage, moderateTexts, openAiConfig } from "@/lib/openai";
import { fetchStyleCheckState, tallyStyles } from "@/lib/style-preferences";
import { createClient } from "@/lib/supabase/server";
import { decodeDataUrl, newUserImagePath, USER_IMAGE_BUCKET } from "@/lib/user-images";

export type LabCaption = { id: number; styleId: number; styleName: string; text: string; rating: -1 | 1 | null; saved: boolean };
export type GenerateResult =
  | { success: true; captions: LabCaption[]; personalized: boolean; droppedCount: number }
  | { success: false; error: string };

type GenerateInput = { source: "upload"; dataUrl: string };

export async function generateLabCaptions(input: GenerateInput): Promise<GenerateResult> {
  const config = openAiConfig();
  if (!config) return { success: false, error: "AI captions aren't set up on this site yet." };

  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Please sign in to continue." };

  // The uploaded photo is sent to OpenAI and, once it passes moderation, kept
  // in the participant's private Storage folder (see storeUpload).
  if (input?.source !== "upload" || !isValidUploadDataUrl(input.dataUrl)) {
    return { success: false, error: "Please choose a JPEG, PNG or WebP image under about 650 KB after resizing." };
  }
  const imageUrl = input.dataUrl;

  // Rolling 24h limit per participant, checked before any paid API call.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("ai_generated_captions")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .gte("created_datetime_utc", since);
  if (countError) {
    console.error("[generateLabCaptions] limit check failed", countError);
    return { success: false, error: "We couldn't generate captions right now. Please try again." };
  }
  if ((count ?? 0) >= DAILY_CAPTION_LIMIT) {
    return { success: false, error: "You've reached today's limit for AI captions. Please come back tomorrow." };
  }

  const [{ state }, labRows, savedSummary] = await Promise.all([
    fetchStyleCheckState(supabase, user.id),
    supabase.from("ai_generated_captions").select("style_id, rating").eq("profile_id", user.id).not("rating", "is", null),
    supabase.from("profile_humor_summaries").select("summary").eq("profile_id", user.id).maybeSingle(),
  ]);
  if (!state || state.styles.length === 0) {
    return { success: false, error: "We couldn't load humor styles. Please refresh and try again." };
  }
  const labRatings = ((labRows.data ?? []) as { style_id: number; rating: -1 | 1 }[]).map((row) => ({
    styleId: row.style_id,
    rating: row.rating,
  })) satisfies LabRating[];
  const tally = tallyStyles(state.styles, state.pairs, state.choices);
  // Personalize only with explicit consent; only the summary text is sent, never names or emails.
  const personalized = state.feedback?.personalizationConsent === true;
  const profileSummary = personalized
    ? savedSummary.data?.summary ??
      generateHumorSummary({ tally, styles: state.styles, choices: state.choices, totalPairs: state.pairs.length, feedback: state.feedback, labRatings })
    : null;
  const requested = chooseStyles({ styles: state.styles, personalized, tally, feedback: state.feedback, labRatings });
  const slugs = requested.map((style) => style.slug);

  let captions;
  try {
    if (await moderateImage(config.apiKey, imageUrl)) {
      return { success: false, error: "We can't write captions for that image. Please try a different one." };
    }
    const content = await createChatCompletion({
      apiKey: config.apiKey,
      model: config.model,
      messages: buildCaptionMessages({ requested, profileSummary, imageUrl }),
      responseFormat: captionResponseFormat(slugs),
    });
    captions = parseGeneratedCaptions(content, slugs);
    const flagged = await moderateTexts(config.apiKey, captions.map((caption) => caption.text));
    captions = captions.filter((_, i) => !flagged[i]);
  } catch (error) {
    console.error("[generateLabCaptions] OpenAI request failed", error);
    return { success: false, error: "The caption writer is unavailable right now. Please try again in a minute." };
  }
  if (captions.length === 0) {
    return { success: false, error: "We couldn't come up with captions for that image. Please try another one." };
  }

  const userImageId = await storeUpload(supabase, user.id, imageUrl);
  const bySlug = new Map(state.styles.map((style) => [style.slug, style]));
  const batchId = randomUUID();
  const { data: inserted, error: insertError } = await supabase
    .from("ai_generated_captions")
    .insert(
      captions.map((caption) => ({
        profile_id: user.id,
        batch_id: batchId,
        image_source: "upload",
        image_url: null,
        ...(userImageId ? { user_image_id: userImageId } : {}),
        style_id: bySlug.get(caption.styleSlug)!.id,
        caption: caption.text,
        personalized,
        model: config.model,
        prompt_version: CAPTION_PROMPT_VERSION,
      }))
    )
    .select("id, style_id, caption");
  if (insertError || !inserted) {
    console.error("[generateLabCaptions] insert failed", insertError);
    return { success: false, error: "We wrote captions but couldn't save them. Please try again." };
  }

  const byId = new Map(state.styles.map((style) => [style.id, style]));
  return {
    success: true,
    personalized,
    droppedCount: requested.length - inserted.length,
    captions: inserted.map((row) => ({
      id: row.id as number,
      styleId: row.style_id as number,
      styleName: byId.get(row.style_id as number)?.name ?? "",
      text: row.caption as string,
      rating: null,
      saved: false,
    })),
  };
}

/**
 * Keeps a moderated upload: bytes go to `user-images/<profile_id>/<uuid>.<ext>`
 * (private bucket, own-folder RLS) and a `user_images` row records it. Returns
 * null on any failure so captions are still saved without the photo.
 */
async function storeUpload(supabase: Awaited<ReturnType<typeof createClient>>, profileId: string, dataUrl: string) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const path = newUserImagePath(profileId, randomUUID(), decoded.contentType);
  const { error: uploadError } = await supabase.storage
    .from(USER_IMAGE_BUCKET)
    .upload(path, decoded.bytes, { contentType: decoded.contentType, upsert: false });
  if (uploadError) {
    console.error("[generateLabCaptions] photo upload failed", uploadError);
    return null;
  }
  const { data, error } = await supabase.from("user_images").insert({ profile_id: profileId, storage_path: path }).select("id").single();
  if (error || !data) {
    console.error("[generateLabCaptions] photo record failed", error);
    await supabase.storage.from(USER_IMAGE_BUCKET).remove([path]);
    return null;
  }
  return data.id as string;
}

/** Saves a caption (with its photo) to Your history as a liked pick, or removes it. */
export async function saveLabCaption(input: { id: number; saved: boolean }) {
  const { id, saved } = input ?? {};
  if (!Number.isSafeInteger(id) || id <= 0 || typeof saved !== "boolean") {
    return { success: false as const, error: "Invalid caption." };
  }
  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "Please sign in to continue." };

  const { data, error } = await supabase
    .from("ai_generated_captions")
    // Saving a caption means the participant liked it.
    .update(saved ? { saved_datetime_utc: new Date().toISOString(), rating: 1 } : { saved_datetime_utc: null })
    .eq("id", id)
    .eq("profile_id", user.id)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("[saveLabCaption] update failed", error);
    return { success: false as const, error: "We couldn't save that caption. Please try again." };
  }
  revalidatePath("/history");
  return { success: true as const };
}

export async function rateLabCaption(input: { id: number; rating: -1 | 1 | null }) {
  const { id, rating } = input ?? {};
  if (!Number.isSafeInteger(id) || id <= 0 || !(rating === -1 || rating === 1 || rating === null)) {
    return { success: false as const, error: "Invalid rating." };
  }
  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "Please sign in to continue." };

  const { data, error } = await supabase
    .from("ai_generated_captions")
    .update({ rating })
    .eq("id", id)
    .eq("profile_id", user.id)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("[rateLabCaption] update failed", error);
    return { success: false as const, error: "We couldn't save that rating. Please try again." };
  }
  return { success: true as const };
}
