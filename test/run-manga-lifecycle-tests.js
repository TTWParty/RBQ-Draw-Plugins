/** Execute the complete Manga plugin and its cleanup with a minimal host. No network/image calls. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../plugins/manga-mode.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0, failed = 0;
function test(name, run) {
    try { run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function host() {
    const nodes = new Map(), listeners = new Map(), timers = new Map(), panels = new Map(), errors = [];
    const settings = { currentMode: 'nai', _mangaMode: { enabled: true, style: 'monochrome', dialogueMode: 'legacy',
        grammar: 'cinema', gutter: 'framed', autoSpread: false },
        _smartDrawTrigger: { _mangaActive: false, systemPromptPreset: 'custom', customSystemPrompt: 'ordinary custom',
            systemPrompt: 'ordinary active', enhancedContext: 'v13', multiCharOutput: false, multiCharUseCoords: true } };
    const ordinary = clone(settings._smartDrawTrigger);
    let id = 0;
    const document = {
        getElementById: key => nodes.get(key) || null,
        createElement: () => ({ style: {}, remove() { nodes.delete(this.id); } }),
        addEventListener(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
        removeEventListener(event, callback) { listeners.get(event)?.delete(callback); },
        head: { appendChild(node) { nodes.set(node.id, node); } }
    };
    const RBQ = {
        api: { getSettings: () => settings, saveSettings() {} }, hooks: {}, _pluginCleaners: new Map(),
        on(event, callback) { (this.hooks[event] ||= []).push(callback); },
        off(event, callback) { this.hooks[event] = (this.hooks[event] || []).filter(fn => fn !== callback); },
        emit(event, payload, context) { for (const fn of this.hooks[event] || []) payload = fn(payload, context) || payload; return payload; },
        registerCleanup(key, run) { this._pluginCleaners.get(key)?.(); this._pluginCleaners.set(key, run); },
        cleanupPlugin(key) { this._pluginCleaners.get(key)?.(); this._pluginCleaners.delete(key); },
        ui: { addSettingPanel(key, _label, render) { panels.set(key, render); }, removeSettingPanel(key) { panels.delete(key); } }
    };
    const context = vm.createContext({ RBQ, window: { RBQ }, document, jQuery: {},
        toastr: { info() {}, success() {}, warning() {}, error() {} },
        console: { info() {}, log() {}, warn() {}, error(...args) { errors.push(args); } },
        setInterval(fn) { const key = ++id; timers.set(key, fn); return key; },
        clearInterval(key) { timers.delete(key); },
        setTimeout(fn) { const key = ++id; timers.set(key, fn); return key; },
        clearTimeout(key) { timers.delete(key); }
    });
    function load() { vm.runInContext(source, context); assert.deepEqual(errors, []); }
    function fire(event, target) { for (const fn of listeners.get(event) || []) fn({ target, detail: { tab: 'manga-workshop' } }); }
    return { RBQ, settings, ordinary, nodes, listeners, timers, panels, load, fire };
}
const payload = () => ({ input: 'comic, office', parameters: { width: 832, height: 1216, negative_prompt: 'bad hands',
    v4_prompt: { caption: { base_caption: 'comic, office', char_captions: [] } },
    v4_negative_prompt: { caption: { base_caption: 'bad hands', char_captions: [] } } } });
test('complete plugin loads with exactly one image hook and one workshop panel', () => {
    const h = host(); h.load(); assert.equal(h.RBQ.hooks.buildNaiV4Payload.length, 1);
    assert.equal(h.panels.size, 1); assert.equal(h.settings._mangaMode.enabled, true);
    assert.equal(h.settings._smartDrawTrigger._mangaActive, true);
});
test('uninstall releases image hook, all document listeners and mount timers', () => {
    const h = host(); h.load(); h.RBQ.cleanupPlugin('rbq-manga-mode');
    assert.equal(h.RBQ.hooks.buildNaiV4Payload.length, 0);
    assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
    assert.equal(h.timers.size, 0); assert.equal(h.panels.size, 0); assert.equal(h.nodes.size, 0);
    assert.equal(h.RBQ.api.mangaProtocol, undefined); assert.equal(h.settings._mangaMode.enabled, false);
    assert.deepEqual(h.settings._smartDrawTrigger, h.ordinary);
});
test('even a previously retained hook is inert after cleanup', () => {
    const h = host(); h.load(); const hook = h.RBQ.hooks.buildNaiV4Payload[0];
    h.RBQ.cleanupPlugin('rbq-manga-mode');
    const p = payload(), before = clone(p);
    hook(p, { meta: { sdtCharacterData: { manga: true, renderSettings: { enabled: true, style: 'monochrome' } } } });
    assert.deepEqual(p, before);
});
test('loading a replacement keeps one instance and preserves the user mode choice', () => {
    const h = host(); h.load(); h.load();
    assert.equal(h.RBQ.hooks.buildNaiV4Payload.length, 1); assert.equal(h.settings._mangaMode.enabled, true);
    assert.equal(h.settings._mangaMode.dialogueMode, 'legacy'); assert.equal(h.settings._smartDrawTrigger._mangaActive, true);
    assert.equal(h.panels.size, 1); assert.ok(h.nodes.has('rbq-manga-mode-style'));
    assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 3);
    assert.equal(h.timers.size, 1);
    h.RBQ.cleanupPlugin('rbq-manga-mode'); assert.deepEqual(h.settings._smartDrawTrigger, h.ordinary);
});
test('pending mount callback cannot remount or resync after cleanup', () => {
    const h = host(); h.load();
    h.fire('click', { closest: selector => selector === '#st-scene-trigger-modal' ? {} : null });
    const callbacks = [...h.timers.values()];
    h.RBQ.cleanupPlugin('rbq-manga-mode'); callbacks.forEach(run => run());
    assert.equal(h.panels.size, 0); assert.equal(h.nodes.size, 0); assert.equal(h.settings._smartDrawTrigger._mangaActive, false);
    assert.equal(h.timers.size, 0);
});
test('cleanup is idempotent and cannot remove a later instance', () => {
    const h = host(); h.load(); const oldCleanup = h.RBQ._pluginCleaners.get('rbq-manga-mode');
    oldCleanup(); h.settings._mangaMode.enabled = true; h.load(); oldCleanup();
    assert.equal(h.RBQ.hooks.buildNaiV4Payload.length, 1); assert.equal(h.settings._mangaMode.enabled, true);
    assert.ok(h.RBQ.api.mangaProtocol); assert.equal(h.panels.size, 1);
});
console.log(`\n${passed} lifecycle tests passed; ${failed} failed.`);
if (failed) process.exitCode = 1;
