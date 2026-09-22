(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Prompt Presets] RBQ Core API missing');

    const STORAGE_KEY = '_promptPresets';

    // ── Storage ──
    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { activeId: '', position: 'prepend', globalPositivePrefix: '', globalPositiveSuffix: '', globalNegative: '', presets: [] };
        const store = s[STORAGE_KEY];
        let mutated = false;
        if (store.globalPositive && !store.globalPositivePrefix) {
            store.globalPositivePrefix = store.globalPositive;
            delete store.globalPositive;
            mutated = true;
        }
        if (typeof store.globalPositivePrefix !== 'string') { store.globalPositivePrefix = ''; mutated = true; }
        if (typeof store.globalPositiveSuffix !== 'string') { store.globalPositiveSuffix = ''; mutated = true; }
        if (typeof store.globalNegative !== 'string') { store.globalNegative = ''; mutated = true; }
        const seenIds = new Set();
        store.presets = (Array.isArray(store.presets) ? store.presets : []).map((item) => {
            if (!item || typeof item !== 'object') return null;
            const preset = { ...item };
            preset.id = String(preset.id || uid());
            if (seenIds.has(preset.id)) {
                preset.id = uid();
                mutated = true;
            }
            seenIds.add(preset.id);
            if (!item.id) mutated = true;
            return preset;
        }).filter(Boolean);
        if (!store.presets.some(p => p.id === store.activeId)) {
            store.activeId = '';
            mutated = true;
        }
        if (mutated) save();
        return store;
    }

    let renderPresetUi = null;

    function syncToActiveProfile() {
        try {
            const activeProfile = RBQ.api.getActiveGlobalProfile?.();
            if (activeProfile && activeProfile.data && typeof activeProfile.data === 'object') {
                const store = getStore();
                activeProfile.data.promptPresetsConfig = {
                    globalPositivePrefix: store.globalPositivePrefix || '',
                    globalPositiveSuffix: store.globalPositiveSuffix || '',
                    globalNegative: store.globalNegative || '',
                    activeId: store.activeId || '',
                    position: store.position || 'prepend',
                };
                activeProfile.updatedAt = Date.now();
            }
        } catch (_e) {}
    }

    function save() {
        syncToActiveProfile();
        RBQ.api.saveSettings();
    }
    function uid() { return 'pp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function getActivePreset() {
        const store = getStore();
        return store.activeId ? store.presets.find(p => p.id === store.activeId) || null : null;
    }

    function getCurrentNaiVibes() {
        return Array.isArray(RBQ.api.getNaiVibes?.()) ? RBQ.api.getNaiVibes() : [];
    }

    function compactVibeEntry(item) {
        if (!item || typeof item !== 'object') return null;
        const tensor = String(item.tensor || '').trim();
        const b64 = String(item.b64 || '').trim();
        if (!tensor && !b64) return null;
        return {
            id: String(item.id || uid()),
            tensor: tensor || null,
            b64,
            info: Math.max(0, Math.min(1, Number(item.info) || 1)),
            strength: Math.max(0, Math.min(1, Number(item.strength) || 0.6)),
        };
    }

    function snapshotNaiVibes(mode = 'full') {
        const vibes = getCurrentNaiVibes();
        return vibes.map((item) => {
            const base = compactVibeEntry(item);
            if (!base) return null;
            if (mode === 'compact') {
                return {
                    id: base.id,
                    tensor: base.tensor,
                    b64: '',
                    info: base.info,
                    strength: base.strength,
                };
            }
            return base;
        }).filter(Boolean).slice(0, 6);
    }

    function restorePresetVibesToHost(preset) {
        const vibes = Array.isArray(preset?.vibes) ? preset.vibes : [];
        RBQ.api.setNaiVibes?.(vibes, { source: 'plugin:preset-restore' });
        RBQ.api.refreshNaiVibeUi?.();
    }

    function showVibeSaveDialog(onSelect) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';
        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#1e1e2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:16px;min-width:320px;max-width:520px;display:flex;flex-direction:column;gap:12px;color:#fff;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
        dialog.innerHTML = `
            <div style="font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-box-archive"></i>
                <span>保存氛围文件状态</span>
            </div>
            <div style="font-size:13px;color:rgba(255,255,255,0.72);line-height:1.6;">
                当前 NAI 面板里检测到氛围文件。请选择保存方式：
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button id="rbq-pp-save-compact" class="menu_button" type="button" style="flex:1;min-width:150px;">
                    <i class="fa-solid fa-minimize"></i> 压缩保存
                </button>
                <button id="rbq-pp-save-full" class="menu_button" type="button" style="flex:1;min-width:150px;">
                    <i class="fa-solid fa-floppy-disk"></i> 完整保存
                </button>
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.52);line-height:1.6;">
                压缩保存：优先保留 tensor、strength、info，不保留大图 base64；完整保存：保留当前全部可用数据，体积更大。
            </div>
            <div style="display:flex;justify-content:flex-end;">
                <button id="rbq-pp-save-cancel" class="menu_button" type="button" style="font-size:12px;padding:4px 14px;">取消</button>
            </div>
        `;
        overlay.appendChild(dialog);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        dialog.querySelector('#rbq-pp-save-compact')?.addEventListener('click', () => { overlay.remove(); onSelect('compact'); });
        dialog.querySelector('#rbq-pp-save-full')?.addEventListener('click', () => { overlay.remove(); onSelect('full'); });
        dialog.querySelector('#rbq-pp-save-cancel')?.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
    }

    // ── Join Logic ──
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function combineParts(...parts) {
        return parts
            .map(p => (p || '').trim())
            .filter(Boolean)
            .join(', ');
    }

    function resolvePositivePrompt(original, presetText, globalPrefix, globalSuffix, position) {
        const orig = (original || '').trim();
        const preset = (presetText || '').trim();
        const gPre = (globalPrefix || '').trim();
        const gSuf = (globalSuffix || '').trim();

        let middle = orig;
        if (preset) {
            middle = position === 'prepend'
                ? combineParts(preset, orig)
                : combineParts(orig, preset);
        }

        return combineParts(gPre, middle, gSuf);
    }

    function resolveNegativePrompt(original, presetText, globalText) {
        const orig = (original || '').trim();
        const preset = (presetText || '').trim();
        const global = (globalText || '').trim();
        if (!preset && !global) return orig;
        return combineParts(global, preset, orig);
    }

    // ── Payload Hooks ──
    RBQ.on('buildNaiV4Payload', (payload) => {
        const store = getStore();
        const preset = getActivePreset();
        const pos = store.position || 'prepend';
        const gPre = store.globalPositivePrefix || '';
        const gSuf = store.globalPositiveSuffix || '';
        const gNeg = store.globalNegative || '';
        const presetPos = preset ? (preset.positive || '') : '';
        const presetNeg = preset ? (preset.negative || '') : '';

        if (gPre || gSuf || presetPos) {
            payload.input = resolvePositivePrompt(payload.input, presetPos, gPre, gSuf, pos);
            if (payload.parameters?.v4_prompt?.caption) {
                payload.parameters.v4_prompt.caption.base_caption = resolvePositivePrompt(
                    payload.parameters.v4_prompt.caption.base_caption, presetPos, gPre, gSuf, pos
                );
            }
        }
        if (gNeg || presetNeg) {
            if (payload.parameters) {
                payload.parameters.negative_prompt = resolveNegativePrompt(
                    payload.parameters.negative_prompt, presetNeg, gNeg
                );
            }
            if (payload.parameters?.v4_negative_prompt?.caption) {
                payload.parameters.v4_negative_prompt.caption.base_caption = resolveNegativePrompt(
                    payload.parameters.v4_negative_prompt.caption.base_caption, presetNeg, gNeg
                );
            }
        }
        console.info('[Prompt Presets] NAI payload modified with presets/global prompts');
        return payload;
    });

    RBQ.on('buildGeneratePayload', (payload) => {
        const store = getStore();
        const preset = getActivePreset();
        const pos = store.position || 'prepend';
        const gPre = store.globalPositivePrefix || '';
        const gSuf = store.globalPositiveSuffix || '';
        const gNeg = store.globalNegative || '';
        const presetPos = preset ? (preset.positive || '') : '';
        const presetNeg = preset ? (preset.negative || '') : '';

        if (gPre || gSuf || presetPos) {
            payload.positive_prompt = resolvePositivePrompt(payload.positive_prompt, presetPos, gPre, gSuf, pos);
        }
        if (gNeg || presetNeg) {
            payload.negative_prompt = resolveNegativePrompt(payload.negative_prompt, presetNeg, gNeg);
        }
        console.info('[Prompt Presets] Free payload modified with presets/global prompts');
        return payload;
    });

    RBQ.on('buildComfyUiWorkflow', (payload) => {
        const store = getStore();
        const preset = getActivePreset();
        const pos = store.position || 'prepend';
        const gPre = store.globalPositivePrefix || '';
        const gSuf = store.globalPositiveSuffix || '';
        const gNeg = store.globalNegative || '';
        const presetPos = preset ? (preset.positive || '') : '';
        const presetNeg = preset ? (preset.negative || '') : '';

        for (const key of Object.keys(payload)) {
            const node = payload[key];
            if (!node || !node.inputs) continue;
            const cType = String(node.class_type || '');

            // 1. 标准 CLIPTextEncode 节点
            if (cType === 'CLIPTextEncode' && typeof node.inputs.text === 'string') {
                const isNeg = Object.values(payload).some(n =>
                    n?.inputs?.negative && Array.isArray(n.inputs.negative) && n.inputs.negative[0] === key
                ) || node._meta?.title?.toLowerCase()?.includes('negative') || node._meta?.title?.includes('负面') || node._meta?.title?.includes('反向');
                if (isNeg && (gNeg || presetNeg)) {
                    node.inputs.text = resolveNegativePrompt(node.inputs.text, presetNeg, gNeg);
                } else if (!isNeg && (gPre || gSuf || presetPos)) {
                    node.inputs.text = resolvePositivePrompt(node.inputs.text, presetPos, gPre, gSuf, pos);
                }
            }

            // 2. 支持 WeiLin 全能提示词编辑器 (WeiLinPromptUI) 及具有 positive 文本字段的节点
            if (typeof node.inputs.positive === 'string' && (gPre || gSuf || presetPos)) {
                node.inputs.positive = resolvePositivePrompt(node.inputs.positive, presetPos, gPre, gSuf, pos);
            }
            if (/WeiLin/i.test(cType) || /PromptUI/i.test(cType)) {
                if (node.inputs.auto_random !== undefined) {
                    node.inputs.auto_random = false;
                }
            }

            // 3. 支持第三方具有 negative 文本字段的节点
            if (typeof node.inputs.negative === 'string' && (gNeg || presetNeg)) {
                node.inputs.negative = resolveNegativePrompt(node.inputs.negative, presetNeg, gNeg);
            }

            // 4. 支持具有 prompt 文本字段的节点 (如 WeiLinPromptToString, CR Prompt Text 等)
            if (typeof node.inputs.prompt === 'string' && (gPre || gSuf || presetPos)) {
                const title = node._meta?.title || '';
                const isNeg = /neg|反向|负面/i.test(title);
                if (isNeg && (gNeg || presetNeg)) {
                    node.inputs.prompt = resolveNegativePrompt(node.inputs.prompt, presetNeg, gNeg);
                } else if (!isNeg && (gPre || gSuf || presetPos)) {
                    node.inputs.prompt = resolvePositivePrompt(node.inputs.prompt, presetPos, gPre, gSuf, pos);
                }
            }
        }
        console.info('[Prompt Presets] ComfyUI workflow modified with presets/global prompts');
        return payload;
    });

    // ── Global Profile Switch Listener ──
    RBQ.on('profile:switched', (event) => {
        const store = getStore();
        if (event?.profile?.data?.promptPresetsConfig) {
            const cfg = event.profile.data.promptPresetsConfig;
            store.globalPositivePrefix = cfg.globalPositivePrefix || '';
            store.globalPositiveSuffix = cfg.globalPositiveSuffix || '';
            store.globalNegative = cfg.globalNegative || '';
            store.activeId = cfg.activeId || '';
            store.position = cfg.position || 'prepend';
        } else {
            const hostStore = RBQ.api.getSettings?.()?.['_promptPresets'];
            store.globalPositivePrefix = hostStore?.globalPositivePrefix || '';
            store.globalPositiveSuffix = hostStore?.globalPositiveSuffix || '';
            store.globalNegative = hostStore?.globalNegative || '';
            store.activeId = hostStore?.activeId || '';
            store.position = hostStore?.position || 'prepend';
        }
        if (typeof renderPresetUi === 'function') {
            renderPresetUi();
        }
        const preset = getActivePreset();
        try {
            if (preset) {
                restorePresetVibesToHost(preset);
            } else {
                RBQ.api.setNaiVibes?.([], { source: 'plugin:preset-clear' });
                RBQ.api.refreshNaiVibeUi?.();
            }
        } catch (_e) {}
    });

    // ── Checkbox Dialog ──
    function showCheckboxDialog(title, items, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';
        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#1e1e2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:16px;min-width:320px;max-width:480px;max-height:70vh;display:flex;flex-direction:column;gap:10px;color:#fff;box-shadow:0 12px 40px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'font-size:15px;font-weight:600;display:flex;align-items:center;gap:6px;';
        header.innerHTML = '<i class="fa-solid fa-list-check"></i> ' + title;

        const selectAllRow = document.createElement('div');
        selectAllRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);';
        const selectAllCb = document.createElement('input');
        selectAllCb.type = 'checkbox';
        selectAllCb.checked = true;
        const selectAllLabel = document.createElement('span');
        selectAllLabel.textContent = '全选 / 取消全选';
        selectAllLabel.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.6);';
        selectAllRow.append(selectAllCb, selectAllLabel);

        const listDiv = document.createElement('div');
        listDiv.style.cssText = 'overflow-y:auto;max-height:40vh;display:flex;flex-direction:column;gap:4px;';

        const checkboxes = [];
        for (const item of items) {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.04);cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.dataset.itemId = item.id;
            cb.style.marginTop = '3px';
            const info = document.createElement('div');
            info.style.cssText = 'flex:1;';
            info.innerHTML = '<div style="font-size:13px;font-weight:500;">' + (item.name || item.id) + '</div>'
                + (item.positive ? '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px;">正: ' + item.positive.slice(0, 80) + '</div>' : '')
                + (item.negative ? '<div style="font-size:11px;color:rgba(255,200,200,0.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px;">负: ' + item.negative.slice(0, 80) + '</div>' : '');
            row.append(cb, info);
            listDiv.appendChild(row);
            checkboxes.push(cb);
        }

        selectAllCb.addEventListener('change', () => {
            checkboxes.forEach(cb => cb.checked = selectAllCb.checked);
        });

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:4px;';
        const btnCancel = document.createElement('button');
        btnCancel.className = 'menu_button';
        btnCancel.style.cssText = 'font-size:12px;padding:4px 14px;';
        btnCancel.textContent = '取消';
        btnCancel.onclick = () => overlay.remove();
        const btnOk = document.createElement('button');
        btnOk.className = 'menu_button';
        btnOk.style.cssText = 'font-size:12px;padding:4px 14px;';
        btnOk.textContent = '确认';
        btnOk.onclick = () => {
            const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => cb.dataset.itemId);
            overlay.remove();
            onConfirm(selectedIds);
        };
        btnRow.append(btnCancel, btnOk);

        dialog.append(header, selectAllRow, listDiv, btnRow);
        overlay.appendChild(dialog);
        // CRITICAL: stop bubbling from dialog elements too
        overlay.addEventListener('change', (e) => e.stopPropagation());
        overlay.addEventListener('input', (e) => e.stopPropagation());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ── UI Injection ──
    function waitForPanel(cb) {
        const check = () => {
            const panel = document.querySelector('[data-kite-panel="prompt"]');
            if (panel) return cb(panel);
            setTimeout(check, 300);
        };
        check();
    }

    waitForPanel((panel) => {
        document.getElementById('rbq-prompt-presets-panel')?.remove();

        // ── Scoped Styles ──
        document.getElementById('rbq-pp-styles')?.remove();
        const styleEl = document.createElement('style');
        styleEl.id = 'rbq-pp-styles';
        styleEl.textContent = `
            #rbq-prompt-presets-panel {
                margin-top: 6px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .rbq-pp-card {
                background: var(--linear-surface, #141517);
                border: 1px solid var(--linear-border-standard, rgba(255, 255, 255, 0.08));
                border-radius: 10px;
                padding: 12px;
                box-sizing: border-box;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }
            .rbq-pp-card:hover {
                border-color: rgba(255, 255, 255, 0.12);
            }
            .rbq-pp-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .rbq-pp-header-title {
                font-size: 13px;
                font-weight: 600;
                color: var(--linear-text-primary, #f7f8f8);
                display: flex;
                align-items: center;
                gap: 8px;
                letter-spacing: -0.2px;
            }
            .rbq-pp-header-icon {
                width: 26px;
                height: 26px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 7px;
                background: linear-gradient(135deg, rgba(94, 106, 210, 0.25), rgba(113, 112, 255, 0.1));
                color: #828fff;
                font-size: 12px;
                border: 1px solid rgba(94, 106, 210, 0.35);
                flex-shrink: 0;
            }
            .rbq-pp-header-badge {
                font-size: 10.5px;
                font-weight: 600;
                padding: 2px 8px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.05);
                color: var(--linear-text-muted, #8a8f98);
                border: 1px solid var(--linear-border-subtle, rgba(255, 255, 255, 0.05));
                transition: all 0.2s ease;
            }
            .rbq-pp-collapsible-btn {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                background: transparent;
                border: none;
                padding: 0;
                color: inherit;
                cursor: pointer;
                font: inherit;
                text-align: left;
            }
            .rbq-pp-chevron {
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                color: var(--linear-text-muted, #8a8f98);
                font-size: 11px;
            }
            .rbq-pp-collapsible-open .rbq-pp-chevron {
                transform: rotate(180deg);
            }
            .rbq-pp-field {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .rbq-pp-field-label {
                font-size: 11.5px;
                font-weight: 500;
                color: var(--linear-text-secondary, #d0d6e0);
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .rbq-pp-field-tag {
                font-size: 10px;
                font-weight: 600;
                padding: 1px 5px;
                border-radius: 4px;
                letter-spacing: 0.3px;
            }
            .rbq-pp-tag-prefix {
                background: rgba(56, 189, 248, 0.15);
                color: #38bdf8;
                border: 1px solid rgba(56, 189, 248, 0.3);
            }
            .rbq-pp-tag-suffix {
                background: rgba(232, 121, 249, 0.15);
                color: #e879f9;
                border: 1px solid rgba(232, 121, 249, 0.3);
            }
            .rbq-pp-tag-neg {
                background: rgba(248, 113, 113, 0.15);
                color: #f87171;
                border: 1px solid rgba(248, 113, 113, 0.3);
            }
            .rbq-pp-textarea, .rbq-pp-input {
                width: 100%;
                box-sizing: border-box;
                background: rgba(0, 0, 0, 0.25) !important;
                border: 1px solid var(--linear-border-standard, rgba(255, 255, 255, 0.08)) !important;
                border-radius: 6px !important;
                padding: 7px 10px !important;
                color: var(--linear-text-primary, #f7f8f8) !important;
                font-size: 12.5px !important;
                line-height: 1.5 !important;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease !important;
            }
            .rbq-pp-textarea:focus, .rbq-pp-input:focus {
                outline: none !important;
                border-color: #5e6ad2 !important;
                box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.25) !important;
                background: rgba(0, 0, 0, 0.35) !important;
            }
            .rbq-pp-selector-row {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            .rbq-pp-select-wrap {
                flex: 1;
                position: relative;
                display: flex;
                align-items: center;
            }
            .rbq-pp-select {
                width: 100%;
                appearance: none;
                -webkit-appearance: none;
                background: var(--linear-surface, #191a1b);
                border: 1px solid var(--linear-border-standard, rgba(255, 255, 255, 0.1));
                color: var(--linear-text-primary, #f7f8f8);
                font-size: 12.5px;
                font-weight: 500;
                padding: 7px 28px 7px 10px;
                border-radius: 7px;
                outline: none;
                cursor: pointer;
                transition: all 0.15s ease;
                box-sizing: border-box;
            }
            .rbq-pp-select:hover {
                border-color: rgba(255, 255, 255, 0.2);
                background: var(--linear-surface-hover, #242528);
            }
            .rbq-pp-select:focus {
                border-color: #5e6ad2;
                box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.25);
            }
            .rbq-pp-select-arrow {
                position: absolute;
                right: 10px;
                pointer-events: none;
                color: var(--linear-text-muted, #8a8f98);
                font-size: 10px;
            }
            .rbq-pp-pos-select {
                width: 110px;
                appearance: none;
                -webkit-appearance: none;
                background: var(--linear-surface, #191a1b);
                border: 1px solid var(--linear-border-standard, rgba(255, 255, 255, 0.1));
                color: var(--linear-text-secondary, #d0d6e0);
                font-size: 12px;
                font-weight: 500;
                padding: 7px 24px 7px 9px;
                border-radius: 7px;
                outline: none;
                cursor: pointer;
                transition: all 0.15s ease;
                box-sizing: border-box;
            }
            .rbq-pp-pos-select:hover {
                border-color: rgba(255, 255, 255, 0.2);
                color: var(--linear-text-primary, #f7f8f8);
            }
            .rbq-pp-toggle-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                background: var(--linear-bg-subtle, rgba(255, 255, 255, 0.02));
                border: 1px solid var(--linear-border-subtle, rgba(255, 255, 255, 0.05));
                border-radius: 8px;
                cursor: pointer;
                transition: background 0.15s ease;
                margin: 0;
            }
            .rbq-pp-toggle-row:hover {
                background: rgba(255, 255, 255, 0.04);
            }
            .rbq-pp-toggle-info {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .rbq-pp-toggle-title {
                font-size: 12.5px;
                font-weight: 500;
                color: var(--linear-text-primary, #f7f8f8);
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .rbq-pp-toggle-sub {
                font-size: 11px;
                color: var(--linear-text-muted, #8a8f98);
            }
            .rbq-pp-switch {
                position: relative;
                display: inline-block;
                width: 36px;
                height: 20px;
                flex-shrink: 0;
            }
            .rbq-pp-switch input {
                opacity: 0;
                width: 0;
                height: 0;
                margin: 0;
            }
            .rbq-pp-slider {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: rgba(255, 255, 255, 0.15);
                transition: 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }
            .rbq-pp-slider:before {
                position: absolute;
                content: "";
                height: 14px;
                width: 14px;
                left: 2px;
                bottom: 2px;
                background-color: #fff;
                transition: 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
            }
            .rbq-pp-switch input:checked + .rbq-pp-slider {
                background-color: #5e6ad2;
                border-color: #7170ff;
            }
            .rbq-pp-switch input:checked + .rbq-pp-slider:before {
                transform: translateX(16px);
            }
            .rbq-pp-toolbar {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 8px;
            }
            @media (max-width: 520px) {
                .rbq-pp-toolbar {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
            }
            .rbq-pp-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 6px 10px;
                font-size: 12px;
                font-weight: 500;
                border-radius: 7px;
                cursor: pointer;
                border: 1px solid transparent;
                transition: all 0.15s ease;
                white-space: nowrap;
                text-decoration: none;
                box-sizing: border-box;
            }
            .rbq-pp-btn:active {
                transform: scale(0.98);
            }
            .rbq-pp-btn-primary {
                background: linear-gradient(135deg, #5e6ad2, #7170ff);
                color: #ffffff;
                box-shadow: 0 2px 6px rgba(94, 106, 210, 0.25);
                border-color: rgba(255, 255, 255, 0.15);
            }
            .rbq-pp-btn-primary:hover {
                background: linear-gradient(135deg, #6c78e0, #8281ff);
                box-shadow: 0 3px 10px rgba(94, 106, 210, 0.4);
            }
            .rbq-pp-btn-secondary {
                background: var(--linear-bg-subtle, rgba(255, 255, 255, 0.04));
                border-color: var(--linear-border-standard, rgba(255, 255, 255, 0.08));
                color: var(--linear-text-primary, #f7f8f8);
            }
            .rbq-pp-btn-secondary:hover {
                background: var(--linear-surface-hover, rgba(255, 255, 255, 0.08));
                border-color: rgba(255, 255, 255, 0.15);
            }
            .rbq-pp-btn-danger-ghost {
                background: rgba(239, 68, 68, 0.06);
                border-color: rgba(239, 68, 68, 0.18);
                color: #fca5a5;
            }
            .rbq-pp-btn-danger-ghost:hover {
                background: rgba(239, 68, 68, 0.12);
                border-color: rgba(239, 68, 68, 0.35);
                color: #ef4444;
            }
            #rbq-pp-editor {
                border-top: 2px solid #5e6ad2;
                animation: rbq-pp-fade-in 0.2s ease-out;
            }
            @keyframes rbq-pp-fade-in {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .rbq-pp-terminal {
                background: #0d0e11;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            }
            .rbq-pp-terminal-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 7px 12px;
                background: rgba(255, 255, 255, 0.02);
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                flex-wrap: wrap;
                gap: 6px;
            }
            .rbq-pp-terminal-left {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .rbq-pp-terminal-dots {
                display: flex;
                gap: 5px;
            }
            .rbq-pp-dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
            }
            .rbq-pp-dot-red { background: #ff5f56; }
            .rbq-pp-dot-yellow { background: #ffbd2e; }
            .rbq-pp-dot-green { background: #27c93f; }
            .rbq-pp-terminal-title {
                font-size: 11px;
                font-weight: 600;
                color: var(--linear-text-secondary, #d0d6e0);
                display: flex;
                align-items: center;
                gap: 6px;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            }
            .rbq-pp-beacon {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #38bdf8;
                box-shadow: 0 0 8px #38bdf8;
                animation: rbq-pp-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
            }
            @keyframes rbq-pp-ping {
                0% { transform: scale(0.95); opacity: 0.8; }
                50% { transform: scale(1.3); opacity: 1; box-shadow: 0 0 10px #38bdf8; }
                100% { transform: scale(0.95); opacity: 0.8; }
            }
            .rbq-pp-copy-group {
                display: flex;
                align-items: center;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 6px;
                padding: 2px;
                gap: 2px;
            }
            .rbq-pp-copy-btn {
                background: transparent;
                border: none;
                color: var(--linear-text-muted, #8a8f98);
                font-size: 11px;
                font-weight: 500;
                padding: 2px 7px;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 4px;
                transition: all 0.15s ease;
            }
            .rbq-pp-copy-btn:hover {
                color: var(--linear-text-primary, #f7f8f8);
                background: rgba(255, 255, 255, 0.06);
            }
            .rbq-pp-copy-btn.copied {
                color: #10b981 !important;
                background: rgba(16, 185, 129, 0.15) !important;
                font-weight: 600;
            }
            .rbq-pp-terminal-body {
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .rbq-pp-code-box {
                background: rgba(0, 0, 0, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 6px;
                padding: 8px 10px;
                font-size: 11.5px;
                line-height: 1.6;
                color: #e2e8f0;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                word-break: break-word;
                max-height: 110px;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
            }
            .rbq-pp-code-box::-webkit-scrollbar {
                width: 4px;
            }
            .rbq-pp-code-box::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 4px;
            }
            .rbq-pp-token-prefix {
                background: rgba(56, 189, 248, 0.14);
                color: #7dd3fc;
                border: 1px solid rgba(56, 189, 248, 0.3);
                border-radius: 4px;
                padding: 1px 6px;
                font-weight: 500;
                display: inline-block;
                margin: 1px 0;
            }
            .rbq-pp-token-preset {
                background: rgba(168, 85, 247, 0.14);
                color: #c084fc;
                border: 1px solid rgba(168, 85, 247, 0.3);
                border-radius: 4px;
                padding: 1px 6px;
                font-weight: 500;
                display: inline-block;
                margin: 1px 0;
            }
            .rbq-pp-token-dynamic {
                background: rgba(94, 106, 210, 0.22);
                color: #a5b4fc;
                border: 1px dashed rgba(129, 140, 248, 0.6);
                border-radius: 4px;
                padding: 1px 7px;
                font-weight: 600;
                display: inline-block;
                margin: 1px 0;
                letter-spacing: 0.2px;
            }
            .rbq-pp-token-suffix {
                background: rgba(244, 114, 182, 0.14);
                color: #f472b6;
                border: 1px solid rgba(244, 114, 182, 0.3);
                border-radius: 4px;
                padding: 1px 6px;
                font-weight: 500;
                display: inline-block;
                margin: 1px 0;
            }
            .rbq-pp-token-neg-global {
                background: rgba(248, 113, 113, 0.14);
                color: #fca5a5;
                border: 1px solid rgba(248, 113, 113, 0.3);
                border-radius: 4px;
                padding: 1px 6px;
                font-weight: 500;
                display: inline-block;
                margin: 1px 0;
            }
            .rbq-pp-token-neg-preset {
                background: rgba(251, 146, 60, 0.14);
                color: #fdba74;
                border: 1px solid rgba(251, 146, 60, 0.3);
                border-radius: 4px;
                padding: 1px 6px;
                font-weight: 500;
                display: inline-block;
                margin: 1px 0;
            }
        `;
        document.head.appendChild(styleEl);

        const container = document.createElement('div');
        container.className = 'st-scene-trigger-subpanel rbq-pp-root';
        container.id = 'rbq-prompt-presets-panel';
        container.innerHTML = `
            <div class="rbq-pp-header" style="margin-bottom: 2px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="rbq-pp-header-icon">
                        <i class="fa-solid fa-bookmark"></i>
                    </div>
                    <div>
                        <div class="rbq-pp-header-title">提示词预设 <span style="font-size: 11px; opacity: 0.6; font-weight: 400; font-family: monospace;">Prompt Presets</span></div>
                        <div style="font-size: 11.5px; color: var(--linear-text-muted, #8a8f98); margin-top: 1px;">保存常用提示词组合为预设，生图时自动拼接到主提示词</div>
                    </div>
                </div>
            </div>

            <!-- 全局提示词卡片 (支持折叠收起以节省纵向空间) -->
            <div class="rbq-pp-card" id="rbq-pp-global-card" style="padding: 10px 12px;">
                <button type="button" class="rbq-pp-collapsible-btn" id="rbq-pp-global-toggle" title="展开/收起全局提示词">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-earth-americas" style="color: #38bdf8; font-size: 13px;"></i>
                        <span style="font-size: 12.5px; font-weight: 600; color: var(--linear-text-primary, #f7f8f8);">全局提示词</span>
                        <span style="font-size: 10.5px; color: var(--linear-text-muted, #8a8f98);">(无论选择何种预设均生效)</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span id="rbq-pp-global-status-badge" class="rbq-pp-header-badge" style="display: none; color: #38bdf8; background: rgba(56,189,248,0.1); border-color: rgba(56,189,248,0.25);">已生效</span>
                        <i class="fa-solid fa-chevron-down rbq-pp-chevron"></i>
                    </div>
                </button>
                <div id="rbq-pp-global-content" style="display: none; flex-direction: column; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--linear-border-subtle, rgba(255, 255, 255, 0.05));">
                    <div class="rbq-pp-field">
                        <div class="rbq-pp-field-label">
                            <span class="rbq-pp-field-tag rbq-pp-tag-prefix">Prefix 前置</span>
                            <span>全局正面提示词</span>
                        </div>
                        <textarea id="rbq-pp-global-pos-prefix" class="rbq-pp-textarea" data-action="plugin-ignore" rows="2" placeholder="例如: masterpiece, best quality, photorealistic... (始终拼在最前面)"></textarea>
                    </div>
                    <div class="rbq-pp-field">
                        <div class="rbq-pp-field-label">
                            <span class="rbq-pp-field-tag rbq-pp-tag-suffix">Suffix 后置</span>
                            <span>全局正面提示词</span>
                        </div>
                        <textarea id="rbq-pp-global-pos-suffix" class="rbq-pp-textarea" data-action="plugin-ignore" rows="2" placeholder="例如: year 2025, cinematic lighting... (始终拼在最后面)"></textarea>
                    </div>
                    <div class="rbq-pp-field">
                        <div class="rbq-pp-field-label">
                            <span class="rbq-pp-field-tag rbq-pp-tag-neg">Negative</span>
                            <span>全局负面提示词</span>
                        </div>
                        <textarea id="rbq-pp-global-negative" class="rbq-pp-textarea" data-action="plugin-ignore" rows="2" placeholder="例如: lowres, bad anatomy, worst quality... (自动合并生效)"></textarea>
                    </div>
                </div>
            </div>

            <!-- 预设选择器与插入方位控制栏 -->
            <div class="rbq-pp-selector-row">
                <div class="rbq-pp-select-wrap">
                    <select id="rbq-pp-select" class="rbq-pp-select" data-action="plugin-ignore"></select>
                    <i class="fa-solid fa-chevron-down rbq-pp-select-arrow"></i>
                </div>
                <div style="position: relative; display: flex; align-items: center;">
                    <select id="rbq-pp-position" class="rbq-pp-pos-select" data-action="plugin-ignore">
                        <option value="prepend">⬅️ 前置插入</option>
                        <option value="append">➡️ 后置插入</option>
                    </select>
                    <i class="fa-solid fa-chevron-down rbq-pp-select-arrow" style="right: 8px;"></i>
                </div>
            </div>

            <!-- 当前预设编辑画布 (仅在选中预设时展示) -->
            <div id="rbq-pp-editor" class="rbq-pp-card" style="display: none; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="font-size: 12px; font-weight: 600; color: #a78bfa; display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-sliders"></i>
                        <span>编辑当前预设</span>
                    </div>
                    <span style="font-size: 10.5px; color: var(--linear-text-muted, #8a8f98);">保存时自动记录当前 NAI 氛围图 (Vibe) 状态</span>
                </div>
                <div class="rbq-pp-field">
                    <div class="rbq-pp-field-label">
                        <span>预设名称</span>
                    </div>
                    <input id="rbq-pp-name" class="rbq-pp-input" data-action="plugin-ignore" type="text" placeholder="例如: 高质量通用">
                </div>
                <div class="rbq-pp-field">
                    <div class="rbq-pp-field-label">
                        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 6px #4ade80;"></span>
                        <span>预设正面提示词</span>
                    </div>
                    <textarea id="rbq-pp-positive" class="rbq-pp-textarea" data-action="plugin-ignore" rows="3" placeholder="例如: masterpiece, best quality, highly detailed..."></textarea>
                </div>
                <div class="rbq-pp-field">
                    <div class="rbq-pp-field-label">
                        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #f87171; box-shadow: 0 0 6px #f87171;"></span>
                        <span>预设负面提示词</span>
                    </div>
                    <textarea id="rbq-pp-negative" class="rbq-pp-textarea" data-action="plugin-ignore" rows="3" placeholder="例如: lowres, bad anatomy, worst quality..."></textarea>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--linear-border-subtle, rgba(255, 255, 255, 0.05));">
                    <button id="rbq-pp-delete" type="button" class="rbq-pp-btn rbq-pp-btn-danger-ghost">
                        <i class="fa-solid fa-trash"></i> 删除预设
                    </button>
                    <button id="rbq-pp-save" type="button" class="rbq-pp-btn rbq-pp-btn-primary">
                        <i class="fa-solid fa-floppy-disk"></i> 保存预设
                    </button>
                </div>
            </div>

            <!-- 悬浮球快捷切换 (iOS / Linear 风格 Switch Toggle) -->
            <label class="rbq-pp-toggle-row" for="rbq-pp-show-floating">
                <div class="rbq-pp-toggle-info">
                    <span class="rbq-pp-toggle-title">
                        <i class="fa-solid fa-wand-magic-sparkles" style="color: #a78bfa;"></i>
                        在悬浮球菜单中显示快捷切换
                    </span>
                    <span class="rbq-pp-toggle-sub">生图悬浮球打开后可在子菜单一键切换生效预设</span>
                </div>
                <div class="rbq-pp-switch">
                    <input type="checkbox" id="rbq-pp-show-floating" data-action="plugin-ignore">
                    <span class="rbq-pp-slider"></span>
                </div>
            </label>

            <!-- 操作工具栏 -->
            <div class="rbq-pp-toolbar">
                <button id="rbq-pp-new" type="button" class="rbq-pp-btn rbq-pp-btn-secondary" style="border-color: rgba(94,106,210,0.35); color: #828fff;">
                    <i class="fa-solid fa-plus"></i> 新建预设
                </button>
                <button id="rbq-pp-export" type="button" class="rbq-pp-btn rbq-pp-btn-secondary">
                    <i class="fa-solid fa-file-export"></i> 导出预设
                </button>
                <button id="rbq-pp-import-btn" type="button" class="rbq-pp-btn rbq-pp-btn-secondary">
                    <i class="fa-solid fa-file-import"></i> 导入预设
                </button>
                <button id="rbq-pp-batch-delete" type="button" class="rbq-pp-btn rbq-pp-btn-danger-ghost">
                    <i class="fa-solid fa-trash-can"></i> 批量删除
                </button>
                <input id="rbq-pp-import-file" type="file" accept=".json" hidden>
            </div>

            <!-- 动态合成实时预览卡片 (Terminal Inspector) -->
            <div id="rbq-pp-live-preview-box" class="rbq-pp-terminal">
                <div class="rbq-pp-terminal-bar">
                    <div class="rbq-pp-terminal-left">
                        <div class="rbq-pp-terminal-dots">
                            <span class="rbq-pp-dot rbq-pp-dot-red"></span>
                            <span class="rbq-pp-dot rbq-pp-dot-yellow"></span>
                            <span class="rbq-pp-dot rbq-pp-dot-green"></span>
                        </div>
                        <div class="rbq-pp-terminal-title">
                            <span class="rbq-pp-beacon"></span>
                            <span>LIVE PROMPT PIPELINE</span>
                        </div>
                    </div>
                    <div class="rbq-pp-copy-group">
                        <button id="rbq-pp-copy-pos-preview" class="rbq-pp-copy-btn" type="button" title="复制正面提示词合成模板">
                            <i class="fa-regular fa-copy"></i> <span>复制正面</span>
                        </button>
                        <div style="width: 1px; height: 12px; background: rgba(255,255,255,0.1);"></div>
                        <button id="rbq-pp-copy-neg-preview" class="rbq-pp-copy-btn" type="button" title="复制负面提示词合成模板">
                            <i class="fa-regular fa-copy"></i> <span>复制负面</span>
                        </button>
                    </div>
                </div>
                <div class="rbq-pp-terminal-body">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-size: 11px; color: var(--linear-text-muted, #8a8f98); display: flex; align-items: center; gap: 6px;">
                            <span style="color: #38bdf8; font-weight: 600; font-family: monospace;">[POSITIVE]</span>
                            <span>发送至 ComfyUI / NAI 的最终正面提示词：</span>
                        </div>
                        <div id="rbq-pp-preview-positive" class="rbq-pp-code-box"></div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div style="font-size: 11px; color: var(--linear-text-muted, #8a8f98); display: flex; align-items: center; gap: 6px;">
                            <span style="color: #f87171; font-weight: 600; font-family: monospace;">[NEGATIVE]</span>
                            <span>最终负面提示词：</span>
                        </div>
                        <div id="rbq-pp-preview-negative" class="rbq-pp-code-box" style="max-height: 80px;"></div>
                    </div>
                </div>
            </div>
        `;

        const helpBox = panel.querySelector('.st-scene-trigger-help-box');
        if (helpBox) {
            helpBox.parentElement.insertBefore(container, helpBox);
            helpBox.style.display = 'none';
        } else {
            panel.appendChild(container);
        }
        const oldPreviewBox = panel.querySelector('.st-scene-trigger-preview-box');
        if (oldPreviewBox) oldPreviewBox.style.display = 'none';

        // CRITICAL: Stop change events from bubbling out of our plugin UI
        // The host modal has a global 'change' listener that calls saveFromModal(),
        // which would reset the NAI URL to official if triggered from here.
        container.addEventListener('change', (e) => e.stopPropagation());
        container.addEventListener('input', (e) => e.stopPropagation());

        const globalPosPreInput = document.getElementById('rbq-pp-global-pos-prefix');
        const globalPosSufInput = document.getElementById('rbq-pp-global-pos-suffix');
        const globalNegInput = document.getElementById('rbq-pp-global-negative');
        const globalToggle = document.getElementById('rbq-pp-global-toggle');
        const globalContent = document.getElementById('rbq-pp-global-content');
        const globalStatusBadge = document.getElementById('rbq-pp-global-status-badge');
        const select = document.getElementById('rbq-pp-select');
        const posSelect = document.getElementById('rbq-pp-position');
        const floatingCheckbox = document.getElementById('rbq-pp-show-floating');
        const editor = document.getElementById('rbq-pp-editor');
        const nameInput = document.getElementById('rbq-pp-name');
        const posInput = document.getElementById('rbq-pp-positive');
        const negInput = document.getElementById('rbq-pp-negative');

        let isGlobalExpanded = false;
        function updateGlobalBadge() {
            const pre = (globalPosPreInput?.value || '').trim();
            const suf = (globalPosSufInput?.value || '').trim();
            const neg = (globalNegInput?.value || '').trim();
            let count = 0;
            if (pre) count++;
            if (suf) count++;
            if (neg) count++;
            if (globalStatusBadge) {
                if (count > 0) {
                    globalStatusBadge.textContent = `已配置 (${count})`;
                    globalStatusBadge.style.display = 'inline-flex';
                } else {
                    globalStatusBadge.style.display = 'none';
                }
            }
        }

        globalToggle?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isGlobalExpanded = !isGlobalExpanded;
            if (globalContent) globalContent.style.display = isGlobalExpanded ? 'flex' : 'none';
            globalToggle.classList.toggle('rbq-pp-collapsible-open', isGlobalExpanded);
        });

        function renderLivePreview() {
            const store = getStore();
            const preset = getActivePreset();
            const pos = posSelect?.value || store.position || 'prepend';
            const gPre = (globalPosPreInput?.value ?? store.globalPositivePrefix ?? '').trim();
            const gSuf = (globalPosSufInput?.value ?? store.globalPositiveSuffix ?? '').trim();
            const gNeg = (globalNegInput?.value ?? store.globalNegative ?? '').trim();
            const presetPos = preset ? (posInput?.value ?? preset.positive ?? '').trim() : '';
            const presetNeg = preset ? (negInput?.value ?? preset.negative ?? '').trim() : '';

            const posContainer = document.getElementById('rbq-pp-preview-positive');
            if (posContainer) {
                const dummyDynamic = '<span class="rbq-pp-token-dynamic" title="动态剧情/分镜生图提示词">&lt;剧情/分镜生图提示词&gt;</span>';
                let parts = [];
                if (gPre) parts.push(`<span class="rbq-pp-token-prefix" title="全局正面前缀">${escapeHtml(gPre)}</span>`);
                if (pos === 'prepend') {
                    if (presetPos) parts.push(`<span class="rbq-pp-token-preset" title="当前预设正面词 (前置)">${escapeHtml(presetPos)}</span>`);
                    parts.push(dummyDynamic);
                } else {
                    parts.push(dummyDynamic);
                    if (presetPos) parts.push(`<span class="rbq-pp-token-preset" title="当前预设正面词 (后置)">${escapeHtml(presetPos)}</span>`);
                }
                if (gSuf) parts.push(`<span class="rbq-pp-token-suffix" title="全局正面后缀">${escapeHtml(gSuf)}</span>`);
                posContainer.innerHTML = parts.join('<span style="color:rgba(255,255,255,0.3);margin:0 4px;font-weight:bold;">, </span>');
            }

            const negContainer = document.getElementById('rbq-pp-preview-negative');
            if (negContainer) {
                let negParts = [];
                if (gNeg) negParts.push(`<span class="rbq-pp-token-neg-global" title="全局负面词">${escapeHtml(gNeg)}</span>`);
                if (presetNeg) negParts.push(`<span class="rbq-pp-token-neg-preset" title="当前预设负面词">${escapeHtml(presetNeg)}</span>`);
                negContainer.innerHTML = negParts.length
                    ? negParts.join('<span style="color:rgba(255,255,255,0.3);margin:0 4px;font-weight:bold;">, </span>')
                    : '<span style="color:rgba(255,255,255,0.25);font-style:italic;">(未设置负面提示词)</span>';
            }
        }

        globalPosPreInput?.addEventListener('input', () => {
            getStore().globalPositivePrefix = globalPosPreInput.value;
            save();
            updateGlobalBadge();
            renderLivePreview();
        });

        globalPosSufInput?.addEventListener('input', () => {
            getStore().globalPositiveSuffix = globalPosSufInput.value;
            save();
            updateGlobalBadge();
            renderLivePreview();
        });

        globalNegInput?.addEventListener('input', () => {
            getStore().globalNegative = globalNegInput.value;
            save();
            updateGlobalBadge();
            renderLivePreview();
        });

        posInput?.addEventListener('input', () => {
            renderLivePreview();
        });

        negInput?.addEventListener('input', () => {
            renderLivePreview();
        });

        let copyPosTimer = null;
        document.getElementById('rbq-pp-copy-pos-preview')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const store = getStore();
            const preset = getActivePreset();
            const pos = posSelect?.value || store.position || 'prepend';
            const gPre = (globalPosPreInput?.value ?? store.globalPositivePrefix ?? '').trim();
            const gSuf = (globalPosSufInput?.value ?? store.globalPositiveSuffix ?? '').trim();
            const presetPos = preset ? (posInput?.value ?? preset.positive ?? '').trim() : '';
            const assembled = resolvePositivePrompt('{prompt}', presetPos, gPre, gSuf, pos);

            const showFeedback = () => {
                const icon = btn.querySelector('i');
                const textSpan = btn.querySelector('span');
                if (icon) icon.className = 'fa-solid fa-check';
                if (textSpan) textSpan.textContent = '已复制!';
                btn.classList.add('copied');
                clearTimeout(copyPosTimer);
                copyPosTimer = setTimeout(() => {
                    if (icon) icon.className = 'fa-regular fa-copy';
                    if (textSpan) textSpan.textContent = '复制正面';
                    btn.classList.remove('copied');
                }, 1800);
            };

            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(assembled).then(() => {
                    showFeedback();
                    toastr.success('已复制正面合成模板');
                }).catch(() => {
                    toastr.info('请手动复制: ' + assembled);
                });
            } else {
                toastr.info('请手动复制: ' + assembled);
            }
        });

        let copyNegTimer = null;
        document.getElementById('rbq-pp-copy-neg-preview')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const store = getStore();
            const preset = getActivePreset();
            const gNeg = (globalNegInput?.value ?? store.globalNegative ?? '').trim();
            const presetNeg = preset ? (negInput?.value ?? preset.negative ?? '').trim() : '';
            const assembled = resolveNegativePrompt('', presetNeg, gNeg);
            if (!assembled) {
                toastr.warning('当前无负面提示词');
                return;
            }

            const showFeedback = () => {
                const icon = btn.querySelector('i');
                const textSpan = btn.querySelector('span');
                if (icon) icon.className = 'fa-solid fa-check';
                if (textSpan) textSpan.textContent = '已复制!';
                btn.classList.add('copied');
                clearTimeout(copyNegTimer);
                copyNegTimer = setTimeout(() => {
                    if (icon) icon.className = 'fa-regular fa-copy';
                    if (textSpan) textSpan.textContent = '复制负面';
                    btn.classList.remove('copied');
                }, 1800);
            };

            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(assembled).then(() => {
                    showFeedback();
                    toastr.success('已复制负面合成结果');
                }).catch(() => {
                    toastr.info('请手动复制: ' + assembled);
                });
            } else {
                toastr.info('请手动复制: ' + assembled);
            }
        });

        function applyPresetSelection(nextId) {
            const store = getStore();
            store.activeId = String(nextId || '');
            save();

            // 先同步编辑区与两个选择器，避免后续 Vibe 恢复异常时 UI 停留在旧预设。
            renderSelect();

            const preset = getActivePreset();
            try {
                if (preset) {
                    restorePresetVibesToHost(preset);
                } else {
                    RBQ.api.setNaiVibes?.([], { source: 'plugin:preset-clear' });
                    RBQ.api.refreshNaiVibeUi?.();
                }
            } catch (err) {
                console.error('[Prompt Presets] Failed to restore preset state:', err);
                toastr.error('切换预设时恢复氛围图失败: ' + (err?.message || String(err)));
            }
        }

        function syncFloatingMenu() {
            const store = getStore();
            let pMenu = document.getElementById('rbq-pp-floating-wrap');

            if (store.showFloating) {
                if (!pMenu) {
                    pMenu = document.createElement('div');
                    pMenu.id = 'rbq-pp-floating-wrap';
                    pMenu.className = 'st-scene-trigger-floating-item';
                    pMenu.style.cssText = 'padding:8px 10px; cursor:default;';
                    pMenu.innerHTML = '<i class="fa-solid fa-bookmark" style="width:14px;"></i><select id="rbq-pp-floating-select" style="background:rgba(0,0,0,0.4);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:6px;flex:1;outline:none;padding:2px 4px;font-size:12px;cursor:pointer;" data-action="plugin-ignore"></select>';

                    const menu = document.getElementById('st-scene-trigger-floating-menu');
                    const divider = menu?.querySelector('.st-scene-trigger-floating-divider');
                    if (menu) {
                        if (divider) menu.insertBefore(pMenu, divider);
                        else menu.appendChild(pMenu);
                    }

                    const fSelect = document.getElementById('rbq-pp-floating-select');
                    if (fSelect) {
                        fSelect.addEventListener('change', (e) => {
                            applyPresetSelection(e.target.value);
                        });
                        fSelect.addEventListener('click', e => e.stopPropagation());
                        pMenu.addEventListener('click', e => e.stopPropagation());
                    }
                }

                const fSelect = document.getElementById('rbq-pp-floating-select');
                if (fSelect) {
                    fSelect.innerHTML = '<option value="">-- 不使用预设 --</option>';
                    store.presets.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = p.name || p.id;
                        fSelect.appendChild(opt);
                    });
                    fSelect.value = store.activeId || '';
                }
            } else {
                if (pMenu) pMenu.remove();
            }
        }

        function renderSelect() {
            renderPresetUi = renderSelect;
            const store = getStore();
            if (globalPosPreInput) {
                globalPosPreInput.value = store.globalPositivePrefix || '';
            }
            if (globalPosSufInput) {
                globalPosSufInput.value = store.globalPositiveSuffix || '';
            }
            if (globalNegInput) {
                globalNegInput.value = store.globalNegative || '';
            }
            updateGlobalBadge();
            floatingCheckbox.checked = !!store.showFloating;
            select.innerHTML = '<option value="">-- 不使用预设 --</option>';
            store.presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name || p.id;
                select.appendChild(opt);
            });
            select.value = store.activeId || '';
            posSelect.value = store.position || 'prepend';
            loadEditor();
            syncFloatingMenu();
            renderLivePreview();
        }

        function loadEditor() {
            const preset = getActivePreset();
            if (preset) {
                nameInput.value = preset.name || '';
                posInput.value = preset.positive || '';
                negInput.value = preset.negative || '';
                editor.style.display = 'flex';
            } else {
                nameInput.value = '';
                posInput.value = '';
                negInput.value = '';
                editor.style.display = 'none';
            }
            renderLivePreview();
        }

        select.addEventListener('change', () => {
            applyPresetSelection(select.value);
        });

        posSelect.addEventListener('change', () => {
            getStore().position = posSelect.value;
            save();
            renderLivePreview();
        });

        floatingCheckbox.addEventListener('change', () => {
            getStore().showFloating = floatingCheckbox.checked;
            save();
            syncFloatingMenu();
        });

        document.getElementById('rbq-pp-new').addEventListener('click', () => {
            const name = window.prompt('输入新预设名称：');
            if (!name) return;
            const store = getStore();
            const id = uid();
            store.presets.push({ id, name, positive: '', negative: '' });
            store.activeId = id;
            save();
            renderSelect();
            toastr.success('预设已创建: ' + name);
        });

        document.getElementById('rbq-pp-save').addEventListener('click', () => {
            const preset = getActivePreset();
            if (!preset) return;
            preset.name = nameInput.value.trim() || preset.name;
            preset.positive = posInput.value.trim();
            preset.negative = negInput.value.trim();
            const vibes = getCurrentNaiVibes();
            if (vibes.length > 0) {
                showVibeSaveDialog((mode) => {
                    preset.vibes = snapshotNaiVibes(mode);
                    save();
                    renderSelect();
                    toastr.success('预设已保存: ' + preset.name);
                });
                return;
            }
            preset.vibes = [];
            save();
            renderSelect();
            toastr.success('预设已保存: ' + preset.name);
        });

        document.getElementById('rbq-pp-delete').addEventListener('click', () => {
            const store = getStore();
            const idx = store.presets.findIndex(p => p.id === store.activeId);
            if (idx === -1) return;
            const name = store.presets[idx].name;
            store.presets.splice(idx, 1);
            store.activeId = '';
            save();
            renderSelect();
            toastr.success('预设已删除: ' + name);
        });

        // ── 选择性导出 ──
        document.getElementById('rbq-pp-export').addEventListener('click', () => {
            const store = getStore();
            if (!store.presets.length) return toastr.warning('没有可导出的预设');
            showCheckboxDialog('选择要导出的预设', store.presets, (selectedIds) => {
                const selected = store.presets.filter(p => selectedIds.includes(p.id));
                if (!selected.length) return toastr.warning('未选择任何预设');
                // Export in compatible format (positivePrompt / negativePrompt)
                const exportData = selected.map((p, idx) => ({
                    id: p.id,
                    name: p.name,
                    positivePrompt: p.positive || '',
                    negativePrompt: p.negative || '',
                    sequence: idx,
                    referenceImage: null,
                    thumbnail: null,
                    vibes: Array.isArray(p.vibes) ? p.vibes : [],
                }));
                const data = JSON.stringify(exportData, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const date = new Date().toISOString().slice(0, 10);
                a.href = url;
                a.download = 'prompt-presets-' + date + '.json';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                toastr.success('已导出 ' + selected.length + ' 个预设');
            });
        });

        // ── 选择性导入 ──
        document.getElementById('rbq-pp-import-btn').addEventListener('click', () => {
            document.getElementById('rbq-pp-import-file').click();
        });

        document.getElementById('rbq-pp-import-file').addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const imported = JSON.parse(text);
                if (!Array.isArray(imported)) throw new Error('格式错误：文件内容应为数组');
                const candidates = imported.filter(item => item.name || item.positive || item.negative || item.positivePrompt || item.negativePrompt || (Array.isArray(item.vibes) && item.vibes.length));
                if (!candidates.length) throw new Error('文件中没有有效的预设');

                // Normalize items - support both formats:
                // Plugin native: { positive, negative }
                // External compat: { positivePrompt, negativePrompt, sequence, referenceImage, thumbnail }
                const displayItems = candidates.map((item, idx) => ({
                    id: item.id || uid(),
                    name: item.name || '未命名预设',
                    positive: item.positive || item.positivePrompt || '',
                    negative: item.negative || item.negativePrompt || '',
                    vibes: Array.isArray(item.vibes) ? item.vibes.map(compactVibeEntry).filter(Boolean).slice(0, 6) : [],
                }));

                showCheckboxDialog('选择要导入的预设 (' + file.name + ')', displayItems, (selectedIds) => {
                    const store = getStore();
                    let count = 0;
                    for (const item of displayItems) {
                        if (!selectedIds.includes(item.id)) continue;
                        // Avoid duplicate IDs
                        if (store.presets.some(p => p.id === item.id)) item.id = uid();
                        store.presets.push(item);
                        count++;
                    }
                    save();
                    renderSelect();
                    toastr.success('成功导入 ' + count + ' 个预设');
                });
            } catch (err) {
                toastr.error('导入失败: ' + err.message);
            }
            e.target.value = '';
        });

        // ── 批量删除 ──
        document.getElementById('rbq-pp-batch-delete').addEventListener('click', () => {
            const store = getStore();
            if (!store.presets.length) return toastr.warning('没有任何预设可删除');
            showCheckboxDialog('选择要删除的预设 (警告：操作不可逆)', store.presets, (selectedIds) => {
                if (!selectedIds.length) return toastr.warning('未选择任何预设');
                if (!window.confirm(`确定要永久删除这 ${selectedIds.length} 个预设吗？`)) return;

                // If active preset is getting deleted, clear activeId
                if (selectedIds.includes(store.activeId)) {
                    store.activeId = '';
                }

                // Filter out the deleted ones
                store.presets = store.presets.filter(p => !selectedIds.includes(p.id));
                save();
                renderSelect();
                toastr.success(`已成功删除 ${selectedIds.length} 个预设`);
            });
        });

        renderSelect();
        console.info('[Prompt Presets] UI mounted');
    });

    // ── Neutralize built-in prefix/suffix/negative ─────────────
    // The host extension has its own prefix/suffix/negative fields that overlap
    // with this plugin's functionality. When this plugin is active, hide those
    // fields and clear their values so they don't double-up with preset hooks.
    function neutralizeBuiltinFields() {
        const s = RBQ.api.getSettings();
        const store = getStore();

        // Back up original values (once) so they're not lost forever
        if (!store._builtinBackup) {
            store._builtinBackup = {
                prefix: s.prefix || '',
                suffix: s.suffix || '',
                negative: s.negative || '',
            };
            if (!store.globalPositivePrefix && s.prefix) {
                store.globalPositivePrefix = s.prefix;
            }
            if (!store.globalPositiveSuffix && s.suffix) {
                store.globalPositiveSuffix = s.suffix;
            }
            if (!store.globalNegative && s.negative) {
                store.globalNegative = s.negative;
            }
        }

        // Clear the extension's built-in values so its joinPrompt logic becomes a no-op
        s.prefix = '';
        s.suffix = '';
        s.negative = '';
        save();

        // Hide the DOM fields AND clear their values (prevents saveFromModal from restoring old data)
        ['st-scene-trigger-modal-prefix', 'st-scene-trigger-modal-suffix', 'st-scene-trigger-modal-negative'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                if (el.closest('label')) el.closest('label').style.display = 'none';
            }
        });

        // Hide legacy static prompt preview and syntax help boxes
        const helpBox = document.querySelector('.st-scene-trigger-help-box');
        if (helpBox) helpBox.style.display = 'none';
        const oldPreviewBox = document.querySelector('.st-scene-trigger-preview-box');
        if (oldPreviewBox) oldPreviewBox.style.display = 'none';
    }

    // Run on load and re-run periodically (in case modal reopens and syncUi refills hidden inputs)
    neutralizeBuiltinFields();
    setInterval(() => {
        const el = document.getElementById('st-scene-trigger-modal-prefix');
        const oldPreviewBox = document.querySelector('.st-scene-trigger-preview-box');
        if (!el && !oldPreviewBox) return;
        // Re-neutralize if label became visible again OR if syncUi refilled the hidden input OR old preview appeared
        if (el?.closest('label')?.style.display !== 'none' || el?.value || (oldPreviewBox && oldPreviewBox.style.display !== 'none')) {
            neutralizeBuiltinFields();
        }
    }, 2000);

    console.info('📋 Prompt Presets plugin loaded');
})(RBQ, jQuery, toastr);
