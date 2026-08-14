# AV-1 关键纵向链路独立验收计划

> 计划日期：2026-08-10（Asia/Shanghai）
> 执行角色：独立验收 Agent V
> 当前状态：**prepared**
> 当前结论：**不提供 AV-1 pass/fail；候选尚未完全收口，本文没有执行测试、启动服务或操作浏览器**

## 1. 目的和执行边界

AV-1 是半天内完成的聚焦纵向门禁，目标是证明“真实学生客户端 → 摘要/续租 HTTP → 单事务持久化 → `/self`/`/scope` 查询”已经闭环，并且旧护眼能力仍受保护。它不重复 B/C 已完成的项目级真全量，也不提前验收 AV-1 后才允许进行的 G5-01 旧事件写侧切换、G4-11 全局完成度清理或真实页面 UI 收口。

本计划阶段遵守以下保护边界：

- 只读取控制文档、冻结契约、AV-0 证据和需求 03/04/06；
- 不读取尚在变化的候选实现来作质量结论；
- 不运行任何测试、服务、浏览器或写数据库动作；
- 不修改生产代码、测试、需求包、`IMPLEMENTATION_CONTROL.md` 或 `G1_FROZEN_CONTRACT.md`；
- 实际执行必须等主控确认 B/C 停止写入、G2/G3 核心均为 `implemented_unverified`，并给出冻结候选身份后再开始；
- 实际执行仍只写 `docs/reading-monitor/validation/**` 证据，失败交回唯一文件所有者修复。

本计划基于以下输入快照：

```text
7b437932900595200319c363fc22f763e3671ff58839731ffe0f8ed338ffbbfe  IMPLEMENTATION_CONTROL.md
00faf42203bfab64ec62675c8f981897f47efac8525cd7087150bdcbc743370f  G1_FROZEN_CONTRACT.md
176e8fc224afea17a01e0ca4bfaf069c2648d92c62ce15d1d6474437239d4334  AV0_BASELINE_RUNTIME_EVIDENCE_2026-08-10.md
4a4e3627ecb914f603b9826ebd9fce2c3e3c4fefe3d9697824f13a9e93e1d50e  AV0_GATE_REVIEW_2026-08-10.md
fc96ae7c8afffec14635aafef973b43c4e00202732143b554dfac574a90906c0  03_指标规则与采集上传.md
04d92bc36ce4392cbb08af14ed727e630ebb5c20e12e4e066af3d7ec0a6b23e8  04_数据模型与API契约.md
8218b2e82d29e65f2c36e0507de4f5f4c4f63c63068e1b64518b4cb281642934  06_测试验收与进度追踪.md
```

若主控在执行前修改冻结契约，V 先重算 SHA-256、阅读变更并更新用例映射；不能拿旧计划直接判新候选。

## 2. 开始执行所需候选输入

### 2.1 主控必须先确认

1. B 的 G2-16、C 的 G3-13/G3-14 和 I 的 G2-18 均已停止写入并交接；
2. 候选工作树在 AV-1 执行期间冻结，给出分支、HEAD、`git status --short` 和全部候选文件清单；
3. 5190/5191 没有其他服务占用；
4. 给出 B/C/I 的原始命令、完整通过数、退出码和未覆盖项；
5. 给出一次性演示密码/会话密钥的安全传递方式，不把秘密写入 evidence；
6. 确认 V 可以用 `/tmp/readmate-av1.*` 建一次性数据库和公版资产，并在结束后停止服务但不擅自删除材料。

### 2.2 B 仍需交接的输入

- 最终 B 文件清单及每个文件 SHA-256；
- G2-16 的专项 43/43、数据库 8/8、HTTP 12/12、服务端真全量 160/160 的原始命令、退出码和完整输出位置；
- 下列断言在何测试名称/用例中出现的映射：事务故障全回滚、accepted/replayed/superseded、revision gap/conflict/regression、租约续期/过期/接管、首次晚到直接 closed、连续晚到、跨 session 页码不回退、权限/跨组织和 requestId；
- HTTP fixture 的学生、同组织教师、同组织无权限主体、跨组织教师、两个可信设备、class/workspace/bookVersion 的逻辑映射；
- 可供 V 只读复核的 SQL 主键/外键映射，避免靠猜测关联数据。

### 2.3 C 仍需交接的输入

- 最终 C 文件清单及每个文件 SHA-256；
- G3-14 的客户端专项、前端真全量和 build 原始命令、退出码、通过数与完整输出位置；
- 下列断言在何测试名称/用例中出现的映射：请求前 IndexedDB 原子持久化、组织/学生/workspace/device 隔离、512 条/2 MiB 双上限与 80% drain、三成功终态删除、冲突保留、30/15/5 秒续租、失败/接管/过期停表、前后台、04:00 切日、显式 Reader movement source、最后页不产生完成度；
- IndexedDB 的数据库名、版本、object store、主键/隔离键和只读检查方式；
- 浏览器中触发“立即形成摘要”的无代码改动步骤，例如进入后台/恢复、关闭 Reader 或真实确认交互；
- 浏览器中识别续租/摘要成功与显式失败状态的 DOM 文案或可观察标志；
- C 对旧护眼事件是否仍由 Reader 发出、何时发出的明确交接，供 V 区分“护眼保留”与“旧统计双写”。

### 2.4 I/主控需补齐的共享输入

- 真实 `/api/v1/reading/session-summaries`、renew、`/self`、`/scope` 的认证方式和可复现 curl 示例；
- 成功与失败 envelope 中 requestId 的字段/响应头位置；
- 共享 HTTP 用例的精确文件和测试名；当前候选清单预期为 `tests/server/http/reading-monitor-http.test.js`；
- Vite 5190 到服务端 5191 的代理配置是否仍沿用 AV-0 命令；
- 若 bootstrap 的 5 个演示账号不足以做跨组织/双设备，提供现有测试 fixture 的执行入口，不要求 V 直接猜 identity 表结构或编写新测试。

任何一项缺失若只影响对应用例，该用例记 `not_run`，不能用实现者口头结论代替；若影响 10 个硬门禁之一，则 AV-1 不得判 PASS。

## 3. 测试层级与复用策略

| 层级 | AV-1 用途 | 执行策略 |
| --- | --- | --- |
| B/C 真全量与 build | 证明候选没有已知项目级回归 | 复用 B/C 原始日志和退出码；V 不重复执行项目级全量/build |
| 服务端领域/HTTP 聚焦 | revision、事务、租约、权限、严格 DTO、requestId | 只跑阅读监测相关文件，不跑整个 server suite |
| 客户端状态聚焦 | 时钟、前后台、续租、队列、movement source、容量 | 只跑阅读监测相关文件，不跑整个 frontend suite |
| 真实临时库/API | 证明 043、HTTP、三表事务结果与严格查询真正连通 | 一次性库，保存请求/响应与 SQL 前后快照 |
| 真实浏览器 | 证明真实 Reader 能形成摘要、续租、后台恢复，并保护护眼 | 学生与教师各一条最短闭环，不做 AV-UI 视觉验收 |

计划执行的聚焦自动化命令如下；只有候选冻结后才运行：

```bash
node --test \
  tests/server/reading/reading-monitoring.test.js \
  tests/server/reading/statistics.test.js \
  tests/server/http/reading-monitor-http.test.js \
  tests/server/reading/reading-teaching-bridge.test.js

node --test \
  tests/frontend/reading-telemetry-sequence.test.mjs \
  tests/frontend/reading-monitor-api-contract.test.mjs \
  tests/frontend/reading-monitor-client-*.test.mjs \
  tests/frontend/console-live-reading-eyecare-pages.test.mjs

node tests/frontend/runtime-import-scan.mjs
```

若候选交接证明某个文件名不同，V 先在证据中记录“计划名 → 实际名”的单一解析，再执行实际路径；不扩大成项目级 glob，也不以零匹配的 test-name pattern 冒充通过。

## 4. 临时环境和浏览器数据准备

### 4.1 预检

```bash
git status --short --branch
git rev-parse HEAD
git diff --name-status
git diff --cached --name-status
node --version
npm --version
lsof -nP -iTCP:5190 -sTCP:LISTEN
lsof -nP -iTCP:5191 -sTCP:LISTEN
```

记录候选身份和未提交文件，但不执行 `git add/commit/reset/clean/checkout`。端口被占用时先请主控协调，不终止未知进程。

### 4.2 一次性库和服务

沿用 AV-0 已证明可工作的 bootstrap 路径，候选执行时使用新的临时目录：

```bash
AV1_TMP_DIR="$(mktemp -d /tmp/readmate-av1.XXXXXX)"
AV1_DB_PATH="$AV1_TMP_DIR/readmate.sqlite"
AV1_PUBLIC_DIR="$AV1_TMP_DIR/public"

INTERNAL_DEMO_PASSWORD="$AV1_DEMO_PASSWORD" \
  npm run bootstrap:internal -- \
  --database "$AV1_DB_PATH" \
  --manifest '/Users/yak/Project/整书8.10/读伴一体化交接_2026-08-07_v3_最终版/materials/public-domain/delivery_manifest.json' \
  --public-root "$AV1_PUBLIC_DIR"

DATABASE_PATH="$AV1_DB_PATH" \
SESSION_TOKEN_SECRET="$AV1_SESSION_SECRET" \
INTERNAL_DEMO_MODE=1 \
PUBLIC_ASSET_DIR="$AV1_PUBLIC_DIR" \
PORT=5191 HOST=127.0.0.1 \
npm run server

npm run dev
```

服务分别以独立 PTY 启动。健康检查必须显示 27 个迁移且最高为 043：

```bash
curl -fsS http://127.0.0.1:5191/api/v1/health
curl -fsS http://127.0.0.1:5190/api/v1/health
sqlite3 -readonly "$AV1_DB_PATH" \
  "SELECT COUNT(*), MAX(id) FROM schema_migrations;"
```

若 bootstrap 不能产生跨组织、双设备或无权限 fixture，这些反例使用 B/I 已交接的聚焦 HTTP fixture，不直接修改临时 identity 数据。浏览器只使用 bootstrap 的真实学生、同组织教师、真实书和真实 class/workspace。

### 4.3 数据角色矩阵

执行证据必须先填入实际 ID；下表的逻辑名不可直接当数据库 ID：

| 逻辑名 | 用途 | 必须具备 |
| --- | --- | --- |
| `student_A` | 真实 Reader、`/self`、摘要 | org_A/class_A/workspace_A/device_A/bookVersion_A |
| `teacher_A` | 合法 `/scope`、护眼页 | org_A 且有 `reading.read_scope` |
| `teacher_A_denied` | 同组织无权 | org_A、无目标 class scope |
| `teacher_B` | 跨组织负例 | org_B，目标仍为 class_A |
| `device_A2` | takeover | student_A 的第二可信设备 |
| `bookVersion_wrong` | 范围/版本负例 | 不属于 path book 或 student_A 不可访问 |

自动化时间 fixture 至少包括：

```text
2026-08-09T19:59:59.999Z = 北京时间 2026-08-10 03:59:59.999，statDate 仍为 2026-08-09
2026-08-09T20:00:00.000Z = 北京时间 2026-08-10 04:00:00.000，statDate 为 2026-08-10
```

04:00 精确边界依赖可注入时钟的聚焦测试，不修改系统时间，也不等待真实凌晨。

### 4.4 浏览器最短真实闭环

1. 记录 student_A 的四张前置快照：session、daily、reading_progress、reading_events/eye-care；
2. 用一次性学生账号登录 5190，进入真实 `bookVersion_A` Reader；
3. 在前台可见且租约有效时稳定阅读，至少形成一个大于 0 的有效段；
4. 通过切到另一标签页/应用后台触发持久化和上传，随后恢复；
5. 捕获摘要请求/响应、Idempotency-Key、leaseId、revision、fingerprint 和真实 requestId；
6. 保持 Reader 超过原 90 秒租约，确认在剩余 30 秒窗口出现 renew、leaseId 不变、`expiresAt` 前进，且续租后仍可产生下一段；
7. 跳转到最后一页只形成位置，不显示百分比完成条，不在新摘要/新查询中形成 finished/pagesRead；
8. 记录同一学生四张后置快照，核对 delta 只进入新 daily 一次；
9. 用 teacher_A 登录教师端，打开护眼页，确认由旧眼保健事件形成的既有值仍可读取；
10. 结束时退出浏览器会话，向两个 PTY 发送 Ctrl-C，并再次确认 5190/5191 无监听。

浏览器验证失败时先保存 URL、视口、时间、账号逻辑名、DOM/截图、console error、请求 ID 和对应服务日志；不在 V 任务内修改代码。

## 5. AV-1 十项硬门禁映射

| ID | 必验项 | 层级与操作 | 通过断言 | 必留证据 |
| --- | --- | --- | --- | --- |
| AV1-01 | 真实学生产生累计摘要 | 真实浏览器 student_A 阅读，后台触发；再查 HTTP/SQLite | 至少一个合法 revision 经真实 HTTP accepted；session 累计大于 0，daily 增量相等，位置与最后稳定页一致 | Reader 前后截图、请求/响应、requestId、三表前后 SQL |
| AV1-02 | accepted/replayed/superseded | 服务端领域+HTTP 聚焦；同 revision 同指纹重放，接受更高 revision 后再重送历史 revision | 依次返回三种冻结结果；replayed/superseded 不改 session version、daily、position 或 updatedAt | 每次响应、相同/不同快照、测试名 |
| AV1-03 | 重复/乱序/倒退/冲突 | 聚焦 HTTP/领域：重复幂等键、revision gap、同 revision 异指纹、累计/布尔/时间倒退 | 明确 `REVISION_GAP/REVISION_CONFLICT/SUMMARY_REGRESSION`；没有重复计时和半写；失败均有 requestId | 状态码、错误 envelope、请求 ID、失败前后 SQL |
| AV1-04 | 单事务 session+daily+position | accepted 路径查三张表；复用 B 的故障注入回滚用例 | 成功时三处同一 revision/delta/测量时间一致；注入任一步失败时三处均不变化 | 事务测试输出、成功/回滚快照 |
| AV1-05 | 续租成功/失败/接管/过期停表 | 浏览器跨过 90 秒验证成功 renew；领域/HTTP/客户端聚焦覆盖失败、takeover、expired | 成功保持原 leaseId 且 `expiresAt=serverNow+90s`；失败/接管/过期后本地累计不再增长，新时长不绑新 lease；合法旧 pending 仍可按 history 重试 | renew 响应/requestId、客户端时钟快照、takeover/expiry 测试输出 |
| AV1-06 | 前后台与 04:00 | 浏览器后台/恢复；可注入时钟执行 03:59:59.999→04:00 | 后台时间为 0，恢复后新段；04:00 先持久化旧日、closed old session，再用新 sessionId/statDate 计时 | 浏览器时间线、两日 session/daily 快照、边界测试输出 |
| AV1-07 | 严格 `/self`/`/scope` | 真实 HTTP + statistics 聚焦 | DTO 字段精确；`/self` 无上周具体值/行为/班级数据；`/scope` 7 点补零、稳定姓名+ID排序、null/no_baseline 正确；不存在旧 DTO 字段兜底 | 两个完整响应、schema 断言、requestId |
| AV1-08 | 权限/跨组织 | HTTP fixture：student 请求 scope、teacher_A_denied、teacher_B 查 class_A、伪造主体范围 | student/同组织无权为 403，跨组织 class 为 404；客户端不能覆盖可信主体；失败无受保护数据且都有 requestId | 负例响应、状态码、requestId、零数据泄露断言 |
| AV1-09 | 新旧不同时贡献新统计 | 浏览器真实闭环+SQL；单独送旧 eye-care 事件并重查新 daily/self/scope | 新 daily 的 delta 只来自摘要；旧事件不增加新 daily 或严格新 statistics；没有“摘要失败回旧统计”兜底 | 摘要/旧事件顺序、daily/self/scope 前后值、服务日志 |
| AV1-10 | 护眼不回归 | 旧事件/eye-care 聚焦+教师真实护眼页 | 旧事件仍可贡献 `valid_eye_seconds` 并更新 eye-care 查询；新摘要不冒充 eye-care；页面无 error | old event 与 eye-care SQL、护眼 API/requestId、教师页截图/console |

关于 AV1-09/10 的阶段口径：AV-1 发生在 G5-01 之前，不能要求此时 `catalog.js` 已把旧 `valid_reading_seconds` 固定为 0，也不能要求旧 progress 写侧已经停用。硬断言是严格的新 daily/`self`/`scope` 不读取或重复累计旧事件，同时旧事件的 eye-care 贡献仍工作。AV-1 通过后才允许 B 执行 G5-01 单点写侧切换。

## 6. 补充高风险覆盖

### AV1-X1：租约结束/接管后的晚到 revision

至少覆盖两条：

1. 租约已有 `lease_ended` 或 `lease_taken_over` history、session 尚不存在，合法 revision 1 的完整测量范围在 cutoff 前：必须直接创建 `closed`，`ended_at/end_reason` 来自权威 history，不能短暂产生 open，也不能占用学生唯一 open 索引；
2. 同一 closed session 的 revision 2、3 连续晚到且都在 cutoff 前：可 accepted，只推进客户端累计/指纹/daily delta，保留权威关闭时间/原因；越过 cutoff 返回 `LEASE_CONFLICT`。

证据为聚焦领域/HTTP 测试名、响应和 session/daily 前后快照；不只引用实现者文字。

### AV1-X2：IndexedDB 请求前原子持久化

- 在发送端口记录首个网络调用时，pending 记录必须已经能从 IndexedDB 同一隔离范围读到；
- 模拟“持久化失败”时不得发 HTTP，也不得增加可计时累计；
- 模拟网络失败时记录保留；accepted/replayed/superseded 删除对应 revision，冲突/权限/lease 错误保留并显式报错；
- 浏览器附加检查可在离线后触发后台持久化，按 C 提供的数据库/store 只读检查 pending，再恢复网络 drain；自动化聚焦测试是原子顺序的主证据。

### AV1-X3：512 条 / 2 MiB 双容量门禁

- 分别构造“第 512 条”“序列化后恰好 2 MiB”“下一条越过条数”“下一条越过字节”；
- 80% 阈值必须立即尝试 drain；达到任一硬上限且不能排空时停止新增有效累计并显示可操作错误；
- 不丢、覆盖、跨 session 合并或跳 revision；恢复排空后才可重新计时。

此项用可注入 store/sender 的客户端聚焦测试完成，不通过真实堆积 512 次浏览器操作来浪费 AV-1 时间。

### AV1-X4：Reader 显式移动来源

逐一验证 `student_adjacent`、`student_jump`、`restore_position`、`teacher_sync`、`layout_change`、`system_restore`。只有前两者进入学生行为判定；恢复/同步/布局/系统移动必须重置或忽略候选，布局单双页变化本身不形成 skip/reread。证据为客户端聚焦测试名与真实浏览器的一次 student jump/一次 layout 变化观察。

### AV1-X5：最后页不等于完成

真实 Reader 直接跳最后页后：

- Reader 只显示“第 X 页 / 共 Y 页”，不显示完成度条或 100%；
- 新摘要、daily、严格 `/self`/`/scope` 不产生 `finished`、`pagesRead` 或“此前页均已读”语义；
- C 范围内不得把最后页解释为读完。

共享投影、AI、报告和其他旧页面的全局清理属于 AV-1 后 G4-11；若它们尚未切换，不把这个已冻结的后续工作误判成 AV-1 失败，但 AV-1 证据必须清楚限定“C Reader + 新纵向链路”已通过。

### AV1-X6：真实 requestId

- AV1-01 的真实 accepted、renew、`/self`、`/scope` 各保存一个非空 requestId；
- AV1-03/08 每类实际 HTTP 错误至少保存一个 requestId；
- 同一请求在响应 envelope 中必须有 ID；若同时暴露响应头或访问日志 requestId，则这些位置的值必须一致；
- 不能使用测试常量、空串或前端自造 ID。

## 7. SQL 快照最小集合

实际列名以 043 冻结字段为准。每次真实闭环至少保存以下只读查询结果；所有查询附 `student_A`/session 范围，禁止输出其他用户数据：

```bash
sqlite3 -header -column -readonly "$AV1_DB_PATH" \
  "SELECT id, lease_id_at_start, stat_date, latest_revision,
          cumulative_effective_ms, had_skip, had_reread, last_page_no,
          measured_through_at, ended_at, end_reason, status, version
   FROM reading_summary_sessions
   WHERE actor_id_at_creation = '$AV1_STUDENT_ID'
   ORDER BY created_at, id;"

sqlite3 -header -column -readonly "$AV1_DB_PATH" \
  "SELECT stat_date, book_version_id, effective_reading_ms,
          had_skip, had_reread, last_read_at, last_page_no, version
   FROM reading_daily_book_summaries
   WHERE actor_id_at_creation = '$AV1_STUDENT_ID'
   ORDER BY stat_date, book_version_id;"

sqlite3 -header -column -readonly "$AV1_DB_PATH" \
  "SELECT actor_id, book_id, last_page_no, valid_reading_seconds,
          updated_from_event_at
   FROM reading_progress
   WHERE actor_id = '$AV1_STUDENT_ID';"

sqlite3 -header -column -readonly "$AV1_DB_PATH" \
  "SELECT COUNT(*) AS event_count,
          COALESCE(SUM(valid_reading_seconds), 0) AS old_reading_seconds,
          COALESCE(SUM(valid_eye_seconds), 0) AS eye_seconds
   FROM reading_events
   WHERE actor_id = '$AV1_STUDENT_ID';"
```

若现有表的主体列名不是 `actor_id`，B/I 必须在交接中给出真实列名，V 只替换该查询并在证据中记录，不靠试写数据库探测。

## 8. 通过门槛和判定规则

### PASS

必须同时满足：

1. AV1-01～AV1-10 全部 `pass`，无 skipped/not_run；
2. AV1-X1～X6 全部有自动化或真实纵向证据；
3. B/C 真全量与 build 原始证据有效、退出码为 0、没有隐藏失败；V 不重复运行全量；
4. 聚焦命令全部退出 0，测试发现数非 0；
5. 真实浏览器至少完成学生摘要/renew/后台恢复和教师护眼两条闭环，console 无新增 error；
6. 每个真实成功/失败 HTTP 证据都含服务端 requestId；
7. SQL 证明 accepted 的 delta 只累计一次，replayed/superseded/错误均不改变事实，事务失败无半写；
8. 没有越权数据泄露、旧统计向新 daily 双写或护眼回归。

### FAIL

任一硬断言实际不符即 `fail`，包括但不限于：重复计时、半事务、过期后继续累计、closed 首次晚到短暂/最终 open、跨组织返回数据、strict DTO 混入旧字段、旧事件增加新 daily、护眼事实消失、最后页在 Reader/新链路变成完成、响应无 requestId。

### BLOCKED

候选未冻结、必要账号/fixture/认证不可用、环境无法启动且完成合理只读诊断后仍无法进入产品验证，才记 `blocked`。实现者未提供证据不能被自动视为 PASS；环境问题也不能伪装成产品 FAIL。

所有失败先记录“用例 ID、精确输入、时间、预期、实际、requestId、SQL 前后、日志/截图路径、最小复现”，再交唯一所有者修复。V 不修改生产代码或测试。

## 9. 证据格式

实际执行后新建独立证据文档，建议名：

```text
docs/reading-monitor/validation/AV1_VALIDATION_EVIDENCE_2026-08-10.md
```

结构固定为：

1. 候选身份：分支、HEAD、工作树清单、冻结文档 SHA；
2. 环境：Node/npm、临时库、端口、浏览器版本、一次性账号逻辑名；
3. B/C 复用证据：原始命令、退出码、通过数、日志位置；
4. V 聚焦命令：命令原文、起止时间、退出码、通过/失败/跳过数；
5. AV1-01～10 结果表；
6. AV1-X1～X6 结果表；
7. HTTP 证据表：方法、路由、状态码、结果/错误、requestId；
8. SQL 前后快照和 delta 算式；
9. 浏览器证据：账号逻辑名、URL、操作、截图、console、requestId；
10. P0/P1/P2、未覆盖项、是否允许 W3a；
11. 最终结论：`pass/fail/blocked`。

证据不得包含密码、session token、私有 cookie 或全量个人数据。截图只保留验收必需区域，学生使用一次性演示数据。

## 10. 执行结束清理

- 对 V 自己启动的 Vite/Node PTY 发送 Ctrl-C；
- 用 `lsof` 确认 5190/5191 无监听；
- 登出一次性浏览器会话；
- 不运行 `rm -rf`，不清理未知目录；临时目录路径记录在 evidence，是否删除由主控决定；
- 再次记录 `git status --short --branch`，确认 V 仅新增 validation evidence，没有生产代码/测试修改。

## 11. 当前准备状态

**prepared**。矩阵、层级、命令、数据准备、通过门槛和证据格式已经定义；尚未执行任何 AV-1 测试或浏览器操作，因此本文不构成 AV-1 结论，也不授权 G5-01/W3 开工。
