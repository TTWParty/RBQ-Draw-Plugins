(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[Prompt Presets] RBQ Core API missing');

    const STORAGE_KEY = '_promptPresets';

    // ── Storage ──
    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { activeId: '', position: 'prepend', presets: [] };
        return s[STORAGE_KEY];
    }
    function save() { RBQ.api.saveSettings(); }
    function uid() { return 'pp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function getActivePreset() {
        const store = getStore();
        return store.activeId ? store.presets.find(p => p.id === store.activeId) || null : null;
    }

    // ── Join Logic ──
    function joinPrompt(original, presetText, position) {
        const a = (original || '').trim();
        const b = (presetText || '').trim();
        if (!b) return a;
        if (!a) return b;
        return position === 'prepend' ? (b + ', ' + a) : (a + ', ' + b);
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
        console.info('[Prompt Presets] NAI payload modified:', preset.name);
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
        const container = document.createElement('div');
        container.className = 'st-scene-trigger-subpanel';
        container.id = 'rbq-prompt-presets-panel';
        container.innerHTML = `
            <div class="st-scene-trigger-subpanel-title"><i class="fa-solid fa-bookmark"></i><span>提示词预设 (Prompt Presets)</span></div>
            <div class="st-scene-trigger-subpanel-hint">保存常用提示词组合为预设，生图时自动拼接到主提示词。</div>
            <div class="st-scene-trigger-modal-grid">
                <div class="st-scene-trigger-field wide" style="display:flex; gap:6px; align-items:center;">
                    <select id="rbq-pp-select" style="flex:1;"></select>
                    <select id="rbq-pp-position" style="width:80px;">
                        <option value="prepend">前置</option>
                        <option value="append">后置</option>
                    </select>
                </div>
            </div>
            <div id="rbq-pp-editor" style="display:none; margin-top:8px;">
                <div class="st-scene-trigger-modal-grid">
                    <label class="st-scene-trigger-field wide"><span>预设名称</span><input id="rbq-pp-name" type="text" placeholder="例如: 高质量通用"></label>
                    <label class="st-scene-trigger-field wide"><span>正面提示词</span><textarea id="rbq-pp-positive" rows="3" placeholder="masterpiece, best quality, ..."></textarea></label>
                    <label class="st-scene-trigger-field wide"><span>负面提示词</span><textarea id="rbq-pp-negative" rows="3" placeholder="lowres, bad anatomy, ..."></textarea></label>
                </div>
                <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:6px;">
                    <button id="rbq-pp-save" class="menu_button" style="font-size:12px; padding:4px 12px;"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
                    <button id="rbq-pp-delete" class="menu_button" style="font-size:12px; padding:4px 12px; color:#ff4444;"><i class="fa-solid fa-trash"></i> 删除</button>
                </div>
            </div>
            <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                <button id="rbq-pp-new" class="menu_button st-scene-trigger-icon-button" style="font-size:12px; padding:4px 10px;"><i class="fa-solid fa-plus"></i> 新建</button>
                <button id="rbq-pp-export" class="menu_button st-scene-trigger-icon-button" style="font-size:12px; padding:4px 10px;"><i class="fa-solid fa-file-export"></i> 导出</button>
                <button id="rbq-pp-import-btn" class="menu_button st-scene-trigger-icon-button" style="font-size:12px; padding:4px 10px;"><i class="fa-solid fa-file-import"></i> 导入</button>
                <input id="rbq-pp-import-file" type="file" accept=".json" hidden>
            </div>
        `;

        const helpBox = panel.querySelector('.st-scene-trigger-help-box');
        if (helpBox) {
            helpBox.parentElement.insertBefore(container, helpBox);
        } else {
            panel.appendChild(container);
        }

        const select = document.getElementById('rbq-pp-select');
        const posSelect = document.getElementById('rbq-pp-position');
        const editor = document.getElementById('rbq-pp-editor');
        const nameInput = document.getElementById('rbq-pp-name');
        const posInput = document.getElementById('rbq-pp-positive');
        const negInput = document.getElementById('rbq-pp-negative');

        function renderSelect() {
            const store = getStore();
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
            getStore().activeId = select.value;
            save();
            loadEditor();
        });

        posSelect.addEventListener('change', () => {
            getStore().position = posSelect.value;
            save();
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
                const data = JSON.stringify(selected, null, 2);
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
                const candidates = imported.filter(item => item.name || item.positive || item.negative);
                if (!candidates.length) throw new Error('文件中没有有效的预设');

                // Normalize items for display
                const displayItems = candidates.map(item => ({
                    id: item.id || uid(),
                    name: item.name || '未命名预设',
                    positive: item.positive || '',
                    negative: item.negative || '',
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

        renderSelect();
        console.info('[Prompt Presets] UI mounted');
    });

    console.info('📋 Prompt Presets plugin loaded');
})(RBQ, jQuery, toastr);
