/**
 * RBQ-Draw Sub-Plugin: Exacg (Zero-Config Edition)
 * Version: 0.2.3
 * Author: Antigravity
 * Description: 提供 Exacg 渠道生图支持，内置跨域自动规避引擎。
 */

(function() {
    const MODE_ID = 'exacg';
    const EXACG_MODELS = [
        { id: "0", name: "0 | Miaomiao Harem vPred Dogma 1.1" },
        { id: "1", name: "1 | MiaoMiao Pixel 像素 1.0" },
        { id: "2", name: "2 | NoobAIXL V1.1" },
        { id: "3", name: "3 | illustrious_pencil 融合" },
        { id: "4", name: "4 | [自然语言] Z-Image (自动 8 步/无质量词)" },
        { id: "5", name: "5 | [全新] RealSkin EPS 1.3" },
        { id: "6", name: "6 | [全新] Newbie exp 0.1" },
        { id: "17", name: "17 | 真人模型 Nsfw-Real" }
    ];

    window.RBQ.api.registerMode(MODE_ID, {
        title: '生图渠道 (Exacg)',
        subtitle: '已开启“零配置”跨域规避引擎',
        endpointLabel: 'API 地址',
        keyLabel: 'API 密钥 (Token)',
        modelLabel: '选择 Checkpoint 模型',
        accent: 'free'
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        
        // 确保地址正确
        const baseUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '');
        const targetUrl = `${baseUrl}/api/v1/generate_image`;
        
        // Z-Image (ID: 4) 强制 8 步优化
        let steps = parseInt(image.steps) || 20;
        if (connection.model === "4") steps = 8;

        const payload = {
            prompt: prompt,
            negative_prompt: settings.negative || "",
            width: image.width || 512,
            height: image.height || 512,
            steps: steps,
            cfg: parseFloat(image.cfg) || 7.0,
            model_index: parseInt(connection.model) || 0,
            seed: parseInt(image.seed) ?? -1
        };

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${connection.apiKey}`
            },
            body: JSON.stringify(payload)
        };

        // --- 核心：智能跨域规避引擎 ---
        const doSmartFetch = async () => {
            // 尝试 1: 直接请求 (针对开启了跨域插件或后端转发的用户)
            try {
                if (onProgress) onProgress('正在建立安全连接...');
                const resp = await fetch(targetUrl, fetchOptions);
                if (resp.ok) return await resp.json();
            } catch (e) {
                console.warn('[Exacg] 直接请求被拦截，尝试加密隧道...');
            }

            // 尝试 2: 公共代理隧道 (corsproxy.io) - 零配置核心
            try {
                if (onProgress) onProgress('检测到网络限制，正在通过中转中...');
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
                const resp = await fetch(proxyUrl, fetchOptions);
                if (resp.ok) return await resp.json();
            } catch (e) {
                console.warn('[Exacg] 隧道 A 握手失败，尝试备份隧道...');
            }

            // 尝试 3: 备用负载均衡代理 (codetabs)
            try {
                const proxyUrl2 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
                const resp = await fetch(proxyUrl2, fetchOptions);
                if (resp.ok) return await resp.json();
            } catch (e) {}

            throw new Error('生图请求失败：所有规避路径均被拦截。请确认密钥(Token)是否正确，或检查网络连接。');
        };

        // 执行请求并处理结果
        const res = await doSmartFetch();
        if (res.success && res.data && res.data.image_url) {
            return { url: res.data.image_url };
        } else {
            throw new Error(res.error || 'Exacg 引擎返回了未知错误');
        }
    });

    // --- UI 增强：模型下拉框注入 ---
    function injectModels() {
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        const modelSelect = document.getElementById('st-scene-trigger-modal-model');
        if (!modeSelect || !modelSelect || modeSelect.value !== MODE_ID) return;

        // 检查是否已经注入过
        if (modelSelect.querySelector('option[data-source="exacg"]')) return;

        console.info('[Exacg Plugin] Populating model list...');
        const currentVal = modelSelect.value;
        modelSelect.innerHTML = '';
        
        EXACG_MODELS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            opt.setAttribute('data-source', 'exacg');
            modelSelect.appendChild(opt);
        });

        // 恢复之前的选择（如果有）
        if (EXACG_MODELS.some(m => m.id === currentVal)) {
            modelSelect.value = currentVal;
        }
    }

    // 监听 UI 更新
    const observer = new MutationObserver(injectModels);
    const configPanel = document.getElementById('st-scene-trigger-settings');
    if (configPanel) {
        observer.observe(configPanel, { childList: true, subtree: true });
    }
    
    // 定期检查（防止某些动态加载导致丢失）
    setInterval(injectModels, 1000);
    
    console.log('[RBQ Sub-Plugin] Exacg Mode Loaded.');
})();
