(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[PNG Metadata Extractor] RBQ Core API missing');

    const PLUGIN_NAME = 'PNG Metadata Extractor';

    const COL_MAP = { A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
    const ROW_MAP = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };

    function getGridCoord(x, y) {
        let closestCol = 'C';
        let minColDist = Infinity;
        for (const [col, val] of Object.entries(COL_MAP)) {
            const dist = Math.abs(x - val);
            if (dist < minColDist) {
                minColDist = dist;
                closestCol = col;
            }
        }
        let closestRow = '3';
        let minRowDist = Infinity;
        for (const [row, val] of Object.entries(ROW_MAP)) {
            const dist = Math.abs(y - val);
            if (dist < minRowDist) {
                minRowDist = dist;
                closestRow = row;
            }
        }
        return `${closestCol}${closestRow}`;
    }

    function reconstructV4Prompt(v4Prompt) {
        if (!v4Prompt || !v4Prompt.caption) return '';
        const base = v4Prompt.caption.base_caption || '';
        const charCaptions = v4Prompt.caption.char_captions || [];
        if (charCaptions.length === 0) return base;

        let result = base;
        charCaptions.forEach((char, index) => {
            const caption = char.char_caption || '';
            let coordStr = '';
            if (char.centers && char.centers.length > 0) {
                const center = char.centers[0];
                const grid = getGridCoord(center.x, center.y);
                coordStr = `|centers:${grid}`;
            }
            if (result && !result.endsWith(';') && !result.endsWith(',')) {
                result += ';';
            }
            result += ` Char${index + 1}:${caption}${coordStr}`;
        });
        return result.trim();
    }

    function reconstructV4NegativePrompt(v4NegPrompt) {
        if (!v4NegPrompt || !v4NegPrompt.caption) return '';
        const base = v4NegPrompt.caption.base_caption || '';
        const charCaptions = v4NegPrompt.caption.char_captions || [];
        if (charCaptions.length === 0) return base;

        let result = base;
        charCaptions.forEach((char, index) => {
            const caption = char.char_caption || '';
            if (!caption) return;
            if (result && !result.endsWith(';') && !result.endsWith(',')) {
                result += ';';
            }
            result += ` Char${index + 1} UC:${caption}`;
        });
        return result.trim();
    }

    function readPngMetadata(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        if (dataView.getUint32(0) !== 0x89504E47 || dataView.getUint32(4) !== 0x0D0A1A0A) {
            throw new Error('该图片不是 PNG 格式');
        }

        let offset = 8;
        const metadata = {};

        while (offset < dataView.byteLength) {
            const length = dataView.getUint32(offset);
            const type = String.fromCharCode(
                dataView.getUint8(offset + 4),
                dataView.getUint8(offset + 5),
                dataView.getUint8(offset + 6),
                dataView.getUint8(offset + 7)
            );

            if (type === 'tEXt' || type === 'iTXt') {
                const chunkData = new Uint8Array(arrayBuffer, offset + 8, length);
                const text = new TextDecoder().decode(chunkData);
                
                const nullIdx = text.indexOf('\0');
                if (nullIdx !== -1) {
                    const key = text.slice(0, nullIdx);
                    let value = text.slice(nullIdx + 1);
                    if (type === 'iTXt') {
                        const jsonStart = text.indexOf('{');
                        if (jsonStart !== -1) {
                            value = text.slice(jsonStart);
                        }
                    }
                    metadata[key] = value;
                }
            }
            offset += length + 12;
        }
        return metadata;
    }

    function parseImageMetadata(metadata) {
        // 1. NovelAI Format
        let rawJson = null;
        if (metadata['Description']) {
            try { rawJson = JSON.parse(metadata['Description']); } catch(e) {}
        }
        if (!rawJson && metadata['Comment']) {
            try { rawJson = JSON.parse(metadata['Comment']); } catch(e) {}
        }

        if (rawJson && (rawJson.prompt || rawJson.v4_prompt)) {
            let promptStr = '';
            if (rawJson.v4_prompt) {
                promptStr = reconstructV4Prompt(rawJson.v4_prompt);
            } else {
                promptStr = rawJson.prompt || '';
            }

            let negativeStr = '';
            if (rawJson.v4_negative_prompt) {
                negativeStr = reconstructV4NegativePrompt(rawJson.v4_negative_prompt);
            } else {
                negativeStr = rawJson.uc || '';
            }

            let model = rawJson.model || '';
            let smea = '';
            if (rawJson.sm === true) {
                smea = rawJson.sm_dyn === true ? '开启 (DYN)' : '开启';
            } else if (rawJson.sm === false) {
                smea = '关闭';
            }
            let cfg_rescale = rawJson.cfg_rescale != null ? String(rawJson.cfg_rescale) : '';
            let noise_schedule = rawJson.noise_schedule || '';
            let uncond_scale = rawJson.uncond_scale != null ? String(rawJson.uncond_scale) : '';
            let variety_plus = rawJson.skip_cfg_above_sigma != null ? '开启' : '';
            let vibe_info = '';
            if (rawJson.reference_image_multiple && rawJson.reference_image_multiple.length > 0) {
                const count = rawJson.reference_image_multiple.length;
                const strengths = rawJson.reference_strength_multiple || [];
                const extractions = rawJson.reference_information_extracted_multiple || [];
                vibe_info = `${count}张(风格迁移) | 强度:[${strengths.join(',')}] | 提取:[${extractions.join(',')}]`;
            } else if (rawJson.director_reference_images && rawJson.director_reference_images.length > 0) {
                const count = rawJson.director_reference_images.length;
                const strengths = rawJson.director_reference_strength_values || [];
                const extractions = rawJson.director_reference_information_extracted || [];
                const types = (rawJson.director_reference_descriptions || []).map(desc => {
                    const base = desc.caption?.base_caption || '';
                    if (base === 'character') return '角色';
                    if (base === 'style') return '画风';
                    return base;
                });
                vibe_info = `${count}张(精准参考) | 类型:[${types.join(',')}] | 强度:[${strengths.join(',')}] | 提取:[${extractions.join(',')}]`;
            }

            return {
                source: 'NovelAI',
                prompt: promptStr,
                negative: negativeStr,
                seed: rawJson.seed ? String(rawJson.seed) : '',
                steps: rawJson.steps ? String(rawJson.steps) : '',
                sampler: rawJson.sampler || '',
                cfg: rawJson.scale ? String(rawJson.scale) : '',
                size: (rawJson.width && rawJson.height) ? `${rawJson.width}x${rawJson.height}` : '',
                model,
                smea,
                cfg_rescale,
                noise_schedule,
                uncond_scale,
                variety_plus,
                vibe_info,
                raw: rawJson
            };
        }

        // 2. Stable Diffusion (A1111) Format
        if (metadata['parameters']) {
            const raw = metadata['parameters'];
            let prompt = '';
            let negative = '';
            let seed = '';
            let steps = '';
            let sampler = '';
            let cfg = '';
            let size = '';

            const lines = raw.split('\n');
            let mode = 'prompt';
            const promptLines = [];
            const negativeLines = [];
            let infoLine = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('Negative prompt:')) {
                    mode = 'negative';
                    negativeLines.push(line.replace('Negative prompt:', '').trim());
                } else if (line.match(/Steps:\s*\d+/i)) {
                    infoLine = line;
                    break;
                } else {
                    if (mode === 'prompt') {
                        promptLines.push(line);
                    } else if (mode === 'negative') {
                        negativeLines.push(line);
                    }
                }
            }

            prompt = promptLines.join('\n').trim();
            negative = negativeLines.join('\n').trim();

            let model = '';
            let clip_skip = '';
            let denoise = '';
            let scheduler = '';

            if (infoLine) {
                const parts = infoLine.split(',');
                parts.forEach(part => {
                    const colonIdx = part.indexOf(':');
                    if (colonIdx === -1) return;
                    const k = part.substring(0, colonIdx).trim();
                    const v = part.substring(colonIdx + 1).trim();
                    const lowerK = k.toLowerCase();
                    if (lowerK === 'steps') steps = v;
                    else if (lowerK === 'sampler') sampler = v;
                    else if (lowerK === 'cfg scale') cfg = v;
                    else if (lowerK === 'seed') seed = v;
                    else if (lowerK === 'size') size = v;
                    else if (lowerK === 'model') model = v;
                    else if (lowerK === 'clip skip') clip_skip = v;
                    else if (lowerK === 'denoising strength') denoise = v;
                    else if (lowerK === 'schedule type' || lowerK === 'scheduler') scheduler = v;
                });
            }

            return {
                source: 'Stable Diffusion',
                prompt,
                negative,
                seed,
                steps,
                sampler,
                cfg,
                size,
                model,
                clip_skip,
                denoise,
                scheduler,
                raw
            };
        }

        // 3. ComfyUI Format
        if (metadata['prompt']) {
            try {
                const promptGraph = JSON.parse(metadata['prompt']);
                let prompt = '';
                let negative = '';
                let seed = '';
                let steps = '';
                let sampler = '';
                let cfg = '';
                let size = '';

                let model = '';
                let clip_skip = '';
                let denoise = '';
                let scheduler = '';

                for (const nodeId in promptGraph) {
                    const node = promptGraph[nodeId];
                    if (node.class_type === 'CLIPTextEncode') {
                        const text = node.inputs?.text;
                        if (text && typeof text === 'string') {
                            if (text.toLowerCase().includes('easynegative') || text.toLowerCase().includes('nsfw') || text.toLowerCase().includes('worst quality') || text.toLowerCase().includes('bad anatomy')) {
                                negative = text;
                            } else {
                                prompt = text;
                            }
                        }
                    } else if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
                        if (node.inputs) {
                            if (node.inputs.seed != null) seed = String(node.inputs.seed);
                            if (node.inputs.steps != null) steps = String(node.inputs.steps);
                            if (node.inputs.cfg != null) cfg = String(node.inputs.cfg);
                            if (node.inputs.sampler_name != null) sampler = String(node.inputs.sampler_name);
                            if (node.inputs.denoise != null) denoise = String(node.inputs.denoise);
                            if (node.inputs.scheduler != null) scheduler = String(node.inputs.scheduler);
                        }
                    } else if (node.class_type === 'EmptyLatentImage') {
                        if (node.inputs && node.inputs.width && node.inputs.height) {
                            size = `${node.inputs.width}x${node.inputs.height}`;
                        }
                    } else if (node.class_type === 'CheckpointLoaderSimple' || node.class_type === 'CheckpointLoader' || node.class_type === 'SimpleCheckpointLoaderWithName') {
                        if (node.inputs && node.inputs.ckpt_name) {
                            model = node.inputs.ckpt_name;
                        }
                    } else if (node.class_type === 'CLIPSetUp' || node.class_type === 'CLIPSetLastLayer') {
                        if (node.inputs && node.inputs.stop_at_layer != null) {
                            const val = Math.abs(Number(node.inputs.stop_at_layer));
                            clip_skip = String(val);
                        }
                    }
                }

                return {
                    source: 'ComfyUI',
                    prompt,
                    negative,
                    seed,
                    steps,
                    sampler,
                    cfg,
                    size,
                    model,
                    clip_skip,
                    denoise,
                    scheduler,
                    raw: promptGraph
                };
            } catch(e) {}
        }

        throw new Error('图片中没有检测到支持的生图元数据 (SD / NovelAI / ComfyUI)');
    }

    function showMetadataModal(parsed) {
        if (!document.getElementById('rbq-nai-modal-style')) {
            const style = document.createElement('style');
            style.id = 'rbq-nai-modal-style';
            style.textContent = `
                @keyframes rbq-fade-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                .rbq-extractor-overlay {
                    position: fixed; inset: 0; z-index: 2147483647; 
                    background: rgba(0,0,0,0.75); display: flex; 
                    align-items: center; justify-content: center; backdrop-filter: blur(4px);
                    padding: env(safe-area-inset-top, 16px) env(safe-area-inset-right, 16px) env(safe-area-inset-bottom, 16px) env(safe-area-inset-left, 16px);
                    box-sizing: border-box;
                }
                .rbq-extractor-dialog {
                    background: #1e1e2e; border: 1px solid rgba(255,255,255,0.1); 
                    border-radius: 12px; width: 100%; max-width: 500px;
                    max-height: calc(min(100dvh, 100vh) - env(safe-area-inset-top, 16px) - env(safe-area-inset-bottom, 16px) - 32px);
                    color: #eee;
                    box-shadow: 0 16px 40px rgba(0,0,0,0.5);
                    display: flex; flex-direction: column; overflow: hidden;
                    animation: rbq-fade-in 0.2s ease-out;
                    pointer-events: auto;
                }
                .rbq-extractor-header {
                    padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); 
                    display:flex; justify-content:space-between; align-items:center; 
                    background:rgba(30,30,46,0.95); z-index:2; flex-shrink:0; gap:8px;
                }
                .rbq-extractor-title {
                    font-weight:bold; font-size:16px; display:flex; align-items:center; gap:8px;
                }
                .rbq-extractor-close {
                    padding:6px; font-size:18px; margin:0; line-height:1; width:34px; height:34px; 
                    display:flex; justify-content:center; align-items:center; border-radius:50%; 
                    background:transparent; border:none; cursor:pointer; color:#eee;
                }
                .rbq-extractor-body {
                    padding: 16px; flex:1; overflow-y:auto; -webkit-overflow-scrolling: touch;
                }
                .rbq-extractor-subtitle {
                    font-size:12px; color:#ff99cc; margin-bottom:16px; text-align:center; opacity:0.8;
                }
                .rbq-extractor-field {
                    margin-bottom: 12px; background: rgba(0,0,0,0.25); padding: 12px; 
                    border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);
                }
                .rbq-extractor-field-header {
                    display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px; gap: 8px;
                }
                .rbq-extractor-field-title {
                    font-size:13px; font-weight:600; color:rgba(255,255,255,0.5); line-height: 1.4; word-break: break-word; flex: 1;
                }
                .rbq-extractor-copy-btn {
                    font-size:12px; padding:6px 10px; margin:0; display:inline-flex; gap:4px; align-items:center; 
                    border-radius:6px; border:none; cursor:pointer; font-weight:bold; 
                    background:rgba(255,255,255,0.1); color:#fff; transition: background 0.2s; 
                    min-height:28px; flex-shrink: 0; white-space: nowrap;
                }
                .rbq-extractor-copy-btn:hover { background: rgba(255,255,255,0.2); }
                .rbq-extractor-copy-btn:active { background: rgba(255,255,255,0.3); }
                .rbq-extractor-field-content {
                    font-size:14px; overflow-wrap:break-word; word-break:break-word; white-space:pre-wrap; 
                    max-height: 150px; overflow-y:auto; padding-right:4px; line-height:1.5; 
                    font-family:var(--font-family, monospace); user-select:text; -webkit-user-select:text;
                }
                .rbq-extractor-grid {
                    display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom: 12px;
                }
                @media (max-width: 480px) {
                    .rbq-extractor-overlay {
                        align-items: flex-start;
                        padding-top: max(env(safe-area-inset-top, 16px), 24px); 
                    }
                    .rbq-extractor-grid {
                        grid-template-columns: 1fr;
                    }
                    .rbq-extractor-copy-btn {
                        padding: 8px 12px;
                        min-height: 32px;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        const overlay = document.createElement('div');
        overlay.className = 'rbq-extractor-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'rbq-extractor-dialog';

        const createField = (title, content) => {
            if (!content) return null;
            const box = document.createElement('div');
            box.className = 'rbq-extractor-field';

            const header = document.createElement('div');
            header.className = 'rbq-extractor-field-header';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'rbq-extractor-field-title';
            titleSpan.textContent = title;

            const btn = document.createElement('button');
            btn.className = 'menu_button rbq-extractor-copy-btn';
            btn.innerHTML = '<i class="fa-regular fa-copy"></i> 复制';

            btn.onclick = () => {
                navigator.clipboard.writeText(content).then(() => {
                    const old = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> 成功';
                    btn.style.color = '#88ff88';
                    setTimeout(() => { btn.innerHTML = old; btn.style.color = '#fff'; }, 2000);
                });
            };

            header.append(titleSpan, btn);

            const bodyContent = document.createElement('div');
            bodyContent.className = 'rbq-extractor-field-content';
            bodyContent.textContent = content;

            box.append(header, bodyContent);
            return box;
        };

        const headerHTML = document.createElement('div');
        headerHTML.className = 'rbq-extractor-header';
        headerHTML.innerHTML = `
            <div class="rbq-extractor-title">
                <i class="fa-solid fa-wand-magic-sparkles" style="color:#ff99cc;"></i> PNG 信息提取结果 (${parsed.source})
            </div>
            <button class="menu_button st-scene-trigger-icon-button rbq-extractor-close"><i class="fa-solid fa-xmark"></i></button>
        `;

        headerHTML.querySelector('.rbq-extractor-close').onclick = () => overlay.remove();
        dialog.appendChild(headerHTML);

        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'rbq-extractor-body';

        const subtitle = document.createElement('div');
        subtitle.className = 'rbq-extractor-subtitle';
        subtitle.innerHTML = '提示：如需复用，请手动点击一键复制然后粘贴至输入框。';
        bodyDiv.appendChild(subtitle);

        const fields = [
            createField('正向提示词 (Prompt)', parsed.prompt),
            createField('反向提示词 (Negative)', parsed.negative)
        ];
        fields.forEach(f => f && bodyDiv.appendChild(f));

        const grid = document.createElement('div');
        grid.className = 'rbq-extractor-grid';
        const smallFields = [
            createField('模型 (Model)', parsed.model),
            createField('种子 (Seed)', parsed.seed),
            createField('尺寸 (Size)', parsed.size),
            createField('步数 (Steps)', parsed.steps),
            createField('采样器 (Sampler)', parsed.sampler),
            createField('CFG Scale', parsed.cfg),
            createField('SMEA', parsed.smea),
            createField('CFG Rescale', parsed.cfg_rescale),
            createField('噪声调度 (Scheduler)', parsed.noise_schedule || parsed.scheduler),
            createField('UC强度 (Uncond Scale)', parsed.uncond_scale),
            createField('Variety+', parsed.variety_plus),
            createField('Clip Skip', parsed.clip_skip),
            createField('去噪强度 (Denoise)', parsed.denoise),
            createField('参考图 (Vibe)', parsed.vibe_info)
        ];
        smallFields.forEach(f => f && grid.appendChild(f));
        if (grid.children.length > 0) bodyDiv.appendChild(grid);

        dialog.appendChild(bodyDiv);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    async function handleExtract(imgUrl) {
        if (!imgUrl) return toastr.warning('无法获取图片地址');
        try {
            toastr.info('正在解析图片元数据...', 'PNG 提取器');
            const res = await fetch(imgUrl);
            const blob = await res.blob();

            const arrayBuffer = await blob.arrayBuffer();
            const metadata = readPngMetadata(arrayBuffer);
            const parsed = parseImageMetadata(metadata);

            toastr.success('成功提取并解析图片元数据！');
            showMetadataModal(parsed);

        } catch (err) {
            console.error('[PNG Metadata Extractor]', err);
            toastr.error('执行失败: ' + err.message);
        }
    }

    function injectToolbarButton(spec, dialog, imgUrl) {
        let btn = dialog.querySelector('.rbq-nai-extract-btn');
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                handleExtract(imgUrl);
            };
            return;
        }

        const toolbar = spec.toolbarSelector ? dialog.querySelector(spec.toolbarSelector) : null;
        btn = document.createElement('button');
        btn.id = 'rbq-nai-gallery-btn';
        btn.className = `${spec.btnClass || ''} rbq-nai-extract-btn menu_button st-scene-trigger-icon-button`.trim();
        btn.title = '提取图片信息 (NAI/SD/ComfyUI)';
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
        btn.style.margin = '0 4px';
        btn.style.cursor = 'pointer';

        btn.onclick = (e) => {
            e.stopPropagation();
            handleExtract(imgUrl);
        };

        if (toolbar) {
            if (spec.insertMode === 'prepend') {
                toolbar.insertBefore(btn, toolbar.firstChild);
            } else {
                toolbar.appendChild(btn);
            }
        } else if (spec.insertMode === 'custom-absolute') {
            btn.style.position = 'absolute';
            btn.style.top = '12px';
            btn.style.right = '60px';
            btn.style.zIndex = '9999';
            dialog.appendChild(btn);
        }
    }

    // === Prompt Reader Dropzone Injection and Rendering ===
    function renderInspectorResult(parsed) {
        const container = document.getElementById('st-scene-trigger-inspector-result');
        if (!container) return;

        let gridHtml = '';
        const smallFields = [
            { label: '模型 (Model)', value: parsed.model },
            { label: '种子 (Seed)', value: parsed.seed },
            { label: '采样器 (Sampler)', value: parsed.sampler },
            { label: 'CFG (Scale)', value: parsed.cfg },
            { label: '尺寸 (Size)', value: parsed.size },
            { label: '步数 (Steps)', value: parsed.steps },
            { label: 'SMEA', value: parsed.smea },
            { label: 'CFG Rescale', value: parsed.cfg_rescale },
            { label: '噪声调度 (Scheduler)', value: parsed.noise_schedule || parsed.scheduler },
            { label: 'UC强度 (Uncond Scale)', value: parsed.uncond_scale },
            { label: 'Variety+', value: parsed.variety_plus },
            { label: 'Clip Skip', value: parsed.clip_skip },
            { label: '去噪强度 (Denoise)', value: parsed.denoise },
            { label: '参考图 (Vibe)', value: parsed.vibe_info }
        ];

        smallFields.forEach(f => {
            if (!f.value) return;
            gridHtml += `
                <div class="st-scene-trigger-inspector-field">
                    <div class="st-scene-trigger-inspector-field-header">
                        <span class="st-scene-trigger-inspector-field-name">${f.label}</span>
                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${f.value.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i></button>
                    </div>
                    <div class="st-scene-trigger-inspector-field-value">${f.value}</div>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="st-scene-trigger-inspector-result-title">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <span>解析结果 (${parsed.source})</span>
            </div>

            ${parsed.prompt ? `
                <div class="st-scene-trigger-inspector-field">
                    <div class="st-scene-trigger-inspector-field-header">
                        <span class="st-scene-trigger-inspector-field-name">正向提示词 (Prompt)</span>
                        <div class="st-scene-trigger-inspector-field-actions">
                            <button class="st-scene-trigger-inspector-btn btn-import-test"><i class="fa-solid fa-arrow-up-from-bracket"></i> 导入到测试</button>
                            <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${parsed.prompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                        </div>
                    </div>
                    <div class="st-scene-trigger-inspector-field-value">${parsed.prompt}</div>
                </div>
            ` : ''}

            ${parsed.negative ? `
                <div class="st-scene-trigger-inspector-field">
                    <div class="st-scene-trigger-inspector-field-header">
                        <span class="st-scene-trigger-inspector-field-name">反向提示词 (Negative UC)</span>
                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${parsed.negative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                    </div>
                    <div class="st-scene-trigger-inspector-field-value">${parsed.negative}</div>
                </div>
            ` : ''}

            ${gridHtml ? `
                <div class="st-scene-trigger-inspector-grid">
                    ${gridHtml}
                </div>
            ` : ''}
        `;

        // Bind copy events
        container.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const text = btn.getAttribute('data-text');
                navigator.clipboard.writeText(text).then(() => {
                    const oldHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    btn.style.color = '#88ff88';
                    setTimeout(() => { btn.innerHTML = oldHTML; btn.style.color = ''; }, 1500);
                });
            });
        });

        // Bind import to test prompt event
        const importBtn = container.querySelector('.btn-import-test');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const textarea = document.getElementById('st-scene-trigger-test-prompt');
                if (textarea) {
                    textarea.value = parsed.prompt;
                    toastr.success('已导入至测试提示词输入框', 'Prompt Reader');
                }
            });
        }

        container.style.display = 'block';
    }

    function handleInspectFile(file) {
        if (!file.type.startsWith('image/png')) {
            toastr.warning('只支持无损 PNG 格式的生图进行解析，JPEG/WebP 元数据通常已被平台压缩丢弃。', 'Prompt Reader');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const arrayBuffer = e.target.result;
                const metadata = readPngMetadata(arrayBuffer);
                const parsed = parseImageMetadata(metadata);
                renderInspectorResult(parsed);
                toastr.success('解析成功！', 'Prompt Reader');
            } catch (err) {
                console.error('[Prompt Reader]', err);
                toastr.error('解析失败: ' + err.message, 'Prompt Reader');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function injectInspectorToTestTab() {
        const testSection = document.querySelector('section[data-kite-panel="test"]');
        if (!testSection) return;

        if (document.getElementById('st-scene-trigger-inspector-dropzone')) return;

        if (!document.getElementById('rbq-inspector-styles')) {
            const style = document.createElement('style');
            style.id = 'rbq-inspector-styles';
            style.textContent = `
                .st-scene-trigger-inspector-dropzone {
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  margin-top: 16px;
                  padding: 24px;
                  min-height: 100px;
                  background: var(--linear-bg-subtle, rgba(255,255,255,0.03));
                  border-radius: 12px;
                  border: 1.5px dashed var(--linear-border-standard, rgba(255,255,255,0.1));
                  cursor: pointer;
                  transition: border-color 0.25s ease, background-color 0.25s ease, transform 0.2s ease;
                  user-select: none;
                  text-align: center;
                  gap: 8px;
                }
                .st-scene-trigger-inspector-dropzone:hover {
                  border-color: var(--mode-accent, #ff7aa8);
                  background: rgba(255, 122, 168, 0.04);
                }
                .st-scene-trigger-inspector-dropzone.dragover {
                  border-color: var(--mode-accent, #ff7aa8);
                  background: rgba(255, 122, 168, 0.08);
                  transform: scale(1.01);
                }
                .st-scene-trigger-inspector-dropzone i {
                  font-size: 26px;
                  color: var(--mode-accent, #ff7aa8);
                  transition: transform 0.2s ease;
                }
                .st-scene-trigger-inspector-dropzone:hover i {
                  transform: translateY(-2px);
                }
                .st-scene-trigger-inspector-dropzone span {
                  font-size: 13px;
                  color: var(--linear-text-muted, #888);
                }

                .st-scene-trigger-inspector-result {
                  margin-top: 18px;
                  background: rgba(0, 0, 0, 0.15);
                  border: 1px solid var(--linear-border-standard, rgba(255,255,255,0.1));
                  border-radius: 12px;
                  padding: 16px;
                  box-sizing: border-box;
                }
                .st-scene-trigger-inspector-result-title {
                  font-size: 15px;
                  font-weight: bold;
                  color: #f5fbff;
                  margin-bottom: 12px;
                  display: flex;
                  align-items: center;
                  gap: 8px;
                }
                .st-scene-trigger-inspector-result-title i {
                  color: var(--mode-accent, #ff7aa8);
                }
                .st-scene-trigger-inspector-field {
                  margin-bottom: 12px;
                  background: rgba(255, 255, 255, 0.02);
                  padding: 10px 12px;
                  border-radius: 8px;
                  border: 1px solid rgba(255, 255, 255, 0.04);
                }
                .st-scene-trigger-inspector-field:last-child {
                  margin-bottom: 0;
                }
                .st-scene-trigger-inspector-field-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  margin-bottom: 6px;
                }
                .st-scene-trigger-inspector-field-name {
                  font-size: 12px;
                  color: var(--linear-text-muted, #888);
                  font-weight: 600;
                }
                .st-scene-trigger-inspector-field-actions {
                  display: flex;
                  gap: 6px;
                }
                .st-scene-trigger-inspector-btn {
                  background: rgba(255, 255, 255, 0.06);
                  border: none;
                  color: #fff;
                  padding: 4px 8px;
                  font-size: 11px;
                  border-radius: 4px;
                  cursor: pointer;
                  transition: background 0.2s;
                  display: inline-flex;
                  align-items: center;
                  gap: 4px;
                }
                .st-scene-trigger-inspector-btn:hover {
                  background: rgba(255, 255, 255, 0.12);
                }
                .st-scene-trigger-inspector-field-value {
                  font-size: 13.5px;
                  color: #eee;
                  word-break: break-all;
                  white-space: pre-wrap;
                  max-height: 120px;
                  overflow-y: auto;
                  font-family: var(--font-family, monospace);
                }
                .st-scene-trigger-inspector-grid {
                  display: grid;
                  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                  gap: 8px;
                  margin-bottom: 12px;
                }
            `;
            document.head.appendChild(style);
        }

        const hr = document.createElement('hr');
        hr.style.cssText = "margin: 24px 0; border: none; border-top: 1px dashed var(--linear-border-standard, rgba(255,255,255,0.15));";
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'st-scene-trigger-panel-title';
        titleDiv.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>图片信息解析 (Prompt Reader)</span>';
        
        const dropzone = document.createElement('div');
        dropzone.className = 'st-scene-trigger-inspector-dropzone';
        dropzone.id = 'st-scene-trigger-inspector-dropzone';
        dropzone.innerHTML = `
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <span>拖拽图片至此处，或点击上传解析元数据</span>
            <input type="file" id="st-scene-trigger-inspector-file" style="display: none;" accept="image/png">
        `;

        const resultDiv = document.createElement('div');
        resultDiv.className = 'st-scene-trigger-inspector-result';
        resultDiv.id = 'st-scene-trigger-inspector-result';
        resultDiv.style.display = 'none';

        testSection.appendChild(hr);
        testSection.appendChild(titleDiv);
        testSection.appendChild(dropzone);
        testSection.appendChild(resultDiv);

        const fileInput = dropzone.querySelector('#st-scene-trigger-inspector-file');
        
        dropzone.addEventListener('click', () => fileInput.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleInspectFile(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                handleInspectFile(files[0]);
            }
        });
    }

    function scanAndInject() {
        if (!document.getElementById('rbq-gallery-styles')) {
            const style = document.createElement('style');
            style.id = 'rbq-gallery-styles';
            style.textContent = `
                .pswp__top-bar .rbq-nai-extract-btn {
                    background: none !important;
                    border: none !important;
                    box-shadow: none !important;
                    width: 44px;
                    height: 44px;
                    float: right;
                    font-size: 15px;
                    color: #fff;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0.75;
                    transition: opacity 0.2s, color 0.2s;
                    cursor: pointer;
                }
                .pswp__top-bar .rbq-nai-extract-btn:hover {
                    opacity: 1;
                    color: #ff99cc;
                }
                .pswp__top-bar .rbq-nai-extract-btn i {
                    color: inherit;
                    font-size: 15px;
                }
            `;
            document.head.appendChild(style);
        }

        injectInspectorToTestTab();

        const viewers = [
            {
                // Custom st-scene-trigger viewer (Image History Modal)
                dialogId: 'st-scene-trigger-image-viewer',
                imgSelector: '.st-scene-trigger-viewer-image',
                toolbarSelector: '.st-scene-trigger-viewer-actions',
                btnClass: 'menu_button', // Match existing ST buttons
                insertMode: 'prepend' // Puts it to the left of the download button
            },
            {
                dialogSelector: '.pswp',
                imgSelector: '.pswp__zoom-wrap img',
                toolbarSelector: '.pswp__top-bar',
                btnClass: '',
                insertMode: 'append'
            },
            {
                dialogSelector: '.fancybox__container',
                imgSelector: '.fancybox__image',
                toolbarSelector: '.fancybox__toolbar__items--right, .fancybox__toolbar',
                btnClass: 'fancybox__button',
                insertMode: 'prepend'
            },
            {
                dialogSelector: '.fancybox-container',
                imgSelector: '.fancybox-image',
                toolbarSelector: '.fancybox-toolbar',
                btnClass: 'fancybox-button',
                insertMode: 'prepend'
            },
            {
                dialogSelector: '.lg-container',
                imgSelector: '.lg-current img.lg-object, .lg-current img.lg-image',
                toolbarSelector: '.lg-toolbar',
                btnClass: 'lg-icon',
                insertMode: 'append'
            },
            {
                dialogId: 'zoom_dialog',
                imgSelector: '#zoom_img',
                toolbarSelector: '',
                btnClass: 'menu_button',
                insertMode: 'custom-absolute'
            },
            {
                dialogId: 'swipe_zoom_dialog',
                imgSelector: '#zoom_img',
                toolbarSelector: '',
                btnClass: 'menu_button',
                insertMode: 'custom-absolute'
            }
        ];

        let viewerFound = false;

        for (const spec of viewers) {
            const dialog = spec.dialogId ? document.getElementById(spec.dialogId) : document.querySelector(spec.dialogSelector);
            if (!dialog) continue;

            const style = window.getComputedStyle(dialog);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && !dialog.classList.contains('lg-hide');
            if (!isVisible) continue;

            const activeImg = dialog.querySelector(spec.imgSelector);
            if (!activeImg || !activeImg.src) continue;

            // Check if this is a character avatar, user avatar, default avatar, or background image
            const src = activeImg.src.toLowerCase();
            if (
                src.includes('avatar') || 
                src.includes('character') || 
                src.includes('background') || 
                src.includes('/default-')
            ) {
                const btn = dialog.querySelector('.rbq-nai-extract-btn');
                if (btn) btn.remove();
                continue;
            }

            viewerFound = true;
            injectToolbarButton(spec, dialog, activeImg.src);
            break;
        }

        const legacyBtn = document.getElementById('rbq-nai-gallery-btn');
        if (legacyBtn && !viewerFound) legacyBtn.remove();

        const chatBtns = document.querySelectorAll('#chat .rbq-nai-extract-btn');
        chatBtns.forEach(b => {
            const wrapper = b.closest('div[style*="display: block"]');
            if (wrapper && wrapper.children.length === 1) {
                wrapper.remove();
            } else {
                b.remove();
            }
        });
    }

    setInterval(scanAndInject, 500);
    setTimeout(scanAndInject, 100);

    console.info(`📋 ${PLUGIN_NAME} plugin loaded via Toolbar & Dropzone Poller.`);

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
