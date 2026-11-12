// AI studies: pure helpers (no runtime imports so tests can load this file directly).

/** Bump when a prompt changes so results can be compared per prompt version. */
export const AI_STUDY_PROMPT_VERSION = "study-v1";
export const AI_STUDY_SIZE = 10;
export const AI_STUDY_BATCH_SIZE = 5;
/** Images requested from the pool; extra ones replace images that fail moderation. */
export const AI_STUDY_CANDIDATES = 16;
export const DAILY_AI_STUDY_LIMIT = 5;
export const AI_SUMMARY_MAX = 1000;
const MAX_CAPTION_CHARS = 300;

export type StudyStyle = { id: number; slug: string; name: string; description: string };
export type StyleStat = { styleId: number; name: string; shown: number; liked: number };
export type CaptionSignal = { styleId: number; viewed: boolean; rating: -1 | 1 | null };

/**
 * Assigns styles to `count` slots as evenly as possible (each style count/n
 * times, remainder spread at random), then shuffles. This is the A/B design:
 * styles are assigned by the system, never by personalization.
 */
export function assignStyles<T>(styles: readonly T[], count: number, random: () => number = Math.random): T[] {
  if (styles.length === 0 || count <= 0) return [];
  const slots: T[] = [];
  for (let i = 0; i < Math.floor(count / styles.length); i += 1) slots.push(...styles);
  const extra = shuffle([...styles], random).slice(0, count % styles.length);
  return shuffle([...slots, ...extra], random);
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One request covering several images, each with the style it must be written in. */
export function buildStudyCaptionMessages(input: {
  items: { slot: number; imageUrl: string; style: StudyStyle }[];
  profileSummary: string | null;
}) {
  const { items, profileSummary } = input;
  const system = [
    "You write short, funny captions for images in a university humor study.",
    "Each caption is one or two sentences, at most 200 characters, written in English.",
    "Keep it kind: no slurs, sexual content, violence, or jokes about anyone's body, race, religion, gender, disability or other protected trait.",
    "Never identify or guess the identity of real people in an image; describe them only by what they are doing.",
    "Captions should feel relatable to college students.",
    "Write each caption in exactly the humor style assigned to its image, even if another style seems funnier.",
  ].join(" ");
  const intro = [
    `Write one caption for each of the ${items.length} images below, in the humor style given for that image.`,
    profileSummary
      ? `The reader described their sense of humor like this (use it only to tune wording, never change the assigned style, never quote it): """${profileSummary}"""`
      : "Write for a general audience.",
    "Return JSON only, with the image number for each caption.",
  ].join("\n\n");
  const content: unknown[] = [{ type: "text", text: intro }];
  for (const item of items) {
    content.push({ type: "text", text: `Image ${item.slot}: style "${item.style.slug}" (${item.style.description}).` });
    content.push({ type: "image_url", image_url: { url: item.imageUrl, detail: "low" } });
  }
  return [
    { role: "system", content: system },
    { role: "user", content },
  ];
}

export function studyCaptionResponseFormat(slots: number[]) {
  return {
    type: "json_schema",
    json_schema: {
      name: "study_captions",
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
              required: ["image", "text"],
              properties: { image: { type: "integer", enum: slots }, text: { type: "string" } },
            },
          },
        },
      },
    },
  };
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function cleanCaption(text: string) {
  return text.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
}

/** Caption text per image slot; unknown slots, duplicates and bad lengths are dropped. */
export function parseStudyCaptions(raw: unknown, slots: readonly number[]): Map<number, string> {
  const list = (parseJson(raw) as { captions?: unknown })?.captions;
  const result = new Map<number, string>();
  if (!Array.isArray(list)) return result;
  for (const item of list) {
    const slot = (item as { image?: unknown })?.image;
    const text = (item as { text?: unknown })?.text;
    if (typeof slot !== "number" || typeof text !== "string" || !slots.includes(slot) || result.has(slot)) continue;
    const clean = cleanCaption(text);
    if (clean.length > 0 && clean.length <= MAX_CAPTION_CHARS) result.set(slot, clean);
  }
  return result;
}

/**
 * Per-style A/B tally. A caption counts as shown once it was viewed or rated;
 * liked means a Funny tap (rating 1). Sorted by like rate, then volume.
 */
export function styleStats(styles: readonly StudyStyle[], signals: readonly CaptionSignal[]): StyleStat[] {
  const stats = new Map(styles.map((style) => [style.id, { styleId: style.id, name: style.name, shown: 0, liked: 0 }]));
  for (const signal of signals) {
    const entry = stats.get(signal.styleId);
    if (!entry || !(signal.viewed || signal.rating !== null)) continue;
    entry.shown += 1;
    if (signal.rating === 1) entry.liked += 1;
  }
  return [...stats.values()]
    .filter((entry) => entry.shown > 0)
    .sort((a, b) => b.liked / b.shown - a.liked / a.shown || b.shown - a.shown || a.styleId - b.styleId);
}

export function buildSummaryMessages(input: {
  stats: StyleStat[];
  likedCaptions: string[];
  previousSummary: string | null;
  previousByParticipant: boolean;
  studyCount: number;
}) {
  const { stats, likedCaptions, previousSummary, previousByParticipant, studyCount } = input;
  const statLines = stats.map((s) => `- ${s.name}: liked ${s.liked} of ${s.shown} shown`).join("\n") || "- no data yet";
  const system = [
    "You describe a person's sense of humor for a university humor study, in 2 to 4 short sentences of plain English, addressed to them as \"you\".",
    "Base it only on the data given. Mention which humor styles land best and which don't, with no percentages unless they help.",
    "If the data is thin, say the picture is still forming. Never mention names, emails or anything identifying.",
    `Stay under ${AI_SUMMARY_MAX - 200} characters.`,
  ].join(" ");
  const user = [
    `Across ${studyCount} AI ${studyCount === 1 ? "study" : "studies"} and the caption lab, this is how often each humor style got a Funny tap:`,
    statLines,
    likedCaptions.length > 0
      ? `Captions they found funny in the study that just ended:\n${likedCaptions.map((c) => `- ${c}`).join("\n")}`
      : "They didn't tap Funny on any caption in the study that just ended.",
    previousSummary
      ? previousByParticipant
        ? `They wrote this description themselves. Keep what they said unless the data clearly contradicts it, and update it:\n"""${previousSummary}"""`
        : `The previous description was:\n"""${previousSummary}"""\nUpdate it with the new data.`
      : "There is no previous description.",
    "Return JSON only.",
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export const summaryResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "humor_summary",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string" } },
    },
  },
};

export function parseSummary(raw: unknown): string | null {
  const summary = (parseJson(raw) as { summary?: unknown })?.summary;
  if (typeof summary !== "string") return null;
  const text = summary.replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= AI_SUMMARY_MAX ? text : null;
}

function listNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Rule-based summary used when the AI is unavailable. */
export function fallbackSummary(stats: StyleStat[]): string {
  const total = stats.reduce((sum, s) => sum + s.shown, 0);
  const liked = stats.reduce((sum, s) => sum + s.liked, 0);
  if (total === 0) return "Your humor profile is still forming. Finish a study and we'll describe what you find funny.";
  const eligible = stats.filter((s) => s.shown >= 2);
  const favorites = eligible.filter((s) => s.liked / s.shown >= 0.5).map((s) => s.name.toLowerCase());
  const passes = eligible.filter((s) => s.liked === 0).map((s) => s.name.toLowerCase());
  const sentences = [`You found ${liked} of ${total} AI captions funny so far.`];
  sentences.push(favorites.length > 0 ? `${listNames(favorites)} humor lands best with you.` : "No humor style stands out yet.");
  if (passes.length > 0) sentences.push(`${listNames(passes)} jokes haven't landed so far.`);
  return sentences.map((sentence) => sentence.charAt(0).toUpperCase() + sentence.slice(1)).join(" ");
}

/** The study to continue: the newest unfinished one started since the latest sign-in. */
export function isCurrentStudy(
  session: { created_datetime_utc: string; ended_datetime_utc: string | null } | null | undefined,
  lastSignInAt: string | null | undefined
) {
  if (!session || session.ended_datetime_utc) return false;
  if (!lastSignInAt) return true;
  return Date.parse(session.created_datetime_utc) >= Date.parse(lastSignInAt);
}
