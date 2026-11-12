import type { SupabaseClient } from "@supabase/supabase-js";

export const STYLE_CHOICES = ["a", "b", "neither", "no_preference"] as const;
export type StyleChoice = (typeof STYLE_CHOICES)[number];

export const PERSONALIZATION_CONSENT_VERSION = "2026-11-v1";
export const FEEDBACK_COMMENT_MAX = 500;

export type HumorStyle = { id: number; slug: string; name: string; description: string };

export type StylePair = {
  id: number;
  imageUrl: string;
  styleAId: number;
  captionA: string;
  styleBId: number;
  captionB: string;
};

export type StyleFeedback = {
  likedStyleIds: number[];
  dislikedStyleIds: number[];
  comment: string;
  personalizationConsent: boolean;
};

export type StyleCheckState = {
  styles: HumorStyle[];
  pairs: StylePair[];
  choices: Record<number, StyleChoice>;
  feedback: StyleFeedback | null;
};

export type StyleTally = { style: HumorStyle; shown: number; chosen: number };

export function isStyleChoice(value: unknown): value is StyleChoice {
  return typeof value === "string" && (STYLE_CHOICES as readonly string[]).includes(value);
}

/** Latest answer per pair; rows must be ordered newest first. */
export function latestChoices(rows: { pair_id: number; choice: string }[]): Record<number, StyleChoice> {
  const choices: Record<number, StyleChoice> = {};
  for (const row of rows) {
    if (!(row.pair_id in choices) && isStyleChoice(row.choice)) choices[row.pair_id] = row.choice;
  }
  return choices;
}

/**
 * Counts, per style, how often it appeared in an answered pair and how often it
 * was the picked caption. "Neither" and "No preference" count as shown, not chosen.
 */
export function tallyStyles(styles: HumorStyle[], pairs: StylePair[], choices: Record<number, StyleChoice>): StyleTally[] {
  const tally = new Map(styles.map((style) => [style.id, { style, shown: 0, chosen: 0 }]));
  for (const pair of pairs) {
    const choice = choices[pair.id];
    if (!choice) continue;
    const a = tally.get(pair.styleAId);
    const b = tally.get(pair.styleBId);
    if (a) a.shown += 1;
    if (b) b.shown += 1;
    if (choice === "a" && a) a.chosen += 1;
    if (choice === "b" && b) b.chosen += 1;
  }
  return [...tally.values()]
    .filter((entry) => entry.shown > 0)
    .sort((x, y) => y.chosen / y.shown - x.chosen / x.shown || y.chosen - x.chosen || x.style.id - y.style.id);
}

/** Validates feedback input; style ids must be known and liked/disliked must not overlap. */
export function parseStyleFeedback(input: unknown, knownStyleIds: readonly number[]): StyleFeedback | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const ids = (raw: unknown) =>
    Array.isArray(raw) && raw.every((id) => Number.isSafeInteger(id) && knownStyleIds.includes(id as number))
      ? [...new Set(raw as number[])].sort((a, b) => a - b)
      : null;
  const liked = ids(value.likedStyleIds);
  const disliked = ids(value.dislikedStyleIds);
  const comment = typeof value.comment === "string" ? value.comment.trim() : null;
  if (!liked || !disliked || comment === null || typeof value.personalizationConsent !== "boolean") return null;
  if (liked.some((id) => disliked.includes(id)) || comment.length > FEEDBACK_COMMENT_MAX) return null;
  return { likedStyleIds: liked, dislikedStyleIds: disliked, comment, personalizationConsent: value.personalizationConsent };
}

export async function fetchStyleCheckState(
  supabase: SupabaseClient,
  profileId: string
): Promise<{ state: StyleCheckState | null; error: unknown }> {
  const [styles, pairs, responses, feedback] = await Promise.all([
    supabase.from("humor_styles").select("id, slug, name, description").order("id"),
    supabase
      .from("style_comparison_pairs")
      .select("id, image_url, style_a_id, caption_a, style_b_id, caption_b")
      .eq("is_active", true)
      .order("id"),
    supabase
      .from("style_preference_responses")
      .select("pair_id, choice")
      .eq("profile_id", profileId)
      .order("created_datetime_utc", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("style_preference_feedback")
      .select("liked_style_ids, disliked_style_ids, comment, personalization_consent")
      .eq("profile_id", profileId)
      .maybeSingle(),
  ]);
  const error = styles.error ?? pairs.error ?? responses.error ?? feedback.error;
  if (error) return { state: null, error };

  return {
    error: null,
    state: {
      styles: (styles.data ?? []) as HumorStyle[],
      pairs: (pairs.data ?? []).map((row) => ({
        id: row.id,
        imageUrl: row.image_url,
        styleAId: row.style_a_id,
        captionA: row.caption_a,
        styleBId: row.style_b_id,
        captionB: row.caption_b,
      })),
      choices: latestChoices(responses.data ?? []),
      feedback: feedback.data
        ? {
            likedStyleIds: feedback.data.liked_style_ids ?? [],
            dislikedStyleIds: feedback.data.disliked_style_ids ?? [],
            comment: feedback.data.comment ?? "",
            personalizationConsent: feedback.data.personalization_consent === true,
          }
        : null,
    },
  };
}
