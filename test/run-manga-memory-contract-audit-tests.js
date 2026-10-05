/** Safe memory contract regressions: real production parser, no network/image calls. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { sdt, settings } = new Function('require', '__dirname', harness + '\nreturn {sdt,settings};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function reset() {
    settings._mangaMode.style = 'soft_color';
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', characterMemoryEnabled: true, characterProfiles: {} };
}
function page(people) {
    return { format: 'nai5-comic', anchor: { text: '林遥走到桌边，拿起信封。' }, page: { base: 'comic, 1girl' },
        panels: people.map((person, i) => ({ id: 'P' + (i + 1), description: 'panel, indoors, desk', bubbles: [],
            characters: [{ character_id: 'C1', base: 'girl, chinese, 35 years old, 180cm height, black hair',
                outfit: 'white shirt', positive: 'standing, holding envelope', bubbles: [], negative: '', ...person }] })) };
}
function parse(people) {
    return sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page(people)] }, [], sdt.captureMangaRequestContext(null, 1));
}
function test(name, run) { reset(); run(); passed++; console.log('PASS ' + name); }
test('an explicit English drawing identity recovers an omitted initial archive name', () => {
    const result = parse([{ name_tag: 'Lin Yao (original)' }]);
    const c = result.segments[0].mangaPage.panels[0].characters[0];
    assert.equal(c.name, 'Lin Yao (original)');
    assert.equal(c.name_tag, 'Lin Yao (original)');
    assert.match(c.base, /^Lin Yao \(original\), /);
    assert.equal(sdt.getCharacterProfile('Lin Yao').baseTags, c.base);
});
test('an omitted archive name with a known drawing identity reuses the Chinese profile key', () => {
    sdt.updateCharacterProfile('林遥', 'chinese, girl, brown eyes', 'navy coat', null, true, { nameTag: 'Lin Yao (original)' });
    const result = parse([{ name_tag: 'Lin Yao (original)', base: '', outfit: '' }]);
    const c = result.segments[0].mangaPage.panels[0].characters[0];
    assert.equal(c.name, '林遥');
    assert.equal(c.name_tag, 'Lin Yao (original)');
    assert.match(c.base, /brown eyes/);
    assert.equal(c.outfit, 'navy coat');
    assert.equal(Object.keys(sdt.getCharacterProfiles()).length, 1);
});
test('a later declaration remains authoritative over an earlier omitted archive name', () => {
    const result = parse([{ name_tag: 'Lin Yao (original)' }, { name: '林遥', name_tag: 'Lin Yao (original)' }]);
    const characters = result.segments[0].mangaPage.panels.map(p => p.characters[0]);
    assert.deepEqual(clone(characters.map(c => c.name)), ['林遥', '林遥']);
    assert.equal(Object.keys(sdt.getCharacterProfiles()).length, 1);
});
test('anonymous appearances without a confirmed drawing identity do not guess a profile', () => {
    sdt.updateCharacterProfile('Known', 'girl, blue eyes', 'navy coat', null, true);
    const before = JSON.stringify(sdt.getCharacterProfiles());
    const result = parse([{}]);
    const c = result.segments[0].mangaPage.panels[0].characters[0];
    assert.equal(c.name, undefined);
    assert.equal(JSON.stringify(sdt.getCharacterProfiles()), before);
});
test('a recovered identity carries into later unnamed appearances without repeating name_tag', () => {
    const result = parse([{ name_tag: 'Lin Yao (original)' }, { base: '', outfit: '' }]);
    const characters = result.segments[0].mangaPage.panels.map(p => p.characters[0]);
    assert.deepEqual(clone(characters.map(c => c.name)), ['Lin Yao (original)', 'Lin Yao (original)']);
    assert.equal(characters[1].base, characters[0].base);
    assert.equal(characters[1].outfit, 'white shirt');
    assert.equal(Object.keys(sdt.getCharacterProfiles()).length, 1);
});
test('invalid non-English or placeholder drawing identities do not create named memories', () => {
    for (const name_tag of ['林遥', 'C1', 'Text: Lin Yao', 'Lin Yao, girl']) {
        const result = parse([{ name_tag }]);
        assert.equal(result.segments[0].mangaPage.panels[0].characters[0].name, undefined);
        assert.equal(Object.keys(sdt.getCharacterProfiles()).length, 0);
    }
});
test('recovery with memory disabled preserves explicit identity without saving profiles', () => {
    settings._smartDrawTrigger.characterMemoryEnabled = false;
    const result = parse([{ name_tag: 'Lin Yao (original)' }]);
    const c = result.segments[0].mangaPage.panels[0].characters[0];
    assert.equal(c.name, 'Lin Yao (original)');
    assert.equal(c.name_tag, 'Lin Yao (original)');
    assert.match(c.base, /^Lin Yao \(original\), /);
    assert.equal(Object.keys(sdt.getCharacterProfiles()).length, 0);
});
test('a recovered archive name keeps original tags and stores a separate gray view', () => {
    settings._mangaMode.style = 'monochrome';
    const result = parse([{ name_tag: 'Lin Yao (original)', render: {
        base: 'girl, chinese, 35 years old, 180cm height, dark hair', outfit: 'white shirt' } }]);
    const c = result.segments[0].mangaPage.panels[0].characters[0];
    assert.match(sdt.getCharacterProfile('Lin Yao').baseTags, /black hair/);
    assert.match(c.render.base, /dark hair/);
    assert.equal(sdt.getMangaRenderCacheRows().length, 2);
    assert.equal(sdt.getMangaMemoryReferences(2)[0].name_tag, 'Lin Yao (original)');
});
console.log(`${passed} manga memory contract audit tests passed; no model/image calls.`);
