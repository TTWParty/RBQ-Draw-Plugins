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

    // Dynamic Context Analyzer (DCA)
    function analyzePersonAttributes(text) {
        const attrs = {
            gender: "unknown",
            ageGroup: "unknown",
            status: "default",
        };

        const youngAdultKeywords = [
            "女主持", "男主持", "解说", "花旦", "主播", "网红", "明星", "歌手", "演员", 
            "余霜", "周淑怡", "Rita", "青年", "大学生", "小伙", "姑娘", "妹子", "美女", "帅哥", "20岁", "30岁"
        ];
        const elderlyKeywords = [
            "老人", "老太太", "老爷爷", "老奶奶", "大爷", "老汉", "老翁", "老妇", 
            "退休", "院士", "七旬", "八旬", "九旬", "百岁", "60岁", "70岁", "80岁", "90岁", "老年"
        ];
        const childKeywords = [
            "儿童", "幼儿", "婴儿", "小男孩", "小女孩", "少年", "小学生", "宝宝", "男童", "女童", "10岁", "几岁"
        ];
        const middleAgedKeywords = [
            "中年", "中老年", "40岁", "50岁", "母亲", "父亲", "大叔", "阿姨"
        ];

        if (youngAdultKeywords.some(kw => text.includes(kw))) {
            attrs.ageGroup = "young-adult";
        } else if (elderlyKeywords.some(kw => text.includes(kw))) {
            attrs.ageGroup = "elderly";
        } else if (childKeywords.some(kw => text.includes(kw))) {
            attrs.ageGroup = "child";
        } else if (middleAgedKeywords.some(kw => text.includes(kw))) {
            attrs.ageGroup = "middle-aged";
        }

        const femaleKeywords = ["女", "女孩", "女子", "妇女", "美女", "姑娘", "妹子", "余霜", "周淑怡", "Rita", "老太太", "老奶奶", "大妈", "阿姨"];
        const maleKeywords = ["男", "男孩", "男子", "帅哥", "大爷", "老汉", "老爷爷", "老翁", "大叔", "老教授", "老科学家"];

        const hasFemale = femaleKeywords.some(kw => text.includes(kw));
        const hasMale = maleKeywords.some(kw => text.includes(kw));

        if (hasFemale && !hasMale) {
            attrs.gender = "female";
        } else if (hasMale && !hasFemale) {
            attrs.gender = "male";
        } else if (hasFemale && hasMale) {
            attrs.gender = "neutral";
        }

        if (text.includes("发布会") || text.includes("会议") || text.includes("论坛") || text.includes("院士") || text.includes("官方") || text.includes("政务") || text.includes("通报")) {
            attrs.status = "formal";
        } else if (text.includes("街拍") || text.includes("生图") || text.includes("私服") || text.includes("日常") || text.includes("生活") || text.includes("帖子")) {
            attrs.status = "casual";
        } else if (text.includes("历史") || text.includes("古代") || text.includes("朝代") || text.includes("世纪") || text.includes("传记")) {
            attrs.status = "historical";
        }

        return attrs;
    }

    // Prompt Sanitization and Optimization Pipeline (PSOP)
    function optimizePromptForGrok(rawPrompt, reqAspectRatio) {
        let prompt = rawPrompt;

        const cleanReplacements = [
            [/生图状态引争议/g, ""],
            [/引争议/g, ""],
            [/引热议/g, ""],
            [/热议/g, ""],
            [/争议/g, ""],
            [/这还是我们认识的.*吗/g, ""],
            [/这还是.*吗/g, ""],
            [/震惊/g, ""],
            [/吃瓜/g, ""],
            [/翻车/g, ""],
            [/带节奏/g, ""],
            [/爆出/g, ""],
            [/曝光/g, ""],
            [/近照/g, ""],
            [/近照曝光/g, ""],
            [/网传/g, ""],
            [/网友/g, ""],
            [/岁月无情/g, ""],
            [/面显疲态/g, ""],
            [/皮肤状态与精修图差异巨大/g, ""],
            [/被戏称为.*真阿姨.*/g, ""],
            [/真阿姨/g, ""],
            [/阿姨/g, ""],
            [/：/g, " "],
            [/！/g, " "],
            [/？/g, " "],
            [/，/g, " "],
            [/。/g, " "],
        ];

        for (const [pattern, replacement] of cleanReplacements) {
            prompt = prompt.replace(pattern, replacement);
        }

        prompt = prompt.replace(/\s+/g, " ").trim();

        // Categorize aspect ratio for preset styles
        let styleGuide = "";
        const parts = reqAspectRatio.split(':').map(Number);
        if (parts.length === 2) {
            const val = parts[0] / parts[1];
            if (val >= 1.5) {
                // Wide
                styleGuide = "Professional wide-angle corporate photography, clear architectural details, modern workspace.";
            } else if (val <= 0.75) {
                // Vertical
                styleGuide = "Candid smartphone photo taken casually, natural lighting, realistic forum attachment style.";
            } else {
                // Square/Standard
                styleGuide = "Clean informative encyclopedia illustration, high-fidelity clear photo, neutral professional background.";
            }
        } else {
            styleGuide = "Clean informative encyclopedia illustration, high-fidelity clear photo, neutral professional background.";
        }

        const attrs = analyzePersonAttributes(rawPrompt);
        let subjectGuide = "";

        if (attrs.gender !== "unknown" || attrs.ageGroup !== "unknown") {
            let genderStr = "person";
            if (attrs.gender === "female") {
                genderStr = "woman";
            } else if (attrs.gender === "male") {
                genderStr = "man";
            }

            let ageStr = "";
            let detailsStr = "";
            
            if (attrs.ageGroup === "young-adult") {
                ageStr = "young (around 25-35 years old)";
                detailsStr = "attractive, elegant, flawless skin, modern stylish appearance";
            } else if (attrs.ageGroup === "middle-aged") {
                ageStr = "middle-aged (around 45-50 years old)";
                detailsStr = "dignified, natural look, light character lines";
            } else if (attrs.ageGroup === "elderly") {
                ageStr = "elderly (around 70-80 years old)";
                detailsStr = "wise, kind, natural grey hair, visible wrinkles, respectful appearance";
            } else if (attrs.ageGroup === "child") {
                ageStr = "young child";
                detailsStr = "innocent, cheerful expression";
            }

            let statusStr = "";
            if (attrs.status === "formal") {
                statusStr = "wearing professional formal business attire, neat appearance, posing in a professional setting";
            } else if (attrs.status === "casual") {
                statusStr = "wearing casual clothes, natural candid expression, captured in a real-world everyday setting";
            } else if (attrs.status === "historical") {
                statusStr = "depicted in historical portrait painting or classic photograph style appropriate to their historical era";
            }

            const isHorror = /sfx|prosthetic|slice|cut|macabre|gothic|blood|horror|decapitated|beheaded|斩首|断头|血腥|暗黑/i.test(rawPrompt);
            if (isHorror) {
                detailsStr = "pale skin, empty or haunted expression, suitable for a dark horror setting";
                statusStr = "depicted in a dark horror realistic style, moody atmospheric lighting";
            }

            subjectGuide = `Guideline for the subject: If depicting a person, represent them as a ${ageStr} ${genderStr}. They should be ${detailsStr}. ${statusStr}.`;
        }

        const safetyGuide = "No distorted text, no gibberish writing, no letters inside the image, photorealistic, high quality, 8k resolution.";

        return [styleGuide, `Subject and context: ${prompt}.`, subjectGuide, safetyGuide].filter(Boolean).join(" ");
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

        if (onProgress) onProgress('正在清洗并优化提示词...');
        // Map Aspect Ratio and Resolution
        const matchedRatio = matchAspectRatio(image.width, image.height);
        
        // Optimize prompt
        const optimizedPrompt = optimizePromptForGrok(prompt, matchedRatio);

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
