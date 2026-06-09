# Runtime

Use `kci` only for Kimi copy, naming, human feedback, UI/UX, visual brief, Chinese UI review, and G2 internal frontend first-pass candidates.

Preferred command:

```bash
kci delegate --mode <mode> --json "<task>"
```

Kimi Code prompt-mode route:

```bash
kci code --mode frontend-ux-plan --json --input package.json "结合仓库上下文给 UX plan"
```

This route uses Kimi Code CLI with text/file prompt context. Kimi Code prompt mode requires a configured login/default model; when `--json` is used, failures are returned as structured JSON.

For images, `kci code --image` passes the image paths to Kimi Code and instructs it to call `ReadMediaFile`. This is the v0.1 screenshot-review route. The direct Ollama OpenAI-compatible image payload route used by `kci delegate --image` is diagnostic only.

v0.1 is Sunny-local. Kimi Code binary/config checks use `/Users/sunny/.kimi-code`; do not treat this wrapper as portable CI or multi-user tooling yet.

Health:

```bash
kci health --json
kci health --json --vision-smoke
```

`kci health` verifies Kimi CLI version, Ollama OpenAI-compatible `/models`, `kimi-k2.6:cloud` presence, `ollama show` capabilities, and a text smoke. `--vision-smoke` additionally writes a tiny red PNG under `/tmp`, asks Kimi Code to read it with `ReadMediaFile`, and reports whether image delivery was confirmed; if that smoke fails, top-level `ok` is false for that command. If the model is missing or Ollama is not signed in, stop and report that exact blocker.

For screenshot-based visual review:

```bash
kci code --mode ui-review-cn --json \
  --input ./app/page.tsx \
  --image /tmp/page-desktop.png \
  --image /tmp/page-mobile.png \
  "基于代码和截图审核 UI 文案、视觉层级、密度、对齐和移动端问题"
```

`--input` is text-only. `kci code --image` uses Kimi Code `ReadMediaFile`. `kci delegate --image` is a direct Ollama image diagnostic route, not the v0.1 acceptance path. Do not say Kimi saw screenshots unless the command succeeded and `image_delivery_confirmed: true` is present.

Long work should run in the background:

```bash
kci delegate --mode frontend-first-pass --background --json "<task>"
kci status <job-id>
kci result <job-id>
kci result --json <job-id>
kci cancel <job-id>
```

No service is started by `kci delegate`; it calls the local Ollama OpenAI-compatible API directly.
