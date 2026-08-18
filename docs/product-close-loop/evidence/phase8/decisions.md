# Phase 8 产品与技术边界裁决记录

> 记录时间：2026-08-18
> 本文件只追加，不回写或删除历史裁决。Phase 8 内与 `02_决策与契约边界.md`、`03_实施任务清单.md`、`04_端到端验收清单.md`、Phase 4 裁决或只读分析冲突时，以本文件和 `09_Phase8班级管理系统设计与交接.md` 为准。

## P8-01：教师信任集中在注册入口，归属免审

教师必须使用 `expected_role=teacher` 的专用注册凭据完成身份入口校验。注册成功后视为本校可信教师，可自行选择本校一个或多个班级并立即获得相应班级范围，不需要已有教师、年级主任或校长审批。

原“首位教师自动通过、后续教师由已有教师审批”方案废止。控制手段改为跨组织硬隔离、未加入班级不可操作、永久审计、管理员事后移除或停用。不得在实施时重新增加教师归属审批队列。

## P8-02：教师凭据可由技术团队、校长、年级主任签发

三类签发者产生的教师凭据产品语义相同，均绑定学校而不绑定届别。教师凭据默认 7 天有效、最多成功注册 1 人；批量入职只能由签发者显式提高人数上限。token 原文只展示一次，库内只存哈希；撤销标记 `revoked` 而不删除；每次成功注册必须写使用记录。

教师与学生凭据不得共用。角色和组织只从服务端 token 记录推导，请求体不得自选或覆盖。

## P8-03：校长与年级主任不是同一权限

- `school_admin` 管全校班级、学生与教师账号的低频行政纠错。
- `grade_manager` 的班级和学生管理范围是所负责的入学届别，并随该届学生移动。
- 用户明确授予 `grade_manager` 两项 school 范围例外：签发/撤销本校教师注册凭据、重置本校教师密码。这两项不得扩散为跨届班级管理权限。
- 两个行政角色都不因身份自动获得班级书架权限，也不管理全局书库。

## P8-04：班级与学年模型

班级由校长或对应届别年级主任预制，存学段（小学/初中/高中）、入学年份和班级序号。学年切换日固定为中国时区 9 月 1 日；当前年级由学段、入学年份和日期计算，不做年度批量升班。年级主任绑定入学届别，不绑定会逐年变化的“当前几年级”文本。

不做学生自助转班。正式入班后的选错班由校长或授权届别年级主任纠正并审计。

## P8-05：学生注册与入班审批

学生使用学生专用凭据注册，从凭据允许的预制班级中选班。申请状态为 `pending / approved / rejected`；拒绝后可重新选班申请，批准后才建立正式归属。一名学生同时最多一个 active 班级。低年级允许家长协助建号，不新增家长角色。

姓名只用于展示，校内或班内重名均允许。登录使用 `schoolCode + loginName + password`，`loginName` 校内唯一；另显示不可变账号短编号尾号用于审批辨认。

## P8-06：轻量密码重置

本期使用短期、一次性、可撤销、可审计的重置码，不要求学生绑定手机或邮箱，不建设申诉中心。

- 教师可为自己任教班级的学生签发。
- 年级主任可为所管届别学生及本校教师签发。
- 校长可为全校学生和教师签发。
- 技术团队处理校长账号等校方无法自助处理的情况。

教师密码属于整个账号；重置成功必须使旧登录会话失效。

## P8-07：全局书库与班级书架彻底分权

全局书库导入、发布、下架只由技术团队通过受控后端能力处理，本期不建设校级书库操作。直接手改 SQLite 业务数据不是允许的运维路径。

教师只能把已发布图书投放到自己任教的班级，或从这些班级撤下。校长和年级主任没有全局书库权限，也不因行政角色自动获得班级书架权限。

现有 `book.publish` 同时保护全局 `books.status` 变更和班级可见范围写入，已经不符合本裁决；按 D-25 纳入 Phase 8，必须拆成全局生命周期动作与班级书架动作。既有全局发布/下架领域逻辑、幂等和审计复用，权限动作与学校端入口不复用。

## P8-08：默认全闭与撤下时的阅读行为

学生可见书集合改为本班显式 grants；无 grants 即不可见。切换时必须先回填真实库，保持切换前后每个现有学生的可见书集合完全一致。

教师撤下一本书后，阻止新的打开和新租约；已经打开且持有有效租约的阅读器不强制踢出。不得修改租约 90 秒 TTL、续租路由、阅读摘要表、摘要请求 schema 或指纹算法。

## P8-09：D-21、D-22、D-23 本阶段收口

- D-21：读取社区帖子时检查查看者可见范围；不可见则保留帖子但隐藏 `quote.text`，显示“引用内容当前不可见”。旧帖不改写。
- D-22：不可见书对应的阅读安排不得向学生投影书名或 `bookVersionId`。
- D-23：新租约获取前必须同时通过发布状态和班级可见范围；修复范围只限获取前置条件与配套测试，不得触碰冻结计时契约。

## P8-10：本期刻意不做

不做学生自助转班、家长角色、书架模板/跨班复制、复杂筛选、复杂多教师协作锁、校级数据驾驶舱、学校端全局书库管理。多教师只做：加入已有教师的班前一次轻量确认（不审批）、常驻人数提示、操作者与时间审计、幂等班级级增删以及旧状态刷新提示；最后一名教师也允许自助退出，由管理视图的 `teacherCount=0` 承接事后纠错。默认全闭的空状态保留一行必要说明。

## P8-11：校内登录名增量迁移，不重建 users 核心表

新增 `organizations.school_code`、`users.login_name` 与不可变 `account_code`，登录改为 schoolCode+loginName。既有 `users.username` 保留为内部兼容键，不再作为用户输入、登录条件或公开 DTO；新增账号直接把新 userId 写入 username，避免任何跨校命名碰撞。这样兑现校内唯一与跨校重名，又避免重建被大量外键引用的 users 表。

## P8-12：届别复用 grade scope，教师授权继续三关系原子物化

`classes.grade_id` 改为 `<stage>:<entryYear>` 稳定届别键，继续供现有 grade workspace、`scopeAllows` 与 `class-scope.js` 使用；不新增第二套 cohort 授权系统。

教师归属保留 `class_memberships + workspace_memberships + role_assignments` 三关系，role assignment 仍是授权真相。加入/退出/强制指派/移除同步事务更新三者；残缺关系报不变量错误，不自动修复。

## P8-13：废止全量 visibility 写接口，改 class-local 书架操作

Phase 8 删除 `GET/PUT /books/:bookId/visibility` 及 `scope=organization|classes` 写模型。教师使用 `/classes/:classId/shelf/:bookId` 的幂等 PUT/DELETE，只能改变一个本人班级，不提交或覆盖全书 classIds 集合。F-1 对称 scope 校验继续用于新增与删除两侧。

## P8-14：迁移固定为 047～050，真实切换以逐学生集合等价为门

基线不变时：047 登录/班级基础，048 注册凭据，049 审批/重置，050 grants 回填。当前真库预期 050 插入 49 行。正式切换前必须在 `VACUUM INTO` 副本演练；通过条件是每个既有学生的可见 bookId 集合前后完全相同，而不是总数相同。迁移后发生新业务写入则旧备份回退必须重新交用户裁决。

## P8-15：行政角色继续复用 workspace/role assignment

技术团队通过目标组织的 platform workspace 指派/移除 `school_admin`；校长在本校稳定届别 workspace 指派/移除 `grade_manager`。两者都原子维护 workspace membership 与 role assignment，不新增管理员表。创建一届首个班时只确保 grade workspace 存在，不自动产生年级主任。

## P8-16：V 必须自写查询，禁止复用现网 authorize 链

Gate 1 复核确认：现网 `service.authorize` / `listActiveRoleAssignments` 都要求 active `workspaceId`，`integration-router.js` 对其余路由全局 `requireWorkspace`。V 的正向证据固定为 registration use（`expected_role='teacher'`）或同组织当前/历史 teacher `role_assignments`（含 disabled）。session-only 路由只挂 identity router。不得为 V 创建 school 范围 teacher role。

## P8-17：班级目录与 leave_self 的 scope 评价

`GET /teacher/class-directory` 是教师 V 目录；`GET /classes` 只给校长 S 与年级主任 G，教师调用 403；已入班教师看本班走 `GET /classes/:classId` + C。`leave_self` 的 Self 指对该 classId 持有完整 active 教师三元组，不要求 `X-Workspace-Id`。

## P8-17R：leave_self 幂等覆盖（2026-08-18）

覆盖 P8-17 中“leave_self 必须持有完整 active 教师三元组”的半句，不删原文。路由为 session-only，不要求 `X-Workspace-Id`；调用者必须通过 V 教师基础身份。class 不存在或跨组织 → 404。完整 active 三元组 → 同事务停用三者并 200。完整 disabled 三元组或三者皆无 → 200 no-op。部分存在、状态混合或不一致 → 500 `IDENTITY_INVARIANT_VIOLATION` 并停止。不得因关系已 disabled/absent 而在幂等检查前返回 403。班级目录分流仍以 P8-17 为准。

## P8-18：退役 HTTP POST /students

Phase 4 已有的 `POST /students` 会用 `account.manage` 直接物化已入班学生，绕过 pending 审批。Phase 8 删除该写路由或改为 404。bootstrap/seed 仍可写入已批准演示学生。这不是产品改判，是落实 P8-05。

## P8-18R：POST /students 唯一处置（2026-08-18）

覆盖 P8-18 的“删除或改为 404”双选项，不删原文。T8.3 删除现有 HTTP `POST /students` 路由；不保留兼容 handler、弃用 handler 或假 404 分支；删除后由标准不存在路由返回 404。运行时创建学生的唯一入口是 student 注册凭据 → pending → 审批。bootstrap/seed 仍可按文档直接准备已批准演示关系，但不是 HTTP 后门。

## P8-19：D-25 必须拆开 grant 旁路与 draft 可见

`bypassClassGrants` 只绕过班级 grant。`listBooks` / `requireScopedBook` / `getBookAsset` 的发布状态门看 `allowUnpublished`。禁止把旧 `unrestricted` 改名后继续让教师列或读取 draft。P4-5 已被 P8-07 覆盖。

## P8-20：书架 F-1 不得使用 school 并集

`book.shelf.*` 只用当前 class workspace 上的 teacher assignment。禁止对 shelf 调用 `listAuthorizedClasses`。`class-scope.js` 仍用于班级生命周期、审批与行政纠错。

## P8-21：零 workspace 导航由 navigationForUser 产出

登录 HTTP 零 workspace 已是 200。pending 学生固定 `/student/onboarding`，新教师固定 `/console/select-class`。必须改 `navigationForUser`；两个 Login.jsx 不得把空 `defaultPath` 当成登录失败。

## P8-22：D-21/D-22 的线上投影在 projections.js

学生社区列表走 `projectCommunityPosts`；学生阅读安排走 `projectAssignments`。T8.4 改谓词与 `getPost`；T8.5 接线这两处投影。只改 `getPost` 不算修掉 D-21。

## P8-23：校长指派 path 与 body 的 organizationId 必须一致

`PUT/DELETE /organizations/:organizationId/school-admins/:userId` 以 path 为唯一目标；body 若带 organizationId 必须相等。本期不新增 catalog import/archive HTTP。

## P8-24：Phase 8 先于 Phase 6；T8.2 拥有 047～050

既定顺序：Phase 8 先实施并完成，Phase 6 再基于最终系统做阅读计时联动验收。Phase 6 尚未归档不是 T8.2 的阻塞条件。Phase 8 实施期间，Phase 6 不得占用共享 5191、不得写真实业务库、不得修改阅读计时相关文件。

T8.2 唯一拥有 `047_*`～`050_*` 及相应迁移测试；须在全新库、046 副本和重复启动上验证 047～050。050 只实现 §13.2 的 grants 等价回填，不夹带读取谓词或业务代码。T8.4 只实现默认全闭读取语义与 D-21～D-25 领域逻辑，不创建或修改迁移文件。T8.8 继续负责完整的 046→050 演练和集合 diff。
