# 漫画模式与漫画工作台

插件 ID：`rbq-manga-mode`。入口：[manga-mode.js](../../plugins/manga-mode.js)。

版本：**1.5.0**，配套智能生图（SDT）**6.1.0**。更新时请同时更新两个插件。

## 这一版改变了什么

漫画使用“页面 → 画格 → 格内人物”结构。同一格可以有多人，一个人可以跨格多次出场；空镜不创建人物槽。画格数与人物出场槽数分别计算。

聊天自动解析、手动描述生图、工具调用及漫画工作台共用漫画协议。逐人物正负词在最后发送时展平成 NAI `char_captions`，不再通过“一个画格等于一个角色”组织请求。

- 页面及画格的环境、旁白、拟音、画外对白进入全局 caption；可见人物的动作和对白进入本人 caption。
- 各字段的视觉说明排列在 `Text:` 之前，文字原文和多气泡空行保留。台词里的逗号、竖线和 `no text` 不参与清理。
- 分页依据事件、文字量和画格容量，允许单格大画面。经典四格保留均等画格，不再与全局“禁止四等分”指令冲突。
- 角色记忆和世界书是导演的资料输入；最终镜头描述不会被整份全身外貌档案覆盖。
- 负面清理以完整标签及闭合权重块为单位。原作排除词由导演根据资料明确填写，不从任意括号猜测作品名。
- 请求顶层 `model` 设为 `nai-diffusion-5-full`。横向跨页只检测视觉描述，不检测台词。
- **Prompt Presets 插件的画风拼接保持现有行为。**

## 使用

在 SDT 的提示词设置中开启漫画模式，或直接进入独立的“漫画工作台”。关闭漫画模式时会恢复启用前的 SDT 提示词、自定义预设、前情分析及多角色设置。

工作台支持 1～5 格：

1. 输入剧情后使用“AI 智能分镜推演”，或逐格输入剧情后批量解析。
2. 设置各格的位置、大小、景别与环境。
3. 展开“格内人物与文字”，分别编辑每个人的身份编号、姓名、镜头描述、对白及负面词。同一人物跨格使用相同身份编号。
4. 旁白、拟音和画外文字放在单独的非人物文字栏；空镜保留零个人物。
5. 检查组装预览后生成。静默格与有对白的格子使用同一组装流程。

工作台 AI 使用 SDT 的 OpenAI 兼容接口配置。接口未配置、调用失败、JSON 无效或格数不符时保留当前分镜并提示错误，不再用猜测剧情自动替代。经典四格须选择自动或 4 格。

格子的增删、复制或移动会重新安排默认位置，之后可手动调整位置和大小。人物编辑区按需展开，支持手机端纵向编辑。

## 数据协议

每个 SDT `segments[]` 是一个漫画页：

```json
{
  "format": "nai5-comic",
  "label": "Page 1: 放学后",
  "anchor": { "text": "她们交谈后转身离开了教室。" },
  "page": { "base": "comic, 2 panels, 2girls, vertical layout" },
  "panels": [
    {
      "id": "P1",
      "description": "top panel, classroom, medium shot",
      "characters": [
        { "character_id": "C1", "name": "甲", "positive": "top panel, girl, long hair, BubbleType: 通常吹き出し, Layout: 縦書き, Text: 一起回家吧。", "negative": "short hair" },
        { "character_id": "C2", "name": "乙", "positive": "top panel, girl, short hair, BubbleType: 通常吹き出し, Layout: 縦書き, Text: 好。", "negative": "long hair" }
      ]
    },
    {
      "id": "P2",
      "description": "bottom panel, empty classroom",
      "non_character": "bottom panel, SFX: 擬音, 吹き出しなし, Text: 咔哒",
      "characters": []
    }
  ]
}
```

默认自动定位。导入的手动定位页可用 `position_mode: "manual"`，每次人物出场需填写有效 `center: {x, y}`（0～1）。编译器检查画格 ID、同格重复人物、正负词字段及手动坐标。

## 已有数据

不会自动删除或改写已保存的分镜、模板或角色档案。旧版工作台混合标签保留为页面内容，不猜测人物身份；点击“AI 润色本格”或批量解析后转换为新结构。新版内置模板已明确拆分人物与环境。

SDT 已缓存的旧分镜继续使用旧数据重绘；重新解析时要求新协议。漫画页换装通过 AI 微调按人物出场更新，避免字符串拼接同时保留新旧衣服。

## 验证

```sh
node test/run-manga-tests.js
node test/run-situation-tests.js
node --check plugins/manga-mode.js
node --check plugins/smart-draw-trigger.js
```

漫画回归测试直接执行生产编译器、SDT 解析器与 payload hooks，覆盖同格双人、跨格身份、空镜、静默页、文字原文、权重清理、插件顺序、模型、跨页和普通生图 schema。测试不调用付费服务；最终分格、文字与画质仍需在实际模型上对照验证。
