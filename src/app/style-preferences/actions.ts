"use server";

import { createClient } from "@/lib/supabase/server";
import { VOTE_INPUT_METHODS, type VoteInputMethod } from "@/lib/caption-votes";
import {
  isStyleChoice,
  parseStyleFeedback,
  PERSONALIZATION_CONSENT_VERSION,
  type StyleChoice,
  type StyleFeedback,
} from "@/lib/style-preferences";

export type StyleActionResult = { success: true } | { success: false; error: string };

export async function saveStylePreference(input: {
  pairId: number;
  choice: StyleChoice;
  aShownFirst: boolean;
  timeToChooseMs: number | null;
  inputMethod: VoteInputMethod;
}): Promise<StyleActionResult> {
  const { pairId, choice, aShownFirst, timeToChooseMs, inputMethod } = input;
  if (
    !Number.isSafeInteger(pairId) || pairId <= 0 || !isStyleChoice(choice) ||
    typeof aShownFirst !== "boolean" || !VOTE_INPUT_METHODS.includes(inputMethod)
  ) {
    return { success: false, error: "Invalid answer." };
  }
  const time =
    typeof timeToChooseMs === "number" && Number.isFinite(timeToChooseMs) && timeToChooseMs >= 0
      ? Math.min(Math.round(timeToChooseMs), 86_400_000)
      : null;

  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Please sign in to continue." };

  const { error } = await supabase.from("style_preference_responses").insert({
    profile_id: user.id,
    pair_id: pairId,
    choice,
    a_shown_first: aShownFirst,
    time_to_choose_ms: time,
    input_method: inputMethod,
  });
  if (error) {
    console.error("[saveStylePreference] insert failed", error);
    return { success: false, error: "We couldn't save that answer. Please try again." };
  }
  return { success: true };
}

export async function saveStyleFeedback(input: StyleFeedback): Promise<StyleActionResult> {
  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Please sign in to continue." };

  const { data: styles, error: stylesError } = await supabase.from("humor_styles").select("id");
  if (stylesError) {
    console.error("[saveStyleFeedback] load styles failed", stylesError);
    return { success: false, error: "We couldn't save your feedback. Please try again." };
  }
  const feedback = parseStyleFeedback(input, (styles ?? []).map((style) => style.id as number));
  if (!feedback) return { success: false, error: "Please check your answers and try again." };

  const { error } = await supabase.from("style_preference_feedback").upsert(
    {
      profile_id: user.id,
      liked_style_ids: feedback.likedStyleIds,
      disliked_style_ids: feedback.dislikedStyleIds,
      comment: feedback.comment || null,
      personalization_consent: feedback.personalizationConsent,
      consent_version: feedback.personalizationConsent ? PERSONALIZATION_CONSENT_VERSION : null,
    },
    { onConflict: "profile_id" }
  );
  if (error) {
    console.error("[saveStyleFeedback] upsert failed", error);
    return { success: false, error: "We couldn't save your feedback. Please try again." };
  }
  return { success: true };
}
