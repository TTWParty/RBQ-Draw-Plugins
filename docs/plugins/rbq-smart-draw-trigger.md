# 智能生图触发器 (Smart Draw Trigger)

插件 ID：`rbq-smart-draw-trigger`

入口文件：[`../../plugins/smart-draw-trigger.js`](../../plugins/smart-draw-trigger.js)

版本：`1.9.1`

---

## 功能简介

智能生图触发器用于解决传统世界书生图方案的两个问题：

1. 正文输出大量 `[scene]...[/scene]` 或其他长 tag，污染后续上下文。
2. 部分模型输出 tag 时可能被审核、截断或格式破坏。

本插件的思路是：**正文不再输出完整生图 tag**。插件读取当前消息和最近上下文，调用外部 tagger API 生成完整 prompt，然后只在界面中插入 RBQ 原生生图卡片。

完整 prompt 只存在插件缓存中，不写入聊天正文。

从 `1.2.0` 开始，插件新增**世界书兼容第一期**：

- 支持通过文件选择器导入酒馆世界书 JSON。
- 支持挂载多个世界书源。
- 第一阶段支持 `constant / key / keysecondary / order / disable / selectiveLogic` 命中。
- 支持按消息条数实现 `sticky / cooldown`。
- 支持基础递归限制：`preventRecursion / excludeRecursion`。

从 `1.3.0` 开始，插件新增**多角色结构化输出模式**：

- 新增“多角色输出模式”开关。
- tagger 可返回结构化多角色 JSON：`scene / characters / center / uc`。
- 插件会在本地把结构化结果拼成 `Scene / CharN / CharN UC / |centers:` 协议文本。
- 这样就能直接兼容 [`multi-char-composer`](../rbq-multi-char.md) 的多角色 payload 改写逻辑。

从 `1.4.0` 开始，插件新增**手动 tagger 触发模式**：

- 新增 `自动调用 tagger API` 开关，默认关闭。
- 默认行为改为：楼层里先出现 Smart Draw 按钮，点击后才开始“解析世界书 → 调 tagger → 生成 prompt”。
- 状态会区分为：
  - 按钮已生成
  - 正在调用 tagger API
  - tagger 已返回
  - 正在调用 RBQ 生图
- 只有在同时开启：
  - `自动调用 tagger API`
  - RBQ 主设置里的 `自动生成`
  才会自动从 tagger 继续走到生图。

从 `1.8.0` 开始，插件新增**多档内置 System Prompt 模板**：

- `严格结构化版`
  - 最强调 `segments[]`
  - 最强调多角色结构化返回
  - 适合调试插图点与多角色协议

- `平衡版`
  - 仍然输出结构化 JSON
  - 但减少“世界书驱动协议执行器”那种过重措辞
  - 更适合让模型先理解剧情，再结构化输出

- `旧版回退版`
  - 接近早期更宽松的单 prompt 风格
  - 适合拿来做对照测试

设置页现在支持：
- 选择内置 Prompt 档位
- 查看当前本地 Prompt 版本/来源
- 一键“重置为所选内置 Prompt”

如果你之前已经保存过旧 `systemPrompt`，插件升级**不会自动覆盖**本地保存值；需要你手动点击重置按钮。

从 `1.9.0` 开始，插件重点优化**功能体验**：

- `segments[]` 会渲染为多个独立生图卡片，每个卡片拥有独立 prompt、按钮状态和自动生图标记。
- `anchor.text` 会被保留并优先用于插入定位，定位失败才回退到 `anchor.index`。
- 自动生图按 segment 独立执行，避免多段结果只生成第一段或互相串状态。
- “重新扫描/恢复可见楼层”支持恢复可见历史楼层中的 Smart Draw 卡片。

从 `1.9.1` 开始，插件优化**内置 System Prompt**：

- 严格版更强调视觉焦点判定、`anchor.text` 原文锚点、`segments[]` 多分镜和多角色结构。
- 平衡版降低过度堆词倾向，要求只吸收与当前画面相关的世界书/规则书内容。
- 旧版回退版也补齐 `anchor.text` 与 `segments[]` 兼容字段，便于老接口逐步迁移。
- 内置 Prompt 版本升级到 `v5`，旧本地 Prompt 不会自动覆盖，需要手动点击“重置为所选内置 Prompt”。

---

## 前置要求

- 主 RBQ 扩展版本必须为 `0.3.5` 或更高。
- 已配置好 RBQ 主扩展的 NAI / ComfyUI / 其他生图模式。
- 已准备一个 OpenAI 兼容接口，或一个自定义 HTTP tagger 接口。

---

## 触发模式

插件提供四种模式：

### 关闭

插件不扫描消息，也不调用 tagger API。

### 仅短标记

正文里出现短标记时才触发。

默认短标记：

```text
[draw]
[画图]
```

消息原始内容：

```text
她推开门走进昏暗房间。[draw] 窗外雨声很重。
```

用户看到：

```text
她推开门走进昏暗房间。
[RBQ 生图卡片]
窗外雨声很重。
```

短标记会在界面中被隐藏并替换成卡片，但不会被改写为长 prompt。

### 仅自动定位

正文不需要任何标记。插件会把当前消息和最近上下文发送给 tagger API，由 API 判断：

- 是否需要生图。
- prompt 是什么。
- 图片应该插到当前消息第几句后面。

### 自动定位 + 短标记兜底

推荐模式。

- 如果消息中有短标记，优先按短标记位置插卡片。
- 如果没有短标记，则调用 tagger API 自动判断和定位。

---

## 自动生成策略

插件跟随 RBQ 主设置：

- RBQ 主设置中“自动生成”开启：tagger 返回 prompt 后自动调用 RBQ 生图。
- RBQ 主设置中“自动生成”关闭：只显示“生成图片”按钮，用户点击后才出图。

---

## 配置项

插件设置位于 RBQ 控制台左侧控制面板中的 **智能触发** 独立栏目。

### 启用插件

总开关。新安装后默认关闭，需要手动开启。

### 触发模式

可选：

- 关闭
- 仅短标记
- 仅自动定位
- 自动定位 + 短标记兜底

### 监听消息

可选：

- 仅角色消息
- 仅用户消息
- 全部消息

默认建议保持“仅角色消息”。

### 上下文条数

发送给 tagger API 的最近消息数量。

默认：`5`

范围：`1` 到 `50`

### 触发调试提示

默认关闭。开启后会用 toastr 提示以下阶段：

- 已扫描消息但角色不在监听范围。
- 已扫描消息但没有匹配短标记。
- 已触发并开始请求 tagger API。
- tagger 已返回，判断需要/不需要生图。
- 命中缓存或跳过重复请求。

排查触发问题时建议保持开启；正常使用稳定后可关闭。

### 短标记

每行一个。默认：

```text
[draw]
[画图]
```

### 轻量规则书

轻量规则书类似 SillyTavern 世界书，但它**只发送给 tagger API**，不会写进聊天正文，也不会进入主模型上下文。

用途：

- 放置生图格式指导。
- 放置角色外观规则。
- 放置画风、构图、镜头、负面偏好等 tagger 专用规则。

规则书配置为 JSON 数组：

```json
[
  {
    "name": "画风总规则",
    "enabled": true,
    "constant": true,
    "keys": [],
    "priority": 100,
    "content": "输出英文逗号分隔 prompt，优先提炼当前画面主体、服装、表情、动作、场景、光照。"
  },
  {
    "name": "雨夜场景",
    "enabled": true,
    "constant": false,
    "keys": ["雨", "夜", "雨声"],
    "priority": 80,
    "content": "如果当前场景包含雨夜，加入 rain, wet skin/clothes, cinematic lighting, dark atmosphere 等视觉元素。"
  }
]
```

字段含义：

- `enabled`：是否启用该条规则。
- `constant`：相当于“绿灯”，始终注入 tagger 请求。
- `keys`：相当于“蓝灯”关键词，最近上下文命中关键词才注入。
- `priority`：优先级，数值越高越先注入。
- `content`：实际发送给 tagger 的指导内容。

为避免 token 爆炸，规则书有两个限制：

- `规则扫描深度`：只扫描最近 N 条消息。
- `规则注入预算`：最多注入指定字符数，超出后截断低优先级规则。

---

## OpenAI 兼容接口

配置项：

- `OpenAI Base URL`
- `OpenAI API Key`
- `OpenAI Model`
- `System Prompt`

界面会提供“刷新模型”按钮。填写 Base URL 和 API Key 后，插件会请求 `/models` 获取模型列表，并把 `OpenAI Model` 显示为下拉选择。

如果 Base URL 填：

```text
https://api.openai.com/v1
```

插件会请求：

```text
https://api.openai.com/v1/chat/completions
```

如果 Base URL 已经以 `/chat/completions` 结尾，则直接使用该地址。

插件会要求模型返回 JSON 对象。

---

## 自定义 HTTP 接口

配置项：

- `自定义 HTTP URL`
- `自定义密钥 Header`
- `自定义密钥`

插件会向该 URL 发送 `POST` 请求，`Content-Type` 为 `application/json`。

如果填写密钥：

- Header 名为 `Authorization` 时，发送 `Bearer <key>`。
- 其他 Header 名时，直接发送 `<key>`。

---

## 请求 JSON 格式

OpenAI 兼容模式下，此结构会作为 user message 的 JSON 内容发送。

自定义 HTTP 模式下，此结构会作为请求体发送。

```json
{
  "mode": "auto",
  "marker": "",
  "messageId": 12,
  "currentMessage": {
    "role": "assistant",
    "name": "角色名",
    "content": "当前楼层正文"
  },
  "recentMessages": [
    {
      "id": 8,
      "role": "user",
      "name": "User",
      "content": "最近消息正文"
    }
  ],
  "contextCount": 5,
  "outputSchema": {
    "shouldDraw": "boolean",
    "prompt": "string",
    "negative": "string optional",
    "anchor": {
      "type": "sentence",
      "index": "number, 1-based",
      "text": "string optional, original sentence text"
    },
    "reason": "string optional",
    "segments": [
      {
        "anchor": {
          "type": "sentence",
          "index": "number, 1-based",
          "text": "string optional, original sentence text"
        },
        "prompt": "string",
        "negative": "string optional",
        "multiChar": "boolean optional",
        "scene": "string optional",
        "characters": "array optional"
      }
    ]
  }
}
```

字段说明：

- `mode`：`marker` 或 `auto`。
- `marker`：短标记内容；自动定位时为空。
- `currentMessage`：当前楼层。
- `recentMessages`：最近上下文。
- `contextCount`：用户配置的上下文条数。

---

## 返回 JSON 格式

tagger API 应返回：

```json
{
  "shouldDraw": true,
  "prompt": "1girl, cinematic lighting, rain, detailed face",
  "negative": "low quality, bad anatomy",
  "anchor": {
    "type": "sentence",
    "index": 1,
    "text": "她推开门走进昏暗房间。"
  },
  "reason": "当前消息出现明确视觉场景"
}
```

字段说明：

- `shouldDraw`：是否插入生图卡片。
- `prompt`：实际用于 RBQ 生图的完整 prompt，不要包含 `[scene]` 或 `[img]`。
- `negative`：可选，第一版仅缓存，不强制覆盖 RBQ 主负面词。
- `anchor.type`：目前建议固定为 `sentence`。
- `anchor.index`：插在当前消息第几句后，从 `1` 开始。
- `anchor.text`：可选但强烈建议填写，直接摘抄当前消息原句；插件会优先按它定位卡片插入位置。
- `reason`：可选，用于调试。

如果一条消息需要多个插图点，可以返回 `segments[]`：

```json
{
  "shouldDraw": true,
  "reason": "当前消息有两个视觉高潮点",
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 1, "text": "她推开门走进昏暗房间。" },
      "prompt": "1girl, entering dark room, cinematic lighting",
      "negative": "low quality"
    },
    {
      "anchor": { "type": "sentence", "index": 3, "text": "窗外雨水在玻璃上拖出长长的光痕。" },
      "prompt": "rainy window, neon reflection, moody atmosphere",
      "negative": "low quality"
    }
  ]
}
```

`1.9.0` 起，每个 segment 会变成独立卡片，并独立记录是否已自动生图。

如果不需要生图：

```json
{
  "shouldDraw": false,
  "prompt": "",
  "negative": "",
  "anchor": { "type": "sentence", "index": 1 },
  "reason": "当前消息无明确视觉场景"
}
```

---

## 缓存与去重

插件使用以下因素生成缓存 key：

- `messageId`
- 当前消息正文哈希
- 触发模式
- 短标记内容或自动定位标识
- segment prompt 哈希（用于区分多段卡片状态）

这样可以避免刷新、滑动、消息重渲染时重复调用 tagger API 或重复生图。

缓存最多保留约 `200` 条，超过后自动清理旧缓存。

---

## 注意事项

- 自动定位模式会把最近上下文发送给外部 tagger API，请注意隐私和成本。
- 插件会监听消息 DOM 的新增与文本变化；如果宿主聊天数据尚未同步，会使用页面正文文本作为兜底，以避免正文已经输出但 tagger 未触发。
- 插件不再周期轮询；默认只在消息新增/文本变化/初始加载时处理最新楼层，并在当前页面会话中记住已处理 key，避免同一消息反复恢复卡片。
- 如果 tagger 返回了 `anchor.text`，插件会优先按原句匹配；如果匹配失败，再回退到 `anchor.index`；仍失败时把卡片追加到消息末尾。
- 插件不会修改聊天正文，也不会把完整 prompt 写回 SillyTavern 聊天记录。
- 插件依赖宿主 `0.3.5+` 的 `RBQ.api.createPromptCard()` 和 `RBQ.api.generateImage()` 等接口。
