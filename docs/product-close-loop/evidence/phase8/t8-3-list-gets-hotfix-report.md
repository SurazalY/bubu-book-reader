# T8.3 列表 GET 热修报告

> 时间：2026-08-18
> Agent：Phase 8 T8.3 列表 GET 热修（T8.6A 发现 identity router 缺 09 §12.2 三条管理端 GET；主控抽查属实）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未重做 T8.3。未改 T8.3A 守卫、T8.5/T8.6 文件、integration-router、projections、迁移、09、ledger。未连真库。未打 5191。未开浏览器。

只补三条管理端 GET。既有 approve/reject、issue/revoke POST 不动。

## 1. 改动文件清单

| 路径 | 动作 |
|---|---|
| `server/domains/identity/repository.js` | 新增三条只读查询：入班申请按班+status；注册凭据只选元数据（不选 `secret_hash`）；重置凭据按目标用户只选 id/状态字段（不选 `secret_hash`） |
| `server/domains/identity/service.js` | 新增 `listClassEnrollmentRequests` / `listRegistrationCredentials` / `listPasswordResetCredentials`。鉴权复用既有 issue/review 矩阵与 GM 教师 school 例外 |
| `server/domains/identity/index.js` | 挂三条 GET，session + `X-Workspace-Id`，鉴权在 service 内按 §10.2 / §12.2 |
| `tests/server/core/phase8-identity-list-gets.test.js` | 新建。本包拥有。不改 `phase8-identity-guards/` |
| `docs/product-close-loop/evidence/phase8/t8-3-list-gets-hotfix-report.md` | 本报告 |

未改：T8.3A 守卫、T8.5/T8.6、`integration-router.js`、`projections.js`、迁移、09、`decisions.md`、`execution-ledger.md`、真库、5191。

## 2. 三条 GET 契约

相对 `/api/v1`。跨组织与无权知道存在性 → 与不存在同码同文案 404。同组织越 scope → 403。

| 方法与路径 | 动作 | 结果 |
|---|---|---|
| `GET /classes/:classId/enrollment-requests?status=` | `student.enrollment.review` | 默认 `pending`。enrollment DTO：`{id,status,version,requestedAt,class,student:{id,displayName,accountCodeSuffix,avatarSeed}}`。`avatarSeed=accountCode`，审批只给尾 4 位 |
| `GET /registration-credentials?expectedRole=` | `registration.student.issue` 或 `registration.teacher.issue`（含 GM school 例外） | `expectedRole=student\|teacher` 必填。按 S/G 过滤；只列元数据、派生状态与使用数 |
| `GET /users/:userId/password-reset-credentials` | 对应 `password_reset.*.issue` | 按目标账号类型与 scope 校验，与签发同一套。只列未删除凭据的 id/状态/到期/签发人 |

列表稳定排序，末级键为 `id`。不返回 `secretHash` / `rawToken` / `hash`。撤销不删除，管理端用派生状态区分 active/revoked/expired/exhausted/used。

## 3. 实测命令、退出码、用例数

全部由本 agent 亲自运行。临时库 + `listen(0)`，端口 ≠ 5191。

### 3.1 本包

```
node --test tests/server/core/phase8-identity-list-gets.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests / pass / fail | 3 / 3 / 0 |
| 时长 | `duration_ms 885.0278` |

覆盖：各一条允许；一条越 scope 403；一条跨组织 404（与不存在同文案）；列表 JSON 不含 hash/rawToken 键，也不回显夹具里的 rawToken/secretHash。

### 3.2 T8.3A 回归

```
node --test tests/server/core/phase8-identity-guards/**/*.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests（含无 `test()` 的 harness 文件级条目） | 71 |
| pass / fail / skipped | 71 / 0 / 0 |
| 时长 | `duration_ms 3016.9575` |

未改守卫。未靠改测试消红。

## 4. 实测 vs 推断

**实测**

- 上表两条 `node --test` 退出码与用例数。
- identity router 现有上述三条 GET；POST approve/reject/issue/revoke 路径未改。
- 本包断言了 enrollment DTO 字段、默认 pending、注册 `expectedRole` 必填、重置凭据只回 id/status/expiresAt/createdByUserId。

**推断**

- 浏览器打开班级详情 / 凭据页走这三条 GET，需 T8.6 联调；本包未开浏览器、未打 5191。
- 年级主任列教师凭据走既有 school 例外（与签发同一函数）；本包用教师越 scope 403 覆盖「无权列」，未再单测 GM 正例。

## 5. 停止条件

未命中第十六节。未写真库。未开浏览器。未 skip。未把空列表当成功。未改守卫才绿。

## 6. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`。未改 session-summaries schema / 指纹。未改 90s TTL / renew。未开浏览器。未写真库。未打 5191。

---

本包 3/3 绿；T8.3A 71/71 仍绿
停止条件未命中
建议继续 T8.6（前端三条 GET 已不再 404）
