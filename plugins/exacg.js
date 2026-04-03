/*
 * Exacg 免费生图渠道子插件
 * 接口地址: https://sd.exacg.cc
 */
(function(RBQ, $, toastr) {
    if (!RBQ || !RBQ.api || !RBQ.api.registerMode) {
        return console.error('[EXACG] 主插件版本过低，请先更新主插件以支持模块化功能。');
    }

    // 注册新模式
    RBQ.api.registerMode('exacg', {
        title: '白嫖渠道 (Exacg)',
        subtitle: '基于 sd.exacg.cc 的免费生图 API',
        endpointLabel: 'API 接口地址',
        keyLabel: 'API 访问密钥 (Token)',
        modelLabel: '模型索引 (默认填 0)',
        accent: 'free' // 使用绿色风格
    }, async (params) => {
        const { prompt, settings, connection, image, onProgress } = params;
        const baseUrl = (connection.url || 'https://sd.exacg.cc').replace(/\/$/, '');
        const url = `${baseUrl}/api/v1/generate_image`;

        if (onProgress) onProgress('正在向 Exacg 集群下发生图指令...');

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
                    steps: image.steps || 20,
                    cfg: image.cfg || 7.0,
                    model_index: parseInt(connection.model) || 0,
                    seed: image.seed || -1
                })
            });

            const result = await response.json();
            
            if (response.ok && result.success && result.data && result.data.image_url) {
                // 返回结果 URL，主控会自动处理后续展示和本地数据库缓存
                return { url: result.data.image_url };
            } else {
                throw new Error(result.error || 'Exacg 服务器返回错误');
            }
        } catch (error) {
            console.error('[EXACG] 请求失败:', error);
            throw error;
        }
    });

    console.info('[RBQ Plugin] Exacg 免费生图模式已激活');
})(window.RBQ, jQuery, toastr);
