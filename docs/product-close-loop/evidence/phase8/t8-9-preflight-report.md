# T8.9 只读预检报告（Gate 3 前半）

> Agent：Phase 8 T8.9 只读预检（未参与 T8.2～T8.8 实现）
> 时间：2026-08-18
> 模型：cursor-grok-4.6-xhigh-fast
> 结论先行：**preflight pass / 可以派停机迁移**

未停、未杀、未重启 5191。未启动新后端。未用 `openSqliteDatabase` 打开真库。未对真库执行非只读 SQL。未跑 `bootstrap-internal-demo.js` / `importSeed`。未 `UPDATE credentials`。未改 `server/**` `src/**` `tests/**` `package.json` 迁移。未改 `execution-ledger.md` / `09` / `decisions.md`。未覆盖 T8.8 文件。未 commit / push / reset / checkout。未开浏览器、未进入 T8.10。密码原文未写入任何证据。

---

## 1. 改动文件

仅新建：

- `docs/product-close-loop/evidence/phase8/t8-9-preflight-report.md`
- `docs/product-close-loop/evidence/phase8/t8-9-preflight-summary.json`
- `docs/product-close-loop/evidence/phase8/t8-9-pre-visibility-sets.json`

临时采集（不入院仓库）：`C:\Users\Yak\AppData\Local\Temp\t8-9-preflight-20260818T134256Z\`（新 VACUUM 副本，未复用 T8.8 目录）。

---

## 2. 实测命令 / 退出码 / 关键原文

| 命令 | 退出码 | 关键原文 |
|---|---|---|
| `git branch --show-current` | 0 | `feat/product-close-loop` |
| `git rev-parse HEAD` | 0 | `b3cd4b532cd4e7e44398bd465112e9ff84a9684e` |
| `Get-NetTCPConnection -LocalPort 5191` | 0 | `127.0.0.1 5191 Listen 66104`；Listen 计数 **1** |
| `Get-CimInstance Win32_Process -Filter "ProcessId=66104"` | 0 | `CommandLine = node  server/index.js`；`CreationDate = 2026/8/18 12:48:08` |
| 父进程 64816 / 61696 | 0 | `cmd.exe /c node server/index.js` ← `npm-cli.js run server` |
| `GET http://127.0.0.1:5191/api/v1/health` | HTTP 200 | `{"data":{"status":"ok","database":"sqlite","migrations":30}}` |
| 列 `server/db/migrations/*.sql` | 0 | `count=34` `maxPrefix=050` `has047to050=true`；047～050 四文件存在 |
| `node %TEMP%\t8-9-preflight.mjs`（`DatabaseSync(readOnly:true)` + `VACUUM INTO` + 副本计数 + 打 5191 登录） | 0 | `vacuum_ok=true` `gate11_1=true` `stop=false` `any_login_200=true` `password_len=20` |

工作区脏：Phase 8 未提交改动，与任务说明一致；本预检未 checkout / 还原。

文档基线 HEAD 前缀 `b3cd4b5` 与实测 `b3cd4b532cd4e7e44398bd465112e9ff84a9684e` 匹配。

---

## 3. 实测 vs 推断

**实测**

- 分支 / HEAD / 5191 唯一监听者 / PID 命令行 / health `migrations:30`。
- 只读 `VACUUM INTO` 新目录成功；副本 `PRAGMA quick_check = ok`。
- 11.1 全部在**本任务新副本**上亲自计数，未抄 T8.0 / T8.8 数字。
- 真库 `schema_migrations` 最大号 `046_reader_mode_preferences.sql`，无 047～050 行。
- 磁盘代码最大编号 050，047～050 文件存在（代码，不是真库已执行）。
- 现网旧体 `{username,password}` + env 密码（长度 20）：学生 / 教师 / 校长均 **200**。
- 现网新体 `{schoolCode:'internal-demo', loginName, password}`：三账号均 **400** `VALIDATION_FAILED`「username 与 password 均为必填项」。
- 学生旧体 200 后立刻 `GET /api/v1/books`（`Cookie` + `X-Workspace-Id: internal-demo-workspace`）**200 / 49**，bookId `book-001`…`book-049`。
- `server/index.js` 先 `createReadmateApplication()` 再 `listen`；`createIdentityModuleWithDatabase` 在 listen 前调用 `runMigrations()`。`index.js` / `app.js` 不引用 `bootstrap-internal-demo.js`。`package.json` 的 `bootstrap:internal` 是独立脚本，不在 listen 路径上。
- 预检结束后 5191 仍为 PID **66104** Listen，未被本任务停止。

**推断（标清楚，不当作闸口事实）**

- health `migrations:30` 对应磁盘 000～046 共 30 个文件；若已用当前工作区新代码重启，listen 前 `runMigrations()` 会把 047～050 打进真库且 health 应为 34。结合 PID 自 12:48 未换、与 T8.8 相同 66104，判定现网仍是**本仓库旧后端**。
- 源 sqlite/wal/shm 与副本 SHA-256 **与 T8.8 演练快照相同**（本任务 VACUUM 发生在登录探测之前）。推断 T8.8 之后到本快照之间业务库主文件未变；这是对照观察，11.1 仍以本次计数为准。
- T8.8 曾记 env 密码长度 12 且副本 hash 不匹配。本次长度为 20，现网旧体三账号 200。推断当前 `.env` 与 T8.8 当时不同或当时解析不同。**本预检未比 hash、未改 hash**；以现网 HTTP 为准。
- 登录 / GET 由现网旧进程处理，成功登录可能写 session / audit（不是本 agent 打开真库写入，也不是迁库）。

---

## 4. 11.1 逐项（副本亲自计数）

源：`D:\Project\整书8.15\server\data\readmate.sqlite`

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| 源 sqlite | 108261376 | `6e3e163d5f2d437c892b2cbfeb44906b6a78dad5a56f9577d0277e6819cff14b` |
| 源 wal | 9723232 | `559dc570f00a2463ef9ec816b06fc5aed6244277db5649e273c28623848b675d` |
| 源 shm | 32768 | `876f1195f345564ec5c0fed079dc57cd21341bf7a81268085a7b594dd281a0d0` |
| 新副本 | 107020288 | `33561d9ed24831672396a63a0d08ed8210cd80128148309e5d4d69b1964ef64a` |

副本路径：`C:\Users\Yak\AppData\Local\Temp\t8-9-preflight-20260818T134256Z\readmate-046-preflight.sqlite`。未 VACUUM 覆盖源。未复用 T8.8 旧副本文件。

| 项 | 期望 | 实测 | 判定 |
|---|---|---|---|
| active 组织 | 1 个 `internal-demo-organization` | 1，active | **pass** |
| active 班 | 1 个 `internal-demo-class`（三年级一班，`grade_id=internal-demo-grade`） | 同左 | **pass** |
| published | 49 | 49（books 仅 published，无 draft/archived） | **pass** |
| versions | 49 | 49 | **pass** |
| grants | 0 | 0 | **pass** |
| active student 班级关系 | 1（`internal-demo-student`） | 1，班 `internal-demo-class` | **pass** |
| active teacher 班级关系 | 2 | `internal-teacher-li`、`internal-teacher-wang` 同班 | **pass** |
| workspace | class/school/platform 各 1，无 grade | 各 1 active，grade=0 | **pass** |
| `grade_manager` 角色行 | 0 | 0 | **pass** |
| `schema_migrations` 最大号 | `046_reader_mode_preferences.sql` | 同左；047～050 未出现 | **pass** |
| `quick_check` | ok | ok | **pass** |
| 磁盘最大编号 | 050 且 047～050 存在 | 34 文件，maxPrefix=050 | **pass**（代码，非真库已执行） |

id / status 未变。未触发「有人已经在真库执行 047～050」。

---

## 5. 登录探测（无密码）

密码只从 `.env` 的 `INTERNAL_DEMO_PASSWORD` 读取。证据只写：使用 env 密码、长度 **20**、是否 200。未写原文。未 `UPDATE credentials`。

库内 username（副本 `users`）：`internal-student` / `internal-teacher-li` / `internal-principal`（另有 `internal-ops-admin`、`internal-teacher-wang`，本步未测）。

| 账号 | 旧体 `{username,password}` | 新体 `{schoolCode,loginName,password}` |
|---|---|---|
| 学生 `internal-student` | **200**（userId `internal-demo-student`，workspace `internal-demo-workspace`） | **400** `VALIDATION_FAILED`「username 与 password 均为必填项」 |
| 教师 `internal-teacher-li` | **200**（workspace `internal-demo-workspace`） | **400** 同上 |
| 校长 `internal-principal` | **200**（workspace `internal-demo-school-workspace`） | **400** 同上 |

学生旧体 200 后：`GET /api/v1/books` **200 / 49**。可见 bookId 已写入 `t8-9-pre-visibility-sets.json`，语义 `old-running-5191`。

HTTP 验收依赖：**已满足**（现网 env 密码可登录旧后端）。新体 400 符合「现网仍是旧登录契约」；正式切换后应用的是新体，不在本预检停机条件内。

---

## 6. 是否可派停机

**可以派停机迁移。** Gate 3 前半（当前基线仍等于 09 §11.1，且现网身份可识别为待切换的旧 5191）通过。

停机 agent 仍须按 09 §13.4：停 5191 → 新时间戳 VACUUM 备份（不得复用本预检副本）→ 再核 11.1 且 grants=0 → 用新代码启动 5191（listen 前 `runMigrations()` 原子执行 047～050）。

---

## 7. 停止条件

下列均未命中：

- 真库 11.1 任一断言失败
- 无法只读 VACUUM
- 有人已经在真库执行 047～050
- 5191 不是本仓库旧后端，或端口上有多个监听者无法唯一识别

故不是 **preflight fail / 不得停机**。

---

## 8. 未触碰红线

- 未改阅读摘要两表 / session-summaries schema / 指纹 / 90s TTL / renew
- 未手写业务库，无 fallback
- 未写真库文件（含本 agent 直接写 wal）
- 未停 5191、未启新后端
- 未开浏览器、未进入 T8.10

---

## 9. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-9-preflight-report.md`
- `docs/product-close-loop/evidence/phase8/t8-9-preflight-summary.json`
- `docs/product-close-loop/evidence/phase8/t8-9-pre-visibility-sets.json`
- 临时副本：`C:\Users\Yak\AppData\Local\Temp\t8-9-preflight-20260818T134256Z\readmate-046-preflight.sqlite`
