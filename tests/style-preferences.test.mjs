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
