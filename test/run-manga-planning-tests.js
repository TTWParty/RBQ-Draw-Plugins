/** Planning-selector regressions execute production UI, sync and payload hooks.
 * The DOM and persistence boundaries are stubs; no model or image requests. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, mangaSource, sdtSource, fixture, payload, mangaHook, sdtHook } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,mangaSource,sdtSource,fixture,payload,mangaHook,sdtHook};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const initialSettings = clone(settings);
const originalSave = sdt.save;
const comicOptions = ['v_manga', 'v_manga_185', 'v_manga_161', 'v_manga_150'];
// SHA-256 of the evaluated historical production strings, including whitespace.
const historicalPrompts = {
    v_manga: { ref: '2c3ffd0', length: 619, hash: '3d676af809e60b659e7c633ca75b069648f5cee5e8d6c61dee0d0d40e9bfbc1a' },
    v_manga_185: { ref: 'd15c665', length: 717, hash: '05a427db20bdfdc78845b54a86b562e5d0e8419030d287884e673915464922dc' },
    v_manga_161: { ref: '22a4685', length: 491, hash: '02ec9fc92e816204fb728aef9ea1fe422874a089f7aa5a741ab7d99d097bca4e' },
    v_manga_150: { ref: '92972b1', length: 109, hash: '8e2609aa177f144b0a4bdfbad3b7b5d9ff2ea2f74ef75410c6cc10271ec09726' }
};
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

test('all four planning variants retain the exact historical text and only 717 characters receives canvas', () => {
    for (const ec of comicOptions) {
        settings._smartDrawTrigger.enhancedContext = ec;
        const prompt = RBQ.api.mangaProtocol.planningPrompt();
        const historical = historicalPrompts[ec];
        assert.equal(prompt.length, historical.length);
        assert.equal(createHash('sha256').update(prompt).digest('hex'), historical.hash,
            `${ec} must match the evaluated source at ${historical.ref}`);
        assert.equal(RBQ.api.mangaProtocol.planningPrompt(ec), prompt);
        assert.equal(!!RBQ.api.mangaProtocol.planningContext(), ec === 'v_manga_185');
        assert.doesNotMatch(prompt, /story_plan|beat_ids/);
    }
    assert.equal(RBQ.api.mangaProtocol.planningPrompt('unknown').length, 619, 'unknown choices retain the existing default');
});

test('SDT selector initialization accepts each saved planning variant', () => {
    const initStart = sdtSource.indexOf("        const legacyEcList = ");
    const initEnd = sdtSource.indexOf("        document.getElementById('rbq-sdt-debug')", initStart);
    assert.ok(initStart >= 0 && initEnd > initStart);
    const initialize = '(() => { const store = getStore();\n' + sdtSource.slice(initStart, initEnd) + '\n})()';
    for (const ec of comicOptions) {
        settings._smartDrawTrigger.enhancedContext = ec;
        const ui = selector();
        vm.runInContext(initialize, sdt);
        assert.equal(ui.select.value, ec, 'saved historical planners survive SDT initialization');
        assert.equal(ui.saveCount(), 0, 'opening settings never makes an API request or rewrites the saved choice');
    }
});

for (const priorContext of ['v14', 'off', undefined]) {
    test(`existing context selector preserves all four planners through refresh and sync, then restores ${priorContext ?? 'an absent context'}`, () => {
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

        let expectedSaves = 0;
        for (const ec of ['v_manga_185', 'v_manga_161', 'v_manga_150', 'v_manga']) {
            ui.changeTo(ec);
            expectedSaves++;
            assert.equal(settings._smartDrawTrigger.enhancedContext, ec);
            assert.equal(ui.saveCount(), expectedSaves, 'each choice persists immediately before any Save button');
            assert.equal(RBQ.api.mangaProtocol.planningPrompt().length, historicalPrompts[ec].length);
            manga.updateUiState();
            manga.syncMangaToSdt(settings._mangaMode, false);
            manga.syncMangaToSdt(settings._mangaMode, false);
            manga.updateUiState();
            assert.equal(ui.select.value, ec);
            assert.equal(settings._smartDrawTrigger.enhancedContext, ec);
            assert.equal(ui.saveCount(), expectedSaves, 'refresh and repeated sync do not save or trigger another request');
        }

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

test('context UI restores pre-existing option flags and keeps all four comic choices hidden while disabled', () => {
    settings._smartDrawTrigger = { enhancedContext: 'v14' };
    settings._mangaMode.enabled = false;
    const ui = selector('v14');
    const originallyRestricted = ui.options.find(option => option.value === 'v11');
    originallyRestricted.hidden = true;
    originallyRestricted.disabled = true;
    settings._mangaMode.enabled = true;
    manga.syncMangaToSdt(settings._mangaMode, false);
    manga.updateUiState();
    for (const ec of ['v_manga_185', 'v_manga_161', 'v_manga_150', 'v_manga']) ui.changeTo(ec);
    assert.equal(ui.saveCount(), 4, 'all four choices persist immediately');
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
    for (const ec of comicOptions.filter(ec => ec !== 'v_manga_185')) {
        assert.equal(RBQ.api.mangaProtocol.planningContext(undefined, ec), null);
    }
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

test('all four planners send identical NAI data for the same cached page without changing memory, gray cache or image parameters', () => {
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
            assert.doesNotMatch(JSON.stringify(request), /mangaCanvas|planningVersion|v_manga(?:_185|_161|_150)?|漫画前情与本楼规划|漫画分页依据正文事件/);
        }
        for (const result of results.slice(1)) {
            assert.deepEqual(results[0], result, 'planner choice never rewrites an already compiled page or NAI parameters');
        }
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
