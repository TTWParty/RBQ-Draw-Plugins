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
| `rbq-custom-floating-icon` | 摸鱼悬浮球 | [`plugins/custom-floating-icon.js`](plugins/custom-floating-icon.js) | [`docs/plugins/rbq-custom-floating-icon.md`](docs/plugins/rbq-custom-floating-icon.md) |
| `rbq-grok-draw` | Grok 生图插件 | [`plugins/grok-draw.js`](plugins/grok-draw.js) | [`docs/plugins/rbq-grok-draw.md`](docs/plugins/rbq-grok-draw.md) |
| `rbq-character-workshop` | 角色工坊 | [`plugins/character-workshop.js`](plugins/character-workshop.js) | [`docs/plugins/rbq-character-workshop.md`](docs/plugins/rbq-character-workshop.md) |
| `rbq-image-privacy` | 图片隐私模式 | [`plugins/image-privacy-mode.js`](plugins/image-privacy-mode.js) | [`docs/plugins/rbq-image-privacy-mode.md`](docs/plugins/rbq-image-privacy-mode.md) |
| `rbq-save-downloads-fix` | 安卓保存修复 | [`plugins/save-downloads-fix.js`](plugins/save-downloads-fix.js) | [`docs/plugins/rbq-save-downloads-fix.md`](docs/plugins/rbq-save-downloads-fix.md) |

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

## 宿主 API 规范 (RBQ API Reference)

宿主环境通过全局对象 `window.RBQ` 向所有子插件暴露生命周期拦截器、核心设置、酒馆上下文、卡片与生图管线、画廊查看器、NAI氛围以及IndexedDB缓存等全套接口。

---

### 1. 生命周期 Hook 与事件总线 (`RBQ.on` / `RBQ.emit`)

插件可通过 `RBQ.on(event, callback)` 监听并拦截生图流程、配置切换或自定义跨插件事件，也可通过 `RBQ.emit(event, payload)` 触发广播。

```javascript
// 核心版本号
console.log('RBQ Version:', RBQ.version);

// 拦截 NovelAI V4 / V4.5 请求 Payload
RBQ.on('buildNaiV4Payload', (payload) => {
  payload.input += ', masterpiece, best quality';
  return payload;
});

// 监听用户切换全局配置预设
RBQ.on('profile:switched', ({ profileId, profile }) => {
  console.log('Active profile changed to:', profile.name);
});
```

#### 内置生命周期 Hook 事件：
| 事件名称 | 描述 | 回调参数 | 期望返回值 |
|---|---|---|---|
| `buildNaiV4Payload` | 拦截与修改 NAI V4/V4.5 请求 Payload | `payload: Object` | 修改后的 `payload` 对象 |
| `buildGeneratePayload` | 拦截与修改传统中转、OpenAI-兼容、Free 模式 Payload | `payload: Object` | 修改后的 `payload` 对象 |
| `buildComfyUiWorkflow` | 拦截与修改 ComfyUI workflow JSON 提词结构 | `payload: Object` | 修改后的 `payload` 对象 |
| `profile:switched` | 当用户在控制台切换全局配置预设时触发 | `{ profileId: string, profile: Object }` | 无需返回 |

*注：回调函数必须返回修改后的 `payload`，否则请返回原对象。*

---

### 2. 设置读写与全局预设 API (`Global Profiles & Settings`)

```javascript
// 1. 读取与防抖保存基础设置
const settings = RBQ.api.getSettings();
settings._myPlugin = settings._myPlugin || {};
settings._myPlugin.enabled = true;
RBQ.api.saveSettings();

// 2. 全局预设 (Global Profiles) 管理
const gp = RBQ.api.getGlobalProfiles(); // { activeProfileId, profiles: [...] }
const active = RBQ.api.getActiveGlobalProfile(); // 当前生效预设对象 { id, name, data, ... }

// 切换到指定预设（自动应用数据并重绘界面）
RBQ.api.switchGlobalProfile(targetProfileId);

// 保存当前面板配置到当前活动预设
RBQ.api.saveCurrentGlobalProfile(true); // true 代表弹出 toastr 成功提示

// 新建一个全局预设
RBQ.api.createNewGlobalProfile('小说沉浸绘图预设');
```

- `RBQ.api.getSettings()`：读取宿主设置对象（直接引用）。建议插件数据存放在 `_pluginKey` 下以防命名污染。
- `RBQ.api.saveSettings()`：触发宿主防抖存储（`saveSettingsDebounced`）。
- `RBQ.api.getGlobalProfiles()`：获取所有已保存预设列表及当前活动的预设 ID。
- `RBQ.api.getActiveGlobalProfile()`：返回当前生效的活动预设元数据及快照。
- `RBQ.api.switchGlobalProfile(id)`：切换至目标预设，自动重载配置并广播 `profile:switched` 事件。
- `RBQ.api.saveCurrentGlobalProfile(notify = true)`：将当前配置项快照存入活动预设。
- `RBQ.api.createNewGlobalProfile(name)`：以当前配置为底稿创建新预设。

---

### 3. NAI 氛围与参考图控制 API (`NAI Vibe & Reference`)

用于与 NovelAI V4 的 Director Tools（Vibe Transfer 氛围参考图）深度联动，支持提示词预设、角色立绘或差分插件动态注入参考图。

```javascript
// 读取当前已挂载的 Vibe 列表副本
const vibes = RBQ.api.getNaiVibes();
// 每个 vibe 项格式: { id, name, tensor, b64, information_extracted, strength }

// 动态写入新的氛围参考图（支持最多 6 个）
RBQ.api.setNaiVibes([
  {
    id: 'vibe-1',
    name: '水彩画风',
    b64: 'data:image/png;base64,...',
    information_extracted: 1.0,
    strength: 0.7
  }
], { source: 'my-plugin' });

// 刷新控制台中的 Vibe 网格与卡片展示
RBQ.api.refreshNaiVibeUi();
```

- `RBQ.api.getNaiVibes()`：返回当前启用的 NAI Vibe 氛围图克隆数组。
- `RBQ.api.setNaiVibes(items, options)`：写入新的 Vibe 列表（自动校验规范化、自动清除旧 Precise Refs、自动保存并重绘 UI）。
- `RBQ.api.refreshNaiVibeUi()`：重新渲染控制面板 NAI 高级设置中的甲板卡片。

---

### 4. 画廊与全屏大图查看器 API (`Viewer & Gallery`)

宿主内置了全功能大图查看器（支持全屏查看、双栏分镜对比、缩略图切换与无损下载）。

```javascript
// 获取查看器当前运行状态
const viewerState = RBQ.api.getViewerState();
// { open: boolean, index: number, items: Array, prompt: string }

// 确保历史条目具备可展示的 Display URL（支持自动从 IndexedDB 提取缓存或 Blob）
const displayUrl = await RBQ.api.ensureHistoryItemDisplayUrl(historyItem);

// 动态热更新查看器中当前激活的图像（用于微调重绘或二次修改）
RBQ.api.updateViewerCurrentItem({
  url: 'https://...',
  displayUrl: 'blob:...',
  thumbnailUrl: 'blob:...'
}, 'updated new prompt tags');
```

- `RBQ.api.getViewerState()`：获取查看器全局状态对象。
- `RBQ.api.ensureHistoryItemDisplayUrl(item)`：异步解析图片真实地址，自动处理 IndexedDB 缓存还原。
- `RBQ.api.updateViewerCurrentItem(imageResult, updatedPrompt)`：在画廊开启时动态刷新当前展示内容。

---

### 5. 本地缓存与图片导出 API (`Cache & Storage`)

RBQ 默认将所有生图结果缓存在本地 IndexedDB（`st-scene-trigger-image-cache`），支持跨会话秒级还原与脱机访问。

```javascript
// 1. 读取当前本地图片缓存占用
const { totalBytes, count } = await RBQ.api.getImageCacheUsage();
console.log(`当前共缓存 ${count} 张图片，占用 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

// 2. 清空全部本地图像缓存
await RBQ.api.clearImageCache();

// 3. 清理指定天数之前的过期本地图片缓存
await RBQ.api.clearCacheOlderThanDays(7);

// 4. 将当前聊天的全部历史生成图片打包为 ZIP 导出下载
await RBQ.api.exportChatImagesZip();

// 5. 重新统计并更新控制台界面的缓存占用文字
RBQ.api.updateCacheUsageUi();
```

---

### 6. 酒馆原生事件总线桥接 (`EventBus Bridge`)

插件无需从全局作用域或复杂 DOM 中摸索 SillyTavern 事件，宿主直接桥接导出官方事件接口。

```javascript
const { eventSource, event_types } = RBQ.api;

// 监听酒馆消息接收
eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
  console.log('New message received:', messageId);
});

// 监听当前聊天会话切换
eventSource.on(event_types.CHAT_CHANGED, () => {
  console.log('Chat session changed');
});
```

---

### 7. 动态设置面板注册 (`RBQ.ui.addSettingPanel`)

宿主 `0.3.20+` 支持插件在控制面板中动态注册专属 Tab 页，杜绝暴力篡改 DOM。

```javascript
RBQ.ui.addSettingPanel(id, title, renderHtmlFn);
```

- `id`：面板唯一 ID（如 `'inspector'`），将作为 `data-kite-tab` 和 `data-kite-panel` 属性。
- `title`：导航按钮文字，支持带图标的 HTML，例如 `'<i class="fa-solid fa-wand-magic-sparkles"></i><span>智能生图</span>'`。
- `renderHtmlFn`：面板渲染函数，返回 HTML 字符串或已绑定事件的 `HTMLElement`。宿主在面板开启或初次加载时会自动挂载。

---

### 8. 自定义生图模式注册 (`RBQ.api.registerMode`)

```javascript
RBQ.api.registerMode('my-mode', {
  title: 'My Mode',
  accent: 'custom',
  // 可选：声明后，宿主设置面板将自动隐藏默认常规参数，并动态渲染该数组中定义的控件
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

- `id`：模式唯一标识。
- `meta`：模式元数据（`title`, `accent`, `settingsFields` 等）。
- `generateFn`：异步生成实现，接收 `{ prompt, settings, connection, image, onProgress }`，返回 `{ url }` 或 `{ blob }`。

---

### 9. 消息读取与正文卡片 API

专为非侵入式智能分镜、提词卡片、自动化工作流设计：

```javascript
// 1. 读取楼层消息与容器
const ctx = RBQ.api.getContext();
const message = RBQ.api.getMessage(messageId);
const recent = RBQ.api.getRecentMessages(messageId, 5); // 返回 { id, is_user, name, mes }[]
const messageElement = RBQ.api.getMessageElement(messageId);
const textContainer = RBQ.api.getMessageTextContainer(messageId);

// 2. 创建 RBQ 原生内联生图卡片
const wrapper = RBQ.api.createPromptCard({
  messageId,
  prompt: '1girl, cinematic lighting, rain',
  raw: '[draw: 雨中女孩]',
  id: 'sdt-seg:12345',
  label: '窗边回眸'
});

// 将卡片挂载到正文中
RBQ.api.getMessageTextContainer(messageId)?.append(wrapper);

// 3. 判断并执行自动生图或手动渲染
if (RBQ.api.shouldAutoGenerate()) {
  const result = await RBQ.api.generateImage(prompt, 'my-plugin', { messageId }, (status) => {
    console.log('Progress:', status);
  });
  RBQ.api.renderInlineGeneratedImage(wrapper, result);
}
```

- `RBQ.api.getContext()`：返回酒馆上下文。
- `RBQ.api.getMessage(messageId)`：读取指定楼层消息。
- `RBQ.api.getRecentMessages(messageId, count)`：读取指定消息前后的上下文楼层。
- `RBQ.api.createPromptCard(options)`：创建符合宿主规范的 `.st-scene-trigger-inline-wrap` 节点。
- `RBQ.api.shouldAutoGenerate()`：获取宿主“自动生图”开关状态。
- `RBQ.api.generateImage(prompt, reason, meta, onProgress)`：调用宿主当前激活的生图渠道发起出图。
- `RBQ.api.renderInlineGeneratedImage(wrapper, result)`：将生图结果插入卡片（自动兼容隐私展示模式与全屏画廊查看）。

---

### 10. 聊天文件背包持久化 API (`Chat-Level Persistence`)

宿主 `0.3.51+` 支持直接读写当前消息的背包拓展字段（`message.extra`）并提供防抖存盘。存储在 `message.extra` 中的数据随酒馆服务端 `.jsonl` 聊天记录自动保存与跨端流转，换浏览器或换设备永久不丢，且不会膨胀浏览器全局 `localStorage` 设置。

```javascript
// 1. 将插件私有数据写入指定消息背包并自动防抖存盘
RBQ.api.setMessageExtra(messageId, 'rbq_my_plugin', {
  status: 'completed',
  tags: '1girl, smile',
  timestamp: Date.now()
});

// 2. 读取指定消息背包中的私有数据（不存在时返回 null）
const data = RBQ.api.getMessageExtra(messageId, 'rbq_my_plugin');

// 3. 手动触发酒馆当前聊天记录的防抖存盘或立即存盘
RBQ.api.saveChatDebounced();
RBQ.api.saveChat();
```

- `RBQ.api.setMessageExtra(messageId, key, data)`：将数据存入 `message.extra[key]` 并自动触发 `saveChatDebounced`。
- `RBQ.api.getMessageExtra(messageId, key)`：安全读取 `message.extra[key]`。若未提供 key，则返回整个 `message.extra` 对象。
- `RBQ.api.saveChatDebounced()`：触发 SillyTavern 官方聊天文件的防抖存盘。
- `RBQ.api.saveChat()`：立即将聊天数据刷盘。

---

### 11. 插件生命周期与热插拔守卫规范 (`Lifecycle & Hot Reload Cleanup`)

宿主 `0.3.52+` 支持完整的插件卸载与热更新自清理机制。当用户在插件中心点击「更新」或「卸载」时，宿主会在无需刷新整个页面的前提下，精确调用子插件注册的清理钩子，杜绝 `MutationObserver` 掉帧泄露、多重 `setInterval` 定时器叠加以及事件监听器重复触发：

#### 宿主生命周期 API

- `RBQ.registerCleanup(pluginId, cleanupFn)`：子插件向宿主注册卸载/重载时的清理函数。
- `RBQ.cleanupPlugin(pluginId)`：手动触发指定插件的清理流程。
- `RBQ.off(event, callback)`：解绑通过 `RBQ.on` 注册的事件总线监听器。
- `RBQ.ui.removeSettingPanel(panelId)`：安全注销并移除动态设置标签页与面板 DOM。
- `RBQ.api.unregisterMode(modeId)`：安全注销并移除自定义生图模式。

#### 子插件标准热插拔模板范式 (Best Practice)

```javascript
(function(RBQ, $, toastr) {
  if (!RBQ) return console.error('[My Plugin] RBQ Core API missing');

  const PLUGIN_ID = 'rbq-my-plugin';

  // 1. 顶部防热更新重复加载守卫：清理上一实例
  if (typeof window.__rbqMyPluginCleanup === 'function') {
    try { window.__rbqMyPluginCleanup(); } catch (e) { console.warn(e); }
  }

  // 2. 声明生命周期引用变量
  let pollTimer = null;
  let domObserver = null;
  let clickListener = null;
  let origRender = null;

  // 3. 启动定时器与 Observer
  pollTimer = setInterval(() => { /* ... */ }, 1000);
  domObserver = new MutationObserver(() => { /* ... */ });
  domObserver.observe(document.body, { childList: true, subtree: true });

  // 4. 函数拦截保护（还原闭包，防止多次叠加导致栈溢出）
  if (RBQ.api && typeof RBQ.api.renderInlineGeneratedImage === 'function') {
    origRender = RBQ.api.renderInlineGeneratedImage.__origRender || RBQ.api.renderInlineGeneratedImage;
    const patchedRender = function(wrapper, result) {
      const res = origRender.apply(this, arguments);
      // 自定义增强逻辑...
      return res;
    };
    patchedRender.__origRender = origRender;
    RBQ.api.renderInlineGeneratedImage = patchedRender;
  }

  // 5. 编写完整清理函数
  function cleanupInstance() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (domObserver) { domObserver.disconnect(); domObserver = null; }
    if (clickListener) { document.removeEventListener('click', clickListener); clickListener = null; }
    if (origRender && RBQ.api) {
      RBQ.api.renderInlineGeneratedImage = origRender;
      origRender = null;
    }
    // 移除自身注入的 DOM / 模态框 / 样式表
    document.querySelectorAll('[id^="rbq-my-plugin-"]').forEach(el => el.remove());
    if (typeof RBQ?.ui?.removeSettingPanel === 'function') {
      RBQ.ui.removeSettingPanel('my-plugin-tab');
    }
  }

  // 6. 双重注册：全局热重载守卫 + 宿主插件中心卸载钩子
  window.__rbqMyPluginCleanup = cleanupInstance;
  if (RBQ.registerCleanup) {
    RBQ.registerCleanup(PLUGIN_ID, cleanupInstance);
  }
})(window.RBQ, window.$, window.toastr);
```

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

### 生命周期与清理守卫

- 绝不允许留下孤儿定时器（`setInterval` / `setTimeout`）与无限制的全局 `MutationObserver`。
- 如果插件挂载了 `document.body` 级监听或定时器，必须提供 `cleanupInstance` 并调用 `RBQ.registerCleanup(PLUGIN_ID, cleanup)`。
- 文件顶部建议实现 `window.__rbq<PluginName>Cleanup()` 自清理，保证热更新时旧实例被完整销毁。
- 若对宿主核心函数进行了猴子补丁（Monkey Patch），必须在清理时精准还原原始函数指针。

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
