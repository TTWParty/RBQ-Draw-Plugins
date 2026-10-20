/** CW 2.2.39: 当前会话 editor no longer has 「📦 同步至角色库所有会话副本」; chat saves touch only this chat (never the ⭐全局角色).
 *  A 「只改本对话；要改所有对话请去角色库」 hint (当前会话 only) links to the 角色库 view. 角色库-scope saves unchanged. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };
const clone = v => JSON.parse(JSON.stringify(v));

const cwSrc = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const sl = (a, b) => { const i = cwSrc.indexOf(a), j = cwSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return cwSrc.slice(i, j); };
const editorSrc = sl('    function openCharacterEditor(', '    function openMountLorebookModal(');
const saveHandler = editorSrc.slice(editorSrc.indexOf("mask.querySelector('#cw-ce-save')?.addEventListener('click'"), editorSrc.indexOf('syncChips();', editorSrc.indexOf("#cw-ce-save')?.addEventListener")));

function cwEnv(chatProfiles, chat = 'cur', confirmAnswer = true) {
    const sdt = { characterProfiles: chatProfiles };
    const confirms = [];
    const ctx = {
        RBQ: { api: { saveSettings() {} } }, dossierScope: 'all', isJunkCharacterName: () => false, PLUGIN_NAME: 'CW',
        getSdtStore: () => sdt, getChatKey: () => ctx._chat, _chat: chat, getWs: () => null, wsSave() {},
        ensureProfileBucket: () => (sdt.characterProfiles[ctx._chat] ||= {}),
        getCurrentChatProfiles: () => sdt.characterProfiles[ctx._chat] || {}, getMountedDoujinProfiles: () => ({}),
        toastr: { warning() {}, success() {}, info() {} }, confirm: (m) => { confirms.push(m); return confirmAnswer; },
    };
    vm.createContext(ctx);
    vm.runInContext(sl('    /** Locked base/outfit', '    let _cachedDoujinProfiles = null;') + sl('    function getProfile(name) {', '    function getOutfitTagsForSlot(') +
        '\nObject.assign(this, { setGlobalCharacter, importGlobalCharacterToCurrentChat, saveProfile, getProfile, askSyncImportedGlobalCopies });', ctx);
    return { ctx, sdt, confirms };
}
const U = 'white sailor school uniform';
const saki = (over = {}) => ({ displayName: '早濑沙纪', nameTag: 'Hayase Saki (Blue Archive)', baseTags: 'girl, GLOBAL pink hair',
    currentOutfit: U, currentOutfitId: 'w1', wardrobe: [{ id: 'w1', name: '校服', outfit: U, locked: false }], createdAt: 1000, updatedAt: 1000, ...over });
const edit = (p, over = {}) => ({ displayName: p.displayName, nameTag: p.nameTag, baseTags: p.baseTags, wardrobe: clone(p.wardrobe),
    currentOutfit: p.currentOutfit, currentOutfitId: p.currentOutfitId, createdAt: p.createdAt, ...over });

test('checkbox is gone: no cw-ce-sync-global / 同步至角色库所有会话副本 / fromChatView anywhere in CW', () => {
    assert.doesNotMatch(cwSrc, /cw-ce-sync-global|同步至角色库所有会话副本|fromChatView/);
    assert.match(saveHandler, /const targetScope = dossierScope;/);
    assert.match(saveHandler, /\{ makeGlobal: keepGlobalOnRename, syncImported \}/);
});
test('hint + 角色库 link render only in 当前会话 scope', () => {
    const m = editorSrc.match(/\$\{(dossierScope === 'chat' \? `<span class="cw-ce-chat-only-hint"[\s\S]*?<\/span>` : '')\}/);
    assert.ok(m, 'hint template');
    for (const [scope, shown] of [['chat', true], ['all', false], ['lorebook', false]]) {
        const html = vm.runInNewContext(m[1], { dossierScope: scope });
        assert.equal(/只改本对话；要改所有对话请去<button[^>]*class="cw-ce-open-library"[^>]*>角色库<\/button>/.test(html), shown, scope);
    }
    // Placed in the footer right before the save button.
    const ft = editorSrc.slice(editorSrc.indexOf('cw-ce-chat-only-hint'), editorSrc.indexOf('id="cw-ce-save"'));
    assert.ok(ft.length > 0 && ft.includes('id="cw-ce-cancel"'));
});
test('link closes the editor and switches to 角色库 via the shared scope switch', () => {
    assert.match(editorSrc, /querySelector\('\.cw-ce-open-library'\)\?\.addEventListener\('click', \(\) => \{\s*mask\.remove\(\);\s*if \(typeof onOpenLibrary === 'function'\) onOpenLibrary\(\);/);
    assert.match(cwSrc, /const openLibraryFromEditor = \(\) => \{ if \(setDossierScope\('all'\)\) refresh\('dossier'\); \};/);
    assert.equal((cwSrc.match(/openCharacterEditor\([^)]*\(\) => refresh\('dossier'\), openLibraryFromEditor\)/g) || []).length, 2, 'create + edit callers');
    assert.match(cwSrc, /if \(setDossierScope\(b\.dataset\.scope\)\) refresh\('dossier'\);/, 'scope tabs reuse the same switch');
    const ctx = { dossierScope: 'chat', selectedDossierNames: new Set(['x']) };
    vm.createContext(ctx);
    vm.runInContext('var dossierScope = this.dossierScope; const selectedDossierNames = this.selectedDossierNames;\n' + sl('    function setDossierScope(scope) {', '    function openCharacterEditor(') +
        '\nthis.go = s => { const r = setDossierScope(s); this.dossierScope = dossierScope; return r; };', ctx);
    assert.equal(ctx.go('all'), true);
    assert.equal(ctx.dossierScope, 'all');
    assert.equal(ctx.selectedDossierNames.size, 0);
    assert.equal(ctx.go('bogus'), false);
    assert.equal(ctx.dossierScope, 'all');
});
test('chat save of an imported ⭐global copy: only this chat changes; global and other imported copies untouched; no B prompt', () => {
    const { ctx, sdt, confirms } = cwEnv({ src: { '早濑沙纪': saki() } }, 'c1');
    ctx.setGlobalCharacter('早濑沙纪', true);
    ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    ctx._chat = 'c2'; ctx.importGlobalCharacterToCurrentChat('早濑沙纪');
    const before = { g: clone(sdt.globalCharacters['早濑沙纪'].profile), c1: clone(sdt.characterProfiles.c1['早濑沙纪']), src: clone(sdt.characterProfiles.src['早濑沙纪']) };
    ctx.saveProfile('早濑沙纪', edit(sdt.characterProfiles.c2['早濑沙纪'], { baseTags: 'C2-ONLY' }), 'chat');
    assert.equal(sdt.characterProfiles.c2['早濑沙纪'].baseTags, 'C2-ONLY');
    assert.ok(sdt.characterProfiles.c2['早濑沙纪'].importedFromGlobal, 'still marked as imported');
    assert.deepEqual(clone(sdt.globalCharacters['早濑沙纪'].profile), before.g);
    assert.deepEqual(clone(sdt.characterProfiles.c1['早濑沙纪']), before.c1);
    assert.deepEqual(clone(sdt.characterProfiles.src['早濑沙纪']), before.src);
    assert.equal(confirms.length, 0);
    assert.match(saveHandler, /targetScope === 'all' && !keepGlobalOnRename && \(!isEdit \|\| editName === name\) && askSyncImportedGlobalCopies\(name\)/, 'B prompt only for 角色库 scope');
});
test('chat save of an ordinary character never syncs other chats; 角色库 save still syncs copies + global + B prompt', () => {
    const { ctx, sdt, confirms } = cwEnv({ a: { '林瑶': saki({ displayName: '林瑶', nameTag: 'Lin Yao (original)' }) }, b: { '林瑶': saki({ displayName: '林瑶', nameTag: 'Lin Yao (original)' }) } }, 'a');
    ctx.saveProfile('林瑶', edit(sdt.characterProfiles.a['林瑶'], { baseTags: 'A-ONLY' }), 'chat');
    assert.equal(sdt.characterProfiles.a['林瑶'].baseTags, 'A-ONLY');
    assert.match(sdt.characterProfiles.b['林瑶'].baseTags, /GLOBAL pink hair/);
    // 角色库 scope unchanged: same-identity copies synced, global updated, imported copies via B.
    ctx.setGlobalCharacter('林瑶', true);
    ctx._chat = 'imp'; ctx.importGlobalCharacterToCurrentChat('林瑶');
    ctx._chat = 'fresh';
    const syncImported = ctx.askSyncImportedGlobalCopies('林瑶');
    assert.match(confirms[0], /同时更新已导入的 1 个对话吗/);
    ctx.saveProfile('林瑶', edit(ctx.getProfile('林瑶'), { baseTags: 'LIB-EDIT' }), 'all', { syncImported });
    assert.equal(sdt.globalCharacters['林瑶'].profile.baseTags, 'LIB-EDIT');
    assert.equal(sdt.characterProfiles.imp['林瑶'].baseTags, 'LIB-EDIT');
});
test('save toast: 当前会话 says only this chat changed; 角色库 keeps the sync wording; version 2.2.39', () => {
    assert.match(saveHandler, /targetScope === 'chat'\s*\? \('「' \+ name \+ '」已保存到当前对话（其他对话和⭐全局角色不受影响）'\)/);
    assert.match(saveHandler, /已保存，并已同步至角色库中同一档案的各会话副本！/);
    assert.match(cwSrc, /const VERSION = '2\.2\.40'/);
    assert.match(fs.readFileSync(path.join(__dirname, '../plugins.json'), 'utf8'), /character-workshop\.js\?v=2\.2\.40/);
});

console.log(`\n${passed} CW chat-only save tests passed.`);
