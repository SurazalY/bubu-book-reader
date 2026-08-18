# T8.5B HTTP/API 实现报告

> 时间：2026-08-18
> Agent：Phase 8 T8.5B HTTP/API 实现（按 T8.5A 守卫接线 integration-router / 两处投影 / API client）
> 分支：`feat/product-close-loop`
> HEAD 前缀：`b3cd4b5`
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未改 T8.5A 守卫。未改 identity / reading / community 领域谓词。未连真库。未打 5191。

## 1. 改动文件清单

| 路径 | 动作 |
|---|---|
| `server/http/integration-router.js` | 删除 `GET/PUT /books/:bookId/visibility`（无兼容 handler、无 `scope=organization` 分支）。注册 `GET/PUT/DELETE /classes/:classId/shelf[/:bookId]`：鉴权 `book.shelf.*`；先同组织查班（跨组织与不存在同文案 404），再要求当前 class workspace 的 `scope_id` 等于目标 classId；调用 T8.4 `grantClassLocalShelf` / `revokeClassLocalShelf`。书架块不调用 `listAuthorizedClasses`。`GET /assignments` 把 `actorId` 传给投影。publish/unpublish 路由未改，不写/清 grants。 |
| `server/integration/projections.js` | 只改 `projectCommunityPosts` 与 `projectAssignments` 及相关 import。两处调用 T8.4 `isBookVisibleToAudience`。不可见引用保留帖子，`quote.text=null`、`availability=unavailable`。学生对不可见/draft 安排整项省略；`bypassClassGrants` 的教师管理视图不按 class grant 过滤，SQL 仍限本组织。 |
| `src/api/auth.js` | `login({ schoolCode, loginName, password })`，body 不再发 `{ username, password }` |
| `src/api/console.js` | 新增 `getClassShelf` / `putClassShelfBook` / `deleteClassShelfBook`；删除 `getBookVisibility` / `setBookVisibility` |
| `src/api/student.js` | 新增 `getRegistration`、`registerWithToken`、`getOnboardingMe`、`getMyEnrollment` |
| `tests/frontend/phase8-t8-5b-api-envelope.test.mjs` | 新建。极小 envelope：login / shelf / registration 请求形 |
| `docs/product-close-loop/evidence/phase8/t8-5b-implement-report.md` | 本报告 |
| `docs/product-close-loop/evidence/phase8/t8-5b-guard-test-output.txt` | T8.5A 守卫 UTF-8 TAP |
| `docs/product-close-loop/evidence/phase8/t8-5b-envelope-test-output.txt` | 新建 envelope TAP |

未改：`tests/server/http/phase8-http-guards/**`（T8.5A，本轮零 diff）、25 条旧 visibility、`book-visibility-http.test.js`、identity（含挂载热修）、`visibility.js` / `catalog.js` / `community/index.js`、迁移、permissions、09、`decisions.md`、`execution-ledger.md`、真库、5191。未做 T8.6 前端页面。

## 2. 实测命令 / 退出码 / 用例数 / 关键原文

### 2.1 T8.5A 守卫（完成必要条件）

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

本 agent 亲自运行，未改守卫。退出码 **0**。

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests | 27 |
| pass / fail / skipped | 27 / 0 / 0 |
| 时长 | `duration_ms 1884.8675`（证据文件） |
| 真库 / 5191 | 未打开写、未请求 |

关键输出原文：

```
1..27
# tests 27
# suites 0
# pass 27
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1884.8675
```

A–G 27 条全绿，含：旧 visibility 源码删除 + 标准 JSON 404；本班书架 200 幂等 / 他班或无 C 403 或 404 / 跨组织同文案 / 并发一行 / 撤下隔离；教师与行政 publish 403、platform 200 且不动 grants；D-21 列表隐藏/可见；D-22 整项省略/撤下消失；API client 函数名；GET /books 打到 integration-router。

### 2.2 极小 envelope（可选）

```
node --test tests/frontend/phase8-t8-5b-api-envelope.test.mjs
```

退出码 `0`。tests 3 / pass 3 / fail 0。

## 3. 实测 vs 推断

**实测**

- 上表命令、exit 0、27/27，见 `t8-5b-guard-test-output.txt`。
- 热修后 `GET /books` 200，integration 链可达；旧 visibility 删除后是应用链末端标准 JSON 404，不是 identity 兜底假绿。
- 书架 PUT/DELETE 走领域 `grantClassLocalShelf` / `revokeClassLocalShelf`；并发与撤下隔离由领域幂等插入/按班删除保证。
- publish/unpublish 仍只改 `books.status` + 审计，守卫核对 grants 计数不变。

**推断**

- 既有 `tests/frontend/api-contract.test.mjs` 与 `book-publish-visibility.test.mjs` 仍锁旧 login / visibility 函数名，属 T8.6 页面与旧前端测试，不在本包验收。未改那些文件。
- 教师管理视图用 `bypassClassGrants` 跳过 class grant 过滤；校长/年级主任 audience 为 closed，本包守卫未测其 `GET /assignments` 管理列表。

## 4. 契约 A–G

| 组 | 本轮 |
|---|---|
| A 删除旧 visibility HTTP | 绿 3/3 |
| B 书架 HTTP | 绿 6/6 |
| C 学校角色 publish 403；platform 不写 grants | 绿 3/3 |
| D D-21 列表投影 | 绿 5/5 |
| E D-22 安排投影 | 绿 4/4 |
| F API client | 绿 3/3 |
| G 真库/端口/挂载链 | 绿 3/3 |

## 5. 遗留

- T8.6 前端：Login.jsx 仍调用旧 `login(username, password)`；`useBookVisibility` / `useBookWriteActions` 仍引用已删 visibility API。
- 25 条旧 visibility 与 `book-visibility-http.test.js` 仍留给 T8.7。
- 未跑 server 全量，未打 5191，未写真库。

## 6. 停止条件

未命中。未改守卫才绿。未改禁止文件。未连真库。无 skip。两轮同假设未出现。挂载热修后 HTTP 契约可在本包文件所有权内收口。

## 7. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`；未改 session-summaries schema / 指纹；未改 90s TTL / renew。未开浏览器。未写真库。未打 5191。未 skip。未 commit。未改 T8.5A / T8.3A / T8.4A 守卫。未改 25 条旧 visibility。

## 8. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-5b-implement-report.md`
- `docs/product-close-loop/evidence/phase8/t8-5b-guard-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-5b-envelope-test-output.txt`

---

守卫绿 27 / 红 0
停止条件未命中
建议 T8.5C
