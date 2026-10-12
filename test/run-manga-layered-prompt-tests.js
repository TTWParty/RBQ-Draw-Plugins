/** Opt-in layered manga prompts exercise real builders and request entry points.
 * Neutral office scenes only. No network, live model or image generation. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const ID = 'v_manga_layered_v1';
const moduleIds = ['manga_contract_v1', 'manga_story_v1', 'v23_manga_v1'];
const clone = value => JSON.parse(JSON.stringify(value));
const story = '艾达把文件交给贝丝，说：“资料已收到。”贝丝回答：“请放到桌上。”随后两人走到会议室门口。';
const styleA = { id: 'style-a', name: 'STYLE_A_NAME', positive: 'STYLE_A_LITERAL watercolor, soft edges', negative: 'STYLE_A_NEGATIVE harsh strokes' };
const styleB = { id: 'style-b', name: 'STYLE_B_NAME', positive: 'STYLE_B_LITERAL woodcut, crosshatching', negative: 'STYLE_B_NEGATIVE pastel' };
const TOOL_INPUT_MARKER = '\n\n[Task Input JSON]\n';
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function host(mode = 'structured', ec = ID) {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,sdtSource,mangaSource};')(require, __dirname);
    const { manga, sdt, settings, RBQ, sdtSource } = env;
    settings._mangaMode = { enabled: true, style: 'soft_color', grammar: 'cinema', gutter: 'bleed', language: 'zh-hans',
        dialogueMode: mode, autoSpread: true, antiHijack: true,
        studio: { ratio: '1216x832', panels: [], panelCountMode: 'auto', useChatChars: false } };
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: ec, multiCharOutput: true,
        characterMemoryEnabled: false, characterProfiles: {}, injectCharacterCard: false, provider: 'openai',
        openaiBaseUrl: 'https://fixture.invalid/v1', openaiModel: 'fixture', customUrl: 'https://fixture.invalid/tagger',
        squashMessages: false, injectPresetsToTagger: true, toolCallMode: false };
    settings._promptPresets = { activeId: styleA.id, presets: [clone(styleA), clone(styleB)] };
    settings.naiWidth = 1024; settings.naiHeight = 1536;
    sdt.getMessageSnapshot = () => ({ mes: story, name: 'Narrator' });
    RBQ.api.getRecentMessages = () => [];
    const load = (start, end) => {
        const a = sdtSource.indexOf(start), b = sdtSource.indexOf(end, a);
        assert.ok(a >= 0 && b > a, 'load real production request function: ' + start);
        vm.runInContext(sdtSource.slice(a, b), sdt);
    };
    load('    function getDrawSpecTool(', '    function buildStandardDrawRequest(');
    load('    function getReorganizedSystemPrompt(', '    function buildThinkingParams(');
    load('    async function callOpenAiCompatible(', '    async function callCustomHttp(');
    load('    async function callCustomHttp(', '    async function callStructuredCompletion(');
    load('    async function callStructuredCompletion(', '    async function callTagger(');
    load('    function collectMangaReferenceData(', '    async function importCharacterFromCurrentCard(');
    load('    async function parseTaggerSegment(', '    RBQ.api.parseWithTagger =');
    load('    async function submitManualDraw(', '    /* ── 🗂️ 剧情漫画时间轴');
    load('    async function runSegmentAiRefinement(', '    function setCardLoadingState(');
    Object.assign(sdt, { normalizeBaseUrl: value => value, checkUrlSafety() {}, logTaggerPayload() {},
        validateStructuredResult: value => value, safeReadJsonResponse: async response => response.json(),
        getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {}, buildThinkingParams: () => ({}),
        DRAW_SPEC_TOOL_RULE: 'Submit final results via generate_draw_spec' });
    let calls = 0, saves = 0, images = 0;
    RBQ.api.saveSettings = () => { saves++; };
    sdt.save = () => { saves++; };
    RBQ.api.generateImage = async () => { images++; throw new Error('layered prompt tests must not generate images'); };
    return { ...env, protocol: RBQ.api.mangaProtocol, load, call() { calls++; }, calls: () => calls,
        saves: () => saves, images: () => images };
}
function pages(mode = 'structured') {
    const person = (id, message, action) => ({ character_id: id, name: id === 'C1' ? 'Ada (original)' : 'Beth (original)',
        base: id === 'C1' ? 'girl, adult, long black hair' : 'girl, adult, short blonde hair',
        outfit: id === 'C1' ? 'white shirt, dark trousers' : 'blue jacket, black skirt',
        positive: action + (mode === 'legacy' && message ? ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: ' + message : ''),
        negative: '', ...(mode === 'structured' ? { bubbles: message ? [{ type: 'speech', position: 'right-upper', layout: 'vertical', speaker_id: id, text: message }] : [] } : {}) });
    return [
        { format: 'nai5-comic', label: '递交资料', intent: 'LAYER_REASON_ONLY: 完成递交和问答。', anchor: { text: '艾达把文件交给贝丝，说：“资料已收到。”' },
            page: { base: 'comic, 2girls, 1 panel, full-page panel, office, window light', ...(mode === 'structured' ? { bubbles: [] } : {}) },
            panels: [{ id: 'P1', description: 'full-page panel, medium shot, office, desk', ...(mode === 'structured' ? { bubbles: [] } : {}),
                characters: [person('C1', '资料已收到。', 'full-page panel, standing, right hand holding document, facing another'),
                    person('C2', '请放到桌上。', 'full-page panel, sitting, facing another')] }] },
        { format: 'nai5-comic', label: '会议室转场', intent: 'LAYER_REASON_ONLY: 交代走到门口。', anchor: { text: '随后两人走到会议室门口。' },
            page: { base: 'comic, 2girls, 1 panel, full-page panel, hallway, meeting room door', ...(mode === 'structured' ? { bubbles: [] } : {}) },
            panels: [{ id: 'P1', description: 'full-page panel, wide shot, hallway', ...(mode === 'structured' ? { bubbles: [] } : {}),
                characters: [person('C1', '', 'full-page panel, walking, facing door'), person('C2', '', 'full-page panel, walking, holding document')] }] }
    ];
}
const systemText = body => body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
function assertLayers(instruction) {
    assert.equal(typeof instruction, 'string');
    for (const id of moduleIds) assert.equal(instruction.split(id).length - 1, 1, id + ' should occur in exactly one module header');
    assert.doesNotMatch(instruction, /STYLE_[AB]_(?:NAME|LITERAL|NEGATIVE)/, 'style preset literals remain user data');
}
function assertTrace(trace, task, responseKind, transport) {
    assert.equal(trace.presetId, ID); assert.equal(trace.assemblyVersion, 1);
    assert.deepEqual(clone(trace.modules), moduleIds.map((id, index) => ({ id, role: ['contract', 'planner', 'panel'][index] })));
    assert.equal(trace.task, task); assert.equal(trace.responseKind, responseKind);
    if (transport) assert.equal(trace.transport, transport);
    assert.equal(trace.planningMode, task.startsWith('refine_') ? 'preserve' : 'adapt');
}
function toolDescriptionInput(body) {
    const description = body.tools?.find(tool => tool.function?.name === 'generate_draw_spec')?.function.description || '';
    const index = description.indexOf(TOOL_INPUT_MARKER);
    return index < 0 ? null : JSON.parse(description.slice(index + TOOL_INPUT_MARKER.length));
}
function toolDescriptionInstruction(body) {
    const desc = body.tools?.find(tool => tool.function?.name === 'generate_draw_spec')?.function.description || '';
    const marker = '【VISUAL_ANALYSIS_GUIDELINES｜分镜视觉分析与提取规范】\n';
    const index = desc.indexOf(marker);
    if (index < 0) return null;
    const end = desc.indexOf('\n\n本次任务输入见下方 JSON');
    return end > index ? desc.slice(index + marker.length, end).trim() : desc.slice(index + marker.length).trim();
}
function requestParts(body, provider) {
    const request = provider === 'custom' && !body.messages ? body
        : toolDescriptionInput(body) || JSON.parse(body.messages.find(message => message.role === 'user').content);
    return { request, instruction: provider === 'custom' && !body.messages ? body.mangaInstruction : (toolDescriptionInstruction(body) || systemText(body)) };
}
let descriptionInputUserInstruction;
function assertTaskInputRoute(body, expected, enabled) {
    const described = toolDescriptionInput(body);
    if (enabled) {
        assert.deepEqual(described, clone(expected), 'the entire assembled payload is preserved in tool description');
        const users = body.messages.filter(message => message.role === 'user');
        assert.equal(users.length, 1);
        assert.ok(!users[0].content.includes(expected.currentMessage.content), 'story is not duplicated in the user message');
        assert.ok(!users[0].content.includes('"currentMessage"'), 'user message no longer serializes the payload');
        if (descriptionInputUserInstruction === undefined) descriptionInputUserInstruction = users[0].content;
        assert.equal(users[0].content, descriptionInputUserInstruction, 'all entry points use the same fixed reading instruction');
    } else {
        assert.equal(described, null);
        assert.deepEqual(JSON.parse(body.messages.find(message => message.role === 'user').content), clone(expected));
    }
}
function assertStyleData(request) {
    assert.deepEqual(clone(request.stylePreset), { name: styleA.name, positive: styleA.positive, negative: styleA.negative });
}
function installReply(h, channel, data, inspect = () => {}) {
    const receive = body => {
        h.call(); inspect(body);
        const reply = channel === 'custom' ? clone(data) : channel === 'tool'
            ? { choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(data) } }] } }] }
            : { choices: [{ message: { content: JSON.stringify(data) } }] };
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => reply,
            text: async () => JSON.stringify(reply) };
    };
    h.sdt.smartFetch = async (_url, options) => receive(JSON.parse(options.body));
    h.sdt.callApiWithJsonFallback = async (_url, _options, body) => receive(body);
}
function assertDrawTransport(body, provider, toolMode) {
    if (provider === 'custom') {
        assert.equal(body.tools, undefined, 'custom HTTP keeps its payload protocol');
        assert.equal(body.messages, undefined);
        assert.equal(body.response_format, undefined);
    } else if (toolMode) {
        assert.equal(body.tools.length, 1);
        assert.equal(body.tools[0].function.name, 'generate_draw_spec');
        assert.deepEqual(clone(body.tool_choice), { type: 'function', function: { name: 'generate_draw_spec' } });
        assert.equal(body.stream, true);
        assert.equal(body.response_format, undefined, 'tool requests cannot silently use JSON response mode');
    } else {
        assert.equal(body.tools, undefined);
        assert.equal(body.tool_choice, undefined);
        assert.equal(body.response_format.type, 'json_object');
        assert.equal(body.stream, false, 'disabled Tool Call preserves the previous non-streaming JSON request');
    }
}
function bundleInput(h, task = 'adapt_message', responseKind = 'story', transport = 'json') {
    return { presetDescriptor: h.protocol.resolvePromptPreset(ID), task, settingsSnapshot: clone(h.settings._mangaMode),
        canvas: { width: 1024, height: 1536, orientation: 'portrait', autoSpread: true },
        referenceOptions: { stylePresetEnabled: true, characterMemoryEnabled: false, injectCharacterCard: false },
        responseKind, transport, limits: { maxPanels: 5, ...(task === 'test_page' ? { maxPages: 1 } : {}) } };
}
function scopeError(data) {
    return error => {
        assert.equal(error.code, 'MANGA_TASK_SCOPE');
        if (data) assert.deepEqual(JSON.parse(error.rawOutput), data, 'task errors preserve every returned page instead of truncating it');
        return true;
    };
}
function fixedStudioPage(count) {
    const original = pages()[0];
    const result = { page: { ...original.page, base: `comic, 2girls, ${count} panels, equal grid, office` },
        panels: Array.from({ length: count }, (_, index) => ({ ...clone(original.panels[0]), id: `P${index + 1}`,
            title: '递交资料', desc: '已有动作的一次停顿', position: `tier ${index + 1} panel`, shot: 'medium shot' })) };
    for (const panel of result.panels.slice(1)) for (const person of panel.characters) person.bubbles = [];
    return result;
}

(async () => {
    await test('the opt-in descriptor exposes three modules while historical and unknown presets retain legacy assembly', () => {
        const h = host(), descriptor = h.protocol.resolvePromptPreset(ID);
        assert.equal(descriptor.id, ID); assert.equal(descriptor.layered, true); assert.equal(descriptor.assemblyVersion, 1);
        assert.deepEqual([descriptor.contractModule, descriptor.plannerModule, descriptor.panelModule], moduleIds);
        for (const ec of ['v_manga', 'v_manga_185', 'v_manga_161', 'v_manga_150', 'v_manga_narrative', 'v_manga_v5', 'unknown']) {
            const legacy = h.protocol.resolvePromptPreset(ec);
            assert.equal(legacy.layered, false); assert.equal(legacy.assemblyVersion, 0);
        }
    });
    await test('historical planner byte hashes remain untouched by the new descriptor and assembly', () => {
        const h = host(), hashes = { v_manga: '3d676af809e60b659e7c633ca75b069648f5cee5e8d6c61dee0d0d40e9bfbc1a',
            v_manga_185: '05a427db20bdfdc78845b54a86b562e5d0e8419030d287884e673915464922dc',
            v_manga_161: '02ec9fc92e816204fb728aef9ea1fe422874a089f7aa5a741ab7d99d097bca4e',
            v_manga_150: '8e2609aa177f144b0a4bdfbad3b7b5d9ff2ea2f74ef75410c6cc10271ec09726' };
        for (const [ec, hash] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(h.protocol.planningPrompt(ec)).digest('hex'), hash);
    });
    await test('legacy main request bytes remain identical to the pre-change committed source for both dialogue modes and three transports', async () => {
        // Evaluated from source at eb728d6 in this same neutral host, then compared
        // with the working tree. These do not freeze any new layered prompt text.
        const baseline = { 'structured/custom': '1583dec40f41dabe5b6d9eacf96c0eec1afb1d5bc6d2d5d219f9d9a7001e66c5',
            'structured/json': '8ee301963706c7fedebe8d10b48d00debfa83703c8ade3f3874c4e8d71caeb2e',
            'structured/tool': '9e5cbe3c0f572855e5bf5a42addfe764f38b4eb6480cf1a48004d7a313bf67b4',
            'legacy/custom': '6c7f61adc569944a2d9d74a011ac2d6dc5853e4c772decf777e05eef2e0e30ec',
            'legacy/json': '1a243c97197e8bf3533c20564dfdc23f2ce87f139ab865320a416a7a1f1cc5d3',
            'legacy/tool': 'aabc2feb34c5f57ed7c1aae53a0dfb71aa2a1906a00bd097409d37228d86f16c' };
        for (const mode of ['structured', 'legacy']) for (const channel of ['custom', 'json', 'tool']) {
            const h = host(mode, 'v_manga'); Object.assign(h.settings._smartDrawTrigger, { provider: channel === 'custom' ? 'custom' : 'openai', toolCallMode: channel === 'tool' });
            let emitted;
            installReply(h, channel, { shouldDraw: true, reason: '完整呈现问答与转场。', segments: pages(mode) }, body => { emitted = JSON.stringify(body); });
            if (channel === 'custom') await h.sdt.callCustomHttp(1, { type: 'auto' }); else await h.sdt.callOpenAiCompatible(1, { type: 'auto' });
            assert.equal(crypto.createHash('sha256').update(emitted).digest('hex'), baseline[mode + '/' + channel]);
            assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
        }
    });
    for (const mode of ['structured', 'legacy']) {
        await test(`${mode} bundle is pure with a supplied snapshot and its output example executes the production compiler`, () => {
            const h = host(mode), input = bundleInput(h), before = clone(input), bundle = h.protocol.buildPromptBundle(input);
            assertLayers(bundle.instructionText); assertTrace(bundle.trace, 'adapt_message', 'story', 'json');
            assert.deepEqual(clone(input), before);
            assert.equal(bundle.schema.properties.segments.items.properties.format.enum[0], 'nai5-comic');
            const schema = bundle.schema.properties.segments.items.properties.panels.items;
            assert.equal(!!schema.properties.bubbles, mode === 'structured');
            assert.equal(!!schema.properties.characters.items.properties.bubbles, mode === 'structured');
            assert.ok(Array.isArray(bundle.outputExample.segments));
            for (const page of h.protocol.recoverResponseText(clone(bundle.outputExample.segments))) assert.doesNotThrow(() => h.manga.compileMangaPage(page));
            const getSettings = h.RBQ.api.getSettings;
            h.RBQ.api.getSettings = () => { throw new Error('pure prompt builder must not read global settings'); };
            try { assert.deepEqual(clone(h.protocol.buildPromptBundle(input)), clone(bundle)); }
            finally { h.RBQ.api.getSettings = getSettings; }
        });
    }
    await test('all task kinds expose adapt or preserve planning and matching schemas without extra planning outputs', () => {
        const h = host();
        for (const [task, kind] of [['adapt_message', 'story'], ['adapt_manual', 'story'], ['test_page', 'story'],
            ['refine_page', 'page'], ['studio_page', 'studio-page'], ['refine_panel', 'studio-page'], ['refine_panels', 'studio-page']]) {
            const input = bundleInput(h, task, kind), bundle = h.protocol.buildPromptBundle(input);
            assertLayers(bundle.instructionText); assertTrace(bundle.trace, task, kind);
            assert.ok(!JSON.stringify(bundle.schema).includes('story_plan'));
            if (kind === 'story') assert.ok(bundle.schema.properties.segments);
            else { assert.ok(bundle.schema.properties.page); assert.ok(bundle.schema.properties.panels); assert.equal(bundle.schema.properties.segments, undefined); }
            if (kind === 'studio-page') { assert.ok(bundle.schema.properties.capacity_note); assert.equal(bundle.schema.properties.anchor, undefined); }
            else if (kind === 'page') assert.equal(bundle.schema.properties.format.enum[0], 'nai5-comic');
        }
    });
    await test('explicit canvas and limits drive page budgets and fixed four-panel bounds without reading live dimensions', () => {
        const h = host(), input = bundleInput(h, 'studio_page', 'studio-page');
        input.canvas = { width: 1216, height: 832, orientation: 'landscape', autoSpread: false };
        input.settingsSnapshot.grammar = '4koma'; input.limits = { panelCount: 4, maxPanels: 5, maxPages: 1 };
        const bundle = h.protocol.buildPromptBundle(input);
        assert.match(bundle.instructionText, /1216/); assert.match(bundle.instructionText, /832/);
        assert.equal(bundle.schema.properties.panels.minItems, 4); assert.equal(bundle.schema.properties.panels.maxItems, 4);
        const before = clone(bundle);
        h.settings.naiWidth = 2048; h.settings.naiHeight = 2048; h.settings._mangaMode.grammar = 'mystery';
        assert.deepEqual(clone(h.protocol.buildPromptBundle(input)), before);
    });
    await test('task validation rejects wrong page counts, fixed panel counts and mixed one-page wrappers without mutation', () => {
        const h = host();
        const single = h.protocol.buildPromptBundle(bundleInput(h, 'test_page'));
        const extraPages = { shouldDraw: true, reason: '误返回两页', segments: pages() }, before = clone(extraPages);
        assert.throws(() => h.protocol.validatePromptResult(extraPages, single.trace), scopeError(before));
        assert.deepEqual(extraPages, before);
        const fourInput = bundleInput(h, 'studio_page', 'studio-page'); fourInput.limits.panelCount = 4;
        const four = h.protocol.buildPromptBundle(fourInput), short = fixedStudioPage(3);
        assert.throws(() => h.protocol.validatePromptResult(short, four.trace), scopeError(short));
        const pageBundle = h.protocol.buildPromptBundle(bundleInput(h, 'refine_page', 'page'));
        const mixedPage = { ...pages()[0], segments: pages() };
        assert.throws(() => h.protocol.validatePromptResult(mixedPage, pageBundle.trace), scopeError(mixedPage));
        const studioBundle = h.protocol.buildPromptBundle(bundleInput(h, 'studio_page', 'studio-page'));
        const mixedStudio = { ...fixedStudioPage(1), segments: pages() };
        assert.throws(() => h.protocol.validatePromptResult(mixedStudio, studioBundle.trace), scopeError(mixedStudio));
        const missingLayout = fixedStudioPage(1); delete missingLayout.page;
        assert.throws(() => h.protocol.validatePromptResult(missingLayout, studioBundle.trace), scopeError(missingLayout));
        const emptyPage = { shouldDraw: true, reason: '没有返回页面。', segments: [] };
        assert.throws(() => h.protocol.validatePromptResult(emptyPage, single.trace), scopeError(emptyPage));
        const fourConflict = bundleInput(h, 'studio_page', 'studio-page');
        fourConflict.settingsSnapshot.grammar = '4koma'; fourConflict.limits.panelCount = 3;
        assert.throws(() => h.protocol.buildPromptBundle(fourConflict), /4格/);
    });
    await test('the three-layer complete neutral example remains owned and compilable in both drawing color modes', () => {
        for (const style of ['soft_color', 'monochrome']) {
            const h = host(), input = bundleInput(h); input.settingsSnapshot.style = style;
            const bundle = h.protocol.buildPromptBundle(input), exampleText = h.manga.mangaStructuredDialogueExample(input.settingsSnapshot);
            assert.ok(bundle.instructionText.includes(exampleText));
            const example = { format: 'nai5-comic', ...JSON.parse(exampleText) };
            assert.doesNotThrow(() => h.protocol.validateResponseBubbles([example]));
            const rendered = h.protocol.resolveAppearances(h.protocol.recoverResponseText([example]), [], [], [], input.settingsSnapshot)[0];
            const compiled = h.manga.compileMangaPage(rendered);
            assert.equal(h.manga.splitMangaText(compiled.base, false).text, '');
            assert.ok(compiled.characters.every(character => h.manga.splitMangaText(character.caption, false).text));
            if (style === 'monochrome') assert.doesNotMatch(compiled.characters[1].caption, /blonde hair|blue jacket/);
        }
    });
    await test('switching literal style presets changes only user style data for the layered SDT request', () => {
        const h = host();
        const first = clone(h.sdt.buildRequestPayload(1, { type: 'auto' }).payload), system = h.sdt.getSystemPromptWithPresets(h.settings._smartDrawTrigger);
        assertLayers(system); assertStyleData(first);
        h.settings._promptPresets.activeId = styleB.id;
        const second = clone(h.sdt.buildRequestPayload(1, { type: 'auto' }).payload);
        assert.equal(h.sdt.getSystemPromptWithPresets(h.settings._smartDrawTrigger), system);
        assert.equal(second.stylePreset.positive, styleB.positive);
        delete first.stylePreset; delete second.stylePreset;
        assert.deepEqual(second, first);
    });
    for (const mode of ['structured', 'legacy']) for (const channel of ['custom', 'json', 'tool']) {
        await test(`${channel} main SDT sends ${mode} layers once and compiles every page through the final NAI hooks`, async () => {
            const h = host(mode), provider = channel === 'custom' ? 'custom' : 'openai';
            let builds = 0; const originalBuild = h.protocol.buildPromptBundle;
            h.protocol.buildPromptBundle = options => { builds++; return originalBuild(options); };
            Object.assign(h.settings._smartDrawTrigger, { provider, toolCallMode: channel === 'tool' || provider === 'custom',
                toolInputInDescription: provider === 'custom' });
            installReply(h, channel, { shouldDraw: true, reason: '完整呈现问答与转场。', segments: pages(mode) }, body => {
                const { request, instruction } = requestParts(body, provider);
                assertLayers(instruction); assertStyleData(request);
                assertTrace(request.mangaPromptTrace, 'adapt_message', 'story', channel === 'tool' ? 'tool' : 'json');
                assert.ok(request.outputSchema.properties.segments, 'the actual request sends the bundle JSON schema');
                assert.ok(request.outputExample.segments, 'the human-readable output example stays a separate field');
                assert.deepEqual(clone(request.mangaCanvas), { width: 1024, height: 1536, orientation: 'portrait', autoSpread: true });
                assert.equal(request.currentMessage.content, story); assert.equal(request.minSegments, undefined);
                if (channel === 'tool') assert.equal(!!body.tools[0].function.parameters.properties.segments.items.properties.panels.items.properties.bubbles, mode === 'structured');
            });
            const result = channel === 'custom' ? await h.sdt.callCustomHttp(1, { type: 'auto' }) : await h.sdt.callOpenAiCompatible(1, { type: 'auto' });
            assert.equal(h.calls(), 1); assert.equal(builds, 1, 'all main transport fields share one bundle');
            assert.equal(result.segments.length, 2); assert.equal(h.images(), 0);
            assertTrace(result.mangaPromptTrace, 'adapt_message', 'story', channel === 'tool' ? 'tool' : 'json');
            for (const [index, segment] of result.segments.entries()) {
                h.sdt.prepareNaiCharData(segment);
                const sent = h.mangaHook(h.sdtHook(h.payload(h.sdt.getFinalPrompt(segment))));
                assert.doesNotMatch(sent.input, /资料已收到|请放到桌上/);
                assert.doesNotMatch(JSON.stringify(sent), /LAYER_REASON_ONLY|manga_contract_v1|manga_story_v1|v23_manga_v1|speaker_id|mangaPromptTrace/);
                if (!index) assert.match(sent.parameters.v4_prompt.caption.char_captions[1].char_caption, /Text: 请放到桌上。$/);
                else assert.ok(sent.parameters.v4_prompt.caption.char_captions.every(character => !character.char_caption.includes('Text:')));
            }
        });
    }
    for (const route of [
        { name: 'default JSON', toolMode: false },
        { name: 'JSON with inactive description input', toolMode: false, descriptionInput: true },
        { name: 'tool with user input', toolMode: true, descriptionInput: false },
        { name: 'tool with description input', toolMode: true, descriptionInput: true }
    ]) for (const entry of ['auto', 'manual', 'test']) {
        await test(`ordinary illustration ${entry} uses ${route.name}`, async () => {
            const { toolMode, descriptionInput } = route;
            const h = host('structured', 'off'), description = '会议室里有一张木桌，窗边放着绿植。\n标牌写着“Room A\\B”。';
            Object.assign(h.settings._smartDrawTrigger, { _mangaActive: false, enhancedContext: 'off',
                toolCallMode: toolMode, injectPresetsToTagger: false });
            if (descriptionInput !== undefined) h.settings._smartDrawTrigger.toolInputInDescription = descriptionInput;
            h.settings._mangaMode.enabled = false;
            h.sdt.getMessageSnapshot = () => ({ mes: description, name: 'Narrator' });
            let assembledPayload;
            h.sdt.logTaggerPayload = (label, value) => { if (label.includes('request')) assembledPayload = clone(value); };
            const submitted = [], data = { shouldDraw: true, reason: '会议室环境。',
                segments: [{ anchor: { text: description }, scene: 'meeting room, wooden table, window, potted plant', characters: [] }] };
            if (entry === 'manual') {
                const fields = { 'rbq-sdt-manual-input': { value: description }, 'rbq-sdt-manual-status': {},
                    'rbq-sdt-manual-submit': {}, 'rbq-sdt-manual-use-context': { checked: false } };
                Object.assign(h.sdt, { document: { getElementById: id => fields[id] }, localStorage: { setItem() {} },
                    toastr: { warning(message) { throw new Error(message); }, error(message) { throw new Error(message); }, success() {} },
                    PLUGIN_NAME: 'test', closeManualDrawDialog() {}, generateSdtImage: async segment => submitted.push(segment) });
            }
            installReply(h, toolMode ? 'tool' : 'json', data, body => {
                assertDrawTransport(body, 'openai', toolMode);
                const { request, instruction } = requestParts(body, 'openai');
                assertTaskInputRoute(body, assembledPayload, !!(toolMode && descriptionInput));
                assert.equal(request.currentMessage.content, description);
                assert.equal(request.mangaPromptTrace, undefined);
                if (toolMode) {
                    assert.match(instruction, /Submit final results via generate_draw_spec/);
                    assert.ok(body.tools[0].function.parameters.properties.segments.items.properties.scene);
                    assert.equal(body.tools[0].function.parameters.properties.segments.items.properties.panels, undefined);
                    const baseline = h.sdt.getDrawSpecTool({ ...h.settings._smartDrawTrigger, toolInputInDescription: false });
                    assert.deepEqual(clone(body.tools[0].function.parameters), clone(baseline.function.parameters));
                }
            });
            if (entry === 'manual') {
                await h.sdt.submitManualDraw();
                assert.equal(submitted.length, 1);
                assert.match(submitted[0].scene, /meeting room/);
            } else {
                const result = entry === 'auto' ? await h.sdt.callOpenAiCompatible(1, { type: 'auto' }) : await h.sdt.parseTaggerSegment(description);
                assert.match((entry === 'auto' ? result.segments[0] : result.segment).scene, /meeting room/);
            }
            assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
        });
    }
    await test('description input preserves all payload fields without mutating a shared tool or a later request', () => {
        const h = host('structured', 'off');
        const baseStore = { ...h.settings._smartDrawTrigger, _mangaActive: false, enhancedContext: 'off', toolCallMode: true };
        const baseline = clone(h.sdt.getDrawSpecTool(baseStore));
        const payload = {
            currentMessage: { role: 'assistant', name: 'Narrator', content: '她翻开标记为“资料\\2026”的文件。\n第二行保留。' },
            recentMessages: [{ id: 2, role: 'user', name: 'Reader', content: '请看窗边那张桌子。' }],
            segmentInstruction: '从当前正文选择原文锚点。',
            lorebook: [{ name: 'Office', keys: ['窗边'], tags: 'north-facing window, maple desk' }],
            characterCardInfo: [{ name: 'Ada', description: 'Adult office worker.', characterBookEntries: [] }],
            characterMemory: [{ name: 'Ada', base: 'adult, black hair', outfit: 'white shirt' }],
            characterWardrobes: [{ character: 'Ada', wardrobe: [{ name: 'Office', outfit: 'white shirt', triggers: ['office'] }] }],
            stylePreset: clone(styleA), outputSchema: { shouldDraw: 'boolean', segments: [] },
            optionalTaskData: { zero: 0, disabled: false, empty: '', nested: [null, '引号 " 与斜线 \\'] }
        };
        const before = clone(payload), routedStore = { ...baseStore, toolInputInDescription: true };
        assert.deepEqual(clone(h.sdt.getDrawSpecTool(baseStore, null, payload)), baseline, 'missing setting keeps the old tool');
        const first = h.sdt.getDrawSpecTool(routedStore, null, payload);
        assert.deepEqual(toolDescriptionInput({ tools: [first] }), before);
        assert.deepEqual(clone(first.function.parameters), baseline.function.parameters);
        assert.deepEqual(clone(payload), before, 'serialization leaves the input object untouched');
        first.function.parameters.properties.shouldDraw.description = 'mutated fixture';
        assert.deepEqual(clone(h.sdt.getDrawSpecTool(baseStore)), baseline, 'routed tool has a separate schema object');
        const secondPayload = { currentMessage: { content: '另一次请求只描述一个空文件夹。' } };
        const second = h.sdt.getDrawSpecTool(routedStore, null, secondPayload);
        assert.deepEqual(toolDescriptionInput({ tools: [second] }), secondPayload);
        assert.equal(second.function.description.includes('optionalTaskData'), false, 'previous payload cannot leak into a later tool');
        for (const store of [{ ...routedStore, toolCallMode: false }, { ...routedStore, provider: 'custom' }]) {
            assert.deepEqual(clone(h.sdt.getDrawSpecTool(store, null, payload)), baseline, 'inactive routes never attach task data');
        }
    });
    await test('the standard request builder preserves rules and structured input in their message roles', () => {
        const h = host('structured', 'off');
        const store = { ...h.settings._smartDrawTrigger, _mangaActive: false, enhancedContext: 'off',
            geminiJailbreak: false, postProcessEnabled: false, toolInputInDescription: false, toolCallMode: true };
        const instruction = 'Extract visual details. Keep literal anchors and return the specified fields.';
        const input = { currentMessage: { role: 'assistant', name: 'Narrator', content: '资料 "A\\B"\n放在桌上。' },
            recentMessages: [{ role: 'user', content: '请找会议室的桌子。' }], optionalTaskData: { zero: 0, disabled: false, nested: [null, ''] } };
        const before = clone(input), beforeStore = clone(store);
        const request = h.sdt.buildStandardDrawRequest(instruction, input, store);
        assert.deepEqual(clone(request.messages), [
            { role: 'system', content: instruction }, { role: 'user', content: JSON.stringify(input, null, 2) }
        ]);
        assert.equal(request.tool.function.name, 'generate_draw_spec');
        assert.equal(toolDescriptionInput({ tools: [request.tool] }), null);
        assert.ok(!request.tool.function.description.includes(input.currentMessage.content));
        assert.deepEqual(clone(request.tool.function.parameters), clone(h.sdt.getDrawSpecTool(store).function.parameters));
        assert.deepEqual(clone(input), before); assert.deepEqual(clone(store), beforeStore);
        const jsonRequest = h.sdt.buildStandardDrawRequest(instruction, input, { ...store, toolCallMode: false });
        assert.deepEqual(clone(jsonRequest.messages), clone(request.messages));
        assert.equal(jsonRequest.tool, null, 'JSON output does not attach a function tool');
    });
    await test('the standard request builder returns independent tool schemas for consecutive calls', () => {
        const h = host('structured', 'off');
        const store = { ...h.settings._smartDrawTrigger, _mangaActive: false, enhancedContext: 'off',
            geminiJailbreak: false, postProcessEnabled: false, toolInputInDescription: false, toolCallMode: true };
        const firstPayload = { currentMessage: { content: '第一份会议室资料。' } };
        const secondPayload = { currentMessage: { content: '第二份资料描述大厅。' } };
        const baseline = clone(h.sdt.getDrawSpecTool(store));
        const first = h.sdt.buildStandardDrawRequest('First analysis rules.', firstPayload, store);
        first.tool.function.parameters.properties.shouldDraw.description = 'changed test schema';
        first.tool.function.description = 'changed test description';
        first.messages[0].content = 'changed test rules';
        const second = h.sdt.buildStandardDrawRequest('Second analysis rules.', secondPayload, store);
        assert.deepEqual(clone(second.tool), baseline, 'a previous caller cannot contaminate the next tool');
        assert.deepEqual(clone(h.sdt.getDrawSpecTool(store)), baseline, 'the shared tool definition remains intact');
        assert.equal(second.messages[0].content, 'Second analysis rules.');
        assert.deepEqual(JSON.parse(second.messages[1].content), secondPayload);
        assert.deepEqual(firstPayload, { currentMessage: { content: '第一份会议室资料。' } });
    });
    await test('the standard request builder leaves other configured transports to their existing handlers', () => {
        const h = host('structured', 'off');
        const store = { ...h.settings._smartDrawTrigger, geminiJailbreak: false, postProcessEnabled: false,
            toolInputInDescription: false, toolCallMode: true };
        for (const changed of [{ provider: 'custom' }, { geminiJailbreak: true },
            { postProcessEnabled: true }, { toolInputInDescription: true }]) {
            assert.equal(h.sdt.buildStandardDrawRequest('Analysis rules.', { currentMessage: { content: story } },
                { ...store, ...changed }), null, 'a nonstandard route must retain its existing handler');
        }
    });
    for (const variant of ['illustration', 'legacy manga', 'layered manga']) {
        for (const toolMode of [false, true]) for (const entry of ['auto', 'manual', 'test']) {
            await test(`standard ${variant} ${entry} preserves message roles with Tool Call ${toolMode ? 'on' : 'off'}`, async () => {
                const ec = variant === 'illustration' ? 'off' : variant === 'legacy manga' ? 'v_manga' : ID;
                const h = host('structured', ec), illustration = variant === 'illustration';
                Object.assign(h.settings._smartDrawTrigger, { _mangaActive: !illustration, enhancedContext: ec,
                    toolCallMode: toolMode, geminiJailbreak: false, postProcessEnabled: false,
                    toolInputInDescription: false, injectPresetsToTagger: true });
                h.settings._mangaMode.enabled = !illustration;
                let constructed, builds = 0, assembledPayload;
                const build = h.sdt.buildStandardDrawRequest;
                h.sdt.buildStandardDrawRequest = (...args) => {
                    builds++; constructed = { instruction: args[0], input: clone(args[1]), bundle: args[3] };
                    return build(...args);
                };
                h.sdt.logTaggerPayload = (label, value) => { if (label.includes('request')) assembledPayload = clone(value); };
                const submitted = [];
                if (entry === 'manual') {
                    const fields = { 'rbq-sdt-manual-input': { value: story }, 'rbq-sdt-manual-status': {},
                        'rbq-sdt-manual-submit': {}, 'rbq-sdt-manual-use-context': { checked: false } };
                    Object.assign(h.sdt, { document: { getElementById: id => fields[id] }, localStorage: { setItem() {} },
                        toastr: { warning(message) { throw new Error(message); }, error(message) { throw new Error(message); }, success() {} },
                        PLUGIN_NAME: 'test', closeManualDrawDialog() {}, generateSdtImage: async segment => submitted.push(segment) });
                }
                const data = { shouldDraw: true, reason: '办公室递交资料。', segments: illustration
                    ? [{ anchor: { text: story.slice(0, 24) }, scene: 'office, desk, document', characters: [] }]
                    : entry === 'test' ? [pages()[0]] : pages() };
                installReply(h, toolMode ? 'tool' : 'json', data, body => {
                    assertDrawTransport(body, 'openai', toolMode);
                    assert.deepEqual(clone(body.messages.map(message => message.role)), ['system', 'user']);
                    assert.equal(body.messages[0].content, constructed.instruction, 'analysis instructions stay in the system message');
                    assert.deepEqual(JSON.parse(body.messages[1].content), constructed.input, 'task fields stay in the user JSON');
                    assert.deepEqual(constructed.input, assembledPayload, 'the shared builder receives all collected business fields');
                    assert.equal(constructed.input.currentMessage.content, story);
                    if (variant === 'layered manga') assertLayers(body.messages[0].content);
                    else assert.ok(body.messages[0].content.length > 100, 'the existing analysis protocol is retained');
                    if (toolMode) {
                        const tool = body.tools[0];
                        assert.equal(toolDescriptionInput(body), null);
                        assert.ok(!tool.function.description.includes(story));
                        assert.ok(!tool.function.description.includes('currentMessage'));
                        assert.ok(!tool.function.description.includes(styleA.positive));
                        const segment = tool.function.parameters.properties.segments.items;
                        if (illustration) { assert.ok(segment.properties.scene); assert.equal(segment.properties.panels, undefined); }
                        else { assert.ok(segment.properties.panels); assert.equal(segment.properties.scene, undefined); }
                        if (variant === 'layered manga') assert.deepEqual(clone(tool.function.parameters), constructed.input.outputSchema);
                    }
                });
                if (entry === 'auto') await h.sdt.callOpenAiCompatible(1, { type: 'auto' });
                else if (entry === 'test') await h.sdt.parseTaggerSegment(story);
                else { await h.sdt.submitManualDraw(); assert.equal(submitted.length, data.segments.length); }
                assert.equal(builds, 1, 'each entry point builds one standard request');
                assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
            });
        }
    }
    for (const entry of ['auto', 'manual', 'test']) {
        await test(`layered ${entry} description input preserves the original task, payload and tool schema`, async () => {
            let control;
            for (const descriptionInput of [false, true]) {
                const h = host(), task = { auto: 'adapt_message', manual: 'adapt_manual', test: 'test_page' }[entry];
                Object.assign(h.settings._smartDrawTrigger, { toolCallMode: true, toolInputInDescription: descriptionInput });
                let assembledPayload, sent;
                h.sdt.logTaggerPayload = (label, value) => { if (label.includes('request')) assembledPayload = clone(value); };
                const submitted = [];
                if (entry === 'manual') {
                    const fields = { 'rbq-sdt-manual-input': { value: story }, 'rbq-sdt-manual-status': {},
                        'rbq-sdt-manual-submit': {}, 'rbq-sdt-manual-use-context': { checked: false } };
                    Object.assign(h.sdt, { document: { getElementById: id => fields[id] }, localStorage: { setItem() {} },
                        toastr: { warning(message) { throw new Error(message); }, error(message) { throw new Error(message); }, success() {} },
                        PLUGIN_NAME: 'test', closeManualDrawDialog() {}, generateSdtImage: async segment => submitted.push(segment) });
                }
                installReply(h, 'tool', { shouldDraw: true, reason: '按任务范围呈现办公室剧情。', segments: entry === 'test' ? [pages()[0]] : pages() }, body => {
                    sent = clone(body);
                    assertDrawTransport(body, 'openai', true);
                    assertTaskInputRoute(body, assembledPayload, descriptionInput);
                    const { request, instruction } = requestParts(body, 'openai');
                    assertLayers(instruction); assertStyleData(request);
                    assertTrace(request.mangaPromptTrace, task, 'story', 'tool');
                    assert.deepEqual(clone(body.tools[0].function.parameters), clone(request.outputSchema));
                    if (entry === 'test') assert.equal(request.outputSchema.properties.segments.maxItems, 1);
                });
                if (entry === 'auto') await h.sdt.callOpenAiCompatible(1, { type: 'auto' });
                else if (entry === 'test') await h.sdt.parseTaggerSegment(story);
                else { await h.sdt.submitManualDraw(); assert.equal(submitted.length, 2); }
                if (!descriptionInput) control = sent;
                else {
                    assert.deepEqual(toolDescriptionInput(sent), requestParts(control, 'openai').request);
                    assert.deepEqual(sent.tools[0].function.parameters, control.tools[0].function.parameters);
                    assert.equal(toolDescriptionInstruction(sent), systemText(control), 'full context tool description contains system instructions');
                    assert.deepEqual(sent.messages.map(m => m.role), ['system', 'user']);
                    assert.equal(sent.messages[0].content, h.RBQ?.api?.DRAW_SPEC_TOOL_REORGANIZED_SYSTEM_PROMPT || '【结构化工具调用引导】\n你是一个专业视觉分镜分析与提取管道。请直接调用 generate_draw_spec 工具：先完整阅读工具说明（description）中声明的分镜视觉分析规范（VISUAL_ANALYSIS_GUIDELINES）与本次任务输入数据包（Task Input JSON），遵照规范提取角色、服装、动作及场景分镜，并通过工具 parameters 结构化提交结果。严禁在工具调用外输出任何自然语言解释、道歉、拒答或多余文字。');
                    assert.equal(sent.messages[1].content, h.RBQ?.api?.DRAW_SPEC_TOOL_INPUT_MESSAGE || '请读取 generate_draw_spec 工具说明中的本次任务输入，按系统规则分析并通过该工具提交结果。');
                }
                assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
            }
        });
    }
    for (const provider of ['custom', 'openai']) {
        for (const toolMode of [false, true]) {
            const transport = provider !== 'custom' && toolMode ? 'tool' : 'json';
            const channel = provider === 'custom' ? 'custom' : transport;
            await test(`${provider} test-page parser with Tool Call ${toolMode ? 'on' : 'off'} selects a single-page task and ${transport} transport`, async () => {
                const h = host(); Object.assign(h.settings._smartDrawTrigger, { provider, toolCallMode: toolMode,
                    toolInputInDescription: provider === 'custom' });
                installReply(h, channel, { shouldDraw: true, reason: '当前一页。', segments: [pages()[0]] }, body => {
                    const { request, instruction } = requestParts(body, provider); assertLayers(instruction);
                    assert.equal(request.currentMessage.content, story); assert.deepEqual(clone(request.recentMessages), []);
                    assertTrace(request.mangaPromptTrace, 'test_page', 'story', transport);
                    assert.equal(request.mangaPromptTrace.limits.maxPages, 1);
                    assert.equal(request.outputSchema.properties.segments.maxItems, 1);
                    assert.equal(request.manualInstruction, undefined, 'a second legacy planning instruction cannot conflict with the bundle task');
                    assertDrawTransport(body, provider, toolMode);
                    if (transport === 'tool') assert.deepEqual(clone(body.tools[0].function.parameters), clone(request.outputSchema));
                });
                const result = await h.sdt.parseTaggerSegment(story);
                assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
                assert.match(result.segment.characters[1].caption, /Text: 请放到桌上。$/);
            });
            await test(`${provider} manual submission with Tool Call ${toolMode ? 'on' : 'off'} adapts the whole story using ${transport} transport`, async () => {
                const h = host(); Object.assign(h.settings._smartDrawTrigger, { provider, toolCallMode: toolMode,
                    toolInputInDescription: provider === 'custom' });
                const fields = { 'rbq-sdt-manual-input': { value: story }, 'rbq-sdt-manual-status': {},
                    'rbq-sdt-manual-submit': {}, 'rbq-sdt-manual-use-context': { checked: false } }, submitted = [];
                Object.assign(h.sdt, { document: { getElementById: id => fields[id] }, localStorage: { setItem() {} },
                    toastr: { warning(message) { throw new Error(message); }, error(message) { throw new Error(message); }, success() {} },
                    PLUGIN_NAME: 'test', closeManualDrawDialog() {}, generateSdtImage: async segment => submitted.push(segment) });
                installReply(h, channel, { shouldDraw: true, reason: '完整正文两页。', segments: pages() }, body => {
                    const { request, instruction } = requestParts(body, provider); assertLayers(instruction); assertStyleData(request);
                    assertTrace(request.mangaPromptTrace, 'adapt_manual', 'story', transport);
                    assert.equal(request.minSegments, undefined); assert.deepEqual(clone(request.recentMessages), []);
                    assertDrawTransport(body, provider, toolMode);
                    if (transport === 'tool') assert.deepEqual(clone(body.tools[0].function.parameters), clone(request.outputSchema));
                });
                await h.sdt.submitManualDraw();
                assert.equal(h.calls(), 1); assert.equal(submitted.length, 2); assert.equal(h.images(), 0);
                assert.match(submitted[0].characters[1].caption, /Text: 请放到桌上。$/);
            });
        }
        await test(`${provider} page refinement uses preserve planning and leaves explicit clears authoritative`, async () => {
            const h = host(); h.settings._smartDrawTrigger.provider = provider;
            const original = h.sdt.normalizeMangaSegment(pages()[0]), returned = pages()[0];
            returned.panels[0].characters[1].bubbles = [];
            returned.panels[0].characters[1].positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 请放到桌上。';
            const before = clone(original);
            installReply(h, 'json', returned, body => { assertLayers(systemText(body)); assert.match(systemText(body), /保留|preserve/); });
            const result = await h.sdt.runSegmentAiRefinement(original, '明确清空贝丝台词，保留其他画格。');
            assert.equal(h.calls(), 1); assert.equal(h.images(), 0); assert.deepEqual(clone(original), before);
            assert.equal(h.manga.splitMangaText(result.characters[1].caption, false).text, '');
            assert.equal(result.mangaPage.panels.length, original.mangaPage.panels.length);
        });
        await test(`${provider} test-page rejects an extra returned page atomically instead of retaining only the first`, async () => {
            const h = host(); Object.assign(h.settings._smartDrawTrigger, { provider, characterMemoryEnabled: true });
            const result = { shouldDraw: true, reason: '错误两页。', segments: pages() };
            installReply(h, provider === 'custom' ? 'custom' : 'json', result);
            await assert.rejects(h.sdt.parseTaggerSegment(story), scopeError(result));
            assert.equal(h.calls(), 1); assert.equal(h.images(), 0); assert.equal(h.saves(), 0);
            assert.deepEqual(clone(h.sdt.getCharacterProfiles()), {});
            assert.equal(h.settings._smartDrawTrigger.mangaRenderCache, undefined);
        });
        await test(`${provider} page refinement rejects a multi-page wrapper before overwriting the original segment`, async () => {
            const h = host(); h.settings._smartDrawTrigger.provider = provider;
            const original = h.sdt.normalizeMangaSegment(pages()[0]), before = clone(original), returned = { segments: pages() };
            installReply(h, 'json', returned);
            await assert.rejects(h.sdt.runSegmentAiRefinement(original, '保持单页范围。'), scopeError(returned));
            assert.deepEqual(clone(original), before); assert.equal(h.calls(), 1); assert.equal(h.saves(), 0); assert.equal(h.images(), 0);
        });
    }
    await test('an in-flight main request freezes planner, dialogue, drawing mode, canvas and literal style data together', async () => {
        const h = host(); h.settings._smartDrawTrigger.toolCallMode = true;
        let release, captured;
        h.sdt.callApiWithJsonFallback = (_url, _options, body) => {
            h.call(); captured = clone(body); return new Promise(resolve => { release = resolve; });
        };
        const pending = h.sdt.callOpenAiCompatible(1, { type: 'auto' });
        assert.equal(h.calls(), 1); assertLayers(systemText(captured));
        const sentUser = JSON.parse(captured.messages.find(message => message.role === 'user').content);
        Object.assign(h.settings._mangaMode, { dialogueMode: 'legacy', style: 'monochrome', grammar: '4koma', autoSpread: false });
        h.settings._smartDrawTrigger.enhancedContext = 'v_manga_150';
        h.settings._promptPresets.activeId = styleB.id; h.settings.naiWidth = 2048; h.settings.naiHeight = 2048;
        release({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { tool_calls: [{ function: {
            name: 'generate_draw_spec', arguments: JSON.stringify({ shouldDraw: true, reason: '原请求完整两页。', segments: pages() }) } }] } }] }) });
        const result = await pending;
        assert.equal(h.calls(), 1); assert.equal(result.segments.length, 2);
        assert.equal(result.mangaRenderSettings.dialogueMode, 'structured'); assert.equal(result.mangaRenderSettings.style, 'soft_color');
        assertStyleData(sentUser); assert.equal(sentUser.mangaCanvas.width, 1024);
        assertTrace(result.mangaPromptTrace, 'adapt_message', 'story', 'tool');
        assert.match(result.segments[0].characters[1].caption, /blue jacket/);
        assert.match(result.segments[0].characters[1].caption, /Text: 请放到桌上。$/);
    });
    await test('Studio sends its captured sound-effect preference and separate position/shot field rules', async () => {
        for (const autoSfx of [true, false]) {
            const h = host(); h.settings._mangaMode.studio.autoSfx = autoSfx;
            h.RBQ.api.callStructuredCompletion = async options => {
                h.call();
                const instruction = systemText(options);
                assert.match(instruction, /工作台提供 position\/shot 字段时/);
                assert.match(instruction, autoSfx ? /可转译正文出现的独立拟音/ : /不补写或转译拟音/);
                const page = fixedStudioPage(1);
                return { rawReply: JSON.stringify(page), rawOutput: JSON.stringify(page) };
            };
            const result = await h.manga.callLlmStoryboardParser(story, 'cinema', 'zh-hans', '1');
            assert.equal(result.length, 1); assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
        }
    });
    for (const toolMode of [true, false]) {
        await test(`Studio ${toolMode ? 'tool' : 'JSON'} sends its page-specific bundle and actual ratio once`, async () => {
            const h = host(), store = h.settings._mangaMode; h.settings._smartDrawTrigger.toolCallMode = toolMode;
            const returned = { page: pages()[0].page, panels: pages()[0].panels };
            const receive = body => {
                h.call(); assertLayers(systemText(body));
                const user = JSON.parse(body.messages.at(-1).content);
                assert.equal(user.currentMessage, story);
                assertTrace(user.mangaPromptTrace, 'studio_page', 'studio-page', toolMode ? 'tool' : 'json');
                assert.deepEqual(user.mangaCanvas, { width: 1216, height: 832, orientation: 'landscape', autoSpread: true });
                assert.equal(user.stylePreset, undefined, 'Studio does not implicitly inject a global style preset');
                if (toolMode) { assert.ok(body.tool.function.parameters.properties.page); assert.equal(body.tool.function.parameters.properties.segments, undefined); }
                return toolMode ? { rawReply: JSON.stringify(returned) }
                    : { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(returned) } }] }) };
            };
            if (toolMode) h.RBQ.api.callStructuredCompletion = async body => receive(body);
            else { delete h.RBQ.api.callStructuredCompletion; h.manga.fetch = async (_url, options) => receive(JSON.parse(options.body)); }
            const result = await h.manga.requestStudioPanels(store, '办公室交谈这一页', story, 0);
            assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
            store.studio.panels = result; h.manga.applyStudioPagePlan(store, result, true);
            assert.equal(h.manga.splitMangaText(h.manga.compileMangaPage(h.manga.buildStudioPage(store)).characters[1].caption, false).text, '请放到桌上。');
        });
    }
    await test('Studio single and batch editors preserve page layout, slots and intentional empty dialogue arrays', async () => {
        for (const task of ['refine_panel', 'refine_panels']) {
            const h = host(), store = h.settings._mangaMode, original = pages()[0]; h.settings._smartDrawTrigger.toolCallMode = true;
            const returned = clone(original); returned.panels[0].characters[1].bubbles = [];
            returned.panels[0].characters[1].positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 请放到桌上。';
            h.RBQ.api.callStructuredCompletion = async body => {
                h.call(); assertLayers(systemText(body)); assert.match(systemText(body), /保留|preserve/);
                return { rawReply: JSON.stringify({ page: returned.page, panels: returned.panels }) };
            };
            const result = await h.manga.requestStudioPanels(store, '明确清空台词', JSON.stringify({ page: original.page, panels: original.panels }), 1, true, null, task);
            store.studio.panels = result; h.manga.applyStudioPagePlan(store, result, true);
            const compiled = h.manga.compileMangaPage(h.manga.buildStudioPage(store));
            assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
            assert.equal(h.manga.splitMangaText(compiled.characters[1].caption, false).text, '');
            assert.equal(result.length, 1); assert.equal(result[0].id, 'P1');
        }
    });
    await test('Studio auto four-panel grammar enforces its real four-panel response in the same completion', async () => {
        const h = host(), store = h.settings._mangaMode; store.grammar = '4koma'; h.settings._smartDrawTrigger.toolCallMode = true;
        let returned = fixedStudioPage(4);
        h.RBQ.api.callStructuredCompletion = async body => {
            h.call(); assertLayers(systemText(body));
            const trace = JSON.parse(body.messages.at(-1).content).mangaPromptTrace;
            assert.equal(trace.limits.panelCount, 4);
            assert.equal(body.tool.function.parameters.properties.panels.minItems, 4);
            assert.equal(body.tool.function.parameters.properties.panels.maxItems, 4);
            return { rawReply: JSON.stringify(returned) };
        };
        const result = await h.manga.callLlmStoryboardParser(story, '4koma', 'zh-hans', 'auto');
        assert.equal(result.length, 4); assert.equal(h.calls(), 1);
        returned = fixedStudioPage(3); const before = clone(store.studio);
        await assert.rejects(h.manga.callLlmStoryboardParser(story, '4koma', 'zh-hans', 'auto'), error => {
            assert.match(error.message, /画格数量|任务范围/); assert.ok(error.rawOutput.includes('P3')); return true;
        });
        assert.equal(h.calls(), 2, 'each user task still makes one call, including the failing task');
        assert.deepEqual(clone(store.studio), before); assert.equal(h.images(), 0);
    });
    await test('Studio rejects extra page trees, too many automatic panels and an invalid single-panel refinement without draft writes', async () => {
        for (const violation of ['extra-pages', 'six-panels', 'two-panel-edit', 'missing-page']) {
            const h = host(), store = h.settings._mangaMode; h.settings._smartDrawTrigger.toolCallMode = true;
            const original = pages()[0]; store.studio.panels = clone(original.panels); const before = clone(store.studio);
            const returned = fixedStudioPage(violation === 'six-panels' ? 6 : violation === 'two-panel-edit' ? 2 : 1);
            if (violation === 'extra-pages') returned.segments = pages();
            if (violation === 'missing-page') delete returned.page;
            h.RBQ.api.callStructuredCompletion = async () => { h.call(); return { rawReply: JSON.stringify(returned) }; };
            const editing = violation === 'two-panel-edit';
            await assert.rejects(h.manga.requestStudioPanels(store, '只处理当前页格', editing ? JSON.stringify({ currentPanel: original.panels[0], page: original.page }) : story,
                0, editing, null, editing ? 'refine_panel' : 'studio_page'), error => {
                if (violation === 'six-panels') assert.match(error.message, /画格数量/); else scopeError(returned)(error);
                return true;
            });
            assert.deepEqual(clone(store.studio), before); assert.equal(h.calls(), 1); assert.equal(h.saves(), 0); assert.equal(h.images(), 0);
        }
    });
    await test('Studio freezes its ratio, four-panel policy, selected module and dialogue format before a delayed reply', async () => {
        const h = host(), store = h.settings._mangaMode; h.settings._smartDrawTrigger.toolCallMode = true;
        let release, captured;
        h.RBQ.api.callStructuredCompletion = body => { h.call(); captured = clone(body); return new Promise(resolve => { release = resolve; }); };
        const pending = h.manga.requestStudioPanels(store, '办公室这一页', story, 0);
        assert.equal(h.calls(), 1); const sentUser = JSON.parse(captured.messages.at(-1).content);
        Object.assign(store, { grammar: '4koma', style: 'monochrome', dialogueMode: 'legacy', autoSpread: false });
        store.studio.ratio = '768x768'; h.settings._smartDrawTrigger.enhancedContext = 'v_manga';
        release({ rawReply: JSON.stringify(fixedStudioPage(1)) });
        const result = await pending;
        assert.equal(result.length, 1); assert.equal(h.calls(), 1); assert.equal(h.images(), 0);
        assert.equal(result[0].characters[1].bubbles[0].text, '请放到桌上。');
        assert.match(result[0].characters[1].positive, /blue jacket/);
        assert.equal(sentUser.mangaCanvas.width, 1216); assert.equal(sentUser.mangaCanvas.autoSpread, true);
        assertTrace(store.studio._lastDebug.promptTrace, 'studio_page', 'studio-page', 'tool');
        assert.equal(store.studio._lastDebug.promptTrace.limits.panelCount, undefined);
    });
    await test('Studio lacking the shared tool transport keeps a single plain JSON fetch with a JSON delivery contract', async () => {
        const h = host(); h.settings._smartDrawTrigger.toolCallMode = true; delete h.RBQ.api.callStructuredCompletion;
        h.manga.fetch = async (_url, options) => {
            h.call(); const body = JSON.parse(options.body); assertLayers(systemText(body));
            const trace = JSON.parse(body.messages.at(-1).content).mangaPromptTrace;
            assertTrace(trace, 'studio_page', 'studio-page', 'json');
            assert.equal(body.tools, undefined); assert.equal(body.response_format.type, 'json_object');
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(fixedStudioPage(1)) } }] }) };
        };
        const result = await h.manga.requestStudioPanels(h.settings._mangaMode, '当前一页', story, 0);
        assert.equal(h.calls(), 1); assert.equal(result.length, 1); assert.equal(h.images(), 0);
    });
    await test('Studio requires the model page layout before any cache or draft update', async () => {
        const h = host(), store = h.settings._mangaMode;
        const before = clone(store.studio), returned = fixedStudioPage(1); delete returned.page;
        let cached = 0;
        h.RBQ.api.saveMangaRenderCache = () => { cached++; };
        h.RBQ.api.callStructuredCompletion = async () => { h.call(); return { rawReply: JSON.stringify(returned) }; };
        await assert.rejects(h.manga.requestStudioPanels(store, '保留这一页完整布局。', story, 0), scopeError(returned));
        assert.deepEqual(clone(store.studio.panels), before.panels);
        assert.equal(h.calls(), 1); assert.equal(cached, 0); assert.equal(h.saves(), 0); assert.equal(h.images(), 0);
    });
    console.log(`\n${passed} layered manga prompt tests passed; no live calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
