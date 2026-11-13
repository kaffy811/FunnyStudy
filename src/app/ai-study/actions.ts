"use server";

import { revalidatePath } from "next/cache";

import {
  AI_STUDY_BATCH_SIZE,
  AI_STUDY_CANDIDATES,
  AI_STUDY_PROMPT_VERSION,
  AI_STUDY_SIZE,
  assignStylePairs,
  choiceRatings,
  buildStudyCaptionMessages,
  buildSummaryMessages,
  chunk,
  AB_CHOICES,
  DAILY_AI_STUDY_LIMIT,
  fallbackSummary,
  parseStudyCaptions,
  parseSummary,
  studyCaptionResponseFormat,
  styleStats,
  summaryResponseFormat,
  pairPositions,
  shuffle,
  type AbChoice,
  type CaptionSignal,
  type StudyStyle,
} from "@/lib/ai-study";
import { resolveCaptionImageUrl } from "@/lib/caption-images";
import { signStoragePaths, toUserImageRef } from "@/lib/user-images";
import { createChatCompletion, moderateImage, moderateTexts, openAiConfig } from "@/lib/openai";
import { PERSONALIZATION_CONSENT_VERSION } from "@/lib/style-preferences";
import { createClient } from "@/lib/supabase/server";

type Result<T> = ({ success: true } & T) | { success: false; error: string };

async function signedIn() {
  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Up to this many of the participant's own caption-lab photos join each study. */
const OWN_IMAGES_PER_STUDY = 2;

/**
 * Creates a new study: random study images (plus a couple of the participant's
 * own caption-lab photos, when they have some), A/B humor-style pairs, and two
 * AI captions per image. Only the participant's own JWT is used.
 */
export async function startAiStudy(): Promise<Result<{ sessionId: string }>> {
  const config = openAiConfig();
  if (!config) return { success: false, error: "AI studies aren't set up on this site yet." };
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count }, styleRows, recent, consentRow, summaryRow, ownRows] = await Promise.all([
    supabase
      .from("ai_study_sessions")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .gte("created_datetime_utc", since),
    supabase.from("humor_styles").select("id, slug, name, description").order("id"),
    supabase
      .from("ai_generated_captions")
      .select("*")
      .eq("profile_id", user.id)
      .eq("image_source", "study")
      .order("created_datetime_utc", { ascending: false })
      .limit(60),
    supabase.from("style_preference_feedback").select("personalization_consent").eq("profile_id", user.id).maybeSingle(),
    supabase.from("profile_humor_summaries").select("summary").eq("profile_id", user.id).maybeSingle(),
    supabase
      .from("user_images")
      .select("id, storage_path")
      .eq("profile_id", user.id)
      .order("created_datetime_utc", { ascending: false })
      .limit(50),
  ]);
  if ((count ?? 0) >= DAILY_AI_STUDY_LIMIT) {
    return { success: false, error: "You've reached today's limit for new studies. Please come back tomorrow." };
  }
  const styles = (styleRows.data ?? []) as StudyStyle[];
  if (styles.length === 0) return { success: false, error: "We couldn't load humor styles. Please refresh and try again." };

  const recentRows = (recent.data ?? []) as { image_id: string | null; user_image_id?: string | null }[];
  const exclude = [...new Set(recentRows.map((row) => row.image_id).filter(Boolean))];
  const { data: candidates, error: pickError } = await supabase.rpc("pick_ai_study_images", {
    p_count: AI_STUDY_CANDIDATES,
    p_exclude: exclude,
  });
  if (pickError) {
    console.error("[startAiStudy] pick images failed", pickError);
    return { success: false, error: "We couldn't load images right now. Please try again." };
  }
  type Candidate = { imageId: string | null; userImageId: string | null; imageUrl: string; storedUrl: string };
  const pool: Candidate[] = ((candidates ?? []) as { id: string; url: string }[])
    .map((row) => ({ id: row.id, url: resolveCaptionImageUrl(row.url) }))
    .filter((row): row is { id: string; url: string } => Boolean(row.url))
    .map((row) => ({ imageId: row.id, userImageId: null, imageUrl: row.url, storedUrl: row.url }));

  // The participant's own photos (already moderated when uploaded); recently
  // studied ones are used only when there is nothing fresher.
  if (ownRows.error) console.error("[startAiStudy] load own images failed", ownRows.error);
  const recentOwn = new Set(recentRows.map((row) => row.user_image_id).filter(Boolean));
  const ownList = shuffle((ownRows.data ?? []) as { id: string; storage_path: string }[]);
  const ownPicked = [...ownList.filter((row) => !recentOwn.has(row.id)), ...ownList.filter((row) => recentOwn.has(row.id))].slice(
    0,
    OWN_IMAGES_PER_STUDY
  );
  const ownSigned = await signStoragePaths(supabase, ownPicked.map((row) => row.storage_path));
  const own: Candidate[] = ownPicked.flatMap((row) => {
    const signedUrl = ownSigned.get(row.storage_path);
    return signedUrl ? [{ imageId: null, userImageId: row.id, imageUrl: signedUrl, storedUrl: toUserImageRef(row.storage_path) }] : [];
  });

  const personalized = consentRow.data?.personalization_consent === true;
  const profileSummary = personalized ? summaryRow.data?.summary ?? null : null;

  type Pair = { image: Candidate; captions: [{ style: StudyStyle; text: string }, { style: StudyStyle; text: string }] };
  let pairs: Pair[];
  try {
    // Moderate every candidate image, keep the first safe ones.
    const flags = await Promise.all(pool.map((image) => moderateImage(config.apiKey, image.imageUrl).catch(() => true)));
    const safe = shuffle([...own, ...pool.filter((_, i) => !flags[i]).slice(0, AI_STUDY_SIZE - own.length)]);
    if (safe.length === 0) return { success: false, error: "We couldn't find images for a study right now. Please try again." };

    const planned = assignStylePairs(styles, safe.length).map((stylePair, i) => ({
      slot: i + 1,
      image: safe[i],
      imageUrl: safe[i].imageUrl,
      styles: stylePair,
    }));
    // Parallel requests; one failed image is skipped instead of failing the study.
    const batches = await Promise.all(
      chunk(planned, AI_STUDY_BATCH_SIZE).map(async (batch) => {
        const content = await createChatCompletion({
          apiKey: config.apiKey,
          model: config.model,
          messages: buildStudyCaptionMessages({ items: batch, profileSummary }),
          responseFormat: studyCaptionResponseFormat(
            batch.map((item) => item.slot),
            styles.map((style) => style.slug)
          ),
          maxTokens: 300 * batch.length,
        }).catch((error) => {
          console.error("[startAiStudy] caption request failed", error);
          return null;
        });
        return parseStudyCaptions(content, new Map(batch.map((item) => [item.slot, item.styles.map((style) => style.slug)])));
      })
    );
    const texts = new Map(batches.flatMap((map) => [...map.entries()]));
    // Keep only images where both captions came back.
    const written: Pair[] = planned.flatMap((item) => {
      const forSlot = texts.get(item.slot);
      const a = forSlot?.get(item.styles[0].slug);
      const b = forSlot?.get(item.styles[1].slug);
      return a && b
        ? [{ image: item.image, captions: [{ style: item.styles[0], text: a }, { style: item.styles[1], text: b }] as Pair["captions"] }]
        : [];
    });
    const flagged = await moderateTexts(config.apiKey, written.flatMap((pair) => pair.captions.map((caption) => caption.text)));
    pairs = written.filter((_, i) => !flagged[i * 2] && !flagged[i * 2 + 1]);
  } catch (error) {
    console.error("[startAiStudy] OpenAI request failed", error);
    return { success: false, error: "The caption writer is unavailable right now. Please try again in a minute." };
  }
  if (pairs.length === 0) return { success: false, error: "We couldn't write captions right now. Please try again." };

  const { data: session, error: sessionError } = await supabase
    .from("ai_study_sessions")
    .insert({ profile_id: user.id, model: config.model, prompt_version: AI_STUDY_PROMPT_VERSION })
    .select("id")
    .single();
  if (sessionError || !session) {
    console.error("[startAiStudy] create session failed", sessionError);
    return { success: false, error: "We couldn't start a study right now. Please try again." };
  }
  const batchId = crypto.randomUUID();
  const { error: insertError } = await supabase.from("ai_generated_captions").insert(
    pairs.flatMap((pair, i) =>
      pair.captions.map((caption, side) => ({
        profile_id: user.id,
        batch_id: batchId,
        image_source: "study",
        image_url: pair.image.storedUrl,
        image_id: pair.image.imageId,
        ...(pair.image.userImageId ? { user_image_id: pair.image.userImageId } : {}),
        session_id: session.id,
        position: pairPositions(i + 1)[side],
        style_id: caption.style.id,
        caption: caption.text,
        personalized,
        model: config.model,
        prompt_version: AI_STUDY_PROMPT_VERSION,
      }))
    )
  );
  if (insertError) {
    console.error("[startAiStudy] insert captions failed", insertError);
    await supabase
      .from("ai_study_sessions")
      .update({ ended_datetime_utc: new Date().toISOString(), item_count: 0, liked_count: 0 })
      .eq("id", session.id);
    return { success: false, error: "We wrote captions but couldn't save them. Please try again." };
  }
  return { success: true, sessionId: session.id };
}

/** Marks both captions of a pair as seen (first view only). */
export async function markAiStudyViewed(captionIds: number[]): Promise<Result<object>> {
  if (!Array.isArray(captionIds) || captionIds.length === 0 || captionIds.length > 2 || !captionIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return { success: false, error: "Invalid caption." };
  }
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };
  const { error } = await supabase
    .from("ai_generated_captions")
    .update({ viewed_datetime_utc: new Date().toISOString() })
    .in("id", captionIds)
    .eq("profile_id", user.id)
    .is("viewed_datetime_utc", null);
  if (error) {
    console.error("[markAiStudyViewed] update failed", error);
    return { success: false, error: "We couldn't save your progress." };
  }
  return { success: true };
}

/**
 * Saves an A/B choice for one image: the picked caption gets rating 1 and the
 * other -1; "neither" sets both to -1; null clears the choice.
 */
export async function chooseAiStudyCaption(input: { sessionId: string; item: number; choice: AbChoice | null }): Promise<Result<object>> {
  const { sessionId, item, choice } = input ?? {};
  if (
    typeof sessionId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(sessionId) ||
    !Number.isSafeInteger(item) ||
    item < 1 ||
    item > 25 ||
    !(choice === null || (AB_CHOICES as readonly string[]).includes(choice))
  ) {
    return { success: false, error: "Invalid choice." };
  }
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };
  const positions = pairPositions(item);
  const ratings = choiceRatings(choice);
  const results = await Promise.all(
    positions.map((position, side) =>
      supabase
        .from("ai_generated_captions")
        .update({ rating: ratings[side] })
        .eq("session_id", sessionId)
        .eq("position", position)
        .eq("profile_id", user.id)
        .select("id")
    )
  );
  const failed = results.find((result) => result.error || !result.data?.length);
  if (failed) {
    if (failed.error) console.error("[chooseAiStudyCaption] update failed", failed.error);
    return { success: false, error: "We couldn't save that. Please try again." };
  }
  return { success: true };
}

/**
 * Ends a study: counts, then an AI-written preference summary from all study
 * and caption-lab signals, saved to the profile and the study. Falls back to a
 * rule-based summary if the AI is unavailable, so ending never fails on it.
 */
export async function endAiStudy(sessionId: string): Promise<Result<{ summary: string }>> {
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) return { success: false, error: "Invalid study." };
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };

  const [sessionRow, signalRows, styleRows, summaryRow, studyCount] = await Promise.all([
    supabase.from("ai_study_sessions").select("id, ended_datetime_utc, ai_summary").eq("id", sessionId).eq("profile_id", user.id).maybeSingle(),
    supabase
      .from("ai_generated_captions")
      .select("session_id, style_id, caption, rating, viewed_datetime_utc, image_source")
      .eq("profile_id", user.id)
      .order("created_datetime_utc", { ascending: false })
      .limit(1000),
    supabase.from("humor_styles").select("id, slug, name, description").order("id"),
    supabase.from("profile_humor_summaries").select("summary, source").eq("profile_id", user.id).maybeSingle(),
    supabase.from("ai_study_sessions").select("id", { count: "exact", head: true }).eq("profile_id", user.id),
  ]);
  if (!sessionRow.data) return { success: false, error: "We couldn't find that study." };
  if (sessionRow.data.ended_datetime_utc) return { success: true, summary: sessionRow.data.ai_summary ?? "" };
  if (signalRows.error || styleRows.error) {
    console.error("[endAiStudy] load failed", signalRows.error ?? styleRows.error);
    return { success: false, error: "We couldn't finish the study. Please try again." };
  }

  type Row = { session_id: string | null; style_id: number; caption: string; rating: -1 | 1 | null; viewed_datetime_utc: string | null; image_source: string };
  const rows = (signalRows.data ?? []) as Row[];
  const own = rows.filter((row) => row.session_id === sessionId);
  const likedCaptions = own.filter((row) => row.rating === 1).map((row) => row.caption);
  const signals: CaptionSignal[] = rows.map((row) => ({
    styleId: row.style_id,
    // Lab captions only count once rated; study captions once viewed.
    viewed: row.image_source === "study" && row.viewed_datetime_utc !== null,
    rating: row.rating,
  }));
  const stats = styleStats((styleRows.data ?? []) as StudyStyle[], signals);

  let summary: string | null = null;
  const config = openAiConfig();
  if (config && stats.length > 0) {
    try {
      const content = await createChatCompletion({
        apiKey: config.apiKey,
        model: config.model,
        messages: buildSummaryMessages({
          stats,
          likedCaptions,
          previousSummary: summaryRow.data?.summary ?? null,
          previousByParticipant: summaryRow.data?.source === "user",
          studyCount: studyCount.count ?? 1,
        }),
        responseFormat: summaryResponseFormat,
      });
      summary = parseSummary(content);
      if (summary && (await moderateTexts(config.apiKey, [summary]))[0]) summary = null;
    } catch (error) {
      console.error("[endAiStudy] summary request failed", error);
    }
  }
  const finalSummary = summary ?? fallbackSummary(stats);

  const { error: updateError } = await supabase
    .from("ai_study_sessions")
    .update({
      ended_datetime_utc: new Date().toISOString(),
      item_count: Math.ceil(own.length / 2),
      liked_count: likedCaptions.length,
      ai_summary: finalSummary,
    })
    .eq("id", sessionId)
    .eq("profile_id", user.id);
  if (updateError) {
    console.error("[endAiStudy] update session failed", updateError);
    return { success: false, error: "We couldn't finish the study. Please try again." };
  }
  const { error: summaryError } = await supabase
    .from("profile_humor_summaries")
    .upsert({ profile_id: user.id, summary: finalSummary, source: "ai" }, { onConflict: "profile_id" });
  if (summaryError) console.error("[endAiStudy] save profile summary failed", summaryError);

  // No revalidatePath here: it would re-render /ai-study (now without a
  // current study) and remount the flow before the summary is shown. The
  // home and history pages are dynamic, so they read fresh data anyway.
  return { success: true, summary: finalSummary };
}

/** Turns personalized caption writing on or off (stored with the old style-check consent). */
export async function setPersonalizationConsent(consent: boolean): Promise<Result<object>> {
  if (typeof consent !== "boolean") return { success: false, error: "Invalid choice." };
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };
  const { error } = await supabase.from("style_preference_feedback").upsert(
    { profile_id: user.id, personalization_consent: consent, consent_version: consent ? PERSONALIZATION_CONSENT_VERSION : null },
    { onConflict: "profile_id" }
  );
  if (error) {
    console.error("[setPersonalizationConsent] upsert failed", error);
    return { success: false, error: "We couldn't save that choice. Please try again." };
  }
  revalidatePath("/history");
  return { success: true };
}
