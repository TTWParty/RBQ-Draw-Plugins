/**
 * 自动化断言验证引擎 (Situation Validator)
 * 执行 50+ 项工业级规则断言
 */

class SituationValidator {
  static validate(scenario, result) {
    const report = {
      id: scenario.id,
      name: scenario.name,
      passed: true,
      errors: [],
      warnings: [],
      checks: 0
    };

    const assert = (condition, errorMsg) => {
      report.checks++;
      if (!condition) {
        report.passed = false;
        report.errors.push(errorMsg);
      }
    };

    const warn = (condition, warnMsg) => {
      report.checks++;
      if (!condition) {
        report.warnings.push(warnMsg);
      }
    };

    // 1. JSON 基础结构契约
    assert(result && typeof result === 'object', "输出必须是有效的 JSON 对象");
    if (!result || typeof result !== 'object') return report;

    assert(typeof result.shouldDraw === 'boolean', "缺少或非布尔型 shouldDraw 字段");
    assert(result.shouldDraw === scenario.assertions.shouldDraw, 
      `shouldDraw 期望为 ${scenario.assertions.shouldDraw}，实际为 ${result.shouldDraw}`);

    if (scenario.assertions.shouldDraw === false) {
      // 纯闲聊场景，到此验证完毕
      return report;
    }

    assert(typeof result.reason === 'string' && result.reason.length >= 10, "缺少或过短的 reason 推演思考链");
    assert(Array.isArray(result.segments) && result.segments.length > 0, "segments 必须为非空数组");
    if (!Array.isArray(result.segments) || result.segments.length === 0) return report;

    const seg = result.segments[0];
    assert(typeof seg.label === 'string' && seg.label.length > 0, "segment 缺少 label");
    assert(seg.anchor && typeof seg.anchor.text === 'string' && seg.anchor.text.length > 0, "segment 缺少 anchor.text");

    // 验证 anchor.text 是否一字不差截取自正文
    if (seg.anchor && seg.anchor.text) {
      const cleanAnchor = seg.anchor.text.trim();
      assert(scenario.story.includes(cleanAnchor), 
        `anchor.text ("${cleanAnchor}") 未能一字不差匹配原正文`);
    }

    assert(typeof seg.scene === 'string', "segment 缺少 scene 字段");
    assert(typeof seg.negative === 'string', "segment 缺少 negative 字段");
    assert(Array.isArray(seg.characters) && seg.characters.length > 0, "characters 必须为非空数组");

    const scene = seg.scene || "";
    const negative = seg.negative || "";
    const characters = seg.characters || [];

    // 2. 空间与人数锁定
    assert(/\{[1-9][a-zA-Z0-9_ ]*\}/.test(scene), "Scene 必须包含花括号人数加权锁定 (如 {1girl})");

    // 3. POV 视角与实体解耦
    if (scenario.assertions.isPov) {
      assert(/\bpov\b/i.test(scene), "主观 POV 场景 Scene 中必须显式标注 'pov'");
      if (scenario.assertions.noObserverInChars) {
        characters.forEach((char, idx) => {
          assert(!/user|viewer|observer/i.test(char.name), 
            `POV 观察者严禁建为独立角色！Char ${idx + 1} 发现违规命名 "${char.name}"`);
        });
      }
      if (scenario.assertions.sceneNegativeContains) {
        scenario.assertions.sceneNegativeContains.forEach(tag => {
          assert(negative.toLowerCase().includes(tag.toLowerCase()), 
            `POV 场景负面词底线必须包含防多骨骼分裂词: "${tag}"`);
        });
      }
    }

    // 4. 垂直高差与机位互斥
    if (scenario.assertions.sceneContains) {
      scenario.assertions.sceneContains.forEach(tag => {
        assert(scene.toLowerCase().includes(tag.toLowerCase()), 
          `Scene 缺少必要机位/视角标签: "${tag}"`);
      });
    }

    if (scenario.assertions.sceneForbidden) {
      scenario.assertions.sceneForbidden.forEach(tag => {
        const regex = new RegExp(`(^|[,;\\s])${tag}([,;\\s]|$)`, 'i');
        assert(!regex.test(scene), 
          `⛔ 高落差场景严禁出现互斥标签: "${tag}"（会导致机位严重塌陷失真）`);
      });
    }

    if (scenario.assertions.perspectiveChain) {
      scenario.assertions.perspectiveChain.forEach(tag => {
        const found = scene.toLowerCase().includes(tag.toLowerCase()) || 
                      characters.some(c => (c.action || "").toLowerCase().includes(tag.toLowerCase()));
        assert(found, `高落差透视链必须体现透视短缩特征: "${tag}"`);
      });
    }

    if (scenario.assertions.loomingPerspective) {
      const found = scenario.assertions.loomingPerspective.some(tag => 
        scene.toLowerCase().includes(tag.toLowerCase()) || 
        characters.some(c => (c.action || "").toLowerCase().includes(tag.toLowerCase()))
      );
      assert(found, "壁咚/倾覆场景缺少居高临下倾身透视标签 (leaning over / looking down)");
    }

    if (scenario.assertions.groundView) {
      const found = scenario.assertions.groundView.some(tag => scene.toLowerCase().includes(tag.toLowerCase()));
      assert(found, "倒地视角必须体现极低贴地视点 (ground level / looking up from ground / from below)");
    }

    // 5. 开阔空间自然双层 (空即是景)
    if (scenario.assertions.openSpaceEmptyForeground) {
      const hasForegroundBlock = /Foreground\s*:/i.test(scene);
      assert(!hasForegroundBlock, 
        "开阔对话场景前方为通透空气，必须完全省略 Foreground 降为双层！发现违规 Foreground 块");
      if (scenario.assertions.sceneForbidden) {
        scenario.assertions.sceneForbidden.forEach(tag => {
          assert(!scene.toLowerCase().includes(tag.toLowerCase()), 
            `开阔无接触场景严禁凭空捏造虚空断手/浮空抓取: "${tag}"`);
        });
      }
    }

    // 6. 前景探入必须物理受力闭环
    if (scenario.assertions.foregroundContains) {
      scenario.assertions.foregroundContains.forEach(item => {
        const found = scene.toLowerCase().includes(item.toLowerCase());
        assert(found, `有物理接触的前景探入必须明确交代入镜起点与接触受力: "${item}"`);
      });
    }

    // 7. 第三人称双人互动
    if (scenario.assertions.thirdPerson) {
      assert(!/\bpov\b/i.test(scene), "第三人称客观呈现默认省略 pov 标签");
      assert(characters.length === scenario.assertions.charactersCount, 
        `第三人称双人场景 characters 必须包含 ${scenario.assertions.charactersCount} 个独立角色，实际为 ${characters.length}`);
      if (characters.length >= 2 && scenario.assertions.centers) {
        const c0 = characters[0].center;
        const c1 = characters[1].center;
        const isB3 = (c0 === 'B3' || (typeof c0 === 'object' && Math.abs((c0?.x ?? 0) - 0.3) < 0.08 && Math.abs((c0?.y ?? 0) - 0.5) < 0.08));
        const isD3 = (c1 === 'D3' || (typeof c1 === 'object' && Math.abs((c1?.x ?? 0) - 0.7) < 0.08 && Math.abs((c1?.y ?? 0) - 0.5) < 0.08));
        assert(isB3 && isD3,
          `双人并排中心网格应为 ${scenario.assertions.centers.join('+')}，实际为 ${JSON.stringify(c0)}+${JSON.stringify(c1)}`);
      }
      if (scenario.assertions.eyeContactMutual) {
        const found = characters.some(c => 
          scenario.assertions.eyeContactMutual.some(tag => (c.action || "").toLowerCase().includes(tag.toLowerCase()))
        ) || scenario.assertions.eyeContactMutual.some(tag => scene.toLowerCase().includes(tag.toLowerCase()));
        assert(found, "双人同框互动必须包含互视标签 (facing_another / eye_contact)");
      }
      if (scenario.assertions.interactionMarkers) {
        const found = characters.some(c => 
          scenario.assertions.interactionMarkers.some(marker => (c.action || "").includes(marker))
        );
        assert(found, "双人交互应包含 source# / target# / mutual# 互动动作归属标注");
      }
    }

    // 8. 原创角色 7 维外貌防伪闭环
    if (scenario.assertions.charNameMatch) {
      assert(scenario.assertions.charNameMatch.test(characters[0].name), 
        `角色命名不符合规范: "${characters[0].name}"`);
    }

    if (scenario.assertions.base7Dimensions) {
      const base = (characters[0].base || "").toLowerCase();
      const dims = scenario.assertions.base7Dimensions;

      // 1. 性别
      assert(dims.gender.some(g => base.includes(g)), "7维外貌缺失: ①性别 (girl/boy)");
      // 2. 族裔面相
      assert(dims.ethnicity.every(e => base.includes(e)), "7维外貌缺失: ②日系秀气二次元面相 (japanese, delicate_face)");
      // 3. 年龄段
      assert(dims.age.some(a => base.includes(a)), "7维外貌缺失: ③年龄段 (adolescent/teenager)");
      // 4. 发型发色
      assert(dims.hair.some(h => base.includes(h)), "7维外貌缺失: ④发型发色");
      // 5. 瞳色眼型
      assert(dims.eyes.some(e => base.includes(e)), "7维外貌缺失: ⑤瞳色眼型");
      // 6. 体态胸型
      assert(dims.body.some(b => base.includes(b)), "7维外貌缺失: ⑥体态胸型");
      // 7. 肤色永久特征
      assert(dims.skinTraits.some(s => base.includes(s)), "7维外貌缺失: ⑦肤色与永久特征");

      if (scenario.assertions.basePure) {
        // base 不应包含衣物
        assert(!/skirt|shirt|jacket|dress|boots|socks/i.test(base), 
          "base 必须保持纯净外貌，严禁混入临时服装！");
      }
    }

    // 9. 同人角色 OOC 与 UC 剔除
    if (scenario.assertions.charUcExcludesCanon) {
      const charUc = (characters[0].uc || "").toLowerCase();
      scenario.assertions.charUcExcludesCanon.forEach(tag => {
        assert(charUc.includes(tag.toLowerCase()), 
          `同人角色脱离原设 (OOC) 时，Char UC 必须排除原作经典特征: "${tag}"`);
      });
    }

    // 10. 服装四要素与长度/颜色法则
    if (scenario.assertions.outfitLengthRule) {
      const outfit = (characters[0].outfit || "").toLowerCase();
      const rules = scenario.assertions.outfitLengthRule;
      if (outfit.includes("skirt")) {
        assert(rules.skirt.some(l => outfit.includes(l)), "服装长度铁律: 裙子必须标注长度 (mini/knee-length/maxi)");
      }
      if (outfit.includes("socks") || outfit.includes("thighhighs")) {
        assert(rules.socks.some(l => outfit.includes(l)), "服装长度铁律: 袜子必须标注长度 (ankle/knee-high/thigh-high)");
      }
      if (outfit.includes("boots")) {
        assert(rules.boots.some(l => outfit.includes(l)), "服装长度铁律: 靴子必须标注长度 (ankle/knee-high)");
      }
      if (outfit.includes("jacket") || outfit.includes("blazer")) {
        assert(rules.jacket.some(l => outfit.includes(l)), "服装长度铁律: 外套必须标注长度 (cropped/waist-length/long)");
      }
    }

    if (scenario.assertions.outfitColorsPresent) {
      const outfit = (characters[0].outfit || "").toLowerCase();
      scenario.assertions.outfitColorsPresent.forEach(color => {
        assert(outfit.includes(color.toLowerCase()), 
          `服装颜色铁律: 衣物必须交代颜色词: "${color}"`);
      });
    }

    // 11. 左右手独立动作与加权
    if (scenario.assertions.independentHands) {
      const action = (characters[0].action || "").toLowerCase();
      assert(scenario.assertions.independentHands.left.some(w => action.includes(w)), 
        "肢体动作碎化缺失: 必须独立描述左手 (left hand)");
      assert(scenario.assertions.independentHands.right.some(w => action.includes(w)), 
        "肢体动作碎化缺失: 必须独立描述右手 (right hand)");
    }

    if (scenario.assertions.actionWeighted) {
      const action = characters[0].action || "";
      assert(scenario.assertions.actionWeighted.test(action), 
        "核心动作与关键动词必须使用 1.2~1.4::动作:: 加权");
    }

    // 12. 景别可见性与 UC 隔离下放
    if (scenario.assertions.closeUpUcOffload) {
      const charUc = (characters[0].uc || "").toLowerCase();
      scenario.assertions.closeUpUcOffload.forEach(tag => {
        assert(charUc.includes(tag.toLowerCase()), 
          `特写镜头 (close-up) 对应角色 Char UC 必须补充下身裁切项: "${tag}"`);
      });
    }
    if (scenario.assertions.sceneNegativeNotContains) {
      scenario.assertions.sceneNegativeNotContains.forEach(tag => {
        assert(!negative.toLowerCase().includes(tag.toLowerCase()), 
          `UC 隔离原则: 全场不能有的才进 Scene negative，通用词误伤时必须下放 Char UC，禁止进 Scene negative: "${tag}"`);
      });
    }

    // 13. 连贯性持久状态延续
    if (scenario.assertions.persistentStates) {
      const combined = (seg.scene + " " + characters[0].outfit + " " + characters[0].action).toLowerCase();
      scenario.assertions.persistentStates.forEach(state => {
        assert(combined.includes(state.toLowerCase()), 
          `持久状态禁止自动蒸发，必须在分镜中延续体现: "${state}"`);
      });
    }

    // 14. 分级三问
    if (scenario.assertions.sceneStartsWith) {
      assert(scene.startsWith(scenario.assertions.sceneStartsWith), 
        `分级错误: Scene 必须以 "${scenario.assertions.sceneStartsWith}" 开头`);
    }

    return report;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { SituationValidator };
}
