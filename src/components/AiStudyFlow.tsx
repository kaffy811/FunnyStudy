"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { chooseAiStudyCaption, endAiStudy, markAiStudyViewed, startAiStudy } from "@/app/ai-study/actions";
import type { AbChoice } from "@/lib/ai-study";

export type AiStudyPair = {
  item: number;
  imageUrl: string;
  a: { id: number; caption: string };
  b: { id: number; caption: string };
  choice: AbChoice | null;
  viewed: boolean;
};

type Props = {
  sessionId: string | null;
  items: AiStudyPair[];
  configured: boolean;
  personalized: boolean;
};

const SWIPE_MIN_PX = 60;
const WHEEL_MIN_DELTA = 30;
const WHEEL_IDLE_MS = 450;

/** Elements whose own scrolling or typing should not move between images. */
function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("dialog, input, textarea, select, [data-account-menu]"));
}

function pickedText(pair: AiStudyPair) {
  if (pair.choice === "a") return pair.a.caption;
  if (pair.choice === "b") return pair.b.caption;
  if (pair.choice === "neither") return "Neither caption";
  return "No choice yet";
}

export function AiStudyFlow({ sessionId, items: initialItems, configured, personalized }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const firstUnanswered = initialItems.findIndex((item) => !item.choice);
  const startIndex = firstUnanswered === -1 ? Math.max(initialItems.length - 1, 0) : firstUnanswered;
  const [index, setIndex] = useState(startIndex);
  const [atEnd, setAtEnd] = useState(false);
  const [pending, setPending] = useState<null | "start" | "end">(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Images shown so far (listed in "Your picks").
  const [seen, setSeen] = useState(
    () => new Set([...initialItems.filter((item) => item.viewed).map((item) => item.item), ...(initialItems[startIndex] ? [initialItems[startIndex].item] : [])])
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewedSent = useRef(new Set(initialItems.filter((item) => item.viewed).map((item) => item.item)));

  const current = items[index];

  // Record a view once per image (both captions were shown).
  useEffect(() => {
    if (!current || atEnd || viewedSent.current.has(current.item)) return;
    viewedSent.current.add(current.item);
    void markAiStudyViewed([current.a.id, current.b.id]);
  }, [current, atEnd]);

  const goTo = useCallback(
    (next: number) => {
      const target = items[next];
      if (!target) return;
      setIndex(next);
      setAtEnd(false);
      setSeen((value) => (value.has(target.item) ? value : new Set(value).add(target.item)));
    },
    [items]
  );

  const move = useCallback(
    (step: 1 | -1) => {
      if (atEnd) {
        if (step === -1) setAtEnd(false);
        return;
      }
      if (step === 1 && index === items.length - 1) return setAtEnd(true);
      goTo(Math.min(Math.max(index + step, 0), items.length - 1));
    },
    [atEnd, index, items.length, goTo]
  );

  const active = Boolean(sessionId) && items.length > 0 && summary === null && !pending && !reviewOpen;

  // Keyboard, swipe and wheel navigation (up = previous, down = next).
  useEffect(() => {
    if (!active) return;
    let touchStart: { x: number; y: number } | null = null;
    let wheelLocked = false;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;

    function onKey(event: KeyboardEvent) {
      if (isInteractiveTarget(event.target)) return;
      if (event.key === "ArrowDown") move(1);
      if (event.key === "ArrowUp") move(-1);
    }
    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || isInteractiveTarget(event.target)) return void (touchStart = null);
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    function onTouchEnd(event: TouchEvent) {
      if (!touchStart) return;
      const dx = event.changedTouches[0].clientX - touchStart.x;
      const dy = event.changedTouches[0].clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dy) >= SWIPE_MIN_PX && Math.abs(dy) > Math.abs(dx)) move(dy < 0 ? 1 : -1);
    }
    function onWheel(event: WheelEvent) {
      if (isInteractiveTarget(event.target)) return;
      // One move per wheel gesture: unlock only after the wheel goes idle.
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => (wheelLocked = false), WHEEL_IDLE_MS);
      if (wheelLocked || Math.abs(event.deltaY) < WHEEL_MIN_DELTA) return;
      wheelLocked = true;
      move(event.deltaY > 0 ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(wheelTimer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
    };
  }, [active, move]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (reviewOpen && !dialog.open) dialog.showModal();
    if (!reviewOpen && dialog.open) dialog.close();
  }, [reviewOpen]);

  async function start() {
    setPending("start");
    setError(null);
    const result = await startAiStudy();
    if (!result.success) {
      setPending(null);
      return setError(result.error);
    }
    router.push(`/ai-study?session=${result.sessionId}`);
  }

  async function choose(pair: AiStudyPair, picked: AbChoice) {
    if (!sessionId) return;
    const choice = pair.choice === picked ? null : picked;
    setItems((list) => list.map((entry) => (entry.item === pair.item ? { ...entry, choice } : entry)));
    const result = await chooseAiStudyCaption({ sessionId, item: pair.item, choice });
    if (!result.success) {
      setItems((list) => list.map((entry) => (entry.item === pair.item ? { ...entry, choice: pair.choice } : entry)));
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
          <h1 className="text-3xl font-black sm:text-4xl">Start a new study</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)] sm:text-base">
            We&apos;ll pick about 10 random images and an AI writes two captions for each one in different humor styles. Tap the
            caption you find funnier (or <strong>Neither</strong>). When you finish, the AI updates your humor profile. Photos you uploaded in the Caption lab may show up too.
          </p>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            {personalized
              ? "Captions are tuned to your humor profile because you turned on personalization."
              : "Captions are not personalized. You can turn personalization on in Your history."}
          </p>
          <button type="button" disabled={!configured || pending === "start"} onClick={() => void start()} className={`${primary} mt-6`}>
            {pending === "start" ? "Writing your captions… (about 20 seconds)" : "Start study"}
          </button>
          {!configured ? <p className="mt-3 text-sm text-[var(--muted)]">AI studies aren&apos;t set up on this site yet.</p> : null}
        </div>
        {errorBox}
      </div>
    );
  }

  const picked = items.filter((item) => item.choice === "a" || item.choice === "b").length;
  const answered = items.filter((item) => item.choice).length;

  if (summary !== null) {
    return (
      <div data-native-scroll-region="true" className="mx-auto flex w-full max-w-xl flex-col gap-4 overflow-y-auto">
        <div className={panel}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">Study complete</p>
          <h1 className="mt-2 text-3xl font-black">Here&apos;s your humor profile</h1>
          <p className="mt-4 text-base leading-7">{summary}</p>
          <p className="mt-4 text-sm text-[var(--muted)]">
            You picked a favorite for {picked} of {items.length} images. You can edit this description in Your history.
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

  const optionClass = (selected: boolean) =>
    `w-full rounded-2xl border-2 px-4 py-3 text-left text-base font-semibold leading-6 transition sm:text-lg ${
      selected
        ? "border-[var(--accent-strong)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-md"
        : "border-[var(--panel-border)] bg-[var(--surface-muted)] hover:border-[var(--accent)]"
    }`;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col items-center gap-3 pb-36 sm:pb-24">
      {errorBox}
      {atEnd ? (
        <div className="mx-auto flex w-full max-w-xl flex-1 items-center">
          <div className={panel}>
            <h1 className="text-2xl font-black sm:text-3xl">Finish this study?</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              You answered {answered} of {items.length} images. The AI will write a short description of your sense of humor and save
              it to your profile.
            </p>
            <button type="button" disabled={pending === "end"} onClick={() => void end()} className={`${primary} mt-6`}>
              {pending === "end" ? "Writing your summary…" : "End study"}
            </button>
          </div>
        </div>
      ) : (
        <article
          key={current.item}
          aria-label={`Image ${current.item} of ${items.length}`}
          className="flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-2 rounded-[28px] border border-[var(--panel-border)] bg-[var(--vote-panel-surface)] p-4 shadow-[var(--vote-panel-shadow)] sm:gap-3 sm:p-5"
        >
          <p className="shrink-0 text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--soft)]">Which caption is funnier?</p>
          <div data-native-scroll-region="true" className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto">
            <button type="button" aria-pressed={current.choice === "a"} onClick={() => void choose(current, "a")} className={optionClass(current.choice === "a")}>
              {current.choice === "a" ? <span className="mb-1 block text-xs font-bold uppercase tracking-[0.16em]">✓ Your pick</span> : null}
              {current.a.caption}
            </button>
            <button type="button" aria-pressed={current.choice === "b"} onClick={() => void choose(current, "b")} className={optionClass(current.choice === "b")}>
              {current.choice === "b" ? <span className="mb-1 block text-xs font-bold uppercase tracking-[0.16em]">✓ Your pick</span> : null}
              {current.b.caption}
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- whole external study images, never cropped */}
          <img src={current.imageUrl} alt="" className="min-h-0 w-full flex-1 rounded-2xl bg-[var(--surface-muted)] object-contain" />
          <div className="flex shrink-0 justify-center">
            <button
              type="button"
              aria-pressed={current.choice === "neither"}
              onClick={() => void choose(current, "neither")}
              className={`min-h-10 rounded-full border px-4 text-sm font-semibold transition ${
                current.choice === "neither"
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "border-[var(--panel-border)] hover:border-[var(--accent)]"
              }`}
            >
              Neither
            </button>
          </div>
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
          aria-label="Previous image"
          title="Previous image"
          disabled={!atEnd && index === 0}
          onClick={() => move(-1)}
          className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] text-2xl font-semibold disabled:opacity-40"
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setReviewOpen(true)}
          className="min-h-12 min-w-28 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-muted)] px-3 text-sm font-semibold"
        >
          {atEnd ? "End" : `${index + 1}/${items.length}`}
          <span className="block text-xs font-normal">Your picks</span>
        </button>
        <button
          type="button"
          aria-label={index === items.length - 1 ? "Go to end study" : "Next image"}
          title="Next image"
          disabled={atEnd}
          onClick={() => move(1)}
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)] text-2xl font-semibold text-[var(--accent-contrast)] disabled:opacity-40"
        >
          <span aria-hidden="true">↓</span>
        </button>
      </nav>
      <dialog
        ref={dialogRef}
        onClose={() => setReviewOpen(false)}
        aria-labelledby="picks-heading"
        className="m-auto max-h-[80svh] w-[min(92vw,36rem)] rounded-[24px] border border-[var(--panel-border)] bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/50"
      >
        <div className="flex max-h-[80svh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] p-4">
            <h2 id="picks-heading" className="text-lg font-bold">Your picks</h2>
            <button type="button" onClick={() => setReviewOpen(false)} className="min-h-10 rounded-xl border border-[var(--panel-border)] px-4 text-sm font-semibold">
              Close
            </button>
          </div>
          <ul data-native-scroll-region="true" className="space-y-2 overflow-y-auto overscroll-contain p-4">
            {items.filter((item) => seen.has(item.item)).length === 0 ? (
              <li className="text-sm text-[var(--muted)]">Images you&apos;ve seen will show up here.</li>
            ) : null}
            {items
              .filter((item) => seen.has(item.item))
              .map((item) => (
                <li key={item.item}>
                  <button
                    type="button"
                    onClick={() => {
                      goTo(items.indexOf(item));
                      setReviewOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition hover:border-[var(--accent)] ${
                      !atEnd && item.item === current?.item ? "border-[var(--accent)]" : "border-[var(--panel-border)]"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- whole study image thumbnail */}
                    <img src={item.imageUrl} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg bg-[var(--surface-muted)] object-contain" />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block text-xs text-[var(--muted)]">Image {item.item}</span>
                      <span className={`block leading-5 ${item.choice === "a" || item.choice === "b" ? "font-semibold" : "text-[var(--muted)]"}`}>
                        {pickedText(item)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </dialog>
    </div>
  );
}
