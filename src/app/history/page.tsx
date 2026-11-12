import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/profile-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { HumorSummaryEditor } from "@/components/HumorSummaryEditor";
import { LocalDateTime } from "@/components/LocalDateTime";
import { generateHumorSummary } from "@/lib/humor-summary";
import { fetchStyleCheckState, tallyStyles, type StyleChoice } from "@/lib/style-preferences";
import { parseStudyStats } from "@/lib/study-stats";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Participation = { study_id: number; started_at: string; ended_at: string | null; completion_stats: unknown };
type AnswerRow = { pair_id: number; choice: StyleChoice; created_datetime_utc: string };

const sectionClass = "glass-panel rounded-[24px] p-5 sm:p-6";

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, styleCheck, participations, answers, savedSummary] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    fetchStyleCheckState(supabase, user.id),
    supabase
      .from("study_participations")
      .select("study_id, started_at, ended_at, completion_stats")
      .eq("profile_id", user.id)
      .order("started_at", { ascending: false }),
    supabase
      .from("style_preference_responses")
      .select("pair_id, choice, created_datetime_utc")
      .eq("profile_id", user.id)
      .order("created_datetime_utc", { ascending: false })
      .order("id", { ascending: false }),
    supabase.from("profile_humor_summaries").select("summary").eq("profile_id", user.id).maybeSingle(),
  ]);
  for (const [label, error] of [
    ["style check", styleCheck.error],
    ["participations", participations.error],
    ["answers", answers.error],
    ["summary", savedSummary.error],
  ] as const) {
    if (error) console.error(`[HistoryPage] load ${label} failed`, error);
  }

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || user.email || "your account";
  const state = styleCheck.state;
  const tally = state ? tallyStyles(state.styles, state.pairs, state.choices) : [];
  const generated = state
    ? generateHumorSummary({
        tally,
        styles: state.styles,
        choices: state.choices,
        totalPairs: state.pairs.length,
        feedback: state.feedback,
      })
    : null;

  // Latest answer per pair, newest first.
  const seen = new Set<number>();
  const latestAnswers = ((answers.data ?? []) as AnswerRow[]).filter((row) => {
    if (seen.has(row.pair_id)) return false;
    seen.add(row.pair_id);
    return true;
  });
  const pairsById = new Map((state?.pairs ?? []).map((pair) => [pair.id, pair]));
  const studies = (participations.data ?? []) as Participation[];

  return (
    <div className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 py-3 text-[var(--foreground)] sm:px-6 sm:py-4">
      <nav aria-label="History navigation" className="flex shrink-0">
        <Link
          href="/"
          aria-label="Back to studies"
          title="Back to studies"
          className="flex h-14 w-14 items-center justify-center rounded-full transition hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
        >
          <ArrowLeftIcon aria-hidden className="h-9 w-9" />
        </Link>
      </nav>
      <main
        data-native-scroll-region="true"
        className="relative mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-5 overflow-y-auto overscroll-contain p-1 pb-24"
      >
        <header className="space-y-2">
          <h1 className="text-3xl font-bold sm:text-4xl">Your history</h1>
          <p className="text-sm text-[var(--muted)] sm:text-base">Your studies, your humor style answers, and what we think you find funny.</p>
        </header>

        <section aria-labelledby="summary-heading" className={sectionClass}>
          <h2 id="summary-heading" className="text-xl font-bold">Your humor profile</h2>
          <div className="mt-4">
            {generated ? (
              <HumorSummaryEditor generated={generated} saved={savedSummary.error ? null : savedSummary.data?.summary ?? null} />
            ) : (
              <p className="text-sm text-[var(--error-text)]">We couldn&apos;t load your humor profile. Please refresh and try again.</p>
            )}
          </div>
          {tally.length > 0 ? (
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {tally.map(({ style, shown, chosen }) => (
                <li key={style.id} className="rounded-xl border border-[var(--panel-border)] p-3">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold">{style.name}</span>
                    <span className="text-[var(--muted)]">picked {chosen} of {shown}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[var(--panel-border)]" aria-hidden>
                    <div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${(chosen / shown) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            {state?.feedback?.personalizationConsent
              ? "You agreed that this summary may be used to generate captions in your preferred styles."
              : "This summary is only shown to you. You haven't agreed to use it for personalized captions."}{" "}
            <Link href="/style-preferences" className="font-semibold underline">Change in the style check</Link>
          </p>
        </section>

        <section aria-labelledby="studies-heading" className={sectionClass}>
          <h2 id="studies-heading" className="text-xl font-bold">Studies</h2>
          {participations.error ? (
            <p className="mt-3 text-sm text-[var(--error-text)]">We couldn&apos;t load your studies.</p>
          ) : studies.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">You haven&apos;t started a study yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {studies.map((study) => {
                const stats = parseStudyStats(study.completion_stats);
                return (
                  <li key={study.study_id}>
                    <Link
                      href={`/study/${study.study_id}`}
                      prefetch={false}
                      className="flex items-center gap-4 rounded-2xl border border-[var(--panel-border)] p-4 transition hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]"
                    >
                      <div className="min-w-0 flex-1 space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold">Study {study.study_id}</span>
                          {study.ended_at ? (
                            <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-contrast)]">Completed</span>
                          ) : (
                            <span className="text-xs font-semibold text-[var(--muted)]">In progress</span>
                          )}
                        </div>
                        <p className="text-[var(--muted)]">Started <LocalDateTime value={study.started_at} /></p>
                        {stats ? (
                          <p className="text-[var(--muted)]">Liked {stats.likedCount} of {stats.viewedCount} captions viewed</p>
                        ) : null}
                      </div>
                      <ArrowRightIcon aria-hidden className="h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="answers-heading" className={sectionClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="answers-heading" className="text-xl font-bold">Humor style answers</h2>
            <Link href="/style-preferences" className="text-sm font-semibold underline">
              {latestAnswers.length > 0 ? "Change answers" : "Take the style check"}
            </Link>
          </div>
          {answers.error ? (
            <p className="mt-3 text-sm text-[var(--error-text)]">We couldn&apos;t load your answers.</p>
          ) : latestAnswers.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">No answers yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {latestAnswers.map((answer) => {
                const pair = pairsById.get(answer.pair_id);
                if (!pair) return null;
                const picked = answer.choice === "a" ? pair.captionA : answer.choice === "b" ? pair.captionB : null;
                return (
                  <li key={answer.pair_id} className="flex gap-3 rounded-2xl border border-[var(--panel-border)] p-3">
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <p className="font-semibold leading-6">
                        {picked ?? (answer.choice === "neither" ? "Neither caption" : "No preference")}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {picked ? "You picked this caption · " : ""}
                        <LocalDateTime value={answer.created_datetime_utc} />
                      </p>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- whole external caption images, as in the study flow */}
                    <img src={pair.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-[var(--surface-muted)] object-contain" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      <AccountMenu displayName={displayName} email={user.email} signOutAction={signOut} />
    </div>
  );
}
