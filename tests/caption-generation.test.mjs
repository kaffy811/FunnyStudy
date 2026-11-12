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

const gen = loadModule("src/lib/caption-generation.ts");
const styles = ["playful", "sarcastic", "absurd", "deadpan", "wholesome"].map((slug, i) => ({
  id: i + 1, slug, name: slug[0].toUpperCase() + slug.slice(1), description: `${slug} humor`,
}));
const tallyOf = (rates) => rates.map(([id, chosen, shown]) => ({ style: styles[id - 1], chosen, shown }));
const fixed = () => 0;

test("chooseStyles without personalization returns 4 distinct random styles", () => {
  const picked = gen.chooseStyles({ styles, personalized: false, tally: [], feedback: null, labRatings: [], random: fixed });
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked.map((s) => s.id)).size, 4);
});

test("chooseStyles personalized ranks favorites first, keeps one exploration slot, skips disliked", () => {
  const picked = gen.chooseStyles({
    styles,
    personalized: true,
    tally: tallyOf([[1, 3, 3], [2, 0, 3], [3, 2, 3], [4, 1, 3], [5, 2, 3]]),
    feedback: { likedStyleIds: [], dislikedStyleIds: [2], comment: "", personalizationConsent: true },
    labRatings: [],
    random: fixed,
  });
  assert.deepEqual(picked.map((s) => s.slug), ["playful", "absurd", "wholesome", "deadpan"]);
});

test("chooseStyles lets lab likes and stated likes move a style up", () => {
  const picked = gen.chooseStyles({
    styles,
    personalized: true,
    tally: [],
    feedback: { likedStyleIds: [4], dislikedStyleIds: [], comment: "", personalizationConsent: true },
    labRatings: [{ styleId: 3, rating: 1 }, { styleId: 3, rating: 1 }],
    random: fixed,
  });
  assert.equal(picked[0].slug, "deadpan");
  assert.equal(picked[1].slug, "absurd");
});

test("buildCaptionMessages includes styles, image and summary only when given", () => {
  const withSummary = gen.buildCaptionMessages({ requested: styles.slice(0, 2), profileSummary: "Loves puns", imageUrl: "https://x/y.jpg" });
  const text = withSummary[1].content[0].text;
  assert.match(text, /exactly 2 captions/);
  assert.match(text, /- playful: playful humor/);
  assert.match(text, /Loves puns/);
  assert.equal(withSummary[1].content[1].image_url.url, "https://x/y.jpg");
  const plain = gen.buildCaptionMessages({ requested: styles.slice(0, 2), profileSummary: null, imageUrl: "https://x/y.jpg" });
  assert.doesNotMatch(plain[1].content[0].text, /described their sense of humor/);
  assert.match(plain[0].content, /Never identify/);
});

test("captionResponseFormat restricts styles to the requested slugs", () => {
  const format = gen.captionResponseFormat(["playful", "deadpan"]);
  assert.deepEqual(format.json_schema.schema.properties.captions.items.properties.style.enum, ["playful", "deadpan"]);
  assert.equal(format.json_schema.strict, true);
});

test("parseGeneratedCaptions keeps one valid caption per requested style", () => {
  const raw = JSON.stringify({
    captions: [
      { style: "playful", text: '  "Me at 8am"  ' },
      { style: "playful", text: "duplicate" },
      { style: "absurd", text: "not requested" },
      { style: "deadpan", text: "" },
      { style: "deadpan", text: "x".repeat(301) },
      { style: "deadpan", text: "It is Monday." },
    ],
  });
  assert.deepEqual(gen.parseGeneratedCaptions(raw, ["playful", "deadpan"]), [
    { styleSlug: "playful", text: "Me at 8am" },
    { styleSlug: "deadpan", text: "It is Monday." },
  ]);
  assert.deepEqual(gen.parseGeneratedCaptions("not json", ["playful"]), []);
  assert.deepEqual(gen.parseGeneratedCaptions({}, ["playful"]), []);
});

test("isValidUploadDataUrl accepts small JPEG/PNG/WebP data URLs only", () => {
  const body = "A".repeat(200);
  assert.equal(gen.isValidUploadDataUrl(`data:image/jpeg;base64,${body}`), true);
  assert.equal(gen.isValidUploadDataUrl(`data:image/webp;base64,${body}`), true);
  assert.equal(gen.isValidUploadDataUrl(`data:image/svg+xml;base64,${body}`), false);
  assert.equal(gen.isValidUploadDataUrl(`https://example.com/a.jpg`), false);
  assert.equal(gen.isValidUploadDataUrl(`data:image/jpeg;base64,${"A".repeat(gen.MAX_UPLOAD_DATA_URL_CHARS)}`), false);
  assert.equal(gen.isValidUploadDataUrl(null), false);
});
