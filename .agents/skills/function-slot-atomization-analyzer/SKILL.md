---
name: function-slot-atomization-analyzer
description: 从脚本段落、节奏结构、包装结构三份 final 分析结果中抽象短视频功能槽位链、脚本原子、节奏原子、包装原子、绑定关系和重组规则。用于需要把样例视频结构转成可复用、可替换、可重组的原子结构时；不重新切镜头、不重做脚本/节奏/包装分析、不生成新脚本。
---

# SKILL: 功能槽位原子化分析

你负责把已经完成的脚本段落、节奏结构、包装结构分析，抽象成可重组的功能槽位链。

一句话边界：

> 不要把脚本、节奏、包装直接按表面顺序硬绑定；必须先抽象功能槽位，再让脚本原子、节奏原子、包装原子挂到同一个槽位上，并记录三者的同步、替换、冲突和承接关系。

## 核心目标

输入一条样例视频的三份 final 结果：

- `script-segments.final.txt`
- `rhythm-structure.final.txt`
- `packaging-structure.final.txt`

输出一套可复用的结构结果：

- 功能槽位链
- 脚本原子
- 节奏原子
- 包装原子
- 绑定关系
- 重组规则
- 可重组模板

这个 skill 的目标不是总结“这条视频用了什么结构”，而是回答：

- 哪些结构任务必须保留。
- 哪些表面实现可以替换。
- 哪些原子可以移位或复用。
- 哪些脚本、节奏、包装组合不能错配。

## 核心概念

### 功能槽位

功能槽位是主输出单位。

一个功能槽位表示一次观众状态变化和说服任务，例如：

- 痛点激活槽
- 机制可信槽
- 低门槛步骤槽
- 结果兑现槽
- 长期信任槽
- 选择收束槽

功能槽位不等于脚本段落、节奏段落、包装段落，也不等于 shot。它是三者共同服务的中间层。

### 脚本原子

脚本原子负责语义推进。

它回答：

- 这一段在说服链路里负责什么。
- 它让观众相信或理解什么。
- 它需要什么证明支持。
- 它依赖前后哪些结构。

不要把脚本原子写成原文句子。脚本原子是说服任务、前后依赖和证明需求。

### 节奏原子

节奏原子负责注意力状态变化。

它回答：

- 观众在这一段被拉快、稳住、暂停、爆发，还是回落。
- 这种节奏适合服务哪些脚本任务。
- 它不适合承载哪些复杂信息。
- 它和哪些动作、包装或结果点需要同步。

节奏段落不一定和脚本段落完全重合。允许记录节奏跨越脚本边界。

### 包装原子

包装原子负责感知、强调、证明和转化包裹。

它回答：

- 信息靠什么视觉、字幕、贴纸、图卡、证据或产品露出被观众感知。
- 包装功能是什么。
- 表面载体是什么。
- 哪些载体可以替换，哪些证明功能不能缺。

包装原子要区分“包装功能”和“包装载体”。重组时优先保留包装功能，不死保留具体载体。

## 输入

任务会提供三份已经完成的 final 结果。你只使用这些输入，不读取无关文件，不回到原始视频重新分析。

脚本段落输入通常包含：

- `segments`
- `label`
- `roleInScript`
- `shotRefs`
- `evidence`
- `transferableRule`
- `confidence`
- `needReview`

节奏结构输入通常包含：

- `overview`
- `sections`
- `label`
- `shotRefs`
- `fields`
- `confidence`
- `needReview`

包装结构输入通常包含：

- `overview`
- `shotPackagingNotes`
- `packagingBlocks`
- `claimStack`
- `proofStack`
- `conversionWrap`

系统侧可能另外维护 `sampleVideoId / artifactId / traceId / parentArtifactId / stageName` 等 metadata。这些只用于来源追踪，不作为语义判断依据。

## 判断流程

### Step 1: 通读三份 final

先分别理解三层结构：

- 脚本是语义骨架。
- 节奏是注意力时间曲线。
- 包装是感知和证明层。

不要一开始就按 shot 对齐，也不要直接让三份段落一一对应。

### Step 2: 抽出功能槽位链

根据观众状态变化和说服任务，抽出一条槽位链。

每个槽位必须回答：

- 观众进入槽位前是什么状态。
- 观众离开槽位后是什么状态。
- 这个槽位完成什么说服任务。
- 它依赖哪些脚本、节奏、包装证据。

一个样例通常产出多个功能槽位。槽位数量由样例结构决定，不强行固定。

### Step 3: 抽脚本原子

对每个槽位，提取脚本原子：

- 语义功能
- 主张类型
- 证明需求
- 前置依赖
- 后置依赖
- 必须保留的结构
- 可替换变量

### Step 4: 抽节奏原子

对每个槽位，提取节奏原子：

- 注意力功能
- 速度或密度形态
- 停顿、加速、爆点或回落方式
- 适配的脚本功能
- 不适配的脚本功能
- 必须同步的节奏点

如果节奏跨越多个脚本槽位，要在绑定关系里说明，不要硬切成和脚本完全一致。

### Step 5: 抽包装原子

对每个槽位，提取包装原子：

- 包装功能
- 视觉元素
- 信息层级
- 证明类型
- 可替换载体
- 可信度作用
- 过度包装风险

包装原子必须服务主张类型。不要把元素清单当成最终结果。

### Step 6: 建立绑定关系

至少识别这些关系：

- `support`：一个原子增强另一个原子的表达。
- `require`：某类主张必须配某类证明或包装。
- `sync`：脚本事件、节奏点、包装事件需要同步。
- `substitute`：保留功能，允许替换表面载体。
- `conflict`：某些脚本、节奏、包装组合不应同时出现。
- `carryover`：前后槽位共享同一对象、证据或注意力线索。

绑定关系要服务后续重组判断，而不是只描述当前样例现象。

### Step 7: 生成重组规则

重组规则必须说明：

- 什么可以替换。
- 什么必须保留。
- 什么可以移动。
- 什么不能配对。
- 哪里允许节奏跨越脚本边界。
- 每类主张需要什么证明包装。

重组优先级为：

```text
脚本逻辑完整性 > 证明匹配度 > 节奏曲线 > 包装风格
```

## 输出

只返回一个 JSON 对象，不要 Markdown，不要解释 JSON 外的内容。

```json
{
  "atom_inventory": {
    "script_atoms": [
      {
        "id": "S001",
        "slot": "problem_activation",
        "label": "问题区直冲开场",
        "semantic_function": "指出高痛点问题区，并把产品转成可执行动作",
        "claim_type": "problem_to_action",
        "proof_need": "需要直接可见的问题区和动作",
        "dependency_before": [],
        "dependency_after": ["mechanism_explain"],
        "must_keep": ["具体问题对象", "直接解决动作"],
        "replaceable_variables": ["问题区域", "产品动作", "口播表达"],
        "source_refs": {
          "script_segment_labels": ["问题区直冲开场"],
          "shot_refs": ["shot_1", "shot_2"]
        },
        "confidence": 0.9,
        "need_review": false
      }
    ],
    "rhythm_atoms": [
      {
        "id": "R001",
        "slot": "problem_activation",
        "label": "贴脸连击起手",
        "attention_function": "快速敲击注意力",
        "pace": "fast_staccato",
        "density_type": "cut_density",
        "beat_shape": "连续敲点",
        "best_for_script_functions": ["problem_activation", "direct_demo"],
        "avoid_for": ["complex_mechanism", "long_claim"],
        "sync_points": ["局部指示", "产品接触", "动作落点"],
        "source_refs": {
          "rhythm_section_labels": ["贴脸连击起手"],
          "shot_refs": ["shot_1", "shot_2"]
        },
        "confidence": 0.9,
        "need_review": false
      }
    ],
    "packaging_atoms": [
      {
        "id": "P001",
        "slot": "problem_activation",
        "label": "局部圈定加动作示范",
        "packaging_function": "把问题对象压到第一视线",
        "visual_elements": ["局部聚焦", "手指指示", "短字幕", "动作提示字"],
        "visual_hierarchy": "问题部位第一，产品动作第二，字幕辅助",
        "proof_type": "direct_visual_problem_proof",
        "replaceable_style": ["圆形聚焦", "箭头", "框选", "局部裁切"],
        "risk": "如果字幕或图卡过重，会抢走问题部位第一视线",
        "source_refs": {
          "packaging_block_labels": ["局部圈定加动作示范开场"],
          "shot_refs": ["shot_1", "shot_2"]
        },
        "confidence": 0.9,
        "need_review": false
      }
    ]
  },
  "slot_map": {
    "slots": [
      {
        "slot_id": "F001",
        "slot_order": 1,
        "slot_name": "痛点激活槽",
        "slot_type": "problem_activation",
        "viewer_state_before": "观众尚未进入产品语境",
        "viewer_state_after": "观众看到具体痛点，并理解产品处理对象",
        "persuasion_task": "把高痛点对象推到第一视线，并立刻给出解决动作",
        "script_atom_ids": ["S001"],
        "rhythm_atom_ids": ["R001"],
        "packaging_atom_ids": ["P001"],
        "required_sync_points": ["问题出现", "手指指向", "产品动作落下"],
        "substitution_rules": ["任务不变时，问题对象、动作载体和包装样式可替换"],
        "source_refs": {
          "shot_refs": ["shot_1", "shot_2"]
        },
        "confidence": 0.9,
        "need_review": false
      }
    ]
  },
  "binding_graph": {
    "bindings": [
      {
        "id": "B001",
        "type": "sync",
        "slot_ids": ["F001"],
        "atom_ids": ["S001", "R001", "P001"],
        "rule": "问题对象出现、手指指向、产品动作落下要尽量踩在同一注意力拍点",
        "risk_if_broken": "观众看见动作但没有建立具体痛点对象",
        "confidence": 0.9
      }
    ]
  },
  "conflict_checks": [
    {
      "id": "C001",
      "slot_ids": ["F001"],
      "reason": "痛点激活槽不适合承载复杂机制解释",
      "fix": "把机制解释后移到机制可信槽，并改用较稳的解释节奏"
    }
  ],
  "recombination_rules": [
    {
      "id": "RULE001",
      "rule": "如果开头使用问题区直冲，结果槽位必须回到同一问题对象或同一观众关切",
      "applies_to": ["problem_activation", "result_confirmation"],
      "source_binding_ids": ["B001"]
    }
  ],
  "recomposition_templates": [
    {
      "template_id": "T001",
      "template_name": "问题直冲型产品演示",
      "sequence": [
        "problem_activation",
        "mechanism_explain",
        "operation_loop",
        "result_confirmation",
        "trust_close"
      ]
    }
  ]
}
```

## 输出规则

- 只返回 JSON。
- 功能槽位必须按视频推进顺序输出。
- 一个样例可以有多个功能槽位。
- 每个槽位至少要有一个脚本原子、一个节奏原子、一个包装原子。
- 不要求脚本段落、节奏段落、包装段落数量完全一致。
- 不要把 shot 当作原子；shot 只能作为证据引用。
- 不要生成新脚本、新分镜、新视频方案。
- 不要改写上游 final 结果。
- 不要把包装元素清单当成包装原子，必须写出包装功能。
- 不要把节奏快慢当成节奏原子的全部，必须写出注意力作用。
- 不要把脚本文案当成脚本原子，必须写出说服任务和证明需求。

## 防错规则

- 机制解释类脚本原子不能直接配超快切节奏，除非信息极短且有明确图形锚点。
- 结果展示必须回到前面被指出的问题对象或同一观众关切。
- 长期背书至少需要一种时间证据、使用痕迹、记录、复购或持续反馈。
- 步骤信息最好放在节奏减速点，并配动作或提示包装。
- 包装强度必须随槽位任务变化，不能全程高包装。
- 节奏爆点最好由可见动作兑现触发，而不是只靠一句话。
- 功能槽位定任务，原子定实现；任务不变时实现可换，任务变了不能强行归入同一槽位。

## 反例提醒

以下做法都算偏题：

- 把 `shot_1`、`shot_2` 直接当作原子。
- 把脚本段落 A、节奏段落 A、包装段落 A 机械绑定。
- 只输出“这条视频有五段”，不说明每个槽位的观众状态变化。
- 只列出包装元素，不说明它们服务什么主张或证明。
- 在重组规则里开始写新商品脚本。
- 发现节奏跨脚本边界时强行切齐，导致结构变僵。
