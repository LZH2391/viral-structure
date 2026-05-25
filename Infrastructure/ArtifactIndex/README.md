# ArtifactIndex

`Infrastructure/ArtifactIndex` 维护本地样例处理库和 cache 索引。

它不是 artifact 原文存储。实际 artifact、媒体文件、调试快照仍位于 `Runtime` / 本地 store 中；ArtifactIndex 保存可检索的摘要、树、cache key 和定位信息。

## 当前入口

- `artifact-index.js`

默认索引文件位于：

```text
Runtime/ArtifactIndex/index.json
```

具体根目录由 `local-store` 的 `runtimeRoot` 决定。

## 负责内容

- 登记样例 artifact 的库条目。
- 构建 artifact tree，用于处理库展示和结果来源查看。
- 根据 file hash、stageName、params、processorVersion 生成 cache key。
- 维护 cache entry 到样例、artifact、stage 的映射。
- 删除某个样例相关 cache。
- 读取最新同源 file hash 的处理结果。

## 约束

- index 只保存摘要和定位信息，不保存完整敏感内容。
- cache params 只包含真正影响结果的字段。
- 新增核心 artifact 类型时，要同步检查 artifact tree 和 cache param builder。
- cache reuse 生成的新 artifact 仍必须保留 `parentArtifactId` 和来源信息。
- 索引损坏时可以重建，但不应成为唯一的结果真相来源。

## 常见接入点

- `Apps/Api/lib/artifact-cache-param-builders.js`
- `Apps/Api/lib/sample-processing-service.js`
- `Apps/Api/lib/analysis-runtime-v2/materialize-runtime.js`
- `Apps/Api/lib/*/artifact-writer.js`

相关测试：

```powershell
node --test Tests/unit/artifact-index.test.js
```
