# W5 调度汇报稿 · 校徽落位

```yaml
日期: 2026-08-20
波次: W5（校徽落位）
工作区: D:\Project\整书8.15
分支: feat/optional-upgrade
开工基线: 5943dacc24b867f29ad8705154243c38e90521fa（短 5943dac）
抽查: PASS
提交: 未 commit / 未 push
```

把下面「汇报 prompt」整段复制给任务调度 agent。本文是仓库留痕；调度侧以粘贴的 prompt 为准。只报事实，调度决策由调度 agent 自己做。

---

## 汇报 prompt（整段复制）

```
你是六项体验改造的任务调度 agent。以下是 W5（校徽落位）主控的收口汇报，只含事实与风险。调度决策由你做。

身份：
- 工作区 D:\Project\整书8.15（不要去 D:\Project\readmate-w4，也不要碰 feat/w4-grade-scope）
- 分支 feat/optional-upgrade
- W5 开工基线 5943dacc24b867f29ad8705154243c38e90521fa（短 5943dac）
- 更早节点：ef0df7f W1；c918037 W2；f4cfefa W4 合并；51c255d W3；f795e48 T5-0 品牌资产；5943dac 流程文档
- W5 业务+文档均未 commit / 未 push；提交由产品负责人决定

本波结论：
- T5-0 已在 f795e48 提交（原图去白底透明 PNG，不是 SVG）。10_ 里「T5-0 交 SVG」已过时，以 11_ 为准。
- T5-1a：新增 tests/frontend/phase9-brand-placement.guard.test.mjs（G5-1～G5-5），实现方未改该文件。
- T5-1：两端 Login 顶部 lockup（240×74，srcset 2x）；两端 BrandMark（mark@128 + wordmark；控制台徽标钉死 32px，showText=false 只留徽标）；index.html favicon → /brand/peixin-favicon.png，title 未改。
- 独立抽查（未参与实现的 agent，相对 5943dac）PASS。四件重点均为否：未越界改文案、未碰 server/、未动冻结文件、未破坏两个 Login 的 W3 忘记密码改动。ForgotPassword.jsx 无 diff。permissions.js 相对 ef0df7f 仍为空。
- 真人验收未走。

回归：
- 开工（HEAD=5943dac、工作区干净）：server 503/503；frontend 316 测 314 绿，失败仅 reader-dual-mode-contract.test.mjs 与 reader-text-blank-and-scroll.test.mjs（D-19 CRLF）。
- 收口：server 503/503；frontend 321 测 319 绿。失败仍恰好那两条 D-19。判定 REGRESSION_PASS。

未提交文件（相对 5943dac，git status --short）：
 M docs/product-close-loop/11_六项体验改造任务台账.md
 M docs/product-close-loop/12_六项体验改造主控交接说明.md
 M index.html
 M src/console/components/BrandMark.jsx
 M src/console/pages/Login.jsx
 M src/student/components/BrandMark.jsx
 M src/student/pages/Login.jsx
 M tests/frontend/reading-monitor-ui-student.test.mjs
?? docs/product-close-loop/evidence/phase9/w5-close-report.md
?? docs/product-close-loop/evidence/phase9/w5-scheduler-handoff.md
?? tests/frontend/phase9-brand-placement.guard.test.mjs

授权改动的既有测试：reading-monitor-ui-student.test.mjs 只改一行 favicon 期望（该测试把 index.html 当 fixture）。根因：T5-1a/T5-1 只跑新守卫，收口全量 frontend 才暴露。未削弱 Home/self resource/继续阅读 URL 断言。未改 D-19。

共享与重叠的客观事实（不是下一波任务）：
- ForgotPassword.jsx / Register 等文件无 diff，但共用 BrandMark，打开会看到新字标。
- PrimaryRail.jsx 未改，仍传 size={30}；控制台 BrandMark 忽略该 size，渲染 32px。
- 两个 Login.jsx 现叠着 W3 忘记密码入口与 W5 品牌区。
- 新增冻结守卫：phase9-brand-placement.guard.test.mjs；reading-monitor-ui-student.test.mjs 现在钉新 favicon。
- 最大迁移号仍 053；本波无 migration、无 server 改动。
- public/logo.svg 仍在，本波未清理。
- preview.html 与 scripts/build-brand-assets.mjs 在 f795e48，本波未改。

本波明确没做：
- 全局替换「读伴」
- 清理旧品牌资产
- 处理 D-19 两条红
- 产品关闭前的全量回归
- 学生主页「学校」「班级」空字段
- 改界面主色去对齐 #D61917
- 暗色主题第二套资产

验收现场（事实）：
- 前端 Vite 于 2026-08-20 12:57 新起，PID 112964，端口 5190，晚于本波次 12:44 代码。旧终端 npm run dev 当时 PID 已死。
- 学生 http://127.0.0.1:5190/student/login ；控制台 http://127.0.0.1:5190/console/login
- 账号 internal-student / internal-teacher-li / internal-principal；口令只在仓库根 .env 的 INTERNAL_DEMO_PASSWORD（不要把口令写入本文件）
- 后端 5191 PID 120548，自 10:52 起未因本波重启

权威文档路径：
- docs/product-close-loop/11_六项体验改造任务台账.md
- docs/product-close-loop/evidence/phase9/w5-close-report.md
- docs/product-close-loop/evidence/phase9/w5-scheduler-handoff.md

纪律提醒（给调度，不是给下一波主控列任务）：
- 工作区现有未提交 W5 改动。若再开新波次实现，未提交 diff 会污染「相对基线的抽查」。W1 已因此调过一次排期。
- 提交前 git status 除 .env 与 server/data sqlite 外应能解释清每一行。
- composer-2.5-fast 禁用；派子 agent 必须显式指定 cursor-grok-4.6-xhigh。
```
