# G5 四项 P1 统一独立最小重验证据（V-R）

> 日期：2026-08-11（Asia/Shanghai）
>
> 验收范围：初审证据中的 S1/S2/C1/C2；只验不修，未启动浏览器
>
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`
>
> 候选：未提交工作树；写入本文前 449 个 Git tracked/untracked、排除 ignored 文件的清单 SHA-256 为 `d70bab79a51528c54b2ae53882d9470e5b5ce7e0f3b90a3071825806ce7a1544`

## 1. 结论

| 项目 | 结论 | 说明 |
| --- | --- | --- |
| S1 `startedBook*`/完成度与报告 | **FAIL / 仍 OPEN** | `startedBookCount/startedBooks/booksStarted` 已清理，但内部报告 sanitizer 仍接受、持久化和返回 `percent/percentage/阅读完成比例` |
| S2 旧事件逐页 `footprints` | **PASS / CLOSED** | library 生产查询和 DTO 均移除；前端 parser 丢弃旧字段；旧事件 eye-care 聚合仍通过 |
| C1 迟到租约过期回调 | **PASS / CLOSED** | 独立假钟 + 真实 SQLite monitoring 在 callback 晚 30 秒时仍严格截止 `expiresAt` 并 accepted |
| C2 pending 刚达硬上限 | **PASS / CLOSED** | 511→512、精确 2 MiB 均立即停表并可见；低于 80% 才恢复；原子顺序/多 scope 回归通过 |
| 本轮总结果 | **FAIL** | 四项未能全部关闭；P0=0，仍有 P1=1（owner I-S） |

因此：G5-07 的修复后复跑仍为 PASS；G5-08 **不能改为 PASS**；G5-09 初审的 S2/C1/C2 缺陷可关闭，但 S1 仍未关闭，暂不允许交给最终 V 作通过性复核。本报告不构成 AV-2 结论。

## 2. 候选稳定性

- 重验开始和结束时，12 个 S1/S2/C1/C2 关键生产/测试文件清单 SHA-256 均为 `4f772853651f12a26cf737d63d76769a76146ca24c40b631a4cf72876f39959d`，关键候选未漂移。
- 整体候选清单从开始到落盘前仅 `IMPLEMENTATION_CONTROL.md` 被主控同步更新；四项修复文件没有变化。
- `git diff --check` 空输出；日志 SHA-256 为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

## 3. S1 — 仍 FAIL

### 3.1 已通过部分

- `server/integration/projections.js:148-192` 的 `projectReadingProgress()` 不再生成 `startedBookCount` 或书籍完成度。
- `server/domains/reports/index.js:8-27` 已拒绝 `startedBookCount/startedBooks/booksStarted`、finished aliases、页数及包含 `progress/completion/finished` 的键。
- `server/http/public-summary-page.js:8-42,60-78` 的公开 JSON 与 HTML sanitizer 会删除上述别名以及 `percent/percentage`。
- 真实 HTTP 定向覆盖默认报告、显式旧 payload、内部读取和公开链接；定向 server 37/37 通过。

### 3.2 独立反例

生产内部报告 sanitizer `server/domains/reports/index.js:8-27` 没有拒绝：

- `percent`
- `percentage`
- `阅读完成比例`

使用真实 `createReportsDomain`、正式迁移和临时 SQLite 生成报告，输入同时包含：

```json
{
  "effectiveMinutes": 12,
  "startedBookCount": 2,
  "startedBooks": 3,
  "booksStarted": 4,
  "finishedBookCount": 5,
  "pagesRead": 99,
  "progressPercent": 100,
  "percent": 100,
  "percentage": 100,
  "阅读完成比例": "100%"
}
```

实际：前六个禁字段被清理，但 `generateReport()` 响应、数据库 `report_versions.content_json` 和 `listReports()` 三层都保留：

```json
{
  "effectiveMinutes": 12,
  "percent": 100,
  "percentage": 100,
  "阅读完成比例": "100%"
}
```

日志：`/tmp/g5-vr-retest-s1-internal-percent-counterexample.log`，SHA-256 `7135dfc6a2ed9b02a71dda5ec6b2f5716bf33824a2b36f13b60898326cbcd567`。

影响：公开链接会二次过滤英文 `percent/percentage`，但生产内部报告 JSON、持久化版本和教师内部读取仍携带同义完成度，未满足“projection/report/public JSON+HTML 均不生成/展示”和“旧 payload sanitizer 拒绝”。

Owner：**I-S**。

### 3.3 S1 最小重验清单

1. 用真实 reports domain 输入 `percent/percentage/阅读完成比例` 及原有 started/finished/pages/progress aliases；断言写入前、DB `content_json`、`generate/list/get` 所有版本均不含禁字段。
2. 手工插入含上述字段的旧 `report_versions.content_json`，断言内部 list/get 输出被清理，不要求破坏历史原始行。
3. 同一 payload 经公开 summary JSON 和 HTML 后不得出现键、标签或值 `100%`。
4. `projectBooks/projectReadingProgress` 继续断言无 percent/finished/pagesRead/started aliases；默认 daily 报告只保留合法指标。
5. 同步覆盖前端报告 adapter 的 aliases 后，重跑公开页、integration runtime、reports domain、frontend/server 全量和 build。

## 4. S2 — CLOSED

- `server/domains/reading/library-objects.js:381-383` 直接返回六类学生主动保存对象；生产文件不再出现 `reading_events` 或 `footprints` 查询。
- `src/student/state/useReadingLibrary.js:6-25` 的空对象和 parser 均只有六个集合；旧 payload 的 `footprints/pageNo/eventType/occurredAt` 被忽略，且不能把空资源变为 ready。
- HTTP `/reading/library` 在写入旧 page event 后仍不输出 `footprints`；书签、摘录、批注自己的 `pageNo` 是学生主动保存对象锚点，不属于旧行为证据。
- monitoring/teaching bridge 证明旧事件仍写 `valid_reading_seconds=0`、正常聚合 `valid_eye_seconds`，不覆盖 daily/progress。
- server 定向 37/37、client 定向 31/31、相关 focused 18/18 均通过。

结论：原 P1-02 **CLOSED**。

## 5. C1 — CLOSED

### 5.1 独立端到端反例重放

使用独立双时钟、故意不执行到期 timer，再把 client summary 送入真实 migration + SQLite + `createReadingMonitoringDomain`：

| 项目 | 实际值 |
| --- | --- |
| lease `expiresAt` | `2026-08-10T08:01:30.000Z` |
| timer 实际回调 | `2026-08-10T08:02:00.000Z` |
| summary `measuredThroughAt` | `2026-08-10T08:01:30.000Z` |
| summary `cumulativeEffectiveMs` | `90000` |
| 服务端结果 | accepted；pending 被删除 |
| 服务端 session/history | 均在 `08:01:30` 以 `lease_ended` 关闭 |

日志：`/tmp/g5-vr-retest-c1-integrated.log`，SHA-256 `3d5dc6be8848c538b6c2f23b29a6d91055c634c41c1f6f749e760f42cca80caa`。

实现落点：`leaseController.js:61-72,93-138,176-179` 传递并钳制权威 `invalidatedAtMs`；`coordinator.js:117-132` 用 `pointAtWallBoundary()` 构造双时钟截止点。

### 5.2 邻接回归

- renew 成功后 deadline 更新为新 `expiresAt`。
- 显式 `LEASE_CONFLICT/LEASE_REQUIRED` 以实际更早时刻 invalid，不延长至旧 expiry。
- 北京时间 04:00 先结束旧 session，再建立新 session。
- 双时钟、移动来源、连续停留与 300 秒上限均通过。
- client clock/activity/lease/coordinator/pending focused 36/36 通过。

结论：原 P1-03 **CLOSED**。

## 6. C2 — CLOSED

独立内存端口重放结果：

- 511→512：`count=512/full=true` 时立即 `segmentActive=false`、`pendingCapacity.blocked=true`、可见错误为 `PENDING_STORE_FULL`；再前进 10 秒累计保持 `10000ms`。
- 精确 2 MiB：`bytes=2097152/full=true` 时同样立即停表；再前进 10 秒累计不增长。
- 排空至 410 条（80.078%）仍 blocked；到 409 条（79.883%）才恢复 `segmentActive=true`。
- 在线新 revision 的独立调用顺序为 `put` 后 `submit`。

日志：`/tmp/g5-vr-retest-c2-independent.log`，SHA-256 `6b88043c3cd7ae96973b03fd5f61f23c474f44294d84a24ab7b2fe3affab0b90`。

正式 IndexedDB 回归还验证组织/学生/工作空间/可信设备的 scope key 相互隔离，同 revision 重放/冲突与请求前事务不回归。实现落点为 `pendingQueue.js:64-86` 的 `usageAfterDrain`，以及 `coordinator.js:207-226,255-264,441-449` 的容量状态协调。

结论：原 P1-04 **CLOSED**。

## 7. 命令矩阵

| 命令/范围 | 结果 | 日志 SHA-256 |
| --- | --- | --- |
| S1/S2 server targeted：public summary、library、monitoring、eye-care bridge、HTTP integration | 37/37 PASS | `fdd55ab5a1e813d83c00871533c72c196162bfa2d4bf60f07068d27d58785698` |
| S1/S2/C1/C2 client targeted：lease、coordinator、pending、library parser、completion semantics | 31/31 PASS | `8be3ffa0ff72b3f6b6742e644f3289747c3d0479bf98f1cb34c9e693209489d4` |
| clock/activity/lease/coordinator/pending focused | 36/36 PASS | `fdfbb90e04fb0024b0a88d024e72f354b1df89ac71bc48dec19c698a12b75c27` |
| monitoring/HTTP/eye-care/cleanup focused | 18/18 PASS | `7fa6af032eb1bb7c4ddfb043e9afe11e3386a1f8119d5b73041f2367a12ed249` |
| `npm run test:frontend` | 157/157 PASS；fail/skipped/todo 0 | `e822b90a24678315476f25f89a3e0c0dfb7ebbdd2d32102a031c090adb3fb485` |
| `npm run test:server` | 165/165 PASS；fail/skipped/todo 0 | `ef03e624b9f74d0e77b146e7c50fc006034e78b6ffd06d64e5739c710af879ee` |
| `npm run build` | PASS；1737 modules；1.78s | `d301c62af0a131ff826f3ae86f9ad501e7904ea0d99fe494e24d3ab80e232da6` |
| runtime import/storage scan | PASS；forbidden/storage 为空，仅放行 pendingStore IndexedDB | `23a231eb24d4b59e5da794faa5e830ddba33d0a1597553e1c6fc408620ef9aa6` |

build 仍有既知 P2：`vendor-icons-DwfL3uyf.js` 776.44kB（gzip 135.05kB）超过 500kB；本轮无新增 build warning。

## 8. 反向扫描分类

- S1 生产命中只剩 reports/public sanitizer denylist；但 denylist 的缺项由真实内部反例证明，不能因源码里没有 `percent` 字样而判 PASS。
- S2 的 `library-objects.js` 生产命中 `pageNo/eventType` 均属于书签、摘录、批注及审计事件；没有旧 `reading_events` 足迹查询。测试中的 `reading_events/footprints` 是隔离负例和护眼保留断言。
- `src/student/data/*`、`src/console/data/fixtures/*` 的 `finished/startedBooks/percent/ranking` 仍为 runtime graph 不可达历史；继续作为 P2 误导入风险，不判生产失败。
- 合法百分比仍包括 5 分钟打卡阈值、额度、成长等级和教学安排；不属于书籍完成度。
- 未发现 localStorage/sessionStorage；唯一 IndexedDB 为 `src/student/reading-monitor/pendingStore.js`。

最终状态：**S2/C1/C2 CLOSED；S1 FAIL，owner I-S。**
