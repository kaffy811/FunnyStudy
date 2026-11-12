// Server-only OpenAI access. Imported only from server actions; the key is read
// from OPENAI_API_KEY at request time and never sent to the browser.

const API_BASE = "https://api.openai.com/v1";
const TIMEOUT_MS = 45_000;

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export function openAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL };
}

async function post(path: string, apiKey: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI ${path} failed with ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

export async function createChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: unknown[];
  responseFormat: unknown;
}): Promise<string> {
  const data = await post("/chat/completions", input.apiKey, {
    model: input.model,
    messages: input.messages,
    response_format: input.responseFormat,
    // Reasoning models (o-series, gpt-5) reject a custom temperature.
    ...(/^(o\d|gpt-5)/.test(input.model) ? {} : { temperature: 0.9 }),
    max_completion_tokens: /^(o\d|gpt-5)/.test(input.model) ? 4000 : 600,
  });
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI returned no caption content");
  return content;
}

/** One flagged boolean per caption text (a plain string array is scored item by item). */
export async function moderateTexts(apiKey: string, texts: string[]): Promise<boolean[]> {
  if (texts.length === 0) return [];
  const data = await post("/moderations", apiKey, { model: "omni-moderation-latest", input: texts });
  const results: { flagged?: boolean }[] = Array.isArray(data?.results) ? data.results : [];
  return texts.map((_, i) => results[i]?.flagged !== false);
}

/** Whether an image (URL or data URL) is flagged. */
export async function moderateImage(apiKey: string, url: string): Promise<boolean> {
  const data = await post("/moderations", apiKey, {
    model: "omni-moderation-latest",
    input: [{ type: "image_url", image_url: { url } }],
  });
  return data?.results?.[0]?.flagged !== false;
}
