/**
 * RBQ Smart Draw Trigger — 绒布球对齐与稳定性全面回归测试
 * 覆盖：
 * 1. rbq_v23 / rbq_v23_3p SHA-256 与官方规则文本一致，且未脱敏篡改旧版提示词 (V40/V35/V13)
 * 2. 默认预设下拉仅展示 第一人称·代入版 / 第三人称·同框版 / 自定义，旧版本动态挂载/隐藏
 * 3. DEFAULTS & getStore() 一次性迁移 (rbqV23Migrated)
 * 4. cleanSdtStoryText (storyText 去元信息) + 自身规则免叠 V13 + 记忆关闭全量标签提示 + Persona 读取 + user_append 无头合并
 * 5. 「沿用酒馆当前聊天 API」(provider === 'st') 请求路由与回退
 * 6. Tool Call streak >= 3 自动直走 JSON 模式 & lorebookWafRetry 对 tools content_filter 自动降级普通 JSON 重试
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const pluginsJson = fs.readFileSync(path.join(__dirname, '../plugins.json'), 'utf8');

function slice(start, end) {
    const from = source.indexOf(start);
    const to = end ? source.indexOf(end, from + start.length) : source.length;
    assert.ok(from >= 0, `missing slice start: ${start}`);
    assert.ok(to > from, `missing slice end: ${end}`);
    return source.slice(from, to);
}

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log('PASS ' + name);
}
async function asyncTest(name, fn) {
    await fn();
    passed++;
    console.log('PASS ' + name);
}

(async () => {
    // 1. Version & Verbatim Prompt Hashes + Untouched Legacy Prompts
    test('version synced to 6.5.54 and rbq_v23/rbq_v23_3p match official-rules.json SHA-256', () => {
        const version = source.match(/const PLUGIN_VERSION = '([\d.]+)'/)[1];
        assert.equal(version, '6.5.54');
        assert.ok(pluginsJson.includes(`"version": "${version}"`));
        assert.ok(pluginsJson.includes(`smart-draw-trigger.js?v=${version}`));
        assert.match(source, /const DEFAULT_SYSTEM_PROMPT_VERSION = 46;/);

        const c2 = vm.createContext({
            V5_SPEC_97_SYSTEM_PROMPT: 'v5', V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT: 'v40',
            CONSISTENT_SYSTEM_PROMPT: 'v24', STORYBOARDER_CLASSIC_PROMPT: 'classic',
            V5_SPEC_93_SYSTEM_PROMPT: 'v29', V5_SPEC_91_SYSTEM_PROMPT: 'v28',
            V27_5_SYSTEM_PROMPT: 'v275', UNIVERSAL_SYSTEM_PROMPT: 'v27',
            HYBRID_NL_SYSTEM_PROMPT: 'hybrid', CONSISTENT_SYSTEM_PROMPT_3D: 'v243d',
            CONSISTENT_SYSTEM_PROMPT_V23: 'v23', CONSISTENT_SYSTEM_PROMPT_V22: 'v22',
            ZIMAGE_NL_PROMPT: 'zimage', GROK_NL_PROMPT: 'grok', STORYBOARDER_SYSTEM_PROMPT: 'v21',
        });
        vm.runInContext(slice('    // V33: 基于', '    function generateGeminiRandomEntropy()') + `
            this.RBQ_V23_FIRST_PERSON_SYSTEM_PROMPT = RBQ_V23_FIRST_PERSON_SYSTEM_PROMPT;
            this.RBQ_V23_THIRD_PERSON_SYSTEM_PROMPT = RBQ_V23_THIRD_PERSON_SYSTEM_PROMPT;
            this.SYSTEM_PROMPT_PRESETS = SYSTEM_PROMPT_PRESETS;
            this.DEFAULT_SYSTEM_PROMPT_PRESET = DEFAULT_SYSTEM_PROMPT_PRESET;
            this.TOP_SYSTEM_PRESET_KEYS = TOP_SYSTEM_PRESET_KEYS;
        `, c2);

        assert.equal(c2.DEFAULT_SYSTEM_PROMPT_PRESET, 'rbq_v23');
        assert.deepEqual([...c2.TOP_SYSTEM_PRESET_KEYS], ['rbq_v23', 'rbq_v23_3p', 'custom']);
        assert.equal(
            crypto.createHash('sha256').update(c2.RBQ_V23_FIRST_PERSON_SYSTEM_PROMPT, 'utf8').digest('hex'),
            'bb2924d12151152cf8fc1aa84f86e8c8a45bf4d727ae0d028a55c00d9ed532ba'
        );
        assert.equal(
            crypto.createHash('sha256').update(c2.RBQ_V23_THIRD_PERSON_SYSTEM_PROMPT, 'utf8').digest('hex'),
            '10e6b6d48f5d5605cb5519101cebe864f509472e003922f7c45a728170d262f3'
        );
        // Legacy V40 remains untouched (not sanitized)
        assert.ok(source.includes('erect shaft entering with perspective foreshortening'), 'V40 remains completely untouched');
    });

    // 2. DEFAULTS and one-time rbqV23Migrated in getStore()
    test('DEFAULTS and one-time rbqV23Migrated migration preserve user choices afterwards', () => {
        const harness = fs.readFileSync(path.join(__dirname, 'run-sdt-toolcall-fallback-tests.js'), 'utf8');
        assert.ok(harness.length > 0);
        const settings = {
            _smartDrawTrigger: {
                systemPromptVersion: 46,
                systemPromptPreset: 'v40_worldbook_97_opt',
                systemPrompt: 'old-v40',
                lorebookBase64: true,
                lorebookWafRetry: false,
                postProcessEnabled: false,
                postProcessRole: 'assistant',
            }
        };
        const ctx = vm.createContext({
            RBQ: { api: { getSettings: () => settings } },
            STORAGE_KEY: '_smartDrawTrigger', ALT_STORAGE_KEY: '_smartDrawTriggerSettings',
            DEFAULT_SYSTEM_PROMPT_VERSION: 46, DEFAULT_SYSTEM_PROMPT_PRESET: 'rbq_v23', DEFAULT_SYSTEM_PROMPT: 'v23-text',
            DEFAULT_POST_PROCESS_PROMPT: 'pp', DEFAULT_JAILBREAK_PRESET: 'sandbox', JAILBREAK_PRESETS: {},
            V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT: 'v40', V5_SPEC_97_SYSTEM_PROMPT: 'v5',
            RBQ_V23_FIRST_PERSON_SYSTEM_PROMPT: 'v23-text',
        });
        vm.runInContext(slice('    const DEFAULTS = {', '    const pendingTimers =') + '\nthis.DEFAULTS = DEFAULTS;', ctx);
        vm.runInContext(slice('    function getStore() {', '    function save() {'), ctx);

        assert.equal(ctx.DEFAULTS.lorebookBase64, false);
        assert.equal(ctx.DEFAULTS.lorebookWafRetry, true);
        assert.equal(ctx.DEFAULTS.postProcessRole, 'user_append');

        const s1 = ctx.getStore();
        assert.equal(s1.systemPromptPreset, 'rbq_v23');
        assert.equal(s1.lorebookBase64, false);
        assert.equal(s1.lorebookWafRetry, true);
        assert.equal(s1.postProcessRole, 'user_append');
        assert.equal(s1.rbqV23Migrated, 1);

        // Once migrated, user can turn Base64 back on or switch preset and it persists
        s1.lorebookBase64 = true;
        s1.systemPromptPreset = 'v35_worldbook_97';
        const s2 = ctx.getStore();
        assert.equal(s2.lorebookBase64, true);
        assert.equal(s2.systemPromptPreset, 'v35_worldbook_97');
    });

    // 3. Top-level preset dropdown omits legacy <optgroup> unless toggled or selected
    test('UI hides legacy system prompt presets by default and mounts/unmounts via toggle', () => {
        const selectMatch = source.match(/<select id="rbq-sdt-system-preset">([\s\S]*?)<\/select>/);
        assert.ok(selectMatch, 'rbq-sdt-system-preset HTML found');
        assert.ok(!selectMatch[1].includes('v40_worldbook_97_opt'), 'legacy presets absent from initial HTML');
        assert.ok(!selectMatch[1].includes('optgroup'), 'optgroup absent from initial HTML for mobile picker hygiene');
        assert.ok(selectMatch[1].includes('value="rbq_v23"'));
        assert.ok(selectMatch[1].includes('value="rbq_v23_3p"'));
        assert.ok(selectMatch[1].includes('value="custom"'));
        assert.ok(source.includes('id="rbq-sdt-toggle-legacy-presets"'));

        const providerMatch = source.match(/<select id="rbq-sdt-provider">([\s\S]*?)<\/select>/);
        assert.ok(providerMatch && providerMatch[1].includes('<option value="st">'), 'provider select includes st host option');
    });

    // 4. storyText cleaning + V13 suppression + memory-off prompt + user_append clean merge
    test('cleanSdtStoryText & buildRequestPayload strip meta tags, suppress V13 for own rules, and append memory-off note', () => {
        const ecSlice = slice('    function getEnhancedContextPayload(', '    function splitTurnsByColon(');
        const colonSlice = slice('    function splitTurnsByColon(', '    async function smartFetch(');
        const ppSlice = slice('    function squashConsecutiveMessages(', '    async function callOpenAiCompatible(');

        const settings = {
            _smartDrawTrigger: {
                systemPromptPreset: 'rbq_v23',
                enhancedContext: 'v13',
                characterMemoryEnabled: false,
                characterProfiles: {},
                lorebookBase64: false,
                lorebookEnabled: false,
                injectCharacterCard: false,
                provider: 'st',
                postProcessEnabled: true,
                postProcessRole: 'user_append',
                postProcessPrompt: '【输出要求】立刻输出 JSON',
                contextCount: 5,
            }
        };
        const ctx = vm.createContext({
            RBQ: {
                api: {
                    getSettings: () => settings,
                    getRecentMessages: () => [{ id: 1, is_user: true, name: '你', mes: '<build>draft</build>\n<content>你推开门。</content>' }],
                }
            },
            getStore: () => settings._smartDrawTrigger,
            isMangaRequest: () => false,
            isMangaContextPreset: ec => String(ec || '').startsWith('v_manga'),
            isLayeredMangaRequest: () => false,
            getRequestEnhancedContext: s => s.enhancedContext,
            getMangaProtocol: () => ({ systemPrompt: () => '', planningPrompt: () => '', planningContext: () => ({}) }),
            getMessageSnapshot: id => ({ id, is_user: false, name: 'Aria', mes: '<think>reasoning</think>\n<content>她站在窗前轻轻叹气。</content>\n<choices>1. A</choices>' }),
            collectMatchedLorebookEntries: () => [],
            collectCharacterCardInfo: () => [],
            getCharacterProfiles: () => ({}),
            isJunkCharacterName: () => false,
            captureMangaRequestContext: () => ({ manga: false }),
            getActiveSystemPrompt: () => 'BASE_V23_RULE',
            DEFAULT_JAILBREAK_PRESET: 'sandbox',
            JAILBREAK_PRESETS: {},
        });
        vm.runInContext(ecSlice, ctx);
        vm.runInContext(colonSlice, ctx);
        vm.runInContext(ppSlice, ctx);

        assert.equal(ctx.cleanSdtStoryText('<think_nya~>hid</think_nya~>\n<time>12:00</time>\n<content>正文第一句。\n\n正文第二句。</content>'), '正文第一句。\n\n正文第二句。');
        assert.equal(ctx.cleanSdtStoryText('<think>cot</think>\n<build>x</build>\n她抬起头。\n<choices>a/b</choices>'), '她抬起头。');
        assert.equal(ctx.cleanSdtStoryText('普通纯正文内容。'), '普通纯正文内容。');

        const { payload } = ctx.buildRequestPayload(2, { type: 'auto' });
        assert.equal(payload.currentMessage.content, '她站在窗前轻轻叹气。');
        assert.equal(payload.recentMessages[0].content, '你推开门。');
        assert.equal(payload.contextAnalysisInstructions, undefined, 'V13 payload suppressed for rbq_v23');
        assert.equal(payload.segments?.length, undefined);

        const sysPrompt = ctx.getSystemPromptWithPresets(settings._smartDrawTrigger, false, 2);
        assert.ok(sysPrompt.includes('【角色外貌记忆关闭时】'), 'memory-off instruction included when characterMemoryEnabled=false');

        const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: '{"a":1}' }];
        ctx.applyPostProcessPrompt(msgs, settings._smartDrawTrigger);
        assert.equal(msgs.length, 2);
        assert.equal(msgs[1].content, '{"a":1}\n\n【输出要求】立刻输出 JSON');
        assert.ok(!msgs[1].content.includes('[输出引导]'), 'clean user_append merge omits legacy header');
    });

    // 5. Persona collected into collectCharacterCardInfo when injectCharacterCard=true
    test('collectCharacterCardInfo appends unarchived SillyTavern user Persona', () => {
        const cardSlice = slice('    function collectCharacterCardInfo(', '    // References for standalone manga');
        const ctx = vm.createContext({
            RBQ: {
                api: {
                    getContext: () => ({
                        characterId: 0,
                        characters: [{ name: 'Aria', description: '银发少女' }],
                        name1: '陆明',
                        powerUserSettings: { persona_description: '黑发东亚青年，戴银框眼镜' },
                    }),
                }
            },
            getStore: () => ({ injectCharacterCard: true, characterMemoryEnabled: true }),
            getActiveChatCharacters: c => [c.characters[0]],
            getCharacterProfile: () => null,
            debugInfo() {},
        });
        vm.runInContext(cardSlice, ctx);
        const list = ctx.collectCharacterCardInfo('客厅里对话', []);
        assert.deepEqual([...list.map(x => x.name)], ['Aria', '陆明']);
        assert.equal(list[1].description, '黑发东亚青年，戴银框眼镜');
    });

    // 6. provider === 'st' routes through SillyTavern backend & falls back cleanly
    await asyncTest('provider=st routes via /api/backends/chat-completions/generate with host model & falls back to ChatCompletionService', async () => {
        const fetchSlice = slice('    const ST_CORS_PROXY_HINT', '    const DRAW_SPEC_TOOL = {');
        const fetchCalls = [];
        let svcCalled = false;
        const stContext = {
            mainApi: 'openai',
            chatCompletionSettings: {
                chat_completion_source: 'makersuite',
                openai_max_tokens: 1024,
                reverse_proxy: 'https://proxy.example/v1',
                proxy_password: 'pw',
            },
            getChatCompletionModel: () => 'gemini-2.5-pro',
            ChatCompletionService: {
                processRequest: async (data) => {
                    svcCalled = true;
                    return { choices: [{ message: { content: `svc:${data.model}` }, finish_reason: 'stop' }] };
                },
            },
        };
        const ctx = vm.createContext({
            window: { location: { protocol: 'http:' } },
            RBQ: { api: { getContext: () => stContext } },
            Response, URL,
            console: { info() {}, warn() {}, error() {}, log() {} },
            PLUGIN_NAME: 'SDT',
            getSillyTavernHeaders: () => ({ 'X-CSRF-Token': 'csrf1' }),
            fetch: async (url, options) => {
                fetchCalls.push({ url, options, body: JSON.parse(options.body) });
                if (fetchCalls.length === 1) {
                    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200 });
                }
                return new Response('Not Found', { status: 404 });
            },
        });
        vm.runInContext(fetchSlice, ctx);

        const r1 = await ctx.smartFetch('st://host-chat-completions', {
            method: 'POST',
            body: JSON.stringify({ model: 'ignored', stream: false, messages: [{ role: 'user', content: 'hi' }] }),
        });
        assert.equal(r1.status, 200);
        assert.equal(fetchCalls[0].url, '/api/backends/chat-completions/generate');
        assert.equal(fetchCalls[0].body.model, 'gemini-2.5-pro');
        assert.equal(fetchCalls[0].body.chat_completion_source, 'makersuite');
        assert.equal(fetchCalls[0].body.max_tokens, 4096);
        assert.equal(fetchCalls[0].body.use_sysprompt, true);

        const r2 = await ctx.smartFetch('st://host-chat-completions', {
            method: 'POST',
            body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
        });
        assert.equal(svcCalled, true);
        assert.equal(JSON.parse(await r2.text()).choices[0].message.content, 'svc:gemini-2.5-pro');
    });

    // 7. content_filter auto-fallback on tools + streak >= 3 skip + reset on genuine tool_calls
    await asyncTest('callOpenAiCompatible retries plain JSON on tools content_filter, remembers streak >= 3, and resets on tool success', async () => {
        const encoder = new TextEncoder();
        const plainJson = JSON.stringify({ shouldDraw: true, reason: 'ok', segments: [{ anchor: { index: 1, text: 'hi' }, scene: 'bedroom', characters: [] }] });
        const sse = chunks => ({
            ok: true, headers: { get: () => 'text/event-stream' },
            body: { getReader() { let i = 0; return { read: () => Promise.resolve(i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true }), cancel() {}, releaseLock() {} }; } }
        });
        const plain = json => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => json, text: async () => JSON.stringify(json) });
        const contentFilterJson = () => plain({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] });
        const okJson = () => plain({ choices: [{ message: { content: plainJson }, finish_reason: 'stop' }] });
        const realToolSse = () => sse([
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'generate_draw_spec', arguments: plainJson } }] } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
            'data: [DONE]\n\n',
        ]);

        const store = {
            provider: 'openai',
            openaiBaseUrl: 'https://relay.invalid/v1',
            openaiModel: 'gemini-3-flash',
            toolCallMode: true,
            lorebookWafRetry: true,
            squashMessages: true,
            toolFallbackStreaks: {},
        };
        const sentBodies = [];
        const queue = [];
        let saveCount = 0;
        const ctx = vm.createContext({
            TextDecoder,
            console: { info() {}, warn() {}, log() {}, error() {} },
            PLUGIN_NAME: 'SDT',
            getStore: () => store,
            save: () => { saveCount++; },
            normalizeBaseUrl: v => v,
            checkUrlSafety() {},
            buildThinkingParams: () => ({}),
            smartFetch() { throw new Error('no live network'); },
            buildRequestPayload: () => ({ payload: { currentMessage: { content: '夕阳下她在海边回头。' } }, rawLorebooks: [], requestContext: { manga: false } }),
            logTaggerPayload() {},
            getSystemPromptWithPresets: () => 'RULE',
            getEnhancedContextSystemPrompt: () => '',
            getRequestEnhancedContext: () => 'off',
            getActiveJailbreakPrompt: () => '',
            applyPostProcessPrompt() {},
            squashConsecutiveMessages: m => m,
            DRAW_SPEC_TOOL_RULE: 'Use tool.',
            getDrawSpecTool: () => ({ type: 'function', function: { name: 'generate_draw_spec', parameters: { type: 'object', properties: { shouldDraw: { type: 'boolean' }, segments: { type: 'array' } }, required: ['shouldDraw', 'segments'] } } }),
            assertMangaRequestContext() {},
            validateStructuredResult: v => v,
            normalizeTaggerResult: j => {
                const calls = ctx.getCompletionToolCalls(j);
                if (calls.length) return JSON.parse(calls[0].arguments);
                return JSON.parse(j.choices[0].message.content);
            },
            safeReadJsonResponse: r => r.json(),
            toastr: { info() {}, warning() {} },
        });
        ctx.callApiWithJsonFallback = async (_u, _o, body) => {
            sentBodies.push(JSON.parse(JSON.stringify(body)));
            assert.ok(queue.length, 'unexpected request');
            return queue.shift();
        };
        vm.runInContext(slice('    function extractJson(', '    function processSseLine('), ctx);
        vm.runInContext(slice('    function processSseLine(', '    function parseSseStringToOpenAiJson('), ctx);
        vm.runInContext(slice('    function buildStandardDrawRequest(', '    const DRAW_SPEC_TOOL_INPUT_MESSAGE'), ctx);
        vm.runInContext(slice('    async function callOpenAiCompatible(', '    async function callCustomHttp('), ctx);

        // 3 rounds: each hits content_filter with tools -> retries without tools -> succeeds!
        for (let i = 0; i < 3; i++) {
            queue.push(contentFilterJson(), okJson());
            const res = await ctx.callOpenAiCompatible(i, { type: 'auto' });
            assert.equal(res.shouldDraw, true);
        }
        assert.equal(sentBodies.length, 6);
        assert.ok(sentBodies[0].tools && !sentBodies[1].tools);
        const key = 'openai|https://relay.invalid/v1|gemini-3-flash';
        assert.equal(store.toolFallbackStreaks[key], 3);
        assert.ok(saveCount >= 3);

        // 4th round: streak === 3 -> skips tools immediately in 1 request!
        queue.push(okJson());
        const res4 = await ctx.callOpenAiCompatible(4, { type: 'auto' });
        assert.equal(res4.shouldDraw, true);
        assert.equal(sentBodies.length, 7);
        assert.equal(sentBodies[6].tools, undefined, '4th request skipped tools due to streak >= 3');

        // Resetting streak and getting a genuine tool_call keeps streak = 0
        store.toolFallbackStreaks[key] = 2;
        queue.push(realToolSse());
        const res5 = await ctx.callOpenAiCompatible(5, { type: 'auto' });
        assert.equal(res5.shouldDraw, true);
        assert.equal(store.toolFallbackStreaks[key], 0);
    });

    // 8. callStructuredCompletion supports provider='st', safety fallback & streak >= 3 skip
    await asyncTest('callStructuredCompletion supports provider=st, safety fallback on tools, and streak >= 3', async () => {
        const plainSpec = JSON.stringify({ shouldDraw: true, reason: 'ok', segments: [{ anchor: { text: 'abc' }, scene: 'cafe', characters: [] }] });
        const store = {
            provider: 'st',
            toolCallMode: true,
            lorebookWafRetry: true,
            toolFallbackStreaks: {},
        };
        const requests = [];
        const ctx = vm.createContext({
            TextDecoder,
            console: { info() {}, warn() {}, log() {}, error() {} },
            PLUGIN_NAME: 'SDT',
            getStore: () => store,
            getStHostActiveApiModel: () => 'gemini-2.5-pro',
            save() {},
            normalizeBaseUrl: v => v,
            checkUrlSafety() { throw new Error('must not checkUrlSafety on st://'); },
            buildThinkingParams: () => ({}),
            smartFetch: async (url, opts) => {
                const body = JSON.parse(opts.body);
                requests.push({ url, headers: opts.headers, body });
                if (body.tools) {
                    return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }) };
                }
                return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ choices: [{ message: { content: plainSpec }, finish_reason: 'stop' }] }) };
            },
            safeReadJsonResponse: r => JSON.parse,
            toastr: { info() {}, warning() {} },
        });
        ctx.callApiWithJsonFallback = async (url, opts, body, fn) => fn(url, { ...opts, body: JSON.stringify(body) });
        vm.runInContext(slice('    function extractJson(', '    function processSseLine('), ctx);
        vm.runInContext(slice('    function processSseLine(', '    function parseSseStringToOpenAiJson('), ctx);
        vm.runInContext(slice('    async function callStructuredCompletion(', '    async function callTagger('), ctx);

        const drawTool = { type: 'function', function: { name: 'generate_draw_spec', parameters: { type: 'object', properties: { shouldDraw: { type: 'boolean' }, segments: { type: 'array' } }, required: ['shouldDraw', 'segments'] } } };
        for (let i = 0; i < 3; i++) {
            const out = await ctx.callStructuredCompletion({ messages: [{ role: 'user', content: 'scene' }], tool: drawTool });
            assert.equal(out.isToolCall, true);
        }
        assert.equal(requests.length, 6);
        assert.equal(requests[0].url, 'st://host-chat-completions');
        assert.equal(requests[0].headers.Authorization, undefined);
        assert.equal(store.toolFallbackStreaks['st|st://host-chat-completions|gemini-2.5-pro'], 3);

        // 4th call skips tools immediately
        const out4 = await ctx.callStructuredCompletion({ messages: [{ role: 'user', content: 'scene' }], tool: drawTool });
        assert.equal(out4.isToolCall, true);
        assert.equal(requests.length, 7);
        assert.equal(requests[6].body.tools, undefined);
    });

    // 9. updateProviderVisibility handles 'st', 'openai', 'custom' correctly with data-rbq-sdt-provider="chat"
    test('updateProviderVisibility shows shared chat controls for st and openai, hides openai URL/key for st', () => {
        const makeEl = (id, providerGroup) => ({
            id,
            value: '',
            checked: id === 'rbq-sdt-tool-call-mode',
            disabled: false,
            style: {},
            title: '',
            tabIndex: 0,
            dataset: providerGroup ? { rbqSdtProvider: providerGroup } : {},
            attributes: {},
            setAttribute(k, v) { this.attributes[k] = String(v); },
        });
        const providerEl = makeEl('rbq-sdt-provider');
        const presetEl = makeEl('rbq-sdt-system-preset');
        presetEl.value = 'rbq_v23';
        const ecEl = makeEl('rbq-sdt-enhanced-context');
        ecEl.value = 'v13';
        const stHint = makeEl('st-hint', 'st');
        const openaiBase = makeEl('openai-base', 'openai');
        const thinkingCard = makeEl('thinking', 'chat');
        const toolInputField = makeEl('rbq-sdt-tool-input-description-field', 'chat');
        const toolInput = makeEl('rbq-sdt-tool-input-description');
        const toolMode = makeEl('rbq-sdt-tool-call-mode');
        const tracked = [stHint, openaiBase, thinkingCard, toolInputField];
        const map = new Map([
            ['rbq-sdt-provider', providerEl],
            ['rbq-sdt-system-preset', presetEl],
            ['rbq-sdt-enhanced-context', ecEl],
            ['rbq-sdt-tool-input-description-field', toolInputField],
            ['rbq-sdt-tool-input-description', toolInput],
            ['rbq-sdt-tool-call-mode', toolMode],
        ]);
        function FakeHTMLElement() {}
        tracked.forEach(e => Object.setPrototypeOf(e, FakeHTMLElement.prototype));
        const ctx = vm.createContext({
            HTMLElement: FakeHTMLElement,
            document: {
                getElementById: id => map.get(id) || null,
                querySelectorAll: sel => sel === '[data-rbq-sdt-provider]' ? tracked : [],
            },
            DEFAULT_JAILBREAK_PRESET: 'sandbox',
            DEFAULT_SYSTEM_PROMPT_PRESET: 'rbq_v23',
            isMangaContextPreset: ec => String(ec || '').startsWith('v_manga'),
        });
        vm.runInContext(slice('    function val(id)', '    function populateModelSelect('), ctx);
        vm.runInContext(slice('    function updateProviderVisibility()', '    async function refreshOpenAiModels()'), ctx);

        providerEl.value = 'st';
        ctx.updateProviderVisibility();
        assert.equal(stHint.style.display, '');
        assert.equal(openaiBase.style.display, 'none');
        assert.equal(thinkingCard.style.display, '');
        assert.equal(toolInputField.style.display, '');
        assert.equal(toolInput.disabled, false);
        assert.equal(ecEl.style.opacity, '0.6');

        providerEl.value = 'openai';
        ctx.updateProviderVisibility();
        assert.equal(stHint.style.display, 'none');
        assert.equal(openaiBase.style.display, '');
        assert.equal(thinkingCard.style.display, '');
        assert.equal(toolInput.disabled, false);

        providerEl.value = 'custom';
        ctx.updateProviderVisibility();
        assert.equal(stHint.style.display, 'none');
        assert.equal(openaiBase.style.display, 'none');
        assert.equal(thinkingCard.style.display, 'none');
        assert.equal(toolInputField.style.display, 'none');
        assert.equal(toolInput.disabled, true);
    });

    console.log(`\nAll ${passed} rongbuqiu alignment regression tests passed!`);
})();
