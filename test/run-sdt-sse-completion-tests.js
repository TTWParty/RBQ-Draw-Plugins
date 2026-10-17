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
            const selected = context.selectCompletionToolCall(context.getCompletionToolCalls(json), tool.function.name);
            const args = selected?.arguments;
            return args !== undefined ? typeof args === 'string' ? JSON.parse(args) : args : JSON.parse(message.content);
        }, safeReadJsonResponse: response => response.json(), toastr: { warning() {} }
    });
    vm.runInContext(source.slice(source.indexOf('    function extractJson('), source.indexOf('    function processSseLine(')), context);
    vm.runInContext(source.slice(source.indexOf('    function processSseLine('), source.indexOf('    function parseSseStringToOpenAiJson(')), context);
    vm.runInContext(source.slice(source.indexOf('    function buildStandardDrawRequest('), source.indexOf('    const DRAW_SPEC_TOOL_INPUT_MESSAGE')), context);
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

async function complete(fixture, toolMode = false, signal = null, requestTool = tool) {
    const { context } = host(toolMode);
    useStream(context, fixture);
    return bounded(context.callStructuredCompletion({ messages: [], tool: requestTool, signal }));
}

async function completeJson(reply, requestTool = tool) {
    const { context } = host(true);
    context.callApiWithJsonFallback = async () => ({ ok: true,
        headers: { get: () => 'application/json' }, text: async () => JSON.stringify(reply) });
    return context.callStructuredCompletion({ messages: [], tool: requestTool });
}

async function automaticJson(reply, requestTool = tool) {
    const { context } = host(true);
    context.getDrawSpecTool = () => requestTool;
    context.callApiWithJsonFallback = async () => ({ ok: true,
        headers: { get: () => 'application/json' }, json: async () => reply });
    return context.callOpenAiCompatible(0, { type: 'auto' });
}

async function automaticStream(chunks, requestTool = tool) {
    const { context } = host(true), fixture = stream(chunks);
    context.getDrawSpecTool = () => requestTool;
    useStream(context, fixture);
    return bounded(context.callOpenAiCompatible(0, { type: 'auto' }));
}

const namedCall = (name, args, index = 0) => ({ index, type: 'function', function: {
    ...(name === undefined ? {} : { name }), arguments: args
} });
const callsReply = (calls, finishReason = 'tool_calls') => ({ choices: [{
    message: { tool_calls: calls }, finish_reason: finishReason
}] });
const callsDelta = (calls, finishReason) => event({ choices: [{ delta: { tool_calls: calls },
    ...(finishReason === undefined ? {} : { finish_reason: finishReason })
}] });

function toolRoutes(reply, chunks, requestTool = tool) {
    return [
        ['generic JSON', () => completeJson(reply, requestTool)],
        ['generic SSE', () => complete(stream(chunks), true, null, requestTool)],
        ['automatic JSON', () => automaticJson(reply, requestTool)],
        ['automatic SSE', () => automaticStream(chunks, requestTool)]
    ];
}

async function rejectsToolRoutes(reply, chunks, code, { requestTool = tool, rawMatch = null } = {}) {
    for (const [route, run] of toolRoutes(reply, chunks, requestTool)) {
        await assert.rejects(run(), error => {
            assert.equal(error.code, code, route + ' must preserve the protocol error code');
            if (rawMatch) assert.match(String(error.rawOutput || ''), rawMatch, route + ' must retain the original diagnostic');
            return true;
        });
    }
}

async function acceptsToolRoutes(reply, chunks, expectedRaw = raw, requestTool = tool) {
    for (const [route, run] of toolRoutes(reply, chunks, requestTool)) {
        const result = await run();
        if (route.startsWith('generic')) {
            assert.equal(result.rawReply, expectedRaw, route + ' must preserve the selected JSON argument text');
            assert.equal(result.isToolCall, true, route + ' must remain a tool response');
        } else assert.deepEqual(result, JSON.parse(expectedRaw), route + ' must normalize only the selected tool');
    }
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

    const modernReply = finishReason => ({ choices: [{ finish_reason: finishReason, message: {
        tool_calls: [{ function: { name: tool.function.name, arguments: raw } }]
    } }] });
    const nativeReply = finishReason => ({ candidates: [{ finishReason, content: {
        parts: [{ functionCall: { name: tool.function.name, args: ordinary } }]
    } }] });
    for (const reply of [modernReply('tool_calls'), nativeReply('STOP'), {
        choices: [{ finish_reason: 'function_call', message: { function_call: { name: tool.function.name, arguments: raw } } }]
    }]) await test('complete JSON envelopes are accepted when the endpoint ignores stream=true', async () => {
        const result = await completeJson(reply);
        assert.equal(result.isToolCall, true); assert.equal(result.rawReply, raw);
    });

    for (const finishReason of ['length', 'MAX_TOKENS']) await test(finishReason + ' rejects tool arguments even when the JSON is parseable', async () => {
        const fixture = stream([event({ choices: [{ delta: { tool_calls: [{ function: { arguments: raw } }] }, finish_reason: finishReason }] })]);
        await assert.rejects(complete(fixture, true), error => error.code === 'SDT_TOOL_RESPONSE_TRUNCATED');
        closedAtTerminal(fixture.trace, 1);
        await assert.rejects(completeJson(finishReason === 'length' ? modernReply(finishReason) : nativeReply(finishReason)),
            error => error.code === 'SDT_TOOL_RESPONSE_TRUNCATED');
    });

    for (const finishReason of ['content_filter', 'SAFETY']) await test(finishReason + ' rejects remaining tool arguments', async () => {
        const fixture = stream([event({ choices: [{ delta: { tool_calls: [{ function: { arguments: raw } }] }, finish_reason: finishReason }] })]);
        await assert.rejects(complete(fixture, true), error => error.code === 'SDT_TOOL_RESPONSE_BLOCKED');
        closedAtTerminal(fixture.trace, 1);
        await assert.rejects(completeJson(finishReason === 'content_filter' ? modernReply(finishReason) : nativeReply(finishReason)),
            error => error.code === 'SDT_TOOL_RESPONSE_BLOCKED');
    });

    for (const native of [false, true]) await test((native ? 'native' : 'compatible') + ' explicit refusal rejects complete tool arguments', async () => {
        const reply = native ? nativeReply('STOP') : modernReply('stop');
        (native ? reply.candidates[0] : reply.choices[0].message).refusal = 'neutral refusal fixture';
        await assert.rejects(completeJson(reply), error => error.code === 'SDT_TOOL_RESPONSE_BLOCKED');
    });

    await test('native prompt feedback without a candidate remains a blocked response', async () => {
        const reply = { promptFeedback: { blockReason: 'SAFETY' } };
        await assert.rejects(completeJson(reply), error => error.code === 'SDT_TOOL_RESPONSE_BLOCKED');
        await assert.rejects(complete(stream([JSON.stringify(reply)], { heldOpen: false }), true),
            error => error.code === 'SDT_TOOL_RESPONSE_BLOCKED');
    });

    await test('complete JSON error in a streaming body keeps the provider error', async () => {
        const reply = { error: { message: 'neutral upstream overload' } };
        await assert.rejects(complete(stream([JSON.stringify(reply)], { heldOpen: false }), true), /大模型返回错误: neutral upstream overload/);
        await assert.rejects(completeJson(reply), /大模型返回错误: neutral upstream overload/);
    });

    await test('draw completion adapter preserves streamed tool arguments and reasoning for normalization', async () => {
        const { context, store } = host(true);
        const fixture = stream([event({ choices: [{ delta: { reasoning_content: '核对场景。',
            tool_calls: [{ function: { arguments: raw } }] }, finish_reason: 'tool_calls' }] })]);
        useStream(context, fixture);
        const result = await bounded(context.callDrawSpecCompletion([], store));
        assert.equal(result.choices[0].message.content, null);
        assert.equal(result.choices[0].message.reasoning_content, '核对场景。');
        assert.equal(result.choices[0].message.tool_calls[0].function.name, tool.function.name);
        assert.deepEqual(context.normalizeTaggerResult(result), ordinary);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('draw completion uses the prepared request tool without rebuilding its schema', async () => {
        const { context, store } = host(true);
        const prepared = { ...tool, function: { ...tool.function, description: 'Prepared draw output contract.' } };
        context.getDrawSpecTool = () => { throw new Error('prepared tool must be reused'); };
        context.callApiWithJsonFallback = async (_url, _options, body) => {
            assert.equal(body.tools[0], prepared);
            return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({
                choices: [{ message: { tool_calls: [{ function: { name: tool.function.name, arguments: raw } }] }, finish_reason: 'tool_calls' }]
            }) };
        };
        const result = await context.callDrawSpecCompletion([], store, null, null, prepared);
        assert.deepEqual(context.normalizeTaggerResult(result), ordinary);
    });

    await test('6.5.49: tool mode adopts a valid draw-spec JSON returned as ordinary text (no extra request)', async () => {
        const result = await completeJson({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] });
        assert.equal(result.isToolCall, true); assert.deepEqual(JSON.parse(result.rawReply), ordinary);
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
        { choices: [{ delta: {}, finish_reason: 'content_filter: PROHIBITED_CONTENT' }] },
        { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] },
        { choices: [{ delta: { refusal: 'neutral refusal fixture' }, finish_reason: 'stop' }] }
    ]) await test('terminal safety or refusal is processed before completion', async () => {
        const fixture = stream([event(chunk)]);
        await assert.rejects(complete(fixture), /前置内容安全审查/);
        closedAtTerminal(fixture.trace, 1);
    });

    await test('6.5.49: DONE without tool arguments retries once without tools, then reports a clear error', async () => {
        const { context } = host(true), bodies = [];
        context.callApiWithJsonFallback = async (_url, _options, body) => {
            bodies.push(body);
            return stream(['data: [DONE]\n\n']).response;
        };
        await assert.rejects(bounded(context.callStructuredCompletion({ messages: [], tool })), error => {
            assert.equal(error.code, 'SDT_TOOL_RESPONSE_MISSING');
            assert.match(error.message, /没有按工具调用返回/);
            return true;
        });
        assert.equal(bodies.length, 2); assert.ok(bodies[0].tools); assert.equal(bodies[1].tools, undefined);
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

    for (const chunk of [
        { choices: [{ delta: { refusal: 'neutral refusal fixture', tool_calls: [{ function: { arguments: raw } }] }, finish_reason: 'stop' }] },
        { choices: [{ delta: { tool_calls: [{ function: { arguments: raw } }] }, finish_reason: 'length' }] },
        { candidates: [{ content: { parts: [{ functionCall: { name: tool.function.name, args: ordinary } }] }, finishReason: 'MAX_TOKENS' }] }
    ]) await test('automatic tool path rejects refused or truncated final arguments before normalization', async () => {
        const { context } = host(true), fixture = stream([event(chunk)]);
        useStream(context, fixture);
        await assert.rejects(bounded(context.callOpenAiCompatible(0, { type: 'auto' })), /前置内容安全审查|被截断/);
        closedAtTerminal(fixture.trace, 1);
    });

    for (const [format, reply] of [
        ['modern', callsReply([namedCall('other_neutral_tool', raw)])],
        ['legacy', { choices: [{ message: { function_call: { name: 'other_neutral_tool', arguments: raw } }, finish_reason: 'function_call' }] }],
        ['native', { candidates: [{ content: { parts: [{ functionCall: { name: 'other_neutral_tool', args: ordinary } }] }, finishReason: 'STOP' }] }]
    ]) await test(format + ' explicit unexpected function is rejected without relabeling the response', async () => {
        await rejectsToolRoutes(reply, [event(reply)], 'SDT_TOOL_RESPONSE_UNEXPECTED_FUNCTION', { rawMatch: /other_neutral_tool/ });
    });

    for (const expectedFirst of [false, true]) await test('multiple modern calls select the requested function when it is ' + (expectedFirst ? 'first' : 'last'), async () => {
        const expected = namedCall(tool.function.name, raw, expectedFirst ? 0 : 1);
        const other = namedCall('other_neutral_tool', JSON.stringify({ ignored: '普通工具结果' }), expectedFirst ? 1 : 0);
        const calls = expectedFirst ? [expected, other] : [other, expected];
        await acceptsToolRoutes(callsReply(calls), [callsDelta(calls, 'tool_calls')]);
    });

    await test('multiple matching modern calls are ambiguous instead of taking the first result', async () => {
        const calls = [namedCall(tool.function.name, raw, 0), namedCall(tool.function.name, raw, 1)];
        await rejectsToolRoutes(callsReply(calls), [callsDelta(calls, 'tool_calls')], 'SDT_TOOL_RESPONSE_AMBIGUOUS_FUNCTION');
    });

    await test('interleaved stream indices retain each call name and argument fragments separately', async () => {
        const otherRaw = JSON.stringify({ ignored: '另一份结果' });
        const cut = Math.floor(raw.length / 2), otherCut = Math.floor(otherRaw.length / 2);
        const chunks = [
            callsDelta([namedCall('other_neutral_tool', otherRaw.slice(0, otherCut), 0), namedCall(tool.function.name, raw.slice(0, cut), 1)]),
            callsDelta([namedCall(undefined, raw.slice(cut), 1), namedCall(undefined, otherRaw.slice(otherCut), 0)], 'tool_calls')
        ];
        const reply = callsReply([namedCall('other_neutral_tool', otherRaw, 0), namedCall(tool.function.name, raw, 1)]);
        await acceptsToolRoutes(reply, chunks);
    });

    await test('streamed call ids preserve isolation when unnamed-index fragments change their array positions', async () => {
        const otherRaw = JSON.stringify({ ignored: '普通工具结果' });
        const cut = Math.floor(raw.length / 2), otherCut = Math.floor(otherRaw.length / 2);
        const chunks = [
            callsDelta([
                { id: 'call-other', function: { name: 'other_neutral_tool', arguments: otherRaw.slice(0, otherCut) } },
                { id: 'call-draw', function: { name: tool.function.name, arguments: raw.slice(0, cut) } }
            ]),
            callsDelta([
                { id: 'call-draw', function: { arguments: raw.slice(cut) } },
                { id: 'call-other', function: { arguments: otherRaw.slice(otherCut) } }
            ], 'tool_calls')
        ];
        const reply = callsReply([namedCall('other_neutral_tool', otherRaw), namedCall(tool.function.name, raw, 1)]);
        await acceptsToolRoutes(reply, chunks);
    });

    await test('one unnamed call keeps compatible endpoint support through indexed fragments', async () => {
        const cut = Math.floor(raw.length / 2);
        const calls = [namedCall(undefined, raw)];
        await acceptsToolRoutes(callsReply(calls), [
            callsDelta([namedCall(undefined, raw.slice(0, cut))]),
            callsDelta([namedCall(undefined, raw.slice(cut))], 'tool_calls')
        ]);
    });

    await test('a single streamed call keeps its initial name when following fragments omit index and name', async () => {
        const cut = Math.floor(raw.length / 2);
        const reply = callsReply([namedCall(tool.function.name, raw)]);
        const chunks = [
            callsDelta([namedCall(tool.function.name, raw.slice(0, cut))]),
            callsDelta([{ function: { arguments: raw.slice(cut) } }], 'tool_calls')
        ];
        await acceptsToolRoutes(reply, chunks);
    });

    await test('native calls select the requested function without concatenating another part', async () => {
        const reply = { candidates: [{ content: { parts: [
            { functionCall: { name: 'other_neutral_tool', args: { ignored: '普通结果' } } },
            { functionCall: { name: tool.function.name, args: ordinary } }
        ] }, finishReason: 'STOP' }] };
        await acceptsToolRoutes(reply, [event(reply)]);
    });

    await test('separate native calls without ids stay ambiguous across complete argument snapshots', async () => {
        const first = { functionCall: { name: tool.function.name, args: ordinary } };
        const second = { functionCall: { name: tool.function.name, args: { ...ordinary, note: '另一份普通结果。' } } };
        const reply = { candidates: [{ content: { parts: [first, second] }, finishReason: 'STOP' }] };
        const chunks = [
            event({ candidates: [{ content: { parts: [first] } }] }),
            event({ candidates: [{ content: { parts: [second] }, finishReason: 'STOP' }] })
        ];
        await rejectsToolRoutes(reply, chunks, 'SDT_TOOL_RESPONSE_AMBIGUOUS_FUNCTION');
    });

    await test('native snapshots with the same explicit id update to the complete final object', async () => {
        const first = { functionCall: { id: 'native-draw', name: tool.function.name, args: { shouldDraw: true } } };
        const final = { functionCall: { id: 'native-draw', name: tool.function.name, args: ordinary } };
        const reply = { candidates: [{ content: { parts: [final] }, finishReason: 'STOP' }] };
        const chunks = [
            event({ candidates: [{ content: { parts: [first] } }] }),
            event({ candidates: [{ content: { parts: [final] }, finishReason: 'STOP' }] })
        ];
        await acceptsToolRoutes(reply, chunks);
    });

    const invalidArguments = [
        ['damaged JSON', '{"shouldDraw": tru}'],
        ['root null', 'null'],
        ['root array', '[]'],
        ['root string', '"普通结果"'],
        ['root number', '42'],
        ['root boolean', 'true'],
        ['Markdown wrapper', '```json\n' + raw + '\n```']
    ];
    for (const [name, args] of invalidArguments) await test(name + ' cannot become a successful tool object', async () => {
        const calls = [namedCall(tool.function.name, args)];
        await rejectsToolRoutes(callsReply(calls), [callsDelta(calls, 'tool_calls')], 'SDT_TOOL_RESPONSE_INVALID_ARGUMENTS');
    });

    await test('empty or omitted arguments remain invalid tool calls across JSON and SSE paths', async () => {
        for (const args of ['', undefined]) {
            const calls = [namedCall(tool.function.name, args)];
            await rejectsToolRoutes(callsReply(calls), [callsDelta(calls, 'tool_calls')], 'SDT_TOOL_RESPONSE_INVALID_ARGUMENTS');
        }
    });

    const schemaTool = { type: 'function', function: { name: tool.function.name, parameters: {
        type: 'object', required: ['shouldDraw', 'segments'], properties: {
            shouldDraw: { type: 'boolean' }, segments: { type: 'array' }, note: { type: 'string' }
        }
    } } };
    for (const [name, value, requestTool] of [
        ['missing required property', { shouldDraw: true }, schemaTool],
        ['incorrect declared boolean', { shouldDraw: 'true', segments: [] }, schemaTool],
        ['incorrect declared array', { shouldDraw: true, segments: {} }, schemaTool],
        ['incorrect declared string', { shouldDraw: true, segments: [], note: 12 }, schemaTool],
        ['root schema type mismatch', ordinary, { ...schemaTool, function: { ...schemaTool.function, parameters: { type: 'array' } } }]
    ]) await test(name + ' is reported as a tool schema mismatch', async () => {
        const calls = [namedCall(tool.function.name, JSON.stringify(value))];
        await rejectsToolRoutes(callsReply(calls), [callsDelta(calls, 'tool_calls')], 'SDT_TOOL_RESPONSE_SCHEMA_MISMATCH', { requestTool });
    });

    await test('valid tool JSON retains original whitespace, Unicode escapes and literal DONE text', async () => {
        const literal = '{\n  "shouldDraw": true, "segments": [], "note": "字面 \\u4fe1 与 [DONE] 保留。"\n}';
        const calls = [namedCall(tool.function.name, literal)];
        await acceptsToolRoutes(callsReply(calls), [callsDelta(calls, 'tool_calls')], literal, schemaTool);
    });

    await test('generic completion validates against the supplied tool name instead of hardcoding draw spec', async () => {
        const requestTool = { ...schemaTool, function: { ...schemaTool.function, name: 'generate_neutral_storyboard' } };
        const calls = [namedCall(requestTool.function.name, raw)];
        // Automatic SDT uses a fixed function name; the public generic helper also serves other tools.
        for (const completion of [
            () => completeJson(callsReply(calls), requestTool),
            () => complete(stream([callsDelta(calls, 'tool_calls')]), true, null, requestTool)
        ]) assert.equal((await completion()).rawReply, raw);
    });

    await test('HTTP 200 provider errors retain the upstream message in generic and automatic complete-body paths', async () => {
        const reply = { error: { message: 'neutral upstream gateway error' } };
        const runs = [
            () => completeJson(reply),
            () => automaticJson(reply),
            () => complete(stream([JSON.stringify(reply)], { heldOpen: false }), true),
            async () => {
                const { context } = host(true), fixture = stream([JSON.stringify(reply)], { heldOpen: false });
                useStream(context, fixture);
                return bounded(context.callOpenAiCompatible(0, { type: 'auto' }));
            }
        ];
        for (const run of runs) await assert.rejects(run(), error => {
            assert.match(error.message, /大模型返回错误: neutral upstream gateway error/);
            assert.match(String(error.rawOutput || ''), /neutral upstream gateway error/);
            assert.doesNotMatch(error.message, /未返回工具调用参数/);
            return true;
        });
    });

    await test('prompt feedback OTHER blocks complete JSON and reader-body JSON before missing-tool detection', async () => {
        const reply = { promptFeedback: { blockReason: 'OTHER' } };
        const runs = [
            () => completeJson(reply),
            () => automaticJson(reply),
            () => complete(stream([JSON.stringify(reply)], { heldOpen: false }), true),
            async () => {
                const { context } = host(true), fixture = stream([JSON.stringify(reply)], { heldOpen: false });
                useStream(context, fixture);
                return bounded(context.callOpenAiCompatible(0, { type: 'auto' }));
            }
        ];
        for (const run of runs) await assert.rejects(run(), error => {
            assert.equal(error.code, 'SDT_TOOL_RESPONSE_BLOCKED');
            return true;
        });
    });

    for (const invalidKind of ['unexpected name', 'invalid JSON']) for (const terminal of ['refusal', 'content_filter', 'length']) {
        await test(terminal + ' takes precedence over ' + invalidKind + ' in every tool response path', async () => {
            const calls = [namedCall(invalidKind === 'unexpected name' ? 'other_neutral_tool' : tool.function.name,
                invalidKind === 'invalid JSON' ? '{"shouldDraw": tru}' : raw)];
            const reply = callsReply(calls, terminal === 'refusal' ? 'stop' : terminal);
            if (terminal === 'refusal') reply.choices[0].message.refusal = 'neutral refusal fixture';
            await rejectsToolRoutes(reply, [event(reply)], terminal === 'length'
                ? 'SDT_TOOL_RESPONSE_TRUNCATED' : 'SDT_TOOL_RESPONSE_BLOCKED');
        });
    }

    console.log(`\n${passed} SSE completion tests passed; 0 live requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
