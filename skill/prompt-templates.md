# Prompt Templates

These templates are implemented in `src/prompts.mjs`. Kimi output remains input for Codex, not an automatic patch.

Copywriting:

```text
基于这些事实写产品文案。保留事实，避免 AI 味，给标题/副标题/CTA/空态/错误态时按模块分组。
```

Frontend UX plan:

```text
输出完整 UI/UX 方案：目标用户、信息架构、关键状态、响应式、可访问性、实现注意点。Codex 会负责代码。
```

Frontend first pass:

```text
按现有 stack 输出完整候选文件内容，并附 Codex 验证清单：lint/build、浏览器截图、移动端溢出、主交互。
```

UI review CN:

```text
基于截图和上下文审核中文 UI、术语、层级、排版节奏、视觉呈现和可读性。按 must/fix/later 给建议。不要编造截图中不可见的细节。
```

Visual brief:

```text
输出给图像生成或 UI 参考图的 brief：主体、构图、材质、色彩、光线、比例、禁用项。
```

Human feedback:

```text
写给 <recipient> 的自然消息。像真人，不要 AI 报告腔，不要过度礼貌；保留必须传达的事实和行动项。
```
