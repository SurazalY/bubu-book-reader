# Luna 首轮过度设计归档

2026-08-16，用户要求回退 Luna 在算法/流水线层新增的改动，改由新的 Codex Sol 任务搭建精简流水线。

本目录保留被移出活动路径的文件，仅用于审计和必要时恢复：

- `book-parser/pipeline/`：OCR v2 runner、冻结、attempt、扫描和 verifier；
- `book-parser/prompts/` 与 `book-parser/schemas/`：首轮 prompt 和 Schema；
- `book-parser/tests/`：首轮 OCR v2 测试；
- `book-parser/work/text-ocr-v2/`：12 页渲染准备和物理页 1 首轮 Luna 结果。

这些文件不属于新的活动实现，新 Sol 不得复制其状态机、transaction/commit、多层 ledger 或通用 verifier 设计。物理页 1 首轮结果只作为历史证据保留，不计入新流水线的正式 12 页结果。
