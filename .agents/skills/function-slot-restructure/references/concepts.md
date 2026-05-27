# 概念说明

当需要解释或应用库级模型时，使用本参考。

## 单条视频 vs 语料库

单条导出视频只提供一份样例库。生产系统会包含很多份样例库。skill 必须避免过拟合到单一来源。

- **sample library / 样例库**：从一条视频中抽取的数据。
- **corpus library / 语料库**：多份样例库共同检索。
- **slot candidate / 槽位候选**：来自某条样例视频的一个功能槽位。
- **slot archetype / 槽位原型**：多个候选共享的规范化可复用角色。
- **template / 模板**：一种可能的槽位原型顺序。

某个样例的 template 可以启发链路，但语料库重组应比较多个候选，并在有价值时混合不同来源。

## 槽位 vs 原子 vs 模板

- **slot / 槽位**回答：这里必须完成什么观众状态跃迁？
- **script atom / 脚本原子**回答：用什么主张或语义动作实现该槽位？
- **rhythm atom / 节奏原子**回答：注意力应如何穿过这个槽位？
- **packaging atom / 包装原子**回答：如何让主张可见、可信、可记忆？
- **binding / 绑定**回答：什么必须同步、依赖、承接、替换或避免？
- **template / 模板**回答：什么槽位顺序适合某类复用模式？

## 重组单位

主要重组单位不是脚本段落，而是一个被选中的槽位候选及其兼容实现。

```text
slot candidate
  -> script implementation
  -> rhythm implementation
  -> packaging/proof implementation
  -> bindings and adapters
```

## 槽位原型

语料库应为每种原型积累多个候选，例如：

- problem activation / 痛点激活
- contradiction hook / 反差钩子
- result proof hook / 结果证明钩子
- mechanism credibility / 机制可信
- operation simplification / 操作简化
- comparison or objection handling / 对比或异议处理
- result confirmation / 结果确认
- benefit translation / 利益翻译
- social proof / 社会证明
- long-term trust / 长期信任
- decision or choice close / 决策或选择收束

随着样例增加，可以扩展原型。不要把所有视频强行塞进固定五槽模型。

## 适配器

当组合不同源视频的材料时，需要 adapter。

- **Object adapter / 对象适配器**：把开头对象或关切映射到结果对象。
- **Claim adapter / 主张适配器**：把原产品主张映射到目标产品主张。
- **Proof adapter / 证明适配器**：用等价证明功能替换源证明载体。
- **Rhythm adapter / 节奏适配器**：改变速度，或在错配的相邻槽位之间增加桥接。
- **Packaging adapter / 包装适配器**：改变视觉表层，同时保留证明功能。

## 库级目标

目标不是保存某一条视频的结构，而是根据新目标 brief，从 corpus 中选择最合适的槽位候选，同时保留证明逻辑和注意力逻辑。
