/** Studio draft appearance persistence and local polishing. Neutral adult office scenes; no live services. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0, failed = 0;
async function test(name, run) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

const originalBase = 'Ada (original), japanese, girl, adult, 35 years old, 180cm height, blonde hair, brown eyes';
const originalOutfit = 'white shirt, red coat, black trousers';
const grayBase = 'Ada (original), japanese, girl, adult, 35 years old, 180cm height, light hair, dark eyes';
const grayOutfit = 'light shirt, dark coat, black trousers';
const bubble = text => ({ type: 'speech', position: 'right-upper', layout: 'horizontal', text });
function scene(mode = 'structured', monochrome = false) {
    return {
        page: { base: 'comic, 2 panels, 1girl, reading path top to bottom', non_character: '', ...(mode === 'structured' ? { bubbles: [] } : {}) },
        panels: [0, 1].map(index => ({
            id: `P${index + 1}`, title: index ? '等待读信' : '递信', desc: index ? '艾达等待读信。' : '艾达在办公室拿着信封。',
            position: index ? 'bottom wide panel' : 'top wide panel', shot: index ? 'close-up' : 'medium shot',
            description: 'office, wooden desk, window', non_character: '', ...(mode === 'structured' ? { bubbles: [] } : {}),
            characters: [{ character_id: 'C1', name: 'Ada (original)', name_tag: 'Ada (original)', base: originalBase,
                outfit: originalOutfit, positive: 'standing, holding envelope, looking toward Ben' + (mode === 'legacy'
                    ? ', BubbleType: 通常吹き出し, 右上, Layout: 横書き\nText: 我等你回答。' : ''),
                negative: 'extra fingers', ...(mode === 'structured' ? { bubbles: [bubble('我等你回答。')] } : {}),
                ...(monochrome ? { render: { base: grayBase, outfit: grayOutfit } } : {}) }]
        }))
    };
}
function host(mode = 'structured', monochrome = false) {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ};')(require, __dirname);
    const { manga, settings, RBQ } = env;
    const store = settings._mangaMode, studio = store.studio;
    Object.assign(store, { dialogueMode: mode, style: monochrome ? 'monochrome' : 'soft_color', grammar: 'cinema', language: 'zh-hans' });
    Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture', toolCallMode: true });
    Object.assign(studio, { ratio: '832x1216', useChatChars: false, page: null, pageLayoutSignature: '' });
    let answer = scene(mode, monochrome);
    const calls = [];
    RBQ.api.callStructuredCompletion = async args => {
        calls.push(args); return { rawReply: JSON.stringify(answer) };
    };
    const respond = value => { answer = value; };
    const apply = result => {
        studio.panels = result; manga.applyStudioPagePlan(store, result, true);
    };
    const parse = async () => {
        const result = await manga.requestStudioPanels(store, '规划两格办公室递信页。', '艾达拿着信封，等待本回答。', 2);
        apply(result); return result;
    };
    const compile = () => manga.compileMangaPage(manga.buildStudioPage(store));
    const single = (index = 0) => manga.callLlmSingleSentenceExpander(studio.panels[index].desc, studio.panels[index].shot,
        store.grammar, store.language, studio.panels, index);
    const batch = () => manga.callLlmBatchSentenceExpander(studio.panels, store.grammar, store.language);
    const editedAnswer = () => {
        const result = scene(mode, monochrome); result.panels = [result.panels[0]];
        const person = result.panels[0].characters[0];
        person.base = ''; person.outfit = ''; person.positive = 'looking down, resting right hand on desk';
        delete person.render;
        if (mode === 'structured') person.bubbles = [];
        return result;
    };
    const inputOfLastCall = () => {
        let input = JSON.parse(calls.at(-1).messages.at(-1).content);
        if (typeof input.currentMessage === 'string' && input.currentMessage.trim().startsWith('{')) input = JSON.parse(input.currentMessage);
        return input;
    };
    return { ...env, store, studio, calls, respond, apply, parse, compile, single, batch, editedAnswer, inputOfLastCall };
}

(async () => {
    for (const mode of ['structured', 'legacy']) {
        await test(`${mode} parsing retains complete original appearance separately from the flattened draft`, async () => {
            const h = host(mode); await h.parse(); const person = h.studio.panels[0].characters[0];
            assert.equal(person._studioAppearance.base, originalBase);
            assert.equal(person._studioAppearance.outfit, originalOutfit);
            assert.match(person.positive, /holding envelope/);
            assert.equal(person.base, undefined, 'flattened editor captions must not double-add raw base');
            assert.equal(person.outfit, undefined, 'flattened editor captions must not double-add raw outfit');
            const result = h.compile();
            assert.equal(result.characters[0].caption.match(/white shirt/g)?.length, 1);
            assert.equal(result.characters[0].caption.match(/35 years old/g)?.length, 1);
            assert.equal(h.manga.splitMangaText(result.characters[0].caption, false).text, '我等你回答。');
        });
        await test(`${mode} single polish reuses omitted base/outfit and keeps only the newly returned action/text`, async () => {
            const h = host(mode); await h.parse(); const before = clone(h.studio.panels);
            h.respond(h.editedAnswer()); const result = await h.single();
            for (const token of ['Ada (original)', 'japanese', '35 years old', '180cm height', 'blonde hair', 'brown eyes', 'white shirt', 'red coat', 'black trousers'])
                assert.ok(result.characters[0].positive.includes(token), 'lost existing source field: ' + token);
            assert.match(result.characters[0].positive, /looking down, resting right hand on desk/);
            assert.doesNotMatch(result.characters[0].positive, /holding envelope|looking toward Ben|我等你回答/);
            assert.equal(h.manga.splitMangaText(result.characters[0].positive, false).text, '');
            assert.deepEqual(clone(h.studio.panels), before, 'returning a polished panel must not publish over the current draft');
            assert.equal(h.calls.length, 2, 'no extra model request is necessary for known appearance');
        });
        await test(`${mode} single polish sends its complete current panel independently from continuity panels`, async () => {
            const h = host(mode); await h.parse(); h.respond(h.editedAnswer()); await h.single(1);
            const input = h.inputOfLastCall();
            assert.equal(input.currentPanel.id, h.studio.panels[1].id);
            assert.equal(input.currentPanel.position, h.studio.panels[1].position);
            assert.equal(input.currentPanel.characters[0].base, originalBase);
            assert.equal(input.currentPanel.characters[0].outfit, originalOutfit);
            assert.match(input.currentPanel.characters[0].positive, /holding envelope/);
            assert.doesNotMatch(input.currentPanel.characters[0].positive, /180cm height|white shirt|red coat/);
            assert.equal(h.manga.mangaCaptionParts(input.currentPanel.characters[0].positive,
                input.currentPanel.characters[0].bubbles, 'C1', false).text, '我等你回答。');
            assert.equal(input.currentPanel.characters[0]._studioAppearance, undefined);
            assert.equal(input.otherPanels.length, 1);
            assert.equal(input.otherPanels[0].id, h.studio.panels[0].id);
            assert.equal(input.currentIndex, 1);
            assert.equal(input.currentMessage, h.studio.panels[1].desc);
        });
        await test(`${mode} saved source survives settings JSON reload and another local polish`, async () => {
            const h = host(mode); await h.parse(); h.store.studio = clone(h.studio);
            const draft = h.store.studio.panels; h.respond(h.editedAnswer());
            const result = await h.manga.callLlmSingleSentenceExpander(draft[0].desc, draft[0].shot,
                h.store.grammar, h.store.language, draft, 0);
            assert.match(result.characters[0].positive, /180cm height/);
            assert.match(result.characters[0].positive, /red coat/);
            assert.equal(result.characters[0]._studioAppearance.base, originalBase);
            assert.equal(result.characters[0]._studioAppearance.outfit, originalOutfit);
        });
        await test(`${mode} batch polish preserves each panel's actual clothing instead of a shared default`, async () => {
            const h = host(mode), original = scene(mode);
            original.panels[1].characters[0].outfit = 'blue cardigan, black trousers';
            h.respond(original); await h.parse(); const answer = scene(mode);
            for (const panel of answer.panels) {
                const person = panel.characters[0]; person.base = ''; person.outfit = '';
                person.positive = 'looking down'; if (mode === 'structured') person.bubbles = [];
            }
            h.respond(answer); const result = await h.batch();
            assert.match(result[0].characters[0].positive, /red coat/);
            assert.match(result[1].characters[0].positive, /blue cardigan/);
            assert.doesNotMatch(result[1].characters[0].positive, /red coat|我等你回答|holding envelope/);
            assert.equal(h.calls.length, 2);
        });
        await test(`${mode} explicitly provided new appearance takes precedence over the saved source`, async () => {
            const h = host(mode); await h.parse(); const answer = h.editedAnswer();
            answer.panels[0].characters[0].base = 'Ada (original), girl, adult, brown hair, green eyes';
            answer.panels[0].characters[0].outfit = 'blue cardigan, white trousers'; h.respond(answer);
            const result = await h.single();
            assert.match(result.characters[0].positive, /brown hair, green eyes/);
            assert.match(result.characters[0].positive, /blue cardigan, white trousers/);
            assert.doesNotMatch(result.characters[0].positive, /blonde hair|red coat|black trousers/);
        });
        await test(`${mode} an explicit empty outfit state does not restore prior clothing`, async () => {
            const h = host(mode); await h.parse(); const answer = h.editedAnswer();
            answer.panels[0].characters[0].state = { outfit: '' }; h.respond(answer);
            const result = await h.single();
            assert.equal(result.characters[0]._studioAppearance.outfit, '');
            assert.match(result.characters[0].positive, /blonde hair/);
            assert.doesNotMatch(result.characters[0].positive, /white shirt|red coat|black trousers/);
        });
        for (const mismatch of ['name', 'character_id']) {
            await test(`${mode} a changed ${mismatch} cannot inherit another identity's saved appearance`, async () => {
                const h = host(mode); await h.parse(); const answer = h.editedAnswer();
                answer.panels[0].characters[0][mismatch] = mismatch === 'name' ? 'Eva (original)' : 'C99';
                if (mismatch === 'name') answer.panels[0].characters[0].name_tag = 'Eva (original)';
                h.respond(answer); const result = await h.single();
                assert.doesNotMatch(result.characters[0].positive, /blonde hair|brown eyes|white shirt|red coat|180cm height/);
            });
        }
        await test(`${mode} a literal text-only edit retains source metadata, while a manual visual edit invalidates it`, async () => {
            const h = host(mode); await h.parse(); const person = h.studio.panels[0].characters[0];
            h.manga.updateStudioVisualCaption(person, 'positive', person.positive.replace('我等你回答。', '请慢慢看。'));
            assert.ok(person._studioAppearance, 'text editing must not discard original appearance');
            assert.equal(person._studioAppearance.base, originalBase);
            assert.equal(person._studioAppearance.outfit, originalOutfit);
            h.manga.updateStudioVisualCaption(person, 'positive', person.positive.replace('red coat', 'blue cardigan'));
            assert.equal(person._studioAppearance, undefined, 'a manually changed drawing view no longer matches its old source');
            assert.match(person.positive, /blue cardigan/);
            assert.equal(h.manga.splitMangaText(person.positive, false).text, '请慢慢看。');
        });
    }
    await test('grayscale source metadata retains original colors without writing character profiles', async () => {
        const h = host('structured', true), before = clone(h.settings._smartDrawTrigger.characterProfiles || {}); await h.parse();
        const person = h.studio.panels[0].characters[0];
        assert.equal(person._studioAppearance.base, originalBase); assert.equal(person._studioAppearance.outfit, originalOutfit);
        assert.equal(person._studioAppearance.render.base, grayBase); assert.equal(person._studioAppearance.render.outfit, grayOutfit);
        assert.match(person.positive, /light hair, dark eyes/); assert.match(person.positive, /dark coat/);
        assert.doesNotMatch(person.positive, /blonde hair|brown eyes|red coat/);
        assert.deepEqual(clone(h.settings._smartDrawTrigger.characterProfiles || {}), before);
    });
    await test('a grayscale local polish can reuse the exact source view without an extra model call', async () => {
        const h = host('structured', true); await h.parse(); h.respond(h.editedAnswer()); const result = await h.single();
        assert.match(result.characters[0].positive, /light hair, dark eyes/); assert.match(result.characters[0].positive, /dark coat/);
        assert.doesNotMatch(result.characters[0].positive, /red coat|holding envelope|我等你回答/);
        assert.equal(result.characters[0]._studioAppearance.base, originalBase); assert.equal(h.calls.length, 2);
    });
    await test('a newly changed outfit cannot borrow the grayscale view of the old outfit', async () => {
        const h = host('structured', true); await h.parse(); const answer = h.editedAnswer();
        answer.panels[0].characters[0].outfit = 'blue cardigan';
        answer.panels[0].characters[0].render = { base: grayBase, outfit: 'mid-tone cardigan' }; h.respond(answer);
        const result = await h.single();
        assert.match(result.characters[0].positive, /mid-tone cardigan/); assert.doesNotMatch(result.characters[0].positive, /dark coat|red coat/);
        assert.equal(result.characters[0]._studioAppearance.outfit, 'blue cardigan');
    });
    await test('an omitted new outfit render preserves its exact new source instead of recycling the old gray coat', async () => {
        const h = host('structured', true); await h.parse(); const answer = h.editedAnswer();
        answer.panels[0].characters[0].outfit = 'blue cardigan'; h.respond(answer);
        const result = await h.single();
        assert.match(result.characters[0].positive, /blue cardigan/);
        assert.doesNotMatch(result.characters[0].positive, /dark coat|red coat/);
        assert.equal(result.characters[0]._studioAppearance.render?.outfit, undefined,
            'a missing render fallback must not become a confirmed gray view');
    });
    await test('an explicit empty structured dialogue remains cleared even if the response also contains old Text', async () => {
        const h = host(); await h.parse(); const answer = h.editedAnswer();
        answer.panels[0].characters[0].positive += ', BubbleType: 通常吹き出し, Layout: 横書き\nText: 我等你回答。';
        h.respond(answer); const result = await h.single();
        assert.equal(h.manga.splitMangaText(result.characters[0].positive, false).text, '');
        assert.deepEqual(clone(result.characters[0].bubbles), []);
        assert.match(result.characters[0].positive, /white shirt/);
    });
    await test('batch polishing preserves later temporary appearance changes without bringing them into earlier panels', async () => {
        const h = host(), initial = scene();
        const laterBase = originalBase.replace('blonde hair', 'short blonde hair');
        initial.panels[1].characters[0].state = { base: laterBase };
        h.respond(initial); await h.parse(); const answer = scene();
        for (const panel of answer.panels) {
            panel.characters[0].base = ''; panel.characters[0].outfit = '';
            panel.characters[0].positive = 'looking down'; panel.characters[0].bubbles = [];
        }
        h.respond(answer); const result = await h.batch();
        assert.doesNotMatch(result[0].characters[0].positive, /short blonde hair/);
        assert.match(result[1].characters[0].positive, /short blonde hair/);
        assert.match(result[1].characters[0].positive, /35 years old/);
    });
    await test('switching to color and reparsing restores original colors from the retained source', async () => {
        const h = host('structured', true); await h.parse(); h.store.style = 'soft_color'; h.respond(h.editedAnswer());
        const result = await h.single();
        assert.match(result.characters[0].positive, /blonde hair, brown eyes/); assert.match(result.characters[0].positive, /red coat/);
        assert.doesNotMatch(result.characters[0].positive, /light hair|dark eyes|dark coat/);
    });
    await test('switching to grayscale and reparsing uses the returned view for existing original appearance', async () => {
        const h = host(); await h.parse(); h.store.style = 'monochrome'; const answer = h.editedAnswer();
        answer.panels[0].characters[0].render = { base: grayBase, outfit: grayOutfit }; h.respond(answer);
        const result = await h.single();
        assert.match(result.characters[0].positive, /light hair, dark eyes/); assert.match(result.characters[0].positive, /dark coat/);
        assert.doesNotMatch(result.characters[0].positive, /blonde hair|brown eyes|red coat/);
        assert.equal(result.characters[0]._studioAppearance.outfit, originalOutfit);
    });
    await test('appearance fallback freezes the starting draft rather than reading edits made during the request', async () => {
        const h = host(); await h.parse(); const answer = h.editedAnswer(); let finish;
        h.RBQ.api.callStructuredCompletion = () => new Promise(resolve => { finish = () => resolve({ rawReply: JSON.stringify(answer) }); });
        const pending = h.single(); const person = h.studio.panels[0].characters[0];
        person._studioAppearance.outfit = 'yellow jacket'; person.positive = person.positive.replace('red coat', 'yellow jacket');
        finish(); const result = await pending;
        assert.match(result.characters[0].positive, /red coat/); assert.doesNotMatch(result.characters[0].positive, /yellow jacket/);
        assert.match(person.positive, /yellow jacket/, 'returning a result must not overwrite the current editor');
    });
    for (const [field, value, message] of [
        ['base', {}, /base 字段必须是字符串/],
        ['name', {}, /name 字段必须是字符串/],
        ['state', [], /人物状态必须是对象/],
        ['characters', {}, /characters 数组/]
    ]) {
        await test(`malformed polished ${field} rejects with its existing useful format diagnostic`, async () => {
            const h = host(); await h.parse(); const before = clone(h.studio.panels), answer = h.editedAnswer();
            if (field === 'characters') answer.panels[0].characters = value;
            else answer.panels[0].characters[0][field] = value;
            h.respond(answer);
            await assert.rejects(h.single(), message);
            assert.deepEqual(clone(h.studio.panels), before);
            assert.equal(h.calls.length, 2);
        });
    }
    console.log(`\n${passed} Studio appearance tests passed${failed ? `, ${failed} failed` : ''}.`);
    if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
