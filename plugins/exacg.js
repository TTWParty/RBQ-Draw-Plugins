/*
 * Exacg 免费生图渠道子插件 (高度集成独立版)
 * 所有 UI 注入与模型逻辑均在本文件中完成，不依赖主插件修改。
 */
(function(RBQ, $, toastr) {
    if (!RBQ || !RBQ.api || !RBQ.api.registerMode) return;

    // --- 配置区：你的模型清单 ---
    const MODELS = [
        { id: "0", name: "0 | Miaomiao Harem vPred Dogma 1.1" },
        { id: "1", name: "1 | MiaoMiao Pixel 像素 1.0" },
        { id: "2", name: "2 | NoobAIXL V1.1" },
        { id: "3", name: "3 | illustrious_pencil 融合" },
        { id: "4", name: "4 | [自然语言] Z-Image (自动 8 步)" },
        { id: "5", name: "5 | [全新模型] RealSkin EPS 1.3" },
        { id: "6", name: "6 | [全新模型] Newbie exp 0.1" },
        { id: "7", name: "7 | [服务器 2] Newbie exp 0.1" },
        { id: "10", name: "10 | [全新模型] Wainsfw v16" },
        { id: "17", name: "17 | 真人模型 Nsfw-Real" },
        { id: "18", name: "18 | Qwen Image Edit (图生图)" },
        { id: "19", name: "19 | Qwen Image Edit 2511" }
    ];

    // --- UI 注入逻辑：自动将输入框变成下拉菜单 ---
    function syncExacgUI() {
        const modelInput = document.getElementById('st-scene-trigger-modal-model');
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        if (!modelInput || !modeSelect) return;

        if (modeSelect.value === 'exacg') {
            modelInput.style.display = 'none'; // 隐藏原始输入框
            let customSelect = document.getElementById('st-exacg-model-injector');
            
            if (!customSelect) {
                customSelect = document.createElement('select');
                customSelect.id = 'st-exacg-model-injector';
                customSelect.className = 'st-scene-trigger-modal-input'; // 借用样式
                customSelect.style.width = '100%';
                
                MODELS.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name;
                    customSelect.appendChild(opt);
                });

                // 核心：选择变化时同步回原始输入框，触发主插件的保存
                customSelect.addEventListener('change', () => {
                    modelInput.value = customSelect.value;
                    modelInput.dispatchEvent(new Event('input', { bubbles: true }));
                    modelInput.dispatchEvent(new Event('change', { bubbles: true }));
                });

                modelInput.parentNode.appendChild(customSelect);
            }
            customSelect.style.display = '';
            if (modelInput.value && MODELS.some(m => m.id === modelInput.value)) {
                customSelect.value = modelInput.value;
            }
        } else {
            // 切回其他模式时，恢复原始输入框
            const customSelect = document.getElementById('st-exacg-model-injector');
            if (customSelect) customSelect.style.display = 'none';
            modelInput.style.display = '';
        }
    }

    // 注册模式
    RBQ.api.registerMode('exacg', {
        title: '白嫖渠道 (Exacg)',
        subtitle: '已注入 20 款免费模型选择器',
        endpointLabel: 'API 地址 (sd.exacg.cc)',
        keyLabel: 'API 密钥 (Token)',
        modelLabel: '选择生图模型 (子插件注入)',
        accent: 'free'
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        const baseUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '');
        
        // 特殊逻辑：Z-Image 强制 8 步
        let steps = parseInt(image.steps) || 20;
        if (connection.model === "4") {
            steps = 8;
            if (onProgress) onProgress('Z-Image 已通过插件自动优化为 8 步...');
        }

        try {
            const resp = await fetch(`${baseUrl}/api/v1/generate_image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
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
            return res.success ? { url: res.data.image_url } : Promise.reject(res.error);
        } catch (e) { throw e; }
    });

    // 持续监听 UI 状态（确保弹窗关闭重开后依然有效）
    const timer = setInterval(syncExacgUI, 500);
    console.info('[EXACG] 子插件 UI 注入版本已载入');
})(window.RBQ, jQuery, toastr);
