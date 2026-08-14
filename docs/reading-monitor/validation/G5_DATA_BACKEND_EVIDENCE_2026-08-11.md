# G5 数据、迁移、权限与保留独立验收证据

> 执行日期：2026-08-11（Asia/Shanghai）
> 执行角色：V-D（只验收，不修生产代码或测试）
> 范围：G5-02、G5-03、G5-06
> 候选分支：`codex/reading-monitor-clean-baseline`
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`
> 结论：**PASS**

## 1. 总结

| 项目 | 结论 | 核心结果 |
| --- | --- | --- |
| G5-02 50 人数据集 | PASS | 50 人中 37 人达到 `300s`、13 人未达，未达含 `0s` 和 `299s`；4 人跳读、8 人回读；七日恰 7 点并补零；新统计不读取旧事件/旧 progress 时长。 |
| G5-03 三条迁移路径 | PASS | 全新库顺序应用 27 个迁移到 043；干净 042 库只前向应用 043 且旧数据原样保留；重复 migrate 为 0 新应用；约束、索引、触发器、外键和迁移完整性失败均符合冻结合同。 |
| G5-06 权限、删除、转班、保留 | PASS | student 403、同组织未授权 403、跨组织 404；未知 body/query 不泄露值或保护数据；header/body requestId 一致；删除事务、转班快照/当前分母、六个月 cleanup、非法 now、合法晚到与超截止拒绝均通过。 |

未发现 P0、P1 或 P2 产品缺陷。所有数据库均在 `/tmp/readmate-g5-vd.0OhPnl`，没有读取或写入正式数据库，没有修改生产代码或测试，没有执行浏览器、Git 写操作、commit、push、reset 或 clean。

## 2. 必读输入与候选边界

执行前完整读取：

- `docs/reading-monitor/IMPLEMENTATION_CONTROL.md`
- `docs/reading-monitor/G1_FROZEN_CONTRACT.md`
- 需求包 `README_先看.md`、`01`～`06`
- AV0、AV1、AVUI 的计划、首轮证据和最小重验证据

最终取证时关键文件 SHA-256：

```text
1c5a17c77cf510c5fadb5bedfeda019ff88b28256fdba4c9e7f8fbf5ce57e255  IMPLEMENTATION_CONTROL.md
6772dffcdb07efe7b9db69f1f90d5ce840129440a581d72aa54f03f24c49eace  G1_FROZEN_CONTRACT.md
136ccf7212858bf3592e214da5f190673791710a4f28beb625dfe3e23c7cbb91  043_reading_session_summaries.sql
a7548905ea5ed7103e244676a7578797fe2b85f5e9906f84ac0583716201d8b1  monitoring.js
7b0780a3e807038e02d32809d849fe032d711631f2e1b7ddb0dbe363abc24a4b  statistics.js
561c63a8824170b700b8e8458ebbb725dd6b2df35a7b15993e07f83522a9f39f  integration-router.js
121023d5dc42d8b53be14984bc2aae6b9ec7c77d0f493d82d561a51cdd3278d5  reading-monitor-cleanup.js
59348f7ed9a5084fb1a5b5bdff546e4657ee92f0483f89433c41b7071422b5d7  reading-monitor-migration.test.js
c4e2d01ea65bf04ba4661f20e6b09a5ff2d73ccceb2256c5f5fb5d4a45946845  reading-monitoring.test.js
ad4e0e7e3326de37d761837029082fc1f0c06c7ae44d530862030cb1610dca11  statistics.test.js
ce875cc43595c6a914818cc0c92d94cc3789331fb0ab4ac871a5c5e4bf6655e0  reading-monitor-http.test.js
297f0e3a0990f238a29b45e6d00de47cd22d1626b9fb2e1b3ee32fe91227232d  reading-monitor-cleanup-command.test.js
```

工作树是多人共享的未提交候选，上述哈希而非 HEAD 单独标识本次被验内容。V-D 只新增本文件；其他已有修改均视为候选输入并保持不动。

## 3. G5-02：50 人数据集与 SQL 验算

临时库：`/tmp/readmate-g5-vd.0OhPnl/g5-50.sqlite`

### 3.1 独立构造

- 当前活跃花名册 50 人。
- `student-01`～`student-37` 各为 `300000ms`。
- `student-38=299000ms`，`student-39=0ms`，`student-40`～`student-50=1000..11000ms`。
- 今日 `had_skip=1` 精确 4 人，`had_reread=1` 精确 8 人。
- 七日为 `2026-08-04`～`2026-08-10`；首日没有事实，后六日达标人数为 `5/10/15/20/25/37`。
- 49 个有时长学生各有一条 closed session 和今日 daily；50 人都有位置记录。
- 另向旧 `reading_events` 注入 50 行、合计 `38850s valid_reading_seconds`，向遗留 `reading_progress` 注入合计 `180000s valid_reading_seconds`，用于证明它们不会污染新真值。

### 3.2 原始 SQL 与生产统计交叉结果

```text
active=50
checked=37
unchecked=13
zero_count=1
exactly_299=1
skip_count=4
reread_count=8
today_total_ms=11,465,000
per_capita_ms=229,300
trend_checked=[0,5,10,15,20,25,37]
sessions=49
today_daily=49
positions=50
session/daily mismatches=0
session/position matches=49
```

生产 `createReadingStatisticsDomain().getScopedSummary()` 独立返回：

```text
activeStudentCount=50
checkedInStudentCount=37
checkInRateBasisPoints=7400
totalEffectiveReadingSeconds=11465
perCapitaEffectiveReadingSeconds=229
skipStudentCount=4
rereadStudentCount=8
students.length=50
all recentDays.length=7
trend checked=[0,5,10,15,20,25,37]
student-39 today=0s
student-38 today=299s
```

旧链路的 `38850s` 和 `180000s` 均没有进入返回的 `11465s`；新统计只取 daily 真值。

### 3.3 北京时间 04:00 与日历月

生产函数独立断言：

```text
2026-08-09T19:59:59.999Z -> statDate 2026-08-09
2026-08-09T20:00:00.000Z -> statDate 2026-08-10
statDate 2026-08-10 start -> 2026-08-09T20:00:00.000Z
2026-08-31 六个月前月末收敛 -> 2026-02-28
2024-08-31 六个月前闰年月末收敛 -> 2024-02-29
```

## 4. G5-03：迁移三路径

正式成功证据库：

- 全新库：`/tmp/readmate-g5-vd.0OhPnl/migration-fresh-v2.sqlite`
- 042 前向库：`/tmp/readmate-g5-vd.0OhPnl/migration-forward-v2.sqlite`
- 只含临时副本的迁移目录：`/tmp/readmate-g5-vd.0OhPnl/migration-staged-v2`

### 4.1 全新库

```text
firstApplied=27
last=043_reading_session_summaries.sql
ledger=27 rows / 27 distinct checksums
second startup applied=0 / alreadyApplied=27
new tables=2
explicit indexes=10
triggers=10
```

两张新表各有 5 个逻辑外键；SQLite `PRAGMA foreign_key_list` 对 4 个双列组合外键逐列展开，加组织单列外键，因此各返回 9 行。

8 个真实 SQL 反例全部拒绝：跨组织组合外键、第二个 open session、越界页码、session 累计倒退、session 范围改写、revision 指纹历史不连续、daily 累计倒退、daily 唯一键重复。反例执行后仍只有 1 个合法 session 和 1 个合法 daily，没有失败污染。

### 4.2 干净 042 前向到 043

```text
through042=26 migrations
highest=042_ai_conversation_management.sql
forward applied=[043_reading_session_summaries.sql]
repeat applied=0 / alreadyApplied=27
```

043 前后旧数据精确相同：

```text
reading_progress.last_page_no=4
reading_progress.valid_reading_seconds=99
reading_events.valid_reading_seconds=99
reading_events.valid_eye_seconds=88
```

### 4.3 完整性失败不污染

只在 `/tmp` 的 043 副本尾部加入注释改变 checksum，再对已迁移临时库运行：

```text
MigrationIntegrityError: 已执行迁移被修改: 043_reading_session_summaries.sql
ledger before=27 / after=27
legacy progress page=4 / seconds=99 / version=7（不变）
```

没有对正式迁移文件或正式数据库做失败注入。

## 5. G5-06：HTTP 权限、隐私与 requestId

临时真实 HTTP 数据库：`/tmp/readmate-g5-vd.0OhPnl/g5-http.sqlite`。应用实际监听随机回环端口 `61844`，使用真实 `fetch` 请求，结束后端口已关闭。

10 个真实 HTTP 请求的 header `X-Request-Id` 与成功 `meta.requestId` 或失败 `error.requestId` 全部非空且逐请求相等。关键结果：

| 用例 | HTTP | code | 是否含 data |
| --- | ---: | --- | --- |
| student `/self` | 200 | — | 是 |
| 合法 teacher `/scope` | 200 | — | 是 |
| student 请求 `/scope` | 403 | `PERMISSION_DENIED` | 否 |
| 同组织但 workspace 未授权班级 | 403 | `PERMISSION_DENIED` | 否 |
| 请求跨组织 class | 404 | `RESOURCE_NOT_FOUND` | 否 |
| scope 未知 query `studentId=<secret>` | 422 | `VALIDATION_FAILED` | 否 |
| renew 未知 body `untrustedActorId=<secret>` | 422 | `VALIDATION_FAILED` | 否 |

未知 query/body 的响应只列字段名，均不回显秘密值；跨组织响应不包含 class ID 或班级名，同组织 403 也不包含未授权班级名。

## 6. G5-06：账号 reading-domain 删除与转班

临时库：`/tmp/readmate-g5-vd.0OhPnl/g5-delete-transfer.sqlite`

### 6.1 删除 primitive

目标学生删除前：session=2、daily=2、progress=2。在 daily 删除前安装只针对目标的失败触发器后调用生产 primitive，事务抛错且三类数据仍为 `2/2/2`，证明不会半删。移除临时触发器后：

```text
delete result={sessions:2,dailySummaries:2,progress:2}
target reading rows=0/0/0
target account row=1（primitive 只删 reading-domain）
same-org keeper rows=1/1/1（保留）
cross-org foreign rows=1/1/1（保留）
使用错误 organizationId 删除 target -> RESOURCE_NOT_FOUND
```

### 6.2 转班快照与当前花名册分母

```text
mover-old-s.class_id_at_creation=transfer-old
mover-new-s.class_id_at_creation=transfer-new
```

转班后旧班当前只有 `del-remain` 1 名学生，但历史 numerator 仍包含转出的 mover：

```text
old class active=1 / checked=2 / rateBp=20000
old class students=[del-remain]
new class active=1 / checked=1 / rateBp=10000
new class students=[del-mover]
```

这符合冻结口径：历史事实按发生时 class 快照，当前 roster 作分母；因此历史比率允许超过 100%，不得钳制。

## 7. G5-06：六个月 cleanup 生产命令

临时库：`/tmp/readmate-g5-vd.0OhPnl/g5-cleanup.sqlite`

构造：cutoff 前 closed、一条恰好等于 cutoff 的 closed、一条具有权威 `lease_ended` history 的过期 open、一条没有合法 history 的异常 open。

首次真实生产命令：

```bash
npm run maintenance:reading-monitor-cleanup -- \
  --database /tmp/readmate-g5-vd.0OhPnl/g5-cleanup.sqlite \
  --now 2026-08-10T00:00:00.000Z
```

```json
{"cutoff":"2026-02-10T00:00:00.000Z","closedCount":1,"deletedCount":2,"anomalousOpenSessionIds":["anomalous-open"]}
```

第二次同命令：

```json
{"cutoff":"2026-02-10T00:00:00.000Z","closedCount":0,"deletedCount":0,"anomalousOpenSessionIds":["anomalous-open"]}
```

最终只剩：

```text
anomalous-open | open   | no ended_at
equal-cutoff   | closed | 2026-02-10T00:00:00.000Z
ended_at < cutoff rows=0
ended_at = cutoff rows=1
```

因此过期且 history 合法的 open 先关闭再删除；早于 cutoff 删除；等于 cutoff 保留；异常 open 不猜测处理而持续报告；二次运行幂等。

非法 now：

```text
reading monitor cleanup failed: cleanup now 必须是有效时间
exit=1
```

## 8. focused tests 与晚到 revision

命令：

```bash
node --test \
  tests/server/db/reading-monitor-migration.test.js \
  tests/server/reading/reading-monitoring.test.js \
  tests/server/reading/statistics.test.js \
  tests/server/http/reading-monitor-http.test.js \
  tests/server/reading/reading-monitor-cleanup-command.test.js
```

结果：`27/27 PASS`，`0 fail / 0 skip / 0 todo`。

与本验收最直接的命名覆盖包括：

- `旧租约首次晚到直接 closed，且允许截止前连续晚到 revision`：合法 revision 1/2 accepted，越过权威 history cutoff 的 revision 3 返回 `LEASE_CONFLICT`；
- `摘要严格拒绝...`：超过六个日历月接受窗口返回 `VALIDATION_FAILED`；
- `班级在会话创建时快照...`、`/scope 空班级...转班历史 numerator...当前名单`；
- `reading-domain 删除按组织隔离...cleanup...幂等`；
- 数据库三路径、权限/跨组织/未知字段、旧事件不写新统计、事务回滚。

## 9. 命令数与 SQL 数

正式判定命令共 **13** 条：50 人 SQL/领域审计、三路径迁移、真实 HTTP、删除/转班、cleanup seed、cleanup 首次、cleanup 二次、cleanup 非法 now、cleanup 最终 SQL、27 项 focused tests、时间边界、端口回收、候选 hash/status。文档和源码只读探索命令不计入该数。

V-D 直接发出的 SQL 共 **547** 条：

| 范围 | seed/write | audit/read | 预期失败 SQL/操作 | 小计 |
| --- | ---: | ---: | ---: | ---: |
| G5-02 50 人 | 432 | 8 | 0 | 440 |
| G5-03 迁移约束 | 10 | 12 | 8 | 30 |
| G5-06 删除/转班 | 55 | 4 | 2 | 61 |
| G5-06 cleanup | 13 | 3 | 0 | 16 |
| 合计 | 510 | 27 | 10 | 547 |

计数不包含 migration SQL 文件内部语句、生产 domain/HTTP 内部 SQL、focused tests 内部 SQL；这些通过迁移结果、HTTP、表快照和测试结果另行验证。真实 HTTP 请求数为 10。

## 10. 验收 harness 噪音与进程回收

4 次非产品 harness 修正均发生在正式结论前，保留说明：中文工作区 URL 初次未 `fileURLToPath` 解码；`node:sqlite` 行对象为 null prototype 导致一次 `deepStrictEqual` 包装错误；复合外键最初误按 5 行而非 9 行计数；系统 `sqlite3 -readonly` 未能打开无 sidecar 的库，改用 `mode=ro&immutable=1` 后同一查询成功。它们没有揭示产品失败，正式用例均在修正后完整重跑。

V-D 自建的随机端口 `61844` 已关闭。检查时 5190/5191 由并行 V-BR 验收进程持有，不是 V-D 启动；V-D 已通知主控并未终止未知共享进程。V-D 没有遗留自己启动的服务或子进程。

## 11. 最终结论

```text
G5-02 = PASS
G5-03 = PASS
G5-06 = PASS
P0/P1/P2 = 0/0/0
V-D = PASS
```

本结论只覆盖 V-D 被分配的三个门禁，不替代 G5-04/G5-05 浏览器验收、G5-07/G5-08 回归扫描或最终 AV-2 汇总。
