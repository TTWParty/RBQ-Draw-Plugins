# RBQ-Draw Plugins

这是 [`SillyTavern-RBQ-Draw`](https://github.com/TTWParty/SillyTavern-RBQ-Draw) 的官方子插件仓库。

本仓库主 [`README.md`](README.md) 只维护插件生态的**开发规范、API 文档、发布流程与目录约定**。每个具体插件都应拥有自己的独立说明文档，写清功能、配置项、使用方式和接口格式。

---

## 目录规范

```text
RBQ-Draw-Plugins/
├── plugins.json
├── README.md
├── docs/
│   └── plugins/
│       └── <plugin-id>.md
└── plugins/
    └── <plugin-file>.js
```

约定：

- [`plugins.json`](plugins.json)：插件市场索引，宿主通过它发现、安装、更新插件。
- [`plugins/`](plugins/)：插件脚本目录，每个插件原则上一个入口文件。
- [`docs/plugins/`](docs/plugins/)：每个插件的独立说明文档目录。
- 主 README 只写生态规则，不写某个插件的长篇使用说明。

---

## 当前插件索引

| 插件 ID | 名称 | 入口 | 文档 |
|---|---|---|---|
| `rbq-core-hello` | Hello World 测试扩展 | [`plugins/example-hello.js`](plugins/example-hello.js) | [`docs/plugins/rbq-core-hello.md`](docs/plugins/rbq-core-hello.md) |
| `rbq-prompt-presets` | 提示词预设 | [`plugins/prompt-presets.js`](plugins/prompt-presets.js) | [`docs/plugins/rbq-prompt-presets.md`](docs/plugins/rbq-prompt-presets.md) |
| `rbq-png-metadata` | NAI 图片信息提取器 | [`plugins/png-metadata-extractor.js`](plugins/png-metadata-extractor.js) | [`docs/plugins/rbq-png-metadata.md`](docs/plugins/rbq-png-metadata.md) |
| `rbq-smart-draw-trigger` | 智能生图触发器 | [`plugins/smart-draw-trigger.js`](plugins/smart-draw-trigger.js) | [`docs/plugins/rbq-smart-draw-trigger.md`](docs/plugins/rbq-smart-draw-trigger.md) |
| `rbq-multi-char` | NAI 多角色模式 | [`plugins/multi-char-composer.js`](plugins/multi-char-composer.js) | [`docs/plugins/rbq-multi-char.md`](docs/plugins/rbq-multi-char.md) |

---

## 插件加载机制

1. 插件市场读取 [`plugins.json`](plugins.json)。
2. 用户点击安装后，宿主下载 `main` 指向的脚本内容。
3. 脚本内容被保存进 RBQ 宿主设置中的 `_plugins` 字段。
4. 宿主刷新页面后，用以下形式加载插件：

```javascript
const runner = new Function('RBQ', 'jQuery', 'toastr', plugin.code);
runner(window.RBQ, $, toastr);
```

插件入口推荐保持为：

```javascript
(function(RBQ, $, toastr) {
  if (!RBQ) return console.error('[My Plugin] RBQ Core API missing');
  // plugin code here
})(
  (typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)),
  (typeof jQuery !== 'undefined' ? jQuery : window.$),
  (typeof toastr !== 'undefined' ? toastr : console)
);
```

---

## `plugins.json` 规范

每个插件条目必须包含：

```json
{
  "id": "rbq-your-plugin-id",
  "name": "插件显示名",
  "description": "插件简介",
  "version": "1.0.0",
  "author": "作者名",
  "main": "plugins/your-plugin.js?v=1.0.0"
}
```

要求：

- `id` 必须稳定，不要随版本变化。
- `version` 使用语义化版本。
- `main` 建议带 `?v=<version>`，用于刷新浏览器和宿主缓存。
- 插件有更新时必须同时修改 `version` 和 `main` 查询参数。
- 新插件必须添加独立文档到 [`docs/plugins/`](docs/plugins/)。

---

## 宿主 API

### 生命周期 Hook

插件可通过 `RBQ.on(event, callback)` 拦截生图流程中的 payload。

```javascript
RBQ.on('buildNaiV4Payload', (payload) => {
  payload.input += ', masterpiece, best quality';
  return payload;
});
```

可用事件：

- `buildNaiV4Payload`：拦截 NovelAI V4 请求 payload。
- `buildGeneratePayload`：拦截传统中转 / Free 模式 payload。
- `buildComfyUiWorkflow`：拦截 ComfyUI workflow JSON。

回调必须返回 payload，除非你明确不想修改。

### 设置读写

```javascript
const settings = RBQ.api.getSettings();
settings._myPlugin = settings._myPlugin || {};
RBQ.api.saveSettings();
```

- `RBQ.api.getSettings()`：读取 RBQ 宿主设置对象。
- `RBQ.api.saveSettings()`：触发宿主保存设置。

建议插件把自己的状态放在 `_pluginName` 或 `_pluginId` 字段中，避免污染宿主顶层配置。

### 自定义生图模式注册

```javascript
RBQ.api.registerMode('my-mode', {
  title: 'My Mode',
  accent: 'custom',
  // 可选：自定义设置字段，声明后将在宿主设置面板动态渲染表单控件，并自动隐藏默认常规参数
  settingsFields: [
    {
      id: 'st-scene-trigger-my-select',
      key: 'mySelectKey',
      label: '选择选项',
      type: 'select',
      default: 'val1',
      options: [
        { value: 'val1', text: '选项一' },
        { value: 'val2', text: '选项二' }
      ]
    },
    {
      id: 'st-scene-trigger-my-number',
      key: 'myNumberKey',
      label: '数值设置',
      type: 'number',
      default: 10,
      min: 1,
      max: 100,
      step: 1
    },
    {
      id: 'st-scene-trigger-my-checkbox',
      key: 'myCheckboxKey',
      label: '启用功能',
      type: 'checkbox',
      default: false
    },
    {
      id: 'st-scene-trigger-my-text',
      key: 'myTextKey',
      label: '文本输入',
      type: 'text',
      default: '',
      placeholder: '请输入...'
    }
  ]
}, async ({ prompt, settings, connection, image, onProgress }) => {
  onProgress?.('正在请求自定义后端...');
  // settings 中可以直接读取声明的字段，如 settings.mySelectKey, settings.myNumberKey
  return { url: 'https://example.com/image.png' };
});
```

- `id`：模式 ID。
- `meta`：模式元数据定义。
  - `title`：模式显示名称。
  - `subtitle`：模式子标题（可选）。
  - `endpointLabel`：接口地址输入框的提示文本（可选）。
  - `keyLabel`：API Key 输入框的提示文本（可选）。
  - `modelLabel`：模型选择下拉框的提示文本（可选）。
  - `accent`：模式主题高亮色（可选）。
  - `settingsFields`：自定义设置字段数组（可选）。声明后，宿主设置面板中默认的常规参数（如宽高、步数、CFG、种子等）将自动隐藏，避免 UI 冲突，并动态渲染该数组中定义的控件：
    - `id`：DOM 元素的 ID，应全局唯一，建议以 `st-scene-trigger-` 作为前缀。
    - `key`：配置项对应的 Settings Key，用户修改后会保存在宿主配置中，并在 `generateFn` 传入的 `settings` 里直接读取。
    - `label`：控件前显示的标签文本。
    - `type`：控件类型，可选 `'select' | 'number' | 'checkbox' | 'text'`。
    - `default`：字段默认值。
    - `options`：（仅当 `type` 为 `'select'` 时有效）下拉项数组，每个项为 `{ value, text }`。
    - `placeholder`：（仅当 `type` 为 `'text'` 时有效）文本占位符。
    - `min` / `max` / `step`：（仅当 `type` 为 `'number'` 时有效）数值输入限制。
- `generateFn`：生成回调函数，接收参数对象 `{ prompt, settings, connection, image, onProgress }`：
  - `prompt`：经处理的生图提示词。
  - `settings`：全局配置对象，可读取到自定义的 `settingsFields` 字段值。
  - `connection`：当前连接信息（包含 `url`、`apiKey`、`model` 等）。
  - `image`：若为图生图或包含背景图的情况，代表源图片信息。
  - `onProgress`：进度通知回调，可传入 string 以在页面上显示生成进度。
  - 返回值应为 `{ url: '...' }` 或 `{ blob: BlobObject }`。

### 消息读取与 UI 渲染 API

宿主 `0.3.5+` 开始提供以下 API，用于开发不污染正文的智能生图类插件。

```javascript
const ctx = RBQ.api.getContext();
const message = RBQ.api.getMessage(messageId);
const recent = RBQ.api.getRecentMessages(messageId, 5);
const messageElement = RBQ.api.getMessageElement(messageId);
const textContainer = RBQ.api.getMessageTextContainer(messageId);
```

- `RBQ.api.getContext()`：返回 SillyTavern 当前上下文对象。
- `RBQ.api.getMessage(messageId)`：读取指定楼层消息。
- `RBQ.api.getRecentMessages(messageId, count)`：读取最近消息，返回 `{ id, is_user, name, mes }[]`。
- `RBQ.api.getMessageElement(messageId)`：返回消息根节点。
- `RBQ.api.getMessageTextContainer(messageId)`：返回消息正文容器。

```javascript
const wrapper = RBQ.api.createPromptCard({
  messageId,
  prompt: '1girl, cinematic lighting, rain',
  raw: '[draw]',
  id: 'my-plugin:unique-key',
  label: 'my-plugin'
});

RBQ.api.getMessageTextContainer(messageId)?.append(wrapper);
```

- `RBQ.api.createPromptCard(options)`：创建 RBQ 原生生图卡片。
- `prompt` 是实际出图 prompt。
- `raw` 是隐藏/回退文本。
- `id` 应保持稳定，用于去重。

```javascript
if (RBQ.api.shouldAutoGenerate()) {
  const result = await RBQ.api.generateImage(prompt, 'my-plugin', { messageId }, (status) => {
    console.log(status);
  });
  RBQ.api.renderInlineGeneratedImage(wrapper, result);
}
```

- `RBQ.api.shouldAutoGenerate()`：读取 RBQ 主设置中的自动生成开关。
- `RBQ.api.generateImage(prompt, reason, meta, onProgress)`：复用宿主当前模式出图。
- `RBQ.api.renderInlineGeneratedImage(wrapper, result)`：把结果图渲染到卡片内。

---

## 插件开发规范

### 命名

- 插件 ID 使用 `rbq-` 前缀，例如 `rbq-smart-draw-trigger`。
- 私有设置字段使用 `_` 前缀，例如 `_smartDrawTrigger`。
- DOM ID / class 建议带插件短前缀，避免和宿主或其他插件冲突。

### UI 注入

- 优先注入 RBQ 设置面板中的现有区域，例如 `[data-kite-panel="prompt"]` 或 `[data-kite-panel="plugins"]`。
- 不要覆盖宿主原有 DOM。
- 所有事件监听要尽量局部绑定，避免全局误伤。

### 安全

- 动态 HTML 必须转义，或使用 `textContent`。
- 外部 API Key 应保存在宿主设置里，不应写死在插件源码。
- 网络请求应捕获错误并通过 `toastr` 提示。

### 缓存和去重

- 对消息扫描类插件，必须用 `messageId + messageHash + mode` 做去重。
- 避免刷新、滑动、消息更新时重复请求 API 或重复生图。
- 缓存建议限制数量，避免无限增长。

### 发布

发布或更新插件时需要：

1. 修改插件源码。
2. 更新独立插件文档。
3. 更新 [`plugins.json`](plugins.json) 中该插件的 `version`。
4. 同步更新 `main` 查询参数，例如 `?v=1.0.1`。
5. 执行语法检查：

```bash
node --check plugins/your-plugin.js
python3 -m json.tool plugins.json >/dev/null
```

6. 提交并推送仓库。

---

## 本地调试

可以在本仓库目录运行本地静态服务器：

```bash
python3 -m http.server 8000
```

然后在 RBQ 扩展控制台的插件仓库源地址中填写：

```text
http://127.0.0.1:8000/plugins.json
```

这样每次修改插件后，只需要刷新插件市场并重新安装/更新插件即可测试。
