import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stdin, stdout } from "node:process";
import { promisify } from "node:util";
import { resolveKimiConfig } from "./env.mjs";
import { runKimi } from "./kimi.mjs";
import { buildSystemPrompt, buildUserPrompt, KIMI_MODES, normalizeMode } from "./prompts.mjs";
import { renderDelegateResult } from "./render.mjs";
import {
  appendLog,
  createJob,
  generateJobId,
  isActiveStatus,
  listJobs,
  nowIso,
  readJob,
  resolveJobLogFile,
  resolveJobReference,
  resolveWorkspaceRoot,
  updateJob,
} from "./state.mjs";

const execFileAsync = promisify(execFile);
const INPUT_FILE_BYTE_CAP = 48 * 1024;
const IMAGE_FILE_BYTE_CAP = 8 * 1024 * 1024;

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "delegate") return delegate(rest);
  if (command === "code") return code(rest);
  if (command === "health") return health(rest);
  if (command === "job-worker") return jobWorker(rest);
  if (command === "status") return status(rest);
  if (command === "result") return result(rest);
  if (command === "cancel") return cancel(rest);
  if (command === "modes") {
    stdout.write(`${KIMI_MODES.join("\n")}\n`);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

export async function code(argv) {
  const opts = parseCodeArgs(argv);
  const task = opts.task || (await readStdinIfPiped());
  const mode = normalizeMode(opts.mode);
  const files = opts.inputFiles.map(readInputFile);
  const images = opts.imageFiles.map(readImageFile);
  const system = buildSystemPrompt(mode, opts.json);
  const prompt = buildUserPrompt({ task, contexts: opts.contexts, files, images, imageHandling: "kimi-code-read-media" });
  const kimiPrompt = [
    "You are running through Kimi Code CLI for repo-aware assistance.",
    "Follow this Kimi delegation contract, but do not edit files unless the surrounding Codex session explicitly applies changes.",
    "",
    "System contract:",
    system,
    "",
    "User request:",
    prompt,
  ].join("\n");
  const routing = {
    mode,
    provider: "kimi-code",
    selected_model: opts.model ?? "(kimi default)",
    output_kind: mode === "frontend-first-pass" ? "code-brief" : mode.includes("review") ? "review" : "brief",
    allow_code: mode === "frontend-first-pass",
    handoff_to: "codex",
    cwd: resolve(opts.cwd),
    input_files: files.map((file) => ({ path: file.path, bytes: file.bytes, truncated: file.truncated })),
    images: images.map(publicImageMetadata),
    image_read_requested: images.length > 0,
    image_payload_sent: false,
    image_delivery_confirmed: false,
    image_delivery_route: images.length > 0 ? "kimi-code-read-media-file" : "none",
  };

  if (opts.dryRun) {
    writeJson({ mode, routing, task: task || null });
    return;
  }

  let result;
  try {
    result = await runKimiCode({
      bin: opts.kimiBin,
      cwd: opts.cwd,
      model: opts.model,
      prompt: kimiPrompt,
      outputFormat: opts.outputFormat,
      timeoutMs: opts.timeoutMs,
    });
  } catch (error) {
    if (opts.json) {
      process.exitCode = 1;
      writeJson({
        ok: false,
        mode,
        routing,
        parse_status: "error",
        error: messageOf(error),
        notes: ["Kimi Code prompt mode failed. Check Kimi Code login/default_model configuration."],
      });
      return;
    }
    throw error;
  }
  const wrapped = wrapJsonOutput(result.stdout, mode, {
    ...routing,
    image_payload_sent: images.length > 0,
    image_delivery_confirmed: images.length > 0 && !/\[IMAGE_NOT_READ(?::[^\]]+)?\]/.test(result.stdout),
    kimi_command: result.command,
  });
  if (opts.json) writeJson(wrapped);
  else writeText(result.stdout);
}

export async function delegate(argv) {
  const opts = parseDelegateArgs(argv);
  const task = opts.task || (await readStdinIfPiped());
  const mode = normalizeMode(opts.mode);
  const files = opts.inputFiles.map(readInputFile);
  const images = opts.imageFiles.map(readImageFile);
  const config = resolveKimiConfig({ model: opts.model, baseUrl: opts.baseUrl });
  const routing = routeMetadata({ mode, config, inputFiles: files, images });

  if (opts.dryRun) {
    writeJson({
      mode,
      routing,
      task: task || null,
      input_files: files.map((file) => ({ path: file.path, bytes: file.bytes, truncated: file.truncated })),
      images: images.map(publicImageMetadata),
    });
    return;
  }

  if (opts.background) {
    enqueueBackgroundDelegate({ opts, task, mode, config, routing, files, images });
    return;
  }

  let output;
  try {
    output = await runDelegateRequest({ opts, task, mode, config, routing, files, images });
  } catch (error) {
    if (opts.json) {
      process.exitCode = 1;
      writeJson({
        ok: false,
        mode,
        routing: {
          ...routing,
          image_payload_sent: images.length > 0,
          image_delivery_confirmed: false,
        },
        parse_status: "error",
        error: messageOf(error),
        notes: images.length > 0
          ? ["The CLI attempted to send image payloads, but the Kimi/Ollama request failed."]
          : ["The Kimi/Ollama request failed."],
      });
      return;
    }
    throw error;
  }
  if (opts.json) writeJson(output.wrapped);
  else writeText(output.raw);
}

async function runDelegateRequest({ opts, task, mode, config, routing, files, images = [] }) {
  const system = buildSystemPrompt(mode, opts.json);
  const prompt = buildUserPrompt({ task, contexts: opts.contexts, files, images });
  const result = await runKimi({
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    system,
    prompt,
    images,
    json: opts.json,
    timeoutMs: opts.timeoutMs,
  });
  const wrapped = wrapJsonOutput(result.stdout, mode, {
    ...routing,
    image_payload_sent: result.imagePayloadSent,
    image_delivery_confirmed: result.imagePayloadSent,
    response_model: result.model,
  });
  return {
    raw: result.stdout,
    wrapped,
    rendered: renderDelegateResult(wrapped, { raw: result.stdout }),
  };
}

async function runKimiCode({ bin, cwd, model, prompt, outputFormat, timeoutMs = 180000 }) {
  const kimiBin = bin ?? process.env.KIMI_CLI_BIN ?? "/Users/sunny/.kimi-code/bin/kimi";
  const args = [
    ...(model ? ["--model", model] : []),
    "--output-format",
    outputFormat,
    "-p",
    prompt,
  ];
  try {
    const { stdout: out, stderr } = await execFileAsync(kimiBin, args, {
      cwd: resolve(cwd),
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { stdout: out.trim(), stderr, command: [kimiBin, ...args.slice(0, -1), "<prompt>"].join(" ") };
  } catch (error) {
    throw new Error(`Kimi Code run failed: ${messageOf(error)}`);
  }
}

function enqueueBackgroundDelegate({ opts, task, mode, config, routing, files, images = [] }) {
  const cwd = resolve(process.cwd());
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobId = generateJobId("kimi");
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const job = createJob(workspaceRoot, {
    id: jobId,
    kind: "delegate",
    title: `Kimi ${mode}`,
    summary: task ? task.replace(/\s+/g, " ").slice(0, 120) : `${mode} task`,
    workspaceRoot,
    status: "queued",
    phase: "queued",
    pid: null,
    logFile,
    routing,
    request: {
      opts: {
        mode: opts.mode,
        contexts: opts.contexts,
        json: true,
        model: opts.model,
        baseUrl: opts.baseUrl,
        timeoutMs: opts.timeoutMs ?? 0,
      },
      task,
      mode,
      config,
      routing,
      files,
      images,
    },
  });
  appendLog(workspaceRoot, jobId, `Queued ${mode} with ${routing.selected_model}.`);
  const child = spawn(process.execPath, [process.argv[1], "job-worker", "--cwd", workspaceRoot, "--job-id", jobId], {
    cwd: workspaceRoot,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  updateJob(workspaceRoot, job.id, { pid: child.pid ?? null });

  const payload = {
    job_id: jobId,
    status: "queued",
    mode,
    selected_model: routing.selected_model,
    commands: {
      status: `kci status ${jobId}`,
      result: `kci result ${jobId}`,
      cancel: `kci cancel ${jobId}`,
    },
  };
  if (opts.json) writeJson(payload);
  else writeText(`Kimi task started in the background as ${jobId}. Check \`kci status ${jobId}\` for progress.`);
}

async function health(argv) {
  const opts = parseHealthArgs(argv);
  const config = resolveKimiConfig({ model: opts.model, baseUrl: opts.baseUrl });
  const payload = {
    ok: false,
    model: config.model,
    base_url: redactUrl(config.baseUrl),
    api_key_present: Boolean(config.apiKey),
    kimi_cli: await getKimiCliVersion(),
    kimi_code: await getKimiCodeStatus(),
    ollama_api: await getOllamaModels(config),
    ollama_model_info: await getOllamaModelInfo(config.model),
    text_smoke: null,
    vision_smoke: null,
  };

  if (payload.ollama_api.ok && payload.ollama_api.model_present) {
    payload.text_smoke = await runTextSmoke(config, opts.timeoutMs);
  } else {
    payload.text_smoke = { ok: false, skipped: true, reason: "ollama API unavailable or kimi-k2.6:cloud missing" };
  }
  if (opts.visionSmoke) {
    payload.vision_smoke = await runVisionSmoke(config, opts.timeoutMs);
  } else {
    payload.vision_smoke = {
      ok: false,
      skipped: true,
      reason: "pass --vision-smoke to test Kimi Code ReadMediaFile image delivery",
      model_declares_vision: payload.ollama_model_info.capabilities.includes("vision"),
    };
  }
  payload.ok = Boolean(
    payload.kimi_cli.ok &&
    payload.kimi_code.config_ready &&
    payload.ollama_api.ok &&
    payload.ollama_api.model_present &&
    payload.text_smoke.ok &&
    (!opts.visionSmoke || payload.vision_smoke.ok),
  );

  if (!payload.ok) process.exitCode = 1;
  if (opts.json) writeJson(payload);
  else stdout.write(`${payload.ok ? "ok" : "not-ok"} ${JSON.stringify(payload, null, 2)}\n`);
}

async function getKimiCliVersion() {
  const candidates = [process.env.KIMI_CLI_BIN, "/Users/sunny/.kimi-code/bin/kimi", "kimi"].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    for (const args of [["--version"], ["-v"]]) {
      try {
        const { stdout: out, stderr } = await execFileAsync(candidate, args, { timeout: 5000 });
        const text = `${out}${stderr}`.trim();
        if (text) return { ok: true, bin: candidate, version: text.split(/\r?\n/)[0] };
      } catch {
        // Try the next version flag or candidate.
      }
    }
  }
  return { ok: false, bin: null, version: null, error: "kimi CLI not found or did not return a version" };
}

async function getKimiCodeStatus() {
  const doctor = await runKimiCodeDoctor();
  const configPath = "/Users/sunny/.kimi-code/config.toml";
  const hasDefaultModel = hasKimiDefaultModel(configPath);
  return {
    doctor_ok: doctor.ok,
    doctor_preview: doctor.preview,
    config_ready: doctor.ok && hasDefaultModel,
    default_model_configured: hasDefaultModel,
    prompt_ready_note: "Run `kci code ...` for a real Kimi Code prompt smoke; Kimi Code may require login/default_model.",
  };
}

function hasKimiDefaultModel(configPath) {
  try {
    if (!existsSync(configPath)) return false;
    return /^\s*default_model\s*=/m.test(readFileSync(configPath, "utf8"));
  } catch {
    return false;
  }
}

async function runKimiCodeDoctor() {
  const kimiBin = process.env.KIMI_CLI_BIN ?? "/Users/sunny/.kimi-code/bin/kimi";
  try {
    const { stdout: out, stderr } = await execFileAsync(kimiBin, ["doctor"], { timeout: 10000 });
    const preview = `${out}${stderr}`.trim().slice(0, 800);
    return { ok: /All checked config files are valid/i.test(preview) || !/ERROR|failed/i.test(preview), preview };
  } catch (error) {
    return { ok: false, preview: messageOf(error).slice(0, 800) };
  }
}

async function getOllamaModels(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Ollama /models timed out after 10000ms")), 10000);
  timer.unref?.();
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey || "ollama"}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const ids = Array.isArray(body?.data) ? body.data.map((item) => item.id).filter(Boolean) : [];
    return {
      ok: response.ok,
      status: response.status,
      model_present: ids.includes(config.model),
      models: ids,
      error: response.ok ? null : body?.error?.message ?? text.slice(0, 200),
    };
  } catch (error) {
    return { ok: false, status: null, model_present: false, models: [], error: messageOf(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function getOllamaModelInfo(model) {
  try {
    const { stdout: out } = await execFileAsync("ollama", ["show", model], { timeout: 10000 });
    return {
      ok: true,
      capabilities: parseOllamaCapabilities(out),
      raw_preview: out.trim().slice(0, 600),
    };
  } catch (error) {
    return { ok: false, capabilities: [], error: messageOf(error) };
  }
}

export function parseOllamaCapabilities(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const capabilities = [];
  let inCapabilities = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inCapabilities && capabilities.length > 0) break;
      continue;
    }
    if (trimmed === "Capabilities") {
      inCapabilities = true;
      continue;
    }
    if (inCapabilities) {
      if (!/^\s+\S/.test(line)) break;
      const capability = trimmed.replace(/\s+\([^)]*\)\s*$/, "").split(/\s+/)[0];
      if (capability) capabilities.push(capability);
    }
  }
  return capabilities;
}

async function runTextSmoke(config, timeoutMs) {
  try {
    const result = await runKimi({
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      system: "Return exactly: KIMI_OK",
      prompt: "Return exactly: KIMI_OK",
      timeoutMs: timeoutMs ?? 60000,
    });
    return {
      ok: /KIMI_OK/i.test(result.stdout),
      response_preview: result.stdout.trim().slice(0, 200),
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

async function runVisionSmoke(config, timeoutMs) {
  const redPng =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR4nO3PQQ0AIBDAMMC/5+ONAvZoFSzZnplzzwTeHrsA4GsSAiESAiESAiESAiESAiESAiESAiESAiESAiESAiESAiESAiESAiESAiES8l+QAnDAAc5tRWegAAAAAElFTkSuQmCC";
  const smokeDir = mkdtempSync(resolve(tmpdir(), "kci-vision-smoke-"));
  const smokePath = resolve(smokeDir, "red.png");
  try {
    writeFileSync(smokePath, Buffer.from(redPng, "base64"));
    const image = {
      path: smokePath,
      mime: "image/png",
      bytes: Buffer.byteLength(redPng, "base64"),
      detail: "high",
    };
    const system = buildSystemPrompt("ui-review-cn", true);
    const prompt = buildUserPrompt({
      task: "识别图片主色，只返回 JSON：{\"summary\":\"done\",\"deliverables\":[{\"type\":\"note\",\"title\":\"color\",\"content\":\"RED 或 NOT_RED\"}],\"notes\":[],\"next_for_codex\":[]}",
      images: [image],
      imageHandling: "kimi-code-read-media",
    });
    const kimiPrompt = [
      "You are running through Kimi Code CLI for repo-aware assistance.",
      "Follow this Kimi delegation contract, but do not edit files unless the surrounding Codex session explicitly applies changes.",
      "",
      "System contract:",
      system,
      "",
      "User request:",
      prompt,
    ].join("\n");
    const result = await runKimiCode({
      cwd: process.cwd(),
      prompt: kimiPrompt,
      outputFormat: "text",
      timeoutMs: timeoutMs ?? 90000,
    });
    const readFailed = /\[IMAGE_NOT_READ(?::[^\]]+)?\]/.test(result.stdout);
    return {
      ok: !readFailed && /\bRED\b/i.test(result.stdout),
      image_read_requested: true,
      image_payload_sent: true,
      image_delivery_confirmed: !readFailed,
      image_delivery_route: "kimi-code-read-media-file",
      response_preview: result.stdout.trim().slice(0, 200),
    };
  } catch (error) {
    return {
      ok: false,
      image_read_requested: true,
      image_payload_sent: true,
      image_delivery_confirmed: false,
      image_delivery_route: "kimi-code-read-media-file",
      error: messageOf(error),
    };
  } finally {
    rmSync(smokeDir, { recursive: true, force: true });
  }
}

export function parseDelegateArgs(argv) {
  const opts = {
    mode: "general",
    inputFiles: [],
    imageFiles: [],
    contexts: [],
    json: false,
    dryRun: false,
    background: false,
    model: undefined,
    baseUrl: undefined,
    timeoutMs: undefined,
    task: "",
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") opts.mode = requireValue(argv, ++i, "--mode");
    else if (arg === "--input") opts.inputFiles.push(requireValue(argv, ++i, "--input"));
    else if (arg === "--image") opts.imageFiles.push(requireValue(argv, ++i, "--image"));
    else if (arg === "--context") opts.contexts.push(requireValue(argv, ++i, "--context"));
    else if (arg === "--json") opts.json = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--background") opts.background = true;
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--base-url") opts.baseUrl = requireValue(argv, ++i, "--base-url");
    else if (arg === "--timeout-ms") opts.timeoutMs = parseTimeoutMs(requireValue(argv, ++i, "--timeout-ms"));
    else if (arg === "--help" || arg === "-h") {
      printDelegateHelp();
      process.exit(0);
    } else positional.push(arg);
  }
  opts.task = positional.join(" ").trim();
  return opts;
}

export function parseCodeArgs(argv) {
  const opts = {
    mode: "general",
    inputFiles: [],
    imageFiles: [],
    contexts: [],
    json: false,
    dryRun: false,
    cwd: process.cwd(),
    model: undefined,
    kimiBin: undefined,
    outputFormat: "text",
    timeoutMs: 180000,
    task: "",
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") opts.mode = requireValue(argv, ++i, "--mode");
    else if (arg === "--input") opts.inputFiles.push(requireValue(argv, ++i, "--input"));
    else if (arg === "--image") opts.imageFiles.push(requireValue(argv, ++i, "--image"));
    else if (arg === "--context") opts.contexts.push(requireValue(argv, ++i, "--context"));
    else if (arg === "--json") opts.json = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--cwd" || arg === "--cd") opts.cwd = requireValue(argv, ++i, arg);
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--kimi-bin") opts.kimiBin = requireValue(argv, ++i, "--kimi-bin");
    else if (arg === "--output-format") opts.outputFormat = requireValue(argv, ++i, "--output-format");
    else if (arg === "--timeout-ms") opts.timeoutMs = parseTimeoutMs(requireValue(argv, ++i, "--timeout-ms"));
    else if (arg === "--help" || arg === "-h") {
      printCodeHelp();
      process.exit(0);
    } else positional.push(arg);
  }
  opts.task = positional.join(" ").trim();
  return opts;
}

function parseHealthArgs(argv) {
  const opts = { json: false, model: undefined, baseUrl: undefined, timeoutMs: undefined, visionSmoke: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--model" || arg === "-m") opts.model = requireValue(argv, ++i, arg);
    else if (arg === "--base-url") opts.baseUrl = requireValue(argv, ++i, "--base-url");
    else if (arg === "--timeout-ms") opts.timeoutMs = parseTimeoutMs(requireValue(argv, ++i, "--timeout-ms"));
    else if (arg === "--vision-smoke") opts.visionSmoke = true;
    else if (arg === "--help" || arg === "-h") {
      printHealthHelp();
      process.exit(0);
    } else throw new Error(`unknown health option: ${arg}`);
  }
  return opts;
}

async function jobWorker(argv) {
  const opts = parseSimpleArgs(argv, ["cwd", "job-id"], []);
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const jobId = opts["job-id"];
  if (!jobId) throw new Error("job-worker requires --job-id");
  const stored = readJob(cwd, jobId);
  if (!stored?.request) throw new Error(`job ${jobId} is missing request data`);
  updateJob(cwd, jobId, { status: "running", phase: "running", pid: process.pid, startedAt: nowIso() });
  appendLog(cwd, jobId, "Worker started.");
  try {
    const output = await runDelegateRequest(stored.request);
    updateJob(cwd, jobId, {
      status: "completed",
      phase: "done",
      pid: null,
      completedAt: nowIso(),
      result: output.wrapped,
      rendered: output.rendered,
      raw: output.raw,
      summary: output.wrapped.summary ?? "Kimi task completed.",
    });
    appendParseStatusLog(cwd, jobId, output.wrapped);
    appendLog(cwd, jobId, "Worker completed.");
  } catch (error) {
    const message = messageOf(error);
    updateJob(cwd, jobId, {
      status: "failed",
      phase: "failed",
      pid: null,
      completedAt: nowIso(),
      error: message,
    });
    appendLog(cwd, jobId, `Worker failed: ${message}`);
    process.exitCode = 1;
  }
}

function appendParseStatusLog(cwd, jobId, result) {
  const status = result?.parse_status;
  if (!status) return;
  if (status === "raw-fallback" || status === "schema-fallback") {
    appendLog(cwd, jobId, `Output parse status: ${status}; raw output preserved in job record.`);
  } else {
    appendLog(cwd, jobId, `Output parse status: ${status}${result?.parse_source ? ` (${result.parse_source})` : ""}.`);
  }
}

function status(argv) {
  const opts = parseSimpleArgs(argv, ["cwd"], ["json", "all"]);
  const cwd = opts.cwd ? resolve(opts.cwd) : resolveWorkspaceRoot(process.cwd());
  const reference = opts._[0] ?? "";
  const jobs = reference ? [resolveJobReference(cwd, reference)].filter(Boolean) : listJobs(cwd).slice(0, opts.all ? 50 : 10);
  if (opts.json) {
    writeJson({ jobs });
    return;
  }
  if (!jobs.length) {
    writeText("No Kimi jobs found.");
    return;
  }
  writeText([
    "| Job | Status | Mode | Model | Summary | Actions |",
    "|---|---|---|---|---|---|",
    ...jobs.map((job) => {
      const actions = isActiveStatus(job.status)
        ? `\`kci cancel ${job.id}\``
        : `\`kci result ${job.id}\``;
      return `| ${job.id} | ${job.status ?? ""} | ${job.routing?.mode ?? ""} | ${job.routing?.selected_model ?? ""} | ${escapeCell(job.summary ?? "")} | ${actions} |`;
    }),
  ].join("\n"));
}

function result(argv) {
  const opts = parseSimpleArgs(argv, ["cwd"], ["json"]);
  const cwd = opts.cwd ? resolve(opts.cwd) : resolveWorkspaceRoot(process.cwd());
  const reference = opts._[0] ?? "";
  const job = resolveJobReference(cwd, reference, (candidate) => !isActiveStatus(candidate.status));
  if (!job) throw new Error(reference ? `No finished job found for ${reference}` : "No finished Kimi job found.");
  const stored = readJob(cwd, job.id) ?? job;
  if (opts.json) {
    writeJson(stored);
    return;
  }
  if (stored.status === "failed") {
    writeText(`Job ${stored.id} failed: ${stored.error ?? "unknown error"}`);
    return;
  }
  writeText(stored.rendered ?? renderDelegateResult(stored.result ?? { summary: stored.summary ?? "No result payload stored." }, { raw: stored.raw }));
}

function cancel(argv) {
  const opts = parseSimpleArgs(argv, ["cwd"], ["json"]);
  const cwd = opts.cwd ? resolve(opts.cwd) : resolveWorkspaceRoot(process.cwd());
  const reference = opts._[0] ?? "";
  const job = resolveJobReference(cwd, reference, (candidate) => isActiveStatus(candidate.status));
  if (!job) throw new Error(reference ? `No active job found for ${reference}` : "No active Kimi job found.");
  const pid = Number(job.pid);
  let signalSent = false;
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(-pid, "SIGTERM");
      signalSent = true;
    } catch {
      try {
        process.kill(pid, "SIGTERM");
        signalSent = true;
      } catch {
        signalSent = false;
      }
    }
  }
  const next = updateJob(cwd, job.id, {
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt: nowIso(),
    error: "Cancelled by user.",
  });
  appendLog(cwd, job.id, "Cancelled by user.");
  const payload = { job_id: job.id, status: "cancelled", signal_sent: signalSent };
  if (opts.json) writeJson({ ...payload, job: next });
  else writeText(`Cancelled ${job.id}${signalSent ? "" : " (process was already gone)"}.`);
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("--timeout-ms must be a non-negative number");
  return parsed;
}

function parseSimpleArgs(argv, valueOptions = [], booleanOptions = []) {
  const valueSet = new Set(valueOptions.map((name) => `--${name}`));
  const boolSet = new Set(booleanOptions.map((name) => `--${name}`));
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valueSet.has(arg)) opts[arg.slice(2)] = requireValue(argv, ++i, arg);
    else if (boolSet.has(arg)) opts[arg.slice(2)] = true;
    else opts._.push(arg);
  }
  return opts;
}

function readInputFile(path) {
  const content = readFileSync(path, "utf8");
  const truncated = Buffer.byteLength(content, "utf8") > INPUT_FILE_BYTE_CAP;
  const sliced = truncated ? Buffer.from(content).subarray(0, INPUT_FILE_BYTE_CAP).toString("utf8") : content;
  return {
    path,
    content: sliced,
    bytes: Buffer.byteLength(content, "utf8"),
    truncated,
  };
}

function readImageFile(path) {
  const buffer = readFileSync(path);
  const bytes = buffer.byteLength;
  if (bytes > IMAGE_FILE_BYTE_CAP) {
    throw new Error(`image file too large: ${path} is ${bytes} bytes; cap is ${IMAGE_FILE_BYTE_CAP}`);
  }
  const mime = mimeForImagePath(path);
  return {
    path,
    mime,
    bytes,
    detail: "high",
    dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
  };
}

function mimeForImagePath(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  throw new Error(`unsupported image type for --image: ${path}. Use png, jpg, jpeg, webp, or gif.`);
}

function publicImageMetadata(image) {
  return {
    path: image.path,
    mime: image.mime,
    bytes: image.bytes,
    detail: image.detail,
    payload_sent: true,
  };
}

async function readStdinIfPiped() {
  try {
    const info = await stat("/dev/stdin");
    if (info.isFIFO() || info.isFile()) {
      return await new Promise((resolve) => {
        let data = "";
        stdin.setEncoding("utf8");
        stdin.on("data", (chunk) => {
          data += chunk;
        });
        stdin.on("end", () => resolve(data.trim()));
      });
    }
  } catch {
    return "";
  }
  return "";
}

export function routeMetadata({ mode, config, inputFiles = [], images = [] }) {
  return {
    mode,
    provider: "kimi",
    selected_model: config.model,
    base_url: redactUrl(config.baseUrl),
    vision_enabled: images.length > 0,
    image_payload_sent: images.length > 0,
    image_delivery_confirmed: false,
    output_kind: mode === "frontend-first-pass" ? "code-brief" : mode.includes("review") ? "review" : "brief",
    allow_code: mode === "frontend-first-pass",
    handoff_to: "codex",
    input_files: inputFiles.map((file) => ({ path: file.path, bytes: file.bytes, truncated: file.truncated })),
    images: images.map(publicImageMetadata),
  };
}

export function wrapJsonOutput(raw, mode, routing) {
  const extracted = extractJsonObject(raw);
  if (extracted?.parsed) {
    const parsed = extracted.parsed;
    const notes = Array.isArray(parsed.notes) ? [...parsed.notes] : [];
    if (extracted.source !== "direct") {
      notes.push("CLI extracted structured JSON from mixed Kimi output.");
    }
    return {
      ...parsed,
      mode: parsed.mode ?? mode,
      routing,
      parse_status: extracted.source === "direct" ? "parsed" : "extracted",
      parse_source: extracted.source,
      ...(notes.length ? { notes } : {}),
    };
  }
  return {
    mode,
    routing,
    parse_status: "raw-fallback",
    parse_source: "raw",
    summary: "Kimi returned non-JSON content.",
    deliverables: [{ type: "note", title: "raw", content: String(raw ?? "").trim() }],
    notes: ["The CLI wrapped the raw response because JSON parsing failed."],
    next_for_codex: [],
  };
}

export function extractJsonObject(raw) {
  const trimmed = stripAnsi(String(raw ?? "")).trim();
  if (!trimmed) return null;
  const direct = parseJsonCandidate(trimmed);
  if (direct) return { parsed: direct, source: "direct" };

  const fenced = chooseBestParsedObject(extractFencedCandidates(trimmed), { minScore: 0 });
  if (fenced) return { parsed: fenced, source: "fenced" };

  const balanced = chooseBestParsedObject(extractBalancedObjectCandidates(trimmed), { minScore: 1 });
  if (balanced) return { parsed: balanced, source: "balanced" };

  return null;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseJsonCandidate(candidate) {
  try {
    const parsed = JSON.parse(candidate.trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractFencedCandidates(raw) {
  const candidates = [];
  const fencePattern = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = fencePattern.exec(raw)) !== null) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  return candidates;
}

function extractBalancedObjectCandidates(raw) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function chooseBestParsedObject(candidates, { minScore = 0 } = {}) {
  let best = null;
  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (!parsed) continue;
    const score = scoreParsedObject(parsed);
    if (score < minScore) continue;
    if (!best || score > best.score || (score === best.score && candidate.length > best.length)) {
      best = { parsed, score, length: candidate.length };
    }
  }
  return best?.parsed ?? null;
}

function scoreParsedObject(value) {
  let score = 0;
  if (typeof value.summary === "string") score += 4;
  if (Array.isArray(value.deliverables)) score += 4;
  if (Array.isArray(value.next_for_codex)) score += 3;
  if (Array.isArray(value.notes)) score += 2;
  if (typeof value.mode === "string") score += 1;
  if (value.routing && typeof value.routing === "object") score += 1;
  return score;
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "(invalid-url)";
  }
}

function writeText(value) {
  stdout.write(value);
  if (!value.endsWith("\n")) stdout.write("\n");
}

function writeJson(value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function escapeCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 160);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  stdout.write(`codex-kimi

Commands:
  delegate [task]   Ask Kimi K2.6 for copy, UI/UX, naming, or frontend first-pass help.
  code [task]       Run the same delegation prompt through Kimi Code CLI prompt mode.
  health            Check Kimi CLI, Ollama API/model, and text smoke.
  status [job-id]   Show background Kimi jobs.
  result [job-id]   Show a completed background Kimi result.
  cancel [job-id]   Cancel an active background Kimi job.
  modes             List supported modes.

Run "kci delegate --help" for delegate options.
Run "kci code --help" for Kimi Code prompt-mode options.
`);
}

function printDelegateHelp() {
  stdout.write(`Usage:
  kci delegate [options] [task]

Options:
  --mode <mode>        ${KIMI_MODES.join(" | ")}
  --input <path>       Attach an input file; repeatable.
  --image <path>       Attach a screenshot/image as OpenAI-compatible image content; repeatable.
  --context <text>     Add short context; repeatable.
  --json               Ask for and emit stable JSON, or raw fallback if Kimi does not comply.
  --background         Run as a tracked background job. Use for long UI/copy tasks.
  -m, --model <id>     Override model. Default: kimi-k2.6:cloud.
  --base-url <url>     Override OpenAI-compatible base URL. Default: http://localhost:11434/v1.
  --timeout-ms <ms>    Abort a stuck request after this many ms. Default: 180000.
  --dry-run            Print routing metadata without calling Kimi.
`);
}

function printCodeHelp() {
  stdout.write(`Usage:
  kci code [options] [task]

Options:
  --mode <mode>           ${KIMI_MODES.join(" | ")}
  --input <path>          Attach an input file as prompt context; repeatable.
  --image <path>          Ask Kimi Code to read this image path with ReadMediaFile; repeatable.
  --context <text>        Add short context; repeatable.
  --json                  Ask for and emit stable JSON, or raw fallback if Kimi does not comply.
  --cwd, --cd <path>      Working directory for Kimi Code. Default: cwd.
  -m, --model <id>        Override Kimi Code model alias.
  --kimi-bin <path>       Override Kimi Code binary.
  --output-format <fmt>   Kimi Code output format: text or stream-json. Default: text.
  --timeout-ms <ms>       Abort a stuck Kimi Code request. Default: 180000.
  --dry-run               Print routing metadata without calling Kimi Code.
`);
}

function printHealthHelp() {
  stdout.write(`Usage:
  kci health [options]

Options:
  --json               Emit JSON.
  -m, --model <id>     Override model.
  --base-url <url>     Override OpenAI-compatible base URL.
  --timeout-ms <ms>    Text-smoke timeout. Default: 60000.
  --vision-smoke       Also run a tiny red-image Kimi Code ReadMediaFile smoke.
`);
}
