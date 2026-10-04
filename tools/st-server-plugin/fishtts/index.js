/**
 * fishtts relay (v4, CJS+info) — rbq-fish-tts 配套酒馆服务端转发插件
 * ST 1.13.x 加载器要求: 导出 info {id,name,description} + init(router), 挂载点 = /api/plugins/fishtts 。
 * 注意: SillyTavern/plugins/package.json 声明 type:commonjs, 本文件必须是 CJS (module.exports)。
 * manifest.json 在 1.13 加载器中不参与加载, 仅作说明。
 * 安装: 把 fishtts 文件夹放进 SillyTavern/plugins/ , config.yaml 开 enableServerPlugins, 重启酒馆。
 * 路由:
 *   POST /tts   -> https://api.fish.audio/v1/tts   (X-Fish-Key 优先; 兼容透传非 Basic 的 Authorization)
 *   GET  /model -> https://api.fish.audio/model    (音色库)
 * 零第三方依赖(宿主 express + Node18+ fetch), 不记录任何Key与内容日志。
 */
const UPSTREAM = 'https://api.fish.audio';

const info = {
    id: 'fishtts',
    name: 'Fish语音转发 (fishtts relay)',
    description: 'rbq-fish-tts 配套服务端转发: /api/plugins/fishtts/tts -> api.fish.audio, 前端合成走酒馆服务器, 免反代免CORS。',
};

async function relay(req, res, path) {
    try {
        const headers = {};
        ['content-type', 'model'].forEach(h => {
            if (req.headers[h]) headers[h] = req.headers[h];
        });
        // Fish Key: 优先 X-Fish-Key (v0.1.5+ 插件配置了酒馆BasicAuth时 Authorization 让位给酒馆登录);
        // 兼容回退: 透传非 Basic 的 Authorization (旧版插件直接带 Bearer)。Basic 是酒馆登录凭据, 绝不外传。
        const xfish = req.headers['x-fish-key'];
        if (xfish) headers.authorization = xfish;
        else if (req.headers.authorization && !/^basic /i.test(req.headers.authorization)) {
            headers.authorization = req.headers.authorization;
        }
        let body;
        if (req.method !== 'GET' && req.method !== 'HEAD') body = JSON.stringify(req.body || {});
        if (body && !headers['content-type']) headers['content-type'] = 'application/json';
        const up = await fetch(UPSTREAM + path, {
            method: req.method,
            headers,
            body,
        });
        const buf = Buffer.from(await up.arrayBuffer());
        const h = {};
        ['content-type'].forEach(k => { if (up.headers.has(k)) h[k] = up.headers.get(k); });
        if (!h['content-type']) h['content-type'] = 'application/octet-stream';
        res.status(up.status).set(h).send(buf);
        console.log(`[fishtts] ${req.method} ${path} -> ${up.status} (${buf.length}B)`);
    } catch (e) {
        res.status(502).json({ message: 'fishtts relay error: ' + e.message });
    }
}

function init(router) {
    // body 解析: express.json 遇到已解析(_body)请求会自动跳过, 与宿主全局解析器双重注册安全
    let jsonParser = (req, res, next) => next();
    try { jsonParser = require('express').json({ limit: '2mb' }); } catch (e) { /* 宿主已全局解析 */ }
    router.post('/tts', jsonParser, (req, res) => relay(req, res, '/v1/tts'));
    router.get('/model', (req, res) => relay(req, res, '/model' + (req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
    console.log('[fishtts] 转发插件已就绪: POST /api/plugins/fishtts/tts');
}

module.exports = { info, init };
