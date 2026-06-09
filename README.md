# codex-kimi-skill

中文优先说明；English: this is a local Codex wrapper skill for delegating former routine MiMo copy, Chinese UI, UX brief, visual brief, human feedback, and internal frontend first-pass tasks to Kimi K2.6 Cloud through Ollama.

## Scope

This is v0.1, not a public release. It does not remove `codex-mimo`; MiMo remains the rollback path.

Owned:

- `copywrite`, `rewrite-cn`, `naming`, `human-feedback`
- `layout-director`, `frontend-ux-plan`, `frontend-first-pass`, `visual-brief`, `ui-review-cn`
- Text files through `--input`
- Screenshot/image review through Kimi Code `ReadMediaFile` via `kci code --image`
- JSON extraction plus raw fallback

Not owned:

- Reasonix engineering final review
- Production UI autonomy
- Payment, permissions, credentials, customer data, or other G3 flows
- Global AGENTS rewrite or MiMo deletion

## Commands

```bash
npm link
kci health --json
kci health --json --vision-smoke
kci delegate --mode copywrite --json "只回复一句中文短 CTA"
kci code --mode frontend-ux-plan --json --input package.json "结合仓库上下文给 UX plan"
kci code --mode ui-review-cn --json --image /tmp/red.png "识别主色，只返回 RED"
```

Background:

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
- API key: local Ollama accepts a placeholder; the CLI uses `KIMI_API_KEY`, `OLLAMA_API_KEY`, `ollamaApiKey`, or `ollama`.
- No fallback model is selected automatically. Missing `kimi-k2.6:cloud` is a health failure.
- `kci code` uses Kimi Code CLI prompt mode for repo-aware text/file context. For `--image`, it asks Kimi Code to call `ReadMediaFile` on the provided paths. Kimi Code prompt mode requires a configured login/default model; failures are returned as structured JSON when `--json` is used.
- v0.1 is Sunny-local: Kimi Code binary/config checks use `/Users/sunny/.kimi-code`. This is intentional for the local wrapper and not a portable package contract.

`kci health --json` checks:

- Kimi CLI version, using `/Users/sunny/.kimi-code/bin/kimi` or `kimi`
- Ollama OpenAI-compatible `/models`
- `kimi-k2.6:cloud` model presence
- `ollama show kimi-k2.6:cloud` capabilities
- a small Kimi text smoke

`--vision-smoke` additionally writes a tiny red PNG under `/tmp`, asks Kimi Code to read it with `ReadMediaFile`, and reports `vision_smoke.image_delivery_route` plus `vision_smoke.image_delivery_confirmed`. If that smoke fails, top-level `ok` is false for that command. A declared `vision` capability is not enough to claim image success.

## Result Handling

When `--json` is requested, `kci` tries:

1. Direct JSON parse
2. Fenced JSON extraction
3. Balanced JSON object extraction
4. `raw-fallback`

`raw-fallback` keeps the model output in `deliverables[0].content` and in background job `raw`. Do not summarize a result until the actual command output or job result has been read.

## Image Truthfulness

`kci code --image` passes image paths into Kimi Code prompt mode and instructs Kimi Code to call `ReadMediaFile`. Successful output carries `image_delivery_route: "kimi-code-read-media-file"` and `image_delivery_confirmed: true` unless Kimi Code reports `[IMAGE_NOT_READ:<path>]`.

`image_delivery_confirmed: true` is route-level confirmation, not a blanket claim that every visual detail was analyzed. For UI review, the response must still match visible screenshot content.

`kci delegate --image` remains a direct Ollama OpenAI-compatible diagnostic route, but it is not the v0.1 screenshot-review acceptance path.

Do not claim Kimi saw a screenshot unless:

- the command used `--image`;
- `image_payload_sent: true` is present; and
- `image_delivery_confirmed: true` is present; and
- the Kimi response is consistent with the visible image when the task is visual.

## Install Skill

```bash
npm run install:skill
python3 /Users/sunny/.agents/skills/sunny-meta-skill/scripts/check_sunny_skill.py /Users/sunny/Work/CODEX/deepseek/codex-kimi-skill/skills/codex-kimi
```
