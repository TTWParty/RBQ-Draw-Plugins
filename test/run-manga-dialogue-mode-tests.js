/** Dialogue-generation contracts execute production schemas, prompts and hooks.
 * Replies are ordinary letter-handoff fixtures; no network or image credits. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook, mangaSource, sdtSource } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,mangaSource,sdtSource};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
const modes = ['structured', 'legacy'];
const planners = ['v_manga', 'v_manga_185', 'v_manga_161', 'v_manga_150'];
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }
async function asyncTest(name, run) { await run(); console.log('PASS ' + name); passed++; }
function reset(mode = 'structured', memory = false) {
    settings._mangaMode = { enabled:true, style:'soft_color', grammar:'cinema', gutter:'bleed', language:'zh-hans', autoSpread:true, antiHijack:true,
        dialogueMode:mode, studio:{ratio:'832x1216',panels:[],panelCountMode:'auto',useChatChars:false} };
    settings._smartDrawTrigger = { _mangaActive:true, enhancedContext:'v_manga', multiCharOutput:true, characterMemoryEnabled:memory,
        characterProfiles:{}, injectCharacterCard:true, provider:'custom', customUrl:'https://test.invalid/tagger',
        openaiBaseUrl:'https://test.invalid/v1',openaiModel:'fixture' };
    sdt.prepareNaiCharData(null);
}
const sourceBase = 'girl, korean, 35 years old, 180cm height, long blonde hair, brown eyes, custom facial mark';
const grayBase = 'girl, korean, 35 years old, 180cm height, long light grey hair, dark eyes, custom facial mark';
const sourceOutfit = 'beige trench coat, white shirt, blue denim jeans, layered clasp';
const grayOutfit = 'light grey trench coat, white shirt, dark denim jeans, layered clasp';
const bubble = (type, position, layout, text) => ({type,position,layout,text});
function scene(mode = 'structured', grayscale = false) {
    const person = { character_id:'C1', name:'Mina (original)', base:sourceBase, outfit:sourceOutfit, positive:'holding envelope, smiling', negative:'' };
    const panel = { id:'P1', description:'top panel, station, medium shot', non_character:'paper rustle', characters:[person] };
    const page = { base:'comic, 1girl, single panel, station, overhead light', non_character:'caption box' };
    if (mode === 'structured') {
        page.bubbles = [bubble('caption','top','horizontal','车站')];
        panel.bubbles = [bubble('sfx','bottom','vertical','沙沙')];
        person.bubbles = [bubble('speech','right-upper','vertical','信给你。'),bubble('thought','left-lower','vertical','终于等到了。')];
    } else {
        page.non_character += ', BubbleType: ナレーション枠, 上部, Layout: 横書き\nText: 车站';
        panel.non_character += ', SFX: 擬音, 吹き出しなし, 下部, Layout: 縦書き\nText: 沙沙';
        person.positive += ', BubbleType: 通常吹き出し, 右上, Layout: 縦書き, BubbleType: 思考の吹き出し, 左下, Layout: 縦書き\nText: 信给你。\n\n终于等到了。';
    }
    if (grayscale) person.render = {base:grayBase,outfit:grayOutfit};
    return { format:'nai5-comic', label:'递信', anchor:{text:'她递出信封，轻声说：“信给你。”'}, page, panels:[panel] };
}
function owners(schema) {
    return [schema.properties.page, schema.properties.panels.items, schema.properties.panels.items.properties.characters.items];
}
function hasBubbleProperty(value) {
    return !!value && typeof value === 'object' && (Object.hasOwn(value,'bubbles') || Object.values(value).some(hasBubbleProperty));
}
function assertPromptMode(prompt,mode) {
    if (mode === 'structured') {
        assert.match(prompt,/每句[^。\n]*必须[^。\n]*bubbles\[\]\.text/);
        assert.doesNotMatch(prompt,/【对白与非人物文字：原版 v1\.1 Text 协议】/);
    } else {
        assert.match(prompt,/【对白与非人物文字：原版 v1\.1 Text 协议】/);
        assert.match(prompt,/末尾唯一 Text:|最后只写一个 Text:/);
        assert.doesNotMatch(prompt,/每个 panel 和 character 都显式输出 bubbles/);
    }
}
function assertSchemaMode(schema, mode) {
    for (const owner of owners(schema)) {
        assert.equal(Object.hasOwn(owner.properties,'bubbles'),mode === 'structured');
        if (owner !== schema.properties.page) assert.equal(owner.required.includes('bubbles'),mode === 'structured');
    }
    const person = owners(schema)[2];
    assert.ok(person.required.includes('base')); assert.ok(person.required.includes('outfit')); assert.ok(person.required.includes('positive'));
    if (mode === 'legacy') {
        assert.match(person.properties.positive.description,/Text/);
        assert.match(owners(schema)[0].properties.non_character.description,/Text/);
        assert.match(owners(schema)[1].properties.non_character.description,/Text/);
    }
}
reset();

test('new stores and existing settings without a dialogue option migrate to structured generation', () => {
    const prior = settings._mangaMode;
    delete settings._mangaMode;
    assert.equal(vm.runInContext('getStore().dialogueMode',manga),'structured');
    settings._mangaMode = clone(prior);
    delete settings._mangaMode.dialogueMode;
    assert.equal(vm.runInContext('getStore().dialogueMode',manga),'structured');
    assert.equal(settings._mangaMode.dialogueMode,'structured');
    settings._mangaMode.dialogueMode = 'unsupported old option';
    assert.equal(vm.runInContext('getStore().dialogueMode',manga),'structured');
    settings._mangaMode.dialogueMode = 'legacy';
    assert.equal(vm.runInContext('getStore().dialogueMode',manga),'legacy');
    reset();
});
test('structured-bubble query reads the current choice while captured settings stay independent', () => {
    assert.equal(RBQ.api.mangaProtocol.usesStructuredBubbles(),true);
    const captured = RBQ.api.mangaProtocol.captureRenderSettings();
    assert.equal(captured.dialogueMode,'structured');
    settings._mangaMode.dialogueMode = 'legacy';
    assert.equal(RBQ.api.mangaProtocol.usesStructuredBubbles(),false);
    assert.equal(RBQ.api.mangaProtocol.captureRenderSettings().dialogueMode,'legacy');
    assert.equal(captured.dialogueMode,'structured');
    reset();
});
test('shared schemas switch only the generation format and accept an explicit store snapshot', () => {
    for (const mode of modes) {
        settings._mangaMode.dialogueMode = mode === 'legacy' ? 'structured' : 'legacy';
        const store = {...settings._mangaMode,dialogueMode:mode,style:'monochrome'};
        const schema = RBQ.api.mangaProtocol.segmentSchema(store);
        assertSchemaMode(schema,mode);
        assert.equal(owners(schema)[2].properties.render.type,'object');
        assert.equal(owners(schema)[2].properties.state.type,'object');
    }
    reset();
});
test('human-readable output schemas and SDT tool contracts agree with each dialogue mode', () => {
    for (const mode of modes) {
        reset(mode);
        const output = RBQ.api.mangaProtocol.outputSchema(settings._mangaMode);
        assert.equal(hasBubbleProperty(output),mode === 'structured');
        const tool = sdt.getDrawSpecTool(settings._smartDrawTrigger).function.parameters;
        assertSchemaMode(tool.properties.segments.items,mode);
        assert.equal(hasBubbleProperty(sdt.getMangaOutputSchema()),mode === 'structured');
        assert.equal(tool.properties.character_memory,undefined,'memory toggle is independent');
    }
    reset();
});
test('main system prompts use the chosen dialogue fields without changing identity or grayscale rules', () => {
    const prompts = {};
    for (const mode of modes) {
        reset(mode); settings._mangaMode.style = 'monochrome';
        const prompt = manga.buildMangaSystemPrompt(settings._mangaMode);
        prompts[mode] = prompt;
        for (const token of ['name_tag','base','outfit','render:{base,outfit}']) assert.ok(prompt.includes(token),token);
        if (mode === 'structured') assert.match(prompt,/bubbles\[\]\.text/);
        else {
            assert.match(prompt,/Text:/);
            assert.doesNotMatch(prompt,/positive、non_character 只写视觉说明，不写 BubbleType\/Layout\/Text/);
            assert.doesNotMatch(prompt,/每个 panel 和 character 都显式输出 bubbles/);
        }
    }
    assert.notEqual(prompts.legacy,prompts.structured);
    reset();
});
test('evaluated legacy instructions show valid JSON escapes whose decoded example contains actual blank lines', () => {
    reset('legacy');
    const prompt = manga.buildMangaSystemPrompt(settings._mangaMode);
    assert.ok(prompt.includes('JSON 字符串中用 \\n\\n 表示'));
    const exampleStart = prompt.indexOf('格式示例（只借格式）：positive=');
    assert.ok(exampleStart>=0);
    const tail = prompt.slice(exampleStart);
    const quoted = tail.match(/^格式示例（只借格式）：positive=("(?:[^"\\]|\\.)*")/);
    assert.ok(quoted,'the positive example must be one valid JSON string literal');
    assert.ok(quoted[1].includes('\\n\\n'));
    assert.ok(!quoted[1].includes('\n'),'no raw newline inside the JSON string example');
    const parsed = JSON.parse(quoted[1]);
    assert.match(parsed,/Text: 信收到了。\n\n终于等到了。$/);
    assert.equal((parsed.match(/Text:/g) || []).length,1);
    reset();
});
test('SDT character-card supplement follows the selected text contract instead of overriding it', () => {
    for (const mode of modes) {
        reset(mode);
        const prompt = sdt.getSystemPromptWithPresets(settings._smartDrawTrigger,true);
        const card = prompt.slice(prompt.indexOf('【漫画角色卡信息参考指令】'));
        assert.ok(card.includes('未知不猜，已有不漏'));
        assert.ok(card.includes('完整身份外貌')); assert.ok(card.includes('完整当前衣着'));
        if (mode === 'structured') assert.match(card,/bubbles\[\]\.text/);
        else {
            assert.match(card,/Text:/);
            assert.doesNotMatch(card,/人物对白\/心声逐泡写入该人物 bubbles\[\]\.text，不写入 positive/);
        }
    }
    reset();
});
test('both model formats compile the same scene, literal utterances and per-character captions', () => {
    const structured = scene('structured'), legacy = scene('legacy');
    assert.deepEqual(clone(manga.compileMangaPage(structured)),clone(manga.compileMangaPage(legacy)));
    const compiled = manga.compileMangaPage(structured);
    assert.match(compiled.base,/Text: 车站\n\n沙沙$/);
    assert.match(compiled.characters[0].caption,/Text: 信给你。\n\n终于等到了。$/);
});
test('switching generation mode leaves old structured and Text snapshots unchanged on redraw', () => {
    for (const oldMode of modes) {
        reset(oldMode);
        const segment = sdt.normalizeMangaSegment(scene(oldMode));
        segment.mangaRenderSettings = RBQ.api.mangaProtocol.captureRenderSettings();
        const before = JSON.stringify(segment), caption = segment.characters[0].caption;
        settings._mangaMode.dialogueMode = oldMode === 'legacy' ? 'structured' : 'legacy';
        const cached = clone(sdt.sanitizeSdtResult(segment));
        sdt.prepareNaiCharData(cached);
        const request = payload(cached.scene);
        request.parameters.seed = 123;
        const sent = mangaHook(sdtHook(request));
        assert.equal(sent.parameters.v4_prompt.caption.char_captions[0].char_caption,caption);
        assert.equal(sent.parameters.seed,123);
        assert.equal(cached.mangaRenderSettings.dialogueMode,oldMode);
        assert.equal(JSON.stringify(segment),before);
    }
    reset();
});
test('ordinary character memory and matching gray views are identical under both dialogue contracts', () => {
    const results = [];
    for (const mode of modes) {
        reset(mode,true); settings._mangaMode.style = 'monochrome';
        const context = sdt.captureMangaRequestContext(null,1);
        const result = sdt.normalizeTaggerResult({shouldDraw:true,segments:[scene(mode,true)]},[],context);
        const profile = sdt.getCharacterProfile('Mina');
        assert.equal(profile.baseTags,'Mina (original), ' + sourceBase);
        assert.equal(profile.currentOutfit,sourceOutfit);
        assert.equal(result.mangaRenderSettings.dialogueMode,mode);
        assert.match(result.characters[0].caption,/long light grey hair/);
        assert.doesNotMatch(result.characters[0].caption,/long blonde hair|beige trench coat/);
        assert.equal(sdt.getMangaRenderCacheRows().length,2);
        const nextPage = scene(mode,true);
        const person = nextPage.panels[0].characters[0];
        person.base = ''; person.outfit = ''; delete person.render;
        const next = sdt.normalizeTaggerResult({shouldDraw:true,segments:[nextPage]},[],sdt.captureMangaRequestContext(null,2));
        assert.equal(next.characters[0].caption,result.characters[0].caption);
        assert.equal(next.renderWarnings,undefined);
        results.push({base:profile.baseTags,outfit:profile.currentOutfit,caption:result.characters[0].caption});
    }
    assert.deepEqual(results[0],results[1]);
    reset();
});
test('a warm gray cache remains reusable when the next parse changes its dialogue generation mode', () => {
    for (const initialMode of modes) {
        reset(initialMode,true); settings._mangaMode.style = 'monochrome';
        const first = sdt.normalizeTaggerResult({shouldDraw:true,segments:[scene(initialMode,true)]},[],sdt.captureMangaRequestContext(null,1));
        const profileBefore = JSON.stringify(sdt.getCharacterProfile('Mina'));
        const cacheBefore = clone(sdt.getMangaRenderCacheRows());
        const nextMode = initialMode === 'legacy' ? 'structured' : 'legacy';
        settings._mangaMode.dialogueMode = nextMode;
        const nextPage = scene(nextMode);
        nextPage.panels[0].characters[0].base = '';
        nextPage.panels[0].characters[0].outfit = '';
        const second = sdt.normalizeTaggerResult({shouldDraw:true,segments:[nextPage]},[],sdt.captureMangaRequestContext(null,2));
        assert.equal(second.characters[0].caption,first.characters[0].caption);
        assert.equal(second.renderWarnings,undefined);
        assert.equal(second.mangaRenderSettings.dialogueMode,nextMode);
        assert.deepEqual(clone(sdt.getMangaRenderCacheRows()).map(row=>({name:row.name,field:row.field,source:row.source,value:row.value})),
            cacheBefore.map(row=>({name:row.name,field:row.field,source:row.source,value:row.value})));
        const profile = sdt.getCharacterProfile('Mina');
        const old = JSON.parse(profileBefore);
        assert.equal(profile.baseTags,old.baseTags); assert.equal(profile.nameTag,old.nameTag);
        assert.equal(profile.currentOutfit,old.currentOutfit); assert.deepEqual(clone(profile.wardrobe),old.wardrobe);
    }
    reset();
});
test('switching dialogue generation preserves every historical planner and selected planner setting', () => {
    reset();
    const before = Object.fromEntries(planners.map(id=>[id,RBQ.api.mangaProtocol.planningPrompt(id)]));
    for (const mode of modes) for (const planner of planners) {
        settings._mangaMode.dialogueMode = mode;
        settings._smartDrawTrigger.enhancedContext = planner;
        manga.syncMangaToSdt(settings._mangaMode);
        assert.equal(settings._smartDrawTrigger.enhancedContext,planner);
        assert.equal(sdt.getRequestEnhancedContext(settings._smartDrawTrigger),planner);
        assert.equal(RBQ.api.mangaProtocol.planningPrompt(planner),before[planner]);
    }
    reset();
});
test('settings and Studio controls save the same choice and synchronize without rewriting existing pages', () => {
    reset();
    const existing = scene('structured');
    settings._mangaMode.studio.panels = clone(existing.panels);
    settings._smartDrawTrigger.enhancedContext = 'v_manga_161';
    const before = JSON.stringify(settings._mangaMode.studio.panels), selectors = {}, handlers = {};
    for (const id of ['rbq-manga-dialogue-mode','mw-hdr-dialogue-mode']) selectors[id] = {
        value:'structured',addEventListener:(event,handler)=>{assert.equal(event,'change');handlers[id]=handler;}
    };
    const priorSave = RBQ.api.saveSettings, priorDocument = manga.document;
    let saves = 0;
    RBQ.api.saveSettings = ()=>{saves++;};
    manga.document = {getElementById:id=>selectors[id] || null};
    manga.card = {querySelector:selector=>selectors[selector.slice(1)]};
    manga.container = manga.card;
    try {
        vm.runInContext(mangaSource.slice(mangaSource.indexOf('    function updateUiState('),mangaSource.indexOf('    function injectUiIntoSdt(')),manga);
        for (const [owner,id] of [['card','rbq-manga-dialogue-mode'],['container','mw-hdr-dialogue-mode']]) {
            const start = mangaSource.indexOf(`        ${owner}.querySelector('#${id}')?.addEventListener`);
            assert.ok(start>=0,id);
            const end = mangaSource.indexOf('\n        });',start) + '\n        });'.length;
            vm.runInContext(mangaSource.slice(start,end),manga);
        }
        selectors['rbq-manga-dialogue-mode'].value = 'legacy';
        handlers['rbq-manga-dialogue-mode']({target:selectors['rbq-manga-dialogue-mode']});
        assert.equal(settings._mangaMode.dialogueMode,'legacy');
        assert.equal(selectors['mw-hdr-dialogue-mode'].value,'legacy');
        assert.equal(saves,1);
        assert.match(settings._smartDrawTrigger.customSystemPrompt,/Text:/);
        selectors['mw-hdr-dialogue-mode'].value = 'structured';
        handlers['mw-hdr-dialogue-mode']({target:selectors['mw-hdr-dialogue-mode']});
        assert.equal(settings._mangaMode.dialogueMode,'structured');
        assert.equal(selectors['rbq-manga-dialogue-mode'].value,'structured');
        assert.equal(saves,2);
        assert.match(settings._smartDrawTrigger.customSystemPrompt,/bubbles\[\]\.text/);
        assert.equal(settings._smartDrawTrigger.enhancedContext,'v_manga_161');
        assert.equal(JSON.stringify(settings._mangaMode.studio.panels),before);
    } finally {RBQ.api.saveSettings=priorSave;manga.document=priorDocument;reset();}
});

(async () => {
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callOpenAiCompatible('),sdtSource.indexOf('    async function callCustomHttp(')),sdt);
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function callCustomHttp('),sdtSource.indexOf('    async function callStructuredCompletion(')),sdt);
    Object.assign(sdt,{normalizeBaseUrl:value=>value,checkUrlSafety(){},logTaggerPayload(){},validateStructuredResult:result=>result,
        safeReadJsonResponse:async response=>response.json(),getActiveJailbreakPrompt:()=>'',applyPostProcessPrompt(){},buildThinkingParams:()=>({}),
        DRAW_SPEC_TOOL_RULE:'Submit final results via generate_draw_spec'});
    for (const mode of modes) for (const channel of ['custom HTTP','OpenAI JSON','OpenAI tool']) {
        await asyncTest(`${channel} sends consistent ${mode} instructions and contract once, then preserves all text in NAI`,async()=>{
            reset(mode);
            settings._smartDrawTrigger.provider = channel === 'custom HTTP' ? 'custom' : 'openai';
            settings._smartDrawTrigger.toolCallMode = channel === 'OpenAI tool';
            settings._smartDrawTrigger.squashMessages = false;
            const previousCollector = sdt.collectCharacterCardInfo;
            const previousGenerator = RBQ.api.generateImage, previousContextVersion = RBQ.api.generationContextVersion;
            const reply = {shouldDraw:true,reason:'递信与回应',segments:[scene(mode)]};
            let calls = 0;
            try {
                sdt.collectCharacterCardInfo = ()=>[{name:'Mina',description:'成年女性，金色长发、棕色眼睛，穿米色外套。'}];
                const check = body=>{
                    calls++;
                    const request = channel === 'custom HTTP' ? body : JSON.parse(body.messages.find(message=>message.role==='user').content);
                    const system = channel === 'custom HTTP' ? request.mangaInstruction : body.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
                    assertPromptMode(system,mode);
                    assert.equal(hasBubbleProperty(request.outputSchema),mode === 'structured');
                    assert.ok(request.characterCardInfo.length);
                    const cardTail = system.slice(system.indexOf('【漫画角色卡信息参考指令】'));
                    if (mode === 'structured') assert.match(cardTail,/bubbles\[\]\.text/);
                    else assert.match(cardTail,/末尾唯一 Text:/);
                    if (channel === 'OpenAI tool') {
                        const schema = body.tools[0].function.parameters.properties.segments.items;
                        assertSchemaMode(schema,mode);
                        assert.equal(body.tool_choice.function.name,'generate_draw_spec');
                    }
                    const json = channel === 'OpenAI tool'
                        ? {choices:[{message:{tool_calls:[{function:{name:'generate_draw_spec',arguments:JSON.stringify(reply)}}]}}]}
                        : channel === 'OpenAI JSON' ? {choices:[{message:{content:JSON.stringify(reply)}}]} : reply;
                    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>json};
                };
                sdt.smartFetch = async (_url,options)=>check(JSON.parse(options.body));
                sdt.callApiWithJsonFallback = async (_url,_options,body)=>check(body);
                const result = channel === 'custom HTTP' ? await sdt.callCustomHttp(1,{type:'auto'}) : await sdt.callOpenAiCompatible(1,{type:'auto'});
                assert.equal(calls,1);
                assert.equal(result.mangaRenderSettings.dialogueMode,mode);
                let images = 0;
                RBQ.api.generationContextVersion = 1;
                RBQ.api.generateImage = async (prompt,_reason,meta)=>{
                    images++;
                    let output = payload(prompt);
                    for (const hook of [mangaHook,sdtHook]) output = hook(output,{meta});
                    assert.match(output.input,/Text: 车站\n\n沙沙$/);
                    assert.match(output.parameters.v4_prompt.caption.char_captions[0].char_caption,/Text: 信给你。\n\n终于等到了。$/);
                    assert.equal((output.parameters.v4_prompt.caption.char_captions[0].char_caption.match(/Text:/g)||[]).length,1);
                    return {url:'ordinary-letter-fixture.png'};
                };
                const segment = result.segments[0];
                await sdt.generateSdtImage(segment,segment.scene,'ordinary-letter-dialogue');
                assert.equal(images,1); assert.equal(calls,1);
            } finally {
                sdt.collectCharacterCardInfo=previousCollector;RBQ.api.generateImage=previousGenerator;RBQ.api.generationContextVersion=previousContextVersion;reset();
            }
        });
    }
    await asyncTest('ordinary requests, prompts and tools remain identical when the inactive manga dialogue choice changes',async()=>{
        for (const channel of ['custom HTTP','OpenAI JSON','OpenAI tool']) {
            const sent = [], prompts = [], tools = [];
            for (const mode of modes) {
                reset(mode);
                settings._mangaMode.enabled = false;
                Object.assign(settings._smartDrawTrigger,{_mangaActive:false,enhancedContext:'off',injectCharacterCard:false,
                    provider:channel==='custom HTTP'?'custom':'openai',toolCallMode:channel==='OpenAI tool',squashMessages:false});
                prompts.push(sdt.getSystemPromptWithPresets(settings._smartDrawTrigger));
                tools.push(clone(sdt.getDrawSpecTool(settings._smartDrawTrigger)));
                let calls = 0;
                const check = body=>{
                    calls++;sent.push(clone(body));
                    const request = channel==='custom HTTP' ? body : JSON.parse(body.messages.find(message=>message.role==='user').content);
                    assert.equal(request.mangaInstruction,undefined);
                    assert.equal(hasBubbleProperty(request.outputSchema),false);
                    assert.equal(request.outputSchema.segments[0].format,undefined);
                    const reply = {shouldDraw:false,reason:'没有新增画面',segments:[]};
                    const json = channel==='OpenAI tool'
                        ? {choices:[{message:{tool_calls:[{function:{name:'generate_draw_spec',arguments:JSON.stringify(reply)}}]}}]}
                        : channel==='OpenAI JSON' ? {choices:[{message:{content:JSON.stringify(reply)}}]} : reply;
                    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>json};
                };
                sdt.smartFetch = async (_url,options)=>check(JSON.parse(options.body));
                sdt.callApiWithJsonFallback = async (_url,_options,body)=>check(body);
                const result = channel==='custom HTTP' ? await sdt.callCustomHttp(1,{type:'auto'}) : await sdt.callOpenAiCompatible(1,{type:'auto'});
                assert.equal(calls,1); assert.equal(result.shouldDraw,false);
            }
            assert.equal(prompts[0],prompts[1]);
            assert.deepEqual(tools[0],tools[1]);
            assert.deepEqual(sent[0],sent[1],channel);
        }
        reset();
    });
    await asyncTest('Studio uses the selected shared character and panel contract in one mocked completion', async () => {
        const previousCompletion = RBQ.api.callStructuredCompletion;
        try {
            for (const mode of modes) {
                reset(mode); let calls = 0;
                RBQ.api.callStructuredCompletion = async request => {
                    calls++;
                    const panel = request.tool.function.parameters.properties.panels.items;
                    const person = panel.properties.characters.items;
                    assert.equal(!!panel.properties.bubbles,mode === 'structured');
                    assert.equal(panel.required.includes('bubbles'),mode === 'structured');
                    assert.equal(!!person.properties.bubbles,mode === 'structured');
                    assert.equal(person.required.includes('bubbles'),mode === 'structured');
                    if (mode === 'legacy') {
                        assert.match(person.properties.positive.description,/Text/);
                        assert.match(panel.properties.non_character.description,/Text/);
                    }
                    const fieldsTail = request.messages[0].content.slice(request.messages[0].content.lastIndexOf('各格使用'));
                    if (mode === 'legacy') {
                        assert.match(fieldsTail,/Text:/);
                        assert.doesNotMatch(fieldsTail,/每个画格和人物都显式返回 bubbles 数组/);
                    } else assert.match(fieldsTail,/bubbles/);
                    const rawReply = JSON.stringify({panels:scene(mode).panels});
                    return {rawReply,rawOutput:rawReply};
                };
                const panels = await manga.requestStudioPanels(settings._mangaMode,'递信','她递出信封，说：“信给你。”',1);
                assert.equal(calls,1);
                assert.match(panels[0].characters[0].positive,/Text: 信给你。/);
            }
        } finally {RBQ.api.callStructuredCompletion = previousCompletion;reset();}
    });
    await asyncTest('Studio captures either dialogue contract before an in-flight switch and preserves its returned text',async()=>{
        const previousCompletion = RBQ.api.callStructuredCompletion;
        try {
            for (const mode of modes) {
                reset(mode); let calls = 0, release;
                const reply = {panels:scene(mode).panels};
                RBQ.api.callStructuredCompletion = request=>{
                    calls++;
                    assertPromptMode(request.messages[0].content,mode);
                    const panel = request.tool.function.parameters.properties.panels.items;
                    assert.equal(!!panel.properties.bubbles,mode==='structured');
                    assert.equal(panel.required.includes('bubbles'),mode==='structured');
                    return new Promise(resolve=>{release=()=>resolve({rawReply:JSON.stringify(reply),rawOutput:JSON.stringify(reply)});});
                };
                const pending = manga.requestStudioPanels(settings._mangaMode,'递信','她递出信封，说：“信给你。”',1);
                assert.equal(typeof release,'function');
                settings._mangaMode.dialogueMode = mode==='legacy'?'structured':'legacy';
                release();
                const panels = await pending;
                assert.equal(calls,1);
                assert.equal(!!panels[0].characters[0].bubbles,mode==='structured');
                settings._mangaMode.studio.panels = panels;
                const compiled = manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode));
                assert.match(compiled.characters[0].caption,/Text: 信给你。\n\n终于等到了。$/);
                assert.match(compiled.base,/Text: 沙沙$/);
            }
        } finally {RBQ.api.callStructuredCompletion=previousCompletion;reset();}
    });
    await asyncTest('SDT refinement follows the selected dialogue format and preserves its request snapshot', async () => {
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function runSegmentAiRefinement('),sdtSource.indexOf('    function setCardLoadingState(')),sdt);
        Object.assign(sdt,{checkUrlSafety(){},safeReadJsonResponse:async response=>response.json()});
        for (const mode of modes) {
            reset(mode); let calls = 0;
            sdt.smartFetch = async (_url,options) => {
                calls++;
                const system = JSON.parse(options.body).messages[0].content;
                const tail = system.slice(system.lastIndexOf('本次只修改用户指定的一页'));
                if (mode === 'legacy') {
                    assert.match(tail,/Text:/);
                    assert.doesNotMatch(tail,/本格动作 positive 与逐泡文字 bubbles/);
                } else assert.match(tail,/bubbles/);
                const reply = scene(mode);
                settings._mangaMode.dialogueMode = mode === 'legacy' ? 'structured' : 'legacy';
                return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(reply)}}]})};
            };
            const refined = await sdt.runSegmentAiRefinement(sdt.normalizeMangaSegment(scene(mode)),'保留递信与对白');
            assert.equal(calls,1);
            assert.equal(refined.mangaRenderSettings.dialogueMode,mode);
            assert.match(refined.characters[0].caption,/Text: 信给你。\n\n终于等到了。$/);
            assert.deepEqual(Object.keys(sdt.getCharacterProfiles()),[]);
        }
        reset();
    });
    console.log(`\n${passed} manga dialogue-mode tests passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
