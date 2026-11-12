"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";

import { generateLabCaptions, rateLabCaption, type LabCaption } from "@/app/caption-lab/actions";
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

  function choose(next: Selection) {
    setSelection(next);
    setCaptions([]);
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
    const result = await generateLabCaptions({ source: "upload", dataUrl: selection.dataUrl });
    setPending(false);
    if (!result.success) return setError(result.error);
    setCaptions(result.captions);
    setPersonalized(result.personalized);
    setDroppedCount(result.droppedCount);
  }

  async function rate(caption: LabCaption, rating: -1 | 1) {
    const next = caption.rating === rating ? null : rating;
    setCaptions((list) => list.map((item) => (item.id === caption.id ? { ...item, rating: next } : item)));
    const result = await rateLabCaption({ id: caption.id, rating: next });
    if (!result.success) {
      setCaptions((list) => list.map((item) => (item.id === caption.id ? { ...item, rating: caption.rating } : item)));
      setError(result.error);
    }
  }

  const ratingClass = (active: boolean) =>
    `min-h-10 rounded-full border px-4 text-sm font-semibold transition ${
      active ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]" : "border-[var(--panel-border)] hover:border-[var(--accent)]"
    }`;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--soft)]">Caption lab</p>
        <h1 className="text-3xl font-black sm:text-4xl">Caption your funny photos</h1>
        <p className="text-sm leading-6 text-[var(--muted)] sm:text-base">
          Got a funny photo? Upload it and the AI writes {4} captions in different humor styles. Rate them and your humor
          profile learns from it.
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

      <section aria-labelledby="pick-heading" className="glass-panel space-y-4 rounded-[24px] p-5 sm:p-6">
        <h2 id="pick-heading" className="text-lg font-bold">1. Upload a photo</h2>
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[var(--panel-border)] px-4 text-sm font-semibold transition hover:border-[var(--accent)]">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void onFile(event)} />
          {selection ? "Choose a different photo" : "Upload a photo"}
        </label>
        <p className="text-xs leading-5 text-[var(--muted)]">
          Your photo is resized in your browser and sent to OpenAI to write the captions. FunnyStudy does not store the photo,
          only the captions and your ratings. Please don&apos;t upload photos of people who haven&apos;t agreed to it.
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
            <h2 id="results-heading" className="text-lg font-bold">3. Rate the captions</h2>
            {personalized !== null && !pending ? (
              <span className="text-xs font-semibold text-[var(--muted)]">{personalized ? "Personalized for you" : "Not personalized"}</span>
            ) : null}
          </div>
          {pending ? (
            <p className="text-sm text-[var(--muted)]">Writing captions…</p>
          ) : (
            <ul className="space-y-3">
              {captions.map((caption) => (
                <li key={caption.id} className="rounded-2xl border border-[var(--panel-border)] p-4">
                  <p className="text-base font-semibold leading-6 sm:text-lg">{caption.text}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" aria-pressed={caption.rating === 1} onClick={() => void rate(caption, 1)} className={ratingClass(caption.rating === 1)}>
                      Funny
                    </button>
                    <button type="button" aria-pressed={caption.rating === -1} onClick={() => void rate(caption, -1)} className={ratingClass(caption.rating === -1)}>
                      Not for me
                    </button>
                    {caption.rating !== null ? (
                      <span className="text-xs text-[var(--muted)]">Style: {caption.styleName}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {droppedCount > 0 && !pending ? (
            <p className="text-xs text-[var(--muted)]">{droppedCount} caption{droppedCount === 1 ? " was" : "s were"} left out by our safety check.</p>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- whole image, captions above it */}
          <img src={selection.dataUrl} alt="" className="max-h-[40svh] w-full rounded-2xl border border-[var(--panel-border)] bg-[var(--surface-muted)] object-contain" />
        </section>
      ) : null}
    </div>
  );
}
