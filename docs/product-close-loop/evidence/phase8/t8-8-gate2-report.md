# T8.8 Gate 2 全量质量门与 046→050 副本演练报告

> Agent：Phase 8 T8.8（只写 evidence，不改业务实现，不进入 T8.9）
> 时间：2026-08-18
> 模型：cursor-grok-4.6-xhigh-fast（未换模型、未降档、无 fallback）
> 结论先行：**Gate 2 不通过**。原因是质量门未全绿。副本演练本身（quick_check=ok、grants=49、逐学生集合 diff 全空、独立端口 HTTP 正反例）通过。

未改：`server/**`、`src/**`、`tests/**`、`09`、`decisions.md`、`execution-ledger.md`、真库、5191。未开浏览器。未申请 T8.9 维护窗口。

---

## 1. 质量门（cwd 仓库根，亲自跑）

`package.json` 对应命令：

| 门 | 脚本 | 实际命令 |
|---|---|---|
| server 全量 | `test:server` | `npm run test:server` → `node --test tests/server/**/*.test.js` |
| frontend 全量 | `test:frontend` | `npm run test:frontend` → `node --test tests/frontend/*.mjs` |
| build | `build` | `npm run build` → `vite build` |

原始输出：

- `docs/product-close-loop/evidence/phase8/t8-8-server-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-frontend-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-build-output.txt`

### 1.1 server 全量：**红** 339 / 428（fail 89）

TAP 原文：`# tests 428` `# pass 339` `# fail 89` `# duration_ms 18498.9477`。

进程非 0（TAP `# fail 89`）。首次用 `cmd` 包了一层 `echo EXIT:%ERRORLEVEL%`，百分号在解析期展开，误打出 `EXIT:0`，**不以该误报为准**。

本任务未改任何测试。失败标题原文如下，按根因归类。

**A. 旧夹具未写 `organizations.school_code`（047 触发器）**

- 会话新建、上下文、重命名、私密切换、软删除与恢复均使用版本保护
- 跨租户和跨主体修改统一返回不存在，不能通过 conversationId 猜测资源
- 权限端按班级学生形成三级索引，并支持模糊搜索与书籍 AND 或 OR 约束
- 普通会话按范围可读，私密会话需要授权，安全会话只返回证据最小上下文
- 043 强制范围、连续指纹、open 唯一、页码和单调更新约束
- 护眼状态按真实聚合进入提醒、强制休息并在到时后自动恢复
- 教师与学校管理员只能读取真实范围并且只能按误判解除强制休息
- 普通私密会话必须经学生授权，超时按已告知规则同意并保留水印与访问历史
- 安全标记会话只返回证据最小上下文，涉事教师被后端拒绝且学生端不感知危险事件
- 私密会话查询始终绑定认证组织和真实工作空间范围
- maintenance cleanup 命令真实处理 cutoff、等值保留、历史 open、异常报告且幂等
- maintenance cleanup 命令参数错误时非零退出并给出稳定错误前缀
- acquire 不原地换 scope 或续期，renew 仅延长原范围且 TTL 固定 90 秒
- 摘要 accepted/replayed/superseded、历史指纹、连续 revision 与事务 delta 不重复计时
- 逐页覆盖按 original/text 与确认交互持久化，重放不重复且不能由 lastPageNo 推导
- G5-01 旧事件只贡献护眼，不写阅读时长且不能覆盖摘要每日事实和位置
- 摘要严格拒绝未知字段、非规范时间、未来时间、墙钟超额、错统计日和错指纹
- 仅 stat_date_change 可把 endedAt 精确放在下一统计日 04:00 边界
- 旧租约首次晚到直接 closed，且允许截止前连续晚到 revision
- 同租约残留open会话不挡新会话，且不覆盖旧累计毫秒
- 过期租约残留 open 会话时新设备 acquire 成功并关闭残留会话
- 关联 open 会话未超停滞阈值时续期正常成功
- 关联 open 会话停滞超阈值时续期被拒
- 关联 closed 会话 measured_through_at 停滞超阈值时续期被拒
- 同设备 re-acquire 关闭 open 会话后 measured_through_at 停滞时续期被拒
- 刚获取租约尚无 open 会话时续期正常成功
- 拿到租约但从未创建任何会话，超过停滞阈值后续期被拒
- 在位者活跃提交时另一设备接管被拒
- 在位者会话停滞时另一设备仍可正常接管
- 在位者无会话且已停滞时另一设备无需 takeover 即可获取
- 跨 session 晚到正常累加 delta/OR，但较旧位置不回退
- 位置测量时间精确相同时仅以更大页码稳定破同值
- 班级在会话创建时快照，转班后的新会话归入新班级且旧事实不改写
- 每日汇总失败时会话和位置均回滚，不产生半写
- reading-domain 删除按组织隔离；六个月 cleanup 先关历史已结束 open、严格删除 cutoff 前 closed 且幂等
- /self 严格返回新 DTO、空事实语义和隐私边界
- /self 最近书籍不可访问时取下一条，教师身份不能冒充 self
- /scope 50 人一次返回 37/50、七日补零、学生详情与稳定姓名排序
- /scope 空班级使用 null；转班历史 numerator 按发生时班级、分母使用当前名单
- /scope 严格校验必填 query、组织 404、同组织越权 403 和 student 403
- 喜欢、书单、书签、摘录和批注同域持久化，旧事件不作为页面证据返回
- 摘录与批注锚点必须完整且精确匹配同页正文块，无锚点旧写入仍兼容
- 排序修改删除要求当前版本与当前租户归属
- 审计写入失败会回滚领域写入，跨组织数据不会泄露

错误原文：`organizations.school_code must be a non-empty school code`。

**B. 旧登录仍提交 username-only → 400**

- 学生带合法会话和工作空间头调用发布/下架必须 403
- class 范围教师经真实 HTTP 发布和下架，并写入审计
- 发布接口要求幂等键，重放不二次变更也不二次审计
- trusted-baseline v2 包经真实 HTTP 下架后再发布能通过质量闸门
- 跨组织发布返回 404，对草稿下架也返回 404
- 以及同一文件链路的后续 HTTP 夹具（登录先 400）

错误原文：`schoolCode、loginName 与 password 均为必填项` / `400 !== 200`。

**C. 产品改判后旧夹具仍以教师/非 platform 调 `book.import` / `book.publish`**

- trusted-baseline 包用 --accept-trusted 端到端导入并登记封面与年级
- 同一 trusted 包重复导入保持幂等
- GET /books 投影带出编目年级且保留既有字段
- 书目已存在但公开封面丢失时幂等导入会恢复素材

错误原文：`当前工作空间无权执行此操作`（`PERMISSION_DENIED`）。

**D. 旧迁移测试仍锁最大号 046**

- 044 在全新数据库顺序执行并由迁移账本重复启动校验和保护

错误原文：`+ '050_book_access_grant_backfill.sql'` / `- '046_reader_mode_preferences.sql'`。

**E. T8.4A 不变量仍要求三份 visibility 文件对 HEAD 无改动**

- 不变量：25 条旧 visibility 守卫文件必须保持未改（T8.7 所有）

错误原文：

```
旧守卫文件不得被 T8.4A 改动，git status:
 M tests/server/http/book-visibility-guard.test.js
 M tests/server/http/book-visibility-http.test.js
 M tests/server/http/book-visibility-revoke-guard.test.js
```

这是 T8.7 已授权重做夹具后的工作区脏，不是本任务弱化断言。本任务未改这三份文件。

**F. 其余（夹具未跟 047 / 默认全闭）**

- 受保护书籍资产按类型设置缓存头，并在真实 HTTP 链路上处理条件请求
- 学生 GET /books 投影快照：冻结 key 必须在，允许新增，类型不得改种
- 真实 HTTP 链路持久化阅读、社区、报告和 outbox，并允许相关角色刷新读取
- 受保护 manual_demo_test 走正式安全复核并执行涉事教师回避
- 学校社区必须经过班级教师一审和学校管理员二审，且真实 SQLite 状态、审计与 outbox 一致
- 真实 HTTP 管理员创建班级和学生后，学生重新登录并在新工作空间读取书目
- 真实 HTTP 教学链创建安排、控制课堂、同步页面并只广播一次
- 真实 HTTP 家长触达确定失败后重试成功并保存安全链接回执
- 真实 HTTP AI 与安全链返回引用、阈值、累计数和复核状态并持久化
- Stage 4 真实 HTTP 多会话、私密申请、护眼与阅读统计刷新后仍由 SQLite 驱动
- Stage 5 真实 HTTP 学生阅读对象路由持久化喜欢、书单、书签、摘录和批注
- 无偏好时 GET /books 带 preferredReaderMode=null，且不塞进 progress
- 学生 PUT 偏好后刷新 GET /books 仍带本人偏好，且不能写别人的行
- G2-18 HTTP 续租要求幂等键和可信设备，并映射 lease/validation 错误
- G2-18 HTTP 摘要返回 accepted/replayed/superseded，并冻结 revision 与未知字段错误
- G2-18 HTTP self/scope 严格返回新 DTO，并区分空态、权限、跨组织和未知 query
- READING_LEASE_HELD 409 仍下发持久 readmate_device Cookie
- HTTP 过期租约残留 open 会话时新设备 acquire 成功
- HTTP 关联 open 会话停滞超阈值时续期返回 LEASE_REQUIRED
- HTTP re-acquire 关闭 open 会话后 measured_through_at 停滞时续期返回 LEASE_REQUIRED
- HTTP 拿到租约但从未创建会话，超过停滞阈值后续期返回 LEASE_REQUIRED
- HTTP 在位者活跃提交时另一设备 takeover 返回 READING_LEASE_HELD
- HTTP 在位者会话停滞时另一设备仍可接管
- P1: 同事件 ID 修改 annotation 业务 payload 必须冲突（`no such table: role_assignments`）
- P1: 未知 payload 字段必须拒绝而不是忽略
- P1: selection 与 ai_question 完整业务 payload 参与事件指纹
- P1: 不支持 eventType 与未知顶层字段必须明确拒绝
- P0: 2035 未来事件不得进入统计
- P0: 事件按发生时间匹配已释放租约历史并拒绝租约前后越界
- P0: 过旧事件和越过配置硬上限均被拒绝
- P1: offline sequence 唯一键和查询均包含 organization
- 书籍坐标、设备租约和离线阅读事件真实持久化且幂等
- 真实书目资产同事务登记、校验并按组织范围提供查询端口
- 离线事件按时间并集重算护眼，乱序上传不写阅读进度且冲突不静默重放

未改这些测试。未用 skip / 弱断言消红。

### 1.2 frontend 全量：**红** 239 / 241（fail 2）

TAP 原文：`# tests 241` `# pass 239` `# fail 2`。包装器 `EXIT:1`。

已知产品改判、未改测试：

1. `登录适配器只提交账号密码并使用真实幂等写请求`（`tests/frontend/api-contract.test.mjs`）
   - 旧断言 body 为 `{ username: 'student-1', password: 'secret-value' }`
   - 现网 `login(schoolCode, loginName, password)`，实测 body 为 `{ schoolCode, loginName, password }`，且位置参数被当成 options 打散
2. 整文件 `tests/frontend/book-publish-visibility.test.mjs`
   - 原文：`SyntaxError: The requested module '../../src/console/state/useBookVisibility.js' does not provide an export named 'loadBookVisibility'`

### 1.3 build：**绿**

`EXIT:0`。`vite v5.4.21`，1757 modules，`built in 8.70s`。仅有 chunk >500kB 警告，不是失败。

---

## 2. 046→050 副本演练（未写真库、未碰 5191）

脚本只在 `%TEMP%\t8-8-gate2-drill.mjs`。副本在 `%TEMP%\t8-8-gate2-20260818T124417Z\`。摘要：`t8-8-drill-summary.json`、`t8-8-vacuum-output.txt`、`t8-8-migration-output.txt`、`t8-8-http-output.txt`、`t8-8-drill-output.txt`。

演练前重核副本，不抄 T8.0 旧数字。

### 2.1 只读 VACUUM INTO

源：`D:\Project\整书8.15\server\data\readmate.sqlite`（WAL 存在）。用 `new DatabaseSync(source, { readOnly: true })` 再 `VACUUM INTO`，**未**用 `openSqliteDatabase` 打开真库。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| 源 sqlite | 108261376 | `6e3e163d5f2d437c892b2cbfeb44906b6a78dad5a56f9577d0277e6819cff14b` |
| 源 wal | 9723232 | `559dc570f00a2463ef9ec816b06fc5aed6244277db5649e273c28623848b675d` |
| 源 shm | 32768 | `876f1195f345564ec5c0fed079dc57cd21341bf7a81268085a7b594dd281a0d0` |
| 副本 | 107020288 | `33561d9ed24831672396a63a0d08ed8210cd80128148309e5d4d69b1964ef64a` |

副本路径：`C:\Users\Yak\AppData\Local\Temp\t8-8-gate2-20260818T124417Z\readmate-046-copy.sqlite`。未 VACUUM 覆盖源。

5191 演练前后仍是 `127.0.0.1:5191 LISTENING` PID `66104`。独立实例端口 **62621**、**60171**。

### 2.2 升级前 11.1 风格摘要（副本实测，不是抄写）

`PRAGMA quick_check` = `ok`。

| 项 | 副本升级前 |
|---|---|
| org | 1，`internal-demo-organization` active |
| class | 1，`internal-demo-class` / 三年级一班 / active / `grade_id=internal-demo-grade` |
| published | 49 |
| versions | 49 |
| grants | **0** |
| student active | 1（`internal-demo-student` ∈ `internal-demo-class`） |
| teacher active | 2 |
| grade_manager | 0 |
| workspaces | class/school/platform 各 1，无 grade |
| schema_migrations max | `046_reader_mode_preferences.sql` |

未触发 §16 停止：grants 已是 0、published=49、班恰好 1 个且为 `internal-demo-class`。无 active 无班学生、无停用班学生旧语义可见。未使用 `ON CONFLICT`。

### 2.3 `runMigrations()`（新代码，非 sqlite CLI）

第一次：`applied = [047_login_and_class_identity.sql, 048_registration_credentials.sql, 049_enrollment_and_password_reset.sql, 050_book_access_grant_backfill.sql]`。

第二次：`applied = []`，`alreadyApplied` 含 047～050。checksum 两次相同：

| id | checksum |
|---|---|
| 047_login_and_class_identity.sql | `de7d7fcad2926427b7b8ed75e9a4bc3691de8fa3a88f8452c30ab9cf99285f48` |
| 048_registration_credentials.sql | `97dcadc912e5c9593b60ccd84ade4987c7208acdd10f75fe42f2b140cf7fccea` |
| 049_enrollment_and_password_reset.sql | `190cfb10e9fef84991724aeb2fe579c3a77dc6a669a61f637a8b70de7eb5cfff` |
| 050_book_access_grant_backfill.sql | `bbb1a4bd103495acfc5e1ffed1e74cc960aae2fa3c2b0ad3ee31982af5eef763` |

升级后：`quick_check=ok`，**grants=49**，published/versions 仍 49，班仍 1 个且回填 `stage=primary` / `entry_year=2023` / `class_number=1` / `grade_id=primary:2023`。`grade_manager` 仍 0（050 不补演示账号，符合 11.1 真库）。

独立实例启动与重启：`applied=[]`，047～050 均在 `alreadyApplied`。

### 2.4 可见集合

pre：升级前副本 + **旧语义脚本**（`无 grants → true`，不改仓库 `visibility.js`）。
post：升级后 + 现网 `isBookVisibleToAudience`。

键：`internal-demo-organization::internal-demo-student`。
值：`book-001`…`book-049`（49）+ `activeClassIds=["internal-demo-class"]`。

`visibility-set-diff.json`：`added=[]`，`removed=[]`，`allEmpty=true`。

### 2.5 副本登录哈希

升级后、HTTP 前：当前 `.env` 的 `INTERNAL_DEMO_PASSWORD`（长度 12）与副本五份演示 `credentials.password_hash` **全部不匹配**。只在副本 `UPDATE credentials` 轮换哈希后测 HTTP。真库与 5191 未改。密码原文不入院证据。

### 2.6 真实 HTTP（独立端口 + 副本）

| 项 | 实测 |
|---|---|
| 现有学生 `GET /books` | **200 / 49**（重启后再测仍 49） |
| 教师 `POST /books/book-001/publish` 与 unpublish | **403** `PERMISSION_DENIED`「当前工作空间无权执行此操作」 |
| 副本原无第二班 | 快照后用 `importIdentitySeed` 在**副本**建 0 grant 班 `t8-8-zero-grant-class` + 学生 `t8-8-zero-student`（未 bootstrap 真库） |
| 新班学生 `GET /books` | **200 / 0**；该班 grants=0 |
| D-23 无 grant 租约 `book-001-trusted-v1` | **404** `RESOURCE_NOT_FOUND`「书籍不存在或当前不可读取」 |
| D-23 draft+本班 grant 租约 | **404** 同码同文案 |

D-21 / D-22：升级后副本社区帖=0、安排=0。快照后在副本插入 1 帖（引用 book-001）+ 1 安排（`book-001-trusted-v1` → `internal-demo-class`）：

- 现有学生：帖 `quote.availability=available` 且 `text` 非空；安排 1 条
- 新班学生：`GET /community/posts` 0 条（帖是 class scope 在演示班，不是「见帖但 quote unavailable」）；安排 0 条

D-21「见帖、藏 quote」的跨班形态以 T8.7 守卫为准；本演练正例是有 grant 仍见原文。D-25 教师全局 publish 已 403。

快照时 grants=49。HTTP 补草稿 grant 后副本 grants 变成 50，**只发生在副本、且在集合快照之后**。

---

## 3. Gate 2 逐项

依据 09 §17：

| 条件 | 判定 |
|---|---|
| 无断言弱化 / 全局 grant | **pass**（本任务零测试 diff；T8.7 已 verified。未给全库全班 grant） |
| server 全量全绿 | **fail** 339/428，89 红 |
| frontend 全量全绿 | **fail** 239/241，2 红（username-only + 旧 visibility 整文件） |
| build 全绿 | **pass** |
| 副本 quick_check=ok | **pass** |
| 副本 grants=49（快照点） | **pass** |
| 逐学生集合 diff 全空 | **pass** |
| D-21～D-25 正反例符合 09 | **pass**（独立端口 + 副本 HTTP；D-21 跨班藏 quote 形态见上） |
| 证据写入 phase8 | **pass** |

**Gate 2：不通过。** 质量门未全绿，不得申请 T8.9 维护窗口。

---

## 4. 未触碰红线

- 未写真库，未 VACUUM 覆盖源
- 未重启 / 替换 5191（PID 66104 未变）
- 未改实现或测试
- 未进入 T8.9
- 未开浏览器
- 未写 `execution-ledger.md` / `09` / `decisions.md`

---

## 5. 回主控摘要

副本 046→050 演练按 §13.2～13.5 做完：只读 VACUUM INTO、`runMigrations` 两次、重启幂等、集合 diff 全空、独立端口 HTTP 正反例齐。质量门 server/frontend 仍红，Gate 2 不能过，不能申请正式窗口。

建议主控：不要派 T8.9。旧夹具（school_code、username 登录、教师 import/publish、最大号 046、T8.4A porcelain 不变量）是否单独立项收口，由主控裁决；T8.8 不得顺手改测试。

- server 全量：红（339/428，fail 89）
- frontend 全量：红（239/241，fail 2）
- build：绿
- 副本演练：grants=49 / quick_check=ok / 集合 diff 全空
- Gate 2：不通过（质量门未全绿）
