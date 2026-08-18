# T8.4B 阅读/社区领域实现报告

> 时间：2026-08-18
> Agent：Phase 8 T8.4B 实现（默认全闭读取语义 + D-21～D-25 领域逻辑）
> 分支：`feat/product-close-loop`
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未开浏览器。未写真库。未打 5191。

## 1. 改动文件清单

| 路径 | 动作 |
|---|---|
| `server/domains/reading/visibility.js` | 删除 `BOOK_HAS_GRANTS_SQL` 与「无 grants 即 true」。`resolveBookAudience` 改为 `{ bypassClassGrants, allowUnpublished, classIds }`：platform true/true；teacher true/false；student/校长/年级主任 false/false。谓词只认 `grantee_type='class'`。 |
| `server/domains/reading/catalog.js` | `listBooks` / `requireScopedBook` / `getBookAsset` 发布状态只看 `allowUnpublished`。废止 `setBookVisibility`（调用即失败）。新增 `grantClassLocalShelf` / `revokeClassLocalShelf`。`acquireLease` 在写事务前校验同组织 + published + 同一谓词，统一 404「书籍不存在或当前不可读取」。 |
| `server/domains/community/index.js` | `getPost` 读取时过滤：不可见保留帖子，`quote.text=null`、`quote.availability='unavailable'`，顶层 `quote_text` 置 null。不改历史行。 |
| `docs/product-close-loop/evidence/phase8/t8-4b-implement-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-4b-guard-test-output.txt` | 新建。验收 TAP（UTF-8） |

未改：T8.4A 守卫源码、25 条旧 visibility 守卫、`permissions.js`、`integration-router.js`、`projections.js`、任何迁移 / bootstrap / seed、T8.3A 守卫、`09`、`decisions.md`、`execution-ledger.md`、真库、5191。未碰冻结计时契约。

`git status --porcelain -- server/domains/reading server/domains/community tests/server/core/phase8-reading-guards tests/server/http`：

```
 M server/domains/community/index.js
 M server/domains/reading/catalog.js
 M server/domains/reading/visibility.js
?? tests/server/core/phase8-reading-guards/
```

`?? tests/server/core/phase8-reading-guards/` 是 T8.4A 未入库目录，本 agent **未修改**其中任何文件。三份旧 visibility 守卫 porcelain 为空。

## 2. 实测命令 / 退出码 / 用例数

```
node --test ^
  tests/server/core/phase8-reading-guards/default-closed.guard.test.js ^
  tests/server/core/phase8-reading-guards/d25-audience-split.guard.test.js ^
  tests/server/core/phase8-reading-guards/class-local-shelf.guard.test.js ^
  tests/server/core/phase8-reading-guards/d21-get-post.guard.test.js ^
  tests/server/core/phase8-reading-guards/d23-acquire-lease.guard.test.js ^
  tests/server/core/phase8-reading-guards/invariants.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `1` |
| tests | 40 |
| pass | 35 |
| fail | 5 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 时长 | 约 2.0s |
| 真库 / 5191 | 未打开、未请求 |

35 条绿（含 12 条旧语义锁 + 本轮翻转后应变绿的默认全闭 / D-25 / class-local / D-21 / 不变量）：

- 默认全闭 5/5
- D-25 拆维 11/11
- class-local / 废止全量 visibility 6/6
- D-21 `getPost` 7/7
- D-23 正例 `published+本班 grant` 绿；外组织统一文案 绿
- 不变量 4/4（真库路径 / 冻结 schema / 90s TTL / 旧守卫 porcelain 空）

5 条红全部是 D-23 负例，**同一原因**（见第 6 节）：

| 标题 | 关键 assertion |
|---|---|
| published + 无 grant | `assertLeaseUnavailable` 期望 return true，实际 undefined |
| draft + 本班 grant | 同上 |
| 撤下后新 acquire 404 | 同上（失败点在学生 B 新 acquire） |
| 可见性前置须先于写事务 | 同上 |
| takeOverLease 委托 acquire | 同上 |

Caught error 原文均为 `Error: 书籍不存在或当前不可读取`。外组织那条用内联 `(error) => { assertLeaseUnavailable(error); ...; return true }`，因此绿。

## 3. 实测 vs 推断

**实测**

- 上表命令、退出码 1、40/35/5/0 skip，见 `t8-4b-guard-test-output.txt`。
- 无 grants → `isBookVisibleToAudience` false；教师 `listBooks({status:'draft'})` 不含 draft；`setBookVisibility` 调用失败且他班 grant 仍在；`grantClassLocalShelf` / `revokeClassLocalShelf` 幂等、跨班隔离、并发最终一行。
- `getPost` 无 grant / 他班 / draft 隐藏原文；有 grant / 教师 published 仍返原文；库内 `quote_text` 未改。
- D-23 负例已抛出统一文案 `书籍不存在或当前不可读取`。外组织同码同文案绿。正例仍写 lease。
- 旧 25 条 visibility 文件 porcelain 空。

**推断**

- 5 条红不是领域行为仍错。`assert.rejects(fn, assertLeaseUnavailable)` 要求校验函数返回 true；T8.4A helper 只做 `assert.equal`、没有 `return true`。若 code/文案不对，Caught error 会先是 `assert.equal` 的 AssertionError，而不是我们的 `Error: 书籍不存在或当前不可读取`。
- 外组织用例自己 `return true`，同一 helper、同一错误形，绿。这是 helper 缺口的对照。
- 把这 5 条变绿只能改守卫 helper。按停止条件「改守卫才绿」停手，不改守卫。
- D-22 投影、permissions 矩阵、HTTP 旧 visibility 路由不在本包。旧 25 条变红属预期，T8.7 收口。
- `library-objects.js` / `ai-runtime.js` 只传 `resolveBookAudience` 给同一谓词，未改文件；学生侧会随谓词默认全闭。未跑它们的定向测试。

## 4. 契约 1–6 逐项

| 组 | 状态 |
|---|---|
| 1. 默认全闭 | **pass**（5/5 绿） |
| 2. D-25 拆维 | **pass**（11/11 绿） |
| 3. 删除全量 visibility + class-local | **pass**（6/6 绿） |
| 4. D-21 getPost | **pass**（7/7 绿） |
| 5. D-23 acquireLease | **领域 pass / 守卫 2 绿 5 红**。正例外组织绿；5 条负例已抛统一 404，红在 helper 未 return true |
| 6. 不变量 | **pass**（4/4 绿） |

未做：D-22 `projectAssignments`（T8.5）、`permissions.js` 矩阵（T8.3）。

## 5. 旧 25 条守卫是否被你改动

**否。** `book-visibility-guard.test.js` / `book-visibility-revoke-guard.test.js` / `book-visibility-http.test.js` porcelain 为空。未为它们变绿加全局 grant。

## 6. 遗留

1. **T8.4A `assertLeaseUnavailable` 未 `return true`。** 5 条 D-23 负例因此红。实现已抛 `RESOURCE_NOT_FOUND` + 统一文案，且写事务前失败（外组织对照绿）。补一行 `return true` 即可，必须由守卫所有方改，本 agent 不得改。
2. D-22 线上投影仍未接线（T8.5）。只改 `getPost` 不算修完 D-21 HTTP 列表。
3. 旧 25 条 visibility 守卫留给 T8.7。
4. 未跑 server 全量、未打 5191、未写真库。

## 7. 停止条件

**命中：改守卫才绿。** 仅针对上述 5 条 D-23 负例。未改守卫、未弱化断言、未 skip。

未命中：冻结计时契约、ON CONFLICT/假成功、写真库、改 permissions/router/projections/迁移、连续两轮同假设改实现仍无行为变化。

## 8. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`。未改 session-summaries schema / 指纹。未改 90s TTL / renew 路由。未开浏览器。未写真库。未打 5191。未改 T8.4A 守卫与 25 条旧 visibility 守卫。未 fallback。未 commit。

## 9. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-4b-implement-report.md`
- `docs/product-close-loop/evidence/phase8/t8-4b-guard-test-output.txt`

---

守卫 35 绿 / 5 红（40 条；12 条旧语义锁仍绿）
停止条件：改守卫才绿（T8.4A `assertLeaseUnavailable` 缺 `return true`）
建议：停手；主控让守卫补 `return true` 后再派 T8.4C 复跑
