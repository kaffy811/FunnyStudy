"use client";

import { HeartIcon } from "@heroicons/react/24/solid";
import { useEffect, useRef } from "react";
import type { CaptionForVote } from "./CaptionVoteFlow";

type Props = {
  captions: { caption: CaptionForVote; index: number }[];
  currentIndex: number;
  voteStatuses: Record<string, string>;
  voteKey: (caption: CaptionForVote) => string | null;
  onSelect: (index: number) => void;
  onClose: () => void;
};

export function CaptionReviewDialog({ captions, currentIndex, voteStatuses, voteKey, onSelect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current;
    modal?.showModal();
    return () => { modal?.close(); previousFocus?.focus(); };
  }, []);
  return (
    <dialog ref={dialog} onCancel={onClose} aria-labelledby="caption-review-title" data-native-scroll-region="true" className="m-auto w-[calc(100%_-_2rem)] max-w-xl max-h-[85svh] overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--background)] p-0 text-[var(--foreground)] shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] p-4">
        <div><h2 id="caption-review-title" className="text-lg font-bold">Viewed captions</h2><p className="text-sm text-[var(--muted)]">This visit only · choose a caption to return to it.</p></div>
        <button type="button" autoFocus onClick={onClose} className="min-h-12 rounded-xl border border-[var(--panel-border)] px-3">Close</button>
      </div>
      <ul className="max-h-[60svh] overflow-y-auto overscroll-contain p-3" data-native-scroll-region="true">
        {captions.map(({caption, index}) => {
          const status = voteStatuses[voteKey(caption) ?? ""];
          const liked = status === "saved";
          const pending = status === "saving" || status === "removing";
          return <li key={caption.id} className="mb-2">
            <button type="button" aria-current={index === currentIndex ? "true" : undefined} onClick={() => onSelect(index)} className={`flex min-h-20 w-full items-center gap-3 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${index === currentIndex ? "border-[var(--accent)]" : "border-[var(--panel-border)]"}`}>
              {caption.imageSrc ? <img src={caption.imageSrc} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-contain" /> : <span className="w-14 shrink-0 text-center text-sm">Text</span>}
              <span className="min-w-0"><span className="flex items-center gap-1 text-xs text-[var(--muted)]">Caption {index + 1}{index === currentIndex ? " · Current" : ""}{pending ? " · Saving…" : liked ? <> · <HeartIcon aria-hidden className="h-3.5 w-3.5 text-[var(--heart-active)]" /> Liked</> : null}</span><span className="mt-1 line-clamp-2 block text-sm">{caption.content || "No caption text"}</span></span>
            </button>
          </li>;
        })}
      </ul>
    </dialog>
  );
}
