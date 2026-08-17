# 三书双模式阅读试点实施与验收记录

主依据：`docs/reader-dual-mode-pilot-plan.md`。本文件记录 2026-08-15 当前工作区的可复现状态，不改变已冻结的产品决策。

## 基线与资料保护

- Git 基线：`codex/reader-ocr-checkpoint-20260815` / `55e7592221e515eaae10428520b5fcaf363f6e5d`。本任务未提交、未推送、未创建 PR。
- `device-migration-20260815/SHA256SUMS` 已逐项校验；原始归档未删除、未覆盖。只解出三本源 PDF、对应 OCR job、解析器与必要验证资料。
- 三本冻结源 PDF 哈希与物理页数：`book-001` `abeacc303306bb4faba7648de179914a87fc6260d8a043fccb13d6bfb98204f5` / 98，`book-025` `5c419590e69f1d00d276acd16e157bdb0c8f3e2fc0d25183484cdf65faced6cd` / 162，`book-045` `78ae35fcfd50ebfaaf6392dafa4392eda29a4dcedb40940ea51323d3fbe891ae` / 354。
- 三本的使用标识仍为 `internal-pilot-only`；没有伪造对外版权或校内审查结论。

## 已完成的工作包

### WP0：契约与基线

- 冻结 PDF 物理页为唯一页码；原版模式不叠 OCR DOM；文字模式使用按物理页分组的 `normalizedText` DOM。
- 冻结 `book-package/v2`：源 PDF、raw/normalized 正文、稳定 block key、字符偏移、明确印刷页标签（未核对时为显式 `null`）、校订账本、OCR provenance、提示词、质量报告全部哈希绑定。
- 校订账本强制每条保存 `rawSha256`、页/块、原文、修订文、原因、审核人和时间。
- 发布包不复制原 OCR 记录中的本机绝对路径；只写入 allowlist 后的 provenance，并保存原始记录 SHA-256、`text-ocr-v1`、`luna-ocr-v1`与 `book-package-v2-builder-v1`。

### WP1：发布链和 book-025 质检

- 新增确定性构建器、验证器、JSON Schema、确定性分层抽样表生成器及单元测试。不消费旧 v1 的 merged response/bbox 假设。
- `book-025` 候选包自动结构校验 162/162 页通过，2,532 个 block，空 OCR 页为物理页 162，所有几何均标记为审计用途。
- 当前候选 manifest SHA-256：`f8e88aefee0025928cac23ee0157f10ba1e4b584b263d6051efa5055195d0c7f`。从同一输入重复构建后 `diff -qr` 为 0，文件字节级一致。
- 30 页分层人工抽检已完成，覆盖首尾及空页。证据在 `book-parser/work/qc/book-025/`。
- 人工结论为 `failed`：物理页 112 页文错配（源页为“战神提尔”）；123 页漏掉可见上半页；151 页“阿拉丁”与 OCR“金色的蛋”完全错配。
- 失败复核包 manifest SHA-256：`354074344995897137713ecc80ec8b9d27288d00689bf0a75340e8cd1b1cf9ce`。`--require-passed` 稳定退出 1；应用导入器稳定返回 `HUMAN_REVIEW_REQUIRED`。
- 未生成 `releases/book-025`，未将该书写入应用数据库或发布为 `published`。过程中的旧候选包以 `*-pre-provenance-hardening` / `*-pre-printed-label` 保留。

### WP2：数据库、导入和资产

- 新增迁移 `044_reader_dual_mode_pilot.sql`：版本 release/provenance/归一化元数据，页块 raw/normalized 文本，可空印刷页标签，审计几何，会话级与累计逐页覆盖表及单调触发器。
- 新增 `import:book-package-v2`：严格校验文件集、哈希、PDF.js 物理页数、raw/normalized 偏移、校订账本、provenance 与人工质量闸门；重复输入只能是完全一致的幂等结果。
- `--public-root` 必须显式提供并与运行时 `PUBLIC_ASSET_DIR` 相同，不自动选择资产目录。
- 源 PDF 通过受保护的 `/api/v1/books/assets/:assetId` 访问；需会话和 workspace 授权，支持单段 Range、`application/pdf`、私有缓存、大小完整性检查和 416 `Content-Range`。旧 `/books/*` 公开静态路径不再暴露书籍资产。

### WP3：双模式 Reader

- 共享同一个物理当前页、翻页壳、页码、进度、书签、目录、课堂同步和 AI 面板；模式切换不改变页号。
- 原版模式使用固定版本 `pdfjs-dist` 和独立 worker，从受保护资产加载 PDF，核对 PDF 页数，只渲染当前页前后两页的 canvas，不生成 text layer/OCR 叠层。
- PDF 加载、权限、页数或渲染失败均显示明确错误与重试，不自动切到文字模式。
- OCR 文字模式只输出按物理页分组的真实可选择 DOM；支持页/块/偏移锚点和跨页多段选择。

### WP4：AI 范围、可信引用与逐页覆盖

- 阅读摘要升级为 schema v2，按物理页累计 `effectiveOriginalMs` / `effectiveTextMs` / `confirmedInteractions`，与现有摘要在同一 SQLite 事务中幂等、单调持久化。没有从 `last_page_no` 推导中间已读页。
- 只有有效停留或成功的摘录/批注/书签/AI 等交互进入覆盖；本地刚选中文字不算服务端确认交互。跨页操作按自身锚点页记录。
- AI 可读页为服务端累计覆盖页与当前页的并集。`readRangeVersion` 绑定有序页集、当前页与每个覆盖记录版本；过期或伪造版本在模型调用前返回 `STALE_READ_RANGE` 409。
- 前后端只使用 `selections[] = {pageNo, blockId, startOffset, endOffset}`。旧 `selectedBlockIds` / `selectionRange` 被拒绝；客户端 quote 文本不上传为证据。
- 服务端按组织、workspace、书籍版本、可读页、block 和偏移逐段校验，再从 `normalizedText` 重建选文；跨页选择保留每段来源。

## 闸门状态

| 闸门 | 状态 | 可验证证据 |
| --- | --- | --- |
| G0 契约冻结 | 完成 | package/schema/import/migration/Reader/AI 契约及自动测试已落地 |
| G1 三书 release QC | **阻断** | book-025 的 30 页人工抽检已发现 3 个 blocking defect；无法发布 |
| G2 book-025 真实纵切 | **未通过** | 通用代码和自动 fixture 已通，但根据闸门禁止导入失败包，因此未声称真书纵切 |
| G3 book-001 / book-045 | **未开始 release/QC** | 遵循“先 book-025”的阶段顺序；未越过 G1/G2 |
| G4 外部环境 | **未验** | 未获得目标 Android 平板和对外权限结论；当前 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / 成本参数均未配置 |

## 自动验证结果

- 前端：`node --test --test-concurrency=1 tests/frontend/*.mjs` 通过，162/162。并发运行时历史生命周期用例有一次时序波动；原用例单独复跑 12/12 及串行全量均通过，未改断言。
- 服务端：`node --test tests/server/**/*.test.js` 全量通过，173/173。覆盖 044 前向迁移、受保护 Range 资产、导入拒绝、逐页覆盖、`last_page_no` 不解锁、覆盖版本变化、过期范围和跨页引用重建。
- 解析器：25 项用例中 24 通过，1 项跳过；跳过项是历史逐字几何的真实产物接受测试，因未生成该产物而由原测试明确 skip。已补齐固定 `PyMuPDF` 依赖和 Windows 中文字体路径。
- 候选包验证：162 页、所有哈希、PDF 页数、provenance 和结构通过；重复构建字节一致。失败复核包的 `--require-passed` 按预期退出 1。
- 生产构建：`vite build` 通过，生成独立 PDF worker。仍有 `vendor-icons` 和 `StudentApp` 大于 500 kB 的构建警告，未将警告冒充为失败，也未通过放宽限制消除。

## 确切剩余工作

1. 先对 `book-025` 重做逐页 OCR/页文对齐校验，至少修正已知 112、123、151 页，再对全书检查同类错位。修订必须通过带 `rawSha256` 的账本留痕。
2. 重新生成独立候选包和人工证据；只有状态 `passed`、无 blocking finding 时才可进入 `releases/book-025`。
3. 通过 G1 后，用明确的数据库、授权账号/workspace 与资产目录执行真实导入，完成 book-025 第 80 页双模式、共享进度、跨页选文 AI 和引用跳转的 G2 验收。
4. G2 通过后再对 `book-001` 与 `book-045` 执行同样的 release/QC/import/差异回归。
5. 最后在目标 Android 设备和真实模型环境执行 G4，单独记录 PDF 首开、长书内存、横屏触摸、选文问答、后文拒答和引用跳转。

当前 Go/No-Go：**No-Go，不扩展到 49 本**。原因是真实 OCR 质量闸门未过，不是双模式、数据库或 AI 契约缺少本地实现。
