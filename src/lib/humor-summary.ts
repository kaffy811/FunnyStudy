import type { HumorStyle, StyleChoice, StyleFeedback, StyleTally } from "./style-preferences";

export const HUMOR_SUMMARY_MAX = 1000;

/** A style counts as a favorite/pass only after it has appeared at least this often. */
const MIN_SHOWN = 2;

function listNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Builds a plain-language preference summary from style-check answers and
 * optional feedback. Deterministic, so the same answers always read the same.
 */
export function generateHumorSummary(input: {
  tally: StyleTally[];
  styles: HumorStyle[];
  choices: Record<number, StyleChoice>;
  totalPairs: number;
  feedback: StyleFeedback | null;
}): string {
  const { tally, styles, choices, totalPairs, feedback } = input;
  const answers = Object.values(choices);
  const answered = answers.length;
  if (answered === 0 && !feedback) {
    return "You haven't taken the humor style check yet. Answer a few comparisons and we'll summarize the kinds of jokes you like.";
  }

  const name = (id: number) => styles.find((style) => style.id === id)?.name.toLowerCase();
  const rate = (entry: StyleTally) => entry.chosen / entry.shown;
  const eligible = tally.filter((entry) => entry.shown >= MIN_SHOWN);
  const favorites = eligible.filter((entry) => rate(entry) >= 0.6).map((entry) => entry.style.name.toLowerCase());
  const passes = eligible.filter((entry) => rate(entry) <= 0.25).map((entry) => entry.style.name.toLowerCase());
  const neutral = answers.filter((choice) => choice === "neither" || choice === "no_preference").length;

  const sentences: string[] = [];
  if (answered > 0) {
    sentences.push(
      favorites.length > 0
        ? `You tend to pick ${listNames(favorites)} captions.`
        : "You don't have a clear favorite humor style yet."
    );
    if (passes.length > 0) sentences.push(`You usually pass on ${listNames(passes)} humor.`);
    if (neutral > 0 && neutral * 3 >= answered) {
      sentences.push("You often chose Neither or No preference, so many of these jokes didn't land for you.");
    }
  }
  const liked = (feedback?.likedStyleIds ?? []).map(name).filter((n): n is string => Boolean(n));
  const disliked = (feedback?.dislikedStyleIds ?? []).map(name).filter((n): n is string => Boolean(n));
  if (liked.length > 0) sentences.push(`You said you enjoy ${listNames(liked)} humor.`);
  if (disliked.length > 0) sentences.push(`You'd rather not see ${listNames(disliked)} humor.`);
  if (feedback?.comment) sentences.push(`Your note: "${feedback.comment}"`);
  if (answered > 0 && answered < totalPairs) sentences.push(`Based on ${answered} of ${totalPairs} comparisons so far.`);

  return sentences.join(" ").slice(0, HUMOR_SUMMARY_MAX);
}

export function parseHumorSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= 1 && text.length <= HUMOR_SUMMARY_MAX ? text : null;
}
