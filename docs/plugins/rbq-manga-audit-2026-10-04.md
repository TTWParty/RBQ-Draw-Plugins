# 漫画模式检查记录：2026-10-04

检查基线：漫画模式 1.7.0、SDT 6.3.0，包含工作区中已经撤回双语限制、动作特例和数字标签主动过滤的修改。本次仅检查并记录，不改生产代码或提示词。以下“复现”是使用真实生产函数与模拟宿主/接口的本地结果，不是付费模型出图结果。

## 1. P1：解析返回后可能写入另一个聊天的角色记忆

位置：`plugins/smart-draw-trigger.js` 的 `callCustomHttp` / `callOpenAiCompatible` → `normalizeTaggerResult` → `learnMangaCharacterMemory`；`getCharacterProfiles` 每次读取当前 `getChatKey()`。`handleChatChanged` 没有取消这些在途请求，返回后也未校验发起聊天。

复现：在 chat-A 发起实际 `callCustomHttp`，暂停模拟响应，切换到 chat-B，再释放响应。结果 chat-A 档案仍为空，Mina 的外貌、服装和衣柜被写到 chat-B。请求上下文只携带 messageId，没有绑定聊天身份。影响不仅是绘图特征，也包括持久档案隔离；此问题处于 SDT 共用调用链，并非全由新拼装器引入。

修复方向：请求绑定 chatKey 与资料快照；切换聊天后停止落库/回填或写回明确的原会话，不能依赖响应时的当前聊天。

## 2. P1：部位分类与整组替换会删除正确外貌或服装

位置：`plugins/manga-mode.js` 的 `mangaAppearanceTag`、`resolveMangaAppearances`。

两个复现：

- 档案 base 含 `girl, korean`，模型给 `girl, freckles, smiling`、visible 为 face。结果为 `girl, korean, smiling`，雀斑丢失。原因是国籍和雀斑都归 face 组，有任意已存 face 特征就删除 positive 中整个同类组。
- 服装档案 `red high slit cheongsam`，visible 为 torso，positive 原本有 `red cheongsam, standing`。结果只剩 `girl, standing`。原因是 high slit 优先命中腿部分类，整个复合旗袍短语被裁掉，同时模型的旗袍词又被 outfit 组覆盖删除。

修复方向：只替换确定相互冲突的具体属性；服装款式与部位细节分开，不能用单个修饰词给整件衣物分类。这是 1.7.0 新增逻辑的缺陷。

## 3. P1：可靠同人标签也会被姓名清理删掉

位置：`resolveMangaAppearances` 中两处 `mangaIdentityKey(tag) === key`。

复现：name、base、positive 使用可靠标签 `hatsune miku (vocaloid)`，全身可见。组装后只剩 `girl, blue hair, smiling`，角色标签消失。清理原创姓名的判断没有区分原创姓名与同人绘图标签。

修复方向：身份关联键与可绘制角色标签分离；不能仅因为与 name 相等就删除。这是 1.7.0 新增逻辑的缺陷。

## 4. P1：当前状态只在一次响应内延续，跨楼存在自动复原

位置：`resolveMangaAppearances` 的局部 states Map；`learnMangaCharacterMemory` 仅保存 base/outfit。

复现：档案为 blonde hair、updo。第一楼 state.hair_style 为 hair down，生成词正确；第二楼不重复 state、positive 明确写 hair down，程序仍用档案 updo 覆盖。结果第一楼散发，第二楼盘发。当前提示词又要求只写变化，导致模型可能认为持续状态无需重复。

服装另有空值语义问题：state.outfit="" 能在本次响应清除衣物，但 character_memory.outfit="" 表示“不更新”。复现后长期 currentOutfit 仍为旧 red coat，下一楼会以旧服装为默认。

修复方向：固定外貌、当前状态和“无更新/明确清除”分开表示；延续到后续楼层时按楼层顺序维护，避免改写固定外貌或让旧楼覆盖新楼。这是当前状态模型不完整，不能靠反复添加提示词保证。

## 5. P1：工作台单格润色可能撤销先前换装

位置：`callLlmSingleSentenceExpander` → `requestStudioPanels` → `resolveMangaAppearances`。

复现真实工作台请求函数：聊天档案为 red dress，工作台前一格已换 blue coat。模型为当前格返回 blue coat、holding book，未重复 state。程序只用聊天档案初始化，结果变成 red dress、holding book。虽然 otherPanels 发给了模型，程序组装时没有读取此前画格已生效状态。

修复方向：编辑单格时使用工作台该时刻的状态/已有绘图快照，不能无条件从聊天服装重新开始。

## 6. P2：缺失 visible 时新机制会静默失效

位置：`resolveMangaAppearances` 的 visible 检查，以及文本 JSON 的 outputSchema。

复现：档案有发色和服装，模型 positive 仅返回 standing，不返回 visible；解析成功、可生成，人物词仍只有 standing。schema 虽要求 visible，文本模式靠模型遵循；运行时为了兼容旧数据直接跳过，不区分新解析和旧缓存。

修复方向：旧缓存兼容与新请求诊断分开，至少让新解析的缺字段问题可见。不要重新加入耗时的长规划重试。

## 7. P2：年龄身高仍可能在建档或局部镜头阶段遗漏

位置：`getCharacterMemoryTagSpecification` 与 `resolveMangaAppearances` 的未知词选择规则。

此前删除数字标签的专门过滤已经撤回，但提取指令仍要求精确年龄、身高转成可见年龄阶段和体型，没有另外保存原始数值的字段。已有数字标签也属于未分类词，只在所有 visible 部位齐全时自动复用。

复现：base 为 girl、35 years old、180cm height，face 特写结果只有 girl、smiling。这里不意味着身高必须塞入面部特写；问题是尚没有独立的事实保存与绘图表达分工，不能宣称所有明确数值已得到完整保留。

修复方向：明确事实资料与绘图标签的职责，保留已知原始事实；哪些事实作用于哪种镜头另行处理。不能靠删数字处理模型表达能力。

## 8. P2：黑白转换后的正负词可能直接冲突

位置：`enhanceMangaPayload` 对正向转换灰阶，对人物负向只做禁词清理。

复现：positive 为 blonde hair，negative 为 light grey hair。发送后正向变成 light grey hair，负向仍为 light grey hair。先前的同词负向清理发生在灰阶转换之前，无法识别这次转换新产生的冲突。

修复方向：在最终表达一致的阶段校验人物正负词冲突，不能让人物排除自己的最终发色表达。无需改动 Prompt Presets 风格拼接。

## 9. P2：新增组装器可能抢在结构校验前抛出原始异常

位置：`resolveMangaAppearances` 遍历人物时直接读取 c.name。

复现：characters:[null] 返回 `Cannot read properties of null (reading 'name')`，而不是编译器原有的“第几格/第几位人物缺少字段”诊断。无效数组类型也可能先在组装器报错。不会因此变成有效输出，但错误定位明显变差。

修复方向：组装前确认基本结构，或让无效结构进入已有编译器诊断；不吞掉错误，不新增模型请求。

## 已检查与未确认的范围

- 现有 59 项漫画回归测试全部通过，覆盖文字保留、嵌套编译、手动坐标、接口路径、记忆开关、既有重绘、工作台失败保留等。
- 情境测试 17 个场景、289 个断言及 15 个静态检查通过；两个插件的 JavaScript 语法与差异格式检查通过。
- 新的边界复现暴露了上述缺口，因此通过旧测试不能证明角色记忆机制完整。
- 没有调用真实 Tagger/绘图服务，未验证出图文字、动作准确率、选材页数或实际延迟；没有操作用户酒馆中的真实聊天。
- 没有重新加入已撤回的语言/动作规则，没有修改 Prompt Presets，没有恢复规划账本或整轮重试。

优先级建议：先保护聊天隔离，再解决特征误删与状态延续，然后修工作台单格编辑、字段诊断和最终灰阶冲突。修复应围绕明确的数据错误，不扩大为新的剧情限制。
