# G5 学生与教师真实浏览器独立验收证据

> 执行日期：2026-08-11（Asia/Shanghai）
> 执行角色：V-BR（只验收，不修生产代码或测试）
> 范围：G5-04、G5-05；G5-06 仅做权限冒烟，深权限/删除仍以 V-D 为准
> 候选：多人共享未提交工作树，以本文 SHA-256 标识
> 最终结论：**G5-04 PASS / G5-05 PASS**

## 1. 结论摘要

| 门禁 | 结论 | 摘要 |
| --- | --- | --- |
| G5-04 学生链路 | **PASS** | 新摘要的 `accepted/replayed/superseded`、90 秒租约续租、真实前后台、约 5 分钟周期提交、fresh self、299/300、精确继续阅读 URL、null 去书架及最后页非完成语义均成立。真实翻页曾因旧 `page_turn` 带客户端专用 `source` 被 HTTP 422 拒绝；客户端严格投影修复后，真浏览器批次 200、旧事件 reading=0/eye>0、新摘要/self 与 console/network 最小重验全部通过。 |
| G5-05 教师链路 | **PASS** | 真实 50 人/37 打卡/7 点、4 跳读/8 回读；班级/日期切换、搜索、单筛选、稳定排序、手刷、visible/hidden、stale、桌面/1024/390 抽屉及无障碍均通过。 |

本轮没有 P0。发现 1 项 P1，通知主控并由客户端 owner 最小修复；V-BR 没有修改任何生产代码或测试。修复后的独立最小重验通过，P1 已关闭，无遗留 P0/P1。

## 2. 输入、边界与环境

执行前完整读取：

- `docs/reading-monitor/IMPLEMENTATION_CONTROL.md`
- `docs/reading-monitor/G1_FROZEN_CONTRACT.md`
- 需求包 `README_先看.md`、`01`～`06`
- `AV1_VERTICAL_EVIDENCE_2026-08-10.md`
- `AV1_MINIMAL_RETEST_EVIDENCE_2026-08-10.md`
- `AVUI_EVIDENCE_2026-08-10.md`
- `AVUI_MINIMAL_RETEST_EVIDENCE_2026-08-11.md`

环境：

```text
临时目录：/tmp/readmate-g5-browser.UacQ2A
一次性 DB：/tmp/readmate-g5-browser.UacQ2A/readmate.sqlite
真实 API：127.0.0.1:5191
真实 Vite 代理：127.0.0.1:5190 -> 127.0.0.1:5191
浏览器：系统 Google Chrome 151，--headless=new
CDP：127.0.0.1:9223
隔离 profile：/tmp/readmate-g5-browser.UacQ2A/chrome-profile-*（均为本轮一次性 profile）
```

DB 由真实内部 bootstrap 从零创建，顺序执行 27 个迁移，最高 `043_reading_session_summaries.sql`。API `/health` HTTP 200，requestId `d3c2ef0f-b83a-4250-ba85-4ec36f973342`。当前本地时间早于 04:00，冻结口径下权威统计日是 `2026-08-10`，七点为 `2026-08-04`～`2026-08-10`。

持久产物仅为本文和截图目录；临时 DB、脚本和 profile 全部在 `/tmp`。未执行 commit、push、reset、clean，未接触正式数据库。

### 2.1 候选哈希

最终候选关键文件：

```text
136ccf7212858bf3592e214da5f190673791710a4f28beb625dfe3e23c7cbb91  server/db/migrations/043_reading_session_summaries.sql
a7548905ea5ed7103e244676a7578797fe2b85f5e9906f84ac0583716201d8b1  server/domains/reading/monitoring.js
7b0780a3e807038e02d32809d849fe032d711631f2e1b7ddb0dbe363abc24a4b  server/domains/reading/statistics.js
561c63a8824170b700b8e8458ebbb725dd6b2df35a7b15993e07f83522a9f39f  server/http/integration-router.js
14e0fb5310c14f18c0b6e4affba097829964c60cf218e924b7be04f0b21fca4b  src/student/pages/Reader.jsx
52f33f93416a8b591fc4b8a66b7140e034785ff2d78f32809043e38c6659379c  src/student/state/useReadingTelemetry.js
155fc94be7e4124df265692b521b42721d7cbd9cc9c9ac20267ec3015363f2cc  src/student/pages/Home.jsx
b17d905870ce639701fafee191d5fc8085cc53ee59f6b3864fe1ce55cf24d522  src/console/components/reading-monitor/ReadingStatisticsView.jsx
6031b6e77399634141f9a04ce945ad45216fc61f5addb069c604e5f7b297fc1f  src/console/state/useReadingStatistics.js
078afb84b1ee3c5c7dee9db7022f443b4d7f5a40f2a2480d1b1d9b541d004880  src/api/student.js
fc01ca63d9cb87c5c5283a9156f9f5ee42d6c31424b128474529aeac91e707c8  src/api/console.js
```

验收中途（01:08）客户端 owner 合入了另两项既定 P1 修复，`src/student/reading-monitor/coordinator.js` 从开始时的 `279738e5...` 变为：

```text
b0a3f15fc5f9131ce51638166bb30d00734d57a8034799cb6267bf5649f37d5d  src/student/reading-monitor/coordinator.js
```

因此在新哈希上补跑了受控周期摘要和真实标签页前后台；两者均通过，见 3.4。随后本文 3.6 的 P1 修复使 `useReadingTelemetry.js` 从失败候选的 `f0970d9f...` 变为上列最终哈希 `52f33f93...`；服务端继续保持严格 schema。服务端摘要、统计和 UI 文件哈希未变。

## 3. G5-04 学生真实链路

### 3.1 登录、299/300 与继续阅读

真实 UI 登录后从 Home 读取真实 self：

| 状态 | HTTP/requestId | self 与页面 |
| --- | --- | --- |
| 299 秒 | 200 / `2047726b-441a-43cf-b776-3565efc4b253` | `today=299`、`checked=false`、`remaining=1`、连续 6 天；页面 `4 分 59 秒/还需 1 秒`，progressbar `aria-valuenow=99`。 |
| 300 秒 | 200 / `899b467f-75bc-4c36-b716-3e1d11e8ccf1` | `today=300`、`checked=true`、`remaining=0`、连续 7 天；页面 `5 分钟/已打卡`。 |

`lastReading` 非 null 时，点击“继续阅读”得到精确 URL：

```text
http://127.0.0.1:5190/student/reader/book-cdf0dfa2df2718611c50cba4?versionId=version-cdf0dfa2df2718611c50cba4&pageNo=1
```

即显式带 `versionId` 和 `pageNo`，没有依赖静默 fallback。

### 3.2 真实 Reader 行为、摘要与 fresh self

页面保持真实前台，使用真实阅读偏好切为单页后执行相邻翻页、跳到第 4 页、回到第 1 页、停留 31.2 秒再前进，形成真实跳读与回读。新摘要会话 `reading-session-5e301fa0-78af-467b-8b88-817df21932d2` 的 SQL 终态：

```text
latest_revision=2
cumulative_effective_ms=42671
had_skip=1
had_reread=1
last_page_no=2
status=closed
end_reason=lease_ended
```

- revision 1/2 首次提交均为 HTTP 200 `accepted`，requestId 分别为 `31dcc301-fd00-4eaa-aa50-05cea3286ebe`、`96eef7a6-3c3e-4fee-ab91-e924529da7fa`。
- 原样重交 revision 2：HTTP 200 `replayed`，requestId `43fdb211-2c4e-4b4f-9800-47b83aa6221b`，累计仍 `42671ms`。
- revision 2 已存在后重交 revision 1：HTTP 200 `superseded`，requestId `ccb7b4b9-b15c-47a0-9dba-038999a5452e`，累计仍 `42671ms`。
- 返回详情/主页后发出 fresh self：HTTP 200，requestId `c1d505e8-023e-4e6e-930c-5cdfdf7c2b25`；页面与 DTO 同为 `342s`、已打卡、连续 7 天，最近位置第 3/4 页。

直接跳到最后页及停留后的 Reader 均只显示位置 `第 3 页/第 4 页、共 4 页`，扫描不到 `100%`、`finished`、`pagesRead`、“已读完”或完成百分比。

### 3.3 租约续租与真实前后台

真实前台停留约 5 分钟观察到 5 次 90 秒租约的提前续租，均 HTTP 200：

```text
8fc24328-0d05-4cf8-87c7-c9516732f785
b4dca380-ced7-46fb-843c-5f4951cea4f7
8d40a397-d661-4bf3-ab1a-2c728a198bde
88887da2-1971-41fe-baf3-5802e7636925
be94935b-1de7-460d-be69-dc95fd80edfb
```

另用真实第二标签页切换前后台，未覆盖 `document.visibilityState`：

```text
visible/focused -> hidden/unfocused -> visible/focused
                -> hidden/unfocused -> visible/focused
```

第一次后台提交 accepted r1 `4505ms`，requestId `3b4db26b-40ec-4142-a703-f16a20d5bdc1`；恢复后只累计真实前台约 3.6 秒，第二次后台提交 accepted r2 `8122ms`，requestId `79cec7ff-9a88-46bb-82b6-af4c1b961677`。隐藏停留未计入，正常链 console/runtime/network 为 0。

### 3.4 约 5 分钟周期提交与候选中途变化后的补验

真实页面只对 `setTimeout(300000)` 做受控时钟映射，`300000 -> 8000`；页面、API、DB 均真实。旧候选首次取得 periodic accepted r1 requestId `553aaeef-a722-4e4e-ad1a-4a2a50ef99a5`。

coordinator 哈希变化后再次补验：

- 受控周期：`before=0 / after=1`，HTTP 200 `accepted` r1，requestId `84929773-fc05-4109-b286-24f5eb5ed92e`。
- 真实第二标签页前后台：HTTP 200 `accepted`，requestId `eebc5350-0624-447d-8287-8d5f37220d58`；该真实标签页链 console error 0、network failure 0。

CDP 的 `Page.setWebLifecycleState` 会让 Vite WebSocket 进入 BFCache 且恢复后 `visibilityState` 仍为 hidden，因此不把该人工刺激当作前后台产品证据；前后台结论只取真实第二标签页结果。

### 3.5 null、自权限与 SQL 收口

独立学生 `g5-student-50` 的 self HTTP 200，requestId `8bf8f036-aa6c-4522-ad64-86e4f0ba64d3`：

```text
todayEffectiveReadingSeconds=0
checkIn.checked=false
streakDays=0
comparisonState=no_baseline
dataUpdatedAt=null
lastReading=null
```

页面显示“还没有可继续的最近书籍”，点击“去书架看看”到 `/student/shelf`，console/runtime/network 为 0。学生访问教师 scope 为 HTTP 403 `PERMISSION_DENIED`，requestId `38ada2e6-5c09-47cc-ac72-3047903ae031`。

所有 takeover/close 后：

```text
SELECT COUNT(*) FROM reading_summary_sessions WHERE status='open';
0
```

### 3.6 P1：真实翻页旧事件批次被严格 schema 拒绝

**复现（当前候选、独立 profile、真实 Reader）：**学生 UI 登录，显式 URL 打开第 1 页，单页模式点击“下一页”。浏览器实际发送：

```json
{
  "events": [
    {
      "eventType": "page_stay",
      "pageNo": 1,
      "durationMs": 5132,
      "payload": {}
    },
    {
      "eventType": "page_turn",
      "pageNo": 2,
      "durationMs": 0,
      "payload": {
        "fromPageNo": 1,
        "direction": "next",
        "source": "student_adjacent"
      }
    }
  ]
}
```

实际响应：

```text
POST /api/v1/reading/events/batch
HTTP 422
X-Request-Id: 2c624411-e67a-49e7-929b-cf9aa7df40ac
code: VALIDATION_FAILED
message: event.payload(page_turn) 包含未知字段: source
```

DB 中累计留下 6 条同类失败 `student-reading-batch-*` 幂等记录；每次真实翻页都稳定复现。精确错配：

- `src/student/state/useReadingTelemetry.js:117`～`:132` 把新 monitor 的 movement `source` 放入旧 `page_turn.payload`；
- `server/domains/reading/catalog.js:29` 的冻结旧事件 schema 只允许 `fromPageNo`、`direction`、`blockId`。

预期是旧事件只继续作为护眼输入，且服务端保持严格 schema；客户端应严格投影旧 payload，不把新 monitor 字段带入。实际为整个批次 422，故同批真实 `5132ms page_stay` 也未入库，产生产品 API console error 并丢失护眼输入。新 session summary 仍成功，故新阅读统计真值未双写或回退，但关键学生浏览器链不能通过。

**严重性：P1；owner：客户端 C。修复前 G5-04 为 FAIL；独立最小重验通过后已关闭，见第 6 节。**

## 4. G5-05 教师真实链路

### 4.1 scope、聚合与 UI

真实 principal 登录并打开班级阅读统计，主 scope HTTP 200，requestId `077baa61-4e7a-4834-a471-edbfa9490366`：

```text
activeStudentCount=50
students.length=50
trend.length=7
checkedInStudentCount=37
checkInRateBasisPoints=7400
totalEffectiveReadingSeconds=14741
perCapitaEffectiveReadingSeconds=294
skipStudentCount=4
rereadStudentCount=8
```

同一采样点 SQL 与 UI 精确为 `37/50`、`74%`、`4分54秒`、`4人`、`8人`；七点为 `62/64/66/68/70/72/74%`，日期从 08/04 到 08/10。零时长学生仍进 50 人分母。

### 4.2 查询、切换与刷新

| 项目 | 结果 |
| --- | --- |
| 搜索“安然” | `2/50`；服务端稳定同名次序 `g5-student-02`、`g5-student-03`。 |
| 单筛选“未打卡” | `13/50`，同时包含 `<300s` 与 0 秒学生。 |
| 班级切换 | `internal-demo-class -> g5-class-b -> internal-demo-class`，UI/请求同步。 |
| 日期切换 | `2026-08-10 -> 2026-08-09 -> 2026-08-10`，UI/请求同步。 |
| 手动刷新 | scope 请求计数 `11 -> 13`；其中一次与受控自动轮询相邻，仍证明点击触发请求。 |
| 5 分钟轮询 | 只映射 `setInterval(300000) -> 2000`，计数 `13 -> 14`。 |
| hidden/visible | 真实第二标签页：`beforeHidden=14`、隐藏 4.5 秒后仍 `14`、恢复可见立即 `15`。 |
| stale | 阻断下一次 scope 后保留旧 `37/50`，显示“上一次成功读取”；解除阻断并刷新恢复 ready。 |

### 4.3 三档视口与抽屉

| 视口 | dialog rect | client/scroll | wheel 后 scrollTop | Escape 后焦点 |
| --- | --- | --- | --- | --- |
| 1440×1000 | `(908,12)-(1428,988)`，520×976 | 974/1037 | `0 -> 63` | 原“查看”按钮 |
| 1024×768 | `(492,12)-(1012,756)`，520×744 | 742/1037 | `0 -> 295` | 原“查看”按钮 |
| 390×844 | `(0,0)-(390,844)`，390×844 | 842/1228 | `0 -> 386` | 原可见学生卡按钮 |

三档均满足：dialog 在 viewport 内、portal 直属 body、`aria-modal=true`、有效 labelledby/describedby；唯一可聚焦关闭按钮的 Tab/Shift+Tab 均圈定；Escape 关闭；背景 `.console-scroll` 在抽屉期间 `overflow=hidden` 且 `scrollTop` 始终为 0。窄屏第一次验收脚本误选了隐藏桌面行按钮；只修 `/tmp` 脚本为选择可见触发器后复跑，焦点正确返回可见学生卡，这不是产品缺陷。

### 4.4 权限、禁用语义与诊断

- 同组织、非工作区班级：HTTP 403 `PERMISSION_DENIED`，requestId `0628ce9e-e051-4616-936f-a8c681ad7b7e`。
- 跨组织班级：HTTP 404 `RESOURCE_NOT_FOUND`，requestId `fd9bd388-2591-442c-bf5b-230884fc09e0`，响应不泄露数据。
- 主页面/三档抽屉/筛选/stale 扫描均没有排行榜、最快/最慢、阅读速度、热点、待补、异常停留、页面证据、完成百分比、`finished`、`pagesRead` 或“已读完”。姓名排序说明明确“不构成学生竞争性比较”。
- 教师 ready 正常态无产品 network failure。最终诊断中的 403/404 console 条目来自上述故意权限冒烟，两个 canceled scope 来自故意 stale 阻断，均与正常态分开。

结论：**G5-05 PASS**。

## 5. 截图索引与 SHA-256

目录：`docs/reading-monitor/validation/g5-browser-screenshots-2026-08-11/`

全部截图已独立目视检查，未见缺字、裁切、内容重叠或意外横向溢出；抽屉截图是在真实 wheel 后取图，所以呈现滚动后的内容位置。

```text
8364ad9f29fd68fa5a2b62f4e5c90216202e9d87a1031f3fa9f4b4d6197ac802  student-home-299-desktop.png
54bdc19aef0bc1cb8733ae0f22302ce2689f5aad1abe3441649e93f158d2b357  student-home-300-desktop.png
e6daa6523400627c0019f132278fc59b8a56325378fe91805f776385f22f9416  student-home-fresh-after-reader-desktop.png
1a56f9328a30fa04e12ae7125c510fe3fbea9043d77587d452364999caa20671  student-home-null-tablet.png
879783e320bc168034372c76ecfc2cc33cb01fef06012a29dc829fbbd126b8ab  student-null-go-shelf-tablet.png
95e6a3011cff04f97cd201887877ebb5d59de547288e6c513268902ea5cf2456  student-reader-last-page-desktop.png
4245acc54d3c7049803ef86a1e036289c6adb16bb596006c2ec41ba255b164a4  student-reader-last-page-after-5min-desktop.png
1e4c84ff112e34d78900819495d80772d918c2f7c958922ba5fc5c615728f0c3  teacher-main-desktop.png
0f084db0b0942f8916165a9418078e6af1602d5802c1f3a2e8cdde4526181f60  teacher-main-tablet.png
014b9d11bc524eec2a2aac2197030da48623c8709d355f3eac41379ca3396e79  teacher-main-narrow.png
38210b30919e7b0a44087d6592e2d5c7a048c621d8f7c9e7d56ede0e1a6ff316  teacher-drawer-desktop.png
5b9cd3cb68c7cacff159dc6ad8b839b359c9a4549db4141b1d827d5accc9522c  teacher-drawer-tablet.png
73f7016d1226f874af02f5a6c1760a59d8c1c12c822035e838203f2fdc0570c2  teacher-drawer-narrow.png
9931160b029bb23ebce3bed92e1e01cd46c27dd9c937812eaa9e6086c00bd7fd  teacher-stale-desktop.png
```

## 6. P1 修复后的独立最小重验

客户端 owner 只把新 monitor 的 movement source 保留给 coordinator，并将旧 `page_turn.payload` 严格投影为服务端冻结字段。V-BR 保持同一真实 API/Vite/一次性 DB，但停止旧 Chrome 后用全新隔离 profile `chrome-profile-5` 重验，避免旧 422 或权限刺激的 Log backlog 混入正常态。

### 6.1 真实翻页 HTTP 与浏览器诊断

真实 UI 登录、显式 version/page 打开 Reader、切为单页并点击“下一页”。实际请求同批为：

```text
page_stay: pageNo=1, durationMs=5096, payload={}
page_turn: pageNo=2, durationMs=0,
           payload={fromPageNo:1,direction:"next"}
```

结果：

```text
POST /api/v1/reading/events/batch -> HTTP 200
requestId = 4796a1ee-3412-4ada-9295-84d23e5d8493
accepted = [student-page-stay-ec702eab-4d94-49b5-8ae6-5cf470e4a8fd,
            student-page-turn-1ac342c1-b86e-409b-81e3-49bef8d953f7]
consoleErrors = []
networkFailures = []
```

请求已无 `source`，服务端严格 schema 未放宽；修复前 requestId `2c624411-...` 的 422 不再出现。

### 6.2 SQL：旧事件只保留护眼输入

```text
event id                                             type       reading  eye  payload
student-page-stay-ec702eab-...                       page_stay  0        5    {}
student-page-turn-1ac342c1-...                       page_turn  0        0    {fromPageNo:1,direction:"next"}
```

真实 `5096ms page_stay` 入库为 `valid_eye_seconds=5`，但 `valid_reading_seconds=0`；`page_turn` 也不贡献阅读时长。旧事件没有重新成为新统计真值，护眼输入得到保留。

### 6.3 新摘要与 fresh self 无回归

同一次真实 Reader 关闭形成：

```text
sessionId = reading-session-190c5969-15e0-4b83-bee3-f690b626fafd
result = accepted
revision = 1
cumulativeEffectiveMs = 6896
lastPageNo = 2
status/endReason = closed/reader_close
```

随后真实 Home fresh self：HTTP 200，requestId `f9489c09-8a9b-4bbc-be64-919c6a48e12f`；DTO 与页面同为 `397s / 已打卡 / 连续7天 / lastPageNo=2`，无禁用完成语义，console error 0、network failure 0。最终 open summary session 数为 0。

结论：修复前发现的 P1 已关闭，**G5-04 从 FAIL 翻转为 PASS**。

## 7. 清场与最终门禁

最小重验完成后，向受控 Chrome、Vite、API 会话发送中断；复查：

```text
lsof -nP -iTCP:5190 -iTCP:5191 -iTCP:9223
(no output)

ps ... | rg 'remote-debugging-port=9223|readmate-g5-browser.UacQ2A/chrome-profile'
(no Chrome/profile process；仅复查命令自身)

curl 127.0.0.1:5190 -> connection failed
curl 127.0.0.1:5191/health -> connection failed
```

Chrome 9223、5190、5191 和所有本轮隔离 profile 均已关闭；临时 DB/profile/脚本仍只位于 `/tmp`，没有写入正式数据。最终：

```text
G5-04 PASS
G5-05 PASS
P0 open = 0
P1 open = 0
```

本线允许主控汇入 G5 总门禁；整体 G5/AV-2 是否关闭仍由主控依据其他独立验收线统一决定。
