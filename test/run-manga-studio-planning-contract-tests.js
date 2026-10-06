/** Real Studio planning requests and their single-page contract. Safe scenes; no network. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

// These are the historical user-selectable texts, not new Studio variants.
const historical = {
    v_manga_150: [109, '8e2609aa177f144b0a4bdfbad3b7b5d9ff2ea2f74ef75410c6cc10271ec09726'],
    v_manga_161: [491, '02ec9fc92e816204fb728aef9ea1fe422874a089f7aa5a741ab7d99d097bca4e'],
    v_manga: [619, '3d676af809e60b659e7c633ca75b069648f5cee5e8d6c61dee0d0d40e9bfbc1a'],
    v_manga_185: [717, '05a427db20bdfdc78845b54a86b562e5d0e8419030d287884e673915464922dc']
};
const story = '艾达站在办公室窗边，拿起信封。她说：“信已经寄到了，谢谢。”随后把信封放到桌上。';
const positions = ['top-right small panel', 'top-left small panel', 'middle wide panel', 'bottom-right small panel', 'bottom-left small panel'];
function scene(count = 1, mode = 'structured') {
    return {
        page: { base: count === 1 ? 'splash page, full-page panel, window light'
            : `comic, ${count} panels, middle wide focal panel, upper adjacent small panels, right to left reading path, window light` },
        panels: Array.from({ length: count }, (_, index) => ({
            id: `P${index + 1}`, title: index ? '放信' : '收到信', desc: index ? '艾达把信封放到桌上。' : '艾达拿着信封道谢。',
            position: count === 1 ? 'full-page panel' : positions[index], shot: 'medium shot',
            description: 'office, wooden desk, window', non_character: '',
            ...(mode === 'structured' ? { bubbles: [] } : {}),
            characters: [{ character_id: 'C1', name: 'Ada (original)',
                base: index ? '' : 'girl, adult, short brown hair', outfit: index ? '' : 'white shirt, dark trousers',
                positive: index ? 'standing, right hand placing envelope on desk' : 'standing, right hand holding envelope, looking at envelope',
                ...(mode === 'structured' ? { bubbles: index ? [] : [{ type: 'speech', position: 'right-upper', layout: 'vertical', text: '信已经寄到了，谢谢。' }] }
                    : !index ? { positive: 'standing, right hand holding envelope, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, Text: 信已经寄到了，谢谢。' } : {}),
                negative: '' }]
        }))
    };
}
function host(ec = 'v_manga', mode = 'structured', count = 1) {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,settings,RBQ};')(require, __dirname);
    const { manga, settings, RBQ } = env;
    const store = settings._mangaMode;
    Object.assign(store, { style: 'soft_color', grammar: 'cinema', dialogueMode: mode });
    Object.assign(store.studio, { ratio: '1216x832', useChatChars: false });
    Object.assign(settings._smartDrawTrigger, {
        openaiBaseUrl: 'https://fixture.invalid/v1', openaiModel: 'fixture', toolCallMode: true, enhancedContext: ec
    });
    const calls = [];
    let reply = scene(count, mode);
    RBQ.api.callStructuredCompletion = async args => {
        calls.push(args);
        return { rawReply: JSON.stringify(reply), rawOutput: 'safe fixture response' };
    };
    return { ...env, store, calls, reply(value) { reply = value; } };
}
const systemText = request => request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');

(async () => {
    await test('all four historical planning texts remain byte-for-byte unchanged', () => {
        const h = host();
        for (const [ec, [length, hash]] of Object.entries(historical)) {
            const prompt = h.manga.buildMangaPlanningPrompt(ec);
            assert.equal(prompt.length, length, ec);
            assert.equal(crypto.createHash('sha256').update(prompt).digest('hex'), hash, ec);
        }
    });
    const actualPrompts = new Map();
    for (const ec of Object.keys(historical)) {
        await test(`${ec} reaches the actual Studio request once, with only 185 receiving canvas`, async () => {
            const h = host(ec);
            const result = await h.manga.requestStudioPanels(h.store, '解析办公室收信这一页。', story, 0);
            assert.equal(h.calls.length, 1, 'planning must be part of the same completion');
            const request = h.calls[0], prompt = systemText(request), selected = h.manga.buildMangaPlanningPrompt(ec);
            assert.ok(prompt.includes(selected), `selected historical ${ec} text must actually be sent`);
            assert.equal(prompt.indexOf(selected), prompt.lastIndexOf(selected), 'do not duplicate the historical planner');
            actualPrompts.set(ec, prompt);
            assert.equal(result.length, 1, 'a single ordinary moment is valid in auto mode');
            const user = request.messages.at(-1).content;
            if (ec === 'v_manga_185') {
                const input = JSON.parse(user);
                assert.equal(input.currentMessage, story);
                assert.deepEqual(input.mangaCanvas, { width: 1216, height: 832, orientation: 'landscape', autoSpread: true });
            } else {
                assert.equal(user, story, 'other historical planners retain their canvas-free input');
                assert.doesNotMatch(user, /mangaCanvas/);
            }
        });
    }
    await test('historical selector choices produce four distinct messages rather than a cosmetic switch', () => {
        assert.equal(new Set(actualPrompts.values()).size, 4);
    });
    await test('the Studio task removes forced dramatic formulas and makes its one-page boundary explicit', async () => {
        const h = host();
        await h.manga.callLlmStoryboardParser(story, 'cinema', 'zh-hans', 'auto');
        const prompt = systemText(h.calls[0]);
        assert.doesNotMatch(prompt, /(?:默认采用|自适应拆解为)\s*[23]\s*至\s*4\s*格|默认规划为\s*3~4\s*格/);
        assert.doesNotMatch(prompt, /开场铺垫最多占用第\s*1\s*格|主格法则\s*\(Hero Panel\)|逐格规划差异化的景别/);
        assert.match(prompt, /本入口只生成当前一页/);
        assert.match(prompt, /不返回 segments、anchor、reason 或 intent/);
        assert.match(prompt, /一个决定性瞬间可用单格/);
        assert.equal(h.calls.length, 1);
    });
    for (const mode of ['structured', 'legacy']) {
        await test(`${mode} request schema owns page layout and supports required positions/shots in 1-5 panels`, async () => {
            const h = host('v_manga', mode);
            await h.manga.requestStudioPanels(h.store, '自动规划收信页。', story, 0);
            const schema = h.calls[0].tool.function.parameters;
            assert.ok(schema.required.includes('page'));
            assert.ok(schema.required.includes('panels'));
            assert.ok(schema.properties.page.required.includes('base'));
            assert.match(schema.properties.page.properties.base.description, /dominant panel position.*approximate page area/);
            assert.equal(schema.properties.panels.minItems, 1);
            assert.equal(schema.properties.panels.maxItems, 5);
            assert.ok(schema.properties.panels.items.required.includes('position'));
            assert.ok(schema.properties.panels.items.required.includes('shot'));
            assert.equal(Object.hasOwn(schema.properties.panels.items.properties, 'bubbles'), mode === 'structured');
            assert.equal(Object.hasOwn(schema.properties, 'segments'), false);
            assert.equal(Object.hasOwn(schema.properties, 'anchor'), false);
        });
    }
    for (const count of [1, 5]) {
        await test(`auto mode accepts ${count} ordinary panel${count === 1 ? '' : 's'} in one completion`, async () => {
            const h = host('v_manga', 'structured', count);
            const result = await h.manga.callLlmStoryboardParser(story, 'cinema', 'zh-hans', 'auto');
            assert.equal(result.length, count);
            assert.equal(h.calls.length, 1);
        });
    }
    await test('fixed count changes schema bounds and preserves its exact requested count', async () => {
        const h = host('v_manga', 'structured', 3);
        const result = await h.manga.callLlmStoryboardParser(story, 'cinema', 'zh-hans', '3');
        const panels = h.calls[0].tool.function.parameters.properties.panels;
        assert.equal(panels.minItems, 3); assert.equal(panels.maxItems, 3);
        assert.match(systemText(h.calls[0]), /严格规划为 3 格/);
        assert.equal(result.length, 3); assert.equal(h.calls.length, 1);
    });
    await test('a fixed-count mismatch fails without an automatic second model request', async () => {
        const h = host('v_manga', 'structured', 2);
        const before = h.store.studio._lastDebug;
        await assert.rejects(h.manga.callLlmStoryboardParser(story, 'cinema', 'zh-hans', '3'), /画格数量不符合要求/);
        assert.equal(h.calls.length, 1);
        assert.equal(h.store.studio._lastDebug, before);
    });
    await test('classic four-panel auto mode keeps its explicit four-panel exception', async () => {
        const h = host('v_manga', 'structured', 4);
        const result = await h.manga.callLlmStoryboardParser(story, '4koma', 'zh-hans', 'auto');
        const panels = h.calls[0].tool.function.parameters.properties.panels;
        assert.equal(panels.minItems, 4); assert.equal(panels.maxItems, 4);
        assert.equal(result.length, 4); assert.equal(h.calls.length, 1);
    });
    await test('classic four-panel rejects conflicting fixed counts before calling the model', async () => {
        const h = host();
        await assert.rejects(h.manga.callLlmStoryboardParser(story, '4koma', 'zh-hans', '3'), /经典四格/);
        assert.equal(h.calls.length, 0);
    });
    await test('single-panel refinement preserves its original draft ID and page-relative position', async () => {
        const h = host();
        const original = { id: 'draft-letter-detail', title: '递信', desc: '艾达拿着信封。',
            position: 'middle-left narrow panel, beside central focal panel', shot: 'close-up on hands', characters: [] };
        const allPanels = [{ id: 'draft-opening', position: 'top wide panel', characters: [] }, original,
            { id: 'draft-ending', position: 'bottom wide panel', characters: [] }];
        const before = clone(allPanels);
        const result = await h.manga.callLlmSingleSentenceExpander(original.desc, original.shot, 'cinema', 'zh-hans', allPanels, 1);
        assert.equal(result.id, original.id);
        assert.equal(result.position, original.position);
        assert.deepEqual(allPanels, before, 'refinement must not mutate other draft panels');
        const input = JSON.parse(h.calls[0].messages.at(-1).content);
        assert.equal(input.currentIndex, 1);
        assert.deepEqual(input.currentPanel, original);
        assert.deepEqual(input.otherPanels, allPanels.filter(panel => panel !== original));
        assert.equal(h.calls[0].tool.function.parameters.properties.panels.maxItems, 1);
        assert.equal(h.calls.length, 1);
    });
    await test('single-panel refinement preserves an intentionally absent draft position', async () => {
        const h = host();
        const original = { id: 'draft-unplaced', desc: '艾达拿起信封。', position: '', characters: [] };
        const result = await h.manga.callLlmSingleSentenceExpander(original.desc, '', 'cinema', 'zh-hans', [original], 0);
        assert.equal(result.id, original.id);
        assert.equal(result.position, '', 'a local edit must not become a new full-page layout');
        assert.equal(h.calls.length, 1);
    });
    for (const ec of ['v_manga', 'v_manga_185']) {
        await test(`${ec} planning also reaches the plain JSON request once`, async () => {
            const h = host(ec);
            delete h.RBQ.api.callStructuredCompletion;
            const fetched = [];
            h.manga.fetch = async (_url, options) => {
                fetched.push(JSON.parse(options.body));
                return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(scene()) } }] }) };
            };
            await h.manga.requestStudioPanels(h.store, '自动规划办公室收信页。', story, 0);
            assert.equal(fetched.length, 1);
            assert.ok(systemText(fetched[0]).includes(h.manga.buildMangaPlanningPrompt(ec)));
            const user = fetched[0].messages.at(-1).content;
            assert.equal(ec === 'v_manga_185' ? JSON.parse(user).currentMessage : user, story);
        });
    }
    console.log(`\n${passed} Studio planning contract tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
