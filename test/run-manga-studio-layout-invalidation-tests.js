/** Studio layout invalidation preserves literal page text. Neutral fixtures, no live calls. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0, failed = 0;
function test(name, run) {
    try { run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

const oldPlan = 'bottom focal panel occupies 65 percent of page, supporting panel occupies 35 percent, reading path right to left, soft side lighting';
const legacy = 'BubbleType: 矩形のナレーション枠, 上部, Layout: 横書き';
function host(mode = 'legacy') {
    const env = new Function('require', '__dirname', harness + '\nreturn { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook };')(require, __dirname);
    const { manga, settings } = env;
    const store = settings._mangaMode, studio = store.studio;
    Object.assign(store, { style: 'custom', customPositive: 'clean lineart', customNegative: '', dialogueMode: mode, grammar: 'cinema', gutter: 'bleed' });
    Object.assign(studio, { ratio: '832x1216', panels: [
        { id: 'P1', position: 'top auxiliary panel', shot: 'wide shot', tags: 'quiet office, window', characters: [], non_character: '', _mangaTextLiteral: true },
        { id: 'P2', position: 'bottom focal panel', shot: 'close-up', tags: 'wooden table, envelope', characters: [], non_character: '', _mangaTextLiteral: true }
    ], page: {
        base: 'comic, 2 panels, no humans, ' + oldPlan,
        non_character: oldPlan + ', ' + legacy + '\nText: 清晨。',
        _mangaTextLiteral: true,
        ...(mode === 'structured' ? { bubbles: [{ type: 'caption', position: 'top', layout: 'horizontal', text: '清晨。' }] } : {})
    } });
    studio.pageLayoutSignature = manga.studioPageLayoutSignature(store);
    const compile = () => manga.compileMangaPage(manga.buildStudioPage(store));
    const parts = value => manga.splitMangaText(value, false);
    return { ...env, store, studio, compile, parts };
}

for (const mode of ['legacy', 'structured']) {
    test(`${mode} valid saved plan and non-character visual instructions remain intact`, () => {
        const h = host(mode), before = clone(h.studio.page), result = h.compile();
        assert.match(result.base, /65 percent/);
        assert.match(result.base, /35 percent/);
        assert.match(result.base, /reading path right to left/);
        assert.match(result.base, /soft side lighting/);
        assert.equal(h.parts(result.base).text, '清晨。');
        assert.deepEqual(clone(h.studio.page), before);
    });
    const changes = {
        resize: h => { h.studio.ratio = '1216x832'; },
        reorder: h => h.studio.panels.reverse(),
        insert: h => h.studio.panels.push({ ...clone(h.studio.panels[0]), id: 'P3', position: 'middle insert panel' }),
        remove: h => h.studio.panels.pop(),
        reposition: h => { h.studio.panels[0].position = 'left tall panel'; },
        grammar: h => { h.store.grammar = 'daily'; },
        gutter: h => { h.store.gutter = 'framed'; },
        style: h => { h.store.style = 'soft_color'; }
    };
    for (const [name, change] of Object.entries(changes)) {
        test(`${mode} ${name} removes obsolete page visuals from every saved page field`, () => {
            const h = host(mode), before = clone(h.studio.page);
            change(h);
            const built = h.manga.buildStudioPage(h.store), result = h.manga.compileMangaPage(built);
            assert.doesNotMatch(h.parts(result.base).visual, /65 percent|35 percent|reading path right to left|soft side lighting/);
            assert.match(h.parts(result.base).visual, /BubbleType: (?:矩形の)?ナレーション枠/);
            assert.match(h.parts(result.base).visual, /Layout: 横書き/);
            assert.equal(h.parts(result.base).text, '清晨。');
            assert.deepEqual(clone(h.studio.page), before, 'invalidation must not rewrite the editable saved page');
            if (mode === 'structured') assert.deepEqual(clone(built.page.bubbles), before.bubbles);
        });
    }
}

for (const signature of [undefined, null, '', 'not json', '{}', '[]', { old: true }]) {
    test(`missing or malformed signature ${JSON.stringify(signature)} keeps legacy page text safely`, () => {
        const h = host(); h.studio.pageLayoutSignature = signature;
        const result = h.compile();
        assert.doesNotMatch(h.parts(result.base).visual, /65 percent|35 percent|reading path right to left|soft side lighting/);
        assert.match(h.parts(result.base).visual, /vertical layout/);
        assert.equal(h.parts(result.base).text, '清晨。');
    });
}

test('invalid pure visual non-character text is discarded without guessing layout keywords', () => {
    const h = host();
    h.studio.page.non_character = 'huge arbitrary old layout, obsolete arrangement prose, remembered lighting';
    h.studio.pageLayoutSignature = '';
    const result = h.compile();
    assert.doesNotMatch(result.base, /arbitrary|obsolete|remembered/);
    assert.equal(h.parts(result.base).text, '');
});

test('literal text saved inside page.base also survives while its old visuals are discarded', () => {
    const h = host();
    h.studio.page.base += ', ' + legacy + '\nText: 纸上写着 Text: 收到，Layout: 是单词。';
    h.studio.page.non_character = '';
    h.studio.ratio = '1216x832';
    const result = h.compile();
    assert.match(h.parts(result.base).visual, /見開きページ/);
    assert.doesNotMatch(h.parts(result.base).visual, /65 percent|soft side lighting/);
    assert.equal(h.parts(result.base).text, '纸上写着 Text: 收到，Layout: 是单词。');
});

test('opaque literal protocol examples are never interpreted as a new page layout', () => {
    const h = host();
    const literal = 'BubbleType: 通常吹き出し, Layout: 縦書き, Text: 这是协议示例。\n\n65 percent 是文件上的字。';
    h.studio.page.base += '\nText: ' + literal;
    h.studio.page.non_character = '';
    h.studio.pageLayoutSignature = '';
    const result = h.compile();
    assert.equal(h.parts(result.base).text, literal);
    assert.doesNotMatch(h.parts(result.base).visual, /65 percent|通常吹き出し/);
});

test('repeated legacy bubble formatting survives invalidation for each utterance', () => {
    const h = host();
    const header = 'BubbleType: 通常吹き出し, 右上, Layout: 縦書き';
    h.studio.page.non_character = oldPlan + ', ' + header + ', ' + header + '\nText: 第一句。\n\n第二句。';
    h.studio.pageLayoutSignature = '';
    const result = h.compile(), visual = h.parts(result.base).visual;
    assert.equal((visual.match(/BubbleType: 通常吹き出し/g) || []).length, 2);
    assert.equal((visual.match(/Layout: 縦書き/g) || []).length, 2);
    assert.equal(h.parts(result.base).text, '第一句。\n\n第二句。');
});

test('legacy metadata on separate visual lines is preserved without obsolete page prose', () => {
    const h = host();
    h.studio.page.non_character = oldPlan + '\nBubbleType: 矩形のナレーション枠\n上部\nLayout: 横書き\nText: 清晨。';
    h.studio.pageLayoutSignature = '';
    const result = h.compile();
    assert.doesNotMatch(h.parts(result.base).visual, /65 percent|soft side lighting/);
    assert.match(h.parts(result.base).visual, /BubbleType: 矩形のナレーション枠, 上部, Layout: 横書き/);
    assert.equal(h.parts(result.base).text, '清晨。');
});

test('known people count replacement does not collapse page.base metadata for multiple utterances', () => {
    const h = host(), header = 'BubbleType: 通常吹き出し, 右上, Layout: 縦書き';
    h.studio.page.base += ', ' + header + ', ' + header + '\nText: 第一句。\n\n第二句。';
    h.studio.page.non_character = '';
    h.studio.pageLayoutSignature = '';
    const result = h.compile(), visual = h.parts(result.base).visual;
    assert.equal((visual.match(/BubbleType: 通常吹き出し/g) || []).length, 2);
    assert.equal((visual.match(/Layout: 縦書き/g) || []).length, 2);
    assert.equal(h.parts(result.base).text, '第一句。\n\n第二句。');
});

test('known SFX and weighted bubble formatting survive without weighted stale layout', () => {
    const h = host();
    h.studio.page.non_character = '1.2::' + oldPlan + '::, 1.1::SFX: 擬音, 吹き出しなし, 下部, Layout: 縦書き::\nText: 咔哒。';
    h.studio.pageLayoutSignature = '';
    const result = h.compile();
    assert.doesNotMatch(h.parts(result.base).visual, /65 percent|soft side lighting|1.2::/);
    assert.match(h.parts(result.base).visual, /1.1::SFX: 擬音, 吹き出しなし, 下部, Layout: 縦書き::/);
    assert.equal(h.parts(result.base).text, '咔哒。');
});

test('old unmarked multi-paragraph Text protocol still recovers its known later headers', () => {
    const h = host();
    delete h.studio.page._mangaTextLiteral;
    h.studio.page.non_character = oldPlan + ', ' + legacy + '\nText: 「清晨。」\n\nSFX: 擬音, 吹き出しなし, 下部, Layout: 縦書き, Text: 咔哒。';
    h.studio.pageLayoutSignature = '';
    const result = h.compile();
    assert.doesNotMatch(h.parts(result.base).visual, /65 percent|soft side lighting/);
    assert.match(h.parts(result.base).visual, /SFX: 擬音/);
    assert.equal(h.parts(result.base).text, '清晨。\n\n咔哒。');
});

test('structured page bubbles remain authoritative after invalidation and an explicit [] still clears text', () => {
    const h = host('structured');
    h.studio.page.non_character += '\n\n旧文字。';
    h.studio.pageLayoutSignature = '';
    assert.equal(h.parts(h.compile().base).text, '清晨。');
    h.studio.page.bubbles = [];
    assert.equal(h.parts(h.compile().base).text, '');
});

test('panel-level visual tags and owned text survive a page layout invalidation', () => {
    const h = host();
    h.studio.panels[0].non_character = 'window, ' + legacy + '\nText: 信封在桌上。';
    h.studio.pageLayoutSignature = '';
    const result = h.compile();
    assert.match(h.parts(result.base).visual, /quiet office, window/);
    assert.match(h.parts(result.base).visual, /wooden table, envelope/);
    assert.equal(h.parts(result.base).text, '清晨。\n\n信封在桌上。');
});

for (const mode of ['legacy', 'structured']) for (const first of ['manga', 'sdt']) {
    test(`${mode} final NAI payload has current layout and page text (${first} first)`, () => {
        const h = host(mode); h.studio.ratio = '1216x832';
        const compiled = h.compile();
        h.sdt.prepareNaiCharData({ mangaPage: true, mangaTextCompiled: true, characters: compiled.characters });
        h.manga.setStudioRequest(compiled, '1216x832');
        let output = h.payload(compiled.base);
        for (const hook of first === 'manga' ? [h.mangaHook, h.sdtHook] : [h.sdtHook, h.mangaHook]) output = hook(output);
        const caption = output.parameters.v4_prompt.caption.base_caption;
        assert.doesNotMatch(h.parts(caption).visual, /65 percent|35 percent|soft side lighting|reading path right to left/);
        assert.match(h.parts(caption).visual, /見開きページ/);
        assert.equal(h.parts(caption).text, '清晨。');
        assert.equal(output.parameters.width, 1216); assert.equal(output.parameters.height, 832);
    });
}

console.log(`\n${passed} Studio layout invalidation tests passed; ${failed} failed; 0 live calls.`);
if (failed) process.exitCode = 1;
