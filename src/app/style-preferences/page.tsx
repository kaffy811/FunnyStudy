import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/profile-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { StylePreferenceFlow, type StylePairItem } from "@/components/StylePreferenceFlow";
import { fetchStyleCheckState, type StylePair } from "@/lib/style-preferences";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Order and left/right placement are randomized per participant but stay the
// same on every visit, so "Previous" and the n/total counter keep their meaning.
// Decided on the server so the client renders exactly this (no hydration mismatch).
function orderedItems(pairs: readonly StylePair[], profileId: string): StylePairItem[] {
  const random = seededRandom(`style-check:${profileId}`);
  const copy = [...pairs];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.map((pair) => ({ pair, aShownFirst: random() < 0.5 }));
}

export default async function StylePreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { state, error }] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    fetchStyleCheckState(supabase, user.id),
  ]);
  if (error) console.error("[StylePreferencesPage] load failed", error);
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || user.email || "your account";

  const items = state ? orderedItems(state.pairs, user.id) : [];

  return (
    <div className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 py-3 text-[var(--foreground)] sm:px-6 sm:py-4">
      <nav aria-label="Style check navigation" className="flex shrink-0">
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
        className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto overscroll-contain pb-24"
      >
        {state && items.length > 0 ? (
          <StylePreferenceFlow
            items={items}
            styles={state.styles}
            initialChoices={state.choices}
            initialFeedback={state.feedback}
          />
        ) : (
          <div className="glass-panel m-auto rounded-2xl p-6 text-center sm:p-8">
            <h1 className="text-2xl font-bold">{state ? "No style comparisons yet" : "We couldn't load the style check"}</h1>
            <p className="mt-3 text-sm text-[var(--muted)]">{state ? "Check back later." : "Please refresh and try again."}</p>
          </div>
        )}
      </main>
      <AccountMenu displayName={displayName} email={user.email} signOutAction={signOut} />
    </div>
  );
}
