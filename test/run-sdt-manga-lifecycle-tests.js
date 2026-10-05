/** Production SDT cleanup/hooks/queue regressions. No network or image services. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
let passed = 0, failed = 0;
async function test(name, run) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function setup() {
    const h = new Function('require', '__dirname', harness + '\nreturn { sdt, RBQ, payload, sdtHook, mangaHook, settings, sdtSource };')(require, __dirname);
    const { sdt, RBQ, sdtSource } = h;
    const hooks = new Map([['buildNaiV4Payload', [h.mangaHook, h.sdtHook]]]);
    RBQ.on = (event, fn) => hooks.set(event, [...(hooks.get(event) || []), fn]);
    RBQ.off = (event, fn) => hooks.set(event, (hooks.get(event) || []).filter(callback => callback !== fn));
    const windowListeners = new Map(), removedActions = [], clearedTimeouts = [], clearedIntervals = [];
    Object.assign(sdt, {
        PLUGIN_NAME: 'fixture', window: {
            addEventListener(event, fn) { windowListeners.set(event, fn); },
            removeEventListener(event, fn) { if (windowListeners.get(event) === fn) windowListeners.delete(event); }
        }, document: { querySelectorAll: () => [], querySelector: () => null },
        clearTimeout: id => clearedTimeouts.push(id), clearInterval: id => clearedIntervals.push(id),
        removeFloatingManualButton() {}, removeFloatingComicDrawerButton() {}, closeStoryboardDrawer() {}, openStoryboardDrawer() {}
    });
    RBQ.ui = { removeSettingPanel() {}, unregisterTestAction: key => removedActions.push(key) };
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    /* ── ComfyUI payload hook'), sdtSource.indexOf('    function materializeResultCards(')), sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function onSdtViewerRendered('), sdtSource.indexOf('    function getFinalPrompt(')), sdt);
    vm.runInContext('let streamingWatcherTimer=31,settingsPanelPollTimer=32,bodyObserver=null,floatingObserver=null,handleMessageRender=null,handleChatChanged=null,autoRunTimer=41,autoRunPendingId=0; const pendingTimers=new Map([[0,42],[1,43]]);', sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function cleanupInstance('), sdtSource.indexOf('\n    waitForPanel();', sdtSource.indexOf('    function cleanupInstance('))), sdt);
    sdt.window.__rbqSdtCleanup = sdt.cleanupInstance;
    sdt.window.openStoryboardDrawer = sdt.openStoryboardDrawer;
    return { ...h, hooks, windowListeners, removedActions, clearedTimeouts, clearedIntervals };
}
(async () => {
    await test('SDT cleanup detaches own image hooks/viewer listeners and clears pending timers', async () => {
        const h = setup(); h.sdt.cleanupInstance();
        assert.deepEqual(h.hooks.get('buildNaiV4Payload'), [h.mangaHook]);
        assert.equal(h.hooks.get('buildComfyUiWorkflow').length, 0); assert.equal(h.windowListeners.size, 0);
        assert.deepEqual(h.clearedTimeouts.sort(), [41,42,43]); assert.deepEqual(h.clearedIntervals, [31,32]);
        assert.ok(h.removedActions.includes('sdt-smart-test'));
        assert.equal(h.sdt.window.__rbqSdtCleanup, undefined); assert.equal(h.sdt.window.openStoryboardDrawer, undefined);
    });
    await test('retained SDT hook callbacks cannot alter payloads after cleanup', async () => {
        const h = setup(), nai = h.sdtHook, comfy = h.hooks.get('buildComfyUiWorkflow')[0];
        h.sdt.cleanupInstance();
        const input = h.payload(), before = JSON.stringify(input);
        nai(input, { meta: { sdtCharacterData: { enabled: true, characters: [{ caption:'Ada (original), holding envelope' }] } } });
        assert.equal(JSON.stringify(input), before);
        const workflow = { text: '{{char1}}' }; comfy(workflow, { meta: { sdtCharacterData: { enabled: true, characters:[{caption:'changed'}] } } });
        assert.deepEqual(workflow, { text: '{{char1}}' });
    });
    await test('owned API cleanup restores host exports and preserves later plugin replacements', async () => {
        const h = setup(), own = () => {}, prior = () => {}, later = () => {};
        h.RBQ.api.fixtureOwned = own; h.RBQ.api.fixtureRestored = own; h.RBQ.api.fixtureReplaced = later;
        h.sdt.cleanupInstance.apiExports = [
            { key:'fixtureOwned',value:own,existed:false },
            { key:'fixtureRestored',value:own,existed:true,previous:prior },
            { key:'fixtureReplaced',value:own,existed:false }
        ];
        h.sdt.cleanupInstance(); assert.equal(h.RBQ.api.fixtureOwned, undefined);
        assert.equal(h.RBQ.api.fixtureRestored, prior); assert.equal(h.RBQ.api.fixtureReplaced, later);
        h.sdt.cleanupInstance(); assert.deepEqual(h.clearedIntervals, [31,32]);
    });
    await test('new image calls reject after unload without contacting the host', async () => {
        const h = setup(); let calls=0; h.RBQ.api.generateImage = async () => { calls++; };
        h.sdt.cleanupInstance();
        await assert.rejects(h.sdt.generateSdtImage({characters:[]},'office','fixture'), /已卸载/);
        assert.equal(calls,0);
    });
    await test('a legacy image queued before unload cannot start afterward', async () => {
        const h = setup(); h.RBQ.api.generationContextVersion = 0; let finish, calls=0;
        h.RBQ.api.generateImage = () => { calls++; return new Promise(resolve => { finish=resolve; }); };
        const first = h.sdt.generateSdtImage({characters:[]},'first office','fixture');
        await Promise.resolve(); assert.equal(calls,1);
        const second = h.sdt.generateSdtImage({characters:[]},'second office','fixture');
        h.sdt.cleanupInstance(); finish({url:'fixture.png'}); await first;
        await assert.rejects(second,/已卸载/); assert.equal(calls,1);
    });
    console.log(`\n${passed} SDT lifecycle tests passed; ${failed} failed.`); if(failed) process.exitCode=1;
})();
