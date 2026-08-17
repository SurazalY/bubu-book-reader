# 受保护资产消费方案（D-09 / D-10）

> 状态：**已裁决 · 待 Phase 4 落地**  
> 日期：2026-08-17  
> 关联缺陷：D-09（详情页封面冷请求失败）、D-10（资产响应缓存掩盖鉴权 / 权限撤销滞后）  
> 硬约束：B-2 §6 公开 `/books/*` 保持不可访问；不得新建第二套发布/权限系统

---

## 〇、用户裁决（2026-08-17，本节优先于下文的候选比较）

### 决策 1：采用路线 1（前端统一 `fetch` + blob URL）

排除路线 2 与路线 3。决定性理由是路线 2 存在**正确性**缺口而非成本问题：服务端 session 不持久化工作空间，回退只能现场取登录默认值，与教师端界面上切换的工作空间可能不一致——同一本书在带头与不带头两条请求上会得到不同结果。路线 1 无需在鉴权中间件开例外，也无需改动 `identity-core.test.js` 578–582 的「有 Cookie 无头 → 400」断言。

接受的代价：每新增一个图片展示位都必须走共享 hook，否则又会退回裸 `<img>` 的老路。**落地时需要一条守卫测试防止新展示位绕过 hook**，不能只靠约定。

### 决策 2：缓存策略按资产类型分开，不一律 `no-store`

原方案建议统一 `no-store`。经主控指出后修正：**源 PDF 与封面走同一个资产接口**，而 49 本合计 3.3GB、平均一本约 67MB。统一 `no-store` 会导致学生每次打开一本书都重新下载整本 PDF，教室并发场景下不可接受。

裁定：

| 资产类型 | 策略 | 理由 |
|---|---|---|
| 封面 | `Cache-Control: private, no-store` | 体积小，重传代价可忽略；彻底消除「缓存掩盖鉴权」这一验收污染源（D-09 即因此被误判为通过） |
| 源 PDF | `Cache-Control: private, no-cache` + `ETag` | `no-cache` 语义是「可以缓存但每次使用前必须回源校验」，与 `no-store`（根本不许存）不同。校验命中返回 304 空响应，既让权限撤销**立即生效**，又避免重传 67MB |

代价：每次打开书多一个校验往返。这是权限即时性与流量之间的取舍点，已接受。

**落地时必须验证**：`no-cache` 下 pdf.js 的分块 / range 请求是否仍按预期走 304，而非退化为整本重传。此项须实测，不得假定。

### 决策 3（主控定，未占用用户裁决）

- **blob 内存窗口**：用户停留在详情页期间权限被撤销，仍能看到已加载进内存的封面。任何前端缓存方案都有此固有窗口，接受，不作为缺陷。
- **社区帖图**：放 P2，与 P1 分离。不得以「把封面复制到 `public/covers/`」的方式绕过（违反 B-2 §6）。

---

## 结论摘要

**推荐路线：路线 1（前端统一改造）+ 服务端缓存收紧（必做，与路线选择无关）。**

理由简述：

1. **浏览器事实不可改**：`<img src>` 与 CSS `background-image: url()` 无法携带 `X-Workspace-Id`；除非放宽鉴权或引入可随请求自动携带的上下文（见路线 3），否则只能走 `fetch` + blob URL，或把展示位改成可注入头的 `<img>`。
2. **路线 2 的关键前提有缺口**：服务端 session **不持久化** `activeWorkspaceId`（`server/auth/session.js` 仅存 `user_id`）；所谓「回退到会话 activeWorkspaceId」在实现上必须**额外计算**（如 `navigationForUser().defaultWorkspaceId`），且该值与教师端**客户端切换的工作空间**（`ConsoleContext` 的 `selectedWorkspaceId`）可能不一致——多工作空间控制台用户存在上下文错位风险。
3. **D-10 必须修**：无论选哪条路线，`Cache-Control: private, max-age=3600` 且无 `Vary` 都会在 Phase 4 班级可见范围场景下造成**权限撤销最长滞后 1 小时**；此问题只能服务端收口。
4. **路线 1 已有参照实现**：`src/student/components/BookCover.jsx` + `PdfBookPage.jsx` 的 pdfjs `httpHeaders` 模式已验证可行；改造成本可控（约 10–12 处消费位 + 1 个共享 hook），且不削弱 integration router 全局「缺头即 400」契约。

**前置条件（任何路线落地前必须满足）：**

- 资产 GET 响应改为 `no-store` 或等价「每次回源鉴权」策略（见 §2）。
- Phase 4 实施 `book_access_grants` 时，`getBookAsset` 与 `listBooks` / `getPage` **口径一致**（B-4）。
- 验收不得走「书架 → 详情」预热路径；必须含**冷启动直达**用例（见 §3.4）。

---

## 1. 问题重述

### 1.1 鉴权矩阵（已实测，见 defect-ledger §8）

| 请求形态 | Cookie | `X-Workspace-Id` | 结果 |
|---|---|---|---|
| `fetch` + credentials + 工作空间头 | 有 | 有 | **200** |
| 裸 `<img>` / CSS `url()` 冷请求 | 有 | **无** | **400** |
| 未登录 | 无 | 无 | **401** |
| 同一 URL 1h 内被带头请求预热后 | — | — | 裸请求**可能 200**（缓存污染） |

资产路由挂在 `integration-router.js` 全局 `requireSession` + `requireWorkspace` 之后（L387–388），**无例外**。

### 1.2 已改造 vs 未改造

| 状态 | 位置 | 消费方式 |
|---|---|---|
| ✅ 已改造 | 学生首页/书架 `BookCover.jsx` | `fetch` + blob URL |
| ✅ 已改造 | 阅读器 PDF `PdfBookPage.jsx` | pdfjs `httpHeaders` |
| ❌ 未改造 | 学生详情 `BookDetail.jsx` → `ui.jsx` `BookCover` | 裸 `<img>` + 公开 `/covers/` 回退 |
| ❌ 未改造 | 教师书库/详情/安排 `BookLibrary` / `BookDetail` / `ArrangeList` 等 | CSS `background-image` 或裸 `<img>` |
| ❌ 独立问题 | 社区 `PostCard` / `PostDetail` | 硬编码 `public/covers/${book.id}.jpg` |

---

## 2. 路线评估

### 路线 1：前端逐个改造（`fetch` + `URL.createObjectURL`）

**做法：** 抽取共享 hook（如 `useProtectedAssetUrl`），所有封面消费位统一走带头 fetch；CSS 背景位改为 `<img>` 或动态 blob URL。

**优点：**

- 不触碰全局 `requireWorkspace` 契约；`identity-core.test.js` L578–582「有 Cookie 无头 → 400」**继续有效**。
- 工作空间上下文与现有 API 调用一致（来自 `runtime.data.workspaceId` / `ConsoleContext.workspace.id`）。
- 学生端已有生产级参照；PDF 阅读器已证明同模式可扩展到大文件 + Range。

**缺点：**

- 每新增展示位需复用 hook（可通过共享组件 + lint/契约测试约束）。
- CSS `background-image` 位需改 DOM 结构（教师端书库卡片约 5 处）。
- 组件持有 blob URL 期间，权限撤销后内存中仍有副本（见 §2.4 缓存节）。

**改动面：** 见 §3.1。

---

### 路线 2：服务端放宽（缺头时回退工作空间 + 收紧缓存）

**做法：** 仅对 `GET /books/assets/:assetId` 在缺 `X-Workspace-Id` 时，用「会话工作空间」推断 `req.workspace`；同步修改缓存头。

#### 2.1 越权风险评估（核心）

##### A. 多工作空间与 `activeWorkspaceId` 错位

**事实：** 服务端 session 表**不存储**当前工作空间（`inspectServerSession` 只返回 user）。`activeWorkspaceId` 是登录响应时由 `navigationForUser()` 计算的**客户端字段**（`service.js` L134、L198）：

```javascript
activeWorkspaceId: navigation.defaultWorkspaceId ?? workspaces[0]?.id ?? null
// defaultWorkspaceId = 优先 console 入口，否则第一个 student 入口
```

**风险场景：**

| 角色 | 场景 | 后果 |
|---|---|---|
| 学生 | 通常仅 1 个 student workspace | 回退 defaultWorkspaceId **低风险** |
| 教师/管理 | 控制台切换工作空间（`ConsoleContext.switchWorkspace`）后，API 请求带新头，但 `<img>` 无头 | 回退到**登录默认** workspace，可能与 UI 所选 workspace **不一致** |
| 同 org 多 workspace | 资产按 `organization_id_at_creation` 隔离，非 per-workspace | Teacher 在 grade workspace 看图，回退到 class workspace：若两者均有 `book.read`，**仍可能 200**——不是跨 org 泄漏，但是**授权上下文与 UI 不一致** |
| 未来 Phase 4 | 班级 grants 按 `classIds` 过滤学生 | 过滤应基于**用户班级成员关系**，不应依赖 workspace 头；若实现正确，workspace 回退**不削弱**班级过滤 |

**跨工作空间读取资产？**

- `resolveWorkspace(userId, workspaceId)` 强制 membership 校验（`findWorkspaceForUser`）；用户无法回退到**不属于自己**的 workspace → **不会跨用户/workspace  membership 越权**。
- 资产 SQL（`getBookAsset` L184–191）额外约束：`organization_id_at_creation` + `book.status = 'published'`。
- **当前未实现** `book_access_grants` 班级过滤；Phase 4 前，回退不会比「任意有 book.read 的 workspace」更宽。
- **结论：** 在 Phase 4 前，路线 2 对**学生单 workspace** 场景相对安全；对**教师多 workspace 切换**存在上下文错位（可能看到封面但非严格意义上的「当前 workspace 视图」）。**不能**把「登录 defaultWorkspaceId」等同于「用户当前操作 workspace」。

##### B. 资产授权判定链条（除 workspace 外）

`getBookAsset` 当前检查项：

1. `requireSession` → 有效 Cookie
2. `requireWorkspace`（或回退）→ membership + `resolveWorkspace`
3. `authorize('book.read')` → 角色 + workspace scope（`permissions.js` + `context.js` L46–59）
4. SQL：`organization_id` 匹配 + `book.status = 'published'`
5. **尚未有** grants 班级过滤（Phase 4 待加，B-4 要求与 listBooks/getPage 一致）

**回退不会跳过 3–4**；Phase 4 必须在 `getBookAsset` 内显式加 grants 检查（用 `studentResourceScope` 的 `classIds`），**不能**假设 workspace 头本身完成班级隔离。

##### C. 是否应仅对资产路由开放

**是，必须路由级隔离。** 建议实现：

```
router.use(requireSession)
router.get('/books/assets/:assetId', requireWorkspaceOrAssetFallback, handler)  // 例外在前
router.use(requireWorkspace)  // 其余路由保持严格
```

或：在 `requireWorkspace` 内检测 `req.method === 'GET' && req.path.match(/^\/books\/assets\//)` 且 `Accept` 含 `image/*` / `application/pdf`——**不推荐**隐式 Accept 嗅探，易误伤；**推荐**路由级专用中间件。

**不得**对整个 integration router 放宽，否则写操作可能在缺头时被错误赋 workspace。

##### D. 路线 2 安全可行性结论

| 维度 | 结论 |
|---|---|
| 跨 org / 跨 membership 读他人资产 | **不可行**（resolveWorkspace 拦截） |
| 学生单 workspace | **可行**（回退 ≈ 正常头） |
| 教师多 workspace 切换 | **有条件风险**（UI workspace ≠ 回退 workspace；封面可能仍显示但上下文不一致） |
| Phase 4 班级可见范围 | **必须**同步在 `getBookAsset` 实现 grants；否则任何路线都不安全 |
| 全局鉴权契约 | 需调整测试适用范围（见 §3.2） |

**路线 2 判定：有条件可行，但不推荐作为首选。** 若用户裁决选路线 2，必须同时满足：

1. 回退逻辑**仅**挂载于 `GET /books/assets/:assetId`（及必要的 HEAD/Range 同源处理）。
2. 回退源优先 **「本会话最近一次 `recordWorkspaceUse` 的 workspace」**（已有 audit `workspace.used` 事件），其次才是 `navigationForUser().defaultWorkspaceId`——比裸用 login default 更贴近客户端切换。若短期无法实现 last-used，须在文档与 UI 标注「切换工作空间后封面可能仍按默认 workspace 解析」。
3. Phase 4 前可落地「能看到图」；Phase 4 必须补 grants 检查。
4. **必须**同步 D-10 缓存修复（§2.4）。

---

### 路线 3（备选）：工作空间 Cookie 镜像

**做法：** 登录 / 切换 workspace 时，服务端 Set-Cookie `readmate-workspace=<id>`（HttpOnly、SameSite=Lax、Secure 生产）；资产路由在缺 `X-Workspace-Id` 时读 Cookie 回退。`<img>` 自动携带 Cookie。

**相对路线 2 的优势：** Cookie 可在 `ConsoleContext.switchWorkspace` 时同步更新，**与客户端所选 workspace 一致**；无需 blob URL。

**相对路线 1 的优势：** 裸 `<img>` / CSS `url()` 可直接工作，教师端 DOM 改动小。

**风险：** 新增 Cookie 面；需防 CSRF 读（GET 资产为只读，风险可接受）；仍需 D-10 缓存修复 + Phase 4 grants。

**判定：** 若强烈希望避免 blob URL 与 CSS 改造，路线 3 优于路线 2；但仍引入服务端鉴权例外，不如路线 1 契约清晰。

---

## 3. 缓存策略（D-10，所有路线必做）

### 3.1 当前问题

```javascript
// integration-router.js L561–567
'Cache-Control': 'private, max-age=3600'
// 无 Vary；浏览器按 URL 键缓存，不区分 Cookie / 工作空间 / 权限状态
```

后果：

1. **掩盖鉴权失败**：带头 fetch 预热后，无头 `<img>` 命中缓存 → D-09 被误判通过。
2. **权限撤销滞后**：教师下架 / 收窄班级后，学生浏览器最长 1h 仍可读封面与 PDF。

### 3.2 推荐响应头

**方案 A（推荐，权限即时生效优先）：**

```http
Cache-Control: private, no-store
```

- 每次请求回源鉴权；撤销发布/调整 grants 后下一次 GET 即 404。
- 封面 ~130KB × 49 本，学生书架首屏多一次回源可接受（D7 已提示 49 本规模）。

**方案 B（性能折中，需 Phase 4 后评估）：**

```http
Cache-Control: private, max-age=60, must-revalidate
Vary: Cookie
ETag: "<sha256>-<book.version>-<book.status>-<grants-hash>"
```

| 头 | 作用 |
|---|---|
| `private` | 禁止 CDN/共享缓存；仅用户私有缓存 |
| `no-store` | 完全不缓存响应体；鉴权结果不落地 |
| `Vary: Cookie` | 不同会话不共享条目（若用 max-age>0 时必需；**不能**只 Vary `X-Workspace-Id`，因为裸 img 无此头） |
| `ETag` | 权限/版本变化时 revalidate 得到新 404；需把 `book.status` 与 grants 摘要编入 etag |
| `must-revalidate` | 过期后必须回源，禁止 stale 静默使用 |

**不推荐：** 保留 `max-age=3600` 且无 `Vary: Cookie`——D-10 未解决。

### 3.3 权限撤销后客户端已缓存资产

| 层级 | 方案 A `no-store` | blob URL（路线 1） |
|---|---|---|
| HTTP 磁盘缓存 | 无条目 / 立即回源 | 同左 |
| blob URL 内存 | — | 组件 unmount 时 `revokeObjectURL`（`BookCover.jsx` L53–56 已有）；**不在 revoke 前阻止读** |
| PDF pdfjs | 走 `httpHeaders` 每次/document 生命周期 | 关闭阅读器释放；权限撤销后**下一次打开**失败即可 |

**取舍理由：** Phase 4「权限撤销即时生效」优先于「封面不必每次回源」。封面 blob 内存副本窗口 = 用户停留该页期间；可接受（非 PDF 全本泄漏）。若不可接受，可在 `visibilitychange` / 定时器上刷新 blob——**本期不做**，复杂度过高。

### 3.4 blob URL 权限撤销处理（路线 1）

1. **默认：** 依赖 `no-store` + 组件卸载 revoke；用户停留详情页期间仍见旧封面 → 产品可接受。
2. **增强（可选 Phase 4 后）：** `useProtectedAssetUrl` 监听书籍 `version` / 列表 refresh 事件，版本变则 refetch。
3. **PDF：** 已在 Reader 内用 pdfjs + 头；下架后下次进入阅读器加载失败即可，无需额外处理。

---

## 4. 推荐路线与落地计划

### 4.1 推荐：**路线 1 + 服务端 `no-store`**

#### 改动面估算

| 类别 | 文件 | 改动要点 |
|---|---|---|
| **新建** | `src/shared/useProtectedAssetUrl.js`（或 `src/shared/protectedAsset.js`） | 从 `BookCover.jsx` 抽取 hook + 可选 `<ProtectedImage>` 组件 |
| **学生端** | `src/student/components/BookCover.jsx` | 改 import 共享 hook（瘦身） |
| | `src/components/ui.jsx` | `BookCover` 改用 hook；**删除** `/covers/${book.id}.jpg` 回退 |
| | `src/student/pages/BookDetail.jsx` | 可改 import 学生专用 `BookCover`，或依赖 ui.jsx 修复 |
| | `src/student/components/PostCard.jsx` | 有图帖改用 `book.coverUrl` + hook |
| | `src/student/pages/PostDetail.jsx` | 同上 |
| **教师端** | `src/console/pages/teaching/BookLibrary.jsx` | `Cover` 组件改为 `<ProtectedCover>` |
| | `src/console/pages/teaching/BookDetail.jsx` | 背景图 → `<img>` + hook |
| | `src/console/pages/teaching/ArrangeList.jsx` | 同上 |
| | `src/console/pages/teaching/ArrangeDetail.jsx` | 裸 img → hook |
| | `src/console/pages/teaching/TeacherReader.jsx` | backgroundImage → hook |
| | `src/console/pages/Home.jsx` | arrangement 封面 img → hook |
| **服务端** | `server/http/integration-router.js` | L563 `Cache-Control` → `private, no-store` |
| **测试** | `tests/frontend/book-cover-protected-asset.test.mjs` | 扩展覆盖 ui.jsx、PostCard |
| | `tests/server/http/static-assets.test.js` 或新测 | 断言 cache 头 + 无头 400 仍成立 |
| | `tests/server/core/identity-core.test.js` L578–582 | **无需改**（路线 1） |

**合计：** 约 **1 新建 + 11 前端 + 1 服务端 + 2–3 测试文件**；纯改造约 **150–250 行**（含抽取 hook）。

#### 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 教师端 CSS 布局回归 | 中 | 保留 `aspect-[3/4]` + `object-cover` 结构 |
| 契约测试范围扩大 | 低 | 静态扫描 + 禁止 `/covers/` 回退 |
| 路线 2 若误选导致 identity 测试失败 | — | 路线 1 无此风险 |
| Phase 4 grants 未同步 | 高 | B-4 强制四口一致 |

#### 分阶段落地

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **P0** | 服务端 `no-store` | 无；立刻消除缓存污染 |
| **P1** | 共享 hook + 学生详情 + 教师书库/详情 | P0 |
| **P2** | 社区帖图 + 安排列表等次要位 | P1 |
| **P3（Phase 4）** | `getBookAsset` grants + 撤销验收 | 发布管理 API |

「能看到图」与「权限撤销即时生效」：**P0 解决缓存；P1 解决冷请求 400；P3 解决 grants**。

### 4.2 真人复验最小集

> 必须**禁用**或清空浏览器缓存，或开无痕窗口；**禁止**先访问书架再进详情。

| # | 步骤 | 通过标准 |
|---|---|---|
| 1 | 无痕登录学生 → **地址栏直达** `/student/books/book-001`（不经过首页/书架） | 详情页显示真实插画封面，非渐变文字封 |
| 2 | 无痕登录教师 → 直达 `/console/teaching/books` | 书库卡片封面正常，非灰底文字 |
| 3 | （P0 后可选）Network 面板查看封面 GET 响应头 | `Cache-Control` 含 `no-store` |
| 4 | （Phase 4 后）教师下架某书 → 学生**硬刷新**详情 | 封面不可见或回退占位（404 语义） |

**不做：** 全站 49 本逐本点验；三维翻页；阅读计时（他人占用）。

---

## 5. 社区帖图特殊情况

### 5.1 问题性质

`PostCard.jsx` / `PostDetail.jsx` 使用：

```javascript
src={`${import.meta.env.BASE_URL}covers/${book.id}.jpg`}
```

- 旧站 21 本在 `public/covers/` 有静态文件；
- 导入的 49 本**无**对应公开文件；
- 有图帖（`post.cover.type === 'image'`）依赖此书封展示。

**归属：** **本方案范围内**，但与「受保护 API 缺头」是**同一根因的不同症状**（走了公开路径而非受保护 URL）。不应单独复制封面到 `public/covers/`——**违反 B-2 §6**。

### 5.2 处置建议

1. 社区组件改为读 `book.coverUrl`（`/api/v1/books/assets/...`），走共享 `useProtectedAssetUrl`。
2. `postBook(post)` 解析出的 book 对象需含 projection 封面 URL（社区 API 已关联 bookId 时应能 join 书目投影）。
3. 契约测试：`PostCard` 不得再出现 `` `covers/${book.id}.jpg` `` 字面量。
4. **不阻塞 P1**：社区非 Phase 3 导入主路径，可放 P2；但 49 本上架后学生发有图帖会暴露，**建议在 Phase 3 批量验收前完成**。

---

## 6. 需用户裁决的问题

1. **路线选择：** 是否批准 **路线 1（前端 hook + no-store）**？若否，是否在 **路线 2（activeWorkspace 回退）** 与 **路线 3（workspace Cookie）** 中二选一？
2. **缓存取舍：** 是否接受 **`Cache-Control: private, no-store`**（封面每次回源）？若否，是否接受方案 B（60s + ETag + must-revalidate）？
3. **blob 内存窗口：** 路线 1 下，用户停留详情页期间权限被撤销仍可能看到封面——是否接受？（PDF 下次打开会失败）
4. **路线 2 若选：** 回退源用 login default 还是投入「last-used workspace」审计查询？教师切换 workspace 后封面可能与所选 scope 不一致，是否接受？
5. **社区帖图：** 是否与 P1 同步改造，还是明确推迟到 P2？

---

## 附录 A：关键代码锚点

| 主题 | 位置 |
|---|---|
| 全局 requireWorkspace | `server/http/integration-router.js` L387–388 |
| 缺头 400 | `server/middleware/request-context.js` L53–61 |
| 资产 cache 头 | `server/http/integration-router.js` L561–567 |
| getBookAsset 授权 | `server/domains/reading/catalog.js` L181–194 |
| session 无 workspace | `server/auth/session.js` L83–132 |
| activeWorkspaceId 计算 | `server/domains/identity/service.js` L134, L184–200 |
| 已改造参照 | `src/student/components/BookCover.jsx` |
| 学生详情用 ui BookCover | `src/student/pages/BookDetail.jsx` L3 |
| identity 无头 400 测试 | `tests/server/core/identity-core.test.js` L578–582 |

## 附录 B：路线对照

| 维度 | 路线 1 | 路线 2 | 路线 3 |
|---|---|---|---|
| 服务端鉴权契约 | 不变 | 资产路由例外 | 资产路由例外 |
| 教师 CSS 改造 | 需要 | 不需要 | 不需要 |
| workspace 切换一致性 | ✅ | ⚠️ | ✅（Cookie 同步） |
| blob 内存 | 有 | 无 | 无 |
| identity 测试 | 不动 | 需调整 | 需调整 |
| 推荐度 | **★★★** | ★ | ★★ |
