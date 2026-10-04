(function(RBQ, $, toastr) {
    if (!RBQ) return console.error('[Manga Mode] RBQ Core API missing');

    try {
        const PLUGIN_ID = 'rbq-manga-mode';
        const PLUGIN_NAME = '漫画模式 (Manga Mode)';
        const STORAGE_KEY = '_mangaMode';
        const SDT_KEY = '_smartDrawTrigger';
        const VERSION = '1.9.0';

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
                panels: createInitialStudioPanels(),
            };
        }
        if (!s[STORAGE_KEY].studio.panelCountMode) {
            s[STORAGE_KEY].studio.panelCountMode = 'auto';
        }
        return s[STORAGE_KEY];
    }

    function createInitialStudioPanels() {
        return [
            { title: '起景 · 黄昏教室', desc: '少女红着脸低下头，手指捏着裙角。', shot: 'medium shot', tags: 'classroom, sunset, window light',
                characters: [{ character_id: 'C1', name: '少女', positive: 'girl, adult, long dark hair, light blouse, pleated skirt, looking down, blush, fidgeting with skirt, BubbleType: 思考の吹き出し, 右上, Layout: 縦書き, Text: 心跳……怎么会这么快……', negative: '' }] },
            { title: '递信特写', desc: '双手递出一封信。', shot: 'close-up on hands', tags: 'classroom',
                characters: [{ character_id: 'C1', name: '少女', positive: 'girl, hands, light blouse sleeves, holding envelope with both hands, BubbleType: 通常吹き出し, 画面外, Layout: 縦書き, Text: 请、请收下这个！', negative: '' }] },
            { title: '神情骤变', desc: '少女惊愕地抬头。', shot: 'face close-up', tags: 'classroom, window light',
                characters: [{ character_id: 'C1', name: '少女', positive: 'girl, adult, long dark hair, wide eyes, tears, BubbleType: 叫び吹き出し, 口元, Layout: 縦書き, Text: ……欸？！', negative: '' }] }
        ];
    }

    function getSdtStore() {
        const s = RBQ.api.getSettings();
        if (!s[SDT_KEY]) s[SDT_KEY] = {};
        return s[SDT_KEY];
    }

    function save() {
        RBQ.api.saveSettings();
    }

    // ── 2. Built-in Comic Art Styles (基于原版 v1.1.json 条目 64 与 63，含兼容负面词) ──
    const COMIC_STYLES = {
        monochrome: {
            name: '黑白 (画风-黑白)',
            positive: 'artist:2015x127, 0.5::artist:du_nyak::, 0.5::artist:yujo_kei::, greyscale, monochrome, screentone, manga, bold linework, incredibly absurdres, very aesthetic, highres, masterpiece, best quality, amazing quality, best illustration',
            negative: '10::color::, colorful, vibrant colors, painted, watercolor, pastel, logo, watermark, too many watermarks, reference, signature, artist name, dated, chibi, artistic error, scan artifacts, jpeg artifacts, aliasing, chromatic aberration, digital dissolve, artist collaboration, one-hour drawing challenge, mutated, mutation, deformed, distorted, disfigured, bad anatomy, unnatural hair, bad face, mob face, cloned face, distorted face, poorly drawn face, ugly, bad eyes, empty eyes, extra eyes, lazy eye, asymmetrical eyes, cross-eyed, bad proportions, wrong body proportions, unrealistic proportions, distorted body, long neck, wrong head size, bad limbs, missing limbs, extra limbs, amputee, bad arm, bad hands, malformed hands, poorly drawn hands, bad hand structure, extra digits, fewer digits, extra fingers, fused fingers, bad leg, extra leg, distorted composition, bad perspective, disorganized colors, unfinished, incomplete, duplicate, worst quality, bad quality, messy details, fewer details, bad portrait, awkward, bad posture',
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
- page.base 明确主格位置与大致面积，以及辅助格宽窄、高低和相互排列；各格大小有主次，不把每页默认排成等高通栏；
- 辅助格服务剩余事件、反应或局部细节；按需要选用左右并列、纵长格、通栏或插入格，写出实际位置，不罗列技法名；
- 主格不必最先阅读。人物 positive 与本格 description 使用同一个位置称呼；同一位置出现插入格时注明大小与相对关系；
- 景别层次丰富：远景交代空间（wide shot, establishing shot），中景呈现互动（medium shot, cowboy shot），近景/特写捕捉微表情与眼神光（close-up, face focus）；
- 视平线、俯角与仰角结合剧情动态切换（from above, from below, dutch angle）。`
        },
        '4koma': {
            name: '经典四格 (Classic 4-Koma)',
            instruction: `[SHOT-GRAMMAR: 4-KOMA]
经典四格分镜规范：
- 严格遵循“起、承、转、结”四阶梯垂直等宽等距排布（4 panels, vertical layout）；
- 四格按正文先后承接铺垫、推进、变化和收束；原文没有转折或笑点时，不凭空制造；
- 画格方正均等，画面重心清晰平衡。`
        },
        shonen: {
            name: '少年热血 (Shonen Action)',
            instruction: `[SHOT-GRAMMAR: SHONEN-ACTION]
少年热血漫画分镜文法（Jump系/热血动作风格）：
- 有关键动作时扩大动势格，可用通栏或斜切大格；静态对话按信息量排版；
- 冲突升级时可采用不规则斜切边框（slanted panels）；静态交代和反应格保持清晰，不为文法强行增加画格；
- 根据实际动作采用速度线与透视缩短（speed lines, foreshortening, dynamic angle），静态镜头不加无依据的运动效果；
- 冲击瞬间可突破画格边界，人物接触关系保持清晰。`
        },
        mystery: {
            name: '悬疑推理 (Mystery & Suspense)',
            instruction: `[SHOT-GRAMMAR: SEINEN-SUSPENSE]
青年悬疑推理分镜文法（死亡笔记/Monster风格）：
- 采用宽画幅横向长视线格（widescreen panel）；
- 节奏凝重克制，强调压迫感与时间拉长感；
- 依据原有神态选择微表情或眼神特写（extreme close-up），不为制造悬疑改变照明和态度；
- 仅对正文已有的线索、证物或观察动作安排特写，不凭空添加证据。`
        },
        shojo: {
            name: '恋爱少女 (Shojo Romance)',
            instruction: `[SHOT-GRAMMAR: SHOJO-ROMANCE]
精致装饰系少女漫分镜文法（CLAMP/少女漫经典风格）：
- 根据原有情绪选择表情特写或竖向构图，不强制全身、心动或对视；
- 保留发型结构、服饰材质与实际姿态，不因文法改变外貌；
- 可用装饰花纹、光斑和柔化边框表达已有情绪；装饰不变成场景中实际存在的花朵；
- 心声特写只承载原文已有内容。`
        },
        daily: {
            name: '轻松日常 (Slice of Life)',
            instruction: `[SHOT-GRAMMAR: SLICE-OF-LIFE]
轻松日常系分镜文法（四叶妹妹/高木同学风格）：
- 规整横读格为主，间距宽松均匀，阅读节奏轻快无压力；
- 节奏随原有日常互动推进，允许平静收束，不强制反应落差；
- 表情与眼神对应正文，不统一添加颜艺或笑容；
- 边界清晰稳定，突出可读性与生活细节。`
        },
        comedy: {
            name: '喜剧搞笑 (Comedy & Gag)',
            instruction: `[SHOT-GRAMMAR: COMEDY-GAG]
爆笑喜剧日常分镜文法（月刊少女野崎君式）：
- 方正规整画格服务于喜剧包袱节奏，吐槽链条紧凑；
- 仅在原文已有夸张反应时使用 exaggerated expression 或 sweatdrop，不强制变成 Q 版或制造笑点；
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
        cinema: 'cinematic composition',
        '4koma': '4koma, 4 panels, yonkoma',
        shonen: 'shonen manga',
        mystery: 'seinen, suspense',
        shojo: 'shojo manga',
        daily: 'slice of life, daily scene, relaxed composition',
        comedy: 'comedy, gag manga',
        ecchi: 'sensual manga, body contour framing'
    };

    const GUTTER_PRESETS = {
        bleed: {
            name: '天地出血 (Top-Bottom Bleed)',
            tag: 'top-bottom bleed, narrow gutters',
            instruction: `[GUTTER-BLEED: TOP-BOTTOM-BLEED]
天地出血：天头地脚贴边无白边，内框横纵格间距紧凑，关键画格允许单侧出血突破边框。同一时段格间紧凑，明确时间跳跃可适当加宽；回忆格可用黑色格外底区标识，不改变场景本身照明。`
        },
        framed: {
            name: '全封闭白边内枠 (Fully-Framed)',
            tag: 'white border, fully framed panels',
            instruction: `[GUTTER-BLEED: FULLY-FRAMED]
全封闭内枠：四周带经典漫画白边框架，格与格之间边界清晰分明；回忆可用该格外部黑底区别，不把回忆场景自动画暗。`
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
    // Shared contract: SDT and Studio compile the same page/panels/characters tree.
    function mangaSegmentSchema() {
        const string = { type: 'string' };
        return {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['nai5-comic'] },
                label: string,
                position_mode: { type: 'string', enum: ['auto', 'manual'], description: 'Optional; defaults to auto. Use manual only with explicit centers for every visible appearance.' },
                intent: { type: 'string', description: '可选；一句话说明本页主画面' },
                anchor: { type: 'object', properties: { text: string }, required: ['text'] },
                page: {
                    type: 'object', properties: {
                        base: { type: 'string', description: 'Actual people/panel counts and page form; dominant panel position + approximate page area, supporting panel sizes + adjacency, reading path and lighting. No dialogue. Not just vertical layout.' },
                        non_character: { type: 'string', description: 'Optional non-person text: bubble/SFX/layout visuals BEFORE a single final Text: containing only literal text.' }
                    }, required: ['base']
                },
                panels: {
                    type: 'array', minItems: 1,
                    items: {
                        type: 'object',
                        properties: {
                            id: string,
                            description: { type: 'string', description: 'Panel position/size, shot and environment tags. No P1: prose, character actions or dialogue.' },
                            non_character: { type: 'string', description: 'Only caption, SFX or truly offscreen speech, with this panel position and source. Visible speakers MUST put speech in their own positive, not here. Visuals before final Text:.' },
                            characters: {
                                type: 'array', items: {
                                    type: 'object', properties: {
                                        character_id: string, name: { type: 'string', description: 'Full drawing identity: known name (original) for original characters, confirmed Name (Series) for fan characters. Reuse established identity across panels; never replace with a panel ID.' },
                                        base: { type: 'string', description: 'Full stable appearance tags, same as ordinary character memory. Program injects the full name identity; preserve identity tags already in saved base. Reuse saved base exactly; no shot-based cropping. No clothes or dialogue.' },
                                        outfit: { type: 'string', description: 'Full current outfit including all layers/accessories. Empty reuses known outfit; return complete clothing on first appearance or actual change.' },
                                        state: { type: 'object', properties: {
                                            base: { type: 'string', description: 'Only an explicit plot appearance change: complete temporary appearance tags after the change, retaining all unchanged identity traits. Not a crop and never permanent memory.' },
                                            outfit: { type: 'string', description: 'Complete known outfit after explicit change, or opening outfit when no saved outfit / history differs. Empty clears clothes. No action.' }
                                        }, description: 'Optional changes take effect from this appearance onward, even off camera. Omit unchanged fields.' },
                                        ...(getStore().style === 'monochrome' ? { render: { type: 'object', properties: {
                                            base: { type: 'string', description: 'Complete grayscale drawing view of the resolved original base/state.base. Preserve names, identity, age, height and structure. First appearance or actual appearance change only; omit unchanged member to reuse.' },
                                            outfit: { type: 'string', description: 'Complete grayscale drawing view of the current original outfit/state.outfit including all layers. First appearance or actual outfit change only; omit unchanged member to reuse. Empty only for no clothing.' }
                                        }, description: 'Black-and-white drawing only; NEVER character memory. Translate color to grayscale, retain all other known traits. Unchanged appearances omit this object.' } } : {}),
                                        positive: { type: 'string', description: 'This appearance only: panel position, pose, limb action with object/contact, expression/gaze and speech. Identity and clothing belong in base/outfit. BubbleType/location/Layout BEFORE one final Text:.' },
                                        negative: string,
                                        center: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } }, required: ['x', 'y'], description: 'Required only in manual mode; normalized position on the entire page, not inside the panel.' }
                                    }, required: ['character_id', 'base', 'outfit', 'positive', 'negative']
                                }
                            }
                        }, required: ['id', 'description', 'characters']
                    }
                }
            }, required: ['format', 'anchor', 'page', 'panels']
        };
    }

    function mangaOutputSchema() {
        return {
            shouldDraw: 'boolean (有值得画的剧情为 true，否则 segments=[])',
            reason: 'string (简述画哪些剧情、共几页、如何分配；无需长篇推理)',
            segments: [{
                format: 'nai5-comic', label: 'Page 1: 本页标题',
                intent: '可选；一句话说明本页主画面',
                anchor: { text: '从本页对应正文逐字摘录的10~40字原句' },
                page: { base: '本页人数、页面形态、格数、主格位置及大致面积、辅助格大小与排列、阅读路径、光影；不能只写 vertical layout', non_character: '整页非人物文字；格式说明在前，实际原句放唯一末尾 Text: 后；可省略' },
                panels: [{
                    id: 'P1', description: '英文逗号分隔的位置、大小、景别、环境标签；不写人物演出或故事长句',
                    non_character: '本格旁白、拟音、画外声的视觉说明和末尾 Text:；可省略',
                    characters: [{
                        character_id: 'C1', name: '完整绘图身份：原创 Name (original)，同人已确认的 Name (Series)；跨格同名，程序拼入外貌',
                        base: '与普通模式一致的完整固定外貌；已有档案原样复用，不按镜头裁剪',
                        outfit: '完整当前服装，含内外层与配饰；空字符串沿用已知衣着',
                        state: { base: '可选；明确外貌变化后的完整原色临时快照，不回写固定外貌', outfit: '可选；明确换装后的完整原色衣着；空字符串清空衣物' },
                        ...(getStore().style === 'monochrome' ? { render: { base: '本次绘图完整灰阶外貌；首次或外貌变化时输出，其他格省略沿用；不写回记忆', outfit: '本次绘图完整灰阶衣着；首次或换装时输出，其他格省略沿用；空仅表示无衣物' } } : {}),
                        positive: '本格位置、姿势、肢体动作与对象、表情视线；外貌服装放 base/outfit；气泡说明在唯一末尾 Text: 前，后面只有台词',
                        negative: '仅针对本次人物出场的互斥特征；没有则为空'
                    }]
                }]
            }]
        };
    }

    function splitMangaText(value) {
        const text = String(value || '').trim();
        const marker = /\bText[ \t]*[:：]/i.exec(text);
        if (!marker) return { visual: text, text: '' };
        let visual = text.slice(0, marker.index).replace(/[,\s]+$/, '');
        let literal = text.slice(marker.index + marker[0].length).trim();
        // Recover only an unambiguous protocol header accidentally placed after Text:.
        // Ordinary dialogue containing "Text:" or "Layout:" stays opaque.
        const bubble = /^(?:BubbleType\s*[:：]\s*)?(?:通常吹き出し|叫び吹き出し|吹き出し|ギザギザ吹き出し|思考の吹き出し|破線吹き出し|波打つ吹き出し|四角い吹き出し|ナレーション枠|矩形のナレーション枠|切り欠きのある吹き出し|しっぽなしの楕円吹き出し|連結吹き出し)$/i;
        const layout = /^Layout\s*[:：]\s*(?:縦書き|横書き)$/i;
        const location = /^(?:右上|左上|右下|左下|口元|画面外|頭上|上部|下部)$/;
        const sfx = /^(?:SFX\s*[:：]\s*擬音|吹き出しなし)$/i;
        const recoverHeader = (part, explicit = false) => {
            const next = /\bText[ \t]*[:：]/i.exec(part);
            if (!next) return null;
            const tokens = part.slice(0, next.index).split(/[,，\n]+/).map(t => t.trim()).filter(Boolean);
            if (!tokens.length || !tokens.some(t => bubble.test(t) || layout.test(t) || sfx.test(t))
                || !tokens.every(t => bubble.test(t) || layout.test(t) || location.test(t) || sfx.test(t))
                || (explicit && !tokens.some(t => /^(?:BubbleType|SFX)\s*[:：]/i.test(t)))) return null;
            const header = tokens.map(t => bubble.test(t) && !/^BubbleType/i.test(t) ? `BubbleType: ${t}` : t).join(', ');
            visual = [visual, header].filter(Boolean).join(', ');
            return part.slice(next.index + next[0].length).trim();
        };
        for (;;) {
            const recovered = recoverHeader(literal);
            if (recovered === null) break;
            literal = recovered;
        }
        // Legacy captions may interleave later bubble headers with real dialogue.
        // Only an independent paragraph starting with explicit, known protocol
        // fields is recoverable; inline mentions and quoted examples stay literal.
        literal = literal.split(/(\n[ \t]*\n)/).map((part, index) => {
            if (index < 2 || index % 2) return part;
            let recovered;
            while ((recovered = recoverHeader(part, true)) !== null) part = recovered;
            return part;
        }).join('');
        // Remove only a complete outer quotation wrapper, preserving inner punctuation/quotations.
        literal = literal.split(/\n[ \t]*\n/).map(part => {
            const trimmed = part.trim();
            const pairs = { '「': '」', '『': '』', '“': '”', '"': '"' };
            const close = pairs[trimmed[0]];
            if (close && trimmed.length >= 2 && trimmed.endsWith(close)
                && !trimmed.slice(1, -1).includes(close) && !trimmed.slice(1, -1).includes(trimmed[0])
                // Keep quoted protocol examples opaque on every subsequent pass.
                && !/^(?:BubbleType|SFX)\s*[:：]/i.test(trimmed.slice(1, -1))) return trimmed.slice(1, -1);
            return part;
        }).join('\n\n');
        return { visual, text: literal };
    }

    // All visual instructions precede the single Text: tail. Dialogue is opaque.
    function joinMangaCaptions(values) {
        const parts = values.map(splitMangaText);
        const visual = parts.map(p => p.visual).filter(Boolean).join(', ');
        const texts = parts.map(p => p.text).filter(Boolean);
        return visual + (texts.length ? '\nText: ' + texts.join('\n\n') : '');
    }

    function mangaCharacterCaption(c, monochrome = false) {
        const view = monochrome && c.render ? c.render : c;
        const appearance = typeof RBQ.api.renderCharacterMemoryBase === 'function'
            ? RBQ.api.renderCharacterMemoryBase(c.name, view.base || '') : view.base;
        return joinMangaCaptions([appearance, view.outfit, c.positive]);
    }

    function compileMangaPage(data) {
        if (!data || data.format !== 'nai5-comic' || !data.page || typeof data.page.base !== 'string'
            || !data.page.base.trim() || !Array.isArray(data.panels) || !data.panels.length) {
            throw new Error('漫画页缺少 page.base 或 panels，请重新解析分镜');
        }
        if (data.page.non_character !== undefined && typeof data.page.non_character !== 'string') throw new Error('漫画 page.non_character 必须是字符串');
        if (Object.prototype.hasOwnProperty.call(data, 'characters')) throw new Error('漫画页不能混用顶层人物与格内人物');
        if (data.position_mode && !['auto', 'manual'].includes(data.position_mode)) throw new Error('漫画定位模式无效');
        const warnings = [];
        const countWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
        const base = splitMangaText(data.page.base);
        let countFound = false;
        base.visual = filterMangaTags(base.visual, new Set(), tag => {
            const match = tag.match(/^(\d+|one|two|three|four|five|six|seven|eight)\s+panels?$/i);
            if (!match) return tag;
            const count = countWords[match[1].toLowerCase()] || Number(match[1]);
            countFound = true;
            if (count !== data.panels.length) warnings.push(`page.base 声明 ${count} 格，已按实际 panels 修正为 ${data.panels.length} 格`);
            return `${data.panels.length} panel${data.panels.length === 1 ? '' : 's'}`;
        });
        if (!countFound) base.visual = `${data.panels.length} panel${data.panels.length === 1 ? '' : 's'}, ${base.visual}`;
        if (base.text) warnings.push('page.base 含文字：请将对白归本人、旁白/拟音归 non_character');
        if (data.panels.length > 1 && /\bsplash page\b|単一コマ/.test(base.visual)) warnings.push('单格页面标记与多格 panels 冲突，请检查本页布局');
        const pieces = [base.visual + (base.text ? '\nText: ' + base.text : ''), data.page.non_character];
        const characters = [];
        const panelIds = new Set();
        data.panels.forEach((panel, panelIndex) => {
            if (!panel || typeof panel.id !== 'string' || !panel.id.trim() || panelIds.has(panel.id)
                || typeof panel.description !== 'string' || !Array.isArray(panel.characters)) {
                throw new Error(`漫画第 ${panelIndex + 1} 格缺少唯一 id、description 或 characters 数组`);
            }
            panelIds.add(panel.id);
            if (panel.non_character !== undefined && typeof panel.non_character !== 'string') throw new Error(`${panel.id} 的 non_character 必须是字符串`);
            if (splitMangaText(panel.description).text) warnings.push(`${panel.id} 的 description 含文字，未按文字归属分栏`);
            if (panel.characters.length && /BubbleType\s*[:：]\s*(?:通常吹き出し|叫び吹き出し|思考の吹き出し)/i.test(panel.non_character || '')) {
                warnings.push(`${panel.id} 的 non_character 含人物气泡，请核对说话者是否应归本格人物；程序未猜测或移动台词`);
            }
            pieces.push(panel.description, panel.non_character);
            const ids = new Set();
            panel.characters.forEach((c, index) => {
                if (!c || typeof c.character_id !== 'string' || !c.character_id.trim() || ids.has(c.character_id)
                    || typeof c.positive !== 'string' || !c.positive.trim() || typeof c.negative !== 'string') {
                    throw new Error(`${panel.id} 的第 ${index + 1} 位人物缺少身份、正负词或重复出场`);
                }
                for (const field of ['name', 'base', 'outfit']) {
                    if (Object.hasOwn(c, field) && typeof c[field] !== 'string') {
                        throw new Error(`${panel.id}/${c.character_id} 的人物 ${field} 字段必须是字符串`);
                    }
                }
                if (Object.hasOwn(c, 'state')) {
                    if (!c.state || typeof c.state !== 'object' || Array.isArray(c.state)) {
                        throw new Error(`${panel.id}/${c.character_id} 的人物状态必须是对象`);
                    }
                    for (const field of ['base', 'outfit', 'hair_style', 'hair_length', 'hair_color']) {
                        if (Object.hasOwn(c.state, field) && typeof c.state[field] !== 'string') {
                            throw new Error(`${panel.id}/${c.character_id} 的状态 ${field} 字段必须是字符串`);
                        }
                    }
                }
                if (Object.hasOwn(c, 'render')) {
                    if (!c.render || typeof c.render !== 'object' || Array.isArray(c.render)) {
                        throw new Error(`${panel.id}/${c.character_id} 的 render 必须是灰阶绘图对象`);
                    }
                    for (const field of ['base', 'outfit']) {
                        if (Object.hasOwn(c.render, field) && (typeof c.render[field] !== 'string'
                            || /\b(?:Text|BubbleType|Layout|SFX)\s*[:：]/i.test(c.render[field]))) {
                            throw new Error(`${panel.id}/${c.character_id} 的 render.${field} 必须是无对白的外貌衣着字符串`);
                        }
                    }
                }
                ids.add(c.character_id);
                const manual = data.position_mode === 'manual';
                if (manual && (!c.center || !Number.isFinite(c.center.x) || !Number.isFinite(c.center.y)
                    || c.center.x < 0 || c.center.x > 1 || c.center.y < 0 || c.center.y > 1)) {
                    throw new Error(`${panel.id}/${c.character_id} 缺少有效的手动坐标`);
                }
                const positive = mangaCharacterCaption(c, data.render_mode === 'monochrome');
                characters.push({
                    index: characters.length + 1, panelId: panel.id, characterId: c.character_id,
                    name: c.name || c.character_id, _rawName: c.name || c.character_id,
                    // Compile the resolved snapshot without consulting or reapplying current memory.
                    caption: positive, action: positive, _rawAction: positive,
                    base: '', outfit: '', uc: c.negative.trim(),
                    center: manual ? { ...c.center } : { x: 0.5, y: 0.5 }
                });
            });
        });
        return { base: joinMangaCaptions(pieces), characters, useCoords: data.position_mode === 'manual', warnings };
    }

    // Resolve appearances once during parsing. Cached pages contain final snapshots;
    // compilation/redraw never reads the current profile or replays state changes.
    function mangaIdentityKey(name) {
        return String(name || '').trim().replace(/^[-+]?\d+(?:\.\d+)?::([\s\S]+)::$/, '$1').replace(/\s*[（(\[【](?:original|原创|fanart|同人)[）)\]】]/gi, '').trim().toLowerCase();
    }

    function resolveMangaAppearances(pages, references = [], newMemory = [], warnings = [], renderSettings = {}) {
        pages.forEach(compileMangaPage);
        const result = JSON.parse(JSON.stringify(pages));
        const monochrome = renderSettings.style === 'monochrome';
        const drawingViews = new Map();
        for (const page of result) {
            if (monochrome) page.render_mode = 'monochrome';
            else delete page.render_mode;
        }
        const states = new Map();
        const initial = new Map();
        const seen = new Set();
        const withName = (name, base) => {
            if (typeof RBQ.api.ensureCharacterNameTag !== 'function') throw new Error('请更新智能生图插件至 6.4.2 或更高以完整保留角色名');
            return RBQ.api.ensureCharacterNameTag(name, base);
        };
        const clean = value => typeof value === 'string' && !/\b(?:Text|BubbleType|Layout|SFX)\s*[:：]/i.test(value) ? value.trim() : '';
        const knownBase = (name, value) => clean(value) ? withName(name, clean(value)) : '';
        for (const row of references) {
            const name = mangaIdentityKey(row?.name);
            const key = name ? `name:${name}` : '';
            if (!key) continue;
            const state = { base: knownBase(row.name, row.base), outfit: clean(row.outfit), outfitSet: !!clean(row.outfit) };
            for (const field of ['hair_style', 'hair_length', 'hair_color', 'render_base', 'outfit']) {
                if (field === 'outfit' && row.state?.outfitSet === false) continue;
                if (typeof row.state?.[field] === 'string' && (!row.state[field].trim() || clean(row.state[field]))) {
                    state[field] = clean(row.state[field]);
                    if (field === 'outfit') state.outfitSet = true;
                }
            }
            // A full temporary snapshot belongs to the stable base it was derived from.
            // Explicit profile corrections must not be hidden by an older snapshot.
            if (typeof row.state?.render_base_source === 'string') {
                if (withName(row.name, row.state.render_base_source) !== state.base) delete state.render_base;
                else state.render_base_source = state.base;
            }
            states.set(key, state);
        }
        for (const row of Array.isArray(newMemory) ? newMemory : []) {
            const name = mangaIdentityKey(row?.name);
            if (!name || /^(?:[cp]\d+|unknown|unnamed|路人|匿名|无名|__proto__|constructor|prototype)$/.test(name)) continue;
            const key = `name:${name}`;
            const state = states.get(key) || { base: '', outfit: '', outfitSet: false };
            state.base ||= knownBase(row.name, row.base);
            // Legacy character_memory.outfit is the END state, not opening clothing.
            if (!state.outfitSet) state.outfit = clean(row.initial_outfit);
            state.outfitSet ||= !!state.outfit;
            states.set(key, state);
        }
        for (const [key, state] of states) initial.set(key, { ...state });
        const declaredNames = new Map();
        for (const page of result) for (const panel of page.panels) for (const c of panel.characters) {
            if (!c.name?.trim()) continue;
            if (!declaredNames.has(c.character_id)) declaredNames.set(c.character_id, new Map());
            declaredNames.get(c.character_id).set(mangaIdentityKey(c.name), c.name);
        }
        for (const page of result) for (const panel of page.panels) for (const c of panel.characters) {
            const knownNames = declaredNames.get(c.character_id);
            if (!c.name?.trim() && knownNames?.size === 1) c.name = knownNames.values().next().value;
            delete c._mangaAppearance;
            delete c._mangaInitialAppearance;
            if (!monochrome) delete c.render;
            const name = mangaIdentityKey(c.name);
            const anonymous = !name || /^(?:[cp]\d+|character\s*\d+|角色\s*\d+|unknown|unnamed|路人|匿名|无名)$/.test(name);
            const key = anonymous ? `local:${c.character_id}` : `name:${name}`;
            const hasFields = typeof c.base === 'string' || typeof c.outfit === 'string';
            let state = states.get(key);
            if (!state && hasFields) {
                state = { base: knownBase(c.name, c.base), outfit: clean(c.outfit), outfitSet: !!clean(c.outfit) };
                states.set(key, state);
                initial.set(key, { ...state });
            }
            if (!state) continue;
            if (!seen.has(key)) {
                const opening = initial.get(key);
                opening.base ||= knownBase(c.name, c.base);
                if (!opening.outfitSet && clean(c.outfit)) {
                    opening.outfit = clean(c.outfit);
                    opening.outfitSet = true;
                }
                seen.add(key);
            }
            state.base ||= knownBase(c.name, c.base);
            if (hasFields && clean(c.outfit)) {
                state.outfit = clean(c.outfit);
                state.outfitSet = true;
            }
            if (c.state && typeof c.state === 'object' && !Array.isArray(c.state)) {
                for (const field of ['hair_style', 'hair_length', 'hair_color', 'outfit']) {
                    if (typeof c.state[field] === 'string' && (!c.state[field].trim() || clean(c.state[field]))) {
                        state[field] = clean(c.state[field]);
                        if (field === 'outfit') state.outfitSet = true;
                    }
                }
                // Explicit plot appearance changes use a complete temporary snapshot.
                // Never classify/remove tags or overwrite the permanent profile.
                if (clean(c.state.base)) {
                    state.render_base = withName(c.name, clean(c.state.base));
                    state.render_base_source = state.base;
                }
            }
            c._mangaInitialAppearance = { ...initial.get(key) };
            c._mangaAppearance = { ...state };
            if (!hasFields) {
                warnings.push(`${panel.id}/${c.name} 使用旧版完整 positive，已保留原词；重新解析可使用普通角色记忆的 base/outfit 合并`);
                continue;
            }
            const resolve = RBQ.api.resolveCharacterMemoryFields;
            if (typeof resolve !== 'function') throw new Error('请更新智能生图插件以使用共用角色记忆');
            const fields = resolve({ baseTags: withName(c.name, state.render_base || state.base), currentOutfit: state.outfit }, clean(c.base), '');
            c.base = fields.base;
            c.outfit = fields.outfit;
            if (monochrome) {
                // Rendering views are local to this response, never part of the memory/state maps.
                // Bind each member to its complete original so changes cannot reuse stale views.
                const previous = drawingViews.get(key) || {};
                const view = {};
                for (const field of ['base', 'outfit']) {
                    const source = fields[field];
                    const supplied = c.render && Object.hasOwn(c.render, field);
                    const translated = supplied ? clean(c.render[field]) : undefined;
                    if (!source) view[field] = '';
                    else if (previous[field + 'Source'] === source) view[field] = previous[field];
                    else if (supplied && translated) view[field] = field === 'base' ? withName(c.name, translated) : translated;
                    else throw new Error(`${panel.id}/${c.name || c.character_id} 缺少当前外观的 render.${field} 灰阶绘图词；请重新解析，原角色记忆未改动`);
                    view[field + 'Source'] = source;
                }
                drawingViews.set(key, view);
                c.render = { base: view.base, outfit: view.outfit };
            }
            // positive is only this appearance's position/action/expression/dialogue.
            // No special cropping, synonym conversion, category replacement or tag deletion.
        }
        return result;
    }

    const mangaProtocol = {
        appearanceStateVersion: 2, monochromeRenderVersion: 1,
        compile: compileMangaPage, resolveAppearances: resolveMangaAppearances, outputSchema: mangaOutputSchema, segmentSchema: mangaSegmentSchema,
        planningPrompt: buildMangaPlanningPrompt,
        planningContext: buildMangaPlanningContext,
        systemPrompt: () => buildMangaSystemPrompt(getStore())
    };
    RBQ.api.mangaProtocol = mangaProtocol;

    function buildMangaPlanningContext(ratio) {
        const settings = RBQ.api.getSettings();
        const mode = settings.currentMode || 'nai';
        const fallback = mode === 'nai' ? [832, 1216] : [1024, 1024];
        const selected = typeof ratio === 'string' ? ratio.split('x').map(Number) : [];
        const valid = value => Number.isFinite(Number(value)) && Number(value) > 0;
        const width = Math.round(valid(selected[0]) ? selected[0] : valid(settings[`${mode}Width`]) ? Number(settings[`${mode}Width`]) : fallback[0]);
        const height = Math.round(valid(selected[1]) ? selected[1] : valid(settings[`${mode}Height`]) ? Number(settings[`${mode}Height`]) : fallback[1]);
        return { width, height, orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square', autoSpread: !!getStore().autoSpread };
    }

    function buildMangaPlanningPrompt() {
        return `【漫画前情与本楼规划】
一次完成选材、分页与绘图词，直接输出最终 JSON，不另写节点清单、逐句引用或长篇分析。
前情只用于确认进入本楼时仍有效的身份、场景、衣着、持物和接触。以最近明确记录为准，本楼变化按发生顺序更新；后文换装/放下物品不能提前作用于前面的格，角色档案和衣柜不能覆盖已发生的变化。未知细节少写，不自动复原。
从本楼开端看到结尾，保留重要动作及结果、关键对白、情绪转折、线索与转场；无大动作的告白或拒绝也值得画。重复描写合并，无新信息的寒暄、抽象议论和未发生的假设不硬画，不重画历史。
先考虑每格呈现的定格，再按人物、动作、对白容量组合成页：多个相邻事件可同页，长对白或复杂互动可跨页。普通页通常2～5格只是参考，单格页合法；不按句号、图组数量或 minSegments 凑页。保留因果、说话者和反应，不为了少页删掉转折，也不为多页补无意义镜头。
每页先选主画面，再把剩余事件安排到辅助格；在 page.base 写主格位置及大致面积、辅助格大小和相互排列，不能只报格数或 vertical layout。每格选一个定格时刻，明确人物、动作对象、持物和接触，再选景别；位置称呼贯穿 description 与人物 positive。
输入 mangaCanvas 是实际画布像素与方向，按其可读空间同时安排人物、动作和文字；小格不能承载长段对白。正文中的完整问答保留次序，长句按已有停顿分泡或跨相邻格/页续接，不能为了压到预想页数而摘掉条件、理由或句尾；不以固定字数限额删字。提交前核对剧情首尾、人物状态、逐句说话者与文字归属。reason 只写简短结论，intent 可省略；页数以 segments 实际数量为准。`;
    }

    function buildMangaSystemPrompt(store) {
        const grammar = GRAMMAR_PRESETS[store.grammar] || GRAMMAR_PRESETS.cinema;
        const gutter = GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed;
        return `你是漫画分镜导演，将本轮定稿剧情完整转译为漫画。只呈现 currentMessage 中发生的事件；历史、角色记忆和世界书用于查证身份与连续状态。

【分页与叙事】
按正文顺序组织有叙事价值的事件及其直接反应，依据事件量、文字量和画格容量决定页数。一个事件可跨格，相邻事件可在同页；不把每个动作强制扩成一页，不为凑格补剧情。每个 segment 是一页，anchor.text 从该页对应正文逐字摘录10~40字（正文不足10字可用全文），不改写、不全部扎堆末尾。关键对白、情绪转折和线索揭示也值得画；纯重复、无新信息的闲聊或抽象议论可不画。没有值得呈现的节点时 shouldDraw=false。
普通页用 comic, 複数コマの漫画ページ；决定性瞬间可用 splash page, 単一コマ；确需横向空间才用 見開きページ。单格页只有一个 panel。画格数由叙事需要决定，不设统一的3~5格下限。

【画格与阅读路径】
panels 数组就是阅读顺序：先上后下，同层先右后左；主格不一定是首格。独立时刻或机位的插入格计入格数，page.base 格数须与数组一致。逐格确定可辨的位置、大小、景别和一个定格时刻；P1/C1 仅为关联编号，不能代替空间词。description 与该格所有人物 positive 使用一致的位置称呼。
${store.grammar === '4koma' ? '当前为经典四格：四个均等画格，按起承转结排列，允许固定等分；节奏服务已有剧情，不凭空编造转折和笑点，可用同一事件的铺垫与反应承接。' : '普通页按剧情分配主格与辅助格大小。page.base 写明主格位置与大致面积、辅助格宽窄高低和邻接排列、实际阅读路径；不能只有 vertical layout 加 top/middle/bottom。全宽横格可按需采用，但不默认每页等高堆叠，不随机轮换模板。连续反应镜头可以采用相同景别。'}
${grammar.instruction}
文法中的多格技法只在多格页适用；整页单格不强制辅助格或多个斜切边框。
文法是演出偏好，不能改写事件、强加情绪或新增人物。镜头先明确谁对谁做什么、手和道具的接触、朝向与视线，再选择景别；没有看向读者的依据时不要统一 looking at viewer。不同时间的动作分格，同格不混写互斥姿势；每页构图和人物外貌自足，不用“同上”代替。
${gutter.instruction}

【数据归属：页面 → 画格 → 格内人物】
输出 format=nai5-comic，字段见 outputSchema。page.base 写整页去重后的可见人数（同一人跨格不重复计数）、页面形态、格数、具体布局与光影。panels[].description 写本格环境与构图；panels[].characters 为本格每位可见人物各建一次出场，可有0人、1人或多人。空镜写 characters:[]，不建立假人物。
同一人跨格使用相同 character_id，name 填完整绘图身份（原创 Name (original)，同人已确认的 Name (Series)，优先沿用已有英文身份，未知译名/作品不猜），程序自动拼入 base。base 写无数字主体词 boy/girl/other 和稳定外貌，outfit 写完整当前服装；positive 只写本格动作、持物、表情与对白。name 同时用于绘图与资料关联，character_id 只用于跨格关联，保留资料中已有的普通姓名和可靠同人角色标签；完整外貌保留已知发长、发型结构、刘海和识别细节，不能只剩发色。特写裁切通过镜头表达，不删 base/outfit。
可见的回答者、配角和背影同样需要人物条目，不能只在 description 写“一群弟子”就省掉实际说话者；匿名配角可以出镜说话而不建立长期记忆。页面人数统计所有实际可见人物，不只统计主角。
按准确姓名匹配角色卡、世界书与记忆；未知不猜，已有明确身份、外貌不漏。稳定外貌与当前状态分开：逐格追踪左右手持物、物件开合/破损、持续接触、服装及发型变化；从变化发生的格起沿用，裁切和换镜头不自动复原。道具固定结构、场景地标、门窗方向保持一致，只有剧情依据才改变；环境锚点写在 description，不复制到每个人物槽。比喻只转译实际可见的本体。
【角色记忆落实：与普通模式共用】
每个角色填写 name、base、outfit、positive。base 是完整稳定身份外貌，已建档时原样复用；outfit 是完整当前衣着，保留内外层、上下装、鞋袜与配饰，未换装可为空以沿用。positive 只写本格位置、动作、表情、视线和对白，不重复外貌或衣着。程序按普通模式选择完整的“已存 base + 当前 outfit”；彩色绘图与本格 positive 组装，黑白绘图用对应的 render 灰阶视图与 positive 组装。不按身体部位分类、删词或覆盖叠穿。
特写、背面、遮挡通过 description 的景别与 positive 的姿态表达，不裁剪角色记忆，不填写 visible。姓名、国籍、年龄、身高、自定义细节按已有资料保留；未知不猜。
换装从实际发生的格开始填写完整 outfit，后续空值沿用；衣物全部移除须显式 state.outfit=""。不把末格衣着提前填到开场格。明确束发、剪发等外貌变化时，state.base 写变化后的完整临时外貌快照，保留其他身份特征；后续沿用，不反写长期 base。普通换镜头不填写 state.base。
base、outfit、state 与 character_memory 保留原设颜色，与普通模式相同。绘图按当前画风表达；黑白模式使用下述 render 灰阶视图，发送层只组装，不替你转换色相。不要把临时状态或黑白处理结果写回长期外貌。
【视觉词与动作表达】
page.base、description 和 positive 的视觉部分以可识别的 Danbooru 英文标签为骨架，用英文逗号分隔。page.base 用 1girl, 1boy 等实际人数词，不用含糊的 2 characters；格位用 top-right panel 等位置，不用 P1: 代替。name 填稳定姓名并保留已有姓名标签，剧情解释放 reason/intent，绘图字段不写 A girl is... 或整段故事转述。
每个人物按 base/outfit/positive 分栏；positive 依次写本格位置 → 身体朝向/基础姿势 → 肢体动作及接触对象 → 表情与视线。动作至少说明“谁、用哪个可见部位、对什么做什么”：优先 holding, reaching out, sitting, crossed legs 等标签；标签表达不清时紧跟一个短关系词组，如 right hand holding umbrella handle，不重复叙述整句。
同格多人动作分别归本人。递接、拉扶等互动明确施方/受方、对象和接触状态，source#/target# 仅用于双方同一明确交互词，不给每个词机械加前缀。只写当前定格，不同时写准备、进行和完成。每只可见手的任务相容；离物体有距离时写 reaching toward，真正握住才写 holding/gripping。标签不足时补空间关系，不凭空造标签。
机位与景别放 description，人物视线跟随目标；不要把仰头误写 looking down，或把相互注视写 looking at viewer。outfit 保留完整衣物和配饰；特写用明确景别控制画面，背位动作不写看不见的正脸表演。默认不加权；确需突出/弱化已写明的焦点时用闭合的 1.2::短词组:: / 0.6::短词组::，强度不设配额。不加权整段、编号或 Text；权重不能补救漏写、错人或冲突，不用全局负权排除需要的漫画元素。
普通动作示例（只借格式）：description="top panel, medium shot, from side, indoors, desk"；递信者 base="girl, short hair"，outfit="white shirt"，positive="top panel, standing, facing another, outstretched arm, right hand holding envelope, looking at another's hand"；接信者 base="boy, short hair"，outfit="dark jacket"，positive="top panel, sitting, reaching out, left hand reaching toward envelope, looking at envelope"。物品交接完成另格呈现，不在同格混写已收好。
每次出场的 negative 对照本页所有其他不同人物（包括其他格），同格优先；不把自己的其他出场当成别人。只排除本镜头适用、易串位且互斥的具体发型/配饰/衣物等特征；可补有明确依据的互斥误画特征，去重。自己的正确外貌、共享特征、环境、漫画、文字和画质不排除。黑白时不用彩色色相区别人。没有适用项写空字符串；negative 不能代替 positive 的正确外貌。
${store.antiHijack ? '同人防夺舍：仅在有可靠依据时将原作画师 artist: 标签或作品标签放入该人物 negative；不得从姓名括号猜造标签，不排除人物自身标签。' : ''}

【对白与非人物文字】
人物对白/心声归该人物 positive；旁白、拟音、画外对白归所属 page.non_character 或 panel.non_character，不占人物槽。所选剧情的原句保留说话者、次序、次数和标点；静默格不添字。长句按原有停顿分气泡，不删字。容量不足先压缩重复视觉描写，再分格/分页，不截掉结尾或关键对话。
说话者在本格可见时，原句必须进本人 positive，不能当旁白移到 page.base/non_character。只有真的画外声才放 non_character。需要上画的每句台词必须实际写入 Text，不能只写 speech bubble、speaking 或“说了某事”；无台词的静默格不添空白气泡。叙述中的动作描写转成视觉标签，不整段变成旁白。
问答按正文先问后答，回答不能提前放到入场格；同格放不下就顺延下一格。画外回答使用所属 panel.non_character，并明确本格位置、画外来源及画外气泡，不能使用整页 page.non_character 承载某一格的回答。
气泡视觉说明必须在 Text: 前写类型、位置及 Layout。普通=通常吹き出し；呐喊=叫び吹き出し；心声=思考の吹き出し；耳语=破線吹き出し；颤抖=波打つ吹き出し；广播=四角い吹き出し；旁白=ナレーション枠；画外=切り欠きのある吹き出し；无尾=しっぽなしの楕円吹き出し；连续气泡=連結吹き出し。拟音用 SFX: 擬音, 吹き出しなし。
同格先说的文字居右上，后说的居左下，不能因说话人站左侧就交换问答。气泡避开脸与主动作；尾巴指向当前镜头的嘴部，心声圆点指向头部，旁白/拟音无尾；同人连续多泡成一组只留一条尾巴，两人分组，声源未知不猜方向。最终只写类型和位置短词，不写尾巴绕行教程。
对白/心声通常 Layout: 縦書き；外语对白、屏幕/信件字和旁白用 Layout: 横書き。每字段仅在末尾写一个 Text:，其后只有原句、没有视觉标签；同人同格多句用两个换行分隔，不重复人物槽。Text: 外不包额外引号。
外层「」、“”等对白标记转译为气泡后剥除，只保留句内真实引用和标点。Layout 指令不写进台词，不按列手工断行；同人多泡把各泡类型、位置和阅读顺序全部写在 Text 前，再把各句用空行分隔。
格式示例："top panel, girl, short hair, smiling, BubbleType: 通常吹き出し, 右上, Layout: 縦書き, Text: 信收到了。"；拟音示例："bottom panel, SFX: 擬音, 吹き出しなし, Text: 咔哒"。BubbleType 和 Text 是两个独立字段标记，不能把 Text 当作整段气泡说明的开头。旁白用 BubbleType: ナレーション枠, Layout: 横書き，文字只取必要的时空/客观提示。
文字语言：${store.language === 'ja' ? '自然转译为日文，保留原意和归属。' : '简体中文；原文已是中文时保留原句。'}
${store.style === 'monochrome' ? '黑白：参考原预设的整页脱色规则，一次解析统一完成灰阶转译。page.base 用 monochrome, greyscale, screentone；description、non_character 的视觉部分、positive 与 negative 中的人物、道具、环境都按黑/白/灰、深浅、材质和明暗关系表达，不留彩色色相或 full color。光照只写方向、强弱和对比，避免色温染色。\n人物 base/outfit/state 与 character_memory 仍完整保留原设颜色。另在首次出场输出 render:{base,outfit}，分别为当前完整外貌和完整衣着的灰阶绘图视图；已存资料原样为依据，已有姓名、同人 Tag、国籍、年龄、身高、形状、衣物层次及配饰不得遗漏，不重新猜外貌，不按景别裁剪。\n同一次响应的后续格/页，同人外观未变时省略 render；程序复用已给视图。明确换装时仅更新 render.outfit；明确临时外貌变化时仅更新 render.base，以变化后的完整 state 为依据；两者都变则一起更新。原色资料同一外观只能对应同一灰阶视图，即使重复输出也沿用首次视图。源外观已变就不能省略对应视图。无衣物用 render.outfit=""。negative 对照灰阶后的实际外貌，不靠彩色色相排除其他人物。可靠身份标签和 Text 原文不脱色；灰阶结果仅服务本次绘图，不能反写长期档案。\n黑白分栏示例（只借格式）：首次 base="girl, blonde hair, brown eyes"，outfit="beige trench coat, white shirt"，render={"base":"girl, light hair, dark eyes","outfit":"light trench coat, white shirt"}，positive="standing, holding dark umbrella"；下一格 base=""、outfit=""，省略 render，仅写本格动作。换红外套时 state.outfit="red coat"，render={"outfit":"dark coat"}，不再重复灰阶 base。' : '色彩遵循选定画风，人物发眼、衣物、配饰与道具保持已知固有颜色；同地点连续时间沿用主光源方向与明暗关系，镜头变化不新造光源。仅转场、时间经过或实际光源变化才更新；固有颜色与环境照明分开写。'}

【输出核对】
核对台本起止与覆盖、格数与页面形态、主辅格面积和相对排列、人物身份及动作连续性。逐句确认文字类型与说话者：可见人物的对白只在本人 positive，画外声/旁白/拟音才在 non_character；page.base 与 description 不放 Text。检查正负词不互斥，布局和动作信息已实际写进绘图字段，不能仅在 reason/intent 解释。直接提交最终页格，不输出额外的节点清单或覆盖报告。默认自动定位，不输出坐标；仅明确手动定位时输出 position_mode="manual"，每次人物出场附整页归一化 center:{x,y}（0～1）。只输出约定 JSON；reason 简述所选剧情、实际页数与分页依据，不重复整段正文。`;
    }

    // Filter whole tags (including weighted groups), never substrings or dialogue.
    function filterMangaTags(value, forbidden, transform = tag => tag, preserveProtocol = false) {
        const tokens = [];
        let start = 0, brackets = 0, weights = 0;
        for (let i = 0; i < value.length; i++) {
            const openWeight = value.slice(i).match(/^-?\d+(?:\.\d+)?::/);
            if (openWeight) { weights++; i += openWeight[0].length - 1; continue; }
            if (value.slice(i, i + 2) === '::' && weights) { weights--; i++; continue; }
            if ('([{'.includes(value[i])) brackets++;
            if (')]}'.includes(value[i])) brackets--;
            if (value[i] === ',' && brackets === 0 && weights === 0) { tokens.push(value.slice(start, i)); start = i + 1; }
        }
        tokens.push(value.slice(start));
        return tokens.map(raw => {
            const token = raw.trim();
            const weighted = token.match(/^(-?\d+(?:\.\d+)?::)([\s\S]*)::$/);
            if (weighted) {
                const body = filterMangaTags(weighted[2], forbidden, transform, preserveProtocol);
                return body ? weighted[1] + body + '::' : '';
            }
            if ((token.startsWith('{') && token.endsWith('}')) || (token.startsWith('[') && token.endsWith(']'))) {
                const body = filterMangaTags(token.slice(1, -1), forbidden, transform, preserveProtocol);
                return body ? token[0] + body + token.at(-1) : '';
            }
            return forbidden.has(token.toLowerCase().replace(/[_\s]+/g, ' ').trim()) ? '' : transform(token);
        }).filter(Boolean).filter((tag, i, tags) => tags.indexOf(tag) === i
            // Repeated bubble fields describe different utterances, not redundant tags.
            || (preserveProtocol && /^(?:(?:BubbleType|Layout|SFX)\s*[:：]|(?:右上|左上|右下|左下|口元|画面外|頭上|上部|下部|吹き出しなし)$)/i.test(tag))).join(', ');
    }

    function sanitizeMangaPositivePrompt(value) {
        const { visual, text } = splitMangaText(value);
        const clean = filterMangaTags(visual, new Set(['no text', 'notext']), tag => tag, true);
        return clean + (text ? (clean ? '\n' : '') + 'Text: ' + text : '');
    }

    function sanitizeMangaNegativePrompt(value, isMonochrome = true) {
        const forbidden = new Set(['comic', 'comic panel', 'comic panels', 'comic book', 'panels', '4koma', '2koma',
            'speech bubble', 'speech bubbles', 'thought bubble', 'thought bubbles', 'speech', 'text', 'screentone',
            'halftone', 'dithering', 'multiple views', 'multiple scenes', 'sequence', 'border', 'frame', 'outline',
            'margins', 'negative space', 'furryfocus']);
        if (isMonochrome) ['monochrome', 'greyscale', 'grayscale', 'manga'].forEach(t => forbidden.add(t));
        return filterMangaTags(String(value || ''), forbidden);
    }

    let studioGenerationRatio = null;
    let studioRequest = null;
    const mangaPayloadSettings = new WeakMap();

    function captureMangaRenderSettings() {
        const { enabled, style, customPositive, customNegative, gutter, autoSpread } = getStore();
        return { enabled, style, customPositive, customNegative, gutter, autoSpread };
    }
    mangaProtocol.captureRenderSettings = captureMangaRenderSettings;

    function enhanceMangaPayload(payload, forceManga = false, characterNames = [], renderSettings) {
        const store = renderSettings || mangaPayloadSettings.get(payload) || getStore();
        const studioMatch = studioRequest && String(payload.input || '').includes(studioRequest.prompt);
        if (!store.enabled && !studioMatch && forceManga !== true) return payload;
        if (!payload.parameters) return payload;
        mangaPayloadSettings.set(payload, store);
        const params = payload.parameters;
        // v1.1 assembles its own quality/UC library explicitly. Disable NAI's
        // implicit presets so they cannot reintroduce comic/text exclusions.
        params.qualityToggle = false;
        params.ucPreset = 3;
        if (store.ratio) {
            const [width, height] = store.ratio.split('x').map(Number);
            if (width > 0 && height > 0) Object.assign(params, { width, height });
        }
        if (studioMatch) {
            const [width, height] = studioGenerationRatio.split('x').map(Number);
            if (width && height) Object.assign(params, { width, height });
            const compiled = studioRequest.compiled;
            params.v4_prompt = {
                caption: { base_caption: payload.input, char_captions: compiled.characters.map(c => ({ char_caption: c.caption, centers: [c.center] })) },
                use_coords: compiled.useCoords, use_order: true
            };
            params.v4_negative_prompt = {
                caption: { base_caption: params.negative_prompt || '', char_captions: compiled.characters.map(c => ({ char_caption: c.uc, centers: [c.center] })) },
                legacy_uc: false
            };
        }
        const style = COMIC_STYLES[store.style] || COMIC_STYLES.monochrome;
        const positive = store.style === 'custom' ? store.customPositive || '' : style.positive;
        const negative = store.style === 'custom' ? store.customNegative || '' : style.negative;
        const mono = store.style === 'monochrome';
        const gutter = (GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed).tag;
        const addStyle = value => sanitizeMangaPositivePrompt(joinMangaCaptions([
            positive && !String(value || '').includes(positive) ? positive : '', gutter, value
        ]));
        const caption = params.v4_prompt?.caption;
        payload.input = addStyle(payload.input);
        if (caption) {
            caption.base_caption = addStyle(caption.base_caption);
            (caption.char_captions || []).forEach(c => { c.char_caption = sanitizeMangaPositivePrompt(c.char_caption); });
            params.v4_prompt.use_order = true;
        }
        const negCaption = params.v4_negative_prompt?.caption;
        const baseNegative = sanitizeMangaNegativePrompt([typeof params.negative_prompt === 'string' ? params.negative_prompt : negCaption?.base_caption || '', negative].filter(Boolean).join(', '), mono);
        params.negative_prompt = baseNegative;
        if (negCaption) {
            negCaption.base_caption = baseNegative;
            // Per-person UC comes from the director. Do not guess franchises or copy global color/quality UC here.
            (negCaption.char_captions || []).forEach((c, index) => {
                const ownTags = new Set();
                filterMangaTags(splitMangaText(caption?.char_captions?.[index]?.char_caption || '').visual, new Set(), tag => {
                    ownTags.add(tag.toLowerCase().replace(/[_\s]+/g, ' ').trim());
                    return tag;
                });
                c.char_caption = filterMangaTags(sanitizeMangaNegativePrompt(c.char_caption, mono), new Set(), tag => {
                    return ownTags.has(tag.toLowerCase().replace(/[_\s]+/g, ' ').trim()) ? '' : tag;
                });
            });
        }
        const base = caption?.base_caption || payload.input;
        if (store.autoSpread && /見開き|double-page spread|2-page spread|wide spread/i.test(splitMangaText(base).visual)
            && params.width < params.height) [params.width, params.height] = [params.height, params.width];
        return payload;
    }
    mangaProtocol.enhancePayload = enhanceMangaPayload;
    RBQ.on('buildNaiV4Payload', (payload, context) => {
        const pending = context ? context.meta?.sdtCharacterData : RBQ.api.getPendingSdtImageData?.();
        const request = pending && (!pending.prompt || String(payload.input || '').includes(pending.prompt)) ? pending : null;
        return enhanceMangaPayload(payload, !!request?.manga, request?.characters?.map(c => c.name) || [], request?.renderSettings);
    });

    // ── 6. UI Injection into Smart Draw Trigger (SDT) ──────────────
    const STYLE_TAG_ID = 'rbq-manga-mode-style';

    function injectStyles() {
        if (document.getElementById(STYLE_TAG_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_TAG_ID;
        style.textContent = `
        #mw-root-container .rbq-manga-people { min-width: 0; }
        #mw-root-container .rbq-manga-people-body { display: grid; gap: 12px; padding-top: 8px; }
        #mw-root-container .rbq-manga-people summary { min-height: 44px; padding: 12px 8px; color: #e2e8f0; cursor: pointer; }
        #mw-root-container .rbq-manga-position-label { display: grid; gap: 6px; }
        #mw-root-container .rbq-manga-position-in { width: 100%; min-height: 44px; box-sizing: border-box; }
        #mw-root-container .rbq-manga-person { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 12px; border: 1px solid #64748b; border-radius: 8px; }
        #mw-root-container .rbq-manga-people label { display: grid; gap: 6px; color: #e2e8f0; }
        #mw-root-container .rbq-manga-people input,
        #mw-root-container .rbq-manga-people textarea { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; background: #161b24; color: #f1f5f9; border: 1px solid #64748b; border-radius: 6px; padding: 8px; }
        #mw-root-container .rbq-manga-people textarea { min-height: 88px; resize: vertical; }
        #mw-root-container .rbq-manga-people button { display: inline-flex !important; flex-direction: row !important; align-items: center !important; justify-content: center !important; gap: 6px !important; white-space: nowrap !important; box-sizing: border-box !important; min-height: 44px; }
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
        /* 当漫画模式激活时，受托管的 SDT 控件高级锁定态 (Game HUD Lock State) */
        .rbq-sdt-preset-locked {
            pointer-events: none !important;
            cursor: not-allowed !important;
            transition: all 0.25s ease !important;
            position: relative !important;
        }
        /* 普通输入/下拉框保留优雅的暗色半透明禁用态，不污染外层卡片 */
        .rbq-sdt-preset-locked:not(.switch) {
            opacity: 0.72 !important;
        }
        .rbq-sdt-preset-locked:not(.switch) select,
        .rbq-sdt-preset-locked:not(.switch) input:not([type="checkbox"]),
        .rbq-sdt-preset-locked:not(.switch) textarea {
            opacity: 0.7 !important;
            background: rgba(255, 255, 255, 0.03) !important;
            color: rgba(240, 246, 252, 0.6) !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
            cursor: not-allowed !important;
        }
        /* 微型高亮状态药丸徽章 (Status Capsule / Pill) */
        .rbq-sdt-preset-lock-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            font-size: 10px !important;
            line-height: 1 !important;
            color: #fbbf24 !important;
            background: rgba(245, 158, 11, 0.14) !important;
            border: 1px solid rgba(245, 158, 11, 0.35) !important;
            padding: 2.5px 7px !important;
            border-radius: 999px !important;
            margin-left: 6px !important;
            font-weight: 600 !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            letter-spacing: 0.02em !important;
            box-shadow: 0 0 8px rgba(245, 158, 11, 0.12) !important;
            vertical-align: middle !important;
        }
        .rbq-sdt-preset-lock-badge.muted {
            color: #94a3b8 !important;
            background: rgba(148, 163, 184, 0.1) !important;
            border-color: rgba(148, 163, 184, 0.25) !important;
            box-shadow: none !important;
        }
        /* 开关卡片双行排版包装容器 */
        .rbq-sdt-switch-lock-wrap {
            display: flex !important;
            flex-direction: column !important;
            gap: 4px !important;
            min-width: 0 !important;
            flex: 1 1 auto !important;
            justify-content: center !important;
        }
        .rbq-sdt-switch-title-row {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            flex-wrap: nowrap !important;
            min-width: 0 !important;
        }
        .rbq-sdt-switch-title-text {
            color: var(--linear-text-primary, #f7f8f8) !important;
            font-size: 13.5px !important;
            font-weight: 600 !important;
            letter-spacing: 0.01em !important;
            white-space: nowrap !important;
        }
        .rbq-sdt-switch-lock-desc {
            font-size: 11px !important;
            color: var(--linear-text-secondary, #94a3b8) !important;
            line-height: 1.35 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            opacity: 0.85 !important;
        }
        /* 锁定激活态开关（强制开启，如多角色输出模式）：醒目琥珀金托管高亮 */
        .rbq-sdt-preset-locked.rbq-sdt-locked-on .st-scene-trigger-toggle-ui {
            background: rgba(245, 158, 11, 0.22) !important;
            border-color: rgba(245, 158, 11, 0.55) !important;
            box-shadow: 0 0 12px rgba(245, 158, 11, 0.18) !important;
        }
        .rbq-sdt-preset-locked.rbq-sdt-locked-on .st-scene-trigger-toggle-ui::before {
            transform: translateX(26px) !important;
            background: #fbbf24 !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
        }
        /* 锁定停用态开关（强制关闭，如多角色严格定位）：优雅暗色安全静默 */
        .rbq-sdt-preset-locked.rbq-sdt-locked-off .st-scene-trigger-toggle-ui {
            opacity: 0.4 !important;
            background: rgba(255, 255, 255, 0.04) !important;
            border-color: rgba(255, 255, 255, 0.1) !important;
        }
        .rbq-sdt-preset-locked.rbq-sdt-locked-off .st-scene-trigger-toggle-ui::before {
            transform: translateX(0) !important;
            background: rgba(255, 255, 255, 0.25) !important;
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
            padding: 8px 14px !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(18, 22, 34, 0.95) !important;
            backdrop-filter: blur(12px) !important;
            gap: 10px !important;
            flex-shrink: 0 !important;
            box-sizing: border-box !important;
        }
        .mw-brand {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
        }
        .mw-logo {
            width: 28px !important;
            height: 28px !important;
            border-radius: 7px !important;
            background: linear-gradient(135deg, #f59e0b, #d97706) !important;
            color: #000 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 14px !important;
            box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3) !important;
        }
        .mw-title-box {
            display: flex !important;
            flex-direction: column !important;
            gap: 1px !important;
        }
        .mw-title {
            font-size: 13.5px !important;
            font-weight: 700 !important;
            color: #fff !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            white-space: nowrap !important;
        }
        .mw-badge {
            font-size: 9.5px !important;
            font-weight: 700 !important;
            padding: 1px 6px !important;
            border-radius: 999px !important;
            background: rgba(245, 158, 11, 0.18) !important;
            color: #fcd34d !important;
            border: 1px solid rgba(255, 158, 11, 0.35) !important;
        }
        .mw-subtitle {
            font-size: 10.5px !important;
            color: #94a3b8 !important;
        }
        /* 全局参数网格工具栏 (Subbar 4-Column Grid) */
        .mw-subbar {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 6px !important;
            padding: 6px 12px !important;
            background: rgba(13, 16, 25, 0.95) !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            flex-shrink: 0 !important;
            box-sizing: border-box !important;
        }
        @media (max-width: 680px) {
            .mw-subbar {
                grid-template-columns: repeat(2, 1fr) !important;
            }
        }
        .mw-subbar-item {
            display: flex !important;
            align-items: center !important;
            background: rgba(255, 255, 255, 0.04) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 6px !important;
            padding: 2px 6px !important;
            gap: 5px !important;
            min-width: 0 !important;
            transition: border-color 0.2s, background-color 0.2s !important;
        }
        .mw-subbar-item:hover, .mw-subbar-item:focus-within {
            background: rgba(255, 255, 255, 0.07) !important;
            border-color: rgba(245, 158, 11, 0.4) !important;
        }
        .mw-subbar-label {
            font-size: 10.5px !important;
            font-weight: 600 !important;
            color: #94a3b8 !important;
            display: flex !important;
            align-items: center !important;
            gap: 3px !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
        }
        .mw-subbar-item select.mw-sel {
            flex: 1 !important;
            min-width: 0 !important;
            background: transparent !important;
            border: none !important;
            color: #f1f5f9 !important;
            font-size: 11px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            outline: none !important;
            text-overflow: ellipsis !important;
            overflow: hidden !important;
            white-space: nowrap !important;
            padding: 2px 0 !important;
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
            padding: 8px 14px !important;
            font-size: 13px !important;
            font-weight: 800 !important;
            min-height: 36px !important;
            border-radius: 8px !important;
        }
        /* 主体双栏拓扑 */
        .mw-body {
            flex: 1 !important;
            display: grid !important;
            grid-template-columns: minmax(0, 6fr) minmax(240px, 3.5fr) !important;
            gap: 10px !important;
            padding: 10px !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
        }
        @media (max-width: 960px) {
            .mw-body {
                grid-template-columns: 1fr !important;
            }
        }
        .mw-left-pane {
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
            min-width: 0 !important;
        }
        .mw-right-pane {
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
            min-width: 0 !important;
        }
        .mw-card {
            background: rgba(24, 28, 42, 0.65) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 9px !important;
            padding: 9px 11px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 7px !important;
            box-sizing: border-box !important;
        }
        .mw-card-hd {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 6px !important;
            flex-wrap: wrap !important;
        }
        .mw-card-tt {
            font-size: 12px !important;
            font-weight: 700 !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            color: #e2e8f0 !important;
        }
        .mw-card-actions {
            display: flex !important;
            align-items: center !important;
            gap: 5px !important;
            flex-wrap: wrap !important;
        }
        .mw-story-card textarea {
            width: 100% !important;
            min-height: 54px !important;
            max-height: 100px !important;
            background: rgba(12, 15, 24, 0.8) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 6px !important;
            color: #fff !important;
            padding: 6px 8px !important;
            font-size: 11.5px !important;
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
            gap: 8px !important;
            flex-wrap: wrap !important;
        }
        .mw-story-opts {
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            flex-wrap: wrap !important;
        }
        .mw-count-pill {
            display: inline-flex !important;
            align-items: center !important;
            background: rgba(0, 0, 0, 0.4) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 6px !important;
            padding: 2px 6px !important;
            gap: 4px !important;
        }
        .mw-pill-label {
            font-size: 10px !important;
            font-weight: 600 !important;
            color: #cbd5e1 !important;
            display: flex !important;
            align-items: center !important;
            gap: 3px !important;
            white-space: nowrap !important;
        }
        .mw-count-sel {
            color: #fcd34d !important;
            font-weight: 600 !important;
            font-size: 11px !important;
            padding: 1px !important;
            cursor: pointer !important;
        }
        .mw-chip-toggle {
            display: inline-flex !important;
            align-items: center !important;
            cursor: pointer !important;
            user-select: none !important;
            margin: 0 !important;
        }
        .mw-chip-toggle input[type="checkbox"] {
            display: none !important;
        }
        .mw-chip-body {
            display: inline-flex !important;
            align-items: center !important;
            gap: 5px !important;
            padding: 2px 7px !important;
            border-radius: 999px !important;
            background: rgba(255, 255, 255, 0.05) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            color: #94a3b8 !important;
            font-size: 10px !important;
            font-weight: 500 !important;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .mw-chip-dot {
            width: 5px !important;
            height: 5px !important;
            border-radius: 50% !important;
            background: #64748b !important;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .mw-chip-toggle:hover .mw-chip-body {
            background: rgba(255, 255, 255, 0.08) !important;
            border-color: rgba(255, 255, 255, 0.2) !important;
        }
        .mw-chip-toggle input:checked + .mw-chip-body {
            background: rgba(245, 158, 11, 0.15) !important;
            border-color: rgba(245, 158, 11, 0.45) !important;
            color: #fef08a !important;
        }
        .mw-chip-toggle input:checked + .mw-chip-body .mw-chip-dot {
            background: #f59e0b !important;
            box-shadow: 0 0 6px #f59e0b !important;
        }
        .mw-btn-storyboard {
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            padding: 5px 12px !important;
            font-size: 11.5px !important;
        }
        /* 画格序列卡片流 (Storyboard Frames) */
        .mw-panels-list {
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
        }
        .mw-panel-card {
            background: rgba(15, 18, 28, 0.85) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-left: 3px solid rgba(245, 158, 11, 0.6) !important;
            border-radius: 7px !important;
            padding: 8px 10px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
        }
        .mw-panel-card:hover {
            border-color: rgba(245, 158, 11, 0.5) !important;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3) !important;
        }
        /* Row 1: Header (Badge + Title + Tools) */
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
        }
        .mw-panel-num {
            padding: 2px 6px !important;
            border-radius: 4px !important;
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.15)) !important;
            border: 1px solid rgba(245, 158, 11, 0.4) !important;
            color: #fcd34d !important;
            font-size: 11px !important;
            font-weight: 800 !important;
            font-family: monospace !important;
            flex-shrink: 0 !important;
        }
        .mw-panel-title-in {
            flex: 1 !important;
            min-width: 60px !important;
            background: rgba(0, 0, 0, 0.3) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            color: #fff !important;
            font-size: 11.5px !important;
            font-weight: 600 !important;
            padding: 3px 7px !important;
            border-radius: 4px !important;
            box-sizing: border-box !important;
            outline: none !important;
        }
        .mw-panel-title-in:focus {
            border-color: rgba(245, 158, 11, 0.5) !important;
            background: rgba(0, 0, 0, 0.5) !important;
        }
        .mw-panel-btns {
            display: flex !important;
            align-items: center !important;
            gap: 2px !important;
            flex-shrink: 0 !important;
        }
        .mw-panel-btns .mw-btn {
            width: 22px !important;
            height: 22px !important;
            padding: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-height: unset !important;
            flex-shrink: 0 !important;
            font-size: 10px !important;
            border-radius: 4px !important;
        }
        /* Row 2: Story Beat Description */
        .mw-panel-desc-row {
            display: flex !important;
            gap: 6px !important;
            align-items: center !important;
            width: 100% !important;
            min-width: 0 !important;
        }
        .mw-panel-desc-in {
            flex: 1 !important;
            min-width: 0 !important;
            background: rgba(0, 0, 0, 0.45) !important;
            border: 1px solid rgba(245, 158, 11, 0.3) !important;
            border-radius: 5px !important;
            color: #fef08a !important;
            padding: 4px 8px !important;
            font-size: 11.5px !important;
            box-sizing: border-box !important;
            outline: none !important;
        }
        .mw-panel-desc-in:focus {
            border-color: #f59e0b !important;
            background: rgba(0, 0, 0, 0.65) !important;
        }
        .mw-panel-ai-single {
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            font-size: 10.5px !important;
            padding: 3px 8px !important;
            min-height: 26px !important;
        }
        /* Row 3: Meta Row (Camera Viewfinder + Tags) */
        .mw-panel-meta-row {
            display: flex !important;
            gap: 6px !important;
            align-items: center !important;
            width: 100% !important;
            min-width: 0 !important;
        }
        .mw-panel-shot-box {
            display: inline-flex !important;
            align-items: center !important;
            background: rgba(99, 102, 241, 0.1) !important;
            border: 1px solid rgba(99, 102, 241, 0.3) !important;
            border-radius: 5px !important;
            padding: 2px 6px !important;
            gap: 4px !important;
            flex: 0 0 150px !important;
            min-width: 130px !important;
            max-width: 165px !important;
            box-sizing: border-box !important;
        }
        .mw-panel-shot-box i {
            color: #818cf8 !important;
            font-size: 10.5px !important;
            flex-shrink: 0 !important;
        }
        .mw-panel-shot-sel {
            background: transparent !important;
            border: none !important;
            color: #c7d2fe !important;
            font-size: 10.5px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            outline: none !important;
            width: 100% !important;
            min-width: 0 !important;
            text-overflow: ellipsis !important;
            overflow: hidden !important;
            white-space: nowrap !important;
            padding: 1px 0 !important;
        }
        .mw-panel-tags-box {
            flex: 1 !important;
            min-width: 0 !important;
            display: flex !important;
            align-items: center !important;
            background: rgba(0, 0, 0, 0.3) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 5px !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
        }
        .mw-tags-badge {
            padding: 2px 6px !important;
            background: rgba(255, 255, 255, 0.05) !important;
            border-right: 1px solid rgba(255, 255, 255, 0.08) !important;
            font-size: 9.5px !important;
            font-weight: 700 !important;
            color: #64748b !important;
            display: flex !important;
            align-items: center !important;
            gap: 3px !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
        }
        .mw-panel-tag-in {
            flex: 1 !important;
            min-width: 0 !important;
            background: transparent !important;
            border: none !important;
            color: #93c5fd !important;
            padding: 3px 6px !important;
            font-size: 10.5px !important;
            font-family: 'SF Mono', Consolas, Monaco, monospace !important;
            box-sizing: border-box !important;
            outline: none !important;
        }
        /* Row 4: Speech Bubble Row */
        .mw-bubble-row {
            display: flex !important;
            gap: 5px !important;
            background: rgba(14, 165, 233, 0.05) !important;
            padding: 4px 6px !important;
            border-radius: 5px !important;
            border: 1px solid rgba(14, 165, 233, 0.15) !important;
            align-items: center !important;
            box-sizing: border-box !important;
        }
        .mw-bubble-type-pill {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            background: rgba(0, 0, 0, 0.3) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 4px !important;
            padding: 2px 5px !important;
            flex-shrink: 0 !important;
        }
        .mw-bubble-type-sel {
            background: transparent !important;
            border: none !important;
            color: #7dd3fc !important;
            font-size: 10.5px !important;
            font-weight: 500 !important;
            outline: none !important;
            cursor: pointer !important;
            padding: 1px 0 !important;
        }
        .mw-bubble-text-in {
            flex: 1 !important;
            min-width: 0 !important;
            background: rgba(0, 0, 0, 0.35) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            color: #fff !important;
            font-size: 11px !important;
            padding: 3px 6px !important;
            border-radius: 4px !important;
            outline: none !important;
            box-sizing: border-box !important;
        }
        .mw-bubble-text-in:focus {
            border-color: #38bdf8 !important;
        }
        .mw-bubble-dir-sel {
            background: rgba(0, 0, 0, 0.3) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            color: #94a3b8 !important;
            font-size: 10.5px !important;
            padding: 2px 4px !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            flex-shrink: 0 !important;
        }
        /* 组装提示词预览 */
        .mw-code-block {
            background: #090b11 !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 6px !important;
            padding: 6px 8px !important;
            font-family: monospace !important;
            font-size: 10.5px !important;
            line-height: 1.4 !important;
            color: #94a3b8 !important;
            max-height: 70px !important;
            overflow-y: auto !important;
            word-break: break-all !important;
            user-select: text !important;
        }
        /* 右侧画布与出图控制 */
        .mw-canvas-wrapper {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 2px 0 !important;
        }
        .mw-canvas-viewport {
            width: 100% !important;
            max-width: 170px !important;
            max-height: 200px !important;
            aspect-ratio: 832 / 1216 !important;
            background: #05070a !important;
            border: 2px solid rgba(255, 255, 255, 0.12) !important;
            border-radius: 6px !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            position: relative !important;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
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
            padding: 8px !important;
            gap: 5px !important;
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
            font-size: 10px !important;
            font-family: monospace !important;
            background: rgba(255, 255, 255, 0.02) !important;
        }
        .mw-gen-box {
            display: flex !important;
            flex-direction: column !important;
            gap: 5px !important;
            margin-top: 2px !important;
        }
        .mw-action-row {
            display: grid !important;
            grid-template-columns: 1fr 1fr 1fr !important;
            gap: 4px !important;
        }
        .mw-action-row .mw-btn {
            padding: 3px 5px !important;
            font-size: 10.5px !important;
            min-height: 28px !important;
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
            if (!sdtStore._mangaActive) {
                const fields = ['systemPromptPreset', 'customSystemPrompt', 'systemPrompt', 'enhancedContext', 'multiCharOutput', 'multiCharUseCoords'];
                sdtStore._mangaSdtSnapshot = fields.map(key => ({ key, present: Object.prototype.hasOwnProperty.call(sdtStore, key), value: sdtStore[key] }));
            }
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
            sdtStore.multiCharOutput = true;
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
                if (Array.isArray(sdtStore._mangaSdtSnapshot)) {
                    for (const entry of sdtStore._mangaSdtSnapshot) {
                        if (entry.present) sdtStore[entry.key] = entry.value;
                        else delete sdtStore[entry.key];
                    }
                    delete sdtStore._mangaSdtSnapshot;
                }
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
                opt.textContent = '漫画 · 导演分镜与全息推演 (原版条目33&20&57 · 推荐)';
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
                    badge.innerHTML = '<i class="fa-solid fa-lock"></i> 漫画模式锁定 (条目33&20&57)';
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

        // 锁定/解锁多角色输出模式与 2D 坐标 (漫画模式按画格槽位接管，Game HUD 双行信息流)
        const mcCheck = document.getElementById('rbq-sdt-multichar');
        const mcField = mcCheck ? mcCheck.closest('.st-scene-trigger-field') : null;
        const coordsCheck = document.getElementById('rbq-sdt-multichar-coords');
        const coordsField = coordsCheck ? coordsCheck.closest('.st-scene-trigger-field') : null;

        if (mcCheck && mcField) {
            if (store.enabled) {
                mcCheck.checked = true;
                mcCheck.disabled = true;
                mcField.setAttribute('aria-checked', 'true');
                mcField.classList.add('rbq-sdt-preset-locked', 'rbq-sdt-locked-on');
                mcField.classList.remove('rbq-sdt-locked-off');
                let lockWrap = mcField.querySelector('.rbq-sdt-switch-lock-wrap');
                if (!lockWrap) {
                    lockWrap = document.createElement('div');
                    lockWrap.className = 'rbq-sdt-switch-lock-wrap';
                    lockWrap.innerHTML = `
                        <div class="rbq-sdt-switch-title-row">
                            <span class="rbq-sdt-switch-title-text">多角色输出模式</span>
                            <span class="rbq-sdt-preset-lock-badge"><i class="fa-solid fa-lock"></i> 漫画托管</span>
                        </div>
                        <div class="rbq-sdt-switch-lock-desc">画格分镜流接管 · 强制开启</div>
                    `;
                    const origSpan = mcField.querySelector(':scope > span:not(.st-scene-trigger-toggle)');
                    if (origSpan) {
                        origSpan.style.display = 'none';
                        mcField.insertBefore(lockWrap, origSpan.nextSibling);
                    }
                }
            } else {
                const sdtStore = getSdtStore();
                mcCheck.checked = !!sdtStore.multiCharOutput;
                mcCheck.disabled = false;
                mcField.setAttribute('aria-checked', mcCheck.checked ? 'true' : 'false');
                mcField.classList.remove('rbq-sdt-preset-locked', 'rbq-sdt-locked-on', 'rbq-sdt-locked-off');
                const lockWrap = mcField.querySelector('.rbq-sdt-switch-lock-wrap');
                if (lockWrap) lockWrap.remove();
                const origSpan = mcField.querySelector(':scope > span:not(.st-scene-trigger-toggle)');
                if (origSpan) origSpan.style.display = '';
                const badge = mcField.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }

        if (coordsCheck && coordsField) {
            if (store.enabled) {
                coordsCheck.checked = false;
                coordsCheck.disabled = true;
                coordsField.setAttribute('aria-checked', 'false');
                coordsField.classList.add('rbq-sdt-preset-locked', 'rbq-sdt-locked-off');
                coordsField.classList.remove('rbq-sdt-locked-on');
                let lockWrap = coordsField.querySelector('.rbq-sdt-switch-lock-wrap');
                if (!lockWrap) {
                    lockWrap = document.createElement('div');
                    lockWrap.className = 'rbq-sdt-switch-lock-wrap';
                    lockWrap.innerHTML = `
                        <div class="rbq-sdt-switch-title-row">
                            <span class="rbq-sdt-switch-title-text">多角色严格定位</span>
                            <span class="rbq-sdt-preset-lock-badge muted"><i class="fa-solid fa-ban"></i> 漫画停用</span>
                        </div>
                        <div class="rbq-sdt-switch-lock-desc">按分镜格序排版 · 2D坐标已停用</div>
                    `;
                    const origSpan = coordsField.querySelector(':scope > span:not(.st-scene-trigger-toggle)');
                    if (origSpan) {
                        origSpan.style.display = 'none';
                        coordsField.insertBefore(lockWrap, origSpan.nextSibling);
                    }
                }
            } else {
                const sdtStore = getSdtStore();
                coordsCheck.checked = !!sdtStore.multiCharUseCoords;
                coordsCheck.disabled = false;
                coordsField.setAttribute('aria-checked', coordsCheck.checked ? 'true' : 'false');
                coordsField.classList.remove('rbq-sdt-preset-locked', 'rbq-sdt-locked-on', 'rbq-sdt-locked-off');
                const lockWrap = coordsField.querySelector('.rbq-sdt-switch-lock-wrap');
                if (lockWrap) lockWrap.remove();
                const origSpan = coordsField.querySelector(':scope > span:not(.st-scene-trigger-toggle)');
                if (origSpan) origSpan.style.display = '';
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

    function createStoryboardTemplatePanels(preset) {
        const content = {
            'sunset-confession': [
                ['classroom, sunset, window light', 'girl, adult, long dark hair, light blouse, pleated skirt, looking down, blush, fidgeting with skirt'],
                ['classroom', 'girl, hands, light blouse sleeves, holding envelope with both hands'],
                ['classroom, fluttering curtain', 'girl, adult, long dark hair, wide eyes, tears']
            ],
            'shonen-battle': [
                ['battlefield, storm, destroyed city, dark clouds, lightning, debris', ''],
                ['battlefield, electric sparks', 'boy, adult, short dark hair, cloak, unsheathing katana, sharp eyes'],
                ['battlefield, speed lines', 'boy, adult, short dark hair, cloak, leaping forward, sword slash, shouting'],
                ['battlefield, smoke, shattered ground', 'boy, adult, short dark hair, back view, cape fluttering, holding katana']
            ],
            'daily-4koma': [
                ['kitchen, morning light', 'girl, long dark hair, blouse, pleated skirt, smiling, holding plate of toast'],
                ['kitchen, wall clock', 'girl, long dark hair, wide eyes, sweatdrop, looking at clock'],
                ['street, wind', 'girl, long dark hair, blouse, pleated skirt, running, toast in mouth, panicked'],
                ['closed school gate, calendar', 'girl, long dark hair, blouse, pleated skirt, blank eyes, standing']
            ],
            'cinema-mystery': [
                ['dimly lit office, rainy window, rain streaks, wet glass, night city lights, cigarette smoke', ''],
                ['dark room, dramatic shadows', 'boy, adult, short dark hair, sharp gaze, holding magnifying glass, shadow over eyes']
            ]
        };
        const rows = content[preset.id];
        if (!rows) return JSON.parse(JSON.stringify(preset.panels));
        return preset.panels.map((panel, i) => {
            const [environment, actor] = rows[i];
            const nonPersonText = ['caption', 'sfx', 'offscreen'].includes(panel.bubbleType) || !actor;
            const bubble = studioBubbleCaption({ ...panel, bubbleLayout: panel.bubbleType === 'caption' ? 'horizontal' : 'vertical' });
            return { ...panel, tags: environment, bubbleText: '',
                non_character: nonPersonText ? bubble : '',
                characters: actor ? [{ character_id: 'C1', name: '主角', positive: joinMangaCaptions([actor, nonPersonText ? '' : bubble]), negative: '' }] : []
            };
        });
    }

    function resolveBubbleTypeTag(bType) {
        if (!bType) return '通常吹き出し';
        const lower = String(bType).toLowerCase().trim();
        if (lower.includes('thought') || lower.includes('思考') || lower.includes('心声')) return '思考の吹き出し';
        if (lower.includes('scream') || lower.includes('叫び') || lower.includes('怒') || lower.includes('jagged') || lower.includes('ギザギザ')) return '叫び吹き出し';
        if (lower.includes('caption') || lower.includes('旁白') || lower.includes('ナレーション')) return '矩形のナレーション枠';
        if (lower.includes('sfx') || lower.includes('拟音') || lower.includes('擬音') || lower.includes('sound')) return '擬音, 吹き出しなし';
        if (lower.includes('whisper') || lower.includes('破線') || lower.includes('dashed') || lower.includes('耳语') || lower.includes('虚')) return '破線吹き出し';
        if (lower.includes('shiver') || lower.includes('波打つ') || lower.includes('wavy') || lower.includes('颤') || lower.includes('抖')) return '波打つ吹き出し';
        if (lower.includes('broadcast') || lower.includes('四角') || lower.includes('square') || lower.includes('radio') || lower.includes('phone') || lower.includes('机械')) return '四角い吹き出し';
        if (lower.includes('offscreen') || lower.includes('切り欠き') || lower.includes('notch') || lower.includes('画外')) return '切り欠きのある吹き出し';
        if (lower.includes('tailless') || lower.includes('しっぽなし') || lower.includes('oval') || lower.includes('独白') || lower.includes('无尾')) return 'しっぽなしの楕円吹き出し';
        if (lower.includes('connected') || lower.includes('連結') || lower.includes('连语') || lower.includes('双连')) return '連結吹き出し';
        return '通常吹き出し';
    }

    function resolveBubbleLayoutTag(layout, bType) {
        if (layout === 'horizontal' || bType === 'caption' || String(bType).includes('ナレーション')) {
            return 'Layout: 横書き';
        }
        return 'Layout: 縦書き';
    }

    function defaultPanelPosition(index, count, grammar) {
        if (count === 1) return 'full-page panel';
        if (grammar === '4koma') return ['top panel', 'upper-middle panel', 'lower-middle panel', 'bottom panel'][index] || `tier ${index + 1} panel`;
        const layouts = {
            2: ['top panel', 'bottom panel'],
            3: ['top-right small panel', 'top-left small panel', 'bottom wide focal panel'],
            4: ['top wide panel', 'middle-right small panel', 'middle-left small panel', 'bottom wide focal panel'],
            5: ['top-right small panel', 'top-left small panel', 'middle wide focal panel', 'bottom-right small panel', 'bottom-left small panel']
        };
        return layouts[count]?.[index] || `tier ${index + 1} panel`;
    }

    function studioBubbleCaption(panel) {
        const text = String(panel.bubbleText || '').trim();
        if (!text) return '';
        const type = panel.bubbleType || 'speech';
        const visual = type === 'sfx' ? 'SFX: 擬音, 吹き出しなし' : `BubbleType: ${resolveBubbleTypeTag(type)}, ${type === 'offscreen' ? '画面外' : '右上'}`;
        return `${visual}, ${resolveBubbleLayoutTag(panel.bubbleLayout, type)}, Text: ${text}`;
    }

    function buildStudioPage(store) {
        const studio = store.studio;
        const count = studio.panels.length;
        const seen = new Map();
        const panels = studio.panels.map((p, index) => {
            const position = p.position || defaultPanelPosition(index, count, store.grammar);
            const structured = Array.isArray(p.characters);
            const characters = (p.characters || []).map(c => {
                if (!seen.has(c.character_id)) seen.set(c.character_id, new Set());
                // Use explicit subject tags from all appearances, never an action's target or dialogue.
                filterMangaTags(splitMangaText(c.positive).visual, new Set(), tag => {
                    if (/^(?:\d+)?(?:girls?|women|woman|female|(?:adult|mature|young) (?:woman|female))$/i.test(tag)) seen.get(c.character_id).add('girl');
                    else if (/^(?:\d+)?(?:boys?|men|man|male|(?:adult|mature|young) (?:man|male))$/i.test(tag)) seen.get(c.character_id).add('boy');
                    else if (/^(?:\d+)?others?$/i.test(tag)) seen.get(c.character_id).add('other');
                    return tag;
                });
                return { ...c, positive: joinMangaCaptions([position, p.shot, typeof RBQ.api.renderCharacterMemoryBase === 'function' ? RBQ.api.renderCharacterMemoryBase(c.name, c.positive) : c.positive]) };
            });
            return {
                id: `P${index + 1}`,
                // Legacy mixed tags remain visible page content until explicitly re-parsed; never guess a person from them.
                description: joinMangaCaptions([position, p.shot, p.tags]),
                non_character: (p.non_character || (!structured && p.bubbleText))
                    ? joinMangaCaptions([position, p.non_character, structured ? '' : studioBubbleCaption(p)]) : '',
                characters
            };
        });
        const allStructured = studio.panels.every(p => Array.isArray(p.characters));
        let people = '';
        if (allStructured) {
            const totals = { girl: 0, boy: 0, other: 0 };
            // A cropped later appearance can omit its subject. Contradictory/unknown identity stays unspecified.
            const knownSubjects = [...seen.values()].every(subjects => subjects.size === 1);
            if (knownSubjects) {
                for (const subjects of seen.values()) totals[[...subjects][0]]++;
                people = !seen.size ? 'no humans' : Object.entries(totals).filter(([, n]) => n).map(([t, n]) => `${n}${t}${n > 1 ? 's' : ''}`).join(', ');
            }
        }
        const form = count === 1 ? 'splash page, 単一コマ' : `comic, 複数コマの漫画ページ, ${count} panels`;
        const layout = studio.ratio === '1216x832' ? '見開きページ' : 'vertical layout';
        const gutter = (GUTTER_PRESETS[store.gutter] || GUTTER_PRESETS.bleed).tag;
        return {
            format: 'nai5-comic',
            page: { base: [form, people, layout, gutter, GRAMMAR_TAGS[store.grammar] || '',
                ...studio.panels.map((p, i) => p.position || defaultPanelPosition(i, count, store.grammar))].filter(Boolean).join(', ') },
            panels
        };
    }

    function composeStudioPrompt(store) {
        const compiled = compileMangaPage(buildStudioPage(store));
        return [compiled.base, ...compiled.characters.map(c => c.caption)].join(' | ');
    }

    function studioPanelFromProtocol(panel, index = 0) {
        // Studio keeps position/shot separate so edits apply to every person in a panel.
        return {
            title: panel.title || `画格 ${index + 1}`, desc: panel.desc || panel.title || '',
            position: panel.position || '', shot: panel.shot || '', tags: panel.description || '',
            non_character: panel.non_character || '', characters: panel.characters.map(person => {
                const { base, outfit, state, render, _mangaAppearance, _mangaInitialAppearance, ...c } = person;
                return { ...c, positive: mangaCharacterCaption(person, !!render) };
            }),
            bubbleText: '', bubbleType: 'caption', bubbleLayout: 'horizontal'
        };
    }

    function studioDirectorPrompt(store, task) {
        return buildMangaSystemPrompt({ ...store, antiHijack: store.studio?.antiHijack ?? store.antiHijack }) + `
【工作台任务】${task}
输入 mangaCanvas 是本页实际画布像素与方向，按文字和主动作共同需要分配画格空间；调整格大小和对白分泡，保留关键问答。
若输入带 characterCardInfo/characterMemory，按姓名参考角色卡与已存外貌衣着，未知不猜、已有不漏；当前剧情的明确变化优先，完整外貌放 base、完整衣着放 outfit、本格演出放 positive，不额外更新长期记忆档案。
拟音偏好：${store.studio?.autoSfx === false ? '不补拟音，只保留用户明确要求的原句。' : '可转译正文明确出现的独立拟音，禁止凭空补字。'}
只输出一个 JSON 对象 {"panels":[...]}。各格使用 id、title、desc（本格剧情原句）、position（唯一版面位置和大小）、shot（景别）、description（纯环境）、non_character（旁白/拟音/画外文字）、characters 数组。
position 单独写位置，description/positive 不重复画格位置；系统会统一附加 position 和 shot。characters 每项使用 character_id、name、base、outfit、positive、negative，可附 state；黑白模式按同一规则提供并复用 render；按普通模式的完整 base/outfit 复用资料。character_id 跨格同人保持一致。description 不含人物动作，人物动作和对白进自己的 positive，外貌与服装分别进 base/outfit；没有人物时 characters=[]。
同格双人对话必须两个角色条目，每人 Text: 只包含自己的话；非人物文字不要建人物。任何没有原文依据的文字都不要编造。保留句子、人物、道具和动作先后，不截断故事末尾。
局部镜头用 shot 指定，base/outfit 仍保留完整资料，不按部位删标签。`;
    }

    async function requestStudioPanels(store, task, content, expectedCount, editingSnapshots = false) {
        store = { ...store, studio: { ...store.studio } };
        const config = getSdtStore();
        const baseUrl = String(config.openaiBaseUrl || '').trim().replace(/\/+$/, '');
        const model = String(config.openaiModelCustom || config.openaiModel || '').trim();
        if (!baseUrl || !model) throw new Error('请先在智能生图中配置 OpenAI 兼容接口和模型；现有分镜已保留');
        const references = typeof RBQ.api.collectMangaReferenceData === 'function' ? RBQ.api.collectMangaReferenceData(content) : {};
        const userContent = JSON.stringify({ currentMessage: content, ...references, mangaCanvas: buildMangaPlanningContext(store.studio?.ratio) });
        const endpoint = /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
        const response = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.openaiApiKey ? { Authorization: `Bearer ${config.openaiApiKey}` } : {}) },
            body: JSON.stringify({ model, temperature: 0.2, messages: [
                { role: 'system', content: studioDirectorPrompt(store, task) + (editingSnapshots
                    ? '\n本次润色已有分镜：已有格内 positive 是该时刻的完整外貌衣着快照，优先于聊天档案默认服装。保留既有和前格持续状态，按本格明确变化调整；将已有完整快照拆成 base/outfit/positive，保留全部外貌服装与本格动作，不只返回增量。' : '') }, { role: 'user', content: userContent }
            ] })
        });
        if (!response.ok) throw new Error(`漫画分镜接口失败 (HTTP ${response.status})；现有分镜已保留`);
        const result = await response.json();
        const reply = String(result.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const data = JSON.parse(reply);
        if (!Array.isArray(data.panels) || !data.panels.length || data.panels.length > 5
            || (expectedCount && data.panels.length !== expectedCount)) throw new Error('返回的画格数量不符合要求，请重试；现有分镜已保留');
        const rawPage = { format: 'nai5-comic', page: { base: 'comic' }, panels: data.panels };
        // Editing operates on complete draft captions; reapplying the live profile here would undo draft changes.
        const page = resolveMangaAppearances([rawPage], editingSnapshots ? [] : references.characterMemory || [], [], [], store)[0];
        compileMangaPage(page);
        return page.panels.map(studioPanelFromProtocol);
    }

    async function callLlmStoryboardParser(storyText, grammar, language, panelCountMode = 'auto', onProgress) {
        const store = { ...getStore(), grammar, language };
        if (grammar === '4koma' && panelCountMode !== 'auto' && Number(panelCountMode) !== 4) {
            throw new Error('经典四格请选择自动规划或4格；其他格数请切换分镜文法');
        }
        const fixed = panelCountMode !== 'auto' ? Math.max(1, Math.min(5, Number(panelCountMode) || 1)) : (grammar === '4koma' ? 4 : 0);
        if (onProgress) onProgress('正在按画格、人物与文字归属解析剧情...');
        return requestStudioPanels(store, fixed ? `本页明确要求 ${fixed} 格，请完整安排剧情。` : '为本页自适应规划1至5格，允许整页单格；相邻事件按容量合并，完整覆盖剧情。', storyText, fixed);
    }

    async function callLlmSingleSentenceExpander(sentence, currentShot, grammar, language, allPanels = [], currentIndex = 0) {
        const result = await requestStudioPanels({ ...getStore(), grammar, language },
            '只返回正在编辑的一个画格；不因整页文法扩写其他格。参照已有角色身份，保持同一 character_id；不要复述其他格事件。',
            JSON.stringify({ currentMessage: sentence, currentShot, currentIndex, otherPanels: allPanels }), 1, true);
        return result[0];
    }

    async function callLlmBatchSentenceExpander(panels, grammar, language, onProgress) {
        if (grammar === '4koma' && panels.length !== 4) throw new Error('经典四格需要4个画格；请调整格数或切换文法');
        if (onProgress) onProgress('正在核对逐格人物、对白和连续状态...');
        return requestStudioPanels({ ...getStore(), grammar, language }, `保持现有 ${panels.length} 格的次序与剧情，逐格完善演出和人物归属。`, JSON.stringify(panels), panels.length, true);
    }

    function renderStudioCharacterFields(panel) {
        const esc = RBQ.utils.escapeHtml;
        if (!Array.isArray(panel.characters)) return '<div class="mw-desc">旧版混合标签已保留。点击“AI 润色本格”或“批量解析”可拆分格内人物与对白。</div>';
        return `<details class="rbq-manga-people" ${panel._editorOpen ? 'open' : ''}><summary>格内人物与文字 · ${panel.characters.length} 人</summary><div class="rbq-manga-people-body">
            <label>本格旁白 / 拟音 / 画外文字<textarea class="rbq-manga-non-character" placeholder="视觉说明，Layout: 横書き，Text: 原文">${esc(panel.non_character || '')}</textarea></label>
            ${panel.characters.map((c, i) => `<fieldset class="rbq-manga-person" data-person="${i}">
                <legend>人物 ${i + 1}</legend>
                <label>身份编号（同一人跨格保持相同）<input data-field="character_id" value="${esc(c.character_id || '')}"></label>
                <label>姓名<input data-field="name" value="${esc(c.name || '')}"></label>
                <label>本镜头人物与对白<textarea data-field="positive" placeholder="girl, 可见外貌与动作, BubbleType: 通常吹き出し, Layout: 縦書き, Text: 台词">${esc(c.positive || '')}</textarea></label>
                <label>人物负面词<textarea data-field="negative">${esc(c.negative || '')}</textarea></label>
                <button type="button" class="mw-btn rbq-manga-remove-person">移除本格出场</button>
            </fieldset>`).join('')}
            <button type="button" class="mw-btn rbq-manga-add-person">添加本格人物</button>
            ${panel.characters.length ? '' : '<span class="mw-desc">当前为空镜，不创建人物槽。</span>'}
        </div></details>`;
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
                </div>

                <!-- Global Settings 4-Column Grid Bar -->
                <div class="mw-subbar">
                    <div class="mw-subbar-item">
                        <span class="mw-subbar-label"><i class="fa-solid fa-brush" style="color:#f59e0b"></i> 画风</span>
                        <select id="mw-hdr-style" class="mw-sel">
                            <option value="monochrome" ${store.style === 'monochrome' ? 'selected' : ''}>黑白印刷</option>
                            <option value="soft_color" ${store.style === 'soft_color' ? 'selected' : ''}>柔光全彩</option>
                            <option value="custom" ${store.style === 'custom' ? 'selected' : ''}>自定义画风</option>
                        </select>
                    </div>
                    <div class="mw-subbar-item">
                        <span class="mw-subbar-label"><i class="fa-solid fa-clapperboard" style="color:#6366f1"></i> 文法</span>
                        <select id="mw-hdr-grammar" class="mw-sel">
                            <option value="cinema" ${store.grammar === 'cinema' ? 'selected' : ''}>通用映画</option>
                            <option value="4koma" ${store.grammar === '4koma' ? 'selected' : ''}>经典四格</option>
                            <option value="shonen" ${store.grammar === 'shonen' ? 'selected' : ''}>热血少年</option>
                            <option value="mystery" ${store.grammar === 'mystery' ? 'selected' : ''}>青年悬疑</option>
                            <option value="shojo" ${store.grammar === 'shojo' ? 'selected' : ''}>唯美少女</option>
                            <option value="daily" ${store.grammar === 'daily' ? 'selected' : ''}>日常平实</option>
                            <option value="comedy" ${store.grammar === 'comedy' ? 'selected' : ''}>夸张搞笑</option>
                            <option value="ecchi" ${store.grammar === 'ecchi' ? 'selected' : ''}>微涩构图</option>
                        </select>
                    </div>
                    <div class="mw-subbar-item">
                        <span class="mw-subbar-label"><i class="fa-solid fa-crop-simple" style="color:#10b981"></i> 画布</span>
                        <select id="mw-hdr-ratio" class="mw-sel">
                            <option value="832x1216" ${studio.ratio === '832x1216' ? 'selected' : ''}>纵向单页 (832×1216)</option>
                            <option value="1216x832" ${studio.ratio === '1216x832' ? 'selected' : ''}>跨页展开 (1216×832)</option>
                            <option value="896x1152" ${studio.ratio === '896x1152' ? 'selected' : ''}>宽幅剧场 (896×1152)</option>
                        </select>
                    </div>
                    <div class="mw-subbar-item">
                        <span class="mw-subbar-label"><i class="fa-solid fa-border-all" style="color:#ec4899"></i> 留白</span>
                        <select id="mw-hdr-gutter" class="mw-sel">
                            <option value="bleed" ${store.gutter === 'bleed' ? 'selected' : ''}>天地出血</option>
                            <option value="framed" ${store.gutter === 'framed' ? 'selected' : ''}>封闭白边</option>
                            <option value="splash" ${store.gutter === 'splash' ? 'selected' : ''}>沉浸全出血</option>
                            <option value="black_line" ${store.gutter === 'black_line' ? 'selected' : ''}>纯黑线</option>
                        </select>
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
                                <div class="mw-story-opts">
                                    <div class="mw-count-pill">
                                        <span class="mw-pill-label"><i class="fa-solid fa-table-cells-large" style="color:#f59e0b"></i> 格数:</span>
                                        <select id="mw-story-panel-count" class="mw-sel mw-count-sel">
                                            <option value="auto" ${(!studio.panelCountMode || studio.panelCountMode === 'auto') ? 'selected' : ''}>🤖 自动规划</option>
                                            <option value="1" ${studio.panelCountMode === '1' ? 'selected' : ''}>1 格 (单格)</option>
                                            <option value="2" ${studio.panelCountMode === '2' ? 'selected' : ''}>2 格 (起承)</option>
                                            <option value="3" ${studio.panelCountMode === '3' ? 'selected' : ''}>3 格 (三段)</option>
                                            <option value="4" ${studio.panelCountMode === '4' ? 'selected' : ''}>4 格 (四格)</option>
                                            <option value="5" ${studio.panelCountMode === '5' ? 'selected' : ''}>5 格 (密集)</option>
                                        </select>
                                    </div>
                                    <label class="mw-chip-toggle">
                                        <input type="checkbox" id="mw-chk-anti-hijack" ${studio.antiHijack !== false ? 'checked' : ''}>
                                        <span class="mw-chip-body">
                                            <span class="mw-chip-dot"></span>
                                            <span>角色防夺舍</span>
                                        </span>
                                    </label>
                                    <label class="mw-chip-toggle">
                                        <input type="checkbox" id="mw-chk-auto-sfx" ${studio.autoSfx !== false ? 'checked' : ''}>
                                        <span class="mw-chip-body">
                                            <span class="mw-chip-dot"></span>
                                            <span>拟音词 (SFX)</span>
                                        </span>
                                    </label>
                                </div>
                                <button id="mw-btn-ai-storyboard" class="mw-btn pri mw-btn-storyboard"><i class="fa-solid fa-brain"></i> AI 智能分镜推演</button>
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
                                <span class="mw-card-tt"><i class="fa-solid fa-eye" style="color:#f59e0b"></i> 漫画预览</span>
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
                try { promptPreviewEl.textContent = composeStudioPrompt(store); }
                catch (error) { promptPreviewEl.textContent = error.message; }
            }
        }

        function updateViewport() {
            if (!viewportEl) return;
            const ratio = studio.ratio || '832x1216';
            const [w, h] = ratio.split('x').map(Number);
            if (w && h) {
                viewportEl.style.aspectRatio = `${w} / ${h}`;
                viewportEl.style.maxWidth = (w > h) ? '240px' : '170px';
            }
            const resText = ratio.replace('x', ' × ') + ' PX';
            if (resBadgeEl) resBadgeEl.textContent = resText;

            function renderPlaceholder() {
                viewportEl.innerHTML = `
                    <div class="mw-blueprint-placeholder">
                        <div class="mw-bp-panel">漫画原图预览<br>生成后显示</div>
                    </div>
                `;
                if (btnSendChat) btnSendChat.disabled = true;
                if (btnDownload) btnDownload.disabled = true;
                if (btnZoom) btnZoom.disabled = true;
            }

            if (studio.lastGeneratedUrl) {
                viewportEl.innerHTML = `<img src="${RBQ.utils.escapeHtml(studio.lastGeneratedUrl)}" alt="Generated Manga Page" title="双击大图全屏走查">`;
                const img = viewportEl.querySelector('img');
                img?.addEventListener('dblclick', () => {
                    showMangaViewerModal(studio.lastGeneratedUrl, studio.lastGeneratedPrompt);
                });
                img?.addEventListener('error', () => {
                    // Fallback to blueprint placeholder if image fails to load
                    renderPlaceholder();
                });
                if (btnSendChat) btnSendChat.disabled = false;
                if (btnDownload) btnDownload.disabled = false;
                if (btnZoom) btnZoom.disabled = false;
            } else {
                renderPlaceholder();
            }
        }

        function renderPanelCards() {
            if (!panelsListEl) return;
            countBadgeEl.textContent = String(studio.panels.length);
            panelsListEl.innerHTML = studio.panels.map((p, idx) => `
                <div class="mw-panel-card" data-idx="${idx}">
                    <!-- Row 1: Badge + Title + Action buttons -->
                    <div class="mw-panel-hd">
                        <div class="mw-panel-info">
                            <span class="mw-panel-num">#${idx + 1}</span>
                            <input type="text" class="mw-panel-title-in" value="${RBQ.utils.escapeHtml(p.title || '')}" placeholder="画格场景（如：起景 · 夜路）...">
                        </div>
                        <div class="mw-panel-btns">
                            <button class="mw-btn sm mw-panel-up" ${idx === 0 ? 'disabled' : ''} title="上移画格"><i class="fa-solid fa-arrow-up"></i></button>
                            <button class="mw-btn sm mw-panel-down" ${idx === studio.panels.length - 1 ? 'disabled' : ''} title="下移画格"><i class="fa-solid fa-arrow-down"></i></button>
                            <button class="mw-btn sm mw-panel-dup" title="复制画格"><i class="fa-regular fa-copy"></i></button>
                            <button class="mw-btn sm rd mw-panel-del" ${studio.panels.length <= 1 ? 'disabled' : ''} title="删除画格"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>

                    <!-- Row 2: Story Beat Description + AI Polisher -->
                    <div class="mw-panel-desc-row">
                        <input type="text" class="mw-panel-desc-in" value="${RBQ.utils.escapeHtml(p.desc || '')}" placeholder="✍️ 输入本格剧情描述（如：少女红着脸递出情书）...">
                        <button class="mw-btn sm cy mw-panel-ai-single" title="针对本格填入的句子，单独调用 AI 生成 Tag、机位与对白"><i class="fa-solid fa-wand-magic-sparkles"></i> AI 润色本格</button>
                    </div>

                    <!-- Row 3: Camera Viewfinder + Tags -->
                    <div class="mw-panel-meta-row">
                        <div class="mw-panel-shot-box" title="分镜机位景别">
                            <i class="fa-solid fa-video"></i>
                            <select class="mw-panel-shot-sel">
                                ${renderShotOptions(p.shot)}
                            </select>
                        </div>
                        <div class="mw-panel-tags-box">
                            <span class="mw-tags-badge"><i class="fa-solid fa-tags"></i> TAGS</span>
                            <input type="text" class="mw-panel-tag-in" value="${RBQ.utils.escapeHtml(p.tags || '')}" placeholder="本格环境与构图（人物写入下方独立出场）...">
                        </div>
                    </div>

                    <!-- Row 4: Speech Bubble Composer -->
                    <label class="rbq-manga-position-label">画格位置与大小<input class="mw-panel-desc-in rbq-manga-position-in" value="${RBQ.utils.escapeHtml(p.position || '')}" placeholder="${defaultPanelPosition(idx, studio.panels.length, store.grammar)}"></label>
                    ${renderStudioCharacterFields(p)}
                    <div class="mw-bubble-row" ${Array.isArray(p.characters) ? 'style="display:none !important"' : ''}>
                        <div class="mw-bubble-type-pill">
                            <i class="fa-regular fa-comment-dots" style="color:#38bdf8"></i>
                            <select class="mw-bubble-type-sel">
                                <option value="speech" ${p.bubbleType === 'speech' ? 'selected' : ''}>💬 常规对白 (通常)</option>
                                <option value="screaming" ${p.bubbleType === 'screaming' ? 'selected' : ''}>⚡ 呐喊惊呼 (ギザギザ)</option>
                                <option value="thought" ${p.bubbleType === 'thought' ? 'selected' : ''}>💭 心理心声 (思考)</option>
                                <option value="whisper" ${p.bubbleType === 'whisper' ? 'selected' : ''}>💨 破线耳语 (破線)</option>
                                <option value="shiver" ${p.bubbleType === 'shiver' ? 'selected' : ''}>〰️ 发颤恐惧 (波打つ)</option>
                                <option value="broadcast" ${p.bubbleType === 'broadcast' ? 'selected' : ''}>📻 四角广播 (四角い)</option>
                                <option value="caption" ${p.bubbleType === 'caption' ? 'selected' : ''}>📜 矩形旁白 (ナレーション)</option>
                                <option value="sfx" ${p.bubbleType === 'sfx' ? 'selected' : ''}>💥 独立拟音 (擬音)</option>
                                <option value="offscreen" ${p.bubbleType === 'offscreen' ? 'selected' : ''}>🚪 画外声源 (切り欠き)</option>
                                <option value="tailless" ${p.bubbleType === 'tailless' ? 'selected' : ''}>⭕ 无尾独白 (しっぽなし)</option>
                                <option value="connected" ${p.bubbleType === 'connected' ? 'selected' : ''}>🔗 紧凑双连 (連結)</option>
                            </select>
                        </div>
                        <input type="text" class="mw-bubble-text-in" value="${RBQ.utils.escapeHtml(p.bubbleText || '')}" placeholder="输入气泡内台词或独白文字...">
                        <select class="mw-bubble-dir-sel" title="文字排版方向">
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

                card.querySelector('.rbq-manga-position-in')?.addEventListener('input', e => {
                    p.position = e.target.value; updatePromptPreview(); save();
                });
                card.querySelector('.mw-panel-title-in')?.addEventListener('input', (e) => {
                    p.title = e.target.value;
                    save();
                });
                card.querySelector('.mw-panel-desc-in')?.addEventListener('input', (e) => {
                    p.desc = e.target.value;
                    save();
                });
                card.querySelector('.rbq-manga-people')?.addEventListener('toggle', e => { p._editorOpen = e.target.open; });
                card.querySelector('.rbq-manga-non-character')?.addEventListener('input', e => {
                    p.non_character = e.target.value; updatePromptPreview(); save();
                });
                card.querySelectorAll('.rbq-manga-person').forEach(row => {
                    const personIndex = Number(row.dataset.person);
                    row.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', e => {
                        p.characters[personIndex][input.dataset.field] = e.target.value;
                        updatePromptPreview(); save();
                    }));
                    row.querySelector('.rbq-manga-remove-person')?.addEventListener('click', () => {
                        p.characters.splice(personIndex, 1); renderPanelCards(); updatePromptPreview(); save();
                    });
                });
                card.querySelector('.rbq-manga-add-person')?.addEventListener('click', () => {
                    const used = new Set(studio.panels.flatMap(panel => (panel.characters || []).map(c => c.character_id)));
                    let number = 1;
                    while (used.has(`C${number}`)) number++;
                    p.characters.push({ character_id: `C${number}`, name: '', positive: 'girl', negative: '' });
                    renderPanelCards(); updatePromptPreview(); save();
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
                            Object.assign(p, expanded);
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
                        studio.panels.forEach(panel => { panel.position = ''; });
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
                        studio.panels.forEach(panel => { panel.position = ''; });
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
                    studio.panels.forEach(panel => { panel.position = ''; });
                    renderPanelCards();
                    updatePromptPreview();
                    save();
                });
                card.querySelector('.mw-panel-del')?.addEventListener('click', () => {
                    if (studio.panels.length <= 1) return;
                    studio.panels.splice(idx, 1);
                    studio.panels.forEach(panel => { panel.position = ''; });
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
                            Object.assign(targetPanel, item);

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
            studio.panels.forEach(panel => { panel.position = ''; });
            studio.panels.push({
                title: `第 ${studio.panels.length + 1} 格 · 画面`,
                desc: '',
                shot: 'medium shot',
                tags: '', characters: [], non_character: '',
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
                studio.panels = createStoryboardTemplatePanels(preset);
                if (preset.grammar && GRAMMAR_PRESETS[preset.grammar]) {
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
            studio.panels = createStoryboardTemplatePanels(defaultPreset);
            renderPanelCards();
            updatePromptPreview();
            save();
            toastr.info('分镜画格已重置为初始状态', PLUGIN_NAME);
        });

        // Copy assembled prompt button
        container.querySelector('#mw-btn-copy-prompt')?.addEventListener('click', () => {
            let prompt;
            try { prompt = composeStudioPrompt(store); }
            catch (error) { return toastr.warning(error.message, PLUGIN_NAME); }
            RBQ.utils.copyToClipboard(prompt);
            toastr.success('已复制完整 NAI 漫画装配提示词！', PLUGIN_NAME);
        });

        // Generate Manga Single Page button
        btnGenerate?.addEventListener('click', async () => {
            if (!RBQ.api || typeof RBQ.api.generateImage !== 'function') {
                return toastr.error('RBQ Core 生图接口不可用', PLUGIN_NAME);
            }
            let compiled;
            try { compiled = compileMangaPage(buildStudioPage(store)); }
            catch (error) { return toastr.warning(error.message, PLUGIN_NAME); }
            const prompt = compiled.base;
            const origHtml = btnGenerate.innerHTML;
            btnGenerate.disabled = true;
            btnGenerate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在向生图引擎提交漫画任务...';

            studioGenerationRatio = studio.ratio || '832x1216';
            const generatePage = RBQ.api.generateSdtImage;
            // New SDT owns the character/settings snapshot; legacy hosts retain
            // the original Studio compatibility bridge.
            studioRequest = typeof generatePage === 'function' ? null : { prompt, compiled };
            const segment = { mangaPage: true, mangaUseCoords: compiled.useCoords, characters: compiled.characters,
                mangaRenderSettings: { ...captureMangaRenderSettings(), ratio: studioGenerationRatio } };

            try {
                const onProgress = (progress) => {
                    if (typeof progress === 'string') {
                        btnGenerate.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${progress.slice(0, 16)}...`;
                    }
                };
                const result = typeof generatePage === 'function'
                    ? await generatePage(segment, prompt, 'manga-workshop', {}, onProgress)
                    : await RBQ.api.generateImage(prompt, 'manga-workshop', {}, onProgress);

                if (result && result.url) {
                    studio.lastGeneratedUrl = result.url;
                    studio.lastGeneratedPrompt = [compiled.base, ...compiled.characters.map(c => c.caption)].join(' | ');
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
                studioGenerationRatio = null;
                studioRequest = null;
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
        if (RBQ.api.mangaProtocol === mangaProtocol) delete RBQ.api.mangaProtocol;
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
                field.classList.remove('rbq-sdt-preset-locked', 'rbq-sdt-locked-on', 'rbq-sdt-locked-off');
                field.setAttribute('aria-checked', mcCheck.checked ? 'true' : 'false');
                const lockWrap = field.querySelector('.rbq-sdt-switch-lock-wrap');
                if (lockWrap) lockWrap.remove();
                const origSpan = field.querySelector(':scope > span:not(.st-scene-trigger-toggle)');
                if (origSpan) origSpan.style.display = '';
                const badge = field.querySelector('.rbq-sdt-preset-lock-badge');
                if (badge) badge.remove();
            }
        }
        const coordsCheck = document.getElementById('rbq-sdt-multichar-coords');
        if (coordsCheck) {
            coordsCheck.disabled = false;
            const field = coordsCheck.closest('.st-scene-trigger-field');
            if (field) {
                field.classList.remove('rbq-sdt-preset-locked', 'rbq-sdt-locked-on', 'rbq-sdt-locked-off');
                field.setAttribute('aria-checked', coordsCheck.checked ? 'true' : 'false');
                const lockWrap = field.querySelector('.rbq-sdt-switch-lock-wrap');
                if (lockWrap) lockWrap.remove();
                const origSpan = field.querySelector(':scope > span:not(.st-scene-trigger-toggle)');
                if (origSpan) origSpan.style.display = '';
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
