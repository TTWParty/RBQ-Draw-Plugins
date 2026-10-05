/** Parser/contract regressions against production functions. No network or image calls. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;

function host() {
    const env = new Function('require', '__dirname', harness + '\nreturn { manga, sdt, settings, RBQ, vm, sdtSource };')(require, __dirname);
    env.vm.runInContext(env.sdtSource.slice(env.sdtSource.indexOf('    function extractJson('), env.sdtSource.indexOf('    function processSseLine(')), env.sdt);
    return env;
}

function completionHost() {
    const env = host();
    env.vm.runInContext(env.sdtSource.slice(env.sdtSource.indexOf('    function processSseLine('), env.sdtSource.indexOf('    function parseSseStringToOpenAiJson(')), env.sdt);
    env.vm.runInContext(env.sdtSource.slice(env.sdtSource.indexOf('    async function callStructuredCompletion('), env.sdtSource.indexOf('    async function callTagger(')), env.sdt);
    Object.assign(env.sdt, { TextDecoder, normalizeBaseUrl: value => value, checkUrlSafety() {},
        buildThinkingParams: () => ({}), smartFetch: () => { throw new Error('unexpected network call'); } });
    return env;
}

function fakeJsonResponse(value, readerBody) {
    const raw = JSON.stringify(value);
    let sent = false;
    return { ok: true, headers: { get: () => readerBody ? 'text/event-stream' : 'application/json' },
        text: async () => raw,
        ...(readerBody ? { body: { getReader: () => ({ read: async () => sent
            ? { done: true } : (sent = true, { done: false, value: new TextEncoder().encode(raw) }) }) } } : {}) };
}

async function test(name, run) {
    await run();
    passed++;
    console.log('PASS ' + name);
}

const bubble = text => ({ type: 'speech', position: 'right-upper', layout: 'vertical', text });
const person = (fields = {}) => ({ character_id: 'C1', name: 'Ami (original)', base: 'girl, long hair',
    outfit: 'school uniform', positive: 'standing', bubbles: [], negative: '', ...fields });
const page = (actor = person()) => ({ format: 'nai5-comic', label: '普通对话', anchor: { text: '她站在教室里。' },
    page: { base: 'comic, 1 panel, 1girl' }, panels: [{ id: 'P1', description: 'classroom', bubbles: [], characters: [actor] }] });
const captionText = caption => caption.slice(caption.indexOf('Text: ') + 6);

(async () => {
    await test('valid JSON bubble literals preserve thinking tags and code fences in both parsers', () => {
        const { manga, sdt } = host();
        for (const text of [
            '请显示 <think>先想一下</think> 再继续。',
            '请显示 <thinking>先思考</thinking> 再继续。',
            '请显示 <os>系统名称</os> 再继续。',
            '请照抄：```json 你好 ```。',
            '老师说：```json\n{"lesson":"你好"}\n```，请照着写。'
        ]) {
            const source = page(person({ bubbles: [bubble(text)] }));
            const sdtRaw = JSON.stringify({ shouldDraw: true, segments: [source] });
            const studioRaw = JSON.stringify({ panels: source.panels });
            assert.equal(sdt.extractJson(sdtRaw).segments[0].panels[0].characters[0].bubbles[0].text, text);
            assert.equal(manga.extractStudioJson(studioRaw).panels[0].characters[0].bubbles[0].text, text);
            const normalized = sdt.normalizeTaggerResult({ choices: [{ message: { content: sdtRaw } }] });
            assert.equal(captionText(normalized.segments[0].characters[0].caption), text);
        }
    });

    await test('legacy response wrappers still parse without changing JSON string literals', () => {
        const { manga, sdt } = host();
        const text = '请原样保留 <think>内容</think> 和 ```json 示例 ```。';
        const source = page(person({ bubbles: [bubble(text)] }));
        const sdtValue = { shouldDraw: true, segments: [source] };
        const studioValue = { panels: source.panels };
        const wrappers = [
            value => '<think>选择了一个普通画格。</think>\n' + JSON.stringify(value),
            value => '<thinking>确认说话者。</thinking>\n```json\n' + JSON.stringify(value) + '\n```',
            value => '<os>兼容包装。</os>\n说明：\n' + JSON.stringify(value) + '\n结束。'
        ];
        for (const wrap of wrappers) {
            assert.deepEqual(clone(sdt.extractJson(wrap(sdtValue))), sdtValue);
            assert.deepEqual(clone(manga.extractStudioJson(wrap(studioValue))), studioValue);
        }
    });

    await test('repairing raw newline and trailing comma preserves punctuation inside bubble text', () => {
        const { manga, sdt } = host();
        const text = '请保留逗号示例 ,} 和 ,]。\n下一句仍然完整。';
        const source = page(person({ bubbles: [bubble(text)] }));
        const damaged = value => {
            const raw = JSON.stringify(value).replace(/\\n/g, '\n');
            return '<think>一个普通画格。</think>\n' + raw.slice(0, -1) + ',}';
        };
        assert.equal(sdt.extractJson(damaged({ shouldDraw: true, segments: [source] })).segments[0]
            .panels[0].characters[0].bubbles[0].text, text);
        assert.equal(manga.extractStudioJson(damaged({ panels: source.panels })).panels[0]
            .characters[0].bubbles[0].text, text);
    });

    await test('non-stream native text and legacy/native tools normalize the same ordinary comic', () => {
        const { sdt } = host();
        const text = '请原样保留 <think>内容</think>。';
        const source = { shouldDraw: true, segments: [page(person({ bubbles: [bubble(text)] }))] };
        const raw = JSON.stringify(source), cut = Math.floor(raw.length / 2);
        const responses = [
            { choices: [{ message: { content: raw } }] },
            { choices: [{ message: { function_call: { name: 'generate_draw_spec', arguments: raw } } }] },
            { candidates: [{ content: { parts: [{ thought: true, text: '先核对普通画格。' },
                { text: raw.slice(0, cut) }, { text: raw.slice(cut) }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { name: 'generate_draw_spec', args: source } }] } }] }
        ];
        const context = sdt.captureMangaRequestContext({ content: '她说：“你好。”' }, -1);
        for (const response of responses) {
            const result = sdt.normalizeTaggerResult(response, [], context);
            assert.equal(result.segments.length, 1);
            assert.equal(captionText(result.segments[0].characters[0].caption), text);
        }
    });

    await test('structured completion accepts modern, legacy and native tool envelopes from both complete-body paths', async () => {
        const { sdt, settings } = completionHost();
        Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://stub.invalid/v1', openaiModel: 'stub', toolCallMode: true });
        const source = { panels: page(person({ bubbles: [bubble('一起回家吧。')] })).panels };
        const raw = JSON.stringify(source), functionName = 'generate_manga_storyboard';
        const responses = [
            { choices: [{ message: { tool_calls: [{ function: { name: functionName, arguments: raw } }] } }] },
            { choices: [{ message: { function_call: { name: functionName, arguments: raw } } }] },
            { choices: [{ message: { function_call: { name: functionName, arguments: source } } }] },
            { candidates: [{ content: { parts: [{ functionCall: { name: functionName, args: source } }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { name: functionName, args: raw } }] } }] }
        ];
        for (const readerBody of [false, true]) for (const response of responses) {
            sdt.callApiWithJsonFallback = async () => fakeJsonResponse(response, readerBody);
            const result = await sdt.callStructuredCompletion({ messages: [], tool: { function: { name: functionName } } });
            assert.equal(result.isToolCall, true);
            assert.deepEqual(JSON.parse(result.rawReply), source);
        }
    });

    await test('structured completion excludes native thought parts while preserving split text and literal tags', async () => {
        const { sdt, settings } = completionHost();
        Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://stub.invalid/v1', openaiModel: 'stub', toolCallMode: false });
        const source = { panels: page(person({ bubbles: [bubble('请显示 <os>名称</os>。')] })).panels };
        const raw = JSON.stringify(source), cut = Math.floor(raw.length / 2);
        const response = { candidates: [{ content: { parts: [{ thought: true, text: '核对普通对话。' },
            { text: raw.slice(0, cut) }, { text: raw.slice(cut) }] } }] };
        for (const readerBody of [false, true]) {
            sdt.callApiWithJsonFallback = async () => fakeJsonResponse(response, readerBody);
            const result = await sdt.callStructuredCompletion({ messages: [] });
            assert.equal(result.isToolCall, false);
            assert.equal(result.reasoning, '核对普通对话。');
            assert.deepEqual(JSON.parse(result.rawReply), source);
        }
    });

    await test('Studio tool character schema requires compiler fields and exposes shared state/render contract', async () => {
        const { manga, settings, RBQ } = host();
        Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://stub.invalid/v1', openaiModel: 'stub', toolCallMode: true });
        let captured;
        const panels = page(person({ render: { base: 'girl, long dark hair', outfit: 'light school uniform' } })).panels;
        RBQ.api.callStructuredCompletion = async request => {
            captured = request;
            return { rawReply: JSON.stringify({ panels }) };
        };
        const result = await manga.requestStudioPanels(settings._mangaMode, '一个普通画格', '她站在教室里。', 1);
        assert.equal(result.length, 1);
        const shared = manga.mangaSegmentSchema().properties.panels.items.properties.characters.items;
        const actual = captured.tool.function.parameters.properties.panels.items.properties.characters.items;
        for (const key of shared.required) assert.ok(actual.required.includes(key), 'Studio must require ' + key);
        assert.ok(actual.required.includes('name'));
        for (const key of ['state', 'render', 'bubbles', 'negative']) {
            assert.deepEqual(clone(actual.properties[key]), clone(shared.properties[key]), 'Studio must expose shared ' + key);
        }
    });

    await test('request with memory enabled retains its captured appearance after the live setting turns off', () => {
        const { sdt, settings } = host();
        settings._mangaMode.style = 'soft_color';
        settings._smartDrawTrigger.characterMemoryEnabled = true;
        sdt.updateCharacterProfile('Ami (original)', 'girl, long hair, blue eyes', 'white shirt, blue skirt');
        const context = sdt.captureMangaRequestContext({ content: '她说：“你好。”' }, -1);
        const source = page(person({ base: '', outfit: '', bubbles: [bubble('你好。')] }));
        const expected = clone(sdt.normalizeTaggerResult({ shouldDraw: true, segments: [source] }, [], context).segments[0]);
        const savedProfile = clone(sdt.getCharacterProfile('Ami (original)'));
        settings._smartDrawTrigger.characterMemoryEnabled = false;
        let saves = 0;
        sdt.save = () => { saves++; };
        const actual = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [source] }, [], context).segments[0];
        assert.equal(actual.characters[0].caption, expected.characters[0].caption);
        assert.equal(actual.mangaPage.panels[0].characters[0].base, expected.mangaPage.panels[0].characters[0].base);
        assert.equal(actual.mangaPage.panels[0].characters[0].outfit, expected.mangaPage.panels[0].characters[0].outfit);
        assert.deepEqual(clone(sdt.getCharacterProfile('Ami (original)')), savedProfile);
        assert.equal(saves, 0, 'turning memory off must prevent profile and render-cache writes');
    });

    await test('request with memory disabled does not adopt live profiles or write memory when the setting turns on', () => {
        const { sdt, settings } = host();
        settings._mangaMode.style = 'soft_color';
        settings._smartDrawTrigger.characterMemoryEnabled = false;
        const context = sdt.captureMangaRequestContext({ content: '她说：“你好。”' }, -1);
        settings._smartDrawTrigger.characterMemoryEnabled = true;
        sdt.updateCharacterProfile('Ami (original)', 'girl, short hair, brown eyes', 'red coat');
        const savedProfile = clone(sdt.getCharacterProfile('Ami (original)'));
        let saves = 0;
        sdt.save = () => { saves++; };
        const source = page(person({ base: 'girl, braided hair', outfit: 'green cardigan', bubbles: [bubble('你好。')] }));
        const actual = sdt.normalizeTaggerResult({ shouldDraw: true, segments: [source] }, [], context).segments[0];
        assert.match(actual.characters[0].caption, /braided hair, green cardigan/);
        assert.doesNotMatch(actual.characters[0].caption, /short hair|brown eyes|red coat/);
        assert.deepEqual(clone(sdt.getCharacterProfile('Ami (original)')), savedProfile);
        assert.equal(saves, 0, 'an initially memory-disabled request must not publish memory updates');
    });

    console.log(`\n${passed} manga parser/contract tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
