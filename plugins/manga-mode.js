(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[Manga Mode] RBQ Core API missing');

    try {
        const PLUGIN_ID = 'rbq-manga-mode';
        const PLUGIN_NAME = '漫画模式 (Manga Mode)';
        const STORAGE_KEY = '_mangaMode';
        const SDT_KEY = '_smartDrawTrigger';
        const VERSION = '1.4.6';

        // ── 1. Storage & State Management ──────────────────────────────
    function getStore() {
        const s = RBQ.api.getSettings();
        if (!s[STORAGE_KEY]) {
            s[STORAGE_KEY] = {
                enabled: false,
                style: 'monochrome', // monochrome | soft_color | custom
                customPositive: '',
                customNegative: '',
                grammar: 'cinema', // cinema | 4koma | shonen | mystery | shojo | daily | comedy | ecchi
                language: 'zh-hans', // zh-hans | ja
                gutter: 'bleed', // bleed | framed | splash | black_line
                autoSpread: true, // 智能跨页 (見開きページ)
                antiHijack: true, // 同人角色防夺舍
                studio: null,
            };
        }
        if (!s[STORAGE_KEY].studio) {
            s[STORAGE_KEY].studio = {
                storyText: '',
                panelCountMode: 'auto',
                ratio: '832x1216',
                autoSfx: true,
                antiHijack: true,
                lastGeneratedUrl: '',
                lastGeneratedPrompt: '',
                panels: [
                    {
                        title: '起景 · 黄昏教室',
                        desc: '夕阳斜照的黄昏教室，少女红着脸低下头，手指紧张地捏着百褶裙角。',
                        shot: 'medium shot',
                        tags: '1girl, chinami, classroom, sunset, orange light, looking down, blushing, nervous, fidgeting with skirt',
                        bubbleType: 'thought',
                        bubbleText: '心跳……怎么会这么快……',
                        bubbleLayout: 'vertical',
                    },
                    {
                        title: '递信特写 · 决定瞬间',
                        desc: '镜头拉近双手递信特写，紧紧握着带有红色火漆封口的白色情书。',
                        shot: 'close-up focus',
                        tags: 'focus on hands, holding love letter, white envelope, red wax seal, romantic tension',
                        bubbleType: 'speech',
                        bubbleText: '请、请收下这个！',
                        bubbleLayout: 'horizontal',
                    },
                    {
                        title: '神情骤变 · 泪光',
                        desc: '少女惊愕地抬起头睁大双眼，眼眶闪烁着泪光，窗外微风吹拂窗帘。',
                        shot: 'face close-up',
                        tags: '1girl, chinami, wide eyed, tears prickling in eyes, fluttering hair, curtain blowing in wind, dramatic lighting',
                        bubbleType: 'screaming',
                        bubbleText: '……欸？！我、我吗？！',
                        bubbleLayout: 'vertical',
                    }
                ]
            };
        }
        if (!s[STORAGE_KEY].studio.panelCountMode) {
            s[STORAGE_KEY].studio.panelCountMode = 'auto';
        }
        return s[STORAGE_KEY];
    }

    function getSdtStore() {
        const s = RBQ.api.getSettings();
        if (!s[SDT_KEY]) s[SDT_KEY] = {};
        return s[SDT_KEY];
    }

    function save() {
        RBQ.api.saveSettings();
    }

    // ── 2. Built-in Comic Art Styles (100% 对齐原版 v1.1.json 条目 64 与 63) ──
    const COMIC_STYLES = {
        monochrome: {
            name: '黑白 (画风-黑白)',
            positive: 'artist:2015x127, 0.5::artist:du_nyak::, 0.5::artist:yujo_kei::, greyscale, monochrome, screentone, manga, bold linework, incredibly absurdres, very aesthetic, highres, masterpiece, best quality, amazing quality, best illustration',
            negative: '10::color::, colorful, vibrant colors, painted, watercolor, pastel, 3D, realistic photo, logo, watermark, too many watermarks, reference, signature, artist name, dated, chibi, artistic error, scan artifacts, jpeg artifacts, aliasing, chromatic aberration, digital dissolve, artist collaboration, one-hour drawing challenge, mutated, mutation, deformed, distorted, disfigured, bad anatomy, unnatural hair, bad face, mob face, cloned face, distorted face, poorly drawn face, ugly, bad eyes, empty eyes, extra eyes, lazy eye, asymmetrical eyes, cross-eyed, bad proportions, wrong body proportions, unrealistic proportions, distorted body, long neck, wrong head size, bad limbs, missing limbs, extra limbs, amputee, bad arm, bad hands, malformed hands, poorly drawn hands, bad hand structure, extra digits, fewer digits, extra fingers, fused fingers, bad leg, extra leg, distorted composition, bad perspective, disorganized colors, unfinished, incomplete, duplicate, worst quality, bad quality, messy details, fewer details, bad portrait, awkward, bad posture',
            desc: '原版 v1.1.json 条目 64：细腻网点纸、三大名家混血质感、墨线张力与纯正日漫印刷风。'
        },
        soft_color: {
            name: '柔光圆润 (画风-柔光圆润)',
            positive: 'artist:a20190422,0.5::artist:simuyutou::,1.2::artist:unajyudayo::,0.5::artist:Zero Q 0q::, 1.8::masterpiece, best quality::, 1.3::2d anime::, 1.2::cel shaded anime characters::, year 2025, year 2026,amber tones,soft skin,bold linework, blurry background,2::solo artist ::',
            negative: '1.5::chibi::, blank page, logo, watermark, too many watermarks, reference, signature, artist name, dated, chibi, artistic error, scan artifacts, jpeg artifacts, aliasing, film grain, heavy film grain, dithering, chromatic aberration, digital dissolve, 3D, lowres, bad anatomy, bad hands, error, missing fingers, extra digits, fewer digits, worst quality, low quality, normal quality, jpeg artifacts, watermark, signature, username, blurry, artist name, very displeasing, malformed limbs, fused fingers, too many fingers, 3::simple illustration::, 3::signature ::, 2::artist collaboration::, censored',
            desc: '原版 v1.1.json 条目 63：剧场版柔和色彩、温润肤色质感、清透赛璐璐阴影。'
        },
        custom: {
            name: '⚙️ 自定义画风 (Custom)',
            positive: '',
            negative: '',
            desc: '自由定义专属漫画正面风格 Tag 与针对性负面词。'
        }
    };

    // ── 3. Comic Grammar & Storyboard Presets ──────────────────────
    const GRAMMAR_PRESETS = {
        cinema: {
            name: '通用映画文法 (Universal Cinema)',
            instruction: `[SHOT-GRAMMAR: UNIVERSAL-CINEMA]
日式漫画正统阅读顺序（右至左、上至下）。
依据台本事件量自适应规划画格，普通分格页由 1 个核心主画格与若干辅助画格组成：
- 设置一个占据优势视觉面积的核心主画格（呈现主冲突或高潮时刻）；
- 搭配辅助画格（展现对峙角色反应、局部特写、环境交代或拟声词）；
- 景别层次丰富：远景交代空间（wide shot, establishing shot），中景呈现互动（medium shot, cowboy shot），近景/特写捕捉微表情与眼神光（close-up, looking at viewer）；
- 视平线、俯角与仰角结合剧情动态切换（from above, from below, dutch angle）。`
        },
        '4koma': {
            name: '经典四格 (Classic 4-Koma)',
            instruction: `[SHOT-GRAMMAR: 4-KOMA]
经典四格分镜规范：
- 严格遵循“起、承、转、结”四阶梯垂直等宽等距排布（4 panels, vertical layout）；
- 前两格平稳铺垫情境与对话，第三格突发转折，第四格引爆反差包袱或搞笑落点；
- 画格方正均等，画面重心清晰平衡。`
        },
        shonen: {
            name: '少年热血 (Shonen Action)',
            instruction: `[SHOT-GRAMMAR: SHONEN-ACTION]
少年热血漫画分镜文法（Jump系/热血动作风格）：
- 核心动势格显著扩大，大通栏或斜切大格占用半页以上空间；
- 至少两格采用大角度不规则斜切边框（slanted panels），形成强烈对抗张力；
- 视线激烈跳跃，动作与冲击力优先，大量运用速度线与透视缩短（speed lines, foreshortening, dynamic angle, bold action）；
- 人物动作与拳脚突破画格边界。`
        },
        mystery: {
            name: '悬疑推理 (Mystery & Suspense)',
            instruction: `[SHOT-GRAMMAR: SEINEN-SUSPENSE]
青年悬疑推理分镜文法（死亡笔记/Monster风格）：
- 采用宽画幅横向长视线格（widescreen panel）；
- 节奏凝重克制，强调压迫感与时间拉长感；
- 多层级微表情、眼神阴影特写（shadow over eyes, intense stare, extreme close-up）；
- 穿插关键证物道具与视线错落特写，营造屏息推理氛围。`
        },
        shojo: {
            name: '恋爱少女 (Shojo Romance)',
            instruction: `[SHOT-GRAMMAR: SHOJO-ROMANCE]
精致装饰系少女漫分镜文法（CLAMP/少女漫经典风格）：
- 注重情感流动与心动瞬间，多用竖向全身长构图（vertical full body panel）；
- 强调发丝流动（flowing hair）、服饰材质与姿态优雅感；
- 格间穿插散落花瓣（falling flower petals）、柔光光斑（bokeh, light particles）与唯美光影；
- 双人视线交错与大面积心理独白特写，格与格边界柔化。`
        },
        daily: {
            name: '轻松日常 (Slice of Life)',
            instruction: `[SHOT-GRAMMAR: SLICE-OF-LIFE]
轻松日常系分镜文法（四叶妹妹/高木同学风格）：
- 规整横读格为主，间距宽松均匀，阅读节奏轻快无压力；
- 经典“铺垫 ➔ 铺垫 ➔ 反应落差”的松弛三拍节拍；
- 角色颜芸神态（funny face, expressive, comical reaction）与眼神互动为核心视觉锚点；
- 边界清晰稳定，突出温馨陪伴感。`
        },
        comedy: {
            name: '喜剧搞笑 (Comedy & Gag)',
            instruction: `[SHOT-GRAMMAR: COMEDY-GAG]
爆笑喜剧日常分镜文法（月刊少女野崎君式）：
- 方正规整画格服务于喜剧包袱节奏，吐槽链条紧凑；
- 正常脸与崩溃崩颜（chibi gag, blank eyes, sweatdrop, exaggerated expression）快速切换制造落差笑点；
- 背景极简或留白，视觉重心全部聚焦于人物肢体互动与滑稽吐槽。`
        },
        ecchi: {
            name: '本子肉感 (Sensual & Ecchi)',
            instruction: `[SHOT-GRAMMAR: SENSUAL-ECCHI]
感官同人本分镜文法：
- 核心大画格完整呈现主互动、体位全貌与肢体纠缠；
- 边角紧贴嵌入局部极近特写小格（Insert Cut-in），收束视觉焦点至敏感接触部位或失神神态（flushed face, parted lips, heavy breathing）；
- 边框顺应身体曲线作动态贴合（body contour framing）；
- 密集拟音文字直接在格内生动展现。`
        }
    };

    const COMIC_GRAMMARS = GRAMMAR_PRESETS;

    const GRAMMAR_TAGS = {
        cinema: 'cinematic composition, dynamic angles',
        '4koma': '4koma, 4 panels, yonkoma',
        shonen: 'shonen manga, dynamic action, speed lines',
        mystery: 'seinen, suspense, dramatic shadows, tension',
        shojo: 'shojo manga, romantic atmosphere, expressive eyes',
        daily: 'slice of life, daily scene, relaxed composition',
        comedy: 'comedy, gag manga, exaggerated expression',
        ecchi: 'sensual manga, body contour framing'
    };

    const GUTTER_PRESETS = {
        bleed: {
            name: '天地出血 (Top-Bottom Bleed)',
            tag: 'white border, top-bottom bleed',
            instruction: `[GUTTER-BLEED: TOP-BOTTOM-BLEED]
天地出血：天头地脚贴边无白边，内框横纵格间距紧凑，关键画格允许单侧出血突破边框。`
        },
        framed: {
            name: '全封闭白边内枠 (Fully-Framed)',
            tag: 'white border, fully framed panels',
            instruction: `[GUTTER-BLEED: FULLY-FRAMED]
全封闭内枠：四周带经典漫画白边框架，格与格之间边界清晰分明。`
        },
        splash: {
            name: '沉浸全出血 (Immersive-Splash)',
            tag: '全面裁ち落とし, 余白なし',
            instruction: `[GUTTER-BLEED: IMMERSIVE-SPLASH]
沉浸全出血：整幅画格完全贴边撑满画面，极大增强画面代入感。`
        },
        black_line: {
            name: '纯黑线无白边 (Zero-White-Border)',
            tag: '太い黒い仕切り線, 余白なし',
            instruction: `[GUTTER-BLEED: ZERO-WHITE-BORDER]
全幅零白留白：画格之间无白色缝隙，画布边缘无外白边，完全由粗黑墨线（太い黒い仕切り線, 太いインクの枠, 余白なし, コマが密着）密着切分。`
        }
    };

    // ── 4. Prompt Assembly for SDT Tagger LLM ──────────────────────
    function buildMangaSystemPrompt(store) {
        const grammarObj = GRAMMAR_PRESETS[store.grammar] || GRAMMAR_PRESETS.cinema;
        const gutterObj = GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed;
        const langRule = store.language === 'ja'
            ? '[TEXT-LANG: JA]\n对白、心声、旁白与拟音文字一律转译为地道标准的日文，并在对应人物槽位末尾写入 Text: [日文文本]。'
            : '[TEXT-LANG: ZH-HANS]\n对白、心声、旁白与拟音文字一律写成简体中文，并在对应人物槽位末尾写入 Text: [中文文本]。';

        const gutterRule = gutterObj.instruction;

        const colorRule = (store.style === 'monochrome')
            ? `9. 色彩模式（来自原版 v1.1.json 条目 23 [COLOR-MODE: MONOCHROME]）：
- 当前处于黑白漫画模式：严禁在 scene、characters 的服装外貌或动作中输出任何具体彩色词；具体色相（青/茶/粉/赤/蓝/绿等）一律改写为 dark/light/white/black/gray 等灰阶明暗词。
- 每一页页面描述必须写上介质词：モノクロ, グレースケール, スクリーントーン。不要写 full color，不要写 warm light 等带色相的词。
- 各格只写所属场景的光源方向和明暗，不写环境色。\n`
            : (store.style === 'soft_color'
                ? `9. 色彩模式（来自原版 v1.1.json 条目 24 [COLOR-MODE: FULL-COLOR]）：
【全彩漫画继承规则】人物保持本轮已确定的发色、瞳色、服装与配饰颜色。新写视觉词优先使用有效英文标签，必要时使用简短英日短句。页面按实际场景使用 full color 及适用的光影视觉词。\n`
                : '');

        const antiHijackRule = store.antiHijack
            ? '10. 同人角色防夺舍（来自原版 v1.1.json 条目 27 [FAN-CHARACTER-UC]）：\n同人角色出场时，在其人物负面词中优先加入原作画师或原作作品标签，防止原作官方画风夺舍覆盖当前设定的画风；人物自身的正确角色特征保留在正面。\n'
            : '';

        return `【🎬 NovelAI Diffusion V5 漫画分镜导演规范】
你现在是专业漫画分镜导演（Comic Storyboard Director）。你的职责是将输入的剧情对话与小说场景，转译为高水准的 NovelAI V5 漫画分镜，指导生成具备原生日漫质感的分格漫画页。

[COMIC-DRAMATIC-PACING-AND-ANCHORS]
【🎬 漫画戏剧节拍与生图位置规划（来自原版 v1.1.json [PAGE CONTRACT: DYNAMIC EVENT-DRIVEN PAGES]）】
在提取分镜（segments）与选定生图位置（anchor.text）时，必须严格执行原版漫画事件驱动的节拍分析：
1. 剧情段落切分与节拍扫描：
   - 顺着正文时间线自上而下扫描，识别关键戏剧节拍（起 ➔ 承 ➔ 转 ➔ 合 / 对抗升级 ➔ 情绪激变 ➔ 高潮定格）；
   - 依据情节容量自适应决定生成分镜数量（若正文仅为单一动作瞬间则提取 1 个分镜；若包含多次转场、激烈互动或动作升级，则顺应节拍自然拆分为 2~4 个剧情分镜）；
   - 严禁偷懒只挑最后一句草草生成一张图！凡是出现重要造型亮点、攻守互换、情绪高光、关键转场的节点，均设立独立分镜；
2. 精准锚定正文位置（anchor.text）：
   - 每个分镜卡片的 anchor.text 必须一字不差截取正文中该视觉高光点发生的 10~40 字原句，使漫画卡片精准落位于剧情发生的那一刻，严禁错位或胡乱定位；
3. 逐页叙事使命明确：
   - 各分镜卡片之间焦点层次分明（如 分镜01 负责环境与初始互动，分镜02 负责冲突升级或局部特写，分镜03 负责情绪爆发或高潮定格）。

[PAGE-LAYOUT-RULES]
1. 页面形态与画格自适应规划（来自原版 v1.1.json [UNIVERSAL-KOMAWARI-GRAMMAR]）：
   - 普通分格页：依据台本事件量、戏剧冲突与台词多寡自适应规划画格数。由 1 个占据主视觉重心的核心主画格，搭配若干辅助画格（展现对峙反应、局部特写、环境交代或拟声词），严禁套用固定死板框架！
   - 普通分格页必须在 scene 字段明确写明总画格数与页面类型，例如: comic, 複数コマの漫画ページ, 4 panels（或 3 panels / 5 panels 等，依剧情实际画格数填写）, vertical layout, white border；
   - 若遇到宏大决战、广阔天地或全景展示，且剧情需要整页仅一格时，可规划为单格大画幅（splash page, 単一コマ）或横向跨页（見開きページ / double-page spread）。

2. 镜头文法与构图机位：
${grammarObj.instruction}
- 灵活运用英文 Danbooru 景别与机位词：close-up, medium shot, cowboy shot, full body, wide shot, from above, from below, dutch angle, looking at viewer, profile, dynamic angle。

3. 排版留白与出血：
${gutterRule}

4. 原生对白与气泡契约（来自原版 v1.1.json [BUBBLE-STYLES] & [TEXT-BUBBLE-CONTRACT]）：
- 语气与气泡外形严格对应：
  - 对白（平淡/日常） ➔ 标注 BubbleType: 通常吹き出し, Layout: 縦書き, Text: [原句]
  - 怒喊/惊呼/高声 ➔ 标注 BubbleType: 叫び吹き出し 或 ギザギザ吹き出し, Layout: 縦書き, Text: [原句]
  - 心理活动/心声 ➔ 标注 BubbleType: 思考の吹き出し, Layout: 縦書き, Text: [原句]
  - 耳语/心虚/远处 ➔ 标注 BubbleType: 破線吹き出し, Layout: 縦書き, Text: [原句]
  - 发颤/发虚/恐惧 ➔ 标注 BubbleType: 波打つ吹き出し, Layout: 縦書き, Text: [原句]
  - 机械音/电话/广播 ➔ 标注 BubbleType: 四角い吹き出し, Layout: 縦書き, Text: [原句]
  - 旁白或客观时空叙述 ➔ 标注 BubbleType: ナレーション枠, Layout: 横書き, Text: [原句]
  - 拟声拟态词 ➔ 标注 SFX: 擬音, 吹き出しなし, Text: [拟声词]
  - 画外对白（说话者在画面外） ➔ 标注 BubbleType: 切り欠きのある吹き出し, Layout: 縦書き, Text: [原句]
  - 画外音/独白/无尾气泡 ➔ 标注 BubbleType: しっぽなしの楕円吹き出し, Layout: 縦書き, Text: [原句]
  - 同一角色紧凑连续两句 ➔ 标注 BubbleType: 連結吹き出し, Layout: 縦書き, Text: [原句]
- 标点自动转译契约：
  - 「……」 ➔ 通常吹き出し
  - 「……！！」 ➔ 叫び吹き出し
  - *……* ➔ 思考の吹き出し
  - 【……】 ➔ SFX: 擬音, 吹き出しなし
  - {……} ➔ ナレーション枠（客观时空叙述）
- 台词排版默认采用日漫传统纵排（Layout: 縦書き），从右至左阅读；旁白采用横排（Layout: 横書き）。
- Text: 后直接跟台词原文，严禁外包任何引号或括号！Text: 内保留原句语言。

5. 台词原句与对话落格契约：
- 严格基于剧情正文中的真实台词提取，绝对禁止凭空捏造未发生的情节或虚构台词！
- 长句停顿拆分：若角色的一句话很长且有自然停顿，在同一个 Text: 后用换行分隔（例如: Text: 那个……\\n明天你有空吗？）。
- 修辞转实体：小说正文里的比喻描写在视觉描述中转换为 Danbooru 实体标签，但 Text: 中的台词原文完整保留修辞。

6. 拟声拟态词常用库 (SFX Guide)：
- 重击/落地/关门: SFX: 擬音, 吹き出しなし, Text: ドンッ
- 心跳/紧张/心动: SFX: 擬音, 吹き出しなし, Text: ドキドキ
- 闪亮/惊艳/可爱: SFX: 擬音, 吹き出しなし, Text: キラキラ
- 察觉/震惊/回头: SFX: 擬音, 吹き出しなし, Text: ハッ
- 气场/压迫感/杀气: SFX: 擬音, 吹き出しなし, Text: ゴゴゴ
- 碰撞/摔倒: SFX: 擬音, 吹き出しなし, Text: バタン

7. 多人同框防串色与差异化负面词 (Differential UC)：
- 每个角色描述使用无数字主体词（boy, girl, other），总人数词写在 scene 中；
- 若分镜内有多人，在角色的 uc (negative) 字段中写入其他角色的互斥外观特征（例如 A 是金发、B 是黑发，则 A 的 uc 写入 black hair，B 的 uc 写入 blonde hair），严防特征串位！

8. 语言规范：
${langRule}

${colorRule}

${antiHijackRule}
[JSON 输出字段映射规范 - 务必严格遵守 (Universal Komawari 规范)]
在漫画模式下，系统输出的每一个分镜卡片（segment）对应一整页分格漫画：

1. \`scene\` 字段（页面全局排版与环境）：
   - 必须以完整的漫画页面排版词开头，格式为：
     \`comic, 複数コマの漫画ページ, N panels (按实际规划画格数写如 3 panels / 4 panels / 5 panels), manga page layout, vertical layout, ${gutterObj.tag}, dynamic komawari, [本页纯客观环境描述如 classroom, sunset lighting / living room, couch, dramatic shadows]\`
   - ⛔【绝对禁止】：\`scene\` 字段只写排版和环境，严禁在 \`scene\` 中写入任何角色的动作、体位、接触、动物或对白拟声词！所有具体画格演出必须全部划分到下方的画格槽位（characters 数组）中！

2. \`characters\` 数组（逐画格演出槽位分配）：
   - 【核心铁律】：\`characters\` 数组中的每一项代表一个【独立画格 (Panel)】！数组长度必须严格等于本页规划的画格总数 N（例如规划了 3 panels，characters 数组必须恰好有 3 项：Panel 1、Panel 2、Panel 3）！
   - 每一格的 \`action\` 字段必须以【画格面积与构图类型】开头：
     * \`focal panel, medium shot\`（核心高潮主格，占据 35%~45% 大面积）
     * \`reaction panel, close-up\`（对手/旁人反应特写格）
     * \`small panel, looking down\`（局部动作/情绪转折小格）
     * \`wide shot, distant view\`（远景空镜格）
     * \`small panel, sound effects, SFX: 擬音, 吹き出しなし, Text: [拟声词]\`（独立拟声词格）
   - 紧随构图词后写入本格出场主体的动作与姿势；
   - 本格台词与心声：若本格有台词，追加在动作末尾：\`, BubbleType: [类型], Layout: 縦書き, Text: [台词原文]\`；若本格无台词则切勿添加 BubbleType 与 Text；
   - 每一格的 \`base\` 与 \`outfit\`：写入本格出场人物的外貌与穿搭。若本格为环境格或拟声词格，base 与 outfit 写 \`solo\` 或留空；
   - center 统一填写 \`C3\`（排版由画格关键词控制，无需手动计算坐标）。`;
    }

    // ── 5. Payload Sanitizer & Comic Assembler for NAI V5 ──────────
    function decolorizeTags(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/\b(blonde|blond|yellow)\s+hair\b/gi, 'light hair')
            .replace(/\b(brown|brunette|chestnut)\s+hair\b/gi, 'dark hair')
            .replace(/\b(pink|red|green|blue|purple|orange)\s+hair\b/gi, 'hair')
            .replace(/\b(blue|green|red|purple|yellow|amber|brown|pink)\s+eyes\b/gi, 'eyes')
            .replace(/\b(pink|red|blue|purple)\s+(eyeshadow|lipstick|makeup)\b/gi, '$2')
            .replace(/\b(pink|red|brown)\s+(nipples|areolae|areola|pussy|labia)\b/gi, '$2')
            .replace(/\bred[ _]soles\b/gi, 'dark soles')
            .replace(/\b(pink|red|blue|green|yellow|purple|orange)\s+(ribbon|bow|tie|scarf)\b/gi, '$2')
            .replace(/\b(pink|red|blue|green|yellow|purple|orange)\s+(dress|shirt|skirt|uniform|jacket|coat|sweater|panties|bra|pantyhose|socks|shoes|boots)\b/gi, '$2')
            .replace(/\b(color|colorful|vibrant|vivid|pastel|watercolor|rainbow)\b/gi, '')
            .replace(/,\s*,/g, ',')
            .replace(/^[\s,]+|[\s,]+$/g, '')
            .trim();
    }

    function recoverPanelFromBase(baseCaption) {
        if (!baseCaption || typeof baseCaption !== 'string') return { cleanBase: baseCaption, extraPanel: null };
        if (!/\b(?:BubbleType|SFX|Text)[ \t]*[:：]/i.test(baseCaption)) return { cleanBase: baseCaption, extraPanel: null };
        const match = baseCaption.match(/^(.*?)(?:,\s*)((?:(?:focal|reaction|small)\s+panel|\d+(?:dog|cat|boy|girl|man|woman|people|person|other)|wide shot|silhouette|close-up|medium shot|SFX[:：]|BubbleType[:：]).*?\b(?:BubbleType|SFX|Text)[ \t]*[:：].*)$/i);
        if (match) {
            return { cleanBase: match[1].trim(), extraPanel: match[2].trim() };
        }
        return { cleanBase: baseCaption, extraPanel: null };
    }

    function sanitizeMangaNegativePrompt(rawNegative) {
        if (!rawNegative) return '';
        // 关键防护：绝对不能在负面词里包含破坏分镜、气泡和网点的词汇！
        const forbiddenPatterns = [
            /\bcomic\b/gi,
            /\bcomic\s*panel(?:s)?\b/gi,
            /\bcomic\s*book\b/gi,
            /\bpanels\b/gi,
            /\b4koma\b/gi,
            /\b2koma\b/gi,
            /\bspeech\s*bubble\b/gi,
            /\bthought\s*bubble\b/gi,
            /\btext\b/gi,
            /\bscreentone\b/gi,
            /\bhalftone\b/gi,
            /\bdithering\b/gi,
            /\bmultiple\s*views\b/gi,
            /\bmultiple\s*scenes\b/gi,
            /\bsequence\b/gi,
            /\bborder\b/gi,
            /\bframe\b/gi,
            /\boutline\b/gi,
            /\bmargins\b/gi,
            /\bnegative\s*space\b/gi,
            /\bfurryFocus\b/gi
        ];
        let cleaned = rawNegative;
        forbiddenPatterns.forEach(pat => {
            cleaned = cleaned.replace(pat, '');
        });
        // 整理多余逗号和空白
        return cleaned.replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').trim();
    }

    let isStudioGenerating = false;
    let studioGenerationRatio = null;

    RBQ.on('buildNaiV4Payload', (payload) => {
        const store = getStore();
        if (!store.enabled && !isStudioGenerating) return payload;

        console.info(`[${PLUGIN_NAME}] 正在应用漫画模式 Payload 增强...`);

        // 工作台独立出图画幅尺寸覆盖
        if (isStudioGenerating && studioGenerationRatio && payload.parameters) {
            const [sw, sh] = studioGenerationRatio.split('x').map(Number);
            if (sw && sh) {
                payload.parameters.width = sw;
                payload.parameters.height = sh;
            }
        }

        // 1. 获取选中的漫画画风
        let styleObj = COMIC_STYLES[store.style] || COMIC_STYLES.monochrome;
        let stylePositive = store.style === 'custom' ? (store.customPositive || '') : styleObj.positive;
        let styleNegative = store.style === 'custom' ? (store.customNegative || '') : styleObj.negative;

        // 2. 负面词净化：剔除抑制分镜与文字的词
        let currentNeg = payload.parameters?.negative_prompt || '';
        let cleanedNeg = sanitizeMangaNegativePrompt(currentNeg);
        if (styleNegative) {
            cleanedNeg = [cleanedNeg, styleNegative].filter(Boolean).join(', ');
        }
        if (payload.parameters) {
            payload.parameters.negative_prompt = cleanedNeg;
            if (payload.parameters.v4_negative_prompt?.caption) {
                payload.parameters.v4_negative_prompt.caption.base_caption = cleanedNeg;
                // 净化每一个角色的负面词
                if (Array.isArray(payload.parameters.v4_negative_prompt.caption.char_captions)) {
                    payload.parameters.v4_negative_prompt.caption.char_captions.forEach(cc => {
                        if (cc && cc.char_caption) {
                            cc.char_caption = sanitizeMangaNegativePrompt(cc.char_caption);
                        }
                    });
                }
            }
        }

        // 3. 智能横向跨页检测 (見開きページ)
        const rawBase = payload.parameters?.v4_prompt?.caption?.base_caption || payload.input || '';
        const isDoubleSpread = /(?:見開きページ|2ページ見開き|見開き)|(?:double-page spread|2-page spread|wide spread)/i.test(rawBase);
        if (store.autoSpread && isDoubleSpread) {
            const w = payload.parameters?.width || 832;
            const h = payload.parameters?.height || 1216;
            if (w < h) {
                payload.parameters.width = h;
                payload.parameters.height = w;
                console.info(`[${PLUGIN_NAME}] 检测到横向大跨页 (見開き)，自动对调尺寸为: ${h}×${w}`);
                toastr.info(`检测到横向跨页分镜，已自动翻转为宽幅画幅 (${h}×${w})`, PLUGIN_NAME);
            }
        }

        // 4. 正面画风拼接
        if (stylePositive) {
            if (payload.input && !payload.input.includes(stylePositive)) {
                payload.input = `${stylePositive}, ${payload.input}`;
            }
            if (payload.parameters?.v4_prompt?.caption?.base_caption && !payload.parameters.v4_prompt.caption.base_caption.includes(stylePositive)) {
                payload.parameters.v4_prompt.caption.base_caption = `${stylePositive}, ${payload.parameters.v4_prompt.caption.base_caption}`;
            }
        }

        // 5. 确保模型版本锁定在支持漫画文字的 NAI V5 Full
        if (payload.parameters && (!payload.parameters.model || !payload.parameters.model.includes('nai-diffusion-5'))) {
            payload.parameters.model = 'nai-diffusion-5-full';
        }

        // 6. 核心画格重组与兜底保护 (Universal Komawari Assembler)
        if (payload.parameters?.v4_prompt?.caption) {
            const v4Prompt = payload.parameters.v4_prompt.caption;
            const baseText = v4Prompt.base_caption || payload.input || '';

            // 6.1 若 char_captions 为空但输入中包含 | 或 Text:，按 | 分割出各格
            if (!Array.isArray(v4Prompt.char_captions) || v4Prompt.char_captions.length === 0) {
                if (/\b(?:BubbleType|SFX|Text)[ \t]*[:：]/i.test(baseText)) {
                    const segments = baseText.split(/\s*\|\s*/);
                    if (segments.length > 1) {
                        v4Prompt.base_caption = segments[0];
                        v4Prompt.char_captions = segments.slice(1).map(seg => ({
                            char_caption: seg,
                            centers: [{ x: 0.5, y: 0.5 }]
                        }));
                        if (payload.parameters.v4_negative_prompt?.caption) {
                            payload.parameters.v4_negative_prompt.caption.char_captions = segments.slice(1).map(() => ({
                                char_caption: '',
                                centers: [{ x: 0.5, y: 0.5 }]
                            }));
                        }
                        console.info(`[${PLUGIN_NAME}] 自动从提示词 | 中分离出 ${segments.length - 1} 个漫画画格槽位`);
                    }
                }
            } else {
                // 6.2 若 char_captions 已经存在，但 base_caption 仍夹带了带 Text/SFX 的动作格，自动剥离还原入 char_captions
                const recovered = recoverPanelFromBase(v4Prompt.base_caption);
                if (recovered.extraPanel) {
                    v4Prompt.base_caption = recovered.cleanBase;
                    v4Prompt.char_captions.unshift({
                        char_caption: recovered.extraPanel,
                        centers: [{ x: 0.5, y: 0.5 }]
                    });
                    if (Array.isArray(payload.parameters.v4_negative_prompt?.caption?.char_captions)) {
                        payload.parameters.v4_negative_prompt.caption.char_captions.unshift({
                            char_caption: '',
                            centers: [{ x: 0.5, y: 0.5 }]
                        });
                    }
                    console.info(`[${PLUGIN_NAME}] 成功从 base_caption 剥离并回填首个画格槽位 (Panel 1)`);
                }
            }

            // 6.3 确保 base_caption 带有 dynamic komawari 与 manga page layout
            if (v4Prompt.base_caption && !/dynamic komawari/i.test(v4Prompt.base_caption)) {
                if (/(?:vertical layout|white border|複数コマの漫画ページ)/i.test(v4Prompt.base_caption)) {
                    v4Prompt.base_caption = v4Prompt.base_caption.replace(
                        /(?:vertical layout|white border|複数コマの漫画ページ)/i,
                        '$&, manga page layout, dynamic komawari'
                    );
                } else {
                    const layoutTag = isDoubleSpread ? 'wide spread' : 'vertical layout';
                    const gutterObj = GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed;
                    const gutterTag = gutterObj.tag;
                    v4Prompt.base_caption = `comic, 複数コマの漫画ページ, manga page layout, ${layoutTag}, ${gutterTag}, dynamic komawari, ${v4Prompt.base_caption}`;
                }
            }
        }

        // 7. ⛔ 强制解除 2D 坐标束缚，全面切换为漫画画格流 (use_coords: false, use_order: true)
        if (payload.parameters?.v4_prompt) {
            payload.parameters.v4_prompt.use_coords = false;
            payload.parameters.v4_prompt.use_order = true;
            if (Array.isArray(payload.parameters.v4_prompt.caption?.char_captions)) {
                payload.parameters.v4_prompt.caption.char_captions.forEach(cc => {
                    cc.centers = [{ x: 0.5, y: 0.5 }];
                });
            }
        }

        // 8. 🎨 黑白漫画严格脱色净化 (彻底消除角色卡/世界书带入的颜色污染)
        const isMonochrome = (store.style === 'monochrome');
        if (isMonochrome) {
            if (payload.parameters?.v4_prompt?.caption) {
                const v4Prompt = payload.parameters.v4_prompt.caption;
                if (v4Prompt.base_caption) {
                    v4Prompt.base_caption = decolorizeTags(v4Prompt.base_caption);
                }
                if (Array.isArray(v4Prompt.char_captions)) {
                    v4Prompt.char_captions.forEach(cc => {
                        if (cc && cc.char_caption) {
                            cc.char_caption = decolorizeTags(cc.char_caption);
                        }
                    });
                }
            }
            if (payload.input) {
                payload.input = decolorizeTags(payload.input);
            }

            // 在所有画格负面词中强制注入色彩抑制契约
            const COLOR_UC = '10::color::, colorful, vibrant colors, painted, watercolor, pastel, 3D, realistic photo';
            if (payload.parameters?.v4_negative_prompt?.caption) {
                const negPrompt = payload.parameters.v4_negative_prompt.caption;
                if (negPrompt.base_caption && !negPrompt.base_caption.includes('color::')) {
                    negPrompt.base_caption = [negPrompt.base_caption, COLOR_UC].filter(Boolean).join(', ');
                }
                if (Array.isArray(negPrompt.char_captions)) {
                    negPrompt.char_captions.forEach(cc => {
                        if (cc && typeof cc === 'object') {
                            cc.centers = [{ x: 0.5, y: 0.5 }];
                            if (!cc.char_caption || !cc.char_caption.includes('color::')) {
                                cc.char_caption = [sanitizeMangaNegativePrompt(cc.char_caption || ''), COLOR_UC].filter(Boolean).join(', ');
                            }
                        }
                    });
                }
            }
        }

        return payload;
    });

    // ── 6. UI Injection into Smart Draw Trigger (SDT) ──────────────
    const STYLE_TAG_ID = 'rbq-manga-mode-style';

    function injectStyles() {
        if (document.getElementById(STYLE_TAG_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_TAG_ID;
        style.textContent = `
        /* 漫画模式专属样式 */
        .rbq-manga-toggle-card {
            background: linear-gradient(135deg, rgba(255, 140, 0, 0.08), rgba(255, 80, 0, 0.03)) !important;
            border: 1px solid rgba(255, 160, 60, 0.3) !important;
            border-radius: 14px !important;
            padding: 12px 14px !important;
            margin-top: 10px !important;
            margin-bottom: 12px !important;
            box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
            transition: all 0.25s ease !important;
        }
        .rbq-manga-toggle-card.active {
            border-color: rgba(255, 160, 60, 0.6) !important;
            box-shadow: 0 0 20px rgba(255, 140, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
            background: linear-gradient(135deg, rgba(255, 140, 0, 0.12), rgba(255, 60, 0, 0.05)) !important;
        }
        .rbq-manga-header-bar {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 10px !important;
            cursor: pointer !important;
            user-select: none !important;
        }
        .rbq-manga-title-wrap {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            color: #ffbe76 !important;
        }
        .rbq-manga-title-wrap i {
            font-size: 15px !important;
            color: #ff9f43 !important;
        }
        .rbq-manga-badge {
            font-size: 10px !important;
            font-weight: 700 !important;
            letter-spacing: 0.5px !important;
            padding: 2px 7px !important;
            border-radius: 999px !important;
            background: linear-gradient(135deg, #ff9f43, #ee5253) !important;
            color: #fff !important;
            box-shadow: 0 2px 8px rgba(238, 82, 83, 0.4) !important;
        }

        /* 漫画模式专属开关按钮 */
        .rbq-manga-switch {
            position: relative !important;
            display: inline-block !important;
            width: 44px !important;
            height: 24px !important;
            cursor: pointer !important;
            user-select: none !important;
            flex-shrink: 0 !important;
        }
        .rbq-manga-switch input {
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            position: absolute !important;
            margin: 0 !important;
            pointer-events: none !important;
        }
        .rbq-manga-slider {
            position: absolute !important;
            cursor: pointer !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background-color: rgba(255, 255, 255, 0.15) !important;
            transition: all 0.25s ease !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3) !important;
        }
        .rbq-manga-slider::before {
            position: absolute !important;
            content: "" !important;
            height: 18px !important;
            width: 18px !important;
            left: 2px !important;
            bottom: 2px !important;
            background-color: #ffffff !important;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
            border-radius: 50% !important;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35) !important;
        }
        .rbq-manga-switch input:checked + .rbq-manga-slider {
            background: linear-gradient(135deg, #ff9f43, #ee5253) !important;
            border-color: rgba(255, 159, 67, 0.6) !important;
            box-shadow: 0 0 12px rgba(255, 159, 67, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2) !important;
        }
        .rbq-manga-switch input:checked + .rbq-manga-slider::before {
            transform: translateX(20px) !important;
        }

        .rbq-manga-subpanel {
            margin-top: 12px !important;
            padding-top: 12px !important;
            border-top: 1px dashed rgba(255, 180, 100, 0.25) !important;
            flex-direction: column !important;
            gap: 10px !important;
            animation: rbqMangaFadeIn 0.25s ease-out !important;
        }
        .rbq-manga-toggle-card:not(.active) .rbq-manga-subpanel {
            display: none !important;
        }
        .rbq-manga-toggle-card.active .rbq-manga-subpanel {
            display: flex !important;
        }
        @keyframes rbqMangaFadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .rbq-manga-grid-2 {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 10px !important;
        }
        @media (max-width: 600px) {
            .rbq-manga-grid-2 {
                grid-template-columns: 1fr !important;
            }
        }
        .rbq-manga-field {
            display: flex !important;
            flex-direction: column !important;
            gap: 5px !important;
        }
        .rbq-manga-field span {
            font-size: 12px !important;
            color: rgba(255, 255, 255, 0.85) !important;
            font-weight: 500 !important;
        }
        .rbq-manga-field select, .rbq-manga-field textarea {
            width: 100% !important;
            box-sizing: border-box !important;
            padding: 6px 10px !important;
            border-radius: 8px !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            background: rgba(15, 20, 32, 0.85) !important;
            color: #fff !important;
            font-size: 12px !important;
            outline: none !important;
            transition: border-color 0.2s !important;
        }
        .rbq-manga-field select:focus, .rbq-manga-field textarea:focus {
            border-color: #ff9f43 !important;
        }
        .rbq-manga-desc {
            font-size: 11px !important;
            color: rgba(255, 210, 160, 0.7) !important;
            margin-top: 2px !important;
            line-height: 1.4 !important;
        }
        .rbq-manga-checks {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 14px !important;
            margin-top: 4px !important;
        }
        .rbq-manga-check-item {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            font-size: 12px !important;
            color: rgba(255, 255, 255, 0.85) !important;
            cursor: pointer !important;
            user-select: none !important;
        }
        .rbq-manga-check-item input[type="checkbox"] {
            accent-color: #ff9f43 !important;
            width: 14px !important;
            height: 14px !important;
            cursor: pointer !important;
        }
        /* 当漫画模式激活时，原有预设下拉框锁定置灰 */
        .rbq-sdt-preset-locked {
            opacity: 0.45 !important;
            pointer-events: none !important;
            filter: grayscale(80%) !important;
            transition: all 0.2s ease !important;
            position: relative !important;
        }
        .rbq-sdt-preset-lock-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            font-size: 11px !important;
            color: #ff9f43 !important;
            background: rgba(255, 159, 67, 0.15) !important;
            border: 1px solid rgba(255, 159, 67, 0.35) !important;
            padding: 1px 6px !important;
            border-radius: 6px !important;
            margin-left: 6px !important;
            font-weight: 500 !important;
        }

        /* ════════════ 漫画工作台 (Manga Studio) 样式 ════════════ */
        .mw-wrap {
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            max-width: 100% !important;
            height: 100% !important;
            color: #f1f5f9 !important;
            background: #0d1019 !important;
            font-family: inherit !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
        }
        .mw-hdr {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 10px 16px !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(18, 22, 34, 0.95) !important;
            backdrop-filter: blur(12px) !important;
            gap: 12px !important;
            flex-wrap: wrap !important;
            flex-shrink: 0 !important;
            box-sizing: border-box !important;
        }
        .mw-brand {
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            flex-shrink: 0 !important;
        }
        .mw-logo {
            width: 34px !important;
            height: 34px !important;
            border-radius: 9px !important;
            background: linear-gradient(135deg, #f59e0b, #d97706) !important;
            color: #000 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 16px !important;
            box-shadow: 0 2px 10px rgba(245, 158, 11, 0.3) !important;
        }
        .mw-title-box {
            display: flex !important;
            flex-direction: column !important;
            gap: 1px !important;
        }
        .mw-title {
            font-size: 14px !important;
            font-weight: 700 !important;
            color: #fff !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
        }
        .mw-badge {
            font-size: 10px !important;
            font-weight: 700 !important;
            padding: 1px 6px !important;
            border-radius: 999px !important;
            background: rgba(245, 158, 11, 0.18) !important;
            color: #fcd34d !important;
            border: 1px solid rgba(245, 158, 11, 0.35) !important;
        }
        .mw-subtitle {
            font-size: 11px !important;
            color: #94a3b8 !important;
        }
        .mw-hdr-controls {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            flex-wrap: wrap !important;
        }
        .mw-control-group {
            display: flex !important;
            align-items: center !important;
            background: rgba(0, 0, 0, 0.35) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 7px !important;
            padding: 3px 8px !important;
            gap: 6px !important;
            font-size: 11.5px !important;
        }
        .mw-control-group label {
            color: #94a3b8 !important;
            display: flex !important;
            align-items: center !important;
            gap: 4px !important;
            font-weight: 500 !important;
            white-space: nowrap !important;
        }
        .mw-sel, .mw-in, .mw-ta {
            background: transparent !important;
            color: #fff !important;
            border: none !important;
            font-size: 12px !important;
            outline: none !important;
            font-family: inherit !important;
        }
        .mw-sel {
            cursor: pointer !important;
        }
        .mw-sel option {
            background: #181b26 !important;
            color: #fff !important;
        }
        /* 按钮宿主防御 */
        .mw-btn {
            display: inline-flex !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            white-space: nowrap !important;
            box-sizing: border-box !important;
            flex-shrink: 0 !important;
            user-select: none !important;
            cursor: pointer !important;
            font-family: inherit !important;
            font-weight: 600 !important;
            border-radius: 7px !important;
            border: 1px solid transparent !important;
            padding: 5px 11px !important;
            font-size: 12px !important;
            transition: all 0.15s ease !important;
            text-decoration: none !important;
            background: rgba(255, 255, 255, 0.08) !important;
            color: #fff !important;
            min-height: 32px !important;
        }
        .mw-btn:hover {
            filter: brightness(1.15) !important;
        }
        .mw-btn:active {
            transform: scale(0.98) !important;
        }
        .mw-btn:disabled {
            opacity: 0.5 !important;
            cursor: not-allowed !important;
            pointer-events: none !important;
        }
        .mw-btn.pri {
            background: linear-gradient(135deg, #f59e0b, #d97706) !important;
            color: #000 !important;
            font-weight: 700 !important;
            box-shadow: 0 2px 10px rgba(245, 158, 11, 0.3) !important;
        }
        .mw-btn.cy {
            background: rgba(99, 102, 241, 0.16) !important;
            border-color: rgba(99, 102, 241, 0.4) !important;
            color: #a5b4fc !important;
        }
        .mw-btn.gn {
            background: rgba(16, 185, 129, 0.16) !important;
            border-color: rgba(16, 185, 129, 0.4) !important;
            color: #6ee7b7 !important;
        }
        .mw-btn.am {
            background: rgba(245, 158, 11, 0.16) !important;
            border-color: rgba(245, 158, 11, 0.4) !important;
            color: #fcd34d !important;
        }
        .mw-btn.rd {
            background: rgba(239, 68, 68, 0.16) !important;
            border-color: rgba(239, 68, 68, 0.4) !important;
            color: #fca5a5 !important;
        }
        .mw-btn.sm {
            padding: 3px 8px !important;
            font-size: 11px !important;
            min-height: 26px !important;
        }
        .mw-btn.lg {
            padding: 10px 16px !important;
            font-size: 13.5px !important;
            font-weight: 800 !important;
            min-height: 42px !important;
            border-radius: 9px !important;
        }
        /* 主体双栏拓扑 */
        .mw-body {
            flex: 1 !important;
            display: grid !important;
            grid-template-columns: minmax(0, 7.2fr) minmax(0, 4.8fr) !important;
            gap: 14px !important;
            padding: 14px !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
        }
        @media (max-width: 960px) {
            .mw-body {
                grid-template-columns: 1fr !important;
            }
        }
        .mw-left-pane, .mw-right-pane {
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
            min-width: 0 !important;
        }
        .mw-card {
            background: rgba(24, 28, 42, 0.65) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 11px !important;
            padding: 12px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 9px !important;
            box-sizing: border-box !important;
        }
        .mw-card-hd {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
            flex-wrap: wrap !important;
        }
        .mw-card-tt {
            font-size: 12.5px !important;
            font-weight: 700 !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
            color: #e2e8f0 !important;
        }
        .mw-card-actions {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            flex-wrap: wrap !important;
        }
        .mw-story-card textarea {
            width: 100% !important;
            min-height: 64px !important;
            background: rgba(12, 15, 24, 0.8) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 8px !important;
            color: #fff !important;
            padding: 8px 10px !important;
            font-size: 12px !important;
            line-height: 1.5 !important;
            resize: vertical !important;
            box-sizing: border-box !important;
            outline: none !important;
            transition: border-color 0.2s !important;
        }
        .mw-story-card textarea:focus {
            border-color: #f59e0b !important;
        }
        .mw-story-ft {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 10px !important;
            flex-wrap: wrap !important;
        }
        .mw-opts {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            font-size: 11.5px !important;
            color: #94a3b8 !important;
        }
        .mw-chk-lbl {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            cursor: pointer !important;
            user-select: none !important;
        }
        .mw-chk-lbl input {
            accent-color: #f59e0b !important;
        }
        /* 画格序列卡片流 */
        .mw-panels-list {
            display: flex !important;
            flex-direction: column !important;
            gap: 9px !important;
        }
        .mw-panel-card {
            background: rgba(15, 18, 28, 0.75) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 9px !important;
            padding: 10px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            transition: border-color 0.15s ease !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
        }
        .mw-panel-card:hover {
            border-color: rgba(245, 158, 11, 0.4) !important;
        }
        .mw-panel-hd {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 6px !important;
            width: 100% !important;
            min-width: 0 !important;
        }
        .mw-panel-info {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            flex: 1 1 auto !important;
            min-width: 0 !important;
            overflow: hidden !important;
        }
        .mw-panel-num {
            width: 22px !important;
            height: 22px !important;
            border-radius: 5px !important;
            background: rgba(245, 158, 11, 0.2) !important;
            color: #fcd34d !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex-shrink: 0 !important;
        }
        .mw-panel-title-in {
            background: transparent !important;
            border: 1px solid transparent !important;
            color: #fff !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            padding: 2px 4px !important;
            border-radius: 4px !important;
            flex: 0 1 120px !important;
            min-width: 45px !important;
            max-width: 130px !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            box-sizing: border-box !important;
        }
        .mw-panel-title-in:focus {
            background: rgba(0, 0, 0, 0.4) !important;
            border-color: rgba(255, 255, 255, 0.2) !important;
        }
        .mw-panel-shot-sel {
            background: rgba(0, 0, 0, 0.4) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            color: #a5b4fc !important;
            font-size: 11px !important;
            padding: 2px 6px !important;
            border-radius: 5px !important;
            cursor: pointer !important;
            flex: 1 1 130px !important;
            min-width: 80px !important;
            max-width: 165px !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            box-sizing: border-box !important;
        }
        .mw-panel-btns {
            display: flex !important;
            align-items: center !important;
            gap: 3px !important;
            flex-shrink: 0 !important;
            margin-left: auto !important;
        }
        .mw-panel-btns .mw-btn {
            width: 24px !important;
            height: 24px !important;
            padding: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-height: unset !important;
            flex-shrink: 0 !important;
            font-size: 10px !important;
        }
        .mw-panel-desc-row {
            display: flex !important;
            gap: 6px !important;
            align-items: center !important;
            width: 100% !important;
            min-width: 0 !important;
        }
        .mw-panel-desc-in {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            background: rgba(0, 0, 0, 0.45) !important;
            border: 1px solid rgba(245, 158, 11, 0.35) !important;
            border-radius: 6px !important;
            color: #fef08a !important;
            padding: 5px 8px !important;
            font-size: 11.5px !important;
            box-sizing: border-box !important;
            outline: none !important;
            transition: border-color 0.2s, background-color 0.2s !important;
        }
        .mw-panel-desc-in:focus {
            border-color: #f59e0b !important;
            background: rgba(0, 0, 0, 0.65) !important;
            box-shadow: 0 0 8px rgba(245, 158, 11, 0.2) !important;
        }
        .mw-panel-ai-single {
            white-space: nowrap !important;
            flex-shrink: 0 !important;
        }
        .mw-panel-tag-in {
            width: 100% !important;
            background: rgba(0, 0, 0, 0.35) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 6px !important;
            color: #cbd5e1 !important;
            padding: 5px 8px !important;
            font-size: 11px !important;
            font-family: monospace !important;
            box-sizing: border-box !important;
            outline: none !important;
        }
        .mw-panel-tag-in:focus {
            border-color: #f59e0b !important;
        }
        .mw-bubble-row {
            display: grid !important;
            grid-template-columns: 140px 1fr 70px !important;
            gap: 6px !important;
            background: rgba(0, 0, 0, 0.25) !important;
            padding: 6px !important;
            border-radius: 6px !important;
            border: 1px solid rgba(255, 255, 255, 0.05) !important;
            align-items: center !important;
        }
        @media (max-width: 600px) {
            .mw-bubble-row {
                grid-template-columns: 1fr 1fr !important;
            }
        }
        .mw-bubble-type-sel, .mw-bubble-dir-sel {
            background: rgba(0, 0, 0, 0.4) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            color: #fff !important;
            font-size: 11px !important;
            padding: 3px 5px !important;
            border-radius: 4px !important;
        }
        .mw-bubble-text-in {
            background: rgba(0, 0, 0, 0.4) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            color: #fff !important;
            font-size: 11.5px !important;
            padding: 3px 8px !important;
            border-radius: 4px !important;
            width: 100% !important;
            box-sizing: border-box !important;
        }
        .mw-bubble-text-in:focus {
            border-color: #f59e0b !important;
        }
        /* 组装提示词预览 */
        .mw-code-block {
            background: #090b11 !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 7px !important;
            padding: 8px 10px !important;
            font-family: monospace !important;
            font-size: 11px !important;
            line-height: 1.5 !important;
            color: #94a3b8 !important;
            max-height: 90px !important;
            overflow-y: auto !important;
            word-break: break-all !important;
            user-select: text !important;
        }
        /* 右侧画布与出图控制 */
        .mw-canvas-wrapper {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 8px 0 !important;
        }
        .mw-canvas-viewport {
            width: 100% !important;
            max-width: 320px !important;
            aspect-ratio: 832 / 1216 !important;
            background: #05070a !important;
            border: 3px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            position: relative !important;
            box-shadow: 0 8px 26px rgba(0, 0, 0, 0.7) !important;
        }
        .mw-canvas-viewport img {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
            cursor: zoom-in !important;
        }
        .mw-blueprint-placeholder {
            width: 100% !important;
            height: 100% !important;
            display: flex !important;
            flex-direction: column !important;
            padding: 10px !important;
            gap: 6px !important;
            box-sizing: border-box !important;
            background: repeating-linear-gradient(45deg, rgba(255,255,255,0.015), rgba(255,255,255,0.015) 10px, transparent 10px, transparent 20px) !important;
        }
        .mw-bp-panel {
            flex: 1 !important;
            border: 1.5px dashed rgba(255, 255, 255, 0.18) !important;
            border-radius: 4px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            color: rgba(255, 255, 255, 0.3) !important;
            font-size: 11px !important;
            font-family: monospace !important;
            background: rgba(255, 255, 255, 0.02) !important;
        }
        .mw-gen-box {
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            margin-top: 4px !important;
        }
        .mw-action-row {
            display: grid !important;
            grid-template-columns: 1fr 1fr 1fr !important;
            gap: 6px !important;
        }
        /* 查看器与预设模态框 */
        .mw-modal-mask {
            position: fixed !important;
            inset: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 2147483640 !important;
            background: rgba(7, 9, 15, 0.94) !important;
            backdrop-filter: blur(12px) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 16px !important;
            box-sizing: border-box !important;
        }
        .mw-viewer-box, .mw-preset-box {
            background: #141724 !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 12px !important;
            display: flex !important;
            flex-direction: column !important;
            max-width: 90vw !important;
            max-height: 90vh !important;
            overflow: hidden !important;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8) !important;
        }
        .mw-viewer-box {
            width: 580px !important;
        }
        .mw-preset-box {
            width: 480px !important;
        }
        .mw-viewer-hd, .mw-preset-hd {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 10px 14px !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            font-size: 13px !important;
            font-weight: 700 !important;
            color: #fff !important;
        }
        .mw-viewer-body {
            flex: 1 !important;
            overflow: hidden !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 10px !important;
            background: #000 !important;
        }
        .mw-viewer-body img {
            max-width: 100% !important;
            max-height: 65vh !important;
            object-fit: contain !important;
            border-radius: 6px !important;
        }
        .mw-viewer-ft {
            padding: 10px 14px !important;
            border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
        }
        .mw-preset-list {
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            padding: 14px !important;
            max-height: 65vh !important;
            overflow-y: auto !important;
        }
        .mw-preset-item {
            background: rgba(255, 255, 255, 0.04) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 8px !important;
            padding: 10px !important;
            cursor: pointer !important;
            transition: all 0.15s ease !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 4px !important;
        }
        .mw-preset-item:hover {
            border-color: #f59e0b !important;
            background: rgba(245, 158, 11, 0.08) !important;
        }
        .mw-preset-title {
            font-size: 12.5px !important;
            font-weight: 700 !important;
            color: #fcd34d !important;
        }
        .mw-preset-desc {
            font-size: 11px !important;
            color: #94a3b8 !important;
            line-height: 1.4 !important;
        }
        `;
        (document.head || document.documentElement || document.body)?.appendChild(style);
    }

    function syncMangaToSdt(store, shouldSave = true) {
        const sdtStore = getSdtStore();
        if (store.enabled) {
            // 备份原有的预设状态
            if (sdtStore.systemPromptPreset && sdtStore.systemPromptPreset !== 'custom') {
                sdtStore._mangaSavedPreset = sdtStore.systemPromptPreset;
            }
            if (sdtStore.customSystemPrompt && sdtStore.systemPromptPreset === 'custom' && !sdtStore._mangaActive) {
                sdtStore._mangaSavedCustomPrompt = sdtStore.customSystemPrompt;
            }
            // 备份并锁定前情增强分析 (锁定至 v_manga 动态事件驱动推演，原版条目33)
            if (sdtStore.enhancedContext && !sdtStore._mangaActive) {
                sdtStore._mangaSavedEnhancedContext = sdtStore.enhancedContext;
            }
            sdtStore.enhancedContext = 'v_manga';
            // 自动开启多角色独立生图以确保 char_captions 注入
            if (sdtStore.multiCharOutput === false) {
                sdtStore._mangaSavedMultiChar = false;
                sdtStore.multiCharOutput = true;
            }
            if (sdtStore.multiCharUseCoords && !sdtStore._mangaActive) {
                sdtStore._mangaSavedMultiCharCoords = sdtStore.multiCharUseCoords;
            }
            sdtStore.multiCharUseCoords = false;
            sdtStore._mangaActive = true;
            sdtStore.systemPromptPreset = 'custom';
            sdtStore.customSystemPrompt = buildMangaSystemPrompt(store);
            sdtStore.systemPrompt = sdtStore.customSystemPrompt;
        } else {
            if (sdtStore._mangaActive) {
                sdtStore._mangaActive = false;
                sdtStore.systemPromptPreset = sdtStore._mangaSavedPreset || 'v40_worldbook_97_opt';
                sdtStore.customSystemPrompt = sdtStore._mangaSavedCustomPrompt || '';
                if (sdtStore._mangaSavedEnhancedContext) {
                    sdtStore.enhancedContext = sdtStore._mangaSavedEnhancedContext;
                    delete sdtStore._mangaSavedEnhancedContext;
                } else if (sdtStore.enhancedContext === 'v_manga') {
                    sdtStore.enhancedContext = 'v13';
                }
                if (typeof sdtStore._mangaSavedMultiChar === 'boolean') {
                    sdtStore.multiCharOutput = sdtStore._mangaSavedMultiChar;
                    delete sdtStore._mangaSavedMultiChar;
                }
                if (typeof sdtStore._mangaSavedMultiCharCoords === 'boolean') {
                    sdtStore.multiCharUseCoords = sdtStore._mangaSavedMultiCharCoords;
                    delete sdtStore._mangaSavedMultiCharCoords;
                }
                delete sdtStore._mangaSavedPreset;
                delete sdtStore._mangaSavedCustomPrompt;
            }
        }
        if (shouldSave) {
            save();
        }
    }

    function updateUiState() {
        const store = getStore();
        const card = document.getElementById('rbq-manga-mode-card');
        const subpanel = document.getElementById('rbq-manga-mode-subpanel');
        const enabledCheck = document.getElementById('rbq-manga-mode-enabled');
        const sysPresetSelect = document.getElementById('rbq-sdt-system-preset');
        const sysPresetField = sysPresetSelect ? sysPresetSelect.closest('.st-scene-trigger-field') : null;
        const customPromptField = document.getElementById('rbq-sdt-system-prompt-field');

        if (enabledCheck && enabledCheck.checked !== !!store.enabled) {
            enabledCheck.checked = !!store.enabled;
        }
        if (card) {
            card.classList.toggle('active', !!store.enabled);
        }
        if (subpanel) {
            const targetDisplay = store.enabled ? 'flex' : 'none';
            if (subpanel.style.display !== targetDisplay) {
                subpanel.style.display = targetDisplay;
            }
        }

        // 锁定/解锁原提示词预设
        if (sysPresetSelect && sysPresetField) {
            if (store.enabled) {
                if (sysPresetSelect.value !== 'custom') sysPresetSelect.value = 'custom';
                sysPresetSelect.disabled = true;
                sysPresetField.classList.add('rbq-sdt-preset-locked');
                let badge = sysPresetField.querySelector('.rbq-sdt-preset-lock-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'rbq-sdt-preset-lock-badge';
                    badge.innerHTML = '<i class="fa-solid fa-lock"></i> 漫画模式接管中';
                    const titleSpan = sysPresetField.querySelector('span');
                    if (titleSpan) titleSpan.appendChild(badge);
                }
                if (customPromptField && customPromptField.style.display !== 'none') {
                    customPromptField.style.display = 'none';
                }
            } else {
                const sdtStore = getSdtStore();
                const expectedPreset = sdtStore.systemPromptPreset || 'v40_worldbook_97_opt';
                if (sysPresetSelect.value !== expectedPreset) {
                    sysPresetSelect.value = expectedPreset;
                }
                sysPresetSelect.disabled = false;
                sysPresetField.classList.remove('rbq-sdt-preset-locked');
                const badge = sysPresetField.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
                if (customPromptField && sysPresetSelect.value === 'custom') {
                    if (customPromptField.style.display === 'none') {
                        customPromptField.style.display = '';
                    }
                }
            }
        }

        // 锁定/解锁前情增强分析 (锁定至 v_manga 动态事件驱动推演，原版条目33)
        const ecSelect = document.getElementById('rbq-sdt-enhanced-context');
        const ecField = ecSelect ? ecSelect.closest('.st-scene-trigger-field') : null;
        if (ecSelect && ecField) {
            // 防御性补齐：若 DOM 选项中尚未包含 v_manga，自动动态追加
            if (!ecSelect.querySelector('option[value="v_manga"]')) {
                const opt = document.createElement('option');
                opt.value = 'v_manga';
                opt.textContent = '漫画 · 动态事件驱动推演 (原版条目33)';
                ecSelect.appendChild(opt);
            }
            if (store.enabled) {
                if (ecSelect.value !== 'v_manga') ecSelect.value = 'v_manga';
                ecSelect.disabled = true;
                ecField.classList.add('rbq-sdt-preset-locked');
                let badge = ecField.querySelector('.rbq-sdt-preset-lock-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'rbq-sdt-preset-lock-badge';
                    badge.innerHTML = '<i class="fa-solid fa-lock"></i> 漫画模式锁定 (条目33事件驱动)';
                    const titleSpan = ecField.querySelector('span');
                    if (titleSpan) titleSpan.appendChild(badge);
                }
            } else {
                const sdtStore = getSdtStore();
                const expectedEc = sdtStore._mangaSavedEnhancedContext || sdtStore.enhancedContext || 'v13';
                if (ecSelect.value !== expectedEc) {
                    ecSelect.value = expectedEc;
                }
                ecSelect.disabled = false;
                ecField.classList.remove('rbq-sdt-preset-locked');
                const badge = ecField.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }

        // 锁定/解锁多角色输出模式与 2D 坐标 (漫画模式按画格槽位接管)
        const mcCheck = document.getElementById('rbq-sdt-multichar');
        const mcField = mcCheck ? mcCheck.closest('.st-scene-trigger-field') : null;
        const coordsCheck = document.getElementById('rbq-sdt-multichar-coords');
        const coordsField = coordsCheck ? coordsCheck.closest('.st-scene-trigger-field') : null;

        if (mcCheck && mcField) {
            if (store.enabled) {
                mcCheck.checked = true;
                mcCheck.disabled = true;
                mcField.classList.add('rbq-sdt-preset-locked');
                let badge = mcField.querySelector('.rbq-sdt-preset-lock-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'rbq-sdt-preset-lock-badge';
                    badge.innerHTML = '<i class="fa-solid fa-lock"></i> 漫画画格流接管 (强制开启)';
                    const titleSpan = mcField.querySelector('span');
                    if (titleSpan) titleSpan.appendChild(badge);
                }
            } else {
                const sdtStore = getSdtStore();
                mcCheck.checked = !!sdtStore.multiCharOutput;
                mcCheck.disabled = false;
                mcField.classList.remove('rbq-sdt-preset-locked');
                const badge = mcField.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }

        if (coordsCheck && coordsField) {
            if (store.enabled) {
                coordsCheck.checked = false;
                coordsCheck.disabled = true;
                coordsField.classList.add('rbq-sdt-preset-locked');
                let badge = coordsField.querySelector('.rbq-sdt-preset-lock-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'rbq-sdt-preset-lock-badge';
                    badge.innerHTML = '<i class="fa-solid fa-lock"></i> 漫画模式禁用 2D 坐标 (按格序自动排版)';
                    const titleSpan = coordsField.querySelector('span');
                    if (titleSpan) titleSpan.appendChild(badge);
                }
            } else {
                const sdtStore = getSdtStore();
                coordsCheck.checked = !!sdtStore.multiCharUseCoords;
                coordsCheck.disabled = false;
                coordsField.classList.remove('rbq-sdt-preset-locked');
                const badge = coordsField.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }

        // 同步 SDT 卡片各下拉与开关值 (支持双向响应)
        const styleSel = document.getElementById('rbq-manga-style');
        if (styleSel && styleSel.value !== store.style) styleSel.value = store.style;
        const grammarSel = document.getElementById('rbq-manga-grammar');
        if (grammarSel && grammarSel.value !== store.grammar) grammarSel.value = store.grammar;
        const gutterSel = document.getElementById('rbq-manga-gutter');
        if (gutterSel && gutterSel.value !== store.gutter) gutterSel.value = store.gutter;
        const langSel = document.getElementById('rbq-manga-lang');
        if (langSel && langSel.value !== store.language) langSel.value = store.language;
        const spreadChk = document.getElementById('rbq-manga-spread');
        if (spreadChk && spreadChk.checked !== !!store.autoSpread) spreadChk.checked = !!store.autoSpread;
        const hijackChk = document.getElementById('rbq-manga-hijack');
        if (hijackChk && hijackChk.checked !== !!store.antiHijack) hijackChk.checked = !!store.antiHijack;

        // 样式描述更新
        const descEl = document.getElementById('rbq-manga-style-desc');
        if (descEl) {
            const curStyle = COMIC_STYLES[store.style] || COMIC_STYLES.monochrome;
            const targetDesc = curStyle.desc || '';
            if (descEl.textContent !== targetDesc) {
                descEl.textContent = targetDesc;
            }
        }
        const customWrap = document.getElementById('rbq-manga-custom-wrap');
        if (customWrap) {
            const targetDisplay = store.style === 'custom' ? 'flex' : 'none';
            if (customWrap.style.display !== targetDisplay) {
                customWrap.style.display = targetDisplay;
            }
        }
    }

    function injectUiIntoSdt() {
        const sysPresetSelect = document.getElementById('rbq-sdt-system-preset');
        if (!sysPresetSelect) return;

        // 监听并拦截 SDT 保存按钮，防止保存时覆盖漫画模式设置
        const sdtSaveBtn = document.getElementById('rbq-sdt-save');
        if (sdtSaveBtn && !sdtSaveBtn.dataset.mangaHooked) {
            sdtSaveBtn.dataset.mangaHooked = '1';
            sdtSaveBtn.addEventListener('click', () => {
                setTimeout(() => {
                    const s = getStore();
                    if (s.enabled) {
                        syncMangaToSdt(s);
                        updateUiState();
                    }
                }, 50);
            });
        }

        // 如果已经注入过，则只更新状态
        if (document.getElementById('rbq-manga-mode-card')) {
            updateUiState();
            return;
        }

        const promptTab = document.getElementById('rbq-sdt-tab-prompt');
        const presetCardGroup = sysPresetSelect.closest('.rbq-sdt-card-group') || (promptTab ? promptTab.firstElementChild : null);
        if (!presetCardGroup) return;

        const store = getStore();

        const card = document.createElement('div');
        card.id = 'rbq-manga-mode-card';
        card.className = `rbq-manga-toggle-card ${store.enabled ? 'active' : ''}`;
        card.innerHTML = `
            <div class="rbq-manga-header-bar" id="rbq-manga-header-trigger">
                <div class="rbq-manga-title-wrap">
                    <i class="fa-solid fa-book-open-reader"></i>
                    <span>漫画模式 (Manga Mode)</span>
                    <span class="rbq-manga-badge">NAI V5</span>
                </div>
                <label class="rbq-manga-switch" title="开启/关闭漫画模式">
                    <input id="rbq-manga-mode-enabled" type="checkbox" ${store.enabled ? 'checked' : ''}>
                    <span class="rbq-manga-slider"></span>
                </label>
            </div>

            <div id="rbq-manga-mode-subpanel" class="rbq-manga-subpanel" style="${store.enabled ? 'display: flex;' : 'display: none;'}">
                <!-- 1. 漫画画风选择 -->
                <div class="rbq-manga-field">
                    <span>🎨 漫画专属画风</span>
                    <select id="rbq-manga-style">
                        ${Object.entries(COMIC_STYLES).map(([k, v]) => `<option value="${k}" ${store.style === k ? 'selected' : ''}>${v.name}</option>`).join('')}
                    </select>
                    <div id="rbq-manga-style-desc" class="rbq-manga-desc">${(COMIC_STYLES[store.style] || COMIC_STYLES.monochrome).desc}</div>
                </div>

                <!-- 自定义画风编辑区 -->
                <div id="rbq-manga-custom-wrap" style="display: ${store.style === 'custom' ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                    <div class="rbq-manga-field">
                        <span>自定义正面画风 Tag</span>
                        <textarea id="rbq-manga-custom-pos" rows="2" placeholder="在此输入自定义漫画正面画风词（如画师串、网点风格...）">${store.customPositive || ''}</textarea>
                    </div>
                    <div class="rbq-manga-field">
                        <span>自定义针对性负面词</span>
                        <textarea id="rbq-manga-custom-neg" rows="2" placeholder="在此输入自定义针对性负面词...">${store.customNegative || ''}</textarea>
                    </div>
                </div>

                <!-- 2. 分镜文法风格 -->
                <div class="rbq-manga-field">
                    <span>📹 漫画分镜文法</span>
                    <select id="rbq-manga-grammar">
                        ${Object.entries(GRAMMAR_PRESETS).map(([k, v]) => `<option value="${k}" ${store.grammar === k ? 'selected' : ''}>${v.name}</option>`).join('')}
                    </select>
                </div>

                <!-- 3. 对白语言与留白排版双列 -->
                <div class="rbq-manga-grid-2">
                    <div class="rbq-manga-field">
                        <span>💬 气泡对白语言</span>
                        <select id="rbq-manga-lang">
                            <option value="zh-hans" ${store.language === 'zh-hans' ? 'selected' : ''}>🇨🇳 简体中文 (ZH-Hans)</option>
                            <option value="ja" ${store.language === 'ja' ? 'selected' : ''}>🇯🇵 日文原版 (Japanese)</option>
                        </select>
                    </div>
                    <div class="rbq-manga-field">
                        <span>🔲 边框与留白排版</span>
                        <select id="rbq-manga-gutter">
                            <option value="bleed" ${store.gutter === 'bleed' ? 'selected' : ''}>天地出血 (现代紧凑贴边)</option>
                            <option value="framed" ${store.gutter === 'framed' ? 'selected' : ''}>全封闭白边内枠 (传统漫画框)</option>
                            <option value="splash" ${store.gutter === 'splash' ? 'selected' : ''}>沉浸全出血 (大画幅满格)</option>
                            <option value="black_line" ${store.gutter === 'black_line' ? 'selected' : ''}>纯黑线无白边 (零白边粗黑墨线密着切分)</option>
                        </select>
                    </div>
                </div>

                <!-- 4. 辅助选项 -->
                <div class="rbq-manga-checks">
                    <label class="rbq-manga-check-item" title="检测到大决战或宏大场面跨页时，自动将分辨率宽高翻转为横幅大宽屏（如 832×1216 ➔ 1216×832）">
                        <input type="checkbox" id="rbq-manga-spread" ${store.autoSpread ? 'checked' : ''}>
                        <span>智能横向跨页 (見開き)</span>
                    </label>
                    <label class="rbq-manga-check-item" title="阻断同人角色官方游戏立绘画风对黑白/网点漫画风格的冲淡">
                        <input type="checkbox" id="rbq-manga-hijack" ${store.antiHijack ? 'checked' : ''}>
                        <span>同人角色防夺舍</span>
                    </label>
                </div>
            </div>
        `;

        // 插入在预设选择器的正下方
        const insertAnchor = sysPresetSelect.closest('.st-scene-trigger-modal-grid') || sysPresetSelect.closest('.st-scene-trigger-field');
        if (insertAnchor && insertAnchor.parentNode) {
            insertAnchor.parentNode.insertBefore(card, insertAnchor.nextSibling);
        } else {
            presetCardGroup.appendChild(card);
        }

        // 事件监听
        const toggleInput = card.querySelector('#rbq-manga-mode-enabled');
        const headerTrigger = card.querySelector('#rbq-manga-header-trigger');

        const handleToggle = (nextState) => {
            const s = getStore();
            s.enabled = nextState;
            save();
            syncMangaToSdt(s, true);
            updateUiState();
            toastr.info(s.enabled ? '已开启漫画模式，提示词预设已由漫画分镜接管' : '已关闭漫画模式，恢复标准提示词预设', PLUGIN_NAME);
        };

        toggleInput?.addEventListener('change', (e) => {
            handleToggle(e.target.checked);
        });

        headerTrigger?.addEventListener('click', (e) => {
            if (e.target.closest('.rbq-manga-switch')) return;
            if (toggleInput) {
                toggleInput.checked = !toggleInput.checked;
                handleToggle(toggleInput.checked);
            }
        });

        card.querySelector('#rbq-manga-style')?.addEventListener('change', (e) => {
            const s = getStore();
            s.style = e.target.value;
            save();
            syncMangaToSdt(s);
            updateUiState();
            toastr.success(`已切换漫画画风：${COMIC_STYLES[s.style]?.name || s.style}`, PLUGIN_NAME);
        });

        card.querySelector('#rbq-manga-grammar')?.addEventListener('change', (e) => {
            const s = getStore();
            s.grammar = e.target.value;
            save();
            syncMangaToSdt(s);
            toastr.info(`已切换分镜文法：${GRAMMAR_PRESETS[s.grammar]?.name || s.grammar}`, PLUGIN_NAME);
        });

        card.querySelector('#rbq-manga-lang')?.addEventListener('change', (e) => {
            const s = getStore();
            s.language = e.target.value;
            save();
            syncMangaToSdt(s);
            toastr.info(s.language === 'ja' ? '气泡台词已切换为：日文原版' : '气泡台词已切换为：简体中文', PLUGIN_NAME);
        });

        card.querySelector('#rbq-manga-gutter')?.addEventListener('change', (e) => {
            const s = getStore();
            s.gutter = e.target.value;
            save();
            syncMangaToSdt(s);
        });

        card.querySelector('#rbq-manga-spread')?.addEventListener('change', (e) => {
            const s = getStore();
            s.autoSpread = e.target.checked;
            save();
            syncMangaToSdt(s);
        });

        card.querySelector('#rbq-manga-hijack')?.addEventListener('change', (e) => {
            const s = getStore();
            s.antiHijack = e.target.checked;
            save();
            syncMangaToSdt(s);
        });

        card.querySelector('#rbq-manga-custom-pos')?.addEventListener('input', (e) => {
            const s = getStore();
            s.customPositive = e.target.value;
            save();
            syncMangaToSdt(s);
        });

        card.querySelector('#rbq-manga-custom-neg')?.addEventListener('input', (e) => {
            const s = getStore();
            s.customNegative = e.target.value;
            save();
            syncMangaToSdt(s);
        });

        updateUiState();
    }

    // ── 7. 漫画工作台 (Manga Studio) 核心引擎与面板挂载 ────────────
    const MANGA_SHOT_PRESETS = [
        {
            group: '📐 距离景别 (Framing & Distance)',
            options: [
                { value: 'medium shot', label: '中景胸像 (Medium Shot)' },
                { value: 'close-up focus', label: '特写聚焦 (Close-up)', aliases: ['close-up'] },
                { value: 'face close-up', label: '面部大特写 (Face Close-up)' },
                { value: 'extreme close-up on eyes', label: '眼神极近特写 (Eyes Close-up)' },
                { value: 'cowboy shot', label: '半身膝上 (Cowboy Shot)' },
                { value: 'full body', label: '全身立像 (Full Body)' },
                { value: 'wide establishing shot', label: '广角大远景 (Wide Shot)', aliases: ['wide shot'] }
            ]
        },
        {
            group: '🌐 空间机位 (Vertical Angles)',
            options: [
                { value: 'eye-level shot', label: '平视平位 (Eye-level)' },
                { value: 'dynamic low angle', label: '仰角冲击 (Low Angle / From Below)' },
                { value: 'high angle', label: '俯视角度 (High Angle / From Above)' },
                { value: 'bird\'s-eye view', label: '顶视鸟瞰 (Bird\'s-eye / Top-down)' },
                { value: 'ground angle', label: '贴地极低机位 (Worm\'s-eye / Ground)' }
            ]
        },
        {
            group: '🎬 叙事视点与特色镜头 (Cinematic & POV)',
            options: [
                { value: 'dutch angle', label: '倾斜角/窥视惊悚 (Dutch Angle)' },
                { value: 'from behind', label: '背后追踪视线 (From Behind / Back)' },
                { value: 'over-the-shoulder', label: '越肩对峙 (Over-the-shoulder)' },
                { value: 'pov, first-person view', label: '第一人称主视角 (POV)' },
                { value: 'profile', label: '正侧面剪影 (Side Profile)' },
                { value: 'fisheye lens', label: '鱼眼透视畸变 (Fisheye Lens)' },
                { value: 'foreshortening', label: '强透视伸向镜头 (Foreshortening)' }
            ]
        }
    ];

    function renderShotOptions(selectedShot) {
        let hasMatched = false;
        const groupsHtml = MANGA_SHOT_PRESETS.map(grp => `
            <optgroup label="${grp.group}">
                ${grp.options.map(opt => {
                    const isSel = (opt.value === selectedShot || (opt.aliases && opt.aliases.includes(selectedShot)));
                    if (isSel) hasMatched = true;
                    return `<option value="${opt.value}" ${isSel ? 'selected' : ''}>${opt.label}</option>`;
                }).join('')}
            </optgroup>
        `).join('');

        let customOptionHtml = '';
        if (selectedShot && !hasMatched && selectedShot !== '__custom__') {
            customOptionHtml = `<option value="${RBQ.utils.escapeHtml(selectedShot)}" selected>⚙️ 自定义机位 (${RBQ.utils.escapeHtml(selectedShot)})</option>`;
        }

        return customOptionHtml + groupsHtml + `<option value="__custom__">✏️ 手动输入自定义机位...</option>`;
    }

    const STORYBOARD_PRESETS = [
        {
            id: 'sunset-confession',
            name: '黄昏告白 · 3 格 (恋爱物语)',
            desc: '黄昏教室迟疑 ➔ 鼓起勇气递情书特写 ➔ 神情骤变泪光心动。',
            grammar: 'shojo',
            panels: [
                {
                    title: '起景 · 黄昏教室',
                    desc: '黄昏的教室中，夕阳余晖洒在课桌上，少女红着脸低着头，手指紧张地摆弄着裙角。',
                    shot: 'medium shot',
                    tags: '1girl, chinami, classroom, sunset, orange light, looking down, blushing, nervous, fidgeting with skirt',
                    bubbleType: 'thought',
                    bubbleText: '心跳……怎么会这么快……',
                    bubbleLayout: 'vertical',
                },
                {
                    title: '递信特写 · 瞬间',
                    desc: '双手紧紧递出一封带有红色火漆印章的白色情书，浪漫而充满决意的紧绷感。',
                    shot: 'close-up focus',
                    tags: 'focus on hands, holding love letter, white envelope, red wax seal, romantic tension',
                    bubbleType: 'speech',
                    bubbleText: '请、请收下这个！',
                    bubbleLayout: 'horizontal',
                },
                {
                    title: '神情骤变 · 泪光',
                    desc: '少女愕然睁大泪眼，狂乱的风吹动发丝与窗帘，戏剧性的心动光影。',
                    shot: 'face close-up',
                    tags: '1girl, chinami, wide eyed, tears prickling in eyes, fluttering hair, curtain blowing in wind, dramatic lighting',
                    bubbleType: 'screaming',
                    bubbleText: '……欸？！我、我吗？！',
                    bubbleLayout: 'vertical',
                }
            ]
        },
        {
            id: 'shonen-battle',
            name: '热血对峙 · 4 格 (战斗高潮)',
            desc: '风暴战场废墟 ➔ 拔刀蓄力斩击 ➔ 速度线怒吼爆发 ➔ 刀光落地残影。',
            grammar: 'shonen',
            panels: [
                {
                    title: '远景 · 废墟战云',
                    desc: '风暴席卷的破败城市废墟，阴云密布雷光闪烁，史诗般的终局战场全景。',
                    shot: 'wide establishing shot',
                    tags: 'battlefield, storm, destroyed city, dark clouds, lightning, epic perspective, debris',
                    bubbleType: 'caption',
                    bubbleText: '终局之刻，在此降临。',
                    bubbleLayout: 'horizontal',
                },
                {
                    title: '中景 · 拔刀斩击',
                    desc: '拔出太刀的瞬间，电光火花闪烁，眼神凌厉如刀锋。',
                    shot: 'medium shot',
                    tags: 'focus on blade, unsheathing katana, electric sparks, motion blur, sharp eyes, intense glare',
                    bubbleType: 'sfx',
                    bubbleText: '锵——！！',
                    bubbleLayout: 'vertical',
                },
                {
                    title: '特写 · 怒吼爆发',
                    desc: '向前猛然跃起挥刀斩击，强烈的速度线与暴怒的神情，极具视觉冲击力的仰角。',
                    shot: 'dynamic low angle',
                    tags: 'leaping forward, sword slash, slashing motion, speed lines, shouting, furious expression, dramatic contrast',
                    bubbleType: 'screaming',
                    bubbleText: '接招吧——！',
                    bubbleLayout: 'vertical',
                },
                {
                    title: '收势 · 烟尘背影',
                    desc: '斩击落地后的背影特写，披风在烟尘中猎猎作响，碎裂的地面。',
                    shot: 'from behind',
                    tags: 'landing after attack, back view, cape fluttering, smoke rising, shattered ground, cool silhouette',
                    bubbleType: 'thought',
                    bubbleText: '已经……结束了。',
                    bubbleLayout: 'horizontal',
                }
            ]
        },
        {
            id: 'daily-4koma',
            name: '日常轻喜 · 4 格 (经典四格)',
            desc: '清晨自制吐司 ➔ 猛然惊见时钟 ➔ 狂奔上学大喊 ➔ 紧闭校门与星期天。',
            grammar: '4koma',
            panels: [
                {
                    title: '起 · 惬意早餐',
                    desc: '宁静晴朗的早晨厨房，端着法式黄油烤吐司微笑，神采奕奕。',
                    shot: 'medium shot',
                    tags: 'peaceful morning, kitchen, sunny day, smiling, holding plate, toast with butter, cheerful',
                    bubbleType: 'speech',
                    bubbleText: '今天做的是法式吐司哦~',
                    bubbleLayout: 'horizontal',
                },
                {
                    title: '承 · 惊愕一撇',
                    desc: '猛然瞥见挂钟的时刻，眼珠暴凸，脸颊挂着一大滴冷汗，目瞪口呆发抖。',
                    shot: 'close-up focus',
                    tags: 'looking at wall clock, eyes bulging, sweat drop on cheek, dumbfounded, trembling',
                    bubbleType: 'speech',
                    bubbleText: '等等……现在的时刻是？！',
                    bubbleLayout: 'horizontal',
                },
                {
                    title: '转 · 狂奔风暴',
                    desc: '嘴里叼着吐司全速在大街上狂奔，裙摆随风狂舞，惊慌失措大喊。',
                    shot: 'wide establishing shot',
                    tags: 'running at full speed, toast in mouth, rushing down street, fluttering skirt, wind, frantic, panicked',
                    bubbleType: 'screaming',
                    bubbleText: '要迟到啦啊啊啊！',
                    bubbleLayout: 'vertical',
                },
                {
                    title: '合 · 闭门石化',
                    desc: '呆立在紧闭的校门前，日历上清楚地写着星期天，眼睛翻白灵魂出窍。',
                    shot: 'medium shot',
                    tags: 'standing before closed school gate, calendar showing Sunday, blank white eyes, soul escaping mouth, comedic defeat',
                    bubbleType: 'caption',
                    bubbleText: '今天……是星期天。',
                    bubbleLayout: 'horizontal',
                }
            ]
        },
        {
            id: 'cinema-mystery',
            name: '悬疑追索 · 2 格 (电影画卷)',
            desc: '大远景雨夜侦探社 ➔ 放大镜微光与真相锁定。',
            grammar: 'mystery',
            panels: [
                {
                    title: '远景 · 雨夜长街',
                    desc: '昏暗的事务所与雨水打湿的窗户，窗外夜色弥漫，孤寂的烟雾缭绕。',
                    shot: 'wide establishing shot',
                    tags: 'dimly lit office, rainy window, rain streaks, wet glass, night city lights, lonely cigarette smoke, chiaroscuro',
                    bubbleType: 'caption',
                    bubbleText: '案发后的第三个雨夜。',
                    bubbleLayout: 'horizontal',
                },
                {
                    title: '特写 · 瞳孔与微光',
                    desc: '阴影覆盖上半张脸，瞳孔闪烁着锐利冷光，放大镜反射出照片上的关键线索。',
                    shot: 'face close-up',
                    tags: 'sharp gaze, shadow covering upper face, glowing eyes, magnifying glass reflecting photo, intense atmosphere, cinematic lighting',
                    bubbleType: 'thought',
                    bubbleText: '凶手……原来就是你。',
                    bubbleLayout: 'vertical',
                }
            ]
        }
    ];

    function resolveBubbleTypeTag(bType) {
        if (!bType) return '通常吹き出し';
        const lower = String(bType).toLowerCase().trim();
        if (lower.includes('thought') || lower.includes('思考')) return '思考の吹き出し';
        if (lower.includes('scream') || lower.includes('叫び') || lower.includes('怒')) return '叫び吹き出し';
        if (lower.includes('caption') || lower.includes('旁白') || lower.includes('ナレーション')) return 'ナレーション枠';
        if (lower.includes('sfx') || lower.includes('拟音') || lower.includes('擬音')) return '擬音, 吹き出しなし';
        if (lower.includes('whisper') || lower.includes('破線')) return '破線吹き出し';
        if (lower.includes('shiver') || lower.includes('波打つ')) return '波打つ吹き出し';
        return '通常吹き出し';
    }

    function resolveBubbleLayoutTag(layout, bType) {
        if (layout === 'horizontal' || bType === 'caption' || String(bType).includes('ナレーション')) {
            return 'Layout: 横書き';
        }
        return 'Layout: 縦書き';
    }

    function composeStudioPrompt(store) {
        const studio = store.studio;
        const grammarKey = store.grammar || 'cinema';
        const grammarTag = GRAMMAR_TAGS[grammarKey] || GRAMMAR_TAGS.cinema;
        const styleKey = store.style || 'monochrome';
        const styleObj = COMIC_STYLES[styleKey] || COMIC_STYLES.monochrome;
        const stylePos = styleKey === 'custom' ? (store.customPositive || '') : styleObj.positive;

        const gutterObj = GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed;
        const gutterTag = gutterObj.tag;

        const isDoubleSpread = studio.ratio === '1216x832';
        const layoutTag = isDoubleSpread ? 'wide spread' : 'vertical layout';
        const panelCountTag = `${studio.panels.length}panels`;

        const baseParts = [
            grammarTag,
            stylePos,
            'comic, 複数コマの漫画ページ, manga page layout',
            layoutTag,
            gutterTag,
            'dynamic komawari',
            panelCountTag
        ].filter(Boolean);

        const isMonochrome = (styleKey === 'monochrome');
        let baseCaption = baseParts.join(', ');
        if (isMonochrome) {
            baseCaption = decolorizeTags(baseCaption);
        }

        const panelSegments = studio.panels.map((p) => {
            const parts = [];
            if (p.shot) parts.push(p.shot);
            if (p.tags) {
                const tagStr = isMonochrome ? decolorizeTags(p.tags) : p.tags;
                if (tagStr) parts.push(tagStr);
            }

            const text = (p.bubbleText || '').trim();
            if (text) {
                const bType = p.bubbleType || 'speech';
                const typeTag = resolveBubbleTypeTag(bType);
                const layoutTag = resolveBubbleLayoutTag(p.bubbleLayout, bType);

                if (typeTag === '擬音, 吹き出しなし' || bType === 'sfx') {
                    parts.push('SFX: 擬音, 吹き出しなし');
                    parts.push(layoutTag);
                    parts.push(`Text: ${text}`);
                } else {
                    parts.push(`BubbleType: ${typeTag}`);
                    parts.push(layoutTag);
                    parts.push(`Text: ${text}`);
                }
            }
            return parts.join(', ');
        });

        if (panelSegments.length > 0) {
            return [baseCaption, ...panelSegments].join(' | ');
        }
        return baseCaption;
    }

    async function callLlmStoryboardParser(storyText, grammar, language, panelCountMode = 'auto', onProgress) {
        const sdtStore = RBQ.api.getSettings()?._smartDrawTrigger || {};
        const baseUrl = (sdtStore.openaiBaseUrl || '').trim().replace(/\/+$/, '');
        const apiKey = (sdtStore.openaiApiKey || '').trim();
        const model = (sdtStore.openaiModelCustom || '').trim() || sdtStore.openaiModel || 'gpt-4o-mini';

        const isFixed = panelCountMode && panelCountMode !== 'auto';
        const panelCountInstruction = isFixed
            ? `【重要画格数硬性要求】：你必须将用户提供的自然语言剧情严格拆解为恰好 ${panelCountMode} 个连续画格（Panels 数组长度必须严格等于 ${panelCountMode}）！`
            : `你的任务是将用户提供的自然语言剧情故事拆解为 1~4 个连续且具视觉冲击力的漫画画格（依据剧情容量自适应规划画格数，通常为 2~4 格）。`;

        const countReq = isFixed ? `必须严格规划为恰好 ${panelCountMode} 个画格（panels 数组必须恰好有 ${panelCountMode} 项）` : `自动规划（根据情节容量自适应 1~4 格）`;

        const store = getStore();
        const grammarObj = GRAMMAR_PRESETS[grammar] || GRAMMAR_PRESETS.cinema;
        const grammarInstruction = grammarObj.instruction || '';
        const gutterObj = GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed;
        const gutterInstruction = gutterObj.instruction || '';
        const colorRule = (store.style === 'monochrome')
            ? `\n【色彩模式要求】：当前处于黑白漫画模式，Tag 中请避免输出具体彩色词汇（如 pink hair, blue dress 等），改用 dark/light 等灰阶明暗与光影词汇。`
            : '';
        const langInstruction = language === 'ja'
            ? '【台词偏好语言】：日文 (Japanese) - 请将对白、心声或旁白自然转译为地道标准的日式漫画台词。'
            : '【台词偏好语言】：简体中文 (Chinese) - 保留或输出生动贴切的中文漫画对白。';

        const systemPrompt = `你是一位顶级日式漫画分镜大师兼 NAI Anime 提示词导演。
${panelCountInstruction}
【当前分镜文法纲领】：
${grammarInstruction}
【当前排版留白与出血规则】：
${gutterInstruction}${colorRule}
必须输出纯 JSON，绝不要包含 Markdown 代码块（如 \`\`\`json）或任何额外文字。
JSON 格式规范：
{
  "panels": [
    {
      "title": "画格概括（中文，5-10字，如：黄昏教室的迟疑）",
      "shot": "景别机位英文（支持从以下专业漫画镜头中挑选最契合剧情的词：close-up focus | face close-up | extreme close-up on eyes | medium shot | cowboy shot | full body | wide establishing shot | eye-level shot | dynamic low angle | high angle | bird's-eye view | ground angle | dutch angle | from behind | over-the-shoulder | pov, first-person view | profile | fisheye lens | foreshortening）",
      "tags": "该画格专属英文 Danbooru/NAI Tag（包含角色动作、神态、光影、环境背景，不要包含画风词）",
      "bubbleType": "speech | thought | screaming | caption | sfx",
      "bubbleText": "画格内角色台词、心声或旁白文字",
      "bubbleLayout": "vertical | horizontal"
    }
  ]
}`;

        const userContent = `【剧情叙事】：${storyText}\n【画格数规划要求】：${countReq}\n【分镜文法风格】：${grammarObj.name}\n【边框留白排版】：${gutterObj.name}\n${langInstruction}`;

        if (baseUrl) {
            try {
                if (onProgress) onProgress('正在调用大模型进行分镜剧情推演...');
                const url = `${baseUrl}/chat/completions`;
                const reqBody = {
                    model,
                    temperature: 0.3,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent }
                    ]
                };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
                    },
                    body: JSON.stringify(reqBody)
                });
                if (res.ok) {
                    const data = await res.json();
                    const rawReply = data.choices?.[0]?.message?.content || '';
                    const cleanJson = rawReply.replace(/```json/gi, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    if (Array.isArray(parsed?.panels) && parsed.panels.length > 0) {
                        parsed.panels.forEach((p, idx) => {
                            if (!p.desc) p.desc = p.title || `画格 #${idx + 1}`;
                            if (p.bubbleText) p.bubbleText = String(p.bubbleText).trim();
                        });
                        return parsed.panels;
                    }
                }
            } catch (e) {
                console.warn(`[Manga Studio] LLM API call failed, using heuristic:`, e);
            }
        }

        if (onProgress) onProgress('正在应用漫画导演分镜文法推演...');
        return runHeuristicStoryboardParser(storyText, grammar, language, panelCountMode);
    }

    function parseSentenceToPanelData(sentence, i = 0, panelCount = 3) {
        if (!sentence) sentence = '';
        let bubbleType = 'speech';
        let bubbleText = '';
        let bubbleLayout = (i % 2 === 0) ? 'vertical' : 'horizontal';

        // 智能根据叙事情绪分配专业漫画机位
        let shot = 'medium shot';
        if (/尾随|跟踪|背后|后面|跟随|脚步声/i.test(sentence)) {
            shot = 'from behind';
        } else if (/小巷|街道|教室|天台|黑夜|城市|废墟|远/i.test(sentence) && (i === 0 || i === panelCount - 1)) {
            shot = 'wide establishing shot';
        } else if (/恐慌|害怕|惊恐|惊慌|颤抖|冷汗|发抖|逃/i.test(sentence)) {
            shot = 'dutch angle';
        } else if (/眼神|凝视|盯着|瞳孔|惊愕|睁大/i.test(sentence)) {
            shot = 'extreme close-up on eyes';
        } else if (/泪|哭|红脸|脸|喘息|微笑|神情/i.test(sentence)) {
            shot = 'face close-up';
        } else if (/抓|拉|拖|按|推|倒|斩|冲|击|伸出/i.test(sentence)) {
            shot = 'foreshortening';
        } else if (/对峙|对话|问|说|转过身|看着/i.test(sentence)) {
            shot = 'over-the-shoulder';
        } else {
            const defaultFlow = ['wide establishing shot', 'face close-up', 'dutch angle', 'foreshortening', 'medium shot'];
            shot = defaultFlow[i % defaultFlow.length];
        }

        const thoughtMatch = sentence.match(/[（\(](.+?)[）\)]/);
        const speechMatch = sentence.match(/[“"「](.+?)[”"」]/);

        if (thoughtMatch) {
            bubbleType = 'thought';
            bubbleText = (thoughtMatch[1] || '').trim();
        } else if (speechMatch) {
            bubbleType = 'speech';
            bubbleText = (speechMatch[1] || '').trim();
        } else if (sentence.includes('！') || sentence.includes('!')) {
            bubbleType = 'screaming';
            bubbleText = (sentence.slice(0, 16) || '').trim();
        } else {
            bubbleType = (i === 0) ? 'caption' : 'speech';
            bubbleText = (sentence.slice(0, 18) || '').trim();
        }

        const tags = [];
        if (/女|少女|妹|她/i.test(sentence)) tags.push('1girl');
        if (/男|少年|他/i.test(sentence)) tags.push('1boy');
        if (/红脸|害羞|羞/i.test(sentence)) tags.push('blushing');
        if (/泪|哭|湿润/i.test(sentence)) tags.push('tears, tears prickling in eyes');
        if (/黄昏|夕阳/i.test(sentence)) tags.push('sunset, orange light');
        if (/教室|学校/i.test(sentence)) tags.push('classroom, school desk');
        if (/信|信封|情书/i.test(sentence)) tags.push('focus on hands, holding love letter, white envelope');
        if (/笑|微笑/i.test(sentence)) tags.push('gentle smile, expressive eyes');
        if (/看|凝视|视线/i.test(sentence)) tags.push('looking at viewer');
        if (/风|吹/i.test(sentence)) tags.push('fluttering hair, wind blowing');

        if (tags.length === 0) {
            tags.push('dramatic lighting', 'expressive eyes');
        }

        return {
            title: `第 ${i + 1} 格 · ${sentence.slice(0, 8) || '画格'}`,
            desc: sentence,
            shot,
            tags: tags.join(', '),
            bubbleType,
            bubbleText,
            bubbleLayout
        };
    }

    function runHeuristicStoryboardParser(text, grammar, language, panelCountMode = 'auto') {
        if (!text || !text.trim()) {
            text = '夕阳西下的教室，女主角红着脸低下头。男主角鼓起勇气递上一封情书。女主角惊慌地抬起头，眼睛里闪烁着泪光，窗外的风吹动窗帘。';
        }
        const sentences = text
            .split(/(?<=[。！？!\?\n])/)
            .map(s => s.trim())
            .filter(s => s.length > 1);

        const isFixed = panelCountMode && panelCountMode !== 'auto';
        const panelCount = isFixed
            ? Math.max(1, Math.min(5, Number(panelCountMode) || 3))
            : Math.max(2, Math.min(4, sentences.length || 3));
        const panels = [];

        for (let i = 0; i < panelCount; i++) {
            const sentence = sentences[i] || (sentences[sentences.length - 1] ? `${sentences[sentences.length - 1]} (续)` : `场景片段 ${i + 1}`);
            panels.push(parseSentenceToPanelData(sentence, i, panelCount));
        }
        return panels;
    }

    async function callLlmSingleSentenceExpander(sentence, currentShot, grammar, language, allPanels = [], currentIndex = 0) {
        const store = getStore();
        const sdtStore = RBQ.api.getSettings()?._smartDrawTrigger || {};
        const baseUrl = (sdtStore.openaiBaseUrl || '').trim().replace(/\/+$/, '');
        const apiKey = (sdtStore.openaiApiKey || '').trim();
        const model = (sdtStore.openaiModelCustom || '').trim() || sdtStore.openaiModel || 'gpt-4o-mini';

        let otherContext = '';
        if (Array.isArray(allPanels) && allPanels.length > 1) {
            const others = allPanels
                .map((p, i) => {
                    if (i === currentIndex) return null;
                    const descPart = p.desc || p.title || '';
                    const tagPart = p.tags ? `[已有Tag参考: ${p.tags}]` : '';
                    return `画格 #${i + 1}: ${descPart} ${tagPart}`.trim();
                })
                .filter(Boolean);
            if (others.length > 0) {
                otherContext = `\n【当前整页其他画格参考 (必须严格继承同一角色的外貌特征、发色与服装，保持人设一致)】：\n${others.join('\n')}`;
            }
        }

        const grammarObj = GRAMMAR_PRESETS[grammar] || GRAMMAR_PRESETS.cinema;
        const grammarInstruction = grammarObj.instruction || '';
        const gutterObj = GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed;
        const gutterInstruction = gutterObj.instruction || '';
        const colorRule = (store.style === 'monochrome')
            ? `\n【色彩模式要求】：当前处于黑白漫画模式，Tag 中请避免输出具体彩色词汇（如 pink hair, blue dress 等），改用 dark/light 等灰阶明暗词汇。`
            : '';
        const langInstruction = language === 'ja'
            ? '【台词偏好语言】：日文 (Japanese) - 请将对白、心声或旁白自然转译为地道标准的日式漫画台词。'
            : '【台词偏好语言】：简体中文 (Chinese) - 保留或输出生动贴切的中文漫画对白。';

        const systemPrompt = `你是一位顶级日式漫画分镜大师兼 NAI Anime 提示词导演。
你的任务是将用户提供的单一漫画画格剧情句子转换为专业的 NAI 提示词。
如果提供了其他画格的参考内容，请务必继承已确立的角色外貌（例如角色名、发色发型、瞳色、服装等），保持同一漫画单页内人设连贯，在此基础上根据本格剧情生成动作、神态、光影和机位！
【分镜文法参考】：
${grammarInstruction}
【排版留白与出血规则】：
${gutterInstruction}${colorRule}
必须输出纯 JSON，绝不要包含 Markdown 代码块或额外文字。
JSON 格式规范：
{
  "title": "画格简短标题（5-10字中文）",
  "shot": "景别机位英文（支持：close-up focus | face close-up | extreme close-up on eyes | medium shot | cowboy shot | full body | wide establishing shot | eye-level shot | dynamic low angle | high angle | bird's-eye view | ground angle | dutch angle | from behind | over-the-shoulder | pov, first-person view | profile | fisheye lens | foreshortening）",
  "tags": "该画格专属纯英文 Danbooru/NAI Tag（包含角色动作、神态、光影、环境背景，不要画风词）",
  "bubbleType": "speech | thought | screaming | caption | sfx",
  "bubbleText": "画格内角色台词或心声文字",
  "bubbleLayout": "vertical | horizontal"
}`;

        const userContent = `【本格剧情描述】：${sentence}\n【当前机位参考】：${currentShot || 'medium shot'}\n【分镜文法风格】：${grammarObj.name}\n【边框留白排版】：${gutterObj.name}\n${langInstruction}${otherContext}`;

        if (baseUrl) {
            try {
                const url = `${baseUrl}/chat/completions`;
                const reqBody = {
                    model,
                    temperature: 0.3,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent }
                    ]
                };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
                    },
                    body: JSON.stringify(reqBody)
                });
                if (res.ok) {
                    const data = await res.json();
                    const rawReply = data.choices?.[0]?.message?.content || '';
                    const cleanJson = rawReply.replace(/```json/gi, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    if (parsed && (parsed.tags || parsed.shot)) {
                        if (parsed.bubbleText) parsed.bubbleText = String(parsed.bubbleText).trim();
                        return parsed;
                    }
                }
            } catch (e) {
                console.warn(`[Manga Studio] Single Panel LLM API call failed, using heuristic:`, e);
            }
        }
        return parseSentenceToPanelData(sentence, 0, 1);
    }

    async function callLlmBatchSentenceExpander(panels, grammar, language, onProgress) {
        const store = getStore();
        const sdtStore = RBQ.api.getSettings()?._smartDrawTrigger || {};
        const baseUrl = (sdtStore.openaiBaseUrl || '').trim().replace(/\/+$/, '');
        const apiKey = (sdtStore.openaiApiKey || '').trim();
        const model = (sdtStore.openaiModelCustom || '').trim() || sdtStore.openaiModel || 'gpt-4o-mini';

        const grammarObj = GRAMMAR_PRESETS[grammar] || GRAMMAR_PRESETS.cinema;
        const grammarInstruction = grammarObj.instruction || '';
        const gutterObj = GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed;
        const gutterInstruction = gutterObj.instruction || '';
        const colorRule = (store.style === 'monochrome')
            ? `\n【色彩模式要求】：当前处于黑白漫画模式，Tag 中请避免输出具体彩色词汇（如 pink hair, blue dress 等），改用 dark/light 等灰阶明暗词汇。`
            : '';
        const langInstruction = language === 'ja'
            ? '【台词偏好语言】：日文 (Japanese) - 请将对白、心声或旁白自然转译为地道标准的日式漫画台词。'
            : '【台词偏好语言】：简体中文 (Chinese) - 保留或输出生动贴切的中文漫画对白。';

        const promptList = panels.map((p, idx) => `画格 #${idx + 1}: ${p.desc || p.title || '（未输入描述）'}`).join('\n');

        const systemPrompt = `你是一位顶级日式漫画分镜大师兼 NAI Anime 提示词导演。
用户已经确定了整页漫画包含 ${panels.length} 个画格，并给出了每一个画格的具体剧情/动作描写。
【分镜文法参考】：
${grammarInstruction}
【排版留白与出血规则】：
${gutterInstruction}${colorRule}
你的任务是为每个画格分别生成：
1. title: 画格概括（中文，5-10字）
2. shot: 从以下 19 种专业漫画镜头中挑选最契合剧情的词（close-up focus | face close-up | extreme close-up on eyes | medium shot | cowboy shot | full body | wide establishing shot | eye-level shot | dynamic low angle | high angle | bird's-eye view | ground angle | dutch angle | from behind | over-the-shoulder | pov, first-person view | profile | fisheye lens | foreshortening）
3. tags: 纯英文 Danbooru/NAI Tag（包含角色动作、神态、光影、环境背景，保持同一角色在各画格间的外观特征连贯，不要画风词）
4. bubbleType: speech | thought | screaming | caption | sfx
5. bubbleText: 提炼出的画格内角色台词、心声或旁白
6. bubbleLayout: vertical | horizontal

必须输出纯 JSON，绝不要包含 Markdown 代码块或额外文字。
JSON 格式规范：
{
  "panels": [
    {
      "index": 1,
      "title": "...",
      "shot": "...",
      "tags": "...",
      "bubbleType": "...",
      "bubbleText": "...",
      "bubbleLayout": "..."
    }
  ]
}`;

        const userContent = `【分镜文法风格】：${grammarObj.name}\n【边框留白排版】：${gutterObj.name}\n${langInstruction}\n【用户指定的逐格剧情如下】：\n${promptList}`;

        if (baseUrl) {
            try {
                if (onProgress) onProgress('正在调用大模型为各画格生成提示词与机位...');
                const url = `${baseUrl}/chat/completions`;
                const reqBody = {
                    model,
                    temperature: 0.3,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent }
                    ]
                };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
                    },
                    body: JSON.stringify(reqBody)
                });
                if (res.ok) {
                    const data = await res.json();
                    const rawReply = data.choices?.[0]?.message?.content || '';
                    const cleanJson = rawReply.replace(/```json/gi, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    if (Array.isArray(parsed?.panels) && parsed.panels.length > 0) {
                        parsed.panels.forEach(p => {
                            if (p.bubbleText) p.bubbleText = String(p.bubbleText).trim();
                        });
                        return parsed.panels;
                    }
                }
            } catch (e) {
                console.warn(`[Manga Studio] Batch Sentence LLM API call failed, using heuristic:`, e);
            }
        }

        if (onProgress) onProgress('正在应用漫画导演分镜文法逐格推演...');
        return panels.map((p, idx) => parseSentenceToPanelData(p.desc || p.title, idx, panels.length));
    }

    function extractChatNarrative() {
        try {
            const ctx = RBQ.api.getContext?.();
            const chat = ctx?.chat;
            if (!Array.isArray(chat) || chat.length === 0) {
                toastr.warning('当前酒馆会话为空，未找到对话内容', PLUGIN_NAME);
                return '';
            }
            const recent = chat.slice(-3);
            const lines = recent.map(m => {
                const name = m.name || (m.is_user ? '你' : '角色');
                const cleanMes = (m.mes || '')
                    .replace(/<[^>]+>/g, '')
                    .replace(/```[\s\S]*?```/g, '')
                    .trim();
                return cleanMes ? `【${name}】${cleanMes}` : '';
            }).filter(Boolean);
            return lines.join('\n\n');
        } catch (e) {
            console.error('[Manga Studio] 提取对话失败:', e);
            return '';
        }
    }

    function downloadGeneratedImage(url, filename = 'manga-page.png') {
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toastr.success('已开始下载漫画高清原图', PLUGIN_NAME);
    }

    function showMangaViewerModal(url, prompt) {
        const old = document.getElementById('mw-viewer-modal');
        if (old) old.remove();
        const modal = document.createElement('div');
        modal.id = 'mw-viewer-modal';
        modal.className = 'mw-modal-mask';
        modal.innerHTML = `
            <div class="mw-viewer-box">
                <div class="mw-viewer-hd">
                    <span><i class="fa-solid fa-book-open" style="color:#f59e0b"></i> 漫画原画大图走查</span>
                    <button class="mw-btn sm rd" id="mw-viewer-close"><i class="fa-solid fa-xmark"></i> 关闭</button>
                </div>
                <div class="mw-viewer-body">
                    <img src="${RBQ.utils.escapeHtml(url)}" alt="Manga Page HD">
                </div>
                <div class="mw-viewer-ft">
                    <div class="mw-code-block" style="max-height:60px;">${RBQ.utils.escapeHtml(prompt || '')}</div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button class="mw-btn sm cy" id="mw-viewer-copy"><i class="fa-regular fa-copy"></i> 复制完整 Prompt</button>
                        <button class="mw-btn sm gn" id="mw-viewer-dl"><i class="fa-solid fa-download"></i> 下载原图</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#mw-viewer-close')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        modal.querySelector('#mw-viewer-copy')?.addEventListener('click', () => {
            RBQ.utils.copyToClipboard(prompt || '');
            toastr.success('已复制完整提示词！', PLUGIN_NAME);
        });
        modal.querySelector('#mw-viewer-dl')?.addEventListener('click', () => downloadGeneratedImage(url));
    }

    function showPresetPickerModal(onSelect) {
        const old = document.getElementById('mw-preset-modal');
        if (old) old.remove();
        const modal = document.createElement('div');
        modal.id = 'mw-preset-modal';
        modal.className = 'mw-modal-mask';
        modal.innerHTML = `
            <div class="mw-preset-box">
                <div class="mw-preset-hd">
                    <span><i class="fa-solid fa-bookmark" style="color:#f59e0b"></i> 常用漫画分镜模板</span>
                    <button class="mw-btn sm rd" id="mw-preset-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="mw-preset-list">
                    ${STORYBOARD_PRESETS.map((p, idx) => `
                        <div class="mw-preset-item" data-idx="${idx}">
                            <div class="mw-preset-title">${RBQ.utils.escapeHtml(p.name)}</div>
                            <div class="mw-preset-desc">${RBQ.utils.escapeHtml(p.desc)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#mw-preset-close')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        modal.querySelectorAll('.mw-preset-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = Number(item.dataset.idx);
                const p = STORYBOARD_PRESETS[idx];
                if (p && typeof onSelect === 'function') {
                    onSelect(p);
                }
                modal.remove();
            });
        });
    }

    let refreshMangaWorkshop = null;

    function renderMangaWorkshop(container) {
        const store = getStore();
        const studio = store.studio;

        container.innerHTML = `
            <div class="mw-wrap">
                <!-- Header Quick Bar -->
                <div class="mw-hdr">
                    <div class="mw-brand">
                        <div class="mw-logo"><i class="fa-solid fa-book-open"></i></div>
                        <div class="mw-title-box">
                            <div class="mw-title">漫画工作台 <span class="mw-badge">Manga Studio v${VERSION}</span></div>
                            <div class="mw-subtitle">自然语言剧情转分镜 · 智能对白气泡 · 原画级单页出图</div>
                        </div>
                    </div>
                    <div class="mw-hdr-controls">
                        <div class="mw-control-group">
                            <label><i class="fa-solid fa-brush" style="color:#f59e0b"></i> 画风:</label>
                            <select id="mw-hdr-style" class="mw-sel">
                                ${Object.entries(COMIC_STYLES).map(([k, v]) => `<option value="${k}" ${store.style === k ? 'selected' : ''}>${v.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="mw-control-group">
                            <label><i class="fa-solid fa-clapperboard" style="color:#6366f1"></i> 文法:</label>
                            <select id="mw-hdr-grammar" class="mw-sel">
                                ${Object.keys(COMIC_GRAMMARS).map(k => `
                                    <option value="${k}" ${store.grammar === k ? 'selected' : ''}>${COMIC_GRAMMARS[k].name}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="mw-control-group">
                            <label><i class="fa-solid fa-crop-simple" style="color:#10b981"></i> 画布:</label>
                            <select id="mw-hdr-ratio" class="mw-sel">
                                <option value="832x1216" ${studio.ratio === '832x1216' ? 'selected' : ''}>纵向单页 (832×1216)</option>
                                <option value="1216x832" ${studio.ratio === '1216x832' ? 'selected' : ''}>跨页展开 (1216×832)</option>
                                <option value="896x1152" ${studio.ratio === '896x1152' ? 'selected' : ''}>宽幅剧场 (896×1152)</option>
                            </select>
                        </div>
                        <div class="mw-control-group">
                            <label><i class="fa-solid fa-border-all" style="color:#ec4899"></i> 留白:</label>
                            <select id="mw-hdr-gutter" class="mw-sel">
                                <option value="bleed" ${store.gutter === 'bleed' ? 'selected' : ''}>天地出血 (Bleed)</option>
                                <option value="framed" ${store.gutter === 'framed' ? 'selected' : ''}>全封闭白边 (Framed)</option>
                                <option value="splash" ${store.gutter === 'splash' ? 'selected' : ''}>沉浸全出血 (Splash)</option>
                                <option value="black_line" ${store.gutter === 'black_line' ? 'selected' : ''}>纯黑线无白边 (Black Line)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Main Body: Dual-Pane Layout -->
                <div class="mw-body">
                    <!-- Left Column: Storyboarder & Panels Stream -->
                    <div class="mw-left-pane">
                        <!-- Story Input Card -->
                        <div class="mw-card mw-story-card">
                            <div class="mw-card-hd">
                                <span class="mw-card-tt"><i class="fa-solid fa-wand-magic-sparkles" style="color:#f59e0b"></i> 剧情故事 / 自然语言叙事描述</span>
                                <div class="mw-card-actions">
                                    <button id="mw-btn-extract-chat" class="mw-btn sm cy" title="提取当前对话最新剧情"><i class="fa-solid fa-comments"></i> 提取当前对话</button>
                                </div>
                            </div>
                            <textarea id="mw-story-input" placeholder="在此输入自然语言故事片段、对话或场景描写，点击「AI 智能分镜推演」自动拆解为画格与镜头机位...">${RBQ.utils.escapeHtml(studio.storyText || '')}</textarea>
                            <div class="mw-story-ft">
                                <div class="mw-opts">
                                    <div style="display:inline-flex;align-items:center;gap:4px;">
                                        <span style="font-size:11.5px;color:#cbd5e1;"><i class="fa-solid fa-table-cells-large" style="color:#f59e0b"></i> 画格数:</span>
                                        <select id="mw-story-panel-count" class="mw-sel" style="padding:2px 6px;font-size:11px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:#fcd34d;cursor:pointer;">
                                            <option value="auto" ${(!studio.panelCountMode || studio.panelCountMode === 'auto') ? 'selected' : ''}>🤖 自动规划 (自适应)</option>
                                            <option value="1" ${studio.panelCountMode === '1' ? 'selected' : ''}>1 格 (单格大画幅)</option>
                                            <option value="2" ${studio.panelCountMode === '2' ? 'selected' : ''}>2 格 (起承 / 对峙)</option>
                                            <option value="3" ${studio.panelCountMode === '3' ? 'selected' : ''}>3 格 (三段节拍)</option>
                                            <option value="4" ${studio.panelCountMode === '4' ? 'selected' : ''}>4 格 (经典四格)</option>
                                            <option value="5" ${studio.panelCountMode === '5' ? 'selected' : ''}>5 格 (密集分镜)</option>
                                        </select>
                                    </div>
                                    <label class="mw-chk-lbl"><input type="checkbox" id="mw-chk-anti-hijack" ${studio.antiHijack !== false ? 'checked' : ''}> <span>角色防夺舍</span></label>
                                    <label class="mw-chk-lbl"><input type="checkbox" id="mw-chk-auto-sfx" ${studio.autoSfx !== false ? 'checked' : ''}> <span>拟音词 (SFX)</span></label>
                                </div>
                                <button id="mw-btn-ai-storyboard" class="mw-btn pri"><i class="fa-solid fa-brain"></i> AI 智能分镜推演</button>
                            </div>
                        </div>

                        <!-- Panels Stream Card -->
                        <div class="mw-card">
                            <div class="mw-card-hd">
                                <span class="mw-card-tt"><i class="fa-solid fa-layer-group" style="color:#f59e0b"></i> 分镜画格序列 (<span id="mw-panel-count-badge">3</span> 格)</span>
                                <div class="mw-card-actions">
                                    <button id="mw-btn-ai-batch" class="mw-btn sm gn" title="根据各个画格填写的剧情句子，批量生成 Danbooru Tag 与镜头"><i class="fa-solid fa-wand-magic-sparkles"></i> 逐格批量生成</button>
                                    <button id="mw-btn-template" class="mw-btn sm cy" title="常用分镜模板"><i class="fa-solid fa-bookmark"></i> 模板</button>
                                    <button id="mw-btn-add-panel" class="mw-btn sm am" title="添加新画格"><i class="fa-solid fa-plus"></i> 加格</button>
                                    <button id="mw-btn-reset-panels" class="mw-btn sm rd" title="重置画格"><i class="fa-solid fa-rotate-left"></i> 重置</button>
                                </div>
                            </div>
                            <div id="mw-panels-list" class="mw-panels-list"></div>
                        </div>

                        <!-- Assembly Prompt Preview Card -->
                        <div class="mw-card">
                            <div class="mw-card-hd">
                                <span class="mw-card-tt"><i class="fa-solid fa-code" style="color:#f59e0b"></i> NAI 原生装配提示词 (Final Prompt Preview)</span>
                                <button id="mw-btn-copy-prompt" class="mw-btn sm"><i class="fa-regular fa-copy"></i> 复制完整 Prompt</button>
                            </div>
                            <div id="mw-assembled-prompt" class="mw-code-block"></div>
                        </div>
                    </div>

                    <!-- Right Column: Live Viewport & Generation Console -->
                    <div class="mw-right-pane">
                        <div class="mw-card">
                            <div class="mw-card-hd">
                                <span class="mw-card-tt"><i class="fa-solid fa-eye" style="color:#f59e0b"></i> 原画级漫画预览画布 (Zero-CLS Viewport)</span>
                                <span id="mw-canvas-res-badge" class="mw-badge">832 × 1216 PX</span>
                            </div>

                            <div class="mw-canvas-wrapper">
                                <div id="mw-canvas-viewport" class="mw-canvas-viewport"></div>
                            </div>

                            <div class="mw-gen-box">
                                <button id="mw-btn-generate" class="mw-btn pri lg"><i class="fa-solid fa-paintbrush"></i> 🎨 一键生成漫画单页</button>
                                <div class="mw-action-row">
                                    <button id="mw-btn-send-chat" class="mw-btn cy" ${studio.lastGeneratedUrl ? '' : 'disabled'}><i class="fa-solid fa-paper-plane"></i> 发送到聊天</button>
                                    <button id="mw-btn-download" class="mw-btn gn" ${studio.lastGeneratedUrl ? '' : 'disabled'}><i class="fa-solid fa-download"></i> 下载原图</button>
                                    <button id="mw-btn-zoom" class="mw-btn" ${studio.lastGeneratedUrl ? '' : 'disabled'}><i class="fa-solid fa-expand"></i> 全屏查看</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const panelsListEl = container.querySelector('#mw-panels-list');
        const promptPreviewEl = container.querySelector('#mw-assembled-prompt');
        const countBadgeEl = container.querySelector('#mw-panel-count-badge');
        const viewportEl = container.querySelector('#mw-canvas-viewport');
        const resBadgeEl = container.querySelector('#mw-canvas-res-badge');
        const btnSendChat = container.querySelector('#mw-btn-send-chat');
        const btnDownload = container.querySelector('#mw-btn-download');
        const btnZoom = container.querySelector('#mw-btn-zoom');
        const btnGenerate = container.querySelector('#mw-btn-generate');

        function updatePromptPreview() {
            if (promptPreviewEl) {
                promptPreviewEl.textContent = composeStudioPrompt(store);
            }
        }

        function updateViewport() {
            if (!viewportEl) return;
            const ratio = studio.ratio || '832x1216';
            const [w, h] = ratio.split('x').map(Number);
            if (w && h) {
                viewportEl.style.aspectRatio = `${w} / ${h}`;
                viewportEl.style.maxWidth = (w > h) ? '480px' : '320px';
            }
            const resText = ratio.replace('x', ' × ') + ' PX';
            if (resBadgeEl) resBadgeEl.textContent = resText;

            if (studio.lastGeneratedUrl) {
                viewportEl.innerHTML = `<img src="${RBQ.utils.escapeHtml(studio.lastGeneratedUrl)}" alt="Generated Manga Page" title="双击大图全屏走查">`;
                viewportEl.querySelector('img')?.addEventListener('dblclick', () => {
                    showMangaViewerModal(studio.lastGeneratedUrl, studio.lastGeneratedPrompt);
                });
                if (btnSendChat) btnSendChat.disabled = false;
                if (btnDownload) btnDownload.disabled = false;
                if (btnZoom) btnZoom.disabled = false;
            } else {
                viewportEl.innerHTML = `
                    <div class="mw-blueprint-placeholder">
                        <div class="mw-bp-panel">Panel 1 · 漫画分镜预览位</div>
                        <div style="display:flex;gap:6px;flex:1;">
                            <div class="mw-bp-panel">Panel 2 · 特写机位</div>
                            <div class="mw-bp-panel">Panel 3 · 对白气泡位</div>
                        </div>
                    </div>
                `;
                if (btnSendChat) btnSendChat.disabled = true;
                if (btnDownload) btnDownload.disabled = true;
                if (btnZoom) btnZoom.disabled = true;
            }
        }

        function renderPanelCards() {
            if (!panelsListEl) return;
            countBadgeEl.textContent = String(studio.panels.length);
            panelsListEl.innerHTML = studio.panels.map((p, idx) => `
                <div class="mw-panel-card" data-idx="${idx}">
                    <div class="mw-panel-hd">
                        <div class="mw-panel-info">
                            <span class="mw-panel-num">#${idx + 1}</span>
                            <input type="text" class="mw-panel-title-in" value="${RBQ.utils.escapeHtml(p.title || '')}" placeholder="画格描述...">
                            <select class="mw-panel-shot-sel">
                                ${renderShotOptions(p.shot)}
                            </select>
                        </div>
                        <div class="mw-panel-btns">
                            <button class="mw-btn sm mw-panel-up" ${idx === 0 ? 'disabled' : ''} title="上移画格"><i class="fa-solid fa-arrow-up"></i></button>
                            <button class="mw-btn sm mw-panel-down" ${idx === studio.panels.length - 1 ? 'disabled' : ''} title="下移画格"><i class="fa-solid fa-arrow-down"></i></button>
                            <button class="mw-btn sm mw-panel-dup" title="复制画格"><i class="fa-regular fa-copy"></i></button>
                            <button class="mw-btn sm rd mw-panel-del" ${studio.panels.length <= 1 ? 'disabled' : ''} title="删除画格"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>

                    <div class="mw-panel-desc-row">
                        <input type="text" class="mw-panel-desc-in" value="${RBQ.utils.escapeHtml(p.desc || '')}" placeholder="✍️ 输入本格剧情描述（如：少女红着脸递出情书）...">
                        <button class="mw-btn sm cy mw-panel-ai-single" title="针对本格填入的句子，单独调用 AI 生成 Tag、机位与对白"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 润色本格</button>
                    </div>

                    <input type="text" class="mw-panel-tag-in" value="${RBQ.utils.escapeHtml(p.tags || '')}" placeholder="输入该画格专属英文 Danbooru / NAI tags...">

                    <div class="mw-bubble-row">
                        <select class="mw-bubble-type-sel">
                            <option value="speech" ${p.bubbleType === 'speech' ? 'selected' : ''}>对白框 (Speech)</option>
                            <option value="thought" ${p.bubbleType === 'thought' ? 'selected' : ''}>心声气泡 (Thought)</option>
                            <option value="screaming" ${p.bubbleType === 'screaming' ? 'selected' : ''}>呐喊爆发 (Scream)</option>
                            <option value="caption" ${p.bubbleType === 'caption' ? 'selected' : ''}>矩形旁白 (Caption)</option>
                            <option value="sfx" ${p.bubbleType === 'sfx' ? 'selected' : ''}>拟音词 (SFX)</option>
                        </select>
                        <input type="text" class="mw-bubble-text-in" value="${RBQ.utils.escapeHtml(p.bubbleText || '')}" placeholder="输入气泡内台词或独白文字...">
                        <select class="mw-bubble-dir-sel">
                            <option value="vertical" ${p.bubbleLayout !== 'horizontal' ? 'selected' : ''}>竖排</option>
                            <option value="horizontal" ${p.bubbleLayout === 'horizontal' ? 'selected' : ''}>横排</option>
                        </select>
                    </div>
                </div>
            `).join('');

            // Bind card input events
            panelsListEl.querySelectorAll('.mw-panel-card').forEach(card => {
                const idx = Number(card.dataset.idx);
                const p = studio.panels[idx];
                if (!p) return;

                card.querySelector('.mw-panel-title-in')?.addEventListener('input', (e) => {
                    p.title = e.target.value;
                    save();
                });
                card.querySelector('.mw-panel-desc-in')?.addEventListener('input', (e) => {
                    p.desc = e.target.value;
                    save();
                });
                const btnSingleAi = card.querySelector('.mw-panel-ai-single');
                btnSingleAi?.addEventListener('click', async () => {
                    const sentence = (p.desc || p.title || '').trim();
                    if (!sentence) {
                        return toastr.warning('请先在本格输入剧情句子（例如：夕阳下少女红着脸低头）', PLUGIN_NAME);
                    }
                    const origHtml = btnSingleAi.innerHTML;
                    btnSingleAi.disabled = true;
                    btnSingleAi.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
                    try {
                        const expanded = await callLlmSingleSentenceExpander(sentence, p.shot, store.grammar, store.language, studio.panels, idx);
                        if (expanded) {
                            if (expanded.title) p.title = expanded.title;
                            if (expanded.shot) p.shot = expanded.shot;
                            if (expanded.tags) p.tags = expanded.tags;
                            if (expanded.bubbleType) p.bubbleType = expanded.bubbleType;
                            if (expanded.bubbleText !== undefined) p.bubbleText = expanded.bubbleText;
                            if (expanded.bubbleLayout) p.bubbleLayout = expanded.bubbleLayout;
                            renderPanelCards();
                            updatePromptPreview();
                            save();
                            toastr.success(`画格 #${idx + 1} 已由 AI 智能生成 Tag 与机位！`, PLUGIN_NAME);
                        }
                    } catch (err) {
                        console.error('[Manga Studio] Single Panel AI error:', err);
                        toastr.error('本格生成失败: ' + (err.message || String(err)), PLUGIN_NAME);
                    } finally {
                        btnSingleAi.disabled = false;
                        btnSingleAi.innerHTML = origHtml;
                    }
                });
                card.querySelector('.mw-panel-shot-sel')?.addEventListener('change', (e) => {
                    if (e.target.value === '__custom__') {
                        const customVal = prompt('请输入自定义机位视角（英文 Tag，例如：dutch angle, extreme low angle, over-the-shoulder）：', p.shot || '');
                        if (customVal && customVal.trim()) {
                            p.shot = customVal.trim();
                        }
                        renderPanelCards();
                    } else {
                        p.shot = e.target.value;
                    }
                    updatePromptPreview();
                    save();
                });
                card.querySelector('.mw-panel-tag-in')?.addEventListener('input', (e) => {
                    p.tags = e.target.value;
                    updatePromptPreview();
                    save();
                });
                card.querySelector('.mw-bubble-type-sel')?.addEventListener('change', (e) => {
                    p.bubbleType = e.target.value;
                    updatePromptPreview();
                    save();
                });
                card.querySelector('.mw-bubble-text-in')?.addEventListener('input', (e) => {
                    p.bubbleText = e.target.value;
                    updatePromptPreview();
                    save();
                });
                card.querySelector('.mw-bubble-dir-sel')?.addEventListener('change', (e) => {
                    p.bubbleLayout = e.target.value;
                    updatePromptPreview();
                    save();
                });

                card.querySelector('.mw-panel-up')?.addEventListener('click', () => {
                    if (idx > 0) {
                        const temp = studio.panels[idx];
                        studio.panels[idx] = studio.panels[idx - 1];
                        studio.panels[idx - 1] = temp;
                        renderPanelCards();
                        updatePromptPreview();
                        save();
                    }
                });
                card.querySelector('.mw-panel-down')?.addEventListener('click', () => {
                    if (idx < studio.panels.length - 1) {
                        const temp = studio.panels[idx];
                        studio.panels[idx] = studio.panels[idx + 1];
                        studio.panels[idx + 1] = temp;
                        renderPanelCards();
                        updatePromptPreview();
                        save();
                    }
                });
                card.querySelector('.mw-panel-dup')?.addEventListener('click', () => {
                    if (studio.panels.length >= 5) {
                        return toastr.warning('最多支持添加 5 个画格', PLUGIN_NAME);
                    }
                    const clone = JSON.parse(JSON.stringify(p));
                    clone.title += ' (副本)';
                    studio.panels.splice(idx + 1, 0, clone);
                    renderPanelCards();
                    updatePromptPreview();
                    save();
                });
                card.querySelector('.mw-panel-del')?.addEventListener('click', () => {
                    if (studio.panels.length <= 1) return;
                    studio.panels.splice(idx, 1);
                    renderPanelCards();
                    updatePromptPreview();
                    save();
                });
            });
        }

        // Header controls bindings
        container.querySelector('#mw-hdr-style')?.addEventListener('change', (e) => {
            store.style = e.target.value;
            save();
            syncMangaToSdt(store);
            updateUiState();
            updatePromptPreview();
        });
        container.querySelector('#mw-hdr-grammar')?.addEventListener('change', (e) => {
            store.grammar = e.target.value;
            save();
            syncMangaToSdt(store);
            updateUiState();
            updatePromptPreview();
        });
        container.querySelector('#mw-hdr-ratio')?.addEventListener('change', (e) => {
            studio.ratio = e.target.value;
            save();
            updateViewport();
            updatePromptPreview();
        });
        container.querySelector('#mw-hdr-gutter')?.addEventListener('change', (e) => {
            store.gutter = e.target.value;
            save();
            syncMangaToSdt(store);
            updateUiState();
            updatePromptPreview();
        });

        // Story input & options
        const storyInputEl = container.querySelector('#mw-story-input');
        storyInputEl?.addEventListener('input', (e) => {
            studio.storyText = e.target.value;
            save();
        });
        container.querySelector('#mw-story-panel-count')?.addEventListener('change', (e) => {
            studio.panelCountMode = e.target.value;
            save();
        });
        container.querySelector('#mw-chk-anti-hijack')?.addEventListener('change', (e) => {
            studio.antiHijack = e.target.checked;
            save();
        });
        container.querySelector('#mw-chk-auto-sfx')?.addEventListener('change', (e) => {
            studio.autoSfx = e.target.checked;
            save();
        });

        // Extract chat narrative
        container.querySelector('#mw-btn-extract-chat')?.addEventListener('click', () => {
            const narrative = extractChatNarrative();
            if (narrative) {
                studio.storyText = narrative;
                if (storyInputEl) storyInputEl.value = narrative;
                save();
                toastr.success('已提取当前酒馆会话的最新剧情！', PLUGIN_NAME);
            }
        });

        // AI Storyboard breakdown
        const btnAi = container.querySelector('#mw-btn-ai-storyboard');
        btnAi?.addEventListener('click', async () => {
            const storyText = (storyInputEl?.value || studio.storyText || '').trim();
            if (!storyText) {
                return toastr.warning('请先输入剧情故事或点击「提取当前对话」', PLUGIN_NAME);
            }
            const origHtml = btnAi.innerHTML;
            btnAi.disabled = true;
            btnAi.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在解析分镜与镜头机位...';
            try {
                const parsedPanels = await callLlmStoryboardParser(
                    storyText,
                    store.grammar,
                    store.language,
                    studio.panelCountMode || 'auto',
                    (status) => {
                        btnAi.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${status}`;
                    }
                );
                if (Array.isArray(parsedPanels) && parsedPanels.length > 0) {
                    studio.panels = parsedPanels;
                    renderPanelCards();
                    updatePromptPreview();
                    save();
                    toastr.success(`🎉 AI 智能分镜解析完成，已构建 ${parsedPanels.length} 格分镜！`, PLUGIN_NAME);
                }
            } catch (err) {
                console.error('[Manga Studio] AI Storyboard Error:', err);
                toastr.error('分镜解析出现异常: ' + (err.message || String(err)), PLUGIN_NAME);
            } finally {
                btnAi.disabled = false;
                btnAi.innerHTML = origHtml;
            }
        });

        // Batch AI generate for all panels
        const btnBatchAi = container.querySelector('#mw-btn-ai-batch');
        btnBatchAi?.addEventListener('click', async () => {
            const hasAnyDesc = studio.panels.some(p => (p.desc || p.title || '').trim());
            if (!hasAnyDesc) {
                return toastr.warning('请先在画格中填写剧情句子', PLUGIN_NAME);
            }
            const origHtml = btnBatchAi.innerHTML;
            btnBatchAi.disabled = true;
            btnBatchAi.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 批量解析中...';
            try {
                const results = await callLlmBatchSentenceExpander(
                    studio.panels,
                    store.grammar,
                    store.language,
                    (msg) => {
                        btnBatchAi.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${msg}`;
                    }
                );
                if (Array.isArray(results) && results.length > 0) {
                    results.forEach((item, i) => {
                        const targetPanel = studio.panels[i];
                        if (targetPanel && item) {
                            if (item.title) targetPanel.title = item.title;
                            if (item.shot) targetPanel.shot = item.shot;
                            if (item.tags) targetPanel.tags = item.tags;
                            if (item.bubbleType) targetPanel.bubbleType = item.bubbleType;
                            if (item.bubbleText !== undefined) targetPanel.bubbleText = item.bubbleText;
                            if (item.bubbleLayout) targetPanel.bubbleLayout = item.bubbleLayout;
                        }
                    });
                    renderPanelCards();
                    updatePromptPreview();
                    save();
                    toastr.success(`🎉 已完成全部 ${studio.panels.length} 个画格的批量生成！`, PLUGIN_NAME);
                }
            } catch (err) {
                console.error('[Manga Studio] Batch AI error:', err);
                toastr.error('批量生成失败: ' + (err.message || String(err)), PLUGIN_NAME);
            } finally {
                btnBatchAi.disabled = false;
                btnBatchAi.innerHTML = origHtml;
            }
        });

        // Add panel button
        container.querySelector('#mw-btn-add-panel')?.addEventListener('click', () => {
            if (studio.panels.length >= 5) {
                return toastr.warning('单页漫画最多支持 5 个画格', PLUGIN_NAME);
            }
            studio.panels.push({
                title: `第 ${studio.panels.length + 1} 格 · 画面`,
                desc: '',
                shot: 'medium shot',
                tags: '1girl, expressive eyes',
                bubbleType: 'speech',
                bubbleText: '',
                bubbleLayout: 'vertical'
            });
            renderPanelCards();
            updatePromptPreview();
            save();
        });

        // Preset templates button
        container.querySelector('#mw-btn-template')?.addEventListener('click', () => {
            showPresetPickerModal((preset) => {
                studio.panels = JSON.parse(JSON.stringify(preset.panels));
                if (preset.grammar && COMIC_GRAMMARS[preset.grammar]) {
                    store.grammar = preset.grammar;
                    const gSel = container.querySelector('#mw-hdr-grammar');
                    if (gSel) gSel.value = preset.grammar;
                    syncMangaToSdt(store);
                    updateUiState();
                }
                renderPanelCards();
                updatePromptPreview();
                save();
                toastr.success(`已载入分镜模板「${preset.name}」`, PLUGIN_NAME);
            });
        });

        // Reset panels button
        container.querySelector('#mw-btn-reset-panels')?.addEventListener('click', () => {
            if (!confirm('确定要重置当前工作台的分镜画格吗？')) return;
            const defaultPreset = STORYBOARD_PRESETS[0];
            studio.panels = JSON.parse(JSON.stringify(defaultPreset.panels));
            renderPanelCards();
            updatePromptPreview();
            save();
            toastr.info('分镜画格已重置为初始状态', PLUGIN_NAME);
        });

        // Copy assembled prompt button
        container.querySelector('#mw-btn-copy-prompt')?.addEventListener('click', () => {
            const prompt = composeStudioPrompt(store);
            RBQ.utils.copyToClipboard(prompt);
            toastr.success('已复制完整 NAI 漫画装配提示词！', PLUGIN_NAME);
        });

        // Generate Manga Single Page button
        btnGenerate?.addEventListener('click', async () => {
            if (!RBQ.api || typeof RBQ.api.generateImage !== 'function') {
                return toastr.error('RBQ Core 生图接口不可用', PLUGIN_NAME);
            }
            const prompt = composeStudioPrompt(store);
            const origHtml = btnGenerate.innerHTML;
            btnGenerate.disabled = true;
            btnGenerate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在向生图引擎提交漫画任务...';

            isStudioGenerating = true;
            studioGenerationRatio = studio.ratio || '832x1216';

            try {
                const result = await RBQ.api.generateImage(prompt, 'manga-workshop', {}, (progress) => {
                    if (typeof progress === 'string') {
                        btnGenerate.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${progress.slice(0, 16)}...`;
                    }
                });

                if (result && result.url) {
                    studio.lastGeneratedUrl = result.url;
                    studio.lastGeneratedPrompt = prompt;
                    save();
                    updateViewport();
                    toastr.success('🎉 漫画单页生成完毕！', PLUGIN_NAME);
                } else {
                    throw new Error('未返回有效图像地址');
                }
            } catch (err) {
                console.error('[Manga Studio] 出图失败:', err);
                toastr.error('漫画单页生成失败: ' + (err.message || String(err)), PLUGIN_NAME);
            } finally {
                isStudioGenerating = false;
                studioGenerationRatio = null;
                btnGenerate.disabled = false;
                btnGenerate.innerHTML = origHtml;
            }
        });

        // Send to current tavern chat
        btnSendChat?.addEventListener('click', () => {
            if (!studio.lastGeneratedUrl) return;
            try {
                const ctx = RBQ.api.getContext?.();
                const chat = ctx?.chat;
                const latestId = Array.isArray(chat) && chat.length > 0 ? chat.length - 1 : 0;

                const wrapper = RBQ.api.createPromptCard({
                    messageId: latestId,
                    prompt: studio.lastGeneratedPrompt,
                    id: `manga-studio:${Date.now()}`,
                    label: 'manga-studio'
                });

                if (wrapper && typeof RBQ.api.renderInlineGeneratedImage === 'function') {
                    RBQ.api.renderInlineGeneratedImage(wrapper, {
                        url: studio.lastGeneratedUrl,
                        prompt: studio.lastGeneratedPrompt
                    });
                    toastr.success('已将漫画单页插入当前会话最新消息下方！', PLUGIN_NAME);
                } else {
                    toastr.info('已将漫画单页加入图库记录', PLUGIN_NAME);
                }
            } catch (e) {
                console.error('[Manga Studio] 发送到聊天失败:', e);
                toastr.error('发送到聊天失败: ' + (e.message || String(e)), PLUGIN_NAME);
            }
        });

        // Download HD PNG
        btnDownload?.addEventListener('click', () => {
            downloadGeneratedImage(studio.lastGeneratedUrl);
        });

        // Fullscreen zoom viewer
        btnZoom?.addEventListener('click', () => {
            if (studio.lastGeneratedUrl) {
                showMangaViewerModal(studio.lastGeneratedUrl, studio.lastGeneratedPrompt);
            }
        });

        // Initial Renders
        renderPanelCards();
        updatePromptPreview();
        updateViewport();

        refreshMangaWorkshop = () => {
            try {
                const s = getStore();
                const styleSel = container.querySelector('#mw-hdr-style');
                if (styleSel && styleSel.value !== s.style) styleSel.value = s.style;
                const gramSel = container.querySelector('#mw-hdr-grammar');
                if (gramSel && gramSel.value !== s.grammar) gramSel.value = s.grammar;
                const gutSel = container.querySelector('#mw-hdr-gutter');
                if (gutSel && gutSel.value !== s.gutter) gutSel.value = s.gutter;
                const ratioSel = container.querySelector('#mw-hdr-ratio');
                if (ratioSel && ratioSel.value !== s.studio?.ratio) ratioSel.value = s.studio?.ratio || '832x1216';

                updatePromptPreview();
                updateViewport();
            } catch (_e) {}
        };
    }

    // 注册侧边栏独立 Tab: 漫画工作台 (Manga Studio)
    if (RBQ.ui && typeof RBQ.ui.addSettingPanel === 'function') {
        RBQ.ui.addSettingPanel('manga-workshop', '<i class="fa-solid fa-book-open"></i><span>漫画工作台</span>', () => {
            const w = document.createElement('div');
            w.id = 'mw-root-container';
            w.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;';
            renderMangaWorkshop(w);
            return w;
        });
    }

    // 监听进入漫画工作台的切换事件
    document.addEventListener('rbq-tab-switched', (e) => {
        if (e.detail?.tab === 'manga-workshop' && typeof refreshMangaWorkshop === 'function') {
            refreshMangaWorkshop();
        }
    });

    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('[data-kite-tab="manga-workshop"]') && typeof refreshMangaWorkshop === 'function') {
            setTimeout(refreshMangaWorkshop, 40);
        }
    });

    // ── 8. DOM Mounting & Lifecycle Guard ─────────────────────────
    try {
        injectStyles();
    } catch (e) {
        console.warn(`[${PLUGIN_NAME}] injectStyles error:`, e);
    }

    let mountPollTimer = null;
    let pollCount = 0;
    const MAX_POLLS = 60; // 30s max

    function checkAndMount() {
        pollCount++;
        const card = document.getElementById('rbq-manga-mode-card');
        const sysPresetSelect = document.getElementById('rbq-sdt-system-preset');

        if (card) {
            if (mountPollTimer) {
                clearInterval(mountPollTimer);
                mountPollTimer = null;
            }
            updateUiState();
            return true;
        }

        if (sysPresetSelect) {
            injectUiIntoSdt();
            if (mountPollTimer) {
                clearInterval(mountPollTimer);
                mountPollTimer = null;
            }
            return true;
        }

        if (pollCount >= MAX_POLLS && mountPollTimer) {
            clearInterval(mountPollTimer);
            mountPollTimer = null;
        }
        return false;
    }

    // 首次立即挂载
    if (!checkAndMount()) {
        mountPollTimer = setInterval(checkAndMount, 500);
    }

    // 针对用户随时点击模态框/标签页/按钮时被动兜底触发
    const onUserInteraction = (e) => {
        const t = e.target;
        if (t && t.closest && (t.closest('[data-kite-tab="smart-draw"]') || t.closest('#st-scene-trigger-options-btn') || t.closest('.st-scene-trigger-floating-btn') || t.closest('#st-scene-trigger-modal'))) {
            setTimeout(checkAndMount, 80);
        }
    };
    document.addEventListener('click', onUserInteraction, { passive: true });

    // 如果一开始就处于开启状态，静默同步 SDT 状态，绝不触发写盘网络保存
    try {
        const currentStore = getStore();
        if (currentStore.enabled) {
            syncMangaToSdt(currentStore, false);
        }
    } catch (e) {
        console.warn(`[${PLUGIN_NAME}] Initial store sync error:`, e);
    }

    // 卸载与清理函数
    function cleanup() {
        if (mountPollTimer) {
            clearInterval(mountPollTimer);
            mountPollTimer = null;
        }
        document.removeEventListener('click', onUserInteraction);
        const styleEl = document.getElementById(STYLE_TAG_ID);
        if (styleEl) styleEl.remove();
        const cardEl = document.getElementById('rbq-manga-mode-card');
        if (cardEl) cardEl.remove();

        // 移除漫画工作台面板与临时弹窗
        if (RBQ.ui && typeof RBQ.ui.removeSettingPanel === 'function') {
            RBQ.ui.removeSettingPanel('manga-workshop');
        }
        document.getElementById('mw-root-container')?.remove();
        document.getElementById('mw-viewer-modal')?.remove();
        document.getElementById('mw-preset-modal')?.remove();

        // 还原 SDT 提示词预设下拉框
        const sysPresetSelect = document.getElementById('rbq-sdt-system-preset');
        if (sysPresetSelect) {
            sysPresetSelect.disabled = false;
            const field = sysPresetSelect.closest('.st-scene-trigger-field');
            if (field) {
                field.classList.remove('rbq-sdt-preset-locked');
                const badge = field.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }

        // 还原 SDT 前情增强分析下拉框
        const ecSelect = document.getElementById('rbq-sdt-enhanced-context');
        if (ecSelect) {
            ecSelect.disabled = false;
            const field = ecSelect.closest('.st-scene-trigger-field');
            if (field) {
                field.classList.remove('rbq-sdt-preset-locked');
                const badge = field.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }

        // 还原 SDT 多角色开关与坐标框
        const mcCheck = document.getElementById('rbq-sdt-multichar');
        if (mcCheck) {
            mcCheck.disabled = false;
            const field = mcCheck.closest('.st-scene-trigger-field');
            if (field) {
                field.classList.remove('rbq-sdt-preset-locked');
                const badge = field.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }
        const coordsCheck = document.getElementById('rbq-sdt-multichar-coords');
        if (coordsCheck) {
            coordsCheck.disabled = false;
            const field = coordsCheck.closest('.st-scene-trigger-field');
            if (field) {
                field.classList.remove('rbq-sdt-preset-locked');
                const badge = field.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }

        // 还原 SDT 后台预设
        try {
            const s = getStore();
            s.enabled = false;
            syncMangaToSdt(s, true);
        } catch (_e) {}

        console.info(`[${PLUGIN_NAME}] 插件已彻底卸载并清理`);
    }

    RBQ.registerCleanup(PLUGIN_ID, cleanup);
    console.info(`[${PLUGIN_NAME}] v${VERSION} 已就绪`);

    } catch (err) {
        console.error('[Manga Mode] Uncaught initialization error:', err);
    }
})((typeof RBQ !== 'undefined' ? RBQ : (window.RBQ || null)), (typeof jQuery !== 'undefined' ? jQuery : window.$), (typeof toastr !== 'undefined' ? toastr : { success: console.log, warning: console.warn, error: console.error, info: console.info }));
