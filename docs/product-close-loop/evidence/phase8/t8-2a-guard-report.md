# T8.2A 迁移守卫报告

> 时间：2026-08-18
> Agent：Phase 8 T8.2A 独立守卫（只写测试，不实现迁移 / bootstrap）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）

## 1. 改动文件清单

仅新建/写入允许路径：

| 路径 | 动作 |
|---|---|
| `tests/server/db/phase8-047-050-migration.guard.test.js` | 新建。26 条独立守卫（node:test + node:assert/strict） |
| `docs/product-close-loop/evidence/phase8/t8-2a-guard-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-2a-guard-test-output.txt` | 新建。原始测试输出（UTF-8） |

未改：`server/db/migrations/**`、`server/db/bootstrap-internal-demo.js`、任何既有测试、`09`、`decisions.md`、`execution-ledger.md`、业务代码、真实库。未创建 047～050（含空 stub）。

## 2. 实测命令、退出码、用例数、关键失败

命令：

```
node --test tests/server/db/phase8-047-050-migration.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `1`（整体失败；T8.2A 成功态） |
| tests | 26 |
| pass | 1 |
| fail | 25 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 加载 | 测试文件可加载；失败全部是 `ERR_ASSERTION`，不是 syntax / import / 模块加载失败 |
| 时长 | 约 5.2s |

通过的 1 条是安全不变量，当前即可成立：

- `ok 1 - 12. 守卫测试不接触真实业务数据库`

其余 25 条全部红在同一条契约断言（`findMigrationIdByPrefix` / `requirePhase8MigrationIds`）：

```
必须恰好存在一个 047_* 迁移文件，实际: 无
0 !== 1
```

逐条：

| 结果 | 标题 | 关键 assertion |
|---|---|---|
| pass | 12. 守卫测试不接触真实业务数据库 | 打开的路径不是 `server/data/readmate.sqlite` |
| fail | 1. 全新库执行 047～050：文件存在、applied 含四 id、表和列存在 | `047_*` 不存在，`0 !== 1` |
| fail | 2. 046 副本升级至 050：staged `<047_` 先跑，插入 046 形基线，再挂 047～050 | 同上 |
| fail | 3. 重复启动 alreadyApplied：第二次 applied=[]，alreadyApplied 含 047～050 | 同上 |
| fail | 4. checksum 稳定：两次 checksum 相等且长度 64 | 同上 |
| fail | 5. 047 登录/班级字段回填与唯一索引 | 同上 |
| fail | 6. 048 注册凭据表与唯一/角色约束，无默认 token | 同上 |
| fail | 7. 049 审批与重置表 + pending 部分唯一 + 学生单 active 班 | 同上 |
| fail | 8. 050 grants 回填：基线 49 行、draft 不回填、id/actor 格式与当前版本口径 | 同上 |
| fail | 9. 当前基线形预期 49 行 | 同上 |
| fail | 10. 050 不重复插入：第二次 alreadyApplied，checksum 不变，grants 仍 49 | 同上 |
| fail | 11. 不修改冻结阅读表 reading_summary_sessions / reading_daily_book_summaries | 同上 |
| fail | 050 空库（0 published × 0 班）允许插入 0 行 | 同上 |
| fail | bootstrap：全新库跑完全部迁移后演示数据必须含第二班 | 同上 |
| fail | bootstrap：必须有 grade workspace（code=grade-admin, scope_type=grade） | 同上 |
| fail | bootstrap：必须有 grade_manager 账号与对应 role assignment | 同上 |
| fail | 负例：046 副本已有 2 个旧班时 047 必须失败 | 同上 |
| fail | 负例：046 副本已有 1 条 grant 时 050 必须失败 | 同上 |
| fail | 负例：046 副本某 published 书没有 version 时 050 必须失败 | 同上 |
| fail | 负例：046 副本某学生已有 2 条 active class_memberships 时 049 必须失败 | 同上 |
| fail | 负例：047 之后 INSERT 空 school_code 必须被触发器拒绝 | 同上 |
| fail | 负例：047 之后 INSERT 非法 stage 必须被触发器拒绝 | 同上 |
| fail | 负例：047 之后 INSERT 错误 grade_id 必须被触发器拒绝 | 同上 |
| fail | 负例：049 之后同一学生第二条 pending enrollment 必须失败 | 同上 |
| fail | 负例：049 之后同一学生第二条 active student membership 必须失败 | 同上 |
| fail | 负例：050 不得给 draft 书或 disabled 班插 grant | 同上 |

这是「没有 047 文件」的契约红，不是实现失败，也不是基础设施失败。T8.2B 补上 047～050 后，后续断言（列/回填/49 行/触发器/bootstrap）才会成为下一道红或绿。

## 3. 实测 vs 推断

### 实测

- 分支 `feat/product-close-loop`，HEAD `b3cd4b532cd4e7e44398bd465112e9ff84a9684e`。
- 列 `server/db/migrations/*.sql`：最大号仍是 **046**；047～050 均未被占用。取号按文件名前 3 位，不是文件数量。
- 守卫测试命令退出码 1；26 / 1 pass / 25 fail / 0 skip / 0 todo。
- 25 条失败原文均为 `必须恰好存在一个 047_* 迁移文件，实际: 无` + `0 !== 1`（`ERR_ASSERTION`）。
- 测试文件本身可加载并跑完；失败发生在 `runMigrations` 前的目录断言，或 staged 升级在复制 047～050 之前。
- porcelain：仅本任务允许的新建文件；`server/db/migrations/` 与 `bootstrap-internal-demo.js` 未 dirty。
- 046 升级路径复用了 `reading-monitor-migration.test.js` 的 staged directory：先 copy 文件名 `< '047_'` 的 sql，再 `runMigrations`，再插入 046 形数据。当前在「再 copy 047～050」处按契约红。
- 临时库均为 `mkdtempSync`；路径断言拒绝 `server/data/readmate.sqlite`。

### 推断

- T8.2B 写入合格的 047～050 后，第 1 条「文件存在」会过；若迁移/bootstrap 未按 09 §11 / §13.2 做完，红会落到列、回填值、49 行 grants、触发器或第二班 / grade workspace / grade_manager。
- 空库 0 行与基线 49 行已拆成两条用例；实现时不要合成一条。
- 负例「学生双 active 班」按 047 先于 049 的顺序编写：先只跑 047+048，再插入第二班与第二条 membership，再挂 049。这避免 047 因「已有两个旧班」先停而测不到 049。
- 负例「disabled/graduated 班不回填」同样拆成 047～049 之后、050 之前插入 047 形班级，以免 047 因第二班停止。
- 未重核 11.1 真库数字（禁止连真实库）。基线形 046 数据按 09 §11.1 / 任务说明书最小集合手造，不是 `VACUUM INTO`。

## 4. 契约逐项（守卫是否已写 / 运行结果）

红 = 守卫已就位并运行红，**不是** T8.2 实现失败。

| 覆盖点 | 守卫 | 本次运行 |
|---|---|---|
| 1. 全新库执行 047～050（文件、applied 四 id、表和列） | 已写 | 运行红 |
| 2. 046 副本升级至 050（staged `<047_` → 插入基线 → 挂 047～050） | 已写 | 运行红 |
| 3. 重复启动 alreadyApplied | 已写 | 运行红 |
| 4. checksum 稳定（两次相等、长度 64） | 已写 | 运行红 |
| 5. 047 登录/班级字段与约束（回填 + 唯一索引 + 空 login_name/account_code 触发器） | 已写 | 运行红 |
| 6. 048 注册凭据表与唯一/角色约束，无默认 token | 已写 | 运行红 |
| 7. 049 审批与重置表 + pending 部分唯一 + 学生单 active 班 | 已写 | 运行红 |
| 8. 050 grants 回填（49 行、draft 不回填、id/actor、created_at DESC / id DESC） | 已写 | 运行红 |
| 9. 当前基线形预期 49 行 | 已写 | 运行红 |
| 10. 不重复插入 | 已写 | 运行红 |
| 11. 不修改冻结阅读表 | 已写 | 运行红 |
| 12. 不接触真实数据库 | 已写 | 运行绿（安全不变量） |
| 负例：2 个旧班 → 047 失败 | 已写 | 运行红 |
| 负例：已有 1 条 grant → 050 失败 | 已写 | 运行红 |
| 负例：published 无 version → 050 失败 | 已写 | 运行红 |
| 负例：学生 2 条 active membership → 049 失败 | 已写 | 运行红 |
| 负例：INSERT 空 school_code / NULL school_code | 已写 | 运行红 |
| 负例：INSERT 非法 stage / 非法 entry_year / 非法 class_number | 已写 | 运行红 |
| 负例：INSERT/UPDATE 错误 grade_id | 已写 | 运行红 |
| 负例：第二条 pending enrollment | 已写 | 运行红 |
| 负例：第二条 active student membership | 已写 | 运行红 |
| 负例：draft/archived 书或 disabled/graduated 班不得插 grant | 已写 | 运行红 |
| 空库 0 published × 0 班 → 0 行（与 49 行分列） | 已写 | 运行红 |
| bootstrap 第二班 / grade workspace / grade_manager | 已写（调用现有 bootstrap，未改它） | 运行红 |

046 形最小集合已写入升级/49 行用例：1 组织 `internal-demo-organization`、1 个 active 班 `internal-demo-class`、5 个用户（username 原值）、49 published + 当前版本锁（book-0001 旧版本、book-0002 同刻 id DESC）、0 grants。另有独立负例夹具。

## 5. 遗留问题

- T8.2A 只负责红守卫。T8.2B 必须实现 047～050 与 bootstrap，且不得改本守卫文件。
- 048 `secret_hash` 守卫要求 SHA-256 十六进制（无效串应被拒绝）；`max_uses=0` 应被拒绝。若实现只做 UNIQUE、不做格式/正整数 CHECK，这些用例会继续红。
- 049 双班负例依赖 047 先成功；047 的「仅 internal-demo-class 一个既有班」停止条件仍由独立负例锁住。
- 未跑 server 全量，未开浏览器，未连 5191。

## 6. 是否命中停止条件

未命中。

1. 分支是 `feat/product-close-loop`；允许范围外无本 agent 造成的脏文件。
2. 迁移最大号仍是 046，047～050 空闲。
3. 断言全部可在 mkdtemp 临时库上写，无需连真实库。
4. 未使用 skip / 弱断言 / 假成功；唯一绿项是「不碰真库」。
5. 未创建迁移文件，未改 bootstrap。
6. 未触碰冻结阅读表/计时契约。

未出现「全部变绿」——那才是守卫过弱的停止条件。

## 7. 未触碰红线声明

- 未改 `reading_summary_sessions` / `reading_daily_book_summaries`。
- 未改 `POST /reading/session-summaries` schema、指纹、90s TTL、续租路由。
- 未开浏览器。
- 未查询、未写 `server/data/readmate.sqlite` 及其 WAL。
- 未重启/替换/请求共享 5191。
- 无 fallback / 吞错 / 假成功 / skip。
- 未为了绿而删断言、放宽断言、全局 grant、ON CONFLICT 掩盖。
- 未 reset / checkout / stash / clean / restore。
- 未 commit / push。
- 未进入 T8.9，未启动 Phase 6。
- 未创建 047～050 迁移文件。

## 8. 原始证据

- 测试输出：`docs/product-close-loop/evidence/phase8/t8-2a-guard-test-output.txt`
- 守卫源码：`tests/server/db/phase8-047-050-migration.guard.test.js`
- 本报告：`docs/product-close-loop/evidence/phase8/t8-2a-guard-report.md`

---

- 守卫文件：`tests/server/db/phase8-047-050-migration.guard.test.js`
- 运行结果：红
- 建议下一步：T8.2B
