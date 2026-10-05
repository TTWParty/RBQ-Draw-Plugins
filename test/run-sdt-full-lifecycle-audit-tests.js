/** Complete SDT IIFE lifecycle regression with absent panels and real host event subscriptions. No services. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
let passed = 0, failed = 0;
function test(name, run) {
    try { run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function host() {
    const timers = new Map(), listeners = new Map(), events = new Map(), cleaners = new Map(), errors = [], actions = new Map();
    let id = 0, network = 0;
    const add = (key, fn) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); };
    class Element {
        constructor() { this.style = {}; this.dataset = {}; this.children = [];
            this.classList = { remove() {}, add() {}, contains: () => false }; }
        querySelector() { return null; } querySelectorAll() { return []; } appendChild() {} remove() {}
    }
    const body = new Element();
    const document = { body, head: body, documentElement: body, createElement: () => new Element(),
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        addEventListener: (event, fn) => add('document:' + event, fn),
        removeEventListener: (event, fn) => listeners.get('document:' + event)?.delete(fn) };
    const window = { addEventListener: (event, fn) => add('window:' + event, fn),
        removeEventListener: (event, fn) => listeners.get('window:' + event)?.delete(fn) };
    const settings = { currentMode: 'nai', _smartDrawTrigger: { enabled: false, lorebookEnabled: false,
        manualDrawEnabled: false, comicDrawerFloatingEnabled: false } };
    const previousIdentity = () => 'previous host identity';
    const eventSource = {
        on(event, fn) { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(fn); },
        off(event, fn) { events.get(event)?.delete(fn); }
    };
    const RBQ = { api: { getSettings: () => settings, saveSettings() {}, getContext: () => ({ chat: [], chatId: 'fixture' }),
        ensureCharacterNameTag: previousIdentity, eventSource, event_types: { CHARACTER_MESSAGE_RENDERED: 'char',
            MESSAGE_UPDATED: 'updated', USER_MESSAGE_RENDERED: 'user', MESSAGE_RECEIVED: 'received',
            GENERATION_STOPPED: 'stopped', CHAT_CHANGED: 'changed' } }, hooks: {},
        on(event, fn) { (this.hooks[event] ||= []).push(fn); },
        off(event, fn) { this.hooks[event] = (this.hooks[event] || []).filter(callback => callback !== fn); },
        ui: { registerTestAction(action) { actions.set(action.id, action); }, unregisterTestAction(key) { actions.delete(key); },
            removeSettingPanel() {} },
        registerCleanup(key, fn) { cleaners.get(key)?.(); cleaners.set(key, fn); },
        cleanupPlugin(key) { cleaners.get(key)?.(); cleaners.delete(key); } };
    window.RBQ = RBQ;
    const context = vm.createContext({ RBQ, window, document, Element, HTMLElement: Element, HTMLButtonElement: Element,
        HTMLInputElement: Element, jQuery: () => {}, localStorage: { getItem: () => null, setItem() {} }, navigator: {},
        location: { protocol: 'http:', hostname: 'localhost' }, MutationObserver: class { observe() {} disconnect() {} },
        console: { info() {}, log() {}, warn() {}, error(...args) { errors.push(args); } },
        setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, delay }); return key; }, clearTimeout(key) { timers.delete(key); },
        setInterval(fn, delay) { const key = ++id; timers.set(key, { fn, delay, interval: true }); return key; },
        clearInterval(key) { timers.delete(key); }, toastr: { warning() {}, success() {}, error() {}, info() {} },
        fetch() { network++; throw new Error('unexpected network'); } });
    const count = map => [...map.values()].reduce((total, callbacks) => total + callbacks.size, 0);
    return { RBQ, settings, window, timers, listeners, events, cleaners, actions, previousIdentity,
        load() { vm.runInContext(source, context); assert.deepEqual(errors, []); },
        listenerCount: () => count(listeners), eventCount: () => count(events), networkCount: () => network };
}

test('complete SDT uninstall releases every startup timer, host subscription, UI listener, hook and owned API', () => {
    const h = host(); h.load();
    assert.equal(h.RBQ.hooks.buildNaiV4Payload.length, 1); assert.equal(h.RBQ.hooks.buildComfyUiWorkflow.length, 1);
    assert.ok(h.timers.size); assert.ok(h.eventCount()); assert.ok(h.listenerCount());
    h.RBQ.cleanupPlugin('rbq-smart-draw-trigger');
    assert.equal(h.timers.size, 0); assert.equal(h.eventCount(), 0); assert.equal(h.listenerCount(), 0);
    assert.equal(h.RBQ.hooks.buildNaiV4Payload.length, 0); assert.equal(h.RBQ.hooks.buildComfyUiWorkflow.length, 0);
    assert.equal(h.RBQ.api.ensureCharacterNameTag, h.previousIdentity);
    assert.equal(h.RBQ.api.generateSdtImage, undefined); assert.equal(h.window.__rbqSdtCleanup, undefined);
    assert.equal(h.actions.size, 0); assert.equal(h.networkCount(), 0);
});
test('retained startup callbacks and host events cannot restart a disposed SDT instance', () => {
    const h = host(); h.load();
    const timers = [...h.timers.values()], events = [...h.events.values()].flatMap(callbacks => [...callbacks]);
    h.RBQ.cleanupPlugin('rbq-smart-draw-trigger');
    timers.forEach(timer => timer.fn()); events.forEach(fn => fn(0));
    assert.equal(h.timers.size, 0); assert.equal(h.eventCount(), 0); assert.equal(h.listenerCount(), 0);
    assert.equal(h.networkCount(), 0); assert.equal(h.RBQ.api.generateSdtImage, undefined);
});
test('full SDT replacement remains a singleton and stale cleanup cannot remove the replacement', () => {
    const h = host(); h.load();
    const previousCleanup = h.cleaners.get('rbq-smart-draw-trigger');
    const firstTimers = h.timers.size, firstEvents = h.eventCount(), firstListeners = h.listenerCount();
    h.load(); previousCleanup();
    assert.equal(h.RBQ.hooks.buildNaiV4Payload.length, 1); assert.equal(h.RBQ.hooks.buildComfyUiWorkflow.length, 1);
    assert.equal(h.timers.size, firstTimers); assert.equal(h.eventCount(), firstEvents); assert.equal(h.listenerCount(), firstListeners);
    assert.equal(typeof h.RBQ.api.generateSdtImage, 'function'); assert.equal(h.actions.size, 1);
    h.RBQ.cleanupPlugin('rbq-smart-draw-trigger');
    assert.equal(h.timers.size, 0); assert.equal(h.eventCount(), 0); assert.equal(h.listenerCount(), 0);
    assert.equal(h.RBQ.api.ensureCharacterNameTag, h.previousIdentity);
});
console.log(`\n${passed} full SDT lifecycle audit tests passed; ${failed} failed; 0 live calls.`);
if (failed) process.exitCode = 1;
