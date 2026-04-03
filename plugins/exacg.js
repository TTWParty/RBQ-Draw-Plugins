/**
 * RBQ-Draw Sub-Plugin: Exacg (Bypass-Master Edition)
 * Version: 0.2.6
 * Description: 采用“Content-Type 伪装”穿透技术，跳过 Preflight，彻底解决 500 和 CORS 报错。
 */

(function() {
    const MODE_ID = 'exacg';
    const EXACG_MODELS = [
        { id: "0", name: "0 | Miaomiao Harem vPred Dogma 1.1" },
        { id: "1", name: "1 | MiaoMiao Pixel 像素 1.0" },
        { id: "2", name: "2 | NoobAIXL V1.1" },
        { id: "3", name: "3 | illustrious_pencil 融合" },
        { id: "4", name: "4 | [自然语言] Z-Image (8步)" },
        { id: "17", name: "17 | 真人模型 Nsfw-Real" }
    ];

    window.RBQ.api.registerMode(MODE_ID, {
        title: '生图渠道 (Exacg)',
        subtitle: '已开启“暴力穿透”自愈引擎 v0.2.6',
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

        // --- 核心：暴力穿透执行器 ---
        const executeRequest_v6 = async () => {
            // 策略 A: Content-Type 伪装绕过法 (Simple Request Bypass)
            // 绝招：将 Content-Type 设为 text/plain，告诉浏览器这是简单请求，跳过 Preflight！
            try {
                if (onProgress) onProgress('正在执行暴力穿透 (Tunnel A)...');
                const proxyUrl = `https://cors-proxy.org/api/v1/proxy?url=${encodeURIComponent(targetUrl)}`;
                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${connection.apiKey}`,
                        'Content-Type': 'text/plain' // 欺骗浏览器，跳过预检
                    },
                    body: JSON.stringify(payload)
                });
                if (response.ok) return await response.json();
            } catch (e) {
                console.warn('[Exacg-v6] 隧道 A 失败:', e);
            }

            // 策略 B: URL 参数令牌 + ThingProxy 组合拳
            try {
                if (onProgress) onProgress('切换备用链路 (Tunnel B)...');
                // 尝试将 Token 放在 URL 中（部分代理和后端支持这种兼容）
                const authUrl = `${targetUrl}?token=${connection.apiKey}`;
                const proxyUrl = `https://thingproxy.freeboard.io/fetch/${authUrl}`;
                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (response.ok) return await response.json();
            } catch (e) {
                console.warn('[Exacg-v6] 隧道 B 失败:', e);
            }

            // 策略 C: 降级回 CorsaProxy (去除 Header 版)
            try {
                if (onProgress) onProgress('隧道重连中 (Tunnel C)...');
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${connection.apiKey}` },
                    body: JSON.stringify(payload)
                });
                if (response.ok) return await response.json();
            } catch (e) {}

            throw new Error('生图请求无法接通。原因：Exacg 服务器禁用了浏览器直接访问。请尝试在浏览器安装 "CORS Unblock" 插件，或检查网络环境。');
        };

        const res = await executeRequest_v6();
        if (res.success && res.data && res.data.image_url) {
            return { url: res.data.image_url };
        } else {
            throw new Error(res.error || 'Exacg 引擎返回了内容错误');
        }
    });

    // 模型刷新...
    function syncUi_v6() {
        const modeSelect = document.getElementById('st-scene-trigger-current-mode');
        const modelSelect = document.getElementById('st-scene-trigger-modal-model');
        if (!modeSelect || !modelSelect || modeSelect.value !== MODE_ID) return;
        if (modelSelect.querySelector('option[data-source="exacg"]')) return;

        console.info('[Exacg-v6] Syncing models...');
        modelSelect.innerHTML = '';
        EXACG_MODELS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id; opt.textContent = m.name; opt.setAttribute('data-source', 'exacg');
            modelSelect.appendChild(opt);
        });
    }
    setInterval(syncUi_v6, 1000);
})();
