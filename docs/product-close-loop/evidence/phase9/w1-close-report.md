# W1 收尾报告 · 登录去学校码 + 共读社区发帖

- 日期：2026-08-19
- 波次：W1（六项体验改造第一阶段）
- 结论：**代码、守卫、抽查、回归已通过；真人路径以产品负责人当场信号为准，验收通过。**
- 下一阶段：**W2 · 三端设置与自助改密**（T6-1 / T6-2 / T6-3）

---

## 一、完成的任务

| 任务 | 类型 | 结果 |
|---|---|---|
| T2-1 登录去学校码 · 守卫 | 守卫 | 新文件落地。8 条里 7 红 1 绿（G2-4「仅凭 username 无法登录」改造前已成立） |
| T2-2 登录去学校码 · 实现 | 实现 | 迁移 **051**。抽查 PASS |
| T1-1 共读社区发帖改造 · 守卫 | 守卫 | 新文件落地。12 条里 11 红 1 绿（G1-6 班级审核本就符合） |
| T1-2 共读社区发帖改造 · 实现 | 实现 | 迁移 **052**。首次抽查 FAIL_NARROW（可见性绕过），窄修后抽查 PASS |

执行顺序按交接说明：A 并行两个守卫 → B 串行 T2-2 → C 串行 T1-2。未调换。

---

## 二、实际改动清单

### 数据库

- `server/db/migrations/051_login_name_global_unique.sql`：`users.login_name` 全局唯一索引（NOCASE，非空）。组织内索引与 `organizations.school_code` 保留。
- `server/db/migrations/052_community_post_book.sql`：`community_posts.book_id` 可空列 + 索引。未加 NOT NULL。quote 三列与 033 CHECK 未动。
- `server/db/migrate.js`：开工前已有 CRLF→LF 再算 checksum 的未提交改动，**保留**（Windows 行尾卫生，避免 checksum 随 OS 漂移）。本波次未再改算法。

### 登录（T2-2）

- 登录 body 只接受 `{ loginName, password }`；出现 `schoolCode` 等多余字段 → `VALIDATION_FAILED`。
- 仓储改为 `findCredentialByLoginName`；删除学校码联合查询与死代码 `findCredentialByUsername`。
- 幂等 scope 改为 `sha256(loginName)`；失败文案改为「账号或密码错误」。
- 注册查重改为全局。
- 两端 `Login.jsx` 去掉学校码；`src/api/auth.js` 两字段；删除无人引用的 `src/console/pages/auth/AuthViews.jsx`。

### 共读社区（T1-2）

- `submitPost` 必填 `bookId`（本组织已发布书）；忽略 body.quote；写库 quote 三列恒 NULL；`structuredQuote` 第四参恒 `false`。
- `reviewPlan`：新帖本班老师一次 `approved` 即发布，学校范围不再产生 `class_approved`。枚举与存量二审分支保留。
- 投影两处：`bookId` 优先 `book_id`，回退 `quote_book_id`；继续调用 `isBookVisibleToAudience`。
- 前端去掉引文步骤、草稿按钮、修改已发帖入口；「我的发布」三态；封面改取正文。
- **未删** `StudentContext` 的 `aiQuotes`（只删了到共读社区的映射）。

### 窄修（T1-2 抽查打回后）

只改 `server/domains/community/index.js` 与 `server/integration/projections.js`：

- 去掉 `getPost` 上「没有 `quote_book_id` 就跳过可见性」的默认分支。
- 列表投影不再「调用谓词但丢掉返回值」。
- 不可见时帖子与 `bookId` 仍返回，藏原文/书名（D-21 / G1-7）。

---

## 三、授权范围内改了哪些既有测试，及理由

### T2-2 台账原列（6 个）

| 文件 | 理由 |
|---|---|
| `tests/server/core/phase8-identity-guards/harness.guard.test.js` | `loginWithSchool` 改为两字段；`loginWithUsername` 保持负例 |
| `tests/server/core/phase8-identity-guards/login-navigation.guard.test.js` | 两字段契约；去掉「错 schoolCode 也 401」；保留 username-only |
| `tests/server/http/phase8-http-guards/api-client.guard.test.js` | `auth.js` 必须不含 `schoolCode` |
| `tests/frontend/api-contract.test.mjs` | 登录 body 两字段 |
| `tests/frontend/phase8-t8-5b-api-envelope.test.mjs` | 同上 |
| `tests/frontend/phase8-t8-6a-identity-ui.test.mjs` | 两端 Login 须含账号密码、不得含学校码 |

### T2-2 台账漏列、抽查追认为 A/B 的

台账写「只改 identity harness helper 即可传导」不成立：HTTP / 可见范围 / identity-core 各有一份登录 helper 拷贝。G2-3 禁止静默忽略 `schoolCode` 后，这些 helper 必须改发出的 body，否则冻结 d21 会红。

| 文件 | 分类 | 理由 |
|---|---|---|
| HTTP 侧 `shared-harness.guard.test.js` | A | 仅 `loginWithSchool` body；D-21 接线未动 |
| `tests/server/helpers/phase8-old-fixture.js` | A | `loginBody` 去掉 schoolCode |
| `identity-core.test.js` / `identity-role-boundary.test.js` | A | 本地 login() 只改发 body |
| `book-visibility-*.test.js`（3） | A | 同上 |
| `phase8-attack-t87-gaps.test.js` | A | 本地 login helper 不把 schoolCode 写入 body |
| `registration.guard.test.js` | B | D-7 全局查重：跨校同名 201 → 409 |
| `reading-monitor-migration.test.js` | B | 最后一条 applied 钉到 051（后被 T1-2 再钉到 052） |
| `console-zero-fixture.test.mjs` | B | 删除 `AuthViews.jsx` 后去掉对该路径的 `readFile`；LEGACY 黑名单未动 |

### T1-2 台账原列 + 主控追加

| 文件 | 理由 |
|---|---|
| `tests/frontend/community-api-adapter.test.mjs` | 提交 body 去 quote、加 bookId |
| `tests/frontend/console-community-runtime.test.mjs` | 解析书改从 bookId |
| `tests/server/http/integration-runtime.test.js` | POST 去 quote；落库断言 book_id 有值且三列为 NULL；同文件超出行号的学校帖两级审核改为一审（D-5，抽查追认 B） |
| `tests/server/db/reading-monitor-migration.test.js` | 最后一条 applied 机械更新为 052 |

### T1-2 清单外、抽查追认

| 文件 | 分类 | 理由 |
|---|---|---|
| `tests/server/community-reports/community-reports.test.js` | A | 隔离库补 052 + books 夹具 + submitPost 补 bookId |
| `tests/frontend/reader-jump-page-param.test.mjs` | B | 删除「去看这一页」后，断言改为书籍详情页 |

未改：T2-1 / T1-1 新守卫、全部 `d21-*`、`password-reset.guard.test.js`、`permissions.js`、047-050 迁移守卫、033 CHECK。

---

## 四、抽查结论

### T2-2

独立抽查 **PASS**。`permissions.js` 未改；登录无「有 schoolCode 走旧查询」双轨；T2-1 守卫未改；迁移号 051。清单外测试全部追认为 helper 传导或契约必然改断言。

### T1-2 第一轮

独立抽查 **FAIL_NARROW**（D-10 同类）：

1. `getPost` 在 `!quote_book_id` 时直接 return，新帖不走 `isBookVisibleToAudience`。D-21 仍绿，是因为守卫夹具仍写 quote 三列，测不到新默认分支。
2. 列表投影调用了 `isBookVisibleToAudience` 但丢掉返回值。

d21 与两侧 shared-harness：**T1-2 未改**，跑测 14/14 绿。

### T1-2 窄修后再抽查

独立抽查 **PASS**。两点绕过消失；缺 `role_assignments` 时仍进谓词（全闭 audience），不是 catch 跳过；冻结测试 24/24 绿；`permissions.js` 未动。

---

## 五、回归

| 套件 | 结果 |
|---|---|
| `npm run test:server` | **465/465**，退出码 0 |
| `npm run test:frontend` | 287 测，285 绿，**2 失败** |

失败仅既有 D-19 CRLF 两条（`reader-dual-mode-contract.test.mjs`、`reader-text-blank-and-scroll.test.mjs`）。本轮 diff **不含** `src/index.css` 与这两份测试。判定：**既有、非 W1**。点名守卫 T2-1、T1-1、d21、password-reset 均在通过列表中。

---

## 六、真人路径（产品负责人当场信号）

**以人工信号为准，验收通过。** 未再派浏览器 agent。

负责人确认：

- 学校码已消失
- 帖子必须引用原文的限制消失
- 能正常发帖
- 教师能正常审核
- 班级、校级层次均验证通过
- 帖子从编写、发布到公示均无问题

归档截图（负责人提供，不另要求补拍）：

- `docs/product-close-loop/evidence/phase9/w1-login-no-school-code.png` — 学生登录页仅账号+密码
- `docs/product-close-loop/evidence/phase9/w1-compose-no-quote.png` — 发帖为选书 / 范围 / 标题正文 / 封面，无引文步骤；按钮为「发给老师看」
- `docs/product-close-loop/evidence/phase9/w1-teacher-audit.png` — 教师端社区审核待审队列

---

## 七、遗留问题（本轮明确不做，不要顺手做掉）

| 事项 | 说明 |
|---|---|
| D-19 两条 frontend 测试红 | 正则写死 `,\n`，本机 `src/index.css` 为 `,\r\n`。与 W1 无关，W2 也不要借机改测试消红 |
| 「撤回」按钮 | T1-2 未扩权。后端仍无撤回接口 |
| 注册冲突文案仍是「校内登录名已存在」 | 现已全局唯一，契约没写改文案 |
| 帖子真编辑 / 草稿 | 本轮只撤假入口 |
| 学生端个人主页「学校」「班级」空字段 | `GET /session` 不下发，后续单独立项 |
| `reading-monitor-migration.test.js` 钉死最后一条迁移文件名 | T3-2 加 053 还会再红一次，派工时预授权机械更新 |
| T5-0 校徽素材 | 人工任务，不占 agent，但会卡住 T5-1，可与 W2 并行开工 |

---

## 八、给 W2（三端设置与自助改密）的提醒

1. **依赖已满足。** T6 必须等 T2-2，现已落地。设置页改密建立在两字段登录契约上，不要把学校码写回 helper。
2. **T6-2 必须预留 T3 钩子。** `changeOwnPassword` 成功路径上留「清除 `issued_temp_passwords` 行」的锚点，并在报告里写出确切位置。表要到 T3-2（迁移 **053**）才建；W2 不要占用 053。
3. **新接口是 session-only。** `POST /me/password`、`PATCH /me/profile` 挂 identity router，块内不得出现 `requireWorkspace` / `service.authorize(`，不得进 integration-router。改密后**保留当前会话、踢掉其余**——不要复用 `revokeAllSessionsForUser`。
4. **T6-1 守卫先于 T6-2 实现**，仍须分派不同 agent。授权扩充 `session-only.guard.test.js` 与 `security.guard.test.js` 的路径清单时，不得改这两个文件里其他断言。
5. **不要复用** `src/student/pages/Settings.jsx` 与 `src/console/pages/Me.jsx`（演示壳 / fixture 黑名单）。T6-3 台账已列出要同步的 frontend 测试行号。
6. **全局禁令继续有效：** `permissions.js` / `scopeAllows` 一行不改；不得靠改测试消红；明文密码不得进审计/日志。
7. **登录 helper 已是两字段。** W2 不要再把 `schoolCode` 塞回 HTTP body。HTTP shared-harness 的 login 改动是 T2-2 追认过的，不要回退。
8. **`migrate.js` 的 CRLF checksum 规范化要保留。** 不要 revert。
9. T4 与 W2 无依赖，人手够可并行；T5-0 是人工描 SVG，越早越好。
