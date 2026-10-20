/** CW 2.2.38 / SDT 6.5.47 (新手用户 feedback A+D): 角色库 status badges 「仅存档」/「⭐ 全局使用中」, lock hint, empty-chat hint. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };
const HINT = '锁定只是不让自动改写，在角色工坊里可以直接编辑；会话里的改动不会同步回全局';

const cwSrc = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const sdtSrc = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
const sl = (a, b) => { const i = cwSrc.indexOf(a), j = cwSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return cwSrc.slice(i, j); };

const prof = (name, extra = {}) => ({ displayName: name, baseTags: 'girl, ' + name, currentOutfit: 'dress', currentOutfitId: 'w1',
    wardrobe: [{ id: 'w1', name: '默认服装', outfit: 'dress', locked: false }], createdAt: 1, updatedAt: 1, ...extra });

function render(scope, chatProfiles, globalCharacters, globalOnly = false) {
    const sdt = { characterProfiles: chatProfiles, globalCharacters };
    const ctx = {
        RBQ: { api: { saveSettings() {} } }, isJunkCharacterName: () => false,
        getSdtStore: () => sdt, getChatKey: () => 'cur', getWs: () => null, wsSave() {},
        ensureProfileBucket: () => (sdt.characterProfiles.cur ||= {}),
        getCurrentChatProfiles: () => sdt.characterProfiles.cur || {}, getMountedDoujinProfiles: () => ({}),
        getMountedLorebookSource: () => null, isDossierBatchMode: false, selectedDossierNames: new Set(),
    };
    vm.createContext(ctx);
    vm.runInContext(`var dossierScope = ${JSON.stringify(scope)}; var dossierGlobalOnly = ${globalOnly};\n` + sl('    function esc(s) {', '    function toggleTag(') +
        sl('    /** Locked base/outfit', '    let _cachedDoujinProfiles = null;') + sl('    function getAllProfiles() {', '    function getOutfitTagsForSlot(') + '\n' +
        sl('    function renderDossierTab() {', '    function renderComposerTab() {') +
        '\nthis.renderDossierTab = renderDossierTab;', ctx);
    return ctx.renderDossierTab();
}
const cards = html => html.split('class="cw-chcard ').slice(1);

test('A: 角色库 cards: non-global → 「仅存档」, global → 「⭐ 全局使用中」 (one status badge each)', () => {
    const html = render('all', { old: { '路人甲': prof('路人甲'), '早濑沙纪': prof('早濑沙纪') } }, { '早濑沙纪': { profile: prof('早濑沙纪'), setAt: 1, updatedAt: 1 } });
    const cs = cards(html);
    assert.equal(cs.length, 2);
    const saki = cs.find(c => c.includes('data-name="早濑沙纪"')), passer = cs.find(c => c.includes('data-name="路人甲"'));
    assert.ok(cs.indexOf(saki) < cs.indexOf(passer), 'globals sorted first');
    assert.match(saki, />⭐ 全局使用中</); assert.doesNotMatch(saki, />仅存档</);
    assert.match(passer, />仅存档</); assert.doesNotMatch(passer, /全局使用中/);
    assert.match(passer, /title="仅存档：保存在角色库里，不会发给 LLM/);
    for (const c of cs) assert.equal((c.match(/class="cw-lib-status /g) || []).length, 1);
    assert.match(html, /只看全局角色 \(1\)/);
});
test('A: 「只看全局角色」 filter still shows only globals', () => {
    const html = render('all', { old: { '路人甲': prof('路人甲'), '早濑沙纪': prof('早濑沙纪') } }, { '早濑沙纪': { profile: prof('早濑沙纪'), setAt: 1, updatedAt: 1 } }, true);
    const cs = cards(html);
    assert.equal(cs.length, 1);
    assert.match(cs[0], /data-name="早濑沙纪"[\s\S]*⭐ 全局使用中/);
    assert.match(html, /显示全部角色/);
});
test('A: 当前会话 view has no 角色库 status badges', () => {
    const html = render('chat', { cur: { '路人甲': prof('路人甲') } }, {});
    assert.doesNotMatch(html, /仅存档|全局使用中/);
});
test('D: imported-from-global copy → 「⭐ 来自全局」 tooltip + small lock hint', () => {
    const html = render('chat', { cur: { '早濑沙纪': prof('早濑沙纪', { importedFromGlobal: true, baseLocked: true, isBaseLocked: true }), '路人甲': prof('路人甲') } }, { '早濑沙纪': { profile: prof('早濑沙纪'), setAt: 1, updatedAt: 1 } });
    const cs = cards(html);
    const saki = cs.find(c => c.includes('data-name="早濑沙纪"')), passer = cs.find(c => c.includes('data-name="路人甲"'));
    assert.match(saki, new RegExp(`title="[^"]*${HINT}">⭐ 来自全局<`));
    assert.match(saki, new RegExp(`class="cw-global-lock-hint"[^>]*>🔒 ${HINT}<`));
    assert.doesNotMatch(passer, new RegExp(HINT));
});
test('D: empty current chat → 「之前的角色都还在角色库里」 + 打开角色库 button (scope switch)', () => {
    const html = render('chat', { old: { '路人甲': prof('路人甲') } }, {});
    assert.match(html, /当前会话暂无角色档案记忆。/);
    assert.match(html, /之前的角色都还在角色库里（1 位），可直接查看与导入。/);
    assert.match(html, /<button type="button" class="cw-btn cy sm cw-scope-btn cw-open-library-btn" data-scope="all">[^<]*<i[^>]*><\/i> 打开角色库<\/button>/);
    // Global-only library (no archived copies) still counts.
    const g = render('chat', {}, { '早濑沙纪': { profile: prof('早濑沙纪'), setAt: 1, updatedAt: 1 } });
    assert.match(g, /之前的角色都还在角色库里，可直接查看与导入。/);
    assert.match(g, /已设 1 位⭐全局角色/);
    assert.match(g, /cw-open-library-btn/);
    // Brand-new user: nothing anywhere → no misleading hint.
    const none = render('chat', {}, {});
    assert.doesNotMatch(none, /之前的角色都还在角色库里|cw-open-library-btn/);
});
test('D: CW 「导入当前」 toast + SDT toast/panel carry the lock hint', () => {
    assert.ok(cwSrc.includes(`导入到当前会话（人设与服装已锁定）<br><small style="opacity:.8">${HINT}</small>\`, PLUGIN_NAME, { escapeHtml: false })`));
    assert.ok(sdtSrc.includes(`function getGlobalImportLockHint() { return '${HINT}'; }`));
    assert.ok(sdtSrc.includes(`title="从全局角色导入（导入时人设与服装默认锁定）。${HINT}">⭐来自全局</span>`));
    assert.match(cwSrc, /const VERSION = '2\.2\.40'/);
    assert.match(sdtSrc, /DEFAULT_SYSTEM_PROMPT_VERSION = 46\b/);
});
console.log(`\n${passed} CW library status / lock hint tests passed.`);
