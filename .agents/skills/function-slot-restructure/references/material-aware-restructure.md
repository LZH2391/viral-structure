# 用户素材包参与的重组流程

本参考只用于存在 `user-material-pack` / `user-material-pack.stable` 的重组任务。

一句话边界：

```text
brief + FunctionSlotLibrary + 用户素材包
-> 选槽位链
-> 逐槽位判断用户素材能否落地
-> 有素材则绑定候选 shot/group
-> 素材过量则筛选
-> 素材不足则降级、改写、重排、补全或提示补拍
-> 输出带素材约束的重组方案
```

不要做成：

```text
shot-boundary
-> 直接把 shot 标成槽位
-> 重组照单全收
```

shot 是素材单位，slot 是结构需求。一个 shot 可以在不同方案中服务不同槽位，素材理解阶段不能过早定死。

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

### 1. 标准化 brief

输出 `brief_constraints`：

```json
{
  "productCategory": "凤爪",
  "audience": "target viewers",
  "conversionGoal": "purchase / remember / click / ask",
  "claims": [
    {
      "claimId": "C01",
      "claimType": "product_identity | process | result | trust | comparison | choice",
      "strength": "strong | medium | light",
      "proofNeedClass": "product_identity"
    }
  ],
  "platformConstraints": [],
  "productionConstraints": []
}
```

### 2. 标准化用户素材包

输出 `material_constraints`，不要合并进 brief，也不要写入 FunctionSlotLibrary：

```json
{
  "materialPackId": "sampleVideoId or artifactId",
  "proofCoverage": [
    {
      "proofNeedClass": "product_identity",
      "coverage": "strong",
      "shotIds": ["shot_003"],
      "groupIds": ["group_product_identity_01"],
      "safeUsage": "可用于商品身份、品牌露出、包装记忆",
      "gapAdvice": "强规格信息需补拍包装背面或配料表"
    }
  ],
  "groups": [
    {
      "groupId": "group_product_identity_01",
      "groupType": "product_display_group",
      "continuity": "strong",
      "usableProofNeedClasses": ["product_identity"],
      "notUsableProofNeedClasses": ["trust_evidence"],
      "shotIds": ["shot_003", "shot_004"]
    }
  ],
  "sequenceRecommendations": {
    "openingCandidates": ["shot_003"],
    "middleCandidates": ["group_product_identity_01"],
    "endingCandidates": []
  }
}
```

### 3. 读取 FunctionSlotLibrary

读取治理层和证据层：

- 用 governance 选择 `slotSubtype / slotArchetype / atomPattern / bindingPrinciple / recompositionPolicy`。
- 用 slot index 回到真实 source variants 和 concrete atoms。
- 不用素材包决定 slot 命名。

### 4. 规划槽位链

先按 brief + FunctionSlotLibrary 生成槽位需求图和候选槽位链。

槽位链必须精确到 `slotSubtype`。此时还不要生成 shot 表。

### 5. 逐槽位素材能力判断

对每个槽位生成 `slot_material_fit`：

```json
{
  "slotId": "slot_001",
  "slotSubtypeId": "SUB_problem_activation",
  "materialNeeds": {
    "proofNeedClass": "problem_visibility",
    "visualNeed": "问题画面或需求场景",
    "attentionNeed": "强注意力入口",
    "captionNeed": "可被字幕点题"
  },
  "candidateMaterials": [
    {
      "source": "shot_003",
      "groupId": "group_product_identity_01",
      "fitScore": 82,
      "fitLevel": "strong",
      "usableAs": ["product_identity", "attention_entry"],
      "notUsableAs": ["trust_evidence"],
      "reason": "商品主体和包装可见，可做开场身份建立"
    }
  ],
  "landingDecision": "material_supported",
  "handlingStrategy": "bind_candidate_materials",
  "gapImpact": "无关键缺口"
}
```

## 素材评分策略

每个槽位对所有候选 group/shot 计算 `materialFitScore`，满分 100：

| 维度 | 分值 | 评分依据 |
|---|---:|---|
| 证明覆盖 `proofCoverage` | 0-30 | 是否覆盖该槽位核心 `proofNeedClass`；strong=30，partial=18-24，weak=6-12，unknown/none=0 |
| 对象/动作匹配 `objectActionFit` | 0-20 | 商品、动作、结果、对比或信任对象是否对应当前槽位需求 |
| 连续性 `continuityFit` | 0-15 | group 连续性、动作闭环、前后承接、是否支持段落推进 |
| 画面可读性 `visualClarity` | 0-10 | 清晰度、主体焦点、稳定性、遮挡情况 |
| 字幕/包装可点题 `captionPackagingAffordance` | 0-10 | 是否能被字幕、标签、标题条、圈选、卖点卡片有效点题 |
| 节奏适配 `rhythmFit` | 0-5 | 是否适合该槽位注意力强度、停顿和信息密度 |
| 复用成本 `reuseCost` | 0-5 | 是否需要裁切、重复、放大、重排；成本越低分越高 |
| 风险扣分 `riskPenalty` | 0 至 -20 | 过度承诺、证明不成立、素材排斥项、隐私/合规/误导风险 |

阈值：

- `80-100`：可落地，优先绑定候选素材。
- `65-79`：可落地但需包装、字幕或轻 adapter 补强。
- `50-64`：弱落地，必须降主张、改写实现或重组复用。
- `30-49`：缺口明显，优先结构重排、文案/包装补全或 AIGC 表达补全；不能承担强证明。
- `<30`：不可落地，删除/替换槽位、补拍/补证或仅作为 generated gap-fill 的表达占位。

## 素材过量处理

当一个槽位有过多候选素材：

1. 每个槽位保留 1-3 个主候选，最多 2 个备选。
2. 优先选择能覆盖不同证明功能的素材，不堆重复画面。
3. 连续 group 优先整体保留；只有信息重复、节奏拖慢或证据冗余时才建议裁切。
4. 同一 shot 被多个槽位看中时，记录 `reuseConflict`，后续 Shot 设计再最终分配。
5. 不把所有候选塞进方案；输出必须说明筛选依据。

处理结论：

- `material_over_supply_filter_required`
- `bind_candidate_materials`
- `existing_material_reuse_required`

## 素材不足处理

素材不足时按分数和缺失维度选择处理方式：

| 处理方式 | 适用条件 | 不能做什么 |
|---|---|---|
| 结构重排 `structure_reorder_required` | 缺某个强镜头，但可通过调整段落顺序、合并/拆分槽位、前置商品身份、后置轻感受降低依赖 | 不能掩盖核心证明缺失 |
| 文案/字幕补全 `copy_caption_fill_required` | 信息可安全写成文字，画面有弱支撑或只需说明规格/口味/场景/CTA | 不能把文字当成真实结果证明 |
| 包装补全 `packaging_fill_required` | 画面对象存在但表达不清，需要标题条、卖点卡片、贴纸、转场、箭头、圈选、图卡 | 不能让装饰替代证明 |
| AIGC 表达补全 `aigc_expression_fill_required` | 需要封面、背景、氛围、示意画面、配音或非证明性补充画面 | 不能伪造结果、对比、资质、评价、检测或信任证明 |
| 现有素材重组复用 `existing_material_reuse_required` | 有弱覆盖但数量不足，可裁切、重复利用、局部放大、冻结帧、镜头重排 | 必须说明原素材缺口和影响 |
| 降级主张 `claim_downgrade_required` | 素材只能弱支撑强主张 | 不能继续使用强证明语气 |
| 补拍/补证 `reshoot_or_evidence_required` | 需要强结果、强对比、资质、评价或可信证据，但素材包没有真实证据 | 不能用 AIGC 或包装伪造 |

## 输出要求

在 `restructure.final.md` 中保持主输出 10 节顺序不变，但当使用素材包时：

### 第 1 节必须写输入分层

- 需求侧 brief
- 供给侧用户素材包
- 结构库侧 FunctionSlotLibrary

### 第 2 节必须包含“槽位素材能力判断”

| 槽位 | 素材需求 | 用户素材候选 | 素材得分 | 落地结论 | 处理方式 | 缺口与影响 |
|---|---|---|---:|---|---|---|
| slot_001 | proofNeedClass、画面/动作/字幕点题需求 | `group_x` / `shot_003` / `shot_011` | 0-100 | 可落地 / 过量需筛选 / 需结构重排 / 需文案字幕补全 / 需包装补全 / 需 AIGC 表达补全 / 需现有素材重组复用 / 需降级主张 / 需补拍补证 | 绑定 / 筛选 / 重排 / 补字幕 / 补包装 / AIGC / 裁切复用 / 降主张 / 补拍 | 原素材缺口槽位、缺失证明能力、对主张强度或后续 Shot 设计的影响 |

### 第 9 节必须汇总素材风险

- 哪些槽位素材不足。
- 哪些槽位素材过量但已筛选。
- 哪些处理方式会影响主张强度。
- 哪些缺口必须补拍/补证。

## 质量检查

- 是否把素材包作为第二大类输入，而不是 brief 字段或库字段？
- 是否先选槽位链，再逐槽位判断素材落地？
- 是否没有把 `shotClass / shotFunctions / recommendations` 当成 `slotSubtype`？
- 是否给每个槽位输出素材得分、候选素材、处理方式、缺口与影响？
- 素材过量时是否筛选，而不是全塞？
- 素材不足时是否按分数选择结构重排、文案/字幕补全、包装补全、AIGC 表达补全、现有素材重组复用、降级或补拍？
- AIGC 是否只用于表达补全，而没有伪造证明？
- 对低于 65 分的素材是否没有直接绑定为强证明？
- 对低于 50 分的槽位是否明确说明缺口和处理方式？
