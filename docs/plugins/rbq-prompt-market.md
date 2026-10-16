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

---

## 📝 更新日志

### v1.1.32（换码 / 个人码轮换）

> 1.1.31 之前公开列表曾返回所有人的个人码，**之前发布过作品的创作者请尽快换码**。需要服务器同步升级到带 `/api/rotate-key` 的 `server.py`。

* **插件设置 → 创作者个人码**新增「换码 / 重新生成并迁移」按钮：以输入框中的个人码作为旧码（也可以直接粘贴一个已泄露的旧码），自动生成 16 位新码，调用服务器把旧码名下的**全部作品**迁移过去，成功后本机保存新码、刷新「我的作品」，并提示迁移数量。迁移后旧码立即失效，其他设备需改填新码。
* 旧码名下没有作品时（输错或已换过）会再次确认是否仍改用新码。旧服务器（无该接口）会提示需升级服务器。
* **服务器新增 `POST /api/rotate-key`**：请求体 `{ "oldKey": "...", "newKey": "..." }`（旧码也可放在 `Authorization: Bearer` / `X-Creator-Key` 头里），返回 `{ success, moved }`。
  * 旧码常数时间比较；旧码匹配不到任何作品时返回 `moved: 0`；新旧相同为空操作。
  * 新码须为 8~64 位字母 / 数字 / `-` / `_`（推荐 `RBQ-U-` + 16 位十六进制；8 位旧格式仍接受以兼容）。
  * 同时迁移用旧码点过的赞（插件把个人码作为点赞 clientId）。
  * 轻量限流：每 IP 每 10 分钟最多 10 次，超出返回 429。

### v1.1.31（安全修复）

> ⚠️ 需要同时更新插件与自建服务器 `server/server.py`（及 `server/index.html`）。旧服务器上插件仍可使用，只是“我的作品”退回到仅凭本机上传记录判定。

**1. 创作者个人码 (creatorKey) 不再公开**
* 服务器所有公开响应（`GET /api/presets` 列表、上传 / 编辑后的返回值）都去掉了 `creatorKey` 与 `liked_by`，只额外给出布尔值 `hasOwner`（是否已绑定创作者）。个人码只保存在服务器端，用来校验编辑 / 下架权限。
* 新增鉴权接口 `GET /api/my-presets`（请求头 `Authorization: Bearer <个人码>` 或 `X-Creator-Key`；也支持 `POST /api/my-presets {"creatorKey": "..."}`），返回 `{ success, ids }`，插件与网页端都改用它来判断“我的作品”，不再从公开列表里比对个人码。
* 编辑 (`/api/update`)、下架 (`/api/delete`)、认领 (`/api/claim`) 仍然必须提供正确的个人码，比较改用 `hmac.compare_digest` 常数时间比较，空码永远不匹配。
* 新生成的个人码从 8 位提升为 16 位十六进制（`crypto.getRandomValues`），旧的 8 位码继续有效。

**2. 社区内容防 XSS**
* 插件中所有来自社区 / 导入数据的文本（标题、作者、标签、正负面提示词、采样器、预设 ID、测串词库条目、上传选择框中的本地预设名等）插入 HTML 前统一 `escapeHtml` 转义，包括 `title=`、`src=`、`data-` 等属性。卡片、详情页、测串词卡片抽成纯函数 `buildCardHtml` / `buildDetailHtml` / `buildTestPromptCardHtml` 并有单元测试覆盖。
* 封面 / 参考图地址只接受 `http(s)://` 与 `data:image/(png|jpeg|webp|gif|avif);base64,…`，其余（`javascript:`、`data:text/html`、`data:image/svg+xml` 等）回退为默认封面或直接不显示；本机现场出图的 `blob:` / 同源路径仅在本地结果中放行。
* 含 `<artist>`、`<style>` 之类尖括号的正常提示词现在会按原文显示（以前会被浏览器当成标签吞掉）。
* 服务器端增加字段长度限制（标题 50、作者 30、简介 200、提示词 8000、标签 ≤15 个且每个 ≤30 字），`previewUrl` / `referenceUrl` 只接受 http(s)，`params` 只保留 scale / steps / cfgRescale / sampler / noiseSchedule。服务器不做 HTML 过滤，防护以客户端转义为准。

**3. 管理员密钥只来自环境变量**
* 删除了 `server.py` 中硬编码的 `MARKET_ADMIN_KEY` 默认值。未设置或为空时，所有管理员能力（强制编辑 / 下架他人作品、清空工坊 `__ALL__`）一律 403。部署时请设置一个**新的**强随机 `MARKET_ADMIN_KEY`。
* 管理员密钥比较同样使用 `hmac.compare_digest`。

**测试**：`node test/run-prompt-market-security-tests.js`、`python3 test/test_market_server.py`（1.1.32 起两者均覆盖换码）。
