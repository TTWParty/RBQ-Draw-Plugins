/** Delayed AI replies exercise actual Studio handlers without network or image credits. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
const selectors = ['.mw-panel-ai-single', '#mw-btn-ai-storyboard', '#mw-btn-ai-batch'];

function fixturePanel(index = 0) {
    return { id: `P${index + 1}`, title: '递信', desc: '她递出信封。', position: index ? 'bottom panel' : 'top panel',
        shot: 'medium shot', tags: 'office', non_character: '',
        characters: [{ character_id: 'C1', name: 'Ada', positive: 'girl, adult, brown hair, white blouse, holding envelope', negative: '',
            bubbles: [{ type: 'speech', text: '请收下。', layout: 'vertical' }] }] };
}

function host(count = 1) {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,settings,RBQ,mangaSource};')(require, __dirname);
    const { manga, settings, RBQ, mangaSource } = env;
    const store = settings._mangaMode, studio = store.studio;
    Object.assign(store, { style: 'soft_color', dialogueMode: 'structured', grammar: 'cinema', language: 'zh-hans' });
    Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', toolCallMode: true });
    Object.assign(studio, { storyText: '她把信封递给同事，同事点头。', panels: Array.from({ length: count }, (_, index) => fixturePanel(index)) });
    let complete, requests = 0;
    RBQ.api.callStructuredCompletion = () => {
        requests++;
        return new Promise(resolve => { complete = (replyCount = count) => resolve({ rawReply: JSON.stringify({ page: { base: `comic, ${replyCount} panels` },
            panels: Array.from({ length: replyCount }, (_, index) => ({ id: `P${index + 1}`, title: `AI result ${index + 1}`, desc: '收到信封。',
                position: index ? 'bottom panel' : 'top panel', shot: 'wide shot', description: 'classroom', bubbles: [], characters: [] })) }) }); });
    };
    const notices = [], buttons = new Map();
    const button = key => {
        if (!buttons.has(key)) buttons.set(key, { innerHTML: key, disabled: false, listeners: {}, addEventListener(type, run) { this.listeners[type] = run; } });
        return buttons.get(key);
    };
    Object.assign(manga, { store, studio, p: studio.panels[0], idx: 0, storyInputEl: { value: studio.storyText },
        card: { querySelector: button }, container: { querySelector: button }, clearStudioDebugBox() {}, renderStudioDebugBox() {},
        renderPanelCards() {}, updatePromptPreview() {}, save() {},
        toastr: Object.fromEntries(['warning', 'error', 'success', 'info'].map(type => [type, text => notices.push({ type, text })])) });
    const single = mangaSource.slice(mangaSource.indexOf("                const btnSingleAi = card.querySelector('.mw-panel-ai-single');"),
        mangaSource.indexOf("                card.querySelector('.mw-panel-shot-sel')?.addEventListener"));
    const rest = mangaSource.slice(mangaSource.indexOf("        const btnAi = container.querySelector('#mw-btn-ai-storyboard');"), mangaSource.indexOf('        // Add panel button'));
    vm.runInContext('{' + single + '}', manga); vm.runInContext('{' + rest + '}', manga);
    return { ...env, store, studio, notices, buttons, requests: () => requests, complete: replyCount => complete(replyCount) };
}

(async () => {
    const edits = {
        'scene and action': panel => { panel.desc = '她把信封放回桌上。'; panel.tags = 'office, desk'; panel.shot = 'close-up'; },
        'character appearance': panel => { panel.characters[0].positive = 'girl, adult, brown hair, dark jacket, looking down'; },
        'owned dialogue': panel => { panel.characters[0].bubbles = [{ type: 'thought', text: '我再等等。', layout: 'horizontal' }]; },
        'character removal': panel => { panel.characters = []; }
    };
    for (const selector of selectors) {
        for (const [label, edit] of Object.entries(edits)) {
            await test(`${selector} preserves ${label} edited while AI is waiting`, async () => {
                const h = host(), btn = h.buttons.get(selector), originalHtml = btn.innerHTML;
                const pending = btn.listeners.click(); assert.equal(h.requests(), 1);
                edit(h.studio.panels[0]); const edited = clone(h.studio.panels);
                h.complete(); await pending;
                assert.deepEqual(clone(h.studio.panels), edited);
                assert.equal(h.notices.at(-1).type, 'info'); assert.match(h.notices.at(-1).text, /当前编辑已保留/);
                assert.equal(btn.innerHTML, originalHtml); assert.equal(btn._mangaParserAbort, undefined);
            });
        }
        await test(`${selector} cannot replace draft after the parsing settings change`, async () => {
            const h = host(), before = clone(h.studio.panels), pending = h.buttons.get(selector).listeners.click();
            h.store.language = 'ja'; h.store.style = 'monochrome'; h.complete(); await pending;
            assert.deepEqual(clone(h.studio.panels), before); assert.equal(h.store.language, 'ja'); assert.equal(h.store.style, 'monochrome');
            assert.equal(h.notices.at(-1).type, 'info');
        });
        await test(`${selector} ignores editor disclosure, diagnostics and image preview changes`, async () => {
            const h = host(), pending = h.buttons.get(selector).listeners.click();
            h.studio.panels[0]._editorOpen = true; h.studio._lastDebug = { text: 'preview' }; h.studio.lastGeneratedUrl = 'data:image/png;base64,fixture';
            h.complete(); await pending;
            assert.equal(h.studio.panels[0].title, 'AI result 1'); assert.equal(h.notices.at(-1).type, 'success');
        });
    }
    await test('single refinement remains attached to the original panel during reorder and keeps a new position', async () => {
        const h = host(2), first = h.studio.panels[0], second = h.studio.panels[1];
        const pending = h.buttons.get('.mw-panel-ai-single').listeners.click();
        h.studio.panels.reverse(); first.position = 'bottom left detail panel'; h.complete(1); await pending;
        assert.equal(h.studio.panels[0], second); assert.equal(h.studio.panels[1], first);
        assert.equal(first.title, 'AI result 1'); assert.equal(first.position, 'bottom left detail panel'); assert.equal(first.id, 'P1');
    });
    await test('batch refinement respects reorder without reinstating old positions', async () => {
        const h = host(2), first = h.studio.panels[0], second = h.studio.panels[1];
        const pending = h.buttons.get('#mw-btn-ai-batch').listeners.click();
        h.studio.panels.reverse(); h.studio.panels.forEach(panel => { panel.position = ''; }); h.complete(); await pending;
        assert.equal(h.studio.panels[0], second); assert.equal(h.studio.panels[1], first);
        assert.equal(first.title, 'AI result 1'); assert.equal(second.title, 'AI result 2');
        assert.equal(first.position, ''); assert.equal(second.position, ''); assert.equal(h.notices.at(-1).type, 'success');
    });
    await test('batch refinement preserves an explicitly edited position during reorder', async () => {
        const h = host(2), first = h.studio.panels[0], pending = h.buttons.get('#mw-btn-ai-batch').listeners.click();
        h.studio.panels.reverse(); first.position = 'bottom left detail panel'; h.complete(); await pending;
        assert.equal(first.title, 'AI result 1'); assert.equal(first.position, 'bottom left detail panel');
        assert.equal(h.studio.panels[0].position, '');
    });
    await test('manual batch position edit prevents the old response replacing the layout', async () => {
        const h = host(), pending = h.buttons.get('#mw-btn-ai-batch').listeners.click();
        h.studio.panels[0].position = 'dominant left panel'; const edited = clone(h.studio.panels); h.complete(); await pending;
        assert.deepEqual(clone(h.studio.panels), edited); assert.equal(h.notices.at(-1).type, 'info');
    });
    await test('full storyboard keeps newer story input and the previous panel draft', async () => {
        const h = host(), before = clone(h.studio.panels), pending = h.buttons.get('#mw-btn-ai-storyboard').listeners.click();
        h.manga.storyInputEl.value = '同事转身离开办公室。'; h.studio.storyText = h.manga.storyInputEl.value; h.complete(); await pending;
        assert.deepEqual(clone(h.studio.panels), before); assert.equal(h.studio.storyText, '同事转身离开办公室。');
        assert.equal(h.notices.at(-1).type, 'info');
    });
    await test('full storyboard retains panels manually inserted while waiting', async () => {
        const h = host(), pending = h.buttons.get('#mw-btn-ai-storyboard').listeners.click();
        h.studio.panels.push(fixturePanel(1)); const edited = clone(h.studio.panels); h.complete(); await pending;
        assert.deepEqual(clone(h.studio.panels), edited); assert.equal(h.notices.at(-1).type, 'info');
    });
    await test('a page-level text edit while batch waits is not overwritten', async () => {
        const h = host(), pending = h.buttons.get('#mw-btn-ai-batch').listeners.click();
        h.studio.page = { base: 'comic', non_character: 'caption, Text: 午后。' }; const before = clone(h.studio.panels); h.complete(); await pending;
        assert.deepEqual(clone(h.studio.page), { base: 'comic', non_character: 'caption, Text: 午后。' });
        assert.deepEqual(clone(h.studio.panels), before); assert.equal(h.notices.at(-1).type, 'info');
    });
    for (const selector of ['.mw-panel-ai-single', '#mw-btn-ai-batch']) {
        await test(`${selector} accepts an existing Tag and dialogue draft without a plot label`, async () => {
            const h = host(); h.studio.panels[0].title = ''; h.studio.panels[0].desc = '';
            const pending = h.buttons.get(selector).listeners.click(); assert.equal(h.requests(), 1); h.complete(); await pending;
            assert.equal(h.studio.panels[0].title, 'AI result 1'); assert.equal(h.notices.at(-1).type, 'success');
        });
        await test(`${selector} still requires actual plot, visual or text input`, async () => {
            const h = host(); Object.assign(h.studio.panels[0], { title: '', desc: '', tags: '', shot: '', characters: [], bubbles: [] });
            await h.buttons.get(selector).listeners.click(); assert.equal(h.requests(), 0); assert.equal(h.notices.at(-1).type, 'warning');
        });
    }
    console.log(`\n${passed} Studio edit-race tests passed; 0 live calls.`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
