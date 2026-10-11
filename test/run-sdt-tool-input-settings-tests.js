/** Tool input setting regressions using production settings functions and callbacks. No services. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
let passed = 0, failed = 0;

function slice(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `production section missing: ${start}`);
    return source.slice(from, to);
}

function statement(start) {
    const from = source.indexOf(start);
    assert.ok(from >= 0, `production statement missing: ${start}`);
    return source.slice(from, source.indexOf(';', from) + 1);
}

function test(name, run) {
    try { run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}

function host(initialStore = {}) {
    class Event {
        constructor(type, options = {}) { this.type = type; Object.assign(this, options); this.defaultPrevented = false; }
        preventDefault() { this.defaultPrevented = true; }
    }
    class Element {
        constructor(id) {
            this.id = id; this.value = ''; this.checked = false; this.disabled = false;
            this.style = {}; this.dataset = {}; this.attributes = {}; this.listeners = new Map();
        }
        setAttribute(key, value) { this.attributes[key] = String(value); }
        addEventListener(type, callback) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(callback);
        }
        dispatchEvent(event) {
            if (!event.target) event.target = this;
            for (const callback of this.listeners.get(event.type) || []) callback(event);
            return !event.defaultPrevented;
        }
    }
    class Input extends Element {}
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, id.endsWith('-field') ? new Element(id) : new Input(id));
        return elements.get(id);
    };
    const input = element('rbq-sdt-tool-input-description');
    const field = element('rbq-sdt-tool-input-description-field');
    field.dataset.rbqSdtProvider = 'openai';
    const tool = element('rbq-sdt-tool-call-mode');
    const provider = element('rbq-sdt-provider');
    provider.value = initialStore.provider || 'openai';
    element('rbq-sdt-system-preset').value = 'fixture';
    element('rbq-sdt-gemini-jailbreak-preset').value = 'fixture';
    const settings = { _smartDrawTrigger: { systemPromptVersion: 46, geminiJailbreakPreset: 'fixture', ...initialStore } };
    let saves = 0;
    const context = vm.createContext({
        document: {
            getElementById: element,
            querySelectorAll: selector => selector === '[data-rbq-sdt-provider]' ? [field] : [],
        },
        HTMLElement: Element, HTMLInputElement: Input, Event,
        RBQ: { api: { getSettings: () => settings } },
        STORAGE_KEY: '_smartDrawTrigger', ALT_STORAGE_KEY: '_smartDrawTriggerSettings',
        DEFAULT_SYSTEM_PROMPT_VERSION: 46, DEFAULT_SYSTEM_PROMPT_PRESET: 'fixture', DEFAULT_SYSTEM_PROMPT: 'fixture rules',
        DEFAULT_POST_PROCESS_PROMPT: 'fixture output rule', DEFAULT_JAILBREAK_PRESET: 'fixture',
        V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT: 'fixture rules', V5_SPEC_97_SYSTEM_PROMPT: 'fixture rules', JAILBREAK_PRESETS: {},
        PLUGIN_NAME: 'Smart Draw fixture', CARD_CLASS: 'rbq-sdt-card',
        save() { saves++; }, populateModelSelect() {}, populateApiTemplatesSelect() {},
        isMangaRequest: () => false, isMangaContextPreset: () => false,
        syncCardPositionsOnSettingChange() {}, scanLatestVisible() {},
        injectFloatingComicDrawerButton() {}, removeFloatingComicDrawerButton() {},
        window: { location: { protocol: 'http:' } },
        toastr: { success() {}, warning() {}, info() {} },
    });
    vm.runInContext(slice('    const DEFAULTS = {', '    const pendingTimers ='), context);
    vm.runInContext(slice('    function getStore() {', '    function save() {'), context);
    vm.runInContext(slice('    function val(id)', '    function populateModelSelect('), context);
    vm.runInContext(slice('    function updateProviderVisibility()', '    async function refreshOpenAiModels()'), context);
    context.store = context.getStore();
    vm.runInContext(statement("document.getElementById('rbq-sdt-tool-call-mode').checked"), context);
    vm.runInContext(statement("document.getElementById('rbq-sdt-tool-input-description').checked"), context);
    vm.runInContext(statement("bindSwitch('rbq-sdt-tool-input-description-field'"), context);
    vm.runInContext(statement("document.getElementById('rbq-sdt-tool-call-mode').addEventListener"), context);
    vm.runInContext(statement("document.getElementById('rbq-sdt-provider').addEventListener"), context);
    vm.runInContext(slice('        // API templates selection/change', '        // API templates delete'), context);
    vm.runInContext(slice("        document.getElementById('rbq-sdt-save').onclick", "        document.getElementById('rbq-sdt-system-preset').addEventListener"), context);
    context.updateProviderVisibility();
    return { context, element, input, field, tool, provider, settings,
        store: context.getStore(), saves: () => saves,
        dispatch(target, type, options = {}) { target.dispatchEvent(new Event(type, options)); },
    };
}

test('legacy settings initialize the new setting to false and restore its checkbox', () => {
    const h = host({ toolCallMode: true });
    assert.equal(h.store.toolInputInDescription, false);
    assert.equal(h.input.checked, false);
    assert.equal(h.settings._smartDrawTriggerSettings, h.store);
});

test('Tool Call off disables mouse and keyboard activation while preserving the selected value', () => {
    const h = host({ toolCallMode: false, toolInputInDescription: true });
    assert.equal(h.input.checked, true);
    assert.equal(h.input.disabled, true);
    assert.equal(h.field.attributes['aria-disabled'], 'true');
    assert.equal(h.field.tabIndex, -1);
    h.dispatch(h.field, 'click');
    h.dispatch(h.field, 'keydown', { key: 'Enter' });
    h.dispatch(h.field, 'keydown', { key: ' ' });
    assert.equal(h.input.checked, true);
    assert.equal(h.field.attributes['aria-checked'], 'true');
});

test('the real Tool Call change listener enables the child switch and its activation events', () => {
    const h = host({ toolCallMode: false, toolInputInDescription: false });
    h.tool.checked = true;
    h.dispatch(h.tool, 'change');
    assert.equal(h.input.disabled, false);
    assert.equal(h.field.attributes['aria-disabled'], 'false');
    assert.equal(h.field.tabIndex, 0);
    h.dispatch(h.field, 'click');
    assert.equal(h.input.checked, true);
    assert.equal(h.field.attributes['aria-checked'], 'true');
    h.dispatch(h.field, 'keydown', { key: 'Enter' });
    assert.equal(h.input.checked, false);
    h.dispatch(h.field, 'keydown', { key: ' ' });
    assert.equal(h.input.checked, true);
});

test('custom provider hides and disables the new option, and switching back restores the selection', () => {
    const h = host({ toolCallMode: true, toolInputInDescription: true });
    h.provider.value = 'custom';
    h.dispatch(h.provider, 'change');
    assert.equal(h.field.style.display, 'none');
    assert.equal(h.input.disabled, true);
    h.dispatch(h.field, 'click');
    assert.equal(h.input.checked, true);
    h.provider.value = 'openai';
    h.dispatch(h.provider, 'change');
    assert.equal(h.field.style.display, '');
    assert.equal(h.input.disabled, false);
    assert.equal(h.input.checked, true);
});

test('API template save and load round-trip the new option through the real callbacks', () => {
    const h = host({ toolCallMode: true, toolInputInDescription: false });
    h.input.checked = true;
    h.element('rbq-sdt-new-template-name').value = 'Neutral fixture';
    h.element('rbq-sdt-save-api-template').onclick();
    assert.equal(h.store.apiTemplates.length, 1);
    assert.equal(h.store.apiTemplates[0].toolInputInDescription, true);
    h.input.checked = false;
    h.store.toolInputInDescription = false;
    const select = h.element('rbq-sdt-api-template');
    select.value = 'Neutral fixture';
    h.dispatch(select, 'change');
    assert.equal(h.store.toolInputInDescription, true);
    assert.equal(h.input.checked, true);
    assert.equal(h.field.attributes['aria-checked'], 'true');
    assert.equal(h.input.disabled, false);
    assert.equal(h.saves(), 2);
});

test('loading an old API template without the new field resets both stored and visible selection', () => {
    const h = host({ toolCallMode: true, toolInputInDescription: true,
        apiTemplates: [{ name: 'Legacy fixture', provider: 'openai', toolCallMode: true }] });
    const select = h.element('rbq-sdt-api-template');
    select.value = 'Legacy fixture';
    h.dispatch(select, 'change');
    assert.equal(h.store.toolInputInDescription, false);
    assert.equal(h.input.checked, false);
    assert.equal(h.field.attributes['aria-checked'], 'false');
    assert.equal(h.saves(), 1);
});

test('loading a legacy template without Tool Call clears the main checkbox and disables its child', () => {
    const h = host({ toolCallMode: true, toolInputInDescription: true,
        apiTemplates: [{ name: 'Minimal legacy fixture', provider: 'openai', toolInputInDescription: true }] });
    const select = h.element('rbq-sdt-api-template');
    select.value = 'Minimal legacy fixture';
    h.dispatch(select, 'change');
    assert.equal(h.store.toolCallMode, false);
    assert.equal(h.tool.checked, false);
    assert.equal(h.store.toolInputInDescription, true);
    assert.equal(h.input.checked, true);
    assert.equal(h.input.disabled, true);
    assert.equal(h.field.attributes['aria-disabled'], 'true');
    assert.equal(h.field.tabIndex, -1);
});

test('main settings save writes the new option and preserves it while Tool Call is off', () => {
    const h = host({ toolCallMode: false, toolInputInDescription: true });
    h.element('rbq-sdt-save').onclick();
    assert.equal(h.store.toolCallMode, false);
    assert.equal(h.store.toolInputInDescription, true);
    h.tool.checked = true;
    h.dispatch(h.tool, 'change');
    h.dispatch(h.field, 'click');
    h.element('rbq-sdt-save').onclick();
    assert.equal(h.store.toolCallMode, true);
    assert.equal(h.store.toolInputInDescription, false);
    assert.equal(h.saves(), 2);
});

console.log(`\n${passed} tool input settings tests passed; ${failed} failed; 0 live calls.`);
if (failed) process.exitCode = 1;
