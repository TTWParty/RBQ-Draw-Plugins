/** Verification of direct Studio panel compilation, normalization and generation. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, settings, RBQ } = new Function('require', '__dirname',
    harness + '\nreturn {manga,settings,RBQ};')(require, __dirname);

let passed = 0;
settings._smartDrawTrigger.openaiBaseUrl = 'https://api.openai.com/v1';
settings._smartDrawTrigger.openaiModel = 'gpt-4o-mini';
async function test(name, run) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name + '\n' + error.stack); process.exit(1); }
}

(async () => {
    await test('composeStudioPrompt builds panel-by-panel prompt with shot, tags, actions and bubbles separated by |', () => {
        const store = {
            ...settings._mangaMode,
            style: 'monochrome',
            grammar: 'cinema',
            gutter: 'framed',
            studio: {
                ratio: '832x1216',
                panels: [
                    {
                        position: 'top panel',
                        shot: 'wide shot',
                        tags: '1girl, sitting by window, rain, melancholy, school uniform',
                        bubbleType: 'thought',
                        bubbleText: '今天……他又没来呢。',
                        bubbleLayout: 'vertical'
                    },
                    {
                        position: 'middle panel',
                        shot: 'close-up focus',
                        tags: '1girl, surprised expression, wide eyes, looking at door',
                        characters: [{ character_id: 'C1', positive: '1girl, gasping, head turned' }],
                        bubbleType: 'speech',
                        bubbleText: '谁在外面？！',
                        bubbleLayout: 'vertical'
                    },
                    {
                        position: 'bottom panel',
                        shot: 'cowboy shot',
                        tags: '1man, teacher, smiling, opening door',
                        bubbleType: 'speech',
                        bubbleText: '打扰了！',
                        bubbleLayout: 'horizontal'
                    }
                ]
            }
        };

        const prompt = manga.composeStudioPrompt(store);
        assert.ok(typeof prompt === 'string');
        const segments = prompt.split(' | ');
        assert.equal(segments.length, 4, 'Base + 3 panels = 4 segments');
        
        // Segment 0: Base layout
        assert.match(segments[0], /comic, 複数コマの漫画ページ, 3 panels/);
        assert.match(segments[0], /greyscale.*monochrome.*screentone/);

        // Segment 1: Panel 1
        assert.match(segments[1], /top panel/);
        assert.match(segments[1], /wide shot/);
        assert.match(segments[1], /sitting by window, rain, melancholy/);
        assert.match(segments[1], /BubbleType: 思考の吹き出し/);
        assert.match(segments[1], /Text: "今天……他又没来呢。"/);
        assert.match(segments[1], /vertical text/);

        // Segment 2: Panel 2
        assert.match(segments[2], /middle panel/);
        assert.match(segments[2], /close-up focus/);
        assert.match(segments[2], /surprised expression/);
        assert.match(segments[2], /gasping, head turned/);
        assert.match(segments[2], /Text: "谁在外面？！"/);

        // Segment 3: Panel 3
        assert.match(segments[3], /bottom panel/);
        assert.match(segments[3], /cowboy shot/);
        assert.match(segments[3], /1man, teacher, smiling, opening door/);
        assert.match(segments[3], /Text: "打扰了！"/);
        assert.match(segments[3], /horizontal text/);
    });

    await test('requestStudioPanels normalizes classic LLM response with tags and no characters array', async () => {
        const callerStore = { ...settings._mangaMode };
        const classicReply = {
            panels: [
                {
                    title: '雨中奔跑',
                    desc: '两个女生在暴雨中奔跑',
                    shot: 'wide shot',
                    tags: '2girls, running in rain, wet clothes, splashing water, street',
                    bubbleType: 'speech',
                    bubbleText: '快点！要迟到了！'
                },
                {
                    title: '跌倒在地',
                    desc: '其中一个女生脚下一滑摔倒在地',
                    shot: 'dynamic low angle',
                    tags: '1girl, falling down, on knees, puddle, pain expression',
                    bubbleType: 'screaming',
                    bubbleText: '啊痛……！'
                }
            ]
        };

        callerStore.studio = { ...callerStore.studio, panels: [] };
        RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(classicReply) });

        const parsed = await manga.requestStudioPanels(callerStore, 'two panels', 'story text', 2);
        assert.equal(parsed.length, 2);
        
        // Panel 1
        assert.equal(parsed[0].title, '雨中奔跑');
        assert.equal(parsed[0].shot, 'wide shot');
        assert.match(parsed[0].tags, /2girls, running in rain/);
        assert.equal(parsed[0].bubbleText, '快点！要迟到了！');
        assert.equal(parsed[0].bubbleType, 'speech');
        assert.equal(parsed[0].characters.length, 1);
        assert.match(parsed[0].characters[0].positive, /2girls, running in rain/);

        // Panel 2
        assert.equal(parsed[1].title, '跌倒在地');
        assert.equal(parsed[1].shot, 'dynamic low angle');
        assert.match(parsed[1].tags, /1girl, falling down/);
        assert.equal(parsed[1].bubbleText, '啊痛……！');
        assert.equal(parsed[1].bubbleType, 'screaming');
    });

    await test('studioPanelFromProtocol extracts rich action tags from characters[0].positive if description is empty', () => {
        const protocolPanel = {
            id: 'P1',
            title: '樱花树下',
            description: '',
            characters: [
                {
                    character_id: 'C1',
                    positive: '1girl, blush, parted lips, holding love letter, school uniform, cherry blossoms\nText: 喜欢你。'
                }
            ]
        };

        const panel = manga.studioPanelFromProtocol(protocolPanel);
        assert.match(panel.tags, /1girl, blush, parted lips, holding love letter/);
        assert.doesNotMatch(panel.tags, /Text: 喜欢你/);
        assert.equal(panel.bubbleText, '喜欢你。');
    });

    await test('requestStudioPanels intercepts structured safety refusal and throws SAFETY_REFUSAL', async () => {
        const callerStore = { ...settings._mangaMode };
        const refusalReply = {
            panels: [{
                position: 'full_page',
                description: 'I cannot fulfill this request as it involves depicting non-consensual sexual violence.',
                shot: 'none',
                characters: [],
                id: 'refusal_panel'
            }],
            page: {
                base: 'The request involves depicting non-consensual sexual acts, which is harmful.'
            }
        };

        RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify(refusalReply) });

        await assert.rejects(
            manga.requestStudioPanels(callerStore, 'task', 'story', 0),
            error => {
                assert.equal(error.code, 'SAFETY_REFUSAL');
                assert.match(error.message, /内容安全审查/);
                return true;
            }
        );
    });

    console.log(`\nAll ${passed} Studio direct refactor tests passed!`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
