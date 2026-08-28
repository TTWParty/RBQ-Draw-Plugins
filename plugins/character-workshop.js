(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Character Workshop] RBQ Core API missing');

    const PLUGIN_NAME = '角色工坊 (Character Workshop)';
    const STORAGE_KEY = '_characterWorkshop';
    const SDT_STORAGE_KEY = '_smartDrawTrigger';

    // ── Helper Utilities ─────────────────────────────────────
    function uid(prefix = 'cw') {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY] || typeof s[STORAGE_KEY] !== 'object') {
            s[STORAGE_KEY] = {
                enabled: true,
                characters: {},
                presets: [],
                activeComposer: {
                    scene: 'indoors, cozy room, warm_lighting, soft_light',
                    camera: 'looking_at_viewer',
                    atmosphere: '',
                    slots: [
                        { charId: '', customName: '主角', outfitMode: 'current', customOutfit: '', action: 'standing, smiling', center: 'B3', uc: '' },
                        { charId: '', customName: '女主角', outfitMode: 'current', customOutfit: '', action: 'sitting, looking_at_viewer', center: 'D3', uc: '' }
                    ]
                }
            };
        }
        const store = s[STORAGE_KEY];
        if (!store.characters || typeof store.characters !== 'object') store.characters = {};
        if (!Array.isArray(store.presets)) store.presets = [];
        if (!store.activeComposer || typeof store.activeComposer !== 'object') {
            store.activeComposer = {
                scene: '',
                camera: 'looking_at_viewer',
                atmosphere: '',
                slots: [
                    { charId: '', customName: '角色 1', outfitMode: 'current', customOutfit: '', action: '', center: 'B3', uc: '' },
                    { charId: '', customName: '角色 2', outfitMode: 'current', customOutfit: '', action: '', center: 'D3', uc: '' }
                ]
            };
        }
        return store;
    }

    function save() {
        RBQ.api.saveSettings();
    }

    // ── Coordinate Mapping (NAI V4.5 centers) ────────────────
    const COL_MAP = { A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
    const ROW_MAP = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };
    const COORD_LABELS = {
        A1: '左上远景', B1: '偏左远景', C1: '居中远景', D1: '偏右远景', E1: '右上远景',
        A2: '左上中景', B2: '偏左中景', C2: '居中中景', D2: '偏右中景', E2: '右上中景',
        A3: '左侧居中', B3: '偏左居中', C3: '画面正中', D3: '偏右居中', E3: '右侧居中',
        A4: '左下近景', B4: '偏左近景', C4: '居中近景', D4: '偏右近景', E4: '右下近景',
        A5: '左下特写', B5: '偏左特写', C5: '居中特写', D5: '偏右特写', E5: '右下特写',
    };

    function formatCoordLabel(coordStr) {
        const c = String(coordStr || 'C3').toUpperCase().trim();
        return COORD_LABELS[c] ? `${c} (${COORD_LABELS[c]})` : c;
    }

    // ── Worldbook Integration (读取已导入世界书) ──────────────
    const CATEGORY_GROUPS = {
        '外貌特征': ['外貌特征', '发型', '发色', '瞳色', '脸部', '面部', '耳朵', '身材', '种族', '饰品', '发饰', '体型', '胸部', '肤色', '眼睛', '表情', '头部', '特征', '外貌', '发', '瞳', '耳'],
        '服装': ['服装', '穿搭', '常服', '泳装', '制服', '下装', '上装', '鞋袜', '内衣', '饰品', '首饰', '帽子', '套装', '情趣', '衣服', '着装'],
        '动作体位': ['动作体位', '动作', '姿势', '体位', '互动', '手部动作', '腿部动作', 'SEX模板', '常规模板', '双人体位', '单人动作', '体位模板'],
        '场景环境': ['场景环境', '场景', '背景', '地点', '室内', '室外', '光影', '天气', '构图', '视角', '氛围', '环境']
    };

    function isCategoryInGroup(cat, groupName) {
        if (!cat || !groupName) return false;
        if (cat === groupName) return true;
        const members = CATEGORY_GROUPS[groupName] || [];
        return members.some(m => cat.includes(m) || m.includes(cat));
    }

    function getAllAvailableWorldbookEntries() {
        const s = RBQ.api.getSettings();
        const sdtStore = s[SDT_STORAGE_KEY];
        const cwStore = s[STORAGE_KEY];
        const sdtSources = Array.isArray(sdtStore?.lorebookSources) ? sdtStore.lorebookSources : [];
        const cwSources = Array.isArray(cwStore?.lorebookSources) ? cwStore.lorebookSources : [];
        const combinedSources = [...sdtSources, ...cwSources];
        const allEntries = [];
        const seenKeys = new Set();

        // 1. Read from Plugin Lorebook Stores
        for (const src of combinedSources) {
            if (src && src.enabled !== false && src.rawJson) {
                try {
                    const parsed = JSON.parse(src.rawJson);
                    const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
                    for (const [uidKey, e] of Object.entries(entries)) {
                        if (!e || e.disabled || !e.content) continue;
                        const keyId = `${src.name || 'WB'}:${e.uid ?? uidKey}`;
                        if (seenKeys.has(keyId)) continue;
                        seenKeys.add(keyId);

                        allEntries.push({
                            sourceId: src.id || 'wb-src',
                            sourceName: src.name || '世界书',
                            uid: e.uid ?? uidKey,
                            comment: String(e.comment || ''),
                            content: String(e.content || '').trim(),
                            key: Array.isArray(e.key) ? e.key : (typeof e.key === 'string' ? e.key.split(',') : []),
                            category: extractLorebookCategory(e.comment || src.name || '综合')
                        });
                    }
                } catch (_err) { /* ignore parse error */ }
            }
        }

        // 2. Read from SillyTavern Native World Info / Character Attached Books
        try {
            const ctx = RBQ.api.getContext?.();
            const charBook = ctx?.character?.data?.character_book?.entries || ctx?.characters?.[ctx?.characterId]?.data?.character_book?.entries;
            if (Array.isArray(charBook)) {
                for (const e of charBook) {
                    if (!e || !e.content) continue;
                    const keyId = `ST_CharBook:${e.id ?? e.comment}`;
                    if (seenKeys.has(keyId)) continue;
                    seenKeys.add(keyId);
                    allEntries.push({
                        sourceId: 'st-char-book',
                        sourceName: '角色卡内置世界书',
                        uid: e.id || uid('st-cb'),
                        comment: String(e.comment || ''),
                        content: String(e.content || '').trim(),
                        key: Array.isArray(e.keys) ? e.keys : (Array.isArray(e.key) ? e.key : []),
                        category: extractLorebookCategory(e.comment || '角色卡内置世界书')
                    });
                }
            }
        } catch (_stErr) { /* ignore */ }

        return allEntries;
    }

    function extractLorebookCategory(comment) {
        if (!comment) return '综合';
        const c = comment.trim();
        const bracketMatch = c.match(/^\[([^\]]+)\]/);
        if (bracketMatch) return bracketMatch[1].trim();
        const prefixMatch = c.match(/^[\*#\s]*([^\-\—\－\:\：\s\(\)\[\]]{2,8})[\-\—\－\:\：]/);
        if (prefixMatch) return prefixMatch[1].trim();
        if (c.includes('服装') || c.includes('穿搭') || c.includes('常服') || c.includes('泳装') || c.includes('制服') || c.includes('裙') || c.includes('装')) return '服装';
        if (c.includes('发型') || c.includes('发色') || c.includes('发') || c.includes('瞳') || c.includes('脸') || c.includes('耳') || c.includes('身材') || c.includes('胸') || c.includes('外貌') || c.includes('种族')) return '外貌特征';
        if (c.includes('体位') || c.includes('动作') || c.includes('姿势') || c.includes('互动') || c.includes('sex') || c.includes('Sex') || c.includes('SEX')) return '动作体位';
        if (c.includes('场景') || c.includes('背景') || c.includes('地点') || c.includes('室内') || c.includes('室外') || c.includes('光影')) return '场景环境';
        return '综合';
    }

    function extractLorebookSubVariants(content) {
        if (!content) return [];
        const normalized = content.replace(/[\ufeff\u200b\u200c\u200d]/g, '').trim();
        const lines = normalized.split(/\r?\n/);
        const variants = [];
        let currentTitle = '';
        let currentTags = [];

        function isTagLine(line) {
            if (/\d+(\.\d+)?::/.test(line) || /-\d+::/.test(line)) return true;
            if ((line.match(/,/g) || []).length >= 2) return true;
            const eng = (line.match(/[a-zA-Z_]/g) || []).length;
            const ch = (line.match(/[\u4e00-\u9fa5]/g) || []).length;
            if (eng > 10 && ch === 0) return true;
            return false;
        }

        for (let rawLine of lines) {
            let line = rawLine.trim();
            if (!line) continue;
            if (/^#+\s+[\u4e00-\u9fa5a-zA-Z0-9_\-]+$/.test(line) && !currentTitle && !variants.length) continue;

            const chineseCount = (line.match(/[\u4e00-\u9fa5]/g) || []).length;
            const englishCount = (line.match(/[a-zA-Z]/g) || []).length;
            const isTag = isTagLine(line);

            let isHeader = false;
            if (!isTag) {
                if (line.startsWith('##') || line.startsWith('###')) {
                    isHeader = true;
                } else if (/^[【\[（\(][^】\]）\)]+[】\]）\)]/.test(line) && chineseCount >= 2) {
                    isHeader = true;
                } else if (/^(\d+[\.\、\s]|[-*]\s+)[^\d]/i.test(line) && (chineseCount >= 2 || englishCount < 10)) {
                    isHeader = true;
                } else if (/^(默认\d*|变体\d*|机位\d*|视角\d*|版本\d*|服装\d*|姿势\d*|动作\d*|Char\d*)/i.test(line)) {
                    isHeader = true;
                } else if (chineseCount >= 2 && englishCount <= 6 && !line.includes(',')) {
                    isHeader = true;
                } else if (/^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+[：:]$/.test(line)) {
                    isHeader = true;
                }
            }

            if (isHeader) {
                if (currentTitle && currentTags.length > 0) {
                    variants.push({ title: currentTitle, tags: currentTags.join(', ').trim() });
                }
                currentTitle = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').replace(/[:：]$/, '').trim();
                currentTags = [];
            } else {
                if (!currentTitle) currentTitle = '默认变体';
                currentTags.push(line.replace(/^[-*]\s*/, ''));
            }
        }
        if (currentTitle && currentTags.length > 0) {
            variants.push({ title: currentTitle, tags: currentTags.join(', ').trim() });
        }
        return variants.length > 0 ? variants : [{ title: '默认', tags: content.trim() }];
    }

    // ── Worldbook Visual Tag Picker Modal ─────────────────────
    function openWorldbookPickerModal(options = {}, onSelectCallback) {
        const modal = document.createElement('div');
        modal.id = 'rbq-cw-worldbook-picker-modal';
        modal.style.cssText = `
            position: fixed !important; inset: 0 !important; z-index: 100000020 !important;
            background: rgba(0,0,0,0.85) !important; display: flex !important;
            align-items: center !important; justify-content: center !important;
            padding: 16px !important; box-sizing: border-box !important;
            backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
        `;

        const allEntries = getAllAvailableWorldbookEntries();
        const categories = Array.from(new Set(allEntries.map(e => e.category))).filter(Boolean);
        let currentCat = options.defaultCategory || 'all';
        let searchQuery = options.initialSearch || '';

        function renderContent() {
            const filtered = allEntries.filter(e => {
                if (currentCat !== 'all' && e.category !== currentCat && !isCategoryInGroup(e.category, currentCat)) return false;
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (e.comment && e.comment.toLowerCase().includes(q))
                    || (e.content && e.content.toLowerCase().includes(q))
                    || (e.sourceName && e.sourceName.toLowerCase().includes(q))
                    || (e.key && e.key.some(k => String(k).toLowerCase().includes(q)));
            });

            return `
                <div style="background: #18191f !important; border: 1px solid rgba(121,228,255,0.3) !important; border-radius: 14px !important; width: 680px !important; max-width: 95vw !important; max-height: 90vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 20px 60px rgba(0,0,0,0.9) !important; box-sizing: border-box !important;">
                    <div style="display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 14px 18px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; background: rgba(121,228,255,0.06) !important;">
                        <strong style="font-size: 15px !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 8px !important;">
                            <i class="fa-solid fa-book-open"></i> ${options.title || '从世界书选择词条'}
                        </strong>
                        <div style="display: flex !important; align-items: center !important; gap: 8px !important;">
                            <label class="menu_button" style="padding: 2px 10px !important; font-size: 11px !important; margin: 0 !important; cursor: pointer !important; background: rgba(100,255,100,0.18) !important; color: #a3ffa3 !important; border: 1px solid rgba(100,255,100,0.35) !important; display: inline-flex !important; align-items: center !important; gap: 4px !important;">
                                <i class="fa-solid fa-file-arrow-up"></i> 导入世界书 (.json)
                                <input type="file" id="rbq-cw-wb-file-input" accept=".json" style="display: none !important;" />
                            </label>
                            <button class="menu_button" id="rbq-cw-wb-close" style="padding: 2px 8px !important; margin: 0 !important; font-size: 13px !important; cursor: pointer !important;">✕</button>
                        </div>
                    </div>

                    <div style="padding: 12px 18px !important; border-bottom: 1px solid rgba(255,255,255,0.06) !important; display: flex !important; flex-direction: column !important; gap: 10px !important; background: rgba(0,0,0,0.2) !important;">
                        <div style="display: flex !important; gap: 8px !important;">
                            <input id="rbq-cw-wb-search" type="text" placeholder="搜索世界书词条 / 中英文 Tag / 触发词..." value="${escapeHtml(searchQuery)}" style="flex: 1 !important; height: 34px !important; padding: 6px 12px !important; font-size: 12px !important; background: rgba(0,0,0,0.4) !important; border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 6px !important; color: #fff !important;" />
                        </div>
                        <div style="display: flex !important; gap: 6px !important; overflow-x: auto !important; padding-bottom: 4px !important;">
                            <button class="menu_button rbq-cw-cat-btn ${currentCat === 'all' ? 'active' : ''}" data-cat="all" style="padding: 3px 10px !important; font-size: 11px !important; white-space: nowrap !important; ${currentCat === 'all' ? 'background: rgba(121,228,255,0.25) !important; color: #79e4ff !important; border: 1px solid rgba(121,228,255,0.4) !important;' : ''}">全部 (${allEntries.length})</button>
                            ${Object.keys(CATEGORY_GROUPS).map(grp => {
                                const count = allEntries.filter(e => isCategoryInGroup(e.category, grp)).length;
                                if (count === 0) return '';
                                const isActive = currentCat === grp;
                                return `<button class="menu_button rbq-cw-cat-btn ${isActive ? 'active' : ''}" data-cat="${escapeHtml(grp)}" style="padding: 3px 10px !important; font-size: 11px !important; white-space: nowrap !important; font-weight: bold !important; ${isActive ? 'background: rgba(121,228,255,0.25) !important; color: #79e4ff !important; border: 1px solid rgba(121,228,255,0.4) !important;' : 'background: rgba(255,255,255,0.05) !important;'};">📁 ${escapeHtml(grp)} (${count})</button>`;
                            }).join('')}
                            ${categories.filter(c => !Object.keys(CATEGORY_GROUPS).includes(c)).map(cat => {
                                const count = allEntries.filter(e => e.category === cat).length;
                                const isActive = currentCat === cat;
                                return `<button class="menu_button rbq-cw-cat-btn ${isActive ? 'active' : ''}" data-cat="${escapeHtml(cat)}" style="padding: 3px 10px !important; font-size: 11px !important; white-space: nowrap !important; ${isActive ? 'background: rgba(121,228,255,0.25) !important; color: #79e4ff !important; border: 1px solid rgba(121,228,255,0.4) !important;' : ''}">${escapeHtml(cat)} (${count})</button>`;
                            }).join('')}
                        </div>
                    </div>

                    <div id="rbq-cw-wb-list" style="padding: 14px 18px !important; overflow-y: auto !important; flex: 1 !important; display: flex !important; flex-direction: column !important; gap: 10px !important;">
                        ${filtered.length === 0 ? `
                            <div style="text-align: center !important; opacity: 0.5 !important; padding: 30px !important; font-size: 13px !important;">暂未找到匹配的世界书词条</div>
                        ` : filtered.slice(0, 100).map((e, idx) => {
                            const subVariants = extractLorebookSubVariants(e.content);
                            const hasMultiple = subVariants.length > 1;
                            return `
                                <div style="background: rgba(255,255,255,0.025) !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 8px !important; padding: 10px 12px !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 8px !important; flex-wrap: wrap !important;">
                                        <div style="display: flex !important; align-items: center !important; gap: 6px !important; flex-wrap: wrap !important;">
                                            <strong style="font-size: 13px !important; color: #79e4ff !important;">📌 ${escapeHtml(e.comment || '未命名词条')}</strong>
                                            <span style="font-size: 10px !important; background: rgba(255,255,255,0.08) !important; color: rgba(255,255,255,0.7) !important; padding: 1px 5px !important; border-radius: 4px !important;">${escapeHtml(e.sourceName)}</span>
                                            <span style="font-size: 10px !important; background: rgba(121,228,255,0.12) !important; color: #79e4ff !important; padding: 1px 5px !important; border-radius: 4px !important;">${escapeHtml(e.category)}</span>
                                            ${hasMultiple ? `<span style="font-size: 10px !important; background: rgba(255,184,108,0.15) !important; color: #ffb86c !important; padding: 1px 5px !important; border-radius: 4px !important; font-weight: bold !important;">${subVariants.length} 种变体</span>` : ''}
                                        </div>
                                        <div style="display: flex !important; gap: 6px !important; align-items: center !important;">
                                            ${hasMultiple ? `
                                                <button class="menu_button rbq-cw-pick-multi-btn" data-index="${idx}" type="button" style="padding: 3px 10px !important; font-size: 11px !important; background: rgba(255,184,108,0.2) !important; color: #ffb86c !important; border: 1px solid rgba(255,184,108,0.4) !important; font-weight: bold !important; cursor: pointer !important;"><i class="fa-solid fa-list-check"></i> 挑选子变体</button>
                                            ` : `
                                                <button class="menu_button rbq-cw-pick-single-btn" data-index="${idx}" type="button" style="padding: 3px 12px !important; font-size: 11px !important; background: rgba(100,255,100,0.18) !important; color: #a3ffa3 !important; border: 1px solid rgba(100,255,100,0.35) !important; font-weight: bold !important; cursor: pointer !important;"><i class="fa-solid fa-check"></i> 选用</button>
                                            `}
                                        </div>
                                    </div>
                                    <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-family: monospace !important; max-height: 55px !important; overflow-y: auto !important; word-break: break-all !important; background: rgba(0,0,0,0.3) !important; padding: 4px 8px !important; border-radius: 4px !important;">${escapeHtml(e.content)}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        function updateList() {
            modal.innerHTML = renderContent();
            bindEvents();
        }

        function bindEvents() {
            modal.querySelector('#rbq-cw-wb-close')?.addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

            const fileInput = modal.querySelector('#rbq-cw-wb-file-input');
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        try {
                            const raw = JSON.parse(evt.target.result);
                            const name = file.name.replace(/\.json$/i, '');
                            const s = RBQ.api.getSettings();
                            if (!s[STORAGE_KEY]) s[STORAGE_KEY] = {};
                            if (!Array.isArray(s[STORAGE_KEY].lorebookSources)) s[STORAGE_KEY].lorebookSources = [];
                            s[STORAGE_KEY].lorebookSources.push({
                                id: uid('wb'),
                                name: name,
                                enabled: true,
                                rawJson: JSON.stringify(raw),
                                importedAt: Date.now()
                            });
                            save();
                            toastr.success(`世界书「${name}」导入成功！`, PLUGIN_NAME);
                            modal.remove();
                            openWorldbookPickerModal(options, onSelectCallback);
                        } catch (err) {
                            toastr.error(`世界书解析失败: ${err.message || err}`, PLUGIN_NAME);
                        }
                    };
                    reader.readAsText(file);
                });
            }

            const searchInput = modal.querySelector('#rbq-cw-wb-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    searchQuery = e.target.value;
                    const list = modal.querySelector('#rbq-cw-wb-list');
                    if (list) {
                        const filtered = allEntries.filter(entry => {
                            if (currentCat !== 'all' && entry.category !== currentCat) return false;
                            if (!searchQuery) return true;
                            const q = searchQuery.toLowerCase();
                            return (entry.comment && entry.comment.toLowerCase().includes(q))
                                || (entry.content && entry.content.toLowerCase().includes(q))
                                || (entry.sourceName && entry.sourceName.toLowerCase().includes(q))
                                || (entry.key && entry.key.some(k => String(k).toLowerCase().includes(q)));
                        });
                        list.innerHTML = filtered.length === 0 ? '<div style="text-align:center;opacity:.5;padding:30px;font-size:13px;">暂未找到匹配词条</div>' : filtered.slice(0, 100).map((e, idx) => {
                            const subVariants = extractLorebookSubVariants(e.content);
                            const hasMultiple = subVariants.length > 1;
                            return `
                                <div style="background: rgba(255,255,255,0.025) !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 8px !important; padding: 10px 12px !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 8px !important; flex-wrap: wrap !important;">
                                        <div style="display: flex !important; align-items: center !important; gap: 6px !important; flex-wrap: wrap !important;">
                                            <strong style="font-size: 13px !important; color: #79e4ff !important;">📌 ${escapeHtml(e.comment || '未命名词条')}</strong>
                                            <span style="font-size: 10px !important; background: rgba(255,255,255,0.08) !important; color: rgba(255,255,255,0.7) !important; padding: 1px 5px !important; border-radius: 4px !important;">${escapeHtml(e.sourceName)}</span>
                                            <span style="font-size: 10px !important; background: rgba(121,228,255,0.12) !important; color: #79e4ff !important; padding: 1px 5px !important; border-radius: 4px !important;">${escapeHtml(e.category)}</span>
                                            ${hasMultiple ? `<span style="font-size: 10px !important; background: rgba(255,184,108,0.15) !important; color: #ffb86c !important; padding: 1px 5px !important; border-radius: 4px !important; font-weight: bold !important;">${subVariants.length} 种变体</span>` : ''}
                                        </div>
                                        <div style="display: flex !important; gap: 6px !important; align-items: center !important;">
                                            ${hasMultiple ? `
                                                <button class="menu_button rbq-cw-pick-multi-btn" data-index="${idx}" type="button" style="padding: 3px 10px !important; font-size: 11px !important; background: rgba(255,184,108,0.2) !important; color: #ffb86c !important; border: 1px solid rgba(255,184,108,0.4) !important; font-weight: bold !important; cursor: pointer !important;"><i class="fa-solid fa-list-check"></i> 挑选子变体</button>
                                            ` : `
                                                <button class="menu_button rbq-cw-pick-single-btn" data-index="${idx}" type="button" style="padding: 3px 12px !important; font-size: 11px !important; background: rgba(100,255,100,0.18) !important; color: #a3ffa3 !important; border: 1px solid rgba(100,255,100,0.35) !important; font-weight: bold !important; cursor: pointer !important;"><i class="fa-solid fa-check"></i> 选用</button>
                                            `}
                                        </div>
                                    </div>
                                    <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-family: monospace !important; max-height: 55px !important; overflow-y: auto !important; word-break: break-all !important; background: rgba(0,0,0,0.3) !important; padding: 4px 8px !important; border-radius: 4px !important;">${escapeHtml(e.content)}</div>
                                </div>
                            `;
                        }).join('');
                        bindActionButtons(filtered);
                    }
                });
            }

            modal.querySelectorAll('.rbq-cw-cat-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentCat = btn.dataset.cat;
                    updateList();
                });
            });

            const currentFiltered = allEntries.filter(e => {
                if (currentCat !== 'all' && e.category !== currentCat) return false;
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (e.comment && e.comment.toLowerCase().includes(q))
                    || (e.content && e.content.toLowerCase().includes(q))
                    || (e.sourceName && e.sourceName.toLowerCase().includes(q));
            });
            bindActionButtons(currentFiltered);
        }

        function bindActionButtons(filteredList) {
            modal.querySelectorAll('.rbq-cw-pick-single-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const item = filteredList[idx];
                    if (item && typeof onSelectCallback === 'function') {
                        onSelectCallback({
                            title: item.comment,
                            tags: item.content.replace(/^[#\-\*\s]+[^:\n]+[:：]\s*/gm, '').replace(/\s*\/\s*/g, ', ').trim(),
                            raw: item
                        });
                        modal.remove();
                    }
                });
            });

            modal.querySelectorAll('.rbq-cw-pick-multi-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const item = filteredList[idx];
                    if (!item) return;
                    const subVariants = extractLorebookSubVariants(item.content);
                    openSubVariantSelectDialog(item.comment, subVariants, (selectedV) => {
                        if (typeof onSelectCallback === 'function') {
                            onSelectCallback({
                                title: `${item.comment} (${selectedV.title})`,
                                tags: selectedV.tags.replace(/\s*\/\s*/g, ', ').trim(),
                                raw: item
                            });
                            modal.remove();
                        }
                    });
                });
            });
        }

        function openSubVariantSelectDialog(entryTitle, variants, onSelect) {
            const subModal = document.createElement('div');
            subModal.style.cssText = `
                position: fixed !important; inset: 0 !important; z-index: 100000030 !important;
                background: rgba(0,0,0,0.85) !important; display: flex !important;
                align-items: center !important; justify-content: center !important; padding: 16px !important;
            `;
            subModal.innerHTML = `
                <div style="background: #202128 !important; border: 1px solid rgba(255,184,108,0.4) !important; border-radius: 12px !important; width: 540px !important; max-width: 95vw !important; max-height: 80vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 15px 50px rgba(0,0,0,0.9) !important;">
                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 12px 16px !important; background: rgba(255,184,108,0.08) !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important;">
                        <strong style="color: #ffb86c !important; font-size: 14px !important;">📌 挑选子变体 — ${escapeHtml(entryTitle)}</strong>
                        <button class="menu_button" id="rbq-cw-subv-close" style="padding: 2px 8px !important; font-size: 12px !important;">✕</button>
                    </div>
                    <div style="padding: 14px 16px !important; overflow-y: auto !important; display: flex !important; flex-direction: column !important; gap: 8px !important;">
                        ${variants.map((v, vIdx) => `
                            <div style="background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 8px !important; padding: 10px !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                                <div style="display: flex !important; justify-content: space-between !important; align-items: center !important;">
                                    <strong style="color: #fff !important; font-size: 13px !important;">#${vIdx + 1} ${escapeHtml(v.title)}</strong>
                                    <button class="menu_button rbq-cw-pick-v-btn" data-vidx="${vIdx}" type="button" style="padding: 3px 10px !important; font-size: 11px !important; background: rgba(100,255,100,0.2) !important; color: #a3ffa3 !important; border: 1px solid rgba(100,255,100,0.35) !important; font-weight: bold !important; cursor: pointer !important;">选用此变体</button>
                                </div>
                                <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-family: monospace !important; background: rgba(0,0,0,0.3) !important; padding: 4px 8px !important; border-radius: 4px !important;">${escapeHtml(v.tags)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            subModal.querySelector('#rbq-cw-subv-close')?.addEventListener('click', () => subModal.remove());
            subModal.addEventListener('click', (e) => { if (e.target === subModal) subModal.remove(); });
            subModal.querySelectorAll('.rbq-cw-pick-v-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const vIdx = Number(btn.dataset.vidx);
                    const chosen = variants[vIdx];
                    if (chosen && typeof onSelect === 'function') {
                        onSelect(chosen);
                        subModal.remove();
                    }
                });
            });
            document.body.appendChild(subModal);
        }

        modal.innerHTML = renderContent();
        document.body.appendChild(modal);
        bindEvents();
    }

    // ── Pre-defined Danbooru Trait Presets (可视化点选词库) ────
    const BASE_TRAIT_PRESETS = [
        {
            group: '🌟 基础',
            tags: [
                { name: '女性 (1girl)', tag: '1girl' },
                { name: '男性 (1boy)', tag: '1boy' },
                { name: '单人 (solo)', tag: 'solo' },
                { name: '美少女', tag: 'bishoujo' },
                { name: '萝莉', tag: 'loli' },
                { name: '御姐', tag: 'mature female' }
            ]
        },
        {
            group: '💇 发色',
            tags: [
                { name: '银发', tag: 'silver hair' },
                { name: '金发', tag: 'blonde hair' },
                { name: '黑发', tag: 'black hair' },
                { name: '粉发', tag: 'pink hair' },
                { name: '蓝发', tag: 'blue hair' },
                { name: '白发', tag: 'white hair' },
                { name: '紫发', tag: 'purple hair' },
                { name: '棕发', tag: 'brown hair' },
                { name: '红发', tag: 'red hair' },
                { name: '渐变发', tag: 'two-tone hair' },
                { name: '挑染', tag: 'streaked hair' }
            ]
        },
        {
            group: '💇 发型',
            tags: [
                { name: '双马尾', tag: 'twintails' },
                { name: '长发', tag: 'long hair' },
                { name: '短发', tag: 'short hair' },
                { name: '单马尾', tag: 'ponytail' },
                { name: '侧马尾', tag: 'side ponytail' },
                { name: '姬发式', tag: 'hime cut' },
                { name: '波波头', tag: 'bob cut' },
                { name: '麻花辫', tag: 'braid' },
                { name: '波浪卷', tag: 'wavy hair' },
                { name: '齐刘海', tag: 'blunt bangs' },
                { name: '呆毛', tag: 'ahoge' },
                { name: '碎发', tag: 'messy hair' }
            ]
        },
        {
            group: '👁️ 瞳色/面部',
            tags: [
                { name: '红瞳', tag: 'red eyes' },
                { name: '蓝瞳', tag: 'blue eyes' },
                { name: '金瞳', tag: 'golden eyes' },
                { name: '绿瞳', tag: 'green eyes' },
                { name: '紫瞳', tag: 'purple eyes' },
                { name: '粉瞳', tag: 'pink eyes' },
                { name: '异色瞳', tag: 'heterochromia' },
                { name: '心形瞳', tag: 'heart-shaped pupils' },
                { name: '泪痣', tag: 'mole under eye' },
                { name: '脸红', tag: 'blush' },
                { name: '小虎牙', tag: 'fangs' },
                { name: '猫嘴', tag: ':3' }
            ]
        },
        {
            group: '🐾 种族/特征',
            tags: [
                { name: '精灵耳', tag: 'pointy ears' },
                { name: '猫耳', tag: 'cat ears' },
                { name: '狐狸耳', tag: 'fox ears' },
                { name: '兔耳', tag: 'rabbit ears' },
                { name: '恶魔角', tag: 'horns' },
                { name: '天使光环', tag: 'halo' },
                { name: '猫尾巴', tag: 'cat tail' },
                { name: '恶魔尾', tag: 'demon tail' },
                { name: '翅膀', tag: 'wings' }
            ]
        },
        {
            group: '👙 身材体型',
            tags: [
                { name: '巨乳', tag: 'large breasts' },
                { name: '中乳', tag: 'medium breasts' },
                { name: '贫乳', tag: 'flat chest' },
                { name: '超大胸部', tag: 'huge breasts' },
                { name: '修长纤细', tag: 'slender' },
                { name: '娇小', tag: 'petite' },
                { name: '丰满S曲线', tag: 'curvy' },
                { name: '宽臀', tag: 'wide hips' },
                { name: '白皙皮肤', tag: 'pale skin' },
                { name: '小麦肤色', tag: 'tan' }
            ]
        },
        {
            group: '🎀 固定饰品',
            tags: [
                { name: '眼镜', tag: 'glasses' },
                { name: '发带/蝴蝶结', tag: 'hair ribbon' },
                { name: '发饰/发卡', tag: 'hair ornament' },
                { name: '项圈', tag: 'choker' },
                { name: '耳环', tag: 'earrings' },
                { name: '十字架项链', tag: 'cross necklace' },
                { name: '单眼罩', tag: 'eyepatch' }
            ]
        }
    ];

    const OUTFIT_TRAIT_PRESETS = [
        {
            group: '👗 常见服装',
            tags: [
                { name: '水手服', tag: 'sailor suit, pleated skirt' },
                { name: '西装校服', tag: 'school uniform, blazer, necktie' },
                { name: '女仆装', tag: 'maid outfit, frilled apron, maid headdress' },
                { name: '兔女郎', tag: 'bunny suit, bunny ears, fishnet pantyhose' },
                { name: '修女袍', tag: 'nun habit, veil, long dress, cross necklace' },
                { name: '哥特裙', tag: 'gothic dress, black lace, frills, ribbon' },
                { name: '比基尼', tag: 'bikini, side-tie bikini bottom' },
                { name: '死库水', tag: 'school swimsuit' },
                { name: '日常卫衣', tag: 'casual clothes, hoodie, short shorts' },
                { name: '露肩毛衣', tag: 'off-shoulder sweater, knit sweater' },
                { name: '晚礼服', tag: 'evening gown, elegant dress, bare shoulders' },
                { name: '旗袍', tag: 'china dress, cheongsam, high slit' },
                { name: '和服/浴衣', tag: 'kimono, floral print, obi' }
            ]
        },
        {
            group: '🧦 鞋袜配饰',
            tags: [
                { name: '白丝过膝袜', tag: 'white thighhighs' },
                { name: '黑丝过膝袜', tag: 'black thighhighs' },
                { name: '透肉黑丝', tag: 'sheer black pantyhose' },
                { name: '渔网袜', tag: 'fishnet stockings' },
                { name: '吊带袜', tag: 'garter straps, thighhighs' },
                { name: '高跟鞋', tag: 'high heels' },
                { name: '乐福鞋', tag: 'loafers' },
                { name: '长筒靴', tag: 'boots' }
            ]
        }
    ];

    function appendOrToggleTag(currentText, newTag) {
        if (!currentText) return newTag;
        const list = currentText.split(',').map(s => s.trim()).filter(Boolean);
        const exists = list.some(item => item.toLowerCase() === newTag.toLowerCase());
        if (exists) {
            return list.filter(item => item.toLowerCase() !== newTag.toLowerCase()).join(', ');
        } else {
            return [...list, newTag].join(', ');
        }
    }

    // ── Character Creator Modal (角色创建/编辑) ───────────────
    function openCharacterEditorModal(charId = null, onSaved) {
        const store = getStore();
        const isEdit = !!(charId && store.characters[charId]);
        const char = isEdit ? { ...store.characters[charId] } : {
            id: uid('char'),
            name: '',
            avatarUrl: '',
            baseTags: '',
            currentOutfit: '',
            wardrobe: []
        };

        const modal = document.createElement('div');
        modal.id = 'rbq-cw-char-editor-modal';
        modal.style.cssText = `
            position: fixed !important; inset: 0 !important; z-index: 100000015 !important;
            background: rgba(0,0,0,0.85) !important; display: flex !important;
            align-items: center !important; justify-content: center !important;
            padding: 16px !important; box-sizing: border-box !important;
            backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important;
        `;

        modal.innerHTML = `
            <div style="background: #1c1d22 !important; border: 1px solid rgba(121,228,255,0.3) !important; border-radius: 14px !important; width: 680px !important; max-width: 95vw !important; max-height: 94vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 20px 60px rgba(0,0,0,0.9) !important; box-sizing: border-box !important;">
                <div style="display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 14px 18px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; background: rgba(121,228,255,0.06) !important;">
                    <strong style="font-size: 15px !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 8px !important;">
                        <i class="fa-solid fa-user-plus"></i> ${isEdit ? `编辑角色档案 — 「${escapeHtml(char.name || '未命名')}」` : '✨ 拼装创造新角色'}
                    </strong>
                    <button class="menu_button" id="rbq-cw-ce-close" style="padding: 2px 8px !important; margin: 0 !important; font-size: 13px !important; cursor: pointer !important;">✕</button>
                </div>

                <div style="padding: 16px 18px !important; overflow-y: auto !important; display: flex !important; flex-direction: column !important; gap: 14px !important;">
                    <!-- Basic Info -->
                    <div style="display: flex !important; gap: 12px !important; align-items: center !important;">
                        <div style="display: flex !important; flex-direction: column !important; align-items: center !important; gap: 6px !important;">
                            <div id="rbq-cw-avatar-preview" style="width: 58px !important; height: 58px !important; border-radius: 10px !important; background: rgba(255,255,255,0.05) !important; border: 1px solid rgba(255,255,255,0.15) !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: 24px !important; overflow: hidden !important;">
                                ${char.avatarUrl ? `<img src="${escapeHtml(char.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;" />` : '👤'}
                            </div>
                        </div>
                        <div style="flex: 1 !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                            <div style="display: flex !important; gap: 8px !important;">
                                <input id="rbq-cw-char-name" type="text" placeholder="角色姓名 (例如: 爱丽丝 / Kato (original))" value="${escapeHtml(char.name)}" style="flex: 1 !important; height: 32px !important; padding: 4px 10px !important; font-size: 13px !important; font-weight: bold !important; background: rgba(0,0,0,0.4) !important; border: 1px solid rgba(121,228,255,0.3) !important; border-radius: 6px !important; color: #fff !important;" />
                            </div>
                            <input id="rbq-cw-char-avatar-url" type="text" placeholder="头像图片 URL (可选或生图后一键设置)" value="${escapeHtml(char.avatarUrl)}" style="height: 28px !important; padding: 2px 8px !important; font-size: 11px !important; background: rgba(0,0,0,0.3) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 6px !important; color: rgba(255,255,255,0.8) !important;" />
                        </div>
                    </div>

                    <!-- Base Appearance Tags (外貌基础特征) -->
                    <div style="display: flex !important; flex-direction: column !important; gap: 8px !important; background: rgba(0,0,0,0.2) !important; padding: 12px !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.06) !important;">
                        <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; flex-wrap: wrap !important; gap: 6px !important;">
                            <label style="font-size: 12.5px !important; font-weight: bold !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 6px !important;">
                                <span>💇</span> 固定外貌特征 (Base Tags)：
                            </label>
                            <button class="menu_button" id="rbq-cw-pick-base-wb" type="button" style="padding: 2px 8px !important; font-size: 11px !important; background: rgba(121,228,255,0.18) !important; color: #79e4ff !important; border: 1px solid rgba(121,228,255,0.35) !important; border-radius: 4px !important; cursor: pointer !important;">
                                <i class="fa-solid fa-book-open"></i> 从世界书挑选外貌词条
                            </button>
                        </div>

                        <!-- Visual Quick-Pick Chips for Base -->
                        <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; background: rgba(0,0,0,0.25) !important; padding: 8px !important; border-radius: 6px !important; border: 1px solid rgba(255,255,255,0.05) !important;">
                            <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-weight: bold !important;">🎨 常用外貌特征快速点选 (点击即可加入/移除)：</div>
                            <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; max-height: 150px !important; overflow-y: auto !important;">
                                ${BASE_TRAIT_PRESETS.map(group => `
                                    <div style="display: flex !important; gap: 4px !important; align-items: center !important; flex-wrap: wrap !important;">
                                        <span style="font-size: 10.5px !important; color: #ffb86c !important; font-weight: bold !important; width: 85px !important; flex-shrink: 0 !important;">${escapeHtml(group.group)}:</span>
                                        <div style="display: flex !important; gap: 4px !important; flex-wrap: wrap !important; flex: 1 !important;">
                                            ${group.tags.map(t => `
                                                <button class="menu_button rbq-cw-base-chip-btn" data-tag="${escapeHtml(t.tag)}" type="button" style="padding: 1px 7px !important; font-size: 10.5px !important; margin: 0 !important; background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 4px !important; cursor: pointer !important;">${escapeHtml(t.name)}</button>
                                            `).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <textarea id="rbq-cw-char-base" placeholder="例如: 1girl, silver hair, red eyes, twin tails, slender, pointy ears, blush" style="width: 100% !important; min-height: 60px !important; padding: 6px 8px !important; font-size: 11.5px !important; font-family: monospace !important; background: rgba(0,0,0,0.35) !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 6px !important; color: #fff !important; box-sizing: border-box !important;">${escapeHtml(char.baseTags)}</textarea>
                        <small style="opacity: 0.6 !important; font-size: 10.5px !important;">跨场景固定的外貌特征：发色、发型、瞳色、身材、种族（兽耳/精灵耳）等。</small>
                    </div>

                    <!-- Current Outfit Tags (当前穿着服装) -->
                    <div style="display: flex !important; flex-direction: column !important; gap: 8px !important; background: rgba(0,0,0,0.2) !important; padding: 12px !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.06) !important;">
                        <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; flex-wrap: wrap !important; gap: 6px !important;">
                            <label style="font-size: 12.5px !important; font-weight: bold !important; color: #ffb86c !important; display: flex !important; align-items: center !important; gap: 6px !important;">
                                <span>👗</span> 默认服装 (Outfit Tags)：
                            </label>
                            <button class="menu_button" id="rbq-cw-pick-outfit-wb" type="button" style="padding: 2px 8px !important; font-size: 11px !important; background: rgba(255,184,108,0.18) !important; color: #ffb86c !important; border: 1px solid rgba(255,184,108,0.35) !important; border-radius: 4px !important; cursor: pointer !important;">
                                <i class="fa-solid fa-book-open"></i> 从世界书挑选服装
                            </button>
                        </div>

                        <!-- Visual Quick-Pick Chips for Outfit -->
                        <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; background: rgba(0,0,0,0.25) !important; padding: 8px !important; border-radius: 6px !important; border: 1px solid rgba(255,255,255,0.05) !important;">
                            <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-weight: bold !important;">👗 常见服装快速点选：</div>
                            <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; max-height: 120px !important; overflow-y: auto !important;">
                                ${OUTFIT_TRAIT_PRESETS.map(group => `
                                    <div style="display: flex !important; gap: 4px !important; align-items: center !important; flex-wrap: wrap !important;">
                                        <span style="font-size: 10.5px !important; color: #a3d4ff !important; font-weight: bold !important; width: 85px !important; flex-shrink: 0 !important;">${escapeHtml(group.group)}:</span>
                                        <div style="display: flex !important; gap: 4px !important; flex-wrap: wrap !important; flex: 1 !important;">
                                            ${group.tags.map(t => `
                                                <button class="menu_button rbq-cw-outfit-chip-btn" data-tag="${escapeHtml(t.tag)}" type="button" style="padding: 1px 7px !important; font-size: 10.5px !important; margin: 0 !important; background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 4px !important; cursor: pointer !important;">${escapeHtml(t.name)}</button>
                                            `).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <textarea id="rbq-cw-char-outfit" placeholder="例如: gothic dress, black ribbon, white thighhighs, frilled sleeves" style="width: 100% !important; min-height: 55px !important; padding: 6px 8px !important; font-size: 11.5px !important; font-family: monospace !important; background: rgba(0,0,0,0.35) !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 6px !important; color: #fff !important; box-sizing: border-box !important;">${escapeHtml(char.currentOutfit)}</textarea>
                    </div>

                    <!-- Test Button & Save Actions -->
                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; margin-top: 6px !important; padding-top: 8px !important; border-top: 1px solid rgba(255,255,255,0.08) !important; flex-wrap: wrap !important; gap: 8px !important;">
                        <button class="menu_button" id="rbq-cw-test-single-char" type="button" style="padding: 6px 14px !important; font-size: 11px !important; background: rgba(104,215,255,0.18) !important; color: #79e4ff !important; border: 1px solid rgba(104,215,255,0.3) !important; cursor: pointer !important;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> 测试生成单人立绘
                        </button>
                        <div style="display: flex !important; gap: 8px !important;">
                            <button class="menu_button" id="rbq-cw-ce-cancel" type="button" style="padding: 6px 14px !important; font-size: 12px !important;">取消</button>
                            <button class="menu_button" id="rbq-cw-ce-save" type="button" style="padding: 6px 20px !important; font-size: 12px !important; background: rgba(100,255,100,0.2) !important; color: #a3ffa3 !important; border: 1px solid rgba(100,255,100,0.4) !important; font-weight: bold !important; cursor: pointer !important;">💾 保存角色档案</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const close = () => modal.remove();
        modal.querySelector('#rbq-cw-ce-close')?.addEventListener('click', close);
        modal.querySelector('#rbq-cw-ce-cancel')?.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        // Quick Chip Toggle Handlers
        modal.querySelectorAll('.rbq-cw-base-chip-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.tag;
                const baseArea = modal.querySelector('#rbq-cw-char-base');
                if (baseArea && tag) {
                    baseArea.value = appendOrToggleTag(baseArea.value, tag);
                }
            });
        });

        modal.querySelectorAll('.rbq-cw-outfit-chip-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.tag;
                const outfitArea = modal.querySelector('#rbq-cw-char-outfit');
                if (outfitArea && tag) {
                    outfitArea.value = appendOrToggleTag(outfitArea.value, tag);
                }
            });
        });

        // Worldbook pickers
        modal.querySelector('#rbq-cw-pick-base-wb')?.addEventListener('click', () => {
            openWorldbookPickerModal({ title: '选择发型与外貌特征', defaultCategory: '外貌特征' }, (selected) => {
                const baseArea = modal.querySelector('#rbq-cw-char-base');
                if (baseArea) {
                    const current = baseArea.value.trim();
                    baseArea.value = current ? `${current}, ${selected.tags}` : selected.tags;
                    toastr.success(`已添加「${selected.title}」`, PLUGIN_NAME);
                }
            });
        });

        modal.querySelector('#rbq-cw-pick-outfit-wb')?.addEventListener('click', () => {
            openWorldbookPickerModal({ title: '选择服装预设', defaultCategory: '服装' }, (selected) => {
                const outfitArea = modal.querySelector('#rbq-cw-char-outfit');
                if (outfitArea) {
                    outfitArea.value = selected.tags;
                    toastr.success(`已应用服装「${selected.title}」`, PLUGIN_NAME);
                }
            });
        });

        // Test Single Draw
        modal.querySelector('#rbq-cw-test-single-char')?.addEventListener('click', async () => {
            const name = modal.querySelector('#rbq-cw-char-name')?.value?.trim() || 'Character';
            const baseTags = modal.querySelector('#rbq-cw-char-base')?.value?.trim() || '';
            const outfitTags = modal.querySelector('#rbq-cw-char-outfit')?.value?.trim() || '';
            const finalPrompt = [baseTags, outfitTags, 'simple background, white background, standing, looking at viewer'].filter(Boolean).join(', ');

            toastr.info(`正在生成角色「${name}」立绘...`, PLUGIN_NAME);
            try {
                const result = await RBQ.api.generateImage(finalPrompt, 'character-workshop-portrait');
                if (result?.url) {
                    modal.querySelector('#rbq-cw-char-avatar-url').value = result.url;
                    modal.querySelector('#rbq-cw-avatar-preview').innerHTML = `<img src="${escapeHtml(result.url)}" style="width:100%;height:100%;object-fit:cover;" />`;
                    toastr.success(`立绘生成成功，已自动设为头像！`, PLUGIN_NAME);
                }
            } catch (err) {
                toastr.error(`生成立绘失败: ${err.message || err}`, PLUGIN_NAME);
            }
        });

        // Save Character
        modal.querySelector('#rbq-cw-ce-save')?.addEventListener('click', () => {
            const name = modal.querySelector('#rbq-cw-char-name')?.value?.trim();
            if (!name) {
                toastr.warning('请输入角色名称', PLUGIN_NAME);
                return;
            }
            char.name = name;
            char.avatarUrl = modal.querySelector('#rbq-cw-char-avatar-url')?.value?.trim() || '';
            char.baseTags = modal.querySelector('#rbq-cw-char-base')?.value?.trim() || '';
            char.currentOutfit = modal.querySelector('#rbq-cw-char-outfit')?.value?.trim() || '';

            store.characters[char.id] = char;
            save();
            toastr.success(`角色「${name}」已保存！`, PLUGIN_NAME);
            if (typeof onSaved === 'function') onSaved(char);
            close();
        });

        document.body.appendChild(modal);
    }

    // ── Tab 1: 多角色组合台 ────────────────────────────────
    function renderComposerTab(comp, charList) {
        const store = getStore();
        const slots = Array.isArray(comp?.slots) ? comp.slots : [];
        const finalPrompt = composeFinalPrompt(comp);

        return `
            <div style="display: flex !important; flex-direction: column !important; gap: 16px !important;">
                <!-- Global Environment & Scene Settings -->
                <div style="background: rgba(255,255,255,0.02) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 12px !important; padding: 14px 16px !important; display: flex !important; flex-direction: column !important; gap: 10px !important;">
                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; flex-wrap: wrap !important; gap: 8px !important;">
                        <strong style="font-size: 13.5px !important; color: #ffb86c !important; display: flex !important; align-items: center !important; gap: 6px !important;">
                            <i class="fa-solid fa-mountain-sun"></i> 场景环境与全局构图 (Scene & Global Caption)
                        </strong>
                        <div style="display: flex !important; gap: 6px !important;">
                            <button class="menu_button" id="rbq-cw-pick-scene-wb" type="button" style="padding: 2px 9px !important; font-size: 11px !important; background: rgba(255,184,108,0.18) !important; color: #ffb86c !important; border: 1px solid rgba(255,184,108,0.35) !important;"><i class="fa-solid fa-book-open"></i> 从世界书选场景</button>
                            <button class="menu_button" id="rbq-cw-pick-pose-wb" type="button" style="padding: 2px 9px !important; font-size: 11px !important; background: rgba(121,228,255,0.18) !important; color: #79e4ff !important; border: 1px solid rgba(121,228,255,0.35) !important;"><i class="fa-solid fa-people-arrows"></i> 🤝 双人互动体位库</button>
                        </div>
                    </div>
                    <div style="display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 10px !important;">
                        <div style="display: flex !important; flex-direction: column !important; gap: 4px !important;">
                            <span style="font-size: 11px !important; opacity: 0.8 !important;">场景背景 Tags (indoors, beach, night...)：</span>
                            <input id="rbq-cw-comp-scene" type="text" value="${escapeHtml(comp?.scene || '')}" style="height: 32px !important; padding: 4px 8px !important; font-size: 11.5px !important; font-family: monospace !important; background: rgba(0,0,0,0.35) !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 6px !important; color: #fff !important;" />
                        </div>
                        <div style="display: flex !important; flex-direction: column !important; gap: 4px !important;">
                            <span style="font-size: 11px !important; opacity: 0.8 !important;">镜头视角 (POV, from above, close-up...)：</span>
                            <input id="rbq-cw-comp-camera" type="text" value="${escapeHtml(comp?.camera || '')}" style="height: 32px !important; padding: 4px 8px !important; font-size: 11.5px !important; font-family: monospace !important; background: rgba(0,0,0,0.35) !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 6px !important; color: #fff !important;" />
                        </div>
                    </div>
                </div>

                <!-- Character Slots Grid -->
                <div style="display: flex !important; justify-content: space-between !important; align-items: center !important;">
                    <strong style="font-size: 14px !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 6px !important;">
                        <i class="fa-solid fa-users-viewfinder"></i> 角色拼装槽位 (Char 1 ~ ${slots.length})
                    </strong>
                    <button class="menu_button" id="rbq-cw-add-slot-btn" type="button" style="padding: 4px 12px !important; font-size: 11.5px !important; background: rgba(100,255,100,0.18) !important; color: #a3ffa3 !important; border: 1px solid rgba(100,255,100,0.35) !important; font-weight: bold !important; cursor: pointer !important;">
                        <i class="fa-solid fa-plus"></i> 添加角色槽位
                    </button>
                </div>

                <div style="display: grid !important; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)) !important; gap: 12px !important;">
                    ${slots.map((slot, idx) => {
                        const charObj = store.characters[slot.charId];
                        return `
                            <div class="rbq-cw-slot-card" data-index="${idx}" style="background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(121,228,255,0.2) !important; border-radius: 12px !important; padding: 12px !important; display: flex !important; flex-direction: column !important; gap: 8px !important;">
                                <div style="display: flex !important; justify-content: space-between !important; align-items: center !important;">
                                    <div style="display: flex !important; align-items: center !important; gap: 6px !important;">
                                        <span style="background: rgba(121,228,255,0.2) !important; color: #79e4ff !important; font-size: 11px !important; font-weight: bold !important; padding: 1px 6px !important; border-radius: 4px !important;">Char ${idx + 1}</span>
                                        <strong style="font-size: 13px !important; color: #fff !important;">${escapeHtml(charObj?.name || slot.customName || `角色 ${idx + 1}`)}</strong>
                                    </div>
                                    ${slots.length > 1 ? `
                                        <button class="menu_button rbq-cw-remove-slot-btn" data-index="${idx}" type="button" style="padding: 1px 6px !important; font-size: 11px !important; color: #ff8585 !important; cursor: pointer !important;">✕ 移除</button>
                                    ` : ''}
                                </div>

                                <!-- Character Selector -->
                                <div style="display: flex !important; gap: 6px !important; align-items: center !important;">
                                    <select class="rbq-cw-slot-char-select" data-index="${idx}" style="flex: 1 !important; height: 30px !important; font-size: 11.5px !important; background: rgba(0,0,0,0.4) !important; border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 6px !important; color: #fff !important;">
                                        <option value="">👤 [自定义角色 / 未建档]</option>
                                        ${charList.map(c => `
                                            <option value="${escapeHtml(c.id)}" ${slot.charId === c.id ? 'selected' : ''}>👤 ${escapeHtml(c.name)}</option>
                                        `).join('')}
                                    </select>
                                </div>

                                <!-- Action / Pose -->
                                <div style="display: flex !important; flex-direction: column !important; gap: 3px !important;">
                                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important;">
                                        <span style="font-size: 11px !important; opacity: 0.75 !important;">动作/姿势 (Action)：</span>
                                        <button class="menu_button rbq-cw-pick-slot-action-wb" data-index="${idx}" type="button" style="padding: 1px 6px !important; font-size: 10px !important; color: #79e4ff !important; background: rgba(121,228,255,0.12) !important;"><i class="fa-solid fa-book-open"></i> 选动作</button>
                                    </div>
                                    <input class="rbq-cw-slot-action-input" data-index="${idx}" type="text" placeholder="standing, blush, hands on hips..." value="${escapeHtml(slot.action || '')}" style="height: 28px !important; padding: 2px 6px !important; font-size: 11px !important; font-family: monospace !important; background: rgba(0,0,0,0.3) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 4px !important; color: #fff !important;" />
                                </div>

                                <!-- Spatial Coordinate Grid Picker -->
                                <div style="display: flex !important; flex-direction: column !important; gap: 4px !important; background: rgba(0,0,0,0.2) !important; padding: 6px 8px !important; border-radius: 6px !important;">
                                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important;">
                                        <span style="font-size: 10.5px !important; opacity: 0.8 !important;">📍 站位坐标：</span>
                                        <span style="font-size: 10.5px !important; color: #79e4ff !important; font-weight: bold !important;">${formatCoordLabel(slot.center || 'C3')}</span>
                                    </div>
                                    <div style="display: flex !important; gap: 4px !important; justify-content: space-between !important;">
                                        ${['B3', 'C3', 'D3', 'A2', 'E2'].map(pos => `
                                            <button class="menu_button rbq-cw-slot-pos-btn ${slot.center === pos ? 'active' : ''}" data-index="${idx}" data-pos="${pos}" type="button" style="padding: 2px 6px !important; font-size: 10px !important; ${slot.center === pos ? 'background: rgba(121,228,255,0.25) !important; color: #79e4ff !important; border: 1px solid rgba(121,228,255,0.4) !important;' : ''}">${pos}</button>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- Formatted Prompt Preview -->
                <div style="background: rgba(0,0,0,0.4) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 10px !important; padding: 12px 14px !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important;">
                        <span style="font-size: 11.5px !important; color: rgba(255,255,255,0.85) !important; font-weight: bold !important;">
                            🚀 合成提示词预览 (NAI V4.5 Native Multi-Char Format)：
                        </span>
                        <button class="menu_button" id="rbq-cw-copy-prompt" type="button" style="padding: 2px 8px !important; font-size: 11px !important;"><i class="fa-regular fa-copy"></i> 复制提示词</button>
                    </div>
                    <div id="rbq-cw-prompt-preview" style="font-size: 11.5px !important; font-family: monospace !important; color: #a3d4ff !important; line-height: 1.4 !important; max-height: 70px !important; overflow-y: auto !important; word-break: break-all !important; white-space: pre-wrap !important;">${escapeHtml(finalPrompt)}</div>
                </div>

                <!-- Bottom Action Buttons -->
                <div style="display: flex !important; justify-content: flex-end !important; align-items: center !important; gap: 10px !important; flex-wrap: wrap !important;">
                    <button class="menu_button" id="rbq-cw-save-scene-preset" type="button" style="padding: 8px 16px !important; font-size: 12px !important; background: rgba(255,184,108,0.18) !important; color: #ffb86c !important; border: 1px solid rgba(255,184,108,0.35) !important;">
                        <i class="fa-solid fa-floppy-disk"></i> 保存为组合预设
                    </button>
                    <button class="menu_button" id="rbq-cw-generate-now" type="button" style="padding: 8px 24px !important; font-size: 13px !important; font-weight: bold !important; background: linear-gradient(135deg, rgba(121,228,255,0.3), rgba(100,255,100,0.3)) !important; color: #fff !important; border: 1px solid rgba(121,228,255,0.5) !important; box-shadow: 0 4px 15px rgba(121,228,255,0.2) !important; cursor: pointer !important;">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 🚀 立即合成并生图
                    </button>
                </div>
            </div>
        `;
    }

    // ── Tab 2: 角色档案库 ──────────────────────────────────
    function renderCharactersTab(charList) {
        const store = getStore();
        return `
            <div style="display: flex !important; flex-direction: column !important; gap: 14px !important;">
                <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; flex-wrap: wrap !important; gap: 8px !important;">
                    <span style="font-size: 13px !important; opacity: 0.8 !important;">管理你创造和保存的角色档案库，可随时在组合台中调用。</span>
                    <div style="display: flex !important; gap: 8px !important;">
                        <button class="menu_button" id="rbq-cw-import-st-chars" type="button" style="padding: 5px 12px !important; font-size: 12px !important; background: rgba(255,184,108,0.18) !important; color: #ffb86c !important; border: 1px solid rgba(255,184,108,0.3) !important;">
                            <i class="fa-solid fa-file-import"></i> 从酒馆角色卡导入
                        </button>
                        <button class="menu_button" id="rbq-cw-create-new-char" type="button" style="padding: 5px 16px !important; font-size: 12px !important; background: rgba(100,255,100,0.2) !important; color: #a3ffa3 !important; border: 1px solid rgba(100,255,100,0.35) !important; font-weight: bold !important; cursor: pointer !important;">
                            <i class="fa-solid fa-plus"></i> 创造新角色
                        </button>
                    </div>
                </div>

                <div style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)) !important; gap: 12px !important;">
                    ${charList.length === 0 ? `
                        <div style="grid-column: 1 / -1 !important; text-align: center !important; opacity: 0.5 !important; padding: 40px 0 !important; font-size: 13px !important;">
                            暂无角色档案，点击上方「创造新角色」或「从酒馆角色卡导入」开始创建！
                        </div>
                    ` : charList.map(c => `
                        <div style="background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 12px !important; padding: 12px !important; display: flex !important; flex-direction: column !important; gap: 8px !important;">
                            <div style="display: flex !important; gap: 10px !important; align-items: center !important;">
                                <div style="width: 44px !important; height: 44px !important; border-radius: 8px !important; background: rgba(255,255,255,0.06) !important; border: 1px solid rgba(255,255,255,0.15) !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: 18px !important; overflow: hidden !important; flex-shrink: 0 !important;">
                                    ${c.avatarUrl ? `<img src="${escapeHtml(c.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;" />` : '👤'}
                                </div>
                                <div style="flex: 1 !important; min-width: 0 !important;">
                                    <strong style="font-size: 14px !important; color: #79e4ff !important; display: block !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;">${escapeHtml(c.name)}</strong>
                                    <small style="opacity: 0.6 !important; font-size: 11px !important; display: block !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;">外貌: ${escapeHtml(c.baseTags || '未设置')}</small>
                                </div>
                            </div>
                            <div style="display: flex !important; justify-content: flex-end !important; gap: 6px !important; border-top: 1px solid rgba(255,255,255,0.05) !important; padding-top: 6px !important;">
                                <button class="menu_button rbq-cw-send-to-slot" data-id="${escapeHtml(c.id)}" type="button" style="padding: 2px 8px !important; font-size: 10.5px !important; background: rgba(121,228,255,0.15) !important; color: #79e4ff !important;">+ 放入组合台</button>
                                <button class="menu_button rbq-cw-edit-char-btn" data-id="${escapeHtml(c.id)}" type="button" style="padding: 2px 8px !important; font-size: 10.5px !important;">编辑</button>
                                <button class="menu_button rbq-cw-del-char-btn" data-id="${escapeHtml(c.id)}" type="button" style="padding: 2px 8px !important; font-size: 10.5px !important; color: #ff8585 !important;">删除</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ── Tab 3: 组合预设库 ──────────────────────────────────
    function renderPresetsTab() {
        const store = getStore();
        const presets = store.presets || [];
        return `
            <div style="display: flex !important; flex-direction: column !important; gap: 12px !important;">
                <div style="font-size: 13px !important; opacity: 0.8 !important;">保存的常用多角色组合场景预设：</div>
                <div style="display: grid !important; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)) !important; gap: 12px !important;">
                    ${presets.length === 0 ? `
                        <div style="grid-column: 1 / -1 !important; text-align: center !important; opacity: 0.5 !important; padding: 40px 0 !important; font-size: 13px !important;">
                            暂无保存的组合预设，在「多角色组合台」配置好后点击「保存为组合预设」即可添加到此处！
                        </div>
                    ` : presets.map((p, idx) => `
                        <div style="background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 10px !important; padding: 12px !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                            <strong style="color: #ffb86c !important; font-size: 13px !important;">🔖 ${escapeHtml(p.name)}</strong>
                            <div style="font-size: 11px !important; color: rgba(255,255,255,0.6) !important;">包含 ${p.slots?.length || 0} 位角色</div>
                            <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; margin-top: 4px !important;">
                                <span style="font-size: 10.5px !important; opacity: 0.6 !important;">${p.scene ? escapeHtml(p.scene.slice(0, 30)) + '...' : ''}</span>
                                <div style="display: flex !important; gap: 4px !important;">
                                    <button class="menu_button rbq-cw-load-preset-btn" data-index="${idx}" type="button" style="padding: 2px 10px !important; font-size: 11px !important; background: rgba(100,255,100,0.15) !important; color: #a3ffa3 !important;">载入组合台</button>
                                    <button class="menu_button rbq-cw-del-preset-btn" data-index="${idx}" type="button" style="padding: 2px 8px !important; font-size: 11px !important; color: #ff8585 !important;">删除</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function composeFinalPrompt(comp) {
        const store = getStore();
        const slots = Array.isArray(comp?.slots) ? comp.slots : [];
        const sceneParts = [comp?.scene, comp?.camera, comp?.atmosphere].filter(Boolean).join(', ');
        const charParts = slots.map((s, idx) => {
            const charObj = store.characters[s.charId];
            const base = charObj?.baseTags || '';
            const outfit = (s.outfitMode === 'custom' ? s.customOutfit : charObj?.currentOutfit) || '';
            const action = s.action || '';
            const caption = [base, outfit, action].filter(Boolean).join(', ');
            const pos = s.center || 'C3';
            return `Char${idx + 1}:${caption}|centers:${pos}`;
        });

        return [sceneParts ? `Scene:${sceneParts}` : '', ...charParts].filter(Boolean).join('; ');
    }

    function renderWorkshopInnerHtml(activeTab) {
        try {
            const store = getStore();
            const charList = Object.values(store.characters || {});
            const comp = store.activeComposer;

            return `
                <div class="rbq-cw-wrapper" style="display: flex !important; flex-direction: column !important; gap: 14px !important; width: 100% !important; box-sizing: border-box !important; padding: 4px 0 !important;">
                    <!-- Top Navigation Bar -->
                    <div style="display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 12px 16px !important; border-radius: 10px !important; background: linear-gradient(90deg, rgba(121,228,255,0.12), rgba(255,184,108,0.08)) !important; border: 1px solid rgba(255,255,255,0.08) !important; flex-wrap: wrap !important; gap: 10px !important;">
                        <strong style="font-size: 15px !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 8px !important;">
                            <i class="fa-solid fa-palette"></i> 角色工坊 (Character Workshop)
                        </strong>
                        <div style="display: flex !important; gap: 6px !important; background: rgba(0,0,0,0.4) !important; padding: 3px !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.08) !important;">
                            <button class="menu_button rbq-cw-nav-tab ${activeTab === 'composer' ? 'active' : ''}" data-tab="composer" style="padding: 4px 14px !important; font-size: 12px !important; border-radius: 6px !important; ${activeTab === 'composer' ? 'background: rgba(121,228,255,0.25) !important; color: #79e4ff !important; font-weight: bold !important;' : ''}">
                                <i class="fa-solid fa-puzzle-piece"></i> 多角色组合台
                            </button>
                            <button class="menu_button rbq-cw-nav-tab ${activeTab === 'characters' ? 'active' : ''}" data-tab="characters" style="padding: 4px 14px !important; font-size: 12px !important; border-radius: 6px !important; ${activeTab === 'characters' ? 'background: rgba(121,228,255,0.25) !important; color: #79e4ff !important; font-weight: bold !important;' : ''}">
                                <i class="fa-solid fa-users"></i> 角色档案库 (${charList.length})
                            </button>
                            <button class="menu_button rbq-cw-nav-tab ${activeTab === 'presets' ? 'active' : ''}" data-tab="presets" style="padding: 4px 14px !important; font-size: 12px !important; border-radius: 6px !important; ${activeTab === 'presets' ? 'background: rgba(121,228,255,0.25) !important; color: #79e4ff !important; font-weight: bold !important;' : ''}">
                                <i class="fa-solid fa-bookmark"></i> 组合预设库 (${store.presets.length})
                            </button>
                        </div>
                    </div>

                    <!-- Active Tab Body -->
                    <div id="rbq-cw-main-body" style="display: flex !important; flex-direction: column !important; gap: 14px !important;">
                        ${activeTab === 'composer' ? renderComposerTab(comp, charList) : ''}
                        ${activeTab === 'characters' ? renderCharactersTab(charList) : ''}
                        ${activeTab === 'presets' ? renderPresetsTab() : ''}
                    </div>
                </div>
            `;
        } catch (err) {
            console.error(`[${PLUGIN_NAME}] render error:`, err);
            return `<div style="padding: 20px; color: #ff8585;">角色工坊渲染异常: ${escapeHtml(err.message || err)}</div>`;
        }
    }

    function bindWorkshopEvents(container, activeTab, onRefresh) {
        const store = getStore();
        container.querySelectorAll('.rbq-cw-nav-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.tab;
                    if (tab) onRefresh(tab);
                });
            });

            // Composer Events
            container.querySelector('#rbq-cw-comp-scene')?.addEventListener('input', (e) => {
                store.activeComposer.scene = e.target.value;
                save();
                const previewEl = container.querySelector('#rbq-cw-prompt-preview');
                if (previewEl) previewEl.textContent = composeFinalPrompt(store.activeComposer);
            });
            container.querySelector('#rbq-cw-comp-camera')?.addEventListener('input', (e) => {
                store.activeComposer.camera = e.target.value;
                save();
                const previewEl = container.querySelector('#rbq-cw-prompt-preview');
                if (previewEl) previewEl.textContent = composeFinalPrompt(store.activeComposer);
            });

            container.querySelector('#rbq-cw-pick-scene-wb')?.addEventListener('click', () => {
                openWorldbookPickerModal({ title: '选择场景环境', defaultCategory: '场景环境' }, (selected) => {
                    store.activeComposer.scene = selected.tags;
                    save();
                    onRefresh(activeTab);
                });
            });

            container.querySelector('#rbq-cw-pick-pose-wb')?.addEventListener('click', () => {
                openWorldbookPickerModal({ title: '选择双人/多人互动体位', defaultCategory: '动作体位' }, (selected) => {
                    const raw = selected.tags;
                    const char1Match = raw.match(/Char1:\s*([^;]+)/i);
                    const char2Match = raw.match(/Char2:\s*([^;]+)/i);
                    if (char1Match && store.activeComposer.slots[0]) {
                        store.activeComposer.slots[0].action = char1Match[1].trim();
                    }
                    if (char2Match && store.activeComposer.slots[1]) {
                        store.activeComposer.slots[1].action = char2Match[1].trim();
                    }
                    if (!char1Match && !char2Match && store.activeComposer.slots[0]) {
                        store.activeComposer.slots[0].action = raw;
                    }
                    save();
                    onRefresh(activeTab);
                    toastr.success(`已应用互动姿势「${selected.title}」`, PLUGIN_NAME);
                });
            });

            container.querySelector('#rbq-cw-add-slot-btn')?.addEventListener('click', () => {
                const slots = store.activeComposer.slots;
                if (slots.length >= 5) {
                    toastr.warning('最多支持 5 位角色同时组合', PLUGIN_NAME);
                    return;
                }
                slots.push({ charId: '', customName: `角色 ${slots.length + 1}`, outfitMode: 'current', customOutfit: '', action: '', center: 'C3', uc: '' });
                save();
                onRefresh(activeTab);
            });

            container.querySelectorAll('.rbq-cw-remove-slot-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    store.activeComposer.slots.splice(idx, 1);
                    save();
                    onRefresh(activeTab);
                });
            });

            container.querySelectorAll('.rbq-cw-slot-char-select').forEach(sel => {
                sel.addEventListener('change', () => {
                    const idx = Number(sel.dataset.index);
                    if (store.activeComposer.slots[idx]) {
                        store.activeComposer.slots[idx].charId = sel.value;
                        save();
                        onRefresh(activeTab);
                    }
                });
            });

            container.querySelectorAll('.rbq-cw-slot-action-input').forEach(inp => {
                inp.addEventListener('input', () => {
                    const idx = Number(inp.dataset.index);
                    if (store.activeComposer.slots[idx]) {
                        store.activeComposer.slots[idx].action = inp.value;
                        save();
                        const previewEl = container.querySelector('#rbq-cw-prompt-preview');
                        if (previewEl) previewEl.textContent = composeFinalPrompt(store.activeComposer);
                    }
                });
            });

            container.querySelectorAll('.rbq-cw-pick-slot-action-wb').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    openWorldbookPickerModal({ title: `为 Char ${idx + 1} 选择动作`, defaultCategory: '动作体位' }, (selected) => {
                        if (store.activeComposer.slots[idx]) {
                            store.activeComposer.slots[idx].action = selected.tags;
                            save();
                            onRefresh(activeTab);
                        }
                    });
                });
            });

            container.querySelectorAll('.rbq-cw-slot-pos-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const pos = btn.dataset.pos;
                    if (store.activeComposer.slots[idx]) {
                        store.activeComposer.slots[idx].center = pos;
                        save();
                        onRefresh(activeTab);
                    }
                });
            });

            container.querySelector('#rbq-cw-copy-prompt')?.addEventListener('click', () => {
                const prompt = composeFinalPrompt(store.activeComposer);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(prompt).then(() => toastr.success('已复制多角色合成提示词', PLUGIN_NAME));
                } else {
                    toastr.info(prompt.slice(0, 100), '提示词');
                }
            });

            container.querySelector('#rbq-cw-generate-now')?.addEventListener('click', async () => {
                const finalPrompt = composeFinalPrompt(store.activeComposer);
                toastr.info('🚀 正在调用 RBQ 生图引擎生成多角色画作...', PLUGIN_NAME);
                try {
                    await RBQ.api.generateImage(finalPrompt, 'character-workshop-ensemble');
                    toastr.success('🎉 多角色画面生成完毕，已存入画廊！', PLUGIN_NAME);
                } catch (err) {
                    toastr.error(`生图失败: ${err.message || err}`, PLUGIN_NAME);
                }
            });

            container.querySelector('#rbq-cw-save-scene-preset')?.addEventListener('click', () => {
                const name = prompt('请输入该组合场景的预设名称：', `组合场景 - ${new Date().toLocaleDateString()}`);
                if (!name) return;
                store.presets.push({
                    id: uid('preset'),
                    name,
                    scene: store.activeComposer.scene,
                    camera: store.activeComposer.camera,
                    slots: JSON.parse(JSON.stringify(store.activeComposer.slots))
                });
                save();
                toastr.success(`预设「${name}」已保存！`, PLUGIN_NAME);
            });

            // Character Tab Events
            container.querySelector('#rbq-cw-create-new-char')?.addEventListener('click', () => {
                openCharacterEditorModal(null, () => onRefresh(activeTab));
            });

            container.querySelectorAll('.rbq-cw-edit-char-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const charId = btn.dataset.id;
                    openCharacterEditorModal(charId, () => onRefresh(activeTab));
                });
            });

            container.querySelectorAll('.rbq-cw-del-char-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const charId = btn.dataset.id;
                    delete store.characters[charId];
                    save();
                    onRefresh(activeTab);
                    toastr.info('角色档案已删除', PLUGIN_NAME);
                });
            });

            container.querySelectorAll('.rbq-cw-send-to-slot').forEach(btn => {
                btn.addEventListener('click', () => {
                    const charId = btn.dataset.id;
                    if (store.activeComposer.slots[0]) {
                        store.activeComposer.slots[0].charId = charId;
                    }
                    save();
                    onRefresh('composer');
                    toastr.success('已放入组合台 Char 1', PLUGIN_NAME);
                });
            });

            container.querySelector('#rbq-cw-import-st-chars')?.addEventListener('click', () => {
                try {
                    const ctx = RBQ.api.getContext();
                    const characters = ctx?.characters;
                    if (!Array.isArray(characters) || characters.length === 0) {
                        toastr.warning('当前酒馆未加载角色卡', PLUGIN_NAME);
                        return;
                    }
                    let imported = 0;
                    for (const c of characters) {
                        if (c && c.name) {
                            const charId = uid('char');
                            store.characters[charId] = {
                                id: charId,
                                name: c.name,
                                avatarUrl: c.avatar || '',
                                baseTags: '1girl, looking at viewer',
                                currentOutfit: '',
                                wardrobe: []
                            };
                            imported++;
                        }
                    }
                    save();
                    onRefresh(activeTab);
                    toastr.success(`成功导入 ${imported} 位酒馆角色卡！`, PLUGIN_NAME);
                } catch (e) {
                    toastr.error(`导入失败: ${e.message || e}`, PLUGIN_NAME);
                }
            });

            // Presets Tab Events
            container.querySelectorAll('.rbq-cw-load-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const preset = store.presets[idx];
                    if (preset) {
                        store.activeComposer.scene = preset.scene || '';
                        store.activeComposer.camera = preset.camera || '';
                        store.activeComposer.slots = JSON.parse(JSON.stringify(preset.slots || []));
                        save();
                        onRefresh('composer');
                        toastr.success(`已载入预设「${preset.name}」`, PLUGIN_NAME);
                    }
                });
            });

            container.querySelectorAll('.rbq-cw-del-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    store.presets.splice(idx, 1);
                    save();
                    onRefresh(activeTab);
                    toastr.info('预设已删除', PLUGIN_NAME);
                });
            });
        }

        // ── Render into Standalone Modal ──────────────────────
        function openCharacterWorkshopModal(initialTab = 'composer') {
            const existing = document.getElementById('rbq-character-workshop-modal');
            if (existing) existing.remove();

            let currentTab = initialTab;
            const modal = document.createElement('div');
            modal.id = 'rbq-character-workshop-modal';
            modal.style.cssText = `
                position: fixed !important; inset: 0 !important; z-index: 100000010 !important;
                background: rgba(0,0,0,0.85) !important; display: flex !important;
                align-items: center !important; justify-content: center !important;
                padding: 16px !important; box-sizing: border-box !important;
                backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
            `;

            function update() {
                modal.innerHTML = `
                    <div style="background: #16171d !important; border: 1px solid rgba(121,228,255,0.35) !important; border-radius: 16px !important; width: 920px !important; max-width: 96vw !important; height: 88vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 25px 70px rgba(0,0,0,0.95) !important; box-sizing: border-box !important;">
                        <div style="display: flex !important; justify-content: flex-end !important; padding: 8px 12px 0 0 !important;">
                            <button class="menu_button" id="rbq-cw-main-close" style="padding: 4px 10px !important; font-size: 13px !important; cursor: pointer !important;">✕</button>
                        </div>
                        <div id="rbq-cw-modal-scrollable" style="flex: 1 !important; overflow-y: auto !important; padding: 0 20px 20px 20px !important;">
                            ${renderWorkshopInnerHtml(currentTab)}
                        </div>
                    </div>
                `;
                modal.querySelector('#rbq-cw-main-close')?.addEventListener('click', () => modal.remove());
                modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
                bindWorkshopEvents(modal, currentTab, (newTab) => {
                    currentTab = newTab;
                    update();
                });
            }

            update();
            document.body.appendChild(modal);
        }

        // ── Render into Control Panel Tab ─────────────────────
        let currentSettingTab = 'composer';

        function switchRbqTab(tab) {
            document.querySelectorAll('[data-kite-tab]').forEach((element) => {
                if (element instanceof HTMLElement) element.classList.toggle('active', element.dataset.kiteTab === tab);
            });
            document.querySelectorAll('[data-kite-panel]').forEach((element) => {
                if (element instanceof HTMLElement) {
                    const isActive = element.dataset.kitePanel === tab;
                    element.classList.toggle('active', isActive);
                    if (element.dataset.kitePanel === 'character-workshop') {
                        element.style.display = isActive ? 'flex' : 'none';
                    }
                }
            });
        }

        function ensureSettingsPanel() {
            const rail = document.querySelector('.st-scene-trigger-tab-rail');
            const content = document.querySelector('.st-scene-trigger-modal-content');
            if (!(rail instanceof HTMLElement) || !(content instanceof HTMLElement)) return null;

            let button = document.querySelector('[data-kite-tab="character-workshop"]');
            if (!(button instanceof HTMLButtonElement)) {
                button = document.createElement('button');
                button.className = 'st-scene-trigger-tab-button';
                button.dataset.kiteTab = 'character-workshop';
                button.type = 'button';
                button.innerHTML = '<i class="fa-solid fa-palette"></i><span>角色工坊</span>';
                button.addEventListener('click', () => {
                    switchRbqTab('character-workshop');
                    renderWorkshopInSettingsPanel();
                });

                const targetBtn = rail.querySelector('[data-kite-tab="smart-draw"]') || rail.querySelector('[data-kite-tab="extensions"]');
                if (targetBtn?.nextSibling) {
                    rail.insertBefore(button, targetBtn.nextSibling);
                } else {
                    rail.append(button);
                }
            }

            let panel = document.querySelector('[data-kite-panel="character-workshop"]');
            if (!(panel instanceof HTMLElement)) {
                panel = document.createElement('section');
                panel.className = 'st-scene-trigger-modal-panel';
                panel.dataset.kitePanel = 'character-workshop';
                panel.style.cssText = 'width: 100% !important; box-sizing: border-box !important; flex-direction: column !important;';
                content.append(panel);
                renderWorkshopInSettingsPanel();
            }
            return panel;
        }

        function renderWorkshopInSettingsPanel() {
            const panel = document.querySelector('[data-kite-panel="character-workshop"]');
            if (!panel) return;
            const isActive = panel.classList.contains('active');
            panel.style.display = isActive ? 'flex' : 'none';
            panel.style.flexDirection = 'column';
            panel.style.width = '100%';
            panel.style.boxSizing = 'border-box';
            panel.style.overflowY = 'auto';
            panel.innerHTML = renderWorkshopInnerHtml(currentSettingTab);
            bindWorkshopEvents(panel, currentSettingTab, (newTab) => {
                currentSettingTab = newTab;
                renderWorkshopInSettingsPanel();
            });
        }

        // Periodic check to ensure tab is present whenever settings modal is open
        setInterval(ensureSettingsPanel, 1000);
        $(document).ready(() => setTimeout(ensureSettingsPanel, 1200));

        console.info(`[${PLUGIN_NAME}] 插件已就绪`);
    })(window.RBQ, window.jQuery, window.toastr);
