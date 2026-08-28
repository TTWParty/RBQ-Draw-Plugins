(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Prompt Presets] RBQ Core API missing');

    const STORAGE_KEY = '_promptPresets';

    // ── Storage ──
    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { activeId: '', position: 'prepend', globalPositive: '', globalNegative: '', presets: [] };
        const store = s[STORAGE_KEY];
        let mutated = false;
        if (typeof store.globalPositive !== 'string') { store.globalPositive = ''; mutated = true; }
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
    function save() { RBQ.api.saveSettings(); }
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
    function combineParts(...parts) {
        return parts
            .map(p => (p || '').trim())
            .filter(Boolean)
            .join(', ');
    }

    function resolvePositivePrompt(original, presetText, globalText, position) {
        const orig = (original || '').trim();
        const preset = (presetText || '').trim();
        const global = (globalText || '').trim();
        if (!preset && !global) return orig;
        return position === 'prepend'
            ? combineParts(global, preset, orig)
            : combineParts(orig, preset, global);
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
        const globalPos = store.globalPositive || '';
        const globalNeg = store.globalNegative || '';
        const presetPos = preset ? (preset.positive || '') : '';
        const presetNeg = preset ? (preset.negative || '') : '';

        if (globalPos || presetPos) {
            payload.input = resolvePositivePrompt(payload.input, presetPos, globalPos, pos);
            if (payload.parameters?.v4_prompt?.caption) {
                payload.parameters.v4_prompt.caption.base_caption = resolvePositivePrompt(
                    payload.parameters.v4_prompt.caption.base_caption, presetPos, globalPos, pos
                );
            }
        }
        if (globalNeg || presetNeg) {
            if (payload.parameters) {
                payload.parameters.negative_prompt = resolveNegativePrompt(
                    payload.parameters.negative_prompt, presetNeg, globalNeg
                );
            }
            if (payload.parameters?.v4_negative_prompt?.caption) {
                payload.parameters.v4_negative_prompt.caption.base_caption = resolveNegativePrompt(
                    payload.parameters.v4_negative_prompt.caption.base_caption, presetNeg, globalNeg
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
        const globalPos = store.globalPositive || '';
        const globalNeg = store.globalNegative || '';
        const presetPos = preset ? (preset.positive || '') : '';
        const presetNeg = preset ? (preset.negative || '') : '';

        if (globalPos || presetPos) {
            payload.positive_prompt = resolvePositivePrompt(payload.positive_prompt, presetPos, globalPos, pos);
        }
        if (globalNeg || presetNeg) {
            payload.negative_prompt = resolveNegativePrompt(payload.negative_prompt, presetNeg, globalNeg);
        }
        console.info('[Prompt Presets] Free payload modified with presets/global prompts');
        return payload;
    });

    RBQ.on('buildComfyUiWorkflow', (payload) => {
        const store = getStore();
        const preset = getActivePreset();
        const pos = store.position || 'prepend';
        const globalPos = store.globalPositive || '';
        const globalNeg = store.globalNegative || '';
        const presetPos = preset ? (preset.positive || '') : '';
        const presetNeg = preset ? (preset.negative || '') : '';

        for (const key of Object.keys(payload)) {
            const node = payload[key];
            if (node?.class_type === 'CLIPTextEncode' && node?.inputs?.text !== undefined) {
                const isNeg = Object.values(payload).some(n =>
                    n?.inputs?.negative && Array.isArray(n.inputs.negative) && n.inputs.negative[0] === key
                );
                if (isNeg && (globalNeg || presetNeg)) {
                    node.inputs.text = resolveNegativePrompt(node.inputs.text, presetNeg, globalNeg);
                } else if (!isNeg && (globalPos || presetPos)) {
                    node.inputs.text = resolvePositivePrompt(node.inputs.text, presetPos, globalPos, pos);
                }
            }
        }
        console.info('[Prompt Presets] ComfyUI workflow modified with presets/global prompts');
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

        const container = document.createElement('div');
        container.className = 'st-scene-trigger-subpanel';
        container.id = 'rbq-prompt-presets-panel';
        container.innerHTML = `
            <div class="st-scene-trigger-subpanel-title"><i class="fa-solid fa-bookmark"></i><span>提示词预设 (Prompt Presets)</span></div>
            <div class="st-scene-trigger-subpanel-hint">保存常用提示词组合为预设，生图时自动拼接到主提示词。</div>
            
            <div style="margin-top:8px; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
                <div style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.85); margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                    <i class="fa-solid fa-earth-americas" style="color:#38bdf8;"></i>
                    <span>全局提示词 (无论选择何种预设均生效)</span>
                </div>
                <div class="st-scene-trigger-modal-grid">
                    <label class="st-scene-trigger-field wide">
                        <span style="font-size:11px; color:rgba(255,255,255,0.6);">全局正面提示词</span>
                        <textarea id="rbq-pp-global-positive" data-action="plugin-ignore" rows="2" placeholder="例如: masterpiece, best quality... (生图时自动拼接)"></textarea>
                    </label>
                    <label class="st-scene-trigger-field wide">
                        <span style="font-size:11px; color:rgba(255,255,255,0.6);">全局负面提示词</span>
                        <textarea id="rbq-pp-global-negative" data-action="plugin-ignore" rows="2" placeholder="例如: lowres, bad anatomy, worst quality... (生图时自动拼接)"></textarea>
                    </label>
                </div>
            </div>

            <div class="st-scene-trigger-modal-grid" style="margin-top:10px;">
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
                    <label class="st-scene-trigger-field wide"><span>预设正面提示词</span><textarea id="rbq-pp-positive" data-action="plugin-ignore" rows="3" placeholder="masterpiece, best quality, ..."></textarea></label>
                    <label class="st-scene-trigger-field wide"><span>预设负面提示词</span><textarea id="rbq-pp-negative" data-action="plugin-ignore" rows="3" placeholder="lowres, bad anatomy, ..."></textarea></label>
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

        // CRITICAL: Stop change events from bubbling out of our plugin UI
        // The host modal has a global 'change' listener that calls saveFromModal(),
        // which would reset the NAI URL to official if triggered from here.
        container.addEventListener('change', (e) => e.stopPropagation());
        container.addEventListener('input', (e) => e.stopPropagation());

        const globalPosInput = document.getElementById('rbq-pp-global-positive');
        const globalNegInput = document.getElementById('rbq-pp-global-negative');
        const select = document.getElementById('rbq-pp-select');
        const posSelect = document.getElementById('rbq-pp-position');
        const floatingCheckbox = document.getElementById('rbq-pp-show-floating');
        const editor = document.getElementById('rbq-pp-editor');
        const nameInput = document.getElementById('rbq-pp-name');
        const posInput = document.getElementById('rbq-pp-positive');
        const negInput = document.getElementById('rbq-pp-negative');

        globalPosInput?.addEventListener('input', () => {
            getStore().globalPositive = globalPosInput.value.trim();
            save();
        });

        globalNegInput?.addEventListener('input', () => {
            getStore().globalNegative = globalNegInput.value.trim();
            save();
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
                    fSelect.innerHTML = '<option value="" style="color:#000">-- 不使用预设 --</option>';
                    store.presets.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = p.name || p.id;
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
            if (globalPosInput && document.activeElement !== globalPosInput) {
                globalPosInput.value = store.globalPositive || '';
            }
            if (globalNegInput && document.activeElement !== globalNegInput) {
                globalNegInput.value = store.globalNegative || '';
            }
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
        }

        function loadEditor() {
            const preset = getActivePreset();
            if (preset) {
                nameInput.value = preset.name || '';
                posInput.value = preset.positive || '';
                negInput.value = preset.negative || '';
                editor.style.display = '';
            } else {
                nameInput.value = '';
                posInput.value = '';
                negInput.value = '';
                editor.style.display = 'none';
            }
        }

        select.addEventListener('change', () => {
            applyPresetSelection(select.value);
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
            if (!store.globalPositive && s.prefix) {
                store.globalPositive = s.prefix;
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
    }

    // Run on load and re-run periodically (in case modal reopens and syncUi refills hidden inputs)
    neutralizeBuiltinFields();
    setInterval(() => {
        const el = document.getElementById('st-scene-trigger-modal-prefix');
        if (!el) return;
        // Re-neutralize if label became visible again OR if syncUi refilled the hidden input
        if (el.closest('label')?.style.display !== 'none' || el.value) neutralizeBuiltinFields();
    }, 2000);

    console.info('📋 Prompt Presets plugin loaded');
})(RBQ, jQuery, toastr);
