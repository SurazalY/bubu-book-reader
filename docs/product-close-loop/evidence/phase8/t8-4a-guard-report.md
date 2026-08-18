# T8.4A 阅读/社区领域守卫报告

> 时间：2026-08-18
> Agent：Phase 8 T8.4A 独立守卫（只写测试，不实现 reading/community）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。

## 1. 改动文件清单

仅新建允许路径：

| 路径 | 动作 |
|---|---|
| `tests/server/core/phase8-reading-guards/shared-harness.guard.test.js` | 新建。临时库 + `runMigrations` + 显式 grant helper |
| `tests/server/core/phase8-reading-guards/default-closed.guard.test.js` | 新建。默认全闭 5 条 |
| `tests/server/core/phase8-reading-guards/d25-audience-split.guard.test.js` | 新建。D-25 拆维 11 条 |
| `tests/server/core/phase8-reading-guards/class-local-shelf.guard.test.js` | 新建。废止全量 visibility + class-local 6 条 |
| `tests/server/core/phase8-reading-guards/d21-get-post.guard.test.js` | 新建。D-21 `getPost` 7 条 |
| `tests/server/core/phase8-reading-guards/d23-acquire-lease.guard.test.js` | 新建。D-23 `acquireLease` 7 条 |
| `tests/server/core/phase8-reading-guards/invariants.guard.test.js` | 新建。冻结表 / TTL / 旧守卫 / 真库 4 条 |
| `docs/product-close-loop/evidence/phase8/t8-4a-guard-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-4a-guard-test-output.txt` | 新建。原始 TAP（UTF-8） |

未改：`server/domains/reading/**`、`community/**`、`identity/permissions.js`、`integration-router.js`、`projections.js`、25 条旧 visibility 守卫、任何迁移、bootstrap、seed、T8.2/T8.3 守卫、`09`、`decisions.md`、`execution-ledger.md`、真库、5191。未 commit。

T8.4B 必须实现的领域函数名（守卫已写死）：

- `createReadingDomain().grantClassLocalShelf({ bookId, classId })`
- `createReadingDomain().revokeClassLocalShelf({ bookId, classId })`
- `setBookVisibility` 删除或调用即失败
- `resolveBookAudience` 返回 `{ bypassClassGrants, allowUnpublished, classIds }`，不得再有 `unrestricted`

D-22 `projectAssignments` 不在本包；注释写明共享谓词由 T8.5 复用。

## 2. 实测命令 / 退出码 / 用例数 / 失败标题

Windows glob 不作为唯一入口。实测显式列出 6 个有用例的文件（`shared-harness.guard.test.js` 只导出夹具，0 条 `test()`）：

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
| 退出码 | `1`（整体红；T8.4A 成功态） |
| tests | 40 |
| pass | 12 |
| fail | 28 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 加载 | 可加载；失败全部 `ERR_ASSERTION`，无 syntax / import / 模块加载失败 |
| 时长 | 约 2.0s |
| 真库 / 5191 | 未打开、未请求 |

12 条绿是**当前旧语义已经成立的锁**，不是实现已翻转：

| 绿 | 原因 |
|---|---|
| 默认全闭：仅他班 grant → false | 旧模型「有 grants 即收窄」已如此 |
| 默认全闭：本班 grant + published → true | 旧模型已如此 |
| 默认全闭：classIds 为空 → false | 旧模型在「已有 grants」时已如此 |
| 未知 grantee_type → false | 旧 `BOOK_GRANTED_TO_CLASS_SQL` 已滤 `class` |
| D-21 有 grant 仍返 quote.text | 旧 `getPost` 原样返回 |
| D-21 教师看 published | 旧实现不过滤，文本仍在 |
| D-21 跨组织 404 | `assertOrganization` 已在 |
| D-23 published+本班 grant → 有 lease | 旧 `acquireLease` 本就不验可见性，正例碰巧 200 |
| 4 条不变量 | 真库路径 / 冻结 schema / 90s TTL / 旧守卫 porcelain 空 |

28 条红与关键 assertion（全部实测，不是抄标题）：

| 标题 | 关键 assertion |
|---|---|
| 默认全闭：无 grants → false | `true !== false`（旧「无 grants 即 true」） |
| D-25 resolveBookAudience 不再返回 unrestricted | `unrestricted` 实际 `false`/`true`，期望 `undefined` |
| D-25 platform / teacher / student 拆维 | 同上，缺 `bypassClassGrants`/`allowUnpublished` |
| D-25 校长 / 年级主任无书库 audience | `unrestricted === true`（仍吃 `BOOK_LIBRARY_MANAGEMENT_ROLES`） |
| D-25 教师不得列 draft | `listBooks({status:'draft'})` 仍含 draft |
| D-25 教师书库只列 published | 同上 |
| D-25 教师取 draft 资产 404 | `Missing expected rejection`（旧 unrestricted 放行） |
| D-25 新发布不自动投放 | grants=0 后学生谓词仍 `true` |
| D-25 bypass 只绕过 grant | 仅他班 grant + `platformAudience()` 现为 `false` |
| setBookVisibility 必须不再可用 | 平台 `scope=organization` 仍成功，`true !== false` |
| class-local grant / revoke / 并发 / 跨班 / 禁 publish | `typeof grantClassLocalShelf === 'undefined'` |
| D-21 无 grant / 他班 / draft / 撤后隐藏 | `quote.text` 仍是原文，不是 `null` |
| D-23 无 grant / draft / 撤下后新 acquire / 前置事务 / takeOver | `Missing expected rejection`（仍 200 写 lease） |
| D-23 外组织 | 文案仍是「书籍版本不存在于当前组织」，不是统一「书籍不存在或当前不可读取」 |

## 3. 实测 vs 推断

**实测**

- 命令、退出码 1、40/12/28/0 skip，见 `t8-4a-guard-test-output.txt`。
- `git status --porcelain` 对三份旧 visibility 守卫文件为空。
- 临时库路径均在 `os.tmpdir()` 下，断言拒绝 `server/data/readmate.sqlite`。
- 当前 `isBookVisibleToAudience` 无 grants → `true`；`resolveBookAudience` 仍返回 `{ unrestricted, classIds }`；`acquireLease` 对无 grant / draft 仍成功；`getPost` 仍返回 `quote.text`。
- `setBookVisibility` 在平台账号 + `scope=organization` 下仍成功（已避开教师 F-1 假绿）。

**推断**

- T8.4B 按上述函数名实现后，28 条应变绿；12 条锁应保持绿。若靠改守卫消红，按停止条件处理。
- 旧 25 条 visibility 守卫会在 T8.4B 之后变红，属预期，由 T8.7 收口。
- D-22 线上投影未测；只改 `getPost` 不算修完 D-21 的 HTTP 列表，那是 T8.5。

## 4. 契约 1–6 逐项

| 组 | 状态 |
|---|---|
| 1. 默认全闭 | **已写 / 运行红**（无 grants 那条红；他班 / 本班 / 空 classIds / 未知类型为锁绿） |
| 2. D-25 拆维 | **已写 / 运行红**（11 条全红） |
| 3. 删除全量 visibility + class-local | **已写 / 运行红**（6 条全红） |
| 4. D-21 getPost | **已写 / 运行红**（4 条隐藏路径红；有 grant / 教师 / 跨组织锁绿） |
| 5. D-23 acquireLease | **已写 / 运行红**（6 条红；published+本班 grant 锁绿） |
| 6. 不变量 | **已写 / 运行绿**（冻结 schema、TTL、真库、旧守卫未改） |

未写：D-22 `projectAssignments`（T8.5）、`permissions.js` 矩阵（T8.3A）。

## 5. 遗留

- T8.4B 必须实现 `grantClassLocalShelf` / `revokeClassLocalShelf`，并废止 `setBookVisibility`。
- `getPost` 隐藏时不得继续用 `...post` 泄露顶层 `quote_text`。
- `acquireLease` 统一 404 文案，且检查必须在任何 `BEGIN IMMEDIATE` 写事务之前。
- 旧 25 条守卫留给 T8.7。
- 本包不接线 `projections.js`。

## 6. 停止条件

未命中。未改禁止文件；未碰冻结计时契约；未连真库；无 skip / 弱断言；未改 `visibility.js`。

## 7. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`；未改 session-summaries schema / 指纹；未改 90s TTL / renew 路由。未开浏览器。未写真库。未打 5191。未 skip。未 commit。

## 8. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-4a-guard-report.md`
- `docs/product-close-loop/evidence/phase8/t8-4a-guard-test-output.txt`

---

tests/server/core/phase8-reading-guards/*.guard.test.js
红（40 条，12 pass / 28 fail，可加载）
建议 T8.4B
