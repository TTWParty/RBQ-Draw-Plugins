/** Offline comparison against the user's actual v1.1 preset and optional RBQ host. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const presetPath = process.argv[2];
if (!presetPath) throw new Error('Usage: node test/compare-manga-v11.js /path/to/v1.1.json [/path/to/host/index.js]');
const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, fixture, RBQ, settings, mangaSource } = new Function('require', '__dirname', harness +
    '\nreturn {manga,fixture,RBQ,settings,mangaSource};')(require, __dirname);
const script = preset.extensions.tavern_helper.scripts.find(s => s.name === '漫画台 v1.1').content;
const original = vm.createContext({ nonEmpty: value => !!String(value || '').trim() });
vm.runInContext(script.slice(script.indexOf('  function clampCenter('), script.indexOf('  function parseImageBlock(')), original);
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
const normalizedStyle = value => value.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
// Our compiler puts the final Text marker on a new line; compare the visual
// prefix and literal text independently without normalizing the dialogue.
const captionView = value => {
    const marker=/\bText[ \t]*[:：]/i.exec(value);
    return {visual:normalizedStyle((marker?value.slice(0,marker.index):value).replace(/[,，]\s*$/,'')),
        text:marker?value.slice(marker.index+marker[0].length).trim():''};
};
vm.runInContext('globalThis.styles = COMIC_STYLES;', manga);
for (const [style, name] of [['monochrome','画风-黑白'],['soft_color','画风-柔光圆润']]) {
    test('raw '+style+' positive and negative libraries match the original preset', () => {
        const entry = preset.prompts.find(p => p.name === name);
        const parts = entry.content.match(/\[正面\]([\s\S]*?)\[负面\]([\s\S]*)/);
        assert.equal(normalizedStyle(manga.styles[style].positive),normalizedStyle(parts[1]));
        assert.equal(normalizedStyle(manga.styles[style].negative),normalizedStyle(parts[2]));
    });
}
for (const positioning of ['auto','manual']) {
    test('nested '+positioning+' compilation matches original dialogue, SFX, appearance order and centers', () => {
        const input = fixture(); input.position_mode = positioning;
        if(positioning==='manual') input.panels.forEach(p=>p.characters.forEach((c,i)=>{c.center={x:i?1:0,y:0.4};}));
        const originalResult=original.parseV83ImageProtocol(JSON.stringify(input));
        assert.equal(originalResult.ok,true);
        const compiled=manga.compileMangaPage(input);
        assert.equal(compiled.base,originalResult.base.prompt);
        assert.equal(compiled.useCoords,originalResult.positionMode==='manual');
        assert.deepEqual(clone(compiled.characters.map(c=>({positive:captionView(c.caption),negative:c.uc,panel:c.panelId,characterId:c.characterId,center:c.center}))),
            clone(originalResult.characters.map(c=>({positive:captionView(c.positive),negative:c.negative,panel:c.panel,characterId:c.characterId,
                center:positioning==='manual'?c.center:{x:0.5,y:0.5}}))));
    });
}
test('single silent page and multi-person repeated appearances retain original slot semantics', () => {
    const input=fixture();input.panels=[input.panels[2]];input.page={base:'comic, 1 panel, no humans'};
    const old=original.parseV83ImageProtocol(JSON.stringify(input)),current=manga.compileMangaPage(input);
    assert.equal(old.ok,true);assert.equal(current.base,old.base.prompt);assert.equal(current.characters.length,0);
});
test('legacy dialogue mode retains the original bubble direction, shape, grouping and layout rules', () => {
    const previousMode = settings._mangaMode.dialogueMode;
    settings._mangaMode.dialogueMode = 'legacy';
    const current = RBQ.api.mangaProtocol.systemPrompt();
    const shapes = preset.prompts.find(p => p.identifier === 'bubble_adaptive').content;
    const text = preset.prompts.find(p => p.identifier === 'dialogue_rules').content;
    for (const token of ['本格画面坐标', '镜头一变', '破線吹き出し', '波打つ吹き出し',
        '四角い吹き出し', 'しっぽなしの楕円吹き出し', '連結吹き出し', '一条尾巴']) {
        assert.ok(shapes.includes(token), 'original rule: ' + token);
        assert.ok(current.includes(token), 'legacy rule: ' + token);
    }
    for (const token of ['*……*', '【……】', '{……}', '右→左', 'Layout', '一个空行']) {
        assert.ok(text.includes(token), 'original contract: ' + token);
        assert.ok(current.includes(token), 'legacy contract: ' + token);
    }
    assert.match(current, /不(?:写|描述)切口怎么挖/);
    assert.ok(current.includes('缩小组内间距'));
    settings._mangaMode.dialogueMode = previousMode;
});
test('new legacy Text tails preserve literal protocol examples like the original compiler', () => {
    const input = fixture();
    input.panels = [input.panels[0]];
    input.page.base = 'comic, 1 panel';
    input.page.non_character = 'BubbleType: ナレーション枠, Layout: 横書き\nText: SFX: 擬音, Text: 这是页眉中的示例。';
    input.panels[0].non_character = '';
    const example = 'BubbleType: 通常吹き出し, Layout: 縦書き, Text: 这是字段示例。\n\n下一句。';
    input.panels[0].characters.forEach(c => {
        c.positive = 'girl, standing, BubbleType: 通常吹き出し, 右上, Layout: 縦書き\nText: ' + example;
    });
    const old = original.parseV83ImageProtocol(JSON.stringify(input));
    assert.equal(old.ok, true);
    const resolved = RBQ.api.mangaProtocol.resolveAppearances([input], [], [], [], { dialogueMode: 'legacy', style: 'soft_color' })[0];
    const current = manga.compileMangaPage(resolved);
    assert.equal(captionView(current.base).text, captionView(old.base.prompt).text);
    assert.deepEqual(clone(current.characters.map(c => captionView(c.caption).text)), clone(old.characters.map(c => captionView(c.positive).text)));
});
if (process.argv[3]) {
    const hostSource=fs.readFileSync(process.argv[3],'utf8');
    test('real host payload builder forwards each request context and preserves selected model/parameters', () => {
        const contexts=[];
        const host=vm.createContext({ getSettings:()=>({negative:'bad hands',naiSampler:'k_euler',naiCfgRescale:0.25}),
            getModeConnectionSettings:()=>({model:'nai-diffusion-4-5-full'}),
            getModeImageSettings:()=>({width:832,height:1216,steps:28,cfg:4.7,seed:42}),naiPreciseRefs:[],naiVibes:[],
            window:{RBQ:{emit:(event,payload,context)=>{contexts.push({event,context});return payload;}}} });
        vm.runInContext(hostSource.slice(hostSource.indexOf('function buildNaiV4Payload('),hostSource.indexOf('function fileToBase64Simple(')),host);
        const a={meta:{sdtCharacterData:{characters:['first']}}},b={meta:{sdtCharacterData:{characters:['second']}}};
        const p=host.buildNaiV4Payload('first',a);host.buildNaiV4Payload('second',b);
        assert.equal(contexts[0].context,a);assert.equal(contexts[1].context,b);
        assert.equal(p.model,'nai-diffusion-4-5-full');assert.equal(p.parameters.seed,42);
        assert.equal(p.parameters.steps,28);assert.equal(p.parameters.scale,4.7);
        // Execute the real emit method, including old one-argument plugin compatibility.
        const emitStart=hostSource.indexOf('    emit(event, payload, context)');
        const emitEnd=hostSource.indexOf('    registerCleanup(',emitStart);
        const emit=vm.runInNewContext('({' + hostSource.slice(emitStart,emitEnd) + '})').emit;
        let forwarded;
        const bus={hooks:{test:[payload=>({...payload,oldPlugin:true}),(payload,context)=>{forwarded=context;return payload;}]}};
        assert.equal(emit.call(bus,'test',{},a).oldPlugin,true);assert.equal(forwarded,a);
        assert.match(hostSource,/buildNaiV4Payload\(finalPrompt, \{ prompt, reason, meta \}\)/);
        assert.match(hostSource,/buildComfyUiWorkflow\(finalPrompt, \{ prompt, reason, meta \}\)/);
    });
}
console.log(`\n${passed} original-preset/host comparison tests passed.`);
