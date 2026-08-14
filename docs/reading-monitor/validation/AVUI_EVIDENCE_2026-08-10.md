# AV-UI 独立验收证据（2026-08-10 / 2026-08-11）

## 1. 结论

**FAIL**

- AV-UI 不通过，存在 1 项 P0：教师学生详情抽屉在 1440×1000 与 1024×768 下不受视口约束、抽屉自身不可滚，实际滚动的是背景控制台内容。
- 另有 3 项 P1：学生 299 秒进度条的辅助技术值误报 100；1024 教师摘要卡出现关键孤字；390 学生 BottomNav 两个长标签被压成逐字多行。
- 不存在测试环境或权限阻塞；失败来自候选实现，不是数据构造失败。
- **不允许以当前候选关闭 W3 / 进入下一门禁。** 修复 P0 后必须执行本文第 12 节的最小重验；P1 应在同一 UI 收口窗口处理并复验。

验收跨越 Asia/Shanghai 2026-08-10 23:58 至 2026-08-11 00:xx；冻结统计日仍为 04:00 边界下的 `2026-08-10`，因此跨自然日午夜不改变本次统计日。

## 2. 约束与候选身份

- 工作区：`/Users/yak/Project/整书8.10`
- 分支：`codex/reading-monitor-clean-baseline`
- HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`
- V 只读生产代码和测试；未修改生产代码、测试、`IMPLEMENTATION_CONTROL.md`、`G1_FROZEN_CONTRACT.md` 或需求包。
- V 新增内容仅为本证据和 `docs/reading-monitor/validation/avui-screenshots-2026-08-10/` 下的验收截图。
- 开始与结束 SHA-256 一致（节选）：

| 文件 | SHA-256 |
|---|---|
| `src/student/pages/Home.jsx` | `155fc94be7e4124df265692b521b42721d7cbd9cc9c9ac20267ec3015363f2cc` |
| `src/student/components/reading-monitor/DailyReadingBrief.jsx` | `d204b2f700144afc3e0b4613557022a6e46ba95aeab43ef776a48425bd640acf` |
| `src/student/state/useReadingStatistics.js` | `d5c85e9e9146e78ee82bbfed5db249e21c92c4542bbe3a7e810cb8203cd58c3c` |
| `src/console/pages/ClassOverview.jsx` | `121a95434500c84d9df24e43a73745a6a5f52cc4b94dc04873f9b12813f4387a` |
| `src/console/components/reading-monitor/ReadingStatisticsView.jsx` | `422779c832b05898c0172043445ccd9a5b0086d12ac7d4dff6834fc3eb16eaac` |
| `src/console/state/useReadingStatistics.js` | `6031b6e77399634141f9a04ce945ad45216fc61f5addb069c604e5f7b297fc1f` |
| `src/api/student.js` | `078afb84b1ee3c5c7dee9db7022f443b4d7f5a40f2a2480d1b1d9b541d004880` |
| `src/api/console.js` | `fc01ca63d9cb87c5c5283a9156f9f5ee42d6c31424b128474529aeac91e707c8` |
| `tests/frontend/reading-monitor-ui-student.test.mjs` | `de3a1c30186226bb28ae7682f567d2ea0496c46109c7ef60137b60d17d249b07` |
| `tests/frontend/reading-monitor-ui-teacher.test.mjs` | `868ea84f3cadc953fa7df6c5321ee8fb094cb59d847223e388fffc11f1859681` |

## 3. 必读材料与审查范围

验收前完整重读：

- `docs/reading-monitor/IMPLEMENTATION_CONTROL.md`
- `docs/reading-monitor/G1_FROZEN_CONTRACT.md`
- 需求包 `README_先看.md` 与 01～06 全部相关材料

并审查了候选的 Home、DailyReadingBrief、ClassOverview、ReadingStatisticsView、两端状态控制器、API 端口、DTO 解析器以及现有 UI/state/completion/API 回归。

## 4. 一次性真实环境

- 临时目录：`/tmp/readmate-avui.rLwLds`
- 临时 SQLite：`/tmp/readmate-avui.rLwLds/readmate.sqlite`
- 迁移：`schema_migrations = 27`，最高 `043_reading_session_summaries.sql`
- 真实 API：`127.0.0.1:5191`
- 真实 Vite → API：`127.0.0.1:5190` → `127.0.0.1:5191`
- 浏览器：系统 Google Chrome 151，`--headless=new`，隔离 profile `/tmp/readmate-avui.rLwLds/chrome-profile`，CDP `127.0.0.1:9223`
- 数据：一个 50 名活跃学生班级、一个同组织未授权班级、一个空班级、一个跨组织班级；七个统计日为 `2026-08-04`～`2026-08-10`。
- 浏览器启动前健康检查：5190 与 5191 均 HTTP 200，响应带真实 requestId。

结束时向 API、Vite、Chrome 三个受控会话发送中断，并只读复查：

```text
5190 CLOSED
5191 CLOSED
9223 CLOSED
```

隔离 Chrome profile 进程亦已退出。

## 5. 自动化复验

### 5.1 AV-UI 聚焦回归

```bash
node --test \
  tests/frontend/reading-monitor-ui-student.test.mjs \
  tests/frontend/reading-monitor-ui-teacher.test.mjs \
  tests/frontend/reading-monitor-state-resources.test.mjs \
  tests/frontend/reading-monitor-api-contract.test.mjs \
  tests/frontend/reading-monitor-completion-semantics.test.mjs \
  tests/frontend/reading-statistics-adapter.test.mjs \
  tests/frontend/console-live-reading-eyecare-pages.test.mjs \
  tests/frontend/reading-monitor-client-reader-initial-page.test.mjs
```

结果：`31/31 PASS`，`0 fail / 0 skip / 0 todo`。

### 5.2 前端全量

```bash
npm run test:frontend
```

结果：`152/152 PASS`，`0 fail / 0 skip / 0 todo`。

### 5.3 构建

```bash
npm run build
```

结果：成功，`1737 modules transformed`。仅出现既有 `vendor-icons` chunk 大小提示，无构建错误。

自动化全绿不能覆盖第 10.1 节的真实布局缺陷；该缺陷由真实 Chrome 的几何量测和截图直接确认。

## 6. 学生 Home 验证

| 子项 | 结果 | 独立证据 |
|---|---|---|
| 真实 self ready + non-null lastReading | PASS | `internal-student` 的 Home 显示 299 秒、6 天、最近书名及最后位置；self HTTP 200。 |
| 精确继续 URL | PASS | 点击“继续阅读”落到 `/student/reader/book-cdf0dfa2df2718611c50cba4?versionId=version-cdf0dfa2df2718611c50cba4&pageNo=2`，三个参数均来自真实 self。 |
| null lastReading 去书架 | PASS | `avui-student-50` 显示“还没有可继续的最近书籍”，点击“去书架看看”落到 `/student/shelf`。 |
| Reader 返回后 fresh refresh | PASS | 进入 Reader 后产生真实 session summary（CDP 响应序号 34，requestId `4153bf19-119d-4142-8513-21fa46813c19`）；返回详情再导航 Home 后出现新的 self（序号 45，requestId `9133dd0f-3016-4998-91d4-c4a7358ac5dd`），显示由 299 秒变为 301 秒。没有等待 timeout。 |
| 299/300 秒边界 | FAIL（P1） | 视觉文字和打卡状态正确；但 299 秒的 `aria-valuenow` 已误报 100。详见 10.2。精确 300 秒真实 self 则正确显示“5分钟/已打卡/100”。 |
| 0 秒、0 streak、null dataUpdatedAt | PASS | 真实 self 显示“0分钟”“尚未形成”“暂无汇总更新时间”，没有把 null 伪造为日期。 |
| loading / empty / error / forbidden / stale 不补 0 | PASS | 聚焦 state/UI 回归覆盖全部状态；真实 Chrome另验证 error、forbidden，均显示“暂不可用/无权”，未显示 0；null ready 才显示真实 0。stale 保留旧值并显示旧数据提示的组件链路通过。 |

学生三档主状态的 `documentElement.scrollWidth === clientWidth`，均无横向溢出。

## 7. 教师 ClassOverview 验证

### 7.1 真实 scope 数据

真实 `GET /api/v1/reading/statistics/scope?classId=internal-demo-class&statDate=2026-08-10`：

```text
HTTP 200
activeStudentCount = 50
checkedInStudentCount = 37
totalEffectiveReadingSeconds = 12631
skipStudentCount = 4
rereadStudentCount = 8
students.length = 50
trend.length = 7
trend dates = 2026-08-04 ... 2026-08-10
X-Request-Id = body meta.requestId = 955acd2f-c02b-496b-a460-7cd2510ddb7f
```

真实 UI 对应显示 `74%`、`37/50`、`4分12秒`、`4人`、`8人`，七日点为 `62/64/66/68/70/72/74%`。

### 7.2 交互与状态

| 子项 | 结果 | 独立证据 |
|---|---|---|
| 班级切换 | PASS | 校长账号在 `avui-class-b` 与 `internal-demo-class` 之间切换，每次产生新的真实 scope 200。 |
| 日期切换 | PASS | `2026-08-10 → 2026-08-09 → 2026-08-10`，真实请求和 UI 统计日同步变化。 |
| 手刷 | PASS | scope 请求计数 `6 → 7`。 |
| hidden 暂停 / visible 立即刷新 | PASS | 自动化 visibility clock：hidden 后请求计数保持 `7`，visible 后 `7 → 8`。 |
| stale 保留 | PASS | 阻断下一次 scope 后仍保留 50 人/37 打卡数据，并出现“当前显示的是上一次成功读取的统计”；恢复网络后重新 ready。 |
| empty | PASS | 真实空班 scope HTTP 200：active 0、students 0、trend 7、dataUpdatedAt null；组件专项确认 UI 使用“—/空班级”，不把无分母比率伪装成 0%。空班不在 `/students` 可选项中，故浏览器 UI 状态由独立组件测试覆盖。 |
| error | PASS | 真实 Chrome 阻断首次 scope，显示“班级阅读统计加载失败/服务暂不可用”，无补 0。 |
| forbidden | PASS | 学生身份访问教师页显示明确“无权查看”，不显示空数据。 |

## 8. 权限和跨组织隔离

| 身份 / 请求 | HTTP | 结果 | requestId |
|---|---:|---|---|
| 学生请求本班 scope | 403 | `PERMISSION_DENIED` | `c1d09e1f-75ec-4b7f-9808-7f9ac34bbeef` |
| 同组织教师从一班 workspace 请求二班 | 403 | `班级不在当前工作空间权限范围内` | `9a62c262-2d5f-41eb-9169-d3b1be42fbb9` |
| 同组织教师请求跨组织 class id | 404 | `班级不属于当前组织或不存在`，无班级字段泄露 | `d70f681f-9bc8-4314-b7bf-909b1378ff0d` |

全部错误响应的 `X-Request-Id` 与 body `error.requestId` 一致。

## 9. 禁止语义、ARIA 与网络诊断

- 对学生 ready/null/error/forbidden、教师 ready/stale/error/forbidden、教师抽屉扫描：没有排行榜、最快/最慢、阅读速度、热点、待补、异常停留、页面证据、完成百分比、`finished`、`pagesRead` 或“已读完”。
- 教师姓名排序页面明确说明“只用于查找，不构成学生竞争性比较”；没有竞争性排序。
- 趋势图同时提供文字数值表；打卡、跳读、回读均有文字，不只靠颜色。
- 抽屉 `role=dialog`、`aria-modal=true`、labelledby/describedby、Tab/Shift+Tab 圈定、Escape、焦点返回在三个视口均通过；390 视口还正确锁定并自身滚动。桌面/1024 的几何与滚动容器仍失败，见 P0。
- 教师 ready 浏览器链路 console error 为 0、产品 API network failure 为 0。学生 ready 首次导航仅有 `/favicon.ico` 404（P2）；人为 403 或人为阻断请求产生的 console/network 记录属于本次错误状态刺激，已与正常态分开。

## 10. Findings

### 10.1 P0 — 桌面/1024 教师抽屉不受视口约束且滚错容器（owner：U）

精确位置：

- `src/console/components/reading-monitor/ReadingStatisticsView.jsx:384`～`455`
- 特别是 `:427`～`:440` 的 `fixed` overlay / `h-full overflow-y-auto` dialog
- 该组件在 `src/console/pages/ClassOverview.jsx:38`～`:67` 的 `PagePanel` 内容树内渲染

真实 Chrome 1440×1000 量测：

```text
body.style.overflow = hidden
dialog rect = top 85, bottom 3543, height 3458
dialog clientHeight = 3456
dialog scrollHeight = 3456
dialog.scrollTop = 0；设置 dialog.scrollTop = 800 后仍为 0

overlay rect = top 73, bottom 3555, height 3482
真正可滚祖先 .console-scroll:
  clientHeight = 928
  scrollHeight = 3508
```

1024×768 同类，dialog rect `top=85, bottom=3654.5, height=3569.5`。390×844 因页面外层在该断点改为 viewport fixed，dialog 才是正确的 `top=1, bottom=843, height=842`。

原因证据：dialog 的 fixed overlay 位于有 `backdrop-filter` / `overflow-hidden` 的 `PagePanel` 内容树内，fixed containing block 不是 viewport。结果是：

1. 抽屉自身无滚动范围；
2. 下半内容初始位于视口外；
3. 实际滚动背景 `.console-scroll` 才能移动抽屉；
4. 滚动后关闭按钮可移出视口；
5. 遮罩没有覆盖完整 viewport。

截图：`teacher-drawer-desktop.png`、`teacher-drawer-tablet.png`。

建议：将 overlay portal 到 `document.body`（或移出任何会建立 fixed containing block 的祖先），使 overlay 真正 viewport fixed；给 dialog `max-height`/`height` 绑定 viewport 并让 dialog 自身 `overflow-y:auto`；同时锁定实际的 `.console-scroll` 背景滚动容器。

### 10.2 P1 — 299 秒的进度条 ARIA 值误报 100（owner：U）

精确位置：

- `src/student/components/reading-monitor/dailyReadingBriefModel.js:91` 生成 `99.666...`
- `src/student/components/reading-monitor/DailyReadingBrief.jsx:141` 使用 `Math.round` 得到 `aria-valuenow=100`

真实页面同时显示“4分59秒”“还需1秒”“未打卡”，但 screen reader 读到 100。300 秒的 100 正确。建议对未打卡状态使用向下取整或以已完成秒/阈值作为 ARIA 值域，确保 `<300` 不宣告 100。

### 10.3 P1 — 1024 教师摘要卡出现关键孤字（owner：U）

精确位置：`src/console/components/reading-monitor/ReadingStatisticsView.jsx:108`～`:143` 的 `lg:grid-cols-4` 及卡片文本无中文防孤字策略。

1024×768 截图中，“今日打卡率”的“率”、“4分12秒”的“秒”、“今日有跳读”的“读”、说明中的“录”均独占一行。截图：`teacher-main-tablet.png`。

### 10.4 P1 — 390 学生 BottomNav 长标签逐字换行（owner：U）

精确位置：`src/student/components/BottomNav.jsx:17`～`:40`。固定 `px-8`、项内 `px-4/gap-2.5` 且标签未 `whitespace-nowrap`，390 宽时“共读社区”“个人主页”被压成近似逐字竖排。

截图：`student-299-narrow.png`、`student-null-narrow.png`。

### 10.5 P2 — 首次 ready 导航请求缺失 favicon（owner：共享壳 / I）

真实学生 ready 的 Chrome console 记录 `/favicon.ico` 404；业务 API 与页面仍正常。仓库 `index.html/public/src` 未找到 favicon 声明或资源。该项不影响本次业务数据结论，但不满足严格 console-zero。

## 11. 截图索引

目录：`docs/reading-monitor/validation/avui-screenshots-2026-08-10/`

| 场景 | 1440×1000 | 1024×768 | 390×844 |
|---|---|---|---|
| 学生 299 ready | `student-299-desktop.png` | `student-299-tablet.png` | `student-299-narrow.png` |
| 学生 300 ready | `student-300-desktop.png` | `student-300-tablet.png` | `student-300-narrow.png` |
| 学生 0/null | `student-null-desktop.png` | `student-null-tablet.png` | `student-null-narrow.png` |
| 教师 50/37 ready | `teacher-main-desktop.png` | `teacher-main-tablet.png` | `teacher-main-narrow.png` |
| 教师抽屉 | `teacher-drawer-desktop.png` | `teacher-drawer-tablet.png` | `teacher-drawer-narrow.png` |

附加状态：`student-error-tablet.png`、`student-forbidden-tablet.png`、`teacher-error-tablet.png`、`teacher-forbidden-student-tablet.png`、`teacher-stale-desktop.png`。

## 12. 最小重验范围

修复 owner：U；favicon 可由 I/共享壳独立处理。

1. 不重跑 B 160 或完整 AV-1。
2. 重新运行本次 AV-UI targeted 31、`npm run test:frontend`、`npm run build`。
3. 使用一次性真实 DB + 5190→5191 + 隔离系统 Chrome，只重验：
   - 教师抽屉 1440×1000、1024×768、390×844：overlay rect 必须完整落在 viewport，dialog `scrollHeight > clientHeight` 时自身可滚，背景 `.console-scroll` 不动；关闭按钮始终可达；Tab/Shift+Tab、Escape、焦点返回、ARIA 保持通过。
   - 1024 教师四张摘要卡无关键孤字。
   - 390 学生 BottomNav 四项单行或使用明确的窄屏布局，不逐字换行。
   - 学生真实 299/300 秒，299 的 ARIA 不得宣告 100，300 才为 100。
4. 抽查一次真实 scope 50/37 与一次真实 self/requestId，确认修复未破坏纵向链路。
5. 结束时再次确认 5190、5191、9223 全部关闭。
