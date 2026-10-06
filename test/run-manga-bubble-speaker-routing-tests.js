/** Explicit speaker IDs route neutral office dialogue through production code.
 * Network, persistence and image boundaries are mocked or observed. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook, sdtSource } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,sdtSource};')(require, __dirname);
const protocol = RBQ.api.mangaProtocol;
const clone = value => JSON.parse(JSON.stringify(value));
const story = '艾达把文件交给贝丝。贝丝说：“请放到桌上。”走廊外的克莱尔提醒：“会议开始了。”';
const bubble = (text = '请放到桌上。', speaker_id, type = 'speech', position = 'right-upper') =>
    ({ type, position, layout: 'vertical', text, ...(speaker_id === undefined ? {} : { speaker_id }) });
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
    RBQ.api.generateImage = async () => { images++; throw new Error('speaker tests must never generate an image'); };
    saves = 0; images = 0;
    sdt.prepareNaiCharData(null);
}
function page() {
    return { format: 'nai5-comic', label: '办公室交谈', anchor: { text: '艾达把文件交给贝丝。' },
        page: { base: 'comic, 2girls, 1 panel, full-page panel, office, window light', bubbles: [] },
        panels: [{ id: 'P1', description: 'full-page panel, medium shot, office, wooden desk', bubbles: [], characters: [
            { character_id: 'C1', name: 'Ada (original)', base: 'girl, adult, long black hair', outfit: 'white shirt, dark trousers',
                positive: 'full-page panel, standing, right hand holding document, facing another', bubbles: [], negative: '' },
            { character_id: 'C2', name: 'Beth (original)', base: 'girl, adult, short blonde hair', outfit: 'blue jacket, black skirt',
                positive: 'full-page panel, sitting, facing another', bubbles: [], negative: '' }
        ] }] };
}
function routedPage() { const result = page(); result.panels[0].bubbles = [bubble('请放到桌上。', 'C2')]; return result; }
function otherPage() {
    const result = page(); result.label = '走廊提醒'; result.panels[0].characters = [
        { character_id: 'C3', name: 'Claire (original)', base: 'girl, adult, brown hair', outfit: 'gray suit',
            positive: 'full-page panel, standing in hallway', bubbles: [], negative: '' }
    ]; result.page.base = 'comic, 1girl, 1 panel, full-page panel, hallway'; return result;
}
function freshResult(pages) {
    return { shouldDraw: true, reason: '办公室交谈', segments: pages,
        character_memory: page().panels[0].characters.map(({ name, base, outfit }) => ({ name, base, outfit })) };
}
function envelope(channel, result) {
    return channel === 'custom HTTP' || channel === 'object' ? result
        : channel === 'OpenAI tool' ? { choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(result) } }] } }] }
        : channel === 'native tool' ? { candidates: [{ content: { parts: [{ functionCall: { name: 'generate_draw_spec', args: result } }] } }] }
        : { choices: [{ message: { content: JSON.stringify(result) } }] };
}
function speakerError(originalPages) {
    return error => {
        assert.equal(error.code, 'MANGA_BUBBLE_SPEAKER');
        assert.equal(typeof error.rawOutput, 'string');
        if (originalPages) assert.deepEqual(JSON.parse(error.rawOutput), originalPages, 'speaker diagnostics keep the unmodified returned pages');
        return true;
    };
}
function assertRouted(result, utterance = '请放到桌上。') {
    assert.deepEqual(clone(result.panels[0].bubbles), []);
    assert.deepEqual(clone(result.panels[0].characters[0].bubbles), []);
    assert.equal(result.panels[0].characters[1].bubbles[0].text, utterance);
    const compiled = manga.compileMangaPage(result);
    assert.equal(text(compiled.base), '');
    assert.equal(text(compiled.characters[0].caption), '');
    assert.equal(text(compiled.characters[1].caption), utterance.trim());
    assert.ok(!compiled.warnings.some(warning => /文字归属错误/.test(warning)));
}

(async () => {
    await test('speaker IDs are optional in both structured person owners and absent from legacy schemas', () => {
        reset();
        for (const ec of ['v_manga', 'v_manga_narrative']) {
            const schema = protocol.segmentSchema(undefined, ec), panel = schema.properties.panels.items;
            for (const owner of [panel.properties.bubbles, panel.properties.characters.items.properties.bubbles]) {
                assert.equal(owner.items.properties.speaker_id.type, 'string');
                assert.ok(!owner.items.required.includes('speaker_id'));
            }
        }
        settings._mangaMode.dialogueMode = 'legacy';
        assert.equal(protocol.segmentSchema().properties.panels.items.properties.bubbles, undefined);
    });
    await test('canonicalization returns a deep clone and leaves valid old responses without speaker IDs intact', () => {
        reset(); const input = page(); input.panels[0].characters[0].bubbles = [bubble('资料已收到。')];
        const before = clone([input]), normalized = protocol.normalizeResponseBubbles([input]);
        assert.deepEqual(clone(normalized), before);
        assert.notEqual(normalized[0], input); assert.notEqual(normalized[0].panels[0], input.panels[0]);
        normalized[0].panels[0].characters[0].bubbles[0].text = '另一份资料。';
        assert.deepEqual([input], before);
    });
    await test('a panel line without an ID never guesses the first or only visible character', () => {
        reset();
        for (const count of [1, 2]) {
            const input = routedPage(); delete input.panels[0].bubbles[0].speaker_id;
            input.panels[0].characters.length = count;
            assert.deepEqual(clone(protocol.normalizeResponseBubbles([input])), [input]);
            assert.throws(() => protocol.recoverResponseText([input]), error => error.code === 'MANGA_BUBBLE_OWNERSHIP');
            const compiled = manga.compileMangaPage(input);
            assert.equal(text(compiled.base), '请放到桌上。');
            assert.ok(compiled.characters.every(character => !text(character.caption)));
        }
    });
    await test('an explicit same-panel ID moves a misplaced line only to its named visible character', () => {
        reset(); const input = routedPage(), before = clone([input]);
        assertRouted(protocol.normalizeResponseBubbles([input])[0]);
        assertRouted(protocol.recoverResponseText([input])[0]);
        assert.deepEqual([input], before);
        const cached = manga.compileMangaPage(input);
        assert.equal(text(cached.base), '请放到桌上。', 'compiling a cached page alone does not silently rewrite its editable owners');
        assert.ok(cached.characters.every(character => !text(character.caption)));
    });
    await test('routing supports the person bubble vocabulary and native Japanese metadata without changing text', () => {
        reset();
        for (const type of ['speech', 'screaming', 'thought', 'whisper', 'shiver', 'connected', 'broadcast', 'tailless', '通常吹き出し', false, '', undefined]) {
            const input = routedPage(); input.panels[0].bubbles[0].type = type;
            input.panels[0].bubbles[0].text = '原文 Text: "请放到桌上。"\n第二句。';
            const result = protocol.recoverResponseText([input])[0];
            assertRouted(result, input.panels[0].bubbles[0].text);
            assert.equal(result.panels[0].characters[1].bubbles[0].type, type);
        }
    });
    await test('explicit offscreen semantics stay in panel even when the ID is visible in the same panel', () => {
        reset();
        for (const [type, position] of [['speech', 'offscreen'], ['speech', '画面外'], ['offscreen', 'right-upper'], ['切り欠きのある吹き出し', 'right-upper']]) {
            const input = page(); input.panels[0].bubbles = [bubble('会议开始了。', 'C2', type, position)];
            const result = protocol.recoverResponseText([input])[0];
            assert.deepEqual(clone(result.panels[0].bubbles), input.panels[0].bubbles);
            assert.ok(result.panels[0].characters.every(character => !character.bubbles.length));
            assert.equal(text(manga.compileMangaPage(result).base), '会议开始了。');
        }
    });
    await test('offscreen speaker IDs can be known on another page without creating an extra visible appearance', () => {
        reset(); const input = page(), known = otherPage();
        input.panels[0].bubbles = [bubble('会议开始了。', 'C3', 'speech', 'offscreen')];
        const result = protocol.recoverResponseText([input, known]);
        assert.deepEqual(clone(result[0].panels[0].bubbles), input.panels[0].bubbles);
        assert.deepEqual(clone(result[0].panels[0].characters.map(character => character.character_id)), ['C1', 'C2']);
        assert.ok(result[1].panels[0].characters.every(character => !character.bubbles.length));
    });
    await test('editing may identify a retained offscreen speaker from the supplied baseline pages', () => {
        reset(); const input = page(), previous = otherPage();
        input.panels[0].bubbles = [bubble('会议开始了。', 'C3', 'offscreen')];
        const result = protocol.normalizeResponseBubbles([input], [previous]);
        assert.deepEqual(clone(result), [input]);
        assert.doesNotThrow(() => protocol.validateResponseBubbles(result, [previous]));
    });
    await test('broadcast or tailless without IDs keep their old supported panel ownership', () => {
        reset();
        for (const type of ['broadcast', 'tailless']) {
            const input = page(); input.panels[0].bubbles = [bubble('会议开始了。', undefined, type)];
            assert.deepEqual(clone(protocol.recoverResponseText([input])[0].panels[0].bubbles), input.panels[0].bubbles);
        }
    });
    await test('empty known-speaker bubbles stay empty at their original owner and whole-page speech never routes', () => {
        reset(); const empty = page(); empty.panels[0].bubbles = [bubble('  \n', 'C2')];
        assert.deepEqual(clone(protocol.normalizeResponseBubbles([empty])), [empty]);
        const whole = page(); whole.page.bubbles = [bubble('请放到桌上。', 'C2')];
        const before = clone([whole]);
        assert.throws(() => protocol.recoverResponseText([whole]), error => {
            assert.ok(['MANGA_BUBBLE_OWNERSHIP', 'MANGA_BUBBLE_SPEAKER'].includes(error.code));
            assert.deepEqual(JSON.parse(error.rawOutput), before); return true;
        });
        assert.deepEqual([whole], before);
    });
    await test('unknown IDs fail for visible, offscreen and character bubbles without mutating input', () => {
        reset();
        for (const owner of ['panel', 'offscreen', 'character']) {
            const input = page(), target = owner === 'character' ? input.panels[0].characters[0] : input.panels[0];
            target.bubbles = [bubble('未知人物的提醒。', 'UNKNOWN', 'speech', owner === 'offscreen' ? 'offscreen' : 'right-upper')];
            const before = clone([input]);
            assert.throws(() => protocol.normalizeResponseBubbles([input]), speakerError(before));
            assert.deepEqual([input], before);
        }
    });
    await test('known but nonvisible speech IDs still require an explicit offscreen declaration', () => {
        reset(); const input = page(); input.panels[0].bubbles = [bubble('会议开始了。', 'C3')];
        assert.throws(() => protocol.recoverResponseText([input, otherPage()]), error => ['MANGA_BUBBLE_OWNERSHIP', 'MANGA_BUBBLE_SPEAKER'].includes(error.code));
    });
    await test('same-panel duplicate target IDs reject routing while repeated IDs across appearances remain valid', () => {
        reset(); const input = routedPage(); input.panels[0].characters[0].character_id = 'C2';
        const before = clone([input]);
        assert.throws(() => protocol.normalizeResponseBubbles([input]), speakerError(before));
        assert.deepEqual([input], before);
        const valid = routedPage();
        valid.panels.push({ ...clone(valid.panels[0]), id: 'P2', bubbles: [] });
        assert.doesNotThrow(() => protocol.recoverResponseText([valid]));
        assertRouted(protocol.recoverResponseText([valid])[0]);
    });
    await test('a character bubble explicit ID must match its owner and cannot silently move to another person', () => {
        reset(); const input = page(); input.panels[0].characters[0].bubbles = [bubble('资料已收到。', 'C2')];
        const before = clone([input]);
        assert.throws(() => protocol.normalizeResponseBubbles([input]), speakerError(before));
        assert.deepEqual([input], before);
        input.panels[0].characters[0].bubbles[0].speaker_id = 'C1';
        assert.deepEqual(clone(protocol.recoverResponseText([input])), [input]);
    });
    await test('caption and SFX cannot claim a person speaker ID', () => {
        reset();
        for (const owner of ['panel', 'character']) for (const type of ['caption', 'sfx']) {
            const input = page(), target = owner === 'panel' ? input.panels[0] : input.panels[0].characters[0];
            target.bubbles = [bubble('文件夹', 'C1', type)];
            assert.throws(() => protocol.normalizeResponseBubbles([input]), speakerError([input]));
        }
    });
    await test('routing never guesses the ordering relative to already rendered destination dialogue', () => {
        reset();
        for (const legacy of [false, true]) {
            const input = routedPage(), target = input.panels[0].characters[1];
            if (legacy) target.positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 请另存一份。';
            else target.bubbles = [bubble('请另存一份。', 'C2')];
            const before = clone([input]);
            assert.throws(() => protocol.normalizeResponseBubbles([input]), speakerError(before));
            assert.deepEqual([input], before);
        }
    });
    await test('several moves preserve source reading order and literal text exactly once without routing captions', () => {
        reset(); const input = page(); input.panels[0].bubbles = [
            bubble('先交给你。', 'C1'), bubble('办公室', undefined, 'caption', 'top'),
            bubble('请放到桌上。', 'C2'), bubble('还有一份。', 'C1'), bubble('沙沙', undefined, 'sfx', 'bottom')
        ];
        const result = protocol.recoverResponseText([input])[0];
        assert.deepEqual(clone(result.panels[0].characters[0].bubbles.map(item => item.text)), ['先交给你。', '还有一份。']);
        assert.deepEqual(clone(result.panels[0].characters[1].bubbles.map(item => item.text)), ['请放到桌上。']);
        assert.deepEqual(clone(result.panels[0].bubbles.map(item => item.text)), ['办公室', '沙沙']);
        const compiled = manga.compileMangaPage(result), allText = [text(compiled.base), ...compiled.characters.map(item => text(item.caption))].join('\n');
        for (const item of input.panels[0].bubbles) assert.equal(allText.split(item.text).length - 1, 1);
        assert.equal(text(compiled.base), '办公室\n\n沙沙');
    });
    await test('a routed panel empty array stays authoritative over a stale legacy mirror of the moved line', () => {
        reset(); const input = routedPage();
        input.panels[0].non_character = 'paper texture, BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 请放到桌上。';
        const result = protocol.recoverResponseText([input])[0];
        assertRouted(result);
        assert.deepEqual(clone(result.panels[0].bubbles), []);
        assert.match(manga.compileMangaPage(result).base, /paper texture/, 'removing the shadowed old text preserves nonperson visuals');
    });
    await test('array-valued panel legacy mirrors cannot resurrect a routed utterance and keep only supported visual strings', () => {
        reset(); const input = routedPage();
        input.panels[0].non_character = ['paper texture', null, 42,
            'BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 请放到桌上。'];
        const before = clone([input]), result = protocol.recoverResponseText([input])[0];
        assertRouted(result);
        assert.deepEqual(clone(result.panels[0].bubbles), []);
        const compiled = manga.compileMangaPage(result);
        assert.match(compiled.base, /paper texture/);
        assert.doesNotMatch(compiled.base, /请放到桌上|\b42\b|null/);
        assert.equal(typeof result.panels[0].non_character, 'string');
        assert.deepEqual([input], before);
    });
    await test('SDT routing reaches the final NAI character caption without speaker metadata or duplicated base text', () => {
        reset(); const input = routedPage(), result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [input] });
        assertRouted(result.segments[0].mangaPage);
        sdt.prepareNaiCharData(result.segments[0]);
        const sent = mangaHook(sdtHook(payload(result.segments[0].scene)));
        assert.doesNotMatch(sent.input, /请放到桌上|speaker_id|C2/);
        assert.match(sent.parameters.v4_prompt.caption.char_captions[1].char_caption, /Text: 请放到桌上。$/);
        assert.doesNotMatch(sent.parameters.v4_prompt.caption.char_captions[1].char_caption, /speaker_id|\bC2\b/);
    });
    for (const channel of ['object', 'OpenAI JSON', 'OpenAI tool', 'native tool']) {
        await test(`${channel} fails atomically on a late unknown ID before memory or render-cache writes`, () => {
            reset(true); const valid = routedPage(), invalid = page();
            invalid.panels[0].bubbles = [bubble('未知人物的提醒。', 'UNKNOWN')];
            const returned = freshResult([valid, invalid]), response = envelope(channel, returned), before = clone(response);
            const profiles = clone(sdt.getCharacterProfiles()), cache = clone(settings._smartDrawTrigger.mangaRenderCache || null);
            assert.throws(() => sdt.normalizeTaggerResult(response, [], sdt.captureMangaRequestContext({ content: story }, 1)), speakerError());
            assert.deepEqual(clone(sdt.getCharacterProfiles()), profiles);
            assert.deepEqual(clone(settings._smartDrawTrigger.mangaRenderCache || null), cache);
            assert.equal(saves, 0); assert.equal(images, 0); assert.deepEqual(response, before);
        });
    }
    await test('duplicate destinations and conflicting character speaker IDs also fail atomically after an earlier valid page', () => {
        for (const duplicate of [true, false]) {
            reset(true); const invalid = duplicate ? routedPage() : page();
            if (duplicate) invalid.panels[0].characters[0].character_id = 'C2';
            else invalid.panels[0].characters[0].bubbles = [bubble('资料已收到。', 'C2')];
            const result = freshResult([routedPage(), invalid]), before = clone(result);
            assert.throws(() => sdt.normalizeTaggerResult(result, [], sdt.captureMangaRequestContext({ content: story }, 1)), speakerError(before.segments));
            assert.deepEqual(result, before); assert.deepEqual(clone(sdt.getCharacterProfiles()), {});
            assert.equal(settings._smartDrawTrigger.mangaRenderCache, undefined);
            assert.equal(saves, 0); assert.equal(images, 0);
        }
    });
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callOpenAiCompatible('), sdtSource.indexOf('    async function callCustomHttp(')), sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('), sdtSource.indexOf('    async function callStructuredCompletion(')), sdt);
    Object.assign(sdt, { normalizeBaseUrl: value => value, checkUrlSafety() {}, logTaggerPayload() {},
        validateStructuredResult: value => value, safeReadJsonResponse: async response => response.json(),
        getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {}, buildThinkingParams: () => ({}),
        DRAW_SPEC_TOOL_RULE: 'Submit final results via generate_draw_spec' });
    for (const channel of ['custom HTTP', 'OpenAI JSON', 'OpenAI tool']) {
        await test(`${channel} uses the shared optional speaker contract and routes one real mocked response`, async () => {
            reset(); settings._smartDrawTrigger.provider = channel === 'custom HTTP' ? 'custom' : 'openai';
            settings._smartDrawTrigger.toolCallMode = channel === 'OpenAI tool';
            let calls = 0;
            const receive = body => {
                calls++;
                const request = channel === 'custom HTTP' ? body : JSON.parse(body.messages.find(message => message.role === 'user').content);
                const examplePanel = request.outputSchema.segments[0].panels[0];
                for (const person of examplePanel.characters) {
                    assert.ok(person.bubbles.some(item => item.speaker_id === person.character_id), 'the outgoing example teaches a self-matching speaker reference');
                }
                const instruction = channel === 'custom HTTP' ? request.mangaInstruction : body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
                assert.match(instruction, /speaker_id/);
                if (channel === 'OpenAI tool') {
                    const panel = body.tools[0].function.parameters.properties.segments.items.properties.panels.items;
                    assert.equal(panel.properties.bubbles.items.properties.speaker_id.type, 'string');
                    assert.ok(!panel.properties.bubbles.items.required.includes('speaker_id'));
                }
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => envelope(channel, freshResult([routedPage()])) };
            };
            sdt.smartFetch = async (_url, options) => receive(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => receive(body);
            const result = channel === 'custom HTTP' ? await sdt.callCustomHttp(1, { type: 'auto' }) : await sdt.callOpenAiCompatible(1, { type: 'auto' });
            assert.equal(calls, 1); assert.equal(images, 0); assertRouted(result.segments[0].mangaPage);
            assert.ok(result.rawOutput.includes('speaker_id'), 'SDT debug output keeps the original model reply');
        });
    }
    await test('Studio fresh requests route explicit IDs while retaining the original response for diagnostics', async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = true;
        const input = routedPage(), store = settings._mangaMode, before = clone(input); let calls = 0;
        RBQ.api.callStructuredCompletion = async request => {
            calls++;
            assert.equal(request.tool.function.parameters.properties.panels.items.properties.bubbles.items.properties.speaker_id.type, 'string');
            return { rawReply: JSON.stringify({ page: input.page, panels: input.panels, capacity_note: '下一页继续会议转场。' }) };
        };
        try {
            store.studio.panels = await manga.requestStudioPanels(store, '办公室交谈', story, 1);
            const compiled = manga.compileMangaPage(manga.buildStudioPage(store));
            assert.equal(text(compiled.base), ''); assert.equal(text(compiled.characters[1].caption), '请放到桌上。');
            assert.equal(calls, 1); assert.equal(images, 0); assert.deepEqual(input, before);
            assert.ok(store.studio._lastDebug.rawOutput.includes('speaker_id'));
            assert.equal(store.studio._lastDebug.data.panels[0].bubbles[0].speaker_id, 'C2', 'diagnostics retain the original panel owner');
            assert.ok(store.studio.panels.capacityNote.includes('下一页继续会议转场。'));
            assert.match(store.studio.panels.capacityNote, /speaker_id=C2.*归回/);
            manga.applyStudioPagePlan(store, store.studio.panels, true);
            const preview = manga.studioPromptPreview(store);
            assert.match(preview.note, /speaker_id=C2.*归回/, 'the applied fresh repair is visible through the actual Studio note builder');
            assert.ok(preview.note.includes('下一页继续会议转场。'));
            assert.doesNotMatch(preview.prompt, /speaker_id=C2|归回对应人物|下一页继续会议转场/);
        } finally { delete RBQ.api.callStructuredCompletion; }
    });
    await test('Studio edits route a new explicit line before ownership validation and preserve the old draft on ID errors', async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = true;
        const store = settings._mangaMode, original = page(), returned = routedPage();
        store.studio.panels = clone(original.panels);
        RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify({ page: returned.page, panels: returned.panels }) });
        try {
            const result = await manga.requestStudioPanels(store, '补充贝丝对白', JSON.stringify({ page: original.page, panels: original.panels }), 1, true);
            assert.deepEqual(clone(result[0].bubbles), []);
            assert.equal(result[0].characters[1].bubbles[0].text, '请放到桌上。');
            returned.panels[0].bubbles[0].speaker_id = 'UNKNOWN';
            const before = clone(store.studio.panels);
            await assert.rejects(manga.requestStudioPanels(store, '补充对白', JSON.stringify({ page: original.page, panels: original.panels }), 1, true), speakerError());
            assert.deepEqual(clone(store.studio.panels), before);
            assert.equal(saves, 0); assert.equal(images, 0);
        } finally { delete RBQ.api.callStructuredCompletion; }
    });
    await test('Studio editing explicit empty arrays still clear old literal dialogue instead of invoking fresh recovery', async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = true;
        const store = settings._mangaMode, input = page();
        input.panels[0].characters[1].positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 请放到桌上。';
        RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify({ page: input.page, panels: input.panels }) });
        try {
            store.studio.panels = await manga.requestStudioPanels(store, '明确清空台词', JSON.stringify({ page: input.page, panels: input.panels }), 1, true);
            const compiled = manga.compileMangaPage(manga.buildStudioPage(store));
            assert.equal(text(compiled.base), ''); assert.ok(compiled.characters.every(character => !text(character.caption)));
        } finally { delete RBQ.api.callStructuredCompletion; }
    });
    sdt.prepareNaiCharData(null);
    console.log(`\n${passed} explicit-speaker routing tests passed; no live calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
