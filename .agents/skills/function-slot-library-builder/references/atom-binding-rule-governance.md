# Atom / Binding / Rule 治理

用于 agent 审查 atom pattern、binding pattern 和 rule pattern。

## Atom 治理

atom 是 slot 的实现变体，不是独立于 slot 任意混用的素材。

三类 atom 必须独立治理：

- script atom：回答“这个状态变化靠什么主张和证明成立”。
- rhythm atom：回答“注意力和信息负载怎么推进”。
- packaging atom：回答“证明功能如何被视觉和包装层承载”。

不要把 rhythm 或 packaging pattern 并入 script pattern。三类 atom 可以形成 implementation bundle，但 bundle 只是常见组合，不替代三类 pattern。

### script pattern

比较：

- claim pattern
- proof need
- mustKeep
- replaceable variables
- 所属 slot subtype / archetype

不要只看文案名称。不同品类素材可以同 pattern；不同证明机制不能合并。

### rhythm pattern

比较：

- attention function
- pace
- density
- beat shape
- sync points
- avoidFor

快慢只是表层。要判断节奏服务的是打断、蓄势、解释、峰值、等待、兑现还是回落。

### packaging pattern

比较：

- proof type
- visual proof type
- visual hierarchy
- replaceable forms
- risk if broken

不要按具体包装样式合并，例如圆圈、箭头、字幕、贴纸。要按包装证明功能判断。

## Binding 治理

binding 是组合约束，回答“哪些层必须同步、承接、要求、替换或冲突”。

按关系治理：

- `sync`：同一注意力拍点或同一证明时刻必须同步。
- `require`：某类主张必须有某类证明。
- `carryover`：跨槽必须回扣同一关切、对象、场景或承诺。
- `substitute`：允许替换什么，必须保留什么功能。
- `conflict`：哪些组合会破坏理解或证明。

不要按 `rule` 文本相似归并。文本只是阅读线索，真正判断看约束关系和风险。

## Rule 治理

rule 是重组政策，不是单条视频经验句。

一个 rule pattern 必须能写成：

```text
condition -> requirement -> violation -> fix
```

比较：

- condition 是否同类。
- requirement 是否同类。
- violation 是否同类。
- fix 是否同类。
- 适用的 slot family / archetype / subtype 是否一致。

不要按 `reason` 或 `fix` 文案接近归并。相近文案可能处理不同政策；不同文案也可能是同一政策的不同表达。

## Review 输出

遇到不确定项，放入 `reviewItems`，并写明：

- 候选项。
- 支持证据。
- 冲突证据。
- 需要人工确认的问题。
- 暂不归并的原因。
