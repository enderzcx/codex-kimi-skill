import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SHARED_ENVS = [
  "/Users/sunny/Work/CODEX/deepseek/.env",
  join(homedir(), ".config", "codex-kimi-skill", ".env"),
  join(homedir(), ".codex-kimi.env"),
];

export function loadKimiEnv() {
  const loaded = [];
  const seen = new Set();
  const candidates = process.env.CODEX_KIMI_ENV
    ? [process.env.CODEX_KIMI_ENV]
    : [findUpEnv(process.cwd()), ...SHARED_ENVS];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = resolve(candidate);
    if (seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    applyEnvFile(path);
    loaded.push(path);
  }

  return loaded;
}

export const DEFAULT_MODEL = "kimi-k2.6:cloud";
export const DEFAULT_BASE_URL = "http://localhost:11434/v1";

export function resolveKimiConfig({ model, baseUrl } = {}) {
  const envFiles = loadKimiEnv();
  const configuredBaseUrl =
    baseUrl ??
    process.env.KIMI_BASE_URL ??
    process.env.KIMI_URL_OPENAI ??
    process.env.OLLAMA_OPENAI_BASE_URL ??
    DEFAULT_BASE_URL;
  const apiKey =
    process.env.KIMI_API_KEY ??
    process.env.OLLAMA_API_KEY ??
    process.env.ollamaApiKey ??
    "ollama";

  return {
    apiKey,
    baseUrl: configuredBaseUrl,
    model: model ?? process.env.KIMI_MODEL ?? DEFAULT_MODEL,
    envFiles,
  };
}

function findUpEnv(startDir) {
  let dir = resolve(startDir || ".");
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function applyEnvFile(path) {
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r\n|\n|\r/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const { key, value } = parsed;
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;

  const key = match[1];
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "");
  }
  return { key, value };
}
