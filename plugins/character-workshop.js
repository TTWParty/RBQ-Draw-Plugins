(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Character Workshop] RBQ Core API missing');

    const PLUGIN_NAME = '角色工坊 (Character Workshop)';
    const STORAGE_KEY = '_characterWorkshop';
    const SDT_STORAGE_KEY = '_smartDrawTrigger';
    const VERSION = '2.0.0';

    // ── Helper Utilities ─────────────────────────────────────
    function uid(prefix = 'cw') {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    // ── Coordinate Mapping (NAI V4.5 centers) ────────────────
    const COL_MAP = { A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
    const ROW_MAP = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };
    const COORD_LABELS = {
        A1: '左上远景', B1: '偏左远景', C1: '居中远景', D1: '偏右远景', E1: '右上远景',
        A2: '左上中景', B2: '偏左中景', C2: '居中中景', D2: '偏右中景', E2: '右上中景',
        A3: '左侧居中', B3: '偏左居中', C3: '画面正中', D3: '偏右居中', E3: '右侧居中',
        A4: '左下近景', B4: '偏左近景', C4: '居中近景', D4: '偏右近景', E4: '右下近景',
        A5: '左下特写', B5: '偏左特写', C5: '居中特写', D5: '偏右特写', E5: '右下特写',
    };

    const SLOT_COLORS = [
        { name: '青蓝', hex: '#38bdf8', bg: 'rgba(56, 189, 248, 0.18)', border: 'rgba(56, 189, 248, 0.6)' },
        { name: '粉红', hex: '#f472b6', bg: 'rgba(244, 114, 182, 0.18)', border: 'rgba(244, 114, 182, 0.6)' },
        { name: '嫩绿', hex: '#4ade80', bg: 'rgba(74, 222, 128, 0.18)', border: 'rgba(74, 222, 128, 0.6)' },
        { name: '琥珀', hex: '#fbbf24', bg: 'rgba(251, 191, 36, 0.18)', border: 'rgba(251, 191, 36, 0.6)' },
        { name: '紫罗兰', hex: '#c084fc', bg: 'rgba(192, 132, 252, 0.18)', border: 'rgba(192, 132, 252, 0.6)' },
        { name: '珊瑚红', hex: '#fb7185', bg: 'rgba(251, 113, 133, 0.18)', border: 'rgba(251, 113, 133, 0.6)' }
    ];

    function formatCoordLabel(coordStr) {
        const c = String(coordStr || 'C3').toUpperCase().trim();
        return COORD_LABELS[c] ? `${c} · ${COORD_LABELS[c]}` : c;
    }

    // ── Built-in Composition Templates ───────────────────────
    const BUILTIN_COMPOSITION_TEMPLATES = [
        {
            id: 'tpl_facing_each_other',
            name: '💑 面对面对视交流',
            desc: '双人近中景、侧面视角、对视眼神交互',
            scene: 'indoors, cozy living room, warm_lighting, cinematic_lighting, depth_of_field',
            camera: 'from_side, three-quarter_view, medium_shot',
            atmosphere: 'romantic atmosphere, soft_shadows',
            slots: [
                { charId: '', customName: '男主角 / 角色1', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, looking_at_partner, gentle_smile', center: 'B3', uc: 'girl, facing_viewer, 3d model artifact' },
                { charId: '', customName: '女主角 / 角色2', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, eye_contact, looking_at_partner, soft_smile, blush', center: 'D3', uc: 'boy, penis, futanari, facing_viewer, 3d model artifact' }
            ]
        },
        {
            id: 'tpl_intimate_hug',
            name: '🫂 亲密依偎与深情拥抱',
            desc: '双人紧紧相拥、近景特写、温存情感',
            scene: 'bedroom, morning sunlight, window, soft_light, blurry_background',
            camera: 'close-up, bust_shot, upper_body',
            atmosphere: 'intimate, sweet atmosphere, bokeh',
            slots: [
                { charId: '', customName: '拥抱者 / 角色1', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'embracing, hugging, arms_around_waist, closed_eyes, gentle', center: 'C3', uc: 'feet, shoes, lower_body' },
                { charId: '', customName: '依偎者 / 角色2', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'embracing, hugging_partner, head_on_chest, blushing, peaceful', center: 'C3', uc: 'feet, shoes, lower_body, penis, futanari' }
            ]
        },
        {
            id: 'tpl_kabedon',
            name: '💥 壁咚与强势对峙',
            desc: '单手压墙、低头俯视与害羞仰视',
            scene: 'hallway, wall, indoors, dramatic_lighting, soft_shadows',
            camera: 'three-quarter_view, cowboy_shot',
            atmosphere: 'tension, dramatic atmosphere',
            slots: [
                { charId: '', customName: '强势者 / 角色1', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'standing, kabedon, hand_on_wall, leaning_forward, looking_down, smirking', center: 'B3', uc: 'girl, facing_viewer' },
                { charId: '', customName: '受控者 / 角色2', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'backed_against_wall, sitting_or_standing, looking_up, wide_eyes, heavy_blush, nervous', center: 'C3', uc: 'boy, penis, futanari, facing_viewer' }
            ]
        },
        {
            id: 'tpl_holding_hands_walk',
            name: '🤝 牵手漫步与并肩前行',
            desc: '室外街头或校园、全身中景、并排牵手',
            scene: 'outdoors, street, autumn, falling_leaves, sunny_day, natural_lighting',
            camera: 'front_view, full_body, wide_angle',
            atmosphere: 'cheerful, refreshing atmosphere',
            slots: [
                { charId: '', customName: '角色 1', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'walking, holding_hands, looking_at_partner, happy', center: 'B3', uc: '' },
                { charId: '', customName: '角色 2', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'walking, holding_hands, looking_at_viewer, smiling, cute', center: 'D3', uc: 'penis, futanari' }
            ]
        },
        {
            id: 'tpl_from_behind_whisper',
            name: '🤫 背后环抱与耳畔低语',
            desc: '一人从身后环抱住另一人，近距离私语',
            scene: 'dimly_lit_room, night, moonlit, rim_lighting',
            camera: 'bust_shot, from_side',
            atmosphere: 'mysterious, sensual atmosphere',
            slots: [
                { charId: '', customName: '后方角色', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'behind_another, hugging_from_behind, whispering_in_ear, lips_near_ear', center: 'B3', uc: 'feet, shoes' },
                { charId: '', customName: '前方角色', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'in_front, head_tilted, trembling, parted_lips, surprised, blush', center: 'C3', uc: 'feet, shoes, penis, futanari' }
            ]
        },
        {
            id: 'tpl_cafe_table',
            name: '☕ 咖啡厅隔桌对坐',
            desc: '隔着桌子对坐、饮品道具、午后阳光',
            scene: 'cafe, coffee_shop, table, coffee_cup, afternoon, window_light, depth_of_field',
            camera: 'eye_level, mid_shot',
            atmosphere: 'casual, cozy atmosphere',
            slots: [
                { charId: '', customName: '角色 1', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'sitting_at_table, holding_cup, looking_at_partner, talking', center: 'B3', uc: 'feet, shoes' },
                { charId: '', customName: '角色 2', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'sitting_at_table, chin_on_hand, smiling, eye_contact', center: 'D3', uc: 'feet, shoes' }
            ]
        }
    ];

    // ── Storage Initializer ──────────────────────────────────
    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY] || typeof s[STORAGE_KEY] !== 'object') {
            s[STORAGE_KEY] = {
                version: VERSION,
                enabled: true,
                characters: {},
                presets: [],
                activeComposer: {
                    scene: 'indoors, cozy room, warm_lighting, soft_light',
                    camera: 'from_side, three-quarter_view, depth_of_field',
                    atmosphere: 'cinematic lighting, soft_shadows',
                    activeSlotIndex: 0,
                    slots: [
                        { charId: '', customName: '男主角', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, looking_at_partner', center: 'B3', uc: '' },
                        { charId: '', customName: '女主角', outfitMode: 'default', outfitId: '', customOutfit: '', action: 'sitting, facing_another, profile, looking_at_partner, blush', center: 'D3', uc: 'penis, futanari' }
                    ]
                }
            };
        }
        const store = s[STORAGE_KEY];
        if (!store.characters || typeof store.characters !== 'object') store.characters = {};
        if (!Array.isArray(store.presets)) store.presets = [];
        if (!store.activeComposer || typeof store.activeComposer !== 'object') {
            store.activeComposer = {
                scene: '',
                camera: '',
                atmosphere: '',
                activeSlotIndex: 0,
                slots: [
                    { charId: '', customName: '角色 1', outfitMode: 'default', outfitId: '', customOutfit: '', action: '', center: 'B3', uc: '' },
                    { charId: '', customName: '角色 2', outfitMode: 'default', outfitId: '', customOutfit: '', action: '', center: 'D3', uc: '' }
                ]
            };
        }
        if (store.activeComposer.activeSlotIndex === undefined) store.activeComposer.activeSlotIndex = 0;
        return store;
    }

    function save() {
        RBQ.api.saveSettings();
    }

    // ── Sync with Smart Draw Trigger Character Memory ─────────
    function getSdtCharacterProfiles() {
        try {
            const s = RBQ.api.getSettings();
            const sdt = s[SDT_STORAGE_KEY];
            if (!sdt || !sdt.characterProfiles || typeof sdt.characterProfiles !== 'object') return {};
            
            const result = {};
            for (const [key, val] of Object.entries(sdt.characterProfiles)) {
                if (val && typeof val === 'object') {
                    if (val.name && val.baseTags) {
                        result[val.name] = val;
                    } else {
                        for (const [subName, subProf] of Object.entries(val)) {
                            if (subProf && typeof subProf === 'object' && subProf.baseTags) {
                                result[subProf.name || subName] = subProf;
                            }
                        }
                    }
                }
            }
            return result;
        } catch (e) {
            console.warn('[Character Workshop] Failed to read SDT characterProfiles:', e);
            return {};
        }
    }

    function syncDossierToSdt(charObj) {
        if (!charObj || !charObj.name) return;
        try {
            const s = RBQ.api.getSettings();
            if (!s[SDT_STORAGE_KEY]) s[SDT_STORAGE_KEY] = {};
            if (!s[SDT_STORAGE_KEY].characterProfiles) s[SDT_STORAGE_KEY].characterProfiles = {};
            
            const chatKey = RBQ.api.getContext()?.chatId || 'global';
            if (!s[SDT_STORAGE_KEY].characterProfiles[chatKey]) {
                s[SDT_STORAGE_KEY].characterProfiles[chatKey] = {};
            }

            const activeOutfit = getCharacterActiveOutfitTags(charObj);

            s[SDT_STORAGE_KEY].characterProfiles[chatKey][charObj.name] = {
                name: charObj.name,
                baseTags: charObj.baseTags || '',
                currentOutfit: activeOutfit || '',
                learnedAt: Date.now(),
                messageIndex: 0
            };
            save();
            console.info(`[Character Workshop] Synced character "${charObj.name}" to SDT memory`);
        } catch (e) {
            console.warn('[Character Workshop] Failed to sync to SDT:', e);
        }
    }

    function getCharacterActiveOutfitTags(charObj, outfitMode = 'default', outfitId = '', customOutfit = '') {
        if (!charObj) return customOutfit || '';
        if (outfitMode === 'custom') return customOutfit || '';
        if (outfitMode === 'outfit' && outfitId && Array.isArray(charObj.wardrobe)) {
            const item = charObj.wardrobe.find(w => w.id === outfitId);
            if (item) return item.tags || '';
        }
        // default outfit
        if (charObj.currentOutfitId && Array.isArray(charObj.wardrobe)) {
            const item = charObj.wardrobe.find(w => w.id === charObj.currentOutfitId);
            if (item) return item.tags || '';
        }
        return charObj.currentOutfit || (charObj.wardrobe?.[0]?.tags) || '';
    }

    // ── Worldbook Integration Taxonomy ───────────────────────
    const LOREBOOK_TAXONOMY = {
        nsfw: {
            id: 'nsfw',
            name: '互动体位',
            icon: 'fa-solid fa-heart-pulse',
            color: '#ff79c6',
            subcategories: [
                { id: 'positions', name: '经典交合体位', keywords: ['正常位', '传教士', '骑乘位', '女上位', '后入位', '后背位', '狗爬式', '侧入位', '站交', '火车便当', '坐姿体位', '插入', '性交', '做爱', '交配', '对坐', '面对面', '背面', '肛交', '69式', '整体体位'], tagRegex: /\b(missionary|cowgirl_position|doggystyle|standing_sex|mating_press|spooning|sex_from_behind|sex|penetration|vaginal|anal)\b/i },
                { id: 'service', name: '口交/侍奉与器官交', keywords: ['口交', '深喉', '舔穴', '手交', '乳交', '揉胸', '抓乳', '腿交', '足交', '侍奉', '舔舐', '咬住', '吸吮', '舔脚', '胸部动作', '挤奶', '榨乳', '足穴', '素股', '腋交', '踩交', '扣穴', '袭胸', '飞机杯'], tagRegex: /\b(fellatio|deepthroat|cunnilingus|handjob|paizuri|footjob|thighjob|oral|licking|breast_grab|nipple_tweak|lactation|tribadism)\b/i },
                { id: 'masturbation_fluids', name: '自慰/高潮与体液', keywords: ['自慰', '手淫', '跳蛋', '假阳具', '振动棒', '情趣玩具', '高潮', '绝顶', '潮吹', '受孕', '孕肚', '分娩', '阿黑颜', '颜射', '饮精', '内射', '中出', '精液', '事后'], tagRegex: /\b(masturbation|dildo|vibrator|orgasm|squirt|impregnation|pregnant|ahegao|facial|creampie|bukkake|cum|aftersex)\b/i },
                { id: 'bdsm_control', name: '调教/拘束与BDSM', keywords: ['调教', '母狗', '拘束', '拘束放置', '束缚', '肉便器', '绳缚', '木马', '驷马缚', '手铐', '项圈', '牵引', '链条', '贞操带', '口塞', 'BDSM', '羞辱', '支配', '臣服', '女奴', '窒息', '穿环', '淫纹'], tagRegex: /\b(bondage|ropes|handcuffs|blindfold|collar_leash|bdsm|humiliation|submissive|piercing|spanking)\b/i },
                { id: 'group_ntr', name: '群交/多人与百合', keywords: ['多p', '轮奸', '群交', '多男一女', '多女一男', '双飞', '3p', '前后夹击', '百合', '女同', '群P', '露出', '街头露出', '偷拍', '偷窥', '绿帽', 'NTR', '壁尻', '光荣洞'], tagRegex: /\b(gangbang|group_sex|threesome|double_penetration|yuri|lesbian|exhibitionism|voyeurism|ntr)\b/i }
            ]
        },
        outfit: {
            id: 'outfit',
            name: '服装穿搭',
            icon: 'fa-solid fa-shirt',
            color: '#ffb86c',
            subcategories: [
                { id: 'casual', name: '日常私服', keywords: ['服装', '日常服', '私服', '日常', 'T恤', '卫衣', '衬衫', '毛衣', '外套', '夹克', '大衣', '牛仔裤', '短裙', '百褶裙', '连衣裙', '裙子', '和服', '汉服', '吊带裙', '冬装', '风衣'] },
                { id: 'uniform', name: '制服职业', keywords: ['制服', '校服', '水手服', '西装', '女仆', '护士', '修女', '警服', '旗袍', '巫女', '军服', '职场', 'OL', '兔女郎', '体操服', '运动服', '啦啦队', '魔法少女'] },
                { id: 'swimwear', name: '泳装内衣', keywords: ['泳装', '泳衣', '比基尼', '死库水', '内衣', '文胸', '胸罩', '内裤', '胖次', '情趣内衣', '蕾丝内衣', '吊带睡衣', '睡衣', '浴袍'] },
                { id: 'accessories', name: '鞋袜饰品', keywords: ['鞋袜', '丝袜', '黑丝', '白丝', '过膝袜', '短袜', '吊袜带', '高跟鞋', '靴子', '手套', '项圈', '手镯', '项链', '耳环', '帽子', '头饰', '眼镜'] },
                { id: 'costume', name: '情趣特装', keywords: ['胶衣', '紧身衣', '皮衣', '魅魔装', '透视装', '镂空', '兽装', '拘束装', '裸体围裙', '机甲', '铠甲'] }
            ]
        },
        pose: {
            id: 'pose',
            name: '日常姿态',
            icon: 'fa-solid fa-person-walking',
            color: '#a3ffa3',
            subcategories: [
                { id: 'single_action', name: '单人动作', keywords: ['动作', '姿势', '站姿', '坐姿', '躺姿', '趴姿', '跪姿', '倾靠', '走', '跑', '跳', '蹲', '单手插腰', '双手抱胸', '托腮', '挥手', '比心', '伸手', '撩发'] },
                { id: 'fitness_food', name: '日常活动', keywords: ['健身', '跑步', '瑜伽', '拉伸', '一字马', '吃饭', '吃东西', '美食', '喝水', '饮水', '喝酒', '洗澡', '淋浴'] },
                { id: 'dynamic_combat', name: '战斗动态', keywords: ['战斗', '拔刀', '施法', '跳跃', '飞踢', '回眸', '冲刺', '防守', '持枪', '持剑', '蓄力', '射击', '打斗'] }
            ]
        },
        interaction: {
            id: 'interaction',
            name: '双人互动',
            icon: 'fa-solid fa-people-arrows',
            color: '#79e4ff',
            subcategories: [
                { id: 'duo_gentle', name: '亲密温情', keywords: ['互动', '双人', '接吻', '亲吻', '相拥', '拥抱', '牵手', '依偎', '对视', '摸头', '捏脸', '公主抱', '背着', '靠肩', '耳语'] },
                { id: 'duo_daily', name: '日常社交', keywords: ['对话', '聊天', '打闹', '并肩', '跳舞', '递东西', '敬酒', '拍照', '合影', '共进晚餐'] }
            ]
        },
        appearance: {
            id: 'appearance',
            name: '外貌特征',
            icon: 'fa-solid fa-user-astronaut',
            color: '#79e4ff',
            subcategories: [
                { id: 'hair', name: '发型发色', keywords: ['发型', '发色', '双马尾', '单马尾', '短发', '长发', '马尾', '刘海', '编发', '呆毛', '发饰'] },
                { id: 'eyes', name: '眼部瞳色', keywords: ['眼', '瞳', '瞳色', '异色瞳', '眼睛', '红瞳', '蓝瞳', '金瞳', '绿瞳', '爱心眼', '魔眼'] },
                { id: 'face', name: '面部表情', keywords: ['表情', '脸部', '脸红', '微笑', '哭泣', '生气', '张嘴', '吐舌', '害羞', '傲娇', '嘟嘴'] },
                { id: 'race', name: '种族特征', keywords: ['种族', '兽耳', '猫耳', '狐耳', '兔耳', '狗耳', '狼耳', '精灵耳', '尾巴', '翅膀', '羽翼', '角', '恶魔角', '光环', '天使', '魅魔', '机娘'] },
                { id: 'body', name: '身材体型', keywords: ['身材', '体型', '胸部', '巨乳', '贫乳', '爆乳', '微乳', '腹肌', '肉感', '大腿', '长腿', '身高', '肤色', '黑皮', '白皙', '肌肉', '锁骨'] }
            ]
        },
        scene: {
            id: 'scene',
            name: '场景环境',
            icon: 'fa-solid fa-mountain-sun',
            color: '#f1fa8c',
            subcategories: [
                { id: 'indoor', name: '室内场所', keywords: ['室内', '房间', '卧室', '床', '教室', '学校', '浴室', '温泉', '厨房', '客厅', '办公室', '图书馆', '咖啡厅', '酒吧', '酒店', '走廊', '阳台', '车内', '电梯'] },
                { id: 'outdoor', name: '室外自然', keywords: ['室外', '户外', '海滩', '海边', '海', '森林', '树林', '公园', '街道', '城市', '小巷', '屋顶', '天台', '草地', '花园', '夜景', '星空', '夕阳'] },
                { id: 'fantasy', name: '奇幻科幻', keywords: ['奇幻', '科幻', '废墟', '城堡', '宫殿', '神殿', '太空', '宇宙', '飞船', '魔法阵', '赛博朋克', '异世界'] }
            ]
        },
        camera: {
            id: 'camera',
            name: '镜头光影',
            icon: 'fa-solid fa-camera',
            color: '#bd93f9',
            subcategories: [
                { id: 'camera_angle', name: '镜头视角', keywords: ['视角', '机位', '构图', '特写', '面部特写', '半身', '全身', '俯视', '仰视', 'POV', '第一人称', '侧面', '背影', '荷兰角', '广角', '对焦', '过肩'] },
                { id: 'lighting', name: '光影氛围', keywords: ['光影', '光照', '逆光', '丁达尔', '体积光', '发光', '霓虹', '暗色调', '明亮', '柔光', '电影感', '镜头光晕', '氛围', '景深'] }
            ]
        }
    };

    function extractNativeTopic(comment) {
        if (!comment) return '综合';
        let c = comment.trim().replace(/^[\*#\s]+/, '').replace(/[-_—－\s]*(new|常规|新版|横图|竖图|自用|测试)$/i, '');
        const bracketMatch = c.match(/^[【\[（\(]([^】\]）\)]+)[】\]）\)]/);
        if (bracketMatch) return bracketMatch[1].trim();
        const parts = c.split(/[-_—－\:\：\/]/).map(p => p.trim()).filter(Boolean);
        return parts[0] || c.slice(0, 10);
    }

    function classifyLorebookEntry(comment, content, keys = []) {
        const c = String(comment || '').trim();
        const body = String(content || '').trim();
        const keyList = Array.isArray(keys) ? keys.map(k => String(k).trim()).filter(Boolean) : [];
        const nativeTopic = extractNativeTopic(comment);
        const titleLower = nativeTopic.toLowerCase();
        const allText = `${c} ${keyList.join(' ')} ${body.slice(0, 150)}`.toLowerCase();

        for (const [catKey, catDef] of Object.entries(LOREBOOK_TAXONOMY)) {
            for (const sub of catDef.subcategories) {
                if (sub.keywords) {
                    for (const kw of sub.keywords) {
                        const kwLower = kw.toLowerCase();
                        if (titleLower === kwLower || titleLower.startsWith(kwLower) || titleLower.includes(kwLower)) {
                            return { categoryId: catKey, categoryName: catDef.name, subId: sub.id, subName: sub.name, nativeTopic };
                        }
                    }
                }
                if (sub.tagRegex && (sub.tagRegex.test(body) || sub.tagRegex.test(c))) {
                    return { categoryId: catKey, categoryName: catDef.name, subId: sub.id, subName: sub.name, nativeTopic };
                }
            }
        }

        for (const [catKey, catDef] of Object.entries(LOREBOOK_TAXONOMY)) {
            for (const sub of catDef.subcategories) {
                if (sub.keywords) {
                    for (const kw of sub.keywords) {
                        if (allText.includes(kw.toLowerCase())) {
                            return { categoryId: catKey, categoryName: catDef.name, subId: sub.id, subName: sub.name, nativeTopic };
                        }
                    }
                }
            }
        }

        return { categoryId: 'pose', categoryName: '日常姿态', subId: 'single_action', subName: '单人动作', nativeTopic };
    }

    function getAllAvailableWorldbookEntries() {
        const entries = [];
        try {
            const s = RBQ.api.getSettings();
            const sdt = s[SDT_STORAGE_KEY];
            if (sdt?.lorebookStore?.sources) {
                for (const src of sdt.lorebookStore.sources) {
                    if (!src.enabled || !Array.isArray(src.entries)) continue;
                    for (const e of src.entries) {
                        if (!e.enabled && e.enabled !== undefined) continue;
                        const comment = e.comment || e.keys?.[0] || '未命名词条';
                        const content = e.content || '';
                        if (!content.trim()) continue;
                        const classification = classifyLorebookEntry(comment, content, e.keys || []);
                        entries.push({
                            id: e.id || uid('wb'),
                            comment,
                            content,
                            keys: e.keys || [],
                            sourceName: src.name || '世界书',
                            ...classification
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('[Character Workshop] Error reading worldbooks:', err);
        }
        return entries;
    }

    function extractLorebookSubVariants(content) {
        if (!content) return [];
        const lines = String(content).split('\n').map(l => l.trim()).filter(Boolean);
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
            variants.push({ label: '默认版', tags: lines.join(', ') });
        }
        return variants;
    }

    // ── 7-Dimensional Holographic Trait Presets ───────────────
    const HOLOGRAPHIC_TRAIT_GROUPS = [
        {
            group: '① 族裔面相与性别 (Ethnicity & Gender)',
            color: '#38bdf8',
            tags: [
                { name: '1girl (女性)', tag: '1girl' },
                { name: '1boy (男性)', tag: '1boy' },
                { name: '日系面相', tag: 'japanese, delicate_face' },
                { name: '东亚面相', tag: 'east_asian, delicate_face' },
                { name: '西方/欧式面相', tag: 'caucasian, western' },
                { name: '中华风面相', tag: 'chinese' },
                { name: '精致动漫五官', tag: 'delicate_face, anime_face' },
                { name: '帅气中性脸', tag: 'androgynous, handsome_female' },
                { name: '辣妹系 (Gyaru)', tag: 'gyaru' },
                { name: '幼态可爱脸 (Doll)', tag: 'doll_face, cute_face' }
            ]
        },
        {
            group: '② 年龄阶段 (Age Stage)',
            color: '#fbbf24',
            tags: [
                { name: '青春少女 (14~18岁)', tag: 'adolescent, teenager, young_girl' },
                { name: '成熟御姐 (20~30岁)', tag: 'mature_female, adult_female' },
                { name: '娇小萝莉/少女', tag: 'petite, young_girl' },
                { name: '成熟男性 (青年/少年)', tag: 'mature_male, muscular_male' },
                { name: '不良少年', tag: 'delinquent, sharp_eyes' },
                { name: '少年正太 (Bishounen)', tag: 'bishounen, pretty_boy' }
            ]
        },
        {
            group: '③ 发型与发色 (Hair Style & Color)',
            color: '#f472b6',
            tags: [
                { name: '黑发 (Black)', tag: 'black_hair' },
                { name: '银发/白发 (Silver/White)', tag: 'silver_hair, white_hair' },
                { name: '金发 (Blonde)', tag: 'blonde_hair' },
                { name: '粉发 (Pink)', tag: 'pink_hair' },
                { name: '蓝发 (Blue)', tag: 'blue_hair' },
                { name: '红发 (Red)', tag: 'red_hair' },
                { name: '棕发/茶发 (Brown)', tag: 'brown_hair' },
                { name: '双马尾 (Twin Tails)', tag: 'twin_tails' },
                { name: '单马尾 (Ponytail)', tag: 'ponytail' },
                { name: '及腰长发 (Very Long)', tag: 'very_long_hair, straight_hair' },
                { name: '齐肩短发 (Short Bob)', tag: 'short_hair, bob_cut' },
                { name: '波浪大卷发 (Wavy)', tag: 'wavy_hair, long_hair' },
                { name: '齐刘海 (Blunt Bangs)', tag: 'blunt_bangs' },
                { name: '空气刘海 (Air Bangs)', tag: 'air_bangs' },
                { name: '侧单马尾 (Side Ponytail)', tag: 'side_ponytail' },
                { name: '麻花辫/编发 (Braids)', tag: 'braid, twin_braids' },
                { name: '可爱呆毛 (Ahoge)', tag: 'ahoge' }
            ]
        },
        {
            group: '④ 瞳色与眼型 (Eyes & Pupil)',
            color: '#a855f7',
            tags: [
                { name: '红瞳 (Red Eyes)', tag: 'red_eyes' },
                { name: '蓝瞳 (Blue Eyes)', tag: 'blue_eyes' },
                { name: '金瞳/琥珀瞳 (Amber/Gold)', tag: 'amber_eyes, golden_eyes' },
                { name: '绿瞳 (Green Eyes)', tag: 'green_eyes' },
                { name: '紫瞳 (Purple Eyes)', tag: 'purple_eyes' },
                { name: '异色瞳 (Heterochromia)', tag: 'heterochromia' },
                { name: '垂眼/温柔眼 (Tareme)', tag: 'tareme' },
                { name: '吊眼/高冷猫眼 (Tsurime)', tag: 'tsurime' },
                { name: '爱心瞳 (Heart Pupils)', tag: 'heart-shaped_pupils' },
                { name: '半睁蔑视眼', tag: 'half-closed_eyes' },
                { name: '水汪汪大眼睛', tag: 'large_eyes, sparkling_eyes' }
            ]
        },
        {
            group: '⑤ 胸型体态与身材 (Body & Breasts)',
            color: '#4ade80',
            tags: [
                { name: '纤细苗条 (Slender)', tag: 'slender' },
                { name: '娇小体态 (Petite)', tag: 'petite' },
                { name: '丰满S曲线 (Curvy)', tag: 'curvy' },
                { name: '高挑长腿 (Tall)', tag: 'tall, long_legs' },
                { name: '平胸/极贫 (Flat)', tag: 'flat_chest' },
                { name: '小胸微乳 (Small)', tag: 'small_breasts' },
                { name: '中等丰满 (Medium)', tag: 'medium_breasts' },
                { name: '巨乳丰满 (Large)', tag: 'large_breasts' },
                { name: '超大爆乳 (Huge)', tag: 'huge_breasts' },
                { name: '紧致马甲线 (Abs)', tag: 'toned, abs' },
                { name: '肉感多肉大腿 (Thick Thighs)', tag: 'thick_thighs' },
                { name: '丰臀/宽胯 (Wide Hips)', tag: 'wide_hips, big_ass' }
            ]
        },
        {
            group: '⑥ 肤色与专属标记 (Skin & Marks)',
            color: '#fb7185',
            tags: [
                { name: '白皙冷白皮 (Pale Skin)', tag: 'pale_skin' },
                { name: '自然透亮 (Fair Skin)', tag: 'fair_skin' },
                { name: '健康小麦/黑皮 (Tan/Dark)', tag: 'tan, dark_skin' },
                { name: '泪痣 (Mole under eye)', tag: 'mole_under_eye' },
                { name: '唇角美人痣 (Mole at mouth)', tag: 'mole_near_mouth' },
                { name: '胸口美人痣 (Mole on breast)', tag: 'mole_on_breast' },
                { name: '可爱雀斑 (Freckles)', tag: 'freckles' },
                { name: '淫纹/子宫纹 (Womb tattoo)', tag: 'womb_tattoo' },
                { name: '自然微红晕 (Blush)', tag: 'blush' }
            ]
        },
        {
            group: '⑦ 种族与幻想特征 (Race & Fantasy)',
            color: '#38bdf8',
            tags: [
                { name: '猫耳+猫尾 (Cat ears)', tag: 'cat_ears, cat_tail' },
                { name: '狐狸耳+大尾巴 (Fox ears)', tag: 'fox_ears, fox_tail' },
                { name: '兔耳+兔尾 (Rabbit ears)', tag: 'rabbit_ears, rabbit_tail' },
                { name: '狼耳+狼尾 (Wolf ears)', tag: 'wolf_ears, wolf_tail' },
                { name: '精灵尖耳 (Pointy ears)', tag: 'pointy_ears' },
                { name: '恶魔角+蝠翼 (Demon horns)', tag: 'demon_horns, demon_wings' },
                { name: '天使光环+羽翼 (Halo)', tag: 'halo, angel_wings' },
                { name: '魅魔特征 (Succubus)', tag: 'succubus, demon_tail' },
                { name: '吸血鬼小虎牙 (Fangs)', tag: 'fangs, vampire' }
            ]
        }
    ];

    const OUTFIT_PRESET_TAGS = [
        { name: '经典水手服 (Serafuku)', tags: 'sailor_suit, pleated_skirt, sailor_collar, neckerchief' },
        { name: '西装校服 (Blazer)', tags: 'school_uniform, blazer, pleated_skirt, necktie, collared_shirt' },
        { name: '优雅女仆装 (Maid)', tags: 'maid_outfit, frilled_apron, maid_headdress, black_dress, white_apron' },
        { name: '兔女郎皮衣 (Bunny Suit)', tags: 'bunny_suit, bunny_ears, fishnet_pantyhose, collar, bowtie' },
        { name: '死库水泳装 (School Swimsuit)', tags: 'school_swimsuit, one-piece_swimsuit' },
        { name: '比基尼泳衣 (Bikini)', tags: 'bikini, side-tie_bikini_bottom, cleavage' },
        { name: '黑色真丝睡衣 (Silk Nightgown)', tags: 'black_silk_nightgown, spaghetti_strap, deep_v-neck, lace_trim' },
        { name: '日常连帽卫衣 (Hoodie)', tags: 'casual_clothes, hoodie, denim_shorts, sneakers' },
        { name: '露肩针织毛衣 (Off-Shoulder)', tags: 'off-shoulder_sweater, knit_sweater, bare_shoulders, tight_skirt' },
        { name: '高叉旗袍 (Cheongsam)', tags: 'china_dress, cheongsam, high_slit, floral_print' },
        { name: '日式和服/浴衣 (Yukata)', tags: 'yukata, kimono, obi, floral_print' },
        { name: '情趣透视蕾丝 (Lingerie)', tags: 'lace_lingerie, see-through_bra, lace_panties, garter_straps' },
        { name: '修女修道袍 (Nun Habit)', tags: 'nun_habit, veil, black_dress, white_collar, cross_necklace' },
        { name: '全裸 (Nude / Bare)', tags: 'nude, bare_shoulders, uncensored' }
    ];

    // ── Live Prompt Synthesizer ──────────────────────────────
    function composeFinalPrompt(comp) {
        const store = getStore();
        const slots = Array.isArray(comp?.slots) ? comp.slots : [];
        const sceneParts = [comp?.scene, comp?.camera, comp?.atmosphere].filter(Boolean).join(', ');
        
        const charParts = [];
        slots.forEach((s, idx) => {
            const charObj = store.characters[s.charId];
            const base = charObj?.baseTags || (s.customName ? `${s.customName}` : '');
            const outfit = getCharacterActiveOutfitTags(charObj, s.outfitMode, s.outfitId, s.customOutfit);
            const action = s.action || '';
            const caption = [base, outfit, action].filter(Boolean).join(', ');
            const pos = s.center || (idx === 0 ? 'B3' : 'D3');
            
            if (caption) {
                charParts.push(`Char${idx + 1}:${caption}|centers:${pos}`);
            }
            if (s.uc && s.uc.trim()) {
                charParts.push(`Char${idx + 1} UC:${s.uc.trim()}`);
            }
        });

        const sceneSection = sceneParts ? `Scene:${sceneParts}` : '';
        return [sceneSection, ...charParts].filter(Boolean).join('; ');
    }

    // ── CSS Style Injection ──────────────────────────────────
    (function injectStyles() {
        if (document.getElementById('rbq-character-workshop-styles')) return;
        const style = document.createElement('style');
        style.id = 'rbq-character-workshop-styles';
        style.textContent = `
/* ── Character Workshop 2.0 Glassmorphism UI ── */
.cw-container { display: flex; flex-direction: column; width: 100%; height: 100%; box-sizing: border-box; color: #f1f5f9; font-family: inherit; }
.cw-header-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(12px); gap: 12px; flex-wrap: wrap; }
.cw-title-wrap { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #38bdf8; }
.cw-tab-nav { display: flex; gap: 6px; align-items: center; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
.cw-tab-btn { background: transparent; border: none; color: rgba(255,255,255,0.65); padding: 6px 12px; font-size: 12.5px; font-weight: 600; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 6px; }
.cw-tab-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
.cw-tab-btn.active { color: #38bdf8; background: rgba(56, 189, 248, 0.15); box-shadow: 0 2px 8px rgba(56, 189, 248, 0.2); }

.cw-body-content { flex: 1; overflow-y: auto; padding: 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; }

/* ── Common Card / Section ── */
.cw-card { background: rgba(30, 41, 59, 0.45); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; box-sizing: border-box; backdrop-filter: blur(8px); display: flex; flex-direction: column; gap: 10px; }
.cw-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cw-card-title { font-size: 13.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; color: #e2e8f0; }

/* ── Interactive 5x5 Stage Matrix ── */
.cw-stage-grid-wrapper { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.cw-stage-canvas { width: 260px; height: 260px; background: rgba(15, 23, 42, 0.7); border: 1.5px solid rgba(56, 189, 248, 0.35); border-radius: 10px; display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(5, 1fr); gap: 2px; padding: 4px; box-sizing: border-box; position: relative; box-shadow: inset 0 0 20px rgba(0,0,0,0.5); }
.cw-stage-cell { background: rgba(255,255,255,0.03); border-radius: 4px; border: 1px dashed rgba(255,255,255,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; position: relative; font-size: 10px; color: rgba(255,255,255,0.3); font-weight: bold; }
.cw-stage-cell:hover { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.5); color: #38bdf8; }
.cw-stage-cell.has-char { border-style: solid; }
.cw-stage-pin { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.6); position: absolute; z-index: 2; transform: scale(0.95); transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); }
.cw-stage-cell:hover .cw-stage-pin { transform: scale(1.15); }

.cw-stage-info { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: rgba(255,255,255,0.7); }
.cw-slot-pins-legend { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.cw-slot-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; }

/* ── Slots Grid & Slot Card ── */
.cw-slots-list { display: flex; flex-direction: column; gap: 12px; }
.cw-slot-box { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.2s; position: relative; }
.cw-slot-box.active-slot { border-color: #38bdf8; box-shadow: 0 0 12px rgba(56, 189, 248, 0.15); }
.cw-slot-top-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.cw-slot-badge { padding: 2px 8px; border-radius: 6px; font-size: 11.5px; font-weight: bold; }
.cw-slot-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }

/* ── Inputs & Buttons ── */
.cw-input, .cw-select, .cw-textarea { width: 100%; box-sizing: border-box; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: #fff; padding: 6px 10px; font-size: 12px; font-family: inherit; transition: border-color 0.2s; }
.cw-input:focus, .cw-select:focus, .cw-textarea:focus { outline: none; border-color: #38bdf8; background: rgba(0, 0, 0, 0.5); }
.cw-textarea { min-height: 50px; resize: vertical; font-family: monospace; }

.cw-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all 0.2s ease; background: rgba(255,255,255,0.08); color: #fff; }
.cw-btn:hover { filter: brightness(1.2); }
.cw-btn.primary { background: linear-gradient(135deg, #0284c7, #38bdf8); color: #fff; border-color: rgba(56,189,248,0.5); box-shadow: 0 2px 10px rgba(56,189,248,0.3); }
.cw-btn.cyan { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8; }
.cw-btn.pink { background: rgba(244, 114, 182, 0.15); border-color: rgba(244, 114, 182, 0.4); color: #f472b6; }
.cw-btn.green { background: rgba(74, 222, 128, 0.15); border-color: rgba(74, 222, 128, 0.4); color: #4ade80; }
.cw-btn.amber { background: rgba(251, 191, 36, 0.15); border-color: rgba(251, 191, 36, 0.4); color: #fbbf24; }
.cw-btn.red { background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.4); color: #ef4444; }
.cw-btn.sm { padding: 3px 8px; font-size: 11px; }

/* ── Live Preview Box ── */
.cw-preview-panel { background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.cw-preview-code { background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; font-family: monospace; font-size: 11.5px; color: #a5f3fc; word-break: break-all; max-height: 120px; overflow-y: auto; }

/* ── Character Dossier Grid ── */
.cw-char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.cw-char-card { background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; transition: transform 0.2s, border-color 0.2s; position: relative; }
.cw-char-card:hover { transform: translateY(-2px); border-color: rgba(56, 189, 248, 0.4); box-shadow: 0 8px 20px rgba(0,0,0,0.4); }
.cw-char-head { display: flex; gap: 10px; align-items: center; }
.cw-char-avatar { width: 46px; height: 46px; border-radius: 8px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; font-size: 20px; overflow: hidden; flex-shrink: 0; }
.cw-char-avatar img { width: 100%; height: 100%; object-fit: cover; }
.cw-char-meta { flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 2px; }
.cw-char-title { font-size: 13px; font-weight: 700; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cw-char-base-text { font-size: 11px; color: rgba(255,255,255,0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Modal Overlay ── */
.cw-modal-mask { position: fixed; inset: 0; z-index: 100000020; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
.cw-modal-box { background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 14px; width: 800px; max-width: 96vw; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 60px rgba(0,0,0,0.9); }
.cw-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(56, 189, 248, 0.08); }
.cw-modal-body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
.cw-modal-foot { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.3); }

/* ── Chip Selectors ── */
.cw-chip-btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 3px 7px; font-size: 11px; color: rgba(255,255,255,0.8); cursor: pointer; transition: all 0.15s; }
.cw-chip-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
.cw-chip-btn.active { background: rgba(56, 189, 248, 0.25) !important; border-color: rgba(56, 189, 248, 0.7) !important; color: #38bdf8 !important; font-weight: bold; }
        `;
        document.head.appendChild(style);
    })();

    // ── Quick Tag Append / Toggle ────────────────────────────
    function appendOrToggleTag(currentText, newTag) {
        if (!currentText) return newTag;
        const list = currentText.split(',').map(s => s.trim()).filter(Boolean);
        const exists = list.some(item => item.toLowerCase() === newTag.toLowerCase());
        if (exists) {
            return list.filter(item => item.toLowerCase() !== newTag.toLowerCase()).join(', ');
        } else {
            return [...list, newTag].join(', ');
        }
    }

    // ── Worldbook Picker Modal ────────────────────────────────
    function openWorldbookPickerModal({ title = '选择世界书词条', targetCategory = null } = {}, onSelectCallback) {
        const allEntries = getAllAvailableWorldbookEntries();
        let selectedCategory = targetCategory || 'all';
        let searchQuery = '';

        const modal = document.createElement('div');
        modal.className = 'cw-modal-mask';
        
        function getFiltered() {
            return allEntries.filter(e => {
                const matchCat = selectedCategory === 'all' || e.categoryId === selectedCategory;
                const matchSearch = !searchQuery || e.comment.toLowerCase().includes(searchQuery) || e.content.toLowerCase().includes(searchQuery);
                return matchCat && matchSearch;
            });
        }

        function render() {
            const filtered = getFiltered();
            modal.innerHTML = `
                <div class="cw-modal-box" style="width: 860px;">
                    <div class="cw-modal-head">
                        <strong style="color: #38bdf8; font-size: 14.5px; display: inline-flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-book-open"></i> ${escapeHtml(title)}
                        </strong>
                        <button class="cw-btn sm" id="rbq-cw-wbp-close">✕</button>
                    </div>
                    <div style="display: flex; gap: 10px; padding: 10px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.2); align-items: center;">
                        <input id="rbq-cw-wbp-search" class="cw-input" type="text" placeholder="🔍 搜索世界书词条名称或关键词..." value="${escapeHtml(searchQuery)}" style="flex: 1;" />
                        <div class="cw-tab-nav" style="overflow-x: auto;">
                            <button class="cw-tab-btn ${selectedCategory === 'all' ? 'active' : ''}" data-cat="all">全部 (${allEntries.length})</button>
                            ${Object.values(LOREBOOK_TAXONOMY).map(c => `
                                <button class="cw-tab-btn ${selectedCategory === c.id ? 'active' : ''}" data-cat="${c.id}">
                                    <i class="${c.icon}"></i> ${c.name}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="cw-modal-body" style="max-height: 55vh; gap: 8px;">
                        ${filtered.length === 0 ? `<div style="text-align: center; padding: 30px; opacity: 0.6;">未搜索到匹配的世界书词条</div>` : filtered.map((e, idx) => {
                            const variants = extractLorebookSubVariants(e.content);
                            return `
                                <div class="cw-card" style="padding: 10px 12px; gap: 6px;">
                                    <div class="cw-card-header">
                                        <div style="display: inline-flex; align-items: center; gap: 6px;">
                                            <span class="cw-slot-badge" style="background: rgba(56,189,248,0.15); color: #38bdf8;">${escapeHtml(e.categoryName)}</span>
                                            <strong style="font-size: 13px; color: #f1f5f9;">${escapeHtml(e.comment)}</strong>
                                            <span style="font-size: 11px; opacity: 0.5;">(${escapeHtml(e.sourceName)})</span>
                                        </div>
                                        <div style="display: inline-flex; gap: 6px;">
                                            ${variants.length > 1 ? `
                                                <button class="cw-btn cyan sm rbq-cw-wbp-expand-variants" data-index="${idx}">
                                                    展开 ${variants.length} 个子变体
                                                </button>
                                            ` : `
                                                <button class="cw-btn green sm rbq-cw-wbp-pick-single" data-index="${idx}">
                                                    填入此词条
                                                </button>
                                            `}
                                        </div>
                                    </div>
                                    <div style="font-family: monospace; font-size: 11px; color: rgba(255,255,255,0.7); max-height: 48px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        ${escapeHtml(e.content.slice(0, 160))}...
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="cw-modal-foot">
                        <span style="font-size: 11.5px; opacity: 0.6;">共载入 ${allEntries.length} 条世界书词库</span>
                        <button class="cw-btn" id="rbq-cw-wbp-cancel">关闭</button>
                    </div>
                </div>
            `;

            modal.querySelector('#rbq-cw-wbp-close')?.addEventListener('click', () => modal.remove());
            modal.querySelector('#rbq-cw-wbp-cancel')?.addEventListener('click', () => modal.remove());
            modal.querySelector('#rbq-cw-wbp-search')?.addEventListener('input', (ev) => {
                searchQuery = ev.target.value.trim().toLowerCase();
                render();
            });
            modal.querySelectorAll('.cw-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedCategory = btn.dataset.cat;
                    render();
                });
            });
            modal.querySelectorAll('.rbq-cw-wbp-pick-single').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const item = filtered[idx];
                    if (item && onSelectCallback) {
                        onSelectCallback(item.content.trim(), item.comment);
                        modal.remove();
                    }
                });
            });
            modal.querySelectorAll('.rbq-cw-wbp-expand-variants').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const item = filtered[idx];
                    const variants = extractLorebookSubVariants(item.content);
                    openVariantSelectDialog(item.comment, variants, (tags) => {
                        if (onSelectCallback) onSelectCallback(tags, item.comment);
                        modal.remove();
                    });
                });
            });
        }

        render();
        document.body.appendChild(modal);
    }

    function openVariantSelectDialog(title, variants, onSelect) {
        const vmodal = document.createElement('div');
        vmodal.className = 'cw-modal-mask';
        vmodal.innerHTML = `
            <div class="cw-modal-box" style="width: 580px;">
                <div class="cw-modal-head">
                    <strong style="color: #38bdf8;"><i class="fa-solid fa-list-check"></i> 选择「${escapeHtml(title)}」子变体</strong>
                    <button class="cw-btn sm" id="rbq-cw-var-close">✕</button>
                </div>
                <div class="cw-modal-body" style="gap: 8px;">
                    ${variants.map((v, i) => `
                        <div class="cw-card" style="padding: 10px; cursor: pointer;" data-vidx="${i}">
                            <div class="cw-card-header">
                                <strong style="font-size: 12.5px; color: #38bdf8;">${escapeHtml(v.label)}</strong>
                                <button class="cw-btn green sm">选择此版</button>
                            </div>
                            <div style="font-family: monospace; font-size: 11px; color: rgba(255,255,255,0.7);">${escapeHtml(v.tags)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        vmodal.querySelector('#rbq-cw-var-close')?.addEventListener('click', () => vmodal.remove());
        vmodal.querySelectorAll('[data-vidx]').forEach(el => {
            el.addEventListener('click', () => {
                const idx = Number(el.dataset.vidx);
                if (variants[idx]) {
                    onSelect(variants[idx].tags);
                    vmodal.remove();
                }
            });
        });
        document.body.appendChild(vmodal);
    }

    // ── Character Dossier & Wardrobe Editor Modal ─────────────
    function openCharacterEditorModal(charId = null, onSaved) {
        const store = getStore();
        const isEdit = !!(charId && store.characters[charId]);
        const char = isEdit ? JSON.parse(JSON.stringify(store.characters[charId])) : {
            id: uid('char'),
            name: '',
            avatarUrl: '',
            baseTags: '',
            currentOutfitId: '',
            currentOutfit: '',
            wardrobe: [
                { id: uid('wardrobe'), name: '默认服装', tags: 'school_uniform, pleated_skirt' }
            ]
        };
        if (!Array.isArray(char.wardrobe) || char.wardrobe.length === 0) {
            char.wardrobe = [{ id: uid('wardrobe'), name: '默认服装', tags: char.currentOutfit || '' }];
        }

        let activeWardrobeIndex = 0;

        const modal = document.createElement('div');
        modal.className = 'cw-modal-mask';

        function render() {
            modal.innerHTML = `
                <div class="cw-modal-box" style="width: 820px;">
                    <div class="cw-modal-head">
                        <strong style="color: #38bdf8; font-size: 14.5px; display: inline-flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-id-card"></i> ${isEdit ? `编辑角色档案 · 「${escapeHtml(char.name || '未命名')}」` : '✨ 创造全新角色档案'}
                        </strong>
                        <button class="cw-btn sm" id="rbq-cw-ce-close">✕</button>
                    </div>

                    <div class="cw-modal-body">
                        <!-- Top Info -->
                        <div class="cw-card" style="padding: 10px 14px;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <div id="rbq-cw-avatar-box" style="width: 52px; height: 52px; border-radius: 8px; background: rgba(0,0,0,0.4); border: 1px solid rgba(56,189,248,0.3); display: flex; align-items: center; justify-content: center; font-size: 22px; overflow: hidden; flex-shrink: 0;">
                                    ${char.avatarUrl ? `<img src="${escapeHtml(char.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;" />` : '👤'}
                                </div>
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                                    <div style="display: flex; gap: 8px;">
                                        <input id="rbq-cw-ce-name" class="cw-input" type="text" placeholder="角色姓名 (例如: 纱仓桃 / Alice (original))" value="${escapeHtml(char.name)}" style="font-weight: bold; font-size: 13px;" />
                                        <button class="cw-btn amber sm" id="rbq-cw-import-current-card" type="button" title="从当前酒馆聊天角色卡提取头像与姓名"><i class="fa-solid fa-file-import"></i> 导入当前卡片</button>
                                    </div>
                                    <input id="rbq-cw-ce-avatar" class="cw-input" type="text" placeholder="头像 URL (可选，生图后可一键填入)" value="${escapeHtml(char.avatarUrl)}" style="font-size: 11px;" />
                                </div>
                            </div>
                        </div>

                        <!-- 7-Dimensional Holographic Base Appearance -->
                        <div class="cw-card">
                            <div class="cw-card-header">
                                <span class="cw-card-title" style="color: #38bdf8;"><i class="fa-solid fa-dna"></i> ① 固有外貌特征 (Base Tags - 跨分镜锁定不变)</span>
                                <button class="cw-btn cyan sm" id="rbq-cw-pick-base-wb" type="button"><i class="fa-solid fa-book-open"></i> 从世界书选外貌</button>
                            </div>
                            <div style="font-size: 11px; opacity: 0.65;">点击下方 Tag 芯片快速增删对应特征：</div>
                            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px;">
                                ${HOLOGRAPHIC_TRAIT_GROUPS.map(g => `
                                    <div style="display: flex; gap: 6px; align-items: flex-start; flex-wrap: wrap;">
                                        <span style="font-size: 10.5px; font-weight: bold; color: ${g.color}; min-width: 160px; padding-top: 2px;">${escapeHtml(g.group)}:</span>
                                        <div style="display: flex; gap: 4px; flex-wrap: wrap; flex: 1;">
                                            ${g.tags.map(t => `
                                                <button class="cw-chip-btn rbq-cw-base-chip" data-tag="${escapeHtml(t.tag)}" type="button">${escapeHtml(t.name)}</button>
                                            `).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            <textarea id="rbq-cw-ce-base" class="cw-textarea" placeholder="例如: girl, japanese, delicate_face, adolescent, long_hair, black_hair, air_bangs, brown_eyes, large_breasts, fair_skin">${escapeHtml(char.baseTags)}</textarea>
                        </div>

                        <!-- Multi-Outfit Wardrobe System -->
                        <div class="cw-card">
                            <div class="cw-card-header">
                                <span class="cw-card-title" style="color: #ffb86c;"><i class="fa-solid fa-shirt"></i> ② 多套衣柜管理 (Wardrobe)</span>
                                <div style="display: inline-flex; gap: 6px;">
                                    <button class="cw-btn amber sm" id="rbq-cw-pick-outfit-wb" type="button"><i class="fa-solid fa-book-open"></i> 从世界书选服装</button>
                                    <button class="cw-btn green sm" id="rbq-cw-add-wardrobe-btn" type="button"><i class="fa-solid fa-plus"></i> 新增服装套件</button>
                                </div>
                            </div>
                            <div class="cw-tab-nav" style="overflow-x: auto;">
                                ${char.wardrobe.map((w, idx) => `
                                    <button class="cw-tab-btn rbq-cw-wardrobe-tab ${activeWardrobeIndex === idx ? 'active' : ''}" data-widx="${idx}">
                                        👗 ${escapeHtml(w.name || '套件 ' + (idx + 1))}
                                    </button>
                                `).join('')}
                            </div>
                            ${(() => {
                                const currentW = char.wardrobe[activeWardrobeIndex] || char.wardrobe[0];
                                return `
                                    <div style="display: flex; gap: 8px; align-items: center;">
                                        <input id="rbq-cw-w-name" class="cw-input" type="text" placeholder="服装名称 (如: 学校水手服 / 黑色晚礼服)" value="${escapeHtml(currentW?.name || '')}" style="width: 220px;" />
                                        <div style="display: flex; gap: 4px; flex-wrap: wrap; flex: 1;">
                                            ${OUTFIT_PRESET_TAGS.slice(0, 8).map(opt => `
                                                <button class="cw-chip-btn rbq-cw-outfit-quick-chip" data-tag="${escapeHtml(opt.tags)}" type="button">${escapeHtml(opt.name.split(' ')[0])}</button>
                                            `).join('')}
                                        </div>
                                        ${char.wardrobe.length > 1 ? `<button class="cw-btn red sm" id="rbq-cw-del-wardrobe-btn" type="button">✕ 删除此套</button>` : ''}
                                    </div>
                                    <textarea id="rbq-cw-w-tags" class="cw-textarea" placeholder="服装 Tags: sailor_suit, white_shirt, pleated_skirt, white_thighhighs">${escapeHtml(currentW?.tags || '')}</textarea>
                                `;
                            })()}
                        </div>
                    </div>

                    <div class="cw-modal-foot">
                        <button class="cw-btn cyan" id="rbq-cw-test-solo-draw" type="button">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> 🎨 测试单人立绘
                        </button>
                        <div style="display: inline-flex; gap: 8px;">
                            <button class="cw-btn" id="rbq-cw-ce-cancel">取消</button>
                            <button class="cw-btn primary" id="rbq-cw-ce-save">💾 保存档案并同步</button>
                        </div>
                    </div>
                </div>
            `;

            // Helper to sync chip active state
            const updateChipStates = () => {
                const currentBase = (modal.querySelector('#rbq-cw-ce-base')?.value || '').toLowerCase();
                modal.querySelectorAll('.rbq-cw-base-chip').forEach(btn => {
                    const tag = (btn.dataset.tag || '').toLowerCase();
                    const active = tag.split(',').every(t => currentBase.includes(t.trim()));
                    btn.classList.toggle('active', active);
                });
            };

            modal.querySelector('#rbq-cw-ce-close')?.addEventListener('click', () => modal.remove());
            modal.querySelector('#rbq-cw-ce-cancel')?.addEventListener('click', () => modal.remove());
            
            modal.querySelector('#rbq-cw-ce-name')?.addEventListener('input', (e) => { char.name = e.target.value; });
            modal.querySelector('#rbq-cw-ce-avatar')?.addEventListener('input', (e) => {
                char.avatarUrl = e.target.value;
                const box = modal.querySelector('#rbq-cw-avatar-box');
                if (box) box.innerHTML = char.avatarUrl ? `<img src="${escapeHtml(char.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;" />` : '👤';
            });
            modal.querySelector('#rbq-cw-ce-base')?.addEventListener('input', (e) => {
                char.baseTags = e.target.value;
                updateChipStates();
            });

            modal.querySelectorAll('.rbq-cw-base-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tag = btn.dataset.tag;
                    const baseEl = modal.querySelector('#rbq-cw-ce-base');
                    if (baseEl) {
                        baseEl.value = appendOrToggleTag(baseEl.value, tag);
                        char.baseTags = baseEl.value;
                        updateChipStates();
                    }
                });
            });

            // Wardrobe switching
            modal.querySelectorAll('.rbq-cw-wardrobe-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    activeWardrobeIndex = Number(btn.dataset.widx);
                    render();
                });
            });

            modal.querySelector('#rbq-cw-add-wardrobe-btn')?.addEventListener('click', () => {
                char.wardrobe.push({ id: uid('wardrobe'), name: `服装套件 ${char.wardrobe.length + 1}`, tags: '' });
                activeWardrobeIndex = char.wardrobe.length - 1;
                render();
            });

            modal.querySelector('#rbq-cw-del-wardrobe-btn')?.addEventListener('click', () => {
                if (char.wardrobe.length > 1) {
                    char.wardrobe.splice(activeWardrobeIndex, 1);
                    activeWardrobeIndex = Math.max(0, activeWardrobeIndex - 1);
                    render();
                }
            });

            modal.querySelector('#rbq-cw-w-name')?.addEventListener('input', (e) => {
                if (char.wardrobe[activeWardrobeIndex]) char.wardrobe[activeWardrobeIndex].name = e.target.value;
            });
            modal.querySelector('#rbq-cw-w-tags')?.addEventListener('input', (e) => {
                if (char.wardrobe[activeWardrobeIndex]) char.wardrobe[activeWardrobeIndex].tags = e.target.value;
            });

            modal.querySelectorAll('.rbq-cw-outfit-quick-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tag = btn.dataset.tag;
                    const wTagsEl = modal.querySelector('#rbq-cw-w-tags');
                    if (wTagsEl && char.wardrobe[activeWardrobeIndex]) {
                        wTagsEl.value = appendOrToggleTag(wTagsEl.value, tag);
                        char.wardrobe[activeWardrobeIndex].tags = wTagsEl.value;
                    }
                });
            });

            // Pick from Worldbook for Base
            modal.querySelector('#rbq-cw-pick-base-wb')?.addEventListener('click', () => {
                openWorldbookPickerModal({ title: '挑选外貌特征词条', targetCategory: 'appearance' }, (content) => {
                    const baseEl = modal.querySelector('#rbq-cw-ce-base');
                    if (baseEl) {
                        baseEl.value = [baseEl.value, content].filter(Boolean).join(', ');
                        char.baseTags = baseEl.value;
                        updateChipStates();
                    }
                });
            });

            // Pick from Worldbook for Outfit
            modal.querySelector('#rbq-cw-pick-outfit-wb')?.addEventListener('click', () => {
                openWorldbookPickerModal({ title: '挑选服装词条', targetCategory: 'outfit' }, (content, comment) => {
                    const wTagsEl = modal.querySelector('#rbq-cw-w-tags');
                    const wNameEl = modal.querySelector('#rbq-cw-w-name');
                    if (wTagsEl && char.wardrobe[activeWardrobeIndex]) {
                        wTagsEl.value = content;
                        char.wardrobe[activeWardrobeIndex].tags = content;
                    }
                    if (wNameEl && comment && (!wNameEl.value || wNameEl.value.startsWith('服装套件'))) {
                        wNameEl.value = comment;
                        char.wardrobe[activeWardrobeIndex].name = comment;
                    }
                    render();
                });
            });

            // Import from Current SillyTavern Character Card
            modal.querySelector('#rbq-cw-import-current-card')?.addEventListener('click', () => {
                try {
                    const ctx = RBQ.api.getContext();
                    const charId = ctx?.characterId;
                    const charData = ctx?.characters?.[charId];
                    if (!charData) return toastr.warning('未检测到当前选中的酒馆角色卡', PLUGIN_NAME);
                    
                    char.name = charData.name || char.name;
                    char.avatarUrl = charData.avatar ? `/characters/${charData.avatar}` : char.avatarUrl;
                    toastr.success(`已导入角色卡「${char.name}」基本信息！`, PLUGIN_NAME);
                    render();
                } catch (e) {
                    toastr.error('导入失败: ' + e.message, PLUGIN_NAME);
                }
            });

            // Test Single Character Portrait Draw
            modal.querySelector('#rbq-cw-test-solo-draw')?.addEventListener('click', async () => {
                const activeOutfitTags = char.wardrobe[activeWardrobeIndex]?.tags || '';
                const prompt = [char.baseTags, activeOutfitTags, 'solo, looking_at_viewer, upper_body, simple_background'].filter(Boolean).join(', ');
                toastr.info(`🎨 正在生成「${char.name || '角色'}」单人立绘测试...`, PLUGIN_NAME);
                try {
                    await RBQ.api.generateImage(prompt, 'character-workshop-test');
                    toastr.success('单人立绘生成完毕，请在画廊查看！', PLUGIN_NAME);
                } catch (err) {
                    toastr.error(`生成失败: ${err.message || err}`, PLUGIN_NAME);
                }
            });

            // Save Character
            modal.querySelector('#rbq-cw-ce-save')?.addEventListener('click', () => {
                if (!char.name || !char.name.trim()) {
                    return toastr.warning('请输入角色姓名！', PLUGIN_NAME);
                }
                char.currentOutfit = char.wardrobe[0]?.tags || '';
                char.currentOutfitId = char.wardrobe[0]?.id || '';
                char.updatedAt = Date.now();

                store.characters[char.id] = char;
                syncDossierToSdt(char);
                save();

                toastr.success(`角色档案「${char.name}」已保存！`, PLUGIN_NAME);
                modal.remove();
                if (onSaved) onSaved(char);
            });

            updateChipStates();
        }

        render();
        document.body.appendChild(modal);
    }

    // ── Tab 1: 多角色组合舞台 (Stage Composer) ─────────────────
    function renderComposerTab(comp) {
        const store = getStore();
        const charList = Object.values(store.characters || {});
        const slots = Array.isArray(comp?.slots) ? comp.slots : [];
        const activeIdx = Math.min(slots.length - 1, Math.max(0, comp.activeSlotIndex || 0));
        const finalPrompt = composeFinalPrompt(comp);

        // 5x5 Matrix cells data
        const gridCols = ['A', 'B', 'C', 'D', 'E'];
        const gridRows = ['1', '2', '3', '4', '5'];

        return `
            <div class="cw-body-content">
                <!-- 5x5 Interactive Stage Matrix & Global Scene -->
                <div class="cw-card">
                    <div class="cw-card-header">
                        <span class="cw-card-title" style="color: #38bdf8;">
                            <i class="fa-solid fa-chess-board"></i> 5x5 空间舞台站位 (点击网格单元格摆放当前角色)
                        </span>
                        <div style="display: inline-flex; gap: 6px;">
                            <button class="cw-btn cyan sm" id="rbq-cw-pick-scene-wb" type="button"><i class="fa-solid fa-mountain-sun"></i> 选世界书场景</button>
                            <button class="cw-btn pink sm" id="rbq-cw-pick-duo-wb" type="button"><i class="fa-solid fa-people-arrows"></i> 选双人体位库</button>
                        </div>
                    </div>

                    <div class="cw-stage-grid-wrapper">
                        <!-- 5x5 Canvas Grid -->
                        <div class="cw-stage-canvas" id="rbq-cw-stage-canvas">
                            ${gridRows.map(r => gridCols.map(c => {
                                const coord = `${c}${r}`;
                                const charsAtCell = slots.map((s, idx) => ({ ...s, slotIndex: idx })).filter(s => (s.center || 'C3').toUpperCase() === coord);
                                return `
                                    <div class="cw-stage-cell ${charsAtCell.length ? 'has-char' : ''}" data-coord="${coord}">
                                        <span>${coord}</span>
                                        ${charsAtCell.map(s => {
                                            const color = SLOT_COLORS[s.slotIndex % SLOT_COLORS.length];
                                            return `
                                                <div class="cw-stage-pin" style="background: ${color.hex};" title="Char ${s.slotIndex + 1}: ${escapeHtml(s.customName || '角色')} (${coord})">
                                                    ${s.slotIndex + 1}
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                `;
                            }).join('')).join('')}
                        </div>

                        <!-- Stage Legend & Global Scene Inputs -->
                        <div class="cw-stage-info">
                            <div style="font-weight: 700; color: #f8fafc; font-size: 13px;">
                                当前选中的角色：<span style="color: ${SLOT_COLORS[activeIdx % SLOT_COLORS.length].hex};">Char ${activeIdx + 1} (${slots[activeIdx]?.customName || '角色 ' + (activeIdx + 1)})</span>
                                <small style="margin-left: 6px; opacity: 0.7;">[坐标: ${formatCoordLabel(slots[activeIdx]?.center || 'C3')}]</small>
                            </div>

                            <div class="cw-slot-pins-legend">
                                ${slots.map((s, idx) => {
                                    const c = SLOT_COLORS[idx % SLOT_COLORS.length];
                                    const isActive = activeIdx === idx;
                                    return `
                                        <div class="cw-slot-legend-item rbq-cw-switch-active-slot" data-index="${idx}" style="background: ${c.bg}; color: ${c.hex}; border-color: ${isActive ? c.border : 'transparent'};">
                                            <span>● Char ${idx + 1}: ${escapeHtml(s.customName || '角色')}</span>
                                            <span style="opacity: 0.7;">(${s.center || 'C3'})</span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>

                            <!-- Scene & Lighting Inputs -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px;">
                                <div>
                                    <label style="font-size: 11px; font-weight: bold; color: #cbd5e1;">场景环境 (Scene Location):</label>
                                    <input id="rbq-cw-scene-input" class="cw-input" type="text" placeholder="indoors, living room, coffee table..." value="${escapeHtml(comp?.scene || '')}" />
                                </div>
                                <div>
                                    <label style="font-size: 11px; font-weight: bold; color: #cbd5e1;">视角与光影 (Camera & Lighting):</label>
                                    <input id="rbq-cw-camera-input" class="cw-input" type="text" placeholder="from_side, depth_of_field, cinematic_lighting..." value="${escapeHtml(comp?.camera || '')}" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Character Slots Configuration -->
                <div class="cw-card">
                    <div class="cw-card-header">
                        <span class="cw-card-title" style="color: #4ade80;">
                            <i class="fa-solid fa-users-viewfinder"></i> 角色槽位配置 (${slots.length} 位角色)
                        </span>
                        <button class="cw-btn green sm" id="rbq-cw-add-slot-btn" type="button"><i class="fa-solid fa-user-plus"></i> 添加新角色槽位</button>
                    </div>

                    <div class="cw-slots-list">
                        ${slots.map((slot, idx) => {
                            const charObj = store.characters[slot.charId];
                            const cColor = SLOT_COLORS[idx % SLOT_COLORS.length];
                            const isActive = activeIdx === idx;
                            const wardrobe = charObj?.wardrobe || [];

                            return `
                                <div class="cw-slot-box ${isActive ? 'active-slot' : ''}" data-index="${idx}">
                                    <div class="cw-slot-top-row">
                                        <div style="display: inline-flex; align-items: center; gap: 8px;">
                                            <span class="cw-slot-badge" style="background: ${cColor.bg}; color: ${cColor.hex};">Char ${idx + 1}</span>
                                            <strong style="font-size: 13px; color: #f8fafc;">${escapeHtml(charObj?.name || slot.customName || '未建档角色')}</strong>
                                            <span style="font-size: 11px; opacity: 0.6;">[坐标: ${formatCoordLabel(slot.center || 'C3')}]</span>
                                        </div>
                                        <div style="display: inline-flex; gap: 6px;">
                                            <button class="cw-btn cyan sm rbq-cw-select-this-slot" data-index="${idx}" type="button">🎯 设为当前活动槽位</button>
                                            ${slots.length > 1 ? `<button class="cw-btn red sm rbq-cw-remove-slot-btn" data-index="${idx}" type="button">✕ 移除</button>` : ''}
                                        </div>
                                    </div>

                                    <div class="cw-slot-controls">
                                        <!-- Character Select -->
                                        <div>
                                            <label style="font-size: 11px; font-weight: bold; color: #cbd5e1;">绑定角色档案：</label>
                                            <select class="cw-select rbq-cw-slot-char-select" data-index="${idx}">
                                                <option value="">👤 [自定义 / 未建档角色]</option>
                                                ${charList.map(c => `
                                                    <option value="${escapeHtml(c.id)}" ${slot.charId === c.id ? 'selected' : ''}>👤 ${escapeHtml(c.name)}</option>
                                                `).join('')}
                                            </select>
                                        </div>

                                        <!-- Wardrobe Switcher -->
                                        <div>
                                            <label style="font-size: 11px; font-weight: bold; color: #cbd5e1;">服装套件 (Wardrobe)：</label>
                                            <select class="cw-select rbq-cw-slot-outfit-select" data-index="${idx}">
                                                <option value="default" ${slot.outfitMode === 'default' ? 'selected' : ''}>👗 默认服装</option>
                                                ${wardrobe.map(w => `
                                                    <option value="${escapeHtml(w.id)}" ${slot.outfitId === w.id ? 'selected' : ''}>👗 ${escapeHtml(w.name)}</option>
                                                `).join('')}
                                                <option value="custom" ${slot.outfitMode === 'custom' ? 'selected' : ''}>✍️ 临时自定义服装</option>
                                            </select>
                                        </div>

                                        <!-- Action / Pose -->
                                        <div style="grid-column: 1 / -1;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                                                <label style="font-size: 11px; font-weight: bold; color: #cbd5e1;">当前动作/姿态 (Action)：</label>
                                                <button class="cw-btn cyan sm rbq-cw-pick-action-wb" data-index="${idx}" type="button"><i class="fa-solid fa-book-open"></i> 选动作</button>
                                            </div>
                                            <input class="cw-input rbq-cw-slot-action-input" data-index="${idx}" type="text" placeholder="sitting, facing_another, looking_at_partner, blush..." value="${escapeHtml(slot.action || '')}" />
                                        </div>

                                        <!-- Independent Char UC & Anti-Artifact Chips -->
                                        <div style="grid-column: 1 / -1;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                                                <label style="font-size: 11px; font-weight: bold; color: #f87171;">角色独立负面词 (Char UC / 防穿模)：</label>
                                                <div style="display: inline-flex; gap: 4px;">
                                                    <button class="cw-chip-btn rbq-cw-quick-uc-chip" data-index="${idx}" data-uc="penis, futanari, testicles" title="防止女性长出肉棒">+ 女性防长肉棒</button>
                                                    <button class="cw-chip-btn rbq-cw-quick-uc-chip" data-index="${idx}" data-uc="feet, shoes, legs, lower_body" title="近景特写防露脚">+ 镜头防漏脚</button>
                                                    <button class="cw-chip-btn rbq-cw-quick-uc-chip" data-index="${idx}" data-uc="face, eyes, head" title="局部特写防长头">+ 局部防长头</button>
                                                </div>
                                            </div>
                                            <input class="cw-input rbq-cw-slot-uc-input" data-index="${idx}" type="text" placeholder="penis, futanari, feet, shoes..." value="${escapeHtml(slot.uc || '')}" />
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Live Synthesized Prompt Preview & Actions -->
                <div class="cw-preview-panel">
                    <div class="cw-card-header">
                        <span class="cw-card-title" style="color: #38bdf8;"><i class="fa-solid fa-terminal"></i> 合成提示词实时预览 (NAI V4.5 / SD)</span>
                        <div style="display: inline-flex; gap: 6px;">
                            <button class="cw-btn sm" id="rbq-cw-copy-prompt"><i class="fa-regular fa-copy"></i> 复制提示词</button>
                            <button class="cw-btn amber sm" id="rbq-cw-save-preset-btn"><i class="fa-solid fa-floppy-disk"></i> 保存为组合预设</button>
                        </div>
                    </div>
                    <div class="cw-preview-code" id="rbq-cw-prompt-preview">${escapeHtml(finalPrompt)}</div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
                        <button class="cw-btn primary" id="rbq-cw-generate-now-btn" style="padding: 8px 24px; font-size: 13.5px; font-weight: bold;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> 🚀 立即合成并生图
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Tab 2: 角色档案库 (Character Dossier Studio) ─────────
    function renderCharactersTab() {
        const store = getStore();
        const charList = Object.values(store.characters || {});
        const sdtProfiles = getSdtCharacterProfiles();
        const sdtCharNames = Object.keys(sdtProfiles).filter(n => !charList.some(c => c.name === n));

        return `
            <div class="cw-body-content">
                <div class="cw-card">
                    <div class="cw-card-header">
                        <div>
                            <span class="cw-card-title" style="color: #38bdf8;"><i class="fa-solid fa-users"></i> 角色档案库 (${charList.length} 位角色)</span>
                            <div style="font-size: 11.5px; opacity: 0.65; margin-top: 2px;">管理固定的 7 维全息外貌与多套衣柜，支持在多角色舞台中随时调用。</div>
                        </div>
                        <div style="display: inline-flex; gap: 6px;">
                            <button class="cw-btn green" id="rbq-cw-create-char-btn"><i class="fa-solid fa-plus"></i> 创造新角色</button>
                        </div>
                    </div>

                    ${sdtCharNames.length > 0 ? `
                        <div style="background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.3); border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 11.5px; color: #a5f3fc;">
                                💡 检测到智能生图在聊天中记忆了 ${sdtCharNames.length} 个角色：<strong>${escapeHtml(sdtCharNames.join(', '))}</strong>
                            </span>
                            <button class="cw-btn cyan sm" id="rbq-cw-import-all-sdt-btn">一键收录至角色档案库</button>
                        </div>
                    ` : ''}

                    <div class="cw-char-grid" style="margin-top: 8px;">
                        ${charList.length === 0 ? `
                            <div style="text-align: center; padding: 40px; grid-column: 1 / -1; opacity: 0.6;">
                                暂无角色档案，点击右上角「创造新角色」开始定制！
                            </div>
                        ` : charList.map(c => `
                            <div class="cw-char-card">
                                <div class="cw-char-head">
                                    <div class="cw-char-avatar">${c.avatarUrl ? `<img src="${escapeHtml(c.avatarUrl)}" />` : '👤'}</div>
                                    <div class="cw-char-meta">
                                        <span class="cw-char-title">${escapeHtml(c.name)}</span>
                                        <span class="cw-char-base-text" title="${escapeHtml(c.baseTags)}">${escapeHtml(c.baseTags || '未设置外貌')}</span>
                                        <span style="font-size: 10.5px; color: #ffb86c;">👗 衣柜 ${c.wardrobe?.length || 1} 套服装</span>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px;">
                                    <button class="cw-btn cyan sm rbq-cw-send-char-to-stage" data-id="${escapeHtml(c.id)}">+ 放入舞台</button>
                                    <button class="cw-btn sm rbq-cw-edit-char-btn" data-id="${escapeHtml(c.id)}">编辑</button>
                                    <button class="cw-btn red sm rbq-cw-del-char-btn" data-id="${escapeHtml(c.id)}">删除</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // ── Tab 3: 组合预设库 (Composition Presets) ───────────────
    function renderPresetsTab() {
        const store = getStore();
        const userPresets = store.presets || [];

        return `
            <div class="cw-body-content">
                <!-- Built-in Templates -->
                <div class="cw-card">
                    <div class="cw-card-header">
                        <span class="cw-card-title" style="color: #38bdf8;"><i class="fa-solid fa-sparkles"></i> 经典多角色分镜模板库 (一键载入舞台)</span>
                    </div>
                    <div class="cw-char-grid">
                        ${BUILTIN_COMPOSITION_TEMPLATES.map((t, idx) => `
                            <div class="cw-char-card" style="border-color: rgba(56,189,248,0.2);">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                    <strong style="font-size: 13px; color: #38bdf8;">${escapeHtml(t.name)}</strong>
                                    <span class="cw-slot-badge" style="background: rgba(56,189,248,0.15); color: #38bdf8;">${t.slots.length} 人</span>
                                </div>
                                <div style="font-size: 11.5px; opacity: 0.7;">${escapeHtml(t.desc)}</div>
                                <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
                                    <button class="cw-btn green sm rbq-cw-load-builtin-tpl" data-index="${idx}">载入舞台</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- User Saved Presets -->
                <div class="cw-card">
                    <div class="cw-card-header">
                        <span class="cw-card-title" style="color: #fbbf24;"><i class="fa-solid fa-bookmark"></i> 我的自定义组合预设 (${userPresets.length})</span>
                    </div>
                    <div class="cw-char-grid">
                        ${userPresets.length === 0 ? `
                            <div style="text-align: center; padding: 30px; grid-column: 1 / -1; opacity: 0.6;">
                                暂无自定义预设，在「多角色组合舞台」调整好后点击「保存为组合预设」即可添加到此处！
                            </div>
                        ` : userPresets.map((p, idx) => `
                            <div class="cw-char-card">
                                <div style="display: justify-content: space-between; align-items: flex-start;">
                                    <strong style="font-size: 13px; color: #f8fafc;">${escapeHtml(p.name)}</strong>
                                    <span class="cw-slot-badge" style="background: rgba(251,191,36,0.15); color: #fbbf24;">${p.slots?.length || 0} 角色</span>
                                </div>
                                <div style="font-size: 11px; color: rgba(255,255,255,0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${escapeHtml(p.scene || '默认场景')}
                                </div>
                                <div style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px;">
                                    <button class="cw-btn green sm rbq-cw-load-user-preset" data-index="${idx}">载入舞台</button>
                                    <button class="cw-btn red sm rbq-cw-del-user-preset" data-index="${idx}">删除</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // ── Main UI Assembly & Event Binding ─────────────────────
    let activeMainTab = 'composer';

    function renderWorkshopHtml(tab = activeMainTab) {
        activeMainTab = tab;
        const store = getStore();
        const charCount = Object.keys(store.characters || {}).length;
        const presetCount = (store.presets || []).length;

        return `
            <div class="cw-container">
                <div class="cw-header-bar">
                    <div class="cw-title-wrap">
                        <i class="fa-solid fa-palette"></i>
                        <span>角色工坊 2.0</span>
                    </div>
                    <div class="cw-tab-nav">
                        <button class="cw-tab-btn rbq-cw-main-tab-btn ${tab === 'composer' ? 'active' : ''}" data-tab="composer">
                            <i class="fa-solid fa-puzzle-piece"></i> 多角色组合舞台
                        </button>
                        <button class="cw-tab-btn rbq-cw-main-tab-btn ${tab === 'characters' ? 'active' : ''}" data-tab="characters">
                            <i class="fa-solid fa-users"></i> 角色档案库 (${charCount})
                        </button>
                        <button class="cw-tab-btn rbq-cw-main-tab-btn ${tab === 'presets' ? 'active' : ''}" data-tab="presets">
                            <i class="fa-solid fa-bookmark"></i> 分镜预设库 (${presetCount})
                        </button>
                    </div>
                </div>

                <div id="rbq-cw-tab-container" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
                    ${tab === 'composer' ? renderComposerTab(store.activeComposer) : ''}
                    ${tab === 'characters' ? renderCharactersTab() : ''}
                    ${tab === 'presets' ? renderPresetsTab() : ''}
                </div>
            </div>
        `;
    }

    function bindEvents(container, onRefresh) {
        const store = getStore();
        const comp = store.activeComposer;

        // Tab Navigation
        container.querySelectorAll('.rbq-cw-main-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                if (targetTab) onRefresh(targetTab);
            });
        });

        // ── Composer Stage Events ────────────────────────────
        // 5x5 Matrix Cell Click -> Set Center for Active Slot
        container.querySelectorAll('.cw-stage-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const coord = cell.dataset.coord;
                const activeIdx = comp.activeSlotIndex || 0;
                if (comp.slots[activeIdx]) {
                    comp.slots[activeIdx].center = coord;
                    save();
                    onRefresh('composer');
                }
            });
        });

        // Switch Active Slot
        container.querySelectorAll('.rbq-cw-switch-active-slot, .rbq-cw-select-this-slot').forEach(btn => {
            btn.addEventListener('click', () => {
                comp.activeSlotIndex = Number(btn.dataset.index);
                save();
                onRefresh('composer');
            });
        });

        // Scene & Camera Input
        container.querySelector('#rbq-cw-scene-input')?.addEventListener('input', (e) => {
            comp.scene = e.target.value;
            save();
            updateLivePreview(container);
        });
        container.querySelector('#rbq-cw-camera-input')?.addEventListener('input', (e) => {
            comp.camera = e.target.value;
            save();
            updateLivePreview(container);
        });

        // Add Slot
        container.querySelector('#rbq-cw-add-slot-btn')?.addEventListener('click', () => {
            const nextIdx = comp.slots.length;
            const defaultPos = nextIdx % 2 === 0 ? 'B3' : 'D3';
            comp.slots.push({
                charId: '',
                customName: `角色 ${nextIdx + 1}`,
                outfitMode: 'default',
                outfitId: '',
                customOutfit: '',
                action: 'standing, looking_at_viewer',
                center: defaultPos,
                uc: ''
            });
            comp.activeSlotIndex = comp.slots.length - 1;
            save();
            onRefresh('composer');
        });

        // Remove Slot
        container.querySelectorAll('.rbq-cw-remove-slot-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.index);
                if (comp.slots.length > 1) {
                    comp.slots.splice(idx, 1);
                    comp.activeSlotIndex = Math.max(0, comp.activeSlotIndex - 1);
                    save();
                    onRefresh('composer');
                }
            });
        });

        // Slot Char Select
        container.querySelectorAll('.rbq-cw-slot-char-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const idx = Number(sel.dataset.index);
                const charId = sel.value;
                if (comp.slots[idx]) {
                    comp.slots[idx].charId = charId;
                    comp.slots[idx].outfitMode = 'default';
                    comp.slots[idx].outfitId = '';
                    if (charId && store.characters[charId]) {
                        comp.slots[idx].customName = store.characters[charId].name;
                    }
                    save();
                    onRefresh('composer');
                }
            });
        });

        // Slot Outfit Select
        container.querySelectorAll('.rbq-cw-slot-outfit-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const idx = Number(sel.dataset.index);
                const val = sel.value;
                if (comp.slots[idx]) {
                    if (val === 'default') {
                        comp.slots[idx].outfitMode = 'default';
                        comp.slots[idx].outfitId = '';
                    } else if (val === 'custom') {
                        comp.slots[idx].outfitMode = 'custom';
                        comp.slots[idx].outfitId = '';
                    } else {
                        comp.slots[idx].outfitMode = 'outfit';
                        comp.slots[idx].outfitId = val;
                    }
                    save();
                    updateLivePreview(container);
                }
            });
        });

        // Slot Action Input
        container.querySelectorAll('.rbq-cw-slot-action-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const idx = Number(inp.dataset.index);
                if (comp.slots[idx]) {
                    comp.slots[idx].action = inp.value;
                    save();
                    updateLivePreview(container);
                }
            });
        });

        // Slot UC Input
        container.querySelectorAll('.rbq-cw-slot-uc-input').forEach(inp => {
            inp.addEventListener('input', () => {
                const idx = Number(inp.dataset.index);
                if (comp.slots[idx]) {
                    comp.slots[idx].uc = inp.value;
                    save();
                    updateLivePreview(container);
                }
            });
        });

        // Quick UC Chips
        container.querySelectorAll('.rbq-cw-quick-uc-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.index);
                const tag = btn.dataset.uc;
                if (comp.slots[idx]) {
                    comp.slots[idx].uc = appendOrToggleTag(comp.slots[idx].uc, tag);
                    save();
                    onRefresh('composer');
                }
            });
        });

        // Pick Action from Worldbook
        container.querySelectorAll('.rbq-cw-pick-action-wb').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.index);
                openWorldbookPickerModal({ title: '选择动作/姿态词条', targetCategory: 'pose' }, (tags) => {
                    if (comp.slots[idx]) {
                        comp.slots[idx].action = tags;
                        save();
                        onRefresh('composer');
                    }
                });
            });
        });

        // Pick Scene from Worldbook
        container.querySelector('#rbq-cw-pick-scene-wb')?.addEventListener('click', () => {
            openWorldbookPickerModal({ title: '挑选场景环境词条', targetCategory: 'scene' }, (tags) => {
                comp.scene = tags;
                save();
                onRefresh('composer');
            });
        });

        // Pick Duo Pose from Worldbook
        container.querySelector('#rbq-cw-pick-duo-wb')?.addEventListener('click', () => {
            openWorldbookPickerModal({ title: '挑选双人互动/体位词条', targetCategory: 'nsfw' }, (tags) => {
                comp.atmosphere = tags;
                save();
                onRefresh('composer');
            });
        });

        // Copy Prompt
        container.querySelector('#rbq-cw-copy-prompt')?.addEventListener('click', () => {
            const prompt = composeFinalPrompt(comp);
            if (navigator.clipboard) {
                navigator.clipboard.writeText(prompt);
                toastr.success('提示词已复制到剪贴板！', PLUGIN_NAME);
            } else {
                toastr.info(prompt.slice(0, 100), '提示词');
            }
        });

        // Save as Preset
        container.querySelector('#rbq-cw-save-preset-btn')?.addEventListener('click', () => {
            const name = prompt('请输入该多角色组合的预设名称：', `分镜组合 - ${new Date().toLocaleDateString()}`);
            if (!name) return;
            store.presets.push({
                id: uid('preset'),
                name,
                scene: comp.scene,
                camera: comp.camera,
                atmosphere: comp.atmosphere,
                slots: JSON.parse(JSON.stringify(comp.slots))
            });
            save();
            toastr.success(`组合预设「${name}」已保存！`, PLUGIN_NAME);
        });

        // Generate Now Button
        container.querySelector('#rbq-cw-generate-now-btn')?.addEventListener('click', async () => {
            const prompt = composeFinalPrompt(comp);
            toastr.info('🚀 正在调用 RBQ 生图引擎生成多角色画作...', PLUGIN_NAME);
            try {
                await RBQ.api.generateImage(prompt, 'character-workshop-ensemble');
                toastr.success('🎉 多角色画面生成完毕，已存入画廊！', PLUGIN_NAME);
            } catch (err) {
                toastr.error(`生图失败: ${err.message || err}`, PLUGIN_NAME);
            }
        });

        // ── Character Tab Events ─────────────────────────────
        container.querySelector('#rbq-cw-create-char-btn')?.addEventListener('click', () => {
            openCharacterEditorModal(null, () => onRefresh('characters'));
        });

        container.querySelectorAll('.rbq-cw-edit-char-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                openCharacterEditorModal(btn.dataset.id, () => onRefresh('characters'));
            });
        });

        container.querySelectorAll('.rbq-cw-del-char-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                delete store.characters[id];
                save();
                onRefresh('characters');
                toastr.info('角色档案已删除', PLUGIN_NAME);
            });
        });

        container.querySelectorAll('.rbq-cw-send-char-to-stage').forEach(btn => {
            btn.addEventListener('click', () => {
                const charId = btn.dataset.id;
                const charObj = store.characters[charId];
                const activeIdx = comp.activeSlotIndex || 0;
                if (comp.slots[activeIdx]) {
                    comp.slots[activeIdx].charId = charId;
                    comp.slots[activeIdx].customName = charObj?.name || '';
                } else {
                    comp.slots.push({
                        charId,
                        customName: charObj?.name || '',
                        outfitMode: 'default',
                        outfitId: '',
                        customOutfit: '',
                        action: 'sitting, looking_at_partner',
                        center: 'C3',
                        uc: ''
                    });
                }
                save();
                toastr.success(`已将「${charObj?.name}」放入舞台！`, PLUGIN_NAME);
                onRefresh('composer');
            });
        });

        container.querySelector('#rbq-cw-import-all-sdt-btn')?.addEventListener('click', () => {
            const sdtProfiles = getSdtCharacterProfiles();
            let count = 0;
            for (const [name, prof] of Object.entries(sdtProfiles)) {
                if (!Object.values(store.characters).some(c => c.name === name)) {
                    const newChar = {
                        id: uid('char'),
                        name,
                        avatarUrl: '',
                        baseTags: prof.baseTags || '',
                        currentOutfitId: '',
                        currentOutfit: prof.currentOutfit || '',
                        wardrobe: [
                            { id: uid('wardrobe'), name: '默认服装', tags: prof.currentOutfit || '' }
                        ],
                        updatedAt: Date.now()
                    };
                    store.characters[newChar.id] = newChar;
                    count++;
                }
            }
            save();
            toastr.success(`成功收录 ${count} 位角色到档案库！`, PLUGIN_NAME);
            onRefresh('characters');
        });

        // ── Presets Tab Events ───────────────────────────────
        container.querySelectorAll('.rbq-cw-load-builtin-tpl').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.index);
                const tpl = BUILTIN_COMPOSITION_TEMPLATES[idx];
                if (tpl) {
                    comp.scene = tpl.scene || '';
                    comp.camera = tpl.camera || '';
                    comp.atmosphere = tpl.atmosphere || '';
                    comp.slots = JSON.parse(JSON.stringify(tpl.slots));
                    comp.activeSlotIndex = 0;
                    save();
                    toastr.success(`已载入模板「${tpl.name}」到舞台！`, PLUGIN_NAME);
                    onRefresh('composer');
                }
            });
        });

        container.querySelectorAll('.rbq-cw-load-user-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.index);
                const p = store.presets[idx];
                if (p) {
                    comp.scene = p.scene || '';
                    comp.camera = p.camera || '';
                    comp.atmosphere = p.atmosphere || '';
                    comp.slots = JSON.parse(JSON.stringify(p.slots));
                    comp.activeSlotIndex = 0;
                    save();
                    toastr.success(`已载入预设「${p.name}」到舞台！`, PLUGIN_NAME);
                    onRefresh('composer');
                }
            });
        });

        container.querySelectorAll('.rbq-cw-del-user-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.index);
                store.presets.splice(idx, 1);
                save();
                onRefresh('presets');
                toastr.info('组合预设已删除', PLUGIN_NAME);
            });
        });
    }

    function updateLivePreview(container) {
        const store = getStore();
        const previewEl = container.querySelector('#rbq-cw-prompt-preview');
        if (previewEl) {
            previewEl.textContent = composeFinalPrompt(store.activeComposer);
        }
    }

    // ── Panel Mounting into RBQ Control Panel ─────────────────
    function mountWorkshopPanel() {
        if (!RBQ.ui || typeof RBQ.ui.addSettingPanel !== 'function') {
            return console.warn('[Character Workshop] RBQ.ui.addSettingPanel not available');
        }

        RBQ.ui.addSettingPanel('character-workshop', '<i class="fa-solid fa-palette"></i><span>角色工坊</span>', () => {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden;';
            
            const refresh = (tab) => {
                wrapper.innerHTML = renderWorkshopHtml(tab);
                bindEvents(wrapper, refresh);
            };

            refresh(activeMainTab);
            return wrapper;
        });
    }

    mountWorkshopPanel();
    console.info(`[${PLUGIN_NAME}] 角色工坊 2.0 升级就绪 (v${VERSION})`);

})(window.RBQ, window.jQuery, window.toastr);
