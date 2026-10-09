/**
 * Cloudflare Worker for RBQ Prompt Market (RBQ 提示词预设工坊中转网关)
 * 
 * 作用：作为安全守门员，普通用户免登录上传预设时，由本 Worker 代为向 GitHub 仓库提交 Commit。
 * 保护你的 GitHub Token 绝不泄露到前端！
 *
 * 环境变量 (Environment Variables / Secrets in Cloudflare Worker):
 * - GITHUB_TOKEN: 具有 repo 权限的 GitHub Personal Access Token (PAT)
 * - GITHUB_REPO: "TTWParty/RBQ-Prompt-Market"
 * - GITHUB_BRANCH: "main" (默认 main)
 */

export default {
    async fetch(request, env, ctx) {
        // 允许跨域 CORS
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);

        try {
            // 健康检查 / 状态查看
            if (url.pathname === '/' || url.pathname === '/api/health') {
                return new Response(JSON.stringify({
                    status: 'ok',
                    service: 'RBQ Prompt Market Gateway',
                    repo: env.GITHUB_REPO || 'TTWParty/RBQ-Prompt-Market'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // 上传预设接口
            if (url.pathname === '/api/upload' && request.method === 'POST') {
                const body = await request.json();
                const { title, author, description, tags, positive, negative, params, previewBase64 } = body;

                if (!title || !positive) {
                    return new Response(JSON.stringify({ error: '标题与正面提示词不能为空' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const repo = env.GITHUB_REPO || 'TTWParty/RBQ-Prompt-Market';
                const branch = env.GITHUB_BRANCH || 'main';
                const token = env.GITHUB_TOKEN;

                if (!token) {
                    return new Response(JSON.stringify({ error: '服务端未配置 GITHUB_TOKEN' }), {
                        status: 500,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const id = 'pm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                const timestamp = new Date().toISOString();

                // 1. 如果有预览图 (Base64)，提交图片到 previews/{id}.webp
                let previewUrl = '';
                if (previewBase64 && typeof previewBase64 === 'string') {
                    const rawBase64 = previewBase64.replace(/^data:image\/\w+;base64,/, '');
                    const imgPath = `previews/${id}.webp`;

                    const imgRes = await fetch(`https://api.github.com/repos/${repo}/contents/${imgPath}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'User-Agent': 'RBQ-Prompt-Market-Worker',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            message: `Upload preview: ${id}`,
                            content: rawBase64,
                            branch: branch
                        })
                    });

                    if (imgRes.ok) {
                        previewUrl = `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${imgPath}`;
                    }
                }

                // 2. 准备详情 JSON
                const presetDetail = {
                    id,
                    title: String(title).slice(0, 50),
                    author: String(author || '匿名社友').slice(0, 30),
                    description: String(description || '').slice(0, 200),
                    tags: Array.isArray(tags) ? tags.slice(0, 8) : [],
                    positive: String(positive).slice(0, 3000),
                    negative: String(negative || '').slice(0, 2000),
                    params: params || {},
                    previewUrl,
                    likes: 0,
                    downloads: 0,
                    createdAt: timestamp
                };

                // 提交详情到 presets/{id}.json
                const detailRes = await fetch(`https://api.github.com/repos/${repo}/contents/presets/${id}.json`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': 'RBQ-Prompt-Market-Worker',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: `Add preset: ${title} (${id})`,
                        content: btoa(unescape(encodeURIComponent(JSON.stringify(presetDetail, null, 2)))),
                        branch: branch
                    })
                });

                if (!detailRes.ok) {
                    const err = await detailRes.text();
                    return new Response(JSON.stringify({ error: '提交预设详情失败: ' + err }), {
                        status: 502,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // 3. 更新主索引 index.json
                let indexSha = null;
                let indexList = [];

                const getIndexRes = await fetch(`https://api.github.com/repos/${repo}/contents/index.json?ref=${branch}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': 'RBQ-Prompt-Market-Worker'
                    }
                });

                if (getIndexRes.ok) {
                    const indexData = await getIndexRes.json();
                    indexSha = indexData.sha;
                    try {
                        const contentStr = decodeURIComponent(escape(atob(indexData.content.replace(/\n/g, ''))));
                        indexList = JSON.parse(contentStr);
                        if (!Array.isArray(indexList)) indexList = [];
                    } catch (e) {
                        indexList = [];
                    }
                }

                // 添加索引项 (不含过长的 full prompt，方便快速加载)
                const indexItem = {
                    id: presetDetail.id,
                    title: presetDetail.title,
                    author: presetDetail.author,
                    description: presetDetail.description,
                    tags: presetDetail.tags,
                    previewUrl: presetDetail.previewUrl,
                    likes: 0,
                    downloads: 0,
                    createdAt: presetDetail.createdAt
                };

                // 最新排最前
                indexList.unshift(indexItem);

                const updateIndexBody = {
                    message: `Update index: add ${id}`,
                    content: btoa(unescape(encodeURIComponent(JSON.stringify(indexList, null, 2)))),
                    branch: branch
                };
                if (indexSha) updateIndexBody.sha = indexSha;

                await fetch(`https://api.github.com/repos/${repo}/contents/index.json`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': 'RBQ-Prompt-Market-Worker',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updateIndexBody)
                });

                return new Response(JSON.stringify({ success: true, item: presetDetail }), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            return new Response('Not Found', { status: 404, headers: corsHeaders });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message || String(err) }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};
