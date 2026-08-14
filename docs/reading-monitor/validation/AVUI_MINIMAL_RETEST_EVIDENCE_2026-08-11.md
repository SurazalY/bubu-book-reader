# AV-UI 独立最小重验证据（2026-08-11）

## 1. 结论

**PASS**

- 首轮 AV-UI 的 1 项 P0、3 项 P1、1 项 P2 在本次独立最小重验中全部关闭。
- 真实 self/scope、防回归 requestId、299/300 边界、三档抽屉、1024 摘要卡、390 BottomNav、favicon 和 console/runtime/network 均达到门槛。
- **允许关闭 W3，并进入 G5。**
- 本次只验不修；未修改生产代码、测试、控制文档或需求包。

## 2. 重验输入与候选身份

- 首轮证据：`docs/reading-monitor/validation/AVUI_EVIDENCE_2026-08-10.md` 第 12 节。
- 分支：`codex/reading-monitor-clean-baseline`
- HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`
- 重验前独立审查最新候选 diff、新增回归断言及修复实现。
- 未读取或依赖实现方 `/tmp/readmate-avui-fix...` 作为结论依据。

候选 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `index.html` | `85e77d47af1de9a8a74218011c149c84be9266388836d39185cc49cf510cd702` |
| `src/student/components/BottomNav.jsx` | `99cc757739d50f7d80572e7ba5c93b92cd29deb90e31e0fa474db7b597dcb386` |
| `src/student/components/reading-monitor/DailyReadingBrief.jsx` | `506182d03b4bf7cbeffdc89751e9bd52bb69ae2803e801383f9858c8d464fa0e` |
| `src/student/components/reading-monitor/dailyReadingBriefModel.js` | `eef942da9582bf730f17e81ff41a2e63c58986ca77e140c32996698c4eda7f4e` |
| `src/console/components/reading-monitor/ReadingStatisticsView.jsx` | `b17d905870ce639701fafee191d5fc8085cc53ee59f6b3864fe1ce55cf24d522` |
| `tests/frontend/reading-monitor-ui-student.test.mjs` | `508784ad32f96ac167d95cb6d7005aadc9db722533ab7222f28675b35938bd47` |
| `tests/frontend/reading-monitor-ui-teacher.test.mjs` | `453795a0a08f002573d9634b9c77578b09f0ee41a50d66d8ecba9d69f18dbe29` |

## 3. 最小自动化回归

命令：

```bash
node --test \
  tests/frontend/reading-monitor-ui-student.test.mjs \
  tests/frontend/reading-monitor-ui-teacher.test.mjs
```

结果：`12/12 PASS`，`0 fail / 0 skip / 0 todo`。

本窗口没有重复 B 160、完整 AV-1 或前端全量；首轮已通过的广覆盖证据继续沿用，本次只验证修复面和一条纵向冒烟。

## 4. 独立真实环境

- 新验收目录：`/tmp/readmate-avui-retest.kVUZMa`
- 新 DB：`/tmp/readmate-avui-retest.kVUZMa/readmate.sqlite`
- 建库方式：从 V 首轮验收 DB 通过 SQLite `.backup` 克隆到新路径，不使用实现方临时 DB。
- 迁移：`27`，最高 `043_reading_session_summaries.sql`。
- 真实 API：`127.0.0.1:5191`
- 真实前端代理：`127.0.0.1:5190 → 127.0.0.1:5191`
- 浏览器：隔离系统 Google Chrome，独立 profile `/tmp/readmate-avui-retest.kVUZMa/chrome-profile`，CDP `127.0.0.1:9223`。
- 5190 与 5191 启动健康检查均 HTTP 200，并带真实 `X-Request-Id`。

非产品问题说明：首次 CDP 脚本仅等待 1 秒便查询登录表单，遇到冷启动页面尚未完成渲染；此时路由 HTTP 已为 200，页面随后正常出现。将验收脚本等待改为 2.5 秒后稳定执行，后续没有 runtime、console 或 network 失败。因此这是验收脚本时序问题，不是产品缺陷。

## 5. 299 / 300 秒与 self 冒烟

在克隆 DB 的 `avui-student-50` 上临时插入 299 秒事实，完成浏览器验证后单调更新至 300 秒；两态测完即删除临时事实，恢复 scope 的 37/50。

### 5.1 299 秒

1440×1000、1024×768、390×844 三档均为：

```text
文字：4 分 59 秒
状态：还需 1 秒 / 未打卡
aria-valuenow：99
aria-valuetext：再积累 1 秒 就达到 5 分钟
root horizontalOverflow：false
```

浏览器 self HTTP 200，示例 requestId：`656f77c6-1cf9-474d-8f09-c76d7aa4af38`。

### 5.2 300 秒

```text
文字：5 分钟
状态：已打卡
aria-valuenow：100
aria-valuetext：今日阅读积累已达到 5 分钟
root horizontalOverflow：false
```

浏览器 self HTTP 200，示例 requestId：`f253686b-35cb-4547-8044-4a2e20a20970`。

### 5.3 独立 HTTP self / scope 防回归冒烟

```text
self HTTP 200
X-Request-Id = body meta.requestId
  = 7d1d306e-38a9-41a0-86b0-e5b069a5dab6
statDate = 2026-08-10

scope HTTP 200
X-Request-Id = body meta.requestId
  = 52d6f4d6-17d6-4d48-8ada-535b0cc0cada
statDate = 2026-08-10
activeStudentCount = 50
checkedInStudentCount = 37
students.length = 50
```

结论：首轮 P1“299 秒 ARIA 误报 100”已关闭，self/scope 纵向链路未回归。

## 6. 教师抽屉三档真实 Chrome 量测

三个视口均满足：

- portal overlay 的父节点精确为 `document.body`；
- overlay 精确覆盖 viewport；
- dialog 完整位于 viewport 内，`overflow-y:auto`，`scrollHeight > clientHeight`；
- 真实 CDP wheel 后 `dialog.scrollTop > 0`；
- sticky 关闭按钮滚动后仍位于 viewport 内；
- `body.style.overflow=hidden`，所有 `.console-scroll` inline/computed overflow 均为 `hidden`；
- 抽屉打开期间真实 wheel 没有改变任一背景 scroller 或 `window.scrollY`；
- `aria-modal=true`、labelledby、describedby 均存在；
- Tab 与 Shift+Tab 均圈定在关闭按钮；Escape 关闭；焦点返回原触发按钮/卡片；
- 关闭后 body 与所有 `.console-scroll` 恢复原 overflow，背景 scrollTop 恢复为打开前的精确值。

### 6.1 数值

| 视口 | overlay rect | dialog rect | client / scroll height | wheel 后 scrollTop | 背景 scrollTop（前/中/后） |
|---|---|---|---:|---:|---|
| 1440×1000 | `0,0 → 1440,1000` | `908,12 → 1428,988` | `974 / 1037` | `63` | 主 scroller `272 / 272 / 272` |
| 1024×768 | `0,0 → 1024,768` | `492,12 → 1012,756` | `742 / 1037` | `295` | 主 scroller `584 / 584 / 584` |
| 390×844 | `0,0 → 390,844` | `0,0 → 390,844` | `842 / 1228` | `386` | 主 scroller `0 / 0 / 0` |

滚动后关闭按钮 rect：

- 1440：`1365,29 → 1397,61`
- 1024：`949,29 → 981,61`
- 390：`327,17 → 359,49`

结论：首轮 P0“桌面/1024 抽屉不受视口约束且滚错背景容器”已关闭。

## 7. 1024 摘要卡与 390 BottomNav

### 7.1 1024 教师四卡

真实 DOM 字符 rect 按 top 分行检查：

| 卡片 | 标签行 | 数值行 | 说明行 | card client/scroll width |
|---|---|---|---|---:|
| 今日打卡率 | `今日打卡率` | `74%` | `37/50 人达到 5 分钟` | `267 / 267` |
| 今日人均有效阅读 | `今日人均有效阅读` | `4 分 12 秒` | `零时长学生也进入分母` | `267 / 267` |
| 今日有跳读 | `今日有跳读` | `4 人` | `仅表示今日是否记录到跳读` | `267 / 267` |
| 今日有回读 | `今日有回读` | `8 人` | `仅表示今日是否记录到回读` | `267 / 267` |

四卡均无关键孤字、无卡内横溢；页面 root `1024/1024`，无横向溢出。首轮对应 P1 已关闭。

### 7.2 390 学生 BottomNav

四项均：

- computed `white-space: nowrap`
- 字符 rect `lineCount = 1`
- 点击区约 `86.5 × 37px`
- 每项 `clientWidth = scrollWidth = 87px`
- 四项 rect 从 `left=19` 连续排到 `right=371`，完整落在 390px viewport 内
- 页面 root `clientWidth=scrollWidth=390`，无横向溢出

“主页 / 书架 / 共读社区 / 个人主页”全部单行清晰可读；独立目视未见重叠或裁切。首轮对应 P1 已关闭。

## 8. favicon 与浏览器诊断

- `index.html` 的实际 favicon href 为 `/logo.svg`。
- 真实 5190 请求 `/logo.svg`：HTTP `200`，`Content-Type: image/svg+xml`。
- 学生 299、学生 300、教师三档主状态及抽屉的 CDP 记录：

```text
consoleErrors = []
runtimeExceptions = []
networkFailures = []
```

- 未再出现 `/favicon.ico` 404 或其他页面 console/network 错误。

结论：首轮 favicon P2 已关闭。

## 9. 独立目视与截图索引

持久目录：`docs/reading-monitor/validation/avui-minimal-retest-screenshots-2026-08-11/`

| 场景 | 1440×1000 | 1024×768 | 390×844 |
|---|---|---|---|
| 学生 299 | `student-299-desktop.png` | `student-299-tablet.png` | `student-299-narrow.png` |
| 学生 300 | `student-300-desktop.png` | — | — |
| 教师主状态 | `teacher-main-desktop.png` | `teacher-main-tablet.png` | `teacher-main-narrow.png` |
| 教师抽屉 | `teacher-drawer-desktop.png` | `teacher-drawer-tablet.png` | `teacher-drawer-narrow.png` |

逐图检查结论：无横向溢出、关键孤字、BottomNav 换行、抽屉越界、关键内容遮挡或关闭按钮不可达。

## 10. 清理

API、Vite 和隔离 Chrome 均通过受控会话停止；最终复查：

```text
5190 CLOSED
5191 CLOSED
9223 CLOSED
```

隔离 profile 进程亦已退出。

## 11. 最终门禁意见

| 首轮发现 | 本次结果 |
|---|---|
| P0：桌面/1024 抽屉错误 containing block / 背景滚动 | CLOSED |
| P1：299 秒 ARIA 误报 100 | CLOSED |
| P1：1024 摘要卡关键孤字 | CLOSED |
| P1：390 BottomNav 逐字换行 | CLOSED |
| P2：favicon 404 | CLOSED |

**AV-UI 最小重验 PASS；允许关闭 W3，并进入 G5。**
