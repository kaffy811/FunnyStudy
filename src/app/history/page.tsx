import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/profile-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { HumorSummaryEditor } from "@/components/HumorSummaryEditor";
import { LocalDateTime } from "@/components/LocalDateTime";
import { PersonalizationToggle } from "@/components/PersonalizationToggle";
import { fallbackSummary, styleStats, type StudyStyle } from "@/lib/ai-study";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CaptionRow = {
  id: number;
  session_id: string | null;
  position: number | null;
  image_source: "upload" | "style_pair" | "study";
  style_id: number;
  caption: string;
  rating: -1 | 1 | null;
  image_url: string | null;
  personalized: boolean;
  viewed_datetime_utc: string | null;
  created_datetime_utc: string;
};
type SessionRow = {
  id: string;
  created_datetime_utc: string;
  ended_datetime_utc: string | null;
  item_count: number | null;
  liked_count: number | null;
  ai_summary: string | null;
};

const sectionClass = "glass-panel rounded-[24px] p-5 sm:p-6";

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, styles, sessions, captions, savedSummary, consent] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    supabase.from("humor_styles").select("id, slug, name, description").order("id"),
    supabase
      .from("ai_study_sessions")
      .select("id, created_datetime_utc, ended_datetime_utc, item_count, liked_count, ai_summary")
      .eq("profile_id", user.id)
      .order("created_datetime_utc", { ascending: false })
      .limit(30),
    supabase
      .from("ai_generated_captions")
      .select("id, session_id, position, image_source, style_id, caption, rating, image_url, personalized, viewed_datetime_utc, created_datetime_utc")
      .eq("profile_id", user.id)
      .order("created_datetime_utc", { ascending: false })
      .order("id", { ascending: false })
      .limit(1000),
    supabase.from("profile_humor_summaries").select("summary, source").eq("profile_id", user.id).maybeSingle(),
    supabase.from("style_preference_feedback").select("personalization_consent").eq("profile_id", user.id).maybeSingle(),
  ]);
  for (const [label, error] of [
    ["styles", styles.error],
    ["sessions", sessions.error],
    ["captions", captions.error],
    ["summary", savedSummary.error],
  ] as const) {
    if (error) console.error(`[HistoryPage] load ${label} failed`, error);
  }

  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || user.email || "your account";
  const rows = (captions.data ?? []) as CaptionRow[];
  const styleList = (styles.data ?? []) as StudyStyle[];
  const styleNames = new Map(styleList.map((style) => [style.id, style.name]));
  const stats = styleStats(
    styleList,
    rows.map((row) => ({ styleId: row.style_id, viewed: row.image_source === "study" && row.viewed_datetime_utc !== null, rating: row.rating }))
  );
  const generated = fallbackSummary(stats);
  const bySession = new Map<string, CaptionRow[]>();
  for (const row of rows) {
    if (!row.session_id) continue;
    bySession.set(row.session_id, [...(bySession.get(row.session_id) ?? []), row]);
  }
  const studySessions = (sessions.data ?? []) as SessionRow[];
  const summarySource = savedSummary.data?.source === "ai" ? "ai" : "user";

  return (
    <div className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 py-3 text-[var(--foreground)] sm:px-6 sm:py-4">
      <nav aria-label="History navigation" className="flex shrink-0">
        <Link
          href="/"
          aria-label="Back to home"
          title="Back to home"
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
          <p className="text-sm text-[var(--muted)] sm:text-base">Your past studies and what we think you find funny.</p>
        </header>

        <section aria-labelledby="summary-heading" className={sectionClass}>
          <h2 id="summary-heading" className="text-xl font-bold">Your humor profile</h2>
          <div className="mt-4">
            <HumorSummaryEditor
              generated={generated}
              saved={savedSummary.error ? null : savedSummary.data?.summary ?? null}
              savedSource={summarySource}
            />
          </div>
          {stats.length > 0 ? (
            <ul className="mt-5 grid gap-2 sm:grid-cols-2" aria-label="Picks by humor style">
              {stats.map(({ styleId, name, shown, liked }) => (
                <li key={styleId} className="rounded-xl border border-[var(--panel-border)] p-3">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold">{name}</span>
                    <span className="text-[var(--muted)]">picked {liked} of {shown}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[var(--panel-border)]" aria-hidden>
                    <div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${(liked / shown) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4">
            <PersonalizationToggle initial={consent.data?.personalization_consent === true} />
          </div>
        </section>

        <section aria-labelledby="ai-studies-heading" className={sectionClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ai-studies-heading" className="text-xl font-bold">Past studies</h2>
            <Link href="/ai-study" className="text-sm font-semibold underline">Go to your study</Link>
          </div>
          {sessions.error ? (
            <p className="mt-3 text-sm text-[var(--error-text)]">We couldn&apos;t load your studies.</p>
          ) : studySessions.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">You haven&apos;t done a study yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {studySessions.map((session) => {
                const rowsInOrder = (bySession.get(session.id) ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
                // A/B studies store two captions per image at consecutive positions.
                const images: { key: number; imageUrl: string | null; captions: CaptionRow[] }[] = [];
                for (const row of rowsInOrder) {
                  const last = images.at(-1);
                  if (last && last.imageUrl === row.image_url && last.captions.length < 2) last.captions.push(row);
                  else images.push({ key: row.id, imageUrl: row.image_url, captions: [row] });
                }
                const liked = session.liked_count ?? rowsInOrder.filter((row) => row.rating === 1).length;
                const total = session.item_count ?? images.length;
                return (
                  <li key={session.id}>
                    <details className="group rounded-2xl border border-[var(--panel-border)] p-4">
                      <summary className="flex cursor-pointer list-none items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-1 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold"><LocalDateTime value={session.created_datetime_utc} /></span>
                            {session.ended_datetime_utc ? (
                              <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-contrast)]">Completed</span>
                            ) : (
                              <span className="text-xs font-semibold text-[var(--muted)]">Not finished</span>
                            )}
                          </div>
                          <p className="text-[var(--muted)]">Picked a favorite for {liked} of {total} images</p>
                          {session.ai_summary ? <p className="leading-6">{session.ai_summary}</p> : null}
                        </div>
                        <ArrowRightIcon aria-hidden className="mt-1 h-5 w-5 shrink-0 text-[var(--accent-strong)] transition group-open:rotate-90" />
                      </summary>
                      <ul className="mt-4 space-y-3 border-t border-[var(--panel-border)] pt-4">
                        {images.map((image) => (
                          <li key={image.key} className="flex gap-3">
                            <ul className="min-w-0 flex-1 space-y-1 text-sm">
                              {image.captions.map((item) => (
                                <li key={item.id} className={item.rating === 1 ? "font-semibold leading-6" : "leading-6 text-[var(--muted)]"}>
                                  {item.rating === 1 ? "✓ " : ""}
                                  {item.caption}
                                  <span className="ml-1 text-xs font-normal text-[var(--muted)]">({styleNames.get(item.style_id) ?? "Unknown style"})</span>
                                </li>
                              ))}
                              {image.captions.length === 2 && image.captions.every((item) => item.rating === -1) ? (
                                <li className="text-xs text-[var(--muted)]">You picked neither</li>
                              ) : null}
                            </ul>
                            {image.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- whole external study images
                              <img src={image.imageUrl} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg bg-[var(--surface-muted)] object-contain" />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
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
