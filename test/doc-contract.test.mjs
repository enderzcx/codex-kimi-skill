import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README documents Kimi runtime, image, and raw result handling", () => {
  const readme = readFileSync("README.md", "utf8");
  const readmeEn = readFileSync("README.en.md", "utf8");
  assert.match(readme, /English/);
  assert.match(readme, /目录结构/);
  assert.match(readme, /kimi-k2\.6:cloud/);
  assert.match(readme, /kci result <job-id>/);
  assert.match(readme, /kci result --json <job-id>/);
  assert.match(readme, /kci code/);
  assert.match(readme, /raw-fallback/);
  assert.match(readme, /--image/);
  assert.match(readme, /image_payload_sent: true/);
  assert.match(readme, /image_delivery_confirmed: true/);
  assert.match(readmeEn, /Kimi K2\.6/);
  assert.match(readmeEn, /ReadMediaFile/);
});

test("public README files do not expose internal collaboration rules", () => {
  const combined = `${readFileSync("README.md", "utf8")}\n${readFileSync("README.en.md", "utf8")}`;
  const forbidden = [
    /Sunny/i,
    /MiMo/i,
    /Reasonix/i,
    /DeepSeek/i,
    /\bG2\b/,
    /\bG3\b/,
    /rollback/i,
    /\/Users\/sunny/,
    /sunny-meta-skill/i,
    /check_sunny_skill/i,
    /客户数据/,
    /支付/,
    /权限/,
    /凭据/,
    /内部/,
    /本地习惯/,
    /验收边界/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(combined, pattern);
  }
});

test("skill documents Kimi result handling discipline", () => {
  const skill = readFileSync("skill/SKILL.md", "utf8");
  assert.match(skill, /Result Handling/);
  assert.match(skill, /kci result <job-id>/);
  assert.match(skill, /kci result --json <job-id>/);
  assert.match(skill, /kci code/);
  assert.match(skill, /raw-fallback/);
  assert.match(skill, /Do not say Kimi was used unless/);
  assert.match(skill, /true Kimi vision review/i);
  assert.match(skill, /image_delivery_confirmed: true/);
  assert.match(skill, /runtime\.md/);
  assert.match(skill, /result-handling\.md/);
  assert.match(skill, /prompt-templates\.md/);
});

test("split skill docs keep runtime, result, and prompt concerns separate", () => {
  const runtime = readFileSync("skill/runtime.md", "utf8");
  const results = readFileSync("skill/result-handling.md", "utf8");
  const prompts = readFileSync("skill/prompt-templates.md", "utf8");
  assert.match(runtime, /kci delegate/);
  assert.match(runtime, /kci code/);
  assert.match(runtime, /No service is started/);
  assert.match(results, /source-of-truth/);
  assert.match(results, /raw-fallback/);
  assert.match(prompts, /Frontend first pass/);
  assert.match(prompts, /UI review CN/);
});

test("AGENTS keeps plugin-cc-style background and result contract", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  assert.match(agents, /openai\/codex-plugin-cc/);
  assert.match(agents, /kci delegate --mode <mode> --background --json/);
  assert.match(agents, /kci result --json <job-id>/);
  assert.match(agents, /raw fallback/);
});
