/**
 * 全场景自动化测试运行器 (Situation Test Runner)
 * 验证 15 种实战叙事情况 (17 个子用例) 与系统提示词规则自洽性
 */

const fs = require('fs');
const path = require('path');
const { SITUATIONS_MATRIX } = require('./situations-matrix.js');
const { SituationValidator } = require('./situation-validator.js');
const { GOLDEN_BENCHMARK } = require('./golden-benchmark.js');

function runTests() {
  console.log("================================================================");
  console.log("🚀 文生图 9.7 全场景测试驱动重构验证 (TDD Situation Test Suite)");
  console.log("================================================================\n");

  let totalChecks = 0;
  let passedScenarios = 0;
  let failedScenarios = 0;
  const results = [];

  // 1. 验证黄金基准用例库 (Golden Benchmark)
  console.log("--- 阶段一：15 种实战叙事场景 (17 个子用例) 契约验证 ---");
  for (const scenario of SITUATIONS_MATRIX) {
    const benchmarkOutput = GOLDEN_BENCHMARK[scenario.id];
    if (!benchmarkOutput) {
      console.error(`❌ 缺失基准输出: ${scenario.id}`);
      failedScenarios++;
      results.push({ id: scenario.id, name: scenario.name, status: "MISSING", errors: ["未提供基准输出"] });
      continue;
    }

    const report = SituationValidator.validate(scenario, benchmarkOutput);
    totalChecks += report.checks;
    if (report.passed) {
      passedScenarios++;
      console.log(`✅ [PASS] ${scenario.id.padEnd(35)} | ${scenario.name} (${report.checks} 项检查通过)`);
      results.push({ id: scenario.id, name: scenario.name, status: "PASS", checks: report.checks, errors: [] });
    } else {
      failedScenarios++;
      console.log(`❌ [FAIL] ${scenario.id.padEnd(35)} | ${scenario.name}`);
      report.errors.forEach(err => console.log(`      ↳ ${err}`));
      results.push({ id: scenario.id, name: scenario.name, status: "FAIL", checks: report.checks, errors: report.errors });
    }
  }

  console.log(`\n阶段一结果: ${passedScenarios}/${SITUATIONS_MATRIX.length} 场景通过，执行断言检查 ${totalChecks} 次。\n`);

  // 2. 验证智能生图触发器生产文件中的系统提示词自洽性
  console.log("--- 阶段二：生产代码 V40 系统提示词与少样本静态合规扫描 ---");
  const sdtPath = path.join(__dirname, '../plugins/smart-draw-trigger.js');
  const sdtContent = fs.readFileSync(sdtPath, 'utf8');

  // 提取 V40 系统提示词
  const match = sdtContent.match(/const V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT = `([\s\S]+?)`;/);
  if (!match) {
    console.error("❌ 无法在 smart-draw-trigger.js 中匹配到 V40_SPEC_97_OPTIMIZED_SYSTEM_PROMPT");
    process.exit(1);
  }

  const v40Prompt = match[1];
  console.log(`V40 系统提示词读取成功，长度: ${v40Prompt.length} 字符 (~${Math.round(v40Prompt.length / 3.8)} Token)`);

  const promptChecks = [
    { name: "S1 站看跪仰头透视链与特写互斥规则", check: v40Prompt.includes("高差与特写互斥铁律") && v40Prompt.includes("bust shot from above") },
    { name: "S2 仰卧看跨坐仰拍与自下托扶", check: v40Prompt.includes("looking up from below") && v40Prompt.includes("hands extending upward") },
    { name: "S3 平视特写合法限定同高", check: v40Prompt.includes("平视面部特写") && v40Prompt.includes("同等高度") },
    { name: "S6 开阔无接触完全省略 Foreground (空即是景)", check: v40Prompt.includes("空即是景") && v40Prompt.includes("省略 Foreground") },
    { name: "S7 第三人称双人同框与互视规范", check: v40Prompt.includes("第三人称") && v40Prompt.includes("facing_another") },
    { name: "S8 原创 OC 7 维外貌防伪矩阵与纯净法则", check: v40Prompt.includes("7 维外貌公式") && v40Prompt.includes("japanese, delicate_face") },
    { name: "S9 同人角色规范与 OOC UC 剔除", check: v40Prompt.includes("2::Name (Series)::") && v40Prompt.includes("UC 中排除原设特征") },
    { name: "S10 服装签名四要素与长度/颜色铁律", check: v40Prompt.includes("长度铁律") && v40Prompt.includes("颜色铁律") },
    { name: "S11 左右手独立动作与 1.2~1.4 动作权重", check: v40Prompt.includes("左右手独立") && v40Prompt.includes("1.2~1.4::动作::") },
    { name: "S12 景别裁切可见性与 UC 冲突下放", check: v40Prompt.includes("冲突下放原则") && v40Prompt.includes("可见性规则与 UC 隔离判定表") },
    { name: "S13 连贯性持久状态延续法则", check: v40Prompt.includes("状态延续性法则") && v40Prompt.includes("禁止自动复原") },
    { name: "S14 Safe / R / X 分级三问与底线 UC 规范", check: v40Prompt.includes("Safe（全无裸露）") && v40Prompt.includes("X（有器官或性行为）") },
    { name: "S15 纯闲聊/无画面变化拦截", check: v40Prompt.includes('{"shouldDraw": false}') },
    {
      name: "少样本示例中严禁出现高差 close-up 矛盾 (防范 Example 3 遗留 bug)",
      check: !v40Prompt.includes("looking up from below, close-up") && !v40Prompt.includes("from below, close-up")
    },
    {
      name: "少样本示例中 POV 负面词严禁遗漏 boy, male",
      check: (v40Prompt.match(/boy, male/g) || []).length >= 2
    }
  ];

  let promptCheckPasses = 0;
  for (const pc of promptChecks) {
    if (pc.check) {
      promptCheckPasses++;
      console.log(`✅ [PROMPT RULE OK] ${pc.name}`);
    } else {
      console.log(`❌ [PROMPT RULE FAIL] ${pc.name}`);
    }
  }

  console.log(`\n阶段二结果: ${promptCheckPasses}/${promptChecks.length} 提示词核心铁律扫描通过。\n`);

  if (failedScenarios > 0 || promptCheckPasses < promptChecks.length) {
    console.error("❌ 测试套件存在未通过项，请针对性重构提示词与基准！");
    process.exit(1);
  } else {
    console.log("🎉 全部 15 种情况测试矩阵与系统提示词 100% 通过验证！");
  }
}

runTests();
