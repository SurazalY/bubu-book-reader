# trusted book-package/v2 接口约定（Phase 1A 产物 → 导入器）

面向对象：T1.4 服务端导入器改造、T1.6 年级字段迁移、T1.7 服务端测试。

上游产物由 `book-parser/pipeline/build_trusted_package_v2.py` 生成，输入是
`book-parser/work/ocr-antigravity-v1/jobs/<bookId>/pages`（可信只读 OCR 文本）+ 原版 PDF +
`book-parser/catalog-default-49.json` 编目行。本文件描述的一切都能在真实产物
`book-parser/work/package-v2-trusted/book-001/` 上逐字核对（该目录被 `book-parser/.gitignore` 的 `/work/` 规则忽略，不进 Git）。

打包器只做**结构检查**（页号 1..pageCount 连续、每页恰好一个 `.txt` 或 `.blank`、PDF 存在、PDF 物理页数 == OCR 页数、PDF SHA-256 与归档 source.json 记录一致）。OCR 文本按字节原样搬运，不做任何质量判断，导入器也不需要做。

## 1. 命令行

```powershell
# 单本构建（Phase 3 批量脚本按 bookId 循环调用同一命令即可）
book-parser\.venv-win\Scripts\python.exe book-parser\pipeline\build_trusted_package_v2.py --book-id book-001 [--force]
# 默认输出 book-parser/work/package-v2-trusted/<bookId>，默认编目 book-parser/catalog-default-49.json

# 结构校验（本次已按 trusted 状态同步放宽）
book-parser\.venv-win\Scripts\python.exe book-parser\pipeline\validate_book_package_v2.py book-parser\work\package-v2-trusted\book-001
```

## 2. 包目录树

```text
book-parser/work/package-v2-trusted/book-001/
├── manifest.json                        # 包契约与全部文件哈希（导入器入口）
├── quality-report.json                  # 质量报告，trusted 状态与结构检查结论的权威副本
├── assets/
│   ├── source.pdf                       # 原版 PDF 逐字节副本（原版模式资产）
│   └── cover.jpg                        # PDF 第 1 页渲染的封面，JPEG，宽 600px
├── content/
│   ├── pages.json                       # 逐物理页正文 + 块 + 字符偏移（文字模式数据源）
│   └── corrections.json                 # 校订台账，trusted 包恒为空集合
└── provenance/
    ├── ocr-source.json                  # PDF/OCR 溯源记录（既有 book-package-ocr-source/v2 字段集）
    ├── ocr-report.json                  # 结构检查结论（既有 book-package-ocr-report/v2 字段集）
    ├── ocr-pages-index.json             # 逐页 OCR 输入文件名/类型/大小/SHA-256（新增）
    ├── ocr-prompt.md                    # 占位说明：antigravity 管线没有提示词工件
    └── trusted-baseline.json            # 新增：合成字段逐条说明 + 相对路径溯源（新增）
```

包内**不含任何本机绝对路径**（打包器在写盘前用 `assert_no_absolute_paths()` 硬断言，规则覆盖 `X:\`、`X:/`、UNC `\\`、`/Users//home//mnt//Volumes/`）。溯源只用仓库相对路径与哈希。

## 3. manifest.json（book-001 真实产物，SHA-256 已截断标注）

```json
{
  "schemaVersion": "book-package/v2",
  "bookId": "book-001",
  "versionId": "book-001-trusted-v1",
  "title": "和大人一起读·儿童歌谣",
  "grade": 1,
  "pageCount": 98,
  "source": {
    "asset": "assets/source.pdf",
    "mimeType": "application/pdf",
    "sha256": "abeacc3033…04f5 (64 hex，已截断)",
    "sizeBytes": 115394634,
    "pdfPageCount": 98
  },
  "cover": {
    "asset": "assets/cover.jpg",
    "mimeType": "image/jpeg",
    "sha256": "2fa8c8bb13…6def (64 hex，已截断)",
    "sizeBytes": 128977,
    "width": 600,
    "height": 872,
    "sourcePageNo": 1
  },
  "ocr": {
    "jobId": "book-001",
    "modelRoute": "unrecorded-antigravity-v1",
    "coordinateSystem": "none-trusted-text-baseline",
    "geometryUsage": "audit-only-estimated",
    "pipelineVersion": "ocr-antigravity-v1",
    "promptVersion": "not-applicable-trusted-baseline",
    "promptAsset": "provenance/ocr-prompt.md",
    "promptSha256": "b377385b61…106b (已截断)",
    "parserVersion": "book-package-v2-trusted-builder-v1",
    "sourceRecordSha256": "bbb025c282…dadf (已截断)",
    "reportSha256": "5d45708566…651d (已截断)"
  },
  "provenance": {
    "pagesIndex": { "path": "provenance/ocr-pages-index.json", "sha256": "c0749ecad9…27d8 (已截断)" },
    "trustedBaseline": { "path": "provenance/trusted-baseline.json", "sha256": "cf58e8695c…6637 (已截断)" }
  },
  "normalization": { "version": "raw-exact-ledger-v1", "policy": "raw-exact-unless-ledger-reviewed" },
  "content": { "path": "content/pages.json", "sha256": "78cba90fa1…b285 (已截断)" },
  "corrections": { "path": "content/corrections.json", "sha256": "ad9b711fb2…fbd5 (已截断)" },
  "quality": {
    "report": "quality-report.json",
    "sha256": "cc46060512…8a77 (已截断)",
    "status": "trusted-baseline",
    "statusNote": "OCR trusted per baseline 2026-08-17",
    "automatic": { "emptyPages": [2, 3, 14, 18, 52, 66, 76, 92, 96, 97] }
  },
  "rights": { "usage": "internal-default-catalog" }
}
```

实际文件按字典序排序、2 空格缩进、UTF-8 不转义、结尾换行；**哈希一律是文件字节的 SHA-256**，排序只是打包器约定，不是校验要求。

### 3.1 下游必读的键路径

| 数据 | 键路径 | 类型 | 说明 |
|---|---|---|---|
| 书名（落库） | `manifest.title` | string | 既有字段，位置不变 |
| **年级（落库）** | **`manifest.grade`** | integer 1..6 | **新增根级字段**，来自编目表；T1.6 写入 `book_catalog_metadata` |
| 版本 ID | `manifest.versionId` | string | `<bookId>-trusted-v1` |
| 质量状态 | `manifest.quality.status` | `"trusted-baseline"` | 与 `quality-report.json` 的 `status` 一致 |
| 状态说明 | `manifest.quality.statusNote` | string | 恒为 `OCR trusted per baseline 2026-08-17` |
| 空白页页号 | `manifest.quality.automatic.emptyPages` | integer[] | 升序物理页号；权威副本在 `quality-report.json` 的 `automatic.emptyPages`，两处必须相等（校验器已断言） |
| 封面 | `manifest.cover` | object | 登记 `asset_type='cover'` 用 |
| 原版 PDF | `manifest.source` | object | 语义与既有 v2 完全一致 |

## 4. quality-report.json（book-001 真实产物）

```json
{
  "schemaVersion": "book-package-quality/v2",
  "bookId": "book-001",
  "versionId": "book-001-trusted-v1",
  "status": "trusted-baseline",
  "statusNote": "OCR trusted per baseline 2026-08-17",
  "automatic": {
    "pageCount": 98,
    "successfulPages": 98,
    "failedPages": [],
    "emptyPages": [2, 3, 14, 18, 52, 66, 76, 92, 96, 97],
    "blankPages": [2, 3, 14, 18, 52, 66, 76, 92, 96, 97],
    "blankPageCount": 10,
    "textPageCount": 88,
    "blockCount": 260,
    "lowConfidenceBlocks": [],
    "estimatedGeometryBlocks": 0,
    "runtimeDependsOnGeometry": false,
    "confidenceSignal": "unavailable-fixed-1.0",
    "structuralChecks": {
      "pageSequenceContiguous": true,
      "exactlyOneFilePerPage": true,
      "pageFilesReadableUtf8": true,
      "pdfPresent": true,
      "pdfPageCountMatchesOcrPageCount": true,
      "sourcePdfSha256MatchesRecord": true
    }
  },
  "humanReview": {
    "performed": false,
    "reason": "OCR trusted per baseline 2026-08-17: OCR is treated as trusted input; no per-page human quality review was run."
  }
}
```

要点：

- `emptyPages` = 正文为空串的物理页；`blankPages` = 由 `.blank` 占位文件支撑的物理页。全 49 本两者相等（无空 `.txt`），契约上 `blankPages ⊆ emptyPages`。
- `failedPages` 恒 `[]`、`runtimeDependsOnGeometry` 恒 `false`、`lowConfidenceBlocks` 恒 `[]`（trusted 路径没有 confidence 信号，块 confidence 是固定哨兵 1.0，不是质量结论）。
- `humanReview` **不再是 `book-package-human-review/v1` 对象**，而是显式的"未执行"记录 `{performed:false, reason}`。导入器在 `--accept-trusted` 下不得再要求人工复核证据。

## 5. content/pages.json 与块契约

字段名、偏移语义、几何约定与既有 book-package/v2 **完全相同**（这样既有 `validateContent()` 不用改）：

```json
{
  "schemaVersion": "book-pages/v2",
  "bookId": "book-001",
  "pages": [
    {
      "pageNo": 1,
      "printedPageLabel": null,
      "width": 468,
      "height": 671,
      "rawText": "部编版\n\n快乐读书吧\n名著阅读课程化丛书·一年级\n注音版\n\n…",
      "normalizedText": "（与 rawText 完全相同）",
      "blocks": [
        {
          "blockId": "p0001-b001",
          "order": 1,
          "rawText": "部编版\n\n",
          "normalizedText": "部编版\n\n",
          "rawCharStart": 0,
          "rawCharEnd": 5,
          "charStart": 0,
          "charEnd": 5,
          "confidence": 1.0,
          "sourceGeometry": { "lineBBox": { "x": 0, "y": 0, "width": 0, "height": 0 }, "estimated": false, "usage": "audit-only" }
        }
      ]
    }
  ]
}
```

- **`rawText` == `normalizedText`**，逐页等于 `page-XXXX.txt` 的 UTF-8 原文（按字节读取，不做换行归一化；CRLF、BOM 原样保留）。全 49 本共 434 个页文件含 CR，2 个含 BOM，均按字面保留。
- **`.blank` 页**：`rawText` = `normalizedText` = `""`，`blocks` = `[]`。占位文件本身可能含 1 字节换行或 `# blank` 之类的标记（445 个占位文件里 112 个非 0 字节），按契约一律取空串。
- **分块规则**：按空行分段，每段一个 block；分隔空行归属于**前一个** block 的尾部（首段前的空行归第一个 block 的头部），因此 `"".join(blocks[].normalizedText) === page.normalizedText` 恒成立，`page.normalizedText.slice(charStart, charEnd) === block.normalizedText` 恒成立。单元测试 `test_block_offsets_slice_back_out_of_the_normalized_text` 与 `test_split_blocks_is_lossless_for_blank_line_layouts` 覆盖这两条。
- **偏移单位是 UTF-16 码元（JS `String.length` / `String.prototype.slice` 的单位）**，不是 Python 码位。trusted 包里 `charStart/charEnd` 与 `rawCharStart/rawCharEnd` 数值相同（没有校订）。
  - 为什么必须是 UTF-16：导入器、服务端选文重建、浏览器选区锚点全部按 UTF-16 计数。全库有 1 处非 BMP 字符（book-028 的 `page-0123.txt` / `page-0124.txt` 含 U+2A248，共 3 次）：该页 434 个码位 = 436 个 UTF-16 码元，包里记录 436，与导入器 `block.rawText.length` 一致。若按码位记录，book-028 导入会直接被既有偏移断言拒绝。
  - 导入器沿用既有偏移断言即可，**不需要改**；`book-parser/pipeline/validate_book_package_v2.py` 的偏移断言已同步改成 UTF-16 计数（原先用 Python `len()`，在非 BMP 字符上与导入器不一致）。
- **`printedPageLabel` 全部显式 `null`**（键必须存在，不是省略）。
- **几何 audit-only**：`lineBBox` 全零、`estimated: false`、`usage: "audit-only"`；导入器继续把运行时坐标写 0（既有行为）。
- **`blockId` 用 3 位块序号**（`p0001-b001`）。这是既有导入器 `validateContent()` 与 `validate_book_package_v2.py` 强制的锚点格式，也支持每页 >99 块；简报里写的 `p0007-b02`（2 位）与现有消费者不兼容，因此**未采用**，见 §10 待裁决项。
- `page.width/height` 是**源 PDF 的物理页尺寸（PDF 点）**，仅作审计参考（既有领域层要求 > 0）；运行时不依赖。

`content/corrections.json` 恒为空账本：

```json
{ "schemaVersion": "ocr-corrections/v1", "bookId": "book-001", "normalizationVersion": "raw-exact-ledger-v1", "corrections": [] }
```

## 6. 封面

- 路径 `assets/cover.jpg`，MIME `image/jpeg`，来源：源 PDF **第 1 页**，PyMuPDF 渲染，缩放到宽 600px（`jpg_quality=85`）。
- book-001 实测 600×872、128,977 字节。
- 下游需登记为 `book_assets.asset_type='cover'`，`storage_key` 用相对键（建议与 `source_pdf` 同目录，例如 `books/pilot/<bookId>/<versionId>/cover.jpg`），`size_bytes`/`sha256`/`width`/`height` 直接取 `manifest.cover`。公开 `/books/*` 继续 404，封面只经受保护资产接口供给。

## 7. provenance 结构

| 文件 | schemaVersion | 作用 |
|---|---|---|
| `ocr-source.json` | `book-package-ocr-source/v2` | 字段集与既有 v2 **一字不差**：`schemaVersion, jobId, sourceSha256, pageCount, renderDpi, modelRoute, pipelineVersion, createdAt, originalRecordSha256`。`originalRecordSha256` = 归档 `text-ocr-v1/jobs/<bookId>/source.json` 文件哈希 |
| `ocr-report.json` | `book-package-ocr-report/v2` | 字段集与既有 v2 一字不差；`validation` 装的是本次**结构检查**结论（6 项全 true），`originalReportSha256` = `ocr-pages-index.json` 的哈希（trusted 路径没有管线 report） |
| `ocr-pages-index.json` | `book-package-ocr-pages-index/v1` | 新增。`pages[]` 每项 `{pageNo, file, kind:"text"\|"blank", sizeBytes, sha256}`，是 OCR 输入的逐页身份证明；`jobRelativePath` 为仓库相对路径 |
| `trusted-baseline.json` | `book-package-trusted-baseline/v1` | 新增。逐条列出**合成字段**及其原因（`modelRoute`/`coordinateSystem`/`promptVersion`/`renderDpi`/时间戳/`confidence`/空白页语义），并记录源 PDF 相对根+相对路径、归档 source.json 相对路径与字段别名 |
| `ocr-prompt.md` | — | 占位说明文件：antigravity 管线没有提示词工件，但 v2 契约要求该文件存在且被哈希 |

合成值一览（全 49 本相同常量）：

| 字段 | 值 | 原因 |
|---|---|---|
| `ocr.modelRoute` | `unrecorded-antigravity-v1` | antigravity job 目录只有 `pages/`，无模型元数据；这是显式哨兵，不是模型声明 |
| `ocr.coordinateSystem` | `none-trusted-text-baseline` | 没有几何 |
| `ocr.promptVersion` | `not-applicable-trusted-baseline` | 没有提示词 |
| `ocr.renderDpi` | 归档 source.json 的 `renderDpi/dpi/render.dpi`（全 49 本均 200） | 同一 PDF 的既有渲染记录 |
| `createdAt` / `completedAt` | `2026-08-17T00:00:00+08:00` | 固定基线时刻，不是 OCR 运行时间；用常量而非 `now()` 才能保证幂等构建 |

## 8. 确定性构建

同一输入重复构建产出**字节一致**的包：JSON 全部走 `write_canonical_json`（字典序、2 空格、UTF-8、结尾换行），页顺序与块顺序由物理页号/段序决定，全部时间戳来自上述常量。已验证：

- 合成 fixture：`test_repeated_build_is_byte_identical`
- 真书 book-001：两次构建 11 个文件 SHA-256 全部相同（含 110MB PDF 与封面 JPEG）

注意：封面 JPEG 字节依赖 PyMuPDF 版本（当前 1.28.0，见 `book-parser/requirements.txt`），换版本重打包会改变 `cover.sha256` 与 `manifest.sha256`；同版本内幂等。

## 9. 对既有契约的改动（只增不删）

`book-parser/schemas/book-package-v2.schema.json`：

| 改动 | 类型 |
|---|---|
| 根级新增可选 `grade`（integer 1..6）、`cover`、`provenance` | 增 |
| `allOf/if-then`：当 `quality.status == "trusted-baseline"` 时，要求 `grade`/`cover`/`provenance` 三者存在 | 增 |
| `quality.status` 枚举增加 `"trusted-baseline"` | 增（原三值保留） |
| `quality` 新增可选 `statusNote`、`automatic.emptyPages` | 增 |
| `rights.usage` 由 `const "internal-pilot-only"` 改为 `enum ["internal-pilot-only","internal-default-catalog"]` | 增（原值保留） |

证据（`jsonschema` Draft202012 实测）：schema 自身合法；trusted manifest 0 错；把 `grade/cover/provenance` 去掉并改回 `status:"passed"` + `rights:"internal-pilot-only"` 的**旧版 manifest 仍然 0 错**；trusted manifest 缺 `grade` 时被拒（`'grade' is a required property`）。

`book-parser/pipeline/validate_book_package_v2.py` 同步放宽（旧包行为不变）：接受上述新增字段与 `trusted-baseline` 状态、两种 rights；trusted 包额外校验 `statusNote`、`quality.automatic.emptyPages` 与报告镜像一致、`blankPages ⊆ emptyPages`、封面文件哈希/尺寸、两个新 provenance 文件哈希。`--require-passed` 语义未变（trusted 包在该模式下仍被判为"未过人工复核"）。另有一处**修正**：块偏移断言从 Python 码位改为 UTF-16 码元，与导入器一致（BMP 范围内两者等价，旧包不受影响）。

> 注：既有 `book-parser/pipeline/book_package_v2.py` 的 `normalize_ocr_page()`（text-ocr-v1 旧路径）仍用 Python `len()` 算偏移，若将来用它打包含非 BMP 字符的书会与导入器不一致。trusted 路径不经过该函数，本轮未改动它。

## 10. T1.4 需要做的放宽（已实测确认足够）

用 `tmp/probe-importer.mjs`（一次性探针，把真实 `server/db/import-book-package-v2.js` 复制到同目录打补丁后运行再删除，从不改原文件）验证：**只做以下 5 处放宽，真实 book-001 trusted 包就能被 `loadBookPackageV2()` 完整接受**（98 页 / 260 块 / 哈希 / pdfjs 物理页数 / 偏移 / 空账本全部通过，`blockCoordinatesAllZero: true`、`printedPageLabelsAllNull: true`）。

1. manifest 顶层字段校验放开 `'grade', 'cover', 'provenance'` 三项。**注意不能直接塞进 `MANIFEST_FIELDS`**：`exactFields()` 是精确集合相等比较，直接加会让只有 12 个字段的旧 `passed` 包因"12 ≠ 15"被拒绝（本节的探针只跑了 trusted 包，没覆盖到这个回归）。T1.4 实际采用的是"必填集 + 可选集"（`boundedFields(manifest, 必填 12 项, 可选 3 项)`），并要求 `quality.status === 'trusted-baseline'` 时这 3 项必须齐备，与 schema 的 `if-then` 一致。
2. `manifest.rights.usage` 接受 `internal-default-catalog`（保留 `internal-pilot-only`）。
3. `manifest.ocr.pipelineVersion` 接受 `ocr-antigravity-v1`（保留 `text-ocr-v1`）。
4. `manifest.ocr.parserVersion` 接受 `book-package-v2-trusted-builder-v1`（保留 `book-package-v2-builder-v1`）。
5. `validateQuality()`：`--accept-trusted` 且 manifest 与报告的 `status` 均为 `trusted-baseline` 时，只校验 `schemaVersion/bookId/versionId/automatic.pageCount/automatic.failedPages/runtimeDependsOnGeometry`，**跳过 `humanReview` 闸门**；不带开关时必须仍然抛 `HUMAN_REVIEW_REQUIRED`。

另外 T1.4/T1.5 还需注意（本次未验证，属下游范围）：

- 幂等重导入分支里 `existing.package_quality_status === 'passed'` 的比较需要接受 `trusted-baseline`，否则同包重复导入会被判"与待导入 release 不一致"。
- `book_versions.package_quality_status` 写真实状态 `trusted-baseline`；`publishBook()`（T1.5）需接受该状态。
- 封面资产登记是新增行为：`asset_type='cover'`，`mimeType/sizeBytes/sha256/width/height` 取 `manifest.cover`，落盘到 `--public-root` 下的相对 `storage_key`。

## 11. 给服务端测试用的最小合成 trusted 包

**方式 A（推荐，纯 JS，无 Python 依赖）**：直接改造 `tests/server/db/book-package-v2-import.test.js` 里既有的 `createPackage()`。相对既有 fixture 的最小差异：

1. 新增文件 `assets/cover.jpg`（内容可以是任意非空字节，例如 `Buffer.from('\xff\xd8\xff\xd9', 'binary')`，导入器不解码 JPEG），并加入 `files` map 以便取哈希。
2. 新增 `provenance/ocr-pages-index.json`、`provenance/trusted-baseline.json`（内容可极简，导入器只校验哈希；建议至少带 `schemaVersion`/`bookId`）。
3. manifest 增加：
   - `grade: 3`
   - `cover: { asset:'assets/cover.jpg', mimeType:'image/jpeg', sha256: sha256(coverBytes), sizeBytes: coverBytes.length, width: 600, height: 872, sourcePageNo: 1 }`
   - `provenance: { pagesIndex:{path:'provenance/ocr-pages-index.json', sha256:…}, trustedBaseline:{path:'provenance/trusted-baseline.json', sha256:…} }`
4. manifest 改：`ocr.pipelineVersion='ocr-antigravity-v1'`、`ocr.parserVersion='book-package-v2-trusted-builder-v1'`、`rights.usage='internal-default-catalog'`、
   `quality={ report:'quality-report.json', sha256:…, status:'trusted-baseline', statusNote:'OCR trusted per baseline 2026-08-17', automatic:{ emptyPages:[] } }`。
5. `quality-report.json` 改：`status:'trusted-baseline'`、`statusNote` 同上、`automatic` 增加 `blankPages/blankPageCount/textPageCount/confidenceSignal/structuralChecks`、`humanReview` 换成 `{ performed:false, reason:'…' }`。
6. `content/pages.json` 里让 `rawText === normalizedText`、`confidence: 1.0`、`lineBBox` 全零，`corrections.corrections = []`（trusted 包没有校订记录）。
7. 沿用既有 `loadBookPackageV2(root, { pdfPageCount: async () => 1 })` 注入，避免造真 PDF。

拒绝路径测试（结构损坏仍必须拒绝）沿用既有做法即可：改 `content/pages.json` 页号造缺号、改哈希、让 `pdfPageCount` 返回别的数字。

**方式 B（用真打包器产出真包）**：照 `book-parser/tests/test_trusted_package_v2.py` 的 `TrustedFixture` 造一个临时工作区（`jobs/<bookId>/pages/page-0001.txt…`、PyMuPDF 生成的小 PDF、单行编目 JSON），调用 `build(catalog, bookId, output, root)`。适合需要"真实字节包"的场景（例如端到端脚本验证），成本是要跑 Python 环境。

## 12. 编目文件 `book-parser/catalog-default-49.json`

打包器唯一的书目输入，由 `book-parser/pipeline/generate_trusted_catalog.py` 生成（书名/年级逐行取自 01 文档 §5）。每行字段：

```json
{
  "bookId": "book-001",
  "title": "和大人一起读·儿童歌谣",
  "grade": 1,
  "versionId": "book-001-trusted-v1",
  "sourcePdfRelativePath": "快乐读书吧1-6年级阅读全本/快乐读书吧1年级/快乐读书吧部编版一年级和大人一起读 儿童歌谣 .pdf",
  "pageCount": 98,
  "textPageCount": 88,
  "blankPageCount": 10,
  "recordedPdfPageCount": 98,
  "recordedPdfSha256": "abeacc3033…04f5",
  "renderDpi": 200,
  "sourceRecordRelativePath": "device-migration-20260815/verification-extract/core-final/book-parser/work/text-ocr-v1/jobs/book-001/source.json",
  "sourceRecordSha256": "1920c1fcf9…d0ac",
  "sourceRecordFieldAliases": { "pdfPath": "sourcePdf", "pdfSha256": "sourceSha256", "pageCount": "pageCount", "renderDpi": "dpi" }
}
```

`sourcePdfRelativePath` 相对 `pdfRoot`（`device-migration-20260815/verification-extract/source/book-parser/input`），**保留尾随空格与原始错字**（49/49 文件名都有尾随空格；book-038 用错字文件名"列那狐的古诗"，落库书名是"列那狐的故事"）。
