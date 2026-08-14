# G5-10 / AV-2 唯一最终正式验收证据（2026-08-11）

## 1. 最终结论

**PASS**

- G5-01～G5-12 逐项通过；没有 `blocked` 项。
- 当前 open P0 = `0`，open P1 = `0`；仅保留 3 类不阻塞 P2/已接受风险，见第 11 节。
- G2-14、G2-17 可从 `implemented_unverified` 转为 `completed`。
- G4-01～G4-14 可整体从 `implemented_unverified` 转为 `completed`。
- 允许交付，允许主控将 G5 和项目标记为 `completed`。
- 建议在主控复核授权范围后形成一次有意识的候选提交；本 V 未执行 commit、push、add 或任何 Git 写操作。

本轮只验不修，未修改生产代码、测试、控制文档或需求包；唯一仓库写入为本证据文件。

## 2. 候选身份和环境

```text
工作区  /Users/yak/Project/整书8.10
分支      codex/reading-monitor-clean-baseline
HEAD      d4ce07b44ee4daf48d2173d51e7329008e78abbe
Node      v24.16.0
npm       11.13.0
形态      多 Agent 共享的未提交工作树；不用 HEAD 单独标识候选
```

最终候选清单由所有已跟踪 diff 及非 `docs/reading-monitor/**` 的新代码/测试组成：

```text
92 files
manifest SHA-256 = 6392d3e0d89adb1cd493c6b1deaeec3d409fd6236abb13bbaef1d986e4df34c8
manifest runtime path = /tmp/readmate-av2-candidate-manifest.sha256
```

关键生产文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `server/db/migrations/043_reading_session_summaries.sql` | `136ccf7212858bf3592e214da5f190673791710a4f28beb625dfe3e23c7cbb91` |
| `server/domains/reading/monitoring.js` | `a7548905ea5ed7103e244676a7578797fe2b85f5e9906f84ac0583716201d8b1` |
| `server/domains/reading/catalog.js` | `d5196346660298154eb792469fc5d16d1757842cf87921c6750586380795c4bc` |
| `server/domains/reading/statistics.js` | `7b0780a3e807038e02d32809d849fe032d711631f2e1b7ddb0dbe363abc24a4b` |
| `server/http/integration-router.js` | `561c63a8824170b700b8e8458ebbb725dd6b2df35a7b15993e07f83522a9f39f` |
| `server/integration/projections.js` | `4ed832f2d0ff1eb6ad7f5103eb25c1913c1c1da28432a227b3c75280de8b8b21` |
| `server/integration/ai-runtime.js` | `d801e71b6b6c2db5a9b8f45caa8267c788fa3117829cda9e1283836a9e612c86` |
| `server/domains/reports/index.js` | `60133ddf7cb4d5be28f5c08958391c6f00eb4141c5e3adfe2cf3c8a1cfa3d44e` |
| `server/http/public-summary-page.js` | `d0e17cd25676bcdd87697db2c76cf6d8bdd520e7b8a605f544c2aefad7d5d230` |
| `server/domains/reading/library-objects.js` | `8b97e5520a77f12d17bbd4528da08977cd57963ab8f8004de4f8f0c745ee7d71` |
| `server/scripts/reading-monitor-cleanup.js` | `121023d5dc42d8b53be14984bc2aae6b9ec7c77d0f493d82d561a51cdd3278d5` |
| `src/student/pages/Reader.jsx` | `14e0fb5310c14f18c0b6e4affba097829964c60cf218e924b7be04f0b21fca4b` |
| `src/student/state/useReadingTelemetry.js` | `52f33f93416a8b591fc4b8a66b7140e034785ff2d78f32809043e38c6659379c` |
| `src/student/reading-monitor/leaseController.js` | `9819c7448477cef0c341176ef5ffd86da7661cd63b7f0a116d74af56ee81235d` |
| `src/student/reading-monitor/coordinator.js` | `b0a3f15fc5f9131ce51638166bb30d00734d57a8034799cb6267bf5649f37d5d` |
| `src/student/reading-monitor/pendingStore.js` | `061c05ddcb7112585aae36b116ce939d3eb0f4e2bf83f5f75409c590cb3715a1` |
| `src/student/reading-monitor/pendingQueue.js` | `092508610c4624eba1649a2fe1846503d3a873e037d2cb02a9426cedcaaf79e8` |
| `src/console/components/reading-monitor/ReadingStatisticsView.jsx` | `b17d905870ce639701fafee191d5fc8085cc53ee59f6b3864fe1ce55cf24d522` |
| `src/student/components/reading-monitor/DailyReadingBrief.jsx` | `506182d03b4bf7cbeffdc89751e9bd52bb69ae2803e801383f9858c8d464fa0e` |
| `src/student/components/BottomNav.jsx` | `99cc757739d50f7d80572e7ba5c93b92cd29deb90e31e0fa474db7b597dcb386` |

## 3. 权威输入与证据链

已重读当前 `IMPLEMENTATION_CONTROL.md`、`G1_FROZEN_CONTRACT.md`、需求包 `README_先看.md` 及 01～06，并审查全部 validation evidence、当前最终 diff、新增候选文件和关键测试。

当前控制输入：

```text
a4c3bd7faf9f96e53b113fea502d65a2c27244ddd824278863e4d74c2c408308  IMPLEMENTATION_CONTROL.md
6772dffcdb07efe7b9db69f1f90d5ce840129440a581d72aa54f03f24c49eace  G1_FROZEN_CONTRACT.md
```

G5 及关键关门证据 SHA-256：

| 证据 | SHA-256 |
| --- | --- |
| `G5_DATA_BACKEND_EVIDENCE_2026-08-11.md` | `3ff19162bb988fb2a17f15476e65cc6ebddb1b841543e98dba9f99f211b2b670` |
| `G5_BROWSER_EVIDENCE_2026-08-11.md` | `461e494e42f74d0976729d8d32eac985c19964a633ecefb01447a024220cfab6` |
| `G5_REGRESSION_REVIEW_EVIDENCE_2026-08-11.md` | `6a09a6a06f58d920df6fcefcf915d0df9769c3dc519e905b4dffbf9f3852b4cf` |
| `G5_REGRESSION_MINIMAL_RETEST_EVIDENCE_2026-08-11.md` | `8cdf8da95b54c6b0996b785da5657bda905ec0c28b85e19f1744f45b14661c47` |
| `G5_REGRESSION_S1_FINAL_RETEST_EVIDENCE_2026-08-11.md` | `1a7871d6770f8f976dc5eb42fa0e500cd09753f0d0359bf27b1c2ac8895e3f9d` |
| `G5_REGRESSION_S1_ARRAY_RETEST_EVIDENCE_2026-08-11.md` | `adcfce507fda7da5d5d94e8f0199a448c780a05c85fc442e6887060fc3a0f475` |
| `AV1_MINIMAL_RETEST_EVIDENCE_2026-08-10.md` | `e1f7c2775895563de1cab7888f035ccb9736f87e90cff37db68e1d7103553f35` |
| `AVUI_MINIMAL_RETEST_EVIDENCE_2026-08-11.md` | `5855d341e8faa800443270778c000f54eee9e7c5c0845a6c9c063f1d8e5cc99e` |

V-BR 最终图片目录 14 张 PNG 的单文件 SHA 均与 `G5_BROWSER_EVIDENCE` 第 5 节一致；`useReadingTelemetry.js` 和 `coordinator.js` 也分别保持该终稿的 `52f33f93...` 与 `b0a3f15f...`。因此 page_turn 修复后的浏览器证据与当前候选对应，本窗口没有重跑整套 Chrome。

## 4. AV-2 稳定候选正式命令

| 命令 | 结果 | 日志 SHA-256 |
| --- | --- | --- |
| `npm run test:frontend` | **158/158 PASS**；0 fail/cancelled/skipped/todo | `9021d67b6f783776f3c4c52b776e7813f423668d92f4f7105395d9178923fdd2` |
| `npm run test:server` | **167/167 PASS**；0 fail/cancelled/skipped/todo | `48a6660b56c9d21864c01f06da2100239ed71bb9c1e56d1004350894538f730d` |
| `npm run build` | **PASS**；1737 modules | `12f3b02c2bfcad75ff44172b447c67decec78ae2dd3260e09bd2fb39986cf6a2` |
| `node tests/frontend/runtime-import-scan.mjs` | **PASS**；两个生产图 `forbiddenImports=[]` / `storageReferences=[]`；仅允许 pendingStore IndexedDB | `23a231eb24d4b59e5da794faa5e830ddba33d0a1597553e1c6fc408620ef9aa6` |
| `git diff --check` | **PASS**，空输出 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

build 唯一告警是已知 `vendor-icons-DwfL3uyf.js` `776.44 kB` / gzip `135.05 kB` 超过 500 kB；无编译错误。

## 5. 聚焦反例命令

### 5.1 服务端 68/68

```bash
node --test \
  tests/server/db/reading-monitor-migration.test.js \
  tests/server/reading/reading-monitoring.test.js \
  tests/server/reading/statistics.test.js \
  tests/server/http/reading-monitor-http.test.js \
  tests/server/reading/reading-teaching-bridge.test.js \
  tests/server/reading/reading-monitor-cleanup-command.test.js \
  tests/server/reading/student-library-objects.test.js \
  tests/server/community-reports/community-reports.test.js \
  tests/server/http/public-summary-page.test.js \
  tests/server/http/integration-runtime.test.js
```

结果：`68/68 PASS`，0 fail/skip/todo；日志 SHA-256 `89a1b70ac95e261f5bd68b86bb3e9be5371cb07aec911bfc2688b94af198d304`。

覆盖 043 迁移、accepted/replayed/superseded、单事务、lease 晚到截止、时间/乱序位置、权限/删除/转班、old event 仅护眼、self/scope、library 无旧 footprints、cleanup 命令、内部 reports 嵌套净化及 public object/顶层 array JSON+HTML 净化。

### 5.2 前端 69/69

```bash
node --test \
  tests/frontend/reading-telemetry-sequence.test.mjs \
  tests/frontend/reading-monitor-api-contract.test.mjs \
  tests/frontend/reading-monitor-client-*.test.mjs \
  tests/frontend/reading-monitor-completion-semantics.test.mjs \
  tests/frontend/reading-statistics-adapter.test.mjs \
  tests/frontend/student-reading-library.test.mjs \
  tests/frontend/reading-monitor-ui-*.test.mjs
```

结果：`69/69 PASS`，0 fail/skip/todo；日志 SHA-256 `d4a64d49184f1d25d39910d89a2416e63d383d33607ab2a51f8e2eb6b2fc9187`。

覆盖 Reader pageNo、移动 source、旧 page_turn 严格 payload、lease timer 迟到、511→512 和 2 MiB 即时停表、IndexedDB 原子顺序、完成度清理、严格 DTO、旧 footprint 忽略及 AV-UI 边界。

## 6. G5-11 生产维护命令独立调用

独立临时库：`/tmp/readmate-av2-cleanup.gzoE3q/cleanup.sqlite`，从正式迁移新建，然后只在该库构造：

- cutoff 之前 closed；
- 恰好等于 cutoff 的 closed；
- 有权威 `lease_ended` history 的过期 open；
- 没有合法 history 的异常 open。

实际调用根 package script：

```bash
npm run maintenance:reading-monitor-cleanup -- \
  --database /tmp/readmate-av2-cleanup.gzoE3q/cleanup.sqlite \
  --now 2026-08-10T00:00:00.000Z
```

首轮：

```json
{"cutoff":"2026-02-10T00:00:00.000Z","closedCount":1,"deletedCount":2,"anomalousOpenSessionIds":["anomalous-open"]}
```

第二轮：

```json
{"cutoff":"2026-02-10T00:00:00.000Z","closedCount":0,"deletedCount":0,"anomalousOpenSessionIds":["anomalous-open"]}
```

最终仅保留 `equal-cutoff` closed 和 `anomalous-open` open；异常 `--now not-a-time` 返回稳定错误前缀并以 exit `1` 结束。日志 SHA-256：`b2274b3221e773a2b80d2c1492dc3129ef5aa4324dc3b0769eb8356a3a4d4414`。

初次造库 harness 曾把中文工作区的 `file:` URL 直接当路径，迁移路径因 `%E6...` 编码不存在。这一验收脚本问题使用 `fileURLToPath` 后，在新临时库完整重跑上述正式命令，不影响产品结论。

## 7. G5-01～12 最终矩阵

| ID | 结果 | AV-2 独立结论依据 |
| --- | --- | --- |
| G5-01 | **PASS** | `catalog.js` 旧事件 `validReadingSeconds=0`，仅重算 eye-care，不调用 reading progress 重算；聚焦用例证明 old event 不覆盖 daily/位置。 |
| G5-02 | **PASS** | V-D 真实 50 人/37 打卡/13 未打卡，含 0s/299s，4 skip/8 reread，7 点补零；当前 `statistics.js` 哈希未漂移。 |
| G5-03 | **PASS** | V-D 已验全新、042 前向和重复启动；当前 043 哈希与证据一致，本轮迁移 focused 通过。 |
| G5-04 | **PASS** | V-BR 终稿在 page_turn 修复后通过学生摘要/self/护眼/末页/继续阅读；关键客户端哈希与该终稿一致，本轮 69 项聚焦通过。 |
| G5-05 | **PASS** | V-BR 终稿通过教师 50/37/7 点、筛选/轮询/stale、三视口抽屉/权限；UI 关键哈希与终稿一致。 |
| G5-06 | **PASS** | V-D 通过权限/跨组织/requestId、删除事务、转班快照、六月保留；本轮 68 项及真实 cleanup 命令通过。 |
| G5-07 | **PASS** | 稳定候选独立复跑 frontend `158/158`、server `167/167`、build、runtime/storage scan 与 diff-check 全过。 |
| G5-08 | **PASS** | 反向可达图审查没有主动生成的排名/速度/热点/待补/页面证据/startedBook/完成度/旧 footprints/旧 DTO fallback/双写；reports/public 只剩递归 denylist，对象/嵌套/顶层数组反例通过。 |
| G5-09 | **PASS** | V-R 的 S1/S2/C1/C2 最终均 CLOSED；本 AV-2 V 在当前哈希上重审 diff、可达图、高风险状态机与证据链，未发现新 P0/P1。 |
| G5-10 | **PASS** | 本文汇总候选哈希、全量/聚焦/清理命令、未决风险及最终结论。 |
| G5-11 | **PASS** | 根/server package 均有显式命令；独立临时库实调得 cutoff、1 close/2 delete、二轮 0/0、异常 open 报告和错误非零；无 timer。 |
| G5-12 | **PASS** | statistics/projections/reports/usage 阅读时长均读 `reading_daily_book_summaries`；`reading_progress` 仅位置；`reading_events` 仅 catalog ingest/eye-care，library 不返回 footprints；无旧时长读侧。 |

## 8. 已关闭缺陷在当前哈希上的复核

| 高风险回归 | 结论 | 当前证据 |
| --- | --- | --- |
| AV1 Reader 显式 `versionId/pageNo` | PASS | Reader 与 initial-page 回归哈希对应 AV1 终稿；显式末页保留位置，严格错 query 不 fallback。 |
| AVUI portal/ARIA/layout | PASS | 抽屉、日简报、BottomNav 及 UI 测试哈希与 AVUI 最小重验一致；本轮 UI focused 通过。 |
| lease 迟到截止 | PASS | 迟到 timer 仍在权威 `expiresAt` 切段；首次晚到直接 closed，连续截止前 revision accepted，超截止拒绝。 |
| 512 / 2 MiB 硬上限 | PASS | 511→512 及精确 2 MiB 当个 point 即停表；低于 80% 才恢复。 |
| 旧 page_turn 严格 payload | PASS | 新 monitor `source` 仅留在 coordinator，旧 payload 不泄漏 `source`；V-BR 修复后真实批次 200。 |
| old event 与 eye-care | PASS | old `valid_reading_seconds=0`，`valid_eye_seconds` 依可见性代理保留；仅 eye-care 聚合读 `reading_events`。 |
| reports/public 净化 | PASS | 内部对象/嵌套数组以及 public JSON/HTML 顶层数组全部递归删除完成度同义键；合法护眼/出勤 percentage 保留。 |

## 9. 反向扫描分类

反向词法日志 SHA-256 `3c6eca27e94556e1ef6f472b0d6499903d6321a9059c78a782ecc83b52652d47`；唯一真值来源扫描日志 SHA-256 `32bcece659f72aef8af7ac05052b8d1a500e7a8f5ee46888092434efe5db214e`。

- **生产可达且合法**：5 分钟打卡 progress/percentage、出勤率、eye-care 比例、AI/用量配额和教学安排 progress；它们不是书籍完成度。
- **生产可达且合法位置**：`lastPageNo/totalPages/currentPage` 只表示恢复位置或当前正文范围；无 `X/Y` 完成度派生。
- **生产可达 denylist**：`reports/index.js`、`public-summary-page.js`、`useReportsData.js` 中的 started/finished/pages/percent 文本是防御性递归删除器，不是指标生成器。
- **合法护眼**：`catalog.js` 仍写旧事件，但 reading 固定为 0，只以 `valid_eye_seconds` 聚合 eye-care。
- **不可达历史**：`src/student/data/**`、`src/console/data/fixtures/**`、未挂载的 Settings/QuotaManage/Ops 和公开营销页的“读完一本”文案。runtime graph 证明它们不进入 StudentApp/ConsoleApp 业务图，本轮不把它们误判为当前阅读监测输出。
- **历史表面命名**：`/student/home/ranking` 路径和部分 rank CSS 名保留，但页面实际是非竞争性“我的阅读书目”，按书名+ID 排序，无名次/百分位。

未发现生产可达的阅读排名、速度比较、热点、待补、页面证据、异常停留、startedBookCount、percent/finished/pagesRead 阅读完成推断、旧 footprints DTO、旧 self/scope fallback 或摘要失败后双写。

## 10. G2 / G4 关门意见

| 项目 | 结论 | 依据 |
| --- | --- | --- |
| G2-14 | **可转 completed** | V-D 真实 HTTP 权限/跨组织、reading-domain 删除事务回滚/隔离、转班发生时快照+当前名单分母均通过；当前聚焦回归再过。 |
| G2-17 | **可转 completed** | cleanup primitive 的北京日历月 cutoff、先关 open、严格删除 `< cutoff`、等值保留、异常 open 报告和幂等均通过；G5-11 生产命令亦实调通过。 |
| G4-01～14 | **可整体转 completed** | AV-UI 最小重验已关闭首轮 P0/P1/P2；当前 UI/状态/adapter/完成度 focused、frontend 158 和 build 全过，关键哈希未漂移。 |

## 11. Open findings 与残余风险

### P0

无。

### P1

无。G5 初审的 startedBook、footprints、lease 迟到、pending 硬上限及后续 reports 对象/顶层数组缺陷已在当前哈希上闭环。

### P2 / 已接受的不阻塞风险

1. `vendor-icons` 构建 chunk 为 `776.44 kB`，仍有 Vite `>500 kB` 告警；这是首载/性能风险，不影响本轮正确性。
2. runtime 不可达 fixture/data 与历史路径/CSS 仍含 `finished/percent/ranking` 文本；当前 import gate 隔离，未来误导入会有复活风险。
3. 根 `README.md` 仍描述为纯静态/零后端，与当前一体化运行方式有文档漂移；按控制文档 R-15 不阻塞本轮。

另外，G0 记录的依赖审计漏洞与本次未分块的依赖升级仍是独立延后风险；本 AV-2 没有重跑网络审计或扩展该范围。

## 12. 工作树与清场

- `git diff --check` 通过。
- 候选中的生产/测试/文档/截图都在已审查的阅读监测授权范围；未识别到凭据、token、临时 DB、Chrome profile 或验收日志被纳入候选。
- build 产物仅位于已忽略 `dist/`；未进入 tracked/untracked 交付清单。
- 仓库内没有 `server/data/readmate.sqlite`；正式 DB 不存在且没有被任何 AV-2 命令触发。
- 本轮的 cleanup DB 和日志均位于 `/tmp/readmate-av2-*`。
- G5_BROWSER 终稿记录 page_turn 修复后已关闭服务；本轮结束再次只读复查：

```text
5190 CLOSED
5191 CLOSED
9223 CLOSED
```

没有匹配 `remote-debugging-port=9223` 或 G5 隔离 profile 的存活进程。

## 13. 最终门禁意见

```text
G5-01..12 = PASS
G2-14      = may transition to completed
G2-17      = may transition to completed
G4-01..14  = may transition to completed
P0/P1      = 0/0
AV-2       = PASS
DELIVERY   = AUTHORIZED
COMMIT     = RECOMMENDED AFTER USER AUTHORIZATION; NOT EXECUTED
```

主控可依本结论将 G4、G5 与整体项目标记为 `completed`。
