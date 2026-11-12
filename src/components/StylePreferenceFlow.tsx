"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";

import { saveStyleFeedback, saveStylePreference } from "@/app/style-preferences/actions";
import {
  FEEDBACK_COMMENT_MAX,
  tallyStyles,
  type HumorStyle,
  type StyleChoice,
  type StyleFeedback,
  type StylePair,
} from "@/lib/style-preferences";

export type StylePairItem = { pair: StylePair; aShownFirst: boolean };

type Props = {
  items: StylePairItem[];
  styles: HumorStyle[];
  initialChoices: Record<number, StyleChoice>;
  initialFeedback: StyleFeedback | null;
};

type Phase = "intro" | "pair" | "summary";

const inputMethodFor = (event: MouseEvent) => (event.detail === 0 ? "keyboard" : "button");

export function StylePreferenceFlow({ items, styles, initialChoices, initialFeedback }: Props) {
  const [choices, setChoices] = useState(initialChoices);
  const answeredCount = items.filter(({ pair }) => choices[pair.id]).length;
  const firstUnanswered = items.findIndex(({ pair }) => !initialChoices[pair.id]);
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(firstUnanswered === -1 ? 0 : firstUnanswered);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase !== "pair") return;
    shownAt.current = performance.now();
    heading.current?.focus();
  }, [phase, index]);

  const current = items[index];
  const allAnswered = answeredCount === items.length;

  async function choose(choice: StyleChoice, event: MouseEvent) {
    if (!current || saving) return;
    const pairId = current.pair.id;
    const previous = choices[pairId];
    setSaving(true);
    setError(null);
    setChoices((prev) => ({ ...prev, [pairId]: choice }));
    const result = await saveStylePreference({
      pairId,
      choice,
      aShownFirst: current.aShownFirst,
      // event.timeStamp shares the performance.now() clock in modern browsers.
      timeToChooseMs: event.timeStamp - shownAt.current,
      inputMethod: inputMethodFor(event),
    });
    setSaving(false);
    if (!result.success) {
      setChoices((prev) => {
        const next = { ...prev };
        if (previous) next[pairId] = previous; else delete next[pairId];
        return next;
      });
      setError(result.error);
      return;
    }
    if (index + 1 < items.length) setIndex(index + 1);
    else setPhase("summary");
  }

  if (phase === "intro") {
    return (
      <section className="glass-panel m-auto w-full max-w-xl rounded-[28px] p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">Humor style check</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">Which caption is funnier to you?</h1>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)] sm:text-base">
          You&apos;ll see {items.length} images, each with two captions written in different humor styles. Pick the one you
          prefer, or choose <strong>Neither</strong> or <strong>No preference</strong>. There are no right answers.
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Your choices are saved to your account. This check is separate from the caption studies and does not change their results.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {allAnswered ? (
            <>
              <button type="button" onClick={() => setPhase("summary")} className="min-h-12 flex-1 rounded-xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-contrast)]">
                See your results
              </button>
              <button type="button" onClick={() => { setIndex(0); setPhase("pair"); }} className="min-h-12 flex-1 rounded-xl border border-[var(--panel-border)] px-5 font-semibold">
                Review answers
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setPhase("pair")} className="min-h-12 flex-1 rounded-xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-contrast)]">
              {answeredCount > 0 ? `Continue (${answeredCount}/${items.length} done)` : "Start"}
            </button>
          )}
        </div>
      </section>
    );
  }

  if (phase === "summary") {
    return (
      <StyleSummary
        styles={styles}
        pairs={items.map(({ pair }) => pair)}
        choices={choices}
        initialFeedback={initialFeedback}
        onReview={() => { setIndex(0); setPhase("pair"); }}
      />
    );
  }

  const { pair, aShownFirst } = current;
  const options = aShownFirst
    ? [{ choice: "a" as const, text: pair.captionA }, { choice: "b" as const, text: pair.captionB }]
    : [{ choice: "b" as const, text: pair.captionB }, { choice: "a" as const, text: pair.captionA }];
  const selected = choices[pair.id];
  const optionClass = (active: boolean) =>
    `min-h-24 rounded-2xl border-2 p-4 text-left text-base font-semibold leading-6 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-strong)] disabled:cursor-wait sm:text-lg ${
      active ? "border-[var(--accent)] bg-[var(--surface-muted)]" : "border-[var(--panel-border)] hover:border-[var(--accent)]"
    }`;
  const secondaryClass = (active: boolean) =>
    `min-h-12 flex-1 rounded-xl border px-4 text-sm font-semibold transition disabled:cursor-wait ${
      active ? "border-[var(--accent)] bg-[var(--surface-muted)]" : "border-[var(--panel-border)] hover:border-[var(--accent)]"
    }`;

  return (
    <section aria-labelledby="style-pair-heading" className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <h1 id="style-pair-heading" ref={heading} tabIndex={-1} className="text-lg font-bold outline-none sm:text-xl">
          Which caption do you prefer?
        </h1>
        <span className="shrink-0 text-sm font-semibold text-[var(--muted)]" aria-live="polite">
          {index + 1}/{items.length}
        </span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- caption images are rendered whole from external hosts, like the study flow */}
      <img
        src={pair.imageUrl}
        alt=""
        className="max-h-[38svh] w-full rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] object-contain"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(({ choice, text }, position) => (
          <button
            key={choice}
            type="button"
            disabled={saving}
            aria-pressed={selected === choice}
            aria-label={`Caption ${position === 0 ? "1" : "2"}: ${text}`}
            onClick={(event) => choose(choice, event)}
            className={optionClass(selected === choice)}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <button type="button" disabled={saving} aria-pressed={selected === "neither"} onClick={(event) => choose("neither", event)} className={secondaryClass(selected === "neither")}>
          Neither
        </button>
        <button type="button" disabled={saving} aria-pressed={selected === "no_preference"} onClick={(event) => choose("no_preference", event)} className={secondaryClass(selected === "no_preference")}>
          No preference
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-[var(--error-text)]">{error}</p> : null}
      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={() => (index === 0 ? setPhase("intro") : setIndex(index - 1))}
          className="min-h-12 rounded-xl border border-[var(--panel-border)] px-4 text-sm font-semibold"
        >
          ↑ Previous
        </button>
        {selected && index + 1 < items.length ? (
          <button type="button" onClick={() => setIndex(index + 1)} className="min-h-12 rounded-xl border border-[var(--panel-border)] px-4 text-sm font-semibold">
            Next ↓
          </button>
        ) : selected && allAnswered ? (
          <button type="button" onClick={() => setPhase("summary")} className="min-h-12 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)]">
            See results
          </button>
        ) : null}
      </div>
    </section>
  );
}

function StyleSummary({
  styles,
  pairs,
  choices,
  initialFeedback,
  onReview,
}: {
  styles: HumorStyle[];
  pairs: StylePair[];
  choices: Record<number, StyleChoice>;
  initialFeedback: StyleFeedback | null;
  onReview: () => void;
}) {
  const tally = useMemo(() => tallyStyles(styles, pairs, choices), [styles, pairs, choices]);
  const [liked, setLiked] = useState<number[]>(initialFeedback?.likedStyleIds ?? []);
  const [disliked, setDisliked] = useState<number[]>(initialFeedback?.dislikedStyleIds ?? []);
  const [comment, setComment] = useState(initialFeedback?.comment ?? "");
  const [consent, setConsent] = useState(initialFeedback?.personalizationConsent ?? false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">(initialFeedback ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const neutral = Object.values(choices).filter((choice) => choice === "neither" || choice === "no_preference").length;

  const toggle = (id: number, list: number[], set: (ids: number[]) => void, other: number[], setOther: (ids: number[]) => void) => {
    setStatus("idle");
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    if (other.includes(id)) setOther(other.filter((x) => x !== id));
  };

  async function submit() {
    setStatus("saving");
    setError(null);
    const result = await saveStyleFeedback({ likedStyleIds: liked, dislikedStyleIds: disliked, comment, personalizationConsent: consent });
    if (result.success) setStatus("saved");
    else { setStatus("idle"); setError(result.error); }
  }

  return (
    <section className="glass-panel mx-auto w-full max-w-2xl rounded-[28px] p-5 sm:p-7">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">Humor style check</p>
      <h1 className="mt-3 text-3xl font-black sm:text-4xl">Your humor styles</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        How often you picked each style when it appeared. You chose Neither or No preference {neutral} time{neutral === 1 ? "" : "s"}; those don&apos;t count for either style.
      </p>
      <ul className="mt-5 space-y-3">
        {tally.map(({ style, shown, chosen }) => (
          <li key={style.id} className="rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{style.name}</span>
              <span className="text-sm text-[var(--muted)]">picked {chosen} of {shown}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-[var(--panel-border)]" aria-hidden>
              <div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${(chosen / shown) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{style.description}</p>
          </li>
        ))}
      </ul>

      <form className="mt-8 space-y-6" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div>
          <h2 className="text-xl font-bold">Optional feedback</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Every question is optional.</p>
        </div>
        <StyleChecklist legend="Which styles do you enjoy?" styles={styles} selected={liked} onToggle={(id) => toggle(id, liked, setLiked, disliked, setDisliked)} />
        <StyleChecklist legend="Which styles would you rather not see?" styles={styles} selected={disliked} onToggle={(id) => toggle(id, disliked, setDisliked, liked, setLiked)} />
        <label className="block">
          <span className="font-semibold">What would you change about the captions?</span>
          <textarea
            value={comment}
            maxLength={FEEDBACK_COMMENT_MAX}
            onChange={(event) => { setStatus("idle"); setComment(event.target.value); }}
            rows={3}
            className="mt-2 w-full rounded-xl border border-[var(--panel-border)] bg-[var(--background)] p-3 text-sm"
          />
          <span className="mt-1 block text-right text-xs text-[var(--muted)]">{comment.length}/{FEEDBACK_COMMENT_MAX}</span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-[var(--panel-border)] p-4">
          <input type="checkbox" checked={consent} onChange={(event) => { setStatus("idle"); setConsent(event.target.checked); }} className="mt-1 h-5 w-5 shrink-0" />
          <span className="text-sm leading-6">
            I agree that a summary of my style choices and feedback may be used to generate captions in my preferred styles for future studies.
            It is not used to train AI models. I can turn this off at any time.
          </span>
        </label>
        {error ? <p role="alert" className="text-sm text-[var(--error-text)]">{error}</p> : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={status === "saving"} className="min-h-12 flex-1 rounded-xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-contrast)] disabled:cursor-wait disabled:opacity-80">
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save feedback"}
          </button>
          <button type="button" onClick={onReview} className="min-h-12 flex-1 rounded-xl border border-[var(--panel-border)] px-5 font-semibold">
            Review answers
          </button>
          <Link href="/" className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-[var(--panel-border)] px-5 font-semibold">
            Back to studies
          </Link>
        </div>
      </form>
    </section>
  );
}

function StyleChecklist({ legend, styles, selected, onToggle }: { legend: string; styles: HumorStyle[]; selected: number[]; onToggle: (id: number) => void }) {
  return (
    <fieldset>
      <legend className="font-semibold">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {styles.map((style) => (
          <label key={style.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm ${selected.includes(style.id) ? "border-[var(--accent)] bg-[var(--surface-muted)] font-semibold" : "border-[var(--panel-border)]"}`}>
            <input type="checkbox" checked={selected.includes(style.id)} onChange={() => onToggle(style.id)} className="h-4 w-4" />
            {style.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
