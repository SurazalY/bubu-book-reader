# T8.3B 身份领域实现报告

> 时间：2026-08-18
> Agent：Phase 8 T8.3B 身份领域实现（按 T8.3A 守卫落地 identity 领域与 identity router）
> 分支：`feat/product-close-loop`
> HEAD 前缀：`b3cd4b5`
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未改 T8.3A 守卫。未连真库。未重启 5191。

## 1. 改动文件清单

| 路径 | 动作 |
|---|---|
| `server/domains/identity/permissions.js` | 写入 10.2 新动作；teacher 有 shelf 无 catalog；行政无 shelf/catalog；platform_ops 有 catalog 无 shelf；从 teacher/grade_manager/school_admin 移除 `book.publish/import/archive`；移除 `grade_group→grade_manager`；无 `teacher.affiliation.approve`；保留 `account.manage`。`platform_ops` 提前到对象首键，避免守卫源码扫描把后续 `'book.publish'` 误算进 teacher |
| `server/domains/identity/lifecycle.js` | **新建**。`computeClassLifecycle({ stage, entryYear, now })` / `computeGradeId`；必须传入 `now`，Asia/Shanghai 9/1 边界 |
| `server/domains/identity/validation.js` | **新建**。错误码/文案、token SHA-256、登录名建议 |
| `server/domains/identity/class-scope.js` | 再导出 `computeClassLifecycle` / `computeGradeId`。未改 `BOOK_LIBRARY_MANAGEMENT_ROLES` |
| `server/domains/identity/repository.js` | `findCredentialBySchoolLogin`；班级 stage/entryYear；V 自写查询；三元组 load；凭据/审批/重置；`revokeAllSessionsForUser` |
| `server/domains/identity/service.js` | 登录、导航、session-only 选班/离班、凭据、审批、重置、班级生命周期、三元组原子物化、GM 两项 school 例外正向检查 |
| `server/domains/identity/index.js` | 删除 `POST /students`；登录 `{schoolCode,loginName,password}`；session-only 四条在任何 `requireWorkspace` 之前；§12.2 新路由；`POST /classes` 用 `class.create` + 服务端 `gradeId`；标准 JSON 404。`createIdentityTestApp` 仍挂 `/api/v1` |
| `tests/server/core/identity-core.test.js` | 仅契约对齐（见第 5 节） |
| `tests/server/core/identity-role-boundary.test.js` | 仅契约对齐（见第 5 节） |
| `docs/product-close-loop/evidence/phase8/t8-3b-implement-report.md` | 本报告 |
| `docs/product-close-loop/evidence/phase8/t8-3b-guard-test-output.txt` | 守卫 TAP |
| `docs/product-close-loop/evidence/phase8/t8-3b-identity-core-output.txt` | 旧 identity 测试 TAP |

未改：`tests/server/core/phase8-identity-guards/**`（T8.3A，本轮零 diff）、`tests/server/core/phase8-reading-guards/**`、`integration-router.js`、`projections.js`、reading/community、迁移/bootstrap/seed、25 条 visibility 守卫、09、decisions、execution-ledger、真库、5191。

`git status --porcelain -- tests/server/core/phase8-identity-guards` 仅显示 T8.3A 留下的 `??` 未入库目录，无 `M`。

## 2. 实测命令 / 退出码 / 用例数 / 关键原文

### 2.1 T8.3A 守卫（完成必要条件）

命令（任务要求的 glob；Windows PowerShell 可展开）：

```
node --test tests/server/core/phase8-identity-guards/**/*.guard.test.js
```

修完后亲自复跑，退出码 **0**。落证据时用同一套 `*.guard.test.js` 显式列表再跑一次，同样 exit 0。

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests（含无 `test()` 的 harness 文件级条目） | 71 |
| pass / fail / skipped | 71 / 0 / 0 |
| 其中真实 `test()` | 70 绿 / 0 红 |
| 时长 | 约 3.1s（证据文件 `duration_ms 3087.6132`） |
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
# duration_ms 3087.6132
```

首轮（实现未齐）实测 60 绿 / 11 红，全部 `ERR_ASSERTION` 或 `ReferenceError` 被收成 500/503，无 syntax / import / SQLITE。11 红修好后再跑即上表全绿。不是改守卫消红。

### 2.2 旧 identity 契约测试

```
node --test tests/server/core/identity-core.test.js tests/server/core/identity-role-boundary.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests | 11 |
| pass / fail / skipped | 11 / 0 / 0 |
| 时长 | `duration_ms 2615.0151` |

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
# duration_ms 2615.0151
```

对齐登录体与跨组织 404 之后，仅剩伪造外校组织 INSERT 撞上 047 `school_code` 触发器；补列后该用例也绿。未删用例，未放宽无关断言。

### 2.3 允许路径 porcelain

```
git status --porcelain -- server/domains/identity tests/server/core
```

实测：`server/domains/identity` 下 5 个 `M` + 2 个新建（`lifecycle.js` / `validation.js`）；旧 identity 两测 `M`；`phase8-identity-guards/` 与 `phase8-reading-guards/` 为既有 `??`，本轮未改守卫文件。

## 3. 实测 vs 推断

**实测：** 上表命令、退出码、71/71 与 11/11、首轮 11 红的 assertion 原文、以及修复后再跑变绿。夹具仍走 `createIdentityTestApp` + 临时库，端口 ≠ 5191。

**推断：** 守卫源码扫描 `teacher: [...] 'book.publish'` 会跨过后续角色数组；把 `platform_ops` 放到 `roleActions` 首键后，teacher/grade_manager/school_admin 切片里不再出现 `'book.publish'`，语义未变。`createStudentAccount` 仍留在 repository，已无 HTTP/service 调用方。

## 4. 契约 A–J 逐项

| 项 | 结果 | 说明 |
|---|---|---|
| A 登录与导航 | **pass** | 6/6。`{schoolCode,loginName,password}`；username-only 不再 200；失败统一 401「学校、账号或密码错误」；pending `/student/onboarding`；V 零班 `/console/select-class`；零 workspace 登录 200 |
| B POST /students 退役 | **pass** | 2/2。源码无 `router.post('/students')`；标准 JSON `RESOURCE_NOT_FOUND`，不物化 |
| C session-only | **pass** | 7/7。四条只挂 identity、在 `requireWorkspace` 之前；教师 `GET /classes` 403；S/G 目录 200；已入班教师走 `GET /classes/:classId` + C |
| D 教师三元组 | **pass** | 12/12。join/leave 幂等；残缺 500 不自动修；跨组织同文案 404；并发一组；teacherCount 完整 active；强制/纠错矩阵；无 `teacher.affiliation.approve` |
| E 注册凭据 | **pass** | 9/9。body 注入 400；原文不落库；撤销/到期/用尽同码 404；最后名额并发只成功一个；跨校同名可注册；TTL/maxUses；GM 例外与跨届拒绝 |
| F 入班审批 | **pass** | 7/7。pending；批准三关系；拒绝后再申请；If-Match 优先；并发一成一 409 |
| G 密码重置 | **pass** | 5/5。教师/GM/校长/platform 矩阵；30 分钟/撤销/单次；审计无 token/password/hash |
| H 班级生命周期 | **pass** | 7/7。`class.create` + 服务端 `gradeId`；PATCH version；软停用；固定 `now` 学年公式；无 `grade_group` 别名；教师不得建班 |
| I 权限矩阵 | **pass** | 10/10。shelf/catalog 存在性；join/leave/force/review/issue/create/指派 HTTP 抽样 |
| J 安全 | **pass** | 5/5。临时库路径；不挂 integration-router；跨组织与不存在同码 404；缺失路由与 POST /students 皆非 200 |

## 5. 旧 identity 测试改动登记

| 原标题 | 旧行为 | 新行为 | 对应条款 |
|---|---|---|---|
| `HTTP login persists sessions...` 及所有 `login()` 调用 | body `{ username, password }` | body `{ schoolCode, loginName, password }`；学校用户 `schoolCode=fixture.schoolId`，平台 `schoolCode=fixture.platformOrganizationId` | 09 §10.1 / 登录契约；守卫 A |
| `a legacy forged... HTTP access` 读/改外校用户 | HTTP 403 `PERMISSION_DENIED` | HTTP 404 `RESOURCE_NOT_FOUND` | 09 §10.1 / P8 跨组织与不存在同码同文案；守卫 J |
| 同上，INSERT 外校组织/用户 | 只写 id/name/username | 补 047 必填 `school_code` / `login_name` / `account_code`。断言未放宽（scope 不含外校班 + HTTP 404） | T8.2 047 触发器；非产品改判 |
| `role assignments stay inside...` `otherSchoolRead` / `forgedRead` / `forgedUpdate` | 403 | 404 `RESOURCE_NOT_FOUND`「账号不存在」。同校 200、disabled workspace 403、disabled org 401 **保持** | 09 §10.1；守卫 J |

未删用例。学生读同校其他学生仍 403。平台 workspace 改他校用户仍走 `scopeType==='platform'` 放行（identity-core 既有）。

## 6. 遗留 / account.manage 盘点

**盘点结果：保留 `account.manage` 键，不做整表拔除。**

仍在使用：

- `server/domains/identity/index.js`：`PATCH /users/:id` 的 `requireAccountManage`（非本阶段退役路由）
- `server/domains/reading/monitoring.js`：`deleteAccountData` 仍 `authorize('account.manage')`（reading，T8.4 范围，禁止本任务改）

已不再使用：

- HTTP `POST /students` 已删除，不能再用它建学生
- Phase 8 新写路由均未授权 `account.manage`

`roleActions` 中 teacher / grade_manager / school_admin / platform_ops 仍持有该键。若整表拔掉，`PATCH /users` 与 monitoring 会全崩。

其它遗留（不阻塞 T8.3C）：

- `repository.createStudentAccount` 已无调用方，旧设计文档仍点名它；未删，避免越界清理
- `teacher.account.*` / 10.2 每一格的「同组织越 scope + 跨组织 404」未在本包外再铺
- `book.shelf.*` HTTP 属 T8.5；本任务只改了 `permissions.js` 动作
- 登录前端两处 Login.jsx 按 P8-21 属后续，本任务只改了 `navigationForUser`

## 7. 停止条件

对照 09 §16 与任务点名条，**未命中**：

- 未改守卫才绿
- 未为 V 创建 school 范围 teacher role
- 未重新引入教师审批 / `teacher.affiliation.approve`
- 未保留 `POST /students` handler 或假 404
- token 只在签发响应的 `rawToken` 出现一次；库内与审计为 SHA-256 hex / 不含原文（守卫 E/G 已锁）
- 三关系同一事务；残缺报 `IDENTITY_INVARIANT_VIOLATION`，不自动修
- 未碰阅读摘要两表 / session-summaries / 指纹 / 90s TTL / renew
- 未写真库、未重启 5191
- GM 两项 school 例外只对 `registration.teacher.*` 与 `password_reset.teacher.*` 做正向检查，未改 `scopeAllows()` 让 grade 普遍包含 school
- 连续两轮同一假设仍红：未发生（11 红分属缺 import / 源码扫描误匹配 / leave 先查 V，一次对症后全绿）

## 8. 红线声明

未改阅读摘要两表 / session-summaries schema / 指纹 / 90s TTL / renew。未开浏览器。未写真库。未重启 5191。未改 T8.3A / T8.4A 守卫。未改 integration-router / projections / reading / community / 迁移 / bootstrap / seed。未 skip / 假成功 / fallback / 吞错。未 commit。未做 T8.9。

## 9. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-3b-implement-report.md`
- `docs/product-close-loop/evidence/phase8/t8-3b-guard-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-3b-identity-core-output.txt`

---

`tests/server/core/phase8-identity-guards/**/*.guard.test.js` 绿（exit 0；71 条 71 绿 0 红；真实用例 70）
停止条件：未命中
建议 T8.3C
