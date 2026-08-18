# T8.3A 身份领域守卫报告

> 时间：2026-08-18
> Agent：Phase 8 T8.3A 独立守卫（只写测试，不实现 identity）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 性质：上一轮同任务因供应商连接失败未落地，本轮在既有 `tests/server/core/phase8-identity-guards/` 上补齐并重跑，未另起一套。

## 1. 改动文件清单

只改允许路径：

| 路径 | 动作 |
|---|---|
| `tests/server/core/phase8-identity-guards/harness.guard.test.js` | 补齐/收紧。`mkdtemp` + `createIdentityTestApp` + `importSeed`；ASCII `Idempotency-Key`；权限 middleware 抽取；外校学生凭据 |
| `tests/server/core/phase8-identity-guards/login-navigation.guard.test.js` | A 登录与导航 |
| `tests/server/core/phase8-identity-guards/students-retire.guard.test.js` | B；HTTP 404 必须是 `RESOURCE_NOT_FOUND` JSON |
| `tests/server/core/phase8-identity-guards/session-only.guard.test.js` | C；补 `GET /onboarding/me` HTTP |
| `tests/server/core/phase8-identity-guards/teacher-affiliation.guard.test.js` | D 三元组 / 强制 / 纠错 |
| `tests/server/core/phase8-identity-guards/registration.guard.test.js` | E；补跨校同名 + 显式覆盖 TTL/`maxUses` |
| `tests/server/core/phase8-identity-guards/enrollment.guard.test.js` | F；补并发批准 |
| `tests/server/core/phase8-identity-guards/password-reset.guard.test.js` | G；公开 404 必须 JSON 同码 |
| `tests/server/core/phase8-identity-guards/class-lifecycle.guard.test.js` | H；`class.create` 改为引号动作，不再误匹配幂等 scope |
| `tests/server/core/phase8-identity-guards/permissions-matrix.guard.test.js` | I；补 issue/reset/`class.create`/roleActions 抽样/行政指派 |
| `tests/server/core/phase8-identity-guards/security.guard.test.js` | J |
| `docs/product-close-loop/evidence/phase8/t8-3a-guard-report.md` | 本报告 |
| `docs/product-close-loop/evidence/phase8/t8-3a-guard-test-output.txt` | 原始 TAP |

未改：`server/domains/identity/**`、任何业务代码、T8.2 守卫、`tests/server/core/phase8-reading-guards/**`、既有 identity-core / visibility 守卫、`integration-router.js`、`projections.js`、迁移、bootstrap、`seed.js`、`09`、`decisions.md`、`execution-ledger.md`、真库、5191。未 commit。未实现 identity。

## 2. 实测命令 / 退出码 / 用例数 / 失败标题

Windows 上 `node --test tests/server/core/phase8-identity-guards/**/*.guard.test.js` **生效**。该 glob 会把无 `test()` 的 `harness.guard.test.js` 计为 1 条文件级绿。有用例文件的定向列表与之差 1。

```
node --test tests/server/core/phase8-identity-guards/**/*.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `1`（整体红；T8.3A 成功态） |
| tests（glob，含空 harness 文件） | 71 |
| pass / fail / skipped | 7 / 64 / 0 |
| 其中真实 `test()` | 70（6 绿 / 64 红 / 0 skip） |
| 加载 | 可加载；失败全部 `ERR_ASSERTION`，无 syntax / import / TypeError / SQLITE |
| 时长 | 约 3.0s |
| 真库 / 5191 | 未打开写、未请求 |

显式列表（不含 harness 文件级条目）同样 exit=1，70 / 6 pass / 64 fail / 0 skip。

6 条真实绿是**当前旧语义已经成立的锁**，不是 T8.3 已实现：

| 绿 | 原因 |
|---|---|
| I / D. 废止 `teacher.affiliation.approve` | 源码与 `roleActions` 本来就没有该动作 |
| J. 临时库路径 / 不指向真库 | 夹具自己保证 |
| J. session-only 不得挂 integration-router | 新路径本来就不在 integration-router |
| C. GET /classes 仅 S/G 可访问 | 校长/年级主任现网已能 200；教师 403 在相邻用例红 |

64 条红与关键 assertion（全部实测）：

| 标题 | 关键 assertion |
|---|---|
| A. schoolCode+loginName 登录成功 | 期望 200，实际 400 `username 与 password 均为必填项` |
| A. username-only 不得再成功 | 实际仍 200 |
| A. 失败统一 401「学校、账号或密码错误」 | 期望 401，实际 400 `VALIDATION_FAILED` |
| A. pending 学生导航 | `navigationForUser` 实际 `null`，期望 `/student/onboarding` |
| A. 零班教师导航 | 实际 `null`，期望 `/console/select-class` |
| A. 空 defaultPath 不得当登录失败 | 零 workspace 登录期望 200，实际 400 |
| B. 不得再注册 POST /students | `identity/index.js` 仍有完整 `router.post('/students')` |
| B. POST /students 标准 404 且不物化 | 期望 404 `RESOURCE_NOT_FOUND`，实际 503（旧 handler + 047 触发器） |
| C. session-only 只挂 identity 且无 requireWorkspace | 缺 `GET /onboarding/me` |
| C. pending GET /onboarding/me | 期望 200，实际 Express HTML 404 |
| C. V 教师 class-directory | 期望 200，实际 404 |
| C. V 教师 PUT join | 期望 200，实际 404 |
| C. 教师 GET /classes → 403 | 期望 403，实际 200（仍走 `class.read`） |
| C. GET /classes/:classId + C | 期望 200，实际 404 |
| D. join_self 幂等 | 期望 200，实际 404 |
| D. leave_self 完整 active | 期望 200，实际 404 |
| D. leave_self disabled/absent 200 no-op | 期望 200，实际 404（不得先 403 的正例未跑到） |
| D. 残缺 leave → 500 不变量 | 期望 500 `IDENTITY_INVARIANT_VIOLATION`，实际 404 |
| D. join/leave 跨组织与不存在同文案 | 期望 `RESOURCE_NOT_FOUND`，实际 Express 404 `undefined` |
| D. disabled/graduated 拒绝加入 | 期望 403/409，实际 404 |
| D. 并发 join 只一组三元组 | 至少一次 200 失败 |
| D. 残缺 join 不自动修 | 期望 500，实际 404 |
| D. teacherCount / 三表不一致 | 目录期望 200，实际 404 |
| D. 强制指派/移除 | 教师强制期望 403，实际 404 |
| D. 行政纠错 PATCH | 教师期望 403，实际 404 |
| E. body 注入 role/org/scopeId → 400 | 期望 400，实际 404 |
| E. 组织只从 token 反查 / 原文不落库 | 注册期望 201，实际 404 |
| E. 撤销/到期/用尽统一 404 | 期望 `RESOURCE_NOT_FOUND`，实际 Express 404 |
| E. 最后一名额并发 | 必须有一个 201 失败 |
| E. 同 loginName 跨校可注册 / 同校 409+3 建议 | 同校冲突期望 409，实际 404 |
| E. 显式覆盖 TTL/maxUses | 期望 201，实际 404 |
| E. 默认 7 天/1 与 180 天/NULL | 签发期望 201，实际 404 |
| E. GM 改 scopeId → 400 | 期望 400，实际 404 |
| E. GM 可签教师凭据、不得跨届建班/改学生 | 签发期望 201，实际 404 |
| F. 注册后零成员 + 一条 pending | 注册期望 201，实际 404 |
| F. 批准建学生三关系 | 期望 200，实际 404 |
| F. 拒绝后可再申请 / 终态 409 | 拒绝期望 200，实际 404 |
| F. 重复 pending / 已入班 / 审别班 / 跨届 | 重复 pending 期望 400/409，实际 404 |
| F. If-Match 当前 + body 过期 → 200 | 期望 200，实际 404 |
| F. 并发批准只有一次物化 | 必须有一次 200 失败 |
| F. If-Match 过期 + body 当前 → 409 | 期望 409，实际 404 |
| G. 教师重置本班学生 / 拒他班与教师 | 期望 201，实际 404 |
| G. GM 本届学生+本校教师 / 拒跨届 | 期望 201，实际 404 |
| G. 校长全校 / platform 对校长 / 跨组织 404 | 期望 201，实际 404 |
| G. 30 分钟/撤销/单次/失败不消费/旧 session 失效 | 过期必须是标准 JSON 404 |
| G. 审计不含 token/password/hash | 签发期望 201，实际 404 |
| H. POST /classes 用 class.create + gradeId | 实际 permission 仍是 `class.manage` |
| H. body 四字段，服务端生成 gradeId | 旧 `createClass` 201 但 `gradeId=null` |
| H. PATCH 改届别 version + 前后 scope | 缺 version 期望 400，实际 404 |
| H. DELETE/restore 软停用保留成员/grants | 软停用期望 200，实际 404 |
| H. 固定 now 学年边界 | 未导出 `computeClassLifecycle` |
| H. 移除 grade_group 别名 | `normalizeRoleCode('grade_group')` 仍是 `grade_manager` |
| H. 教师不得建班 + 跨组织同文案 404 | GET 详情期望 `RESOURCE_NOT_FOUND`，实际 Express 404 |
| I. teacher 有 shelf 无 catalog 等 | `book.shelf.read` 实际 false |
| I. join_self / leave_self 矩阵 | join 期望 200，实际 404 |
| I. force_* 矩阵 | force_assign 期望 200，实际 404 |
| I. enrollment.review 矩阵 | 本班批准期望 200，实际 404 |
| I. 10.2 写动作 roleActions 抽样 | 校长 `class.create` 实际 false |
| I. registration.student/teacher.issue 矩阵 | 签发期望 201，实际 404 |
| I. password_reset.*.issue 矩阵 | 期望 201，实际 404 |
| I. class.create 矩阵 | 201 但 `gradeId=null`（旧建班口） |
| I. 行政角色指派 | platform 指派校长期望 200，实际 404 |
| J. 跨组织与不存在同码同文案 | `GET /users/:id` 外校 403 `PERMISSION_DENIED`，不是 404 |
| J. 缺失路由不得 200；POST /students 不得再成功 | POST /students 期望 404，实际 503 |

## 3. 实测 vs 推断

**实测：** 上表命令、退出码、70/64/6、以及每条失败的 `ERR_ASSERTION` 原文。夹具 `startPhase8App` 能迁到 047～050、seed 带 `schoolCode/loginName`、班级带 `stage/entryYear/classNumber/gradeId`、独立端口 ≠ 5191。中文 `Idempotency-Key` 已收成 ASCII，不再红在 undici Headers。

**推断：** POST /students 现网 503 是旧 `createStudent` 撞上 047 登录列触发器，被 identity 错误中间件收成 `DEPENDENCY_UNAVAILABLE`；不是夹具连错库。旧 `POST /classes` 仍 201，只是不写 stage/`gradeId`。教师仍能 `GET /classes` 200，符合 10.4 要改的现状。`GET /users/:id` 对外校已是 403，契约要求与不存在同码 404。

## 4. A–J 逐项

| 项 | 守卫 | 本轮运行 |
|---|---|---|
| A 登录与导航 | 已写 | 6 红 |
| B POST /students 退役 | 已写 | 2 红 |
| C session-only 挂载 | 已写 | 6 红 / 1 绿（S/G 目录锁） |
| D 教师三元组 | 已写 | 11 红 / 1 绿（approve 本就不存在） |
| E 注册凭据 | 已写 | 9 红 |
| F 学生审批 | 已写 | 7 红 |
| G 密码重置 | 已写 | 5 红 |
| H 班级生命周期 | 已写 | 7 红 |
| I 权限矩阵抽样 | 已写（含 join/leave/force、enrollment.review、registration.issue、password_reset.issue、class.create、shelf/catalog 存在性、废止 approve） | 9 红 / 1 绿 |
| J 安全 | 已写 | 2 红 / 3 绿（路径/挂载锁） |

## 5. 遗留

- `teacher.account.*` / 完整 10.2 每一格的「同组织越 scope + 跨组织 404」未逐格铺满；最高风险子集与用户点名动作已覆盖。
- `book.shelf.*` HTTP 属 T8.4；本包只锁 `permissions.js` 的 `roleActions`。
- 年级主任签教师凭据是 10.3 school 例外，**不能**用 `scopeAllows(grade→school)` 的 `roleAllows` 正例去逼实现改 `scopeAllows`；正例走 HTTP。
- T8.3B 删除 `POST /students` 后必须落到标准 JSON 404，不能只留 Express HTML 404。

## 6. 停止条件

未命中。分支 `feat/product-close-loop`；未改禁止文件；未连真库；无 skip；未实现 identity。

## 7. 红线声明

未改阅读摘要两表 / session-summaries schema / 指纹 / 90s TTL / renew。未开浏览器。未写真库。未重启 5191。未改 T8.2 产物。未 skip/假成功。未 commit。未做 T8.9。未做 Phase 6。

## 8. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-3a-guard-report.md`
- `docs/product-close-loop/evidence/phase8/t8-3a-guard-test-output.txt`

---

`tests/server/core/phase8-identity-guards/**/*.guard.test.js`
红（exit 1；70 条用例 64 红 6 绿；无基础设施失败）
建议 T8.3B 按这些守卫实现 identity；实现者不得改本目录测试
