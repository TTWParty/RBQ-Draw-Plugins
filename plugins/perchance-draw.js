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
    const createUrl = "https://image-generation.perchance.org/api/generate?userKey=" + userKey + "&requestId=st_" + Math.random() + "&__cacheBust=" + Math.random();
    
    const body = {
        generatorName: "ai-image-generator",
        channel: "ai-text-to-image-generator",
        subChannel: "public",
        prompt: finalPrompt,
        negativePrompt: negativePrompt,
        seed: -1,
        resolution: resolution,
        guidanceScale: 7
    };

    let resData;
    let attempts = 0;
    // 循环尝试 15 次，每次间隔 3 秒，防止排队被阻断
    while (attempts < 15) {
        const response = await fetch(createUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error("API 请求失败: " + response.status);
        resData = await response.json();

        if (resData.status === "success" || resData.imageId) {
            break;
        } else if (resData.status === "waiting_for_prev_request_to_finish") {
            onProgress && onProgress("排队中，第 " + (attempts + 1) + " 次重试...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            attempts++;
        } else {
            throw new Error("生图失败: " + JSON.stringify(resData));
        }
    }

    if (!resData || (!resData.imageId && resData.status !== "success")) {
        throw new Error("排队超时，请稍后重试");
    }

    onProgress && onProgress("生成成功，正在下载图片...");
    
    // 使用最新代理接口下载
    const downloadUrl = "https://image-generation.perchance.org" + resData.imageDownloadUrl;
    const imageResponse = await fetch(downloadUrl);
    if (!imageResponse.ok) throw new Error("图片下载失败");

    const blob = await imageResponse.blob();
    return { blob };
});

// =========================================================================
// 以下代码为子插件自适应界面逻辑 (实现零修改主插件，自动隐藏通用参数)
// =========================================================================
(function() {
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
            if (modelField) modelField.style.setProperty("display", "none", "important");
        } else {
            if (keyField) keyField.style.removeProperty("display");
            if (urlField) urlField.style.removeProperty("display");
            if (modelField) modelField.style.removeProperty("display");
        }
    }

    // 定时监测，确保在主插件任何 UI 刷新时，均能自动重置隐藏状态
    setInterval(syncPerchanceFields, 300);
})();
