# T8.2C 独立验证报告

> 时间：2026-08-18
> Agent：Phase 8 T8.2C 独立验证（未参与 T8.2A / T8.2B；只验证、只报告，不修实现）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）

## 1. 改动文件清单（仅证据）

本 agent **只新建**本目录证据。未改迁移、bootstrap、seed、守卫、`migrate.js`、`09`、`decisions.md`、`execution-ledger.md` 或任何业务文件。

| 路径 | 动作 |
|---|---|
| `docs/product-close-loop/evidence/phase8/t8-2c-verify-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-2c-guard-test-output.txt` | 新建。独立复跑守卫的 UTF-8 TAP |
| `docs/product-close-loop/evidence/phase8/t8-2c-bootstrap-identity-split-output.txt` | 新建。独立复跑 identity-split 的 UTF-8 TAP |
| `docs/product-close-loop/evidence/phase8/t8-2c-smoke-output.txt` | 新建。独立临时库 smoke 输出 |

过程说明（已清理，最终不落地）：为纠正 PowerShell 重定向编码，曾短暂写入同目录 `t8-2c-*-stderr.txt` 三份，确认后立即删除。独立 smoke / 捕获脚本只写在 `%TEMP%`（`t8-2c-independent-smoke.mjs`、`t8-2c-capture-output.mjs`），**没有**提交进 `server/` 或 `tests/`。

未改其它仓库文件。不构成实现越权。

## 2. 实测命令、退出码、用例数、关键输出原文

以下全部由本 agent 亲自运行，不是抄 T8.2B 输出。官方证据是 UTF-8 重落盘的那一次；此前同命令已先跑通一遍（守卫 EXIT=0 / 26 pass；identity-split EXIT=0 / 1 pass；smoke EXIT=0）。

### 2.1 T8.2A 守卫

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
| 时长 | 约 7.2s（UTF-8 证据次） |

关键输出原文：

```
ok 1 - 12. 守卫测试不接触真实业务数据库
ok 2 - 1. 全新库执行 047～050：文件存在、applied 含四 id、表和列存在
ok 3 - 2. 046 副本升级至 050：staged <047_ 先跑，插入 046 形基线，再挂 047～050
ok 4 - 3. 重复启动 alreadyApplied：第二次 applied=[]，alreadyApplied 含 047～050
ok 5 - 4. checksum 稳定：两次 checksum 相等且长度 64
ok 6 - 5. 047 登录/班级字段回填与唯一索引
ok 7 - 6. 048 注册凭据表与唯一/角色约束，无默认 token
ok 8 - 7. 049 审批与重置表 + pending 部分唯一 + 学生单 active 班
ok 9 - 8. 050 grants 回填：基线 49 行、draft 不回填、id/actor 格式与当前版本口径
ok 10 - 9. 当前基线形预期 49 行
ok 11 - 10. 050 不重复插入：第二次 alreadyApplied，checksum 不变，grants 仍 49
ok 12 - 11. 不修改冻结阅读表 reading_summary_sessions / reading_daily_book_summaries
ok 13 - 050 空库（0 published × 0 班）允许插入 0 行
ok 14 - bootstrap：全新库跑完全部迁移后演示数据必须含第二班
ok 15 - bootstrap：必须有 grade workspace（code=grade-admin, scope_type=grade）
ok 16 - bootstrap：必须有 grade_manager 账号与对应 role assignment
ok 17 - 负例：046 副本已有 2 个旧班时 047 必须失败
ok 18 - 负例：046 副本已有 1 条 grant 时 050 必须失败
ok 19 - 负例：046 副本某 published 书没有 version 时 050 必须失败
ok 20 - 负例：046 副本某学生已有 2 条 active class_memberships 时 049 必须失败
ok 21 - 负例：047 之后 INSERT 空 school_code 必须被触发器拒绝
ok 22 - 负例：047 之后 INSERT 非法 stage 必须被触发器拒绝
ok 23 - 负例：047 之后 INSERT 错误 grade_id 必须被触发器拒绝
ok 24 - 负例：049 之后同一学生第二条 pending enrollment 必须失败
ok 25 - 负例：049 之后同一学生第二条 active student membership 必须失败
ok 26 - 负例：050 不得给 draft 书或 disabled 班插 grant
1..26
# tests 26
# pass 26
# fail 0
# skipped 0
# todo 0
# duration_ms 7188.152
T8_2C_EXIT_CODE=0
```

26 条标题与 `t8-2a-guard-report.md` 逐条一致。无 skip / todo。

### 2.2 bootstrap-identity-split

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
| todo | 0 |

关键输出原文：

```
ok 1 - 内部演示初始化升级稳定师生校长身份并保留运营边界
1..1
# tests 1
# pass 1
# fail 0
# skipped 0
# todo 0
# duration_ms 1189.5981
T8_2C_EXIT_CODE=0
```

### 2.3 独立 smoke（mkdtemp 临时库 + `runMigrations`）

脚本只存在于 `%TEMP%\t8-2c-independent-smoke.mjs`，不进仓库。打开路径断言拒绝 `server/data/readmate.sqlite`。`NOW=2026-08-18T09:00:00.000Z`。

命令：

```
node C:\Users\Yak\AppData\Local\Temp\t8-2c-independent-smoke.mjs
```

退出码：`0`。`SMOKE_RESULT=PASS`。`SMOKE_OPENED_REAL_DB=false`。

关键输出原文：

```
=== T8.2C independent smoke ===
REAL_DATABASE_PATH=D:\Project\整书8.15\server\data\readmate.sqlite
SMOKE_SCRIPT_PATH=C:\Users\Yak\AppData\Local\Temp\t8-2c-independent-smoke.mjs
SMOKE1_DB_PATH=C:\Users\Yak\AppData\Local\Temp\t8-2c-fresh-LsvZEL\fresh.sqlite
SMOKE1_APPLIED_COUNT=34
SMOKE1_HAS_047_050=true
SMOKE1_QUICK_CHECK=["ok"]
SMOKE1_GRANTS=0
SMOKE2_DB_PATH=C:\Users\Yak\AppData\Local\Temp\t8-2c-staged-b8Rdjo\staged.sqlite
SMOKE2_PRE_GRANTS=0
SMOKE2_PRE_PUBLISHED=49
SMOKE2_PRE_CLASSES=1
SMOKE2_APPLIED_047_050=["047_login_and_class_identity.sql","048_registration_credentials.sql","049_enrollment_and_password_reset.sql","050_book_access_grant_backfill.sql"]
SMOKE2_GRANTS=49
SMOKE2_QUICK_CHECK=["ok"]
SMOKE3_APPLIED=[]
SMOKE3_ALREADY_APPLIED_047_050=["047_login_and_class_identity.sql","048_registration_credentials.sql","049_enrollment_and_password_reset.sql","050_book_access_grant_backfill.sql"]
SMOKE3_GRANTS=49
SMOKE3_QUICK_CHECK=["ok"]
SMOKE3_CHECKSUMS_UNCHANGED=true
SMOKE_OPENED_REAL_DB=false
SMOKE_RESULT=PASS
T8_2C_EXIT_CODE=0
```

三段数字：

| 段 | 路径 | 关键数字 |
|---|---|---|
| 全新库跑完全部迁移 | `%TEMP%\t8-2c-fresh-*\fresh.sqlite`（不是真库） | applied 34（含 047～050）；`quick_check=ok`；grants=0 |
| staged 046 形升 050 | `%TEMP%\t8-2c-staged-*\staged.sqlite` | 升前 1 组织 / 1 班 / 49 published / 0 grants；升后 applied 含四 id；grants=49；`quick_check=ok` |
| 再 `runMigrations` | 同上 | `applied=[]`；`alreadyApplied` 含 047～050；checksum 不变；grants 仍 49；`quick_check=ok` |

050 二次运行 checksum（64 hex，两次相等）：

| id | checksum |
|---|---|
| `047_login_and_class_identity.sql` | `de7d7fcad2926427b7b8ed75e9a4bc3691de8fa3a88f8452c30ab9cf99285f48` |
| `048_registration_credentials.sql` | `97dcadc912e5c9593b60ccd84ade4987c7208acdd10f75fe42f2b140cf7fccea` |
| `049_enrollment_and_password_reset.sql` | `190cfb10e9fef84991724aeb2fe579c3a77dc6a669a61f637a8b70de7eb5cfff` |
| `050_book_access_grant_backfill.sql` | `bbb1a4bd103495acfc5e1ffed1e74cc960aae2fa3c2b0ad3ee31982af5eef763` |

### 2.4 真库 / 5191 / porcelain

验证前后真库：

| 项 | 验证前 | 验证后 |
|---|---|---|
| `server/data/readmate.sqlite` 存在 | 是 | 是 |
| Length | `107089920` | `107089920` |
| LastWriteTimeUtc | `2026-08-18T04:50:22.0071927Z` | `2026-08-18T04:50:22.0071927Z` |
| WAL LastWriteTimeUtc | （验证前未单独记录到同一精度；验证后） | `2026-08-18T04:50:46.3886170Z`（早于本 agent 开工，验证中未再变） |
| `git status --porcelain -- server/data` | 空 | 空 |

本 agent 未向 5191 发请求、未重启、未开浏览器。

### 2.5 冻结表 rg

命令（只读）：

```
rg -n "reading_summary_sessions|reading_daily_book_summaries|ON CONFLICT" server/db/migrations/047_*.sql 048_*.sql 049_*.sql 050_*.sql
```

命中仅注释，无对冻结表的 `ALTER` / `DROP` / 重建，无 `ON CONFLICT DO NOTHING` 语句：

```
050_book_access_grant_backfill.sql:2:-- 不改表结构，不删既有 grant，不用 ON CONFLICT DO NOTHING。
049_enrollment_and_password_reset.sql:2:-- 不改 reading_summary_sessions / reading_daily_book_summaries。
```

047 的 `ALTER TABLE` 只加 `organizations` / `users` / `classes` 列。049 / 050 的 `DROP TABLE` 只丢临时表 `phase8_*`。

## 3. 实测 vs 推断

### 实测

- 分支 `feat/product-close-loop`，HEAD `b3cd4b532cd4e7e44398bd465112e9ff84a9684e`。
- `migrate.js` 不在 porcelain，`git diff -- server/db/migrate.js` 为空。
- 守卫文件为未跟踪新建（T8.2A 产物）。`test()` 恰好 26 个；无 `skip` / `todo` / `assert.ok(true)`。`grantCount === 49`、双旧班 / 已有 grant / 无 version / 双 membership / 触发器 / bootstrap 三条仍是 `assert.throws` 或硬断言，未见改成不抛。
- 26 条标题与 T8.2A 报告逐字一致，未被删、未改名、未合并。
- 047～050 四个新文件存在且文件名匹配 `migrate.js` 的三位序号正则。
- 本 agent 复跑：守卫 26/26 EXIT=0；identity-split 1/1 EXIT=0；独立 smoke PASS、grants 49、二次 `applied=[]`、checksum 不变、`quick_check=ok`。
- 真库 size/mtime 未变；打开的 smoke 路径均在 `%TEMP%`。
- `seed.js` 与 `bootstrap-internal-demo.js` 均 dirty；`seed.js` 不在 T8.2 预授写入名单。

### 推断（与实测分开）

- 真库 11.1 数字本任务禁止连库，未重核。046 形夹具按守卫手造，不是 `VACUUM INTO`。
- 050 SQL 不把「必须 49 行」写死。这与守卫「空库 0×0 → 0 行」同时成立。§13.2「published/版本/active 班计数不符则停」对**真库窗口**仍是 T8.8 / T8.9 操作门，不是 050 文件内的硬编码。
- 050 当前版本子查询复用了 `created_at DESC, id DESC`，但未加 JS `currentBookVersionSubquery` 里的 `organization_id_at_creation = :organizationId`。单组织夹具测不出差异。按 §13.2 点名的是排序口径，不据此判 fail。
- 050 时间取已写入的 047/048/049 `schema_migrations.applied_at`（同一次 `runMigrations` 的 `now`）。050 自己的行在 `exec` 之后才插入，SQL 内读不到自己的 `applied_at`。与守卫 `created_at === NOW` 一致。
- 047 班级触发器允许 stage/entry_year/class_number **全为 NULL**；一旦任一非空则校验三元组。identity-split 先按旧形插班、再由 bootstrap 补三列，依赖这条缝。守卫测的是非法值，不是 NULL stage。
- 全新库 050 在 catalog/bootstrap 之前跑，grants=0 是预期。bootstrap 之后演示书架是否有 grant 属后续可见性任务，不是 T8.2 完成条件。
- `seed.js` 的 FNV `defaultAccountCode` 只服务非十六进制稳定 id（如 `internal-demo-student`）。注册路径的 `U+userId` 公式未被本任务实现，也不该在 seed 里冒充。
- T8.2B 已写：046 真库回填是 `A+rowid`，若再跑 bootstrap 且 seed 比到默认 `U+…`，可能 `SeedConflictError`。本任务必跑的两条测试不走这条路径。属 T8.9 风险，不是本轮 fail。

## 4. 契约逐项 pass/fail

| 项 | 结果 | 依据 |
|---|---|---|
| 文件所有权：047～050 新文件、bootstrap、T8.2 证据 | **pass** | porcelain 与 T8.2B 清单一致；`migrate.js` 未改 |
| 守卫仍是 T8.2A 契约：26 `test()`、无 skip/todo、关键断言仍在 | **pass** | 源码对照 T8.2A 报告标题 + 本 agent 26/26 |
| 守卫未被删/放宽 | **pass** | 见第 3 节实测；49 行、throws、bootstrap 三条仍在 |
| 047：0 班或仅 `internal-demo-class`；回填值；触发器；不建注册表；不写 grants | **pass** | SQL 有 `CHECK(allowed=1)` 基线；回填 `internal-demo` / username / `A+rowid` / `primary:2023`；无 registration 表、无 grants INSERT；守卫 5 与对应负例绿 |
| 048：两表、约束、无预置 token | **pass** | 只 `CREATE TABLE`；hash/role/scope/`max_uses` CHECK；守卫 6 绿 |
| 049：两表、部分唯一、多 active 学生班失败回滚；不改冻结阅读表 | **pass** | pending 部分唯一 + student active 部分唯一 + 迁移前双班 `CHECK`；无冻结表 DDL；守卫 7 与负例绿 |
| 050：无 `ON CONFLICT DO NOTHING`；grants≠0 或 published 无 version 则失败；笛卡尔积；`created_at DESC, id DESC`；id/actor 格式；draft/disabled/graduated 不回填；时间戳来自迁移 `now` | **pass** | SQL 只读核对 + 守卫 8/9/10/负例 + 独立 smoke grants=49 |
| 050 不得夹带 JS 读取谓词 | **pass** | `050_*.sql` 纯 SQL；不引用 `visibility.js` / `isBookVisibleToAudience` |
| bootstrap：第二班、`grade-admin` workspace、`grade_manager`；未预置 registration token | **pass** | 守卫三条绿；bootstrap 无 `registration_credential`；`seed.js` 实体名单不含凭据表 |
| 独立 smoke：`quick_check=ok`、046 形 grants=49、二次 alreadyApplied / checksum 不变 | **pass** | 第 2.3 节 |
| 冻结表 | **pass** | rg + 守卫 11 |
| 未触碰真库 / 5191 | **pass** | size/mtime 不变；smoke 路径断言；无 HTTP |
| `seed.js` 所有权 | **pass（事后接受为必要插入层）** | 见下款。程序上未预授，内容上必要且未夹带无关逻辑 |

### seed.js 建议（明确）

**建议主控接受为 T8.2 必要插入层，不要因所有权程序问题打回实现。**

改了什么（只读 diff）：

1. `organizations.values` 写入 `school_code`（显式 `schoolCode`，否则 `internal-demo-organization` → `internal-demo`，再否则用组织 id）。
2. `users.values` 写入 `login_name`（`loginName ?? username`）和 `account_code`（显式或 `U+` 十二位；非十六进制 id 走 FNV）。
3. `classes.values` 仅当调用方提供时才写 `stage` / `entry_year` / `class_number`，不发明班级三列。

是否只补 047 必填列：是。没有 grants、没有 registration token、没有读取谓词、没有改 `importIdentitySeed` 的实体名单。

是否必要：是。047 触发器拒绝空/NULL `school_code` / `login_name` / `account_code`。`bootstrap-identity-split.test.js` 在调用 bootstrap **之前**就 `importSeed`，且载荷不带这三列。只改 bootstrap 载荷过不了这条既有测试；改 identity-split 测试本身也不在 T8.2 预授范围，还会把每个 `importSeed` 调用方都变成漏网。插入层补列是最小闭合。

是否夹带无关逻辑：FNV 与「组织 id 当 school_code」是默认值生成，不是业务功能。略宽于「调用方必须显式给列」，但仍服务于 047 触发器，不是越界功能。

不自动原谅的部分：T8.2 预授名单没有 `seed.js`。这是程序越权，必须写进台账。不自动判死的部分：没有这条改动，047 触发器与既有 identity-split / bootstrap 插入路径互斥；内容没有扩大到 T8.3/T8.4。

主控应在 ledger 追认：`server/db/seed.js` 的 047 必填列默认值归 T8.2 插入层，后续 agent 不得再借此改 seed 其它行为。

## 5. 遗留问题

1. `seed.js` 程序越权已接受内容，待主控追认所有权。
2. 047 允许班级新列全 NULL，供 identity-split 旧形插入。新业务写入一旦带三列就必须合法。
3. 050 不在 SQL 内校验「必须 49 published × 1 active 班」。真库计数门留给 T8.8 / T8.9。
4. 未做 046 真库副本、逐学生可见集合 diff、未跑 server 全量（均非 T8.2C 范围）。
5. T8.2B 已登记：已回填 `A+rowid` 的库再跑 bootstrap，可能与 seed 默认 `U+…` 冲突。T8.9 窗口处理。
6. 全新库 + bootstrap 之后，050 不会给新导入的 published 书补 grant。默认全闭后的演示书架是后续任务，不是本包 fail。

## 6. 是否命中停止条件

未命中。

- 守卫未被改弱。
- 真库未被本 agent 打开；5191 未被请求或重启。
- 本 agent 未改实现。
- 未出现 skip / 假成功 / 放宽 49 / 把 throws 改成不抛。

## 7. 未触碰红线声明

- 未改 `reading_summary_sessions` / `reading_daily_book_summaries`。
- 未改 session-summaries schema / 指纹 / 90s TTL / 续租路由。
- 未开浏览器。
- 未查询、未写 `server/data/readmate.sqlite` 及其 WAL；验证前后 size/mtime 相同。
- 未重启 / 替换 / 请求共享 5191。
- 未改 047～050、bootstrap、seed、守卫、`migrate.js`、`09`、`decisions`、`execution-ledger`。
- 未 commit / push / reset / checkout / stash。
- 未进入 T8.9，未启动 Phase 6，无 fallback。

## 8. 原始证据路径

- 守卫输出：`docs/product-close-loop/evidence/phase8/t8-2c-guard-test-output.txt`
- identity-split 输出：`docs/product-close-loop/evidence/phase8/t8-2c-bootstrap-identity-split-output.txt`
- 独立 smoke：`docs/product-close-loop/evidence/phase8/t8-2c-smoke-output.txt`
- 本报告：`docs/product-close-loop/evidence/phase8/t8-2c-verify-report.md`
- 对照：`t8-2a-guard-report.md`、`t8-2b-implement-report.md`
- 守卫源码（只读）：`tests/server/db/phase8-047-050-migration.guard.test.js`

---

- 与 T8.2B 是否一致：一致
- seed.js：接受
- T8.2 实现：通过
- 建议：标 T8.2 verified
