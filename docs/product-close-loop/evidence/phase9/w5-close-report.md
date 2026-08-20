# W5 收尾报告 · 校徽落位

- 日期：2026-08-20
- 波次：W5（六项体验改造第五阶段 · 校徽落位）
- 工作区：`D:\Project\整书8.15`
- 分支：`feat/optional-upgrade`
- 开工基线：`5943dacc24b867f29ad8705154243c38e90521fa`（短 `5943dac`）
- 结论：**代码已落位；T5-1a 守卫 5/5 绿；独立抽查 PASS；回归 server 503/503、frontend 321 测 319 绿（失败仅既有 D-19 两条）；真人验收待产品负责人；未 commit / 未 push。**

---

## 一、完成的任务

| 任务 | 类型 | 结果 |
|---|---|---|
| T5-0 校徽素材预处理 | 人工 | **完成**。PNG-32 带 alpha 方案，已在基线前提交 `f795e48 feat(brand): 新增培新教育透明 PNG 品牌资产 (T5-0)`。本波次未再改 `preview.html` 与 `scripts/build-brand-assets.mjs` |
| T5-1a 校徽落位 · 前端守卫 | 守卫 | 新文件 `tests/frontend/phase9-brand-placement.guard.test.mjs`。G5-1～G5-5 共 5 条，实现后 **5/5 绿**。实现方不得改它 |
| T5-1 品牌落位 · 实现 | 实现 | 登录 lockup、两端 BrandMark、标签页图标。抽查 **PASS**。待产品负责人真人验收。未 commit |

T5-0 已在开工基线 `5943dac` 内。本波次做了 T5-1a 守卫 + T5-1 落位。浏览器验收只由产品负责人做，主控不代点。

---

## 二、实际改动清单

相对开工基线 `5943dac` 的工作区改动。

### 数据库 / 后端

无。无新迁移（最大号仍 **053**）。未碰 `server/`。

### 前端

- `index.html`：favicon 改为 `/brand/peixin-favicon.png`，`type=image/png`；`<title>` 未改。
- `src/student/pages/Login.jsx`、`src/console/pages/Login.jsx`：顶部 lockup `240×74`，`src` → `peixin-lockup@720.png`，`srcset` 2x → `peixin-lockup.png`，`alt=培新教育`。W3 忘记密码行未动。
- `src/student/components/BrandMark.jsx`、`src/console/components/BrandMark.jsx`：`peixin-mark@128.png` + `peixin-wordmark.png`。控制台徽标钉死 32px，`showText=false` 只留徽标。
- 资源引用均为 `` `${import.meta.env.BASE_URL}brand/...` ``，未 `import` PNG。

### 测试

- 新增 `tests/frontend/phase9-brand-placement.guard.test.mjs`（T5-1a，G5-1～G5-5）。
- 既有测试 `tests/frontend/reading-monitor-ui-student.test.mjs` 只改一行 favicon 期望。

---

## 三、授权范围内改了哪些既有测试，及理由

台账 T5-1 授权清单原为空。收口全量 frontend 才暴露一处既有测试把 `index.html` 当 fixture、仍匹配 `/logo.svg`。

| 文件 | 分类 | 理由 |
|---|---|---|
| `tests/frontend/reading-monitor-ui-student.test.mjs` 约 146 行 | 收口发现、改期望 | 该测试扫描 `index.html` 的 favicon。T5-1 把链接改成 `/brand/peixin-favicon.png` 后这一条红。处理是改测试期望一行对齐新 favicon，**不是**把 favicon 改回 `logo.svg`。未削弱 Home / self resource / 继续阅读 URL 断言 |

**踩坑 / 根因**：T5-1a / T5-1 按简报只跑新守卫，收口全量 frontend 才暴露上述写死旧 favicon 的断言。

未改：D-19 两条、W1–W4 守卫、T5-1a 守卫文件本身。

---

## 四、抽查结论

| 任务 | 抽查 | 结论 |
|---|---|---|
| T5-1a + T5-1 | 独立抽查（相对 `5943dac`） | **PASS** |

四件重点：

- 未越界改文案（「读伴」未做全局替换）。
- 未碰 `server/`。
- 未动冻结文件。
- 未破坏两个 `Login.jsx` 的 W3 忘记密码改动。

`ForgotPassword.jsx` 无 diff。`permissions.js` 相对 `ef0df7f` 仍为空。

---

## 五、回归

| 套件 | 开工基线（HEAD `5943dac`、工作区干净时） | 收口 |
|---|---|---|
| `npm run test:server` | **503/503** | **503/503** |
| `npm run test:frontend` | 316 测 314 绿，失败仅 D-19 两条 | **321 测，319 绿**（+5 条新守卫），失败仍恰好 2 条 |

失败仍恰好：

- `tests/frontend/reader-dual-mode-contract.test.mjs`
- `tests/frontend/reader-text-blank-and-scroll.test.mjs`

判定：**REGRESSION_PASS**（前端「绿」= 除既有 D-19 外全绿）。diff 不含 `src/index.css` 与那两份 D-19 测试。

---

## 六、真人路径（产品负责人本人走，主控不代点）

**尚未走。** 待产品负责人本人确认。不要求截图。

路径：

- 学生登录：http://127.0.0.1:5190/student/login
- 控制台登录：http://127.0.0.1:5190/console/login

账号：`internal-student`（学生）、`internal-teacher-li`（教师）、`internal-principal`（校长）；口令见仓库根 `.env` 的 `INTERNAL_DEMO_PASSWORD`。

看：登录页 lockup、侧栏展开/收起态徽标、标签页图标是否已变。

抽查时发现：终端里 `npm run dev` 元数据仍 running，但 PID 已死、5190 未监听，且该进程启动于 2026-08-19，早于本波次 12:44 的代码。W2/W3 都曾因旧进程误判。验收前必须新起前端 dev server。

---

## 七、遗留问题（本轮明确不做，不要顺手做掉）

| 事项 | 说明 |
|---|---|
| 未做全局「读伴」替换 | 品牌落位范围限定为登录页、侧栏、标签页图标 |
| 未清理 `public/logo.svg` | 文件仍在仓库 |
| 未处理 D-19 两条红 | 与 W1/W2/W3/W4 相同。diff 未含那两份测试与 `src/index.css` |
| 未做产品关闭前的全量回归 | 本波次范围外 |
| 未处理学生主页「学校」「班级」空字段 | `GET /session` 不下发。本轮不做 |
| 未改界面主色去对齐 logo 红 `#D61917` | 未改界面主色，也未改 PNG 颜色（logo 红为原图 `#D61917`，与界面主色 `#E31E24` 不同，属已接受差异）。 |
| 暗色主题未出第二套资产 | 当前暗色禁用 |
| `preview.html` 与 `build-brand-assets.mjs` 未改 | 已在 `f795e48`（T5-0） |
| 未碰 `server/` | 无后端 diff |
| 未碰 `feat/w4-grade-scope` 与 `D:\Project\readmate-w4` | 仍在 |

---

## 八、事实型备注

- 共享 `BrandMark`：`ForgotPassword.jsx` / Register 等未改文件，会因共享组件换成 PNG 字标（文件无 diff）。
- `PrimaryRail.jsx` 未改，仍传 `size={30}`；控制台 `BrandMark` 忽略该 `size`、渲染 32px。
- 学生端 `BrandMark` 仍吃调用方 `size`。
- 新增冻结守卫：`tests/frontend/phase9-brand-placement.guard.test.mjs`。
- `reading-monitor-ui-student.test.mjs` 现在钉的是新 favicon。
- 最大迁移号仍 **053**。
- 与后续可能重叠的文件：两个 `Login.jsx`（已含 W3 忘记密码 + W5 品牌区）、两端 `BrandMark.jsx`、`index.html`。

---

## 九、文档留痕

| 文件 | 作用 |
|---|---|
| `docs/product-close-loop/evidence/phase9/w5-close-report.md` | 本报告 |
| `docs/product-close-loop/evidence/phase9/w5-scheduler-handoff.md` | 给任务调度 agent 的汇报稿（本目录新增） |
| `docs/product-close-loop/11_六项体验改造任务台账.md` | 大表 T5-0 / T5-1 / T5-1a 状态；T5 方案变更决策；风险「校徽脚本抠图边缘脏」已关闭 |
| `docs/product-close-loop/12_六项体验改造主控交接说明.md` | 顶部进度戳已更新 |

未改 `10_` 契约。`10_` 里 T5-0 交付 SVG 的描述已过时，以台账与本报告为准。W5 **尚未 git 提交 / 未 push**。
