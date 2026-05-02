(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Smart Draw Trigger] RBQ Core API missing');

    const PLUGIN_NAME = '智能生图触发器';
    const STORAGE_KEY = '_smartDrawTrigger';
    const CARD_CLASS = 'rbq-sdt-card';
    const DEFAULT_SYSTEM_PROMPT_VERSION = 9;
    const STORYBOARDER_SYSTEM_PROMPT = `你是 RBQ Smart Draw Trigger 的"分镜师与提示词工程师"。
你的任务是阅读当前的小说/剧情片段，拆解为关键视觉分镜，为每个分镜生成 NAI/Danbooru 风格的英文 Tag prompt，返回 JSON。
你的输出将被直接映射到 NovelAI V4 多角色 API，每个 character 是一个独立的角色槽。

═══════ 铁律（违反任何一条 = 输出无效）═══════

1.【格式】只输出合法 JSON。禁止 markdown、禁止解释、禁止注释。
2.【anchor.text 定位】必须从 currentMessage.content 中**逐字复制**一段原文（10~40字）作为插图锚点。
  - 不可翻译、不可改写、不可省略或修改任何标点。
  - 前端通过 indexOf(anchor.text) 在原文中定位插图位置。找不到 = 你的输出失败。
3.【Tag 来源】你收到的 payload.lorebook 中包含根据当前文本关键词匹配到的 Tag 参考条目。
  - 每个条目有 name（条目名）、keys（触发关键词）、tags（可用的 Tag 列表）。
  - 请阅读这些 Tag 参考，从中挑选适合当前画面的 Tag 融入你的 prompt。不是所有条目都适用——请根据画面内容判断取舍。
  - 直接引用 lorebook 中的 Tag，不要改写。如果 lorebook 未覆盖，你可自行补充合理的 Danbooru/NAI 风格 Tag。
4.【不配对话/心理图】如果当前内容只有对话或内心独白，没有明显视觉场景变化，返回 shouldDraw: false。

═══════ 画面规则 ═══════

## 插图规划
- 通读全文→标记强视觉段落→段落间插图，禁止文末堆积
- 单轮 1~5 张，均匀分布
- 优先级（降序）：NSFW 时 媒介内容>表现力峰值>情色峰值>核心剧情标志；SFW 时 媒介内容>核心剧情标志>表现力峰值

## 核心原则
- 真实原则：文本有述→直用；无述→基于上文补全；冲突→文本优先
- 主次原则：主角详述占 Char 槽主导配额；配角简述聚焦与主角互动；路人剔除
- 镜头原则：图片=静态镜头，按当前镜头严格过滤不可见元素，越界 Tag 禁入

## Tag 规范
- 排序：按画面占比/重要性降序，关联 Tag 相邻
- 拆解：复合语义→独立 Tag（月下→moonlit, night；害羞→shy, blush, wavy mouth）
- 配额：scene 20~40 Tag，每个角色 30~60 Tag
- 结构顺序：quality→场景环境→光影氛围→镜头角度→人物数量→人物核心设定→服装→动作姿势→表情视线
- 微细节（5~15 Tag）：即时反馈(trembling,splash)、主体标志(hair ornament)、氛围渲染(光影/粒子)、细节补全

## 角色规则
- 多女同框仅 yuri/协同；其他场景默认单女
- 种族判定：人形→girl/boy，非人→no humans
- DNA：首登角色全描述，后续仅变更部分
- 防偷懒：配额不足则补微细节，复合概念碎片化，连续生图轮换镜头维度

═══════ 分镜逻辑 ═══════

- 寻找「视觉断裂点」：空间转换、动作突变、情绪高潮
- 每条消息通常 1~3 张图，不要为每句话配图
- 原文很短（<100字）或纯对话 → 0~1 张图
- 有空间转换或强烈动作演进 → 拆分为多个 segment

═══════ 输出结构说明 ═══════

每个 segment 的 characters 数组直接映射到 NAI V4 API 的角色槽：
- name: 角色在原文中的名字（用于匹配世界书中的角色外貌 Tag）
- action: 该角色在此画面的**完整 Tag 描述**（外貌+服装+姿态+表情+动作），这会成为该角色槽的全部 prompt
- center: 角色在画面中的位置坐标，格式为"列行"（A-E 列, 1-5 行），例如 B3=左中, D2=右上, C3=正中
- uc: 该角色的负面提示词（不需要出现的元素），留空字符串如不需要

label 字段是该分镜的中文短语标题（5~15字），用于在 UI 按钮上显示。用简洁的中文概括当前画面的核心内容。

scene 字段是全局背景/环境 Tag，会成为 base_caption（全角色共享）。
quality Tag（如 best quality, masterpiece, absurdres）放在 scene 的最前面。

═══════ 坐标参考 ═══════

列: A=最左(0.1) B=左(0.3) C=中(0.5) D=右(0.7) E=最右(0.9)
行: 1=最上(0.1) 2=上(0.3) 3=中(0.5) 4=下(0.7) 5=最下(0.9)

常用组合：
- 单人正中: C3
- 两人对视: B3 + D3
- 三人: B3 + C3 + D3（或 A3 + C3 + E3 更分散）
- 俯视/仰视: 列不变，行用 1-2 或 4-5

═══════ 输出格式 ═══════

{
  "shouldDraw": true,
  "reason": "简述为什么需要配图（中文，10~30字）",
  "segments": [
    {
      "label": "5~15字中文短语概括画面（如：客厅沉默·松手瞬间）",
      "anchor": {
        "text": "从 currentMessage.content 中逐字复制的原文片段"
      },
      "scene": "best quality, masterpiece, absurdres, night, bedroom, dim lighting, wooden floor",
      "characters": [
        {
          "name": "角色名",
          "action": "1girl, long black hair, red eyes, medium breasts, white dress, sitting on bed, leaning forward, shy smile, blushing, looking at viewer",
          "center": "B3",
          "uc": ""
        },
        {
          "name": "角色名2",
          "action": "1boy, short brown hair, tall, muscular, black shirt, standing, arms crossed, smirking",
          "center": "D3",
          "uc": ""
        }
      ]
    }
  ]
}`;

    const SYSTEM_PROMPT_PRESETS = {
        storyboarder: { label: 'V9-NAI V4 原生多角色版', prompt: STORYBOARDER_SYSTEM_PROMPT },
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
        lorebookBudget: 8000,
        lorebookSources: [],

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

    // Temp state for passing structured char data to buildNaiV4Payload hook
    let pendingNaiCharData = null;

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
            caseSensitive: !!entry?.caseSensitive,
            matchWholeWords: !!entry?.matchWholeWords,
            probability: Math.max(0, Math.min(100, Number(entry?.probability || 100))),
            useProbability: !!entry?.useProbability,
            group: String(entry?.group || ''),
            groupOverride: !!entry?.groupOverride,
            groupWeight: Math.max(0, Number(entry?.groupWeight || 100)),
            useGroupScoring: !!entry?.useGroupScoring,
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


    /* ── SillyTavern-compatible worldbook matching engine ── */

    function matchKeyInText(key, text, caseSensitive) {
        if (!key) return false;
        if (caseSensitive) return text.includes(key);
        return text.toLowerCase().includes(key.toLowerCase());
    }

    function checkEntryKeyMatch(entry, contextText) {
        const cs = !!entry.caseSensitive;
        if (entry.constant) return true;
        if (!entry.key.length) return false;

        const primaryHit = entry.key.some(k => matchKeyInText(k, contextText, cs));
        if (!primaryHit) return false;

        // selective + secondary key logic (mirrors SillyTavern)
        if (entry.selective && entry.keysecondary.length > 0) {
            const secResults = entry.keysecondary.map(k => matchKeyInText(k, contextText, cs));
            const anySecHit = secResults.some(Boolean);
            const allSecHit = secResults.every(Boolean);
            switch (entry.selectiveLogic) {
                case 0: return anySecHit;        // AND_ANY:  primary AND any secondary
                case 1: return !allSecHit;       // NOT_ALL:  primary AND NOT all secondary
                case 2: return !anySecHit;       // NOT_ANY:  primary AND NOT any secondary
                case 3: return allSecHit;        // AND_ALL:  primary AND ALL secondary
                default: return anySecHit;
            }
        }
        return true;
    }

    function collectMatchedLorebookEntries(currentMes, recentMessages, messageId) {
        const store = getStore();
        if (!store.lorebookEnabled) return [];
        const entries = getNormalizedLorebooks();
        const globalDepth = Math.max(1, Number(store.lorebookContextDepth) || 5);
        const allContext = [...recentMessages.map(m => m.content), currentMes];

        // Phase 1: keyword activation with full ST-compatible logic
        const activated = [];
        for (const entry of entries) {
            const entryDepth = entry.depth != null ? Math.max(1, entry.depth + 1) : globalDepth + 1;
            const contextText = allContext.slice(-entryDepth).join('\n');
            const rKey = getLorebookEntryRuntimeKey(entry);

            const isMatch = checkEntryKeyMatch(entry, contextText);

            if (!isMatch) {
                // Sticky: keep active for N messages after last trigger
                const sticky = lorebookRuntimeState.stickyState.get(rKey);
                if (sticky && sticky.remaining > 0) {
                    sticky.remaining--;
                    activated.push({ ...entry, _matchType: 'sticky', matchedKeys: entry.key });
                    if (sticky.remaining <= 0) {
                        lorebookRuntimeState.stickyState.delete(rKey);
                        if (entry.cooldown > 0) {
                            lorebookRuntimeState.cooldownState.set(rKey, { remaining: entry.cooldown });
                        }
                    }
                    continue;
                }
                // Decrement cooldown even when not matched
                const cd = lorebookRuntimeState.cooldownState.get(rKey);
                if (cd && cd.remaining > 0) {
                    cd.remaining--;
                    if (cd.remaining <= 0) lorebookRuntimeState.cooldownState.delete(rKey);
                }
                continue;
            }

            // Matched by keyword — check cooldown
            const cd = lorebookRuntimeState.cooldownState.get(rKey);
            if (cd && cd.remaining > 0) {
                cd.remaining--;
                if (cd.remaining <= 0) lorebookRuntimeState.cooldownState.delete(rKey);
                continue;
            }

            // Probability check
            if (entry.useProbability && entry.probability < 100) {
                if (Math.random() * 100 >= entry.probability) continue;
            }

            // Start sticky timer
            if (entry.sticky > 0) {
                lorebookRuntimeState.stickyState.set(rKey, { remaining: entry.sticky });
            }

            const cs = !!entry.caseSensitive;
            const hitKeys = entry.key.filter(k => matchKeyInText(k, contextText, cs));
            activated.push({ ...entry, _matchType: 'keyword', matchedKeys: hitKeys.length ? hitKeys : entry.key });
        }

        // Phase 2: Group / Mutual Exclusion — same group entries compete, highest priority wins
        const grouped = new Map();
        const ungrouped = [];
        for (const entry of activated) {
            if (entry.group) {
                if (!grouped.has(entry.group)) grouped.set(entry.group, []);
                grouped.get(entry.group).push(entry);
            } else {
                ungrouped.push(entry);
            }
        }
        const afterGroup = [...ungrouped];
        for (const [groupName, members] of grouped) {
            if (members.length <= 1) {
                afterGroup.push(...members);
                continue;
            }
            // GroupOverride: use groupWeight for scoring; otherwise use order
            const useScoring = members.some(m => m.groupOverride || m.useGroupScoring);
            if (useScoring) {
                const totalWeight = members.reduce((sum, m) => sum + (m.groupWeight || 100), 0);
                let roll = Math.random() * totalWeight;
                let picked = members[0];
                for (const m of members) {
                    roll -= (m.groupWeight || 100);
                    if (roll <= 0) { picked = m; break; }
                }
                afterGroup.push(picked);
            } else {
                // Highest order wins
                members.sort((a, b) => (b.order || 0) - (a.order || 0));
                afterGroup.push(members[0]);
            }
            debugInfo(`互斥分组 "${groupName}": ${members.length} 条竞争, 胜出: ${members.length > 0 ? (afterGroup[afterGroup.length - 1].comment || afterGroup[afterGroup.length - 1].uid) : '无'}`);
        }

        // Phase 3: Multi-pass Recursion — keep scanning until stable (like SillyTavern)
        const activatedUids = new Set(afterGroup.map(e => `${e.sourceId}:${e.uid}`));
        const MAX_RECURSION_PASSES = 5;
        for (let pass = 0; pass < MAX_RECURSION_PASSES; pass++) {
            const recursionContent = afterGroup.filter(e => !e.excludeRecursion).map(e => e.content).join('\n');
            const remaining = entries.filter(e => !activatedUids.has(`${e.sourceId}:${e.uid}`));
            let foundNew = false;
            for (const entry of remaining) {
                if (entry.preventRecursion) continue;
                if (!checkEntryKeyMatch(entry, recursionContent)) continue;
                if (entry.useProbability && entry.probability < 100) {
                    if (Math.random() * 100 >= entry.probability) continue;
                }
                const cs = !!entry.caseSensitive;
                const hitKeys = entry.key.filter(k => matchKeyInText(k, recursionContent, cs));
                afterGroup.push({ ...entry, _matchType: 'recursion', matchedKeys: hitKeys.length ? hitKeys : entry.key });
                activatedUids.add(`${entry.sourceId}:${entry.uid}`);
                foundNew = true;
            }
            if (!foundNew) break;
            if (pass > 0) debugInfo(`递归第 ${pass + 1} 轮: 新增条目`);
        }

        // Phase 4: Sort by order (higher = higher priority) and apply budget
        afterGroup.sort((a, b) => {
            if (a.constant !== b.constant) return a.constant ? -1 : 1;
            return (b.order || 0) - (a.order || 0);
        });

        const budget = Math.max(500, Number(store.lorebookBudget) || 8000);
        let totalLen = 0;
        const budgeted = afterGroup.filter(entry => {
            const len = (entry.content || '').length;
            if (totalLen + len > budget) return false;
            totalLen += len;
            return true;
        });

        debugInfo(`世界书匹配: ${afterGroup.length} 条激活, ${budgeted.length} 条入选 (预算 ${totalLen}/${budget} 字符)`);
        return budgeted;
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
                        center: String(char?.center || 'C3').trim().toUpperCase(),
                        uc: String(char?.uc || '').trim(),
                        _rawName: name,
                        _rawAction: action
                    };
                }).filter((char) => char.caption || char._rawName) : [];

                const charPrompts = characters.map(c => c.caption).filter(Boolean).join(' AND ');
                const finalPromptFallback = [scene, standalone, charPrompts].filter(Boolean).join(', ');

                return {
                    anchor,
                    label: String(item?.label || '').trim(),
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

    /* ── NAI V4 coordinate grid (A-E × 1-5 → 0.0-1.0) ── */
    const SDT_COL_MAP = { A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
    const SDT_ROW_MAP = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };
    function sdtParseCoord(coordStr) {
        const s = (coordStr || '').trim().toUpperCase();
        const col = s.charAt(0), row = s.charAt(1);
        if (SDT_COL_MAP[col] != null && SDT_ROW_MAP[row] != null) return { x: SDT_COL_MAP[col], y: SDT_ROW_MAP[row] };
        return { x: 0.5, y: 0.5 };
    }

    function getFinalPrompt(obj) {
        if (!obj) return '';

        // Multi-char: base prompt = scene only; characters go via NAI V4 char_captions hook
        if (getStore().multiCharOutput && Array.isArray(obj.characters) && obj.characters.length > 0) {
            const scene = obj.scene || '';
            const standalone = obj.standalone_prompt || '';
            return [scene, standalone].filter(Boolean).join(', ');
        }

        if (obj.prompt) return obj.prompt;

        const chars = Array.isArray(obj.characters) ? obj.characters.map(c => c.caption || [c._rawName, c._rawAction].filter(Boolean).join(', ')).join(', ') : '';
        const scene = obj.scene || '';
        const standalone = obj.standalone_prompt || '';

        return [scene, standalone, chars].filter(Boolean).join(', ');
    }

    /** Prepare structured char data for the NAI V4 payload hook */
    function prepareNaiCharData(segmentResult) {
        if (!segmentResult || !Array.isArray(segmentResult.characters) || segmentResult.characters.length === 0) {
            pendingNaiCharData = null;
            return;
        }
        pendingNaiCharData = {
            characters: segmentResult.characters.map(c => ({
                caption: c.caption || [c._rawName, c._rawAction].filter(Boolean).join(', '),
                center: c.center || 'C3',
                uc: c.uc || '',
            })),
        };
    }

    /* ── NAI V4 payload hook: inject char_captions directly ── */
    RBQ.on('buildNaiV4Payload', (payload) => {
        if (!pendingNaiCharData || !getStore().multiCharOutput) return payload;
        const { characters } = pendingNaiCharData;
        if (!characters.length) return payload;

        const charCaptions = characters.map(c => ({
            char_caption: c.caption,
            centers: [sdtParseCoord(c.center)],
        }));
        const negCharCaptions = characters.map(c => ({
            char_caption: c.uc || '',
            centers: [sdtParseCoord(c.center)],
        }));

        const existingNegBase = payload.parameters?.v4_negative_prompt?.caption?.base_caption
            || payload.parameters?.negative_prompt || '';

        payload.parameters.v4_prompt = {
            caption: { base_caption: payload.input, char_captions: charCaptions },
            use_coords: true,
            use_order: true,
            legacy_uc: false,
        };
        payload.parameters.v4_negative_prompt = {
            caption: { base_caption: existingNegBase, char_captions: negCharCaptions },
            use_coords: false,
            use_order: false,
            legacy_uc: false,
        };

        debugInfo(`NAI V4 多角色直注: ${characters.length} 个角色, base="${payload.input.slice(0, 60)}..."`);
        pendingNaiCharData = null; // consume
        return payload;
    });

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
        if (!a || !b || a.length < 4) return false;
        // 1. Exact substring (best case)
        if (b.includes(a) || a.includes(b)) return true;
        // 2. Fuzzy: 70% of anchor chars appear consecutively in nodeText
        const minOverlap = Math.max(4, Math.floor(a.length * 0.7));
        for (let i = 0; i <= a.length - minOverlap; i++) {
            if (b.includes(a.slice(i, i + minOverlap))) return true;
        }
        return false;
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

            lorebook: lorebook.map(l => ({ name: l.comment || l.sourceName || '角色/设定', keys: l.matchedKeys, tags: String(l.content || '').trim() })),
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
        // Store structured char data for NAI V4 direct injection on manual generate
        if (Array.isArray(result?.characters) && result.characters.length > 0) {
            try { wrapper.dataset.rbqSdtCharData = JSON.stringify(result.characters); } catch { /* noop */ }
        }

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

    /** Generate a short Chinese label for a segment's generate button */
    function getSegmentLabel(seg, prefix = '🎨') {
        if (!seg) return `${prefix} 生成图片`;
        // 1. LLM 输出的 label 字段（首选）
        if (seg.label) return `${prefix} ${seg.label}`;
        // 2. 角色名拼接
        if (Array.isArray(seg.characters) && seg.characters.length > 0) {
            const names = seg.characters.map(c => c._rawName).filter(Boolean);
            if (names.length) return `${prefix} ${names.join('·')}`;
        }
        // 3. reason
        if (seg.reason) {
            const r = String(seg.reason).trim();
            return `${prefix} ${r.length > 12 ? r.slice(0, 11) + '…' : r}`;
        }
        return `${prefix} 生成图片`;
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
            // Restore structured char data for NAI V4 hook
            const charDataJson = wrapper?.dataset?.rbqSdtCharData;
            if (charDataJson) {
                try {
                    const chars = JSON.parse(charDataJson);
                    prepareNaiCharData({ characters: chars });
                } catch { /* noop */ }
            }
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
            prepareNaiCharData(result);
            const finalPrompt = getFinalPrompt(result);
            const image = await RBQ.api.generateImage(finalPrompt, 'smart-draw-trigger', { messageId }, (progressText) => {
                const sub = wrapper.querySelector('.st-scene-trigger-nai-loader-sub');
                if (sub instanceof HTMLElement) sub.textContent = progressText;
            });
            RBQ.api.renderInlineGeneratedImage(wrapper, image);
            markSegmentAutoGenerated(baseKey, segmentKey);
            setGenerateButtonState(wrapper, true, getSegmentLabel(result, '🔄'), false);
            setWrapperStage(wrapper, 'generated');
        } catch (error) {
            toastr.error(error.message || String(error), PLUGIN_NAME);
            setGenerateButtonState(wrapper, true, getSegmentLabel(result), false);
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
                const btnLabel = store.autoRunTagger && RBQ.api.shouldAutoGenerate() ? '等待自动生图...' : getSegmentLabel(item.segment);
                setGenerateButtonState(renderedWrapper, true, btnLabel, false);
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
                const btnLabel2 = store.autoRunTagger && RBQ.api.shouldAutoGenerate() ? '等待自动生图...' : getSegmentLabel(item.segment);
                setGenerateButtonState(wrapper, true, btnLabel2, false);
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
            anchor: { type: 'bottom' },
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
        ensureTaggerButtonState(wrapper, store.autoRunTagger ? '解析中...' : '📷 开始解析/生成 tag');
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
                <div id="rbq-sdt-lorebook-field" class="st-scene-trigger-field switch"><span>启用世界书兼容层</span><span class="st-scene-trigger-toggle"><input id="rbq-sdt-lorebook-enabled" type="checkbox"><span class="st-scene-trigger-toggle-ui"></span></span></div>
                <label class="st-scene-trigger-field"><span>世界书扫描深度</span><input id="rbq-sdt-lorebook-depth" type="number" min="1" max="50" step="1"></label>
                <label class="st-scene-trigger-field"><span>世界书注入预算（字符）</span><input id="rbq-sdt-lorebook-budget" type="number" min="500" max="50000" step="500"></label>
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
        document.getElementById('rbq-sdt-lorebook-enabled').checked = !!store.lorebookEnabled;
        document.getElementById('rbq-sdt-lorebook-depth').value = store.lorebookContextDepth;
        document.getElementById('rbq-sdt-lorebook-budget').value = store.lorebookBudget || 8000;
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
            s.lorebookEnabled = checked('rbq-sdt-lorebook-enabled');
            s.lorebookContextDepth = Math.max(1, Math.min(50, Number(val('rbq-sdt-lorebook-depth')) || 5));
            s.lorebookBudget = Math.max(500, Math.min(50000, Number(val('rbq-sdt-lorebook-budget')) || 8000));
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
