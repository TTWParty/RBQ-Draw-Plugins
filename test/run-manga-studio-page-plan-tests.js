/** Studio page-plan preservation and draft invalidation. Ordinary adult scenes; no live services. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
let passed = 0, failed = 0;
async function test(name, run) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

const pageBase = 'comic, 2 panels, 1girl, 1boy, bottom focal panel occupies 65 percent of page, top auxiliary panel occupies 35 percent, reading path top to bottom, soft side lighting';
function scene(mode = 'structured', caption = '清晨。') {
    const bubble = (type, text) => ({ type, position: type === 'caption' ? 'top' : 'right-upper', layout: 'horizontal', text });
    return {
        capacity_note: '两格容纳递信和等候，主格保留人物反应空间。',
        page: {
            base: pageBase,
            non_character: mode === 'legacy'
                ? 'BubbleType: 矩形のナレーション枠, 上部, Layout: 横書き\nText: ' + caption
                : 'page caption frame',
            ...(mode === 'structured' ? { bubbles: [bubble('caption', caption)] } : {})
        },
        panels: [
            { id: 'P1', title: '递信', desc: '成人艾达把信封递给坐着的成人本。', position: 'top auxiliary panel', shot: 'medium shot',
                description: 'office, wooden table, window', non_character: '', ...(mode === 'structured' ? { bubbles: [] } : {}),
                characters: [
                    { character_id: 'C1', name: 'Ada (original)', base: 'girl, adult, long black hair', outfit: 'white shirt, black trousers',
                        positive: 'standing, right hand gripping envelope, extending right arm toward Ben', negative: 'extra fingers',
                        ...(mode === 'structured' ? { bubbles: [] } : {}) },
                    { character_id: 'C2', name: 'Ben (original)', base: 'boy, adult, short brown hair', outfit: 'green sweater',
                        positive: 'sitting, left hand reaching toward envelope' + (mode === 'legacy'
                            ? ', BubbleType: 通常吹き出し, 右上, Layout: 横書き\nText: 谢谢。' : ''), negative: 'extra arms',
                        ...(mode === 'structured' ? { bubbles: [bubble('speech', '谢谢。')] } : {}) }
                ] },
            { id: 'P2', title: '等待回答', desc: '成人艾达等待本读信。', position: 'bottom focal panel', shot: 'close-up',
                description: 'office, wooden table', non_character: '', ...(mode === 'structured' ? { bubbles: [] } : {}),
                characters: [
                    { character_id: 'C1', name: 'Ada (original)', base: '', outfit: '', positive: 'waiting, looking toward Ben', negative: '',
                        ...(mode === 'structured' ? { bubbles: [] } : {}) }
                ] }
        ]
    };
}

function host(mode = 'structured') {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,mangaSource};')(require, __dirname);
    const { manga, settings, RBQ } = env;
    const store = settings._mangaMode, studio = store.studio;
    Object.assign(store, { dialogueMode: mode, style: 'custom', customPositive: 'clean lineart', customNegative: '', grammar: 'cinema', gutter: 'bleed' });
    Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', toolCallMode: true });
    Object.assign(studio, { ratio: '832x1216', storyText: '艾达把信递给本。本说谢谢，艾达等待他读信。', page: null, pageLayoutSignature: '' });
    let request;
    RBQ.api.callStructuredCompletion = async args => {
        request = args;
        return { rawReply: JSON.stringify(scene(mode)) };
    };
    const textOf = value => manga.splitMangaText(value, false).text;
    const compile = () => manga.compileMangaPage(manga.buildStudioPage(store));
    const apply = result => {
        studio.panels = result;
        manga.applyStudioPagePlan(store, result, true);
        return compile();
    };
    const parse = () => manga.requestStudioPanels(store, 'two panels', studio.storyText, 2);
    return { ...env, store, studio, mode, request: () => request, parse, apply, compile, textOf };
}

async function planned(mode = 'structured') {
    const h = host(mode);
    h.apply(await h.parse());
    return h;
}

(async () => {
    for (const mode of ['structured', 'legacy']) {
        await test(`${mode} request returns complete page metadata without publishing a new draft`, async () => {
            const h = host(mode), before = clone(h.studio);
            const result = await h.parse();
            assert.ok(Array.isArray(result), 'existing array return contract must remain compatible');
            assert.equal(result.length, 2);
            assert.equal(result[0].id, 'P1'); assert.equal(result[1].id, 'P2');
            assert.match(result.page.base, /bottom focal panel occupies 65 percent/);
            assert.equal(result.capacityNote, scene(mode).capacity_note);
            assert.equal(typeof result.pageLayoutSignature, 'string');
            assert.ok(h.request().tool.function.parameters.properties.page, 'the model must be asked for the page it will draw');
            assert.deepEqual(clone(h.studio.page), before.page);
            assert.equal(h.studio.pageLayoutSignature, before.pageLayoutSignature);
            assert.deepEqual(clone(h.studio.panels), before.panels);
        });
        await test(`${mode} successful apply retains area, reading path, light and page text through compilation`, async () => {
            const h = await planned(mode), compiled = h.compile();
            for (const token of ['65 percent', '35 percent', 'reading path top to bottom', 'soft side lighting']) {
                assert.ok(compiled.base.includes(token), 'missing page instruction: ' + token);
            }
            assert.equal(h.textOf(compiled.base), '清晨。');
            assert.doesNotMatch(compiled.base, /两格容纳递信/);
            assert.equal(h.textOf(compiled.characters[1].caption), '谢谢。');
            assert.equal(h.textOf(compiled.characters[0].caption), '');
            assert.match(compiled.characters[0].caption, /top auxiliary panel, medium shot/);
            assert.match(compiled.characters[2].caption, /bottom focal panel, close-up/);
        });
        for (const first of ['manga', 'sdt']) {
            await test(`${mode} final image payload preserves page plan and owned dialogue (${first} hook first)`, async () => {
                const h = await planned(mode), compiled = h.compile();
                h.RBQ.api.generationContextVersion = 1;
                h.RBQ.api.generateImage = async (prompt, reason, meta) => {
                    assert.equal(reason, 'manga-workshop');
                    const context = { prompt, reason, meta };
                    const order = first === 'manga' ? [h.mangaHook, h.sdtHook] : [h.sdtHook, h.mangaHook];
                    let request = h.payload(prompt);
                    for (const hook of order) request = hook(request, context);
                    const base = request.parameters.v4_prompt.caption.base_caption;
                    assert.match(base, /65 percent/); assert.match(base, /reading path top to bottom/); assert.match(base, /soft side lighting/);
                    assert.equal(h.textOf(base), '清晨。');
                    assert.doesNotMatch(base, /Text:.*谢谢/s);
                    const people = request.parameters.v4_prompt.caption.char_captions;
                    assert.equal(people.length, 3);
                    assert.equal(h.textOf(people[1].char_caption), '谢谢。');
                    assert.equal(h.textOf(people[0].char_caption), '');
                    assert.equal(h.textOf(people[2].char_caption), '');
                    assert.equal(request.parameters.width, 832); assert.equal(request.parameters.height, 1216);
                    return { url: 'safe-page-plan-fixture.png' };
                };
                const result = await h.sdt.generateSdtImage({ mangaPage: true, mangaTextCompiled: true,
                    mangaUseCoords: compiled.useCoords, characters: compiled.characters,
                    mangaRenderSettings: { ...h.RBQ.api.mangaProtocol.captureRenderSettings(), ratio: '832x1216' }
                }, compiled.base, 'manga-workshop');
                assert.equal(result.url, 'safe-page-plan-fixture.png');
            });
        }
        await test(`${mode} saved page plan survives JSON settings reload and does not alias returned metadata`, async () => {
            const h = host(mode), result = await h.parse(); h.apply(result);
            result.page.base = 'unrelated page';
            if (result.page.bubbles) result.page.bubbles[0].text = '外部修改。';
            else result.page.non_character = 'Text: 外部修改。';
            assert.match(h.compile().base, /65 percent/);
            assert.equal(h.textOf(h.compile().base), '清晨。');
            h.store.studio = clone(h.studio);
            const reloaded = h.manga.compileMangaPage(h.manga.buildStudioPage(h.store));
            assert.match(reloaded.base, /65 percent/);
            assert.equal(h.textOf(reloaded.base), '清晨。');
        });
        await test(`${mode} dialogue and appearance edits retain the valid layout`, async () => {
            const h = await planned(mode), owner = h.studio.panels[0].characters[1];
            h.manga.updateStudioVisualCaption(owner, 'positive', owner.positive.replace('green sweater', 'blue shirt').replace('谢谢。', '收到了。'));
            h.settings._smartDrawTrigger.characterProfiles = { other: { base: 'adult, brown hair' } };
            const result = h.compile();
            assert.match(result.base, /65 percent/); assert.match(result.base, /soft side lighting/);
            assert.equal(h.textOf(result.base), '清晨。');
            assert.equal(h.textOf(result.characters[1].caption), '收到了。');
        });
    }

    const changes = {
        'panel reorder': h => h.studio.panels.reverse(),
        'panel insertion': h => h.studio.panels.push({ ...clone(h.studio.panels[1]), id: 'P3', title: '等候结束' }),
        'panel deletion': h => h.studio.panels.pop(),
        'manual position': h => { h.studio.panels[0].position = 'top-right small panel'; },
        'panel identity': h => { h.studio.panels[0].id = 'P3'; },
        grammar: h => { h.store.grammar = 'daily'; },
        ratio: h => { h.studio.ratio = '1216x832'; },
        gutter: h => { h.store.gutter = 'framed'; },
        style: h => { h.store.style = 'soft_color'; }
    };
    for (const [name, change] of Object.entries(changes)) {
        await test(`${name} invalidates stale page layout while retaining page text`, async () => {
            const h = await planned(); change(h);
            const result = h.compile();
            assert.doesNotMatch(result.base, /65 percent|35 percent|soft side lighting/);
            assert.equal(h.textOf(result.base), '清晨。');
        });
    }
    await test('title and camera edits keep the page arrangement valid', async () => {
        const h = await planned();
        h.studio.panels[0].title = '递信的近景'; h.studio.panels[0].shot = 'close-up';
        const result = h.compile();
        assert.match(result.base, /65 percent/);
        assert.equal(h.textOf(result.base), '清晨。');
        assert.match(result.characters[0].caption, /top auxiliary panel, close-up/);
    });
    await test('a canvas change while parsing cannot mark the returned old layout valid for the new canvas', async () => {
        const h = await planned(); let complete;
        h.RBQ.api.callStructuredCompletion = () => new Promise(resolve => { complete = () => resolve({ rawReply: JSON.stringify(scene()) }); });
        const pending = h.parse();
        h.studio.ratio = '1216x832'; complete();
        const result = await pending; h.apply(result);
        const compiled = h.compile();
        assert.doesNotMatch(compiled.base, /65 percent|soft side lighting/);
        assert.equal(h.textOf(compiled.base), '清晨。');
    });
    await test('single-panel polishing preserves its original identity and page position', async () => {
        const h = await planned(), before = clone(h.studio.page);
        const local = scene(); local.panels = [local.panels[1]];
        local.panels[0].id = 'P1'; local.panels[0].position = 'full-page panel';
        h.RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(local) });
        const result = await h.manga.callLlmSingleSentenceExpander('艾达等待读信。', h.studio.panels[1].shot,
            h.store.grammar, h.store.language, h.studio.panels, 1);
        assert.equal(result.id, 'P2'); assert.equal(result.position, 'bottom focal panel');
        Object.assign(h.studio.panels[1], result);
        assert.deepEqual(clone(h.studio.page), before);
        assert.match(h.compile().base, /65 percent/);
    });
    await test('single-panel polishing still targets the original panel after an in-flight reorder', async () => {
        const h = await planned(), target = h.studio.panels[0]; let complete;
        const local = scene(); local.panels = [local.panels[0]];
        local.panels[0].position = 'full-page panel';
        h.RBQ.api.callStructuredCompletion = () => new Promise(resolve => { complete = () => resolve({ rawReply: JSON.stringify(local) }); });
        const pending = h.manga.callLlmSingleSentenceExpander('艾达递出信封。', target.shot,
            h.store.grammar, h.store.language, h.studio.panels, 0);
        h.studio.panels.reverse(); target.position = 'left tall panel'; complete();
        const result = await pending;
        assert.equal(result.id, target.id); assert.equal(result.id, 'P1');
        assert.equal(result.position, 'left tall panel');
        assert.notEqual(result.id, h.studio.panels[0].id, 'the current numeric index belongs to a different panel');
    });
    for (const mode of ['structured', 'legacy']) {
        await test(`${mode} batch receives page text and retains fields omitted by its valid reply`, async () => {
            const h = await planned(mode); let sent;
            const response = scene(mode); response.page = { base: response.page.base.replace('65 percent', '60 percent') };
            h.RBQ.api.callStructuredCompletion = async options => {
                sent = JSON.parse(options.messages.at(-1).content);
                return { rawReply: JSON.stringify(response) };
            };
            const result = await h.manga.callLlmBatchSentenceExpander(h.studio.panels, h.store.grammar, h.store.language);
            assert.ok(sent.page, 'page-level text must accompany panel-only polishing inputs');
            assert.ok(JSON.stringify(sent.page).includes('清晨。'));
            result.forEach((panel, index) => Object.assign(h.studio.panels[index], panel));
            h.manga.applyStudioPagePlan(h.store, result);
            const compiled = h.compile();
            assert.match(compiled.base, /60 percent/);
            assert.equal(h.textOf(compiled.base), '清晨。');
            assert.equal(h.textOf(compiled.characters[1].caption), '谢谢。');
        });
    }
    await test('explicit empty page bubbles clear a previous page caption', async () => {
        const h = await planned(), response = scene(); response.page = { base: response.page.base, bubbles: [] };
        h.RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(response) });
        const result = await h.manga.callLlmBatchSentenceExpander(h.studio.panels, h.store.grammar, h.store.language);
        result.forEach((panel, index) => Object.assign(h.studio.panels[index], panel));
        h.manga.applyStudioPagePlan(h.store, result);
        assert.deepEqual(clone(h.studio.page.bubbles), []);
        assert.equal(h.textOf(h.compile().base), '');
    });
    await test('new legacy page text replaces old structured bubbles rather than being hidden by them', async () => {
        const h = await planned(), response = scene();
        response.page = { base: response.page.base, non_character: 'BubbleType: ナレーション枠, 上部, Layout: 横書き\nText: 午后。' };
        h.RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(response) });
        const result = await h.manga.callLlmBatchSentenceExpander(h.studio.panels, h.store.grammar, h.store.language);
        result.forEach((panel, index) => Object.assign(h.studio.panels[index], panel));
        h.manga.applyStudioPagePlan(h.store, result);
        assert.equal(h.studio.page.bubbles, undefined);
        assert.equal(h.textOf(h.compile().base), '午后。');
    });
    await test('an explicit legacy page text clear also clears old structured page bubbles', async () => {
        const h = await planned(); h.store.dialogueMode = 'legacy';
        const response = scene('legacy'); response.page = { base: response.page.base, non_character: '' };
        h.RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(response) });
        const result = await h.manga.callLlmBatchSentenceExpander(h.studio.panels, h.store.grammar, h.store.language);
        result.forEach((panel, index) => Object.assign(h.studio.panels[index], panel));
        h.manga.applyStudioPagePlan(h.store, result);
        assert.equal(h.studio.page.bubbles, undefined);
        assert.equal(h.textOf(h.compile().base), '');
    });
    await test('new visible people replace stale canonical counts without dropping the page arrangement', async () => {
        const h = await planned();
        h.studio.panels[0].characters.push({ character_id: 'C3', name: 'Mei (original)', positive: 'girl, adult, white shirt, standing', negative: '', bubbles: [] });
        const result = h.compile(), tags = h.manga.splitMangaText(result.base, false).visual.split(/,\s*/);
        assert.ok(tags.includes('2girls')); assert.ok(tags.includes('1boy'));
        assert.equal(tags.includes('1girl'), false, 'the saved page count is obsolete');
        assert.match(result.base, /65 percent/);
        assert.equal(h.textOf(result.base), '清晨。');
    });
    await test('unknown local subjects retain model counts instead of inventing an alternative total', async () => {
        const h = await planned();
        for (const panel of h.studio.panels) for (const person of panel.characters) {
            if (person.character_id === 'C1') person.positive = person.positive.replace(/\bgirl,?\s*/g, '');
        }
        const result = h.compile(), tags = h.manga.splitMangaText(result.base, false).visual.split(/,\s*/);
        assert.ok(tags.includes('1girl')); assert.ok(tags.includes('1boy'));
        assert.equal(tags.includes('2girls'), false); assert.equal(tags.includes('no humans'), false);
        assert.match(result.base, /65 percent/);
    });
    await test('old panel-only response keeps the existing page for batch polishing but clears it on full replacement', async () => {
        const h = await planned(), oldPage = clone(h.studio.page), oldSignature = h.studio.pageLayoutSignature;
        h.RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify({ panels: scene().panels }) });
        const result = await h.parse();
        assert.ok(Array.isArray(result));
        h.manga.applyStudioPagePlan(h.store, result, false);
        assert.deepEqual(clone(h.studio.page), oldPage); assert.equal(h.studio.pageLayoutSignature, oldSignature);
        h.studio.panels = result; h.manga.applyStudioPagePlan(h.store, result, true);
        assert.equal(h.studio.page, null);
        assert.equal(h.textOf(h.compile().base), '');
        assert.doesNotMatch(h.compile().base, /65 percent/);
    });
    await test('a cancelled request and its late response cannot change the saved page plan', async () => {
        const h = await planned(), before = clone(h.studio.page), signature = h.studio.pageLayoutSignature;
        let complete;
        h.RBQ.api.callStructuredCompletion = () => new Promise(resolve => { complete = () => resolve({ rawReply: JSON.stringify(scene('structured', '午后。')) }); });
        const controller = new AbortController();
        const pending = h.manga.requestStudioPanels(h.store, 'two panels', h.studio.storyText, 2, false, controller.signal);
        controller.abort(h.manga.studioAbortError());
        await assert.rejects(pending, error => error.name === 'AbortError');
        complete(); await flush();
        assert.deepEqual(clone(h.studio.page), before); assert.equal(h.studio.pageLayoutSignature, signature);
        assert.equal(h.textOf(h.compile().base), '清晨。');
    });
    await test('an invalid response preserves the saved page plan', async () => {
        const h = await planned(), before = clone(h.studio.page), signature = h.studio.pageLayoutSignature;
        h.RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify({ page: scene().page, panels: [] }) });
        await assert.rejects(h.parse(), /画格数量/);
        assert.deepEqual(clone(h.studio.page), before); assert.equal(h.studio.pageLayoutSignature, signature);
    });
    await test('batch UI does not apply a new page plan after panels are reordered during the request', async () => {
        const h = await planned(), before = clone(h.studio.page);
        const notices = [], buttons = new Map();
        const button = selector => {
            if (!buttons.has(selector)) buttons.set(selector, { innerHTML: selector, disabled: false, listeners: {}, addEventListener(type, run) { this.listeners[type] = run; } });
            return buttons.get(selector);
        };
        Object.assign(h.manga, { store: h.store, studio: h.studio, storyInputEl: { value: h.studio.storyText }, container: { querySelector: button },
            clearStudioDebugBox() {}, renderStudioDebugBox() {}, renderPanelCards() {}, updatePromptPreview() {}, save() {},
            toastr: Object.fromEntries(['warning', 'error', 'success', 'info'].map(type => [type, message => notices.push({ type, message })])) });
        const source = h.mangaSource.slice(h.mangaSource.indexOf("        const btnAi = container.querySelector('#mw-btn-ai-storyboard');"),
            h.mangaSource.indexOf('        // Add panel button'));
        vm.runInContext('{' + source + '}', h.manga);
        let complete;
        const next = scene('structured', '午后。'); next.page.base = next.page.base.replace('65 percent', '75 percent');
        h.RBQ.api.callStructuredCompletion = () => new Promise(resolve => { complete = () => resolve({ rawReply: JSON.stringify(next) }); });
        const pending = buttons.get('#mw-btn-ai-batch').listeners.click();
        h.studio.panels.reverse(); complete(); await pending;
        assert.deepEqual(clone(h.studio.page), before);
        const result = h.compile();
        assert.doesNotMatch(result.base, /75 percent/);
        assert.equal(h.textOf(result.base), '清晨。');
        assert.equal(notices.some(notice => notice.type === 'error'), false);
    });
    console.log(`\n${passed} Studio page-plan tests passed; ${failed} failed; 0 live calls.`);
    if (failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
