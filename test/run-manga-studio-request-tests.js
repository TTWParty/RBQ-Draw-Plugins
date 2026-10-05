/** Request cancellation, deadlines and real Studio button handlers. Safe fixtures; no network. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
const clone = value => JSON.parse(JSON.stringify(value));
const response = { panels: [{ id: 'P1', title: '收到信', description: 'classroom', bubbles: [], characters: [] }] };
function host(mode = 'structured') {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,settings,RBQ,mangaSource};')(require, __dirname);
    const { manga, settings, RBQ, mangaSource } = env;
    const store = settings._mangaMode, studio = store.studio;
    Object.assign(store, { style: 'soft_color', dialogueMode: mode, grammar: 'cinema', language: 'zh-hans' });
    Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', toolCallMode: true });
    Object.assign(studio, { storyText: '她把信封递给同事。', panels: [{ title: '旧分镜', desc: '递出信封。', characters: [] }], _lastDebug: { previous: true } });
    const timers = new Map(); let timerId = 0, requests = 0, request, complete;
    manga.setTimeout = (run, delay) => { timers.set(++timerId, { run, delay }); return timerId; };
    manga.clearTimeout = id => timers.delete(id);
    RBQ.api.callStructuredCompletion = args => {
        request = args; requests++;
        return new Promise(resolve => { complete = () => resolve({ rawReply: JSON.stringify(response) }); });
    };
    const notices = [], diagnostics = [], buttons = new Map();
    const button = key => {
        if (!buttons.has(key)) buttons.set(key, { disabled: false, innerHTML: key, listeners: {},
            addEventListener(type, run) { this.listeners[type] = run; } });
        return buttons.get(key);
    };
    Object.assign(manga, { store, studio, p: studio.panels[0], idx: 0,
        storyInputEl: { value: studio.storyText }, container: { querySelector: button }, card: { querySelector: button },
        clearStudioDebugBox() {}, renderStudioDebugBox(_container, data) { diagnostics.push(data); },
        renderPanelCards() {}, updatePromptPreview() {}, save() {},
        toastr: Object.fromEntries(['warning', 'error', 'success', 'info'].map(type => [type, text => notices.push({ type, text })])) });
    const singleSource = mangaSource.slice(mangaSource.indexOf("                const btnSingleAi = card.querySelector('.mw-panel-ai-single');"),
        mangaSource.indexOf("                card.querySelector('.mw-panel-shot-sel')?.addEventListener"));
    const storyboardSource = mangaSource.slice(mangaSource.indexOf("        const btnAi = container.querySelector('#mw-btn-ai-storyboard');"),
        mangaSource.indexOf('        // Add panel button'));
    vm.runInContext('{' + singleSource + '}', manga);
    vm.runInContext('{' + storyboardSource + '}', manga);
    return { ...env, store, studio, timers, notices, diagnostics, buttons, request: () => request, requests: () => requests,
        complete: () => complete(), tick: () => { for (const timer of [...timers.values()]) timer.run(); },
        rebind(selector) {
            buttons.delete(selector);
            vm.runInContext('{' + (selector === '.mw-panel-ai-single' ? singleSource : storyboardSource) + '}', manga);
            return buttons.get(selector);
        } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
    for (const mode of ['structured', 'legacy']) {
        await test(`normal ${mode} request passes a signal, clears deadline, and retains its output`, async () => {
            const h = host(mode), pending = h.manga.requestStudioPanels(h.store, 'one panel', '放学后的教室。', 1);
            assert.ok(h.request().signal instanceof AbortSignal);
            assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 180000);
            h.complete(); const result = await pending;
            assert.equal(result[0].title, '收到信'); assert.equal(h.timers.size, 0);
            assert.equal(h.request().signal.aborted, false);
        });
        await test(`cancelled ${mode} request settles even if the completion helper ignores the signal`, async () => {
            const h = host(mode), before = JSON.stringify(h.studio), controller = new AbortController();
            const pending = h.manga.requestStudioPanels(h.store, 'one panel', '放学后的教室。', 1, false, controller.signal);
            controller.abort(h.manga.studioAbortError());
            await assert.rejects(pending, error => error.name === 'AbortError');
            assert.equal(h.timers.size, 0); assert.equal(h.request().signal.aborted, true);
            h.complete(); await flush();
            assert.equal(JSON.stringify(h.studio), before, 'late success must not publish cache or diagnostics');
        });
        await test(`stalled ${mode} request times out and late success cannot alter the draft`, async () => {
            const h = host(mode), before = JSON.stringify(h.studio);
            const pending = h.manga.requestStudioPanels(h.store, 'one panel', '放学后的教室。', 1);
            h.tick();
            await assert.rejects(pending, error => error.name === 'TimeoutError' && /180 秒/.test(error.message));
            assert.equal(h.timers.size, 0); assert.equal(h.request().signal.aborted, true);
            h.complete(); await flush(); assert.equal(JSON.stringify(h.studio), before);
        });
    }
    await test('an already cancelled request never contacts the provider', async () => {
        const h = host(), controller = new AbortController(); controller.abort(h.manga.studioAbortError());
        await assert.rejects(h.manga.requestStudioPanels(h.store, 'one panel', '教室。', 1, false, controller.signal), error => error.name === 'AbortError');
        assert.equal(h.requests(), 0); assert.equal(h.timers.size, 0);
    });
    await test('fallback fetch receives the same signal and cannot publish a late body', async () => {
        const h = host(), controller = new AbortController(), before = JSON.stringify(h.studio);
        delete h.RBQ.api.callStructuredCompletion;
        let fetchOptions, finishFetch;
        h.manga.fetch = async (_url, options) => {
            fetchOptions = options;
            return new Promise(resolve => { finishFetch = () => resolve({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }); });
        };
        const pending = h.manga.requestStudioPanels(h.store, 'one panel', '教室。', 1, false, controller.signal);
        controller.abort(h.manga.studioAbortError());
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(fetchOptions.signal.aborted, true);
        finishFetch(); await flush(); assert.equal(JSON.stringify(h.studio), before);
    });
    await test('abort during compatibility-error reading prevents a second fallback request', async () => {
        const h = host(), controller = new AbortController(); delete h.RBQ.api.callStructuredCompletion;
        let calls = 0, finishError;
        h.manga.fetch = async () => { calls++; return { ok: false, status: 400,
            clone: () => ({ text: () => new Promise(resolve => { finishError = () => resolve('unsupported response_format'); }) }) }; };
        const pending = h.manga.requestStudioPanels(h.store, 'one panel', '教室。', 1, false, controller.signal);
        await flush(); controller.abort(h.manga.studioAbortError());
        await assert.rejects(pending, error => error.name === 'AbortError');
        finishError(); await flush(); assert.equal(calls, 1);
    });
    for (const selector of ['.mw-panel-ai-single', '#mw-btn-ai-storyboard', '#mw-btn-ai-batch']) {
        await test(`${selector} supports click-to-stop and restores the button without overwriting panels`, async () => {
            const h = host(), before = clone(h.studio.panels), btn = h.buttons.get(selector), originalHtml = btn.innerHTML;
            const pending = btn.listeners.click();
            assert.equal(btn.disabled, false); assert.match(btn.innerHTML, /点击停止/);
            await btn.listeners.click(); await pending;
            assert.equal(h.requests(), 1); assert.equal(btn.disabled, false); assert.equal(btn.innerHTML, originalHtml);
            assert.equal(btn._mangaParserAbort, undefined);
            assert.equal(h.notices.at(-1).type, 'info'); assert.equal(h.diagnostics.length, 0);
            h.complete(); await flush(); assert.deepEqual(clone(h.studio.panels), before);
        });
        await test(`${selector} still stops the original request after its DOM button is replaced`, async () => {
            const h = host(), before = clone(h.studio.panels), oldButton = h.buttons.get(selector);
            const pending = oldButton.listeners.click(), originalSignal = h.request().signal;
            const replacement = h.rebind(selector);
            assert.notEqual(replacement, oldButton); assert.match(replacement.innerHTML, /点击停止/);
            await replacement.listeners.click(); await pending;
            assert.equal(h.requests(), 1, 'replacement click must cancel, not submit another request');
            assert.equal(originalSignal.aborted, true);
            assert.equal(replacement._mangaParserAbort, undefined); assert.equal(replacement.innerHTML, selector);
            assert.equal(oldButton._mangaParserAbort, undefined);
            h.complete(); await flush(); assert.deepEqual(clone(h.studio.panels), before);
        });
    }
    await test('single-panel success cannot write back to a panel removed during parsing', async () => {
        const h = host(), originalPanel = h.studio.panels[0], before = clone(originalPanel);
        const pending = h.buttons.get('.mw-panel-ai-single').listeners.click();
        h.studio.panels = []; h.complete(); await pending;
        assert.deepEqual(clone(originalPanel), before); assert.deepEqual(h.studio.panels, []);
        assert.equal(h.notices.length, 0);
    });
    await test('storyboard deadline exits the spinner and displays a useful error while retaining the draft', async () => {
        const h = host(), btn = h.buttons.get('#mw-btn-ai-storyboard'), before = clone(h.studio.panels), original = btn.innerHTML;
        const pending = btn.listeners.click(); h.tick(); await pending;
        assert.equal(btn.innerHTML, original); assert.equal(btn._mangaParserAbort, undefined); assert.equal(btn.disabled, false);
        assert.deepEqual(clone(h.studio.panels), before); assert.match(h.diagnostics[0].reason, /180 秒/);
        h.complete(); await flush(); assert.deepEqual(clone(h.studio.panels), before);
    });
    await test('actual instance cleanup aborts pending Studio work without waiting for its provider', async () => {
        const h = host(), before = JSON.stringify(h.studio);
        const source = h.mangaSource.slice(h.mangaSource.indexOf('    function cleanup({ preserveEnabled = false } = {}) {'),
            h.mangaSource.indexOf("        RBQ.off?.('buildNaiV4Payload', onMangaPayload);", h.mangaSource.indexOf('    function cleanup({ preserveEnabled = false } = {}) {')));
        vm.runInContext(source + '\n    }', h.manga);
        const pending = h.manga.requestStudioPanels(h.store, 'one panel', '教室。', 1);
        h.manga.cleanup(); await assert.rejects(pending, /已卸载或重新加载/);
        assert.equal(h.request().signal.aborted, true); assert.equal(h.timers.size, 0);
        h.complete(); await flush(); assert.equal(JSON.stringify(h.studio), before);
    });
    console.log(`\n${passed} Studio request/cancellation tests passed; 0 live calls.`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
