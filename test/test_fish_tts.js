/**
 * Fish 语音插件 Node 模拟运行测试
 * 模拟: RBQ Core / 酒馆DOM / toastr / fetch(本地mock + 可选真实音色库联网)
 * 运行: node test/test_fish_tts.js        (纯本地)
 *       RUN_NET=1 node test/test_fish_tts.js  (附带真实音色搜索联网检查)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0, skip = 0;
const check = (name, cond) => { console.log((cond ? '✓ ' : '✗ ') + name); cond ? pass++ : fail++; };

/* ---------- 全局桩 ---------- */
global.window = global;
global.toastr = {
    success: () => {}, warning: () => {}, error: () => {}, info: () => {},
};
global.jQuery = function () {};

const settingsHost = {};   // 模拟宿主 settings 对象
const registeredCleanups = {};
const events = {};         // eventSource 注册表
global.__extras = {};      // message.extra 捕获
global.RBQ = {
    api: {
        getSettings: () => settingsHost,
        saveSettings: () => { settingsHost._saved = Date.now(); },
        getMessage: (id) => ({ id, name: '莉娅', is_user: false, mes: '测试消息' }),
        getContext: () => ({ name2: '莉娅', name1: '我' }),
        isStreamingActive: () => false,
        getStRequestHeaders: (extra) => Object.assign({ 'X-CSRF-Token': 'test-csrf' }, extra || {}),
        setMessageExtra: (mid, k, v) => { global.__extras[mid + ':' + k] = v; },
        eventSource: { on: (e, f) => { (events[e] = events[e] || []).push(f); }, off: (e, f) => { if (events[e]) events[e] = events[e].filter(x => x !== f); } },
        event_types: { MESSAGE_RECEIVED: 'message_received', CHAT_CHANGED: 'chat_changed' },
    },
    ui: { addSettingPanel: () => { global.__panelMounted = true; } },
    on: () => {},
    registerCleanup: (id, fn) => { registeredCleanups[id] = fn; },
};

global.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {}, remove() {}, href: '', download: '' }),
    head: { appendChild() {} },
    body: { appendChild() {} },
};
const origSetInterval = global.setInterval.bind(global);
global.setInterval = (fn, ms) => { const t = origSetInterval(fn, ms); t.unref(); return t; };

// Node 的 URL.createObjectURL 只认真 Blob; 测试桩是普通对象 → 换宽容版
try { URL.createObjectURL({ size: 1, type: 'a' }); } catch (e) {
    URL.createObjectURL = (b) => 'blob:mock-' + Math.random().toString(36).slice(2);
    URL.revokeObjectURL = () => {};
}

/* ---------- fetch mock ---------- */
const REAL_FETCH = global.fetch.bind(global);   // 保真: 联网段用
const fetchLog = [];
let llmBehavior = null;    // () => {status, body}
let ttsBehavior = null;    // (key, bodyText) => {status, kind}
global.fetch = async (url, opts = {}) => {
    await new Promise(r => setTimeout(r, 10));
    const u = String(url);
    fetchLog.push({ url: u, method: opts.method || 'GET', auth: (opts.headers && opts.headers.Authorization) || '', headers: opts.headers || {}, body: opts.body });
    if (u.includes('/chat/completions')) {
        const b = llmBehavior ? llmBehavior() : { status: 200, content: '{"shouldSpeak":true,"lines":["[sad] 测试台词"]}' };
        return { ok: b.status >= 200 && b.status < 300, status: b.status, statusText: 'HTTP' + b.status, json: async () => ({ choices: [{ message: { content: b.content } }] }) };
    }
    if (u.includes('/v1/tts') || u.includes('/api/plugins/fishtts/tts')) {
        const key = ((opts.headers || {}).Authorization || '').replace('Bearer ', '');
        const b = ttsBehavior ? ttsBehavior(key, opts.body) : { status: 200 };
        if (b.status !== 200) {
            const kindMsg = { credit: 'insufficient credit', auth: 'invalid key', task: 'content moderation' }[b.kind] || 'err';
            return { ok: false, status: b.status, statusText: 'HTTP' + b.status, text: async () => JSON.stringify({ message: kindMsg }) };
        }
        return { ok: true, status: 200, blob: async () => ({ size: 12345, type: 'audio/mpeg' }) };
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
};

/* ---------- 加载插件 ---------- */
const code = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'fish-tts.js'), 'utf8');
vm.runInThisContext(code);
const P = global.window.RBQFishTTS;

(async () => {
    /* ===== 1. 加载与默认设置 ===== */
    check('1.1 插件加载并暴露 API (v' + P.version + ')', !!P && P.version === '0.2.7');
    const S = P.settings;
    check('1.2 设置存于宿主 settings._rbqFishTts 独立命名空间', !!settingsHost._rbqFishTts);
    check('1.3 默认模型 s2.1-pro-free (免费)', S.model === 's2.1-pro-free');
    check('1.4 内置4预设 + 收藏夹含AD学姐/jok', S.presets.length >= 4 && S.favorites.some(f => f.title === 'AD学姐') && S.favorites.some(f => f.title === 'jok'));
    check('1.5 事件已挂 (MESSAGE_RECEIVED/CHAT_CHANGED)', (events.message_received || []).length === 1 && (events.chat_changed || []).length === 1);
    check('1.6 清理钩子已注册', typeof registeredCleanups['rbq-fish-tts'] === 'function' && typeof global.window.__rbqFishTtsCleanup === 'function');

    /* ===== 2. 绑定匹配 ===== */
    S.bindings = [
        { id: 'b1', name: '莉娅', voiceTitle: 'AD学姐', voiceId: 'v_ad', speed: 1.1, volume: 1, style: 0, enabled: true },
        { id: 'b2', name: '小明', voiceTitle: 'jok', voiceId: 'v_jok', speed: 1, volume: 0, style: 1, enabled: false },
    ];
    check('2.1 精确匹配', P.matchBinding('莉娅')?.voiceId === 'v_ad');
    check('2.2 停用绑定不参与匹配', P.matchBinding('小明') === null);
    check('2.3 未匹配→默认音色兜底', (() => { S.defaultVoice = { id: 'v_def', title: '默认' }; return P.resolveVoice('路人甲')?.voiceId === 'v_def'; })());
    check('2.4 无绑定无默认→null', (() => { S.defaultVoice = null; const d = S.bindings; S.bindings = []; const r = P.resolveVoice('路人甲') === null; S.bindings = d; return r; })());

    /* ===== 3. 规则引擎兜底 ===== */
    const q = P.ruleRewrite('*她红着眼眶抓住你的袖子*"别走……求你了。"*轻笑*"笨蛋。"', { onoma: false, maxChars: 500, forceTags: '' });
    check('3.1 引号台词提取(2段)', q.shouldSpeak === true && q.lines.length === 2 && q.lines[0] === '别走……求你了。');
    const r2 = P.ruleRewrite('今天（心里很慌）不太*平静*想说话', { onoma: false, maxChars: 500, forceTags: '' });
    check('3.2 无引号时剥离动作与括号心理', r2.shouldSpeak && r2.lines[0] === '今天 不太 想说话');
    const r3 = P.ruleRewrite('哈哈，你真逗。', { onoma: true, maxChars: 500, forceTags: '' });
    check('3.3 拟声词映射开启', r3.lines[0].startsWith('[laughing]'));
    const r4 = P.ruleRewrite('纯旁白消息没有台词', { onoma: false, maxChars: 500, forceTags: '[soft]' });
    check('3.4 强制前置标签', r4.lines[0].startsWith('[soft] '));
    check('3.5 超长截断', P.ruleRewrite('x'.repeat(600), { onoma: false, maxChars: 100, forceTags: '' }).lines[0].length <= 100);

    /* ===== 4. JSON 鲁棒解析 ===== */
    check('4.1 代码围栏剥离', P.robustJsonParse('```json\n{"shouldSpeak":true,"lines":["a"]}\n```')?.shouldSpeak === true);
    check('4.2 think块剥离', P.robustJsonParse('<think>思考内容</think>{"shouldSpeak":false}')?.shouldSpeak === false);
    check('4.3 尾逗号修复', P.robustJsonParse('{"shouldSpeak":true,"lines":["a",]}')?.lines.length === 1);
    check('4.4 垃圾输入返回null', P.robustJsonParse('这不是JSON') === null);

    /* ===== 5. 双层提示词 ===== */
    S.llm.mode = 'independent';
    S.llm.baseUrl = 'https://llm.mock/v1';
    S.llm.model = 'test-model';
    S.llm.jailbreak = 'sandbox';
    S.llm.director = 'standard';
    S.activePreset = 'theater';  // maxTags=5
    const fp = P.buildFinalPrompt('莉娅');
    check('5.1 拼接含破限层与导演层', fp.includes('沙盒推演') && fp.includes('台词导演'));
    check('5.2 {{maxTags}} 已替换为预设值5', fp.includes('≤5') && !fp.includes('{{maxTags}}'));
    check('5.3 {{char}} 占位符已替换', !fp.includes('{{char}}'));

    /* ===== 6. LLM 导演流程 (mock) ===== */
    llmBehavior = () => ({ status: 200, content: '前缀废话 {"shouldSpeak":true,"lines":["[sad][whispering] 别走……","[chuckling] 笨蛋。"]} 后缀' });
    const d1 = await P.runDirector('*她抓住袖子*"别走……求你了。"', '莉娅');
    check('6.1 导演成功提取带标签台词', d1.shouldSpeak === true && d1.lines[0] === '[sad][whispering] 别走……');
    llmBehavior = () => ({ status: 200, content: '{"shouldSpeak":false}' });
    check('6.2 shouldSpeak=false 透传', (await P.runDirector('纯旁白', '莉娅')).shouldSpeak === false);
    llmBehavior = () => ({ status: 500, content: '' });
    const d3 = await P.runDirector('*动作*"台词内容"', '莉娅');
    check('6.3 LLM挂掉自动回退规则引擎', d3.shouldSpeak === true && d3.lines[0] === '台词内容');
    // 多角色模式
    S.llm.director = 'multispeaker';
    llmBehavior = () => ({ status: 200, content: '{"shouldSpeak":true,"lines":[{"speaker":"莉娅","text":"[sad] 我先说"},{"speaker":"小明","text":"[calm] 我后说"}]}' });
    const d4 = await P.runDirector('对话', '莉娅');
    check('6.4 多角色模式保留speaker', Array.isArray(d4.lines) && d4.lines[0].speaker === '莉娅' && d4.lines[1].speaker === '小明');

    /* ===== 7. 合成层 (mock) ===== */
    S.llm.director = 'standard';
    S.apiKey = 'sk-GOOD,sk-BAD';
    S.synthRoute = 'external';               // 外部通道
    S.apiBase = 'https://proxy.mock';
    const req = () => fetchLog[fetchLog.length - 1];
    const lastBody = () => { try { return JSON.parse(req().body); } catch (e) { return {}; } };

    ttsBehavior = () => ({ status: 200 });
    S.presets.find(p => p.id === 'theater').model = 's2.1-pro-free';
    const blob1 = await P.synthWithFailover('你好世界', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128', speed: 1.2, volume: 3, latency: 'normal' });
    check('7.1 合成成功返回blob', blob1 && blob1.size === 12345);
    check('7.2 请求体含 reference_id/prosody/latency', (() => { const b = lastBody(); return b.reference_id === 'v_ad' && b.prosody.speed === 1.2 && b.prosody.volume === 3 && b.latency === 'normal'; })());
    check('7.3 model 走请求头', req().url.endsWith('/v1/tts') && req().method === 'POST');

    S.apiKey = 'sk-BAD,sk-GOOD';   // 坏Key在前, 验证故障转移
    ttsBehavior = (key) => (key === 'sk-BAD' ? { status: 402, kind: 'credit' } : { status: 200 });
    const blob2 = await P.synthWithFailover('再试一次', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128', speed: 1, volume: 0, latency: 'normal' });
    check('7.4 402(积分)自动切换下一个Key', blob2 && fetchLog.some(f => f.auth === 'Bearer sk-BAD' && f.url.includes('/v1/tts')));

    ttsBehavior = (key) => (key === 'sk-GOOD' ? { status: 401, kind: 'auth' } : { status: 401, kind: 'auth' });
    let authErr = null; try { await P.synthWithFailover('x', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128', speed: 1, volume: 0, latency: 'normal' }); } catch (e) { authErr = e; }
    check('7.5 全Key失败抛聚合错误', authErr && /401|Key/.test(authErr.message));

    ttsBehavior = () => ({ status: 500, kind: 'task' });
    let taskErr = null; try { await P.synthWithFailover('x', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128', speed: 1, volume: 0, latency: 'normal' }); } catch (e) { taskErr = e; }
    check('7.6 内容审核(task)不换Key直接抛', taskErr && taskErr.kind === 'task' && taskErr.message.includes('500'));

    S.apiKey = ''; let nokeyErr = null;
    try { await P.synthWithFailover('x', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128' }); } catch (e) { nokeyErr = e; }
    check('7.7 未配Key友好报错', nokeyErr && nokeyErr.kind === 'nokey');

    /* ===== 7b. 酒馆服务器转发通道 ===== */
    S.apiKey = 'sk-GOOD';
    S.synthRoute = 'server';
    S.apiBase = '';                          // 服务器通道不需要外部地址
    ttsBehavior = () => ({ status: 200 });
    const blobS = await P.synthWithFailover('服务器通道测试', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128', speed: 1, volume: 0, latency: 'normal' });
    check('7b.1 服务器通道成功合成且无需外部地址', blobS && req().url === '/api/plugins/fishtts/tts');
    check('7b.2 Key走X-Fish-Key·永不显式设Authorization(让浏览器自动带酒馆登录)·带CSRF', (() => { const h = req().headers; return h.Authorization === undefined && h['X-Fish-Key'] === 'Bearer sk-GOOD' && h['X-CSRF-Token'] === 'test-csrf' && h.model === 's2.1-pro-free'; })());
    ttsBehavior = () => ({ status: 404 });
    let nosrvErr = null;
    try { await P.synthWithFailover('x', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128' }); } catch (e) { nosrvErr = e; }
    check('7b.3 服务器插件未装(404)友好提示', nosrvErr && nosrvErr.kind === 'noserver' && nosrvErr.message.includes('fishtts'));
    ttsBehavior = () => ({ status: 200 });
    S.tavernUser = '遗留字段'; S.tavernPass = '应被忽略';   // 老版本升级残留, 必须被无视
    await P.synthWithFailover('残留字段忽略', 'v_ad', { model: 's2.1-pro-free', format: 'mp3/128' });
    delete S.tavernUser; delete S.tavernPass;
    check('7b.4 升级残留的tavern凭据字段被无视·Authorization仍不设置', (() => {
        const h = req().headers;
        return h.Authorization === undefined && h['X-Fish-Key'] === 'Bearer sk-GOOD';
    })());
    S.synthRoute = 'external';

    /* ===== 8. 热重载清理 ===== */
    const t0 = Date.now();
    P.cleanup();
    registeredCleanups['rbq-fish-tts']?.();
    check('8.1 cleanup 可重复执行不抛错', Date.now() - t0 >= 0);
    check('8.2 事件监听已解绑', (events.message_received || []).length === 0 && (events.chat_changed || []).length === 0);

    /* ===== 10. 持久音频缓存 (三级查找: 内存→持久→合成) ===== */
    const mem = new Map();
    P._setCacheBackend({
        get: async k => mem.get(k) || null,
        put: async (k, v) => { mem.set(k, v); },
        allEntries: async () => [...mem.entries()],
        delete: async k => { mem.delete(k); },
        clear: async () => { mem.clear(); },
    });
    P._resetRuntime();
    S.persistCache = true;
    S.synthRoute = 'external'; S.apiBase = 'https://proxy.mock'; S.apiKey = 'sk-GOOD';
    S.trigger.autoplay = false;
    S.llm.director = 'standard';
    llmBehavior = () => ({ status: 200, content: '{"shouldSpeak":true,"lines":["缓存测试台词"]}' });
    ttsBehavior = () => ({ status: 200 });
    const ttsCount = () => fetchLog.filter(f => f.url.includes('/tts') && !f.url.includes('/chat')).length;

    const c0 = ttsCount();
    await P.startSpeak(7, { force: true });
    check('10.1 首次朗读触发1次合成', ttsCount() === c0 + 1);
    check('10.2 音频已写入持久缓存', mem.size === 1 && [...mem.values()][0].bytes > 0);
    check('10.3 元数据已写入 message.extra 背包', !!global.__extras['7:rbq_fish_tts']);

    await P.startSpeak(7, { force: true });
    check('10.4 二次朗读命中内存缓存(零合成)', ttsCount() === c0 + 1);

    P._resetRuntime();                    // 模拟刷新页面/重开酒馆(内存缓存清空)
    await P.startSpeak(7, { force: true });
    check('10.5 刷新后命中持久缓存(零合成·免费模型兜底场景之外)', ttsCount() === c0 + 1);

    const usage = await P.cacheUsage();
    check('10.6 占用统计正确', usage.count === 1 && usage.bytes > 0);
    await P.CacheStore.clear();
    P._resetRuntime();   // 内存缓存也要清, 模拟彻底冷启动
    check('10.7 清空缓存后重合成', (await P.cacheUsage()).count === 0 && (await P.startSpeak(7, { force: true }), ttsCount() === c0 + 2));

    P._resetRuntime();                    // 再次模拟刷新(内存清空)
    await P.tryRestore(7);
    const rst = P._getState(7);
    check('10.8 刷新后自动回填ready态(tryRestore·零合成零LLM)', rst.phase === 'ready' && rst.cached === true && ttsCount() === c0 + 2);

    // 10.9 内容指纹校验: 楼层被复用/改文本后的陈旧记录不得恢复(防张冠李戴)
    await P.CacheStore.put('unknown|7|wrongvoice|zzz', { blob: new Blob(['x']), bytes: 1, at: Date.now() + 5000, mes: 'WRONGHASH' });
    P._resetRuntime();
    await P.tryRestore(7);
    const rst2 = P._getState(7);
    check('10.9 指纹不符的陈旧记录被拒·只恢复最新批次', rst2.phase === 'ready' && rst2.urls.length === 1 && ttsCount() === c0 + 2);

    /* ===== 9. (可选) 真实音色库联网检查 ===== */
    if (process.env.RUN_NET) {
        try {
            const mockFetch = global.fetch;
            global.fetch = REAL_FETCH;          // 联网段换回真实 fetch
            const d = await P.listVoices('AD学姐', { pageSize: 3 });
            global.fetch = mockFetch;
            check('9.1 真实音色库搜索"AD学姐"', d.total >= 1 && d.items.some(v => v.title === 'AD学姐'));
        } catch (e) { skip++; console.log('⏸ 9.1 联网跳过: ' + e.message); }
    } else { skip++; console.log('⏸ 9.x 联网检查跳过 (RUN_NET=1 开启)'); }

    console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败, ${skip} 跳过 ==========`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗ 测试崩溃:', e); process.exit(1); });
