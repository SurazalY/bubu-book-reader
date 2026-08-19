# 给任务调度 agent 的汇报 · 直接粘贴下文

---

你是六项体验改造的任务调度。下面是 **W4（年级维度）** 的收口汇报。只读本汇报与点名文档，不要重开 W4 实施，不要自己合分支。

## 结论

W4 **已收口**。代码、守卫、独立抽查、回归、产品负责人真人三条路径全部通过。T4-5 护眼管理年级筛选选做，产品确认本波次不做。

**未 push、未合并。** 合回 `feat/optional-upgrade` 的时机仍由产品负责人决定，调度不要擅自 merge / rebase / push。

## 位置

| 项 | 值 |
|---|---|
| 工作区 | `D:\Project\readmate-w4`（独立 git worktree） |
| 分支 | `feat/w4-grade-scope` |
| 基线 | `ef0df7f`（开工时与 `feat/optional-upgrade` HEAD 相同） |
| 收口 HEAD | 该分支最新提交。5 颗业务 + 其后 docs 提交（收口报告、台账、调度交接稿） |
| 主工作区 W2 | `D:\Project\整书8.15`，分支 `feat/optional-upgrade` |
| 收口报告 | `docs/product-close-loop/evidence/phase9/w4-close-report.md` |
| 台账 | `docs/product-close-loop/11_六项体验改造任务台账.md`（W4 工作区拷贝已更新；主工作区拷贝会冲突，预期内） |

相对 `ef0df7f` 的业务提交（不要丢）：

```
4c19ed6 feat(grade-scope): 校长阅读统计增加年级与全校范围切换 (T4-4)
148b1e7 feat(grade-scope): 注册与选班改为年级到班级两步筛选 (T4-3)
b1442d3 feat(grade-scope): 阅读统计支持年级与全校聚合 (T4-2)
3160e68 test(grade-scope): 钉死注册选班与范围切换器前端契约 (T4-3a)
69bf411 test(grade-scope): 钉死年级维度后端契约 (T4-1)
```

文档提交（收口报告、台账、本交接稿）在这五颗之后，以 `git log --oneline ef0df7f..HEAD` 为准。

## 完成了什么

- T4-1 后端守卫、T4-3a 前端守卫：只新增测试。
- T4-2 后端：`GET /students` 与注册 token 补 `currentGrade`；阅读统计 `scopeLevel=class|grade|school`；多班比率总分子/总分母重算；教师请求年级/全校档 **403**（不是空数据）。无新 migration。
- T4-3 前端：注册页、选班页严格两步，年级取接口 `currentGrade`，选班筛选不收窄可加入范围。
- T4-4 前端：仅 `scopeType === 'school'` 渲染全校/年级/班级切换器；`classOptions` 仍两字段；query 经 `src/api/console.js` 转发。

回归（W4 工作区）：`test:server` 478/478；`test:frontend` 除既有 D-19 两条 CRLF 外全绿。`permissions.js` 相对 `ef0df7f` 无 diff。

真人路径（产品负责人当场）：注册先年级后班级；教师可按年级筛后加入不同年级的班；校长能看班/年级/全校三档，教师看不到切换器。

## 你现在该做的

1. **继续 W2**（三端设置与自助改密），仍在 `D:\Project\整书8.15` / `feat/optional-upgrade`。不要把 W2 的改动做到 `readmate-w4`。
2. **不要重做 W4。** 不要派 agent 去改年级筛选或范围切换器，除非产品明确返工。
3. **不要合 W4**，除非产品当场说「合」。合的时候必须人工处理下面重叠，不要让子 agent 整文件覆盖。

## 合并时必看（先记着，真合再执行）

1. `server/domains/identity/service.js`：W4 只改了 `inspectRegistrationToken`（classes 加 `currentGrade`）。W2 在同文件加 `changeOwnPassword` / `updateOwnProfile`。两边都要留。
2. `docs/product-close-loop/11_六项体验改造任务台账.md`：两边都改第一节大表和「当前进度」，冲突预期内。把 W2 各行实况和 W4 各行实况拼在一起。W4 工作区拷贝里 W2 各行仍是开工前的「待派」，**不要用它覆盖主工作区 W2 进度**。
3. `permissions.js` 合完后仍必须相对改造前无业务改动。若出现权限文件 diff，先停。
4. 不要带上 worktree 里的本地文件：`.env`、`server/data/readmate.sqlite`、曾用于 5290 端口的本地 vite 配置。这些不是 W4 交付物。
5. 053 迁移号仍归 T3-2。W4 没用迁移号。

## 调度时不要踩的坑

- **年级不是 `grade_id`。** `grade_id` 是入学届（`primary:2023`）。产品说的「三年级」是 `computeClassLifecycle(...).currentGrade`。后续任何任务不许在 `lifecycle.js` 之外再写一套 9 月 1 日规则。
- **`scopeAllows` 不会自动挡住多班。** 资源 classIds 里只要包含教师自己的班就会过。W4 是在 `statistics.js` 里按工作空间先拦截档位。不要为了「让教师看全校」去改 `permissions.js`。
- 阅读统计响应必须同形：根 7 字段，`class` 恰好 3 字段。多班用合成 `classId`（`grade:3` / `school`）。
- 前端测试「绿」= 除 D-19 两条外全绿。不许改那两条，也不许改 `src/index.css` 迁就它们。
- 登录已是两字段 `{ loginName, password }`。不要把 `schoolCode` 塞回 helper。

## T4-5

护眼管理年级筛选已登记为推迟。若产品以后要做，单独开波次，仍走守卫/实现分离，且不得改 `GET` 护眼接口的范围过滤权限语义。

## 下一波仍是谁

台账权威顺序：W2（T6）→ W3（T3，等 T6-2）→ W5（卡 T5-0 人工校徽）→ T7 全量回归。W4 已从「进行中」拿掉。
