# Phase 4 交接说明（教师发布管理与班级可见范围）

> 写于 2026-08-17 深夜，由完成 D-19（原版 PDF 清晰度）的执行者交给 Phase 4 承接者。
> 本文件的定位与 `05_主控交接说明.md` 相同：**把无法从代码里读出来的东西交给你**——已经核实过的事实、
> 既有文档里已经过时或写错的地方、以及为什么某些做法不能变。
>
> **本文件优先级高于你对代码的直觉判断，也高于 `01`–`04` 计划文档里与本文件冲突的部分。**
> 本文件只允许追加，禁止删改。你觉得某条过时了，在末尾追加一条说明它为何过时。

---

## 0. 使用契约（先读这一节，再动手）

1. **开工前必须整篇读完**：本文件 → `05_主控交接说明.md`（全文，尤其第 6 节硬规则与第 9 节教训）→ `02_决策与契约边界.md` 的 B 节 → `03_实施任务清单.md` 的 Phase 4 段 → `docs/product-close-loop/design/protected-asset-consumption.md`（D-09/D-10 定档）→ `evidence/phase2/defect-ledger.md` 第一节清单与第八节鉴权矩阵。
2. **不要 push、不要建 PR、不要 commit**，除非用户明确要求。分支 `feat/product-close-loop`。
3. **你只做 Phase 4。** 不要顺手做 Phase 5/6/7。Phase 5 的缺口清单在 `05` 第 7 节末尾，别提前动手。
4. **未经真实运行不得宣称验收通过。** 本项目已经两次栽在「单元测试全绿但线上从未生效」上（`05` 第 9 节教训 1、2）。测试绿只是允许你去请用户验收的门票，不是结论。
5. **不要自己开浏览器。** agent 开的标签页会脱管，持续占用阅读租约，而且**用户在界面上看不到也关不掉**，曾因此堵死近三小时（`05` 第 9 节教训 3）。真人验收由用户本人做，你的职责是给出最短可执行的步骤然后等反馈。
6. **派发子 agent 必须显式指定模型**，并给自包含简报（子 agent 之间不共享上下文）。涉及禁令的任务必须把禁令原文附上。
7. **不盲信子 agent 的交付。** 本次交接文档写作过程中，子 agent 报告的一条结论就与台账记载不符（见 §3.1 更正一），是靠自己去读源码才发现的。关键结论至少自己抽查一次。

---

## 1. 你的任务边界

Phase 4 = `03_实施任务清单.md` 的 T4.1 – T4.7。原文照抄如下，**七项一项都不能少**：

| 任务 | 内容 | 我核实的当前状态 |
|---|---|---|
| T4.1 | 发布/下架 HTTP：`POST /books/:bookId/publish`、`POST /books/:bookId/unpublish`（published→draft），走既有 authorize（动作 `book.publish`）+ Idempotency-Key + 审计。路由放 `integration-router.js`，领域逻辑在 `catalog.js` | **未做**。全仓搜 `books/:bookId/publish` 无匹配。领域层 `catalog.js` 已有 `publishBook`（219 行起），但没有 HTTP 出口，也没有 `unpublishBook` |
| T4.2 | `permissions.js` 给教师角色增加 `book.publish` | **未做**。`teacher` 的动作表（`permissions.js` 25–50 行）没有 `book.publish` |
| T4.3 | 启用 `book_access_grants`（`grantee_type='class'`），四个入口统一过滤，不可见=404 | **未做**。这是 Phase 4 的核心，也是全程风险最高的一段。详见 §4 |
| T4.4 | 可见范围 HTTP：`GET /books/:bookId/visibility` + `PUT /books/:bookId/visibility` | **未做**。全仓搜 `visibility` 在 `server/` 下无匹配 |
| T4.5 | 教师端 UI：发布状态与发布/下架操作、班级可见范围编辑、教师书库年级筛选 | **未做** |
| T4.6 | 学生书架年级筛选（`Shelf.jsx`，1–6 年级 + 全部，数据来自书目投影 `grade`） | **未做**。`grade` 字段已在投影里（`catalog.js` 146 行 SQL 已 select `metadata.grade`），49 本已全部有 grade（T3.3 断言通过） |
| T4.7 | 测试：服务端 + 前端契约测试 | **未做** |

另外，`03` 的 Phase 4 完成标准原文：

> 真实运行验证——教师下架某书后学生书架消失、再发布恢复；把某书限定到 internal-demo-class 之外的新建班级后，演示学生看不到该书（用 `POST /classes` 建第二个班验证）；质量门绿。

**这条完成标准里有一个坑，见 §3.1 更正三。**

---

## 2. 与 Phase 4 强耦合的既有缺陷（不是新工作，是你必须一起收的）

| 编号 | 一句话 | 与 Phase 4 的关系 |
|---|---|---|
| D-14 | `getBookAsset` 的过滤口径 | **Phase 4 核心前置**。台账原措辞有误，见 §3.1 更正一 |
| D-09 | 详情页封面冷请求失败（裸 `<img>` 无法携带 `X-Workspace-Id` → 400） | 方案已定档（路线 1：前端统一 fetch + blob），**待落地**。`design/protected-asset-consumption.md` §4.1 有逐文件改动面 |
| D-10 | 资产响应 `Cache-Control: private, max-age=3600` 且无 `Vary`，缓存掩盖鉴权、权限撤销最长滞后 1 小时 | **必须先修**，否则你的班级可见范围验收会被缓存污染成假通过——D-09 当初就是这么被误判为通过的。现状仍在 `integration-router.js` **581 行**（我已核实）|

**定档裁决（用户已批，不要重新讨论）：**

- 路线 1：前端统一 `fetch` + blob URL。排除路线 2（服务端缺头回退）与路线 3（workspace Cookie 镜像）。
- 缓存按资产类型分开，**不一律 `no-store`**：封面 `private, no-store`；源 PDF `private, no-cache` + `ETag`。理由是 49 本合计 3.3 GB、平均一本约 67 MB，统一 `no-store` 会让学生每次开书重下整本 PDF，教室并发不可接受。
- **落地时必须实测**：`no-cache` 下 pdf.js 的 range 请求是否仍走 304 而非整本重传。此项不得假定。服务端已支持单段 Range 206（`integration-router.js` 557–595 行区间内），前端 `PdfBookPage.jsx` 未设 `disableRange`，走 pdf.js 默认会发 Range。
- 接受的代价：每新增一个图片展示位都必须走共享 hook。**必须有一条守卫测试防止新展示位绕过 hook，不能只靠约定。**

---

## 3. 事实基线（我逐条核过源码，含对既有文档的四处更正）

### 3.1 对既有文档的更正

**更正一：台账 D-14 的措辞不准确，会误导你。**

台账第一节 D-14 写的是「`getBookAsset` 未按发布状态与班级可见范围过滤」。**「未按发布状态过滤」这半句是错的。** 我读了源码：

```185:198:server/domains/reading/catalog.js
    async getBookAsset(assetId) {
      const normalizedAssetId = assertString(assetId, 'assetId')
      await authorize('book.read', { assetId: normalizedAssetId })
      const asset = one(context.db, `SELECT asset.*, version.book_id
        FROM book_assets AS asset
        JOIN book_versions AS version ON version.id = asset.book_version_id
        JOIN books AS book ON book.id = version.book_id
        WHERE asset.id = :assetId
          AND version.organization_id_at_creation = :organizationId
          AND book.organization_id_at_creation = :organizationId
          AND book.status = 'published'`, { assetId: normalizedAssetId, organizationId: organizationId() })
      if (!asset) throw scopedResourceNotFound('书籍资产不存在或当前不可读取')
      return asset
    },
```

`book.status = 'published'` 在。组织隔离也在（version 与 book 双重校验）。**它真正缺的只有班级 grants 这一层**，与 `listBooks` / `getPage` / AI 三处缺的是同一层。

这条更正是有代价的：如果你按台账原文去「补发布状态过滤」，会写出重复条件、并且误以为 D-14 比实际严重，把注意力放错。**按本节的实测口径走。**（台账只允许追加，所以我没有改它的原文，这条更正记在这里。）

**更正二：新迁移编号从 046 起，不是 02 文档写的 045。**

`02_决策与契约边界.md` B-1 写「当前最大编号 044，新迁移从 045 起」。**045 已被 Phase 1 用掉了**：`server/db/migrations/045_book_catalog_grade_and_trusted_baseline.sql`。当前目录下最大编号确实是 045（共 29 个文件）。**你的新迁移从 046 开始。**

**更正三：`class_teacher` 这个角色不存在；而且教师建不了班。**

`03` 的 T4.2 写「给 `teacher`/`class_teacher` 增加 `book.publish`（确认角色代码以文件实际为准，别名一并处理）」。我核过 `permissions.js`，角色键只有五个：

```
student(2 行) / teacher(25 行) / grade_manager(52 行) / school_admin(79 行) / platform_ops(113 行)
```

**没有 `class_teacher`，不需要处理别名。** `book.publish` 现状：`school_admin`（88 行）与 `platform_ops`（119 行）**已有**；`teacher` 与 `grade_manager` **没有**。T4.2 的实际工作就是给 `teacher` 加一行（`grade_manager` 是否也加，需要你向用户确认，`03` 没写）。

更重要的一条坑，**直接影响 Phase 4 的完成标准**：完成标准要求「用 `POST /classes` 建第二个班验证」。该路由存在（`server/domains/identity/index.js` 280–304 行，前缀 `/api/v1`），但它挂的是 `requireSchoolClassManage`，而那个中间件要求 **school 范围**的 `class.manage`（`index.js` 157–161 行）。而演示数据里两位老师的角色分配是 **class 范围**（`bootstrap-internal-demo.js` 244–245 行）。

**结论：建第二个班必须用校长账号 `internal-principal`（`school_admin`，school 范围，`bootstrap-internal-demo.js` 183、253–254 行），不能用老师账号。** 别等到验收当天才发现建不了班。校长的密码与演示学生同源，在 `.env` 的 `INTERNAL_DEMO_PASSWORD`。

**更正四：D-19 已复验关闭，但它改过你要动的文件，且成果未提交。**

> 2026-08-17 深夜更新：本条写就时 D-19 状态是「已修，待真人复验」；同夜用户复验通过，原话「清晰度基本没问题了」。**该缺陷已关闭**，你不需要接手它。台账第十五节末尾记了复验的边界（抽样观感，未逐本点验 49 本，三处改动无法归因到单项）。

D-19（原版 PDF 正文发糊）改动了 `src/student/pages/Reader.jsx`、`src/index.css`、`src/student/components/PdfBookPage.jsx`，新增 `src/student/pdf-page-design.js` 与两个前端测试文件，**全部未提交**。详见台账第十五节。

对你的影响：
- 你在 Phase 4 里如果要动这几个文件（T4.6 动 `Shelf.jsx` 不冲突，但 D-09 落地要动 `src/components/ui.jsx` 和学生详情页），**注意别把 D-19 与 D-18 的未提交改动搞丢**。
- D-19 已关闭意味着 §6.3 那三处新契约是**生效中的既有行为**，不是待验证的实验品——改坏它们就是回归。
- 工作树里 D-18 与 D-19 的成果都是未提交状态。**禁止 `git checkout` / `reset` / `stash` / `clean` 丢弃任何未提交内容。**

---

### 3.2 检查点与质量门

- 当前 HEAD：`063f1bc`（T3.2 跳过 book-001 导入 48 本 + T3.3 全量核对完成）。
- **质量门基线（已由我实跑，2026-08-17 深夜）**：`npm run test:server` = **207/207**，`npm run test:frontend` = **194/194**，`npm run build` 退出码 0。
  > 注意：frontend 从 `05` 文档写的 179 涨到 194，是 D-18 与 D-19 新增用例所致。**你新增用例后数字变大属正常，变小要查。** 别拿 `05` 里的 179 当基线。
- `npm run build` 实测 **8.71 秒**，不是 `05` 文档预期的「1 分钟量级」。`dist/books/pilot` 49 本齐全（我核过 `book-049/source.pdf` 81,035,359 字节在位）。
- `tests/frontend/reading-monitor-client-coordinator.test.mjs` 的历史抖动已全部确定化。**该文件再失败就是真回归，不许靠重跑掩盖。**

---

## 4. 四个入口的精确现状（T4.3 的作战地图）

四个入口的 HTTP 前缀都是 `/api/v1`（`server/app.js` 42–43 行）。全局中间件在 `integration-router.js` **405–406 行**：`router.use(requireSession)` 然后 `router.use(requireWorkspace)`，**无例外**。

| # | 入口 | HTTP 路由 | 路由行号 | 领域实现 | 当前过滤 | 缺什么 |
|---|---|---|---|---|---|---|
| 1 | `listBooks` | `GET /books` | `integration-router.js` **551** | `catalog.js` **139–165** | `b.organization_id_at_creation = :organizationId AND b.status = :status` | 班级 grants |
| 2 | `getPage` | `GET /books/:bookId/pages/:pageNo` | `integration-router.js` **597** | `catalog.js` **200–217**，HTTP 层再过一次 `deriveAiRequestScope` | 组织 + `b.status = 'published'` | 班级 grants |
| 3 | `getBookAsset` | `GET /books/assets/:assetId` | `integration-router.js` **557** | `catalog.js` **185–198** | 组织（version+book 双重）+ `book.status = 'published'` | 班级 grants |
| 4 | AI 书籍访问 | `POST /ai/messages` | `integration-router.js` **966** | `ai-runtime.js` `deriveAiRequestScope` **368**，内部再调 `readScopeSnapshot` **112** | 组织 + published + 已读范围 | 班级 grants |

**四处都没有任何班级过滤。** 全仓 JS 对 `book_access_grants` / `grantee_type` **零引用**——表建了但代码从未用过。

### 4.1 `book_access_grants` 表结构（已存在，无需迁移）

```76:87:server/db/migrations/010_reading_catalog.sql
CREATE TABLE IF NOT EXISTS book_access_grants (
  id TEXT PRIMARY KEY,
  book_version_id TEXT NOT NULL,
  grantee_type TEXT NOT NULL,
  grantee_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(book_version_id, grantee_type, grantee_id)
);
```

注意 grants 以 **`book_version_id`** 为键，而 UI 是按 `bookId` 操作的。B-4 要求「服务端解析到当前版本」——这个解析逻辑要和 `listBooks` 里那段「取最新版本」的子查询（`catalog.js` 148–152 行）口径一致，否则会出现「设置的是旧版本、过滤的是新版本」这种静默失效。

### 4.2 学生的班级 id 从哪里取（这是最容易写错的一处）

有两条路，**必须走第二条**：

1. ~~当前工作空间~~：`workspace.scopeType === 'class'` 时 `workspace.scopeId` 就是班级 id。**不要只用这个。** 它来自请求头 `X-Workspace-Id`，是客户端可控输入，而且一个学生可能有多个工作空间。
2. **班级成员关系**：`class_memberships` 表（`server/db/migrations/000_identity.sql` 70–80 行，列有 `class_id`、`user_id`、`membership_role`、`status`）。已有现成的封装：`server/domains/.../context.js` 的 `studentResourceScope` / `findUserScope`，会返回 `classIds[]`（底层查询在 `repository.js` 238–276 行）。

`design/protected-asset-consumption.md` §2.1 的表格里也点明了这一条：

> 过滤应基于**用户班级成员关系**，不应依赖 workspace 头。

**还有一处坑**：`authorize('book.read', { bookId, assetId, bookVersionId })` 这几个参数**当前根本没被权限评估器读取**——`permissions.js` 的 `scopeAllows`（153–183 行）只认 own/class/grade/school/platform 五种 scope 类型，不看具体资源 id。所以**不要指望在 `authorize` 里加参数就能完成过滤**，过滤必须落在 SQL 或显式的 grants 检查里。

### 4.3 `listBooks` 的一个附带越权面（顺手一起收）

路由把 `req.query.status` 原样传给领域层（`integration-router.js` 551–555 行），领域层只校验它属于 `draft|published|archived`（`catalog.js` 141–142 行）。**学生带 `?status=draft` 就能列出草稿书**，因为 `book.read` 是学生角色的动作。T4.3 落地时应对学生锁死 `published`（或直接忽略该 query 参数），并补守卫测试。

### 4.4 现有测试覆盖了什么、没覆盖什么

**不存在**任何断言「学生在四个入口按班级 grants 过滤、不可见返回 404」的用例。已有的相近测试只覆盖到组织隔离、未发布、未登录三类：

| 文件 | 覆盖到的 | 没覆盖的 |
|---|---|---|
| `tests/server/reading/reading-teaching-bridge.test.js` | 下架后 `getPage` → `RESOURCE_NOT_FOUND`；跨组织 `getPage` 404；跨组织 `getBookVersionAssets` 404 | **不测 `getBookAsset`**；不测跨班 |
| `tests/server/http/static-assets.test.js` | 公开 `/books/*` 404；无会话访问资产 → 401 | 不测可见范围 |
| `tests/server/http/integration-runtime.test.js` | 学生可 `GET /books`、`GET /pages`、资产 Range 206 | 只有同班可见，**无跨班拒绝** |
| `tests/frontend/book-cover-protected-asset.test.mjs` | 学生首页/书架封面走 fetch+blob | 不测 404 过滤；**不覆盖其余展示位** |

### 4.5 前端封面消费位现状（D-09 落地面）

**已改造（唯一一处走 fetch + blob）**：`src/student/components/BookCover.jsx`（`useProtectedCoverUrl`，6–59 行），调用方是 `BookCard.jsx`（书架）与 `Home.jsx`（首页）。

**未改造，直接把受保护 URL 塞给 `src` 或 CSS `url()`（浏览器不会带 `X-Workspace-Id`，冷请求必 400）**：

- 学生端经共享 `src/components/ui.jsx` 的 `BookCover`（51–78 行，且带 `/covers/${book.id}.jpg` 公开回退，**这个回退要删**）：`BookDetail.jsx`、`ListDetail.jsx`、`Lists.jsx`、`Highlights.jsx`、`Settings.jsx`、`Ranking.jsx`、`Compose.jsx`、`PostDetail.jsx`
- 社区硬编码公开路径：`PostCard.jsx` 38–39 行、`PostDetail.jsx` 212–213 行（`covers/${book.id}.jpg`）。**不得用「把封面复制到 public/covers/」的方式绕过**，那违反 B-2 §6。
- 教师端 CSS `background-image: url()`：`console/pages/teaching/BookLibrary.jsx`、`BookDetail.jsx`、`TeacherReader.jsx`、`ArrangeList.jsx`；裸 `<img>`：`ArrangeDetail.jsx`、`console/pages/Home.jsx`

**不存在**共享 hook `useProtectedAssetUrl`——定档方案要求新建它（`design/protected-asset-consumption.md` §4.1）。

---

## 5. 不可协商的硬规则

前六条抄自 `05_主控交接说明.md` 第 6 节，一条都不许打折；后三条是 Phase 4 专属。

1. **不得修改阅读计时的摘要 schema 与指纹算法**：`src/student/reading-monitor/summary.js` 的 `FINGERPRINT_FIELDS`（第 3 行起）与 `createSummaryRevision()`（第 42 行起）。项目硬契约 B-2。
2. **不得新建第二套计时/进度/发布系统。** 工作量主体是接入与补缺。
3. **不得对 OCR 做质量验收。** OCR 是可信输入。
4. **不得擅自向 `server/data/readmate.sqlite` 写入。** 任何会删除/覆盖既有阅读记录的操作先问用户。需要可写库就复制副本到临时目录。**book-001 上挂着真人的真实阅读数据**（`book_version_id = book-001-trusted-v1`），碰它之前必须问。
5. **不得改动 `device-migration-20260815/`**；`book-parser/work/ocr-antigravity-v1/` 是只读输入。
6. **服务端改完必须重启后端，Node 不热加载。** 而且重启 + 测试全绿仍不足以宣称生效。
7. **B-4 原文（`02_决策与契约边界.md` 89–93 行），照此落地：**
   > - 过滤必须在服务端收口：`listBooks`（学生角色）、`getPage`、`getBookAsset`、AI 消息里的书籍访问校验，四处口径一致——学生对不可见书应表现为"书不存在"（404），不是 403 泄露存在性。
   > - grants 以 `book_version_id` 为键；发布管理 UI 操作按书（bookId）操作时，服务端解析到当前版本。
   > - 教师设置可见范围的 UI 只列出该教师有权限范围内的班级。
   > - 课堂锁书/阅读安排引用了对某班不可见的书属于边界情况：本期只需保证"设置可见范围时给教师明确提示"，不做级联清理。
8. **D3 语义（`02` 18–23 行）**：某书版本**没有任何 grants 行 → 全组织可见**（默认，与现状一致）；有 grants 行 → 仅授权班级的**学生**可见；**教师/管理角色在控制台书库始终可见本组织全部书**（否则无法管理）；单个学生粒度本期不做。
9. **404 不是 403。** 四处只要有一处返回 403 或返回了「存在但无权」，就是泄露存在性，等于没做。

---

## 6. 你会动到的文件里埋着的地雷

### 6.1 `src/student/pages/Reader.jsx` 三处（D-19 已加守卫测试锁死，别绕过）

守卫测试在 `tests/frontend/reader-dual-mode-contract.test.mjs`。

1. **第 83 行 `key={`${bookId}:${resolution.bookVersionId}`}`——不得把页码放回这个 key。** 页码进 key 会导致翻页时自触发重挂、租约冲突、阅读时长与页码归零。这是 D-05 / D-11 的根因，同一结构复发过三次。
2. **第 789–792 行附近的 `try { await telemetry.closeAndWait('reader_close') } finally { navigate(...) }`——不得改成无条件 await，也不得去掉 `finally`。** 这是 D-17 的 B3 层：让「返回详情」在提交队列堵塞时仍能在有界时间内完成。去掉它，返回键会重新变成死键。相关常量 `CLOSE_WAIT_TIMEOUT_MS = 4000` 在 `src/student/reading-monitor/constants.js`。
3. **`src/student/components/PdfBookPage.jsx` 第 2 与第 8 行必须从 `pdfjs-dist/legacy/build/` 导入。** 换成现代构建会直接抛 `getOrInsertComputed is not a function`，全部 PDF 打不开。

### 6.2 `identity-core.test.js` 578–582 的「有 Cookie 无头 → 400」断言

路线 1 **不需要**动这条断言，这也是选路线 1 的理由之一。**如果你发现自己想改它，说明你正在偏离定档方案，停下来问用户。**

### 6.3 D-19 的三处新契约（我刚加的，别顺手改坏）

- `Reader.jsx` 的 `pdfZoomed = readerMode === 'original' && !spread`（298 行）与 `applyPdfZoom`（306 行）：原版模式「大」字号是放大档，文字模式不进这条分支。
- `index.css` 的 `.student-reader-bar--off` / `--foot--off` 必须 `position: absolute` 脱离 flex 流（1093 行起）。
- `.student-stage-viewport--zoom`（1207 行起）的 `overflow-x: hidden` / `overflow-y: auto` / `align-items: flex-start` 三条都有原因，注释里写了。

---

## 7. 环境事实（不知道这些会白跑一轮）

- **前端 5190**（Vite dev，反映当前源码）；**后端 5191** 服务的是 `dist/` 构建产物。**改了前端要在 5190 上验证，或者先 `npm run build`。** 在 5191 上看到的是旧构建。
- **服务端改完必须重启后端**（Node 不热加载）。
- **会话密钥在 2026-08-17 被轮换过。** 满屏 `AUTH_REQUIRED: 需要有效登录会话` 不是数据丢失，是要重新登录。学生端目前**没有退出/登录入口**（T5.4 未做），必须直达 `http://127.0.0.1:5190/student/login`。演示账号：学生 `internal-student`，校长 `internal-principal`，老师 `internal-teacher-li` / `internal-teacher-wang`；密码见 `.env` 的 `INTERNAL_DEMO_PASSWORD`（`ReadMateDemo#2026Kx9`），**不入 Git**。
- **npm 11 会吞掉 `--` 之后的参数。** 跑脚本直接用 `node` / `python` 调，不要 `npm run xxx -- --flag`。
- **应急手段（实测有效，完全不触碰业务数据）**：若又出现脱管客户端占用租约，轮换 `.env` 的 `SESSION_TOKEN_SECRET` 并重启后端即可让所有既有会话签名失效。代价只是所有人重新登录一次。比去猜哪个进程该杀安全得多。
- 改 `Reader.jsx` / `PdfBookPage.jsx` 会触发 Vite HMR；若用户此刻开着阅读器，HMR 重挂会重新获取阅读租约，可能出现短暂计时异常——**这是已知现象（台账第十四节），不是新缺陷。**
- **导入期间不要让任何人在浏览器里阅读**：WAL 模式下读不受阻，但 `busy_timeout = 0`，服务端写入撞上写锁会立刻报 busy 而不是排队等。

---

## 8. 建议的落地顺序（不是强制，但这个顺序能让验收可信）

`design/protected-asset-consumption.md` §4.1 已经给了分阶段计划，我按 Phase 4 的实际依赖重排：

| 步 | 内容 | 为什么排这里 |
|---|---|---|
| **0** | **先修 D-10 缓存头**（`integration-router.js` 581 行 `private, max-age=3600` → 封面 `no-store`、源 PDF `no-cache` + `ETag`） | **必须最先做。** 不修它，后面所有可见范围验收都可能被 1 小时缓存污染成假通过。D-09 当初就是这么被误判的 |
| 1 | T4.2 教师 `book.publish` + T4.1 发布/下架 HTTP + 审计 + Idempotency-Key | 后面的可见范围 UI 要挂在发布管理旁边；先把权限打通 |
| 2 | T4.3 四个入口的 grants 过滤 + T4.4 可见范围 HTTP | 核心。**四处一起改、一起测，不要分批上**，漏一处就是越权 |
| 3 | T4.7 的服务端守卫测试 | 紧跟 §9 的要求写 |
| 4 | D-09 前端共享 hook + 各展示位改造 + 防绕过守卫测试 | 依赖步 0 的缓存头 |
| 5 | T4.5 教师端 UI + T4.6 学生书架年级筛选 | UI 最后做，前面的接口稳定了再接 |
| 6 | 请用户做真人验收（§10） | |

---

## 9. 守卫测试要求（这一节是硬要求，不是建议）

`05` 第 9 节教训 2 的原话：**「回归用例必须按真实生产路径建模，不能只测纯函数或组件内部实现。」** D-15 的首版修复就是因为只测了纯函数，server 196/196 全绿而线上判定从未触发。

所以 Phase 4 必须有下面这几类用例，**每一类都要经过真实 HTTP 链路**（参照 `tests/server/http/integration-runtime.test.js` 的组织方式），不要只测领域函数：

1. **跨班 404，四个入口各一条**：把某书版本 grants 到班 B，用班 A 的学生分别打 `GET /books`（列表里不出现）、`GET /books/:id/pages/:no`（404）、`GET /books/assets/:assetId`（404）、`POST /ai/messages`（404）。**四条缺一条就等于没做。**
2. **默认全组织可见不被破坏**：无 grants 行的书，班 A 学生仍可见。这是 D3 语义的默认分支，最容易被写成「有 grants 才可见」而全站崩掉。
3. **教师/管理端不过滤**：教师在控制台书库仍能看到本组织全部书（含只 grants 给别班的）。
4. **学生调发布接口 403**；教师发布/下架生效；grants 幂等更新（同 key 重放不产生第二行）。
5. **`listBooks` 对学生锁死 `published`**：学生带 `?status=draft` 不得列出草稿（见 §4.3）。
6. **前端防绕过守卫**：静态扫描断言「不存在裸 `<img src={...coverUrl}>` / CSS `url(${coverUrl})` 绕过共享 hook」，且 `ui.jsx` 里 `/covers/${book.id}.jpg` 公开回退已删除、`PostCard.jsx` 不再出现该字面量。定档文档 §0 决策 1 明确要求这条测试。
7. **前端契约**：学生书架不出现不可见书；教师端新 UI 的调用形状。

---

## 10. 真人验收（由用户做，你不要开浏览器）

给用户的步骤要**最短、可执行、且不能走预热路径**。定档文档 §3.4 特别强调：**必须禁用/清空缓存或开无痕窗口，禁止先访问书架再进详情**，否则冷请求缺陷会被缓存掩盖。

建议的最小集：

| # | 步骤 | 通过标准 |
|---|---|---|
| 1 | 无痕登录学生 → **地址栏直达** `/student/books/book-001`（不经首页/书架） | 详情页显示真实插画封面，不是渐变文字封 |
| 2 | 无痕登录教师 → 直达 `/console/teaching/books` | 书库卡片封面正常，不是灰底文字 |
| 3 | 教师下架某书 → 学生硬刷新书架与详情 | 书架消失；直达详情与资产 URL 表现为 404 语义 |
| 4 | 教师再发布该书 | 学生硬刷新后恢复 |
| 5 | 用**校长账号**（见 §3.1 更正三）新建第二个班 → 把某书可见范围限定到该新班 | 演示学生 `internal-student` 看不到该书；直达页/资产 404；问 AI 该书也 404 |
| 6 | Network 面板看封面与源 PDF 的响应头 | 封面含 `no-store`；源 PDF 含 `no-cache` + `ETag`，且 pdf.js 的 range 请求走 **304** 而不是整本重传 |

**不做**：全站 49 本逐本点验；三维翻页（D-03 已锁死不可达）；阅读计时（那是 Phase 6，且他人可能正在占用租约）。

---

## 11. 明确不要做的

- 不要重导任何书，**尤其不要重导 book-001**（真人阅读数据挂在 `book-001-trusted-v1` 上）。
- 不要重渲染源 PDF、不要重打包。
- 不要改教师端阅读器的阅读逻辑（Phase 4 只加发布/可见范围 UI）。
- 不要改 `src/student/reading-monitor/summary.js`、计时摘要 schema、租约 TTL 与续租路由。
- 不要为了让裸 `<img>` 能工作而放宽服务端鉴权（那是被排除的路线 2/3）。
- 不要把封面复制到 `public/covers/`（违反 B-2 §6）。
- 不要顺手做 Phase 5/6/7。
- 不要 push、不要建 PR、不要 commit（除非用户明确要求）。
- 不要 `git checkout` / `reset` / `stash` / `clean`——工作树里有 D-18 与 D-19 的未提交成果。

---

## 12. 交出去之前你必须做的

1. 在 `05_主控交接说明.md` 第 10 节追加一条交接记录（该文件的使用契约第 3 条要求）。**不得用「详见对话历史」代替文字**——对话上下文不会传给你的继任者，只有仓库里的文件会。
2. 把 Phase 4 的验收证据归档到 `docs/product-close-loop/evidence/phase4/`。
3. 台账（`evidence/phase2/defect-ledger.md`）里 D-09、D-10、D-14 三条的状态要更新，D-19 的复验结果如果拿到了也要记。**台账只允许追加，不许删改既有内容。**
4. 在本文件末尾追加一条「Phase 4 实际落地与本文预期的差异」，把你发现的、和本文不一致的事实写清楚。
5. 逐项如实标注验证等级（`04_验收标准清单.md` 的五级），**未经真实运行验证的项不得宣称通过**。这是用户反复强调的红线。

---

## 附录：本文件里我实测过的 vs 我转述的

**我自己读源码/跑命令核实的**（可直接依赖）：

- `getBookAsset` / `listBooks` / `getPage` 的 SQL 原文与行号（`catalog.js` 139/185/200）
- 四个入口的路由行号（`integration-router.js` 405/406/551/557/597/966）与资产缓存头行号（581）
- `permissions.js` 的五个角色键与 `book.publish` 的分布（88、119 行有；`teacher` 无）
- 无 `class_teacher` 角色；无 publish/unpublish/visibility 路由；`POST /classes` 在 `identity/index.js` 280 行且要 school 范围
- 演示账号的角色与 scope（`bootstrap-internal-demo.js` 180–184、244–245、253–254 行）
- 迁移目录最大编号 045（29 个文件）
- `book_access_grants` 建表语句（`010_reading_catalog.sql` 76–87 行）与「全仓 JS 零引用」
- 质量门数字 207 / 194 / build 退出码 0 / build 8.71 秒 / `dist/books/pilot` 49 本
- HEAD `063f1bc`；D-18 与 D-19 的未提交文件清单

**由子 agent 探查、我抽查了关键部分但未逐条复核的**（用前建议自己再看一眼）：

- 前端封面消费位的完整清单与行号（§4.5 那张表）。我核对了 `ui.jsx` 51–78 行与 `BookCover.jsx` 的 fetch+blob 实现，其余展示位的行号来自子 agent。
- `class_memberships` / `studentResourceScope` / `repository.js` 238–276 行这条取班级 id 的链路，我只核到表结构存在，未逐行读封装。
- 现有测试覆盖矩阵（§4.4）。「不存在班级 grants 守卫测试」这条我用全仓搜确认过，其余用例名与行号来自子 agent。
- pdf.js 未设 `disableRange`（我核过 `PdfBookPage.jsx` 26–30 行确实只传了 url / httpHeaders / withCredentials），但「服务端 Range 206 已被测试覆盖」这条来自子 agent。
