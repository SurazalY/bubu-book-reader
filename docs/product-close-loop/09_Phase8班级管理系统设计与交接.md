# Phase 8 班级管理系统 · 设计定版与交接

写给接手 Phase 8 的**主控**。写作时间 2026-08-18 上午，由 Phase 4 主控在与用户逐轮讨论后定版。

**这不是 Phase 4 的返工，是一个新的中等规模功能开发。** Phase 4 交付的授权底座（`book_access_grants` 三元组 + 四入口过滤 + 授权范围推导）在本阶段**几乎全部照用**，要换的是默认方向和交互语义，要新建的是成员管理。原 Phase 4 的完成标准已另行存档（见 `07_Phase4收尾与交接.md`），不要与本阶段混为一谈。

---

## 一、产品模型定版

以下每一条都由用户在 2026-08-18 的讨论中明确拍板。**本节是 Phase 8 产品模型的唯一现行口径；与 `02`、`03`、`04`、Phase 4 裁决或历史分析冲突时，以本节及 `evidence/phase8/decisions.md` 为准。**

### 角色分工

**技术团队 / 平台运维（platform 范围）**：签发教师注册凭据；指派校长；为教师和校长等校方无法自助的账号签发密码重置码；在受控后端能力中维护全局书库的导入、发布与下架。不得让学校角色承担全局书库管理，也不得以直接修改 SQLite 业务数据代替受控服务、命令或审计。

**校长 / 校级管理员（`school_admin`，school 范围）**：负责全校班级预制、学生/教师注册凭据、学生/教师密码重置，以及成员归属的低频纠错；不管理全局书库，也不因行政身份自动获得班级书架权限。

**年级主任（`grade_manager`，grade 范围）**：负责所管理入学届别的班级预制、学生注册凭据、学生密码重置与成员归属纠错；同时可以签发/撤销本校教师注册凭据、重置本校教师密码。这两项教师账号支持能力按用户裁决为 **school 范围例外**，不把年级主任的班级管理范围扩大到其他届别。日常运营中基本不出现。**演示数据里目前没有 `grade_manager` 账号也没有年级工作空间，本阶段必须补，否则该角色无法验收。**

**班主任 / 语文老师（`teacher`，class 范围）**：教师身份在注册入口完成可信认证；注册后可自选本校一个或多个任教班级并立即生效，不经过教师、年级主任或校长审批。教师审批学生入班、为本班学生签发密码重置码、管理自己任教班级的书架。**运营重心在这一层。**

### 班级与成员

- **班级由校长或该届年级主任预制**，建班时写入学段（小学/初中/高中）、入学年份与班级序号。现有控制台建班界面是**不落库的演示壳**（见 D-24），本阶段要做成真的。
- **教师默认可信，自选班级后立即加入，可多班、可跨届，不设教师归属审批队列。** 原“首位教师自动通过、后续教师由已有教师审批”的方案已由用户在 2026-08-18 明确撤销。安全控制集中在教师专用注册凭据、组织隔离、动作范围、永久审计与事后纠错，不给正常教师增加逐项审批。
- **一个班有多位教师时，他们同时获得该班的学生审批与书架管理权限。** 加入已有教师的班级前只弹一次轻量确认“本班已有 N 位教师，加入后将共同管理”，确认后立即生效，不变成审批。永久记录加入/移除及书架动作的操作者和时间；班级页常驻显示“本班有 N 位教师可管理”；并发写入使用幂等的班级级增删操作，检测到旧状态时提示刷新。不做复杂协同编辑、锁定或校级数据驾驶舱。
- **学生自助注册**，从**预制班级列表**里选班（用户原方案，经比较后采纳，理由见第二节），进入该班的待审核队列。老师批准后正式进班。审核界面展示学生的名称与头像。
- 学生申请状态固定为 `pending / approved / rejected`；被拒后可重新选班再次申请。只有 `approved` 才建立正式班级归属；正式入班后不提供学生自助换班。
- **暂不允许一名学生同时属于多个班。**
- **不做转班功能**（现实中小学转班概率极低）。但**保留行政兜底**：校长与年级主任可手工修改某个学生的班级归属——因为**注册时选错班必然会发生**，没有修正路径就只能删号重注册。此动作须记审计。
- **教师离职、调走或误选班级**：教师可自行退出；校长与年级主任可在授权范围内强制指派或移除教师归属，校长可停用离职教师账号。所有动作须审计，但不设事前审批。
- **升班按学段 + 入学年份处理**：学年切换日固定为中国时区的 **9 月 1 日**；年级是计算值而非每年改写的存储值，班级实体跟着学生走，不做年度批量迁移。年级主任绑定入学届别并随该届移动，不因年级名称变化而重新分配。
- 名称只用于展示，**校内、班内重名均允许**。登录使用 `schoolCode + loginName + password`，`loginName` 在校内唯一；重名时提示可用后缀。账号另有不可变短编号，学生审批队列至少显示展示名、头像、短编号尾号和注册时间，不能用姓名作为身份键。
- 低年级可由家长在学生身边协助建号，但账号与凭据仍是 student；本期不新建 parent 角色、家长绑定或家长代登录链路。

### 注册凭据

- 形态 `/join/<token>`，token 为高熵随机串，**本身不含组织信息**，服务端反查。不得是 `?org=xxx` 这类可枚举形式。
- **注册流程全程从 token 推导组织，请求体里任何 organizationId 都不可信。** 这是多租户的硬要求。
- **一个学校允许有多份有效 token**，便于分批发放与定向撤销（某班凭据泄露只撤那一份，不必全校重注册）。
- 生命周期：学生凭据由校长或对应届别年级主任生成；教师凭据由技术团队、校长或年级主任生成。教师凭据默认 7 天、1 次成功注册；学生凭据默认 180 天。签发者可明确设置有效期与正整数人数上限；撤销只标记 `revoked`，不得删除；允许重新签发。
- **每次通过某 token 完成的注册都要记一条**（时间 + 新账号 id），以便发现异常注册时顺着 token 追溯并一次性撤销该批。
- **教师与学生的注册凭据必须分开**，服务端记录不可变 `expected_role`。角色与组织只能由 token 反查得出；请求体自带的角色或组织一律拒绝。若共用凭据或允许注册者自选身份，任何拿到链接的人都能自称教师，权限模型从入口即失效。
- 教师注册免审，成功后是本校可信教师，可立即自选班级。技术团队、校长和年级主任签发的教师凭据在产品语义上相同，不绑定届别；学校管理者能看到新注册教师并事后移除归属或停用账号。
- token 原文只在签发时显示一次，数据库只存哈希，日志不得出现原文。有效期、撤销状态、人数上限的检查与成功注册留痕必须在同一事务内完成。

### 密码重置

- 不要求学生绑定手机或邮箱。本阶段只做一次性重置码，不建设复杂账号申诉系统。
- 任课教师可为自己班级学生签发重置码；年级主任可为所管届别学生及本校教师签发；校长可为全校学生和教师签发；技术团队处理校长账号等校方无法自助解决的情况。
- 重置码短期有效、仅可成功使用一次、可撤销并全程审计。教师密码重置作用于整个教师账号，成功后必须使旧登录会话失效。

### 书籍

- 语文老师能看到**整个书库**，在自己的管理页面把书**上架到本班**、把已上架的书**从本班下架**。
- **投放/撤下仅影响本班可见范围，不影响书库中的书。** 发布状态（published/draft）与班级书架（`book_access_grants`）是两个正交维度，但现有权限动作并未真正分开：`book.publish` 同时控制全局发布和可见范围写入。该历史耦合登记为 D-25，本阶段必须拆开动作语义。
- 该班学生的书架 = 本班老师上架过的书。
- **可见范围默认翻转**：现在是"无 grants = 全组织可见"，改为"默认不可见，教师挑选投放"。
- 全局书库导入、发布与下架只由技术团队在受控后端层处理，本期不建设校级书库操作。校长、年级主任、教师均无全局发布/下架权；教师只管理自己已加入班级的书架。
- 本期不做书架模板、跨班复制、复杂筛选或校级书架操作。默认全闭后的空班级至少显示“暂无已投放图书，请联系任课教师”，不能呈现为无说明的空白或报错。

### 学生端

- 显示自己所在的班。（注意 `/student/me` 在 Phase 5 已被改动过，加过退出登录入口。）
- 教师从班级撤下一本书后，阻止学生新的打开和新租约；已经打开且仍持有有效租约的阅读器不强制踢出。不得为此修改 90 秒 TTL、续租路由、阅读摘要请求 schema 或指纹算法。

---

## 二、一处方案比较的结论（避免重复讨论）

曾讨论过用"班级级邀请链接"替代"预制班级 + 选班界面"。**结论是采纳后者（用户原方案）**，理由记录在此以免重开：

真正的对比不是"链接 vs 无链接"——预制班级方案**也必须有组织级注册凭据**，否则多租户系统的注册页对全网开放。所以实际对比是「一级凭据 + 选班界面」对「两级链接」。前者明显更省：只做一套凭据生命周期管理；组织级凭据一校一份，撤销与重发压力远小于每班一份；选班界面消掉了"老师把链接发到班群"这个必然出错的人工环节（发错群、学生转发、老师忘发）；教师选班与学生选班还能共用同一套机制。班级列表对学生可见在中小学场景几乎无害。

原先主张班级级链接的理由是"分发渠道形成过滤、老师审核从鉴别降为确认"，但用户明确**暂不考虑鉴别真伪**（低年级由家长参与建号），该理由的价值不足以支撑两套凭据的成本。

---

## 三、工作分解概览

本节只解释五块范围；**真正执行顺序、文件所有权与闸口以第十五节为准**，不得只看本节派工。

### E 演示数据补齐 —— **Gate 1 后并入 T8.2**

补 `grade_manager` 账号与年级工作空间（**现在完全不存在**），以及第二个班。改 `bootstrap-internal-demo.js`，零业务风险。

**为什么在 T8.2 完成**：它是后续角色与跨班验收的前置。不补这个，年级主任那条线永远是空的（Phase 4 只在自动化测试中覆盖过该角色的历史权限，从无真人验证）。它同时提供第二个班，供跨班隔离验证使用。

### A 权限模型设计 —— **已落第十～十二节，先走 Gate 1**

把第一节的模型落成动作清单与角色×scope 矩阵：建班、改班、删班/恢复、教师自助加入/退出/强制指派/移除、学生入班审批、学生班级归属修改、注册凭据生成/撤销、密码重置码签发/撤销、班级书架投放/撤下、全局书库发布/下架。

产出设计文档，不写代码。**其中“教师归属的原子物化”是全阶段最大的身份技术风险，必须先定表间不变量、事务边界与失败行为再动手**，见第五节。产品上已经裁决为免审，不得让实现者重新引入教师审批。

### B 可见范围默认翻转 —— **Gate 1 后可与身份领域并行，不能与迁移/验收乱序**

见第四节的"照用"与第五节的"风险"。它在 `server/domains/reading/`，C/D 在 `server/domains/identity/` 与控制台。

### C 成员管理服务端 —— **依赖 A**

已有可用：`POST /classes`、`POST /students`（L3 用真实 HTTP 实测均 201）。**Gate 1 锁：`POST /students` 在本阶段退役，见 10.4，不得再当绕过审批的建号口。**
缺：班级 update/delete/restore、学生停用、注册与密码重置凭据全套、学生自助注册入口（**公开路由，无 session**）、入班申请与审批、教师自助加入/退出、强制指派/移除、学生班级归属修改。
**完全不存在**：把已有教师加入已建班级（原 D-20）。

### D 控制台与学生端前端 —— **依赖 C 的接口形态**

`src/api/console.js` 现在只有 `listStudents` 与 `listAuthorizedClasses` 两个读接口，要加写接口。`ClassList.jsx` / `ClassDetail.jsx` / `OrgAccounts.jsx` 从演示壳改成真调用，删掉四处"演示环境不写入"文案。新建教师侧班级管理页（含审核队列 + 本班书架管理）。学生端加注册流、选班、显示所在班。

**不要与 C 同时开工**——必须等 T8.3/T8.4 的接口稳定后进入 T8.5/T8.6。

### 建议的排期

```
A（Gate 1）
  └─ E/047～050（T8.2）
       ├─ C 身份领域（T8.3）──┐  可并行
       └─ B 阅读领域（T8.4）──┤
                              └─ HTTP（T8.5）→ D 前端（T8.6）→ 独立验证（T8.7）
```

---

## 四、Phase 4 的地基：哪些照用

**这是本阶段最大的成本节约点，请不要重造。**

- **`book_access_grants` 表结构完全不动。** `(book_version_id, grantee_type='class', grantee_id)` 这个三元组在"默认全开+收窄"和"默认全闭+投放"两种模型下含义完全一样。
- **四个学生侧入口继续共用同一个过滤谓词**（`listBooks` / `getPage` / `getBookAsset` / AI 书籍访问），调用点不重造；必须修改的是 `visibility.js` 中 `isBookVisibleToAudience` 的默认语义。这里包含 D-14 修好的资产入口，被 25 条守卫用例锁着。
- **`class-scope.js` 的授权范围推导照用，而且在新模型下更重要**：class/grade/school/platform 四种 scope → 可操作班级集合，正好对应"班主任管本班、年级主任管本年级、校长管全校"。
- **F-1 的对称校验照用**：移除某班授权时该班也必须在操作者范围内，且悬空 grants（班级已停用/已删除）豁免。新模型下同样成立——教师动不了别班的书架。
- **全局发布/下架既有领域逻辑、幂等与审计机制照用，但权限动作与学校 UI 不照用。** `book.publish` 当前同时控制全局状态和班级可见范围，是 D-25；Phase 8 必须把“技术团队管理全局生命周期”和“教师管理本班书架”拆成不同动作与入口。
- **跨组织隔离已有地基**：`organization_id` 贯穿，Phase 4 守卫测试实测过本校学生对外校书六入口全 404、外组织 classId 与不存在的 classId 同码同文案不泄露存在性。
- **404 而非 403 的口径照用**（403 会泄露"这本书存在"）。

### 四个必须知道的坑（都是 Phase 4 踩出来的）

1. **`context.authorize` 默认 fail-open。** 不要依赖它做角色判定，要直接查 `role_assignments` 做**正向**判定，识别不出就按学生处理（fail closed）。`visibility.js` 顶部有注释记录这一条。
2. **学生的班级来自 `class_memberships`，不是请求头里的工作空间 scopeId。** 曾有账号同时是本班与别班工作空间成员（转班后旧授权未清），用别班头打全部入口——可见性一点没变，因为只从 `class_memberships` 取。
3. **`findUserScope` 只认 active 班级。** 班级停用后，grants 行保留但该班学生失去这本书，而管理端 `GET visibility` 仍把停用班列在授权名单里。这个不一致本期未修（记录在 `evidence/phase4/decisions.md` 第七节），新模型下要重新审视。
4. **`book_access_grants.grantee_type` 没有 CHECK 约束。** 现有谓词有意不过滤 grantee_type（fail closed 方向），配套前提是 `scope=organization` 的 DELETE 清除全部类型。翻转后不得凭直觉删除 `BOOK_HAS_GRANTS_SQL` 或更改未知类型处理；先用明确的新谓词、迁移后状态与对抗测试证明行为，再决定最小改动。禁止用“兼容兜底”掩盖异常 grant。

---

## 五、四个关键风险

### 风险一：教师归属的原子物化（身份侧最高）

**"学生属于哪个班"是 `class_memberships` 一条记录，而"教师属于哪个班"根本不是成员关系**——是"她在该班工作空间有 teacher 角色分配"（`workspace_memberships` + `role_assignments`，后者绑工作空间）。两套机制结构完全不同，而"管班级成员"这个功能天然要处理两种东西。

改动它会波及整条鉴权链：`authorize` 的正向角色判定、`hasBookLibraryManagementRole`、以及 `class-scope.js` 的授权范围推导——后者是 Phase 4 刚建起来、F-1 修复所依赖的东西。**改坏了不会立刻报错，会变成越权。**

**技术方向已经定死：保留双轨，不把 `class_memberships` 改造成唯一授权真相。** 教师自助加入、行政强制指派和移除都必须在一个同步事务中同时维护 `workspace_memberships`、`class_memberships(membership_role='teacher')` 与 `role_assignments(role_code='teacher')`；授权继续以 `role_assignments` 和现有 scope 推导为准，`class_memberships` 用于成员关系与查询。三者任一写入失败则整体回滚，不允许部分成功、异步补偿、自动修复或 fallback。

开工前必须定义并锁测试的不变量：一条 active 教师归属对应三张表的 active 关系；移除后三者同时失效；重复加入幂等；并发加入只产生一组关系；跨组织 classId 与不存在 classId 同码同文案。真实库或迁移副本若发现残缺三元组，立即停手上报，不得自行猜测哪张表为准。

### 风险二：数据迁移（翻转默认值的瞬间）

真库的 `book_access_grants` **现在是 0 行**，49 本书全靠"无 grants = 全组织可见"这条默认规则对学生可见。**翻转默认值的瞬间，49 本书会对所有学生同时消失。**

必须配一次数据迁移，把现有 49 本批量写入现有班级的 grants，保证翻转前后学生看到的东西不变。**这是全阶段唯一有真实数据风险的一步**，顺序错了就是全校书架空掉。当正式迁移做，不要顺手改。

### 风险三：新下放的写接口 = 新越权攻击面

把成员管理下放到班主任，等于给基层角色开了一批新写路径。**每一个都是新的越权面，而且藏着一个与 F-1 同型的陷阱**：班级成员关系决定书籍可见性，所以**如果班主任能把别班学生"拉进"自己班，她就绕过了"无权授权别班"这道墙**——她动不了别班的书架，但她能把人搬到自己的书架前面。

Phase 4 已经证明这类校验会漏一半：F-1 就是"授权范围校验只校验新增哪些班、不校验移除哪些班"，一个正常班主任账号改发 `{"scope":"organization"}` 就能把校长刻意收窄的书重新放给全校。

**所以 C 必须配一个只写测试、不改实现的独立对抗式验证方**，与 Phase 4 同样的打法。那一轮 18 条对抗用例攻出了 4 个洞，其中一个是真实越权。**这是本阶段最值的一笔投入。**

具体要攻的面（起手清单）：入班审批是否严格限定为该班在班教师；教师能否加入外校班、未加入班便操作成员或书架；强制指派/移除是否严格限定 school/grade 范围；年级主任的教师凭据/教师重置这两项 school 例外是否错误扩散到班级管理；注册凭据能否跨组织使用、篡改 expected_role、撤销后继续注册、超过有效期或人数上限；token 能否枚举或出现在日志；学生自助注册这个**公开路由**能否探测组织存在性或灌账号；学生班级归属修改能否被班主任调用。

### 风险四：演示数据重建会干扰其它阶段的验收

本阶段改的是"学生怎么进入系统"。现有 `internal-demo-student` 是 bootstrap 脚本直接造的，班级关系直接写进 `class_memberships`，**没走过任何审核**。注册流改成自助+审核后，这个账号的状态需要重新定义，很可能要重跑 bootstrap 或写一次数据迁移。

**而任何阶段的验收都依赖演示数据能正常登录、打开书、翻页。** 本阶段开工后演示数据会反复重建、迁移反复跑、后端反复重启——**所以 Phase 5 不应与本阶段并行**，否则那边会一直在流沙上验收，且分不清"登录不上"是自己改坏了还是隔壁在重建数据。这也是 2026-08-18 把 T5.1 从"Phase 8 之后"改判为"拉回 Phase 5 压尾"的原因：T5.1 要验"重登恢复"，必须在登录链路稳定的窗口里做，而本阶段恰恰要重造那条链路。**开工前请确认 Phase 5 已全部完成。**

**与 Phase 6 的既定顺序（2026-08-18 用户纠正）：** Phase 8 先实施并完成，Phase 6 再基于最终系统做阅读计时联动验收。Phase 6 尚未归档**不是** T8.2 的阻塞条件。Phase 8 实施期间，Phase 6 不得占用共享 5191、不得写真实业务库、不得修改阅读计时相关文件；Phase 6 的真实验收放在 Phase 8 完成之后。

---

## 六、三个必须提前约定的协调点

**迁移编号（2026-08-18 实测）。** 当前目录有 30 个迁移文件，最大号为 `046_reader_mode_preferences.sql`；**Phase 8 首号是 047**。每次取号都必须重新列目录取最大编号 +1，禁止依赖本文计数、禁止按文件数量推号。若 047 已被占用或最大号与预期不同，立即停手更新计划，不得撞号或自行改历史迁移。

**后端重启窗口。** 后端没有热重载，改完必须重启 5191，而用户在浏览器里验收也用同一个 5191。约定：用户验收时不重启，或给验收单独起一个端口实例。Phase 8 代码阶段不得重启或替换共享 5191；机器验证一律用临时库 + 独立端口。Phase 6 在本阶段实施期间不得占用该共享端口。

**分支起点。** 用户已授权在 Phase 4 发布/下架验通过后提交一次，给后续工作一个干净起点。本阶段开工前请确认那次提交已完成，否则你的改动会和 48 条未验证的 Phase 4 改动混在一起，出问题无法二分定位。

---

## 七、残余缺陷：本阶段处置已裁决

Phase 4 主动决定不修三条泄露路径。**注意：默认全闭之后它们的暴露面变大了**——默认全开时大部分书本来人人可见，泄露的边际影响小；默认全闭后绝大多数书对绝大多数学生不可见，而这三条路径**不受可见范围约束**。

- **D-21 本阶段修，固定采用读取时过滤。** 查看者对引用书无可见权时保留帖子，但不返回 `quote.text`，界面显示“引用内容当前不可见”。旧帖不改写历史数据，读取时自动受同一规则覆盖。
- **D-22 本阶段与可见范围投影一起修。** 不可见书对应的阅读安排不得向学生投影书名或 `bookVersionId`；不得靠前端隐藏字段。
- **D-23 本阶段必须修。** 只收紧新租约获取的前置条件：学生必须同时满足图书已发布且对其班级可见，才可进入租约写事务。不得修改 `reading_summary_sessions` / `reading_daily_book_summaries` 表结构，不得修改 `POST /reading/session-summaries` 请求 schema 或指纹算法，不得修改 90 秒 TTL 与续租路由。若修复被证明必须触碰任一冻结项，立即停手交用户裁决。

---

## 八、继承的硬规则

- **主控不写业务代码、不跑测试构建、不直接探索代码库。** 一切实现派子 agent。
- **不开浏览器。** 浏览器操作全部由用户本人执行。本项目曾因 agent 开的标签页脱管堵死近三小时。
- **不得宣称"验收通过"**，必须有真实运行证据。五级状态口径见 `03_实施任务清单.md` T7.4。
- **阅读计时是冻结契约**：表、schema、指纹算法、租约 TTL、续租路由一律不动。
- **不得向业务数据库手工写入**；测试一律用临时库（`mkdtempSync`）。需要在真实数据上验证时，用只读连接 `VACUUM INTO` 生成副本 + 独立端口实例（Phase 4 的 L3 验证有完整的可复用做法，见 `evidence/phase4/decisions.md` 第六节）。
- **决策必须留痕。**
- **不得 `git checkout` / `reset` / `stash` / `clean` / `restore`。**
- 派子 agent 的详细经验见 `08_Phase5交接说明.md` §八，逐条照用。特别是**要求每份报告分「实测」与「推断」两栏**——这一条在 Phase 4 抓出了大量问题。

---

## 九、用户裁决状态

产品方向已于 2026-08-18 全部拍板，没有留给实施者临场选择的开放产品问题：

1. 教师归属保留现有授权双轨并以单事务物化三张关系表；教师自选班立即生效，不设审批。
2. 学年切换日为 9 月 1 日；班级存学段与入学年份，年级为计算值。
3. D-21 读取时隐藏不可见引用；旧帖不改写。D-22、D-23 同期收口。
4. 技术团队、校长、年级主任均可签发教师专用凭据；教师身份可信后可自主管理本人所选班级。
5. 全局书库只归技术团队，学校角色只存在班级书架动作；D-25 必须拆分 `book.publish` 的历史耦合。

后续需要用户参与的只有三个离散闸口，而不是产品再设计：批准权限/状态/API/schema 定稿；授权真实数据库迁移窗口；完成最终真人浏览器验收。闸口细则、停止条件和固定执行任务包已分别写入第十七、十六、十五节。2026-08-18 用户已批准 Gate 1，下一任务是 T8.2。Phase 8 先于 Phase 6 实施；Phase 6 未归档不阻塞 T8.2。状态见 `evidence/phase8/execution-ledger.md`。

---

## 十、权限契约（Gate 1 的冻结输入）

### 10.1 scope 记号

| 记号 | 精确含义 |
|---|---|
| P | 目标学校对应的 organization-scoped platform workspace；body 显式 organizationId 且必须等于该 workspace.organizationId，并进入审计。不得为此放宽成跨租户万能平台角色 |
| S | 当前学校；目标 `organization_id` 必须等于当前工作空间组织 |
| G | 当前年级主任负责的稳定届别；目标班 `grade_id` 必须等于该 grade 工作空间 `scope_id` |
| C | 教师当前 active class 工作空间；目标 classId 必须等于角色分配 `scope_id` |
| V | 无工作空间的新教师入口；正向证据算法见 10.4。禁止复用 `listActiveRoleAssignments` / `service.authorize` / `requireWorkspace` |
| Self | 当前登录用户本人 |

“—”表示明确拒绝，不是“暂未实现”。404/403 口径：跨组织 id、无权知道是否存在的 id 与不存在 id 一律同码同文案 404；资源存在且身份已知但动作不允许才用 403。

### 10.2 Phase 8 完整动作清单与角色 × scope 矩阵

下表只列 Phase 8 新增或改变的动作；阅读、社区、报告等未列动作沿用既有契约。不得继续用宽泛的 `account.manage`、`class.manage` 或 `book.publish` 代替这些动作。

| 动作 | platform_ops | school_admin | grade_manager | teacher | student/公开入口 |
|---|---:|---:|---:|---:|---:|
| `class.directory.read` | — | S | G | V（仅 `/teacher/class-directory` 与公开 token；不得用 `GET /classes`） | 有效 student token 的允许范围 |
| `class.read` | — | S | G | C | Self 只读本人班级摘要 |
| `class.create` | — | S | G | — | — |
| `class.update` | — | S | G | — | — |
| `class.disable` | — | S | G | — | — |
| `class.restore` | — | S | G | — | — |
| `grade_manager.assignment.assign` / `remove` | — | S | — | — | — |
| `school_admin.assignment.assign` / `remove` | P | — | — | — | — |
| `teacher.affiliation.join_self` | — | — | — | V | — |
| `teacher.affiliation.approve` | — | — | — | — | —（本动作已废止，不得实现） |
| `teacher.affiliation.leave_self` | — | — | — | V（session-only；幂等见 10.4 / §12.1） | — |
| `teacher.affiliation.force_assign` | — | S | G | — | — |
| `teacher.affiliation.force_remove` | — | S | G | — | — |
| `teacher.account.disable` / `restore` | — | S | — | — | — |
| `student.account.disable` / `restore` | — | S | G | C | — |
| `student.enrollment.read_self` | — | — | — | — | Self |
| `student.enrollment.review` | — | S | G | C | — |
| `student.affiliation.correct` | — | S | G | — | — |
| `registration.student.issue` / `revoke` | — | S | G | — | — |
| `registration.teacher.issue` / `revoke` | P | S | S（明确例外） | — | — |
| `password_reset.student.issue` / `revoke` | — | S | G | C | — |
| `password_reset.teacher.issue` / `revoke` | P | S | S（明确例外） | — | — |
| `password_reset.school_admin.issue` / `revoke` | P | — | — | — | — |
| `book.shelf.read` | — | — | — | C | 学生只读最终书架，不读管理快照 |
| `book.shelf.grant` | — | — | — | C | — |
| `book.shelf.revoke` | — | — | — | C | — |
| `book.catalog.import` | P | — | — | — | — |
| `book.catalog.publish` | P | — | — | — | — |
| `book.catalog.unpublish` | P | — | — | — | — |
| `book.catalog.archive` | P | — | — | — | — |

所有写动作必须写 `audit_events`，至少包含 actor、workspace（公开消费与 session-only 写作为除外，后者 workspace 记 null，改记 organizationId + 目标 classId）、resource、目标 scope、requestId、结果与前后 version；token 原文、密码和密码哈希禁止进入审计。校长由技术团队在受控后端指派；校长可把同校可信 staff 指派为某届年级主任。两者都复用 workspace membership + role assignment，不新建另一套管理员表。

“可信 staff”不由请求体声明：指派 `school_admin` 或 `grade_manager` 时，目标必须是同组织 active user，且有 10.3 所定义的 teacher 基础身份正向证据。行政角色可与 teacher 并存；指派行政角色不自动创建任何班级归属。本期不设“最后一名校长/年级主任不可移除”特例；移除后的恢复责任分别回到技术团队/校长，不做隐式保留权限。

### 10.3 两个不能用通用 scope 推导的窄入口

1. **新教师无工作空间。** `teacher.affiliation.join_self` 不能调用要求 `X-Workspace-Id` 的通用 `authorize`；必须走 session-only 路由，并用 V 的正向证据判断。不得为了复用中间件给新教师创建 school 范围角色。
2. **年级主任的教师账号支持是 school 例外。** 只对 `registration.teacher.*` 与 `password_reset.teacher.*` 做“当前 active grade_manager + 同组织”正向检查；不得修改 `scopeAllows()` 让 grade scope 普遍包含 school，否则会把班级、学生和书架权限一并扩散。

角色别名处理：保留 `class_teacher → teacher`、`grade_admin → grade_manager`、`platform_operator → platform_ops`；移除 `grade_group → grade_manager`。后者若保留，会让历史“教研组”别名获得 school 范围教师凭据与重置权。迁移前若查到任何 `role_code='grade_group'`，按停止条件上报，不得静默改名。

账号基础身份同样只做正向推导：优先读取成功的 registration use；既有账号读取同组织当前或历史 student/teacher role assignment。请求体不得声明账号类型。若同一账号同时出现 student 与 teacher 两种基础身份证据，按不变量冲突停止；grade_manager/school_admin 等行政角色可与 teacher 基础身份并存，不构成冲突。

### 10.4 Gate 1 复核后锁死的执行口径（2026-08-18）

与 §10～§15 其它段落冲突时以本小节为准。以下不是产品改判，只把可执行查询、挂载点和退役路径写死，消灭“实现时再定”。

**V 正向证据（满足任一即可，必须自写查询，禁止复用 `listActiveRoleAssignments` / `service.authorize` / `requireWorkspace`）：**

1. 存在 `registration_credential_uses` 行：`created_user_id = 当前用户` 且 `expected_role = 'teacher'` 且 `organization_id` 与用户组织相同。
2. 存在同组织 `role_assignments` 行：`user_id = 当前用户` 且 `role_code` 归一化后为 `teacher`（含历史别名 `class_teacher`），**不论** `status` 为 active 或 disabled，也不论所挂 workspace 是否仍 active。这就是“当前/历史 teacher role assignment”。

若 1 与 2 都不存在，V 失败；无权知道组织细节时用 404。不得为了让 V 通过而创建 school 范围 teacher role 或 organization-scoped workspace。student 与 teacher 两种基础身份证据同时存在 → 停止条件，返回 `IDENTITY_INVARIANT_VIOLATION`。

**session-only 挂载：** `GET /onboarding/me`、`GET /teacher/class-directory`、`PUT/DELETE /teacher/classes/:classId` 只挂 `server/domains/identity/index.js`，且必须在任何 `requireWorkspace` 之前。禁止挂到 `integration-router.js`（该路由在公开 summary-link 之后对其余请求全局 `requireWorkspace`）。

**leave_self：** 路由为 session-only，不要求 `X-Workspace-Id`，不调用通用 `authorize`。当前用户必须通过 V 教师基础身份正向证明。然后按班级与三元组状态分支，**不得**因为关系已经 disabled/absent 而在幂等检查前返回 403：

- class 不存在或跨组织：404（与无权知道存在性同码同文案）。
- 该用户对该班存在完整 active 教师三元组：同事务停用三者，200。
- 存在完整 disabled 教师三元组：200 no-op。
- 三张关系全部不存在：200 no-op。
- 三张关系部分存在、状态混合或相互不一致：500 `IDENTITY_INVARIANT_VIOLATION`，并命中停止条件。

这与 §11.6 / §12.1「已 disabled/absent 的移除均 200 幂等；残缺不是幂等」一致。

**班级目录分流：**

- 教师选班 / 零 workspace 目录：只走 `GET /teacher/class-directory`（V），只返基础字段 + `teacherCount`。
- 公开学生 token 目录：只走 `GET /registration/:token`。
- `GET /classes`：仅 `school_admin` 的 S 与 `grade_manager` 的 G；可带 studentCount / teacherCount / pendingStudentCount 与过滤。教师调用本路由 → 403。
- 已入班教师看本班：`GET /classes/:classId` + `class.read` + C（此时才要求 `X-Workspace-Id`，且 classId 必须等于当前 workspace.scope_id）。

**teacherCount：** 计“该班完整 active 教师三元组”人数。若该班 `class_memberships(teacher,active)`、对应 class workspace 的 `workspace_memberships(active)`、`role_assignments(teacher,class,active)` 三者人数不一致，或出现残缺三元组，返回 `IDENTITY_INVARIANT_VIOLATION` 并停止，不得用其中一张表凑一个数字。

**`POST /students`：** T8.3 **删除**现有 HTTP `POST /students` 路由。不保留兼容 handler、弃用 handler 或假 404 分支；删除后由标准不存在路由返回 404。运行时创建学生的唯一入口是 student 注册凭据 → pending → 审批。bootstrap / seed 仍可按文档直接准备已批准演示关系，但不是 HTTP 后门。教师不得再用 `account.manage` 绕过 pending 队列。第三节“已有可用 POST /students”是 Phase 4 历史事实，不是本阶段保留口。

**旧宽动作：** Phase 8 写路由禁止再授权 `account.manage`、`class.manage`、`book.publish`。`POST /classes` 必须改用 `class.create`，resourceScope 必须带服务端计算后的 `gradeId`（年级主任用 G，校长用 S）；禁止继续提交纯 school 形、无 gradeId 的 resourceScope。`account.manage` 是否从 `roleActions` 整键删除，须在 T8.3 盘点 `PATCH /users` 等非本阶段路由后做最小删除；盘点前不得整表拔掉，也不得继续用它建学生。

**D-25 发布维度绑定：** `isBookVisibleToAudience` 只回答班级 grant 可见性；`bypassClassGrants=true` 不得被当成“也可以看 draft”。必须改的现网入口：

- `listBooks`：`allowUnpublished=false` 时强制 `status='published'`，教师不能列 draft。
- `requireScopedBook` / `getBookAsset`：`anyBookStatus` 只看 `allowUnpublished`，不得再看旧的 `unrestricted` 或新的 `bypassClassGrants`。
- `BOOK_LIBRARY_MANAGEMENT_ROLES`：校长 / 年级主任不得因该集合进入书库 audience。

Phase 4 P4-5“教师可取未发布资产”已被 P8-07 与 §13.1.4 覆盖。

**书架 F-1：** `book.shelf.grant/revoke/read` 只用当前请求 class workspace 上的 teacher assignment。目标 classId 必须等于该 assignment 的 `scope_id`。禁止对 shelf 调用 `listAuthorizedClasses`（school/platform assignment 会 `wholeOrganization=true`，会把校长或兼任行政的教师放行到全校书架）。`class-scope.js` 继续用于班级生命周期、入班审批、行政纠错的 S/G 范围。

**`navigationForUser`：** 登录 HTTP 已允许零 workspace 返回 200。必须改 `navigationForUser`：pending 学生 `defaultPath='/student/onboarding'`；V 成立且零 active 教师班 `defaultPath='/console/select-class'`。`src/student/pages/Login.jsx` 与 `src/console/pages/Login.jsx` 不得再把空 `defaultPath` 当成登录失败；只接受服务端给出的上述路径或既有 workspace 入口。

**D-21 / D-22 取证与所有权：**

- 学生社区列表的线上投影是 `server/integration/projections.js` 的 `projectCommunityPosts`（`GET /community/posts`），不是 `getPost`。`community.getPost` 仍要同步过滤（创建帖后回读走它）。
- 学生阅读安排的线上投影是同文件的 `projectAssignments`（`book.id` 实际是 `bookVersionId`）。
- T8.4 拥有 `visibility.js` 共享谓词和 `community/index.js` 的 `getPost`。
- T8.5 拥有把这两个投影接到同一谓词；`projections.js` 只允许改这两处及相关测试，不得顺手改其它投影。
- T8.4 的 shelf 领域函数禁止再调用 `book.publish`。

**校长指派：** path `organizationId` 是唯一目标；若 body 也带 organizationId，必须与 path 相等，否则 400。P 的 workspace.organizationId 必须等于该目标。

**import / archive：** 本期不新增 HTTP。`book.catalog.import` / `archive` 继续走既有受控 CLI / 领域函数；permissions 仍按 10.2 只给 platform_ops。

**行政纠错测试：** §14.2 必须单列一组：源+目标对称校验、教师调用 403、目标即当前班 200 且不掩盖残缺、残缺三元组 500+停止。

---

## 十一、数据模型、迁移编号与不变量

### 11.1 当前真库基线（2026-08-18 只读实测）

分支 `feat/product-close-loop`、HEAD `b3cd4b5`；迁移最大号 046。业务库为 1 个 active 组织、1 个 active 班 `internal-demo-class`（`internal-demo-grade`，三年级一班）、49 本 published、49 个版本、0 条 grants、1 个 active student 班级关系、2 个 active teacher 班级关系；class/school/platform 工作空间各 1，无 grade 工作空间，无 `grade_manager` 角色行。

以上不是“可自动适配的示例”，而是 047～050 的执行前置。任一数量、id、状态或最大迁移号变化，先停手更新迁移设计和集合快照，不得继续套用本文回填。

### 11.2 固定迁移分配

取号仍以执行时“列目录取最大号 +1”为最终依据；在上述基线未变化时固定为：

| 编号 | 文件职责 | 禁止夹带 |
|---|---|---|
| 047 | organization 登录码、user 校内登录名/短编号、class 学段/入学年份/班号、稳定届别、唯一索引与写入触发器 | 不写注册 token、grants、阅读表 |
| 048 | `registration_credentials`、`registration_credential_uses` | 不创建用户、不放业务默认 token |
| 049 | `student_enrollment_requests`、`password_reset_credentials`、一名学生最多一个 active 班级的部分唯一索引 | 不改 session/阅读摘要 schema |
| 050 | 仅做默认全闭前的 `book_access_grants` 一致性回填 | 不改表结构、不删既有业务行 |

047 被占用或目录最大号不再是 046 时停止，重新列号并同步本文、测试和执行台账；禁止按文件数量推号。

### 11.3 047 的字段语义与既有数据回填

- `organizations.school_code TEXT COLLATE NOCASE`：登录时的人类可输入学校码，校内不重复。当前组织固定回填 `internal-demo`；以后创建组织必须显式提供。
- `users.login_name TEXT COLLATE NOCASE`：校内唯一，现有 5 个账号从 `username` 原值回填。新增账号的旧 `users.username` 只作为内部兼容键写成新 userId（UUID），登录、DTO 和 UI 不再把它当用户输入。
- `users.account_code TEXT COLLATE NOCASE`：不可变短编号；现有账号按稳定 rowid 生成 `A` + 7 位十进制，新账号固定为 `U` + 新 userId 去连字符后前 12 位大写十六进制，并受 `(organization_id, account_code)` 唯一索引约束。若极小概率命中该索引，在同一注册事务内重新生成 userId/accountCode，最多 3 次；仍冲突则整体回滚并返回 500 `ACCOUNT_CODE_ALLOCATION_FAILED`，不放宽唯一性。审批只展示尾 4 位。
- `classes.stage`：`primary / junior / senior`；`entry_year` 为四位整数；`class_number` 为正整数；`grade_id` 保留但语义固定为 `<stage>:<entryYear>` 的稳定届别键，不再存“当前三年级”。
- 当前 `internal-demo-class` 明确回填 `stage='primary'`、`entry_year=2023`、`class_number=1`、`grade_id='primary:2023'`。迁移前若不再只有这一个既有班级，停止而不是根据中文班名猜测。
- 新增唯一索引：school_code 全局唯一、`(organization_id, login_name)`、`(organization_id, account_code)`、`(organization_id, grade_id, class_number)`、active 且 organization-scoped workspace 的 `(organization_id, scope_type, scope_id)`。
- 因 SQLite `ADD COLUMN` 不能直接给既有表补齐全部 NOT NULL 约束，047 在回填后增加 INSERT/UPDATE 触发器：拒绝空 school_code/login_name/account_code，拒绝非法 stage/entry_year/class_number，拒绝 `grade_id <> stage || ':' || entry_year`。不得用应用层默认值代替数据库拒绝。

年级计算唯一公式：以 `Asia/Shanghai` 日期判断学年；9 月 1 日及以后 `academicStartYear=当前公历年`，此前为 `当前年-1`；`level=academicStartYear-entry_year+1`。小学有效 1～6，初中/高中有效 1～3；小于 1 返回 `upcoming`，超过学段长度返回 `graduated`。毕业班保留历史，只读展示，不进入注册班级目录、教师自助加入目录或新审批队列。

每个稳定 grade_id 最多一个 active grade workspace；创建该届第一个班时在同一事务确保 workspace 存在（`code='grade-admin'`,`scope_type='grade'`,`scope_id=grade_id`），但不自动指派任何年级主任。校长后续显式指派；移除年级主任只停用其 workspace membership 与 grade_manager role，不影响班级、教师或学生。

### 11.4 048 注册凭据表

`registration_credentials` 必含：`id`、`organization_id`、`secret_hash`（SHA-256 十六进制，唯一）、`expected_role(student|teacher)`、`scope_type(school|grade)`、`scope_id`、`expires_at`、可空正整数 `max_uses`、`successful_use_count`、`revoked_at/by/reason`、`created_by_user_id`、`created_workspace_id`、时间戳、`version`。

`registration_credential_uses` 必含：`id`、`credential_id`、`organization_id`、`expected_role`、`created_user_id`、`request_id`、`used_at`；每次**成功创建账号**一行，`created_user_id` 唯一。失败、校验不通过和重放不增加 use count。

原始 token 固定为 32 个密码学随机字节的 base64url；只在 201 响应显示一次，数据库、审计、错误和普通日志只出现 credential id/哈希前缀。教师默认 7 天、`max_uses=1`；学生默认 180 天、`max_uses=NULL`，签发者可显式给正整数上限。教师凭据一律 school scope；grade_manager 签发学生凭据时一律为自己的 grade scope，不允许 body 改 scopeId。

### 11.5 049 入班与重置表

`student_enrollment_requests` 必含：`id`、`organization_id`、`student_user_id`、`class_id`、`status(pending|approved|rejected)`、`requested_at`、`decided_at/by`、可空 `decision_reason`、时间戳、`version`；部分唯一索引保证每名学生最多一条 pending。批准记录不回退，重新申请新建一行。

`password_reset_credentials` 必含：`id`、`organization_id`、`target_user_id`、`secret_hash`（唯一）、`expires_at`、`used_at`、`revoked_at/by/reason`、`created_by_user_id`、`created_workspace_id`、时间戳、`version`。重置码同样用 32 字节随机 token，默认 30 分钟，仅一次成功消费，原文只显示一次。

049 同时建立：`class_memberships(user_id)` 在 `membership_role='student' AND status='active'` 条件下唯一。迁移前若已有学生多 active 班，停止上报，不得任选一条保留。

### 11.6 核心原子事务与关系不变量

所有事务使用同步 `BEGIN IMMEDIATE`；任一步失败整体回滚，不做异步补偿和自动修复。

1. **注册消费**：锁定并复查 token → 校验有效期/撤销/人数/role/scope → 校内 loginName 冲突检查 → 建 user+credential → 写 use 并增 successful count。student 同事务另建 pending request；teacher 可把提交的 0～N 个同校 active classId 逐个物化为教师归属。
2. **教师归属物化/移除**：同一 class+teacher 必须同时 active/disabled 三条关系：`class_memberships(teacher)`、`workspace_memberships`、`role_assignments(teacher,class)`。重复加入/移除返回当前状态，不能产生第二组；遇到历史残缺三元组返回 `IDENTITY_INVARIANT_VIOLATION` 并触发停止，不得补半边。
3. **学生审批**：条件更新 request `pending→approved`，确认学生尚无 active 班，再一次性创建 student 的 class membership、workspace membership、role assignment；拒绝只做 `pending→rejected`。并发审批只有一个条件更新成功，另一个返回 VERSION_CONFLICT。
4. **密码重置消费**：锁定并复查 reset token → 更新现有 `credentials.password_hash` 与 version → 标记 `used_at` → 将该用户所有 `sessions.revoked_at IS NULL` 行统一撤销 → 写审计。密码校验失败不消费 token。
5. **学生行政纠错**：正向查得唯一 active 源班三关系，确认无 pending 申请，再对源班与目标班同时做 F-1 范围校验；目标必须同组织、active、未毕业。同事务将源班的 student class/workspace/role 三关系停用，并将目标班三关系创建或从完整 disabled 状态恢复；任一侧为残缺三元组就停止。body `version` 是源 `class_memberships.version`，`reason` 必填并进审计；目标就是当前班时返回 200 幂等结果，不重写关系。
6. **班级改届别**：先对变更前与变更后届别同时做 scope 校验，再用 `classes.version` 条件更新 stage/entryYear/classNumber/gradeId，并在同事务确保目标 grade workspace 存在。教师/学生 class workspace 与三关系都不换 id；不自动迁移或新指派年级主任。

班级“删除”只做软停用：classes 与对应 class workspace 在同一事务 active→disabled，成员关系与 grants 保留；恢复时只把原 class/workspace 恢复 active，原书架和成员随之恢复。不得物理删除班级。disabled/graduated 班不接受新注册、加入或审批。

---

## 十二、状态机与 HTTP 契约

### 12.1 状态机（没有未定义的回边）

| 对象 | 合法迁移 | 并发/重复口径 |
|---|---|---|
| 班级 | `active → disabled → active`；`graduated` 是日期计算结果，不写 status | version 条件更新；旧 version 返回 409 VERSION_CONFLICT |
| 教师归属 | 三元组 absent/disabled → active；active → disabled | 已 active 的加入、已 disabled/absent 的移除均 200 幂等；残缺三元组不是幂等，报不变量错误并停 |
| 入班申请 | 新建 pending；`pending → approved` 或 `pending → rejected` | 终态不可改；重复决策 409 VERSION_CONFLICT；拒绝后重申新建行 |
| 注册凭据 | active（派生）→ revoked；到期或用尽为派生终态 | revoked/expired/exhausted 不恢复；管理端可区分，公开端统一 404 |
| 重置凭据 | active（派生）→ used 或 revoked；到期为派生终态 | used/revoked/expired 不恢复；重复消费公开端统一 404 |
| 用户 | `active ↔ disabled`；student 按 S/G/C，teacher 仅由 school_admin 按 S 操作 | 停用立即使 session 和所有 active role 判定失效；不物理删用户 |

### 12.2 路由清单

以下路径均相对 `/api/v1`。除标“公开”或“session-only”的路由外，继续使用 session + `X-Workspace-Id`；所有写路由必须使用既有 idempotency 设施。公开注册/重置的幂等 scope 使用 token 哈希而非原文。

本节中“必须带 version”统一沿用既有 `expectedVersion(req)` 契约：可传 `If-Match` 请求头或 body `version`，两者同时存在时以 `If-Match` 为唯一判定值，不做二次尝试。客户端新调用一律发 `If-Match`；表格中保留的 body `version` 只是对现有后端契约的明确复用。缺少 version 返回 400 `VALIDATION_FAILED`，值过期返回 409 `VERSION_CONFLICT`。

幂等与 version 的先后次序也固定：相同 `Idempotency-Key` + 相同请求指纹先返回已存结果；新 key 或首次请求再校验当前 version。除入班审批终态按 12.1 固定返回 409 外，资源已在目标状态且携带当前 version 时返回 200 no-op 并记审计；携带旧 version 即使“看起来已完成”也返回 409，不用状态相同掩盖并发冲突。不带 version 的自然键增删（教师归属、行政角色指派、班级书架）按当前三元组/自然键返回 200 幂等结果。

| 方法与路径 | 鉴权/动作 | 请求与结果要点 |
|---|---|---|
| `POST /auth/login` | 公开 | body 固定 `{schoolCode, loginName, password}`；移除 username-only 登录；同一 401 文案防枚举 |
| `GET /registration/:token` | 公开 | 只返回学校名、expectedRole、到期时间和允许选择的 active 班基础字段；无人数、成员或账号信息 |
| `POST /registration/:token` | 公开 + Idempotency-Key | body 公共字段 `{loginName,displayName,password}`；student 必带 `classId`，teacher 只可带 `classIds[]`；body 出现 role/organizationId/scopeId 直接 400 |
| `GET /onboarding/me` | session-only | 返回注册角色、pending/rejected 申请或教师班级归属；零 workspace 用户也可访问 |
| `GET /teacher/class-directory` | session-only + V | 返回同校 active、未毕业班基础字段与 `teacherCount`，不返回学生数/名单 |
| `PUT /teacher/classes/:classId` | session-only + `teacher.affiliation.join_self` | 教师自助立即加入；200，返回三元组状态、可用 workspaceId 与写后 `teacherCount` |
| `DELETE /teacher/classes/:classId` | session-only + `teacher.affiliation.leave_self` | 须通过 V；不要求 `X-Workspace-Id`；完整 active 三元组则同事务停用；完整 disabled 或三者皆无则 200 no-op；残缺 500；不得因 disabled/absent 先 403；最后一名教师也允许退出 |
| `GET /classes` | `class.directory.read` | 仅 S/G 管理视图；教师 403。可带 studentCount / teacherCount / pendingStudentCount。V 与公开目录见 10.4 |
| `GET /classes/:classId` | `class.read` | 按 S/G/C 返回班级详情；student 仅 Self 且只返本人班级摘要 |
| `POST /classes` | `class.create` | `{name,stage,entryYear,classNumber}`；服务端生成 gradeId，201 |
| `PATCH /classes/:classId` | `class.update` | 可改 name/stage/entryYear/classNumber，必须带 version；更改届别后重新按目标 G 校验 |
| `DELETE /classes/:classId` | `class.disable` | 必须带 version；软停用 class+workspace，200 |
| `POST /classes/:classId/restore` | `class.restore` | 必须带 version；恢复原 class+workspace，200 |
| `PUT/DELETE /grade-cohorts/:gradeId/managers/:userId` | `grade_manager.assignment.*` | 仅 school_admin；原子维护 grade workspace membership + grade_manager role，200 幂等 |
| `PUT/DELETE /organizations/:organizationId/school-admins/:userId` | `school_admin.assignment.*` | 仅目标组织 platform workspace；受控后端入口，不做学校 UI |
| `PUT /classes/:classId/teachers/:userId` | `teacher.affiliation.force_assign` | 目标须为同校已验证教师；200 幂等 |
| `DELETE /classes/:classId/teachers/:userId` | `teacher.affiliation.force_remove` | 200 幂等；grade_manager 只能目标 G |
| `POST /users/:userId/disable` / `restore` | `teacher.account.*` 或 `student.account.*` | body `{version,reason}`；按目标基础身份选动作；停用撤销该用户全部 session，不删除关系，恢复不恢复旧 session |
| `GET /classes/:classId/enrollment-requests?status=` | `student.enrollment.review` | 默认 pending；返回辨认所需最小字段 |
| `POST /enrollment-requests/:id/approve` | `student.enrollment.review` | body `{version}`；批准并原子物化学生三关系 |
| `POST /enrollment-requests/:id/reject` | 同上 | body `{version,reason?}`；不建成员关系 |
| `PATCH /students/:userId/class` | `student.affiliation.correct` | body `{targetClassId,version,reason}`；只供行政纠错，不出现在学生/教师 UI |
| `GET /registration-credentials?expectedRole=` | 对应 role 的 issue/revoke | `expectedRole=student|teacher` 必填；按矩阵推导 S/G 与 school 例外，只列元数据、状态与使用数，不返回 hash/raw token |
| `POST /registration-credentials` | `registration.*.issue` | body `{expectedRole,expiresAt?,maxUses?,organizationId?}`；organizationId 仅 platform 必填，其他角色提供即 400；scope 由 actor 推导；201 的 rawToken 只出现一次 |
| `POST /registration-credentials/:id/revoke` | 对应 `registration.*.revoke` | body `{version,reason}`；200 幂等但不删除 |
| `GET /users/:userId/password-reset-credentials` | 对应 `password_reset.*.issue` | 按目标账号类型与 scope 校验；只列未删除凭据的 id/状态/到期/签发人，不返回 hash/raw token |
| `POST /users/:userId/password-reset-credentials` | 对应 `password_reset.*.issue` | 201 一次性返回 rawToken；目标 scope 按矩阵校验 |
| `POST /password-reset-credentials/:id/revoke` | 对应 revoke | body `{version,reason}`；不删除 |
| `POST /password-resets/:token/consume` | 公开 + Idempotency-Key | body 仅 `{newPassword}`；成功重置并撤销目标用户全部旧 session |
| `GET /classes/:classId/shelf` | `book.shelf.read` | 返回该班显式 grant 的 published 书；每次动作的操作者/时间查永久审计，不改 grants 表结构 |
| `PUT /classes/:classId/shelf/:bookId` | `book.shelf.grant` | 仅当前 C；只增本 class grant，200 幂等，不替换其他班集合 |
| `DELETE /classes/:classId/shelf/:bookId` | `book.shelf.revoke` | 仅当前 C；只删本 class grant，200 幂等，不动其他班 |
| 既有 `POST /books/:bookId/publish|unpublish` | `book.catalog.publish|unpublish` | 仅 platform_ops；复用领域幂等/审计；学校 UI 删除按钮和调用 |

既有 `GET/PUT /books/:bookId/visibility` 在 Phase 8 **删除路由与前端调用**，不保留 `scope=organization` 兼容分支。班级书架必须走 class-local API；否则一个教师提交全量 classIds 会覆盖其他教师/班级的 grant。技术团队的全局发布路由不得顺带创建或清空 grants。

既有 `POST /students` 在 Phase 8 **删除该 HTTP 路由**，见 10.4。不保留兼容 handler、弃用 handler 或假 404 分支；删除后由标准不存在路由返回 404。运行时创建学生的唯一入口是注册凭据 → pending → 审批。

多教师提示的交互顺序固定为：前端从 class directory 读取 `teacherCount>0` 时先弹确认；用户取消则不发写请求，确认则直接 PUT，服务端不增加审批状态或“已确认”字段。若并发导致预读人数过期，PUT 仍正常幂等生效，页面以响应的写后 `teacherCount` 刷新常驻提示；这不是权限绕过。

### 12.3 DTO 与辨认规则

- class DTO 固定包含 `{id,name,stage,entryYear,classNumber,gradeId,currentGrade,lifecycle,status,version}`；`currentGrade` 为 1～6/1～3 或 null，`lifecycle=upcoming|active|graduated`。
- enrollment DTO 固定包含 `{id,status,version,requestedAt,class,student:{id,displayName,accountCodeSuffix,avatarSeed}}`。`avatarSeed=accountCode`，前端据此生成稳定的首字/颜色头像；本期不建头像上传表。
- registration DTO 不返回 secretHash；issue 响应才额外包含一次性 `rawToken`。
- pending 学生登录成功后 `activeWorkspaceId=null`，导航固定 `/student/onboarding`；新教师零班级时同样为 null，导航固定 `/console/select-class`。必须改 `navigationForUser` 产出这两条路径；`src/student/pages/Login.jsx` 与 `src/console/pages/Login.jsx` 不得再把空 `defaultPath` 当成登录失败。不得因没有 workspace 把合法账号误判为登录失败。

校长/年级主任的“异常入口”不另建数据驾驶舱：`GET /classes` 在 S/G 管理视图额外返回 `teacherCount`、`pendingStudentCount` 并支持 `teacherCount=0`/`hasPending=true` 过滤；账号页可列 active 但零 active 班的教师；凭据页显示 uses/maxUses/revoked/expired。三处现有页面入口足以完成兜底，不做趋势、告警中心或复杂统计。

输入限制固定为：schoolCode 2～64 位、loginName 3～32 位，二者只允许 ASCII 字母、数字、点、下划线、连字符且首位为字母/数字；displayName/name 1～100 字符；entryYear 2000～2100；classNumber 1～99；maxUses 1～10000；reason 1～500。密码继续复用 `isPasswordInputAllowed`，本阶段不另造密码强度规则。所有字符串先 trim，loginName/schoolCode 用 NOCASE 唯一语义；不允许实现者自行放宽或增加手机号/邮箱字段。

同校 loginName 冲突时，409 `details.suggestions` 固定返回最先可用的 3 个 `<base>-N`（N 从 2 递增）；如总长度超过 32，先从 base 末尾截短以保留完整后缀。建议值仍须走相同 NOCASE 查重，不从 displayName 自动生成账号。

### 12.4 错误码与失败行为

| HTTP/code | 使用场景 |
|---|---|
| 400 `VALIDATION_FAILED` | body 字段、role/org 注入、非法日期/人数/班号 |
| 401 `AUTH_REQUIRED` | 登录失败或缺 session；登录统一“学校、账号或密码错误” |
| 403 `PERMISSION_DENIED` | 已知当前身份无该动作；公开 token 不使用 403 |
| 404 `RESOURCE_NOT_FOUND` | 不存在/跨组织/无权知道存在性；公开 token 的不存在、撤销、到期、用尽、已消费统一文案 |
| 409 `RESOURCE_CONFLICT` | 校内 loginName 冲突（details 给建议后缀）、班级 disabled/graduated、学生已有 active 班/已有 pending |
| 409 `VERSION_CONFLICT` | 管理写或审批的 version 条件更新失败 |
| 500 `ACCOUNT_CODE_ALLOCATION_FAILED` | 同一事务连续 3 个新 userId 的短编号均命中校内唯一索引；整体回滚，不创建半个账号 |
| 500 `IDENTITY_INVARIANT_VIOLATION` | 教师/学生关系三元组残缺；响应不得声称成功，同时触发主控停止 |

所有列表默认稳定排序并带 id 作为末级排序键；所有时间为 ISO 8601 UTC，学年计算时才转换 `Asia/Shanghai`。不得吞错后返回空列表或“操作成功”。

---

## 十三、D-25、默认全闭与真实库迁移

### 13.1 读写模型必须一起翻转

只改 `isBookVisibleToAudience()` 会留下两个严重错误：旧 UI 的“全组织可见”会清空 grants，在新语义下变成无人可见；教师仍可通过 `book.publish` 改全局 `books.status`。因此同一交付必须完成：

1. `permissions.js` 从 teacher/grade_manager/school_admin 移除 `book.import/book.publish/book.archive`，新增 10.2 的 catalog/shelf 动作；platform_ops 保留全局能力。
2. `resolveBookAudience` 不再用一个 `unrestricted` 同时表达两个维度，改为 `{bypassClassGrants, allowUnpublished, classIds}`：platform 为 true/true；teacher 为 true/false；student 为 false/false。学校行政角色无书库入口。`listBooks` / `requireScopedBook` / `getBookAsset` 必须改看 `allowUnpublished`，禁止把 `unrestricted` 原样改名为 `bypassClassGrants`。详见 10.4。
3. `isBookVisibleToAudience` 固定为：管理类 `bypassClassGrants=true` 才直接 true（这只绕过 class grant，不表示可以看 draft）；否则 classIds 为空即 false，仅当存在匹配 `grantee_type='class'` grant 才 true。删除“无任何 grants 即 true”的 `BOOK_HAS_GRANTS_SQL` 分支。发布状态仍由各入口独立且一致地要求 published。
4. 教师书库只列 published；draft/archived 只对 platform 技术入口可见。新发布图书不自动投放，必须由教师显式加入班级书架。
5. 删除全量替换式 `setBookVisibility(scope,classIds)`。class-local PUT 只删除同一 book+class 在旧版本上的 class grant，再向当前版本幂等插入；DELETE 只删除同一 book+class 的 class grant。其他班和未知 grantee_type 行一律不动。

F-1 的“新增与移除对称校验”继续作为硬不变量。学生行政纠错和班级改届别同时用 `class-scope.js` 校验变更前、变更后两个 scope。书架 PUT/DELETE **不得**调用 `listAuthorizedClasses`；只许用当前 class workspace 上的 teacher assignment，目标 classId 必须等于其 `scope_id`（见 10.4）。任何只校验目标、不校验来源的批量/移动写都不通过 Gate 1。

### 13.2 050 回填语义

050 对每个组织执行“每本 published 书的当前版本 × 每个 active 且未毕业班”笛卡尔积，插入 `grantee_type='class'`。当前版本必须复用 `currentBookVersionSubquery` 的 `created_at DESC, id DESC` 口径；grant id 使用可识别的 `phase8-backfill-050:<versionId>:<classId>`，actor 标为 `phase8-migration-050`，时间取迁移执行时间。

当前基线预期插入 **49 行**，完成后 grants=49。不得给 draft/archived、disabled/graduated 班回填；不得创建 organization 类型 grant；不得删除任何既有 grant。执行时如现有 grants 不再为 0、published/版本/active 班计数不符或任一 published 书解析不出当前版本，停止而不是使用 `ON CONFLICT DO NOTHING` 掩盖差异。

### 13.3 必须生成的集合快照

迁移验证比较集合而非总数。快照键为 `organizationId + studentUserId`，值为排序后的 published bookId 数组，并同时记录该学生 active classIds。至少生成：

- `pre-visibility-sets.json`：旧代码/旧库的实际可见集合；
- `post-visibility-sets.json`：新代码/迁移副本的实际可见集合；
- `visibility-set-diff.json`：逐学生 added/removed；通过条件是两者全部空；
- 数据库摘要：schema_migrations 047～050、books/versions/classes/memberships/grants 计数、`PRAGMA quick_check`。

若发现 active student 没有 active class、disabled 班学生在旧语义仍能看到书、或任何学生集合无法用 class grant 表达，立即停止。这类差异不能靠给全组织加 grant 或让无班学生继续默认可见来兜底。

### 13.4 演练与正式切换顺序

**迁移演练（不碰业务库）：**

1. 在旧后端仍运行时，用只读连接 `VACUUM INTO` 生成业务库副本；记录源/副本路径、字节数和 SHA-256。
2. 对副本执行 `quick_check`，采集 pre 集合与 11.1 全部断言。
3. 用新代码、独立数据库副本和独立端口启动一次；应用必须在监听前通过既有 `runMigrations()` 原子执行 047～050，禁止 sqlite CLI 手工跑 SQL。
4. 重启该独立实例一次，确认迁移全部进入 `alreadyApplied`、checksum 不变，采集 post 集合与 HTTP 正反例。
5. pre/post 集合完全相同、grants=49、质量门通过后，Gate 2 才允许申请正式窗口。

**正式切换：**

1. 用户授权维护窗口；停止 5191 后端，确认端口已释放，前端不做写操作。
2. 再做一份带时间戳的 `VACUUM INTO` 备份；对备份 `quick_check`、记录 SHA-256，并重新采集 pre 摘要。不得复用演练时的旧副本。
3. 再次核对迁移最大号、schema_migrations checksum、11.1 基线和 grants=0；任一变化停止。
4. 用新代码启动 5191。迁移成功且应用完成初始化后才允许监听；后端无热重载，禁止以“文件已改”代替重启。
5. 只读核对 047～050、grants=49、quick_check、三元组不变量和集合 diff；再用真实 HTTP 观察：现有学生仍看到原 49 本、无 grant 新班学生看不到、教师只可改本人班书架、教师全局 publish 返回 403、D-23 两个负例返回 404。
6. Gate 3 复核通过后恢复使用；浏览器验收仍由用户本人执行，agent 不开浏览器。

### 13.5 回退办法

- 任一迁移文件失败时，该文件由 `runMigrations()` 自身事务回滚，但此前编号可能已提交；应用不得监听。保持停机，从正式窗口备份整体恢复旧数据库并部署旧代码。
- 正式切换后、**尚无任何新业务写入**时，允许：停后端 → 保存失败库供分析 → 用已校验备份整体替换 → 部署旧代码 → 重启并复核 pre 摘要。禁止只删 grants 或手改 `schema_migrations`。
- 一旦新系统产生注册、审批、班级、书架或密码重置写入，旧备份回退会丢数据，agent 无权执行；立即停机并交用户裁决采用前向修复还是接受数据回退。
- 若代码回退但保留 050 grants，旧语义会把书限制到回填班级，不等价于原默认全开；因此“只回代码”不是允许的回退方案。

---

## 十四、测试夹具重做与 D-21～D-23

### 14.1 可见性夹具的七条规矩

已确认的受影响集合是 `book-visibility-guard.test.js` 18 条、`book-visibility-revoke-guard.test.js` 7 条（合计 25 条守卫），以及 `book-visibility-http.test.js` 约 10 条相关 HTTP 用例。

1. 学生“可见”的前置必须显式插入该书当前版本 → 该生 active class 的 grant；createBook/no grants 不再暗含可见。
2. 学生“不可见”用例必须明确选择一种原因：无 grant、只 grant 他班、跨组织、draft；标题写明原因，不把多个负因叠在一起。
3. 验 draft 门时必须先给学生班级 grant，确保失败只归因于发布状态；验 grant 门时书必须 published。
4. teacher 绕过 class grants 的正例必须有 active teacher 三元组且书为 published；platform 的 draft 正例必须有 platform 角色。校长/年级主任不再作为书库管理正例。
5. 跨组织用例显式建两个组织、两个班和各自 grant；不存在 classId 与外组织 classId 继续同码同文案。
6. 禁止在全局 beforeEach、共享 bootstrap 或生产 seed 中“给所有书 grant 所有班”；这会掩盖默认全闭。fixture helper 只能由单个测试显式调用。
7. 禁止删除攻击断言、把 404 改成任意 4xx、放宽行数/审计断言或以 UI 隐藏代替后端拒绝。确实因产品裁决改变的旧断言，逐条在 execution ledger 记录原标题、旧行为、新行为和授权理由。

25 条独立守卫由**独立验证 agent**拥有。实现 agent 不得编辑这些文件；需要改变前置 fixture 或旧语义断言时，由主控列出具体测试标题后交验证 agent 单独提交。新增攻击用例进入新文件，不混进实施 agent 的功能测试。

建议只新增三个小 helper：`grantCurrentBookToClass`、`createVerifiedTeacherInClass`、`createPendingStudentRegistration`。helper 不得自动推断组织/班级，也不得吞唯一约束冲突。

### 14.2 必测分组

- **权限矩阵**：除明确废止的 `teacher.affiliation.approve` 外，每个 10.2 写动作至少一个允许、一个同组织越 scope 拒绝、一个跨组织 404；废止动作必须证明无 action、无路由、无 pending 数据模型。grade_manager 两项 school 例外有正例，同时证明不能跨届建班/改学生/动书架。
- **行政角色指派**：platform 只能在目标组织 platform workspace 指派校长；校长只能在本校稳定届别指派年级主任；重复指派/移除幂等，移除不连带删除业务关系。
- **教师归属**：零 workspace 新教师可自助加入；多班立即生效；重复加入/退出幂等；外校/disabled/graduated 拒绝；三表任一故意缺失时不自动修；两个并发加入最终只有一组三元组。
- **注册凭据**：teacher/student role 注入；原文不落库/不进日志；撤销、到期、人数上限；最后一个名额并发只有一个成功；失败不计 use；同 loginName 跨校可注册、同校冲突给后缀建议。
- **学生审批**：注册后零成员关系；批准一次性建三关系；拒绝后可新申请；重复 pending、并发审批、已有 active 班、教师审别班、grade_manager 跨届全部拒绝。
- **密码重置**：矩阵正反例、30 分钟/撤销/单次、旧 session 全失效、失败密码不消费、审计不含 token/password/hash。
- **班级生命周期**：9 月 1 日边界、小学 6/初高中 3、upcoming/graduated；停用保留成员/grants 且不可加入，恢复恢复原关系；grade_manager 不能把班改出本届。
- **D-25/书架**：教师全局 publish/unpublish 403；platform 正常且幂等审计不回归；两个教师同时 PUT 同班同书只有一行；一个教师撤本班不影响他班；旧 visibility 路由不可用；新班 0 grant 显示必要空状态。
- **行政纠错**：源+目标对称校验；教师调用 `PATCH /students/:userId/class` 必须 403；目标即当前班 200 且不掩盖残缺；残缺三元组 500 `IDENTITY_INVARIANT_VIOLATION` 并停止。

### 14.3 D-21 固定实现

社区读取投影在返回 `quote.text` 前调用同一 audience + published + grant 口径。线上学生列表走 `GET /community/posts` → `projectCommunityPosts`；`community.getPost` 必须同步过滤。查看者不可见时保留帖子、bookId/page（帖子上下文本身仍存在），返回 `quote.text=null` 与 `quote.availability='unavailable'`；前端固定显示“引用内容当前不可见”。旧帖不更新数据库。只改 `getPost`、不改 `projectCommunityPosts` 视为未修。

测试至少覆盖：有 grant 原文仍返；无 grant/他班/draft 均隐藏；旧帖在撤 grant 后自动隐藏、恢复 grant 后自动恢复；教师对 published 书可看；跨组织不泄露。若实现需要批量改写历史社区行，停止，因果模型错误。

### 14.4 D-22 固定实现

`GET /assignments` 对学生在投影前按同一可见性谓词过滤；实现点是 `projectAssignments`（该投影把 `book_version_id` 放进 `book.id`）。不可见书的 assignment **整项省略**，不返回 title、bookId、bookVersionId 或可推断占位。教师管理视图不受 class grants 过滤，但仍不得借此看到外组织数据。

测试至少覆盖：published+本班 grant 返回；无 grant、他班 grant、draft 全不返回；撤下后消失、重新投放后恢复；直接构造外组织 versionId 无差异响应。

### 14.5 D-23 固定实现与冻结边界

在 `catalog.acquireLease` 中，完成 input 校验后、进入任何 lease 写事务前，解析 version→book，并同时要求：同组织、`books.status='published'`、`isBookVisibleToAudience=true`。失败统一 404“书籍不存在或当前不可读取”，且 active lease/history/audit 均不得新增。`takeOverLease` 继续委托 acquire，因此自动受同一前置约束。

必须有四个隔离用例：published+本班 grant → 200；published+无 grant → 404；draft+本班 grant → 404；外组织 → 404。另测“已取得租约后撤下”：现有 lease 按既有 90 秒规则续租直至自然结束，不强制踢出；结束后新 acquire 404。

禁止修改 `reading_summary_sessions`、`reading_daily_book_summaries`、`POST /reading/session-summaries` schema/指纹、90 秒 TTL、`POST /reading/lease/:leaseId/renew`。现有那条断言不可见/draft lease 为 200 的守卫必须由独立验证 agent 改成 404；如果只改代码、重启后该真实 HTTP 行为仍是 200，立即停止，不得继续按原假设扩大改动。

### 14.6 质量门与真实观测

代码 agent 可跑定向测试；主控收口必须依次运行 server 全量、frontend 全量、build，再用临时数据库和独立端口做真实 HTTP。测试全绿但 5191 未重启不算生效；不得启动浏览器。所有报告分“实测”和“推断”，命令、退出码、用例数、端口、数据库路径与关键响应必须落 `execution-ledger.md`，不能只写“已通过”。

---

## 十五、交给 Grok 的固定执行顺序

Grok 是主控，只拆任务、验收证据、维护台账，不直接写业务代码。任何 agent 开工前先分配唯一文件所有权；同一文件同时只能有一个写者。

| 顺序 | 任务包 | 唯一写入范围 | 完成条件/依赖 |
|---|---|---|---|
| T8.0 | 基线核对 | 仅 `evidence/phase8/execution-ledger.md` | 分支/HEAD/dirty files/迁移/真库只读摘要与 11.1 一致；不一致即停 |
| T8.1 | Gate 1 权限设计复核 | 只读代码；只可建议改 09/decisions，由主控落文档 | 10～12 节无矛盾，用户批准；**未过不得写代码** |
| T8.2 | 047～050 schema、050 回填与迁移测试 | `server/db/migrations/047_*`～`050_*`、新 DB migration test、`bootstrap-internal-demo.js` | 全新库、046 升级副本、重复启动均通过 047～050；050 只做 §13.2 grants 等价回填，不夹带读取谓词或业务代码；演示数据含第二班、grade workspace/grade_manager |
| T8.3 | identity 领域与 identity router | `server/domains/identity/**`、对应新 identity tests | 班级、教师三元组、凭据、审批、重置与权限矩阵定向测试通过；session-only 只挂本 router；**删除** `POST /students` 路由；改 `navigationForUser`；不得改 integration-router |
| T8.4 | 阅读/社区领域 | `server/domains/reading/**`、`server/domains/community/**`、对应新增功能测试 | 只实现默认全闭读取语义与 D-21～D-25 领域逻辑；改 `getPost`；shelf 禁止再调 `book.publish`；**不创建或修改迁移文件**；不得改 permissions、HTTP router 或 `projections.js` |
| T8.5 | HTTP 集成与 API client | `server/http/integration-router.js`、`server/integration/projections.js`（仅 `projectCommunityPosts` / `projectAssignments`）、`src/api/auth.js`、`src/api/console.js`、`src/api/student.js`、必要 envelope tests | 等 T8.3/T8.4 接口稳定；一次接好路由，删除旧 visibility 调用；两处投影接到同一谓词；真实临时 HTTP 契约通过 |
| T8.6A | 身份/班级前端 | `src/console/pages/accounts/**`、登录与新增注册/onboarding 页面、相关新前端测试 | D-24 演示壳改真调用；教师免审选班、学生审批、凭据/重置最小 UI 完成 |
| T8.6B | 教师书架前端 | `src/console/pages/teaching/**`、`src/console/state/useBookVisibility.js`、`useBookWriteActions.js`、相关新前端测试 | 可与 6A 并行但不得碰其文件；删除全局发布/visibility UI，改本班投放/撤下与轻量多人提示 |
| T8.7 | 独立对抗与夹具重做 | 25 条 visibility 守卫、约 10 条 HTTP 用例、**只新增**其他攻击测试文件 | 实现 agent 不参与；按 14.1 逐条登记改变，无弱化断言/全局 grant |
| T8.8 | 全量质量门、独立端口与迁移演练 | 只写 execution ledger/evidence | server/frontend/build 绿；046 副本升 050、重启、集合 diff、真实 HTTP 通过；Gate 2 |
| T8.9 | 正式迁移 | 只写迁移证据与台账；数据库由应用迁移器写 | 用户授权窗口；严格按 13.4；Gate 3 前后证据通过 |
| T8.10 | 真人验收 | agent 不操作浏览器 | 用户按 `04` Phase 8 清单验收；问题回到对应任务包，不跨包顺手修 |

T8.3 与 T8.4 在 T8.1 通过且 T8.2 完成后才可并行；T8.5 必须等二者结束。T8.6A/6B 可并行。T8.7 的验证 agent 不得修改业务实现；发现缺陷只提交失败证据，由原实现 agent 修。T8.8 继续负责完整的 046→050 演练和逐学生集合 diff。

### 15.1 每个子 agent 提示词必须完整包含

不得只写“按 09 做”。主控复制以下骨架并填满：

```text
任务：<一个可验收目标>
先完整阅读：09 的指定章节 + phase8/decisions + 与任务直接相关源码/测试。
允许修改：<逐文件/目录，唯一所有权>
禁止修改：<其他 agent 文件、09、decisions、真实数据库>
必须复用：book_access_grants、共享可见性谓词、class-scope、F-1 对称校验、既有幂等/审计。
冻结红线：不改两张阅读摘要表、不改 session-summaries schema/指纹、不改 90s TTL/renew；不开浏览器；不手写业务库；不加 fallback/吞错/假成功。
输入事实：<schema、动作、状态、API、错误码、当前测试名>
必须产出：<代码/测试/证据清单>
验收命令：<定向命令与预期>
立即停止：<从第十六节复制与本任务有关的条目>
报告格式：改动文件；实测（命令/退出码/关键输出）；推断；未完成/风险；未触碰红线声明。
```

### 15.2 主控合并规则

- 每个任务开始/完成都更新 execution ledger；状态只用 pending/in_progress/verified/blocked，verified 必须有证据路径。
- 子 agent 报告不是事实源。主控至少复查 diff、关键不变量和一条真实行为；“测试绿”不能替代代码已被运行实例加载。
- 不允许实现 agent 顺手修改独立验证文件；不允许验证 agent顺手修业务代码；不允许两个 agent先后覆盖同一文件而不做完整 diff 复核。
- 计划外问题先归入停止条件。没有归属任务包和文件所有者，就不修改。
- 完成 T8.8 前不碰真实业务库；完成 T8.9 前不声称 Phase 8 技术交付；T8.10 只能由用户标真人通过。

---

## 十六、硬停止条件

命中任一条：立即停止当前 agent 和依赖任务；不再改代码/测试/数据库，不执行“试试看”的第二种实现；保存命令、响应、日志、SQL 只读结果与 diff，更新 execution ledger 并上报主控。主控只能按既有契约纠正；需要改变产品/冻结契约/真实数据时交用户裁决。

### 基线与 schema

1. 分支不是 `feat/product-close-loop`，交付时记录的基线 HEAD 不匹配，或工作区已有改动与本任务允许文件重叠。
2. 迁移目录最大号不是预期值、047～050 任一已被占用、已执行迁移 checksum 改变，或有人按文件数而不是最大编号取号。
3. 真库不再满足 11.1 任一断言：49 published/49 versions/0 grants/1 active 班/1 student/2 teacher/no grade_manager，或 id/status 不同。
4. 既有表、路由、权限动作或共享谓词与本文引用的实际代码不同，导致计划中的字段/事务/调用点不存在。
5. 出现 active 学生多班、class/grade 没有唯一 active workspace、教师/学生三关系残缺、跨组织关系或 `role_code='grade_group'` 实际数据。

### 权限与凭据

6. 注册请求能用 body 改 expectedRole、organizationId、scopeId，或 teacher/student 共用 token。
7. token/password/password hash 出现在数据库非 hash 字段、审计、普通日志、错误响应或第二次查询响应。
8. 人数上限最后一个名额的并发测试出现两个成功，失败注册增加 successful_use_count，或撤销/到期 token 仍能建号。
9. 新教师必须先让校长/年级主任审批才能加入，或实现者为零 workspace 教师创建 school 范围 teacher role 作为“方便入口”。
10. teacher/grade_manager/school_admin 任一可全局 publish/unpublish/import/archive；校长/年级主任仅凭行政角色可改班级书架；teacher 可改未加入班或外校班。
11. grade_manager 的两项 school 例外扩散到跨届班级、学生、书架或其他 account.manage 动作。

### 可见性、迁移与计时

12. 050 前后任一学生的可见 bookId 集合 added/removed 非空；只比较总数而没有逐学生集合也视为未通过。
13. 050 预计插入数不等于 published 当前版本 × active 未毕业班，grants 总数不符，或任一 published 书没有唯一当前版本。
14. 新班无 grants 仍看到书、旧 `scope=organization` 仍可清空 grants、一个班的撤下删除了其他班/未知类型 grant。
15. 应用在迁移失败或只完成部分编号时仍开始监听，`quick_check` 非 `ok`，或重启后迁移不是 alreadyApplied/checksum 一致。
16. D-23 看起来需要修改阅读摘要两表、session-summaries schema/指纹、90 秒 TTL 或 renew 路由；不论测试是否能绿都立即停。
17. 正式切换后已发生新业务写入又需要回退旧备份；agent 不得自行覆盖数据库。

### 因果、测试与运行

18. **一次修复没有改变它声称要改变的可观测行为，立即停。** 例如改 D-23 后重启真实实例，不可见/draft lease 仍为 200；这说明因果模型或加载实例错误，禁止沿原假设继续扩大改动。
19. 定向/单元测试全绿，但后端明确重启后真实 HTTP 仍是旧行为，或请求实际打到错误端口/数据库。
20. 只能通过删除用例、放宽断言、改 404 为任意 4xx、全局 grant 所有书/班、吞错、默认空列表、假成功、兼容 fallback 才能变绿。
21. 独立验证 agent 修改了业务实现，或实现 agent 未经逐条授权修改 25 条守卫；先恢复职责边界，不接受该轮“验证结果”。
22. 同一问题连续两轮按同一假设修改仍无行为变化，或日志/SQL 证据与报告中的“已修”矛盾。

---

## 十七、三个复核闸口

### Gate 1：权限、状态、schema、API 定稿（任何代码前）

- **卡什么：** 第十～十二节逐动作映射；V 与 grade_manager school 例外；三关系事务；迁移 047～050；所有路由/DTO/错误码；D-25 不再共用动作。
- **谁来卡：** Grok 主控整理；一个只读、不得实现的权限/数据一致性 reviewer 逐条反例审查；用户做最终批准。
- **通过条件：** reviewer 无未关闭高风险项；每个写路由能唯一映射到 action+scope+事务+审计+测试；没有“实现时再定”；用户明确批准。未过 Gate 1 不派代码 agent。2026-08-18：用户已批准 Gate 1（含 §10.4 与四项契约消歧）；下一任务 T8.2。Phase 6 未归档不阻塞代码阶段。

### Gate 2：夹具重做与迁移演练（真实库前）

- **卡什么：** 14.1 的 fixture 规则、权限/并发/跨组织攻击、全量质量门、046 副本升级 050、重启幂等、pre/post 集合 diff、真实临时 HTTP。
- **谁来卡：** 独立验证 agent 出报告；Grok 主控复跑关键命令并审查测试 diff。实现 agent 没有签字权。
- **通过条件：** 无断言弱化/全局 grant；server/frontend/build 全绿；副本 quick_check=ok、grants=49、集合 diff 全空；D-21～D-25 正反例符合本文；证据写入 phase8 目录。否则不得申请维护窗口。

### Gate 3：正式迁移前授权与迁移后放行

- **卡什么：** 前半卡停机、即时备份/hash/quick_check、最新基线、回退资格；后半卡 schema_migrations、计数、不变量、集合等价、重启、真实 HTTP。
- **谁来卡：** 用户授权维护窗口；迁移 agent 执行；独立 observer 只读核验；Grok 主控决定技术放行。浏览器最终验收仍由用户完成。
- **通过条件：** 前半全部满足才启动新后端；后半全部满足才恢复使用。任何新写入发生后回退资格改变，必须重新报告用户，不能沿用窗口开始时的授权。
