/** Production stream completion regressions. Neutral fixtures; no network/image calls. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const encoder = new TextEncoder();
const silentConsole = { info() {}, warn() {}, log() {}, error() {} };
const tool = { type: 'function', function: { name: 'generate_draw_spec', parameters: { type: 'object' } } };
const ordinary = { shouldDraw: true, segments: [], note: '信收到了。字面 [DONE] 保留。' };
const raw = JSON.stringify(ordinary);
const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
let passed = 0;

function host(toolCallMode = false) {
    const store = { openaiBaseUrl: 'https://stub.invalid/v1', openaiModel: 'gemini-neutral', toolCallMode };
    const context = vm.createContext({ TextDecoder, console: silentConsole, PLUGIN_NAME: 'SSE test',
        getStore: () => store, normalizeBaseUrl: value => value, checkUrlSafety() {}, buildThinkingParams: () => ({}),
        smartFetch() { throw new Error('unexpected live request'); },
        buildRequestPayload: () => ({ payload: { currentMessage: '她收到了信。' }, rawLorebooks: [], requestContext: { manga: false } }),
        logTaggerPayload() {}, getSystemPromptWithPresets: () => '返回普通 JSON。', getEnhancedContextSystemPrompt: () => '',
        getRequestEnhancedContext: () => '', getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {},
        squashConsecutiveMessages: messages => messages, DRAW_SPEC_TOOL_RULE: 'Submit final JSON through the tool.',
        getDrawSpecTool: () => tool, assertMangaRequestContext() {}, validateStructuredResult: value => value,
        normalizeTaggerResult(json) {
            const message = json.choices?.[0]?.message || {};
            return JSON.parse(message.tool_calls?.[0]?.function?.arguments || message.content);
        }, safeReadJsonResponse: response => response.json(), toastr: { warning() {} }
    });
    vm.runInContext(source.slice(source.indexOf('    function processSseLine('), source.indexOf('    function parseSseStringToOpenAiJson(')), context);
    vm.runInContext(source.slice(source.indexOf('    async function callOpenAiCompatible('), source.indexOf('    async function callCustomHttp(')), context);
    vm.runInContext(source.slice(source.indexOf('    async function callStructuredCompletion('), source.indexOf('    async function callTagger(')), context);
    return { context, store };
}

function stream(chunks, { heldOpen = true, cancel = 'pending' } = {}) {
    let next = 0, reportWaiting;
    const waiting = new Promise(resolve => { reportWaiting = resolve; });
    const trace = { reads: 0, cancels: 0, releases: 0, waiting };
    const reader = {
        read() {
            trace.reads++;
            if (next < chunks.length) {
                const chunk = chunks[next++];
                return Promise.resolve({ done: false, value: typeof chunk === 'string' ? encoder.encode(chunk) : chunk });
            }
            if (!heldOpen) return Promise.resolve({ done: true });
            reportWaiting();
            return new Promise(() => {});
        },
        cancel() {
            trace.cancels++;
            if (cancel === 'throw') throw new Error('fixture cancellation failure');
            if (cancel === 'reject') return Promise.reject(new Error('fixture cancellation failure'));
            return new Promise(() => {});
        },
        releaseLock() { trace.releases++; }
    };
    return { response: { ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader: () => reader } }, trace };
}

function useStream(context, fixture) {
    context.callApiWithJsonFallback = async (_url, options) => {
        fixture.trace.signal = options.signal;
        return fixture.response;
    };
}

async function bounded(promise) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('completion still waits for held-open stream')), 300);
        })]);
    } finally { clearTimeout(timer); }
}

async function complete(fixture, toolMode = false, signal = null) {
    const { context } = host(toolMode);
    useStream(context, fixture);
    return bounded(context.callStructuredCompletion({ messages: [], tool, signal }));
}

function closedAtTerminal(trace, reads) {
    assert.equal(trace.reads, reads);
    assert.equal(trace.cancels, 1);
    assert.equal(trace.releases, 1);
}

async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

(async () => {
    await test('JSON terminal delta returns intact without EOF or settled cancellation', async () => {
        const fixture = stream([event({ choices: [{ delta: { content: raw }, finish_reason: 'stop' }] })]);
        const result = await complete(fixture);
        assert.equal(result.rawReply, raw);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('modern tool terminal delta retains split arguments', async () => {
        const cut = Math.floor(raw.length / 2);
        const fixture = stream([
            event({ choices: [{ delta: { tool_calls: [{ function: { arguments: raw.slice(0, cut) } }] } }] }),
            event({ choices: [{ delta: { tool_calls: [{ function: { arguments: raw.slice(cut) } }] }, finish_reason: 'tool_calls' }] })
        ]);
        const result = await complete(fixture, true);
        assert.equal(result.rawReply, raw); assert.equal(result.isToolCall, true);
        closedAtTerminal(fixture.trace, 2);
    });

    await test('legacy function_call terminal delta retains its final arguments', async () => {
        const fixture = stream([event({ choices: [{ delta: { function_call: { name: tool.function.name, arguments: raw } }, finish_reason: 'function_call' }] })]);
        const result = await complete(fixture, true);
        assert.equal(result.rawReply, raw); assert.equal(result.isToolCall, true);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('native Gemini STOP retains final text and separate reasoning', async () => {
        const fixture = stream([event({ candidates: [{ content: { parts: [
            { thought: true, text: '核对普通对白。' }, { text: raw }
        ] }, finishReason: 'STOP' }] })]);
        const result = await complete(fixture);
        assert.equal(result.rawReply, raw); assert.equal(result.reasoning, '核对普通对白。');
        closedAtTerminal(fixture.trace, 1);
    });

    await test('native Gemini terminal tool arguments remain structured JSON', async () => {
        const fixture = stream([event({ candidates: [{ content: { parts: [{ functionCall: { name: tool.function.name, args: ordinary } }] }, finishReason: 'STOP' }] })]);
        const result = await complete(fixture, true);
        assert.deepEqual(JSON.parse(result.rawReply), ordinary);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('DONE across chunk boundaries ends an otherwise open stream', async () => {
        const fixture = stream([event({ choices: [{ delta: { content: raw } }] }) + 'data: [DO', 'NE]\n\n']);
        const result = await complete(fixture);
        assert.equal(result.rawReply, raw);
        closedAtTerminal(fixture.trace, 2);
    });

    await test('split UTF-8 final delta is decoded fully before terminal completion', async () => {
        const bytes = encoder.encode(event({ choices: [{ delta: { content: raw }, finish_reason: 'stop' }] }));
        const cut = bytes.findIndex(value => value > 127) + 1;
        const fixture = stream([bytes.slice(0, cut), bytes.slice(cut, cut + 1), bytes.slice(cut + 1)]);
        assert.equal((await complete(fixture)).rawReply, raw);
        closedAtTerminal(fixture.trace, 3);
    });

    await test('EOF without a protocol marker consumes the final unterminated line', async () => {
        const fixture = stream([event({ choices: [{ delta: { content: raw } }] }).trimEnd()], { heldOpen: false });
        assert.equal((await complete(fixture)).rawReply, raw);
        assert.equal(fixture.trace.reads, 2); assert.equal(fixture.trace.cancels, 0); assert.equal(fixture.trace.releases, 1);
    });

    await test('unspecified native finish reason continues through the final delta', async () => {
        const fixture = stream([
            event({ candidates: [{ content: { parts: [{ text: raw.slice(0, 10) }] }, finishReason: 'FINISH_REASON_UNSPECIFIED' }] }),
            event({ candidates: [{ content: { parts: [{ text: raw.slice(10) }] }, finishReason: 'STOP' }] })
        ]);
        assert.equal((await complete(fixture)).rawReply, raw);
        closedAtTerminal(fixture.trace, 2);
    });

    for (const cancel of ['throw', 'reject']) await test(cancel + ' during reader cancellation cannot erase successful output', async () => {
        const fixture = stream([event({ choices: [{ delta: { content: raw }, finish_reason: 'stop' }] })], { cancel });
        assert.equal((await complete(fixture)).rawReply, raw);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('abort rejects a pending reader even when transport and cancel ignore it', async () => {
        const fixture = stream([]), controller = new AbortController();
        const pending = complete(fixture, false, controller.signal);
        await fixture.trace.waiting; controller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(fixture.trace.signal, controller.signal);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('already aborted signal does not start reading a custom transport', async () => {
        const fixture = stream([]), controller = new AbortController(); controller.abort();
        await assert.rejects(complete(fixture, false, controller.signal), error => error.name === 'AbortError');
        closedAtTerminal(fixture.trace, 0);
    });

    await test('SSE error remains an error even with preceding content and a terminal field', async () => {
        const fixture = stream([event({ choices: [{ delta: { content: raw } }] }) + event({ error: { message: 'neutral upstream failure' }, choices: [{ finish_reason: 'stop' }] })]);
        await assert.rejects(complete(fixture), /SSE 流返回错误.*neutral upstream failure/);
        closedAtTerminal(fixture.trace, 1);
    });

    for (const chunk of [
        { choices: [{ delta: {}, finish_reason: 'content_filter' }] },
        { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] },
        { choices: [{ delta: { refusal: 'neutral refusal fixture' }, finish_reason: 'stop' }] }
    ]) await test('terminal safety or refusal is processed before completion', async () => {
        const fixture = stream([event(chunk)]);
        await assert.rejects(complete(fixture), /前置内容安全审查/);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('DONE without required tool arguments still reports missing tool output', async () => {
        const fixture = stream(['data: [DONE]\n\n']);
        await assert.rejects(complete(fixture, true), /未返回工具调用参数/);
        closedAtTerminal(fixture.trace, 1);
    });

    for (const toolMode of [false, true]) await test('chat ' + (toolMode ? 'tool' : 'JSON') + ' stream also finishes without EOF', async () => {
        const { context } = host(toolMode);
        const delta = toolMode ? { tool_calls: [{ function: { arguments: raw } }] } : { content: raw };
        const fixture = stream([event({ choices: [{ delta, finish_reason: toolMode ? 'tool_calls' : 'stop' }] })]);
        useStream(context, fixture);
        const result = await bounded(context.callOpenAiCompatible(0, { type: 'manual' }));
        assert.deepEqual(result, ordinary);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('chat cancellation interrupts a pending reader', async () => {
        const { context } = host(), fixture = stream([]), controller = new AbortController();
        useStream(context, fixture);
        const pending = bounded(context.callOpenAiCompatible(0, { type: 'manual' }, { signal: controller.signal }));
        await fixture.trace.waiting; controller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        closedAtTerminal(fixture.trace, 1);
    });

    await test('chat terminal safety still rejects before normalization', async () => {
        const { context } = host(), fixture = stream([event({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })]);
        useStream(context, fixture);
        await assert.rejects(bounded(context.callOpenAiCompatible(0, { type: 'manual' })), /前置内容安全审查/);
        closedAtTerminal(fixture.trace, 1);
    });

    console.log(`\n${passed} SSE completion tests passed; 0 live requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
