# T8.9 正式迁移报告（§13.4 切换）

> Agent：Phase 8 T8.9 正式迁移（未改业务源码）
> 时间：2026-08-18
> 模型：cursor-grok-4.6-xhigh-fast
> 结论先行：**A–D 通过；E.1/E.2/E.4 通过；E.3 因无 HTTP 造 draft 未执行。回退资格已变。未命中须停机回退的停止条件。新 5191 仍在听。**

**已发生新业务写入，agent 不得自行用旧备份覆盖真库。**

未改 `server/**` `src/**` `tests/**` `package.json` 迁移文件。未跑 bootstrap / importSeed。未手写业务 SQL。未覆盖 T8.8 与预检文件。未改 `execution-ledger.md` / `09` / `decisions.md`。未开浏览器。未 commit / push / reset / checkout。密码与 rawToken 未写入证据。

---

## 1. 改动文件

仅新建证据：

- `docs/product-close-loop/evidence/phase8/t8-9-migrate-report.md`
- `docs/product-close-loop/evidence/phase8/t8-9-migrate-summary.json`
- `docs/product-close-loop/evidence/phase8/t8-9-post-visibility-sets.json`
- `docs/product-close-loop/evidence/phase8/t8-9-visibility-set-diff.json`
- `docs/product-close-loop/evidence/phase8/t8-9-d-http-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-9-e-http-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-9-startup-output.txt`

正式备份（不入院仓库）：`C:\Users\Yak\AppData\Local\Temp\t8-9-gate3-20260818T134900Z\readmate-046-official.sqlite`

---

## 2. 实测命令 / 退出码 / 关键原文

| 步骤 | 命令或请求 | 退出码 / HTTP | 关键原文 |
|---|---|---|---|
| 分支 | `git branch --show-current` / `git rev-parse HEAD` | 0 | `feat/product-close-loop` / `b3cd4b532cd4e7e44398bd465112e9ff84a9684e` |
| 停机前 Listen | `Get-NetTCPConnection -LocalPort 5191` | 0 | `127.0.0.1:5191 Listen PID 66104`，Listen 计数 1 |
| 停机前进程 | `Win32_Process 66104/64816/61696` | 0 | `node  server/index.js` ← `cmd /c node server/index.js` ← `npm-cli.js run server` |
| 停机前 health | `GET /api/v1/health` | 200 | `{"status":"ok","database":"sqlite","migrations":30}` |
| 停机 | `taskkill /PID 61696 /T /F` | 0 | 66104 / 64816 / 61696 已结束；5191 Listen=0；5190 仍 Listen |
| 正式备份 | `node %TEMP%\t8-9-gate3-backup.mjs`（`DatabaseSync(readOnly:true)` + `VACUUM INTO`） | 0 | `quick_check=ok`；11.1 全过；`stop=false` |
| 首次启动 | `npm run server` cwd 仓库根 | 进程起来并 listen | `[readmate] listening on http://127.0.0.1:5191` PID **71740** |
| 首次 health | `GET /api/v1/health` | 200 | `migrations:34` |
| 重启（alreadyApplied） | 停 71740 树后再 `npm run server` | listen | PID **10340**；health 仍 34；047–050 `applied_at` 未变 |
| D 旧体登录 | `POST /auth/login` `{username,password}` | 400 | `VALIDATION_FAILED`「schoolCode、loginName 与 password 均为必填项」 |
| D 新体学生 | `POST /auth/login` `{schoolCode,loginName,password}` | 200 | `userId=internal-demo-student` `workspace=internal-demo-workspace` |
| D 学生书目 | `GET /books` + Cookie + `X-Workspace-Id: internal-demo-workspace` | 200 / 49 | `book-001`…`book-049`，added/removed 空 |
| D 教师 publish | `POST /books/book-001/publish` 与 `unpublish` | 403 / 403 | `PERMISSION_DENIED`「当前工作空间无权执行此操作」；grants 仍 49 |
| E 建班 | `POST /classes` `{name,stage,entryYear,classNumber}` | 201 | id `34b41110-8286-4a5d-84a3-ae72c90dd734` `T89验收二班` `primary/2023/2` |
| E 签发/注册/批准 | credentials → `/registration/:token` → approve | 201 / 201 / 200 | 新学生 `bdb84ff0-fedf-4ffe-bebf-c158875e00be` |
| E 新班书目 | `GET /books` 新班 workspace | 200 / 0 | `ids=[]` |
| E 无 grant 租约 | `POST /reading/lease` `book-001-trusted-v1` | 404 | `RESOURCE_NOT_FOUND`「书籍不存在或当前不可读取」；lease 未写 |
| E 本班/外班 shelf | `PUT /classes/:classId/shelf/book-001` | 200 / 200 / 403 | 本班两次幂等 200；外班 403；grants 仍 49 / 新班 0 |

密码只用 `.env` `INTERNAL_DEMO_PASSWORD`（长度 20）。证据不写原文。

---

## 3. 实测 vs 推断

**实测**

- 停机前 5191 唯一监听者仍是本仓库旧后端 PID **66104**，health `migrations:30`。
- 停稳后新 stamp 目录 `VACUUM INTO` 成功；未复用 T8.8 或预检副本。
- 停机后备份上亲自计数 11.1：1 org、1 班 `internal-demo-class` / `internal-demo-grade`、49 published、49 versions、**0 grants**、1 student、2 teacher、无 grade workspace、无 grade_manager、max migration **046**。
- 源 sqlite SHA-256 与预检主文件相同；WAL/SHM 哈希与预检不同（预检登录探测写过 WAL）。副本哈希与字节均新。
- `index.js` 先 `createReadmateApplication()` 再 `listen`；identity 在 listen 前 `runMigrations()`；listen 路径不跑 bootstrap。
- 首次启动后 health 34；只读可见 047–050 行，checksum 与磁盘及 T8.8 演练一致；grants=49；三元组完整；`quick_check=ok`。
- 重启后 047–050 `applied_at` 仍为 `2026-08-18T13:49:23.231Z`，判定第二次为 alreadyApplied。
- D 集合 diff 全空。教师全局 publish 未改 grants。
- E 用 HTTP 造第二班并走签发→注册→批准；新班学生 0 本；无 grant 租约 404 且未写 lease。

**推断（标清楚）**

- 首次启动进程没有把 `runMigrations().applied` 打到 stdout。047–050 在启动前不存在、启动后出现且 `applied_at` 等于首次 listen 时刻，据此记首次 `applied=[047,048,049,050]`。
- E.3：现网无 `POST /books` / catalog import HTTP（09 未新增）。platform `GET /books?status=draft` 为 0。未用 SQL/bootstrap/unpublish 既有书补洞。

---

## 4. 5191 / 备份 / 迁移

| 项 | 值 |
|---|---|
| 旧 PID | **66104**（`node server/index.js`，health 30） |
| 首次新 PID | **71740**（health 34；为 alreadyApplied 检查后主动停） |
| 现网新 PID | **10340**（npm 父进程 66332；health 34；仍 Listen） |
| 正式备份 | `C:\Users\Yak\AppData\Local\Temp\t8-9-gate3-20260818T134900Z\readmate-046-official.sqlite` |
| 备份字节 / SHA-256 | 107028480 / `44d55384ba2b49c4468fd8d42693a3b97cd9ec67bd3d8cb1c48b38bfb050167b` |
| 源 sqlite SHA-256 | `6e3e163d5f2d437c892b2cbfeb44906b6a78dad5a56f9577d0277e6819cff14b` |
| 源 wal SHA-256 | `a7a4e12c33e01d710203ae3ae93d9b38341573111864c67ba554bf78d4be07be` |
| 源 shm SHA-256 | `e0bcfc25d83fe60a7ee4e9d8b49bf2490d440c63d5f3d76c0ad3a341a07a6a23` |
| 首次 applied | `047_login_and_class_identity.sql` `048_registration_credentials.sql` `049_enrollment_and_password_reset.sql` `050_book_access_grant_backfill.sql` |
| 重启 alreadyApplied | 047–050 均在；checksum 未变 |
| grants 检查点 | **49**（D 前 / D 后 / E shelf 后均为 49） |
| 集合 diff | **全空** |

047–050 checksum：

| id | checksum |
|---|---|
| 047 | `de7d7fcad2926427b7b8ed75e9a4bc3691de8fa3a88f8452c30ab9cf99285f48` |
| 048 | `97dcadc912e5c9593b60ccd84ade4987c7208acdd10f75fe42f2b140cf7fccea` |
| 049 | `190cfb10e9fef84991724aeb2fe579c3a77dc6a669a61f637a8b70de7eb5cfff` |
| 050 | `bbb1a4bd103495acfc5e1ffed1e74cc960aae2fa3c2b0ad3ee31982af5eef763` |

---

## 5. 契约逐项

| 项 | 判定 |
|---|---|
| 停机前可唯一识别本仓库旧 5191 | **pass** |
| 5190 / Vite 未停 | **pass** |
| 新时间戳 VACUUM，未复用演练/预检副本 | **pass** |
| 停机后 11.1 全过、grants=0、max=046 | **pass** |
| listen 前 `runMigrations()`，无 bootstrap | **pass** |
| 同一 5191 启动，health 34 | **pass** |
| 047–050 checksum 与磁盘一致 | **pass** |
| 检查点 grants=49、published 当前版本可唯一解析 | **pass** |
| 三元组完整、`quick_check=ok` | **pass** |
| 重启 alreadyApplied / checksum 不变 | **pass** |
| 旧登录体不再当成功契约（实测 400） | **pass** |
| 现有学生新体登录 200、GET /books 200/49、diff 空 | **pass** |
| 教师全局 publish/unpublish 403，grants 不增不减 | **pass** |
| E 新班学生 200/0 | **pass** |
| E 无 grant `acquireLease` 404 同文案且未写 lease | **pass** |
| E 教师本班 shelf 幂等 200、外班 classId 403 | **pass** |
| E draft+本班 grant 后再 `acquireLease` | **fail / 未执行**（无 HTTP 造 draft） |

---

## 6. 遗留

1. **E.3**：platform 无造新 draft 的 HTTP。未 SQL 补洞、未 bootstrap、未把已出版书 unpublish 冒充「造 draft」。D-23 的 draft+grant 负例因此缺一次真 5191 HTTP。
2. E 之后真库已不是 11.1：2 个 active 班、2 个 active student、出现 grade workspace `primary:2023`。这是 §13.4 负例写入，不是回退目标。
3. 浏览器验收仍由用户本人执行。

---

## 7. 停止条件

下列**未命中**（因此未停 5191、未整体恢复备份）：

- 停机后 11.1 不再成立
- 应用在迁移失败/部分编号时仍 listen
- `quick_check` 非 ok
- 重启后 047–050 不是 alreadyApplied / checksum 变
- 学生集合 added/removed 非空
- 检查点 grants 不是 49，或 published 当前版本无法唯一解析
- 新班无 grant 仍看见书
- 教师全局 publish 成功
- 只能靠改 hash / fallback / 手写 SQL 才能过

**已发生、须上报：** 正式切换后已有新业务写入。旧备份仍在上述 TEMP 路径，但 **agent 无权用它覆盖真库**。

---

## 8. 未触碰红线

- 未改阅读摘要两表 / session-summaries schema / 指纹 / 90s TTL / renew
- 未手写业务 SQL，无 fallback / 假成功
- 未换端口顶替，未启动旧代码
- 未改业务源码与测试
- 未开浏览器

---

## 9. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-9-migrate-report.md`
- `docs/product-close-loop/evidence/phase8/t8-9-migrate-summary.json`
- `docs/product-close-loop/evidence/phase8/t8-9-post-visibility-sets.json`
- `docs/product-close-loop/evidence/phase8/t8-9-visibility-set-diff.json`
- `docs/product-close-loop/evidence/phase8/t8-9-d-http-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-9-e-http-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-9-startup-output.txt`
- 正式备份：`C:\Users\Yak\AppData\Local\Temp\t8-9-gate3-20260818T134900Z\`
