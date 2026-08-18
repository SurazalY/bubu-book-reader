# T8.2B 迁移实现报告

> 时间：2026-08-18
> Agent：Phase 8 T8.2B 迁移实现（只写 047～050 / bootstrap / 为既有插入补齐 seed）
> 分支：`feat/product-close-loop`
> HEAD 前缀：`b3cd4b5`

## 1. 改动文件清单

| 路径 | 动作 |
|---|---|
| `server/db/migrations/047_login_and_class_identity.sql` | 新建。登录/班级字段、回填、唯一索引、INSERT/UPDATE 触发器 |
| `server/db/migrations/048_registration_credentials.sql` | 新建。`registration_credentials` / `registration_credential_uses` |
| `server/db/migrations/049_enrollment_and_password_reset.sql` | 新建。入班申请、密码重置、学生单 active 班部分唯一 |
| `server/db/migrations/050_book_access_grant_backfill.sql` | 新建。只做 §13.2 grants 等价回填 |
| `server/db/bootstrap-internal-demo.js` | 修改。演示种子补第二班、grade workspace、grade_manager |
| `server/db/seed.js` | 修改。`importIdentitySeed` 写入 047 必填列（见第 5 节） |
| `docs/product-close-loop/evidence/phase8/t8-2b-implement-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-2b-guard-test-output.txt` | 新建。守卫原始输出 |
| `docs/product-close-loop/evidence/phase8/t8-2b-bootstrap-identity-split-output.txt` | 新建。既有 bootstrap 测试原始输出 |

未改：T8.2A 守卫源码、既有测试、既有迁移 000～046、`migrate.js`、`server/domains/**`、`server/http/**`、`src/**`、09、`decisions.md`、`execution-ledger.md`、真实库。

取号：开工列目录，最大号仍是 `046_reader_mode_preferences.sql`，047～050 空闲。

## 2. 实测命令、退出码、用例数、关键输出原文

### 2.1 T8.2A 守卫（完成必要条件）

命令：

```
node --test tests/server/db/phase8-047-050-migration.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests | 26 |
| pass | 26 |
| fail | 0 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 时长 | 约 7.8s（首次）/ 约 7.3s（复跑落证据） |

关键输出原文（首次运行摘要）：

```
1..26
# tests 26
# suites 0
# pass 26
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 7803.9292
```

逐条均为 `ok`，包括：全新库四 id、046 升级 49 行、alreadyApplied、checksum 64、047 回填与唯一索引、048 无预置 token、049 部分唯一、050 当前版本口径、空库 0 行、bootstrap 第二班 / grade workspace / grade_manager、以及全部负例。

### 2.2 既有 bootstrap 身份拆分测试

命令：

```
node --test tests/server/db/bootstrap-identity-split.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests | 1 |
| pass | 1 |
| fail | 0 |
| skipped | 0 |

关键输出原文：

```
ok 1 - 内部演示初始化升级稳定师生校长身份并保留运营边界
1..1
# tests 1
# pass 1
# fail 0
```

### 2.3 porcelain（指定路径）

```
git status --porcelain -- server/db/migrations server/db/bootstrap-internal-demo.js tests/server/db
```

实测还包括 `server/db/seed.js`（见第 5 节）：

```
 M server/db/bootstrap-internal-demo.js
 M server/db/seed.js
?? server/db/migrations/047_login_and_class_identity.sql
?? server/db/migrations/048_registration_credentials.sql
?? server/db/migrations/049_enrollment_and_password_reset.sql
?? server/db/migrations/050_book_access_grant_backfill.sql
?? tests/server/db/phase8-047-050-migration.guard.test.js
```

`phase8-047-050-migration.guard.test.js` 为 T8.2A 未入库的新建文件，本 agent **未修改**其内容。本 agent 的实现 diff 不含该守卫。

## 3. 实测 vs 推断

### 实测

- 列目录最大号 046；047～050 按建议文件名新建且匹配 `migrate.js` 文件名正则。
- 守卫 26/26 绿，退出码 0；bootstrap-identity-split 1/1 绿，退出码 0。
- 046 形升级路径实测插入 49 行 grants；空库实测 0 行。
- 050 时间戳读 `schema_migrations.applied_at`（047/048/049 与 050 同一次 `runMigrations` 的 `now`），守卫 `created_at/updated_at === '2026-08-18T09:00:00.000Z'` 通过。
- 当前版本口径实测：`book-0001` 选 `version-0001` 而非更旧的 `version-zzzz-older`；同刻选 `version-zzzz-same-time` 而非 `version-0002`。
- 毕业班：`entry_year=2010` + `NOW=2026-08-18T09:00:00.000Z` → 上海 2026-08-18，academicStartYear=2025，level=16 > 6，无 grant。
- 负例失败后 `schema_migrations` 无对应编号，既有 grant / 双 membership / 未加 `stage` 列均保持。
- 未打开真实库，未连 5191，未跑 server 全量。

### 推断

- 真库 11.1 基线未在本任务重核（禁止查真实库）。046 形夹具按守卫手造，不是 `VACUUM INTO`。
- `seed.js` 给未显式提供的组织/用户补 `school_code` / `login_name` / `account_code`。其它仍走 `importSeed`、但不带班级新列的测试，班级 `stage` 可为 NULL，直到调用方写入完整三元组；047 触发器在三元组一旦出现后强制 `grade_id = stage || ':' || entry_year`。
- 真实 046 库经 047 回填后用户 `account_code` 为 `A+rowid`；若再跑 bootstrap 且 seed 比较到默认 `U+…`，可能 `SeedConflictError`。本任务必跑的两条测试都不走这条路径。正式切换窗口属 T8.9。
- T8.2C 应独立复跑守卫并只读核对 diff，不改本实现。

## 4. 契约逐项 pass/fail

| 项 | 结果 |
|---|---|
| 047 登录/班级字段、回填、唯一索引、触发器；不建注册表、不写 grants | pass（守卫 5 / 空 school_code / 非法 stage / 错误 grade_id / 双旧班负例） |
| 048 两表列集、约束、0 行、users 仍 5 | pass（守卫 6） |
| 049 审批/重置表、pending 部分唯一、学生单 active 班；双 membership 失败回滚 | pass（守卫 7 与对应负例） |
| 050 只回填 grants；49 行；当前版本口径；draft/disabled/graduated 不回填；已有 grant / 无 version 失败且不删行 | pass（守卫 8/9/10 与对应负例） |
| 空库 0×0 → 0 行 | pass |
| bootstrap 第二班 / `code=grade-admin` grade workspace / active `grade_manager` | pass |
| 既有 bootstrap-identity-split 继续绿 | pass |
| 不改 T8.2A 守卫 | pass |
| 不碰真实业务库 | pass |
| 不改 migrate.js / 冻结阅读表 / 000～046 | pass |

## 5. 遗留问题

1. **`server/db/seed.js` 超出最初“只改 bootstrap”清单。** 原因：047 触发器拒绝空/NULL `school_code` / `login_name` / `account_code`，而演示与 identity-split 的实际 INSERT 都走 `importIdentitySeed`，该函数原先不写这三列。只改 bootstrap 载荷不够：identity-split 在调用 bootstrap 之前就会 `importSeed`。这是让守卫 bootstrap 三条与 identity-split 同时绿的最小插入层改动，不是业务逻辑或读取谓词。
2. 班级触发器允许“三个新列都为 NULL”的遗留插入（identity-split 旧班先入库，再由 bootstrap 升级为 `primary:2023`）。一旦写入 stage/entry_year/class_number，必须合法且 `grade_id` 匹配。守卫测的都是显式非法值，不是 NULL stage。
3. 未跑 server 全量。其它仍用旧 `importSeed`（无 school_code）的 HTTP/领域测试，现在会经过 seed 默认值；本任务按简报未跑它们。
4. 未做 046 真库副本演练与逐学生可见集合 diff（T8.8 / T8.9）。

## 6. 是否命中停止条件

未命中。

- 最大号是 046，047～050 原先空闲，现由本任务按序占用。
- 守卫变绿靠实现，未改守卫、未 skip、未 `ON CONFLICT DO NOTHING`、未假成功。
- 050 对时戳未改 `migrate.js`，未写死日期，未用 `datetime('now')`。
- 可观测行为已变：文件存在且 26 条守卫由红转绿。
- 未写真实业务库。

## 7. 未触碰红线声明

- 未改 `reading_summary_sessions` / `reading_daily_book_summaries`。
- 未改 session-summaries schema / 指纹 / 90s TTL / 续租路由。
- 未开浏览器。
- 未查询、未写 `server/data/readmate.sqlite` 及其 WAL。
- 未重启/替换/请求共享 5191。
- 无 fallback / 吞错 / 假成功 / 用 `ON CONFLICT DO NOTHING` 掩盖差异。
- 未改 T8.2A 守卫，未删用例，未放宽断言。
- 未 reset / checkout / stash / clean / restore。
- 未 commit / push。
- 未进入 T8.9，未启动 Phase 6。
- 050 未夹带读取谓词或业务 JS。

## 8. 原始证据路径

- 守卫输出：`docs/product-close-loop/evidence/phase8/t8-2b-guard-test-output.txt`
- bootstrap-identity-split 输出：`docs/product-close-loop/evidence/phase8/t8-2b-bootstrap-identity-split-output.txt`
- 本报告：`docs/product-close-loop/evidence/phase8/t8-2b-implement-report.md`
- 守卫源码（只读，未改）：`tests/server/db/phase8-047-050-migration.guard.test.js`

---

- 守卫：绿（26 pass / 0 fail）
- 停止条件：未命中
- 建议下一步：T8.2C
