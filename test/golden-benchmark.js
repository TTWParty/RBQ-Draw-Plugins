/**
 * 黄金基准用例集 (Golden Benchmark Cases)
 * 对应 15 种实战叙事情况（共 17 个子用例），已完成 100% 规则合规闭环
 */

const GOLDEN_BENCHMARK = {
  "S1_POV_STANDING_VS_KNEELING": {
    "shouldDraw": true,
    "reason": "①校舍阴影下站姿居高临下俯视跪地米拉哀求 ②L0米拉锚点复用 ③Safe级(无裸露,Scene UC排nude) ④分层:前景观察者黑色长裤裤管被双手抓握(自下边缘探入受力闭环),中景跪地米拉仰面哀求(占比65%),背景雨中校舍回廊 ⑤站姿看跪姿大高差(高差>80cm)→steep high angle, looking down from standing eye-level, bust shot from above, head tilted back, foreshortening, looking up at viewer, 严禁close-up ⑥米拉脚部出框下放UC ⑦左右手分写加权 ⑧自检输出",
    "segments": [
      {
        "label": "雨中哀求",
        "anchor": {"text": "双手紧紧抓着我的黑色长裤裤管苦苦哀求：'求求你，不要丢下我一个人……'"},
        "scene": "Scene: SFW, emotional drama, {1girl}, pov. Foreground: the viewer's black trousers leg entering from lower frame bottom edge, both hands clinging tightly to the fabric, strongly out of focus. Middle ground: a petite brown-haired girl kneeling on the wet concrete floor, body trembling, head tilted back looking up at viewer with pleading tearful eyes. Character occupying around 65% of the image height. Background: a dim school hallway receding into shadows, rain falling outside in blurred grey backdrop. Foreground viewer's trousers leg, Middle ground kneeling crying girl, Background dim hallway. pov, steep high angle, looking down from standing eye-level, bust shot from above, head tilted back, foreshortening, looking up at viewer, diffused cool lighting, moody shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Mira (original)",
            "base": "girl, japanese, delicate_face, adolescent, petite, long hair, 1.2::brown hair::, low braided twintails, brown eyes, flat chest, fair skin, black round-frame glasses",
            "outfit": "blue serafuku, white sailor collar, blue neckerchief, wet clothes, blue knee-length skirt",
            "action": "kneeling on ground, 1.3::both hands gripping viewer's trousers::, looking up at viewer, head tilted back, crying, heavy tears, full face blush, trembling lips, despair",
            "center": "C3",
            "uc": "close-up, feet, shoes, full body, wide shot, smiling, looking down"
          }
        ]
      }
    ]
  },

  "S2_POV_LYING_VS_STRADDLE": {
    "shouldDraw": true,
    "reason": "①仰卧在床被金发辣妹跨坐居高临下俯视 ②L0亚美复用 ③Safe级(虽亲密跨坐但衣物完整无裸露器官,Scene UC排nude与器官) ④分层:前景观察者双手自画框下边缘向上托扶对方腰胯(受力闭环),中景跨坐俯身的亚美(占比70%),远景凌乱床榻与卧室 ⑤仰卧看跨坐大高差(仰角视点~0.3m看~1.1m)→from below, looking up from below, low-angle shot, head lowered, foreshortening, 严禁close-up与from above ⑥下身下放UC ⑦左右手分写加权 ⑧自检输出",
    "segments": [
      {
        "label": "居高临下跨坐",
        "anchor": {"text": "亚美缓缓地跨坐在我的腰胯之上。她压低了腰肢，金色的双马尾垂在我的胸膛两侧，居高临下地俯视着我"},
        "scene": "Scene: SFW, intimate tension, {1girl}, pov, straddling. Foreground: the viewer's hands extending upward from lower frame bottom edge, fingers gently resting on her waist, strongly out of focus. Middle ground: a blonde gyaru straddling the viewer, lowering her torso, looking down with condescending disgusted gaze. Character occupying around 70% of the image height. Background: a dim messy bedroom, rumpled duvet, soft bedside lamp glow casting warm shadows. Foreground viewer's hands resting on waist, Middle ground straddling girl, Background bedroom. pov, from below, looking up from below, low-angle shot, head lowered, foreshortening, female focus, depth of field, warm ambient lighting, dramatic shadow;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Ami (original)",
            "base": "girl, japanese, delicate_face, teenager, gyaru, long blonde hair, twintails, blue eyes, small breasts, petite, fair skin",
            "outfit": "white short-sleeved sailor shirt, open collar, navy pleated mini skirt, black thigh-high socks",
            "action": "straddling viewer, lowering torso, 1.3::hands resting on viewer's chest::, looking down at viewer, head lowered, disgusted expression, heavy blush, condescending gaze, parted lips",
            "center": "C3",
            "uc": "close-up, from above, eye level, feet, shoes, boy face, male body, extra limbs, bad hands, full body, wide shot"
          }
        ]
      }
    ]
  },

  "S3_POV_EQUAL_HEIGHT_SEATED": {
    "shouldDraw": true,
    "reason": "①同坐沙发转头近距离微距平视 ②同人L0卡提希娅复用 ③Safe级(UC排nude) ④分层:中景并排端坐的卡提希娅(占比65%),背景客厅茶几与书架,同坐平视允许特写 ⑤主观POV→eye level, close-up, face-to-face ⑥颈部以下下放UC ⑦手持茶杯细化 ⑧自检输出",
    "segments": [
      {
        "label": "沙发近语",
        "anchor": {"text": "我和卡提希娅并肩坐在米白色的布艺沙发上。她转过脸来，距离我的面庞只有不到半尺"},
        "scene": "Scene: SFW, relaxing dialogue, {1girl}, pov, face-to-face. Middle ground: a blonde girl seated beside the viewer on a sofa, turning her face close to the camera with soft smiling eyes, gently sipping black tea. Character occupying around 65% of the image height. Background: cozy living room interior, coffee table with porcelain teaware, bookshelf softly blurred. Middle ground girl, Background living room. pov, eye level, close-up, face-to-face, warm afternoon light, soft focus, indoor;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Cartethyia (Wuthering Waves)",
            "base": "girl, long hair, 1.2::blonde hair::, blue eyes, small breasts, silver circlet, purple flower hair ornament, fair skin",
            "outfit": "white blouse, blue knit cardigan",
            "action": "sitting on sofa, 1.3::right hand, holding teacup, sipping black tea::, turning face close to viewer, looking at viewer, gentle smile, slight blush, parted lips",
            "center": "C3",
            "uc": "feet, shoes, legs, lower body, full body, wide shot"
          }
        ]
      }
    ]
  },

  "S4_POV_LEANING_OVER_WALL_PIN": {
    "shouldDraw": true,
    "reason": "①主角前倾身体单手撑墙壁咚黑发少女 ②原创角色复用 ③Safe级 ④分层:前景观察者左手撑在墙上(画框下边缘探入受力闭环),中景后仰贴墙惊慌少女(占比70%),背景冰冷砖墙 ⑤主观POV→leaning over, looking down, cowboy shot ⑥下身下放UC ⑦惊慌神情细化 ⑧自检输出",
    "segments": [
      {
        "label": "墙边壁咚",
        "anchor": {"text": "我一把将黑发少女推在冰冷的砖墙上，身体前倾将她牢牢笼罩在自己的阴影之下。我左手撑在她耳侧的粗糙砖面上"},
        "scene": "Scene: SFW, intense kabedon, {1girl}, pov. Foreground: the viewer's left hand and forearm entering from lower frame bottom edge, palm pressed firmly against the rough brick wall, casting a heavy shadow, strongly out of focus. Middle ground: a black-haired girl pressed back against the wall, eyes wide with alarm, looking up at the viewer. Character occupying around 70% of the image height. Background: cold dark brick alley wall receding into background shadow. Foreground left hand pressed on brick wall, Middle ground trapped girl, Background alley wall. pov, leaning over, looking down, front view, cowboy shot, high contrast shadow, moody dramatic light;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Kuroka (original)",
            "base": "girl, japanese, delicate_face, teenager, long hair, 1.2::black hair::, straight bangs, red eyes, medium breasts, fair skin",
            "outfit": "black school blazer, white collared shirt, red ribbon, grey pleated mini skirt",
            "action": "backed against wall, 1.3::both hands clutching chest in defense::, looking at viewer, panicked expression, wide eyes, dilated pupils, trembling lips, flustered blush",
            "center": "C3",
            "uc": "feet, shoes, smiling, relaxed, full body, wide shot"
          }
        ]
      }
    ]
  },

  "S5_POV_FALLEN_ON_GROUND": {
    "shouldDraw": true,
    "reason": "①主角倒地贴地极低仰视逼近的银发女刺客 ②原创角色 ③Safe级 ④分层:前景湿冷石板路面与泥水微距,中景居高临下逼近的银发刺客(占比80%),远景月夜小巷 ⑤倒地极低仰拍→ground level, looking up from ground, low angle, full body ⑥手持短刃细化 ⑦自检输出",
    "segments": [
      {
        "label": "倒地仰视",
        "anchor": {"text": "我贴在湿冷的地面上，仰望着她那双毫无感情的冰冷红瞳。"},
        "scene": "Scene: SFW, life-or-death confrontation, {1girl}, pov. Middle ground: a tall silver-haired female assassin looming over the fallen viewer, advancing with cold murderous red eyes, short dagger gleaming in hand. Character occupying around 80% of the image height. Background: wet cobblestone alley stretching into darkness under cold moonlight. Middle ground looming assassin, Background dark alleyway. pov, ground level, looking up from ground, from below, steep low angle, full body, dramatic rim light, cold moonlit atmosphere, heavy shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Sylvia (original)",
            "base": "girl, caucasian, delicate_face, adult, tall, slender, long silver hair, red eyes, sharp eyes, medium breasts, pale skin",
            "outfit": "black leather trench coat, dark grey bodysuit, black knee-high combat boots",
            "action": "walking forward, looming over viewer, 1.4::right hand, holding dagger, reverse grip, blade pointing down::, left arm at side, looking down at viewer, emotionless gaze, cold stare",
            "center": "C3",
            "uc": "smiling, crying, lying down, looking away"
          }
        ]
      }
    ]
  },

  "S6_POV_OPEN_SPACE_NO_CONTACT": {
    "shouldDraw": true,
    "reason": "①放学后操场跑道边卡提希娅微笑招手邀约 ②同人L0卡提希娅复用 ③Safe级(UC排nude) ④分层:开阔空间相距三米无任何近身物体或物理接触,天然通透空气,严格省略Foreground降为双层构图(Middle ground + Background),绝不强编悬空断手 ⑤主观POV→eye level, cowboy shot, front view ⑥小腿出框下放UC ⑦招手动作与背后手分写加权 ⑧自检输出",
    "segments": [
      {
        "label": "操场邀约",
        "anchor": {"text": "卡提希娅站在三米外的跑道旁，双手自然背在身后，笑着朝我招了招手：'今天放学一起去图书馆借书吗？'"},
        "scene": "Scene: SFW, campus life, {1girl}, pov, face-to-face. Middle ground: a long blonde-haired girl standing three meters away on the red running track, smiling warmly and waving one hand while the other hand rests behind her back. Character occupying around 60% of the image height. Background: a wide green athletic field under a sunny afternoon sky, running track stretching into distance, school building in the far background softly blurred. Middle ground waving girl, Background campus athletic field. pov, cowboy shot, eye level, front view, solo focus, bright daylight, natural sunlight, soft shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera, hands reaching in, pov hands, arm reaching",
        "characters": [
          {
            "name": "Cartethyia (Wuthering Waves)",
            "base": "girl, long hair, 1.2::blonde hair::, blue eyes, small breasts, silver circlet, purple flower hair ornament, fair skin",
            "outfit": "white knee-length sailor dress, blue sailor collar, white ankle socks, brown loafer shoes",
            "action": "standing on track, 1.3::right hand, raised waving hand, open palm::, left hand resting behind back, looking at viewer, warm smile, cheerful expression, slightly tilted head",
            "center": "C3",
            "uc": "feet, shoes, full body, wide shot, large breasts, dark hair, short hair, close-up"
          }
        ]
      }
    ]
  },

  "S7_THIRD_PERSON_DUAL_CHARACTERS": {
    "shouldDraw": true,
    "reason": "①林间空地艾米丽与卡提希娅拔剑持杖对峙 ②客观第三人称双人同框(不标pov,创建2个Char) ③Safe级(UC排nude) ④分层:中景两名少女一左一右对峙(各占高60%),背景阳光透射林木 ⑤profile view, eye level, cowboy shot ⑥网格B3+D3,互视facing_another ⑦source#与target#动作对准 ⑧自检输出",
    "segments": [
      {
        "label": "林间对峙",
        "anchor": {"text": "金发的艾米丽拔出腰间的细剑直指对方，神情凝重；而身披白袍的卡提希娅则神色自若地横握着法杖，两人目光在空中激烈交锋。"},
        "scene": "Scene: SFW, confrontation, {2girls}, 2girls, facing each other. Middle ground: two girls standing facing another on a forest clearing, one drawing her rapier aimed at her opponent, the other holding her staff defensively. Characters occupying around 60% of the image height. Background: a sunlit forest clearing, dappled sunlight filtering through green leaves, trees in the background softly blurred. Middle ground confronting girls, Background forest clearing. profile view, side view, eye level, cowboy shot, two shot, dynamic lighting, dappled sunlight, soft shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Emily (original)",
            "base": "girl, japanese, delicate_face, teenager, long hair, blonde hair, green eyes, medium breasts, fair skin",
            "outfit": "white long-sleeved fencing doublet, black knee-length trousers, brown knee-high leather boots",
            "action": "standing, facing_another, eye_contact, 1.3::source#right hand, holding rapier, blade aimed forward at Cartethyia::, left hand on hip, serious expression, focused gaze",
            "center": "B3",
            "uc": "feet, shoes, full body, wide shot, looking at viewer, smiling"
          },
          {
            "name": "Cartethyia (Wuthering Waves)",
            "base": "girl, long hair, 1.2::blonde hair::, blue eyes, small breasts, silver circlet, purple flower hair ornament, fair skin",
            "outfit": "white ankle-length hooded robe, gold trim, black knee-high boots",
            "action": "standing, facing_another, eye_contact, 1.3::target#both hands, holding wooden staff horizontally in defense::, calm expression, composed gaze",
            "center": "D3",
            "uc": "feet, shoes, full body, wide shot, looking at viewer, panic"
          }
        ]
      }
    ]
  },

  "S8_ORIGINAL_CHARACTER_7DIM_MATRIX": {
    "shouldDraw": true,
    "reason": "①原创少女由纪子初登场 ②严格构建7维外貌防伪闭环 ③Safe级 ④中景完整展示由纪子(占比70%),背景室内玄关 ⑤eye level, front view, cowboy shot ⑥下身出框下放UC ⑦双手自然下垂 ⑧自检输出",
    "segments": [
      {
        "label": "少女初登场",
        "anchor": {"text": "一名身穿便服的原创少女由纪子(Yukiko)走了进来。她大约十六岁，留着齐刘海的黑色及腰长直发，清秀的面容上长着一双深蓝色的下垂眼"},
        "scene": "Scene: SFW, character introduction, {1girl}, solo. Middle ground: a petite teenage girl standing in the entryway, looking gently toward the camera with quiet droopy eyes. Character occupying around 70% of the image height. Background: a clean modern Japanese home entryway, wooden shoe cabinet, warm indoor lighting. Middle ground girl, Background entryway. cowboy shot, eye level, front view, solo focus, soft indoor lighting, natural shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Yukiko (original)",
            "base": "girl, japanese, delicate_face, teenager, adolescent, petite, slender, long hair, 1.2::black hair::, waist-length hair, straight bangs, blue eyes, droopy eyes, tareme, small breasts, fair skin, mole under eye",
            "outfit": "cream-colored knit sweater, navy knee-length pleated skirt, black knee-high socks",
            "action": "standing, 1.2::hands resting naturally at sides::, looking at viewer, gentle smile, calm expression",
            "center": "C3",
            "uc": "feet, shoes, full body, wide shot, short hair, blonde hair, large breasts"
          }
        ]
      }
    ]
  },

  "S9_FANART_OOC_PRUNING": {
    "shouldDraw": true,
    "reason": "①假日便服披发辉夜大小姐 ②同人角色OOC换装规范 ③Safe级 ④中景辉夜身着便服(占比65%),背景温馨起居室 ⑤eye level, cowboy shot ⑥UC强制排除修道院黑裙与原设发饰 ⑦双手插袋 ⑧自检输出",
    "segments": [
      {
        "label": "假日便服",
        "anchor": {"text": "辉夜大小姐换下了一贯的修道院黑裙，穿上了一身淡粉色的休闲连帽卫衣和蓝色牛仔短裤，原本盘起的长发也完全披散开来。"},
        "scene": "Scene: SFW, casual holiday, {1girl}, solo. Middle ground: a black-haired girl with long untied hair falling freely, wearing a casual pastel pink hoodie and denim shorts, standing in the cozy living room. Character occupying around 65% of the image height. Background: a warm living room with wooden bookshelves and soft carpet. Middle ground girl, Background living room. cowboy shot, eye level, front view, solo focus, soft warm lighting;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "2::Kaguya Shinomiya (Kaguya-sama: Love Is War)::",
            "base": "girl, long hair, 1.2::black hair::, red eyes, tsurime, small breasts, fair skin",
            "outfit": "pastel pink oversized hoodie, blue denim mini shorts, white ankle socks",
            "action": "standing, 1.2::hands inside hoodie pocket::, looking at viewer, slight embarrassed blush, averted eyes, cute pout",
            "center": "C3",
            "uc": "black dress, school uniform, hair ribbon, formal dress, feet, shoes, full body, wide shot"
          }
        ]
      }
    ]
  },

  "S10_OUTFIT_SIGNATURE_LENGTH_AND_COLOR": {
    "shouldDraw": true,
    "reason": "①精致英伦风西装制服少女 ②四要素服装签名严格校验长度与颜色 ③Safe级 ④中景完整制服展示(占比70%),背景英伦风走廊 ⑤eye level, cowboy shot ⑥UC下放脚部 ⑦单手整理衣领 ⑧自检输出",
    "segments": [
      {
        "label": "西装制服",
        "anchor": {"text": "少女身穿一件藏青色的短款修身西装外套，内搭纯白色的立领衬衫，下身是一条深灰色的百褶迷你裙、黑色过膝长筒袜，以及一双黑色的系带短靴。"},
        "scene": "Scene: SFW, elegant uniform, {1girl}, solo. Middle ground: a neatly dressed girl standing gracefully in a classic hallway, wearing a tailored navy blazer and pleated skirt. Character occupying around 70% of the image height. Background: classic academy corridor with tall arched windows and polished wooden floor. Middle ground girl, Background academy corridor. cowboy shot, eye level, front view, solo focus, clear morning light, elegant shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Evelyn (original)",
            "base": "girl, japanese, delicate_face, teenager, long hair, brown hair, hazel eyes, medium breasts, fair skin",
            "outfit": "navy cropped blazer, white collared shirt, dark grey pleated mini skirt, black knee-high socks, black ankle boots",
            "action": "standing, 1.3::right hand, adjusting blazer lapel::, left hand resting on skirt, looking at viewer, calm confident smile",
            "center": "C3",
            "uc": "feet, shoes, full body, wide shot, messy clothes, casual clothes"
          }
        ]
      }
    ]
  },

  "S11_HAND_INDEPENDENCE_AND_WEIGHTS": {
    "shouldDraw": true,
    "reason": "①红茶品鉴微观动作碎化 ②左右手独立动作与权重控制 ③Safe级 ④中景优雅端坐调茶(占比65%),背景维多利亚式茶室 ⑤eye level, bust shot ⑥下身下放UC ⑦左手托杯与右手搅拌独立分写 ⑧自检输出",
    "segments": [
      {
        "label": "红茶搅拌",
        "anchor": {"text": "由纪子左手端着一只精美的白瓷茶杯，指尖轻轻托着杯底，右手则握着一把小巧的银色茶匙，优雅地在杯中轻轻搅拌。"},
        "scene": "Scene: SFW, tea time elegance, {1girl}, solo. Middle ground: a girl seated at an ornate table, gently stirring a porcelain teacup with delicate hand coordination. Character occupying around 65% of the image height. Background: vintage tea room, lace curtains, warm chandelier glow. Middle ground girl at table, Background tea room. bust shot, eye level, front three-quarter view, solo focus, warm indoor illumination, soft shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Yukiko (original)",
            "base": "girl, japanese, delicate_face, teenager, long black hair, blue eyes, petite, fair skin",
            "outfit": "lavender long-sleeved silk blouse, white lace cuffs",
            "action": "sitting at table, 1.2::left hand, holding porcelain teacup, fingertips supporting bottom of saucer::, 1.4::right hand, stirring tea with silver teaspoon in cup::, looking down at teacup, elegant focused smile, gentle expression",
            "center": "C3",
            "uc": "feet, shoes, legs, lower body, full body, wide shot, bad hands"
          }
        ]
      }
    ]
  },

  "S12_VISIBILITY_AND_UC_OFFLOADING": {
    "shouldDraw": true,
    "reason": "①近距泪眼面部特写与混穿隔离 ②UC隔离原则:特写下放下身,全场Scene UC绝不排clothes防止误伤着衣主角 ③Safe级 ④特写面部(占比70%),背景模糊浴池与侍女 ⑤close-up, eye level ⑥特写下放下身至Char UC ⑦咬唇泪眼细化 ⑧自检输出",
    "segments": [
      {
        "label": "隐忍含泪",
        "anchor": {"text": "分镜给了一个极近的面部特写，由纪子眼眶泛红，咬着下唇凝视着镜头。在同一个大场景中，背景里有一位全裸入浴的侍女，而由纪子身上则穿着整齐的深蓝学院制服。"},
        "scene": "Scene: SFW, emotional close-up, {1girl}, solo focus. Middle ground: a crying girl's face in tight focus, eyes shimmering with tears, biting her lower lip. Character occupying around 70% of the image height. Background: a steaming onsen bath area with distant blurred nude attendant in background steam. Middle ground tearful girl face, Background distant onsen bath. close-up, eye level, solo focus, depth of field, face focus, soft steam light, natural skin glow;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Yukiko (original)",
            "base": "girl, japanese, delicate_face, teenager, long black hair, blue eyes, fair skin",
            "outfit": "navy serafuku, white sailor collar",
            "action": "looking at viewer, biting lower lip, 1.3::tears welling up in eyes, tear tracks on cheeks::, flushed face, trembling expression, sorrowful gaze",
            "center": "C3",
            "uc": "feet, shoes, legs, lower body, smiling, cheerful, full body, wide shot"
          }
        ]
      }
    ]
  },

  "S13_STATE_PERSISTENCE_AND_FADING": {
    "shouldDraw": true,
    "reason": "①剑道激斗后大汗淋漓瘫坐道场 ②状态延续法则:汗水、红晕、散发、湿透道服禁止自动复原 ③Safe级 ④中景瘫坐道场的少女(占比65%),背景道场木壁与护具 ⑤from above, cowboy shot ⑥下肢出框下放UC ⑦双手按膝喘息 ⑧自检输出",
    "segments": [
      {
        "label": "力竭瘫坐",
        "anchor": {"text": "经历了一整场剧烈的大汗淋漓的剑道对决后，艾米丽气喘吁吁地瘫坐在道场木地板上。她的额头和后颈布满了细密的汗珠，原本梳理整齐的金发散乱地贴在潮红的面颊上，单薄的白色道服也已被汗水浸透半贴在肌肤上。"},
        "scene": "Scene: SFW, intense exhaustion, {1girl}, solo. Middle ground: a sweat-soaked blonde girl sitting exhausted on the polished dojo floor, catching her breath with disheveled hair clinging to her flushed cheeks. Character occupying around 65% of the image height. Background: traditional kendo dojo, wooden walls, bamboo shinai and armor racks softly blurred. Middle ground exhausted sweating girl, Background dojo interior. cowboy shot, from above, eye level, front three-quarter view, natural daylight, sweat glistening on skin, soft shadows;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Emily (original)",
            "base": "girl, japanese, delicate_face, teenager, long hair, blonde hair, blue eyes, athletic body, fair skin",
            "outfit": "white kendo gi, wet clothes, sweat glistening, disheveled collar, black hakama pants",
            "action": "sitting on wooden floor, 1.3::both hands resting on knees supporting weight::, catching breath, heavy panting, sweat dripping from chin, full face blush, disheveled hair sticking to face, parted lips, exhausted gaze",
            "center": "C3",
            "uc": "feet, shoes, full body, wide shot, pristine clothes, smiling, energetic"
          }
        ]
      }
    ]
  },

  "S14A_RATING_SAFE": {
    "shouldDraw": true,
    "reason": "①夏日沙滩明黄比基尼少女欢笑 ②泳装属于正常衣着判定为Safe级 ③Scene开头标SFW,Scene UC必排nude, completely nude ④中景沙滩迎风欢笑(占比75%),远景碧海晴空 ⑤eye level, full body, front view ⑥双手张开拥抱海风 ⑦自检输出",
    "segments": [
      {
        "label": "夏日海滩",
        "anchor": {"text": "炎炎夏日，少女身穿一套明黄色的分体式比基尼泳装，赤着脚站在沙滩上迎着海风开怀大笑。"},
        "scene": "Scene: SFW, summer beach holiday, {1girl}, solo. Middle ground: a cheerful girl standing barefoot on white sand, laughing with arms spread wide under the ocean breeze, wearing a bright yellow bikini. Character occupying around 75% of the image height. Background: sparkling azure sea, rolling white waves, clear blue summer sky with light clouds. Middle ground laughing girl in bikini, Background ocean and beach. full body, eye level, front view, solo focus, bright intense sunlight, lens flare, tropical beach;",
        "negative": "nude, completely nude, nipples, pussy, penis, topless, bottomless, boy, male, camera",
        "characters": [
          {
            "name": "Aoi (original)",
            "base": "girl, japanese, delicate_face, teenager, long brown hair, amber eyes, medium breasts, fair skin",
            "outfit": "bright yellow two-piece bikini, halterneck bikini top, yellow side-tie bikini bottoms, barefoot",
            "action": "standing on sand, barefoot, 1.3::both arms spread wide, embracing sea breeze::, looking at viewer, open mouth laughter, radiant smile, happy expression",
            "center": "C3",
            "uc": "shoes, socks, long dress, winter clothes, crying, sad"
          }
        ]
      }
    ]
  },

  "S14B_RATING_R": {
    "shouldDraw": true,
    "reason": "①温泉水雾中浴巾滑落露背与侧乳轮廓 ②有裸露无性器官无性行为判定为R级 ③Scene开头仍标SFW,Scene UC强制排器官与插入词(nipples, pussy, penis, genitals, penetration) ④中景侧身慌乱遮挡(占比70%),背景水汽氤氲岩石汤池 ⑤from side, bust shot ⑥下身出框下放UC ⑦双手慌忙拉扯浴巾 ⑧自检输出",
    "segments": [
      {
        "label": "浴巾滑落",
        "anchor": {"text": "温泉水雾缭绕，由纪子身上的浴巾意外滑落，露出大片白皙细腻的背部与侧乳轮廓，胸前与腿根沾满了水珠与晶莹的湿痕，她惊慌失措地侧身遮挡。"},
        "scene": "Scene: SFW, onsen bath mishap, {1girl}, solo. Middle ground: a flustered girl hastily pulling up a slipping white bath towel, her smooth back and side breast contour visible through swirling hot spring steam. Character occupying around 70% of the image height. Background: steaming natural rock onsen pool, bamboo screen, dense misty steam. Middle ground steaming girl with slipping towel, Background onsen hot spring. bust shot, from side, profile view, eye level, wet skin, water droplets, soft misty lighting;",
        "negative": "nipples, pussy, penis, genitals, uncensored, explicit, penetration, boy, male, camera",
        "characters": [
          {
            "name": "Yukiko (original)",
            "base": "girl, japanese, delicate_face, teenager, long black hair, blue eyes, small breasts, fair skin",
            "outfit": "slipping white bath towel clutched to chest, topless, wet skin, water droplets glistening",
            "action": "standing in steam, turning body away, 1.3::both hands frantically clutching slipping bath towel to chest::, looking back over shoulder at viewer, panic blush, wide eyes, flustered parted lips",
            "center": "C3",
            "uc": "feet, shoes, legs, lower body, full body, wide shot, calm, smiling"
          }
        ]
      }
    ]
  },

  "S14C_RATING_X": {
    "shouldDraw": true,
    "reason": "①卧室紧密结合水声高光 ②存在明确性行为与身体结合判定为X级 ③Scene开头标NSFW,Scene UC强制排censored, mosaic ④前景结合部位微距,中景交合娇喘少女(占比75%),远景昏暗卧室 ⑤looking up from below, low angle ⑥景别下放Char UC ⑦腰肢摆动与失神娇喘 ⑧自检输出",
    "segments": [
      {
        "label": "深沉交合",
        "anchor": {"text": "在昏暗的卧室里，两人身体紧密结合在一起，肉体碰撞伴随着清脆的水声，少女仰起通红的面庞发出失神的娇喘。"},
        "scene": "Scene: NSFW, passionate intimacy, {1girl}, pov, intimate intercourse. Foreground: close intimate bodily contact, glistening fluids at junction, strongly out of focus. Middle ground: a flushed girl in deep intimate embrace, head tilted back in ecstasy, soft moans escaping parted lips. Character occupying around 75% of the image height. Background: dim cozy bedroom, rumpled blankets, warm ambient bedside light. Foreground intimate junction, Middle ground euphoric girl, Background bedroom. pov, looking up from below, low-angle shot, foreshortening, female focus, depth of field, warm intimate lighting;",
        "negative": "censored, mosaic, clothes, dressed, boy, male, camera",
        "characters": [
          {
            "name": "Ami (original)",
            "base": "girl, japanese, delicate_face, teenager, long blonde hair, blue eyes, petite, fair skin",
            "outfit": "nude, completely nude, bare skin, heavy perspiration, glistening skin",
            "action": "intimate embrace, 1.4::arching back, trembling hips, receiving penetration::, head tilted back, euphoric expression, intense full face blush, half-closed eyes, parted lips, heavy panting",
            "center": "C3",
            "uc": "clothes, bra, panties, shoes, socks, feet, bad hands, male face"
          }
        ]
      }
    ]
  },

  "S15_IDLE_CHAT_INTERCEPT": {
    "shouldDraw": false
  }
};

if (typeof module !== 'undefined') {
  module.exports = { GOLDEN_BENCHMARK };
}
