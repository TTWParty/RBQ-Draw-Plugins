/*
 * Exacg 免费生图渠道 (独立模型管理 & CORS 优化版)
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
            // 模式切到 Exacg，注入模型
            modelSelect.innerHTML = '';
            EXACG_MODELS.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                opt.setAttribute('data-source', 'exacg');
                modelSelect.appendChild(opt);
            });
        } else if (!isExacg && hasExacgOptions) {
            // 模式离开 Exacg，立即清空我的模型，防止污染
            modelSelect.innerHTML = '';
            // 主插件的 updateModeUi 会随后把 NAI 或其他模型的正确选项填回来
        }
    }

    RBQ.api.registerMode('exacg', {
        title: '白嫖渠道 (Exacg)',
        subtitle: '支持 20 款免费模型，包含 Z-Image 自动优化',
        endpointLabel: 'API 地址 (sd.exacg.cc)',
        keyLabel: 'API 密钥 (Token)',
        modelLabel: '选择 Checkpoint 模型',
        accent: 'free'
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        const baseUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '');
        
        // Z-Image 优化
        let steps = parseInt(image.steps) || 20;
        if (connection.model === "4") {
            steps = 8;
            if (onProgress) onProgress('Z-Image 模型：已自动修正为 8 步并优化提示词。');
        }

        try {
            // 发起请求
            const resp = await fetch(`${baseUrl}/api/v1/generate_image`, {
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
            });
            
            const res = await resp.json();
            if (res.success && res.data && res.data.image_url) {
                return { url: res.data.image_url };
            } else {
                throw new Error(res.error || '服务器未能生成图像');
            }
        } catch (e) {
            console.error('[EXACG] 请求异常:', e);
            throw e;
        }
    });

    // 监听 UI 刷新
    setInterval(updateExacgDropdown, 500);
})(window.RBQ, jQuery, toastr);
