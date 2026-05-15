(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Prompt Presets] RBQ Core API missing');

    const STORAGE_KEY = '_promptPresets';
    const MAX_VIBES = 6;

    // ── Storage ──
    function save() { RBQ.api.saveSettings(); }
    function uid(prefix = 'pp') { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    function sanitizeVibe(item) {
        if (!item || typeof item !== 'object') return null;
        const b64 = String(item.b64 || '').trim();
        const tensor = String(item.tensor || '').trim();
        if (!b64 && !tensor) return null;
        return {
            id: String(item.id || uid('vibe')),
            name: String(item.name || item.filename || '未命名氛围文件').trim() || '未命名氛围文件',
            b64,
            tensor: tensor || null,
            info: Math.max(0, Math.min(1, Number(item.info) || 1)),
            strength: Math.max(0, Math.min(1, Number(item.strength) || 0.6)),
        };
    }

    function cloneVibes(vibes) {
        return (Array.isArray(vibes) ? vibes : [])
            .map(sanitizeVibe)
            .filter(Boolean)
            .slice(0, MAX_VIBES)
            .map(v => ({ ...v }));
    }

    function sanitizePreset(item) {
        if (!item || typeof item !== 'object') return null;
        return {
            id: String(item.id || uid()),
            name: String(item.name || '未命名预设').trim() || '未命名预设',
            positive: String(item.positive || item.positivePrompt || '').trim(),
            negative: String(item.negative || item.negativePrompt || '').trim(),
            vibes: cloneVibes(item.vibes),
        };
    }

    function formatPresetLabel(preset) {
        return `${preset?.name || preset?.id || '未命名预设'}`;
    }

    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { activeId: '', position: 'prepend', showFloating: false, presets: [], manualVibes: [] };
        const store = s[STORAGE_KEY];
        let mutated = false;
        if (store.position !== 'append') store.position = 'prepend';
        store.showFloating = !!store.showFloating;
        const seenPresetIds = new Set();
        store.presets = (Array.isArray(store.presets) ? store.presets : []).map(sanitizePreset).filter(Boolean).map((preset) => {
            if (!preset.id || seenPresetIds.has(preset.id)) {
                preset.id = uid();
                mutated = true;
            }
            seenPresetIds.add(preset.id);
            return preset;
        });
        if (!Array.isArray(store.manualVibes)) {
            store.manualVibes = cloneVibes(RBQ.api.getNaiVibes?.() || []);
            mutated = true;
        } else {
            store.manualVibes = cloneVibes(store.manualVibes);
        }
        if (!store.presets.some(p => p.id === store.activeId)) {
            store.activeId = '';
            mutated = true;
        }
        if (mutated) save();
        return store;
    }

    function getActivePreset() {
        const store = getStore();
        return store.activeId ? store.presets.find(p => p.id === store.activeId) || null : null;
    }

    function readCurrentHostVibes() {
        return cloneVibes(RBQ.api.getNaiVibes?.() || []);
    }

    function snapshotCurrentVibesToActivePreset() {
        const preset = getActivePreset();
        if (!preset) return null;
        const vibes = readCurrentHostVibes();
        preset.vibes = vibes;
        return vibes;
    }

    function snapshotCurrentWorkspaceToStore() {
        const store = getStore();
        if (store.activeId) {
            snapshotCurrentVibesToActivePreset();
        } else {
            store.manualVibes = readCurrentHostVibes();
        }
    }

    function switchActivePreset(nextId) {
        const store = getStore();
        snapshotCurrentWorkspaceToStore();
        store.activeId = String(nextId || '');
        save();
        syncSelectedPresetVibesToHost();
        renderSelect();
    }

    function syncSelectedPresetVibesToHost() {
        const preset = getActivePreset();
        const store = getStore();
        if (preset) {
            RBQ.api.setNaiVibes?.(cloneVibes(preset.vibes), { source: 'plugin:preset-sync' });
        } else {
            RBQ.api.setNaiVibes?.(cloneVibes(store.manualVibes), { source: 'plugin:preset-sync' });
        }
        RBQ.api.refreshNaiVibeUi?.();
    }

    RBQ.on('naiVibesChanged', (state) => {
        if (!state || state.source === 'plugin:preset-sync' || state.preciseRefsActive) return state;
        const store = getStore();
        const vibes = cloneVibes(state.vibes);
        if (store.activeId) {
            const preset = getActivePreset();
            if (preset) preset.vibes = vibes;
        } else {
            store.manualVibes = vibes;
        }
        save();
        return state;
    });

    // ── Join Logic ──
    function joinPrompt(original, presetText, position) {
        const a = (original || '').trim();
        const b = (presetText || '').trim();
        if (!b) return a;
        if (!a) return b;
        return position === 'prepend' ? (b + ', ' + a) : (a + ', ' + b);
    }

    function applyPresetVibesToNaiPayload(payload, preset) {
        const vibes = cloneVibes(preset?.vibes);
        if (!vibes.length || !payload?.parameters) return payload;

        delete payload.parameters.director_reference_images;
        delete payload.parameters.director_reference_strength_values;
        delete payload.parameters.director_reference_information_extracted;
        delete payload.parameters.director_reference_secondary_strength_values;
        delete payload.parameters.director_reference_descriptions;
        delete payload.parameters.normalize_reference_strength_multiple;

        payload.parameters.reference_image_multiple = [];
        payload.parameters.reference_information_extracted_multiple = [];
        payload.parameters.reference_strength_multiple = [];
        payload.parameters.uncond_per_vibe = true;
        payload.parameters.wonky_vibe_correlation = true;

        vibes.forEach((item) => {
            payload.parameters.reference_image_multiple.push(item.tensor || item.b64);
            payload.parameters.reference_information_extracted_multiple.push(Number(item.info) || 1);
            payload.parameters.reference_strength_multiple.push(Number(item.strength) || 0.6);
        });

        return payload;
    }

    // ── Payload Hooks ──
    RBQ.on('buildNaiV4Payload', (payload) => {
        const preset = getActivePreset();
        if (!preset) return payload;
        const pos = getStore().position || 'prepend';
        if (preset.positive) {
            payload.input = joinPrompt(payload.input, preset.positive, pos);
            if (payload.parameters?.v4_prompt?.caption) {
                payload.parameters.v4_prompt.caption.base_caption = joinPrompt(
                    payload.parameters.v4_prompt.caption.base_caption, preset.positive, pos
                );
            }
        }
        if (preset.negative) {
            if (payload.parameters) {
                payload.parameters.negative_prompt = joinPrompt(payload.parameters.negative_prompt, preset.negative, pos);
            }
            if (payload.parameters?.v4_negative_prompt?.caption) {
                payload.parameters.v4_negative_prompt.caption.base_caption = joinPrompt(
                    payload.parameters.v4_negative_prompt.caption.base_caption, preset.negative, pos
                );
            }
        }
        applyPresetVibesToNaiPayload(payload, preset);
        console.info('[Prompt Presets] NAI payload modified:', preset.name, 'vibes:', Array.isArray(preset.vibes) ? preset.vibes.length : 0);
        return payload;
    });

    RBQ.on('buildGeneratePayload', (payload) => {
        const preset = getActivePreset();
        if (!preset) return payload;
        const pos = getStore().position || 'prepend';
        if (preset.positive) payload.positive_prompt = joinPrompt(payload.positive_prompt, preset.positive, pos);
        if (preset.negative) payload.negative_prompt = joinPrompt(payload.negative_prompt, preset.negative, pos);
        console.info('[Prompt Presets] Free payload modified:', preset.name);
        return payload;
    });

    RBQ.on('buildComfyUiWorkflow', (payload) => {
        const preset = getActivePreset();
        if (!preset) return payload;
        const pos = getStore().position || 'prepend';
        for (const key of Object.keys(payload)) {
            const node = payload[key];
            if (node?.class_type === 'CLIPTextEncode' && node?.inputs?.text !== undefined) {
                const isNeg = Object.values(payload).some(n =>
                    n?.inputs?.negative && Array.isArray(n.inputs.negative) && n.inputs.negative[0] === key
                );
                if (isNeg && preset.negative) {
                    node.inputs.text = joinPrompt(node.inputs.text, preset.negative, pos);
                } else if (!isNeg && preset.positive) {
                    node.inputs.text = joinPrompt(node.inputs.text, preset.positive, pos);
                }
            }
        }
        console.info('[Prompt Presets] ComfyUI workflow modified:', preset.name);
        return payload;
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
                + (item.negative ? '<div style="font-size:11px;color:rgba(255,200,200,0.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px;">负: ' + item.negative.slice(0, 80) + '</div>' : '')
                + (item.extraInfo ? '<div style="font-size:11px;color:rgba(180,220,255,0.65);margin-top:2px;">' + item.extraInfo + '</div>' : '');
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

        const container = document.createElement('div');
        container.className = 'st-scene-trigger-subpanel';
        container.id = 'rbq-prompt-presets-panel';
        container.innerHTML = `
            <div class="st-scene-trigger-subpanel-title"><i class="fa-solid fa-bookmark"></i><span>提示词预设 (Prompt Presets)</span></div>
            <div class="st-scene-trigger-subpanel-hint">保存常用提示词组合为预设，生图时自动拼接到主提示词；切换预设时会自动联动 NAI 面板中的 Vibe Transfer 配置。</div>
            <div class="st-scene-trigger-modal-grid">
                <div class="st-scene-trigger-field wide" style="display:flex; gap:6px; align-items:center;">
                    <select id="rbq-pp-select" class="text_pole" data-action="plugin-ignore" style="flex:1; padding: 6px; appearance: auto;"></select>
                    <select id="rbq-pp-position" class="text_pole" data-action="plugin-ignore" style="width:80px; padding: 6px; appearance: auto;">
                        <option value="prepend">前置</option>
                        <option value="append">后置</option>
                    </select>
                </div>
            </div>
            <div id="rbq-pp-editor" style="display:none; margin-top:8px;">
                <div class="st-scene-trigger-modal-grid">
                    <label class="st-scene-trigger-field wide"><span>预设名称</span><input id="rbq-pp-name" data-action="plugin-ignore" type="text" placeholder="例如: 高质量通用"></label>
                    <label class="st-scene-trigger-field wide"><span>正面提示词</span><textarea id="rbq-pp-positive" data-action="plugin-ignore" rows="3" placeholder="masterpiece, best quality, ..."></textarea></label>
                    <label class="st-scene-trigger-field wide"><span>负面提示词</span><textarea id="rbq-pp-negative" data-action="plugin-ignore" rows="3" placeholder="lowres, bad anatomy, ..."></textarea></label>
                </div>
                <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:6px;">
                    <button id="rbq-pp-save" class="menu_button" style="font-size:12px; padding:4px 12px;"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
                    <button id="rbq-pp-delete" class="menu_button" style="font-size:12px; padding:4px 12px; color:#ff4444;"><i class="fa-solid fa-trash"></i> 删除</button>
                </div>
            </div>
            <label class="st-scene-trigger-field wide" style="display:flex; gap:6px; align-items:center; flex-direction:row; cursor:pointer; min-height:auto; padding:8px 14px; margin-top:8px;">
                <input type="checkbox" id="rbq-pp-show-floating" data-action="plugin-ignore" style="width:auto;">
                <span style="font-size:13px; color:rgba(255,255,255,0.7);">在悬浮球菜单中显示快捷切换</span>
            </label>
            <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                <button id="rbq-pp-new" class="menu_button" style="font-size:12px; padding:4px 10px; flex: 1; min-width: max-content; white-space: nowrap;"><i class="fa-solid fa-plus"></i> 新建</button>
                <button id="rbq-pp-export" class="menu_button" style="font-size:12px; padding:4px 10px; flex: 1; min-width: max-content; white-space: nowrap;"><i class="fa-solid fa-file-export"></i> 导出</button>
                <button id="rbq-pp-import-btn" class="menu_button" style="font-size:12px; padding:4px 10px; flex: 1; min-width: max-content; white-space: nowrap;"><i class="fa-solid fa-file-import"></i> 导入</button>
                <button id="rbq-pp-batch-delete" class="menu_button" style="font-size:12px; padding:4px 10px; color:#ff4444; flex: 1; min-width: max-content; white-space: nowrap;"><i class="fa-solid fa-trash-can"></i> 批量删除</button>
                <input id="rbq-pp-import-file" type="file" accept=".json" hidden>
            </div>
        `;

        const helpBox = panel.querySelector('.st-scene-trigger-help-box');
        if (helpBox) {
            helpBox.parentElement.insertBefore(container, helpBox);
        } else {
            panel.appendChild(container);
        }

        container.addEventListener('change', (e) => e.stopPropagation());
        container.addEventListener('input', (e) => e.stopPropagation());

        const select = document.getElementById('rbq-pp-select');
        const posSelect = document.getElementById('rbq-pp-position');
        const floatingCheckbox = document.getElementById('rbq-pp-show-floating');
        const editor = document.getElementById('rbq-pp-editor');
        const nameInput = document.getElementById('rbq-pp-name');
        const posInput = document.getElementById('rbq-pp-positive');
        const negInput = document.getElementById('rbq-pp-negative');

        function snapshotCurrentEditorToActivePreset() {
            const preset = getActivePreset();
            if (!preset) return;
            preset.name = nameInput.value.trim() || preset.name;
            preset.positive = posInput.value.trim();
            preset.negative = negInput.value.trim();
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
                            snapshotCurrentEditorToActivePreset();
                            switchActivePreset(e.target.value);
                        });
                        fSelect.addEventListener('click', e => e.stopPropagation());
                        pMenu.addEventListener('click', e => e.stopPropagation());
                    }
                }

                const fSelect = document.getElementById('rbq-pp-floating-select');
                if (fSelect) {
                    fSelect.innerHTML = '<option value="" style="color:#000">-- 不使用预设 --</option>';
                    store.presets.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = formatPresetLabel(p);
                        opt.style.color = '#000';
                        fSelect.appendChild(opt);
                    });
                    fSelect.value = store.activeId || '';
                }
            } else {
                if (pMenu) pMenu.remove();
            }
        }

        function renderSelect() {
            const store = getStore();
            floatingCheckbox.checked = !!store.showFloating;
            select.innerHTML = '<option value="">-- 不使用预设 --</option>';
            store.presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = formatPresetLabel(p);
                select.appendChild(opt);
            });
            select.value = store.activeId || '';
            posSelect.value = store.position || 'prepend';
            loadEditor();
            syncFloatingMenu();
        }

        function loadEditor() {
            const preset = getActivePreset();
            if (preset) {
                nameInput.value = preset.name || '';
                posInput.value = preset.positive || '';
                negInput.value = preset.negative || '';
                editor.style.display = '';
            } else {
                editor.style.display = 'none';
            }
        }

        select.addEventListener('change', () => {
            snapshotCurrentEditorToActivePreset();
            switchActivePreset(select.value);
        });

        posSelect.addEventListener('change', () => {
            getStore().position = posSelect.value;
            save();
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
            store.presets.push({ id, name, positive: '', negative: '', vibes: [] });
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
            preset.vibes = readCurrentHostVibes();
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
            showCheckboxDialog('选择要导出的预设', store.presets.map((item) => ({
                ...item,
                extraInfo: item.vibes?.length ? `绑定 ${item.vibes.length} 个 Vibe 文件` : '未绑定 Vibe 文件',
            })), (selectedIds) => {
                const selected = store.presets.filter(p => selectedIds.includes(p.id));
                if (!selected.length) return toastr.warning('未选择任何预设');
                const exportData = selected.map((p, idx) => ({
                    id: p.id,
                    name: p.name,
                    positive: p.positive || '',
                    negative: p.negative || '',
                    positivePrompt: p.positive || '',
                    negativePrompt: p.negative || '',
                    sequence: idx,
                    referenceImage: null,
                    thumbnail: null,
                    vibes: cloneVibes(p.vibes),
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

                const displayItems = candidates.map((item) => {
                    const preset = sanitizePreset(item);
                    return {
                        ...preset,
                        extraInfo: preset.vibes.length ? `绑定 ${preset.vibes.length} 个 Vibe 文件` : '未绑定 Vibe 文件',
                    };
                }).filter(Boolean);

                showCheckboxDialog('选择要导入的预设 (' + file.name + ')', displayItems, (selectedIds) => {
                    const store = getStore();
                    let count = 0;
                    for (const item of displayItems) {
                        if (!selectedIds.includes(item.id)) continue;
                        if (store.presets.some(p => p.id === item.id)) item.id = uid();
                        store.presets.push({
                            id: item.id,
                            name: item.name,
                            positive: item.positive,
                            negative: item.negative,
                            vibes: cloneVibes(item.vibes),
                        });
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
            showCheckboxDialog('选择要删除的预设 (警告：操作不可逆)', store.presets.map((item) => ({
                ...item,
                extraInfo: item.vibes?.length ? `绑定 ${item.vibes.length} 个 Vibe 文件` : '未绑定 Vibe 文件',
            })), (selectedIds) => {
                if (!selectedIds.length) return toastr.warning('未选择任何预设');
                if (!window.confirm(`确定要永久删除这 ${selectedIds.length} 个预设吗？`)) return;

                if (selectedIds.includes(store.activeId)) {
                    store.activeId = '';
                }

                store.presets = store.presets.filter(p => !selectedIds.includes(p.id));
                save();
                renderSelect();
                toastr.success(`已成功删除 ${selectedIds.length} 个预设`);
            });
        });

        renderSelect();
        syncSelectedPresetVibesToHost();
        console.info('[Prompt Presets] UI mounted');
    });

    // ── Neutralize built-in prefix/suffix/negative ─────────────
    function neutralizeBuiltinFields() {
        const s = RBQ.api.getSettings();
        const store = getStore();

        if (!store._builtinBackup) {
            store._builtinBackup = {
                prefix: s.prefix || '',
                suffix: s.suffix || '',
                negative: s.negative || '',
            };
        }

        s.prefix = '';
        s.suffix = '';
        s.negative = '';
        save();

        ['st-scene-trigger-modal-prefix', 'st-scene-trigger-modal-suffix', 'st-scene-trigger-modal-negative'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
                if (el.closest('label')) el.closest('label').style.display = 'none';
            }
        });
    }

    neutralizeBuiltinFields();
    setInterval(() => {
        const el = document.getElementById('st-scene-trigger-modal-prefix');
        if (!el) return;
        if (el.closest('label')?.style.display !== 'none' || el.value) neutralizeBuiltinFields();
    }, 2000);

    console.info('📋 Prompt Presets plugin loaded');
})(RBQ, jQuery, toastr);
