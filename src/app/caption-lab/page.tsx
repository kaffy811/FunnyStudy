import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/profile-actions";
import { AccountMenu } from "@/components/AccountMenu";
import { CaptionLab } from "@/components/CaptionLab";
import { openAiConfig } from "@/lib/openai";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CaptionLabPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: feedback }] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    supabase.from("style_preference_feedback").select("personalization_consent").eq("profile_id", user.id).maybeSingle(),
  ]);
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || user.email || "your account";


  return (
    <div className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden px-4 py-3 text-[var(--foreground)] sm:px-6 sm:py-4">
      <nav aria-label="Caption lab navigation" className="flex shrink-0">
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
        className="relative mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain p-1 pb-24"
      >
        <CaptionLab
          configured={openAiConfig() !== null}
          personalizationConsent={feedback?.personalization_consent === true}
        />
      </main>
      <AccountMenu displayName={displayName} email={user.email} signOutAction={signOut} />
    </div>
  );
}
