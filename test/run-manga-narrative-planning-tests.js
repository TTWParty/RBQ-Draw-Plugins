/** Execute real SDT request builders, schemas, response normalization and NAI hooks.
 * HTTP replies are authored non-explicit fixtures, not an evaluation of LLM planning quality.
 * No network, model credits or image credits are used. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook, sdtSource } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,sdtSource};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const protocol = RBQ.api.mangaProtocol;
const narrative = 'v_manga_narrative';
const story = '小林在车站门口等到阿岚，把折好的信递给她。阿岚接过信，低头读完，说：“我会赴约。”小林松了口气，说：“谢谢你。”随后两人走出车站，看见远处亮起的灯塔。';
const modes = ['structured', 'legacy'];
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function reset(mode = 'structured') {
    Object.assign(settings, { currentMode: 'nai', naiWidth: 1024, naiHeight: 1536 });
    settings._mangaMode = { enabled: true, style: 'soft_color', grammar: 'cinema', gutter: 'bleed', language: 'zh-hans',
        dialogueMode: mode, autoSpread: true, antiHijack: true,
        studio: { ratio: '832x1216', panels: [], panelCountMode: 'auto', useChatChars: false } };
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: narrative, multiCharOutput: true,
        characterMemoryEnabled: false, characterProfiles: {}, injectCharacterCard: false, minSegments: 19,
        provider: 'openai', openaiBaseUrl: 'https://fixture.invalid/v1', openaiModel: 'fixture',
        customUrl: 'https://fixture.invalid/tagger', squashMessages: false };
    sdt.getMessageSnapshot = () => ({ mes: story, name: 'Narrator' });
    RBQ.api.getRecentMessages = () => [
        { id: 0, mes: '两人在车站见面前，小林穿蓝色外套，阿岚穿白衬衫。' },
        { id: 1, mes: story }, { id: 2, mes: '第二天，小林换上雨衣。' }
    ];
    sdt.prepareNaiCharData(null);
}
function hasBubbles(value) {
    return !!value && typeof value === 'object' && (Object.hasOwn(value, 'bubbles') || Object.values(value).some(hasBubbles));
}
function checkDialogueSchema(schema, mode) {
    const page = schema.properties.page, panel = schema.properties.panels.items, person = panel.properties.characters.items;
    for (const owner of [page, panel, person]) assert.equal(Object.hasOwn(owner.properties, 'bubbles'), mode === 'structured');
    for (const owner of [panel, person]) assert.equal(owner.required.includes('bubbles'), mode === 'structured');
    for (const field of ['base', 'outfit', 'positive', 'negative']) assert.ok(person.required.includes(field));
    assert.equal(schema.properties.characters, undefined, 'characters remain owned by a panel');
    assert.equal(schema.required.includes('intent'), false, 'short planning notes stay optional');
}
function person(id, position, action, mode, text = '') {
    const row = { character_id: id, name: id === 'C1' ? 'Lin (original)' : 'Lan (original)',
        base: id === 'C1' ? 'girl, adult, long black hair' : 'girl, adult, short blonde hair',
        outfit: id === 'C1' ? 'blue coat, black trousers' : 'white shirt, dark skirt',
        positive: position + ', ' + action, negative: '' };
    if (mode === 'structured') row.bubbles = text ? [{ type: 'speech', position: 'right-upper', layout: 'vertical', text }] : [];
    else if (text) row.positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: ' + text;
    return row;
}
function panel(id, position, shot, people, mode) {
    return { id, description: position + ', ' + shot + ', station, window light', characters: people,
        ...(mode === 'structured' ? { bubbles: [] } : {}) };
}
function pages(mode) {
    const p = (id, position, action, text) => person(id, position, action, mode, text);
    return [
        { format: 'nai5-comic', label: 'Page 1: 递信', intent: 'NARRATIVE_INTENT_ONLY: 从等候到信交接，两个均衡画格。',
            anchor: { text: '小林在车站门口等到阿岚，把折好的信递给她。' },
            page: { base: 'comic, 2girls, 2 panels, one row of two equal panels, right to left reading path, window light' },
            panels: [
                panel('P1', 'right half panel', 'medium shot', [p('C1', 'right half panel', 'standing, right hand holding folded envelope, facing another'), p('C2', 'right half panel', 'standing, facing another, left hand reaching toward envelope')], mode),
                panel('P2', 'left half panel', 'medium shot', [p('C1', 'left half panel', 'standing, arms at sides, looking at another'), p('C2', 'left half panel', 'standing, left hand holding folded envelope, looking at envelope')], mode)
            ] },
        { format: 'nai5-comic', label: 'Page 2: 回应', intent: 'NARRATIVE_INTENT_ONLY: 阅读后的承诺与松口气。',
            anchor: { text: '阿岚接过信，低头读完，说：“我会赴约。”' },
            page: { base: 'comic, 2girls, 2 panels, top and bottom wide panels of equal height, top to bottom reading path, window light' },
            panels: [
                panel('P1', 'top wide panel', 'close-up', [p('C2', 'top wide panel', 'left hand holding open letter, looking at another', '我会赴约。')], mode),
                panel('P2', 'bottom wide panel', 'close-up', [p('C1', 'bottom wide panel', 'relaxed shoulders, smiling, looking at another', '谢谢你。')], mode)
            ] },
        { format: 'nai5-comic', label: 'Page 3: 灯塔', intent: 'NARRATIVE_INTENT_ONLY: 转场到车站外，展示灯塔。',
            anchor: { text: '随后两人走出车站，看见远处亮起的灯塔。' },
            page: { base: 'splash page, single panel, 2girls, full-page panel, distant lighthouse, evening' },
            panels: [panel('P1', 'full-page panel', 'wide shot', [p('C1', 'full-page panel', 'standing, from behind, looking at lighthouse'), p('C2', 'full-page panel', 'standing, from behind, left hand holding letter, looking at lighthouse')], mode)] }
    ];
}
function replyFor(channel, mode) {
    const result = { shouldDraw: true, reason: 'NARRATIVE_REASON_ONLY: 递信、回应与转场。', segments: pages(mode) };
    return channel === 'OpenAI tool' ? { choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(result) } }] } }] }
        : channel === 'OpenAI JSON' ? { choices: [{ message: { content: JSON.stringify(result) } }] } : result;
}
function imageRequests(result) {
    return clone(result.segments.map(segment => {
        sdt.prepareNaiCharData(segment);
        let request = payload(sdt.getFinalPrompt(segment));
        for (const hook of [sdtHook, mangaHook]) request = hook(request);
        return clone(request);
    }));
}
function checkPlainNarrativeRequest(body, provider, description) {
    const request = provider === 'custom' ? body : JSON.parse(body.messages.find(row => row.role === 'user').content);
    const system = provider === 'custom' ? request.mangaInstruction : body.messages.filter(row => row.role === 'system').map(row => row.content).join('\n');
    const selected = protocol.planningPrompt(narrative);
    assert.ok(system.includes(selected));
    assert.equal(system.indexOf(selected), system.lastIndexOf(selected));
    assert.ok(system.includes(protocol.systemPrompt(narrative)));
    assert.deepEqual(clone(request.outputSchema), clone(protocol.outputSchema(undefined, narrative)));
    assert.deepEqual(clone(request.mangaCanvas), { width: 1024, height: 1536, orientation: 'portrait', autoSpread: true });
    assert.equal(request.currentMessage.content, description);
    assert.ok(request.contextAnalysisInstructions);
    if (provider !== 'custom') {
        assert.equal(body.tools, undefined, 'these existing entry points keep their plain JSON transport');
        assert.deepEqual(clone(body.response_format), { type: 'json_object' });
    }
    return request;
}

(async () => {
    await test('new saved planner routes to manga while ordinary choices and the existing default keep their behavior', () => {
        reset();
        assert.equal(sdt.isMangaRequest({ enhancedContext: narrative, _mangaActive: false }), true);
        assert.equal(sdt.getRequestEnhancedContext({ enhancedContext: narrative, _mangaActive: false }), narrative);
        assert.equal(sdt.getRequestEnhancedContext({ enhancedContext: 'off', _mangaActive: true }), 'v_manga');
        assert.equal(sdt.isMangaRequest({ enhancedContext: 'v14', _mangaActive: false }), false);
        assert.equal(protocol.planningPrompt('unknown'), protocol.planningPrompt('v_manga'));
        assert.notEqual(protocol.systemPrompt(narrative), protocol.systemPrompt('v_manga'));
        assert.equal(protocol.systemPrompt('unknown'), protocol.systemPrompt('v_manga'));
    });
    for (const mode of modes) await test(`${mode} narrative schema relaxes page layout without changing ownership or adding planning fields`, () => {
        reset(mode);
        const oldSchema = clone(protocol.segmentSchema(undefined, 'v_manga'));
        const schema = clone(protocol.segmentSchema(undefined, narrative));
        checkDialogueSchema(schema, mode);
        assert.notEqual(schema.properties.intent.description, oldSchema.properties.intent.description);
        assert.notEqual(schema.properties.page.properties.base.description, oldSchema.properties.page.properties.base.description);
        assert.doesNotMatch(schema.properties.page.properties.base.description, /dominant panel position/);
        schema.properties.intent.description = oldSchema.properties.intent.description;
        schema.properties.page.properties.base.description = oldSchema.properties.page.properties.base.description;
        assert.deepEqual(schema, oldSchema, 'all other fields and constraints remain the established manga protocol');
        const output = clone(protocol.outputSchema(undefined, narrative)), oldOutput = clone(protocol.outputSchema(undefined, 'v_manga'));
        assert.equal(hasBubbles(output), mode === 'structured');
        assert.notEqual(output.segments[0].page.base, oldOutput.segments[0].page.base);
        output.segments[0].intent = oldOutput.segments[0].intent;
        output.segments[0].page.base = oldOutput.segments[0].page.base;
        assert.deepEqual(output, oldOutput);
        settings._mangaMode.style = 'monochrome';
        assert.ok(protocol.segmentSchema(undefined, narrative).properties.panels.items.properties.characters.items.properties.render);
    });
    await test('narrative payload carries current canvas and full body, filters future state and ignores ordinary image quotas', () => {
        reset();
        for (const [width, height, orientation] of [[1024, 1536, 'portrait'], [1536, 1024, 'landscape'], [768, 768, 'square']]) {
            settings.naiWidth = width; settings.naiHeight = height;
            const { payload: request, requestContext } = sdt.buildRequestPayload(1, { type: 'auto' });
            assert.deepEqual(clone(request.mangaCanvas), { width, height, orientation, autoSpread: true });
            assert.deepEqual(clone(request.mangaCanvas), clone(protocol.planningContext(undefined, narrative)));
            assert.equal(request.currentMessage.content, story);
            assert.deepEqual(clone(request.recentMessages.map(row => row.id)), [0]);
            assert.equal(request.minSegments, undefined);
            assert.equal(requestContext.planningPreset, narrative);
            assert.deepEqual(clone(request.outputSchema), clone(protocol.outputSchema(undefined, narrative)));
        }
        assert.deepEqual(clone(protocol.planningContext('1216x832', narrative)), { width: 1216, height: 832, orientation: 'landscape', autoSpread: true });
        assert.equal(protocol.planningContext(undefined, 'v_manga'), null);
    });

    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callOpenAiCompatible('), sdtSource.indexOf('    async function callCustomHttp(')), sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('), sdtSource.indexOf('    async function callStructuredCompletion(')), sdt);
    Object.assign(sdt, { normalizeBaseUrl: value => value, checkUrlSafety() {}, logTaggerPayload() {},
        validateStructuredResult: result => result, safeReadJsonResponse: async response => response.json(),
        getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {}, buildThinkingParams: () => ({}),
        DRAW_SPEC_TOOL_RULE: 'Submit final results via generate_draw_spec' });
    for (const mode of modes) for (const channel of ['custom HTTP', 'OpenAI JSON', 'OpenAI tool']) {
        await test(`${channel} sends ${mode} narrative contract once and compiles all fixture pages, text and layout`, async () => {
            reset(mode);
            settings._smartDrawTrigger.provider = channel === 'custom HTTP' ? 'custom' : 'openai';
            settings._smartDrawTrigger.toolCallMode = channel === 'OpenAI tool';
            let calls = 0;
            const receive = body => {
                calls++;
                const request = channel === 'custom HTTP' ? body : JSON.parse(body.messages.find(row => row.role === 'user').content);
                const system = channel === 'custom HTTP' ? request.mangaInstruction : body.messages.filter(row => row.role === 'system').map(row => row.content).join('\n');
                const selected = protocol.planningPrompt(narrative);
                assert.ok(system.includes(selected), 'the selected full-body planner reaches the actual transport');
                assert.equal(system.indexOf(selected), system.lastIndexOf(selected), 'planner is sent only once');
                assert.ok(system.includes(protocol.systemPrompt(narrative)), 'shared system prompt also uses narrative layout');
                assert.deepEqual(clone(request.outputSchema), clone(protocol.outputSchema(undefined, narrative)));
                assert.deepEqual(clone(request.mangaCanvas), { width: 1024, height: 1536, orientation: 'portrait', autoSpread: true });
                assert.equal(request.currentMessage.content, story);
                if (channel === 'OpenAI tool') {
                    const schema = body.tools[0].function.parameters.properties.segments.items;
                    checkDialogueSchema(schema, mode);
                    assert.deepEqual(clone(schema), clone(protocol.segmentSchema(undefined, narrative)));
                    assert.equal(body.tool_choice.function.name, 'generate_draw_spec');
                    assert.doesNotMatch(JSON.stringify(body.tools), /uniqueItems/);
                }
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => replyFor(channel, mode) };
            };
            sdt.smartFetch = async (_url, options) => receive(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => receive(body);
            const result = channel === 'custom HTTP' ? await sdt.callCustomHttp(1, { type: 'auto' }) : await sdt.callOpenAiCompatible(1, { type: 'auto' });
            assert.equal(calls, 1, 'no automatic planning retry');
            assert.deepEqual(clone(result.segments.map(row => row.mangaPage.panels.length)), [2, 2, 1], 'normalization retains this authored fixture, without imposing a page/panel count');
            assert.deepEqual(clone(result.segments.map(row => row.anchor.text)), pages(mode).map(row => row.anchor.text));
            assert.equal(result.mangaRenderSettings.dialogueMode, mode);
            const sent = imageRequests(result);
            assert.match(sent[0].input, /one row of two equal panels/);
            assert.match(sent[1].input, /top and bottom wide panels of equal height/);
            assert.match(sent[2].input, /full-page panel/);
            assert.match(sent[0].parameters.v4_prompt.caption.char_captions[3].char_caption, /left hand holding folded envelope/);
            assert.match(sent[1].parameters.v4_prompt.caption.char_captions[0].char_caption, /Text: 我会赴约。$/);
            assert.match(sent[1].parameters.v4_prompt.caption.char_captions[1].char_caption, /Text: 谢谢你。$/);
            assert.doesNotMatch(JSON.stringify(sent), /NARRATIVE_(?:INTENT|REASON)_ONLY|mangaCanvas|v_manga_narrative/);
            const before = clone(sent);
            settings._smartDrawTrigger.enhancedContext = 'v_manga_150';
            assert.deepEqual(imageRequests(result), before, 'changing planner does not rewrite compiled cached pages');
            assert.equal(calls, 1);
        });
    }
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function collectMangaReferenceData('), sdtSource.indexOf('    async function importCharacterFromCurrentCard(')), sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function parseTaggerSegment('), sdtSource.indexOf('    RBQ.api.parseWithTagger =')), sdt);
    for (const mode of modes) for (const provider of ['custom', 'openai']) {
        await test(`${provider} test-draw parser sends ${mode} narrative canvas and schema and returns its single fixture page`, async () => {
            reset(mode);
            Object.assign(settings._smartDrawTrigger, { provider, toolCallMode: true });
            const description = '阿岚接过信，低头读完，说：“我会赴约。”小林松了口气，说：“谢谢你。”';
            let calls = 0;
            const receive = body => {
                calls++;
                const request = checkPlainNarrativeRequest(body, provider, description);
                assert.deepEqual(clone(request.recentMessages), []);
                assert.match(request.manualInstruction, /仅输出 1 个 segment/);
                const single = { shouldDraw: true, segments: [pages(mode)[1]] };
                const reply = provider === 'custom' ? single : { choices: [{ message: { content: JSON.stringify(single) } }] };
                return { ok: true, json: async () => reply };
            };
            sdt.smartFetch = async (_url, options) => receive(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => receive(body);
            const result = await sdt.parseTaggerSegment(description);
            assert.equal(calls, 1);
            assert.equal(result.segment.mangaPage.label, 'Page 2: 回应');
            assert.equal(result.segment.mangaPage.panels.length, 2);
            assert.equal(result.segment.mangaRenderSettings.dialogueMode, mode);
            assert.match(result.finalPrompt, /top and bottom wide panels of equal height/);
            assert.match(result.segment.characters[0].caption, /Text: 我会赴约。$/);
            assert.match(result.segment.characters[1].caption, /Text: 谢谢你。$/);
            assert.doesNotMatch(result.finalPrompt, /NARRATIVE_INTENT_ONLY|mangaCanvas|v_manga_narrative/);
        });
    }
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function submitManualDraw('), sdtSource.indexOf('    /* ── 🗂️ 剧情漫画时间轴')), sdt);
    for (const mode of modes) for (const provider of ['custom', 'openai']) {
        await test(`${provider} manual draw sends ${mode} narrative contract once and submits every fixture page`, async () => {
            reset(mode);
            Object.assign(settings._smartDrawTrigger, { provider, toolCallMode: true });
            const keys = ['document', 'localStorage', 'toastr', 'PLUGIN_NAME', 'closeManualDrawDialog', 'generateSdtImage'];
            const original = Object.fromEntries(keys.map(key => [key, sdt[key]]));
            const fields = { 'rbq-sdt-manual-input': { value: story }, 'rbq-sdt-manual-status': {},
                'rbq-sdt-manual-submit': {}, 'rbq-sdt-manual-use-context': { checked: false } };
            let calls = 0, closed = 0;
            const submitted = [];
            try {
                Object.assign(sdt, { document: { getElementById: id => fields[id] }, localStorage: { setItem() {} },
                    toastr: { warning(text) { throw new Error(text); }, success() {}, error(text) { throw new Error(text); } },
                    PLUGIN_NAME: 'test', closeManualDrawDialog() { closed++; },
                    generateSdtImage: async (segment, prompt) => { submitted.push({ segment, prompt }); } });
                const receive = body => {
                    calls++;
                    const request = checkPlainNarrativeRequest(body, provider, story);
                    assert.deepEqual(clone(request.recentMessages), []);
                    assert.equal(request.minSegments, undefined, 'ordinary image minimum cannot force manual comic pages');
                    assert.doesNotMatch(request.manualInstruction, /仅输出 1 个 segment/);
                    const fixture = { shouldDraw: true, segments: pages(mode) };
                    const reply = provider === 'custom' ? fixture : { choices: [{ message: { content: JSON.stringify(fixture) } }] };
                    return { ok: true, json: async () => reply };
                };
                sdt.smartFetch = async (_url, options) => receive(JSON.parse(options.body));
                sdt.callApiWithJsonFallback = async (_url, _options, body) => receive(body);
                await sdt.submitManualDraw();
                assert.equal(calls, 1);
                assert.equal(closed, 1);
                assert.deepEqual(submitted.map(row => row.segment.mangaPage.panels.length), [2, 2, 1]);
                for (const row of submitted) {
                    assert.equal(row.segment.mangaRenderSettings.dialogueMode, mode);
                    assert.equal(row.prompt, sdt.getFinalPrompt(row.segment));
                    assert.doesNotMatch(row.prompt, /NARRATIVE_INTENT_ONLY|mangaCanvas|v_manga_narrative/);
                }
                assert.match(submitted[1].segment.characters[0].caption, /Text: 我会赴约。$/);
                assert.match(submitted[1].segment.characters[1].caption, /Text: 谢谢你。$/);
            } finally { Object.assign(sdt, original); }
        });
    }
    await test('a delayed narrative response keeps its sent contract and captured dialogue format after the planner changes', async () => {
        reset('structured');
        settings._smartDrawTrigger.toolCallMode = true;
        let release, body, calls = 0;
        sdt.callApiWithJsonFallback = (_url, _options, request) => {
            calls++; body = clone(request);
            return new Promise(resolve => { release = resolve; });
        };
        const pending = sdt.callOpenAiCompatible(1, { type: 'auto' });
        assert.equal(calls, 1);
        const sentSchema = body.tools[0].function.parameters.properties.segments.items;
        assert.deepEqual(sentSchema, clone(protocol.segmentSchema(undefined, narrative)));
        settings._smartDrawTrigger.enhancedContext = 'v_manga';
        settings._mangaMode.dialogueMode = 'legacy';
        release({ ok: true, headers: { get: () => 'application/json' }, json: async () => replyFor('OpenAI tool', 'structured') });
        const result = await pending;
        assert.equal(result.mangaRenderSettings.dialogueMode, 'structured');
        assert.deepEqual(body.tools[0].function.parameters.properties.segments.items, sentSchema);
        assert.match(imageRequests(result)[1].parameters.v4_prompt.caption.char_captions[0].char_caption, /Text: 我会赴约。$/);
        assert.equal(calls, 1);
    });
    sdt.prepareNaiCharData(null);
    console.log(`\n${passed} narrative-planning transport and compilation tests passed; no live LLM quality claim.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
