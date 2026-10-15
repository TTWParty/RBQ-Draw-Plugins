/** SDT 6.5.48: current-chat copies imported from a ⭐全局角色 list ALL wardrobe outfits to the LLM (normal + manga refs);
 *  other current-chat characters keep the normal-mode cap of 8. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };

const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
function sdtEnv(characterProfiles, globalCharacters, extra = {}) {
    const env = new Function('require', '__dirname', harness + '\nreturn {sdt,settings,sdtSource};')(require, __dirname);
    const load = (a, b) => { const i = env.sdtSource.indexOf(a), j = env.sdtSource.indexOf(b, i); assert.ok(i >= 0 && j > i, a); vm.runInContext(env.sdtSource.slice(i, j), env.sdt); };
    load('    function getCanonicalCharName(name) {', '    function getCharacterMemoryTagSpecification() {');
    load('    function buildCharacterMemoryPromptModule(', '    function getActiveCharacterName(');
    load('    function mergeCharacterCaption(', '    function collectCharacterCardInfo(');
    Object.assign(env.settings._smartDrawTrigger, { _mangaActive: false, enhancedContext: 'off', characterMemoryEnabled: true, characterProfiles, globalCharacters, ...extra });
    env.sdt.debugInfo = () => {};
    env.sdt.getChatKey = () => 'newChat';
    return env;
}
const wardrobe = (n, prefix = 'OUTFIT-') => Array.from({ length: n }, (_, i) => ({ id: 'w' + i, name: '服装' + i, outfit: prefix + i, locked: true, fromGlobal: true }));
const prof = (over = {}) => ({ displayName: '早濑沙纪', nameTag: 'Hayase Saki (Blue Archive)', baseTags: 'girl, pink hair',
    currentOutfit: 'OUTFIT-0', currentOutfitId: 'w0', wardrobe: wardrobe(12), createdAt: 1, ...over });
const registryLine = (prompt, name) => {
    const i = prompt.indexOf(`角色「${name}」`); assert.ok(i >= 0, name);
    const j = prompt.indexOf('\n  * ', i + 1);
    return prompt.slice(i, j > 0 ? j : undefined);
};

test('helper: imported-from-global → all outfits; ordinary profile → first 8', () => {
    const { sdt } = sdtEnv({ newChat: {} }, {});
    assert.equal(sdt.getPromptWardrobeForProfile(prof({ importedFromGlobal: { name: '早濑沙纪', at: 1 } })).length, 12);
    assert.equal(sdt.getPromptWardrobeForProfile(prof()).length, 8);
    assert.equal(sdt.getPromptWardrobeForProfile({}).length, 0);
});
test('normal prompt: imported global copy lists all 12 outfits; ordinary 12-outfit character still capped at 8', () => {
    const store = { newChat: {
        '早濑沙纪': prof({ importedFromGlobal: { name: '早濑沙纪', at: 1 }, baseLocked: true }),
        '林瑶': prof({ displayName: '林瑶', nameTag: 'Lin Yao (original)', wardrobe: wardrobe(12, 'LIN-') }),
    } };
    const { sdt } = sdtEnv(store, {});
    const prompt = sdt.buildCharacterMemoryPromptModule();
    const imp = registryLine(prompt, '早濑沙纪'), own = registryLine(prompt, '林瑶');
    assert.match(imp, /⭐ 来自全局角色/);
    for (let i = 0; i < 12; i++) assert.ok(imp.includes('OUTFIT-' + i), 'imported outfit ' + i);
    for (let i = 0; i < 8; i++) assert.ok(own.includes('LIN-' + i), 'own outfit ' + i);
    for (let i = 8; i < 12; i++) assert.ok(!own.includes('LIN-' + i), 'own outfit capped ' + i);
});
test('normal prompt: import via parse keeps every global outfit (global 12 → copy 12 → prompt 12)', () => {
    const store = {};
    const { sdt } = sdtEnv(store, { '早濑沙纪': { profile: prof(), setAt: 1, updatedAt: 1 } });
    sdt.mergeCharacterCaption('早濑沙纪', 'girl, pink hair', 'OUTFIT-0', 'smile', '', 'Hayase Saki (Blue Archive)');
    const copy = store.newChat['早濑沙纪'];
    assert.ok(copy.importedFromGlobal);
    assert.ok(copy.wardrobe.length >= 12);
    const imp = registryLine(sdt.buildCharacterMemoryPromptModule(), '早濑沙纪');
    for (let i = 0; i < 12; i++) assert.ok(imp.includes('OUTFIT-' + i), 'outfit ' + i);
});
test('manga refs: imported copy carries full wardrobe (with lock flags); ordinary chat refs unchanged (no wardrobe field)', () => {
    const store = { newChat: {
        '早濑沙纪': prof({ importedFromGlobal: { name: '早濑沙纪', at: 1 } }),
        '林瑶': prof({ displayName: '林瑶', nameTag: 'Lin Yao (original)' }),
    } };
    store.newChat['早濑沙纪'].wardrobe.push({ id: 's1', name: '剧情: 泳装', outfit: 'BIKINI', locked: false });
    const { sdt, settings } = sdtEnv(store, {});
    const refs = sdt.getMangaMemoryReferences(3);
    const imp = refs.find(r => r.name === '早濑沙纪'), own = refs.find(r => r.name === '林瑶');
    assert.equal(imp.wardrobe.length, 13);
    assert.deepEqual(JSON.parse(JSON.stringify(imp.wardrobe.at(-1))), { name: '剧情: 泳装', outfit: 'BIKINI', locked: false });
    assert.ok(imp.wardrobe.slice(0, 12).every(w => w.locked === true));
    assert.equal(Object.hasOwn(own, 'wardrobe'), false);
    Object.assign(settings._smartDrawTrigger, { _mangaActive: true, enhancedContext: 'v_manga' });
    const prompt = sdt.buildCharacterMemoryPromptModule(undefined, 3);
    assert.ok(prompt.includes('OUTFIT-11') && prompt.includes('BIKINI'), 'manga prompt JSON carries all outfits');
});
test('source: no remaining wardrobe slice(0, 8) outside the helper; version 6.5.48', () => {
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    assert.equal((src.match(/wardrobe[^\n]*\.slice\(0, 8\)/g) || []).length, 0);
    assert.match(src, /p\?\.importedFromGlobal \? list\.slice\(\) : list\.slice\(0, 8\)/);
    assert.match(src, /const PLUGIN_VERSION = '6\.5\.48'/);
    assert.match(fs.readFileSync(path.join(__dirname, '../plugins.json'), 'utf8'), /smart-draw-trigger\.js\?v=6\.5\.48/);
});

console.log(`\n${passed} imported global wardrobe tests passed.`);
