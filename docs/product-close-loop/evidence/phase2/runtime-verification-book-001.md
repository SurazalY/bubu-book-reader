# Phase 2B 任务 2/3：book-001 真实运行验收（首次尝试，结论已被更正）

执行时间：2026-08-17（Phase 2B 子 agent）

> **更正声明（主控补记）**：本文件下方"浏览器 MCP 不可用"的结论**是误判**，任务 2 的"未执行"结果表已被重派的验收轮次取代。本文件仅作为过程记录保留。

## 浏览器 MCP 可用性（原始记录 + 更正）

原始结论为"**不可用**"，依据是：

- `browser_navigate` → `No browser tab available. Please navigate to a page first.`
- `browser_cdp` → 同上
- `cursor-app-control` `open_resource` → `Error: unknown agent`

**真实原因**：`browser_navigate` 的语义是"**默认复用已存在的标签页**"，只有传 `newTab: true` 才会新建。当时不存在任何标签页，所以复用失败并抛出该错误——MCP 本身是好的（`GetMcpTools` 报 `ready` 是准确的）。

主控随后以 `browser_navigate({ url: 'http://127.0.0.1:5190/', newTab: true })` 一次调用即成功建立标签页（viewId `e0162f`），前端首页正常渲染，86 个可访问性节点、21 个可交互节点。

**教训**：工具报错先读该工具的参数语义，再判定能力不可用。此处代价是一整轮纵向验收被跳过。

---

## 任务 2 逐项结果（第二轮实测，2026-08-17）

首轮因误判 MCP 不可用而全部未执行；本表为重派后的**真实浏览器实测**结果。无截图（该轮被主控中断以交回人工，截图未及产出）。

| # | 验收项 | 结果 | 观察到的实际表现 |
|---|---|---|---|
| 1 | 登录 | 通过 | `internal-student` 登录成功，进入学生首页「下午好，小竹」 |
| 2 | 书架封面与书名 | **部分失败** | book-001《和大人一起读·儿童歌谣》在架、书名正确；但**首页与书架卡片封面显示「封面资源不可用」**，书籍详情页封面正常显示。缺陷 3 |
| 3 | 打开阅读器 | 通过 | 从书架点入阅读器成功 |
| 4 | 原版 PDF 渲染与翻页 | **失败** | 报错 `源 PDF 加载失败：this._requestsByChunk.getOrInsertComputed is not a function`。缺陷 1（阻塞） |
| 5 | 切文字模式同页 | 通过 | 切换模式后仍停在同一物理页 |
| 6 | 文字模式可选文本 | 通过 | 文本可选中，`window.getSelection()` 取到「快乐读书吧…」 |
| 7 | 空白页基线（第 2/3 页） | 通过 | 第 2、3 页文字模式为空白，与 OCR 基线一致（基线：98 物理页 / 88 文本页 / 10 页无文本） |
| 8 | 两模式翻页一致 | **部分通过** | 用 URL `?pageNo=5` 跳页后，PDF 与文字模式底栏均显示「第 5 页 / 共 98 页」，页码骨架一致；但**阅读器内「下一页」与跳页「去」按钮点击无效**，画面不动。缺陷 2 |
| 9 | 进度恢复 | 未执行 | 依赖 PDF 正常渲染与按钮翻页，被缺陷 1、2 阻塞 |
| 10 | 无已读百分比/完成度 | 通过 | 学生端未出现「已读 X%」或「完成度」 |

### 任务 A：资产是否真走受保护路径

**通过。** 封面与 PDF 的实际请求 URL 均为 `/api/v1/books/assets/...`，不是公开的 `/books/...`。

该结论另有静态佐证：`server/integration/projections.js` 第 15 行是唯一的资产 URL 签发点（`/api/v1/books/assets/${encodeURIComponent(row.id)}`），且 `src/` 全目录无任何硬编码 `/books/` 路径，前端拿不到公开路径。因此 Vite dev 侧 `/books/*` 返回 200 的缺口**不会污染本轮验收结论**。

### 页数一致性交叉核对（主控抽查）

阅读器底栏「共 98 页」为**物理页数**，三方一致：

| 来源 | 值 |
|---|---|
| `book-parser/catalog-default-49.json` | `pageCount: 98`、`recordedPdfPageCount: 98`、`textPageCount: 88` |
| SQLite | `book_versions.page_count = 98`；`book_pages` 98 行且 1..98 连续无缺号 |
| 阅读器 UI 底栏 | 共 98 页 |

意义：阅读器以物理页序号为骨架，未把 OCR 文本页数（88）当作总页数。若显示 88 即意味着两模式页码会错位，属严重缺陷；实测未发生。

---

## 任务 3：数据库侧交叉验证

> **仍待补做。** 以下为验收前的空快照。缺陷 1、2 使 PDF 渲染与按钮翻页不可用，无法产生有效的连续阅读行为，因此计时/进度落库无从验证。待缺陷修复 + 人工复验产生真实阅读后，由主控补齐本节。

### reading_progress（internal-demo-student × book-001-trusted-v1）

```
[]
```

### reading_summary_sessions（internal-demo-student）

```
[]
```

### reading_page_coverage

```
=== reading_page_coverage count ===
[
  {
    "cnt": 0
  }
]

=== reading_page_coverage sample (pages with ms) ===
[]
```

---

## 任务 0 间接验证（API 层已通过）

受保护资产接口在配置修正后全部通过（详见 `asset-endpoint-verification.md`），为后续浏览器验收提供了 API 层前置条件。
