/** SDT 6.5.48 / CW 2.2.39: 「启用角色外貌记忆」 default ON for new installs (saved values kept), CW 「一键打开」 banner +
 *  honest set-global toast, 「参考角色卡信息」 saves on click, group-chat 「从角色卡提取」 only reads this group's members,
 *  and 「清空当前记忆」 warns about characters that only exist in this chat. No model/image calls. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const pending = [];
const test = (n, fn) => { const r = fn(); if (r && r.then) pending.push(r.then(() => { passed++; console.log('PASS', n); })); else { passed++; console.log('PASS', n); } };

const sdtSrc = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const cwSrc = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

// ── 1. default ON for new installs, saved values kept ──
const defaultsSrc = cut(sdtSrc, '    const DEFAULTS = {', '        systemPrompt: DEFAULT_SYSTEM_PROMPT,');
test('DEFAULTS.characterMemoryEnabled is true; injectCharacterCard stays true', () => {
    assert.match(defaultsSrc, /\n\s*characterMemoryEnabled: true,/);
    assert.match(defaultsSrc, /\n\s*injectCharacterCard: true,/);
});
function runGetStore(settings) {
    const ctx = {
        settings, STORAGE_KEY: '_smartDrawTrigger', ALT_STORAGE_KEY: '_smartDrawTriggerSettings',
        DEFAULTS: { characterMemoryEnabled: true, injectCharacterCard: true, characterProfiles: {} },
        DEFAULT_SYSTEM_PROMPT_VERSION: 46, DEFAULT_JAILBREAK_PRESET: 'sandbox', JAILBREAK_PRESETS: {}, V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT: 'v40', V5_SPEC_97_SYSTEM_PROMPT: 'v5',
        RBQ: { api: { getSettings: () => settings } },
    };
    vm.createContext(ctx);
    vm.runInContext(cut(sdtSrc, '    function getStore() {', '    function save() {') + '\nthis.getStore = getStore;', ctx);
    return ctx.getStore();
}
const base = { systemPromptVersion: 46, geminiJailbreakPreset: 'sandbox' };
test('new install (no saved key) → ON', () => assert.equal(runGetStore({}).characterMemoryEnabled, true));
test('existing store without the key → ON (same as a new install)', () => assert.equal(runGetStore({ _smartDrawTrigger: { ...base } }).characterMemoryEnabled, true));
test('existing saved false is kept (not force-flipped)', () => assert.equal(runGetStore({ _smartDrawTrigger: { ...base, characterMemoryEnabled: false } }).characterMemoryEnabled, false));
test('existing saved true is kept', () => assert.equal(runGetStore({ _smartDrawTriggerSettings: { ...base, characterMemoryEnabled: true } }).characterMemoryEnabled, true));

// ── 3. 「参考角色卡信息（未建档时）」 saves on click ──
test('inject-char-card checkbox has an auto-save change listener and is bound once', () => {
    assert.match(sdtSrc, /getElementById\('rbq-sdt-inject-char-card'\)\.addEventListener\('change', \(e\) => \{\s*const s = getStore\(\);\s*s\.injectCharacterCard = e\.target\.checked;\s*save\(\);/);
    assert.equal((sdtSrc.match(/bindSwitch\('rbq-sdt-inject-char-card-field'/g) || []).length, 1, 'double bind would toggle twice');
    assert.equal((sdtSrc.match(/bindSwitch\('rbq-sdt-char-memory-field'/g) || []).length, 1);
});
test('save button lives in the sticky bar at the TOP of the panel (before the nav tabs)', () => {
    const panel = cut(sdtSrc, "        container.innerHTML = `", '<!-- 模块四');
    const sticky = panel.indexOf('class="rbq-sdt-sticky-save"'), btn = panel.indexOf('id="rbq-sdt-save"'), tabs = panel.indexOf('class="rbq-sdt-nav-tabs"');
    assert.ok(sticky > 0 && sticky < btn && btn < tabs);
    assert.match(sdtSrc, /\.rbq-sdt-sticky-save \{ position:sticky; top:0;/);
    assert.equal((sdtSrc.match(/id="rbq-sdt-save"/g) || []).length, 1);
});

// ── 4. group chat extraction ──
function sdtCardEnv() {
    const ctx = { escapeHtml: s => String(s) };
    vm.createContext(ctx);
    vm.runInContext(cut(sdtSrc, '    function getCanonicalCharName(name) {', '    // ── Lookup-only name normalization') +
        cut(sdtSrc, '    function getActiveChatCharacters(ctx) {', '    function chooseGroupMemberCard(') + '\nObject.assign(this, { getActiveChatCharacters, resolveCardForExtraction });', ctx);
    return ctx;
}
const lib = [{ name: 'Library First', avatar: 'lib.png' }, { name: '爱丽丝', avatar: 'alice.png' }, { name: 'Bob', avatar: 'bob.png' }, { name: '', avatar: 'blank.png' }, { name: 'Carol', avatar: 'carol.png' }];
test('group: only member cards, in member order; never the library\'s first card', () => {
    const e = sdtCardEnv();
    const g = { characters: lib, groupId: 'g1', characterId: 0, groups: [{ id: 'g1', members: ['carol.png', 'alice.png'] }] };
    assert.deepEqual(Array.from(e.getActiveChatCharacters(g), c => c.name), ['Carol', '爱丽丝']);
    const r = e.resolveCardForExtraction(g);
    assert.equal(r.char, null); assert.equal(r.needsChoice, true); assert.equal(r.isGroup, true);
    assert.equal(e.resolveCardForExtraction(g, '爱丽丝').char.name, '爱丽丝');
    assert.equal(e.resolveCardForExtraction(g, 'carol').char.name, 'Carol', 'case-insensitive');
    assert.equal(e.resolveCardForExtraction(g, 'Library First').needsChoice, true, 'non-member name is ignored');
});
test('group with one member → that member; numeric group id; object members', () => {
    const e = sdtCardEnv();
    const g = { characters: lib, groupId: 7, groups: [{ id: '7', members: [{ avatar: 'bob.png' }] }] };
    const r = e.resolveCardForExtraction(g);
    assert.equal(r.char.name, 'Bob'); assert.ok(!r.needsChoice);
});
test('group not found in ctx.groups → current speaker only; members missing → empty (no library fallback)', () => {
    const e = sdtCardEnv();
    assert.deepEqual(Array.from(e.getActiveChatCharacters({ characters: lib, groupId: 'zz', characterId: 2, groups: [] }), c => c.name), ['Bob']);
    const r = e.resolveCardForExtraction({ characters: lib, groupId: 'g1', groups: [{ id: 'g1', members: ['ghost.png'] }] });
    assert.equal(r.char, null); assert.equal(r.candidates.length, 0); assert.ok(!r.needsChoice);
});
test('1:1: the open card only; no characterId → nothing (was characters[0])', () => {
    const e = sdtCardEnv();
    assert.equal(e.resolveCardForExtraction({ characters: lib, characterId: 4 }).char.name, 'Carol');
    assert.equal(e.resolveCardForExtraction({ characters: lib, characterId: '1' }).char.name, '爱丽丝');
    assert.equal(e.resolveCardForExtraction({ characters: lib }).char, null);
    assert.equal(e.resolveCardForExtraction({ characters: lib, characterId: '' }).char, null);
    assert.equal(e.resolveCardForExtraction({ characters: lib, groupId: '', characterId: 2 }).char.name, 'Bob', 'empty groupId = 1:1');
});
test('importCharacterFromCurrentCard uses resolveCardForExtraction + chooser; old characters.find/characters[0] gone', () => {
    const fn = cut(sdtSrc, '    async function importCharacterFromCurrentCard(options = {}) {', '    const TEST_PRESETS = {');
    assert.match(fn, /resolveCardForExtraction\(ctx, options\?\.preferName\)/);
    assert.match(fn, /if \(target\.needsChoice\) \{\s*char = await chooseGroupMemberCard\(target\.candidates\);\s*if \(!char\) return false;/);
    assert.doesNotMatch(fn, /characters\.find\(c => c && c\.name\)|char = characters\[0\]/);
    assert.match(sdtSrc, /RBQ\.api\.importCharacterFromCurrentCard = \(options = \{\}\) => \{\s*return importCharacterFromCurrentCard\(options\);/);
    const info = cut(sdtSrc, '    function collectCharacterCardInfo(', '    // References for standalone manga');
    assert.match(info, /const activeChars = getActiveChatCharacters\(ctx\);/);
});
test('chooser modal: pick resolves the card, cancel/backdrop resolves null', async () => {
    const appended = [];
    const mkModal = () => {
        const m = { listeners: {}, remove() { m.removed = true; }, addEventListener(t, f) { m.listeners[t] = f; }, style: {} };
        return m;
    };
    const ctx = { escapeHtml: s => String(s), document: { getElementById: () => null, createElement: () => mkModal(), body: { appendChild: m => appended.push(m) } } };
    vm.createContext(ctx);
    vm.runInContext(cut(sdtSrc, '    function chooseGroupMemberCard(', '    function collectCharacterCardInfo(') + '\nthis.choose = chooseGroupMemberCard;', ctx);
    const cands = [lib[4], lib[1]];
    const p1 = ctx.choose(cands);
    const m1 = appended[0];
    assert.match(m1.innerHTML, /这是群聊：要从哪张角色卡提取外貌？/);
    assert.match(m1.innerHTML, /Carol[\s\S]*爱丽丝/);
    m1.listeners.click({ target: { closest: sel => sel === '.rbq-sdt-pick-card' ? { dataset: { idx: '1' } } : null } });
    assert.equal(await p1, lib[1]); assert.ok(m1.removed);
    const p2 = ctx.choose(cands);
    const m2 = appended[1];
    m2.listeners.click({ target: { closest: sel => sel === '.rbq-sdt-pick-card-cancel' ? {} : null } });
    assert.equal(await p2, null);
});
test('CW editor passes the edited name as preferName', () => {
    assert.match(cwSrc, /RBQ\.api\.importCharacterFromCurrentCard\(\{ preferName: draft\.displayName \}\)/);
});

// ── 5. 「清空当前记忆」 confirm ──
function clearEnv() {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(cut(sdtSrc, '    function getChatOnlyCharacterNames(', '    function clearAllCharacterProfiles() {') + '\nObject.assign(this, { getChatOnlyCharacterNames, buildClearCharacterProfilesConfirm });', ctx);
    return ctx;
}
test('chat-only names exclude names in other chats and ⭐globals', () => {
    const e = clearEnv();
    const store = { characterProfiles: { cur: { A: {}, B: {}, G: {}, C: {} }, other: { B: {} }, x: null }, globalCharacters: { G: { profile: {} } } };
    assert.deepEqual(Array.from(e.getChatOnlyCharacterNames(store, 'cur')), ['A', 'C']);
    const msg = e.buildClearCharacterProfilesConfirm(store, 'cur');
    assert.match(msg, /^确定清空当前聊天的所有角色记忆吗？（共 4 位）/);
    assert.match(msg, /⚠️ 其中 2 位只存在于这个对话：「A」、「C」\n清空后这些角色也会从「角色库」里消失，且无法撤销/);
    assert.match(msg, /导出备份/);
});
test('confirm: all archived elsewhere / empty chat / >10 names', () => {
    const e = clearEnv();
    const m1 = e.buildClearCharacterProfilesConfirm({ characterProfiles: { cur: { B: {} }, o: { B: {} } } }, 'cur');
    assert.match(m1, /角色库」里仍能找到/); assert.doesNotMatch(m1, /⚠️/);
    const m2 = e.buildClearCharacterProfilesConfirm({ characterProfiles: {} }, 'cur');
    assert.equal(m2, '确定清空当前聊天的所有角色记忆吗？（共 0 位）');
    const many = {}; for (let i = 0; i < 12; i++) many['N' + i] = {};
    const m3 = e.buildClearCharacterProfilesConfirm({ characterProfiles: { cur: many } }, 'cur');
    assert.match(m3, /其中 12 位只存在于这个对话：「N0」[\s\S]*「N9」 等\n/); assert.doesNotMatch(m3, /「N10」/);
    assert.match(sdtSrc, /if \(confirm\(buildClearCharacterProfilesConfirm\(getStore\(\), getChatKey\(\)\)\)\) \{\s*clearAllCharacterProfiles\(\);/);
});

// ── 2. SDT API + CW banner / toast ──
function fakeDom() {
    const els = { 'rbq-sdt-char-memory': { checked: false }, 'rbq-sdt-char-memory-field': { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
    return { els, document: { getElementById: id => els[id] || null } };
}
test('RBQ.api.setCharacterMemoryEnabled sets, saves and syncs the SDT checkbox', () => {
    const { els, document } = fakeDom();
    const store = { characterMemoryEnabled: false };
    let saves = 0;
    const ctx = { RBQ: { api: {} }, getStore: () => store, save: () => saves++, document };
    vm.createContext(ctx);
    vm.runInContext(cut(sdtSrc, '    RBQ.api.setCharacterMemoryEnabled = (enabled) => {', '    RBQ.api.collectMangaReferenceData'), ctx);
    assert.equal(ctx.RBQ.api.setCharacterMemoryEnabled(true), true);
    assert.equal(store.characterMemoryEnabled, true); assert.equal(saves, 1);
    assert.equal(els['rbq-sdt-char-memory'].checked, true); assert.equal(els['rbq-sdt-char-memory-field'].attrs['aria-checked'], 'true');
});
function cwEnv(sdt, api = {}) {
    const { els, document } = fakeDom();
    let saves = 0;
    const ctx = { RBQ: { api: { getSettings: () => ({ _smartDrawTrigger: sdt }), saveSettings: () => saves++, ...api } }, SDT_KEY: '_smartDrawTrigger', document };
    vm.createContext(ctx);
    vm.runInContext(cut(cwSrc, '    function getSdtStore() {', '    function isJunkCharacterName(name) {') + '\nObject.assign(this, { isSdtCharacterMemoryOn, enableSdtCharacterMemory, renderMemoryOffBanner });', ctx);
    return { ctx, els, saves: () => saves };
}
test('CW banner: shown only when the switch is saved false', () => {
    assert.equal(cwEnv({ characterMemoryEnabled: true }).ctx.renderMemoryOffBanner(), '');
    assert.equal(cwEnv({}).ctx.renderMemoryOffBanner(), '', 'undefined = SDT default (ON)');
    const html = cwEnv({ characterMemoryEnabled: false }).ctx.renderMemoryOffBanner();
    assert.match(html, /「角色外貌记忆」没有打开：正文生图不会用这里的角色档案、⭐全局角色和锁定/);
    assert.match(html, /id="cw-enable-memory-btn"[^>]*>.*一键打开/);
    const main = cut(cwSrc, '    function renderMain(tab) {', '    function bindEvents(');
    assert.ok(main.indexOf('${renderMemoryOffBanner()}') > main.indexOf('class="cw-hdr"') && main.indexOf('${renderMemoryOffBanner()}') < main.indexOf('id="cw-tab-content"'));
    assert.match(cwSrc, /querySelector\('#cw-enable-memory-btn'\)\?\.addEventListener\('click', \(\) => \{\s*if \(enableSdtCharacterMemory\(\)\)[\s\S]*?refresh\(activeTab\);/);
});
test('CW 一键打开: uses SDT API when present', () => {
    const sdt = { characterMemoryEnabled: false };
    let called = null;
    const { ctx } = cwEnv(sdt, { setCharacterMemoryEnabled: v => { called = v; sdt.characterMemoryEnabled = v; } });
    assert.equal(ctx.enableSdtCharacterMemory(), true); assert.equal(called, true);
});
test('CW 一键打开: fallback writes store, saves, syncs checkbox', () => {
    const sdt = { characterMemoryEnabled: false };
    const { ctx, els, saves } = cwEnv(sdt);
    assert.equal(ctx.enableSdtCharacterMemory(), true);
    assert.equal(sdt.characterMemoryEnabled, true); assert.equal(saves(), 1);
    assert.equal(els['rbq-sdt-char-memory'].checked, true);
    assert.equal(ctx.renderMemoryOffBanner(), '');
});
test('set-global toast only promises 「任何会话都会发给 LLM」 when the switch is on', () => {
    const h = cut(cwSrc, "} else if (setGlobalCharacter(name, true)) {", 'warnGlobalAliasConflicts(name);');
    assert.match(h, /if \(isSdtCharacterMemoryOn\(\)\) \{\s*toastr\.success\(`「\$\{name\}」已设为全局角色：任何会话都会发给 LLM/);
    assert.match(h, /\} else \{\s*toastr\.warning\(`「\$\{name\}」已设为全局角色，但「角色外貌记忆」没有打开，现在还不会发给 LLM。点顶部「一键打开」后生效。`/);
});

Promise.all(pending).then(() => console.log(`\n${passed} passed`)).catch(e => { console.error(e); process.exit(1); });
