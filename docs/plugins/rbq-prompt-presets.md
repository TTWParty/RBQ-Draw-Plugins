# 提示词预设 (Prompt Presets)

插件 ID：`rbq-prompt-presets`

入口文件：[`../../plugins/prompt-presets.js`](../../plugins/prompt-presets.js)

---

## 功能简介

提示词预设插件用于保存常用正面/负面提示词组合，并在生图请求发出前自动拼接到 prompt 中。

它通过 RBQ Hook 修改最终 payload，不需要改变聊天正文。

---

## 支持模式

插件会拦截以下流程：

- `buildNaiV4Payload`
- `buildGeneratePayload`
- `buildComfyUiWorkflow`

因此可用于 NAI、传统中转和 ComfyUI 工作流。

---

## 主要能力

- 新建、编辑、删除提示词预设。
- 选择当前激活预设。
- 设置预设追加位置：前置或后置。
- 支持正面提示词与负面提示词。
- 支持导入/导出预设。

---

## 配置入口

插件会注入 RBQ 设置面板中的提示词区域。

---

## 注意事项

- 该插件会修改最终发送给生图后端的 payload。
- 不会把预设内容写入聊天正文。
- 如果多个插件同时修改 prompt，最终顺序取决于插件加载顺序。
