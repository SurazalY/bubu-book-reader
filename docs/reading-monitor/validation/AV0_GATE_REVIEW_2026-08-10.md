# AV-0 独立开工门禁复核

> 复核日期：2026-08-10
> 复核角色：`/root/av0_gate_review`（独立验收，只读生产代码与测试）
> 基线分支：`codex/reading-monitor-clean-baseline`
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`
> 结论：**PASS**

## 1. 门禁结论

AV-0 通过。G0 证据足以证明当前干净基线可测试、可构建、可迁移、可真实启动，且关键学生/教师路由能够在浏览器中运行；G1 最新冻结契约已把需求包与当前源码之间会阻碍单义实现的冲突冻结到可执行程度。未发现 P0、文件并发冲突或需要用户作产品/权限/隐私选择的真实阻塞。

允许主控把以下首轮任务从 `pending` 转为 `ready`，并占用三个子槽并行开工：

- B：G2-01～G2-15、G2-17；
- C：G3-01～G3-12；
- U：G4-02、G4-05～G4-09。

本结论只放行 W1。G2-16、G3-13/G3-14、依赖真实状态/API 的 G4 项、G5-01 和 G5-11 仍必须按 W2a、W2b、AV-1、W3a、W3b、W3c 的冻结顺序执行，不能借 AV-0 提前开工或标记完成。

## 2. 复核范围与方法

已完整阅读：

- `docs/reading-monitor/IMPLEMENTATION_CONTROL.md`；
- `docs/reading-monitor/G1_FROZEN_CONTRACT.md`；
- `docs/reading-monitor/validation/AV0_BASELINE_RUNTIME_EVIDENCE_2026-08-10.md`；
- `简化版阅读监测_新基线开发包_2026-08-10/README_先看.md`；
- 需求包 `01`～`06`，重点交叉核对接管/迁移、采集与上传、数据/API、学生/教师 UI、测试验收和并发组织。

另外只读抽查了当前迁移、阅读事件与租约领域、Reader/telemetry、共享投影与 adapter、学生/教师受影响页面、运行时 import/storage 门禁和现有 HTTP 集成测试。遵照任务约束，没有重跑前端/后端全量测试或生产构建；G0 的全量结果采用既有基线记录，独立复核集中在证据一致性、源码边界和冻结契约可实施性。

复核时三个权威证据文件的 SHA-256：

```text
8e654ccd38d758d4a8858c3acdcb0a7752f7c8a5da1af1a2a828794eaa2525ae  IMPLEMENTATION_CONTROL.md
13c0fb078bc7829df7e07b4634ec7e68bd6f84a0c45bb3578aa2415295941785  G1_FROZEN_CONTRACT.md
176e8fc224afea17a01e0ca4bfaf069c2648d92c62ce15d1d6474437239d4334  AV0_BASELINE_RUNTIME_EVIDENCE_2026-08-10.md
```

## 3. 检查点结果

| 检查点 | 结论 | 独立核验摘要 |
| --- | --- | --- |
| G0 证据充分性 | PASS | 控制账本记录前端 91/91、服务端 139/139、生产构建通过；运行证据记录临时库顺序应用 26 个迁移、服务端/Vite 真实启动、关键路由和浏览器 console、临时服务关闭。只读连接证据临时库复核得到 26 个迁移、最高 `042_ai_conversation_management.sql`、4 条阅读事件和进度 `4/118`；5190/5191 无监听。 |
| 干净新基线 | PASS | HEAD 与冻结基线一致；最高迁移为 042，新功能迁移从 043 开始；未发现旧 `016_reading_behavior_facts`、旧 `src/student/reading-telemetry` 或旧复杂分析链路被带入跟踪基线。 |
| G1 与需求冲突 | PASS | D-01～D-10 均记录原始冲突、冻结解释和理由；D-03 属不扩大产品/权限/隐私边界的纯技术状态机裁决，不形成用户选择阻塞。字段、状态机、DTO、时间、保留、删除和切换条件均可单义实现。 |
| B/C/U/I 所有权 | PASS | B/C/U W1 独占清单无重叠；C 的三个共享存储门禁测试仅首轮临时独占并在交接后转 I；C 的 `reading-monitor-client-*` 与 U 的 `reading-monitor-ui-*` 分离；I 受影响页面明确排除 U 的 Home/ClassOverview 与 C 的 Reader。 |
| 三子槽波次 | PASS | W1 恰为 B/C/U 三线；W2a 由 I 串行接线；W2b 为 C/B/V 三线；AV-1 后 B 写侧、I 读侧/共享接线、U 真 UI 串行。现有共享 HTTP 测试和真全量测试的依赖已被推迟到 I 交接后。 |
| 旧事件与护眼唯一真值 | PASS | 基线源码确认旧事件当前同时贡献阅读统计和护眼；冻结要求 AV-1 后由 B 在 `catalog.js` 单点使旧事件阅读贡献归零并停止 progress 重算，同时保留 `valid_eye_seconds`/eye-care；B 交接后 I 才迁移旧读侧。不存在同时写新旧阅读真值的授权窗口。 |
| IndexedDB / revision / lease | PASS | IndexedDB 只精确放行 `pendingStore.js`，请求先原子持久化、按隔离键串行、容量上限和终态删除规则已冻结；90 秒租约、30 秒续租窗口、leaseId 绑定、合法 history 范围和未来时间偏差均明确。租约结束/接管后的晚到 revision 只可按连续修订并在权威截止前接受，始终保留服务端 closed 状态；session 尚不存在的合法 revision 1 直接创建 closed，不短暂创建 open。 |
| 时间与乱序位置 | PASS | `startedAt <= measuredThroughAt <= endedAt`、累计不超过墙钟跨度、北京时间 04:00 统计日、仅统计日切换可落下一边界、120 秒 future skew 已冻结；跨 session 乱序晚到只累加 delta/OR，位置按 measurement time 条件更新，同毫秒以更大页码稳定破同值。 |
| 继续阅读 URL | PASS | C 的 G3-02 负责严格解析 `versionId/pageNo`；显式版本错误、不可访问、与 path book 不匹配、非整数或越界页码均进入错误态，不允许静默换版本、clip 或回第一页。I/U 只构造 URL。 |
| 页码完成度影响 | PASS | `last_page_no` 只作最近位置，服务端投影/报告/公开摘要/AI、共享 adapter 与学生/教师页面清单已覆盖；Reader 百分比由 C 清理，其他读侧由 I 在 G4-11/后续波次统一清理，并要求“跳最后一页不产生 finished/100%/pagesRead”双层回归。 |
| 六个月保留 | PASS | G2-17 冻结可注入 now 的 cleanup primitive：北京时间日历月 cutoff、先关闭有合法 history 的过期 open、再删 `ended_at < cutoff` 的 closed、等于 cutoff 保留、异常 open 报告且幂等；G5-11 追加显式生产维护命令，读取正式 DB 配置、输出 cutoff/关闭/删除计数、失败非零；AV-2 必须真实调用。 |
| 生产代码是否已变更 | PASS | `git diff --name-status` 与 cached diff 均为空；`git status` 只有未跟踪的 `docs/reading-monitor/` 证据/控制文档，没有生产源码或测试修改。 |
| 用户选择阻塞 | PASS / 无 | 未发现产品、权限、隐私或破坏性外部动作上的未决选择。现存限制均已作为技术边界或后续验收项记录。 |

## 4. 前序问题关闭确认

以下复核中曾发现的问题，在本次最终输入中均已关闭：

1. **关闭会话与晚到 revision 矛盾：已关闭。** 租约关闭只写服务端权威状态，不伪造 revision；合法晚到仅限连续、截止前累计。首次晚到 revision 1 直接物化 closed，反例“旧 session 短暂 open 占用唯一索引”已消除。
2. **IndexedDB 放行与测试文件无主人：已关闭。** C 首轮拥有三个精确存储门禁，且只放行 `pendingStore.js`；交接后转 I。
3. **C/U/I 测试与页面 glob 重叠：已关闭。** 客户端/UI 测试 glob 分离，I 页面范围有显式排除。
4. **旧事件写侧负责人错误：已关闭。** `catalog.js` 始终归 B；AV-1 后先 B 执行 G5-01，再 I 清读侧。
5. **首轮依赖无法适配三个子槽：已关闭。** W1、W2a、W2b 和 W3 的真实 API/全量测试依赖已按交接点重排。
6. **六个月规则没有可执行清理点：已关闭。** G2-17 提供领域 primitive，G5-11 提供生产命令，G5-06/AV-2 验证真实调用。
7. **跨 session 晚到可能回退页码：已关闭。** 位置按 `measuredThroughAt` 条件更新并定义同毫秒破同值。
8. **继续阅读页码/版本解析责任与负例缺失：已关闭。** 已归 C G3-02 并冻结严格错误语义。
9. **时间、墙钟累计和统计日边界不完整：已关闭。** 所需不变量、04:00 边界和 120 秒偏差已冻结。
10. **纯技术冲突都被迫请求用户：已关闭。** 控制文档区分技术裁决与产品/权限/隐私选择，D-03 有记录依据。

## 5. 分级发现

### P0

无。

### P1

无 AV-0 阻塞性 P1。以下两项是必须留到后续关门的既定边界，不改变本次 PASS：

- **P1-01，保留清理的持续运行责任。** G5-11 已把“可真实调用”冻结到生产命令，足以单义实现；但没有后台 timer 是明确选择。AV-2 除实际调用和幂等验证外，应在交付记录中说明由哪一部署/运维机制按何频率调用，避免六个月策略只在验收时运行一次。
- **P1-02，账号注销触发链。** 本轮只实现 reading-domain 硬删除 primitive，因为当前 identity 域没有通用账号注销 API。G5-06/AV-2 必须证明 primitive 的组织隔离、事务性和删除范围；若未来提供账号注销产品流，仍需另行把该 primitive 接入真实注销编排。
- **P1-03，AV-2 依赖行的文字收口。** `IMPLEMENTATION_CONTROL.md` 的 AV-2 行仍写“G5-01～G5-09 完成”，没有列出后来新增的 G5-11；同文件 G5-10 已依赖 G5-11，冻结契约也明确要求 AV-2 真实调用维护命令。建议主控在进入 AV-2 前把该依赖改成 G5-01～G5-11 或显式补 G5-10/G5-11，避免最终门禁被旧范围误读。此项不影响 W1 开工。

### P2

- 浏览器只能以 `document.visibilityState` 代理可见性，不能证明物理屏幕点亮；冻结文档已禁止把代理值描述为物理亮屏证据。
- 历史班级 rate 的分母暂用当前有效名单，且可能超过 100%；这是当前数据模型缺少可靠成员历史后的已披露口径，不阻塞 W1。
- 根 README 的“纯静态、零后端”描述与当前基线存在漂移；依赖审计告警和构建大 chunk 告警也已作为独立风险保留，均不属于本次阅读监测开工门禁。
- 本次未复制或重跑全量日志；G0 的全量计数来自控制账本，独立复核使用现有运行证据、临时库和端口状态。AV-1/AV-2 应按控制计划保存各自完整命令和结果。

## 6. 只读复核证据

本次使用的代表性只读命令包括：

```text
git status --short --branch
git rev-parse HEAD
git diff --name-status
git diff --cached --name-status
git ls-files / rg --files / rg
node --version
npm --version
npm ls --depth=0
lsof -nP -iTCP:5190 -sTCP:LISTEN
lsof -nP -iTCP:5191 -sTCP:LISTEN
sqlite3 'file:/tmp/readmate-av0.7KVI5A/server/data/readmate.db?mode=ro&immutable=1' ...
node tests/frontend/runtime-import-scan.mjs
```

只读库复核结果：

```text
26|042_ai_conversation_management.sql
4
4|118
```

端口 5190/5191 无监听，符合基线证据中的临时服务已关闭声明。

## 7. 最终授权

**AV-0 = PASS；允许 G2/G3/G4 的 W1 首轮按三子槽开工。**

主控仍需先把本报告结论和对应任务状态写回唯一控制面；本报告本身不替代任务状态更新，也不授权 W2/W3 或 AV-1 后切换提前执行。
