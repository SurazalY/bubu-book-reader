# Phase 6 双模式 × 阅读计时联动验收 收口报告

> 日期：2026-08-19  
> 分支：`feat/product-close-loop`  
> 当前 HEAD：`535a943`（Phase 8 检查点 `e8cbe4e`）  
> 结论：Phase 6 机器验证（Gate A）与真人运行（Gate B）全量闭环。控制台选班持久化已最小修复并完成独立验证。未 push，不进入 Phase 7。

---

## 一、质量门实跑结果

| 质量门 | 结果 | 耗时 | 备注 |
|---|---|---|---|
| `npm run test:server` | **447/447** passed, 0 fail | ~16.7s | 新增 10 个双模式监控、D-23 隔离与工作空间排序守卫 |
| `npm run test:frontend` | **285/285** passed, 0 fail | ~0.60s | 新增 15 个遥测集成与控制台选班/工作空间持久化测试 |
| `npm run build` | **EXIT 0** | 7.79s | 生产构建正常，1757 modules transformed |


---

## 二、闸口执行与通过情况

| 闸口 | 状态 | 判定依据与实测事实 |
|---|---|---|
| **Gate A 机器验证闸口** | **PASS** | 定向测试 47/47 绿灯；独立端口 5199 + 临时隔离 SQLite 实例真实 HTTP 链路（a~h：登录、租约、双模式分账、幂等重放、300s打卡、ClassOverview 统计、旧事件流隔离、cleanup 脚本）100% 验证通过。 |
| **Gate B 真人运行闸口** | **PASS** | 用户在真实浏览器中按连续路线完成：book-001 原版 PDF 阅读 1 分钟 -> 切 OCR 文字模式 1 分钟 -> 切后台 1 分钟恢复 -> 返回详情 -> 退出重登 -> book-049 阅读并满 300s 打卡 -> 教师端 ClassOverview 查看。真库只读采样确认新会话正常 closed，逐页 coverage 分账精确落库，今日日汇总平滑累加。 |

---

## 三、T6.1–T6.8 八大硬门禁最终状态矩阵

| 门禁编号 | 门禁验收项 | 最终状态 | 证据与判定 |
|---|---|---|---|
| **T6.1** | 模式切换不重复计时 | **L3 / L4** | 机器端到端 + 用户真实验收：原版↔文字切换保持同一 sessionId 与租约，逐页 coverage 独立记录 originalMs/textMs，日汇总无跳变翻倍。 |
| **T6.2** | 切换不丢会话 | **L3 / L4** | 机器守卫 + 用户真机连续阅读：多轮定时 tick 下 revision 严格连续递增（1, 2...），服务端返回 accepted，无 REVISION_GAP。 |
| **T6.3** | 可见性与生命周期 | **L3 / L4** | 机器切后台模拟 + 用户切 Tab 实测：切后台暂停、切回恢复，点击返回以 reader_close 正常终态关闭 session，退出重登进度准确恢复。 |
| **T6.4** | 幂等性 | **L3** | 独立端口 E2E 机器实测：重放相同 revision 返回 200 `replayed`，日汇总毫秒数与逐页覆盖毫秒分秒不增。 |
| **T6.5** | 数据归属与 Phase 8 D-23 | **L3 / L4** | 机器守卫 + 用户换书实测：学生 A/B 与书目 A/B 数据完全隔离，换书生成新 session 与新租约；无授权班级/草稿/外校严格 404。 |
| **T6.6** | 统计与 300s 打卡简报 | **L3 / L4** | 机器 E2E + 用户实测打卡：学生阅读满 300s 后首页简报点亮“已打卡”，教师端 ClassOverview 同步统计到打卡学生与人均时长。 |
| **T6.7** | 旧事件不计时 | **L3** | 机器 E2E 注入实测：`POST /reading/events/batch` 仅写入护眼事件表，有效阅读秒数恒为 0，不污染阅读汇总。 |
| **T6.8** | 会话清理脚本 | **L3** | 机器临时库实测：`reading-monitor-cleanup.js` 正常按 6 个月 cutoff 清理 closed 会话、关闭历史 open 会话，exit 0 且幂等。 |

---

## 四、衍生问题排查与修复（留痕）

1. **控制台班级选择持久化与自然数字排序（T6-Fix）**：
   - 现象：刷新页面后无法停留在上次选中的班级，且拼音排序导致“二班”排在“一班”前（`èr` vs `yī`）。
   - 修复：在 `src/console/state/useReadingStatistics.js` 中引入中文与阿拉伯数字自然数序比较函数 `compareClassNames`，并通过 `localStorage`（按 `workspaceId` 隔离）持久化记忆选中的班级 ID。
   - 验证：新增前端单测 `tests/frontend/console-class-selection-persistence.test.mjs`（8/8 pass），全量测试 283/283 pass，构建 exit 0。
2. **跳读与回读判定机制明确**：
   - 明确阅读体系中仅有“跳读（hadSkip）”与“回读（hadReread）”两类行为；
   - 跳读条件：相邻翻页、停留 < 5 秒、连续 2 次触发；
   - 回读条件：回退跨度 >= 3 页建立候选、在目标页有效停留 > 30 秒，翻页或退出时结账确认。

---

## 五、不可触碰冻结契约合规声明

1. `reading_summary_sessions`、`reading_daily_book_summaries` 表结构**零改动**；
2. `POST /reading/session-summaries` 的请求 schema 与指纹算法**零改动**；
3. 租约 90 秒 TTL 与续租路由**零改动**；
4. 模式切换未产生第二份租约，未把 `readerMode` 写入摘要；
5. 唯一 reading coordinator 状态机保持完好；
6. 物理页为唯一坐标；
7. 未新增“完成度、已读百分比、读完标记”；
8. 未向真库注入伪造测试数据，历史僵尸污染按增量（Δ）口径成功验收。

---

## 六、未关闭事项与后续交接

- 本阶段不进入 Phase 7（端到端最终验收与报告），未索取真实 AI 凭据；
- 未 push 代码，未创建 PR；
- 建议提交检查点由主控向用户汇报后另行授权。
