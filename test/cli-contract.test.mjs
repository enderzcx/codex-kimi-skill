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
    "slow copy",
  ], { cwd, encoding: "utf8" });
  const elapsed = Date.now() - started;
  const payload = JSON.parse(output);

  assert.equal(payload.status, "queued");
  assert.match(payload.job_id, /^kimi-/);
  assert.equal(payload.commands.result.startsWith("kci result"), true);
  assert.ok(elapsed < 1000, `background command waited ${elapsed}ms`);
});

test("job-worker transitions a queued delegate job to completed", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kci-worker-complete-"));
  const server = await startOpenAiCompatServer({
    content: JSON.stringify({
      summary: "worker done",
      deliverables: [{ type: "note", title: "ok", content: "ok" }],
      notes: [],
      next_for_codex: [],
    }),
  });
  try {
    createJob(cwd, workerJob({
      id: "worker-complete",
      baseUrl: server.baseUrl,
      apiKey: "test",
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

function workerJob({ id, baseUrl, apiKey = "test", timeoutMs = 5000 }) {
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

function startOpenAiCompatServer({ content }) {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    request.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content } }],
    }));
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
