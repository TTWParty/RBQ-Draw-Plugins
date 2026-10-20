/** SDT 6.5.47: every parse import of a ⭐全局角色 shows ONE persistent toast 「已从全局角色导入「X」…」 with 「撤销」. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let passed = 0;
const test = async (n, fn) => { await fn(); passed++; console.log('PASS', n); };
const clone = v => JSON.parse(JSON.stringify(v));

const harness = fs.readFileSync(path.join(__dirname, 'run-manga-tests.js'), 'utf8').split('\ntest(')[0];
const U = 'white sailor school uniform, pleated navy skirt, red ribbon, black socks';
const baSaki = () => ({ displayName: '早濑沙纪', nameTag: 'Hayase Saki (Blue Archive)', nameTagSource: 'user', baseTags: 'girl, GLOBAL pink hair',
    aliases: ['沙纪'], currentOutfit: U, currentOutfitId: 'w1', wardrobe: [{ id: 'w1', name: '校服', outfit: U, triggers: [], locked: false }], createdAt: 1000, updatedAt: 1000 });

function env(messageText, globals = { '早濑沙纪': { profile: baSaki(), setAt: 1, updatedAt: 1 } }) {
    const e = new Function('require', '__dirname', harness + '\nreturn {sdt,settings,sdtSource,RBQ};')(require, __dirname);
    const load = (a, b) => { const i = e.sdtSource.indexOf(a), j = e.sdtSource.indexOf(b, i); assert.ok(i >= 0 && j > i, a); vm.runInContext(e.sdtSource.slice(i, j), e.sdt); };
    load('    function getCanonicalCharName(name) {', '    function getCharacterMemoryTagSpecification() {');
    load('    function mergeCharacterCaption(', '    function collectCharacterCardInfo(');
    load('    function normalizeTaggerResult(', '    function isMeaningfulLorebookEntry(');
    const chats = {};
    Object.assign(e.settings._smartDrawTrigger, { _mangaActive: false, enhancedContext: 'off', characterMemoryEnabled: true, multiCharOutput: false,
        characterProfiles: chats, globalCharacters: globals, cache: {} });
    e.toasts = [];
    const fakeToast = (kind) => (msg, title, opts) => {
        let handler = null;
        const btn = { disabled: false, blurred: false, blur() { this.blurred = true; }, addEventListener: (t, h) => { handler = h; }, click: () => handler && handler({ stopPropagation() {} }) };
        let closeHandler = null;
        const closeBtn = { addEventListener: (t, h) => { closeHandler = h; }, click: () => closeHandler && closeHandler({ stopPropagation() {} }) };
        const el = { isConnected: true, removed: false, remove() { this.removed = true; this.isConnected = false; },
            querySelector: sel => (/undo-global-import/.test(sel) && /撤销/.test(msg) ? btn : /toast-close-button/.test(sel) && opts?.closeButton ? closeBtn : null) };
        const t = { kind, msg, opts, btn, el, closeBtn };
        e.toasts.push(t);
        return [el];
    };
    e.cleared = [];
    e.sdt.toastr = { info: fakeToast('info'), success: fakeToast('success'), warning: fakeToast('warning'), error: fakeToast('error'),
        clear: (t, o) => e.cleared.push({ el: t?.[0], force: !!o?.force }) };
    e.timers = [];
    e.sdt.setTimeout = fn => { e.timers.push(fn); return e.timers.length; };
    e.runTimers = () => { while (e.timers.length) e.timers.shift()(); };
    e.sdt.escapeHtml = s => String(s);
    e.sdt.getChatKey = () => 'chatA';
    e.sdt.getMessageSnapshot = () => ({ mes: messageText });
    e.extraSaved = [];
    e.sdt.getMsgExtraSdt = () => null;
    e.sdt.saveMsgExtraSdt = (id, d) => e.extraSaved.push([id, clone(d)]);
    e.sdt.forgetMangaCharacterMemory = () => {};
    e.sdt.renderCardBadges = () => {};
    e.cards = [];
    e.RBQ.api.getMessageTextContainer = () => ({ querySelectorAll: () => e.cards });
    vm.runInContext('var CARD_CLASS = "rbq-sdt-card";', e.sdt);
    e.chats = chats;
    e.store = e.settings._smartDrawTrigger;
    return e;
}
const rawResult = (name, nameTag = 'Hayase Saki (Blue Archive)') => ({ segments: [
    { anchor: { text: '她笑了' }, label: '一', scene: 'classroom', characters: [{ name, name_tag: nameTag, base: 'girl, LLM black hair, long hair', outfit: 'red tracksuit, sneakers', action: 'smile' }] },
    { anchor: { text: '她走了' }, label: '二', scene: 'hallway', characters: [{ name, name_tag: nameTag, base: 'girl, LLM black hair, long hair', outfit: 'red tracksuit, sneakers', action: 'walking' }] },
] });
function parse(e, raw) {
    const result = e.sdt.normalizeTaggerResult(raw, []);
    const entry = { ...result, key: 'k1' };
    e.store.cache.k1 = entry;
    e.cards = entry.segments.map((s, i) => ({ dataset: { rbqSdtBaseKey: 'k1', rbqSdtSegmentKey: `k1-seg-${i}`, prompt: s.prompt, rbqSdtCharData: JSON.stringify(s.characters) } }));
    return { entry, notices: e.sdt.notifyGlobalImports(7, 'k1', entry) };
}
const importToasts = e => e.toasts.filter(t => /已从全局角色导入/.test(t.msg));
const undoToasts = e => importToasts(e).filter(t => /撤销/.test(t.msg));

(async () => {
const ev0 = e => e.store.cache.k1.segments[0].characters[0]._globalImport;
await test('解析导入全局角色 → 一条常驻提示带「撤销」（两个分镜也只一条）', () => {
    const e = env('早濑咲从走廊那头走来。');
    const { entry, notices } = parse(e, rawResult('早濑咲'));
    assert.ok(e.chats.chatA['早濑沙纪'].importedFromGlobal);
    assert.equal(notices.length, 1);
    const t = importToasts(e);
    assert.equal(t.length, 1);
    assert.match(t[0].msg, /已从全局角色导入「早濑沙纪」到当前会话（人设与服装已锁定）/);
    assert.match(t[0].msg, />撤销</);
    assert.equal(t[0].opts.timeOut, 0); assert.equal(t[0].opts.extendedTimeOut, 0); assert.equal(t[0].opts.closeButton, true);
    assert.ok(entry.segments.every(s => s.characters[0]._globalImport?.global === '早濑沙纪'));
    e.runTimers();
    assert.equal(importToasts(e).length, 1, 'safety timer does not duplicate');
});
await test('提示第二行：锁定说明（撤销提示 + 无撤销的普通提示都有）', () => {
    const e = env('早濑咲来了。');
    parse(e, rawResult('早濑咲'));
    const t = undoToasts(e)[0];
    assert.match(t.msg, /（人设与服装已锁定）<br><small style="opacity:\.8">锁定只是不让自动改写，在角色工坊里可以直接编辑；会话里的改动不会同步回全局<\/small><br><button/);
    e.toasts.length = 0;
    e.sdt.showGlobalImportToast(e.sdt.recordGlobalImportEvent({ key: '早濑沙纪', globalKey: '早濑沙纪' }), null);
    const plain = importToasts(e)[0];
    assert.match(plain.msg, /已从全局角色导入「早濑沙纪」到当前会话（人设与服装已锁定）<br><small[^>]*>锁定只是不让自动改写，在角色工坊里可以直接编辑；会话里的改动不会同步回全局<\/small>$/);
    assert.equal(plain.opts.escapeHtml, false);
    assert.doesNotMatch(plain.msg, /撤销/);
});
await test('同名导入同样提示（不再区分名字）', () => {
    const e = env('早濑沙纪来了。');
    parse(e, rawResult('早濑沙纪'));
    assert.equal(undoToasts(e).length, 1);
});
await test('已在当前会话（不是本次导入）或刷新恢复 → 不提示', () => {
    const e = env('x');
    parse(e, rawResult('早濑沙纪'));
    e.toasts.length = 0;
    parse(e, rawResult('早濑沙纪'));
    e.runTimers();
    assert.equal(importToasts(e).length, 0);
});
await test('非解析入口（如角色卡提取）立刻显示普通提示，无「撤销」', () => {
    const e = env('x');
    e.sdt.mergeCharacterCaption('早濑沙纪', 'girl', U, 'smile', '', 'Hayase Saki (Blue Archive)');
    assert.equal(importToasts(e).length, 1, 'no delay');
    assert.equal(undoToasts(e).length, 0);
    assert.deepEqual({ ...importToasts(e)[0].opts }, { escapeHtml: false }, 'plain (non-persistent) toast');
});
await test('手动/测试解析：flush 后立即普通提示，无「撤销」', () => {
    const e = env('x');
    e.sdt.normalizeTaggerResult(rawResult('早濑沙纪'), []);
    assert.equal(importToasts(e).length, 0);
    e.sdt.flushPendingGlobalImportToasts();
    assert.equal(importToasts(e).length, 1);
    assert.equal(undoToasts(e).length, 0);
    e.runTimers();
    assert.equal(importToasts(e).length, 1);
});
await test('撤销：本地未锁定的同名角色 X、无 importedFromGlobal、全局不变、卡片改绑、提示自动关闭', async () => {
    const e = env('早濑沙纪来了。');
    const globalBefore = clone(e.store.globalCharacters);
    const { entry } = parse(e, rawResult('早濑沙纪'));
    assert.match(entry.segments[0].prompt, /GLOBAL pink hair/);
    const t = undoToasts(e)[0];
    t.btn.click();
    await new Promise(r => setTimeout(r, 0));
    const p = e.chats.chatA['早濑沙纪'];
    assert.ok(p, 'local X exists');
    assert.equal(p.importedFromGlobal, undefined);
    assert.equal(!!p.baseLocked, false); assert.equal(!!p.outfitLocked, false);
    assert.ok((p.wardrobe || []).every(w => !w.locked && !w.fromGlobal));
    assert.match(p.baseTags, /LLM black hair/); assert.doesNotMatch(p.baseTags, /GLOBAL pink hair|Hayase Saki/);
    assert.match(p.currentOutfit, /red tracksuit/);
    assert.deepEqual(clone(e.store.globalCharacters), globalBefore, 'global untouched');
    for (const s of e.store.cache.k1.segments) {
        const c = s.characters[0];
        assert.equal(c.name, '早濑沙纪'); assert.equal(c._globalImport, undefined); assert.ok(c._globalImportUndone);
        assert.match(c.caption, /LLM black hair/); assert.doesNotMatch(c.caption, /GLOBAL pink hair/);
        assert.doesNotMatch(s.prompt, /GLOBAL pink hair/);
    }
    for (const card of e.cards) {
        assert.doesNotMatch(card.dataset.prompt, /GLOBAL pink hair/);
        assert.match(JSON.parse(card.dataset.rbqSdtCharData)[0].caption, /LLM black hair/);
    }
    assert.ok(e.extraSaved.length);
    assert.ok(e.toasts.some(x => x.kind === 'success' && /已撤销/.test(x.msg)), 'success toast');
    assert.ok(e.cleared.some(c => c.el === t.el && c.force)); assert.ok(t.btn.blurred);
    e.runTimers();
    assert.equal(t.el.removed, true, 'notice closed');
    // Next parse uses the local X (current chat wins), no re-import, no toast.
    e.toasts.length = 0;
    const next = parse(e, rawResult('早濑沙纪'));
    assert.equal(e.chats.chatA['早濑沙纪'].importedFromGlobal, undefined);
    assert.equal(importToasts(e).length, 0);
    assert.match(next.entry.segments[0].characters[0].caption, /LLM black hair/);
    assert.equal(next.entry.segments[0].characters[0]._globalImport, undefined);
});
await test('× 随时能关；撤销失败时提示保留、按钮恢复', async () => {
    const e = env('x');
    parse(e, rawResult('早濑沙纪'));
    const t = undoToasts(e)[0];
    e.store.cache = {};
    t.btn.click();
    await new Promise(r => setTimeout(r, 0));
    e.runTimers();
    assert.equal(t.el.removed, false); assert.equal(t.btn.disabled, false);
    assert.ok(e.toasts.some(x => x.kind === 'warning'));
    t.closeBtn.click(); e.runTimers();
    assert.ok(e.cleared.some(c => c.el === t.el && c.force)); assert.equal(t.el.removed, true);
});
await test('撤销：切换对话后拒绝；结果过期拒绝', async () => {
    const e = env('x');
    parse(e, rawResult('早濑沙纪'));
    const ev = ev0(e);
    assert.equal(await e.sdt.undoGlobalCharacterImport({ messageId: 7, cacheKey: 'k1', eventId: ev.id, globalKey: '早濑沙纪', chatKey: 'otherChat' }), false);
    assert.equal(await e.sdt.undoGlobalCharacterImport({ messageId: 7, cacheKey: 'k1', eventId: 'gi-stale', globalKey: '早濑沙纪', chatKey: 'chatA' }), false);
    assert.ok(e.chats.chatA['早濑沙纪'].importedFromGlobal);
});
await test('源码：去掉了名字比对/猜名；只在新解析后带撤销提示；提示词版本 46', () => {
    const src = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
    assert.doesNotMatch(src, /剧情里写的是|不是她|detectGlobalImportStoryName|guessStoryNameByPrefix|stripStoryNameHonorific|story_name/);
    assert.equal((src.match(/notifyGlobalImports\(messageId, cacheKey, cacheEntry\)/g) || []).length, 1);
    assert.equal((src.match(/flushPendingGlobalImportToasts\(\);/g) || []).length, 2);
    assert.match(src, /DEFAULT_SYSTEM_PROMPT_VERSION = 46\b/);
});
console.log(`\n${passed} passed`);
})().catch(err => { console.error(err); process.exit(1); });
