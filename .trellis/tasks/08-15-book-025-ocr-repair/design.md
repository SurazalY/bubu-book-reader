# book-025 OCR 12 页精简校准设计

> 2026-08-16 用户明确取消首轮生产级状态机、transaction、多层 ledger 和通用 verifier 设计。本文件是当前设计；全书生产流水线留到校准通过后的独立任务。

## 目标

用尽量少的机制回答两个问题：

1. Luna 对指定物理页的 OCR 是否完整、顺序正确；
2. Gemini 是否能发现整页错配、大段漏文、跨页混入和明显添加。

## 精简链路

```text
源 PDF 的一个物理页
  -> 单页 PNG + imageSha256
  -> Luna 单页 OCR
  -> 单页结果 JSON + textSha256
  -> Gemini 读取同一 PNG 和同一文本
  -> 人工逐页对照
  -> 12 页校准报告并停止
```

## Sol 只负责薄流水线

Sol 不负责 12 页正式 OCR，只实现以下能力：

- 给定允许的物理页号，导出或定位一张页图并计算 SHA-256；
- 给定 Luna 段落、模型和任务 ID，生成一个简单结果 JSON；
- 计算文本 SHA-256；
- 拒绝非法页号、错图片哈希、空文本和覆盖已有结果；
- 最多拿一张页图做端到端自测，并存入独立 `self-test/` 目录。

明确不实现：状态机、transaction/commit marker、中央进度账本、多层 provenance、通用 correction、生产级异常扫描或历史 OCR 兼容分支。

## 单页结果格式

```json
{
  "schemaVersion": "ocr-calibration-page/v1",
  "kind": "formal-luna",
  "bookId": "book-025",
  "pageNo": 112,
  "imagePath": "images/page-0112.png",
  "imageSha256": "...",
  "paragraphs": ["...", "..."],
  "textSha256": "...",
  "model": "gpt-5.6-luna",
  "taskId": "..."
}
```

- `kind` 只区分 `pipeline-self-test` 和 `formal-luna`；Sol 自测永远不能算正式结果。
- 文本哈希按固定方式连接段落后计算，具体分隔符由实现写入文档并测试。
- 不保存 bbox、行坐标或字符坐标。
- 重试不得覆盖已有文件；使用新的明确编号，并在人工报告中说明采用哪次结果。

## Luna 规则

- 正式 OCR 固定使用 `gpt-5.6-luna` + `xhigh`。
- 一个回合只处理一个协调任务指定的物理页。
- 只读取该页图片，不读取相邻页、历史 OCR 正文或 Sol 自测文字。
- 输出页面可见业务正文和逻辑段落，不做审核、不自动修文。

## Gemini 与人工审核

- Gemini 固定使用 Agy CLI `gemini-3.7-flash-high`、effort `high`。
- 每次只读取一张页图和对应 Luna 文本，返回 `verdict` 与 `findings`，不提供替代正文。
- 负向控制保留历史坏页 `112`、`123`、`151` 和一组错图/错文。
- 人工逐页查看 12 张图与 Luna 文本，记录遗漏、错字、顺序、跨页混入和与 Gemini 的分歧。

## 目录建议

```text
book-parser/work/ocr-calibration-simple/book-025/
  images/
  self-test/
  formal/
  reviews/
  calibration-report.json
  calibration-report.md
```

目录只是试验记录，不是未来 162 页生产架构承诺。

## 停机闸门

- Sol 自测最多一页；不得顺手生成 12 页结果。
- Luna 正式结果最多 12 页；不得生成第 13 页。
- 校准报告完成后停止，不执行 162 页、release、导入或 G2。
- 若决定全书重跑，再单独设计生产级并发、事务、恢复和审计机制。
