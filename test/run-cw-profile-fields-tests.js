/** Character Workshop editor fields: aliases[] and nameTag save/clear incl. global-sync copies (no UI). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const i = src.indexOf('    function saveProfile('), j = src.indexOf('    function deleteProfile(');
const a = src.indexOf('                const aliasSeen = new Set();'), b = src.indexOf(';\n', src.indexOf('const aliasesValue', a)) + 2;
assert.ok(i > 0 && j > i && a > 0 && b > a);
const aliasCode = 'function parseAliasInput(text) { const draft = { aliasesText: text };\n' + src.slice(a, b) + 'return aliasesValue; }\n';
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };
function env() {
    const sdt = { characterProfiles: { cur: {}, old: {} } };
    const ctx = { RBQ: { api: { saveSettings() {} } }, dossierScope: 'chat', isJunkCharacterName: () => false,
        getSdtStore: () => sdt, ensureProfileBucket: () => sdt.characterProfiles.cur };
    vm.createContext(ctx);
    vm.runInContext(aliasCode + src.slice(i, j) + '\nthis.parseAliasInput = parseAliasInput; this.saveProfile = saveProfile;', ctx);
    return { ctx, sdt };
}
test('aliases parsed from , and ，, trimmed and deduped', () => {
    const { ctx } = env();
    assert.deepEqual([...ctx.parseAliasInput(' 早濑咲, 早瀬ユウカ，咲 ,咲, , Saki,saki')], ['早濑咲', '早瀬ユウカ', '咲', 'Saki']);
    assert.deepEqual([...ctx.parseAliasInput('')], []);
});
test('saving aliases writes the list; clearing removes the field (local + global copies)', () => {
    const { ctx, sdt } = env();
    sdt.characterProfiles.old['早濑咲'] = { displayName: '早濑咲', aliases: ['旧'], nameTag: 'Hayase Saki (original)', baseTags: 'girl' };
    ctx.saveProfile('早濑咲', { displayName: '早濑咲', aliases: ctx.parseAliasInput('咲, Saki'), nameTag: 'Hayase Saki (Blue Archive)', nameTagSource: 'user' }, 'all');
    assert.deepEqual([...sdt.characterProfiles.cur['早濑咲'].aliases], ['咲', 'Saki']);
    assert.deepEqual([...sdt.characterProfiles.old['早濑咲'].aliases], ['咲', 'Saki']);
    assert.equal(sdt.characterProfiles.old['早濑咲'].nameTag, 'Hayase Saki (Blue Archive)');
    ctx.saveProfile('早濑咲', { displayName: '早濑咲', aliases: [], nameTag: '', nameTagSource: '' }, 'all');
    for (const b of ['cur', 'old']) {
        const p = sdt.characterProfiles[b]['早濑咲'];
        assert.ok(!('aliases' in p) && !('nameTag' in p) && !('nameTagSource' in p), b);
        assert.equal(p.displayName, '早濑咲');
    }
});
test('saves that do not include aliases keep existing aliases', () => {
    const { ctx, sdt } = env();
    sdt.characterProfiles.cur['A'] = { displayName: 'A', aliases: ['x'] };
    ctx.saveProfile('A', { baseTags: 'girl' });
    assert.deepEqual([...sdt.characterProfiles.cur['A'].aliases], ['x']);
});
console.log(`\n${passed} workshop profile field tests passed.`);
