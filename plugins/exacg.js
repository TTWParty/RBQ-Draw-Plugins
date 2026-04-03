/*
 * Exacg 免费生图渠道 (服务器代理转发 + UI 稳定版)
 * 解决浏览器 CORS 跨域限制，并锁定模型选择不丢失。
 */
(function(RBQ, $, toastr) {
    if (!RBQ || !RBQ.api || !RBQ.api.registerMode) return;

    const EXACG_MODELS = [
        { id: "0", name: "0 | Miaomiao Harem vPred Dogma 1.1" },
        { id: "1", name: "1 | MiaoMiao Pixel 像素 1.0" },
        { id: "2", name: "2 | NoobAIXL V1.1" },
        { id: "3", name: "3 | illustrious_pencil 融合" },
        { id: "4", name: "4 | [自然语言] Z-Image (自动 8 步/无质量词)" },
        { id: "5", name: "5 | [全新] RealSkin EPS 1.3" },
        { id: "6", name: "6 | [全新] Newbie exp 0.1" },
        { id: "7", name: "7 | [服务器2] Newbie exp 0.1" },
        { id: "8", name: "8 | [全新] RealSkin vPred 1.1" },
        { id: "9", name: "9 | [新服] RealSkin vPred 1.0" },
        { id: "10", name: "10 | [全新] Wainsfw v16" },
        { id: "11", name: "11 | [新服] Wainsfw v15" },
        { id: "12", name: "12 | [新服] MiaoMiao Harem 1.75" },
        { id: "13", name: "13 | [新服] MiaoMiao Harem 1.6G" },
        { id: "14", name: "14 | Wainsfw v13 (服务器1)" },
        { id: "15", name: "15 | Wainsfw v13 (服务器2)" },
        { id: "16", name: "16 | Wainsfw v11" },
        { id: "17", name: "17 | 真人模型 Nsfw-Real" },
        { id: "18", name: "18 | Qwen Image Edit (需原图)" },
        { id: "19", name: "19 | Qwen Image Edit 2511" }
    ];

    function updateExacgDropdown() {
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        const modelSelect = document.getElementById('st-scene-trigger-modal-model');
        if (!modeSelect || !modelSelect) return;

        const isExacg = modeSelect.value === 'exacg';
        const hasExacgOptions = modelSelect.querySelector('option[data-source="exacg"]');

        if (isExacg && !hasExacgOptions) {
            const currentVal = modelSelect.value; // 关键：拍快照备份当前值
            modelSelect.innerHTML = '';
            EXACG_MODELS.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                opt.setAttribute('data-source', 'exacg');
                modelSelect.appendChild(opt);
            });
            // 关键：渲染完后立即恢复之前选中的值
            if (EXACG_MODELS.some(m => m.id === currentVal)) {
                modelSelect.value = currentVal;
            }
        } else if (!isExacg && hasExacgOptions) {
            modelSelect.innerHTML = '';
        }
    }

    RBQ.api.registerMode('exacg', {
        title: '白嫖渠道 (Exacg)',
        subtitle: '已启用代理转发 (解决跨域限制)',
        endpointLabel: 'API 地址 (可用默认)',
        keyLabel: 'API 密钥 (Token)',
        modelLabel: '选择 Checkpoint 模型',
        accent: 'free'
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        const targetUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '') + '/api/v1/generate_image';
        
        let steps = parseInt(image.steps) || 20;
        if (connection.model === "4") steps = 8;

        if (onProgress) onProgress('正在通过酒馆后端转发请求 (跳过跨域限制)...');

        try {
            // 【核心改动】使用酒馆自带的 /api/external/fetch 接口进行代理转发
            // 这能完美绕过浏览器的 CORS 限制
            const proxyResponse = await fetch('/api/external/fetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: targetUrl,
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${connection.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        prompt: prompt,
                        negative_prompt: settings.negative || "",
                        width: image.width || 512,
                        height: image.height || 512,
                        steps: steps,
                        cfg: parseFloat(image.cfg) || 7.0,
                        model_index: parseInt(connection.model) || 0,
                        seed: parseInt(image.seed) ?? -1
                    })
                })
            });

            // 如果代理成功，解析其返回的内容
            if (!proxyResponse.ok) throw new Error(`代理转发失败: ${proxyResponse.status}`);
            
            const res = await proxyResponse.json();
            // 注意：代理返回的结果通常在 res.text 或 res.json 里，具体看酒馆版本
            // 正常情况下 res 就是目标 API 的直接返回结果
            if (res.success && res.data && res.data.image_url) {
                return { url: res.data.image_url };
            } else {
                throw new Error(res.error || '服务器未能通过代理生成图像');
            }
        } catch (e) {
            console.error('[EXACG] 代理请求异常:', e);
            throw e;
        }
    });

    setInterval(updateExacgDropdown, 500);
})(window.RBQ, jQuery, toastr);
