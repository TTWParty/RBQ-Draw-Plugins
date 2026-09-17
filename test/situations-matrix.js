/**
 * 文生图 9.7 全场景测试矩阵 (Situations Test Matrix)
 * 涵盖全部 15 种实战叙事与边界情况：
 * S1: POV 高差 站看跪/躺 (高差大俯视)
 * S2: POV 高差 仰卧看跨坐骑乘 (低位大仰视)
 * S3: POV 同高平视 (同坐/同跪/同躺)
 * S4: POV 贴身倾覆压制 (壁咚/床咚)
 * S5: POV 倒地极低仰视 (贴地虫视)
 * S6: POV 开阔无接触日常对话 (空即是景，双层无前景)
 * S7: 第三人称客观双人互动 (B3+D3 互视)
 * S8: 原创 OC 7 维外貌防伪闭环
 * S9: 同人角色规范与脱离原设 OOC
 * S10: 服装签名与长度/颜色法则
 * S11: 肢体动作碎化与左右手独立
 * S12: 景别裁切可见性与 UC 隔离下放
 * S13: 连贯性持久状态延续
 * S14: 分级判定独立三问 (Safe / R / X)
 * S15: 纯日常闲聊 / 独白 / 无画面变化拦截
 */

const SITUATIONS_MATRIX = [
  {
    id: "S1_POV_STANDING_VS_KNEELING",
    name: "POV 高差 站姿看下跪 (站高看低/仰头透视链)",
    story: "我居高临下地站在校舍的阴影里，冷冷地看着跪倒在雨水浸湿的水泥地上的米拉。她仰起满是泪痕的苍白小脸，湿漉漉的棕色双马尾贴在肩头，双手紧紧抓着我的黑色长裤裤管苦苦哀求：'求求你，不要丢下我一个人……'",
    assertions: {
      shouldDraw: true,
      isPov: true,
      sceneContains: ["pov", "from above"],
      sceneForbidden: ["close-up", "eye level", "from below"],
      perspectiveChain: ["head tilted back", "foreshortening", "looking up at viewer"],
      noObserverInChars: true,
      sceneNegativeContains: ["boy", "male"],
      charCenter: "C3",
      charActionContains: ["kneeling"]
    }
  },
  {
    id: "S2_POV_LYING_VS_STRADDLE",
    name: "POV 高差 仰卧被跨坐骑乘 (低位大仰拍/自下托扶)",
    story: "我精疲力竭地仰面躺在凌乱的床单上，亚美缓缓地跨坐在我的腰胯之上。她压低了腰肢，金色的双马尾垂在我的胸膛两侧，居高临下地俯视着我，脸上泛着嫌恶与羞耻的红晕。我抬起双手扶住她温热柔软的腰线。",
    assertions: {
      shouldDraw: true,
      isPov: true,
      sceneContains: ["pov", "from below", "looking up from below"],
      sceneForbidden: ["close-up", "eye level", "from above"],
      perspectiveChain: ["head lowered", "foreshortening"],
      noObserverInChars: true,
      sceneNegativeContains: ["boy", "male"],
      foregroundContains: ["lower frame", "hands"],
      charCenter: "C3",
      charActionContains: ["straddling"]
    }
  },
  {
    id: "S3_POV_EQUAL_HEIGHT_SEATED",
    name: "POV 同高平视 (同坐沙发/平视面部特写合法)",
    story: "我和卡提希娅并肩坐在米白色的布艺沙发上。她转过脸来，距离我的面庞只有不到半尺，清澈的蓝色眼眸里倒映着我的影子，嘴角微微上扬，小口抿着手中的红茶。",
    assertions: {
      shouldDraw: true,
      isPov: true,
      sceneContains: ["pov", "eye level"],
      closeUpAllowed: true,
      noObserverInChars: true
    }
  },
  {
    id: "S4_POV_LEANING_OVER_WALL_PIN",
    name: "POV 贴身倾覆压制 (壁咚压迫)",
    story: "我一把将黑发少女推在冰冷的砖墙上，身体前倾将她牢牢笼罩在自己的阴影之下。我左手撑在她耳侧的粗糙砖面上，居高临下地直视着她因惊慌而剧烈收缩的瞳孔。",
    assertions: {
      shouldDraw: true,
      isPov: true,
      sceneContains: ["pov"],
      loomingPerspective: ["leaning over", "looking down"],
      noObserverInChars: true,
      foregroundContains: ["hand", "wall"]
    }
  },
  {
    id: "S5_POV_FALLEN_ON_GROUND",
    name: "POV 倒地摔倒贴地极低仰视 (贴地虫视)",
    story: "我重重地摔倒在泥泞的石板巷道中，浑身剧痛无法起身。高挑的银发女刺客居高临下地向我步步逼近，手中的短刃在月光下泛着寒光。我贴在湿冷的地面上，仰望着她那双毫无感情的冰冷红瞳。",
    assertions: {
      shouldDraw: true,
      isPov: true,
      sceneContains: ["pov"],
      groundView: ["ground level", "looking up from ground", "from below", "low angle"],
      noObserverInChars: true
    }
  },
  {
    id: "S6_POV_OPEN_SPACE_NO_CONTACT",
    name: "POV 开阔无接触日常对话 (空即是景/双层无前景/绝无悬空断手)",
    story: "宽阔的学校操场上，微风拂动着青绿的草坪。卡提希娅站在三米外的跑道旁，双手自然背在身后，笑着朝我招了招手：'今天放学一起去图书馆借书吗？'",
    assertions: {
      shouldDraw: true,
      isPov: true,
      openSpaceEmptyForeground: true,
      sceneForbidden: ["hands reaching in", "pov hands", "arm reaching", "hand reaching in", "reaching toward"],
      noObserverInChars: true
    }
  },
  {
    id: "S7_THIRD_PERSON_DUAL_CHARACTERS",
    name: "第三人称客观双人互动 (B3+D3 互视/动作源目标)",
    story: "阳光斑驳的林间空地上，艾米丽与卡提希娅相对而立。金发的艾米丽拔出腰间的细剑直指对方，神情凝重；而身披白袍的卡提希娅则神色自若地横握着法杖，两人目光在空中激烈交锋。",
    assertions: {
      shouldDraw: true,
      thirdPerson: true,
      charactersCount: 2,
      centers: ["B3", "D3"],
      eyeContactMutual: ["facing_another", "eye_contact"],
      interactionMarkers: ["source#", "target#", "mutual#"]
    }
  },
  {
    id: "S8_ORIGINAL_CHARACTER_7DIM_MATRIX",
    name: "原创 OC 角色 7 维外貌防伪闭环",
    story: "一名身穿便服的原创少女由纪子(Yukiko)走了进来。她大约十六岁，留着齐刘海的黑色及腰长直发，清秀的面容上长着一双深蓝色的下垂眼，身材苗条娇小，右眼角下方有一颗淡淡的泪痣。",
    assertions: {
      shouldDraw: true,
      charNameMatch: /Yukiko.*\(original\)/i,
      base7Dimensions: {
        gender: ["girl"],
        ethnicity: ["japanese", "delicate_face"],
        age: ["teenager", "adolescent", "young_girl"],
        hair: ["black hair", "long hair", "straight bangs"],
        eyes: ["blue eyes", "droopy eyes", "tareme"],
        body: ["petite", "slender"],
        skinTraits: ["mole under eye", "fair skin", "white skin"]
      },
      basePure: true
    }
  },
  {
    id: "S9_FANART_OOC_PRUNING",
    name: "同人角色规范与脱离原设 OOC 负面隔离",
    story: "战斗结束后的假日，辉夜大小姐换下了一贯的修道院黑裙，穿上了一身淡粉色的休闲连帽卫衣和蓝色牛仔短裤，原本盘起的长发也完全披散开来。",
    assertions: {
      shouldDraw: true,
      charNameMatch: /2::Kaguya Shinomiya.*\(Kaguya-sama: Love Is War\)::/i,
      outfitContains: ["hoodie", "shorts"],
      charUcExcludesCanon: ["black dress", "school uniform", "hair ribbon"]
    }
  },
  {
    id: "S10_OUTFIT_SIGNATURE_LENGTH_AND_COLOR",
    name: "服装签名与长度/颜色四要素法则",
    story: "少女身穿一件藏青色的短款修身西装外套，内搭纯白色的立领衬衫，下身是一条深灰色的百褶迷你裙、黑色过膝长筒袜，以及一双黑色的系带短靴。",
    assertions: {
      shouldDraw: true,
      outfitLengthRule: {
        skirt: ["mini", "knee-length", "maxi"],
        socks: ["knee-high", "thigh-high", "ankle"],
        boots: ["ankle", "knee-high"],
        jacket: ["cropped", "waist-length", "short"]
      },
      outfitColorsPresent: ["navy", "white", "grey", "black"]
    }
  },
  {
    id: "S11_HAND_INDEPENDENCE_AND_WEIGHTS",
    name: "肢体动作碎化与左右手独立加权",
    story: "由纪子左手端着一只精美的白瓷茶杯，指尖轻轻托着杯底，右手则握着一把小巧的银色茶匙，优雅地在杯中轻轻搅拌。",
    assertions: {
      shouldDraw: true,
      independentHands: {
        left: ["left hand", "holding"],
        right: ["right hand", "stirring", "spoon"]
      },
      actionWeighted: /1\.[2-4]::.+::/
    }
  },
  {
    id: "S12_VISIBILITY_AND_UC_OFFLOADING",
    name: "景别裁切可见性与 UC 隔离下放 (特写下放下身/混穿隔离)",
    story: "分镜给了一个极近的面部特写，由纪子眼眶泛红，咬着下唇凝视着镜头。在同一个大场景中，背景里有一位全裸入浴的侍女，而由纪子身上则穿着整齐的深蓝学院制服。",
    assertions: {
      shouldDraw: true,
      closeUpUcOffload: ["feet", "shoes", "legs", "lower body"],
      sceneNegativeNotContains: ["clothes", "dressed"]
    }
  },
  {
    id: "S13_STATE_PERSISTENCE_AND_FADING",
    name: "连贯性与持久状态延续 (汗水/红晕不自动蒸发)",
    story: "经历了一整场剧烈的大汗淋漓的剑道对决后，艾米丽气喘吁吁地瘫坐在道场木地板上。她的额头和后颈布满了细密的汗珠，原本梳理整齐的金发散乱地贴在潮红的面颊上，单薄的白色道服也已被汗水浸透半贴在肌肤上。",
    assertions: {
      shouldDraw: true,
      persistentStates: ["sweat", "blush", "wet clothes"]
    }
  },
  {
    id: "S14A_RATING_SAFE",
    name: "分级判定独立三问 · Safe 级 (泳装场景)",
    story: "炎炎夏日，少女身穿一套明黄色的分体式比基尼泳装，赤着脚站在沙滩上迎着海风开怀大笑。",
    assertions: {
      shouldDraw: true,
      sceneStartsWith: "Scene: SFW",
      sceneNegativeContains: ["nude", "completely nude"]
    }
  },
  {
    id: "S14B_RATING_R",
    name: "分级判定独立三问 · R 级 (显性体液/若隐若现)",
    story: "温泉水雾缭绕，由纪子身上的浴巾意外滑落，露出大片白皙细腻的背部与侧乳轮廓，胸前与腿根沾满了水珠与晶莹的湿痕，她惊慌失措地侧身遮挡。",
    assertions: {
      shouldDraw: true,
      sceneStartsWith: "Scene: SFW",
      sceneNegativeContains: ["nipples", "pussy", "penis", "genitals", "uncensored", "explicit", "penetration"]
    }
  },
  {
    id: "S14C_RATING_X",
    name: "分级判定独立三问 · X 级 (性行为/器官结合)",
    story: "在昏暗的卧室里，两人身体紧密结合在一起，肉体碰撞伴随着清脆的水声，少女仰起通红的面庞发出失神的娇喘。",
    assertions: {
      shouldDraw: true,
      sceneStartsWith: "Scene: NSFW",
      sceneNegativeContains: ["censored", "mosaic"]
    }
  },
  {
    id: "S15_IDLE_CHAT_INTERCEPT",
    name: "纯日常闲聊 / 独白 / 无画面变化拦截 (shouldDraw: false)",
    story: "‘好的，我知道了，那我们明天早上八点在校门口汇合吧，晚安。’由纪子发来了一条简短的确认消息。",
    assertions: {
      shouldDraw: false
    }
  }
];

if (typeof module !== 'undefined') {
  module.exports = { SITUATIONS_MATRIX };
}
