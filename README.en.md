# codex-kimi-skill

[中文说明](README.md)

`codex-kimi-skill` is a Codex skill and CLI for routing copywriting, Chinese UI wording, UX briefs, visual briefs, screenshot review, and related tasks to Kimi K2.6 Cloud.

It provides two commands:

```bash
kci
codex-kimi
```

## Features

- Copywriting, naming, and Chinese wording polish
- UI copy, information hierarchy, UX briefs, and visual briefs
- Text file context through `--input`
- Screenshot review through `kci code --image`, using Kimi Code `ReadMediaFile`
- Background jobs with `status`, `result`, and `cancel`
- `--json` output, JSON extraction, and `raw-fallback`

## Repository Layout

```text
.
├── bin/                  # kci / codex-kimi CLI entry
├── scripts/              # install scripts
├── skill/                # Codex skill source
├── src/                  # CLI and Kimi/Ollama runtime
├── test/                 # node:test contract tests
├── README.md             # Chinese entry
└── README.en.md          # English entry
```

The repository uses `skill/` for a cleaner GitHub layout. Installation writes the standard skill paths:

```text
~/.codex/skills/codex-kimi
~/.agents/skills/codex-kimi
```

## Install

```bash
npm link
npm run install:skill
```

Check the commands:

```bash
kci --help
codex-kimi --help
```

## Commands

Health:

```bash
kci health --json
kci health --json --vision-smoke
```

Copy and UX:

```bash
kci delegate --mode copywrite --json "只回复一句中文短 CTA"
kci delegate --mode frontend-ux-plan --json "给一个 dashboard 的信息层级建议"
```

Repo-aware context:

```bash
kci code --mode frontend-ux-plan --json --input package.json "结合仓库上下文给 UX plan"
```

Screenshot review:

```bash
kci code --mode ui-review-cn --json --image /tmp/screenshot.png "基于截图审核中文 UI"
```

Background jobs:

```bash
kci delegate --mode frontend-first-pass --background --json "生成 dashboard 首版建议"
kci status <job-id>
kci result <job-id>
kci result --json <job-id>
kci cancel <job-id>
```

## Runtime

- Default base URL: `http://localhost:11434/v1`
- Default model: `kimi-k2.6:cloud`
- API key: the CLI reads `KIMI_API_KEY`, `OLLAMA_API_KEY`, `ollamaApiKey`, or `ollama`
- `kci delegate` calls Ollama OpenAI-compatible chat completions
- `kci code` uses Kimi Code CLI prompt mode
- `kci code --image` asks Kimi Code to read image paths with `ReadMediaFile`

`kci health --json` checks:

- Kimi Code CLI
- Ollama OpenAI-compatible `/models`
- `kimi-k2.6:cloud` model presence
- `ollama show kimi-k2.6:cloud` capabilities
- Kimi text smoke

`--vision-smoke` also creates a temporary red PNG and asks Kimi Code to read it. A successful result includes `vision_smoke.image_delivery_route` and `vision_smoke.image_delivery_confirmed`.

## Result Handling

With `--json`, `kci` tries:

1. Direct JSON parse
2. Fenced JSON extraction
3. Balanced JSON object extraction
4. `raw-fallback`

`raw-fallback` keeps model output in `deliverables[0].content`. Background jobs also retain `raw`, available through `kci result --json <job-id>`.

## Image Handling

`kci code --image` passes image paths into Kimi Code prompt mode and instructs Kimi Code to call `ReadMediaFile`. A successful result includes:

- `image_payload_sent: true`
- `image_delivery_route: "kimi-code-read-media-file"`
- `image_delivery_confirmed: true`

These fields confirm the image delivery route. For visual review, still check that the response matches the visible screenshot content.

## Verification

```bash
npm test
kci health --json
kci health --json --vision-smoke
git diff --check
```
