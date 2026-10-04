/** Planning-selector regressions execute production UI, sync and payload hooks.
 * The DOM and persistence boundaries are stubs; no model or image requests. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, mangaSource, sdtSource, fixture, payload, mangaHook, sdtHook } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,mangaSource,sdtSource,fixture,payload,mangaHook,sdtHook};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const initialSettings = clone(settings);
const originalSave = sdt.save;
const comicOptions = ['v_manga', 'v_manga_185'];
const ordinaryOptions = ['off', 'v13', 'v14', 'v11'];
let passed = 0, modelCalls = 0;
const noModelCall = () => { modelCalls++; throw new Error('planning selector must not call a model or image API'); };
Object.assign(sdt, { smartFetch: noModelCall, callApiWithJsonFallback: noModelCall });
manga.fetch = noModelCall;
RBQ.api.generateImage = noModelCall;

vm.runInContext(mangaSource.slice(mangaSource.indexOf('    function updateUiState('),
    mangaSource.indexOf('    function injectUiIntoSdt(')), manga);
const changeStart = sdtSource.indexOf("        document.getElementById('rbq-sdt-enhanced-context').addEventListener('change'");
const changeEnd = sdtSource.indexOf("        document.getElementById('rbq-sdt-refresh-models')", changeStart);
assert.ok(changeStart >= 0 && changeEnd > changeStart, 'execute the production context-selector change listener');

function reset() {
    for (const key of Object.keys(settings)) delete settings[key];
    Object.assign(settings, clone(initialSettings));
    sdt.save = originalSave;
    sdt.prepareNaiCharData(null);
}
function test(name, run) {
    reset(); run(); passed++;
    assert.equal(modelCalls, 0);
    console.log('PASS ' + name);
}

function selector(initialValue = 'v13') {
    let change, saves = 0;
    const markup = sdtSource.match(/<select id="rbq-sdt-enhanced-context">([\s\S]*?)<\/select>/);
    assert.ok(markup, 'reuse the existing SDT context selector');
    const options = [...markup[1].matchAll(/<option value="([^"]+)"/g)]
        .map(([, value]) => ({ value, dataset: {}, hidden: false, disabled: false }));
    for (const value of [...ordinaryOptions, ...comicOptions]) assert.ok(options.some(option => option.value === value));
    const field = { classList: { remove() {} }, querySelector: () => null };
    const select = {
        value: initialValue, disabled: false, options,
        closest: () => field,
        querySelector: query => options.find(option => query === `option[value="${option.value}"]`) || null,
        appendChild: option => options.push(option),
        addEventListener: (event, listener) => { assert.equal(event, 'change'); change = listener; }
    };
    const document = {
        getElementById: id => id === 'rbq-sdt-enhanced-context' ? select : null,
        createElement: () => ({ value: '', dataset: {}, hidden: false, disabled: false })
    };
    manga.document = document;
    sdt.document = document;
    sdt.save = () => { saves++; };
    vm.runInContext(sdtSource.slice(changeStart, changeEnd), sdt);
    return {
        select, options, saveCount: () => saves,
        changeTo(value) { select.value = value; change({ target: select }); }
    };
}
function assertAvailable(ui, enabled) {
    assert.equal(ui.select.disabled, false, 'the context selector stays interactive');
    for (const option of ui.options) {
        const comic = comicOptions.includes(option.value);
        assert.equal(option.hidden, enabled ? !comic : comic, option.value + ' visibility');
        assert.equal(option.disabled, enabled ? !comic : comic, option.value + ' availability');
    }
}

for (const priorContext of ['v14', 'off', undefined]) {
    test(`existing context selector preserves B through refresh and sync, then restores ${priorContext ?? 'an absent context'}`, () => {
        const ordinary = { systemPromptPreset: 'custom', customSystemPrompt: 'ordinary prompt',
            systemPrompt: 'ordinary prompt', multiCharOutput: false };
        if (priorContext !== undefined) ordinary.enhancedContext = priorContext;
        settings._smartDrawTrigger = clone(ordinary);
        settings._mangaMode.enabled = false;
        const ui = selector(priorContext || 'v13');
        manga.updateUiState();
        assertAvailable(ui, false);

        settings._mangaMode.enabled = true;
        manga.syncMangaToSdt(settings._mangaMode, false);
        manga.updateUiState();
        assert.equal(ui.select.value, 'v_manga');
        assertAvailable(ui, true);
        assert.equal(RBQ.api.mangaProtocol.planningPrompt().length, 619);

        ui.changeTo('v_manga_185');
        assert.equal(settings._smartDrawTrigger.enhancedContext, 'v_manga_185');
        assert.equal(ui.saveCount(), 1, 'B is persisted by the change event before any Save button');
        assert.equal(RBQ.api.mangaProtocol.planningPrompt().length, 717);
        manga.updateUiState();
        manga.syncMangaToSdt(settings._mangaMode, false);
        manga.syncMangaToSdt(settings._mangaMode, false);
        manga.updateUiState();
        assert.equal(ui.select.value, 'v_manga_185');
        assert.equal(settings._smartDrawTrigger.enhancedContext, 'v_manga_185');
        assert.equal(ui.saveCount(), 1, 'refresh and repeated sync do not save or trigger another request');

        settings._mangaMode.enabled = false;
        manga.syncMangaToSdt(settings._mangaMode, false);
        manga.updateUiState();
        const restored = clone(settings._smartDrawTrigger);
        delete restored._mangaActive;
        assert.deepEqual(restored, ordinary, 'ordinary values and absent properties restore exactly');
        assertAvailable(ui, false);
        assert.equal(ui.select.value, priorContext || 'v13');
        for (const option of ui.options.filter(option => ordinaryOptions.includes(option.value))) {
            assert.equal(Object.hasOwn(option.dataset, 'rbqMangaHidden'), false);
            assert.equal(Object.hasOwn(option.dataset, 'rbqMangaDisabled'), false);
        }
    });
}

test('context UI restores pre-existing option flags and keeps both comic choices hidden while disabled', () => {
    settings._smartDrawTrigger = { enhancedContext: 'v14' };
    settings._mangaMode.enabled = false;
    const ui = selector('v14');
    const originallyRestricted = ui.options.find(option => option.value === 'v11');
    originallyRestricted.hidden = true;
    originallyRestricted.disabled = true;
    settings._mangaMode.enabled = true;
    manga.syncMangaToSdt(settings._mangaMode, false);
    manga.updateUiState();
    ui.changeTo('v_manga_185');
    ui.changeTo('v_manga');
    assert.equal(ui.saveCount(), 2, 'both directions persist immediately');
    manga.updateUiState();
    assert.equal(ui.select.value, 'v_manga');
    settings._mangaMode.enabled = false;
    manga.syncMangaToSdt(settings._mangaMode, false);
    manga.updateUiState();
    assert.equal(originallyRestricted.hidden, true);
    assert.equal(originallyRestricted.disabled, true);
    for (const option of ui.options.filter(option => comicOptions.includes(option.value))) {
        assert.equal(option.hidden, true);
        assert.equal(option.disabled, true);
    }
});

test('B reads selected host dimensions and safe NAI or other-mode fallbacks without changing settings', () => {
    settings._smartDrawTrigger.enhancedContext = 'v_manga_185';
    for (const sample of [
        { mode: 'nai', width: 1024, height: 1536, expected: { width: 1024, height: 1536, orientation: 'portrait' } },
        { mode: 'nai', width: '1216', height: '832', expected: { width: 1216, height: 832, orientation: 'landscape' } },
        { mode: 'nai', width: NaN, height: -5, expected: { width: 832, height: 1216, orientation: 'portrait' } },
        { mode: 'comfyui', width: 768, height: 768, expected: { width: 768, height: 768, orientation: 'square' } },
        { mode: 'comfyui', width: 0, height: '', expected: { width: 1024, height: 1024, orientation: 'square' } }
    ]) {
        settings.currentMode = sample.mode;
        settings[sample.mode + 'Width'] = sample.width;
        settings[sample.mode + 'Height'] = sample.height;
        const before = { ...settings };
        assert.deepEqual(clone(RBQ.api.mangaProtocol.planningContext()), { ...sample.expected, autoSpread: true });
        assert.deepEqual(settings, before, 'canvas context only reads host settings');
    }
    assert.equal(RBQ.api.mangaProtocol.planningContext(undefined, 'v_manga'), null);
});

test('B workbench dimensions prefer its ratio and reuse host or fallback dimensions only when needed', () => {
    settings.currentMode = 'nai';
    settings.naiWidth = 1024;
    settings.naiHeight = 1536;
    settings._smartDrawTrigger.enhancedContext = 'v_manga_185';
    settings._mangaMode.autoSpread = false;
    const before = clone(settings);
    for (const [ratio, expected] of [
        ['1216x832', { width: 1216, height: 832, orientation: 'landscape' }],
        ['768x768', { width: 768, height: 768, orientation: 'square' }],
        ['0x832', { width: 1024, height: 832, orientation: 'landscape' }],
        ['invalid', { width: 1024, height: 1536, orientation: 'portrait' }]
    ]) {
        assert.deepEqual(clone(RBQ.api.mangaProtocol.planningContext(ratio)), { ...expected, autoSpread: false });
        assert.deepEqual(clone(settings), before);
    }
    settings.naiWidth = undefined;
    settings.naiHeight = undefined;
    assert.deepEqual(clone(RBQ.api.mangaProtocol.planningContext('invalid')),
        { width: 832, height: 1216, orientation: 'portrait', autoSpread: false });
});

test('A and B send identical NAI data for the same cached page without changing memory, gray cache or image parameters', () => {
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', characterMemoryEnabled: true,
        characterProfiles: {}, multiCharOutput: true, multiCharUseCoords: false };
    const page = fixture();
    for (const panel of page.panels) for (const person of panel.characters) {
        const first = person.character_id === 'C1';
        person.base = first ? 'girl, long blonde hair, green eyes' : 'girl, short brown hair, blue eyes';
        person.outfit = first ? 'beige trench coat' : 'blue shirt';
        person.render = { base: first ? 'girl, long light grey hair, grey eyes' : 'girl, short dark hair, grey eyes',
            outfit: first ? 'light grey trench coat' : 'grey shirt' };
    }
    const normalized = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page] }, [],
        sdt.captureMangaRequestContext(null, 1));
    const segment = normalized.segments[0];
    assert.equal(sdt.getMangaRenderCacheRows().length, 4, 'use a populated production grayscale cache');
    const profilesBefore = JSON.stringify(sdt.getCharacterProfiles());
    const cacheBefore = JSON.stringify(settings._smartDrawTrigger.mangaRenderCache);
    const segmentBefore = JSON.stringify(segment);
    const renderSettingsBefore = clone(RBQ.api.mangaProtocol.captureRenderSettings());
    for (const order of [[sdtHook, mangaHook], [mangaHook, sdtHook]]) {
        const results = [];
        for (const ec of comicOptions) {
            settings._smartDrawTrigger.enhancedContext = ec;
            sdt.prepareNaiCharData(segment);
            let request = payload(segment.prompt);
            Object.assign(request.parameters, { seed: 123456, steps: 23, scale: 4, sampler: 'k_dpmpp_2m_sde' });
            for (const hook of order) request = hook(request);
            results.push(clone(request));
            assert.deepEqual(clone(RBQ.api.mangaProtocol.captureRenderSettings()), renderSettingsBefore);
            assert.doesNotMatch(JSON.stringify(request), /mangaCanvas|planningVersion|v_manga_185|漫画前情与本楼规划/);
        }
        assert.deepEqual(results[0], results[1], 'planner choice never rewrites an already compiled page or NAI parameters');
        assert.equal(results[1].parameters.width, 832);
        assert.equal(results[1].parameters.height, 1216);
        assert.equal(results[1].parameters.seed, 123456);
        assert.equal(results[1].parameters.steps, 23);
        assert.equal(results[1].parameters.scale, 4);
        assert.equal(results[1].parameters.sampler, 'k_dpmpp_2m_sde');
    }
    assert.equal(JSON.stringify(segment), segmentBefore);
    assert.equal(JSON.stringify(sdt.getCharacterProfiles()), profilesBefore);
    assert.equal(JSON.stringify(settings._smartDrawTrigger.mangaRenderCache), cacheBefore);
    sdt.prepareNaiCharData(null);
});

console.log(`PASS ${passed} planning-selector regression tests; ${modelCalls} model/image calls`);
