# AV-1 关键纵向链路独立验收证据

> 执行日期：2026-08-10（Asia/Shanghai）
> 执行角色：独立验收 Agent V
> 候选分支：`codex/reading-monitor-clean-baseline`
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`
> 最终结论：**FAIL**
> 是否允许 W3：**否**

## 1. 结论摘要

AV-1 的十项主纵向链路全部通过：真实 C 客户端能经 HTTP 写入 B 的 session/daily/position 事务，幂等/revision、续租、前后台/04:00、严格查询、权限、唯一新统计和护眼边界均有聚焦或真实运行证据。

但补充硬门槛“显式继续阅读页码/直接最后页”在真实 Chrome 中失败：带 `pageNo=4` 的 Reader URL 在默认三维翻页模式下仍停在首个双页视图，底栏为“第 1 页 / 共 4 页”，上一页禁用、下一页可用。自动化解析测试通过，但真实 UI 没有把解析结果落实到翻页组件。该问题违反冻结契约“显式 version/page 必须打开准确版本和页码”，因此整体 AV-1 为 **FAIL**，不能进入 B G5-01 → I → U 的 W3 串行切换。

发现问题后只记录证据，没有修改生产代码或测试。

## 2. 环境与候选身份

| 项目 | 实际值 |
| --- | --- |
| Node/npm | `v24.16.0` / `11.13.0` |
| 临时数据库 | `/tmp/readmate-av1.6AayMW/readmate.sqlite` |
| 临时公版资产 | `/tmp/readmate-av1.6AayMW/public` |
| Node/Vite | `127.0.0.1:5191` / `127.0.0.1:5190` |
| 浏览器 | Google Chrome `151.0.7922.76`，独立临时 profile，1440×1000，CDP 端口 9223 |
| 迁移 | `27|043_reading_session_summaries.sql` |
| 结束状态 | 5190、5191、9223 均无 LISTEN |

应用内 Browser runtime 起初返回无可用实例；在主控明确授权检查本机已有替代后，使用系统现有 Chrome 与临时 profile 进行真实页面、Network、console 和 IndexedDB 验证。没有安装依赖或复用个人浏览器资料。

关键候选文件在执行前后 SHA-256 一致：

```text
136ccf7212858bf3592e214da5f190673791710a4f28beb625dfe3e23c7cbb91  server/db/migrations/043_reading_session_summaries.sql
a7548905ea5ed7103e244676a7578797fe2b85f5e9906f84ac0583716201d8b1  server/domains/reading/monitoring.js
688808444d450944e008eabfeacd9722ed2828f0fca07a4d03d138e022bd3871  server/domains/reading/catalog.js
7b0780a3e807038e02d32809d849fe032d711631f2e1b7ddb0dbe363abc24a4b  server/domains/reading/statistics.js
829edc7540ff0ed3a6eec3e6f575d78c8137003415e1eaf6f06c5621ca18ae95  server/http/integration-router.js
447aec2f093616b80bd791c0a3ad977641e91c3c9c1390ff81aa090d0d22b7a9  src/api/student.js
dc3bf6e9660bc72ba7f67e100b6892c91903c9c41d5231e57736bdff9cb02d36  src/student/pages/Reader.jsx
279738e5b0690b9223524a6dbdec23d3157c71510b2d08f8d3adb1e2799350cb  src/student/reading-monitor/coordinator.js
061c05ddcb7112585aae36b116ce939d3eb0f4e2bf83f5f75409c590cb3715a1  src/student/reading-monitor/pendingStore.js
```

## 3. 复用与聚焦测试

没有重跑 B/C 已完成的项目级全量和 build。主控交接的候选证据为：

- B：专项 43/43、DB 8/8、HTTP 12/12、server 真全量 160/160；
- C：scoped 38/38、frontend 真全量 139/139、build 两次通过；
- I：HTTP/API 6/6、Stage 4 1/1、stage5 13/13。

V 只运行阅读监测聚焦命令：

```bash
node --test \
  tests/server/reading/reading-monitoring.test.js \
  tests/server/reading/statistics.test.js \
  tests/server/http/reading-monitor-http.test.js \
  tests/server/reading/reading-teaching-bridge.test.js
```

结果：`31/31 pass`，`0 fail/skip/todo`。命名用例明确覆盖 04:00、renew/acquire、三终态、严格校验、首次晚到 closed、连续晚到、乱序位置、事务回滚、删除/cleanup、50 人、权限和跨组织。

```bash
node --test \
  tests/frontend/reading-telemetry-sequence.test.mjs \
  tests/frontend/reading-monitor-api-contract.test.mjs \
  tests/frontend/reading-monitor-client-*.test.mjs \
  tests/frontend/console-live-reading-eyecare-pages.test.mjs
```

结果：`39/39 pass`，`0 fail/skip/todo`。命名用例明确覆盖 4:59/5:00/8:00、前后台、Reader movement source、30/15/5 秒续租、冲突停表、请求前 IndexedDB 事务、512/2 MiB、80% drain、三终态删除与其他错误保留。

```bash
node tests/frontend/runtime-import-scan.mjs
```

结果：通过。学生运行时图的普通业务存储引用为 0，唯一允许项为 `src/student/reading-monitor/pendingStore.js`；教师运行时图无存储引用。

## 4. 十项 AV-1 结果

| ID | 必验项 | 结果 | 核心证据 |
| --- | --- | --- | --- |
| AV1-01 | 真实学生累计摘要 | **PASS** | 真实 Chrome Reader 产生 `reading-session-2cc...`；HTTP 幂等记录为 accepted，session 累计 `42430ms`。与独立 HTTP 会话合计 session `44430ms`，daily 也为 `44430ms`；`/self`/`scope` 均返回 44 秒。 |
| AV1-02 | accepted/replayed/superseded | **PASS** | 真实 HTTP 依次返回 accepted r1、replayed r1、accepted r2、superseded r1；响应 header 与 envelope requestId 一致。 |
| AV1-03 | 重复/乱序/倒退/冲突 | **PASS** | 同一真实会话 conflict → `REVISION_CONFLICT` 409，r4 跳号 → `REVISION_GAP` 409，r3 累计倒退 → `SUMMARY_REGRESSION` 409；最终 session/daily 都保持 `2000ms`，未重复计时。 |
| AV1-04 | session+daily+position 单事务 | **PASS** | 真实 accepted r2 后 session revision=2/cumulative=2000/page=2，daily=2000/page=2，reading_progress page=2 且旧时长仍为 0；聚焦用例“每日汇总失败时会话和位置均回滚”通过。 |
| AV1-05 | renew/失败/接管/过期停表 | **PASS** | 真实 renew 保持 leaseId，`renewedAt→expiresAt=90000ms`；错书为 `LEASE_CONFLICT` 409。浏览器 lease history 从 `14:31:47` 持续续到 `14:38:17`、version=9；聚焦客户端/HTTP覆盖冲突立即停表、过期不复活和 takeover。 |
| AV1-06 | 前后台与 04:00 | **PASS** | 真实 Chrome lifecycle freeze 形成旧 page_stay 与新摘要；console 0 error。客户端聚焦证明后台时间为 0，服务端/客户端聚焦均通过 `03:59:59.999→04:00:00.000`、先关旧 session 再开新 statDate。 |
| AV1-07 | 严格 `/self`/`/scope` | **PASS** | 真实 `/self` 只返回冻结字段和 44 秒；真实 `/scope` 为 7 点趋势、1 名学生、44 秒、requestId；未出现旧 total/week/byBook/eyeCare 等字段。 |
| AV1-08 | 权限/跨组织 | **PASS** | 真实 student 请求 `/scope` → 403 `PERMISSION_DENIED` + requestId；聚焦 HTTP 同时通过同组织无权 403、跨组织 404、未知 query 422，响应无受保护数据。 |
| AV1-09 | 新旧不同时贡献新统计 | **PASS** | 最终新 session 累计总和=`44430ms`、new daily=`44430ms`；同时旧 events 已贡献 `253s valid_reading`，但 `/self`/`scope` 仍为 44 秒而不是 297 秒。新统计只取摘要。 |
| AV1-10 | 护眼不回归 | **PASS** | 旧 events `valid_eye_seconds=253s`，eye-care day/week=253s；真实 `/eyecare/students` 返回 253 秒。教师 Chrome 护眼页显示林小竹约 4 分钟、正常状态，requestId `8dc72e5d-...`，console 0 error。 |

## 5. 真实 HTTP/revision 证据

同一会话 `av1-real-http-session`：

| 操作 | HTTP/结果 | requestId |
| --- | --- | --- |
| r1 | 200 accepted | `267300da-13b8-4c58-917c-0696b3c0d82d` |
| r1 同指纹新幂等键 | 200 replayed | `29243c40-a19f-40cd-b748-aad0db0fabdf` |
| r2 | 200 accepted | `6800172f-d9f9-47d8-96e2-fd7dd4867f4c` |
| r1 再送 | 200 superseded | `b8f21ee0-aaa8-4767-9cc4-2aa9f57dc788` |
| r1 异内容 | 409 REVISION_CONFLICT | `8b8ec887-c9e3-4637-b449-b219cc2da90d` |
| r4 跳号 | 409 REVISION_GAP | `c8f2d0c2-af9b-4bf5-b233-0c6b1608583b` |
| r3 累计倒退 | 409 SUMMARY_REGRESSION | `7f90a059-8f96-484d-8c18-a01dd95c2e01` |

真实 renew：

```text
leaseId    = db5b23e3-c198-4f2a-93b8-1eef0b5133ba
renewedAt  = 2026-08-10T14:28:09.773Z
expiresAt  = 2026-08-10T14:29:39.773Z
TTL        = 90.000s
requestId  = 08516555-a645-41f2-8341-12d00632d018
```

错书 renew 返回 409 `LEASE_CONFLICT`，requestId `342b05da-c409-44e7-a88c-ddbd54cbd0b9`。

## 6. 真实 SQL 与唯一真值证据

### 6.1 独立 HTTP 会话

```text
session id              = av1-real-http-session
latest_revision         = 2
cumulative_effective_ms = 2000
last_page_no            = 2
daily effective_ms      = 2000
reading_progress page   = 2
progress legacy seconds = 0
```

replayed、superseded 和三种 409 后上述值没有再次增加。

### 6.2 浏览器加入后的最终交叉核对

```text
summary rows                    = 3
SUM(session cumulative ms)      = 44430
reading_daily effective ms      = 44430
old reading_events count        = 6
SUM(old valid_reading_seconds)  = 253
SUM(old valid_eye_seconds)      = 253
/self today seconds             = 44
/scope total seconds            = 44
/eyecare daily seconds          = 253
```

这同时证明：

- 真实 C Reader 已经经 HTTP 进入 B 的摘要事务；
- 旧事件的 253 秒没有被加进 new daily 或严格新查询；
- 旧事件仍完整进入 eye-care；
- 新摘要没有冒充 eye-care。

## 7. IndexedDB 与客户端队列

真实 Chrome 读取到：

```text
database   = readmate-reading-monitor-v1
version    = 1
store      = pending_summaries
keyPath    = key
index      = scope_created
index key  = [scopeKey, createdAt, sessionId, revision]
unique     = false
```

客户端测试 39/39 中以下真实命名断言通过：

- “IndexedDB 待确认区按组织/学生/工作空间/设备隔离并在请求前完成事务”；
- “摘要必须先原子持久化再串行请求，三种终态均删除”；
- “网络和 revision/权限/租约冲突保留记录并停止后续串行修订”；
- “512 条或 2MiB 是硬上限，80% 压力阈值可观测”；
- “满载时先尝试 drain，仍无法排空则显式失败而不覆盖”。

浏览器在成功 drain 后 store count 为 0，符合终态删除。

## 8. 晚到租约与时间边界

服务端聚焦命名用例全部通过：

- “旧租约首次晚到直接 closed，且允许截止前连续晚到 revision”；
- 首次 revision 1 不产生临时 open；
- 后续连续晚到只推进合法累计并保留服务端权威关闭状态；
- 越过 history cutoff 拒绝；
- 跨 session 旧事实晚到仍累加 delta/OR，但不回退位置；
- 相同毫秒只以更大页码稳定破同值；
- 墙钟累计、未来 120 秒、统计日和只允许 stat_date_change 落下一 04:00 边界均已通过。

## 9. P0 失败：显式最后页未落实到真实翻页组件

### 复现

1. 用已登录真实学生会话直接打开：

```text
http://127.0.0.1:5190/student/reader/book-cdf0dfa2df2718611c50cba4?versionId=version-cdf0dfa2df2718611c50cba4&pageNo=4
```

2. 等页面、书籍、正文和 Reader 初始化稳定；Chrome 视口 1440×1000；
3. 读取可见底栏和上下页按钮状态。

### 预期

双页模式应打开包含第 4 页的末尾视图，即主页面为 3、可见页为 3–4；底栏应为“第 3 页 / 共 4 页”，上一页可用、下一页禁用。不能产生 100%/finished/pagesRead。

### 实际

```text
URL              = ...?versionId=version-cdf...&pageNo=4
底栏             = 第 1 页 / 共 4 页
上一页           = disabled
下一页           = enabled
console errors   = 0
```

等待后状态不变。切换阅读偏好到“平移”并手动下一页后，才到达“第 3 页 / 共 4 页”，下一页禁用，且页面确实没有 100%/finished/读完文案。

因此“最后页不产生完成度”这一语义本身通过，但“显式继续阅读 URL 打开准确页码”在默认真实 Reader 中失败。静态/纯函数测试没有发现该翻页组件集成问题。

建议唯一负责人 C 在 `src/student/pages/Reader.jsx` 的翻页组件初始化/首次 `onFlip` 与解析后的 `initialLeaf` 交界处修复，并增加真实组件级回归：显式 `pageNo=4` 在双页三维模式必须稳定落到 leaf 2，而不能被首次回调写回 leaf 0。V 不修改该文件。

## 10. 分级发现

### P0

- **P0-01：显式 Reader `pageNo` 在默认三维翻页模式未落实。** 阻断 AV-1；精确复现见第 9 节。

### P1

无新增 P1。

### P2

- 应用内 Browser runtime 本轮没有可用实例；已按主控授权用本机现有系统 Chrome、独立临时 profile 和 CDP 完成等价真实验证，不影响产品判断。
- Chrome 自身输出 updater/GCM 诊断噪音，但产品页面 console 采集为 0 error；两者已区分。

## 11. 服务回收与工作树保护

- Chrome/CDP 9223：已停止；
- Vite 5190：已发送 Ctrl-C；
- Node 5191：已发送 Ctrl-C；
- `lsof` 复核 5190/5191/9223 均无 LISTEN；
- V 没有修改生产代码、测试、控制文档或需求包；只新增本 evidence。

## 12. 最终判定

```text
AV-1 = FAIL
P0   = 1
W3   = NOT AUTHORIZED
```

修复 P0-01 并由 C 交接后，建议只重跑：

1. C 的 Reader/客户端聚焦回归；
2. 真实 Chrome 的显式 pageNo=4 三维模式；
3. 最后一页仍无 100%/finished；
4. 一次真实摘要/strict self/scope 冒烟。

无需因该单点 UI 初始化缺陷重复 B 的 160 项全量或本报告已经通过的 revision/事务/权限/护眼矩阵。
