// Perchance 极速写实生图扩展 (SillyTavern-RBQ-Draw 子插件)
RBQ.api.registerMode("perchance", {
    title: "Perchance",
    subtitle: "免费极速生图 (支持写实人像)",
    accent: "free",
    settingsFields: [
        {
            id: "st-scene-trigger-perchance-userkey",
            key: "perchanceUserKey",
            label: "Perchance UserKey",
            type: "text",
            placeholder: "请输入 64 位 userKey"
        },
        {
            id: "st-scene-trigger-perchance-style",
            key: "perchanceStyle",
            label: "生成风格",
            type: "select",
            default: "realistic",
            options: [
                { value: "realistic", text: "写实人类 (更真实)" },
                { value: "none", text: "直出模式 (无风格)" }
            ]
        },
        {
            id: "st-scene-trigger-perchance-resolution",
            key: "perchanceResolution",
            label: "图片分辨率",
            type: "select",
            default: "512x768",
            options: [
                { value: "512x768", text: "512x768 (竖版)" },
                { value: "512x512", text: "512x512 (正方形)" },
                { value: "768x512", text: "768x512 (横版)" }
            ]
        }
    ]
}, async function({ prompt, onProgress, settings }) {
    const userKey = settings.perchanceUserKey;
    if (!userKey || userKey.length !== 64) {
        throw new Error("请先在设置中填写有效的 64 位 Perchance UserKey");
    }

    onProgress && onProgress("正在提交生图任务...");

    let finalPrompt = prompt;
    let negativePrompt = "low quality, blurry, bad art";

    // 自动拼接写实人类专属提示词与过滤词
    if (settings.perchanceStyle === "realistic") {
        finalPrompt = prompt + ", in soft gaze, looking straight at the camera, skin blemishes, imperfect skin, skin pores, no makeup, no cosmetics, matured, solo, centered, RAW photo, detailed, clear features, sharp focus, film grain, 8k uhd, candid portrait, natural lighting";
        negativePrompt = "(wrong sex, wrong gender, wrong age, perfect skin, facial hair on women: 1.1), (black and white, monochrome, highly saturated, overexposure:1.1), (cropped, collage, multiple people:1.1), (famous people, models, artists, celebrities), makeup, cosmetics, denim, gore, blood, camera, deviantart, artstation, semi-realistic, cgi, 3d, render, sketch, cartoon, drawing, anime, illustration, painting, cross eyes, have strabismus, hands, jpeg";
    }

    const resolution = settings.perchanceResolution || "512x768";
    
    // 请求本地 Python 代理服务，完美解决浏览器 CORS 跨域与 Cloudflare 403 封锁
    const response = await fetch("http://127.0.0.1:8008/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: finalPrompt,
            negativePrompt: negativePrompt,
            resolution: resolution,
            userKey: userKey
        })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "生图失败 (HTTP " + response.status + ")");
    }

    onProgress && onProgress("生成成功，正在接收图片数据...");
    const blob = await response.blob();
    return { blob };
});

// =========================================================================
// 以下代码为子插件自适应界面逻辑 (实现零修改主插件，自动隐藏通用参数)
// =========================================================================
(function() {
    // 自动在后台注入默认接口与模型名称，绕过主插件的通用非空强校验
    try {
        const settings = RBQ.api.getSettings();
        if (settings) {
            let needSave = false;
            if (!settings.freeUrl) {
                settings.freeUrl = "https://image-generation.perchance.org";
                needSave = true;
            }
            if (!settings.freeModel) {
                settings.freeModel = "Perchance AI";
                needSave = true;
            }
            if (!settings.perchanceModel) {
                settings.perchanceModel = "Perchance AI";
                needSave = true;
            }
            if (needSave && typeof RBQ.api.saveSettings === "function") {
                RBQ.api.saveSettings();
            }
        }
    } catch (e) {
        console.error("自动注入默认配置失败:", e);
    }

    function syncPerchanceFields() {
        const select = document.getElementById("st-scene-trigger-current-mode");
        if (!select) return;
        const mode = select.value;
        
        const keyField = document.getElementById("st-scene-trigger-key-field");
        const urlField = document.getElementById("st-scene-trigger-url-field");
        const modelField = document.getElementById("st-scene-trigger-modal-model")?.closest(".st-scene-trigger-field");
        
        if (mode === "perchance") {
            if (keyField) keyField.style.setProperty("display", "none", "important");
            if (urlField) urlField.style.setProperty("display", "none", "important");
            if (modelField) {
                modelField.style.setProperty("display", "none", "important");
                const modelInput = document.getElementById("st-scene-trigger-modal-model");
                if (modelInput && modelInput.value !== "Perchance AI") {
                    modelInput.value = "Perchance AI";
                    modelInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        } else {
            if (keyField) keyField.style.removeProperty("display");
            if (urlField) urlField.style.removeProperty("display");
            if (modelField) modelField.style.removeProperty("display");
        }
    }

    // 定时监测，确保在主插件任何 UI 刷新时，均能自动重置隐藏状态
    setInterval(syncPerchanceFields, 300);
})();
