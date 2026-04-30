(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Smart Draw Trigger] RBQ Core API missing');

    const PLUGIN_NAME = '智能生图触发器';
    const STORAGE_KEY = '_smartDrawTrigger';
    const CARD_CLASS = 'rbq-sdt-card';
    const DEFAULT_SYSTEM_PROMPT_VERSION = 2;
    const DEFAULT_SYSTEM_PROMPT = `你是一个“世界书驱动的生图协议规划器”，不是普通的文生图提示词补全器。

你的任务：
1. 先阅读当前消息、最近上下文、lorebook、ruleBook。
2. 把 lorebook / ruleBook 视为高优先级强约束，而不是参考建议。
3. 判断这条消息里应该在正文哪些位置插入图片按钮。
4. 输出严格结构化 JSON，供前端生成多个生图按钮或多角色 prompt。

你必须只返回 JSON，不要返回 markdown，不要解释，不要额外文字。

【最重要的规则】
- 如果 shouldDraw=true，你应优先输出 segments[]。
- 单条消息里如果存在多个视觉焦点，就必须返回多个 segments，不能偷懒合并成一个 prompt。
- 如果只能确定一个插图点，也允许返回顶层 prompt/negative/anchor；前端会自动兼容为单段 segment。
- 如果是多角色画面，必须返回 multiChar=true，并提供 scene + characters[]，不要把所有角色硬塞进一个普通长 prompt。
- 如果无法给出结构化结果，就返回 shouldDraw=false。
- prompt 只写画面描述，不要包含 [scene]、[img] 等包裹标签。

【输出 JSON 总格式】
{
  "shouldDraw": true,
  "reason": "short chinese reason",
  "prompt": "optional single-segment prompt",
  "negative": "optional single-segment negative prompt",
  "anchor": { "type": "sentence", "index": 1 },
  "multiChar": false,
  "scene": "optional multi-char scene prompt",
  "characters": [
    {
      "index": 1,
      "caption": "character prompt",
      "center": "C3",
      "uc": "character negative prompt"
    }
  ],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 1 },
      "prompt": "english image prompt, comma separated tags",
      "negative": "optional negative prompt",
      "multiChar": false,
      "scene": "optional multi-char scene prompt",
      "characters": []
    }
  ]
}

【字段说明】
- shouldDraw=false 时，segments 为空数组，prompt 为空字符串。
- anchor.index 表示插在当前消息第几句之后，从 1 开始。
- lorebook 是本轮命中的世界书规则；如果其中包含主体模板、标签库、SEX 模板、常规模板，你应优先吸收这些规则，而不是自由发挥。
- ruleBook 是插件内补充规则，也应优先遵守。

【few-shot 示例 1：单图点】
输入语义：一条消息中只有一个明确画面，适合在第 2 句后插图。
输出：
{
  "shouldDraw": true,
  "reason": "当前镜头只有一个明确视觉焦点",
  "prompt": "1girl, indoor, warm lighting, close-up",
  "negative": "worst quality, low quality",
  "anchor": { "type": "sentence", "index": 2 },
  "multiChar": false,
  "scene": "",
  "characters": [],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 2 },
      "prompt": "1girl, indoor, warm lighting, close-up",
      "negative": "worst quality, low quality",
      "multiChar": false,
      "scene": "",
      "characters": []
    }
  ]
}

【few-shot 示例 2：多图点】
输入语义：一条消息先描写入口动作，再描写后半段高潮画面，适合两张图。
输出：
{
  "shouldDraw": true,
  "reason": "当前消息存在两个视觉高潮点",
  "prompt": "",
  "negative": "",
  "anchor": { "type": "sentence", "index": 1 },
  "multiChar": false,
  "scene": "",
  "characters": [],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 2 },
      "prompt": "1girl, entering room, side view, indoor",
      "negative": "worst quality, low quality",
      "multiChar": false,
      "scene": "",
      "characters": []
    },
    {
      "anchor": { "type": "sentence", "index": 5 },
      "prompt": "1girl, close-up, intense expression, sweat",
      "negative": "worst quality, low quality",
      "multiChar": false,
      "scene": "",
      "characters": []
    }
  ]
}

【few-shot 示例 3：多角色】
输入语义：双人后入场景，需兼容多角色插件。
输出：
{
  "shouldDraw": true,
  "reason": "当前画面是明确双人交互镜头",
  "prompt": "",
  "negative": "",
  "anchor": { "type": "sentence", "index": 3 },
  "multiChar": false,
  "scene": "",
  "characters": [],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 3 },
      "prompt": "",
      "negative": "worst quality, low quality",
      "multiChar": true,
      "scene": "nsfw, hetero, duo, indoor, sofa, from behind",
      "characters": [
        {
          "index": 1,
          "caption": "1girl, milf, huge ass, looking back, doggystyle",
          "center": "C3",
          "uc": "nude, shoes, standing"
        },
        {
          "index": 2,
          "caption": "1boy, faceless male, large penis",
          "center": "C4",
          "uc": "face, hair"
        }
      ]
    }
  ]
}

如果 lorebook / ruleBook 中已经明确规定了主体、动作模板、标签库和多角色结构，就必须优先服从这些规则。不要为了省事退回单个普通 prompt。`;

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
            ruleBook,
            lorebook,
            contextCount: Number(store.contextCount) || 5,
            outputSchema: {
                shouldDraw: 'boolean',
                prompt: 'string',
                negative: 'string optional',
                anchor: { type: 'sentence', index: 'number, 1-based' },
                reason: 'string optional',
                segments: [
                    {
                        anchor: { type: 'sentence', index: 'number, 1-based' },
                        prompt: 'string',
                        negative: 'string optional',
                        multiChar: 'boolean optional',
                        scene: 'string optional',
                        characters: 'array optional'
                    }
                ],
            },
        };
    }

    function parseRuleBookEntries() {
        const store = getStore();
        if (!store.ruleBookEnabled) return [];
        try {
            const data = JSON.parse(store.ruleBookEntries || '[]');
            if (!Array.isArray(data)) throw new Error('规则书必须是 JSON 数组');
            return data
                .filter(entry => entry && entry.enabled !== false && String(entry.content || '').trim())
                .map((entry, index) => ({
                    name: String(entry.name || `规则 ${index + 1}`),
                    constant: !!entry.constant,
                    keys: Array.isArray(entry.keys) ? entry.keys.map(String).filter(Boolean) : [],
                    priority: Number(entry.priority) || 0,
                    content: String(entry.content || '').trim(),
                }));
        } catch (error) {
            debugWarning(`规则书 JSON 解析失败：${error.message || String(error)}`);
            return [];
        }
    }

    function collectActiveRules(currentText, recentMessages) {
        const store = getStore();
        const entries = parseRuleBookEntries();
        if (!entries.length) return [];
        const depth = Math.max(1, Math.min(50, Number(store.ruleBookScanDepth) || 5));
        const scopeText = [
            ...recentMessages.slice(-depth).map(item => item.content),
            currentText,
        ].join('\n');
        const active = entries.filter((entry) => {
            if (entry.constant) return true;
            return entry.keys.some(key => scopeText.includes(key));
        }).sort((a, b) => b.priority - a.priority);
        const budget = Math.max(200, Math.min(12000, Number(store.ruleBookBudget) || 1800));
        const result = [];
        let used = 0;
        for (const entry of active) {
            const chunk = entry.content.slice(0, Math.max(0, budget - used));
            if (!chunk) break;
            result.push({ name: entry.name, content: chunk, priority: entry.priority, constant: entry.constant, keys: entry.keys });
            used += chunk.length;
            if (used >= budget) break;
        }
        return result;
    }

    function buildLorebookScopeText(currentText, recentMessages) {
        const store = getStore();
        const depth = Math.max(1, Math.min(50, Number(store.lorebookContextDepth) || 5));
        return [
            ...recentMessages.slice(-depth).map(item => item.content),
            currentText,
        ].join('\n');
    }

    function matchLorebookEntry(entry, scopeText) {
        if (!entry || entry.disabled || !entry.content) return null;
        if (entry.constant) {
            return {
                sourceId: entry.sourceId,
                uid: entry.uid,
                comment: entry.comment,
                content: entry.content,
                reason: 'constant',
                matchedKeys: [],
                matchedSecondaryKeys: [],
                order: entry.order,
                sticky: entry.sticky,
                cooldown: entry.cooldown,
                preventRecursion: entry.preventRecursion,
                excludeRecursion: entry.excludeRecursion,
            };
        }

        const matchedKeys = entry.key.filter((key) => scopeText.includes(key));
        if (!matchedKeys.length) return null;

        const matchedSecondaryKeys = entry.keysecondary.filter((key) => scopeText.includes(key));
        const needsSecondary = entry.keysecondary.length > 0;

        if (entry.selectiveLogic === 0 && needsSecondary && !matchedSecondaryKeys.length) {
            return null;
        }

        return {
            sourceId: entry.sourceId,
            uid: entry.uid,
            comment: entry.comment,
            content: entry.content,
            reason: 'key',
            matchedKeys,
            matchedSecondaryKeys,
            order: entry.order,
            sticky: entry.sticky,
            cooldown: entry.cooldown,
            preventRecursion: entry.preventRecursion,
            excludeRecursion: entry.excludeRecursion,
        };
    }

    function isLorebookStickyActive(entry, messageId) {
        const state = lorebookRuntimeState.stickyState.get(getLorebookEntryRuntimeKey(entry));
        return !!state && Number(messageId) <= Number(state.untilMessageId || -1);
    }

    function isLorebookCooldownActive(entry, messageId) {
        const state = lorebookRuntimeState.cooldownState.get(getLorebookEntryRuntimeKey(entry));
        return !!state && Number(messageId) <= Number(state.untilMessageId || -1);
    }

    function updateLorebookRuntime(entries, messageId) {
        entries.forEach((entry) => {
            const runtimeKey = getLorebookEntryRuntimeKey(entry);
            if (entry.reason === 'key' || entry.reason === 'recursive') {
                if (Number(entry.sticky) > 0) {
                    lorebookRuntimeState.stickyState.set(runtimeKey, {
                        untilMessageId: Number(messageId) + Number(entry.sticky),
                        activatedAtMessageId: Number(messageId),
                    });
                }
                if (Number(entry.cooldown) > 0) {
                    lorebookRuntimeState.cooldownState.set(runtimeKey, {
                        untilMessageId: Number(messageId) + Number(entry.cooldown),
                        activatedAtMessageId: Number(messageId),
                    });
                }
            }
        });

        for (const [runtimeKey, state] of lorebookRuntimeState.stickyState.entries()) {
            if (Number(messageId) > Number(state.untilMessageId || -1)) {
                lorebookRuntimeState.stickyState.delete(runtimeKey);
            }
        }
        for (const [runtimeKey, state] of lorebookRuntimeState.cooldownState.entries()) {
            if (Number(messageId) > Number(state.untilMessageId || -1)) {
                lorebookRuntimeState.cooldownState.delete(runtimeKey);
            }
        }
    }

    function collectMatchedLorebookEntries(currentText, recentMessages, messageId) {
        const entries = getNormalizedLorebooks();
        if (!entries.length) return [];
        const scopeText = buildLorebookScopeText(currentText, recentMessages);
        const sortedEntries = [...entries].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
        const matched = [];
        const matchedRuntimeKeys = new Set();
        const recursionFragments = [];

        for (const entry of sortedEntries) {
            const runtimeKey = getLorebookEntryRuntimeKey(entry);

            if (entry.constant) {
                const constantMatch = matchLorebookEntry(entry, scopeText);
                if (constantMatch) {
                    matched.push(constantMatch);
                    matchedRuntimeKeys.add(runtimeKey);
                }
                continue;
            }

            if (isLorebookStickyActive(entry, messageId)) {
                matched.push({
                    sourceId: entry.sourceId,
                    uid: entry.uid,
                    comment: entry.comment,
                    content: entry.content,
                    reason: 'sticky',
                    matchedKeys: [],
                    matchedSecondaryKeys: [],
                    order: entry.order,
                    sticky: entry.sticky,
                    cooldown: entry.cooldown,
                    preventRecursion: entry.preventRecursion,
                    excludeRecursion: entry.excludeRecursion,
                });
                matchedRuntimeKeys.add(runtimeKey);
                continue;
            }

            if (isLorebookCooldownActive(entry, messageId)) continue;

            const keyMatch = matchLorebookEntry(entry, scopeText);
            if (!keyMatch) continue;
            if (matchedRuntimeKeys.has(runtimeKey)) continue;
            matched.push(keyMatch);
            matchedRuntimeKeys.add(runtimeKey);
            if (!entry.excludeRecursion) recursionFragments.push(entry.content);
        }

        if (recursionFragments.length) {
            const recursionScope = `${scopeText}\n${recursionFragments.join('\n')}`;
            for (const entry of sortedEntries) {
                const runtimeKey = getLorebookEntryRuntimeKey(entry);
                if (matchedRuntimeKeys.has(runtimeKey)) continue;
                if (entry.constant) continue;
                if (entry.preventRecursion) continue;
                if (isLorebookStickyActive(entry, messageId)) continue;
                if (isLorebookCooldownActive(entry, messageId)) continue;
                const recursiveMatch = matchLorebookEntry(entry, recursionScope);
                if (!recursiveMatch) continue;
                matched.push({
                    ...recursiveMatch,
                    reason: 'recursive',
                });
                matchedRuntimeKeys.add(runtimeKey);
            }
        }

        matched.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
        updateLorebookRuntime(matched, messageId);
        return matched;
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
        let segments = Array.isArray(source?.segments)
            ? source.segments.map((item, index) => ({
                anchor: item?.anchor && typeof item.anchor === 'object'
                    ? { type: item.anchor.type || 'sentence', index: Math.max(1, Number(item.anchor.index) || (index + 1)) }
                    : { type: 'sentence', index: index + 1 },
                prompt: String(item?.prompt || '').trim(),
                negative: String(item?.negative || '').trim(),
                multiChar: !!item?.multiChar,
                scene: String(item?.scene || '').trim(),
                characters: Array.isArray(item?.characters)
                    ? item.characters.map((char, charIndex) => ({
                        index: Math.max(1, Number(char?.index) || (charIndex + 1)),
                        caption: String(char?.caption || '').trim(),
                        center: String(char?.center || 'C3').trim().toUpperCase(),
                        uc: String(char?.uc || '').trim(),
                    })).filter((char) => char.caption)
                    : [],
            })).filter((item) => item.prompt || item.characters.length)
            : [];
        const normalized = {
            shouldDraw: !!source?.shouldDraw,
            prompt: String(source?.prompt || '').trim(),
            negative: String(source?.negative || '').trim(),
            multiChar: !!source?.multiChar,
            scene: String(source?.scene || '').trim(),
            characters: Array.isArray(source?.characters)
                ? source.characters.map((item, index) => ({
                    index: Math.max(1, Number(item?.index) || (index + 1)),
                    caption: String(item?.caption || '').trim(),
                    center: String(item?.center || 'C3').trim().toUpperCase(),
                    uc: String(item?.uc || '').trim(),
                })).filter((item) => item.caption)
                : [],
            anchor: source?.anchor && typeof source.anchor === 'object'
                ? { type: source.anchor.type || 'sentence', index: Math.max(1, Number(source.anchor.index) || 1) }
                : { type: 'sentence', index: 1 },
            reason: String(source?.reason || '').trim(),
            segments,
        };

        if (!segments.length && normalized.shouldDraw && (normalized.prompt || normalized.characters.length)) {
            segments = [{
                anchor: normalized.anchor,
                prompt: normalized.prompt,
                negative: normalized.negative,
                multiChar: normalized.multiChar,
                scene: normalized.scene,
                characters: normalized.characters,
            }];
            normalized.segments = segments;
        }

        return normalized;
    }

    function validateStructuredResult(result) {
        const store = getStore();
        const hasSegments = Array.isArray(result?.segments) && result.segments.length > 0;

        if (store.multiCharOutput && hasSegments) {
            const invalidMultiChar = result.segments.some((segment) => {
                if (!segment?.multiChar) return false;
                return !segment.scene || !Array.isArray(segment.characters) || !segment.characters.length;
            });
            if (invalidMultiChar) {
                throw new Error('tagger 返回了多角色片段，但缺少 scene 或 characters[] 结构');
            }
        }

        return result;
    }

    function logTaggerPayload(tag, payload) {
        console.info(`[${PLUGIN_NAME}] ${tag} =>`, payload);
    }

    function buildMultiCharPrompt(result) {
        const scene = String(result?.scene || '').trim() || String(result?.prompt || '').trim();
        const chars = Array.isArray(result?.characters) ? result.characters : [];
        if (!chars.length) return String(result?.prompt || '').trim();
        const parts = [];
        if (scene) parts.push(`Scene:${scene};`);
        chars.forEach((item, index) => {
            const charIndex = Math.max(1, Number(item?.index) || (index + 1));
            const caption = String(item?.caption || '').trim();
            const center = String(item?.center || 'C3').trim().toUpperCase() || 'C3';
            const uc = String(item?.uc || '').trim();
            if (caption) parts.push(`Char${charIndex}:${caption}|centers:${center};`);
            if (uc) parts.push(`Char${charIndex} UC:${uc};`);
        });
        return `image###${parts.join('')}###`;
    }

    function logFinalPrompt(result) {
        const finalPrompt = getFinalPrompt(result);
        console.info(`[${PLUGIN_NAME}] final prompt =>`, finalPrompt);
        return finalPrompt;
    }

    function getFinalPrompt(result) {
        const store = getStore();
        return store.multiCharOutput && result?.multiChar
            ? buildMultiCharPrompt(result)
            : String(result?.prompt || '').trim();
    }

    function getResultSegments(result) {
        if (Array.isArray(result?.segments) && result.segments.length) {
            return result.segments.map((segment, index) => ({
                ...result,
                ...segment,
                segmentIndex: index,
            }));
        }
        return [{
            ...result,
            segmentIndex: 0,
        }];
    }

    function materializeResultCards(messageId, trigger, result, baseKey) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return [];

        const stale = container.querySelector(`[data-rbq-sdt-key="${CSS.escape(baseKey)}"]`);
        if (stale instanceof HTMLElement) stale.remove();

        const segments = getResultSegments(result)
            .filter((segment) => getFinalPrompt(segment));

        return segments.map((segment, index) => {
            const segKey = `${baseKey}:seg:${index}`;
            const wrapper = insertCard(messageId, trigger, segment, segKey);
            if (!(wrapper instanceof HTMLElement)) return null;
            wrapper.dataset.prompt = getFinalPrompt(segment);
            wrapper.dataset.rbqSdtBaseKey = baseKey;
            wrapper.dataset.rbqSdtSegmentIndex = String(index);
            return { wrapper, key: segKey, segment };
        }).filter(Boolean);
    }

    async function callOpenAiCompatible(messageId, trigger) {
        const store = getStore();
        const url = normalizeBaseUrl(store.openaiBaseUrl);
        if (!url) throw new Error('请先填写 OpenAI 兼容接口 Base URL');
        if (!store.openaiModel) throw new Error('请先填写模型名称');
        const body = buildRequestPayload(messageId, trigger);
        logTaggerPayload('tagger request body', body);
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
        const json = await response.json();
        logTaggerPayload('tagger raw response', json);
        const normalized = validateStructuredResult(normalizeTaggerResult(json));
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
        const body = buildRequestPayload(messageId, trigger);
        logTaggerPayload('tagger request body', body);
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`自定义 tagger 请求失败: HTTP ${response.status} ${await response.text()}`);
        const json = await response.json();
        logTaggerPayload('tagger raw response', json);
        const normalized = validateStructuredResult(normalizeTaggerResult(json));
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
            inserted = insertAfterSentence(container, result.anchor.index || 1, wrapper);
        }
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
        if (wrapper instanceof HTMLElement) wrapper.dataset.rbqSdtStage = String(stage || 'idle');
    }

    async function runImageGenerationForWrapper(wrapper, messageId, key) {
        const store = getStore();
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
            if (store.cache[key]) store.cache[key].autoGenerated = true;
            save();
            ensureTaggerButtonState(wrapper, '重新解析/刷新 tag');
            setGenerateButtonState(wrapper, true, '重新生成图片', false);
            setWrapperStage(wrapper, 'ready-generate');
        } catch (error) {
            toastr.error(error.message || String(error), PLUGIN_NAME);
            ensureTaggerButtonState(wrapper, '重新解析/刷新 tag');
            setGenerateButtonState(wrapper, true, '生成图片', false);
            setWrapperStage(wrapper, 'ready-generate');
        } finally {
            clearWrapperLoading(wrapper);
        }
    }

    function bindWrapperManualRun(wrapper, trigger, messageId, key) {
        if (!(wrapper instanceof HTMLElement)) return;
        if (wrapper.dataset.rbqSdtBound === '1') return;
        wrapper.dataset.rbqSdtBound = '1';
        const button = wrapper.querySelector('.st-scene-trigger-generate');
        const generateButton = ensureRenderGenerateButton(wrapper);
        if (!(button instanceof HTMLButtonElement)) return;
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (inFlight.has(key)) return;
            inFlight.add(key);
            try {
                setWrapperStage(wrapper, 'parsing');
                await runTaggerForWrapper(wrapper, trigger, messageId, key);
            } finally {
                inFlight.delete(key);
            }
        });
        if (generateButton instanceof HTMLButtonElement) {
            generateButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await runImageGenerationForWrapper(wrapper, messageId, key);
            });
        }
    }

    async function maybeAutoGenerate(wrapper, result, messageId, key) {
        const store = getStore();
        if (!store.autoRunTagger || !RBQ.api.shouldAutoGenerate() || store.cache[key]?.autoGenerated) return;
        try {
            setWrapperLoading(wrapper, 'tagger 已返回，正在调用 RBQ 生图...');
            const finalPrompt = getFinalPrompt(result);
            const image = await RBQ.api.generateImage(finalPrompt, 'smart-draw-trigger', { messageId }, (progressText) => {
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
            };
            pruneCache();
            save();
            if (!result.shouldDraw || !result.prompt) {
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
                bindWrapperManualRun(renderedWrapper, trigger, messageId, cacheKey);
                if (store.autoRunTagger && RBQ.api.shouldAutoGenerate()) {
                    await maybeAutoGenerate(renderedWrapper, item.segment, messageId, cacheKey);
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

    async function processMessage(messageId) {
        const store = getStore();
        if (!isLatestMessage(messageId)) return;
        const message = getMessageSnapshot(messageId);
        if (!shouldHandleMessage(message)) return;
        const trigger = getTrigger(message);
        if (!trigger) return;
        const key = makeKey(messageId, message, trigger.type, trigger.marker || 'auto');
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
                bindWrapperManualRun(wrapper, trigger, messageId, key);
                if (store.autoRunTagger && RBQ.api.shouldAutoGenerate()) {
                    await maybeAutoGenerate(wrapper, item.segment, messageId, key);
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
            <div class="st-scene-trigger-subpanel-hint">无需让正文输出长 tag：插件调用 tagger API 生成 prompt，并在消息内插入 RBQ 生图卡片。</div>
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
                <label class="st-scene-trigger-field wide"><span>System Prompt <small id="rbq-sdt-system-prompt-version" style="opacity:.6;font-weight:normal;margin-left:6px;"></small></span><textarea id="rbq-sdt-system-prompt"></textarea></label>
            </div>
            <div class="st-scene-trigger-buttons">
                <button id="rbq-sdt-save" class="menu_button" type="button">保存智能触发器设置</button>
                <button id="rbq-sdt-reset-system-prompt" class="menu_button" type="button">重置为最新默认 Prompt</button>
                <button id="rbq-sdt-import-lorebook" class="menu_button" type="button">选择世界书文件</button>
                <button id="rbq-sdt-clear-cache" class="menu_button" type="button">清空触发缓存</button>
                <button id="rbq-sdt-scan" class="menu_button" type="button">重新扫描当前聊天</button>
            </div>
            <div class="st-scene-trigger-field wide">
                <span>已挂载世界书</span>
                <div id="rbq-sdt-lorebook-list" class="rbq-sdt-note">${renderLorebookSourceList()}</div>
            </div>
            <div class="rbq-sdt-note">自动生成策略跟随 RBQ 主设置：RBQ 自动生成开启时会自动出图；关闭时只显示“生成图片”按钮。</div>
        `;
        panel.append(container);

        document.getElementById('rbq-sdt-enabled').checked = !!store.enabled;
        document.getElementById('rbq-sdt-mode').value = store.mode;
        document.getElementById('rbq-sdt-target-role').value = store.targetRole;
        document.getElementById('rbq-sdt-context-count').value = store.contextCount;
        document.getElementById('rbq-sdt-debug').checked = !!store.debugToast;
        document.getElementById('rbq-sdt-multichar').checked = !!store.multiCharOutput;
        document.getElementById('rbq-sdt-autorun').checked = !!store.autoRunTagger;
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
        const promptVersionText = store.systemPromptVersion === DEFAULT_SYSTEM_PROMPT_VERSION
            ? `v${store.systemPromptVersion}（最新）`
            : `本地 v${store.systemPromptVersion} / 内置 v${DEFAULT_SYSTEM_PROMPT_VERSION}`;
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
            s.systemPrompt = DEFAULT_SYSTEM_PROMPT;
            s.systemPromptVersion = DEFAULT_SYSTEM_PROMPT_VERSION;
            save();
            document.getElementById('rbq-sdt-system-prompt').value = DEFAULT_SYSTEM_PROMPT;
            document.getElementById('rbq-sdt-system-prompt-version').textContent = `v${DEFAULT_SYSTEM_PROMPT_VERSION}（最新）`;
            toastr.success('已重置为插件内置的最新默认 System Prompt', PLUGIN_NAME);
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
