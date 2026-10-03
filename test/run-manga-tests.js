/** Regression tests execute production functions/hooks with a minimal RBQ host. No network or image credits. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const mangaSource = fs.readFileSync(path.join(__dirname, '../plugins/manga-mode.js'), 'utf8');
const sdtSource = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const settings = {
    currentMode: 'nai',
    _mangaMode: { enabled: true, style: 'monochrome', grammar: 'cinema', gutter: 'bleed', language: 'zh-hans', autoSpread: true, antiHijack: true,
        studio: { ratio: '832x1216', panels: [], panelCountMode: 'auto' } },
    _smartDrawTrigger: { _mangaActive: true, enhancedContext: 'v_manga', multiCharOutput: true, multiCharUseCoords: false }
};
const hooks = [];
const RBQ = { api: { getSettings: () => settings }, on: (event, callback) => { if (event === 'buildNaiV4Payload') hooks.push(callback); } };
const silentConsole = { info() {}, warn() {}, log() {} };
const manga = vm.createContext({ RBQ, console: silentConsole, toastr: { info() {} } });
vm.runInContext(mangaSource.slice(mangaSource.indexOf('const PLUGIN_ID'), mangaSource.indexOf('    // ── 6. UI Injection')) + `
    Object.assign(globalThis, { compileMangaPage, sanitizeMangaPositivePrompt, sanitizeMangaNegativePrompt, buildMangaSystemPrompt,
        setStudioRequest(value, ratio = '832x1216') { studioRequest = value; studioGenerationRatio = ratio; } });`, manga);
vm.runInContext(mangaSource.slice(mangaSource.indexOf('    function resolveBubbleTypeTag('), mangaSource.indexOf('    function extractChatNarrative(')), manga);
vm.runInContext(mangaSource.slice(mangaSource.indexOf('    const STORYBOARD_PRESETS ='), mangaSource.indexOf('    function resolveBubbleTypeTag(')) + '\nthis.presets = STORYBOARD_PRESETS;', manga);
vm.runInContext(mangaSource.slice(mangaSource.indexOf('    function syncMangaToSdt('), mangaSource.indexOf('    function updateUiState(')), manga);
const mangaHook = hooks[0];
const sdt = vm.createContext({ RBQ, console: silentConsole, getStore: () => settings._smartDrawTrigger,
    debugInfo() {}, isMeaningfulLorebookEntry: () => false,
    // A nested comic must never reach legacy memory merging.
    mergeCharacterCaption: () => { throw new Error('unexpected legacy identity merge'); },
    isJunkCharacterName: () => false, getActiveCharacterName: () => '', getCharacterProfiles: () => ({}),
    normalizeAnchor: (anchor, index) => ({ type: 'sentence', index, ...anchor }), extractJson: JSON.parse,
    sdtParseCoord: c => typeof c === 'object' ? c : { x: 0.5, y: 0.5 }
});
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function isMangaRequest('), sdtSource.indexOf('    function isMeaningfulLorebookEntry(')), sdt);
vm.runInContext('let pendingNaiCharData = null;\n' + sdtSource.slice(sdtSource.indexOf('    function getFinalPrompt('), sdtSource.indexOf('    /* ── ComfyUI payload hook')), sdt);
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    const DRAW_SPEC_TOOL ='), sdtSource.indexOf('    const DRAW_SPEC_TOOL_RULE')), sdt);
Object.assign(sdt, {
    getMessageSnapshot: () => ({ mes: '她们交谈后转身离开了教室。', name: 'Narrator' }),
    collectMatchedLorebookEntries: () => [], collectCharacterCardInfo: () => [],
    getActiveSystemPrompt: () => 'ordinary prompt'
});
RBQ.api.getRecentMessages = () => [];
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function getEnhancedContextPayload('), sdtSource.indexOf('    function splitTurnsByColon(')), sdt);
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function sanitizeSdtResult('), sdtSource.indexOf('    function saveMsgExtraSdt(')), sdt);
const sdtHook = hooks[1];
const person = (id, hair, text = '') => ({ character_id: id, name: id === 'C1' ? 'Ami (original)' : 'Mei (original)',
    positive: `girl, ${hair} hair, looking at another` + (text ? `, BubbleType: 通常吹き出し, Layout: 縦書き, Text: ${text}` : ''),
    negative: hair === 'long' ? 'short hair' : 'long hair' });
const fixture = () => ({ format: 'nai5-comic', label: 'Page 1', anchor: { text: '她们交谈后转身离开了教室。' },
    page: { base: 'comic, 3 panels, 2girls, vertical layout', non_character: 'ナレーション枠, Layout: 横書き, Text: 放学后' },
    panels: [
        { id: 'P1', description: 'top panel, classroom', characters: [person('C1', 'long', '一起回家吧。'), person('C2', 'short', '好。')] },
        { id: 'P2', description: 'middle panel, hallway', characters: [person('C1', 'long'), person('C2', 'short')] },
        { id: 'P3', description: 'bottom panel, empty classroom', non_character: 'SFX: 擬音, 吹き出しなし, Text: 咔哒', characters: [] }
    ] });
const payload = (input = 'comic', captions = []) => ({ model: 'nai-diffusion-4-5-full', input,
    parameters: { width: 832, height: 1216, negative_prompt: 'text, bad hands',
        v4_prompt: { caption: { base_caption: input, char_captions: captions }, use_coords: false },
        v4_negative_prompt: { caption: { base_caption: 'text, bad hands', char_captions: [] } } } });
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
const json = value => JSON.parse(JSON.stringify(value));

test('three panels compile to four person appearances, environment and SFX stay in base', () => {
    const data = fixture(), before = JSON.stringify(data), compiled = manga.compileMangaPage(data);
    assert.equal(compiled.characters.length, 4);
    assert.equal(JSON.stringify(data), before);
    assert.match(compiled.base, /empty classroom/);
    assert.match(compiled.base, /Text: 放学后\n\n咔哒$/);
    assert.doesNotMatch(compiled.base, /一起回家/);
    assert.equal(compiled.characters[0].uc, 'short hair');
    assert.equal(compiled.characters[2].characterId, 'C1');
});
test('empty page and splash are valid; malformed nested pages are rejected', () => {
    const data = fixture(); data.panels = [data.panels[2]]; data.page.base = 'splash page, 単一コマ, no humans';
    assert.equal(manga.compileMangaPage(data).characters.length, 0);
    assert.throws(() => manga.compileMangaPage({ ...data, characters: [] }), /混用/);
    data.panels.push(data.panels[0]); assert.throws(() => manga.compileMangaPage(data), /唯一/);
    const duplicate = fixture(); duplicate.panels[0].characters.push(duplicate.panels[0].characters[0]);
    assert.throws(() => manga.compileMangaPage(duplicate), /重复/);
});
test('caption sanitizer preserves text, exact negative tags and closed weights', () => {
    assert.equal(manga.sanitizeMangaNegativePrompt('2::comic panels::, speech bubbles, comic book, text, bad hands'), 'bad hands');
    assert.equal(manga.sanitizeMangaNegativePrompt('1.2::text, bad hands::, bad text, book cover'), '1.2::bad hands::, bad text, book cover');
    assert.equal(manga.sanitizeMangaNegativePrompt('2::text, 1.2::bad hands, comic::, bad feet::'), '2::1.2::bad hands::, bad feet::');
    const input = 'no text, girl, BubbleType: 通常吹き出し, Text: no text, A|B\n\n第二句';
    assert.equal(manga.sanitizeMangaPositivePrompt(input).split('Text: ')[1], input.split('Text: ')[1]);
});
test('SDT text and tool results use nested compiler and bypass legacy identity overwrite', () => {
    const message = { shouldDraw: true, segments: [fixture()] };
    const plain = sdt.normalizeTaggerResult({ choices: [{ message: { content: JSON.stringify(message) } }] });
    const tool = sdt.normalizeTaggerResult({ choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(message) } }] } }] });
    assert.equal(plain.segments[0].characters.length, 4);
    assert.deepEqual(json(plain.segments[0].characters), json(tool.segments[0].characters));
    assert.equal(plain.segments[0].characters[0].caption, fixture().panels[0].characters[0].positive);
    const schema = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters.properties.segments.items;
    assert.ok(schema.properties.panels.items.properties.characters);
    assert.equal(schema.properties.characters, undefined);
});
test('both hook orders produce the same request without duplicating styles or per-person UC', () => {
    const segment = sdt.normalizeMangaSegment(fixture());
    function run(order) {
        sdt.prepareNaiCharData(segment);
        let p = payload(sdt.getFinalPrompt(segment));
        for (const hook of order) p = hook(p);
        return p;
    }
    const first = run([sdtHook, mangaHook]), second = run([mangaHook, sdtHook]);
    assert.deepEqual(json(first), json(second));
    assert.equal(first.model, 'nai-diffusion-5-full');
    assert.equal(first.parameters.v4_prompt.caption.char_captions.length, 4);
    assert.equal(first.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, 'short hair');
    assert.doesNotMatch(first.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, /original|color/);
});
test('empty SDT page clears stale host characters; manual coordinates survive', () => {
    const data = fixture(); data.panels = [data.panels[2]];
    sdt.prepareNaiCharData(sdt.normalizeMangaSegment(data));
    let p = sdtHook(payload('comic', [{ char_caption: 'stale girl' }]));
    assert.equal(p.parameters.v4_prompt.caption.char_captions.length, 0);
    const manual = fixture(); manual.position_mode = 'manual';
    assert.throws(() => manga.compileMangaPage(manual), /坐标/);
    manual.panels.forEach(panel => panel.characters.forEach(c => { c.center = { x: 0.2, y: 0.7 }; }));
    sdt.prepareNaiCharData(sdt.normalizeMangaSegment(manual)); p = mangaHook(sdtHook(payload()));
    assert.equal(p.parameters.v4_prompt.use_coords, true);
    assert.equal(p.parameters.v4_prompt.caption.char_captions[0].centers[0].x, 0.2);
});
test('Studio silent and speaking pages have identical slot counts and unique default positions', () => {
    const store = settings._mangaMode;
    store.studio.panels = Array.from({ length: 4 }, (_, i) => ({ shot: 'medium shot', tags: 'classroom', characters: [person('C1', 'long')], non_character: '' }));
    const silent = manga.compileMangaPage(manga.buildStudioPage(store));
    store.studio.panels[0].characters[0].positive += ', Text: no text | keep this';
    const speaking = manga.compileMangaPage(manga.buildStudioPage(store));
    assert.equal(silent.characters.length, 4); assert.equal(speaking.characters.length, 4);
    assert.equal(new Set(store.studio.panels.map((_, i) => manga.defaultPanelPosition(i, 4, 'cinema'))).size, 4);
    manga.setStudioRequest({ prompt: speaking.base, compiled: speaking });
    const p = mangaHook(payload(speaking.base));
    assert.equal(p.parameters.v4_prompt.caption.char_captions.length, 4);
    assert.match(p.parameters.v4_prompt.caption.char_captions[0].char_caption, /Text: no text \| keep this$/);
    manga.setStudioRequest(null);
});
test('legacy Studio drafts preserve content without inventing people; one-panel pages use splash', () => {
    const store = settings._mangaMode;
    store.studio.panels = [{ tags: 'empty classroom', shot: 'wide shot', bubbleType: 'sfx', bubbleText: '咔哒' }];
    const result = manga.compileMangaPage(manga.buildStudioPage(store));
    assert.match(result.base, /empty classroom/); assert.match(result.base, /Text: 咔哒/);
    assert.match(result.base, /splash page/); assert.equal(result.characters.length, 0);
});
test('spread detection ignores dialogue and retains upstream Prompt Presets', () => {
    let p = mangaHook(payload('full color, photorealistic, 見開きページ'));
    assert.equal(p.parameters.width, 1216); assert.match(p.input, /full color, photorealistic/);
    p = mangaHook(payload('comic, Text: 見開きページ'));
    assert.equal(p.parameters.width, 832);
});
test('real request builder and system prompt agree with the nested tool schema', () => {
    const { payload: request } = sdt.buildRequestPayload(1, { type: 'auto' });
    assert.equal(request.outputSchema.segments[0].format, 'nai5-comic');
    assert.equal(request.mangaInstruction, undefined, 'OpenAI system prompt is not duplicated into the user payload');
    assert.equal(request.outputSchema.story_plan, undefined);
    const prompt = sdt.getSystemPromptWithPresets(settings._smartDrawTrigger, true);
    assert.match(prompt, /格内人物/);
    assert.doesNotMatch(prompt, /数组长度严格等于|每个节拍规划为 1 页/);
    const four = manga.buildMangaSystemPrompt({ ...settings._mangaMode, grammar: '4koma' });
    assert.match(four, /允许固定等分/); assert.doesNotMatch(four, /禁止.*四等分/);
});
test('comic page count ignores ordinary quotas and photo markers; ordinary requests retain them', () => {
    const previous = { ...settings._smartDrawTrigger }, snapshot = sdt.getMessageSnapshot;
    try {
        settings._smartDrawTrigger.minSegments = 9;
        sdt.getMessageSnapshot = () => ({ mes: '[图组1]她递出信。[图组2]他接住信。' });
        let request = sdt.buildRequestPayload(1, { type: 'auto' }).payload;
        assert.equal(request.minSegments, undefined);
        assert.match(request.segmentInstruction, /一个 segment 是一张漫画图片/);
        settings._smartDrawTrigger._mangaActive = false; settings._smartDrawTrigger.enhancedContext = 'off';
        request = sdt.buildRequestPayload(1, { type: 'auto' }).payload;
        assert.equal(request.minSegments, 2);
        assert.match(request.segmentInstruction, /严格 1:1/);
        sdt.getMessageSnapshot = () => ({ mes: '她们交谈后转身离开了教室。' });
        assert.equal(sdt.buildRequestPayload(1, { type: 'auto' }).payload.minSegments, 9);
    } finally { settings._smartDrawTrigger = previous; sdt.getMessageSnapshot = snapshot; }
});
test('manga inherits past state only, accepts short visible events and transports custom-HTTP instructions', () => {
    const snapshot = sdt.getMessageSnapshot, history = RBQ.api.getRecentMessages, previous = { ...settings._smartDrawTrigger };
    try {
        sdt.getMessageSnapshot = () => ({ mes: '她笑了。' });
        RBQ.api.getRecentMessages = () => [
            { id: 0, mes: '她身穿雨衣。' }, { id: 1, mes: '她笑了。' }, { id: 2, mes: '她换上制服。' }
        ];
        settings._smartDrawTrigger.provider = 'custom';
        settings._smartDrawTrigger.enhancedContext = 'v13'; // Active manga still owns its planner.
        const request = sdt.buildRequestPayload(1, { type: 'auto' }).payload;
        assert.deepEqual(json(request.recentMessages.map(m => m.id)), [0]);
        assert.match(request.mangaInstruction, /漫画前情与本楼规划/);
        assert.match(request.mangaInstruction, /后文换装\/放下物品不能提前/);
        assert.doesNotMatch(request.mangaInstruction, /7 步|七步思维链/);
        const protocol = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters;
        assert.ok(!protocol.required.includes('story_plan'));
        assert.ok(!protocol.properties.segments.items.required.includes('intent'));
        assert.equal(protocol.properties.segments.items.properties.panels.items.properties.beat_ids, undefined);
    } finally { sdt.getMessageSnapshot = snapshot; RBQ.api.getRecentMessages = history; settings._smartDrawTrigger = previous; }
});

const story = '雨停后，小林把折好的信递给阿岚。阿岚接过信，低头读完，眼眶渐渐泛红。片刻后，两人走出车站，看见远处亮起的灯塔。';
const planned = () => {
    const page = fixture();
    page.anchor = { text: '小林把折好的信递给阿岚。' };
    page.intent = '递信、阅读与情绪反应，以阅读为主格，动作连续可在同页承载。';
    page.panels[0].beat_ids = ['B1']; page.panels[1].beat_ids = ['B2']; page.panels[2].beat_ids = ['B3'];
    const ending = fixture();
    ending.anchor = { text: '两人走出车站，看见远处亮起的灯塔。' };
    ending.intent = '转场后用整页揭示灯塔，给相逢留下停顿。';
    ending.page.base = 'splash page, 単一コマ, lighthouse, 2girls';
    ending.panels = [{ ...ending.panels[0], beat_ids: ['B4'] }];
    return { shouldDraw: true, reason: '递信与反应同页，灯塔揭示单独一页，共2页。', story_plan: {
        continuity: '历史明确两人在车站避雨；衣着无可靠记录。', beats: [
            { id: 'B1', source: '小林把折好的信递给阿岚。', decision: 'draw', summary: '递信' },
            { id: 'B2', source: '阿岚接过信，低头读完', decision: 'draw', summary: '阅读来信' },
            { id: 'B3', source: '眼眶渐渐泛红。', decision: 'draw', summary: '情绪变化' },
            { id: 'B4', source: '两人走出车站，看见远处亮起的灯塔。', decision: 'draw', summary: '转场与灯塔揭示' }
        ]
    }, segments: [page, ending] };
};
test('several beats share a page and a reveal gets a splash; plan metadata never enters image captions', () => {
    const result = sdt.normalizeTaggerResult(planned(), [], { content: story });
    assert.equal(result.segments.length, 2);
    assert.equal(result.mangaStoryPlan, undefined);
    assert.equal(result.segments[0].mangaPage.intent, planned().segments[0].intent);
    assert.equal(result.segments[0].reason, planned().segments[0].intent);
    assert.match(result.reason, /^共 2 页漫画/);
    assert.equal(sdt.sanitizeSdtResult(result).mangaStoryPlan, undefined);
    assert.doesNotMatch(result.segments.map(s => s.prompt).join('\n'), /B1|B4|转场后用整页|历史明确/);
});
test('single beat may span adjacent panels or pages without inventing new beats', () => {
    const result = planned();
    result.story_plan.beats = [result.story_plan.beats[0]];
    result.segments.forEach(page => {
        page.anchor = { text: result.story_plan.beats[0].source };
        page.panels.forEach(panel => { panel.beat_ids = ['B1']; });
    });
    assert.equal(sdt.normalizeTaggerResult(result, [], { content: story }).segments.length, 2);
});
test('no-image decisions need no planning ledger', () => {
    const result = { shouldDraw: false, reason: '没有新画面', segments: [] };
    assert.equal(sdt.normalizeTaggerResult(result, [], { content: '好，明天聊。' }).shouldDraw, false);
});
test('valid pages accept absent plans and ignore the reported B6 source mismatch', () => {
    const simple = planned();
    delete simple.story_plan;
    simple.segments.forEach(page => { delete page.intent; page.panels.forEach(panel => { delete panel.beat_ids; }); });
    assert.equal(sdt.normalizeTaggerResult(simple, [], { content: story }).segments.length, 2);
    const oldResponse = planned();
    oldResponse.story_plan.beats.push({ id: 'B6', source: '与正文不完全一致的模型摘录', decision: 'draw', summary: '摘要' });
    oldResponse.story_plan.beats.reverse();
    assert.equal(sdt.normalizeTaggerResult(oldResponse, [], { content: story }).segments.length, 2);
    oldResponse.segments[0].anchor.text = '小林把折叠好的信递给了阿岚';
    assert.equal(sdt.normalizeTaggerResult(oldResponse, [], { content: story }).segments.length, 2, 'anchor wording does not block render');
});
test('render-critical malformed responses still fail without a planning contract', () => {
    for (const result of [{}, null, { shouldDraw: true, segments: [] }, { shouldDraw: false }]) {
        assert.throws(() => sdt.normalizeTaggerResult({ content: JSON.stringify(result) }, [], { content: story }), /shouldDraw\/segments/);
    }
    const broken = planned(); broken.segments[0].panels[0].characters = null;
    assert.throws(() => sdt.normalizeTaggerResult(broken, [], { content: story }), /characters/);
});
test('tool responses accept final pages directly without source or beat references', () => {
    const result = { shouldDraw: true, segments: [fixture()] };
    const wrapped = { choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(result) } }] } }] };
    assert.equal(sdt.normalizeTaggerResult(wrapped, [], { content: story }).segments.length, 1);
});
test('new defaults and every built-in template use explicit nested characters', () => {
    assert.ok(manga.createInitialStudioPanels().every(p => Array.isArray(p.characters)));
    for (const preset of manga.presets) {
        const panels = manga.createStoryboardTemplatePanels(preset);
        assert.ok(panels.every(p => Array.isArray(p.characters)), preset.id);
        assert.equal(panels.length, preset.panels.length);
        settings._mangaMode.studio.panels = panels;
        assert.doesNotThrow(() => manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode)));
    }
});
test('empty DOM cache replaces stale people and retains manga mode for redraw', () => {
    const wrapper = { dataset: {} };
    sdt.cacheWrapperCharacterData(wrapper, sdt.normalizeMangaSegment(fixture()));
    const empty = fixture(); empty.panels = [empty.panels[2]];
    sdt.cacheWrapperCharacterData(wrapper, sdt.normalizeMangaSegment(empty));
    assert.equal(wrapper.dataset.rbqSdtCharData, '[]'); assert.equal(wrapper.dataset.rbqSdtManga, '1');
});
test('legacy output is rejected for new manga requests instead of silently flattening', () => {
    assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [{ scene: 'comic', characters: [] }] }), /旧式人物数组/);
});
test('toggle restores an existing custom preset, off context and absent properties exactly', () => {
    const original = { systemPromptPreset: 'custom', customSystemPrompt: 'my prompt', systemPrompt: 'my prompt', enhancedContext: 'off', multiCharOutput: false };
    settings._smartDrawTrigger = { ...original };
    manga.syncMangaToSdt({ ...settings._mangaMode, enabled: true }, false);
    assert.equal(settings._smartDrawTrigger.multiCharOutput, true);
    manga.syncMangaToSdt({ ...settings._mangaMode, enabled: true }, false);
    manga.syncMangaToSdt({ ...settings._mangaMode, enabled: false }, false);
    const restored = { ...settings._smartDrawTrigger }; delete restored._mangaActive;
    assert.deepEqual(restored, original);
});
test('ordinary SDT schema unchanged when manga is inactive', () => {
    settings._smartDrawTrigger._mangaActive = false; settings._smartDrawTrigger.enhancedContext = 'off';
    const schema = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters.properties.segments.items;
    assert.ok(schema.properties.scene); assert.ok(schema.properties.characters); assert.equal(schema.properties.panels, undefined);
});
(async () => {
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('), sdtSource.indexOf('    function visibleTextNodes(')), sdt);
    const oldSettings = settings._smartDrawTrigger, snapshot = sdt.getMessageSnapshot;
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', provider: 'custom', customUrl: 'https://test.invalid/tagger' };
    sdt.getMessageSnapshot = () => ({ mes: story });
    sdt.checkUrlSafety = () => {}; sdt.logTaggerPayload = () => {};
    sdt.validateStructuredResult = result => result;
    sdt.safeReadJsonResponse = async response => response.json();
    try {
        let requests = [];
        const installResponse = produce => {
            requests = [];
            sdt.smartFetch = async (_url, options) => {
                requests.push(JSON.parse(options.body));
                return { ok: true, json: async () => produce(requests.length) };
            };
        };
        installResponse(() => {
            const result = planned();
            result.story_plan.beats.push({ id: 'B6', source: '不同于正文的引用', decision: 'draw', summary: '摘要' });
            return result;
        });
        assert.equal((await sdt.callTagger(1, { type: 'auto' })).segments.length, 2);
        assert.equal(requests.length, 1, 'B6 mismatch never triggers a second request');
        assert.equal(requests[0].outputSchema.story_plan, undefined);
        assert.equal(requests[0].mangaPlanCorrection, undefined);
        console.log('PASS production custom-HTTP path accepts B6 source mismatch with one call'); passed++;

        installResponse(() => ({ shouldDraw: true, segments: [] }));
        await assert.rejects(sdt.callTagger(1, { type: 'auto' }), /shouldDraw\/segments/);
        assert.equal(requests.length, 1, 'malformed responses are not automatically regenerated');
        let networkCalls = 0;
        sdt.smartFetch = async () => { networkCalls++; throw new Error('network unavailable'); };
        await assert.rejects(sdt.callTagger(1, { type: 'auto' }), /network unavailable/);
        assert.equal(networkCalls, 1);
        console.log('PASS malformed responses and network failures do not trigger a planning retry'); passed++;

        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callOpenAiCompatible('), sdtSource.indexOf('    async function callCustomHttp(')), sdt);
        Object.assign(sdt, {
            normalizeBaseUrl: value => value, getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {},
            buildThinkingParams: () => ({}), DRAW_SPEC_TOOL_RULE: 'Submit via generate_draw_spec'
        });
        Object.assign(settings._smartDrawTrigger, { provider: 'openai', openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'test', squashMessages: false });
        for (const toolCallMode of [false, true]) {
            settings._smartDrawTrigger.toolCallMode = toolCallMode;
            let calls = 0;
            sdt.callApiWithJsonFallback = async (_url, _options, body) => {
                calls++;
                assert.equal(body.messages[0].role, 'system');
                assert.equal(body.messages[0].content.split('你是漫画分镜导演').length - 1, 1);
                assert.equal(body.messages[0].content.split('【漫画前情与本楼规划】').length - 1, 1);
                const request = JSON.parse(body.messages[1].content);
                assert.equal(request.mangaInstruction, undefined);
                if (toolCallMode) assert.ok(!body.tools[0].function.parameters.required.includes('story_plan'));
                const output = { shouldDraw: true, segments: planned().segments };
                assert.equal(request.outputSchema.story_plan, undefined);
                assert.equal(request.mangaPlanCorrection, undefined);
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: toolCallMode
                    ? { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(output) } }] }
                    : { content: JSON.stringify(output) } }] }) };
            };
            assert.equal((await sdt.callTagger(1, { type: 'auto' })).segments.length, 2);
            assert.equal(calls, 1);
        }
        console.log('PASS production OpenAI JSON and tool requests render final pages in one call'); passed++;
    } finally { settings._smartDrawTrigger = oldSettings; sdt.getMessageSnapshot = snapshot; }

    settings._smartDrawTrigger.openaiBaseUrl = 'https://test.invalid/v1';
    settings._smartDrawTrigger.openaiModel = 'test';
    const before = JSON.stringify(settings._mangaMode.studio.panels);
    manga.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(manga.requestStudioPanels(settings._mangaMode, 'one panel', 'story', 1), /HTTP 503/);
    manga.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"panels":[]}' } }] }) });
    await assert.rejects(manga.requestStudioPanels(settings._mangaMode, 'one panel', 'story', 1), /画格数量/);
    assert.equal(JSON.stringify(settings._mangaMode.studio.panels), before);
    await assert.rejects(manga.callLlmStoryboardParser('story', '4koma', 'zh-hans', '3'), /经典四格/);
    console.log('PASS Studio failures preserve drafts and incompatible 4-koma count is rejected'); passed++;
    console.log(`\n${passed} manga regression tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
