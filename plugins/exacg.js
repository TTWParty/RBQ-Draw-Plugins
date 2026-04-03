/**
 * RBQ-Draw Sub-Plugin: Exacg (Resilient Edition)
 * Version: 0.2.7
 * Description: 补全 0-17 全量模型，换用稳定级跨域穿透引擎。
 */

(function() {
    const MODE_ID = 'exacg';
    
    // 补全官方文档中的 0-17 全量模型列表
    const EXACG_MODELS = [
        { id: "0", name: "0 | Miaomiao Harem vPred Dogma 1.1" },
        { id: "1", name: "1 | MiaoMiao Pixel 像素 1.0" },
        { id: "2", name: "2 | NoobAIXL V1.1" },
        { id: "3", name: "3 | illustrious_pencil 融合" },
        { id: "4", name: "4 | [自然语言]Z-Image (8步/无质量词)" },
        { id: "5", name: "5 | [全新]MiaoMiao RealSkin EPS 1.3" },
        { id: "6", name: "6 | [全新]Newbie exp 0.1" },
        { id: "7", name: "7 | [全新]Newbie exp 0.1 (F2)" },
        { id: "8", name: "8 | [全新]MiaoMiao RealSkin vPred 1.1" },
        { id: "9", name: "9 | [新服]MiaoMiao RealSkin vPred 1.0" },
        { id: "10", name: "10 | [全新]Wainsfw illustrious v16" },
        { id: "11", name: "11 | [新服]Wainsfw illustrious v15" },
        { id: "12", name: "12 | [新服]MiaoMiao Harem 1.75" },
        { id: "13", name: "13 | [新服]MiaoMiao Harem 1.6G" },
        { id: "14", name: "14 | Wainsfw Illustrious v13 (F1)" },
        { id: "15", name: "15 | Wainsfw Illustrious v13 (F2)" },
        { id: "16", name: "16 | Wainsfw Illustrious v11" },
        { id: "17", name: "17 | 真人模型Nsfw-Real" }
    ];

    window.RBQ.api.registerMode(MODE_ID, {
        title: '生图渠道 (Exacg)',
        subtitle: '已开启“稳定级”自愈引擎 v0.2.7',
        accent: 'free'
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        const targetUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '') + '/api/v1/generate_image';
        
        const payload = {
            prompt: prompt,
            negative_prompt: connection.model === "4" ? "" : (settings.negative || ""),
            width: image.width || 512,
            height: image.height || 512,
            steps: connection.model === "4" ? 8 : (parseInt(image.steps) || 20),
            cfg: parseFloat(image.cfg) || 7.0,
            model_index: parseInt(connection.model) || 0,
            seed: parseInt(image.seed) ?? -1
        };

        const executeRequest_v7 = async () => {
            // 策略 A: 换用稳定的专业中转 (cors.bridged.cc)
            try {
                if (onProgress) onProgress('正在建立稳定穿透链路...');
                const proxyUrl = `https://cors.bridged.cc/${targetUrl}`;
                const resp = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${connection.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                if (resp.ok) return await resp.json();
            } catch (e) {
                console.warn('[Exacg-v7] 链路 A 异常:', e);
            }

            // 策略 B: 尝试 allorigins 加密转发
            try {
                if (onProgress) onProgress('正在切换自愈路径 B...');
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
                const resp = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (resp.ok) return await resp.json();
            } catch (e) {
                console.warn('[Exacg-v7] 链路 B 异常:', e);
            }

            // 策略 C: 最后的降级规避方案 (不带 Content-Type 尝试)
            try {
                if (onProgress) onProgress('正在强制穿透...');
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
                const resp = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${connection.apiKey}` }, // 删掉 Content-Type 触发简单请求
                    body: JSON.stringify(payload)
                });
                if (resp.ok) return await resp.json();
            } catch (e) {}

            throw new Error('生图请求无法连接。原因：所有跨域代理均无法连通 Exacg 服务器。');
        };

        const res = await executeRequest_v7();
        if (res.success && res.data && res.data.image_url) {
            return { url: res.data.image_url };
        } else {
            throw new Error(res.error || '解析引擎失败，请检查 API 密钥。');
        }
    });

    // --- UI 逻辑：全量注入 0-17 模型 ---
    function syncUi_v7() {
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        const modelSelect = document.getElementById('st-scene-trigger-modal-model');
        if (!modeSelect || !modelSelect || modeSelect.value !== MODE_ID) return;
        if (modelSelect.querySelector('option[data-source="exacg"]')) return;

        console.info('[Exacg-v7] Populating full model list...');
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
    setInterval(syncUi_v7, 1000);
})();
