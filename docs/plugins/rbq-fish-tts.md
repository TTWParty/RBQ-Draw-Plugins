# Fish 语音 (Fish Audio TTS) 子插件

剧情语音插件：LLM「情绪导演」把酒馆消息改写成带情绪标签的台词（含 NSFW 破限），送 Fish Audio (MiniMax 系) 合成，消息楼层内联播放。音色库搜索/试听/收藏、角色绑定、预设体系、内心戏/旁白生成模式。

> v0.2.9 · 已注册 plugins.json（RBQ 插件管理器一键安装）

## 功能总览

- **剧情朗读**：自动/智能(LLM 判定有台词才读)/手动三种触发模式，流式结束守卫，不打断酒馆生成
- **LLM 情绪导演**：双层提示词（破限层 + 导演层），7 套导演预设（标准/极简/剧场/多角色/**女主内心戏**/**第三人称旁白**/自定义），4 套破限预设（裸跑/沙盒/卡密人格/经典多轮/自定义），`{{maxTags}}`/`{{char}}` 占位符，最终拼接预览可调试；LLM 挂掉自动回退纯规则剥离，语音永不中断
- **音色工坊**：直连 Fish Audio 公共音色库（免 Key 免代理），关键词搜索/试听/收藏/一键绑定；`仅我的音色` 列出账号克隆音色
- **角色绑定**：消息 name 精确→包含→默认音色兜底；群聊逐楼匹配；用户消息/旁白独立开关
- **预设体系**：4 内置（正常/夜话耳语/激昂剧场/Pro 高保真）+ 自建/复制/导出导入；预设=参数包（模型/语速/音量/格式/延迟/标签策略/预处理）
- **标签面板**：网站同款全集（英文情感/音效/中文情感/速度语调/特殊标记），点击插入
- **工程防护**：多 Key 故障转移、402 两本账友好提示、并发限流保护(2)、热重载完整清理（§14 规范）、`rbq-fishtts-*` 全前缀 DOM/设置/事件隔离、酒馆 TTS 双开检测提醒

## 计费要点（实测结论）

- `s2.1-pro-free` **完全免费**（同款模型，无 SLA，并发 5）——插件默认
- `s2.1-pro` 等付费模型 $15/百万 UTF-8 字节，**API credit 与网站余额是两本独立账**，需单独充值
- 情绪标签不计费、不增延迟；音效标签不限量；情绪标签建议每句 ≤3（质量护栏，可调 0=不限）

## 安装

1. RBQ 插件管理器里一键安装「(xh)Fish语音」（或把 `plugins/fish-tts.js` 放入酒馆 RBQ 子插件目录，与 `grok-draw.js` 同级）
2. 刷新酒馆，控制台看到 `(xh)Fish语音 (rbq-fish-tts) v0.2.9 Loaded!`，RBQ 设置里出现「(xh)Fish语音」面板

## 快速上手（「🔌 连接」页最上面的三步）

1. 到 [fish.audio → API Keys](https://fish.audio/app/api-keys) 新建一个 Key，粘贴进「Fish API Key」
2. 「默认音色」已预选内置收藏的「AD学姐」，可直接用；想换声音就在下拉里换，或去「🎭 音色工坊」搜索 → ★ 收藏 / 设为默认
3. 点「🔌 保存并测试」：显示「✓ 成功！」并出现一段可播放的测试音频，就可以去聊天了；失败会直接在按钮下方用中文写原因

发消息后楼层底部出现朗读条。面板顶部的状态条会显示 Key 是否已填、默认音色、当前连接方式。其余设置（缓存、模型、调试）收在「🗂️ 缓存与调试」折叠栏里，一般不用动。

## 连接方式（默认「直连」，零配置；音色搜索不需要任何转发）

Fish 官方原生 `POST /v1/tts` 没有任何 CORS 头（`OPTIONS` 返回 404 `no_route`），浏览器无法直连；但官方 OpenAI 兼容接口 `POST https://api.fish.audio/compat/v1/audio/speech` 实测预检返回 `204` + `Access-Control-Allow-Origin: *`（放行 `Authorization, Content-Type`），浏览器可直接调用。

v0.2.8 起默认 **⚡ 直连**：浏览器直接调这个兼容接口，PC/手机/HTTPS 酒馆通用，不用装插件、不用改配置（音量/延迟/码率经 `provider.options.fish-audio` 透传原生参数，WAV 占位头在本地修正）。默认模式**只走直连**，不会偷偷去请求服务端插件或外部地址。

只有测试时提示「连不上 Fish」（一般是网络访问不到 api.fish.audio，或被代理/广告拦截插件拦了）才需要展开 **「🛠️ 高级：网络连不上 Fish 时」** 换连接方式：

| 连接方式 | 说明 |
|---|---|
| ⚡ 直连（默认·推荐） | 浏览器直接连 Fish 官方 |
| 🔁 直连，失败自动换转发 | 先直连；连不上再依次试酒馆服务端插件 → 外部地址（没装/没填的跳过）。本会话直连失败过一次后优先走转发 |
| 🏠 只用酒馆服务端插件转发 | 见下方方案A |
| 🌐 只用外部地址 | 见下方方案B/C，需填「外部地址」 |

Fish 返回的业务错误直接用中文报出，不会被回退掩盖：401/403「Key 无效」、402「余额不足」（API 余额与网站会员是两本账）、429「限流」、400「音色或模型不可用」、5xx「Fish 服务器出错」。

升级迁移：旧版本默认的「酒馆服务器转发」以及未设置的，升级后改为「直连」（装过服务端插件的用户直连同样能用，需要时再去高级里选回来）；手动选过「外部地址」的保留不变。

### 方案A · 酒馆服务端插件转发（浏览器连不上 Fish、但酒馆所在机器能连上时用）

随附服务端小插件 [tools/st-server-plugin/fishtts/](../../tools/st-server-plugin/fishtts/)，装进酒馆本体后由酒馆服务器去请求 Fish，浏览器只跟酒馆同源通信，没有跨域问题：

1. 把 `fishtts` 文件夹整个复制到酒馆根目录的 `SillyTavern/plugins/` 下（得到 `SillyTavern/plugins/fishtts/index.js`）
2. 打开酒馆根目录的 `config.yaml`，把 `enableServerPlugins: false` 改成 `enableServerPlugins: true`（酒馆默认是 `false`，**网页面板里没有这个开关，只能改配置文件**）
3. 重启酒馆，启动日志里看到 `[fishtts] 转发插件已就绪: POST /api/plugins/fishtts/tts`
4. 插件面板「🔌 连接 → 🛠️ 高级」里选「🏠 只用酒馆服务端插件转发」（或「🔁 直连，失败自动换转发」），保存后点「🔌 保存并测试」

注意：这个办法靠的是「酒馆所在的机器能连上 Fish」。酒馆跑在海外 VPS 上很有用；如果酒馆就装在你自己电脑上、这台电脑本身也连不上 Fish，装了也没用。零外部依赖，Key 只经过你自己的酒馆服务器。

**为什么不用填酒馆账号密码（和生图一致）**：插件的转发请求**永不显式设置 Authorization 头**——浏览器会自动带上你打开酒馆时已缓存的登录凭据（BasicAuth + 会话 Cookie），宿主的 CSRF 头也自动携带。Fish Key 走独立的 `X-Fish-Key` 头，由转发插件在服务端换成 `Authorization: Bearer` 再交给 Fish。全新浏览器第一次合成若弹一次酒馆登录框，输对后浏览器记住，之后不再弹。切勿在插件里配置任何酒馆密码。

### 方案B · 本地 Node 代理（电脑开窗口，手机同 WiFi 用）

双击 `tools/启动fish语音代理.bat`，本机填 `http://127.0.0.1:8787`，手机填启动窗口打印的局域网地址（如 `http://192.168.1.3:8787`）。首次启动防火墙弹窗需允许；HTTPS 酒馆页面无法使用 http 代理（混合内容拦截）。

### 方案C · Cloudflare Worker（公网地址，免本地进程）

```js
export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,model', 'Access-Control-Max-Age': '86400' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const resp = await fetch(new Request('https://api.fish.audio' + url.pathname + url.search, request));
    const headers = new Headers(resp.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(resp.body, { status: resp.status, headers });
  },
};
```

分发插件给用户时，建议照 grok-draw 模式自部署一个公共 Worker 填为默认地址（用户零配置）。

## LLM 情绪导演配置

推荐**独立 API**模式（OpenAI 兼容接口，与酒馆模型隔离，NSFW 剧情不被净化）：

- 接口地址自动补 `/chat/completions`；HTTPS 页面只能配 HTTPS 接口（本地 127.0.0.1 除外）
- 破限选择：通用选「沙盒推演版」；ds/glm 系可试「卡密人格版」；无审查中转可「裸跑」省 Token
- 「🧪 测试改写」按钮直接验证链路：返回带标签台词=通；被净化/拒答=换破限或换模型
- 酒馆模式（复用当前模型）走 `generateQuietPrompt`，省配置但可能被模型审查

## 导演模式说明

| 类型 | 预设 | 行为 |
|---|---|---|
| 提取型 | 标准/极简/剧场/多角色 | 从消息抠出台词加标签；多角色输出 speaker 逐角色音色合成 |
| 生成型 | 💭女主内心戏 | 第一人称写她此刻没说出口的心声（NSFW 同步露骨） |
| 生成型 | 📖第三人称旁白 | 有声剧旁白声道，配「旁白音色」 |

生成型模式建议配合手动/自动触发均可；内心戏用角色绑定音色，旁白用角色绑定页的旁白音色。

## 存储设计（v0.1.1+）

- **三级缓存查找**：内存 blob URL → IndexedDB 持久缓存 → 合成；命中任何一级都不再请求 API
- **音频只存本机 IndexedDB**（`rbq-fishtts-audio` 库，150MB/300 条上限，超限自动淘汰最旧）——绝不塞进聊天 `.jsonl` 文件防膨胀
- **元数据写 `message.extra.rbq_fish_tts`**（voiceId+文本hash）：随聊天记录跨设备流转，标记"该楼层已合成过"
- 换设备/清缓存后缓存缺失 → 免费模型自动重合成，无感兜底
- 设置面板「存储」卡片：占用统计 / 手动清空 / 持久缓存开关

## 已知边界

- 长文本按预设 maxChars 截断（默认 500 字符/条）
- 内容审核在 Fish 服务端，违规返回错误并显示「换标签重试」
- 群聊绑定当前角色按钮只认 solo 角色卡；群聊请在绑定表手动添加角色名

## 存储结构

- 宿主设置：`settings._rbqFishTts`（apiKey/apiBase/llm/presets/bindings/favorites/trigger）
- 无 localStorage 依赖；DOM/事件全部 `rbq-fishtts` 前缀，卸载时通过 `RBQ.registerCleanup` 完整清理

## 测试

```bash
node --check plugins/fish-tts.js
node test/test_fish_tts.js              # 本地断言
RUN_NET=1 node test/test_fish_tts.js    # + 真实音色库联网检查
node test/run-fish-tts-cors-route-tests.js           # 连接方式/跨域回退/报错文案/连接页结构/默认音色/音色名保存与显示 (19 项)
RUN_NET=1 node test/run-fish-tts-cors-route-tests.js # + 真实 CORS 预检检查
```

## 📝 更新日志

- **v0.2.9**：升版本号，让已更新到早期 0.2.8 的用户也能拿到音色名后缀修复（显示「AD学姐 · zh」、设置里存纯名字）。
- **v0.2.8**：修复语音合成跨域问题，并重做「🔌 连接」页。
  - 合成默认 **直连** Fish 官方兼容接口 `/compat/v1/audio/speech`（官方放行 CORS，免装插件免代理）；默认模式只走直连，不再偷偷依赖服务端插件。
  - 服务端插件转发 / 外部地址 / 「直连失败自动换转发」收进折叠的「🛠️ 高级：网络连不上 Fish 时」，附简短中文说明（含 `enableServerPlugins: true` 装法）。
  - 连接页改为「🚀 快速上手」三步：填 Key → 选默认音色 → 「🔌 保存并测试」；状态条显示 Key/音色/连接方式；测试结果直接显示在按钮下方并可播放测试音频。缓存、模型、调试收进「🗂️ 缓存与调试」。
  - 报错改为大白话：Key 无效 / 余额不足 / 限流 / 音色不可用 / Fish 服务器出错；连不上时提示「可能网络连不上 api.fish.audio，可在高级里换连接方式」。
  - 设置迁移（version 2）：旧默认「酒馆服务器转发」与未设置的改为「直连」，手动选过「外部地址」的保留。
  - 默认音色：还没设置默认音色时（新装或之前留空）自动预选内置收藏「AD学姐」，填完 Key 即可出声；已选过的音色不会被覆盖。
  - 修复：从搜索结果「设为默认」的音色不在收藏夹时，在绑定页/连接页保存会被清空。
  - 修复：保存音色时把下拉里的「 · zh」语言后缀一起存进了音色名。现在设置里只存纯音色名，状态条/朗读条/绑定表显示时再按收藏夹补上语言（如「AD学姐 · zh」，查不到语言就只显示名字）。
  - 兼容接口 WAV 占位头本地修正；测试连接提示实际走的通道。
