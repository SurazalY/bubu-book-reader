# T8.4A 守卫补丁：`assertLeaseUnavailable` 补 `return true`

> 时间：2026-08-18
> Agent：Phase 8 T8.4A 守卫补丁（只修 helper，不改实现、不放宽断言）
> 分支：`feat/product-close-loop`
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未开浏览器。未写真库。未打 5191。

## 1. 改动文件

| 路径 | 动作 |
|---|---|
| `tests/server/core/phase8-reading-guards/shared-harness.guard.test.js` | 只改 `export function assertLeaseUnavailable` |
| `docs/product-close-loop/evidence/phase8/t8-4a-helper-fix-report.md` | 新建。本报告 |

未改：`LEASE_UNAVAILABLE_MESSAGE`、三条 `assert`、其它测试文件、`catalog.js`、`visibility.js`、`community/index.js`、`permissions.js`、`integration-router.js`、`projections.js`、迁移 / bootstrap / seed、`09`、`decisions.md`、`execution-ledger.md`、真库、5191。

该守卫文件对 git 仍是 `??`（T8.4A 未入库目录）。`git diff HEAD --` 对该路径为空；函数级 diff 如下。

## 2. Diff 只有 `return true`

```diff
 export function assertLeaseUnavailable(error) {
   assert.equal(error?.code, 'RESOURCE_NOT_FOUND', `期望 RESOURCE_NOT_FOUND，实际 ${error?.code}: ${error?.message}`)
   assert.equal(error?.message, LEASE_UNAVAILABLE_MESSAGE)
   assert.notEqual(error?.code, 'PERMISSION_DENIED', '不得用 403/PERMISSION_DENIED 泄露书籍存在性')
+  return true
 }
```

原因：Node `assert.rejects` 的 validation function 必须返回 true。契约三条 assert 已满足时，原先返回 `undefined`，Node 仍报「期望 true，实际 undefined」。外组织那条自己包了 `return true` 所以绿。这不是放宽断言。

## 3. 实测命令 / 退出码 / pass/fail

```
node --test tests/server/core/phase8-reading-guards/d23-acquire-lease.guard.test.js tests/server/core/phase8-reading-guards/invariants.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests | 11 |
| pass | 11 |
| fail | 0 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 时长 | 1257 ms |
| 真库 / 5191 | 未打开、未请求 |

D-23 7/7 绿；不变量 4/4 绿。未命中「D-23 仍红且失败信息不再是 return true / undefined」停止条件，因此未改实现。

## 4. 是否命中停止条件

否。停止条件是：补丁后 D-23 仍红，且失败信息不再是「期望 true，实际 undefined」。实测已全绿，无需贴失败原文，无需改 `catalog.js`。

## 5. 红线声明

- 只改了 `assertLeaseUnavailable` 一个函数，一个文件（另写本报告）。
- 三条 assert 原样保留；`LEASE_UNAVAILABLE_MESSAGE` 未改。
- 未改任何实现、未改其它测试、未 skip / 假成功 / fallback。
- 未换模型、未降档、无 fallback。

D-23 现状绿
是否只加了 return true：是
建议 T8.4C
