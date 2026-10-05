/** Production memory/store VM checks with ordinary fixtures; no network or images. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, sdtSource } = new Function('require', '__dirname', harness
    + '\nreturn {manga,sdt,settings,RBQ,sdtSource};')(require, __dirname);
const workshopSource = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function deleteCharacterProfile('), sdtSource.indexOf('    function renderCharacterProfileList(')), sdt);
const stable = 'Mina (original), girl, korean, 35 years old, 180cm height, long blonde hair, brown eyes, custom facial mark';
const short = stable.replace('long blonde hair', 'short red hair'), tied = stable.replace('long blonde hair', 'blonde ponytail');
const gray = base => base.replace('long blonde hair', 'long light hair').replace('short red hair', 'short dark hair').replace('blonde ponytail', 'light ponytail').replace('brown eyes', 'dark eyes');
let messages, chatKey, passed = 0;
function reset(style = 'soft_color') {
    chatKey = 'memory-edge-chat';
    messages = Object.fromEntries([1, 2, 3, 4].map(id => [id, { mes: 'Meeting scene ' + id, swipe_id: 0, name: 'Narrator' }]));
    RBQ.api.getMessage = id => messages[id]; sdt.getChatKey = () => chatKey;
    settings._mangaMode.style = style;
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', characterMemoryEnabled: true, characterProfiles: {} };
    sdt.updateCharacterProfile('Mina', stable, 'red coat, white shirt'); sdt.prepareNaiCharData(null);
}
function page(state, render) {
    return { format: 'nai5-comic', anchor: { text: 'Meeting scene' }, page: { base: 'comic, one panel, office' },
        panels: [{ id: 'P1', description: 'office, standing near desk', characters: [{ character_id: 'C1', name: 'Mina',
            base: '', outfit: '', positive: 'holding book', negative: '', ...(state ? { state } : {}), ...(render ? { render } : {}) }] }] };
}
function parse(id, state, render) { return sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page(state, render)] }, [], sdt.captureMangaRequestContext(null, id)); }
function views(style, base, outfit) { return style === 'monochrome' ? { ...(base ? { base: gray(base) } : {}), ...(outfit ? { outfit } : {}) } : undefined; }
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function workshopVm() {
    let handler;
    const context = vm.createContext({ RBQ, console, editName: 'Mina', activeWIdx: 0, dossierScope: 'chat', PLUGIN_NAME: 'Workshop', onSaved: null,
        getProfile: name => sdt.getCharacterProfile(name), ensureProfileBucket: () => sdt.getCharacterProfiles(), getSdtStore: () => settings._smartDrawTrigger,
        getChatKey: sdt.getChatKey, getAllGlobalProfiles: () => sdt.getCharacterProfiles(), isJunkCharacterName: () => false, getWs: () => null, wsSave() {},
        toastr: { success() {}, warning() {} }, mask: { querySelector: selector => selector === '#cw-ce-save'
            ? { addEventListener: (_event, fn) => { handler = fn; } } : null, remove() {} } });
    vm.runInContext(workshopSource.slice(workshopSource.indexOf('    function saveProfile('), workshopSource.indexOf('    function getOutfitTagsForSlot(')), context);
    return { context, editorSave() {
        const start = workshopSource.indexOf('        const isEdit = !!editName;');
        vm.runInContext(workshopSource.slice(start, workshopSource.indexOf('        let activeWIdx = 0;', start)), context);
        const saveStart = workshopSource.indexOf("            mask.querySelector('#cw-ce-save')?.addEventListener");
        vm.runInContext(workshopSource.slice(saveStart, workshopSource.indexOf('            syncChips();', saveStart)), context);
        return () => handler();
    } };
}
for (const style of ['soft_color', 'monochrome']) {
    test(style + ': earlier reparse rebases inherited clothes and temporary appearance, preserving cached images', () => {
        reset(style); parse(1, { outfit: 'blue coat, white shirt', base: short }, views(style, short, 'dark coat, white shirt'));
        const cached = parse(2), before = JSON.stringify(cached);
        parse(1, { outfit: 'green coat, white shirt', base: tied }, views(style, tied, 'mid grey coat, white shirt'));
        const ref = sdt.getMangaMemoryReferences(3)[0];
        assert.equal(ref.outfit, 'green coat, white shirt'); assert.equal(ref.state.render_base, tied);
        assert.equal(sdt.getCharacterProfile('Mina').currentOutfit, 'green coat, white shirt');
        const next = parse(3); assert.match(next.characters[0].caption, style === 'monochrome' ? /light ponytail/ : /blonde ponytail/);
        assert.doesNotMatch(next.characters[0].caption, /short (?:red|dark) hair|blue coat/);
        assert.equal(JSON.stringify(cached), before); assert.match(manga.compileMangaPage(cached.mangaPage).characters[0].caption, style === 'monochrome' ? /short dark hair/ : /short red hair/);
        assert.equal(sdt.getCharacterProfile('Mina').baseTags, stable);
    });
    test(style + ': later independent outfit changes survive, inherited appearance rebases', () => {
        reset(style); parse(1, { outfit: 'blue coat, white shirt', base: short }, views(style, short, 'dark coat, white shirt'));
        parse(2, { outfit: 'yellow jacket, white shirt' }, views(style, undefined, 'light jacket, white shirt')); parse(3);
        parse(1, { outfit: 'green coat, white shirt', base: tied }, views(style, tied, 'mid grey coat, white shirt'));
        const ref = sdt.getMangaMemoryReferences(4)[0], later = sdt.getCharacterProfile('Mina').mangaStateHistory.find(e => e.messageId === 2);
        assert.equal(ref.outfit, 'yellow jacket, white shirt'); assert.equal(ref.state.render_base, tied);
        assert.equal(later.before.outfit, 'green coat, white shirt'); assert.equal(later.after.outfit, 'yellow jacket, white shirt');
        assert.equal(later.before.render_base, tied); assert.equal(later.after.render_base, tied);
    });
    test(style + ': later independent temporary appearance survives an earlier wardrobe correction', () => {
        reset(style); parse(1, { outfit: 'blue coat, white shirt' }, views(style, stable, 'dark coat, white shirt'));
        parse(2, { base: short }, views(style, short));
        parse(1, { outfit: 'green coat, white shirt' }, views(style, undefined, 'mid grey coat, white shirt'));
        const ref = sdt.getMangaMemoryReferences(3)[0]; assert.equal(ref.outfit, 'green coat, white shirt'); assert.equal(ref.state.render_base, short);
        assert.equal(sdt.getCharacterProfile('Mina').baseTags, stable);
    });
    test(style + ': manual wardrobe override survives rebasing while inherited hair updates', () => {
        reset(style); parse(1, { outfit: 'blue coat, white shirt', base: short }, views(style, short, 'dark coat, white shirt')); parse(2);
        sdt.updateCharacterProfile('Mina', '', 'white shirt, black vest');
        parse(1, { outfit: 'green coat, white shirt', base: tied }, views(style, tied, 'mid grey coat, white shirt'));
        const ref = sdt.getMangaMemoryReferences(3)[0]; assert.equal(ref.outfit, 'white shirt, black vest'); assert.equal(ref.state.render_base, tied);
        assert.equal(sdt.getCharacterProfile('Mina').currentOutfit, 'white shirt, black vest');
    });
}
test('message editing invalidates dependent history without changing cached pages', () => {
    reset(); parse(1, { outfit: 'blue coat, white shirt', base: short }); const cached = parse(2), before = JSON.stringify(cached);
    messages[1].mes = 'The meeting has no appearance change.'; const ref = sdt.getMangaMemoryReferences(3)[0];
    assert.equal(ref.outfit, 'red coat, white shirt'); assert.equal(ref.state.render_base, undefined);
    assert.equal(sdt.getCharacterProfile('Mina').mangaStateHistory.length, 0); assert.equal(JSON.stringify(cached), before);
});
test('later explicit same-value state and direct outfit round trips stay independent of earlier corrections', () => {
    for (const roundTrip of [false, true]) {
        reset(); parse(1, { outfit: 'blue coat, white shirt', base: short });
        if (roundTrip) {
            const p = page();
            p.panels[0].characters[0].outfit = 'yellow jacket, white shirt';
            p.panels.push({ id: 'P2', description: 'office', characters: [{ ...p.panels[0].characters[0], outfit: 'blue coat, white shirt' }] });
            sdt.normalizeTaggerResult({ shouldDraw: true, segments: [p] }, [], sdt.captureMangaRequestContext(null, 2));
        } else parse(2, { outfit: 'blue coat, white shirt', base: short });
        parse(1, { outfit: 'green coat, white shirt', base: tied });
        const ref = sdt.getMangaMemoryReferences(3)[0]; assert.equal(ref.outfit, 'blue coat, white shirt');
        assert.equal(ref.state.render_base, roundTrip ? tied : short);
    }
});
test('a manual wardrobe selection already recorded between floors remains an explicit override', () => {
    reset(); parse(1, { outfit: 'blue coat, white shirt', base: short });
    sdt.updateCharacterProfile('Mina', '', 'white shirt, black vest'); parse(2);
    parse(1, { outfit: 'green coat, white shirt', base: tied });
    const ref = sdt.getMangaMemoryReferences(3)[0]; assert.equal(ref.outfit, 'white shirt, black vest'); assert.equal(ref.state.render_base, tied);
});
test('a later explicit outfit remains known after the earlier floor is reparsed with unknown opening clothes', () => {
    reset();
    const profile = sdt.getCharacterProfile('Mina'); profile.currentOutfit = ''; profile.wardrobe = [];
    parse(1, { outfit: 'blue coat, white shirt' }); parse(2, { outfit: 'blue coat, white shirt' });
    parse(1);
    const ref = sdt.getMangaMemoryReferences(3)[0];
    assert.equal(ref.outfit, 'blue coat, white shirt'); assert.equal(ref.state.outfitSet, true);
    assert.match(parse(3).characters[0].caption, /blue coat, white shirt/);
});
test('delayed edited/swiped and chat-switched responses cannot write profiles or gray cache', () => {
    for (const change of ['swipe', 'chat']) {
        reset('monochrome'); const context = sdt.captureMangaRequestContext(null, 1), before = JSON.stringify(settings._smartDrawTrigger);
        if (change === 'swipe') messages[1].swipe_id = 1; else chatKey = 'other-chat';
        assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page({ outfit: 'blue coat, white shirt', base: short }, views('monochrome', short, 'dark coat, white shirt'))] }, [], context), /正文或回复分支已改变|聊天已切换/);
        assert.equal(JSON.stringify(settings._smartDrawTrigger), before);
    }
});
for (const action of ['delete character', 'clear memory', 'workshop delete']) test('a delayed response cannot undo ' + action + ' or restore its gray cache', () => {
    reset('monochrome'); parse(1, { outfit: 'blue coat, white shirt' }, views('monochrome', stable, 'dark coat, white shirt'));
    const context = sdt.captureMangaRequestContext(null, 2);
    if (action === 'delete character') sdt.deleteCharacterProfile('Mina'); else if (action === 'clear memory') sdt.clearAllCharacterProfiles(); else workshopVm().context.deleteProfile('Mina', 'chat');
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []); assert.equal(sdt.getMangaRenderCacheRows().length, 0);
    try { sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page()] }, [], context); } catch (error) { assert.equal(error.name, 'AbortError'); }
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []); assert.equal(sdt.getMangaRenderCacheRows().length, 0);
});
test('saving only a workshop avatar retains temporal appearance and chat history', () => {
    reset(); parse(1, { outfit: 'blue coat, white shirt', base: short }); const history = JSON.stringify(sdt.getCharacterProfile('Mina').mangaStateHistory);
    const workshop = workshopVm(), save = workshop.editorSave(); vm.runInContext("draft.avatarUrl = 'updated-avatar.png';", workshop.context); save();
    assert.equal(sdt.getCharacterProfile('Mina').avatarUrl, 'updated-avatar.png'); assert.equal(JSON.stringify(sdt.getCharacterProfile('Mina').mangaStateHistory), history);
    assert.equal(sdt.getMangaMemoryReferences(2)[0].state.render_base, short); assert.equal(sdt.getCharacterProfile('Mina').baseTags, stable);
});
test('workshop deletion clears old gray views before recreating identical canonical sources', () => {
    reset('monochrome'); parse(1, { outfit: 'blue coat, white shirt' }, views('monochrome', stable, 'dark coat, white shirt'));
    assert.equal(workshopVm().context.deleteProfile('Mina', 'chat'), true); assert.equal(sdt.getMangaRenderCacheRows().length, 0);
    sdt.updateCharacterProfile('Mina', stable, 'blue coat, white shirt');
    const next = parse(2, undefined, { base: gray(stable).replace('long light hair', 'long dark hair'), outfit: 'light coat, white shirt' });
    assert.match(next.characters[0].caption, /long dark hair/); assert.match(next.characters[0].caption, /light coat, white shirt/);
    assert.doesNotMatch(next.characters[0].caption, /long light hair|dark coat/);
});
test('workshop global edits retain independent history per chat and global deletion clears each gray cache', () => {
    reset('monochrome'); parse(1, { outfit: 'blue coat, white shirt', base: short }, views('monochrome', short, 'dark coat, white shirt'));
    const chatA = chatKey, contextA = sdt.captureMangaRequestContext(null, 2), historyA = JSON.stringify(sdt.getCharacterProfile('Mina').mangaStateHistory);
    chatKey = 'other-chat'; sdt.updateCharacterProfile('Mina', stable, 'red coat, white shirt');
    parse(1, { outfit: 'yellow jacket, white shirt', base: tied }, views('monochrome', tied, 'light jacket, white shirt'));
    const contextB = sdt.captureMangaRequestContext(null, 2), historyB = JSON.stringify(sdt.getCharacterProfile('Mina').mangaStateHistory);
    chatKey = chatA; const workshop = workshopVm();
    workshop.context.saveProfile('Mina', { displayName: 'Mina', avatarUrl: 'new-avatar.png' }, 'all');
    assert.equal(JSON.stringify(sdt.getCharacterProfile('Mina').mangaStateHistory), historyA);
    chatKey = 'other-chat'; assert.equal(JSON.stringify(sdt.getCharacterProfile('Mina').mangaStateHistory), historyB);
    assert.equal(sdt.getCharacterProfile('Mina').avatarUrl, 'new-avatar.png'); chatKey = chatA;
    assert.equal(workshop.context.deleteProfile('Mina', 'all'), true); assert.equal(sdt.getMangaRenderCacheRows().length, 0);
    assert.throws(() => sdt.assertMangaRequestContext(contextA), /删除或清空/);
    chatKey = 'other-chat'; assert.equal(sdt.getMangaRenderCacheRows().length, 0);
    assert.throws(() => sdt.assertMangaRequestContext(contextB), /删除或清空/);
});
console.log(`\n${passed} manga memory edge tests passed.`);
