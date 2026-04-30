(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Smart Draw Trigger] RBQ Core API missing');

    const PLUGIN_NAME = '智能生图触发器';
    const STORAGE_KEY = '_smartDrawTrigger';
    const CARD_CLASS = 'rbq-sdt-card';
    const DEFAULT_SYSTEM_PROMPT_VERSION = 5;
    const STRICT_SYSTEM_PROMPT = `你是 RBQ Smart Draw Trigger 的“剧情视觉分镜 + 生图协议规划器”。你不是聊天角色，也不是普通提示词补全器。

你的任务：
1. 阅读输入 JSON 中的 currentMessage、recentMessages、marker、lorebook、ruleBook。
2. 判断当前消息是否真的需要插入生图卡片。
3. 如果需要，规划一个或多个插图点 segments[]。
4. 为每个插图点输出稳定可用的英文生图 prompt，或输出多角色结构 scene + characters[]。
5. 返回严格 JSON 对象；不要返回 markdown，不要解释，不要输出额外文字。

【硬性输出规则】
- 只能返回 JSON object。
- shouldDraw=false 时：prompt=""，negative=""，segments=[]。
- shouldDraw=true 时：优先输出 segments[]；顶层 prompt/negative/anchor 可镜像第一个 segment 以兼容旧流程。
- 每个 segment 必须有 anchor.text。anchor.text 必须逐字摘抄 currentMessage.content 中真实存在的一句或一小段原文，不要改写、翻译、概括。
- anchor.index 是辅助序号，从 1 开始；如果无法精确数句，也要尽量给出合理 index，但 anchor.text 优先。
- prompt 不要包含 [scene]、[img]、image###、markdown、解释文字或 JSON 片段。
- prompt 用英文逗号分隔标签/短语，优先视觉元素：主体、人数、构图、动作、表情、服装、场景、光照、镜头、风格。
- negative 用英文逗号分隔负面词，保持简洁；不要把正面主体放入 negative。

【是否生图判定】
返回 shouldDraw=true 的典型情况：
- 当前消息出现明确视觉高潮、角色动作、姿态、服装变化、场景转换、关键表情、构图明显的画面。
- marker 存在时，优先视为用户强制插图，但仍需输出真实可用 prompt。
- lorebook/ruleBook 明确要求某类场景、角色外观或生图模板，并且当前消息触发了相关画面。

返回 shouldDraw=false 的情况：
- 当前消息主要是过渡、心理独白、纯对白、规则说明、系统提示、回忆总结，缺少可视化焦点。
- 当前消息重复上一张图的画面，没有新增构图/动作/服装/场景变化。
- 无法找到可逐字摘抄的 anchor.text。

【多段 segments 规则】
- 单条消息只有一个视觉焦点：输出 1 个 segment。
- 单条消息存在多个明确视觉焦点、镜头切换、动作阶段或场景转场：输出 2-3 个 segments。
- 不要为了凑数量拆分微小动作；每个 segment 都应对应一个独立画面。
- 每个 segment 的 anchor.text 必须对应其插图点附近的当前消息原文。

【lorebook / ruleBook 使用规则】
- ruleBook 是高优先级格式/画风/偏好规则。
- lorebook 是角色、模板、标签库、动作、禁忌、构图等约束来源。
- 只吸收与当前 segment 直接相关的条目；不要机械堆叠所有命中词条。
- 如果 lorebook/ruleBook 明确给出主体模板、标签库、SEX/动作模板或多角色结构，必须优先遵守。
- 冲突时：当前消息事实 > ruleBook 强约束 > lorebook 命中条目 > 最近上下文推断。

【多角色输出规则】
- 当画面中有两个或以上需要分别控制的角色，或 ruleBook/lorebook 要求多角色结构时，segment.multiChar=true。
- multiChar=true 时：segment.prompt 可为空；必须填写 scene 和 characters[]。
- scene 写整体场景、构图、气氛、动作关系、镜头。
- characters[] 每项包含 index、caption、center、uc。
- caption 写该角色的外观、服装、姿态、表情、身份视觉特征。
- center 使用 C1/C2/C3/C4/C5 等构图位置；不确定时主角 C3，第二角色 C4 或 C2。
- uc 只写该角色局部负面，不要把另一个角色写进 uc。

【输出 JSON Schema】
{
  "shouldDraw": true,
  "reason": "short chinese reason",
  "prompt": "optional first segment prompt",
  "negative": "optional first segment negative",
  "anchor": { "type": "sentence", "index": 1, "text": "current message exact sentence" },
  "multiChar": false,
  "scene": "optional first segment scene",
  "characters": [],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 1, "text": "current message exact sentence" },
      "prompt": "english image prompt, comma separated tags",
      "negative": "worst quality, low quality, bad anatomy",
      "multiChar": false,
      "scene": "",
      "characters": []
    }
  ]
}

【示例：无需生图】
{
  "shouldDraw": false,
  "reason": "当前消息缺少明确视觉焦点",
  "prompt": "",
  "negative": "",
  "anchor": { "type": "sentence", "index": 1, "text": "" },
  "multiChar": false,
  "scene": "",
  "characters": [],
  "segments": []
}

【示例：单图】
{
  "shouldDraw": true,
  "reason": "当前句子形成一个明确室内近景画面",
  "prompt": "1girl, close-up, indoor, warm lighting, tense expression, detailed eyes, cinematic composition",
  "negative": "worst quality, low quality, bad anatomy, blurry",
  "anchor": { "type": "sentence", "index": 2, "text": "当前消息中真实存在的目标原句。" },
  "multiChar": false,
  "scene": "",
  "characters": [],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 2, "text": "当前消息中真实存在的目标原句。" },
      "prompt": "1girl, close-up, indoor, warm lighting, tense expression, detailed eyes, cinematic composition",
      "negative": "worst quality, low quality, bad anatomy, blurry",
      "multiChar": false,
      "scene": "",
      "characters": []
    }
  ]
}

【示例：多角色】
{
  "shouldDraw": true,
  "reason": "当前画面需要分别控制两名角色",
  "prompt": "",
  "negative": "worst quality, low quality, bad anatomy",
  "anchor": { "type": "sentence", "index": 3, "text": "当前消息中真实存在的双人互动原句。" },
  "multiChar": true,
  "scene": "duo, indoor, sofa, intimate distance, cinematic lighting, medium shot",
  "characters": [
    { "index": 1, "caption": "1girl, long hair, expressive eyes, looking back, detailed face", "center": "C3", "uc": "bad face, extra arms" },
    { "index": 2, "caption": "1boy, taller male, dark hair, close behind", "center": "C4", "uc": "bad hands, deformed body" }
  ],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 3, "text": "当前消息中真实存在的双人互动原句。" },
      "prompt": "",
      "negative": "worst quality, low quality, bad anatomy",
      "multiChar": true,
      "scene": "duo, indoor, sofa, intimate distance, cinematic lighting, medium shot",
      "characters": [
        { "index": 1, "caption": "1girl, long hair, expressive eyes, looking back, detailed face", "center": "C3", "uc": "bad face, extra arms" },
        { "index": 2, "caption": "1boy, taller male, dark hair, close behind", "center": "C4", "uc": "bad hands, deformed body" }
      ]
    }
  ]
}`;

    const BALANCED_SYSTEM_PROMPT = `你是 RBQ Smart Draw Trigger 的剧情生图规划器。你的目标是先理解剧情画面，再输出稳定 JSON，让前端在合适位置插入生图卡片。

只返回 JSON，不要 markdown，不要解释。

【工作方式】
1. 阅读 currentMessage.content，并参考 recentMessages、lorebook、ruleBook。
2. 判断当前消息是否有值得出图的视觉焦点。
3. 有图则输出 segments[]；每个 segment 对应一个独立画面。
4. 每个 segment 都尽量提供 anchor.text，它必须是 currentMessage.content 里的原句或原文片段。
5. 只将与当前画面相关的 lorebook/ruleBook 内容融入 prompt，避免无关堆词。

【输出格式】
{
  "shouldDraw": true,
  "reason": "short chinese reason",
  "prompt": "optional first segment prompt",
  "negative": "optional first segment negative",
  "anchor": { "type": "sentence", "index": 1, "text": "current message exact sentence" },
  "multiChar": false,
  "scene": "optional first segment scene",
  "characters": [],
  "segments": [
    {
      "anchor": { "type": "sentence", "index": 1, "text": "current message exact sentence" },
      "prompt": "english image prompt, comma separated tags",
      "negative": "optional negative prompt",
      "multiChar": false,
      "scene": "",
      "characters": []
    }
  ]
}

【规则】
- shouldDraw=false 时，segments=[]，prompt=""。
- 单个明确视觉焦点输出 1 个 segment；多个明显镜头/动作阶段/场景变化可输出 2-3 个 segments。
- prompt 使用英文逗号分隔，描述视觉画面，不要包含 [scene]、[img]、image### 或解释。
- anchor.text 优先于 anchor.index；必须摘抄原文，不要重写。
- 多角色画面使用 multiChar=true，并填写 scene + characters[]；否则使用普通 prompt。
- 顶层字段尽量镜像第一个 segment，便于旧接口兼容。
- 不确定是否值得出图时，宁可 shouldDraw=false，避免过度触发。`;

    const LEGACY_SYSTEM_PROMPT = `你是 SillyTavern/RBQ 生图扩展的提示词规划器。根据当前聊天正文判断是否需要插入图片，并返回 JSON。

只返回 JSON，不要 markdown，不要解释。

JSON 格式：
{
  "shouldDraw": true,
  "prompt": "english image prompt, comma separated tags",
  "negative": "optional negative prompt",
  "anchor": { "type": "sentence", "index": 1, "text": "current message exact sentence" },
  "reason": "short chinese reason",
  "multiChar": false,
  "scene": "optional multi-char scene prompt",
  "characters": [],
  "segments": []
}

规则：
- shouldDraw=false 时 prompt=""，segments=[]。
- prompt 只写视觉画面，不要包含 [scene]、[img]、image###、解释或分析。
- anchor.text 建议填写当前消息里真实存在的目标句子；anchor.index 表示插在第几句后。
- 如果当前消息有多个明显插图点，可以填写 segments[]，每段都有 anchor/prompt/negative。
- 如果是多角色模式，优先返回 multiChar=true，并提供 scene / characters / center / uc 结构化字段。
- 不要把系统说明、审查声明、无关上下文写进 prompt。`;

    const SYSTEM_PROMPT_PRESETS = {
        strict: { label: '严格结构化版', prompt: STRICT_SYSTEM_PROMPT },
        balanced: { label: '平衡版', prompt: BALANCED_SYSTEM_PROMPT },
        legacy: { label: '旧版回退版', prompt: LEGACY_SYSTEM_PROMPT },
    };

    const DEFAULT_SYSTEM_PROMPT_PRESET = 'strict';
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

    function normalizeAnchor(anchor, fallbackIndex = 1) {
        const index = Math.max(1, Number(anchor?.index) || Number(fallbackIndex) || 1);
        return {
            type: String(anchor?.type || 'sentence'),
            index,
            text: String(anchor?.text || '').trim(),
        };
    }

    function normalizeComparableText(text) {
        return String(text || '')
            .replace(/\s+/g, '')
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .trim();
    }

    function anchorsMatchSentence(anchorText, sentenceText) {
        const needle = String(anchorText || '').trim();
        const sentence = String(sentenceText || '').trim();
        if (!needle || !sentence) return false;
        if (sentence.includes(needle) || needle.includes(sentence)) return true;
        const normalizedNeedle = normalizeComparableText(needle);
        const normalizedSentence = normalizeComparableText(sentence);
        return !!normalizedNeedle && !!normalizedSentence
            && (normalizedSentence.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedSentence));
    }

    function normalizeTaggerResult(data) {
        const source = data?.choices?.[0]?.message?.content ? extractJson(data.choices[0].message.content) : data;
        let segments = Array.isArray(source?.segments)
            ? source.segments.map((item, index) => ({
                anchor: normalizeAnchor(item?.anchor, index + 1),
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
            anchor: normalizeAnchor(source?.anchor, 1),
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
                segmentKeySuffix: `seg:${index}:${hashText(getFinalPrompt({ ...result, ...segment }) || JSON.stringify(segment))}`,
            }));
        }
        return [{
            ...result,
            segmentIndex: 0,
            segmentKeySuffix: `seg:0:${hashText(getFinalPrompt(result) || JSON.stringify(result))}`,
        }];
    }

    function getSegmentState(store, baseKey, segmentKey) {
        const cache = store.cache?.[baseKey];
        if (!cache) return null;
        if (!cache.segmentStates || typeof cache.segmentStates !== 'object') cache.segmentStates = {};
        if (!cache.segmentStates[segmentKey]) cache.segmentStates[segmentKey] = {};
        return cache.segmentStates[segmentKey];
    }

    function markSegmentAutoGenerated(baseKey, segmentKey) {
        const store = getStore();
        const state = getSegmentState(store, baseKey, segmentKey);
        if (!state) return;
        state.autoGenerated = true;
        state.generatedAt = Date.now();
        save();
    }

    function materializeResultCards(messageId, trigger, result, baseKey) {
        const container = RBQ.api.getMessageTextContainer(messageId);
        if (!(container instanceof HTMLElement)) return [];

        const stale = container.querySelector(`[data-rbq-sdt-key="${CSS.escape(baseKey)}"]`);
        if (stale instanceof HTMLElement) stale.remove();

        const segments = getResultSegments(result)
            .filter((segment) => getFinalPrompt(segment));
        const nextKeys = new Set(segments.map((segment, index) => `${baseKey}:${segment.segmentKeySuffix || `seg:${index}`}`));
        container.querySelectorAll(`[data-rbq-sdt-base-key="${CSS.escape(baseKey)}"]`).forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const key = element.dataset.rbqSdtKey || '';
            if (!nextKeys.has(key)) element.remove();
        });

        console.info(`[${PLUGIN_NAME}] materializeResultCards =>`, {
            messageId,
            baseKey,
            segmentCount: segments.length,
            segments: segments.map((segment, index) => ({
                index,
                anchor: segment.anchor,
                multiChar: segment.multiChar,
                promptPreview: String(getFinalPrompt(segment)).slice(0, 120),
            })),
            containerTag: container.tagName,
            containerClass: container.className,
            containerPreview: String(container.textContent || '').slice(0, 160),
        });

        return segments.map((segment, index) => {
            const segKey = `${baseKey}:${segment.segmentKeySuffix || `seg:${index}`}`;
            const wrapper = insertCard(messageId, trigger, segment, segKey);
            console.info(`[${PLUGIN_NAME}] materialize segment result =>`, {
                messageId,
                segKey,
                anchor: segment.anchor,
                inserted: !!wrapper,
                wrapperConnected: !!wrapper?.isConnected,
            });
            if (!(wrapper instanceof HTMLElement)) return null;
            wrapper.dataset.prompt = getFinalPrompt(segment);
            wrapper.dataset.rbqSdtBaseKey = baseKey;
            wrapper.dataset.rbqSdtSegmentIndex = String(index);
            wrapper.dataset.rbqSdtSegmentKey = segKey;
            return { wrapper, key: segKey, baseKey, segment };
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
                <label class="st-scene-trigger-field"><span>内置 Prompt 档位</span><select id="rbq-sdt-system-preset"><option value="strict">严格结构化版</option><option value="balanced">平衡版</option><option value="legacy">旧版回退版</option></select></label>
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
