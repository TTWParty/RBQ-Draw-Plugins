/** Studio dialogue ownership and empty-bubble regressions. Ordinary scenes only; no live services. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, settings, RBQ, payload, mangaHook, sdtHook } = new Function('require', '__dirname',
    harness + '\nreturn {manga,settings,RBQ,payload,mangaHook,sdtHook};')(require, __dirname);
let passed = 0, failed = 0;
async function test(name, run) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
const clone = value => JSON.parse(JSON.stringify(value));
const textOf = value => manga.splitMangaText(value, false).text;
const person = (id = 'C1') => ({ character_id: id, name: id === 'C1' ? 'Ada (original)' : 'Ben (original)',
    base: 'adult, short hair', outfit: 'white shirt', positive: 'standing', negative: '' });
const panel = overrides => ({ id: 'P1', position: 'top panel, wide', shot: 'medium shot', description: 'classroom',
    non_character: '', characters: [], ...overrides });
function compile(editor) {
    settings._mangaMode.studio.panels = [editor];
    return manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode));
}
const active = text => ({ type: 'speech', position: 'right-upper', layout: 'vertical', text });
const empty = () => ({ type: 'thought', position: 'left-lower', layout: 'horizontal', text: '  ' });
function structuredEditor() {
    const c = person(); c.bubbles = [empty(), active('信收到了。'), empty(),
        { type: 'thought', position: 'left-lower', layout: 'horizontal', text: '终于等到了。' }, empty()];
    return manga.studioPanelFromProtocol(panel({ bubbles: [], characters: [c] }));
}

(async () => {
    Object.assign(settings._smartDrawTrigger, { openaiBaseUrl: 'https://test.invalid/v1', openaiModel: 'fixture' });
    for (const mode of ['structured', 'legacy']) {
        Object.assign(settings._mangaMode, { dialogueMode: mode, style: 'soft_color' });
        await test(`characterless legacy narration survives request/editor/payload exactly once (${mode})`, async () => {
            RBQ.api.callStructuredCompletion = async () => ({ rawReply: JSON.stringify({ panels: [panel({
                non_character: 'BubbleType: ナレーション枠, 上部, Layout: 横書き\nText: 放学后。'
            })] }) });
            const editors = await manga.requestStudioPanels(settings._mangaMode, 'one panel', '放学后的空教室。', 1);
            assert.equal(editors[0].bubbleText, '放学后。');
            const result = compile(editors[0]);
            assert.equal(textOf(result.base), '放学后。');
            assert.equal(result.characters.length, 0);
            const context = { prompt: result.base, meta: { sdtSegment: { mangaPage: true,
                mangaTextCompiled: true, characters: result.characters } } };
            let request = payload(result.base);
            request = sdtHook(request, context); request = mangaHook(request, context);
            assert.equal(textOf(request.parameters.v4_prompt.caption.base_caption), '放学后。');
        });
        for (const type of ['caption', 'sfx', 'offscreen']) {
            await test(`legacy quick ${type} belongs to the panel when an actor is visible (${mode})`, () => {
                const editor = manga.studioPanelFromProtocol(panel({ characters: [person()],
                    bubbleType: type, bubbleLayout: 'horizontal', bubbleText: '咔哒。' }));
                assert.equal(editor._bubbleOwner, 'panel');
                const result = compile(editor);
                assert.equal(textOf(result.base), '咔哒。');
                assert.equal(textOf(result.characters[0].caption), '');
            });
        }
        await test(`saved quick utterance keeps its explicitly selected second speaker (${mode})`, () => {
            const editor = manga.studioPanelFromProtocol(panel({ characters: [person(), person('C2')],
                bubbleType: 'speech', bubbleText: '谢谢。' }));
            editor._bubbleOwner = 'C2';
            const result = compile(editor);
            assert.equal(textOf(result.base), '');
            assert.equal(textOf(result.characters[0].caption), '');
            assert.equal(textOf(result.characters[1].caption), '谢谢。');
        });
        await test(`unstructured historical quick text remains visible once (${mode})`, () => {
            const result = compile({ tags: 'empty classroom', bubbleType: 'caption', bubbleText: '放学后。' });
            assert.equal(textOf(result.base), '放学后。');
            assert.equal(result.characters.length, 0);
        });
        await test(`character and panel text do not duplicate the quick composer mirror (${mode})`, () => {
            const c = person(); c.positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: 信收到了。';
            const editor = manga.studioPanelFromProtocol(panel({ characters: [c],
                non_character: 'SFX: 擬音, 吹き出しなし, 下部, Layout: 横書き\nText: 咔哒。' }));
            const result = compile(editor);
            assert.equal(textOf(result.base), '咔哒。');
            assert.equal(textOf(result.characters[0].caption), '信收到了。');
        });
        await test(`empty structured entries do not determine quick controls (${mode})`, () => {
            const editor = structuredEditor();
            assert.equal(editor.bubbleType, 'speech');
            assert.equal(editor.bubbleLayout, 'vertical');
            assert.equal(editor.bubbleText, '信收到了。\n\n终于等到了。');
        });
        await test(`quick text edit keeps metadata aligned with the two visible bubbles (${mode})`, () => {
            const editor = structuredEditor();
            editor.bubbleText = '信已经收到了。\n\n终于等到这封信了。';
            manga.updateStudioBubble(editor, 'text');
            assert.deepEqual(clone(editor.characters[0].bubbles), [active('信已经收到了。'),
                { type: 'thought', position: 'left-lower', layout: 'horizontal', text: '终于等到这封信了。' }]);
            const result = compile(editor);
            assert.equal(textOf(result.characters[0].caption), editor.bubbleText);
            assert.equal(textOf(result.base), '');
        });
        for (const field of ['type', 'layout']) {
            await test(`quick ${field} changes the first actual bubble and keeps the second (${mode})`, () => {
                const editor = structuredEditor();
                editor[field === 'type' ? 'bubbleType' : 'bubbleLayout'] = field === 'type' ? 'whisper' : 'horizontal';
                manga.updateStudioBubble(editor, field);
                const bubbles = clone(editor.characters[0].bubbles);
                assert.equal(bubbles.length, 2);
                assert.equal(bubbles[0][field], field === 'type' ? 'whisper' : 'horizontal');
                assert.equal(bubbles[0].position, 'right-upper');
                assert.deepEqual(bubbles[1], { type: 'thought', position: 'left-lower', layout: 'horizontal', text: '终于等到了。' });
                assert.equal(textOf(compile(editor).characters[0].caption), '信收到了。\n\n终于等到了。');
            });
        }
        await test(`full-caption text edit also ignores empty placeholders (${mode})`, () => {
            const editor = structuredEditor(); const owner = editor.characters[0];
            manga.updateStudioVisualCaption(owner, 'positive', owner.positive.replace('信收到了。', '信已经收到了。'));
            assert.deepEqual(clone(owner.bubbles), [active('信已经收到了。'),
                { type: 'thought', position: 'left-lower', layout: 'horizontal', text: '终于等到了。' }]);
            assert.equal(textOf(compile(editor).characters[0].caption), '信已经收到了。\n\n终于等到了。');
        });
        await test(`explicit structured clear remains silent despite a stale quick field (${mode})`, () => {
            const c = person(); c.bubbles = [];
            const editor = manga.studioPanelFromProtocol(panel({ bubbles: [], characters: [c] }));
            editor.bubbleText = '旧的快捷框。';
            const result = compile(editor);
            assert.equal(textOf(result.base), '');
            assert.equal(textOf(result.characters[0].caption), '');
        });
    }
    console.log(`\n${passed} Studio dialogue ownership regressions passed, ${failed} failed.`);
    if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
