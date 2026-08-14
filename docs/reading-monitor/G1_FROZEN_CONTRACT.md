# 简化版阅读监测 G1 冻结契约

> 契约版本：`reading-monitor-g1-freeze-v1.0`
>
> 冻结日期：2026-08-10
>
> 维护者：主控 Agent
>
> 状态：AV-0 候选；通过 AV-0 后供 B、C、U、I 直接实施

## 1. 使用规则

本文件解决需求包与现有正式 v3 源码之间的实施歧义。需求正文仍按 `IMPLEMENTATION_CONTROL.md` 第 1 节的权威顺序执行；本文件只冻结正文未单义规定、样例遗漏或相互冲突的部分。

- B、C、U 不自行扩展字段、兼容旧 DTO 或改变状态枚举。
- 需要改变本文件时，先停止受影响写入任务并回报主控；只有主控修改此文件。
- 不以旧接口缺字段补 0、fixture、旧事件兜底或双写维持表面兼容。
- 本文件所称“完成”只表示契约已冻结，不表示生产实现已完成。

## 2. G1 冲突决议

| ID | 冻结决议 | 覆盖的歧义 |
| --- | --- | --- |
| D-01 | 摘要请求新增必填 `leaseId` | 请求样例遗漏租约，但会话必须保存 `lease_id_at_start` |
| D-02 | 会话持久化所有已接受 revision 的指纹映射 | 只存 `latest_fingerprint` 无法判断旧 revision 异内容冲突 |
| D-03 | `accepted`、`replayed`、`superseded` 都是该 revision 的终态确认，客户端可删除对应待确认项 | `03` 只允许前两者删除，与 `04/06` 的 `superseded` 成功语义冲突 |
| D-04 | `/self` 和 `/scope` 严格切换到新 DTO，不扩展旧 DTO | 新需求禁止旧复杂统计，旧消费者由 I 显式迁移或删除 |
| D-05 | 双页稳定视图的 `mainPageNo` 为可见页中最小页码 | 现有 Reader 用右页推百分比，单双页语义不稳定 |
| D-06 | IndexedDB 只允许出现在 `pendingStore.js`；继续全局禁止 localStorage/sessionStorage | 原门禁禁止全部业务存储，但请求前原子持久化是硬需求 |
| D-07 | 待确认区最多 512 条或 2 MiB；达到 80% 立即尝试排空，达到上限后停止新增有效累计并显式报错 | 需求要求安全上限但没有数值；不能丢 revision 或静默覆盖 |
| D-08 | 当前有效班级名单作为七日分母；历史事实仍按 `class_id_at_creation` | 当前模型没有可靠成员历史，需求允许当前名单口径 |
| D-09 | 账号删除本轮实现 reading-domain 删除 primitive 和事务测试；不额外发明通用账号注销 HTTP 产品流程 | 当前 identity 域没有账号注销 API；本轮只承担新事实的删除义务 |
| D-10 | 超过六个日历月保留窗口的旧摘要拒绝，不建立 tombstone | 防止清理后旧 pending 重建会话并重复计时 |

## 3. 持久化模型

### 3.1 迁移

唯一新增迁移：

```text
server/db/migrations/043_reading_session_summaries.sql
```

不得复用旧 `reading_sessions`，不得引入旧工作区 `016_reading_behavior_facts.sql`，不得修改已执行迁移。

### 3.2 `reading_summary_sessions`

冻结字段：

```text
id TEXT PRIMARY KEY
organization_id_at_creation TEXT NOT NULL
actor_id_at_creation TEXT NOT NULL
workspace_id_at_creation TEXT NOT NULL
class_id_at_creation TEXT NOT NULL
device_id TEXT NOT NULL
book_version_id TEXT NOT NULL
lease_id_at_start TEXT NOT NULL
stat_date TEXT NOT NULL
started_at TEXT NOT NULL
latest_revision INTEGER NOT NULL
latest_fingerprint TEXT NOT NULL
revision_fingerprints_json TEXT NOT NULL
cumulative_effective_ms INTEGER NOT NULL
had_skip INTEGER NOT NULL
had_reread INTEGER NOT NULL
last_page_no INTEGER NOT NULL
measured_through_at TEXT NOT NULL
ended_at TEXT
end_reason TEXT
status TEXT NOT NULL
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
version INTEGER NOT NULL
```

约束：

- `latest_revision >= 1`；新会话只接受 revision 1。
- 时长范围为 `0..9007199254740991`；布尔只允许 0/1；页码为正且不超过版本页数。
- 指纹为 64 位小写十六进制；`revision_fingerprints_json` 为 JSON object，键是十进制 revision，值是指纹。
- `status` 只允许 `open/closed`。拒绝不落 blocked 事实，账号删除执行硬删除。
- `open` 时 `ended_at/end_reason` 都为空；`closed` 时都非空。
- `end_reason` 只允许需求定义的 8 个枚举。
- 组织、学生、工作空间、班级、设备、书籍版本、开始租约、统计日和开始时间不可变。
- revision 必须连续；累计、测量截止、布尔和关闭状态只能单调前进。
- 每个组织内同一学生最多一个 open 摘要会话。
- 因 `reader_close/identity_change/workspace_change/book_change/stat_date_change` 关闭后不接受新修订。
- 因 `lease_ended/lease_taken_over` 被服务端关闭时，允许按第 4.3 节接受测量范围完全落在租约合法截止前的连续晚到 revision；会话保持服务端权威关闭状态。

索引至少包括：

```text
UNIQUE (organization_id_at_creation, actor_id_at_creation) WHERE status = 'open'
(organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation, stat_date)
(organization_id_at_creation, actor_id_at_creation, updated_at)
(lease_id_at_start)
(status, ended_at)
```

使用现有组合外键约束组织范围；若 `classes(id, organization_id)` 尚无唯一索引，由 043 在建表前补齐。

### 3.3 `reading_daily_book_summaries`

冻结字段沿用需求 `04`，唯一键严格为：

```text
organization_id_at_creation
+ actor_id_at_creation
+ workspace_id_at_creation
+ class_id_at_creation
+ book_version_id
+ stat_date
```

索引至少包括：

```text
(organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation, stat_date)
(organization_id_at_creation, class_id_at_creation, stat_date, actor_id_at_creation)
(organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation, book_version_id, stat_date)
(organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation, last_read_at DESC)
(organization_id_at_creation, stat_date)
```

时长、布尔和 `last_read_at` 只能单调前进；范围与统计日不可变。每次 accepted 修订与会话、每日汇总、`reading_progress.last_page_no` 在同一事务更新。

跨 session 乱序晚到时，delta 和行为布尔仍正常累加/OR，但位置只能条件更新：incoming `measuredThroughAt` 晚于当前 `last_read_at` 时，同时更新 `last_read_at/last_page_no`；早于时两者都不改；精确相同毫秒时仅当 incoming `lastPageNo` 更大才更新页码，作为不依赖到达顺序的稳定同值规则。`reading_progress.updated_from_event_at` 在新摘要路径中承载最近位置测量时间（字段名保留为遗留兼容），并使用同一时间/页码条件更新；摘要路径不更新其 `valid_reading_seconds`。必须覆盖“新 session 已到、旧 session 后到不回退页码”的测试。

`reading_progress.valid_reading_seconds` 变为遗留字段，不再是阅读监测真值或展示来源。

### 3.4 保留与删除

- closed 会话按六个日历月硬删除；过期 open 会话先受控关闭。
- 每日书籍汇总本版本不自动过期，至少保留一学年；最终期限未确认前不实现猜测性清理。
- 请求的 `startedAt` 或 `measuredThroughAt` 已超出六个日历月窗口时返回 `VALIDATION_FAILED`，不得重建已清理会话。
- reading-domain 账号删除 primitive 在一个受控事务中删除该学生的新会话、每日汇总和 `reading_progress`，不得影响其他主体或组织。

B 必须提供可注入 `now` 的受控 cleanup primitive 和边界测试，不要求本轮新增后台定时器。cutoff 以 Asia/Shanghai 本地时刻向前减六个日历月计算，月末日期按目标月最后一天收敛，再转为 UTC；`ended_at < cutoff` 才删除，恰好等于 cutoff 保留。primitive 在同一受控事务中先把已由租约 history 明确结束、但仍为 open 的会话按权威租约截止/原因关闭，再删除早于 cutoff 的 closed 会话；缺失合法租约 history 的异常 open 行不得猜测删除，必须显式报告。重复执行结果相同。

I 在 AV-1 后为该 primitive 接一个显式生产维护命令（建议 `server/scripts/reading-monitor-cleanup.js` 加 package script），读取正式数据库配置，成功输出 cutoff/关闭数/删除数，失败非零退出；不新增常驻后台定时器。AV-2 必须实际调用该命令验证 cutoff 和幂等，不能只验证领域函数。

## 4. 写入与租约契约

### 4.1 续租

```text
POST /reading/lease/:leaseId/renew
Idempotency-Key: required
body: { "schemaVersion": 1, "bookVersionId": "..." }
```

- TTL 固定 90 秒；客户端在剩余 30 秒进入续租窗口，可在剩余 15 秒和 5 秒重试。
- 服务端允许尚未过期的合法租约提前续租；新 `expiresAt = serverNow + 90s`。
- 组织、学生、工作空间和设备来自可信上下文；请求不得覆盖。
- 续租只允许原 lease、原范围、原设备和原书籍版本。
- 已过期不能复活，返回 `LEASE_REQUIRED`；接管、错设备、错工作空间或错书返回 `LEASE_CONFLICT`。
- 返回 `{ leaseId, renewedAt, expiresAt }`。
- 历史合法摘要可在租约接管/过期后重试或首次晚到；`measuredThroughAt` 必须落在该租约的合法 history 范围内。
- 获取租约时，精确相同范围可返回当前租约；范围或书变化必须关闭旧租约并创建新 lease ID；只有 `/renew` 延长原租约。
- takeover 必须关闭旧租约及其 open 摘要会话。

### 4.2 摘要请求

路由：

```text
POST /reading/session-summaries
Idempotency-Key: required
```

请求严格使用需求 `04` 的字段，并在 `revision` 后新增：

```json
"leaseId": "lease-id"
```

不接受未知字段。时间必须已经是精确 `YYYY-MM-DDTHH:mm:ss.sssZ`；服务端不静默规范化。组织、学生、工作空间、班级和设备只从可信请求上下文及租约解析。

时间和累计不变量：

- `startedAt <= measuredThroughAt <= endedAt`（若有 endedAt）。
- `cumulativeEffectiveMs <= measuredThroughAt - startedAt`，服务端不能从累计摘要复原每个 300 秒连续段，但必须拒绝超过会话墙钟跨度的累计。
- `statDateFor(startedAt)` 与 `statDateFor(measuredThroughAt)` 都必须等于请求 `statDate`，统计日按 Asia/Shanghai 04:00 切换。
- `endedAt` 通常也属于同一统计日；仅 `endReason=stat_date_change` 时允许它精确落在下一统计日 04:00 边界。
- 任一客户端时间晚于服务端 `now + 120000ms` 返回 `FUTURE_TIME_REJECTED`；两分钟偏差沿用当前基线容忍值，不自动改写时间。
- 测量范围必须落在 `leaseId` 的合法 history 内；超出六个日历月接受窗口按第 3.4 节拒绝。

规范指纹：

```text
sha256(UTF8(JSON.stringify([
  schemaVersion,
  sessionId,
  revision,
  leaseId,
  bookVersionId,
  statDate,
  startedAt,
  measuredThroughAt,
  cumulativeEffectiveMs,
  hadSkip,
  hadReread,
  lastPageNo,
  endedAt,
  endReason
])))
```

服务端重算；请求指纹不匹配返回 `VALIDATION_FAILED`。

### 4.3 revision 状态机

| 条件 | 结果 |
| --- | --- |
| 会话不存在、revision=1 且租约仍有效 | `accepted`，创建 open |
| 会话不存在、revision=1 且旧租约因结束/接管已有合法 history 截止 | `accepted`，按权威截止/原因直接创建 closed |
| revision=latest+1 且全部单调 | `accepted` |
| revision=latest 且指纹相同 | `replayed` |
| revision<latest 且历史指纹相同 | `superseded` |
| 任意已出现 revision 指纹不同 | `REVISION_CONFLICT` |
| revision>latest+1 | `REVISION_GAP` |
| 累计、布尔、测量时间或关闭状态倒退 | `SUMMARY_REGRESSION` |
| 非租约原因 closed 会话出现新 revision | `SUMMARY_REGRESSION` |
| `lease_ended/lease_taken_over` closed 会话收到连续 revision，且完整测量范围不晚于权威租约截止 | `accepted`，只推进客户端累计字段，保留服务端关闭时间/原因 |
| 上述晚到 revision 的测量截止超过权威租约截止 | `LEASE_CONFLICT` |

租约结束/接管的关闭动作不伪造客户端 revision，也不改指纹历史；服务端记录权威 `ended_at/end_reason`。随后可按顺序接受一个或多个已原子持久化、但尚未送达的 revision，只要每个 revision 的完整测量范围都不晚于租约 history 截止。请求中的 `endedAt` 可以为空；若提供则不得晚于权威截止。物化会话始终保留服务端 `lease_ended/lease_taken_over` 关闭状态。其他关闭原因不适用该例外。

若旧租约已经 `lease_ended/lease_taken_over`、但 session 行尚不存在，合法的首次晚到 revision 1 直接创建 `closed` 会话：`ended_at` 使用租约 history 的权威截止，`end_reason` 使用对应租约关闭原因，绝不短暂创建 open。其后 revision 仍按连续、单调和截止前规则接受。若租约仍有效，首次 revision 1 才创建 open 会话。这样旧租约的晚到事实不会占用“每个学生最多一个 open 会话”索引，也不会阻止新租约的新会话。

`replayed/superseded` 不更新任何表或版本。成功数据固定为：

```json
{
  "sessionId": "...",
  "revision": 2,
  "latestRevision": 4,
  "result": "superseded",
  "cumulativeEffectiveMs": 720000,
  "dailySummaryUpdatedAt": "..."
}
```

`accepted/replayed/superseded` 都允许客户端删除该 revision 待确认记录。冲突、权限和租约错误必须保留记录并显式呈现。

### 4.4 错误到 HTTP

| 错误 | HTTP |
| --- | ---: |
| `VALIDATION_FAILED` | 422 |
| `PERMISSION_DENIED` | 403 |
| `RESOURCE_NOT_FOUND` | 404 |
| `LEASE_REQUIRED` | 409 |
| `LEASE_CONFLICT` | 409 |
| `REVISION_GAP` | 409 |
| `REVISION_CONFLICT` | 409 |
| `SUMMARY_REGRESSION` | 409 |
| `STAT_DATE_MISMATCH` | 409 |
| `FUTURE_TIME_REJECTED` | 422 |

所有响应沿用现有 envelope 并带 request ID。

## 5. 查询契约

### 5.1 `/reading/statistics/self`

严格使用需求 `04` 第 7 节的新 DTO，不返回旧 `total/week/byBook/recentReading/levelInput/eyeCare`，不增加上周具体值或行为布尔。

- 无汇总：今日 0、未打卡、remaining 300、streak 0、`no_baseline`、`dataUpdatedAt=null`、`lastReading=null`。
- `remainingSeconds` 对剩余毫秒向上取整；今日总时长秒数向下取整。
- `lastReading` 只取当前学生、当前工作空间内最近且仍可访问的真实书籍版本；不可访问时找下一条，否则 null。
- `lastReading` 非空时字段完整，不返回半对象。
- 旧 Me/Usage/Level/Footprint 等消费者不得靠缺字段补 0。I 必须显式迁移、删除旧统计块或改用仍有权威来源的非阅读监测数据。

稳定继续阅读 URL：

```text
/student/reader/:bookId?versionId=...&pageNo=...
```

必须打开准确书籍版本和页码；不允许静默换成另一版本。

I/U 只负责构造该 URL；C 在 Reader 中严格解析 `versionId/pageNo`。缺少 query 时才使用当前可访问版本与权威最近位置；显式 version 不存在/不可访问、version 不属于 path book、page 非整数或越界时进入明确错误态，不得静默换版本、夹取页码或回到第 1 页。该解析和负例属于 C 的 G3-02，并在 W1 完成。

### 5.2 `/reading/statistics/scope`

严格使用需求 `04` 第 8 节 DTO。只接受必填 `classId`、`statDate`；搜索和四种筛选在前端完成。

- class 不属于当前组织：404；同组织但无权限：403。
- student 禁止；teacher、grade_manager、school_admin 按现有 `reading.read_scope`；platform ops 不自动获权。
- `trend` 和每名学生 `recentDays` 恰好 7 项，按统计日升序，最后一项为请求日期。
- students 使用当前有效班级名单，按规范化 `displayName` + `studentId` 稳定排序，绝不按时长或状态竞争排序。
- 空班级的 rate/perCapita 为 null，其余人数/总秒数为 0，students 为空，trend 仍补齐 7 日。
- rate 使用 `round(checked*10000/active)`；人均先在毫秒上四舍五入，再向下输出整秒。
- 上周总值 0 时 total/dailyAverage 为 0、todayDelta=null、state=`no_baseline`。
- `dataUpdatedAt` 为参与响应的每日汇总最大 `updated_at`，无事实为 null。
- 行为只返回学生级布尔与班级人数，不返回次数、页码、证据或诊断性文字。
- 历史 numerator 按 `class_id_at_creation`，七日分母暂用当前名单；不钳制由此可能超过 100% 的历史比率。
- StudentDetail 如保留阅读数据，只从所选班级 scope 的对应学生项读取；BookDetail 的旧统计块删除。

## 6. 客户端采集与待确认区

### 6.1 稳定视图和动作来源

`mainPageNo`：单页为当前页，双页为可见页中的最小页。布局变化本身不产生跳读/回读。

所有 Reader 位置变化必须带来源：

```text
student_adjacent
student_jump
restore_position
teacher_sync
layout_change
system_restore
```

只有 `student_adjacent` 和 `student_jump` 进入学生行为判断；恢复、教师同步、布局和系统恢复均不得形成跳读/回读。

### 6.2 有效停留和交互

- 仅在 Reader 就绪、视图稳定、租约有效且 `document.visibilityState === 'visible'` 时累计。
- 浏览器不能可靠证明物理亮屏；新摘要不发送 `screenOn`。旧护眼事件只能把当时的可见性作为代理信号，不得硬编码 true 或声称是物理亮屏证明。
- `hidden`、`pagehide`、`freeze`、身份/工作空间/书籍/统计日变化立即切段并先持久化。
- 单段最多 300,000ms；选文、摘录、批注、书签和 AI 真正提交才算确认交互并可重开段，仅打开面板或输入不算。
- 跳读与回读严格按需求 `03`；移动来源不是学生动作时必须重置/忽略候选。

### 6.3 IndexedDB 和队列

- 唯一持久化实现为 `src/student/reading-monitor/pendingStore.js`；测试门禁只精确放行该文件的 IndexedDB。
- 按组织、学生、工作空间和可信设备隔离；请求前原子写入，再进入串行发送。
- 上限为 512 条或序列化后 2 MiB，以先到者为准；80% 时立即触发 drain。
- 到达上限且无法排空时，停止新增有效累计并显示可操作错误；不丢、覆盖、跨 session 合并或跳过 revision。
- 网络失败保留并重试；权限、租约、范围、revision 冲突保留并显式错误。
- 只有 `accepted/replayed/superseded` 删除对应记录。

## 7. 旧链路与唯一真值

| 数据 | 正式切换后的唯一来源/用途 |
| --- | --- |
| 阅读时长、打卡、连续天数、趋势 | `reading_daily_book_summaries` |
| skip/reread | 每日书籍汇总布尔 |
| session revision/累计/结束 | `reading_summary_sessions` |
| 最近位置 | 会话摘要 → 每日汇总 → `reading_progress.last_page_no` |
| 护眼用眼区间/连续用眼 | 旧事件的 `valid_eye_seconds` → eye-care 聚合 |
| 旧事件 `valid_reading_seconds` | 遗留，正式切换后固定 0 且不再读取 |
| `reading_progress.valid_reading_seconds` | 遗留，不再读取或展示 |

- `/reading/events/batch` 暂保留为护眼输入；事件 ingest 只重算 eye-care，不重算阅读 progress。
- 新摘要事务更新 `reading_progress.last_page_no`。
- 新 statistics 查询禁止读取 `reading_events`。
- `projectBooks`、`projectReadingProgress`、`projectUsageSummary` 不再从旧时长列提供阅读监测值。
- 不建立“摘要失败则写旧统计”的兜底；不能双写新统计。

切换分两步且必须串行：AV-1 通过后先由 B 修改其独占的 `server/domains/reading/catalog.js`，使新进入旧事件的 `valid_reading_seconds=0` 并停止 `recomputeReadingProgress`，同时保留 `valid_eye_seconds` 和 eye-care 重算；B 交接后再由 I 清理共享投影、API 和页面的旧读取。G5-01 的写侧负责人因此是 B，不是 I。

## 8. 页码和完成度清理

`last_page_no` 只表示上次停留位置。不得由其推导百分比、finished、已读页数、读完书籍数或 AI 已覆盖页面范围。

I 的 G4-11 及 B 完成 G5-01 后的读侧波次必须统一清理：

- 服务端：`server/integration/projections.js`、`server/domains/reports/index.js`、`server/http/public-summary-page.js`、`server/integration/ai-runtime.js`。
- 共享前端：`src/adapters/student.js`、`usePersonalReadingAdapter.js`、Progress、BookCard、Shelf、BookDetail、Footprint、Me、ListDetail、Ranking、教师 BookLibrary/BookDetail 和报告消费。
- Reader 内的百分比由 C 清理，底栏只显示“第 X 页 / 共 Y 页”，不画完成度条。
- AI 只使用当前明确页/用户选文范围，不把最后位置解释为此前全部页面已读。
- 历史不可达模块不为本期迁移；AV-2 只确认其仍不在生产模块图。

必须新增“直接跳到最后一页仍不产生 finished/100%/pagesRead”的服务端投影/API与前端 adapter 双层回归。

## 9. 精确文件所有权

### B

```text
server/db/migrations/043_reading_session_summaries.sql
server/domains/reading/monitoring.js
server/domains/reading/catalog.js
server/domains/reading/statistics.js
server/domains/reading/sql.js（确有必要时）
tests/server/db/reading-monitor-migration.test.js
tests/server/reading/reading-monitoring.test.js
tests/server/reading/statistics.test.js
tests/server/reading/p1-release-blockers.test.js
tests/server/reading/reading-teaching-bridge.test.js
```

B 不修改 router、前端和控制文档。

### C

```text
src/student/reading-monitor/**
src/student/state/useReadingTelemetry.js
src/student/pages/Reader.jsx
src/student/components/AiPanel.jsx
src/student/state/useStudentReaderPages.js
tests/frontend/reading-telemetry-sequence.test.mjs
tests/frontend/reading-monitor-client-*.test.mjs
tests/frontend/runtime-import-scan.mjs（首轮只改 IndexedDB 精确放行）
tests/frontend/api-contract.test.mjs（首轮只改存储门禁）
tests/frontend/console-zero-fixture.test.mjs（首轮只改存储门禁）
```

Reader 的百分比清理由 C 完成；I-S/I-F 不再修改 Reader。上述三个共享门禁测试在 C 首轮交接后转交 I-F；U 在任何波次都不修改。

### U

```text
src/student/components/reading-monitor/**
src/console/components/reading-monitor/**
src/student/pages/Home.jsx
src/console/pages/ClassOverview.jsx
组件专属 CSS module
tests/frontend/reading-monitor-ui-*.test.mjs
tests/frontend/console-live-reading-eyecare-pages.test.mjs
```

U 不修改 API、状态 hook、Reader、全局路由和 `src/index.css`。

### I-S（G5-01 交接后，与 I-F 并行）

```text
server/http/integration-router.js
server/integration/projections.js
server/integration/ai-runtime.js
server/domains/reports/index.js
server/http/public-summary-page.js
server/domains/reading/library-objects.js
server/scripts/reading-monitor-cleanup.js
package.json / server/package.json（只限 cleanup 命令）
受上述文件影响的 server tests
```

I-S 不修改 `catalog.js/monitoring.js/statistics.js/043` 或前端。

### I-F（G5-01 交接后，与 I-S 并行）

```text
src/api/student.js
src/api/console.js
src/adapters/student.js
src/student/state/useReadingStatistics.js 或 useDailyReadingBrief.js
src/console/state/useReadingStatistics.js
src/student/state/usePersonalReadingAdapter.js
src/student/components/Progress.jsx
src/student/components/BookCard.jsx
受第 8 节影响的学生/教师页面（明确排除 U 独占的 Home.jsx、ClassOverview.jsx，也排除 C 独占的 Reader.jsx）
src/student/pages/Foundation.jsx（仅机械移除不可达 BookProgress 样例/import，不迁移或启用该历史模块）
src/student/pages/Lists.jsx（仅移除遗留 book.minutes 汇总/展示，不改变书单功能）
src/console/state/useReportsData.js
跨线 API、adapter、路由与完成度测试（C 交接后接管三个存储门禁测试）
```

I-F 不修改 Home、ClassOverview、Reader 或服务端。现有 StudentApp、ConsoleApp 和 navigation 路由满足要求，默认不改；确需变更必须先由主控重新分配。

### V

```text
docs/reading-monitor/validation/**
独立的新需求验收测试和数据构造器
```

V 不修改生产代码。

## 10. 实施波次

### W1：三条独立核心线

AV-0 通过后并行启动：

- B：G2-01～G2-15 与 G2-17。完成迁移、领域写入/查询、六个月 cleanup primitive、B 独占专项测试和 HTTP handler 交接说明；暂不宣称 G2-16 全量回归完成。
- C：G3-01～G3-12。完成纯状态机、IndexedDB 队列、租约控制器、可注入 API 端口和专项测试；暂不做 G3-13 真实共享 API 接入或 G3-14 真全量。
- U：G4-02、G4-05～G4-09。以冻结 DTO 的显式 props 完成纯组件、筛选/排序/抽屉和组件专项测试；不提前完成依赖真实状态的 G4-03/G4-10/G4-12/G4-13。

### W2：AV-1 前的最小集成

W1 三线交接后：

1. I 独占完成 G2-18：摘要、续租、`/self`、`/scope` 的最小 HTTP 路由、共享 API 方法、错误 envelope、adapter/state 端口和 HTTP/API 测试；只做 AV-1 所需接线，不提前切旧写侧或大范围改 UI。
2. I 交接后，C 完成 G3-13 真实摘要/续租 API 接入和 G3-14 客户端专项/真前端全量。
3. 同一波次由 B 在 I 交接后完成 G2-16 后端专项、HTTP 和真服务端全量回归；C 与 B 文件不重叠，可并行。
4. 第三个空槽可由 V 准备 AV-1 数据和独立用例；C/B 都达到 `implemented_unverified` 后执行 AV-1。

这样 AV-1 必验的“真实客户端产生摘要”和 `/self`、`/scope` 已经具备真实 HTTP/API 路径，不依赖验收后的未来接线。

### W3：AV-1 后正式切换与 UI 接线

1. AV-1 通过后，B 执行 G5-01：旧事件写侧 `valid_reading_seconds=0`、停止 reading progress 重算、保留 eye-care。
2. B 交接后并行启动：I-S 完成 G4-14、G5-11、G5-12 的服务端旧读侧/AI/报告/cleanup 命令；I-F 完成 G4-01、G4-04、G4-11 的共享前端状态和旧消费者语义清理。两线文件不重叠。
3. I-F 交接后，U 完成 G4-03、G4-10、G4-12、G4-13 的真实数据、轮询、响应式、可访问性和真全量收口；I-S 可独立继续，不阻塞 U，直至 AV-2 前必须完成。
4. 真实 DTO UI 约 80% 时执行一次 AV-UI；修复后进入 AV-2。

## 11. AV-0 检查点

- D-01～D-10 是否消除全部已知契约冲突；
- B/C/U/I 是否无重叠写入热点；
- G0 真实运行证据是否完整，临时服务是否关闭；
- 旧事件的护眼职责是否保留且新统计唯一真值是否单义；
- IndexedDB 放行是否足够精确；
- 生产开发是否仍无业务代码改动；
- 是否存在必须由用户选择的产品歧义。若无，AV-0 可通过并开始首轮实现。
