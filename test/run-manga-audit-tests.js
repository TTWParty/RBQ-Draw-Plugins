/** Cross-entry audit regressions. Execute production functions; no live model/image calls. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const { manga, sdt, settings, RBQ, payload, mangaHook, sdtHook, sdtSource, fixture } =
    new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,payload,mangaHook,sdtHook,sdtSource,fixture};')(require, __dirname);
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); console.log('PASS ' + name); passed++; }
function page(people) {
    return {format:'nai5-comic',anchor:{text:'她走进房间，拿起书，转身离开。'},page:{base:'comic'},panels:people.map((c,i)=>({
        id:'P'+(i+1),description:'panel, room',characters:[{character_id:'C1',name:'Ami (original)',base:'girl, silver hair',outfit:'white shirt',positive:'standing',negative:'',...c}]
    }))};
}
function memory() {
    settings._smartDrawTrigger = {_mangaActive:true,enhancedContext:'v_manga',characterMemoryEnabled:true,characterProfiles:{}};
}
test('original identity suffix belongs to rendered/stored name, canonical key only matches records', () => {
    memory();
    assert.equal(sdt.ensureCharacterNameTag('Ami (original)','girl'), 'Ami (original), girl');
    assert.equal(sdt.ensureCharacterNameTag('Ami (original)','Ami, girl'), 'Ami (original), girl');
    assert.equal(sdt.ensureCharacterNameTag('Ami','Ami (original), girl'), 'Ami (original), girl');
    const result=sdt.normalizeTaggerResult({shouldDraw:true,segments:[page([{}])]},[],{messageId:1});
    assert.equal(sdt.getCharacterProfile('Ami').baseTags,'Ami (original), girl, silver hair');
    assert.equal(sdt.getCharacterProfile('Ami'),sdt.getCharacterProfile('Ami (original)'));
    assert.match(result.characters[0].caption,/^Ami \(original\), girl/);
});
test('fan identity weights are identical on ordinary first render, reuse and manga', () => {
    memory();
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function mergeCharacterCaption('),sdtSource.indexOf('    function collectCharacterCardInfo(')),sdt);
    const name='Alice (Example Series)';
    settings._smartDrawTrigger._mangaActive=false;settings._smartDrawTrigger.enhancedContext='off';
    const first=sdt.mergeCharacterCaption(name,'girl','white shirt','standing','');
    const again=sdt.mergeCharacterCaption(name,'wrong appearance','','standing','');
    assert.equal(first,'2::Alice (Example Series)::, girl, white shirt, standing');
    assert.equal(again,first);
    const resolved=RBQ.api.mangaProtocol.resolveAppearances([page([{name,base:'girl'}])]);
    assert.equal(manga.compileMangaPage(resolved[0]).characters[0].caption,first);
    assert.equal(sdt.getCharacterProfile(name).baseTags,'Alice (Example Series), girl');
    assert.equal(sdt.renderCharacterMemoryBase(name,'2::Alice (Example Series)::, girl, Text: Alice (Example Series)'),
        '2::Alice (Example Series)::, girl, Text: Alice (Example Series)');
});
test('known name renders with empty appearance and partial structured fields still inherit', () => {
    const p=page([{base:'',outfit:''},{base:'girl, silver hair',outfit:'blue coat'},{base:''}]);
    delete p.panels[2].characters[0].outfit;
    const resolved=RBQ.api.mangaProtocol.resolveAppearances([p])[0];
    assert.equal(resolved.panels[0].characters[0].base,'Ami (original)');
    assert.match(resolved.panels[1].characters[0].base,/silver hair/);
    assert.equal(resolved.panels[2].characters[0].outfit,'blue coat');
});
test('stable character_id inherits omitted names across pages without inventing ambiguous matches', () => {
    const first=page([{name:'Ami (original)'}]);
    const second=page([{name:'',base:'',outfit:''}]);
    const pages=RBQ.api.mangaProtocol.resolveAppearances([first,second]);
    assert.equal(pages[1].panels[0].characters[0].name,'Ami (original)');
    assert.equal(pages[1].panels[0].characters[0].outfit,'white shirt');
    const collision=page([{name:'Ami (original)'},{name:'Mei (original)'},{name:'',base:'',outfit:''}]);
    const result=RBQ.api.mangaProtocol.resolveAppearances([collision])[0];
    assert.equal(result.panels[2].characters[0].name,'');
    assert.equal(result.panels[2].characters[0].base,'');
});
test('first-time card option works with memory disabled and group reference excludes unrelated cards', () => {
    memory();
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function collectCharacterCardInfo('),sdtSource.indexOf('    async function importCharacterFromCurrentCard(')),sdt);
    const cards=[{name:'Ami',avatar:'a.png',description:'silver hair'}, {name:'Mei',avatar:'m.png',description:'brown hair'},
        {name:'Unrelated',avatar:'u.png',description:'must not be included'}];
    const prev=RBQ.api.getContext;
    RBQ.api.getContext=()=>({groupId:'g',groups:[{id:'g',members:['a.png','m.png']}],characters:cards});
    settings._smartDrawTrigger.injectCharacterCard=true;
    sdt.updateCharacterProfile('Ami','Ami (original), girl','white shirt');
    settings._smartDrawTrigger.characterMemoryEnabled=false;
    assert.deepEqual(clone(sdt.collectCharacterCardInfo()).map(c=>c.name),['Ami','Mei']);
    settings._smartDrawTrigger.characterMemoryEnabled=true;
    assert.deepEqual(clone(sdt.collectCharacterCardInfo()).map(c=>c.name),['Mei']);
    RBQ.api.getContext=prev;
});
test('switching manga mode during a request rejects its response before saving', () => {
    memory();
    const context=sdt.captureMangaRequestContext(null,1);
    settings._smartDrawTrigger._mangaActive=false;settings._smartDrawTrigger.enhancedContext='off';
    assert.throws(()=>sdt.normalizeTaggerResult({shouldDraw:true,segments:[page([{}])]},[],context),/漫画模式已切换/);
    assert.equal(Object.keys(sdt.getCharacterProfiles()).length,0);
});
test('global negative edits survive cache, serialization, hook order and explicit empty clear', () => {
    memory();
    for (const value of ['bad hands, edited exclusion','']) for (const order of [[sdtHook,mangaHook],[mangaHook,sdtHook]]) {
        const segment=sdt.normalizeMangaSegment(page([{}]));segment.negativePrompt=value;
        const wrapper={dataset:{}};
        sdt.cacheWrapperCharacterData(wrapper,segment);
        assert.equal(wrapper.dataset.rbqSdtNegative,value);
        assert.equal(sdt.sanitizeSdtResult(segment).negativePrompt,value);
        sdt.prepareNaiCharData({mangaPage:true,characters:JSON.parse(wrapper.dataset.rbqSdtCharData),negativePrompt:wrapper.dataset.rbqSdtNegative});
        let result=payload('comic');result.parameters.negative_prompt='stale global';
        result.parameters.v4_negative_prompt.caption.base_caption='stale global';
        for (const hook of order) result=hook(result);
        assert.doesNotMatch(result.parameters.negative_prompt,/stale global/);
        assert.equal(result.parameters.v4_negative_prompt.caption.base_caption,result.parameters.negative_prompt);
        if (value) assert.match(result.parameters.negative_prompt,/edited exclusion/);
        assert.match(result.parameters.negative_prompt,/bad anatomy/, 'selected manga style still applies');
        const unrelated=payload('unrelated');sdtHook(unrelated);
        assert.equal(unrelated.parameters.negative_prompt,'text, bad hands');
    }
});
test('non-character protocol fields reject objects instead of drawing object Object', () => {
    for (const level of ['page','panel']) {
        const p=page([{}]); (level==='page'?p.page:p.panels[0]).non_character={Text:'incorrect field type'};
        assert.throws(()=>manga.compileMangaPage(p),/non_character.*字符串/);
    }
});
test('all supported styles preserve model choice, text, slot order and spread dimensions', () => {
    const prev=clone(settings._mangaMode);
    try {
        for (const style of ['monochrome','soft_color','custom']) for (const gutter of ['bleed','framed','splash','black_line']) {
            Object.assign(settings._mangaMode,{enabled:true,style,gutter,autoSpread:true,customPositive:'custom style',customNegative:'custom exclusion'});
            const compiled=manga.compileMangaPage(fixture());
            sdt.prepareNaiCharData({mangaPage:true,characters:compiled.characters});
            const result=sdtHook(payload('comic, 見開きページ, Text: 保留原句'));
            assert.equal(result.model,'nai-diffusion-4-5-full');
            assert.equal(result.parameters.width,1216);assert.equal(result.parameters.height,832);
            assert.equal(result.parameters.v4_prompt.caption.char_captions.length,4);
            assert.match(result.input,/Text: 保留原句$/);
            assert.match(result.parameters.v4_prompt.caption.char_captions[0].char_caption,/Text: 一起回家吧。$/);
            assert.match(result.parameters.v4_prompt.caption.char_captions[1].char_caption,/Text: 好。$/);
            assert.equal(result.parameters.v4_prompt.use_coords,false);
            assert.deepEqual(clone(mangaHook(result)),clone(result));
        }
    } finally {settings._mangaMode=prev;}
});
console.log(`\n${passed} cross-entry manga audit tests passed.`);
