/** Outgoing structured-dialogue examples and contracts execute real request paths.
 * All replies are ordinary office dialogue; no network, model or image calls. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, sdtSource } = new Function('require', '__dirname', harness +
    '\nreturn {manga,sdt,settings,RBQ,sdtSource};')(require, __dirname);
const protocol = RBQ.api.mangaProtocol;
const clone = value => JSON.parse(JSON.stringify(value));
const story = '艾达在办公室说：“资料已收到。”贝丝回答：“谢谢你。”';
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function reset(mode = 'structured', memory = false, cards = false) {
    settings._mangaMode = { enabled: true, style: 'soft_color', grammar: 'cinema', gutter: 'bleed', language: 'zh-hans',
        dialogueMode: mode, autoSpread: true, antiHijack: true,
        studio: { ratio: '832x1216', panels: [], panelCountMode: 'auto', useChatChars: false } };
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga_narrative', multiCharOutput: true,
        characterMemoryEnabled: memory, characterProfiles: {}, injectCharacterCard: cards, provider: 'openai',
        openaiBaseUrl: 'https://fixture.invalid/v1', openaiModel: 'fixture', customUrl: 'https://fixture.invalid/tagger', squashMessages: false };
    sdt.getMessageSnapshot = () => ({ mes: story, name: 'Narrator' });
    sdt.collectCharacterCardInfo = () => cards ? [{ name: 'Ada', description: '成年女性，黑色长发，白衬衫。' }] : [];
    RBQ.api.getRecentMessages = () => [];
    sdt.prepareNaiCharData(null);
}
function jsonObjects(source) {
    const found = [];
    for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
        let depth = 0, string = false, escaped = false;
        for (let index = start; index < source.length; index++) {
            const c = source[index];
            if (string) {
                if (escaped) escaped = false;
                else if (c === '\\') escaped = true;
                else if (c === '"') string = false;
            } else if (c === '"') string = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) {
                try { found.push(JSON.parse(source.slice(start, index + 1))); } catch (_) {}
                break;
            }
        }
    }
    return found;
}
function assertStructuredExample(prompt) {
    const objects = jsonObjects(prompt);
    const examples = objects.flatMap(value => Array.isArray(value.segments) ? value.segments : [value])
        .filter(value => value.page && Array.isArray(value.panels) && value.panels.some(panel => panel.characters?.length >= 2));
    assert.ok(examples.length, 'the actual outgoing prompt needs a parseable page/panel/two-speaker JSON example');
    const example = examples[0], panel = example.panels.find(panel => panel.characters.length >= 2);
    assert.ok(Array.isArray(example.page.bubbles), 'page explicitly decides its text ownership');
    assert.ok(Array.isArray(panel.bubbles), 'panel explicitly decides its text ownership');
    assert.ok(example.page.bubbles.every(bubble => ['caption', 'sfx'].includes(bubble.type)));
    assert.ok(panel.bubbles.every(bubble => ['caption', 'sfx', 'offscreen', 'broadcast', 'tailless'].includes(bubble.type)
        || bubble.position === 'offscreen'));
    const people = panel.characters.filter(character => character.bubbles?.some(bubble => bubble.type === 'speech' && bubble.text?.trim()));
    assert.ok(people.length >= 2, 'both parts of the exchange belong to their actual visible speakers');
    assert.equal(new Set(people.map(person => person.character_id)).size, people.length);
    for (const person of people) {
        assert.ok(typeof person.positive === 'string');
        assert.doesNotMatch(person.positive, /(?:Text|BubbleType|Layout)\s*:/);
        assert.ok(person.bubbles.every(bubble => typeof bubble.text === 'string' && bubble.text.trim()));
    }
    const page = { format: 'nai5-comic', ...clone(example) };
    assert.doesNotThrow(() => protocol.validateResponseBubbles([page]));
    const compiled = manga.compileMangaPage(page);
    const baseText = manga.splitMangaText(compiled.base, false).text;
    for (const person of people) for (const bubble of person.bubbles) {
        assert.ok(!baseText.includes(bubble.text), 'a visible person utterance never enters the page base example');
        const appearance = compiled.characters.find(character => character.characterId === person.character_id && character.panelId === panel.id);
        assert.ok(appearance);
        assert.ok(manga.splitMangaText(appearance.caption, false).text.includes(bubble.text));
    }
    assert.doesNotMatch(prompt, /原版 v1\.1 编译|所有气泡类型、位置、Layout 先写|唯一末尾 Text:|末尾唯一 Text:|最后只写一个 Text:/,
        'structured instructions must not teach the legacy Text assembly sequence');
    assert.doesNotMatch(prompt, /positive="[^"\n]*Text:/);
    assert.doesNotMatch(prompt, /画外声\/旁白\/拟音才在 panel\/page\.bubbles|画外对白归所属 page\.bubbles 或 panel\.bubbles/,
        'page and panel voice owners must not be conflated');
    return page;
}
function assertOutputSchema(schema) {
    assert.equal(schema.segments[0].format, 'nai5-comic');
    const page = schema.segments[0].page, panel = schema.segments[0].panels[0];
    assert.ok(Array.isArray(page.bubbles)); assert.ok(Array.isArray(panel.bubbles));
    assert.ok(Array.isArray(panel.characters[0].bubbles));
    assert.doesNotMatch(panel.characters[0].positive, /(?:末尾|Text:|BubbleType:)/);
}
const systemText = body => body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');

(async () => {
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callOpenAiCompatible('), sdtSource.indexOf('    async function callCustomHttp(')), sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('), sdtSource.indexOf('    async function callStructuredCompletion(')), sdt);
    Object.assign(sdt, { normalizeBaseUrl: value => value, checkUrlSafety() {}, logTaggerPayload() {}, validateStructuredResult: value => value,
        safeReadJsonResponse: async response => response.json(), getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {},
        buildThinkingParams: () => ({}), DRAW_SPEC_TOOL_RULE: 'Submit final results via generate_draw_spec' });
    await test('shared structured examples remain valid across existing planners and monochrome or color generation', () => {
        reset();
        for (const ec of ['v_manga', 'v_manga_185', 'v_manga_161', 'v_manga_150', 'v_manga_narrative']) {
            settings._smartDrawTrigger.enhancedContext = ec;
            for (const style of ['soft_color', 'monochrome']) {
                settings._mangaMode.style = style;
                assertStructuredExample(sdt.getSystemPromptWithPresets(settings._smartDrawTrigger));
            }
        }
    });
    for (const channel of ['custom HTTP', 'OpenAI JSON', 'OpenAI tool']) {
        await test(`${channel} sends a working two-speaker example consistently with cards and memory on or off`, async () => {
            for (const memory of [false, true]) for (const cards of [false, true]) {
                reset('structured', memory, cards);
                settings._smartDrawTrigger.provider = channel === 'custom HTTP' ? 'custom' : 'openai';
                settings._smartDrawTrigger.toolCallMode = channel === 'OpenAI tool';
                let calls = 0;
                const receive = body => {
                    calls++;
                    const request = channel === 'custom HTTP' ? body : JSON.parse(body.messages.find(message => message.role === 'user').content);
                    const prompt = channel === 'custom HTTP' ? request.mangaInstruction : systemText(body);
                    const page = assertStructuredExample(prompt);
                    assertOutputSchema(request.outputSchema);
                    assert.equal(request.currentMessage.content, story);
                    assert.equal(!!request.outputSchema.character_memory, memory);
                    if (channel === 'OpenAI tool') {
                        const segment = body.tools[0].function.parameters.properties.segments.items;
                        const p = segment.properties.page.properties.bubbles.items.properties.type.enum;
                        const c = segment.properties.panels.items.properties.characters.items.properties.bubbles.items.properties.type.enum;
                        assert.deepEqual(clone(p).sort(), ['caption', 'sfx']);
                        assert.ok(c.includes('speech')); assert.ok(c.includes('thought'));
                        assert.ok(!c.includes('caption')); assert.ok(!c.includes('sfx'));
                    }
                    const output = { shouldDraw: true, segments: [page] };
                    const reply = channel === 'custom HTTP' ? output : channel === 'OpenAI tool'
                        ? { choices: [{ message: { tool_calls: [{ function: { name: 'generate_draw_spec', arguments: JSON.stringify(output) } }] } }] }
                        : { choices: [{ message: { content: JSON.stringify(output) } }] };
                    return { ok: true, headers: { get: () => 'application/json' }, json: async () => reply };
                };
                sdt.smartFetch = async (_url, options) => receive(JSON.parse(options.body));
                sdt.callApiWithJsonFallback = async (_url, _options, body) => receive(body);
                const result = channel === 'custom HTTP' ? await sdt.callCustomHttp(1, { type: 'auto' }) : await sdt.callOpenAiCompatible(1, { type: 'auto' });
                assert.equal(calls, 1);
                assert.equal(result.segments[0].characters.length, 2);
                assert.ok(result.segments[0].characters.every(character => manga.splitMangaText(character.caption, false).text));
            }
        });
    }
    for (const toolMode of [true, false]) await test(`Studio ${toolMode ? 'tool' : 'JSON'} sends the same owned exchange and preserves both replies`, async () => {
        reset(); settings._smartDrawTrigger.toolCallMode = toolMode;
        let calls = 0;
        const receive = body => {
            calls++;
            const example = assertStructuredExample(systemText(body));
            if (toolMode) {
                const owners = body.tool.function.parameters.properties;
                assert.deepEqual(clone(owners.page.properties.bubbles.items.properties.type.enum).sort(), ['caption', 'sfx']);
                assert.ok(owners.panels.items.properties.characters.items.required.includes('bubbles'));
            }
            const result = { page: example.page, panels: example.panels };
            return toolMode ? { rawReply: JSON.stringify(result) }
                : { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
        };
        if (toolMode) RBQ.api.callStructuredCompletion = async body => receive(body);
        else {
            delete RBQ.api.callStructuredCompletion;
            manga.fetch = async (_url, options) => receive(JSON.parse(options.body));
        }
        try {
            const panels = await manga.requestStudioPanels(settings._mangaMode, '办公室双人交谈', story, 1);
            assert.equal(calls, 1);
            assert.equal(panels[0].characters.length, 2);
            assert.ok(panels[0].characters.every(character => manga.splitMangaText(character.positive, false).text));
            assert.equal(panels[0].bubbles.length, 0);
        } finally { delete RBQ.api.callStructuredCompletion; }
    });
    await test('legacy output still teaches its selected Text protocol without receiving a conflicting structured example', () => {
        reset('legacy', true, true);
        const prompt = sdt.getSystemPromptWithPresets(settings._smartDrawTrigger, true);
        assert.match(prompt, /末尾唯一 Text:|最后只写一个 Text:/);
        const examples = jsonObjects(prompt).filter(value => value.page && value.panels?.some(panel => panel.characters?.length >= 2));
        assert.equal(examples.length, 0);
        assert.equal(protocol.segmentSchema().properties.panels.items.properties.characters.items.properties.bubbles, undefined);
    });
    console.log(`\n${passed} outgoing structured-prompt tests passed; no live calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
