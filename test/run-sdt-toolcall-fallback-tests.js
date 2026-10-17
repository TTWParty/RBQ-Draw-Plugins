/** SDT 6.5.49: 「结构化工具调用 (Tool Call)」 toggle is honoured, and a missing tool call falls back to
 *  text parsing (incl. relay-emulated <<TOOL_CALL>> text) and then ONE plain-JSON retry. Production code slices; no network. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const encoder = new TextEncoder();
const silentConsole = { info() {}, warn() {}, log() {}, error() {} };
let passed = 0;
const same = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), msg);

function slice(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `production section missing: ${start}`);
    return source.slice(from, to);
}
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

/* ───────── A. getStore() no longer overrides the toggle ───────── */
function storeHost(initial) {
    const settings = { _smartDrawTrigger: { systemPromptVersion: 46, ...initial } };
    const elements = new Map();
    const el = id => { if (!elements.has(id)) elements.set(id, { id, value: '', checked: false, listeners: {},
        addEventListener(t, cb) { (this.listeners[t] ||= []).push(cb); } }); return elements.get(id); };
    let saves = 0;
    const context = vm.createContext({
        RBQ: { api: { getSettings: () => settings } }, console: silentConsole,
        STORAGE_KEY: '_smartDrawTrigger', ALT_STORAGE_KEY: '_smartDrawTriggerSettings',
        DEFAULT_SYSTEM_PROMPT_VERSION: 46, DEFAULT_SYSTEM_PROMPT_PRESET: 'fixture', DEFAULT_SYSTEM_PROMPT: 'fixture',
        V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT: 'fixture', V5_SPEC_97_SYSTEM_PROMPT: 'fixture', DEFAULT_POST_PROCESS_PROMPT: 'pp',
        PLUGIN_NAME: 'fixture', document: { getElementById: el }, updateProviderVisibility() {},
        save() { saves++; }, getCustomJailbreakValue: () => '', toastr: { info() {}, success() {}, warning() {} },
    });
    // Real preset table (tool/squash defaults per preset) and the real DEFAULT_JAILBREAK_PRESET.
    vm.runInContext(slice('    const JAILBREAK_PRESETS = {', '    const DEFAULT_JAILBREAK_PROMPT'), context);
    vm.runInContext('this.JAILBREAK_PRESETS = JAILBREAK_PRESETS; this.DEFAULT_JAILBREAK_PRESET = DEFAULT_JAILBREAK_PRESET;', context);
    vm.runInContext(slice('    const DEFAULTS = {', '    const pendingTimers ='), context);
    vm.runInContext(slice('    function getStore() {', '    function save() {'), context);
    vm.runInContext(slice('        function applyJailbreakPresetSwitches(', '        const resetJbBtn'), context);
    return { context, settings, el, saves: () => saves };
}

/* ───────── B. request paths ───────── */
const drawSpec = { shouldDraw: true, segments: [{ anchor: { index: 1 }, scene: 'beach, sunset', characters: [] }] };
const raw = JSON.stringify(drawSpec);
const drawTool = { type: 'function', function: { name: 'generate_draw_spec', parameters: {
    type: 'object', properties: { shouldDraw: { type: 'boolean' }, segments: { type: 'array' } }, required: ['shouldDraw', 'segments'] } } };
const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
const sse = chunks => ({ ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader() {
    let i = 0; return { read: () => Promise.resolve(i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true }),
        cancel() {}, releaseLock() {} }; } } });
const plain = json => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => json, text: async () => JSON.stringify(json) });
const contentStream = (text, finish = 'stop') => sse([event({ choices: [{ delta: { content: text } }] }),
    event({ choices: [{ delta: {}, finish_reason: finish }] }), 'data: [DONE]\n\n']);
const contentJson = (text, finish = 'stop') => plain({ choices: [{ message: { content: text }, finish_reason: finish }] });

function requestHost(toolCallMode, responses) {
    const store = { openaiBaseUrl: 'https://stub.invalid/v1', openaiModel: 'fixture-model', toolCallMode, squashMessages: true };
    const bodies = [], toasts = [];
    const context = vm.createContext({ TextDecoder, console: silentConsole, PLUGIN_NAME: 'fixture',
        getStore: () => store, normalizeBaseUrl: v => v, checkUrlSafety() {}, buildThinkingParams: () => ({}),
        smartFetch() { throw new Error('unexpected live request'); },
        buildRequestPayload: () => ({ payload: { currentMessage: '夕阳下她在海边回头。' }, rawLorebooks: [], requestContext: { manga: false } }),
        logTaggerPayload() {}, getSystemPromptWithPresets: () => 'Return draw JSON.', getEnhancedContextSystemPrompt: () => '',
        getRequestEnhancedContext: () => '', getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {},
        squashConsecutiveMessages: m => m, DRAW_SPEC_TOOL_RULE: 'Submit final JSON through the tool.',
        getDrawSpecTool: () => drawTool, assertMangaRequestContext() {}, validateStructuredResult: v => v,
        normalizeTaggerResult(json) {
            const calls = context.getCompletionToolCalls(json);
            const call = context.selectCompletionToolCall(calls, 'generate_draw_spec');
            if (call) return { via: 'tool', calls: calls.length, value: typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments };
            return { via: 'content', value: context.extractJson(json.choices[0].message.content) };
        },
        safeReadJsonResponse: r => r.json(),
        toastr: { warning(m) { toasts.push(m); }, info(m) { toasts.push(m); } },
    });
    context.callApiWithJsonFallback = async (_url, options, body) => {
        bodies.push(JSON.parse(JSON.stringify(body)));
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra request');
        return typeof next === 'function' ? next(options) : next;
    };
    vm.runInContext(slice('    function extractJson(', '    function processSseLine('), context);
    vm.runInContext(slice('    function processSseLine(', '    function parseSseStringToOpenAiJson('), context);
    vm.runInContext(slice('    function buildStandardDrawRequest(', '    const DRAW_SPEC_TOOL_INPUT_MESSAGE'), context);
    vm.runInContext(slice('    async function callOpenAiCompatible(', '    async function callCustomHttp('), context);
    vm.runInContext(slice('    async function callStructuredCompletion(', '    async function callTagger('), context);
    return { context, store, bodies, toasts };
}

(async () => {
    /* A */
    for (const preset of ['sandbox', 'classic_multiturn', 'render_pipeline', 'render_pipeline_v2']) {
        await test(`toggle OFF survives getStore() with preset ${preset} (and squash stays as saved)`, async () => {
            const h = storeHost({ geminiJailbreakPreset: preset, toolCallMode: false, squashMessages: preset.startsWith('render') });
            for (let i = 0; i < 3; i++) {
                const s = h.context.getStore();
                assert.equal(s.toolCallMode, false);
                assert.equal(s.squashMessages, preset.startsWith('render'));
            }
            assert.equal(h.settings._smartDrawTrigger.toolCallMode, false);
        });
    }
    await test('default preset is sandbox and new installs still default to tool mode ON', async () => {
        const h = storeHost({});
        assert.equal(h.context.DEFAULT_JAILBREAK_PRESET, 'sandbox');
        const s = h.context.getStore();
        assert.equal(s.geminiJailbreakPreset, 'sandbox'); assert.equal(s.toolCallMode, true);
    });
    await test('toggle ON is kept too (getStore is neutral both ways)', async () => {
        const h = storeHost({ geminiJailbreakPreset: 'kami', toolCallMode: true });
        assert.equal(h.context.getStore().toolCallMode, true);
    });
    await test('selecting a preset still applies its tool/squash defaults (and updates the switches)', async () => {
        const h = storeHost({ geminiJailbreakPreset: 'kami', toolCallMode: false, squashMessages: false });
        const s = h.context.getStore();
        h.context.applyJailbreakPresetSwitches(h.context.JAILBREAK_PRESETS.sandbox, s);
        assert.equal(s.toolCallMode, true); assert.equal(s.squashMessages, true);
        assert.equal(h.el('rbq-sdt-tool-call-mode').checked, true);
        h.context.applyJailbreakPresetSwitches(h.context.JAILBREAK_PRESETS.kami, s);
        assert.equal(s.toolCallMode, false); assert.equal(h.el('rbq-sdt-tool-call-mode').checked, false);
        s.toolCallMode = false; s.geminiJailbreakPreset = 'render_pipeline';
        assert.equal(h.context.getStore().toolCallMode, false, 'after a manual OFF the preset no longer re-enables it');
    });

    /* B: toggle off => no tools anywhere */
    await test('toggle OFF: automatic draw request carries no tools/tool_choice', async () => {
        const h = requestHost(false, [contentJson(raw)]);
        const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
        assert.equal(h.bodies.length, 1); assert.equal(h.bodies[0].tools, undefined); assert.equal(h.bodies[0].tool_choice, undefined);
        same(h.bodies[0].response_format, { type: 'json_object' });
        assert.ok(!JSON.stringify(h.bodies[0].messages).includes('through the tool'), 'no tool rule in prompt');
        same(result.value, drawSpec);
    });
    await test('toggle OFF: generic structured completion (manga studio / manual) carries no tools', async () => {
        const h = requestHost(false, [contentJson(raw)]);
        const r = await h.context.callStructuredCompletion({ messages: [{ role: 'user', content: 'x' }], tool: drawTool });
        assert.equal(h.bodies[0].tools, undefined); assert.equal(r.isToolCall, false); assert.equal(r.rawReply, raw);
    });

    /* B: content-only recovery (no second request) */
    const wrappers = {
        'plain JSON': raw,
        'json fence with prose': '好的，分镜如下：\n```json\n' + raw + '\n```\n以上。',
        'relay <<TOOL_CALL>> emulation': '<<TOOL_CALL>>{"name":"generate_draw_spec","arguments":' + raw + '}',
        'relay <<TOOL_CALL>> with string arguments': '<<TOOL_CALL>>' + JSON.stringify({ name: 'generate_draw_spec', arguments: raw }) + '<</TOOL_CALL>>',
        '<tool_call> tag': '<tool_call>\n{"name": "generate_draw_spec", "arguments": ' + raw + '}\n</tool_call>',
        'OpenAI-shaped function object': JSON.stringify({ type: 'function', function: { name: 'generate_draw_spec', arguments: raw } }),
        'think tag before JSON': '<think>先判断画面。</think>' + raw,
    };
    for (const [label, text] of Object.entries(wrappers)) {
        for (const mode of ['stream', 'non-stream']) await test(`tools requested, ${mode} content-only (${label}) => adopted without retry`, async () => {
            const h = requestHost(true, [mode === 'stream' ? contentStream(text) : contentJson(text)]);
            const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
            assert.equal(h.bodies.length, 1); assert.ok(h.bodies[0].tools);
            assert.equal(result.via, 'tool'); same(result.value, drawSpec);
        });
    }
    await test('draw spec only in reasoning_content (stream) => adopted', async () => {
        const h = requestHost(true, [sse([event({ choices: [{ delta: { reasoning_content: 'plan…\n' + raw }, finish_reason: 'stop' }] })])]);
        const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
        assert.equal(h.bodies.length, 1); same(result.value, drawSpec);
    });
    await test('relay sends <<TOOL_CALL>> text AND a real tool_calls delta => one tool call, no duplication', async () => {
        const h = requestHost(true, [sse([
            event({ choices: [{ delta: { content: '<<TOOL_CALL>>{"name":"generate_draw_spec","arguments":' + raw + '}' } }] }),
            event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'generate_draw_spec', arguments: raw } }] } }] }),
            event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), 'data: [DONE]\n\n'])]);
        const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
        assert.equal(h.bodies.length, 1); assert.equal(result.calls, 1); same(result.value, drawSpec);
        assert.equal(result.value.segments.length, 1);
    });
    await test('wrapper naming a different tool is NOT adopted (falls back to retry)', async () => {
        const h = requestHost(true, [contentStream('<<TOOL_CALL>>{"name":"other_tool","arguments":' + raw + '}'), contentJson(raw)]);
        const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
        assert.equal(h.bodies.length, 2); assert.equal(result.via, 'content');
    });

    /* B: garbage => exactly one plain-JSON retry */
    for (const mode of ['stream', 'non-stream', 'empty stream']) await test(`tools requested, ${mode} garbage => one retry without tools, retry result used`, async () => {
        const first = mode === 'stream' ? contentStream('抱歉，我不能调用工具。') : mode === 'non-stream'
            ? contentJson('抱歉，我不能调用工具。') : sse(['data: [DONE]\n\n']);
        const h = requestHost(true, [first, contentJson(raw)]);
        const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
        assert.equal(h.bodies.length, 2);
        assert.ok(h.bodies[0].tools && h.bodies[0].tool_choice);
        assert.equal(h.bodies[1].tools, undefined); assert.equal(h.bodies[1].tool_choice, undefined);
        same(h.bodies[1].response_format, { type: 'json_object' });
        assert.ok(!JSON.stringify(h.bodies[1].messages).includes('through the tool'), 'retry uses the JSON-mode prompt');
        same(result.value, drawSpec);
        assert.ok(h.toasts.some(t => /已自动改用普通模式重试/.test(t)));
        assert.equal(h.store.toolCallMode, true, 'user setting untouched');
    });
    await test('garbage twice => clear Chinese error, no third request', async () => {
        const h = requestHost(true, [contentStream('nope'), contentJson('still nope')]);
        await assert.rejects(h.context.callOpenAiCompatible(0, { type: 'auto' }), err => {
            assert.equal(err.code, 'SDT_TOOL_RESPONSE_MISSING');
            assert.match(err.message, /自动改用普通 JSON 模式重试后仍未得到有效结果/);
            assert.doesNotMatch(err.message, /请在设置中关闭/);
            return true;
        });
        assert.equal(h.bodies.length, 2);
    });
    await test('aborted signal => no retry', async () => {
        const controller = new AbortController();
        const h = requestHost(true, [() => { controller.abort(); return contentJson('nope'); }]);
        await assert.rejects(h.context.callOpenAiCompatible(0, { type: 'auto' }, { signal: controller.signal }), e => e.name === 'AbortError');
        assert.equal(h.bodies.length, 1);
    });
    await test('safety block and length truncation still throw immediately (no retry)', async () => {
        for (const [finish, code] of [['content_filter', 'SDT_TOOL_RESPONSE_BLOCKED'], ['length', 'SDT_TOOL_RESPONSE_TRUNCATED']]) {
            const h = requestHost(true, [contentJson('', finish)]);
            await assert.rejects(h.context.callOpenAiCompatible(0, { type: 'auto' }), e => e.code === code);
            assert.equal(h.bodies.length, 1);
        }
    });

    /* B: live-observed relay failure: upstream error streamed as text, finish_reason stop */
    const proxyErr = '\n[proxy error] {"success":false,"error":"Initial Error: error occurs from gemini api: Timer was not started (Type: ApiCallError). Fallback Error: error occurs from openai api: {\'error\': \'{\\n  \"error';
    for (const mode of ['stream', 'non-stream']) await test(`relay "[proxy error]" text (${mode}) => clear relay error, NO retry`, async () => {
        const h = requestHost(true, [mode === 'stream' ? contentStream(proxyErr) : contentJson(proxyErr)]);
        await assert.rejects(h.context.callOpenAiCompatible(0, { type: 'auto' }), e => {
            assert.equal(e.code, 'SDT_RELAY_ERROR_TEXT'); assert.match(e.message, /不是工具调用的问题/); assert.match(e.message, /Timer was not started/);
            return true;
        });
        assert.equal(h.bodies.length, 1);
    });
    await test('relay error text in the plain-JSON retry is reported as relay error (not swallowed as "no draw")', async () => {
        const h = requestHost(true, [contentStream('nope'), contentJson(proxyErr)]);
        await assert.rejects(h.context.callOpenAiCompatible(0, { type: 'auto' }), e => e.code === 'SDT_RELAY_ERROR_TEXT');
        assert.equal(h.bodies.length, 2);
    });
    await test('structured completion: relay error text => relay error, no retry', async () => {
        const h = requestHost(true, [contentStream(proxyErr)]);
        await assert.rejects(h.context.callStructuredCompletion({ messages: [], tool: drawTool }), e => e.code === 'SDT_RELAY_ERROR_TEXT');
        assert.equal(h.bodies.length, 1);
    });

    /* B: replay of REAL relay streams captured 2026-10-17 (gemini-3.8-flash via an OpenAI-compatible relay) */
    const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
    await test('replay: relay emits truncated <<TOOL_CALL>> text then real tool_calls => single tool call adopted', async () => {
        const h = requestHost(true, [sse([fixture('relay-emulated-toolcall.sse')])]);
        const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
        assert.equal(h.bodies.length, 1); assert.equal(result.via, 'tool'); assert.equal(result.calls, 1);
        assert.equal(result.value.shouldDraw, true); assert.equal(result.value.segments.length, 1);
    });
    await test('replay: same relay stream with the conversion missing (text only) => recovered from <<TOOL_CALL>> text', async () => {
        const realArgs = fixture('relay-emulated-toolcall.sse').split('\n').filter(l => l.includes('"tool_calls":['))
            .map(l => JSON.parse(l.slice(5)).choices[0].delta.tool_calls[0].function.arguments)[0];
        const h = requestHost(true, [contentStream('<<TOOL_CALL>>{"name":"generate_draw_spec","arguments":' + realArgs + '}')]);
        const result = await h.context.callOpenAiCompatible(0, { type: 'auto' });
        assert.equal(h.bodies.length, 1); same(result.value, JSON.parse(realArgs));
    });
    await test('replay: real SDT-sized request answered with "[proxy error]" text => relay error, no retry', async () => {
        const h = requestHost(true, [sse([fixture('relay-proxy-error.sse')])]);
        await assert.rejects(h.context.callOpenAiCompatible(0, { type: 'auto' }), e => e.code === 'SDT_RELAY_ERROR_TEXT');
        assert.equal(h.bodies.length, 1);
    });

    /* B: generic helper (manual draw, test page, manga studio) */
    for (const mode of ['stream', 'non-stream']) await test(`structured completion ${mode}: <<TOOL_CALL>> text adopted as tool args`, async () => {
        const text = '<<TOOL_CALL>>{"name":"generate_draw_spec","arguments":' + raw + '}';
        const h = requestHost(true, [mode === 'stream' ? contentStream(text) : contentJson(text)]);
        const r = await h.context.callStructuredCompletion({ messages: [{ role: 'user', content: 'x' }], tool: drawTool });
        assert.equal(h.bodies.length, 1); assert.equal(r.isToolCall, true); same(JSON.parse(r.rawReply), drawSpec);
    });
    await test('structured completion: garbage => one retry without tools carrying the schema hint', async () => {
        const mangaTool = { type: 'function', function: { name: 'generate_manga_storyboard', parameters: {
            type: 'object', properties: { page: { type: 'object' }, panels: { type: 'array' } }, required: ['page', 'panels'] } } };
        const board = JSON.stringify({ page: { base: 'x' }, panels: [{ id: 'P1' }] });
        const h = requestHost(true, [contentStream('I will now call the tool.'), contentJson(board)]);
        const r = await h.context.callStructuredCompletion({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], tool: mangaTool });
        assert.equal(h.bodies.length, 2); assert.equal(h.bodies[1].tools, undefined);
        assert.match(h.bodies[1].messages[1].content, /generate_manga_storyboard/);
        assert.equal(h.bodies[1].messages.length, 2, 'hint appended to the last user message, not a new turn');
        assert.equal(r.isToolCall, true); same(JSON.parse(r.rawReply), JSON.parse(board));
    });
    await test('structured completion: garbage twice => SDT_TOOL_RESPONSE_MISSING', async () => {
        const h = requestHost(true, [contentStream('nope'), contentJson('nope again')]);
        await assert.rejects(h.context.callStructuredCompletion({ messages: [], tool: drawTool }), e => e.code === 'SDT_TOOL_RESPONSE_MISSING');
        assert.equal(h.bodies.length, 2);
    });


    /* D: 「🔍 检测工具调用」 button (mocked fetch) */
    function probeHost({ toggle = true, responses }) {
        const elements = new Map();
        const el = id => { if (!elements.has(id)) elements.set(id, { id, value: '', checked: false, disabled: false, textContent: '', style: {} }); return elements.get(id); };
        el('rbq-sdt-openai-base').value = 'https://relay.invalid/v1';
        el('rbq-sdt-openai-key').value = 'sk-fixture';
        el('rbq-sdt-openai-model').value = 'fixture-model';
        el('rbq-sdt-tool-call-mode').checked = toggle;
        const store = { toolCallMode: toggle, openaiBaseUrl: 'https://old.invalid/v1', openaiModel: 'old-model', thinkingEffort: 'default' };
        const fetches = []; let saves = 0;
        const context = vm.createContext({ TextDecoder, console: silentConsole, PLUGIN_NAME: 'fixture', AbortController, setTimeout, clearTimeout,
            document: { getElementById: el }, getStore: () => store, save() { saves++; }, updateProviderVisibility() {},
            val: id => el(id).value, checkUrlSafety() {}, safeReadJsonResponse: r => r.json(),
            smartFetch: async (url, options) => {
                fetches.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
                const next = responses.shift();
                if (!next) throw new Error('unexpected extra request');
                if (next instanceof Error) throw next;
                return next;
            },
        });
        vm.runInContext(slice('    function processSseLine(', '    function parseSseStringToOpenAiJson('), context);
        vm.runInContext(slice('    function normalizeBaseUrl(', '    function normalizeModelsUrl('), context);
        vm.runInContext(slice('    function buildThinkingParams(', '    function squashConsecutiveMessages('), context);
        vm.runInContext(slice('    /* ── 6.5.49: 「🔍 检测工具调用」 ── */', '    async function callStructuredCompletion('), context);
        vm.runInContext(slice('        // 6.5.49: 「🔍 检测工具调用」：', "        document.getElementById('rbq-sdt-save').onclick"), context);
        return { context, el, store, fetches, saves: () => saves, click: () => el('rbq-sdt-tool-probe').onclick() };
    }
    const toolSse = (name = 'rbq_tool_probe') => sse([event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: '{"answer":"ok"}' } }] } }] }),
        event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), 'data: [DONE]\n\n']);
    const httpErr = (status, text) => ({ ok: false, status, headers: { get: () => 'application/json' },
        text: async () => text, clone() { return { text: async () => text }; } });
    const nonStreamTool = plain({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'rbq_tool_probe', arguments: '{"answer":"ok"}' } }] }, finish_reason: 'tool_calls' }] });
    nonStreamTool.body = null;

    await test('probe: streamed tool call => ✅, toggle ON + saved; request mirrors SDT tool mode and uses the form values', async () => {
        const h = probeHost({ toggle: false, responses: [toolSse()] });
        await h.click();
        assert.equal(h.store.toolCallMode, true); assert.equal(h.el('rbq-sdt-tool-call-mode').checked, true); assert.equal(h.saves(), 1);
        assert.match(h.el('rbq-sdt-tool-probe-result').textContent, /✅ 支持工具调用/);
        const req = h.fetches[0];
        assert.equal(req.url, 'https://relay.invalid/v1/chat/completions'); assert.equal(req.auth, 'Bearer sk-fixture');
        assert.equal(req.body.model, 'fixture-model'); assert.equal(req.body.stream, true);
        assert.equal(req.body.tools[0].function.name, 'rbq_tool_probe');
        same(req.body.tool_choice, { type: 'function', function: { name: 'rbq_tool_probe' } });
        assert.equal(h.el('rbq-sdt-tool-probe').disabled, false);
    });
    await test('probe: complete JSON envelope with tool call => ✅', async () => {
        const h = probeHost({ toggle: false, responses: [nonStreamTool] });
        await h.click();
        assert.equal(h.store.toolCallMode, true);
    });
    await test('probe: forced tool_choice rejected (400) then auto works => ✅ after exactly one auto retry', async () => {
        const h = probeHost({ toggle: false, responses: [httpErr(400, '{"error":"tool_choice object not supported"}'), toolSse()] });
        await h.click();
        assert.equal(h.fetches.length, 2); assert.equal(h.fetches[1].body.tool_choice, 'auto');
        assert.equal(h.store.toolCallMode, true);
    });
    await test('probe: text-only reply => ❌, toggle OFF + saved', async () => {
        const h = probeHost({ toggle: true, responses: [contentStream('ok')] });
        await h.click();
        assert.equal(h.store.toolCallMode, false); assert.equal(h.el('rbq-sdt-tool-call-mode').checked, false); assert.equal(h.saves(), 1);
        assert.match(h.el('rbq-sdt-tool-probe-result').textContent, /❌ 不支持（已自动关闭/);
    });
    await test('probe: tools rejected (400 mentioning tools, also with auto) => ❌, toggle OFF', async () => {
        const h = probeHost({ toggle: true, responses: [httpErr(400, 'tools are not supported for this model'), httpErr(400, 'tools are not supported for this model')] });
        await h.click();
        assert.equal(h.store.toolCallMode, false); assert.equal(h.saves(), 1);
    });
    for (const [label, responses] of [
        ['401 auth error', [httpErr(401, 'invalid api key')]],
        ['404 wrong URL', [httpErr(404, 'Invalid URL (POST /v1)')]],
        ['429 rate limit', [httpErr(429, 'slow down')]],
        ['500 without tool hint (auto retry also 500)', [httpErr(500, 'upstream exploded'), httpErr(500, 'upstream exploded')]],
        ['network failure', [new TypeError('Failed to fetch')]],
        ['relay "[proxy error]" text', [contentStream('\n[proxy error] {"success":false,"error":"Initial Error: Timer was not started"}')]],
        ['empty stream', [sse(['data: [DONE]\n\n'])]],
    ]) for (const toggle of [true, false]) await test(`probe: ${label} => ⚠️ error, toggle stays ${toggle ? 'ON' : 'OFF'}, nothing saved`, async () => {
        const h = probeHost({ toggle, responses: [...responses] });
        await h.click();
        assert.equal(h.store.toolCallMode, toggle); assert.equal(h.el('rbq-sdt-tool-call-mode').checked, toggle); assert.equal(h.saves(), 0);
        assert.match(h.el('rbq-sdt-tool-probe-result').textContent, /⚠️ 检测没有完成/);
    });
    await test('probe: missing model => error without any request', async () => {
        const h = probeHost({ toggle: true, responses: [] });
        h.el('rbq-sdt-openai-model').value = '';
        await h.click();
        assert.equal(h.fetches.length, 0); assert.equal(h.saves(), 0);
    });
    await test('static: button sits right after the Tool Call toggle in the settings HTML', async () => {
        const i = source.indexOf('id="rbq-sdt-tool-call-mode-field"'), j = source.indexOf('id="rbq-sdt-tool-probe"'), k = source.indexOf('id="rbq-sdt-tool-input-description-field" class');
        assert.ok(i > 0 && j > i && k > j);
        assert.ok(source.includes('🔍 检测工具调用'));
    });

    /* C: static guards */
    await test('static: getStore no longer forces toolCallMode; DEFAULT_SYSTEM_PROMPT_VERSION stays 46; version consistent', async () => {
        const getStoreSrc = slice('    function getStore() {', '    function save() {');
        assert.doesNotMatch(getStoreSrc, /toolCallMode\s*=\s*true/);
        assert.match(source, /DEFAULT_SYSTEM_PROMPT_VERSION = 46\b/);
        const version = source.match(/const PLUGIN_VERSION = '([\d.]+)'/)[1];
        assert.equal(version, '6.5.49');
        assert.ok(fs.readFileSync(path.join(__dirname, '../plugins.json'), 'utf8').includes(`smart-draw-trigger.js?v=${version}`));
        assert.doesNotMatch(source, /请在设置中关闭「结构化工具调用 \(Tool Call\)」开关，或更换支持工具调用的渠道\/模型/);
    });

    console.log(`\n${passed} SDT tool-call fallback tests passed; 0 live requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
