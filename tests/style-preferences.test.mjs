import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadModule(path) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)(() => ({}), loaded, loaded.exports);
  return loaded.exports;
}

const { isStyleChoice, latestChoices, tallyStyles, parseStyleFeedback } = loadModule("src/lib/style-preferences.ts");

const styles = [1, 2, 3].map((id) => ({ id, slug: `s${id}`, name: `S${id}`, description: "" }));
const pair = (id, styleAId, styleBId) => ({ id, imageUrl: "x", styleAId, captionA: "a", styleBId, captionB: "b" });

test("isStyleChoice accepts only the four enum values", () => {
  for (const value of ["a", "b", "neither", "no_preference"]) assert.equal(isStyleChoice(value), true);
  for (const value of ["c", "", null, 1, "A"]) assert.equal(isStyleChoice(value), false);
});

test("latestChoices keeps the newest answer per pair and drops unknown values", () => {
  const rows = [
    { pair_id: 1, choice: "b" },
    { pair_id: 2, choice: "bogus" },
    { pair_id: 1, choice: "a" },
    { pair_id: 2, choice: "neither" },
  ];
  assert.deepEqual({ ...latestChoices(rows) }, { 1: "b", 2: "neither" });
});

test("tallyStyles counts shown/chosen and ignores unanswered pairs", () => {
  const pairs = [pair(1, 1, 2), pair(2, 1, 3), pair(3, 2, 3), pair(4, 1, 2)];
  const tally = tallyStyles(styles, pairs, { 1: "a", 2: "b", 3: "no_preference" });
  const byId = Object.fromEntries(tally.map((t) => [t.style.id, [t.shown, t.chosen]]));
  assert.deepEqual(byId, { 1: [2, 1], 2: [2, 0], 3: [2, 1] });
  assert.equal(tally.at(-1).style.id, 2, "lowest pick rate sorts last");
});

test("tallyStyles omits styles never shown", () => {
  assert.deepEqual(tallyStyles(styles, [pair(1, 1, 2)], {}), []);
});

test("parseStyleFeedback validates, dedupes and sorts", () => {
  const ok = parseStyleFeedback(
    { likedStyleIds: [3, 1, 3], dislikedStyleIds: [2], comment: "  more puns ", personalizationConsent: true },
    [1, 2, 3]
  );
  assert.deepEqual(ok, { likedStyleIds: [1, 3], dislikedStyleIds: [2], comment: "more puns", personalizationConsent: true });
});

test("parseStyleFeedback rejects overlap, unknown ids, long comments and bad shapes", () => {
  const base = { likedStyleIds: [], dislikedStyleIds: [], comment: "", personalizationConsent: false };
  assert.ok(parseStyleFeedback(base, [1, 2, 3]));
  assert.equal(parseStyleFeedback({ ...base, likedStyleIds: [1], dislikedStyleIds: [1] }, [1, 2, 3]), null);
  assert.equal(parseStyleFeedback({ ...base, likedStyleIds: [9] }, [1, 2, 3]), null);
  assert.equal(parseStyleFeedback({ ...base, comment: "x".repeat(501) }, [1, 2, 3]), null);
  assert.equal(parseStyleFeedback({ ...base, personalizationConsent: "yes" }, [1, 2, 3]), null);
  assert.equal(parseStyleFeedback(null, [1, 2, 3]), null);
});

const { generateHumorSummary, parseHumorSummary } = loadModule("src/lib/humor-summary.ts");
const named = [
  { id: 1, slug: "playful", name: "Playful", description: "" },
  { id: 2, slug: "sarcastic", name: "Sarcastic", description: "" },
  { id: 3, slug: "absurd", name: "Absurd", description: "" },
];

test("generateHumorSummary invites a first attempt when there is no data", () => {
  const text = generateHumorSummary({ tally: [], styles: named, choices: {}, totalPairs: 12, feedback: null });
  assert.match(text, /haven't taken the humor style check/);
});

test("generateHumorSummary names favorites, passes, feedback and partial progress", () => {
  const pairs = [pair(1, 1, 2), pair(2, 1, 3), pair(3, 2, 3), pair(4, 1, 2)];
  const choices = { 1: "a", 2: "a", 3: "b", 4: "a" };
  const text = generateHumorSummary({
    tally: tallyStyles(named, pairs, choices),
    styles: named,
    choices,
    totalPairs: 12,
    feedback: { likedStyleIds: [3], dislikedStyleIds: [2], comment: "More puns", personalizationConsent: false },
  });
  assert.match(text, /You tend to pick playful captions\./);
  assert.match(text, /You usually pass on sarcastic humor\./);
  assert.match(text, /You said you enjoy absurd humor\./);
  assert.match(text, /You'd rather not see sarcastic humor\./);
  assert.match(text, /Your note: "More puns"/);
  assert.match(text, /Based on 4 of 12 comparisons/);
});

test("generateHumorSummary notes frequent Neither/No preference answers", () => {
  const pairs = [pair(1, 1, 2), pair(2, 1, 3), pair(3, 2, 3)];
  const choices = { 1: "neither", 2: "no_preference", 3: "a" };
  const text = generateHumorSummary({ tally: tallyStyles(named, pairs, choices), styles: named, choices, totalPairs: 3, feedback: null });
  assert.match(text, /often chose Neither or No preference/);
  assert.doesNotMatch(text, /Based on/);
});

test("parseHumorSummary trims and enforces 1..1000 characters", () => {
  assert.equal(parseHumorSummary("  I like puns  "), "I like puns");
  assert.equal(parseHumorSummary("   "), null);
  assert.equal(parseHumorSummary("x".repeat(1001)), null);
  assert.equal(parseHumorSummary(5), null);
});

test("generateHumorSummary reports caption-lab ratings", () => {
  const text = generateHumorSummary({
    tally: [], styles: named, choices: {}, totalPairs: 12, feedback: null,
    labRatings: [{ styleId: 1, rating: 1 }, { styleId: 1, rating: 1 }, { styleId: 2, rating: -1 }],
  });
  assert.match(text, /In the caption lab you liked 2 of 3 AI captions, most often playful ones\./);
  assert.doesNotMatch(text, /haven't taken/);
});
