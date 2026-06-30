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

    function extractMultiCharInfo(parsed) {
        if (!parsed || !parsed.raw) return null;
        const v4Prompt = parsed.raw.v4_prompt;
        if (!v4Prompt || !v4Prompt.caption) return null;
        const charCaptions = v4Prompt.caption.char_captions || [];
        if (charCaptions.length === 0) return null;

        const v4NegPrompt = parsed.raw.v4_negative_prompt;
        const negCharCaptions = (v4NegPrompt && v4NegPrompt.caption && v4NegPrompt.caption.char_captions) || [];

        const basePrompt = v4Prompt.caption.base_caption || '';
        const baseNegative = (v4NegPrompt && v4NegPrompt.caption && v4NegPrompt.caption.base_caption) || '';

        const characters = charCaptions.map((char, index) => {
            const prompt = char.char_caption || '';
            const negative = (negCharCaptions[index] && negCharCaptions[index].char_caption) || '';
            let coord = '';
            if (char.centers && char.centers.length > 0) {
                const center = char.centers[0];
                coord = getGridCoord(center.x, center.y);
            }
            return {
                index: index + 1,
                prompt,
                negative,
                coord
            };
        });

        return {
            basePrompt,
            baseNegative,
            characters
        };
    }

    function detectPreset(parsed) {
        if (!parsed || !parsed.prompt) return null;
        
        let settings = null;
        try {
            if (typeof RBQ !== 'undefined' && typeof RBQ.api?.getSettings === 'function') {
                settings = RBQ.api.getSettings();
            }
        } catch (e) {
            console.error('[PNG Metadata Extractor] Failed to get settings for preset detection', e);
        }
        
        if (!settings || !settings._promptPresets) return null;
        
        const store = settings._promptPresets;
        const presets = Array.isArray(store.presets) ? store.presets : [];
        if (presets.length === 0) return null;
        
        const rawPrompt = String(parsed.prompt || '').trim();
        const rawNegative = String(parsed.negative || '').trim();
        
        let bestMatch = null;
        let bestMatchScore = -1;
        
        for (const preset of presets) {
            const prePos = String(preset.positive || '').trim();
            const preNeg = String(preset.negative || '').trim();
            
            if (!prePos && !preNeg) continue;
            
            for (const position of ['prepend', 'append']) {
                let posMatched = false;
                let negMatched = false;
                let currentMainPrompt = rawPrompt;
                let currentMainNegative = rawNegative;
                
                // Check positive prompt match
                if (prePos) {
                    if (rawPrompt === prePos) {
                        posMatched = true;
                        currentMainPrompt = '';
                    } else if (position === 'prepend') {
                        if (rawPrompt.startsWith(prePos + ', ')) {
                            posMatched = true;
                            currentMainPrompt = rawPrompt.slice(prePos.length + 2);
                        }
                    } else { // position === 'append'
                        if (rawPrompt.endsWith(', ' + prePos)) {
                            posMatched = true;
                            currentMainPrompt = rawPrompt.slice(0, rawPrompt.length - prePos.length - 2);
                        }
                    }
                } else {
                    posMatched = true;
                }
                
                // Check negative prompt match
                if (preNeg) {
                    if (rawNegative === preNeg) {
                        negMatched = true;
                        currentMainNegative = '';
                    } else if (position === 'prepend') {
                        if (rawNegative.startsWith(preNeg + ', ')) {
                            negMatched = true;
                            currentMainNegative = rawNegative.slice(preNeg.length + 2);
                        }
                    } else { // position === 'append'
                        if (rawNegative.endsWith(', ' + preNeg)) {
                            negMatched = true;
                            currentMainNegative = rawNegative.slice(0, rawNegative.length - preNeg.length - 2);
                        }
                    }
                } else {
                    negMatched = true;
                }
                
                if (posMatched && negMatched) {
                    const score = prePos.length + preNeg.length;
                    if (score > bestMatchScore) {
                        bestMatchScore = score;
                        bestMatch = {
                            name: preset.name,
                            mainPrompt: currentMainPrompt,
                            mainNegative: currentMainNegative,
                            presetPositive: prePos,
                            presetNegative: preNeg
                        };
                    }
                }
            }
        }
        
        return bestMatch;
    }

    function showMetadataModal(parsed, isSimple = false) {
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
                .rbq-extractor-multi-char-container {
                    display: none;
                    margin-bottom: 16px;
                    background: rgba(0, 0, 0, 0.25);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 8px;
                    padding: 12px;
                }
                .rbq-extractor-multi-char-item {
                    border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
                    padding-bottom: 10px;
                    margin-bottom: 10px;
                }
                .rbq-extractor-multi-char-item:last-child {
                    border-bottom: none;
                    padding-bottom: 0;
                    margin-bottom: 0;
                }
                .rbq-extractor-multi-char-item-title {
                    font-size: 13px;
                    font-weight: bold;
                    color: var(--mode-accent, #ff7aa8);
                    margin-bottom: 6px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .rbq-extractor-multi-char-item-row {
                    margin-top: 6px;
                    background: rgba(0, 0, 0, 0.2);
                    padding: 8px;
                    border-radius: 6px;
                    font-size: 12.5px;
                    border: 1px solid rgba(255, 255, 255, 0.03);
                }
                .rbq-extractor-multi-char-item-row-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.4);
                    margin-bottom: 4px;
                    gap: 8px;
                }
                .rbq-extractor-multi-char-item-row-content {
                    word-break: break-all;
                    white-space: pre-wrap;
                    font-family: var(--font-family, monospace);
                    max-height: 80px;
                    overflow-y: auto;
                    color: #eee;
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

        const titleText = isSimple && parsed.source === 'NovelAI' 
            ? 'NAI 数据提取结果' 
            : `PNG 信息提取结果 (${parsed.source})`;
        const headerIcon = isSimple && parsed.source === 'NovelAI'
            ? 'fa-photo-film'
            : 'fa-wand-magic-sparkles';

        const headerHTML = document.createElement('div');
        headerHTML.className = 'rbq-extractor-header';
        headerHTML.innerHTML = `
            <div class="rbq-extractor-title">
                <i class="fa-solid ${headerIcon}" style="color:#ff99cc;"></i> ${titleText}
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

        const multiCharInfo = extractMultiCharInfo(parsed);
        if (multiCharInfo) {
            const btn = document.createElement('button');
            btn.className = 'menu_button rbq-extractor-multi-char-btn';
            btn.style.cssText = 'background: var(--mode-accent, #ff7aa8); color: #fff; margin-bottom: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: bold; border: none; height: 36px; border-radius: 8px; cursor: pointer;';
            btn.innerHTML = '<i class="fa-solid fa-users"></i> 查看多角色提示词';

            const container = document.createElement('div');
            container.className = 'rbq-extractor-multi-char-container';

            let charHtml = `
                <div class="rbq-extractor-multi-char-item">
                    <div class="rbq-extractor-multi-char-item-title">
                        <i class="fa-solid fa-mountain-sun"></i> 场景/背景 (Base)
                    </div>
                    ${multiCharInfo.basePrompt ? `
                        <div class="rbq-extractor-multi-char-item-row">
                            <div class="rbq-extractor-multi-char-item-row-header">
                                <span>正向提示词</span>
                                <button class="menu_button rbq-extractor-copy-btn sub-copy" style="font-size:10px; padding:2px 6px; min-height:18px;" data-text="${multiCharInfo.basePrompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                            </div>
                            <div class="rbq-extractor-multi-char-item-row-content">${multiCharInfo.basePrompt}</div>
                        </div>
                    ` : ''}
                    ${multiCharInfo.baseNegative ? `
                        <div class="rbq-extractor-multi-char-item-row">
                            <div class="rbq-extractor-multi-char-item-row-header">
                                <span>反向提示词 (UC)</span>
                                <button class="menu_button rbq-extractor-copy-btn sub-copy" style="font-size:10px; padding:2px 6px; min-height:18px;" data-text="${multiCharInfo.baseNegative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                            </div>
                            <div class="rbq-extractor-multi-char-item-row-content">${multiCharInfo.baseNegative}</div>
                        </div>
                    ` : ''}
                </div>
            `;

            multiCharInfo.characters.forEach(char => {
                charHtml += `
                    <div class="rbq-extractor-multi-char-item">
                        <div class="rbq-extractor-multi-char-item-title">
                            <i class="fa-solid fa-user-tag"></i> 角色 ${char.index} ${char.coord ? `[位置: ${char.coord}]` : ''}
                        </div>
                        ${char.prompt ? `
                            <div class="rbq-extractor-multi-char-item-row">
                                <div class="rbq-extractor-multi-char-item-row-header">
                                    <span>角色正向提示词</span>
                                    <button class="menu_button rbq-extractor-copy-btn sub-copy" style="font-size:10px; padding:2px 6px; min-height:18px;" data-text="${char.prompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                                </div>
                                <div class="rbq-extractor-multi-char-item-row-content">${char.prompt}</div>
                            </div>
                        ` : ''}
                        ${char.negative ? `
                            <div class="rbq-extractor-multi-char-item-row">
                                <div class="rbq-extractor-multi-char-item-row-header">
                                    <span>角色反向提示词 (UC)</span>
                                    <button class="menu_button rbq-extractor-copy-btn sub-copy" style="font-size:10px; padding:2px 6px; min-height:18px;" data-text="${char.negative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                                </div>
                                <div class="rbq-extractor-multi-char-item-row-content">${char.negative}</div>
                            </div>
                        ` : ''}
                    </div>
                `;
            });

            container.innerHTML = charHtml;

            btn.onclick = () => {
                const isVisible = container.style.display === 'block';
                container.style.display = isVisible ? 'none' : 'block';
                btn.innerHTML = isVisible 
                    ? '<i class="fa-solid fa-users"></i> 查看多角色提示词' 
                    : '<i class="fa-solid fa-chevron-up"></i> 收起多角色提示词';
            };

            container.querySelectorAll('.sub-copy').forEach(copyBtn => {
                copyBtn.onclick = (e) => {
                    e.stopPropagation();
                    const text = copyBtn.getAttribute('data-text');
                    navigator.clipboard.writeText(text).then(() => {
                        const old = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> 成功';
                        copyBtn.style.color = '#88ff88';
                        setTimeout(() => { copyBtn.innerHTML = old; copyBtn.style.color = '#fff'; }, 2000);
                    });
                };
            });

            bodyDiv.appendChild(btn);
            bodyDiv.appendChild(container);
        }

        const negTitle = isSimple && parsed.source === 'NovelAI'
            ? '反向提示词 (Undesired Content)'
            : '反向提示词 (Negative)';

        const presetMatch = detectPreset(parsed);
        const fields = [];
        if (presetMatch) {
            fields.push(createField('检测到的提示词预设 (Preset)', presetMatch.name));
            if (presetMatch.presetPositive) {
                fields.push(createField('主提示词 (Main Prompt - 已分离预设)', presetMatch.mainPrompt || '(空)'));
                fields.push(createField('预设正面提示词', presetMatch.presetPositive));
            }
            fields.push(createField('正向提示词 (完整)', parsed.prompt));
            
            if (presetMatch.presetNegative) {
                fields.push(createField('主反向提示词 (Main Negative - 已分离预设)', presetMatch.mainNegative || '(空)'));
                fields.push(createField('预设反向提示词', presetMatch.presetNegative));
            }
            fields.push(createField('反向提示词 (完整)', parsed.negative));
        } else {
            fields.push(createField('正向提示词 (Prompt)', parsed.prompt));
            fields.push(createField(negTitle, parsed.negative));
        }
        fields.forEach(f => f && bodyDiv.appendChild(f));

        const grid = document.createElement('div');
        grid.className = 'rbq-extractor-grid';
        
        let smallFields = [];
        if (isSimple) {
            smallFields = [
                createField('种子 (Seed)', parsed.seed),
                createField('尺寸 (Size)', parsed.size),
                createField('步数 (Steps)', parsed.steps),
                createField('CFG (Scale)', parsed.cfg),
                createField('采样器 (Sampler)', parsed.sampler)
            ];
        } else {
            smallFields = [
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
        }
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
            toastr.info('正在解析图片元数据...', 'NAI 提取器');
            const res = await fetch(imgUrl);
            const blob = await res.blob();

            const arrayBuffer = await blob.arrayBuffer();
            const metadata = readPngMetadata(arrayBuffer);
            const parsed = parseImageMetadata(metadata);

            if (parsed.source === 'NovelAI') {
                toastr.success('成功提取并解析 NAI 元数据！');
            } else {
                toastr.success(`成功提取并解析 ${parsed.source} 元数据！`);
            }
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

        const presetMatch = detectPreset(parsed);
        let promptSection = '';
        if (presetMatch) {
            promptSection += `
                <div class="st-scene-trigger-inspector-field" style="border-left: 3px solid var(--mode-accent, #ff7aa8);">
                    <div class="st-scene-trigger-inspector-field-header">
                        <span class="st-scene-trigger-inspector-field-name" style="color: var(--mode-accent, #ff7aa8); font-weight: bold;">检测到提示词预设 (Preset)</span>
                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${presetMatch.name.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制名称</button>
                    </div>
                    <div class="st-scene-trigger-inspector-field-value" style="font-weight: bold; color: var(--mode-accent, #ff7aa8);">${presetMatch.name}</div>
                </div>
            `;
            
            if (presetMatch.presetPositive) {
                promptSection += `
                    <div class="st-scene-trigger-inspector-field">
                        <div class="st-scene-trigger-inspector-field-header">
                            <span class="st-scene-trigger-inspector-field-name">主提示词 (Main Prompt - 已分离预设)</span>
                            <div class="st-scene-trigger-inspector-field-actions">
                                <button class="st-scene-trigger-inspector-btn btn-import-test" data-import="${presetMatch.mainPrompt.replace(/"/g, '&quot;')}"><i class="fa-solid fa-arrow-up-from-bracket"></i> 导入到测试</button>
                                <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${presetMatch.mainPrompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                            </div>
                        </div>
                        <div class="st-scene-trigger-inspector-field-value">${presetMatch.mainPrompt || '(空)'}</div>
                    </div>
                    <div class="st-scene-trigger-inspector-field">
                        <div class="st-scene-trigger-inspector-field-header">
                            <span class="st-scene-trigger-inspector-field-name">预设正面提示词</span>
                            <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${presetMatch.presetPositive.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                        </div>
                        <div class="st-scene-trigger-inspector-field-value" style="opacity: 0.8;">${presetMatch.presetPositive}</div>
                    </div>
                `;
            }
            
            promptSection += `
                <div class="st-scene-trigger-inspector-field">
                    <div class="st-scene-trigger-inspector-field-header">
                        <span class="st-scene-trigger-inspector-field-name">正向提示词 (完整)</span>
                        <div class="st-scene-trigger-inspector-field-actions">
                            <button class="st-scene-trigger-inspector-btn btn-import-test-full" data-import="${parsed.prompt.replace(/"/g, '&quot;')}"><i class="fa-solid fa-arrow-up-from-bracket"></i> 导入完整提示词</button>
                            <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${parsed.prompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                        </div>
                    </div>
                    <div class="st-scene-trigger-inspector-field-value" style="opacity: 0.7;">${parsed.prompt}</div>
                </div>
            `;
            
            if (presetMatch.presetNegative) {
                promptSection += `
                    <div class="st-scene-trigger-inspector-field">
                        <div class="st-scene-trigger-inspector-field-header">
                            <span class="st-scene-trigger-inspector-field-name">主反向提示词 (Main Negative - 已分离预设)</span>
                            <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${presetMatch.mainNegative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                        </div>
                        <div class="st-scene-trigger-inspector-field-value">${presetMatch.mainNegative || '(空)'}</div>
                    </div>
                    <div class="st-scene-trigger-inspector-field">
                        <div class="st-scene-trigger-inspector-field-header">
                            <span class="st-scene-trigger-inspector-field-name">预设反向提示词</span>
                            <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${presetMatch.presetNegative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                        </div>
                        <div class="st-scene-trigger-inspector-field-value" style="opacity: 0.8;">${presetMatch.presetNegative}</div>
                    </div>
                `;
            }
            
            promptSection += `
                <div class="st-scene-trigger-inspector-field">
                    <div class="st-scene-trigger-inspector-field-header">
                        <span class="st-scene-trigger-inspector-field-name">反向提示词 (完整)</span>
                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${parsed.negative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                    </div>
                    <div class="st-scene-trigger-inspector-field-value" style="opacity: 0.7;">${parsed.negative}</div>
                </div>
            `;
        } else {
            if (parsed.prompt) {
                promptSection += `
                    <div class="st-scene-trigger-inspector-field">
                        <div class="st-scene-trigger-inspector-field-header">
                            <span class="st-scene-trigger-inspector-field-name">正向提示词 (Prompt)</span>
                            <div class="st-scene-trigger-inspector-field-actions">
                                <button class="st-scene-trigger-inspector-btn btn-import-test" data-import="${parsed.prompt.replace(/"/g, '&quot;')}"><i class="fa-solid fa-arrow-up-from-bracket"></i> 导入到测试</button>
                                <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${parsed.prompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                            </div>
                        </div>
                        <div class="st-scene-trigger-inspector-field-value">${parsed.prompt}</div>
                    </div>
                `;
            }
            if (parsed.negative) {
                promptSection += `
                    <div class="st-scene-trigger-inspector-field">
                        <div class="st-scene-trigger-inspector-field-header">
                            <span class="st-scene-trigger-inspector-field-name">反向提示词 (Negative UC)</span>
                            <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${parsed.negative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i> 复制</button>
                        </div>
                        <div class="st-scene-trigger-inspector-field-value">${parsed.negative}</div>
                    </div>
                `;
            }
        }

        const multiCharInfo = extractMultiCharInfo(parsed);
        let multiCharBtnHtml = '';
        if (multiCharInfo) {
            multiCharBtnHtml = `
                <button class="st-scene-trigger-inspector-btn rbq-inspector-multi-char-btn" style="background: var(--mode-accent, #ff7aa8); color: #fff; margin-bottom: 12px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; font-weight: bold; border-radius: 6px; border: none; cursor: pointer;">
                    <i class="fa-solid fa-users"></i> 查看多角色提示词
                </button>
                <div class="st-scene-trigger-inspector-multi-char-container">
                    <div class="st-scene-trigger-inspector-multi-char-item">
                        <div class="st-scene-trigger-inspector-multi-char-item-title">
                            <i class="fa-solid fa-mountain-sun"></i> 场景/背景 (Base)
                        </div>
                        ${multiCharInfo.basePrompt ? `
                            <div class="st-scene-trigger-inspector-multi-char-item-row">
                                <div class="st-scene-trigger-inspector-multi-char-item-row-header">
                                    <span>正向提示词</span>
                                    <div class="st-scene-trigger-inspector-field-actions">
                                        <button class="st-scene-trigger-inspector-btn btn-import-test" data-import="${multiCharInfo.basePrompt.replace(/"/g, '&quot;')}"><i class="fa-solid fa-arrow-up-from-bracket"></i> 导入</button>
                                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${multiCharInfo.basePrompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i></button>
                                    </div>
                                </div>
                                <div class="st-scene-trigger-inspector-multi-char-item-row-content">${multiCharInfo.basePrompt}</div>
                            </div>
                        ` : ''}
                        ${multiCharInfo.baseNegative ? `
                            <div class="st-scene-trigger-inspector-multi-char-item-row">
                                <div class="st-scene-trigger-inspector-multi-char-item-row-header">
                                    <span>反向提示词 (UC)</span>
                                    <div class="st-scene-trigger-inspector-field-actions">
                                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${multiCharInfo.baseNegative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i></button>
                                    </div>
                                </div>
                                <div class="st-scene-trigger-inspector-multi-char-item-row-content">${multiCharInfo.baseNegative}</div>
                            </div>
                        ` : ''}
                    </div>
            `;

            multiCharInfo.characters.forEach(char => {
                multiCharBtnHtml += `
                    <div class="st-scene-trigger-inspector-multi-char-item">
                        <div class="st-scene-trigger-inspector-multi-char-item-title">
                            <i class="fa-solid fa-user-tag"></i> 角色 ${char.index} ${char.coord ? `[位置: ${char.coord}]` : ''}
                        </div>
                        ${char.prompt ? `
                            <div class="st-scene-trigger-inspector-multi-char-item-row">
                                <div class="st-scene-trigger-inspector-multi-char-item-row-header">
                                    <span>角色正向提示词</span>
                                    <div class="st-scene-trigger-inspector-field-actions">
                                        <button class="st-scene-trigger-inspector-btn btn-import-test" data-import="${char.prompt.replace(/"/g, '&quot;')}"><i class="fa-solid fa-arrow-up-from-bracket"></i> 导入</button>
                                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${char.prompt.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i></button>
                                    </div>
                                </div>
                                <div class="st-scene-trigger-inspector-multi-char-item-row-content">${char.prompt}</div>
                            </div>
                        ` : ''}
                        ${char.negative ? `
                            <div class="st-scene-trigger-inspector-multi-char-item-row">
                                <div class="st-scene-trigger-inspector-multi-char-item-row-header">
                                    <span>角色反向提示词 (UC)</span>
                                    <div class="st-scene-trigger-inspector-field-actions">
                                        <button class="st-scene-trigger-inspector-btn btn-copy" data-text="${char.negative.replace(/"/g, '&quot;')}"><i class="fa-regular fa-copy"></i></button>
                                    </div>
                                </div>
                                <div class="st-scene-trigger-inspector-multi-char-item-row-content">${char.negative}</div>
                            </div>
                        ` : ''}
                    </div>
                `;
            });

            multiCharBtnHtml += `
                </div>
            `;
        }

        container.innerHTML = `
            <div class="st-scene-trigger-inspector-result-title">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
                <span>解析结果 (${parsed.source})</span>
            </div>

            ${multiCharBtnHtml}

            ${promptSection}

            ${gridHtml ? `
                <div class="st-scene-trigger-inspector-grid">
                    ${gridHtml}
                </div>
            ` : ''}
        `;

        if (multiCharInfo) {
            const toggleBtn = container.querySelector('.rbq-inspector-multi-char-btn');
            const subContainer = container.querySelector('.st-scene-trigger-inspector-multi-char-container');
            if (toggleBtn && subContainer) {
                toggleBtn.addEventListener('click', () => {
                    const isVisible = subContainer.style.display === 'block';
                    subContainer.style.display = isVisible ? 'none' : 'block';
                    toggleBtn.innerHTML = isVisible
                        ? '<i class="fa-solid fa-users"></i> 查看多角色提示词'
                        : '<i class="fa-solid fa-chevron-up"></i> 收起多角色提示词';
                });
            }
        }

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

        // Bind import to test prompt events
        container.querySelectorAll('.btn-import-test, .btn-import-test-full').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.getAttribute('data-import');
                const textarea = document.getElementById('st-scene-trigger-test-prompt');
                if (textarea && text !== null) {
                    textarea.value = text;
                    toastr.success('已导入至测试提示词输入框', 'Prompt Reader');
                }
            });
        });

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

    function injectInspectorTab() {
        const rail = document.querySelector('.st-scene-trigger-tab-rail');
        const content = document.querySelector('.st-scene-trigger-modal-content');
        if (!rail || !content) return;

        if (document.getElementById('rbq-inspector-tab')) return;

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
                .st-scene-trigger-inspector-multi-char-container {
                  display: none;
                  margin-bottom: 12px;
                  background: rgba(255, 255, 255, 0.01);
                  border: 1px solid rgba(255, 255, 255, 0.05);
                  border-radius: 8px;
                  padding: 8px;
                }
                .st-scene-trigger-inspector-multi-char-item {
                  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
                  padding-bottom: 8px;
                  margin-bottom: 8px;
                }
                .st-scene-trigger-inspector-multi-char-item:last-child {
                  border-bottom: none;
                  padding-bottom: 0;
                  margin-bottom: 0;
                }
                .st-scene-trigger-inspector-multi-char-item-title {
                  font-size: 12px;
                  font-weight: bold;
                  color: var(--mode-accent, #ff7aa8);
                  margin-bottom: 4px;
                  display: flex;
                  align-items: center;
                  gap: 4px;
                }
                .st-scene-trigger-inspector-multi-char-item-row {
                  margin-top: 4px;
                  background: rgba(0, 0, 0, 0.15);
                  padding: 6px;
                  border-radius: 6px;
                  font-size: 11.5px;
                  border: 1px solid rgba(255, 255, 255, 0.02);
                }
                .st-scene-trigger-inspector-multi-char-item-row-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  font-size: 10px;
                  color: rgba(255, 255, 255, 0.4);
                  margin-bottom: 2px;
                  gap: 6px;
                }
                .st-scene-trigger-inspector-multi-char-item-row-content {
                  word-break: break-all;
                  white-space: pre-wrap;
                  font-family: var(--font-family, monospace);
                  max-height: 60px;
                  overflow-y: auto;
                  color: #ddd;
                }
            `;
            document.head.appendChild(style);
        }

        const button = document.createElement('button');
        button.className = 'st-scene-trigger-tab-button';
        button.id = 'rbq-inspector-tab';
        button.dataset.kiteTab = 'inspector';
        button.type = 'button';
        button.innerHTML = '<i class="fa-solid fa-file-invoice"></i><span>图片解析</span>';
        button.addEventListener('click', () => {
            document.querySelectorAll('[data-kite-tab]').forEach((el) => {
                el.classList.toggle('active', el.dataset.kiteTab === 'inspector');
            });
            document.querySelectorAll('[data-kite-panel]').forEach((el) => {
                el.classList.toggle('active', el.dataset.kitePanel === 'inspector');
            });
        });

        const testButton = rail.querySelector('[data-kite-tab="test"]');
        if (testButton && testButton.nextSibling) {
            rail.insertBefore(button, testButton.nextSibling);
        } else {
            rail.append(button);
        }

        const panel = document.createElement('section');
        panel.className = 'st-scene-trigger-modal-panel';
        panel.dataset.kitePanel = 'inspector';
        panel.innerHTML = `
            <div class="st-scene-trigger-panel-title"><i class="fa-solid fa-file-invoice"></i><span>图片信息解析 (Prompt Reader)</span></div>
            <div class="st-scene-trigger-inspector-dropzone" id="st-scene-trigger-inspector-dropzone">
                <i class="fa-solid fa-cloud-arrow-up"></i>
                <span>拖拽图片至此处，或点击上传解析元数据</span>
                <input type="file" id="st-scene-trigger-inspector-file" style="display: none;" accept="image/png">
            </div>
            <div class="st-scene-trigger-inspector-result" id="st-scene-trigger-inspector-result" style="display: none;"></div>
        `;
        content.append(panel);

        const dropzone = panel.querySelector('#st-scene-trigger-inspector-dropzone');
        const fileInput = panel.querySelector('#st-scene-trigger-inspector-file');
        
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

        injectInspectorTab();

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
