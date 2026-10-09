/** Error UI classifies protocol validation separately from provider refusals. Neutral text; no services. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../plugins/smart-draw-trigger.js'), 'utf8');
class Element {
    constructor() { this.style = {}; this.children = []; }
    querySelector() { return null; }
    append(...children) { this.children.push(...children); }
    addEventListener() {}
}
const context = vm.createContext({ HTMLElement: Element, getStore: () => ({ showTaggerDebug: true }),
    RBQ: { api: {} }, document: { createElement: () => new Element() } });
vm.runInContext(source.slice(source.indexOf('    function getTaggerDebugReason('),
    source.indexOf('    function openTaggerDebugModal(')), context);
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function tip(result) {
    const wrapper = new Element(); context.renderTaggerDebugInfo(wrapper, { isError: true, ...result });
    return wrapper.children[0].children[2].innerHTML;
}
const modelPages = JSON.stringify([{ format: 'nai5-comic', page: { base: 'comic, office',
    bubbles: [{ type: 'speech', text: '抱歉，我迟到了。请查看 safety audit 文件。' }] }, panels: [] }]);

test('stable ownership code overrides all literal model JSON and provider-looking strings', () => {
    const result = { errorCode: 'MANGA_BUBBLE_OWNERSHIP', reason: '文字归属检查失败', rawOutput: modelPages };
    assert.equal(context.getTaggerErrorCategory(result), 'manga-bubbles');
    assert.match(tip(result), /文字归属检查|bubbles/);
    assert.doesNotMatch(tip(result), /Safety Refusal|Jailbreak|开启破限|内容审核拦截/);
    const withProviderMetadata = { ...result, rawOutput: JSON.stringify({ choices: [{ finish_reason: 'content_filter' }] }) };
    assert.equal(context.getTaggerErrorCategory(withProviderMetadata), 'manga-bubbles');
});
test('speaker routing errors use bubble correction guidance without claiming page data are missing', () => {
    const result = { errorCode: 'MANGA_BUBBLE_SPEAKER', reason: '明确说话人目标存在已有文字，无法确定顺序', rawOutput: modelPages };
    assert.equal(context.getTaggerErrorCategory(result), 'manga-bubbles');
    assert.match(tip(result), /文字归属检查|bubbles/);
    assert.doesNotMatch(tip(result), /缺少可用|Safety Refusal|Jailbreak|开启破限/);
});
test('legacy ownership errors without codes receive the same correction guidance', () => {
    const result = { reason: '模型返回的结构化气泡文字归属错误，未提交生图。', rawOutput: modelPages };
    assert.equal(context.getTaggerErrorCategory(result), 'manga-bubbles');
    assert.match(tip(result), /模型已返回页面数据/);
    assert.doesNotMatch(tip(result), /Safety Refusal|Jailbreak|开启破限/);
});
test('other manga contract errors remain structure diagnostics even if their data mention safety', () => {
    const result = { reason: '漫画响应缺少有效的 shouldDraw/segments', rawOutput: modelPages };
    assert.equal(context.getTaggerErrorCategory(result), 'manga-structure');
    assert.match(tip(result), /页面或格内人物结构/);
    assert.doesNotMatch(tip(result), /Safety Refusal|Jailbreak|开启破限/);
});
test('task scope errors explain the requested bounds instead of claiming usable page data are missing', () => {
    const result = { errorCode: 'MANGA_TASK_SCOPE', reason: '漫画任务范围校验失败：本次页数 2 不符合任务范围，未提交生图', rawOutput: modelPages };
    assert.equal(context.getTaggerErrorCategory(result), 'manga-task');
    assert.match(tip(result), /单页\/单格限制、指定格数及 page.base/);
    assert.match(tip(result), /未截取额外页面/);
    assert.doesNotMatch(tip(result), /缺少可用|Safety Refusal|Jailbreak|开启破限/);
});
test('dialogue apologies and isolated safety words never establish an upstream refusal', () => {
    for (const rawOutput of [modelPages, '抱歉，我迟到了。', 'safety audit meeting',
        JSON.stringify({ note: 'content_filter is an API field name', page: { finish_reason: 'SAFETY' } })]) {
        const result = { reason: 'JSON 解析失败', rawOutput };
        assert.equal(context.getTaggerErrorCategory(result), '');
        assert.doesNotMatch(tip(result), /Safety Refusal|Jailbreak|开启破限/);
    }
});
test('explicit upstream safety messages remain classified as refusals with provider guidance', () => {
    for (const reason of ['大模型触发了官方前置内容安全审查 (SAFETY)',
        '大模型触发前置安全策略熔断 (content_filter)', '服务商拒绝回答',
        'tagger API 请求失败: HTTP 400 Prohibited Use policy']) {
        const result = { reason, rawOutput: '' };
        assert.equal(context.getTaggerErrorCategory(result), 'safety');
        assert.match(tip(result), /Safety Refusal|服务商支持/);
        assert.doesNotMatch(tip(result), /Jailbreak|开启破限/);
    }
});
test('structured OpenAI and native provider refusal metadata remain supported', () => {
    for (const envelope of [{ choices: [{ finish_reason: 'content_filter' }] },
        { choices: [{ finish_reason: 'content_filter: PROHIBITED_CONTENT' }] },
        { candidates: [{ finishReason: 'SAFETY' }] }, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } },
        { error: { code: 'CONTENT_FILTER' } }, { choices: [{ message: { refusal: 'Service declined this request.' } }] }]) {
        const result = { reason: '接口返回错误', rawOutput: JSON.stringify(envelope) };
        assert.equal(context.getTaggerErrorCategory(result), 'safety');
        assert.match(tip(result), /Safety Refusal/);
    }
});
test('literal trace fragments and request text cannot impersonate provider refusal metadata', () => {
    const result = { reason: '解析失败', rawOutput: '【发送的消息列表】: "finish_reason":"SAFETY"\n【原始正文】: 抱歉，我来晚了。' };
    assert.equal(context.getTaggerErrorCategory(result), '');
    assert.doesNotMatch(tip(result), /Safety Refusal/);
});
test('authentication errors use their explicit reason while unrelated body numbers stay ordinary', () => {
    assert.match(tip({ reason: 'tagger API 请求失败: HTTP 401 Unauthorized', rawOutput: '' }), /鉴权失败/);
    assert.doesNotMatch(tip({ reason: 'JSON 解析失败', rawOutput: JSON.stringify({ room: 401, status: 'late arrival' }) }), /鉴权失败/);
});
console.log(`\n${passed} SDT error classification tests passed; no live calls.`);
