# Phase 6 双模式 × 阅读计时联动验收 执行台账

- **阶段**：Phase 6（双模式 × 阅读计时联动验收）
- **项目**：`D:\Project\整书8.15`
- **分支**：`feat/product-close-loop`
- **接手 HEAD**：`535a943`
- **Phase 8 实现检查点**：`e8cbe4e`
- **接手时间**：2026-08-18

---

## 1. 冻结契约与红线速查

1. **阅读计时摘要真值模型冻结**：
   - 不改 `reading_summary_sessions`、`reading_daily_book_summaries` 表结构；
   - 不改 `POST /reading/session-summaries` 的请求 schema 与指纹算法；
   - 租约 90 秒 TTL 与续租路由不动；
   - 模式切换不得产生 `book_change`、第二份会话或第二份租约，亦不得把 readerMode 写入摘要。
2. **唯一 reading coordinator 状态机**：双模式（PDF 引擎与文字引擎）共用唯一 coordinator。
3. **物理页作为唯一页码**：不引入第二套坐标，block 几何保持 audit-only。
4. **旧事件流语义**：`reading/events/batch` 只用于护眼，有效阅读秒数恒为 0。
5. **D-23 现行口径（Phase 8 继承）**：学生获取租约必须满足“已发布 AND 对当前班级存在显式 grant”，无 grant/draft/外校均 404 且不建租约。测试夹具必须显式建立全套关系，不得绕过。
6. **验收口径与已知偏差**：
   - 单设备、单浏览器标签验收；D-12 跨设备真冲突挂起不阻塞；
   - 真库约 194544ms 历史僵尸数据不清理；
   - 计时采用增量验收（baseline → 前台阅读 → 比较增量，允许 ±15s 调度余量）；
   - 如实记录 K-01～K-06。

---

## 2. 任务包执行记录

| 任务包 | 负责人 / Agent | 模型 | 输入检查点 | 改动范围 | 测试结果 | 机器实测 / 真人实测 | 是否命中停止条件 | 状态 |
|---|---|---|---|---|---|---|---|---|
| T6.0 基线与覆盖核对 | T6.0 基线 Agent | gemini-3.7-flash-high | 535a943 | 无（只读） | server 437/437, frontend 270/270, build exit 0 | 机器实测：5191 正常 (migrations 34)、真库 34 迁移完整、49 本书就绪、T6.1-T6.8 覆盖与切分矩阵就绪 | 否 | 已完成 |
| T6-Guard 契约与行为测试补全 | T6-Guard 守卫 Agent | gemini-3.7-flash-high | 535a943 | 仅新增前后端 13 个守卫用例 | server 445/445 (+8), frontend 275/275 (+5) 全绿 | 机器实测：T6.1-T6.8 八大门禁定向守卫与契约全部通过，无业务代码修改 | 否 | 已完成 |
| T6-Verify 独立机器验证与 Gate A 审核 | T6-Verify 验证 Agent | gemini-3.7-flash-high | 535a943 | 无（只读/独立验证） | 定向 47/47，server 445/445，frontend 275/275，build exit 0 | 机器实测：独立端口 5199 + 临时隔离 SQLite 端到端 HTTP (a~h 全链路) 100% 验证通过，Gate A **PASS** | 否 | 已完成 |
| T6-User 真实浏览器连续验收 (Gate B) | 用户 (真人) + 主控采样 | 用户操作 | 535a943 | 无 | 用户完成单连续浏览器阅读、模式切换、退出重登与 5 分钟打卡操作 | 真人实测：真库生成新 session，PDF/文字分别分账累计，会话正常 closed，Gate B **PASS** | 否 | 已完成 |
| T6-Fix 控制台班级自然排序与选班记忆 | T6-Fix 实现 Agent + T6-Fix-Verify 验证 Agent | gemini-3.7-flash-high | 535a943 | `src/console/state/useReadingStatistics.js` + 对应前端测试 | 前端 283/283 (+8), 服务端 445/445, build exit 0 | 机器实测：一班自然排在二班前，选班按 workspaceId 写入/恢复 localStorage，0 业务回归 | 否 | 已完成 |

---

## 3. T6.0 基线核对结论摘要

1. **Git 与检查点**：分支 `feat/product-close-loop`，HEAD `535a943`，Phase 8 关键检查点 `e8cbe4e` 真实存在。工作区干净无脏文件。
2. **现网服务与真库**：5191 正常运行，真库 000-050 完整（34 个迁移），包含 49 本已发布图书与 49 份本班 grant。真库包含历史数据（约 194544ms 历史僵尸数据），不清理，采用增量（Δ）验收口径。
3. **既有覆盖与切分**：
   - T6.1–T6.8 各项均有已有单测/集成测试支撑，且 T6-Guard 已补齐双模式切换、连续 revision、生命周期、幂等性、300s打卡与清理脚本等 13 条关键守卫；
   - 机器验证（T6.1–T6.8 契约、幂等、归属、旧事件、清理脚本）完全在临时库与独立环境由守卫与独立验证 Agent 验证；
   - 真人验证仅保留用户浏览器内的单标签视觉观感、模式切换、退出重登与 5 分钟打卡体验。

---

## 4. T6-Guard 守卫测试补齐摘要

- **新增测试文件**：
  1. `tests/frontend/phase6-reader-telemetry-integration.test.mjs`（5 个用例）：模式切换无新会话/租约、连续 revision 递增、切后台暂停/切回恢复/关闭收尾、双模式分账、换书会话隔离。
  2. `tests/server/reading/phase6-dual-mode-monitoring-guards.test.js`（8 个用例）：逐页分账入库与日汇总 delta 累加、连续 revision 校验与 GAP/REGRESSION 拒绝、终态置 closed 与重登恢复、幂等 replayed/superseded、D-23 权限隔离与 404 拒绝、300s 打卡布尔值翻转与教师端 ClassOverview 统计联动、旧事件 batch 恒 0 秒、cleanup 脚本 6 个月 cutoff 与幂等。
- **质量门变化**：
  - `npm run test:server`: 437 -> **445** (pass 445, fail 0)
  - `npm run test:frontend`: 270 -> **275** (pass 275, fail 0)
  - 业务代码无修改，契约全部绿灯。

---

## 5. T6-Verify 独立机器验证与 Gate A 审核结论

- **定向测试集**：47/47 全部通过（前端遥测 5/5、服务端双模式守卫 8/8、前端双模式契约 10/10、服务端监测基线 24/24）。
- **全量质量门**：`test:server` 445/445 (16.84s), `test:frontend` 275/275 (0.53s), `build` 退出码 0 (8.24s)。
- **独立端口 (5199) + 隔离临时库 E2E HTTP 真实调用链**：
  - a. 学生登录获取 Token：200 OK；
  - b. 申请阅读租约：200 OK；
  - c. 提交双模式 coverage 摘要 (Rev 1, 120s)：200 `accepted`；
  - d. 相同摘要重放：200 `replayed`，DB 直查日汇总 120,000ms 守恒；
  - e. 提交 Rev 2 满 300s：200 OK，`isDailyGoalMet: true`；
  - f. 教师调用 `/reading/statistics/scope`：200 OK，打卡学生 1/1，人均时长 300s；
  - g. 旧事件流 `events/batch`：200 OK，阅读秒数恒为 0，不污染汇总；
  - h. 清理脚本 `reading-monitor-cleanup.js`：exit 0，JSON 正常。
- **Gate A 判定**：**PASS（全部放行）**。
- **合规审计**：未修改业务源码，未弱化断言，未破坏冻结契约。

---

## 6. Gate B 真人浏览器验收与数据采样证据

- **验收路线**：用户按照单连续路线（登录 -> book-001 原版 PDF 读 1 分钟 -> 切文字模式读 1 分钟 -> 切后台 1 分钟恢复 -> 返回详情 -> 退出重登 -> book-049 阅读并满 300s 打卡 -> 教师端 ClassOverview 查看）完成了全套操作。
- **真库实测数据（只读采样）**：
  - 产生真实已关闭会话：`reading-session-50558450-0d73-4d1b-a621-500addbc7a3f`（`book-049-trusted-v1`）；
  - `status`: `closed`, `end_reason`: `reader_close`；
  - 双模式分账逐页落库：第 19 页与 20 页均记录 `effective_original_ms: 1354`、`effective_text_ms: 2273`，第 21 页与 22 页记录 `effective_original_ms: 5444`、`effective_text_ms: 0`；
  - 今日日汇总正常累加，无跳变、无重复，Gate B **PASS**。

---

## 7. 衍生问题排查与最小闭环（T6-Fix 留痕）

1. **问题 1（控制台班级选择持久化与拼音排序 -> V2 根治）**：
   - 现象：刷新页面后无法停留在上次选中的班级，且拼音排序导致“二班”排在“一班”前（E vs Y）。
   - 初版修复（V1）：在前端 `useReadingStatistics.js` 引入中文数字自然排序与 localStorage 记忆。
   - 真实环境复测暴露深度根因（V2）：
     * 后端 `listWorkspacesForUser` 仅按 `workspaces.code, workspaces.name` 排序，SQLite 中英文字符 'T'（T89验收二班）排在汉字 '公'（公共领域素材联调班级/一班）前，导致后端下发的第 0 个默认工作空间是二班；
     * 前端 `ConsoleContext.jsx` 未持久化用户切换的工作空间，Ctrl+Shift+R 硬刷新后不可逆回落到默认工作空间（二班），且该工作空间只包含二班学生；
     * 后端 `/students` 缺少结构化 `class_number`、`entry_year` 排序字段。
   - 终版根治（V2）：
     * 服务端 `listWorkspacesForUser` 与 `/students` LEFT JOIN `classes` 按 `classes.entry_year, classes.class_number` 结构化自然排序，确保一班物理居首；
     * 前端 `ConsoleContext.jsx` 增加 `readmate:console:last_workspace` 存储记忆，硬刷新保持当前工作空间；
     * 重启 5191 进程并实测 `/api/v1/students` 输出 `['三年级一班 (classNumber: 1)', 'T89验收二班 (classNumber: 2)']`；
     * 测试：服务端 447/447，前端 285/285，构建 exit 0，检查点 `5e096a8`。
2. **问题 2（跳读与回读行为判定机制明确）**：
   - 明确体系中仅有“跳读（hadSkip）”与“回读（hadReread）”两类行为。
   - 跳读：相邻翻页、停留 < 5s、连续 2 次触发；
   - 回读：往回翻退跨度 >= 3 页建立候选、在目标页有效停留 > 30s，离开该页或关闭阅读器时结账确认。
   - 教师端正常在顶部指标卡片、学生列表筛选与状态标签中消费展示这两类指标。

---





