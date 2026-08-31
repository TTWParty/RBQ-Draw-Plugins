(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[Character Workshop] RBQ Core API missing');

    const PLUGIN_NAME = '角色工坊';
    const VERSION = '2.0.2';
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
        return String(s || '').replace(/;/g, ',').trim();
    }

    // ══════════════════════════════════════════════════════════
    //  Coordinate System & Slot Colors
    // ══════════════════════════════════════════════════════════
    const COLS = 'ABCDE'.split('');
    const ROWS = '12345'.split('');
    const COORD_LABELS = {
        A1: '左上远景', B1: '偏左远景', C1: '居中远景', D1: '偏右远景', E1: '右上远景',
        A2: '左上中景', B2: '偏左中景', C2: '居中中景', D2: '偏右中景', E2: '右上中景',
        A3: '左侧居中', B3: '偏左居中', C3: '画面正中', D3: '偏右居中', E3: '右侧居中',
        A4: '左下近景', B4: '偏左近景', C4: '居中近景', D4: '偏右近景', E4: '右下近景',
        A5: '左下特写', B5: '偏左特写', C5: '居中特写', D5: '偏右特写', E5: '右下特写',
    };
    function coordLabel(c) {
        const k = String(c || 'C3').toUpperCase().trim();
        return COORD_LABELS[k] ? `${k} · ${COORD_LABELS[k]}` : k;
    }
    const COLORS = [
        { hex: '#38bdf8', bg: 'rgba(56,189,248,0.18)', bdr: 'rgba(56,189,248,0.6)' },
        { hex: '#f472b6', bg: 'rgba(244,114,182,0.18)', bdr: 'rgba(244,114,182,0.6)' },
        { hex: '#4ade80', bg: 'rgba(74,222,128,0.18)', bdr: 'rgba(74,222,128,0.6)' },
        { hex: '#fbbf24', bg: 'rgba(251,191,36,0.18)', bdr: 'rgba(251,191,36,0.6)' },
        { hex: '#c084fc', bg: 'rgba(192,132,252,0.18)', bdr: 'rgba(192,132,252,0.6)' },
        { hex: '#fb7185', bg: 'rgba(251,113,133,0.18)', bdr: 'rgba(251,113,133,0.6)' },
    ];

    // ══════════════════════════════════════════════════════════
    //  SDT Data Access Layer — Single Source of Truth
    //  角色数据直接读写 _smartDrawTrigger.characterProfiles
    // ══════════════════════════════════════════════════════════
    function getChatKey() {
        try {
            if (typeof window.getCurrentChatId === 'function') {
                const id = window.getCurrentChatId();
                if (id) return String(id);
            }
        } catch (_e) {}
        try {
            const ctx = (window.RBQ && window.RBQ.api && typeof window.RBQ.api.getContext === 'function')
                ? window.RBQ.api.getContext()
                : (window.SillyTavern && typeof window.SillyTavern.getContext === 'function' ? window.SillyTavern.getContext() : null);
            if (ctx?.chatId) return String(ctx.chatId);
            if (ctx?.characterId !== undefined) return `char-${ctx.characterId}`;
        } catch (_e) {}
        try {
            const chatEl = document.querySelector('#chat');
            const chatFile = chatEl?.closest?.('[chat_id]')?.getAttribute('chat_id') || chatEl?.closest?.('[data-chat-file]')?.dataset?.chatFile;
            if (chatFile) return String(chatFile);
        } catch (_e) {}
        return '_global';
    }

    function getSdtStore() {
        return RBQ.api.getSettings()?.[SDT_KEY] || {};
    }

    function ensureProfileBucket() {
        const s = RBQ.api.getSettings();
        if (!s[SDT_KEY]) s[SDT_KEY] = {};
        if (!s[SDT_KEY].characterProfiles) s[SDT_KEY].characterProfiles = {};
        const ck = getChatKey();
        if (!s[SDT_KEY].characterProfiles[ck]) s[SDT_KEY].characterProfiles[ck] = {};
        return s[SDT_KEY].characterProfiles[ck];
    }

    function getAllProfiles() {
        const sdt = getSdtStore();
        const ck = getChatKey();
        const currentChatProfiles = (sdt.characterProfiles && sdt.characterProfiles[ck]) || {};
        
        // If current chat is empty, fallback to scanning other chat profiles
        if (Object.keys(currentChatProfiles).length === 0 && sdt.characterProfiles && typeof sdt.characterProfiles === 'object') {
            const fallback = {};
            for (const chatDict of Object.values(sdt.characterProfiles)) {
                if (chatDict && typeof chatDict === 'object') {
                    for (const [k, v] of Object.entries(chatDict)) {
                        if (v && typeof v === 'object' && !fallback[k]) fallback[k] = v;
                    }
                }
            }
            return fallback;
        }
        return currentChatProfiles;
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
            const item = profile.wardrobe.find(w => w.id === outfitId);
            if (item) return item.outfit || item.tags || '';
        }
        return profile.currentOutfit || (profile.wardrobe?.[0]?.outfit) || (profile.wardrobe?.[0]?.tags) || '';
    }

    // ══════════════════════════════════════════════════════════
    //  Multi-Char Composer Status Check
    // ══════════════════════════════════════════════════════════
    function isMccEnabled() {
        try {
            const s = RBQ.api.getSettings();
            return s?.[MCC_KEY]?.enabled === true;
        } catch (e) { return false; }
    }

    // ══════════════════════════════════════════════════════════
    //  Comprehensive Worldbook / Lorebook Retrieval
    // ══════════════════════════════════════════════════════════
    function getWorldbookEntries() {
        const entries = [];
        const seenKeys = new Set();

        function addEntry(e, sourceName = '世界书') {
            if (!e) return;
            if (e.enabled === false || e.disabled === true || e.disable === true) return;
            const content = String(e.content || e.tags || '').trim();
            if (!content || /^[-#\s\n\r*`_~]+$/.test(content)) return;

            let comment = String(e.comment || e.title || '').trim();
            const rawKeys = Array.isArray(e.key) ? e.key : (Array.isArray(e.keys) ? e.keys : (typeof e.key === 'string' ? e.key.split(',') : (typeof e.keys === 'string' ? e.keys.split(',') : [])));
            const cleanKeys = rawKeys.map(k => String(k || '').trim().replace(/^[,，\s]+|[,，\s]+$/g, '')).filter(Boolean);
            if (!comment) comment = cleanKeys[0] || '未命名词条';

            const dedupKey = `${sourceName}:::${comment}:::${content.slice(0, 50)}`;
            if (seenKeys.has(dedupKey)) return;
            seenKeys.add(dedupKey);

            entries.push({
                id: e.id || e.uid || uid('wb'),
                comment,
                content,
                keys: cleanKeys,
                source: sourceName,
                category: classifyWorldbookEntry(comment, content, cleanKeys)
            });
        }

        function processSource(src, fallbackName = '世界书') {
            if (!src || src.enabled === false) return;
            const name = String(src.name || fallbackName);

            if (Array.isArray(src.entries)) {
                src.entries.forEach(e => addEntry(e, name));
                return;
            } else if (src.entries && typeof src.entries === 'object') {
                Object.values(src.entries).forEach(e => addEntry(e, name));
                return;
            }

            if (src.rawJson && typeof src.rawJson === 'string') {
                try {
                    const parsed = JSON.parse(src.rawJson);
                    if (Array.isArray(parsed.entries)) {
                        parsed.entries.forEach(e => addEntry(e, name));
                    } else if (parsed.entries && typeof parsed.entries === 'object') {
                        Object.values(parsed.entries).forEach(e => addEntry(e, name));
                    } else if (Array.isArray(parsed)) {
                        parsed.forEach(e => addEntry(e, name));
                    }
                } catch (_e) {}
                return;
            }
        }

        // 1. Read from SDT lorebookSources / lorebookStore
        try {
            const sdt = getSdtStore();
            const sources = sdt?.lorebookSources || sdt?.lorebookStore?.sources || [];
            if (Array.isArray(sources)) {
                sources.forEach(src => processSource(src));
            }
        } catch (e) {
            console.warn('[CW] Error reading SDT lorebookSources:', e);
        }

        // 2. Read from SillyTavern native global world_info
        try {
            if (window.world_info_data && typeof window.world_info_data === 'object') {
                Object.entries(window.world_info_data).forEach(([wbName, wbObj]) => {
                    if (wbObj && typeof wbObj === 'object') processSource(wbObj, wbName);
                });
            }
            if (window.world_info && typeof window.world_info === 'object') {
                Object.entries(window.world_info).forEach(([wbName, wbObj]) => {
                    if (wbObj && typeof wbObj === 'object') processSource(wbObj, wbName);
                });
            }
        } catch (_e) {}

        // 3. Read from SillyTavern Context & Character Books
        try {
            const ctx = (window.RBQ && window.RBQ.api && typeof window.RBQ.api.getContext === 'function')
                ? window.RBQ.api.getContext()
                : (window.SillyTavern && typeof window.SillyTavern.getContext === 'function' ? window.SillyTavern.getContext() : null);
            
            if (ctx?.worldInfo && typeof ctx.worldInfo === 'object') {
                Object.entries(ctx.worldInfo).forEach(([wbName, wbObj]) => processSource(wbObj, wbName));
            }
            if (ctx?.characterId != null && ctx?.characters?.[ctx.characterId]) {
                const char = ctx.characters[ctx.characterId];
                const cb = char.data?.character_book || char.character_book;
                if (cb) processSource(cb, `${char.name} 专属设定`);
            }
        } catch (_e) {}

        return entries;
    }

    function classifyWorldbookEntry(comment, content, keys = []) {
        const allText = `${comment} ${keys.join(' ')} ${content.slice(0, 160)}`.toLowerCase();
        
        if (/体位|交合|性交|做爱|正常位|骑乘|后入|口交|深喉|乳交|自慰|跳蛋|高潮|绝顶|中出|精液|调教|绳缚|拘束|手铐|项圈|群交|3p|百合|拥抱|亲吻|接吻|依偎|牵手|耳语|互动/i.test(allText) ||
            /\b(sex|missionary|cowgirl|doggystyle|fellatio|paizuri|oral|masturbation|cum|creampie|bondage|bdsm|hug|kiss|embrace|holding_hands|whisper|interaction)\b/i.test(allText)) {
            return 'nsfw';
        }
        if (/服装|衣服|私服|日常服|常服|水手服|校服|西装|女仆|护士|兔女郎|泳装|泳衣|比基尼|死库水|内衣|睡衣|连衣裙|百褶裙|短裙|牛仔裤|丝袜|黑丝|白丝|过膝袜|高跟鞋|靴子|旗袍|和服|浴衣|镂空|透视装|全裸/i.test(allText) ||
            /\b(dress|suit|skirt|uniform|shirt|hoodie|sweater|swimsuit|bikini|lingerie|underwear|pantyhose|socks|boots|shoes|coat|jacket|yukata|kimono|costume|clothes|outfit)\b/i.test(allText)) {
            return 'outfit';
        }
        if (/场景|环境|室内|室外|户外|房间|卧室|客厅|教室|学校|厨房|浴室|温泉|咖啡厅|酒吧|酒店|走廊|街|街道|森林|海边|沙滩|海滩|公园|天台|屋顶|夜景|夕阳|星空|城市|废墟|城堡/i.test(allText) ||
            /\b(indoors|outdoors|room|bedroom|living_room|classroom|kitchen|bathroom|cafe|street|forest|beach|sky|night|sunlight|sunset|city|park|ruins|stage|dungeon)\b/i.test(allText)) {
            return 'scene';
        }
        if (/镜头|视角|机位|构图|特写|面部特写|半身|全身|俯视|仰视|侧面|背面|背影|第一人称|pov|景深|光影|光照|逆光|丁达尔|柔光|发光|氛围/i.test(allText) ||
            /\b(close-up|portrait|bust_shot|upper_body|full_body|cowboy_shot|from_side|from_behind|from_above|from_below|pov|view|depth_of_field|cinematic_lighting|bokeh|lighting)\b/i.test(allText)) {
            return 'camera';
        }
        if (/外貌|发型|发色|双马尾|单马尾|长发|短发|齐刘海|呆毛|瞳|眼睛|红瞳|蓝瞳|金瞳|绿瞳|面部|脸|表情|微笑|哭泣|脸红|胸|巨乳|贫乳|身材|体型|肤色|白皙|黑皮|泪痣|雀斑|淫纹|兽耳|猫耳|狐耳|兔耳|尾巴|翅膀|角|恶魔|天使|魅魔/i.test(allText) ||
            /\b(hair|eyes|face|breasts|skin|ears|tail|horns|wings|blonde|black_hair|silver_hair|red_eyes|blue_eyes|mole|tattoo|petite|curvy|slender)\b/i.test(allText)) {
            return 'appearance';
        }
        return 'pose';
    }

    function extractVariants(content) {
        if (!content) return [];
        const normalized = String(content).replace(/[\ufeff\u200b\u200c\u200d]/g, '').trim();
        const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const variants = [];
        const variantRegex = /^([A-Za-z0-9\u4e00-\u9fa5\s\-_·]+)[\:\：\-\—]\s*(.*)$/;

        for (const line of lines) {
            if (line.startsWith('//') || line.startsWith('#')) continue;
            const match = line.match(variantRegex);
            if (match && match[2] && match[2].length > 4) {
                variants.push({ label: match[1].trim(), tags: match[2].trim() });
            }
        }
        if (variants.length === 0 && lines.length > 0) {
            variants.push({ label: '默认', tags: lines.join(', ') });
        }
        return variants;
    }

    // ══════════════════════════════════════════════════════════
    //  Workshop-Only Storage (composer state + presets)
    // ══════════════════════════════════════════════════════════
    function getWs() {
        const s = RBQ.api.getSettings();
        if (!s[CW_KEY]) s[CW_KEY] = { version: VERSION, presets: [], activeComposer: null };
        const ws = s[CW_KEY];
        if (!Array.isArray(ws.presets)) ws.presets = [];
        if (!ws.activeComposer) {
            ws.activeComposer = {
                scene: 'indoors, cozy room, warm_lighting, soft_light',
                camera: 'from_side, three-quarter_view, depth_of_field',
                atmosphere: '',
                activeSlotIndex: 0,
                slots: [
                    { charName: '', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, looking_at_partner', center: 'B3', uc: '' },
                    { charName: '', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, looking_at_partner, blush', center: 'D3', uc: 'penis, futanari' },
                ],
            };
        }
        if (ws.activeComposer.activeSlotIndex == null) ws.activeComposer.activeSlotIndex = 0;
        return ws;
    }
    function wsSave() { RBQ.api.saveSettings(); }

    // ══════════════════════════════════════════════════════════
    //  Built-in Composition Templates
    // ══════════════════════════════════════════════════════════
    const TEMPLATES = [
        {
            name: '💑 面对面对视', desc: '侧面视角、对视眼神',
            scene: 'indoors, cozy living room, warm_lighting, cinematic_lighting, depth_of_field',
            camera: 'from_side, three-quarter_view, medium_shot', atmosphere: 'romantic atmosphere, soft_shadows',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, looking_at_partner, gentle_smile', center: 'B3', uc: 'facing_viewer' },
                { charName: '', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, eye_contact, soft_smile, blush', center: 'D3', uc: 'facing_viewer, penis, futanari' },
            ],
        },
        {
            name: '🫂 亲密拥抱', desc: '紧紧相拥、近景特写',
            scene: 'bedroom, morning sunlight, window, soft_light, blurry_background',
            camera: 'close-up, bust_shot, upper_body', atmosphere: 'intimate, sweet atmosphere, bokeh',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'embracing, hugging, arms_around_waist, closed_eyes', center: 'C3', uc: 'feet, shoes, lower_body' },
                { charName: '', outfitId: '', customOutfit: '', action: 'embracing, head_on_chest, blushing, peaceful', center: 'C3', uc: 'feet, shoes, lower_body, penis, futanari' },
            ],
        },
        {
            name: '💥 壁咚对峙', desc: '单手压墙、俯视与仰视',
            scene: 'hallway, wall, indoors, dramatic_lighting', camera: 'three-quarter_view, cowboy_shot', atmosphere: 'tension, dramatic',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'standing, kabedon, hand_on_wall, leaning_forward, looking_down, smirking', center: 'B3', uc: 'facing_viewer' },
                { charName: '', outfitId: '', customOutfit: '', action: 'backed_against_wall, looking_up, wide_eyes, blush, nervous', center: 'C3', uc: 'facing_viewer, penis, futanari' },
            ],
        },
        {
            name: '🤝 牵手漫步', desc: '室外并排牵手',
            scene: 'outdoors, street, autumn, falling_leaves, sunny_day', camera: 'front_view, full_body, wide_angle', atmosphere: 'cheerful',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'walking, holding_hands, looking_at_partner, happy', center: 'B3', uc: '' },
                { charName: '', outfitId: '', customOutfit: '', action: 'walking, holding_hands, smiling, cute', center: 'D3', uc: 'penis, futanari' },
            ],
        },
        {
            name: '🤫 背后耳语', desc: '从身后环抱低语',
            scene: 'dimly_lit_room, night, moonlit, rim_lighting', camera: 'bust_shot, from_side', atmosphere: 'mysterious, sensual',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'behind_another, hugging_from_behind, whispering_in_ear', center: 'B3', uc: 'feet, shoes' },
                { charName: '', outfitId: '', customOutfit: '', action: 'in_front, head_tilted, parted_lips, surprised, blush', center: 'C3', uc: 'feet, shoes, penis, futanari' },
            ],
        },
        {
            name: '☕ 咖啡厅对坐', desc: '隔桌对坐、午后阳光',
            scene: 'cafe, table, coffee_cup, afternoon, window_light, depth_of_field', camera: 'eye_level, mid_shot', atmosphere: 'cozy',
            slots: [
                { charName: '', outfitId: '', customOutfit: '', action: 'sitting_at_table, holding_cup, looking_at_partner', center: 'B3', uc: 'feet, shoes' },
                { charName: '', outfitId: '', customOutfit: '', action: 'sitting_at_table, chin_on_hand, smiling, eye_contact', center: 'D3', uc: 'feet, shoes' },
            ],
        },
    ];

    // ══════════════════════════════════════════════════════════
    //  7-Dimensional Trait Chips (for baseTags editing)
    // ══════════════════════════════════════════════════════════
    const TRAITS = [
        { g: '性别族裔', c: '#38bdf8', t: [
            { n: '1girl', t: '1girl' }, { n: '1boy', t: '1boy' },
            { n: '日系', t: 'japanese, delicate_face' }, { n: '东亚', t: 'east_asian' },
            { n: '西方', t: 'caucasian' }, { n: '中华', t: 'chinese' },
            { n: '动漫风', t: 'anime_face' }, { n: 'Gyaru', t: 'gyaru' },
        ] },
        { g: '年龄', c: '#fbbf24', t: [
            { n: '少女', t: 'adolescent, teenager' }, { n: '御姐', t: 'mature_female' },
            { n: '萝莉', t: 'petite, young_girl' }, { n: '成年男', t: 'mature_male' },
            { n: '正太', t: 'bishounen, pretty_boy' },
        ] },
        { g: '发型发色', c: '#f472b6', t: [
            { n: '黑发', t: 'black_hair' }, { n: '银发', t: 'silver_hair' }, { n: '金发', t: 'blonde_hair' },
            { n: '粉发', t: 'pink_hair' }, { n: '蓝发', t: 'blue_hair' }, { n: '红发', t: 'red_hair' },
            { n: '棕发', t: 'brown_hair' }, { n: '双马尾', t: 'twin_tails' }, { n: '马尾', t: 'ponytail' },
            { n: '长发', t: 'very_long_hair' }, { n: '短发', t: 'short_hair' },
            { n: '波浪', t: 'wavy_hair' }, { n: '齐刘海', t: 'blunt_bangs' }, { n: '呆毛', t: 'ahoge' },
        ] },
        { g: '瞳色', c: '#a855f7', t: [
            { n: '红瞳', t: 'red_eyes' }, { n: '蓝瞳', t: 'blue_eyes' }, { n: '金瞳', t: 'amber_eyes' },
            { n: '绿瞳', t: 'green_eyes' }, { n: '紫瞳', t: 'purple_eyes' }, { n: '异色瞳', t: 'heterochromia' },
            { n: '垂眼', t: 'tareme' }, { n: '吊眼', t: 'tsurime' },
        ] },
        { g: '身材', c: '#4ade80', t: [
            { n: '纤细', t: 'slender' }, { n: '娇小', t: 'petite' }, { n: '丰满', t: 'curvy' },
            { n: '高挑', t: 'tall, long_legs' }, { n: '平胸', t: 'flat_chest' },
            { n: '小胸', t: 'small_breasts' }, { n: '中等', t: 'medium_breasts' },
            { n: '巨乳', t: 'large_breasts' }, { n: '爆乳', t: 'huge_breasts' },
            { n: '马甲线', t: 'toned, abs' }, { n: '肉腿', t: 'thick_thighs' },
        ] },
        { g: '肤色标记', c: '#fb7185', t: [
            { n: '冷白', t: 'pale_skin' }, { n: '自然', t: 'fair_skin' }, { n: '小麦黑皮', t: 'tan, dark_skin' },
            { n: '泪痣', t: 'mole_under_eye' }, { n: '雀斑', t: 'freckles' }, { n: '淫纹', t: 'womb_tattoo' },
        ] },
        { g: '种族幻想', c: '#67e8f9', t: [
            { n: '猫耳尾', t: 'cat_ears, cat_tail' }, { n: '狐耳尾', t: 'fox_ears, fox_tail' },
            { n: '兔耳', t: 'rabbit_ears' }, { n: '精灵耳', t: 'pointy_ears' },
            { n: '恶魔', t: 'demon_horns, demon_wings' }, { n: '天使', t: 'halo, angel_wings' },
            { n: '魅魔', t: 'succubus' }, { n: '虎牙', t: 'fangs' },
        ] },
    ];

    const OUTFIT_PRESETS = [
        { n: '水手服', t: 'sailor_suit, pleated_skirt, sailor_collar' },
        { n: '校服西装', t: 'school_uniform, blazer, pleated_skirt, necktie' },
        { n: '女仆装', t: 'maid_outfit, frilled_apron, maid_headdress' },
        { n: '兔女郎', t: 'bunny_suit, bunny_ears, fishnet_pantyhose' },
        { n: '比基尼', t: 'bikini, side-tie_bikini_bottom' },
        { n: '卫衣便服', t: 'hoodie, casual_clothes, denim_shorts' },
        { n: '露肩毛衣', t: 'off-shoulder_sweater, bare_shoulders' },
        { n: '旗袍', t: 'china_dress, cheongsam, high_slit' },
        { n: '浴衣', t: 'yukata, kimono, obi' },
        { n: '蕾丝内衣', t: 'lace_lingerie, see-through_bra, garter_straps' },
        { n: '全裸', t: 'nude, uncensored' },
    ];

    // ══════════════════════════════════════════════════════════
    //  Prompt Composition
    //  严格匹配 multi-char-composer 的 parseAndExtract()
    // ══════════════════════════════════════════════════════════
    function composeFinalPrompt(comp) {
        const parts = [];
        const slots = comp?.slots || [];

        const scn = [comp?.scene, comp?.camera, comp?.atmosphere].filter(Boolean).map(sanitizePromptSegment).join(', ');
        if (scn) parts.push('Scene:' + scn);

        slots.forEach((slot, i) => {
            const n = i + 1;
            const profile = slot.charName ? getProfile(slot.charName) : null;
            const base = sanitizePromptSegment(profile?.baseTags || '');
            const outfit = sanitizePromptSegment(getOutfitTagsForSlot(profile, slot.outfitId, slot.customOutfit));
            const action = sanitizePromptSegment(slot.action || '');
            const caption = [base, outfit, action].filter(Boolean).join(', ');
            const center = (slot.center || (i === 0 ? 'B3' : 'D3')).toUpperCase();

            if (caption) parts.push('Char' + n + ':' + caption + '|centers:' + center);
            const uc = sanitizePromptSegment(slot.uc);
            if (uc) parts.push('Char' + n + ' UC:' + uc);
        });

        return parts.join('; ');
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
.cw-grid5{width:250px;height:250px;background:rgba(15,23,42,.7);border:1.5px solid rgba(56,189,248,.35);border-radius:9px;display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(5,1fr);gap:2px;padding:3px;position:relative;box-shadow:inset 0 0 18px rgba(0,0,0,.5)}
.cw-cell{background:rgba(255,255,255,.03);border-radius:3px;border:1px dashed rgba(255,255,255,.1);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:.15s;position:relative;font-size:9.5px;color:rgba(255,255,255,.3);font-weight:bold}
.cw-cell:hover{background:rgba(56,189,248,.15);border-color:rgba(56,189,248,.5);color:#38bdf8}
.cw-cell.has{border-style:solid}
.cw-pin{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;box-shadow:0 2px 5px rgba(0,0,0,.6);position:absolute;z-index:2;cursor:pointer}
.cw-slot{background:rgba(15,23,42,.55);border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:11px;display:flex;flex-direction:column;gap:9px;transition:.2s}
.cw-slot.on{border-color:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,.15)}
.cw-slot-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cw-badge{padding:2px 7px;border-radius:5px;font-size:11px;font-weight:bold}
.cw-slot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:7px}
.cw-in,.cw-sel,.cw-ta{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:5px;color:#fff;padding:5px 9px;font-size:12px;font-family:inherit;transition:.2s}
.cw-in:focus,.cw-sel:focus,.cw-ta:focus{outline:none;border-color:#38bdf8;background:rgba(0,0,0,.5)}
.cw-ta{min-height:44px;resize:vertical;font-family:monospace}
.cw-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:5px 11px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:.2s;background:rgba(255,255,255,.08);color:#fff}
.cw-btn:hover{filter:brightness(1.2)}
.cw-btn.pri{background:linear-gradient(135deg,#0284c7,#38bdf8);border-color:rgba(56,189,248,.5);box-shadow:0 2px 10px rgba(56,189,248,.3)}
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
.cw-chip{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:3px;padding:2px 6px;font-size:10.5px;color:rgba(255,255,255,.75);cursor:pointer;transition:.15s}
.cw-chip:hover{background:rgba(255,255,255,.12);color:#fff}
.cw-chip.on{background:rgba(56,189,248,.2)!important;border-color:rgba(56,189,248,.7)!important;color:#38bdf8!important;font-weight:bold}
.cw-modal-mask{position:fixed;inset:0;z-index:100000020;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:16px}
.cw-modal{background:#0f172a;border:1px solid rgba(56,189,248,.35);border-radius:13px;width:820px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.9)}
.cw-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(56,189,248,.08)}
.cw-modal-bd{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.cw-modal-ft{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.3)}
.cw-warn{background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.4);border-radius:7px;padding:8px 12px;font-size:12px;color:#fbbf24;display:flex;align-items:center;gap:8px}
`;
        document.head.appendChild(s);
    })();

    // ══════════════════════════════════════════════════════════
    //  Interactive Worldbook Picker Modal
    // ══════════════════════════════════════════════════════════
    const WB_CATEGORIES = [
        { id: 'all', name: '全部', icon: 'fa-globe' },
        { id: 'pose', name: '动作姿态', icon: 'fa-person-walking' },
        { id: 'outfit', name: '服装穿搭', icon: 'fa-shirt' },
        { id: 'scene', name: '场景环境', icon: 'fa-mountain-sun' },
        { id: 'appearance', name: '外貌特征', icon: 'fa-dna' },
        { id: 'nsfw', name: '体位/互动', icon: 'fa-heart-pulse' },
        { id: 'camera', name: '镜头光影', icon: 'fa-camera' },
    ];

    function openWorldbookPicker(title, onSelect, initialCategory = 'all') {
        if (typeof RBQ?.api?.openLorebookSearchModal === 'function') {
            RBQ.api.openLorebookSearchModal('all', (entry) => {
                const content = typeof entry === 'string' ? entry : (entry?.content || entry?.tags || '');
                if (content) onSelect(content.trim());
            }, initialCategory);
            return;
        }

        const allEntries = getWorldbookEntries();
        let selectedCategory = initialCategory || 'all';
        let selectedSource = 'all';
        let query = '';
        
        // Extract unique source names
        const sourceNames = [...new Set(allEntries.map(e => e.source))];

        const mask = document.createElement('div');
        mask.className = 'cw-modal-mask';

        function render() {
            const filtered = allEntries.filter(e => {
                const matchCat = selectedCategory === 'all' || e.category === selectedCategory;
                const matchSrc = selectedSource === 'all' || e.source === selectedSource;
                if (!matchCat || !matchSrc) return false;
                if (!query) return true;
                const q = query.toLowerCase();
                return e.comment.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.keys.some(k => k.toLowerCase().includes(q));
            });

            mask.innerHTML = `
                <div class="cw-modal" style="width:840px">
                    <div class="cw-modal-hd">
                        <strong style="color:#38bdf8;font-size:14px;display:flex;align-items:center;gap:8px">
                            <i class="fa-solid fa-book-open"></i> ${esc(title)}
                            <span style="font-size:11.5px;color:rgba(255,255,255,0.6);font-weight:normal;">(${filtered.length} / ${allEntries.length} 词条)</span>
                        </strong>
                        <button class="cw-btn sm" id="cw-wbp-x">✕</button>
                    </div>

                    <!-- Search Bar & Worldbook Selector -->
                    <div style="padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        <input id="cw-wbp-q" class="cw-in" type="text" placeholder="🔍 搜索词条名称、关键词或 Tag 内容..." value="${esc(query)}" style="flex:1;min-width:180px;" />
                        ${sourceNames.length > 1 ? `
                            <select id="cw-wbp-src" class="cw-sel" style="width:160px;">
                                <option value="all" ${selectedSource === 'all' ? 'selected' : ''}>🌐 全部世界书 (${allEntries.length})</option>
                                ${sourceNames.map(sn => `<option value="${esc(sn)}" ${selectedSource === sn ? 'selected' : ''}>📖 ${esc(sn)}</option>`).join('')}
                            </select>
                        ` : ''}
                    </div>

                    <!-- Category Tabs -->
                    <div class="cw-tabs" style="border-radius:0;border-left:none;border-right:none;border-top:none;padding:6px 16px;background:rgba(0,0,0,0.15);overflow-x:auto;">
                        ${WB_CATEGORIES.map(c => `
                            <button class="cw-tab cw-wbp-cat-btn ${selectedCategory === c.id ? 'on' : ''}" data-cat="${c.id}">
                                <i class="fa-solid ${c.icon}"></i> ${c.name}
                            </button>
                        `).join('')}
                    </div>

                    <!-- Results List -->
                    <div class="cw-modal-bd" style="max-height:52vh;gap:8px">
                        ${filtered.length === 0 ? `
                            <div style="text-align:center;padding:40px 20px;opacity:.6">
                                ${allEntries.length === 0 ? '⚠️ 当前尚未检测到已挂载的世界书。请在「智能生图触发器 (Smart Draw)」中导入世界书 JSON，或在酒馆中挂载世界书。' : '未找到匹配的世界书词条，请尝试调整搜索词或分类'}
                            </div>
                        ` : filtered.map((e, i) => {
                            const vars = extractVariants(e.content);
                            return `<div class="cw-card" style="padding:9px 12px;gap:5px">
                                <div class="cw-card-hd">
                                    <div style="display:flex;align-items:center;gap:6px">
                                        <span class="cw-badge" style="background:rgba(56,189,248,0.15);color:#38bdf8;font-size:10px;">${esc(e.source)}</span>
                                        <strong style="font-size:12.5px;color:#f1f5f9">${esc(e.comment)}</strong>
                                        ${e.keys.length ? `<span style="font-size:10.5px;color:rgba(255,255,255,0.45);">[${esc(e.keys.slice(0, 3).join(', '))}]</span>` : ''}
                                    </div>
                                    <div style="display:flex;gap:5px;flex-wrap:wrap">
                                        ${vars.length > 1 ? vars.map((v, vi) => `<button class="cw-btn cy sm cw-wbp-var" data-ei="${i}" data-vi="${vi}">${esc(v.label)}</button>`).join('') : `<button class="cw-btn gn sm cw-wbp-pick" data-ei="${i}">填入</button>`}
                                    </div>
                                </div>
                                <div style="font-family:monospace;font-size:10.5px;color:rgba(255,255,255,.65);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.content.slice(0, 160))}</div>
                            </div>`;
                        }).join('')}
                    </div>

                    <!-- Footer -->
                    <div class="cw-modal-ft">
                        <span style="font-size:11px;opacity:.55">共载入 ${allEntries.length} 条世界书词库</span>
                        <button class="cw-btn" id="cw-wbp-close">关闭</button>
                    </div>
                </div>`;

            mask.querySelector('#cw-wbp-x')?.addEventListener('click', () => mask.remove());
            mask.querySelector('#cw-wbp-close')?.addEventListener('click', () => mask.remove());
            mask.querySelector('#cw-wbp-q')?.addEventListener('input', ev => { query = ev.target.value.trim(); render(); });
            mask.querySelector('#cw-wbp-src')?.addEventListener('change', ev => { selectedSource = ev.target.value; render(); });
            
            mask.querySelectorAll('.cw-wbp-cat-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedCategory = btn.dataset.cat;
                    render();
                });
            });

            mask.querySelectorAll('.cw-wbp-pick').forEach(b => b.addEventListener('click', () => {
                const e = filtered[+b.dataset.ei];
                if (e) { onSelect(e.content.trim()); mask.remove(); }
            }));
            mask.querySelectorAll('.cw-wbp-var').forEach(b => b.addEventListener('click', () => {
                const e = filtered[+b.dataset.ei];
                const vars = extractVariants(e.content);
                const v = vars[+b.dataset.vi];
                if (v) { onSelect(v.tags); mask.remove(); }
            }));
        }
        render();
        document.body.appendChild(mask);
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
            avatarUrl: origProfile?.avatarUrl || '',
            wardrobe: JSON.parse(JSON.stringify(origProfile?.wardrobe || [])),
        };
        if (draft.wardrobe.length === 0) {
            draft.wardrobe.push({ id: uid('w'), name: '默认服装', outfit: draft.currentOutfit || '', triggers: [], createdAt: Date.now() });
        }

        let activeWIdx = 0;
        const mask = document.createElement('div');
        mask.className = 'cw-modal-mask';

        function render() {
            const cw = draft.wardrobe[activeWIdx] || draft.wardrobe[0];
            mask.innerHTML = `
                <div class="cw-modal" style="width:800px">
                    <div class="cw-modal-hd">
                        <strong style="color:#38bdf8;font-size:14px"><i class="fa-solid fa-id-card"></i> ${isEdit ? '编辑角色 · ' + esc(draft.displayName) : '✨ 新建角色档案'}</strong>
                        <button class="cw-btn sm" id="cw-ce-x">✕</button>
                    </div>
                    <div class="cw-modal-bd">
                        <!-- Name & Avatar -->
                        <div class="cw-card" style="padding:9px 12px">
                            <div style="display:flex;gap:10px;align-items:center">
                                <div class="cw-avatar" style="width:48px;height:48px">${draft.avatarUrl ? '<img src="' + esc(draft.avatarUrl) + '"/>' : '👤'}</div>
                                <div style="flex:1;display:flex;flex-direction:column;gap:5px">
                                    <div style="display:flex;gap:7px">
                                        <input id="cw-ce-name" class="cw-in" type="text" placeholder="角色姓名" value="${esc(draft.displayName)}" style="font-weight:bold;font-size:13px" ${isEdit ? 'disabled' : ''} />
                                        <button class="cw-btn am sm" id="cw-ce-import-card" type="button"><i class="fa-solid fa-file-import"></i> 导入当前角色卡</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Base Tags + 7D Chips -->
                        <div class="cw-card">
                            <div class="cw-card-hd">
                                <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-dna"></i> 固有外貌 (Base Tags)</span>
                                <button class="cw-btn cy sm" id="cw-ce-wb-base" type="button"><i class="fa-solid fa-book-open"></i> 从世界书选外貌</button>
                            </div>
                            <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;background:rgba(0,0,0,.2);padding:6px;border-radius:5px">
                                ${TRAITS.map(g => `<div style="display:flex;gap:4px;align-items:flex-start;flex-wrap:wrap">
                                    <span style="font-size:10px;font-weight:bold;color:${g.c};min-width:60px;padding-top:2px">${esc(g.g)}:</span>
                                    <div style="display:flex;gap:3px;flex-wrap:wrap;flex:1">${g.t.map(t => `<button class="cw-chip cw-base-chip" data-tag="${esc(t.t)}" type="button">${esc(t.n)}</button>`).join('')}</div>
                                </div>`).join('')}
                            </div>
                            <textarea id="cw-ce-base" class="cw-ta" placeholder="girl, japanese, delicate_face, black_hair, red_eyes, large_breasts, fair_skin">${esc(draft.baseTags)}</textarea>
                        </div>

                        <!-- Wardrobe -->
                        <div class="cw-card">
                            <div class="cw-card-hd">
                                <span class="cw-card-tt" style="color:#ffb86c"><i class="fa-solid fa-shirt"></i> 衣柜 (${draft.wardrobe.length} 套)</span>
                                <div style="display:flex;gap:5px">
                                    <button class="cw-btn am sm" id="cw-ce-wb-outfit" type="button"><i class="fa-solid fa-book-open"></i> 从世界书选服装</button>
                                    <button class="cw-btn gn sm" id="cw-ce-add-w" type="button"><i class="fa-solid fa-plus"></i> 新增服装</button>
                                </div>
                            </div>
                            <div class="cw-tabs" style="overflow-x:auto">
                                ${draft.wardrobe.map((w, i) => `<button class="cw-tab cw-w-tab ${activeWIdx === i ? 'on' : ''}" data-wi="${i}">👗 ${esc(w.name || '套件' + (i + 1))}</button>`).join('')}
                            </div>
                            <div style="display:flex;gap:7px;align-items:center">
                                <input id="cw-ce-wname" class="cw-in" type="text" placeholder="服装名称" value="${esc(cw?.name || '')}" style="width:200px" />
                                <div style="display:flex;gap:3px;flex-wrap:wrap;flex:1">${OUTFIT_PRESETS.slice(0, 7).map(o => `<button class="cw-chip cw-outfit-chip" data-tag="${esc(o.t)}" type="button">${esc(o.n)}</button>`).join('')}</div>
                                ${draft.wardrobe.length > 1 ? '<button class="cw-btn rd sm" id="cw-ce-del-w" type="button">✕ 删除此套</button>' : ''}
                            </div>
                            <textarea id="cw-ce-wtags" class="cw-ta" placeholder="sailor_suit, pleated_skirt, white_thighhighs">${esc(cw?.outfit || cw?.tags || '')}</textarea>
                        </div>
                    </div>
                    <div class="cw-modal-ft">
                        <button class="cw-btn cy" id="cw-ce-test" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> 测试单人立绘</button>
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

            // Import from SillyTavern character card
            mask.querySelector('#cw-ce-import-card')?.addEventListener('click', () => {
                try {
                    const ctx = (window.RBQ && window.RBQ.api && typeof window.RBQ.api.getContext === 'function')
                        ? window.RBQ.api.getContext()
                        : (window.SillyTavern && typeof window.SillyTavern.getContext === 'function' ? window.SillyTavern.getContext() : null);
                    
                    const cid = ctx?.characterId;
                    const cd = ctx?.characters?.[cid];
                    if (!cd) return toastr.warning('未检测到当前角色卡', PLUGIN_NAME);
                    draft.displayName = cd.name || draft.displayName;
                    draft.avatarUrl = cd.avatar ? '/characters/' + cd.avatar : draft.avatarUrl;
                    const nameEl = mask.querySelector('#cw-ce-name');
                    if (nameEl && !nameEl.disabled) nameEl.value = draft.displayName;
                    toastr.success('已导入「' + draft.displayName + '」', PLUGIN_NAME);
                    render();
                } catch (e) { toastr.error('导入失败: ' + e.message, PLUGIN_NAME); }
            });

            // Test solo portrait
            mask.querySelector('#cw-ce-test')?.addEventListener('click', async () => {
                const outfit = draft.wardrobe[activeWIdx]?.outfit || draft.wardrobe[activeWIdx]?.tags || '';
                const prompt = [draft.baseTags, outfit, 'solo, looking_at_viewer, upper_body, simple_background'].filter(Boolean).join(', ');
                toastr.info('正在生成单人立绘测试...', PLUGIN_NAME);
                try { await RBQ.api.generateImage(prompt, 'cw-test'); toastr.success('立绘已生成！', PLUGIN_NAME); }
                catch (e) { toastr.error('生成失败: ' + (e.message || e), PLUGIN_NAME); }
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

                saveProfile(name, {
                    displayName: name,
                    baseTags: draft.baseTags,
                    currentOutfit: draft.wardrobe[0]?.outfit || draft.wardrobe[0]?.tags || '',
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
    //  Tab 1: 角色档案管理 — 直接展示 SDT profiles
    // ══════════════════════════════════════════════════════════
    function renderDossierTab() {
        const profiles = getAllProfiles();
        const names = Object.keys(profiles);

        return `<div class="cw-body">
            <div class="cw-card">
                <div class="cw-card-hd">
                    <div>
                        <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-users"></i> SDT 角色记忆 · 当前聊天 (${names.length} 位)</span>
                        <div style="font-size:11px;opacity:.6;margin-top:2px">直接管理智能生图已记忆的角色外貌与差分衣柜，修改即时生效。</div>
                    </div>
                    <button class="cw-btn gn" id="cw-create-char"><i class="fa-solid fa-plus"></i> 手动新建角色</button>
                </div>

                <div class="cw-chgrid" style="margin-top:6px">
                    ${names.length === 0 ? '<div style="text-align:center;padding:35px;grid-column:1/-1;opacity:.6">当前聊天暂无角色记忆。在聊天中让 tagger 自动学习，或点击「手动新建角色」。</div>' : names.map(n => {
                        const p = profiles[n];
                        const wCount = Array.isArray(p.wardrobe) ? p.wardrobe.length : 0;
                        return `<div class="cw-chcard">
                            <div style="display:flex;gap:9px;align-items:center">
                                <div class="cw-avatar">${p.avatarUrl ? '<img src="' + esc(p.avatarUrl) + '"/>' : '👤'}</div>
                                <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:2px">
                                    <span style="font-size:13px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.displayName || n)}</span>
                                    <span style="font-size:10.5px;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.baseTags)}">${esc(p.baseTags || '未设置外貌')}</span>
                                    <span style="font-size:10px;color:#ffb86c">👗 ${wCount} 套服装 · 穿着: ${esc((p.currentOutfit || '').slice(0, 30))}</span>
                                </div>
                            </div>
                            <div style="display:flex;gap:5px;justify-content:flex-end;margin-top:3px">
                                <button class="cw-btn cy sm cw-send-to-stage" data-name="${esc(n)}">+ 放入舞台</button>
                                <button class="cw-btn sm cw-edit-char" data-name="${esc(n)}">编辑</button>
                                <button class="cw-btn rd sm cw-del-char" data-name="${esc(n)}">删除</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    //  Tab 2: 多角色分镜合成台
    // ══════════════════════════════════════════════════════════
    function renderComposerTab() {
        const ws = getWs();
        const comp = ws.activeComposer;
        const slots = comp.slots || [];
        const ai = Math.min(slots.length - 1, Math.max(0, comp.activeSlotIndex || 0));
        const profiles = getAllProfiles();
        const profileNames = Object.keys(profiles);
        const finalPrompt = composeFinalPrompt(comp);
        const mccOn = isMccEnabled();

        return `<div class="cw-body">
            ${!mccOn ? '<div class="cw-warn">⚠️ 多角色合成插件 (Multi-Char Composer) 未启用！合成的提示词将无法被正确解析为 NAI V4 多角色格式。请在 RBQ 设置中启用它。</div>' : ''}

            <!-- Stage & Scene -->
            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-chess-board"></i> 5x5 空间舞台 (点击网格摆放当前角色)</span>
                    <button class="cw-btn cy sm" id="cw-pick-scene-wb" type="button"><i class="fa-solid fa-mountain-sun"></i> 选世界书场景</button>
                </div>
                <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
                    <!-- 5x5 Grid -->
                    <div class="cw-grid5" id="cw-stage">
                        ${ROWS.map(r => COLS.map(c => {
                            const coord = c + r;
                            const charsHere = slots.map((s, i) => ({ ...s, si: i })).filter(s => (s.center || 'C3').toUpperCase() === coord);
                            return `<div class="cw-cell ${charsHere.length ? 'has' : ''}" data-coord="${coord}">
                                <span>${coord}</span>
                                ${charsHere.map(s => `<div class="cw-pin" data-si="${s.si}" style="background:${COLORS[s.si % COLORS.length].hex}" title="Char ${s.si + 1}: ${esc(s.charName || '未绑定')} (${coord})">${s.si + 1}</div>`).join('')}
                            </div>`;
                        }).join('')).join('')}
                    </div>

                    <!-- Info & Scene Inputs -->
                    <div style="flex:1;min-width:200px;display:flex;flex-direction:column;gap:7px;font-size:12px;color:rgba(255,255,255,.7)">
                        <div style="font-weight:700;color:#f8fafc;font-size:13px">
                            当前活动: <span style="color:${COLORS[ai % COLORS.length].hex}">Char ${ai + 1} (${esc(slots[ai]?.charName || '未绑定')})</span>
                            <small style="margin-left:5px;opacity:.7">[${coordLabel(slots[ai]?.center)}]</small>
                        </div>
                        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:2px">
                            ${slots.map((s, i) => {
                                const cl = COLORS[i % COLORS.length];
                                return `<div class="cw-chip cw-switch-slot ${ai === i ? 'on' : ''}" data-idx="${i}" style="border-color:${ai === i ? cl.bdr : 'transparent'}">● Char ${i + 1}: ${esc(s.charName || '未绑定')} (${s.center || 'C3'})</div>`;
                            }).join('')}
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">
                            <div>
                                <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1">场景环境:</label>
                                <input id="cw-scene" class="cw-in" type="text" placeholder="indoors, living room..." value="${esc(comp.scene || '')}" />
                            </div>
                            <div>
                                <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1">视角光影:</label>
                                <input id="cw-camera" class="cw-in" type="text" placeholder="from_side, depth_of_field..." value="${esc(comp.camera || '')}" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Character Slots -->
            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#4ade80"><i class="fa-solid fa-users-viewfinder"></i> 角色槽位 (${slots.length})</span>
                    <button class="cw-btn gn sm" id="cw-add-slot" type="button"><i class="fa-solid fa-user-plus"></i> 添加槽位</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:10px">
                    ${slots.map((slot, i) => {
                        const cl = COLORS[i % COLORS.length];
                        const isActive = ai === i;
                        const prof = slot.charName ? profiles[slot.charName] : null;
                        const wardrobe = prof?.wardrobe || [];
                        return `<div class="cw-slot ${isActive ? 'on' : ''}" data-idx="${i}">
                            <div class="cw-slot-top">
                                <div style="display:flex;align-items:center;gap:7px">
                                    <span class="cw-badge" style="background:${cl.bg};color:${cl.hex}">Char ${i + 1}</span>
                                    <strong style="font-size:12.5px;color:#f8fafc">${esc(prof?.displayName || slot.charName || '未绑定')}</strong>
                                    <span style="font-size:10.5px;opacity:.6">[${coordLabel(slot.center)}]</span>
                                </div>
                                <div style="display:flex;gap:5px">
                                    <button class="cw-btn cy sm cw-activate-slot" data-idx="${i}" type="button">🎯 选中</button>
                                    ${slots.length > 1 ? `<button class="cw-btn rd sm cw-rm-slot" data-idx="${i}" type="button">✕</button>` : ''}
                                </div>
                            </div>
                            <div class="cw-slot-grid">
                                <div>
                                    <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1">绑定角色:</label>
                                    <select class="cw-sel cw-slot-char" data-idx="${i}">
                                        <option value="">👤 [未绑定]</option>
                                        ${profileNames.map(n => `<option value="${esc(n)}" ${slot.charName === n ? 'selected' : ''}>👤 ${esc(profiles[n].displayName || n)}</option>`).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1">服装:</label>
                                    <select class="cw-sel cw-slot-outfit" data-idx="${i}">
                                        <option value="" ${!slot.outfitId && !slot.customOutfit ? 'selected' : ''}>👗 当前穿着</option>
                                        ${wardrobe.map(w => `<option value="${esc(w.id)}" ${slot.outfitId === w.id ? 'selected' : ''}>👗 ${esc(w.name)}</option>`).join('')}
                                        <option value="__custom" ${slot.customOutfit ? 'selected' : ''}>✍️ 自定义</option>
                                    </select>
                                </div>
                                <div style="grid-column:1/-1">
                                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                                        <label style="font-size:10.5px;font-weight:bold;color:#cbd5e1">动作姿态:</label>
                                        <button class="cw-btn cy sm cw-pick-action-wb" data-idx="${i}" type="button"><i class="fa-solid fa-book-open"></i> 选动作</button>
                                    </div>
                                    <input class="cw-in cw-slot-action" data-idx="${i}" type="text" placeholder="sitting, facing_another, looking_at_partner..." value="${esc(slot.action || '')}" />
                                </div>
                                <div style="grid-column:1/-1">
                                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                                        <label style="font-size:10.5px;font-weight:bold;color:#f87171">角色独立 UC (防穿模):</label>
                                        <div style="display:flex;gap:3px">
                                            <button class="cw-chip cw-quick-uc" data-idx="${i}" data-uc="penis, futanari, testicles">♀防肉棒</button>
                                            <button class="cw-chip cw-quick-uc" data-idx="${i}" data-uc="feet, shoes, legs, lower_body">防漏脚</button>
                                            <button class="cw-chip cw-quick-uc" data-idx="${i}" data-uc="face, eyes, head">防长头</button>
                                        </div>
                                    </div>
                                    <input class="cw-in cw-slot-uc" data-idx="${i}" type="text" placeholder="penis, futanari, feet, shoes..." value="${esc(slot.uc || '')}" />
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <!-- Live Preview & Generate -->
            <div class="cw-preview">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-terminal"></i> 合成提示词预览</span>
                    <div style="display:flex;gap:5px">
                        <button class="cw-btn sm" id="cw-copy-prompt"><i class="fa-regular fa-copy"></i> 复制</button>
                        <button class="cw-btn am sm" id="cw-save-preset"><i class="fa-solid fa-floppy-disk"></i> 存为预设</button>
                    </div>
                </div>
                <div class="cw-code" id="cw-prompt-preview">${esc(finalPrompt)}</div>
                <div style="display:flex;justify-content:flex-end;margin-top:3px">
                    <button class="cw-btn pri" id="cw-generate" style="padding:7px 22px;font-size:13px;font-weight:bold">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 🚀 合成并生图
                    </button>
                </div>
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    //  Tab 3: 组合预设库
    // ══════════════════════════════════════════════════════════
    function renderPresetsTab() {
        const ws = getWs();
        const userPresets = ws.presets;

        return `<div class="cw-body">
            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-sparkles"></i> 经典分镜模板 (一键载入舞台)</span>
                </div>
                <div class="cw-chgrid">
                    ${TEMPLATES.map((t, i) => `<div class="cw-chcard" style="border-color:rgba(56,189,248,.15)">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start">
                            <strong style="font-size:12.5px;color:#38bdf8">${esc(t.name)}</strong>
                            <span class="cw-badge" style="background:rgba(56,189,248,.15);color:#38bdf8">${t.slots.length}人</span>
                        </div>
                        <div style="font-size:11px;opacity:.65">${esc(t.desc)}</div>
                        <div style="display:flex;justify-content:flex-end;margin-top:3px">
                            <button class="cw-btn gn sm cw-load-tpl" data-idx="${i}">载入舞台</button>
                        </div>
                    </div>`).join('')}
                </div>
            </div>

            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#fbbf24"><i class="fa-solid fa-bookmark"></i> 我的预设 (${userPresets.length})</span>
                </div>
                <div class="cw-chgrid">
                    ${userPresets.length === 0 ? '<div style="text-align:center;padding:25px;grid-column:1/-1;opacity:.6">暂无自定义预设</div>' : userPresets.map((p, i) => `<div class="cw-chcard">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start">
                            <strong style="font-size:12.5px;color:#f8fafc">${esc(p.name)}</strong>
                            <span class="cw-badge" style="background:rgba(251,191,36,.15);color:#fbbf24">${p.slots?.length || 0}人</span>
                        </div>
                        <div style="font-size:10.5px;opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.scene || '')}</div>
                        <div style="display:flex;gap:5px;justify-content:flex-end;margin-top:3px">
                            <button class="cw-btn gn sm cw-load-preset" data-idx="${i}">载入</button>
                            <button class="cw-btn rd sm cw-del-preset" data-idx="${i}">删除</button>
                        </div>
                    </div>`).join('')}
                </div>
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    //  Main UI Assembly & Event Binding
    // ══════════════════════════════════════════════════════════
    let activeTab = 'composer';

    function renderMain(tab) {
        activeTab = tab || activeTab;
        const profiles = getAllProfiles();
        const pCount = Object.keys(profiles).length;
        const presetCount = getWs().presets.length;

        return `<div class="cw-wrap">
            <div class="cw-hdr">
                <div class="cw-logo"><i class="fa-solid fa-palette"></i> 角色工坊 2.0</div>
                <div class="cw-tabs">
                    <button class="cw-tab cw-main-tab ${activeTab === 'composer' ? 'on' : ''}" data-tab="composer"><i class="fa-solid fa-puzzle-piece"></i> 分镜合成台</button>
                    <button class="cw-tab cw-main-tab ${activeTab === 'dossier' ? 'on' : ''}" data-tab="dossier"><i class="fa-solid fa-users"></i> 角色档案 (${pCount})</button>
                    <button class="cw-tab cw-main-tab ${activeTab === 'presets' ? 'on' : ''}" data-tab="presets"><i class="fa-solid fa-bookmark"></i> 预设库 (${presetCount})</button>
                </div>
            </div>
            <div id="cw-tab-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
                ${activeTab === 'composer' ? renderComposerTab() : ''}
                ${activeTab === 'dossier' ? renderDossierTab() : ''}
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
        // 5x5 grid click (cell)
        container.querySelectorAll('.cw-cell').forEach(cell => cell.addEventListener('click', (e) => {
            if (e.target.classList.contains('cw-pin')) return;
            const ai = comp.activeSlotIndex || 0;
            if (comp.slots[ai]) { comp.slots[ai].center = cell.dataset.coord; wsSave(); refresh('composer'); }
        }));

        // 5x5 pin click (switch to that slot)
        container.querySelectorAll('.cw-pin').forEach(pin => pin.addEventListener('click', (e) => {
            e.stopPropagation();
            comp.activeSlotIndex = +pin.dataset.si;
            wsSave();
            refresh('composer');
        }));

        // Switch active slot
        container.querySelectorAll('.cw-switch-slot, .cw-activate-slot').forEach(b => b.addEventListener('click', () => {
            comp.activeSlotIndex = +b.dataset.idx; wsSave(); refresh('composer');
        }));

        // Scene & camera inputs
        container.querySelector('#cw-scene')?.addEventListener('input', e => { comp.scene = e.target.value; wsSave(); updatePreview(container); });
        container.querySelector('#cw-camera')?.addEventListener('input', e => { comp.camera = e.target.value; wsSave(); updatePreview(container); });

        // Add slot
        container.querySelector('#cw-add-slot')?.addEventListener('click', () => {
            const n = comp.slots.length;
            comp.slots.push({ charName: '', outfitId: '', customOutfit: '', action: 'standing, looking_at_viewer', center: n % 2 === 0 ? 'B3' : 'D3', uc: '' });
            comp.activeSlotIndex = comp.slots.length - 1;
            wsSave(); refresh('composer');
        });

        // Remove slot
        container.querySelectorAll('.cw-rm-slot').forEach(b => b.addEventListener('click', () => {
            const i = +b.dataset.idx;
            if (comp.slots.length > 1) { comp.slots.splice(i, 1); comp.activeSlotIndex = Math.max(0, comp.activeSlotIndex - 1); wsSave(); refresh('composer'); }
        }));

        // Slot char select
        container.querySelectorAll('.cw-slot-char').forEach(sel => sel.addEventListener('change', () => {
            const i = +sel.dataset.idx;
            if (comp.slots[i]) { comp.slots[i].charName = sel.value; comp.slots[i].outfitId = ''; comp.slots[i].customOutfit = ''; wsSave(); refresh('composer'); }
        }));

        // Slot outfit select
        container.querySelectorAll('.cw-slot-outfit').forEach(sel => sel.addEventListener('change', () => {
            const i = +sel.dataset.idx;
            if (comp.slots[i]) {
                if (sel.value === '__custom') { comp.slots[i].outfitId = ''; comp.slots[i].customOutfit = comp.slots[i].customOutfit || ''; }
                else { comp.slots[i].outfitId = sel.value; comp.slots[i].customOutfit = ''; }
                wsSave(); updatePreview(container);
            }
        }));

        // Slot action
        container.querySelectorAll('.cw-slot-action').forEach(inp => inp.addEventListener('input', () => {
            const i = +inp.dataset.idx; if (comp.slots[i]) { comp.slots[i].action = inp.value; wsSave(); updatePreview(container); }
        }));

        // Slot UC
        container.querySelectorAll('.cw-slot-uc').forEach(inp => inp.addEventListener('input', () => {
            const i = +inp.dataset.idx; if (comp.slots[i]) { comp.slots[i].uc = inp.value; wsSave(); updatePreview(container); }
        }));

        // Quick UC chips
        container.querySelectorAll('.cw-quick-uc').forEach(b => b.addEventListener('click', () => {
            const i = +b.dataset.idx;
            if (comp.slots[i]) { comp.slots[i].uc = toggleTag(comp.slots[i].uc, b.dataset.uc); wsSave(); refresh('composer'); }
        }));

        // Pick action from worldbook
        container.querySelectorAll('.cw-pick-action-wb').forEach(b => b.addEventListener('click', () => {
            const i = +b.dataset.idx;
            openWorldbookPicker('选择动作/姿态词条', tags => {
                if (comp.slots[i]) { comp.slots[i].action = tags; wsSave(); refresh('composer'); }
            }, 'pose');
        }));

        // Pick scene from worldbook
        container.querySelector('#cw-pick-scene-wb')?.addEventListener('click', () => {
            openWorldbookPicker('选择场景环境词条', tags => { comp.scene = tags; wsSave(); refresh('composer'); }, 'scene');
        });

        // Copy prompt
        container.querySelector('#cw-copy-prompt')?.addEventListener('click', () => {
            const p = composeFinalPrompt(comp);
            if (navigator.clipboard) { navigator.clipboard.writeText(p); toastr.success('已复制', PLUGIN_NAME); }
        });

        // Save preset
        container.querySelector('#cw-save-preset')?.addEventListener('click', () => {
            const name = prompt('预设名称：', '分镜 - ' + new Date().toLocaleDateString());
            if (!name) return;
            ws.presets.push({ id: uid('p'), name, scene: comp.scene, camera: comp.camera, atmosphere: comp.atmosphere, slots: JSON.parse(JSON.stringify(comp.slots)) });
            wsSave(); toastr.success('预设「' + name + '」已保存', PLUGIN_NAME);
        });

        // Generate
        container.querySelector('#cw-generate')?.addEventListener('click', async () => {
            if (!isMccEnabled()) {
                toastr.warning('多角色合成插件未启用，生成的图片可能无法正确分配角色位置', PLUGIN_NAME);
            }
            const p = composeFinalPrompt(comp);
            toastr.info('正在生成多角色画面...', PLUGIN_NAME);
            try { await RBQ.api.generateImage(p, 'cw-ensemble'); toastr.success('多角色画面已生成！', PLUGIN_NAME); }
            catch (e) { toastr.error('生图失败: ' + (e.message || e), PLUGIN_NAME); }
        });

        // ── Dossier Events ──
        container.querySelector('#cw-create-char')?.addEventListener('click', () => openCharacterEditor(null, () => refresh('dossier')));

        container.querySelectorAll('.cw-edit-char').forEach(b => b.addEventListener('click', () => openCharacterEditor(b.dataset.name, () => refresh('dossier'))));

        container.querySelectorAll('.cw-del-char').forEach(b => b.addEventListener('click', () => {
            deleteProfile(b.dataset.name); toastr.info('已删除', PLUGIN_NAME); refresh('dossier');
        }));

        container.querySelectorAll('.cw-send-to-stage').forEach(b => b.addEventListener('click', () => {
            const name = b.dataset.name;
            const ai = comp.activeSlotIndex || 0;
            if (comp.slots[ai]) { comp.slots[ai].charName = name; }
            else { comp.slots.push({ charName: name, outfitId: '', customOutfit: '', action: '', center: 'C3', uc: '' }); }
            wsSave(); toastr.success('「' + name + '」已放入舞台 Char ' + (ai + 1), PLUGIN_NAME); refresh('composer');
        }));

        // ── Presets Events ──
        container.querySelectorAll('.cw-load-tpl').forEach(b => b.addEventListener('click', () => {
            const t = TEMPLATES[+b.dataset.idx];
            if (t) { comp.scene = t.scene; comp.camera = t.camera; comp.atmosphere = t.atmosphere; comp.slots = JSON.parse(JSON.stringify(t.slots)); comp.activeSlotIndex = 0; wsSave(); toastr.success('已载入「' + t.name + '」', PLUGIN_NAME); refresh('composer'); }
        }));

        container.querySelectorAll('.cw-load-preset').forEach(b => b.addEventListener('click', () => {
            const p = ws.presets[+b.dataset.idx];
            if (p) { comp.scene = p.scene || ''; comp.camera = p.camera || ''; comp.atmosphere = p.atmosphere || ''; comp.slots = JSON.parse(JSON.stringify(p.slots)); comp.activeSlotIndex = 0; wsSave(); toastr.success('已载入「' + p.name + '」', PLUGIN_NAME); refresh('composer'); }
        }));

        container.querySelectorAll('.cw-del-preset').forEach(b => b.addEventListener('click', () => {
            ws.presets.splice(+b.dataset.idx, 1); wsSave(); toastr.info('已删除', PLUGIN_NAME); refresh('presets');
        }));
    }

    function updatePreview(container) {
        const el = container.querySelector('#cw-prompt-preview');
        if (el) el.textContent = composeFinalPrompt(getWs().activeComposer);
    }

    // ══════════════════════════════════════════════════════════
    //  Panel Mount via RBQ.ui.addSettingPanel
    // ══════════════════════════════════════════════════════════
    function mount() {
        if (!RBQ.ui || typeof RBQ.ui.addSettingPanel !== 'function') {
            return console.warn('[CW] RBQ.ui.addSettingPanel not available');
        }
        RBQ.ui.addSettingPanel('character-workshop', '<i class="fa-solid fa-palette"></i><span>角色工坊</span>', () => {
            const w = document.createElement('div');
            w.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden';
            const refresh = (tab) => { w.innerHTML = renderMain(tab); bindEvents(w, refresh); };
            refresh(activeTab);
            return w;
        });
    }
    mount();
    console.info('[' + PLUGIN_NAME + '] v' + VERSION + ' loaded — SDT direct data access');

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
