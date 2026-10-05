/** Old SDT instances cannot publish delayed replies after cleanup. No live calls. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { sdt, settings, sdtSource } = new Function('require', '__dirname', harness + '\nreturn {sdt,settings,sdtSource};')(require, __dirname);
let passed = 0;
function reset(style = 'soft_color') {
    sdt.onSdtNaiPayload.disposed = false;
    settings._mangaMode.style = style;
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', characterMemoryEnabled: true,
        characterProfiles: {}, provider: 'custom', customUrl: 'https://fixture.invalid/tagger' };
}
function response() {
    return { shouldDraw: true, segments: [{ format: 'nai5-comic', anchor: { text: '林遥拿起信封。' },
        page: { base: 'comic, one panel' }, panels: [{ id: 'P1', description: 'full page, room', bubbles: [],
            characters: [{ character_id: 'C1', name: 'Lin Yao (original)', base: 'girl, black hair', outfit: 'white shirt',
                render: { base: 'girl, dark hair', outfit: 'white shirt' }, positive: 'standing, holding envelope',
                bubbles: [], negative: '' }] }] }] };
}
const aborted = error => error?.name === 'AbortError' && /卸载或重新加载/.test(error.message);
function test(name, run) { reset(); run(); passed++; console.log('PASS ' + name); }
test('live parser still learns complete memory normally', () => {
    const result = sdt.normalizeTaggerResult(response(), [], sdt.captureMangaRequestContext(null, 1));
    assert.equal(result.shouldDraw, true);
    assert.match(sdt.getCharacterProfile('Lin Yao').baseTags, /black hair/);
});
test('a reply captured before disposal cannot create a profile or wardrobe', () => {
    const context = sdt.captureMangaRequestContext(null, 1);
    const before = JSON.stringify(settings._smartDrawTrigger);
    sdt.onSdtNaiPayload.disposed = true;
    assert.throws(() => sdt.normalizeTaggerResult(response(), [], context), aborted);
    assert.equal(JSON.stringify(settings._smartDrawTrigger), before);
});
test('a disposed instance cannot learn or save grayscale data directly', () => {
    reset('monochrome');
    const context = sdt.captureMangaRequestContext(null, 1);
    const parsed = sdt.normalizeTaggerResult(response(), [], context);
    const before = JSON.stringify(settings._smartDrawTrigger);
    sdt.onSdtNaiPayload.disposed = true;
    assert.throws(() => sdt.learnMangaCharacterMemory(response(), parsed.segments, context), aborted);
    assert.throws(() => sdt.saveMangaRenderCache(parsed.segments.map(s => s.mangaPage), context), aborted);
    assert.equal(JSON.stringify(settings._smartDrawTrigger), before);
});
test('a stale callback without a request snapshot aborts before ordinary memory merging', () => {
    settings._smartDrawTrigger._mangaActive = false;
    settings._smartDrawTrigger.enhancedContext = 'off';
    sdt.onSdtNaiPayload.disposed = true;
    assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [] }), aborted);
});
(async () => {
    reset();
    Object.assign(sdt, { checkUrlSafety() {}, logTaggerPayload() {}, validateStructuredResult: value => value,
        safeReadJsonResponse: response => response.json(),
        smartFetch: async () => {
            sdt.onSdtNaiPayload.disposed = true;
            return { ok: true, json: async () => response() };
        } });
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('), sdtSource.indexOf('    async function callStructuredCompletion(')), sdt);
    await assert.rejects(sdt.callCustomHttp(1, { type: 'auto' }), aborted);
    // Request capture can initialize an empty chat bucket; no character/cache may be published.
    assert.equal(Object.keys(sdt.getCharacterProfiles()).length, 0);
    assert.equal(settings._smartDrawTrigger.mangaRenderCache, undefined);
    passed++; console.log('PASS delayed custom HTTP reply aborts after disposal before normalizing or learning');
    sdt.onSdtNaiPayload.disposed = false;
    console.log(`${passed} disposal request audit tests passed; no model/image calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
