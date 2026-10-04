/**
 * Fish Audio 本地合成代理 (零依赖, Node 18+)
 * 作用: 官方 POST /v1/tts 禁止浏览器直连(CORS), 本代理在本机补上跨域头并转发。
 * 运行: 双击同目录「启动fish语音代理.bat」或  node fish-proxy.js
 * 用法: 插件「合成接口地址」填  http://127.0.0.1:8787
 * 安全: 只转发 api.fish.audio, 不能被当开放代理滥用; Key 只经过你本机。
 */
const http = require('http');
const os = require('os');
const UPSTREAM = 'https://api.fish.audio';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';   // 0.0.0.0 = 允许手机经局域网访问

function lanIps() {
    const out = [];
    const ifs = os.networkInterfaces();
    Object.values(ifs).forEach(list => (list || []).forEach(n => {
        if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }));
    return out;
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,model',
    'Access-Control-Max-Age': '86400',
};

http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
    }
    try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        const headers = {};
        ['authorization', 'content-type', 'model'].forEach(h => {
            if (req.headers[h]) headers[h] = req.headers[h];
        });
        const up = await fetch(UPSTREAM + req.url, {
            method: req.method,
            headers,
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        });
        const outHeaders = new Headers(up.headers);
        Object.entries(CORS).forEach(([k, v]) => outHeaders.set(k, v));
        outHeaders.delete('content-encoding');   // fetch 已解压, 防编码不匹配
        outHeaders.delete('content-length');
        const buf = Buffer.from(await up.arrayBuffer());
        res.writeHead(up.status, Object.fromEntries(outHeaders));
        res.end(buf);
        console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} -> ${up.status} (${buf.length}B)`);
    } catch (e) {
        res.writeHead(502, Object.assign({ 'Content-Type': 'application/json' }, CORS));
        res.end(JSON.stringify({ message: 'proxy error: ' + e.message }));
        console.error('ERR', e.message);
    }
}).listen(PORT, HOST, () => {
    console.log('🐟 Fish 语音本地代理已启动');
    console.log('   本机使用:   http://127.0.0.1:' + PORT);
    lanIps().forEach(ip => console.log('   手机使用:   http://' + ip + ':' + PORT + '  (手机与电脑需同一WiFi)'));
    console.log('   首次启动若弹出防火墙提示, 请勾选允许。关闭本窗口即停止。');
});
