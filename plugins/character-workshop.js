(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[Character Workshop] RBQ Core API missing');

    const PLUGIN_NAME = '角色工坊';
    const VERSION = '2.0.10';
    const CW_KEY = '_characterWorkshop';
    const SDT_KEY = '_smartDrawTrigger';
    const MCC_KEY = '_multiCharComposer';

    // ══════════════════════════════════════════════════════════
    //  Utilities
    // ══════════════════════════════════════════════════════════
    function uid(p = 'cw') {
        return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }
    function toggleTag(current, tag) {
        if (!current) return tag;
        const list = current.split(',').map(s => s.trim()).filter(Boolean);
        const lo = tag.toLowerCase();
        const has = list.some(t => t.toLowerCase() === lo);
        return has ? list.filter(t => t.toLowerCase() !== lo).join(', ') : [...list, tag].join(', ');
    }
    function sanitizePromptSegment(s) {
        if (!s) return '';
        return s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/^[,;\s]+|[,;\s]+$/g, '');
    }

    // ══════════════════════════════════════════════════════════
    //  Coordinate System (5x5 Stage Grid)
    // ══════════════════════════════════════════════════════════
    const COLS = ['A', 'B', 'C', 'D', 'E'];
    const ROWS = ['1', '2', '3', '4', '5'];
    const COORD_LABELS = {
        A1: '左上远景', B1: '偏左远景', C1: '居中远景', D1: '偏右远景', E1: '右上远景',
        A2: '左上方',   B2: '左后方',   C2: '正后方',   D2: '右后方',   E2: '右上方',
        A3: '极左侧',   B3: '左侧主角', C3: '画面正中', D3: '右侧主角', E3: '极右侧',
        A4: '左下方',   B4: '左前方',   C4: '正前方',   D4: '右前方',   E4: '右下方',
        A5: '左下特写', B5: '偏左特写', C5: '中央特写', D5: '偏右特写', E5: '右下特写'
    };
    function coordLabel(c) {
        const u = (c || 'C3').toUpperCase();
        return COORD_LABELS[u] ? `${u} (${COORD_LABELS[u]})` : u;
    }

    const COLORS = [
        { hex: '#38bdf8', bg: 'rgba(56,189,248,.15)', bdr: 'rgba(56,189,248,.5)' },
        { hex: '#f472b6', bg: 'rgba(244,114,182,.15)', bdr: 'rgba(244,114,182,.5)' },
        { hex: '#4ade80', bg: 'rgba(74,222,128,.15)',  bdr: 'rgba(74,222,128,.5)' },
        { hex: '#fbbf24', bg: 'rgba(251,191,36,.15)',  bdr: 'rgba(251,191,36,.5)' },
        { hex: '#c084fc', bg: 'rgba(192,132,252,.15)', bdr: 'rgba(192,132,252,.5)' },
        { hex: '#fb7185', bg: 'rgba(251,113,133,.15)', bdr: 'rgba(251,113,133,.5)' },
    ];

    // ══════════════════════════════════════════════════════════
    //  Data Access Layer: Direct SDT characterProfiles Binding
    // ══════════════════════════════════════════════════════════
    let dossierScope = 'chat'; // 'chat' (仅当前会话) | 'all' (全部历史档案)

    function getChatKey() {
        // 1. 优先尝试 ST 全局 getCurrentChatId()
        try {
            if (typeof window.getCurrentChatId === 'function') {
                const id = window.getCurrentChatId();
                if (id) return String(id);
            }
        } catch (_e) { /* noop */ }
        // 2. 尝试 SillyTavern context (与 smart-draw-trigger 格式完全一致)
        try {
            const ctx = window.SillyTavern?.getContext?.();
            if (ctx?.chatId) return String(ctx.chatId);
            if (ctx?.characterId !== undefined) return `char-${ctx.characterId}`;
            if (ctx?.groupId !== undefined) return `group-${ctx.groupId}`;
        } catch (_e) { /* noop */ }
        // 3. 回退：从聊天元数据元素中读取
        try {
            const chatEl = document.querySelector('#chat');
            const chatFile = chatEl?.closest?.('[chat_id]')?.getAttribute('chat_id') || chatEl?.closest?.('[data-chat-file]')?.dataset?.chatFile;
            if (chatFile) return String(chatFile);
        } catch (_e) { /* noop */ }
        return '_global';
    }

    function getSdtStore() {
        const s = RBQ.api.getSettings();
        if (!s[SDT_KEY]) s[SDT_KEY] = {};
        return s[SDT_KEY];
    }

    function ensureProfileBucket() {
        const s = RBQ.api.getSettings();
        if (!s[SDT_KEY]) s[SDT_KEY] = {};
        if (!s[SDT_KEY].characterProfiles) s[SDT_KEY].characterProfiles = {};
        const ck = getChatKey();
        if (!s[SDT_KEY].characterProfiles[ck]) s[SDT_KEY].characterProfiles[ck] = {};
        return s[SDT_KEY].characterProfiles[ck];
    }

    function getCurrentChatProfiles() {
        const sdt = getSdtStore();
        const ck = getChatKey();
        return (sdt.characterProfiles && sdt.characterProfiles[ck]) || {};
    }

    function getAllGlobalProfiles() {
        const sdt = getSdtStore();
        const fallback = {};
        if (sdt.characterProfiles && typeof sdt.characterProfiles === 'object') {
            for (const chatDict of Object.values(sdt.characterProfiles)) {
                if (chatDict && typeof chatDict === 'object') {
                    for (const [k, v] of Object.entries(chatDict)) {
                        if (v && typeof v === 'object' && !fallback[k]) fallback[k] = v;
                    }
                }
            }
        }
        return fallback;
    }

    function getAllProfiles() {
        if (dossierScope === 'all') {
            return getAllGlobalProfiles();
        }
        return getCurrentChatProfiles();
    }

    function getProfile(name) {
        if (!name) return null;
        return getAllProfiles()[name] || null;
    }

    function saveProfile(name, data) {
        if (!name) return;
        const bucket = ensureProfileBucket();
        bucket[name] = { ...data, displayName: data.displayName || name, updatedAt: Date.now() };
        if (!bucket[name].createdAt) bucket[name].createdAt = Date.now();
        if (!Array.isArray(bucket[name].wardrobe)) bucket[name].wardrobe = [];
        RBQ.api.saveSettings();
    }

    function deleteProfile(name) {
        if (!name) return;
        const bucket = ensureProfileBucket();
        delete bucket[name];
        RBQ.api.saveSettings();
    }

    function getOutfitTagsForSlot(profile, outfitId, customOutfit) {
        if (customOutfit) return customOutfit;
        if (!profile) return '';
        if (outfitId && Array.isArray(profile.wardrobe)) {
            const found = profile.wardrobe.find(w => w.id === outfitId);
            if (found) return found.outfit || found.tags || '';
        }
        return profile.currentOutfit || (profile.wardrobe?.[0]?.outfit) || '';
    }

    function isMccEnabled() {
        const s = RBQ.api.getSettings();
        return s[MCC_KEY]?.enabled !== false;
    }

    // ══════════════════════════════════════════════════════════
    //  Local Workspace State (Stage Presets & Active Composer)
    // ══════════════════════════════════════════════════════════
    function getWs() {
        const s = RBQ.api.getSettings();
        if (!s[CW_KEY]) s[CW_KEY] = {};
        const ws = s[CW_KEY];
        if (!Array.isArray(ws.presets)) ws.presets = [];
        if (!ws.activeComposer || typeof ws.activeComposer !== 'object') {
            ws.activeComposer = {
                scene: '', camera: '', atmosphere: '',
                slots: [
                    { charName: '', outfitId: '', customOutfit: '', action: '', uc: '', center: 'B3' },
                    { charName: '', outfitId: '', customOutfit: '', action: '', uc: '', center: 'D3' }
                ],
                activeSlotIndex: 0
            };
        }
        return ws;
    }
    function wsSave() { RBQ.api.saveSettings(); }

    // ══════════════════════════════════════════════════════════
    //  Preset Compositions
    // ══════════════════════════════════════════════════════════
    const TEMPLATES = [
        {
            name: '双人面对面互动',
            desc: '两角色分别位于中左/中右，身体相对',
            scene: 'indoors, cozy room, soft lighting',
            camera: 'from_side, medium shot, eye level',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'standing, facing right, looking at partner, gentle smile', uc: '', center: 'B3' },
                { charName: '', outfitId: '', customOutfit: '', action: 'standing, facing left, looking at partner, blush', uc: '', center: 'D3' }
            ]
        },
        {
            name: '背靠背战斗分镜',
            desc: '战术背靠背站姿，左右分立有张力',
            scene: 'ruins, embers, dramatic lighting',
            camera: 'dynamic angle, wide shot',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'fighting stance, back to back, looking at viewer, serious', uc: '', center: 'B3' },
                { charName: '', outfitId: '', customOutfit: '', action: 'holding weapon, back to back, looking away, focused', uc: '', center: 'D3' }
            ]
        },
        {
            name: '主仆/高低位差分镜',
            desc: '一人站立居高临下，一人跪坐/屈膝',
            scene: 'throne room, luxurious, marble floor',
            camera: 'from above, tilted angle',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'standing, looking down, confident smile, hand on hip', uc: '', center: 'C2' },
                { charName: '', outfitId: '', customOutfit: '', action: 'kneeling, looking up, blush, submissive', uc: '', center: 'C4' }
            ]
        },
        {
            name: '三人同行分镜',
            desc: '三人成三角站位，中间为主视点',
            scene: 'street, sunny day, depth of field',
            camera: 'front view, medium full shot',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'walking forward, waving hand, cheerful', uc: '', center: 'A3' },
                { charName: '', outfitId: '', customOutfit: '', action: 'standing, center, looking at viewer, smile', uc: '', center: 'C3' },
                { charName: '', outfitId: '', customOutfit: '', action: 'walking, arms crossed, side glance, smirk', uc: '', center: 'E3' }
            ]
        }
    ];

    // ══════════════════════════════════════════════════════════
    //  7-Dimensional Holographic Appearance Formula
    // ══════════════════════════════════════════════════════════
    const TRAITS = [
        {
            g: '性别族裔', c: '#38bdf8',
            t: [
                { n: '1girl', t: '1girl' }, { n: '1boy', t: '1boy' },
                { n: '日系', t: 'japanese' }, { n: '东亚', t: 'east_asian' },
                { n: '西方', t: 'caucasian' }, { n: '中华', t: 'chinese' },
                { n: '动漫风', t: 'delicate_face' }, { n: 'Gyaru', t: 'gyaru' }
            ]
        },
        {
            g: '年龄', c: '#fbbf24',
            t: [
                { n: '少女', t: 'adolescent, young_girl' }, { n: '御姐', t: 'mature_female' },
                { n: '萝莉', t: 'petite, loli' }, { n: '成年男', t: 'mature_male' },
                { n: '正太', t: 'bishounen' }
            ]
        },
        {
            g: '发型发色', c: '#f472b6',
            t: [
                { n: '黑发', t: 'black_hair' }, { n: '银发', t: 'silver_hair' },
                { n: '金发', t: 'blonde_hair' }, { n: '粉发', t: 'pink_hair' },
                { n: '蓝发', t: 'blue_hair' }, { n: '红发', t: 'red_hair' },
                { n: '棕发', t: 'brown_hair' }, { n: '双马尾', t: 'twin_tails' },
                { n: '马尾', t: 'ponytail' }, { n: '长发', t: 'long_hair' },
                { n: '短发', t: 'short_hair' }, { n: '波浪', t: 'wavy_hair' },
                { n: '齐刘海', t: 'blunt_bangs' }, { n: '呆毛', t: 'ahoge' }
            ]
        },
        {
            g: '瞳色', c: '#a855f7',
            t: [
                { n: '红瞳', t: 'red_eyes' }, { n: '蓝瞳', t: 'blue_eyes' },
                { n: '金瞳', t: 'golden_eyes' }, { n: '绿瞳', t: 'green_eyes' },
                { n: '紫瞳', t: 'purple_eyes' }, { n: '异色瞳', t: 'heterochromia' },
                { n: '垂眼', t: 'tareme' }, { n: '吊眼', t: 'tsurime' }
            ]
        },
        {
            g: '身材', c: '#4ade80',
            t: [
                { n: '纤细', t: 'slender' }, { n: '娇小', t: 'petite' },
                { n: '丰满', t: 'curvy' }, { n: '高挑', t: 'tall' },
                { n: '平胸', t: 'flat_chest' }, { n: '小胸', t: 'small_breasts' },
                { n: '中等', t: 'medium_breasts' }, { n: '巨乳', t: 'large_breasts' },
                { n: '爆乳', t: 'huge_breasts' }, { n: '马甲线', t: 'abs' },
                { n: '肉腿', t: 'thick_thighs' }
            ]
        },
        {
            g: '肤色标记', c: '#fb7185',
            t: [
                { n: '冷白', t: 'pale_skin' }, { n: '自然', t: 'fair_skin' },
                { n: '小麦黑皮', t: 'tan, dark_skin' }, { n: '泪痣', t: 'mole_under_eye' },
                { n: '雀斑', t: 'freckles' }, { n: '淫纹', t: 'stomach_tattoo' }
            ]
        },
        {
            g: '种族幻想', c: '#38bdf8',
            t: [
                { n: '猫耳尾', t: 'cat_ears, cat_tail' }, { n: '狐耳尾', t: 'fox_ears, fox_tail' },
                { n: '兔耳尾', t: 'rabbit_ears, rabbit_tail' }, { n: '精灵尖耳', t: 'pointy_ears' },
                { n: '恶魔角翼', t: 'demon_horns, demon_wings' }, { n: '天使光环翼', t: 'halo, angel_wings' },
                { n: '魅魔', t: 'succubus' }, { n: '虎牙', t: 'fangs' }
            ]
        }
    ];

    const OUTFIT_PRESETS = [
        { n: '水手服', t: 'sailor_suit, pleated_skirt' },
        { n: '校服西装', t: 'school_uniform, blazer, necktie' },
        { n: '女仆装', t: 'maid, maid_headdress, apron' },
        { n: '兔女郎', t: 'bunny_suit, bunny_ears' },
        { n: '比基尼', t: 'bikini, micro_bikini' },
        { n: '卫衣服', t: 'hoodie, casual' },
        { n: '露肩毛衣', t: 'off-shoulder_sweater' },
        { n: '旗袍', t: 'china_dress, high_slit' },
        { n: '浴衣/和服', t: 'yukata, kimono' },
        { n: '全裸', t: 'nude, uncensored' }
    ];

    // ══════════════════════════════════════════════════════════
    //  Prompt Composition (NAI V4.5 Format)
    // ══════════════════════════════════════════════════════════
    function composeFinalPrompt(comp) {
        const parts = [];
        const slots = comp?.slots || [];

        let girlCount = 0;
        let boyCount = 0;

        const charParts = [];
        slots.forEach((slot, i) => {
            const n = i + 1;
            const profile = slot.charName ? getProfile(slot.charName) : null;
            const rawName = profile?.displayName || slot.charName || '';
            const base = sanitizePromptSegment(profile?.baseTags || '');
            const outfit = sanitizePromptSegment(getOutfitTagsForSlot(profile, slot.outfitId, slot.customOutfit));
            const action = sanitizePromptSegment(slot.action || '');

            const combinedLower = (rawName + ' ' + base).toLowerCase();
            if (combinedLower.includes('1boy') || combinedLower.includes('male') || combinedLower.includes('man')) {
                boyCount++;
            } else {
                girlCount++;
            }

            const namePrefix = (rawName && !base.toLowerCase().includes(rawName.toLowerCase())) ? rawName : '';
            const caption = [namePrefix, base, outfit, action].filter(Boolean).join(', ');
            const center = (slot.center || (i === 0 ? 'B3' : (i === 1 ? 'D3' : 'C3'))).toUpperCase();
            const centersSuffix = (comp?.useCoords === true) ? ('|centers:' + center) : '';

            if (caption) charParts.push('Char' + n + ':' + caption + centersSuffix);
            const uc = sanitizePromptSegment(slot.uc);
            if (uc) charParts.push('Char' + n + ' UC:' + uc);
        });

        const userScene = sanitizePromptSegment([comp?.scene, comp?.camera, comp?.atmosphere].filter(Boolean).join(', '));
        const countTags = [];
        const lowerScene = userScene.toLowerCase();
        
        if (!lowerScene.includes('girl') && !lowerScene.includes('boy') && !lowerScene.includes('solo') && !lowerScene.includes('multiple')) {
            if (girlCount > 0 && boyCount === 0) {
                countTags.push(girlCount === 1 ? '1girl' : `${girlCount}girls`);
            } else if (boyCount > 0 && girlCount === 0) {
                countTags.push(boyCount === 1 ? '1boy' : `${boyCount}boys`);
            } else if (girlCount > 0 && boyCount > 0) {
                countTags.push(`${girlCount}girl${girlCount > 1 ? 's' : ''}, ${boyCount}boy${boyCount > 1 ? 's' : ''}`);
            }
        }

        const fullScene = [countTags.join(', '), userScene].filter(Boolean).join(', ');
        if (fullScene) parts.push('Scene:' + fullScene);

        return [...parts, ...charParts].join('; ');
    }

    // ══════════════════════════════════════════════════════════
    //  Portrait Test Modes, Suite Generator & Tabbed Gallery
    // ══════════════════════════════════════════════════════════
    const TEST_PRESETS = {
        portrait: {
            title: '肖像特写',
            desc: '上半身特写，检验发色、瞳色、五官细节与发型',
            tags: '1girl, solo, looking_at_viewer, upper_body, portrait, simple_background, best_quality, masterpiece'
        },
        fullbody: {
            title: '全身立绘',
            desc: '站立全景，检验完整服装、鞋袜搭配与身材比例',
            tags: '1girl, solo, looking_at_viewer, full_body, standing, simple_background, best_quality, masterpiece'
        },
        dynamic: {
            title: '动态姿态',
            desc: '微表情与动作姿势，检验角色生动的神态与衣服摆动',
            tags: '1girl, solo, slight_smile, dynamic_pose, upper_body, looking_at_viewer, expressive, simple_background, best_quality, masterpiece'
        }
    };

    function openPortraitTestModal(name, baseTags, outfitTags, onSetAvatar = null, triggerBtn = null) {
        const cleanName = (name || 'Character').trim();
        const existing = document.getElementById('cw-test-mode-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'cw-test-mode-modal';
        modal.className = 'cw-modal-mask';
        modal.style.cssText = 'position:fixed !important;inset:0 !important;z-index:100000060 !important;background:rgba(0,0,0,.85) !important;backdrop-filter:blur(8px) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:16px !important;box-sizing:border-box !important;';
        modal.innerHTML = `
            <div class="cw-modal" style="width:480px;max-width:95vw">
                <div class="cw-modal-hd">
                    <strong style="color:#38bdf8;font-size:14px"><i class="fa-solid fa-palette"></i> 选择立绘测试视角 · ${esc(cleanName)}</strong>
                    <button class="cw-btn sm" id="cw-test-mode-close">✕</button>
                </div>
                <div class="cw-modal-bd" style="gap:10px">
                    <div style="font-size:12px;opacity:.75;margin-bottom:2px">请选择本次测试生成的视角模式或一键全景套图：</div>
                    
                    <button class="cw-btn cw-test-opt" data-mode="portrait" type="button" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px">
                        <div>
                            <div style="font-weight:bold;color:#38bdf8;font-size:13px"><i class="fa-solid fa-user"></i> 👤 肖像特写 (Portrait)</div>
                            <div style="font-size:11px;opacity:.7;margin-top:2px">上半身特写，检验发色、瞳色、五官细节与发型</div>
                        </div>
                        <i class="fa-solid fa-chevron-right" style="opacity:.4"></i>
                    </button>

                    <button class="cw-btn cw-test-opt" data-mode="fullbody" type="button" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px">
                        <div>
                            <div style="font-weight:bold;color:#f472b6;font-size:13px"><i class="fa-solid fa-person-dress"></i> 👗 全身立绘 (Full Body)</div>
                            <div style="font-size:11px;opacity:.7;margin-top:2px">站立全景，检验完整服装、鞋袜搭配与身材比例</div>
                        </div>
                        <i class="fa-solid fa-chevron-right" style="opacity:.4"></i>
                    </button>

                    <button class="cw-btn cw-test-opt" data-mode="dynamic" type="button" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px">
                        <div>
                            <div style="font-weight:bold;color:#4ade80;font-size:13px"><i class="fa-solid fa-person-running"></i> 💃 动态姿态 (Dynamic Pose)</div>
                            <div style="font-size:11px;opacity:.7;margin-top:2px">微表情与动作姿势，检验角色生动的神态与衣服摆动</div>
                        </div>
                        <i class="fa-solid fa-chevron-right" style="opacity:.4"></i>
                    </button>

                    <button class="cw-btn cw-test-opt" data-mode="all" type="button" style="padding:11px 14px;display:flex;align-items:center;justify-content:space-between;text-align:left;background:linear-gradient(135deg, rgba(2,132,199,.25), rgba(56,189,248,.15));border:1px solid rgba(56,189,248,.4);border-radius:8px">
                        <div>
                            <div style="font-weight:bold;color:#fff;font-size:13px"><i class="fa-solid fa-wand-magic-sparkles" style="color:#38bdf8"></i> 📦 一键生成全景套图 (3张)</div>
                            <div style="font-size:11px;opacity:.8;margin-top:2px">依次生成【特写 + 全身 + 动态】3张分镜，在弹窗画廊中对比切换与挑选头像</div>
                        </div>
                        <i class="fa-solid fa-angles-right" style="color:#38bdf8"></i>
                    </button>
                </div>
            </div>
        `;

        modal.querySelector('#cw-test-mode-close')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        modal.querySelectorAll('.cw-test-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                modal.remove();
                executePortraitTest(cleanName, baseTags, outfitTags, mode, onSetAvatar, triggerBtn);
            });
        });

        document.body.appendChild(modal);
    }

    async function executePortraitTest(cleanName, baseTags, outfitTags, mode = 'portrait', onSetAvatar = null, triggerBtn = null) {
        const origHtml = triggerBtn ? triggerBtn.innerHTML : '';
        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 准备生图...';
        }

        try {
            const modesToRun = mode === 'all' ? ['portrait', 'fullbody', 'dynamic'] : [mode];
            const results = [];

            for (let i = 0; i < modesToRun.length; i++) {
                const currentMode = modesToRun[i];
                const preset = TEST_PRESETS[currentMode] || TEST_PRESETS.portrait;

                if (triggerBtn) {
                    triggerBtn.innerHTML = mode === 'all'
                        ? `<i class="fa-solid fa-spinner fa-spin"></i> [${i + 1}/3] ${preset.title}...`
                        : `<i class="fa-solid fa-spinner fa-spin"></i> 生成中...`;
                }

                toastr.info(`正在为「${cleanName}」生成 ${preset.title}...`, PLUGIN_NAME);

                const prompt = [cleanName, baseTags, outfitTags, preset.tags].filter(Boolean).join(', ');

                const result = await RBQ.api.generateImage(prompt, 'cw-portrait-test', {}, (progress) => {
                    if (triggerBtn && typeof progress === 'string') {
                        const prefix = mode === 'all' ? `[${i + 1}/3] ` : '';
                        triggerBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${prefix}${progress.slice(0, 10)}...`;
                    }
                });

                if (result && result.url) {
                    results.push({
                        title: preset.title,
                        modeKey: currentMode,
                        url: result.url,
                        prompt
                    });
                }
            }

            if (results.length === 0) {
                throw new Error('生图未返回有效图片地址');
            }

            showPortraitTestGalleryModal(cleanName, results, onSetAvatar);
            toastr.success(`「${cleanName}」测试生图完成！共生成 ${results.length} 张图片`, PLUGIN_NAME);
        } catch (err) {
            console.error('[Character Workshop] 角色测试生图失败:', err);
            toastr.error('角色测试生图失败: ' + (err.message || String(err)), PLUGIN_NAME);
        } finally {
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.innerHTML = origHtml;
            }
        }
    }

    function showPortraitTestGalleryModal(cleanName, results, onSetAvatar = null) {
        if (!results || results.length === 0) return;

        let activeIndex = 0;
        const hasMultiple = results.length > 1;

        const existing = document.getElementById('cw-image-viewer-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'cw-image-viewer-modal';
        modal.className = 'cw-modal-mask';
        modal.style.cssText = 'position:fixed !important;inset:0 !important;z-index:100000070 !important;background:rgba(0,0,0,.85) !important;backdrop-filter:blur(8px) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:16px !important;box-sizing:border-box !important;';

        function renderGallery() {
            const currentItem = results[activeIndex] || results[0];
            const tabsHtml = hasMultiple ? `
                <div class="cw-tabs" style="padding:4px 8px;margin:0 14px;overflow-x:auto;background:rgba(0,0,0,.35)">
                    ${results.map((it, idx) => `
                        <button class="cw-tab ${idx === activeIndex ? 'on' : ''} cw-gallery-tab" data-idx="${idx}" type="button">
                            ${esc(it.title)}
                        </button>
                    `).join('')}
                </div>
            ` : '';

            modal.innerHTML = `
                <div class="cw-modal" style="width:680px;max-width:96vw">
                    <div class="cw-modal-hd">
                        <strong style="color:#38bdf8;font-size:14px"><i class="fa-solid fa-palette"></i> 角色立绘测试画廊 · ${esc(cleanName)} ${hasMultiple ? `(${activeIndex + 1}/${results.length})` : ''}</strong>
                        <button class="cw-btn sm" id="cw-gal-close">✕</button>
                    </div>
                    ${tabsHtml}
                    <div class="cw-modal-bd" style="align-items:center;gap:8px">
                        <div style="width:100%;flex:1 1 auto;max-height:48vh;min-height:140px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);border-radius:8px;overflow:hidden">
                            <img src="${esc(currentItem.url)}" style="max-width:100%;max-height:46vh;width:auto;height:auto;object-fit:contain;display:block" alt="Test Result" />
                        </div>
                        <div style="width:100%;background:rgba(0,0,0,0.35);padding:6px 10px;border-radius:6px;font-size:11px;color:rgba(255,255,255,0.7);max-height:65px;overflow-y:auto;word-break:break-all;line-height:1.35">
                            <strong style="color:#38bdf8">【${esc(currentItem.title)}】测试提示词：</strong> ${esc(currentItem.prompt)}
                        </div>
                    </div>
                    <div class="cw-modal-ft" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">
                        <a href="${esc(currentItem.url)}" target="_blank" class="cw-btn sm cy" style="text-decoration:none"><i class="fa-solid fa-arrow-up-right-from-square"></i> 查看原图</a>
                        ${onSetAvatar ? `<button class="cw-btn sm gn" id="cw-gal-set-avatar"><i class="fa-solid fa-user-check"></i> 设为角色头像</button>` : ''}
                        <button class="cw-btn sm" id="cw-gal-copy-prompt"><i class="fa-regular fa-copy"></i> 复制提示词</button>
                        <button class="cw-btn sm pri" id="cw-gal-done">完成</button>
                    </div>
                </div>
            `;

            modal.querySelector('#cw-gal-close')?.addEventListener('click', () => modal.remove());
            modal.querySelector('#cw-gal-done')?.addEventListener('click', () => modal.remove());
            modal.querySelector('#cw-gal-copy-prompt')?.addEventListener('click', () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(currentItem.prompt).then(() => toastr.success('已复制提示词', PLUGIN_NAME));
                }
            });
            if (onSetAvatar) {
                modal.querySelector('#cw-gal-set-avatar')?.addEventListener('click', () => {
                    onSetAvatar(currentItem.url);
                    toastr.success(`已将【${currentItem.title}】设为角色头像！`, PLUGIN_NAME);
                });
            }
            modal.querySelectorAll('.cw-gallery-tab').forEach(b => {
                b.addEventListener('click', () => {
                    activeIndex = +b.dataset.idx;
                    renderGallery();
                });
            });
        }

        renderGallery();
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
    }

    function showGeneratedImageModal(title, prompt, result) {
        const url = result?.url || (typeof result === 'string' ? result : null);
        if (!url) {
            toastr.warning('生图未返回有效图片地址', PLUGIN_NAME);
            return;
        }

        const existing = document.getElementById('cw-image-viewer-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'cw-image-viewer-modal';
        modal.className = 'cw-modal-mask';
        modal.style.cssText = 'position:fixed !important;inset:0 !important;z-index:100000070 !important;background:rgba(0,0,0,.85) !important;backdrop-filter:blur(8px) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:16px !important;box-sizing:border-box !important;';
        modal.innerHTML = `
            <div class="cw-modal" style="width:680px;max-width:95vw">
                <div class="cw-modal-hd">
                    <strong style="color:#38bdf8;font-size:14px"><i class="fa-solid fa-image"></i> ${esc(title)}</strong>
                    <button class="cw-btn sm" id="cw-img-close">✕</button>
                </div>
                <div class="cw-modal-bd" style="align-items:center;gap:8px">
                    <div style="width:100%;flex:1 1 auto;max-height:50vh;min-height:140px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);border-radius:8px;overflow:hidden">
                        <img src="${esc(url)}" style="max-width:100%;max-height:48vh;width:auto;height:auto;object-fit:contain;display:block" alt="Generated Image" />
                    </div>
                    <div style="width:100%;background:rgba(0,0,0,0.35);padding:6px 10px;border-radius:6px;font-size:11px;color:rgba(255,255,255,0.7);max-height:65px;overflow-y:auto;word-break:break-all;line-height:1.35">
                        <strong style="color:#38bdf8">提示词：</strong> ${esc(prompt)}
                    </div>
                </div>
                <div class="cw-modal-ft" style="justify-content:flex-end;gap:6px;flex-wrap:wrap">
                    <a href="${esc(url)}" target="_blank" class="cw-btn sm cy" style="text-decoration:none"><i class="fa-solid fa-arrow-up-right-from-square"></i> 查看原图</a>
                    <button class="cw-btn sm" id="cw-img-copy-prompt"><i class="fa-regular fa-copy"></i> 复制提示词</button>
                    <button class="cw-btn sm pri" id="cw-img-ok">完成</button>
                </div>
            </div>
        `;

        modal.querySelector('#cw-img-close')?.addEventListener('click', () => modal.remove());
        modal.querySelector('#cw-img-ok')?.addEventListener('click', () => modal.remove());
        modal.querySelector('#cw-img-copy-prompt')?.addEventListener('click', () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(prompt).then(() => toastr.success('已复制提示词', PLUGIN_NAME));
            }
        });
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
    }

    // ══════════════════════════════════════════════════════════
    //  CSS Injection
    // ══════════════════════════════════════════════════════════
    (function injectStyles() {
        if (document.getElementById('cw-styles-v2')) return;
        const s = document.createElement('style');
        s.id = 'cw-styles-v2';
        s.textContent = `
.cw-wrap{display:flex;flex-direction:column;width:100%;height:100%;color:#f1f5f9;font-family:inherit}
.cw-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(15,23,42,.4);backdrop-filter:blur(12px);gap:10px;flex-wrap:wrap}
.cw-logo{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#38bdf8}
.cw-tabs{display:flex;gap:4px;background:rgba(0,0,0,.3);padding:3px;border-radius:8px;border:1px solid rgba(255,255,255,.06)}
.cw-tab{background:0 0;border:none;color:rgba(255,255,255,.6);padding:5px 11px;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;transition:.2s;display:inline-flex;align-items:center;gap:5px}
.cw-tab:hover{color:#fff;background:rgba(255,255,255,.08)}
.cw-tab.on{color:#38bdf8;background:rgba(56,189,248,.15);box-shadow:0 2px 8px rgba(56,189,248,.2)}
.cw-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px}
.cw-card{background:rgba(30,41,59,.45);border:1px solid rgba(255,255,255,.08);border-radius:11px;padding:12px;backdrop-filter:blur(8px);display:flex;flex-direction:column;gap:9px}
.cw-card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cw-card-tt{font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:6px;color:#e2e8f0}
.cw-grid5{width:250px;height:250px;background:rgba(15,23,42,.7);border:1.5px solid rgba(56,189,248,.35);border-radius:9px;display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(5,1fr);gap:2px;padding:3px;position:relative;box-shadow:inset 0 0 18px rgba(0,0,0,.5);flex-shrink:0}
.cw-cell{background:rgba(255,255,255,.03);border-radius:3px;border:1px dashed rgba(255,255,255,.1);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:.15s;position:relative;font-size:9.5px;color:rgba(255,255,255,.3);font-weight:bold}
.cw-cell:hover{background:rgba(56,189,248,.15);border-color:rgba(56,189,248,.5);color:#38bdf8}
.cw-cell.has{border-style:solid}
.cw-pin{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;box-shadow:0 2px 5px rgba(0,0,0,.6);position:absolute;z-index:2;cursor:pointer;transition:.15s}
.cw-pin:hover{transform:scale(1.2)}
.cw-slot{background:rgba(15,23,42,.55);border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:9px;transition:.2s}
.cw-slot.on{border-color:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,.15)}
.cw-slot-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cw-badge{padding:2px 7px;border-radius:5px;font-size:11px;font-weight:bold}
.cw-slot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:7px}
.cw-in,.cw-sel,.cw-ta{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:5px;color:#fff;padding:5px 9px;font-size:12px;font-family:inherit;transition:.2s}
.cw-in:focus,.cw-sel:focus,.cw-ta:focus{outline:none;border-color:#38bdf8;background:rgba(0,0,0,.5)}
.cw-ta{min-height:44px;resize:vertical;font-family:monospace}
.cw-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:5px 11px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:.2s;background:rgba(255,255,255,.08);color:#fff;white-space:nowrap !important;flex-shrink:0 !important}
.cw-btn:hover{filter:brightness(1.2)}
.cw-btn.pri{background:linear-gradient(135deg,#0284c7,#38bdf8);border-color:rgba(56,189,248,.5);box-shadow:0 2px 10px rgba(56,189,248,.3);color:#fff}
.cw-btn.cy{background:rgba(56,189,248,.15);border-color:rgba(56,189,248,.4);color:#38bdf8}
.cw-btn.pk{background:rgba(244,114,182,.15);border-color:rgba(244,114,182,.4);color:#f472b6}
.cw-btn.gn{background:rgba(74,222,128,.15);border-color:rgba(74,222,128,.4);color:#4ade80}
.cw-btn.am{background:rgba(251,191,36,.15);border-color:rgba(251,191,36,.4);color:#fbbf24}
.cw-btn.rd{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.4);color:#ef4444}
.cw-btn.sm{padding:3px 7px;font-size:11px}
.cw-preview{background:rgba(15,23,42,.7);border:1px solid rgba(56,189,248,.3);border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:7px}
.cw-code{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);border-radius:5px;padding:7px 9px;font-family:monospace;font-size:11px;color:#a5f3fc;word-break:break-all;max-height:110px;overflow-y:auto}
.cw-chgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.cw-chcard{background:rgba(30,41,59,.5);border:1px solid rgba(255,255,255,.08);border-radius:11px;padding:11px;display:flex;flex-direction:column;gap:8px;transition:.2s;position:relative}
.cw-chcard:hover{transform:translateY(-2px);border-color:rgba(56,189,248,.4);box-shadow:0 6px 18px rgba(0,0,0,.4)}
.cw-avatar{width:42px;height:42px;border-radius:7px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;flex-shrink:0}
.cw-avatar img{width:100%;height:100%;object-fit:cover}
.cw-chip{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:3px;padding:2px 6px;font-size:10.5px;color:rgba(255,255,255,.75);cursor:pointer;transition:.15s;white-space:nowrap !important;flex-shrink:0 !important;user-select:none;display:inline-flex;align-items:center}
.cw-chip:hover{background:rgba(255,255,255,.12);color:#fff}
.cw-chip.on{background:rgba(56,189,248,.2)!important;border-color:rgba(56,189,248,.7)!important;color:#38bdf8!important;font-weight:bold}
.cw-modal-mask{position:fixed;inset:0;z-index:100000020;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px;box-sizing:border-box;-webkit-overflow-scrolling:touch}
.cw-modal{background:#0f172a;border:1px solid rgba(56,189,248,.35);border-radius:13px;width:820px;max-width:96vw;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.9);box-sizing:border-box;margin:auto;position:relative;flex-shrink:0}
.cw-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(56,189,248,.08);flex-shrink:0}
.cw-modal-bd{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;min-height:0}
.cw-modal-ft{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.3);flex-shrink:0;flex-wrap:wrap;gap:8px}
.cw-warn{background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.4);border-radius:7px;padding:8px 12px;font-size:12px;color:#fbbf24;display:flex;align-items:center;gap:8px}

@media (max-width: 768px) {
  .cw-modal-mask{padding:8px}
  .cw-modal{width:100%!important;max-width:100%!important;max-height:calc(100vh - 16px)!important;max-height:calc(100dvh - 16px)!important;margin:auto 0}
  .cw-modal-hd{padding:9px 12px}
  .cw-modal-bd{padding:10px 12px;gap:10px}
  .cw-modal-ft{padding:8px 12px;gap:6px}
}
`;
        document.head.appendChild(s);
    })();

    // ══════════════════════════════════════════════════════════
    //  Interactive Worldbook Picker Bridge
    // ══════════════════════════════════════════════════════════
    function openWorldbookPicker(title, onSelect, initialCategory = 'all') {
        if (typeof RBQ?.api?.openLorebookSearchModal === 'function') {
            RBQ.api.openLorebookSearchModal('all', (entry) => {
                const content = typeof entry === 'string' ? entry : (entry?.content || entry?.tags || '');
                if (content) onSelect(content.trim());
            }, initialCategory);
        } else {
            toastr.warning('世界书搜索功能不可用，请确保智能生图触发器已启用', PLUGIN_NAME);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Character Editor Modal
    //  直接读写 SDT characterProfiles — 无中间层
    // ══════════════════════════════════════════════════════════
    function openCharacterEditor(editName, onSaved) {
        const isEdit = !!editName;
        const origProfile = isEdit ? getProfile(editName) : null;

        const draft = {
            displayName: origProfile?.displayName || editName || '',
            baseTags: origProfile?.baseTags || '',
            currentOutfit: origProfile?.currentOutfit || '',
            currentOutfitId: origProfile?.currentOutfitId || '',
            avatarUrl: origProfile?.avatarUrl || '',
            wardrobe: JSON.parse(JSON.stringify(origProfile?.wardrobe || [])),
        };
        if (draft.wardrobe.length === 0) {
            draft.wardrobe.push({ id: uid('w'), name: '默认服装', outfit: draft.currentOutfit || '', triggers: [], createdAt: Date.now() });
        }
        if (!draft.currentOutfitId) {
            draft.currentOutfitId = draft.wardrobe[0]?.id || '';
        }

        let activeWIdx = 0;
        const mask = document.createElement('div');
        mask.className = 'cw-modal-mask';

        function render() {
            const cw = draft.wardrobe[activeWIdx] || draft.wardrobe[0];
            const isCurrentlyWorn = (draft.currentOutfitId ? cw?.id === draft.currentOutfitId : (cw?.outfit && cw?.outfit === draft.currentOutfit));

            mask.innerHTML = `
                <div class="cw-modal" style="width:820px">
                    <div class="cw-modal-hd">
                        <strong style="color:#38bdf8;font-size:14px"><i class="fa-solid fa-id-card"></i> ${isEdit ? '编辑角色 · ' + esc(draft.displayName) : '✨ 新建角色档案'}</strong>
                        <button class="cw-btn sm" id="cw-ce-x">✕</button>
                    </div>
                    <div class="cw-modal-bd">
                        <!-- Name & Avatar -->
                        <div class="cw-card" style="padding:9px 12px">
                            <div style="display:flex;gap:10px;align-items:center">
                                <div class="cw-avatar" style="width:48px;height:48px" id="cw-ce-avatar-box">${draft.avatarUrl ? '<img src="' + esc(draft.avatarUrl) + '"/>' : '👤'}</div>
                                <div style="flex:1;display:flex;flex-direction:column;gap:5px">
                                    <div style="display:flex;gap:7px">
                                        <input id="cw-ce-name" class="cw-in" type="text" placeholder="角色姓名" value="${esc(draft.displayName)}" style="font-weight:bold;font-size:13px" ${isEdit ? 'disabled' : ''} />
                                        <button class="cw-btn am sm" id="cw-ce-import-card" type="button"><i class="fa-solid fa-file-import"></i> 从当前角色卡导入</button>
                                    </div>
                                    <div style="display:flex;gap:6px;align-items:center">
                                        <span style="font-size:10.5px;color:rgba(255,255,255,.5);white-space:nowrap">头像 URL:</span>
                                        <input id="cw-ce-avatar-url" class="cw-in" type="text" placeholder="https://... 或测试立绘后一键设为头像" value="${esc(draft.avatarUrl)}" style="font-size:11px;padding:3px 8px" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Base Tags + 7D Chips -->
                        <div class="cw-card">
                            <div class="cw-card-hd">
                                <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-dna"></i> 7 维全息外貌公式 (Base Tags)</span>
                                <button class="cw-btn cy sm" id="cw-ce-wb-base" type="button"><i class="fa-solid fa-book-open"></i> 从世界书选外貌</button>
                            </div>
                            <div style="display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto;background:rgba(0,0,0,.25);padding:8px 10px;border-radius:6px">
                                ${TRAITS.map(g => `<div style="display:flex;gap:5px;align-items:flex-start;flex-wrap:wrap">
                                    <span style="font-size:10.5px;font-weight:bold;color:${g.c};min-width:68px;padding-top:2px;flex-shrink:0">${esc(g.g)}:</span>
                                    <div style="display:flex;gap:3px;flex-wrap:wrap;flex:1">${g.t.map(t => `<button class="cw-chip cw-base-chip" data-tag="${esc(t.t)}" type="button">${esc(t.n)}</button>`).join('')}</div>
                                </div>`).join('')}
                            </div>
                            <textarea id="cw-ce-base" class="cw-ta" placeholder="girl, japanese, delicate_face, black_hair, red_eyes, large_breasts, fair_skin">${esc(draft.baseTags)}</textarea>
                        </div>

                        <!-- Wardrobe -->
                        <div class="cw-card">
                            <div class="cw-card-hd">
                                <span class="cw-card-tt" style="color:#ffb86c"><i class="fa-solid fa-shirt"></i> 差分衣柜 (${draft.wardrobe.length} 套)</span>
                                <div style="display:flex;gap:5px">
                                    <button class="cw-btn am sm" id="cw-ce-wb-outfit" type="button"><i class="fa-solid fa-book-open"></i> 从世界书选服装</button>
                                    <button class="cw-btn gn sm" id="cw-ce-add-w" type="button"><i class="fa-solid fa-plus"></i> 新增服装</button>
                                </div>
                            </div>
                            <div class="cw-tabs" style="overflow-x:auto">
                                ${draft.wardrobe.map((w, i) => {
                                    const isWorn = (draft.currentOutfitId ? w.id === draft.currentOutfitId : (w.outfit && w.outfit === draft.currentOutfit));
                                    return `<button class="cw-tab cw-w-tab ${activeWIdx === i ? 'on' : ''}" data-wi="${i}">👗 ${esc(w.name || '套件' + (i + 1))} ${isWorn ? '<span style="color:#4ade80;font-size:10px;margin-left:2px">●穿</span>' : ''}</button>`;
                                }).join('')}
                            </div>
                            <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
                                <input id="cw-ce-wname" class="cw-in" type="text" placeholder="服装名称" value="${esc(cw?.name || '')}" style="width:160px;flex-shrink:0" />
                                ${isCurrentlyWorn ? '<button class="cw-btn gn sm" type="button" disabled style="opacity:0.9"><i class="fa-solid fa-check"></i> ✨ 正在穿着</button>' : '<button class="cw-btn cy sm" id="cw-ce-set-active" type="button"><i class="fa-solid fa-shirt"></i> 设为当前穿着</button>'}
                                <div style="display:flex;gap:3px;flex-wrap:wrap;flex:1;overflow-x:auto">${OUTFIT_PRESETS.slice(0, 7).map(o => `<button class="cw-chip cw-outfit-chip" data-tag="${esc(o.t)}" type="button">${esc(o.n)}</button>`).join('')}</div>
                                ${draft.wardrobe.length > 1 ? '<button class="cw-btn rd sm" id="cw-ce-del-w" type="button">✕ 删除此套</button>' : ''}
                            </div>
                            <textarea id="cw-ce-wtags" class="cw-ta" placeholder="sailor_suit, pleated_skirt, white_thighhighs">${esc(cw?.outfit || cw?.tags || '')}</textarea>
                        </div>
                    </div>
                    <div class="cw-modal-ft">
                        <button class="cw-btn cy" id="cw-ce-test" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> 🎨 测试单人立绘</button>
                        <div style="display:flex;gap:7px">
                            <button class="cw-btn" id="cw-ce-cancel">取消</button>
                            <button class="cw-btn pri" id="cw-ce-save">💾 保存到 SDT 角色记忆</button>
                        </div>
                    </div>
                </div>`;

            const syncChips = () => {
                const base = (mask.querySelector('#cw-ce-base')?.value || '').toLowerCase();
                mask.querySelectorAll('.cw-base-chip').forEach(b => {
                    const tags = (b.dataset.tag || '').toLowerCase().split(',').map(s => s.trim());
                    b.classList.toggle('on', tags.length > 0 && tags.every(t => base.includes(t)));
                });
            };

            mask.querySelector('#cw-ce-x')?.addEventListener('click', () => mask.remove());
            mask.querySelector('#cw-ce-cancel')?.addEventListener('click', () => mask.remove());

            mask.querySelector('#cw-ce-name')?.addEventListener('input', e => { draft.displayName = e.target.value.trim(); });
            mask.querySelector('#cw-ce-avatar-url')?.addEventListener('input', e => {
                draft.avatarUrl = e.target.value.trim();
                const ab = mask.querySelector('#cw-ce-avatar-box');
                if (ab) ab.innerHTML = draft.avatarUrl ? `<img src="${esc(draft.avatarUrl)}"/>` : '👤';
            });
            mask.querySelector('#cw-ce-base')?.addEventListener('input', e => { draft.baseTags = e.target.value; syncChips(); });

            mask.querySelectorAll('.cw-base-chip').forEach(b => b.addEventListener('click', () => {
                const el = mask.querySelector('#cw-ce-base');
                if (el) { el.value = toggleTag(el.value, b.dataset.tag); draft.baseTags = el.value; syncChips(); }
            }));

            // Wardrobe tabs
            mask.querySelectorAll('.cw-w-tab').forEach(b => b.addEventListener('click', () => {
                const wn = mask.querySelector('#cw-ce-wname');
                const wt = mask.querySelector('#cw-ce-wtags');
                if (draft.wardrobe[activeWIdx]) {
                    if (wn) draft.wardrobe[activeWIdx].name = wn.value;
                    if (wt) draft.wardrobe[activeWIdx].outfit = wt.value;
                }
                activeWIdx = +b.dataset.wi;
                render();
            }));
            mask.querySelector('#cw-ce-add-w')?.addEventListener('click', () => {
                draft.wardrobe.push({ id: uid('w'), name: '服装 ' + (draft.wardrobe.length + 1), outfit: '', triggers: [], createdAt: Date.now() });
                activeWIdx = draft.wardrobe.length - 1;
                render();
            });
            mask.querySelector('#cw-ce-del-w')?.addEventListener('click', () => {
                if (draft.wardrobe.length > 1) { draft.wardrobe.splice(activeWIdx, 1); activeWIdx = Math.max(0, activeWIdx - 1); render(); }
            });
            mask.querySelector('#cw-ce-wname')?.addEventListener('input', e => { if (draft.wardrobe[activeWIdx]) draft.wardrobe[activeWIdx].name = e.target.value; });
            mask.querySelector('#cw-ce-wtags')?.addEventListener('input', e => { if (draft.wardrobe[activeWIdx]) draft.wardrobe[activeWIdx].outfit = e.target.value; });

            // Set Active Outfit
            mask.querySelector('#cw-ce-set-active')?.addEventListener('click', () => {
                const wn = mask.querySelector('#cw-ce-wname');
                const wt = mask.querySelector('#cw-ce-wtags');
                if (draft.wardrobe[activeWIdx]) {
                    if (wn) draft.wardrobe[activeWIdx].name = wn.value;
                    if (wt) draft.wardrobe[activeWIdx].outfit = wt.value;
                }
                const curW = draft.wardrobe[activeWIdx];
                draft.currentOutfitId = curW.id;
                draft.currentOutfit = curW.outfit || curW.tags || '';
                render();
                toastr.success(`已将「${curW.name || '此套服装'}」设为当前穿着！`, PLUGIN_NAME);
            });

            mask.querySelectorAll('.cw-outfit-chip').forEach(b => b.addEventListener('click', () => {
                const el = mask.querySelector('#cw-ce-wtags');
                if (el && draft.wardrobe[activeWIdx]) { el.value = toggleTag(el.value, b.dataset.tag); draft.wardrobe[activeWIdx].outfit = el.value; }
            }));

            // Worldbook pick for base
            mask.querySelector('#cw-ce-wb-base')?.addEventListener('click', () => {
                openWorldbookPicker('挑选外貌特征词条', tags => {
                    const el = mask.querySelector('#cw-ce-base');
                    if (el) { el.value = [el.value, tags].filter(Boolean).join(', '); draft.baseTags = el.value; syncChips(); }
                }, 'appearance');
            });
            // Worldbook pick for outfit
            mask.querySelector('#cw-ce-wb-outfit')?.addEventListener('click', () => {
                openWorldbookPicker('挑选服装词条', tags => {
                    const el = mask.querySelector('#cw-ce-wtags');
                    if (el && draft.wardrobe[activeWIdx]) { el.value = tags; draft.wardrobe[activeWIdx].outfit = tags; }
                }, 'outfit');
            });

            // Import from SillyTavern character card (Full 7D extraction)
            mask.querySelector('#cw-ce-import-card')?.addEventListener('click', async (ev) => {
                const btn = ev.currentTarget;
                const origHtml = btn.innerHTML;
                try {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在提取...';
                    
                    if (typeof RBQ?.api?.importCharacterFromCurrentCard === 'function') {
                        await RBQ.api.importCharacterFromCurrentCard();
                        const ctx = window.RBQ?.api?.getContext?.() || window.SillyTavern?.getContext?.();
                        const cid = ctx?.characterId;
                        const cd = ctx?.characters?.[cid];
                        const charName = cd?.name;
                        if (charName) {
                            const updated = getProfile(charName);
                            if (updated) {
                                draft.displayName = updated.displayName || charName;
                                draft.baseTags = updated.baseTags || draft.baseTags;
                                draft.currentOutfit = updated.currentOutfit || draft.currentOutfit;
                                draft.currentOutfitId = updated.currentOutfitId || draft.currentOutfitId;
                                draft.avatarUrl = updated.avatarUrl || draft.avatarUrl;
                                draft.wardrobe = JSON.parse(JSON.stringify(updated.wardrobe || draft.wardrobe));
                            }
                        }
                    } else {
                        const ctx = window.RBQ?.api?.getContext?.() || window.SillyTavern?.getContext?.();
                        const cid = ctx?.characterId;
                        const cd = ctx?.characters?.[cid];
                        if (!cd) return toastr.warning('未检测到当前角色卡', PLUGIN_NAME);
                        draft.displayName = cd.name || draft.displayName;
                        draft.avatarUrl = cd.avatar ? '/characters/' + cd.avatar : draft.avatarUrl;
                        toastr.success('已导入「' + draft.displayName + '」基础信息', PLUGIN_NAME);
                    }
                    render();
                } catch (e) {
                    toastr.error('导入失败: ' + e.message, PLUGIN_NAME);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                }
            });

            // Test solo portrait with Perspective Selector Modal & Multi-Tab Gallery
            mask.querySelector('#cw-ce-test')?.addEventListener('click', (ev) => {
                const btn = ev.currentTarget;
                const name = draft.displayName || 'Character';
                const outfit = draft.wardrobe[activeWIdx]?.outfit || draft.wardrobe[activeWIdx]?.tags || '';
                if (!draft.baseTags && !outfit) {
                    return toastr.warning('请先输入角色的固有外貌或服装 Tags', PLUGIN_NAME);
                }

                openPortraitTestModal(name, draft.baseTags, outfit, (newAvatarUrl) => {
                    draft.avatarUrl = newAvatarUrl;
                    const urlEl = mask.querySelector('#cw-ce-avatar-url');
                    if (urlEl) urlEl.value = newAvatarUrl;
                    const ab = mask.querySelector('#cw-ce-avatar-box');
                    if (ab) ab.innerHTML = `<img src="${esc(newAvatarUrl)}"/>`;
                }, btn);
            });

            // Save — write directly to SDT profiles
            mask.querySelector('#cw-ce-save')?.addEventListener('click', () => {
                const wn = mask.querySelector('#cw-ce-wname');
                const wt = mask.querySelector('#cw-ce-wtags');
                if (draft.wardrobe[activeWIdx]) {
                    if (wn) draft.wardrobe[activeWIdx].name = wn.value;
                    if (wt) draft.wardrobe[activeWIdx].outfit = wt.value;
                }

                const name = draft.displayName;
                if (!name) return toastr.warning('请输入角色姓名', PLUGIN_NAME);

                if (isEdit && editName !== name) deleteProfile(editName);

                const activeW = draft.wardrobe.find(w => w.id === draft.currentOutfitId) || draft.wardrobe[0];
                draft.currentOutfit = activeW?.outfit || activeW?.tags || '';
                draft.currentOutfitId = activeW?.id || '';

                saveProfile(name, {
                    displayName: name,
                    baseTags: draft.baseTags,
                    currentOutfit: draft.currentOutfit,
                    currentOutfitId: draft.currentOutfitId,
                    avatarUrl: draft.avatarUrl,
                    wardrobe: draft.wardrobe,
                });
                toastr.success('「' + name + '」已保存到 SDT 角色记忆！', PLUGIN_NAME);
                mask.remove();
                if (onSaved) onSaved(name);
            });

            syncChips();
        }
        render();
        document.body.appendChild(mask);
    }

    // ══════════════════════════════════════════════════════════
    //  Tab 1: 角色档案库 (Dossier)
    // ══════════════════════════════════════════════════════════
    function renderDossierTab() {
        const chatProfiles = getCurrentChatProfiles();
        const globalProfiles = getAllGlobalProfiles();
        const chatCount = Object.keys(chatProfiles).length;
        const allCount = Object.keys(globalProfiles).length;

        const profiles = getAllProfiles();
        const names = Object.keys(profiles);

        return `<div class="cw-body">
            <div class="cw-card">
                <div class="cw-card-hd" style="flex-wrap:wrap;gap:8px">
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                        <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-users"></i> SDT 角色档案库 (${names.length} 位)</span>
                        <div style="display:inline-flex;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:2px;gap:2px">
                            <button type="button" class="cw-btn xs cw-scope-btn ${dossierScope === 'chat' ? 'cy' : ''}" data-scope="chat" style="padding:2px 8px;font-size:11px"><i class="fa-solid fa-comments"></i> 当前会话 (${chatCount})</button>
                            <button type="button" class="cw-btn xs cw-scope-btn ${dossierScope === 'all' ? 'cy' : ''}" data-scope="all" style="padding:2px 8px;font-size:11px"><i class="fa-solid fa-globe"></i> 全局历史 (${allCount})</button>
                        </div>
                    </div>
                    <button class="cw-btn gn sm" id="cw-create-char"><i class="fa-solid fa-plus"></i> 新建角色档案</button>
                </div>
                <div class="cw-chgrid">
                    ${names.length === 0 ? `
                        <div style="text-align:center;padding:36px 20px;grid-column:1/-1;opacity:.7;display:flex;flex-direction:column;align-items:center;gap:10px">
                            <div><i class="fa-solid fa-user-slash" style="font-size:28px;opacity:0.4"></i></div>
                            <div>${dossierScope === 'chat' ? `当前会话暂无角色档案记忆。${allCount > 0 ? `全局历史库中有 ${allCount} 位角色，点击上方「全局历史」可直接查看与选用！` : ''}` : '暂无任何角色档案，点击右上角「新建角色档案」开始！'}</div>
                        </div>` : names.map(n => {
                        const p = profiles[n];
                        const wCount = Array.isArray(p.wardrobe) ? p.wardrobe.length : 0;
                        const activeW = Array.isArray(p.wardrobe) ? (p.wardrobe.find(w => w.id === p.currentOutfitId) || p.wardrobe[0]) : null;
                        const activeOutfitName = activeW?.name || '默认';

                        return `<div class="cw-chcard">
                            <div style="display:flex;gap:10px;align-items:flex-start">
                                <div class="cw-avatar">${p.avatarUrl ? '<img src="' + esc(p.avatarUrl) + '"/>' : '👤'}</div>
                                <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:2px">
                                    <span style="font-size:13px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.displayName || n)}</span>
                                    <span style="font-size:11px;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.baseTags)}"><span style="color:#79e4ff">外貌:</span> ${esc(p.baseTags || '未设置')}</span>
                                    <span style="font-size:10.5px;color:#ffb86c">👗 当前: <strong>${esc(activeOutfitName)}</strong> <span style="opacity:0.6">(${wCount}套)</span></span>
                                </div>
                            </div>
                            <div style="display:flex;gap:5px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap">
                                <button class="cw-btn sm cw-test-dossier-char" data-name="${esc(n)}" title="测试该角色立绘"><i class="fa-solid fa-wand-magic-sparkles"></i> 测试</button>
                                <button class="cw-btn cy sm cw-send-to-stage" data-name="${esc(n)}" title="将该角色放入空间舞台"><i class="fa-solid fa-chess-board"></i> 放入舞台</button>
                                <button class="cw-btn sm cw-edit-char" data-name="${esc(n)}"><i class="fa-solid fa-pen-to-square"></i> 编辑</button>
                                <button class="cw-btn rd sm cw-del-char" data-name="${esc(n)}"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    //  Tab 2: 多角色空间舞台 (Stage & Composer)
    // ══════════════════════════════════════════════════════════
    function renderComposerTab() {
        const ws = getWs();
        const comp = ws.activeComposer;
        const slots = comp.slots || [];
        const ai = Math.min(slots.length - 1, Math.max(0, comp.activeSlotIndex || 0));

        const chatProfiles = getCurrentChatProfiles();
        const globalProfiles = getAllGlobalProfiles();
        const chatNames = Object.keys(chatProfiles);
        const globalOnlyNames = Object.keys(globalProfiles).filter(n => !chatProfiles[n]);

        const useCoords = comp.useCoords === true;
        const finalPrompt = composeFinalPrompt(comp);
        const mccOn = isMccEnabled();

        return `<div class="cw-body">
            ${!mccOn ? '<div class="cw-warn"><i class="fa-solid fa-triangle-exclamation"></i> 提示：多角色合成插件 (Multi-Char) 未启用，生成的图片可能无法正确按空间位置分区。</div>' : ''}

            <!-- Spatial Stage / Scene Settings -->
            <div class="cw-card">
                <div class="cw-card-hd" style="flex-wrap:wrap;gap:8px">
                    <div>
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                            <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-chess-board"></i> 空间舞台布局</span>
                            <label style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;cursor:pointer;background:rgba(255,255,255,0.06);padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);user-select:none" title="关闭后由 AI 自主决定角色在画面中的构图站位，网格收起；开启后按 5×5 网格死板固定坐标">
                                <input type="checkbox" id="cw-toggle-coords" ${useCoords ? 'checked' : ''} style="margin:0;cursor:pointer" />
                                <span style="color:${useCoords ? '#38bdf8' : 'rgba(255,255,255,0.7)'};font-weight:${useCoords ? 'bold' : 'normal'}">
                                    <i class="fa-solid fa-crosshairs"></i> 5×5 严格坐标定位
                                </span>
                            </label>
                        </div>
                        <div style="font-size:11px;opacity:.65;margin-top:3px">
                            ${useCoords ? `当前状态: 🎯 严格坐标定位已开启 (控制 Char ${ai + 1}: ${esc(slots[ai]?.charName || '未绑定')} · ${coordLabel(slots[ai]?.center)})` : `当前状态: 🤖 由 AI 自行决定站位构图 (更自然自洽，网格已收起)`}
                        </div>
                    </div>
                    <button class="cw-btn cy sm" id="cw-pick-scene-wb" type="button"><i class="fa-solid fa-mountain-sun"></i> 搜索世界书场景</button>
                </div>
                <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
                    ${useCoords ? `
                    <!-- 5x5 Grid (仅在开启严格定位时展开) -->
                    <div class="cw-grid5" id="cw-stage">
                        ${ROWS.map(r => COLS.map(c => {
                            const coord = c + r;
                            const charsHere = slots.map((s, i) => ({ ...s, si: i })).filter(s => (s.center || 'C3').toUpperCase() === coord);
                            return `<div class="cw-cell ${charsHere.length ? 'has' : ''}" data-coord="${coord}">
                                <span>${coord}</span>
                                ${charsHere.map(s => `<div class="cw-pin" data-si="${s.si}" style="background:${COLORS[s.si % COLORS.length].hex}; border: 2px solid ${ai === s.si ? '#fff' : 'rgba(0,0,0,0.5)'}; transform: ${ai === s.si ? 'scale(1.25)' : 'scale(1)'}" title="点击选中 Char ${s.si + 1}: ${esc(s.charName || '未绑定')} (${coord})">${s.si + 1}</div>`).join('')}
                            </div>`;
                        }).join('')).join('')}
                    </div>` : ''}

                    <!-- Stage Controls & Scene Inputs -->
                    <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:7px;font-size:12px;color:rgba(255,255,255,.75)">
                        <div style="display:flex;gap:5px;flex-wrap:wrap">
                            ${slots.map((s, i) => {
                                const cl = COLORS[i % COLORS.length];
                                const isAct = ai === i;
                                const posTag = useCoords ? ` (${s.center || 'C3'})` : '';
                                return `<div class="cw-chip cw-switch-slot ${isAct ? 'on' : ''}" data-idx="${i}" style="border-color:${isAct ? cl.bdr : 'transparent'}; background:${isAct ? cl.bg : 'rgba(255,255,255,0.04)'}; color:${isAct ? cl.hex : 'inherit'}">● Char ${i + 1}: ${esc(s.charName || '未绑定')}${posTag}</div>`;
                            }).join('')}
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:2px">
                            <div>
                                <label style="font-size:11px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:2px">场景环境 (Scene):</label>
                                <input id="cw-scene" class="cw-in" type="text" placeholder="indoors, living room, soft lighting..." value="${esc(comp.scene || '')}" />
                            </div>
                            <div>
                                <label style="font-size:11px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:2px">视角与光影 (Camera):</label>
                                <input id="cw-camera" class="cw-in" type="text" placeholder="from_side, depth_of_field..." value="${esc(comp.camera || '')}" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Character Slots List -->
            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#4ade80"><i class="fa-solid fa-users-viewfinder"></i> 角色槽位编排 (${slots.length} 人)</span>
                    <button class="cw-btn gn sm" id="cw-add-slot" type="button"><i class="fa-solid fa-user-plus"></i> 添加角色槽位</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:10px">
                    ${slots.map((slot, i) => {
                        const cl = COLORS[i % COLORS.length];
                        const isActive = ai === i;
                        const prof = slot.charName ? (getProfile(slot.charName) || globalProfiles[slot.charName]) : null;
                        const wardrobe = prof?.wardrobe || [];
                        const curPos = (slot.center || (i === 0 ? 'B3' : (i === 1 ? 'D3' : 'C3'))).toUpperCase();

                        return `<div class="cw-slot ${isActive ? 'on' : ''}" data-idx="${i}">
                            <div class="cw-slot-top">
                                <div style="display:flex;align-items:center;gap:7px">
                                    <span class="cw-badge" style="background:${cl.bg};color:${cl.hex}">Char ${i + 1}</span>
                                    <strong style="font-size:12.5px;color:#f8fafc">${esc(prof?.displayName || slot.charName || '未绑定角色')}</strong>
                                    <span style="font-size:10.5px;opacity:.65">${useCoords ? `[位置: ${coordLabel(curPos)}]` : '[站位: 由 AI 决定]'}</span>
                                </div>
                                <div style="display:flex;gap:5px">
                                    <button class="cw-btn cy sm cw-activate-slot" data-idx="${i}" type="button">🎯 设为控制</button>
                                    ${slots.length > 1 ? `<button class="cw-btn rd sm cw-rm-slot" data-idx="${i}" type="button">✕ 移除</button>` : ''}
                                </div>
                            </div>
                            <div class="cw-slot-grid">
                                <div>
                                    <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:2px">绑定角色档案:</label>
                                    <select class="cw-sel cw-slot-char" data-idx="${i}">
                                        <option value="">👤 [自定义 / 未建档角色]</option>
                                        ${chatNames.length > 0 ? `
                                            <optgroup label="💬 当前会话角色 (${chatNames.length} 位)">
                                                ${chatNames.map(n => `<option value="${esc(n)}" ${slot.charName === n ? 'selected' : ''}>👤 ${esc(chatProfiles[n]?.displayName || n)}</option>`).join('')}
                                            </optgroup>
                                        ` : ''}
                                        ${globalOnlyNames.length > 0 ? `
                                            <optgroup label="🌐 全局历史档案 (${globalOnlyNames.length} 位)">
                                                ${globalOnlyNames.map(n => `<option value="${esc(n)}" ${slot.charName === n ? 'selected' : ''}>👤 ${esc(globalProfiles[n]?.displayName || n)}</option>`).join('')}
                                            </optgroup>
                                        ` : ''}
                                    </select>
                                </div>
                                <div>
                                    <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:2px">服装套件 (Wardrobe):</label>
                                    <select class="cw-sel cw-slot-outfit" data-idx="${i}">
                                        <option value="" ${!slot.outfitId && !slot.customOutfit ? 'selected' : ''}>👗 默认服装</option>
                                        ${wardrobe.map(w => `<option value="${esc(w.id)}" ${slot.outfitId === w.id ? 'selected' : ''}>👗 ${esc(w.name)}</option>`).join('')}
                                        <option value="__custom" ${slot.customOutfit ? 'selected' : ''}>✍️ 自定义服装</option>
                                    </select>
                                </div>
                                <div style="grid-column:1/-1">
                                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                                        <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1">当前动作/姿态 (Action):</label>
                                        <button class="cw-btn cy sm cw-pick-action-wb" data-idx="${i}" type="button"><i class="fa-solid fa-book-open"></i> 选动作</button>
                                    </div>
                                    <input class="cw-in cw-slot-action" data-idx="${i}" type="text" placeholder="sitting, facing_another, looking_at_partner..." value="${esc(slot.action || '')}" />
                                </div>
                                <div style="grid-column:1/-1">
                                    <label style="font-size:10.5px;font-weight:bold;color:#f87171;margin-bottom:2px;display:block">角色独立负面词 (Char UC):</label>
                                    <input class="cw-in cw-slot-uc" data-idx="${i}" type="text" placeholder="可选：针对该角色的独立负面词 (如 penis, futanari...)" value="${esc(slot.uc || '')}" />
                                </div>
                                ${useCoords ? `
                                <div style="grid-column:1/-1;display:flex;align-items:center;gap:6px;margin-top:2px">
                                    <span style="font-size:10.5px;font-weight:bold;color:#cbd5e1;white-space:nowrap">快捷站位:</span>
                                    <div style="display:flex;gap:4px;flex-wrap:wrap">
                                        ${['A3', 'B3', 'C3', 'D3', 'E3', 'C2', 'C4'].map(p => `
                                            <button class="cw-chip cw-slot-quick-pos ${curPos === p ? 'on' : ''}" data-idx="${i}" data-pos="${p}" type="button">${p}</button>
                                        `).join('')}
                                    </div>
                                </div>` : ''}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <!-- Live Prompt Preview & Generate -->
            <div class="cw-preview">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-terminal"></i> 多角色合成提示词实时预览 (NAI V4.5)</span>
                    <div style="display:flex;gap:5px">
                        <button class="cw-btn sm" id="cw-copy-prompt"><i class="fa-regular fa-copy"></i> 复制提示词</button>
                        <button class="cw-btn am sm" id="cw-save-preset"><i class="fa-solid fa-floppy-disk"></i> 保存为预设</button>
                    </div>
                </div>
                <div class="cw-code" id="cw-prompt-preview">${esc(finalPrompt)}</div>
                <div style="display:flex;justify-content:flex-end;margin-top:4px">
                    <button class="cw-btn pri" id="cw-generate" style="padding:7px 20px;font-size:13px;font-weight:bold">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 🚀 立即合成并生图
                    </button>
                </div>
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    //  Tab 3: 分镜模板与预设 (Presets)
    // ══════════════════════════════════════════════════════════
    function renderPresetsTab() {
        const ws = getWs();
        const userPresets = ws.presets;

        return `<div class="cw-body">
            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-sparkles"></i> 经典分镜模板库 (一键载入空间舞台)</span>
                </div>
                <div class="cw-chgrid">
                    ${TEMPLATES.map((t, i) => `<div class="cw-chcard" style="border-color:rgba(56,189,248,.2)">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start">
                            <strong style="font-size:12.5px;color:#38bdf8">${esc(t.name)}</strong>
                            <span class="cw-badge" style="background:rgba(56,189,248,.15);color:#38bdf8">${t.slots.length} 人</span>
                        </div>
                        <div style="font-size:11px;opacity:.7;line-height:1.4">${esc(t.desc)}</div>
                        <div style="display:flex;justify-content:flex-end;margin-top:4px">
                            <button class="cw-btn gn sm cw-load-tpl" data-idx="${i}"><i class="fa-solid fa-download"></i> 载入舞台</button>
                        </div>
                    </div>`).join('')}
                </div>
            </div>

            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#fbbf24"><i class="fa-solid fa-bookmark"></i> 我的自定义预设 (${userPresets.length})</span>
                </div>
                <div class="cw-chgrid">
                    ${userPresets.length === 0 ? '<div style="text-align:center;padding:30px;grid-column:1/-1;opacity:.6">暂无自定义预设。在多角色舞台排布好后，点击「保存为预设」即可存入此处！</div>' : userPresets.map((p, i) => `<div class="cw-chcard">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start">
                            <strong style="font-size:12.5px;color:#f8fafc">${esc(p.name)}</strong>
                            <span class="cw-badge" style="background:rgba(251,191,36,.15);color:#fbbf24">${p.slots?.length || 0} 人</span>
                        </div>
                        <div style="font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.scene || '无场景描述')}</div>
                        <div style="display:flex;gap:5px;justify-content:flex-end;margin-top:4px">
                            <button class="cw-btn gn sm cw-load-preset" data-idx="${i}"><i class="fa-solid fa-download"></i> 载入</button>
                            <button class="cw-btn rd sm cw-del-preset" data-idx="${i}"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>`).join('')}
                </div>
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    //  Main Shell & Event Binding
    // ══════════════════════════════════════════════════════════
    let activeTab = 'dossier';

    function renderMain(tab) {
        activeTab = tab || activeTab;
        const profiles = getAllProfiles();
        const pCount = Object.keys(profiles).length;
        const presetCount = getWs().presets.length;

        return `<div class="cw-wrap">
            <div class="cw-hdr">
                <div class="cw-logo"><i class="fa-solid fa-palette"></i> 角色工坊 2.0</div>
                <div class="cw-tabs">
                    <button class="cw-tab cw-main-tab ${activeTab === 'dossier' ? 'on' : ''}" data-tab="dossier"><i class="fa-solid fa-users"></i> 角色档案库 (${pCount})</button>
                    <button class="cw-tab cw-main-tab ${activeTab === 'composer' ? 'on' : ''}" data-tab="composer"><i class="fa-solid fa-chess-board"></i> 多角色空间舞台</button>
                    <button class="cw-tab cw-main-tab ${activeTab === 'presets' ? 'on' : ''}" data-tab="presets"><i class="fa-solid fa-bookmark"></i> 分镜模板与预设 (${presetCount})</button>
                </div>
            </div>
            <div id="cw-tab-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
                ${activeTab === 'dossier' ? renderDossierTab() : ''}
                ${activeTab === 'composer' ? renderComposerTab() : ''}
                ${activeTab === 'presets' ? renderPresetsTab() : ''}
            </div>
        </div>`;
    }

    function bindEvents(container, refresh) {
        const ws = getWs();
        const comp = ws.activeComposer;

        // Tab navigation
        container.querySelectorAll('.cw-main-tab').forEach(b => b.addEventListener('click', () => refresh(b.dataset.tab)));

        // ── Composer Events ──
        container.querySelector('#cw-toggle-coords')?.addEventListener('change', (e) => {
            comp.useCoords = !!e.target.checked;
            const s = RBQ.api.getSettings();
            if (!s[MCC_KEY]) s[MCC_KEY] = {};
            s[MCC_KEY].useCoords = comp.useCoords;
            wsSave();
            toastr.info(comp.useCoords ? '5×5 严格坐标定位已开启，网格已展开' : '严格坐标定位已关闭，角色站位将由 AI 自主决定', PLUGIN_NAME);
            refresh('composer');
        });

        // 5x5 pin click (switch to that slot, stop propagation)
        container.querySelectorAll('.cw-pin').forEach(pin => pin.addEventListener('click', (e) => {
            e.stopPropagation();
            comp.activeSlotIndex = +pin.dataset.si;
            wsSave();
            refresh('composer');
        }));

        // 5x5 grid click (cell moves active slot)
        container.querySelectorAll('.cw-cell').forEach(cell => cell.addEventListener('click', () => {
            const ai = comp.activeSlotIndex || 0;
            if (comp.slots[ai]) { comp.slots[ai].center = cell.dataset.coord; wsSave(); refresh('composer'); }
        }));

        // Switch active slot
        container.querySelectorAll('.cw-switch-slot, .cw-activate-slot').forEach(b => b.addEventListener('click', () => {
            comp.activeSlotIndex = +b.dataset.idx;
            wsSave();
            refresh('composer');
        }));

        // Quick position buttons on slot cards
        container.querySelectorAll('.cw-slot-quick-pos').forEach(b => b.addEventListener('click', () => {
            const idx = +b.dataset.idx;
            const pos = b.dataset.pos;
            if (comp.slots[idx]) { comp.slots[idx].center = pos; wsSave(); refresh('composer'); }
        }));

        // Add slot
        container.querySelector('#cw-add-slot')?.addEventListener('click', () => {
            const usedCoords = new Set(comp.slots.map(s => (s.center || '').toUpperCase()));
            const candidateCoords = ['B3', 'D3', 'C3', 'A3', 'E3', 'B2', 'D2', 'C4'];
            const nextCoord = candidateCoords.find(c => !usedCoords.has(c)) || 'C3';
            comp.slots.push({ charName: '', outfitId: '', customOutfit: '', action: '', uc: '', center: nextCoord });
            comp.activeSlotIndex = comp.slots.length - 1;
            wsSave();
            refresh('composer');
        });

        // Remove slot
        container.querySelectorAll('.cw-rm-slot').forEach(b => b.addEventListener('click', () => {
            const idx = +b.dataset.idx;
            if (comp.slots.length > 1) {
                comp.slots.splice(idx, 1);
                comp.activeSlotIndex = Math.max(0, comp.activeSlotIndex - 1);
                wsSave();
                refresh('composer');
            }
        }));

        // Slot char select
        container.querySelectorAll('.cw-slot-char').forEach(sel => sel.addEventListener('change', () => {
            const idx = +sel.dataset.idx;
            if (comp.slots[idx]) {
                comp.slots[idx].charName = sel.value;
                comp.slots[idx].outfitId = '';
                wsSave();
                refresh('composer');
            }
        }));

        // Slot outfit select
        container.querySelectorAll('.cw-slot-outfit').forEach(sel => sel.addEventListener('change', () => {
            const idx = +sel.dataset.idx;
            if (comp.slots[idx]) {
                if (sel.value === '__custom') {
                    const custom = prompt('请输入该角色的自定义服装 Prompt:');
                    comp.slots[idx].customOutfit = custom || '';
                    comp.slots[idx].outfitId = '';
                } else {
                    comp.slots[idx].outfitId = sel.value;
                    comp.slots[idx].customOutfit = '';
                }
                wsSave();
                refresh('composer');
            }
        }));

        // Slot action & UC inputs
        const updatePromptPreview = () => {
            const el = container.querySelector('#cw-prompt-preview');
            if (el) el.textContent = composeFinalPrompt(comp);
        };
        container.querySelectorAll('.cw-slot-action').forEach(inEl => inEl.addEventListener('input', () => {
            const idx = +inEl.dataset.idx;
            if (comp.slots[idx]) { comp.slots[idx].action = inEl.value; wsSave(); updatePromptPreview(); }
        }));
        container.querySelectorAll('.cw-slot-uc').forEach(inEl => inEl.addEventListener('input', () => {
            const idx = +inEl.dataset.idx;
            if (comp.slots[idx]) { comp.slots[idx].uc = inEl.value; wsSave(); updatePromptPreview(); }
        }));

        // Worldbook pickers in Composer
        container.querySelector('#cw-pick-scene-wb')?.addEventListener('click', () => {
            openWorldbookPicker('挑选场景词条', tags => {
                const el = container.querySelector('#cw-scene');
                if (el) {
                    el.value = [el.value, tags].filter(Boolean).join(', ');
                    comp.scene = el.value;
                    wsSave();
                    updatePromptPreview();
                }
            }, 'scene');
        });

        container.querySelectorAll('.cw-pick-action-wb').forEach(b => b.addEventListener('click', () => {
            const idx = +b.dataset.idx;
            openWorldbookPicker('挑选动作/姿态词条', tags => {
                const el = container.querySelector(`.cw-slot-action[data-idx="${idx}"]`);
                if (el && comp.slots[idx]) {
                    el.value = [el.value, tags].filter(Boolean).join(', ');
                    comp.slots[idx].action = el.value;
                    wsSave();
                    updatePromptPreview();
                }
            }, 'pose');
        }));

        container.querySelector('#cw-scene')?.addEventListener('input', e => { comp.scene = e.target.value; wsSave(); updatePromptPreview(); });
        container.querySelector('#cw-camera')?.addEventListener('input', e => { comp.camera = e.target.value; wsSave(); updatePromptPreview(); });

        // Copy Prompt
        container.querySelector('#cw-copy-prompt')?.addEventListener('click', () => {
            const p = composeFinalPrompt(comp);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(p).then(() => toastr.success('已复制合成提示词', PLUGIN_NAME));
            }
        });

        // Save preset
        container.querySelector('#cw-save-preset')?.addEventListener('click', () => {
            const name = prompt('请输入该多角色分镜预设的名称：', '分镜预设 ' + new Date().toLocaleDateString());
            if (!name) return;
            ws.presets.push({
                id: uid('preset'),
                name,
                scene: comp.scene,
                camera: comp.camera,
                slots: JSON.parse(JSON.stringify(comp.slots))
            });
            wsSave();
            toastr.success(`预设「${name}」已保存！`, PLUGIN_NAME);
        });

        // One-Click Generate Image (With Progress & Popup Viewer!)
        container.querySelector('#cw-generate')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            const origHtml = btn.innerHTML;
            const p = composeFinalPrompt(comp);

            const s = RBQ.api.getSettings();
            if (!s[MCC_KEY]) s[MCC_KEY] = {};
            s[MCC_KEY].useCoords = comp.useCoords === true;
            RBQ.api.saveSettings();

            if (!isMccEnabled()) {
                toastr.warning('多角色合成插件未启用，生成的图片可能无法正确分配角色位置', PLUGIN_NAME);
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在生成多角色画作...';
            toastr.info('🚀 正在调用 RBQ 生图引擎生成多角色画作...', PLUGIN_NAME);

            try {
                const result = await RBQ.api.generateImage(p, 'cw-ensemble', {}, (progress) => {
                    if (typeof progress === 'string') btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${progress.slice(0, 12)}...`;
                });

                if (result && result.url) {
                    showGeneratedImageModal('多角色空间舞台合成画面', p, result);
                    toastr.success('🎉 多角色画面生成完毕！', PLUGIN_NAME);
                } else {
                    throw new Error('生图未返回有效图片地址');
                }
            } catch (e) {
                toastr.error('生图失败: ' + (e.message || e), PLUGIN_NAME);
            } finally {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        });

        // ── Dossier Events ──
        container.querySelectorAll('.cw-scope-btn').forEach(b => b.addEventListener('click', () => {
            const scope = b.dataset.scope;
            if (scope && (scope === 'chat' || scope === 'all')) {
                dossierScope = scope;
                refresh('dossier');
            }
        }));

        container.querySelector('#cw-create-char')?.addEventListener('click', () => openCharacterEditor(null, () => refresh('dossier')));

        container.querySelectorAll('.cw-test-dossier-char').forEach(b => b.addEventListener('click', (ev) => {
            try {
                const btn = ev.currentTarget;
                const charName = b.dataset.name;
                const p = getProfile(charName) || getAllProfiles()[charName];
                if (!p) {
                    toastr.warning(`未找到角色「${charName}」的档案数据`, PLUGIN_NAME);
                    return;
                }
                const activeW = Array.isArray(p.wardrobe) ? (p.wardrobe.find(w => w.id === p.currentOutfitId) || p.wardrobe[0]) : null;
                const outfit = activeW?.outfit || activeW?.tags || p.currentOutfit || '';
                openPortraitTestModal(p.displayName || charName, p.baseTags, outfit, (newAvatarUrl) => {
                    p.avatarUrl = newAvatarUrl;
                    saveProfile(charName, p);
                    refresh('dossier');
                }, btn);
            } catch (err) {
                console.error('[CW] 测试按钮点击出错:', err);
                toastr.error('启动测试失败: ' + (err.message || err), PLUGIN_NAME);
            }
        }));

        container.querySelectorAll('.cw-send-to-stage').forEach(b => b.addEventListener('click', () => {
            const charName = b.dataset.name;
            const slots = comp.slots;
            const emptySlot = slots.find(s => !s.charName);
            if (emptySlot) {
                emptySlot.charName = charName;
            } else {
                const usedCoords = new Set(slots.map(s => (s.center || '').toUpperCase()));
                const candidateCoords = ['B3', 'D3', 'C3', 'A3', 'E3', 'B2', 'D2', 'C4'];
                const nextCoord = candidateCoords.find(c => !usedCoords.has(c)) || 'C3';
                slots.push({ charName, outfitId: '', customOutfit: '', action: '', uc: '', center: nextCoord });
            }
            wsSave();
            toastr.success(`已将「${charName}」放入空间舞台！`, PLUGIN_NAME);
            refresh('composer');
        }));

        container.querySelectorAll('.cw-edit-char').forEach(b => b.addEventListener('click', () => {
            openCharacterEditor(b.dataset.name, () => refresh('dossier'));
        }));

        container.querySelectorAll('.cw-del-char').forEach(b => b.addEventListener('click', () => {
            if (confirm(`确定删除角色「${b.dataset.name}」的档案记忆吗？`)) {
                deleteProfile(b.dataset.name);
                toastr.info('已删除', PLUGIN_NAME);
                refresh('dossier');
            }
        }));

        // ── Presets Events ──
        container.querySelectorAll('.cw-load-tpl').forEach(b => b.addEventListener('click', () => {
            const tpl = TEMPLATES[+b.dataset.idx];
            if (!tpl) return;
            comp.scene = tpl.scene || '';
            comp.camera = tpl.camera || '';
            const newSlots = tpl.slots.map((ts, i) => {
                const existingChar = comp.slots[i]?.charName || '';
                const existingOutfit = comp.slots[i]?.outfitId || '';
                return {
                    charName: existingChar,
                    outfitId: existingOutfit,
                    customOutfit: '',
                    action: ts.action || '',
                    uc: ts.uc || '',
                    center: ts.center || 'C3'
                };
            });
            comp.slots = newSlots;
            comp.activeSlotIndex = 0;
            wsSave();
            toastr.success(`已载入分镜「${tpl.name}」到舞台（已保留绑定角色）`, PLUGIN_NAME);
            refresh('composer');
        }));

        container.querySelectorAll('.cw-load-preset').forEach(b => b.addEventListener('click', () => {
            const p = ws.presets[+b.dataset.idx];
            if (!p) return;
            comp.scene = p.scene || '';
            comp.camera = p.camera || '';
            comp.slots = JSON.parse(JSON.stringify(p.slots || []));
            comp.activeSlotIndex = 0;
            wsSave();
            toastr.success(`已载入预设「${p.name}」到舞台`, PLUGIN_NAME);
            refresh('composer');
        }));

        container.querySelectorAll('.cw-del-preset').forEach(b => b.addEventListener('click', () => {
            const idx = +b.dataset.idx;
            if (confirm('确定删除该预设吗？')) {
                ws.presets.splice(idx, 1);
                wsSave();
                toastr.info('已删除预设', PLUGIN_NAME);
                refresh('presets');
            }
        }));
    }

    // ══════════════════════════════════════════════════════════
    //  Panel Mount via RBQ.ui.addSettingPanel
    // ══════════════════════════════════════════════════════════
    function mount() {
        if (!RBQ.ui || typeof RBQ.ui.addSettingPanel !== 'function') {
            return console.warn('[CW] RBQ.ui.addSettingPanel not available');
        }

        let refreshMain = null;

        RBQ.ui.addSettingPanel('character-workshop', '<i class="fa-solid fa-palette"></i><span>角色工坊</span>', () => {
            const w = document.createElement('div');
            w.id = 'cw-root-container';
            w.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden';
            const refresh = (tab) => {
                w.innerHTML = renderMain(tab);
                bindEvents(w, refresh);
            };
            refreshMain = refresh;
            refresh(activeTab);

            // 监听面板可见性：每次进入面板时自动根据当前最新会话刷新角色列表
            if (typeof IntersectionObserver !== 'undefined') {
                let isFirst = true;
                const observer = new IntersectionObserver((entries) => {
                    for (const entry of entries) {
                        if (entry.isIntersecting) {
                            if (!isFirst) {
                                refresh(activeTab);
                            }
                            isFirst = false;
                        }
                    }
                }, { threshold: 0.05 });
                observer.observe(w);
            }

            return w;
        });

        // 监听进入角色工坊的各种入口
        const triggerRefresh = () => {
            if (typeof refreshMain === 'function') {
                setTimeout(() => refreshMain(activeTab), 30);
            }
        };

        document.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('[data-kite-tab="character-workshop"], #rbq-sdt-goto-workshop-btn')) {
                triggerRefresh();
            }
        });

        document.addEventListener('rbq-tab-switched', (e) => {
            if (e.detail?.tab === 'character-workshop') {
                triggerRefresh();
            }
        });
    }
    mount();
    console.info('[' + PLUGIN_NAME + '] v' + VERSION + ' loaded — Complete Character & Stage Engine');

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
