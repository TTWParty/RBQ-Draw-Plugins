/** Repro: new chat parse vs. the 角色库 archive. Since SDT 6.5.45 only ⭐全局角色 are reused across chats (see run-global-character-tests.js). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('✓', n); };

// ---- SDT: parse path (mergeCharacterCaption → updateCharacterProfile) ----
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
function sdtEnv(store) {
    const env = new Function('require', '__dirname', harness + '\nreturn {sdt,settings,sdtSource};')(require, __dirname);
    const load = (a, b) => { const i = env.sdtSource.indexOf(a), j = env.sdtSource.indexOf(b, i); assert.ok(i >= 0 && j > i, a); vm.runInContext(env.sdtSource.slice(i, j), env.sdt); };
    load('    function getCanonicalCharName(name) {', '    function getCharacterMemoryTagSpecification() {');
    load('    function buildCharacterMemoryPromptModule(', '    function getActiveCharacterName(');
    load('    function getAllKnownCharacterProfiles() {', '    function isSameOutfit(a, b) {');
    load('    function mergeCharacterCaption(', '    function collectCharacterCardInfo(');
    Object.assign(env.settings._smartDrawTrigger, { _mangaActive: false, enhancedContext: 'off', characterMemoryEnabled: true, characterProfiles: store });
    env.sdt.getChatKey = () => 'newChat';
    return env;
}
const oldSaki = () => ({ displayName: '早濑沙纪', nameTag: 'Hayase Saki (Blue Archive)', baseTags: 'girl, OLD-BASE pink hair',
    currentOutfit: 'OLD-OUTFIT school uniform', wardrobe: [{ id: 'w1', name: '校服', outfit: 'OLD-OUTFIT school uniform', locked: false }],
    createdAt: 1000, updatedAt: 5000 });

test('A1: 角色库 archive (not ⭐全局角色) is not sent to the LLM; new chat parse still creates its own 早濑沙纪', () => {
    // SDT 6.5.45+ (user decision A=NO): the old 5-entry archive hint 「已知全局角色资产」 is gone; only ⭐全局角色 reach the prompt.
    const store = { oldChat: { '早濑沙纪': oldSaki() } };
    const { sdt } = sdtEnv(store);
    assert.doesNotMatch(sdt.buildCharacterMemoryPromptModule(), /已知全局角色资产|早濑沙纪/);
    sdt.mergeCharacterCaption('早濑沙纪', 'girl, NEW-BASE long black hair', 'NEW-OUTFIT red dress', 'smile', '', 'Hayase Saki (Blue Archive)');
    const fresh = store.newChat['早濑沙纪'];
    assert.ok(fresh, 'new profile created in newChat');
    assert.match(fresh.baseTags, /NEW-BASE/);
    assert.ok(fresh.createdAt > 1000, 'new identity (createdAt)');
    assert.equal(fresh.importedFromGlobal, undefined);
    // Old archive untouched in storage.
    assert.match(store.oldChat['早濑沙纪'].baseTags, /OLD-BASE/);
    assert.equal(store.oldChat['早濑沙纪'].updatedAt, 5000);
});

test('A2: archive-only characters never appear in the prompt (no 5-cap hint any more)', () => {
    const store = {};
    for (let i = 0; i < 6; i++) store['c' + i] = { ['角色' + i]: { displayName: '角色' + i, baseTags: 'x', createdAt: 1, updatedAt: 1 } };
    store.zLast = { '早濑沙纪': oldSaki() };
    const { sdt } = sdtEnv(store);
    const prompt = sdt.buildCharacterMemoryPromptModule();
    assert.doesNotMatch(prompt, /早濑沙纪|角色0|已知全局角色资产/);
    assert.match(prompt, /Initial Profiling/);
});

// ---- CW: global view (2.2.36 vs 2.2.35) ----
function cwGlobal(srcText, store) {
    const s = (a, b) => { const i = srcText.indexOf(a), j = srcText.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return srcText.slice(i, j); };
    const helpers = srcText.includes('    /** Locked base/outfit') ? s('    /** Locked base/outfit', '    function getAllGlobalProfiles() {') : '';
    const ctx = { RBQ: { api: { saveSettings() {} } }, isJunkCharacterName: () => false, getSdtStore: () => ({ characterProfiles: store }) };
    vm.createContext(ctx);
    vm.runInContext(helpers + s('    function getAllGlobalProfiles() {', '    let _cachedDoujinProfiles = null;') + '\nthis.g = getAllGlobalProfiles;', ctx);
    return ctx.g();
}
const cw36 = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
let cw35 = null;
try { cw35 = require('node:child_process').execSync('git show c0aaaa1:plugins/character-workshop.js', { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (_e) { console.log('(skip 2.2.35 checks: c0aaaa1 not available)'); }
const newSaki = (extra = {}) => ({ displayName: '早濑沙纪', baseTags: 'NEW-BASE', wardrobe: [], createdAt: 9000, updatedAt: 9000, ...extra });
for (const order of ['old-first', 'new-first']) {
    const mk = (o, n) => order === 'old-first' ? { oldChat: { '早濑沙纪': o }, newChat: { '早濑沙纪': n } } : { newChat: { '早濑沙纪': n }, oldChat: { '早濑沙纪': o } };
    test(`B1 [${order}] CW 2.2.36 global view keeps OLD unlocked archive`, () => assert.equal(cwGlobal(cw36, mk(oldSaki(), newSaki()))['早濑沙纪'].baseTags.includes('OLD'), true));
    test(`B2 [${order}] CW 2.2.36 legacy old (no createdAt/updatedAt) → NEW wins`, () => {
        const o = oldSaki(); delete o.createdAt; delete o.updatedAt;
        assert.equal(cwGlobal(cw36, mk(o, newSaki()))['早濑沙纪'].baseTags, 'NEW-BASE');
    });
    if (cw35) {
        test(`B3 [${order}] CW 2.2.35 global view shows NEW (latest updatedAt wins) even if old is locked`, () => {
            const o = oldSaki(); o.baseLocked = o.isBaseLocked = true;
            assert.equal(cwGlobal(cw35, mk(o, newSaki()))['早濑沙纪'].baseTags, 'NEW-BASE');
        });
    }
}
console.log(`\n${passed} cross-chat repro checks passed.`);
