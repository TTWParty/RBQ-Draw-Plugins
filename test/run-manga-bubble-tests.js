/** Ordinary comic text regressions against production code. No network/image calls. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, mangaHook, sdtHook, fixture, payload, settings, RBQ, vm, sdtSource } = new Function('require', '__dirname', harness + '\nreturn { manga, sdt, mangaHook, sdtHook, fixture, payload, settings, RBQ, vm, sdtSource };')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('PASS ' + name); };
const bubble = (text, type = 'speech', position = 'right-upper', layout = 'vertical') => ({ type, position, layout, text });
const literal = value => value.slice(value.indexOf('Text: ') + 6);
function pageFixture() {
    const page = fixture();
    delete page.page.non_character;
    page.panels = [page.panels[0]];
    page.page.base = 'comic, 1 panel, 2girls';
    for (const c of page.panels[0].characters) c.positive = 'girl, standing, looking at another';
    return page;
}

test('speech and thought compile before one Text tail with actual blank lines', () => {
    const page = pageFixture(), c = page.panels[0].characters[0];
    c.bubbles = [bubble('信收到了。'), bubble('终于等到了。', 'thought', 'left-lower')];
    const caption = manga.compileMangaPage(page).characters[0].caption;
    assert.equal(literal(caption), '信收到了。\n\n终于等到了。');
    assert.equal((caption.match(/Text: /g) || []).length, 1);
    assert.match(caption, /BubbleType: 通常吹き出し, 右上, Layout: 縦書き, BubbleType: 思考の吹き出し, 左下, Layout: 縦書き\nText:/);
});
test('two visible speakers and non-person text stay in their own slots', () => {
    const page = pageFixture();
    page.panels[0].characters[0].bubbles = [bubble('一起回家吧。')];
    page.panels[0].characters[1].bubbles = [bubble('好。', 'speech', 'left-lower')];
    page.panels[0].bubbles = [bubble('咔哒', 'sfx', 'bottom')];
    page.page.bubbles = [bubble('放学后', 'caption', 'top', 'horizontal')];
    const compiled = manga.compileMangaPage(page);
    assert.equal(literal(compiled.characters[0].caption), '一起回家吧。');
    assert.equal(literal(compiled.characters[1].caption), '好。');
    assert.equal(literal(compiled.base), '放学后\n\n咔哒');
    assert.match(compiled.base, /SFX: 擬音, 吹き出しなし, 下部, Layout: 縦書き/);
    assert.doesNotMatch(compiled.base, /一起回家|好。/);
});
test('explicit bubbles replace stale legacy text and metadata without duplicate instructions', () => {
    const page = pageFixture(), c = page.panels[0].characters[0];
    c.positive += ', BubbleType: 叫び吹き出し, 左下, Layout: 横書き, Text: 旧句';
    c.bubbles = [bubble('新句')];
    const caption = manga.compileMangaPage(page).characters[0].caption;
    assert.equal(literal(caption), '新句');
    assert.doesNotMatch(caption, /叫び|横書き|左下|旧句/);
    assert.equal((caption.match(/BubbleType:/g) || []).length, 1);
});
test('explicit empty list clears legacy speech while omitted list remains compatible', () => {
    const page = fixture();
    page.panels[0].characters[0].bubbles = [];
    page.page.bubbles = [];
    page.panels[2].bubbles = [];
    const compiled = manga.compileMangaPage(page);
    assert.doesNotMatch(compiled.characters[0].caption, /Text:|BubbleType:|Layout:/);
    assert.equal(literal(compiled.characters[1].caption), '好。');
    assert.doesNotMatch(compiled.base, /放学后|咔哒/);
});
test('all supported types and positions have deterministic original protocol mappings', () => {
    const types = ['speech', 'screaming', 'thought', 'whisper', 'shiver', 'broadcast', 'caption', 'sfx', 'offscreen', 'tailless', 'connected'];
    const positions = ['right-upper', 'left-upper', 'right-lower', 'left-lower', 'mouth', 'offscreen', 'above', 'top', 'bottom'];
    for (let i = 0; i < types.length; i++) {
        const value = manga.mangaBubbleParts([bubble('原句', types[i], positions[i % positions.length], 'horizontal')]);
        assert.match(value.visual, /(?:BubbleType:|SFX: 擬音)/);
        assert.match(value.visual, /Layout: 横書き$/);
        assert.equal(value.text, '原句');
        assert.doesNotMatch(value.visual, /undefined|original sentence/);
    }
});
test('missing optional metadata uses safe defaults; malformed arrays give field-specific errors', () => {
    assert.match(manga.mangaBubbleParts([{ text: '你好' }]).visual, /通常吹き出し, 右上, Layout: 縦書き/);
    const page = pageFixture();
    page.panels[0].characters[0].bubbles = {};
    assert.throws(() => manga.compileMangaPage(page), /C1.*bubbles.*数组/);
    page.panels[0].characters[0].bubbles = [{ text: {}, type: 'speech' }];
    assert.throws(() => manga.compileMangaPage(page), /C1.*气泡.*字符串/);
});
test('literal quotes, protocol words and backslash sequences in structured text stay opaque', () => {
    const page = pageFixture();
    const text = '他说：“填写 Text: 和 Layout:。”\n\nBubbleType: 通常吹き出し, Layout: 縦書き, Text: 示例\n\n路径中的\\n不应变成换行。';
    page.panels[0].characters[0].bubbles = [bubble(text)];
    const compiled = manga.compileMangaPage(page);
    assert.equal(literal(compiled.characters[0].caption), text);
    for (const order of [[mangaHook, sdtHook], [sdtHook, mangaHook]]) {
        const request = { manga: true, textCompiled: true, characters: compiled.characters.map(c => ({ name: c.name, caption: c.caption, center: c.center, uc: c.uc })), renderSettings: clone(settings._mangaMode) };
        let result = payload(compiled.base);
        for (const hook of order) result = hook(result, { meta: { sdtCharacterData: request } });
        assert.equal(literal(result.parameters.v4_prompt.caption.char_captions[0].char_caption), text);
    }
});
test('legacy escaped separators are decoded only before complete recognized bubble headers', () => {
    for (const count of [1, 2]) {
        const separator = '\\'.repeat(count) + 'n' + '\\'.repeat(count) + 'n';
        const input = 'girl, BubbleType: 通常吹き出し, Text: 收到。' + separator + 'BubbleType: 思考の吹き出し, 左下, Layout: 縦書き, Text: 谢谢。';
        assert.equal(manga.splitMangaText(input).text, '收到。\n\n谢谢。');
        assert.match(manga.splitMangaText(input).visual, /思考の吹き出し/);
        const ordinary = 'girl, Text: 收到。' + separator + 'Layout: 是一个字段名。';
        assert.equal(manga.splitMangaText(ordinary).text, '收到。' + separator + 'Layout: 是一个字段名。');
    }
});
test('compilation is stable after serialization and does not mutate bubble lists', () => {
    const page = pageFixture();
    page.panels[0].characters[0].bubbles = [bubble('信收到了。'), bubble('好。', 'thought', 'left-lower')];
    const before = JSON.stringify(page), first = clone(manga.compileMangaPage(page));
    assert.equal(JSON.stringify(page), before);
    assert.deepEqual(clone(manga.compileMangaPage(clone(page))), first);
});
test('Studio keeps structured text and compiles the same literals on redraw', () => {
    const page = pageFixture(), panel = page.panels[0];
    panel.characters[1].bubbles = [bubble('信收到了。'), bubble('终于等到了。', 'thought', 'left-lower')];
    panel.bubbles = [bubble('咔哒', 'sfx', 'bottom')];
    const studioPanel = manga.studioPanelFromProtocol(panel);
    assert.deepEqual(clone(studioPanel.characters[1].bubbles), panel.characters[1].bubbles);
    assert.deepEqual(clone(studioPanel.bubbles), panel.bubbles);
    assert.equal(studioPanel._bubbleOwner, 'C2');
    settings._mangaMode.studio.panels = [studioPanel];
    const compiled = manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode));
    assert.equal(literal(compiled.characters[1].caption), '信收到了。\n\n终于等到了。');
    assert.equal((compiled.characters[1].caption.match(/BubbleType:/g) || []).length, 2);
    assert.equal(literal(compiled.base), '咔哒');
});
test('Studio quick text edit updates the chosen speaker and retains later bubble metadata', () => {
    const panel = pageFixture().panels[0];
    panel.characters[1].bubbles = [bubble('第一句'), bubble('第二句', 'thought', 'left-lower', 'horizontal')];
    const editor = manga.studioPanelFromProtocol(panel);
    editor.bubbleText = '新的第一句\n\n新的第二句';
    manga.updateStudioBubble(editor, 'text');
    assert.equal(editor.characters[0].bubbles, undefined);
    assert.equal(editor.characters[1].bubbles[1].type, 'thought');
    assert.equal(editor.characters[1].bubbles[1].layout, 'horizontal');
    editor.bubbleType = 'whisper'; manga.updateStudioBubble(editor, 'type');
    assert.equal(editor.characters[1].bubbles[0].type, 'whisper');
    assert.equal(editor.characters[1].bubbles[1].type, 'thought');
    editor.bubbleText = ''; manga.updateStudioBubble(editor, 'text');
    assert.deepEqual(clone(editor.characters[1].bubbles), []);
    assert.doesNotMatch(editor.characters[1].positive, /Text:|BubbleType:/);
});
test('Studio caption/SFX quick input edits the non-person owner without assigning it to first actor', () => {
    const panel = pageFixture().panels[0];
    panel.bubbles = [bubble('咔哒', 'sfx', 'bottom')];
    const editor = manga.studioPanelFromProtocol(panel);
    assert.equal(editor._bubbleOwner, 'panel');
    editor.bubbleText = '哒'; manga.updateStudioBubble(editor, 'text');
    assert.equal(editor.bubbles[0].text, '哒');
    assert.equal(editor.characters[0].bubbles, undefined);
    assert.equal(literal(editor.non_character), '哒');
});
test('legacy panel quick fields remain readable without bypassing new owner arrays', () => {
    const panel = { id: 'P1', description: 'classroom', characters: [], bubbleText: '放学后', bubbleType: 'caption', bubbleLayout: 'horizontal' };
    const editor = manga.studioPanelFromProtocol(panel);
    assert.equal(editor.bubbleText, '放学后');
    settings._mangaMode.studio.panels = [editor];
    assert.equal(literal(manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode)).base), '放学后');
});
test('SDT normalization and request snapshot mark compiled text without saving dialogue into memory', () => {
    const page = pageFixture();
    page.panels[0].characters[0].bubbles = [bubble('只给这次绘图')];
    const result = sdt.normalizeMangaSegment(page);
    assert.deepEqual(clone(result.mangaPage.panels[0].characters[0].bubbles), page.panels[0].characters[0].bubbles);
    const data = sdt.buildNaiCharData(result);
    assert.equal(data.textCompiled, true);
    assert.equal(literal(data.characters[0].caption), '只给这次绘图');
});
test('SDT full-caption manual edit clears stale structured text before recompiling', () => {
    const page = pageFixture(); page.panels[0].characters[0].bubbles = [bubble('旧台词')];
    page.panels[0].characters[1].bubbles = [bubble('BubbleType: 通常吹き出し, Layout: 縦書き, Text: 这是引用示例')];
    const original = sdt.normalizeMangaSegment(page);
    const values = { '.rbq-sdt-manual-char-caption': 'girl, waving, Text: 新台词', '.rbq-sdt-manual-char-uc': '', '.rbq-sdt-pad-x': '0.5', '.rbq-sdt-pad-y': '0.5' };
    const editor = vm.createContext({ segResult: original, isMultiChar: true, sdtParseCoord: sdt.sdtParseCoord,
        modal: { querySelector: () => ({ value: original.scene }), querySelectorAll: () => original.characters.map((c, index) => ({ dataset: { index: String(index) }, querySelector: q => ({ value: index === 1 && q.includes('caption') ? c.caption : values[q] }) })) } });
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('        function gatherUpdatedSegment('), sdtSource.indexOf('        function syncUpdatedSegmentState(')), editor);
    const updated = editor.gatherUpdatedSegment('characters');
    assert.equal(updated.mangaPage.panels[0].characters[0].bubbles, undefined);
    assert.equal(literal(manga.compileMangaPage(updated.mangaPage).characters[0].caption), '新台词');
    assert.deepEqual(clone(updated.mangaPage.panels[0].characters[1].bubbles), page.panels[0].characters[1].bubbles);
    assert.equal(literal(manga.compileMangaPage(updated.mangaPage).characters[1].caption), page.panels[0].characters[1].bubbles[0].text);
});
test('Studio metadata-only edits preserve paragraph breaks inside a single literal bubble', () => {
    const panel = pageFixture().panels[0];
    const text = '第一段。\n\n第二段。';
    panel.characters[0].bubbles = [bubble(text)];
    const editor = manga.studioPanelFromProtocol(panel);
    editor.bubbleType = 'whisper'; manga.updateStudioBubble(editor, 'type');
    assert.equal(editor.characters[0].bubbles.length, 1);
    assert.equal(editor.characters[0].bubbles[0].text, text);
});
test('shared schemas and model instructions separate literal speech from visual tags', () => {
    const schema = manga.mangaSegmentSchema();
    const char = schema.properties.panels.items.properties.characters.items.properties;
    for (const owner of [schema.properties.page.properties, schema.properties.panels.items.properties, char]) {
        assert.deepEqual(clone(owner.bubbles.items.required), ['type', 'position', 'layout', 'text']);
    }
    const prompt = manga.buildMangaSystemPrompt(settings._mangaMode);
    assert.match(prompt, /每泡独立输出 \{type,position,layout,text\}/);
    assert.match(prompt, /不自行执行拼接/);
    assert.doesNotMatch(manga.studioDirectorPrompt(settings._mangaMode, '普通剧情'), /各格使用[^\n]*bubbleType[^\n]*bubbleText/);
});

(async () => {
    Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', showTaggerDebug: true });
    settings._mangaMode.style = 'soft_color';
    const scene = pageFixture();
    scene.panels[0].characters[0].base = 'girl, short black hair';
    scene.panels[0].characters[0].outfit = 'white shirt';
    scene.panels[0].characters[0].bubbles = [bubble('一起回家吧。'), bubble('别忘了信。', 'whisper', 'left-lower')];
    scene.panels[0].characters[1].base = 'girl, long brown hair';
    scene.panels[0].characters[1].outfit = 'dark coat';
    scene.panels[0].characters[1].bubbles = [bubble('好。', 'speech', 'left-lower')];
    scene.panels[0].bubbles = [bubble('咔哒', 'sfx', 'bottom')];
    for (const toolMode of [true, false]) {
        let calls = 0;
        if (toolMode) RBQ.api.callStructuredCompletion = async ({ tool }) => {
            calls++;
            const fields = tool.function.parameters.properties.panels.items.properties;
            assert.equal(fields.bubbles.type, 'array');
            assert.equal(fields.characters.items.properties.bubbles.type, 'array');
            assert.equal(fields.bubbleText, undefined);
            return { rawReply: JSON.stringify({ panels: scene.panels }) };
        };
        else {
            delete RBQ.api.callStructuredCompletion;
            manga.fetch = async () => {
                calls++;
                return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ panels: scene.panels }) } }] }) };
            };
        }
        const panels = await manga.requestStudioPanels(settings._mangaMode, '一个普通对话画格', '她们说完话，关门离开。', 1);
        assert.equal(calls, 1);
        settings._mangaMode.studio.panels = panels;
        const compiled = manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode));
        assert.equal(literal(compiled.characters[0].caption), '一起回家吧。\n\n别忘了信。');
        assert.equal(literal(compiled.characters[1].caption), '好。');
        assert.equal(literal(compiled.base), '咔哒');
        for (const contextual of [true, false]) for (const order of [[mangaHook, sdtHook], [sdtHook, mangaHook]]) {
            RBQ.api.generationContextVersion = contextual ? 1 : 0;
            vm.runInContext('RBQ.api.getPendingSdtImageData = () => pendingNaiCharData;', sdt);
            RBQ.api.generateImage = async (prompt, _reason, meta) => {
                let result = payload(prompt);
                for (const hook of order) result = hook(result, contextual ? { meta } : undefined);
                assert.equal(literal(result.parameters.v4_prompt.caption.char_captions[0].char_caption), '一起回家吧。\n\n别忘了信。');
                assert.equal(literal(result.parameters.v4_prompt.caption.char_captions[1].char_caption), '好。');
                assert.equal(literal(result.input), '咔哒');
                return { url: 'fixture.png' };
            };
            await sdt.generateSdtImage({ mangaPage: true, mangaTextCompiled: true, mangaUseCoords: compiled.useCoords,
                characters: compiled.characters, mangaRenderSettings: clone(settings._mangaMode) }, compiled.base, 'bubble-fixture');
        }
        passed++;
        console.log('PASS Studio ' + (toolMode ? 'tool' : 'plain JSON') + ' analysis sends separated speech through contextual/legacy drawing in one model request');
    }
    console.log(`\n${passed} structured bubble tests passed; 0 live model/image calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
