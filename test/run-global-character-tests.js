/** SDT 6.5.45+ (now 6.5.47) / CW 2.2.38: three-tier characters — 角色库 (archive) / ⭐全局角色 (all chats, read-only for parse) / 当前会话. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };
const clone = v => JSON.parse(JSON.stringify(v));

// ---------------- SDT: real prompt module + parse merge, minimal host ----------------
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
function sdtEnv(characterProfiles, globalCharacters) {
    const env = new Function('require', '__dirname', harness + '\nreturn {sdt,settings,sdtSource};')(require, __dirname);
    const load = (a, b) => { const i = env.sdtSource.indexOf(a), j = env.sdtSource.indexOf(b, i); assert.ok(i >= 0 && j > i, a); vm.runInContext(env.sdtSource.slice(i, j), env.sdt); };
    load('    function getCanonicalCharName(name) {', '    function getCharacterMemoryTagSpecification() {');
    load('    function buildCharacterMemoryPromptModule(', '    function getActiveCharacterName(');
    load('    function mergeCharacterCaption(', '    function collectCharacterCardInfo(');
    Object.assign(env.settings._smartDrawTrigger, { _mangaActive: false, enhancedContext: 'off', characterMemoryEnabled: true, characterProfiles, globalCharacters });
    env.sdt.getChatKey = () => 'newChat';
    return env;
}
const g = (profile) => ({ profile, setAt: 1, updatedAt: 1 });
const globalSaki = () => ({
    displayName: '早濑沙纪', nameTag: 'Hayase Saki (Blue Archive)', nameTagSource: 'user', aliases: ['早濑咲', '沙纪'],
    baseTags: 'girl, GLOBAL-BASE pink hair, purple eyes', baseLocked: false, isBaseLocked: false,
    currentOutfit: 'GLOBAL-OUTFIT white sailor school uniform, pleated navy skirt', currentOutfitId: 'w1',
    wardrobe: [
        { id: 'w1', name: '校服', outfit: 'GLOBAL-OUTFIT white sailor school uniform, pleated navy skirt', triggers: [], locked: false },
        { id: 'w2', name: '泳装', outfit: 'GLOBAL-SWIM blue one-piece swimsuit', triggers: [], locked: false },
    ],
    createdAt: 1000, updatedAt: 5000,
});
const globalYuuka = () => ({ displayName: '早濑优香', nameTag: 'Hayase Yuuka (Blue Archive)', baseTags: 'girl, YUUKA-BASE blue hair',
    currentOutfit: 'YUUKA-OUTFIT black jacket', wardrobe: [{ id: 'y1', name: '制服', outfit: 'YUUKA-OUTFIT black jacket', locked: false }], createdAt: 2000, updatedAt: 2000 });

test('prompt module lists ALL ⭐全局角色 (no cap) in an empty new chat; 角色库-only archive is not listed', () => {
    const globals = { '早濑沙纪': g(globalSaki()), '早濑优香': g(globalYuuka()) };
    for (let i = 0; i < 12; i++) globals['全局角色' + i] = g({ displayName: '全局角色' + i, baseTags: 'girl, G' + i, createdAt: 10 + i, updatedAt: 10 + i });
    const { sdt } = sdtEnv({ oldChat: { '路人档案': { displayName: '路人档案', baseTags: 'x', createdAt: 1, updatedAt: 1 } } }, globals);
    const prompt = sdt.buildCharacterMemoryPromptModule();
    assert.match(prompt, /【⭐ 全局角色 \(Global Characters · 所有会话常驻\)】/);
    for (const n of Object.keys(globals)) assert.ok(prompt.includes(`全局角色「${n}」`), n);
    assert.match(prompt, /别名\/昵称: 早濑咲、沙纪/);
    assert.match(prompt, /name_tag \(英文绘图身份\): Hayase Saki \(Blue Archive\)/);
    assert.match(prompt, /GLOBAL-BASE pink hair/);
    assert.match(prompt, /【校服】\(🔒锁定\): GLOBAL-OUTFIT[^|]*\| 【泳装】\(🔒锁定\): GLOBAL-SWIM/);
    assert.match(prompt, /遇到全局角色以外的新登场角色时/);
    assert.doesNotMatch(prompt, /路人档案|Initial Profiling/);
});

test('prompt keeps ⭐全局角色 when the current chat already has other characters; same-name current wins (not listed twice)', () => {
    const cur = { '早濑沙纪': { ...globalSaki(), baseTags: 'girl, CURRENT-BASE', createdAt: 1000 }, '路人甲': { displayName: '路人甲', baseTags: 'boy', createdAt: 5, updatedAt: 5 } };
    const { sdt } = sdtEnv({ newChat: cur }, { '早濑沙纪': g(globalSaki()), '早濑优香': g(globalYuuka()) });
    const prompt = sdt.buildCharacterMemoryPromptModule();
    assert.match(prompt, /Active Character Memory Registry/);
    assert.match(prompt, /角色「路人甲」/);
    assert.match(prompt, /全局角色「早濑优香」/);
    assert.doesNotMatch(prompt, /全局角色「早濑沙纪」/, 'current session copy takes priority');
    assert.match(prompt, /CURRENT-BASE/);
    assert.doesNotMatch(prompt, /GLOBAL-BASE/);
});

test('parse: global name in empty new chat → locked copy imported (createdAt kept), no new profile, global untouched', () => {
    const store = {};
    const globals = { '早濑沙纪': g(globalSaki()), '早濑优香': g(globalYuuka()) };
    const before = clone(globals);
    const { sdt } = sdtEnv(store, globals);
    const caption = sdt.mergeCharacterCaption('早濑沙纪', 'girl, LLM-NEW-BASE long black hair', 'white sailor school uniform, pleated navy skirt, GLOBAL-OUTFIT', 'smile', '', 'Hayase Saki (Blue Archive)');
    const chat = store.newChat;
    assert.deepEqual(Object.keys(chat), ['早濑沙纪']);
    const p = chat['早濑沙纪'];
    assert.match(p.baseTags, /GLOBAL-BASE/);
    assert.doesNotMatch(p.baseTags, /LLM-NEW-BASE/);
    assert.equal(p.createdAt, 1000);
    assert.equal(p.baseLocked, true); assert.equal(p.isBaseLocked, true);
    assert.equal(p.outfitLocked, true);
    assert.ok(p.wardrobe.length === 2 && p.wardrobe.every(w => w.locked === true));
    assert.equal(p.importedFromGlobal.name, '早濑沙纪');
    assert.match(caption, /GLOBAL-BASE/);
    assert.deepEqual(globals, before, 'parse must never write ⭐全局角色');
});

test('parse: new outfit for an imported char → NEW wardrobe entry; locked outfits unchanged; global unchanged', () => {
    const store = {};
    const globals = { '早濑沙纪': g(globalSaki()) };
    const before = clone(globals);
    const { sdt } = sdtEnv(store, globals);
    sdt.mergeCharacterCaption('早濑沙纪', '', 'red silk evening dress, long gloves, high heels', 'standing', '', '', '', '红色晚礼服');
    const p = store.newChat['早濑沙纪'];
    assert.equal(p.wardrobe.length, 3);
    assert.deepEqual(clone(p.wardrobe.slice(0, 2).map(w => [w.name, w.outfit, w.locked])), [
        ['校服', 'GLOBAL-OUTFIT white sailor school uniform, pleated navy skirt', true],
        ['泳装', 'GLOBAL-SWIM blue one-piece swimsuit', true]]);
    assert.match(p.wardrobe[2].name, /红色晚礼服/);
    assert.equal(p.wardrobe[2].outfit, 'red silk evening dress, long gloves, high heels');
    assert.equal(p.currentOutfitId, p.wardrobe[2].id);
    assert.match(p.baseTags, /GLOBAL-BASE/);
    assert.equal(p.baseLocked, true);
    // Claiming a locked preset switches back without editing its text.
    sdt.mergeCharacterCaption('早濑沙纪', '', '', 'walking', '', '', '校服');
    assert.equal(p.currentOutfitId, 'w1');
    assert.equal(p.wardrobe[0].outfit, 'GLOBAL-OUTFIT white sailor school uniform, pleated navy skirt');
    assert.equal(p.wardrobe.length, 3);
    // Near-same rewrite of the locked worn outfit neither edits it nor adds an entry.
    sdt.mergeCharacterCaption('早濑沙纪', '', 'GLOBAL-OUTFIT white sailor school uniform, pleated navy skirt, socks', 'sitting');
    assert.equal(p.wardrobe.length, 3);
    assert.equal(p.currentOutfit, 'GLOBAL-OUTFIT white sailor school uniform, pleated navy skirt');
    assert.deepEqual(globals, before);
});

test('parse: current chat already has the character → current profile used, nothing imported, global untouched', () => {
    const cur = { '早濑沙纪': { displayName: '早濑沙纪', baseTags: 'girl, CURRENT-BASE', currentOutfit: 'CURRENT red hoodie', wardrobe: [], createdAt: 7000, updatedAt: 7000 } };
    const globals = { '早濑沙纪': g(globalSaki()) };
    const before = clone(globals);
    const { sdt } = sdtEnv({ newChat: cur }, globals);
    const caption = sdt.mergeCharacterCaption('早濑沙纪', 'girl, LLM-BASE', 'CURRENT red hoodie', 'smile');
    assert.match(caption, /CURRENT-BASE/);
    assert.doesNotMatch(caption, /GLOBAL-BASE/);
    assert.equal(cur['早濑沙纪'].createdAt, 7000);
    assert.equal(cur['早濑沙纪'].importedFromGlobal, undefined);
    assert.deepEqual(Object.keys(cur), ['早濑沙纪']);
    assert.deepEqual(globals, before);
});

test('parse: global characters not in the result are NOT imported; unknown names still create a new profile', () => {
    const store = {};
    const { sdt } = sdtEnv(store, { '早濑沙纪': g(globalSaki()), '早濑优香': g(globalYuuka()) });
    sdt.mergeCharacterCaption('早濑优香', '', '', 'smile');
    sdt.mergeCharacterCaption('Lin Yao', 'girl, black hair', 'green qipao dress', 'smile', '', 'Lin Yao (original)');
    assert.deepEqual(Object.keys(store.newChat).sort(), ['Lin Yao', '早濑优香']);
    assert.equal(store.newChat['Lin Yao'].importedFromGlobal, undefined);
    assert.equal(store.newChat['Lin Yao'].baseLocked, false);
});

test('parse: alias (早濑咲) and name_tag (Hayase Saki (Blue Archive)) both import 早濑沙纪, no alias-named profile', () => {
    for (const parsed of ['早濑咲', '2::Hayase Saki (Blue Archive)::']) {
        const store = {};
        const globals = { '早濑沙纪': g(globalSaki()) };
        const before = clone(globals);
        const { sdt } = sdtEnv(store, globals);
        sdt.mergeCharacterCaption(parsed, 'girl, LLM-BASE', '', 'smile');
        assert.deepEqual(Object.keys(store.newChat), ['早濑沙纪'], parsed);
        assert.match(store.newChat['早濑沙纪'].baseTags, /GLOBAL-BASE/);
        // A second mention under the other name still reuses the same imported copy.
        sdt.mergeCharacterCaption('早濑沙纪', 'girl, LLM-BASE', '', 'smile');
        assert.deepEqual(Object.keys(store.newChat), ['早濑沙纪']);
        assert.deepEqual(globals, before);
    }
});

test('updateCharacterProfile (card/manga paths) imports instead of duplicating; locked base not replaced', () => {
    const store = {};
    const globals = { '早濑沙纪': g(globalSaki()) };
    const before = clone(globals);
    const { sdt } = sdtEnv(store, globals);
    sdt.updateCharacterProfile('早濑咲', 'girl, CARD-BASE', 'GLOBAL-SWIM blue one-piece swimsuit', null, true, { replaceBase: true });
    assert.deepEqual(Object.keys(store.newChat), ['早濑沙纪']);
    assert.match(store.newChat['早濑沙纪'].baseTags, /GLOBAL-BASE/);
    assert.deepEqual(globals, before);
});

test('static: SDT never assigns to globalCharacters (parse is read-only)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    assert.match(src, /const PLUGIN_VERSION = '6\.5\.48'/);
    assert.doesNotMatch(src, /globalCharacters\s*(?:\[[^\]]*\]|\.\w+)*\s*=[^=]/);
    assert.doesNotMatch(src, /delete\s+[\w.]*globalCharacters/);
    assert.doesNotMatch(src, /已知全局角色资产/);
    assert.match(src, /DEFAULT_SYSTEM_PROMPT_VERSION = 46\b/);
});

// ---------------- CW: global flag storage, snapshot, import, delete ----------------
const cwSrc = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const sl = (a, b) => { const i = cwSrc.indexOf(a), j = cwSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return cwSrc.slice(i, j); };
function cwEnv(chatProfiles, globalCharacters) {
    const sdt = { characterProfiles: chatProfiles, ...(globalCharacters ? { globalCharacters } : {}) };
    let saves = 0;
    const ctx = {
        RBQ: { api: { saveSettings() { saves++; } } }, dossierScope: 'all', isJunkCharacterName: () => false,
        getSdtStore: () => sdt, getChatKey: () => 'cur', getWs: () => null, wsSave() {},
        ensureProfileBucket: () => (sdt.characterProfiles.cur ||= {}),
        getCurrentChatProfiles: () => sdt.characterProfiles.cur || {}, getMountedDoujinProfiles: () => ({}),
    };
    vm.createContext(ctx);
    vm.runInContext(sl('    /** Locked base/outfit', '    let _cachedDoujinProfiles = null;') + sl('    function getProfile(name) {', '    function getOutfitTagsForSlot(') +
        '\nObject.assign(this, { setGlobalCharacter, isGlobalCharacter, getGlobalCharacterProfile, getGlobalCharacterNames, importGlobalCharacterToCurrentChat, overwriteCurrentChatFromGlobal, saveProfile, deleteProfile, getProfile });', ctx);
    return { ctx, sdt, saves: () => saves };
}

test('CW: 设为全局角色 persists flag + preferred source (locked > earliest); 取消 removes it', () => {
    const lockedLater = { ...globalSaki(), baseTags: 'LOCKED-LATER', baseLocked: true, isBaseLocked: true, createdAt: 3000, mangaStateHistory: [{ messageId: 1 }] };
    const { ctx, sdt } = cwEnv({ a: { '早濑沙纪': globalSaki() }, b: { '早濑沙纪': lockedLater } });
    assert.equal(ctx.isGlobalCharacter('早濑沙纪'), false);
    assert.equal(ctx.setGlobalCharacter('早濑沙纪', true), true);
    const snap = sdt.globalCharacters['早濑沙纪'];
    assert.equal(snap.profile.baseTags, 'LOCKED-LATER');
    assert.equal(snap.profile.mangaStateHistory, undefined, 'per-chat manga history not copied');
    assert.ok(snap.setAt > 0 && snap.updatedAt > 0);
    assert.notEqual(snap.profile, lockedLater, 'snapshot is a copy');
    assert.deepEqual(clone(ctx.getGlobalCharacterNames()), ['早濑沙纪']);
    // Persisted in the shared SDT store (JSON round-trip like ST settings).
    assert.equal(JSON.parse(JSON.stringify(sdt)).globalCharacters['早濑沙纪'].profile.baseTags, 'LOCKED-LATER');
    assert.equal(ctx.setGlobalCharacter('不存在', true), false);
    assert.equal(ctx.setGlobalCharacter('早濑沙纪', false), true);
    assert.equal(ctx.isGlobalCharacter('早濑沙纪'), false);
});

test('CW: import/overwrite of a ⭐全局角色 → locked copy from the global snapshot; archive save refreshes snapshot; chat save does not', () => {
    const { ctx, sdt } = cwEnv({ old: { '早濑沙纪': globalSaki() }, cur: { '早濑沙纪': { displayName: '早濑沙纪', baseTags: 'PARSE-NEW', createdAt: 9000, updatedAt: 9000, junk: 1 } } });
    ctx.setGlobalCharacter('早濑沙纪', true);
    assert.equal(ctx.overwriteCurrentChatFromGlobal('早濑沙纪'), true);
    const cur = sdt.characterProfiles.cur['早濑沙纪'];
    assert.match(cur.baseTags, /GLOBAL-BASE/);
    assert.equal(cur.junk, undefined);
    assert.equal(cur.createdAt, 1000);
    assert.equal(cur.baseLocked, true);
    assert.ok(cur.wardrobe.every(w => w.locked));
    assert.equal(cur.importedFromGlobal.name, '早濑沙纪');
    assert.equal(sdt.globalCharacters['早濑沙纪'].profile.baseLocked, false, 'global itself not mutated by import');
    // Current-session-only edit leaves the global character alone.
    ctx.saveProfile('早濑沙纪', { displayName: '早濑沙纪', baseTags: 'CHAT-EDIT' }, 'chat');
    assert.match(sdt.globalCharacters['早濑沙纪'].profile.baseTags, /GLOBAL-BASE/);
    // Manual 角色库 edit (编辑(角色库)) updates the global character.
    ctx.saveProfile('早濑沙纪', { displayName: '早濑沙纪', baseTags: 'ARCHIVE-EDIT', createdAt: 1000 }, 'all');
    assert.equal(sdt.globalCharacters['早濑沙纪'].profile.baseTags, 'ARCHIVE-EDIT');
    assert.equal(sdt.globalCharacters['早濑沙纪'].profile.importedFromGlobal, undefined);
    // 角色库 view shows/edits the global character itself.
    assert.equal(ctx.getProfile('早濑沙纪').baseTags, 'ARCHIVE-EDIT');
});

test('CW: deleting from 角色库 also cancels the ⭐全局角色; chat-scope delete keeps it', () => {
    const { ctx, sdt } = cwEnv({ old: { '早濑沙纪': globalSaki() }, cur: {} });
    ctx.setGlobalCharacter('早濑沙纪', true);
    ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    ctx.deleteProfile('早濑沙纪', 'chat');
    assert.equal(ctx.isGlobalCharacter('早濑沙纪'), true);
    ctx.deleteProfile('早濑沙纪', 'all');
    assert.equal(ctx.isGlobalCharacter('早濑沙纪'), false);
    assert.equal(sdt.characterProfiles.old['早濑沙纪'], undefined);
});

test('CW UI strings: 角色库 rename + 设为/取消全局角色 + badges', () => {
    assert.match(cwSrc, /const VERSION = '2\.2\.39'/);
    assert.doesNotMatch(cwSrc, /全局历史/);
    for (const s of ['角色库 (${allCount})', '设为全局角色', '取消全局角色', '⭐ 全局', '⭐ 来自全局', '只看全局角色', '编辑(角色库)', '用全局版本覆盖当前', '导入当前'])
        assert.ok(cwSrc.includes(s), s);
});

console.log(`\n${passed} global character tests passed.`);
