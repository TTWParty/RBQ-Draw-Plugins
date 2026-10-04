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
function segmentFor(people) {
    return sdt.normalizeMangaSegment(RBQ.api.mangaProtocol.resolveAppearances([page(people)])[0]);
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
        const segment=segmentFor([{}]);segment.negativePrompt=value;
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
test('edited pages persist to both cache and message data so reload/drawer cannot resurrect old tags', () => {
    memory();
    vm.runInContext(sdtSource.slice(sdtSource.indexOf('    function saveMsgExtraSdt('),sdtSource.indexOf('    function markSegmentAutoGenerated(')),sdt);
    const old=sdt.normalizeMangaSegment(page([{}]));
    settings._smartDrawTrigger.cache={key:{key:'key',segments:[clone(old),clone(old)]}};
    let extra=clone(settings._smartDrawTrigger.cache.key),writes=0;
    const previousGet=RBQ.api.getMessageExtra,previousSet=RBQ.api.setMessageExtra;
    RBQ.api.getMessageExtra=()=>extra;RBQ.api.setMessageExtra=(_id,_key,value)=>{writes++;extra=clone(value);};
    try {
        const edited=clone(old);edited.scene='edited page';edited.characters[0].caption='edited person';edited.negativePrompt='';
        const wrapper={dataset:{rbqSdtBaseKey:'key',rbqSdtSegmentKey:'key-seg-1',messageId:'0'}};
        sdt.persistSegmentEdits(wrapper,edited,'edited page');
        assert.equal(wrapper.dataset.rbqSdtFinalPrompt,'edited page');
        assert.equal(wrapper.dataset.rbqSdtNegative,'');
        assert.equal(settings._smartDrawTrigger.cache.key.segments[0].scene,old.scene);
        assert.equal(settings._smartDrawTrigger.cache.key.segments[1].characters[0].caption,'edited person');
        assert.equal(extra.segments[1].characters[0].caption,'edited person');assert.equal(extra.segments[1].negativePrompt,'');
        assert.equal(writes,1);
        extra.key='another-chat';sdt.persistSegmentEdits(wrapper,old,old.scene);assert.equal(writes,1);
        settings._smartDrawTrigger.cache.single={key:'single',shouldDraw:true,...clone(old)};
        extra=clone(settings._smartDrawTrigger.cache.single);
        const single={dataset:{rbqSdtBaseKey:'single',messageId:'0'}};
        edited.label='Edited label';sdt.persistSegmentEdits(single,edited,edited.scene);
        assert.equal(extra.shouldDraw,true);assert.equal(extra.label,'Edited label');
        assert.equal(extra.scene,'edited page');
    } finally {RBQ.api.getMessageExtra=previousGet;RBQ.api.setMessageExtra=previousSet;}
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
async function asyncTest(name, run) { await run(); console.log('PASS ' + name); passed++; }
(async () => {
    await asyncTest('delayed AI page refinement stops after a mode switch', async () => {
        memory();settings._smartDrawTrigger.provider='custom';settings._smartDrawTrigger.customUrl='https://test.invalid';
        vm.runInContext(sdtSource.slice(sdtSource.indexOf('    async function runSegmentAiRefinement('),sdtSource.indexOf('    function setCardLoadingState(')),sdt);
        const previousFetch=sdt.smartFetch,previousReader=sdt.safeReadJsonResponse,previousSafety=sdt.checkUrlSafety;
        let release;
        sdt.checkUrlSafety=()=>{};sdt.smartFetch=()=>new Promise(resolve=>{release=resolve;});
        sdt.safeReadJsonResponse=async()=>({choices:[{message:{content:JSON.stringify(page([{}]))}}]});
        try {
            const pending=sdt.runSegmentAiRefinement(segmentFor([{}]),'change camera');
            settings._smartDrawTrigger._mangaActive=false;settings._smartDrawTrigger.enhancedContext='off';
            release({ok:true});await assert.rejects(pending,/漫画模式已切换/);
        } finally {sdt.smartFetch=previousFetch;sdt.safeReadJsonResponse=previousReader;sdt.checkUrlSafety=previousSafety;}
    });
    await asyncTest('queued same-prompt requests retain their own people, negative, coordinates and selected style', async () => {
        memory();
        const previousApi = RBQ.api.generateImage, previousSupport = RBQ.api.generationContextVersion;
        const previousManga = clone(settings._mangaMode);
        const calls = [];
        RBQ.api.generationContextVersion = 1;
        RBQ.api.generateImage = (prompt, reason, meta) => new Promise(resolve => calls.push({prompt, reason, meta, resolve}));
        try {
            Object.assign(settings._mangaMode,{enabled:true,style:'monochrome'});
            const first = segmentFor([{}]);
            first.negativePrompt = 'first exclusion'; first.mangaUseCoords=true;
            first.characters[0].center={x:0.2,y:0.4};
            const task1=sdt.generateSdtImage(first,'same page','test');
            first.characters[0].caption='mutated caption';first.characters[0].center.x=0.9;
            Object.assign(settings._mangaMode,{style:'custom',customPositive:'request two style',customNegative:'request two exclusion'});
            const second=segmentFor([{name:'Mei (original)',base:'girl, brown hair'}]);
            second.negativePrompt='';
            const task2=sdt.generateSdtImage(second,'same page','test');
            Object.assign(settings._mangaMode,{enabled:false,style:'soft_color'});
            // Host preprocesses the second request first; hook order is also reversed.
            let result2=payload('same page');
            for(const hook of [mangaHook,sdtHook]) result2=hook(result2,{prompt:calls[1].prompt,meta:calls[1].meta});
            assert.match(result2.input,/request two style/);
            assert.doesNotMatch(result2.input,/artist:2015x127/);
            assert.match(result2.parameters.v4_prompt.caption.char_captions[0].char_caption,/Mei/);
            assert.doesNotMatch(result2.parameters.negative_prompt,/bad hands|first exclusion/);
            calls[1].resolve(result2);
            let result1=payload('same page');
            for(const hook of [sdtHook,mangaHook]) result1=hook(result1,{prompt:calls[0].prompt,meta:calls[0].meta});
            assert.match(result1.input,/artist:2015x127/);
            assert.doesNotMatch(result1.input,/request two style/);
            assert.match(result1.parameters.v4_prompt.caption.char_captions[0].char_caption,/Ami/);
            assert.doesNotMatch(result1.parameters.v4_prompt.caption.char_captions[0].char_caption,/mutated/);
            assert.equal(result1.parameters.v4_prompt.caption.char_captions[0].centers[0].x,0.2);
            assert.equal(result1.parameters.v4_prompt.use_coords,true);
            assert.match(result1.parameters.negative_prompt,/first exclusion/);
            assert.equal(result1.parameters.qualityToggle,false); assert.equal(result1.parameters.ucPreset,3);
            calls[0].resolve(result1); await Promise.all([task1,task2]);
            // Parsing/legacy preparations cannot leak into an unrelated contextual draw.
            sdt.prepareNaiCharData(first);
            const unrelated=sdtHook(payload('same page'),{prompt:'same page',meta:{}});
            assert.equal(unrelated.parameters.v4_prompt.caption.char_captions.length,0);
        } finally {
            RBQ.api.generateImage=previousApi; RBQ.api.generationContextVersion=previousSupport;
            settings._mangaMode=previousManga;sdt.prepareNaiCharData(null);
        }
    });
    await asyncTest('old-host SDT fallback serializes draws and releases a failed request', async () => {
        memory();
        const previousApi=RBQ.api.generateImage,previousSupport=RBQ.api.generationContextVersion;
        const calls=[];
        delete RBQ.api.generationContextVersion;
        RBQ.api.generateImage=(prompt)=>new Promise((resolve,reject)=>calls.push({prompt,resolve,reject}));
        try {
            const a=sdt.generateSdtImage(segmentFor([{}]),'first page','test');
            const failure=a.catch(error=>error.message);
            const b=sdt.generateSdtImage(segmentFor([{name:'Mei (original)'}]),'second page','test');
            await Promise.resolve();assert.equal(calls.length,1);
            assert.equal(sdtHook(payload('unrelated')).parameters.v4_prompt.caption.char_captions.length,0);
            assert.match(sdtHook(payload('first page')).parameters.v4_prompt.caption.char_captions[0].char_caption,/Ami/);
            calls[0].reject(new Error('simulated request failure'));assert.equal(await failure,'simulated request failure');
            await Promise.resolve();await Promise.resolve();assert.equal(calls.length,2);
            assert.match(sdtHook(payload('second page')).parameters.v4_prompt.caption.char_captions[0].char_caption,/Mei/);
            calls[1].resolve({url:'test.png'});await b;
            assert.equal(sdtHook(payload('second page')).parameters.v4_prompt.caption.char_captions.length,0);
        } finally {RBQ.api.generateImage=previousApi;RBQ.api.generationContextVersion=previousSupport;sdt.prepareNaiCharData(null);}
    });
    await asyncTest('ordinary image requests snapshot their original coordinates and multi-character switch', async () => {
        const previousApi=RBQ.api.generateImage,previousSupport=RBQ.api.generationContextVersion;
        const previousStore=settings._smartDrawTrigger;
        let context;
        try {
            settings._smartDrawTrigger={multiCharOutput:true,multiCharUseCoords:true};RBQ.api.generationContextVersion=1;
            RBQ.api.generateImage=async (prompt,reason,meta)=>{context={prompt,reason,meta};return {};};
            await sdt.generateSdtImage({characters:[{caption:'Alice, girl',center:{x:0.3,y:0.8},uc:'short hair'}]},'ordinary','test');
            settings._smartDrawTrigger.multiCharOutput=false;settings._smartDrawTrigger.multiCharUseCoords=false;
            const p=sdtHook(payload('ordinary'),context);
            assert.equal(p.parameters.v4_prompt.use_coords,true);
            assert.equal(p.parameters.v4_prompt.caption.char_captions[0].char_caption,'Alice, girl');
        } finally {RBQ.api.generateImage=previousApi;RBQ.api.generationContextVersion=previousSupport;settings._smartDrawTrigger=previousStore;}
    });
    test('Studio flattened editor snapshots contain no replayable hidden state', () => {
        const resolved=RBQ.api.mangaProtocol.resolveAppearances([page([{state:{base:'girl, short hair',outfit:'blue coat'}}])])[0];
        const p=manga.studioPanelFromProtocol(resolved.panels[0]);
        for(const key of ['base','outfit','state','_mangaAppearance','_mangaInitialAppearance']) assert.equal(p.characters[0][key],undefined);
        p.characters[0].positive='Ami (original), girl, long hair, green shirt, standing';
        const original=settings._mangaMode.studio.panels;
        try {
            settings._mangaMode.studio.panels=[p];
            const c=manga.compileMangaPage(manga.buildStudioPage(settings._mangaMode));
            assert.doesNotMatch(c.characters[0].caption,/short hair|blue coat/);
            assert.match(c.characters[0].caption,/green shirt/);
        } finally {settings._mangaMode.studio.panels=original;}
    });
    console.log(`\n${passed} cross-entry manga audit tests passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
