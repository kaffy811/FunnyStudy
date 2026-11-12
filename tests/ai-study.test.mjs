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

const study = loadModule("src/lib/ai-study.ts");
const styles = ["playful", "sarcastic", "absurd", "deadpan", "wholesome"].map((slug, i) => ({
  id: i + 1, slug, name: slug[0].toUpperCase() + slug.slice(1), description: `${slug} humor`,
}));
let seed = 7;
const seeded = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("assignStyles gives each of 5 styles exactly 2 of 10 slots", () => {
  for (let run = 0; run < 20; run += 1) {
    const counts = new Map();
    for (const style of study.assignStyles(styles, 10, seeded)) counts.set(style.id, (counts.get(style.id) ?? 0) + 1);
    assert.deepEqual([...counts.values()].sort(), [2, 2, 2, 2, 2]);
  }
});

test("assignStyles spreads a remainder over distinct styles", () => {
  const picked = study.assignStyles(styles, 7, seeded);
  assert.equal(picked.length, 7);
  const counts = new Map();
  for (const style of picked) counts.set(style.id, (counts.get(style.id) ?? 0) + 1);
  assert.equal(counts.size, 5);
  assert.ok([...counts.values()].every((n) => n === 1 || n === 2));
  assert.deepEqual(study.assignStyles([], 5), []);
});

test("chunk splits into batches", () => {
  assert.deepEqual(study.chunk([1, 2, 3, 4, 5, 6, 7], 5), [[1, 2, 3, 4, 5], [6, 7]]);
});

test("parseStudyCaptions keeps known slots once, cleans and length-checks text", () => {
  const raw = JSON.stringify({
    captions: [
      { image: 1, text: '  "Hello   there"  ' },
      { image: 1, text: "duplicate" },
      { image: 9, text: "unknown slot" },
      { image: 2, text: "x".repeat(301) },
      { image: 3, text: "Fine" },
    ],
  });
  const parsed = study.parseStudyCaptions(raw, [1, 2, 3]);
  assert.deepEqual([...parsed.entries()], [[1, "Hello there"], [3, "Fine"]]);
  assert.equal(study.parseStudyCaptions("not json", [1]).size, 0);
});

test("buildStudyCaptionMessages sends each image with its assigned style and only the summary when given", () => {
  const items = [
    { slot: 1, imageUrl: "https://x/1.jpg", style: styles[0] },
    { slot: 2, imageUrl: "https://x/2.jpg", style: styles[3] },
  ];
  const plain = study.buildStudyCaptionMessages({ items, profileSummary: null });
  const content = plain[1].content;
  assert.equal(content.filter((part) => part.type === "image_url").length, 2);
  assert.match(content[1].text, /Image 1: style "playful"/);
  assert.match(content[3].text, /Image 2: style "deadpan"/);
  assert.doesNotMatch(JSON.stringify(plain), /described their sense of humor/);
  const tuned = study.buildStudyCaptionMessages({ items, profileSummary: "Loves puns" });
  assert.match(JSON.stringify(tuned), /Loves puns/);
});

test("styleStats counts viewed or rated captions and Funny taps per style", () => {
  const stats = study.styleStats(styles, [
    { styleId: 1, viewed: true, rating: 1 },
    { styleId: 1, viewed: true, rating: null },
    { styleId: 2, viewed: true, rating: null },
    { styleId: 3, viewed: false, rating: null }, // never seen
    { styleId: 4, viewed: false, rating: -1 }, // lab "not for me"
  ]);
  assert.deepEqual(
    stats.map((s) => [s.name, s.liked, s.shown]),
    [["Playful", 1, 2], ["Sarcastic", 0, 1], ["Deadpan", 0, 1]]
  );
});

test("parseSummary accepts trimmed text up to 1000 characters", () => {
  assert.equal(study.parseSummary(JSON.stringify({ summary: "  You like   puns. " })), "You like puns.");
  assert.equal(study.parseSummary(JSON.stringify({ summary: "x".repeat(1001) })), null);
  assert.equal(study.parseSummary("{}"), null);
});

test("buildSummaryMessages keeps a participant-written description", () => {
  const messages = study.buildSummaryMessages({
    stats: [{ styleId: 1, name: "Playful", liked: 2, shown: 2 }],
    likedCaptions: ["A caption"],
    previousSummary: "I like dry jokes",
    previousByParticipant: true,
    studyCount: 2,
  });
  const text = messages[1].content;
  assert.match(text, /wrote this description themselves/);
  assert.match(text, /Playful: liked 2 of 2/);
  assert.match(text, /A caption/);
});

test("fallbackSummary names the styles that land and the ones that don't", () => {
  const text = study.fallbackSummary([
    { styleId: 1, name: "Playful", liked: 2, shown: 2 },
    { styleId: 4, name: "Deadpan", liked: 0, shown: 2 },
  ]);
  assert.equal(text, "You found 2 of 4 AI captions funny so far. Playful humor lands best with you. Deadpan jokes haven't landed so far.");
  assert.match(study.fallbackSummary([]), /still forming/);
});

test("isCurrentStudy only continues an unfinished study started since the latest sign-in", () => {
  const signIn = "2026-11-12T10:00:00Z";
  assert.equal(study.isCurrentStudy({ created_datetime_utc: "2026-11-12T10:05:00Z", ended_datetime_utc: null }, signIn), true);
  assert.equal(study.isCurrentStudy({ created_datetime_utc: "2026-11-12T09:00:00Z", ended_datetime_utc: null }, signIn), false);
  assert.equal(study.isCurrentStudy({ created_datetime_utc: "2026-11-12T10:05:00Z", ended_datetime_utc: "2026-11-12T10:10:00Z" }, signIn), false);
  assert.equal(study.isCurrentStudy(null, signIn), false);
});
