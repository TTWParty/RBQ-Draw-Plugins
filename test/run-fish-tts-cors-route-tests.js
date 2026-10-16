/**
 * Fish TTS 合成通道 / 跨域回退测试 (v0.2.8)
 * 默认「直连」: 只走浏览器直连官方兼容接口 /compat/v1/audio/speech, 不偷偷依赖服务端插件。
 * 高级「自动」: 直连 → 酒馆服务器转发 → 外部地址。另测面板「连接」页结构与新手报错文案。
 * 纯本地 mock fetch; RUN_NET=1 时额外对真实 api.fish.audio 做 CORS 预检检查。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'fish-tts.js'), 'utf8');
const COMPAT = 'https://api.fish.audio/compat/v1/audio/speech';

globalThis.__realFetch = globalThis.fetch.bind(globalThis);
let settingsHost = {};
let routes = [];
const calls = [];
global.window = global;
global.toastr = { success() {}, warning() {}, error() {}, info() {} };
global.jQuery = function () {};
global.document = {
    getElementById: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {}, remove() {} }),
    head: { appendChild() {} }, body: { appendChild() {} },
};
const realSetInterval = global.setInterval.bind(global);
global.setInterval = (fn, ms) => { const t = realSetInterval(fn, ms); t.unref(); return t; };
global.RBQ = {
    api: {
        getSettings: () => settingsHost, saveSettings() {},
        getMessage: id => ({ id, name: '莉娅', is_user: false, mes: 'x' }), getContext: () => ({ name2: '莉娅', name1: '我' }),
        isStreamingActive: () => false,
        getStRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-1' }),
        setMessageExtra() {},
        eventSource: { on() {}, off() {} }, event_types: { MESSAGE_RECEIVED: 'm', CHAT_CHANGED: 'c' },
    },
    ui: { addSettingPanel() {} }, on() {}, registerCleanup() {},
};
global.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [match, handler] of routes) if (typeof match === 'string' ? u === match : match.test(u)) return handler(u, init);
    throw new TypeError('Failed to fetch (unrouted ' + u + ')');
};
const audio = (type = 'audio/mpeg', bytes = new Uint8Array([1, 2, 3])) => new Response(new Blob([bytes], { type }), { status: 200 });
const httpErr = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const corsFail = () => { throw new TypeError('Failed to fetch'); };

function load(saved) {
    settingsHost = saved === undefined ? {} : { _rbqFishTts: JSON.parse(JSON.stringify(saved)) };
    vm.runInThisContext(CODE);
    const P = global.window.RBQFishTTS;
    P._resetRoute();
    return P;
}
const preset = { model: 's2.1-pro-free', speed: 1.15, volume: 2, latency: 'normal', format: 'mp3/64' };

let passed = 0;
async function test(name, run) { calls.length = 0; routes = []; await run(); passed++; console.log('PASS ' + name); }

function placeholderWav(dataBytes = 10) {
    const buf = new ArrayBuffer(44 + dataBytes); const dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 4294967076, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 44100, true); dv.setUint32(28, 88200, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, 4294967040, true);
    return buf;
}

(async () => {
    await test('fresh install defaults to direct route, settings v2, version 0.2.8', async () => {
        const P = load();
        assert.equal(P.version, '0.2.8');
        assert.equal(P.settings.synthRoute, 'direct');
        assert.equal(P.settings.version, 2);
        assert.deepEqual(P.routeChain(), ['direct'], 'default never touches the server plugin');
    });
    await test('migration: v1 old default "server"/missing -> direct; explicit external kept; v2 choices kept; bogus -> direct', async () => {
        assert.equal(load({ version: 1, synthRoute: 'server', apiKey: 'k' }).settings.synthRoute, 'direct');
        assert.equal(load({ apiKey: 'k' }).settings.synthRoute, 'direct');
        assert.equal(load({ synthRoute: 'auto' }).settings.synthRoute, 'direct');
        const ext = load({ version: 1, synthRoute: 'external', apiBase: 'https://p.example' }).settings;
        assert.equal(ext.synthRoute, 'external'); assert.equal(ext.version, 2); assert.equal(ext.apiBase, 'https://p.example');
        assert.equal(load({ version: 2, synthRoute: 'server' }).settings.synthRoute, 'server');
        assert.equal(load({ version: 2, synthRoute: 'auto' }).settings.synthRoute, 'auto');
        assert.equal(load({ version: 2, synthRoute: 'bogus' }).settings.synthRoute, 'direct');
    });
    await test('default direct: network failure -> no relay attempt, plain-Chinese hint pointing to advanced', async () => {
        const P = load({ version: 2, apiKey: 'sk-A', apiBase: 'https://proxy.example' });
        routes = [[COMPAT, corsFail], ['/api/plugins/fishtts/tts', () => audio()], [/proxy\.example/, () => audio()]];
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => {
            assert.equal(e.kind, 'network');
            assert.match(e.message, /连不上 Fish/); assert.match(e.message, /api\.fish\.audio/); assert.match(e.message, /高级/);
            return true;
        });
        assert.deepEqual(calls.map(c => c.url), [COMPAT], 'direct mode must not silently use server plugin or external address');
    });
    await test('direct: compat call succeeds with CORS-safe headers and mapped body; no relay call', async () => {
        const P = load({ version: 2, apiKey: 'sk-A' });
        routes = [[COMPAT, () => audio()]];
        const blob = await P.synthWithFailover('[sad] 别走', 'voice123', preset);
        assert.equal(calls.length, 1); assert.equal(blob.size, 3);
        const { url, init } = calls[0];
        assert.equal(url, COMPAT); assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'omit');
        assert.deepEqual(Object.keys(init.headers).sort(), ['Authorization', 'Content-Type'], 'only headers allowed by compat CORS preflight');
        assert.equal(init.headers.Authorization, 'Bearer sk-A');
        const b = JSON.parse(init.body);
        assert.equal(b.model, 'fish-audio/s2.1-pro-free'); assert.equal(b.input, '[sad] 别走'); assert.equal(b.voice, 'voice123');
        assert.equal(b.response_format, 'mp3'); assert.equal(b.speed, 1.15);
        assert.deepEqual(b.provider.options['fish-audio'], { latency: 'normal', normalize: true, prosody: { speed: 1.15, volume: 2 }, mp3_bitrate: 64 });
        assert.equal(P.lastRoute, 'direct');
    });
    await test('compat body: no voice -> "" (model default), wav has no mp3_bitrate, prefixed models kept', async () => {
        const P = load({ version: 2 });
        const b = P.compatTtsBody('hi', null, { model: 'fish-audio/s1', format: 'wav' });
        assert.equal(b.voice, ''); assert.equal(b.model, 'fish-audio/s1'); assert.equal(b.response_format, 'wav');
        assert.equal('mp3_bitrate' in b.provider.options['fish-audio'], false);
    });
    await test('auto: direct blocked (TypeError) -> ST server relay with X-Fish-Key + CSRF, never Authorization; sticky for session', async () => {
        const P = load({ version: 2, apiKey: 'sk-A', synthRoute: 'auto' });
        routes = [[COMPAT, corsFail], ['/api/plugins/fishtts/tts', () => audio()]];
        await P.synthWithFailover('hi', 'v', preset);
        assert.deepEqual(calls.map(c => c.url), [COMPAT, '/api/plugins/fishtts/tts']);
        const h = calls[1].init.headers;
        assert.equal(h['X-Fish-Key'], 'Bearer sk-A'); assert.equal(h['X-CSRF-Token'], 'csrf-1'); assert.equal('Authorization' in h, false);
        assert.equal(h.model, 's2.1-pro-free');
        const nb = JSON.parse(calls[1].init.body);
        assert.equal(nb.reference_id, 'v'); assert.equal(nb.format, 'mp3'); assert.equal(nb.mp3_bitrate, 64);
        assert.equal(P.lastRoute, 'server');
        calls.length = 0;
        await P.synthWithFailover('hi again', 'v', preset);
        assert.deepEqual(calls.map(c => c.url), ['/api/plugins/fishtts/tts'], 'after a direct network failure the relay is tried first');
    });
    await test('auto: direct blocked + relay 404 + apiBase -> external /v1/tts with Authorization', async () => {
        const P = load({ version: 2, apiKey: 'sk-A', synthRoute: 'auto', apiBase: 'https://proxy.example/' });
        routes = [[COMPAT, corsFail], ['/api/plugins/fishtts/tts', () => httpErr(404, 'Not Found')], ['https://proxy.example/v1/tts', () => audio()]];
        await P.synthWithFailover('hi', 'v', preset);
        assert.deepEqual(calls.map(c => c.url), [COMPAT, '/api/plugins/fishtts/tts', 'https://proxy.example/v1/tts']);
        assert.equal(calls[2].init.headers.Authorization, 'Bearer sk-A');
        assert.equal(P.lastRoute, 'external');
    });
    await test('auto: every route unavailable -> one network error naming all routes and the fixes', async () => {
        const P = load({ version: 2, apiKey: 'sk-A,sk-B', synthRoute: 'auto' });
        routes = [[COMPAT, corsFail], ['/api/plugins/fishtts/tts', () => httpErr(404, 'Not Found')]];
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => {
            assert.equal(e.kind, 'network');
            assert.match(e.message, /所有连接方式都失败/); assert.match(e.message, /浏览器直连/); assert.match(e.message, /酒馆服务器转发: HTTP 404/); assert.match(e.message, /外部地址/);
            return true;
        });
        assert.equal(calls.length, 2, 'channel failure does not retry with the second key');
    });
    await test('auto: Fish HTTP errors from the direct route are reported, not masked by fallback', async () => {
        const P = load({ version: 2, apiKey: 'sk-A', synthRoute: 'auto' });
        routes = [[COMPAT, () => httpErr(401, { error: { code: 401, message: 'Invalid Token', type: 'provider_error' } })]];
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => e.kind === 'auth' && /Key 无效/.test(e.message) && !/F5/.test(e.message));
        assert.equal(calls.length, 1);
        calls.length = 0;
        routes = [[COMPAT, () => httpErr(400, { error: { code: 400, message: 'voice not found' } })]];
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => /voice not found/.test(e.message));
        assert.equal(calls.length, 1);
    });
    await test('auto: 402 on first key fails over to second key on the direct route', async () => {
        const P = load({ version: 2, apiKey: 'sk-POOR,sk-RICH' });
        routes = [[COMPAT, (u, init) => init.headers.Authorization === 'Bearer sk-POOR' ? httpErr(402, { error: { message: 'insufficient' } }) : audio()]];
        await P.synthWithFailover('hi', 'v', preset);
        assert.deepEqual(calls.map(c => c.init.headers.Authorization), ['Bearer sk-POOR', 'Bearer sk-RICH']);
    });
    await test('explicit routes do not fall back: server 404 -> noserver, direct TypeError -> network', async () => {
        let P = load({ version: 2, apiKey: 'sk-A', synthRoute: 'server' });
        routes = [['/api/plugins/fishtts/tts', () => httpErr(404, 'Not Found')]];
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => e.kind === 'noserver' && /fishtts/.test(e.message) && /直连/.test(e.message));
        assert.equal(calls.length, 1);
        calls.length = 0;
        P = load({ version: 2, apiKey: 'sk-A', synthRoute: 'direct' });
        routes = [[COMPAT, corsFail]];
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => e.kind === 'network' && /连不上 Fish/.test(e.message));
        assert.equal(calls.length, 1);
    });
    await test('default voice: new install pre-selects AD学姐; empty default filled; existing choice never overridden', async () => {
        const AD = { id: '7f92f8afb8ec43bf81429cc1c9199cb1', title: 'AD学姐' };
        let P = load();
        assert.deepEqual(P.settings.defaultVoice, AD);
        assert.match(P._tabConn(), /<option value="7f92f8afb8ec43bf81429cc1c9199cb1" selected>AD学姐/);
        assert.match(P._tabConn(), /默认音色：AD学姐/);
        assert.deepEqual(load({ version: 2, defaultVoice: null }).settings.defaultVoice, AD);
        assert.deepEqual(load({ version: 1, synthRoute: 'server' }).settings.defaultVoice, AD);
        P = load({ version: 2, defaultVoice: { id: 'mine', title: '我的音色' } });
        assert.deepEqual(P.settings.defaultVoice, { id: 'mine', title: '我的音色' });
        P = load({ version: 2, favorites: [{ id: 'f1', title: '别的' }] });
        assert.deepEqual(P.settings.defaultVoice, AD, 'uses built-in AD学姐 even when user favourites changed');
    });
    await test('saving voices stores the plain title, not the dropdown label with language suffix', async () => {
        const P = load({ version: 2 });
        assert.equal(P._voiceTitleById('7f92f8afb8ec43bf81429cc1c9199cb1'), 'AD学姐');
        assert.ok(P._listVoiceOptions().some(o => o[1] === 'AD学姐 · zh'), 'dropdown label still shows language');
        const vals = { 'rbq-fishtts-connvoice': '23e171c3bbaa4642badf9c98ca31835c', 'rbq-fishtts-apikey': ' sk-x ' };
        const realGet = global.document.getElementById;
        global.document.getElementById = id => (id in vals ? { value: vals[id] } : null);
        try { P._readConnInputs(); } finally { global.document.getElementById = realGet; }
        assert.deepEqual(P.settings.defaultVoice, { id: '23e171c3bbaa4642badf9c98ca31835c', title: '少女' });
        assert.equal(P.settings.apiKey, 'sk-x');
        assert.equal(P.settings.synthRoute, 'direct', 'inputs not rendered keep their saved value');
        const P2 = load({ version: 2, defaultVoice: { id: 'zz', title: '旧 · zh' } });
        assert.equal(P2._voiceTitleById('zz'), '旧', 'legacy polluted titles are cleaned');
        assert.equal(P2._voiceTitleById('unknown-id'), 'unknown-id');
    });
    await test('display shows language like the dropdown (AD学姐 · zh) while stored title stays plain', async () => {
        const P = load();
        assert.equal(P.settings.defaultVoice.title, 'AD学姐');
        assert.match(P._tabConn(), /✓ 默认音色：AD学姐 · zh</);
        assert.equal(P._voiceLabel('7f92f8afb8ec43bf81429cc1c9199cb1', 'AD学姐'), 'AD学姐 · zh');
        assert.equal(P._voiceLabel('7f92f8afb8ec43bf81429cc1c9199cb1', 'AD学姐 · zh'), 'AD学姐 · zh', 'no double suffix');
        assert.equal(P._voiceLabel('not-a-fav', '搜索来的'), '搜索来的', 'unknown language -> plain name');
        assert.equal(P.settings.defaultVoice.title, 'AD学姐', 'display never writes back');
        // message bar path: startSpeak stores the display label in state, not in settings
        routes = [[COMPAT, () => audio()]];
        P.settings.apiKey = 'sk-A'; P.settings.trigger.autoplay = false; P.settings.persistCache = false;
        P.settings.presets.forEach(p => { p.director = false; });
        await P.startSpeak(3, { force: true });
        assert.equal(P._getState(3).phase, 'ready');
        assert.equal(P._getState(3).voiceTitle, 'AD学姐 · zh');
        assert.equal(P.settings.defaultVoice.title, 'AD学姐');
    });
    await test('plain-Chinese HTTP errors: 401 Key无效, 402 余额不足, 429 限流, 400 voice, 5xx; server 401 adds F5 hint', async () => {
        const P = load({ version: 2 });
        const m = (st, body, route) => P._fishHttpError(st, typeof body === 'string' ? body : JSON.stringify(body), route);
        assert.match(m(401, { error: { message: 'Invalid Token' } }, 'direct').message, /^\[401\] Key 无效/);
        assert.equal(m(401, '', 'direct').kind, 'auth');
        assert.match(m(402, { error: { message: 'insufficient' } }, 'direct').message, /余额不足/);
        assert.equal(m(402, '', 'direct').kind, 'credit');
        assert.match(m(429, '', 'direct').message, /限流/);
        assert.match(m(400, { error: { message: 'voice not found' } }, 'direct').message, /音色或模型不可用.*voice not found/);
        assert.match(m(503, 'Service Unavailable', 'direct').message, /Fish 服务器出错/);
        assert.match(m(401, '', 'server').message, /F5/);
        assert.doesNotMatch(m(401, '', 'direct').message, /F5/);
    });
    await test('no key / external without address -> friendly Chinese errors', async () => {
        let P = load({ version: 2 });
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => e.kind === 'nokey' && /还没填 Fish API Key/.test(e.message));
        P = load({ version: 2, apiKey: 'k', synthRoute: 'external' });
        await assert.rejects(P.synthWithFailover('hi', 'v', preset), e => e.kind === 'nobase' && /外部地址/.test(e.message));
        assert.equal(calls.length, 0);
    });
    await test('connection tab: quick start first, route under collapsed advanced <details>, existing setting ids kept', async () => {
        let P = load({ version: 2 });
        const html = P._tabConn();
        const iQuick = html.indexOf('快速上手'), iKey = html.indexOf('id="rbq-fishtts-apikey"'), iAdv = html.indexOf('高级：网络连不上 Fish 时');
        assert.ok(iQuick >= 0 && iKey > iQuick && iAdv > iKey, 'Key comes before advanced section');
        assert.ok(html.indexOf('data-act="testConn"') < iAdv, 'test button in quick start');
        assert.ok(html.indexOf('id="rbq-fishtts-connvoice"') < iAdv, 'default voice picker in quick start');
        const adv = html.slice(html.lastIndexOf('<details', iAdv), html.indexOf('</details>', iAdv));
        assert.match(adv, /id="rbq-fishtts-route"/); assert.match(adv, /id="rbq-fishtts-apibase"/);
        assert.match(adv, /enableServerPlugins/); assert.match(adv, /SillyTavern\/plugins\//);
        assert.doesNotMatch(adv.slice(0, adv.indexOf('>') + 1), /\bopen\b/, 'advanced collapsed by default');
        assert.match(adv, /<option value="direct" selected>/);
        ['apikey', 'route', 'apibase', 'model', 'debug', 'persist'].forEach(id => assert.ok(html.includes(`id="rbq-fishtts-${id}"`), id));
        assert.match(html, /还没填 Key/);
        P = load({ version: 2, synthRoute: 'server', apiKey: 'k', defaultVoice: { id: 'x1', title: '搜索来的音色' } });
        const h2 = P._tabConn();
        assert.match(h2.slice(h2.lastIndexOf('<details', h2.indexOf('高级：网络连不上')), h2.indexOf('高级：网络连不上')), /\bopen\b/, 'non-default route keeps advanced open');
        assert.match(h2, /<option value="x1" selected>搜索来的音色<\/option>/, 'default voice not in favorites still selectable (not wiped on save)');
        assert.match(h2, /Key 已填/);
    });
    await test('fixWavHeader repairs compat placeholder RIFF/data sizes; non-WAV untouched', async () => {
        const P = load({ version: 2 });
        const buf = placeholderWav(10);
        assert.equal(P.fixWavHeader(buf), true);
        const dv = new DataView(buf);
        assert.equal(dv.getUint32(4, true), 54 - 8); assert.equal(dv.getUint32(40, true), 10);
        assert.equal(P.fixWavHeader(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]).buffer), false);
    });
    await test('direct WAV response is returned with a corrected header', async () => {
        const P = load({ version: 2, apiKey: 'sk-A' });
        routes = [[COMPAT, () => audio('audio/wav', new Uint8Array(placeholderWav(20)))]];
        const blob = await P.synthWithFailover('hi', 'v', Object.assign({}, preset, { format: 'wav' }));
        assert.equal(blob.type, 'audio/wav');
        const dv = new DataView(await blob.arrayBuffer());
        assert.equal(dv.getUint32(4, true), 64 - 8); assert.equal(dv.getUint32(40, true), 20);
    });

    if (process.env.RUN_NET) {
        await test('[net] api.fish.audio compat preflight allows browser origin; native /v1/tts does not', async () => {
            const pre = h => ({ method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:8000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': h } });
            const realFetch = globalThis.__realFetch;
            const c = await realFetch(COMPAT, pre('authorization,content-type'));
            assert.ok(c.status === 204 || c.status === 200, 'compat preflight ' + c.status);
            assert.equal(c.headers.get('access-control-allow-origin'), '*');
            assert.match(c.headers.get('access-control-allow-headers') || '', /authorization/i);
            const n = await realFetch('https://api.fish.audio/v1/tts', pre('authorization,content-type,model'));
            assert.equal(n.headers.get('access-control-allow-origin'), null, 'native /v1/tts has no CORS');
        });
    } else console.log('SKIP [net] CORS preflight (set RUN_NET=1)');

    console.log(`\n${passed} passed, 0 failed`);
    process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
