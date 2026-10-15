/** Character Workshop 2.2.37: overwrite current-chat profile from preferred global archive. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
assert.match(src, /const VERSION = '2\.2\.37'/);
assert.match(src, /用全局版本覆盖当前/);
assert.match(src, /cw-overwrite-from-global/);
assert.doesNotMatch(src, /本会话已存在/);
assert.match(src, /确定用全局历史中的「\$\{name\}」档案覆盖当前会话中的版本吗？/);
assert.match(src, /锁定优先、其次最早建档/);

const h0 = src.indexOf('    /** Locked base/outfit');
const h1 = src.indexOf('    function getAllGlobalProfiles() {');
const g0 = src.indexOf('    function getAllGlobalProfiles() {');
const g1 = src.indexOf('    let _cachedDoujinProfiles = null;');
const p0 = src.indexOf('    function getProfile(name) {');
const p1 = src.indexOf('    function saveProfile(');
const s0 = src.indexOf('    function saveProfile(');
const s1 = src.indexOf('    function overwriteCurrentChatFromGlobal(');
const o0 = src.indexOf('    function overwriteCurrentChatFromGlobal(');
const o1 = src.indexOf('    function deleteProfile(');
assert.ok(h0 > 0 && h1 > h0 && g0 > 0 && g1 > g0 && p0 > 0 && p1 > p0 && s0 > 0 && s1 > s0 && o0 > 0 && o1 > o0);

let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };

function env(chatProfiles = {}) {
    const sdt = { characterProfiles: chatProfiles };
    const ctx = {
        RBQ: { api: { saveSettings() {} } },
        dossierScope: 'all',
        isJunkCharacterName: () => false,
        getSdtStore: () => sdt,
        ensureProfileBucket: () => {
            if (!sdt.characterProfiles.cur) sdt.characterProfiles.cur = {};
            return sdt.characterProfiles.cur;
        },
        getCurrentChatProfiles: () => sdt.characterProfiles.cur || {},
        getMountedDoujinProfiles: () => ({}),
    };
    vm.createContext(ctx);
    vm.runInContext(
        src.slice(h0, h1) + src.slice(g0, g1) + src.slice(p0, p1) + src.slice(s0, s1) + src.slice(o0, o1) +
        '\nthis.getAllGlobalProfiles = getAllGlobalProfiles;' +
        '\nthis.overwriteCurrentChatFromGlobal = overwriteCurrentChatFromGlobal;' +
        '\nthis.saveProfile = saveProfile;',
        ctx
    );
    return { ctx, sdt };
}

const oldSaki = () => ({
    displayName: '早濑沙纪', nameTag: 'Hayase Saki (Blue Archive)',
    baseTags: 'girl, OLD-BASE pink hair', currentOutfit: 'OLD-OUTFIT school uniform',
    wardrobe: [{ id: 'w1', name: '校服', outfit: 'OLD-OUTFIT school uniform', locked: false }],
    createdAt: 1000, updatedAt: 5000,
    baseLocked: true, isBaseLocked: true,
});
const newSaki = () => ({
    displayName: '早濑沙纪',
    baseTags: 'girl, NEW-BASE long black hair', currentOutfit: 'NEW-OUTFIT red dress',
    wardrobe: [{ id: 'w2', name: '红裙', outfit: 'NEW-OUTFIT red dress', locked: false }],
    parseOnlyField: 'should-be-gone',
    createdAt: 9000, updatedAt: 9000,
});

test('overwrite replaces current-chat parse card with locked/earliest global archive', () => {
    const { ctx, sdt } = env({
        oldChat: { '早濑沙纪': oldSaki() },
        cur: { '早濑沙纪': newSaki() },
    });
    assert.equal(ctx.getAllGlobalProfiles()['早濑沙纪'].baseTags.includes('OLD-BASE'), true);
    assert.equal(ctx.overwriteCurrentChatFromGlobal('早濑沙纪'), true);
    const cur = sdt.characterProfiles.cur['早濑沙纪'];
    assert.match(cur.baseTags, /OLD-BASE/);
    assert.match(cur.currentOutfit, /OLD-OUTFIT/);
    assert.equal(cur.createdAt, 1000, 'keeps global/source createdAt identity');
    assert.equal(cur.baseLocked, true);
    assert.equal(cur.parseOnlyField, undefined, 'parse-only leftovers must not survive overwrite');
    // Old chat archive untouched.
    assert.match(sdt.characterProfiles.oldChat['早濑沙纪'].baseTags, /OLD-BASE/);
    assert.equal(sdt.characterProfiles.oldChat['早濑沙纪'].updatedAt, 5000);
});

test('overwrite among unlocked copies prefers earliest createdAt', () => {
    const { ctx, sdt } = env({
        a: { '芙宁娜': { displayName: '芙宁娜', createdAt: 5000, updatedAt: 9000, baseTags: 'newer-unlocked' } },
        b: { '芙宁娜': { displayName: '芙宁娜', createdAt: 1000, updatedAt: 1000, baseTags: 'oldest-unlocked' } },
        cur: { '芙宁娜': { displayName: '芙宁娜', createdAt: 8000, updatedAt: 8000, baseTags: 'parse-new', junk: 1 } },
    });
    assert.equal(ctx.overwriteCurrentChatFromGlobal('芙宁娜'), true);
    assert.equal(sdt.characterProfiles.cur['芙宁娜'].baseTags, 'oldest-unlocked');
    assert.equal(sdt.characterProfiles.cur['芙宁娜'].createdAt, 1000);
    assert.equal(sdt.characterProfiles.cur['芙宁娜'].junk, undefined);
});

test('overwrite returns false when name missing from global history', () => {
    const { ctx, sdt } = env({ cur: { '路人': { displayName: '路人', baseTags: 'x', createdAt: 1, updatedAt: 1 } } });
    assert.equal(ctx.overwriteCurrentChatFromGlobal('不存在的角色'), false);
    assert.equal(sdt.characterProfiles.cur['路人'].baseTags, 'x');
});

test('UI: same-name shows overwrite button; absent name still uses 导入当前', () => {
    assert.match(src, /chatProfiles\[n\] \? `[\s\S]*?cw-overwrite-from-global[\s\S]*?` : `[\s\S]*?cw-import-from-global/);
    assert.match(src, /已用全局版本覆盖当前会话中的「\$\{name\}」档案/);
});

console.log(`\n${passed} CW overwrite-from-global tests passed.`);
