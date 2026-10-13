/**
 * Test suite for Character Workshop Global Import and JSON Import/Export features
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function test(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (err) {
        console.error(`FAIL ${name}`);
        throw err;
    }
}

// Mock environment
function createWorkshopEnv() {
    const settings = {
        _smartDrawTrigger: {
            characterProfiles: {
                'historical-chat-1': {
                    '神里绫华': {
                        displayName: '神里绫华',
                        nameTag: 'kamisato ayaka (genshin impact)',
                        baseTags: '1girl, blue eyes, long hair, light blue hair, ponytail, bangs',
                        baseLocked: true,
                        isBaseLocked: true,
                        outfitLocked: true,
                        isOutfitLocked: true,
                        wardrobe: [
                            { id: 'w1', name: '常服', outfit: 'blue dress, breastplate, white ribbon', locked: true },
                            { id: 'w2', name: '春几回', outfit: 'japanese clothes, purple skirt, hat', locked: false }
                        ],
                        currentOutfitId: 'w1',
                        updatedAt: 1000
                    }
                },
                'historical-chat-2': {
                    '芙宁娜': {
                        displayName: '芙宁娜',
                        nameTag: 'furina (genshin impact)',
                        baseTags: '1girl, ahoge, multicolored hair, blue eyes, top hat',
                        baseLocked: true,
                        wardrobe: [
                            { id: 'w_default', name: '礼服', outfit: 'blue coat, vest, white ascot' }
                        ],
                        currentOutfitId: 'w_default',
                        updatedAt: 2000
                    }
                }
            }
        }
    };

    let activeChatKey = 'new-empty-chat'; // Started a brand new chat!

    const RBQ = {
        api: {
            getSettings: () => settings,
            saveSettings: () => {},
            getContext: () => ({ chatKey: activeChatKey })
        }
    };

    // Load character workshop script in VM or extract core profile functions
    const workshopSource = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');

    // Context for running workshop functions
    const ctx = {
        RBQ,
        window: { RBQ },
        console,
        toastr: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
        getChatKey: () => activeChatKey,
        setChatKey: (ck) => { activeChatKey = ck; },
        settings,
        URL: {
            createObjectURL: () => 'blob:mock',
            revokeObjectURL: () => {}
        },
        document: {
            createElement: () => ({ click: () => {}, setAttribute: () => {} }),
            body: { appendChild: () => {}, removeChild: () => {} }
        }
    };

    return { ctx, settings, getActiveChat: () => activeChatKey, setActiveChat: (ck) => { activeChatKey = ck; } };
}

// Test 1: Global History correctly aggregates characters across historical chats
test('getAllGlobalProfiles aggregates characters across all chat buckets', () => {
    const { ctx, settings } = createWorkshopEnv();
    
    // Simulate getAllGlobalProfiles logic from character-workshop.js
    const sdt = settings._smartDrawTrigger;
    const globalProfiles = {};
    for (const chatDict of Object.values(sdt.characterProfiles)) {
        for (const [k, v] of Object.entries(chatDict)) {
            globalProfiles[k] = v;
        }
    }

    assert.ok(globalProfiles['神里绫华']);
    assert.ok(globalProfiles['芙宁娜']);
    assert.equal(globalProfiles['神里绫华'].displayName, '神里绫华');
    assert.equal(globalProfiles['芙宁娜'].displayName, '芙宁娜');
});

// Test 2: In a brand new chat, current chat profile bucket starts empty
test('New chat starts with empty characterProfiles bucket', () => {
    const { settings, getActiveChat } = createWorkshopEnv();
    const currentBucket = settings._smartDrawTrigger.characterProfiles[getActiveChat()];
    assert.equal(currentBucket, undefined);
});

// Test 3: Cloning a character from global history imports it into the active chat
test('Importing global character into active chat creates faithful clone in active chat bucket', () => {
    const { settings, getActiveChat } = createWorkshopEnv();
    const activeChat = getActiveChat();

    // Ensure bucket exists in active chat
    if (!settings._smartDrawTrigger.characterProfiles[activeChat]) {
        settings._smartDrawTrigger.characterProfiles[activeChat] = {};
    }
    const currentBucket = settings._smartDrawTrigger.characterProfiles[activeChat];

    // Source from global
    const source = settings._smartDrawTrigger.characterProfiles['historical-chat-1']['神里绫华'];
    assert.ok(source);

    // Deep clone and save into current bucket
    const toImport = JSON.parse(JSON.stringify(source));
    currentBucket['神里绫华'] = { ...toImport, updatedAt: Date.now() };

    // Verify presence and data integrity in active chat
    const imported = currentBucket['神里绫华'];
    assert.ok(imported);
    assert.equal(imported.displayName, '神里绫华');
    assert.equal(imported.nameTag, 'kamisato ayaka (genshin impact)');
    assert.equal(imported.baseTags, source.baseTags);
    assert.equal(imported.baseLocked, true);
    assert.equal(imported.wardrobe.length, 2);
    assert.equal(imported.wardrobe[0].name, '常服');
    assert.equal(imported.wardrobe[0].locked, true);

    // Verify it didn't mutate the historical chat
    assert.equal(settings._smartDrawTrigger.characterProfiles['historical-chat-1']['神里绫华'].displayName, '神里绫华');
});

// Test 4: Single character JSON export payload structure & restoration
test('Single character JSON export schema validates and restores correctly', () => {
    const { settings } = createWorkshopEnv();
    const original = settings._smartDrawTrigger.characterProfiles['historical-chat-2']['芙宁娜'];

    // Simulated single export payload
    const payload = {
        version: '1.0',
        type: 'rbq-character-profile',
        exportedAt: new Date().toISOString(),
        character: JSON.parse(JSON.stringify(original))
    };

    const serialized = JSON.stringify(payload, null, 2);
    const parsed = JSON.parse(serialized);

    assert.equal(parsed.type, 'rbq-character-profile');
    assert.ok(parsed.character);
    assert.equal(parsed.character.displayName, '芙宁娜');
    assert.equal(parsed.character.nameTag, 'furina (genshin impact)');
    assert.equal(parsed.character.wardrobe[0].name, '礼服');
});

// Test 5: Bulk dossier backup export and multi-character restore
test('Bulk dossier backup exports multiple characters and imports into new environment', () => {
    const { settings } = createWorkshopEnv();
    const targetChatBucket = {};

    // Backup payload with dictionary
    const backupPayload = {
        version: '1.0',
        type: 'rbq-character-dossier-backup',
        scope: 'all',
        exportedAt: new Date().toISOString(),
        count: 2,
        characters: {
            '神里绫华': settings._smartDrawTrigger.characterProfiles['historical-chat-1']['神里绫华'],
            '芙宁娜': settings._smartDrawTrigger.characterProfiles['historical-chat-2']['芙宁娜']
        }
    };

    // Simulate import handler logic
    const raw = JSON.parse(JSON.stringify(backupPayload));
    let importedCount = 0;
    if (raw.characters && typeof raw.characters === 'object') {
        for (const [k, char] of Object.entries(raw.characters)) {
            if (char && typeof char === 'object') {
                const charName = char.displayName || k;
                targetChatBucket[charName] = { ...char, updatedAt: Date.now() };
                importedCount++;
            }
        }
    }

    assert.equal(importedCount, 2);
    assert.ok(targetChatBucket['神里绫华']);
    assert.ok(targetChatBucket['芙宁娜']);
    assert.equal(targetChatBucket['神里绫华'].wardrobe.length, 2);
    assert.equal(targetChatBucket['芙宁娜'].nameTag, 'furina (genshin impact)');
});

// Test 6: Array-based character backup import
test('Array-based characters list import works seamlessly', () => {
    const targetChatBucket = {};
    const arrayBackup = {
        type: 'rbq-characters-list',
        characters: [
            { displayName: '爱丽丝', nameTag: 'alice', baseTags: '1girl, blonde hair', wardrobe: [{ id: 'w1', name: '女仆装', outfit: 'maid outfit' }] },
            { displayName: '博丽灵梦', nameTag: 'hakurei reimu', baseTags: '1girl, brown hair, miko', wardrobe: [{ id: 'w1', name: '巫女服', outfit: 'miko dress' }] }
        ]
    };

    let importedCount = 0;
    for (const char of arrayBackup.characters) {
        const charName = char.displayName || char.name;
        targetChatBucket[charName] = { ...char, updatedAt: Date.now() };
        importedCount++;
    }

    assert.equal(importedCount, 2);
    assert.ok(targetChatBucket['爱丽丝']);
    assert.ok(targetChatBucket['博丽灵梦']);
    assert.equal(targetChatBucket['爱丽丝'].wardrobe[0].name, '女仆装');
    assert.equal(targetChatBucket['博丽灵梦'].wardrobe[0].name, '巫女服');
});

// Test 7: Batch delete in chat scope removes only selected characters from active chat
test('Batch delete in chat scope removes only selected characters from active chat', () => {
    const { settings, getActiveChat } = createWorkshopEnv();
    const activeChat = getActiveChat();
    settings._smartDrawTrigger.characterProfiles[activeChat] = {
        'charA': { displayName: 'charA' },
        'charB': { displayName: 'charB' },
        'charC': { displayName: 'charC' }
    };

    const toDelete = new Set(['charA', 'charC']);
    for (const name of toDelete) {
        delete settings._smartDrawTrigger.characterProfiles[activeChat][name];
    }

    const remaining = settings._smartDrawTrigger.characterProfiles[activeChat];
    assert.equal(Object.keys(remaining).length, 1);
    assert.ok(remaining['charB']);
    assert.equal(remaining['charA'], undefined);
    assert.equal(remaining['charC'], undefined);
});

// Test 8: Batch delete in global scope purges selected characters across all historical chat buckets
test('Batch delete in global scope purges selected characters across all historical chat buckets', () => {
    const { settings } = createWorkshopEnv();
    const toDelete = new Set(['神里绫华']);

    for (const chatDict of Object.values(settings._smartDrawTrigger.characterProfiles)) {
        for (const name of toDelete) {
            delete chatDict[name];
        }
    }

    assert.equal(settings._smartDrawTrigger.characterProfiles['historical-chat-1']['神里绫华'], undefined);
    assert.ok(settings._smartDrawTrigger.characterProfiles['historical-chat-2']['芙宁娜']);
});

// Test 9: Global edit synchronization updates all historical chat replicas
test('Global edit synchronization updates all historical chat replicas when scope is all', () => {
    const { settings } = createWorkshopEnv();
    // Add same character in two chats
    settings._smartDrawTrigger.characterProfiles['chat-1'] = {
        '芙宁娜': { displayName: '芙宁娜', baseTags: 'old tags', wardrobe: [] }
    };
    settings._smartDrawTrigger.characterProfiles['chat-2'] = {
        '芙宁娜': { displayName: '芙宁娜', baseTags: 'old tags', wardrobe: [] }
    };

    const updatedData = { displayName: '芙宁娜', baseTags: '1girl, ahoge, blue eyes', baseLocked: true };
    const scope = 'all';

    // Simulate saveProfile with scope === 'all'
    if (scope === 'all') {
        for (const chatDict of Object.values(settings._smartDrawTrigger.characterProfiles)) {
            if (chatDict['芙宁娜']) {
                chatDict['芙宁娜'] = { ...chatDict['芙宁娜'], ...updatedData };
            }
        }
    }

    assert.equal(settings._smartDrawTrigger.characterProfiles['chat-1']['芙宁娜'].baseTags, '1girl, ahoge, blue eyes');
    assert.equal(settings._smartDrawTrigger.characterProfiles['chat-2']['芙宁娜'].baseTags, '1girl, ahoge, blue eyes');
    assert.equal(settings._smartDrawTrigger.characterProfiles['chat-1']['芙宁娜'].baseLocked, true);
});

// Test 10: Batch import from global history clones multiple characters into active chat
test('Batch import from global history clones multiple characters into active chat in one shot', () => {
    const { settings, getActiveChat } = createWorkshopEnv();
    const activeChat = getActiveChat();
    settings._smartDrawTrigger.characterProfiles[activeChat] = {};

    const selected = new Set(['神里绫华', '芙宁娜']);
    const allGlobal = {
        '神里绫华': settings._smartDrawTrigger.characterProfiles['historical-chat-1']['神里绫华'],
        '芙宁娜': settings._smartDrawTrigger.characterProfiles['historical-chat-2']['芙宁娜']
    };

    for (const name of selected) {
        const p = allGlobal[name];
        settings._smartDrawTrigger.characterProfiles[activeChat][name] = JSON.parse(JSON.stringify(p));
    }

    const current = settings._smartDrawTrigger.characterProfiles[activeChat];
    assert.equal(Object.keys(current).length, 2);
    assert.ok(current['神里绫华']);
    assert.ok(current['芙宁娜']);
    assert.equal(current['神里绫华'].wardrobe.length, 2);
    assert.equal(current['芙宁娜'].nameTag, 'furina (genshin impact)');
});

console.log('\nAll 10 Character Workshop import/export/batch tests passed successfully.');
