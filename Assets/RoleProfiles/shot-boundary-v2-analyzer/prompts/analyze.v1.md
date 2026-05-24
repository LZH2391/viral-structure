请基于以下 V2 evidence manifest 和随后附带的 localImage 证据图，直接输出最终切镜 JSON object。

manifest:
{{manifestJson}}

输出契约:
{{outputContractJson}}

阅读顺序：
1. 先看 overview sheet，建立全片大段结构。
2. 再看 candidate check sheet。每个候选按 `t-3f / t-1f / t / t+1f / t+3f` 五帧判断，候选点只是证据。
3. 再看 dense zoom sheet，区分快切与同镜头连续动作。

判断标准：
- 只把硬切、明显跳切、转场、主体/场景/构图突变算作切镜。
- 不要把同机位连续口播、手持移动、产品靠近镜头、手部翻动、字幕/贴纸变化、曝光变化算作切镜。
- 如果高分候选被剔除，请在 `rejectedCandidates` 里简短说明。

只返回 JSON object。不要输出 markdown、解释性正文、本地路径、frameId 或旧分镜引用。
