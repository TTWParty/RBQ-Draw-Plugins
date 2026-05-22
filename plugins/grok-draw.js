(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('RBQ Core API 缺失!');

    const MODE_ID = 'grok';

    console.info("🌸 Grok Image Generation Sub-Plugin Loaded! 🌸");

    // Helper: calculate Sha256 hash (simulating server cache key if needed)
    function getPromptHash(prompt, aspectRatio, resolution) {
        let hash = 0;
        const str = `${prompt.trim()}_${aspectRatio}_${resolution}`;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    }


    // Helper: Aspect ratio values numerical mapping
    const RATIO_PRESETS = [
        { name: "1:1", val: 1.0 },
        { name: "16:9", val: 16/9 },
        { name: "9:16", val: 9/16 },
        { name: "4:3", val: 4/3 },
        { name: "3:4", val: 3/4 },
        { name: "3:2", val: 3/2 },
        { name: "2:3", val: 2/3 },
        { name: "2:1", val: 2/1 },
        { name: "1:2", val: 1/2 },
        { name: "19.5:9", val: 19.5/9 },
        { name: "9:19.5", val: 9/19.5 },
        { name: "20:9", val: 20/9 },
        { name: "9:20", val: 9/20 }
    ];

    // Helper: Map user width & height to the closest official aspect ratio
    function matchAspectRatio(width, height) {
        const userRatio = (width || 1024) / (height || 1024);
        let best = RATIO_PRESETS[0];
        let minDiff = Math.abs(userRatio - best.val);
        for (let i = 1; i < RATIO_PRESETS.length; i++) {
            const diff = Math.abs(userRatio - RATIO_PRESETS[i].val);
            if (diff < minDiff) {
                minDiff = diff;
                best = RATIO_PRESETS[i];
            }
        }
        return best.name;
    }

    // Helper: Calculate absolute dimensions for canvas background
    function getCanvasDimensions(ratioName, resolution) {
        const parts = ratioName.split(':').map(Number);
        const wRatio = parts[0];
        const hRatio = parts[1];
        const maxDim = resolution === "2k" ? 2048 : 1024;
        
        let w, h;
        if (wRatio >= hRatio) {
            w = maxDim;
            h = Math.round(maxDim * hRatio / wRatio);
        } else {
            h = maxDim;
            w = Math.round(maxDim * wRatio / hRatio);
        }
        if (w % 2 !== 0) w += 1;
        if (h % 2 !== 0) h += 1;
        return { w, h };
    }

    // Helper: Create offscreen canvas transparent PNG Blob
    function createTransparentBlob(width, height) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, width, height);
            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/png');
        });
    }

    // Helper: Convert blob to Base64 data URI
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Helper: Convert Base64 payload back to Blob
    function base64ToBlob(base64, mimeType = 'image/png') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }

    // Register Grok drawing mode
    window.RBQ.api.registerMode(MODE_ID, {
        title: 'Grok 生图',
        subtitle: 'Grok 远程生图模式',
        accent: 'free'
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;

        if (!connection.apiKey) {
            throw new Error('请先填入 Grok API Key');
        }

        // Determine target endpoint
        let baseUrl = connection.url || 'https://gcpa.rbq.my:8443/v1';
        baseUrl = baseUrl.replace(/\/$/, '');
        let targetUrl = baseUrl;
        if (!targetUrl.endsWith('/images/edits') && !targetUrl.endsWith('/images/generations')) {
            targetUrl = targetUrl + '/images/edits';
        }

        const isOfficial = targetUrl.includes('api.x.ai');

        if (onProgress) onProgress('正在准备提示词...');
        // Map Aspect Ratio and Resolution
        const matchedRatio = matchAspectRatio(image.width, image.height);
        
        // Use raw prompt directly
        const optimizedPrompt = prompt;

        // Resolution setting
        const maxEdge = Math.max(image.width || 1024, image.height || 1024);
        const resolution = maxEdge > 1024 ? '2k' : '1k';

        if (onProgress) onProgress('正在生成免密透明底图...');
        // Calculate dimensions and create transparent PNG
        const canvasDims = getCanvasDimensions(matchedRatio, resolution);
        const sizeParam = `${canvasDims.w}x${canvasDims.h}`;
        const transparentBlob = await createTransparentBlob(canvasDims.w, canvasDims.h);

        let response;
        if (onProgress) onProgress('正在与 Grok 建立连接...');

        if (isOfficial) {
            // Official xAI endpoint expects application/json
            const base64Data = await blobToBase64(transparentBlob);
            const jsonBody = {
                model: connection.model || 'grok-imagine-image-quality',
                prompt: optimizedPrompt,
                image: {
                    type: 'image_url',
                    url: base64Data
                },
                aspect_ratio: matchedRatio,
                resolution: resolution,
                n: 1,
                response_format: 'b64_json' // Prefer b64_json directly to avoid CORS issues downloading from CDN
            };

            response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${connection.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(jsonBody)
            });
        } else {
            // Custom proxies (e.g. gcpa.rbq.my) expect multipart/form-data
            const formData = new FormData();
            formData.append('image', transparentBlob, 'transparent.png');
            formData.append('prompt', optimizedPrompt);
            formData.append('model', connection.model || 'grok-imagine-image-quality');
            formData.append('n', '1');
            formData.append('size', sizeParam);
            formData.append('aspect_ratio', matchedRatio);
            formData.append('resolution', resolution);

            response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${connection.apiKey}`
                },
                body: formData
            });
        }

        if (!response.ok) {
            let errMsg = `Grok 接口错误 (${response.status}: ${response.statusText})`;
            try {
                const errJson = await response.json();
                if (errJson?.error?.message) {
                    errMsg = errJson.error.message;
                } else if (errJson?.error) {
                    errMsg = typeof errJson.error === 'string' ? errJson.error : JSON.stringify(errJson.error);
                }
            } catch (e) {
                try {
                    const txt = await response.text();
                    if (txt) errMsg += ` - ${txt}`;
                } catch (e2) {}
            }
            throw new Error(errMsg);
        }

        if (onProgress) onProgress('正在接收并处理生成结果...');
        const data = await response.json();
        const firstDataItem = data?.data?.[0];

        if (!firstDataItem) {
            throw new Error('Grok 返回了无效的数据结构 (Missing data array)');
        }

        let resultBlob;
        if (typeof firstDataItem.b64_json === 'string' && firstDataItem.b64_json) {
            resultBlob = base64ToBlob(firstDataItem.b64_json);
        } else if (typeof firstDataItem.url === 'string' && firstDataItem.url) {
            // Try fetching image from URL
            const imgRes = await fetch(firstDataItem.url);
            if (!imgRes.ok) {
                throw new Error(`无法从图片链接下载结果: ${firstDataItem.url}`);
            }
            resultBlob = await imgRes.blob();
        } else {
            throw new Error('Grok 返回数据中不包含图像 Base64 或链接。');
        }

        return { blob: resultBlob };
    });

    // --- UI model dropdown sync ---
    function syncUiModelList() {
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        const modelSelect = document.getElementById('st-scene-trigger-modal-model');
        if (!modeSelect || !modelSelect || modeSelect.value !== MODE_ID) return;
        if (modelSelect.querySelector('option[data-source="grok"]')) return;

        console.info('[Grok-Draw] Injecting model list...');
        modelSelect.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = 'grok-imagine-image-quality';
        opt.textContent = 'grok-imagine-image-quality (当前可用生图模型)';
        opt.setAttribute('data-source', 'grok');
        modelSelect.appendChild(opt);
        modelSelect.value = 'grok-imagine-image-quality';
    }
    setInterval(syncUiModelList, 1000);

})(window.RBQ, jQuery, toastr);
