# codex-kimi-skill

Chinese is the primary README: [README.md](README.md)

`codex-kimi-skill` is a local Codex skill and CLI that routes former routine MiMo work to Kimi K2.6 Cloud: copywriting, Chinese UI wording, UX briefs, visual briefs, human feedback, screenshot review, and G2 internal frontend first-pass candidates.

This is v0.1 for Sunny's local workflow, not a public release. `codex-mimo` remains installed as the rollback path.

## Scope

Owned by Kimi:

- `copywrite`, `rewrite-cn`, `naming`, `human-feedback`
- `layout-director`, `frontend-ux-plan`, `frontend-first-pass`
- `visual-brief`, `ui-review-cn`
- text context through `--input`
- screenshot/image review through Kimi Code `ReadMediaFile` via `kci code --image`
- JSON extraction plus `raw-fallback`

Not owned:

- Reasonix / DeepSeek v4 Pro engineering final review
- autonomous production UI delivery
- payment, permissions, credentials, customer data, or other G3 flows
- deleting MiMo or making replacement irreversible

## Repository Layout

```text
.
├── bin/                  # kci / codex-kimi CLI entry
├── scripts/              # install scripts
├── skill/                # source Codex skill, installed as ~/.codex/skills/codex-kimi
├── src/                  # CLI and Kimi/Ollama runtime
├── test/                 # node:test contract tests
├── README.md             # Chinese entry
└── README.en.md          # English entry
```

The repository uses `skill/` for a cleaner GitHub layout. Installation still writes the standard skill directories:

```text
~/.codex/skills/codex-kimi
~/.agents/skills/codex-kimi
```

## Install

```bash
npm link
npm run install:skill
```

Available commands:

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

Copy / UX / naming:

```bash
kci delegate --mode copywrite --json "只回复一句中文短 CTA"
kci delegate --mode frontend-ux-plan --json "给一个内部 dashboard 的信息层级建议"
```

Repo-aware context:

```bash
kci code --mode frontend-ux-plan --json --input package.json "结合仓库上下文给 UX plan"
```

Screenshot review through Kimi Code + ReadMediaFile:

```bash
kci code --mode ui-review-cn --json --image /tmp/red.png "识别主色，只返回 RED"
```

Background jobs:

```bash
kci delegate --mode frontend-first-pass --background --json "内部 dashboard 首版"
kci status <job-id>
kci result <job-id>
kci result --json <job-id>
kci cancel <job-id>
```

## Runtime

- Default base URL: `http://localhost:11434/v1`
- Default model: `kimi-k2.6:cloud`
- API key: local Ollama accepts a placeholder; the CLI reads `KIMI_API_KEY`, `OLLAMA_API_KEY`, `ollamaApiKey`, or `ollama`
- No fallback model is selected automatically; missing `kimi-k2.6:cloud` is a health failure
- `kci code` uses Kimi Code CLI prompt mode; images are read through `ReadMediaFile`
- v0.1 is Sunny-local: Kimi Code binary/config checks prefer `/Users/sunny/.kimi-code`

## Result Handling

With `--json`, `kci` tries direct JSON parsing, fenced JSON extraction, balanced JSON extraction, then `raw-fallback`.

`raw-fallback` keeps model output in `deliverables[0].content`; background jobs also retain `raw`. Do not summarize a model result until the actual `kci result` output has been read.

## Image Truthfulness

`kci code --image` passes image paths into Kimi Code prompt mode and instructs Kimi Code to call `ReadMediaFile`.

A successful image route should include:

- `image_payload_sent: true`
- `image_delivery_route: "kimi-code-read-media-file"`
- `image_delivery_confirmed: true`

`image_delivery_confirmed: true` is route-level confirmation only. Real UI review still requires the response to match visible screenshot content.

`kci delegate --image` remains only a direct Ollama OpenAI-compatible diagnostic route, not the v0.1 screenshot-review acceptance path.

## Verification

```bash
npm test
kci health --json
kci health --json --vision-smoke
python3 /Users/sunny/.agents/skills/sunny-meta-skill/scripts/check_sunny_skill.py /Users/sunny/Work/CODEX/deepseek/codex-kimi-skill/skill
git diff --check
```
