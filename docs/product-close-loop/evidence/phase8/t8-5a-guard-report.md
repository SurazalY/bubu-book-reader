# T8.5A HTTP/API 守卫报告

> 时间：2026-08-18
> Agent：Phase 8 T8.5A 独立守卫（只写测试，不实现 HTTP/router/projections/API client）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。

## 1. 改动文件清单

仅新建允许路径：

| 路径 | 动作 |
|---|---|
| `tests/server/http/phase8-http-guards/shared-harness.guard.test.js` | 新建。`createReadmateApplication` + 临时库 + `runMigrations` + 独立端口 + 显式 grant |
| `tests/server/http/phase8-http-guards/visibility-deleted.guard.test.js` | 新建。A 旧 visibility HTTP 删除 3 条 |
| `tests/server/http/phase8-http-guards/class-shelf-http.guard.test.js` | 新建。B 书架 HTTP 6 条 |
| `tests/server/http/phase8-http-guards/publish-school-forbidden.guard.test.js` | 新建。C 学校角色 publish 403 / platform 不写 grants 3 条 |
| `tests/server/http/phase8-http-guards/d21-community-list.guard.test.js` | 新建。D D-21 列表投影 5 条（含源码接到同一谓词） |
| `tests/server/http/phase8-http-guards/d22-assignments-list.guard.test.js` | 新建。E D-22 安排投影 4 条 |
| `tests/server/http/phase8-http-guards/api-client.guard.test.js` | 新建。F API client 3 条 |
| `tests/server/http/phase8-http-guards/invariants.guard.test.js` | 新建。G 真库/端口/挂载链 3 条 |
| `docs/product-close-loop/evidence/phase8/t8-5a-guard-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-5a-guard-test-output.txt` | 新建。原始 TAP（UTF-8） |

未改：`integration-router.js`、`projections.js`、`src/api/*`、identity、reading、community、迁移、T8.3/T8.4 守卫、25 条旧 visibility、`book-visibility-http.test.js`、`09`、ledger、真库、5191。未 commit。未实现 HTTP。

T8.5B 必须实现的契约名（守卫已写死）：

- 删除 `GET/PUT /books/:bookId/visibility`；标准 JSON 404；无 `scope=organization` 兼容分支
- `GET /classes/:classId/shelf`、`PUT/DELETE /classes/:classId/shelf/:bookId`；禁止 `listAuthorizedClasses`
- `projectCommunityPosts` / `projectAssignments` 调用 T8.4 同一 `isBookVisibleToAudience`
- `createConsoleApi()`：`getClassShelf` / `putClassShelfBook` / `deleteClassShelfBook`；删除 `getBookVisibility` / `setBookVisibility`
- `createAuthApi().login` body 为 `{schoolCode, loginName, password}`
- `createStudentApi()`：`getRegistration`、`registerWithToken` 或 `submitRegistration`、`getOnboardingMe`、以及 `getMyEnrollment` / `getEnrollmentSelf` / `listMyEnrollmentRequests` 之一

## 2. 实测命令 / 退出码 / 用例数 / 失败标题

Windows 上显式列出 7 个有用例的文件（`shared-harness.guard.test.js` 只导出夹具，0 条 `test()`）：

```
node --test ^
  tests/server/http/phase8-http-guards/visibility-deleted.guard.test.js ^
  tests/server/http/phase8-http-guards/class-shelf-http.guard.test.js ^
  tests/server/http/phase8-http-guards/publish-school-forbidden.guard.test.js ^
  tests/server/http/phase8-http-guards/d21-community-list.guard.test.js ^
  tests/server/http/phase8-http-guards/d22-assignments-list.guard.test.js ^
  tests/server/http/phase8-http-guards/api-client.guard.test.js ^
  tests/server/http/phase8-http-guards/invariants.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `1`（整体红；T8.5A 成功态） |
| tests | 27 |
| pass | 1 |
| fail | 26 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 加载 | 可加载；失败全部 `ERR_ASSERTION`，无 syntax / import / TypeError / SQLITE |
| 时长 | 约 1.8s |
| 真库 / 5191 | 未打开写、未请求 |

1 条绿是夹具自己保证的锁，不是 T8.5 已接线：

| 绿 | 原因 |
|---|---|
| G. 临时库路径不得指向真库，独立端口不得为 5191 | 夹具 `mkdtemp` + `listen(0)` |

26 条红与关键 assertion（全部实测）：

| 标题 | 关键 assertion |
|---|---|
| A. 删除 GET/PUT visibility 源码 | `router.get('/books/:bookId/visibility')` 仍在 |
| A. GET visibility 标准 JSON 404 且链可到达 | `requireIntegrationReachable`：GET /books 实际 404「资源不存在」 |
| A. PUT visibility scope=organization 也 404 | 同上，先被 identity 兜底挡住 |
| B. 必须注册 shelf 路由且禁 listAuthorizedClasses | GET `/classes/:classId/shelf` 块为空 |
| B. 本班 PUT/GET/DELETE 200 幂等 | GET /books 404，integration 未挂上 |
| B. 他班 / 无 C workspace 403 或 404 | 同上 |
| B. 跨组织与不存在同文案 404 | 同上 |
| B. 并发同班同书一行 | 同上 |
| B. 一班撤下不影响他班 | 同上 |
| C. 教师 publish/unpublish 403 | 期望 403，实际 identity 兜底 404 |
| C. 校长 / 年级主任 publish 403 | 校长 publish 实际 404 |
| C. platform 200 且不写/清 grants | platform publish 实际 404 |
| D. projectCommunityPosts 接同一谓词 | 源码无 `isBookVisibleToAudience` |
| D-21 无 grant / 他班 / draft 隐藏原文 | GET /community/posts 实际 404 |
| D-21 有 grant 仍返原文 | 同上 |
| E. projectAssignments 接同一谓词 | 函数体内无 `isBookVisibleToAudience` |
| D-22 无 grant / 他班 / draft 整项省略 | GET /assignments 实际 404 |
| D-22 有 grant 返回、撤下后消失 | 同上 |
| F. console.js shelf API、无 visibility 写 | `getClassShelf` 为 `undefined` |
| F. auth.js schoolCode+loginName | 仍是 `{ username, password }` |
| F. student.js registration/onboarding/enrollment 读 | `getRegistration` 为 `undefined` |
| G. GET /books 必须打到 integration-router | 实际 404「资源不存在」 |
| G. 书架路由块不得 listAuthorizedClasses | 还没有 `/classes/:classId/shelf` |

## 3. 实测 vs 推断

**实测**

- 上表命令、退出码 1、27/1/26/0 skip，见 `t8-5a-guard-test-output.txt`。
- `git status --porcelain` 对三份旧 visibility 守卫与 `integration-router.js` / `projections.js` / `src/api/*` 为空；本包只有 `?? tests/server/http/phase8-http-guards/`。
- 探针与守卫一致：`createReadmateApplication` 登录 200 后，`GET /books`、`GET /community/posts`、`GET /assignments`、`GET /books/:id/visibility`、`GET /classes/:id/shelf` 全部被 identity 末尾 `router.use` 兜底成标准 JSON 404「资源不存在」。integration-router 根本收不到这些请求。
- 因此 A 的 HTTP 404 **不能**当成「旧 visibility 已删除」。旧路由仍在源码里；当前 404 是挂载顺序问题。守卫用 `requireIntegrationReachable`（先要求 GET /books 200）挡住这条假绿。
- API client 与两处投影源码断言不依赖 HTTP 挂载，红在契约本身。

**推断**

- T8.5 允许改的文件是 `integration-router.js`、`projections.js`（只两处）、`src/api/{auth,console,student}.js`。**改不了** `server/domains/identity/index.js`。T8.5B 就算接好书架/投影/API，真实 HTTP 仍会被 identity catch-all 吞掉，B/C/D/E 的 HTTP 条会继续红在 404，不是契约。
- identity 兜底应改为：未匹配身份路由时 `next()`，让 integration-router 接手；标准 JSON 404 放到整条 `/api/v1` 链末端。这是 T8.3 挂载副作用，不是 T8.5B 能修的。
- identity 兜底修好之后，本套守卫应变为「旧 visibility 仍 200 / 投影漏 quote.text / API 仍有 visibility 函数」那种契约红，再派 T8.5B。
- 兜底修好后，C 的教师 403 可能因 T8.3 permissions + catalog 仍 `authorize('book.publish')` 先变绿，属锁，不是越界。

## 4. 契约 A–G 逐项

| 组 | 守卫 | 本轮运行 |
|---|---|---|
| A 删除旧 visibility HTTP | 已写（源码 + 真实 HTTP，且要求链可到达） | 3 红 |
| B 书架 HTTP | 已写（本班 200 幂等 / 他班或无 C / 跨组织同文案 / 并发一行 / 撤下隔离 / 禁 listAuthorizedClasses） | 6 红 |
| C 学校角色 publish 403；platform 不写 grants | 已写 | 3 红（现红在 identity 404，不是 403/200） |
| D D-21 列表 | 已写；测 `GET /community/posts`，不是只测 getPost | 5 红 |
| E D-22 列表 | 已写；不可见整项省略 | 4 红 |
| F API client | 已写 | 3 红 |
| G 不碰真库、端口 ≠ 5191、链可到达 | 已写 | 1 绿 / 2 红 |

## 5. 遗留

- **阻塞 T8.5B：** identity router 末尾 catch-all 吞掉 integration-router。主控需先派 T8.3 所有者（或另开热修）把未匹配改为 `next()`，再派 T8.5B。
- 25 条旧 visibility 与 `book-visibility-http.test.js` 未改，留给 T8.7。
- 未跑 server 全量，未打 5191，未写真库。

## 6. 停止条件

未命中实现越界。未改禁止文件。未连真库。无 skip。未实现 HTTP。

发现一条 **T8.5B 无法在自己文件所有权内消除的挂载缺陷**。按「一次修复必须改变它声称要改变的可观测行为」：若现在派 T8.5B，他们改 router/投影后真实 HTTP 仍是 identity 404，属于因果模型错误，应先停。

## 7. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`；未改 session-summaries schema / 指纹；未改 90s TTL / renew。未开浏览器。未写真库。未打 5191。未 skip。未 commit。未改 T8.3/T8.4 守卫。未改 25 条旧 visibility。

## 8. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-5a-guard-report.md`
- `docs/product-close-loop/evidence/phase8/t8-5a-guard-test-output.txt`

---

tests/server/http/phase8-http-guards/*.guard.test.js
红（27 条，1 pass / 26 fail，可加载）
建议停手
