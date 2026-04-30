# 智能生图触发器 (Smart Draw Trigger)

插件 ID：`rbq-smart-draw-trigger`

入口文件：[`../../plugins/smart-draw-trigger.js`](../../plugins/smart-draw-trigger.js)

版本：`1.0.1`

---

## 功能简介

智能生图触发器用于解决传统世界书生图方案的两个问题：

1. 正文输出大量 `[scene]...[/scene]` 或其他长 tag，污染后续上下文。
2. 部分模型输出 tag 时可能被审核、截断或格式破坏。

本插件的思路是：**正文不再输出完整生图 tag**。插件读取当前消息和最近上下文，调用外部 tagger API 生成完整 prompt，然后只在界面中插入 RBQ 原生生图卡片。

完整 prompt 只存在插件缓存中，不写入聊天正文。

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

### 短标记

每行一个。默认：

```text
[draw]
[画图]
```

---

## OpenAI 兼容接口

配置项：

- `OpenAI Base URL`
- `OpenAI API Key`
- `OpenAI Model`
- `System Prompt`

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
      "index": "number, 1-based"
    },
    "reason": "string optional"
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
    "index": 1
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
- `reason`：可选，用于调试。

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

这样可以避免刷新、滑动、消息重渲染时重复调用 tagger API 或重复生图。

缓存最多保留约 `200` 条，超过后自动清理旧缓存。

---

## 注意事项

- 自动定位模式会把最近上下文发送给外部 tagger API，请注意隐私和成本。
- 如果 tagger 返回的 `anchor.index` 找不到对应句子，插件会把卡片追加到消息末尾。
- 插件不会修改聊天正文，也不会把完整 prompt 写回 SillyTavern 聊天记录。
- 插件依赖宿主 `0.3.5+` 的 `RBQ.api.createPromptCard()` 和 `RBQ.api.generateImage()` 等接口。
