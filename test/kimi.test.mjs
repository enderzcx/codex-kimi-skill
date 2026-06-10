import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIMEOUT_MS, resolveTimeoutMs, runKimi } from "../src/kimi.mjs";

test("resolveTimeoutMs uses default and validates explicit values", () => {
  assert.equal(resolveTimeoutMs(undefined), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs("0"), 0);
  assert.equal(resolveTimeoutMs("2500"), 2500);
  assert.throws(() => resolveTimeoutMs("-1"), /invalid Kimi timeout/);
  assert.throws(() => resolveTimeoutMs("soon"), /invalid Kimi timeout/);
});

test("runs Kimi through Ollama OpenAI-compatible chat completions", async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = snapshotEnv();
  let captured;

  process.env.KIMI_BASE_URL = "http://ollama.example/v1";
  process.env.KIMI_API_KEY = "test-key";
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "{\"summary\":\"ok\"}" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await runKimi({
      model: "kimi-k2.6:cloud",
      system: "system",
      prompt: "prompt",
      images: [{
        path: "/tmp/screenshot.png",
        mime: "image/png",
        bytes: 12,
        detail: "high",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      }],
      json: true,
      maxTokens: 123,
    });

    assert.equal(result.stdout, "{\"summary\":\"ok\"}");
    assert.equal(result.imagePayloadSent, true);
    assert.equal(captured.url, "http://ollama.example/v1/chat/completions");
    assert.equal(captured.init.headers.Authorization, "Bearer test-key");
    assert.equal(captured.body.model, "kimi-k2.6:cloud");
    assert.deepEqual(captured.body.response_format, { type: "json_object" });
    assert.equal(captured.body.max_tokens, 123);
    assert.equal(captured.body.messages[1].content[0].type, "text");
    assert.equal(captured.body.messages[1].content[1].type, "image_url");
    assert.equal(captured.body.messages[1].content[1].image_url, "data:image/png;base64,iVBORw0KGgo=");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
  }
});

test("runKimi fails clearly when fetch times out", async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = snapshotEnv();

  process.env.KIMI_BASE_URL = "http://ollama.example/v1";
  process.env.KIMI_API_KEY = "test-key";
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  try {
    await assert.rejects(
      () => runKimi({
        model: "kimi-k2.6:cloud",
        system: "system",
        prompt: "prompt",
        timeoutMs: 10,
      }),
      /timed out after 10ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(savedEnv);
  }
});

function snapshotEnv() {
  const keys = [
    "CODEX_KIMI_ENV",
    "KIMI_API_KEY",
    "OLLAMA_API_KEY",
    "ollamaApiKey",
    "KIMI_BASE_URL",
    "KIMI_URL_OPENAI",
    "OLLAMA_OPENAI_BASE_URL",
    "KIMI_MODEL",
  ];
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
