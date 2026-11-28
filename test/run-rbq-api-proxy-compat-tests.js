/** Verify cross-plugin RBQ.api sharing works under both broken v0.3.126/v0.3.127 Object.create host isolation and v0.3.128 Proxy host. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const pluginsDir = path.join(__dirname, '../plugins');
const mangaSrc = fs.readFileSync(path.join(pluginsDir, 'manga-mode.js'), 'utf8');
const sdtSrc = fs.readFileSync(path.join(pluginsDir, 'smart-draw-trigger.js'), 'utf8');
const privacySrc = fs.readFileSync(path.join(pluginsDir, 'image-privacy-mode.js'), 'utf8');
const presetsSrc = fs.readFileSync(path.join(pluginsDir, 'prompt-presets.js'), 'utf8');

const coreIndex = fs.readFileSync(path.join(__dirname, '../../st-scene-trigger/index.js'), 'utf8');
const proxyStart = coreIndex.indexOf('function createScopedProxy(target, overrides) {');
const proxyEnd = coreIndex.indexOf('function executePluginScript(', proxyStart);
assert.ok(proxyStart >= 0 && proxyEnd > proxyStart, 'createPluginScopedRbq slice found in st-scene-trigger/index.js');
const createScopedRbqSlice = coreIndex.slice(proxyStart, proxyEnd);

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log('PASS', name);
}

function makeHost({ useLegacyObjectCreate }) {
    const errors = [];
    const listeners = new Map();
    const timers = new Map();
    let timerId = 0;
    const settings = {
        currentMode: 'nai',
        _mangaMode: { enabled: true, style: 'monochrome', dialogueMode: 'structured', grammar: 'cinema', gutter: 'framed', autoSpread: false },
        _smartDrawTrigger: { enabled: false, lorebookEnabled: false, manualDrawEnabled: false, comicDrawerFloatingEnabled: false },
        _promptPresets: { presets: [], activeId: '' },
    };
    const origRender = (wrapper, res) => ({ wrapper, res, wrapped: false });
    class Element {
        constructor() {
            this.style = {}; this.dataset = {}; this.children = [];
            this.classList = { remove() {}, add() {}, toggle() {}, contains: () => false };
        }
        querySelector() { return null; }
        querySelectorAll() { return []; }
        appendChild() {}
        remove() {}
        closest() { return null; }
    }
    const body = new Element();
    const document = {
        body, head: body, documentElement: body,
        createElement: () => new Element(),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: (ev, fn) => { (listeners.get(ev) || listeners.set(ev, new Set()).get(ev)).add(fn); },
        removeEventListener: (ev, fn) => listeners.get(ev)?.delete(fn),
    };
    const eventSource = { on() {}, off() {}, removeListener() {} };
    const baseRbq = {
        hooks: {},
        _pluginCleaners: new Map(),
        _pluginOwned: new Map(),
        _activePluginId: null,
        utils: { copyToClipboard: async () => true, escapeHtml: (s) => String(s || '') },
        _ensurePluginBucket(pluginId) {
            if (!pluginId) return null;
            let b = this._pluginOwned.get(pluginId);
            if (!b) { b = { hooks: [], panels: new Set(), testActions: new Set(), modes: new Set() }; this._pluginOwned.set(pluginId, b); }
            return b;
        },
        on(ev, cb, pid) {
            (this.hooks[ev] ||= []).push(cb);
            if (pid || this._activePluginId) this._ensurePluginBucket(pid || this._activePluginId)?.hooks.push([ev, cb]);
        },
        off(ev, cb) { this.hooks[ev] = (this.hooks[ev] || []).filter((fn) => fn !== cb); },
        registerCleanup(pid, fn) {
            if (this._pluginCleaners.has(pid)) this._pluginCleaners.get(pid)();
            this._pluginCleaners.set(pid, fn);
        },
        registerPluginCleanup(pid, fn) { return this.registerCleanup(pid, fn); },
        cleanupPlugin(pid) {
            this._pluginCleaners.get(pid)?.();
            this._pluginCleaners.delete(pid);
            const b = this._pluginOwned.get(pid);
            if (b) {
                this._pluginOwned.delete(pid);
                for (const [ev, cb] of b.hooks) this.off(ev, cb);
            }
        },
        ui: {
            panels: [], testActions: [],
            addSettingPanel(id, title, render, pid) {
                this.panels = this.panels.filter((p) => p.id !== id).concat([{ id, title, render }]);
                if (pid || baseRbq._activePluginId) baseRbq._ensurePluginBucket(pid || baseRbq._activePluginId)?.panels.add(id);
            },
            removeSettingPanel(id) { this.panels = this.panels.filter((p) => p.id !== id); },
            registerTestAction(action, pid) {
                this.testActions = this.testActions.filter((a) => a.id !== action.id).concat([action]);
                if (pid || baseRbq._activePluginId) baseRbq._ensurePluginBucket(pid || baseRbq._activePluginId)?.testActions.add(action.id);
            },
            unregisterTestAction(id) { this.testActions = this.testActions.filter((a) => a.id !== id); },
        },
        api: {
            getSettings: () => settings,
            saveSettings() {},
            getContext: () => ({ chat: [], chatId: 'test-chat' }),
            renderInlineGeneratedImage: origRender,
            eventSource,
            event_types: { CHARACTER_MESSAGE_RENDERED: 'c', MESSAGE_UPDATED: 'u', USER_MESSAGE_RENDERED: 'ur', MESSAGE_RECEIVED: 'mr', GENERATION_STOPPED: 'gs', CHAT_CHANGED: 'cc' },
            registerMode(id, _m, _f, pid) { if (pid || baseRbq._activePluginId) baseRbq._ensurePluginBucket(pid || baseRbq._activePluginId)?.modes.add(id); },
            unregisterMode() {},
        },
    };
    const windowObj = {
        RBQ: baseRbq,
        addEventListener: (ev, fn) => { (listeners.get('w:' + ev) || listeners.set('w:' + ev, new Set()).get('w:' + ev)).add(fn); },
        removeEventListener: (ev, fn) => listeners.get('w:' + ev)?.delete(fn),
    };

    function createLegacyScopedRbq(pluginId) {
        const scopedUi = Object.create(baseRbq.ui);
        scopedUi.addSettingPanel = (id, title, fn) => baseRbq.ui.addSettingPanel(id, title, fn, pluginId);
        scopedUi.registerTestAction = (a) => baseRbq.ui.registerTestAction(a, pluginId);
        const scopedApi = Object.create(baseRbq.api);
        scopedApi.registerMode = (id, m, f) => baseRbq.api.registerMode(id, m, f, pluginId);
        const scopedRbq = Object.create(baseRbq);
        scopedRbq.ui = scopedUi;
        scopedRbq.api = scopedApi;
        scopedRbq.on = (ev, cb) => baseRbq.on(ev, cb, pluginId);
        scopedRbq.registerCleanup = (a, b) => (typeof a === 'function' ? baseRbq.registerCleanup(pluginId, a) : baseRbq.registerCleanup(a || pluginId, b));
        scopedRbq.registerPluginCleanup = scopedRbq.registerCleanup;
        return scopedRbq;
    }

    const context = vm.createContext({
        window: windowObj, document, Element, HTMLElement: Element, HTMLButtonElement: Element, HTMLInputElement: Element,
        jQuery: () => {}, localStorage: { getItem: () => null, setItem() {} }, navigator: {},
        location: { protocol: 'http:', hostname: 'localhost' },
        MutationObserver: class { observe() {} disconnect() {} },
        console: { info() {}, log() {}, warn() {}, error(...a) { errors.push(a); } },
        setTimeout(fn) { const k = ++timerId; timers.set(k, fn); return k; }, clearTimeout(k) { timers.delete(k); },
        setInterval(fn) { const k = ++timerId; timers.set(k, fn); return k; }, clearInterval(k) { timers.delete(k); },
        toastr: { info() {}, success() {}, warning() {}, error() {} },
        fetch() { throw new Error('no network in test'); },
    });
    const makeProxyScoped = vm.runInContext(`${createScopedRbqSlice}\ncreatePluginScopedRbq;`, context);

    function exec(pluginId, code) {
        baseRbq.cleanupPlugin(pluginId);
        const scoped = useLegacyObjectCreate ? createLegacyScopedRbq(pluginId) : makeProxyScoped(pluginId);
        const runner = vm.runInContext('(function(scopedRbq, code){ new Function("RBQ","jQuery","toastr", code)(scopedRbq, function(){}, {info(){},success(){},warning(){},error(){}}); })', context);
        runner(scoped, code);
        assert.deepEqual(errors, [], `No uncaught errors loading ${pluginId}`);
    }

    return { baseRbq, origRender, exec };
}

for (const useLegacyObjectCreate of [true, false]) {
    const label = useLegacyObjectCreate ? 'legacy v0.3.126/0.3.127 Object.create host' : 'fixed v0.3.128 Proxy host';

    test(`${label}: manga-mode + smart-draw-trigger + image-privacy-mode + prompt-presets share RBQ.api and clean up cleanly`, () => {
        const h = makeHost({ useLegacyObjectCreate });
        h.exec('rbq-smart-draw-trigger', sdtSrc);
        h.exec('rbq-manga-mode', mangaSrc);
        h.exec('rbq-image-privacy', privacySrc);
        h.exec('rbq-prompt-presets', presetsSrc);

        assert.ok(h.baseRbq.api.mangaProtocol, 'mangaProtocol visible on host RBQ.api');
        assert.equal(typeof h.baseRbq.api.generateSdtImage, 'function', 'SDT exports visible on host RBQ.api');
        assert.equal(typeof h.baseRbq.api.refreshPromptPresetsUi, 'function', 'refreshPromptPresetsUi visible on host RBQ.api');
        assert.notEqual(h.baseRbq.api.renderInlineGeneratedImage, h.origRender, 'image-privacy patch reaches host RBQ.api');
        assert.equal(h.baseRbq.api.renderInlineGeneratedImage.__origRender, h.origRender);

        // Verify SDT running on the same sandbox sees mangaProtocol instead of throwing.
        h.exec('probe-reader', `
            if (!RBQ.api.mangaProtocol || typeof RBQ.api.generateSdtImage !== 'function' || typeof RBQ.api.refreshPromptPresetsUi !== 'function') {
                throw new Error('cross-plugin RBQ.api missing');
            }
        `);

        h.baseRbq.cleanupPlugin('rbq-image-privacy');
        assert.equal(h.baseRbq.api.renderInlineGeneratedImage, h.origRender, 'image-privacy uninstall restores original renderer');

        h.baseRbq.cleanupPlugin('rbq-manga-mode');
        assert.equal(h.baseRbq.api.mangaProtocol, undefined, 'manga-mode uninstall deletes mangaProtocol');
        assert.equal(typeof h.baseRbq.api.generateSdtImage, 'function', 'SDT API survives manga uninstall');

        h.baseRbq.cleanupPlugin('rbq-smart-draw-trigger');
        assert.equal(h.baseRbq.api.generateSdtImage, undefined, 'SDT uninstall deletes its own APIs');
    });
}

console.log(`\n${passed} RBQ.api proxy compatibility tests passed.`);
