/** SDT page diagnostics and refinement use neutral office scenes. No live services or images. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { sdt, manga, settings, RBQ, sdtSource } = new Function('require', '__dirname',
    harness + '\nreturn {sdt,manga,settings,RBQ,sdtSource};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const protocol = RBQ.api.mangaProtocol;
const bubble = (text, type = 'speech') => ({ type, position: 'right-upper', layout: 'vertical', text });
const page = () => ({ format: 'nai5-comic', label: '办公室交谈', intent: '递交资料',
    anchor: { text: '艾达在办公室递出文件。' }, page: { base: 'comic, 1 panel, office', bubbles: [] },
    panels: [{ id: 'P1', description: 'full-page panel, medium shot, wooden desk', bubbles: [], characters: [
        { character_id: 'C1', name: 'Ada (original)', base: 'adult, girl, black hair', outfit: 'white shirt',
            positive: 'standing, holding document', negative: '', bubbles: [bubble('资料已收到。')] }
    ] }] });
let passed = 0, calls = 0, saves = 0, images = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function reset(provider = 'custom') {
    settings._mangaMode.style = 'soft_color';
    settings._mangaMode.dialogueMode = 'structured';
    settings._smartDrawTrigger = { _mangaActive: true, enhancedContext: 'v_manga_narrative', provider,
        customUrl: 'https://fixture.invalid/tagger', openaiBaseUrl: 'https://fixture.invalid/v1', openaiModel: 'fixture',
        characterMemoryEnabled: false, showTaggerDebug: true };
    calls = 0; saves = 0; images = 0;
    sdt.save = () => { saves++; };
    RBQ.api.generateImage = async () => { images++; throw new Error('No image generation in diagnostic tests'); };
}
class Element {
    constructor() { this.dataset = {}; this.style = {}; this.children = []; this.classList = { add() {}, remove() {} }; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    append(...children) { this.children.push(...children); }
    addEventListener() {}
}
const toasts = [], rendered = [], stages = [];
Object.assign(sdt, { HTMLElement: Element, AbortController,
    document: { createElement: () => new Element() },
    toastr: { error: message => toasts.push(message), warning: message => toasts.push(message) },
    PLUGIN_NAME: 'Smart Draw Trigger', setWrapperStage: (_wrapper, stage) => stages.push(stage),
    ensureTaggerButtonState: () => ({ disabled: false }), setGenerateButtonState() {}, clearWrapperLoading() {},
    renderTaggerDebugInfo: (_wrapper, result) => rendered.push(result),
    getActiveJailbreakPrompt: () => '', applyPostProcessPrompt() {}, normalizeBaseUrl: value => value,
    checkUrlSafety() {}, buildThinkingParams: () => ({}), safeReadJsonResponse: async response => response.json() });
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function getTaggerDebugReason('),
    sdtSource.indexOf('    function renderTaggerDebugInfo(')), sdt);
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function runTaggerForWrapper('),
    sdtSource.indexOf('    let lastChatKey =')), sdt);
vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function runSegmentAiRefinement('),
    sdtSource.indexOf('    function setCardLoadingState(')), sdt);
async function showFailure(error) {
    reset(); rendered.length = 0; toasts.length = 0; stages.length = 0;
    const wrapper = new Element();
    sdt.callTagger = async () => { calls++; throw error; };
    await sdt.runTaggerForWrapper(wrapper, { type: 'auto' }, 1, 'diagnostic');
    assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
    assert.equal(wrapper._taggerAbort, undefined);
    assert.equal(stages.at(-1), 'error');
    assert.equal(rendered.length, 1);
    return rendered[0];
}
function mockRefinement(result) {
    const respond = () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) }; };
    sdt.smartFetch = async () => respond();
    sdt.callApiWithJsonFallback = async () => respond();
}

(async () => {
    await test('actual wrapper catch preserves ownership validation pages and identifies a parse error', async () => {
        const invalid = page(); invalid.page.bubbles = [bubble('办公室里有人说话。')];
        let error;
        try { protocol.recoverResponseText([invalid]); } catch (caught) { error = caught; }
        assert.ok(error, 'production protocol rejects a fresh page speech bubble');
        const result = await showFailure(error);
        assert.equal(result.isError, true); assert.equal(result.reason, error.message);
        assert.equal(result.errorCode, error.code || '');
        assert.ok(result.rawOutput.includes(error.rawOutput));
        assert.match(result.rawOutput, /办公室里有人说话。/);
        assert.match(result.rawOutput, /错误信息|Raw Output/);
        assert.doesNotMatch(result.rawOutput, /服务端未返回有效大模型正文|该错误由接口或网络异常触发/);
    });
    await test('raw output, model diagnostics, chunks and stack all survive the actual wrapper catch', async () => {
        const error = new Error('结构解析失败');
        error.rawOutput = '{"panels":[],"note":"资料已收到。"}';
        error.debugInfo = { reason: '输出结构缺失', model: 'fixture-model', llmOutput: '原始模型正文', chunks: [{ content: '报文片段' }] };
        const result = await showFailure(error);
        for (const value of [error.rawOutput, '输出结构缺失', 'fixture-model', '原始模型正文', '报文片段', error.stack]) {
            assert.ok(result.rawOutput.includes(value));
        }
        assert.doesNotMatch(result.rawOutput, /未返回有效大模型正文/);
    });
    await test('generic errors without a recorded body report only the known limitation', async () => {
        const result = await showFailure(new Error('连接断开'));
        assert.match(result.rawOutput, /连接断开|未记录原始输出/);
        assert.doesNotMatch(result.rawOutput, /服务端未返回有效大模型正文|该错误由接口或网络异常触发/);
    });
    await test('actual wrapper catch retains explicit provider refusal metadata after adding the diagnostic trace', async () => {
        const error = new Error('接口返回错误');
        error.rawOutput = JSON.stringify({ choices: [{ finish_reason: 'content_filter' }] });
        const result = await showFailure(error);
        assert.equal(result.errorCategory, 'safety');
        assert.equal(sdt.getTaggerErrorCategory(result), 'safety');
    });
    await test('cached page warnings reach debug text once and survive a single-page cache snapshot', () => {
        reset(); const invalid = page(); invalid.page.bubbles = [bubble('办公室里有人说话。')];
        const segment = sdt.normalizeMangaSegment(invalid);
        assert.ok(segment.mangaWarnings.length);
        segment.mangaWarnings.push(segment.mangaWarnings[0], '', null);
        const before = JSON.stringify(segment);
        const cached = sdt.sanitizeSdtResult(segment);
        const reason = sdt.getTaggerDebugReason(cached);
        assert.ok(reason.includes('递交资料'));
        assert.ok(reason.includes(segment.mangaWarnings[0]));
        assert.equal(reason.split(segment.mangaWarnings[0]).length - 1, 1);
        assert.equal(sdt.getTaggerDebugReason({ ...cached, reason }), reason);
        assert.equal(JSON.stringify(segment), before);
        assert.equal(sdt.getTaggerDebugReason({ reason: '普通图片' }), '普通图片');
    });
    await test('older cached snapshots derive current ownership warnings without modifying saved content', () => {
        reset(); const invalid = page(); invalid.page.bubbles = [bubble('办公室里有人说话。')];
        const cached = { reason: '旧缓存', mangaPage: invalid }, before = JSON.stringify(cached);
        const reason = sdt.getTaggerDebugReason(cached);
        assert.match(reason, /旧缓存|归属|人物/);
        assert.ok(reason.includes('归属') || reason.includes('人物'));
        assert.equal(JSON.stringify(cached), before);
        const malformed = { reason: '损坏缓存', mangaPage: { format: 'nai5-comic' } };
        assert.match(sdt.getTaggerDebugReason(malformed), /损坏缓存[\s\S]*漫画缓存提示/);
    });
    await test('actual per-page card and debug renderer show cached ownership and compatibility warnings', () => {
        reset(); const invalid = page(); invalid.page.bubbles = [bubble('办公室里有人说话。')];
        const segment = sdt.normalizeMangaSegment(invalid);
        segment.mangaWarnings.push('P1/C1 的旧格式文字已保留，请核对本次解析');
        const before = JSON.stringify(segment), container = new Element();
        let cardResult;
        RBQ.api.getMessageTextContainer = () => container;
        sdt.getMessageSnapshot = () => ({ mes: invalid.anchor.text });
        Object.assign(sdt, { CARD_CLASS: 'rbq-sdt-card', CSS: { escape: value => value },
            anchorsMatchSentence: (anchor, current) => current.includes(anchor), getSegmentLabel: segment => segment.label,
            createConfiguredCard: request => { cardResult = request.result; return new Element(); },
            bindWrapperManualRun() {}, syncMessageActionButton() {}, tryMountAnchoredCard: () => true });
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function materializeResultCards('),
            sdtSource.indexOf('    function sanitizeSdtResult(')), sdt);
        const cards = sdt.materializeResultCards(1, { type: 'auto' }, { segments: [segment] }, 'cached-page');
        assert.equal(cards.length, 1);
        for (const warning of segment.mangaWarnings) assert.ok(cardResult.reason.includes(warning));
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function renderTaggerDebugInfo('),
            sdtSource.indexOf('    function openTaggerDebugModal(')), sdt);
        const wrapper = new Element(); sdt.renderTaggerDebugInfo(wrapper, cardResult);
        const reasonElement = wrapper.children[0].children.find(child => child.className === 'rbq-sdt-debug-reason');
        assert.equal(reasonElement.textContent, cardResult.reason);
        assert.match(reasonElement.textContent, /旧格式文字已保留/);
        assert.equal(JSON.stringify(segment), before);
    });
    assert.equal(typeof protocol.validateResponseBubbles, 'function');
    assert.equal(typeof protocol.normalizeResponseBubbles, 'function');
    for (const provider of ['custom', 'openai']) {
        await test(`${provider} actual SDT refinement routes an explicitly identified panel speaker before validation`, async () => {
            reset(provider); const original = sdt.normalizeMangaSegment(page()), before = JSON.stringify(original);
            const response = page(); response.panels[0].characters[0].bubbles = [];
            response.panels[0].bubbles = [{ ...bubble('请把资料放到桌上。'), speaker_id: 'C1' }];
            const responseBefore = JSON.stringify(response); mockRefinement(response);
            const result = await sdt.runSegmentAiRefinement(original, '把这句台词归给艾达');
            assert.equal(manga.splitMangaText(result.scene, false).text, '');
            assert.equal(manga.splitMangaText(result.characters[0].caption, false).text, '请把资料放到桌上。');
            assert.deepEqual(clone(result.mangaPage.panels[0].bubbles), []);
            assert.doesNotMatch(result.characters[0].caption, /speaker_id/);
            assert.equal(JSON.stringify(original), before); assert.equal(JSON.stringify(response), responseBefore);
            assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
        });
    }
    await test('refinement speaker routing rejects conflicting legacy Text even beside an explicit empty array', async () => {
        reset(); const original = sdt.normalizeMangaSegment(page()), response = page();
        response.panels[0].characters[0].bubbles = [];
        response.panels[0].characters[0].positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 旧格式留存文字。';
        response.panels[0].bubbles = [{ ...bubble('这是新归属的文字。'), speaker_id: 'C1' }]; mockRefinement(response);
        const before = JSON.stringify(original);
        await assert.rejects(sdt.runSegmentAiRefinement(original, '修改台词'), error => {
            assert.equal(error.code, 'MANGA_BUBBLE_SPEAKER'); assert.match(error.rawOutput, /旧格式留存文字/); return true;
        });
        assert.equal(JSON.stringify(original), before);
        assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
    });
    await test('refinement ownership failure after a successful speaker route exposes original response ownership', async () => {
        reset(); const original = sdt.normalizeMangaSegment(page()), before = JSON.stringify(original), response = page();
        response.panels[0].characters[0].bubbles = [];
        response.panels[0].bubbles = [{ ...bubble('可以明确归属的台词。'), speaker_id: 'C1' }];
        response.page.bubbles = [bubble('仍然放错位置的台词。')]; mockRefinement(response);
        await assert.rejects(sdt.runSegmentAiRefinement(original, '核对台词归属'), error => {
            assert.equal(error.code, 'MANGA_BUBBLE_OWNERSHIP');
            const raw = JSON.parse(error.rawOutput)[0];
            assert.deepEqual(clone(raw.panels[0].bubbles), response.panels[0].bubbles);
            assert.deepEqual(clone(raw.panels[0].characters[0].bubbles), []);
            assert.deepEqual(clone(raw.page.bubbles), response.page.bubbles);
            return true;
        });
        assert.equal(JSON.stringify(original), before);
        assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
    });
    await test('refinement preserves explicit offscreen voices instead of routing them to a visible actor', async () => {
        reset(); const original = sdt.normalizeMangaSegment(page()), response = page();
        response.panels[0].bubbles = [{ ...bubble('会议开始了。', 'offscreen'), speaker_id: 'C1' }]; mockRefinement(response);
        const result = await sdt.runSegmentAiRefinement(original, '保留画外提醒');
        assert.equal(manga.splitMangaText(result.scene, false).text, '会议开始了。');
        assert.equal(manga.splitMangaText(result.characters[0].caption, false).text, '资料已收到。');
        assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
    });
    await test('refinement never guesses a panel speaker from actor count or an unmatched identity', async () => {
        for (const speakerId of [undefined, 'C999']) {
            reset(); const original = sdt.normalizeMangaSegment(page()), before = JSON.stringify(original), response = page();
            response.panels[0].characters[0].bubbles = [];
            response.panels[0].bubbles = [{ ...bubble('没有可靠说话人。'), ...(speakerId ? { speaker_id: speakerId } : {}) }];
            mockRefinement(response);
            await assert.rejects(sdt.runSegmentAiRefinement(original, '核对说话人'), error => {
                assert.match(error.message, /归属|说话|speaker/i); assert.match(error.rawOutput, /没有可靠说话人/); return true;
            });
            assert.equal(JSON.stringify(original), before);
            assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
        }
    });
    await test('refinement refuses to invent an order between routed and existing actor text', async () => {
        reset(); const original = sdt.normalizeMangaSegment(page()), before = JSON.stringify(original), response = page();
        response.panels[0].bubbles = [{ ...bubble('另一句尚无次序的文字。'), speaker_id: 'C1' }]; mockRefinement(response);
        await assert.rejects(sdt.runSegmentAiRefinement(original, '归属台词'), error => {
            assert.equal(error.code, 'MANGA_BUBBLE_SPEAKER'); assert.match(error.rawOutput, /另一句尚无次序的文字/); return true;
        });
        assert.equal(JSON.stringify(original), before);
        assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
    });
    for (const provider of ['custom', 'openai']) {
        await test(`${provider} actual SDT refinement rejects newly misplaced speech before replacing the page`, async () => {
            reset(provider); const original = sdt.normalizeMangaSegment(page()), before = JSON.stringify(original);
            const invalid = page(); invalid.page.bubbles = [bubble('办公室里有人说话。')]; mockRefinement(invalid);
            await assert.rejects(sdt.runSegmentAiRefinement(original, '保持递交资料的动作'), error => {
                assert.match(error.message, /归属/); assert.match(error.rawOutput, /办公室里有人说话。/); return true;
            });
            assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
            assert.equal(JSON.stringify(original), before);
        });
    }
    await test('unchanged historical misplaced speech remains editable while a new misplaced line is rejected', async () => {
        reset(); const previous = page(); previous.panels[0].bubbles = [bubble('历史保存的台词。')];
        const original = sdt.normalizeMangaSegment(previous), before = JSON.stringify(original);
        const changedOutfit = clone(previous); changedOutfit.panels[0].characters[0].outfit = 'blue jacket';
        mockRefinement(changedOutfit);
        const result = await sdt.runSegmentAiRefinement(original, '换上蓝色外套');
        assert.match(result.scene, /历史保存的台词。/); assert.match(result.characters[0].caption, /blue jacket/);
        assert.ok(result.mangaWarnings.some(warning => /归属|人物/.test(warning)));
        assert.equal(calls, 1); assert.equal(JSON.stringify(original), before);
        const newLine = clone(changedOutfit); newLine.panels[0].bubbles[0].text = '新产生的台词。'; mockRefinement(newLine);
        await assert.rejects(sdt.runSegmentAiRefinement(original, '换上蓝色外套'), /归属/);
        assert.equal(calls, 2); assert.equal(saves, 0); assert.equal(images, 0);
    });
    await test('refinement keeps explicit bubble clearing authoritative without legacy text recovery', async () => {
        reset(); const previous = page();
        previous.panels[0].characters[0].positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 旧文字。';
        const original = sdt.normalizeMangaSegment(previous), cleared = clone(previous);
        cleared.panels[0].characters[0].bubbles = [];
        mockRefinement(cleared);
        const result = await sdt.runSegmentAiRefinement(original, '清空气泡文字');
        assert.doesNotMatch(result.characters[0].caption, /旧文字|资料已收到/);
        assert.equal(manga.splitMangaText(result.characters[0].caption, false).text, '');
        assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0);
    });
    await test('actual refinement modal submit keeps failed edits open, shows raw diagnostic and restores retry button', async () => {
        reset(); const original = sdt.normalizeMangaSegment(page()), before = JSON.stringify(original);
        const invalid = page(); invalid.page.bubbles = [bubble('新返回的台词。')]; mockRefinement(invalid);
        const wrapper = new Element(), submit = new Element(), input = { value: '保持递交资料的动作', focus() {} };
        const originalHtml = '<i class="fa-solid fa-wand-magic-sparkles"></i> 重新构思并生图';
        submit.innerHTML = originalHtml;
        let handler, closed = 0, persisted = 0, shown, badges = 0, mounted = 0;
        submit.addEventListener = (event, callback) => { if (event === 'click') handler = callback; };
        const modal = new Element();
        modal.querySelector = selector => selector === '#rbq-sdt-refiner-submit' ? submit
            : selector === '#rbq-sdt-refine-input' ? input : null;
        modal.remove = () => { closed++; };
        Object.assign(sdt, { document: { createElement: () => modal, getElementById: () => null,
            body: { appendChild: element => { assert.equal(element, modal); mounted++; } } },
            escapeHtml: value => String(value), toastr: { info() {}, error() {}, warning() {}, success() {} },
            setCardLoadingState() {}, renderCardBadges: () => { badges++; },
            renderTaggerDebugInfo: (target, diagnostic) => { assert.equal(target, wrapper); shown = diagnostic; },
            persistSegmentEdits: () => { persisted++; },
            generateSdtImage: async () => { images++; throw new Error('Unexpected image generation'); } });
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function openSegmentAiRefinerModal('),
            sdtSource.indexOf('    function openSegmentManualTagModal(')), sdt);
        sdt.openSegmentAiRefinerModal(wrapper, original);
        assert.equal(mounted, 1); assert.equal(typeof handler, 'function');
        await handler();
        assert.equal(calls, 1); assert.equal(saves, 0); assert.equal(images, 0); assert.equal(persisted, 0);
        assert.equal(closed, 0); assert.equal(JSON.stringify(original), before); assert.equal(badges, 1);
        assert.equal(shown.isError, true); assert.match(shown.reason, /归属/); assert.match(shown.rawOutput, /新返回的台词。/);
        assert.equal(submit.disabled, false); assert.equal(submit.innerHTML, originalHtml);
    });
    console.log(`\n${passed} SDT manga diagnostic tests passed; no live calls.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
