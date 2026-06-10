import { resolveKimiConfig } from "./env.mjs";

export const DEFAULT_TIMEOUT_MS = 180_000;

export function resolveTimeoutMs(value = process.env.KCI_TIMEOUT_MS ?? process.env.CODEX_KIMI_TIMEOUT_MS) {
  if (value === undefined || value === null || value === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid Kimi timeout: ${value}`);
  }
  return parsed;
}

export async function runKimi({
  model,
  baseUrl,
  apiKey,
  system,
  prompt,
  images = [],
  json = false,
  maxTokens,
  timeoutMs = resolveTimeoutMs(),
}) {
  const config = resolveKimiConfig({ model, baseUrl });
  const selectedApiKey = apiKey ?? config.apiKey;
  if (!selectedApiKey) {
    throw new Error("Kimi API key missing. Local Ollama usually accepts the placeholder key `ollama`.");
  }

  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(new Error(`Kimi run timed out after ${timeoutMs}ms`)), timeoutMs)
    : null;
  timer?.unref?.();

  let response;
  const body = {
    model: config.model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: buildUserContent({ prompt, images }) },
    ],
    temperature: 0.3,
    stream: false,
    max_tokens: maxTokens ?? (json ? 4096 : 2048),
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };

  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${selectedApiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller?.signal,
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(
        `Kimi run timed out after ${timeoutMs}ms with model ${config.model}. ` +
          "Try --background for long UI/copy work or pass a higher --timeout-ms.",
      );
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.error?.message ?? text.trim() ?? `HTTP ${response.status}`;
    throw new Error(`Kimi run failed: ${detail}`);
  }

  const stdout = payload?.choices?.[0]?.message?.content;
  if (typeof stdout !== "string") {
    throw new Error("Kimi run failed: response did not include choices[0].message.content");
  }

  return {
    stdout,
    model: config.model,
    baseUrl: config.baseUrl,
    imagePayloadSent: images.length > 0,
  };
}

function buildUserContent({ prompt, images = [] }) {
  const normalizedImages = images.filter((image) => image?.dataUrl);
  if (!normalizedImages.length) return prompt;
  return [
    { type: "text", text: prompt },
    ...normalizedImages.map((image) => ({
      type: "image_url",
      image_url: image.dataUrl,
    })),
  ];
}
