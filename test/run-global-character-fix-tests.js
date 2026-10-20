/** SDT 6.5.47 / CW 2.2.38: review fixes for ⭐全局角色 (matching, lock, CW archive save, manga refs) + decisions B/C/D. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };
const clone = v => JSON.parse(JSON.stringify(v));

const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
function sdtEnv(characterProfiles, globalCharacters, extra = {}) {
    const env = new Function('require', '__dirname', harness + '\nreturn {sdt,settings,sdtSource};')(require, __dirname);
    const load = (a, b) => { const i = env.sdtSource.indexOf(a), j = env.sdtSource.indexOf(b, i); assert.ok(i >= 0 && j > i, a); vm.runInContext(env.sdtSource.slice(i, j), env.sdt); };
    load('    function getCanonicalCharName(name) {', '    function getCharacterMemoryTagSpecification() {');
    load('    function buildCharacterMemoryPromptModule(', '    function getActiveCharacterName(');
    load('    function mergeCharacterCaption(', '    function collectCharacterCardInfo(');
    Object.assign(env.settings._smartDrawTrigger, { _mangaActive: false, enhancedContext: 'off', characterMemoryEnabled: true, characterProfiles, globalCharacters, ...extra });
    env.logs = [];
    env.sdt.debugInfo = m => env.logs.push(String(m));
    env.sdt.getChatKey = () => 'newChat';
    return env;
}
const g = (profile) => ({ profile, setAt: 1, updatedAt: 1 });
const U = 'white sailor school uniform, pleated navy skirt, red ribbon, black socks';
const baSaki = (over = {}) => ({ displayName: '早濑沙纪', nameTag: 'Hayase Saki (Blue Archive)', nameTagSource: 'user', baseTags: 'girl, GLOBAL pink hair',
    currentOutfit: U, currentOutfitId: 'w1', wardrobe: [{ id: 'w1', name: '校服', outfit: U, triggers: [], locked: false }], createdAt: 1000, updatedAt: 1000, ...over });

// ---------------- 严重1: name_tag exact lookup ----------------
test('严重1: LLM name 早濑咲 (no alias) + exact name_tag → imports global 早濑沙纪, no new card', () => {
    const store = {};
    const { sdt } = sdtEnv(store, { '早濑沙纪': g(baSaki()) });
    const cap = sdt.mergeCharacterCaption('早濑咲', 'girl, LLM black hair', U, 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.deepEqual(Object.keys(store.newChat), ['早濑沙纪']);
    assert.ok(store.newChat['早濑沙纪'].importedFromGlobal);
    assert.match(cap, /GLOBAL pink hair/);
    assert.doesNotMatch(cap, /LLM black hair/);
});
test('严重1: same for the current chat — existing 早濑沙纪 found by exact name_tag, LLM 早濑咲 updates it', () => {
    const store = { newChat: { '早濑沙纪': baSaki({ baseLocked: false }) } };
    const { sdt } = sdtEnv(store, {});
    sdt.mergeCharacterCaption('早濑咲', 'girl, LLM black hair', 'blue string bikini, sarong, sun hat', 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.deepEqual(Object.keys(store.newChat), ['早濑沙纪']);
    assert.ok(store.newChat['早濑沙纪'].wardrobe.some(w => /bikini/.test(w.outfit)), 'new outfit archived on the same card');
});
test('严重1: manga write path uses row name_tag (resolve exported and used in code)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    assert.match(src, /const profileEntry = resolveCharacterProfileEntry\(row\.name, row\.nameTag\);/);
    assert.match(src, /updateCharacterProfile\(profileName, base, outfit/);
    const { sdt } = sdtEnv({}, { '早濑沙纪': g(baSaki()) });
    const hit = sdt.resolveCharacterProfileEntry('Saki', 'Hayase Saki (Blue Archive)');
    assert.equal(hit[0], '早濑沙纪');
});

// ---------------- 严重2: different series = different person ----------------
test('严重2: Saki (Nikke) is not the Blue Archive global; bare/other series never imported', () => {
    const store = {};
    const { sdt } = sdtEnv(store, { '早濑沙纪': g(baSaki({ nameTag: 'Saki (Blue Archive)' })) });
    assert.equal(sdt.getOrImportCharacterProfile('Saki (Nikke)'), null);
    assert.equal(sdt.getOrImportCharacterProfile('Saki', ''), null, 'name_tag is exact-only for globals (no fuzzy)');
    assert.equal(sdt.getOrImportCharacterProfile('咲', 'Saki (Nikke)'), null);
    assert.deepEqual(Object.keys(store.newChat || {}), []);
    assert.ok(sdt.getOrImportCharacterProfile('Saki (Blue Archive)'), 'exact name_tag still imports');
});
test('严重2: current Nikke 咲 is not returned for the BA global, and the BA global stays in the prompt', () => {
    const store = { newChat: { '咲': { displayName: '咲', nameTag: 'Saki (Nikke)', baseTags: 'NIKKE white hair', wardrobe: [], createdAt: 5 } } };
    const { sdt } = sdtEnv(store, { '早濑沙纪': g(baSaki({ nameTag: 'Saki (Blue Archive)', aliases: ['咲'] })) });
    assert.match(sdt.buildCharacterMemoryPromptModule(), /全局角色「早濑沙纪」/);
    const p = sdt.getOrImportCharacterProfile('早濑沙纪');
    assert.equal(p.displayName, '早濑沙纪');
    assert.match(p.baseTags, /GLOBAL pink hair/);
    assert.equal(store.newChat['咲'].baseTags, 'NIKKE white hair');
});
test('严重2: series compare ignores skins and translated series; (original) never conflicts', () => {
    const { sdt } = sdtEnv({}, {});
    assert.deepEqual(clone(sdt.getCharSeriesKeys('Hayase Saki (Blue Archive) (swimsuit)')), ['bluearchive']);
    assert.deepEqual(clone(sdt.getCharSeriesKeys('Hayase Saki（蓝色档案）')), []);
    assert.deepEqual(clone(sdt.getCharSeriesKeys('Hayase Saki (original)')), []);
    assert.deepEqual(clone(sdt.getCharSeriesKeys('[Hayase Saki]')), []);
    assert.equal(sdt.isCharSeriesConflict(['nikke'], 'x', { nameTag: 'Saki (Blue Archive)' }), true);
    assert.equal(sdt.isCharSeriesConflict(['bluearchive'], 'x', { nameTag: 'Saki (Blue Archive)' }), false);
});

// ---------------- 中3: ambiguous alias across globals ----------------
test('中3: two globals sharing alias 姐姐 → no import + debug log', () => {
    const store = {};
    const env = sdtEnv(store, { 'A姐': g({ displayName: 'A姐', aliases: ['姐姐'], baseTags: 'a', createdAt: 1 }), 'B姐': g({ displayName: 'B姐', aliases: ['姐姐'], baseTags: 'b', createdAt: 2 }) });
    assert.equal(env.sdt.getOrImportCharacterProfile('姐姐'), null);
    assert.deepEqual(Object.keys(store.newChat || {}), []);
    assert.ok(env.logs.some(l => /同时命中多个档案的姓名\/别名/.test(l)));
    assert.ok(env.sdt.getOrImportCharacterProfile('A姐'), 'own name still imports');
});

// ---------------- 中4: default outfit seeded ----------------
test('中4 (SDT): current outfit not in wardrobe → locked 「默认服装」 survives the first outfit change', () => {
    const store = {};
    const { sdt } = sdtEnv(store, { '早濑沙纪': g(baSaki({ wardrobe: [], currentOutfitId: undefined })) });
    sdt.mergeCharacterCaption('早濑沙纪', 'girl', 'casual hoodie, jeans, sneakers', 'smile', '', 'Hayase Saki (Blue Archive)');
    const p = store.newChat['早濑沙纪'];
    const def = p.wardrobe.find(w => w.name === '默认服装');
    assert.ok(def && def.locked && def.outfit === U);
    assert.ok(p.wardrobe.some(w => /hoodie/.test(w.outfit) && !w.locked));
});

// ---------------- 小8: locked outfit verbatim ----------------
test('小8: switching back to a locked outfit without a claim uses its stored text verbatim', () => {
    const store = {};
    const { sdt } = sdtEnv(store, { '早濑沙纪': g(baSaki()) });
    sdt.mergeCharacterCaption('早濑沙纪', 'girl', 'blue string bikini, sarong, sun hat', 'smile', '', 'Hayase Saki (Blue Archive)');
    const variant = 'white sailor school uniform, pleated navy skirt, red ribbon, white socks, loafers';
    const cap = sdt.mergeCharacterCaption('早濑沙纪', 'girl', variant, 'walk', '', 'Hayase Saki (Blue Archive)');
    const p = store.newChat['早濑沙纪'];
    assert.equal(p.currentOutfitId, 'w1');
    assert.equal(p.currentOutfit, U);
    assert.equal(p.outfitLocked, true);
    assert.ok(cap.includes(U) && !cap.includes('loafers'));
    assert.equal(p.wardrobe.find(w => w.id === 'w1').outfit, U);
    assert.match(p.baseTags, /GLOBAL pink hair/);
});
test('小8: updateCharacterProfile (manga path) wearing a locked entry stores its text verbatim', () => {
    const store = { newChat: { '沙纪': { displayName: '沙纪', baseTags: 'girl', currentOutfit: 'blue string bikini, sarong, sun hat', currentOutfitId: 'w2', outfitLocked: false,
        wardrobe: [{ id: 'w1', name: '校服', outfit: U, locked: true }, { id: 'w2', name: '泳装', outfit: 'blue string bikini, sarong, sun hat', locked: false }], createdAt: 1 } } };
    const { sdt } = sdtEnv(store, {});
    sdt.updateCharacterProfile('沙纪', null, 'white sailor school uniform, pleated navy skirt, red ribbon, white socks, loafers', null, true, {});
    assert.equal(store.newChat['沙纪'].currentOutfitId, 'w1');
    assert.equal(store.newChat['沙纪'].currentOutfit, U);
});

// ---------------- 小9: card extraction toast ----------------
test('小9: card extraction warns instead of 已提取外貌 when the base lock blocked it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    const i = src.indexOf('const extractedCleanBase = stripCharacterIdentityFromBase(');
    const body = src.slice(i, src.indexOf('} catch (err) {', i));
    assert.match(body, /const baseBlocked = /);
    assert.match(body, /toastr\.warning\(`「\$\{cleanCharName\}」的人设已锁定🔒，外貌没有被覆盖/);
    assert.ok(body.indexOf('toastr.success(`已提取') > body.indexOf('if (baseBlocked)'));
});

// ---------------- 中7: manga references ----------------
test('中7: getMangaMemoryReferences carries ⭐全局角色 (global:true) until she is in the chat; manga prompt explains it', () => {
    const store = { newChat: {} };
    const { sdt, settings } = sdtEnv(store, { '早濑沙纪': g(baSaki()) });
    let refs = sdt.getMangaMemoryReferences(3);
    const ref = refs.find(r => r.global === true);
    assert.ok(ref && ref.name === '早濑沙纪' && ref.name_tag === 'Hayase Saki (Blue Archive)' && /GLOBAL pink hair/.test(ref.base));
    assert.ok(ref.wardrobe.length === 1 && ref.note);
    store.newChat['早濑沙纪'] = baSaki();
    refs = sdt.getMangaMemoryReferences(3);
    assert.equal(refs.filter(r => r.name === '早濑沙纪').length, 1);
    assert.equal(refs.some(r => r.global === true), false);
    delete store.newChat['早濑沙纪'];
    Object.assign(settings._smartDrawTrigger, { _mangaActive: true, enhancedContext: 'v_manga' });
    assert.match(sdt.buildCharacterMemoryPromptModule(), /global:true 的是⭐全局角色/);
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    assert.match(src, /references\.push\(\.\.\.getMangaGlobalMemoryReferences\(chatProfiles, requestStore\)\)/);
    assert.match(src, /memoryList\.length > 0 \|\| mangaMemory\.some\(r => r\?\.global === true\)/, 'layered/manga payload sends globals even in an empty chat');
});

// ---------------- 决定 C: no wardrobe cap ----------------
test('决定 C: all global outfits are listed (no cap), current outfit first', () => {
    const wardrobe = Array.from({ length: 12 }, (_, i) => ({ id: 'w' + i, name: '服装' + i, outfit: 'OUTFIT-' + i, locked: false }));
    const { sdt } = sdtEnv({}, { '早濑沙纪': g(baSaki({ wardrobe, currentOutfitId: 'w7', currentOutfit: 'OUTFIT-7' })) });
    const prompt = sdt.buildCharacterMemoryPromptModule();
    for (let i = 0; i < 12; i++) assert.ok(prompt.includes('OUTFIT-' + i), i);
    assert.ok(prompt.indexOf('【服装7】') < prompt.indexOf('【服装0】'));
});

// ---------------- 决定 D: no suppression ----------------
test('决定 D: deleting the imported copy lets her be re-imported next time she appears', () => {
    const store = {};
    const { sdt } = sdtEnv(store, { '早濑沙纪': g(baSaki()) });
    sdt.getOrImportCharacterProfile('早濑沙纪');
    delete store.newChat['早濑沙纪'];
    assert.ok(sdt.getOrImportCharacterProfile('早濑沙纪').importedFromGlobal);
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    assert.doesNotMatch(src, /globalCharacterSuppressions|GLOBAL_PROMPT_WARDROBE_LIMIT|buildLegacyArchiveHintSection/);
});

// ---------------- 中6 (SDT side) ----------------
test('中6 (SDT): known-profile lookup prefers the real archive over an imported global copy', () => {
    const env = sdtEnv({ a: { '早濑沙纪': { ...baSaki(), baseTags: 'IMPORTED', importedFromGlobal: { name: '早濑沙纪' } } }, b: { '早濑沙纪': baSaki({ baseTags: 'REAL' }) } }, {});
    const i = env.sdtSource.indexOf('    function getAllKnownCharacterProfiles() {');
    vm.runInContext(env.sdtSource.slice(i, env.sdtSource.indexOf('    function getCharacterProfiles() {', i)), env.sdt);
    const { sdt } = env;
    assert.equal(sdt.getAllKnownCharacterProfiles()['早濑沙纪'].baseTags, 'REAL');
});

// ---------------- CW ----------------
const cwSrc = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const sl = (a, b) => { const i = cwSrc.indexOf(a), j = cwSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return cwSrc.slice(i, j); };
function cwEnv(chatProfiles, chat = 'cur', confirmAnswer = true) {
    const sdt = { characterProfiles: chatProfiles };
    const toasts = [], confirms = [];
    const ctx = {
        RBQ: { api: { saveSettings() {} } }, dossierScope: 'all', isJunkCharacterName: () => false, PLUGIN_NAME: 'CW',
        getSdtStore: () => sdt, getChatKey: () => ctx._chat, _chat: chat, getWs: () => null, wsSave() {},
        ensureProfileBucket: () => (sdt.characterProfiles[ctx._chat] ||= {}),
        getCurrentChatProfiles: () => sdt.characterProfiles[ctx._chat] || {}, getMountedDoujinProfiles: () => ({}),
        toastr: { warning: (m) => toasts.push(m), success() {}, info() {} }, confirm: (m) => { confirms.push(m); return confirmAnswer; },
    };
    vm.createContext(ctx);
    vm.runInContext(sl('    /** Locked base/outfit', '    let _cachedDoujinProfiles = null;') + sl('    function getProfile(name) {', '    function getOutfitTagsForSlot(') +
        '\nObject.assign(this, { setGlobalCharacter, isGlobalCharacter, getGlobalCharacterProfile, importGlobalCharacterToCurrentChat, saveProfile, deleteProfile, getProfile, getAllGlobalProfiles, findGlobalAliasConflicts, warnGlobalAliasConflicts, askSyncImportedGlobalCopies, countImportedGlobalCopies, syncGlobalToImportedCopies, buildImportedGlobalCopy });', ctx);
    return { ctx, sdt, toasts, confirms };
}
const editorData = (p, over = {}) => ({ displayName: p.displayName, nameTag: p.nameTag, aliases: p.aliases || [], baseTags: p.baseTags, baseLocked: !!p.baseLocked, isBaseLocked: !!p.baseLocked,
    outfitLocked: false, isOutfitLocked: false, currentOutfit: p.currentOutfit, currentOutfitId: p.currentOutfitId, wardrobe: clone(p.wardrobe), createdAt: p.createdAt, ...over });

test('中4 (CW): import builder seeds locked 「默认服装」 and marks global outfits fromGlobal', () => {
    const { ctx } = cwEnv({});
    const c = ctx.buildImportedGlobalCopy('早濑沙纪', baSaki({ wardrobe: [{ id: 'w9', name: '泳装', outfit: 'SWIM', locked: false }], currentOutfitId: undefined }));
    assert.equal(c.wardrobe[0].name, '默认服装');
    assert.equal(c.wardrobe[0].outfit, U);
    assert.ok(c.wardrobe.every(w => w.locked && w.fromGlobal));
    assert.equal(c.currentOutfitId, c.wardrobe[0].id);
});
test('中5: 角色库 save of a global char from a fresh chat does not create a copy there; own copy is still updated', () => {
    const { ctx, sdt } = cwEnv({ src: { '早濑沙纪': baSaki() } }, 'fresh');
    ctx.setGlobalCharacter('早濑沙纪', true);
    const gp = ctx.getProfile('早濑沙纪');
    ctx.saveProfile('早濑沙纪', editorData(gp, { baseTags: 'G-EDIT' }), 'all');
    assert.equal(sdt.characterProfiles.fresh['早濑沙纪'], undefined);
    assert.equal(sdt.globalCharacters['早濑沙纪'].profile.baseTags, 'G-EDIT');
    assert.equal(sdt.characterProfiles.src['早濑沙纪'].baseTags, 'G-EDIT', 'same-identity archive still synced');
    ctx._chat = 'src';
    ctx.saveProfile('早濑沙纪', editorData(ctx.getProfile('早濑沙纪'), { baseTags: 'G-EDIT-2' }), 'all');
    assert.equal(sdt.characterProfiles.src['早濑沙纪'].baseTags, 'G-EDIT-2', 'the chat that owns a real copy is written');
});
test('中5: an imported copy in the current chat is not overwritten by a 角色库 save (CW 2.2.39: no chat-view override)', () => {
    const { ctx, sdt } = cwEnv({ src: { '早濑沙纪': baSaki() } }, 'imp');
    ctx.setGlobalCharacter('早濑沙纪', true);
    ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    ctx.saveProfile('早濑沙纪', editorData(ctx.getProfile('早濑沙纪'), { baseTags: 'G-EDIT' }), 'all');
    assert.match(sdt.characterProfiles.imp['早濑沙纪'].baseTags, /GLOBAL pink hair/);
    assert.equal(sdt.characterProfiles.imp['早濑沙纪'].baseLocked, true);
    // CW 2.2.39 removed the 「📦 同步至角色库」 checkbox (and fromChatView): a chat-view save uses scope 'chat'.
    ctx.saveProfile('早濑沙纪', editorData(sdt.characterProfiles.imp['早濑沙纪'], { baseTags: 'G-EDIT-2' }), 'all', { fromChatView: true });
    assert.match(sdt.characterProfiles.imp['早濑沙纪'].baseTags, /GLOBAL pink hair/, 'stale fromChatView flag is ignored');
    assert.equal(sdt.globalCharacters['早濑沙纪'].profile.baseTags, 'G-EDIT-2');
    ctx.saveProfile('早濑沙纪', editorData(sdt.characterProfiles.imp['早濑沙纪'], { baseTags: 'CHAT-VIEW-EDIT' }), 'chat');
    assert.equal(sdt.characterProfiles.imp['早濑沙纪'].baseTags, 'CHAT-VIEW-EDIT');
    assert.equal(sdt.globalCharacters['早濑沙纪'].profile.baseTags, 'G-EDIT-2', 'chat save never writes the global');
});
test('中6 (CW): 角色库 prefers the real archive over a locked imported copy (unflag / re-flag)', () => {
    const { ctx, sdt } = cwEnv({ src: { '早濑沙纪': baSaki({ baseTags: 'REAL' }) } }, 'imp');
    ctx.setGlobalCharacter('早濑沙纪', true);
    ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    sdt.characterProfiles.imp['早濑沙纪'].wardrobe.push({ id: 'x', name: '剧情: 泳装', outfit: 'BIKINI', locked: false });
    sdt.characterProfiles.imp['早濑沙纪'].updatedAt = Date.now() + 9;
    ctx.setGlobalCharacter('早濑沙纪', false);
    assert.equal(ctx.getAllGlobalProfiles()['早濑沙纪'].importedFromGlobal, undefined);
    ctx.setGlobalCharacter('早濑沙纪', true);
    assert.deepEqual(clone(sdt.globalCharacters['早濑沙纪'].profile.wardrobe.map(w => w.name)), ['校服']);
});
test('中3 (CW): duplicate name/alias with another global is detected and warned', () => {
    const { ctx, toasts } = cwEnv({ a: { 'A姐': { displayName: 'A姐', aliases: ['姐姐'], createdAt: 1 } }, b: { 'B姐': { displayName: 'B姐', aliases: ['姐姐', '小B'], createdAt: 2 } } });
    ctx.setGlobalCharacter('A姐', true);
    ctx.setGlobalCharacter('B姐', true);
    assert.deepEqual(clone(ctx.findGlobalAliasConflicts('B姐')), [{ other: 'A姐', term: '姐姐' }]);
    assert.equal(ctx.warnGlobalAliasConflicts('B姐'), true);
    assert.match(toasts[0], /「姐姐」与⭐全局角色「A姐」重复/);
    assert.deepEqual(clone(ctx.findGlobalAliasConflicts('B姐', { displayName: 'B姐', aliases: ['小B'] })), []);
});
test('决定 B: confirm counts imported copies; yes → base + global outfits updated, session outfits kept', () => {
    const { ctx, sdt, confirms } = cwEnv({ src: { '早濑沙纪': baSaki() } }, 'c1');
    ctx.setGlobalCharacter('早濑沙纪', true);
    ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    ctx._chat = 'c2'; ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    sdt.characterProfiles.c2['早濑沙纪'].wardrobe.push({ id: 's1', name: '剧情: 泳装', outfit: 'BIKINI', locked: false });
    sdt.characterProfiles.c2['早濑沙纪'].currentOutfitId = 's1';
    sdt.characterProfiles.c2['早濑沙纪'].currentOutfit = 'BIKINI';
    ctx._chat = 'fresh';
    assert.equal(ctx.countImportedGlobalCopies('早濑沙纪'), 2);
    assert.equal(ctx.askSyncImportedGlobalCopies('早濑沙纪'), true);
    assert.match(confirms[0], /同时更新已导入的 2 个对话吗/);
    const gp = ctx.getProfile('早濑沙纪');
    const wardrobe = [{ id: 'w1', name: '校服', outfit: 'NEW UNIFORM', locked: false }, { id: 'w3', name: '礼服', outfit: 'GOWN', locked: false }];
    ctx.saveProfile('早濑沙纪', editorData(gp, { baseTags: 'G-EDIT', wardrobe, currentOutfit: 'NEW UNIFORM', currentOutfitId: 'w1' }), 'all', { syncImported: true });
    for (const c of ['c1', 'c2']) {
        const p = sdt.characterProfiles[c]['早濑沙纪'];
        assert.equal(p.baseTags, 'G-EDIT', c);
        assert.equal(p.baseLocked, true, c);
        assert.deepEqual(clone(p.wardrobe.filter(w => w.fromGlobal).map(w => [w.name, w.outfit, w.locked])), [['校服', 'NEW UNIFORM', true], ['礼服', 'GOWN', true]], c);
        assert.ok(p.importedFromGlobal.syncedAt > 0);
    }
    assert.equal(sdt.characterProfiles.c1['早濑沙纪'].currentOutfit, 'NEW UNIFORM');
    const c2 = sdt.characterProfiles.c2['早濑沙纪'];
    assert.ok(c2.wardrobe.some(w => w.id === 's1' && w.outfit === 'BIKINI'), 'session-added outfit kept');
    assert.equal(c2.currentOutfit, 'BIKINI', 'session outfit still worn');
    assert.equal(sdt.characterProfiles.fresh?.['早濑沙纪'], undefined);
});
test('决定 B: no → imported copies untouched; no copies → no confirm', () => {
    const { ctx, sdt, confirms } = cwEnv({ src: { '早濑沙纪': baSaki() } }, 'c1', false);
    ctx.setGlobalCharacter('早濑沙纪', true);
    assert.equal(ctx.askSyncImportedGlobalCopies('早濑沙纪'), false);
    assert.equal(confirms.length, 0);
    ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    ctx._chat = 'fresh';
    const syncImported = ctx.askSyncImportedGlobalCopies('早濑沙纪');
    assert.equal(confirms.length, 1);
    ctx.saveProfile('早濑沙纪', editorData(ctx.getProfile('早濑沙纪'), { baseTags: 'G-EDIT' }), 'all', { syncImported });
    assert.match(sdt.characterProfiles.c1['早濑沙纪'].baseTags, /GLOBAL pink hair/);
    assert.equal(sdt.globalCharacters['早濑沙纪'].profile.baseTags, 'G-EDIT');
});
test('CW editor wiring: ask before rename/delete, pass syncImported, warn alias conflicts', () => {
    const i = cwSrc.indexOf("mask.querySelector('#cw-ce-save')?.addEventListener('click'");
    const body = cwSrc.slice(i, cwSrc.indexOf('syncChips();', i));
    assert.ok(body.indexOf('askSyncImportedGlobalCopies(name)') < body.indexOf('deleteProfile(editName, targetScope)'));
    assert.match(body, /\{ makeGlobal: keepGlobalOnRename, syncImported \}/);
    assert.match(body, /warnGlobalAliasConflicts\(name\)/);
    assert.match(cwSrc, /const VERSION = '2\.2\.40'/);
});

console.log(`\n${passed} global character fix tests passed.`);
