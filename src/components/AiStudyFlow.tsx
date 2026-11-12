"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HeartIcon } from "@heroicons/react/24/solid";

import { endAiStudy, markAiStudyViewed, rateAiStudyCaption, startAiStudy } from "@/app/ai-study/actions";

export type AiStudyItem = { id: number; position: number; caption: string; imageUrl: string; funny: boolean; viewed: boolean };

type Props = {
  sessionId: string | null;
  items: AiStudyItem[];
  configured: boolean;
  personalized: boolean;
};

export function AiStudyFlow({ sessionId, items: initialItems, configured, personalized }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const firstUnviewed = initialItems.findIndex((item) => !item.viewed);
  const [index, setIndex] = useState(firstUnviewed === -1 ? Math.max(initialItems.length - 1, 0) : firstUnviewed);
  const [atEnd, setAtEnd] = useState(false);
  const [pending, setPending] = useState<null | "start" | "end">(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const viewedSent = useRef(new Set(initialItems.filter((item) => item.viewed).map((item) => item.id)));

  const current = items[index];

  // Record a view once per caption.
  useEffect(() => {
    if (!current || atEnd || viewedSent.current.has(current.id)) return;
    viewedSent.current.add(current.id);
    void markAiStudyViewed(current.id);
  }, [current, atEnd]);

  const move = useCallback(
    (step: 1 | -1) => {
      if (atEnd) {
        if (step === -1) setAtEnd(false);
        return;
      }
      if (step === 1 && index === items.length - 1) return setAtEnd(true);
      setIndex((value) => Math.min(Math.max(value + step, 0), items.length - 1));
    },
    [atEnd, index, items.length]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (summary || pending) return;
      if (event.key === "ArrowDown") move(1);
      if (event.key === "ArrowUp") move(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, summary, pending]);

  async function start() {
    setPending("start");
    setError(null);
    const result = await startAiStudy();
    if (!result.success) {
      setPending(null);
      return setError(result.error);
    }
    router.refresh();
  }

  async function toggleFunny(item: AiStudyItem) {
    const funny = !item.funny;
    setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, funny } : entry)));
    const result = await rateAiStudyCaption({ id: item.id, funny });
    if (!result.success) {
      setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, funny: item.funny } : entry)));
      setError(result.error);
    }
  }

  async function end() {
    if (!sessionId) return;
    setPending("end");
    setError(null);
    const result = await endAiStudy(sessionId);
    setPending(null);
    if (!result.success) return setError(result.error);
    setSummary(result.summary);
  }

  const panel =
    "glass-panel w-full rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-6 text-left shadow-[var(--vote-panel-shadow)] sm:p-8";
  const primary =
    "min-h-12 w-full rounded-xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-contrast)] disabled:cursor-not-allowed disabled:opacity-60";
  const errorBox = error ? (
    <p role="alert" className="w-full rounded-xl bg-[var(--error-bg)] px-4 py-3 text-sm font-semibold text-[var(--error-text)] ring-1 ring-[var(--error-border)]">
      {error}
    </p>
  ) : null;

  if (!sessionId || items.length === 0) {
    return (
      <div data-native-scroll-region="true" className="mx-auto flex w-full max-w-xl flex-col gap-4 overflow-y-auto">
        <div className={panel}>
          <h1 className="text-3xl font-black sm:text-4xl">Your study for today</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)] sm:text-base">
            We&apos;ll pick about 10 random images and an AI writes a fresh caption for each one. Tap <strong>Funny</strong> on the
            ones that make you laugh. When you finish, the AI updates your humor profile.
          </p>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            {personalized
              ? "Captions are tuned to your humor profile because you turned on personalization."
              : "Captions are not personalized. You can turn personalization on in Your history."}
          </p>
          <button type="button" disabled={!configured || pending === "start"} onClick={() => void start()} className={`${primary} mt-6`}>
            {pending === "start" ? "Writing your captions… (about 15 seconds)" : "Start study"}
          </button>
          {!configured ? <p className="mt-3 text-sm text-[var(--muted)]">AI studies aren&apos;t set up on this site yet.</p> : null}
        </div>
        {errorBox}
      </div>
    );
  }

  if (summary !== null) {
    return (
      <div data-native-scroll-region="true" className="mx-auto flex w-full max-w-xl flex-col gap-4 overflow-y-auto">
        <div className={panel}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">Study complete</p>
          <h1 className="mt-2 text-3xl font-black">Here&apos;s your humor profile</h1>
          <p className="mt-4 text-base leading-7">{summary}</p>
          <p className="mt-4 text-sm text-[var(--muted)]">
            You found {items.filter((item) => item.funny).length} of {items.length} captions funny. You can edit this description in
            Your history.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link href="/history" className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-contrast)]">
              Your history
            </Link>
            <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl border border-[var(--panel-border)] px-5 font-semibold">
              Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const liked = items.filter((item) => item.funny).length;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col items-center gap-3 pb-36 sm:pb-24">
      {errorBox}
      {atEnd ? (
        <div className="mx-auto flex w-full max-w-xl flex-1 items-center">
          <div className={panel}>
            <h1 className="text-2xl font-black sm:text-3xl">Finish this study?</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              You found {liked} of {items.length} captions funny. The AI will write a short description of your sense of humor and
              save it to your profile.
            </p>
            <button type="button" disabled={pending === "end"} onClick={() => void end()} className={`${primary} mt-6`}>
              {pending === "end" ? "Writing your summary…" : "End study"}
            </button>
          </div>
        </div>
      ) : (
        <article key={current.id} className="flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-3 rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-4 shadow-[var(--vote-panel-shadow)] sm:p-5">
          <p data-native-scroll-region="true" className="max-h-[30%] shrink-0 overflow-y-auto text-center text-lg font-semibold leading-7 sm:text-xl">
            {current.caption}
          </p>
          <div className="flex shrink-0 justify-center">
            <button
              type="button"
              aria-pressed={current.funny}
              aria-label={current.funny ? "Remove Funny" : "Mark as Funny"}
              onClick={() => void toggleFunny(current)}
              className={`flex min-h-12 items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-5 transition ${
                current.funny ? "text-[var(--heart-active)]" : "text-[var(--heart-idle)] hover:text-[var(--heart-hover)]"
              }`}
            >
              <HeartIcon aria-hidden className="h-7 w-7" />
              <span className="text-sm font-semibold text-[var(--foreground)]">{current.funny ? "Funny · undo" : "Funny"}</span>
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- whole external study images, never cropped */}
          <img src={current.imageUrl} alt="" className="min-h-0 w-full flex-1 rounded-2xl bg-[var(--surface-muted)] object-contain" />
          {items[index + 1] ? (
            // Preload the next image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={items[index + 1].imageUrl} alt="" aria-hidden className="hidden" />
          ) : null}
        </article>
      )}
      <nav
        aria-label="Study navigation"
        className="fixed inset-x-0 bottom-20 z-40 mx-auto flex max-w-sm items-center justify-center gap-2 rounded-t-2xl bg-[var(--background)] px-3 pt-2 sm:bottom-0"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <button
          type="button"
          aria-label="Previous caption"
          title="Previous caption"
          disabled={!atEnd && index === 0}
          onClick={() => move(-1)}
          className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] text-2xl font-semibold disabled:opacity-40"
        >
          <span aria-hidden="true">↑</span>
        </button>
        <span className="min-h-12 min-w-24 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-3 py-1 text-center text-sm font-semibold">
          {atEnd ? "End" : `${index + 1}/${items.length}`}
          <span className="block text-xs font-normal">{liked} funny</span>
        </span>
        <button
          type="button"
          aria-label={index === items.length - 1 ? "Go to end study" : "Next caption"}
          title="Next caption"
          disabled={atEnd}
          onClick={() => move(1)}
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)] text-2xl font-semibold text-[var(--accent-contrast)] disabled:opacity-40"
        >
          <span aria-hidden="true">↓</span>
        </button>
      </nav>
    </div>
  );
}
