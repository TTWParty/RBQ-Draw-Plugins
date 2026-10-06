/** Studio diagnostics and the full ordinary-scene drawing pipeline. No live services. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook } = new Function('require', '__dirname',
    harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook};')(require, __dirname);
vm.runInContext('RBQ.api.getPendingSdtImageData = () => pendingNaiCharData;', sdt);
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
async function test(name, run) { await run(); console.log('PASS ' + name); passed++; }
const scene = () => ({ panels: [
    { id: 'P1', title: '递信', desc: '艾达站着递出信封，本坐着伸手接信。', position: 'top panel, wide', shot: 'medium shot',
        description: 'wooden table, office, window', non_character: '', characters: [
            { character_id: 'C1', name: 'Ada (original)', base: 'girl, adult, long black hair', outfit: 'blue shirt, black trousers',
                positive: 'standing, right hand gripping envelope, extending right arm toward Ben', negative: 'extra fingers' },
            { character_id: 'C2', name: 'Ben (original)', base: 'boy, adult, short brown hair', outfit: 'green sweater',
                positive: 'sitting, left hand reaching toward envelope, BubbleType: 通常吹き出し, Layout: 横書き, Text: 谢谢。', negative: 'extra arms' }
        ] },
    { id: 'P2', title: '收信', desc: '本把信封放在桌面上。', position: 'bottom panel, wide', shot: 'close-up on hands',
        description: 'wooden table', non_character: '', characters: [
            { character_id: 'C2', name: 'Ben (original)', base: '', outfit: '', positive: 'placing envelope flat on table', negative: 'extra arms' }
        ] }
] });
const studio = settings._mangaMode.studio;
Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'test', showTaggerDebug: true });
Object.assign(settings._mangaMode, { style: 'custom', customPositive: 'clean lineart', customNegative: '' });
const story = '艾达把信封递给坐着的本。本说谢谢，把信封放在桌上。';
RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(scene()), rawOutput: 'transport trace' });

(async () => {
    let parsed, compiled;
    await test('successful analysis exposes the actual reply on the original UI Studio instance', async () => {
        const callerStore = { ...settings._mangaMode };
        parsed = await manga.requestStudioPanels(callerStore, 'two panels', story, 2);
        assert.ok(studio._lastDebug, 'request snapshot must not swallow success diagnostics');
        assert.deepEqual(JSON.parse(studio._lastDebug.rawOutput), scene());
        assert.equal(studio._lastDebug.messages.at(-1).content, story);
        assert.equal(callerStore.studio, studio);
    });
    await test('resolved editor fields retain each actor action and inherited appearance', () => {
        assert.match(parsed[0].characters[0].positive, /right hand gripping envelope, extending right arm toward Ben/);
        assert.match(parsed[0].characters[1].positive, /left hand reaching toward envelope/);
        assert.match(parsed[0].characters[1].positive, /Text: 谢谢。$/);
        assert.match(parsed[1].characters[0].positive, /short brown hair, green sweater, placing envelope flat on table/);
        studio.panels = parsed;
        compiled = manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode));
        assert.equal(compiled.characters.length, 3);
        assert.match(compiled.base, /wooden table, office, window/);
        assert.doesNotMatch(compiled.base, /gripping envelope|Text: 谢谢/);
        assert.match(compiled.characters[0].caption, /top panel, wide, medium shot/);
        assert.match(compiled.characters[2].caption, /bottom panel, wide, close-up on hands/);
    });
    for (const contextual of [true, false]) for (const order of [[mangaHook, sdtHook], [sdtHook, mangaHook]]) {
        await test(`${contextual ? 'contextual' : 'legacy'} image request preserves all character captions (${order[0] === mangaHook ? 'manga first' : 'SDT first'})`, async () => {
            RBQ.api.generationContextVersion = contextual ? 1 : 0;
            RBQ.api.generateImage = async (prompt, reason, meta) => {
                assert.equal(reason, 'manga-workshop');
                const context = contextual ? { prompt, reason, meta } : undefined;
                let unrelated = payload('a different request');
                for (const hook of order) unrelated = hook(unrelated, contextual ? { prompt: 'a different request', meta: {} } : undefined);
                assert.equal(unrelated.parameters.v4_prompt.caption.char_captions.length, 0, 'pending characters must not enter an unrelated payload');
                let result = payload(prompt);
                for (const hook of order) result = hook(result, context);
                const captions = result.parameters.v4_prompt.caption.char_captions;
                assert.equal(captions.length, compiled.characters.length);
                captions.forEach((caption, i) => assert.equal(caption.char_caption, manga.sanitizeMangaPositivePrompt(compiled.characters[i].caption)));
                const negative = result.parameters.v4_negative_prompt.caption.char_captions;
                negative.forEach((caption, i) => assert.equal(caption.char_caption, compiled.characters[i].uc));
                assert.equal(result.parameters.width, 832);
                assert.equal(result.parameters.height, 1216);
                assert.match(result.input, /clean lineart/);
                return { url: 'fixture.png' };
            };
            const result = await sdt.generateSdtImage({ mangaPage: true, mangaUseCoords: compiled.useCoords,
                characters: compiled.characters, mangaRenderSettings: { ...RBQ.api.mangaProtocol.captureRenderSettings(), ratio: '832x1216' }
            }, compiled.base, 'manga-workshop');
            assert.equal(result.url, 'fixture.png');
        });
    }
    await test('post-JSON validation failure includes the original reply and preserves the previous successful trace', async () => {
        const previousDebug = studio._lastDebug;
        const invalid = scene(); invalid.panels[0].characters[0].positive = '';
        RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(invalid) });
        await assert.rejects(manga.requestStudioPanels(settings._mangaMode, 'two panels', story, 2), error => {
            assert.match(error.message, /正负词/);
            assert.match(error.rawOutput, /模型原始返回正文/);
            assert.match(error.rawOutput, /right hand|left hand reaching toward envelope/);
            return true;
        });
        assert.equal(studio._lastDebug, previousDebug);
    });
    await test('plain JSON completion uses the same fields and records its successful reply', async () => {
        delete RBQ.api.callStructuredCompletion;
        manga.fetch = async (_url, options) => {
            assert.equal(JSON.parse(options.body).messages.at(-1).content, story);
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(scene()) } }] }) };
        };
        const viaJson = await manga.requestStudioPanels(settings._mangaMode, 'two panels', story, 2);
        assert.deepEqual(clone(viaJson), clone(parsed));
        assert.deepEqual(JSON.parse(studio._lastDebug.rawOutput), scene());
    });
    await test('callLlmStoryboardParser selects actual page capacity and preserves strict fixed count', async () => {
        let capturedTask = '';
        let capturedExpected = null;
        manga.requestStudioPanels = async (_store, task, _content, expectedCount) => {
            capturedTask = task;
            capturedExpected = expectedCount;
            return [];
        };
        await manga.callLlmStoryboardParser(story, 'cinema', 'zh', 'auto');
        assert.match(capturedTask, /自动规划 1 至 5 格/);
        assert.match(capturedTask, /一个决定性瞬间可用单格/);
        assert.equal(capturedExpected, 0);

        await manga.callLlmStoryboardParser(story, 'cinema', 'zh', '3');
        assert.match(capturedTask, /严格规划为 3 格/);
        assert.equal(capturedExpected, 3);
    });
    await test('studioDirectorPrompt shares narrative rules and preserves Studio fields without forced pacing', () => {
        const promptJson = manga.studioDirectorPrompt(settings._mangaMode, 'test task', 'off', false);
        assert.match(promptJson, /按正文顺序组织有叙事价值的事件/);
        assert.match(promptJson, /不为凑格补剧情/);
        assert.match(promptJson, /一个相容时刻/);
        assert.match(promptJson, /可见人物分别建立 characters 条目/);
        assert.match(promptJson, /动作和表情归各自 positive/);
        assert.match(promptJson, /page.base 写整页主格位置与大致面积/);
        assert.match(promptJson, /实际阅读路径与光影/);
        assert.match(promptJson, /capacity_note/);
        assert.doesNotMatch(promptJson, /默认采用 3 至 4 格|铺垫最多占用第 1 格|收尾特写均有独立画格|逐格规划差异化/);
        assert.match(promptJson, /bubbles（本格旁白\/拟音\/画外文字数组）/);
        assert.match(promptJson, /characters\[\]\.bubbles/);
        assert.match(promptJson, /只输出一个 JSON 对象/);

        const promptTool = manga.studioDirectorPrompt(settings._mangaMode, 'test task', 'off', true);
        assert.match(promptTool, /必须调用 generate_manga_storyboard 工具提交当前单页 page 与 panels/);
        assert.doesNotMatch(promptTool, /只输出一个 JSON 对象/);

        const extracted = manga.studioPanelFromProtocol(scene().panels[0]);
        assert.equal(extracted.bubbleText, '谢谢。');

        const directPanel = manga.studioPanelFromProtocol({
            id: 'P3',
            bubbleType: 'screaming',
            bubbleText: '放开我！',
            bubbleLayout: 'vertical'
        });
        assert.equal(directPanel.bubbleText, '放开我！');
        assert.equal(directPanel.bubbleType, 'screaming');
        assert.equal(directPanel.bubbleLayout, 'vertical');
    });
    console.log(`\n${passed} Studio diagnostics and payload tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
