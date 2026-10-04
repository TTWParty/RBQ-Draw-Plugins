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
        studio: { ratio: '832x1216', panels: [], panelCountMode: 'auto', useChatChars: false } },
    _smartDrawTrigger: { _mangaActive: true, enhancedContext: 'v_manga', multiCharOutput: true, multiCharUseCoords: false }
};
const hooks = [];
const RBQ = { api: { getSettings: () => settings, saveSettings: () => {} }, on: (event, callback) => { if (event === 'buildNaiV4Payload') hooks.push(callback); } };
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
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function hashText('), sdtSource.indexOf('    function parseMarkers(')), sdt);
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
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function weightCharacterName('), sdtSource.indexOf('    function mergeCharacterCaption(')), sdt);
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
test('later independent bubble headers move before Text while all utterances retain their order', () => {
    const bad = 'girl, holding envelope, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, Text: 信收到了。\n\nBubbleType: 通常吹き出し, 左下, Layout: 縦書き, Text: 谢谢你！\n\nSFX: 擬音, 吹き出しなし, Text: 咔哒';
    const repaired = manga.sanitizeMangaPositivePrompt(bad);
    assert.equal(repaired, 'girl, holding envelope, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, BubbleType: 通常吹き出し, 左下, Layout: 縦書き, SFX: 擬音, 吹き出しなし\nText: 信收到了。\n\n谢谢你！\n\n咔哒');
    assert.equal(manga.sanitizeMangaPositivePrompt(repaired), repaired);
    const page = fixture(); page.panels[0].characters[0].positive = bad;
    assert.equal(manga.compileMangaPage(page).characters[0].caption, repaired);
    const output = mangaHook(payload('comic', [{ char_caption: bad }]));
    assert.equal(output.parameters.v4_prompt.caption.char_captions[0].char_caption, repaired);
});
test('later header recovery preserves literal examples, inline mentions and bilingual dialogue', () => {
    const speech = '原句（译文）\n\n“BubbleType: 通常吹き出し, Layout: 縦書き, Text: 示例”\n\n请填写 BubbleType: 通常吹き出し, Text: 内容。\n\nLayout: 是单词，Text: 也是。';
    assert.equal(manga.splitMangaText('girl, Text: ' + speech).text, speech);
    const sanitized = manga.sanitizeMangaPositivePrompt('girl, Text: ' + speech);
    assert.equal(manga.sanitizeMangaPositivePrompt(sanitized), sanitized);
    assert.equal(manga.splitMangaText('girl, Text: 收到。 BubbleType: 通常吹き出し, Text: 好。').text,
        '收到。 BubbleType: 通常吹き出し, Text: 好。');
    assert.equal(manga.splitMangaText('girl, Text: 原句（译文）\n\nBubbleType: 通常吹き出し, 左下, Layout: 縦書き, Text: 次句（译文）').text,
        '原句（译文）\n\n次句（译文）');
});
test('each consecutive bubble retains repeated type, location and layout through redraw', () => {
    const input = 'girl, girl, holding envelope, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, Text: 第一句。\n\n第二句。';
    const expected = input.replace('girl, girl,', 'girl,').replace(', Text:', '\nText:');
    assert.equal(manga.sanitizeMangaPositivePrompt(input), expected);
    const page = fixture(); page.panels[0].characters[0].positive = input;
    const compiled = manga.compileMangaPage(page);
    const run = order => {
        sdt.prepareNaiCharData({ mangaPage: true, characters: compiled.characters });
        let output = payload(compiled.base);
        for (const hook of order) output = hook(output);
        return output;
    };
    const output = run([sdtHook, mangaHook]);
    assert.equal(output.parameters.v4_prompt.caption.char_captions[0].char_caption, expected);
    assert.deepEqual(json(output), json(run([mangaHook, sdtHook])));
    assert.equal(mangaHook(output).parameters.v4_prompt.caption.char_captions[0].char_caption, expected);
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
    assert.equal(first.model, 'nai-diffusion-4-5-full', 'retains user-configured model rather than forcing NAI V5');
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
test('dispatch preserves existing captions instead of guessing grayscale from a color dictionary', () => {
    const caption = 'Lin Yao (original), girl, beige trench coat, blue denim jeans, dark blue pleated skirt, cream knit sweater, Text: beige trench coat，原句不改。';
    const output = mangaHook(payload('comic, warm indoor lighting with soft shadows', [{ char_caption: caption }]));
    const rendered = output.parameters.v4_prompt.caption.char_captions[0].char_caption;
    assert.match(rendered, /beige trench coat, blue denim jeans, dark blue pleated skirt, cream knit sweater/);
    assert.match(rendered, /Text: beige trench coat，原句不改。$/);
    assert.match(output.input, /warm indoor lighting with soft shadows/);
    assert.equal(manga.sanitizeMangaPositivePrompt('Beige (Series), warm smile, cold weather, artist:tan, tan fox', true),
        'Beige (Series), warm smile, cold weather, artist:tan, tan fox');
});
test('manga planning restores the 1.8.4 text and omits canvas while preserving automatic context', () => {
    const original = { width: settings.naiWidth, height: settings.naiHeight, store: settings._smartDrawTrigger };
    try {
        settings.naiWidth = 1024; settings.naiHeight = 1536;
        const prompt = RBQ.api.mangaProtocol.planningPrompt();
        assert.equal(prompt.length, 619);
        assert.match(prompt, /对白容量不足时调整格大小或分页，不牺牲最后事件/);
        assert.doesNotMatch(prompt, /mangaCanvas|完整问答|跨相邻格/);
        const request = sdt.buildRequestPayload(1, { type: 'auto' }).payload;
        assert.equal(request.mangaCanvas, undefined);
        assert.ok(request.contextAnalysisInstructions);
        assert.equal(settings.naiWidth, 1024); assert.equal(settings.naiHeight, 1536);
        settings._smartDrawTrigger = { ...original.store, _mangaActive: false, enhancedContext: 'off' };
        assert.equal(sdt.buildRequestPayload(1, { type: 'auto' }).payload.mangaCanvas, undefined);
    } finally {
        settings.naiWidth = original.width; settings.naiHeight = original.height;
        settings._smartDrawTrigger = original.store;
    }
});
test('both hook orders preserve deliberate edited colors, identity, weights and dialogue', () => {
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
    assert.match(actual, /silver hair in high bun/);
    assert.match(actual, /1\.2::deep purple qipao, \{purple eyes\}::/);
    assert.match(actual, /blue_ribbon, Red \(Series\), red panda/);
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
        assert.equal(redrawn.model, 'nai-diffusion-4-5-full', 'retains user-configured model on redraw');
        assert.equal(redrawn.parameters.v4_prompt.caption.char_captions.length, 4);
    } finally { settings._mangaMode.enabled = wasEnabled; }
});
test('manga mode preserves user-configured image generation model rather than forcing NAI V5', () => {
    sdt.prepareNaiCharData(sdt.normalizeMangaSegment(fixture()));
    for (const testModel of ['nai-diffusion-4-5-full', 'nai-diffusion-4-curated', 'nai-diffusion-3', 'custom-model']) {
        const inputPayload = payload('comic');
        inputPayload.model = testModel;
        inputPayload.parameters.model = testModel;
        const result = mangaHook(sdtHook(inputPayload));
        assert.equal(result.model, testModel, `model ${testModel} must not be overridden`);
        assert.equal(result.parameters.model, testModel, `parameters.model ${testModel} must not be overridden`);
    }
});
test('real request builder and system prompt agree with the nested tool schema', () => {
    const { payload: request } = sdt.buildRequestPayload(1, { type: 'auto' });
    assert.equal(request.outputSchema.segments[0].format, 'nai5-comic');
    assert.equal(request.mangaInstruction, undefined, 'OpenAI system prompt is not duplicated into the user payload');
    assert.equal(request.outputSchema.story_plan, undefined);
    assert.doesNotMatch(JSON.stringify(sdt.getDrawSpecTool(settings._smartDrawTrigger)), /uniqueItems/, 'Gemini OpenAPI tools reject uniqueItems');
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
    const prior = settings._smartDrawTrigger, priorStyle = settings._mangaMode.style;
    // Full-color memory tests compare the ordinary and manga fields verbatim.
    settings._mangaMode.style = 'soft_color';
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', characterMemoryEnabled: true, characterProfiles: {} };
    profileRefreshes = 0; profileSaves = 0; memoryChat = 'manga-memory-test';
    try { run(); } finally { settings._smartDrawTrigger = prior; settings._mangaMode.style = priorStyle; memoryChat = 'manga-memory-test'; }
}
const memoryResponse = () => ({ shouldDraw: true, segments: [fixture(), fixture()], character_memory: [
    { name: 'Ami (original)', base: 'girl, long black hair, green eyes', outfit: 'white blouse, blue skirt, brown shoes' },
    { name: 'Mei', base: 'girl, short brown hair, blue eyes', outfit: 'red dress, black boots' }
] });
const allParts = ['hair', 'face', 'eyes', 'torso', 'hands', 'legs', 'feet'];
function appearancePage(appearances) {
    return { format: 'nai5-comic', anchor: { text: '她站在门前，随后拿出手机。' }, page: { base: 'comic, vertical layout' },
        panels: appearances.map((c, i) => ({ id: `P${i + 1}`, description: 'panel, villa gate', characters: [{ character_id: 'C1', name: 'Mina', base: '', outfit: '', positive: 'standing', negative: '', ...c }] })) };
}
test('manga reuses complete ordinary memory fields without rewriting custom tags or dialogue', () => withMemory(() => {
    const base = 'Mina, korean, 35 years old, 180cm height, long blonde hair, elegant updo style, custom facial mark';
    const outfit = 'white shirt, black vest, necklace, custom embroidered clasp';
    sdt.updateCharacterProfile('Mina', base, outfit);
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([{ positive: 'top panel, holding book, Text: 收好了。' }])] }, [], { content: story, messageId: 1 });
    assert.ok(result.characters[0].caption.startsWith(base + ', ' + outfit));
    assert.match(result.characters[0].caption, /Text: 收好了。$/);
    assert.equal(result.mangaPage.panels[0].characters[0].base, base);
    assert.equal(result.mangaPage.panels[0].characters[0].outfit, outfit);
    assert.equal(sdt.getCharacterProfile('Mina').baseTags, base);
    const caption = result.characters[0].caption;
    sdt.updateCharacterProfile('Mina', 'girl, black hair', 'blue coat', null, true, { replaceBase: true });
    assert.equal(manga.compileMangaPage(result.mangaPage).characters[0].caption, caption);
}));

test('closeups and back views do not classify or crop ordinary character memory', () => withMemory(() => {
    const base = 'Mina, girl, 35 years old, 180cm height, long blonde hair, brown eyes, custom trait';
    const outfit = 'white shirt, black vest, boots, custom accessory';
    sdt.updateCharacterProfile('Mina', base, outfit);
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([
        { visible: ['hands'], positive: 'holding cup, Text: boots' },
        { visible: [], positive: 'from behind, standing' }
    ])] }, [], { content: story });
    for (const c of result.characters) assert.ok(c.caption.startsWith(base + ', ' + outfit));
    assert.equal(result.memoryWarnings, undefined);
}));

test('explicit complete temporary appearance and outfit persist by panel without changing stable memory', () => withMemory(() => {
    const base = 'Mina, girl, long blonde hair, updo, brown eyes';
    const changed = 'Mina, girl, long blonde hair, hair down, brown eyes';
    sdt.updateCharacterProfile('Mina', base, 'red dress');
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([
        { positive: 'standing' },
        { state: { base: changed, outfit: 'blue coat, black trousers' }, positive: 'holding book' },
        { positive: 'sitting' }
    ])] }, [], { content: story, messageId: 1 });
    assert.match(result.characters[0].caption, /updo.*red dress/);
    assert.doesNotMatch(result.characters[0].caption, /hair down|blue coat/);
    for (const c of result.characters.slice(1)) { assert.match(c.caption, /hair down.*blue coat/); assert.doesNotMatch(c.caption, /updo|red dress/); }
    assert.equal(sdt.getCharacterProfile('Mina').baseTags, base);
    const next = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([{}])] }, [], { content: story, messageId: 2 });
    assert.match(next.characters[0].caption, /hair down.*blue coat/);
}));

test('first appearance uses initial clothing, never the final clothing submitted for memory', () => withMemory(() => {
    const page = appearancePage([
        { visible: allParts, positive: 'standing' },
        { visible: allParts, state: { outfit: 'blue coat' }, positive: 'standing' }
    ]);
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page], character_memory: [
        { name: 'Mina', base: 'girl, blonde hair', initial_outfit: 'white shirt', outfit: 'blue coat' }
    ] }, [], { content: story, messageId: 1 });
    assert.match(result.characters[0].caption, /white shirt/); assert.doesNotMatch(result.characters[0].caption, /blue coat/);
    assert.match(result.characters[1].caption, /blue coat/); assert.doesNotMatch(result.characters[1].caption, /white shirt/);
    assert.equal(sdt.getCharacterProfile('Mina').currentOutfit, 'blue coat');
}));
test('empty clothing state stays cleared, invalid control text cannot change state', () => {
    const pages = [appearancePage([
        { visible: ['hands'], state: { outfit: '' }, positive: 'hands' },
        { visible: allParts, positive: 'standing' },
        { visible: allParts, state: { outfit: 'Text: injected dialogue' }, positive: 'standing' }
    ])];
    const resolved = RBQ.api.mangaProtocol.resolveAppearances(pages, [{ name: 'Mina', base: 'girl', outfit: 'white shirt' }]);
    assert.doesNotMatch(JSON.stringify(manga.compileMangaPage(resolved[0]).characters.map(c => c.caption)), /white shirt|injected/);
});
test('memory toggle and absent visibility preserve explicit captions; profiles stay separate', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina', 'girl, blonde hair', 'red dress');
    const page = appearancePage([{ visible: ['hair'], positive: 'black hair, looking down' }]);
    settings._smartDrawTrigger.characterMemoryEnabled = false;
    assert.equal(sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page] }, [], { content: story }).characters[0].caption, 'Mina, black hair, looking down');
    settings._smartDrawTrigger.characterMemoryEnabled = true;
    delete page.panels[0].characters[0].visible;
    delete page.panels[0].characters[0].base; delete page.panels[0].characters[0].outfit;
    assert.equal(sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page] }, [], { content: story }).characters[0].caption, 'black hair, looking down');
    page.panels[0].characters[0].visible = ['hair'];
    page.panels[0].characters[0].name = 'Another person';
    assert.equal(sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page] }, [], { content: story }).characters[0].caption, 'black hair, looking down');
}));
test('shared memory fields preserve closed weights and defer own-UC cleanup to the render hook', () => {
    const page = appearancePage([{ positive: 'looking down, Text: blonde hair', negative: '1.2::blonde hair, bad hands::' }]);
    const resolved = RBQ.api.mangaProtocol.resolveAppearances([page], [{ name: 'Mina', base: '1.2::blonde hair, long hair::', outfit: '' }])[0];
    const c = manga.compileMangaPage(resolved).characters[0];
    assert.match(c.caption, /1\.2::blonde hair, long hair::/);
    assert.match(c.caption, /Text: blonde hair$/);
    const request = payload('comic', [{char_caption:c.caption}]);
    request.parameters.v4_negative_prompt.caption.char_captions = [{char_caption:c.uc}];
    assert.equal(mangaHook(request).parameters.v4_negative_prompt.caption.char_captions[0].char_caption, '1.2::bad hands::');
});

test('ordinary and fanart names survive full and cropped memory assembly', () => {
    for (const name of ['Mina', 'hatsune miku (vocaloid)']) {
        for (const visible of [allParts, ['face']]) {
            const result = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([{ name, visible, positive: 'smiling' }])],
                [{ name, base: name + ', girl, korean', outfit: '' }]);
            const caption = manga.compileMangaPage(result[0]).characters[0].caption;
            assert.ok(caption.includes(name));
            assert.equal(caption.split(name).length - 1, 1);
        }
    }
});
test('independent identity traits and compound clothing are not mutually erased', () => {
    const result = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([{ visible: ['hair', 'face', 'eyes', 'torso'],
        positive: 'freckles, east asian, round eyes, side bangs, 35 years old, broad shoulders, red cheongsam, smiling' }])],
        [{ name: 'Mina', base: 'girl, korean, mature female, brown eyes, updo, large breasts', outfit: 'red high slit cheongsam' }]);
    const caption = manga.compileMangaPage(result[0]).characters[0].caption;
    for (const tag of ['freckles', 'korean', 'east asian', 'round eyes', 'brown eyes', 'side bangs', 'updo', '35 years old', 'broad shoulders', 'large breasts', 'red high slit cheongsam']) assert.ok(caption.includes(tag), tag);
});
test('exact facts remain in memory and applicable crops; prompts no longer demand their removal', () => withMemory(() => {
    const base = 'Mina, girl, 35 years old, 180cm height';
    sdt.updateCharacterProfile('Mina', base, 'red dress');
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([
        { visible: ['face'], positive: 'smiling' }, { visible: ['torso'], positive: 'standing' }
    ])] }, [], { content: story, messageId: 1 });
    assert.match(result.characters[0].caption, /35 years old/);
    assert.match(result.characters[0].caption, /180cm height/);
    assert.match(result.characters[1].caption, /180cm height/);
    assert.equal(sdt.getCharacterProfile('Mina').baseTags, base);
    assert.match(sdt.getCharacterMemoryTagSpecification(), /35 years old、180cm height 原样保留/);
    assert.doesNotMatch(sdt.getCharacterMemoryTagSpecification(), /原创姓名只放|不机械抄成/);
}));
test('hair and explicit empty clothing persist across floors without rewriting identity', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina', 'Mina, girl, blonde hair, updo', 'red dress');
    const response = state => ({ shouldDraw: true, segments: [appearancePage([{ visible: allParts, positive: 'standing', ...(state ? { state } : {}) }])] });
    sdt.normalizeTaggerResult(response({ hair_style: 'hair down', base: 'Mina, girl, blonde hair, hair down', outfit: '' }), [], { content: story, messageId: 1 });
    const next = sdt.normalizeTaggerResult(response(), [], { content: story, messageId: 2 });
    assert.match(next.characters[0].caption, /hair down/);
    assert.doesNotMatch(next.characters[0].caption, /updo|red dress/);
    const profile = sdt.getCharacterProfile('Mina');
    assert.equal(profile.currentOutfit, '');
    assert.equal(profile.wardrobe.find(w => w.id === profile.currentOutfitId).outfit, '');
    sdt.updateCharacterProfile('Mina', '', 'white shirt', null, true, { preserveOutfit: true });
    assert.equal(profile.currentOutfit, '', 'card extraction must preserve explicitly cleared clothing');
    assert.match(profile.baseTags, /updo/);
    const request = sdt.buildRequestPayload(3, { type: 'auto' }).payload;
    assert.equal(request.characterMemory[0].state.hair_style, 'hair down');
    assert.equal(request.characterMemory[0].state.outfit, '');
    sdt.normalizeTaggerResult(response({ hair_style: 'ponytail', base: 'Mina, girl, blonde hair, ponytail', outfit: 'blue coat' }), [], { content: story, messageId: 8 });
    const old = sdt.normalizeTaggerResult(response(), [], { content: story, messageId: 2 });
    assert.match(old.characters[0].caption, /hair down/);
    assert.doesNotMatch(old.characters[0].caption, /ponytail|blue coat/);
    assert.equal(profile.currentOutfit, 'blue coat');
    assert.equal(profile.wardrobe.find(w => w.id === profile.currentOutfitId).outfit, 'blue coat');
    const future = sdt.normalizeTaggerResult(response(), [], { content: story, messageId: 9 });
    assert.match(future.characters[0].caption, /ponytail/);
    assert.match(future.characters[0].caption, /blue coat/);
    const sameFloor = sdt.normalizeTaggerResult(response(), [], { content: story, messageId: 1 });
    assert.match(sameFloor.characters[0].caption, /updo/);
    assert.match(sameFloor.characters[0].caption, /red dress/);
    assert.equal(profile.currentOutfit, 'blue coat');
    sdt.normalizeTaggerResult(response({ outfit: 'shirt' }), [], { content: story, messageId: 10 });
    assert.equal(profile.wardrobe.find(w => w.id === profile.currentOutfitId).outfit, 'shirt');
}));
test('reparsing a newly learned character starts before that floors final outfit', () => withMemory(() => {
    const response = { shouldDraw: true, segments: [appearancePage([
        { visible: allParts }, { visible: allParts, state: { outfit: 'blue coat' } }
    ])], character_memory: [{ name: 'Mina', base: 'girl, blonde hair', initial_outfit: 'white shirt', outfit: 'blue coat' }] };
    sdt.normalizeTaggerResult(response, [], { content: story, messageId: 3 });
    const repeated = sdt.normalizeTaggerResult(response, [], { content: story, messageId: 3 });
    assert.match(repeated.characters[0].caption, /white shirt/);
    assert.doesNotMatch(repeated.characters[0].caption, /blue coat/);
    assert.equal(sdt.getMangaMemoryReferences(3)[0].outfit, 'white shirt');
    assert.doesNotMatch(JSON.stringify(repeated.mangaPage), /_mangaAppearance|_mangaInitialAppearance/);
}));
test('request references are snapshots and an explicit wardrobe change overrides current state', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina', 'girl, blonde hair', 'red dress');
    const response = { shouldDraw: true, segments: [appearancePage([{ visible: allParts, state: { outfit: 'blue coat' } }])] };
    sdt.normalizeTaggerResult(response, [], { content: story, messageId: 1 });
    const context = sdt.captureMangaRequestContext({ content: story }, 2);
    sdt.updateCharacterProfile('Mina', '', 'white shirt');
    assert.equal(context.references[0].outfit, 'blue coat');
    assert.equal(sdt.getMangaMemoryReferences(2)[0].outfit, 'white shirt');
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([{ visible: allParts }])] }, [], context);
    assert.match(result.characters[0].caption, /blue coat/);
    assert.equal(sdt.getCharacterProfile('Mina').currentOutfit, 'white shirt', 'a delayed response must not undo a wardrobe edit');
    assert.equal(sdt.getMangaMemoryReferences(3)[0].outfit, 'white shirt');
}));
test('new protocol requires ordinary base/outfit fields and has no body-region contract', () => {
    const c = RBQ.api.mangaProtocol.segmentSchema().properties.panels.items.properties.characters.items;
    assert.ok(c.required.includes('base')); assert.ok(c.required.includes('outfit'));
    assert.equal(c.properties.visible, undefined);
    assert.equal(RBQ.api.mangaProtocol.outputSchema().segments[0].panels[0].characters[0].visible, undefined);
});

test('malformed people and arrays use compiler diagnostics before any memory writes', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina', 'girl', 'red dress');
    const before = JSON.stringify(sdt.getCharacterProfiles());
    const bad = appearancePage([{}]); bad.panels[0].characters = [null];
    assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [bad] }, [], { content: story }), /P1.*第 1 位人物/);
    bad.panels[0].characters = {};
    assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [bad] }, [], { content: story }), /characters 数组/);
    bad.panels = {};
    assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [bad] }, [], { content: story }), /panels/);
    assert.equal(JSON.stringify(sdt.getCharacterProfiles()), before);
}));
test('final weighted UC cannot exclude its own actual grayscale appearance', () => {
    const input = payload('comic', [{ char_caption: '1.2::light grey hair::, smiling, Text: light grey hair' }]);
    input.parameters.v4_negative_prompt.caption.char_captions = [{ char_caption: '1.3::light grey hair, yellow hair, bad hands::' }];
    const output = mangaHook(input);
    assert.equal(output.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, '1.3::yellow hair, bad hands::');
    assert.match(output.parameters.v4_prompt.caption.char_captions[0].char_caption, /Text: light grey hair$/);
});
test('chat switches including A to B to A invalidate captured response contexts', () => withMemory(() => {
    const context = sdt.captureMangaRequestContext({ content: story }, 1);
    memoryChat = 'other-chat';
    assert.throws(() => sdt.normalizeTaggerResult(memoryResponse(), [], context), /聊天已切换/);
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
    memoryChat = 'manga-memory-test';
    sdt.captureMangaRequestContext.epoch = (sdt.captureMangaRequestContext.epoch || 0) + 1;
    assert.throws(() => sdt.normalizeTaggerResult(memoryResponse(), [], context), /聊天已切换/);
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
}));
test('same-floor reparse compares live wardrobe at request start, not the pre-floor outfit', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina', 'girl, blonde hair, updo', 'red dress');
    const response = outfit => ({ shouldDraw: true, segments: [appearancePage([{ visible: allParts, state: { outfit } }])] });
    sdt.normalizeTaggerResult(response('blue coat'), [], sdt.captureMangaRequestContext({ content: story }, 1));
    const context = sdt.captureMangaRequestContext({ content: story }, 1);
    assert.equal(context.references[0].outfit, 'red dress');
    assert.equal(context.currentOutfits.mina, 'blue coat');
    const result = sdt.normalizeTaggerResult(response('green coat'), [], context);
    assert.match(result.characters[0].caption, /green coat/);
    assert.equal(sdt.getCharacterProfile('Mina').currentOutfit, 'green coat');
    assert.equal(sdt.getMangaMemoryReferences(2)[0].outfit, 'green coat');
}));
test('no-draw reparse rolls back that floor and dependent later states', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina', 'girl, blonde hair, updo', 'red dress');
    sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([{ visible: allParts, state: { hair_style: 'hair down', outfit: 'blue coat' } }])] }, [], { content: story, messageId: 1 });
    sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([{ visible: allParts, state: { outfit: 'green coat' } }])] }, [], { content: story, messageId: 2 });
    sdt.normalizeTaggerResult({ shouldDraw: false, segments: [] }, [], sdt.captureMangaRequestContext({ content: story }, 1));
    const reference = sdt.getMangaMemoryReferences(3)[0];
    assert.equal(reference.outfit, 'red dress');
    assert.equal(reference.state.hair_style, undefined);
    assert.equal(sdt.getCharacterProfile('Mina').mangaStateHistory.length, 0);
    assert.equal(sdt.getCharacterProfile('Mina').baseTags, 'Mina, girl, blonde hair, updo');
}));
test('message edits, swipe changes and deletions invalidate versioned state without a model call', () => {
    const getMessage = RBQ.api.getMessage;
    try {
        for (const change of ['edit', 'swipe', 'delete']) withMemory(() => {
            const messages = { 1: { mes: '她披上蓝色外套。', name: 'Mina', swipe_id: 0 }, 2: { mes: '她拿起书。', name: 'Mina', swipe_id: 0 } };
            RBQ.api.getMessage = id => messages[id];
            sdt.updateCharacterProfile('Mina', 'girl, blonde hair, updo', 'red dress');
            const response = state => ({ shouldDraw: true, segments: [appearancePage([{ visible: allParts, ...(state ? { state } : {}) }])] });
            sdt.normalizeTaggerResult(response({ hair_style: 'hair down', outfit: 'blue coat' }), [], sdt.captureMangaRequestContext({ content: messages[1].mes }, 1));
            sdt.normalizeTaggerResult(response(), [], sdt.captureMangaRequestContext({ content: messages[2].mes }, 2));
            if (change === 'edit') messages[1].mes = '她仍穿着红裙。';
            if (change === 'swipe') messages[1].swipe_id = 1;
            if (change === 'delete') delete messages[1];
            assert.equal(sdt.getMangaMemoryReferences(3)[0].outfit, 'red dress', change);
            assert.equal(sdt.getCharacterProfile('Mina').mangaStateHistory.length, 0, change);
        });
    } finally { RBQ.api.getMessage = getMessage; }
});
test('invalidating an edited floor preserves preceding state and a manual wardrobe selection', () => withMemory(() => {
    const getMessage = RBQ.api.getMessage;
    const messages = { 1: { mes: '散发蓝衣' }, 2: { mes: '绿衣' } };
    RBQ.api.getMessage = id => messages[id];
    try {
        sdt.updateCharacterProfile('Mina', 'girl, blonde hair, updo', 'red dress');
        for (const [id, state] of [[1, { hair_style: 'hair down', outfit: 'blue coat' }], [2, { outfit: 'green coat' }]]) {
            sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([{ visible: allParts, state }])] }, [], sdt.captureMangaRequestContext(null, id));
        }
        sdt.updateCharacterProfile('Mina', '', 'white shirt');
        messages[2].mes = '没有换装';
        const reference = sdt.getMangaMemoryReferences(3)[0];
        assert.equal(reference.outfit, 'white shirt');
        assert.equal(reference.state.hair_style, 'hair down');
        assert.equal(sdt.getCharacterProfile('Mina').mangaStateHistory.length, 1);
    } finally { RBQ.api.getMessage = getMessage; }
}));
test('an in-flight response for an edited message cannot write profiles or render stale pages', () => withMemory(() => {
    const getMessage = RBQ.api.getMessage;
    let message = { mes: '原正文', swipe_id: 0 };
    RBQ.api.getMessage = () => message;
    try {
        const context = sdt.captureMangaRequestContext({ content: message.mes }, 1);
        message = { mes: '新正文', swipe_id: 1 };
        assert.throws(() => sdt.normalizeTaggerResult(memoryResponse(), [], context), /正文或回复分支已改变/);
        assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
    } finally { RBQ.api.getMessage = getMessage; }
}));
test('ordinary memory preserves exact user appearance spellings with no alias rewriting', () => withMemory(() => {
    const base = 'Mina, korean, 35 years old, 180cm height, elegant updo style, voluptuous body, red lipstick';
    const outfit = 'white shirt, black vest, keyhole cutout, side slit, custom clasp';
    sdt.updateCharacterProfile('Mina', base, outfit);
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [appearancePage([{ positive: 'holding cup' }])] }, [], { content: story });
    assert.equal(result.characters[0].caption, base + ', ' + outfit + ', holding cup');
}));

test('manga and ordinary memory use the same field resolver and preserve complete layered outfits', () => {
    const profile = {baseTags:'Mina, girl, custom trait',currentOutfit:'white shirt'};
    const outfit = 'white shirt, black vest, glasses, necklace';
    const expected = RBQ.api.resolveCharacterMemoryFields(profile, 'girl, changed identity', outfit);
    const page = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([{ base:'girl, changed identity', outfit, positive:'holding book' }])], [{name:'Mina',base:profile.baseTags,outfit:profile.currentOutfit}])[0];
    assert.equal(page.panels[0].characters[0].base, expected.base);
    assert.equal(page.panels[0].characters[0].outfit, expected.outfit);
    assert.equal(manga.compileMangaPage(page).characters[0].caption, expected.base + ', ' + outfit + ', holding book');
});

test('first-time manga identity includes the supplied name when the model returns only appearance', () => withMemory(() => {
    const base = 'girl, brown hair, blue eyes';
    const result = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([{name:'毛利兰',base,outfit:'white shirt'}])]},[],{content:story,messageId:1});
    assert.equal(sdt.getCharacterProfile('毛利兰').baseTags, '毛利兰, ' + base);
    assert.equal(result.mangaPage.panels[0].characters[0].base, '毛利兰, ' + base);
    assert.match(result.characters[0].caption,/^毛利兰, girl/);
}));
test('existing nameless memory is repaired additively without replacing appearance or clothing', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina','girl, custom exact trait','white shirt');
    const result = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([{base:'wrong appearance'}])]},[],{content:story,messageId:1});
    assert.equal(sdt.getCharacterProfile('Mina').baseTags,'Mina, girl, custom exact trait');
    assert.equal(sdt.getCharacterProfile('Mina').currentOutfit,'white shirt');
    assert.match(result.characters[0].caption,/^Mina, girl, custom exact trait/);
    assert.doesNotMatch(result.characters[0].caption,/wrong appearance/);
}));
test('name fallback preserves supplied canonical tags, avoids duplicates and never invents an alias', () => {
    assert.equal(sdt.ensureCharacterNameTag('Mina','Mina, girl'),'Mina, girl');
    assert.equal(sdt.ensureCharacterNameTag('Mina','2::Mina::, girl'),'2::Mina::, girl');
    assert.equal(sdt.ensureCharacterNameTag('毛利兰','mouri ran, girl'),'毛利兰, mouri ran, girl');
    assert.equal(sdt.ensureCharacterNameTag('C1','girl'),'girl');
    assert.equal(sdt.ensureCharacterNameTag('路人','girl'),'girl');
    assert.equal(sdt.ensureCharacterNameTag('Mina',''),'Mina');
    assert.equal(sdt.ensureCharacterNameTag('Ann','Anna, girl'),'Ann, Anna, girl');
});

test('ordinary and manga first-time learning share the same missing-name fallback', () => withMemory(() => {
    const merge = sdt.mergeCharacterCaption, weight = sdt.weightCharacterName;
    try {
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function mergeCharacterCaption('), sdtSource.indexOf('    function collectCharacterCardInfo(')), sdt);
        settings._smartDrawTrigger._mangaActive = false; settings._smartDrawTrigger.enhancedContext = 'off';
        const ordinary = sdt.mergeCharacterCaption('Mina','girl, custom trait','white shirt','standing','');
        const ordinaryBase = sdt.getCharacterProfile('Mina').baseTags;
        memoryChat = 'fresh-manga-name';
        settings._smartDrawTrigger._mangaActive = true; settings._smartDrawTrigger.enhancedContext = 'v_manga';
        const result = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([{base:'girl, custom trait',outfit:'white shirt'}])]},[],{content:story});
        assert.equal(result.characters[0].caption,ordinary);
        assert.equal(sdt.getCharacterProfile('Mina').baseTags,ordinaryBase);
    } finally {sdt.mergeCharacterCaption = merge; sdt.weightCharacterName = weight;}
}));
test('canonical fan tag survives memory, temporary appearance and final monochrome payload', () => withMemory(() => {
    const base = 'mouri ran, girl, brown hair, blue eyes';
    const result = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([
        {name:'毛利兰',base,outfit:'white shirt'},
        {name:'毛利兰',state:{base:'mouri ran, girl, brown hair, blue eyes, ponytail'}}
    ])]},[],{content:story,messageId:1});
    assert.match(sdt.getCharacterProfile('毛利兰').baseTags,/mouri ran/);
    for (const c of result.characters) {
        assert.equal(c.caption.split('mouri ran').length-1,1);
        const final = mangaHook(payload('comic',[{char_caption:c.caption}]));
        assert.match(final.parameters.v4_prompt.caption.char_captions[0].char_caption,/mouri ran/);
    }
    const next = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([{name:'毛利兰'}])]},[],{content:story,messageId:2});
    assert.match(next.characters[0].caption,/mouri ran.*ponytail/);
}));
test('adding a missing name does not invalidate an existing temporary appearance source', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina','girl, long hair','white shirt');
    const profile = sdt.getCharacterProfile('Mina');
    profile.mangaStateHistory = [{messageId:1,before:{outfit:'white shirt',outfitSet:true},
        after:{outfit:'white shirt',outfitSet:true,render_base:'girl, short hair',render_base_source:'girl, long hair'}}];
    const response = {shouldDraw:true,segments:[appearancePage([{}])]};
    const result = sdt.normalizeTaggerResult(response,[],{content:story,messageId:2});
    assert.match(result.characters[0].caption,/^Mina, girl, short hair/);
    const next = sdt.normalizeTaggerResult(response,[],{content:story,messageId:3});
    assert.match(next.characters[0].caption,/^Mina, girl, short hair/);
    assert.equal(profile.baseTags,'Mina, girl, long hair');
}));

test('real ordinary merge and manga produce the same complete base, layered outfit and action', () => withMemory(() => {
    const merge = sdt.mergeCharacterCaption, weight = sdt.weightCharacterName;
    const base = 'Mina, girl, 35 years old, 180cm height, custom trait';
    const outfit = 'white shirt, black vest, necklace, custom clasp';
    try {
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function mergeCharacterCaption('), sdtSource.indexOf('    function collectCharacterCardInfo(')), sdt);
        sdt.updateCharacterProfile('Mina', base, 'white shirt');
        settings._smartDrawTrigger._mangaActive = false; settings._smartDrawTrigger.enhancedContext = 'off';
        const ordinary = sdt.mergeCharacterCaption('Mina', 'wrong base', outfit, 'holding book', '');
        const page = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([{base:'wrong base',outfit,positive:'holding book'}])], [{name:'Mina',base,outfit:'white shirt'}])[0];
        assert.equal(manga.compileMangaPage(page).characters[0].caption, ordinary);
        assert.equal(ordinary, base + ', ' + outfit + ', holding book');
    } finally { sdt.mergeCharacterCaption = merge; sdt.weightCharacterName = weight; }
}));
test('per-panel complete outfits follow ordinary replacement and never leak backwards', () => {
    const page = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([
        {positive:'standing'}, {outfit:'white shirt, black vest',positive:'holding book'}, {positive:'sitting'}
    ])], [{name:'Mina',base:'girl',outfit:'red dress'}])[0];
    const captions = manga.compileMangaPage(page).characters.map(c=>c.caption);
    assert.match(captions[0], /red dress/); assert.doesNotMatch(captions[0], /vest/);
    for (const c of captions.slice(1)) {assert.match(c, /white shirt, black vest/);assert.doesNotMatch(c,/red dress/);}
});

test('new characters learn ordinary per-person base/outfit without separate memory metadata', () => withMemory(() => {
    const response = {shouldDraw:true, segments:[appearancePage([
        {base:'Mina, girl, custom trait',outfit:'white shirt, black vest',positive:'standing'},
        {base:'Mina, girl, custom trait',outfit:'blue coat',positive:'holding book'}
    ])]};
    const result = sdt.normalizeTaggerResult(response, [], {content:story,messageId:1});
    const profile = sdt.getCharacterProfile('Mina');
    assert.equal(profile.baseTags, 'Mina, girl, custom trait');
    assert.equal(profile.currentOutfit,'blue coat');
    assert.match(result.characters[0].caption,/white shirt, black vest/);
    assert.equal(sdt.getMangaMemoryReferences(1)[0].outfit,'white shirt, black vest');
}));

test('memory disabled still resolves named and anonymous runtime states without profile writes', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina', 'girl, saved identity', 'red dress');
    settings._smartDrawTrigger.characterMemoryEnabled = false;
    const saved = JSON.stringify(sdt.getCharacterProfiles()), saves = profileSaves;
    for (const name of ['Mina', '']) {
        const result = sdt.normalizeTaggerResult({shouldDraw:true, segments:[appearancePage([
            {name,base:'girl, long hair',outfit:'white shirt'},
            {name,state:{base:'girl, short hair',outfit:'blue coat'}},
            {name}, {name,state:{outfit:''}}, {name}
        ])],character_memory:[{name:'Mina',base:'wrong identity',outfit:'wrong coat'}]}, [], {content:story});
        assert.match(result.characters[0].caption,/long hair, white shirt/);
        for (const c of result.characters.slice(1,3)) assert.match(c.caption,/short hair, blue coat/);
        for (const c of result.characters.slice(3)) assert.doesNotMatch(c.caption,/coat|shirt/);
        assert.ok(result.characters.every(c=>!c.caption.includes('saved identity')));
    }
    assert.equal(JSON.stringify(sdt.getCharacterProfiles()),saved);
    assert.equal(profileSaves,saves);
}));
test('anonymous people with the same generic name keep separate local identities', () => {
    const page = appearancePage([
        {character_id:'C1',name:'路人',base:'boy, black hair',outfit:'white shirt'},
        {character_id:'C2',name:'路人',base:'girl, silver hair',outfit:'blue coat'},
        {character_id:'C1',name:'路人'}
    ]);
    const captions = manga.compileMangaPage(RBQ.api.mangaProtocol.resolveAppearances([page])[0]).characters.map(c=>c.caption);
    assert.match(captions[1],/girl, silver hair, blue coat/);
    assert.match(captions[2],/boy, black hair, white shirt/);
});
test('manual caption edits clear hidden appearance so removed tags cannot return on recompilation', () => {
    const segment = sdt.normalizeMangaSegment(appearancePage([{base:'girl, old trait',outfit:'red dress',state:{base:'girl, old trait'}}]));
    const editedCaption = 'girl, corrected trait, blue coat, holding book';
    const values = {'.rbq-sdt-manual-char-caption':editedCaption,'.rbq-sdt-manual-char-uc':'bad hands',
        '.rbq-sdt-pad-x':'0.5','.rbq-sdt-pad-y':'0.5'};
    const context = vm.createContext({segResult:segment,isMultiChar:true,sdtParseCoord:sdt.sdtParseCoord,
        modal:{querySelector:()=>({value:'comic'}),querySelectorAll:()=>[{dataset:{index:'0'},querySelector:q=>({value:values[q]})}]}});
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('        function gatherUpdatedSegment('),sdtSource.indexOf('        function syncUpdatedSegmentState(')),context);
    const result = context.gatherUpdatedSegment('characters');
    assert.equal(manga.compileMangaPage(result.mangaPage).characters[0].caption,editedCaption);
    assert.equal(result.mangaPage.panels[0].characters[0].state,undefined);
    assert.equal(segment.mangaPage.panels[0].characters[0].outfit,'red dress');
});
test('empty compatibility metadata cannot suppress first panel identity and opening clothing', () => withMemory(() => {
    const result = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([
        {base:'Mina, girl, long hair',outfit:'white shirt'}, {outfit:'blue coat'}
    ])],character_memory:[{name:'Mina',base:'',outfit:''}]},[],{content:story,messageId:1});
    assert.equal(sdt.getCharacterProfile('Mina').baseTags,'Mina, girl, long hair');
    assert.equal(sdt.getMangaMemoryReferences(1)[0].outfit,'white shirt');
    assert.match(result.characters[1].caption,/blue coat/);
}));
test('unknown opening clothes are learned only on first appearance, never from a later change', () => {
    const refs = [{name:'Mina',base:'girl',outfit:''}];
    const first = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([{outfit:'white shirt'},{outfit:'blue coat'}])],refs)[0];
    assert.equal(first.panels[0].characters[0]._mangaInitialAppearance.outfit,'white shirt');
    const later = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([{}, {outfit:'blue coat'}])],refs)[0];
    assert.equal(later.panels[1].characters[0]._mangaInitialAppearance.outfit,'');
    const known = RBQ.api.mangaProtocol.resolveAppearances([appearancePage([{outfit:'blue coat'}])],[{...refs[0],outfit:'red dress'}])[0];
    assert.equal(known.panels[0].characters[0]._mangaInitialAppearance.outfit,'red dress');
});
test('invalid structured appearance fields reject the entire response before learning', () => withMemory(() => {
    for (const fields of [{base:['girl']},{outfit:{}},{name:[]},{state:[]},{state:{base:{}}},{state:{outfit:false}}]) {
        const bad = appearancePage([{base:'girl',outfit:'white shirt'},fields]);
        assert.throws(()=>sdt.normalizeTaggerResult({shouldDraw:true,segments:[bad]},[],{content:story}),/人物|状态|字段/);
        assert.equal(Object.keys(sdt.getCharacterProfiles()).length,0);
    }
}));
test('explicit profile correction supersedes obsolete temporary appearance without changing cached pages', () => withMemory(() => {
    sdt.updateCharacterProfile('Mina','girl, long hair','white shirt');
    const old = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([{state:{base:'girl, short hair'}}])]},[],{content:story,messageId:1});
    sdt.updateCharacterProfile('Mina','Mina, girl, corrected identity','',null,true,{replaceBase:true});
    const next = sdt.normalizeTaggerResult({shouldDraw:true,segments:[appearancePage([{}])]},[],{content:story,messageId:2});
    assert.match(next.characters[0].caption,/corrected identity/);
    assert.doesNotMatch(next.characters[0].caption,/short hair/);
    assert.match(manga.compileMangaPage(old.mangaPage).characters[0].caption,/short hair/);
}));

test('dispatch leaves objects, environment and makeup to the director and preserves literal text', () => {
    const input = payload('comic, red pen, brown wooden desk, blue walls, Text: 红笔与 blue walls', [
        { char_caption: 'Mina, korean, 35 years old, red lipstick, holding red pen, flesh-colored ultra-thin stockings, red panda, artist: red_pen, hatsune_miku (vocaloid), Text: red lipstick' }
    ]);
    const result = mangaHook(input);
    assert.match(result.input, /red pen, brown wooden desk, blue walls/);
    assert.match(result.input, /Text: 红笔与 blue walls$/);
    const caption = result.parameters.v4_prompt.caption.char_captions[0].char_caption;
    for (const value of ['red lipstick', 'holding red pen', 'flesh-colored ultra-thin stockings', 'red panda', 'artist: red_pen', 'hatsune_miku (vocaloid)', 'Mina', 'korean', '35 years old']) assert.ok(caption.includes(value), value);
    assert.match(caption, /Text: red lipstick$/);
    assert.deepEqual(json(mangaHook(result)), json(result), 'hook is idempotent');
});
test('names resembling color phrases survive both hook orders without leaking protocol metadata', () => {
    for (const order of [[sdtHook, mangaHook], [mangaHook, sdtHook]]) {
        sdt.prepareNaiCharData({ mangaPage: true, characters: [{ name: 'Red Pen', caption: 'Red Pen, girl, red lipstick, holding red pen', uc: '', center: { x: 0.5, y: 0.5 } }] });
        let result = payload('comic');
        for (const hook of order) result = hook(result);
        const caption = result.parameters.v4_prompt.caption.char_captions[0];
        assert.match(caption.char_caption, /^Red Pen, girl, red lipstick, holding red pen$/);
        assert.deepEqual(Object.keys(caption).sort(), ['centers', 'char_caption']);
    }
});
test('panel count correction is local, non-mutating and preserves valid layout geometry and text', () => {
    const page = appearancePage([{ visible: allParts }]);
    page.page.base = 'comic, 4 panels, full-page panel, Text: four panels';
    const before = JSON.stringify(page);
    const compiled = manga.compileMangaPage(page);
    assert.match(compiled.base, /1 panel, full-page panel/);
    assert.match(compiled.base, /Text: four panels$/);
    assert.ok(compiled.warnings.some(w => w.includes('修正为 1 格')));
    assert.equal(JSON.stringify(page), before);
    const layout = 'comic, 3 panels, bottom focal panel occupying half the page, top-right small panel beside top-left medium panel';
    page.page.base = layout; page.panels = [1, 2, 3].map(i => ({ id: 'P' + i, description: 'indoors', characters: [] }));
    assert.ok(manga.compileMangaPage(page).base.startsWith(layout));
});
test('misplaced speech produces a diagnostic without guessing speaker, deleting text or retrying', () => {
    const page = appearancePage([{ visible: allParts }]);
    page.panels[0].non_character = 'top panel, BubbleType: 通常吹き出し, Text: 先等一等。';
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page] }, [], { content: story });
    assert.ok(result.renderWarnings.some(w => w.includes('non_character')));
    assert.match(result.scene, /Text: 先等一等。$/);
    assert.doesNotMatch(result.characters[0].caption, /先等一等/);
});
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
                assert.match(prompt, /panels\[\]\.characters\[\]\.base/);
                assert.doesNotMatch(prompt, /将可见特征用于|仅将当前镜头可见的衣着/);
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
    assert.equal(profiles.Ami.baseTags, 'Ami (original), ' + response.character_memory[0].base);
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
    assert.ok(!schema.required.includes('character_memory'));
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
        assert.equal(requests[0].mangaCanvas, undefined);
        console.log('PASS production custom-HTTP path accepts B6 source mismatch with one call'); passed++;

        settings._smartDrawTrigger.enhancedContext = 'v_manga_185';
        installResponse(() => planned());
        assert.equal((await sdt.callTagger(1, { type: 'auto' })).segments.length, 2);
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0].mangaCanvas, json(RBQ.api.mangaProtocol.planningContext()));
        assert.ok(requests[0].mangaInstruction.endsWith(RBQ.api.mangaProtocol.planningPrompt('v_manga_185')));
        settings._smartDrawTrigger.enhancedContext = 'v_manga';
        console.log('PASS alternate automatic custom-HTTP planner includes historical canvas without extra calls'); passed++;

        settings._smartDrawTrigger.characterMemoryEnabled = true;
        installResponse(() => memoryResponse());
        await sdt.callTagger(1, { type: 'auto' });
        assert.equal(requests.length, 1);
        assert.ok(requests[0].outputSchema.character_memory);
        assert.match(requests[0].mangaInstruction, /漫画角色记忆/);
        assert.ok(requests[0].mangaInstruction.includes(sdt.getCharacterMemoryTagSpecification()));
        assert.equal(sdt.getCharacterProfile('Ami').baseTags, 'Ami (original), ' + memoryResponse().character_memory[0].base);
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
        for (const ec of ['v_manga', 'v_manga_185']) for (const toolCallMode of [false, true]) {
            settings._smartDrawTrigger.enhancedContext = ec;
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
                assert.deepEqual(request.mangaCanvas, ec === 'v_manga_185' ? json(RBQ.api.mangaProtocol.planningContext()) : undefined);
                assert.ok(body.messages[0].content.includes(RBQ.api.mangaProtocol.planningPrompt(ec)));
                assert.equal(request.mangaInstruction, undefined);
                if (toolCallMode) assert.ok(!body.tools[0].function.parameters.required.includes('story_plan'));
                if (toolCallMode) assert.ok(!body.tools[0].function.parameters.required.includes('character_memory'));
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
        settings._smartDrawTrigger.enhancedContext = 'v_manga';
        console.log('PASS production OpenAI JSON and tool requests render final pages in one call'); passed++;
        for (const ec of ['v_manga', 'v_manga_185']) for (const provider of ['custom', 'openai']) {
            settings._smartDrawTrigger.enhancedContext = ec;
            settings._smartDrawTrigger.provider = provider;
            let release, calls = 0;
            const suspendedResponse = () => {
                calls++;
                return new Promise(resolve => { release = () => resolve({ ok: true, headers: { get: () => 'application/json' }, json: async () => memoryResponse() }); });
            };
            sdt.smartFetch = suspendedResponse;
            sdt.callApiWithJsonFallback = suspendedResponse;
            memoryChat = 'request-origin-' + provider;
            const pending = sdt.callTagger(7, { type: 'auto' });
            memoryChat = 'request-destination-' + provider;
            release();
            await assert.rejects(pending, /聊天已切换/);
            assert.equal(calls, 1);
            assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
            memoryChat = 'request-origin-' + provider;
            assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
        }
        memoryChat = 'manga-memory-test';
        console.log('PASS delayed custom and OpenAI responses cannot write to another chat'); passed++;

    } finally { settings._smartDrawTrigger = oldSettings; sdt.getMessageSnapshot = snapshot; }

    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function parseTaggerSegment('), sdtSource.indexOf('    RBQ.api.parseWithTagger =')), sdt);
    const oldCollector = sdt.collectCharacterCardInfo, previousTestSettings = settings._smartDrawTrigger;
    const testCard = [{ name: 'Ami', description: '成年女性，中国籍，银色长发。', characterBookEntries: [{ keys: ['library'], content: '蓝色外套。' }] }];
    try {
        settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', injectCharacterCard: true,
            customUrl: 'https://test.invalid', openaiBaseUrl: 'https://test.invalid', openaiModel: 'test', squashMessages: false };
        sdt.collectCharacterCardInfo = (content, recent) => { assert.equal(content, 'library'); assert.equal(recent.length, 0); return testCard; };
        for (const ec of ['v_manga', 'v_manga_185']) for (const provider of ['custom', 'openai']) {
            settings._smartDrawTrigger.enhancedContext = ec;
            settings._smartDrawTrigger.provider = provider;
            let calls = 0;
            const checkRequest = body => {
                calls++;
                const request = provider === 'custom' ? body : JSON.parse(body.messages[1].content);
                assert.deepEqual(request.mangaCanvas, ec === 'v_manga_185' ? json(RBQ.api.mangaProtocol.planningContext()) : undefined);
                assert.equal(!!request.contextAnalysisInstructions, ec === 'v_manga_185');
                assert.ok((provider === 'custom' ? request.mangaInstruction : body.messages[0].content).includes(RBQ.api.mangaProtocol.planningPrompt(ec)));
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

    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function submitManualDraw('), sdtSource.indexOf('    /* ── 🗂️ 剧情漫画时间轴')), sdt);
    const manualSettings = settings._smartDrawTrigger;
    const manualKeys = ['document', 'localStorage', 'toastr', 'PLUGIN_NAME', 'closeManualDrawDialog', 'generateSdtImage', 'collectCharacterCardInfo'];
    const manualOriginals = Object.fromEntries(manualKeys.map(key => [key, sdt[key]]));
    try {
        const fields = { 'rbq-sdt-manual-input': { value: '她们交谈后转身离开了教室。' },
            'rbq-sdt-manual-status': {}, 'rbq-sdt-manual-submit': {}, 'rbq-sdt-manual-use-context': { checked: false } };
        let generated = 0;
        Object.assign(sdt, { document: { getElementById: id => fields[id] }, localStorage: { setItem() {} },
            toastr: { warning() {}, success() {}, error: text => { throw new Error(text); } }, PLUGIN_NAME: 'test',
            closeManualDrawDialog() {}, generateSdtImage: async () => { generated++; }, collectCharacterCardInfo: () => [] });
        for (const ec of ['v_manga', 'v_manga_185']) for (const provider of ['custom', 'openai']) {
            settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: ec, provider,
                customUrl: 'https://test.invalid', openaiBaseUrl: 'https://test.invalid', openaiModel: 'test', squashMessages: false };
            let calls = 0;
            const checkRequest = body => {
                calls++;
                const request = provider === 'custom' ? body : JSON.parse(body.messages[1].content);
                const directives = provider === 'custom' ? request.mangaInstruction : body.messages[0].content;
                assert.ok(directives.includes(RBQ.api.mangaProtocol.planningPrompt(ec)));
                assert.equal(directives.split('【漫画前情与本楼规划】').length - 1, 1);
                assert.deepEqual(request.mangaCanvas, ec === 'v_manga_185' ? json(RBQ.api.mangaProtocol.planningContext()) : undefined);
                return { ok: true, json: async () => ({ shouldDraw: true, segments: [fixture()] }) };
            };
            sdt.smartFetch = async (_url, options) => checkRequest(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => checkRequest(body);
            await sdt.submitManualDraw();
            assert.equal(calls, 1);
        }
        assert.equal(generated, 4);
        console.log('PASS manual draw routes both planners and both providers with one request each'); passed++;
    } finally { Object.assign(sdt, manualOriginals); settings._smartDrawTrigger = manualSettings; }

    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function runSegmentAiRefinement('),sdtSource.indexOf('    function setCardLoadingState(')),sdt);
    const refinementSettings = settings._smartDrawTrigger, refinementStyle = settings._mangaMode.style;
    try {
        settings._mangaMode.style = 'soft_color';
        settings._smartDrawTrigger = {_mangaActive:true,provider:'custom',customUrl:'https://test.invalid'};
        const response = appearancePage([{base:'girl, long hair',outfit:'white shirt'},
            {base:'girl, long hair',outfit:'white shirt',state:{base:'girl, short hair',outfit:'blue coat'}}]);
        sdt.smartFetch = async (_url, options) => {
            assert.doesNotMatch(JSON.parse(options.body).messages[0].content,/positive 必须保留完整可见外貌衣着/);
            return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(response)}}]})};
        };
        const saves = profileSaves;
        const result = await sdt.runSegmentAiRefinement(sdt.normalizeMangaSegment(response),'换上蓝外套');
        assert.match(result.characters[1].caption,/short hair, blue coat/);
        assert.doesNotMatch(result.characters[1].caption,/long hair|white shirt/);
        assert.equal(profileSaves,saves);
        console.log('PASS SDT AI refinement resolves structured snapshots without writing memory'); passed++;
    } finally {settings._smartDrawTrigger = refinementSettings; settings._mangaMode.style = refinementStyle;}

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
        getFinalPrompt: sdt.getFinalPrompt, getSegmentNegative: sdt.getSegmentNegative,
        generateSdtImage: (segment, prompt, reason, meta, progress) => {
            sdt.prepareNaiCharData(segment);
            return drawerApi.api.generateImage(prompt, reason, meta, progress);
        }, console,
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
        assert.equal(imported.baseTags, 'Ami (original), ' + extracted.base);
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
        settings._smartDrawTrigger.customUrl = 'https://test.invalid/tagger';
        const originChat = memoryChat, savedOrigin = JSON.stringify(sdt.getCharacterProfiles());
        sdt.smartFetch = async () => { memoryChat = 'switched-during-card-extraction'; return importResponse(extracted); };
        assert.equal(await sdt.importCharacterFromCurrentCard(), false);
        assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
        memoryChat = originChat;
        assert.equal(JSON.stringify(sdt.getCharacterProfiles()), savedOrigin);
        console.log('PASS card re-extraction cannot write across chats either'); passed++;


        Object.assign(settings._smartDrawTrigger, { provider: 'openai', openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'test', characterProfiles: {} });
        importCalls = 0;
        sdt.callApiWithJsonFallback = async (_url, _options, body) => {
            importCalls++;
            assert.ok(body.messages[0].content.includes(sdt.getCharacterMemoryTagSpecification()));
            return importResponse(extracted);
        };
        const created = await sdt.importCharacterFromCurrentCard();
        assert.equal(importCalls, 1);
        assert.equal(created.baseTags, 'Ami (original), ' + extracted.base);
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
    manga.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.messages[1].content, 'story', 'Studio without references uses the original input');
        assert.doesNotMatch(body.messages[0].content, /mangaCanvas/);
        return { ok: false, status: 503 };
    };
    await assert.rejects(manga.requestStudioPanels(settings._mangaMode, 'one panel', 'story', 1), /HTTP 503/);
    manga.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"panels":[]}' } }] }) });
    await assert.rejects(manga.requestStudioPanels(settings._mangaMode, 'one panel', 'story', 1), /画格数量/);
    assert.equal(JSON.stringify(settings._mangaMode.studio.panels), before);
    await assert.rejects(manga.callLlmStoryboardParser('story', '4koma', 'zh-hans', '3'), /经典四格/);
    console.log('PASS Studio failures preserve drafts and incompatible 4-koma count is rejected'); passed++;
    const studioReferences = { characterCardInfo: testCard, characterMemory: [{ name: 'Mei', base: 'girl, short blonde hair, brown eyes', outfit: 'white shirt' }] };
    RBQ.api.collectMangaReferenceData = content => { assert.equal(content, 'story'); return studioReferences; };
    // Studio defaults to independent mode (useChatChars: false): references must NOT leak into LLM input
    manga.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.messages[1].content, 'story', 'Default studio mode passes raw input without injecting characterCardInfo or characterMemory');
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ panels: [fixture().panels[0]] }) } }] }) };
    };
    await manga.requestStudioPanels({ ...settings._mangaMode, style: 'soft_color' }, 'one panel', 'story', 1);

    settings._mangaMode.studio.useChatChars = true;
    for (const ec of ['v_manga', 'v_manga_185']) for (const baseUrl of ['https://test.invalid/v1', 'https://test.invalid/v1/chat/completions/']) {
        settings._smartDrawTrigger.enhancedContext = ec;
        settings._smartDrawTrigger.openaiBaseUrl = baseUrl;
        manga.fetch = async (url, options) => {
            assert.equal(url, 'https://test.invalid/v1/chat/completions');
            const body = JSON.parse(options.body), userInput = JSON.parse(body.messages[1].content);
            assert.deepEqual(userInput, { currentMessage: 'story', ...studioReferences,
                ...(ec === 'v_manga_185' ? { mangaCanvas: json(RBQ.api.mangaProtocol.planningContext(settings._mangaMode.studio.ratio)) } : {}) });
            assert.equal(body.messages[0].content.includes('输入 mangaCanvas 是本页实际画布像素与方向'), ec === 'v_manga_185');
            assert.match(body.messages[0].content, /characterCardInfo\/characterMemory/);
            const panel = fixture().panels[0];
            panel.characters[1].base = ''; panel.characters[1].outfit = '';
            panel.characters[1].positive = 'looking at another, Text: 好。';
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ panels: [panel] }) } }] }) };
        };
        const savesBefore = profileSaves;
        const panels = await manga.requestStudioPanels({ ...settings._mangaMode, style: 'soft_color' }, 'one panel', 'story', 1);
        assert.equal(panels.length, 1);
        assert.match(panels[0].characters[1].positive, /blonde hair/);
        assert.match(panels[0].characters[1].positive, /brown eyes/);
        assert.match(panels[0].characters[1].positive, /white shirt/);
        assert.equal(profileSaves, savesBefore);
    }
    settings._mangaMode.studio.useChatChars = false;
    settings._smartDrawTrigger.enhancedContext = 'v_manga';

    RBQ.api.collectMangaReferenceData = () => ({ characterMemory: [{ name: 'Mina', base: 'girl, blonde hair', outfit: 'red dress' }] });
    settings._mangaMode.studio.useChatChars = true;
    const draft = appearancePage([
        { visible: allParts, state: { outfit: 'blue coat' }, positive: 'girl, blonde hair, blue coat, standing' },
        { visible: allParts, positive: 'girl, blonde hair, blue coat, holding book' }
    ]).panels;
    const draftBefore = JSON.stringify(draft), draftStyle = settings._mangaMode.style;
    settings._mangaMode.style = 'soft_color';
    manga.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.match(body.messages[0].content, /完整外貌衣着快照/);
        const single = body.messages[0].content.includes('只返回正在编辑的一个画格');
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ panels: single ? [draft[1]] : draft }) } }] }) };
    };
    const edited = await manga.callLlmSingleSentenceExpander('她仍穿着蓝外套拿起书。', 'medium shot', 'cinema', 'zh-hans', draft, 1);
    assert.match(edited.characters[0].positive, /blue coat/);
    assert.doesNotMatch(edited.characters[0].positive, /red dress/);
    const batch = await manga.callLlmBatchSentenceExpander(draft, 'cinema', 'zh-hans');
    assert.ok(batch.every(panel => panel.characters[0].positive.includes('blue coat')));
    assert.equal(JSON.stringify(draft), draftBefore);
    console.log('PASS Studio single and batch refinement preserve draft outfits over live profile defaults'); passed++;
    const structuredDraft = appearancePage([
        {base:'girl, long hair',outfit:'white shirt'},
        {base:'girl, long hair',outfit:'white shirt',state:{base:'girl, short hair',outfit:'blue coat'}}
    ]).panels;
    manga.fetch = async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({panels:structuredDraft})}}]})});
    const changedDraft = await manga.callLlmBatchSentenceExpander(structuredDraft, 'cinema', 'zh-hans');
    assert.match(changedDraft[0].characters[0].positive,/long hair, white shirt/);
    assert.match(changedDraft[1].characters[0].positive,/short hair, blue coat/);
    assert.doesNotMatch(changedDraft[1].characters[0].positive,/long hair|white shirt|red dress/);
    console.log('PASS Studio refinement applies explicit structured changes without live memory overriding drafts'); passed++;
    settings._mangaMode.style = draftStyle;
    settings._mangaMode.studio.useChatChars = false;
    delete RBQ.api.collectMangaReferenceData;
    console.log('PASS Studio reuses complete ordinary memory without saving profiles and accepts full chat-completions endpoints'); passed++;
    console.log(`\n${passed} manga regression tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
