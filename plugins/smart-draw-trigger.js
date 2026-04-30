(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Smart Draw Trigger] RBQ Core API missing');

    const PLUGIN_NAME = '智能生图触发器';
    const STORAGE_KEY = '_smartDrawTrigger';
    const CARD_CLASS = 'rbq-sdt-card';
    const DEFAULT_SYSTEM_PROMPT = `你是 SillyTavern/RBQ 生图扩展的提示词规划器。你的任务是根据聊天正文判断是否需要插入一张图片，并输出 NovelAI/通用文生图英文 prompt。

必须只返回 JSON，不要返回 markdown，不要解释。
JSON 格式：
{
  "shouldDraw": true,
  "prompt": "english image prompt, comma separated tags",
  "negative": "optional negative prompt",
  "anchor": { "type": "sentence", "index": 1 },
  "reason": "short chinese reason"
}

规则：
- shouldDraw=false 时 prompt 为空字符串。
- prompt 只写画面描述，不要包含 [scene]、[img] 等包裹标签。
- anchor.index 表示插在当前消息第几句之后，从 1 开始；不确定就用 1。
- 如果用户提供了 marker，代表该位置强制需要生图。
- 不要把无关系统说明、分析过程、审查声明写进 prompt。`;

    const DEFAULTS = {
        enabled: false,
        mode: 'hybrid', // off | marker | auto | hybrid
        provider: 'openai', // openai | custom
        openaiBaseUrl: '',
        openaiApiKey: '',
        openaiModel: '',
        openaiModels: [],
        customUrl: '',
        customApiKey: '',
        customApiKeyHeader: 'Authorization',
        contextCount: 5,
        markers: '[draw]\n[画图]',
        targetRole: 'assistant',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        cache: {},
    };

    const pendingTimers = new Map();
    const inFlight = new Set();

    function getStore() {
        const settings = RBQ.api.getSettings();
        if (!settings[STORAGE_KEY]) settings[STORAGE_KEY] = {};
        const store = settings[STORAGE_KEY];
        for (const [key, value] of Object.entries(DEFAULTS)) {
            if (store[key] === undefined) store[key] = value;
        }
        if (!store.cache || typeof store.cache !== 'object') store.cache = {};
        return store;
    }

    function save() {
        RBQ.api.saveSettings();
    }

    function hashText(text) {
        const str = String(text || '');
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function parseMarkers(value) {
        return String(value || '')
            .split(/[\n,，]+/)
            .map(item => item.trim())
            .filter(Boolean);
    }

    function shouldHandleMessage(message) {
        const store = getStore();
        if (!store.enabled || store.mode === 'off' || !message) return false;
        if (store.targetRole === 'assistant') return !message.is_user;
        if (store.targetRole === 'user') return !!message.is_user;
        return true;
    }

    function getDomMessageText(messageId) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return '';
        const clone = container.cloneNode(true);
        if (!(clone instanceof HTMLElement)) return '';
        clone.querySelectorAll(`.${CARD_CLASS}, .st-scene-trigger-inline-wrap, script, style`).forEach(node => node.remove());
        return String(clone.textContent || '').trim();
    }

    function getMessageSnapshot(messageId) {
        const source = RBQ.api.getMessage(messageId) || {};
        const domText = getDomMessageText(messageId);
        const mes = domText || String(source.mes || '');
        return {
            ...source,
            mes,
            is_user: !!source.is_user,
            name: source.name || '',
        };
    }

    function makeKey(messageId, message, mode, marker) {
        return `${messageId}:${hashText(message?.mes || '')}:${mode}:${hashText(marker || '')}`;
    }

    function pruneCache() {
        const store = getStore();
        const entries = Object.entries(store.cache || {});
        if (entries.length <= 200) return;
        entries
            .sort((a, b) => Number(a[1]?.createdAt || 0) - Number(b[1]?.createdAt || 0))
            .slice(0, entries.length - 200)
            .forEach(([key]) => delete store.cache[key]);
        save();
    }

    function getTrigger(message) {
        const store = getStore();
        const text = String(message?.mes || '');
        const markers = parseMarkers(store.markers);
        const found = markers.find(marker => text.includes(marker));
        if ((store.mode === 'marker' || store.mode === 'hybrid') && found) {
            return { type: 'marker', marker: found };
        }
        if (store.mode === 'auto' || store.mode === 'hybrid') {
            return { type: 'auto', marker: '' };
        }
        return null;
    }

    function normalizeBaseUrl(baseUrl) {
        const base = String(baseUrl || '').trim().replace(/\/+$/, '');
        if (!base) return '';
        if (/\/chat\/completions$/.test(base)) return base;
        return `${base}/chat/completions`;
    }

    function normalizeModelsUrl(baseUrl) {
        const base = String(baseUrl || '').trim().replace(/\/+$/, '');
        if (!base) return '';
        if (/\/chat\/completions$/.test(base)) return base.replace(/\/chat\/completions$/, '/models');
        if (/\/models$/.test(base)) return base;
        return `${base}/models`;
    }

    function buildRequestPayload(messageId, trigger) {
        const store = getStore();
        const current = getMessageSnapshot(messageId);
        const recentMessages = RBQ.api.getRecentMessages(messageId, store.contextCount).map(item => ({
            id: item.id,
            role: item.is_user ? 'user' : 'assistant',
            name: item.name,
            content: item.mes,
        }));
        if (recentMessages.length) {
            const last = recentMessages[recentMessages.length - 1];
            if (Number(last.id) === Number(messageId)) last.content = current.mes;
        }
        return {
            mode: trigger.type,
            marker: trigger.marker || '',
            messageId,
            currentMessage: {
                role: current?.is_user ? 'user' : 'assistant',
                name: current?.name || '',
                content: String(current?.mes || ''),
            },
            recentMessages,
            contextCount: Number(store.contextCount) || 5,
            outputSchema: {
                shouldDraw: 'boolean',
                prompt: 'string',
                negative: 'string optional',
                anchor: { type: 'sentence', index: 'number, 1-based' },
                reason: 'string optional',
            },
        };
    }

    function extractJson(text) {
        const raw = String(text || '').trim();
        if (!raw) throw new Error('tagger 返回为空');
        try { return JSON.parse(raw); } catch (_) { }
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) {
            try { return JSON.parse(fenced[1]); } catch (_) { }
        }
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
        throw new Error('tagger 返回不是有效 JSON');
    }

    function normalizeTaggerResult(data) {
        const source = data?.choices?.[0]?.message?.content ? extractJson(data.choices[0].message.content) : data;
        return {
            shouldDraw: !!source?.shouldDraw,
            prompt: String(source?.prompt || '').trim(),
            negative: String(source?.negative || '').trim(),
            anchor: source?.anchor && typeof source.anchor === 'object'
                ? { type: source.anchor.type || 'sentence', index: Math.max(1, Number(source.anchor.index) || 1) }
                : { type: 'sentence', index: 1 },
            reason: String(source?.reason || '').trim(),
        };
    }

    async function callOpenAiCompatible(messageId, trigger) {
        const store = getStore();
        const url = normalizeBaseUrl(store.openaiBaseUrl);
        if (!url) throw new Error('请先填写 OpenAI 兼容接口 Base URL');
        if (!store.openaiModel) throw new Error('请先填写模型名称');
        const body = buildRequestPayload(messageId, trigger);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(store.openaiApiKey ? { Authorization: `Bearer ${store.openaiApiKey}` } : {}),
            },
            body: JSON.stringify({
                model: store.openaiModel,
                temperature: 0.2,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: store.systemPrompt || DEFAULT_SYSTEM_PROMPT },
                    { role: 'user', content: JSON.stringify(body, null, 2) },
                ],
            }),
        });
        if (!response.ok) throw new Error(`tagger API 请求失败: HTTP ${response.status} ${await response.text()}`);
        return normalizeTaggerResult(await response.json());
    }

    async function callCustomHttp(messageId, trigger) {
        const store = getStore();
        const url = String(store.customUrl || '').trim();
        if (!url) throw new Error('请先填写自定义 HTTP 接口地址');
        const headers = { 'Content-Type': 'application/json' };
        if (store.customApiKey) {
            const headerName = store.customApiKeyHeader || 'Authorization';
            headers[headerName] = headerName.toLowerCase() === 'authorization' ? `Bearer ${store.customApiKey}` : store.customApiKey;
        }
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(buildRequestPayload(messageId, trigger)),
        });
        if (!response.ok) throw new Error(`自定义 tagger 请求失败: HTTP ${response.status} ${await response.text()}`);
        return normalizeTaggerResult(await response.json());
    }

    async function callTagger(messageId, trigger) {
        const store = getStore();
        return store.provider === 'custom'
            ? callCustomHttp(messageId, trigger)
            : callOpenAiCompatible(messageId, trigger);
    }

    function visibleTextNodes(root) {
        const nodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest(`.${CARD_CLASS}, .st-scene-trigger-inline-wrap, script, style`)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) nodes.push(walker.currentNode);
        return nodes;
    }

    function insertWrapperAtTextNode(node, start, end, wrapper) {
        const text = node.nodeValue || '';
        const fragment = document.createDocumentFragment();
        if (start > 0) fragment.append(document.createTextNode(text.slice(0, start)));
        fragment.append(wrapper);
        if (end < text.length) fragment.append(document.createTextNode(text.slice(end)));
        node.parentNode.replaceChild(fragment, node);
    }

    function insertAtMarker(container, marker, wrapper) {
        for (const node of visibleTextNodes(container)) {
            const text = node.nodeValue || '';
            const index = text.indexOf(marker);
            if (index >= 0) {
                insertWrapperAtTextNode(node, index, index + marker.length, wrapper);
                return true;
            }
        }
        return false;
    }

    function insertAfterSentence(container, sentenceIndex, wrapper) {
        const targetIndex = Math.max(1, Number(sentenceIndex) || 1);
        let seen = 0;
        const sentenceRegex = /[^。！？.!?\n]+[。！？.!?]?/g;
        for (const node of visibleTextNodes(container)) {
            const text = node.nodeValue || '';
            let match;
            while ((match = sentenceRegex.exec(text))) {
                if (!match[0].trim()) continue;
                seen += 1;
                if (seen === targetIndex) {
                    const insertAt = match.index + match[0].length;
                    insertWrapperAtTextNode(node, insertAt, insertAt, wrapper);
                    return true;
                }
            }
        }
        return false;
    }

    function insertCard(messageId, trigger, result, key) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return null;
        const existing = container.querySelector(`[data-rbq-sdt-key="${CSS.escape(key)}"]`);
        if (existing instanceof HTMLElement) return existing;
        const wrapper = RBQ.api.createPromptCard({
            messageId,
            prompt: result.prompt,
            raw: trigger.marker || '[Smart Draw]',
            id: `smart-draw:${key}`,
            label: 'smart-draw',
        });
        if (!(wrapper instanceof HTMLElement)) return null;
        wrapper.classList.add(CARD_CLASS);
        wrapper.dataset.rbqSdtKey = key;
        wrapper.dataset.rbqSdtReason = result.reason || '';
        const inserted = trigger.type === 'marker' && trigger.marker
            ? insertAtMarker(container, trigger.marker, wrapper)
            : insertAfterSentence(container, result.anchor?.index || 1, wrapper);
        if (!inserted) container.append(wrapper);
        return wrapper;
    }

    function setWrapperLoading(wrapper, text) {
        const button = wrapper?.querySelector?.('.st-scene-trigger-generate');
        const loader = wrapper?.querySelector?.('.st-scene-trigger-inline-loader');
        if (button instanceof HTMLElement) button.style.display = 'none';
        if (loader instanceof HTMLElement) {
            loader.style.display = 'flex';
            const sub = loader.querySelector('.st-scene-trigger-nai-loader-sub');
            if (sub instanceof HTMLElement) sub.textContent = text || '智能触发器正在生成图片...';
        }
    }

    function clearWrapperLoading(wrapper) {
        const button = wrapper?.querySelector?.('.st-scene-trigger-generate');
        const loader = wrapper?.querySelector?.('.st-scene-trigger-inline-loader');
        if (loader instanceof HTMLElement) loader.style.display = 'none';
        if (button instanceof HTMLElement) button.style.display = '';
    }

    async function maybeAutoGenerate(wrapper, result, messageId, key) {
        const store = getStore();
        if (!RBQ.api.shouldAutoGenerate() || store.cache[key]?.autoGenerated) return;
        try {
            setWrapperLoading(wrapper, '智能触发器已生成 prompt，正在调用 RBQ 生图...');
            const image = await RBQ.api.generateImage(result.prompt, 'smart-draw-trigger', { messageId }, (progressText) => {
                const sub = wrapper.querySelector('.st-scene-trigger-nai-loader-sub');
                if (sub instanceof HTMLElement) sub.textContent = progressText;
            });
            RBQ.api.renderInlineGeneratedImage(wrapper, image);
            if (store.cache[key]) store.cache[key].autoGenerated = true;
            save();
        } catch (error) {
            toastr.error(error.message || String(error), PLUGIN_NAME);
        } finally {
            clearWrapperLoading(wrapper);
        }
    }

    async function processMessage(messageId) {
        const store = getStore();
        const message = getMessageSnapshot(messageId);
        if (!shouldHandleMessage(message)) return;
        const trigger = getTrigger(message);
        if (!trigger) return;
        const key = makeKey(messageId, message, trigger.type, trigger.marker || 'auto');
        if (inFlight.has(key)) return;
        const cached = store.cache[key];
        if (cached?.checked && !cached.shouldDraw) return;
        if (cached?.shouldDraw && cached.prompt) {
            const wrapper = insertCard(messageId, trigger, cached, key);
            if (wrapper) await maybeAutoGenerate(wrapper, cached, messageId, key);
            return;
        }

        inFlight.add(key);
        try {
            const result = await callTagger(messageId, trigger);
            store.cache[key] = {
                ...result,
                checked: true,
                createdAt: Date.now(),
                triggerType: trigger.type,
                marker: trigger.marker || '',
            };
            pruneCache();
            save();
            if (!result.shouldDraw || !result.prompt) return;
            const wrapper = insertCard(messageId, trigger, result, key);
            if (wrapper) await maybeAutoGenerate(wrapper, result, messageId, key);
        } catch (error) {
            console.error('[Smart Draw Trigger]', error);
            toastr.error(error.message || String(error), PLUGIN_NAME);
        } finally {
            inFlight.delete(key);
        }
    }

    function scheduleProcess(messageId) {
        const id = Number(messageId);
        if (!Number.isFinite(id)) return;
        clearTimeout(pendingTimers.get(id));
        pendingTimers.set(id, setTimeout(() => {
            pendingTimers.delete(id);
            processMessage(id);
        }, 900));
    }

    function scanAllVisible() {
        document.querySelectorAll('.mes[mesid]').forEach(element => {
            scheduleProcess(Number(element.getAttribute('mesid')));
        });
    }

    function injectStyles() {
        if (document.getElementById('rbq-sdt-style')) return;
        const style = document.createElement('style');
        style.id = 'rbq-sdt-style';
        style.textContent = `
            #rbq-smart-draw-panel .rbq-sdt-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
            #rbq-smart-draw-panel textarea { min-height: 70px; }
            #rbq-smart-draw-panel .rbq-sdt-note { font-size:12px; opacity:.72; line-height:1.45; }
            .rbq-sdt-card { display:block; margin: 10px 0; }
        `;
        document.head.append(style);
    }

    function switchRbqTab(tab) {
        document.querySelectorAll('[data-kite-tab]').forEach((element) => {
            if (element instanceof HTMLElement) element.classList.toggle('active', element.dataset.kiteTab === tab);
        });
        document.querySelectorAll('[data-kite-panel]').forEach((element) => {
            if (element instanceof HTMLElement) element.classList.toggle('active', element.dataset.kitePanel === tab);
        });
    }

    function ensureSettingsPanel() {
        const rail = document.querySelector('.st-scene-trigger-tab-rail');
        const content = document.querySelector('.st-scene-trigger-modal-content');
        if (!(rail instanceof HTMLElement) || !(content instanceof HTMLElement)) return null;

        let button = document.querySelector('[data-kite-tab="smart-draw"]');
        if (!(button instanceof HTMLButtonElement)) {
            button = document.createElement('button');
            button.className = 'st-scene-trigger-tab-button';
            button.dataset.kiteTab = 'smart-draw';
            button.type = 'button';
            button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>智能触发</span>';
            button.addEventListener('click', () => switchRbqTab('smart-draw'));
            const promptButton = rail.querySelector('[data-kite-tab="prompt"]');
            if (promptButton?.nextSibling) {
                rail.insertBefore(button, promptButton.nextSibling);
            } else {
                rail.append(button);
            }
        }

        let panel = document.querySelector('[data-kite-panel="smart-draw"]');
        if (!(panel instanceof HTMLElement)) {
            panel = document.createElement('section');
            panel.className = 'st-scene-trigger-modal-panel';
            panel.dataset.kitePanel = 'smart-draw';
            content.append(panel);
        }
        return panel;
    }

    function val(id) { return document.getElementById(id)?.value || ''; }
    function checked(id) { return !!document.getElementById(id)?.checked; }

    function bindSwitch(fieldId, inputId) {
        const field = document.getElementById(fieldId);
        const input = document.getElementById(inputId);
        if (!(field instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
        const sync = () => field.setAttribute('aria-checked', input.checked ? 'true' : 'false');
        sync();
        field.setAttribute('role', 'switch');
        field.tabIndex = 0;
        field.addEventListener('click', (event) => {
            event.preventDefault();
            input.checked = !input.checked;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            sync();
        });
        field.addEventListener('keydown', (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            input.checked = !input.checked;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            sync();
        });
        input.addEventListener('change', sync);
    }

    function populateModelSelect(models, selected) {
        const select = document.getElementById('rbq-sdt-openai-model');
        if (!(select instanceof HTMLSelectElement)) return;
        const values = Array.isArray(models) ? [...new Set(models.map(String).filter(Boolean))] : [];
        if (selected && !values.includes(selected)) values.unshift(selected);
        select.innerHTML = '';
        if (!values.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '请先刷新模型列表';
            select.append(option);
            return;
        }
        values.forEach((model) => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            select.append(option);
        });
        select.value = selected && values.includes(selected) ? selected : values[0];
    }

    function updateProviderVisibility() {
        const provider = val('rbq-sdt-provider') || 'openai';
        document.querySelectorAll('[data-rbq-sdt-provider]').forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const group = element.dataset.rbqSdtProvider;
            element.style.display = group === provider ? '' : 'none';
        });
    }

    async function refreshOpenAiModels() {
        const button = document.getElementById('rbq-sdt-refresh-models');
        const store = getStore();
        const baseUrl = val('rbq-sdt-openai-base').trim() || store.openaiBaseUrl;
        const apiKey = val('rbq-sdt-openai-key').trim() || store.openaiApiKey;
        const url = normalizeModelsUrl(baseUrl);
        if (!url) return toastr.warning('请先填写 OpenAI Base URL', PLUGIN_NAME);
        try {
            if (button instanceof HTMLButtonElement) {
                button.disabled = true;
                button.textContent = '刷新中...';
            }
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
            const data = await response.json();
            const models = Array.isArray(data?.data)
                ? data.data.map(item => item?.id).filter(Boolean)
                : (Array.isArray(data?.models) ? data.models.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean) : []);
            if (!models.length) throw new Error('接口未返回可用模型列表');
            store.openaiModels = models;
            store.openaiBaseUrl = baseUrl;
            store.openaiApiKey = apiKey;
            if (!store.openaiModel || !models.includes(store.openaiModel)) store.openaiModel = models[0];
            populateModelSelect(models, store.openaiModel);
            save();
            toastr.success(`已获取 ${models.length} 个模型`, PLUGIN_NAME);
        } catch (error) {
            toastr.error(`获取模型失败: ${error.message || String(error)}`, PLUGIN_NAME);
        } finally {
            if (button instanceof HTMLButtonElement) {
                button.disabled = false;
                button.textContent = '刷新模型';
            }
        }
    }

    function renderSettings(panel) {
        if (document.getElementById('rbq-smart-draw-panel')) return;
        injectStyles();
        const store = getStore();
        const container = document.createElement('div');
        container.className = 'st-scene-trigger-subpanel';
        container.id = 'rbq-smart-draw-panel';
        container.innerHTML = `
            <div class="st-scene-trigger-subpanel-title"><i class="fa-solid fa-wand-magic-sparkles"></i><span>智能生图触发器 (Smart Draw)</span></div>
            <div class="st-scene-trigger-subpanel-hint">无需让正文输出长 tag：插件调用 tagger API 生成 prompt，并在消息内插入 RBQ 生图卡片。</div>
            <div class="st-scene-trigger-modal-grid">
                <div id="rbq-sdt-enabled-field" class="st-scene-trigger-field switch"><span>启用插件</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-enabled" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <label class="st-scene-trigger-field"><span>触发模式</span><select id="rbq-sdt-mode"><option value="off">关闭</option><option value="marker">仅短标记</option><option value="auto">仅自动定位</option><option value="hybrid">自动定位 + 短标记兜底</option></select></label>
                <label class="st-scene-trigger-field"><span>监听消息</span><select id="rbq-sdt-target-role"><option value="assistant">仅角色消息</option><option value="user">仅用户消息</option><option value="all">全部消息</option></select></label>
                <label class="st-scene-trigger-field"><span>上下文条数</span><input id="rbq-sdt-context-count" type="number" min="1" max="50" step="1"></label>
                <label class="st-scene-trigger-field wide"><span>短标记（每行一个）</span><textarea id="rbq-sdt-markers"></textarea></label>
                <label class="st-scene-trigger-field"><span>API 类型</span><select id="rbq-sdt-provider"><option value="openai">OpenAI 兼容</option><option value="custom">自定义 HTTP</option></select></label>
                <label class="st-scene-trigger-field wide" data-rbq-sdt-provider="openai"><span>OpenAI Base URL</span><input id="rbq-sdt-openai-base" type="text" placeholder="https://api.openai.com/v1"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="openai"><span>OpenAI API Key</span><input id="rbq-sdt-openai-key" type="password"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="openai"><span>OpenAI Model</span><select id="rbq-sdt-openai-model"></select><button id="rbq-sdt-refresh-models" class="menu_button" type="button" style="margin-top:8px;width:100%;">刷新模型</button></label>
                <label class="st-scene-trigger-field wide" data-rbq-sdt-provider="custom"><span>自定义 HTTP URL</span><input id="rbq-sdt-custom-url" type="text" placeholder="https://your-server/tagger"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="custom"><span>自定义密钥 Header</span><input id="rbq-sdt-custom-key-header" type="text" placeholder="Authorization"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="custom"><span>自定义密钥</span><input id="rbq-sdt-custom-key" type="password"></label>
                <label class="st-scene-trigger-field wide"><span>System Prompt</span><textarea id="rbq-sdt-system-prompt"></textarea></label>
            </div>
            <div class="st-scene-trigger-buttons">
                <button id="rbq-sdt-save" class="menu_button" type="button">保存智能触发器设置</button>
                <button id="rbq-sdt-clear-cache" class="menu_button" type="button">清空触发缓存</button>
                <button id="rbq-sdt-scan" class="menu_button" type="button">重新扫描当前聊天</button>
            </div>
            <div class="rbq-sdt-note">自动生成策略跟随 RBQ 主设置：RBQ 自动生成开启时会自动出图；关闭时只显示“生成图片”按钮。</div>
        `;
        panel.append(container);

        document.getElementById('rbq-sdt-enabled').checked = !!store.enabled;
        document.getElementById('rbq-sdt-mode').value = store.mode;
        document.getElementById('rbq-sdt-target-role').value = store.targetRole;
        document.getElementById('rbq-sdt-context-count').value = store.contextCount;
        document.getElementById('rbq-sdt-markers').value = store.markers;
        document.getElementById('rbq-sdt-provider').value = store.provider;
        document.getElementById('rbq-sdt-openai-base').value = store.openaiBaseUrl;
        document.getElementById('rbq-sdt-openai-key').value = store.openaiApiKey;
        populateModelSelect(store.openaiModels || [], store.openaiModel);
        document.getElementById('rbq-sdt-custom-url').value = store.customUrl;
        document.getElementById('rbq-sdt-custom-key-header').value = store.customApiKeyHeader;
        document.getElementById('rbq-sdt-custom-key').value = store.customApiKey;
        document.getElementById('rbq-sdt-system-prompt').value = store.systemPrompt || DEFAULT_SYSTEM_PROMPT;
        updateProviderVisibility();
        bindSwitch('rbq-sdt-enabled-field', 'rbq-sdt-enabled');

        document.getElementById('rbq-sdt-provider').addEventListener('change', updateProviderVisibility);
        document.getElementById('rbq-sdt-refresh-models').onclick = refreshOpenAiModels;

        document.getElementById('rbq-sdt-save').onclick = () => {
            const s = getStore();
            s.enabled = checked('rbq-sdt-enabled');
            s.mode = val('rbq-sdt-mode');
            s.targetRole = val('rbq-sdt-target-role');
            s.contextCount = Math.max(1, Math.min(50, Number(val('rbq-sdt-context-count')) || 5));
            s.markers = val('rbq-sdt-markers');
            s.provider = val('rbq-sdt-provider');
            s.openaiBaseUrl = val('rbq-sdt-openai-base').trim();
            s.openaiApiKey = val('rbq-sdt-openai-key').trim();
            s.openaiModel = val('rbq-sdt-openai-model').trim();
            s.customUrl = val('rbq-sdt-custom-url').trim();
            s.customApiKeyHeader = val('rbq-sdt-custom-key-header').trim() || 'Authorization';
            s.customApiKey = val('rbq-sdt-custom-key').trim();
            s.systemPrompt = val('rbq-sdt-system-prompt').trim() || DEFAULT_SYSTEM_PROMPT;
            save();
            toastr.success('智能生图触发器设置已保存', PLUGIN_NAME);
            scanAllVisible();
        };
        document.getElementById('rbq-sdt-clear-cache').onclick = () => {
            getStore().cache = {};
            save();
            toastr.success('智能触发缓存已清空', PLUGIN_NAME);
        };
        document.getElementById('rbq-sdt-scan').onclick = scanAllVisible;
    }

    function waitForPanel() {
        const panel = ensureSettingsPanel();
        if (panel) return renderSettings(panel);
        setTimeout(waitForPanel, 400);
    }

    function observeMessages() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'characterData') {
                    const parent = mutation.target?.parentElement;
                    const message = parent?.closest?.('.mes[mesid]');
                    if (message) scheduleProcess(Number(message.getAttribute('mesid')));
                    continue;
                }
                if (mutation.type === 'childList') {
                    const targetMessage = mutation.target instanceof Element ? mutation.target.closest?.('.mes[mesid]') : null;
                    if (targetMessage) scheduleProcess(Number(targetMessage.getAttribute('mesid')));
                }
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    const message = node.matches?.('.mes[mesid]') ? node : node.querySelector?.('.mes[mesid]');
                    if (message) scheduleProcess(Number(message.getAttribute('mesid')));
                }
            }
        });
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
        setInterval(scanAllVisible, 2000);
        setTimeout(scanAllVisible, 250);
        setTimeout(scanAllVisible, 1200);
    }

    waitForPanel();
    observeMessages();
    console.info(`🪄 ${PLUGIN_NAME} loaded.`);

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
