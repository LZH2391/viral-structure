# AnalysisFinalOutputs

脚本、节奏、包装三类分析的最终输出统一落在这里，按 `sampleVideoId` 分目录保存。

每个样例目录包含固定 latest 文件和 `manifest.json`：

- `script-segments.final.txt`
- `rhythm-structure.final.txt`
- `packaging-structure.final.txt`
- `manifest.json`

`.final.txt` 只保存 agent 最终消息或复用源 final 文件，不写入完整 analysis artifact、inputPackage 或调试 dump。

`manifest.json` 记录 latest 文件追踪信息：

- `outputs`：当前 latest 文件对应的 artifact、trace、stage、source、agent thread/turn、内容 hash 和字节数。
- `history`：最近的 final output 事件，记录 `write`、`keep_existing`、`copy_reuse`、`skip_missing_source`、`remove_missing_source` 等动作。

缓存复用时，如果当前样例已有同类 final 文件，会保留现有文件并记录 `keep_existing`；当前缺文件且源样例有 final 文件时，才复制源文件并记录 `copy_reuse`。
