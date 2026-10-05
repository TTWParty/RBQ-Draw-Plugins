/** Fresh legacy fallback and historical recovery regressions. Ordinary text; no live calls. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ } = new Function('require', '__dirname', harness +
    '\nreturn {manga,sdt,settings,RBQ};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => manga.splitMangaText(value, false).text;
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function reset() {
    Object.assign(settings._mangaMode, { enabled: true, dialogueMode: 'structured', style: 'soft_color' });
    settings._smartDrawTrigger.characterMemoryEnabled = false;
}
const example = 'BubbleType: 思考の吹き出し, Layout: 縦書き, Text: 这是字段示例。';
const panelExample = 'SFX: 擬音, 吹き出しなし, Text: 这是纸上的示例。';
function page() {
    return { format: 'nai5-comic', anchor: { text: '她展示纸上的字段示例。' }, label: '字段示例',
        page: { base: 'comic, 1 panel', bubbles: [],
            non_character: 'BubbleType: ナレーション枠, 上部, Layout: 横書き, Text: ' + panelExample },
        panels: [{ id: 'P1', description: 'office, wooden table', bubbles: [],
            non_character: 'SFX: 擬音, 吹き出しなし, 下部, Layout: 縦書き, Text: ' + panelExample,
            characters: [{ character_id: 'C1', name: 'Ada (original)', base: 'girl, short hair', outfit: 'white shirt',
                positive: 'standing, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, Text: ' + example,
                bubbles: [], negative: '' }] }] };
}

test('fresh empty-array fallback preserves protocol examples for all text owners without mutating the response', () => {
    reset(); const input = page(), before = JSON.stringify(input);
    const recovered = RBQ.api.mangaProtocol.recoverResponseText([input])[0];
    const compiled = manga.compileMangaPage(recovered);
    assert.equal(text(compiled.characters[0].caption), example);
    assert.equal(text(compiled.base), panelExample + '\n\n' + panelExample);
    assert.equal(recovered.panels[0].characters[0]._mangaTextLiteral, true);
    assert.equal(recovered.page._mangaTextLiteral, true);
    assert.equal(recovered.panels[0]._mangaTextLiteral, true);
    assert.equal(JSON.stringify(input), before);
});

for (const kind of ['object', 'JSON', 'tool', 'native tool']) test('structured ' + kind + ' fallback keeps literal syntax through NAI assembly and cache', () => {
    reset(); const response = { shouldDraw: true, segments: [page()] };
    const envelope = kind === 'object' ? response : kind === 'JSON'
        ? { choices: [{ message: { content: JSON.stringify(response) } }] } : kind === 'tool'
            ? { choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(response) } }] } }] }
            : { candidates: [{ content: { parts: [{ functionCall: { name: 'generate_draw_spec', args: response } }] } }] };
    const normalized = sdt.normalizeTaggerResult(envelope, [], sdt.captureMangaRequestContext(null, -1));
    const segment = normalized.segments[0];
    assert.equal(text(segment.characters[0].caption), example);
    assert.equal(text(sdt.buildNaiCharData(segment).characters[0].caption), example);
    const cached = clone(sdt.sanitizeSdtResult(segment));
    settings._mangaMode.dialogueMode = 'legacy';
    const compiled = manga.compileMangaPage(cached.mangaPage);
    assert.equal(text(compiled.characters[0].caption), example);
    assert.equal(text(compiled.base), panelExample + '\n\n' + panelExample);
});

test('fresh malformed header after an initial Text is still recovered once and remains stable', () => {
    reset(); const input = page();
    input.panels[0].characters[0].positive = 'standing, Text: 通常吹き出し, 右上, Layout: 縦書き, Text: 「信收到了。」';
    const recovered = RBQ.api.mangaProtocol.recoverResponseText([input])[0];
    const person = recovered.panels[0].characters[0];
    assert.match(person.positive, /standing, BubbleType: 通常吹き出し, 右上, Layout: 縦書き/);
    assert.equal(text(person.positive), '信收到了。');
    assert.equal(text(manga.compileMangaPage(recovered).characters[0].caption), '信收到了。');
    assert.equal(text(manga.compileMangaPage(clone(recovered)).characters[0].caption), '信收到了。');
});

test('fresh duplicated headers in later independent paragraphs still recover without losing the second utterance', () => {
    reset(); const input = page();
    input.panels[0].characters[0].positive = 'standing, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, Text: 信收到了。\n\n' +
        'BubbleType: 思考の吹き出し, 左下, Layout: 縦書き, Text: 终于等到了。';
    const recovered = RBQ.api.mangaProtocol.recoverResponseText([input])[0];
    const caption = manga.compileMangaPage(recovered).characters[0].caption;
    assert.equal(text(caption), '信收到了。\n\n终于等到了。');
    assert.match(caption, /BubbleType: 思考の吹き出し, 左下, Layout: 縦書き/);
    assert.equal(text(manga.compileMangaPage(clone(recovered)).characters[0].caption), '信收到了。\n\n终于等到了。');
});

test('historical unmarked cached captions still use the previous misplaced-header recovery', () => {
    reset(); const input = page();
    for (const owner of [input.page, input.panels[0], input.panels[0].characters[0]]) delete owner.bubbles;
    input.panels[0].characters[0].positive = 'standing, Text: 通常吹き出し, Layout: 縦書き, Text: 收到了。';
    assert.equal(text(manga.compileMangaPage(input).characters[0].caption), '收到了。');
});

test('nonempty structured arrays remain authoritative and deliberate silent arrays stay empty', () => {
    reset(); const input = page();
    input.panels[0].characters[0].bubbles = [{ type: 'speech', position: 'right-upper', layout: 'vertical', text: '请读这一句。' }];
    input.panels[0].non_character = 'wooden table';
    const recovered = RBQ.api.mangaProtocol.recoverResponseText([input])[0];
    assert.equal(recovered.panels[0].characters[0]._mangaTextLiteral, undefined);
    assert.equal(text(manga.compileMangaPage(recovered).characters[0].caption), '请读这一句。');
    assert.deepEqual(clone(recovered.panels[0].bubbles), []);
    assert.equal(recovered.panels[0]._mangaTextLiteral, undefined);
});

console.log('\n' + passed + ' fresh dialogue recovery audit tests passed; 0 live calls.');
