# codex-kimi-skill

`codex-kimi-skill` is an Ender-local wrapper skill for routing former routine MiMo work to Kimi K2.6 Cloud through Ollama's OpenAI-compatible endpoint.

Rules:

- Keep this repo Kimi-only. Do not delete or rewrite `codex-mimo`; MiMo remains rollback for v0.1.
- Default model is `kimi-k2.6:cloud`; do not silently fall back to another model if it is missing.
- Default command is `kci delegate`; it calls `http://localhost:11434/v1/chat/completions` directly and starts no service.
- Use `kci health --json` before claiming the wrapper is usable. It must check Kimi CLI, Ollama API, model presence, and text smoke.
- For screenshots, use `kci code --mode ui-review-cn --json --image <path> "<task>"` so Kimi Code reads the file through `ReadMediaFile`. Do not say Kimi saw an image unless `image_payload_sent: true` and `image_delivery_confirmed: true` are present and the command succeeded.
- Kimi output is design, copy, review, or candidate-code input. Codex owns integration, browser validation, tests, and final decision.
- Kimi is not Reasonix. Do not use it as engineering final review for G2/G3 changes.
- Background contract follows `openai/codex-plugin-cc`: `kci delegate --mode <mode> --background --json`, then `kci status <job-id>`, `kci result <job-id>`, or `kci result --json <job-id>`.
- Preserve raw fallback output when JSON parsing fails.

Verification before closeout:

```bash
npm test
kci health --json
kci delegate --mode copywrite --json "只回复一句中文短 CTA"
kci code --mode ui-review-cn --json --image /tmp/red.png "识别主色，只返回 RED"
python3 /Users/sunny/.agents/skills/sunny-meta-skill/scripts/check_sunny_skill.py /Users/sunny/Work/CODEX/deepseek/codex-kimi-skill/skill
git diff --check
```
