# 提示词预设工坊 (RBQ Prompt Market) 搭建与使用指南

本插件为 SillyTavern RBQ 生图生态提供 **社区预设市场 / 画师串共享工坊**。
用户可以在广场中浏览优质画师串、一键安装到本地「提示词预设」插件，也可以一键将自己调试的预设分享上传至云端。

---

## 🏗️ 架构与数据流

1. **展示与浏览 (全球 CDN 加速)**：
   * 插件直接从 GitHub 仓库（通过 jsDelivr CDN）读取 `index.json`，秒级打开，免维护服务器。
2. **免登录上传 (安全网关)**：
   * 用户在酒馆中点击“发布”，数据发送给你的免费 **Cloudflare Worker**。
   * Worker 内部安全保存你的 GitHub Personal Access Token (PAT)，代为向 GitHub 仓库提交预设文件与 WebP 缩略图。

---

## 🚀 极简部署步骤（仅需 5 分钟）

### 第一步：在 GitHub 创建存储仓库
1. 打开 GitHub，新建一个**公开仓库 (Public)**：`RBQ-Prompt-Market`（例如 `TTWParty/RBQ-Prompt-Market`）。
2. 将 `docs/market-repo-template/index.json` 上传到仓库根目录，并建立两个空目录（或放一个 `.gitkeep`）：
   * `presets/`（存放预设详细 JSON）
   * `previews/`（存放 WebP 预览图）

### 第二步：申请 GitHub Token (PAT)
1. 打开 GitHub ➔ Settings ➔ Developer Settings ➔ **Personal access tokens** ➔ **Tokens (classic)**。
2. 点击 **Generate new token (classic)**：
   * Note: `RBQ-Market-Worker`
   * 勾选权限：**`repo`**（全部仓库读写权限）。
3. 复制生成的 Token（形如 `ghp_xxxx`）。

### 第三步：部署免费 Cloudflare Worker
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) ➔ 点击左侧 **Workers & Pages** ➔ **Create application** ➔ **Create Worker**。
2. 名字随便填（例如 `rbq-prompt-market`），点击 **Deploy**。
3. 点击 **Edit code**，将本项目中的 [`docs/cloudflare-worker-market.js`](../cloudflare-worker-market.js) 内容完整复制粘贴进去，点击 **Deploy**。
4. 返回该 Worker 的 **Settings** ➔ **Variables and Secrets** ➔ 添加环境变量：
   * `GITHUB_TOKEN`: 刚才申请的 GitHub Token (建议设为 Secret 加密)
   * `GITHUB_REPO`: 你的仓库全名，例如 `TTWParty/RBQ-Prompt-Market`
   * `GITHUB_BRANCH`: `main`
5. 复制该 Worker 的公网域名，例如：`https://rbq-prompt-market.xxxx.workers.dev`。

### 第四步：在插件中使用
1. 打开酒馆中的 RBQ 提示词面板 ➔ 点击右上角的 **🏛️ 预设工坊**。
2. 点击工坊顶部的 **⚙️ 设置** 按钮，把刚才的 Worker 地址粘贴进去并保存。
3. 搞定！你现在可以随时浏览、一键安装、并且点击“发布我的预设”一键分享至云端了！
