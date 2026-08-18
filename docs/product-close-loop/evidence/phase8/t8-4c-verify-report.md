# T8.4C 阅读/社区领域独立验证报告

> 时间：2026-08-18
> Agent：Phase 8 T8.4C 独立验证（只验证、只报告；未参与 T8.4A / T8.4B / helper 补丁）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未改 reading/community 实现或守卫。未 commit。未开浏览器。未写真库。未打 5191。

## 1. 本轮允许产出

| 路径 | 动作 |
|---|---|
| `docs/product-close-loop/evidence/phase8/t8-4c-verify-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-4c-verify-test-output.txt` | 新建。本轮 TAP（UTF-8） |

未改任何其它文件。

## 2. 实测命令 / 退出码 / 40 条

本轮亲自运行（不是抄 T8.4B / helper 补丁）：

```
node --test tests/server/core/phase8-reading-guards/default-closed.guard.test.js tests/server/core/phase8-reading-guards/d25-audience-split.guard.test.js tests/server/core/phase8-reading-guards/class-local-shelf.guard.test.js tests/server/core/phase8-reading-guards/d21-get-post.guard.test.js tests/server/core/phase8-reading-guards/d23-acquire-lease.guard.test.js tests/server/core/phase8-reading-guards/invariants.guard.test.js
```

| 项 | 本轮实测 |
|---|---|
| 退出码 | `0` |
| tests | 40 |
| pass | 40 |
| fail | 0 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 时长 | 2068.7257 ms |
| 真库 / 5191 | 未打开、未请求。本机 `Get-NetTCPConnection -LocalPort 5191` 无连接 |

分组（按本轮 TAP 顺序，全部 `ok`）：

| 组 | TAP 编号 | 条数 | 结果 |
|---|---|---|---|
| class-local / 废止全量 visibility | 1–6 | 6 | 全绿 |
| D-21 `getPost` | 7–13 | 7 | 全绿 |
| D-23 `acquireLease` | 14–20 | 7 | 全绿 |
| D-25 拆维 | 21–31 | 11 | 全绿 |
| 默认全闭 | 32–36 | 5 | 全绿 |
| 不变量 | 37–40 | 4 | 全绿 |

40 条 `test()` 标题与 T8.4A 报告列出的 40 条一致。目录内无 `test.skip` / `test.todo` / `it.skip`。`had_skip` 只出现在冻结摘要表列名，不是跳过用例。

对照（不替代本轮数字）：T8.4A 为 12 绿 / 28 红；T8.4B 为 35 绿 / 5 红（5 条 D-23 负例卡在 helper 未 `return true`）；helper 补丁自称只复跑 D-23+不变量 11/11。本轮全套 40/40 绿，与「实现已对 + helper 只补 return true」一致。

## 3. helper 补丁：只有 `return true`

`tests/server/core/phase8-reading-guards/` 对 git 仍是 `??`，`git diff HEAD --` 对该目录为空，无法用 HEAD diff 看补丁。独立核对当前源码：

```60:65:tests/server/core/phase8-reading-guards/shared-harness.guard.test.js
export function assertLeaseUnavailable(error) {
  assert.equal(error?.code, 'RESOURCE_NOT_FOUND', `期望 RESOURCE_NOT_FOUND，实际 ${error?.code}: ${error?.message}`)
  assert.equal(error?.message, LEASE_UNAVAILABLE_MESSAGE)
  assert.notEqual(error?.code, 'PERMISSION_DENIED', '不得用 403/PERMISSION_DENIED 泄露书籍存在性')
  return true
}
```

- `LEASE_UNAVAILABLE_MESSAGE` 仍是 `'书籍不存在或当前不可读取'`。
- 仍检查 `code === RESOURCE_NOT_FOUND`、统一文案、`code !== PERMISSION_DENIED`（非 403）。
- 末行有 `return true`。
- 与 `t8-4a-helper-fix-report.md` 声称的函数级 diff 逐字一致：三条 `assert` 未改，只加 `return true`。

这不是放宽断言。Node `assert.rejects(fn, validationFn)` 要求 validation 返回 true；T8.4B 5 条红的 Caught error 已是统一文案，缺的是 helper 返回值。外组织那条自己包了 `return true`，本轮仍保留该包装，未删。

## 4. 守卫是否被弱化

**否（helper 补丁除外）。**

- 6 个有用例的守卫文件仍是 T8.4A 那 40 条标题；无删用例、无改 404 为任意 4xx、无 skip/todo。
- D-23 负例仍把 `assertLeaseUnavailable` 交给 `assert.rejects`；写探测仍要求失败路径零 `BEGIN`、零 lease/history/audit 写。
- `phase8-reading-guards/` 只有 7 个 `*.guard.test.js`，无业务实现文件混入。
- 旧 25 条 visibility 守卫 porcelain 为空（见第 5 节）。本轮不变量第 40 条也绿。

## 5. git status（本轮实测）

```
git status --porcelain -- tests/server/core/phase8-reading-guards tests/server/http/book-visibility-guard.test.js tests/server/http/book-visibility-revoke-guard.test.js tests/server/http/book-visibility-http.test.js server/domains/reading server/domains/community server/http/integration-router.js server/integration/projections.js server/domains/identity/permissions.js
```

```
 M server/domains/community/index.js
 M server/domains/identity/permissions.js
 M server/domains/reading/catalog.js
 M server/domains/reading/visibility.js
?? tests/server/core/phase8-reading-guards/
```

| 路径 | 判定 |
|---|---|
| 旧 25 条：`tests/server/http/book-visibility-*.js` 三份 | **无 M / 无 ??**。未改。 |
| `phase8-reading-guards/` | 仅 `??` 守卫目录；无 catalog/visibility/community 实现混入。 |
| `catalog.js` / `visibility.js` / `community/index.js` | T8.4B 领域实现，与 T8.4B 自称清单对齐。 |
| `permissions.js` | 工作区有 `M`，但是 **T8.3 身份矩阵**，不在 T8.4B 自称清单。`git diff --name-only HEAD -- server/domains/reading server/domains/community` 只有上述三文件。不把 T8.3 的 `M` 算进 T8.4。 |
| `integration-router.js` / `projections.js` | porcelain 空。T8.4 未碰。 |
| `server/domains/reading/monitoring.js` | porcelain 空。90s TTL / 摘要表写入路径未改。 |
| `server/db/migrations/047_*`～`050_*` | 工作区 `??`，属 **T8.2** 未入库迁移，不在 T8.4 写入范围。T8.4 未新建或改迁移。 |

## 6. 实现只读核对（对照 §13.1 / §14.3～14.5 / P8-07～P8-09 / P8-19 / P8-20）

### 6.1 默认全闭（P8-08 / §13.1.3）

`visibility.js` 已删除 `BOOK_HAS_GRANTS_SQL` 与「无 grants 即 true」。`isBookVisibleToAudience`：`bypassClassGrants` 才直接 true；否则 `classIds` 空即 false；只认 `grantee_type='class'`。本轮默认全闭 5/5 绿。

### 6.2 D-25 拆维（P8-07 / P8-19 / §13.1.2）

`resolveBookAudience` 不再返回 `unrestricted`，改为 `{ bypassClassGrants, allowUnpublished, classIds }`：platform true/true；teacher true/false；其余（含校长/年级主任/学生）false/false。`listBooks` / `requireScopedBook` / `getBookAsset` 发布状态只看 `allowUnpublished`。本轮 D-25 11/11 绿。

### 6.3 废止全量 visibility + class-local（P8-13 / P8-20 / §13.1.5）

- `setBookVisibility()` 无参即 `throw validationFailed('全量可见范围写入已废止，请使用班级书架投放/撤下')`。调用即失败。
- `grantClassLocalShelf` / `revokeClassLocalShelf` 存在。
- 授权动作为 `book.shelf.grant` / `book.shelf.revoke`，函数体不调用 `book.publish` / `publishBook` / `setBookVisibility`。
- 目标班校验走当前 class workspace 的 `scope_id` + 该 workspace 上的 teacher assignment，**未**调用 `listAuthorizedClasses`。
- DELETE 只删 `grantee_type='class'` 且本 `classId`。本轮 class-local 6/6 绿。

### 6.4 D-21 `getPost`（P8-09 / §14.3）

`getPost` 经 `projectPostQuote`：不可见时保留帖子与 `bookId`/`page`，`quote.text=null`、`quote.availability='unavailable'`，并用 `quote_text: projected.quoteText` 覆盖展开后的顶层原文。读路径无 `UPDATE community_posts`。本轮 D-21 7/7 绿。

P8-22：线上学生列表仍走 `projectCommunityPosts`，属 T8.5。只改 `getPost` 不算修完 HTTP 列表。这是范围外遗留，不是本包失败。

### 6.5 D-23 `acquireLease`（P8-09 / §14.5）

`acquireLease` 在 `transaction(...)` **之前**调用 `requireReadableBookVersionForLease`。该函数要求同组织、`books.status === 'published'`、`isBookVisibleToAudience`；失败统一 `RESOURCE_NOT_FOUND` +「书籍不存在或当前不可读取」。`takeOverLease` 仍委托 `acquireLease`。TTL 仍是 `90 * 1000`。本轮 D-23 7/7 绿，含「前置须先于写事务」。

### 6.6 冻结计时契约

| 检查 | 实测 |
|---|---|
| `monitoring.js` `LEASE_TTL_MS = 90 * 1000` | 源码仍在；porcelain 空 |
| `catalog.acquireLease` `90 * 1000` | 仍在；不变量第 39 条绿 |
| `router.post('/reading/lease/:leaseId/renew')` | 仍在；router porcelain 空 |
| `router.post('/reading/session-summaries')` | 仍在；router porcelain 空 |
| `reading_summary_sessions` / `reading_daily_book_summaries` 列 | 不变量第 38 条绿，与冻结列清单一致 |
| `projections.js` | porcelain 空 |

未命中 §16 第 16 条（改摘要表 / schema / 指纹 / TTL / renew）。

## 7. 契约 1–6 逐项

| 组 | 本轮 |
|---|---|
| 1. 默认全闭 | **pass** 5/5 |
| 2. D-25 拆维 | **pass** 11/11 |
| 3. 删除全量 visibility + class-local | **pass** 6/6 |
| 4. D-21 getPost | **pass** 7/7（领域；HTTP 列表属 T8.5） |
| 5. D-23 acquireLease | **pass** 7/7 |
| 6. 不变量 | **pass** 4/4 |

未做（范围外，不记失败）：D-22 `projectAssignments`（T8.5）、`permissions.js` 矩阵（T8.3，已 verified）、旧 25 条夹具重做（T8.7）、真实 HTTP / 5191。

## 8. 实测 vs 推断

**实测**

- 上表命令、退出码 0、40/40/0 skip，见 `t8-4c-verify-test-output.txt`。
- helper 三条断言 + `return true`；旧 25 条 porcelain 空。
- `acquireLease` 写事务前有 published+visibility；`setBookVisibility` 调用即失败；shelf 两函数存在且不调 `book.publish`。
- `getPost` 隐藏路径覆盖顶层 `quote_text`。
- 未打开 `server/data/readmate.sqlite`；未监听/请求 5191。

**推断**

- T8.4B 的 5 条红已被 helper `return true` 消掉，领域行为在 T8.4B 时已抛统一 404。本轮绿支持该因果，不是靠放宽守卫。
- D-22 / 学生社区 HTTP 列表未接线，P8-22 仍成立。主控勿把 T8.4 verified 写成 D-21/D-22 HTTP 已收口。
- 旧 25 条在默认全闭后预期会红，由 T8.7 收口。本轮未跑它们。

## 9. 停止条件

未命中。未改实现或守卫；未弱化断言；未 skip；未碰冻结计时契约；未改 router / projections / 迁移；未写真库；未打 5191。`permissions.js` 的 `M` 不归 T8.4。

## 10. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`。未改 session-summaries schema / 指纹。未改 90s TTL / renew 路由。未开浏览器。未写真库。未打 5191。未改 T8.4A 守卫（含 helper 之外的断言）与 25 条旧 visibility 守卫。未 fallback。未 commit。

## 11. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-4c-verify-report.md`
- `docs/product-close-loop/evidence/phase8/t8-4c-verify-test-output.txt`

---

与 T8.4B+helper 补丁是否一致：是
守卫是否被弱化（helper 补丁除外）：否
T8.4 实现：通过
建议：标 T8.4 verified
