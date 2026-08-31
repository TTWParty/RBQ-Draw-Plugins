/**
 * ═════════════════════════════════════════════════════════════════════════
 *  RBQ - 角色工坊 (Character Workshop) v2.1.0
 * ═════════════════════════════════════════════════════════════════════════
 *  集多角色空间舞台合成、22维全量外貌定制、多套衣柜管理、
 *  世界书搭积木点选与智能生图记忆双向联动于一体的专业级工作台。
 *
 *  @version 2.1.0
 *  @author TTWP-09
 * ═════════════════════════════════════════════════════════════════════════
 */

(function (RBQ, $, toastr) {
    'use strict';

    if (!RBQ) {
        console.error('[Character Workshop] RBQ Core 未加载，无法初始化');
        return;
    }

    const PLUGIN_NAME = '角色工坊 (Character Workshop)';
    const VERSION = '2.1.0';
    const SDT_KEY = '_smartDrawTrigger';
    const WS_KEY = '_characterWorkshopState';

    // ── Helper Utilities ─────────────────────────────────────
    function uid(p = 'cw') { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function esc(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function sanitizePromptSegment(str) {
        if (!str || typeof str !== 'string') return '';
        return str.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[,;\s]+|[,;\s]+$/g, '');
    }

    // ── Grid & Position Constants ────────────────────────────
    const COLS = ['A', 'B', 'C', 'D', 'E'];
    const ROWS = ['1', '2', '3', '4', '5'];
    const COORD_LABELS = {
        A1: '左上远景', B1: '偏左远景', C1: '中央远景', D1: '偏右远景', E1: '右上远景',
        A2: '左上方',   B2: '左后方',   C2: '正后方',   D2: '右后方',   E2: '右上方',
        A3: '极左侧',   B3: '左侧主角', C3: '正中央',   D3: '右侧主角', E3: '极右侧',
        A4: '左下方',   B4: '左前方',   C4: '正前方',   D4: '右前方',   E4: '右下方',
        A5: '左下特写', B5: '偏左特写', C5: '中央特写', D5: '偏右特写', E5: '右下特写'
    };
    function coordLabel(c) {
        const u = String(c || 'C3').toUpperCase();
        return COORD_LABELS[u] ? `${u} (${COORD_LABELS[u]})` : u;
    }

    const COLORS = [
        { hex: '#38bdf8', bg: 'rgba(56,189,248,0.18)', bdr: 'rgba(56,189,248,0.6)' },
        { hex: '#a78bfa', bg: 'rgba(167,139,250,0.18)', bdr: 'rgba(167,139,250,0.6)' },
        { hex: '#4ade80', bg: 'rgba(74,222,128,0.18)', bdr: 'rgba(74,222,128,0.6)' },
        { hex: '#fbbf24', bg: 'rgba(251,191,36,0.18)', bdr: 'rgba(251,191,36,0.6)' },
        { hex: '#fb7185', bg: 'rgba(251,113,133,0.18)', bdr: 'rgba(251,113,133,0.6)' },
        { hex: '#34d399', bg: 'rgba(52,211,153,0.18)', bdr: 'rgba(52,211,153,0.6)' },
    ];

    // ── SDT Data Access Layer (Single Source of Truth) ──────
    function getChatKey() {
        try {
            if (typeof window.getCurrentChatId === 'function') {
                const id = window.getCurrentChatId();
                if (id) return id;
            }
        } catch (_e) { /* ignore */ }
        try {
            const context = SillyTavern?.getContext?.();
            if (context?.chatId) return context.chatId;
            if (context?.characterId) return `char_${context.characterId}`;
            if (context?.groupId) return `group_${context.groupId}`;
        } catch (_e) { /* ignore */ }
        return 'default';
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

    function getAllProfiles() {
        const sdt = getSdtStore();
        const ck = getChatKey();
        const currentChatProfiles = (sdt.characterProfiles && sdt.characterProfiles[ck]) || {};
        
        // If current chat is empty, fallback to scanning all chats
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
            const found = profile.wardrobe.find(w => w.id === outfitId);
            if (found) return found.outfit || found.tags || '';
        }
        return profile.currentOutfit || (profile.wardrobe?.[0]?.outfit) || '';
    }

    function isMccEnabled() {
        const s = RBQ.api.getSettings();
        return s._multiCharComposer?.enabled !== false;
    }

    // ── Local Workspace State ────────────────────────────────
    function getWs() {
        const s = RBQ.api.getSettings();
        if (!s[WS_KEY]) s[WS_KEY] = {};
        const ws = s[WS_KEY];
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
        if (ws.activeComposer.activeSlotIndex == null) ws.activeComposer.activeSlotIndex = 0;
        return ws;
    }
    function wsSave() { RBQ.api.saveSettings(); }

    // ── Built-in Composition Templates ───────────────────────
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

    // ── 22-Category Full Danbooru Trait Presets ───────────────
    const BASE_TRAIT_PRESETS = [
        {
            group: '🌏 族裔与面相',
            tags: [
                { name: '日系美少女', tag: 'japanese' },
                { name: '东亚面孔', tag: 'east asian' },
                { name: '中式美', tag: 'chinese' },
                { name: '韩系美', tag: 'korean' },
                { name: '欧美白人', tag: 'caucasian' },
                { name: '精致小脸', tag: 'delicate face' },
                { name: '柔和五官', tag: 'soft facial features' },
                { name: '甜美萌脸', tag: 'cute face' },
                { name: '傲娇猫眼/吊眼', tag: 'tsurime' },
                { name: '无辜垂眼', tag: 'tareme' },
                { name: '动漫大眼', tag: 'anime eyes' }
            ]
        },
        {
            group: '🌟 基础与体态',
            tags: [
                { name: '单人女性 (1girl)', tag: '1girl' },
                { name: '单人男性 (1boy)', tag: '1boy' },
                { name: '单人 (solo)', tag: 'solo' },
                { name: '美少女', tag: 'bishoujo' },
                { name: '萝莉 (loli)', tag: 'loli' },
                { name: '少女 (young girl)', tag: 'young girl' },
                { name: '御姐 (mature female)', tag: 'mature female' },
                { name: '辣妹 (gyaru)', tag: 'gyaru' },
                { name: '少妇/熟女 (milf)', tag: 'milf' },
                { name: '正太 (shota)', tag: 'shota' },
                { name: '美少年/帅哥 (ikemen)', tag: 'ikemen' }
            ]
        },
        {
            group: '💇 基础发色',
            tags: [
                { name: '银发', tag: 'silver hair' },
                { name: '白发', tag: 'white hair' },
                { name: '黑发', tag: 'black hair' },
                { name: '金发', tag: 'blonde hair' },
                { name: '棕发/褐发', tag: 'brown hair' },
                { name: '粉发', tag: 'pink hair' },
                { name: '蓝发', tag: 'blue hair' },
                { name: '水蓝发', tag: 'aqua hair' },
                { name: '紫发', tag: 'purple hair' },
                { name: '红发', tag: 'red hair' },
                { name: '绿发', tag: 'green hair' },
                { name: '橙发', tag: 'orange hair' },
                { name: '灰发', tag: 'grey hair' }
            ]
        },
        {
            group: '🎨 特殊发色',
            tags: [
                { name: '渐变发色', tag: 'gradient hair' },
                { name: '双色发 (渐变/分层)', tag: 'two-tone hair' },
                { name: '内层挑染发 (挂耳染)', tag: 'inner hair color' },
                { name: '彩虹发色', tag: 'multicolored hair' },
                { name: '挑染发丝', tag: 'streaked hair' },
                { name: '发尾发光', tag: 'glowing hair' }
            ]
        },
        {
            group: '✂️ 头发长度',
            tags: [
                { name: '超短发', tag: 'very short hair' },
                { name: '短发', tag: 'short hair' },
                { name: '齐肩中发', tag: 'medium hair' },
                { name: '长发', tag: 'long hair' },
                { name: '及腰超长发', tag: 'very long hair' },
                { name: '拖地长发', tag: 'absurdly long hair' }
            ]
        },
        {
            group: '💇 经典发型',
            tags: [
                { name: '双马尾', tag: 'twintails' },
                { name: '低双马尾', tag: 'low twintails' },
                { name: '双马尾前搭', tag: 'twin tails over shoulders' },
                { name: '单马尾', tag: 'ponytail' },
                { name: '侧马尾', tag: 'side ponytail' },
                { name: '高单马尾', tag: 'high ponytail' },
                { name: '低单马尾', tag: 'low ponytail' },
                { name: '黑长直/直发', tag: 'straight hair' },
                { name: '姬发式/公主切', tag: 'hime cut' },
                { name: '波波头/短鲍伯', tag: 'bob cut' },
                { name: '狼尾头 (wolf cut)', tag: 'wolf cut' },
                { name: '水母头发型', tag: 'jellyfish haircut' },
                { name: '半扎发/公主头', tag: 'half updo' },
                { name: '麻花辫', tag: 'braid' },
                { name: '双麻花辫', tag: 'twin braids' },
                { name: '单丸子头', tag: 'hair bun' },
                { name: '双丸子头/包子头', tag: 'double bun' },
                { name: '波浪大卷发', tag: 'wavy hair' },
                { name: '钻头卷/螺旋卷', tag: 'drill hair' },
                { name: '蓬松微乱发', tag: 'messy hair' }
            ]
        },
        {
            group: '✨ 头发细节/刘海',
            tags: [
                { name: '单呆毛 (ahoge)', tag: 'ahoge' },
                { name: '双呆毛/天线', tag: 'antenna hair' },
                { name: '齐刘海/平刘海', tag: 'blunt bangs' },
                { name: '斜刘海/侧分刘海', tag: 'swept bangs' },
                { name: '中分刘海', tag: 'parted bangs' },
                { name: '遮眉碎发', tag: 'hair between eyes' },
                { name: '单眼遮发', tag: 'hair over one eye' },
                { name: '鬓角长发', tag: 'sidelocks' },
                { name: '单侧撩发/露耳', tag: 'hair behind ear' },
                { name: '露额头', tag: 'forehead' }
            ]
        },
        {
            group: '👁️ 瞳孔色彩',
            tags: [
                { name: '红瞳', tag: 'red eyes' },
                { name: '蓝瞳', tag: 'blue eyes' },
                { name: '水蓝瞳', tag: 'aqua eyes' },
                { name: '金瞳/琥珀瞳', tag: 'golden eyes' },
                { name: '黄瞳', tag: 'yellow eyes' },
                { name: '绿瞳/碧眼', tag: 'green eyes' },
                { name: '紫瞳', tag: 'purple eyes' },
                { name: '粉瞳', tag: 'pink eyes' },
                { name: '棕瞳/褐瞳', tag: 'brown eyes' },
                { name: '黑瞳', tag: 'black eyes' },
                { name: '银瞳/灰瞳', tag: 'silver eyes' }
            ]
        },
        {
            group: '✨ 特殊瞳孔与眼眸',
            tags: [
                { name: '异色瞳 (双色眼)', tag: 'heterochromia' },
                { name: '心形瞳 (爱心眼)', tag: 'heart-shaped pupils' },
                { name: '星形瞳 (星星眼)', tag: 'star-shaped pupils' },
                { name: '竖瞳/猫瞳/蛇瞳', tag: 'slit pupils' },
                { name: '十字瞳', tag: 'cross-shaped pupils' },
                { name: '发光魔眼', tag: 'glowing eyes' },
                { name: '空洞无光瞳/失神', tag: 'empty eyes' },
                { name: '死鱼眼/鄙视无光', tag: 'jitome' },
                { name: '同心圆瞳', tag: 'ringed eyes' }
            ]
        },
        {
            group: '👁️ 眼形与眼周特征',
            tags: [
                { name: '吊眼梢/猫眼 (tsurime)', tag: 'tsurime' },
                { name: '下垂眼/无辜眼 (tareme)', tag: 'tareme' },
                { name: '泪眼汪汪', tag: 'watery eyes' },
                { name: '闪烁大眼', tag: 'sparkling eyes' },
                { name: '泪痣 (眼下小痣)', tag: 'mole under eye' },
                { name: '浓密长睫毛', tag: 'long eyelashes' },
                { name: '眼影', tag: 'eyeshadow' },
                { name: '微醺黑眼圈', tag: 'dark circles' },
                { name: '眨眼 (单眼wink)', tag: 'one eye closed' },
                { name: '半睁慵懒眼', tag: 'half-closed eyes' },
                { name: '闭眼微笑', tag: 'closed eyes' }
            ]
        },
        {
            group: '😊 愉悦/自信表情',
            tags: [
                { name: '甜美微笑', tag: 'smile' },
                { name: '开怀露齿笑', tag: 'grin' },
                { name: '浅浅浅笑', tag: 'light smile' },
                { name: '温柔微笑', tag: 'gentle smile' },
                { name: '捂嘴轻笑', tag: 'covering mouth, smile' },
                { name: '得意自信笑 (smug)', tag: 'smug' },
                { name: '调皮wink', tag: 'wink' },
                { name: '坏笑/邪魅笑', tag: 'evil smile' }
            ]
        },
        {
            group: '😳 害羞/傲娇表情',
            tags: [
                { name: '脸红 (blush)', tag: 'blush' },
                { name: '大片腮红/通红', tag: 'heavy blush' },
                { name: '害羞羞涩', tag: 'shy' },
                { name: '尴尬羞赧', tag: 'embarrassed' },
                { name: '傲娇神情', tag: 'tsundere' },
                { name: '气鼓鼓/嘟嘴 (pout)', tag: 'pout' },
                { name: '别过脸去/移开视线', tag: 'looking away, blush' }
            ]
        },
        {
            group: '😠 情绪/特殊表情',
            tags: [
                { name: '三无/无表情', tag: 'expressionless' },
                { name: '微皱眉头', tag: 'frown' },
                { name: '生气愤怒', tag: 'angry' },
                { name: '不耐烦/嫌恶', tag: 'disdain' },
                { name: '伤心哭泣', tag: 'crying' },
                { name: '震惊呆住', tag: 'shocked' },
                { name: '病娇狂气 (yandere)', tag: 'yandere' },
                { name: '阿黑颜/高潮失神', tag: 'ahegao' }
            ]
        },
        {
            group: '👄 唇齿口部特征',
            tags: [
                { name: '小虎牙 (fang)', tag: 'fang' },
                { name: '双虎牙', tag: 'double fangs' },
                { name: '吐舌 (tongue out)', tag: 'tongue out' },
                { name: '微张小嘴', tag: 'parted lips' },
                { name: '嘟起嘴唇', tag: 'puckered lips' },
                { name: '咬嘴唇', tag: 'biting lip' },
                { name: '水润唇彩', tag: 'lip gloss' }
            ]
        },
        {
            group: '🐾 种族/兽耳与兽尾',
            tags: [
                { name: '猫耳', tag: 'cat ears' },
                { name: '猫尾', tag: 'cat tail' },
                { name: '狐狸耳', tag: 'fox ears' },
                { name: '狐狸大尾巴', tag: 'fox tail' },
                { name: '兔耳', tag: 'rabbit ears' },
                { name: '犬耳/狗耳', tag: 'dog ears' },
                { name: '狼耳', tag: 'wolf ears' },
                { name: '狼尾', tag: 'wolf tail' },
                { name: '精灵耳', tag: 'pointy ears' },
                { name: '恶魔角', tag: 'demon horns' },
                { name: '恶魔尾巴/心形尾', tag: 'demon tail' },
                { name: '龙角', tag: 'dragon horns' },
                { name: '龙尾', tag: 'dragon tail' }
            ]
        },
        {
            group: '🧝 幻想/神魔与异形',
            tags: [
                { name: '天使光环', tag: 'halo' },
                { name: '天使羽翼', tag: 'angel wings' },
                { name: '恶魔/蝙蝠翅膀', tag: 'bat wings' },
                { name: '吸血鬼', tag: 'vampire' },
                { name: '魅魔 (succubus)', tag: 'succubus' },
                { name: '人鱼/鱼尾', tag: 'mermaid' },
                { name: '半人马', tag: 'centaur' }
            ]
        },
        {
            group: '👙 身材体态与胸围',
            tags: [
                { name: '平胸/微乳', tag: 'flat chest' },
                { name: '小胸/贫乳', tag: 'small breasts' },
                { name: '适中胸围/美乳', tag: 'medium breasts' },
                { name: '大胸/巨乳', tag: 'large breasts' },
                { name: '超大胸/爆乳', tag: 'huge breasts' },
                { name: '魔鬼巨乳', tag: 'gigantic breasts' },
                { name: '纤细苗条身材', tag: 'slender' },
                { name: '沙漏型身材', tag: 'hourglass figure' },
                { name: '丰满微胖 (curvy)', tag: 'curvy, plump' },
                { name: '肉感大腿 (thicc)', tag: 'thick thighs' },
                { name: '纤细小蛮腰', tag: 'narrow waist' }
            ]
        },
        {
            group: '🌟 身体部位与迷人细节',
            tags: [
                { name: '绝对领域', tag: 'absolute territory' },
                { name: '锁骨', tag: 'collarbone' },
                { name: '肚脐', tag: 'navel' },
                { name: '马甲线/腹肌', tag: 'toned belly, abs' },
                { name: '丰满臀部', tag: 'plump buttocks' },
                { name: '骆驼趾 (cameltoe)', tag: 'cameltoe' }
            ]
        },
        {
            group: '✨ 肤色与身体印记',
            tags: [
                { name: '白皙冷白皮', tag: 'pale skin' },
                { name: '自然白皙肤色', tag: 'fair skin' },
                { name: '小麦色/晒黑 (tan)', tag: 'tanned' },
                { name: '深色/黑皮', tag: 'dark skin' },
                { name: '淫纹/子宫印记', tag: 'stomach tattoo' },
                { name: '身体纹身', tag: 'body tattoo' },
                { name: '雀斑', tag: 'freckles' },
                { name: '美人痣/嘴角痣', tag: 'mole under mouth' },
                { name: '胸口痣', tag: 'mole on breast' }
            ]
        },
        {
            group: '🎀 头部与面部配饰',
            tags: [
                { name: '眼镜 (glasses)', tag: 'glasses' },
                { name: '金丝半框眼镜', tag: 'semi-rimless glasses' },
                { name: '墨镜/太阳镜', tag: 'sunglasses' },
                { name: '发带/发箍', tag: 'headband' },
                { name: '蝴蝶结发饰', tag: 'hair ribbon' },
                { name: '发夹/发卡', tag: 'hairclip' },
                { name: '发花/花朵发饰', tag: 'hair flower' },
                { name: '耳环/耳坠', tag: 'earrings' },
                { name: '项圈/Choker', tag: 'choker' },
                { name: '项链', tag: 'necklace' }
            ]
        },
        {
            group: '👗 常见服装',
            tags: [
                { name: '水手服', tag: 'sailor suit, pleated skirt' },
                { name: '西装校服/JK制服', tag: 'school uniform, blazer, necktie, pleated skirt' },
                { name: '经典女仆装', tag: 'maid, maid headdress, apron, frills' },
                { name: '白色连衣裙', tag: 'white dress, sundress' },
                { name: '露肩毛衣', tag: 'off-shoulder sweater, bare shoulders' },
                { name: '旗袍', tag: 'china dress, cheongsam, high slit' },
                { name: '和服/浴衣', tag: 'yukata, kimono, obi' },
                { name: '兔女郎装', tag: 'bunny suit, bunny ears, bow tie' },
                { name: '修女服', tag: 'nun, habit, rosary' },
                { name: '护士装', tag: 'nurse, nurse cap' },
                { name: '性感比基尼', tag: 'bikini, micro bikini' },
                { name: '蕾丝内衣', tag: 'lace lingerie, bra, panties, garter straps' },
                { name: '死库水/连体泳衣', tag: 'school swimsuit' },
                { name: '职场OL正装', tag: 'office lady, collared shirt, pencil skirt' },
                { name: '全裸 (nude)', tag: 'nude, uncensored' }
            ]
        },
        {
            group: '🧦 鞋袜配饰',
            tags: [
                { name: '过膝袜 (thighhighs)', tag: 'thighhighs' },
                { name: '白色过膝袜', tag: 'white thighhighs' },
                { name: '黑色过膝袜', tag: 'black thighhighs' },
                { name: '条纹过膝袜', tag: 'striped thighhighs' },
                { name: '黑丝裤袜 (pantyhose)', tag: 'black pantyhose' },
                { name: '渔网袜 (fishnets)', tag: 'fishnets' },
                { name: '吊带袜 (garter belts)', tag: 'garter straps, thighhighs' },
                { name: '泡泡袜/堆堆袜', tag: 'loose socks' },
                { name: '高跟鞋 (high heels)', tag: 'high heels' },
                { name: '玛丽珍鞋', tag: 'mary janes' },
                { name: '长筒靴', tag: 'boots' },
                { name: '光脚/赤足 (barefoot)', tag: 'barefoot' }
            ]
        }
    ];

    function toggleTag(currentText, newTag) {
        const text = String(currentText || '').trim();
        const tagList = text.split(',').map(s => s.trim()).filter(Boolean);
        const normNewTag = newTag.trim().toLowerCase();
        
        const existingIdx = tagList.findIndex(t => t.toLowerCase() === normNewTag);
        if (existingIdx !== -1) {
            tagList.splice(existingIdx, 1);
        } else {
            tagList.push(newTag.trim());
        }
        return tagList.join(', ');
    }

    // ── Worldbook Modal Bridge ───────────────────────────────
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

    // ── Prompt Composition ───────────────────────────────────
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

    // ── Image Viewer & Popup Modal ───────────────────────────
    function showGeneratedImageModal(title, prompt, result, onSetAvatar = null) {
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
        modal.style.zIndex = '100000050';
        modal.innerHTML = `
            <div class="cw-modal" style="width:680px;max-width:95vw">
                <div class="cw-modal-hd">
                    <strong style="color:#38bdf8;font-size:14px"><i class="fa-solid fa-image"></i> ${esc(title)}</strong>
                    <button class="cw-btn sm" id="cw-img-close">✕</button>
                </div>
                <div class="cw-modal-bd" style="align-items:center;gap:12px">
                    <div style="width:100%;max-height:60vh;min-height:240px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);border-radius:8px;overflow:hidden">
                        <img src="${esc(url)}" style="max-width:100%;max-height:60vh;object-fit:contain;display:block" alt="Generated Image" />
                    </div>
                    <div style="width:100%;background:rgba(0,0,0,0.35);padding:8px 12px;border-radius:6px;font-size:11px;color:rgba(255,255,255,0.7);max-height:80px;overflow-y:auto;word-break:break-all">
                        <strong style="color:#38bdf8">提示词：</strong> ${esc(prompt)}
                    </div>
                </div>
                <div class="cw-modal-ft" style="justify-content:flex-end;gap:8px">
                    <a href="${esc(url)}" target="_blank" class="cw-btn sm cy" style="text-decoration:none"><i class="fa-solid fa-arrow-up-right-from-square"></i> 查看原图</a>
                    ${onSetAvatar ? `<button class="cw-btn sm gn" id="cw-img-set-avatar"><i class="fa-solid fa-user-check"></i> 设为角色头像</button>` : ''}
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
        if (onSetAvatar) {
            modal.querySelector('#cw-img-set-avatar')?.addEventListener('click', () => {
                onSetAvatar(url);
                toastr.success('已设置为角色头像！', PLUGIN_NAME);
                modal.remove();
            });
        }
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
    }

    // ── CSS Injection ────────────────────────────────────────
    (function injectStyles() {
        if (document.getElementById('cw-styles-v2')) return;
        const s = document.createElement('style');
        s.id = 'cw-styles-v2';
        s.textContent = `
.cw-wrap{display:flex;flex-direction:column;width:100%;height:100%;color:#f1f5f9;font-family:inherit;background:#0b1120}
.cw-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(15,23,42,.6);backdrop-filter:blur(12px);gap:12px;flex-wrap:wrap}
.cw-logo{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#38bdf8}
.cw-tabs{display:flex;gap:5px;background:rgba(0,0,0,.35);padding:4px;border-radius:8px;border:1px solid rgba(255,255,255,.08)}
.cw-tab{background:0 0;border:none;color:rgba(255,255,255,.65);padding:6px 14px;font-size:12.5px;font-weight:600;border-radius:6px;cursor:pointer;transition:.2s;display:inline-flex;align-items:center;gap:6px}
.cw-tab:hover{color:#fff;background:rgba(255,255,255,.08)}
.cw-tab.on{color:#38bdf8;background:rgba(56,189,248,.18);box-shadow:0 2px 8px rgba(56,189,248,.25)}
.cw-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px}
.cw-card{background:rgba(30,41,59,.45);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;backdrop-filter:blur(8px);display:flex;flex-direction:column;gap:10px}
.cw-card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cw-card-tt{font-size:13.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px;color:#e2e8f0}
.cw-grid5{width:260px;height:260px;background:rgba(15,23,42,.8);border:1.5px solid rgba(56,189,248,.35);border-radius:10px;display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(5,1fr);gap:2px;padding:3px;position:relative;box-shadow:inset 0 0 20px rgba(0,0,0,.6);flex-shrink:0}
.cw-cell{background:rgba(255,255,255,.03);border-radius:4px;border:1px dashed rgba(255,255,255,.1);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:.15s;position:relative;font-size:9.5px;color:rgba(255,255,255,.3);font-weight:bold}
.cw-cell:hover{background:rgba(56,189,248,.15);border-color:rgba(56,189,248,.5);color:#38bdf8}
.cw-cell.has{border-style:solid}
.cw-pin{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.7);position:absolute;z-index:2;cursor:pointer}
.cw-slot{background:rgba(15,23,42,.6);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;transition:.2s}
.cw-slot.on{border-color:#38bdf8;box-shadow:0 0 12px rgba(56,189,248,.18)}
.cw-slot-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cw-badge{padding:2px 8px;border-radius:5px;font-size:11px;font-weight:bold}
.cw-slot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.cw-in,.cw-sel,.cw-ta{width:100%;box-sizing:border-box;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.14);border-radius:6px;color:#fff;padding:6px 10px;font-size:12px;font-family:inherit;transition:.2s}
.cw-in:focus,.cw-sel:focus,.cw-ta:focus{outline:none;border-color:#38bdf8;background:rgba(0,0,0,.6)}
.cw-ta{min-height:48px;resize:vertical;font-family:monospace}
.cw-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:.2s;background:rgba(255,255,255,.08);color:#fff;white-space:nowrap;flex-shrink:0}
.cw-btn:hover{filter:brightness(1.2)}
.cw-btn.pri{background:linear-gradient(135deg,#0284c7,#38bdf8);border-color:rgba(56,189,248,.5);box-shadow:0 2px 10px rgba(56,189,248,.3);color:#fff}
.cw-btn.cy{background:rgba(56,189,248,.15);border-color:rgba(56,189,248,.4);color:#38bdf8}
.cw-btn.pk{background:rgba(244,114,182,.15);border-color:rgba(244,114,182,.4);color:#f472b6}
.cw-btn.gn{background:rgba(74,222,128,.15);border-color:rgba(74,222,128,.4);color:#4ade80}
.cw-btn.am{background:rgba(251,191,36,.15);border-color:rgba(251,191,36,.4);color:#fbbf24}
.cw-btn.rd{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.4);color:#ef4444}
.cw-btn.sm{padding:3px 8px;font-size:11px}
.cw-preview{background:rgba(15,23,42,.7);border:1px solid rgba(56,189,248,.3);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px}
.cw-code{background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:8px 10px;font-family:monospace;font-size:11px;color:#a5f3fc;word-break:break-all;max-height:120px;overflow-y:auto}
.cw-chgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.cw-chcard{background:rgba(30,41,59,.55);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;transition:.2s;position:relative}
.cw-chcard:hover{transform:translateY(-2px);border-color:rgba(56,189,248,.4);box-shadow:0 6px 20px rgba(0,0,0,.4)}
.cw-avatar{width:46px;height:46px;border-radius:8px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:20px;overflow:hidden;flex-shrink:0}
.cw-avatar img{width:100%;height:100%;object-fit:cover}
.cw-chip{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:3px 7px;font-size:11px;color:rgba(255,255,255,.75);cursor:pointer;transition:.15s;white-space:nowrap;user-select:none}
.cw-chip:hover{background:rgba(255,255,255,.12);color:#fff}
.cw-chip.on{background:rgba(56,189,248,.2)!important;border-color:rgba(56,189,248,.7)!important;color:#38bdf8!important;font-weight:bold}
.cw-modal-mask{position:fixed;inset:0;z-index:100000020;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.cw-modal{background:#0f172a;border:1px solid rgba(56,189,248,.35);border-radius:14px;width:860px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.9);box-sizing:border-box}
.cw-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(56,189,248,.08)}
.cw-modal-bd{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box}
.cw-modal-ft{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.35)}
.cw-warn{background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.4);border-radius:8px;padding:9px 14px;font-size:12px;color:#fbbf24;display:flex;align-items:center;gap:8px}
.cw-cat-pill{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:4px 9px;font-size:11px;color:rgba(255,255,255,.65);cursor:pointer;transition:.15s;white-space:nowrap}
.cw-cat-pill:hover{background:rgba(255,255,255,.1);color:#fff}
.cw-cat-pill.on{background:rgba(56,189,248,.2);border-color:rgba(56,189,248,.6);color:#38bdf8;font-weight:bold}
`;
        document.head.appendChild(s);
    })();

    // ── Character Editor Modal (Full 22-Group Builder) ────────
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
        let activeTraitGroupIdx = 0;
        const mask = document.createElement('div');
        mask.className = 'cw-modal-mask';

        function render() {
            const cw = draft.wardrobe[activeWIdx] || draft.wardrobe[0];
            const currentTraitGroup = BASE_TRAIT_PRESETS[activeTraitGroupIdx] || BASE_TRAIT_PRESETS[0];

            mask.innerHTML = `
                <div class="cw-modal" style="width:880px">
                    <div class="cw-modal-hd">
                        <strong style="color:#38bdf8;font-size:14px"><i class="fa-solid fa-id-card"></i> ${isEdit ? '编辑角色 · ' + esc(draft.displayName) : '✨ 新建角色档案'}</strong>
                        <button class="cw-btn sm" id="cw-ce-x">✕</button>
                    </div>
                    <div class="cw-modal-bd">
                        <!-- Top Row: Name & Avatar -->
                        <div class="cw-card" style="padding:10px 14px">
                            <div style="display:flex;gap:12px;align-items:center">
                                <div class="cw-avatar" style="width:52px;height:52px" id="cw-ce-avatar-box">
                                    ${draft.avatarUrl ? '<img src="' + esc(draft.avatarUrl) + '"/>' : '👤'}
                                </div>
                                <div style="flex:1;display:flex;flex-direction:column;gap:6px">
                                    <div style="display:flex;gap:8px">
                                        <input id="cw-ce-name" class="cw-in" type="text" placeholder="角色姓名 (例: 芙莉莲 / Frieren)" value="${esc(draft.displayName)}" style="font-weight:bold;font-size:13.5px" ${isEdit ? 'disabled' : ''} />
                                        <button class="cw-btn am sm" id="cw-ce-import-card" type="button"><i class="fa-solid fa-file-import"></i> 从当前角色卡导入</button>
                                    </div>
                                    <div style="display:flex;gap:6px;align-items:center">
                                        <span style="font-size:10.5px;color:rgba(255,255,255,.5);white-space:nowrap">头像 URL:</span>
                                        <input id="cw-ce-avatar-url" class="cw-in" type="text" placeholder="https://... 或生成立绘后自动填入" value="${esc(draft.avatarUrl)}" style="font-size:11px;padding:3px 8px" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Base Tags + 22-Group Tag Builder -->
                        <div class="cw-card">
                            <div class="cw-card-hd">
                                <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-dna"></i> 固有外貌设定 (Base Tags)</span>
                                <button class="cw-btn cy sm" id="cw-ce-wb-base" type="button"><i class="fa-solid fa-book-open"></i> 搜索世界书外貌</button>
                            </div>
                            
                            <!-- Category Pills -->
                            <div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,.06)">
                                ${BASE_TRAIT_PRESETS.map((g, idx) => `
                                    <button class="cw-cat-pill ${activeTraitGroupIdx === idx ? 'on' : ''}" data-gidx="${idx}" type="button">${esc(g.group)}</button>
                                `).join('')}
                            </div>

                            <!-- Active Category Chips -->
                            <div style="display:flex;gap:5px;flex-wrap:wrap;min-height:52px;max-height:100px;overflow-y:auto;background:rgba(0,0,0,.25);padding:8px;border-radius:6px">
                                ${currentTraitGroup.tags.map(t => `
                                    <button class="cw-chip cw-base-chip" data-tag="${esc(t.tag)}" type="button">${esc(t.name)}</button>
                                `).join('')}
                            </div>

                            <textarea id="cw-ce-base" class="cw-ta" placeholder="1girl, japanese, delicate face, silver hair, long twintails, green eyes, pale skin...">${esc(draft.baseTags)}</textarea>
                        </div>

                        <!-- Wardrobe -->
                        <div class="cw-card">
                            <div class="cw-card-hd">
                                <span class="cw-card-tt" style="color:#ffb86c"><i class="fa-solid fa-shirt"></i> 差分衣柜 (${draft.wardrobe.length} 套)</span>
                                <div style="display:flex;gap:6px">
                                    <button class="cw-btn am sm" id="cw-ce-wb-outfit" type="button"><i class="fa-solid fa-book-open"></i> 搜索世界书服装</button>
                                    <button class="cw-btn gn sm" id="cw-ce-add-w" type="button"><i class="fa-solid fa-plus"></i> 新增服装</button>
                                </div>
                            </div>
                            <div class="cw-tabs" style="overflow-x:auto">
                                ${draft.wardrobe.map((w, i) => `<button class="cw-tab cw-w-tab ${activeWIdx === i ? 'on' : ''}" data-wi="${i}">👗 ${esc(w.name || '服装' + (i + 1))}</button>`).join('')}
                            </div>
                            <div style="display:flex;gap:8px;align-items:center">
                                <input id="cw-ce-wname" class="cw-in" type="text" placeholder="服装名称" value="${esc(cw?.name || '')}" style="width:180px;flex-shrink:0" />
                                <div style="display:flex;gap:4px;flex-wrap:wrap;flex:1;overflow-x:auto">
                                    ${BASE_TRAIT_PRESETS.find(g => g.group.includes('服装'))?.tags.slice(0, 8).map(o => `
                                        <button class="cw-chip cw-outfit-chip" data-tag="${esc(o.tag)}" type="button">${esc(o.name)}</button>
                                    `).join('') || ''}
                                </div>
                                ${draft.wardrobe.length > 1 ? '<button class="cw-btn rd sm" id="cw-ce-del-w" type="button">✕ 删除此套</button>' : ''}
                            </div>
                            <textarea id="cw-ce-wtags" class="cw-ta" placeholder="sailor suit, pleated skirt, white thighhighs...">${esc(cw?.outfit || cw?.tags || '')}</textarea>
                        </div>
                    </div>
                    <div class="cw-modal-ft">
                        <button class="cw-btn cy" id="cw-ce-test" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> 🎨 测试单人立绘</button>
                        <div style="display:flex;gap:8px">
                            <button class="cw-btn" id="cw-ce-cancel">取消</button>
                            <button class="cw-btn pri" id="cw-ce-save">💾 保存角色档案</button>
                        </div>
                    </div>
                </div>`;

            const syncChips = () => {
                const base = (mask.querySelector('#cw-ce-base')?.value || '').toLowerCase();
                mask.querySelectorAll('.cw-base-chip').forEach(b => {
                    const tag = (b.dataset.tag || '').toLowerCase();
                    const isSelected = base.split(',').map(s => s.trim()).includes(tag);
                    b.classList.toggle('on', isSelected);
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

            // Category pill click
            mask.querySelectorAll('.cw-cat-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    activeTraitGroupIdx = Number(btn.dataset.gidx);
                    render();
                });
            });

            // Base trait chips
            mask.querySelectorAll('.cw-base-chip').forEach(b => b.addEventListener('click', () => {
                const el = mask.querySelector('#cw-ce-base');
                if (el) {
                    el.value = toggleTag(el.value, b.dataset.tag);
                    draft.baseTags = el.value;
                    syncChips();
                }
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
                if (draft.wardrobe.length > 1) {
                    draft.wardrobe.splice(activeWIdx, 1);
                    activeWIdx = Math.max(0, activeWIdx - 1);
                    render();
                }
            });
            mask.querySelector('#cw-ce-wname')?.addEventListener('input', e => { if (draft.wardrobe[activeWIdx]) draft.wardrobe[activeWIdx].name = e.target.value; });
            mask.querySelector('#cw-ce-wtags')?.addEventListener('input', e => { if (draft.wardrobe[activeWIdx]) draft.wardrobe[activeWIdx].outfit = e.target.value; });

            mask.querySelectorAll('.cw-outfit-chip').forEach(b => b.addEventListener('click', () => {
                const el = mask.querySelector('#cw-ce-wtags');
                if (el && draft.wardrobe[activeWIdx]) {
                    el.value = toggleTag(el.value, b.dataset.tag);
                    draft.wardrobe[activeWIdx].outfit = el.value;
                }
            }));

            // Worldbook pickers
            mask.querySelector('#cw-ce-wb-base')?.addEventListener('click', () => {
                openWorldbookPicker('挑选外貌特征词条', tags => {
                    const el = mask.querySelector('#cw-ce-base');
                    if (el) {
                        el.value = [el.value, tags].filter(Boolean).join(', ');
                        draft.baseTags = el.value;
                        syncChips();
                    }
                }, 'appearance');
            });
            mask.querySelector('#cw-ce-wb-outfit')?.addEventListener('click', () => {
                openWorldbookPicker('挑选服装词条', tags => {
                    const el = mask.querySelector('#cw-ce-wtags');
                    if (el && draft.wardrobe[activeWIdx]) {
                        el.value = tags;
                        draft.wardrobe[activeWIdx].outfit = tags;
                    }
                }, 'outfit');
            });

            // Import from ST card
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
                    toastr.success('已导入「' + draft.displayName + '」', PLUGIN_NAME);
                    render();
                } catch (e) { toastr.error('导入失败: ' + e.message, PLUGIN_NAME); }
            });

            // Test Single Portrait Generation
            mask.querySelector('#cw-ce-test')?.addEventListener('click', async (ev) => {
                const btn = ev.currentTarget;
                const origHtml = btn.innerHTML;
                const name = draft.displayName || 'Character';
                const outfit = draft.wardrobe[activeWIdx]?.outfit || draft.wardrobe[activeWIdx]?.tags || '';
                const prompt = [draft.baseTags, outfit, 'solo, standing, looking at viewer, simple background, upper body'].filter(Boolean).join(', ');

                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在生成立绘...';
                toastr.info(`正在为「${name}」生成单人立绘测试...`, PLUGIN_NAME);

                try {
                    const result = await RBQ.api.generateImage(prompt, 'cw-test', {}, (progress) => {
                        if (typeof progress === 'string') btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${progress.slice(0, 10)}...`;
                    });

                    if (result && result.url) {
                        showGeneratedImageModal(`单人立绘测试 · ${name}`, prompt, result, (newAvatarUrl) => {
                            draft.avatarUrl = newAvatarUrl;
                            const urlEl = mask.querySelector('#cw-ce-avatar-url');
                            if (urlEl) urlEl.value = newAvatarUrl;
                            const ab = mask.querySelector('#cw-ce-avatar-box');
                            if (ab) ab.innerHTML = `<img src="${esc(newAvatarUrl)}"/>`;
                        });
                        toastr.success('立绘生成完毕！', PLUGIN_NAME);
                    } else {
                        throw new Error('生图未返回有效图片地址');
                    }
                } catch (e) {
                    toastr.error('生成失败: ' + (e.message || e), PLUGIN_NAME);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = origHtml;
                }
            });

            // Save Character
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

    // ── Tab 1: 角色档案库 (Dossier) ──────────────────────────
    function renderDossierTab() {
        const profiles = getAllProfiles();
        const names = Object.keys(profiles);

        return `<div class="cw-body">
            <div class="cw-card">
                <div class="cw-card-hd">
                    <div>
                        <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-users"></i> SDT 角色档案库 (${names.length} 位)</span>
                        <div style="font-size:11px;opacity:.65;margin-top:2px">直接双向读写智能生图触发器的角色记忆与差分衣柜，修改即时同步生效。</div>
                    </div>
                    <div style="display:flex;gap:8px">
                        <button class="cw-btn am sm" id="cw-import-current-card"><i class="fa-solid fa-file-import"></i> 导入当前角色卡</button>
                        <button class="cw-btn gn sm" id="cw-create-char"><i class="fa-solid fa-plus"></i> 新建角色档案</button>
                    </div>
                </div>

                <div class="cw-chgrid" style="margin-top:8px">
                    ${names.length === 0 ? '<div style="text-align:center;padding:40px;grid-column:1/-1;opacity:.6">当前聊天暂无角色档案。<br/>点击右上角「从当前角色卡导入」或「新建角色档案」开始创建！</div>' : names.map(n => {
                        const p = profiles[n];
                        const wCount = Array.isArray(p.wardrobe) ? p.wardrobe.length : 0;
                        return `<div class="cw-chcard">
                            <div style="display:flex;gap:10px;align-items:flex-start">
                                <div class="cw-avatar">${p.avatarUrl ? '<img src="' + esc(p.avatarUrl) + '"/>' : '👤'}</div>
                                <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:3px">
                                    <span style="font-size:13.5px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.displayName || n)}</span>
                                    <span style="font-size:11px;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.baseTags)}"><span style="color:#79e4ff">外貌:</span> ${esc(p.baseTags || '未设置')}</span>
                                    <span style="font-size:10.5px;color:#ffb86c">👗 ${wCount} 套服装 · 当前: ${esc((p.currentOutfit || '').slice(0, 25) || '默认')}</span>
                                </div>
                            </div>
                            <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px">
                                <button class="cw-btn cy sm cw-send-to-stage" data-name="${esc(n)}" title="将该角色加入多角色舞台"><i class="fa-solid fa-chess-board"></i> 放入舞台</button>
                                <button class="cw-btn sm cw-edit-char" data-name="${esc(n)}"><i class="fa-solid fa-pen-to-square"></i> 编辑</button>
                                <button class="cw-btn rd sm cw-del-char" data-name="${esc(n)}"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        </div>`;
    }

    // ── Tab 2: 多角色空间舞台 (Stage & Composer) ─────────────
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
            ${!mccOn ? '<div class="cw-warn"><i class="fa-solid fa-triangle-exclamation"></i> 提示：多角色合成插件 (Multi-Char) 未启用，生成的图片可能无法正确按照空间位置进行角色分区。</div>' : ''}

            <!-- 5x5 Grid & Scene Settings -->
            <div class="cw-card">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-chess-board"></i> 5x5 空间舞台定位 (点击网格摆放当前激活角色)</span>
                    <button class="cw-btn cy sm" id="cw-pick-scene-wb" type="button"><i class="fa-solid fa-mountain-sun"></i> 搜索世界书场景</button>
                </div>
                <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
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

                    <!-- Stage Controls & Scene Inputs -->
                    <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:8px;font-size:12px;color:rgba(255,255,255,.75)">
                        <div style="font-weight:700;color:#f8fafc;font-size:13.5px">
                            当前激活控制: <span style="color:${COLORS[ai % COLORS.length].hex}">Char ${ai + 1} (${esc(slots[ai]?.charName || '未绑定')})</span>
                            <small style="margin-left:6px;opacity:.7">[${coordLabel(slots[ai]?.center)}]</small>
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                            ${slots.map((s, i) => {
                                const cl = COLORS[i % COLORS.length];
                                return `<div class="cw-chip cw-switch-slot ${ai === i ? 'on' : ''}" data-idx="${i}" style="border-color:${ai === i ? cl.bdr : 'transparent'}">● Char ${i + 1}: ${esc(s.charName || '未绑定')} (${s.center || 'C3'})</div>`;
                            }).join('')}
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
                            <div>
                                <label style="font-size:11px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:3px">场景环境 (Scene):</label>
                                <input id="cw-scene" class="cw-in" type="text" placeholder="indoors, modern room, soft sunlight..." value="${esc(comp.scene || '')}" />
                            </div>
                            <div>
                                <label style="font-size:11px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:3px">视角光影 (Camera/Light):</label>
                                <input id="cw-camera" class="cw-in" type="text" placeholder="from_side, depth_of_field, volumetric lighting..." value="${esc(comp.camera || '')}" />
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
                <div style="display:flex;flex-direction:column;gap:12px">
                    ${slots.map((slot, i) => {
                        const cl = COLORS[i % COLORS.length];
                        const isActive = ai === i;
                        const prof = slot.charName ? profiles[slot.charName] : null;
                        const wardrobe = prof?.wardrobe || [];
                        return `<div class="cw-slot ${isActive ? 'on' : ''}" data-idx="${i}">
                            <div class="cw-slot-top">
                                <div style="display:flex;align-items:center;gap:8px">
                                    <span class="cw-badge" style="background:${cl.bg};color:${cl.hex}">Char ${i + 1}</span>
                                    <strong style="font-size:13px;color:#f8fafc">${esc(prof?.displayName || slot.charName || '未绑定')}</strong>
                                    <span style="font-size:11px;opacity:.65">[位置: ${coordLabel(slot.center)}]</span>
                                </div>
                                <div style="display:flex;gap:6px">
                                    <button class="cw-btn cy sm cw-activate-slot" data-idx="${i}" type="button">🎯 选中</button>
                                    ${slots.length > 1 ? `<button class="cw-btn rd sm cw-rm-slot" data-idx="${i}" type="button">✕ 移除</button>` : ''}
                                </div>
                            </div>
                            <div class="cw-slot-grid">
                                <div>
                                    <label style="font-size:11px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:2px">绑定角色档案:</label>
                                    <select class="cw-sel cw-slot-char" data-idx="${i}">
                                        <option value="">👤 [未绑定]</option>
                                        ${profileNames.map(n => `<option value="${esc(n)}" ${slot.charName === n ? 'selected' : ''}>👤 ${esc(profiles[n].displayName || n)}</option>`).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label style="font-size:11px;font-weight:bold;color:#cbd5e1;display:block;margin-bottom:2px">穿着服装:</label>
                                    <select class="cw-sel cw-slot-outfit" data-idx="${i}">
                                        <option value="" ${!slot.outfitId && !slot.customOutfit ? 'selected' : ''}>👗 默认穿着</option>
                                        ${wardrobe.map(w => `<option value="${esc(w.id)}" ${slot.outfitId === w.id ? 'selected' : ''}>👗 ${esc(w.name)}</option>`).join('')}
                                        <option value="__custom" ${slot.customOutfit ? 'selected' : ''}>✍️ 自定义服装</option>
                                    </select>
                                </div>
                                <div style="grid-column:1/-1">
                                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                                        <label style="font-size:11px;font-weight:bold;color:#cbd5e1">动作与神态 (Action):</label>
                                        <button class="cw-btn cy sm cw-pick-action-wb" data-idx="${i}" type="button"><i class="fa-solid fa-book-open"></i> 搜索世界书动作</button>
                                    </div>
                                    <input class="cw-in cw-slot-action" data-idx="${i}" type="text" placeholder="sitting, facing another, smiling, looking at partner..." value="${esc(slot.action || '')}" />
                                </div>
                                <div style="grid-column:1/-1">
                                    <label style="font-size:11px;font-weight:bold;color:#f87171;margin-bottom:2px;display:block">角色独立负面词 (Char UC):</label>
                                    <input class="cw-in cw-slot-uc" data-idx="${i}" type="text" placeholder="可选：针对该角色的独立负面词 (如 penis, futanari...)" value="${esc(slot.uc || '')}" />
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <!-- Live Prompt Preview & One-Click Generate -->
            <div class="cw-preview">
                <div class="cw-card-hd">
                    <span class="cw-card-tt" style="color:#38bdf8"><i class="fa-solid fa-terminal"></i> 多角色合成提示词实时预览 (NAI V4.5 Format)</span>
                    <div style="display:flex;gap:6px">
                        <button class="cw-btn sm" id="cw-copy-prompt"><i class="fa-regular fa-copy"></i> 复制提示词</button>
                        <button class="cw-btn am sm" id="cw-save-preset"><i class="fa-solid fa-floppy-disk"></i> 保存为预设</button>
                    </div>
                </div>
                <div class="cw-code" id="cw-prompt-preview">${esc(finalPrompt)}</div>
                <div style="display:flex;justify-content:flex-end;margin-top:4px">
                    <button class="cw-btn pri" id="cw-generate" style="padding:8px 24px;font-size:13.5px;font-weight:bold">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 🚀 立即合成并生图
                    </button>
                </div>
            </div>
        </div>`;
    }

    // ── Tab 3: 分镜模板与预设 (Presets) ──────────────────────
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
                            <strong style="font-size:13px;color:#38bdf8">${esc(t.name)}</strong>
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
                            <strong style="font-size:13px;color:#f8fafc">${esc(p.name)}</strong>
                            <span class="cw-badge" style="background:rgba(251,191,36,.15);color:#fbbf24">${p.slots?.length || 0} 人</span>
                        </div>
                        <div style="font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.scene || '无场景描述')}</div>
                        <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px">
                            <button class="cw-btn gn sm cw-load-preset" data-idx="${i}"><i class="fa-solid fa-download"></i> 载入</button>
                            <button class="cw-btn rd sm cw-del-preset" data-idx="${i}"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>`).join('')}
                </div>
            </div>
        </div>`;
    }

    // ── Main Shell & Event Binding ───────────────────────────
    let activeTab = 'dossier'; // Default to Dossier first for character management

    function renderMain(tab = activeTab) {
        activeTab = tab;
        const charCount = Object.keys(getAllProfiles()).length;
        const presetCount = getWs().presets.length;

        return `
            <div class="cw-wrap">
                <div class="cw-hdr">
                    <div class="cw-logo">
                        <i class="fa-solid fa-palette"></i>
                        <span>角色工坊</span>
                        <small style="font-size:11px;font-weight:normal;opacity:.6">v${VERSION}</small>
                    </div>
                    <div class="cw-tabs">
                        <button class="cw-tab ${activeTab === 'dossier' ? 'on' : ''}" data-tab="dossier">
                            <i class="fa-solid fa-users"></i> 角色档案库 (${charCount})
                        </button>
                        <button class="cw-tab ${activeTab === 'composer' ? 'on' : ''}" data-tab="composer">
                            <i class="fa-solid fa-chess-board"></i> 多角色空间舞台
                        </button>
                        <button class="cw-tab ${activeTab === 'presets' ? 'on' : ''}" data-tab="presets">
                            <i class="fa-solid fa-bookmark"></i> 分镜模板与预设 (${presetCount})
                        </button>
                    </div>
                </div>
                ${activeTab === 'dossier' ? renderDossierTab() : ''}
                ${activeTab === 'composer' ? renderComposerTab() : ''}
                ${activeTab === 'presets' ? renderPresetsTab() : ''}
            </div>
        `;
    }

    function bindEvents(container, refresh) {
        // Tab Switching
        container.querySelectorAll('.cw-tab').forEach(b => {
            b.addEventListener('click', () => refresh(b.dataset.tab));
        });

        const ws = getWs();
        const comp = ws.activeComposer;

        // ── Dossier Events ──
        container.querySelector('#cw-create-char')?.addEventListener('click', () => {
            openCharacterEditor(null, () => refresh('dossier'));
        });

        container.querySelector('#cw-import-current-card')?.addEventListener('click', () => {
            try {
                const ctx = (window.RBQ && window.RBQ.api && typeof window.RBQ.api.getContext === 'function')
                    ? window.RBQ.api.getContext()
                    : (window.SillyTavern && typeof window.SillyTavern.getContext === 'function' ? window.SillyTavern.getContext() : null);
                
                const cid = ctx?.characterId;
                const cd = ctx?.characters?.[cid];
                if (!cd || !cd.name) return toastr.warning('未检测到当前角色卡', PLUGIN_NAME);

                openCharacterEditor(null, () => refresh('dossier'));
                // The editor modal itself has an import button, or we can trigger it directly
            } catch (e) { toastr.error('导入失败: ' + e.message, PLUGIN_NAME); }
        });

        container.querySelectorAll('.cw-send-to-stage').forEach(b => b.addEventListener('click', () => {
            const charName = b.dataset.name;
            const slots = comp.slots;
            const emptySlot = slots.find(s => !s.charName);
            if (emptySlot) {
                emptySlot.charName = charName;
            } else {
                slots.push({ charName, outfitId: '', customOutfit: '', action: '', uc: '', center: 'C3' });
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

        // ── Composer / Stage Events ──
        const updatePromptPreview = () => {
            const el = container.querySelector('#cw-prompt-preview');
            if (el) el.textContent = composeFinalPrompt(comp);
        };

        // Grid Click
        container.querySelectorAll('#cw-stage .cw-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const coord = cell.dataset.coord;
                const ai = comp.activeSlotIndex || 0;
                if (comp.slots[ai]) {
                    comp.slots[ai].center = coord;
                    wsSave();
                    refresh('composer');
                }
            });
        });

        // Switch active slot
        container.querySelectorAll('.cw-switch-slot, .cw-activate-slot').forEach(b => {
            b.addEventListener('click', () => {
                comp.activeSlotIndex = +b.dataset.idx;
                wsSave();
                refresh('composer');
            });
        });

        // Add Slot
        container.querySelector('#cw-add-slot')?.addEventListener('click', () => {
            comp.slots.push({ charName: '', outfitId: '', customOutfit: '', action: '', uc: '', center: 'C3' });
            comp.activeSlotIndex = comp.slots.length - 1;
            wsSave();
            refresh('composer');
        });

        // Remove Slot
        container.querySelectorAll('.cw-rm-slot').forEach(b => b.addEventListener('click', () => {
            const idx = +b.dataset.idx;
            if (comp.slots.length > 1) {
                comp.slots.splice(idx, 1);
                comp.activeSlotIndex = Math.max(0, comp.activeSlotIndex - 1);
                wsSave();
                refresh('composer');
            }
        }));

        // Slot Char Select
        container.querySelectorAll('.cw-slot-char').forEach(sel => {
            sel.addEventListener('change', () => {
                const idx = +sel.dataset.idx;
                if (comp.slots[idx]) {
                    comp.slots[idx].charName = sel.value;
                    comp.slots[idx].outfitId = '';
                    wsSave();
                    refresh('composer');
                }
            });
        });

        // Slot Outfit Select
        container.querySelectorAll('.cw-slot-outfit').forEach(sel => {
            sel.addEventListener('change', () => {
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
            });
        });

        // Slot Action & UC Inputs
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

        // Scene & Camera inputs
        container.querySelector('#cw-scene')?.addEventListener('input', e => { comp.scene = e.target.value; wsSave(); updatePromptPreview(); });
        container.querySelector('#cw-camera')?.addEventListener('input', e => { comp.camera = e.target.value; wsSave(); updatePromptPreview(); });

        // Copy Prompt
        container.querySelector('#cw-copy-prompt')?.addEventListener('click', () => {
            const p = composeFinalPrompt(comp);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(p).then(() => toastr.success('已复制合成提示词', PLUGIN_NAME));
            }
        });

        // Save Custom Preset
        container.querySelector('#cw-save-preset')?.addEventListener('click', () => {
            const name = prompt('请输入该多角色分镜预设的名称：', '多角色分镜 ' + new Date().toLocaleDateString());
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

            if (!isMccEnabled()) {
                toastr.warning('多角色合成插件未启用，生成的图片可能无法正确分配角色位置', PLUGIN_NAME);
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在生成多角色画面...';
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

        // ── Presets Tab Events ──
        container.querySelectorAll('.cw-load-tpl').forEach(b => b.addEventListener('click', () => {
            const tpl = TEMPLATES[+b.dataset.idx];
            if (!tpl) return;
            comp.scene = tpl.scene || '';
            comp.camera = tpl.camera || '';
            comp.slots = JSON.parse(JSON.stringify(tpl.slots || []));
            comp.activeSlotIndex = 0;
            wsSave();
            toastr.success(`已载入模板「${tpl.name}」到舞台`, PLUGIN_NAME);
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

    // ── Panel Mount via RBQ.ui.addSettingPanel ───────────────
    function mount() {
        if (!RBQ.ui || typeof RBQ.ui.addSettingPanel !== 'function') {
            return console.warn('[CW] RBQ.ui.addSettingPanel not available');
        }
        RBQ.ui.addSettingPanel('character-workshop', '<i class="fa-solid fa-palette"></i><span>角色工坊</span>', () => {
            const w = document.createElement('div');
            w.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden';
            const refresh = (tab) => {
                w.innerHTML = renderMain(tab);
                bindEvents(w, refresh);
            };
            refresh(activeTab);
            return w;
        });
    }

    mount();
    console.info('[' + PLUGIN_NAME + '] v' + VERSION + ' loaded — SDT full integration');

})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
