/** Character Workshop: global view preference + identity-aware global save (no UI). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '../plugins/character-workshop.js'), 'utf8');
const h0 = src.indexOf('    /** Locked base/outfit');
const h1 = src.indexOf('    function getAllGlobalProfiles() {');
const g0 = src.indexOf('    function getAllGlobalProfiles() {');
const g1 = src.indexOf('    let _cachedDoujinProfiles = null;');
const p0 = src.indexOf('    function getProfile(name) {');
const p1 = src.indexOf('    function saveProfile(');
const s0 = src.indexOf('    function saveProfile(');
const s1 = src.indexOf('    function deleteProfile(');
assert.ok(h0 > 0 && h1 > h0 && g0 > 0 && g1 > g0 && p0 > 0 && p1 > p0 && s0 > 0 && s1 > s0);

let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log('PASS', n); };

function env(chatProfiles = {}) {
    const sdt = { characterProfiles: chatProfiles };
    const ctx = {
        RBQ: { api: { saveSettings() {} } },
        dossierScope: 'all',
        isJunkCharacterName: () => false,
        getSdtStore: () => sdt,
        ensureProfileBucket: () => {
            if (!sdt.characterProfiles.cur) sdt.characterProfiles.cur = {};
            return sdt.characterProfiles.cur;
        },
        getCurrentChatProfiles: () => sdt.characterProfiles.cur || {},
        getMountedDoujinProfiles: () => ({}),
    };
    vm.createContext(ctx);
    vm.runInContext(
        src.slice(h0, h1) + src.slice(g0, g1) + src.slice(p0, p1) + src.slice(s0, s1) +
        '\nthis.isProfileContentLocked = isProfileContentLocked;' +
        '\nthis.shouldPreferGlobalProfile = shouldPreferGlobalProfile;' +
        '\nthis.shouldSyncGlobalCopy = shouldSyncGlobalCopy;' +
        '\nthis.getAllGlobalProfiles = getAllGlobalProfiles;' +
        '\nthis.getProfile = getProfile;' +
        '\nthis.saveProfile = saveProfile;',
        ctx
    );
    return { ctx, sdt };
}

test('global view prefers locked archive over a newer unlocked clone', () => {
    const { ctx } = env({
        chatA: {
            '早濑沙纪': {
                displayName: '早濑沙纪', baseTags: 'locked-base', createdAt: 1000, updatedAt: 1000,
                baseLocked: true, isBaseLocked: true,
                wardrobe: [{ id: 'w1', name: '剧情: 泳装', outfit: 'swimsuit', locked: true }],
            },
        },
        chatB: {
            '早濑沙纪': {
                displayName: '早濑沙纪', baseTags: 'clone-base', createdAt: 2000, updatedAt: 9999,
                wardrobe: [{ id: 'w2', name: '剧情: 泳装', outfit: 'other', locked: false }],
            },
        },
        cur: {},
    });
    const g = ctx.getAllGlobalProfiles();
    assert.equal(g['早濑沙纪'].baseTags, 'locked-base');
    assert.equal(g['早濑沙纪'].createdAt, 1000);
    assert.equal(ctx.getProfile('早濑沙纪').baseTags, 'locked-base');
});

test('global view prefers oldest createdAt among unlocked clones', () => {
    const { ctx } = env({
        a: { '芙宁娜': { displayName: '芙宁娜', createdAt: 5000, updatedAt: 9000, baseTags: 'new' } },
        b: { '芙宁娜': { displayName: '芙宁娜', createdAt: 1000, updatedAt: 1000, baseTags: 'old' } },
        cur: {},
    });
    assert.equal(ctx.getAllGlobalProfiles()['芙宁娜'].baseTags, 'old');
});

test('global save syncs same createdAt copies but not a different-identity clone', () => {
    const { ctx, sdt } = env({
        cur: {
            '早濑沙纪': {
                displayName: '早濑沙纪', createdAt: 1000, updatedAt: 1000,
                baseTags: 'from-a', baseLocked: true, isBaseLocked: true,
                wardrobe: [{ id: 'w1', name: '泳装', outfit: 'swimsuit', locked: true }],
            },
        },
        same: {
            '早濑沙纪': {
                displayName: '早濑沙纪', createdAt: 1000, updatedAt: 1100,
                baseTags: 'imported-copy', baseLocked: true, isBaseLocked: true,
                wardrobe: [{ id: 'w1', name: '泳装', outfit: 'swimsuit', locked: true }],
            },
        },
        clone: {
            '早濑沙纪': {
                displayName: '早濑沙纪', createdAt: 2000, updatedAt: 9999,
                baseTags: 'unlocked-clone', wardrobe: [],
            },
        },
    });
    ctx.saveProfile('早濑沙纪', {
        displayName: '早濑沙纪', createdAt: 1000, baseTags: 'edited-locked',
        baseLocked: true, isBaseLocked: true,
        wardrobe: [{ id: 'w1', name: '泳装', outfit: 'swimsuit v2', locked: true }],
    }, 'all');
    assert.equal(sdt.characterProfiles.cur['早濑沙纪'].baseTags, 'edited-locked');
    assert.equal(sdt.characterProfiles.same['早濑沙纪'].baseTags, 'edited-locked');
    assert.equal(sdt.characterProfiles.clone['早濑沙纪'].baseTags, 'unlocked-clone', 'different createdAt must not be overwritten');
});

test('global save never overwrites a locked archive with an unlocked clone', () => {
    const { ctx, sdt } = env({
        cur: {
            '早濑沙纪': {
                displayName: '早濑沙纪', createdAt: 2000, updatedAt: 9999,
                baseTags: 'unlocked-clone', wardrobe: [],
            },
        },
        lockedChat: {
            '早濑沙纪': {
                displayName: '早濑沙纪', createdAt: 1000, updatedAt: 1000,
                baseTags: 'locked-original', baseLocked: true, isBaseLocked: true,
                outfitLocked: true, isOutfitLocked: true,
                wardrobe: [{ id: 'w1', name: '剧情: 泳装', outfit: 'swimsuit', locked: true }],
            },
        },
    });
    ctx.saveProfile('早濑沙纪', {
        displayName: '早濑沙纪', createdAt: 2000, baseTags: 'should-not-clobber',
        wardrobe: [],
    }, 'all');
    assert.equal(sdt.characterProfiles.lockedChat['早濑沙纪'].baseTags, 'locked-original');
    assert.equal(sdt.characterProfiles.cur['早濑沙纪'].baseTags, 'should-not-clobber');
});

test('legacy copies without createdAt still sync, but locked targets stay protected', () => {
    const { ctx, sdt } = env({
        cur: { 'A': { displayName: 'A', baseTags: 'new', aliases: ['x'] } },
        old: { 'A': { displayName: 'A', baseTags: 'old', aliases: ['y'] } },
        lockedOld: {
            'B': {
                displayName: 'B', baseTags: 'keep', baseLocked: true, isBaseLocked: true,
            },
        },
    });
    ctx.saveProfile('A', { displayName: 'A', baseTags: 'synced', aliases: ['z'] }, 'all');
    assert.equal(sdt.characterProfiles.old['A'].baseTags, 'synced');

    sdt.characterProfiles.cur = { 'B': { displayName: 'B', baseTags: 'unlocked-edit' } };
    ctx.ensureProfileBucket = () => sdt.characterProfiles.cur;
    ctx.saveProfile('B', { displayName: 'B', baseTags: 'unlocked-edit' }, 'all');
    assert.equal(sdt.characterProfiles.lockedOld['B'].baseTags, 'keep');
});

console.log(`\n${passed} workshop global profile identity tests passed.`);
