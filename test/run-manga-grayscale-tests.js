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
const parse = (people, messageId = 1) => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page(people)] }, [], sdt.captureMangaRequestContext(null, messageId));
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
test('explicit removal clears both outfits and restores the earlier exact gray outfit', () => {
    const [p] = resolve([page([first(), { state: { outfit: '' }, render: { outfit: '' } }, {}])]);
    for (const c of p.panels.slice(1).map(p => p.characters[0])) { assert.equal(c.outfit, ''); assert.equal(c.render.outfit, ''); }
    const [restored] = resolve([page([first(), { state: { outfit: '' } }, { outfit: originalOutfit }])]);
    assert.equal(restored.panels[2].characters[0].render.outfit, grayOutfit);
    assert.deepEqual(clone(manga.compileMangaPage(restored).warnings), []);
});
test('missing initial or changed gray fields preserve complete originals with visible warnings', () => {
    reset();
    for (const people of [
        [{ base: originalBase, outfit: originalOutfit }],
        [first(), { state: { outfit: 'red coat' } }],
        [first(), { state: { base: originalBase.replace('blonde', 'red') } }],
        [first(), { state: { outfit: 'red coat' }, render: { outfit: '' } }]
    ]) {
        reset();
        const result = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page(people)] }, [], sdt.captureMangaRequestContext(null, 1));
        assert.ok(result.renderWarnings.some(w => /render\.(base|outfit)/.test(w)));
        assert.match(result.reason, /可能残留颜色/);
        const last = result.segments[0].mangaPage.panels.at(-1).characters[0];
        const field = people.length === 1 || people.at(-1).state?.base ? 'base' : 'outfit';
        assert.equal(last.render[field], last[field], 'fallback is the complete current source');
        assert.match(sdt.getCharacterProfile('Mina').baseTags, /long blonde hair/);
        assert.doesNotMatch(JSON.stringify(sdt.getCharacterProfile('Mina')), /light grey hair|"render"/);
    }
});
test('a later view fills an earlier omission only for the identical source', () => {
    const [a, b] = resolve([page([{ base: originalBase, outfit: originalOutfit },
        { state: { outfit: 'red raincoat' }, render: { outfit: 'dark raincoat' } }]),
        page([{ state: { outfit: originalOutfit }, render: first().render }])]);
    assert.equal(a.panels[0].characters[0].render.outfit, grayOutfit);
    assert.equal(a.panels[1].characters[0].render.outfit, 'dark raincoat');
    assert.equal(a.panels[0].characters[0].render.base, b.panels[0].characters[0].render.base);
    assert.deepEqual(clone(manga.compileMangaPage(a).warnings), []);
});
test('missing changed view cannot borrow a different outfit and warns once per source per page', () => {
    const [p] = resolve([page([first(), { state: { outfit: 'red raincoat, custom clasp' } }, {}, {}])]);
    for (const c of p.panels.slice(1).map(p => p.characters[0])) {
        assert.equal(c.render.outfit, 'red raincoat, custom clasp');
        assert.equal(c.render.base, 'Mina (original), ' + grayBase);
        assert.doesNotMatch(manga.compileMangaPage(p).characters[1].caption, /trench coat/);
    }
    assert.equal(manga.compileMangaPage(p).warnings.length, 1);
    assert.equal(manga.compileMangaPage(clone(p)).warnings.length, 1, 'warning survives cached redraw');
});
test('null render objects and fields follow the missing-view fallback', () => {
    for (const render of [null, { base: null, outfit: null }, {}]) {
        const [p] = resolve([page([{ ...first(), render }])]);
        assert.equal(p.panels[0].characters[0].render.base, 'Mina (original), ' + originalBase);
        assert.equal(p.panels[0].characters[0].render.outfit, originalOutfit);
        assert.equal(manga.compileMangaPage(p).warnings.length, 2);
    }
});
test('malformed render fields and embedded dialogue never enter compiler or memory', () => {
    for (const render of [[], 'gray', { base: ['girl'] }, { outfit: 'Text: 测试' }]) {
        assert.throws(() => resolve([page([{ ...first(), render }])]), /render/);
    }
});
test('gray source lookup stays scoped to identity even when another character has the same clothes', () => {
    const p = page([first()]);
    p.panels[0].characters.push({ ...first(), character_id: 'C2', name: 'Other (original)', positive: 'sitting', negative: '', render: {} });
    const [resolved] = resolve([p]);
    assert.equal(resolved.panels[0].characters[0].render.outfit, grayOutfit);
    assert.equal(resolved.panels[0].characters[1].render.outfit, originalOutfit);
    assert.equal(manga.compileMangaPage(resolved).warnings.length, 2);
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
test('persistent gray cache survives settings reload and a later parse can omit both views', () => {
    reset(); const firstResult = parse([first()]);
    const canonicalBefore = JSON.stringify(sdt.getCharacterProfiles());
    assert.equal(sdt.getMangaRenderCacheRows().length, 2);
    settings._smartDrawTrigger = clone(settings._smartDrawTrigger);
    const context = sdt.captureMangaRequestContext(null, 2);
    assert.equal(context.references[0].render.outfit, grayOutfit);
    const next = parse([{}], 2);
    assert.equal(next.characters[0].caption, firstResult.characters[0].caption);
    assert.equal(next.renderWarnings, undefined);
    assert.equal(sdt.getMangaRenderCacheRows().length, 2);
    assert.doesNotMatch(canonicalBefore + JSON.stringify(sdt.getCharacterProfiles()), /light grey|"render"/);
    assert.equal(next.segments[0].mangaPage.panels[0].characters[0]._mangaRenderFallbackFields, undefined);
});
test('request payload and field contract expose current matching cached views', () => {
    reset(); parse([first()]);
    const request = sdt.buildRequestPayload(2, { type: 'auto' }).payload;
    assert.equal(request.characterMemory[0].render.outfit, grayOutfit);
    assert.ok(manga.buildMangaSystemPrompt(settings._mangaMode).includes('首次指本次响应内'));
    const slot = RBQ.api.mangaProtocol.segmentSchema().properties.panels.items.properties.characters.items;
    assert.ok(slot.properties.render.description.includes('characterMemory.render'));
});
test('changed clothing caches only the new outfit and old clothing can be restored across responses', () => {
    reset(); parse([first()]);
    const next = parse([{ state: { outfit: 'red raincoat' }, render: { outfit: 'dark raincoat' } }], 2);
    assert.match(next.characters[0].caption, /dark raincoat/);
    assert.equal(sdt.getMangaRenderCacheRows().length, 3);
    assert.equal(sdt.getMangaMemoryReferences(3)[0].render.outfit, 'dark raincoat');
    const restored = parse([{ state: { outfit: originalOutfit } }], 3);
    assert.ok(restored.characters[0].caption.includes(grayOutfit));
    assert.equal(restored.renderWarnings, undefined);
});
test('uncached originals used as fallback are never promoted to valid gray cache entries', () => {
    reset(); parse([first()]);
    const next = parse([{ state: { outfit: 'red raincoat' } }], 2);
    assert.match(next.reason, /render.outfit/);
    assert.equal(sdt.getMangaRenderCacheRows().length, 2);
    assert.equal(sdt.getMangaMemoryReferences(3)[0].render.outfit, undefined);
    assert.equal(sdt.getMangaMemoryReferences(3)[0].render.base, 'Mina (original), ' + grayBase);
});
test('tag reordering and whitespace reuse views without changing original source tags or weights', () => {
    reset(); parse([first()]);
    const reordered = originalOutfit.split(', ').reverse().join(' ,  ');
    const next = parse([{ outfit: reordered }], 2);
    assert.equal(next.segments[0].mangaPage.panels[0].characters[0].outfit, reordered);
    assert.ok(next.characters[0].caption.includes(grayOutfit));
    assert.equal(next.renderWarnings, undefined);
    const key = RBQ.api.mangaProtocol.appearanceSourceKey;
    assert.equal(key('1.2::red coat, blue scarf::, tall'), key(' tall, 1.2::red coat, blue scarf::'));
    assert.notEqual(key('1.2::red coat, blue scarf::, tall'), key('1.3::red coat, blue scarf::, tall'));
    assert.notEqual(key('red coat'), key('blue coat'));
});
test('reordering stable tags preserves temporary appearance and cannot cache it under the stable source', () => {
    for (const cacheInitialBase of [false, true]) {
        reset();
        const initial = first();
        if (!cacheInitialBase) delete initial.render.base;
        parse([initial]);
        const shortBase = originalBase.replace('long blonde hair', 'short red hair');
        const shortGray = grayBase.replace('long light grey hair', 'short dark hair');
        parse([{ state: { base: shortBase }, render: { base: shortGray } }], 2);
        const reordered = sdt.getCharacterProfile('Mina').baseTags.split(',').reverse().join(' ,  ');
        sdt.updateCharacterProfile('Mina', reordered, originalOutfit, null, true, { replaceBase: true });
        const next = parse([{}], 3);
        const appearance = next.segments[0].mangaPage.panels[0].characters[0];
        assert.match(appearance.base, /short red hair/);
        assert.match(appearance.render.base, /short dark hair/);
        assert.doesNotMatch(next.characters[0].caption, /long light grey hair/);
        assert.equal(next.renderWarnings, undefined);
        assert.equal(sdt.getCharacterProfile('Mina').baseTags, reordered);
        for (const row of sdt.getMangaRenderCacheRows().filter(row => row.field === 'base')) {
            assert.equal(row.source.includes('short red hair'), row.value.includes('short dark hair'));
        }
    }
    reset();
});
test('manual base correction invalidates only the affected source and ordinary modes ignore gray cache', () => {
    reset(); parse([first()]);
    sdt.updateCharacterProfile('Mina', 'Mina (original), girl, short red hair', originalOutfit, null, true, { replaceBase: true });
    const refs = sdt.getMangaMemoryReferences(2);
    assert.equal(refs[0].render.base, undefined);
    assert.equal(refs[0].render.outfit, grayOutfit);
    const corrected = parse([{}], 2);
    assert.match(corrected.characters[0].caption, /short red hair/);
    assert.doesNotMatch(corrected.characters[0].caption, /light grey hair/);
    settings._mangaMode.style = 'soft_color';
    assert.equal(sdt.getMangaRenderCacheRows().length, 0);
    assert.equal(sdt.getMangaMemoryReferences(3)[0].render, undefined);
    settings._mangaMode.style = 'monochrome'; settings._smartDrawTrigger.characterMemoryEnabled = false;
    const before = JSON.stringify(settings._smartDrawTrigger.mangaRenderCache);
    parse([first()], 3);
    assert.equal(JSON.stringify(settings._smartDrawTrigger.mangaRenderCache), before);
    reset();
});
test('cache is isolated by chat and delayed or invalid responses cannot publish entries', () => {
    reset(); parse([first()]);
    const before = JSON.stringify(settings._smartDrawTrigger.mangaRenderCache);
    const context = sdt.captureMangaRequestContext(null, 2), getChatKey = sdt.getChatKey;
    sdt.getChatKey = () => 'other-chat';
    try {
        assert.equal(sdt.getMangaRenderCacheRows().length, 0);
        assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [page([first()])] }, [], context), /聊天已切换/);
    } finally { sdt.getChatKey = getChatKey; }
    const broken = page([first()]); broken.panels[0].characters[0].render.base = ['invalid'];
    assert.throws(() => sdt.normalizeTaggerResult({ shouldDraw: true, segments: [broken] }, [], context), /render.base/);
    assert.equal(JSON.stringify(settings._smartDrawTrigger.mangaRenderCache), before);
});
test('a changed grayscale rule version invalidates old cached translations', () => {
    reset(); parse([first()]);
    settings._smartDrawTrigger.mangaRenderCache.version = 0;
    assert.equal(sdt.getMangaMemoryReferences(2)[0].render, undefined);
    assert.equal(sdt.captureMangaRequestContext(null, 2).renderCache.length, 0);
    parse([first()], 2);
    assert.equal(settings._smartDrawTrigger.mangaRenderCache.version, RBQ.api.mangaProtocol.renderCacheVersion);
    reset();
});
test('deleting a character clears only that derived cache and clearing memory clears the chat cache', () => {
    reset(); parse([first()]);
    parse([{ ...first(), name: 'Other (original)' }], 2);
    assert.equal(sdt.getMangaRenderCacheRows().length, 4);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function deleteCharacterProfile('), sdtSource.indexOf('    function renderCharacterProfileList(')), sdt);
    sdt.deleteCharacterProfile('Mina');
    assert.equal(sdt.getMangaRenderCacheRows().length, 2);
    assert.ok(sdt.getMangaRenderCacheRows().every(row => row.name === 'Other (original)'));
    sdt.clearAllCharacterProfiles();
    assert.equal(sdt.getMangaRenderCacheRows().length, 0);
    reset();
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
test('gray views reuse the confirmed English identity while keeping Chinese reference keys', () => {
    const raw = [page([{ ...first(), name:'神谷美咲', name_tag:'incorrect guessed identity' }, {name:'神谷美咲'}]), page([{name:'神谷美咲'}])];
    const before = JSON.stringify(raw);
    const refs = [{name:'神谷美咲',name_tag:'kamiya misaki (original)',base:originalBase,outfit:originalOutfit,render:first().render}];
    const pages = resolve(raw,refs);
    for (const p of pages) {
        const captions = compile(p);
        for (const [index,panel] of p.panels.entries()) {
            const c = panel.characters[0], caption = captions[index];
            assert.equal(c.name,'神谷美咲');
            assert.equal(c.name_tag,'kamiya misaki (original)');
            assert.equal(c.base,'kamiya misaki (original), ' + originalBase);
            assert.equal(c.render.base,'kamiya misaki (original), ' + grayBase);
            assert.match(caption,/kamiya misaki \(original\)/);
            assert.doesNotMatch(caption,/神谷美咲|incorrect guessed identity|long blonde hair/);
        }
    }
    assert.equal(JSON.stringify(raw),before);
});
test('Chinese-keyed identity persists through gray cache reload and temporary appearance without recoloring memory', () => {
    reset();
    const firstPerson = {...first(),name:'神谷美咲',name_tag:'kamiya misaki (original)'};
    const changedBase = originalBase.replace('long blonde hair','short red hair');
    const changedGray = grayBase.replace('long light grey hair','short dark hair');
    const result = parse([firstPerson,{name:'神谷美咲',state:{base:changedBase},render:{base:changedGray}},{name:'神谷美咲'}]);
    const profile = sdt.getCharacterProfile('神谷美咲');
    assert.equal(profile.displayName,'神谷美咲');
    assert.equal(profile.nameTag,'kamiya misaki (original)');
    assert.equal(profile.baseTags,'kamiya misaki (original), ' + originalBase);
    assert.equal(profile.currentOutfit,originalOutfit);
    assert.equal(sdt.getMangaRenderCacheRows().length,3);
    const lastCaption = result.characters.at(-1).caption;
    assert.match(lastCaption,/kamiya misaki \(original\).*short dark hair/);
    assert.doesNotMatch(lastCaption,/神谷美咲|long light grey hair|short red hair/);
    settings._smartDrawTrigger = clone(settings._smartDrawTrigger);
    const references = sdt.getMangaMemoryReferences(2);
    assert.equal(references[0].name,'神谷美咲');
    assert.equal(references[0].name_tag,'kamiya misaki (original)');
    assert.match(references[0].render.base,/short dark hair/);
    const next = parse([{name:'神谷美咲',name_tag:'another guessed identity'}],2);
    assert.equal(next.characters[0].caption,lastCaption);
    assert.equal(next.renderWarnings,undefined);
    assert.equal(sdt.getMangaRenderCacheRows().length,3);
    assert.equal(sdt.getCharacterProfile('神谷美咲').baseTags,profile.baseTags);
    assert.doesNotMatch(JSON.stringify(sdt.getCharacterProfile('神谷美咲')),/light grey hair|short dark hair|another guessed identity/);
    reset();
});
test('confirmed English identity repairs legacy Chinese tokens without discarding matching gray or temporary views', () => {
    for (const temporary of [false,true]) {
        reset();
        const oldBase = '毛利兰, ' + originalBase, oldGray = '毛利兰, ' + grayBase;
        const people = [{name:'毛利兰',base:oldBase,outfit:originalOutfit,render:{base:oldGray,outfit:grayOutfit}}];
        if (temporary) people.push({name:'毛利兰',state:{base:oldBase.replace('long blonde hair','short red hair')},
            render:{base:oldGray.replace('long light grey hair','short dark hair')}});
        parse(people);
        assert.equal(sdt.getCharacterProfile('毛利兰').baseTags,oldBase);
        const repaired = parse([{name:'毛利兰',name_tag:'mouri ran'}],2);
        const profile = sdt.getCharacterProfile('毛利兰');
        assert.equal(profile.nameTag,'mouri ran');
        assert.equal(profile.baseTags,'mouri ran, ' + originalBase);
        assert.equal(profile.previousBaseTags,oldBase);
        assert.equal(profile.currentOutfit,originalOutfit);
        assert.equal(repaired.renderWarnings,undefined);
        assert.match(repaired.characters[0].caption,/mouri ran/);
        assert.match(repaired.characters[0].caption,temporary ? /short dark hair/ : /long light grey hair/);
        assert.ok(repaired.characters[0].caption.includes(grayOutfit));
        assert.doesNotMatch(repaired.characters[0].caption,/毛利兰|long blonde hair|short red hair/);
        settings._smartDrawTrigger = clone(settings._smartDrawTrigger);
        const next = parse([{name:'毛利兰'}],3);
        assert.equal(next.characters[0].caption,repaired.characters[0].caption);
        assert.equal(next.renderWarnings,undefined);
    }
    reset();
});
test('English alias metadata supplies opening clothes to the Chinese-keyed gray appearance', () => {
    const refs = [{name:'毛利兰',name_tag:'mouri ran',base:originalBase,outfit:''}];
    const p = page([{name:'毛利兰',render:first().render}]);
    const [resolved] = RBQ.api.mangaProtocol.resolveAppearances([p],refs,
        [{name:'mouri ran',initial_outfit:originalOutfit,outfit:''}],[],{style:'monochrome'},[]);
    const c = resolved.panels[0].characters[0];
    assert.equal(c.name,'毛利兰');
    assert.equal(c.name_tag,'mouri ran');
    assert.equal(c.outfit,originalOutfit);
    assert.equal(c.render.outfit,grayOutfit);
    assert.match(compile(resolved)[0],/mouri ran.*light grey hair/);
    assert.doesNotMatch(compile(resolved)[0],/毛利兰|blonde hair|beige trench/);
    assert.deepEqual(clone(manga.compileMangaPage(resolved).warnings),[]);
});
test('bare English identity upgrades its original suffix while retaining matching gray cache', () => {
    reset();
    parse([{...first(),name:'Mina'}]);
    const bareBase = sdt.getCharacterProfile('Mina').baseTags;
    assert.equal(sdt.getCharacterProfile('Mina').nameTag,'Mina');
    const result = parse([{name:'Mina (original)'}],2);
    const profile = sdt.getCharacterProfile('Mina');
    assert.equal(profile.nameTag,'Mina (original)');
    assert.equal(profile.baseTags,'Mina (original), ' + originalBase);
    assert.equal(profile.previousBaseTags,bareBase);
    assert.equal(profile.currentOutfit,originalOutfit);
    assert.match(result.characters[0].caption,/Mina \(original\).*long light grey hair/);
    assert.ok(result.characters[0].caption.includes(grayOutfit));
    assert.equal(result.renderWarnings,undefined);
    assert.deepEqual(Object.keys(sdt.getCharacterProfiles()),['Mina']);
    settings._smartDrawTrigger = clone(settings._smartDrawTrigger);
    const next = parse([{name:'Mina'}],3);
    assert.equal(next.characters[0].caption,result.characters[0].caption);
    assert.equal(sdt.getCharacterProfile('Mina').nameTag,'Mina (original)');
    reset();
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
        for (const mode of ['custom', 'json', 'tool']) for (const omitOutfit of [false, true]) {
            delete settings._smartDrawTrigger.mangaRenderCache;
            let calls = 0;
            settings._smartDrawTrigger.provider = mode === 'custom' ? 'custom' : 'openai';
            settings._smartDrawTrigger.toolCallMode = mode === 'tool';
            const respond = body => {
                calls++;
                const request = mode === 'custom' ? body : JSON.parse(body.messages[1].content);
                assert.ok(request.outputSchema.segments[0].panels[0].characters[0].render);
                const reply = { shouldDraw: true, segments: [page([first(), {}])] };
                if (omitOutfit) delete reply.segments[0].panels[0].characters[0].render.outfit;
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => mode === 'custom' ? reply : ({ choices: [{ message: mode === 'tool'
                    ? { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(reply) } }] }
                    : { content: JSON.stringify(reply) } }] }) };
            };
            sdt.smartFetch = async (_url, options) => respond(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => respond(body);
            const result = await sdt.callTagger(1, { type: 'auto' });
            assert.equal(calls, 1);
            assert.ok(result.characters[0].caption.includes(omitOutfit ? originalOutfit : grayOutfit));
            if (omitOutfit) assert.match(result.reason, /render.outfit.*可能残留颜色/);
            assert.equal(result.characters[0].caption, result.characters[1].caption);
            assert.match(sdt.getCharacterProfile('Mina').baseTags, /blonde hair/);
        }
    });
    await asyncTest('all provider paths expose warm cache and accept omitted views with one model call', async () => {
        reset(); parse([first()]);
        Object.assign(settings._smartDrawTrigger, { customUrl: 'https://test.invalid', openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', squashMessages: false });
        for (const mode of ['custom', 'json', 'tool']) {
            let calls = 0;
            settings._smartDrawTrigger.provider = mode === 'custom' ? 'custom' : 'openai';
            settings._smartDrawTrigger.toolCallMode = mode === 'tool';
            const respond = body => {
                calls++;
                const request = mode === 'custom' ? body : JSON.parse(body.messages[1].content);
                assert.equal(request.characterMemory[0].render.outfit, grayOutfit);
                const reply = { shouldDraw: true, segments: [page([{}])] };
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => mode === 'custom' ? reply : ({ choices: [{ message: mode === 'tool'
                    ? { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(reply) } }] }
                    : { content: JSON.stringify(reply) } }] }) };
            };
            sdt.smartFetch = async (_url, options) => respond(JSON.parse(options.body));
            sdt.callApiWithJsonFallback = async (_url, _options, body) => respond(body);
            const result = await sdt.callTagger(2, { type: 'auto' });
            assert.equal(calls, 1);
            assert.ok(result.characters[0].caption.includes(grayOutfit));
            assert.equal(result.renderWarnings, undefined);
        }
        reset();
    });
    console.log(`\n${passed} manga grayscale rendering tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
