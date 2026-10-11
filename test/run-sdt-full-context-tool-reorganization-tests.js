/**
 * Full context tool description migration & message reorganization regression tests.
 * Verifies that when toolCallMode and toolInputInDescription are enabled:
 * 1. Messages are strictly reorganized into 2 fixed turns (system, user), stripping story/jailbreak/telemetry.
 * 2. System analysis rules and task payload JSON are partitioned into generate_draw_spec's description.
 * 3. Works consistently across all 3 entry points (auto, manual, test) and presets (render_pipeline_v2, etc.).
 * 4. Section 6.1: Manga Studio (RBQ.api.buildSdtMessages) retains its own input text.
 * 5. Section 6.2: When Tool Call is disabled, cleanly falls back to JSON messages with zero data loss.
 * No live models or network calls.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];

const DRAW_SPEC_TOOL_INPUT_MESSAGE = '请读取 generate_draw_spec 工具说明中的本次任务输入，按系统规则分析并通过该工具提交结果。';
const DRAW_SPEC_TOOL_REORGANIZED_SYSTEM_PROMPT = '【结构化工具调用引导】\n你是一个专业视觉分镜分析与提取管道。请直接调用 generate_draw_spec 工具：先完整阅读工具说明（description）中声明的分镜视觉分析规范（VISUAL_ANALYSIS_GUIDELINES）与本次任务输入数据包（Task Input JSON），遵照规范提取角色、服装、动作及场景分镜，并通过工具 parameters 结构化提交结果。严禁在工具调用外输出任何自然语言解释、道歉、拒答或多余文字。';

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('PASS ' + name);
    } catch (e) {
        console.error('FAIL ' + name, e);
        process.exit(1);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        passed++;
        console.log('PASS ' + name);
    } catch (e) {
        console.error('FAIL ' + name, e);
        process.exit(1);
    }
}

function createHost(settingsOverride = {}) {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,sdtSource,mangaSource};')(require, __dirname);
    const { sdt, settings, RBQ, sdtSource } = env;

    const sentRequests = [];
    settings._smartDrawTrigger = {
        openaiBaseUrl: 'https://test.invalid/v1',
        openaiModel: 'test-model',
        provider: 'openai',
        toolCallMode: true,
        toolInputInDescription: true,
        geminiJailbreak: false,
        geminiJailbreakPreset: 'default',
        enhancedContext: 'off',
        _mangaActive: false,
        ...settingsOverride,
    };

    const load = (start, end) => {
        const a = sdtSource.indexOf(start), b = sdtSource.indexOf(end, a);
        assert.ok(a >= 0 && b > a, 'load slice: ' + start);
        vm.runInContext(sdtSource.slice(a, b), sdt);
    };

    load('    const DRAW_SPEC_TOOL_RULE =', '    function buildThinkingParams(');
    load('    async function callOpenAiCompatible(', '    async function callCustomHttp(');
    load('    async function callStructuredCompletion(', '    async function callTagger(');
    load('    async function callDrawSpecCompletion(', '    async function callTagger(');
    load('    async function submitManualDraw(', '    /* ── 🗂️ 剧情漫画时间轴');
    load('    async function parseTaggerSegment(', '    RBQ.api.parseWithTagger =');
    load('    RBQ.api.buildSdtMessages =', '    RBQ.api.callStructuredCompletion =');

    Object.assign(sdt, {
        getActiveJailbreakPrompt: store => store?.geminiJailbreak ? (sdt.JAILBREAK_PRESETS?.[store.geminiJailbreakPreset]?.prompt || '') : '',
        squashConsecutiveMessages: messages => messages,
        applyPostProcessPrompt: (messages, store) => {
            if (store?.postProcessEnabled && store?.postProcessPrompt) {
                messages.push({ role: 'user', content: store.postProcessPrompt });
            }
        },
        normalizeBaseUrl: url => url,
        checkUrlSafety() {},
        buildThinkingParams: () => ({}),
        logTaggerPayload() {},
        assertMangaRequestContext() {},
        validateStructuredResult: res => res,
        safeReadJsonResponse: async res => res.json(),
        smartFetch: async (url, options) => {
            const body = JSON.parse(options.body);
            sentRequests.push({ url, options, body });
            const respPayload = {
                choices: [{
                    message: {
                        content: null,
                        tool_calls: [{
                            type: 'function',
                            function: {
                                name: 'generate_draw_spec',
                                arguments: JSON.stringify({
                                    shouldDraw: true,
                                    reason: 'test ok',
                                    segments: [{ anchor: { type: 'sentence', index: 1, text: 'scene' }, scene: '1room', characters: [] }]
                                })
                            }
                        }]
                    }
                }]
            };
            const respText = JSON.stringify(respPayload);
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => respPayload,
                text: async () => respText,
            };
        },
        callApiWithJsonFallback: async (url, options, reqBody) => {
            const body = reqBody || JSON.parse(options.body);
            sentRequests.push({ url, options, body });
            const respPayload = {
                choices: [{
                    message: {
                        content: body.tools ? null : JSON.stringify({
                            shouldDraw: true,
                            reason: 'test ok',
                            segments: [{ anchor: { type: 'sentence', index: 1, text: 'scene' }, scene: '1room', characters: [] }]
                        }),
                        tool_calls: body.tools ? [{
                            type: 'function',
                            function: {
                                name: 'generate_draw_spec',
                                arguments: JSON.stringify({
                                    shouldDraw: true,
                                    reason: 'test ok',
                                    segments: [{ anchor: { type: 'sentence', index: 1, text: 'scene' }, scene: '1room', characters: [] }]
                                })
                            }
                        }] : undefined
                    }
                }]
            };
            const respText = JSON.stringify(respPayload);
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => respPayload,
                text: async () => respText,
            };
        },
        buildRequestPayload: () => ({
            payload: {
                currentMessage: '艾达在办公室里看文件，贝丝走进来打招呼。',
                characterCardInfo: 'Ada: long black hair, office lady.',
            },
            rawLorebooks: [],
            requestContext: { manga: false },
            promptBundle: null,
        }),
        getSystemPromptWithPresets: () => '【系统提示】：你是一个视觉分镜分析助手，请提取出画面标签与角色服装。',
        getEnhancedContextSystemPrompt: () => '',
        getRequestEnhancedContext: () => '',
        collectCharacterCardInfo: () => 'Ada: long black hair, office lady.',
        captureMangaRequestContext: () => ({ references: [] }),
        isMangaRequest: () => false,
        isMangaContextPreset: () => false,
        toastr: { warning() {}, error() {}, success() {}, info() {} },
        closeManualDrawDialog() {},
        generateSdtImage: async () => {},
        PLUGIN_NAME: '智能生图触发器 (Smart Draw Trigger)',
        DRAW_SPEC_TOOL_INPUT_MESSAGE,
        DRAW_SPEC_TOOL_REORGANIZED_SYSTEM_PROMPT,
    });

    return { sdt, settings, store: settings._smartDrawTrigger, sentRequests, RBQ, sdtSource };
}

(async () => {
    console.log('--- Running SDT Full Context Tool & Message Reorganization Tests ---');

    // 1. Auto Floor Analysis with full context tool description
    await asyncTest('auto floor entry reorganizes messages to 2 clean turns and migrates rules into tool description', async () => {
        const { sdt, sentRequests } = createHost({
            toolCallMode: true,
            toolInputInDescription: true,
            geminiJailbreak: true,
            geminiJailbreakPreset: 'render_pipeline_v2',
        });

        await sdt.callOpenAiCompatible(1, { type: 'auto' });
        assert.equal(sentRequests.length, 1);
        const req = sentRequests[0].body;

        // Message Reorganization: exactly 2 fixed turns
        assert.equal(JSON.stringify(req.messages.map(m => m.role)), JSON.stringify(['system', 'user']));
        assert.equal(req.messages[0].content, sdt.DRAW_SPEC_TOOL_REORGANIZED_SYSTEM_PROMPT);
        assert.equal(req.messages[1].content, sdt.DRAW_SPEC_TOOL_INPUT_MESSAGE);

        // Stripped from messages
        assert.doesNotMatch(req.messages[0].content, /艾达在办公室/);
        assert.doesNotMatch(req.messages[1].content, /艾达在办公室/);
        assert.doesNotMatch(req.messages[0].content, /RENDER_TELEMETRY/);

        // Tool description migration: contains rules & payload
        assert.ok(req.tools && req.tools.length === 1);
        const tool = req.tools[0];
        assert.equal(tool.function.name, 'generate_draw_spec');
        assert.match(tool.function.description, /【VISUAL_ANALYSIS_GUIDELINES｜分镜视觉分析与提取规范】/);
        assert.match(tool.function.description, /【系统提示】：你是一个视觉分镜分析助手/);
        assert.match(tool.function.description, /\[Task Input JSON\]/);
        assert.match(tool.function.description, /艾达在办公室里看文件/);
    });

    // 2. Manual Draw Entry
    await asyncTest('manual draw entry reorganizes messages to 2 clean turns and migrates rules into tool description', async () => {
        const { sdt, sentRequests } = createHost({
            toolCallMode: true,
            toolInputInDescription: true,
            geminiJailbreak: true,
            geminiJailbreakPreset: 'render_pipeline_v2',
        });

        sdt.document = {
            getElementById: id => {
                if (id === 'rbq-sdt-manual-input') return { value: '手动输入场景：泳池边的少女' };
                if (id === 'rbq-sdt-manual-use-context') return { checked: false };
                if (id === 'rbq-sdt-manual-status') return {};
                if (id === 'rbq-sdt-manual-submit') return {};
                return null;
            }
        };
        sdt.localStorage = { setItem() {} };

        await sdt.submitManualDraw();
        assert.equal(sentRequests.length, 1);
        const req = sentRequests[0].body;

        assert.equal(JSON.stringify(req.messages.map(m => m.role)), JSON.stringify(['system', 'user']));
        assert.equal(req.messages[0].content, sdt.DRAW_SPEC_TOOL_REORGANIZED_SYSTEM_PROMPT);
        assert.equal(req.messages[1].content, sdt.DRAW_SPEC_TOOL_INPUT_MESSAGE);

        assert.match(req.tools[0].function.description, /【VISUAL_ANALYSIS_GUIDELINES｜分镜视觉分析与提取规范】/);
        assert.match(req.tools[0].function.description, /\[Task Input JSON\]/);
        assert.match(req.tools[0].function.description, /泳池边的少女/);
    });

    // 3. Test Parser Entry
    await asyncTest('test parser entry reorganizes messages to 2 clean turns and migrates rules into tool description', async () => {
        const { sdt, sentRequests } = createHost({
            toolCallMode: true,
            toolInputInDescription: true,
            geminiJailbreak: true,
            geminiJailbreakPreset: 'render_pipeline',
        });

        await sdt.parseTaggerSegment('测试输入的场景文本：城堡与恶龙');
        assert.equal(sentRequests.length, 1);
        const req = sentRequests[0].body;

        assert.equal(JSON.stringify(req.messages.map(m => m.role)), JSON.stringify(['system', 'user']));
        assert.equal(req.messages[0].content, sdt.DRAW_SPEC_TOOL_REORGANIZED_SYSTEM_PROMPT);
        assert.equal(req.messages[1].content, sdt.DRAW_SPEC_TOOL_INPUT_MESSAGE);

        assert.match(req.tools[0].function.description, /【VISUAL_ANALYSIS_GUIDELINES｜分镜视觉分析与提取规范】/);
        assert.match(req.tools[0].function.description, /\[Task Input JSON\]/);
        assert.match(req.tools[0].function.description, /城堡与恶龙/);
    });

    // 4. Section 6.1: Manga Studio Input Preservation
    test('Section 6.1: Manga Studio (RBQ.api.buildSdtMessages) retains its own input and systemPrompt', () => {
        const { sdt, store, RBQ } = createHost({
            toolCallMode: true,
            toolInputInDescription: true,
            geminiJailbreak: false,
        });

        const studioSystemPrompt = '【Manga Studio Rules】: Generate page storyboard.';
        const studioUserContent = { pageNumber: 1, prompt: 'A silent room with sunlight.' };

        const msgs = RBQ.api.buildSdtMessages(studioSystemPrompt, studioUserContent, store);
        assert.equal(msgs.length, 2);
        assert.equal(msgs[0].role, 'system');
        assert.equal(msgs[0].content, studioSystemPrompt);
        assert.equal(msgs[1].role, 'user');
        assert.match(msgs[1].content, /A silent room with sunlight/);
    });

    // 5. Section 6.2: Tool Call Disabled Fallback (Zero Data Loss)
    await asyncTest('Section 6.2: when toolCallMode is false, falls back to standard JSON messages without losing data', async () => {
        const { sdt, sentRequests } = createHost({
            toolCallMode: false,
            toolInputInDescription: true, // child switch is on, but master toolCallMode is OFF
            geminiJailbreak: false,
        });

        await sdt.callOpenAiCompatible(1, { type: 'auto' });
        assert.equal(sentRequests.length, 1);
        const req = sentRequests[0].body;

        // No tools attached
        assert.equal(req.tools, undefined);
        assert.equal(req.response_format?.type, 'json_object');

        // Rules and payload remain fully in messages
        assert.equal(req.messages.length, 2);
        assert.equal(req.messages[0].role, 'system');
        assert.match(req.messages[0].content, /【系统提示】：你是一个视觉分镜分析助手/);
        assert.equal(req.messages[1].role, 'user');
        assert.match(req.messages[1].content, /艾达在办公室里看文件/);
    });

    // 6. Universal across presets (e.g. render_pipeline_v2 or default)
    await asyncTest('message reorganization works cleanly with render_pipeline_v2 preset', async () => {
        const { sdt, sentRequests } = createHost({
            toolCallMode: true,
            toolInputInDescription: true,
            geminiJailbreak: true,
            geminiJailbreakPreset: 'render_pipeline_v2',
            postProcessEnabled: true,
            postProcessPrompt: 'APPENDED_POST_PROCESS_PROMPT',
        });

        await sdt.callOpenAiCompatible(1, { type: 'auto' });
        const req = sentRequests[0].body;

        assert.equal(JSON.stringify(req.messages.map(m => m.role)), JSON.stringify(['system', 'user']));
        assert.doesNotMatch(req.messages[1].content, /APPENDED_POST_PROCESS_PROMPT/);
    });

    // 7. No Linux terminology in prompt constants or tool descriptions
    test('No private Linux preset terminology exposed', () => {
        const { sdt, sdtSource } = createHost();
        assert.doesNotMatch(sdt.DRAW_SPEC_TOOL_REORGANIZED_SYSTEM_PROMPT, /linux/i);
        assert.doesNotMatch(sdt.DRAW_SPEC_TOOL_INPUT_MESSAGE, /linux/i);
        assert.doesNotMatch(sdtSource, /geminiJailbreakPreset\s*===\s*['"]linux/i);
    });

    console.log(`\nAll ${passed} full context tool description & message reorganization tests passed!`);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
