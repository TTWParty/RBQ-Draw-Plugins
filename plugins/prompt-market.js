(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Prompt Market] RBQ Core API missing');

    const STORAGE_KEY = '_promptMarketSettings';
    const PRESETS_STORAGE_KEY = '_promptPresets';

    // 默认配置 (默认直连自建的 market.rbq.my 节点服务)
    const DEFAULT_CONFIG = {
        serverUrl: 'https://market.rbq.my', // 自建工坊服务器，例如 https://market.rbq.my
        authorName: '',
        repo: 'TTWParty/RBQ-Prompt-Market',
        branch: 'main',
        installedIds: []
    };

    function getConfig() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) s[STORAGE_KEY] = { ...DEFAULT_CONFIG };
        // 自动迁移旧的 9.rbq.my 并补充默认 serverUrl
        if (!s[STORAGE_KEY].serverUrl || s[STORAGE_KEY].serverUrl.includes('9.rbq.my')) {
            s[STORAGE_KEY].serverUrl = 'https://market.rbq.my';
        }
        return s[STORAGE_KEY];
    }

    function saveConfig() {
        RBQ.api.saveSettings();
    }

    // 复制剪贴板兜底
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

    // 内置初始精品预设（即使完全离线时也立即可用）
    const BUILTIN_PRESETS = [
        {
            id: 'builtin-east-cg',
            title: '次世代东方写实御姐 CG',
            author: 'RBQ官方精选',
            description: '纯正东方冷艳五官骨相，虚幻5电影级冷暖反差布光，细腻次表面散射肉质与真实水光。',
            tags: ['3D写实', '御姐', '电影光影', '次世代'],
            positive: 'high complexity, amazing quality, 2::game cg, 3d game graphics, cinematic movie still, unreal engine 5, ray tracing::, 1.5::mature asian woman, cool beauty, sharp facial features, defined nose bridge, realistic lips, dark eyes, detailed 3d face::, 1.4::cinematic lighting, dramatic shadows, dark atmosphere, cool blue tone, dramatic rim light, volumetric lighting::, 1.3::subsurface scattering, wet skin, skin sheen, sweat glisten, realistic skin texture::, 1.1::fabric texture, detailed clothing, depth of field, sharp focus, photo(medium)::',
            negative: '2::2d, anime, cartoon, stylized, flat color, cute, chibi, big anime eyes, lineart, drawing, illustration::, 1.5::plastic skin, doll, toy, figurine, garage kit, oversaturated, bright daylight, flat lighting::, lowres, bad anatomy, bad hands, worst quality, blurry',
            previewUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&auto=format&fit=crop&q=80',
            params: { scale: 6.0, sampler: 'k_dpmpp_2m_sde', steps: 25 },
            likes: 128,
            downloads: 360,
            createdAt: '2026-10-09'
        },
        {
            id: 'builtin-shiny-pantyhose',
            title: '顶级油光高光透肉丝袜专精',
            author: 'RBQ官方精选',
            description: '专攻高开叉长腿、透肉丝袜与强镜面反光高光条，丝滑尼龙织物感拉满。',
            tags: ['油光丝袜', '美腿', '高光反光', '御姐'],
            positive: '1.4::shiny pantyhose, glossy pantyhose, oiled pantyhose, sheer pantyhose::, 1.3::beige pantyhose, sheer to waist, seamless pantyhose, red high heels::, 1.2::glossy legs, specular highlights on pantyhose, smooth nylon, light reflection on legs::, 1.1::skin-tight, tight pantyhose, long legs::, 0.65::artist:neroma_shin::',
            negative: 'opaque pantyhose, thick tights, matte pantyhose, black pantyhose, fishnet, ripped pantyhose, lowres, bad anatomy, bad hands',
            previewUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&auto=format&fit=crop&q=80',
            params: { scale: 5.5, sampler: 'k_euler_ancestral', steps: 23 },
            likes: 215,
            downloads: 512,
            createdAt: '2026-10-09'
        },
        {
            id: 'builtin-thick-skin',
            title: '顶级肉感厚涂与温润肉温',
            author: 'RBQ官方精选',
            description: '融合 Neroma Shin 与 Kazuhiro 黄金画师组，极具肉温与压痕触感，解剖严谨。',
            tags: ['日系厚涂', '肉感', '微汗水光', '解剖学'],
            positive: '2::masterpiece, best quality, very aesthetic, absurdres, ultra-detailed::, 2::lifelike, realistic_rendering, intricate_details::, {anatomical accuracy}, anatomically correct, 1.35::ultra-detailed skin texture, realistic skin pores::, 1.25::subsurface scattering, skin translucency::, 1.1::dermatological detail, skin indentation detail::, 1.15::dewy skin, sweat glisten, moist skin sheen, glossy skin highlights::, 0.65::neroma_shin::, 0.65::kazuhiro (tiramisu)::',
            negative: 'lowres, bad anatomy, bad hands, worst quality, flat color, simplified',
            previewUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80',
            params: { scale: 6.0, sampler: 'k_euler_ancestral', steps: 25 },
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
            negative: preset.negative || ''
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

    // ── UI Modal 构建 ──
    let marketModal = null;
    let activeTag = '全部';
    let searchQuery = '';
    let sortMode = 'popular'; // popular | newest
    let cachedList = [];

    function openMarketModal() {
        if (marketModal) {
            marketModal.style.display = 'flex';
            loadMarketData();
            return;
        }

        marketModal = document.createElement('div');
        marketModal.id = 'rbq-prompt-market-overlay';
        marketModal.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
            font-family: inherit; color: #f1f5f9; box-sizing: border-box;
        `;

        marketModal.innerHTML = `
            <div id="rbq-pm-container" style="
                width: 92vw; max-width: 1040px; height: 88vh; max-height: 820px;
                background: #0f172a; border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.6);
                display: flex; flex-direction: column; overflow: hidden;
            ">
                <!-- Header -->
                <div style="padding: 14px 20px; background: #1e293b; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #38bdf8, #818cf8); display: flex; align-items: center; justify-content: center; font-size: 16px; color: #fff;">
                            <i class="fa-solid fa-store"></i>
                        </div>
                        <div>
                            <div style="font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                                <span>提示词预设工坊</span>
                                <span style="font-size: 11px; font-weight: 500; background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 2px 6px; border-radius: 4px;">Community Market</span>
                            </div>
                            <div style="font-size: 11px; color: #94a3b8;">探索、分享与一键安装社区优质画师串与预设</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button id="rbq-pm-btn-upload" class="menu_button" style="background: linear-gradient(135deg, #0284c7, #2563eb); border: none; color: #fff; padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-cloud-arrow-up"></i>
                            <span>发布我的预设</span>
                        </button>
                        <button id="rbq-pm-btn-settings" class="menu_button" title="工坊网关设置" style="padding: 6px 10px; font-size: 13px; color: #94a3b8;">
                            <i class="fa-solid fa-gear"></i>
                        </button>
                        <button id="rbq-pm-btn-close" style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 4px 8px; line-height: 1;">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <!-- Filter & Search Toolbar -->
                <div style="padding: 10px 20px; background: #131d31; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between;">
                    <!-- Tags -->
                    <div id="rbq-pm-tag-bar" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none;">
                        <!-- Generated by renderTags -->
                    </div>

                    <!-- Search & Sort -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="position: relative;">
                            <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; color: #64748b;"></i>
                            <input id="rbq-pm-search-input" type="text" placeholder="搜索画师/预设/标签..." style="background: #0f172a; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 5px 10px 5px 28px; font-size: 12px; color: #fff; width: 180px; outline: none;">
                        </div>
                        <select id="rbq-pm-sort-select" style="background: #0f172a; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 5px 8px; font-size: 12px; color: #94a3b8; outline: none;">
                            <option value="popular">🔥 热门排行</option>
                            <option value="newest">🆕 最新发布</option>
                        </select>
                    </div>
                </div>

                <!-- Main Content (Cards Grid) -->
                <div id="rbq-pm-card-grid" style="
                    flex: 1; overflow-y: auto; padding: 16px 20px;
                    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 16px; align-content: start;
                ">
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

    const POPULAR_TAGS = ['全部', '3D写实', '油光丝袜', '日系厚涂', '二次元平涂', '赛博朋克', '光影氛围', '解剖学'];

    function renderTags() {
        const tagBar = marketModal.querySelector('#rbq-pm-tag-bar');
        tagBar.innerHTML = '';
        POPULAR_TAGS.forEach(tag => {
            const btn = document.createElement('button');
            const isActive = tag === activeTag;
            btn.style.cssText = `
                padding: 4px 10px; font-size: 11px; font-weight: 500; border-radius: 12px;
                border: 1px solid ${isActive ? '#38bdf8' : 'rgba(255,255,255,0.1)'};
                background: ${isActive ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.04)'};
                color: ${isActive ? '#38bdf8' : '#94a3b8'}; cursor: pointer; white-space: nowrap;
                transition: all 0.15s;
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
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 8px;"></i><div>正在获取社区预设...</div></div>';

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
            items.sort((a, b) => ((b.downloads || 0) + (b.likes || 0)) - ((a.downloads || 0) + (a.likes || 0)));
        } else {
            items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }

        if (items.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; color: #64748b;"><i class="fa-regular fa-folder-open" style="font-size: 32px; margin-bottom: 10px;"></i><div>未找到匹配的提示词预设</div></div>';
            return;
        }

        const cfg = getConfig();

        items.forEach(item => {
            const isInstalled = cfg.installedIds.includes(item.id);
            const card = document.createElement('div');
            card.style.cssText = `
                background: #1e293b; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
                overflow: hidden; display: flex; flex-direction: column; transition: transform 0.15s, border-color 0.15s;
            `;
            card.onmouseenter = () => { card.style.borderColor = 'rgba(56, 189, 248, 0.4)'; card.style.transform = 'translateY(-2px)'; };
            card.onmouseleave = () => { card.style.borderColor = 'rgba(255,255,255,0.08)'; card.style.transform = 'translateY(0)'; };

            const previewSrc = item.previewUrl || 'https://via.placeholder.com/400x300/1e293b/64748b?text=RBQ+Prompt';

            card.innerHTML = `
                <div style="width: 100%; height: 160px; position: relative; background: #0f172a; overflow: hidden; cursor: pointer;">
                    <img src="${previewSrc}" style="width: 100%; height: 100%; object-fit: cover;" alt="${item.title}" loading="lazy">
                    <div style="position: absolute; bottom: 0; inset-inline: 0; height: 40px; background: linear-gradient(transparent, rgba(15,23,42,0.85));"></div>
                    <div style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); font-size: 10px; padding: 2px 6px; border-radius: 4px; color: #38bdf8;">
                        <i class="fa-solid fa-download"></i> ${item.downloads || 0}
                    </div>
                </div>
                <div style="padding: 12px; flex: 1; display: flex; flex-direction: column; gap: 8px;">
                    <div>
                        <div style="font-size: 14px; font-weight: 700; color: #f8fafc; line-height: 1.3;">${item.title}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">作者: ${item.author || '匿名'}</div>
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 30px;">
                        ${item.description || '暂无描述'}
                    </div>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        ${(item.tags || []).map(t => `<span style="font-size: 10px; background: rgba(255,255,255,0.06); color: #cbd5e1; padding: 1px 6px; border-radius: 4px;">#${t}</span>`).join('')}
                    </div>
                    <div style="margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <button class="rbq-pm-detail-btn" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; font-size: 11px; padding: 4px 8px; border-radius: 5px; cursor: pointer;">
                            <i class="fa-solid fa-eye"></i> 详情
                        </button>
                        <button class="rbq-pm-install-btn" style="
                            background: ${isInstalled ? 'rgba(34, 197, 94, 0.15)' : 'linear-gradient(135deg, #0284c7, #2563eb)'};
                            border: 1px solid ${isInstalled ? '#22c55e' : 'transparent'};
                            color: ${isInstalled ? '#22c55e' : '#fff'};
                            font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 4px;
                        ">
                            <i class="fa-solid ${isInstalled ? 'fa-check' : 'fa-download'}"></i>
                            <span>${isInstalled ? '已装' : '一键安装'}</span>
                        </button>
                    </div>
                </div>
            `;

            // 点击预览图放大
            card.querySelector('img').onclick = () => openImageZoom(previewSrc);

            // 详情按钮
            card.querySelector('.rbq-pm-detail-btn').onclick = async () => {
                const full = await fetchPresetDetail(item);
                openDetailDialog(full);
            };

            // 安装按钮
            const installBtn = card.querySelector('.rbq-pm-install-btn');
            installBtn.onclick = async () => {
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

    // ── 详情弹窗 ──
    function openDetailDialog(item) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);';
        overlay.innerHTML = `
            <div style="width:90vw; max-width:620px; max-height:85vh; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:12px; display:flex; flex-direction:column; overflow:hidden; color:#fff;">
                <div style="padding:12px 16px; background:#1e293b; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:15px; font-weight:700;">${item.title}</div>
                    <button id="rbq-pm-detail-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div style="padding:16px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:12px;">
                    <div>
                        <div style="font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">正向提示词 (Positive)</div>
                        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:8px; font-size:12px; color:#e2e8f0; line-height:1.5; word-break:break-word; max-height:140px; overflow-y:auto;">
                            ${item.positive || '(无)'}
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">负向提示词 (Negative)</div>
                        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:8px; font-size:12px; color:#f87171; line-height:1.5; word-break:break-word; max-height:100px; overflow-y:auto;">
                            ${item.negative || '(无)'}
                        </div>
                    </div>
                    <div style="font-size:11px; color:#64748b; line-height:1.5;">
                        <div>作者: ${item.author || '匿名'} | 标签: ${(item.tags || []).join(', ')}</div>
                    </div>
                </div>
                <div style="padding:12px 16px; background:#1e293b; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end; gap:8px;">
                    <button id="rbq-pm-copy-pos" class="menu_button" style="font-size:12px; padding:6px 12px;"><i class="fa-solid fa-copy"></i> 复制正面词</button>
                    <button id="rbq-pm-install-now" class="menu_button" style="background:#0284c7; border:none; color:#fff; font-size:12px; padding:6px 14px;"><i class="fa-solid fa-download"></i> 安装至本地预设</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('#rbq-pm-detail-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#rbq-pm-copy-pos').onclick = async () => {
            await copyToClipboard(item.positive || '');
            toastr.success('正面提示词已复制到剪贴板！');
        };
        overlay.querySelector('#rbq-pm-install-now').onclick = () => {
            installToLocalPresets(item);
            overlay.remove();
            renderCards();
        };
    }

    // ── 发布弹窗 ──
    function openUploadDialog() {
        const cfg = getConfig();
        const uploadEndpoint = (cfg.serverUrl || cfg.workerUrl || '').replace(/\/+$/, '');
        if (!uploadEndpoint) {
            toastr.info('请先在设置中填写你的预设工坊服务器地址');
            openSettingsDialog();
            return;
        }

        const s = RBQ.api.getSettings();
        const localPresets = s[PRESETS_STORAGE_KEY]?.presets || [];

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);';
        overlay.innerHTML = `
            <div style="width:90vw; max-width:560px; max-height:85vh; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:12px; display:flex; flex-direction:column; overflow:hidden; color:#fff;">
                <div style="padding:12px 16px; background:#1e293b; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:15px; font-weight:700;"><i class="fa-solid fa-cloud-arrow-up"></i> 发布预设至工坊</div>
                    <button id="rbq-pm-upload-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div style="padding:16px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:12px;">
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">从本地已有预设导入 (可选)</label>
                        <select id="rbq-pm-local-select" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px;">
                            <option value="">-- 手动填写或选择预设 --</option>
                            ${localPresets.map((p, idx) => `<option value="${idx}">${p.name || p.id}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">预设标题 *</label>
                        <input id="rbq-pm-up-title" type="text" placeholder="例如: 赛博朋克霓虹御姐" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">作者昵称</label>
                        <input id="rbq-pm-up-author" type="text" placeholder="你的署名" value="${cfg.authorName || ''}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">正面提示词 *</label>
                        <textarea id="rbq-pm-up-pos" rows="3" placeholder="masterpiece, 3d render..." style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;"></textarea>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">负面提示词</label>
                        <textarea id="rbq-pm-up-neg" rows="2" placeholder="lowres, bad anatomy..." style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;"></textarea>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">风格标签 (空格或逗号分隔)</label>
                        <input id="rbq-pm-up-tags" type="text" placeholder="3D写实 油光丝袜 御姐" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">效果预览图 (自动前端压缩WebP)</label>
                        <input id="rbq-pm-up-img" type="file" accept="image/*" style="font-size:12px; color:#cbd5e1;">
                        <div id="rbq-pm-up-preview" style="margin-top:6px; display:none; max-height:120px; overflow:hidden; border-radius:6px;">
                            <img id="rbq-pm-preview-img" style="max-height:120px; border-radius:6px;">
                        </div>
                    </div>
                </div>
                <div style="padding:12px 16px; background:#1e293b; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end; gap:8px;">
                    <button id="rbq-pm-up-cancel" class="menu_button" style="font-size:12px; padding:6px 12px;">取消</button>
                    <button id="rbq-pm-up-submit" class="menu_button" style="background:#0284c7; border:none; color:#fff; font-size:12px; padding:6px 16px; font-weight:600;"><i class="fa-solid fa-paper-plane"></i> 确认发布</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#rbq-pm-upload-close').onclick = () => overlay.remove();
        overlay.querySelector('#rbq-pm-up-cancel').onclick = () => overlay.remove();

        const localSelect = overlay.querySelector('#rbq-pm-local-select');
        localSelect.onchange = (e) => {
            const idx = e.target.value;
            if (idx !== '' && localPresets[idx]) {
                const p = localPresets[idx];
                overlay.querySelector('#rbq-pm-up-title').value = p.name || '';
                overlay.querySelector('#rbq-pm-up-pos').value = p.positive || '';
                overlay.querySelector('#rbq-pm-up-neg').value = p.negative || '';
            }
        };

        // 图片压缩转 Base64
        let compressedBase64 = '';
        const fileInput = overlay.querySelector('#rbq-pm-up-img');
        const previewWrap = overlay.querySelector('#rbq-pm-up-preview');
        const previewImg = overlay.querySelector('#rbq-pm-preview-img');

        fileInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 720;
                    let width = img.width;
                    let height = img.height;
                    if (width > MAX_WIDTH) {
                        height = Math.round((height * MAX_WIDTH) / width);
                        width = MAX_WIDTH;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    compressedBase64 = canvas.toDataURL('image/webp', 0.82);
                    previewImg.src = compressedBase64;
                    previewWrap.style.display = 'block';
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        };

        // 提交
        overlay.querySelector('#rbq-pm-up-submit').onclick = async () => {
            const title = overlay.querySelector('#rbq-pm-up-title').value.trim();
            const positive = overlay.querySelector('#rbq-pm-up-pos').value.trim();
            const author = overlay.querySelector('#rbq-pm-up-author').value.trim() || '匿名';
            const negative = overlay.querySelector('#rbq-pm-up-neg').value.trim();
            const rawTags = overlay.querySelector('#rbq-pm-up-tags').value.trim();
            const tags = rawTags.split(/[\s,，]+/).filter(Boolean);

            if (!title || !positive) {
                toastr.warning('请填写标题和正面提示词！');
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
                        positive,
                        negative,
                        tags,
                        previewBase64: compressedBase64
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
                submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 确认发布';
            }
        };
    }

    // ── 设置弹窗 ──
    function openSettingsDialog() {
        const cfg = getConfig();
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);';
        overlay.innerHTML = `
            <div style="width:90vw; max-width:480px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:12px; display:flex; flex-direction:column; overflow:hidden; color:#fff;">
                <div style="padding:12px 16px; background:#1e293b; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-size:14px; font-weight:700;"><i class="fa-solid fa-gear"></i> 预设工坊设置</div>
                    <button id="rbq-pm-set-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">工坊服务器地址 (API 接口)</label>
                        <input id="rbq-pm-cfg-server" type="text" placeholder="https://market.rbq.my" value="${cfg.serverUrl || ''}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;">
                        <div style="font-size:11px; color:#64748b; margin-top:3px;">默认直连社区工坊服务器 (https://market.rbq.my)。可直接上传和同步预设。</div>
                    </div>
                    <div>
                        <label style="font-size:12px; color:#94a3b8; display:block; margin-bottom:4px;">作者昵称 (默认发布者)</label>
                        <input id="rbq-pm-cfg-author" type="text" placeholder="你的署名" value="${cfg.authorName || ''}" style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px; color:#fff; font-size:12px; box-sizing:border-box;">
                    </div>
                </div>
                <div style="padding:12px 16px; background:#1e293b; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end; gap:8px;">
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
        overlay.style.cssText = 'position:fixed; inset:0; z-index:100001; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; cursor:zoom-out;';
        overlay.innerHTML = `<img src="${url}" style="max-width:90vw; max-height:90vh; border-radius:8px; box-shadow:0 10px 40px rgba(0,0,0,0.8);">`;
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
