/** CW 2.2.39: 角色库「导出备份」 carries ⭐全局角色 bodies (incl. globals with no chat copy); 「导入文件」 restores them
 *  (confirm before overwriting a different same-name global; old backups still work). 当前会话 delete only touches this chat.
 *  Lock hint wording; editing a locked profile works. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };
const clone = v => JSON.parse(JSON.stringify(v));

const cwSrc = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const sdtSrc = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const sl = (a, b) => { const i = cwSrc.indexOf(a), j = cwSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return cwSrc.slice(i, j); };

function cwEnv(chatProfiles, chat = 'cur', scope = 'all') {
    const sdt = { characterProfiles: chatProfiles };
    const confirms = [];
    const forgot = [];
    const ctx = {
        RBQ: { api: { saveSettings() {}, forgetMangaCharacterMemory: (n, ck) => forgot.push([n, ck]) } }, dossierScope: scope,
        isJunkCharacterName: () => false, PLUGIN_NAME: 'CW',
        getSdtStore: () => sdt, getChatKey: () => ctx._chat, _chat: chat, getWs: () => null, wsSave() {},
        ensureProfileBucket: () => (sdt.characterProfiles[ctx._chat] ||= {}),
        getCurrentChatProfiles: () => sdt.characterProfiles[ctx._chat] || {}, getMountedDoujinProfiles: () => ({}),
        toastr: { warning() {}, success() {}, info() {} }, _answer: true, confirm: (m) => { confirms.push(m); return ctx._answer; },
    };
    vm.createContext(ctx);
    vm.runInContext('var dossierScope = this.dossierScope;\n' + sl('    /** Locked base/outfit', '    let _cachedDoujinProfiles = null;') + sl('    function getAllProfiles() {', '    function getOutfitTagsForSlot(') +
        '\nObject.assign(this, { setGlobalCharacter, isGlobalCharacter, getGlobalCharacterProfile, importGlobalCharacterToCurrentChat, saveProfile, getProfile, deleteProfile, getAllProfiles, buildDossierBackupPayload, importDossierBackupData, restoreGlobalCharactersFromBackup, setScope: s => { dossierScope = s; } });', ctx);
    return { ctx, sdt, confirms, forgot };
}
const U = 'white sailor school uniform';
const prof = (name, over = {}) => ({ displayName: name, nameTag: `${name} (original)`, baseTags: `girl, ${name} hair`, currentOutfit: U, currentOutfitId: 'w1',
    wardrobe: [{ id: 'w1', name: '校服', outfit: U, locked: false }], createdAt: 1000, updatedAt: 1000, ...over });

/** 角色库: 林瑶 (archive only), 早濑沙纪 (archive + ⭐global), 白鸟 (⭐global, chat copy deleted afterwards). */
function libraryEnv() {
    const env = cwEnv({ a: { '林瑶': prof('林瑶') }, b: { '早濑沙纪': prof('早濑沙纪') }, c: { '白鸟': prof('白鸟', { wardrobe: [{ id: 'w1', name: '校服', outfit: U }, { id: 'w2', name: '泳装', outfit: 'bikini' }] }) } }, 'a');
    env.ctx.setGlobalCharacter('早濑沙纪', true);
    env.ctx.setGlobalCharacter('白鸟', true);
    delete env.sdt.characterProfiles.c['白鸟']; // global-only now
    return env;
}

test('角色库 export includes ⭐global bodies + names, also a global with no chat copy', () => {
    const { ctx, sdt } = libraryEnv();
    const payload = clone(ctx.buildDossierBackupPayload('all', ctx.getAllProfiles()));
    assert.equal(payload.type, 'rbq-character-dossier-backup');
    assert.equal(payload.version, '1.1');
    assert.deepEqual(Object.keys(payload.characters).sort(), ['早濑沙纪', '林瑶'].sort());
    assert.deepEqual(payload.globalNames.sort(), ['早濑沙纪', '白鸟'].sort());
    assert.deepEqual(payload.globalCharacters['白鸟'].profile, clone(sdt.globalCharacters['白鸟'].profile));
    assert.equal(payload.globalCharacters['白鸟'].profile.wardrobe.length, 2);
    assert.equal(payload.globalCharacters['白鸟'].setAt, sdt.globalCharacters['白鸟'].setAt);
    assert.equal(payload.count, 3, 'count = union of archives and globals');
});
test('current-chat export unchanged: no global fields, version 1.0', () => {
    const { ctx } = libraryEnv();
    ctx.setScope('chat');
    const payload = clone(ctx.buildDossierBackupPayload('chat', ctx.getAllProfiles()));
    assert.equal(payload.version, '1.0');
    assert.equal(payload.scope, 'chat');
    assert.ok(!('globalCharacters' in payload) && !('globalNames' in payload));
    assert.deepEqual(Object.keys(payload.characters), ['林瑶']);
    assert.equal(payload.count, 1);
    // 角色库 with no globals stays at the old shape too.
    const plain = cwEnv({ a: { '林瑶': prof('林瑶') } }, 'a');
    const p2 = clone(plain.ctx.buildDossierBackupPayload('all', plain.ctx.getAllProfiles()));
    assert.equal(p2.version, '1.0');
    assert.ok(!('globalCharacters' in p2));
});
test('round trip: restore into an empty install recreates globals (incl. global-only) and imports archives to current chat', () => {
    const { ctx } = libraryEnv();
    const backup = clone(ctx.buildDossierBackupPayload('all', ctx.getAllProfiles()));
    const fresh = cwEnv({}, 'new', 'all');
    const r = fresh.ctx.importDossierBackupData(clone(backup), 'b.json');
    assert.equal(r.importedCount, 2);
    assert.deepEqual([...r.globals.restored].sort(), ['早濑沙纪', '白鸟'].sort());
    assert.equal(fresh.confirms.length, 0, 'no confirm when nothing is overwritten');
    assert.ok(fresh.ctx.isGlobalCharacter('白鸟') && fresh.ctx.isGlobalCharacter('早濑沙纪'));
    assert.deepEqual(clone(fresh.sdt.globalCharacters['白鸟'].profile), backup.globalCharacters['白鸟'].profile);
    assert.equal(fresh.sdt.globalCharacters['白鸟'].setAt, backup.globalCharacters['白鸟'].setAt);
    assert.ok(!fresh.sdt.characterProfiles.new['白鸟'], 'global-only character is not dumped into the current chat');
    assert.ok(fresh.sdt.characterProfiles.new['林瑶']);
    // 角色库 view shows it again.
    assert.equal(fresh.ctx.getProfile('白鸟').wardrobe.length, 2);
});
test('same-name global with different body: confirm; OK overwrites, cancel keeps existing, rest still imported', () => {
    const { ctx } = libraryEnv();
    const backup = clone(ctx.buildDossierBackupPayload('all', ctx.getAllProfiles()));
    for (const answer of [true, false]) {
        const env = cwEnv({ x: { '白鸟': prof('白鸟', { baseTags: 'LOCAL EDIT' }) } }, 'x');
        env.ctx.setGlobalCharacter('白鸟', true);
        env.ctx._answer = answer;
        const r = clone(env.ctx.importDossierBackupData(clone(backup), "b.json"));
        assert.equal(env.confirms.length, 1);
        assert.match(env.confirms[0], /备份里的⭐全局角色「白鸟」和现有的同名全局角色内容不同/);
        assert.doesNotMatch(env.confirms[0], /早濑沙纪/, 'new globals are not conflicts');
        assert.ok(env.ctx.isGlobalCharacter('早濑沙纪'), 'non-conflicting global restored either way');
        assert.equal(r.importedCount, 2);
        if (answer) {
            assert.deepEqual(r.globals.restored.sort(), ['早濑沙纪', '白鸟'].sort());
            assert.match(env.sdt.globalCharacters['白鸟'].profile.baseTags, /白鸟 hair/);
        } else {
            assert.deepEqual(r.globals.skipped, ['白鸟']);
            assert.equal(env.sdt.globalCharacters['白鸟'].profile.baseTags, 'LOCAL EDIT');
        }
    }
});
test('identical existing global: no confirm, reported unchanged', () => {
    const { ctx, confirms } = libraryEnv();
    const backup = clone(ctx.buildDossierBackupPayload('all', ctx.getAllProfiles()));
    const r = clone(ctx.restoreGlobalCharactersFromBackup(backup));
    assert.equal(confirms.length, 0);
    assert.deepEqual(r.unchanged.sort(), ['早濑沙纪', '白鸟'].sort());
    assert.equal(r.restored.length, 0);
});
test('old backup files (no globalCharacters) behave exactly as before; malformed global entries ignored', () => {
    const env = cwEnv({}, 'n');
    const old = { version: '1.0', type: 'rbq-character-dossier-backup', scope: 'all', count: 1, characters: { '林瑶': prof('林瑶') } };
    const r = env.ctx.importDossierBackupData(old, 'old.json');
    assert.equal(r.importedCount, 1);
    assert.equal(r.globals.restored.length, 0);
    assert.ok(!env.sdt.globalCharacters || !Object.keys(env.sdt.globalCharacters).length);
    assert.equal(env.ctx.importDossierBackupData({ character: prof('单人') }, 'x.json').importedCount, 1);
    assert.equal(env.ctx.importDossierBackupData(prof('裸档'), '裸档.json').importedCount, 1);
    assert.equal(env.ctx.importDossierBackupData({ '甲': prof('甲'), '乙': prof('乙') }, 'm.json').importedCount, 2);
    const bad = env.ctx.importDossierBackupData({ characters: {}, globalCharacters: { 坏: null, 也坏: { profile: 'x' }, 空: {} } }, 'b.json');
    assert.equal(bad.importedCount, 0);
    assert.equal(bad.globals.restored.length, 0);
});
test('UI wiring: export uses buildDossierBackupPayload, import uses importDossierBackupData, toast mentions globals', () => {
    assert.match(cwSrc, /const exportData = buildDossierBackupPayload\(dossierScope, getAllProfiles\(\)\);/);
    assert.match(cwSrc, /含 \$\{globalCount\} 位⭐全局角色/);
    assert.match(cwSrc, /const \{ importedCount, globals \} = importDossierBackupData\(raw, file\.name\);/);
    assert.match(cwSrc, /恢复 \$\{globals\.restored\.length\} 位⭐全局角色/);
    assert.match(cwSrc, /buildGlobalCharactersBackup\(selectedDossierNames\)/, 'batch export in 角色库 also carries selected globals');
});

test('当前会话 delete: only this chat; name missing here → nothing deleted anywhere', () => {
    const env = cwEnv({ a: { '林瑶': prof('林瑶') }, b: { '林瑶': prof('林瑶'), '早濑沙纪': prof('早濑沙纪') } }, 'a', 'chat');
    env.ctx.setGlobalCharacter('早濑沙纪', true, prof('早濑沙纪'));
    const before = clone(env.sdt);
    assert.equal(env.ctx.deleteProfile('早濑沙纪', 'chat'), false);
    assert.equal(env.ctx.deleteProfile('不存在', 'chat'), false);
    assert.deepEqual(clone(env.sdt.characterProfiles.b), before.characterProfiles.b, 'other chat untouched');
    assert.deepEqual(clone(env.sdt.globalCharacters), before.globalCharacters, 'global untouched');
    assert.equal(env.forgot.length, 0);
    assert.equal(env.ctx.deleteProfile('林瑶', 'chat'), true);
    assert.ok(!env.sdt.characterProfiles.a['林瑶']);
    assert.ok(env.sdt.characterProfiles.b['林瑶'], 'same name in other chat kept');
    assert.deepEqual(clone(env.forgot), [['林瑶', 'a']]);
});
test('当前会话 delete: displayName from another chat does not widen the match', () => {
    // Chat b stores key "Saki" with displayName "沙纪"; chat a has its own "沙纪". Deleting "Saki" in chat a must not hit a's 沙纪.
    const env = cwEnv({ a: { '沙纪': prof('沙纪') }, b: { 'Saki': prof('沙纪酱', { displayName: '沙纪' }) } }, 'a', 'chat');
    assert.equal(env.ctx.deleteProfile('Saki', 'chat'), false, 'Saki lives only in chat b');
    assert.ok(env.sdt.characterProfiles.a['沙纪'], 'not deleted via displayName borrowed from chat b');
    assert.ok(env.sdt.characterProfiles.b['Saki']);
});
test('角色库 delete still clears all chats + global', () => {
    const env = cwEnv({ a: { '林瑶': prof('林瑶') }, b: { '林瑶': prof('林瑶') } }, 'a', 'all');
    env.ctx.setGlobalCharacter('林瑶', true);
    assert.equal(env.ctx.deleteProfile('林瑶', 'all'), true);
    assert.ok(!env.sdt.characterProfiles.a['林瑶'] && !env.sdt.characterProfiles.b['林瑶']);
    assert.ok(!env.ctx.isGlobalCharacter('林瑶'));
    assert.match(cwSrc, /当前会话里没有找到「\$\{charName\}」，没有删除任何内容（其他对话不受影响）/);
    assert.doesNotMatch(cwSrc, /容错兜底/);
});

const HINT = '锁定只是不让自动改写，在角色工坊里可以直接编辑；会话里的改动不会同步回全局';
test('lock hint wording everywhere (CW card + badge + import toast, SDT toast + panel badge); old wording gone', () => {
    assert.equal(cwSrc.split(HINT).length - 1, 3);
    assert.match(sdtSrc, new RegExp(`function getGlobalImportLockHint\\(\\) \\{ return '${HINT}'; \\}`));
    assert.ok(sdtSrc.includes(`title="从全局角色导入（导入时人设与服装默认锁定）。${HINT}"`));
    for (const src of [cwSrc, sdtSrc]) assert.doesNotMatch(src, /手动解锁修改/);
});
test('editing a locked imported copy in 当前会话 works without unlocking (lock kept)', () => {
    const env = cwEnv({ src: { '早濑沙纪': prof('早濑沙纪') } }, 'c1', 'chat');
    env.ctx.setGlobalCharacter('早濑沙纪', true);
    env.ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    const cur = env.sdt.characterProfiles.c1['早濑沙纪'];
    assert.ok(cur.baseLocked && cur.wardrobe.every(w => w.locked));
    const w = clone(cur.wardrobe); w[0].outfit = 'EDITED outfit';
    env.ctx.saveProfile('早濑沙纪', { displayName: '早濑沙纪', baseTags: 'EDITED base', wardrobe: w, baseLocked: true, isBaseLocked: true, createdAt: cur.createdAt }, 'chat');
    const after = env.sdt.characterProfiles.c1['早濑沙纪'];
    assert.equal(after.baseTags, 'EDITED base');
    assert.equal(after.wardrobe[0].outfit, 'EDITED outfit');
    assert.ok(after.baseLocked && after.wardrobe[0].locked, 'still locked');
    assert.match(env.sdt.globalCharacters['早濑沙纪'].profile.baseTags, /早濑沙纪 hair/, 'global untouched');
    // Editor never disables base/outfit fields on lock.
    const editor = sl('    function openCharacterEditor(', '    function openMountLorebookModal(');
    assert.doesNotMatch(editor.match(/<textarea id="cw-ce-base"[^>]*>/)[0], /disabled|readonly/);
    assert.doesNotMatch(editor.match(/<textarea id="cw-ce-wtags"[^>]*>/)[0], /disabled|readonly/);
});

console.log(`\n${passed} CW backup/global/delete/lock-hint tests passed.`);
