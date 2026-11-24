# 提示词预设工坊 (RBQ Prompt Market) 搭建与使用指南

本插件为 SillyTavern RBQ 生图生态提供 **社区预设市场 / 画师串共享工坊**。
用户可以在广场中浏览优质画师串、一键安装到本地「提示词预设」插件，也可以一键将自己调试的预设分享上传至云端。

---

## 🏗️ 架构与数据流（当前自建节点方案）

工坊默认采用 `server/server.py` + `server/index.html` 自建节点方案（例如 `https://market.rbq.my`），同时兼容酒馆插件端与网页门户端：

1. **后端服务 (`server/server.py`)**：
   * 基于 Python `ThreadingHTTPServer`，建议仅监听 `127.0.0.1:3000`（环境变量 `MARKET_BIND_HOST` / `PORT`）并通过 Caddy 等反向代理对外提供 HTTPS 服务。
   * 预设元数据持久化在 `MARKET_DATA_DIR/presets.json`（原子临时文件 + `fsync` + `os.replace` 写入），封面图与伴生参考图按 WebP/JPEG/PNG 魔数校验后保存在 `MARKET_UPLOADS_DIR/`。
   * 管理员密钥通过环境变量 `MARKET_ADMIN_KEY` 配置（建议放在仅 root 可读的 `/etc/rbq-market.env` 中），服务进程建议以非特权系统用户（如 `rbqmarket`）运行。
2. **网页门户 (`server/index.html`)**：
   * 独立 Web 展厅，支持模型与标签筛选、作品详情（双图切换与大图灯箱）、创作者个人码绑定与一键换码迁移、在线编辑/下架与 JSON 导出。
3. **酒馆插件 (`plugins/prompt-market.js`)**：
   * 在 SillyTavern 内提供画廊浏览、一键导入至「提示词预设」(`rbq-prompt-presets`)、现场出图对比与直接上传/编辑能力。

---

## 🚀 自建服务部署指南

1. 准备目录与环境：将 `server/server.py` 与 `server/index.html` 放入服务目录（如 `/opt/rbq-prompt-market`），创建 `data/`、`uploads/` 并授权给专用低权限系统用户（如 `rbqmarket`）。
2. 配置环境变量（例如 `/etc/rbq-market.env`，权限 `600`）：
   * `PORT=3000`
   * `MARKET_BIND_HOST=127.0.0.1`
   * `MARKET_PUBLIC_ORIGIN=https://market.rbq.my`
   * `MARKET_ADMIN_KEY=<强随机管理员密钥>`
3. 配置 systemd 与 Caddy 反向代理：
   * 由反向代理提供 HTTPS、安全响应头，并在访问日志中脱敏 `X-Creator-Key` / `Authorization` 等凭据请求头；若位于 Cloudflare 后方，可按 `X-Forwarded-Proto: http` 跳转到 HTTPS。
   * 建议配置定时备份脚本打包 `data/presets.json` 与 `uploads/`。
4. 在插件设置中确认服务器地址即可使用（默认指向 `https://market.rbq.my`）。

---

## 📦 备选/旧版架构（Cloudflare Worker，历史方案）

早期版本曾支持「GitHub 公开仓库 + Cloudflare Worker (`docs/cloudflare-worker-market.js`)」无服务器方案；如仍需使用该方案，可按以下摘要配置：

* **GitHub 仓库**：建立公开仓库，放入 `docs/market-repo-template/index.json` 以及 `presets/`、`previews/` 目录，并申请具备 `repo` 权限的 PAT。
* **Cloudflare Worker**：部署 `docs/cloudflare-worker-market.js`，配置加密变量 `GITHUB_TOKEN` 与明文变量 `GITHUB_REPO`、`GITHUB_BRANCH`，并在插件设置中填入 Worker 域名。

---

## 📝 更新日志

### v1.1.37（社区共享、署名与下架声明模块）

* **网页门户 (`server/index.html`) 与酒馆插件 (`plugins/prompt-market.js`) 同步补全声明体系**：
  * 新增顶栏「声明」入口、轻量单行非打扰公告条（网页端位于筛选栏下方、插件端位于弹窗底栏）以及「免责与版权/下架声明」弹窗，明确标注公益非商业性质、「整理」署名含义、创作者自助管理与通过 GitHub Issues 快速异议下架/更正署名的通道。
  * 发布弹窗提交栏上方增加一行合规分享提示，支持 `Esc` 关闭与遮罩防误关隔离，并已补齐 SillyTavern 宿主样式与卸载清理 ID。

### v1.1.36（官方基准测试底模优化）

* **低干扰默认基准 (`BENCHMARK_POSITIVE_PROMPT`)**：将默认官方基准从 45 词高密度复杂描述精简为 **11 词极简中性半身人像底模**（`1girl, solo, upper body, looking at viewer, long silver hair, blue eyes, gentle smile, white collared shirt, black ribbon, indoors, window`），避免复杂服饰细节、双动作与强风格偏置词（如 `intricate pupils`、`sunbeams`、`stained glass`）稀释或覆盖画师串本身的线条、瞳孔与光影特征。
* **多场景内置词库与无感迁移**：默认内置 3 套测串底模——**「官方基准 · 极简半身人像 (推荐)」**（默认）、**「卡密sama · 温室少女 (复杂场景压测)」**（保留原 45 词场景）、**「内置场景 · 夜色光影人像 (暗调测试)」**；存量安装升级时通过 `getTestPrompts()` 无感迁移，已自定义默认模板的用户会保留其默认选择。

### v1.1.35（系统安全加固与前后端体验修复）

* **后端稳定性与安全 (`server/server.py`)**：
  * 修复环境变量同步与绑定地址控制（`MARKET_BIND_HOST` 默认 `127.0.0.1`，新增 `MARKET_PUBLIC_ORIGIN` 控制图片外链并附带 `?v=` 缓存刷新参数），配置 `daemon_threads`、`allow_reuse_address`、`30s` socket 超时与隐藏版 `Server` 响应头，支持完整 `HEAD` 请求与 `/robots.txt`。
  * `save_presets()` 与图片保存改为临时文件 `flush + fsync + os.replace` 原子替换；`load_presets()` 遇到损坏 JSON 直接报错而不静默覆写为空；只读接口统一加 `DATA_LOCK` 并附带 `X-Content-Type-Options: nosniff` 与 `Referrer-Policy` 安全响应头。
  * 增加请求体大小与 JSON 对象校验、`ensure_disk_space` 空间保护、真实图片魔数解码与 3MB 上限、全写接口及 `/api/my-presets` 限流；`/api/like` 强制校验 `clientId` 格式；禁止非管理员认领/修改/删除无主预设；删除作品（含 `__ALL__`）时清理关联图片。
* **酒馆插件与导入 (`plugins/prompt-market.js` / `plugins/prompt-presets.js`)**：
  * 每个酒馆安装生成独立随机 `t-<16hex>` 点赞标识替代共享 `'u-tavern'`，并增加防连点锁；补齐编辑与管理弹窗的 SillyTavern 防挤压样式；详情页安全渲染转义后的 `description`；修复现场实测弹窗回退时 `curBm` 未定义报错；修复插件卸载清理时的真实覆盖层与子弹窗 DOM ID；导入预设至 `prompt-presets` 时保留 `params` 生图参数。
* **网页门户 (`server/index.html`)**：
  * 补齐 `general` 通用模型筛选、`#img-lightbox` 大图灯箱、详情图切换并发竞态防护与画师说明展示、创作者中心一键换码迁移 (`/api/rotate-key`)、编辑弹窗补充模型/说明/NAI 参数与 Safari JPEG 回退、移动端卡片操作栏常驻与全局 `Escape` 关闭栈、点赞/下载局部 DOM 更新及安全日期解析。

### 服务器更新（2026-10-16，插件版本不变）：拦截 HTML 注入，保护旧客户端

1.1.30 及更早的插件把社区文本直接当 HTML 渲染，服务器现在替它们兜底：

* **上传 / 编辑拦截**：标题、作者、简介、正负面提示词、模型、标签、参数里出现危险片段时直接返回 400「内容包含不安全的 HTML/脚本片段（字段 …：…），请删除后再提交」。危险片段包括：`script / iframe / img / svg / object / embed / link / meta / form / input / button / video / audio / source / base / math / details / marquee / body / html / a` 等标签（开始或结束标签）、任何带属性的标签（如 `<style media=…>`、`<artist onclick=…>`）、`<style/…>`、`on…=` 事件处理器、`javascript:` / `vbscript:` / `data:text/` 链接、`srcdoc=`、`&#…` 实体编码，以及 `<style>` 段内的 `@import`、`url(`、`expression(` 等外链/脚本 CSS。
* **照常放行**：不带属性的 `<artist> … </artist>`、`<style> … </style>` 等 NAI 提示词标签，以及 `{{ }}`、`[[ ]]`、`2::tag::`、`<lora:x:0.8>`、`<3`、`>_<` 等常见写法。
* **存量数据中和**：公开列表返回前，把已存数据里的危险片段换成全角字符（＜ ＞ ＝ ： ＆ （），只改命中的片段，正常提示词原样返回；服务器上的原始数据不修改。封面 / 参考图地址不是 http(s) 时分别回退为默认封面 / 空。

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
