/** Name-matching regressions for smart-draw-trigger lookup (no model/image calls). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const code = [
    slice('    function getCanonicalCharName(name) {', '    // ── Lookup-only name normalization'),
    slice('    // ── Lookup-only name normalization', '    function getCharacterMemoryTagSpecification() {'),
].join('\n');
const logs = [];
const ctx = { RBQ: { api: {} }, debugInfo: m => logs.push(m) };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.find = findCharacterProfileEntry; this.key = getCharMatchKey; this.series = hasCharSeriesSuffix;', ctx);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓', name); };

const saki = { displayName: '早濑咲', nameTag: 'Hayase Saki (Blue Archive)', baseTags: 'girl' };
const yuuka = { displayName: 'Hayase Yuuka', nameTag: 'Hayase Yuuka (Blue Archive)' };
const profiles = { '早濑咲': saki, 'Hayase Yuuka': yuuka };
const who = n => { const h = ctx.find(profiles, n); return h ? h[1] : null; };

for (const n of ['早濑咲', 'Hayase Saki', 'hayase_saki', '2::Hayase Saki (Blue Archive)::', 'Saki Hayase',
    'Hayase Saki（蓝色档案）', '{Hayase Saki}', 'HAYASE  SAKI', 'Hayase·Saki', 'Ｈａｙａｓｅ Ｓａｋｉ', 'Hayase Saki (Blue Archive) (swimsuit)', '[Hayase Saki]'])
    test(`matches Saki: ${n}`, () => assert.equal(who(n), saki));

test('Yuuka stays Yuuka', () => assert.equal(who('Hayase Yuuka'), yuuka));
test('Yuuka swapped', () => assert.equal(who('Yuuka Hayase'), yuuka));
for (const n of ['Hayase', 'Saki', 'Hayase Sakiko', 'Hayase Yuuka Saki', '', '   ', 'H', '()', '2::::'])
    test(`no false match: "${n}"`, () => assert.equal(who(n), null));

test('aliases', () => {
    const p = { a: { displayName: 'Lin Yao', aliases: ['小瑶', 'Yaoyao'] } };
    assert.equal(ctx.find(p, '小瑶')[0], 'a');
    assert.equal(ctx.find(p, 'yaoyao (original)')[0], 'a');
});
test('ambiguous normalized hits do not merge', () => {
    const p = { a: { displayName: 'Mika (Blue Archive)' }, b: { displayName: 'Mika (Genshin Impact)' } };
    logs.length = 0;
    assert.equal(ctx.find(p, 'Mika'), null);
    assert.ok(logs.some(l => l.includes('多个档案')));
    assert.equal(ctx.find(p, 'Mika (Genshin Impact)')[0], 'b');
});
test('series detection', () => {
    assert.equal(ctx.series('Hayase Saki (Blue Archive)'), true);
    assert.equal(ctx.series('2::Hayase Saki (Blue Archive)::'), true);
    assert.equal(ctx.series('Ami (original)'), false);
    assert.equal(ctx.series('Hayase Saki'), false);
});

const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
function createEnv() {
    const env = new Function('require', '__dirname', harness + '\nreturn {sdt,settings,sdtSource};')(require, __dirname);
    const load = (a, b) => { const i = env.sdtSource.indexOf(a), j = env.sdtSource.indexOf(b, i); assert.ok(i >= 0 && j > i, a); vm.runInContext(env.sdtSource.slice(i, j), env.sdt); };
    load('    function getCanonicalCharName(name) {', '    function getCharacterMemoryTagSpecification() {');
    load('    function getCharacterProfile(name) {', '    function isSameOutfit(a, b) {');
    load('    // Lorebook entry for a character:', '    function resolveCharacterMemoryFields(');
    load('    function mergeCharacterCaption(', '    function collectCharacterCardInfo(');
    load('    function buildCharacterMemoryPromptModule(', '    function getActiveCharacterName(');
    env.settings._smartDrawTrigger._mangaActive = false;
    env.settings._smartDrawTrigger.enhancedContext = 'off';
    env.settings._smartDrawTrigger.characterMemoryEnabled = true;
    return env;
}

test('merge reuses self-built fan character for bare LLM name (no new profile)', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = { displayName: '早濑咲', nameTag: 'Hayase Saki (Blue Archive)', baseTags: 'girl, short hair, pink hair', currentOutfit: 'white shirt', wardrobe: [] };
    const caption = sdt.mergeCharacterCaption('Saki Hayase', 'girl, long hair', 'red dress', 'smile', '', '');
    assert.deepEqual(Object.keys(bucket), ['早濑咲']);
    assert.match(caption, /pink hair/);
    assert.doesNotMatch(caption, /long hair/);
    // Parse writes outfit; wardrobe archives only on real change from white shirt → red dress.
    assert.equal(bucket['早濑咲'].currentOutfit, 'red dress');
    assert.equal(bucket['早濑咲'].wardrobe.length, 1);
});
test('nameTag backfilled with series even when base/outfit locked', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['Hayase Saki'] = { displayName: 'Hayase Saki', nameTag: 'Hayase Saki', baseTags: 'girl, pink hair', baseLocked: true, isBaseLocked: true,
        outfitLocked: true, isOutfitLocked: true, currentOutfit: 'school uniform, blue skirt', wardrobe: [] };
    sdt.mergeCharacterCaption('Hayase Saki (Blue Archive)', 'girl', 'school uniform, skirt, blue skirt', 'waving', '', '');
    const p = bucket['Hayase Saki'];
    assert.equal(p.nameTag, 'Hayase Saki (Blue Archive)');
    assert.equal(p.baseTags, 'girl, pink hair');
    assert.equal(p.currentOutfit, 'school uniform, blue skirt');
    assert.equal(Object.keys(bucket).length, 1);
});
test('existing series nameTag is never overwritten', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['A'] = { displayName: 'Mika', nameTag: 'Misono Mika (Blue Archive)', baseTags: 'girl', wardrobe: [] };
    sdt.mergeCharacterCaption('Misono Mika (Other Series)', 'girl', '', '', '', '');
    assert.equal(bucket['A'].nameTag, 'Misono Mika (Blue Archive)');
});
test('locked outfit text used in caption over a near-same LLM rewrite; action still applies', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['Ami'] = { displayName: 'Ami', nameTag: 'Ami (original)', baseTags: 'girl, black hair', outfitLocked: true, isOutfitLocked: true,
        currentOutfit: 'navy sailor uniform, red ribbon', wardrobe: [] };
    const caption = sdt.mergeCharacterCaption('Ami (original)', 'girl', 'navy sailor uniform, red ribbon, uniform', 'eye patch, sitting', '', '');
    assert.match(caption, /navy sailor uniform, red ribbon, eye patch/);
    assert.equal(bucket['Ami'].currentOutfit, 'navy sailor uniform, red ribbon');
    assert.match(caption, /eye patch, sitting/);
});
test('prompt module tells LLM to copy nameTag verbatim', () => {
    const { sdt } = createEnv();
    sdt.getCharacterProfiles()['早濑咲'] = { displayName: '早濑咲', nameTag: 'Hayase Saki (Blue Archive)', baseTags: 'girl', wardrobe: [] };
    const text = sdt.buildCharacterMemoryPromptModule(undefined, 0);
    assert.match(text, /逐字复制该角色的 name_tag/);
    assert.match(text, /仅适用于资产库中没有的新角色/);
    assert.match(text, /伤疤/);
});

test('stored baseTags never contain drawing name; caption still has weighted name', () => {
    const { sdt } = createEnv();
    const caption = sdt.mergeCharacterCaption('早濑咲', '1girl, hayase saki, blue archive, short hair, blue eyes',
        'blue serafuku', 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.match(caption, /2::Hayase Saki \(Blue Archive\)::/);
    assert.match(caption, /1girl, hayase saki, blue archive/);
    assert.equal((caption.match(/Hayase Saki \(Blue Archive\)/g) || []).length, 1);
    const p = sdt.getCharacterProfile('早濑咲');
    assert.ok(p);
    assert.equal(p.baseTags, '1girl, hayase saki, blue archive, short hair, blue eyes');
    assert.doesNotMatch(p.baseTags, /Hayase Saki \(Blue Archive\)/);
    assert.equal(p.nameTag, 'Hayase Saki (Blue Archive)');
});
test('dirty leading nameTag in stored base is stripped for caption and cleaned when unlocked', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = {
        displayName: '早濑咲', nameTag: 'Hayase Saki (Blue Archive)',
        baseTags: 'Hayase Saki (Blue Archive), 1girl, hayase saki, blue archive, short hair, blue eyes',
        currentOutfit: 'blue serafuku', wardrobe: []
    };
    const caption = sdt.mergeCharacterCaption('早濑咲', 'girl', 'blue serafuku', 'scar on cheek', '', 'Hayase Saki (Blue Archive)');
    assert.match(caption, /2::Hayase Saki \(Blue Archive\)::/);
    assert.equal((caption.match(/Hayase Saki \(Blue Archive\)/g) || []).length, 1);
    assert.match(caption, /1girl, hayase saki/);
    // Same outfit → no wardrobe growth; dirty base cleaned on write.
    assert.equal(bucket['早濑咲'].baseTags, '1girl, hayase saki, blue archive, short hair, blue eyes');
    assert.equal(bucket['早濑咲'].wardrobe.length, 0);
});
test('re-parse of the same outfit does not grow wardrobe', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = { displayName: '早濑咲', nameTag: 'Hayase Saki (Blue Archive)', baseTags: '1girl, short hair', currentOutfit: 'casual', wardrobe: [] };
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'blue serafuku, sailor collar', 'standing', '', '');
    assert.equal(bucket['早濑咲'].currentOutfit, 'blue serafuku, sailor collar');
    assert.equal(bucket['早濑咲'].wardrobe.length, 1);
    const afterFirst = bucket['早濑咲'].wardrobe.length;
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'blue serafuku, sailor collar', 'standing', '', '');
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'blue serafuku, sailor collar', 'waving', '', '');
    assert.equal(bucket['早濑咲'].wardrobe.length, afterFirst);
    assert.equal(bucket['早濑咲'].wardrobe.length, 1);
});
test('stripCharacterIdentityFromBase only removes leading identity tokens', () => {
    const { sdt } = createEnv();
    assert.equal(
        sdt.stripCharacterIdentityFromBase('Hayase Saki (Blue Archive), 1girl, short hair', 'Hayase Saki (Blue Archive)', '早濑咲'),
        '1girl, short hair'
    );
    assert.equal(
        sdt.stripCharacterIdentityFromBase('1girl, short hair', 'Hayase Saki (Blue Archive)'),
        '1girl, short hair'
    );
    assert.equal(
        sdt.stripCharacterIdentityFromBase('1girl, Hayase Saki (Blue Archive), short hair', 'Hayase Saki (Blue Archive)'),
        '1girl, Hayase Saki (Blue Archive), short hair'
    );
});

const WRAP_PRESETS = ['v40_worldbook_97_opt', 'v35_worldbook_97', 'v33_worldbook_97', 'v31_worldbook_97', 'v29_worldbook_93', 'v28_worldbook_91', 'v27_5', 'v27_universal', 'v26_hybrid', 'v25_hybrid', 'consistent', 'v24_3d'];
const braceBalanced = s => { let d = 0; for (const c of s) { if (c === '{') d++; else if (c === '}') { d--; if (d < 0) return false; } } return d === 0; };
const BASES = {
    clean: '1girl, hayase saki, blue archive, short hair, blue eyes',
    dirty: 'Hayase Saki (Blue Archive), 1girl, hayase saki, blue archive, short hair, blue eyes',
    braced: '{Hayase Saki (Blue Archive), 1girl, hayase saki, blue archive, short hair, blue eyes}',
    bracedClean: '{1girl, hayase saki, blue archive, short hair, blue eyes}',
};
for (const preset of [...WRAP_PRESETS, 'default']) {
    for (const [kind, llmBase] of Object.entries(BASES)) {
        for (const stored of [false, true]) {
            test(`braces balanced, name once: ${preset} / ${kind} / ${stored ? 'stored' : 'new'}`, () => {
                const { sdt, settings } = createEnv();
                settings._smartDrawTrigger.systemPromptPreset = preset;
                const bucket = sdt.getCharacterProfiles();
                if (stored) bucket['早濑咲'] = { displayName: '早濑咲', nameTag: 'Hayase Saki (Blue Archive)', baseTags: llmBase, currentOutfit: '', wardrobe: [] };
                const caption = sdt.mergeCharacterCaption('早濑咲', llmBase, 'white collared shirt', 'smile', '', 'Hayase Saki (Blue Archive)');
                assert.ok(braceBalanced(caption), caption);
                assert.equal((caption.match(/Hayase Saki \(Blue Archive\)/g) || []).length, 1, caption);
                assert.match(caption, /blue eyes\}?, white collared shirt, smile$/);
                if (WRAP_PRESETS.includes(preset) || kind.startsWith('braced'))
                    assert.ok(caption.startsWith('{2::Hayase Saki (Blue Archive)::, 1girl,') && !caption.startsWith('{{'), caption);
                const base = bucket['早濑咲'].baseTags;
                assert.ok(braceBalanced(base), base);
                assert.doesNotMatch(base, /Hayase Saki \(Blue Archive\)/);
            });
        }
    }
}
test('stripCharacterIdentityFromBase keeps braces balanced', () => {
    const { sdt } = createEnv();
    assert.equal(sdt.stripCharacterIdentityFromBase('{Hayase Saki (Blue Archive), 1girl, blue eyes}', 'Hayase Saki (Blue Archive)'), '{1girl, blue eyes}');
    assert.equal(sdt.stripCharacterIdentityFromBase('{Hayase Saki (Blue Archive), 1girl}, smile', 'Hayase Saki (Blue Archive)'), '{1girl}, smile');
    assert.equal(sdt.stripCharacterIdentityFromBase('{Hayase Saki (Blue Archive)}, 1girl', 'Hayase Saki (Blue Archive)'), '1girl');
});
test('currentOutfitId follows matching wardrobe entry and is cleared when stale', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    // Deleted entry id left behind after a wardrobe reset.
    bucket['早濑咲'] = { displayName: '早濑咲', nameTag: 'Hayase Saki (Blue Archive)', baseTags: '1girl, short hair', currentOutfit: 'casual', currentOutfitId: 'w-mv8a0jpg-pxlb', wardrobe: [] };
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'white collared shirt, blue pleated skirt', 'smile', '', '');
    const p = bucket['早濑咲'];
    assert.equal(p.wardrobe.length, 1);
    assert.equal(p.currentOutfitId, p.wardrobe[0].id);
    assert.notEqual(p.currentOutfitId, 'w-mv8a0jpg-pxlb');
    // Switch to an existing entry: id follows it, no new entry.
    p.wardrobe.push({ id: 'w-swim', name: 'swim', outfit: 'black one-piece swimsuit, bare legs', tags: 'black one-piece swimsuit, bare legs' });
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'black one-piece swimsuit, bare legs', 'smile', '', '');
    assert.equal(p.currentOutfitId, 'w-swim');
    assert.equal(p.wardrobe.length, 2);
    // Every id we keep must exist in the wardrobe.
    p.wardrobe = [];
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'red dress', 'smile', '', '');
    assert.ok(!p.currentOutfitId || p.wardrobe.some(w => w.id === p.currentOutfitId));
});
test('new profile gets currentOutfitId of its initial wardrobe entry', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    sdt.mergeCharacterCaption('早濑咲', '1girl, short hair', 'white collared shirt, blue pleated skirt', 'smile', '', 'Hayase Saki (Blue Archive)');
    const p = bucket['早濑咲'];
    assert.ok(!p.currentOutfitId || p.wardrobe.some(w => w.id === p.currentOutfitId));
    if (p.wardrobe.length) assert.equal(p.currentOutfitId, p.wardrobe[0].id);
});

const sakiOriginal = extra => ({ displayName: '早濑咲', nameTag: 'Hayase Saki (original)', baseTags: '1girl, short hair, blue eyes', currentOutfit: '', wardrobe: [], ...extra });
test('LLM-guessed (original) upgrades to series for the same romaji name (merge)', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = sakiOriginal({ nameTagSource: 'llm' });
    const caption = sdt.mergeCharacterCaption('早濑咲', 'girl', 'white shirt', 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (Blue Archive)');
    assert.equal(bucket['早濑咲'].nameTagSource, 'llm');
    assert.match(caption, /Hayase Saki \(Blue Archive\)/);
    assert.doesNotMatch(caption, /\(original\)/);
});
test('legacy (original) without source is treated as llm and upgrades', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = sakiOriginal();
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'white shirt', 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (Blue Archive)');
});
test('different romaji name does not upgrade (original)', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = sakiOriginal({ nameTagSource: 'llm' });
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'white shirt', 'smile', '', 'Hayase Yuuka (Blue Archive)');
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (original)');
});
test('user-set nameTag is never changed by parse', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = sakiOriginal({ nameTagSource: 'user' });
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'white shirt', 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (original)');
    bucket['早濑咲'].nameTag = 'Saki (custom skin)';
    sdt.updateCharacterProfile('早濑咲', null, null, null, false, { nameTag: 'Hayase Saki (Blue Archive)', replaceBase: true, backfillNameTag: true });
    assert.equal(bucket['早濑咲'].nameTag, 'Saki (custom skin)');
});
test('series nameTag is never downgraded to (original) or bare', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = sakiOriginal({ nameTag: 'Hayase Saki (Blue Archive)', nameTagSource: 'llm' });
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'white shirt', 'smile', '', 'Hayase Saki (original)');
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (Blue Archive)');
    sdt.updateCharacterProfile('早濑咲', 'girl', null, null, false, { nameTag: 'Hayase Saki (original)', replaceBase: true, backfillNameTag: true });
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (Blue Archive)');
    sdt.updateCharacterProfile('早濑咲', null, null, null, false, { nameTag: 'Hayase Saki' , replaceBase: true });
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (Blue Archive)');
});
test('first parse backfill of a missing nameTag is recorded as llm', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = { displayName: '早濑咲', baseTags: '1girl, short hair, blue eyes', currentOutfit: '', wardrobe: [] };
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'white shirt', 'smile', '', 'Hayase Saki (original)');
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (original)');
    assert.equal(bucket['早濑咲'].nameTagSource, 'llm');
    sdt.mergeCharacterCaption('早濑咲', 'girl', 'white shirt', 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.equal(bucket['早濑咲'].nameTag, 'Hayase Saki (Blue Archive)');
});
test('prompt asks LLM to identify the source work for missing / guessed (original) tags', () => {
    const { sdt } = createEnv();
    const bucket = sdt.getCharacterProfiles();
    bucket['早濑咲'] = sakiOriginal({ nameTagSource: 'llm' });
    bucket['Lin'] = { displayName: 'Lin', nameTag: 'Lin Yao (original)', nameTagSource: 'user', baseTags: 'girl' };
    const text = sdt.buildCharacterMemoryPromptModule(sdt.getStore ? sdt.getStore() : undefined, 1);
    assert.match(text, /Hayase Saki \(original\) \(待确认：依据正文\/世界书\/角色卡判断所属作品/);
    assert.match(text, /name_tag \(英文绘图身份\): Lin Yao \(original\)\n/);
    assert.match(text, /无依据时不臆造作品/);
    assert.doesNotMatch(text, /不凭空添加作品/);
});

const wardrobeProfile = extra => ({ displayName: 'Lin', nameTag: 'Lin Yao (original)', baseTags: 'girl, black hair', currentOutfit: 'school uniform, red tie', currentOutfitId: 'w-school',
    wardrobe: [{ id: 'w-school', name: '校服', outfit: 'school uniform, red tie' }, { id: 'w-summer', name: '夏季校服', outfit: 'summer uniform, short sleeves' },
        { id: 'w-swim', name: '泳装', outfit: 'black bikini', triggers: ['海边'] }], ...extra });
test('A: switching under lock works (claimed preset switches, stored text used, lock mirrors new item)', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = wardrobeProfile({ outfitLocked: true, isOutfitLocked: true });
    b.Lin.wardrobe[0].locked = true;
    const cap = sdt.mergeCharacterCaption('Lin', 'girl', 'red bikini, sunglasses', 'smile', '', '', '泳装');
    assert.match(cap, /black bikini/); assert.doesNotMatch(cap, /school uniform|red bikini/);
    assert.equal(b.Lin.currentOutfitId, 'w-swim'); assert.equal(b.Lin.currentOutfit, 'black bikini');
    assert.equal(b.Lin.wardrobe[0].outfit, 'school uniform, red tie');
    assert.equal(b.Lin.outfitLocked, false);
});
test('A: near-same or empty LLM outfit keeps the locked stored text', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = wardrobeProfile();
    b.Lin.wardrobe[0].locked = true;
    let cap = sdt.mergeCharacterCaption('Lin', 'girl', 'school uniform, red tie, uniform', 'smile', '', '');
    assert.match(cap, /school uniform, red tie, smile$/);
    cap = sdt.mergeCharacterCaption('Lin', 'girl', '', 'smile', '', '');
    assert.match(cap, /school uniform, red tie/);
    assert.equal(b.Lin.currentOutfit, 'school uniform, red tie'); assert.equal(b.Lin.currentOutfitId, 'w-school');
    assert.equal(b.Lin.wardrobe.length, 3); assert.equal(b.Lin.wardrobe[0].outfit, 'school uniform, red tie');
});
test('A: different outfit under lock is archived as new; locked item unchanged', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = wardrobeProfile({ outfitLocked: true, isOutfitLocked: true });
    b.Lin.wardrobe[0].locked = true;
    const cap = sdt.mergeCharacterCaption('Lin', 'girl', 'white hoodie, denim shorts, sneakers', 'walking', '', '');
    assert.match(cap, /white hoodie, denim shorts, sneakers/);
    assert.equal(b.Lin.wardrobe.length, 4);
    const added = b.Lin.wardrobe[3];
    assert.equal(added.outfit, 'white hoodie, denim shorts, sneakers'); assert.equal(added.locked, false);
    assert.equal(b.Lin.currentOutfitId, added.id); assert.equal(b.Lin.currentOutfit, added.outfit);
    assert.deepEqual(b.Lin.wardrobe[0], { id: 'w-school', name: '校服', outfit: 'school uniform, red tie', locked: true });
    // Switching back to the locked item restores its stored text and lock.
    sdt.mergeCharacterCaption('Lin', 'girl', '', 'walking', '', '', '校服');
    assert.equal(b.Lin.currentOutfit, 'school uniform, red tie'); assert.equal(b.Lin.outfitLocked, true);
});
test('A: unlocked worn outfit content can still be updated as before', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = wardrobeProfile();
    const cap = sdt.mergeCharacterCaption('Lin', 'girl', 'school uniform, red tie, uniform', 'smile', '', '');
    assert.match(cap, /school uniform, red tie, uniform, smile$/);
    assert.equal(b.Lin.currentOutfit, 'school uniform, red tie, uniform');
});
test('B: exact wardrobe name wins over a containing name ("校服" never picks "夏季校服")', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = wardrobeProfile({ currentOutfitId: 'w-swim', currentOutfit: 'black bikini' });
    const cap = sdt.mergeCharacterCaption('Lin', 'girl', '', 'smile', '', '', '校服');
    assert.match(cap, /school uniform, red tie/); assert.doesNotMatch(cap, /summer uniform/);
    assert.equal(b.Lin.currentOutfitId, 'w-school');
});
test('B: partial claim only when unique; ambiguous partial is ignored', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = wardrobeProfile();
    let cap = sdt.mergeCharacterCaption('Lin', 'girl', 'jeans', 'smile', '', '', '夏季');
    assert.match(cap, /summer uniform/);
    b.Lin = wardrobeProfile({ wardrobe: [{ id: 'a', name: '冬季校服', outfit: 'winter uniform, coat' }, { id: 'b', name: '夏季校服', outfit: 'summer uniform, short sleeves' }] });
    cap = sdt.mergeCharacterCaption('Lin', 'girl', 'jeans', 'smile', '', '', '校服');
    assert.match(cap, /jeans/); assert.doesNotMatch(cap, /uniform/);
    cap = sdt.mergeCharacterCaption('Lin', 'girl', 'jeans', 'smile', '', '', '服');
    assert.doesNotMatch(cap, /uniform/);
});
test('B: exact trigger matches; 1-char trigger no longer matches everything', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = wardrobeProfile();
    b.Lin.wardrobe[1].triggers = ['服'];
    let cap = sdt.mergeCharacterCaption('Lin', 'girl', 'jeans', 'smile', '', '', '海边');
    assert.match(cap, /black bikini/);
    cap = sdt.mergeCharacterCaption('Lin', 'girl', 'jeans', 'smile', '', '', '运动服');
    assert.doesNotMatch(cap, /summer uniform|black bikini/);
});
const lore = (comment, key, content) => ({ comment, key, content });
test('C: lorebook exact title/key first, short names never partial-match', () => {
    const { sdt } = createEnv();
    const entries = [lore('Amira', ['amira'], 'AMIRA'), lore('Kamisato Ayaka', ['ayaka'], 'AYAKA'), lore('Ami', ['ami'], 'AMI')];
    assert.equal(sdt.findCharacterLorebookEntry(entries, 'Ami').content, 'AMI');
    assert.equal(sdt.findCharacterLorebookEntry(entries.slice(0, 2), 'Ami'), null);
    assert.equal(sdt.findCharacterLorebookEntry([lore('其他', ['咲'], 'X')], '早濑咲'), null);
    assert.equal(sdt.findCharacterLorebookEntry([lore('咲', [], 'X')], '咲').content, 'X');
});
test('C: partial needs 3+ chars, Latin word boundary, and a unique hit', () => {
    const { sdt } = createEnv();
    assert.equal(sdt.findCharacterLorebookEntry([lore('Kamisato Ayaka (Genshin)', [], 'A')], 'Kamisato Ayaka').content, 'A');
    assert.equal(sdt.findCharacterLorebookEntry([lore('Kamisato Ayakana', [], 'A')], 'Ayaka'), null);
    assert.equal(sdt.findCharacterLorebookEntry([lore('Ayaka Swimsuit', [], 'A'), lore('Ayaka Maid', [], 'B')], 'Ayaka'), null);
    assert.equal(sdt.findCharacterLorebookEntry([lore('早濑咲设定', [], 'S')], '早濑咲').content, 'S');
    assert.equal(sdt.findCharacterLorebookEntry([lore('x', ['saki'], 'S')], 'hayase saki').content, 'S');
});
test('D: V40 preset naming rule is qualified to new characters only', () => {
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    const v40 = src.slice(src.indexOf('const V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT'));
    assert.match(v40.slice(0, v40.indexOf('`;')), /命名标准（仅资产库外的新角色；已建档角色逐字复制档案 name_tag）：同人角色 2::Name \(Series\)::/);
    assert.doesNotMatch(src, /命名标准：同人角色 2::Name \(Series\)::/);
});

const plainProfile = () => ({ displayName: 'Lin', nameTag: 'Lin Yao (original)', baseTags: 'girl, black hair', currentOutfit: 'school uniform, red tie', currentOutfitId: 'w-school',
    wardrobe: [{ id: 'w-school', name: '校服', outfit: 'school uniform, red tie' }] });
test('outfit_name names the archived entry "剧情: <name>"', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = plainProfile();
    sdt.mergeCharacterCaption('Lin', 'girl', 'white sundress, straw hat, sandals', 'smile', '', '', '', '白色连衣裙');
    const added = b.Lin.wardrobe.at(-1);
    assert.equal(added.name, '剧情: 白色连衣裙');
    assert.equal(b.Lin.currentOutfitId, added.id);
});
test('outfit_name duplicate gets a number; object-form claim also carries outfit_name', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = plainProfile();
    b.Lin.wardrobe.push({ id: 'x', name: '剧情: 白色连衣裙', outfit: 'white dress, frills, ribbon' });
    sdt.mergeCharacterCaption('Lin', 'girl', 'white sundress, straw hat, sandals', 'smile', '', '', { outfit_name: '「白色连衣裙」' });
    assert.equal(b.Lin.wardrobe.at(-1).name, '剧情: 白色连衣裙 2');
    sdt.mergeCharacterCaption('Lin', 'girl', 'black gothic dress, lace gloves, boots', 'smile', '', '', '', '剧情: 白色连衣裙');
    assert.equal(b.Lin.wardrobe.at(-1).name, '剧情: 白色连衣裙 3');
});
test('missing or unusable outfit_name falls back to the old naming', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = plainProfile();
    sdt.mergeCharacterCaption('Lin', 'girl', 'white sundress, straw hat, sandals', 'smile', '', '');
    assert.equal(b.Lin.wardrobe.at(-1).name, '剧情: white sundress');
    sdt.mergeCharacterCaption('Lin', 'girl', 'black gothic dress, lace gloves, boots', 'smile', '', '', '', 'black, dress');
    assert.equal(b.Lin.wardrobe.at(-1).name, '剧情: black gothic dress');
});
test('new character initial entry uses outfit_name with 初始 prefix', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles();
    sdt.mergeCharacterCaption('Mei', 'girl, red hair', 'white sundress, straw hat', 'smile', '', 'Mei (original)', '', '白色连衣裙');
    assert.equal(b.Mei.wardrobe[0].name, '初始: 白色连衣裙');
});
test('outfit_name is in runtime prompt and tool schema text, not in stored presets', () => {
    const { sdt } = createEnv();
    const b = sdt.getCharacterProfiles(); b.Lin = plainProfile();
    assert.match(sdt.buildCharacterMemoryPromptModule(undefined, 1), /outfit_name：2-8 字中文服装名/);
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    assert.equal((src.match(/outfit_name: \{ type: 'string'/g) || []).length, 2);
    // Stored preset constants all live before the runtime tag-spec builder.
    assert.doesNotMatch(src.slice(0, src.indexOf('    function getCharacterMemoryTagSpecification')), /outfit_name/);
});

console.log(`\n${passed} passed`);
