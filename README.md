# codex-kimi-skill

中文说明为主。English entry: [README.en.md](README.en.md)

`codex-kimi-skill` 是一个本地 Codex skill + CLI，用来把原来常规交给 MiMo 的文案、中文 UI、UX brief、visual brief、人味反馈、内部前端 first-pass 任务转交给 Kimi K2.6 Cloud。

它不是公开发布版；当前是 Sunny 本机工作流的 v0.1。`codex-mimo` 不会被删除，MiMo 只保留为 rollback。

## 能做什么

默认交给 Kimi：

- `copywrite`、`rewrite-cn`、`naming`、`human-feedback`
- `layout-director`、`frontend-ux-plan`、`frontend-first-pass`
- `visual-brief`、`ui-review-cn`
- 通过 `--input` 附加文本文件
- 通过 Kimi Code `ReadMediaFile` 做截图 / 图片 review：`kci code --image`
- JSON 提取和 `raw-fallback` 兜底

不负责：

- Reasonix / DeepSeek v4 Pro 的工程 final review
- 生产 UI 自主交付
- 支付、权限、凭据、客户数据等 G3 流程
- 删除 MiMo 或全局不可回滚替换

## 目录结构

```text
.
├── bin/                  # kci / codex-kimi CLI 入口
├── scripts/              # 安装脚本
├── skill/                # Codex skill 源文件，安装时复制成 ~/.codex/skills/codex-kimi
├── src/                  # CLI 和 Kimi/Ollama runtime
├── test/                 # node:test 契约测试
├── README.md             # 中文入口
└── README.en.md          # 英文入口
```

仓库里使用 `skill/` 是为了 GitHub 展示更清晰；安装后仍然是标准 skill 路径：

```text
~/.codex/skills/codex-kimi
~/.agents/skills/codex-kimi
```

## 安装

```bash
npm link
npm run install:skill
```

安装后可用两个命令：

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

文案 / UX / 命名：

```bash
kci delegate --mode copywrite --json "只回复一句中文短 CTA"
kci delegate --mode frontend-ux-plan --json "给一个内部 dashboard 的信息层级建议"
```

带文件上下文：

```bash
kci code --mode frontend-ux-plan --json --input package.json "结合仓库上下文给 UX plan"
```

截图 review，走 Kimi Code + ReadMediaFile：

```bash
kci code --mode ui-review-cn --json --image /tmp/red.png "识别主色，只返回 RED"
```

后台任务：

```bash
kci delegate --mode frontend-first-pass --background --json "内部 dashboard 首版"
kci status <job-id>
kci result <job-id>
kci result --json <job-id>
kci cancel <job-id>
```

## Runtime

- 默认 base URL：`http://localhost:11434/v1`
- 默认模型：`kimi-k2.6:cloud`
- API key：本地 Ollama 接受 placeholder；CLI 会读取 `KIMI_API_KEY`、`OLLAMA_API_KEY`、`ollamaApiKey` 或 `ollama`
- 不会自动选 fallback model；缺少 `kimi-k2.6:cloud` 会被视为 health failure
- `kci code` 使用 Kimi Code CLI prompt mode；图片通过 `ReadMediaFile` 读取
- v0.1 是 Sunny-local wrapper：Kimi Code binary/config 检查会优先看 `/Users/sunny/.kimi-code`

`kci health --json` 会检查：

- Kimi CLI 版本
- Ollama OpenAI-compatible `/models`
- `kimi-k2.6:cloud` 是否存在
- `ollama show kimi-k2.6:cloud` capabilities
- Kimi 文本 smoke

`--vision-smoke` 会额外生成一张 `/tmp` 下的红色 PNG，并要求 Kimi Code 用 `ReadMediaFile` 读取。只有返回 `vision_smoke.image_delivery_route` 和 `vision_smoke.image_delivery_confirmed`，才算图片传递路线通过。模型声明有 `vision` capability 不等于图片 review 通过。

## 结果处理

请求 `--json` 时，`kci` 会按顺序尝试：

1. 直接 JSON parse
2. fenced JSON extraction
3. balanced JSON object extraction
4. `raw-fallback`

`raw-fallback` 会把模型原文放进 `deliverables[0].content`，后台 job 也会保留 `raw`。读到实际 `kci result` 前，不要总结模型结果。

## 图片真实性规则

`kci code --image` 会把图片路径交给 Kimi Code prompt mode，并要求 Kimi Code 调用 `ReadMediaFile`。成功结果会带：

- `image_payload_sent: true`
- `image_delivery_route: "kimi-code-read-media-file"`
- `image_delivery_confirmed: true`

`image_delivery_confirmed: true` 只是路线级确认，不代表 Kimi 一定分析了所有视觉细节。真正 UI review 还必须看输出是否和截图可见内容一致。

`kci delegate --image` 只保留为直连 Ollama OpenAI-compatible 的诊断路线，不作为 v0.1 截图 review 验收路径。

## 验证

```bash
npm test
kci health --json
kci health --json --vision-smoke
python3 /Users/sunny/.agents/skills/sunny-meta-skill/scripts/check_sunny_skill.py /Users/sunny/Work/CODEX/deepseek/codex-kimi-skill/skill
git diff --check
```
