/** Structured text ownership uses neutral office dialogue and production functions.
 * Network, image generation and persistence boundaries are observed or mocked. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook, sdtSource, mangaSource } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,sdtSource,mangaSource};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const protocol = RBQ.api.mangaProtocol;
const story = '艾达在办公室把文件递给贝丝，说：“资料已收到。”贝丝回答：“请放到桌上。”走廊外有人提醒：“会议开始了。”';
const bubble = (text, type = 'speech', position = 'right-upper', layout = 'vertical') => ({ type, position, layout, text });
const text = value => manga.splitMangaText(value, false).text;
let passed = 0, saves = 0, images = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function reset(memory = false) {
    settings._mangaMode = { enabled: true, style: 'soft_color', grammar: 'cinema', gutter: 'bleed', language: 'zh-hans',
        dialogueMode: 'structured', autoSpread: true, antiHijack: true,
        studio: { ratio: '832x1216', panels: [], panelCountMode: 'auto', useChatChars: false } };
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga_narrative', multiCharOutput: true,
        characterMemoryEnabled: memory, characterProfiles: {}, injectCharacterCard: false, provider: 'openai',
        openaiBaseUrl: 'https://fixture.invalid/v1', openaiModel: 'fixture', customUrl: 'https://fixture.invalid/tagger', squashMessages: false };
    sdt.getMessageSnapshot = () => ({ mes: story, name: 'Narrator' });
    RBQ.api.getRecentMessages = () => [];
    sdt.save = () => { saves++; };
    RBQ.api.saveSettings = () => { saves++; };
    RBQ.api.generateImage = async () => { images++; throw new Error('ownership tests must never generate an image'); };
    saves = 0; images = 0;
    sdt.prepareNaiCharData(null);
}
function page() {
    return { format: 'nai5-comic', label: '办公室交谈', anchor: { text: '艾达在办公室把文件递给贝丝，说：“资料已收到。”' },
        page: { base: 'comic, 2girls, 1 panel, full-page panel, office, window light', bubbles: [] },
        panels: [{ id: 'P1', description: 'full-page panel, medium shot, office, wooden desk', bubbles: [], characters: [
            { character_id: 'C1', name: 'Ada (original)', base: 'girl, adult, long black hair', outfit: 'white shirt, dark trousers',
                positive: 'full-page panel, standing, right hand holding document, facing another', bubbles: [], negative: '' },
            { character_id: 'C2', name: 'Beth (original)', base: 'girl, adult, short blonde hair', outfit: 'blue jacket, black skirt',
                positive: 'full-page panel, sitting, facing another', bubbles: [], negative: '' }
        ] }] };
}
function invalidPage(owner = 'panel', type = 'speech') {
    const result = page();
    const target = owner === 'page' ? result.page : owner === 'character' ? result.panels[0].characters[0] : result.panels[0];
    target.bubbles = [bubble(owner === 'character' ? '第二天' : '资料已收到。', type)];
    return result;
}
function freshResult(pages = [invalidPage()]) {
    return { shouldDraw: true, reason: '办公室交谈', segments: pages, character_memory: [
        { name: 'Ada (original)', base: 'girl, adult, long black hair', outfit: 'white shirt, dark trousers' },
        { name: 'Beth (original)', base: 'girl, adult, short blonde hair', outfit: 'blue jacket, black skirt' }
    ] };
}
function envelope(channel, result) {
    return channel === 'custom HTTP' || channel === 'object' ? result
        : channel === 'OpenAI tool' ? { choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(result) } }] } }] }
        : channel === 'native tool' ? { candidates: [{ content: { parts: [{ functionCall: { name: 'generate_draw_spec', args: result } }] } }] }
        : { choices: [{ message: { content: JSON.stringify(result) } }] };
}
function ownershipError(error, utterance = '资料已收到。') {
    assert.match(error.message, /归属|人物.*bubbles|bubbles.*人物/);
    assert.equal(typeof error.rawOutput, 'string');
    assert.ok(error.rawOutput.includes(utterance), 'original returned text is available for diagnosis');
    return true;
}

(async () => {
    await test('schema restricts obvious page and character ownership while allowing supported offscreen panel voices', () => {
        reset();
        for (const ec of ['v_manga', 'v_manga_narrative']) {
            const schema = protocol.segmentSchema(undefined, ec);
            const p = schema.properties.page.properties.bubbles.items.properties.type.enum;
            const panel = schema.properties.panels.items.properties.bubbles.items.properties.type.enum;
            const person = schema.properties.panels.items.properties.characters.items.properties.bubbles.items.properties.type.enum;
            assert.deepEqual(clone(p).sort(), ['caption', 'sfx']);
            assert.ok(!person.includes('caption')); assert.ok(!person.includes('sfx'));
            for (const type of ['speech', 'thought', 'screaming', 'whisper', 'shiver', 'connected']) assert.ok(person.includes(type));
            assert.ok(!panel.includes('thought'));
            for (const type of ['speech', 'offscreen', 'broadcast', 'tailless', 'caption', 'sfx']) assert.ok(panel.includes(type));
            assert.doesNotMatch(JSON.stringify(schema), /uniqueItems/);
        }
        settings._mangaMode.dialogueMode = 'legacy';
        const schema = protocol.segmentSchema();
        assert.equal(schema.properties.page.properties.bubbles, undefined);
        assert.equal(schema.properties.panels.items.properties.bubbles, undefined);
    });
    await test('cached misplaced page speech remains literal, adds a warning and never guesses a visible speaker', () => {
        reset(); const input = invalidPage('page'), before = JSON.stringify(input);
        const compiled = manga.compileMangaPage(input);
        assert.equal(text(compiled.base), '资料已收到。');
        assert.ok(compiled.warnings.some(warning => /page/.test(warning) && /归属|人物/.test(warning)));
        assert.ok(compiled.characters.every(character => !text(character.caption)));
        assert.equal(JSON.stringify(input), before);
    });
    await test('cached misplaced panel speech remains literal with a warning instead of becoming an arbitrary character line', () => {
        reset(); const input = invalidPage(), before = JSON.stringify(input);
        const compiled = manga.compileMangaPage(input);
        assert.equal(text(compiled.base), '资料已收到。');
        assert.ok(compiled.warnings.some(warning => /P1/.test(warning) && /归属|人物/.test(warning)));
        assert.ok(compiled.characters.every(character => !text(character.caption)));
        assert.equal(JSON.stringify(input), before);
    });
    await test('cached character caption and panel thought retain their text with owner diagnostics', () => {
        reset();
        const character = manga.compileMangaPage(invalidPage('character', 'caption'));
        assert.equal(text(character.characters[0].caption), '第二天');
        assert.ok(character.warnings.some(warning => /C1/.test(warning) && /归属|人物/.test(warning)));
        const thought = manga.compileMangaPage(invalidPage('panel', 'thought'));
        assert.equal(text(thought.base), '资料已收到。');
        assert.ok(thought.warnings.some(warning => /P1/.test(warning) && /归属|人物/.test(warning)));
    });
    await test('visible dialogue stays exclusively in its character captions through the final NAI hooks', () => {
        reset(); const input = page();
        input.page.bubbles = [bubble('办公室', 'caption', 'top', 'horizontal')];
        input.panels[0].bubbles = [bubble('沙沙', 'sfx', 'bottom')];
        input.panels[0].characters[0].bubbles = [bubble('资料已收到。')];
        input.panels[0].characters[1].bubbles = [bubble('请放到桌上。', 'speech', 'left-lower')];
        const compiled = manga.compileMangaPage(input);
        assert.deepEqual(clone(compiled.warnings), []);
        assert.equal(text(compiled.base), '办公室\n\n沙沙');
        assert.equal(text(compiled.characters[0].caption), '资料已收到。');
        assert.equal(text(compiled.characters[1].caption), '请放到桌上。');
        const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [input] });
        sdt.prepareNaiCharData(result.segments[0]);
        const sent = mangaHook(sdtHook(payload(result.segments[0].scene)));
        assert.doesNotMatch(sent.input, /资料已收到|请放到桌上/);
        assert.match(sent.parameters.v4_prompt.caption.char_captions[0].char_caption, /Text: 资料已收到。$/);
        assert.match(sent.parameters.v4_prompt.caption.char_captions[1].char_caption, /Text: 请放到桌上。$/);
    });
    await test('explicit offscreen speech and nonperson panel types remain valid with no guessed character', () => {
        reset();
        for (const type of ['speech', 'screaming', 'whisper', 'shiver', 'connected']) for (const position of ['offscreen', '画面外']) {
            const input = page(); input.panels[0].bubbles = [bubble('会议开始了。', type, position)];
            const recovered = protocol.recoverResponseText([input]);
            const compiled = manga.compileMangaPage(recovered[0]);
            assert.equal(text(compiled.base), '会议开始了。');
            assert.deepEqual(clone(compiled.warnings), []);
            assert.ok(compiled.characters.every(character => !text(character.caption)));
        }
        for (const type of ['caption', 'sfx', 'offscreen', 'broadcast', 'tailless']) {
            const input = page(); input.panels[0].bubbles = [bubble('会议开始了。', type)];
            assert.doesNotThrow(() => protocol.recoverResponseText([input]));
            assert.deepEqual(clone(manga.compileMangaPage(input).warnings), []);
        }
    });
    await test('missing or false metadata defaults are accepted in valid owners and empty text has no ownership effect', () => {
        reset();
        for (const type of [undefined, false, '']) {
            const input = page(); input.panels[0].characters[0].bubbles = [{ type, text: '资料已收到。' }];
            assert.doesNotThrow(() => protocol.recoverResponseText([input]));
            assert.equal(text(manga.compileMangaPage(input).characters[0].caption), '资料已收到。');
            input.panels[0].characters[0].bubbles = [];
            input.panels[0].bubbles = [{ type, position: 'offscreen', text: '会议开始了。' }];
            assert.doesNotThrow(() => protocol.recoverResponseText([input]));
        }
        const input = page();
        input.page.bubbles = [bubble('  ', 'speech')];
        input.panels[0].bubbles = [bubble('\n', 'thought')];
        input.panels[0].characters[0].bubbles = [bubble('', 'caption')];
        assert.doesNotThrow(() => protocol.recoverResponseText([input]));
        const compiled = manga.compileMangaPage(input);
        assert.deepEqual(clone(compiled.warnings), []);
        assert.equal(text(compiled.base), '');
    });
    await test('fresh wrong page, panel and character owners fail before copying or silently moving dialogue', () => {
        reset();
        for (const [owner, type, utterance] of [['page', 'speech', '资料已收到。'], ['panel', 'speech', '资料已收到。'],
            ['panel', 'thought', '资料已收到。'], ['character', 'caption', '第二天'], ['character', 'sfx', '第二天']]) {
            const input = invalidPage(owner, type), before = JSON.stringify(input);
            assert.throws(() => protocol.recoverResponseText([input]), error => {
                ownershipError(error, utterance);
                assert.deepEqual(JSON.parse(error.rawOutput), [input], 'diagnostics preserve the original pages before compatibility recovery');
                return true;
            });
            assert.equal(JSON.stringify(input), before);
        }
    });
    await test('many ownership errors keep a compact message while preserving every location and original JSON', () => {
        reset();
        const pages = Array.from({ length: 3 }, (_, index) => {
            const input = page(), panel = input.panels[0];
            input.page.bubbles = [bubble(`第${index + 1}页的提醒。`)];
            panel.bubbles = [bubble(`资料${index + 1}已收到。`), bubble(`稍后查看${index + 1}。`, 'thought')];
            panel.characters[0].bubbles = [bubble(`日期${index + 1}`, 'caption'), bubble(`沙沙${index + 1}`, 'sfx')];
            panel.characters[1].bubbles = [bubble(`办公室${index + 1}`, 'caption')];
            return input;
        });
        const before = JSON.stringify(pages);
        assert.throws(() => protocol.validateResponseBubbles(pages), error => {
            assert.equal(error.code, 'MANGA_BUBBLE_OWNERSHIP');
            assert.match(error.message, /共 18 处/);
            assert.match(error.message, /另有 14 处/);
            assert.ok(error.message.length < 700, 'visible message stays bounded instead of repeating all instructions');
            assert.ok(Array.isArray(error.validationIssues));
            assert.equal(error.validationIssues.length, 18);
            assert.ok(error.validationIssues.some(issue => /第 3 页.*P1\/C2/.test(issue)), 'last issue remains in full diagnostics');
            assert.deepEqual(JSON.parse(error.rawOutput), pages);
            return true;
        });
        assert.equal(JSON.stringify(pages), before);
    });
    await test('legacy empty-bubble recovery still retains original text while editor clears remain authoritative', () => {
        reset(); const input = page();
        input.panels[0].characters[0].positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 资料已收到。';
        const recovered = protocol.recoverResponseText([input])[0];
        assert.equal(text(manga.compileMangaPage(recovered).characters[0].caption), '资料已收到。');
        assert.equal(text(manga.compileMangaPage(input).characters[0].caption), '');
        assert.ok(manga.compileMangaPage(recovered).warnings.length);
    });
    await test('authoritative structured silence suppresses stale legacy owner warnings while undefined bubbles retain legacy diagnostics', () => {
        reset(); const input = page(), panel = input.panels[0];
        panel.non_character = 'BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 资料已收到。';
        const cleared = manga.compileMangaPage(input);
        assert.equal(text(cleared.base), '');
        assert.ok(!cleared.warnings.some(warning => /non_character.*人物气泡/.test(warning)));
        delete panel.bubbles;
        const legacy = manga.compileMangaPage(input);
        assert.equal(text(legacy.base), '资料已收到。');
        assert.ok(legacy.warnings.some(warning => /P1.*non_character.*人物气泡/.test(warning)));
    });
    await test('edit validator allows identical inherited errors and corrected ownership without mutating either input', () => {
        reset();
        for (const [owner, type] of [['page', 'speech'], ['panel', 'speech'], ['character', 'caption']]) {
            const previous = invalidPage(owner, type), next = clone(previous), before = JSON.stringify(previous);
            assert.doesNotThrow(() => protocol.validateResponseBubbles([next], [previous]));
            assert.equal(JSON.stringify(previous), before);
            assert.equal(JSON.stringify(next), before);
        }
        const previous = invalidPage(), next = clone(previous);
        next.panels[0].characters[0].bubbles = next.panels[0].bubbles;
        next.panels[0].bubbles = [];
        assert.doesNotThrow(() => protocol.validateResponseBubbles([next], [previous]));
    });
    await test('edit validator rejects changed text, type, layout and position while allowing an explicit old-error clear', () => {
        reset(); const previous = invalidPage();
        for (const change of [row => { row.text = '请另存一份。'; }, row => { row.type = 'screaming'; },
            row => { row.layout = 'horizontal'; }, row => { row.position = 'left-lower'; }]) {
            const next = clone(previous); change(next.panels[0].bubbles[0]);
            assert.throws(() => protocol.validateResponseBubbles([next], [previous]), /文字归属错误/);
        }
        const cleared = clone(previous); cleared.panels[0].bubbles = [];
        assert.doesNotThrow(() => protocol.validateResponseBubbles([cleared], [previous]));
        assert.equal(text(manga.compileMangaPage(cleared).base), '');
        assert.throws(() => protocol.validateResponseBubbles([previous]), /文字归属错误/, 'no baseline means a new model error');
    });
    await test('edit validator uses inherited bubble counts so duplication cannot create another misplaced utterance', () => {
        reset(); const previous = invalidPage(), duplicate = clone(previous);
        duplicate.panels[0].bubbles.push(clone(duplicate.panels[0].bubbles[0]));
        assert.throws(() => protocol.validateResponseBubbles([duplicate], [previous]), /文字归属错误/);
        const previousDuplicate = clone(duplicate), fewer = clone(previousDuplicate);
        fewer.panels[0].bubbles.pop();
        assert.doesNotThrow(() => protocol.validateResponseBubbles([duplicate], [previousDuplicate]));
        assert.doesNotThrow(() => protocol.validateResponseBubbles([fewer], [previousDuplicate]));
    });
    await test('edit validator rejects inherited errors moved across page or panel locations', () => {
        reset();
        const previousPage = invalidPage('page'), otherPage = page();
        assert.throws(() => protocol.validateResponseBubbles([otherPage, previousPage], [previousPage, otherPage]), /文字归属错误/);
        const previous = invalidPage();
        const second = clone(previous.panels[0]); second.id = 'P2'; second.bubbles = [];
        previous.panels.push(second);
        const next = clone(previous);
        next.panels[1].bubbles = next.panels[0].bubbles;
        next.panels[0].bubbles = [];
        assert.throws(() => protocol.validateResponseBubbles([next], [previous]), /文字归属错误/);
        const swapped = clone(previous); swapped.panels.reverse();
        assert.throws(() => protocol.validateResponseBubbles([swapped], [previous]), /文字归属错误/);
    });
    await test('edit validator tracks character identity within a panel and does not mistake reordered appearances for new owners', () => {
        reset(); const previous = invalidPage('character', 'caption'), next = clone(previous);
        next.panels[0].characters[1].bubbles = next.panels[0].characters[0].bubbles;
        next.panels[0].characters[0].bubbles = [];
        assert.throws(() => protocol.validateResponseBubbles([next], [previous]), /文字归属错误/);
        const reordered = clone(previous); reordered.panels[0].characters.reverse();
        assert.doesNotThrow(() => protocol.validateResponseBubbles([reordered], [previous]));
    });
    for (const channel of ['object', 'OpenAI JSON', 'OpenAI tool', 'native tool']) {
        await test(`${channel} rejects a bad last page atomically before character memory and render cache writes`, () => {
            reset(true);
            const valid = page(); valid.panels[0].characters[0].bubbles = [bubble('资料已收到。')];
            const result = freshResult([valid, invalidPage()]);
            const response = envelope(channel, result), before = JSON.stringify(response);
            const profiles = clone(sdt.getCharacterProfiles());
            const renderCache = clone(settings._smartDrawTrigger.mangaRenderCache || null);
            assert.throws(() => sdt.normalizeTaggerResult(response, [], sdt.captureMangaRequestContext({ content: story }, 1)), ownershipError);
            assert.deepEqual(clone(sdt.getCharacterProfiles()), profiles);
            assert.deepEqual(clone(settings._smartDrawTrigger.mangaRenderCache || null), renderCache);
            assert.equal(saves, 0); assert.equal(images, 0);
            assert.equal(JSON.stringify(response), before);
        });
    }
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callOpenAiCompatible('), sdtSource.indexOf('    async function callCustomHttp(')), sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('), sdtSource.indexOf('    async function callStructuredCompletion(')), sdt);
    Object.assign(sdt, { normalizeBaseUrl: value => value, checkUrlSafety() {}, logTaggerPayload() {},
        validateStructuredResult: value => value, safeReadJsonResponse: async response => response.json(),
        getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {}, buildThinkingParams: () => ({}),
        DRAW_SPEC_TOOL_RULE: 'Submit final results via generate_draw_spec' });
    for (const channel of ['custom HTTP', 'OpenAI JSON', 'OpenAI tool']) {
        await test(`${channel} surfaces fresh ownership error with original output after exactly one mocked request`, async () => {
            reset(true); settings._smartDrawTrigger.provider = channel === 'custom HTTP' ? 'custom' : 'openai';
            settings._smartDrawTrigger.toolCallMode = channel === 'OpenAI tool';
            let calls = 0;
            const receive = () => { calls++; return { ok: true, headers: { get: () => 'application/json' }, json: async () => envelope(channel, freshResult()) }; };
            sdt.smartFetch = async () => receive();
            sdt.callApiWithJsonFallback = async () => receive();
            const pending = channel === 'custom HTTP' ? sdt.callCustomHttp(1, { type: 'auto' }) : sdt.callOpenAiCompatible(1, { type: 'auto' });
            await assert.rejects(pending, ownershipError);
            assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
            assert.deepEqual(clone(sdt.getCharacterProfiles()), {});
        });
    }
    await test('Studio rejects a fresh misplaced line once and preserves its existing draft and diagnostic output', async () => {
        reset();
        settings._smartDrawTrigger.toolCallMode = true;
        const store = settings._mangaMode, draft = page().panels;
        store.studio.panels = clone(draft);
        const before = JSON.stringify(store.studio.panels);
        let calls = 0;
        RBQ.api.callStructuredCompletion = async request => {
            calls++;
            const schema = request.tool.function.parameters;
            assert.deepEqual(clone(schema.properties.page.properties.bubbles.items.properties.type.enum).sort(), ['caption', 'sfx']);
            const invalid = invalidPage();
            return { rawReply: JSON.stringify({ page: invalid.page, panels: invalid.panels }) };
        };
        await assert.rejects(manga.requestStudioPanels(store, '办公室交谈', story, 1), ownershipError);
        assert.equal(calls, 1); assert.equal(JSON.stringify(store.studio.panels), before);
        assert.equal(saves, 0); assert.equal(images, 0);
        delete RBQ.api.callStructuredCompletion;
    });
    await test('Studio requestStudioPanels auto-heals misplaced bubbles when allowAutoHeal is true', async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = true;
        const invalid = invalidPage(), store = settings._mangaMode;
        let calls = 0;
        RBQ.api.callStructuredCompletion = async () => {
            calls++;
            return { rawReply: JSON.stringify({ page: invalid.page, panels: invalid.panels }) };
        };
        const panels = await manga.requestStudioPanels(store, '办公室交谈', story, 1, false, null, null, true);
        assert.equal(calls, 1);
        assert.equal(panels.length, 1);
        assert.equal(panels[0].characters[0].bubbles[0].text, '资料已收到。');
        assert.equal(panels[0].bubbles.length, 0);
        delete RBQ.api.callStructuredCompletion;
    });
    await test('Studio editing keeps a cached misplaced line available for explicit repair without guessing its speaker', async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = true;
        const invalid = invalidPage(), before = JSON.stringify(invalid), store = settings._mangaMode;
        let calls = 0;
        RBQ.api.callStructuredCompletion = async () => { calls++; return { rawReply: JSON.stringify({ page: invalid.page, panels: invalid.panels }) }; };
        const panels = await manga.requestStudioPanels(store, '保留已有文字进行编辑', JSON.stringify({ panels: invalid.panels }), 1, true);
        assert.equal(calls, 1); assert.equal(JSON.stringify(invalid), before);
        store.studio.panels = panels;
        const compiled = manga.compileMangaPage(manga.buildStudioPage(store));
        assert.equal(text(compiled.base), '资料已收到。');
        assert.ok(compiled.characters.every(character => !text(character.caption)));
        assert.ok(compiled.warnings.some(warning => /P1/.test(warning) && /归属|人物/.test(warning)));
        delete RBQ.api.callStructuredCompletion;
    });
    for (const changed of [false, true]) await test(`Studio edit rejects ${changed ? 'modified inherited' : 'newly introduced'} wrong dialogue and preserves the draft`, async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = true;
        const original = changed ? invalidPage() : page(), returned = invalidPage(), store = settings._mangaMode;
        if (changed) returned.panels[0].bubbles[0].text = '请另存一份。';
        store.studio.panels = clone(original.panels);
        const before = JSON.stringify(store.studio.panels);
        let calls = 0;
        RBQ.api.callStructuredCompletion = async () => { calls++; return { rawReply: JSON.stringify({ page: returned.page, panels: returned.panels }) }; };
        try {
            await assert.rejects(manga.requestStudioPanels(store, '调整文件动作', JSON.stringify({ page: original.page, panels: original.panels }), 1, true),
                error => ownershipError(error, changed ? '请另存一份。' : '资料已收到。'));
            assert.equal(calls, 1); assert.equal(JSON.stringify(store.studio.panels), before);
            assert.equal(saves, 0); assert.equal(images, 0);
        } finally { delete RBQ.api.callStructuredCompletion; }
    });
    await test('Studio edit preserves intentional empty arrays rather than restoring an old literal utterance', async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = true;
        const input = page(), store = settings._mangaMode;
        input.panels[0].characters[0].positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 资料已收到。';
        RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify({ page: input.page, panels: input.panels }) });
        try {
            const panels = await manga.requestStudioPanels(store, '明确清空台词', JSON.stringify({ page: input.page, panels: input.panels }), 1, true);
            store.studio.panels = panels;
            const compiled = manga.compileMangaPage(manga.buildStudioPage(store));
            assert.equal(text(compiled.characters[0].caption), '');
            assert.equal(text(compiled.base), '');
        } finally { delete RBQ.api.callStructuredCompletion; }
    });
    await test('Studio prompt preview surfaces cached ownership warnings beside capacity notes and clears them after repair', () => {
        reset();
        const store = settings._mangaMode, studio = store.studio, invalid = invalidPage();
        studio.panels = invalid.panels.map(manga.studioPanelFromProtocol);
        studio.capacityNote = '可将会议转场放到下一页。';
        const preview = manga.studioPromptPreview(store);
        assert.equal(typeof preview.prompt, 'string');
        assert.ok(preview.note.includes(studio.capacityNote));
        assert.ok(preview.warnings.some(warning => /P1.*文字归属错误/.test(warning)));
        assert.doesNotMatch(preview.prompt, /文字归属错误|可将会议转场/);
        const note = { hidden: true, textContent: '' }, prompt = { textContent: '' };
        const prior = { store: manga.store, studio: manga.studio, container: manga.container, promptPreviewEl: manga.promptPreviewEl };
        Object.assign(manga, { store, studio, container: { querySelector: selector => selector === '#rbq-manga-capacity-note' ? note : null }, promptPreviewEl: prompt });
        const start = mangaSource.indexOf('        function updatePromptPreview() {');
        const end = mangaSource.indexOf('        function updateViewport()', start);
        assert.ok(start >= 0 && end > start);
        try {
            vm.runInContext(mangaSource.slice(start, end), manga);
            manga.updatePromptPreview();
            assert.equal(note.hidden, false);
            assert.match(note.textContent, /文字归属错误/);
            assert.ok(note.textContent.includes(studio.capacityNote));
            assert.equal(prompt.textContent, preview.prompt);
            studio.panels[0].bubbles = [];
            assert.match(studio.panels[0].non_character, /Text: 资料已收到。/, 'the legacy preview mirror is deliberately left intact');
            manga.updatePromptPreview();
            assert.doesNotMatch(note.textContent, /文字归属错误/);
            assert.doesNotMatch(note.textContent, /non_character.*人物气泡/);
            assert.equal(text(manga.compileMangaPage(manga.buildStudioPage(store)).base), '');
            assert.equal(note.hidden, false, 'the capacity note still has content');
            studio.capacityNote = '';
            manga.updatePromptPreview();
            assert.equal(note.hidden, true);
            assert.equal(note.textContent, '');
        } finally { Object.assign(manga, prior); }
    });
    sdt.prepareNaiCharData(null);
    console.log(`\n${passed} bubble-ownership tests passed; no live calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
