# Phase 2：为什么 persistSnapshot 首次之后不再推进

执行时间：2026-08-17（按主控第二次纠正重写；已撤下「有效秒恒 0 / 双页记满额」两条伪缺陷）

约束：未操作浏览器；未改业务代码 / 摘要 schema / 指纹算法；未 commit / push / 切分支；未向库写入诊断用 revision 2。

已采信：`reading_events` 连续到 08:11Z；汇总表冻结在 07:01:16Z revision 1。页码追踪是好的（旧事件到第 5 页再停在第 3 页）。坏的是摘要提交。

---

## 1. 根因结论

**断在「新 coordinator 用新 sessionId 交 revision 1」被 409 拒绝之后：失败项留在 `pendingStore`，后续 drain 被它毒死，原会话的 revision 2 再也到不了服务端。**

不是指纹把 revision 2 当重放。库里**没有**原会话 `5ef8e32c-…` 的 revision 2 请求。第二次摘要的幂等键是另一个会话的 revision 1。

时间线（同一 `deviceId=714f0cc7-…`，同一 `leaseId=0ffaca49-…`）：

| 时刻 (UTC) | 证据 | 含义 |
|---|---|---|
| 06:56:16 | 租约 acquire 200；会话 `5ef8e32c-…` 开始 | 第一任 coordinator |
| 07:01:16 | `POST /reading/session-summaries` 200 `accepted` | 该会话 revision 1 成功，194544 ms，`latest_revision=1` |
| 07:03:12 | **又一次** acquire 200，返回**同一** lease；`page_stay` 到第 5 页 | coordinator **重挂**，`createSession` 换了新 sessionId；旧会话仍 `open` |
| 07:05:13 | 再一次 acquire 200，同一 lease；`page_stay` 到第 3 页 | 又一次重挂（07:03 那任活了约 2 分钟，未挨到 5 分钟 tick） |
| 07:10:13 | 摘要 409 `LEASE_CONFLICT`「当前学生已有其他 open 摘要会话」 | `07:05:13 + 300s`，正是 07:05 那任的**第一次** 5 分钟 tick。新会话 `9392617b-…` revision 1 被拒 |
| 07:19:55 | 又一次同设备 acquire 200（真人段开始） | 再重挂；`start()` 会 `drain()` 队列 |
| 07:20–07:50 | 事件 + 租约续租持续；**无新的摘要幂等键** | 真人 30 分钟本应约 6 次 tick，服务端看不到新 revision |
| 07:33–07:56 | 6 次 acquire 409 `READING_LEASE_HELD` | **另一台设备**来抢租约（`catalog.js` 296–299 仅当 `device_id` 不同才 409） |

断点（按发生顺序）：

1. **重挂换 sessionId，旧会话不关：** `coordinator.js` 187–194 每次 `createSession` 都 `idFactory('reading-session')`；`useReadingTelemetry.js` 244–246 卸载 `close(..., { waitForTerminal: false })`。库里 `5ef8e32c-…` 仍 `status=open`、`ended_at=null`，证明重挂时的 close **没有**把 ended 快照写上去。
2. **服务端拒新 open 会话：** `server/domains/reading/monitoring.js` 731–738。已有 open 会话时，新 `sessionId` 的 revision 1 抛 `LEASE_CONFLICT`。
3. **失败项毒死队列（07:10 之后为何再也看不到新键）：** `pendingQueue.js` 49–52 在 `submitSummary` 抛错时 **保留记录并停止 drain**。409 的 `retryable=false`（`reliability.js` 411–412）再打同一幂等键只回放缓存，**不增加 `attempt_count`**。因此「只有 2 条摘要幂等行」**不能**证明后来没再 HTTP；但可以确定：**没有任何新 sessionId/revision 的键到达服务端**。队列按 `createdAt` 先送 07:10 那条，后面生成的 revision 会被堵住。
4. **409 不会让 `persistSnapshot` throw：** `pendingQueue.js` 90–94 / 81 在 drain 失败时仍 resolve。`coordinator.js` 259–265 会照常 `revisions.commit`。所以「一次 409 掐死 `scheduleSummary`」**不是**这条 409 的机制（168–172 只有 `tickDirect()` **抛错**才不续约）。07:10 之后更像是：**tick 可能还在跳，但 HTTP 被毒丸挡住**；加上 07:03/07:05/07:19 重挂拆掉了原会话的 revision 游标。

`apiPorts.js` 34–38 与事件共用 `createApiClient`，带 `X-Workspace-Id`、`Idempotency-Key`、`credentials: 'include'`。第二次摘要能进幂等表并得到业务 409，头是齐的。

同设备重挂会复用租约：`catalog.js` 301–312，所以续租能一直活到 08:12，看起来「客户端还在」，但摘要会话已经不是原来那个。

---

## 2. 五个取证点

### 2.1 5 分钟 tick 是否还在跳？

定时器：`coordinator.js` `scheduleSummary` 165–175，`setTimeout(..., SUMMARY_INTERVAL_MS)`，`constants.js` 第 6 行 `300_000`。`start()` 346 注册；`stop()` / `clearTimers()` 158–163、`closeDirect` 285 会清掉。

- 第一任：06:56:16 → 07:01:16，正好 5 分钟，tick **当时是活的**。
- 07:03 重挂后第一任被 `stop()`，**不会再有** 07:06 的原会话 revision 2。这就是 `latest_revision` 冻在 1 的直接原因。
- 07:05 那任的第一次 tick 在 07:10:13 **确实跳了**（有 HTTP）。
- 07:10 之后：幂等表没有新键。因 409 回放不改 `attempt_count`，**无法从库判断 tick 是否仍在 setTimeout**。07:19 又一次 `start()` 会重新 `scheduleSummary()`。更稳的判断是：即便 tick 还在，也过不了毒丸队列（见 2.5）。

`Reader.jsx` 79 的 `key` 含 `resolution.pageNo`。无 `?pageNo=` 时 `resolution.pageNo` 来自 `book.progress.currentPage`（`view.js` 85–87）。进度或查询串一变就会拆掉整个 `ReaderView` → 监测重挂。07:03 / 07:05 / 07:19 三次同设备 acquire 已证明 coordinator **确实被重建**（每次新的 acquire 幂等键）。翻页本身走 `setSavedPosition`，**不**改 URL；这三次重挂不是「leaf 没跟上」，而是监测实例被拆掉。

### 2.2 persistSnapshot 是否被调用但提前 return？

提前 return 只有：`!session` / `!tracker`（234）或 `lastPageNo` 非法（237）。提前 return **不会**写 `idempotency_records`。

07:10 已生成指纹并 POST，**不是**提前 return。没有「无变化 / dirty 未置位」分支。

### 2.3 createSummaryRevision 是否生成了 revision 2？

**服务端没收到过任何 revision 2。** 两次幂等键都是 `:1:`：

- `reading-summary:reading-session-5ef8e32c-…:1:41862cd8…` → 200
- `reading-summary:reading-session-9392617b-…:1:3a4ec787…` → 409

`createRevisionCursor`（`summary.js` 109–120）每个新 coordinator 从 1 起。07:10 是**新会话的 revision 1**。`ports.submitSummary`（`apiPorts.js` 34–38）对这一次**确实发了 HTTP**。

原会话若还活着，07:06 本应是它的 revision 2；07:03 重挂把它拆了，游标丢了。

### 2.4 服务端返回什么？是否指纹重放？

第二次原文：

```
status_code: 409
state: failed
failure_code: LEASE_CONFLICT
failure_reason: 当前学生已有其他 open 摘要会话
retryable: 0
response_json: {"error":{"code":"LEASE_CONFLICT","message":"当前学生已有其他 open 摘要会话","retryable":false,"details":{}}}
```

对应 `monitoring.js` 736–738。

**不是** 696–705 的指纹重放（那是 200 + `replayed`/`superseded`，且要求同一 `sessionId`、`revision <= latest_revision`）。原会话 revision 2 从未到达。

### 2.5 pendingStore 里有没有未提交摘要？

`pendingStore.js`：IndexedDB 库名 `readmate-reading-monitor-v1`，store `pending_summaries`。跨重挂共享（不是内存单例）。**当前 agent 禁止操作浏览器，读不到用户机上的实际内容。**

服务端可替代判据：

- 07:10 的 409 按 `pendingQueue.js` 49–52 **会留下**。键形如 `[scope, reading-session-9392617b-…, 1]`。
- 之后没有任何**新**摘要幂等键，与「毒丸挡在队头」完全吻合。07:19 `start()` 的 `coordinator.js` 337 `await queue?.drain()` 若队列里还有这条，会再打同一键、吃缓存 409、后面的新 revision 仍发不出去。
- 因此：07:10 **发了被拒并入队**；之后是 **可能仍在生成，但发不出新键**。这是「没生成」与「发了被拒」之间的中间态，也是区分二者的最快客户端判据。

预测（留给真人核对，不是已读事实）：`pending_summaries` 至少有 `sessionId=9392617b-5058-4d1c-9098-fa76ba02ae86`、`revision=1`。若还有更新的 sessionId / revision≥2，说明 tick 仍在组稿，只是 drain 过不了队头。

---

## 3. 修复建议

**绝不能碰（B-2）：** `summary.js` 42–106 指纹字段集、`canonicalReadingSummaryFingerprint`、`POST /reading/session-summaries` 请求 schema、租约 90s TTL。不要改有效时长算法，不要改事件路径里写死的 `valid_reading_seconds=0`，不要改双页可见覆盖记满额的语义。不要改 `projections.js` / 适配器去「补」页码或分钟。

**建议改（按优先级）：**

1. **`pendingQueue.js` 49–52：** 对 `retryable===false` 的失败（至少 `LEASE_CONFLICT`）移出队头，避免毒死后续 revision。不要在未确认时 `revisions.commit`（`coordinator.js` 261），以免本地游标与服务端脱节。
2. **不要为换页拆监测：** `Reader.jsx` 79 的 `key` 去掉 `resolution.pageNo`（换页已由 `savedPosition` 处理）。`useReadingTelemetry.js` 165–253 的 effect 不要在页码变化时重建 coordinator。
3. **重挂必须先关掉或续写 open 会话：** 卸载改为 `waitForTerminal: true`，或 `start()` 发现本学生已有 open 会话时续同一 `sessionId` 交 `latest_revision+1`，而不是新 id 的 revision 1。
4. **防御：** `coordinator.js` 168–172 即使 `tickDirect()` 抛错也再 `scheduleSummary()`，避免真抛错时停表。

**如何验证：** 同一阅读器连续 >10 分钟且中途翻页，`idempotency_records` 应出现**同一** `sessionId` 的 `:2:` 且 200；`latest_revision>=2`；`last_page_no` 随 `stableView.mainPageNo` 更新。再故意重挂一次，不应再出现新 sessionId 的 409 `LEASE_CONFLICT`。IndexedDB 在成功确认后应被 `remove`。

---

## 4. 真人浏览器最小清单（1 步）

Chrome DevTools → Application → IndexedDB → `readmate-reading-monitor-v1` → `pending_summaries`。

看有没有 `sessionId=9392617b-5058-4d1c-9098-fa76ba02ae86` 且 `revision=1`。有 = 07:10 毒丸仍在，队列解释成立。若还有更新 sessionId，说明 tick 仍在组稿。

不必再静读 6 分钟等 POST——幂等表已证明没有新摘要键；同键回放也看不见新行。不要为诊断向库写入 revision 2。
