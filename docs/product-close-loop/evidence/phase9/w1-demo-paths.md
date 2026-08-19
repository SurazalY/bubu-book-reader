# W1 真人路径验证记录

- 日期：2026-08-19
- 前端：`http://127.0.0.1:5190`
- 后端：`http://127.0.0.1:5191`（health `migrations: 36`，含 051 / 052）
- 学生账号：`internal-student`（林小竹）
- 教师账号：`internal-teacher-li`（李老师）
- 口令来源：仓库根 `.env` 的 `INTERNAL_DEMO_PASSWORD`（本文不写原文）
- 浏览器：Cursor 内置浏览器 MCP 无法建标签（`No browser tab available`）。改用本机 Chrome headless 走同一套 UI。未改业务源码、测试、迁移，未跑 bootstrap。

---

## 路径 1 · 登录去学校码

**PASS**

- 打开 `/student/login`：只有「账号」「密码」，无学校码输入框（aria / placeholder / name 均不含「学校」）。
- 只填 `internal-student` 与演示口令，进入 `/student/home`（晚上好，小竹；底栏含共读社区）。

---

## 路径 2 · 共读社区发帖

**FAIL**（前半段现象成立，审核闭环与学校范围未走通）

已走通的现象：

- `/student/community` →「写一篇」：步骤为选书 / 范围 / 标题正文 / 封面，无「引文 / 带原文 / 原文」步骤。发布按钮为「发给老师看」。
- 选《和大人一起读·儿童歌谣》，班级范围，标题 `W1班级共读1787152239915`，发布成功。
- 「我的发布」显示「已提交，等老师通过」1 篇。
- 只读查库：该帖 `status=submitted`，`book_id=book-001`，`quote_book_id=NULL`。

未走通：

- 李老师打开审核详情并出现确认框「通过《W1班级共读…》」，**确认未点实**。库内该帖仍是 `submitted`。
- 随后学生端班级社区截到的是既有帖（作者 yak2 /「666」），**不是**本条 W1 帖。
- 学校范围帖未发出。

拦住的位置（环境，不是改代码去打通）：

1. 审核确认按钮第一次没点上之后准备重跑时，`credentials.updated_at` 已变：学生 `2026-08-19T15:11:47.898Z` version 2；随后教师也变成 `2026-08-19T15:15:33.650Z` version 2。`.env` 演示口令对两账号均 401「账号或密码错误」。只读查了 `login_name`，**未改密码哈希**。
2. 同期 Vite 正在热更新 W2 设置页（`AccountSettings.jsx` 一度缺失又补上），前端不稳定。
3. 未伪造「通过后可见 / 学校一审」截图。

---

## 截图清单

| 文件 | 内容 | 是否支撑结论 |
|---|---|---|
| `w1-login-page-no-school-code.png` | 学生登录页，无学校码 | 路径 1 PASS |
| `w1-student-logged-in.png` | 林小竹学生首页 | 路径 1 PASS |
| `w1-compose-no-quote.png` | 发帖页无引文步骤 | 路径 2 前半 |
| `w1-myposts-pending-review.png` | 我的发布待审 | 路径 2 前半 |
| `w1-teacher-approved.png` | 教师确认通过弹窗（**尚未确认成功**） | 只证明进了审核框 |
| `w1-community-post-visible.png` | 班级社区可见的是 yak2 旧帖，不是 W1 帖 | **不能**当通过证据 |
| `w1-school-scope-one-review.png` | 未拍 | 学校范围未走 |

同目录另有负责人归档的 `w1-login-no-school-code.png` / `w1-compose-no-quote.png` / `w1-teacher-audit.png`（账号为 yak2），与本次演示账号路径分开看。
