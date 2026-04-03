/*
 * Exacg 免费生图渠道子插件 (UI 增强版)
 * 接口地址: https://sd.exacg.cc
 */
(function(RBQ, $, toastr) {
    if (!RBQ || !RBQ.api || !RBQ.api.registerMode) {
        return console.error('[EXACG] 主插件版本过低，无法启用 UI 增强功能。');
    }

    // 注册模式，现在由主插件统一管理通用参数 UI
    RBQ.api.registerMode('exacg', {
        title: '白嫖渠道 (Exacg)',
        subtitle: '支持自定义尺寸、步数、CFG 与种子的免费渠道',
        endpointLabel: 'API 接口地址',
        keyLabel: 'API 访问密钥 (Token)',
        modelLabel: '模型索引 (按 API 文档填数字)',
        accent: 'free' 
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        const baseUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '');
        const url = `${baseUrl}/api/v1/generate_image`;

        // 记录日志，方便调试
        console.info(`[EXACG] 开始处理请求: 尺寸=${image.width}x${image.height}, 步数=${image.steps}, CFG=${image.cfg}, 种子=${image.seed}`);

        if (onProgress) onProgress(`正在请求 Exacg ${image.width}x${image.height} 画面生成...`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${connection.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: prompt,
                    negative_prompt: settings.negative || '',
                    width: image.width || 512,
                    height: image.height || 512,
                    steps: Math.min(50, image.steps || 20), // 接口限制最大 50 步
                    cfg: image.cfg || 7.0,
                    model_index: parseInt(connection.model) || 0,
                    seed: image.seed || -1
                })
            });

            const result = await response.json();
            
            if (response.ok && result.success && result.data && result.data.image_url) {
                return { url: result.data.image_url };
            } else {
                throw new Error(result.error || 'Exacg 服务器生成失败');
            }
        } catch (error) {
            console.error('[EXACG] 请求异常:', error);
            throw error;
        }
    });

    console.info('[RBQ Plugin] Exacg (UI 增强版) 已加载成功');
})(window.RBQ, jQuery, toastr);
