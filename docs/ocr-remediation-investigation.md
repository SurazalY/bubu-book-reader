# 三书试点 OCR 根因调查与修复决策报告

> 调查日期：2026-08-15  
> 调查对象：`book-025` 主调查；`book-001`、`book-045` 轻量横向检查  
> 边界：只读核查；未修改产品代码、OCR 原始账本或源 PDF，未启动任何 OCR 任务  
> 结论状态：可用于决定修复范围；尚不能据此把任何书标记为 OCR 质检通过

## 1. 决策摘要

### 1.1 结论

1. **当前 G1/G2 的主要卡点确实是 OCR 内容链，而且主因不是普通错别字，而是 `text-ocr-v1` 原始账本中的页级关联失真。** `book-025` 至少有三个独立批次出现整页错配、页内容重复或同一源页被近重复识别到不同目标页的信号。
2. **不能通过一个全局 `+1/-1` 页码偏移修好。** 异常在批次内表现为丢页、重复、错配和疑似多页内容合并，批次之间又会重新对齐；直接重映射会制造新的错页。
3. **源 PDF、当前渲染清单和 `book-package/v2` 构建器不是主要根因。** 源 PDF 的 162 个主页面图像哈希全部不同；渲染清单保持 `pageNo N -> page-N.png`；v2 构建器逐文件直拷页号。候选包的 162 页 `rawText` 与 `normalizedText` 均逐字等于对应 OCR JSON，校订账本为 0 条。
4. **高置信根因位于“发送给模型的页面/批次 -> 模型响应 -> 目标页 JSON”这一段。** 现有归档没有逐请求输入图片哈希、request/response ID、批次位置或原始模型响应，且迁移时排除了原 render PNG 和旧 Luna 线程，因此无法再区分是输入选错、模型在多图批次中漏/并页，还是落盘时按错误位置关联；但这些都属于同一个上游页绑定故障域。
5. **不建议现在重跑三本或 49 本。推荐先把 `book-025` 全书 162 页用可审计的逐页绑定流程重跑一次。** 对 `book-001`、`book-045` 先做相同的页图对齐抽检和空页复核；只有它们也出现整页错配/重复，才按书升级为全书重跑。

### 1.2 置信度

| 判断 | 置信度 | 依据 |
| --- | ---: | --- |
| `book-025` 存在批次级页绑定故障 | 高（约 95%） | 三个写入批次内均有错页和重复/近重复；源页图彼此不同 |
| `normalizedText` 或 v2 构建器制造了错页 | 极低（< 1%） | 162/162 页 raw/normalized 与原 OCR 逐字一致；corrections 为 0 |
| 源 PDF 自身重复/乱页 | 极低（< 1%） | PDF SHA 固定、162 页主图 SHA-256 全部唯一 |
| 渲染程序发生统一 off-by-one | 低（< 10%） | 代码用 `load_page(page_no - 1)`；manifest 连续正确；但当时发给模型的 PNG 已被排除，不能做字节级终证 |
| 需要三本全部重跑 | 目前证据不足 | 另外两书未发现完全重复文本，但尚未完成源页人工对齐质检 |

## 2. 调查范围和权威输入

本调查以以下文件为主依据：

- [三书试点计划](/mnt/d/project/整书8.15/docs/reader-dual-mode-pilot-plan.md)
- [试点实施与验收记录](/mnt/d/project/整书8.15/docs/reader-dual-mode-pilot-implementation.md)
- [book-025 人工抽检账本](/mnt/d/project/整书8.15/book-parser/work/qc/book-025/human-review.json)
- [book-025 OCR source](/mnt/d/project/整书8.15/book-parser/work/text-ocr-v1/jobs/book-025/source.json)
- [book-025 OCR report](/mnt/d/project/整书8.15/book-parser/work/text-ocr-v1/jobs/book-025/report.json)
- [book-025 render manifest](/mnt/d/project/整书8.15/book-parser/work/text-ocr-v1/jobs/book-025/render/render-manifest.json)
- [v2 构建器](/mnt/d/project/整书8.15/book-parser/pipeline/build_book_package_v2.py) 与 [页规范化逻辑](/mnt/d/project/整书8.15/book-parser/pipeline/book_package_v2.py)
- [迁移说明](/mnt/d/project/整书8.15/device-migration-20260815/MIGRATION_README.md)

冻结的 `book-025` 源 PDF：

- SHA-256：`5c419590e69f1d00d276acd16e157bdb0c8f3e2fc0d25183484cdf65faced6cd`
- 页数：162
- OCR source SHA-256：`a178fb710416853d21eb04a826004e47db4f58151b9e75fad9feb453b7760fd9`
- OCR report SHA-256：`ce0d1caf5509db87130ae1833e645b5f62ccc6f0739894befb74a44e644bae64`
- render manifest SHA-256：`fb047ab13b9e75bb7b7183aa2d32f348afa6eb21e1b2008f3a2abfd15559aec9`
- 当前失败复核包 manifest SHA-256：`354074344995897137713ecc80ec8b9d27288d00689bf0a75340e8cd1b1cf9ce`

## 3. 端到端页链追踪

### 3.1 源 PDF：已验证不是重复页或源文件换包

用 `pypdf` 读取冻结 PDF，每页选择最大嵌入图并计算 SHA-256：

- 162/162 页都有主页面图像；
- 162 个主页面图像 SHA-256 全部唯一；
- 111、112、113、117、118、121、126、150、151、153、157 等异常相关源页的主图哈希均不同；
- PDF 自身 SHA 与 `source.json`、`report.json`、`pilot-books.json` 一致。

因此，OCR 117/118、121/126、153/157 等重复文本不能由“源 PDF 本来就是重复页”解释。

### 3.2 PDF 页 -> 渲染页图：清单和代码映射正确，但原始输入图未归档

[render_pages.py](/mnt/d/project/整书8.15/book-parser/pipeline/render_pages.py) 对物理页 `page_no` 调用 `document.load_page(page_no - 1)`，输出 `page-{page_no:04d}.png`。现有 manifest：

- `pageCount = 162`，共 162 个连续条目；
- 例如物理 111、112、123、151 页分别登记为 `page-0111.png`、`page-0112.png`、`page-0123.png`、`page-0151.png`；
- 这些页在 manifest 中的内嵌 `pageNo` 与数组位置一致。

现有 QC 源页由冻结 PDF 重新渲染，页码和视觉内容正确。迁移说明明确表示 OCR job 的 `render/` PNG 被排除、需要时可重建。因此：

- **已验证**：当前源 PDF、渲染代码和 render manifest 没有 off-by-one；
- **未知**：2026-08-15 当时实际提交给 Luna 的每一张 PNG 是否就是 manifest 所指图片，因为缺少当时 PNG hash/请求记录。

### 3.3 渲染页图/批次 -> OCR 原始页 JSON：故障已在这里出现

#### 物理页 112

- 现有源页证据显示 PDF 112 是标题“战神提尔”的起始页。
- OCR `pages/0111.json` 却从“战神提尔”开始，并继续包含源后页内容；SHA-256 为 `f96c6ebe3b183ed631f7e77faeb0d5d5d584c92f53b05bd90871dafe6673866d`。
- OCR `pages/0112.json` 从“其他的天神可犯起了嘀咕”开始，已经是后续内容；SHA-256 为 `472d080c66c0bc8f521310711d6cfd94e88dd2904a7450f1fb5befedeb33a0c5`。
- 同一写入批次 109-118 内，OCR 117 与 118 的整页拼接文本完全相同，而源 PDF 117/118 主图不同。

结论：这不是 OCR 112 页的几个错字，而是批次内页内容前移/合并/重复。

#### 物理页 123

- 独立复看现有源页图，PDF 123 是“鸦神/鹰神”讨论河流、鲑鱼和生命秩序的页面。
- OCR `pages/0123.json` 却从“怪物的心脏周围有很多脂肪”开始，属于凯欧蒂故事；SHA-256 为 `2d669d05c51b9b9bdfde8fbbe37b1cc23cbbeb5cc85bfeb34e96ecec434ddbda`。
- 因此原人工账本中的“漏掉上半页”应升级理解为**整页来源错配**，不是单纯截断。
- 同一写入批次 119-128 内：121 与 126 的 OCR payload 在忽略 `pageNo` 后完全相同；122 与 127 的拼接文本相似度为 0.892。

结论：123 页不能靠人工补半页修复；必须重新建立该批次的源页绑定。

#### 物理页 151

- PDF 151 明确是阿拉丁和神灯故事，页内可见“阿拉丁”“戒指神”“旧油灯换新油灯”等情节。
- OCR `pages/0151.json` 却以“金色的蛋”开头，属于“梵天创世”；SHA-256 为 `176dd4f7c93321f419c811dac14f4212a0cb51d2c1ef96ca1816d2fd19599e14`。
- 同一原写入批次 149-158 中，153 与 157 的 OCR payload 在忽略 `pageNo` 后完全相同；154 与 158 的拼接文本相似度为 0.940。
- 文件时间显示 149-151、153-158 在 `02:54:08` 同批写入，而 152 在 `02:56:32` 被单独重写；现有归档没有保留 152 的旧版本或重试原因。

结论：该批次发生过局部返工，但未把同批的 150/151 和重复页一并清理，不能把当前账本视为完整复验后的结果。

### 3.4 OCR JSON -> book-package/v2：逐页直拷，没有二次错配

构建器按 `for page_no in range(1, expected_pages + 1)` 打开 `pages/{page_no:04d}.json`，并要求文件内 `pageNo == expected_page_no`。对当前候选包做 162 页逐项比较：

- `package.rawText == ''.join(ocr.blocks[].text)`：162/162；
- `package.normalizedText == package.rawText`：162/162；
- block 顺序文本：162/162 一致；
- `content/corrections.json`：0 条 correction；
- 映射或文本差异：0。

候选 `content/pages.json` SHA-256 为 `b82e25f40eeff7a3a2c46957ced2149ad732b22d260b8bb74c9ffa341263c917`，corrections SHA-256 为 `f7530798bf2db73d36a1f4bb4fc316082562fbedaad48376e48938fb1c3c4768`。

因此，`normalizedText` 处理和 v2 发布构建只忠实地传播了上游错页，没有制造或隐藏它。

## 4. 全书可检测信号

### 4.1 book-025 的 162 页只读扫描

拼接每页全部 block 文本后，检测到：

| 类型 | 页对/页号 | 证据 |
| --- | --- | --- |
| 完全重复文本 | 117 / 118 | 470 字，SHA-256 均为 `cb78576baede78b2b1e9a0c236012cb206547e4353c340dce0f34fb9d4360632` |
| 完全重复 payload（忽略 pageNo） | 121 / 126 | 216 字；所有其他 JSON 字段一致 |
| 高度近重复文本 | 122 / 127 | `SequenceMatcher` 相似度 0.892 |
| 完全重复 payload（忽略 pageNo） | 153 / 157 | 442 字；所有其他 JSON 字段一致 |
| 高度近重复文本 | 154 / 158 | 相似度 0.940 |
| 空 OCR | 162 | 0 block；已被现有 QC 列为必审页 |

这些重复分别落在三个不同写入批次：

| 文件修改时间（Asia/Shanghai） | 同时写入页 | 已确认信号 |
| --- | --- | --- |
| `2026-08-15 02:28:50` | 109-118 | 112 错页；117/118 完全重复文本 |
| `2026-08-15 02:34:50` | 119-128 | 123 错页；121/126 完全复制；122/127 近重复 |
| `2026-08-15 02:54:08` | 149-151、153-158 | 151 错页；153/157 完全复制；154/158 近重复；152 稍后单独重写 |

这使“批次输入/输出关联错误”比“模型恰好在三个无关页面上识别出完全相同正文”合理得多。这里列的是自动扫描能证明的**下界**；没有重复文本的页面仍可能错配到唯一内容。

长度异常不能可靠发现这些问题：123 页有 485 字、151 页有 613 字，都不是短页。因此不能用“非空、长度正常、confidence 高”替代页图对齐。

### 4.2 原 OCR 成功报告为何没有拦住问题

`book-025/report.json` 的验证项覆盖：源 SHA、源页数、render 数、page file 连续唯一、JSON、尺寸、bbox 边界和 progress 一致性。它没有验证：

- 目标页 JSON 是否来自同号输入图片；
- OCR 文本是否与源页视觉内容一致；
- 不同源页是否产生重复/近重复响应；
- 模型是否在多图输入中漏图、合页或交换顺序。

此外，三书 OCR 页文件根级字段统一只有 `pageNo/status/width/height/blocks/attempts/failureReason`，没有 input image SHA、request ID、response ID、batch ID、batch position 或原始响应 SHA。`completedPages=162` 只说明每个目标文件都存在且标记为 `ok`，不证明内容绑定正确。

### 4.3 book-001 / book-045 轻量横向检查

| 书 | 页数 | 非空完全重复文本组 | 空 OCR 页 | 当前能下的结论 |
| --- | ---: | ---: | ---: | --- |
| book-001 | 98 | 0 | 10 | 未见 book-025 同级完全重复信号；空页需逐页判断是插图还是漏识别 |
| book-025 | 162 | 3 | 1 | 已确认批次级错配；当前 job 不可信 |
| book-045 | 354 | 0 | 16 | 未见完全重复信号；长书尚未做源页对齐抽检，不能据此判定通过 |

另有一个非 OCR 识别质量但会阻塞 G3 的事实：`book-package/v2` 当前要求 source/report 使用 `renderDpi`、`status=complete`、`terminalPageCount` 等字段。`book-001` 使用 `dpi`、嵌套 `render` 且 report 无 `status`；`book-045` 的 source 使用嵌套 `render.dpi`。所以两书在开始 v2 构建前还需做**显式、可审计的 provenance 记录迁移**；这不需要重跑 OCR，也不应以宽泛兼容分支绕过。

## 5. 根因分类

| 候选根因 | 判定 | 证据与限制 |
| --- | --- | --- |
| 源 PDF 损坏、重复页或换包 | 排除 | SHA 固定；页数 162；162 个主页面图像全部唯一 |
| render 脚本统一错一页 | 基本排除 | 代码和 manifest 都是严格 1-based -> 0-based 映射；QC 重渲染正确 |
| 当时提交了错误图片/错误批次顺序 | 高可能 | 错页和重复集中于共同写入批次；缺少 input image hash 无法终证 |
| 模型多图响应漏页、并页或顺序漂移 | 高可能 | 111 目标页包含后续页内容，批次内出现重复/近重复；无原始响应不能与落盘阶段分离 |
| 响应落盘按数组位置错误关联 | 高可能 | 完整 payload 被复制到不同 pageNo；同批次重排特征明显；缺少 runner/批次账本不能终证 |
| 单页 OCR 模型识别错误/漏字 | 次要但存在 | 会解释局部漏字、错字；不能解释整页阿拉丁 -> 梵天或不同源图的完全相同 payload |
| 响应截断 | 未排除但不是主因 | 可解释局部遗漏，不能解释完整错页和复制；123 独立复核为整页错配 |
| normalizedText 处理 | 排除 | corrections=0；162/162 raw == normalized |
| book-package/v2 页码映射 | 排除 | 构建器严格按同号文件直拷；逐页比较无差异 |

**根因表述建议**：`text-ocr-v1` 缺乏加密绑定和可追溯请求账本，导致多页批次的图像/响应/目标页关联发生故障且结构校验无法发现。不要把根因笼统写成“Luna 识别率不够”，那会误导修复方向。

## 6. Gemini 3.7 Flash High 深度交叉验证

本轮另通过 `agy` CLI 的 `gemini-3.7-flash-high` 调用了 3 个只读子 agent，分别审计：

1. `book-025` 已知坏页及相邻页的视觉证据；
2. `book-001`、`book-025`、`book-045` 的重复、空页、短页等统计信号；
3. 历史 OCR 流水线、raw ledger、`normalizedText` 和 `book-package/v2` 打包链。

Gemini 审计没有修改工作区，也没有启动 OCR。它的作用是对本报告的证据链和决策方向做独立交叉检查，不替代本地文件、哈希和视觉证据。

### 6.1 共识与分歧

| 议题 | Gemini 交叉结果 | 本报告判定 |
| --- | --- | --- |
| 损坏发生在哪一层 | raw OCR / ledger 阶段已经损坏 | **采纳**；与原始页 JSON 已错、v2 逐页直拷的本地证据一致 |
| v2 打包和 normalizedText 是否为主因 | 基本排除 | **采纳**；本地已验证 162/162 页 `raw == normalized == 对应 OCR`，corrections=0 |
| book-025 修复范围 | 多处整页错配/重复，不能只修 112、123、151 | **采纳**；三个批次的完全/近重复 payload 提供更强下界证据 |
| 推荐处理 | 建立可审计 page-bound runner 后整本重跑 book-025 | **采纳**；与方案 B 一致 |
| 是否立即重跑三书/49 本 | 不应立即扩大 | **采纳**；另外两书仍应先按书审计 |
| 产品路线 | PDF + OCR 文字双模式不变 | **采纳**；问题属于内容生产链，不推翻 Reader 架构 |
| 将异常归因于模型注意力机制或幻觉 | Gemini 有此倾向 | **不采纳为根因结论**；现有证据无法区分输入选图、模型多图输出和落盘关联 |
| `1 小时`、`10-15 分钟模型处理` | Gemini 给出过快估算 | **不采纳**；没有本地吞吐、队列、限流、复核速度或成本测量 |
| `95%` 置信度 | Gemini 给出数字化表述 | **不采用该数字作为交叉审计证据**；报告中的置信区间是对本地证据强弱的判断，不是统计测量结果 |
| `15 字跨页阈值`、`50 字短页阈值` | Gemini 建议固定阈值 | **不采纳**；书内标题、插图页、短童谣会产生合法短页，跨页连续长度也未建立标注集 |
| OCR 是“唯一”卡点 | Gemini 有绝对化表述 | **不采纳**；OCR 是当前 G1/G2 的主要卡点，后续仍有 provenance 迁移、真机、权限和真实模型验收 |

### 6.2 交叉验证后的证据优先级

最终判断继续以本地可复现证据为准：

1. 源 PDF 162 个主页面图像 SHA-256 全部唯一；
2. 109-118、119-128、149-158 三个批次均出现错页和完全/近重复 payload；
3. 当前 OCR 页账本没有 input image SHA、request/response ID、batch position 或原始响应 SHA；
4. v2 包逐页忠实传播原 OCR，未发生 normalizedText 改写或二次换页；
5. 原 render PNG 和旧模型线程未归档，因此不能把具体故障武断归结为某一种模型内部机制。

交叉验证增强了方案 B 的方向性信心，但没有提供足以替代本地测量的新工期、性能阈值或质量阈值。后续 runner 的告警阈值应基于三书标注样本校准；在校准前，完全重复 payload、同一 response SHA 多页复用、缺页绑定字段等确定性条件可以直接作为失败闸门，模糊的“短页/跨页”指标只能用于提示人工复核。

## 7. 三档处理方案

### 方案 A：最小修复（仅供内部纵切快速恢复）

工作内容：

1. 把三个已证实异常的原批次视为整体污染范围：109-128、149-158，共 30 页；不只修 112、123、151 三页。
2. 用新的页绑定记录重新 OCR 这 30 页；每页记录源 PDF SHA、物理页、render image SHA、请求/响应标识、模型/提示词、输出 SHA。
3. 30 页全部做源图/OCR 人工对齐，再对其余 132 页重新做分层抽样和重复/近重复扫描。
4. 生成新的 raw job/version，旧 job 只读保留；通过 correction/release 账本发布，不原地覆盖旧 raw。

量级：约 **0.5-1.5 人日 + 30 页模型调用**，不含排队和外部审批。

风险：自动信号只能发现污染下界；其他批次可能存在“错到唯一内容、没有重复”的静默错配。适合尽快恢复内部 G2 演示，不足以给出高置信全书内容质量结论。

升级到方案 B 的客观触发：

- 在异常批次之外再发现 1 个整页错配/重复来源；或
- 新抽样中出现 1 个 blocking 页关联 finding；或
- 需要对 book-025 作正式可发布/可规模化质量结论。

现有证据已经跨三个独立批次并暴露 provenance 缺口，因此本报告**不推荐**把方案 A 当作最终方案。

### 方案 B：推荐方案（book-025 全书重跑，另外两书先审后跑）

工作内容：

1. 先建立可复现的 page-bound OCR runner：默认一请求一物理页；若必须批量，响应必须携带并校验不可伪造的页键，不能按返回数组位置落盘。
2. 对 `book-025` 162 页全部重新 OCR 到新 job/version；每页保存 render SHA、请求/响应 SHA/ID、attempt、模型、提示词版本和源页键。
3. 新旧文本只用于差异定位；旧文本不作为页绑定真值。对 162 页做一次快速全页“来源相符/不相符”对齐，另做不少于 30 页的段落级准确率抽检，并逐页复核空页/低置信页。
4. 为 `book-001`、`book-045` 迁移规范化 provenance 记录，分别做 30 页分层源页抽样、全部空 OCR 页核对、重复/近重复扫描；只对失败的书升级重跑。
5. 新 release 通过 G1 后再继续真实导入和 G2；旧失败候选包继续保持不可发布。

量级：约 **2-4 人日 + 162 页模型调用**；其中包含 runner/账本、全页快速对齐、抽样复核和重新打包，不含真机/真实 AI 业务验收。

优点：直接消除 book-025 当前不可审计的底座，同时把“是否重跑另外两本”变成证据驱动的按书决策。对三书试点的成本/风险比最好。

### 方案 C：三书 OCR 全量重做

工作内容：

1. 用方案 B 的新 runner 对三书 614 页全部重跑成新 job/version。
2. 每书做全页来源对齐、30 页以上段落级抽检、所有空页/低置信页复核；book-001 额外审拼音/插图/短行页面。
3. 三书分别建 release，任何一本失败只阻断该书，不用“整体成功率”掩盖单书 blocking defect。

量级：约 **4-8 人日 + 614 页模型调用**，主要变量是 book-001 拼音页和 book-045 长书人工复核速度。

进入方案 C 的客观触发：

- `book-001` 或 `book-045` 的任一 30 页抽样出现 1 个整页错配、跨页串入或不同源页重复 payload；对该书立即升级全书重跑；
- 两书都触发，或找到证据证明同一无绑定批次 runner 被共同用于三书，则三书整体采用方案 C；
- 仅有零散错字/标点错误而页绑定正确时，不触发全书重跑，走可追溯 normalized correction。

**不建议此时把方案 C 扩为 49 本/8,602 页。** 应先让三书的新 page-bound 流程和质量阈值稳定，再按 46 本抽样结果决定；否则只是用更大成本重复同一不可审计流程。

## 8. 建议的质量闸门

新的 OCR job 至少应满足：

1. 每页保存并校验 `{sourcePdfSha256, physicalPageNo, renderSha256, requestId/responseId 或原始响应 SHA, modelRoute, promptSha256, outputSha256}`。
2. 目标 `pageNo` 从请求页键取得，不从返回数组下标或任务完成顺序推断。
3. 每个请求只允许写自己的临时页文件，校验后原子归档；重试产生新 attempt，不能静默覆盖前一版本。
4. 自动闸门新增：跨页完全/近重复检测、异常文本长度、相邻页语义断裂提示、同一响应 SHA 被多个页引用、缺 input hash/response hash 即失败。
5. 自动信号只负责找疑点；最终 `passed` 仍要求源页视觉抽检。confidence 固定在 0.94/0.96 等值不能充当质量证明。
6. 原始 OCR 永远只读。人工改字走带 `rawSha256` 的 correction ledger；整页来源错误必须产生新 OCR job/version，不应伪装成 normalized correction。

## 9. 仍未知、需要下一轮验证的事项

1. 当时真正发给模型的 render PNG 字节和顺序。归档只保留 manifest，没有 PNG hash。
2. 原始模型请求/响应和旧 Luna 线程。迁移说明明确要求“不恢复旧 Luna 线程”，当前 job 也没有 response ledger。
3. 具体故障点究竟是输入选图、模型多图输出、还是落盘关联。修复应覆盖三者，而不是在缺证据时武断选择一个。
4. `book-025` 除已检测批次外还有多少无重复信号的错页。只有新 page-bound 全书跑或全页人工对齐能回答。
5. `book-001` 的 10 个空页、`book-045` 的 16 个空页是否全部是无正文插图页；尚未逐页视觉复核。

## 10. 可复现检查摘要

以下检查均为只读：

```bash
# 权威文件哈希
sha256sum book-parser/work/text-ocr-v1/jobs/book-025/{source.json,report.json,progress.json}
sha256sum book-parser/work/text-ocr-v1/jobs/book-025/render/render-manifest.json
sha256sum book-parser/work/package-v2-reviewed/book-025/manifest.json

# 批次写入时间
stat -c '%n|%y|%s' book-parser/work/text-ocr-v1/jobs/book-025/pages/*.json

# 重复、短页、空页和三书横向扫描
python3  # json 读取后拼接 blocks[].text，按 SHA-256 分组并做批内 SequenceMatcher

# 源 PDF 主页面图像唯一性
python3  # pypdf.PdfReader；对每页最大 page.images[].data 计算 SHA-256

# v2 传播核对
python3  # 比较 OCR blocks[].text、package rawText/normalizedText 和 corrections ledger
```

## 11. 最终建议

本地根因调查与 Gemini 3.7 Flash High 交叉审计的共同建议是选择**方案 B**：先修流程，再对 `book-025` 162 页全书重跑；另外两书先做严格审计，不预先全量重跑。

不要用尚未测量的 `1 小时`、`10-15 分钟`或固定字符阈值安排执行，也不要把 OCR 称为项目的“唯一”卡点。进入实施前应先定义 page-bound runner 的不可变页键和请求账本，再通过真实吞吐与人工复核记录更新工期和阈值。

这条结论不推翻“原版 PDF / OCR 文字双模式”产品路线。恰恰相反，原版 PDF 作为权威物理页、OCR release 闸门和 raw/normalized 分离已经正确地把坏内容挡在应用外。当前需要替换的是不可审计的 OCR 生产批次方式，而不是 Reader、共享页码或 AI 证据架构。
