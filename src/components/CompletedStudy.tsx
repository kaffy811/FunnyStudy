import Link from "next/link";
import type { StudyParticipation } from "@/lib/study-participation";
import { parseStudyStats } from "@/lib/study-stats";

export function CompletedStudy({ participation }: { participation: StudyParticipation }) {
  const stats = parseStudyStats(participation.completion_stats);
  const percentage = stats && stats.viewedCount > 0
    ? Math.round(stats.likedCount / stats.viewedCount * 1000) / 10
    : 0;
  return (
    <div className="flex h-full min-h-0 w-full max-w-xl flex-1 self-stretch items-stretch sm:max-w-2xl">
      <div className="glass-panel flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-5 text-left text-[var(--foreground)] shadow-[var(--vote-panel-shadow)] sm:p-7">
        <div
          id="completion-stats-scroll-region"
          data-native-scroll-region="true"
          tabIndex={0}
          aria-label="Study stats"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 pb-2 [-webkit-overflow-scrolling:touch] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">Study Completed</p>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.06em] text-[var(--foreground)] sm:text-4xl">Your study summary</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--soft)] sm:text-base">Thank you for participating!</p>
          {stats ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <StatCard label="Median time before liking" value={formatMilliseconds(stats.medianVoteTimeMs)} description="The middle value of your recorded times before liking a caption." />
              <StatCard label="Median time before moving on" value={formatMilliseconds(stats.medianNavigationTimeMs)} description="The middle value of your recorded times before the next caption." />
              <StatCard label="Viewed captions liked" value={`${percentage}%`} description={`${stats.likedCount} of ${stats.viewedCount} viewed captions received a like.`} />
              <StatCard label="Captions liked" value={stats.likedCount.toLocaleString("en-US")} />
              <StatCard label="Captions viewed" value={stats.viewedCount.toLocaleString("en-US")} />
            </div>
          ) : (
            <p role="status" className="mt-6 text-sm text-[var(--muted)]">Stats weren&apos;t saved for this completed study.</p>
          )}
          {stats ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">A caption without a like is not necessarily disliked. It may be neutral, unclear, or left without a response. Timing values are rounded for display; the saved study results are unchanged.</p> : null}
        </div>
        <div className="shrink-0 pt-4">
          <Link href="/" className="inline-flex w-full justify-center rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-contrast)]">
            Back to studies
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatMilliseconds(milliseconds: number | null) {
  return milliseconds === null ? "—" : `${(milliseconds / 1000).toFixed(1)} seconds`;
}

function StatCard({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-4 py-4 shadow-inner">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--soft)]">{label}</p>
      <p className="mt-2 text-2xl font-bold leading-none text-[var(--foreground)] sm:text-[28px]">{value}</p>
      {description ? <p className="mt-2 text-sm leading-5 text-[var(--muted)]">{description}</p> : null}
    </div>
  );
}
