# W4 收尾报告 · 年级维度

- 日期：2026-08-19
- 波次：W4（六项体验改造第四阶段，与 W2 并行）
- 工作区：`D:\Project\readmate-w4`（git worktree）
- 分支：`feat/w4-grade-scope`
- 基线：`ef0df7f`（与 `feat/optional-upgrade` 当时 HEAD 相同）
- 结论：**代码、守卫、抽查、回归已通过。真人三条路径已交产品负责人手工走，待其信号。T4-5 选做未做。未 push、未合并。**

---

## 一、完成的任务

| 任务 | 类型 | 结果 | 提交 |
|---|---|---|---|
| T4-1 年级维度 · 守卫（后端） | 守卫 | 新文件落地。该红的因功能未实现而红；G4-2 / G4-11 等既有不变式为绿 | `69bf411` |
| T4-3a 年级二级筛选与范围切换器 · 前端守卫 | 守卫 | 新文件落地。14 测：9 红 / 5 绿（禁令扫描预期绿） | `3160e68` |
| T4-2 年级字段与聚合接口 · 实现（后端） | 实现 | T4-1 守卫 13/13 绿。抽查 PASS | `b1442d3` |
| T4-3 注册与选班二级筛选 · 实现（前端） | 实现 | grade-filter 守卫全绿。抽查 PASS | `148b1e7` |
| T4-4 校长范围切换器 · 实现（前端） | 实现 | scope-switcher 守卫全绿。抽查 PASS | `4c19ed6` |
| T4-5 护眼管理年级筛选 | 选做 | **本波次未做**，已问产品负责人是否推迟 | — |

执行顺序按交接说明：A 并行两个守卫 → B 串行 T4-2 → C 串行 T4-3 → D 串行 T4-4 → E 回归。T4-3 与 T4-4 文件集不重叠，但为抽查归因选择串行。未调换。

文档提交（本报告与台账进度）见同分支后续 commit。

---

## 二、实际改动清单

### 数据库

- **无新 migration。** 年级维度不建表、不建列。053 仍预留给 T3-2。

### 后端（T4-2）

- `GET /students`：SELECT 增补 `grade_id`；返回项加 `gradeId` 与 `currentGrade`（调用 `computeClassLifecycle`，不复刻 9 月 1 日规则）。年级工作空间过滤仍按 `class.grade_id`。
- `inspectRegistrationToken`：`classes[]` 每项加 `currentGrade`。**只改这一处**，未在 `service.js` 增加 `changeOwnPassword` / `updateOwnProfile`。
- `server/domains/reading/statistics.js`：
  - query 白名单扩为 `classId / statDate / scopeLevel / grade`，并做语义校验（非 grade 档带 `grade`、越界 grade、未知字段仍 422）。
  - class 档行为原样（仍要 `classId`）；grade / school 档不要求 `classId`。
  - 多班过滤改 `IN (...)`；多班 `selectLastReading` 传 `classId = null`。
  - 合成 `class` 三字段：`grade:N` / `N年级（全年级）`，`school` / `全校`。
  - 比率把范围内学生汇总进同一份 `studentTotals` 后一次调用 `deriveClassReadingMetrics`；无在籍学生时仍为 `null`。
  - **授权**：在现有 `scopeAllows` 之前按工作空间拦截档位。class 工作空间请求 grade/school → 403 且无 data；grade 工作空间请求 school → 403。`permissions.js` 一行未改。

### 前端（T4-3）

- `Register.jsx`：学生/教师均为「选择年级」→ 再出现班级；未选年级不渲染班级控件；无「全部年级」；文案「一年级」～「六年级」。年级读 `GET /registration/:token` 的 `classes[].currentGrade`。
- `SelectClass.jsx`：加「选择年级」筛选；目录仍走 `GET /teacher/class-directory`（不带年级参数）；加入/退出不附加年级限制。筛选是 UI 收窄，不是权限收窄。

### 前端（T4-4）

- `useReadingStatistics.js`：`scopeLevel` / `selectedGrade` / `gradeOptions`；按档组装 query；多班档用合成 `classId` 做一致性检查；`classOptions` 仍恰好 `{ classId, displayName }`；档位记忆独立 key `readmate:console:reading_scope:`，未写入 `readmate:console:last_class:`。
- `src/api/console.js`：`getReadingStatisticsScope` 转发 `scopeLevel` / `grade`（空值不发）。
- `ClassOverview.jsx`：`showScopeSwitcher = workspace && workspace.scopeType === 'school'`。
- `ReadingStatisticsView.jsx`：班级下拉之前插入三档切换与年级下拉；用 JS 条件渲染，不用 CSS 隐藏。

---

## 三、授权范围内改了哪些既有测试，及理由

### T4-1 / T4-3a

只新增守卫文件，未改既有测试。

### T4-2 台账原列

| 文件 | 处理 | 理由 |
|---|---|---|
| `tests/server/http/reading-monitor-http.test.js` | 改白名单附近 | 后端白名单扩为四字段后，未知字段仍须 422；合法 `scopeLevel=class` 仍 200 |
| `tests/server/reading/statistics.test.js` | 改 `:411-428` 附近 | 同上；钉死 class 档不得带 `grade`。`:309-408` 未动 |
| `tests/frontend/reading-statistics-adapter.test.mjs` | **没改** | 先跑仍绿（扫前端客户端）。留给 T4-4 |
| `tests/frontend/reading-monitor-api-contract.test.mjs` | **没改** | 同上，留给 T4-4 |

### T4-4 台账原列 + 主控预授权 + 抽查追认

| 文件 | 分类 | 理由 |
|---|---|---|
| `tests/frontend/reading-monitor-ui-teacher.test.mjs` | 台账原列 | 容纳 `showScopeSwitcher`；继续断言教师视角不出现切换器、条件绑定 `scopeType === 'school'` |
| `tests/frontend/reading-statistics-adapter.test.mjs` | T4-2 留给 T4-4 | class 档仍两字段；grade/school 按档发 query |
| `tests/frontend/reading-monitor-api-contract.test.mjs` | T4-2 留给 T4-4 | query 白名单扩为四字段，仍拒绝 `studentId` 等未知字段 |
| `tests/frontend/console-class-selection-persistence.test.mjs` | 主控预授权（T4-3a 发现冲突） | `classOptions` 剥成两字段后，去掉 `entryYear`/`classNumber` 断言。`last_class` 持久化语义未动 |

adapter / api-contract 的改动行号略超出台账所写区间，T4-4 抽查追认为同一测试的契约必然扩展。

未改：四份 phase9 年级守卫（实现方只跑不改）、全部 `d21-*`、`password-reset.guard.test.js`、`permissions.js`、`reading-monitor-state-resources.test.mjs`（classOptions 两字段冻结）、那两条 D-19 frontend 测试、`src/index.css`。

---

## 四、抽查结论

| 任务 | 抽查 | 结论 |
|---|---|---|
| T4-1 / T4-3a | 阶段 A 合并抽查 | **PASS**。仅 4 个新测试文件 |
| T4-2 | 独立抽查 | **PASS**。教师 class 工作空间 grade/school 在 `scopeAllows` 之前 403；多班比率总分子/总分母一次重算；`class` 恰好三字段；`permissions.js` 无 diff |
| T4-3 | 独立抽查 | **PASS**。年级只读 `currentGrade`；选班目录与 join/leave 不带年级参数；未回头改统计页 |
| T4-4 | 独立抽查 | **PASS**。切换器 JS 条件 `scopeType === 'school'`；独立 localStorage key；未改 Register / SelectClass |

T4-2 实现前，守卫实测纠正了契约 3.4.1 对 `scopeAllows` 的乐观假设：现有 class 分支是「资源 classIds **包含** grant.scopeId 则通过」。若把全校班级一次塞进 `resourceScope`，教师会得到 200 而不是 403。产品决策（403）不变；实现放在 `statistics.js` 档位拦截，**未改 `permissions.js`**。此点已写入 T4-2 简报并经抽查核对。

---

## 五、回归

| 套件 | 结果 |
|---|---|
| `npm run test:server` | **478/478**，退出码 0 |
| `npm run test:frontend` | 301 测，299 绿，**2 失败** |
| T4-1 两个后端守卫 | 13/13，退出码 0 |
| T4-3a 两个前端守卫 | 14/14，退出码 0 |

失败仅既有 D-19 CRLF 两条。本波次 diff **不含** `src/index.css` 与这两份测试。判定：**既有、非 W4**。

`git diff ef0df7f -- server/domains/identity/permissions.js` 为空。

---

## 六、真人路径（待产品负责人信号）

**未派浏览器 agent。** 步骤清单已于 2026-08-19 交给产品负责人，待其手工走完并反馈：

1. 学生注册页先选「三年级」再选班级；未选年级时看不到班级列表。
2. 教师在「管理任教班级」里按年级筛选后能正常加入或退出班级。
3. 校长在阅读统计页把范围切到「全校」与某个年级，能看到汇总数字；教师登录同一页面看不到范围切换器。

通过后如有截图，建议放到本目录，命名沿用 `w4-*.png`。

---

## 七、遗留问题（本轮明确不做，不要顺手做掉）

| 事项 | 说明 |
|---|---|
| T4-5 护眼管理年级筛选 | 选做。本波次未做，已问产品负责人 |
| D-19 两条 frontend 测试红 | 与 W4 无关，不要借机改测试或 `src/index.css` 消红 |
| 学生端个人主页「学校」「班级」空字段 | `GET /session` 不下发，后续单独立项 |
| 年级主任 `scopeLevel=grade` | 实现将其工作空间 `scopeId`（入学届 `grade_id`）换算为 `currentGrade` 后与请求 `grade` 比对，对不上 403。契约未写死这一判定细节，抽查接受 |
| 台账 T4-3a | 本波次派工时补入；本工作区台账大表已补一行。主工作区 W2 若也改台账，合并冲突预期内 |

---

## 八、给合并回 `feat/optional-upgrade` 的提醒

**不要由 agent push / merge。时机由产品负责人决定。**

1. **`server/domains/identity/service.js` 与 W2 重叠。** W4 只改 `inspectRegistrationToken`（给 classes 加 `currentGrade`）。W2 会在同一文件新增 `changeOwnPassword` / `updateOwnProfile`。合并时应是不同函数、可自动合；若冲突，保留两边，不要丢掉任何一侧。
2. **`docs/product-close-loop/11_六项体验改造任务台账.md` 预期冲突。** 两边都会改第一节大表和「当前进度」。手工把 W2 各行实况与 W4 各行实况拼在一起即可，不要整文件覆盖。
3. **不要带上 W2 工作区的未提交文件。** 两工作区物理隔离就是为了抽查归因。合并时以 `feat/w4-grade-scope` 相对 `ef0df7f` 的五颗业务提交 + 本收口文档提交为准。
4. **`permissions.js` 必须仍无 diff。** 若合并后出现权限文件改动，先停下来。
5. 前端契约补丁：阅读统计 query 的实际组装点在 `src/api/console.js` 的 `getReadingStatisticsScope`，不只是 `useReadingStatistics.js`。已实现转发，合并时不要回退成只发 `classId/statDate`。

提交列表（相对 `ef0df7f`，不含本收口文档提交）：

```
4c19ed6 feat(grade-scope): 校长阅读统计增加年级与全校范围切换 (T4-4)
148b1e7 feat(grade-scope): 注册与选班改为年级到班级两步筛选 (T4-3)
b1442d3 feat(grade-scope): 阅读统计支持年级与全校聚合 (T4-2)
3160e68 test(grade-scope): 钉死注册选班与范围切换器前端契约 (T4-3a)
69bf411 test(grade-scope): 钉死年级维度后端契约 (T4-1)
```
