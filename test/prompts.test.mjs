import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, buildUserPrompt, normalizeMode } from "../src/prompts.mjs";
import { parseDelegateArgs, parseOllamaCapabilities, routeMetadata, wrapJsonOutput } from "../src/cli.mjs";

test("normalizes mode aliases", () => {
  assert.equal(normalizeMode("copywriting"), "copywrite");
  assert.equal(normalizeMode("uiux"), "frontend-ux-plan");
  assert.equal(normalizeMode("frontend"), "frontend-first-pass");
});

test("frontend first-pass prompt includes guardrails", () => {
  const prompt = buildSystemPrompt("frontend-first-pass", true);
  assert.match(prompt, /CSS\/module imports/);
  assert.match(prompt, /document title/);
  assert.match(prompt, /Disabled buttons/);
  assert.match(prompt, /390px/);
  assert.match(prompt, /Codex validation checklist/);
});

test("ui review prompt instructs screenshot-based visual critique", () => {
  const prompt = buildSystemPrompt("ui-review-cn", true);
  assert.match(prompt, /截图/);
  assert.match(prompt, /视觉批判/);
});

test("user prompt includes context and files", () => {
  const prompt = buildUserPrompt({
    task: "review UI",
    contexts: ["audience: internal ERP users"],
    files: [{ path: "/tmp/app.tsx", content: "hello", truncated: false }],
    images: [{ path: "/tmp/screenshot.png", mime: "image/png", bytes: 123 }],
  });
  assert.match(prompt, /review UI/);
  assert.match(prompt, /internal ERP users/);
  assert.match(prompt, /--- \/tmp\/app.tsx ---/);
  assert.match(prompt, /Attached images/);
  assert.match(prompt, /\/tmp\/screenshot\.png/);
  assert.match(prompt, /Use the attached screenshots directly/);
});

test("user prompt can request Kimi Code media tool handling", () => {
  const prompt = buildUserPrompt({
    task: "review UI",
    images: [{ path: "/tmp/screenshot.png", mime: "image/png", bytes: 123 }],
    imageHandling: "kimi-code-read-media",
  });

  assert.match(prompt, /ReadMediaFile/);
  assert.match(prompt, /\[IMAGE_NOT_READ:<path>\]/);
});

test("wraps non-json output", () => {
  const routing = routeMetadata({
    mode: "copywrite",
    config: {
      model: "kimi-k2.6:cloud",
      baseUrl: "http://localhost:11434/v1",
      envFiles: [],
    },
  });
  const wrapped = wrapJsonOutput("hello", "copywrite", routing);
  assert.equal(wrapped.mode, "copywrite");
  assert.equal(wrapped.routing.provider, "kimi");
  assert.equal(wrapped.parse_status, "raw-fallback");
  assert.equal(wrapped.deliverables[0].content, "hello");
});

test("extracts fenced JSON from mixed Kimi output", () => {
  const routing = routeMetadata({
    mode: "copywrite",
    config: {
      model: "kimi-k2.6:cloud",
      baseUrl: "http://localhost:11434/v1",
      envFiles: [],
    },
  });
  const wrapped = wrapJsonOutput([
    "model log",
    "```json",
    JSON.stringify({
      summary: "copy done",
      deliverables: [{ type: "copy", title: "CTA", content: "开始试试" }],
      notes: [],
      next_for_codex: ["apply copy"],
    }),
    "```",
  ].join("\n"), "copywrite", routing);

  assert.equal(wrapped.summary, "copy done");
  assert.equal(wrapped.parse_status, "extracted");
  assert.equal(wrapped.parse_source, "fenced");
  assert.equal(wrapped.deliverables[0].content, "开始试试");
  assert.match(wrapped.notes.at(-1), /extracted structured JSON/);
});

test("extracts custom fenced JSON from Kimi Code transcript output", () => {
  const routing = routeMetadata({
    mode: "general",
    config: {
      model: "kimi-k2.6:cloud",
      baseUrl: "http://localhost:11434/v1",
      envFiles: [],
    },
  });
  const wrapped = wrapJsonOutput([
    "• ```json",
    "  {\"status\":\"KCI_CODE_OK\"}",
    "  ```",
  ].join("\n"), "general", routing);

  assert.equal(wrapped.status, "KCI_CODE_OK");
  assert.equal(wrapped.parse_status, "extracted");
  assert.equal(wrapped.parse_source, "fenced");
});

test("parses background and timeout delegate controls", () => {
  const opts = parseDelegateArgs(["--background", "--timeout-ms", "0", "--mode", "frontend-first-pass", "build UI"]);
  assert.equal(opts.background, true);
  assert.equal(opts.timeoutMs, 0);
  assert.equal(opts.mode, "frontend-first-pass");
  assert.equal(opts.task, "build UI");
});

test("parses Ollama show capabilities", () => {
  const capabilities = parseOllamaCapabilities(`
  Model
    architecture        kimi-k2

  Capabilities
    vision
    thinking
    completion
    tools
`);

  assert.deepEqual(capabilities, ["vision", "thinking", "completion", "tools"]);
});

test("parses Ollama capabilities with parenthetical descriptions", () => {
  const capabilities = parseOllamaCapabilities(`
  Model
    architecture        kimi-k2

  Capabilities
    vision (experimental)
    thinking
    completion
    tools

  Parameters
    temperature         0.3
`);

  assert.deepEqual(capabilities, ["vision", "thinking", "completion", "tools"]);
});
