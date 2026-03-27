# 🏆 RBQ-Draw 插件大厅生态 - 开发者指南 (Developer Guide)

欢迎来到 **SillyTavern-RBQ-Draw** 扩展的子插件开发平台！
本指南将教你如何开发自定义插件，不仅能拦截、修改所有的生图请求，还可以与 SillyTavern 自身环境（如 `jQuery`, `toastr` 等）进行深度交互。

---

## 🚀 插件加载运行机制 
1. **代码纯文本化**：插件的 `index.js` 代码会被完全读取为文本，并存储在宿主的通用设置 `settings.json` 内。这让你实现了一次安装，**彻底离线断网可用**。
2. **强隔离沙盒加载**：宿主会在初始化 `init()` 的最后一刻，通过 `new Function('RBQ', 'jQuery', 'toastr', pluginContent)` 的方式将你的代码无痕挂载。你可以通过传入的三个顶级变量控制整个系统。
3. **安全更新机制**：你的插件在 `plugins.json` 注册中心必须声明版本号。如果用户点击了“更新”，宿主才会覆盖掉本地内存的代码。

---

## 📦 核心注入对象 (The API)
你的插件会在这样一个闭包里被执行：
```javascript
(function(RBQ, $, toastr) {
    // 你的逻辑填在这里
})(window.RBQ, jQuery, toastr);
```

### 1. `RBQ.on(event, callback)` —— 拦截器钩子
在宿主的运行生命周期中，如果你想修改即将发送给后端（如 ComfyUI 或 NovelAI）的结构体，直接劫持它！

可用事件列表：
- **`buildComfyUiWorkflow`**：拦截 ComfyUI 本地生图时解析出的最终 `prompt`（即 ComfyUI Workflow JSON 字典表）。
- **`buildNaiV4Payload`**：拦截 NovelAI 直连或中转生图时构建的原始请求 Payload 参数。
- **`buildGeneratePayload`**：拦截“白嫖模式”下的传统中转 Payload 参数。

> ⚠️ **非常重要**：拦截器回调的入参 `payload` 就是核心代码正准备发送的对象结构。你修改后，**必须 `return payload;`**，否则生图链路将崩溃！

**示例：在 NAI 生图前强行往末尾加上 "masterpiece, best quality"**
```javascript
RBQ.on('buildNaiV4Payload', (payload) => {
    // payload 就是 NAI API 所需的 JSON
    if (payload.parameters && payload.input) {
        payload.input += ", masterpiece, best quality";
        toastr.info("已触发画质提升器 🪄");
    }
    return payload; // 绝对不能漏写
});
```

### 2. `RBQ.api.getSettings()` / `saveSettings()` —— 持久化存储
因为你的插件与 RBQ 扩展共用生命周期，你可以获取环境中的配置项，也可以偷偷保存你自己的内部状态。
```javascript
const conf = RBQ.api.getSettings();
console.log("当前引擎模式是: ", conf.currentMode);

// 如果你想持久化你自己的变量
if (!conf.myPluginState) conf.myPluginState = { count: 0 };
conf.myPluginState.count += 1;
RBQ.api.saveSettings(); // 保存进宿主磁盘
```

---

## 🛠 开发与测试指南
既然是本地免重载沙盒，如何在本地零成本开发调试一个新插件？

### 步骤一：创建你自己的 Github 专属仓库
1. 建一个新的 Github 公开仓库，命名为比如 `RBQ-Plugins`
2. 在仓库根目录建立一个 `plugins.json`（可参考本目录自带的模版）
3. 创建子目录 `plugins/`，存放你的代码，如：`plugins/enhance-tagger/index.js`

**你的 `plugins.json` 长这样：**
```json
[
  {
    "id": "rbq-enhance-tagger",
    "name": "提示词无敌打标插件",
    "description": "拦截每次生图任务，为你偷偷补齐万能修饰词。",
    "version": "1.0.0",
    "author": "Alice",
    "main": "plugins/enhance-tagger/index.js"
  }
]
```

### 步骤二：向宿主注册中心注册
你可以开启 Github Pages 环境或直接拿到 Github 原始 raw 链接池。
进入你的 SillyTavern，打开 RBQ 扩展控制台 -> 通用设置 -> 将你的 Github RAW JSON 文件地址填入 **仓库源地址**。
点击刷新！你的插件就会立刻显示在这个列表中，随时随地开启点击安装！

> 💡 **建议：本地开发服联调测试**
> 开发调试期间，没有必要每天推 Github。你可以直接在存放代码的本地目录（比如 `C:/dev/rbq-plugin-test/`）下运行 `python -m http.server 8000` 或是其他 `Live Server`（注意开启 CORS）。
> 然后把仓库源地址直接填 `http://127.0.0.1:8000/plugins.json`。这样你在 IDE 敲完代码，在面板里一键刷新安装，立马生效！不用推送到云端！

## 🚀 未来计划
随着核心引擎支持的开放，我们未来可能会暴露 `RBQ.ui.addSettingPanel` 方法，允许子插件动态在“通用面板”里注入独有的自定义 UI 控制器！
敬请期待。
