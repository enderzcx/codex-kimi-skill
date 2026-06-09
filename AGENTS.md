# codex-kimi-skill

`codex-kimi-skill` is a Codex skill and CLI for routing copy, Chinese UI, UX brief, visual brief, screenshot review, and related work to Kimi K2.6 Cloud.

Rules:

- Keep public-facing docs focused on user-facing capability, installation, commands, runtime, and verification.
- Do not put private workflow labels, local personal paths, collaborator routing, or internal acceptance boundaries in README files.
- Public README copy should be written or rewritten by DeepSeek / Reasonix first; Codex then fact-checks and lands it.
- Default model is `kimi-k2.6:cloud`; do not silently fall back to another model if it is missing.
- Default command is `kci delegate`; it calls `http://localhost:11434/v1/chat/completions` directly and starts no service.
- Use `kci health --json` before claiming the wrapper is usable. It must check Kimi CLI, Ollama API, model presence, and text smoke.
- For screenshots, use `kci code --mode ui-review-cn --json --image <path> "<task>"` so Kimi Code reads the file through `ReadMediaFile`. Do not say Kimi saw an image unless `image_payload_sent: true` and `image_delivery_confirmed: true` are present and the command succeeded.
- Kimi output is design, copy, review, or candidate-code input. Codex owns integration, browser validation, tests, and final decision.
- Kimi output is not an automatic patch. Codex owns integration, browser validation, tests, and final decision.
- Background contract follows `openai/codex-plugin-cc`: `kci delegate --mode <mode> --background --json`, then `kci status <job-id>`, `kci result <job-id>`, or `kci result --json <job-id>`.
- Preserve raw fallback output when JSON parsing fails.

Verification before closeout:

```bash
npm test
kci health --json
kci delegate --mode copywrite --json "只回复一句中文短 CTA"
kci code --mode ui-review-cn --json --image /tmp/red.png "识别主色，只返回 RED"
git diff --check
```
