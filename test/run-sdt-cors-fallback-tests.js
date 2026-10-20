/** smartFetch cross-origin chain: direct -> SillyTavern /proxy/ (with CSRF) -> SillyTavern backend relay. Mocked fetch; no network. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const block = source.slice(source.indexOf('    const ST_CORS_PROXY_HINT'), source.indexOf('    const DRAW_SPEC_TOOL = {'));
assert.ok(block.includes('async function smartFetch('), 'smartFetch block found');

function makeContext({ protocol = 'http:', routes, csrf = 'tok123' }) {
    const calls = [];
    const fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        for (const [match, handler] of routes) {
            if (typeof match === 'string' ? String(url) === match : match.test(String(url))) return handler(url, options);
        }
        throw new Error('unrouted ' + url);
    };
    const window = { location: { protocol } };
    const context = vm.createContext({
        window, fetch, Response, URL, console: { info() {}, warn() {}, error() {}, log() {} },
        PLUGIN_NAME: 'SDT', getSillyTavernHeaders: () => ({ 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }),
    });
    vm.runInContext(block, context);
    return { context, calls };
}
const json = (data, status = 200, statusText = '') => new Response(JSON.stringify(data), { status, statusText, headers: { 'Content-Type': 'application/json' } });
const corsFail = () => { throw new TypeError('Failed to fetch'); };
const UP = 'http://llm.example:9000/v1/chat/completions';
const chatBody = {
    model: 'm1', temperature: 0.2, stream: false, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'u: "x"\nline' }],
    reasoning_effort: 'low', thinking: { type: 'enabled', budget_tokens: 1024 }, thinking_budget: 1024,
    tools: [{ type: 'function', function: { name: 'generate_draw_spec', parameters: { type: 'object' } } }],
    tool_choice: { type: 'function', function: { name: 'generate_draw_spec' } },
};
const chatOpts = (headers = { 'Content-Type': 'application/json', Authorization: 'Bearer sk-plugin' }) =>
    ({ method: 'POST', headers, body: JSON.stringify(chatBody) });
const proxyDisabled = () => new Response('CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.', { status: 404 });
const csrfRejected = () => new Response('ForbiddenError: Invalid CSRF token. Please refresh the page and try again.', { status: 403 });
const upstreamOk = { id: 'c1', choices: [{ message: { role: 'assistant', content: '{"shouldDraw":true}' }, finish_reason: 'stop' }] };

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

(async () => {
    await test('direct success is returned untouched without proxy or backend', async () => {
        const { context, calls } = makeContext({ routes: [[UP, () => json(upstreamOk)]] });
        const res = await context.smartFetch(UP, chatOpts());
        assert.equal(res.status, 200); assert.equal(calls.length, 1);
    });
    await test('direct non-405 4xx is returned as before (no fallback)', async () => {
        const { context, calls } = makeContext({ routes: [[UP, () => json({ error: 'bad' }, 400)]] });
        const res = await context.smartFetch(UP, chatOpts());
        assert.equal(res.status, 400); assert.equal(calls.length, 1);
    });
    await test('CORS failure goes through /proxy/ with X-CSRF-Token and keeps upstream auth/body', async () => {
        const { context, calls } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, () => json(upstreamOk)]] });
        const res = await context.smartFetch(UP, chatOpts());
        assert.equal(res.status, 200);
        assert.equal(calls[1].url, '/proxy/' + UP);
        assert.equal(calls[1].options.headers['X-CSRF-Token'], 'tok123');
        assert.equal(calls[1].options.headers.Authorization, 'Bearer sk-plugin');
        assert.equal(calls[1].options.body, JSON.stringify(chatBody));
    });
    await test('proxy enabled: genuine upstream 404 JSON is returned, not misreported as proxy disabled', async () => {
        const { context, calls } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, () => json({ error: { message: 'model not found' } }, 404)]] });
        const res = await context.smartFetch(UP, chatOpts());
        assert.equal(res.status, 404); assert.equal(calls.length, 2);
    });
    for (const [label, proxyRes] of [['404 disabled', proxyDisabled], ['403 Invalid CSRF token', csrfRejected]]) {
        await test(`proxy ${label} -> backend relay with exact upstream fields`, async () => {
            const { context, calls } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, proxyRes],
                ['/api/backends/chat-completions/generate', () => json(upstreamOk)]] });
            const res = await context.smartFetch(UP, chatOpts());
            assert.equal(res.ok, true); assert.deepEqual(await res.json(), upstreamOk);
            const relay = calls[2];
            assert.equal(relay.options.method, 'POST');
            assert.equal(relay.options.headers['X-CSRF-Token'], 'tok123');
            const body = JSON.parse(relay.options.body);
            assert.equal(body.chat_completion_source, 'custom');
            assert.equal(body.custom_url, 'http://llm.example:9000/v1');
            assert.deepEqual(body.messages, chatBody.messages);
            assert.equal(body.stream, false);
            assert.equal(body.reasoning_effort, undefined, 'reasoning_effort must not be top-level (ST would remap it)');
            assert.equal(body.tools, undefined);
            const include = JSON.parse(body.custom_include_body);
            const { messages, ...rest } = chatBody;
            assert.deepEqual(include, rest);
            assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer sk-plugin' });
            // ST parses these strings with the yaml package; JSON must round-trip through YAML unchanged
            try {
                const yaml = require(path.join(__dirname, '../../SillyTavern/node_modules/yaml'));
                assert.deepEqual(yaml.parse(body.custom_include_body), rest);
            } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
        });
    }
    await test('backend 200-with-{error} becomes a failed Response with mapped status', async () => {
        for (const [message, status] of [['Bad Request', 400], ['Too Many Requests', 429], ['Something odd', 502]]) {
            const { context } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, proxyDisabled],
                ['/api/backends/chat-completions/generate', () => json({ error: { message }, quota_error: false })]] });
            const res = await context.smartFetch(UP, chatOpts());
            assert.equal(res.ok, false); assert.equal(res.status, status);
            assert.match(await res.text(), new RegExp(message));
        }
        const { context } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, proxyDisabled],
            ['/api/backends/chat-completions/generate', () => json({ error: { message: 'Bad Request' }, quota_error: true })]] });
        assert.equal((await context.smartFetch(UP, chatOpts())).status, 429);
    });
    await test('backend 502 connection error is returned as failed Response without the proxy hint', async () => {
        const { context } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, proxyDisabled],
            ['/api/backends/chat-completions/generate', () => json({ error: { message: 'Connection refused: x' } }, 502)]] });
        const res = await context.smartFetch(UP, chatOpts());
        assert.equal(res.status, 502);
        assert.doesNotMatch(await res.text(), /enableCorsProxy/);
    });
    await test('all three paths failing throws one error with the actual reasons and the proxy hint', async () => {
        const { context } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, proxyDisabled],
            ['/api/backends/chat-completions/generate', csrfRejected]] });
        await assert.rejects(context.smartFetch(UP, chatOpts()), (err) => {
            assert.match(err.message, /Failed to fetch/); assert.match(err.message, /HTTP 404/);
            assert.match(err.message, /酒馆后端转发亦失败/); assert.match(err.message, /enableCorsProxy: true/);
            return true;
        });
    });
    await test('non-OpenAI custom HTTP call cannot be relayed: clear hint with real reason', async () => {
        const url = 'http://tagger.example/api/analyze';
        const { context, calls } = makeContext({ routes: [[url, corsFail], ['/proxy/' + url, proxyDisabled]] });
        await assert.rejects(context.smartFetch(url, { method: 'POST', headers: { 'X-Key': 'k' }, body: '{"foo":1}' }),
            /无法改经酒馆后端转发.*enableCorsProxy/);
        assert.equal(calls.length, 2);
    });
    await test('custom key header and empty Authorization are forwarded to the relay', async () => {
        const url = 'http://relay.example/v1/chat/completions';
        const { context, calls } = makeContext({ routes: [[url, corsFail], ['/proxy/' + url, proxyDisabled],
            ['/api/backends/chat-completions/generate', () => json(upstreamOk)]] });
        await context.smartFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'abc' }, body: JSON.stringify({ messages: [] }) });
        assert.deepEqual(JSON.parse(JSON.parse(calls[2].options.body).custom_include_headers), { 'x-api-key': 'abc', Authorization: '' });
    });
    await test('GET /models falls back to backend status endpoint', async () => {
        const url = 'http://llm.example:9000/v1/models';
        const { context, calls } = makeContext({ routes: [[url, corsFail], ['/proxy/' + url, proxyDisabled],
            ['/api/backends/chat-completions/status', () => json({ data: [{ id: 'a' }, { id: 'b' }] })]] });
        const res = await context.smartFetch(url, { method: 'GET', headers: { Authorization: 'Bearer k' } });
        assert.deepEqual((await res.json()).data.map(m => m.id), ['a', 'b']);
        const body = JSON.parse(calls[2].options.body);
        assert.equal(body.custom_url, 'http://llm.example:9000/v1');
        assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer k' });
        const failing = makeContext({ routes: [[url, corsFail], ['/proxy/' + url, proxyDisabled],
            ['/api/backends/chat-completions/status', () => json({ error: true, data: { data: [] } })]] });
        assert.equal((await failing.context.smartFetch(url, { method: 'GET' })).status, 502);
    });
    await test('streaming relay returns the backend stream response as-is', async () => {
        const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
        const { context, calls } = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, proxyDisabled],
            ['/api/backends/chat-completions/generate', () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })]] });
        const res = await context.smartFetch(UP, { method: 'POST', headers: {}, body: JSON.stringify({ ...chatBody, stream: true }) });
        assert.equal(await res.text(), sse);
        assert.equal(JSON.parse(calls[2].options.body).stream, true);
    });
    await test('HTTPS page + HTTP API skips direct fetch (mixed content) and falls back to backend', async () => {
        const { context, calls } = makeContext({ protocol: 'https:', routes: [['/proxy/' + UP, proxyDisabled],
            ['/api/backends/chat-completions/generate', () => json(upstreamOk)]] });
        const res = await context.smartFetch(UP, chatOpts());
        assert.equal(res.ok, true); assert.equal(calls[0].url, '/proxy/' + UP);
    });
    await test('direct 405 still tries proxy, then backend', async () => {
        const { context, calls } = makeContext({ routes: [[UP, () => new Response('', { status: 405 })], ['/proxy/' + UP, proxyDisabled],
            ['/api/backends/chat-completions/generate', () => json(upstreamOk)]] });
        assert.equal((await context.smartFetch(UP, chatOpts())).ok, true); assert.equal(calls.length, 3);
    });
    await test('abort errors are not swallowed by the fallback', async () => {
        const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
        const { context } = makeContext({ routes: [[UP, abort]] });
        await assert.rejects(context.smartFetch(UP, chatOpts()), { name: 'AbortError' });
        const later = makeContext({ routes: [[UP, corsFail], ['/proxy/' + UP, abort]] });
        await assert.rejects(later.context.smartFetch(UP, chatOpts()), { name: 'AbortError' });
    });
    await test('callApiWithJsonFallback final thinking-strip retry uses the injected fetch', async () => {
        assert.match(source, /delete cleanBody\.thinking_budget;\s*response = await customFetch\(url,/);
    });
    console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
