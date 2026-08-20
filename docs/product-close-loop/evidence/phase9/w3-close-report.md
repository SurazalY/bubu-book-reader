# W3 收尾报告 · 教师重置密码可见

- 日期：2026-08-20
- 波次：W3（六项体验改造第三阶段）
- 工作区：`D:\Project\整书8.15`
- 分支：`feat/optional-upgrade`
- 基线：`a0b3a5a`
- 结论：**代码、守卫、抽查、回归已通过；真人四条路径由产品负责人当场确认。未要求截图。未 commit、未 push。**
- 下一阶段：**W5 · 品牌落位**（卡在 T5-0 人工描 SVG），然后是 T7 全量回归与验收。

---

## 一、完成的任务

| 任务 | 类型 | 结果 |
|---|---|---|
| T3-1 教师重置密码可见 · 守卫（后端） | 守卫 | 新文件落地。G3-1～G3-10 共 11 条因接口未挂上先全红（404）；实现后 G3-10 因「签发踢光会话再用旧 cookie 期望 403」与 G3-3 冲突，主控裁定为测试前置写错，原守卫 agent 只改前置、403 未削弱，其后 11/11 绿 |
| T3-1a 重置密码前端契约 · 前端守卫 | 守卫 | 新文件落地。G3-11～G3-16 共 6 条：交卷时 5 红 1 绿（G3-15 改造前已成立，仍作回归钉）；T3-3 后 6/6 绿 |
| T3-2 教师重置密码可见 · 后端实现 | 实现 | 迁移 **053**。抽查 **PASS**。`test:server` 503/503 |
| T3-3 重置密码前端改造 · 实现 | 实现 | 说明页 + 教师端三态。抽查 **PASS**。主控追认 T8.6A 一处 `rawToken` 扫描 |

执行顺序按主控简报：A 并行 T3-1 与 T3-1a → B 串行 T3-2（独立抽查）→ C 串行 T3-3（独立抽查，中途追认 T8.6A）→ D 回归 + 真人路径。未调换。浏览器验收只由产品负责人做，未派 AI 代点。

---

## 二、实际改动清单

### 数据库（T3-2）

- 迁移 `053_issued_temp_passwords.sql`（只占 053）。
- 表 `issued_temp_passwords`：列集合按契约（`plaintext NOT NULL`，`target_user_id UNIQUE`）。本系统唯一允许存教师签发临时密码明文的地方，不存学生自设密码。
- 派生表 `issued_temp_password_clear_markers`（不含任何密码列）：契约同时要求 GET 三态（available / cleared / none）与学生自改后 DELETE 明文行，只靠一张表无法区分 none 与 cleared。主控在 T3-2 简报写死，实施未另起方案。
- `migrate.js` 的 CRLF checksum 规范化未动。

状态机：

- GET：有明文行 → `available`；否则有 marker → `cleared`；否则 `none`
- POST 签发：upsert 明文并删除该用户 marker
- `clearIssuedTempPasswordForUser`：仅当存在明文行才 DELETE + 写 marker；从未签发保持 none

### 后端（T3-2）

- `POST /users/:userId/password-reset`、`GET /users/:userId/temp-password` 挂在 identity router，与旧 `password-reset-credentials` 同层。`requireSession` + `requireWorkspace`（**不是** session-only）。POST 走幂等。信封 `{ data, meta }`。
- 权限复用 `password_reset.student.issue` 及其 scope，POST/GET 共用同一段判定。未改 `permissions.js`。他班 403、教师账号对班主任 403、跨组织 404。
- 签发顺序：生成 6 位（字符集 `abcdefghjkmnpqrstuvwxyz23456789`，`crypto.randomBytes` 无偏取样）→ `hashPassword` 写 credentials → upsert 明文 → 删 marker → `revokeAllSessionsForUser` → 201 `{ newPassword, issuedAt }`。
- `changeOwnPassword` 调用顺序未改：`updatePasswordHash` → `clearIssuedTempPasswordForUser` → `revokeOtherSessionsForUser`。只填实清除函数体。
- 旧重置码接口、`password_reset_credentials` 表、`password-reset.guard.test.js` 一行未改。
- 未误伤 `updateOwnProfile` / `inspectRegistrationToken`。未给 `/me/password`、`/me/profile` 补工作空间头。

### 前端（T3-3 + 验收窄修）

- `OrgAccounts.jsx`：「签发重置码」改为「重置密码」；调用新 POST/GET；同行三态（当前临时密码 / 学生已自行修改 / 未重置过）；复制走剪贴板，明文只在内存。
- `identityApi.js`：新增 `issueTempPassword` / `getTempPassword`；删除死代码 `revokePasswordResetCredential`。仍保留无页面调用的 `issuePasswordResetCredential`（T8.6A 旧路径用例直接打它）。
- 新建 `ForgotPassword.jsx`，挂在与 `login` 同级的未登录 Routes；学生 Login「忘记密码」改为 Link。
- 控制台 Login 措辞改为教师/校长找管理员，无「重置码」字样。
- 验收跟进（2026-08-20）：「目标账号」输入框改为先在当前名单解析 UUID，不再把登录名塞进路径；GET 失败列上显示「状态读取失败」而不是「资源不存在」。`GET /students` 已有 `displayName`，表格加了「展示名」列；登录号加不了（该接口不下发 `loginName`）。

---

## 三、授权范围内改了哪些既有测试，及理由

### T3-1 / T3-1a

台账授权清单为空。只新增守卫文件。

G3-10 在实现落地后暴露前置错误（先签发再拿被踢掉的 cookie 期望 403，实际 401 `SESSION_EXPIRED`）。**不是实现越界。** 原守卫 agent 改为：有效学生会话直接打接口，仍断言 403 + `PERMISSION_DENIED`。未把 401 列为可接受结果。

### T3-2 台账原列

| 文件 | 理由 |
|---|---|
| `tests/server/db/reading-monitor-migration.test.js` | 最后一条 applied 迁移文件名 `052_community_post_book.sql` → `053_issued_temp_passwords.sql`。只改这一处 |

### T3-3 台账原列为空 + 主控追认

| 文件 | 分类 | 理由 |
|---|---|---|
| `tests/frontend/phase8-t8-6a-identity-ui.test.mjs` 约 153 行 | 主控追认 | 原断言 OrgAccounts 含 `rawToken`，与 G3-14 互斥。改为匹配 `newPassword`、禁止 `rawToken`、注册码仍对 `revealedRegistrationToken`。同文件 79–123 旧封装用例未动 |

未改：T3-1 / T3-1a 守卫（G3-10 除外，见上）、全部 `d21-*`、`password-reset.guard.test.js`、`permissions.js`、两条 D-19、`src/index.css`、login helper。

---

## 四、抽查结论

| 任务 | 抽查 | 结论 |
|---|---|---|
| T3-2 | 独立抽查 | **PASS**。授权测试只改 reading-monitor 文件名；教师签发 `revokeAllSessionsForUser`、学生自改 `revokeOtherSessionsForUser` 未混用；锚点顺序未动；POST/GET 权限同一套；明文未进审计/列表；旧重置码无 diff；`permissions.js` 相对 `ef0df7f` 为空 |
| T3-3 | 独立抽查 | **PASS**。T8.6A 追认未扩散；临时密码未写入 storage / URL / 路由 state；无残留重置码 UI；T3-1a 6/6；frontend 除 D-19 外全绿 |

非阻断观察（本波次不修）：

- 幂等表会缓存签发 201 的 `newPassword`，与旧重置码缓存 `rawToken` 同类；G3-9 未扫 `idempotency_records`。
- 校管/年级主任对教师账号仍走 `password_reset.teacher.issue`。G3-4 覆盖的是班主任打教师账号 403。若产品要求新接口无条件只对学生，另开窄修。
- 死封装 `issuePasswordResetCredential` 仍指向旧路径，仅供 T8.6A 直连调用。
- `issueReset` 会丢弃整表 in-flight GET，其余行可能停在「读取中」直到刷新。

---

## 五、回归

| 套件 | 结果 |
|---|---|
| `npm run test:server` | **503/503**，退出码 0（相对合并后基数 492，多出的即 T3-1 的 11 条） |
| `npm run test:frontend` | **316 测，314 绿，2 失败**（相对基数 310，多出的即 T3-1a 的 6 条） |

失败仅既有 D-19 CRLF 两条（`reader-dual-mode-contract.test.mjs`、`reader-text-blank-and-scroll.test.mjs`）。本波次 diff **不含** `src/index.css` 与这两份测试原断言逻辑（未借机消红）。点名守卫 T3-1、T3-1a、`password-reset.guard.test.js`、T6-1 均在通过列表。判定：**REGRESSION_PASS**。

---

## 六、真人路径（产品负责人本人走）

**以人工信号为准，验收通过。** 不要求截图。记录见 `w3-human-paths.md`。

负责人确认：

1. 老师点「重置密码」能看到 6 位密码
2. 学生用这串密码登录成功（重置后的密码生效）
3. 老师再回到该页仍能看到这串密码
4. 学生自己在设置改密后，老师端显示已自行修改，看不到明文

验收过程中曾因无 `--watch` 的旧后端未加载 T3-2 路由，整列「资源不存在」。重启后通过。不要把该 404 误判成接口契约要改成登录名路径。

---

## 七、遗留问题（本轮明确不做，不要顺手做掉）

| 事项 | 说明 |
|---|---|
| D-19 两条 frontend 测试红 | 与 W1/W2/W4 相同。后续波次也不要借机改测试消红 |
| 学生端个人主页「学校」「班级」空字段 | `GET /session` 不下发。本轮不做 |
| `GET /students` 不下发 `loginName` | 重置页加不了登录号列。若产品要「登录号 + 展示名」两列，需改该接口 |
| 幂等表缓存明文 | 见第四节观察 |
| 新接口 theoretically 可对教师账号签发（校管权限） | 见第四节观察 |
| `issuePasswordResetCredential` 死封装 | 页面已不走；删掉会让 T8.6A 旧用例红 |
| T5-0 校徽素材 | 人工任务，卡住 T5-1 |
| `feat/w4-grade-scope` 与 `D:\Project\readmate-w4` | 仍在。不要动。处置等产品负责人 |
| 工作区另有 `package.json` 增加 `sharp`、`public/brand/` 未跟踪 | **不是 W3 产出**。疑为品牌素材预处理，不要跟 W3 混提交 |

---

## 八、给 W5（品牌落位）的提醒

1. **下一波是 W5，不是 T7。** T5-0 是人工描 SVG，不占 agent，但会卡住 T5-1。T7 全量回归放在全部需求之后。
2. **无 `--watch` 的 `npm run server` 不会加载后写入的路由。** 真人验收前必须确认后端进程晚于本波次代码。W2 与 W3 都踩过：看起来像「资源不存在」或「必须携带 X-Workspace-Id」，其实是旧进程。
3. **冻结继续有效：** `permissions.js` / `scopeAllows` 一行不改；`d21-*` 与 `password-reset.guard.test.js` 仍绿；两条 D-19 不要消红；不要 revert `migrate.js` checksum 规范化。
4. **登录仍是两字段。** 不要把 `schoolCode` 塞回 helper。
5. **`/me/password`、`/me/profile` 仍是 session-only。** 不要补 `X-Workspace-Id`。
6. **旧重置码后端保留。** 前端已不再暴露。不要在登录/忘记密码页写回「重置码」。
7. **053 已占用。** 不要再占这个号。最大迁移现为 053。
8. **`service.js` 现在同时承载** W2 自助改密/改名、W3 临时密码签发查询与清除锚点、W4 `inspectRegistrationToken` 的 `currentGrade`。W5 若不动 identity 最好；若动，不要误伤这三处。
9. **浏览器验收只由产品负责人做。** 「帮我操作」默认只指重启服务 / 给账密链接。
10. **W3 尚未 git 提交**，是否提交由产品负责人决定。不要和 `sharp` / `public/brand/` 混在一笔里。

---

## 九、文档留痕

| 文件 | 作用 |
|---|---|
| `docs/product-close-loop/evidence/phase9/w3-close-report.md` | 本报告 |
| `docs/product-close-loop/evidence/phase9/w3-human-paths.md` | 真人路径当场确认记录（无截图、无口令原文） |
| `docs/product-close-loop/evidence/phase9/w3-scheduler-handoff.md` | 给任务调度 agent 的收口汇报（只报 W3 结论，不写下一波实施方案） |
| `docs/product-close-loop/11_六项体验改造任务台账.md` | 大表 T3-1 / T3-1a / T3-2 / T3-3 已标完成；「当前进度」指向 W5 |

未改 `10_` 契约。W3 **尚未 git 提交**。
