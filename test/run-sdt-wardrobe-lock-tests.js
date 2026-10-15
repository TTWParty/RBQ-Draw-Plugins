/**
 * Regression and unit test suite for:
 * 1. Base Lock (baseLocked / isBaseLocked): prevents temporary plot marks (hickeys, wounds) from backfilling baseTags.
 * 2. Outfit Lock (outfitLocked / isOutfitLocked / preset.locked): prevents AI from mutating locked wardrobe presets.
 * 3. Explicit Wardrobe Selection (wardrobe_outfit): allows LLM to claim preset outfits without regex guessing.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('PASS ' + name);
    } catch (e) {
        console.error('FAIL ' + name, e);
        process.exit(1);
    }
}

function createEnv() {
    const env = new Function('require', '__dirname', harness + '\nreturn {manga,sdt,settings,RBQ,sdtSource};')(require, __dirname);
    const { sdt, settings, sdtSource } = env;

    const load = (start, end) => {
        const a = sdtSource.indexOf(start), b = sdtSource.indexOf(end, a);
        assert.ok(a >= 0 && b > a, 'load slice: ' + start);
        vm.runInContext(sdtSource.slice(a, b), sdt);
    };

    // Load mergeCharacterCaption and related functions
    load('    function mergeCharacterCaption(', '    function collectCharacterCardInfo(');
    load('    function buildCharacterMemoryPromptModule(', '    function getActiveCharacterName(');
    vm.runInContext('this.DRAW_SPEC_TOOL = DRAW_SPEC_TOOL;', sdt);

    settings._smartDrawTrigger._mangaActive = false;
    settings._smartDrawTrigger.enhancedContext = 'off';
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    return { sdt, settings, sdtSource };
}
const cap = (r) => (r && typeof r === 'object' && 'caption' in r) ? r.caption : r;


// Test 1: wardrobe_outfit explicit selection resolves preset tags
test('wardrobe_outfit explicit selection resolves exact preset tags without regex guessing', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    // Set up a character profile with a custom wardrobe preset
    const profiles = {
        '芙宁娜': {
            displayName: '芙宁娜',
            nameTag: 'furina (genshin impact)',
            baseTags: '1girl, blue eyes, medium hair, ahoge',
            baseLocked: true,
            isBaseLocked: true,
            outfitLocked: true,
            isOutfitLocked: true,
            wardrobe: [
                {
                    id: 'w_pajamas',
                    name: '蓝色吊带睡衣',
                    outfit: 'blue silk nightgown, camisole, lace trim, bare shoulders',
                    triggers: '睡衣, 吊带',
                    locked: true,
                },
                {
                    id: 'w_uniform',
                    name: '枫丹礼服',
                    outfit: 'blue coat, ascot, top hat, ornate vest, white shorts',
                    triggers: '礼服, 正装',
                    locked: true,
                }
            ],
            currentOutfitId: 'w_uniform',
        }
    };
    Object.assign(sdt.getCharacterProfiles(), profiles);

    // 6.5.43: lock protects content, not switching — an explicit claim switches even while locked.
    // LLM outputs wardrobe_outfit: "蓝色吊带睡衣", but passes simple outfit: "nightgown"
    const caption = cap(sdt.mergeCharacterCaption(
        '芙宁娜',
        '1girl, blue eyes',
        'nightgown',
        'sitting on bed, blush',
        '',
        'furina (genshin impact)',
        { wardrobeOutfit: '蓝色吊带睡衣' }
    ));

    // Caption should contain the exact preset outfit tags
    assert.match(caption, /blue silk nightgown, camisole, lace trim, bare shoulders/);
    assert.match(caption, /furina \(genshin impact\)/);
    assert.match(caption, /sitting on bed, blush/);

    // Character's currentOutfitId should be updated to w_pajamas (parse writes; no new wardrobe entry for preset claim)
    const updated = sdt.getCharacterProfile('芙宁娜');
    assert.equal(updated.currentOutfitId, 'w_pajamas');
    assert.equal(updated.currentOutfit, 'blue silk nightgown, camisole, lace trim, bare shoulders');
    assert.equal(updated.wardrobe.length, 2);
    const preset = updated.wardrobe.find(w => w.id === 'w_pajamas');
    assert.equal(preset.outfit, 'blue silk nightgown, camisole, lace trim, bare shoulders');
});

// Test 2: Base Lock prevents temporary plot traits from backfilling baseTags
test('Base Lock (baseLocked: true) prevents temporary marks from corrupting saved baseTags', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    const originalBase = '1girl, adult, long black hair, purple eyes';
    const profiles = {
        '神里绫华': {
            displayName: '神里绫华',
            nameTag: 'kamisato ayaka (genshin impact)',
            baseTags: originalBase,
            baseLocked: true,
            isBaseLocked: true,
            wardrobe: [],
        }
    };
    Object.assign(sdt.getCharacterProfiles(), profiles);

    // Plot generates temporary erotic / battle mark in base and action
    const temporaryBaseWithMarks = '1girl, adult, long black hair, purple eyes, hickey on neck, scratch on collarbone';
    const caption = cap(sdt.mergeCharacterCaption(
        '神里绫华',
        temporaryBaseWithMarks,
        'white kimono',
        'hickey on neck, shy, looking away',
        '',
        'kamisato ayaka (genshin impact)'
    ));

    // The image caption for THIS turn includes the plot marks in action
    assert.match(caption, /hickey on neck/);

    // But the stored memory baseTags MUST remain clean and unchanged!
    const updated = sdt.getCharacterProfile('神里绫华');
    assert.equal(updated.baseTags, originalBase);
    assert.doesNotMatch(updated.baseTags, /hickey/);
    assert.doesNotMatch(updated.baseTags, /scratch/);
});

// Test 3: Brand new character learns initial base tags and outfit
test('Brand new character learns initial baseTags and outfit', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    sdt.mergeCharacterCaption(
        '新角色',
        '1girl, blonde hair, blue eyes',
        't-shirt',
        'standing',
        '',
        'new char'
    );
    const updated = sdt.getCharacterProfile('新角色');
    assert.ok(updated);
    assert.match(updated.baseTags, /1girl, blonde hair, blue eyes/);
    assert.doesNotMatch(updated.baseTags, /new char/i);
    assert.equal(updated.currentOutfit, 't-shirt');
    // First non-empty outfit may seed wardrobe once
    assert.equal(updated.wardrobe.length, 1);
    // Re-parse same outfit must not grow wardrobe
    sdt.mergeCharacterCaption('新角色', '1girl, blonde hair, blue eyes', 't-shirt', 'standing', '', 'new char');
    assert.equal(sdt.getCharacterProfile('新角色').wardrobe.length, 1);
});

// Test 4: Outfit Lock prevents AI from overwriting preset tags
test('Outfit Lock prevents AI from mutating locked wardrobe preset', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    const originalPresetOutfit = 'sailor uniform, pleated skirt, red neckerchief';
    const profiles = {
        '黑猫': {
            displayName: '黑猫',
            nameTag: 'gokou ruri (oreimo)',
            baseTags: '1girl, black hair, hime cut',
            baseLocked: true,
            isBaseLocked: true,
            outfitLocked: true,
            isOutfitLocked: true,
            wardrobe: [
                {
                    id: 'w_sailor',
                    name: '校服',
                    outfit: originalPresetOutfit,
                    triggers: '校服, 水手服',
                    locked: true,
                }
            ],
            wornOutfitId: 'w_sailor',
        }
    };
    Object.assign(sdt.getCharacterProfiles(), profiles);

    // AI claims the school uniform via wardrobe_outfit, but outputs a simplified outfit: "school uniform"
    sdt.mergeCharacterCaption(
        '黑猫',
        '1girl, black hair',
        'school uniform',
        'reading book',
        '',
        'gokou ruri (oreimo)',
        { wardrobeOutfit: '校服' }
    );

    const updated = sdt.getCharacterProfile('黑猫');
    const preset = updated.wardrobe.find(w => w.id === 'w_sailor');
    assert.equal(preset.outfit, originalPresetOutfit);
    assert.equal(updated.wardrobe.length, 1);
});

// Test 5: System prompt module presents wardrobe presets and lock indicators
test('buildCharacterMemoryPromptModule lists wardrobe presets with lock indicators and clear guidance', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    Object.assign(sdt.getCharacterProfiles(), {
        '芙宁娜': {
            displayName: '芙宁娜',
            nameTag: 'furina',
            baseTags: '1girl, blue hair',
            baseLocked: true,
            isBaseLocked: true,
            outfitLocked: true,
            isOutfitLocked: true,
            wardrobe: [
                { id: 'w1', name: '蓝色吊带睡衣', outfit: 'blue camisole', locked: true },
                { id: 'w2', name: '常服', outfit: 'casual dress', locked: false },
            ]
        }
    });

    const promptModule = sdt.buildCharacterMemoryPromptModule();
    assert.ok(promptModule);
    assert.match(promptModule, /芙宁娜/);
    assert.match(promptModule, /【蓝色吊带睡衣】\(🔒锁定\)/);
    assert.match(promptModule, /【常服】/);
    assert.match(promptModule, /wardrobe_outfit/);
});

// Test 6: DRAW_SPEC_TOOL schema includes wardrobe_outfit and name_tag
test('DRAW_SPEC_TOOL character schema includes wardrobe_outfit and name_tag properties', () => {
    const { sdt } = createEnv();
    const tool = sdt.DRAW_SPEC_TOOL;
    const charProps = tool.function.parameters.properties.segments.items.properties.characters.items.properties;

    assert.ok(charProps.wardrobe_outfit, 'wardrobe_outfit property exists');
    assert.equal(charProps.wardrobe_outfit.type, 'string');
    assert.ok(charProps.name_tag, 'name_tag property exists');
    assert.equal(charProps.name_tag.type, 'string');
});

// Test 7: wardrobe_outfit matching handles Chinese brackets, quotes, and string triggers
test('wardrobe_outfit matching handles Chinese brackets, quotes, and string triggers gracefully', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    const profiles = {
        '芙宁娜': {
            displayName: '芙宁娜',
            nameTag: 'furina',
            baseTags: '1girl, blue hair',
            baseLocked: true,
            isBaseLocked: true,
            outfitLocked: true,
            isOutfitLocked: true,
            wardrobe: [
                {
                    id: 'w1',
                    name: '蓝色吊带睡衣',
                    outfit: 'blue silk nightgown, camisole',
                    triggers: '睡衣, 吊带',
                    locked: true,
                }
            ],
            currentOutfitId: 'w_default',
        }
    };
    Object.assign(sdt.getCharacterProfiles(), profiles);

    // LLM outputs with Chinese brackets 【蓝色吊带睡衣】
    const caption1 = cap(sdt.mergeCharacterCaption(
        '芙宁娜', '1girl, blue hair', 'nightgown', 'sitting', '', 'furina',
        { wardrobeOutfit: '【蓝色吊带睡衣】' }
    ));
    assert.match(caption1, /blue silk nightgown, camisole/);

    // LLM outputs with quotes “吊带” (matches trigger)
    const caption2 = cap(sdt.mergeCharacterCaption(
        '芙宁娜', '1girl, blue hair', 'nightgown', 'sitting', '', 'furina',
        { wardrobeOutfit: '“吊带”' }
    ));
    assert.match(caption2, /blue silk nightgown, camisole/);
});

// Test 8: Unlocked character allows normal plot outfit transitions
test('Unlocked character allows normal plot outfit transitions and auto-archiving', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    const profiles = {
        '可莉': {
            displayName: '可莉',
            nameTag: 'klee',
            baseTags: '1girl, blonde hair, red eyes',
            baseLocked: false,
            outfitLocked: false,
            currentOutfit: 'red dress, white bloomers',
            wardrobe: [
                { id: 'w1', name: '默认服装', outfit: 'red dress, white bloomers', locked: false }
            ],
        }
    };
    Object.assign(sdt.getCharacterProfiles(), profiles);

    // Plot switches to swimsuit (no wardrobe_outfit specified)
    sdt.mergeCharacterCaption(
        '可莉', '1girl, blonde hair', 'red swimsuit, swimming ring', 'smiling', '', 'klee'
    );

    const updated = sdt.getCharacterProfile('可莉');
    assert.equal(updated.currentOutfit, 'red swimsuit, swimming ring');
    // Real change from red dress → swimsuit archives once; re-parse does not stack
    assert.equal(updated.wardrobe.length, 2);
    sdt.mergeCharacterCaption('可莉', '1girl, blonde hair', 'red swimsuit, swimming ring', 'smiling', '', 'klee');
    assert.equal(sdt.getCharacterProfile('可莉').wardrobe.length, 2);
});


// Test 9: duplicate category/LLM wardrobe names get numeric suffixes
test('deriveOutfitName and auto-archive always unique wardrobe names (e.g. 剧情: 泳装 2)', () => {
    const { sdt, settings } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;

    Object.assign(sdt.getCharacterProfiles(), {
        '早濑沙纪': {
            displayName: '早濑沙纪',
            nameTag: 'hayase saki',
            baseTags: '1girl, blue hair',
            currentOutfit: 'school uniform, sailor collar',
            wardrobe: [
                { id: 'w1', name: '剧情: 泳装', outfit: 'blue one-piece swimsuit', locked: false },
            ],
        }
    });

    // Category map → 泳装; must not invent a second identical 「剧情: 泳装」
    sdt.mergeCharacterCaption(
        '早濑沙纪', '1girl, blue hair', 'red bikini, micro bikini', 'standing', '', 'hayase saki'
    );
    let updated = sdt.getCharacterProfile('早濑沙纪');
    assert.equal(updated.wardrobe.length, 2);
    const names = updated.wardrobe.map(w => w.name);
    assert.ok(names.includes('剧情: 泳装'));
    assert.ok(names.includes('剧情: 泳装 2'), 'duplicate category name must be numbered: ' + names.join(','));

    // LLM outfit_name path also uniques
    sdt.mergeCharacterCaption(
        '早濑沙纪', '1girl, blue hair', 'white bikini, frills', 'sitting', '', 'hayase saki',
        { outfitName: '泳装' }
    );
    updated = sdt.getCharacterProfile('早濑沙纪');
    const names2 = updated.wardrobe.map(w => w.name);
    assert.equal(updated.wardrobe.length, 3);
    assert.ok(names2.includes('剧情: 泳装 3'), 'LLM-named duplicate must be numbered: ' + names2.join(','));
});

test('addCharacterWardrobeOutfit numbers duplicate names', () => {
    const { sdt, settings, sdtSource } = createEnv();
    settings._smartDrawTrigger.characterMemoryEnabled = true;
    Object.assign(sdt.getCharacterProfiles(), {
        '可莉': {
            displayName: '可莉', baseTags: '1girl', wardrobe: [
                { id: 'w1', name: '默认服装', outfit: 'red dress', locked: false }
            ],
        }
    });
    // load addCharacterWardrobeOutfit if not already present
    if (typeof sdt.addCharacterWardrobeOutfit !== 'function') {
        const a = sdtSource.indexOf('    function addCharacterWardrobeOutfit(');
        const b = sdtSource.indexOf('    function deleteCharacterWardrobeOutfit(');
        assert.ok(a >= 0 && b > a);
        vm.runInContext(sdtSource.slice(a, b) + '\nthis.addCharacterWardrobeOutfit = addCharacterWardrobeOutfit;', sdt);
    }
    sdt.addCharacterWardrobeOutfit('可莉', '默认服装', 'another outfit');
    const names = sdt.getCharacterProfile('可莉').wardrobe.map(w => w.name);
    assert.deepEqual(names.sort(), ['默认服装', '默认服装 2'].sort());
});

console.log(`\n${passed} wardrobe & lock tests passed successfully.`);
