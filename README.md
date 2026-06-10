# codex-kimi-skill

[English README](README.en.md)

`codex-kimi-skill` 是一个 Codex skill + CLI，用于把文案、中文 UI、UX brief、visual brief、截图 review 等任务交给 Kimi K2.6 Cloud。

它提供两个命令：

```bash
kci
codex-kimi
```

## 功能

- 文案、命名、中文表达润色
- UI 文案、信息层级、UX brief、visual brief
- 通过 `--input` 附加文本文件上下文
- 通过 `kci code --image` 调用 Kimi Code，并使用 `ReadMediaFile` 读取截图
- 后台任务：`status`、`result`、`cancel`
- `--json` 输出、JSON 提取和 `raw-fallback`

## 目录结构

```text
.
├── bin/                  # kci / codex-kimi CLI 入口
├── scripts/              # 安装脚本
├── skill/                # Codex skill 源文件
├── src/                  # CLI 和 Kimi/Ollama runtime
├── test/                 # node:test 契约测试
├── README.md             # 中文入口
└── README.en.md          # 英文入口
```

仓库里使用 `skill/` 保持 GitHub 展示简洁。安装后会写入标准 skill 路径：

```text
~/.codex/skills/codex-kimi
~/.agents/skills/codex-kimi
```

## 安装

```bash
npm link
npm run install:skill
```

确认命令可用：

```bash
kci --help
codex-kimi --help
```

## 常用命令

健康检查：

```bash
kci health --json
kci health --json --vision-smoke
```

文案和 UX：

```bash
kci delegate --mode copywrite --json "只回复一句中文短 CTA"
kci delegate --mode frontend-ux-plan --json "给一个 dashboard 的信息层级建议"
```

带文件上下文：

```bash
kci code --mode frontend-ux-plan --json --input package.json "结合仓库上下文给 UX plan"
```

截图 review：

```bash
kci code --mode ui-review-cn --json --image /tmp/screenshot.png "基于截图审核中文 UI"
```

后台任务：

```bash
kci delegate --mode frontend-first-pass --background --json "生成 dashboard 首版建议"
kci status <job-id>
kci result <job-id>
kci result --json <job-id>
kci cancel <job-id>
```

## Runtime

- 默认 base URL：`http://localhost:11434/v1`
- 默认模型：`kimi-k2.6:cloud`
- API key：CLI 会读取 `KIMI_API_KEY`、`OLLAMA_API_KEY`、`ollamaApiKey` 或 `ollama`
- `kci delegate` 调用 Ollama OpenAI-compatible chat completions
- `kci code` 使用 Kimi Code CLI prompt mode
- `kci code --image` 会要求 Kimi Code 使用 `ReadMediaFile` 读取图片路径
- `kci code --skills-dir <path>` 会把目录传给 Kimi Code；该参数可重复，相对路径按 `--cwd` 解析
- `kci code --output-format stream-json --json` 会解析 Kimi Code JSONL 事件，并在结果里记录 assistant/tool 计数
- 长文档请求使用 `--json` 时，CLI 仍输出稳定 JSON；但为了减少空输出，底层模型请求会自动放宽 provider 级 JSON 约束。需要强制 provider JSON 时可加 `--strict-json`
- 长文档响应默认 token budget 会提高；也可以用 `--max-tokens <n>` 手动指定

Kimi Code provider 检查：

```bash
kimi doctor
kimi provider list --json
```

`kci health --json` 会检查：

- Kimi Code CLI
- Ollama OpenAI-compatible `/models`
- `kimi-k2.6:cloud` 是否存在
- `ollama show kimi-k2.6:cloud` capabilities
- Kimi 文本 smoke

`--vision-smoke` 会额外生成一张临时红色 PNG，并要求 Kimi Code 读取它。成功结果会包含 `vision_smoke.image_delivery_route` 和 `vision_smoke.image_delivery_confirmed`。

## 结果处理

请求 `--json` 时，`kci` 会按顺序尝试：

1. 直接 JSON parse
2. fenced JSON extraction
3. balanced JSON object extraction
4. `raw-fallback`

`raw-fallback` 会把模型原文放进 `deliverables[0].content`。后台任务也会保留 `raw`，可通过 `kci result --json <job-id>` 查看。

长文档或长 HTML 建议：

```bash
kci delegate --mode rewrite-cn --json --input ./page.html "把面向用户的表达改得更自然"
kci delegate --mode rewrite-cn --background --json --input ./page.html "长文档改写建议"
```

这类请求默认会避免强制模型返回 JSON，但命令本身仍会输出 JSON wrapper，方便后续 agent 读取。

## 图片处理

`kci code --image` 会把图片路径交给 Kimi Code prompt mode，并要求 Kimi Code 调用 `ReadMediaFile`。成功结果会带：

- `image_payload_sent: true`
- `image_delivery_route: "kimi-code-read-media-file"`
- `image_delivery_confirmed: true`

这些字段表示图片传递路线成功。做视觉 review 时，仍应确认输出是否和截图可见内容一致。

## 验证

```bash
npm test
kci health --json
kci health --json --vision-smoke
git diff --check
```
