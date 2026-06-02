# 用户素材包参与的重组流程

本参考只用于存在 `user-material-pack` / `user-material-pack.stable` 的重组任务。

一句话边界：

```text
brief + FunctionSlotLibrary + 用户素材包
-> 判断素材供给类型
-> 按说服逻辑选择最佳成片 shot/group 路径
-> 生成或修正结构方案
-> 把具体镜头落地、包装字幕、自行设计和复用处理交给 function-slot-shot-design
```

不要做成：

```text
shot-boundary
-> 不判断成片逻辑就照搬原始 shot 顺序
-> 低分槽位删除
-> 把同一批强素材当万能填充
-> 重组阶段替 shotDesign 决定自行设计/包装/复用补法
```

shot 是素材单位，slot 是结构需求。`shotCards` 的输入顺序只表示原视频时间顺序，不自动等于新视频成片顺序。重组必须按观众理解路径、证明路径和转化路径选择最佳素材顺序：如果 `shot_2 -> shot_4 -> shot_3 -> shot_1` 更顺，就重排并说明原因；如果原始 `shot_1 -> shot_2 -> shot_3 -> shot_4` 本来就最顺，就沿用并说明原因。

## 三大输入

1. **brief / 需求侧**
   - 定义品类、产品、观众、痛点、主张、平台、转化目标和生产约束。

2. **user-material-pack.stable / 用户素材供给侧**
   - 来自 `user-material-tagger`。
   - 描述真实素材能支撑哪些证明需求、有哪些候选 group/shot、哪些能力弱、哪些证明缺口不可硬讲。
   - 关键字段：`shotCards`、`materialGroups`、`proofCoverage`、`sequenceRecommendations`、`restructureInputSummary`、`globalConstraints`。

3. **FunctionSlotLibrary / 结构库侧**
   - `Runtime/Temp/FunctionSlotLibrary/slot_index.json`
   - `Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json`
   - 提供 slot subtype、archetype、script/rhythm/packaging atoms、binding principles 和 recomposition policies。

## 工作流

### 1. 读取三类输入并建立边界

先同时看清三件事，不生成额外 JSON 产物，也不要把三者混成一个字段：

- **需求侧 brief**：产品/品类、目标观众、转化目标、主张强度、平台和生产限制。
- **素材供给侧 user-material-pack**：`shotCards`、`materialGroups`、`proofCoverage`、`sequenceRecommendations`、`restructureInputSummary` 里真实可用的素材能力、限制和缺口。
- **结构库侧 FunctionSlotLibrary**：治理层的 slot subtype / archetype / atom pattern / binding principle，以及证据层 concrete variants。

这一阶段只做理解和边界确认，不新增中间产物、不新增文件、不写入 FunctionSlotLibrary。

### 2. 读取 FunctionSlotLibrary

读取治理层和证据层：

- 用 governance 选择 `slotSubtype / slotArchetype / atomPattern / bindingPrinciple / recompositionPolicy`。
- 用 slot index 回到真实 source variants 和 concrete atoms。
- 不用素材包决定 slot 命名。

### 3. 判断素材供给类型

重组先判断素材包是否能支持完整合适的视频，而不是逐槽位判生死。供给类型只允许三类：

| 供给类型 | 判断标准 | 重组可做什么 | 交给 ShotDesign 什么 |
|---|---|---|---|
| `material_oversupply_selectable` | 素材覆盖完整且有多条可选路径或明显冗余 | 筛选一条具体 `shotRef/groupId` 推荐路径，路径可重排也可沿用原序，说明未选素材为何不用 | 最终镜头拆分、剪法、包装字幕、少量补镜头 |
| `material_sufficient_specific_path` | 素材数量不多，但能支撑一条明确路径，时长、信息密度、证明强度和复用压力基本可控 | 顺着素材能力生成结构方案，输出重排后的推荐素材顺序 | 最终落镜头和局部表达增强 |
| `material_insufficient_for_full_video` | 缺关键链路、总时长/信息密度不足、证明弱、复用压力高，或只能靠重复素材硬撑 | 仍输出结构方案，只说明素材不足以独立支撑完整视频 | 逐 slot 决定现有素材、包装字幕、自行设计、回重组或复用变形兜底 |

判断维度必须至少包含：

- **链路覆盖**：是否覆盖开场/对象建立、过程或机制、结果或证明、转化收束等必要观众路径。
- **顺序可组性**：素材能否组成观众能理解的顺序；该顺序可能是重排后的，也可能刚好等于输入顺序。
- **总时长与信息密度**：例如 4 个镜头总共 6 秒，即使能力类型齐全，也可能只是骨架够、成片厚度不足。
- **证明强度**：有画面不等于有证明；弱结果、弱对比、弱信任不能承载强主张。
- **复用压力**：如果同一 shot 必须承担多个主功能，不能判断为素材刚好够。
- **素材连续性**：`materialGroups` 可作为连续证据，但未成组的 shot 不默认连续。

### 4. 推荐素材路径

当供给类型为 `material_oversupply_selectable` 或 `material_sufficient_specific_path` 时，必须输出一条推荐素材路径：

```json
{
  "materialSupplyType": "material_sufficient_specific_path",
  "recommendedMaterialPath": [
    {
      "order": 1,
      "source": "shot_002",
      "roleInVideo": "开场对象建立",
      "reason": "商品主体清楚，适合先建立观看对象"
    },
    {
      "order": 2,
      "source": "shot_004",
      "roleInVideo": "过程演示",
      "reason": "动作比 shot_003 更完整，放在商品识别之后更顺"
    }
  ],
  "sequenceRationale": "按对象建立 -> 过程可见 -> 结果确认 -> 轻 CTA 选择成片顺序；若不沿用原输入顺序，说明重排原因。",
  "unusedMaterialReason": [
    {
      "source": "shot_001",
      "reason": "与 shot_002 信息重复，保留给 shotDesign 作为备选，不进入主路径"
    }
  ]
}
```

要求：

- 推荐素材顺序必须是成片顺序，不是简单复述输入顺序。
- 如果沿用输入顺序，必须明确说明它刚好符合成片逻辑；沿用合理顺序是允许的。
- 允许精确到 `shotRef` 或 `groupId`；如果用 `groupId`，说明组内顺序是否沿用原组连续性。
- 只写结构级 role 和选择理由，不写最终剪法、台词、包装细节、自行设计补法或逐 shot 分镜。

## 供给分级判断

重组侧不做最终策略评分。这里不要输出 0-100 分，也不要按分数决定“现有素材 / 包装字幕 / 自行设计 / 复用”。重组只做素材供给分级，回答：

- 这包素材能不能支撑一条完整合适的视频。
- 如果能，最适合哪条成片路径。
- 如果不能，是链路缺失、时长厚度不足、证明弱，还是复用压力高。

供给分级只看这些结构级信号：

| 信号 | 判断问题 |
|---|---|
| 链路覆盖 | 是否覆盖开场/对象建立、过程或机制、结果或证明、转化收束等必要观众路径 |
| 顺序可组性 | shot/group 是否能组成顺畅视频；可以重排，也可以合理沿用输入顺序 |
| 证明有效性 | 证明是否真实成立，是否存在强主张弱证据 |
| 成片厚度 | 总时长、信息密度、动作可读停留是否支撑完整视频 |
| 画面可读性 | 清晰度、主体焦点、稳定性、遮挡是否影响结构判断 |
| 复用压力 | 是否需要同一 shot 承担多个主功能；压力高时不能判断为素材刚好够 |
| 风险边界 | 是否存在过度承诺、素材排斥项、隐私/合规/误导风险 |

具体策略评分后置到 `function-slot-shot-design`：

- 每个 slot 用哪个现有素材。
- 哪些素材需要包装/字幕强化。
- 哪些位置由 shotDesign 自行设计镜头。
- 是否需要回到重组。
- 是否只能复用变形兜底。

## 明确禁止

- 禁止因为某个 slot 的素材得分低就删除该 slot。
- 禁止把高分 shot 反复塞进多个 slot。
- 禁止不判断成片逻辑就按输入 shot 顺序直接生成素材链路。
- 禁止在重组阶段决定“这个 slot 用自行设计 / 包装字幕 / 复用”。
- 禁止把自行设计写成低优先级补丁；自行设计的具体使用由 shotDesign 依据落地缺口决定。
- 禁止用自行设计、包装或字幕伪造结果、对比、资质、评价、检测或强信任证明。

## 输出要求

在 `restructure.final.md` 中保持主输出 10 节顺序不变，但当使用素材包时：

### 第 1 节必须写输入分层

- 需求侧 brief
- 供给侧用户素材包
- 结构库侧 FunctionSlotLibrary

### 第 2 节必须包含“素材供给判断”

| 供给类型 | 可支持的视频路径 | 推荐素材顺序 | 关键 shot/group | 总时长/信息密度判断 | 复用压力 | 证明强度 | 后续 shotDesign 注意事项 |
|---|---|---|---|---|---|---|---|
| `material_sufficient_specific_path` | 对象建立 -> 过程演示 -> 结果确认 -> 轻 CTA | `shot_002 -> shot_004 -> shot_003 -> shot_001` | `shot_002`, `shot_004`, `shot_003`, `shot_001` | 总时长偏短但信息链完整 | 低 / 中 / 高 | 强 / 中 / 弱 | 只提示注意事项，不指定补法 |

### 第 9 节必须汇总素材风险

- 素材供给类型的主要风险。
- 推荐素材路径中证明强度不足的位置。
- 总时长、信息密度或复用压力的结构级影响。
- 哪些强证明缺口不能用自行设计、包装或字幕伪造。

## 质量检查

- 是否把素材包作为第二大类输入，而不是 brief 字段或库字段？
- 是否没有把 `shotClass / shotFunctions / recommendations` 当成 `slotSubtype`？
- 是否没有在缺少成片逻辑说明时照搬原始 shot 顺序？
- 是否在素材充足时输出了推荐素材路径，且说明了为何重排或为何沿用原序？
- 是否没有因为低分素材删除槽位？
- 是否没有把同一批强素材反复填进多个 slot？
- 是否没有在重组阶段指定逐 slot 的自行设计、包装字幕或复用补法？
- 是否把具体镜头落地、复用变形和自行设计交给 `function-slot-shot-design`？
