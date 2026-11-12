"use client";

import { useState } from "react";

import { setPersonalizationConsent } from "@/app/ai-study/actions";

export function PersonalizationToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setPending(true);
    setError(null);
    const result = await setPersonalizationConsent(next);
    setPending(false);
    if (!result.success) return setError(result.error);
    setEnabled(next);
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--panel-border)] p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={enabled} disabled={pending} onChange={() => void toggle()} className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]" />
        <span className="text-sm leading-6">
          <span className="font-semibold">Personalize my captions.</span> Send this humor description (never your name or email) to
          OpenAI so new captions are tuned to you. Humor styles are still assigned at random, so the study stays fair.
        </span>
      </label>
      {error ? <p role="alert" className="text-sm text-[var(--error-text)]">{error}</p> : null}
    </div>
  );
}
