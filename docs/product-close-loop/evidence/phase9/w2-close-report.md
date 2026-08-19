# W2 收尾报告 · 三端设置与自助改密

- 日期：2026-08-19
- 波次：W2（六项体验改造第二阶段）
- 结论：**代码、守卫、抽查、回归已通过；真人路径以产品负责人当场信号为准，验收通过。未要求截图。**
- 下一阶段：**W3 · 教师重置密码可见**（T3-1 / T3-2）

---

## 一、完成的任务

| 任务 | 类型 | 结果 |
|---|---|---|
| T6-1 自助改密与改名接口 · 守卫 | 守卫 | 新文件落地。行为断言因接口未实现多为红（404）；G6-1 的 integration-router 缺席、G6-11 失败路径明文不泄漏为改造前已成立所以绿 |
| T6-2 自助改密与改名接口 · 实现 | 实现 | 无新迁移。抽查 **PASS** |
| T6-3a 三端设置页 · 前端守卫 | 守卫 | 新文件落地。G6-12～G6-19 共 8 条全红（功能未实现），无 skip |
| T6-3 三端设置页 · 实现 | 实现 | 删除两份演示壳。抽查 **PASS** |

执行顺序按主控简报：A 先 T6-1 → B 串行 T6-2（完成后独立抽查）并并行 T6-3a → C 待 T6-2 抽查 PASS 且 T6-3a 就位后派 T6-3（完成后独立抽查）→ D 回归。未调换。真人验收以产品负责人当场信号为准，不要求截图；主控曾误把「帮我操作」理解成浏览器代点，已停下，**不作为验收证据**。

---

## 二、实际改动清单

### 数据库

- **未新增 migration。** 最大号仍为 052。053 仍预留给 T3-2。
- `server/db/migrate.js` 的 CRLF checksum 规范化未动（W1 保留项）。

### 后端（T6-2）

- `POST /me/password`、`PATCH /me/profile` 挂在 identity router，session-only：`requireSession` + `idempotencyKey` + `executeIdempotent`。块内无 `requireWorkspace`、无 `service.authorize(`，未进 `integration-router.js`。
- 成功状态码均为 **200**。改密 body `{ oldPassword, newPassword }` → `{ changed: true }`；改名 body `{ displayName }` → `publicUser`。
- `changeOwnPassword`：`verifyPassword` → `isChosenPasswordAllowed`（6–1024，与 `isPasswordInputAllowed` 上限并列）→ `hashPassword` + `updatePasswordHash` → T3 锚点 → `revokeOtherSessionsForUser`。
- 踢会话用新函数 `revokeOtherSessionsForUser`（`WHERE user_id = ? AND id != ?`），**未**复用 `revokeAllSessionsForUser`。
- 旧密码错误：401 / `AUTH_REQUIRED`，该路径不写 `password_hash`。
- 审计 / 错误响应 / 幂等落库均无密码明文。改密幂等 `request: {}`，摘要走 HMAC。
- 未改 `PATCH /users/:id`、未改 `permissions.js`、未把 `schoolCode` 塞回登录。

### T3 预留锚点（供 T3-2 接）

空函数（不发 SQL、不建表）：

```916:923:server/domains/identity/repository.js
/**
 * T3-2 锚点：学生自助改密成功后清除 issued_temp_passwords 中该用户的明文行。
 * 表由迁移 053 创建；W2 不建表、不发 SQL。T3-2 将本函数体替换为 DELETE。
 */
export function clearIssuedTempPasswordForUser(database, userId) {
  void database
  void userId
}
```

成功路径调用点（`changeOwnPassword`，写 hash 之后、踢其余会话之前）：

```1882:1885:server/domains/identity/service.js
    updatePasswordHash(database, actor.id, hashPassword(newPassword), now)
    // T3-2 锚点调用：表 issued_temp_passwords 尚不存在，clearIssuedTempPasswordForUser 目前为空实现。
    clearIssuedTempPasswordForUser(database, actor.id)
    revokeOtherSessionsForUser(database, actor.id, sessionId, now)
```

T3-2 要把函数体换成 `DELETE FROM issued_temp_passwords WHERE target_user_id = ?`。调用点已接上，不必再改 `changeOwnPassword` 的调用顺序。

### 前端（T6-3）

- 新建 `src/student/pages/settings/AccountSettings.jsx`，路由 `/student/me/settings`，挂在 `StudentShell` 之外 + `FullPage`（对标 compose，底栏按 BottomNav 既有约定隐藏）。
- 新建 `src/console/pages/Settings.jsx`，路由 `/console/settings`，挂在 `ConsoleShell` 之内；`isMountedConsolePath` 已登记。
- 删除 `src/student/pages/Settings.jsx`、`src/console/pages/Me.jsx`。
- 学生端 `Me.jsx`：设置入口解禁并指向新路由；去掉「设置服务端接入中」「头像可以在设置里换」。未给学校/班级编造数据。
- `TopBar`：在「管理任教班级」与「帮助与反馈」之间插入「设置」；帮助仍 disabled；用户名 `workspace.person` → `operator`。
- `src/api/auth.js`：新增 `changeOwnPassword` / `updateOwnProfile`，自动带 `Idempotency-Key`，不带 `X-Workspace-Id`。登录 body 仍只有 `{ loginName, password }`。
- 两端设置页只有四项真功能：改密、改显示名、真实 `authApi.logout()`、静态「关于与版本」。无 checkbox / switch / 头像 / 主题 / 通知。改密成功后不主动登出。

### 验收补丁（真人改密报错之后）

根因是 20:35 启动、无 `--watch` 的旧 `npm run server` 未加载 T6-2 路由，请求落到 integration-router 全局 `requireWorkspace`，前端把 400 文案「受保护请求必须携带 X-Workspace-Id」显示出来。重启后端后未登录调改密为 401 `AUTH_REQUIRED`（路由已挂上）。

额外加固（方向正确：禁止带头，不是补头）：

- `src/api/client.js`：session-only 白名单纳入 `/me/password`、`/me/profile`（与 enrollment-requests 同类）
- `src/api/auth.js`：`changeOwnPassword` / `updateOwnProfile` 显式 `workspaceId: undefined`
- `tests/frontend/api-contract.test.mjs`：补一条「改密/改名/入班申请不得带 X-Workspace-Id，必须带 Idempotency-Key」

该补丁独立抽查 **PASS**。未改 T6-1 / T6-3a 守卫，未改 `permissions.js`。

---

## 三、授权范围内改了哪些既有测试，及理由

### T6-1 台账原列（扩充清单，不得改其它断言）

| 文件 | 理由 |
|---|---|
| `tests/server/core/phase8-identity-guards/session-only.guard.test.js` | `SESSION_ONLY` 追加 `POST /me/password`、`PATCH /me/profile` |
| `tests/server/core/phase8-identity-guards/security.guard.test.js` | 「不得出现在 integration-router」追加 `/me/password`、`/me/profile` |

新建：`tests/server/core/phase9-identity-guards/self-service-me-password-profile.guard.test.js`（G6-1～G6-11）。

### T6-2

授权同步清单为空。**未改任何测试。**

### T6-3a

授权同步清单为空。新建：`tests/frontend/phase9-settings-pages.guard.test.mjs`（G6-12～G6-19）。

### T6-3 台账原列（4 个）

| 文件 | 理由 |
|---|---|
| `tests/frontend/stage5-route-wiring.test.mjs` | 原「没有服务端设置契约时不跳转」前提已不成立：改为断言挂载新设置页、入口指向 `/student/me/settings` |
| `tests/frontend/student-logout.test.mjs` | 旧 `Settings.jsx` 已删；改为断言新页调用 `authApi.logout()` |
| `tests/frontend/student-curl-flip-hidden.test.mjs` | 扫描目标改为新设置页，禁令内容不变 |
| `tests/frontend/console-zero-fixture.test.mjs` | 遗留黑名单**只**移除 `src/console/pages/Me.jsx`，其余条目未动 |

`tests/frontend/reading-monitor-completion-semantics.test.mjs:71-74`（生产模块图不得含旧 `Settings.jsx`）**未改**，删除后自然绿。

### 验收补丁（台账原列之外，主控追认）

| 文件 | 理由 |
|---|---|
| `tests/frontend/api-contract.test.mjs` | 钉死改密/改名走 session-only：不得带 `X-Workspace-Id`，必须带幂等头；对照阅读写请求仍带头。未改登录两字段断言 |

未改：T6-1 / T6-3a 新守卫、全部 `d21-*`、`password-reset.guard.test.js`、`permissions.js`、两条 D-19 frontend 测试、`src/index.css`、登录 helper、047-050 迁移守卫。

---

## 四、抽查结论

### T6-2

独立抽查 **PASS**。1–7 项全过：无越界改测试；无把校验绕过去的默认分支；`permissions.js` 未改；两接口 session-only 且不在 integration-router；`revokeOtherSessionsForUser` 保留当前会话；旧密码失败路径不写 hash；明文未进审计/幂等存储。锚点在成功路径，未建表、未占 053。

### T6-3

独立抽查 **PASS**。1、2、3、8、9 项全过：授权测试未越界；未见失败当成功或漏带幂等头；`permissions.js` 未动；两份演示壳已删且黑名单只去掉 `Me.jsx`；两个新设置页没有假开关。T6-3a 守卫与 D-19 未被改来消红。

非阻断观察（本波次不做）：`TopBar` 仍有一枚禁用的「个人资料暂未开放」，不在两个新设置页上。

---

## 五、回归

| 套件 | 结果 |
|---|---|
| `npm run test:server` | **479/479**，退出码 0（相对 W1 的 465，多出的即 T6-1 新守卫） |
| `npm run test:frontend` | 回归当时 295 测 293 绿；验收补丁后 **296 测 294 绿**，**2 失败** |

失败仅既有 D-19 CRLF 两条（`reader-dual-mode-contract.test.mjs`、`reader-text-blank-and-scroll.test.mjs`）。本波次 diff **不含** `src/index.css` 与这两份测试。判定：**既有、非 W2**。点名守卫 T6-1、session-only、security、T6-3a 均在通过列表中。

---

## 六、真人路径（产品负责人本人走）

**以人工信号为准，验收通过。** 不要求截图。

负责人确认：

- 学生、教师、校长三端都能改密码，且新密码立即生效
- 改密成功后当前会话没有被踢出，仍停留在登录态
- 显示名可以改并保存成功

验收过程中曾因 20:35 启动、无 `--watch` 的旧后端未加载 T6-2 路由，报「受保护请求必须携带 X-Workspace-Id」。重启 `npm run server` 后该问题消失。前端另将 `/me/password`、`/me/profile` 纳入 session-only 白名单，禁止发出工作空间头（抽查 PASS）。

说明：契约第五节第 4 条后半「老师端该学生的临时密码显示为已自行修改」属于 W3（表还不存在），本波次不要求走。

---

## 七、遗留问题（本轮明确不做，不要顺手做掉）

| 事项 | 说明 |
|---|---|
| D-19 两条 frontend 测试红 | 与 W1 相同。W3 也不要借机改测试消红 |
| 学生端个人主页「学校」「班级」空字段 | `GET /session` 不下发。T6-3 改 Me.jsx 时看见了，未修 |
| `TopBar`「个人资料暂未开放」 | 禁用按钮，不在设置页上。台账未要求改 |
| BottomNav 注释写「足迹、用量」也要藏栏 | 这两条目前仍在 `StudentShell` 内。设置页按 FullPage 既有机制处理，未改足迹/用量 |
| 「关于与版本」无服务端版本号 | 未硬编 `package.json` 或旧 fixture「前端演示版」，只写静态关于 |
| `reading-monitor-migration.test.js` 钉死最后一条迁移文件名 | T3-2 加 053 还会再红一次，派工时预授权机械更新 |
| T5-0 校徽素材 | 人工任务，不占 agent，但会卡住 T5-1 |

---

## 八、给 W3（教师重置密码可见）的提醒

1. **依赖已满足。** T3 必须等 T6-2，现已落地。自助改密成功路径已经调用 `clearIssuedTempPasswordForUser`，W3 只替换函数体，不要再改调用顺序。
2. **迁移号 053。** 建 `issued_temp_passwords`。不要占用别的号。W2 未加迁移。`reading-monitor-migration.test.js` 目前钉在 052，加 053 后预授权把「最后一条 applied」机械更新为 053。
3. **冻结旧重置码。** `password-reset.guard.test.js` 全文、`phase8-identity-list-gets.test.js:139-184` 一行不改。旧接口与表原样保留。
4. **权限复用，不新增动作。** 签发与 `GET /users/:id/temp-password` 必须走同一套 `password_reset.student.issue` + scope。能签发就能看，能看就能签发。
5. **明文只存这一张表、只存教师签发的临时密码。** 学生自己设的密码永远不进这张表。审计、日志、错误响应、列表接口一律禁明文（G3-9）。
6. **教师重置会踢掉该学生所有既有会话**（G3-3）——这里才用得上 `revokeAllSessionsForUser`。不要和 T6-2 的「保留当前会话」搞混。
7. **登录仍是两字段。** 不要把 `schoolCode` 塞回 helper。HTTP shared-harness 的 login 改动是 W1 追认过的，不要回退。
8. **`migrate.js` 的 CRLF checksum 规范化要保留。** 不要 revert。
9. **全局禁令继续有效：** `permissions.js` / `scopeAllows` 一行不改；不得靠改测试消红；T6-1 / T6-3a 新守卫不要改来迁就 T3。
10. T6-1 已把 `/me/password`、`/me/profile` 钉进 session-only 与 security 清单，T3 不要回退这两项。前端 `client.js` 也有对应白名单，不要改成给这两条补 `X-Workspace-Id`。
11. **W4 仍在独立工作区并行**（`D:\Project\readmate-w4`，`feat/w4-grade-scope`）。W3 继续在主工作区做。重叠文件仍是 `server/domains/identity/service.js`（W3 接清除锚点 + 签发临时密码；W4 改 `inspectRegistrationToken`）。不要把两个波次塞进同一工作区抽查。合并时人工确认该文件。
12. **无 `--watch` 的 `npm run server` 不会加载后写入的路由。** 真人验收前必须确认后端进程晚于本波次代码。不要把「受保护请求必须携带 X-Workspace-Id」误判成设置接口要工作空间。
13. **浏览器验收只由产品负责人做。** 「帮我操作」默认只指重启服务/给账密链接，不包含代点页面。

---

## 九、文档留痕

| 文件 | 作用 |
|---|---|
| `docs/product-close-loop/evidence/phase9/w2-close-report.md` | 本报告 |
| `docs/product-close-loop/evidence/phase9/w2-human-paths.md` | 真人路径当场确认记录（无截图、无口令原文） |
| `docs/product-close-loop/evidence/phase9/w2-scheduler-handoff.md` | 给任务调度 agent 的汇报 prompt |
| `docs/product-close-loop/11_六项体验改造任务台账.md` | 大表 T6-1/T6-2/T6-3a/T6-3 已标完成；「当前进度」指向 W3 |

未改 `10_` 契约。W2 **尚未 git 提交**，是否提交由产品负责人决定。
