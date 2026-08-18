# Phase 8 文档完备度与执行台账

> 建立时间：2026-08-18
> 用途：判断是否可以把 Phase 8 直接交给 Grok 主控。状态只按可观察产物更新，不以“讨论过”代替“已写成可执行契约”。

## 当前结论

**Phase 8 收口（2026-08-18）。T8.2～T8.9 verified；Gate 1–3 已过；用户称浏览器验收暂时没有问题。**

收口质量门：server 437/437，frontend 270/270，build EXIT 0。见 `close-report.md`。未 push。下一阶段是 Phase 6，须另授权。

**顺序纠正：** Phase 8 先实施并完成，Phase 6 再基于最终系统做阅读计时联动验收。Phase 8 实施期间 Phase 6 不得占用共享 5191、不得写真实业务库、不得修改阅读计时相关文件。

## 完备度清单

| 交付物 | 状态 | 交付前必须达到的可判定结果 |
|---|---|---|
| Phase 8 单一权威与历史覆盖声明 | 已完成 | `09`、Phase 8 decisions、02/03/04、Phase 4 追记指向一致 |
| 产品角色、教师免审、学生审批、学年、重名、密码重置、书库边界 | 已完成 | `09` 第一节与 P8-01～P8-10 无开放产品问题 |
| D-25 正式留痕 | 已完成 | 缺陷台账、09、Phase 8 decisions、Phase 4 追记均可检索 |
| 完整动作清单与角色 × scope 矩阵 | Gate 1 通过 | `09` §10、§10.4 |
| 教师归属技术契约 | Gate 1 通过 | `09` §10.3、§10.4、§11.6、§12；leave_self 幂等见 P8-17R |
| 注册凭据与密码重置技术契约 | Gate 1 通过 | `09` §11.4～11.6、§12 |
| 学生入班审批队列 | Gate 1 通过 | `09` §11.5～11.6、§12 |
| 班级与账号标识迁移 | Gate 1 通过 | `09` §11.2～11.3 |
| version/幂等先后次序与错误码 | Gate 1 通过 | `09` §12.1～12.4；`If-Match` 优先级已固定 |
| 学生行政纠错三关系原子搬迁 | Gate 1 通过 | `09` §11.6；源/目标对称校验已固定 |
| 重置凭据查询/撤销与多教师轻提示 | Gate 1 通过 | `09` §12.2；不引入教师审批状态 |
| D-25 权限拆分与班级书架写 API | Gate 1 通过 | `09` §10、§12.2、§13.1 |
| 默认全闭迁移 | Gate 1 通过 | `09` §13.2～13.5；T8.2 拥有 050 |
| 可见性测试夹具重做 | Gate 1 通过 | `09` §14.1～14.2 |
| D-21/D-22/D-23 实施与验证边界 | Gate 1 通过 | `09` §14.3～14.5 |
| 停止条件清单 | 已完成 | `09` §16 |
| 复核闸口 | Gate 1、Gate 2、Gate 3 技术放行 | `09` §17；T8.10 须用户本人浏览器验收 |
| Grok 主控任务包与子 agent 提示模板 | 已完成 | `09` §15；T8.2 拥有 047～050 |
| Phase 8 端到端验收清单 | 已完成 | `04` G1～G20 |
| Gate 1 独立权限/数据一致性复核 | **verified** | 用户 2026-08-18 批准；证据见本节 T8.1 与下方顺序纠正 |

## 交付判定

Gate 1、Gate 2、Gate 3 技术放行已完成。用户称 T8.10 暂时没有问题。交付入口只给 `09`。未宣称 G1–G20 逐条 L4。

## T8.0 基线核对（2026-08-18）

核对 agent：只读。唯一写入本文件。未改业务源码、迁移、bootstrap、测试、真库、09、decisions、git 状态；未 checkout/reset/stash/clean/restore；未重启或占用 5191；未开浏览器；未手写业务库。

### 实测

#### A. Git / 工作区

工作目录：`D:\Project\整书8.15`

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `git branch --show-current` | 0 | `feat/product-close-loop` |
| `git rev-parse HEAD` | 0 | `b3cd4b532cd4e7e44398bd465112e9ff84a9684e` |
| `git log -1 --format="%H %s"` | 0 | `b3cd4b532cd4e7e44398bd465112e9ff84a9684e feat(student): Phase 5 Reader 补缺（跳页、空白页、退出、模式持久化）` |
| `git status --porcelain` | 0 | 见下方 dirty 列表（目录级） |
| `git status --porcelain --untracked-files=all` | 0 | 展开未跟踪目录后的完整文件清单 |
| 对照 09 §11.1 定稿 HEAD | — | 文档写 `b3cd4b5`；本次完整哈希前缀匹配 |

`git status --porcelain`（目录级）：

```
 M docs/product-close-loop/02_决策与契约边界.md
 M docs/product-close-loop/03_实施任务清单.md
 M docs/product-close-loop/04_端到端验收清单.md
 M docs/product-close-loop/05_主控交接说明.md
 M docs/product-close-loop/09_Phase8班级管理系统设计与交接.md
 M docs/product-close-loop/design/role-model-extension.md
 M docs/product-close-loop/evidence/phase2/defect-ledger.md
 M docs/product-close-loop/evidence/phase4/decisions.md
?? .cursor/
?? .trellis/
?? AGENTS.md
?? docs/product-close-loop/evidence/phase8/
```

针对 09 §15 实现路径的定向 `git status --porcelain --`（`server/db/migrations`、`server/db/bootstrap-internal-demo.js`、`server/domains/identity`、`server/domains/reading`、`server/domains/community`、`server/http/integration-router.js`、`src/api/auth.js`、`src/api/console.js`、`src/api/student.js`、`src/console/pages/accounts`、`src/console/pages/teaching`、`src/console/state/useBookVisibility.js`、`src/console/state/useBookWriteActions.js`、`tests`）：退出码 0，输出为空。

未跟踪展开计数：`.trellis/` 75 个文件（spec / workflow / `08-15-book-025-ocr-repair` 归档）；`.cursor/rules/subagent-model-selection.mdc` 1 个；`AGENTS.md` 1 个；`evidence/phase8/` 2 个（`decisions.md`、`execution-ledger.md`）。

#### B. 迁移最大编号

列目录：`server/db/migrations/*.sql`。取号方式：文件名前 3 位数字，**不是**文件数量。

- 文件总数：30
- 最大编号：046（`046_reader_mode_preferences.sql`）
- 全部编号：000 001 002 003 004 005 010 011 012 013 014 015 020 021 022 023 024 025 026 030 031 032 033 040 041 042 043 044 045 046
- 047 / 048 / 049 / 050：均未被占用

#### C. 09 §11.1 真库只读基线

配置实测：

- 仓库根存在 `.env`；键名仅 `SESSION_TOKEN_SECRET`、`INTERNAL_DEMO_PASSWORD`、`PUBLIC_ASSET_DIR`。**没有** `DATABASE_PATH`、`PORT`、`HOST`、`INTERNAL_DEMO_MODE`。
- `.env.example` 写 `PORT=5191`、`DATABASE_PATH=server/data/readmate.sqlite`。
- `server/domains/identity/index.js` `defaultDatabasePath()` → `server/data/readmate.sqlite`（相对该模块解析为 `D:\Project\整书8.15\server\data\readmate.sqlite`）。
- `server/runtime-options.js` 默认端口 5191。
- 业务库文件存在：`readmate.sqlite` 107089920 字节，另有 `-wal` 9723232 字节、`-shm` 32768 字节（时间戳 2026-08-18 12:48–12:50，与 5191 进程启动时间一致）。

打开方式：本机无 `sqlite3` CLI。使用 `node:sqlite` `DatabaseSync(path, { readOnly: true })`。**未**调用 `openSqliteDatabase()`（该函数会 `mkdirSync` 并执行 `PRAGMA journal_mode = WAL`，属写操作）。未执行 INSERT/UPDATE/DELETE/VACUUM。脚本退出码 0。`PRAGMA quick_check` = `ok`。

只读查询结果（本次实测，非抄 09）：

| 项 | 实测 |
|---|---|
| active 组织 | 1：`internal-demo-organization` / 读伴公共领域内部联调学校 / active |
| 全部组织 | 同上 1 行 |
| active 班级 | 1：`internal-demo-class` / 三年级一班 / `grade_id=internal-demo-grade` / active / org=`internal-demo-organization` |
| 全部班级 | 同上 1 行 |
| published 书 | 49（`books` 仅 published=49，无 draft/archived） |
| `book_versions` | 49 |
| `book_access_grants` | 0 |
| active student 班级关系 | 1：`class-member-internal-student` / user=`internal-demo-student` / class=`internal-demo-class` |
| active teacher 班级关系 | 2：`internal-teacher-li`、`internal-teacher-wang`，均属 `internal-demo-class` |
| active class workspace | 1：`internal-demo-workspace` / code=`class-teacher` / scope_type=`class` / scope_id=`internal-demo-class` |
| active school workspace | 1：`internal-demo-school-workspace` / code=`school-admin` / scope_type=`school` / scope_id=`internal-demo-organization` |
| active platform workspace | 1：`internal-demo-platform-workspace` / code=`platform-ops` / scope_type=`platform` / scope_id=`readmate-platform` |
| grade workspace | 0 |
| `role_assignments` `grade_manager` | 0 |
| `role_code='grade_group'` | 0 |
| role_code 分布（active） | platform_ops=1, school_admin=1, student=1, teacher=2 |
| active 学生多班 | 0 |
| class/grade 重复 active workspace | 0 |
| 跨组织 class/workspace/role 关系 | 0 / 0 / 0 |
| 教师三关系残缺 | 0（两名教师均有 active `class_memberships` + `workspace_memberships` + `role_assignments(role_code=teacher, class)`） |
| 学生三关系残缺 | 0（`internal-demo-student` 三关系齐全，`role_code=student`） |
| users（5，均 active） | `internal-demo-student`/`internal-student`/林小竹；`internal-ops-admin`；`internal-principal`/陈校长；`internal-teacher-li`/李老师；`internal-teacher-wang`/王老师 |
| `users` 列 | `id, organization_id, username, display_name, status, created_at, updated_at, version`（无 school_code/login_name/account_code） |
| `classes` 列 | `id, organization_id, grade_id, name, status, created_at, updated_at, version`（无 stage/entry_year/class_number） |
| `organizations` 列 | `id, name, status, created_at, updated_at, version`（无 school_code） |
| `schema_migrations` 最大 | `046_reader_mode_preferences.sql`（applied_at `2026-08-18T04:48:08.967Z`） |
| schema_migrations 含 047+ | 否 |
| 已执行迁移 checksum vs 当前文件 | 30 条全部一致；无缺文件、无未应用文件 |

#### D. 09 引用设施（代码/schema 只读）

表：见「设施存在性」。

路由（相对 `/api/v1`，读 `server/domains/identity/index.js` 与 `server/http/integration-router.js`）：

| 路由 | 实测 |
|---|---|
| `POST /classes` | 存在。`requireSchoolClassManage` 的 resourceScope 为 `{ type:'school', id: organizationId, organizationId }`，**无 gradeId** |
| `POST /students` | 存在 |
| `GET/PUT /books/:bookId/visibility` | 存在（Phase 8 计划删除，当前仍在） |
| `POST /books/:bookId/publish` / `unpublish` | 存在 |
| `POST /reading/lease` | 存在，调用 `acquireLease` / `takeOverLease` |
| `POST /reading/lease/:leaseId/renew` | 存在 |
| `POST /reading/session-summaries` | 存在 |
| `GET /assignments` | 存在 |
| 社区读取 | HTTP：`GET /community/posts` 列表。领域：`community.getPost` 存在。**无** `GET /community/posts/:postId` |
| `POST /auth/login` | 存在；请求体仍是 **username + password**（username-only 登录，无 schoolCode/loginName） |
| registration / enrollment / password-reset / teacher class join | 全仓 `server/**/*.js` 检索无匹配路由。**不存在**（符合预期） |

权限与谓词：

- `server/domains/identity/permissions.js`：`roleActions`、`roleAliases`、`scopeAllows` 均存在。
- `roleAliases` **仍含** `grade_group → grade_manager`（另有 `class_teacher→teacher`、`grade_admin→grade_manager`、`platform_operator→platform_ops`）。
- `book.publish` 当前授予：teacher、grade_manager、school_admin、platform_ops。
- `book.import` 当前授予：grade_manager、school_admin、platform_ops（teacher **无**）。
- `book.archive` 当前授予：school_admin、platform_ops。
- `server/domains/identity/class-scope.js` 存在：`listAuthorizedClasses`、`authorizedClassIdSet`、`hasBookLibraryManagementRole`。
- F-1 对称校验：`catalog.setBookVisibility`（`server/domains/reading/catalog.js`）。新增：`requestedClassIds` 对 `grantable` 过滤；移除：`listBookClassGrantTargets` + `revokedBeyondScope` 对 active 且不在保留集的班再验 `grantable`；悬空（非 active）豁免。
- `visibility.js`：`isBookVisibleToAudience`、`BOOK_HAS_GRANTS_SQL`（无 grants → true）、`resolveBookAudience` 仍返回 `{ unrestricted, classIds }`（管理角色 `unrestricted: true`）。
- `context.authorize` fail-open：`visibility.js` 顶部注释仍在；`server/domains/reading/sql.js` `authorize: dependencies.authorize \|\| (async () => true)` 仍在。identity `service.authorize` 本身走 `evaluatePermission`，不是 fail-open。
- `findUserScope`：只 JOIN `classes.status='active'`；不按 `membership_role` 过滤。
- `currentBookVersionSubquery`：`ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1`。
- 幂等：`executeIdempotent` / `Idempotency-Key` 存在于 identity 与 integration-router。`expectedVersion(req)` 在 `identity/index.js`：`If-Match` 优先于 body `version`。
- 事务：`server/db/database.js` `withTransaction` 使用同步 `BEGIN IMMEDIATE`；bootstrap / reading/sql / 多处领域同样使用。
- `acquireLease`：先 `authorize('reading.read_self')`，再 `requireScopedBookVersion(..., publishedOnly=false)`，**不**检查 `books.status='published'`，**不**调用 `isBookVisibleToAudience`。TTL 写死 `90 * 1000`。此为 D-23 现状。

#### E. Phase 6 归档

| 检查 | 实测 |
|---|---|
| `docs/product-close-loop/evidence/phase6/` | `Test-Path` = False。`evidence/` 现有子目录：phase0、phase2、phase3、phase4、phase5、phase8 |
| `05_主控交接说明.md` 第 10 节 | 有 Phase 3 / D-19→Phase 4 / Phase 3 收口 / Phase 8 产品入口，**无** Phase 6 完成交接 |
| `07` / `08` 之外的 Phase 6 完成声明 | `07` 是 Phase 4 收尾；`08` 是 Phase 5 交接且无 Phase 6 字样；未找到「Phase 6 完成/已归档」声明。`03` Phase 6 仍是待验证任务清单 |

#### F. 5191 占用（只观察）

`Get-NetTCPConnection -LocalPort 5191`：`127.0.0.1:5191` Listen，OwningProcess **66104**。

进程：`node.exe`，路径 `D:\IDE\Node.js\node.exe`，启动 2026-08-18 12:48:08，命令行 `node  server/index.js`。

未重启、未杀进程、未对该端口发写请求。

### 推断

- `.env` 无 `DATABASE_PATH`，运行中的 `node server/index.js` 应走 `defaultDatabasePath()`，即本次打开的 `server/data/readmate.sqlite`。WAL 时间戳与该进程启动时间一致，支持「5191 正在用这份业务库」，但本次未向 5191 发请求取证。
- 会话开始时的仓库快照曾列出若干 `server/**`、`tests/**` 未跟踪/改动文件。本次实测 porcelain 与针对 T8.2～T8.6 路径的定向 status 均为空；不以过期快照为准，也未还原任何文件。
- 设施「语义不同」项（username-only 登录、`unrestricted`、`BOOK_HAS_GRANTS_SQL` 默认全开、`grade_group` 别名仍在、`acquireLease` 未验 published+visibility、`POST /classes` 纯 school scope）是 09 已记录的**当前**行为，计划中的调用点本身存在，不构成停止条件 4。
- Phase 6 未归档不否定本次 11.1 数字，但 T8.2 以后若 Phase 6 验收改写阅读数据或演示账号状态，必须重新跑本核对。

### 对照 11.1

| 断言 | 结果 |
|---|---|
| 分支 `feat/product-close-loop` | pass |
| HEAD 匹配 `b3cd4b5` | pass（完整哈希 `b3cd4b532cd4e7e44398bd465112e9ff84a9684e`） |
| 迁移最大号 046 | pass |
| 1 active 组织 | pass（`internal-demo-organization`） |
| 1 active 班 `internal-demo-class` / `internal-demo-grade` / 三年级一班 | pass |
| 49 published | pass |
| 49 versions | pass |
| 0 grants | pass |
| 1 active student 班级关系 | pass |
| 2 active teacher 班级关系 | pass |
| class/school/platform workspace 各 1 | pass |
| 无 grade workspace | pass |
| 无 `grade_manager` | pass |
| 本任务允许文件未与无关脏改动冲突；T8.2～T8.6 实现路径无 dirty | pass |

### 设施存在性

| 设施 | 判定 | 路径 / 符号 |
|---|---|---|
| `book_access_grants` 三元组、无 grantee_type CHECK | 存在 | `010_reading_catalog.sql`；真库 `sqlite_master` 无 CHECK |
| `class_memberships` membership_role student/teacher | 存在 | CHECK 含 student/teacher/assistant |
| `workspace_memberships` | 存在 | `000_identity.sql` |
| `role_assignments` scope_type CHECK、role_code | 存在 | `005` 重建表；scope_type CHECK own/class/grade/school/platform |
| `workspaces` code CHECK 含 grade-admin/grade-group | 存在 | 真库 sql 含 `'class-teacher', 'grade-group', 'grade-admin', 'school-admin', 'platform-ops'` |
| `organizations` / `users.username`；尚无 school_code/login_name/account_code | 存在（缺列属预期） | 真库 PRAGMA table_info |
| `classes.grade_id`；尚无 stage/entry_year/class_number | 存在（缺列属预期） | 真库 PRAGMA table_info |
| `audit_events` | 存在 | `002_reliability.sql` |
| `books` / `book_versions` | 存在 | `010_reading_catalog.sql` |
| `reading_summary_sessions` / `reading_daily_book_summaries` | 存在（只确认，未改） | `043_reading_session_summaries.sql` |
| `active_reading_leases` | 存在 | `011_reading_activity.sql` |
| `POST /classes`、`POST /students` | 存在 | `identity/index.js` |
| visibility / publish / lease / renew / session-summaries / assignments | 存在 | `integration-router.js` |
| 社区 `getPost` | 存在 | `community/index.js` `getPost`；列表在 `projectCommunityPosts` |
| `POST /auth/login` username-only | 存在 / 语义为旧登录 | `identity/index.js` 187–226 |
| registration/enrollment/password-reset/teacher join 路由 | 不存在（预期） | server JS 无匹配 |
| `roleActions` / `roleAliases` / `grade_group→grade_manager` / `scopeAllows` | 存在 | `permissions.js` |
| `class-scope.js` | 存在 | `server/domains/identity/class-scope.js` |
| F-1 新增+移除对称校验 | 存在 | `catalog.setBookVisibility` |
| `isBookVisibleToAudience` / `BOOK_HAS_GRANTS_SQL` / `unrestricted` | 存在（默认全开语义） | `visibility.js` |
| authorize fail-open 注释与默认值 | 存在 | `visibility.js` L17；`reading/sql.js` L13 |
| `findUserScope` 只认 active 班 | 存在 | `repository.js` 238–277 |
| `currentBookVersionSubquery` created_at DESC, id DESC | 存在 | `visibility.js` 7–11 |
| idempotency + `expectedVersion` / If-Match | 存在 | `identity/index.js` `expectedVersion`；`executeIdempotent` |
| 同步 `BEGIN IMMEDIATE` | 存在 | `database.js` `withTransaction` |
| `acquireLease` published + visibility | 语义不同（D-23 现状：二者均未查） | `catalog.js` `acquireLease` |
| `POST /classes` resourceScope 纯 school、无 gradeId | 存在（09 要求确认的现状） | `identity/index.js` `requireSchoolClassManage` |

### dirty files 分类

| 分类 | 文件 | 与后续实现重叠 |
|---|---|---|
| 1. 本轮授权 Phase 8 文档 | `02` `03` `04` `05` `09`；`design/role-model-extension.md`；`evidence/phase2/defect-ledger.md`；`evidence/phase4/decisions.md`；`evidence/phase8/decisions.md`；`evidence/phase8/execution-ledger.md` | 否。本任务只写最后一项 |
| 2. 会与 T8.2～T8.6 重叠 | 无 | T8.2 迁移/bootstrap、T8.3 identity、T8.4 reading/community、T8.5 HTTP/API client、T8.6A accounts/登录注册、T8.6B teaching/visibility hooks、T8.7 25 条守卫：定向 status 均为干净 |
| 3. 其它历史脏文件 | `.cursor/rules/subagent-model-selection.mdc`；`AGENTS.md`；`.trellis/` 75 个文件（backend/frontend/guides spec、`workflow.md`、`08-15-book-025-ocr-repair` 任务与 luna 归档） | 否，不在 09 §15 实现所有权内 |

### Phase 6

**未归档。**

Gate 1 可以完成，但 T8.2 以后必须等待 Phase 6 归档并重新核对基线。

### 停止条件命中

无。

1. 分支正确，HEAD 匹配，本任务允许文件（仅本 ledger）无冲突重叠；其它脏文件按任务说明不构成本任务重叠。
2. 目录最大号 046，047–050 空闲，已执行 checksum 与文件一致；取号用前 3 位最大号，未按文件数 30 推号。
3. 11.1 计数与 id/status 全部命中。
4. 09 引用的既有表/路由/权限/谓词均存在；语义差异为已记录的当前行为，计划调用点在。
5. 无学生多班、无 class/grade 重复 active workspace、无三关系残缺、无跨组织关系、无 `role_code='grade_group'` 数据。

### 结论

**基线一致。**

附带约束（非 11.1 BLOCKED）：Phase 6 未归档，Gate 1 可做只读复核；T8.2 及之后的迁移/bootstrap/实现不得在 Phase 6 归档并重核基线之前开工。5191 已被既有后端占用，后续任务不得在用户验收窗口擅自重启。

## T8.1 Gate 1 独立复核（2026-08-18）

复核 agent：只读，未改任何文件。主控抽查源码/真库后分类，并把 B/C 落入 `09` §10.4 与 `decisions.md` P8-16～P8-23。未写业务代码，未开浏览器，未重启 5191。

### 实测（主控抽查，不是转述）

| 动作 | 结果 |
|---|---|
| `git branch --show-current` / `rev-parse HEAD` | `feat/product-close-loop` / `b3cd4b532cd4e7e44398bd465112e9ff84a9684e` |
| `git status --porcelain` | 仅 Phase 8 文档、`.cursor/`、`.trellis/`、`AGENTS.md`；T8.2～T8.6 实现路径干净 |
| 迁移目录 | 30 个 sql，最大号 **046**，047～050 空闲 |
| 只读 `DatabaseSync(..., { readOnly: true })` | `quick_check=ok`；1 org `internal-demo-organization`；1 班 `internal-demo-class` / `internal-demo-grade` / 三年级一班；published=49；versions=49；grants=0；student=1；teacher=2；workspace 3 个（class/school/platform）；grade_manager=0；grade_group=0 |
| 5191 | `127.0.0.1:5191` Listen，PID 66104。未操作 |
| `service.authorize` / `listActiveRoleAssignments` | 要求 active workspaceId |
| `integration-router.js` L448 | 全局 `requireWorkspace` |
| `identity/index.js` L158–166 / L329–361 | `POST /classes` 纯 school resourceScope；`POST /students` 仍用 `account.manage` 直接建已入班学生 |
| `class-scope.js` L34 | school/platform assignment → `wholeOrganization=true` |
| `catalog.js` L104/200/262 | `audience.unrestricted` 同时绕过 grants 与 published |
| `visibility.js` L19–26 / L47–50 | 仍返回 `{ unrestricted, classIds }`；无 grants → true |
| `projections.js` L326 / L353 | `projectCommunityPosts` 原样返回 `quote.text`；`projectAssignments` 把 `book_version_id` 放进 `book.id` |
| `community/index.js` `getPost` L205 | 无可见性过滤 |
| 两个 `Login.jsx` L45–46 | 空 `defaultPath` 即 throw，文案为登录失败 |
| `book-visibility-guard.test.js` L1489–1513 | 不可见/draft lease 现状断言 200 |
| `evidence/phase6/` | 不存在 |

### 推断

- 5191 正在听，WAL 时间戳与进程启动接近，应在用这份业务库；主控未向 5191 发请求。
- 会话初 git 快照里的若干 server/tests 脏文件，本次 porcelain 已不存在；未还原任何文件。
- reviewer 九个推翻点中，三关系原子物化、纠错对称、token 隔离、幂等/version 次序、050、D-23 未能推翻，主控同意列为 A。

### 主控分类

| 复核项 | 分类 | 处置 |
|---|---|---|
| 教师免审、学生审批、年级主任两项例外、全局书库分权、050 集合等价、D-21～D-23/D-25 纳入、冻结计时 | A | 不进 Gate 1 未关闭项 |
| `GET /classes` 写 S/G/C vs 矩阵教师 V | B | 已落入 §10.4 / P8-17 |
| `leave_self` session-only vs C | B | 已落入 §10.4 / P8-17 |
| `POST /students` 与审批模型冲突 | B | 已落入 §10.4 / P8-18 |
| `unrestricted` 拆维后未绑定 `listBooks`/`getBookAsset`/`requireScopedBook` | B | 已落入 §10.4 / P8-19 |
| §4 照用 class-scope vs shelf 仅 C | B | 已落入 §10.4 / P8-20 |
| V 不能复用现网 authorize 链，查询未写死 | B（文档已禁复用，缺可执行查询） | 已落入 §10.4 / P8-16 |
| D-21/D-22 线上投影在 `projections.js`，§15 无写入方 | C | 已落入 §10.4 / P8-22；T8.5 补所有权 |
| `navigationForUser` 空路径会被 Login.jsx 判失败 | C | 已落入 §10.4 / P8-21 |
| 必须交用户重选产品方向 | D | **无** |

### 写路由唯一映射

落入 §10.4 后：每个 12.2 写路由能唯一映射到 action + scope + 事务 + 审计 + 测试。原先无法唯一映射的项已锁死：`leave_self` 的 Self 评价、session-only 审计 workspace=null、`POST /students` 退役、shelf 只用 class teacher assignment、V 查询、`allowUnpublished` 入口列表。`book.catalog.import/archive` 本期不新增 HTTP。

### 停止条件

本次未命中 §16 第 1～5 条：分支/HEAD/迁移号/11.1/设施调用点均在；语义差是 09 已记录的当前行为。未派代码 agent，因此也未触发 6～22。

### 结论

**不可进入 Phase 8 代码阶段。**

1. 等待用户明确批准 Gate 1。
2. Gate 1 可以完成，但 T8.2 以后必须等待 Phase 6 归档并重新核对基线。

> 上表第 2 条已被下方「顺序纠正」覆盖。本段保留为 T8.1 当时结论，不删除。

## 顺序纠正与 Gate 1 批准（2026-08-18）

用户审阅 Gate 1 报告后明确：

- 八项新增执行锁方向认可，无新的产品裁决。
- **既定顺序：** Phase 8 先实施并完成 → Phase 6 再基于最终系统做阅读计时联动验收。Phase 6 尚未归档不是 T8.2 的阻塞条件。
- leave_self 与 §11.6/§12.1 幂等对齐，见 P8-17R。
- T8.2 唯一拥有 047～050；050 只做 §13.2 回填。
- POST /students 唯一方案：T8.3 删除路由，见 P8-18R。
- Gate 1 批准。不含 T8.9、重启/替换共享 5191、浏览器、Phase 6 正式验收。做到 Gate 2 停止。

Phase 8 实施期间隔离：Phase 6 不得占用共享 5191、不得写真实业务库、不得修改阅读计时相关文件。

文档已改：`09` §五/§六/§九/§10.4/§12.2/§15/§17；`decisions.md` P8-17R、P8-18R、P8-24。T8.0/T8.1 证据未删。

### 下一步

T8.2 in_progress。先独立守卫测试，再实现。

## T8.2 开工（2026-08-18）

状态：`in_progress`。先派守卫测试 agent，再派实现 agent。实现者不得改守卫测试。

## 新主控接手（2026-08-18 17:31）

主控已完整阅读 `09`、`decisions.md`（P8-17R / P8-18R / P8-24）与本台账「当前结论 / 顺序纠正与 Gate 1 批准 / T8.2 开工」。

确认并继续执行：

- Gate 1 已由用户批准，不重做，不重开产品模型。
- Phase 6 未归档不阻塞。Phase 8 先实施。
- 本轮授权 T8.2～T8.8，到 Gate 2 停止。
- T8.9 真库迁移、重启/替换共享 5191、浏览器操作、Phase 6 正式验收均未授权。

T8.2 台账为 `in_progress`，但不假设无半成品。先派只读交接核对 agent；无半成品再按 T8.2A 守卫 → T8.2B 实现 → T8.2C 独立验证。T8.2 verified 后并行 T8.3 / T8.4。

## T8.2 交接核对（2026-08-18）

状态：`verified`（只读核对，**不是** T8.2 实现 verified）。

核对 agent：[T8.2 只读交接核对](c7c31878-c4ac-4f89-a0cf-9b41476405e1)。只读，未改任何文件，未连库，未请求 5191。

### 实测（交接报告；主控另做一条编号抽查）

- 分支 `feat/product-close-loop`，HEAD `b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）。
- 迁移 30 个文件，前 3 位最大号 **046**；047～050 均空闲；全仓无 `047_*`～`050_*` 文件。
- T8.2 允许路径 porcelain 为空；无未跟踪迁移/测试；无 lock/WIP。
- `server/db/bootstrap-internal-demo.js` tracked 且未 dirty；仍无第二班 / grade workspace / `grade_manager`（基线缺口，不是半成品）。
- `tests/server/db` 无 Phase 8 迁移守卫；新 migration test 尚不存在。
- `evidence/phase8/` 仅 `decisions.md`、`execution-ledger.md`。
- 本次**未**重核 11.1 真库数字。

### 契约

| 项 | 结果 |
|---|---|
| 分支 / HEAD 前缀 | pass |
| 最大号 046、047～050 空闲 | pass |
| T8.2 范围无半成品、无并发写者 | pass |
| 停止条件 | 未命中 |

### 下一步

派 T8.2A 迁移守卫。文件所有权：仅新建 `tests/server/db/phase8-047-050-migration.guard.test.js` 与本目录 T8.2A 证据。不得改迁移、bootstrap、既有测试。

主控抽查（只读一条命令，EXIT=0）：迁移 count=30，max=046，047～050 occupied=False。与交接报告一致。

## T8.2A 迁移守卫（2026-08-18）

状态：`verified`（守卫已就位并运行红；**不是** T8.2 实现 verified）。

守卫 agent：[T8.2A 迁移守卫测试](770eb769-7c23-40ef-b4c4-35e3248b4b8b)

### 实测

- 新建 `tests/server/db/phase8-047-050-migration.guard.test.js`
- `node --test tests/server/db/phase8-047-050-migration.guard.test.js` 退出码 1；26 条，1 pass / 25 fail / 0 skip
- 25 红均在 `必须恰好存在一个 047_* 迁移文件，实际: 无`；唯一绿是「不接触真实业务库」
- 未创建 047～050，未改 bootstrap
- 证据：`docs/product-close-loop/evidence/phase8/t8-2a-guard-report.md`、`t8-2a-guard-test-output.txt`

### 主控抽查

读守卫源码关键片段，确认 12 个覆盖点与负例都有后续断言，不是只有文件名检查。已锁死：047 回填值与触发器、A+rowid 短编号、048 列/角色/hash/max_uses、049 部分唯一、050 的 49 行与 `created_at DESC, id DESC`、046 双班/已有 grant/无 version/双 membership 必须失败、bootstrap 第二班/grade workspace/grade_manager。未重跑整套测试。

### 下一步

T8.2B 实现 047～050 与 bootstrap。禁止修改 T8.2A 守卫。

## T8.2B 迁移实现（2026-08-18）

状态：`in_progress`（实现方自称完成；**尚未**独立验证，不能标 verified）。

实现 agent：[T8.2B 实现 047-050](247dc58c-0835-4ef8-9c6e-43720178ef75)

### 实现方报告（待 T8.2C 复验，不是事实源）

- 新建 `047_login_and_class_identity.sql`、`048_registration_credentials.sql`、`049_enrollment_and_password_reset.sql`、`050_book_access_grant_backfill.sql`
- 改 `bootstrap-internal-demo.js`
- **额外改了未预授所有权的 `server/db/seed.js`**（声称 identity-split 在 bootstrap 前走 `importSeed`，047 触发器否则拒插）
- 自称 `node --test tests/server/db/phase8-047-050-migration.guard.test.js` 退出码 0，26/26
- 自称 `bootstrap-identity-split.test.js` 退出码 0
- 证据：`docs/product-close-loop/evidence/phase8/t8-2b-implement-report.md`

### 主控抽查（最小，未复跑测试）

读 `050_book_access_grant_backfill.sql`：无 `ON CONFLICT`；先决条件失败靠 CHECK(allowed=1)；当前版本 `created_at DESC, id DESC`；id/actor 格式符合 §13.2；毕业过滤按 stage 学段长度。047 有「0 班或仅 internal-demo-class」停止。`seed.js` 越权是否必要、守卫是否被改弱，交 T8.2C。

## T8.2C 独立验证（2026-08-18）

状态：`verified`（验证包本身完成）。验证 agent：[T8.2C 独立验证迁移](fd9feb81-f73a-4c4f-afb7-6a3b6a4559dd)。只写证据，未改实现。

### 独立实测（不是抄 T8.2B）

| 命令 | 退出码 | 关键数字 |
|---|---|---|
| `node --test tests/server/db/phase8-047-050-migration.guard.test.js` | 0 | 26 pass / 0 fail / 0 skip；标题与 T8.2A 逐条一致 |
| `node --test tests/server/db/bootstrap-identity-split.test.js` | 0 | 1 pass |
| 独立 mkdtemp smoke | 0 | 全新库 applied=34、`quick_check=ok`、grants=0；046 形升 050 后 grants=49、`quick_check=ok`；再跑 `applied=[]`、checksum 不变、grants 仍 49 |

真库 `readmate.sqlite` size=107089920、mtime 未变。未碰 5191。047～050 无冻结表 DDL、无 `ON CONFLICT DO NOTHING`。

证据：`t8-2c-verify-report.md`、`t8-2c-guard-test-output.txt`、`t8-2c-bootstrap-identity-split-output.txt`、`t8-2c-smoke-output.txt`。

### 主控抽查

读 smoke 原文：`SMOKE2_GRANTS=49`、`SMOKE3_APPLIED=[]`、`SMOKE3_CHECKSUMS_UNCHANGED=true`、`SMOKE_OPENED_REAL_DB=false`、`SMOKE_RESULT=PASS`。与报告一致。未复跑整套迁移。

### seed.js 所有权裁决

**接受为 T8.2 必要插入层，事后追认。** 只补 047 必填列默认值，未夹带凭据/grants/读取谓词。后续 agent **不得**再借此扩大 `seed.js`。程序越权已记本台账，不打回实现。

### 残留（不阻塞 T8.2）

- 047 班级新列允许全 NULL，供 identity-split 旧形先插入。
- 已回填 `A+rowid` 的库若再跑 bootstrap，可能与 seed 默认 `U+…` 冲突；T8.9 处理。
- 全新库 + bootstrap 后 050 不会给新书补 grant；演示书架属后续可见性任务。

## T8.2 收口（2026-08-18）

状态：`verified`。实现报告与独立验证一致，主控抽查未推翻。停止条件未命中。

下一步：T8.3 与 T8.4 并行。先派两边的独立守卫，再派实现。T8.5 必须等二者都 verified。

## T8.3A / T8.4A 守卫开工（2026-08-18）

状态：两边守卫均已就位（不是实现 verified）。实现者不得改这些守卫。

### T8.3A

agent：[T8.3A 身份领域守卫](bffdea04-c35b-4ff5-8291-d02eb9acdae5)（第一轮供应商失败后同配置重派）

- 目录 `tests/server/core/phase8-identity-guards/`
- `node --test .../**/*.guard.test.js` 退出码 1；真实 70 条，64 红 / 6 绿 / 0 skip
- A–J 均已写成可运行断言。6 绿是旧语义锁（approve 本就不存在、路径、S/G 目录）
- 证据：`t8-3a-guard-report.md`

### T8.4A

agent：[T8.4A 阅读可见性守卫](39a173de-f9f9-45cc-a5e2-9c864deac2b9)

- 目录 `tests/server/core/phase8-reading-guards/`
- 退出码 1；40 条，12 绿 / 28 红 / 0 skip
- 函数名已锁：`grantClassLocalShelf` / `revokeClassLocalShelf`；`resolveBookAudience` 新形状；`setBookVisibility` 必须不可用
- 12 绿是旧语义锁。证据：`t8-4a-guard-report.md`

### 主控抽查

读两份报告与 `test()` 标题：T8.3A 含三元组/P8-17R/P8-18R/凭据/审批/重置/导航；T8.4A 含默认全闭/D-21/D-23/D-25。不是只卡文件名。未复跑。

## T8.3B / T8.4B 实现开工（2026-08-18）

状态：实现方已回报；独立验证未完成。

### T8.3B（待 T8.3C）

agent：[T8.3B 实现身份领域](d820de0b-b9fc-4af6-8870-13a301aa6a60)

- 自称 T8.3A 守卫 71/71 exit 0；旧 identity 测试 11/11
- 删除 `POST /students`；登录改 schoolCode+loginName；session-only；三元组；凭据/审批/重置；`class.create`；permissions 拆分；保留 `account.manage`（PATCH /users + reading monitoring）
- 旧测试改动已按 09 登记（登录体、跨组织 403→404）
- 证据：`t8-3b-implement-report.md`

### T8.4B（5 条 D-23 负例红）

agent：[T8.4B 实现默认全闭](c76b1bd6-6a33-4a07-8ae5-5ddb43318802)

- 自称 40 条 35 绿 / 5 红。12 条旧语义锁仍绿。未改守卫。
- 主控抽查：`assertLeaseUnavailable` 校验 `RESOURCE_NOT_FOUND` + 统一文案，但**没有 `return true`**。5 条把它直接传给 `assert.rejects`；外组织那条内联 `return true` 所以绿。`catalog.js` 已 `scopedResourceNotFound` 并设 `error.code`。
- 裁决：这是守卫 helper 缺陷，不是放宽契约。派 T8.4A 补丁只加 `return true`，不得改其它断言。T8.4B 不得改守卫。

## T8.3C / T8.4A-fix 开工（2026-08-18）

### T8.3C

状态：`verified`。agent：[T8.3C 独立验证身份](4b999118-b1d2-4649-b83f-4813855758db)

独立复跑守卫 71/71 exit 0、旧 identity 11/11 exit 0。守卫目录无 M。抽查：POST /students 已删、session-only、V、leave_self 残缺 500、token 只存 hash。证据：`t8-3c-verify-report.md`。

主控抽查：`identity/index.js` 无 `'/students'`；`POST /auth/login` 已是 schoolCode+loginName。与 T8.3C 一致。

### T8.3 收口

状态：`verified`。实现报告与独立验证一致。停止条件未命中。

### T8.4A-fix

agent：[T8.4A 补 helper return](e3402e20-527d-4ca8-bde5-c5e7c4ad2e7f)

只在 `assertLeaseUnavailable` 三条 assert 之后加 `return true`。指定文件 11/11 exit 0。未改其它断言、未改实现。

## T8.4C 独立验证（2026-08-18）

状态：`verified`。agent：[T8.4C 独立验证阅读](2bf04a3c-1ee3-4ec5-98ca-0378199e8ba0)

独立复跑 40/40 exit 0。helper 仍检查统一 404 且只多了 return true。旧 25 条 visibility 未改。acquireLease 前置、setBookVisibility 废止、shelf 不调 publish、getPost 隐藏均抽查通过。

主控抽查：`visibility.js` 已无 `BOOK_HAS_GRANTS` / `unrestricted`，`resolveBookAudience` 返回 `bypassClassGrants`。未复跑。

## T8.4 收口（2026-08-18）

状态：`verified`。停止条件未命中。D-22 投影接线与旧 25 条夹具分别属 T8.5 / T8.7。

## T8.5A HTTP 守卫开工（2026-08-18）

状态：守卫已就位，但**命中挂载缺陷，未派 T8.5B**。

agent：[T8.5A HTTP 集成守卫](836833ce-cdd7-4e89-a773-ed81b58ac4c4)

- 27 条，1 绿 / 26 红。证据：`t8-5a-guard-report.md`
- 主控抽查属实：`identity/index.js` L963–967 末尾 catch-all `throw notFound`；`app.js` 先挂 identity 再挂 integration。未匹配的 `/api/v1` 到不了 integration-router。
- 这不是产品改判。09「标准不存在路由 404」指全部 router 之后的应用级 404，不是 identity 吞掉后续路由。
- 打回 T8.3 热修：identity 未匹配走 `next()`；`createIdentityTestApp` 与 `app.js` 在全部 `/api/v1` 路由之后补 JSON 404。T8.3A 守卫必须保持绿。

## T8.3 挂载热修（2026-08-18）

状态：`verified`（挂载缺陷，不是产品改判）。agent：[T8.3 挂载热修 next](31d2558a-a04e-4485-bd53-f7949e504920)

- 删除 identity catch-all；未匹配 `next()` 到 integration
- `createIdentityTestApp` 与 `app.js` 在全部 `/api/v1` 之后补 JSON 404
- T8.3A 71/71 仍绿；临时库 listen(0) `GET /books` 200
- 证据：`t8-3-mount-hotfix-report.md`

## T8.5B HTTP 实现开工（2026-08-18）

状态：实现方自称完成，待 T8.5C。agent：[T8.5B 实现 HTTP 集成](9706e5f6-847e-4e3f-9867-51e668f7469b)

自称 T8.5A 守卫 27/27 exit 0。删除旧 visibility；shelf HTTP；D-21/D-22 投影接线；API client。证据：`t8-5b-implement-report.md`

## T8.5C 独立验证（2026-08-18）

状态：`verified`。agent：[T8.5C 独立验证 HTTP](3aa93dde-36d7-4be9-8111-bc0079b45515)

独立复跑 27/27 exit 0。旧 visibility 路由已删；shelf 不用 listAuthorizedClasses；两处投影接到同一谓词。未碰真库/5191。证据：`t8-5c-verify-report.md`

## T8.5 收口（2026-08-18）

状态：`verified`。停止条件未命中。

## T8.6A / T8.6B 前端开工（2026-08-18）

状态：两边实现已回报，待收口验证。另发现 T8.3 缺三条 §12.2 管理端 GET，并行热修。

### T8.6A

agent：[T8.6A 身份班级前端](f804e292-6613-42da-9705-7debcdc2c1e7)
自称本包 7/7 绿。演示壳已改真调用。证据：`t8-6a-implement-report.md`

### T8.6B

agent：[T8.6B 教师书架前端](2dfd8f65-c17c-4b68-ba55-0d13b65d6857)
自称新建 10/10 绿。旧 `book-publish-visibility` 因产品改判整文件红（未删断言）。证据：`t8-6b-implement-report.md`

### T8.3 缺 GET（主控抽查）

`identity/index.js` 有 approve/reject 与 POST `/registration-credentials`，**没有**：
- `GET /classes/:classId/enrollment-requests`
- `GET /registration-credentials`
- `GET /users/:userId/password-reset-credentials`

T8.6A 已按契约调用，404 会原样展示。属 T8.3 漏做，不是前端假成功。

## T8.6 收口 + T8.3 列表 GET 热修（2026-08-18）

### T8.6 收口

状态：`verified`。agent：[T8.6 前端收口验证](2b9bf3dc-6abf-4cfb-b2d2-e79481705b8f)
亲自跑 6A 7/7、6B 10/10。所有权干净。旧测两红属产品改判。证据：`t8-6-verify-report.md`

### T8.3 列表 GET 热修

状态：`verified`。agent：[T8.3 补三条列表 GET](a4c2bbf0-4138-4400-b803-526656454791)
补齐 enrollment-requests / registration-credentials / password-reset-credentials 三条 GET。本包 3/3；T8.3A 71/71 仍绿。

## T8.6 收口（2026-08-18）

状态：`verified`。停止条件未命中。浏览器真人验收仍属 T8.10，本阶段未做。

## T8.7 独立对抗开工（2026-08-18）

状态：`verified`。agent：[T8.7 独立对抗夹具](7904d728-e1ce-4c3b-9891-7ff6ab497d65)

- 25+HTTP 35/35 exit 0；新攻击 4/4 exit 0
- 未改业务代码。changelog：`t8-7-fixture-changelog.md`
- D-23 旧 200 已改为 404。无全局 grant。

## T8.8 质量门与迁移演练（2026-08-18）

状态：`verified`。Gate 2 **通过**。不进入 T8.9。

### 演练（先过）

agent：[T8.8 Gate 2 演练](4a12d0c3-0e23-4d7b-9c73-4fb2d2b6f3e7)

- 副本 046→050：grants=49、quick_check=ok、学生集合 diff 全空
- 独立端口 HTTP 正反例符合 09（现有学生 49、新班 0、教师 publish 403、D-23 两负例 404）
- 5191 PID 66104 未动；真库未写
- 当时质量门未绿：server 339/428 fail 89；frontend 239/241 fail 2；build 绿

### 夹具对齐（只改旧测试）

报告：`t8-8-fixture-align-report.md`、`t8-8-fixture-changelog.md`

- 对齐 school_code / 登录三字段 / 平台 import·publish / 最大号 050 / 按班按书 grant / frontend 两红
- T8.4A 不变量改为三份 visibility 属 T8.7，未回退「无 grants 可见」或 draft lease 200

### 独立验证（签字）

agent：[T8.8 Gate2 独立验证](0be13b60-75cd-4cb4-bebe-a7c516d2219e)

亲自复跑（实测，非夹具 agent 自报）：
- `npm run test:server` 437/437 fail 0 EXIT 0
- `npm run test:frontend` 264/264 fail 0 EXIT 0
- `npm run build` EXIT 0
- Phase 8 守卫抽跑：26+71+41+28+4+7+10 全绿
- 无删用例 / 无全局 grant / 教师未加回 import·publish
- 演练五份证据仍自洽；5191 仍 PID 66104

主控抽查：verify 输出 `# tests 437` `# fail 0` `EXIT:0`；`grantBookToClass` 单行且必须 bookId+classId。

证据：`t8-8-independent-verify-report.md`、`t8-8-verify-*-output.txt`、`t8-8-gate2-report.md`、`t8-8-drill-summary.json`

changelog 误把登录三字段标成 P8-17R、默认全闭标成 P8-24（应为 P8-11 / 09 §1）。不挡 Gate 2。

## T8.9 正式迁移 / Gate 3（2026-08-18）

状态：`verified`。Gate 3 **技术放行**。回退资格已变。不进入浏览器代操作。

### 预检（只读）

状态：`pass`。agent：[T8.9 只读预检](e90ef836-5e0d-477d-b1a1-da5b7136b3ee)

- 停机前 5191 PID 66104，health `migrations:30`
- 11.1 全过：046、grants=0、49 published、1 班
- 旧体登录 200；学生可见 49 本

### 停机迁移

状态：`pass`。agent：[T8.9 停机正式迁移](b60c7286-680c-461f-8513-3541f157829d)

- 旧 PID 66104 已停；新代码同一 5191，现 PID **10340**，health `migrations:34`
- 正式备份 SHA-256 `44d55384ba2b49c4468fd8d42693a3b97cd9ec67bd3d8cb1c48b38bfb050167b`
- 047–050 首次 applied，重启 alreadyApplied，checksum 与 T8.8 一致
- 检查点 grants=49，现有学生书目 diff 全空
- 旧登录体 400；新体学生 200/49；教师 publish/unpublish 403
- E.1 新班 0 本；E.2 无 grant 租约 404；E.4 本班 shelf 200 / 外班 403
- E.3 draft+grant 未做（无 HTTP 造 draft，未 SQL 补洞）

### 独立观察（签字）

状态：`pass`。agent：[T8.9 Gate3 独立观察](dce172f2-7b6d-4c15-9b27-20ae9e8c0e64)

亲自复打：health 34；学生 49；新班 0；教师 403；无 grant 租约 404。047–050 checksum 与备份哈希一致。E.3 记为缺口、不否决。

主控抽查：`GET /api/v1/health` → `migrations:34`。

**回退资格已变**：真库现有验收二班 `T89验收二班` 与新学生。旧备份仍在 TEMP，agent 不得覆盖真库。

证据：`t8-9-preflight-report.md`、`t8-9-migrate-report.md`、`t8-9-observer-report.md`、`t8-9-observer-http-output.txt`

## T8.10 真人验收 UI 热修（2026-08-18）

状态：用户称暂时没有问题（2026-08-18）。`04` 已追加收口表，未写逐条 L4。agent：[T8.10 五条 UI 热修](3d056cd0-97cc-465a-ae6b-ebb0410ad831)

只改前端。frontend 270/270。五条源码已对上：登录→`/student/register`、父菜单不左移、选班可退、注册码与内部编号分开。未开浏览器。截图里暴露的学生注册码须校长撤销重签。证据：`t8-10-ui-hotfix-report.md`
