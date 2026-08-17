# Phase 2 缺陷台账（book-001 单书纵向验证）

本台账是 Phase 2 缺陷的权威底账，最终验收报告按此逐条标注 L 级。

验证方式说明：
- **机器实测**：由 agent 通过 HTTP 请求、数据库查询、代码检索取证
- **真人实测**：由用户本人在浏览器操作观察（2026-08-17 15:50）

真人复验环境：前端 `127.0.0.1:5190`、后端 `127.0.0.1:5191`，学生账号 `internal-student`，book-001。

## 一、缺陷清单

| 编号 | 缺陷 | 严重度 | 状态 | 复现条件 / 证据 |
|---|---|---|---|---|
| D-01 | 原版 PDF 无法加载 | 阻塞 | **已修** `eae6612` | pdfjs-dist 6.2.108 现代构建调用 `Map.prototype.getOrInsertComputed`，该 TC39 提案方法在 Chrome 144 仍未实现；改用自带 polyfill 的 legacy 构建。真人复验确认原版模式可渲染书页，未再出现该报错 |
| D-02 | 首页/书架卡片封面显示「封面资源不可用」 | 应修 | **已修** `eae6612` | 受保护资产接口要求 `X-Workspace-Id` 头，裸 `<img src>` 无法携带，请求被 400；改为带凭证与工作空间头 fetch 后转 blob URL。真人复验确认书架卡片显示真实插画封面 |
| D-03 | 三维翻页下第二次翻页与跳页回弹 | 应修 | **已处置（隐藏）** `8e25247` | 勾选「减少动态效果」或翻页效果选「平移」时，下一页与跳页均正常、画面与底栏页码同步；关闭减少动态效果并选「三维翻页」时，只能成功承载一次翻页，第二次翻页或跳页会播出动效后卡回原页。根因：`react-pageflip@2.0.3` 在 620ms 动效期间因 `props.children` 变化触发 `updateFromHtml()` 按旧索引重绘而中止动画，`startPage` 非受控属性。**处置为隐藏而非修复**（用户裁决）：默认值改 `slide`、`STUDENT_CURL_FLIP_ENABLED=false` 使 curl 分支不可达、UI 去掉「翻页效果」偏好项；`HTMLFlipBook` 源码保留以免动到两个源码扫描的冻结测试。永久记录见 `docs/tech-debt.md` TD-001 |
| D-04 | 阅读器左上角「返回详情」无法回到详情页 | 应修 | 未修（**待真人定性**） | 真人实测点击无效。最可能根因：按钮先 `await telemetry.closeAndWait('reader_close')` 再 `navigate`（`Reader.jsx` 788–791），而 `waitForTerminal` **无超时**——待提交项出不了队列则 Promise 永不 resolve，`navigate` 永不执行，表现为「点了没反应」。**而堵住队头正是 D-11 那颗 `LEASE_CONFLICT` 毒丸所为，故 D-04 很可能与 D-05、D-11 同根因**，已随 `f5f99a8` 顺带解除。未盲改按钮：无浏览器无法定性，且不宜削弱「先收尾再离开」契约。次可能（顶栏收起后 `pointer-events: none`、三维库叠层抢点击）已随 D-03 隐藏消失 |
| D-05 | 阅读进度不记录最后页码 | 阻塞 | **已修** `f5f99a8` | **与 D-11 同一根因**，随其修复。见 D-11 专项 |
| D-11 | **阅读时长与页码均停止汇总（项目核心目标受损）** | **阻塞** | **已修** `f5f99a8`（待真人复验） | 详见下节专项 |
| D-06 | 文字模式长页文本被截断，**被截内容完全不可达** | **应修**（已定性） | 未修 | 文字页为固定 468×636 设计画布，窗口变化只做 `transform: scale`、**禁止重排**（`src/student/components/BookPage.jsx` 第 6–14 行）。裁切发生在多层且均无 `overflow-y: auto`：`.student-page-frame` 的 `overflow: hidden`（`src/index.css` 1228–1230）、`.student-page-body` 的 `min-height:0; overflow: hidden`（同文件 1308–1314）。页内不能滚、不能展开、翻页是换到另一张物理页。**结论：文字模式下用户读不到被裁掉的文字，属功能性内容丢失**，非初见截断。切回原版 PDF 可见全文，但那是换模式，不构成文字模式的阅读能力 |
| D-07 | 阅读偏好「纸张颜色」无反馈 | **不记**（已定性） | — | 属实现预期。`paperTone` 确实传给了两种模式（`Reader.jsx` 717–747），文字模式经 `student-page--${tone}` 真实套用底色（`BookPage.jsx` 132–134 + `src/index.css` 1234–1245）；原版模式同一节点被后写的 `.student-pdf-page-frame { background: #fff }` 锁白，且 canvas 铺满整页，故视觉上不吃。**附带建议**：偏好面板未标注「仅文字模式」，宜补文案 |
| D-08 | 验收清单文案与实际 UI 不符 | 文档修订 | 待修 | **原判断需更正**：`04` 与 `03` 正文**都没有**「开始阅读」这一表述，该四字来自 `BookDetail.jsx` 第 50 行注释，不在验收清单。真实不符项是 `04` 多处写「文字模式」，而实际切换按钮文案为「**OCR 文字**」（`Reader.jsx` 795），涉及 `04` 第 40、43、45、46、64 行 |
| D-09 | 书籍详情页封面在冷请求下取不到 | 应修 | 未修 | 详情页用的是 `src/components/ui.jsx` 的裸 `<img>`（`BookDetail.jsx` 第 3 行导入，第 411 行渲染），`src = book.coverUrl \|\| book.cover?.url \|\| ${BASE_URL}covers/${book.id}.jpg`。对已导入书 `coverUrl` 即受保护 URL，而裸 `<img>` 无法携带 `X-Workspace-Id`，冷请求必然 400 → `onError` → 渐变文字封。**真人复验判「通过」系被 HTTP 缓存误导**（详见 D-10），非真实通过。契约测试 `tests/frontend/book-cover-protected-asset.test.mjs` 只锁了首页与书架，故意未锁详情页 |
| D-12 | 跨设备真冲突时整段会话的阅读时长静默丢失 | **应修**（主控上调，复核原判「建议」） | 未修（Phase 6 前处置） | `f5f99a8` 让 `pendingQueue` 丢弃 `LEASE_CONFLICT` 队头，但 `persistSnapshot` 仍执行了 `revisions.commit`（`coordinator.js` 277–278、`pendingQueue.js` 52–54）。于是本地 revision 已推进而服务端从未收下前一个 revision，下一次提交即 `REVISION_GAP`，**该会话此后写不进去**。修 D-11 后本机重挂已不再触发此路，剩下的触发条件是"另一台设备持有活租约"这类真冲突（学校平板 / 家里设备）。**上调理由**：后果是学生这一整段阅读时长静默消失、无任何界面提示，而"阅读被记录"正是本产品的核心承诺；虽触发条件不常见，但一旦发生不可察觉、不可追回。不挡 Phase 3（批量导入不涉此路），**须在 Phase 6 计时联动验收前处置** |
| D-14 | 资产接口未按班级可见范围过滤 | **应修（Phase 4 核心前置）** | 未修 | `getBookAsset` 目前只经 `requireSession` + `requireWorkspace`，**没有任何发布状态与班级可见范围的过滤**。即同一工作空间内任何登录用户都能取到任意书的封面与源 PDF，绕过教师的发布管理。这一条与取图路线选择无关，任何路线下都必须在 `getBookAsset` 显式实现，且口径要与 `listBooks` / `getPage` 一致。**意义**：Phase 4「教师发布管理与班级可见范围」的实际起点比 `03` 任务清单描述的更靠前——不只是补前端管理界面，服务端的资产授权本身尚未建立。发现于受保护资产方案设计（`docs/product-close-loop/design/protected-asset-consumption.md`） |
| D-13 | 同一学生多条残留 open 会话只能关掉一条 | 建议 | 未修 | `monitoring.js` 740–758 的 `otherOpen` 用 `.get()` 取单行且未过滤 `workspace_id`，若同一学生存在多条残留 open，一次只处理一条，理论上可留下多余 open 行。属防御深度不足，非越权（关闭目标仍限于该学生自己的行） |
| D-10 | 受保护资产响应可缓存且未按工作空间区分 | 应修（**Phase 4 前处置**） | 未修 | 资产响应带 `Cache-Control: private, max-age=3600`，**且无 `Vary: X-Workspace-Id`**。两重后果：① 一次带头 fetch 会为同一 URL 预热缓存，使随后不带头的裸 `<img>`/CSS `url()` 也能显示，**掩盖鉴权失败**（D-09 即因此被误判为通过）；② 授权结果被缓存长达 1 小时，教师取消发布或调整班级可见范围后，学生浏览器仍可从缓存读到封面乃至源 PDF。第 ② 点直接冲击 Phase 4「教师发布管理与班级可见范围」的有效性，须在进 Phase 4 前定方案 |
| D-15 | **僵尸标签页续租锁死租约，阅读计时与页码全链路无法记录** | **阻塞** | **已修** `a2c1ed3` | 详见下节专项 |

## 二、明确不记为缺陷

| 项 | 说明 |
|---|---|
| ~~详情页封面为假封面~~ | **该条已撤销，改记为缺陷 D-09。** 真人实测虽看到真实插画封面，但已查明系书架/首页的带头 `fetch` 预热了 HTTP 缓存所致；详情页自身的裸 `<img>` 在冷请求下取不到封面。此为**验收方法被缓存污染**的典型案例：验收路径经过书架再进详情页，就无法暴露详情页的鉴权失败 |
| 文字模式错字 / 缺字 / 排版怪异 | OCR 为可信输入，按 B-2 不做任何形式的 OCR 质量评价 |
| 第 2、3 页文字模式空白 | 基线事实：98 物理页中仅 88 页有 OCR 文本，10 页无文本。空白属预期 |
| 作者显示「服务端未返回作者」 | 符合决策 D6（作者字段留空） |
| 阅读器顶栏「本次已读 X 分钟」刷新后归零 | **属预期，且是复验时最容易误判为失败的一项。** 该数字是 `Reader.jsx` 本地 `setInterval` 每 60 秒加一，语义是"本次"，刷新必然从零开始。它与书籍详情页的「有效阅读时间」是两个不同的东西：后者走 `reading_daily_book_summaries` 的 `SUM(effective_reading_ms)`，跨会话跨日汇总，刷新不受影响 |

## 三、待定性观察

| 观察 | 说明 |
|---|---|
| 原版模式右页整页橙色 | 真人观察，疑为第 2 页印刷底色（该页无 OCR 文本）或渲染未完成，尚未定性。后续复验时确认 |

## 四、已通过项（真人实测）

- 首页/书架封面显示真实插画封面，书名「和大人一起读·儿童歌谣」正确
- 详情页封面为真实插画封面
- 原版 PDF 模式可渲染书页；顶栏「原版 PDF · 覆盖第 1-98 页」，底栏「第 1 页 / 共 98 页」
- 「减少动态效果」或「平移」翻页效果下，翻页与跳页正常，画面与页码同步
- 双模式页码对应未见错位
- 学生端未出现「已读 X%」或「完成度」推算指标

## 五、测试抖动（Phase 3 前必须定性）

`tests/frontend/reading-monitor-client-coordinator.test.mjs` 现已确认**至少三条**用例抖动：

| 用例 | 观测 | 备注 |
|---|---|---|
| 「真实生命周期事件在后台、freeze和网络恢复时额外提交」 | 修 D-11 前 20 跑 1 败、修后 20 跑 2 败；失败形态恒为"断言应有额外提交、实际没提交" | 最早发现的一条 |
| 「首页刷新协调在accepted终态前不解锁」 | 加跑时撞到（`store.records.length` 期望 1 实际 0） | 第二条 |
| 「tickDirect抛错后定时链仍会进行下一次尝试」 | 首跑失败、重跑即过 | **这是 `f5f99a8` 为 D-11 新加的回归守卫本身在抖** |

第三条最值得警惕：**为核心修复所加的守卫如果自身不可靠，它既可能在修复被破坏时仍然通过，也可能在一切正常时报红**，等于这条守卫暂时不能作为 D-11 不回归的凭据。

### 定性结论：测试侧竞态（独立复核已确认前两条）

复核 agent 的实测把"随机抖动"变成了确定规律：

| 跑法 | 「真实生命周期…额外提交」 | 「首页刷新…不解锁」 |
|---|---|---|
| **只跑这两条 × 20** | **20/20 失败** | 20/20 通过 |
| 整文件 × 10 | 9 过 / 1 败 | 10/10 通过 |

**冷启动必败、混在整文件里跑才偶败**——前面的用例预热了 `crypto.subtle` 之后概率才下降。根因是测试第 32–34 行 `settle()` 的固定 8 次 `setImmediate` 等不到 `persistSnapshot`（内含 `crypto.subtle.digest` 与入队）完成，断言开火时异步提交还在飞。

产品侧 `visibilitychange` / `freeze` / `online` 均走串行 `run()` → `persistSnapshot()`，**没有"超时就丢"的分支**。故为测试窗口过窄，**不是生产丢摘要**。

第三条（D-11 新守卫）复核未覆盖——因派发简报写于发现它之前，只点名了前两条。其定性仍开放，且必须查清是同源的测试侧竞态还是**产品侧续期逻辑本身有竞态**；若为后者，意味着 D-11 只修了一半。

**修法约束**：不得把 8 拍改成更多拍（只是把窗口挪远），应改为轮询等待条件成立（`waitUntil(predicate, timeout)`）或等 coordinator 空闲；不得放宽或删除断言换取通过。

**为何必须在 Phase 3 前定性**：这些用例覆盖的正是「学生切后台 / 页面被冻结 / 网络恢复时补交阅读时长」路径。若抖动源自 coordinator 侧真实竞态而非测试写法，意味着真实场景下学生阅读记录仍会偶发丢失——那 D-11 只修了一半。而即便确为测试侧，按当前复发率，Phase 3–7 每次质量门都可能撞上假红，届时最危险的不是浪费时间，而是**把真回归当成"已知抖动"放过去**（本次已发生一次：三条失败中有一条其实是新守卫，若不细看极易归入既有噪音）。

## 六、处置建议

| 缺陷 | 建议时点 | 理由 |
|---|---|---|
| **D-11（含 D-05）** | **已修 `f5f99a8`，待真人复验后方可关闭** | 阻塞级。项目核心目标"接通既有阅读计时系统"此前未达成。Phase 3 是把 49 本铺开，若阅读行为不被汇总，铺得越多只是把坏掉的闭环复制 49 份，Phase 6、7 验收全部无从谈起 |
| 测试抖动定性（三条，含新守卫） | **进 Phase 3 前定性** | 若为产品侧竞态则 D-11 只修了一半；即便为测试侧，也已实证会诱发"把真回归当已知噪音"的误判 |
| D-04 返回详情失效 | **待真人一次点击定性** | 判断为与 D-11 同根因（`waitForTerminal` 无超时 + 毒丸堵队），可能已随 `f5f99a8` 自动解除。若复验仍失效再单独修。另有一项结构隐患需另行决策：**导航动作依赖一个无超时的等待，任何未来的队列堵塞都会让返回键再次变死** |
| D-03 三维翻页回弹 | **已按裁决隐藏 `8e25247`** | 用户裁决为隐藏而非删除或修复：默认改平移、curl 分支不可达、UI 去掉偏好项，代码保留。永久债记 `docs/tech-debt.md` TD-001 |
| D-09 详情页封面、D-10 资产缓存 | **进 Phase 4 前修** | 两者同源，都指向"受保护资产如何被 `<img>`/CSS 消费"这一决策。Phase 4 教师端书库与详情页用 CSS `background-image: url(...)` 取图，处境与 D-09 完全相同；D-10 的缓存问题更会直接削弱 Phase 4 的可见范围管控 |
| D-06 文字模式内容丢失 | Phase 5 Reader 补缺 | 已定性为应修，但修法涉及设计取舍（页内滚动 / 自动缩小字号以适配 / 增加展开），需先定方案。规模上会影响全部 49 本中所有文本较多的页面 |
| D-07 | 不记，附带补一句面板文案 | 属实现预期 |
| D-08 | 随最终报告一并修订 | 纯文档 |

## 七、D-11 专项：事件持续流入，汇总环节冻结

**严重度：阻塞。** 本项目核心目标之一是"接通既有阅读计时系统"，若阅读行为不被汇总，该目标未达成，Phase 6 的计时联动验收整个失去基础。

### 症状（真人报告）

首页显示的"3 分钟"来源不明；用户随后继续阅读，**时长完全不增加**，阅读位置也始终停在第 1 页。用户怀疑"数据库链路整个坏了"。

### 实测数据（主控只读查询，2026-08-17 16:05）

**事件链路正常且仍在持续：** `reading_events` 65 行，全为 `page_stay`，**每分钟一条，从 `06:57:16Z` 连续写到 `08:02:55Z` 无中断**，`offline_sequence` 单调递增到 65，最后 3 条的 `page_no` 均为 3，`foreground=1`、`screen_on=1`。

**汇总链路冻结在首次：**

| 表 | 行数 | 关键值 |
|---|---|---|
| `reading_summary_sessions` | 1 | `latest_revision: 1`、`cumulative_effective_ms: 194544`、`last_page_no: 1`、`measured_through_at: 07:01:16.924Z`、`status: open`、`ended_at: null` |
| `reading_progress` | 1 | `last_page_no: 1`、`valid_reading_seconds: 0`、`updated_from_event_at: 07:01:16.924Z` |
| `reading_page_coverage` | 2 | 仅 `page_no` 1 与 2；两行 `effective_text_ms` **都是 194544**；`effective_original_ms` 均为 0 |

### 计时的两条独立路径（走读确认，理解本缺陷的前提）

```
【主路径，权威时长与页码的唯一写入者】
commitLeaf (Reader.jsx:316-321) → visiblePageNos → createStableView (view.js:8-21)
  → coordinator.move() (coordinator.js:426-431) → activity.tracker.move() → cut() (activity.js:75-99)
  → 【触发点】5 分钟 tick / 关阅读器 / 切后台
  → persistSnapshot() (coordinator.js:233-258, 318-325)
  → createSummaryRevision() (summary.js:42-106，指纹字段冻结)
  → POST /reading/session-summaries → writePageCoverage() (monitoring.js:515-578)

【旧事件路径，只喂护眼统计，对汇总零贡献】
useReadingTelemetry.js:113-149 → page_stay / page_turn → submitReadingEvents
```

**关键认识**：`reading_events` 属旧事件路径，它持续流入**不代表**计时健康。权威时长与页码只由摘要写入。

### 根因（已定位，文件+行号）

**两个缺陷互相放大，形成自锁：**

1. **定时链一次失败即永久停摆**（主因）。`coordinator.js` 第 168–174 行：5 分钟定时里 `tickDirect()` 一旦抛错，后续的 `scheduleSummary()` 就不再执行，**定时链从此永久停止**，之后既不会重试也不会自愈。
2. **换页会拆掉监测会话，并制造必然的提交冲突**（触发器）。`Reader.jsx` 第 79 行的组件 `key` 会因 URL `?pageNo=` 变化而重建组件，从而拆掉 coordinator 并换新 `sessionId`；但旧会话在服务端仍是 `open`，新摘要提交会被 `monitoring.js` 第 731–738 行以 **`LEASE_CONFLICT`** 拒绝——该错误又正好触发第 1 条的停表。

**缺陷间的因果链（重要）**：D-01 原版 PDF 加载失败 → 翻页按钮表现为无效（D-03）→ 验证者只能改 URL `?pageNo=` 跳页 → 触发会话重建与 `LEASE_CONFLICT` → 定时链停摆 → D-11 时长与页码双双不再落库 → 表现为 D-05。**这是一条由前序缺陷诱发的连锁失效，不是独立故障。**

### 已排除

- **排除可能 B（指纹重放冻结 revision）**：指纹重放只会返回 200 `replayed`，不会把 revision 冻在 1。
- **排除鉴权缺头**、**排除数据库不可写**、**排除页码追踪失败**（旧事件 `page_no` 已达 3，与主路径同源于 `commitLeaf`，说明 `leaf` 确实推进到第 3 页）。
- 因此 **D-05 与 D-11 同根因**，且不是 D-03 的下游（虽然 D-03 是其触发条件之一）。

时间线印证用户观察：
- 06:56–07:05Z（北京 14:56–15:05）浏览器 agent 会话 → 唯一一次成功提交，产生 revision 1 与 194544 ms，即 UI 上那"3 分钟"（确认为服务端投影，非本地种子）
- 07:20–07:50Z（北京 15:20–15:50）真人会话 → 事件全收到，汇总零推进

### 数据卫生

调查过程**未向库中写入 revision 2**，以免污染这 3 分钟基线。

### 三个疑点的定论（其中两个是我方误判，已撤销）

| 此前疑点 | 定论 |
|---|---|
| 事件 `valid_reading_seconds` 恒为 0 | **设计如此，不是缺陷**（`catalog.js` 868–871）。护眼用 `valid_eye_seconds`，有效阅读时长不从事件累加。若误当根因去改有效时长计算，将触犯 B-2 冻结的计时算法 |
| 第 1、2 页各记满额 194544 ms | **设计如此，不是缺陷**（`activity.js` 85–96）。双页展开时两页同时可见，同一段有效毫秒记给视图内所有页，该字段非"该页独占时长"，故逐页之和本就不应等于会话总时长 |
| `effective_original_ms` 全为 0 | **属当时情形，非路径缺失。** 原版模式的时长归因路径存在，但要求 PDF 处于 `ready`（`Reader.jsx` 214–216）。当时 PDF 加载失败（D-01），故全程记在文字模式。D-01 已修，该路径应可工作，但**尚未经真实运行验证**，仍是 Phase 6 的待验项 |

### 修复方向（agent 建议）

优先让**定时失败后仍能续期**（不因一次异常永久停摆），并**避免换页拆掉监测会话**。**不得触碰摘要 schema 与指纹算法。**

真人验证只需一项：连续阅读满 6 分钟以上，在浏览器 Network 面板确认出现**第二条** `session-summaries` 请求。

### 历史记录：曾待区分的两种可能（已由上文定论取代）

| | 可能 A：客户端摘要提交停止 | 可能 B：服务端拒绝 revision ≥ 2 |
|---|---|---|
| 机制 | 事件与摘要是两条提交路径，事件通、摘要只成功过一次 | 摘要到达但被幂等/指纹去重判为重放而丢弃，或汇总任务不再被触发 |
| 支持线索 | `latest_revision` 恒为 1；`reading-monitor-client-coordinator.test.mjs` 的「后台/freeze/网络恢复额外提交」实测 **10 跑 1 败**，失败形态正是"应有额外提交、实际没提交" | 表中存在 `latest_fingerprint` 与 `revision_fingerprints_json` 幂等结构；若指纹输入在多次提交间不变，后续提交会被判重复 |

### 计时的两条独立路径（走读确认，决定性）

```
【主路径，逐页覆盖真值】
commitLeaf (Reader.jsx:316-321) → visiblePageNos → createStableView (view.js:8-21)
  → coordinator.move() (coordinator.js:426-431) → activity.tracker.move() → cut() (activity.js:75-99)
  → 【触发点】5 分钟 tick / 关阅读器 / 切后台
  → persistSnapshot() (coordinator.js:233-258, 318-325)
  → createSummaryRevision() (summary.js:42-106，指纹字段冻结)
  → ports.submitSummary() (apiPorts.js:34-38) → POST /reading/session-summaries
  → writePageCoverage() (monitoring.js:515-578) → 写 reading_page_coverage（只加 delta）

【旧事件路径，只喂护眼统计，有效秒恒 0】
useReadingTelemetry.js:113-149 → page_stay / page_turn → enqueueLegacy → submitReadingEvents
```

**这条走读修正了此前的两处误判：**

| 此前被列为疑点 | 实际结论 |
|---|---|
| 事件 `valid_reading_seconds` 恒为 0 | **设计如此，不是缺陷。** 旧事件路径只服务护眼统计（`valid_eye_seconds`），对摘要汇总无贡献。若误当根因去改有效时长计算，将触犯 B-2 冻结的计时算法 |
| 第 1、2 页各记满额 194544 ms | **设计如此，不是缺陷。** `stableView.pageNos` 是视图内**可见页集合**，双页展开时两页同时可见，`cut()` 把同一段有效毫秒记给视图内所有页，故逐页之和本就不应等于会话总时长 |
| "事件持续流入即客户端提交正常" | **推断过宽。** 该结论只对旧事件路径成立；主路径的摘要提交是独立 HTTP 请求（`POST /reading/session-summaries`），完全可能已停止。因此"可能 A"并未被排除，反而最可疑 |

**已可排除**：页码追踪失败。旧事件的 `page_no` 已达 3，而旧事件与主路径同源于 `commitLeaf` → `stableView`，说明 `leaf` 确实推进到第 3 页。**页码是好的，坏的是提交。** 故 D-05 与 D-11 同根因，且**不是** D-03 三维翻页回弹的下游。

### 收窄后的调查方向

摘要提交触发点明确为三个：**5 分钟 tick、关闭阅读器、切后台**。真人连续阅读约 30 分钟理应触发约 6 次 tick，但 revision 恒为 1。核心问题变为：**`persistSnapshot()` 在首次之后为何再未成功推进？** 取证点：定时器是否还在跳 → `persistSnapshot()` 是否提前 return → revision 2 是否生成 → HTTP 是否发出 → 服务端是否判为重放。`pendingStore.js`（存的正是摘要重试队列）的实际内容是区分"没生成/没发出"与"发了但被拒"的最快判据。

### 仍开放的疑点

**`effective_original_ms` 全为 0**，时长全归文字模式。当时原版 PDF 处于加载失败状态，可能确实全程在文字模式；但需从代码确认原版模式的时长归因路径真的可用，否则 Phase 6 的"双模式×计时联动"验收会直接失败。

### 与既有抖动的关联

第五节记录的 `reading-monitor-client-coordinator.test.mjs` 抖动（10 跑 1 败，「应有额外提交、实际没提交」）与本缺陷症状同形。若 coordinator 的提交调度存在竞态，则测试里 10% 复现、真实环境可能常态失败。**此前把该抖动判为"既有噪音"是过于乐观的判断**，现应作为 D-11 的重要线索对待。

## 八、受保护资产鉴权矩阵（Phase 4 决策依据）

`GET /api/v1/books/assets/:assetId` 挂在 integration router 的 `requireSession` + `requireWorkspace` 之后（`server/http/integration-router.js` 387–388），资产路由无例外；`requireWorkspace` 强制读取 `X-Workspace-Id` 头，不会用会话的 `activeWorkspaceId` 兜底（`server/middleware/request-context.js` 53–61）。

| 请求形态 | 会话 Cookie | `X-Workspace-Id` | 结果 |
|---|---|---|---|
| `fetch` 带凭证与工作空间头（学生首页/书架已改成这样） | 有 | 有 | **200**，再转 blob URL |
| 裸 `<img src>` / CSS `background-image: url()` 冷请求 | 有（浏览器自动带） | **无**（浏览器不允许加自定义头） | **400** |
| 完全未登录 | 无 | 无 | **401** |
| 同一 URL 曾在 1 小时内被带头请求过且缓存有效 | — | — | 裸 `<img>` **可能**显示（命中缓存）。**不可当作接口契约**，D-09 即因此被误判 |

**结论：浏览器不可能给 `<img>` 或 CSS `url()` 添加自定义请求头，因此这条路走不通。** 修法只有两条：

1. **前端逐个改造**：所有消费方都改成带头 `fetch` + `URL.createObjectURL`（当前仅学生首页与书架完成）。待改造清单：学生详情页（`src/components/ui.jsx` 的 `BookCover`）、教师端书库与详情页（`src/console/pages/teaching/BookLibrary.jsx`、`BookDetail.jsx` 51–52 行、`ArrangeList.jsx`，均用 CSS `url()`）、社区帖图（`PostCard.jsx`、`PostDetail.jsx`，读公开 `covers/${book.id}.jpg`，导入书天然无此文件）。
2. **服务端放宽**：为 `GET /books/assets/:assetId` 增加"缺头时以会话 `activeWorkspaceId` 推断工作空间"的回退，并同步收紧缓存（见 D-10）。

方案 2 改一处即可覆盖全部消费方，方案 1 需逐个改造且每新增一个展示位就要重复一次。但方案 2 触及鉴权中间件，需谨慎评估越权风险与既有测试（`identity-core.test.js` 578–582 断言"有 Cookie 无头 → 400"，放宽后该断言需重新界定适用范围）。**该决策留给 Phase 4 前处置，不在 Phase 2 内擅自变更鉴权。**

## 九、`f5f99a8` 契约边界独立复核（只读，审查范围 `937ce0b..f5f99a8`）

D-11 的修复动到了 `server/domains/reading/monitoring.js` 与 `catalog.js`，改的是**新会话何时可以接管未关闭旧会话**的租约语义。该语义虽不属 B-2 明文冻结项，但紧邻冻结区且改变了数据何时可写，故未照单接收，另派只读复核。

**结论：有条件通过。** 条件为①三条抖动测试确定化②真人 6 分钟复验。

### 契约边界：通过

- `summary.js` **不在该提交的 11 个文件内**，`createSummaryRevision()` 与 `FINGERPRINT_FIELDS` 原样未动；服务端 `SUMMARY_FIELDS`（14–31）与 `normalizeSummary()`（202–269）未改
- 未新建第二套系统：复用既有 `closeReadingSummarySessionsForLease` → `closeOpenSummaryRows`；新增的 `expireStaleLeasesForActor`（340–345）只是既有 `expireActiveLease` 的按 actor 清扫；租约 TTL 仍为 90 秒
- 写入语义未变：同会话 `delta = 新累计 − 旧累计`，新会话首份累计作第一笔 delta

### 越权风险：无

接管条件确为「同一学生 +（同一租约 或 租约已死）」（`monitoring.js` 740–758）：

| 场景 | 结论 |
|---|---|
| 另一名学生 | `findLeaseHistory`（374–389）要求 org / actor / workspace / device / bookVersion 全等，对不上即拒 |
| 另一台设备、租约仍活 | `sameLease` 假且 `otherLeaseDead` 假 → 仍抛 `LEASE_CONFLICT`，只能走既有显式接管 |
| 另一台设备、租约已过期 | 关闭的是同一学生的残留；`acquireLease` 本就会清过期租约 |
| 另一工作空间 | `findLeaseHistory` 要求 `workspace_id` 一致 |

`closeOpenSummaryRows`（325–331）另带 `lease_id_at_start = :leaseId AND status = 'open' AND measured_through_at <= :endedAt`，不会全表扫。

### 跨会话汇总：无清零回归

详情页「有效阅读时间」是跨会话跨日汇总，刷新不会抹掉已入账时长。链路：`reading_daily_book_summaries.effective_reading_ms` → `projectBooks()`（`projections.js` 22–38、81–87）按 actor + workspace + bookVersion 做 `SUM`，`effectiveMinutes = Math.floor(ms / 60000)` → `adapters/student.js` 136 `minutes` → `BookDetail.jsx` 189–191。194544 ms → `floor(3.24)` = 3，与现状吻合。

多会话不重复计墙钟：旧会话累计已入日汇总，新会话从 0 起只把自己的累计当 delta。

### 不重复计时：独立验证成立；并查出一条丢失路径

`REVISION_CONFLICT`（704–707）真实存在且拒绝写入：同 revision 指纹不同即抛错 return，不 `updateSession`、不写日汇总；指纹相同则 `replayed`/`superseded`，也不加 delta。

重复方向全部安全。**但丢失方向查出一条**，已记为 **D-12**（见缺陷清单）。

### 关闭残留不丢数据：确认

`closeOpenSummaryRows` 只更新 `status / ended_at / end_reason / updated_at / version+1`，不碰 `cumulative_effective_ms`、`latest_revision`、`latest_fingerprint`、`revision_fingerprints_json`。单调触发器（`043_reading_session_summaries.sql` 168–194）禁止累计回退、禁止已关闭行改 `ended_at`，允许 open → closed。服务端新测例（`reading-monitoring.test.js` 568–575）断言关闭后仍为 194544、revision 仍为 1。**「3 分钟」基线不会被清零或重算。**

## 十、D-15 专项：僵尸标签页续租锁死租约

**严重度：阻塞。** 与 D-11 症状同形（阅读时长与页码均不推进），但根因不同：D-11 是客户端定时链停摆 + `LEASE_CONFLICT`；本条是**活租约被脱管标签页无限续期**，其他设备/会话被 `READING_LEASE_HELD` 拒于门外。D-05、D-11 在 `f5f99a8` 的修复未能覆盖本路径；**连续三轮真人复验均失败**，直至 `a2c1ed3` 在真实环境观测到续期被拒、租约自然过期后才可关闭。

### 症状（真人报告）

真人打开学生端阅读器，顶栏显示 `READING_LEASE_HELD`；`POST /reading/lease` 返回 409，监测会话建立不起来，阅读时长与页码完全不记录。

### 触发源

一个脱管的浏览器标签页——**跑在 Cursor 内嵌浏览器里，是 2026-08-17 当天下午某个子 agent 做浏览器验证时留下的页面**，不是用户自己的 Chrome。

### 定位方法（留档）

1. **`Get-NetTCPConnection`**：观察到 5190 与 5191 的客户端端口连号成对（56674/56675、61923/61924、51986/51987），说明同一客户端先请前端再请后端。
2. **进程归属**：该客户端 socket 归属 Cursor 的 `NetworkService` 进程（pid 44972），其父进程是标题为「Cursor Agents」的 Cursor 窗口。
3. **MCP 盲区**：当前会话的浏览器 MCP `browser_tabs list` 返回空——该标签页已脱离 MCP 管理，工具查不到。

### 与既有诊断的更正

| 此前判断 | 定论 |
|---|---|
| 用户 Chrome 后台残留进程持有续期 | **已证伪。** 用户按判断彻底关闭 Chrome 三次均无效；主控在征得用户同意后杀掉全部 29 个 `chrome.exe` 进程后，续期依然每 60 秒继续，才排除 Chrome。真凶是 Cursor 内嵌浏览器里 agent 遗留的标签页 |
| D-11 `f5f99a8` 已修，真人复验应通过 | **本路径未覆盖。** D-11 修的是 coordinator 定时链与 `LEASE_CONFLICT` 接管语义；本条是租约续期无停滞检查导致的 `READING_LEASE_HELD`，真人三轮复验均因此失败 |

**过程建议**：凡涉及「客户端仍在活动」的判断，应先用连接归属证据定位宿主进程，再要求真人操作；勿在未定位前让用户白等（本次用户被要求关 Chrome 三次、白等约 40 分钟）。

### 根因（机制）

```
【客户端】leaseController 每 60 秒无条件续租（TTL 90 秒、提前 30 秒续期）
         ↓ 该页摘要提交链早已停摆
【服务端】renewLease 原先无条件延长租约，从不检查关联会话是否仍在推进
         ↓ 租约永不过期
【阻塞】 catalog.js 296–299 行对任何其他设备抛 READING_LEASE_HELD
         ↓ 新会话一条摘要都发不出去
```

实测：该租约自 `06:56:16Z` 起被连续续期近三小时，`active_reading_leases.version` 达 187；而关联会话自 `07:01:16Z` 起 `latest_revision` 恒为 1、`cumulative_effective_ms = 194544` 未变。

### 修复（`a2c1ed3`）

`server/domains/reading/monitoring.js` 的 `renewLease` 按该租约上最新一条摘要会话的 `measured_through_at` 判定停滞，超过 `STALE_SESSION_RENEW_THRESHOLD_MS = 420` 秒即拒绝续期（抛既有 `LEASE_REQUIRED`），租约 90 秒内自然过期后交既有清理链路接管。

**约束**：不新增接管策略、不改 TTL 数值、不碰摘要 schema 与指纹。阈值依据：5 分钟摘要 tick + 90 秒 TTL + 约 30 秒调度余量。

### 附带修复

`server/http/integration-router.js` 中 `readmate_device` 从会话 Cookie 改为 365 天持久 Cookie，并抽取 `ensureDeviceCookie` 提前到 `executeIdempotentAsync` 之前写入；课堂路由（`POST /classroom/sessions/:sessionId/control`）复用同一实现。原先是会话 Cookie，浏览器完全退出即丢失，导致同一台机器重启浏览器后被判为新设备。

### 检查点

`a2c1ed3`。质量门 server 200/200、frontend 171/171、build 退出码 0。

### 真实环境实测证据

修复后重启后端（`10:03:22.825Z` 起 pid 37708）：

| 观测项 | 值 |
|---|---|
| 首次续期被拒 | `10:03:40.307Z`；幂等记录 `state=failed` / `status_code=409` / `failure_code=LEASE_REQUIRED` / `failure_reason=阅读租约关联会话已停滞，不能续期` |
| `active_reading_leases.version` | 冻结在 187（末次成功 `10:02:40.280Z`） |
| 租约过期 | `10:04:10.279Z` |
| 僵尸页后续行为 | 既未再续期也未重新抢占租约 |
| 残留会话数据 | `cumulative_effective_ms = 194544` 与 `latest_revision = 1` 未被改动 |

### 过程教训：首版修复「单元测试全绿但线上完全不生效」

本条与缺陷本体同等重要，是本项目的过程教训。

**首版问题**：首版修复的停滞判定 SQL 带了 `status = 'open'` 过滤条件。而僵尸页在服务端重启后会触发同设备 `acquireLease`；`server/domains/reading/catalog.js` 第 311–316 行会以 `lease_taken_over` 关闭该租约的 open 会话。于是判定的会话查询返回空行，`UPDATE active_reading_leases` 照常执行，续期继续成功。

**发现方式**：主控在真实环境只读观测 150 秒，看到 `version` 仍在 176→177→178 递增、审计 `outcome=succeeded`，才发现修复根本没生效。

**测试缺口**：

| 问题 | 说明 |
|---|---|
| 首版 4 条领域回归 | 全部让会话保持 `open` 状态，**没有一条覆盖「同设备 re-acquire 把会话标成 closed 之后仍能续期」这条真实生产路径** |
| 报告中声称的 2 条 HTTP 用例 | **实际不存在** |

**已补回归（4 条）**：领域层 2 条（closed 会话停滞超阈值拒续、同设备 re-acquire 关闭 open 会话后停滞拒续）；HTTP 层 2 条（同两个场景走 HTTP 断言 `LEASE_REQUIRED`）。

**验收纪律建议**：服务端改动光有「重启后端 + 单元测试全绿」不足以判定生效，**必须在真实环境用真实数据观测到预期行为**（本例是观测续期是否真的被拒、租约是否真的过期）才能宣称修复完成。
