(function (RBQ, $, toastr) {
    if (!RBQ) return console.error('[Character Workshop] RBQ Core API missing');

    const PLUGIN_NAME = '角色工坊 (Character Workshop)';
    const STORAGE_KEY = '_characterWorkshop';
    const SDT_STORAGE_KEY = '_smartDrawTrigger';

    // ── Helper Utilities ─────────────────────────────────────
    function uid(prefix = 'cw') {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY] || typeof s[STORAGE_KEY] !== 'object') {
            s[STORAGE_KEY] = {
                enabled: true,
                characters: {},
                presets: [],
                activeComposer: {
                    scene: 'indoors, cozy room, warm_lighting, soft_light',
                    camera: 'looking_at_viewer',
                    atmosphere: '',
                    slots: [
                        { charId: '', customName: '主角', outfitMode: 'current', customOutfit: '', action: 'standing, smiling', center: 'B3', uc: '' },
                        { charId: '', customName: '女主角', outfitMode: 'current', customOutfit: '', action: 'sitting, looking_at_viewer', center: 'D3', uc: '' }
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
                camera: 'looking_at_viewer',
                atmosphere: '',
                slots: [
                    { charId: '', customName: '角色 1', outfitMode: 'current', customOutfit: '', action: '', center: 'B3', uc: '' },
                    { charId: '', customName: '角色 2', outfitMode: 'current', customOutfit: '', action: '', center: 'D3', uc: '' }
                ]
            };
        }
        return store;
    }

    function save() {
        RBQ.api.saveSettings();
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

    function formatCoordLabel(coordStr) {
        const c = String(coordStr || 'C3').toUpperCase().trim();
        return COORD_LABELS[c] ? `${c} (${COORD_LABELS[c]})` : c;
    }

    // ── Worldbook Integration (专业级多层世界书分类体系) ──────────────
    const LOREBOOK_TAXONOMY = {
        nsfw: {
            id: 'nsfw',
            name: '互动体位',
            icon: 'fa-solid fa-heart-pulse',
            color: '#ff79c6',
            subcategories: [
                { 
                    id: 'positions', 
                    name: '经典交合体位', 
                    keywords: ['正常位', '传教士', '骑乘位', '女上位', '后入位', '后背位', '狗爬式', '侧入位', '侧入', '站交', '立位', '火车便当', '坐姿体位', '坐姿做爱', '坐位', '坐骑', '交尾', '配种', '插入', '性交', '做爱', '交配', '对坐', '面对面', '背面', '肛交', '69式', '69', '大车小孩', '腹击交', '性爱', '整体体位'],
                    tagRegex: /\b(missionary|cowgirl_position|doggystyle|standing_sex|mating_press|spooning|sex_from_behind|sex|penetration|vaginal|anal)\b/i 
                },
                { 
                    id: 'service', 
                    name: '口交/侍奉与器官交', 
                    keywords: ['口交', '深喉', '舔穴', '男口女', '女口男', '手交', '打飞机', '乳交', '揉胸', '抓乳', '腿交', '足交', '耳交', '发交', '侍奉', '舔舐', '咬住', '吸吮', '舔脚', '胸部动作', '掰开小穴', '展示小穴', '母牛挤奶', '母牛榨乳', '挤奶', '胀乳', '哺乳', '扒开', '送奶', '足穴', '臀交', '擦拭阴部', '肛门展示', '胸部拔剑', '吃胡萝卜', '吃冰棒', '嗦冰棒', '嗦冰棍', '协作/侍奉', '素股', '腋交', '踩交', '扣穴', '袭胸', '踩穴', '踩踏', '剃毛', '按摩', '协作', '榨精', '攻守反转榨精', '飞机杯'],
                    tagRegex: /\b(fellatio|deepthroat|cunnilingus|handjob|paizuri|footjob|thighjob|oral|licking|breast_grab|nipple_tweak|lactation|tribadism)\b/i 
                },
                { 
                    id: 'masturbation_fluids', 
                    name: '自慰/高潮与精液', 
                    keywords: ['自慰', '手淫', '跳蛋', '假阳具', '振动棒', '振动器', '情趣玩具', '高潮', '绝顶', '潮吹', '失神', '受孕', '孕肚', '分娩', '产卵', '阿黑颜', '颜射', '饮精', '内射', '中出', '精液', '精液浴', '尿', '放尿', '屎', '排泄', '精液混合食物', '吃精液', '品味精液', '事后', '事后性爱', '处女膜', '射精', '排精', '榨乳', '肠镜', '内窥镜', '小穴漏斗', '大阴茎'],
                    tagRegex: /\b(masturbation|dildo|vibrator|orgasm|squirt|impregnation|pregnant|giving_birth|ahegao|facial|creampie|bukkake|cum|pee|aftersex)\b/i 
                },
                { 
                    id: 'beast_monster', 
                    name: '兽交与动物交配', 
                    keywords: ['兽奸', '狗奸', '狗妻子', '狗交', '犬交', '马交', '猪交', '蛇奸', '虫奸', '兽人交配', '人兽', '兽交', '人犬交配', '动物交配', '虫浴', 'bestiality'],
                    tagRegex: /\b(bestiality|dog_sex|horse_sex)\b/i 
                },
                { 
                    id: 'tentacles_creature', 
                    name: '触手与异种魔物', 
                    keywords: ['触手', '触手交', '触手侵犯', '触手腐化', '恶堕触手', '史莱姆', '史莱姆娘', '异形', '寄生', '人外交配', '异种奸', '魔物娘', '兽人侵犯', '宝箱怪', '哥布林', '哥布林性爱', '哥布林奴隶', '哥布林战俘', '丧尸化', '僵尸娘', '魔化', '石化'],
                    tagRegex: /\b(tentacles|tentacle_sex|slime|monster|alien|parasite|oviposition|creature|goblin)\b/i 
                },
                { 
                    id: 'bdsm_control', 
                    name: '调教/拘束与BDSM', 
                    keywords: ['调教', '宠物调教', '母狗', '母畜', '犬化', '狗屋', '宠物求食', '拘束', '拘束放置', '束缚', '肉便器', '绳缚', '木马', '驷马缚', '手铐', '项圈', '牵引', '链条', '贞操带', '口部限制道具', '性玩具', 'BDSM', 'BDSM道具', '羞辱', '支配', '臣服', '女奴', '奴隶', '窒息', '放置吊缚', '胁迫', '灌肠', '阴道书法', '胯绳', '扩张带', '异物插入', '肛门拔剑', '小穴拔剑', '宫脱', '脱垂', '子宫脱垂', '穿环', '口环', '舌钉', '乳链', '淫纹烙印', '静修捆绑', '人肉沙袋', '人肉烟灰缸', '人体家具', '扇巴掌', '踩头', '拳交', '攻守反转男m'],
                    tagRegex: /\b(bondage|ropes|handcuffs|blindfold|collar_leash|bdsm|humiliation|submissive|piercing|prolapse|spanking)\b/i 
                },
                { 
                    id: 'extreme_guro', 
                    name: '截肢/人棍与极端重口', 
                    keywords: ['截肢', '人棍', '截肢/人棍', '人彘', '人槛', '秀色', '杀害', '刑罚', '殴打', '暴力', '肉体改造', '机械奸改造', '机械奸', '血腥', '猎奇', '斩首', '绞杀', '奸尸', '人体拼接化', '雪人化', '无头骑士', '吸血'],
                    tagRegex: /\b(amputation|guro|torture|snuff|meat_toilet|beheading|necrophilia)\b/i 
                },
                { 
                    id: 'group_ntr', 
                    name: '多人轮奸与群交', 
                    keywords: ['多p', '多p/轮奸', '轮奸', '群交', '多男一女', '多女一男', '双飞', '3p', '前后夹击', '群交前后夹击', '百合', '女同', '群P', '混交', '乱交', '婊子滥交组件', '婊子组件', '露出', '街头露出', '偷拍', '偷窥', '绿帽', 'NTR', '母女', '电车暴露', '壁尻', '光荣洞', '败北', '暴露/偷窥'],
                    tagRegex: /\b(gangbang|group_sex|threesome|ffm_threesome|mmf_threesome|double_penetration|yuri|lesbian|exhibitionism|voyeurism|ntr)\b/i 
                },
                { 
                    id: 'forced_crime', 
                    name: '强奸/猥亵与催眠', 
                    keywords: ['猥亵', '强奸', '迷奸', '催眠', '洗脑', '绑架', '电车猥亵', '公车猥亵', '下药', '诱骗萝莉', '援交', '夜袭', '偷情', '药物'],
                    tagRegex: /\b(molestation|rape|hypnosis|mind_control|blackmail)\b/i 
                },
                { 
                    id: 'alternative_daily', 
                    name: '另类日常与情境性爱', 
                    keywords: ['另类日常', '诱惑', '醉酒', '睡眠性爱', '睡眠睡奸', '睡眠口交', '睡眠颜射', '时间停止', '电梯', '野外', '车震', '女体盛', '钢管舞', '雌小鬼', '小正太', '婴儿退行', '人格排泄', '录像性爱', '避孕套', '买避孕套', '卡在洗衣机', '仙女涩涩版', '恶堕', '恶堕之后', '直播性爱', '直播意外', '打游戏性爱', '开门性爱', '泳池性爱', '共浴', '人体宴', '色情杂志', 'AV封面', 'AV拍摄', '幼女化', '另类舞蹈'],
                    tagRegex: /\b(seduction|sleep_sex|somnophilia|elevator|public_sex|nyotaimori|pole_dancing|mecha_sex)\b/i 
                }
            ]
        },
        outfit: {
            id: 'outfit',
            name: '服装穿搭',
            icon: 'fa-solid fa-shirt',
            color: '#ffb86c',
            subcategories: [
                { id: 'casual', name: '日常私服', keywords: ['服装', '日常服', '日常服装', '私服', '日常', 'T恤', '卫衣', '衬衫', '毛衣', '外套', '夹克', '大衣', '牛仔裤', '短裙', '百褶裙', '连衣裙', '裙子', '上装', '下装', '着装', '脱衣', '敞开', '裸背', '屁股', '露背', '破损衣服', '展示衣物', '材质', '和服', '汉服', '礼盒中', '童装', '紧身长裙', '吊带裙', '冬装', '淑女', '潮流', '斗篷', '风衣'] },
                { id: 'uniform', name: '制服职业', keywords: ['制服', '校服', '水手服', '西装', '女仆', '护士', '修女', '警服', '旗袍', '巫女', '军服', '军装', '职场', 'OL', '兔女郎', '体操服', '运动服', '啦啦队', '魔法少女', '小学生服', '幼儿园', '职业', '身份', '忍者'] },
                { id: 'swimwear', name: '泳装内衣', keywords: ['泳装', '泳衣', '比基尼', '死库水', '内衣', '文胸', '胸罩', '内裤', '胖次', '情趣内衣', '蕾丝内衣', '吊带睡衣', '睡衣', '浴袍', '下着', '乳贴', '泳圈'] },
                { id: 'accessories', name: '鞋袜饰品', keywords: ['鞋袜', '丝袜', '黑丝', '白丝', '过膝袜', '短袜', '吊袜带', '高跟鞋', '靴子', '手套', '项圈', '手镯', '项链', '耳环', '帽子', '头饰', '眼镜', '首饰', '饰品', '发饰'] },
                { id: 'costume', name: '情趣特装', keywords: ['胶衣', '紧身衣', '皮衣', '魅魔装', '透视装', '镂空', '母猪装', '兽装', '动物兽装', '拘束装', '裸体围裙', '机甲', '铠甲', '人偶'] }
            ]
        },
        pose: {
            id: 'pose',
            name: '日常姿态',
            icon: 'fa-solid fa-person-walking',
            color: '#a3ffa3',
            subcategories: [
                { id: 'single_action', name: '单人动作', keywords: ['动作', '姿势', '动作/姿势', '站姿', '坐姿', '躺姿', '趴姿', '跪姿', '倾靠', '走', '跑', '跳', '蹲', '单手插腰', '双手抱胸', '托腮', '挥手', '比心', '敬礼', '伸手', '撩发', '腿部动作', '手臂动作', '手动作', '指向', '倒立', '造型', '基本动作', '土下座', '二人四足', '递礼物', '写生', '淋浴', '怀抱婴儿', '潜水', '运动后', '展示', '部位强调', '头发互动'] },
                { id: 'fitness_food', name: '健身与日常饮食', keywords: ['健身', '跑步', '瑜伽', '拉伸', '一字马', '吃饭', '吃汉堡', '吃热狗', '吃东西', '吃水果', '美食有关', '美食', '野餐', '喝水', '饮水', '喝酒', '夜店', '洗车'] },
                { id: 'dynamic_combat', name: '战斗动态', keywords: ['战斗', '拔刀', '施法', '跳跃', '飞踢', '回眸', '冲刺', '防守', '持枪', '持剑', '蓄力', '踢击', '拳击', '挥刀', '射击', '冲锋', '打斗', '刀太刀', '刀'] }
            ]
        },
        interaction: {
            id: 'interaction',
            name: '双人互动',
            icon: 'fa-solid fa-people-arrows',
            color: '#79e4ff',
            subcategories: [
                { id: 'duo_gentle', name: '亲密温情', keywords: ['互动', '双人', '接吻', '亲吻', '相拥', '拥抱', '牵手', '依偎', '对视', '摸头', '捏脸', '公主抱', '背着', '靠肩', '共伞', '耳语', '双人姿势', '双人互动'] },
                { id: 'duo_daily', name: '日常社交', keywords: ['对话', '聊天', '打闹', '并肩', '跳舞', '递东西', '敬酒', '拍照', '合影', '共进晚餐', '友好互动'] }
            ]
        },
        appearance: {
            id: 'appearance',
            name: '外貌特征',
            icon: 'fa-solid fa-user-astronaut',
            color: '#79e4ff',
            subcategories: [
                { id: 'hair', name: '发型发色', keywords: ['发型', '发色', '双马尾', '单马尾', '短发', '长发', '马尾', '刘海', '编发', '呆毛', '渐变发', '发饰', '发'] },
                { id: 'eyes', name: '眼部瞳色', keywords: ['眼', '瞳', '瞳色', '异色瞳', '眼睛', '红瞳', '蓝瞳', '金瞳', '绿瞳', '爱心眼', '魔眼', '眼罩', '猫眼'] },
                { id: 'face', name: '面部表情', keywords: ['表情', '脸部', '脸红', '微笑', '哭泣', '生气', '张嘴', '吐舌', '害羞', '傲娇', '嘟嘴', '头部动作', '胃痛', '滴口水', '鄙视'] },
                { id: 'race', name: '种族特征', keywords: ['种族', '特征', '兽耳', '猫耳', '狐耳', '兔耳', '狗耳', '狼耳', '精灵耳', '尾巴', '猫尾', '狐尾', '翅膀', '羽翼', '角', '恶魔角', '光环', '天使', '魅魔', '机娘', '人外', '福瑞', '龙娘', '龙族', '扶她', '精灵', '恶魔/吸血鬼', '吸血鬼', '恶魔', '美人鱼', '美人鱼杂项', '兽人'] },
                { id: 'body', name: '身材体型', keywords: ['身材', '体型', '胸部', '乳房', '巨乳', '贫乳', '爆乳', '微乳', '大乳头', '陷没乳头', '腹肌', '肉感', '大腿', '长腿', '身高', '肤色', '黑皮', '白皙', '肌肉', '美腿', '锁骨', '私处', '私处特征', '臀部', '伪娘', '男娘', '人妖', '年龄触发', '流浪汉', '熟女体形', '腋下', '背部', '胃凸', '雌臭组件', '孕期'] },
                { id: 'transformation', name: '人物转化/异化', keywords: ['人物转化', '转化', '石像', '石化', '水晶异变', '丧尸化', '变异', '拟兽', '机甲化', '机娘化', '龙人化', '隐身人', '透明躯体', '灵体', '物化', '异化', '魔物化', '微细节'] }
            ]
        },
        scene: {
            id: 'scene',
            name: '场景环境',
            icon: 'fa-solid fa-mountain-sun',
            color: '#f1fa8c',
            subcategories: [
                { id: 'indoor', name: '室内场所', keywords: ['室内', '房间', '卧室', '床', '教室', '学校', '浴室', '温泉', '泡泡浴', '厨房', '客厅', '办公室', '图书馆', '咖啡厅', '酒吧', '情趣酒店', '酒店', '地牢', '走廊', '阳台', '车内', '电梯', '楼梯间', '试衣间', '电影院', '餐厅', '居酒屋', '教堂', '神社', '寺庙', '实验室', '窗边', '玻璃柜', '培养仓', '赌场', '法老棺材', '公共场所', '背景', '画室', '监狱', '场地钢琴', '门外'] },
                { id: 'outdoor', name: '室外自然', keywords: ['室外', '户外', '海滩', '海边', '海', '森林', '树林', '公园', '街道', '城市', '小巷', '屋顶', '天台', '草地', '花园', '夜景', '星空', '夕阳', '黄昏', '自然景观', '交通工具', '场地大街', '出门杂项'] },
                { id: 'fantasy', name: '奇幻科幻', keywords: ['奇幻', '科幻', '废墟', '城堡', '宫殿', '神殿', '太空', '宇宙', '飞船', '魔法阵', '赛博朋克', '异世界', '末世', '封印', '贞子从电视中爬出'] }
            ]
        },
        camera: {
            id: 'camera',
            name: '镜头光影',
            icon: 'fa-solid fa-camera',
            color: '#bd93f9',
            subcategories: [
                { id: 'camera_angle', name: '镜头视角', keywords: ['视角', '机位', '构图', '特写', '面部特写', '半身', '全身', '俯视', '仰视', 'POV', '第一人称', '侧面', '背影', '荷兰角', '鱼眼', '广角', '对焦', '速查表-镜子', '速查表-窗户', '速查表-门缝偷窥', '速查表-车后视镜', '速查表-猫眼', '速查表-前置自拍', '速查表-自拍', '速查表-望远镜', '速查表-透视眼镜', '检查', '测量', '口腔检查'] },
                { id: 'lighting', name: '光影氛围', keywords: ['光影', '光照', '逆光', '丁达尔', '体积光', '发光', '荧光', '霓虹', '暗色调', '明亮', '柔光', '电影感', '镜头光晕', '氛围', '滤镜', '速查表-水中倒影', '动态效果', '暗示性'] },
                { id: 'style', name: '艺术画风', keywords: ['画风', '风格', '复古', '90年代', '厚涂', '水彩', '像素', '线稿', '黑白', '赛璐珞', '油画', '插画', '速查表', '速查表-透明底', '速查表-立绘', '速查表-照片', '速查表-直播', '速查表-杂志', '速查表-封面', '速查表-电视', '速查表-录像', '速查表-明信片', '速查表-AV', '文字渲染', '设定', '照片'] }
            ]
        }
    };

    function extractNativeTopic(comment) {
        if (!comment) return '综合';
        let c = comment.trim();
        c = c.replace(/^[\*#\s]+/, '');
        c = c.replace(/[-_—－\s]*(new|常规|新版|横图|竖图|自用|测试)$/i, '');

        const bracketMatch = c.match(/^[【\[（\(]([^】\]）\)]+)[】\]）\)]/);
        if (bracketMatch) return bracketMatch[1].trim();

        const parts = c.split(/[-_—－\:\：\/]/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) return parts[0];

        const KNOWN_TOPICS = [
            '另类日常', '宠物调教', '截肢/人棍', '截肢', '人棍', '兽奸', '狗奸', '马交', '蛇奸', '虫奸',
            '自慰', '口交', '手交', '腿交', '足交', '乳交', '揉胸', '抓乳', '舔穴', '催眠', '洗脑',
            '猥亵', '强奸', '迷奸', '后入位', '女上位', '骑乘位', '侧入位', '火车便当', '坐姿体位', '肛交',
            '多p/轮奸', '多P', '轮奸', '群交', '百合', '孕肚', '分娩', '饮精', '颜射', '精液', '事后',
            '拘束放置', '肉便器', '木马', '驷马缚', '性玩具', 'BDSM道具', 'BDSM', '触手', '史莱姆',
            '秀色', '杀害', '刑罚', '暴力', '钢管舞', '诱惑', '比心', '健身', '瑜伽', '一字马',
            '日常服', '日常', '制服', '巫女', '女仆', '魔法少女', '泳装', '内衣', '睡衣', '吃精液', '吃热狗', '吃饭'
        ];

        for (const top of KNOWN_TOPICS) {
            if (c.startsWith(top) || c.includes(top)) return top;
        }

        return parts[0] || c.slice(0, 8);
    }

    function classifyLorebookEntry(comment, content, keys = []) {
        const c = String(comment || '').trim();
        const body = String(content || '').trim();
        const keyList = Array.isArray(keys) ? keys.map(k => String(k).trim()).filter(Boolean) : [];

        const nativeTopic = extractNativeTopic(comment);
        const titleLower = nativeTopic.toLowerCase();
        const commentLower = c.toLowerCase();

        let bestMatch = null;
        let highestScore = 0;

        for (const [mainKey, mainGroup] of Object.entries(LOREBOOK_TAXONOMY)) {
            for (const sub of mainGroup.subcategories) {
                let score = 0;

                // 1. Title prefix exact or substring match (ABSOLUTE HIGHEST PRIORITY: +250)
                if (titleLower) {
                    if (titleLower === sub.name.toLowerCase() || titleLower.includes(sub.name.toLowerCase())) {
                        score += 300;
                    }
                    for (const kw of sub.keywords) {
                        const kwL = kw.toLowerCase();
                        if (titleLower === kwL || titleLower.startsWith(kwL) || titleLower.includes(kwL)) {
                            score += 250;
                            break;
                        }
                    }
                }

                // 2. Keyword match in comment / keys (High Priority: +50)
                for (const kw of sub.keywords) {
                    const kwL = kw.toLowerCase();
                    if (commentLower.includes(kwL)) {
                        score += 50;
                    }
                    if (keyList.some(k => k.toLowerCase().includes(kwL))) {
                        score += 40;
                    }
                }

                // 3. Tag Regex match in body (Low Priority: +5)
                if (sub.tagRegex && sub.tagRegex.test(body)) {
                    score += 5;
                }

                if (score > highestScore) {
                    highestScore = score;
                    bestMatch = {
                        mainId: mainGroup.id,
                        mainName: mainGroup.name,
                        subId: sub.id,
                        subName: sub.name,
                        nativeTopic: nativeTopic,
                        icon: mainGroup.icon,
                        color: mainGroup.color,
                        badgeText: `${mainGroup.name} · ${sub.name}`
                    };
                }
            }
        }

        if (bestMatch && highestScore >= 20) {
            return bestMatch;
        }

        return {
            mainId: 'other',
            mainName: '其它/未分类',
            subId: 'other',
            subName: '综合词条',
            nativeTopic: nativeTopic,
            icon: 'fa-solid fa-cubes',
            color: '#8be9fd',
            badgeText: `分类: ${nativeTopic}`
        };
    }

    function getAllAvailableWorldbookEntries() {
        const s = RBQ.api.getSettings();
        const sdtStore = s[SDT_STORAGE_KEY];
        const cwStore = s[STORAGE_KEY];
        const sdtSources = Array.isArray(sdtStore?.lorebookSources) ? sdtStore.lorebookSources : [];
        const cwSources = Array.isArray(cwStore?.lorebookSources) ? cwStore.lorebookSources : [];
        const combinedSources = [...sdtSources, ...cwSources];
        const allEntries = [];
        const seenKeys = new Set();

        // 1. Read from Plugin Lorebook Stores
        for (const src of combinedSources) {
            if (src && src.enabled !== false && src.rawJson) {
                try {
                    const parsed = JSON.parse(src.rawJson);
                    const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
                    for (const [uidKey, e] of Object.entries(entries)) {
                        if (!e || e.disabled || !e.content) continue;
                        const keyId = `${src.name || 'WB'}:${e.uid ?? uidKey}`;
                        if (seenKeys.has(keyId)) continue;
                        seenKeys.add(keyId);

                        const keys = Array.isArray(e.key) ? e.key : (typeof e.key === 'string' ? e.key.split(',') : []);
                        const classification = classifyLorebookEntry(e.comment, e.content, keys);

                        allEntries.push({
                            sourceId: src.id || 'wb-src',
                            sourceName: src.name || '世界书',
                            uid: e.uid ?? uidKey,
                            comment: String(e.comment || ''),
                            content: String(e.content || '').trim(),
                            key: keys,
                            ...classification
                        });
                    }
                } catch (_err) { /* ignore parse error */ }
            }
        }

        // 2. Read from SillyTavern Native World Info / Character Attached Books
        try {
            const ctx = RBQ.api.getContext?.();
            const charBook = ctx?.character?.data?.character_book?.entries || ctx?.characters?.[ctx?.characterId]?.data?.character_book?.entries;
            if (Array.isArray(charBook)) {
                for (const e of charBook) {
                    if (!e || !e.content) continue;
                    const keyId = `ST_CharBook:${e.id ?? e.comment}`;
                    if (seenKeys.has(keyId)) continue;
                    seenKeys.add(keyId);
                    const keys = Array.isArray(e.keys) ? e.keys : (Array.isArray(e.key) ? e.key : []);
                    const classification = classifyLorebookEntry(e.comment, e.content, keys);
                    allEntries.push({
                        sourceId: 'st-char-book',
                        sourceName: '角色卡内置世界书',
                        uid: e.id || uid('st-cb'),
                        comment: String(e.comment || ''),
                        content: String(e.content || '').trim(),
                        key: keys,
                        ...classification
                    });
                }
            }
        } catch (_stErr) { /* ignore */ }

        return allEntries;
    }

    function extractLorebookSubVariants(content) {
        if (!content) return [];
        const normalized = content.replace(/[\ufeff\u200b\u200c\u200d]/g, '').trim();
        const lines = normalized.split(/\r?\n/);
        const variants = [];
        let currentTitle = '';
        let currentTags = [];

        function cleanLine(l) {
            return l.replace(/^[-*•]\s*/, '').replace(/^[#]+\s*/, '').trim();
        }

        for (let rawLine of lines) {
            let line = rawLine.trim();
            if (!line) continue;
            // Skip top-level banner comment
            if (/^#\.\s*[\u4e00-\u9fa5]/.test(line) && !variants.length && !currentTags.length) {
                continue;
            }

            let isHeader = false;
            let headerTitle = '';
            let inlineTags = '';

            const subHeaderMatch = line.match(/^#{2,4}\.?\s*(\d*[\.\、\s]*)?([^—\-\:\：\n]+)([\—\-\:\：]\s*(.*))?$/);
            const bracketHeaderMatch = line.match(/^[【\[（\(]([^】\]）\)]+)[】\]）\)]([\—\-\:\：]\s*(.*))?$/);
            const numHeaderMatch = line.match(/^(\d+[\.\、\s]+)([^—\-\:\：\n]+)([\—\-\:\：]\s*(.*))?$/);

            if (subHeaderMatch) {
                isHeader = true;
                headerTitle = subHeaderMatch[2].trim();
                inlineTags = (subHeaderMatch[4] || '').trim();
            } else if (bracketHeaderMatch && (line.match(/[\u4e00-\u9fa5]/g) || []).length >= 2) {
                isHeader = true;
                headerTitle = bracketHeaderMatch[1].trim();
                inlineTags = (bracketHeaderMatch[3] || '').trim();
            } else if (numHeaderMatch && (numHeaderMatch[2].match(/[\u4e00-\u9fa5]/g) || []).length >= 2) {
                isHeader = true;
                headerTitle = numHeaderMatch[2].trim();
                inlineTags = (numHeaderMatch[4] || '').trim();
            } else if (/^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]{2,14}[：:]$/.test(line)) {
                isHeader = true;
                headerTitle = line.replace(/[:：]$/, '').trim();
            }

            if (isHeader) {
                if (currentTitle && currentTags.length > 0) {
                    variants.push({ title: currentTitle, tags: currentTags.join(', ').trim() });
                }
                currentTitle = headerTitle || '变体';
                currentTags = [];
                if (inlineTags) {
                    currentTags.push(inlineTags.replace(/^[-*•—–]\s*/, ''));
                }
            } else {
                if (!currentTitle) currentTitle = '默认变体';
                currentTags.push(cleanLine(line));
            }
        }

        if (currentTitle && currentTags.length > 0) {
            variants.push({ title: currentTitle, tags: currentTags.join(', ').trim() });
        }

        return variants.length > 0 ? variants : [{ title: '默认', tags: content.trim() }];
    }

    // ── Worldbook Visual Tag Picker Modal (三级原生精准分类选词器) ───────
    function openWorldbookPickerModal(options = {}, onSelectCallback) {
        const modal = document.createElement('div');
        modal.id = 'rbq-cw-worldbook-picker-modal';
        modal.style.cssText = `
            position: fixed !important; inset: 0 !important; z-index: 100000020 !important;
            background: rgba(0,0,0,0.85) !important; display: flex !important;
            align-items: center !important; justify-content: center !important;
            padding: 16px !important; box-sizing: border-box !important;
            backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
        `;

        const allEntries = getAllAvailableWorldbookEntries();
        const sources = Array.from(new Set(allEntries.map(e => e.sourceName))).filter(Boolean);

        let initialMain = 'all';
        if (options.defaultCategory) {
            const def = options.defaultCategory;
            for (const [k, g] of Object.entries(LOREBOOK_TAXONOMY)) {
                if (k === def || g.name === def || g.name.includes(def) || def.includes(g.name)) {
                    initialMain = k;
                    break;
                }
            }
        }

        let currentSource = 'all';
        let currentMainCat = initialMain;
        let currentSubCat = 'all';
        let currentNativeTopic = 'all';
        let searchQuery = options.initialSearch || '';

        function getFilteredEntries() {
            return allEntries.filter(e => {
                if (currentSource !== 'all' && e.sourceName !== currentSource) return false;
                if (currentMainCat !== 'all' && e.mainId !== currentMainCat) return false;
                if (currentSubCat !== 'all' && e.subId !== currentSubCat) return false;
                if (currentNativeTopic !== 'all' && e.nativeTopic !== currentNativeTopic) return false;
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (e.comment && e.comment.toLowerCase().includes(q))
                    || (e.content && e.content.toLowerCase().includes(q))
                    || (e.badgeText && e.badgeText.toLowerCase().includes(q))
                    || (e.nativeTopic && e.nativeTopic.toLowerCase().includes(q))
                    || (e.sourceName && e.sourceName.toLowerCase().includes(q))
                    || (e.key && e.key.some(k => String(k).toLowerCase().includes(q)));
            });
        }

        function renderContent() {
            const filtered = getFilteredEntries();
            const activeTaxGroup = LOREBOOK_TAXONOMY[currentMainCat];

            // Compute Tier 3 native topics within current selection
            const tier3Candidates = allEntries.filter(e => {
                if (currentSource !== 'all' && e.sourceName !== currentSource) return false;
                if (currentMainCat !== 'all' && e.mainId !== currentMainCat) return false;
                if (currentSubCat !== 'all' && e.subId !== currentSubCat) return false;
                return true;
            });
            const topicCounts = { all: tier3Candidates.length };
            tier3Candidates.forEach(e => {
                const t = e.nativeTopic || '未命名';
                topicCounts[t] = (topicCounts[t] || 0) + 1;
            });
            const nativeTopicList = Object.entries(topicCounts)
                .filter(([k]) => k !== 'all')
                .sort((a, b) => b[1] - a[1]);

            return `
                <div style="background: #18191f !important; border: 1px solid rgba(121,228,255,0.3) !important; border-radius: 14px !important; width: 780px !important; max-width: 95vw !important; max-height: 90vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 20px 60px rgba(0,0,0,0.9) !important; box-sizing: border-box !important;">
                    <!-- Header -->
                    <div style="display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 12px 18px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; background: rgba(121,228,255,0.06) !important; flex-wrap: wrap !important; gap: 8px !important;">
                        <strong style="font-size: 15px !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 8px !important; white-space: nowrap !important;">
                            <i class="fa-solid fa-book-open"></i> ${options.title || '从世界书选择词条'}
                            <span style="font-size: 12px !important; color: rgba(255,255,255,0.6) !important; font-weight: normal !important;">(共 ${filtered.length}/${allEntries.length} 条)</span>
                        </strong>
                        <div style="display: flex !important; align-items: center !important; gap: 8px !important; flex-wrap: wrap !important;">
                            <select id="rbq-cw-wb-source-select" style="height: 28px !important; font-size: 11px !important; background: rgba(0,0,0,0.5) !important; border: 1px solid rgba(121,228,255,0.3) !important; border-radius: 6px !important; color: #79e4ff !important; padding: 2px 8px !important; max-width: 160px !important;">
                                <option value="all">📚 全部世界书 (${allEntries.length})</option>
                                ${sources.map(s => `<option value="${escapeHtml(s)}" ${currentSource === s ? 'selected' : ''}>📖 ${escapeHtml(s)}</option>`).join('')}
                            </select>
                            <label class="cw-wb-btn green" style="cursor: pointer !important;">
                                <i class="fa-solid fa-file-arrow-up"></i> 导入世界书
                                <input type="file" id="rbq-cw-wb-file-input" accept=".json" style="display: none !important;" />
                            </label>
                            <button class="cw-wb-btn close" id="rbq-cw-wb-close">✕</button>
                        </div>
                    </div>

                    <!-- Search & Level 1 Categories -->
                    <div style="padding: 10px 16px !important; border-bottom: 1px solid rgba(255,255,255,0.06) !important; display: flex !important; flex-direction: column !important; gap: 8px !important; background: rgba(0,0,0,0.25) !important;">
                        <!-- Search Bar -->
                        <div style="display: flex !important; gap: 8px !important;">
                            <input id="rbq-cw-wb-search" type="text" placeholder="🔍 搜索世界书词条 / 中英文 Tag / 触发词 / 分类..." value="${escapeHtml(searchQuery)}" style="flex: 1 !important; height: 32px !important; padding: 4px 12px !important; font-size: 12px !important; background: rgba(0,0,0,0.4) !important; border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 6px !important; color: #fff !important;" />
                        </div>

                        <!-- Level 1 Main Tabs -->
                        <div style="display: flex !important; gap: 5px !important; overflow-x: auto !important; padding-bottom: 2px !important;">
                            <button class="cw-wb-main-cat ${currentMainCat === 'all' ? 'active' : ''}" data-main="all" style="padding: 4px 10px !important; font-size: 11px !important; white-space: nowrap !important; border-radius: 6px !important; cursor: pointer !important; border: 1px solid ${currentMainCat === 'all' ? '#79e4ff' : 'rgba(255,255,255,0.1)'} !important; background: ${currentMainCat === 'all' ? 'rgba(121,228,255,0.25)' : 'rgba(255,255,255,0.04)'} !important; color: ${currentMainCat === 'all' ? '#79e4ff' : 'rgba(255,255,255,0.8)'} !important; font-weight: ${currentMainCat === 'all' ? 'bold' : 'normal'} !important;">
                                全部 (${allEntries.length})
                            </button>
                            ${Object.values(LOREBOOK_TAXONOMY).map(grp => {
                                const count = allEntries.filter(e => e.mainId === grp.id).length;
                                if (count === 0) return '';
                                const isActive = currentMainCat === grp.id;
                                return `
                                    <button class="cw-wb-main-cat ${isActive ? 'active' : ''}" data-main="${grp.id}" style="padding: 4px 10px !important; font-size: 11px !important; white-space: nowrap !important; border-radius: 6px !important; cursor: pointer !important; border: 1px solid ${isActive ? grp.color : 'rgba(255,255,255,0.1)'} !important; background: ${isActive ? `${grp.color}33` : 'rgba(255,255,255,0.04)'} !important; color: ${isActive ? grp.color : 'rgba(255,255,255,0.8)'} !important; font-weight: ${isActive ? 'bold' : 'normal'} !important;">
                                        <i class="${grp.icon}"></i> ${escapeHtml(grp.name)} (${count})
                                    </button>
                                `;
                            }).join('')}
                            ${allEntries.some(e => e.mainId === 'other') ? `
                                <button class="cw-wb-main-cat ${currentMainCat === 'other' ? 'active' : ''}" data-main="other" style="padding: 4px 10px !important; font-size: 11px !important; white-space: nowrap !important; border-radius: 6px !important; cursor: pointer !important; border: 1px solid ${currentMainCat === 'other' ? '#8be9fd' : 'rgba(255,255,255,0.1)'} !important; background: ${currentMainCat === 'other' ? 'rgba(139,233,253,0.25)' : 'rgba(255,255,255,0.04)'} !important; color: ${currentMainCat === 'other' ? '#8be9fd' : 'rgba(255,255,255,0.8)'} !important;">
                                    <i class="fa-solid fa-cubes"></i> 其它 (${allEntries.filter(e => e.mainId === 'other').length})
                                </button>
                            ` : ''}
                        </div>

                        <!-- Level 2 Sub-categories (Chips) -->
                        ${activeTaxGroup ? `
                            <div style="display: flex !important; gap: 4px !important; overflow-x: auto !important; padding: 4px 6px !important; background: rgba(0,0,0,0.3) !important; border-radius: 6px !important;">
                                <button class="cw-wb-sub-cat ${currentSubCat === 'all' ? 'active' : ''}" data-sub="all" style="padding: 2px 8px !important; font-size: 10.5px !important; white-space: nowrap !important; border-radius: 4px !important; cursor: pointer !important; border: 1px solid transparent !important; background: ${currentSubCat === 'all' ? 'rgba(255,255,255,0.2)' : 'transparent'} !important; color: ${currentSubCat === 'all' ? '#fff' : 'rgba(255,255,255,0.65)'} !important; font-weight: ${currentSubCat === 'all' ? 'bold' : 'normal'} !important;">
                                    全部${activeTaxGroup.name}
                                </button>
                                ${activeTaxGroup.subcategories.map(sub => {
                                    const subCount = allEntries.filter(e => e.mainId === activeTaxGroup.id && e.subId === sub.id).length;
                                    if (subCount === 0) return '';
                                    const isSubActive = currentSubCat === sub.id;
                                    return `
                                        <button class="cw-wb-sub-cat ${isSubActive ? 'active' : ''}" data-sub="${sub.id}" style="padding: 2px 8px !important; font-size: 10.5px !important; white-space: nowrap !important; border-radius: 4px !important; cursor: pointer !important; border: 1px solid ${isSubActive ? activeTaxGroup.color : 'transparent'} !important; background: ${isSubActive ? `${activeTaxGroup.color}26` : 'transparent'} !important; color: ${isSubActive ? activeTaxGroup.color : 'rgba(255,255,255,0.7)'} !important; font-weight: ${isSubActive ? 'bold' : 'normal'} !important;">
                                            ${escapeHtml(sub.name)} (${subCount})
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}

                        <!-- Level 3 Native Topic Chips (三级原生主题前缀) -->
                        ${nativeTopicList.length > 1 ? `
                            <div style="display: flex !important; gap: 4px !important; overflow-x: auto !important; padding: 2px 4px !important; align-items: center !important;">
                                <span style="font-size: 10px !important; color: rgba(255,184,108,0.7) !important; margin-right: 2px !important;"><i class="fa-solid fa-tags"></i> 主题:</span>
                                <button class="cw-wb-topic-chip ${currentNativeTopic === 'all' ? 'active' : ''}" data-topic="all" style="padding: 1px 6px !important; font-size: 10px !important; border-radius: 8px !important; cursor: pointer !important; white-space: nowrap !important; ${currentNativeTopic === 'all' ? 'background: rgba(255,184,108,0.3) !important; color: #ffb86c !important; border: 1px solid #ffb86c !important; font-weight: bold !important;' : 'background: rgba(255,255,255,0.04) !important; color: rgba(255,255,255,0.5) !important; border: 1px solid rgba(255,255,255,0.08) !important;'}">全部 (${topicCounts.all})</button>
                                ${nativeTopicList.slice(0, 20).map(([topicName, count]) => {
                                    const isTopAct = currentNativeTopic === topicName;
                                    return `
                                        <button class="cw-wb-topic-chip ${isTopAct ? 'active' : ''}" data-topic="${escapeHtml(topicName)}" style="padding: 1px 6px !important; font-size: 10px !important; border-radius: 8px !important; cursor: pointer !important; white-space: nowrap !important; ${isTopAct ? 'background: rgba(255,184,108,0.25) !important; color: #ffb86c !important; border: 1px solid #ffb86c !important; font-weight: bold !important;' : 'background: rgba(255,255,255,0.04) !important; color: rgba(255,255,255,0.6) !important; border: 1px solid rgba(255,255,255,0.08) !important;'}">${escapeHtml(topicName)} (${count})</button>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <!-- Entries List -->
                    <div id="rbq-cw-wb-list" style="padding: 12px 16px !important; overflow-y: auto !important; flex: 1 !important; display: flex !important; flex-direction: column !important; gap: 8px !important;">
                        ${filtered.length === 0 ? `
                            <div style="text-align: center !important; opacity: 0.5 !important; padding: 40px 0 !important; font-size: 13px !important;">
                                <i class="fa-solid fa-filter-circle-xmark" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
                                当前分类下暂未找到匹配的世界书词条
                            </div>
                        ` : filtered.slice(0, 120).map((e, idx) => {
                            const subVariants = extractLorebookSubVariants(e.content);
                            const hasMultiple = subVariants.length > 1;
                            const badgeColor = e.color || '#79e4ff';
                            const nativeTopic = e.nativeTopic || '';
                            return `
                                <div style="background: rgba(255,255,255,0.025) !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 8px !important; padding: 10px 12px !important; display: flex !important; flex-direction: column !important; gap: 6px !important; transition: border-color 0.15s !important;">
                                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 8px !important; flex-wrap: wrap !important;">
                                        <div style="display: flex !important; align-items: center !important; gap: 6px !important; flex-wrap: wrap !important; flex: 1 !important; min-width: 0 !important;">
                                            <strong style="font-size: 13px !important; color: #fff !important; word-break: break-all !important;">📌 ${escapeHtml(e.comment || '未命名词条')}</strong>
                                            <span style="font-size: 10px !important; background: ${badgeColor}22 !important; color: ${badgeColor} !important; border: 1px solid ${badgeColor}44 !important; padding: 1px 6px !important; border-radius: 4px !important; font-weight: bold !important; white-space: nowrap !important;">🏷️ ${escapeHtml(e.badgeText || e.mainName)}</span>
                                            ${nativeTopic ? `<span style="font-size: 10px !important; background: rgba(255,184,108,0.12) !important; color: #ffb86c !important; border: 1px solid rgba(255,184,108,0.25) !important; padding: 1px 4px !important; border-radius: 4px !important;">🏷️ ${escapeHtml(nativeTopic)}</span>` : ''}
                                            <span style="font-size: 10px !important; background: rgba(255,255,255,0.06) !important; color: rgba(255,255,255,0.65) !important; padding: 1px 5px !important; border-radius: 4px !important; white-space: nowrap !important;">📖 ${escapeHtml(e.sourceName)}</span>
                                            ${hasMultiple ? `<span style="font-size: 10px !important; background: rgba(255,184,108,0.18) !important; color: #ffb86c !important; padding: 1px 5px !important; border-radius: 4px !important; font-weight: bold !important; white-space: nowrap !important;">🔥 ${subVariants.length} 种变体</span>` : ''}
                                        </div>
                                        <div style="display: flex !important; gap: 6px !important; align-items: center !important; flex-shrink: 0 !important;">
                                            ${hasMultiple ? `
                                                <button class="cw-wb-btn orange rbq-cw-pick-multi-btn" data-index="${idx}" type="button"><i class="fa-solid fa-list-check"></i> 挑选子变体</button>
                                            ` : `
                                                <button class="cw-wb-btn green rbq-cw-pick-single-btn" data-index="${idx}" type="button"><i class="fa-solid fa-check"></i> 选用</button>
                                            `}
                                        </div>
                                    </div>
                                    <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-family: monospace !important; max-height: 52px !important; overflow-y: auto !important; word-break: break-all !important; background: rgba(0,0,0,0.3) !important; padding: 4px 8px !important; border-radius: 4px !important; border: 1px solid rgba(255,255,255,0.04) !important;">${escapeHtml(e.content)}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        function updateList() {
            modal.innerHTML = renderContent();
            bindEvents();
        }

        function bindEvents() {
            modal.querySelector('#rbq-cw-wb-close')?.addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

            const sourceSelect = modal.querySelector('#rbq-cw-wb-source-select');
            if (sourceSelect) {
                sourceSelect.addEventListener('change', (e) => {
                    currentSource = e.target.value;
                    currentMainCat = 'all';
                    currentSubCat = 'all';
                    currentNativeTopic = 'all';
                    updateList();
                });
            }

            const fileInput = modal.querySelector('#rbq-cw-wb-file-input');
            if (fileInput) {
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        try {
                            const raw = JSON.parse(evt.target.result);
                            const name = file.name.replace(/\.json$/i, '');
                            const s = RBQ.api.getSettings();
                            if (!s[STORAGE_KEY]) s[STORAGE_KEY] = {};
                            if (!Array.isArray(s[STORAGE_KEY].lorebookSources)) s[STORAGE_KEY].lorebookSources = [];
                            s[STORAGE_KEY].lorebookSources.push({
                                id: uid('wb'),
                                name: name,
                                enabled: true,
                                rawJson: JSON.stringify(raw),
                                importedAt: Date.now()
                            });
                            save();
                            toastr.success(`世界书「${name}」导入成功！`, PLUGIN_NAME);
                            modal.remove();
                            openWorldbookPickerModal(options, onSelectCallback);
                        } catch (err) {
                            toastr.error(`世界书解析失败: ${err.message || err}`, PLUGIN_NAME);
                        }
                    };
                    reader.readAsText(file);
                });
            }

            const searchInput = modal.querySelector('#rbq-cw-wb-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    searchQuery = e.target.value;
                    const list = modal.querySelector('#rbq-cw-wb-list');
                    if (list) {
                        const filtered = getFilteredEntries();
                        list.innerHTML = filtered.length === 0 ? `
                            <div style="text-align: center !important; opacity: 0.5 !important; padding: 40px 0 !important; font-size: 13px !important;">
                                <i class="fa-solid fa-filter-circle-xmark" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
                                未找到匹配的世界书词条
                            </div>
                        ` : filtered.slice(0, 120).map((e, idx) => {
                            const subVariants = extractLorebookSubVariants(e.content);
                            const hasMultiple = subVariants.length > 1;
                            const badgeColor = e.color || '#79e4ff';
                            return `
                                <div style="background: rgba(255,255,255,0.025) !important; border: 1px solid rgba(255,255,255,0.06) !important; border-radius: 8px !important; padding: 10px 12px !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 8px !important; flex-wrap: wrap !important;">
                                        <div style="display: flex !important; align-items: center !important; gap: 6px !important; flex-wrap: wrap !important; flex: 1 !important; min-width: 0 !important;">
                                            <strong style="font-size: 13px !important; color: #fff !important; word-break: break-all !important;">📌 ${escapeHtml(e.comment || '未命名词条')}</strong>
                                            <span style="font-size: 10px !important; background: ${badgeColor}22 !important; color: ${badgeColor} !important; border: 1px solid ${badgeColor}44 !important; padding: 1px 6px !important; border-radius: 4px !important; font-weight: bold !important; white-space: nowrap !important;">🏷️ ${escapeHtml(e.badgeText || e.mainName)}</span>
                                            <span style="font-size: 10px !important; background: rgba(255,255,255,0.06) !important; color: rgba(255,255,255,0.65) !important; padding: 1px 5px !important; border-radius: 4px !important; white-space: nowrap !important;">📖 ${escapeHtml(e.sourceName)}</span>
                                            ${hasMultiple ? `<span style="font-size: 10px !important; background: rgba(255,184,108,0.18) !important; color: #ffb86c !important; padding: 1px 5px !important; border-radius: 4px !important; font-weight: bold !important; white-space: nowrap !important;">🔥 ${subVariants.length} 种变体</span>` : ''}
                                        </div>
                                        <div style="display: flex !important; gap: 6px !important; align-items: center !important; flex-shrink: 0 !important;">
                                            ${hasMultiple ? `
                                                <button class="cw-wb-btn orange rbq-cw-pick-multi-btn" data-index="${idx}" type="button"><i class="fa-solid fa-list-check"></i> 挑选子变体</button>
                                            ` : `
                                                <button class="cw-wb-btn green rbq-cw-pick-single-btn" data-index="${idx}" type="button"><i class="fa-solid fa-check"></i> 选用</button>
                                            `}
                                        </div>
                                    </div>
                                    <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-family: monospace !important; max-height: 52px !important; overflow-y: auto !important; word-break: break-all !important; background: rgba(0,0,0,0.3) !important; padding: 4px 8px !important; border-radius: 4px !important; border: 1px solid rgba(255,255,255,0.04) !important;">${escapeHtml(e.content)}</div>
                                </div>
                            `;
                        }).join('');
                        bindActionButtons(filtered);
                    }
                });
            }

            modal.querySelectorAll('.cw-wb-main-cat').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentMainCat = btn.dataset.main;
                    currentSubCat = 'all';
                    currentNativeTopic = 'all';
                    updateList();
                });
            });

            modal.querySelectorAll('.cw-wb-sub-cat').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentSubCat = btn.dataset.sub;
                    currentNativeTopic = 'all';
                    updateList();
                });
            });

            modal.querySelectorAll('.cw-wb-topic-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentNativeTopic = btn.dataset.topic;
                    updateList();
                });
            });

            const currentFiltered = getFilteredEntries();
            bindActionButtons(currentFiltered);
        }

        function bindActionButtons(filteredList) {
            modal.querySelectorAll('.rbq-cw-pick-single-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const item = filteredList[idx];
                    if (item && typeof onSelectCallback === 'function') {
                        onSelectCallback({
                            title: item.comment,
                            tags: item.content.replace(/^[#\-\*\s]+[^:\n]+[:：]\s*/gm, '').replace(/\s*\/\s*/g, ', ').trim(),
                            raw: item
                        });
                        modal.remove();
                    }
                });
            });

            modal.querySelectorAll('.rbq-cw-pick-multi-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const item = filteredList[idx];
                    if (!item) return;
                    const subVariants = extractLorebookSubVariants(item.content);
                    openSubVariantSelectDialog(item.comment, subVariants, (selectedV) => {
                        if (typeof onSelectCallback === 'function') {
                            onSelectCallback({
                                title: `${item.comment} (${selectedV.title})`,
                                tags: selectedV.tags.replace(/\s*\/\s*/g, ', ').trim(),
                                raw: item
                            });
                            modal.remove();
                        }
                    });
                });
            });
        }

        function openSubVariantSelectDialog(entryTitle, variants, onSelect) {
            const subModal = document.createElement('div');
            subModal.style.cssText = `
                position: fixed !important; inset: 0 !important; z-index: 100000030 !important;
                background: rgba(0,0,0,0.85) !important; display: flex !important;
                align-items: center !important; justify-content: center !important; padding: 16px !important;
            `;
            subModal.innerHTML = `
                <div style="background: #202128 !important; border: 1px solid rgba(255,184,108,0.4) !important; border-radius: 12px !important; width: 560px !important; max-width: 95vw !important; max-height: 80vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 15px 50px rgba(0,0,0,0.9) !important;">
                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 12px 16px !important; background: rgba(255,184,108,0.08) !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important;">
                        <strong style="color: #ffb86c !important; font-size: 14px !important; white-space: nowrap !important;">📌 挑选子变体 — ${escapeHtml(entryTitle)}</strong>
                        <button class="cw-wb-btn close" id="rbq-cw-subv-close">✕</button>
                    </div>
                    <div style="padding: 14px 16px !important; overflow-y: auto !important; display: flex !important; flex-direction: column !important; gap: 8px !important;">
                        ${variants.map((v, vIdx) => `
                            <div style="background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 8px !important; padding: 10px !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                                <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 8px !important;">
                                    <strong style="color: #fff !important; font-size: 13px !important; flex: 1 !important;">#${vIdx + 1} ${escapeHtml(v.title)}</strong>
                                    <button class="cw-wb-btn green rbq-cw-pick-v-btn" data-vidx="${vIdx}" type="button">选用此变体</button>
                                </div>
                                <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-family: monospace !important; background: rgba(0,0,0,0.3) !important; padding: 4px 8px !important; border-radius: 4px !important; word-break: break-all !important;">${escapeHtml(v.tags)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            subModal.querySelector('#rbq-cw-subv-close')?.addEventListener('click', () => subModal.remove());
            subModal.addEventListener('click', (e) => { if (e.target === subModal) subModal.remove(); });
            subModal.querySelectorAll('.rbq-cw-pick-v-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const vIdx = Number(btn.dataset.vidx);
                    const chosen = variants[vIdx];
                    if (chosen && typeof onSelect === 'function') {
                        onSelect(chosen);
                        subModal.remove();
                    }
                });
            });
            document.body.appendChild(subModal);
        }

        modal.innerHTML = renderContent();
        bindEvents();
        document.body.appendChild(modal);
    }

    // ── Pre-defined Danbooru Trait Presets (全量外貌特征体系化点选词库) ────
    const BASE_TRAIT_PRESETS = [
        {
            group: '🌏 族裔与面相定位 (防欧美写实)',
            tags: [
                { name: '日系美少女 (japanese)', tag: 'japanese' },
                { name: '精致小脸 (delicate face)', tag: 'delicate face' },
                { name: '甜美萌脸 (cute face)', tag: 'cute face' },
                { name: '傲娇猫眼/吊眼 (tsurime)', tag: 'tsurime' },
                { name: '无辜垂眼 (tareme)', tag: 'tareme' },
                { name: '东亚少女 (east asian)', tag: 'east asian' },
                { name: '中式古典美 (chinese)', tag: 'chinese' },
                { name: '韩系精致 (korean)', tag: 'korean' },
                { name: '欧美白人 (caucasian)', tag: 'caucasian' },
                { name: '混血儿 (half-japanese)', tag: 'half-japanese' },
                { name: '柔和五官 (soft facial features)', tag: 'soft facial features' },
                { name: '二次元动漫脸 (anime face)', tag: 'anime face' }
            ]
        },
        {
            group: '🌟 基础/体态',
            tags: [
                { name: '单人女性 (1girl)', tag: '1girl' },
                { name: '单人男性 (1boy)', tag: '1boy' },
                { name: '单人 (solo)', tag: 'solo' },
                { name: '美少女 (bishoujo)', tag: 'bishoujo' },
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
                { name: '白金发', tag: 'platinum blonde hair' },
                { name: '粉发', tag: 'pink hair' },
                { name: '蓝发', tag: 'blue hair' },
                { name: '浅蓝发', tag: 'light blue hair' },
                { name: '深蓝发', tag: 'dark blue hair' },
                { name: '紫发', tag: 'purple hair' },
                { name: '棕发/茶发', tag: 'brown hair' },
                { name: '红发', tag: 'red hair' },
                { name: '绿发', tag: 'green hair' },
                { name: '灰发', tag: 'grey hair' },
                { name: '橙发', tag: 'orange hair' }
            ]
        },
        {
            group: '🎨 特殊发色',
            tags: [
                { name: '双色发', tag: 'two-tone hair' },
                { name: '渐变发', tag: 'gradient hair' },
                { name: '挑染发', tag: 'streaked hair' },
                { name: '多彩发', tag: 'multicolored hair' },
                { name: '左右分色发', tag: 'split-color hair' },
                { name: '内层挑染', tag: 'inner color hair' },
                { name: '发尾渐变', tag: 'colored inner hair' }
            ]
        },
        {
            group: '✂️ 头发长度',
            tags: [
                { name: '超长发 (及膝/及踝)', tag: 'very long hair' },
                { name: '及地长发', tag: 'absurdly long hair' },
                { name: '长发', tag: 'long hair' },
                { name: '中长发/及肩', tag: 'medium hair' },
                { name: '短发', tag: 'short hair' },
                { name: '超短发', tag: 'very short hair' }
            ]
        },
        {
            group: '💇 经典发型',
            tags: [
                { name: '双马尾', tag: 'twintails' },
                { name: '高双马尾', tag: 'high twintails' },
                { name: '低双马尾', tag: 'low twintails' },
                { name: '短双马尾', tag: 'short twintails' },
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
                { name: '侧编单辫', tag: 'single side braid' },
                { name: '法式盘发辫', tag: 'french braid' },
                { name: '环形王冠发辫', tag: 'crown braid' },
                { name: '单丸子头', tag: 'hair bun' },
                { name: '双丸子头/包子头', tag: 'double bun' },
                { name: '波浪大卷发', tag: 'wavy hair' },
                { name: '小卷发', tag: 'curly hair' },
                { name: '钻头卷/螺旋卷', tag: 'drill hair' },
                { name: '蓬松微乱发', tag: 'messy hair' },
                { name: '精灵超短发', tag: 'pixie cut' },
                { name: '不对称发型', tag: 'asymmetrical hair' }
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
                { name: '交叉刘海', tag: 'crossed bangs' },
                { name: '遮眉碎发', tag: 'hair between eyes' },
                { name: '单眼遮发', tag: 'hair over one eye' },
                { name: '双眼遮发 (看不见眼)', tag: 'hair over eyes' },
                { name: '鬓角长发', tag: 'sidelocks' },
                { name: '单侧撩发/露耳', tag: 'hair behind ear' },
                { name: '露额头', tag: 'forehead' },
                { name: '发梢微翘', tag: 'flipped hair' }
            ]
        },
        {
            group: '👁️ 瞳孔色彩',
            tags: [
                { name: '红瞳', tag: 'red eyes' },
                { name: '蓝瞳', tag: 'blue eyes' },
                { name: '水蓝瞳', tag: 'aqua eyes' },
                { name: '深蓝瞳', tag: 'dark blue eyes' },
                { name: '金瞳/琥珀瞳', tag: 'golden eyes' },
                { name: '黄瞳', tag: 'yellow eyes' },
                { name: '绿瞳/碧眼', tag: 'green eyes' },
                { name: '紫瞳', tag: 'purple eyes' },
                { name: '粉瞳', tag: 'pink eyes' },
                { name: '棕瞳/褐瞳', tag: 'brown eyes' },
                { name: '黑瞳', tag: 'black eyes' },
                { name: '银瞳/灰瞳', tag: 'silver eyes' },
                { name: '橙瞳', tag: 'orange eyes' },
                { name: '白瞳/无色瞳', tag: 'white eyes' }
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
                { name: '渐变色双瞳', tag: 'gradient eyes' },
                { name: '空洞无光瞳/失神瞳', tag: 'empty eyes' },
                { name: '死鱼眼/鄙视无高光', tag: 'jitome' },
                { name: '圈圈眼/眩晕眼', tag: 'swirl eyes' },
                { name: '钱形眼 ($$眼)', tag: 'dollar sign eyes' },
                { name: '收缩惊恐瞳', tag: 'constricted pupils' },
                { name: '同心圆瞳', tag: 'ringed eyes' }
            ]
        },
        {
            group: '👁️ 眼形与眼周特征',
            tags: [
                { name: '吊眼梢/猫眼 (tsurime)', tag: 'tsurime' },
                { name: '下垂眼/无辜眼 (tareme)', tag: 'tareme' },
                { name: '三白眼', tag: 'sanpaku' },
                { name: '斜视/侧目偷看', tag: 'sidelong glance' },
                { name: '泪眼汪汪', tag: 'watery eyes' },
                { name: '闪烁大眼', tag: 'sparkling eyes' },
                { name: '泪痣 (眼下小痣)', tag: 'mole under eye' },
                { name: '左眼泪痣', tag: 'mole under left eye' },
                { name: '右眼泪痣', tag: 'mole under right eye' },
                { name: '浓密长睫毛', tag: 'long eyelashes' },
                { name: '彩色睫毛', tag: 'colored eyelashes' },
                { name: '眼影', tag: 'eyeshadow' },
                { name: '眼线', tag: 'eyeliner' },
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
                { name: '灿烂阳光笑容', tag: 'beaming smile' },
                { name: '捂嘴轻笑', tag: 'covering mouth, smile' },
                { name: '得意自信笑 (smug)', tag: 'smug' },
                { name: '调皮wink', tag: 'wink' },
                { name: '坏笑/邪魅笑', tag: 'evil smile' },
                { name: '戏谑轻笑', tag: 'chuckle' }
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
                { name: '慌张不知所措', tag: 'flustered' },
                { name: '气鼓鼓/嘟嘴 (pout)', tag: 'pout' },
                { name: '鼓起单腮', tag: 'puffed cheeks' },
                { name: '别过脸去/移开视线', tag: 'looking away, blush' }
            ]
        },
        {
            group: '😠 情绪/特殊表情',
            tags: [
                { name: '三无/无表情', tag: 'expressionless' },
                { name: '发呆出神', tag: 'dazed' },
                { name: '困倦想睡', tag: 'sleepy' },
                { name: '微皱眉头', tag: 'frown' },
                { name: '生气愤怒', tag: 'angry' },
                { name: '不耐烦/嫌恶', tag: 'disdain' },
                { name: '眼含泪水', tag: 'tears' },
                { name: '伤心哭泣', tag: 'crying' },
                { name: '震惊呆住', tag: 'shocked' },
                { name: '害怕恐惧', tag: 'scared' },
                { name: '病娇狂气 (yandere)', tag: 'yandere' },
                { name: '病娇狂笑', tag: 'crazy smile' },
                { name: '流鼻血 (nosebleed)', tag: 'nosebleed' },
                { name: '流口水 (drooling)', tag: 'drooling' },
                { name: '阿黑颜/高潮失神', tag: 'ahegao' },
                { name: '微醺醉酒', tag: 'drunk' }
            ]
        },
        {
            group: '👄 唇齿口部特征',
            tags: [
                { name: '可爱小虎牙/尖牙', tag: 'fangs' },
                { name: '双虎牙', tag: 'double fangs' },
                { name: '吐舌露虎牙', tag: 'tongue out, fangs' },
                { name: '鲨鱼齿', tag: 'shark teeth' },
                { name: '微张小嘴', tag: 'open mouth' },
                { name: '轻启双唇', tag: 'parted lips' },
                { name: '吐舌 (tongue)', tag: 'tongue' },
                { name: '顽皮伸舌头', tag: 'tongue out' },
                { name: '猫咪嘴/波浪嘴 (:3)', tag: ':3' },
                { name: '咬嘴唇', tag: 'biting lip' },
                { name: '咬手套/咬手绢', tag: 'biting glove' },
                { name: '水润光泽唇彩', tag: 'lip gloss' }
            ]
        },
        {
            group: '🐾 种族/兽耳与兽尾',
            tags: [
                { name: '猫耳', tag: 'cat ears' },
                { name: '猫尾巴', tag: 'cat tail' },
                { name: '狐狸耳', tag: 'fox ears' },
                { name: '狐狸大尾巴', tag: 'fox tail' },
                { name: '九尾/多条狐尾', tag: 'multiple tails' },
                { name: '兔耳 (竖立)', tag: 'rabbit ears' },
                { name: '垂耳兔耳', tag: 'floppy rabbit ears' },
                { name: '兔球小尾巴', tag: 'rabbit tail' },
                { name: '狼耳', tag: 'wolf ears' },
                { name: '狼尾巴', tag: 'wolf tail' },
                { name: '狗耳', tag: 'dog ears' },
                { name: '熊耳', tag: 'bear ears' },
                { name: '牛耳+牛角', tag: 'cow ears, cow horns' },
                { name: '人鱼鳍耳 (fin ears)', tag: 'fin ears' },
                { name: '毛茸茸兽耳 (通用)', tag: 'animal ears, fluffy ears' },
                { name: '毛茸茸蓬松大尾巴', tag: 'fluffy tail' }
            ]
        },
        {
            group: '🧝 幻想/神魔与异形',
            tags: [
                { name: '精灵尖耳', tag: 'pointy ears' },
                { name: '长精灵耳', tag: 'long pointy ears' },
                { name: '恶魔角', tag: 'demon horns' },
                { name: '鬼角 (oni horns)', tag: 'oni horns' },
                { name: '龙角', tag: 'dragon horns' },
                { name: '羊角/卷曲角', tag: 'sheep horns' },
                { name: '天使光环 (halo)', tag: 'halo' },
                { name: '天使白色羽翼', tag: 'angel wings' },
                { name: '恶魔黑色蝠翼', tag: 'demon wings' },
                { name: '堕天使黑羽翼', tag: 'black wings' },
                { name: '透明精灵蝶翼', tag: 'fairy wings' },
                { name: '巨龙翅膀', tag: 'dragon wings' },
                { name: '恶魔尾/心形尖尾', tag: 'demon tail' },
                { name: '龙尾巴', tag: 'dragon tail' },
                { name: '魅魔特征', tag: 'succubus' },
                { name: '吸血鬼特征', tag: 'vampire' },
                { name: '脸部兽纹/魔纹', tag: 'facial markings' },
                { name: '机娘/机械体', tag: 'android' },
                { name: '球形机械关节', tag: 'mechanical joints' },
                { name: '球体关节人偶', tag: 'doll joints' },
                { name: '美人鱼/鱼尾', tag: 'mermaid, fish tail' }
            ]
        },
        {
            group: '👙 身材体态与胸围',
            tags: [
                { name: '纤细修长苗条', tag: 'slender' },
                { name: '娇小可爱身材', tag: 'petite' },
                { name: '高挑长腿身材', tag: 'tall' },
                { name: '丰满S曲线 (curvy)', tag: 'curvy' },
                { name: '沙漏型身材', tag: 'hourglass figure' },
                { name: '微胖肉感身材', tag: 'plump' },
                { name: '肉肉小肚子 (软肚)', tag: 'tummy, soft belly' },
                { name: '紧致健美/肌肉线条', tag: 'toned, muscular' },
                { name: '腹肌/马甲线 (abs)', tag: 'abs' },
                { name: '平胸/极贫乳', tag: 'flat chest' },
                { name: '微乳/小胸 (small)', tag: 'small breasts' },
                { name: '匀称中等胸部 (medium)', tag: 'medium breasts' },
                { name: '巨乳/丰满 (large)', tag: 'large breasts' },
                { name: '超大胸部/爆乳 (huge)', tag: 'huge breasts' },
                { name: '魔乳/绝顶巨大胸 (gigantic)', tag: 'gigantic breasts' }
            ]
        },
        {
            group: '🌟 身体部位与迷人细节',
            tags: [
                { name: '深邃乳沟 (cleavage)', tag: 'cleavage' },
                { name: '侧乳/侧面露胸 (sideboob)', tag: 'sideboob' },
                { name: '南半球/下乳 (underboob)', tag: 'underboob' },
                { name: '精致锁骨', tag: 'collarbone' },
                { name: '纤细小蛮腰', tag: 'thin waist' },
                { name: '脊椎线条/背沟', tag: 'spine' },
                { name: '微显肋骨', tag: 'ribs' },
                { name: '丰满宽臀/丰臀', tag: 'wide hips' },
                { name: '紧致翘臀/大屁股', tag: 'big ass' },
                { name: '肉感多肉大腿 (肉腿)', tag: 'thick thighs' },
                { name: '大腿勒肉感', tag: 'thigh strap, indented flesh' },
                { name: '大腿缝', tag: 'thigh gap' },
                { name: '修长美腿', tag: 'long legs' },
                { name: '香肩/裸露肩膀', tag: 'bare shoulders' },
                { name: '性感肚脐', tag: 'navel' },
                { name: '光滑美背', tag: 'back' },
                { name: '玉足/精致脚部', tag: 'feet' }
            ]
        },
        {
            group: '✨ 肤色与身体印记',
            tags: [
                { name: '白皙冷白皮', tag: 'pale skin' },
                { name: '自然透亮肤色', tag: 'fair skin' },
                { name: '健康小麦肤色 (tan)', tag: 'tan' },
                { name: '深色黑皮 (dark skin)', tag: 'dark skin' },
                { name: '日晒微红', tag: 'sunburn' },
                { name: '比基尼晒痕 (tanlines)', tag: 'tanlines' },
                { name: '光滑肌肤', tag: 'smooth skin' },
                { name: '香汗淋漓/微汗 (sweat)', tag: 'sweat' },
                { name: '油亮光泽肌肤', tag: 'oily skin' },
                { name: '身体美人痣', tag: 'mole on body' },
                { name: '胸部上的痣', tag: 'mole on breast' },
                { name: '大腿上的痣', tag: 'mole on thigh' },
                { name: '可爱雀斑 (freckles)', tag: 'freckles' },
                { name: '淫纹/腹部符文', tag: 'womb tattoo' },
                { name: '舌钉 (tongue piercing)', tag: 'tongue piercing' },
                { name: '肚脐钉', tag: 'navel piercing' },
                { name: '正字标记/身体文字', tag: 'body writing' },
                { name: '个性纹身/刺青', tag: 'tattoo' },
                { name: '战斗伤痕/创口贴', tag: 'scar, bandaid' }
            ]
        },
        {
            group: '🎀 头部与面部配饰',
            tags: [
                { name: '经典眼镜', tag: 'glasses' },
                { name: '半框眼镜', tag: 'semi-rimless glasses' },
                { name: '无框眼镜', tag: 'rimless glasses' },
                { name: '复古圆框眼镜', tag: 'round glasses' },
                { name: '太阳镜/墨镜', tag: 'sunglasses' },
                { name: '护目镜 (goggles)', tag: 'goggles' },
                { name: '头戴式耳机', tag: 'headphones' },
                { name: '猫耳耳机', tag: 'cat ear headphones' },
                { name: '单眼罩 (eyepatch)', tag: 'eyepatch' },
                { name: '医疗白色眼罩', tag: 'medical eyepatch' },
                { name: '单片眼镜', tag: 'monocle' },
                { name: '防尘口罩', tag: 'mask' },
                { name: '蒙眼布 (blindfold)', tag: 'blindfold' },
                { name: '发带/丝带 (hair ribbon)', tag: 'hair ribbon' },
                { name: '大蝴蝶结发饰', tag: 'hair bow' },
                { name: '精致发卡/发夹', tag: 'hairclip' },
                { name: '花朵发饰', tag: 'hair flower' },
                { name: '传统发簪/发针', tag: 'hairpin' },
                { name: '发箍/头箍 (hairband)', tag: 'hairband' },
                { name: '小皇冠/发冠 (tiara)', tag: 'tiara' },
                { name: '白色头纱/面纱 (veil)', tag: 'veil' },
                { name: '皮质锁骨链/颈圈 (choker)', tag: 'choker' },
                { name: '皮项圈/带环项圈', tag: 'collar' },
                { name: '铃铛项圈', tag: 'bell choker' },
                { name: '精致耳环/耳坠', tag: 'earrings' },
                { name: '十字架项链', tag: 'cross necklace' }
            ]
        }
    ];

    const OUTFIT_TRAIT_PRESETS = [
        {
            group: '👗 常见服装',
            tags: [
                { name: '水手服', tag: 'sailor suit, pleated skirt' },
                { name: '西装校服', tag: 'school uniform, blazer, necktie' },
                { name: '女仆装', tag: 'maid outfit, frilled apron, maid headdress' },
                { name: '兔女郎', tag: 'bunny suit, bunny ears, fishnet pantyhose' },
                { name: '修女袍', tag: 'nun habit, veil, long dress, cross necklace' },
                { name: '哥特裙', tag: 'gothic dress, black lace, frills, ribbon' },
                { name: '比基尼', tag: 'bikini, side-tie bikini bottom' },
                { name: '死库水', tag: 'school swimsuit' },
                { name: '日常卫衣', tag: 'casual clothes, hoodie, short shorts' },
                { name: '露肩毛衣', tag: 'off-shoulder sweater, knit sweater' },
                { name: '晚礼服', tag: 'evening gown, elegant dress, bare shoulders' },
                { name: '旗袍', tag: 'china dress, cheongsam, high slit' },
                { name: '和服/浴衣', tag: 'kimono, floral print, obi' }
            ]
        },
        {
            group: '🧦 鞋袜配饰',
            tags: [
                { name: '白丝过膝袜', tag: 'white thighhighs' },
                { name: '黑丝过膝袜', tag: 'black thighhighs' },
                { name: '透肉黑丝', tag: 'sheer black pantyhose' },
                { name: '渔网袜', tag: 'fishnet stockings' },
                { name: '吊带袜', tag: 'garter straps, thighhighs' },
                { name: '高跟鞋', tag: 'high heels' },
                { name: '乐福鞋', tag: 'loafers' },
                { name: '长筒靴', tag: 'boots' }
            ]
        }
    ];

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

    // ── Character Creator Modal (角色创建/编辑) ───────────────
    function openCharacterEditorModal(charId = null, onSaved) {
        const store = getStore();
        const isEdit = !!(charId && store.characters[charId]);
        const char = isEdit ? { ...store.characters[charId] } : {
            id: uid('char'),
            name: '',
            avatarUrl: '',
            baseTags: '',
            currentOutfit: '',
            wardrobe: []
        };

        const modal = document.createElement('div');
        modal.id = 'rbq-cw-char-editor-modal';
        modal.style.cssText = `
            position: fixed !important; inset: 0 !important; z-index: 100000015 !important;
            background: rgba(0,0,0,0.85) !important; display: flex !important;
            align-items: center !important; justify-content: center !important;
            padding: 16px !important; box-sizing: border-box !important;
            backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important;
        `;

        modal.innerHTML = `
            <div style="background: #1c1d22 !important; border: 1px solid rgba(121,228,255,0.3) !important; border-radius: 14px !important; width: 740px !important; max-width: 95vw !important; max-height: 94vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 20px 60px rgba(0,0,0,0.9) !important; box-sizing: border-box !important;">
                <div style="display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 12px 18px !important; border-bottom: 1px solid rgba(255,255,255,0.08) !important; background: rgba(121,228,255,0.06) !important;">
                    <strong style="font-size: 15px !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 8px !important;">
                        <i class="fa-solid fa-user-plus"></i> ${isEdit ? `编辑角色档案 — 「${escapeHtml(char.name || '未命名')}」` : '✨ 拼装创造新角色'}
                    </strong>
                    <button class="cw-wb-btn close" id="rbq-cw-ce-close">✕</button>
                </div>

                <div style="padding: 16px 18px !important; overflow-y: auto !important; display: flex !important; flex-direction: column !important; gap: 14px !important;">
                    <!-- Basic Info -->
                    <div style="display: flex !important; gap: 12px !important; align-items: center !important;">
                        <div style="display: flex !important; flex-direction: column !important; align-items: center !important; gap: 6px !important;">
                            <div id="rbq-cw-avatar-preview" style="width: 58px !important; height: 58px !important; border-radius: 10px !important; background: rgba(255,255,255,0.05) !important; border: 1px solid rgba(255,255,255,0.15) !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: 24px !important; overflow: hidden !important;">
                                ${char.avatarUrl ? `<img src="${escapeHtml(char.avatarUrl)}" style="width:100%;height:100%;object-fit:cover;" />` : '👤'}
                            </div>
                        </div>
                        <div style="flex: 1 !important; display: flex !important; flex-direction: column !important; gap: 6px !important;">
                            <div style="display: flex !important; gap: 8px !important;">
                                <input id="rbq-cw-char-name" type="text" placeholder="角色姓名 (例如: 爱丽丝 / Kato (original))" value="${escapeHtml(char.name)}" style="flex: 1 !important; height: 32px !important; padding: 4px 10px !important; font-size: 13px !important; font-weight: bold !important; background: rgba(0,0,0,0.4) !important; border: 1px solid rgba(121,228,255,0.3) !important; border-radius: 6px !important; color: #fff !important;" />
                            </div>
                            <input id="rbq-cw-char-avatar-url" type="text" placeholder="头像图片 URL (可选或生图后一键设置)" value="${escapeHtml(char.avatarUrl)}" style="height: 28px !important; padding: 2px 8px !important; font-size: 11px !important; background: rgba(0,0,0,0.3) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 6px !important; color: rgba(255,255,255,0.8) !important;" />
                        </div>
                    </div>

                    <!-- Base Appearance Tags (外貌基础特征) -->
                    <div style="display: flex !important; flex-direction: column !important; gap: 8px !important; background: rgba(0,0,0,0.2) !important; padding: 12px !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.06) !important;">
                        <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; flex-wrap: wrap !important; gap: 6px !important;">
                            <label style="font-size: 12.5px !important; font-weight: bold !important; color: #79e4ff !important; display: flex !important; align-items: center !important; gap: 6px !important;">
                                <span>💇</span> 固定外貌特征 (Base Tags)：
                            </label>
                            <button class="cw-wb-btn cyan" id="rbq-cw-pick-base-wb" type="button">
                                <i class="fa-solid fa-book-open"></i> 从世界书挑选外貌词条
                            </button>
                        </div>

                        <!-- Visual Quick-Pick Chips for Base -->
                        <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; background: rgba(0,0,0,0.3) !important; padding: 10px !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.06) !important;">
                            <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-weight: bold !important;">🎨 全量外貌特征分类点选 (点击快速添加/移除)：</div>
                            <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; max-height: 220px !important; overflow-y: auto !important;">
                                ${BASE_TRAIT_PRESETS.map(group => `
                                    <div style="display: flex !important; gap: 6px !important; align-items: flex-start !important; flex-wrap: wrap !important; background: rgba(255,255,255,0.02) !important; padding: 4px 6px !important; border-radius: 6px !important;">
                                        <span style="font-size: 10.5px !important; color: #ffb86c !important; font-weight: bold !important; min-width: 90px !important; flex-shrink: 0 !important; padding-top: 2px !important;">${escapeHtml(group.group)}:</span>
                                        <div style="display: flex !important; gap: 4px !important; flex-wrap: wrap !important; flex: 1 !important;">
                                            ${group.tags.map(t => `
                                                <button class="cw-btn sm rbq-cw-base-chip-btn" data-tag="${escapeHtml(t.tag)}" type="button" style="background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 4px !important; cursor: pointer !important;">${escapeHtml(t.name)}</button>
                                            `).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <textarea id="rbq-cw-char-base" placeholder="例如: 1girl, silver hair, red eyes, twin tails, slender, pointy ears, blush" style="width: 100% !important; min-height: 60px !important; padding: 6px 8px !important; font-size: 11.5px !important; font-family: monospace !important; background: rgba(0,0,0,0.35) !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 6px !important; color: #fff !important; box-sizing: border-box !important;">${escapeHtml(char.baseTags)}</textarea>
                        <small style="opacity: 0.6 !important; font-size: 10.5px !important;">跨场景固定的外貌特征：发色、发型、瞳色、身材、种族（兽耳/精灵耳）等。</small>
                    </div>

                    <!-- Current Outfit Tags (当前穿着服装) -->
                    <div style="display: flex !important; flex-direction: column !important; gap: 8px !important; background: rgba(0,0,0,0.2) !important; padding: 12px !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,0.06) !important;">
                        <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; flex-wrap: wrap !important; gap: 6px !important;">
                            <label style="font-size: 12.5px !important; font-weight: bold !important; color: #ffb86c !important; display: flex !important; align-items: center !important; gap: 6px !important;">
                                <span>👗</span> 默认服装 (Outfit Tags)：
                            </label>
                            <button class="cw-wb-btn orange" id="rbq-cw-pick-outfit-wb" type="button">
                                <i class="fa-solid fa-book-open"></i> 从世界书挑选服装
                            </button>
                        </div>

                        <!-- Visual Quick-Pick Chips for Outfit -->
                        <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; background: rgba(0,0,0,0.25) !important; padding: 8px !important; border-radius: 6px !important; border: 1px solid rgba(255,255,255,0.05) !important;">
                            <div style="font-size: 11px !important; color: rgba(255,255,255,0.7) !important; font-weight: bold !important;">👗 常见服装快速点选：</div>
                            <div style="display: flex !important; flex-direction: column !important; gap: 6px !important; max-height: 120px !important; overflow-y: auto !important;">
                                ${OUTFIT_TRAIT_PRESETS.map(group => `
                                    <div style="display: flex !important; gap: 4px !important; align-items: center !important; flex-wrap: wrap !important;">
                                        <span style="font-size: 10.5px !important; color: #a3d4ff !important; font-weight: bold !important; width: 85px !important; flex-shrink: 0 !important;">${escapeHtml(group.group)}:</span>
                                        <div style="display: flex !important; gap: 4px !important; flex-wrap: wrap !important; flex: 1 !important;">
                                            ${group.tags.map(t => `
                                                <button class="cw-btn sm rbq-cw-outfit-chip-btn" data-tag="${escapeHtml(t.tag)}" type="button" style="background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.1) !important; border-radius: 4px !important; cursor: pointer !important;">${escapeHtml(t.name)}</button>
                                            `).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        <textarea id="rbq-cw-char-outfit" placeholder="例如: gothic dress, black ribbon, white thighhighs, frilled sleeves" style="width: 100% !important; min-height: 55px !important; padding: 6px 8px !important; font-size: 11.5px !important; font-family: monospace !important; background: rgba(0,0,0,0.35) !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 6px !important; color: #fff !important; box-sizing: border-box !important;">${escapeHtml(char.currentOutfit)}</textarea>
                    </div>

                    <!-- Test Button & Save Actions -->
                    <div style="display: flex !important; justify-content: space-between !important; align-items: center !important; margin-top: 6px !important; padding-top: 8px !important; border-top: 1px solid rgba(255,255,255,0.08) !important; flex-wrap: wrap !important; gap: 8px !important;">
                        <button class="cw-wb-btn cyan" id="rbq-cw-test-single-char" type="button">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> 测试生成单人立绘
                        </button>
                        <div style="display: flex !important; gap: 8px !important;">
                            <button class="cw-wb-btn close" id="rbq-cw-ce-cancel" type="button">取消</button>
                            <button class="cw-wb-btn green" id="rbq-cw-ce-save" type="button">💾 保存角色档案</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const close = () => modal.remove();
        modal.querySelector('#rbq-cw-ce-close')?.addEventListener('click', close);
        modal.querySelector('#rbq-cw-ce-cancel')?.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        // Helper to update active chip highlights
        function refreshChipActiveState() {
            const baseText = (modal.querySelector('#rbq-cw-char-base')?.value || '').toLowerCase();
            modal.querySelectorAll('.rbq-cw-base-chip-btn').forEach(btn => {
                const tag = (btn.dataset.tag || '').toLowerCase();
                const isSelected = baseText.split(',').map(s => s.trim()).includes(tag);
                if (isSelected) {
                    btn.style.setProperty('background', 'rgba(121,228,255,0.25)', 'important');
                    btn.style.setProperty('border-color', 'rgba(121,228,255,0.6)', 'important');
                    btn.style.setProperty('color', '#79e4ff', 'important');
                    btn.style.setProperty('font-weight', 'bold', 'important');
                } else {
                    btn.style.setProperty('background', 'rgba(255,255,255,0.04)', 'important');
                    btn.style.setProperty('border-color', 'rgba(255,255,255,0.1)', 'important');
                    btn.style.setProperty('color', 'rgba(255,255,255,0.7)', 'important');
                    btn.style.setProperty('font-weight', 'normal', 'important');
                }
            });
        }

        // Quick Chip Toggle Handlers
        modal.querySelectorAll('.rbq-cw-base-chip-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.tag;
                const baseArea = modal.querySelector('#rbq-cw-char-base');
                if (baseArea && tag) {
                    baseArea.value = appendOrToggleTag(baseArea.value, tag);
                    refreshChipActiveState();
                }
            });
        });

        modal.querySelector('#rbq-cw-char-base')?.addEventListener('input', refreshChipActiveState);
        refreshChipActiveState();

        modal.querySelectorAll('.rbq-cw-outfit-chip-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.tag;
                const outfitArea = modal.querySelector('#rbq-cw-char-outfit');
                if (outfitArea && tag) {
                    outfitArea.value = appendOrToggleTag(outfitArea.value, tag);
                }
            });
        });

        // Worldbook pickers
        modal.querySelector('#rbq-cw-pick-base-wb')?.addEventListener('click', () => {
            openWorldbookPickerModal({ title: '选择发型与外貌特征', defaultCategory: 'appearance' }, (selected) => {
                const baseArea = modal.querySelector('#rbq-cw-char-base');
                if (baseArea) {
                    const current = baseArea.value.trim();
                    baseArea.value = current ? `${current}, ${selected.tags}` : selected.tags;
                    toastr.success(`已添加「${selected.title}」`, PLUGIN_NAME);
                }
            });
        });

        modal.querySelector('#rbq-cw-pick-outfit-wb')?.addEventListener('click', () => {
            openWorldbookPickerModal({ title: '选择服装预设', defaultCategory: 'outfit' }, (selected) => {
                const outfitArea = modal.querySelector('#rbq-cw-char-outfit');
                if (outfitArea) {
                    outfitArea.value = selected.tags;
                    toastr.success(`已应用服装「${selected.title}」`, PLUGIN_NAME);
                }
            });
        });

        // Test Single Draw
        modal.querySelector('#rbq-cw-test-single-char')?.addEventListener('click', async () => {
            const name = modal.querySelector('#rbq-cw-char-name')?.value?.trim() || 'Character';
            const baseTags = modal.querySelector('#rbq-cw-char-base')?.value?.trim() || '';
            const outfitTags = modal.querySelector('#rbq-cw-char-outfit')?.value?.trim() || '';
            const finalPrompt = [baseTags, outfitTags, 'simple background, white background, standing, looking at viewer'].filter(Boolean).join(', ');

            toastr.info(`正在生成角色「${name}」立绘...`, PLUGIN_NAME);
            try {
                const result = await RBQ.api.generateImage(finalPrompt, 'character-workshop-portrait');
                if (result?.url) {
                    modal.querySelector('#rbq-cw-char-avatar-url').value = result.url;
                    modal.querySelector('#rbq-cw-avatar-preview').innerHTML = `<img src="${escapeHtml(result.url)}" style="width:100%;height:100%;object-fit:cover;" />`;
                    toastr.success(`立绘生成成功，已自动设为头像！`, PLUGIN_NAME);
                }
            } catch (err) {
                toastr.error(`生成立绘失败: ${err.message || err}`, PLUGIN_NAME);
            }
        });

        // Save Character
        modal.querySelector('#rbq-cw-ce-save')?.addEventListener('click', () => {
            const name = modal.querySelector('#rbq-cw-char-name')?.value?.trim();
            if (!name) {
                toastr.warning('请输入角色名称', PLUGIN_NAME);
                return;
            }
            char.name = name;
            char.avatarUrl = modal.querySelector('#rbq-cw-char-avatar-url')?.value?.trim() || '';
            char.baseTags = modal.querySelector('#rbq-cw-char-base')?.value?.trim() || '';
            char.currentOutfit = modal.querySelector('#rbq-cw-char-outfit')?.value?.trim() || '';

            store.characters[char.id] = char;
            save();
            toastr.success(`角色「${name}」已保存！`, PLUGIN_NAME);
            if (typeof onSaved === 'function') onSaved(char);
            close();
        });

        document.body.appendChild(modal);
    }

    // ── Inject Stylesheet ─────────────────────────────────────
    (function injectCwStyles() {
        if (document.getElementById('rbq-cw-styles')) return;
        const style = document.createElement('style');
        style.id = 'rbq-cw-styles';
        style.textContent = `
/* ── Character Workshop CSS ── */
.cw-wrap{display:flex;flex-direction:column;gap:14px;width:100%;box-sizing:border-box;padding:4px 0}
.cw-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:10px;background:linear-gradient(90deg,rgba(121,228,255,.12),rgba(255,184,108,.08));border:1px solid rgba(255,255,255,.08);gap:10px;flex-wrap:wrap}
.cw-title{font-size:15px;color:#79e4ff;display:flex;align-items:center;gap:8px;font-weight:700;white-space:nowrap}
.cw-nav{display:flex;gap:4px;background:rgba(0,0,0,.4);padding:3px;border-radius:8px;border:1px solid rgba(255,255,255,.08);flex-wrap:wrap}
.cw-nav-btn{padding:5px 12px;font-size:12px;border-radius:6px;cursor:pointer;white-space:nowrap;border:1px solid transparent;background:transparent;color:rgba(255,255,255,.7);transition:all .15s}
.cw-nav-btn:hover{background:rgba(121,228,255,.12);color:#79e4ff}
.cw-nav-btn.active{background:rgba(121,228,255,.25);color:#79e4ff;font-weight:700;border-color:rgba(121,228,255,.3)}
.cw-body{display:flex;flex-direction:column;gap:14px}
.cw-section{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}
.cw-section-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.cw-section-title{font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:6px;white-space:nowrap}
.cw-section-title.orange{color:#ffb86c}
.cw-section-title.cyan{color:#79e4ff}
.cw-btn-row{display:flex;gap:6px;flex-wrap:wrap}
.cw-btn{padding:4px 10px;font-size:11px;border-radius:6px;cursor:pointer;white-space:nowrap;border:1px solid transparent;background:transparent;color:rgba(255,255,255,.7);transition:all .15s}
.cw-btn.orange{background:rgba(255,184,108,.18);color:#ffb86c;border-color:rgba(255,184,108,.35)}
.cw-btn.cyan{background:rgba(121,228,255,.18);color:#79e4ff;border-color:rgba(121,228,255,.35)}
.cw-btn.green{background:rgba(100,255,100,.18);color:#a3ffa3;border-color:rgba(100,255,100,.35)}
.cw-btn.red{color:#ff8585}
.cw-btn.primary{padding:8px 20px;font-size:13px;font-weight:700;background:linear-gradient(135deg,rgba(121,228,255,.3),rgba(100,255,100,.3));color:#fff;border-color:rgba(121,228,255,.5);box-shadow:0 4px 15px rgba(121,228,255,.2)}
.cw-btn.sm{padding:2px 8px;font-size:10.5px}
.cw-btn:hover{filter:brightness(1.2)}
.cw-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cw-input-group{display:flex;flex-direction:column;gap:4px}
.cw-label{font-size:11px;opacity:.8}
.cw-input{height:32px;padding:4px 8px;font-size:11.5px;font-family:monospace;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;box-sizing:border-box;width:100%}
.cw-input-sm{height:28px;padding:2px 6px;font-size:11px}
.cw-slots-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.cw-slot-card{background:rgba(255,255,255,.03);border:1px solid rgba(121,228,255,.2);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}
.cw-slot-head{display:flex;justify-content:space-between;align-items:center}
.cw-slot-left{display:flex;align-items:center;gap:6px}
.cw-badge{background:rgba(121,228,255,.2);color:#79e4ff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;white-space:nowrap}
.cw-slot-name{font-size:13px;color:#fff;font-weight:700}
.cw-slot-select{flex:1;height:30px;font-size:11.5px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#fff;width:100%}
.cw-pos-row{display:flex;gap:4px;background:rgba(0,0,0,.2);padding:6px 8px;border-radius:6px;flex-direction:column}
.cw-pos-head{display:flex;justify-content:space-between;align-items:center}
.cw-pos-label{font-size:10.5px;opacity:.8}
.cw-pos-val{font-size:10.5px;color:#79e4ff;font-weight:700}
.cw-pos-btns{display:flex;gap:4px}
.cw-pos-btn{padding:2px 6px;font-size:10px;border-radius:4px;cursor:pointer;background:transparent;border:1px solid transparent;color:rgba(255,255,255,.6);white-space:nowrap}
.cw-pos-btn.active{background:rgba(121,228,255,.25);color:#79e4ff;border-color:rgba(121,228,255,.4)}
.cw-preview-box{background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.cw-preview-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px}
.cw-preview-label{font-size:11.5px;color:rgba(255,255,255,.85);font-weight:700;white-space:nowrap}
.cw-preview-text{font-size:11.5px;font-family:monospace;color:#a3d4ff;line-height:1.4;max-height:70px;overflow-y:auto;word-break:break-all;white-space:pre-wrap}
.cw-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}
.cw-desc{font-size:13px;opacity:.8}
.cw-chars-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.cw-char-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}
.cw-char-row{display:flex;gap:10px;align-items:center}
.cw-avatar{width:44px;height:44px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;flex-shrink:0}
.cw-avatar img{width:100%;height:100%;object-fit:cover}
.cw-char-info{flex:1;min-width:0}
.cw-char-name{font-size:14px;color:#79e4ff;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.cw-char-sub{opacity:.6;font-size:11px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-char-actions{display:flex;justify-content:flex-end;gap:6px;border-top:1px solid rgba(255,255,255,.05);padding-top:6px}
.cw-empty{grid-column:1/-1;text-align:center;opacity:.5;padding:40px 0;font-size:13px}
.cw-preset-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}
.cw-preset-name{color:#ffb86c;font-size:13px;font-weight:700}
.cw-preset-meta{font-size:11px;color:rgba(255,255,255,.6)}
.cw-preset-foot{display:flex;justify-content:space-between;align-items:center;margin-top:4px}
.cw-preset-scene{font-size:10.5px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px}
@media(max-width:600px){
  .cw-grid-2{grid-template-columns:1fr}
  .cw-slots-grid{grid-template-columns:1fr}
  .cw-chars-grid{grid-template-columns:1fr}
  .cw-header{flex-direction:column;align-items:stretch}
  .cw-nav{justify-content:center}
/* ── Worldbook Picker Modal CSS ── */
.cw-wb-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:4px!important;white-space:nowrap!important;flex-shrink:0!important;border-radius:6px!important;cursor:pointer!important;border:1px solid transparent!important;transition:all .15s!important;box-sizing:border-box!important;min-width:max-content!important}
.cw-wb-btn.green{background:rgba(100,255,100,.18)!important;color:#a3ffa3!important;border-color:rgba(100,255,100,.35)!important;padding:4px 12px!important;font-size:11.5px!important;font-weight:700!important}
.cw-wb-btn.orange{background:rgba(255,184,108,.2)!important;color:#ffb86c!important;border-color:rgba(255,184,108,.4)!important;padding:4px 10px!important;font-size:11.5px!important;font-weight:700!important}
.cw-wb-btn.cyan{background:rgba(121,228,255,.2)!important;color:#79e4ff!important;border-color:rgba(121,228,255,.4)!important;padding:4px 10px!important;font-size:11.5px!important}
.cw-wb-btn.close{background:rgba(255,255,255,.08)!important;color:rgba(255,255,255,.7)!important;border-color:rgba(255,255,255,.15)!important;padding:3px 8px!important;font-size:13px!important}
.cw-wb-btn:hover{filter:brightness(1.25)!important}
/* ── Panel Container Control ── */
.st-scene-trigger-modal-panel[data-kite-panel="character-workshop"]{display:none!important;width:100%!important;box-sizing:border-box!important}
.st-scene-trigger-modal-panel[data-kite-panel="character-workshop"].active{display:flex!important;flex-direction:column!important}
        `;
        document.head.appendChild(style);
    })();

    // ── Tab 1: 多角色组合台 ────────────────────────────────
    function renderComposerTab(comp, charList) {
        const store = getStore();
        const slots = Array.isArray(comp?.slots) ? comp.slots : [];
        const finalPrompt = composeFinalPrompt(comp);

        return `
            <div class="cw-body">
                <!-- Scene Settings -->
                <div class="cw-section">
                    <div class="cw-section-head">
                        <span class="cw-section-title orange"><i class="fa-solid fa-mountain-sun"></i> 场景环境与全局构图</span>
                        <div class="cw-btn-row">
                            <button class="cw-btn orange" id="rbq-cw-pick-scene-wb" type="button"><i class="fa-solid fa-book-open"></i> 从世界书选场景</button>
                            <button class="cw-btn cyan" id="rbq-cw-pick-pose-wb" type="button"><i class="fa-solid fa-people-arrows"></i> 双人互动体位库</button>
                        </div>
                    </div>
                    <div class="cw-grid-2">
                        <div class="cw-input-group">
                            <span class="cw-label">场景背景 Tags (indoors, beach, night...)：</span>
                            <input id="rbq-cw-comp-scene" class="cw-input" type="text" value="${escapeHtml(comp?.scene || '')}" />
                        </div>
                        <div class="cw-input-group">
                            <span class="cw-label">镜头视角 (POV, from above, close-up...)：</span>
                            <input id="rbq-cw-comp-camera" class="cw-input" type="text" value="${escapeHtml(comp?.camera || '')}" />
                        </div>
                    </div>
                </div>

                <!-- Slots Header -->
                <div class="cw-section-head">
                    <span class="cw-section-title cyan"><i class="fa-solid fa-users-viewfinder"></i> 角色拼装槽位 (Char 1 ~ ${slots.length})</span>
                    <button class="cw-btn green" id="rbq-cw-add-slot-btn" type="button"><i class="fa-solid fa-plus"></i> 添加角色槽位</button>
                </div>

                <!-- Slots Grid -->
                <div class="cw-slots-grid">
                    ${slots.map((slot, idx) => {
                        const charObj = store.characters[slot.charId];
                        return `
                        <div class="cw-slot-card" data-index="${idx}">
                            <div class="cw-slot-head">
                                <div class="cw-slot-left">
                                    <span class="cw-badge">Char ${idx + 1}</span>
                                    <span class="cw-slot-name">${escapeHtml(charObj?.name || slot.customName || '角色 ' + (idx + 1))}</span>
                                </div>
                                ${slots.length > 1 ? `<button class="cw-btn red sm rbq-cw-remove-slot-btn" data-index="${idx}" type="button">✕ 移除</button>` : ''}
                            </div>
                            <select class="cw-slot-select rbq-cw-slot-char-select" data-index="${idx}">
                                <option value="">👤 [自定义角色 / 未建档]</option>
                                ${charList.map(c => `<option value="${escapeHtml(c.id)}" ${slot.charId === c.id ? 'selected' : ''}>👤 ${escapeHtml(c.name)}</option>`).join('')}
                            </select>
                            <div class="cw-input-group">
                                <div class="cw-section-head">
                                    <span class="cw-label">动作/姿势 (Action)：</span>
                                    <button class="cw-btn cyan sm rbq-cw-pick-slot-action-wb" data-index="${idx}" type="button"><i class="fa-solid fa-book-open"></i> 选动作</button>
                                </div>
                                <input class="cw-input cw-input-sm rbq-cw-slot-action-input" data-index="${idx}" type="text" placeholder="standing, blush, hands on hips..." value="${escapeHtml(slot.action || '')}" />
                            </div>
                            <div class="cw-pos-row">
                                <div class="cw-pos-head">
                                    <span class="cw-pos-label">📍 站位坐标：</span>
                                    <span class="cw-pos-val">${formatCoordLabel(slot.center || 'C3')}</span>
                                </div>
                                <div class="cw-pos-btns">
                                    ${['B3', 'C3', 'D3', 'A2', 'E2'].map(pos => `
                                        <button class="cw-pos-btn rbq-cw-slot-pos-btn ${slot.center === pos ? 'active' : ''}" data-index="${idx}" data-pos="${pos}" type="button">${pos}</button>
                                    `).join('')}
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>

                <!-- Preview -->
                <div class="cw-preview-box">
                    <div class="cw-preview-head">
                        <span class="cw-preview-label">🚀 合成提示词预览 (NAI V4.5 Multi-Char)：</span>
                        <button class="cw-btn sm" id="rbq-cw-copy-prompt" type="button"><i class="fa-regular fa-copy"></i> 复制</button>
                    </div>
                    <div id="rbq-cw-prompt-preview" class="cw-preview-text">${escapeHtml(finalPrompt)}</div>
                </div>

                <!-- Actions -->
                <div class="cw-actions">
                    <button class="cw-btn orange" id="rbq-cw-save-scene-preset" type="button"><i class="fa-solid fa-floppy-disk"></i> 保存为组合预设</button>
                    <button class="cw-btn primary" id="rbq-cw-generate-now" type="button"><i class="fa-solid fa-wand-magic-sparkles"></i> 🚀 立即合成并生图</button>
                </div>
            </div>
        `;
    }

    // ── Tab 2: 角色档案库 ──────────────────────────────────
    function renderCharactersTab(charList) {
        const store = getStore();
        return `
            <div class="cw-body">
                <div class="cw-section-head">
                    <span class="cw-desc">管理你创造和保存的角色档案库，可随时在组合台中调用。</span>
                    <div class="cw-btn-row">
                        <button class="cw-btn orange" id="rbq-cw-import-st-chars" type="button"><i class="fa-solid fa-file-import"></i> 从酒馆角色卡导入</button>
                        <button class="cw-btn green" id="rbq-cw-create-new-char" type="button"><i class="fa-solid fa-plus"></i> 创造新角色</button>
                    </div>
                </div>
                <div class="cw-chars-grid">
                    ${charList.length === 0 ? `<div class="cw-empty">暂无角色档案，点击上方「创造新角色」或「从酒馆角色卡导入」开始创建！</div>` : charList.map(c => `
                        <div class="cw-char-card">
                            <div class="cw-char-row">
                                <div class="cw-avatar">${c.avatarUrl ? `<img src="${escapeHtml(c.avatarUrl)}" />` : '👤'}</div>
                                <div class="cw-char-info">
                                    <strong class="cw-char-name">${escapeHtml(c.name)}</strong>
                                    <small class="cw-char-sub">外貌: ${escapeHtml(c.baseTags || '未设置')}</small>
                                </div>
                            </div>
                            <div class="cw-char-actions">
                                <button class="cw-btn cyan sm rbq-cw-send-to-slot" data-id="${escapeHtml(c.id)}" type="button">+ 放入组合台</button>
                                <button class="cw-btn sm rbq-cw-edit-char-btn" data-id="${escapeHtml(c.id)}" type="button">编辑</button>
                                <button class="cw-btn red sm rbq-cw-del-char-btn" data-id="${escapeHtml(c.id)}" type="button">删除</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ── Tab 3: 组合预设库 ──────────────────────────────────
    function renderPresetsTab() {
        const store = getStore();
        const presets = store.presets || [];
        return `
            <div class="cw-body">
                <div class="cw-desc">保存的常用多角色组合场景预设：</div>
                <div class="cw-chars-grid">
                    ${presets.length === 0 ? `<div class="cw-empty">暂无保存的组合预设，在「多角色组合台」配置好后点击「保存为组合预设」即可添加到此处！</div>` : presets.map((p, idx) => `
                        <div class="cw-preset-card">
                            <strong class="cw-preset-name">🔖 ${escapeHtml(p.name)}</strong>
                            <div class="cw-preset-meta">包含 ${p.slots?.length || 0} 位角色</div>
                            <div class="cw-preset-foot">
                                <span class="cw-preset-scene">${p.scene ? escapeHtml(p.scene.slice(0, 30)) + '...' : ''}</span>
                                <div class="cw-btn-row">
                                    <button class="cw-btn green sm rbq-cw-load-preset-btn" data-index="${idx}" type="button">载入组合台</button>
                                    <button class="cw-btn red sm rbq-cw-del-preset-btn" data-index="${idx}" type="button">删除</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function composeFinalPrompt(comp) {
        const store = getStore();
        const slots = Array.isArray(comp?.slots) ? comp.slots : [];
        const sceneParts = [comp?.scene, comp?.camera, comp?.atmosphere].filter(Boolean).join(', ');
        const charParts = slots.map((s, idx) => {
            const charObj = store.characters[s.charId];
            const base = charObj?.baseTags || '';
            const outfit = (s.outfitMode === 'custom' ? s.customOutfit : charObj?.currentOutfit) || '';
            const action = s.action || '';
            const caption = [base, outfit, action].filter(Boolean).join(', ');
            const pos = s.center || 'C3';
            return `Char${idx + 1}:${caption}|centers:${pos}`;
        });

        return [sceneParts ? `Scene:${sceneParts}` : '', ...charParts].filter(Boolean).join('; ');
    }

    function renderWorkshopInnerHtml(activeTab) {
        try {
            const store = getStore();
            const charList = Object.values(store.characters || {});
            const comp = store.activeComposer;

            return `
                <div class="cw-wrap">
                    <div class="cw-header">
                        <span class="cw-title"><i class="fa-solid fa-palette"></i> 角色工坊</span>
                        <div class="cw-nav">
                            <button class="cw-nav-btn rbq-cw-nav-tab ${activeTab === 'composer' ? 'active' : ''}" data-tab="composer"><i class="fa-solid fa-puzzle-piece"></i> 多角色组合台</button>
                            <button class="cw-nav-btn rbq-cw-nav-tab ${activeTab === 'characters' ? 'active' : ''}" data-tab="characters"><i class="fa-solid fa-users"></i> 角色档案库 (${charList.length})</button>
                            <button class="cw-nav-btn rbq-cw-nav-tab ${activeTab === 'presets' ? 'active' : ''}" data-tab="presets"><i class="fa-solid fa-bookmark"></i> 组合预设库 (${store.presets.length})</button>
                        </div>
                    </div>
                    <div id="rbq-cw-main-body" class="cw-body">
                        ${activeTab === 'composer' ? renderComposerTab(comp, charList) : ''}
                        ${activeTab === 'characters' ? renderCharactersTab(charList) : ''}
                        ${activeTab === 'presets' ? renderPresetsTab() : ''}
                    </div>
                </div>
            `;
        } catch (err) {
            console.error(`[${PLUGIN_NAME}] render error:`, err);
            return `<div style="padding:20px;color:#ff8585;">角色工坊渲染异常: ${escapeHtml(err.message || err)}</div>`;
        }
    }

    function bindWorkshopEvents(container, activeTab, onRefresh) {
        const store = getStore();
        container.querySelectorAll('.rbq-cw-nav-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.tab;
                    if (tab) onRefresh(tab);
                });
            });

            // Composer Events
            container.querySelector('#rbq-cw-comp-scene')?.addEventListener('input', (e) => {
                store.activeComposer.scene = e.target.value;
                save();
                const previewEl = container.querySelector('#rbq-cw-prompt-preview');
                if (previewEl) previewEl.textContent = composeFinalPrompt(store.activeComposer);
            });
            container.querySelector('#rbq-cw-comp-camera')?.addEventListener('input', (e) => {
                store.activeComposer.camera = e.target.value;
                save();
                const previewEl = container.querySelector('#rbq-cw-prompt-preview');
                if (previewEl) previewEl.textContent = composeFinalPrompt(store.activeComposer);
            });

            container.querySelector('#rbq-cw-pick-scene-wb')?.addEventListener('click', () => {
                openWorldbookPickerModal({ title: '选择场景环境', defaultCategory: 'scene' }, (selected) => {
                    store.activeComposer.scene = selected.tags;
                    save();
                    onRefresh(activeTab);
                });
            });

            container.querySelector('#rbq-cw-pick-pose-wb')?.addEventListener('click', () => {
                openWorldbookPickerModal({ title: '选择双人/多人互动体位', defaultCategory: 'interaction' }, (selected) => {
                    const raw = selected.tags;
                    const char1Match = raw.match(/Char1:\s*([^;]+)/i);
                    const char2Match = raw.match(/Char2:\s*([^;]+)/i);
                    if (char1Match && store.activeComposer.slots[0]) {
                        store.activeComposer.slots[0].action = char1Match[1].trim();
                    }
                    if (char2Match && store.activeComposer.slots[1]) {
                        store.activeComposer.slots[1].action = char2Match[1].trim();
                    }
                    if (!char1Match && !char2Match && store.activeComposer.slots[0]) {
                        store.activeComposer.slots[0].action = raw;
                    }
                    save();
                    onRefresh(activeTab);
                    toastr.success(`已应用互动姿势「${selected.title}」`, PLUGIN_NAME);
                });
            });

            container.querySelector('#rbq-cw-add-slot-btn')?.addEventListener('click', () => {
                const slots = store.activeComposer.slots;
                if (slots.length >= 5) {
                    toastr.warning('最多支持 5 位角色同时组合', PLUGIN_NAME);
                    return;
                }
                slots.push({ charId: '', customName: `角色 ${slots.length + 1}`, outfitMode: 'current', customOutfit: '', action: '', center: 'C3', uc: '' });
                save();
                onRefresh(activeTab);
            });

            container.querySelectorAll('.rbq-cw-remove-slot-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    store.activeComposer.slots.splice(idx, 1);
                    save();
                    onRefresh(activeTab);
                });
            });

            container.querySelectorAll('.rbq-cw-slot-char-select').forEach(sel => {
                sel.addEventListener('change', () => {
                    const idx = Number(sel.dataset.index);
                    if (store.activeComposer.slots[idx]) {
                        store.activeComposer.slots[idx].charId = sel.value;
                        save();
                        onRefresh(activeTab);
                    }
                });
            });

            container.querySelectorAll('.rbq-cw-slot-action-input').forEach(inp => {
                inp.addEventListener('input', () => {
                    const idx = Number(inp.dataset.index);
                    if (store.activeComposer.slots[idx]) {
                        store.activeComposer.slots[idx].action = inp.value;
                        save();
                        const previewEl = container.querySelector('#rbq-cw-prompt-preview');
                        if (previewEl) previewEl.textContent = composeFinalPrompt(store.activeComposer);
                    }
                });
            });

            container.querySelectorAll('.rbq-cw-pick-slot-action-wb').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    openWorldbookPickerModal({ title: `为 Char ${idx + 1} 选择动作姿势`, defaultCategory: 'pose' }, (selected) => {
                        if (store.activeComposer.slots[idx]) {
                            store.activeComposer.slots[idx].action = selected.tags;
                            save();
                            onRefresh(activeTab);
                        }
                    });
                });
            });

            container.querySelectorAll('.rbq-cw-slot-pos-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const pos = btn.dataset.pos;
                    if (store.activeComposer.slots[idx]) {
                        store.activeComposer.slots[idx].center = pos;
                        save();
                        onRefresh(activeTab);
                    }
                });
            });

            container.querySelector('#rbq-cw-copy-prompt')?.addEventListener('click', () => {
                const prompt = composeFinalPrompt(store.activeComposer);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(prompt).then(() => toastr.success('已复制多角色合成提示词', PLUGIN_NAME));
                } else {
                    toastr.info(prompt.slice(0, 100), '提示词');
                }
            });

            container.querySelector('#rbq-cw-generate-now')?.addEventListener('click', async () => {
                const finalPrompt = composeFinalPrompt(store.activeComposer);
                toastr.info('🚀 正在调用 RBQ 生图引擎生成多角色画作...', PLUGIN_NAME);
                try {
                    await RBQ.api.generateImage(finalPrompt, 'character-workshop-ensemble');
                    toastr.success('🎉 多角色画面生成完毕，已存入画廊！', PLUGIN_NAME);
                } catch (err) {
                    toastr.error(`生图失败: ${err.message || err}`, PLUGIN_NAME);
                }
            });

            container.querySelector('#rbq-cw-save-scene-preset')?.addEventListener('click', () => {
                const name = prompt('请输入该组合场景的预设名称：', `组合场景 - ${new Date().toLocaleDateString()}`);
                if (!name) return;
                store.presets.push({
                    id: uid('preset'),
                    name,
                    scene: store.activeComposer.scene,
                    camera: store.activeComposer.camera,
                    slots: JSON.parse(JSON.stringify(store.activeComposer.slots))
                });
                save();
                toastr.success(`预设「${name}」已保存！`, PLUGIN_NAME);
            });

            // Character Tab Events
            container.querySelector('#rbq-cw-create-new-char')?.addEventListener('click', () => {
                openCharacterEditorModal(null, () => onRefresh(activeTab));
            });

            container.querySelectorAll('.rbq-cw-edit-char-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const charId = btn.dataset.id;
                    openCharacterEditorModal(charId, () => onRefresh(activeTab));
                });
            });

            container.querySelectorAll('.rbq-cw-del-char-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const charId = btn.dataset.id;
                    delete store.characters[charId];
                    save();
                    onRefresh(activeTab);
                    toastr.info('角色档案已删除', PLUGIN_NAME);
                });
            });

            container.querySelectorAll('.rbq-cw-send-to-slot').forEach(btn => {
                btn.addEventListener('click', () => {
                    const charId = btn.dataset.id;
                    if (store.activeComposer.slots[0]) {
                        store.activeComposer.slots[0].charId = charId;
                    }
                    save();
                    onRefresh('composer');
                    toastr.success('已放入组合台 Char 1', PLUGIN_NAME);
                });
            });

            container.querySelector('#rbq-cw-import-st-chars')?.addEventListener('click', () => {
                try {
                    const ctx = RBQ.api.getContext();
                    const characters = ctx?.characters;
                    if (!Array.isArray(characters) || characters.length === 0) {
                        toastr.warning('当前酒馆未加载角色卡', PLUGIN_NAME);
                        return;
                    }
                    let imported = 0;
                    for (const c of characters) {
                        if (c && c.name) {
                            const charId = uid('char');
                            store.characters[charId] = {
                                id: charId,
                                name: c.name,
                                avatarUrl: c.avatar || '',
                                baseTags: '1girl, looking at viewer',
                                currentOutfit: '',
                                wardrobe: []
                            };
                            imported++;
                        }
                    }
                    save();
                    onRefresh(activeTab);
                    toastr.success(`成功导入 ${imported} 位酒馆角色卡！`, PLUGIN_NAME);
                } catch (e) {
                    toastr.error(`导入失败: ${e.message || e}`, PLUGIN_NAME);
                }
            });

            // Presets Tab Events
            container.querySelectorAll('.rbq-cw-load-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    const preset = store.presets[idx];
                    if (preset) {
                        store.activeComposer.scene = preset.scene || '';
                        store.activeComposer.camera = preset.camera || '';
                        store.activeComposer.slots = JSON.parse(JSON.stringify(preset.slots || []));
                        save();
                        onRefresh('composer');
                        toastr.success(`已载入预设「${preset.name}」`, PLUGIN_NAME);
                    }
                });
            });

            container.querySelectorAll('.rbq-cw-del-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    store.presets.splice(idx, 1);
                    save();
                    onRefresh(activeTab);
                    toastr.info('预设已删除', PLUGIN_NAME);
                });
            });
        }

        // ── Render into Standalone Modal ──────────────────────
        function openCharacterWorkshopModal(initialTab = 'composer') {
            const existing = document.getElementById('rbq-character-workshop-modal');
            if (existing) existing.remove();

            let currentTab = initialTab;
            const modal = document.createElement('div');
            modal.id = 'rbq-character-workshop-modal';
            modal.style.cssText = `
                position: fixed !important; inset: 0 !important; z-index: 100000010 !important;
                background: rgba(0,0,0,0.85) !important; display: flex !important;
                align-items: center !important; justify-content: center !important;
                padding: 16px !important; box-sizing: border-box !important;
                backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
            `;

            function update() {
                modal.innerHTML = `
                    <div style="background: #16171d !important; border: 1px solid rgba(121,228,255,0.35) !important; border-radius: 16px !important; width: 920px !important; max-width: 96vw !important; height: 88vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; box-shadow: 0 25px 70px rgba(0,0,0,0.95) !important; box-sizing: border-box !important;">
                        <div style="display: flex !important; justify-content: flex-end !important; padding: 8px 12px 0 0 !important;">
                            <button class="menu_button" id="rbq-cw-main-close" style="padding: 4px 10px !important; font-size: 13px !important; cursor: pointer !important;">✕</button>
                        </div>
                        <div id="rbq-cw-modal-scrollable" style="flex: 1 !important; overflow-y: auto !important; padding: 0 20px 20px 20px !important;">
                            ${renderWorkshopInnerHtml(currentTab)}
                        </div>
                    </div>
                `;
                modal.querySelector('#rbq-cw-main-close')?.addEventListener('click', () => modal.remove());
                modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
                bindWorkshopEvents(modal, currentTab, (newTab) => {
                    currentTab = newTab;
                    update();
                });
            }

            update();
            document.body.appendChild(modal);
        }

        // ── Render into Control Panel Tab ─────────────────────
        let currentSettingTab = 'composer';

        function switchRbqTab(tab) {
            document.querySelectorAll('[data-kite-tab]').forEach((element) => {
                if (element instanceof HTMLElement) element.classList.toggle('active', element.dataset.kiteTab === tab);
            });
            document.querySelectorAll('[data-kite-panel]').forEach((element) => {
                if (element instanceof HTMLElement) element.classList.toggle('active', element.dataset.kitePanel === tab);
            });
        }

        function ensureSettingsPanel() {
            const rail = document.querySelector('.st-scene-trigger-tab-rail');
            const content = document.querySelector('.st-scene-trigger-modal-content');
            if (!(rail instanceof HTMLElement) || !(content instanceof HTMLElement)) return null;

            let button = document.querySelector('[data-kite-tab="character-workshop"]');
            if (!(button instanceof HTMLButtonElement)) {
                button = document.createElement('button');
                button.className = 'st-scene-trigger-tab-button';
                button.dataset.kiteTab = 'character-workshop';
                button.type = 'button';
                button.innerHTML = '<i class="fa-solid fa-palette"></i><span>角色工坊</span>';
                button.addEventListener('click', () => {
                    switchRbqTab('character-workshop');
                    renderWorkshopInSettingsPanel();
                });

                const targetBtn = rail.querySelector('[data-kite-tab="smart-draw"]') || rail.querySelector('[data-kite-tab="extensions"]');
                if (targetBtn?.nextSibling) {
                    rail.insertBefore(button, targetBtn.nextSibling);
                } else {
                    rail.append(button);
                }
            }

            let panel = document.querySelector('[data-kite-panel="character-workshop"]');
            if (!(panel instanceof HTMLElement)) {
                panel = document.createElement('section');
                panel.className = 'st-scene-trigger-modal-panel';
                panel.dataset.kitePanel = 'character-workshop';
                content.append(panel);
                renderWorkshopInSettingsPanel();
            }
            return panel;
        }

        function renderWorkshopInSettingsPanel() {
            const panel = document.querySelector('[data-kite-panel="character-workshop"]');
            if (!panel) return;
            panel.innerHTML = renderWorkshopInnerHtml(currentSettingTab);
            bindWorkshopEvents(panel, currentSettingTab, (newTab) => {
                currentSettingTab = newTab;
                renderWorkshopInSettingsPanel();
            });
        }

        // Periodic check to ensure tab is present whenever settings modal is open
        setInterval(ensureSettingsPanel, 1000);
        $(document).ready(() => setTimeout(ensureSettingsPanel, 1200));

        console.info(`[${PLUGIN_NAME}] 插件已就绪`);
    })(window.RBQ, window.jQuery, window.toastr);
