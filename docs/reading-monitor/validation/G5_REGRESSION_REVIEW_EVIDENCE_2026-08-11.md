# G5 回归扫描与最终实现初审证据（V-R）

> 日期：2026-08-11（Asia/Shanghai）
>
> 验收者：V-R（只读审查；未启动浏览器；未修改生产代码或测试）
>
> 工作区：`/Users/yak/Project/整书8.10`
>
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`（`codex/reading-monitor-clean-baseline`）
>
> 候选状态：相对 HEAD 的未提交工作树；因此不存在能单独代表候选的 commit SHA。写入本文前的 436 个 Git tracked/untracked、排除 ignored 文件清单 SHA-256 为 `6f5d0dd6d24abf11dbd60f3ced5b1bd244fb32573f87febd99c6e75dea40b209`。

## 1. 结论

| 工作项 | 结论 | 依据 |
| --- | --- | --- |
| G5-07 全量回归 | **PASS** | frontend 152/152、server 165/165、build 成功、runtime import/storage 扫描通过、聚焦 18/18、`git diff --check` 通过 |
| G5-08 反向扫描 | **FAIL** | P1-01 仍输出/展示 `startedBookCount`；P1-02 仍从旧事件对外返回逐页 `footprints` 页面证据 |
| G5-09 最终实现审查（初审） | **FAIL** | 除 P1-01/P1-02 外，P1-03 迟到的租约过期回调会形成超界摘要；P1-04 队列刚达到硬上限时仍继续有效累计 |
| 本轮总结果 | **FAIL** | P0=0，P1=4；正式测试全绿不能覆盖下述四个反例 |

这不是环境阻塞。候选可运行且门禁可执行；失败来自生产可达语义与状态机边界。

## 2. 审查输入和边界

完整阅读了当前版本的：

- `docs/reading-monitor/IMPLEMENTATION_CONTROL.md`
- `docs/reading-monitor/G1_FROZEN_CONTRACT.md`
- `简化版阅读监测_新基线开发包_2026-08-10/README_先看.md` 与 `01`～`06`
- AV0 baseline/gate、AV1 plan/vertical/minimal retest、AVUI initial/minimal retest 全部证据
- 当前 `git status`、tracked diff、所有新增候选文件与关键测试

本文只覆盖 V-R 的 G5-07、G5-08、G5-09 初审。没有浏览器操作（V-BR 负责），没有 commit/push/reset/clean，没有修复生产代码或测试。

## 3. G5-07 独立正式门禁

执行时间为 2026-08-11 00:45～00:46 CST。

| 命令 | 结果 | 精确计数/告警 | `/tmp` 日志 SHA-256 |
| --- | --- | --- | --- |
| `npm run test:frontend` | PASS | tests 152；pass 152；fail/cancelled/skipped/todo 均 0；248.763291ms | `9bdd9a26cff3898441444f66f683b60f58d8dadacd1b6595f3db13bc0e6efe5b` |
| `npm run test:server` | PASS | tests 165；pass 165；fail/cancelled/skipped/todo 均 0；3529.884584ms | `36db79e7e595388020081beb2d8f4b74723e9d1a5ac97abf805319fa756f087d` |
| `npm run build` | PASS with warning | Vite 5.4.21；1737 modules；1.70s；唯一告警为 chunk >500kB；最大 `vendor-icons-DwfL3uyf.js` 776.44kB（gzip 135.05kB） | `918a3f556840aaf401514e56b4db1fe546c42c0a7d768124c20bd1240205c976` |
| `node tests/frontend/runtime-import-scan.mjs` | PASS | student/console 两个生产模块图 `forbiddenImports=[]`、`storageReferences=[]`；唯一精确放行 `src/student/reading-monitor/pendingStore.js` 的 IndexedDB；4 条关键路由成功/失败态均存在 | `23a231eb24d4b59e5da794faa5e830ddba33d0a1597553e1c6fc408620ef9aa6` |
| monitoring/HTTP/eye-care/cleanup 聚焦 `node --test ...` | PASS | tests 18；pass 18；其余 0；582.094583ms | `560bfe943c0f5fad5ca74d8f46704345cb71d802ab4e5e4e7240d990d40275ec` |
| `git diff --check` | PASS | 空输出 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

构建产物（`dist/index.html` 及 JS/CSS 共 11 个文件）清单 SHA-256：`d656d2a052ba3878c66337eaa5bbe4135d84bc67192bfd16a2673b32b654a684`。

## 4. P1 发现

### P1-01 — 禁用的 `startedBookCount` 仍由生产接口生成并在公开报告展示

- Owner：**I-S**
- 契约依据：G1 第 8 节要求统一清理服务端 projections/reports/public summary 的旧完成度语义；现有前端回归 `tests/frontend/reading-monitor-completion-semantics.test.mjs:62-68` 也明确要求报告移除“开始书目”。
- 生产位置：
  - `server/integration/projections.js:185-192`：`/reading/progress` 投影仍返回 `startedBookCount: items.length`。
  - `server/domains/reports/index.js:56-65`：默认阅读报告仍生成 `startedBookCount: rows.length`。
  - `server/http/public-summary-page.js:1-34`：为该字段保留“开始阅读书目”标签，过滤器未禁止它。
  - `tests/server/http/public-summary-page.test.js:6-27`：测试反而要求公开页继续展示该指标，与前端回归相冲突。
- 独立反例：把 `{effectiveMinutes:12, startedBookCount:2, pagesRead:999, finished:true}` 交给公开报告 sanitizer/render；`pagesRead/finished` 被删除，但 `startedBookCount:2` 保留，HTML 同时出现“开始阅读书目”和值 `2`。日志 `/tmp/g5-vr-started-book-proof.log` SHA-256 `bd40a88879fa0fcddb5a935385cd3833232b3ddcdb2bb849de5de3b540b26b38`。
- 影响：禁用指标仍是生产 DTO/持久化报告/公开页面真值；“页面不消费”不能消除服务端与公开链接的可达输出。
- 最小重验：服务端投影、默认报告、公开 JSON/HTML 四层均断言 `startedBookCount` 不存在；前后端语义测试不得互相矛盾；重跑 server 全量与 build。

### P1-02 — `/reading/library` 仍返回旧事件逐页 `footprints` 页面证据

- Owner：**I-S**
- 契约依据：G1 第 7 节冻结旧 `reading_events` 的唯一用途为 `valid_eye_seconds → eye-care` 聚合，并要求 I 清理共享投影/API/页面旧读取；需求 `01` 与 G5 清单明确“无页面证据”。
- 生产位置：
  - `server/domains/reading/library-objects.js:384-405`：查询最近 200 条 `reading_events`，输出 `eventId/pageNo/eventType/occurredAt/validEyeSeconds`。
  - `src/student/state/useReadingLibrary.js:6-30,90-94`：生产运行时继续接受 `footprints`，并让它参与 `hasLibraryData`/ready 判定。
  - `tests/server/reading/student-library-objects.test.js:119-133`：正式测试锁定逐事件足迹仍存在。
- 独立反例：一个学生只要有一条旧 `page_stay/page_turn`，GET `/reading/library` 就可得到该页码、事件类型、时间与逐事件护眼秒数；即使当前重写后的 Footprint 页面不渲染它，payload 已对外可达，并能把本应为空的 library resource 变成 ready。
- 影响：旧事件不再仅作为护眼聚合输入；逐页行为证据仍通过生产 API/adapter 存活，G5-08 不能通过。
- 最小重验：`getSnapshot()` 与 HTTP `/reading/library` 均断言不查询/不返回 `footprints`；旧事件仍能正常贡献 eye-care 聚合；student library 空态不受旧事件影响；重跑 server/frontend 全量。

### P1-03 — 租约过期 timer 迟到时，客户端把截止点放在回调时刻而非 `expiresAt`

- Owner：**C**
- 契约依据：G1 第 6.2 节只允许在租约有效时累计；服务端以 lease history 的 `valid_until` 作为权威上界。
- 生产位置：
  - `src/student/reading-monitor/leaseController.js:123-133`：最后重试后只设置到期 timer；迟到回调只检查“现在已过期”，没有把权威 `expiresAt` 传给 invalidation。
  - `src/student/reading-monitor/coordinator.js:108-123`：`onInvalid` 用回调时的 `clock.now()` 切段并关闭。
  - `src/student/reading-monitor/activity.js:66-88`：切段会把单调钟经过时间计入累计。
  - `server/domains/reading/monitoring.js:330-355`：正确拒绝 `measuredThroughAt/endedAt > history.valid_until`。
- 独立反例：租约 `08:01:30` 到期，30/15/5 秒续租均为网络失败，主线程使最终 timer 到 `08:02:00` 才执行。实际摘要为 `measuredThroughAt=08:02:00`、`cumulativeEffectiveMs=120000`；模拟服务端返回 `LEASE_CONFLICT` 后记录保留且会话关闭。日志 `/tmp/g5-vr-late-lease-proof.log` SHA-256 `227d738b6fc7f4d5895a72483fc097e259d5565afe251c9b9edbb35214929f8a`。
- 测试缺口：`tests/frontend/reading-monitor-client-lease-summary.test.mjs:10-42` 与 coordinator harness 会把 callback 精确执行在预定时刻，没有“时钟跨过 expiresAt 后再执行到期 callback”的用例。
- 影响：合法的本地阅读会产生服务端必拒的 revision；该首条记录阻塞同 session 后续 revision，且多计租约外时长。
- 最小重验：显式延迟最终 timer 30 秒，断言切段点/`measuredThroughAt`/累计均钳在权威 `expiresAt`，服务端接受该截止前 final revision；再覆盖迟到 callback 与同时发生 visibility/close 的幂等顺序。

### P1-04 — 第 512 条使待确认区刚达到硬上限后，累计没有立即停止

- Owner：**C**
- 契约依据：G1 第 6.3 节规定达到 512 条或 2 MiB 且无法排空时，立即停止新增有效累计并显示可操作错误。
- 生产位置：
  - `src/student/reading-monitor/pendingStore.js:148-159`：允许合法写入恰好第 512 条，并返回 `usage.full=true`。
  - `src/student/reading-monitor/pendingQueue.js:64-82`：发送失败时仍以正常 outcome 返回该已持久化记录与 `usage.full`。
  - `src/student/reading-monitor/coordinator.js:223-230`：忽略正常 outcome 的 `usage.full`，只在下一次 enqueue 抛出 `PENDING_STORE_FULL` 时调用 `setStorageAvailable(false)`。
- 独立反例：离线队列预置 511 条；第一次 flush 写入第 512 条后 `usageFull=true`，但 `segmentActive=true`、累计 10000ms；再前进 10 秒，累计继续到 20000ms，第二次 flush 才抛 `PENDING_STORE_FULL` 并停止。日志 `/tmp/g5-vr-pending-capacity-proof.log` SHA-256 `e0f0f43c8c635fee00e91e765396f38f727e55cb6a0f425befc62d4a76ad8ea0`。
- 测试缺口：`tests/frontend/reading-monitor-client-pending-queue.test.mjs:221-245` 只覆盖容量函数与“已经满载后的第 513 条拒绝”，未覆盖 coordinator 从 511→512 的瞬间。
- 影响：达到冻结硬上限后仍可继续新增不可持久化的有效时长，最坏可延续到下一次约 5 分钟 flush/生命周期事件。
- 最小重验：分别覆盖 511→512 和字节数精确达到 2 MiB；离线 drain 失败后断言同一 point 立即切段、明确 pressure/full 错误、下一时间片累计不增长；排空后才恢复。

## 5. 反向扫描分类

生产源码与测试共命中 204 行候选词（原始日志 `/tmp/g5-vr-reverse-scan-all.log` SHA-256 `5963c26683f467d155e54c39eeda5d0b42d8850d34779bb0416efa36811fc8b6`）。逐项分类如下：

- **禁止生产语义**：P1-01 的 `startedBookCount`；P1-02 的逐页 `footprints`。
- **合法护眼**：`catalog.js` 的旧事件 ingest、`valid_eye_seconds` 与 eye-care 聚合；新写入的 `valid_reading_seconds=0`，且没有旧事件回写 reading progress。
- **合法位置/显示**：`last_page_no`、`lastPageNo/totalPages` 只用于最近位置和继续阅读；Reader 的“覆盖第 X–Y 页”描述当前服务端正文资源范围，不是学生行为证据或完成范围。
- **合法其他百分比**：每日打卡 5 分钟阈值进度、AI/用量配额、成长等级和教学安排进度，不是书籍完成百分比。
- **合法兼容路由**：`/student/home/ranking` 仍可深链到达，但页面标题为“我的阅读书目”，只按书名+ID 稳定排序，不输出名次、百分位或竞争结论。
- **不可达历史**：`src/student/data/*`、`src/console/data/fixtures/*` 仍含 `percent/finished/RANKING` 等历史文本；runtime graph 证明未从 StudentApp/ConsoleApp 生产图导入。按 G1 第 8 节作为残余风险记录，不判本轮生产失败。
- **测试/迁移文本**：旧 migration、负例输入与 `doesNotMatch` 断言中的 `pagesRead/finished/reading_events` 合法；但两项正式 server 测试主动锁定 P1-01/P1-02，不能归为普通负例。
- **存储**：生产图无 localStorage/sessionStorage；唯一 IndexedDB 为冻结允许的 `pendingStore.js`；未发现越界业务存储、fixture 补 0、旧 `/self`/`/scope` DTO fallback 或摘要失败双写旧统计。

未发现生产可达的排名、速度比较、热点、待补页、异常停留诊断、`percent/finished/pagesRead/读到第X页` 完成推断、last page 覆盖推断或 AI 历史页覆盖推断。

## 6. 高风险实现审查结果

除 P1-03/P1-04 外，下列实现未发现新的 P0/P1：

- 后端 summary 严格字段/规范时间/未来时间/统计日/指纹校验；lease history 上界；revision replay/superseded/gap/regression；事务内 session/daily/position；跨 session 位置按测量时间单调、同毫秒取更大页码。
- `/self`、`/scope` 严格 DTO、query、权限与组织范围；HTTP 错误码与 `requestId` envelope。
- Reader 单/双页主页面、移动来源、最后页仅位置；显式版本/页码错误不静默 fallback。
- 教师 5 分钟可见时轮询、回前台立即刷新、stale 保留旧时间且不冒充成功；学生/教师错误和空态不补 0。
- 教师详情 portal 的 Escape、focus trap、滚动锁定、事件监听和关闭恢复清理。
- cleanup CLI 的参数失败、事务、cutoff 严格小于、历史已结束 open 关闭、异常 open 报告和幂等。

## 7. P2/残余风险

1. **P2 / 构建体积**（owner：I-F/主控）：build 唯一 warning 为 `vendor-icons` 776.44kB 超过 500kB。当前不影响 G5-07 成功，但会增加首载风险。
2. **P2 / 不可达历史文本**（owner：主控后续范围决策）：fixture/data 中仍有 `finished/percent/ranking`，当前由 runtime graph 隔离；未来误导入会复活旧语义，应继续保留 import gate。
3. 兼容路径名 `home/ranking` 与旧 `.student-rank-*` 样式仍在，但当前页面无竞争语义；属于命名/遗留表面风险，不是本次功能阻断。

## 8. 哈希与复验定位

- 关键审查文件 SHA-256 清单的 SHA-256：`62e688b6f00685897c66a8d805f85b332609e0e52f668661c6fb618ead21708d`。
- 其中：
  - `IMPLEMENTATION_CONTROL.md`：`1c5a17c77cf510c5fadb5bedfeda019ff88b28256fdba4c9e7f8fbf5ce57e255`
  - `G1_FROZEN_CONTRACT.md`：`6772dffcdb07efe7b9db69f1f90d5ce840129440a581d72aa54f03f24c49eace`
  - `monitoring.js`：`a7548905ea5ed7103e244676a7578797fe2b85f5e9906f84ac0583716201d8b1`
  - `statistics.js`：`7b0780a3e807038e02d32809d849fe032d711631f2e1b7ddb0dbe363abc24a4b`
  - `library-objects.js`：`a30b5fc8eb8789e434ccc3690e071f5174bb1ad74fa432b26dfe3ea5d32df3ef`
  - `projections.js`：`526f7a7b322d94145caa8059ffd5ae80755e73b6e955022f06e9a86aee3277f6`
  - `reports/index.js`：`9fc5d956fd442da638393bfad14c7cb0083bd132ebf83066ee90d88121ab817c`
  - `public-summary-page.js`：`3ea357f94fad5ddeee935ebcdb89a7e64a8b502efd3a29e2520a15f38461f9cd`
  - `leaseController.js`：`8b04adc154d63018d8a0f758e50fd68173f0296a212f5a611bdccd24ece09e74`
  - `coordinator.js`：`279738e5b0690b9223524a6dbdec23d3157c71510b2d08f8d3adb1e2799350cb`
  - `pendingStore.js`：`061c05ddcb7112585aae36b116ce939d3eb0f4e2bf83f5f75409c590cb3715a1`
  - `pendingQueue.js`：`f026063e0b750bbf0e7b4c8bbd5f674b37828258f0659ceb9e91ea490c9bde6e`

在四项 P1 关闭前，不建议把 G5-08/G5-09 或整体 AV-2 标为 PASS。
