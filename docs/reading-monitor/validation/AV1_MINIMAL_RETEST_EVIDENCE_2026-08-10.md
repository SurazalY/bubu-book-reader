# AV-1 唯一 P0 最小重验证据

> 执行日期：2026-08-10（Asia/Shanghai）
> 执行角色：独立验收 Agent V
> 候选分支：`codex/reading-monitor-clean-baseline`
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`
> 重验结论：**PASS**
> 合并首轮结论：**AV-1 从 FAIL 翻转为 PASS**
> 是否允许 W3：**是**

## 1. 范围与判定

本轮只重验首轮 `AV1_VERTICAL_EVIDENCE_2026-08-10.md` 的唯一 P0，以及它可能影响的最短纵向链路；没有重跑 B 160 项、完整 C/前端全量或首轮已经通过的 AV1-01～AV1-10 矩阵。

独立结果：默认三维 Reader 已能稳定落实显式 `versionId&pageNo=4`；严格错误 query 仍明确失败；真实 Reader 摘要仍能通过 HTTP 原子写入 session/daily，并由严格 `/self`、`/scope` 读出。没有发现新 P0/P1/P2。

因此首轮十项 PASS 证据继续有效，唯一阻断已关闭，AV-1 最终判定改为 **PASS**，允许 W3 按既定串行顺序开始。

## 2. 候选身份与环境

| 项目 | 实际值 |
| --- | --- |
| 临时数据库 | `/tmp/readmate-av1-retest.wT1XZS/readmate.sqlite` |
| 临时公版资产 | `/tmp/readmate-av1-retest.wT1XZS/public` |
| Node/Vite | `127.0.0.1:5191` / `127.0.0.1:5190` |
| 浏览器 | Google Chrome `151.0.7922.76`，独立临时 profile，1440×1000，CDP 9223 |
| 数据库迁移 | `27|043_reading_session_summaries.sql` |
| 最终服务状态 | 5190、5191、9223 均无 LISTEN；临时 profile 进程不存在 |

修复与纵向链路关键文件在本轮执行前后 SHA-256 一致：

```text
14e0fb5310c14f18c0b6e4affba097829964c60cf218e924b7be04f0b21fca4b  src/student/pages/Reader.jsx
ce5a38ba137b3d9561308c1dc0db90d9f6efa2b19d97fdd382a23b2cdc54ac45  src/student/state/useStudentReaderPages.js
847e2bdd3bee4b6056a932b48c68b70884ff647218038d9245587659acde9946  tests/frontend/reading-monitor-client-reader-initial-page.test.mjs
c71a3e323560e43b7198a2247062d5ee9b98df4d1b35dd76d020f2fbb60d5976  tests/frontend/reading-monitor-ui-student.test.mjs
279738e5b0690b9223524a6dbdec23d3157c71510b2d08f8d3adb1e2799350cb  src/student/reading-monitor/coordinator.js
a7548905ea5ed7103e244676a7578797fe2b85f5e9906f84ac0583716201d8b1  server/domains/reading/monitoring.js
829edc7540ff0ed3a6eec3e6f575d78c8137003415e1eaf6f06c5621ca18ae95  server/http/integration-router.js
```

V 没有修改生产代码、测试、控制文档或需求包，只新增本 validation evidence。

## 3. 聚焦自动化

### 3.1 新增 Reader 初始页回归

```bash
node --test tests/frontend/reading-monitor-client-reader-initial-page.test.mjs
```

结果：`3/3 pass`，`0 fail/skip/todo`：

- runtime 晚到时显式 pageNo=4 覆盖旧初始页；
- 三维组件首次错误 `onFlip=0` 不覆盖显式末页 leaf=2；
- 末页双页初始化不制造幽灵页，且不显示完成度语义。

### 3.2 严格 Reader query

```bash
node --test tests/frontend/reading-monitor-client-clock-view.test.mjs
```

结果：`5/5 pass`，`0 fail/skip/todo`。其中明确覆盖：

- 指定版本和页码严格打开；
- 错误版本、跨书版本、不可访问版本、非整数与越界页码明确失败；
- 正文响应不得静默换版本、跨书或换页。

## 4. 真实 Chrome：默认三维直达末页

登录真实学生后，直接打开：

```text
http://127.0.0.1:5190/student/reader/book-cdf0dfa2df2718611c50cba4?versionId=version-cdf0dfa2df2718611c50cba4&pageNo=4
```

页面稳定后，在约 6 秒窗口内连续四次采样，四次结果完全一致：

```text
URL              = ...?versionId=version-cdf...&pageNo=4
底栏             = 第 3 页 / 共 4 页
上一页           = enabled
下一页           = disabled
100%             = 不存在
finished         = 不存在
读完             = 不存在
产品 console 错误 = 0
Network 失败      = 0
```

真实正文请求均成功，且没有静默换版本/页码：

- `/books/book-cdf.../pages/4?versionId=version-cdf...` → 200，requestId `d36f53d3-bc1b-47fe-98da-82345c5c8e36`；
- 三维末尾双页同时取 page 3 → 200，requestId `032df96a-9c96-4edb-a010-2a90a6c8f6d3`；
- 稳定后 page 4 再取 → 200，requestId `80b36cb4-649f-460f-883b-a90a4b444d7e`。

这关闭了首轮 P0：显式末页现在稳定落到包含第 4 页的末尾双页视图，首次翻页回调不再把主页面写回 1。

## 5. 真实 Chrome：严格失败不回退

浏览器直接打开同一版本的越界页：

```text
.../student/reader/book-cdf...?versionId=version-cdf...&pageNo=5
```

稳定后页面明确显示：

```text
这本书暂时打不开
PAGE_OUT_OF_RANGE：pageNo必须位于1到4之间
```

URL 保留 `pageNo=5`，没有 Reader 页码底栏、没有请求任一正文页来冒充成功、console 错误为 0。结合聚焦自动化对错误 version、跨书 version、不可访问 version 和其他非法 page 的覆盖，严格失败门槛通过。

## 6. 真实 Reader 摘要到 strict 查询冒烟

### 6.1 浏览器请求与响应

在真实末页 Reader 稳定阅读后点击“返回详情”，组件关闭产生一次真实摘要：

```text
POST /api/v1/reading/session-summaries
HTTP                    = 200
X-Request-Id            = 25172b46-7416-4d49-b0f2-ac26d3e12c79
envelope requestId      = 25172b46-7416-4d49-b0f2-ac26d3e12c79
result                  = accepted
sessionId               = reading-session-649a8625-fa93-4cba-bad9-10826aa92d58
revision                = 1
leaseId                 = 38d63f3d-8d55-4b2a-bbc8-26277258e630
cumulativeEffectiveMs   = 8436
lastPageNo              = 3
endedAt                 = 2026-08-10T14:58:00.464Z
endReason               = reader_close
```

真实请求携带：

```text
Idempotency-Key = reading-summary:reading-session-649a8625-fa93-4cba-bad9-10826aa92d58:1:8b7be707ae966db32834aae536801ebc26e2ce818de9c8f55caaa30804d20478
X-Workspace-Id = internal-demo-workspace
fingerprint = 8b7be707ae966db32834aae536801ebc26e2ce818de9c8f55caaa30804d20478
```

产品页面 console 错误为 0。

### 6.2 SQL 原子结果

```text
reading_summary_sessions:
  revision      = 1
  cumulative_ms = 8436
  last_page_no  = 3
  status        = closed
  end_reason    = reader_close

reading_daily_book_summaries:
  stat_date     = 2026-08-10
  effective_ms  = 8436
  last_page_no  = 3

idempotency_records:
  status_code   = 200
  result        = accepted
```

session 与 daily 均为 `8436ms`，没有重复或半写；双页主页面按冻结语义保存为 3。

### 6.3 `/self` 与 `/scope`

真实学生 `/reading/statistics/self`：

```text
HTTP / header-envelope requestId = 200 / 748225ec-fd51-40a2-8dd8-673e7754c339
todayEffectiveReadingSeconds     = 8
lastReading.lastPageNo           = 3
lastReading.totalPages           = 4
```

真实同组织教师 `/reading/statistics/scope?classId=internal-demo-class&statDate=2026-08-10`：

```text
HTTP / header-envelope requestId = 200 / 0b62cef8-60a0-4237-b012-4ff30d119c95
summary.totalEffectiveReadingSeconds = 8
student.todayEffectiveReadingSeconds = 8
student.lastReading.lastPageNo       = 3
```

两条查询均为冻结的 strict 新统计字段；毫秒值按 API 契约取整为 8 秒，self 与 scope 一致。真实摘要 → HTTP → session/daily → self/scope 纵向链路未被 P0 修复破坏。

## 7. 服务回收与最终结论

- Chrome/CDP 9223：已停止；
- Vite 5190：已停止；
- Node 5191：已停止；
- `lsof` 复核 5190、5191、9223 均无 LISTEN；
- 临时 Chrome profile 对应进程不存在。

```text
最小重验 = PASS
首轮 P0  = CLOSED
AV-1     = PASS（由首轮 FAIL 翻转）
W3       = AUTHORIZED
```
