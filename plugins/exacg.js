/**
 * RBQ-Draw Sub-Plugin: Exacg (Pro / Fully-Modular)
 * Version: 0.2.5
 * Description: 完美适配官方文档，内置全量模型列表与“服务器级”穿透引擎。
 */

(function() {
    const MODE_ID = 'exacg';
    
    // 完美匹配官方 0-17 模型列表
    const EXACG_MODELS = [
        { id: "0", name: "0 | Miaomiao Harem vPred Dogma 1.1" },
        { id: "1", name: "1 | MiaoMiao Pixel 像素 1.0" },
        { id: "2", name: "2 | NoobAIXL V1.1" },
        { id: "3", name: "3 | illustrious_pencil 融合" },
        { id: "4", name: "4 | [自然语言] Z-Image (8步/无质量词)" },
        { id: "5", name: "5 | [全新] RealSkin EPS 1.3" },
        { id: "6", name: "6 | [全新] Newbie exp 0.1" },
        { id: "7", name: "7 | [全新] Newbie exp 0.1 (F2)" },
        { id: "8", name: "8 | [全新] RealSkin vPred 1.1" },
        { id: "9", name: "9 | [新服] RealSkin vPred 1.0" },
        { id: "10", name: "10 | [全新] Wainsfw illustrious v16" },
        { id: "11", name: "11 | [新服] Wainsfw illustrious v15" },
        { id: "12", name: "12 | [新服] MiaoMiao Harem 1.75" },
        { id: "13", name: "13 | [新服] MiaoMiao Harem 1.6G" },
        { id: "14", name: "14 | Wainsfw Illustrious v13 (F1)" },
        { id: "15", name: "15 | Wainsfw Illustrious v13 (F2)" },
        { id: "16", name: "16 | Wainsfw Illustrious v11" },
        { id: "17", name: "17 | 真人模型 Nsfw-Real" }
    ];

    window.RBQ.api.registerMode(MODE_ID, {
        title: '生图渠道 (Exacg)',
        subtitle: '已开启“服务器级”通信隧道',
        accent: 'free'
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        
        const baseUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '');
        const targetUrl = `${baseUrl}/api/v1/generate_image`;
        
        // 参数适配
        const isZImage = connection.model === "4";
        const payload = {
            prompt: prompt,
            negative_prompt: isZImage ? "" : (settings.negative || ""),
            width: image.width || 512,
            height: image.height || 512,
            steps: isZImage ? 8 : (parseInt(image.steps) || 20),
            cfg: parseFloat(image.cfg) || 7.0,
            model_index: parseInt(connection.model) || 0,
            seed: parseInt(image.seed) ?? -1
        };

        // --- 核心：高级穿透引擎 ---
        const executeRequest = async () => {
            const headers = { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${connection.apiKey}`
            };

            // 策略 1: 专用高性能代理 (cors.bridged.cc)
            // 这种代理最像真正的服务器，且对 Authorization 头支持友好
            try {
                if (onProgress) onProgress('正在启动服务器级中转...');
                const proxyUrl = `https://cors.bridged.cc/${targetUrl}`;
                const resp = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });
                if (resp.ok) return await resp.json();
            } catch (e) {
                console.warn('[Exacg] 隧道 A 繁忙，切换备用路径...');
            }

            // 策略 2: 降级隧道 (corsproxy.io)
            try {
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
                const resp = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload)
                });
                if (resp.ok) return await resp.json();
            } catch (e) {}

            throw new Error('生图请求无法连接：Exacg 官方接口拒绝了非同源请求，且代理隧道目前不可用。');
        };

        const res = await executeRequest();
        if (res.success && res.data && res.data.image_url) {
            return { url: res.data.image_url };
        } else {
            throw new Error(res.error || 'Exacg 渠道返回了错误信息，请检查密钥是否有效');
        }
    });

    // 自动刷新模型列表
    function syncUi() {
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        const modelSelect = document.getElementById('st-scene-trigger-modal-model');
        if (!modeSelect || !modelSelect || modeSelect.value !== MODE_ID) return;
        if (modelSelect.querySelector('option[data-source="exacg"]')) return;

        console.info('[Exacg] Updating model metadata...');
        const currentVal = modelSelect.value;
        modelSelect.innerHTML = '';
        EXACG_MODELS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            opt.setAttribute('data-source', 'exacg');
            modelSelect.appendChild(opt);
        });
        if (EXACG_MODELS.some(x => x.id === currentVal)) modelSelect.value = currentVal;
    }
    setInterval(syncUi, 1000);
})();
