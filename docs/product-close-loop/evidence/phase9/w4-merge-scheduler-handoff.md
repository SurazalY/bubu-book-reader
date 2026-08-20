# W4 合并执行 → 任务调度 agent · 汇报 prompt

把下面「汇报 prompt」整段复制给任务调度 agent。本文只覆盖合并执行这一件事。

---

## 汇报 prompt（整段复制）

```
你是六项体验改造的任务调度 agent。下面是【W4 合并执行】的汇报，不是请你写代码，也不是下一波次开工简报。

我只负责把 feat/w4-grade-scope 合并进 feat/optional-upgrade。W2 / W4 各自的收口、真人验收、下一波次怎么派，不在本汇报范围内。

═══════════════════════════════════════
一、结论
═══════════════════════════════════════

合并已完成，无需返工。未 push。未删除 feat/w4-grade-scope。未删除 D:\Project\readmate-w4。

工作区：D:\Project\整书8.15
分支：feat/optional-upgrade
merge commit：f4cfefa
其后 docs 提交：a0b3a5a（合并报告）
当前 HEAD：a0b3a5a
共同基线：ef0df7f

合并报告：docs/product-close-loop/evidence/phase9/w4-merge-report.md

═══════════════════════════════════════
二、冲突
═══════════════════════════════════════

预期之外的冲突没有。实际：

- server/domains/identity/service.js：自动合并成功。人工核对后三处都在：
  W2 的 changeOwnPassword、updateOwnProfile（含清除临时密码空实现锚点），
  W4 的 inspectRegistrationToken.currentGrade。
- docs/product-close-loop/11_六项体验改造任务台账.md：有冲突，按两边进度拼在一起。
  W2 的 T6 完成行没有被 W4 拷贝里过时的「待派」覆盖；
  T4-1～T4-4 标完成；T4-5 标推迟。

═══════════════════════════════════════
三、静态核对与回归
═══════════════════════════════════════

四项静态核对通过：
- service.js 四处全在
- git diff ef0df7f -- server/domains/identity/permissions.js 为空
- 未带入 .env、sqlite、本地 vite 配置
- 迁移最大号仍是 052

回归数量：
- server：基线 465 / W2 479 / W4 478 / 合并后 492/492 全绿（465+14+13）
- frontend：合并后 310 测、308 绿；失败仅既有 2 条 D-19 CRLF
  （reader-dual-mode-contract.test.mjs、reader-text-blank-and-scroll.test.mjs）
  本轮未改这两条测试，也未改 src/index.css。

本轮未做浏览器验收。

═══════════════════════════════════════
四、请调度记下的仓库事实
═══════════════════════════════════════

1. W4 代码已在主线 feat/optional-upgrade 上，不要再派一次合并。
2. feat/w4-grade-scope 与 D:\Project\readmate-w4 仍在。push、删分支、删 worktree 等产品负责人开口。
3. 后续若有人改 server/domains/identity/service.js：该文件现在同时有自助改密和注册 token 的 currentGrade，不要误伤。
```
