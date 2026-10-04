/** Black-and-white rendering views execute the production parser/compiler/hooks.
 * Model replies are fixtures; no network, image processing or image credits. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook, sdtSource } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,sdtSource};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const originalBase = 'girl, korean, 35 years old, 180cm height, long blonde hair, brown eyes, custom facial mark';
const grayBase = 'girl, korean, 35 years old, 180cm height, long light grey hair, dark eyes, custom facial mark';
const originalOutfit = 'beige trench coat, white shirt, blue denim jeans, layered custom clasp';
const grayOutfit = 'light grey trench coat, white shirt, dark denim jeans, layered custom clasp';
function page(people, base = 'comic, monochrome, greyscale, screentone, overhead light, high contrast') {
    return { format: 'nai5-comic', anchor: { text: '她走进房间，拿起信封，随后换上外套。' }, page: { base },
        panels: people.map((person, i) => ({ id: 'P' + (i + 1), description: 'panel, dark wooden desk, side lighting',
            characters: [{ character_id: 'C1', name: 'Mina (original)', base: '', outfit: '', positive: 'standing', negative: '', ...person }] })) };
}
const first = () => ({ base: originalBase, outfit: originalOutfit, render: { base: grayBase, outfit: grayOutfit } });
const resolve = (pages, refs = [], style = 'monochrome') => RBQ.api.mangaProtocol.resolveAppearances(pages, refs, [], [], { style });
const compile = p => manga.compileMangaPage(p).characters.map(c => c.caption);
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }
function reset(memory = true) {
    settings._mangaMode.style = 'monochrome'; settings._mangaMode.enabled = true;
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga', characterMemoryEnabled: memory, characterProfiles: {} };
    sdt.prepareNaiCharData(null);
}
reset();
test('black-and-white schemas request separate views; color and custom modes do not', () => {
    for (const style of ['monochrome', 'soft_color', 'custom']) {
        settings._mangaMode.style = style;
        const slot = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters.properties.segments.items.properties.panels.items.properties.characters.items;
        assert.equal(!!slot.properties.render, style === 'monochrome');
        assert.equal(!!RBQ.api.mangaProtocol.outputSchema().segments[0].panels[0].characters[0].render, style === 'monochrome');
        assert.ok(!slot.required.includes('render'), 'unchanged appearances can omit views');
        assert.equal(slot.properties.state.type, 'object');
        assert.equal(slot.properties.state.properties.base.type, 'string');
        assert.equal(slot.properties.state.properties.outfit.type, 'string');
    }
    reset();
});
test('prompt delegates whole-page grayscale to the same analysis and preserves original memory', () => {
    const bw = manga.buildMangaSystemPrompt(settings._mangaMode);
    for (const expected of ['一次解析统一完成灰阶转译', 'render:{base,outfit}', '省略 render', '国籍、年龄、身高', 'non_character', '避免色温染色']) assert.ok(bw.includes(expected), expected);
    assert.doesNotMatch(bw, /最终请求中转换已识别|由最终发送层处理/);
    const color = manga.buildMangaSystemPrompt({ ...settings._mangaMode, style: 'soft_color' });
    assert.doesNotMatch(color, /首次出场输出 render/);
});
test('one gray view is reused across panels and pages without modifying input originals', () => {
    const raw = [page([first(), {}]), page([{}])], before = JSON.stringify(raw);
    const pages = resolve(raw), captions = pages.flatMap(compile);
    assert.equal(JSON.stringify(raw), before);
    for (const p of pages) for (const panel of p.panels) {
        const c = panel.characters[0];
        assert.equal(c.base, 'Mina (original), ' + originalBase); assert.equal(c.outfit, originalOutfit);
        assert.equal(c.render.base, 'Mina (original), ' + grayBase); assert.equal(c.render.outfit, grayOutfit);
        assert.ok(!Object.keys(c._mangaAppearance).includes('render'));
    }
    assert.ok(captions.every(c => c === captions[0]));
    assert.ok(captions[0].includes(grayOutfit)); assert.ok(!captions[0].includes('blonde hair'));
    pages[1].panels[0].characters[0].render.outfit = 'manually edited';
    assert.equal(pages[0].panels[0].characters[0].render.outfit, grayOutfit, 'snapshots do not share mutable objects');
});
test('unchanged original appearance cannot drift when the model repeats a different view', () => {
    const [p] = resolve([page([first(), { render: { base: 'girl, white hair', outfit: 'black suit' } }])]);
    assert.deepEqual(clone(compile(p)), [compile(p)[0], compile(p)[0]]);
});
test('saved original memory wins over re-guessed base while its gray view serves only this image', () => {
    const refs = [{ name: 'Mina', base: originalBase, outfit: originalOutfit }];
    const [p] = resolve([page([{ base: 'wrong guessed face', render: first().render }])], refs);
    assert.equal(p.panels[0].characters[0].base, 'Mina (original), ' + originalBase);
    assert.match(compile(p)[0], /light grey hair/); assert.doesNotMatch(compile(p)[0], /wrong guessed/);
});
test('outfit changes update only the gray outfit at that point, then inherit across pages', () => {
    const [a, b] = resolve([page([first(), { state: { outfit: 'red silk coat, black vest' }, render: { outfit: 'dark silk coat, black vest' } }]), page([{}])]);
    assert.match(compile(a)[0], /light grey trench coat/);
    assert.match(compile(a)[1], /dark silk coat, black vest/);
    assert.equal(compile(a)[1], compile(b)[0]);
    assert.equal(a.panels[1].characters[0].outfit, 'red silk coat, black vest');
    assert.doesNotMatch(compile(a)[1], /trench|red silk/);
});
test('temporary appearance changes replace gray base without touching permanent originals', () => {
    const changed = { state: { base: originalBase.replace('long blonde hair', 'short red hair') }, render: { base: grayBase.replace('long light grey hair', 'short dark hair') } };
    const [p] = resolve([page([first(), changed, {}])]);
    assert.match(compile(p)[0], /long light grey hair/);
    for (const c of compile(p).slice(1)) { assert.match(c, /short dark hair/); assert.doesNotMatch(c, /long light grey hair|red hair/); }
    assert.match(p.panels[2].characters[0]._mangaAppearance.base, /long blonde hair/);
    assert.match(p.panels[2].characters[0]._mangaAppearance.render_base, /short red hair/);
    assert.equal(p.panels[2].characters[0].render.outfit, grayOutfit);
});
test('explicit removal clears both outfits and later restore requires a new gray outfit', () => {
    const [p] = resolve([page([first(), { state: { outfit: '' }, render: { outfit: '' } }, {}])]);
    for (const c of p.panels.slice(1).map(p => p.characters[0])) { assert.equal(c.outfit, ''); assert.equal(c.render.outfit, ''); }
    assert.throws(() => resolve([page([first(), { state: { outfit: '' } }, { outfit: originalOutfit }])]), /render.outfit/);
});
test('missing initial or changed gray fields fail before any memory is saved', () => {
    reset();
    for (const people of [
        [{ base: originalBase, outfit: originalOutfit }],
        [first(), { state: { outfit: 'red coat' } }],
        [first(), { state: { base: originalBase.replace('blonde', 'red') } }],
        [first(), { state: { outfit: 'red coat' }, render: { outfit: '' } }]
    ]) {
        const context = sdt.captureMangaRequestContext(null, 1), before = JSON.stringify(sdt.getCharacterProfiles());
        assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page(people)] }, [], context), /render\.(base|outfit)/);
        assert.equal(JSON.stringify(sdt.getCharacterProfiles()), before);
    }
});
test('malformed render fields and embedded dialogue never enter compiler or memory', () => {
    for (const render of [null, [], 'gray', { base: ['girl'] }, { outfit: 'Text: 测试' }]) {
        assert.throws(() => resolve([page([{ ...first(), render }])]), /render/);
    }
});
test('new gray parses save full-color identity, wardrobe and temporal history only', () => {
    reset();
    const raw = { shouldDraw: true, segments: [page([first(), { state: { outfit: 'red coat' }, render: { outfit: 'dark coat' } }])] };
    const result = sdt.normalizeTaggerResult(raw, [], sdt.captureMangaRequestContext(null, 1));
    const profile = sdt.getCharacterProfile('Mina');
    assert.equal(profile.baseTags, 'Mina (original), ' + originalBase); assert.equal(profile.currentOutfit, 'red coat');
    assert.ok(JSON.stringify(profile).includes(originalOutfit));
    assert.doesNotMatch(JSON.stringify(profile), /light grey|dark coat|"render"/);
    assert.match(result.characters[1].caption, /dark coat/);
    assert.equal(result.mangaRenderSettings.style, 'monochrome');
    assert.equal(result.segments[0].mangaRenderSettings.style, 'monochrome');
});
test('memory disabled still reuses gray views and state within this response without creating profiles', () => {
    reset(false);
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page([first(), {}])] }, [], sdt.captureMangaRequestContext(null, 1));
    assert.equal(result.characters[0].caption, result.characters[1].caption);
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()), []);
    reset();
});
test('anonymous people have independent views despite identical generic names', () => {
    const p = page([first()]);
    p.panels[0].characters = [
        { ...p.panels[0].characters[0], name: '路人' },
        { ...p.panels[0].characters[0], character_id: 'C2', name: '路人', base: 'boy, red hair', render: { base: 'boy, dark hair', outfit: grayOutfit } }
    ];
    p.panels.push({ ...clone(p.panels[0]), id: 'P2', characters: p.panels[0].characters.map(c => ({ ...c, base: '', outfit: '', render: undefined })) });
    const [resolved] = resolve([clone(p)]);
    assert.match(compile(resolved)[2], /light grey hair/); assert.match(compile(resolved)[3], /boy, dark hair/);
});
test('fan and ordinary names, custom tags, exact facts and weights survive model gray views', () => {
    const [p] = resolve([page([{ ...first(), name: 'Alice (Example Series)', base: 'mouri ran, ' + originalBase,
        render: { base: 'mouri ran, 1.2::' + grayBase + '::', outfit: grayOutfit }, positive: 'Text: blonde hair（原文）' }])]);
    const caption = compile(p)[0];
    assert.match(caption, /2::Alice \(Example Series\)::/);
    for (const tag of ['mouri ran', 'korean', '35 years old', '180cm height', 'custom facial mark', 'layered custom clasp']) assert.ok(caption.includes(tag));
    assert.match(caption, /1.2::girl/); assert.match(caption, /Text: blonde hair（原文）$/);
});
test('color and custom modes ignore stray gray views and retain the full original captions', () => {
    for (const style of ['soft_color', 'custom']) {
        const [p] = resolve([page([first(), {}])], [], style);
        assert.equal(p.render_mode, undefined); assert.equal(p.panels[0].characters[0].render, undefined);
        assert.match(compile(p)[0], /long blonde hair, brown eyes/); assert.match(compile(p)[1], /beige trench coat/);
    }
});
test('cached views and render settings survive serialization and later UI/profile changes', () => {
    reset();
    const context = sdt.captureMangaRequestContext(null, 1);
    settings._mangaMode.style = 'soft_color';
    const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page([first()])] }, [], context);
    const cached = clone(sdt.sanitizeSdtResult(result));
    assert.equal(cached.mangaRenderSettings.style, 'monochrome');
    sdt.updateCharacterProfile('Mina', 'girl, corrected red hair', 'purple shirt');
    assert.match(compile(cached.mangaPage)[0], /long light grey hair/);
    sdt.prepareNaiCharData(cached);
    const rendered = sdtHook(payload(cached.scene));
    assert.match(rendered.input, /monochrome/); assert.match(rendered.parameters.v4_prompt.caption.char_captions[0].char_caption, /light grey trench coat/);
    assert.doesNotMatch(rendered.parameters.v4_prompt.caption.char_captions[0].char_caption, /purple shirt/);
    reset();
});
test('gray compilation and both hook orders use only model views and preserve dialogue and parameters', () => {
    const [p] = resolve([page([{ ...first(), positive: 'holding dark pen, Text: beige coat，红笔。' }])]);
    const segment = sdt.normalizeMangaSegment(p), before = JSON.stringify(p), runs = [];
    for (const order of [[sdtHook, mangaHook], [mangaHook, sdtHook]]) {
        sdt.prepareNaiCharData(segment);
        let output = payload(segment.scene); Object.assign(output.parameters, { seed: 123, steps: 23, scale: 4 });
        for (const hook of order) output = hook(output);
        runs.push(clone(output));
        assert.equal(output.parameters.seed, 123); assert.equal(output.parameters.steps, 23); assert.equal(output.model, 'nai-diffusion-4-5-full');
        const caption = output.parameters.v4_prompt.caption.char_captions[0].char_caption;
        assert.match(caption, /holding dark pen/); assert.match(caption, /Text: beige coat，红笔。$/);
        assert.doesNotMatch(caption.split('Text:')[0], /blonde|beige|blue denim/);
    }
    assert.deepEqual(runs[0], runs[1]); assert.equal(JSON.stringify(p), before);
});
test('manual caption edits clear gray and canonical hidden fields so removed details cannot return', () => {
    const segment = sdt.normalizeMangaSegment(resolve([page([first()])])[0]);
    const editedCaption = 'Mina (original), girl, deliberate red jacket, holding book';
    const values = { '.rbq-sdt-manual-char-caption': editedCaption, '.rbq-sdt-manual-char-uc': '', '.rbq-sdt-pad-x': '0.5', '.rbq-sdt-pad-y': '0.5' };
    const editor = vm.createContext({ segResult: segment, isMultiChar: true, sdtParseCoord: sdt.sdtParseCoord,
        modal: { querySelector: () => ({ value: segment.scene }), querySelectorAll: () => [{ dataset: { index: '0' }, querySelector: q => ({ value: values[q] }) }] } });
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('        function gatherUpdatedSegment('), sdtSource.indexOf('        function syncUpdatedSegmentState(')), editor);
    const edited = editor.gatherUpdatedSegment('characters');
    assert.equal(compile(edited.mangaPage)[0], editedCaption);
    assert.equal(edited.mangaPage.panels[0].characters[0].render, undefined);
});
test('Studio flattens gray views and drops all hidden canonical and gray fields before editing', () => {
    const [resolved] = resolve([page([first()])]);
    const panel = manga.studioPanelFromProtocol(resolved.panels[0]);
    assert.match(panel.characters[0].positive, /light grey trench coat/); assert.doesNotMatch(panel.characters[0].positive, /beige|blonde/);
    for (const field of ['render', 'base', 'outfit', 'state', '_mangaAppearance', '_mangaInitialAppearance']) assert.equal(panel.characters[0][field], undefined);
    panel.characters[0].positive = 'Mina (original), girl, edited green shirt, standing';
    settings._mangaMode.studio.panels = [panel];
    assert.match(manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode)).characters[0].caption, /edited green shirt/);
});
test('legacy cached captions are kept intact and are never reinterpreted through a color word list', () => {
    const legacy = page([{ positive: 'girl, blonde hair, red coat, Text: blue eyes' }]);
    delete legacy.panels[0].characters[0].base; delete legacy.panels[0].characters[0].outfit;
    const [p] = resolve([legacy]);
    assert.match(compile(p)[0], /blonde hair, red coat/);
    const output = mangaHook(payload('comic, warm light', [{ char_caption: compile(p)[0] }]));
    assert.match(output.input, /warm light/); assert.match(output.parameters.v4_prompt.caption.char_captions[0].char_caption, /Text: blue eyes$/);
});
(async () => {
    async function asyncTest(name, run) { await run(); console.log('PASS ' + name); passed++; }
    await asyncTest('Studio gray analysis uses one model request, snapshots its style and never writes memory', async () => {
        reset(); Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', squashMessages: false });
        sdt.updateCharacterProfile('Mina', originalBase, originalOutfit);
        const before = JSON.stringify(sdt.getCharacterProfiles()); let calls = 0, release;
        manga.fetch = async (_url, options) => {
            calls++; const body = JSON.parse(options.body); assert.ok(body.messages[0].content.includes('render:{base,outfit}'));
            return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ panels: page([first(), {}]).panels }) } }] }) }); });
        };
        const pending = manga.requestStudioPanels(settings._mangaMode, 'two panels', 'ordinary story', 2);
        settings._mangaMode.style = 'soft_color'; release(); const panels = await pending;
        assert.equal(calls, 1); assert.match(panels[0].characters[0].positive, /light grey trench coat/);
        assert.equal(panels[0].characters[0].positive, panels[1].characters[0].positive);
        assert.equal(JSON.stringify(sdt.getCharacterProfiles()), before); reset();
    });
    await asyncTest('SDT gray refinement keeps original metadata, applies gray snapshots and does not update memory', async () => {
        reset(); Object.assign(settings._smartDrawTrigger, { provider: 'custom', customUrl: 'https://test.invalid' });
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function runSegmentAiRefinement('), sdtSource.indexOf('    function setCardLoadingState(')), sdt);
        sdt.checkUrlSafety = () => {}; sdt.safeReadJsonResponse = async response => response.json();
        sdt.updateCharacterProfile('Mina', originalBase, originalOutfit); const before = JSON.stringify(sdt.getCharacterProfiles());
        const response = page([first(), { state: { outfit: 'red coat' }, render: { outfit: 'dark coat' } }]); let calls = 0;
        sdt.smartFetch = async (_url, options) => { calls++; assert.ok(JSON.parse(options.body).messages[0].content.includes('render:{base,outfit}'));
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) }; };
        const result = await sdt.runSegmentAiRefinement(sdt.normalizeMangaSegment(resolve([page([first()])])[0]), '换上红外套');
        assert.equal(calls, 1); assert.match(result.characters[1].caption, /dark coat/); assert.equal(result.mangaRenderSettings.style, 'monochrome');
        assert.equal(JSON.stringify(sdt.getCharacterProfiles()), before);
    });
    await asyncTest('automatic custom HTTP, OpenAI JSON and tool paths return gray views in one request', async () => {
        reset();
        Object.assign(settings._smartDrawTrigger, { provider: 'custom', customUrl: 'https://test.invalid', openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', squashMessages: false });
        Object.assign(sdt, { getMessageSnapshot: () => ({ mes: '她递出信封，等他接过。' }), checkUrlSafety() {}, logTaggerPayload() {},
            validateStructuredResult: result => result, safeReadJsonResponse: async response => response.json() });
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('), sdtSource.indexOf('    function visibleTextNodes(')), sdt);
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callOpenAiCompatible('), sdtSource.indexOf('    async function callCustomHttp(')), sdt);
        Object.assign(sdt, { normalizeBaseUrl: value => value, getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {},
            buildThinkingParams: () => ({}), DRAW_SPEC_TOOL_RULE: 'Submit via generate_draw_spec' });
        for (const mode of ['custom', 'json', 'tool']) {
            let calls = 0;
            settings._smartDrawTrigger.provider = mode === 'custom' ? 'custom' : 'openai';
            settings._smartDrawTrigger.toolCallMode = mode === 'tool';
            const respond = body => {
                calls++;
                const request = mode === 'custom' ? body : JSON.parse(body.messages[1].content);
                assert.ok(request.outputSchema.segments[0].panels[0].characters[0].render);
                const reply = { shouldDraw: true, segments: [page([first(), {}])] };
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => mode === 'custom' ? reply : ({ choices: [{ message: mode === 'tool'
                    ? { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(reply) } }] }
                    : { content: JSON.stringify(reply) } }] }) };
            };
            sdt.smartFetch = async (_url, options) => respond(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => respond(body);
            const result = await sdt.callTagger(1, { type: 'auto' });
            assert.equal(calls, 1); assert.match(result.characters[0].caption, /light grey trench coat/);
            assert.equal(result.characters[0].caption, result.characters[1].caption);
            assert.match(sdt.getCharacterProfile('Mina').baseTags, /blonde hair/);
        }
    });
    console.log(`\n${passed} manga grayscale rendering tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
