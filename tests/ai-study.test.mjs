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

test("assignStylePairs uses every style pairing once in 10 images, two different styles each", () => {
  for (let run = 0; run < 20; run += 1) {
    const pairs = study.assignStylePairs(styles, 10, seeded);
    assert.equal(pairs.length, 10);
    assert.ok(pairs.every(([a, b]) => a.id !== b.id));
    const keys = new Set(pairs.map(([a, b]) => [a.id, b.id].sort().join("-")));
    assert.equal(keys.size, 10);
    const counts = new Map();
    for (const style of pairs.flat()) counts.set(style.id, (counts.get(style.id) ?? 0) + 1);
    assert.deepEqual([...counts.values()], [4, 4, 4, 4, 4]);
  }
  assert.equal(study.assignStylePairs(styles, 12, seeded).length, 12);
  assert.deepEqual(study.assignStylePairs(styles.slice(0, 1), 3), []);
});

test("A/B choices map to ratings on both captions and back", () => {
  assert.deepEqual(study.pairPositions(3), [5, 6]);
  assert.deepEqual(study.choiceRatings("a"), [1, -1]);
  assert.deepEqual(study.choiceRatings("b"), [-1, 1]);
  assert.deepEqual(study.choiceRatings("neither"), [-1, -1]);
  assert.deepEqual(study.choiceRatings(null), [null, null]);
  for (const choice of ["a", "b", "neither", null]) {
    assert.equal(study.choiceFromRatings(...study.choiceRatings(choice)), choice);
  }
});

test("chunk splits into batches", () => {
  assert.deepEqual(study.chunk([1, 2, 3, 4, 5, 6, 7], 5), [[1, 2, 3, 4, 5], [6, 7]]);
});

test("parseStudyCaptions keeps only the requested styles per image, once each, cleaned and length-checked", () => {
  const raw = JSON.stringify({
    captions: [
      { image: 1, style: "playful", text: '  "Hello   there"  ' },
      { image: 1, style: "playful", text: "duplicate" },
      { image: 1, style: "deadpan", text: "Second" },
      { image: 1, style: "absurd", text: "not requested for image 1" },
      { image: 9, style: "playful", text: "unknown image" },
      { image: 2, style: "sarcastic", text: "x".repeat(301) },
    ],
  });
  const parsed = study.parseStudyCaptions(raw, new Map([[1, ["playful", "deadpan"]], [2, ["sarcastic", "absurd"]]]));
  assert.deepEqual([...parsed.get(1).entries()], [["playful", "Hello there"], ["deadpan", "Second"]]);
  assert.equal(parsed.has(2), false);
  assert.equal(study.parseStudyCaptions("not json", new Map([[1, ["playful"]]])).size, 0);
});

test("buildStudyCaptionMessages asks for both styles per image and only uses the summary when given", () => {
  const items = [
    { slot: 1, imageUrl: "https://x/1.jpg", styles: [styles[0], styles[3]] },
    { slot: 2, imageUrl: "https://x/2.jpg", styles: [styles[1], styles[2]] },
  ];
  const plain = study.buildStudyCaptionMessages({ items, profileSummary: null });
  const content = plain[1].content;
  assert.equal(content.filter((part) => part.type === "image_url").length, 2);
  assert.match(content[1].text, /Image 1: .*"playful".*"deadpan"/);
  assert.match(content[3].text, /Image 2: .*"sarcastic".*"absurd"/);
  assert.doesNotMatch(JSON.stringify(plain), /described their sense of humor/);
  assert.match(JSON.stringify(study.buildStudyCaptionMessages({ items, profileSummary: "Loves puns" })), /Loves puns/);
  const schema = study.studyCaptionResponseFormat([1, 2], ["playful", "deadpan"]).json_schema.schema;
  assert.deepEqual(schema.properties.captions.items.required, ["image", "style", "text"]);
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
  assert.match(text, /Playful: picked 2 of 2 times shown/);
  assert.match(text, /A caption/);
});

test("fallbackSummary names the styles that land and the ones that don't", () => {
  const text = study.fallbackSummary([
    { styleId: 1, name: "Playful", liked: 2, shown: 2 },
    { styleId: 4, name: "Deadpan", liked: 0, shown: 2 },
  ]);
  assert.equal(text, "You picked 2 of 4 AI captions you were shown so far. Playful humor lands best with you. Deadpan jokes haven't landed so far.");
  assert.match(study.fallbackSummary([]), /still forming/);
});

test("isCurrentStudy only continues an unfinished study started since the latest sign-in", () => {
  const signIn = "2026-11-12T10:00:00Z";
  assert.equal(study.isCurrentStudy({ created_datetime_utc: "2026-11-12T10:05:00Z", ended_datetime_utc: null }, signIn), true);
  assert.equal(study.isCurrentStudy({ created_datetime_utc: "2026-11-12T09:00:00Z", ended_datetime_utc: null }, signIn), false);
  assert.equal(study.isCurrentStudy({ created_datetime_utc: "2026-11-12T10:05:00Z", ended_datetime_utc: "2026-11-12T10:10:00Z" }, signIn), false);
  assert.equal(study.isCurrentStudy(null, signIn), false);
});

const userImages = loadModule("src/lib/user-images.ts");

test("user image refs, paths and data URLs", async () => {
  const profile = "11111111-2222-3333-4444-555555555555";
  assert.equal(userImages.newUserImagePath(profile, "abc", "image/png"), `${profile}/abc.png`);
  assert.equal(userImages.newUserImagePath(profile, "abc", "image/webp"), `${profile}/abc.webp`);
  assert.equal(userImages.newUserImagePath(profile, "abc", "image/jpeg"), `${profile}/abc.jpg`);
  const ref = userImages.toUserImageRef(`${profile}/abc.jpg`);
  assert.equal(userImages.userImagePath(ref), `${profile}/abc.jpg`);
  assert.equal(userImages.userImagePath("https://images.crackd.ai/x.jpg"), null);
  assert.equal(userImages.userImagePath(null), null);

  const decoded = userImages.decodeDataUrl("data:image/png;base64,AQID");
  assert.equal(decoded.contentType, "image/png");
  assert.deepEqual([...decoded.bytes], [1, 2, 3]);
  assert.equal(userImages.decodeDataUrl("not a data url"), null);

  const calls = [];
  const fakeClient = {
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths) => {
          calls.push([bucket, paths]);
          return { data: paths.map((path) => ({ path, signedUrl: `signed:${path}` })), error: null };
        },
      }),
    },
  };
  const resolved = await userImages.resolveImageUrls(fakeClient, [ref, "https://a/b.jpg", null, ref]);
  assert.deepEqual(resolved, [`signed:${profile}/abc.jpg`, "https://a/b.jpg", null, `signed:${profile}/abc.jpg`]);
  assert.deepEqual(calls, [["user-images", [`${profile}/abc.jpg`]]]);
  assert.deepEqual(await userImages.resolveImageUrls(fakeClient, ["https://a/b.jpg"]), ["https://a/b.jpg"]);
  assert.equal(calls.length, 1);
});
