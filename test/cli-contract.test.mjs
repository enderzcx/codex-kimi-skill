import assert from "node:assert/strict";
import { execFile, execFileSync as run, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createJob, readJob } from "../src/state.mjs";

const BIN = resolve("bin/codex-kimi.mjs");
const execFileAsync = promisify(execFile);

test("result command returns rendered output, not the full job JSON", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-result-contract-"));
  createJob(cwd, {
    id: "kimi-rendered",
    kind: "delegate",
    title: "Kimi copywrite",
    status: "completed",
    summary: "done",
    result: { summary: "done" },
    rendered: "# Kimi result\n\nrendered copy\n",
  });

  const output = run(process.execPath, [BIN, "result", "--cwd", cwd, "kimi-rendered"], { cwd, encoding: "utf8" });
  assert.equal(output, "# Kimi result\n\nrendered copy\n");
});

test("result --json command returns the full job record", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-result-json-contract-"));
  createJob(cwd, {
    id: "kimi-json",
    kind: "delegate",
    title: "Kimi copywrite",
    status: "completed",
    summary: "done",
    result: { summary: "done" },
    rendered: "# Kimi result\n\nrendered copy\n",
    raw: "{\"summary\":\"done\"}",
  });

  const output = run(process.execPath, [BIN, "result", "--json", "--cwd", cwd, "kimi-json"], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);
  assert.equal(payload.id, "kimi-json");
  assert.equal(payload.status, "completed");
  assert.deepEqual(payload.result, { summary: "done" });
  assert.equal(payload.rendered, "# Kimi result\n\nrendered copy\n");
  assert.equal(payload.raw, "{\"summary\":\"done\"}");
});

test("background delegate returns a job id without calling Kimi synchronously", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-background-contract-"));
  const started = Date.now();
  const output = run(process.execPath, [
    BIN,
    "delegate",
    "--mode",
    "copywrite",
    "--background",
    "--json",
    "--strict-json",
    "--max-tokens",
    "9000",
    "slow copy",
  ], { cwd, encoding: "utf8" });
  const elapsed = Date.now() - started;
  const payload = JSON.parse(output);
  assert.equal(payload.status, "queued");
  assert.match(payload.job_id, /^kimi-/);
  assert.equal(payload.commands.result.startsWith("kci result"), true);
  assert.equal(payload.strict_json, true);
  assert.equal(payload.max_tokens, 9000);
  assert.ok(elapsed < 1000, `background command waited ${elapsed}ms`);
});

test("job-worker transitions a queued delegate job to completed", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-worker-complete-"));
  let capturedBody;
  const server = await startOpenAiCompatServer({
    content: JSON.stringify({
      summary: "worker done",
      deliverables: [{ type: "note", title: "ok", content: "ok" }],
      notes: [],
      next_for_codex: [],
    }),
    onRequest: (body) => {
      capturedBody = body;
    },
  });
  try {
    createJob(cwd, workerJob({
      id: "worker-complete",
      baseUrl: server.baseUrl,
      apiKey: "test",
      strictJson: true,
      maxTokens: 7777,
    }));

    const result = await execFileAsync(process.execPath, [BIN, "job-worker", "--cwd", cwd, "--job-id", "worker-complete"], {
      cwd,
      encoding: "utf8",
    });

    assert.equal(result.stderr, "");
    const stored = readJob(cwd, "worker-complete");
    assert.equal(stored.status, "completed");
    assert.equal(stored.phase, "done");
    assert.equal(stored.result.summary, "worker done");
    assert.equal(stored.raw.includes("worker done"), true);
    assert.deepEqual(capturedBody.response_format, { type: "json_object" });
    assert.equal(capturedBody.max_tokens, 7777);
  } finally {
    await server.close();
  }
});

test("job-worker records failed delegate jobs", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-worker-fail-"));
  createJob(cwd, workerJob({
    id: "worker-fail",
    baseUrl: "http://127.0.0.1:9/v1",
    timeoutMs: 1000,
  }));

  const result = spawnSync(process.execPath, [BIN, "job-worker", "--cwd", cwd, "--job-id", "worker-fail"], {
    cwd,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  const stored = readJob(cwd, "worker-fail");
  assert.equal(stored.status, "failed");
  assert.equal(stored.phase, "failed");
  assert.match(stored.error, /Kimi run failed|fetch failed|ECONNREFUSED/i);
});

test("cancel command marks active jobs cancelled without a live process", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-cancel-contract-"));
  createJob(cwd, {
    id: "cancel-target",
    kind: "delegate",
    title: "Kimi copywrite",
    status: "queued",
    phase: "queued",
    pid: null,
    summary: "waiting",
  });

  const output = run(process.execPath, [BIN, "cancel", "--json", "--cwd", cwd, "cancel-target"], {
    cwd,
    encoding: "utf8",
  });
  const payload = JSON.parse(output);
  const stored = readJob(cwd, "cancel-target");

  assert.equal(payload.status, "cancelled");
  assert.equal(payload.signal_sent, false);
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.phase, "cancelled");
});

test("delegate dry-run accepts image attachments without exposing base64", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-image-dry-run-"));
  const image = join(cwd, "screenshot.png");
  writeFileSync(image, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]));

  const output = run(process.execPath, [
    BIN,
    "delegate",
    "--mode",
    "ui-review-cn",
    "--image",
    image,
    "--json",
    "--dry-run",
    "review screenshot",
  ], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.equal(payload.routing.provider, "kimi");
  assert.equal(payload.routing.selected_model, "kimi-k2.6:cloud");
  assert.equal(payload.routing.vision_enabled, true);
  assert.equal(payload.routing.image_payload_sent, true);
  assert.equal(payload.routing.image_delivery_confirmed, false);
  assert.equal(payload.routing.images[0].path, image);
  assert.equal(payload.routing.images[0].mime, "image/png");
  assert.equal(payload.routing.images[0].bytes, 12);
  assert.equal(JSON.stringify(payload).includes("base64"), false);
});

function workerJob({ id, baseUrl, apiKey = "test", timeoutMs = 5000, strictJson = false, maxTokens = undefined }) {
  return {
    id,
    kind: "delegate",
    title: "Kimi worker test",
    status: "queued",
    phase: "queued",
    pid: null,
    summary: "worker test",
    routing: {
      mode: "copywrite",
      provider: "kimi",
      selected_model: "test-model",
      image_payload_sent: false,
      image_delivery_confirmed: false,
    },
    request: {
      opts: {
        mode: "copywrite",
        contexts: [],
        json: true,
        strictJson,
        maxTokens,
        model: "test-model",
        baseUrl,
        timeoutMs,
      },
      task: "worker test",
      mode: "copywrite",
      config: {
        model: "test-model",
        baseUrl,
        apiKey,
      },
      routing: {
        mode: "copywrite",
        provider: "kimi",
        selected_model: "test-model",
        image_payload_sent: false,
        image_delivery_confirmed: false,
      },
      files: [],
      images: [],
    },
  };
}

function startOpenAiCompatServer({ content, onRequest }) {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      onRequest?.(body);
      const selectedContent = typeof content === "function" ? content(body) : content;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: selectedContent } }],
      }));
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveServer({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

test("delegate --json emits structured failure while keeping non-zero exit", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-json-failure-"));
  const image = join(cwd, "screenshot.png");
  writeFileSync(image, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]));
  const result = spawnSync(process.execPath, [
    BIN,
    "delegate",
    "--mode",
    "ui-review-cn",
    "--json",
    "--image",
    image,
    "--base-url",
    "http://127.0.0.1:9/v1",
    "--timeout-ms",
    "1000",
    "fail fast",
  ], { cwd, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "ui-review-cn");
  assert.equal(payload.parse_status, "error");
  assert.equal(payload.routing.provider, "kimi");
  assert.equal(payload.routing.image_payload_sent, true);
  assert.equal(payload.routing.image_delivery_confirmed, false);
});

test("delegate --json relaxes provider JSON mode for long input while preserving CLI JSON", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-long-json-relaxed-"));
  const longFile = join(cwd, "long.html");
  writeFileSync(longFile, `<html>${"长文案".repeat(12000)}</html>`);
  let capturedBody;
  const server = await startOpenAiCompatServer({
    content: "这是长文档改写建议。",
    onRequest: (body) => {
      capturedBody = body;
    },
  });
  try {
    const { stdout: output } = await execFileAsync(process.execPath, [
      BIN,
      "delegate",
      "--mode",
      "rewrite-cn",
      "--json",
      "--input",
      longFile,
      "--base-url",
      server.baseUrl,
      "改得更像真人说话",
    ], { cwd, encoding: "utf8" });
    const payload = JSON.parse(output);

    assert.equal(payload.parse_status, "raw-fallback");
    assert.equal(payload.routing.provider_json_requested, true);
    assert.equal(payload.routing.provider_json_used, false);
    assert.equal(payload.routing.provider_json_mode, "relaxed-for-large-request");
    assert.equal(payload.routing.request_profile.large_request, true);
    assert.equal(payload.routing.request_profile.truncated_input_files.length, 0);
    assert.equal(payload.deliverables[0].content, "这是长文档改写建议。");
    assert.equal(capturedBody.response_format, undefined);
    assert.equal(capturedBody.max_tokens, 8192);
  } finally {
    await server.close();
  }
});

test("delegate --strict-json forces provider JSON mode for long input", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-long-strict-json-"));
  const longFile = join(cwd, "long.html");
  writeFileSync(longFile, `<html>${"长文案".repeat(12000)}</html>`);
  let capturedBody;
  const server = await startOpenAiCompatServer({
    content: JSON.stringify({
      summary: "strict done",
      deliverables: [{ type: "note", title: "ok", content: "ok" }],
      notes: [],
      next_for_codex: [],
    }),
    onRequest: (body) => {
      capturedBody = body;
    },
  });
  try {
    const { stdout: output } = await execFileAsync(process.execPath, [
      BIN,
      "delegate",
      "--mode",
      "rewrite-cn",
      "--json",
      "--strict-json",
      "--input",
      longFile,
      "--base-url",
      server.baseUrl,
      "改得更像真人说话",
    ], { cwd, encoding: "utf8" });
    const payload = JSON.parse(output);

    assert.equal(payload.summary, "strict done");
    assert.equal(payload.routing.provider_json_used, true);
    assert.equal(payload.routing.provider_json_mode, "strict");
    assert.deepEqual(capturedBody.response_format, { type: "json_object" });
  } finally {
    await server.close();
  }
});

test("delegate --strict-json preserves empty output as empty instead of retrying", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-strict-empty-"));
  let calls = 0;
  const server = await startOpenAiCompatServer({
    content: () => {
      calls += 1;
      return "";
    },
  });
  try {
    const { stdout: output } = await execFileAsync(process.execPath, [
      BIN,
      "delegate",
      "--mode",
      "rewrite-cn",
      "--json",
      "--strict-json",
      "--base-url",
      server.baseUrl,
      "把这句话改得自然一点",
    ], { cwd, encoding: "utf8" });
    const payload = JSON.parse(output);

    assert.equal(calls, 1);
    assert.equal(payload.parse_status, "empty");
    assert.equal(payload.routing.provider_json_mode, "strict");
    assert.equal(payload.deliverables[0].content, "");
  } finally {
    await server.close();
  }
});

test("delegate retries empty strict JSON output as markdown", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-empty-retry-"));
  let calls = 0;
  const server = await startOpenAiCompatServer({
    content: () => {
      calls += 1;
      return calls === 1 ? "" : "重试后返回的 Markdown。";
    },
  });
  try {
    const { stdout: output } = await execFileAsync(process.execPath, [
      BIN,
      "delegate",
      "--mode",
      "rewrite-cn",
      "--json",
      "--base-url",
      server.baseUrl,
      "把这句话改得自然一点",
    ], { cwd, encoding: "utf8" });
    const payload = JSON.parse(output);

    assert.equal(calls, 2);
    assert.equal(payload.parse_status, "raw-fallback");
    assert.equal(payload.routing.empty_output_retry, true);
    assert.equal(payload.routing.provider_json_mode, "empty-output-retry-markdown");
    assert.equal(payload.deliverables[0].content, "重试后返回的 Markdown。");
  } finally {
    await server.close();
  }
});

test("delegate truncates oversized UTF-8 input without replacement characters", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-utf8-truncate-"));
  const longFile = join(cwd, "long.html");
  writeFileSync(longFile, `<html>${"开头😀".repeat(30000)}中间${"结尾🚀".repeat(30000)}</html>`);
  let capturedBody;
  const server = await startOpenAiCompatServer({
    content: "ok",
    onRequest: (body) => {
      capturedBody = body;
    },
  });
  try {
    const { stdout: output } = await execFileAsync(process.execPath, [
      BIN,
      "delegate",
      "--mode",
      "rewrite-cn",
      "--json",
      "--input",
      longFile,
      "--base-url",
      server.baseUrl,
      "改写",
    ], { cwd, encoding: "utf8" });
    const payload = JSON.parse(output);
    const userContent = capturedBody.messages.at(-1).content;

    assert.equal(payload.routing.input_files[0].truncated, true);
    assert.deepEqual(payload.routing.request_profile.truncated_input_files, [longFile]);
    assert.match(userContent, /\[TRUNCATED: middle omitted by kci/);
    assert.doesNotMatch(userContent, /\uFFFD/);
  } finally {
    await server.close();
  }
});

test("delegate rejects invalid max token values", () => {
  const result = spawnSync(process.execPath, [
    BIN,
    "delegate",
    "--max-tokens",
    "0",
    "bad tokens",
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--max-tokens must be a positive integer/);
});

test("code dry-run exposes Kimi Code routing without sending image bytes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-code-dry-run-"));
  const image = join(cwd, "screenshot.png");
  writeFileSync(image, Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]));

  const output = run(process.execPath, [
    BIN,
    "code",
    "--mode",
    "frontend-ux-plan",
    "--image",
    image,
    "--json",
    "--dry-run",
    "plan repo UI",
  ], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.equal(payload.routing.provider, "kimi-code");
  assert.equal(payload.routing.mode, "frontend-ux-plan");
  assert.equal(payload.routing.image_read_requested, true);
  assert.equal(payload.routing.image_delivery_route, "kimi-code-read-media-file");
  assert.equal(payload.routing.image_payload_sent, false);
  assert.equal(JSON.stringify(payload).includes("base64"), false);
});

test("code dry-run exposes repeatable Kimi Code skills directories", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-code-skills-dry-run-"));
  const output = run(process.execPath, [
    BIN,
    "code",
    "--json",
    "--dry-run",
    "--cwd",
    cwd,
    "--skills-dir",
    "./skill",
    "--skills-dir",
    "/tmp/kimi-extra-skill",
    "plan with skills",
  ], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.deepEqual(payload.routing.skills_dirs, [
    resolve(cwd, "skill"),
    "/tmp/kimi-extra-skill",
  ]);
});

test("code --json parses Kimi Code stream-json assistant and tool metadata", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-code-stream-json-"));
  const fakeKimi = join(cwd, "fake-kimi.mjs");
  writeFileSync(fakeKimi, `#!/usr/bin/env node
console.log("{bad json");
console.log(JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{
      type: "text",
      text: JSON.stringify({
        summary: "stream ok",
        deliverables: [{ type: "note", title: "parsed", content: "ok" }],
        notes: [],
        next_for_codex: []
      })
    }]
  },
  tool_calls: [{ name: "ReadMediaFile", arguments: { path: "screenshot.png" } }]
}));
console.log(JSON.stringify({ type: "tool", name: "ReadMediaFile", content: "read ok" }));
`, { mode: 0o755 });

  const output = run(process.execPath, [
    BIN,
    "code",
    "--json",
    "--output-format",
    "stream-json",
    "--kimi-bin",
    fakeKimi,
    "--skills-dir",
    "./skill",
    "parse stream",
  ], { cwd, encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.equal(payload.summary, "stream ok");
  assert.equal(payload.parse_status, "parsed");
  assert.equal(payload.routing.kimi_code_output.stream_json, true);
  assert.equal(payload.routing.kimi_code_output.event_count, 2);
  assert.equal(payload.routing.kimi_code_output.parse_error_count, 1);
  assert.equal(payload.routing.kimi_code_output.assistant_message_count, 1);
  assert.equal(payload.routing.kimi_code_output.tool_call_count, 1);
  assert.equal(payload.routing.kimi_code_output.tool_result_count, 1);
  assert.deepEqual(payload.routing.kimi_code_output.tool_names, ["ReadMediaFile"]);
  assert.match(payload.routing.kimi_command, new RegExp(`--skills-dir ${payload.routing.skills_dirs[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("code rejects invalid Kimi Code output format", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-code-invalid-output-format-"));
  const result = spawnSync(process.execPath, [
    BIN,
    "code",
    "--output-format",
    "json",
    "invalid format",
  ], { cwd, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--output-format must be text or stream-json, got "json"/);
});

test("code --json emits structured failure while keeping non-zero exit", () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-code-json-failure-"));
  const fakeKimi = join(cwd, "fake-kimi.sh");
  writeFileSync(fakeKimi, "#!/bin/sh\necho 'No model configured' >&2\nexit 1\n", { mode: 0o755 });
  const result = spawnSync(process.execPath, [
    BIN,
    "code",
    "--mode",
    "general",
    "--json",
    "--kimi-bin",
    fakeKimi,
    "fail fast",
  ], { cwd, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.routing.provider, "kimi-code");
  assert.equal(payload.parse_status, "error");
  assert.match(payload.error, /Kimi Code run failed/);
});
