"use client";

import { useState } from "react";

import { resetHumorSummary, saveHumorSummary } from "@/app/history/actions";
import { HUMOR_SUMMARY_MAX } from "@/lib/humor-summary";

type Props = {
  generated: string;
  saved: string | null;
  savedSource?: "user" | "ai" | null;
};

export function HumorSummaryEditor({ generated, saved, savedSource = "user" }: Props) {
  const [current, setCurrent] = useState(saved);
  const [source, setSource] = useState(savedSource);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved ?? generated);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = current ?? generated;

  async function save() {
    setPending(true);
    setError(null);
    const result = await saveHumorSummary(draft);
    setPending(false);
    if (!result.success) return setError(result.error);
    setCurrent(draft.trim());
    setSource("user");
    setEditing(false);
    setNotice("Saved.");
  }

  async function reset() {
    setPending(true);
    setError(null);
    const result = await resetHumorSummary();
    setPending(false);
    if (!result.success) return setError(result.error);
    setCurrent(null);
    setDraft(generated);
    setEditing(false);
    setNotice("Back to the generated summary.");
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--soft)]">
        {current ? (source === "ai" ? "Written by AI after your last study" : "Edited by you") : "Generated from your ratings"}
      </p>
      {editing ? (
        <label className="block">
          <span className="sr-only">Your humor preference summary</span>
          <textarea
            value={draft}
            maxLength={HUMOR_SUMMARY_MAX}
            rows={5}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            className="w-full rounded-xl border border-[var(--panel-border)] bg-[var(--background)] p-3 text-sm leading-6"
          />
          <span className="mt-1 block text-right text-xs text-[var(--muted)]">{draft.length}/{HUMOR_SUMMARY_MAX}</span>
        </label>
      ) : (
        <p className="whitespace-pre-line text-base leading-7">{shown}</p>
      )}
      {error ? <p role="alert" className="text-sm text-[var(--error-text)]">{error}</p> : null}
      {notice && !editing ? <p role="status" className="text-sm text-[var(--muted)]">{notice}</p> : null}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <button
              type="button"
              disabled={pending || !draft.trim()}
              onClick={() => void save()}
              className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save summary"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => { setDraft(shown); setEditing(false); setError(null); }}
              className="min-h-11 rounded-xl border border-[var(--panel-border)] px-4 text-sm font-semibold"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(shown); setEditing(true); setNotice(null); }}
            className="min-h-11 rounded-xl border border-[var(--panel-border)] px-4 text-sm font-semibold hover:border-[var(--accent)]"
          >
            Edit summary
          </button>
        )}
        {current ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void reset()}
            className="min-h-11 rounded-xl border border-[var(--panel-border)] px-4 text-sm font-semibold hover:border-[var(--accent)]"
          >
            Reset to generated
          </button>
        ) : null}
      </div>
    </div>
  );
}
