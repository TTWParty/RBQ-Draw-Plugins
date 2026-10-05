/** Production Studio requests and handlers stop after instance disposal. No live services. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function host() {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,settings,RBQ,mangaSource};')(require, __dirname);
    const { manga, settings, RBQ, mangaSource } = env;
    const store = settings._mangaMode, studio = store.studio;
    Object.assign(store, { style: 'soft_color', dialogueMode: 'structured', grammar: 'cinema', language: 'zh-hans' });
    Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', toolCallMode: true });
    studio.storyText = '她把信封递给同事。'; studio._lastDebug = { original: true };
    studio.panels = [{ id: 'P1', title: '递信', desc: studio.storyText, shot: 'medium shot', tags: 'office',
        characters: [{ character_id: 'C1', name: 'Ada (original)', positive: 'holding envelope', negative: '' }] }];
    const returned = { panels: [{ id: 'P1', title: '收到信', desc: '她展示纸上的字段示例。', position: 'full page',
        shot: 'medium shot', description: 'office', bubbles: [], characters: [{ character_id: 'C1', name: 'Ada (original)',
            base: 'girl, short hair', outfit: 'white shirt', positive: 'holding envelope', bubbles: [], negative: '' }] }] };
    let resolve, reject, requests = 0, saves = 0, renders = 0, notices = 0, cacheSaves = 0;
    RBQ.api.callStructuredCompletion = () => { requests++; return new Promise((yes, no) => { resolve = yes; reject = no; }); };
    RBQ.api.collectMangaReferenceData = () => ({ characterMemory: [] });
    RBQ.api.captureMangaRenderCacheContext = () => ({ renderCache: [] });
    RBQ.api.saveMangaRenderCache = () => { cacheSaves++; };
    studio.useChatChars = true;
    const buttons = new Map();
    const button = key => {
        if (!buttons.has(key)) buttons.set(key, { disabled: false, innerHTML: key, listeners: {},
            addEventListener(event, callback) { this.listeners[event] = callback; } });
        return buttons.get(key);
    };
    Object.assign(manga, { store, studio, p: studio.panels[0], idx: 0,
        storyInputEl: { value: studio.storyText }, container: { querySelector: button }, card: { querySelector: button },
        clearStudioDebugBox() {}, renderStudioDebugBox() { renders++; }, renderPanelCards() { renders++; },
        updatePromptPreview() { renders++; }, save() { saves++; },
        toastr: { warning() { notices++; }, error() { notices++; }, success() { notices++; } } });
    vm.runInContext(mangaSource.slice(mangaSource.indexOf("                const btnSingleAi = card.querySelector('.mw-panel-ai-single');"),
        mangaSource.indexOf("                card.querySelector('.mw-panel-shot-sel')?.addEventListener")), manga);
    vm.runInContext(mangaSource.slice(mangaSource.indexOf("        const btnAi = container.querySelector('#mw-btn-ai-storyboard');"),
        mangaSource.indexOf('        // Add panel button')), manga);
    return { ...env, store, studio, buttons, returned,
        complete: () => resolve({ rawReply: JSON.stringify(returned) }), fail: () => reject(new Error('fixture failure')),
        dispose() { vm.runInContext('disposed = true;', manga); store.enabled = false; },
        counts: () => ({ requests, saves, renders, notices, cacheSaves }) };
}

(async () => {
    await test('pending structured completion cannot return panels or write cache/debug after disposal', async () => {
        const h = host(), before = JSON.stringify(h.studio);
        const pending = h.manga.requestStudioPanels(h.store, '递信', h.studio.storyText, 1);
        h.dispose(); h.complete();
        await assert.rejects(pending, /已卸载或重新加载/);
        assert.equal(JSON.stringify(h.studio), before);
        assert.deepEqual(h.counts(), { requests: 1, saves: 0, renders: 0, notices: 0, cacheSaves: 0 });
    });
    for (const [label, selector] of [['single panel', '.mw-panel-ai-single'], ['storyboard', '#mw-btn-ai-storyboard'], ['batch', '#mw-btn-ai-batch']]) {
        for (const fails of [false, true]) await test(label + ' handler ignores stale ' + (fails ? 'failure' : 'success') + ' after disposal', async () => {
            const h = host(), before = JSON.stringify(h.studio), btn = h.buttons.get(selector);
            const pending = btn.listeners.click();
            assert.equal(h.counts().requests, 1);
            h.dispose(); const staleButtonHtml = btn.innerHTML;
            if (fails) h.fail(); else h.complete();
            await pending;
            assert.equal(JSON.stringify(h.studio), before);
            assert.equal(btn.innerHTML, staleButtonHtml);
            assert.deepEqual(h.counts(), { requests: 1, saves: 0, renders: 0, notices: 0, cacheSaves: 0 });
        });
    }
    await test('normal mounted storyboard completion still updates the draft and saves once', async () => {
        const h = host(), pending = h.buttons.get('#mw-btn-ai-storyboard').listeners.click();
        h.complete(); await pending;
        assert.equal(h.studio.panels[0].title, '收到信');
        assert.equal(h.counts().saves, 1); assert.equal(h.counts().cacheSaves, 1); assert.equal(h.counts().notices, 1);
        assert.equal(h.buttons.get('#mw-btn-ai-storyboard').disabled, false);
    });
    for (const selector of ['.mw-panel-ai-single', '#mw-btn-ai-storyboard', '#mw-btn-ai-batch']) await test('retained ' + selector + ' handler cannot start a new request after disposal', async () => {
        const h = host(); h.dispose(); await h.buttons.get(selector).listeners.click();
        assert.deepEqual(h.counts(), { requests: 0, saves: 0, renders: 0, notices: 0, cacheSaves: 0 });
    });
    console.log('\n' + passed + ' in-flight lifecycle audit tests passed; 0 live calls.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
