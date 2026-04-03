import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadGeminiKeys, addGeminiKey } from "./db.js";
import { openrouter as _orClient } from "@workspace/integrations-openrouter-ai";
import { openai as _oaiClient } from "@workspace/integrations-openai-ai-server";

// Personal OpenRouter streaming helper — uses OPENROUTER_API_KEY directly via fetch
async function _streamPersonalOR(
  model: string,
  messages: Array<{ role: string; content: string }>,
  onChunk: (t: string) => void,
  maxTokens = 8192
): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://reposcope.replit.app",
      "X-Title": "RepoScope",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages, stream: true }),
  });

  if (!res.ok) throw new Error(`OpenRouter personal: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("OpenRouter personal: no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) onChunk(text);
      } catch { /* skip malformed */ }
    }
  }
}

class GeminiKeyPool {
  private keys: string[];
  private clients: GoogleGenerativeAI[];
  private cooldown: Map<number, number> = new Map();
  private currentIdx = 0;
  private readonly COOLDOWN_MS = 60_000;

  constructor(keys: string[]) {
    this.keys = keys.filter(Boolean);
    this.clients = this.keys.map(k => new GoogleGenerativeAI(k));
  }

  get size() { return this.keys.length; }
  get hasKeys() { return this.keys.length > 0; }

  getNext(): { client: GoogleGenerativeAI; idx: number; key: string } | null {
    if (this.keys.length === 0) return null;
    const now = Date.now();
    const start = this.currentIdx;

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (start + i) % this.keys.length;
      const cooldownUntil = this.cooldown.get(idx) ?? 0;
      if (now >= cooldownUntil) {
        this.currentIdx = (idx + 1) % this.keys.length;
        return { client: this.clients[idx], idx, key: this.keys[idx] };
      }
    }
    let soonest = 0;
    let soonestTime = Infinity;
    for (let i = 0; i < this.keys.length; i++) {
      const t = this.cooldown.get(i) ?? 0;
      if (t < soonestTime) { soonestTime = t; soonest = i; }
    }
    return { client: this.clients[soonest], idx: soonest, key: this.keys[soonest] };
  }

  setKeys(keys: string[]) {
    const fresh = keys.filter(Boolean);
    if (fresh.length === 0) return;
    this.keys = fresh;
    this.clients = fresh.map(k => new GoogleGenerativeAI(k));
    this.cooldown = new Map();
    this.currentIdx = 0;
    console.log(`[GeminiPool] Pool updated: ${fresh.length} key(s) active`);
  }

  get allKeys(): string[] { return [...this.keys]; }

  markExhausted(idx: number) {
    this.cooldown.set(idx, Date.now() + this.COOLDOWN_MS);
    console.warn(`[GeminiPool] Key #${idx + 1} exhausted — cooling down for ${this.COOLDOWN_MS / 1000}s`);
  }

  static isQuotaError(err: unknown): boolean {
    const msg = String(err instanceof Error ? err.message : err).toLowerCase();
    return msg.includes("429") || msg.includes("quota") || msg.includes("rate") ||
           msg.includes("resource_exhausted") || msg.includes("too many requests") ||
           msg.includes("resourceexhausted");
  }

  async run<T>(fn: (client: GoogleGenerativeAI, keyIdx: number) => Promise<T>): Promise<T> {
    const tried = new Set<number>();

    while (tried.size < this.keys.length) {
      const slot = this.getNext();
      if (!slot) throw new Error("GeminiPool: no keys configured");
      if (tried.has(slot.idx)) break;
      tried.add(slot.idx);

      try {
        return await fn(slot.client, slot.idx);
      } catch (err) {
        if (GeminiKeyPool.isQuotaError(err)) {
          this.markExhausted(slot.idx);
          continue;
        }
        throw err;
      }
    }
    throw new Error("GeminiPool: all keys exhausted or quota exceeded");
  }

  status() {
    const now = Date.now();
    return this.keys.map((_, i) => {
      const cd = this.cooldown.get(i) ?? 0;
      return { key: `key_${i + 1}`, status: now >= cd ? "ready" : "cooling", resumesIn: Math.max(0, Math.round((cd - now) / 1000)) };
    });
  }
}

function _envKeys(): string[] {
  return [
    process.env.GEMINI_API_KEY   ?? process.env.GOOGLE_API_KEY,
    process.env.GEMINI_API_KEY_2 ?? process.env.GOOGLE_API_KEY_2,
    process.env.GEMINI_API_KEY_3 ?? process.env.GOOGLE_API_KEY_3,
    process.env.GEMINI_API_KEY_4 ?? process.env.GOOGLE_API_KEY_4,
    process.env.GEMINI_API_KEY_5 ?? process.env.GOOGLE_API_KEY_5,
    process.env.GEMINI_API_KEY_6 ?? process.env.GOOGLE_API_KEY_6,
  ].filter(Boolean) as string[];
}

const _geminiPool = new GeminiKeyPool(_envKeys());

export async function syncGeminiPool(): Promise<void> {
  try {
    const envKeys = _envKeys();
    for (let i = 0; i < envKeys.length; i++) {
      await addGeminiKey(envKeys[i], `env_key_${i + 1}`).catch(() => {});
    }
    const dbKeys = await loadGeminiKeys();
    if (dbKeys.length > 0) {
      _geminiPool.setKeys(dbKeys);
      console.log(`[GeminiPool] Loaded ${dbKeys.length} key(s) from DB`);
    }
  } catch (err) {
    console.error("[GeminiPool] syncGeminiPool error:", err);
  }
}

export { _geminiPool };

export const ENGINE_F = {
  PRO_LATEST:   "gemini-2.5-pro",
  PRO_3:        "gemini-2.5-pro",
  FLASH_3:      "gemini-2.5-flash",
  PRO_25:       "gemini-2.5-pro",
  FLASH_25:     "gemini-2.5-flash",
  FLASH_LITE:   "gemini-2.5-flash-lite-preview-06-17",
} as const;

export const ENGINE_C = {
  PRIMARY:   "openai/gpt-4o-mini",
  SECONDARY: "openai/gpt-4.1-mini",
  TERTIARY:  "mistralai/mistral-nemo",
  FALLBACK:  "meta-llama/llama-3.1-8b-instruct",
} as const;

export const ENGINE_D = {
  PRIMARY:   "openai/gpt-5.3-codex",
  SECONDARY: "deepseek/deepseek-r1",
  TERTIARY:  "deepseek/deepseek-chat-v3-0324",
  FALLBACK:  "openai/gpt-4.1",
} as const;

export const ENGINE_E = {
  PRIMARY:   "openai/gpt-5.3-codex",
  SECONDARY: "deepseek/deepseek-chat-v3-0324",
  TERTIARY:  "qwen/qwen-2.5-coder-32b-instruct",
  PREMIUM:   "openai/gpt-5.1-codex-mini",
  FALLBACK:  "openai/gpt-4.1-mini",
} as const;

export const ENGINE_B = {
  PRIMARY:   "gpt-4.1",
  SECONDARY: "gpt-4o",
  TERTIARY:  "gpt-4.1-mini",
  FALLBACK:  "gpt-4o-mini",
} as const;

export interface ORResult {
  content: string;
  model: string;
  engine: "C" | "D" | "E" | "F";
}

async function orCreate(model: string, messages: { role: string; content: string }[], maxTokens: number, stream?: false): Promise<string>;
async function orCreate(model: string, messages: { role: string; content: string }[], maxTokens: number, stream: true): Promise<AsyncIterable<{ choices: { delta: { content?: string } }[] }>>;
async function orCreate(model: string, messages: { role: string; content: string }[], maxTokens: number, stream?: boolean): Promise<unknown> {
  if (stream) {
    const resp = await _orClient.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: messages as { role: "user" | "assistant" | "system"; content: string }[],
      stream: true,
    });
    return (async function* () {
      for await (const chunk of resp) {
        yield chunk;
      }
    })();
  }
  const resp = await _orClient.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: messages as { role: "user" | "assistant" | "system"; content: string }[],
    stream: false,
  });
  return resp.choices[0]?.message?.content ?? "";
}

export async function engineF(
  prompt: string,
  system: string,
  maxTokens = 8192,
  modelOverride?: string
): Promise<ORResult> {
  if (!_geminiPool.hasKeys) throw new Error("Engine F: no GEMINI_API_KEY set");

  const modelOrder = modelOverride
    ? [modelOverride]
    : [ENGINE_F.PRO_LATEST, ENGINE_F.FLASH_3, ENGINE_F.FLASH_25];

  for (const modelName of modelOrder) {
    try {
      const content = await _geminiPool.run(async (client) => {
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: system,
          generationConfig: { maxOutputTokens: maxTokens },
        });
        const result = await model.generateContent(prompt);
        return result.response.text();
      });
      if (content.trim().length > 10) return { content, model: modelName, engine: "F" };
    } catch (e) {
      if (GeminiKeyPool.isQuotaError(e)) throw e;
      continue;
    }
  }
  throw new Error("Engine F: all Gemini models failed");
}

export async function engineFfast(
  prompt: string,
  system: string,
  maxTokens = 8192
): Promise<ORResult> {
  if (!_geminiPool.hasKeys) throw new Error("Engine F: no GEMINI_API_KEY set");

  const models = [ENGINE_F.FLASH_3, ENGINE_F.FLASH_25, ENGINE_F.FLASH_LITE, ENGINE_F.PRO_25];
  for (const modelName of models) {
    try {
      const content = await _geminiPool.run(async (client) => {
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: system,
          generationConfig: { maxOutputTokens: maxTokens },
        });
        const result = await model.generateContent(prompt);
        return result.response.text();
      });
      if (content.trim().length > 10) return { content, model: modelName, engine: "F" };
    } catch (e) {
      if (GeminiKeyPool.isQuotaError(e)) throw e;
      continue;
    }
  }
  return engineF(prompt, system, maxTokens);
}

export async function streamEngineF(
  prompt: string,
  system: string,
  onChunk: (text: string) => void,
  maxTokens = 65536
): Promise<{ model: string; engine: "F" }> {
  if (!_geminiPool.hasKeys) throw new Error("Engine F: no GEMINI_API_KEY set");

  const models = [ENGINE_F.PRO_LATEST, ENGINE_F.FLASH_3, ENGINE_F.FLASH_25];

  for (const modelName of models) {
    const tried = new Set<number>();
    while (tried.size < _geminiPool.size) {
      const slot = _geminiPool.getNext();
      if (!slot || tried.has(slot.idx)) break;
      tried.add(slot.idx);
      try {
        const model = slot.client.getGenerativeModel({
          model: modelName,
          systemInstruction: system,
          generationConfig: { maxOutputTokens: maxTokens },
        });
        const result = await model.generateContentStream(prompt);
        let hasContent = false;
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) { onChunk(text); hasContent = true; }
        }
        if (hasContent) return { model: modelName, engine: "F" };
        break;
      } catch (err) {
        if (GeminiKeyPool.isQuotaError(err)) { _geminiPool.markExhausted(slot.idx); continue; }
        break;
      }
    }
  }
  throw new Error("Engine F streaming: all Gemini models and keys failed");
}

export async function streamEngineFfast(
  prompt: string,
  system: string,
  onChunk: (text: string) => void,
  maxTokens = 65536
): Promise<{ model: string; engine: "F" }> {
  if (!_geminiPool.hasKeys) throw new Error("Engine F: no GEMINI_API_KEY set");

  const models = [ENGINE_F.FLASH_3, ENGINE_F.FLASH_25, ENGINE_F.FLASH_LITE, ENGINE_F.PRO_25];
  for (const modelName of models) {
    const tried = new Set<number>();
    while (tried.size < _geminiPool.size) {
      const slot = _geminiPool.getNext();
      if (!slot || tried.has(slot.idx)) break;
      tried.add(slot.idx);
      try {
        const model = slot.client.getGenerativeModel({
          model: modelName,
          systemInstruction: system,
          generationConfig: { maxOutputTokens: maxTokens },
        });
        const result = await model.generateContentStream(prompt);
        let hasContent = false;
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) { onChunk(text); hasContent = true; }
        }
        if (hasContent) return { model: modelName, engine: "F" };
        break;
      } catch (err) {
        if (GeminiKeyPool.isQuotaError(err)) { _geminiPool.markExhausted(slot.idx); continue; }
        break;
      }
    }
  }
  return streamEngineF(prompt, system, onChunk, maxTokens);
}

export async function engineC(
  prompt: string,
  system: string,
  maxTokens = 8192
): Promise<ORResult> {
  const models = [ENGINE_C.PRIMARY, ENGINE_C.SECONDARY, ENGINE_C.TERTIARY, ENGINE_C.FALLBACK];
  for (const model of models) {
    try {
      const content = await orCreate(model, [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], maxTokens);
      if (content.trim().length > 10) return { content, model, engine: "C" };
    } catch { continue; }
  }
  throw new Error("Engine C: all models failed");
}

export async function engineD(
  prompt: string,
  system: string,
  maxTokens = 8192
): Promise<ORResult> {
  const models = [ENGINE_D.PRIMARY, ENGINE_D.SECONDARY, ENGINE_D.TERTIARY, ENGINE_D.FALLBACK];
  for (const model of models) {
    try {
      const content = await orCreate(model, [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], maxTokens);
      if (content.trim().length > 10) return { content, model, engine: "D" };
    } catch { continue; }
  }
  throw new Error("Engine D: all models failed");
}

export async function engineE(
  prompt: string,
  system: string,
  maxTokens = 8192
): Promise<ORResult> {
  const models = [ENGINE_E.PRIMARY, ENGINE_E.SECONDARY, ENGINE_E.TERTIARY, ENGINE_E.PREMIUM, ENGINE_E.FALLBACK];
  for (const model of models) {
    try {
      const content = await orCreate(model, [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], maxTokens);
      if (content.trim().length > 10) return { content, model, engine: "E" };
    } catch { continue; }
  }
  throw new Error("Engine E: all models failed");
}

export async function streamEngineD(
  prompt: string,
  system: string,
  onChunk: (text: string) => void,
  maxTokens = 8192
): Promise<{ model: string; engine: "D" }> {
  const models = [ENGINE_D.PRIMARY, ENGINE_D.SECONDARY, ENGINE_D.TERTIARY, ENGINE_D.FALLBACK];
  for (const model of models) {
    try {
      const stream = await orCreate(model, [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], maxTokens, true);
      let hasContent = false;
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) { onChunk(text); hasContent = true; }
      }
      if (hasContent) return { model, engine: "D" };
    } catch { continue; }
  }
  throw new Error("Engine D streaming: all models failed");
}

export async function streamEngineE(
  prompt: string,
  system: string,
  onChunk: (text: string) => void,
  maxTokens = 8192
): Promise<{ model: string; engine: "E" }> {
  const models = [ENGINE_E.PRIMARY, ENGINE_E.SECONDARY, ENGINE_E.TERTIARY, ENGINE_E.PREMIUM, ENGINE_E.FALLBACK];
  for (const model of models) {
    try {
      const stream = await orCreate(model, [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], maxTokens, true);
      let hasContent = false;
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) { onChunk(text); hasContent = true; }
      }
      if (hasContent) return { model, engine: "E" };
    } catch { continue; }
  }
  throw new Error("Engine E streaming: all models failed");
}

export async function streamEngineB(
  prompt: string,
  system: string,
  onChunk: (text: string) => void,
  maxTokens = 8192
): Promise<{ model: string; engine: "B" }> {
  const models = [ENGINE_B.PRIMARY, ENGINE_B.SECONDARY, ENGINE_B.TERTIARY, ENGINE_B.FALLBACK];
  for (const model of models) {
    try {
      const stream = await _oaiClient.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        stream: true,
      });
      let hasContent = false;
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) { onChunk(text); hasContent = true; }
      }
      if (hasContent) return { model, engine: "B" };
    } catch { continue; }
  }
  throw new Error("Engine B streaming: all OpenAI models failed");
}

export async function engineB(
  prompt: string,
  system: string,
  maxTokens = 8192
): Promise<ORResult> {
  const models = [ENGINE_B.PRIMARY, ENGINE_B.SECONDARY, ENGINE_B.TERTIARY, ENGINE_B.FALLBACK];
  for (const model of models) {
    try {
      const resp = await _oaiClient.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        stream: false,
      });
      const content = resp.choices[0]?.message?.content ?? "";
      if (content) return { content, model, engine: "D" };
    } catch { continue; }
  }
  throw new Error("Engine B: all OpenAI models failed");
}

function isOpenAIConfigured(): boolean {
  return !!(
    (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) ||
    process.env.OPENAI_API_KEY
  );
}

export async function ensembleDE(
  prompt: string,
  system: string,
  maxTokens = 4096
): Promise<ORResult> {
  const [resultD, resultE] = await Promise.allSettled([
    engineD(prompt, system, maxTokens),
    engineE(prompt, system, maxTokens),
  ]);
  const outputs: string[] = [];
  if (resultD.status === "fulfilled") outputs.push(resultD.value.content);
  if (resultE.status === "fulfilled") outputs.push(resultE.value.content);
  if (outputs.length === 0) throw new Error("Ensemble D+E: all failed");
  if (outputs.length === 1) return { content: outputs[0], model: "ensemble-single", engine: "D" };
  const mergePrompt = `Merge the best insights from both AI responses into one comprehensive answer:\n\nResponse A:\n${outputs[0]}\n\nResponse B:\n${outputs[1]}\n\nMerged:`;
  try {
    const merged = await orCreate(ENGINE_C.SECONDARY, [{ role: "user", content: mergePrompt }], maxTokens);
    return { content: merged, model: "ensemble-D+E", engine: "D" };
  } catch {
    return { content: outputs[0], model: "ensemble-fallback", engine: "D" };
  }
}

export const IMAGEN_MODELS = {
  FAST:     "imagen-4.0-fast-generate-001",
  STANDARD: "imagen-4.0-generate-001",
  ULTRA:    "imagen-4.0-ultra-generate-001",
  GEMINI_FLASH: "gemini-2.5-flash",
  GEMINI_PRO:   "gemini-2.5-pro",
  GEMINI_FLASH2:"gemini-2.5-flash",
} as const;

export interface ImageResult {
  images: { base64: string; mimeType: string; index: number }[];
  model: string;
}

export async function generateImage(
  prompt: string,
  options: {
    quality?: "fast" | "standard" | "ultra";
    aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    count?: number;
  } = {}
): Promise<ImageResult> {
  const { quality = "standard", aspectRatio = "1:1", count = 1 } = options;

  const modelMap = { fast: IMAGEN_MODELS.FAST, standard: IMAGEN_MODELS.STANDARD, ultra: IMAGEN_MODELS.ULTRA };
  const modelOrder = [modelMap[quality], IMAGEN_MODELS.FAST, IMAGEN_MODELS.STANDARD];

  const allKeys = _geminiPool.allKeys;

  for (const imagenModel of modelOrder) {
    for (const apiKey of allKeys) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${imagenModel}:predict?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instances: [{ prompt }],
              parameters: { sampleCount: count, aspectRatio },
            }),
          }
        );

        if (!resp.ok) {
          const errText = await resp.text();
          if (resp.status === 429 || errText.toLowerCase().includes("quota") || errText.toLowerCase().includes("resource_exhausted")) {
            continue;
          }
          throw new Error(`Imagen API ${resp.status}: ${errText.slice(0, 100)}`);
        }

        const data = await resp.json() as { predictions: { bytesBase64Encoded: string; mimeType: string }[] };
        const images = (data.predictions || []).map((p, i) => ({
          base64: p.bytesBase64Encoded,
          mimeType: p.mimeType || "image/png",
          index: i,
        }));

        if (images.length > 0) return { images, model: imagenModel };
      } catch (e) {
        if (GeminiKeyPool.isQuotaError(e)) continue;
        break;
      }
    }
  }

  try {
    const result = await _geminiPool.run(async (client) => {
      const gemModel = client.getGenerativeModel({ model: IMAGEN_MODELS.GEMINI_FLASH2 });
      return gemModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as any,
      });
    });
    const parts = result.response.candidates?.[0]?.content?.parts || [];
    const images = parts
      .filter((p: any) => p.inlineData)
      .map((p: any, i: number) => ({ base64: p.inlineData.data, mimeType: p.inlineData.mimeType, index: i }));
    if (images.length > 0) return { images, model: IMAGEN_MODELS.GEMINI_FLASH2 };
  } catch { /* all keys exhausted */ }

  throw new Error("Image generation: all keys and models failed");
}

export const freeCompletion = engineFfast;
export const cheapCompletion = engineE;
export const ensembleCompletion = ensembleDE;

// ─── Runtime AI — Gemini Pool → Personal OpenRouter ──────────────────────────
// Used for: analyze, compare, chat, code-analyze
const RUNTIME_OR_MODELS = [
  "deepseek/deepseek-r1",
  "deepseek/deepseek-chat-v3-0324",
  "openai/gpt-4.1",
] as const;

export async function streamRuntimeAI(
  prompt: string,
  system: string,
  onChunk: (t: string) => void,
  maxTokens = 8192
): Promise<{ model: string }> {
  // 1. Try Gemini pool (6 personal keys)
  if (_geminiPool.hasKeys) {
    try {
      return await streamEngineFfast(prompt, system, onChunk, maxTokens);
    } catch { /* fall through */ }
    try {
      return await streamEngineF(prompt, system, onChunk, maxTokens);
    } catch { /* fall through */ }
  }

  // 2. Fallback: personal OpenRouter key (free tier)
  if (process.env.OPENROUTER_API_KEY) {
    for (const model of RUNTIME_OR_MODELS) {
      try {
        await _streamPersonalOR(
          model,
          [{ role: "system", content: system }, { role: "user", content: prompt }],
          onChunk,
          maxTokens
        );
        return { model };
      } catch { /* try next */ }
    }
  }

  throw new Error("Runtime AI unavailable: no Gemini keys or personal OpenRouter key configured.");
}

// ─── Codex 5.3 — Editing Engine ──────────────────────────────────────────────
const CODEX_MODEL = "openai/gpt-5.3-codex";

/**
 * Stream a response using ONLY Codex 5.3 via Replit OpenRouter integration.
 */
export async function streamCodex53(
  prompt: string,
  system: string,
  onChunk: (t: string) => void,
  maxTokens = 8192
): Promise<{ model: string }> {
  const stream = await _orClient.chat.completions.create({
    model: CODEX_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    stream: true,
  });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) onChunk(text);
  }
  return { model: CODEX_MODEL };
}

/**
 * Non-streaming completion using ONLY Codex 5.3 via Replit OpenRouter integration.
 */
export async function editingComplete(
  prompt: string,
  maxTokens = 8192
): Promise<string> {
  const system = "You are an expert software engineer and technical writer. Follow the user's instructions exactly. Output only what is requested — no extra explanation unless asked.";
  const res = await _orClient.chat.completions.create({
    model: CODEX_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}
