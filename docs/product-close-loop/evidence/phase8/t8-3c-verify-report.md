# T8.3C 独立验证报告

> 时间：2026-08-18
> Agent：Phase 8 T8.3C 独立验证（未参与 T8.3A / T8.3B；只验证、只报告，不修 identity 实现或守卫）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。

## 1. 改动文件清单（仅证据）

本 agent **只新建**本目录证据。未改 `server/domains/identity/**`、T8.3A 守卫、旧 identity 测试、`integration-router.js`、`projections.js`、reading / community、迁移、bootstrap、seed、`09`、`decisions.md`、`execution-ledger.md`。

| 路径 | 动作 |
|---|---|
| `docs/product-close-loop/evidence/phase8/t8-3c-verify-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-3c-guard-test-output.txt` | 新建。独立复跑 T8.3A 守卫的 UTF-8 TAP |
| `docs/product-close-loop/evidence/phase8/t8-3c-identity-core-output.txt` | 新建。独立复跑旧 identity 测试的 UTF-8 TAP |

过程说明（已清理，最终不落地）：为写 UTF-8 TAP，曾在 `%TEMP%\t8-3c-capture-output.mjs` 跑捕获脚本，跑完即删。**没有**提交进 `server/` 或 `tests/`。

未改其它仓库文件。不构成实现越权。

## 2. 实测命令、退出码、用例数、关键输出原文

以下全部由本 agent 亲自运行，不是抄 T8.3B 输出。先在本会话直接跑通一遍，再用临时捕获脚本重落 UTF-8 证据。两次结论相同。

### 2.1 T8.3A 守卫

命令：

```
node --test tests/server/core/phase8-identity-guards/**/*.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests（含无 `test()` 的 harness 文件级条目） | 71 |
| pass | 71 |
| fail | 0 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 其中真实 `test()` | 70 绿 / 0 红 |
| 时长 | 约 3.1s（证据次 `duration_ms 3095.7146`） |
| 真库 / 5191 | 未打开写、未请求 |

关键输出原文：

```
1..71
# tests 71
# suites 0
# pass 71
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3095.7146
```

### 2.2 旧 identity 契约测试

命令：

```
node --test tests/server/core/identity-core.test.js tests/server/core/identity-role-boundary.test.js
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
| 时长 | 约 2.7s（证据次 `duration_ms 2718.8729`） |

关键输出原文：

```
1..11
# tests 11
# suites 0
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2718.8729
```

### 2.3 允许路径 porcelain

```
git status --porcelain -- server/domains/identity tests/server/core/phase8-identity-guards tests/server/core/identity-core.test.js tests/server/core/identity-role-boundary.test.js
```

实测：

```
 M server/domains/identity/class-scope.js
 M server/domains/identity/index.js
 M server/domains/identity/permissions.js
 M server/domains/identity/repository.js
 M server/domains/identity/service.js
 M tests/server/core/identity-core.test.js
 M tests/server/core/identity-role-boundary.test.js
?? server/domains/identity/lifecycle.js
?? server/domains/identity/validation.js
?? tests/server/core/phase8-identity-guards/
```

守卫目录只有 `??`，无 `M`。

禁止路径：`server/http/integration-router.js`、`server/integration/projections.js` 无 porcelain。`server/domains/reading/catalog.js`、`visibility.js`、`server/domains/community/index.js` 有 `M`，属并行 T8.4 工作区脏文件，不在 T8.3B 自称清单内。

## 3. 实测 vs 推断

### 实测

- 分支 `feat/product-close-loop`，HEAD `b3cd4b532cd4e7e44398bd465112e9ff84a9684e`。
- 守卫 11 个文件 `LastWriteTime` 均在 18:20–18:30；T8.3A 报告 18:32；T8.3B identity 文件 18:42–18:53。守卫时间戳全部早于 T8.3B 实现，本轮未见事后改守卫。
- `test()` 恰好 70 个；`test.skip` / `describe.skip` / `.todo(` / `t.skip` 为 0。标题与 T8.3A 报告 A–J 逐字一致，未被删、未改名、未合并。
- 关键 throws 仍在源码：
  - P8-18R：`B. identity router 不得再注册 POST /students` 仍断言 `extractRouteBlock(..., 'post', '/students') === ''` 且无 `router.post('/students')`；HTTP 仍要求 404 `RESOURCE_NOT_FOUND`。
  - P8-17R：`D. leave_self：残缺三元组 → 500 IDENTITY_INVARIANT_VIOLATION，且不自动修` 仍 `assertHttpStatus(..., 500)` + `assertErrorCode(..., 'IDENTITY_INVARIANT_VIOLATION')`。
  - 凭据 body 注入：`E. ... body 出现 role/organizationId/scopeId → 400` 仍 `assertHttpStatus(..., 400)` + `VALIDATION_FAILED`。
- 本 agent 复跑：守卫 71/71 EXIT=0；旧 identity 11/11 EXIT=0。
- `identity/index.js` 无 `router.post('/students')`；全仓 `server/` 无 `router.post('/students')`。标准兜底 `router.use` 抛 `RESOURCE_NOT_FOUND`。
- session-only 四条（`GET /onboarding/me`、`GET /teacher/class-directory`、`PUT/DELETE /teacher/classes/:classId`）只挂 `requireSession`，源码位置在第一条 `requireWorkspace`（`GET /classes`）之前。`integration-router.js` 无这四条路径。
- `teacherVEvidence` 只调 `hasTeacherRegistrationUse` / `hasTeacherRoleEvidence`，不调 `listActiveRoleAssignments` / `requireWorkspace`。`listActiveRoleAssignments` 仍只用于既有 workspace 绑定的 `authorize()`。
- `leaveTeacherClass`：残缺先 `invariantViolation`；完整 disabled / absent 走 `writeTeacherTriple` 的 200 no-op。写路由经 `executeIdempotent` → `withTransaction` → `BEGIN IMMEDIATE`。
- `writeTeacherTriple` 插入 `role_assignments` 固定 `role_code='teacher', scope_type='class'`。`assignSchoolAdmin` 的 `scopeType: 'school'` 是 `school_admin`，不是 teacher。
- `roleAliases` 无 `grade_group`。teacher 有 `book.shelf.*`，无 `book.catalog.*` / `book.publish`。platform_ops 有 `book.catalog.*`，无 `book.shelf.*`。
- `PATCH /users/:id` 仍 `requireAccountManage`（`account.manage`）。Phase 8 新写路由未再授权该动作。`reading/monitoring.js` 仍 `authorize('account.manage')`，属 T8.4 范围。
- 注册 / 重置 `INSERT` 写入 `sha256Hex(rawToken)`；`rawToken` 只出现在 201 响应。
- `createStudentAccount` 仅定义于 `repository.js`，全仓无其它调用方。
- 真库 `server/data/readmate.sqlite` mtime 仍为 2026-08-18 12:50:22（本轮验证前已如此）；本 agent 未打开写。当前无进程监听 5191。

### 推断（与实测分开）

- 工作区还有 T8.2 / T8.4 并行脏文件。不能把 `reading/**` / `community/**` 的 `M` 算进 T8.3B；T8.3B 自称清单与 identity / 旧 identity 测试 porcelain 对齐。
- `leaveTeacherClass` 先查残缺再 `requireTeacherV`。对 V 教师的可观测行为与 P8-17R 一致（守卫 D 已绿）。非 V 且碰巧残缺会先 500 而不是 403，比「先 403 挡住不变量」更严，不据此判 fail。
- `platform_ops` 仍保留旧键 `book.publish`（与 `book.catalog.publish` 并存）。守卫 I 只锁 teacher / grade_manager / school_admin 不得再有 `book.publish`；10.2 要求 platform 有 catalog 无 shelf。不据此判 fail。
- `createStudentAccount` 死函数不是 HTTP 后门。T8.3B 已登记，不阻塞 verified。
- 旧 identity 测试把跨组织 403 收成 404 `RESOURCE_NOT_FOUND`，与 §10.1 / 守卫 J 同文案要求一致；同校学生读他生仍 403 `PERMISSION_DENIED`，未放宽。

## 4. 契约逐项 pass/fail

| 项 | 结果 | 依据 |
|---|---|---|
| 文件所有权：T8.3B 只改 `identity/**` 与登记过的旧 identity 测试；守卫目录无 `M` | **pass** | 第 2.3 节 porcelain；守卫 11 文件 mtime 早于 T8.3B；`class-scope.js` 只多两行 re-export，`BOOK_LIBRARY_MANAGEMENT_ROLES` 未改 |
| 守卫未被弱化：70 个 `test()`、无 skip/todo、P8-17R / P8-18R / 三元组残缺 500 / 凭据 body 注入 400 仍在 | **pass** | 源码对照 T8.3A 标题 + 本 agent 71/71 |
| 亲自复跑守卫 | **pass** | EXIT=0；71 pass / 0 fail / 0 skip / 0 todo |
| 亲自复跑旧 identity 测试 | **pass** | EXIT=0；11/11；未删用例 |
| POST /students 已删除，无兼容 handler | **pass** | identity / 全 `server/` 无 `router.post('/students')`；兜底 JSON 404；守卫 B/J 绿 |
| session-only 四条在 `requireWorkspace` 之前、只挂 identity | **pass** | `index.js` 298–380 行只 `requireSession`；第一条 `requireWorkspace` 在 `GET /classes`；integration-router 无这四条 |
| V 查询未调用 `listActiveRoleAssignments` / `requireWorkspace` | **pass** | `teacherVEvidence` / `requireTeacherV` 自写 `registration_credential_uses` + 同组织历史 teacher `role_assignments`（含 disabled） |
| leave_self 残缺 → `IDENTITY_INVARIANT_VIOLATION` | **pass** | `leaveTeacherClass` + `writeTeacherTriple`；守卫 D 绿 |
| 未为 V 创建 school 范围 teacher role | **pass** | 三元组只写 `scope_type='class'`；守卫 C 绿 |
| `grade_group` 别名已移除 | **pass** | `roleAliases` 无该键；守卫 H 绿 |
| teacher 无 `book.publish`；有 `book.shelf.*`；platform 有 catalog 无 shelf | **pass** | `permissions.js` + 守卫 I 绿 |
| `account.manage` 盘点属实（`PATCH /users` 仍在） | **pass** | `index.js` `requireAccountManage` 仍挂 `PATCH /users/:id`；新写路由未用该动作；整键删除会崩 PATCH 与 reading monitoring |
| token 原文不落库（INSERT 用 hash） | **pass** | `INSERT INTO registration_credentials` / `password_reset_credentials` 均 `sha256Hex(rawToken)` |
| 未碰真库 / 5191 / 冻结表 / integration-router / projections / reading | **pass** | 禁止路径无 T8.3B porcelain；identity 源码无冻结表 DDL；真库 mtime 未变；本 agent 未请求 5191 |
| 旧 identity 测试改动与 T8.3B 第 5 节登记一致 | **pass** | 只改登录体 `{schoolCode,loginName,password}`、跨组织 403→404、外校 INSERT 补 047 列；同校 403 保持 |

## 5. 遗留问题

1. `repository.createStudentAccount` 已无调用方，旧设计文档仍点名。不是 HTTP 后门，不阻塞 verified。
2. `platform_ops` 仍带旧键 `book.publish`。矩阵抽样已锁行政三角不得拥有它；旧键清理可留后续，不是本包 fail。
3. `teacher.account.*` / 10.2 每一格的「同组织越 scope + 跨组织 404」未在本包外再铺。T8.3A 已声明未逐格铺满。
4. `book.shelf.*` HTTP 属 T8.5；本任务只改了 `permissions.js` 动作。
5. 两个 Login.jsx 按 P8-21 属后续；本任务只改了 `navigationForUser`。
6. 工作区并行存在 T8.4 reading/community 脏文件。与 T8.3 验收无关，主控勿把它们算进 T8.3B。

## 6. 是否命中停止条件

未命中。

- 守卫未被改弱；不是靠改测试消红。
- 未为 V 创建 school 范围 teacher role。
- 未重新引入 `teacher.affiliation.approve`。
- 未保留 `POST /students` handler 或假 404。
- token 只在签发响应出现一次；库内为 SHA-256 hex。
- 三关系同一事务；残缺报 `IDENTITY_INVARIANT_VIOLATION`，不自动修。
- 未碰阅读摘要两表 / session-summaries / 指纹 / 90s TTL / renew。
- 未写真库、未重启 5191。
- GM 两项 school 例外只对 `registration.teacher.*` 与 `password_reset.teacher.*` 做正向检查，未改 `scopeAllows()` 让 grade 普遍包含 school。
- 本 agent 未改实现或守卫。

## 7. 未触碰红线声明

- 未改 `reading_summary_sessions` / `reading_daily_book_summaries`。
- 未改 session-summaries schema / 指纹 / 90s TTL / 续租路由。
- 未开浏览器。
- 未查询、未写 `server/data/readmate.sqlite` 及其 WAL；验证前后 size/mtime 相同（12:50）。
- 未重启 / 替换 / 请求共享 5191。
- 未改 identity 实现、T8.3A 守卫、旧 identity 测试、`integration-router.js`、`projections.js`、reading / community、迁移、bootstrap、seed、`09`、`decisions`、`execution-ledger`。
- 未 commit / push / reset / checkout / stash。
- 未 skip / 假成功 / fallback / 吞错。
- 未进入 T8.9，未启动 Phase 6。

## 8. 原始证据路径

- 本报告：`docs/product-close-loop/evidence/phase8/t8-3c-verify-report.md`
- 独立复跑守卫：`docs/product-close-loop/evidence/phase8/t8-3c-guard-test-output.txt`
- 独立复跑旧 identity：`docs/product-close-loop/evidence/phase8/t8-3c-identity-core-output.txt`
- 对照：`t8-3a-guard-report.md`、`t8-3b-implement-report.md`
- 守卫源码（只读）：`tests/server/core/phase8-identity-guards/**/*.guard.test.js`

---

- 与 T8.3B 是否一致：一致
- 守卫是否被弱化：否
- T8.3 实现：通过
- 建议：标 T8.3 verified
