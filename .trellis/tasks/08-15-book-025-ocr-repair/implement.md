# book-025 OCR 12 页精简校准实施计划

> 2026-08-16 用户决定回退首轮 Luna 搭建的生产级 OCR v2 算法/流水线，改由新的 Codex Sol 任务搭建精简流水线。本任务仍严格止于 12 页校准报告；不得执行 162 页全书 OCR、发布、导入或 G2。

## 当前边界

- OCR 校准页固定为物理页 `1, 5, 40, 111, 112, 113, 122, 123, 124, 150, 151, 152`。
- 物理页 `162` 只做结构观察，不作为 OCR 页。
- 主 OCR：Codex `gpt-5.6-luna`，reasoning `xhigh`。
- 独立审核：Agy CLI `gemini-3.7-flash-high`，effort `high`。
- 不生产文字坐标或 bbox；只保留逻辑段落和字符偏移。
- Sol 搭建流水线时最多使用 1 张校准页自测，不得批量 OCR；Luna 才是 12 页正式 OCR 来源。

## 阶段 0：回退首轮过度设计

- [x] 停止旧 Luna 任务；确认它没有处理物理页 5、没有调用 Gemini。
- [x] 将 Luna 新增的 OCR v2 算法代码、Schema、测试和首轮工作目录移出活动路径，归档到 `archive/luna-overbuilt-20260816/`。
- [x] 保留物理页 1 首轮结果作为历史证据，但新流水线不得依赖或复制它。
- [x] 用本文件替换生产级状态机、transaction、中央账本和通用 verifier 方案。

## 阶段 1：Sol 搭建精简流水线

- [x] 新建独立 Codex Sol 任务；先阅读本计划、PRD、调查报告和 `AGENTS.md`。
- [x] 只实现一个薄协调层：按物理页导出/定位页图，计算图片 SHA-256，保存 Luna 文本和文本 SHA-256，保存模型/任务来源。
- [x] 每页使用独立目录或单文件记录，至少包含：`pageNo`、`imagePath`、`imageSha256`、`text/paragraphs`、`textSha256`、`model`、`taskId`。
- [x] 显式拒绝页号不在 12 页集合、图片哈希不一致、目标结果已存在和空 OCR 文本。
- [x] 不实现状态机、transaction/commit marker、多层 ledger、通用生产级 verifier、自动 correction 或兼容旧 OCR 的兜底路径。
- [x] 为上述四个确定性失败条件补最小测试。
- [x] Sol 最多选 1 张校准页完成端到端自测；结果标记为 `pipeline-self-test`，不得计入 Luna 12 页正式结果。

### Gate SIMPLE

- 精简流水线能证明一页图片和一份文本的一一绑定。
- 自测页数量不超过 1。
- 未调用 Gemini，未创建 Luna 正式校准结果，未修改历史 OCR v1。

## 阶段 2：Luna 运行 12 页正式 OCR

- [x] 向 Luna 任务逐页发送单个物理页；每个回合只允许 1 页。
- [x] Luna 只读取指定页图，不读取相邻页或历史 OCR 正文。
- [x] 每页结果立即通过精简流水线保存并核对页号、图片哈希和文本哈希。
- [x] 失败或不一致时保留证据并停止该页；不得自动拼接、选择更长文本或换用其他模型。
- [x] 完成 12 页后停止 Luna，不生成第 13 个 OCR 页面。

## 阶段 3：Gemini 与人工校准审核

- [x] Gemini 分别读取同一页图和对应 Luna 文本，返回 `passed/failed + findings`；不修改正文。
- [x] 保留历史坏页 `112`、`123`、`151` 和一组错图/错文负向控制。
- [x] 人工逐页对照 12 张源图与 Luna 文本，记录漏文、错文、跨页混入和阅读顺序问题。
- [x] 生成逐页对照表和 `CAL-GO` / `CAL-NO-GO` 报告，记录实际调用数、失败数和耗时。

## 强制停机

- [x] 交付 12 页校准报告后结束本任务。
- [x] 无论结论如何，都不得在本任务内启动 162 页重跑、release、导入或 G2。
- [x] 全书阶段必须另建任务并取得用户新授权。

## 验证原则

- 只用物理页号、图片 SHA-256 和文本 SHA-256 保证试验期页绑定。
- 文件存在不代表审核通过；最终结论由 Gemini 证据和人工对照共同形成。
- 不使用旧 OCR、Gemini 生成正文或默认文本补齐 Luna 失败。

## 阶段 4：MinerU 3.4.4 + PP-OCRv6 Torch 候选复测

> 2026-08-16 用户明确要求由子 agent 部署该候选并复用同一组 12 张物理页图做对照测试。Luna 已有结果保持只读；本阶段仍不得扩展到第 13 页或全书。

- [x] 使用隔离环境固定 MinerU `3.4.4`，后端固定为 `pipeline`，OCR 语言/模型路由固定为 `ch_server`，解析方法强制为 OCR。
- [x] 记录实际 Python、Torch、CUDA、GPU/CPU device、MinerU、模型文件与配置来源；不得把“GPU 可见”等同于实际 GPU 推理。
- [x] 只读取现有物理页 `1, 5, 40, 111, 112, 113, 122, 123, 124, 150, 151, 152` 的 PNG 和冻结哈希；不得读取 Luna 正文作为 MinerU 输入。
- [x] 保留 MinerU 原始结构化输出，并生成独立的逐页段落 JSON、图片 SHA-256、文本 SHA-256、耗时与 provenance；不得覆盖 `formal/` Luna 结果。
- [x] 每页输出显式绑定物理页；缺页、空正文、图片哈希变化、重复结果或第 13 页必须显式失败。
- [x] 使用 Agy CLI `gemini-3.7-flash-high`、effort `high`，逐页对照相同源图和 MinerU 文本；Gemini 只审核，不修改正文。
- [x] 人工复核 Gemini findings，并与 Luna 的 12 页结果比较逐字通过页、major/minor/blocking、页边界、耗时和资源使用。
- [x] 交付 MinerU 12 页对照报告后停止；不得执行物理页 162、49 本全量、release、导入或 G2。

阶段结论：冻结的规范化交付为 `2/12 exact`、`0 blocking`、`8 major`、`8 minor`，未达到试点门槛；raw PP-OCRv6 识别仍有继续校准价值，下一轮应先处理章节标题内容选择与图片题注阅读顺序。证据见 `book-parser/work/ocr-calibration-mineru/book-025/comparison-report.md`。

## 阶段 5：Gemini 3.7 Flash Low 直接 OCR 候选复测

> 2026-08-16 用户要求复用现有薄流水线，让 Agy `gemini-3.7-flash-low` 对同一组 12 页直接 OCR，以判断未来是否可以减少审核。本阶段只验证该候选；不能据单一 12 页样本直接取消全量质量控制。

- [x] 复用 `ocr_calibration_simple.py` 的固定页集合、图片 SHA-256、空文/覆盖拒绝和逐页落盘，不另建第二套流水线。
- [x] 复用 Agy Windows 路径、独立会话、raw response 与 usage 记录；新增仅含 `paragraphs` 的直接 OCR 输出 schema。
- [x] 生成阶段固定 `gemini-3.7-flash-low`、effort `low`，每个物理页一个独立会话，不读取 Luna、MinerU、相邻页或历史 OCR。
- [x] 只处理物理页 `1, 5, 40, 111, 112, 113, 122, 123, 124, 150, 151, 152`，冻结 image/text hash、conversation ID、耗时和 token。
- [x] 由 Codex/人工逐图核验，不让 Gemini 审核自己的直接 OCR；分别统计 exact、major/minor/blocking、漏文和阅读顺序。
- [x] 与 Luna、MinerU frozen normalized 对比并报告；完成后停止，不扩跑 162 页或 49 本。

阶段结论：Gemini Low 为 `8/12 exact`、`0 blocking`、`1 major`、`3 minor`，质量高于 Luna 和当前 MinerU frozen normalized，但未达到 `0 major、至少 10/12 exact` 门槛。为获得 12 个正式结果共调用 20 次，留存 8 次失败证据；page 151 的序列化 JSON 正文污染通过了 schema/hash 校验，现阶段不能取消所有内容质量控制。证据见 `book-parser/work/ocr-calibration-simple/book-025/gemini-low/comparison-report.md`。
