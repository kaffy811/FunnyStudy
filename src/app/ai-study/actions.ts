"use server";

import { revalidatePath } from "next/cache";

import {
  AI_STUDY_BATCH_SIZE,
  AI_STUDY_CANDIDATES,
  AI_STUDY_PROMPT_VERSION,
  AI_STUDY_SIZE,
  assignStyles,
  buildStudyCaptionMessages,
  buildSummaryMessages,
  chunk,
  DAILY_AI_STUDY_LIMIT,
  fallbackSummary,
  isCurrentStudy,
  parseStudyCaptions,
  parseSummary,
  studyCaptionResponseFormat,
  styleStats,
  summaryResponseFormat,
  type CaptionSignal,
  type StudyStyle,
} from "@/lib/ai-study";
import { resolveCaptionImageUrl } from "@/lib/caption-images";
import { createChatCompletion, moderateImage, moderateTexts, openAiConfig } from "@/lib/openai";
import { PERSONALIZATION_CONSENT_VERSION } from "@/lib/style-preferences";
import { createClient } from "@/lib/supabase/server";

type Result<T> = ({ success: true } & T) | { success: false; error: string };

async function signedIn() {
  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Returns the current study (started since the latest sign-in and not ended),
 * or creates a new one: random study images, balanced random humor styles, one
 * AI caption per image. Only the participant's own JWT is used.
 */
export async function startAiStudy(): Promise<Result<{ sessionId: string }>> {
  const config = openAiConfig();
  if (!config) return { success: false, error: "AI studies aren't set up on this site yet." };
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };

  const { data: latest, error: latestError } = await supabase
    .from("ai_study_sessions")
    .select("id, created_datetime_utc, ended_datetime_utc")
    .eq("profile_id", user.id)
    .order("created_datetime_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    console.error("[startAiStudy] load latest failed", latestError);
    return { success: false, error: "We couldn't start a study right now. Please try again." };
  }
  if (latest && isCurrentStudy(latest, user.last_sign_in_at)) return { success: true, sessionId: latest.id };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count }, styleRows, recent, consentRow, summaryRow] = await Promise.all([
    supabase
      .from("ai_study_sessions")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .gte("created_datetime_utc", since),
    supabase.from("humor_styles").select("id, slug, name, description").order("id"),
    supabase
      .from("ai_generated_captions")
      .select("image_id")
      .eq("profile_id", user.id)
      .eq("image_source", "study")
      .order("created_datetime_utc", { ascending: false })
      .limit(60),
    supabase.from("style_preference_feedback").select("personalization_consent").eq("profile_id", user.id).maybeSingle(),
    supabase.from("profile_humor_summaries").select("summary").eq("profile_id", user.id).maybeSingle(),
  ]);
  if ((count ?? 0) >= DAILY_AI_STUDY_LIMIT) {
    return { success: false, error: "You've reached today's limit for new studies. Please come back tomorrow." };
  }
  const styles = (styleRows.data ?? []) as StudyStyle[];
  if (styles.length === 0) return { success: false, error: "We couldn't load humor styles. Please refresh and try again." };

  const exclude = [...new Set((recent.data ?? []).map((row) => row.image_id).filter(Boolean))];
  const { data: candidates, error: pickError } = await supabase.rpc("pick_ai_study_images", {
    p_count: AI_STUDY_CANDIDATES,
    p_exclude: exclude,
  });
  if (pickError) {
    console.error("[startAiStudy] pick images failed", pickError);
    return { success: false, error: "We couldn't load images right now. Please try again." };
  }
  const pool = ((candidates ?? []) as { id: string; url: string }[])
    .map((row) => ({ id: row.id, url: resolveCaptionImageUrl(row.url) }))
    .filter((row): row is { id: string; url: string } => Boolean(row.url));

  const personalized = consentRow.data?.personalization_consent === true;
  const profileSummary = personalized ? summaryRow.data?.summary ?? null : null;

  let items: { imageId: string; imageUrl: string; style: StudyStyle; caption: string }[];
  try {
    // Moderate every candidate image, keep the first safe ones.
    const flags = await Promise.all(pool.map((image) => moderateImage(config.apiKey, image.url).catch(() => true)));
    const safe = pool.filter((_, i) => !flags[i]).slice(0, AI_STUDY_SIZE);
    if (safe.length === 0) return { success: false, error: "We couldn't find images for a study right now. Please try again." };

    const styled = assignStyles(styles, safe.length).map((style, i) => ({ slot: i + 1, imageUrl: safe[i].url, imageId: safe[i].id, style }));
    const batches = await Promise.all(
      chunk(styled, AI_STUDY_BATCH_SIZE).map(async (batch) => {
        const slots = batch.map((item) => item.slot);
        const content = await createChatCompletion({
          apiKey: config.apiKey,
          model: config.model,
          messages: buildStudyCaptionMessages({ items: batch, profileSummary }),
          responseFormat: studyCaptionResponseFormat(slots),
        });
        return parseStudyCaptions(content, slots);
      })
    );
    const texts = new Map(batches.flatMap((map) => [...map.entries()]));
    const written = styled.filter((item) => texts.has(item.slot)).map((item) => ({ ...item, caption: texts.get(item.slot)! }));
    const flagged = await moderateTexts(config.apiKey, written.map((item) => item.caption));
    items = written.filter((_, i) => !flagged[i]);
  } catch (error) {
    console.error("[startAiStudy] OpenAI request failed", error);
    return { success: false, error: "The caption writer is unavailable right now. Please try again in a minute." };
  }
  if (items.length === 0) return { success: false, error: "We couldn't write captions right now. Please try again." };

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
    items.map((item, i) => ({
      profile_id: user.id,
      batch_id: batchId,
      image_source: "study",
      image_url: item.imageUrl,
      image_id: item.imageId,
      session_id: session.id,
      position: i + 1,
      style_id: item.style.id,
      caption: item.caption,
      personalized,
      model: config.model,
      prompt_version: AI_STUDY_PROMPT_VERSION,
    }))
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

export async function markAiStudyViewed(captionId: number): Promise<Result<object>> {
  if (!Number.isSafeInteger(captionId) || captionId <= 0) return { success: false, error: "Invalid caption." };
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };
  const { error } = await supabase
    .from("ai_generated_captions")
    .update({ viewed_datetime_utc: new Date().toISOString() })
    .eq("id", captionId)
    .eq("profile_id", user.id)
    .is("viewed_datetime_utc", null);
  if (error) {
    console.error("[markAiStudyViewed] update failed", error);
    return { success: false, error: "We couldn't save your progress." };
  }
  return { success: true };
}

export async function rateAiStudyCaption(input: { id: number; funny: boolean }): Promise<Result<object>> {
  const { id, funny } = input ?? {};
  if (!Number.isSafeInteger(id) || id <= 0 || typeof funny !== "boolean") return { success: false, error: "Invalid rating." };
  const { supabase, user } = await signedIn();
  if (!user) return { success: false, error: "Please sign in to continue." };
  const { data, error } = await supabase
    .from("ai_generated_captions")
    .update({ rating: funny ? 1 : null })
    .eq("id", id)
    .eq("profile_id", user.id)
    .eq("image_source", "study")
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("[rateAiStudyCaption] update failed", error);
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
      item_count: own.length,
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
