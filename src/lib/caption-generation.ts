import type { HumorStyle, StyleFeedback, StyleTally } from "./style-preferences";

/** Bump when the prompt changes so ratings can be compared per prompt version. */
export const CAPTION_PROMPT_VERSION = "lab-v1";
export const CAPTIONS_PER_REQUEST = 4;
export const DAILY_CAPTION_LIMIT = 80; // 20 requests x 4 captions per rolling 24h
export const MAX_UPLOAD_DATA_URL_CHARS = 900_000; // keeps server-action bodies under Next's 1 MB default
export const UPLOAD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_CAPTION_CHARS = 300;

export type LabRating = { styleId: number; rating: -1 | 1 };
export type GeneratedCaption = { styleSlug: string; text: string };

/**
 * Picks which styles to request. Personalized: the participant's best styles
 * first (style-check pick rate, liked feedback, lab likes), disliked ones last,
 * and one other style kept for exploration. Otherwise a random mix.
 */
export function chooseStyles(input: {
  styles: HumorStyle[];
  personalized: boolean;
  tally: StyleTally[];
  feedback: StyleFeedback | null;
  labRatings: LabRating[];
  count?: number;
  random?: () => number;
}): HumorStyle[] {
  const { styles, personalized, tally, feedback, labRatings, count = CAPTIONS_PER_REQUEST, random = Math.random } = input;
  const take = Math.min(count, styles.length);
  if (!personalized) {
    const copy = [...styles];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, take);
  }

  const score = new Map(styles.map((style) => [style.id, 0]));
  for (const entry of tally) {
    if (entry.shown > 0) score.set(entry.style.id, (score.get(entry.style.id) ?? 0) + (entry.chosen / entry.shown) * 2 - 1);
  }
  for (const id of feedback?.likedStyleIds ?? []) score.set(id, (score.get(id) ?? 0) + 1.5);
  for (const id of feedback?.dislikedStyleIds ?? []) score.set(id, (score.get(id) ?? 0) - 3);
  for (const { styleId, rating } of labRatings) score.set(styleId, (score.get(styleId) ?? 0) + rating * 0.25);

  const ranked = [...styles].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || a.id - b.id);
  const disliked = new Set(feedback?.dislikedStyleIds ?? []);
  const allowed = ranked.filter((style) => !disliked.has(style.id));
  const pool = allowed.length >= take ? allowed : ranked;
  // Best (take - 1) styles plus one from the rest so preferences can keep shifting.
  const best = pool.slice(0, take - 1);
  const rest = pool.slice(take - 1);
  const explore = rest.length > 0 ? rest[Math.floor(random() * rest.length)] : undefined;
  return explore ? [...best, explore] : pool.slice(0, take);
}

export function buildCaptionMessages(input: {
  requested: HumorStyle[];
  profileSummary: string | null;
  imageUrl: string;
}) {
  const { requested, profileSummary, imageUrl } = input;
  const styleLines = requested.map((style) => `- ${style.slug}: ${style.description}`).join("\n");
  const system = [
    "You write short, funny captions for images in a university humor study.",
    "Each caption is one or two sentences, at most 200 characters, written in English.",
    "Keep it kind: no slurs, sexual content, violence, or jokes about anyone's body, race, religion, gender, disability or other protected trait.",
    "Never identify or guess the identity of real people in the image; describe them only by what they are doing.",
    "Captions should feel relatable to college students.",
  ].join(" ");
  const user = [
    `Write exactly ${requested.length} captions for this image, one in each of these humor styles:`,
    styleLines,
    profileSummary
      ? `The reader described their sense of humor like this (use it to tune the jokes, never quote it): """${profileSummary}"""`
      : "Write for a general audience.",
    "Return JSON only.",
  ].join("\n\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: user },
        { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
      ],
    },
  ];
}

export function captionResponseFormat(slugs: string[]) {
  return {
    type: "json_schema",
    json_schema: {
      name: "captions",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["captions"],
        properties: {
          captions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["style", "text"],
              properties: {
                style: { type: "string", enum: slugs },
                text: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}

/** Validates model output: known styles only, one caption per style, trimmed and length-checked. */
export function parseGeneratedCaptions(raw: unknown, allowedSlugs: readonly string[]): GeneratedCaption[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const list = (value as { captions?: unknown })?.captions;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: GeneratedCaption[] = [];
  for (const item of list) {
    const style = (item as { style?: unknown })?.style;
    const text = (item as { text?: unknown })?.text;
    if (typeof style !== "string" || typeof text !== "string") continue;
    const clean = text.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
    if (!allowedSlugs.includes(style) || seen.has(style) || clean.length === 0 || clean.length > MAX_CAPTION_CHARS) continue;
    seen.add(style);
    result.push({ styleSlug: style, text: clean });
  }
  return result;
}

/** Accepts only base64 data URLs of allowed image types within the size budget. */
export function isValidUploadDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_UPLOAD_DATA_URL_CHARS) return false;
  const match = /^data:([a-z/]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  return Boolean(match && (UPLOAD_MIME_TYPES as readonly string[]).includes(match[1]) && match[2].length > 100);
}
