(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Smart Draw Trigger] RBQ Core API missing');

    const PLUGIN_NAME = '智能生图触发器';
    const STORAGE_KEY = '_smartDrawTrigger';
    const CARD_CLASS = 'rbq-sdt-card';
    const DEFAULT_SYSTEM_PROMPT_VERSION = 7;
    const STORYBOARDER_SYSTEM_PROMPT = `你是 RBQ Smart Draw Trigger 的“小说分镜师”。
你的任务是阅读当前的小说/剧情片段，将其拆解为 1~3 个关键视觉分镜，并为每个分镜生成画面描述，最后返回严格的 JSON。

【核心工作原则】
1. 只输出 JSON，禁止 markdown，禁止解释。
2. 你的重点是找准“该在哪个动作瞬间插图”，而不是默写人物长相。人物的外貌 Tag 将由后续系统自动补充。
3. 如果当前内容是纯对话、纯心理活动、规则说明，或没有明显新画面，不需要出图 (shouldDraw: false)。

【插图定位 (Anchor)】 - 绝对不可出错！
- anchor.text 必须是能代表该分镜瞬间的**原文一字不差的摘抄**。
- 请从 currentMessage.content 中直接复制那句话。绝对不能翻译，不能缩写，不能修改哪怕一个标点。
- 只有找到准确的原文原句，前端才能在对应的位置精确插入图片。

【分镜拆解 (Segments)】
- 若段落中有空间转换（如从门外到屋内），或强烈的动作演进（如先坐着，后来抱在一起），请输出多个 segment。
- 不要为每一句话配图。通常 1 个 segment 即可，长段落最多 2-3 个。
- 每一个 segment 都必须有自己的 anchor.text 和 scene。

【画面描述 (characters & scene)】
- 只需要提炼：角色名称（name，如果世界书中有匹配最好）、动作/姿态/衣服/表情（action），以及环境（scene）。
- 请使用简单的英文词组 (tags)。例如 action: "sitting, looking away, angry, wearing a shirt"。
- 不要把整句剧情翻译进 action。

【输出格式示例】
{
  "shouldDraw": true,
  "reason": "当前发生了明显的动作转换和镜头切换",
  "segments": [
    {
      "anchor": {
        "text": "必须完全摘抄原文片段以定位插入点"
      },
      "scene": "night, bedroom, dark atmosphere",
      "characters": [
        {
          "name": "张三",
          "action": "sitting on the bed, holding a phone, angry expression"
        }
      ],
      "standalone_prompt": "如果不涉及具体角色，而是一些单独的画面描述，可放这里"
    }
  ]
}`;

    const SYSTEM_PROMPT_PRESETS = {
        storyboarder: { label: '分层架构-分镜版', prompt: STORYBOARDER_SYSTEM_PROMPT },
    };

    const DEFAULT_SYSTEM_PROMPT_PRESET = 'storyboarder';
    const DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT_PRESETS[DEFAULT_SYSTEM_PROMPT_PRESET].prompt;

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
        debugToast: false,
        multiCharOutput: false,
        autoRunTagger: false,
        systemPromptPreset: DEFAULT_SYSTEM_PROMPT_PRESET,
        lorebookEnabled: false,
        lorebookContextDepth: 5,
        lorebookSources: [],
        ruleBookEnabled: false,
        ruleBookScanDepth: 5,
        ruleBookBudget: 1800,
        ruleBookEntries: '[\n  {\n    "name": "画风总规则",\n    "enabled": true,\n    "constant": true,\n    "keys": [],\n    "priority": 100,\n    "content": "输出英文逗号分隔 prompt，优先提炼当前画面主体、服装、表情、动作、场景、光照。"\n  },\n  {\n    "name": "雨夜场景",\n    "enabled": true,\n    "constant": false,\n    "keys": ["雨", "夜", "雨声"],\n    "priority": 80,\n    "content": "如果当前场景包含雨夜，加入 rain, wet skin/clothes, cinematic lighting, dark atmosphere 等视觉元素。"\n  }\n]',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        systemPromptVersion: DEFAULT_SYSTEM_PROMPT_VERSION,
        cache: {},
    };

    const pendingTimers = new Map();
    const inFlight = new Set();
    const processedKeys = new Set();
    const lorebookRuntimeState = {
        stickyState: new Map(),
        cooldownState: new Map(),
    };

    function getStore() {
        const settings = RBQ.api.getSettings();
        if (!settings[STORAGE_KEY]) settings[STORAGE_KEY] = {};
        const store = settings[STORAGE_KEY];
        for (const [key, value] of Object.entries(DEFAULTS)) {
            if (store[key] === undefined) store[key] = value;
        }
        if (!store.cache || typeof store.cache !== 'object') store.cache = {};
        if (!store.systemPromptVersion) store.systemPromptVersion = DEFAULT_SYSTEM_PROMPT_VERSION;
        return store;
    }

    function save() {
        RBQ.api.saveSettings();
    }

    function ensureLorebookStore() {
        const store = getStore();
        if (!Array.isArray(store.lorebookSources)) store.lorebookSources = [];
        return store.lorebookSources;
    }

    function inferLorebookType(name) {
        const text = String(name || '').toLowerCase();
        if (text.includes('主体') || text.includes('文生图')) return 'main';
        if (text.includes('标签库')) return 'taglib';
        if (text.includes('sex')) return 'sex';
        if (text.includes('模板')) return 'template';
        return 'custom';
    }

    function normalizeLorebookSource(raw, fallbackName = '未命名世界书') {
        const entries = raw?.entries && typeof raw.entries === 'object' ? raw.entries : {};
        const jsonText = JSON.stringify(raw || {});
        return {
            id: String(raw?.id || `sdt-lb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
            name: String(raw?.name || fallbackName),
            enabled: raw?.enabled !== false,
            type: String(raw?.type || inferLorebookType(raw?.name || fallbackName)),
            sourcePath: String(raw?.sourcePath || ''),
            importedAt: Number(raw?.importedAt || Date.now()),
            versionHash: hashText(jsonText),
            rawJson: jsonText,
            entryCount: Object.keys(entries).length,
        };
    }

    function normalizeLorebookEntry(source, entryKey, entry) {
        const characterFilter = entry?.characterFilter && typeof entry.characterFilter === 'object'
            ? entry.characterFilter
            : {};
        return {
            sourceId: source.id,
            sourceName: source.name,
            sourceType: source.type,
            uid: entry?.uid ?? entryKey,
            comment: String(entry?.comment || ''),
            content: String(entry?.content || '').trim(),
            constant: !!entry?.constant,
            disabled: !!entry?.disable,
            key: Array.isArray(entry?.key) ? entry.key.map(String).filter(Boolean) : [],
            keysecondary: Array.isArray(entry?.keysecondary) ? entry.keysecondary.map(String).filter(Boolean) : [],
            order: Number(entry?.order || 0),
            selective: entry?.selective !== false,
            selectiveLogic: Number(entry?.selectiveLogic || 0),
            sticky: Math.max(0, Number(entry?.sticky || 0)),
            cooldown: Math.max(0, Number(entry?.cooldown || 0)),
            depth: entry?.depth == null ? null : Math.max(0, Number(entry.depth) || 0),
            preventRecursion: !!entry?.preventRecursion,
            excludeRecursion: !!entry?.excludeRecursion,
            probability: Math.max(0, Math.min(100, Number(entry?.probability || 100))),
            useProbability: !!entry?.useProbability,
            role: entry?.role ?? null,
            characterFilter: {
                isExclude: !!characterFilter.isExclude,
                names: Array.isArray(characterFilter.names) ? characterFilter.names.map(String).filter(Boolean) : [],
                tags: Array.isArray(characterFilter.tags) ? characterFilter.tags.map(String).filter(Boolean) : [],
            },
        };
    }

    function getLorebookEntryRuntimeKey(entry) {
        return `${entry.sourceId}:${entry.uid}`;
    }

    function parseLorebookRawJson(rawJson, fallbackName = '未命名世界书') {
        const parsed = JSON.parse(String(rawJson || '{}'));
        const source = normalizeLorebookSource(parsed, fallbackName);
        const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
        return {
            source,
            entries: Object.entries(entries)
                .map(([entryKey, entry]) => normalizeLorebookEntry(source, entryKey, entry))
                .filter((entry) => !entry.disabled && entry.content),
        };
    }

    function getNormalizedLorebooks() {
        const store = getStore();
        if (!store.lorebookEnabled) return [];
        return ensureLorebookStore()
            .filter((source) => source && source.enabled !== false && source.rawJson)
            .flatMap((source) => {
                try {
                    const parsed = parseLorebookRawJson(source.rawJson, source.name);
                    return parsed.entries;
                } catch (error) {
                    console.warn(`[${PLUGIN_NAME}] 世界书解析失败: ${source?.name || 'unknown'}`, error);
                    return [];
                }
            });
    }

    function renderLorebookSourceList() {
        const sources = ensureLorebookStore();
        if (!sources.length) return '暂无已导入世界书';
        return sources.map((source) => {
            const state = source.enabled !== false ? '●' : '○';
            const actionText = source.enabled !== false ? '禁用' : '启用';
            return `
                <div class="rbq-sdt-lorebook-item" data-id="${source.id}">
                    <div class="rbq-sdt-lorebook-meta">
                        <strong>${state} ${source.name}</strong>
                        <small>${source.type} · ${source.entryCount || 0} entries</small>
                    </div>
                    <div class="rbq-sdt-lorebook-actions">
                        <button class="menu_button" type="button" data-action="toggle-lorebook" data-id="${source.id}">${actionText}</button>
                        <button class="menu_button" type="button" data-action="remove-lorebook" data-id="${source.id}">移除</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function refreshLorebookListUi() {
        const list = document.getElementById('rbq-sdt-lorebook-list');
        if (list instanceof HTMLElement) list.innerHTML = renderLorebookSourceList();
    }

    function debugInfo(message) {
        if (!getStore().debugToast) return;
        console.info(`[${PLUGIN_NAME}] ${message}`);
    }

    function debugWarning(message) {
        if (!getStore().debugToast) return;
        console.warn(`[${PLUGIN_NAME}] ${message}`);
    }

    function getLatestMessageId() {
        const ids = [...document.querySelectorAll('.mes[mesid]')]
            .map(element => Number(element.getAttribute('mesid')))
            .filter(Number.isFinite);
        return ids.length ? Math.max(...ids) : null;
    }

    function isLatestMessage(messageId) {
        const latest = getLatestMessageId();
        return latest != null && Number(messageId) === latest;
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

    function logTaggerPayload(label, data) {
        if (!getStore().debugToast) return;
        console.info(`[${PLUGIN_NAME}] ${label}:`, typeof data === 'string' ? data : JSON.parse(JSON.stringify(data)));
    }

    function collectActiveRules(currentMes, recentMessages) {
        const store = getStore();
        if (!store.ruleBookEnabled) return [];
        let entries = [];
        try {
            entries = JSON.parse(store.ruleBookEntries || '[]');
        } catch {
            return [];
        }
        const contextText = [
            ...recentMessages.slice(-store.ruleBookScanDepth).map(m => m.content),
            currentMes
        ].join('\n').toLowerCase();

        return entries
            .filter(entry => entry && entry.enabled)
            .filter(entry => {
                if (entry.constant) return true;
                if (!Array.isArray(entry.keys) || !entry.keys.length) return false;
                return entry.keys.some(k => contextText.includes(String(k).toLowerCase()));
            })
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))
            .reduce((acc, curr) => {
                if (acc.totalLength + curr.content.length <= store.ruleBookBudget) {
                    acc.list.push(curr);
                    acc.totalLength += curr.content.length;
                }
                return acc;
            }, { list: [], totalLength: 0 }).list;
    }

    function collectMatchedLorebookEntries(currentMes, recentMessages, messageId) {
        const store = getStore();
        if (!store.lorebookEnabled) return [];
        const entries = getNormalizedLorebooks();
        const depth = Math.max(1, Number(store.lorebookContextDepth) || 5);
        const contextText = [
            ...recentMessages.slice(-depth).map(m => m.content),
            currentMes
        ].join('\n').toLowerCase();

        const matched = entries.filter(entry => {
            if (entry.constant) return true;
            const keys = entry.key.map(k => String(k).toLowerCase());
            return keys.some(k => contextText.includes(k));
        });

        return matched.map(entry => ({
            ...entry,
            matchedKeys: entry.key
        }));
    }

    function validateStructuredResult(normalized) {
        return normalized;
    }

    function normalizeAnchor(anchor, defaultIndex) {
        if (!anchor || typeof anchor !== 'object') return { type: 'sentence', index: defaultIndex };
        return {
            type: 'sentence',
            index: Number.isFinite(Number(anchor.index)) ? Number(anchor.index) : defaultIndex,
            text: String(anchor.text || '').trim()
        };
    }

    function extractJson(text) {
        try {
            const str = String(text || '').trim();
            const start = str.indexOf('{');
            const end = str.lastIndexOf('}');
            if (start >= 0 && end >= start) {
                return JSON.parse(str.slice(start, end + 1));
            }
            return JSON.parse(str);
        } catch {
            return {};
        }
    }

    function normalizeTaggerResult(data, matchedLorebooks = []) {
        const source = data?.choices?.[0]?.message?.content ? extractJson(data.choices[0].message.content) : data;
        let segments = Array.isArray(source?.segments)
            ? source.segments.map((item, index) => {
                const anchor = normalizeAnchor(item?.anchor, index + 1);
                const scene = String(item?.scene || '').trim();
                const standalone = String(item?.standalone_prompt || '').trim();

                const characters = Array.isArray(item?.characters) ? item.characters.map((char, charIndex) => {
                    const name = String(char?.name || '').trim();
                    const action = String(char?.action || '').trim();
                    let appearanceTags = '';

                    if (name) {
                        const matched = matchedLorebooks.find(l => {
                            const lName = String(l.comment || l.sourceName || '').toLowerCase();
                            const keys = Array.isArray(l.matchedKeys) ? l.matchedKeys.map(k => String(k).toLowerCase()) : [];
                            const lowerName = name.toLowerCase();
                            return lName === lowerName || lName.includes(lowerName) || keys.some(k => k === lowerName || k.includes(lowerName) || lowerName.includes(k));
                        });
                        if (matched) {
                            appearanceTags = String(matched.content || '').trim();
                        }
                    }

                    return {
                        index: charIndex + 1,
                        caption: [appearanceTags, action].filter(Boolean).join(', '),
                        center: 'C3',
                        uc: '',
                        _rawName: name,
                        _rawAction: action
                    };
                }).filter((char) => char.caption || char._rawName) : [];

                const charPrompts = characters.map(c => c.caption).filter(Boolean).join(' AND ');
                const finalPromptFallback = [scene, standalone, charPrompts].filter(Boolean).join(', ');

                return {
                    anchor,
                    scene,
                    prompt: finalPromptFallback,
                    negative: String(item?.negative || '').trim(),
                    multiChar: characters.length > 1,
                    characters,
                };
            }).filter((item) => item.prompt || item.characters.length)
            : [];

        const normalized = {
            shouldDraw: !!source?.shouldDraw,
            prompt: segments.length ? segments[0].prompt : '',
            negative: '',
            multiChar: segments.length ? segments[0].multiChar : false,
            scene: segments.length ? segments[0].scene : '',
            characters: segments.length ? segments[0].characters : [],
            anchor: normalizeAnchor(source?.anchor, 1),
            reason: String(source?.reason || '').trim(),
            segments,
        };

        if (!segments.length && normalized.shouldDraw && (normalized.prompt || normalized.characters.length)) {
            normalized.segments = [{
                anchor: normalized.anchor,
                prompt: normalized.prompt,
                negative: normalized.negative,
                multiChar: normalized.multiChar,
                scene: normalized.scene,
                characters: normalized.characters,
            }];
        }

        return normalized;
    }

    function getFinalPrompt(obj) {
        if (!obj) return '';
        if (getStore().multiCharOutput && Array.isArray(obj.characters) && obj.characters.length > 0) {
            let lines = [];
            if (obj.scene) lines.push(`Scene: ${obj.scene}`);
            obj.characters.forEach((char, idx) => {
                lines.push(`Char${idx + 1}: ${char.caption || [char._rawName, char._rawAction].filter(Boolean).join(', ')}`);
                if (char.uc) lines.push(`Char${idx + 1} UC: ${char.uc}`);
            });
            const centers = obj.characters.map(c => c.center || 'C3').join(',');
            lines.push(`|centers:${centers}`);
            return lines.join('\n');
        }

        if (obj.prompt) return obj.prompt;

        const chars = Array.isArray(obj.characters) ? obj.characters.map(c => c.caption || [c._rawName, c._rawAction].filter(Boolean).join(', ')).join(' AND ') : '';
        const scene = obj.scene || '';
        const standalone = obj.standalone_prompt || '';

        return [scene, standalone, chars].filter(Boolean).join(', ');
    }

    function materializeResultCards(messageId, trigger, result, key) {
        const rendered = [];
        const segments = Array.isArray(result?.segments) ? result.segments : [];

        if (segments.length > 0) {
            segments.forEach((seg, index) => {
                const segmentKey = `${key}-seg-${index}`;
                const wrapper = insertCard(messageId, trigger, { ...result, anchor: seg.anchor }, segmentKey);
                if (wrapper) {
                    wrapper.dataset.prompt = getFinalPrompt(seg);
                    wrapper.dataset.rbqSdtBaseKey = key;
                    wrapper.dataset.rbqSdtSegmentKey = segmentKey;
                    wrapper.dataset.rbqSdtSegmentIndex = String(index + 1);
                    rendered.push({ wrapper, key: segmentKey, segment: seg });
                }
            });
        } else {
            const wrapper = insertCard(messageId, trigger, result, key);
            if (wrapper) {
                wrapper.dataset.prompt = getFinalPrompt(result);
                wrapper.dataset.rbqSdtBaseKey = key;
                wrapper.dataset.rbqSdtSegmentKey = key;
                rendered.push({ wrapper, key, segment: result });
            }
        }
        return rendered;
    }

    function markSegmentAutoGenerated(baseKey, segmentKey) {
        const store = getStore();
        const cache = store.cache[baseKey];
        if (!cache) return;
        if (!cache.segmentStates) cache.segmentStates = {};
        if (!cache.segmentStates[segmentKey]) cache.segmentStates[segmentKey] = {};
        cache.segmentStates[segmentKey].autoGenerated = true;
        save();
    }

    function getSegmentState(store, baseKey, segmentKey) {
        const cache = store.cache[baseKey];
        return cache?.segmentStates?.[segmentKey] || {};
    }

    function anchorsMatchSentence(anchorText, nodeText) {
        const a = String(anchorText || '').trim().toLowerCase().replace(/\s+/g, '');
        const b = String(nodeText || '').trim().toLowerCase().replace(/\s+/g, '');
        if (!a || !b) return false;
        return b.includes(a) || a.includes(b);
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
        const ruleBook = collectActiveRules(current.mes, recentMessages);
        const lorebook = collectMatchedLorebookEntries(current.mes, recentMessages, messageId);

        const payload = {
            mode: trigger.type,
            marker: trigger.marker || '',
            messageId,
            currentMessage: {
                role: current?.is_user ? 'user' : 'assistant',
                name: current?.name || '',
                content: String(current?.mes || ''),
            },
            recentMessages,
            ruleBook: ruleBook.map(r => ({ name: r.name, content: r.content })),
            lorebook: lorebook.map(l => ({ name: l.comment || l.sourceName || '角色/设定', keys: l.matchedKeys })),
            contextCount: Number(store.contextCount) || 5,
            outputSchema: {
                shouldDraw: 'boolean',
                reason: 'string optional',
                segments: [
                    {
                        anchor: { text: 'string exact sentence' },
                        scene: 'string optional',
                        standalone_prompt: 'string optional',
                        characters: [
                            { name: 'string', action: 'string' }
                        ]
                    }
                ]
            },
        };

        return { payload, rawLorebooks: lorebook };
    }

    async function callOpenAiCompatible(messageId, trigger) {
        const store = getStore();
        const url = normalizeBaseUrl(store.openaiBaseUrl);
        if (!url) throw new Error('请先填写 OpenAI 兼容接口 Base URL');
        if (!store.openaiModel) throw new Error('请先填写模型名称');
        const { payload, rawLorebooks } = buildRequestPayload(messageId, trigger);
        logTaggerPayload('tagger request body', payload);
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
                    { role: 'user', content: JSON.stringify(payload, null, 2) },
                ],
            }),
        });
        if (!response.ok) throw new Error(`tagger API 请求失败: HTTP ${response.status} ${await response.text()}`);
        const json = await response.json();
        logTaggerPayload('tagger raw response', json);
        const normalized = validateStructuredResult(normalizeTaggerResult(json, rawLorebooks));
        logTaggerPayload('tagger normalized result', normalized);
        return normalized;
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
        const { payload, rawLorebooks } = buildRequestPayload(messageId, trigger);
        logTaggerPayload('tagger request body', payload);
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`自定义 tagger 请求失败: HTTP ${response.status} ${await response.text()}`);
        const json = await response.json();
        logTaggerPayload('tagger raw response', json);
        const normalized = validateStructuredResult(normalizeTaggerResult(json, rawLorebooks));
        logTaggerPayload('tagger normalized result', normalized);
        return normalized;
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

    function getPureMessageRoot(messageId) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return null;
        const clone = container.cloneNode(true);
        if (!(clone instanceof HTMLElement)) return null;

        clone.querySelectorAll([
            '.mes_timer',
            '.mes_reasoning',
            '.mes_reasoning_header',
            '.mes_reasoning_details',
            '.mes_reasoning_summary',
            'summary',
            'details',
            '.st-scene-trigger-inline-wrap',
            `.${CARD_CLASS}`,
            '.mes_buttons',
            '.mes_edit_buttons',
            '.mes_img_controls',
            '[data-role="message-actions"]',
            '[data-role="message-metadata"]'
        ].join(',')).forEach(node => node.remove());

        return clone;
    }

    function buildSentenceMapFromRoot(root) {
        if (!(root instanceof HTMLElement)) return [];
        const sentenceRegex = /[^。！？.!?\n]+[。！？.!?]?/g;
        const map = [];
        let sentenceIndex = 0;
        for (const node of visibleTextNodes(root)) {
            const text = node.nodeValue || '';
            let match;
            while ((match = sentenceRegex.exec(text))) {
                const sentence = String(match[0] || '').trim();
                if (!sentence) continue;
                sentenceIndex += 1;
                map.push({
                    sentenceIndex,
                    text: sentence,
                    node,
                    startOffset: match.index,
                    endOffset: match.index + match[0].length,
                });
            }
        }
        return map;
    }

    function buildSentenceMap(messageId) {
        const root = getPureMessageRoot(messageId);
        return buildSentenceMapFromRoot(root);
    }

    function getLivePureMessageRoot(messageId) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return null;
        const clone = container.cloneNode(true);
        if (!(clone instanceof HTMLElement)) return null;

        clone.querySelectorAll([
            '.mes_timer',
            '.mes_reasoning',
            '.mes_reasoning_header',
            '.mes_reasoning_details',
            '.mes_reasoning_summary',
            'summary',
            'details',
            '.st-scene-trigger-inline-wrap',
            `.${CARD_CLASS}`,
            '.mes_buttons',
            '.mes_edit_buttons',
            '.mes_img_controls',
            '[data-role="message-actions"]',
            '[data-role="message-metadata"]'
        ].join(',')).forEach(node => node.remove());

        return clone;
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

    function insertBySentenceMap(messageId, anchor, wrapper) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return false;
        const map = buildSentenceMapFromRoot(container);
        if (!map.length) return false;

        let matched = null;
        if (anchor?.text) {
            matched = map.find((entry) => anchorsMatchSentence(anchor.text, entry.text)) || null;
        }
        if (!matched) {
            const targetIndex = Math.max(1, Number(anchor?.index) || 1);
            matched = map.find((entry) => entry.sentenceIndex === targetIndex) || null;
        }
        if (!matched) return false;
        insertWrapperAtTextNode(matched.node, matched.endOffset, matched.endOffset, wrapper);
        return true;
    }

    function insertCard(messageId, trigger, result, key) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return null;
        const existing = container.querySelector(`[data-rbq-sdt-key="${CSS.escape(key)}"]`);
        if (existing instanceof HTMLElement) return existing;

        const finalPrompt = getFinalPrompt(result);

        const wrapper = RBQ.api.createPromptCard({
            messageId,
            prompt: finalPrompt || trigger.marker || '[Smart Draw]',
            raw: trigger.marker || '[Smart Draw]',
            id: `smart-draw:${key}`,
            label: 'smart-draw',
        });
        if (!(wrapper instanceof HTMLElement)) return null;
        wrapper.classList.add(CARD_CLASS);
        wrapper.dataset.rbqSdtKey = key;
        wrapper.dataset.rbqSdtTriggerType = trigger.type;
        wrapper.dataset.rbqSdtReason = result.reason || '';
        wrapper.dataset.rbqSdtFinalPrompt = finalPrompt;

        // 短标记按标记位置替换；自动定位默认插入消息末尾，避免 anchor.index=1 时挤到正文最前面。
        let inserted = false;
        if (trigger.type === 'marker' && trigger.marker) {
            inserted = insertAtMarker(container, trigger.marker, wrapper);
        } else if (result?.anchor?.type === 'sentence') {
            inserted = insertBySentenceMap(messageId, result.anchor, wrapper);
            if (!inserted) {
                inserted = insertAfterSentence(container, result.anchor.index || 1, wrapper);
            }
        }
        if (!inserted) container.append(wrapper);

        console.info(`[${PLUGIN_NAME}] insertCard =>`, {
            messageId,
            key,
            triggerType: trigger.type,
            anchor: result?.anchor,
            insertedByAnchor: inserted,
            fallbackAppend: !inserted,
            wrapperConnected: wrapper.isConnected,
            containerTag: container.tagName,
            containerClass: container.className,
            cardCountAfterInsert: container.querySelectorAll(`.${CARD_CLASS}`).length,
        });
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

    function ensureTaggerButtonState(wrapper, text = '开始解析/生成 tag') {
        const button = wrapper?.querySelector?.('.st-scene-trigger-generate');
        if (!(button instanceof HTMLButtonElement)) return null;
        button.style.display = '';
        button.disabled = false;
        button.textContent = text;
        return button;
    }

    function ensureRenderGenerateButton(wrapper) {
        if (!(wrapper instanceof HTMLElement)) return null;
        let button = wrapper.querySelector('.rbq-sdt-run-image');
        if (button instanceof HTMLButtonElement) return button;
        const ui = wrapper.querySelector('.st-scene-trigger-inline-ui');
        if (!(ui instanceof HTMLElement)) return null;
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button st-scene-trigger-inline-button rbq-sdt-run-image';
        button.textContent = '生成图片';
        button.style.display = 'none';
        const loader = ui.querySelector('.st-scene-trigger-inline-loader');
        if (loader) ui.insertBefore(button, loader);
        else ui.append(button);
        return button;
    }

    function setGenerateButtonState(wrapper, visible, text = '生成图片', disabled = false) {
        const button = ensureRenderGenerateButton(wrapper);
        if (!(button instanceof HTMLButtonElement)) return null;
        button.style.display = visible ? '' : 'none';
        button.textContent = text;
        button.disabled = !!disabled;
        return button;
    }

    function setWrapperStage(wrapper, stage) {
        if (!(wrapper instanceof HTMLElement)) return;
        wrapper.dataset.rbqSdtStage = String(stage || 'idle');
        const label = {
            idle: '等待解析 tagger',
            parsing: '正在解析 tagger',
            'ready-generate': 'tagger 已返回，可生成图片',
            'generating-image': '正在生成图片',
            generated: '图片已生成',
            'done-no-draw': 'tagger 判断无需生图',
            error: '发生错误，可重试',
        }[String(stage || 'idle')] || String(stage || 'idle');
        wrapper.dataset.rbqSdtStageLabel = label;
        wrapper.title = label;
    }

    async function runImageGenerationForWrapper(wrapper, messageId, baseKey, segmentKey = '') {
        const finalPrompt = String(wrapper?.dataset?.prompt || '').trim();
        if (!finalPrompt) {
            toastr.warning('当前还没有可用 prompt，请先解析 tag', PLUGIN_NAME);
            return;
        }
        try {
            setWrapperStage(wrapper, 'generating-image');
            setWrapperLoading(wrapper, 'tagger 已完成，正在调用 RBQ 生图...');
            setGenerateButtonState(wrapper, true, '生成中...', true);
            const image = await RBQ.api.generateImage(finalPrompt, 'smart-draw-trigger', { messageId }, (progressText) => {
                const sub = wrapper.querySelector('.st-scene-trigger-nai-loader-sub');
                if (sub instanceof HTMLElement) sub.textContent = progressText;
            });
            RBQ.api.renderInlineGeneratedImage(wrapper, image);
            if (baseKey && segmentKey) markSegmentAutoGenerated(baseKey, segmentKey);
            ensureTaggerButtonState(wrapper, '重新解析/刷新 tag');
            setGenerateButtonState(wrapper, true, '重新生成图片', false);
            setWrapperStage(wrapper, 'generated');
        } catch (error) {
            toastr.error(error.message || String(error), PLUGIN_NAME);
            ensureTaggerButtonState(wrapper, '重新解析/刷新 tag');
            setGenerateButtonState(wrapper, true, '生成图片', false);
            setWrapperStage(wrapper, 'error');
        } finally {
            clearWrapperLoading(wrapper);
        }
    }

    function bindWrapperManualRun(wrapper, trigger, messageId, baseKey, segmentKey = '') {
        if (!(wrapper instanceof HTMLElement)) return;
        if (wrapper.dataset.rbqSdtBound === '1') return;
        wrapper.dataset.rbqSdtBound = '1';
        const button = wrapper.querySelector('.st-scene-trigger-generate');
        const generateButton = ensureRenderGenerateButton(wrapper);
        if (!(button instanceof HTMLButtonElement)) return;
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (inFlight.has(baseKey)) return;
            inFlight.add(baseKey);
            try {
                setWrapperStage(wrapper, 'parsing');
                await runTaggerForWrapper(wrapper, trigger, messageId, baseKey);
            } finally {
                inFlight.delete(baseKey);
            }
        });
        if (generateButton instanceof HTMLButtonElement) {
            generateButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await runImageGenerationForWrapper(wrapper, messageId, baseKey, segmentKey || wrapper.dataset.rbqSdtSegmentKey || '');
            });
        }
    }

    async function maybeAutoGenerate(wrapper, result, messageId, baseKey, segmentKey) {
        const store = getStore();
        const state = getSegmentState(store, baseKey, segmentKey);
        if (!store.autoRunTagger || !RBQ.api.shouldAutoGenerate() || state?.autoGenerated) return;
        try {
            setWrapperStage(wrapper, 'generating-image');
            setWrapperLoading(wrapper, 'tagger 已返回，正在调用 RBQ 生图...');
            setGenerateButtonState(wrapper, true, '自动生成中...', true);
            const finalPrompt = getFinalPrompt(result);
            const image = await RBQ.api.generateImage(finalPrompt, 'smart-draw-trigger', { messageId }, (progressText) => {
                const sub = wrapper.querySelector('.st-scene-trigger-nai-loader-sub');
                if (sub instanceof HTMLElement) sub.textContent = progressText;
            });
            RBQ.api.renderInlineGeneratedImage(wrapper, image);
            markSegmentAutoGenerated(baseKey, segmentKey);
            setGenerateButtonState(wrapper, true, '重新生成图片', false);
            setWrapperStage(wrapper, 'generated');
        } catch (error) {
            toastr.error(error.message || String(error), PLUGIN_NAME);
            setGenerateButtonState(wrapper, true, '生成图片', false);
            setWrapperStage(wrapper, 'error');
        } finally {
            clearWrapperLoading(wrapper);
        }
    }

    async function runTaggerForWrapper(wrapper, trigger, messageId, key) {
        const store = getStore();
        if (!(wrapper instanceof HTMLElement)) return;
        const button = ensureTaggerButtonState(wrapper, '解析中...');
        if (button) button.disabled = true;
        try {
            const sub = wrapper.querySelector('.st-scene-trigger-nai-loader-sub');
            const loader = wrapper.querySelector('.st-scene-trigger-inline-loader');
            if (loader instanceof HTMLElement) loader.style.display = 'flex';
            if (sub instanceof HTMLElement) sub.textContent = '正在调用 tagger API 解析世界书与提示词...';
            const result = await callTagger(messageId, trigger);
            const cacheKey = wrapper.dataset.rbqSdtBaseKey || key;
            store.cache[cacheKey] = {
                ...result,
                checked: true,
                createdAt: Date.now(),
                triggerType: trigger.type,
                marker: trigger.marker || '',
                segmentStates: store.cache[cacheKey]?.segmentStates || {},
            };
            pruneCache();
            save();
            const hasUsableSegments = Array.isArray(result?.segments) && result.segments.some((segment) => getFinalPrompt(segment));
            const hasTopLevelPrompt = !!getFinalPrompt(result);
            if (!result.shouldDraw || (!hasUsableSegments && !hasTopLevelPrompt)) {
                ensureTaggerButtonState(wrapper, 'tagger 判断无需生图');
                setGenerateButtonState(wrapper, false);
                setWrapperStage(wrapper, 'done-no-draw');
                processedKeys.add(cacheKey);
                return;
            }
            const rendered = materializeResultCards(messageId, trigger, result, cacheKey);
            for (const item of rendered) {
                const renderedWrapper = item.wrapper;
                ensureTaggerButtonState(renderedWrapper, '重新解析/刷新 tag');
                setGenerateButtonState(renderedWrapper, true, store.autoRunTagger && RBQ.api.shouldAutoGenerate() ? '等待自动生图...' : '生成图片', false);
                setWrapperStage(renderedWrapper, 'ready-generate');
                bindWrapperManualRun(renderedWrapper, trigger, messageId, cacheKey, item.key);
                if (store.autoRunTagger && RBQ.api.shouldAutoGenerate()) {
                    await maybeAutoGenerate(renderedWrapper, item.segment, messageId, cacheKey, item.key);
                }
            }
            processedKeys.add(cacheKey);
        } catch (error) {
            console.error('[Smart Draw Trigger]', error);
            toastr.error(error.message || String(error), PLUGIN_NAME);
            ensureTaggerButtonState(wrapper, '重新解析/生成 tag');
            setGenerateButtonState(wrapper, false);
            setWrapperStage(wrapper, 'idle');
        } finally {
            clearWrapperLoading(wrapper);
        }
    }

    async function processMessage(messageId, options = {}) {
        const { allowHistorical = false, force = false } = options;
        const store = getStore();
        if (!allowHistorical && !isLatestMessage(messageId)) return;
        const message = getMessageSnapshot(messageId);
        if (!shouldHandleMessage(message)) return;
        const trigger = getTrigger(message);
        if (!trigger) return;
        const key = makeKey(messageId, message, trigger.type, trigger.marker || 'auto');
        if (force) processedKeys.delete(key);
        if (processedKeys.has(key)) return;
        if (inFlight.has(key)) return;
        const cached = store.cache[key];
        if (cached?.checked && !cached.shouldDraw) {
            processedKeys.add(key);
            return;
        }
        if (cached?.shouldDraw && (cached.prompt || cached.segments?.length)) {
            const rendered = materializeResultCards(messageId, trigger, cached, key);
            for (const item of rendered) {
                const wrapper = item.wrapper;
                ensureTaggerButtonState(wrapper, '重新解析/刷新 tag');
                setGenerateButtonState(wrapper, true, store.autoRunTagger && RBQ.api.shouldAutoGenerate() ? '等待自动生图...' : '生成图片', false);
                setWrapperStage(wrapper, 'ready-generate');
                bindWrapperManualRun(wrapper, trigger, messageId, key, item.key);
                if (store.autoRunTagger && RBQ.api.shouldAutoGenerate()) {
                    await maybeAutoGenerate(wrapper, item.segment, messageId, key, item.key);
                }
            }
            processedKeys.add(key);
            return;
        }

        const placeholder = {
            shouldDraw: true,
            prompt: trigger.marker || '[Smart Draw]',
            negative: '',
            anchor: { type: 'sentence', index: 1 },
            reason: '等待手动触发 tagger',
            multiChar: false,
            scene: '',
            characters: [],
        };
        const wrapper = insertCard(messageId, trigger, placeholder, key);
        if (!(wrapper instanceof HTMLElement)) return;
        wrapper.dataset.messageId = String(messageId);
        wrapper.dataset.rbqSdtTrigger = JSON.stringify(trigger);
        wrapper.dataset.rbqSdtKey = key;
        wrapper.dataset.rbqSdtBaseKey = key;
        ensureTaggerButtonState(wrapper, store.autoRunTagger ? '解析中...' : '开始解析/生成 tag');
        setGenerateButtonState(wrapper, false);
        setWrapperStage(wrapper, 'idle');
        bindWrapperManualRun(wrapper, trigger, messageId, key);
        const loader = wrapper.querySelector('.st-scene-trigger-inline-loader');
        if (loader instanceof HTMLElement) loader.style.display = 'none';

        if (store.autoRunTagger) {
            inFlight.add(key);
            try {
                await runTaggerForWrapper(wrapper, trigger, messageId, key);
            } finally {
                inFlight.delete(key);
            }
        }
    }

    function scheduleProcess(messageId, options = {}) {
        const id = Number(messageId);
        if (!Number.isFinite(id)) return;
        clearTimeout(pendingTimers.get(id));
        pendingTimers.set(id, setTimeout(() => {
            pendingTimers.delete(id);
            processMessage(id, options);
        }, 900));
    }

    function scanAllVisible() {
        document.querySelectorAll('.mes[mesid]').forEach(element => {
            scheduleProcess(Number(element.getAttribute('mesid')), { allowHistorical: true, force: true });
        });
    }

    function scanLatestVisible() {
        const latest = getLatestMessageId();
        if (latest != null) scheduleProcess(latest);
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
            .rbq-sdt-card[data-rbq-sdt-stage="parsing"],
            .rbq-sdt-card[data-rbq-sdt-stage="generating-image"] { opacity:.92; }
            .rbq-sdt-card[data-rbq-sdt-stage="generated"] .st-scene-trigger-inline-button { filter: saturate(1.08); }
            .rbq-sdt-card[data-rbq-sdt-segment-index]::before {
                content: "Smart Draw #" attr(data-rbq-sdt-segment-index);
                display:inline-flex;
                margin:0 0 4px 2px;
                font-size:11px;
                opacity:.62;
                letter-spacing:.02em;
            }
            #rbq-sdt-lorebook-list { display:flex; flex-direction:column; gap:8px; }
            .rbq-sdt-lorebook-item { display:flex; justify-content:space-between; gap:10px; align-items:center; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.05); }
            .rbq-sdt-lorebook-meta { display:flex; flex-direction:column; gap:4px; min-width:0; }
            .rbq-sdt-lorebook-meta strong, .rbq-sdt-lorebook-meta small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .rbq-sdt-lorebook-actions { display:flex; gap:8px; flex-shrink:0; }
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
        const lorebookSources = ensureLorebookStore();
        const container = document.createElement('div');
        container.className = 'st-scene-trigger-subpanel';
        container.id = 'rbq-smart-draw-panel';
        container.innerHTML = `
            <div class="st-scene-trigger-subpanel-title"><i class="fa-solid fa-wand-magic-sparkles"></i><span>智能生图触发器 (Smart Draw)</span></div>
            <div class="st-scene-trigger-subpanel-hint">无需让正文输出长 tag：插件调用 tagger API 生成 prompt，并在消息内插入 RBQ 生图卡片。支持 segments[] 多段卡片、anchor.text 精准插入，以及按段落独立自动生图。</div>
            <div class="st-scene-trigger-modal-grid">
                <div id="rbq-sdt-enabled-field" class="st-scene-trigger-field switch"><span>启用插件</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-enabled" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <label class="st-scene-trigger-field"><span>触发模式</span><select id="rbq-sdt-mode"><option value="off">关闭</option><option value="marker">仅短标记</option><option value="auto">仅自动定位</option><option value="hybrid">自动定位 + 短标记兜底</option></select></label>
                <label class="st-scene-trigger-field"><span>监听消息</span><select id="rbq-sdt-target-role"><option value="assistant">仅角色消息</option><option value="user">仅用户消息</option><option value="all">全部消息</option></select></label>
                <label class="st-scene-trigger-field"><span>上下文条数</span><input id="rbq-sdt-context-count" type="number" min="1" max="50" step="1"></label>
                <div id="rbq-sdt-debug-field" class="st-scene-trigger-field switch"><span>触发调试提示</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-debug" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <div id="rbq-sdt-multichar-field" class="st-scene-trigger-field switch"><span>多角色输出模式</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-multichar" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <div id="rbq-sdt-autorun-field" class="st-scene-trigger-field switch"><span>自动调用 tagger API</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-autorun" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <label class="st-scene-trigger-field wide"><span>短标记（每行一个）</span><textarea id="rbq-sdt-markers"></textarea></label>
                <div id="rbq-sdt-rulebook-field" class="st-scene-trigger-field switch"><span>启用轻量规则书</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-rulebook-enabled" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <label class="st-scene-trigger-field"><span>规则扫描深度</span><input id="rbq-sdt-rulebook-depth" type="number" min="1" max="50" step="1"></label>
                <label class="st-scene-trigger-field"><span>规则注入预算（字符）</span><input id="rbq-sdt-rulebook-budget" type="number" min="200" max="12000" step="100"></label>
                <label class="st-scene-trigger-field wide"><span>轻量规则书 JSON</span><textarea id="rbq-sdt-rulebook-entries" style="min-height:180px;"></textarea></label>
                <div id="rbq-sdt-lorebook-field" class="st-scene-trigger-field switch"><span>启用世界书兼容层</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-lorebook-enabled" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <label class="st-scene-trigger-field"><span>世界书扫描深度</span><input id="rbq-sdt-lorebook-depth" type="number" min="1" max="50" step="1"></label>
                <label class="st-scene-trigger-field"><span>API 类型</span><select id="rbq-sdt-provider"><option value="openai">OpenAI 兼容</option><option value="custom">自定义 HTTP</option></select></label>
                <label class="st-scene-trigger-field wide" data-rbq-sdt-provider="openai"><span>OpenAI Base URL</span><input id="rbq-sdt-openai-base" type="text" placeholder="https://api.openai.com/v1"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="openai"><span>OpenAI API Key</span><input id="rbq-sdt-openai-key" type="password"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="openai"><span>OpenAI Model</span><select id="rbq-sdt-openai-model"></select><button id="rbq-sdt-refresh-models" class="menu_button" type="button" style="margin-top:8px;width:100%;">刷新模型</button></label>
                <label class="st-scene-trigger-field wide" data-rbq-sdt-provider="custom"><span>自定义 HTTP URL</span><input id="rbq-sdt-custom-url" type="text" placeholder="https://your-server/tagger"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="custom"><span>自定义密钥 Header</span><input id="rbq-sdt-custom-key-header" type="text" placeholder="Authorization"></label>
                <label class="st-scene-trigger-field" data-rbq-sdt-provider="custom"><span>自定义密钥</span><input id="rbq-sdt-custom-key" type="password"></label>
                <label class="st-scene-trigger-field"><span>内置 Prompt 档位</span><select id="rbq-sdt-system-preset"><option value="storyboarder">分层架构-分镜版</option></select></label>
                <label class="st-scene-trigger-field wide"><span>System Prompt <small id="rbq-sdt-system-prompt-version" style="opacity:.6;font-weight:normal;margin-left:6px;"></small></span><textarea id="rbq-sdt-system-prompt"></textarea></label>
            </div>
            <div class="st-scene-trigger-buttons">
                <button id="rbq-sdt-save" class="menu_button" type="button">保存智能触发器设置</button>
                <button id="rbq-sdt-reset-system-prompt" class="menu_button" type="button">重置为所选内置 Prompt</button>
                <button id="rbq-sdt-import-lorebook" class="menu_button" type="button">选择世界书文件</button>
                <button id="rbq-sdt-clear-cache" class="menu_button" type="button">清空触发缓存</button>
                <button id="rbq-sdt-scan" class="menu_button" type="button">重新扫描/恢复可见楼层</button>
            </div>
            <div class="st-scene-trigger-field wide">
                <span>已挂载世界书</span>
                <div id="rbq-sdt-lorebook-list" class="rbq-sdt-note">${renderLorebookSourceList()}</div>
            </div>
            <div class="rbq-sdt-note">自动生成策略跟随 RBQ 主设置：RBQ 自动生成开启时会按 segment 独立自动出图；关闭时只显示“生成图片”按钮。建议让 tagger 返回 anchor.text，以便卡片插入到目标原句后方。</div>
        `;
        panel.append(container);

        document.getElementById('rbq-sdt-enabled').checked = !!store.enabled;
        document.getElementById('rbq-sdt-mode').value = store.mode;
        document.getElementById('rbq-sdt-target-role').value = store.targetRole;
        document.getElementById('rbq-sdt-context-count').value = store.contextCount;
        document.getElementById('rbq-sdt-debug').checked = !!store.debugToast;
        document.getElementById('rbq-sdt-multichar').checked = !!store.multiCharOutput;
        document.getElementById('rbq-sdt-autorun').checked = !!store.autoRunTagger;
        document.getElementById('rbq-sdt-system-preset').value = store.systemPromptPreset || DEFAULT_SYSTEM_PROMPT_PRESET;
        document.getElementById('rbq-sdt-markers').value = store.markers;
        document.getElementById('rbq-sdt-rulebook-enabled').checked = !!store.ruleBookEnabled;
        document.getElementById('rbq-sdt-rulebook-depth').value = store.ruleBookScanDepth;
        document.getElementById('rbq-sdt-rulebook-budget').value = store.ruleBookBudget;
        document.getElementById('rbq-sdt-rulebook-entries').value = store.ruleBookEntries;
        document.getElementById('rbq-sdt-lorebook-enabled').checked = !!store.lorebookEnabled;
        document.getElementById('rbq-sdt-lorebook-depth').value = store.lorebookContextDepth;
        document.getElementById('rbq-sdt-provider').value = store.provider;
        document.getElementById('rbq-sdt-openai-base').value = store.openaiBaseUrl;
        document.getElementById('rbq-sdt-openai-key').value = store.openaiApiKey;
        populateModelSelect(store.openaiModels || [], store.openaiModel);
        document.getElementById('rbq-sdt-custom-url').value = store.customUrl;
        document.getElementById('rbq-sdt-custom-key-header').value = store.customApiKeyHeader;
        document.getElementById('rbq-sdt-custom-key').value = store.customApiKey;
        document.getElementById('rbq-sdt-system-prompt').value = store.systemPrompt || DEFAULT_SYSTEM_PROMPT;
        const presetLabel = SYSTEM_PROMPT_PRESETS[store.systemPromptPreset || DEFAULT_SYSTEM_PROMPT_PRESET]?.label || '未知';
        const promptVersionText = store.systemPromptVersion === DEFAULT_SYSTEM_PROMPT_VERSION
            ? `${presetLabel} · v${store.systemPromptVersion}（最新）`
            : `${presetLabel} · 本地 v${store.systemPromptVersion} / 内置 v${DEFAULT_SYSTEM_PROMPT_VERSION}`;
        document.getElementById('rbq-sdt-system-prompt-version').textContent = promptVersionText;
        updateProviderVisibility();
        bindSwitch('rbq-sdt-enabled-field', 'rbq-sdt-enabled');
        bindSwitch('rbq-sdt-debug-field', 'rbq-sdt-debug');
        bindSwitch('rbq-sdt-multichar-field', 'rbq-sdt-multichar');
        bindSwitch('rbq-sdt-autorun-field', 'rbq-sdt-autorun');
        bindSwitch('rbq-sdt-rulebook-field', 'rbq-sdt-rulebook-enabled');
        bindSwitch('rbq-sdt-lorebook-field', 'rbq-sdt-lorebook-enabled');

        document.getElementById('rbq-sdt-provider').addEventListener('change', updateProviderVisibility);
        document.getElementById('rbq-sdt-refresh-models').onclick = refreshOpenAiModels;

        document.getElementById('rbq-sdt-save').onclick = () => {
            const s = getStore();
            s.enabled = checked('rbq-sdt-enabled');
            s.mode = val('rbq-sdt-mode');
            s.targetRole = val('rbq-sdt-target-role');
            s.contextCount = Math.max(1, Math.min(50, Number(val('rbq-sdt-context-count')) || 5));
            s.debugToast = checked('rbq-sdt-debug');
            s.multiCharOutput = checked('rbq-sdt-multichar');
            s.autoRunTagger = checked('rbq-sdt-autorun');
            s.systemPromptPreset = val('rbq-sdt-system-preset') || DEFAULT_SYSTEM_PROMPT_PRESET;
            s.markers = val('rbq-sdt-markers');
            s.ruleBookEnabled = checked('rbq-sdt-rulebook-enabled');
            s.ruleBookScanDepth = Math.max(1, Math.min(50, Number(val('rbq-sdt-rulebook-depth')) || 5));
            s.ruleBookBudget = Math.max(200, Math.min(12000, Number(val('rbq-sdt-rulebook-budget')) || 1800));
            s.ruleBookEntries = val('rbq-sdt-rulebook-entries');
            s.lorebookEnabled = checked('rbq-sdt-lorebook-enabled');
            s.lorebookContextDepth = Math.max(1, Math.min(50, Number(val('rbq-sdt-lorebook-depth')) || 5));
            s.provider = val('rbq-sdt-provider');
            s.openaiBaseUrl = val('rbq-sdt-openai-base').trim();
            s.openaiApiKey = val('rbq-sdt-openai-key').trim();
            s.openaiModel = val('rbq-sdt-openai-model').trim();
            s.customUrl = val('rbq-sdt-custom-url').trim();
            s.customApiKeyHeader = val('rbq-sdt-custom-key-header').trim() || 'Authorization';
            s.customApiKey = val('rbq-sdt-custom-key').trim();
            s.systemPrompt = val('rbq-sdt-system-prompt').trim() || DEFAULT_SYSTEM_PROMPT;
            s.systemPromptVersion = DEFAULT_SYSTEM_PROMPT_VERSION;
            save();
            toastr.success('智能生图触发器设置已保存', PLUGIN_NAME);
            scanLatestVisible();
        };
        document.getElementById('rbq-sdt-reset-system-prompt').onclick = () => {
            const s = getStore();
            const preset = val('rbq-sdt-system-preset') || DEFAULT_SYSTEM_PROMPT_PRESET;
            const nextPrompt = SYSTEM_PROMPT_PRESETS[preset]?.prompt || DEFAULT_SYSTEM_PROMPT;
            s.systemPromptPreset = preset;
            s.systemPrompt = nextPrompt;
            s.systemPromptVersion = DEFAULT_SYSTEM_PROMPT_VERSION;
            save();
            document.getElementById('rbq-sdt-system-prompt').value = nextPrompt;
            document.getElementById('rbq-sdt-system-prompt-version').textContent = `${SYSTEM_PROMPT_PRESETS[preset]?.label || '内置 Prompt'} · v${DEFAULT_SYSTEM_PROMPT_VERSION}（最新）`;
            toastr.success(`已重置为所选内置 Prompt：${SYSTEM_PROMPT_PRESETS[preset]?.label || preset}`, PLUGIN_NAME);
        };
        document.getElementById('rbq-sdt-import-lorebook').onclick = () => {
            let input = document.getElementById('rbq-sdt-lorebook-file-input');
            if (!(input instanceof HTMLInputElement)) {
                input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.id = 'rbq-sdt-lorebook-file-input';
                input.style.display = 'none';
                document.body.append(input);
                input.addEventListener('change', async () => {
                    const file = input.files?.[0];
                    input.value = '';
                    if (!file) return;
                    try {
                        const raw = await file.text();
                        const parsed = parseLorebookRawJson(raw, file.name.replace(/\.json$/i, '') || file.name);
                        const next = ensureLorebookStore();
                        next.push(parsed.source);
                        save();
                        toastr.success(`已导入世界书：${parsed.source.name}`, PLUGIN_NAME);
                        refreshLorebookListUi();
                    } catch (error) {
                        toastr.error(`世界书导入失败: ${error.message || String(error)}`, PLUGIN_NAME);
                    }
                });
            }
            input.click();
        };
        document.getElementById('rbq-sdt-lorebook-list')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action][data-id]');
            if (!(button instanceof HTMLButtonElement)) return;
            const action = button.dataset.action;
            const id = button.dataset.id;
            const sources = ensureLorebookStore();
            const index = sources.findIndex((source) => source.id === id);
            if (index < 0) return;
            if (action === 'toggle-lorebook') {
                sources[index].enabled = sources[index].enabled === false;
                save();
                refreshLorebookListUi();
            } else if (action === 'remove-lorebook') {
                sources.splice(index, 1);
                save();
                refreshLorebookListUi();
            }
        });
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
        setTimeout(scanLatestVisible, 250);
        setTimeout(scanLatestVisible, 1200);
    }

    waitForPanel();
    observeMessages();
    console.info(`🪄 ${PLUGIN_NAME} loaded.`);

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
