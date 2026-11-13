import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/profile-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { AiStudyFlow, type AiStudyPair } from "@/components/AiStudyFlow";
import { choiceFromRatings, isCurrentStudy } from "@/lib/ai-study";
import { openAiConfig } from "@/lib/openai";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Starting a study moderates images and writes captions with OpenAI.
export const maxDuration = 60;

type CaptionRow = { id: number; position: number; caption: string; image_url: string; rating: number | null; viewed_datetime_utc: string | null };

export default async function AiStudyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: latest }, { data: consent }] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    supabase
      .from("ai_study_sessions")
      .select("id, created_datetime_utc, ended_datetime_utc")
      .eq("profile_id", user.id)
      .order("created_datetime_utc", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("style_preference_feedback").select("personalization_consent").eq("profile_id", user.id).maybeSingle(),
  ]);
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || user.email || "your account";

  const sessionId = latest && isCurrentStudy(latest, user.last_sign_in_at) ? (latest.id as string) : null;
  const items: AiStudyPair[] = [];
  if (sessionId) {
    const { data, error } = await supabase
      .from("ai_generated_captions")
      .select("id, position, caption, image_url, rating, viewed_datetime_utc")
      .eq("session_id", sessionId)
      .order("position");
    if (error) console.error("[AiStudyPage] load captions failed", error);
    const byPosition = new Map(((data ?? []) as CaptionRow[]).map((row) => [row.position, row]));
    for (let item = 1; byPosition.has(item * 2 - 1) && byPosition.has(item * 2); item += 1) {
      const a = byPosition.get(item * 2 - 1)!;
      const b = byPosition.get(item * 2)!;
      items.push({
        item,
        imageUrl: a.image_url,
        a: { id: a.id, caption: a.caption },
        b: { id: b.id, caption: b.caption },
        choice: choiceFromRatings(a.rating, b.rating),
        viewed: a.viewed_datetime_utc !== null,
      });
    }
  }

  return (
    <div className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 py-3 text-[var(--foreground)] sm:px-6 sm:py-4">
      <nav aria-label="Study navigation" className="flex shrink-0">
        <Link
          href="/"
          aria-label="Back to home"
          title="Back to home"
          className="flex h-14 w-14 items-center justify-center rounded-full transition hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
        >
          <ArrowLeftIcon aria-hidden className="h-9 w-9" />
        </Link>
      </nav>
      <main className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-1">
        <AiStudyFlow
          key={sessionId ?? "new"}
          sessionId={sessionId}
          items={items}
          configured={openAiConfig() !== null}
          personalized={consent?.personalization_consent === true}
        />
      </main>
      <AccountMenu displayName={displayName} email={user.email} signOutAction={signOut} />
    </div>
  );
}
