(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Prompt Market] RBQ Core API missing');

    const STORAGE_KEY = '_promptMarketSettings';
    const PRESETS_STORAGE_KEY = '_promptPresets';

    // 默认基准测试底模提示词（卡密sama倾情提供）
    const BENCHMARK_POSITIVE_PROMPT = '1girl, solo, cowboy shot, slightly low angle, leaning forward, looking at viewer, platinum blonde hair, pastel pink gradient hair, very long wavy hair, twin side braids, messy bangs, hair between eyes, ahoge, purple eyes, intricate pupils, gentle smile, parted lips, light blush, mole under left eye, black beret, gold hairpin, red hair ribbon, pearl earrings, black ribbon choker, white ruffled blouse, long sleeves, flared cuffs, dark green corset vest, gold trim, lace-up front, high-waisted black pleated skirt, layered frills, leather belt, black sheer thighhighs, zettai ryouiki, one hand tucking hair behind ear, one hand holding open pocket watch, indoors, antique greenhouse, glass ceiling, arched stained glass windows, climbing ivy, potted ferns, blooming white roses, vintage wooden table, scattered parchment papers, hanging brass birdcage, sunbeams, dappled light, dust motes';

    const BENCHMARK_NEGATIVE_PROMPT = 'lowres, bad anatomy, bad hands, worst quality, blurry, text, watermark, deformed, ugly';

    const BENCHMARK_CREDIT = '测试提示词由卡密sama提供';
    const KAMI_DEFAULT_PREVIEW = 'https://market.rbq.my/previews/kami-greenhouse-girl.webp';

    // 默认配置 (默认直连自建的 market.rbq.my 节点服务)
    const DEFAULT_CONFIG = {
        serverUrl: 'https://market.rbq.my', // 自建工坊服务器
        authorName: '',
        repo: 'TTWParty/RBQ-Prompt-Market',
        branch: 'main',
        installedIds: [],
        likedIds: []
    };

    function getConfig() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { ...DEFAULT_CONFIG };
        // 自动迁移旧的 9.rbq.my 并补充默认 serverUrl
        if (!s[STORAGE_KEY].serverUrl || s[STORAGE_KEY].serverUrl.includes('9.rbq.my')) {
            s[STORAGE_KEY].serverUrl = 'https://market.rbq.my';
        }
        if (!Array.isArray(s[STORAGE_KEY].installedIds)) s[STORAGE_KEY].installedIds = [];
        if (!Array.isArray(s[STORAGE_KEY].likedIds)) s[STORAGE_KEY].likedIds = [];
        return s[STORAGE_KEY];
    }

    function saveConfig() {
        RBQ.api.saveSettings();
    }

    // 复制剪贴板通用兜底
    const copyToClipboard = async (text) => {
        if (typeof RBQ?.utils?.copyToClipboard === 'function') {
            return RBQ.utils.copyToClipboard(text);
        }
        if (!text) return false;
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_e) {}
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    };

    // 格式化采样器友好名称
    function formatSampler(name) {
        if (!name) return 'Euler A';
        const s = String(name).toLowerCase();
        if (s.includes('euler_ancestral') || s === 'k_euler_a') return 'Euler A';
        if (s.includes('euler')) return 'Euler';
        if (s.includes('dpmpp_2m_sde')) return 'DPM++ 2M SDE';
        if (s.includes('dpmpp_2m')) return 'DPM++ 2M';
        if (s.includes('dpmpp_2s_ancestral') || s.includes('dpmpp_2s_a')) return 'DPM++ 2S A';
        if (s.includes('dpmpp_sde')) return 'DPM++ SDE';
        if (s.includes('ddim')) return 'DDIM';
        return name;
    }

    // 一键同步 NAI 生图参数至酒馆设置
    function applyNaiParams(params) {
        if (!params) return;
        const s = (typeof RBQ?.api?.getSettings === 'function') ? RBQ.api.getSettings() : null;
        if (!s) {
            toastr?.warning?.('未能获取酒馆生图设置');
            return;
        }

        const scale = params.scale !== undefined && params.scale !== null ? Number(params.scale) : 6.0;
        const sampler = params.sampler || 'k_euler_ancestral';
        const steps = params.steps !== undefined && params.steps !== null ? Number(params.steps) : 28;
        const cfgRescale = params.cfgRescale !== undefined && params.cfgRescale !== null ? Number(params.cfgRescale) : 0;
        const noiseSchedule = params.noiseSchedule || s.naiNoiseSchedule || 'karras';

        s.naiScale = scale;
        s.naiSampler = sampler;
        s.naiSteps = steps;
        s.naiCfgRescale = cfgRescale;
        if (params.noiseSchedule) s.naiNoiseSchedule = noiseSchedule;

        // 同步酒馆主界面 DOM（若设置抽屉正处于开启状态）
        const setElemVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        };
        setElemVal('st-scene-trigger-nai-scale', scale);
        const scaleValEl = document.getElementById('st-scene-trigger-nai-scale-val');
        if (scaleValEl) scaleValEl.textContent = scale;
        setElemVal('st-scene-trigger-nai-sampler', sampler);
        setElemVal('st-scene-trigger-nai-steps', steps);
        setElemVal('st-scene-trigger-nai-cfg-rescale', cfgRescale);
        setElemVal('st-scene-trigger-nai-noise-schedule', noiseSchedule);

        if (typeof RBQ?.api?.saveSettings === 'function') {
            RBQ.api.saveSettings();
        }

        toastr?.success?.(`🎉 已成功同步 NAI 生图参数！\nScale: ${scale} | 采样器: ${formatSampler(sampler)} | 步数: ${steps} | Rescale: ${cfgRescale}`);
    }

    // 内置初始精品预设（即使完全离线时也立即可用）
    const BUILTIN_PRESETS = [
        {
            id: 'kami-greenhouse-girl',
            title: '复古花房·怀表麻花辫少女 (基准底模样张)',
            author: '卡密sama',
            model: 'v5',
            description: '测试提示词由卡密sama提供。全场统一基准测试底模：温室玻璃花房、拱形彩绘玻璃、精美双麻花与金发粉渐变。',
            tags: ['NAI V5', '基准底模', '卡密sama', '复古花房', '唯美少女'],
            positive: BENCHMARK_POSITIVE_PROMPT,
            negative: BENCHMARK_NEGATIVE_PROMPT,
            previewUrl: KAMI_DEFAULT_PREVIEW,
            params: { scale: 6.0, sampler: 'k_euler_ancestral', steps: 28, cfgRescale: 0 },
            likes: 521,
            downloads: 1314,
            createdAt: '2026-10-09'
        },
        {
            id: 'builtin-east-cg',
            title: '次世代东方写实御姐 CG',
            author: 'RBQ官方精选',
            model: 'v5',
            description: '纯正东方冷艳五官骨相，虚幻5电影级冷暖反差布光，细腻次表面散射肉质与真实水光。（测试预览图由卡密sama提示词渲染）',
            tags: ['NAI V5', '3D写实', '御姐', '电影光影', '次世代'],
            positive: 'high complexity, amazing quality, 2::game cg, 3d game graphics, cinematic movie still, unreal engine 5, ray tracing::, 1.5::mature asian woman, cool beauty, sharp facial features, defined nose bridge, realistic lips, dark eyes, detailed 3d face::, 1.4::cinematic lighting, dramatic shadows, dark atmosphere, cool blue tone, dramatic rim light, volumetric lighting::, 1.3::subsurface scattering, wet skin, skin sheen, sweat glisten, realistic skin texture::, 1.1::fabric texture, detailed clothing, depth of field, sharp focus, photo(medium)::',
            negative: '2::2d, anime, cartoon, stylized, flat color, cute, chibi, big anime eyes, lineart, drawing, illustration::, 1.5::plastic skin, doll, toy, figurine, garage kit, oversaturated, bright daylight, flat lighting::, lowres, bad anatomy, bad hands, worst quality, blurry',
            previewUrl: KAMI_DEFAULT_PREVIEW,
            params: { scale: 6.0, sampler: 'k_dpmpp_2m_sde', steps: 25, cfgRescale: 0 },
            likes: 128,
            downloads: 360,
            createdAt: '2026-10-09'
        },
        {
            id: 'builtin-shiny-pantyhose',
            title: '顶级油光高光透肉丝袜专精',
            author: 'RBQ官方精选',
            model: 'v4.5',
            description: '专攻高开叉长腿、透肉丝袜与强镜面反光高光条，丝滑尼龙织物感拉满。（测试预览图由卡密sama提示词渲染）',
            tags: ['NAI V4.5', '油光丝袜', '美腿', '高光反光', '御姐'],
            positive: '1.4::shiny pantyhose, glossy pantyhose, oiled pantyhose, sheer pantyhose::, 1.3::beige pantyhose, sheer to waist, seamless pantyhose, red high heels::, 1.2::glossy legs, specular highlights on pantyhose, smooth nylon, light reflection on legs::, 1.1::skin-tight, tight pantyhose, long legs::, 0.65::artist:neroma_shin::',
            negative: 'opaque pantyhose, thick tights, matte pantyhose, black pantyhose, fishnet, ripped pantyhose, lowres, bad anatomy, bad hands',
            previewUrl: KAMI_DEFAULT_PREVIEW,
            params: { scale: 5.5, sampler: 'k_euler_ancestral', steps: 23, cfgRescale: 0 },
            likes: 215,
            downloads: 512,
            createdAt: '2026-10-09'
        },
        {
            id: 'builtin-thick-skin',
            title: '顶级肉感厚涂与温润肉温',
            author: 'RBQ官方精选',
            model: 'v4.5',
            description: '融合 Neroma Shin 与 Kazuhiro 黄金画师组，极具肉温与压痕触感，解剖严谨。（测试预览图由卡密sama提示词渲染）',
            tags: ['NAI V4.5', '日系厚涂', '肉感', '微汗水光', '解剖学'],
            positive: '2::masterpiece, best quality, very aesthetic, absurdres, ultra-detailed::, 2::lifelike, realistic_rendering, intricate_details::, {anatomical accuracy}, anatomically correct, 1.35::ultra-detailed skin texture, realistic skin pores::, 1.25::subsurface scattering, skin translucency::, 1.1::dermatological detail, skin indentation detail::, 1.15::dewy skin, sweat glisten, moist skin sheen, glossy skin highlights::, 0.65::neroma_shin::, 0.65::kazuhiro (tiramisu)::',
            negative: 'lowres, bad anatomy, bad hands, worst quality, flat color, simplified',
            previewUrl: KAMI_DEFAULT_PREVIEW,
            params: { scale: 6.0, sampler: 'k_euler_ancestral', steps: 25, cfgRescale: 0 },
            likes: 189,
            downloads: 430,
            createdAt: '2026-10-09'
        }
    ];

    // 获取云端预设列表 (优先从自建服务器拉取)
    async function fetchCloudIndex() {
        const cfg = getConfig();
        const serverEndpoint = cfg.serverUrl || cfg.workerUrl;

        // 1. 如果有自建服务器地址，优先直连服务器
        if (serverEndpoint) {
            try {
                const res = await fetch(`${serverEndpoint.replace(/\/+$/, '')}/api/presets?_t=${Date.now()}`);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) return data;
                }
            } catch (err) {
                console.warn('[Prompt Market] 自建服务器获取预设失败，尝试 GitHub CDN 降级:', err);
            }
        }

        // 2. 降级走 GitHub / jsDelivr CDN
        const urls = [
            `https://cdn.jsdelivr.net/gh/${cfg.repo}@${cfg.branch}/index.json?_t=${Date.now()}`,
            `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/index.json`
        ];

        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) return data;
                }
            } catch (_e) {}
        }
        return BUILTIN_PRESETS;
    }

    // 获取单条详情
    async function fetchPresetDetail(item) {
        if (item.positive) return item;
        const cfg = getConfig();
        const serverEndpoint = cfg.serverUrl || cfg.workerUrl;
        if (serverEndpoint) {
            try {
                const res = await fetch(`${serverEndpoint.replace(/\/+$/, '')}/api/presets`);
                if (res.ok) {
                    const list = await res.json();
                    const found = list.find(x => x.id === item.id);
                    if (found && found.positive) return found;
                }
            } catch (_e) {}
        }

        const urls = [
            `https://cdn.jsdelivr.net/gh/${cfg.repo}@${cfg.branch}/presets/${item.id}.json`,
            `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/presets/${item.id}.json`
        ];
        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (res.ok) return await res.json();
            } catch (_e) {}
        }
        return item;
    }

    // 安装预设到本地 `_promptPresets`
    function installToLocalPresets(preset) {
        const s = RBQ.api.getSettings();
        if (!s[PRESETS_STORAGE_KEY]) {
            s[PRESETS_STORAGE_KEY] = { activeId: '', position: 'prepend', presets: [] };
        }
        const store = s[PRESETS_STORAGE_KEY];
        if (!Array.isArray(store.presets)) store.presets = [];

        // 检查是否已有同名或相同 ID
        const existingIdx = store.presets.findIndex(p => p.id === preset.id || p.name === preset.title);
        const newPresetObj = {
            id: preset.id || ('pp-' + Date.now().toString(36)),
            name: preset.title || '工坊预设',
            positive: preset.positive || '',
            positiveSuffix: preset.positiveSuffix || '',
            negative: preset.negative || '',
            params: preset.params || {}
        };

        if (existingIdx >= 0) {
            store.presets[existingIdx] = newPresetObj;
        } else {
            store.presets.push(newPresetObj);
        }

        RBQ.api.saveSettings();

        // 记录到已安装列表
        const cfg = getConfig();
        if (!cfg.installedIds.includes(preset.id)) {
            cfg.installedIds.push(preset.id);
            saveConfig();
        }

        toastr.success(`预设「${preset.title}」已成功装入你的本地预设库！`);
    }

    // 点赞预设
    async function likePreset(item, likeBtn, countSpan) {
        const cfg = getConfig();
        if (cfg.likedIds.includes(item.id)) {
            toastr.info('你已经为该预设点过赞啦 ❤️');
            return;
        }

        const endpoint = (cfg.serverUrl || cfg.workerUrl || '').replace(/\/+$/, '');
        // 乐观更新 UI
        item.likes = (item.likes || 0) + 1;
        countSpan.textContent = item.likes;
        likeBtn.classList.add('is-liked');
        cfg.likedIds.push(item.id);
        saveConfig();

        toastr.success(`已为「${item.title}」点赞！`);

        if (endpoint) {
            try {
                await fetch(`${endpoint}/api/like`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: item.id })
                });
            } catch (err) {
                console.warn('[Prompt Market] 点赞网络上报异常:', err);
            }
        }
    }

    // ── 注入 Game-HUD 样式防御系统 ──
    function ensureMarketStyles() {
        if (document.getElementById('rbq-prompt-market-styles')) return;
        const style = document.createElement('style');
        style.id = 'rbq-prompt-market-styles';
        style.textContent = `
            /* 宿主 .menu_button 挤压防御铁律 */
            #rbq-pm-container .menu_button,
            #rbq-pm-upload-dialog .menu_button,
            #rbq-pm-detail-dialog .menu_button,
            #rbq-pm-benchmark-dialog .menu_button {
                display: inline-flex !important;
                flex-direction: row !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 6px !important;
                white-space: nowrap !important;
                box-sizing: border-box !important;
            }

            /* 卡片与网格容器 Zero-CLS */
            .rbq-pm-card {
                background: #0f172a;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
                cursor: pointer;
                transform: translateZ(0);
                will-change: transform, box-shadow;
                transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s cubic-bezier(0.2, 0, 0, 1), border-color 0.2s ease;
            }
            .rbq-pm-card:hover {
                transform: translateY(-4px);
                border-color: rgba(56, 189, 248, 0.45);
                box-shadow: 0 12px 28px rgba(0, 0, 0, 0.65), 0 0 16px rgba(56, 189, 248, 0.18);
            }

            /* 3:4 竖版立绘专精容器 (零裁切展示完整立绘与面部表情) */
            .rbq-pm-img-wrap {
                width: 100%;
                aspect-ratio: 3 / 4;
                position: relative;
                background: #070b13;
                overflow: hidden;
            }
            .rbq-pm-img-wrap img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
                transition: transform 0.35s ease;
            }
            .rbq-pm-card:hover .rbq-pm-img-wrap img {
                transform: scale(1.05);
            }

            /* 浮动半透明模型徽章 */
            .rbq-pm-badge-model {
                position: absolute;
                top: 8px;
                left: 8px;
                z-index: 2;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.5px;
                padding: 2.5px 7px;
                border-radius: 5px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                text-transform: uppercase;
                box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            }
            .rbq-pm-badge-v5 {
                background: rgba(217, 70, 239, 0.3);
                border: 1px solid rgba(217, 70, 239, 0.6);
                color: #f0abfc;
            }
            .rbq-pm-badge-v45 {
                background: rgba(56, 189, 248, 0.3);
                border: 1px solid rgba(56, 189, 248, 0.6);
                color: #7dd3fc;
            }
            .rbq-pm-badge-gen {
                background: rgba(30, 41, 59, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: #cbd5e1;
            }

            /* 浮动半透明点赞按钮 */
            .rbq-pm-card-like {
                position: absolute;
                top: 8px;
                right: 8px;
                z-index: 2;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                background: rgba(15, 23, 42, 0.7);
                border: 1px solid rgba(255, 255, 255, 0.18);
                color: #cbd5e1;
                border-radius: 6px;
                padding: 3px 8px;
                font-size: 11px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                transition: all 0.15s ease;
            }
            .rbq-pm-card-like:hover {
                background: rgba(244, 63, 94, 0.25);
                border-color: rgba(244, 63, 94, 0.5);
                color: #fb7185;
            }
            .rbq-pm-card-like.is-liked {
                background: rgba(244, 63, 94, 0.35);
                border-color: #f43f5e;
                color: #fb7185;
            }
            .rbq-pm-card-like.is-liked i {
                color: #f43f5e;
                animation: rbq-heart-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            @keyframes rbq-heart-pop {
                0% { transform: scale(1); }
                50% { transform: scale(1.35); }
                100% { transform: scale(1); }
            }

            /* 网格布局：自适应 4~5 列 */
            #rbq-pm-card-grid {
                flex: 1;
                overflow-y: auto;
                padding: 16px 20px;
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
                gap: 16px;
                align-content: start;
            }

            /* 触控与移动端：2 列并排 */
            @media (max-width: 640px) {
                #rbq-pm-container {
                    width: 96vw !important;
                    height: 92dvh !important;
                    border-radius: 10px !important;
                }
                #rbq-pm-card-grid {
                    grid-template-columns: repeat(2, 1fr) !important;
                    gap: 10px !important;
                    padding: 10px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ── UI Modal 构建 ──
    let marketModal = null;
    let activeModelFilter = 'all'; // all | v5 | v4.5 | general
    let activeTag = '全部';
    let searchQuery = '';
    let sortMode = 'popular'; // popular | newest
    let cachedList = [];

    function openMarketModal() {
        ensureMarketStyles();

        if (marketModal) {
            marketModal.style.display = 'flex';
            loadMarketData();
            return;
        }

        marketModal = document.createElement('div');
        marketModal.id = 'rbq-prompt-market-overlay';
        marketModal.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: rgba(5, 7, 13, 0.82); backdrop-filter: blur(10px);
            display: flex; align-items: center; justify-content: center;
            font-family: inherit; color: #f1f5f9; box-sizing: border-box;
        `;

        marketModal.innerHTML = `
            <div id="rbq-pm-container" style="
                width: 94vw; max-width: 1080px; height: 88vh; max-height: 840px;
                background: #090d16; border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 16px; box-shadow: 0 25px 60px rgba(0,0,0,0.75), 0 0 30px rgba(56, 189, 248, 0.08);
                display: flex; flex-direction: column; overflow: hidden;
            ">
                <!-- Header HUD -->
                <div style="padding: 12px 20px; background: #0f172a; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg, #0284c7, #8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 17px; color: #fff; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);">
                            <i class="fa-solid fa-store"></i>
                        </div>
                        <div>
                            <div style="font-size: 15px; font-weight: 800; display: flex; align-items: center; gap: 7px;">
                                <span>提示词预设工坊</span>
                                <span style="font-size: 9.5px; font-weight: 700; background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(139, 92, 246, 0.2)); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 1px 6px; border-radius: 4px;">PROMPT MARKET</span>
                            </div>
                            <div style="font-size: 11px; color: #94a3b8; margin-top: 1px;">社区画师串与预设中心 · 一键安装与现场生图</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button id="rbq-pm-btn-upload" class="menu_button" style="background: linear-gradient(135deg, #0284c7, #2563eb); border: none; color: #fff; padding: 6px 14px; font-size: 12px; font-weight: 700; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 10px rgba(2, 132, 199, 0.35);">
                            <i class="fa-solid fa-cloud-arrow-up"></i>
                            <span>发布预设</span>
                        </button>
                        <button id="rbq-pm-btn-settings" class="menu_button" title="工坊服务器设置" style="padding: 6px 10px; font-size: 13px; color: #94a3b8; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
                            <i class="fa-solid fa-gear"></i>
                        </button>
                        <button id="rbq-pm-btn-close" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px; line-height: 1;">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <!-- Model Filter & Category Toolbar -->
                <div style="padding: 10px 20px; background: #0b1120; border-bottom: 1px solid rgba(255,255,255,0.07); display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">
                    <!-- Line 1: Model Filter Tabs + Search & Sort -->
                    <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between;">
                        <!-- Model Tabs -->
                        <div id="rbq-pm-model-tabs" style="display: flex; gap: 6px; align-items: center;">
                            <span style="font-size: 11px; color: #64748b; font-weight: 600; margin-right: 2px;">模型:</span>
                            <button class="rbq-pm-model-tab active" data-model="all" style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; border: 1px solid #38bdf8; background: rgba(56, 189, 248, 0.18); color: #38bdf8; cursor: pointer;">全部</button>
                            <button class="rbq-pm-model-tab" data-model="v5" style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; border: 1px solid rgba(217, 70, 239, 0.35); background: rgba(255,255,255,0.04); color: #f0abfc; cursor: pointer;"><i class="fa-solid fa-wand-magic-sparkles"></i> NAI V5</button>
                            <button class="rbq-pm-model-tab" data-model="v4.5" style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.35); background: rgba(255,255,255,0.04); color: #7dd3fc; cursor: pointer;"><i class="fa-solid fa-bolt"></i> NAI V4.5</button>
                            <button class="rbq-pm-model-tab" data-model="general" style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #cbd5e1; cursor: pointer;">通用/其他</button>
                        </div>

                        <!-- Search & Sort -->
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="position: relative;">
                                <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #64748b;"></i>
                                <input id="rbq-pm-search-input" type="text" placeholder="搜索画师/预设/标签..." style="background: #070b13; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 5px 10px 5px 28px; font-size: 11.5px; color: #fff; width: 170px; outline: none;">
                            </div>
                            <select id="rbq-pm-sort-select" style="background: #070b13; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 5px 8px; font-size: 11.5px; color: #94a3b8; outline: none;">
                                <option value="popular">🔥 热门点赞</option>
                                <option value="newest">🆕 最新上架</option>
                            </select>
                        </div>
                    </div>

                    <!-- Line 2: Tags Filter -->
                    <div id="rbq-pm-tag-bar" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none;">
                        <!-- Generated by renderTags -->
                    </div>
                </div>

                <!-- Main Content (Cards Grid) -->
                <div id="rbq-pm-card-grid">
                    <!-- Cards will be populated here -->
                </div>
            </div>
        `;

        document.body.appendChild(marketModal);

        // 事件监听
        marketModal.querySelector('#rbq-pm-btn-close').onclick = () => { marketModal.style.display = 'none'; };
        marketModal.addEventListener('click', (e) => {
            if (e.target === marketModal) marketModal.style.display = 'none';
        });

        marketModal.querySelector('#rbq-pm-btn-upload').onclick = () => openUploadDialog();
        marketModal.querySelector('#rbq-pm-btn-settings').onclick = () => openSettingsDialog();

        // 模型 Filter 切换
        marketModal.querySelectorAll('.rbq-pm-model-tab').forEach(tab => {
            tab.onclick = () => {
                marketModal.querySelectorAll('.rbq-pm-model-tab').forEach(t => {
                    t.style.background = 'rgba(255,255,255,0.04)';
                    t.style.borderColor = 'rgba(255,255,255,0.12)';
                });
                tab.style.background = 'rgba(56, 189, 248, 0.18)';
                tab.style.borderColor = '#38bdf8';
                activeModelFilter = tab.dataset.model;
                renderCards();
            };
        });

        const searchInput = marketModal.querySelector('#rbq-pm-search-input');
        searchInput.oninput = (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            renderCards();
        };

        const sortSelect = marketModal.querySelector('#rbq-pm-sort-select');
        sortSelect.onchange = (e) => {
            sortMode = e.target.value;
            renderCards();
        };

        renderTags();
        loadMarketData();
    }

    const POPULAR_TAGS = ['全部', '卡密sama', '3D写实', '油光丝袜', '日系厚涂', '二次元平涂', '赛博朋克', '光影氛围', '解剖学'];

    function renderTags() {
        const tagBar = marketModal.querySelector('#rbq-pm-tag-bar');
        tagBar.innerHTML = '';
        POPULAR_TAGS.forEach(tag => {
            const btn = document.createElement('button');
            const isActive = tag === activeTag;
            btn.style.cssText = `
                padding: 3px 9px; font-size: 11px; font-weight: 500; border-radius: 12px;
                border: 1px solid ${isActive ? '#38bdf8' : 'rgba(255,255,255,0.08)'};
                background: ${isActive ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.03)'};
                color: ${isActive ? '#38bdf8' : '#94a3b8'}; cursor: pointer; white-space: nowrap;
            `;
            btn.textContent = tag;
            btn.onclick = () => {
                activeTag = tag;
                renderTags();
                renderCards();
            };
            tagBar.appendChild(btn);
        });
    }

    async function loadMarketData() {
        const grid = marketModal.querySelector('#rbq-pm-card-grid');
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 26px; margin-bottom: 10px; color: #38bdf8;"></i><div>正在获取社区云端预设工坊...</div></div>';

        try {
            const list = await fetchCloudIndex();
            cachedList = Array.isArray(list) ? list : BUILTIN_PRESETS;
            renderCards();
        } catch (_err) {
            cachedList = BUILTIN_PRESETS;
            renderCards();
        }
    }

    function renderCards() {
        const grid = marketModal.querySelector('#rbq-pm-card-grid');
        grid.innerHTML = '';

        let items = [...cachedList];

        // 模型过滤
        if (activeModelFilter !== 'all') {
            items = items.filter(it => {
                const m = (it.model || '').toLowerCase();
                if (activeModelFilter === 'v5') return m === 'v5' || (it.tags || []).includes('NAI V5');
                if (activeModelFilter === 'v4.5') return m === 'v4.5' || (it.tags || []).includes('NAI V4.5');
                if (activeModelFilter === 'general') return m !== 'v5' && m !== 'v4.5';
                return true;
            });
        }

        // 标签过滤
        if (activeTag !== '全部') {
            items = items.filter(it => Array.isArray(it.tags) && it.tags.includes(activeTag));
        }

        // 关键词搜索
        if (searchQuery) {
            items = items.filter(it =>
                (it.title || '').toLowerCase().includes(searchQuery) ||
                (it.author || '').toLowerCase().includes(searchQuery) ||
                (it.description || '').toLowerCase().includes(searchQuery) ||
                (Array.isArray(it.tags) && it.tags.some(t => t.toLowerCase().includes(searchQuery)))
            );
        }

        // 排序
        if (sortMode === 'popular') {
            items.sort((a, b) => ((b.likes || 0) * 3 + (b.downloads || 0)) - ((a.likes || 0) * 3 + (a.downloads || 0)));
        } else {
            items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }

        if (items.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 70px; color: #64748b;"><i class="fa-regular fa-folder-open" style="font-size: 34px; margin-bottom: 12px;"></i><div>当前筛选分类下暂无预设</div></div>';
            return;
        }

        const cfg = getConfig();

        items.forEach(item => {
            const isInstalled = cfg.installedIds.includes(item.id);
            const isLiked = cfg.likedIds.includes(item.id);
            const card = document.createElement('div');
            card.className = 'rbq-pm-card';

            const previewSrc = item.previewUrl || KAMI_DEFAULT_PREVIEW;

            // 模型 Badge 样式判定
            const m = (item.model || '').toLowerCase();
            let modelBadgeClass = 'rbq-pm-badge-gen';
            let modelBadgeText = '通用';
            let modelBadgeIcon = '';
            if (m === 'v5' || (item.tags || []).includes('NAI V5')) {
                modelBadgeClass = 'rbq-pm-badge-v5';
                modelBadgeText = 'NAI V5';
                modelBadgeIcon = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
            } else if (m === 'v4.5' || (item.tags || []).includes('NAI V4.5')) {
                modelBadgeClass = 'rbq-pm-badge-v45';
                modelBadgeText = 'NAI V4.5';
                modelBadgeIcon = '<i class="fa-solid fa-bolt"></i>';
            }

            card.innerHTML = `
                <div class="rbq-pm-img-wrap">
                    <img src="${previewSrc}" alt="${item.title}" loading="lazy">
                    <div class="rbq-pm-badge-model ${modelBadgeClass}">${modelBadgeIcon} <span>${modelBadgeText}</span></div>
                    <button class="rbq-pm-card-like ${isLiked ? 'is-liked' : ''}" title="点赞预设">
                        <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i>
                        <span class="rbq-pm-like-num">${item.likes || 0}</span>
                    </button>
                    <div style="position: absolute; bottom: 0; inset-inline: 0; height: 36px; background: linear-gradient(transparent, rgba(15,23,42,0.85)); pointer-events: none;"></div>
                </div>
                <div style="padding: 10px 12px; background: #0f172a; display: flex; flex-direction: column; gap: 5px;">
                    <div style="font-size: 13px; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.title}">
                        ${item.title}
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="font-size: 11px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 95px;" title="${item.author || '匿名'}">
                            <i class="fa-regular fa-user" style="font-size: 10px;"></i> ${item.author || '匿名'}
                        </span>
                        <button class="rbq-pm-install-btn menu_button" style="
                            background: ${isInstalled ? 'rgba(34, 197, 94, 0.15)' : 'linear-gradient(135deg, #0284c7, #2563eb)'};
                            border: 1px solid ${isInstalled ? '#22c55e' : 'transparent'};
                            color: ${isInstalled ? '#22c55e' : '#fff'};
                            font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer; flex-shrink: 0;
                        ">
                            <i class="fa-solid ${isInstalled ? 'fa-check' : 'fa-download'}"></i>
                            <span>${isInstalled ? '已装' : '安装'}</span>
                        </button>
                    </div>
                </div>
            `;

            // 点击卡片直接打开详情
            card.onclick = async (e) => {
                if (e.target.closest('.rbq-pm-card-like') || e.target.closest('.rbq-pm-install-btn')) return;
                const full = await fetchPresetDetail(item);
                openDetailDialog(full);
            };

            // 点赞
            const likeBtn = card.querySelector('.rbq-pm-card-like');
            const likeNum = card.querySelector('.rbq-pm-like-num');
            likeBtn.onclick = (e) => {
                e.stopPropagation();
                likePreset(item, likeBtn, likeNum);
            };

            // 安装按钮
            const installBtn = card.querySelector('.rbq-pm-install-btn');
            installBtn.onclick = async (e) => {
                e.stopPropagation();
                const full = await fetchPresetDetail(item);
                installToLocalPresets(full);
                installBtn.style.background = 'rgba(34, 197, 94, 0.15)';
                installBtn.style.borderColor = '#22c55e';
                installBtn.style.color = '#22c55e';
                installBtn.innerHTML = '<i class="fa-solid fa-check"></i> <span>已装</span>';
            };

            grid.appendChild(card);
        });
    }

    // ── 预设详情弹窗 (2-Column 视觉工作台 + NAI 生图参数罗盘) ──
    function openDetailDialog(item) {
        const overlay = document.createElement('div');
        overlay.id = 'rbq-pm-detail-dialog';
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.82); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px);';

        const previewSrc = item.previewUrl || KAMI_DEFAULT_PREVIEW;
        const m = (item.model || '').toLowerCase();
        let modelBadge = '<span style="font-size:10px; background:rgba(255,255,255,0.1); color:#cbd5e1; padding:2px 7px; border-radius:4px;">通用</span>';
        if (m === 'v5' || (item.tags || []).includes('NAI V5')) {
            modelBadge = '<span style="font-size:10px; background:rgba(217,70,239,0.25); color:#f0abfc; padding:2px 7px; border-radius:4px; border:1px solid rgba(217,70,239,0.5);"><i class="fa-solid fa-wand-magic-sparkles"></i> NAI V5</span>';
        } else if (m === 'v4.5' || (item.tags || []).includes('NAI V4.5')) {
            modelBadge = '<span style="font-size:10px; background:rgba(56,189,248,0.25); color:#7dd3fc; padding:2px 7px; border-radius:4px; border:1px solid rgba(56,189,248,0.5);"><i class="fa-solid fa-bolt"></i> NAI V4.5</span>';
        }

        const p = item.params || {};
        const scaleVal = p.scale !== undefined && p.scale !== null ? Number(p.scale) : 6.0;
        const samplerVal = p.sampler || 'k_euler_ancestral';
        const stepsVal = p.steps !== undefined && p.steps !== null ? Number(p.steps) : 28;
        const cfgRescaleVal = p.cfgRescale !== undefined && p.cfgRescale !== null ? Number(p.cfgRescale) : 0;

        overlay.innerHTML = `
            <div style="width:92vw; max-width:780px; max-height:88vh; background:#0f172a; border:1px solid rgba(255,255,255,0.16); border-radius:14px; display:flex; flex-direction:column; overflow:hidden; color:#fff; box-shadow:0 25px 60px rgba(0,0,0,0.8);">
                <div style="padding:14px 18px; background:#1e293b; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px;">
                        <span>${item.title}</span>
                        ${modelBadge}
                    </div>
                    <button id="rbq-pm-detail-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div style="padding:16px 18px; overflow-y:auto; flex:1; display:flex; flex-wrap:wrap; gap:16px;">
                    <!-- Left Column: Portrait Artwork Preview -->
                    <div style="width:220px; flex-shrink:0; display:flex; flex-direction:column; gap:10px;">
                        <div id="rbq-pm-detail-img-wrap" style="width:100%; aspect-ratio:3/4; border-radius:10px; overflow:hidden; background:#070b13; border:1px solid rgba(255,255,255,0.12); position:relative; cursor:zoom-in;" title="点击查看高清大图">
                            <img src="${previewSrc}" style="width:100%; height:100%; object-fit:cover; display:block;">
                            <div style="position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,0.65); backdrop-filter:blur(4px); font-size:10px; padding:2px 6px; border-radius:4px; color:#cbd5e1;">
                                <i class="fa-solid fa-magnifying-glass-plus"></i> 点击放大
                            </div>
                        </div>
                        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:8px 10px; font-size:11px; color:#94a3b8; display:flex; flex-direction:column; gap:4px;">
                            <div>作者: <strong style="color:#f1f5f9;">${item.author || '匿名'}</strong></div>
                            <div>获赞: <strong style="color:#fb7185;">${item.likes || 0}</strong> | 下载: ${item.downloads || 0}</div>
                            ${(item.tags && item.tags.length) ? `<div>标签: ${item.tags.map(t => '#' + t).join(' ')}</div>` : ''}
                        </div>
                    </div>

                    <!-- Right Column: Prompts Inspector & NAI Telemetry -->
                    <div style="flex:1; min-width:280px; display:flex; flex-direction:column; gap:12px;">
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                <span style="font-size:12px; color:#38bdf8; font-weight:600;"><i class="fa-solid fa-paintbrush"></i> 画师/风格预设串 (Positive)</span>
                                <button id="rbq-pm-copy-pos-only" class="menu_button" style="display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; gap:4px !important; white-space:nowrap !important; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; font-size:11px; padding:2px 7px; border-radius:4px; cursor:pointer;">
                                    <i class="fa-solid fa-copy"></i> 复制预设词
                                </button>
                            </div>
                            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:10px; font-size:12px; color:#e2e8f0; line-height:1.55; word-break:break-word; max-height:110px; overflow-y:auto; user-select:text;">
                                ${item.positive || '(无)'}
                            </div>
                        </div>

                        ${item.negative ? `
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                <span style="font-size:12px; color:#f87171; font-weight:600;"><i class="fa-solid fa-minus-circle"></i> 负向提示词 (Negative)</span>
                                <button id="rbq-pm-copy-neg-only" class="menu_button" style="display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; gap:4px !important; white-space:nowrap !important; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; font-size:11px; padding:2px 7px; border-radius:4px; cursor:pointer;">
                                    <i class="fa-solid fa-copy"></i> 复制负向词
                                </button>
                            </div>
                            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:10px; font-size:12px; color:#fca5a5; line-height:1.55; word-break:break-word; max-height:75px; overflow-y:auto; user-select:text;">
                                ${item.negative}
                            </div>
                        </div>` : ''}

                        <!-- NAI 生图参数罗盘 -->
                        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 12px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:12px; color:#c084fc; font-weight:700; display:inline-flex; align-items:center; gap:6px;">
                                    <i class="fa-solid fa-sliders"></i> 生成时的 NAI 参数
                                </span>
                                <button id="rbq-pm-apply-params" class="menu_button" style="display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; gap:5px !important; white-space:nowrap !important; box-sizing:border-box !important; background:rgba(192,132,252,0.18); border:1px solid rgba(192,132,252,0.4); color:#e9d5ff; font-size:11px; font-weight:600; padding:2px 8px; border-radius:4px; cursor:pointer;" title="一键将该预设的 NAI 参数应用到当前酒馆生图设置">
                                    <i class="fa-solid fa-wand-magic-sparkles"></i> 一键同步参数到生图
                                </button>
                            </div>
                            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(75px, 1fr)); gap:8px;">
                                <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:6px 8px; text-align:center;">
                                    <div style="font-size:10px; color:#94a3b8; margin-bottom:2px;">Scale (CFG)</div>
                                    <div style="font-size:13.5px; font-weight:700; color:#38bdf8; font-family:monospace;">${scaleVal}</div>
                                </div>
                                <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:6px 8px; text-align:center;" title="${samplerVal}">
                                    <div style="font-size:10px; color:#94a3b8; margin-bottom:2px;">采样器</div>
                                    <div style="font-size:11px; font-weight:700; color:#f0abfc; font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${formatSampler(samplerVal)}</div>
                                </div>
                                <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:6px 8px; text-align:center;">
                                    <div style="font-size:10px; color:#94a3b8; margin-bottom:2px;">步数 (Steps)</div>
                                    <div style="font-size:13.5px; font-weight:700; color:#4ade80; font-family:monospace;">${stepsVal}</div>
                                </div>
                                <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:6px 8px; text-align:center;">
                                    <div style="font-size:10px; color:#94a3b8; margin-bottom:2px;">CFG Rescale</div>
                                    <div style="font-size:13.5px; font-weight:700; color:#fbbf24; font-family:monospace;">${cfgRescaleVal}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="padding:12px 18px; background:#1e293b; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <div style="font-size:11px; color:#64748b;">
                        <i class="fa-solid fa-circle-check" style="color:#22c55e;"></i> NAI 参数已就绪
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button id="rbq-pm-sync-params-foot" class="menu_button" style="display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; gap:6px !important; white-space:nowrap !important; background:rgba(192,132,252,0.15); border:1px solid rgba(192,132,252,0.35); color:#e9d5ff; font-size:12px; padding:6px 14px; font-weight:600;"><i class="fa-solid fa-sliders"></i> 一键同步参数</button>
                        <button id="rbq-pm-install-now" class="menu_button" style="display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; gap:6px !important; white-space:nowrap !important; background:#0284c7; border:none; color:#fff; font-size:12px; padding:6px 16px; font-weight:600;"><i class="fa-solid fa-download"></i> 安装至本地预设</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#rbq-pm-detail-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // 点击预览图放大 Lightbox
        const imgWrap = overlay.querySelector('#rbq-pm-detail-img-wrap');
        if (imgWrap) {
            imgWrap.onclick = () => {
                const lb = document.createElement('div');
                lb.style.cssText = 'position:fixed; inset:0; z-index:100005; background:rgba(0,0,0,0.92); display:flex; align-items:center; justify-content:center; cursor:zoom-out; backdrop-filter:blur(10px);';
                lb.innerHTML = `<img src="${previewSrc}" style="max-width:92vw; max-height:92vh; object-fit:contain; border-radius:8px; box-shadow:0 0 40px rgba(0,0,0,0.9);">`;
                lb.onclick = () => lb.remove();
                document.body.appendChild(lb);
            };
        }

        overlay.querySelector('#rbq-pm-copy-pos-only').onclick = async () => {
            await copyToClipboard(item.positive || '');
            toastr.success('预设正面词已复制到剪贴板！');
        };

        if (overlay.querySelector('#rbq-pm-copy-neg-only')) {
            overlay.querySelector('#rbq-pm-copy-neg-only').onclick = async () => {
                await copyToClipboard(item.negative || '');
                toastr.success('预设负面词已复制到剪贴板！');
            };
        }

        const handleSync = () => applyNaiParams(p);
        overlay.querySelector('#rbq-pm-apply-params').onclick = handleSync;
        overlay.querySelector('#rbq-pm-sync-params-foot').onclick = handleSync;

        overlay.querySelector('#rbq-pm-install-now').onclick = () => {
            installToLocalPresets(item);
            overlay.remove();
            renderCards();
        };
    }

    // ── 发布弹窗 (带工坊现场一键生图核心装置) ──
    function openUploadDialog() {
        const cfg = getConfig();
        const uploadEndpoint = (cfg.serverUrl || cfg.workerUrl || '').replace(/\/+$/, '');
        if (!uploadEndpoint) {
            toastr.info('请先在设置中填写你的预设工坊服务器地址');
            openSettingsDialog();
            return;
        }

        const s = (typeof RBQ?.api?.getSettings === 'function') ? RBQ.api.getSettings() : {};
        const localPresets = s[PRESETS_STORAGE_KEY]?.presets || [];

        let activeScale = s.naiScale !== undefined && s.naiScale !== null ? Number(s.naiScale) : 6.0;
        let activeSampler = s.naiSampler || 'k_euler_ancestral';
        let activeSteps = s.naiSteps !== undefined && s.naiSteps !== null ? Number(s.naiSteps) : 28;
        let activeCfgRescale = s.naiCfgRescale !== undefined && s.naiCfgRescale !== null ? Number(s.naiCfgRescale) : 0;

        const overlay = document.createElement('div');
        overlay.id = 'rbq-pm-upload-dialog';
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.8); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(6px);';
        overlay.innerHTML = `
            <div style="width:92vw; max-width:640px; max-height:88vh; background:#0f172a; border:1px solid rgba(255,255,255,0.16); border-radius:14px; display:flex; flex-direction:column; overflow:hidden; color:#fff; box-shadow:0 25px 60px rgba(0,0,0,0.8);">
                <div style="padding:14px 18px; background:#1e293b; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px;">
                        <i class="fa-solid fa-cloud-arrow-up" style="color:#38bdf8;"></i>
                        <span>发布预设至工坊 (现场出图绑定)</span>
                    </div>
                    <button id="rbq-pm-upload-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div style="padding:16px 18px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:12px;">
                    <!-- 快捷填充与导入 -->
                    <div style="display:flex; gap:8px; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
                        <div style="flex:1;">
                            <label style="font-size:11px; color:#94a3b8; display:block; margin-bottom:3px;">从本地已有预设快速导入</label>
                            <select id="rbq-pm-local-select" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:5px; color:#fff; font-size:11.5px;">
                                <option value="">-- 手动填写或从本地选择 --</option>
                                ${localPresets.map((p, idx) => `<option value="${idx}">${p.name || p.id}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">预设标题 *</label>
                            <input id="rbq-pm-up-title" type="text" placeholder="例如: Neroma Shin 水光透肉丝袜" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">适配模型 *</label>
                            <select id="rbq-pm-up-model" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;">
                                <option value="v5" selected>✨ NAI V5 (推荐)</option>
                                <option value="v4.5">⚡ NAI V4.5</option>
                                <option value="general">🌐 通用 / SDXL</option>
                            </select>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">作者昵称</label>
                            <input id="rbq-pm-up-author" type="text" placeholder="你的署名" value="${cfg.authorName || ''}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">风格标签 (空格分隔)</label>
                            <input id="rbq-pm-up-tags" type="text" placeholder="例如: 3D写实 油光丝袜 御姐" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; box-sizing:border-box;">
                        </div>
                    </div>

                    <!-- 用户自定义画师/风格词 -->
                    <div>
                        <label style="font-size:12px; color:#38bdf8; display:block; margin-bottom:4px; font-weight:600;"><i class="fa-solid fa-paintbrush"></i> 用户画师 / 风格预设词 (Positive) *</label>
                        <textarea id="rbq-pm-up-pos" rows="3" placeholder="在此输入你的画师串或预设词，例如: artist:neroma_shin, 1.4::shiny pantyhose::, 3d game cg" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:8px; color:#fff; font-size:12px; box-sizing:border-box; line-height:1.4;"></textarea>
                    </div>

                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">负面提示词 (可选)</label>
                        <textarea id="rbq-pm-up-neg" rows="2" placeholder="可选输入针对该风格的负向词，例如: flat color, simplified" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:8px; color:#fff; font-size:12px; box-sizing:border-box;"></textarea>
                    </div>

                    <!-- NAI 生图参数设置绑定 -->
                    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px 12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span style="font-size:12px; color:#c084fc; font-weight:600;"><i class="fa-solid fa-sliders"></i> 绑定当前 NAI 生图参数 (自动提取)</span>
                            <button id="rbq-pm-up-refresh-params" type="button" class="menu_button" style="display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; gap:4px !important; white-space:nowrap !important; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; font-size:10.5px; padding:2px 7px; border-radius:4px; cursor:pointer;" title="重新读取当前酒馆生图设置中的参数">
                                <i class="fa-solid fa-arrows-rotate"></i> 重新读取设置
                            </button>
                        </div>
                        <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px;">
                            <div>
                                <label style="font-size:10px; color:#94a3b8; display:block; margin-bottom:2px;">Scale (CFG)</label>
                                <input id="rbq-pm-up-param-scale" type="number" step="0.5" value="${activeScale}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:5px; padding:5px 6px; color:#38bdf8; font-size:11.5px; font-family:monospace; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-size:10px; color:#94a3b8; display:block; margin-bottom:2px;">采样器 (Sampler)</label>
                                <input id="rbq-pm-up-param-sampler" type="text" value="${activeSampler}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:5px; padding:5px 6px; color:#f0abfc; font-size:11.5px; font-family:monospace; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-size:10px; color:#94a3b8; display:block; margin-bottom:2px;">步数 (Steps)</label>
                                <input id="rbq-pm-up-param-steps" type="number" step="1" value="${activeSteps}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:5px; padding:5px 6px; color:#4ade80; font-size:11.5px; font-family:monospace; box-sizing:border-box;">
                            </div>
                            <div>
                                <label style="font-size:10px; color:#94a3b8; display:block; margin-bottom:2px;">CFG Rescale</label>
                                <input id="rbq-pm-up-param-rescale" type="number" step="0.05" value="${activeCfgRescale}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:5px; padding:5px 6px; color:#fbbf24; font-size:11.5px; font-family:monospace; box-sizing:border-box;">
                            </div>
                        </div>
                    </div>

                    <!-- 统一基准底模提示框 -->
                    <div style="background:linear-gradient(135deg, rgba(217,70,239,0.1), rgba(56,189,248,0.1)); border:1px solid rgba(217,70,239,0.3); border-radius:8px; padding:10px 12px; font-size:11.5px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:700; color:#f0abfc;"><i class="fa-solid fa-vial"></i> 统一基准测试底模 (测试提示词由卡密sama提供)</span>
                            <button id="rbq-pm-up-copy-bm" type="button" class="menu_button" style="background:rgba(217,70,239,0.25); border:1px solid rgba(217,70,239,0.5); color:#f0abfc; font-size:11px; font-weight:600; padding:2px 9px; border-radius:5px; cursor:pointer;" title="点击复制卡密sama基准测试词">
                                <i class="fa-solid fa-copy"></i> 复制基准测试词
                            </button>
                        </div>
                        <div style="color:#cbd5e1; margin-top:4px; font-size:11px; line-height:1.45;">
                            为确保全场预设在相同主体下横向对比，点击下方生图时，系统会自动将你的画师串与卡密sama基准词合并出图！点击右上角可复制基准词自行测试。
                        </div>
                    </div>

                    <!-- 预览图生成与绑定核心区域 -->
                    <div style="background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.18); border-radius:8px; padding:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <div style="font-size:12px; color:#cbd5e1; font-weight:600;"><i class="fa-solid fa-image"></i> 预览图生成与绑定 (720px / 0.82 质量)</div>
                            <button id="rbq-pm-run-draw" type="button" class="menu_button" style="background:linear-gradient(135deg, #a855f7, #6366f1); border:none; color:#fff; font-size:11.5px; font-weight:700; padding:5px 12px; border-radius:6px; box-shadow:0 2px 10px rgba(168,85,247,0.35); cursor:pointer;">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> 🎨 立即生图并生成预览
                            </button>
                        </div>
                        
                        <div style="margin-top:8px; font-size:11px; color:#94a3b8; display:flex; align-items:center; justify-content:space-between;">
                            <span id="rbq-pm-img-status"><i class="fa-regular fa-clock"></i> 尚未生成当前串的基准预览图</span>
                            <span id="rbq-pm-img-spec" style="color:#64748b;">规格: 720px WebP (0.82)</span>
                        </div>

                        <div id="rbq-pm-up-preview" style="margin-top:10px; display:block; max-height:160px; overflow:hidden; border-radius:8px; position:relative; background:#070b13; border:1px solid rgba(255,255,255,0.08);">
                            <img id="rbq-pm-preview-img" src="${KAMI_DEFAULT_PREVIEW}" style="max-height:160px; border-radius:8px; object-fit:contain; display:block; margin:0 auto;">
                        </div>

                        <div style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#64748b; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px;">
                            <span>若生图离线，也可手动选择本地已用该串渲染的图:</span>
                            <input id="rbq-pm-up-img" type="file" accept="image/*" style="font-size:11px; color:#cbd5e1; width:160px;">
                        </div>
                    </div>
                </div>
                <div style="padding:14px 18px; background:#1e293b; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end; gap:8px;">
                    <button id="rbq-pm-up-cancel" class="menu_button" style="font-size:12px; padding:6px 14px;">取消</button>
                    <button id="rbq-pm-up-submit" class="menu_button" style="background:#0284c7; border:none; color:#fff; font-size:12px; padding:6px 18px; font-weight:700;"><i class="fa-solid fa-paper-plane"></i> 确认发布至工坊</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#rbq-pm-upload-close').onclick = () => overlay.remove();
        overlay.querySelector('#rbq-pm-up-cancel').onclick = () => overlay.remove();

        overlay.querySelector('#rbq-pm-up-copy-bm').onclick = async () => {
            await copyToClipboard(BENCHMARK_POSITIVE_PROMPT);
            toastr.success('已复制基准测试底模词！(由卡密sama提供)');
        };

        const localSelect = overlay.querySelector('#rbq-pm-local-select');
        localSelect.onchange = (e) => {
            const idx = e.target.value;
            if (idx !== '' && localPresets[idx]) {
                const p = localPresets[idx];
                overlay.querySelector('#rbq-pm-up-title').value = p.name || '';
                overlay.querySelector('#rbq-pm-up-pos').value = p.positive || '';
                overlay.querySelector('#rbq-pm-up-neg').value = p.negative || '';
                if (p.params) {
                    if (p.params.scale !== undefined) overlay.querySelector('#rbq-pm-up-param-scale').value = p.params.scale;
                    if (p.params.sampler) overlay.querySelector('#rbq-pm-up-param-sampler').value = p.params.sampler;
                    if (p.params.steps !== undefined) overlay.querySelector('#rbq-pm-up-param-steps').value = p.params.steps;
                    if (p.params.cfgRescale !== undefined) overlay.querySelector('#rbq-pm-up-param-rescale').value = p.params.cfgRescale;
                }
            }
        };

        overlay.querySelector('#rbq-pm-up-refresh-params').onclick = () => {
            const fresh = (typeof RBQ?.api?.getSettings === 'function') ? RBQ.api.getSettings() : {};
            overlay.querySelector('#rbq-pm-up-param-scale').value = fresh.naiScale !== undefined ? fresh.naiScale : 6.0;
            overlay.querySelector('#rbq-pm-up-param-sampler').value = fresh.naiSampler || 'k_euler_ancestral';
            overlay.querySelector('#rbq-pm-up-param-steps').value = fresh.naiSteps !== undefined ? fresh.naiSteps : 28;
            overlay.querySelector('#rbq-pm-up-param-rescale').value = fresh.naiCfgRescale !== undefined ? fresh.naiCfgRescale : 0;
            toastr.info('已重新从当前酒馆生图设置中读取 NAI 参数！');
        };

        // 图片高保真压缩 (720px / 0.82 WebP)
        let compressedBase64 = '';
        const fileInput = overlay.querySelector('#rbq-pm-up-img');
        const previewWrap = overlay.querySelector('#rbq-pm-up-preview');
        const previewImg = overlay.querySelector('#rbq-pm-preview-img');
        const imgStatus = overlay.querySelector('#rbq-pm-img-status');
        const imgSpec = overlay.querySelector('#rbq-pm-img-spec');

        function processImageObject(imgObj, sourceName = '本地上传') {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 720; // 原始高保真尺寸
            let width = imgObj.width;
            let height = imgObj.height;
            if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgObj, 0, 0, width, height);
            compressedBase64 = canvas.toDataURL('image/webp', 0.82);
            previewImg.src = compressedBase64;
            previewWrap.style.display = 'block';

            const approxKb = Math.round((compressedBase64.length * 3) / 4 / 1024);
            imgStatus.innerHTML = `<span style="color:#22c55e; font-weight:600;"><i class="fa-solid fa-check"></i> 已绑定真实预览 (${sourceName})</span>`;
            imgSpec.textContent = `${width}x${height} WebP (~${approxKb}KB)`;
        }

        fileInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => processImageObject(img, '本地文件');
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        };

        // ── 🎨 核心装置：现场直接生图并绑定为预览图 ──
        const drawBtn = overlay.querySelector('#rbq-pm-run-draw');
        drawBtn.onclick = async () => {
            const pos = overlay.querySelector('#rbq-pm-up-pos').value.trim();
            const neg = overlay.querySelector('#rbq-pm-up-neg').value.trim();
            if (!pos) {
                toastr.warning('请先输入你的画师串/正面提示词！');
                return;
            }

            if (typeof RBQ?.api?.generateImage !== 'function') {
                toastr.error('酒馆当前未启用 RBQ 生图流水线，请检查生图插件是否正常激活');
                return;
            }

            // 核心机制：画师串 + 卡密sama基准底模提示词自动合并
            const finalPrompt = [pos, BENCHMARK_POSITIVE_PROMPT].filter(Boolean).join(', ');
            const finalNegative = [neg, BENCHMARK_NEGATIVE_PROMPT].filter(Boolean).join(', ');

            // 同步现场配置的生成参数到生图会话
            const upScale = parseFloat(overlay.querySelector('#rbq-pm-up-param-scale').value);
            const upSampler = overlay.querySelector('#rbq-pm-up-param-sampler').value.trim();
            const upSteps = parseInt(overlay.querySelector('#rbq-pm-up-param-steps').value, 10);
            const upRescale = parseFloat(overlay.querySelector('#rbq-pm-up-param-rescale').value);

            if (!isNaN(upScale)) s.naiScale = upScale;
            if (upSampler) s.naiSampler = upSampler;
            if (!isNaN(upSteps)) s.naiSteps = upSteps;
            if (!isNaN(upRescale)) s.naiCfgRescale = upRescale;

            drawBtn.disabled = true;
            const originalHtml = drawBtn.innerHTML;
            drawBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>正在向生图集群排队出图...</span>';
            imgStatus.innerHTML = '<span style="color:#38bdf8;"><i class="fa-solid fa-spinner fa-spin"></i> 正在生成图片...</span>';

            try {
                const drawRes = await RBQ.api.generateImage(finalPrompt, 'market-preset-preview', { negative: finalNegative }, (progress) => {
                    if (progress) drawBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${progress}</span>`;
                });

                if (!drawRes || !drawRes.url) {
                    throw new Error('生图服务未返回有效图片地址');
                }

                // 载入生成的图片并转换为 720px @ 0.82 WebP
                const drawImg = new Image();
                drawImg.crossOrigin = 'anonymous';
                drawImg.onload = () => {
                    processImageObject(drawImg, '当前串+卡密sama底模 现场实测');
                    toastr.success('🎉 预览图生成成功并已绑定该提示词！所见即所得。');
                };
                drawImg.onerror = async () => {
                    // Blob 降级方案
                    try {
                        const blobResp = await fetch(drawRes.url);
                        const blob = await blobResp.blob();
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const bImg = new Image();
                            bImg.onload = () => processImageObject(bImg, '当前串+卡密sama底模 现场实测');
                            bImg.src = ev.target.result;
                        };
                        reader.readAsDataURL(blob);
                    } catch (e) {
                        toastr.error('解析生成图片失败: ' + e.message);
                    }
                };
                drawImg.src = drawRes.url;
            } catch (err) {
                toastr.error('现场生图失败: ' + (err.message || String(err)));
                imgStatus.innerHTML = '<span style="color:#ef4444;">生图失败，可手动选择本地图片</span>';
            } finally {
                drawBtn.disabled = false;
                drawBtn.innerHTML = originalHtml;
            }
        };

        // 提交发布
        overlay.querySelector('#rbq-pm-up-submit').onclick = async () => {
            const title = overlay.querySelector('#rbq-pm-up-title').value.trim();
            const positive = overlay.querySelector('#rbq-pm-up-pos').value.trim();
            const author = overlay.querySelector('#rbq-pm-up-author').value.trim() || '匿名';
            const model = overlay.querySelector('#rbq-pm-up-model').value || 'v5';
            const negative = overlay.querySelector('#rbq-pm-up-neg').value.trim();
            const rawTags = overlay.querySelector('#rbq-pm-up-tags').value.trim();
            const tags = rawTags.split(/[\s,，]+/).filter(Boolean);

            const uploadScale = parseFloat(overlay.querySelector('#rbq-pm-up-param-scale').value);
            const uploadSampler = overlay.querySelector('#rbq-pm-up-param-sampler').value.trim();
            const uploadSteps = parseInt(overlay.querySelector('#rbq-pm-up-param-steps').value, 10);
            const uploadCfgRescale = parseFloat(overlay.querySelector('#rbq-pm-up-param-rescale').value);

            const uploadParams = {
                scale: !isNaN(uploadScale) ? uploadScale : 6.0,
                sampler: uploadSampler || 'k_euler_ancestral',
                steps: !isNaN(uploadSteps) ? uploadSteps : 28,
                cfgRescale: !isNaN(uploadCfgRescale) ? uploadCfgRescale : 0
            };

            if (!title || !positive) {
                toastr.warning('请填写标题和正面画师/预设提示词！');
                return;
            }

            cfg.authorName = author;
            saveConfig();

            const submitBtn = overlay.querySelector('#rbq-pm-up-submit');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 发布中...';

            try {
                const res = await fetch(`${uploadEndpoint}/api/upload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title,
                        author,
                        model,
                        positive,
                        negative,
                        tags,
                        params: uploadParams,
                        description: `基准测试预览由「卡密sama」提示词渲染`,
                        previewUrl: !compressedBase64 ? KAMI_DEFAULT_PREVIEW : '',
                        previewBase64: compressedBase64 || ''
                    })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    toastr.success('🎉 发布成功！你的预设已同步至云端工坊！');
                    overlay.remove();
                    loadMarketData();
                } else {
                    toastr.error('发布失败: ' + (data.error || '未知错误'));
                }
            } catch (err) {
                toastr.error('请求网络错误: ' + (err.message || String(err)));
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 确认发布至工坊';
            }
        };
    }

    // ── 设置弹窗 ──
    function openSettingsDialog() {
        const cfg = getConfig();
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.75); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(5px);';
        overlay.innerHTML = `
            <div style="width:90vw; max-width:480px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:12px; display:flex; flex-direction:column; overflow:hidden; color:#fff;">
                <div style="padding:14px 18px; background:#1e293b; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:14px; font-weight:700;"><i class="fa-solid fa-gear"></i> 预设工坊设置</div>
                    <button id="rbq-pm-set-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div style="padding:16px 18px; display:flex; flex-direction:column; gap:12px;">
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">工坊服务器地址 (API 接口)</label>
                        <input id="rbq-pm-cfg-server" type="text" placeholder="https://market.rbq.my" value="${cfg.serverUrl || ''}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; box-sizing:border-box;">
                        <div style="font-size:11px; color:#64748b; margin-top:3px;">默认直连社区工坊服务器 (https://market.rbq.my)。</div>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">作者昵称 (默认发布者)</label>
                        <input id="rbq-pm-cfg-author" type="text" placeholder="你的署名" value="${cfg.authorName || ''}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; color:#fff; font-size:12px; box-sizing:border-box;">
                    </div>
                </div>
                <div style="padding:12px 18px; background:#1e293b; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end; gap:8px;">
                    <button id="rbq-pm-set-save" class="menu_button" style="background:#0284c7; border:none; color:#fff; font-size:12px; padding:6px 14px;"><i class="fa-solid fa-floppy-disk"></i> 保存设置</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#rbq-pm-set-close').onclick = () => overlay.remove();
        overlay.querySelector('#rbq-pm-set-save').onclick = () => {
            const rawServer = overlay.querySelector('#rbq-pm-cfg-server').value.trim();
            cfg.serverUrl = rawServer ? rawServer.replace(/\/+$/, '') : 'https://market.rbq.my';
            cfg.authorName = overlay.querySelector('#rbq-pm-cfg-author').value.trim();
            saveConfig();
            toastr.success('设置已保存！');
            overlay.remove();
            loadMarketData();
        };
    }

    // ── 大图查看 ──
    function openImageZoom(url) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100001; background:rgba(0,0,0,0.88); display:flex; align-items:center; justify-content:center; cursor:zoom-out;';
        overlay.innerHTML = `<img src="${url}" style="max-width:92vw; max-height:92vh; border-radius:8px; box-shadow:0 10px 40px rgba(0,0,0,0.85);">`;
        overlay.onclick = () => overlay.remove();
        document.body.appendChild(overlay);
    }

    // ── 注入入口按钮至提示词预设面板 ──
    function injectMarketEntry() {
        const check = () => {
            const presetPanel = document.getElementById('rbq-prompt-presets-panel');
            if (presetPanel && !document.getElementById('rbq-pm-entry-btn')) {
                const btn = document.createElement('button');
                btn.id = 'rbq-pm-entry-btn';
                btn.className = 'menu_button';
                btn.style.cssText = 'font-size: 12px; padding: 4px 10px; background: linear-gradient(135deg, #0284c7, #2563eb); border: none; color: #fff; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin-left: 6px;';
                btn.innerHTML = '<i class="fa-solid fa-store"></i> <span>预设工坊</span>';
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openMarketModal();
                };

                const titleSpan = presetPanel.querySelector('.st-scene-trigger-subpanel-title');
                if (titleSpan) {
                    titleSpan.appendChild(btn);
                }
            }

            // 悬浮球快捷入口 (如果存在悬浮菜单)
            const floatMenu = document.getElementById('st-scene-trigger-floating-menu');
            if (floatMenu && !document.getElementById('rbq-pm-float-btn')) {
                const fItem = document.createElement('div');
                fItem.id = 'rbq-pm-float-btn';
                fItem.className = 'st-scene-trigger-floating-item';
                fItem.style.cssText = 'padding: 8px 10px; cursor: pointer; color: #38bdf8;';
                fItem.innerHTML = '<i class="fa-solid fa-store" style="width:14px;"></i><span>预设工坊市场</span>';
                fItem.onclick = (e) => {
                    e.stopPropagation();
                    openMarketModal();
                };
                floatMenu.appendChild(fItem);
            }
        };

        setInterval(check, 1000);
    }

    injectMarketEntry();
    console.info('🏛️ RBQ Prompt Market (提示词预设工坊) 插件已加载');
})(window.RBQ, window.jQuery, window.toastr);
