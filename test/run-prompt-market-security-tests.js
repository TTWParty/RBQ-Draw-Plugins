/** Prompt Market (plugins/prompt-market.js) 1.1.31 security regression tests:
 *  - escapeHtml / safeImageUrl helpers
 *  - card / detail / test-prompt HTML builders never emit raw community markup
 *  - ownership no longer reads creatorKey from the public list (isMyPreset + /api/my-presets)
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

let passed = 0;
const pending = [];
const test = (n, fn) => pending.push([n, fn]);

const src = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'prompt-market.js'), 'utf8');
const cut = (a, b) => {
    const i = src.indexOf(a);
    const j = src.indexOf(b, i + a.length);
    assert.ok(i >= 0 && j > i, `slice not found: ${a}`);
    return src.slice(i, j);
};

const ctx = vm.createContext({ console });
vm.runInContext(cut('    const KAMI_DEFAULT_PREVIEW =', '\n', ) + '\n', ctx);
vm.runInContext(cut('    function escapeHtml(str) {', '    // 图片高保真压缩通用函数'), ctx);
vm.runInContext(cut('    function formatSampler(name) {', '\n    }\n') + '\n    }\n', ctx);
vm.runInContext(cut('    // ── 卡片 HTML', '    function renderCards() {'), ctx);
vm.runInContext(cut('    // ── 详情弹窗 HTML', '    // ── 预设详情弹窗'), ctx);
vm.runInContext(cut('    // ── 测串词卡片 HTML', '    // ── 测串提示词库管理弹窗 ──'), ctx);
vm.runInContext(cut('    function generateCreatorKey() {', '\n    }\n') + '\n    }\n', ctx);

const KAMI = vm.runInContext('KAMI_DEFAULT_PREVIEW', ctx);
assert.match(KAMI, /^https:\/\//);

const XSS = {
    id: 'x"><img src=x onerror=alert(1)>',
    title: '<img src=x onerror=alert(1)>',
    author: '"><script>alert(1)</script>',
    positive: '<script>alert(1)</script>, <artist>wlop</artist>',
    negative: '</div><svg onload=alert(1)>',
    tags: ['<b onmouseover=alert(1)>tag</b>', 'NAI V5'],
    model: '<script>v5</script>',
    likes: '<script>',
    downloads: '"><img onerror=1>',
    previewUrl: 'javascript:alert(1)',
    referenceUrl: 'data:text/html,<script>alert(1)</script>',
    params: { sampler: '"><script>alert(1)</script>', scale: '"><x>', steps: 'onerror=1', cfgRescale: null }
};

function assertNoRawMarkup(html, label) {
    // Only real markup counts: escaped text such as "&lt;img onerror=...&gt;" inside an attribute value is harmless.
    assert.doesNotMatch(html, /<script/i, `${label}: raw <script>`);
    assert.doesNotMatch(html, /<svg/i, `${label}: raw <svg>`);
    assert.doesNotMatch(html, /<artist>/i, `${label}: raw <artist>`);
    for (const tag of html.match(/<[^>]+>/g) || []) {
        const bare = tag.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
        assert.doesNotMatch(bare, /\son[a-z]+\s*=/i, `${label}: event handler attribute in ${tag}`);
        assert.doesNotMatch(tag, /\b(?:src|href)\s*=\s*"\s*(?:javascript:|data:text)/i, `${label}: unsafe URL in ${tag}`);
    }
    assert.doesNotMatch(html, /javascript:/i, `${label}: javascript: URL`);
    assert.doesNotMatch(html, /data:text\/html/i, `${label}: data:text/html URL`);
}

test('escapeHtml escapes & < > " \' and handles null / numbers', () => {
    assert.equal(ctx.escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#039;y&#039;&gt;&amp;&lt;/a&gt;');
    assert.equal(ctx.escapeHtml(null), '');
    assert.equal(ctx.escapeHtml(undefined), '');
    assert.equal(ctx.escapeHtml(6.5), '6.5');
    assert.equal(ctx.escapeHtml('<artist>wlop</artist>'), '&lt;artist&gt;wlop&lt;/artist&gt;');
});

test('safeImageUrl only allows http(s) and data:image/*;base64 for community data', () => {
    const F = 'FALLBACK';
    assert.equal(ctx.safeImageUrl('https://market.rbq.my/previews/a.webp', F), 'https://market.rbq.my/previews/a.webp');
    assert.equal(ctx.safeImageUrl('http://example.com/a.png', F), 'http://example.com/a.png');
    assert.equal(ctx.safeImageUrl('data:image/webp;base64,UklGRg==', F), 'data:image/webp;base64,UklGRg==');
    assert.equal(ctx.safeImageUrl('data:image/png;base64,iVBORw0KGgo=', F), 'data:image/png;base64,iVBORw0KGgo=');
    for (const bad of [
        'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
        'data:image/svg+xml;base64,PHN2Zz4=', 'vbscript:x', '//evil.com/a.png', 'https://x.com/a.png" onerror="alert(1)',
        'https://x.com/<script>', 'blob:https://x.com/abc', '/user/images/a.png', '', '   ', null, undefined, 42, {}
    ]) {
        assert.equal(ctx.safeImageUrl(bad, F), F, `should reject ${String(bad)}`);
    }
});

test('safeImageUrl allowLocal only adds blob: and same-origin /paths (for local generation results)', () => {
    assert.equal(ctx.safeImageUrl('blob:https://tavern.local/abc-123', '', { allowLocal: true }), 'blob:https://tavern.local/abc-123');
    assert.equal(ctx.safeImageUrl('/user/images/a.png', '', { allowLocal: true }), '/user/images/a.png');
    assert.equal(ctx.safeImageUrl('//evil.com/a.png', '', { allowLocal: true }), '');
    assert.equal(ctx.safeImageUrl('javascript:alert(1)', '', { allowLocal: true }), '');
});

test('safeCount / safeTags normalise hostile values', () => {
    assert.equal(ctx.safeCount('<script>'), 0);
    assert.equal(ctx.safeCount(-5), 0);
    assert.equal(ctx.safeCount('12'), 12);
    assert.deepEqual(Array.from(ctx.safeTags('not-an-array')), []);
    assert.deepEqual(Array.from(ctx.safeTags([' a ', null, '', 3])), ['a', '3']);
});

test('buildCardHtml escapes every community field and drops unsafe preview URLs', () => {
    const html = ctx.buildCardHtml(XSS, { isMyWork: true, isAdmin: true, isLiked: true });
    assertNoRawMarkup(html, 'card');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.ok(html.includes(`src="${KAMI}"`), 'falls back to default preview');
    assert.match(html, /rbq-pm-like-num">0</);
});

test('buildCardHtml keeps legit <artist>/<style> prompts readable (escaped, not stripped)', () => {
    const html = ctx.buildCardHtml({ id: 'ok', title: '<style>水彩</style>', author: 'a', previewUrl: 'https://market.rbq.my/p.webp', likes: 3 });
    assert.ok(html.includes('&lt;style&gt;水彩&lt;/style&gt;'));
    assert.ok(html.includes('src="https://market.rbq.my/p.webp"'));
    assert.doesNotMatch(html, /<style>/);
});

test('buildDetailHtml escapes title/author/tags/prompts/sampler/id and validates both images', () => {
    for (const flags of [{}, { isMyWork: true }, { isAdmin: true }]) {
        const html = ctx.buildDetailHtml(XSS, flags);
        assertNoRawMarkup(html, 'detail');
        assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'positive shown as text');
        assert.ok(html.includes('&lt;artist&gt;wlop&lt;/artist&gt;'));
        assert.ok(!html.includes('rbq-pm-detail-tab-ref'), 'unsafe referenceUrl → no reference tab');
        assert.ok(html.includes(`src="${KAMI}"`));
    }
    const ok = ctx.buildDetailHtml({ id: 'a', title: 't', previewUrl: 'https://a.com/p.webp', referenceUrl: 'https://a.com/r.webp', positive: 'x', params: { sampler: 'k_euler', scale: 5, steps: 28, cfgRescale: 0 } });
    assert.ok(ok.includes('rbq-pm-detail-tab-ref'), 'safe referenceUrl keeps reference tab');
    assert.ok(ok.includes('src="https://a.com/p.webp"'));
});

test('buildTestPromptCardHtml escapes imported test prompts', () => {
    const html = ctx.buildTestPromptCardHtml({ title: XSS.title, positive: XSS.positive, negative: XSS.negative, isDefault: false }, '1" onclick="x');
    assertNoRawMarkup(html, 'test-prompt');
    assert.doesNotMatch(html, /onclick=/);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('generateCreatorKey produces 16 hex chars from crypto.getRandomValues', () => {
    ctx.globalThis = ctx;
    ctx.crypto = require('node:crypto').webcrypto;
    const keys = new Set(Array.from({ length: 50 }, () => ctx.generateCreatorKey()));
    assert.equal(keys.size, 50);
    for (const k of keys) assert.match(k, /^RBQ-U-[0-9a-f]{16}$/);
});

test('ownership: isMyPreset uses /api/my-presets ids + local ids, never item.creatorKey', async () => {
    assert.doesNotMatch(src, /item\.creatorKey\s*===\s*cfg\.creatorKey/);
    assert.doesNotMatch(src, /it\.creatorKey\s*===\s*cfg\.creatorKey/);
    const own = vm.createContext({ console, Set, Date, String, Array });
    let cfg = { creatorKey: 'RBQ-U-0011223344556677', serverUrl: 'https://srv.test/', myUploadedIds: ['local1'] };
    own.getConfig = () => cfg;
    own.saveConfig = () => { own.saved = (own.saved || 0) + 1; };
    const calls = [];
    own.fetch = async (url, opts) => {
        calls.push({ url, opts });
        if (url.startsWith('https://srv.test/api/my-presets')) return { ok: true, json: async () => ({ success: true, ids: ['srv1', 'local1'] }) };
        return { ok: false, status: 404, json: async () => ({}) };
    };
    vm.runInContext(cut('    // ── 作品归属判定 ──', '    // ── 历史预设静默无感自动认领 ──'), own);
    await own.refreshMyPresetIds();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer RBQ-U-0011223344556677');
    assert.ok(!calls[0].url.includes('RBQ-U-'), 'key must not be put in the URL');
    assert.equal(own.isMyPreset({ id: 'srv1' }), true);
    assert.equal(own.isMyPreset({ id: 'local1' }), true);
    // A public item that still carries someone's (or our) creatorKey but is not in our ids is NOT ours.
    assert.equal(own.isMyPreset({ id: 'other', creatorKey: 'RBQ-U-0011223344556677' }), false);
    assert.deepEqual(cfg.myUploadedIds, ['local1', 'srv1'], 'server ids synced locally');

    // Old server (404) → falls back to local ids, does not throw.
    cfg = { creatorKey: 'RBQ-U-0011223344556677', serverUrl: 'https://old.test', myUploadedIds: ['local1'] };
    await own.refreshMyPresetIds();
    assert.equal(own.isMyPreset({ id: 'srv1' }), false);
    assert.equal(own.isMyPreset({ id: 'local1' }), true);

    // No key → no request at all.
    cfg = { creatorKey: '', serverUrl: 'https://srv.test', myUploadedIds: [] };
    calls.length = 0;
    await own.refreshMyPresetIds();
    assert.equal(calls.length, 0);
    assert.equal(own.isMyPreset({ id: 'srv1', creatorKey: '' }), false);
});

test('换码 UI: generates a new 16-hex key, calls /api/rotate-key with the old key, saves + refreshes', async () => {
    const handlerSrc = cut('        // 换码：生成新码', '        // 保存设置');
    const run = async ({ inputVal, response, confirms = [true, true] }) => {
        const els = {
            '#rbq-pm-cfg-creator-key': { value: inputVal },
            '#rbq-pm-cfg-server': { value: 'https://srv.test/' },
            '#rbq-pm-cfg-rotate-key': { disabled: false, onclick: null }
        };
        const cfg = { creatorKey: inputVal, serverUrl: 'https://srv.test' };
        const log = { fetches: [], toasts: [], saved: 0, refreshed: 0, confirms: 0 };
        const env = vm.createContext({
            console, JSON, Number, String,
            overlay: { querySelector: sel => els[sel] },
            cfg,
            marketModal: null,
            confirm: () => { log.confirms++; return confirms.shift(); },
            generateCreatorKey: () => 'RBQ-U-00aa11bb22cc33dd',
            saveConfig: () => { log.saved++; },
            refreshMyPresetIds: async () => { log.refreshed++; },
            toastr: ['success', 'error', 'warning', 'info'].reduce((o, k) => (o[k] = m => log.toasts.push([k, m]), o), {}),
            fetch: async (url, opts) => { log.fetches.push({ url, opts }); return response; }
        });
        vm.runInContext(handlerSrc, env);
        await els['#rbq-pm-cfg-rotate-key'].onclick();
        return { log, cfg, input: els['#rbq-pm-cfg-creator-key'] };
    };
    const ok = moved => ({ ok: true, status: 200, json: async () => ({ success: true, moved }) });

    let r = await run({ inputVal: 'RBQ-U-d31879f4', response: ok(3) });
    assert.equal(r.log.fetches.length, 1);
    assert.equal(r.log.fetches[0].url, 'https://srv.test/api/rotate-key');
    assert.deepEqual(JSON.parse(r.log.fetches[0].opts.body), { oldKey: 'RBQ-U-d31879f4', newKey: 'RBQ-U-00aa11bb22cc33dd' });
    assert.equal(r.cfg.creatorKey, 'RBQ-U-00aa11bb22cc33dd');
    assert.equal(r.input.value, 'RBQ-U-00aa11bb22cc33dd');
    assert.equal(r.log.saved, 1);
    assert.equal(r.log.refreshed, 1);
    assert.ok(r.log.toasts.some(([k, m]) => k === 'success' && m.includes('3 个作品')));

    // user cancels the confirm → no request, nothing changes
    r = await run({ inputVal: 'RBQ-U-d31879f4', response: ok(3), confirms: [false] });
    assert.equal(r.log.fetches.length, 0);
    assert.equal(r.cfg.creatorKey, 'RBQ-U-d31879f4');

    // empty input → warning, no request
    r = await run({ inputVal: '  ', response: ok(0) });
    assert.equal(r.log.fetches.length, 0);
    assert.ok(r.log.toasts.some(([k]) => k === 'warning'));

    // server error → key kept
    r = await run({ inputVal: 'RBQ-U-d31879f4', response: { ok: false, status: 429, json: async () => ({ success: false, error: '过于频繁' }) } });
    assert.equal(r.cfg.creatorKey, 'RBQ-U-d31879f4');
    assert.equal(r.log.saved, 0);
    assert.ok(r.log.toasts.some(([k, m]) => k === 'error' && m.includes('过于频繁')));

    // old server without the endpoint
    r = await run({ inputVal: 'RBQ-U-d31879f4', response: { ok: false, status: 404, json: async () => ({ error: 'Not Found' }) } });
    assert.equal(r.cfg.creatorKey, 'RBQ-U-d31879f4');
    assert.ok(r.log.toasts.some(([k, m]) => k === 'error' && m.includes('不支持换码')));

    // moved 0 → second confirm; declining keeps the old key
    r = await run({ inputVal: 'RBQ-U-typo0000', response: ok(0), confirms: [true, false] });
    assert.equal(r.cfg.creatorKey, 'RBQ-U-typo0000');
    assert.equal(r.log.confirms, 2);
});

(async () => {
    for (const [n, fn] of pending) {
        await fn();
        passed++;
        console.log('✓', n);
    }
    console.log(`\n${passed} passed`);
})().catch(err => { console.error('✗', err); process.exit(1); });
