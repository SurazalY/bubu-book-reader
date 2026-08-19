# W2 → 任务调度 agent · 汇报 prompt

把下面「汇报 prompt」整段复制给任务调度 agent。本文是仓库留痕；调度侧以粘贴的 prompt 为准。

---

## 汇报 prompt（整段复制）

```
你是六项体验改造的任务调度 agent。下面是 W2 主控的收口汇报，不是请你写代码。

项目路径：D:\Project\整书8.15
分支：feat/optional-upgrade
W2 主控已收口，请你更新全局调度状态，并准备派 W3 主控。不要亲自改业务源码、不要跑测试、不要操作浏览器、不要 git commit / push（W2 尚未提交，提交须产品负责人开口）。

═══════════════════════════════════════
一、结论
═══════════════════════════════════════

波次 W2 · 三端设置与自助改密：**已收口，验收通过。**

四个子任务全部完成：

| 任务 | 类型 | 结果 |
|---|---|---|
| T6-1 自助改密与改名接口 · 守卫 | 守卫 | 完成 |
| T6-2 自助改密与改名接口 · 实现 | 实现 | 完成，独立抽查 PASS |
| T6-3a 三端设置页 · 前端守卫 | 守卫 | 完成 |
| T6-3 三端设置页 · 实现 | 实现 | 完成，独立抽查 PASS |

回归：npm run test:server 479/479 全绿。
frontend：验收补丁后 296 测 294 绿，失败仅既有 2 条 D-19 CRLF（reader-dual-mode-contract.test.mjs、reader-text-blank-and-scroll.test.mjs）。不得借机改这两条或 src/index.css 消红。

真人路径：产品负责人 2026-08-19 当场确认，无需截图。
- 学生 / 教师 / 校长都能改密码，且新密码生效
- 改密后当前会话未被踢出
- 显示名可改

未加 migration。053 仍预留给 T3-2。

═══════════════════════════════════════
二、必读（调度与下一波次主控）
═══════════════════════════════════════

  docs/product-close-loop/11_六项体验改造任务台账.md          （权威进度；T6 四行已标完成；当前波次 W3）
  docs/product-close-loop/evidence/phase9/w2-close-report.md （收口报告：改动清单、授权测试、抽查、锚点、给 W3 的提醒）
  docs/product-close-loop/evidence/phase9/w2-human-paths.md  （真人路径记录）
  docs/product-close-loop/10_六项体验改造总体方案与契约.md    （契约未改；W3 看第 3.3 节）
  docs/product-close-loop/12_六项体验改造主控交接说明.md      （派工纪律；第四节「先开 T2」已过时，以台账为准）

═══════════════════════════════════════
三、下一波次：W3
═══════════════════════════════════════

名称：教师重置密码可见（T3-1 守卫 → T3-2 实现）
依赖：T6-2 已满足。
工作区：继续主工作区 D:\Project\整书8.15，分支 feat/optional-upgrade。
不要派进 D:\Project\readmate-w4（那是 W4）。

W3 主控简报必须写进：

1. 守卫与实现分派不同 agent；模型显式指定 cursor-grok-4.6-xhigh；禁止 composer-2.5-fast；opus 仅用户当场点名才用。
2. 迁移 053 建 issued_temp_passwords。不得占别的号。
3. T6-2 已预留 clearIssuedTempPasswordForUser（空实现）。T3-2 只替换函数体为 DELETE，不要改 changeOwnPassword 调用顺序。位置见 w2-close-report 第二节。
4. reading-monitor-migration.test.js 钉死最后一条 applied 为 052；加 053 后预授权机械更新文件名。
5. 冻结：password-reset.guard.test.js 全文、phase8-identity-list-gets.test.js:139-184、permissions.js、d21-*、T6-1/T6-3a 新守卫、两条 D-19。旧重置码接口与表一行不改。
6. 签发与 GET /users/:id/temp-password 权限必须同一套 password_reset.student.issue + scope。
7. 明文只存 issued_temp_passwords、只存教师签发的临时密码。审计/日志/列表禁明文。
8. 教师重置踢掉该学生全部会话（revokeAllSessionsForUser）。不要和 T6-2 的 revokeOtherSessionsForUser（保留当前会话）搞混。
9. 登录仍是两字段 { loginName, password }，不得把 schoolCode 塞回 helper，不得回退 HTTP shared-harness。
10. 保留 migrate.js 的 CRLF checksum 规范化。
11. 前端 client.js 已有 /me/password、/me/profile 的 session-only 白名单。不要改成给这两条补 X-Workspace-Id。
12. 浏览器验收只由产品负责人做。主控给账密与链接，不代点页面。
13. 真人验收前确认 npm run server 进程晚于本波次代码（无 --watch 的旧进程会把新路由落到 requireWorkspace，报「受保护请求必须携带 X-Workspace-Id」）。

═══════════════════════════════════════
四、并行中的 W4（不要搅在一起）
═══════════════════════════════════════

W4 在独立工作区 D:\Project\readmate-w4，分支 feat/w4-grade-scope，基线 ef0df7f。
抽查必须看本工作区相对基线的 diff。W3 与 W4 不要共用工作区。
文件重叠：server/domains/identity/service.js
- W2 已加 changeOwnPassword / updateOwnProfile
- W3 会接清除锚点 + 签发/查询临时密码
- W4 改 inspectRegistrationToken
合并时人工确认该文件。

═══════════════════════════════════════
五、仓库状态（调度不要擅自 commit）
═══════════════════════════════════════

W1 已提交：ef0df7f
W2 尚未提交。主工作区相对 HEAD 的 W2 相关改动包括：

后端：server/auth/password.js；server/domains/identity/index.js、repository.js、service.js
前端：src/api/auth.js、client.js；StudentApp.jsx、pages/Me.jsx；console ConsoleApp.jsx、TopBar.jsx、consoleAccess.js
新建：src/student/pages/settings/AccountSettings.jsx；src/console/pages/Settings.jsx
删除：src/student/pages/Settings.jsx；src/console/pages/Me.jsx
测试新建：tests/server/core/phase9-identity-guards/self-service-me-password-profile.guard.test.js；tests/frontend/phase9-settings-pages.guard.test.mjs
测试修改：session-only.guard.test.js、security.guard.test.js（只追加路径）；stage5-route-wiring、student-logout、student-curl-flip-hidden、console-zero-fixture（授权清单）；api-contract.test.mjs（验收补丁追认）
文档：11_ 台账；evidence/phase9/w2-close-report.md、w2-human-paths.md、w2-scheduler-handoff.md

同工作区还有 W1 证据残留（若干 w1-*.png / w1-demo-paths.md），不要算进 W2 提交，除非负责人要求一并归档。

═══════════════════════════════════════
六、仍挂起、不要派 W2 主控去顺手做的
═══════════════════════════════════════

- T5-0 校徽素材：人工描 SVG，卡住 T5-1，可与 W3 并行催人
- D-19 两条 frontend 红：与本轮无关
- 学生主页「学校」「班级」空：GET /session 不下发，本轮明确不做
- TopBar「个人资料暂未开放」禁用钮：非本轮

═══════════════════════════════════════
七、请调度做的事
═══════════════════════════════════════

1. 把全局状态记为：W1 收口、W2 收口、当前可派 W3，W4 继续独立工作区并行。
2. 派 W3 主控时，把上面「三、下一波次」整节写进它的开工简报，并要求先读 10_ 第 3.3 节、11_ 的 T3-1/T3-2、w2-close-report 第八节。
3. 不要派 W2 主控做收尾以外的新开发。
4. 未经产品负责人不要 commit W2。
```
