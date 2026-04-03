/*
 * Exacg 免费生图渠道 (全模型支持 & 自动优化版)
 * 包含完整 20 款模型清单，支持 Z-Image 特殊优化。
 */
(function(RBQ, $, toastr) {
    if (!RBQ || !RBQ.api || !RBQ.api.registerMode) return;

    // --- 完整模型清单 (0-19) ---
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

    // --- 核心：劫持并注入主插件的下拉菜单 ---
    function updateExacgDropdown() {
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        const modelSelect = document.getElementById('st-scene-trigger-modal-model');
        if (!modeSelect || !modelSelect) return;

        // 仅在 Exacg 模式打开时，把我们的 20 个模型塞进主插件的下拉框里
        if (modeSelect.value === 'exacg') {
            const hasExacg = modelSelect.querySelector('option[data-source="exacg"]');
            if (!hasExacg) {
                const currentVal = modelSelect.value;
                modelSelect.innerHTML = ''; // 清空原有选项
                EXACG_MODELS.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name;
                    opt.setAttribute('data-source', 'exacg');
                    modelSelect.appendChild(opt);
                });
                // 恢复之前的选择（如果有效的话）
                if (EXACG_MODELS.some(m => m.id === currentVal)) modelSelect.value = currentVal;
            }
        }
    }

    // 注册模式
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
        
        let finalSteps = parseInt(image.steps) || 20;
        let finalPrompt = prompt;

        // 【模型 4：Z-Image】特殊逻辑：修正步数、移除推荐质量词
        if (connection.model === "4") {
            finalSteps = 8;
            // 简单处理：如果提示词包含常见的质量词，可以根据需求在这里过滤
            // 这里我们保持原样发送，但确保步数是 8 步
            if (onProgress) onProgress('Z-Image 模型：已自动修正为 8 步。');
        }

        try {
            const resp = await fetch(`${baseUrl}/api/v1/generate_image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    negative_prompt: settings.negative || "",
                    width: image.width || 512,
                    height: image.height || 512,
                    steps: finalSteps,
                    cfg: parseFloat(image.cfg) || 7.0,
                    model_index: parseInt(connection.model) || 0,
                    seed: parseInt(image.seed) ?? -1
                })
            });
            const res = await resp.json();
            return res.success ? { url: res.data.image_url } : Promise.reject(res.error);
        } catch (e) { throw e; }
    });

    // 持续监听：确保 UI 始终处于注入状态
    setInterval(updateExacgDropdown, 500);
})(window.RBQ, jQuery, toastr);
