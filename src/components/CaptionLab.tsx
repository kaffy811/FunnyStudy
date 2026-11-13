"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";

import { generateLabCaptions, saveLabCaption, type LabCaption } from "@/app/caption-lab/actions";
import { MAX_UPLOAD_DATA_URL_CHARS } from "@/lib/caption-generation";

type Props = {
  configured: boolean;
  personalizationConsent: boolean;
};

type Selection = { dataUrl: string };

/** Downscales a photo in the browser so it fits the server-action body limit. */
async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [[1024, 0.82], [768, 0.75], [512, 0.7]] as const) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_UPLOAD_DATA_URL_CHARS) return dataUrl;
  }
  throw new Error("too large");
}

export function CaptionLab({ configured, personalizationConsent }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<LabCaption[]>([]);
  const [personalized, setPersonalized] = useState<boolean | null>(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  function choose(next: Selection) {
    setSelection(next);
    setCaptions([]);
    setChosenId(null);
    setSavedNotice(false);
    setError(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    try {
      const dataUrl = await resizeImage(file);
      choose({ dataUrl });
    } catch {
      setError("We couldn't read that image. Please try a JPEG or PNG.");
    }
  }

  async function generate() {
    if (!selection || pending) return;
    setPending(true);
    setError(null);
    setSavedNotice(false);
    const result = await generateLabCaptions({ source: "upload", dataUrl: selection.dataUrl });
    setPending(false);
    if (!result.success) return setError(result.error);
    setCaptions(result.captions);
    setChosenId(null);
    setPersonalized(result.personalized);
    setDroppedCount(result.droppedCount);
  }

  function reset() {
    setSelection(null);
    setCaptions([]);
    setChosenId(null);
    setPersonalized(null);
    setDroppedCount(0);
    setError(null);
  }

  /** Saving the chosen caption also counts as liking it; then the page clears. */
  async function saveChosen() {
    if (chosenId === null || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveLabCaption({ id: chosenId, saved: true });
    setSaving(false);
    if (!result.success) return setError(result.error);
    reset();
    setSavedNotice(true);
  }

  function done() {
    reset();
    setSavedNotice(false);
  }

  const captionClass = (active: boolean) =>
    `w-full rounded-2xl border-2 p-4 text-left text-base font-semibold leading-6 transition sm:text-lg ${
      active
        ? "border-[var(--accent-strong)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-md"
        : "border-[var(--panel-border)] hover:border-[var(--accent)]"
    }`;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">Caption lab</p>
        <h1 className="text-3xl font-black sm:text-4xl">Caption your funny photos</h1>
        <p className="text-sm leading-6 text-[var(--muted)] sm:text-base">
          Got a funny photo? Upload it and the AI writes {4} captions in different humor styles. Pick the one you like best
          and save it to Your history; your humor profile learns from it.
        </p>
        <p className="text-sm leading-6 text-[var(--muted)]">
          {personalizationConsent ? (
            <>Captions are tuned to your humor profile because you agreed to personalization.</>
          ) : (
            <>
              Captions are not personalized.{" "}
              <Link href="/history" className="font-semibold underline">Turn on personalization</Link> in Your history.
            </>
          )}
        </p>
      </header>

      {!configured ? (
        <p role="status" className="glass-panel rounded-2xl p-5 text-sm">AI captions aren&apos;t set up on this site yet. Please check back later.</p>
      ) : null}

      {savedNotice ? (
        <p role="status" className="glass-panel rounded-2xl border border-[var(--accent)] p-4 text-sm font-semibold">
          ★ Caption saved. You can find it in{" "}
          <Link href="/history#saved-heading" className="underline">Your history → Saved captions</Link>.
        </p>
      ) : null}

      <section aria-labelledby="pick-heading" className="glass-panel space-y-4 rounded-[24px] p-5 sm:p-6">
        <h2 id="pick-heading" className="text-lg font-bold">1. Upload a photo</h2>
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[var(--panel-border)] px-4 text-sm font-semibold transition hover:border-[var(--accent)]">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void onFile(event)} />
          {selection ? "Choose a different photo" : "Upload a photo"}
        </label>
        <p className="text-xs leading-5 text-[var(--muted)]">
          Your photo is resized in your browser and sent to OpenAI to write the captions. FunnyStudy keeps the photo privately in
          your account (only you can see it) and may show it in your own future studies. Please don&apos;t upload photos of people
          who haven&apos;t agreed to it.
        </p>
        {selection ? (
          // eslint-disable-next-line @next/next/no-img-element -- whole uploaded photo preview
          <img src={selection.dataUrl} alt="Your photo" className="max-h-48 w-full rounded-xl bg-[var(--surface-muted)] object-contain" />
        ) : null}
        <button
          type="button"
          disabled={!configured || !selection || pending}
          onClick={() => void generate()}
          className="min-h-12 w-full rounded-xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-contrast)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Writing captions…" : captions.length > 0 ? "Write new captions" : "2. Write captions"}
        </button>
        {error ? <p role="alert" className="text-sm text-[var(--error-text)]">{error}</p> : null}
      </section>

      {selection && (captions.length > 0 || pending) ? (
        <section aria-labelledby="results-heading" aria-busy={pending} className="glass-panel space-y-4 rounded-[24px] p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="results-heading" className="text-lg font-bold">3. Pick your favorite</h2>
            {personalized !== null && !pending ? (
              <span className="text-xs font-semibold text-[var(--muted)]">{personalized ? "Personalized for you" : "Not personalized"}</span>
            ) : null}
          </div>
          {pending ? (
            <p className="text-sm text-[var(--muted)]">Writing captions…</p>
          ) : (
            <ul className="space-y-3" role="radiogroup" aria-label="Captions">
              {captions.map((caption) => (
                <li key={caption.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosenId === caption.id}
                    onClick={() => setChosenId(chosenId === caption.id ? null : caption.id)}
                    className={captionClass(chosenId === caption.id)}
                  >
                    {chosenId === caption.id ? <span className="mb-1 block text-xs font-bold uppercase tracking-wide">✓ Your pick</span> : null}
                    {caption.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {droppedCount > 0 && !pending ? (
            <p className="text-xs text-[var(--muted)]">{droppedCount} caption{droppedCount === 1 ? " was" : "s were"} left out by our safety check.</p>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- whole image, captions above it */}
          <img src={selection.dataUrl} alt="" className="max-h-[40svh] w-full rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] object-contain" />
          {!pending ? (
            <button
              type="button"
              disabled={chosenId === null || saving}
              onClick={() => void saveChosen()}
              className="min-h-12 w-full rounded-xl bg-[var(--accent)] px-5 font-semibold text-[var(--accent-contrast)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : chosenId === null ? "Pick a caption to save" : "☆ Save my pick"}
            </button>
          ) : null}
        </section>
      ) : null}

      {selection || captions.length > 0 ? (
        <button
          type="button"
          disabled={pending || saving}
          onClick={done}
          className="min-h-12 w-full rounded-xl border border-[var(--panel-border)] px-5 font-semibold transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Done
        </button>
      ) : null}
    </div>
  );
}
