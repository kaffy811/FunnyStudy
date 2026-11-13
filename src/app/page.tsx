import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon } from "@heroicons/react/24/outline";

import { AccountMenu } from "@/components/AccountMenu";
import { LocalDateTime } from "@/components/LocalDateTime";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { buildDemographicsPath, hasPendingDemographicQuestions } from "@/lib/demographics";
import { DEMOGRAPHIC_SKIPS_COOKIE, readDemographicSkips } from "@/lib/demographic-skips";
import { buildNotificationPreferencesPath, fetchNotificationPreferences, NOTIFICATION_SKIPS_COOKIE, readNotificationSkips } from "@/lib/notification-preferences";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/supabase";

type Profile = {
  first_name: string | null;
  last_name: string | null;
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const messageRaw = resolvedParams.message;
  const message = Array.isArray(messageRaw) ? messageRaw[0] : messageRaw;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const skippedNotifications = readNotificationSkips(cookieStore.get(NOTIFICATION_SKIPS_COOKIE)?.value, user.id);
  if ((await fetchNotificationPreferences(supabase, user.id, skippedNotifications)).pending.length) {
    redirect(buildNotificationPreferencesPath("/"));
  }

  const skippedQuestionIds = readDemographicSkips(
    cookieStore.get(DEMOGRAPHIC_SKIPS_COOKIE)?.value,
    user.id
  );

  if (await hasPendingDemographicQuestions(supabase, user.id, skippedQuestionIds)) {
    redirect(buildDemographicsPath({ next: "/", skippedQuestionIds }));
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .single();

  const profile = profileData as Profile | null;

  const fullName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayName = fullName || user.email || "your account";

  if (!profile?.first_name || !profile?.last_name) {
    return (
      <CompleteProfileForm
        userEmail={user.email}
        initialFirst={profile?.first_name ?? ""}
        initialLast={profile?.last_name ?? ""}
        message={message}
      />
    );
  }

  // The newest unfinished study (from any visit) gets a small "continue" bar.
  const { data: openStudy } = await supabase
    .from("ai_study_sessions")
    .select("id, created_datetime_utc")
    .eq("profile_id", user.id)
    .is("ended_datetime_utc", null)
    .order("created_datetime_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  let openProgress: { answered: number; total: number } | null = null;
  if (openStudy) {
    const { data: openRows } = await supabase
      .from("ai_generated_captions")
      .select("position, rating")
      .eq("session_id", openStudy.id);
    const rows = (openRows ?? []) as { position: number; rating: number | null }[];
    openProgress = {
      total: Math.floor(rows.length / 2),
      answered: rows.filter((row) => row.position % 2 === 1 && row.rating !== null).length,
    };
  }
  return (
    <div
      id="home-root"
      className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 pt-8 pb-24 text-[var(--foreground)] sm:px-6 sm:pt-12"
    >
      <main
        id="home-content"
        className="relative mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain p-1"
      >
        <Link
          href="/ai-study"
          prefetch={false}
          className="glass-panel flex items-center gap-4 rounded-[28px] border-2 border-[var(--accent)] p-6 transition hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] sm:p-8"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">
              New study
            </p>
            <h1 className="text-2xl font-black sm:text-3xl">Start a new study</h1>
            <p className="text-sm leading-6 text-[var(--muted)] sm:text-base">
              About 10 random images, each with two fresh AI captions in different humor styles. Pick the funnier one;
              when you finish, the AI updates your humor profile.
            </p>
          </div>
          <ArrowRightIcon aria-hidden className="h-6 w-6 shrink-0 text-[var(--accent-strong)]" />
        </Link>
        {openStudy && openProgress && openProgress.total > 0 ? (
          <Link
            href={`/ai-study?session=${openStudy.id}`}
            prefetch={false}
            className="mt-3 flex items-center gap-3 rounded-2xl border border-[var(--accent)] bg-[var(--surface-muted)] px-4 py-3 text-sm transition hover:bg-[var(--panel-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)]"
          >
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Continue your study</span>
              <span className="block text-xs text-[var(--muted)]">
                Started <LocalDateTime value={openStudy.created_datetime_utc} /> · {openProgress.answered}/{openProgress.total} answered
              </span>
            </span>
            <ArrowRightIcon aria-hidden className="h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
          </Link>
        ) : null}
        <div className="mb-6" />
        <Link
          href="/caption-lab"
          prefetch={false}
          className="glass-panel flex items-center gap-4 rounded-2xl p-5 transition hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] sm:p-6"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-lg font-semibold sm:text-xl">Caption lab</h2>
            <p className="text-sm leading-6 text-[var(--muted)]">
              Upload a funny photo of your own and let the AI caption it in different humor styles.
            </p>
          </div>
          <ArrowRightIcon aria-hidden className="h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
        </Link>
        <Link
          href="/history"
          prefetch={false}
          className="glass-panel mt-3 flex items-center gap-4 rounded-2xl p-5 transition hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] sm:p-6"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-lg font-semibold sm:text-xl">Your history</h2>
            <p className="text-sm leading-6 text-[var(--muted)]">
              See your past studies, and review or edit your humor profile.
            </p>
          </div>
          <ArrowRightIcon aria-hidden className="h-5 w-5 shrink-0 text-[var(--accent-strong)]" />
        </Link>
      </main>
      <AccountMenu displayName={displayName} email={user.email} signOutAction={signOut} />
    </div>
  );
}

function CompleteProfileForm({
  userEmail,
  initialFirst,
  initialLast,
  message,
}: {
  userEmail: string | undefined | null;
  initialFirst: string;
  initialLast: string;
  message?: string | null;
}) {
  return (
    <div
      id="profile-complete-root"
      className="relative flex h-[100svh] min-h-[100svh] items-start justify-center overflow-hidden px-4 py-10 text-[var(--foreground)] sm:items-center sm:px-6 sm:py-16"
    >
      <div
        id="profile-bg-shell"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          id="profile-bg-orb-1"
          className="absolute -left-16 top-10 h-64 w-64 rounded-full bg-amber-500/25 blur-[110px] animate-orb"
        />
        <div
          id="profile-bg-orb-2"
          className="absolute bottom-6 right-8 h-56 w-56 rounded-full bg-yellow-300/20 blur-[110px] animate-orb-reverse"
        />
        <div
          id="profile-bg-orb-3"
          className="absolute left-12 top-1/2 h-60 w-60 -translate-y-1/2 rounded-full bg-amber-300/20 blur-[100px] animate-orb-sway"
        />
        <div
          id="profile-bg-grid"
          className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(251,191,36,0.12),transparent_42%),radial-gradient(circle_at_80%_12%,rgba(253,224,71,0.12),transparent_35%)] animate-grid-drift"
        />
      </div>

      <div
        id="profile-complete-card"
        className="relative w-full max-w-2xl rounded-3xl border border-[var(--panel-border)] bg-[var(--card-surface)] p-8 shadow-[var(--panel-shadow)] backdrop-blur-sm animate-card-rise sm:p-10 max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-h-none"
      >
        <div
          id="profile-card-topline"
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--accent)] via-[var(--accent-strong)] to-[var(--accent)] animate-shine"
        />
        <div
          id="profile-card-topglow"
          className="absolute -left-16 top-0 h-28 w-28 rounded-full bg-amber-500/15 blur-3xl"
        />
        <div id="profile-card-body" className="space-y-7 relative">
          <header className="space-y-2">
            <p className="text-sm uppercase tracking-[0.2em] text-[var(--soft)]">
              Welcome
            </p>
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-amber-100 via-amber-300 to-yellow-200 bg-clip-text text-transparent animate-text-shimmer">
                Tell us who you are
              </span>
            </h1>
            <p className="text-sm text-[var(--muted)] sm:text-base">
              We need your first and last name before you can enter. You&apos;re
              signed in as {userEmail ?? "your account"}.
            </p>
            {message ? (
              <p className="rounded-xl bg-[color-mix(in_srgb,_var(--accent)_12%,_transparent)] px-4 py-3 text-sm font-medium text-[var(--foreground)] ring-1 ring-[color-mix(in_srgb,_var(--accent)_35%,_transparent)]">
                {message}
              </p>
            ) : null}
          </header>

          <form id="profile-name-form" action={updateProfileName} className="space-y-4">
            <div id="profile-name-grid" className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-[var(--foreground)]">
                First name
                <input
                  name="first_name"
                  defaultValue={initialFirst}
                  required
                  minLength={2}
                  className="mt-2 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-base text-[var(--foreground)] shadow-inner outline-none ring-1 ring-[var(--input-border)] transition focus:ring-2 focus:ring-[var(--input-ring)]"
                  placeholder="Jane"
                />
              </label>
              <label className="block text-sm font-semibold text-[var(--foreground)]">
                Last name
                <input
                  name="last_name"
                  defaultValue={initialLast}
                  required
                  minLength={2}
                  className="mt-2 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-base text-[var(--foreground)] shadow-inner outline-none ring-1 ring-[var(--input-border)] transition focus:ring-2 focus:ring-[var(--input-ring)]"
                  placeholder="Doe"
                />
              </label>
            </div>
            <div
              id="profile-action-row"
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end"
            >
              <SubmitButton
                formAction={updateProfileName}
                pendingLabel="Saving…"
                className="w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-contrast)] shadow-lg shadow-[0_15px_40px_-20px_rgba(245,158,11,0.55)] transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] sm:w-auto"
              >
                Save and continue
              </SubmitButton>
              <SubmitButton
                pendingLabel="Signing out…"
                formAction={signOut}
                formNoValidate
                className="w-full rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] shadow-inner shadow-black/40 transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--panel-border)] sm:w-auto"
              >
                Log out
              </SubmitButton>
            </div>
          </form>
        </div>
      </div>
      <ThemeMenu />
    </div>
  );
}

async function signOut() {
  "use server";

  const supabase = await createClient({ allowCookieWrite: true });
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

async function updateProfileName(formData: FormData) {
  "use server";

  const supabase = await createClient({ allowCookieWrite: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const first = formData.get("first_name")?.toString().trim() ?? "";
  const last = formData.get("last_name")?.toString().trim() ?? "";

  if (first.length < 2 || last.length < 2) {
    redirect(
      "/?message=" + encodeURIComponent("Please enter a valid first and last name.")
    );
  }

  const updatePayload: TablesUpdate<"profiles"> = {
    first_name: first,
    last_name: last,
    modified_by_user_id: user.id,
  };
  const { error } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id);

  if (error) {
    redirect(
      "/?message=" +
        encodeURIComponent("We could not save your name. Please try again.")
    );
  }

  redirect("/");
}
