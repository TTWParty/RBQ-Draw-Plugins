(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[Manga Mode] RBQ Core API missing');

    try {
        const PLUGIN_ID = 'rbq-manga-mode';
        const PLUGIN_NAME = '漫画模式 (Manga Mode)';
        const STORAGE_KEY = '_mangaMode';
        const SDT_KEY = '_smartDrawTrigger';
        const VERSION = '1.1.4';

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
                gutter: 'bleed', // bleed | framed | splash
                autoSpread: true, // 智能跨页 (見開きページ)
                antiHijack: true, // 同人角色防夺舍
            };
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

    // ── 4. Prompt Assembly for SDT Tagger LLM ──────────────────────
    function buildMangaSystemPrompt(store) {
        const grammarObj = GRAMMAR_PRESETS[store.grammar] || GRAMMAR_PRESETS.cinema;
        const langRule = store.language === 'ja'
            ? '[TEXT-LANG: JA]\n对白、心声、旁白与拟音文字一律转译为地道标准的日文，并在对应人物槽位末尾写入 Text: [日文文本]。'
            : '[TEXT-LANG: ZH-HANS]\n对白、心声、旁白与拟音文字一律写成简体中文，并在对应人物槽位末尾写入 Text: [中文文本]。';

        const gutterRule = store.gutter === 'framed'
            ? '[GUTTER-BLEED: FULLY-FRAMED]\n全封闭内枠：四周带经典漫画白边框架，格与格之间边界清晰分明。'
            : (store.gutter === 'splash'
                ? '[GUTTER-BLEED: IMMERSIVE-SPLASH]\n沉浸全出血：整幅画格完全贴边撑满画面，极大增强画面代入感。'
                : (store.gutter === 'black_line'
                    ? '[GUTTER-BLEED: ZERO-WHITE-BORDER]\n全幅零白留白：画格之间无白色缝隙，画布边缘无外白边，完全由粗黑墨线（太い黒い仕切り線, 太いインクの枠, 余白なし, コマが密着）密着切分。'
                    : '[GUTTER-BLEED: TOP-BOTTOM-BLEED]\n天地出血：天头地脚贴边无白边，内框横纵格间距紧凑，关键画格允许单侧出血突破边框。'));

        const colorRule = (store.style === 'monochrome')
            ? `9. 色彩模式（来自原版 v1.1.json 条目 23 [COLOR-MODE: MONOCHROME]）：
- 当前处于黑白漫画模式：严禁在 scene、characters 的服装外貌或动作中输出任何具体彩色词；具体色相（青/茶/粉/赤/蓝/绿等）一律改写为 dark/light/white/black/gray 等灰阶明暗词。
- 每一页页面描述必须写上介质词：モノクロ, グレースケール, スクリーントーン。不要写 full color，不要写 warm light 等带色相的词。
- 各格只写所属场景的光源方向和明暗，不写环境色。\n`
            : (store.style === 'soft_color'
                ? `9. 色彩模式（来自原版 v1.1.json 条目 24 [COLOR-MODE: FULL-COLOR]）：
【全彩漫画继承规则】人物保持本轮已确定的发色、瞳色、服装与配饰颜色。新写视觉词优先使用有效英文标签，必要时使用简短英日短句。页面按实际场景使用 full color 及适用的光影视觉词。\n`
                : '');

        const antiHijackRule = (store.antiHijack && store.style !== 'custom')
            ? '10. 画风保护（来自原版 v1.1.json [ANTI-FRANCHISE-HIJACK]）：\n同人角色出场时，仅将其特征作为固有外貌DNA使用，严格禁止同人角色的游戏原作官方立绘画风覆盖选定的漫画黑白/网点风格。\n'
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
     \`comic, 複数コマの漫画ページ, N panels (按实际规划画格数写如 3 panels / 4 panels / 5 panels), manga page layout, vertical layout, white border, dynamic komawari, [本页纯客观环境描述如 classroom, sunset lighting / living room, couch, dramatic shadows]\`
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

    RBQ.on('buildNaiV4Payload', (payload) => {
        const store = getStore();
        if (!store.enabled) return payload;

        console.info(`[${PLUGIN_NAME}] 正在应用漫画模式 Payload 增强...`);

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
            if (payload.input) {
                payload.input = `${stylePositive}, ${payload.input}`;
            }
            if (payload.parameters?.v4_prompt?.caption?.base_caption) {
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
                if (/\b(?:BubbleType|Text)[ \t]*[:：]/i.test(baseText)) {
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
                    const gutterTag = store.gutter === 'black_line' ? '太い黒い仕切り線, 余白なし' : (store.gutter === 'splash' ? '全面裁ち落とし, 余白なし' : 'white border');
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

    // ── 7. DOM Mounting & Lifecycle Guard ─────────────────────────
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
