"use server";

import { revalidatePath } from "next/cache";

import { parseHumorSummary } from "@/lib/humor-summary";
import { createClient } from "@/lib/supabase/server";

export type SummaryActionResult = { success: true } | { success: false; error: string };

export async function saveHumorSummary(summary: string): Promise<SummaryActionResult> {
  const text = parseHumorSummary(summary);
  if (!text) return { success: false, error: "Your summary must be between 1 and 1,000 characters." };

  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Please sign in to continue." };

  const { error } = await supabase
    .from("profile_humor_summaries")
    .upsert({ profile_id: user.id, summary: text }, { onConflict: "profile_id" });
  if (error) {
    console.error("[saveHumorSummary] upsert failed", error);
    return { success: false, error: "We couldn't save your summary. Please try again." };
  }
  revalidatePath("/history");
  return { success: true };
}

export async function resetHumorSummary(): Promise<SummaryActionResult> {
  const supabase = await createClient({ allowCookieWrite: true });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Please sign in to continue." };

  const { error } = await supabase.from("profile_humor_summaries").delete().eq("profile_id", user.id);
  if (error) {
    console.error("[resetHumorSummary] delete failed", error);
    return { success: false, error: "We couldn't reset your summary. Please try again." };
  }
  revalidatePath("/history");
  return { success: true };
}
