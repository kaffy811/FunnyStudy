"use server";

import { randomUUID } from "node:crypto";

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

export type LabCaption = { id: number; styleId: number; styleName: string; text: string; rating: -1 | 1 | null };
export type GenerateResult =
  | { success: true; captions: LabCaption[]; personalized: boolean; droppedCount: number }
  | { success: false; error: string };

type GenerateInput = { source: "upload"; dataUrl: string } | { source: "style_pair"; pairId: number };

export async function generateLabCaptions(input: GenerateInput): Promise<GenerateResult> {
  const config = openAiConfig();
  if (!config) return { success: false, error: "AI captions aren't set up on this site yet." };

  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Please sign in to continue." };

  // Image: an uploaded photo (sent to OpenAI, never stored) or a sample image.
  let imageUrl: string;
  let storedImageUrl: string | null = null;
  if (input?.source === "upload") {
    if (!isValidUploadDataUrl(input.dataUrl)) {
      return { success: false, error: "Please choose a JPEG, PNG or WebP image under about 650 KB after resizing." };
    }
    imageUrl = input.dataUrl;
  } else if (input?.source === "style_pair" && Number.isSafeInteger(input.pairId) && input.pairId > 0) {
    const { data: pair } = await supabase
      .from("style_comparison_pairs")
      .select("image_url")
      .eq("id", input.pairId)
      .maybeSingle();
    if (!pair?.image_url) return { success: false, error: "That sample image isn't available." };
    imageUrl = pair.image_url;
    storedImageUrl = pair.image_url;
  } else {
    return { success: false, error: "Please choose an image first." };
  }

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
    if (input.source === "upload" && (await moderateImage(config.apiKey, imageUrl))) {
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

  const bySlug = new Map(state.styles.map((style) => [style.slug, style]));
  const batchId = randomUUID();
  const { data: inserted, error: insertError } = await supabase
    .from("ai_generated_captions")
    .insert(
      captions.map((caption) => ({
        profile_id: user.id,
        batch_id: batchId,
        image_source: input.source,
        image_url: storedImageUrl,
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
    })),
  };
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
