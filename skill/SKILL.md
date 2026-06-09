---
name: codex-kimi
description: Use when a Codex task should delegate former routine MiMo work to Kimi K2.6 Cloud through local `kci`: Chinese copy, naming, human feedback, UI/UX briefs, visual briefs, Chinese UI review, screenshot review, and G2 internal frontend first-pass candidates. Not for Reasonix engineering final review, production UI autonomy, credentials, customer data, payment/permission flows, global MiMo removal, or tasks where `codex-mimo` rollback is required.
metadata:
  short-description: Delegate copy and UI/UX taste work to Kimi K2.6
  sunny_skill_type: wrapper
---

# codex-kimi

Use this skill when a Codex task touches:

- product copy, CTA, empty/error/onboarding/tooltip copy;
- Chinese expression polishing, naming, product terminology;
- human-sounding feedback to coworkers, customers, or partners;
- UI layout direction, information hierarchy, visual rhythm, and content density;
- visual reference briefs;
- screenshot-based Chinese UI/UX critique after Codex captures browser screenshots;
- G2 internal admin, ERP, dashboard, console, or prototype frontend first-pass candidates.

## Role Boundary

- Codex owns product thinking, requirement interpretation, repo integration, code edits, tests, browser validation, accessibility, responsive behavior, and final judgment.
- Kimi owns copy, Chinese expression, UI wording, layout direction, visual briefs, naming, human feedback, screenshot critique, and G2 internal frontend first-pass candidate output.
- Reasonix engineering review stays with `crb` / `codex-reasonix`; do not replace it with Kimi.
- `codex-mimo` remains installed as rollback during v0.1; do not delete or rewrite it.

Companion docs:

- [runtime.md](runtime.md): command/runtime rules
- [result-handling.md](result-handling.md): rendered/raw output discipline
- [prompt-templates.md](prompt-templates.md): mode prompt contracts

## Command

Preferred direct Kimi call:

```bash
kci delegate --mode <mode> --json "<task>"
```

Kimi Code prompt-mode route for repo-aware text/file context:

```bash
kci code --mode <mode> --json --input package.json "<task>"
```

For image review through Kimi Code, use `kci code --image`; it asks Kimi Code to call `ReadMediaFile` on each provided path.

Health check:

```bash
kci health --json
kci health --json --vision-smoke
```

Attach text files:

```bash
kci delegate --mode ui-review-cn --json \
  --input ./app/page.tsx \
  "审核中文 UI 文案、信息层级和排版节奏"
```

Attach screenshots:

```bash
kci code --mode ui-review-cn --json \
  --image /tmp/page-desktop.png \
  --image /tmp/page-mobile.png \
  "基于截图审核中文 UI、视觉层级、密度、对齐和移动端问题"
```

Direct Ollama image diagnostic route, not the v0.1 acceptance path:

```bash
kci delegate --mode ui-review-cn --json \
  --image /tmp/page-desktop.png \
  --image /tmp/page-mobile.png \
  "诊断直连 Ollama image_url 是否可用"
```

Background:

```bash
kci delegate --mode frontend-first-pass --background --json "<task>"
kci status <job-id>
kci result <job-id>
kci result --json <job-id>
kci cancel <job-id>
```

## Result Handling

- Read actual command output before summarizing.
- `kci result <job-id>` returns rendered Markdown.
- `kci result --json <job-id>` returns full job record with `result`, `rendered`, `raw`, logs, and errors.
- If `parse_status` is `raw-fallback`, relay useful raw output and say the CLI used raw fallback.
- Do not say Kimi was used unless a real `kci`, `kimi`, or Ollama command was actually run.

## Image Truthfulness

`kci code --image` asks Kimi Code to read the path via `ReadMediaFile`; this is the v0.1 screenshot-review path. `kci delegate --image` sends image bytes as Ollama OpenAI-compatible `image_url` data URL content only as a diagnostic route. True Kimi vision review requires a successful command with `routing.image_delivery_confirmed: true` and a response consistent with the visible image. `ollama show` declaring `vision` is not enough.

Do not claim Kimi saw screenshots when:

- only file paths were mentioned in text;
- the command failed;
- the endpoint rejected image content;
- no `image_delivery_confirmed: true` metadata is present.

## Skip Cases

Skip this skill for pure internal code implementation, machine-only config, trivial typo/import edits, Reasonix final review, G3/payment/credential/customer-data flows, and cases where Ender explicitly requests MiMo or another provider.
