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
const silentConsole = { info() {}, warn() {}, log() {}, error() {} };
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
// Exercise the real chat-scoped profile store, updater and wardrobe archiver, not a memory mock.
let memoryChat = 'manga-memory-test', profileRefreshes = 0, profileSaves = 0;
Object.assign(sdt, { getChatKey: () => memoryChat, save: () => { profileSaves++; }, refreshCharacterProfileListUi: () => { profileRefreshes++; } });
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function isJunkCharacterName('), sdtSource.indexOf('    function getActiveCharacterName(')), sdt);
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function getCharacterProfiles('), sdtSource.indexOf('    function addCharacterWardrobeOutfit(')), sdt);
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
test('misplaced bubble header is moved before literal Text, without rewriting dialogue', () => {
    const wrong = 'top panel, girl, holding envelope, Text: 通常吹き出し, Layout: 縦書き, Text: 「信收到了。」';
    const expected = 'top panel, girl, holding envelope, BubbleType: 通常吹き出し, Layout: 縦書き\nText: 信收到了。';
    assert.equal(manga.sanitizeMangaPositivePrompt(wrong), expected);
    assert.equal(manga.sanitizeMangaPositivePrompt(expected), expected);
    const page = fixture(); page.panels[0].characters[0].positive = wrong;
    assert.equal(manga.compileMangaPage(page).characters[0].caption, expected);
    const shout = manga.sanitizeMangaPositivePrompt('girl, Text: 叫び吹き出し, 右上, Layout: 縦書き, Text: 小心！');
    assert.match(shout, /BubbleType: 叫び吹き出し, 右上, Layout: 縦書き\nText: 小心！$/);
});
test('literal protocol words inside speech stay intact and independent quoted bubbles retain their order', () => {
    const actualSpeech = '请在纸上写 Text: Hello, Layout: horizontal。';
    const caption = manga.sanitizeMangaPositivePrompt('girl, Text: ' + actualSpeech);
    assert.equal(caption.slice(caption.indexOf('Text: ') + 6), actualSpeech);
    assert.equal(manga.splitMangaText('girl, Text: “第一句。”\n\n「第二句！」').text, '第一句。\n\n第二句！');
    assert.equal(manga.splitMangaText('girl, Text: 他说“收到”，我点头。').text, '他说“收到”，我点头。');
    assert.equal(manga.splitMangaText('girl, Text: “甲”“乙”').text, '“甲”“乙”');
    assert.equal(manga.splitMangaText('girl, Text: Layout: 是单词，Text: 也是。').text, 'Layout: 是单词，Text: 也是。');
});
test('non-person bubble formatting repairs locally and cached captions are repaired by either hook order', () => {
    const page = fixture();
    page.page.non_character = 'Text: BubbleType: ナレーション枠, Layout: 横書き, Text: 「第二天」';
    page.panels[2].non_character = 'bottom panel, Text: SFX: 擬音, 吹き出しなし, Text: 咔哒';
    const compiled = manga.compileMangaPage(page);
    assert.match(compiled.base, /BubbleType: ナレーション枠, Layout: 横書き/);
    assert.match(compiled.base, /Text: 第二天\n\n咔哒$/);
    const bad = 'girl, holding envelope, Text: 通常吹き出し, Layout: 縦書き, Text: “收好。”';
    const run = order => {
        sdt.prepareNaiCharData({ mangaPage: true, characters: [{ caption: bad, uc: '', center: { x: 0.5, y: 0.5 } }] });
        let p = payload('comic');
        for (const hook of order) p = hook(p);
        return p;
    };
    const p = run([sdtHook, mangaHook]);
    assert.deepEqual(json(p), json(run([mangaHook, sdtHook])));
    assert.equal(p.parameters.v4_prompt.caption.char_captions[0].char_caption,
        'girl, holding envelope, BubbleType: 通常吹き出し, Layout: 縦書き\nText: 收好。');
});
test('SDT text and tool results use nested compiler and bypass legacy identity overwrite', () => {
    const message = { shouldDraw: true, segments: [fixture()] };
    const plain = sdt.normalizeTaggerResult({ choices: [{ message: { content: JSON.stringify(message) } }] });
    const tool = sdt.normalizeTaggerResult({ choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(message) } }] } }] });
    assert.equal(plain.segments[0].characters.length, 4);
    assert.deepEqual(json(plain.segments[0].characters), json(tool.segments[0].characters));
    assert.equal(plain.segments[0].characters[0].caption, fixture().panels[0].characters[0].positive.replace(', Text:', '\nText:'));
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
test('manual editor preserves zero coordinates and writes them back into manga structure', () => {
    const segment = sdt.normalizeMangaSegment(fixture());
    const editor = vm.createContext({ segResult: segment, isMultiChar: true, sdtParseCoord: sdt.sdtParseCoord,
        modal: { querySelector: () => ({ value: segment.scene }), querySelectorAll: () => [{ dataset: { index: '0' },
            querySelector: selector => ({ value: selector.includes('pad-') ? '0' : selector.includes('caption') ? segment.characters[0].caption : '' })
        }] }
    });
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('        function gatherUpdatedSegment('), sdtSource.indexOf('        function syncUpdatedSegmentState(')), editor);
    const edited = editor.gatherUpdatedSegment('characters');
    assert.equal(edited.mangaUseCoords, true);
    assert.deepEqual(json(edited.mangaPage.panels[0].characters[0].center), { x: 0, y: 0 });
    assert.equal(manga.compileMangaPage(edited.mangaPage).characters[0].center.x, 0);
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
test('Studio counts unique explicit subjects across crops, without reading action targets or dialogue', () => {
    const store = settings._mangaMode, previous = store.studio.panels;
    try {
        store.studio.panels = [
            { characters: [
                { character_id: 'C1', positive: '1.2::girl::, holding book', negative: '' },
                { character_id: 'C2', positive: 'boy, looking at girl, Text: woman', negative: '' }
            ] },
            { characters: [{ character_id: 'C1', positive: 'hands, holding book', negative: '' }] }
        ];
        let page = manga.buildStudioPage(store);
        assert.match(page.page.base, /1girl, 1boy/);
        assert.doesNotMatch(page.page.base, /2girls|other/);
        assert.equal(manga.compileMangaPage(page).characters.length, 3);
        store.studio.panels[1].characters[0].positive = 'boy, hands';
        assert.doesNotMatch(manga.buildStudioPage(store).page.base, /\d+(?:girl|boy|other)/, 'conflicting identity must not manufacture a count');
        store.studio.panels = [{ characters: [{ character_id: 'C3', positive: 'looking at girl, Text: boy', negative: '' }] }];
        assert.doesNotMatch(manga.buildStudioPage(store).page.base, /\d+(?:girl|boy|other)|no humans/);
        store.studio.panels = [{ characters: [] }];
        assert.match(manga.buildStudioPage(store).page.base, /no humans/);
    } finally { store.studio.panels = previous; }
});
test('tool schema exposes optional manual positioning and compiler accepts page-edge coordinates', () => {
    const schema = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters.properties.segments.items;
    assert.deepEqual(json(schema.properties.position_mode.enum), ['auto', 'manual']);
    assert.ok(!schema.required.includes('position_mode'));
    const slot = schema.properties.panels.items.properties.characters.items;
    assert.equal(slot.properties.center.properties.x.minimum, 0);
    assert.equal(slot.properties.center.properties.y.maximum, 1);
    assert.ok(!slot.required.includes('center'));
    schema.required.push('mutated-test');
    assert.ok(!sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters.properties.segments.items.required.includes('mutated-test'));
    const page = fixture(); page.position_mode = 'manual';
    page.panels.forEach(p => p.characters.forEach(c => { c.center = { x: 0, y: 1 }; }));
    const compiled = manga.compileMangaPage(page);
    assert.equal(compiled.useCoords, true);
    assert.deepEqual(json(compiled.characters[0].center), { x: 0, y: 1 });
    page.panels[0].characters[0].center.x = -0.1;
    assert.throws(() => manga.compileMangaPage(page), /坐标/);
    delete page.position_mode;
    assert.equal(manga.compileMangaPage(page).useCoords, false);
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
test('monochrome converts explicit character colors at dispatch without changing dialogue, names or saved captions', () => {
    const segment = sdt.normalizeMangaSegment(fixture());
    const original = 'top panel, girl, silver hair in high bun, 1.2::deep purple qipao, {purple eyes}::, blue_ribbon, Red (Series), red panda, Text: purple eyes, 红色的信。';
    segment.characters[0].caption = original;
    function run(order) {
        sdt.prepareNaiCharData(segment);
        let request = payload('artist:blue, full color, comic');
        for (const hook of order) request = hook(request);
        return request;
    }
    const first = run([sdtHook, mangaHook]), second = run([mangaHook, sdtHook]);
    assert.deepEqual(json(first), json(second));
    const actual = first.parameters.v4_prompt.caption.char_captions[0].char_caption;
    assert.match(actual, /light grey hair in high bun/);
    assert.match(actual, /1\.2::dark grey qipao, \{grey eyes\}::/);
    assert.match(actual, /grey ribbon, Red \(Series\), red panda/);
    assert.match(actual, /Text: purple eyes, 红色的信。$/);
    assert.match(first.input, /artist:blue, full color/);
    assert.equal(segment.characters[0].caption, original);
    const savedStyle = settings._mangaMode.style;
    try {
        for (const style of ['soft_color', 'custom']) {
            settings._mangaMode.style = style;
            assert.match(run([mangaHook, sdtHook]).parameters.v4_prompt.caption.char_captions[0].char_caption, /deep purple qipao/);
        }
    } finally { settings._mangaMode.style = savedStyle; }
});
test('selected panel borders reach the final payload once regardless of hook order', () => {
    const savedGutter = settings._mangaMode.gutter;
    try {
        for (const [gutter, expected] of [['bleed', 'top-bottom bleed'], ['framed', 'fully framed panels'], ['black_line', '太い黒い仕切り線'], ['splash', '全面裁ち落とし']]) {
            settings._mangaMode.gutter = gutter;
            const result = mangaHook(mangaHook(payload('comic, Text: 保留原句')));
            assert.equal(result.input.split(expected).length - 1, 1);
            assert.equal(result.parameters.v4_prompt.caption.base_caption, result.input);
            assert.match(result.input, /Text: 保留原句$/);
            if (gutter === 'bleed') assert.doesNotMatch(result.input, /white border/);
        }
    } finally { settings._mangaMode.gutter = savedGutter; }
});
test('cached manga redraw retains V5 while manga is disabled; unrelated requests stay untouched', () => {
    const wasEnabled = settings._mangaMode.enabled;
    try {
        settings._mangaMode.enabled = false;
        const untouched = payload('ordinary image');
        assert.deepEqual(json(mangaHook(untouched)), json(payload('ordinary image')));
        sdt.prepareNaiCharData(sdt.normalizeMangaSegment(fixture()));
        const redrawn = mangaHook(sdtHook(payload('comic')));
        assert.equal(redrawn.model, 'nai-diffusion-5-full');
        assert.equal(redrawn.parameters.v4_prompt.caption.char_captions.length, 4);
    } finally { settings._mangaMode.enabled = wasEnabled; }
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
function withMemory(run) {
    const prior = settings._smartDrawTrigger;
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', characterMemoryEnabled: true, characterProfiles: {} };
    profileRefreshes = 0; profileSaves = 0; memoryChat = 'manga-memory-test';
    try { run(); } finally { settings._smartDrawTrigger = prior; memoryChat = 'manga-memory-test'; }
}
const memoryResponse = () => ({ shouldDraw: true, segments: [fixture(), fixture()], character_memory: [
    { name: 'Ami (original)', base: 'girl, long black hair, green eyes', outfit: 'white blouse, blue skirt, brown shoes' },
    { name: 'Mei', base: 'girl, short brown hair, blue eyes', outfit: 'red dress, black boots' }
] });
test('first-time card reference uses the same collector in ordinary and manga requests and respects the toggle', () => withMemory(() => {
    const previousCollector = sdt.collectCharacterCardInfo, previousContext = RBQ.api.getContext;
    const card = { name: 'Ami', description: '成年女性，中国籍，银色长发。', character_book: { entries: [
        { keys: ['classroom'], content: '白色长袖衬衫。' }, { keys: ['unmatched'], content: '不应注入' }
    ] } };
    RBQ.api.getContext = () => ({ characterId: 0, characters: [card] });
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function collectCharacterCardInfo('), sdtSource.indexOf('    async function importCharacterFromCurrentCard(')), sdt);
    try {
        for (const mangaActive of [false, true]) {
            Object.assign(settings._smartDrawTrigger, { _mangaActive: mangaActive, enhancedContext: mangaActive ? 'v_manga' : 'off', injectCharacterCard: true, characterMemoryEnabled: false });
            const cards = sdt.collectCharacterCardInfo('classroom');
            assert.equal(cards[0].description, card.description);
            assert.equal(cards[0].characterBookEntries.length, 1);
            assert.equal(cards[0].characterBookEntries[0].content, '白色长袖衬衫。');
            assert.match(sdt.getSystemPromptWithPresets(settings._smartDrawTrigger, true), /角色卡信息参考指令/);
        }
        for (const provider of ['openai', 'custom']) {
            settings._smartDrawTrigger.provider = provider;
            for (const memoryEnabled of [false, true]) {
                settings._smartDrawTrigger.characterMemoryEnabled = memoryEnabled;
                const request = sdt.buildRequestPayload(1, { type: 'auto' }).payload;
                assert.equal(request.characterCardInfo[0].description, card.description);
                const prompt = provider === 'custom' ? request.mangaInstruction : sdt.getSystemPromptWithPresets(settings._smartDrawTrigger, true);
                assert.match(prompt, /漫画角色卡信息参考指令/);
                assert.match(prompt, /panels\[\]\.characters\[\]\.positive/);
                assert.equal(!!request.outputSchema.character_memory, memoryEnabled);
            }
        }
        settings._smartDrawTrigger.injectCharacterCard = false;
        assert.equal(sdt.buildRequestPayload(1, { type: 'auto' }).payload.characterCardInfo, undefined);
        assert.doesNotMatch(sdt.getSystemPromptWithPresets(settings._smartDrawTrigger, true), /漫画角色卡信息参考指令/);
        settings._smartDrawTrigger.injectCharacterCard = true;
        sdt.updateCharacterProfile('Ami', '', 'white shirt');
        assert.equal(sdt.collectCharacterCardInfo('classroom').length, 1, 'outfit-only records must still receive card appearance');
        sdt.updateCharacterProfile('Ami', 'girl, silver hair', 'white shirt');
        assert.equal(sdt.collectCharacterCardInfo('classroom').length, 0);
    } finally { sdt.collectCharacterCardInfo = previousCollector; RBQ.api.getContext = previousContext; }
}));
test('manga creates chat-scoped characters once across panels/pages and archives initial clothes', () => withMemory(() => {
    const response = memoryResponse(), before = response.segments[0].panels[0].characters[0].positive;
    const output = sdt.normalizeTaggerResult(response, [], { content: story, messageId: 3 });
    const profiles = sdt.getCharacterProfiles();
    assert.deepEqual(Object.keys(profiles), ['Ami', 'Mei']);
    assert.equal(profileRefreshes, 2);
    assert.ok(profileSaves >= 2);
    assert.equal(profiles.Ami.baseTags, response.character_memory[0].base);
    assert.equal(profiles.Ami.wardrobe.length, 1);
    assert.equal(profiles.Ami.currentOutfit, response.character_memory[0].outfit);
    assert.equal(output.segments[0].characters[0].caption, before.replace(', Text:', '\nText:'));
    assert.doesNotMatch(output.segments[0].characters[0].caption, /brown shoes/);
    const nextRequest = sdt.buildRequestPayload(4, { type: 'auto' }).payload;
    assert.equal(nextRequest.characterMemory.find(p => p.name === 'Ami').base, profiles.Ami.baseTags);
    assert.match(sdt.getSystemPromptWithPresets(settings._smartDrawTrigger), /long black hair/);
    memoryChat = 'another-chat';
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
}));
test('standalone manga reference reader preserves profile colors and honors memory and card switches', () => withMemory(() => {
    sdt.updateCharacterProfile('Ami', 'girl, purple eyes', 'blue coat');
    const before = JSON.stringify(sdt.getCharacterProfiles());
    const references = sdt.collectMangaReferenceData('story');
    assert.equal(references.characterMemory[0].base, 'girl, purple eyes');
    assert.equal(references.characterMemory[0].outfit, 'blue coat');
    assert.equal(JSON.stringify(sdt.getCharacterProfiles()), before);
    settings._smartDrawTrigger.characterMemoryEnabled = false;
    assert.equal(sdt.collectMangaReferenceData('story').characterMemory, undefined);
}));
test('closeups preserve full wardrobe; explicit outfit updates preserve identity and ignore older floors', () => withMemory(() => {
    sdt.normalizeTaggerResult(memoryResponse(), [], { content: story, messageId: 3 });
    const base = sdt.getCharacterProfile('Ami').baseTags;
    const closeup = memoryResponse();
    closeup.segments[0].panels[0].characters[0].positive = 'girl, face close-up, collar, crying, Text: 别走';
    closeup.character_memory = [{ name: 'ami', base: 'girl, short pink hair', outfit: '' }];
    sdt.normalizeTaggerResult(closeup, [], { content: story, messageId: 4 });
    assert.equal(sdt.getCharacterProfile('Ami').baseTags, base);
    assert.equal(sdt.getCharacterProfile('Ami').currentOutfit, 'white blouse, blue skirt, brown shoes');
    closeup.character_memory[0].outfit = 'black coat, white shirt, dark trousers, boots';
    sdt.normalizeTaggerResult(closeup, [], { content: story, messageId: 8 });
    const profile = sdt.getCharacterProfile('Ami');
    assert.equal(profile.currentOutfit, closeup.character_memory[0].outfit);
    assert.equal(profile.wardrobe.length, 2);
    sdt.normalizeTaggerResult(memoryResponse(), [], { content: story, messageId: 3 });
    assert.equal(profile.currentOutfit, closeup.character_memory[0].outfit);
    assert.equal(profile.wardrobe.length, 2);
    assert.equal(profile.baseTags, base);
}));
test('automatic updates keep identity locked; explicit re-extraction replaces base with backup and preserves plot clothes', () => withMemory(() => {
    sdt.updateCharacterProfile('Ami', 'girl, silver hair', 'navy coat, black trousers');
    const profile = sdt.getCharacterProfile('Ami');
    profile.currentOutfitId = profile.wardrobe[0].id;
    profile.mangaOutfitMessageId = 8;
    const wardrobe = JSON.stringify(profile.wardrobe), outfitId = profile.currentOutfitId;
    sdt.updateCharacterProfile('Ami', 'girl, black hair', '');
    assert.equal(profile.baseTags, 'girl, silver hair');
    assert.equal(profile.previousBaseTags, undefined);
    sdt.updateCharacterProfile('Ami', 'girl, long silver hair, purple eyes', 'white shirt', null, true, { replaceBase: true, preserveOutfit: true });
    assert.equal(profile.baseTags, 'girl, long silver hair, purple eyes');
    assert.equal(profile.previousBaseTags, 'girl, silver hair');
    assert.equal(profile.currentOutfit, 'navy coat, black trousers');
    assert.equal(profile.currentOutfitId, outfitId);
    assert.equal(profile.mangaOutfitMessageId, 8);
    assert.equal(JSON.stringify(profile.wardrobe), wardrobe);
}));
test('memory ignores IDs, absent people and dialogue-contaminated fields; duplicate updates save once', () => withMemory(() => {
    const response = memoryResponse();
    response.segments[0].panels[0].characters.push({ character_id: 'C3', name: 'C3', positive: 'girl', negative: '' });
    response.character_memory.push(
        { name: 'C3', base: 'girl', outfit: 'shirt' },
        { name: 'Panel 1', base: 'girl', outfit: 'shirt' },
        { name: 'Not in any panel', base: 'girl', outfit: 'shirt' },
        { name: '__proto__', base: 'girl', outfit: 'shirt' },
        { name: 'Ami', base: 'girl, Text: 台词不能建档', outfit: 'BubbleType: 通常吹き出し' }
    );
    sdt.normalizeTaggerResult(response, [], { content: story });
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), ['Ami', 'Mei']);
    assert.equal(profileRefreshes, 2);
    assert.doesNotMatch(sdt.getCharacterProfile('Ami').baseTags, /Text/);
    assert.doesNotMatch(sdt.getCharacterProfile('Ami').currentOutfit, /BubbleType/);
}));
test('memory is requested only when enabled and missing metadata never blocks valid pages', () => withMemory(() => {
    let schema = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters;
    assert.ok(schema.required.includes('character_memory'));
    assert.ok(sdt.getMangaOutputSchema().character_memory);
    const plain = memoryResponse(); delete plain.character_memory;
    assert.equal(sdt.normalizeTaggerResult(plain, [], { content: story }).segments.length, 2);
    assert.equal(profileRefreshes, 0);
    settings._smartDrawTrigger.characterMemoryEnabled = false;
    schema = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters;
    assert.equal(schema.properties.character_memory, undefined);
    assert.equal(sdt.getMangaOutputSchema().character_memory, undefined);
    sdt.normalizeTaggerResult(memoryResponse(), [], { content: story });
    assert.equal(profileRefreshes, 0);
}));
test('invalid later page causes no partial memory writes and tool results create the same profiles', () => withMemory(() => {
    const response = memoryResponse(); response.segments[1].panels[0].characters = null;
    assert.throws(() => sdt.normalizeTaggerResult(response, [], { content: story }), /characters/);
    assert.equal(profileRefreshes, 0);
    const wrapped = { choices: [{ message: { tool_calls: [{ function: {
        name: 'generate_draw_spec', arguments: JSON.stringify(memoryResponse())
    } }] } }] };
    sdt.normalizeTaggerResult(wrapped, [], { content: story });
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), ['Ami', 'Mei']);
    assert.equal(profileRefreshes, 2);
}));
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

        settings._smartDrawTrigger.characterMemoryEnabled = true;
        installResponse(() => memoryResponse());
        await sdt.callTagger(1, { type: 'auto' });
        assert.equal(requests.length, 1);
        assert.ok(requests[0].outputSchema.character_memory);
        assert.match(requests[0].mangaInstruction, /漫画角色记忆/);
        assert.ok(requests[0].mangaInstruction.includes(sdt.getCharacterMemoryTagSpecification()));
        assert.equal(sdt.getCharacterProfile('Ami').baseTags, memoryResponse().character_memory[0].base);
        console.log('PASS custom-HTTP creates reusable profiles in the existing single request'); passed++;

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
                assert.match(body.messages[0].content, /漫画角色记忆/);
                assert.ok(body.messages[0].content.includes(sdt.getCharacterMemoryTagSpecification()));
                const request = JSON.parse(body.messages[1].content);
                assert.equal(request.mangaInstruction, undefined);
                if (toolCallMode) assert.ok(!body.tools[0].function.parameters.required.includes('story_plan'));
                if (toolCallMode) assert.ok(body.tools[0].function.parameters.required.includes('character_memory'));
                const output = memoryResponse();
                assert.ok(request.outputSchema.character_memory);
                assert.equal(request.outputSchema.story_plan, undefined);
                assert.equal(request.mangaPlanCorrection, undefined);
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: toolCallMode
                    ? { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(output) } }] }
                    : { content: JSON.stringify(output) } }] }) };
            };
            assert.equal((await sdt.callTagger(1, { type: 'auto' })).segments.length, 2);
            assert.equal(calls, 1);
            assert.ok(sdt.getCharacterProfile('Mei').baseTags);
        }
        console.log('PASS production OpenAI JSON and tool requests render final pages in one call'); passed++;
    } finally { settings._smartDrawTrigger = oldSettings; sdt.getMessageSnapshot = snapshot; }

    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function parseTaggerSegment('), sdtSource.indexOf('    RBQ.api.parseWithTagger =')), sdt);
    const oldCollector = sdt.collectCharacterCardInfo, previousTestSettings = settings._smartDrawTrigger;
    const testCard = [{ name: 'Ami', description: '成年女性，中国籍，银色长发。', characterBookEntries: [{ keys: ['library'], content: '蓝色外套。' }] }];
    try {
        settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', injectCharacterCard: true,
            customUrl: 'https://test.invalid', openaiBaseUrl: 'https://test.invalid', openaiModel: 'test', squashMessages: false };
        sdt.collectCharacterCardInfo = (content, recent) => { assert.equal(content, 'library'); assert.equal(recent.length, 0); return testCard; };
        for (const provider of ['custom', 'openai']) {
            settings._smartDrawTrigger.provider = provider;
            let calls = 0;
            const checkRequest = body => {
                calls++;
                const request = provider === 'custom' ? body : JSON.parse(body.messages[1].content);
                assert.deepEqual(request.characterCardInfo, testCard);
                assert.match(provider === 'custom' ? request.mangaInstruction : body.messages[0].content, /漫画角色卡信息参考指令/);
                return { ok: true, json: async () => ({ shouldDraw: true, segments: [fixture()] }) };
            };
            sdt.smartFetch = async (_url, options) => checkRequest(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => checkRequest(body);
            assert.ok((await sdt.parseTaggerSegment('library')).segment.mangaPage);
            assert.equal(calls, 1);
        }
        sdt.prepareNaiCharData(null);
        console.log('PASS test-draw entry includes card references in both provider paths with one request'); passed++;
    } finally { sdt.collectCharacterCardInfo = oldCollector; settings._smartDrawTrigger = previousTestSettings; }

    const drawerPage = fixture(); drawerPage.position_mode = 'manual';
    drawerPage.panels.forEach(p => p.characters.forEach(c => { c.center = { x: 0, y: 1 }; }));
    const drawerSegment = sdt.normalizeMangaSegment(drawerPage);
    const emptyPage = fixture(); emptyPage.panels = [emptyPage.panels[2]];
    const emptySegment = sdt.normalizeMangaSegment(emptyPage);
    const chat = [{ mes: 'story', extra: { rbq_sdt: { key: 'k', segments: [drawerSegment] } } },
        { mes: 'empty', extra: { rbq_sdt: { key: 'e', ...emptySegment } } }];
    let generatedRequest;
    const drawerApi = { api: { getContext: () => ({ chat }), generateImage: async prompt => {
        generatedRequest = sdtHook(payload(prompt, [{ char_caption: 'stale host person' }])); return { url: 'test.png' };
    } } };
    const drawer = vm.createContext({ RBQ: drawerApi, window: { RBQ: drawerApi }, getStore: () => ({}),
        getFinalPrompt: sdt.getFinalPrompt, prepareNaiCharData: sdt.prepareNaiCharData, console,
        parseMessageStorySections: () => [], cleanDialogueForComic: value => value,
        normalizePromptKey: value => String(value || ''), extractHostPromptsFromMessage: () => [],
        markSegmentAutoGenerated() {}, renderStoryboardDrawerContent() {}, document: { getElementById: () => null },
        HTMLElement: class {}, PLUGIN_NAME: 'test', toastr: { success() {}, error: text => { throw new Error(text); } }
    });
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function collectChatStoryboardTimeline('), sdtSource.indexOf('    async function openStoryboardDrawer(')), drawer);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function runDrawerPanelGeneration('), sdtSource.indexOf('    function renderStoryboardDrawerContent(')), drawer);
    const drawerItems = await drawer.collectChatStoryboardTimeline();
    assert.equal(drawerItems.length, 2);
    assert.equal(drawerItems[0].prompt, drawerSegment.scene, 'flattened person captions must not also enter base');
    await drawer.runDrawerPanelGeneration(drawerItems[0], { innerHTML: 'Generate' });
    assert.equal(generatedRequest.parameters.v4_prompt.use_coords, true);
    assert.equal(generatedRequest.parameters.v4_prompt.caption.char_captions[0].centers[0].x, 0);
    await drawer.runDrawerPanelGeneration(drawerItems[1], { innerHTML: 'Generate' });
    assert.equal(generatedRequest.parameters.v4_prompt.caption.char_captions.length, 0);
    console.log('PASS drawer redraw preserves manga structure and coordinates and clears empty-page characters'); passed++;

    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function importCharacterFromCurrentCard('), sdtSource.indexOf('    const TEST_PRESETS')), sdt);
    const priorContext = RBQ.api.getContext, priorSettings = settings._smartDrawTrigger;
    const button = { disabled: false, innerHTML: 'Import' }, notices = [];
    Object.assign(sdt, {
        PLUGIN_NAME: 'SDT test', document: { getElementById: () => button },
        toastr: { warning: text => notices.push(text), error: text => notices.push(text), success: text => notices.push(text) }
    });
    const card = { name: 'Ami (original)', description: '成年女性，银色长发、紫色眼睛，平时穿白衬衫。', avatar: 'ami.png' };
    RBQ.api.getContext = () => ({ characterId: 0, characters: [card] });
    settings._smartDrawTrigger = { provider: 'custom', customUrl: 'https://test.invalid/tagger', characterProfiles: {} };
    let importCalls = 0;
    const extracted = { base: 'girl, mature female, silver hair, long hair, purple eyes', outfit: 'white shirt, collared shirt' };
    const importResponse = value => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
    try {
        sdt.updateCharacterProfile('Ami', 'girl, silver hair', 'navy coat, black trousers');
        const wardrobeBefore = JSON.stringify(sdt.getCharacterProfile('Ami').wardrobe);
        sdt.smartFetch = async (_url, options) => {
            importCalls++;
            const body = JSON.parse(options.body);
            assert.ok(body.messages[0].content.includes(sdt.getCharacterMemoryTagSpecification()));
            assert.ok(body.messages[1].content.includes(card.description));
            return importResponse(extracted);
        };
        const imported = await sdt.importCharacterFromCurrentCard();
        assert.equal(imported.baseTags, extracted.base);
        assert.equal(imported.previousBaseTags, 'girl, silver hair');
        assert.equal(imported.currentOutfit, 'navy coat, black trousers');
        assert.equal(JSON.stringify(imported.wardrobe), wardrobeBefore);
        assert.equal(importCalls, 1);
        assert.equal(button.disabled, false); assert.equal(button.innerHTML, 'Import');
        console.log('PASS card re-extraction uses the shared specification and refreshes appearance without resetting plot clothing'); passed++;

        const saved = JSON.stringify(sdt.getCharacterProfiles());
        for (const failure of [
            async () => { throw new Error('network failed'); },
            async () => ({ ok: false, status: 503, json: async () => extracted }),
            async () => importResponse({ base: '', outfit: 'white shirt' }),
            async () => importResponse({ base: ['girl'], outfit: '' }),
            async () => importResponse({ base: 'girl', outfit: { invalid: true } }),
            async () => ({ ok: true, json: async () => ({ content: 'not JSON' }) })
        ]) {
            importCalls = 0;
            sdt.smartFetch = async () => { importCalls++; return failure(); };
            assert.equal(await sdt.importCharacterFromCurrentCard(), false);
            assert.equal(importCalls, 1);
            assert.equal(JSON.stringify(sdt.getCharacterProfiles()), saved);
            assert.equal(button.disabled, false); assert.equal(button.innerHTML, 'Import');
        }
        settings._smartDrawTrigger.customUrl = '';
        importCalls = 0;
        assert.equal(await sdt.importCharacterFromCurrentCard(), false);
        assert.equal(importCalls, 0);
        assert.equal(JSON.stringify(sdt.getCharacterProfiles()), saved);
        assert.ok(notices.some(text => text.includes('配置')));
        console.log('PASS failed or unconfigured card extraction never saves raw description or alters existing memory'); passed++;

        Object.assign(settings._smartDrawTrigger, { provider: 'openai', openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'test', characterProfiles: {} });
        importCalls = 0;
        sdt.callApiWithJsonFallback = async (_url, _options, body) => {
            importCalls++;
            assert.ok(body.messages[0].content.includes(sdt.getCharacterMemoryTagSpecification()));
            return importResponse(extracted);
        };
        const created = await sdt.importCharacterFromCurrentCard();
        assert.equal(importCalls, 1);
        assert.equal(created.baseTags, extracted.base);
        assert.equal(created.currentOutfit, extracted.outfit);
        assert.equal(created.wardrobe.length, 1);
        assert.equal(created.previousBaseTags, undefined);
        console.log('PASS OpenAI card import uses the same specification and initializes default clothing for a new profile'); passed++;
    } finally { settings._smartDrawTrigger = priorSettings; RBQ.api.getContext = priorContext; }

    const workshopSource = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
    let importHandler, rendered = 0, workshopResult = false;
    const workshopDraft = { displayName: 'Ami', baseTags: 'unsaved hair edit', wardrobe: [] };
    const workshopButton = { disabled: false, innerHTML: 'Import' };
    const workshopApi = { api: { importCharacterFromCurrentCard: async () => workshopResult } };
    const workshop = vm.createContext({
        RBQ: workshopApi, window: { RBQ: workshopApi }, draft: workshopDraft,
        mask: { querySelector: () => ({ addEventListener: (_event, fn) => { importHandler = fn; } }) },
        render: () => { rendered++; }, getProfile: () => { throw new Error('must not reload stale profile'); },
        toastr: { error: text => { throw new Error(text); } }, PLUGIN_NAME: 'Workshop'
    });
    vm.runInContext(workshopSource.slice(workshopSource.indexOf("            mask.querySelector('#cw-ce-import-card')?.addEventListener"), workshopSource.indexOf('            // Test solo portrait with Perspective')), workshop);
    await importHandler({ currentTarget: workshopButton });
    assert.equal(workshopDraft.baseTags, 'unsaved hair edit');
    assert.equal(rendered, 0); assert.equal(workshopButton.disabled, false);
    workshopResult = { displayName: 'Ami', baseTags: extracted.base, previousBaseTags: 'girl, silver hair', currentOutfit: 'navy coat', wardrobe: [{ id: 'w1', outfit: 'navy coat' }] };
    await importHandler({ currentTarget: workshopButton });
    assert.equal(workshopDraft.baseTags, extracted.base);
    assert.equal(workshopDraft.previousBaseTags, 'girl, silver hair');
    assert.equal(workshopDraft.currentOutfit, 'navy coat');
    assert.equal(rendered, 1); assert.equal(workshopButton.innerHTML, 'Import');
    console.log('PASS workshop keeps unsaved draft on failure and loads the returned profile and backup on success'); passed++;

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
    const studioReferences = { characterCardInfo: testCard, characterMemory: [{ name: 'Mei', base: 'girl, short hair', outfit: 'white shirt' }] };
    RBQ.api.collectMangaReferenceData = content => { assert.equal(content, 'story'); return studioReferences; };
    for (const baseUrl of ['https://test.invalid/v1', 'https://test.invalid/v1/chat/completions/']) {
        settings._smartDrawTrigger.openaiBaseUrl = baseUrl;
        manga.fetch = async (url, options) => {
            assert.equal(url, 'https://test.invalid/v1/chat/completions');
            const body = JSON.parse(options.body), userInput = JSON.parse(body.messages[1].content);
            assert.deepEqual(userInput, { currentMessage: 'story', ...studioReferences });
            assert.match(body.messages[0].content, /characterCardInfo\/characterMemory/);
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ panels: [fixture().panels[0]] }) } }] }) };
        };
        assert.equal((await manga.requestStudioPanels(settings._mangaMode, 'one panel', 'story', 1)).length, 1);
    }
    delete RBQ.api.collectMangaReferenceData;
    console.log('PASS Studio includes card and memory references and accepts full chat-completions endpoints'); passed++;
    console.log(`\n${passed} manga regression tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
