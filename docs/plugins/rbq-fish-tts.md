# Fish 语音 (Fish Audio TTS) 子插件

剧情语音插件：LLM「情绪导演」把酒馆消息改写成带情绪标签的台词（含 NSFW 破限），送 Fish Audio (MiniMax 系) 合成，消息楼层内联播放。音色库搜索/试听/收藏、角色绑定、预设体系、内心戏/旁白生成模式。

> v0.1.0 · 本地版（未注册 plugins.json，手动安装）

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

1. 把 `plugins/fish-tts.js` 放入酒馆 RBQ 子插件目录（与 `grok-draw.js` 同级）
2. 刷新酒馆，控制台看到 `🐟 Fish语音 (rbq-fish-tts) v0.1.0 Loaded!`
3. RBQ 控制台出现「🐟 Fish语音」设置面板
4. 连接设置：填 Fish API Key（fish.audio/app/api-keys 生成）+ 合成反代地址（见下）
5. 音色工坊搜一个声音 → 「设为默认」或「🔗 绑当前角色」
6. 发消息，楼层底部出现 🐟 朗读条

## 合成通道（三选一，音色搜索不需要任何通道）

官方 `POST /v1/tts` 禁止浏览器直连（CORS 实测），合成需走下列通道之一。插件「连接设置 → 合成通道」切换：

### 方案A · 酒馆服务器转发（推荐，手机通吃，默认）

随附服务端小插件 [tools/st-server-plugin/fishtts/](../../tools/st-server-plugin/fishtts/)，装进酒馆本体后由酒馆服务器转发，同源请求无跨域：

1. 把 `fishtts` 文件夹整个复制到 `SillyTavern/plugins/` 目录
2. 酒馆 → 扩展/插件面板 → 启用「Fish语音转发 (fishtts relay)」→ 重启酒馆
3. 控制台看到 `[fishtts] 转发插件已就绪`
4. 插件合成通道选「🏠 酒馆服务器转发」（默认即是）

零外部依赖、PC/手机/公网 HTTPS 酒馆通吃；Key 只经过你自己的酒馆服务器。

**为什么不用填酒馆账号密码（和生图一致）**：v0.1.7 起插件的合成请求**永不显式设置 Authorization 头**——浏览器会自动带上你打开酒馆时已缓存的登录凭据（BasicAuth + 会话 Cookie），宿主的 CSRF 头也自动携带。Fish Key 走独立的 `X-Fish-Key` 头，由转发插件在服务端换成 `Authorization: Bearer` 再交给 Fish。全新浏览器第一次点朗读若弹一次酒馆登录框，输对后浏览器记住，之后永不再弹。切勿在插件里配置任何酒馆密码。

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
- 音频缓存为会话级（刷新后同楼层重合成，免费模型零成本）；`message.extra` 持久化在 v0.2 规划
- 群聊绑定当前角色按钮只认 solo 角色卡；群聊请在绑定表手动添加角色名

## 存储结构

- 宿主设置：`settings._rbqFishTts`（apiKey/apiBase/llm/presets/bindings/favorites/trigger）
- 无 localStorage 依赖；DOM/事件全部 `rbq-fishtts` 前缀，卸载时通过 `RBQ.registerCleanup` 完整清理

## 测试

```bash
node --check plugins/fish-tts.js
node test/test_fish_tts.js              # 45 项本地断言
RUN_NET=1 node test/test_fish_tts.js    # + 真实音色库联网检查 (46 项)
```
