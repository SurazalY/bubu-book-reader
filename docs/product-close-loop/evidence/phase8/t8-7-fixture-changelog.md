# T8.7 夹具 / 旧断言变更登记

> 时间：2026-08-18  
> 任务：T8.7 独立对抗与夹具重做  
> 依据：09 §14.1 第 7 条（产品裁决改变的旧断言：原标题、旧行为、新行为、授权理由）  
> 未改 `server/**`、`src/**`、09、ledger、T8.2～T8.6 守卫。

共用夹具（三份旧文件均适用，不逐条重复）：

| 项 | 旧行为 | 新行为 | 授权理由 |
|---|---|---|---|
| 登录 | `{ username, password }` | `{ schoolCode, loginName, password }` | P8-11 |
| 组织 / 班级 | 无 schoolCode；`gradeId` 任意字符串 | 组织带 `schoolCode`；班带 `stage/entryYear/classNumber`，`gradeId=<stage>:<entryYear>` | P8-11、P8-12 |
| 学生可见前置 | createBook / 无 grants 暗含全开 | 必须显式 `grantCurrentBookToClass`（当前版本 → 该生 active class）；helper 不推断、不吞 UNIQUE | §14.1.1、§14.1.6、P8-08 |
| 写入口 | `PUT /books/:bookId/visibility` | 正例改 `PUT/DELETE /classes/:classId/shelf/:bookId`；旧路由专打 404 | P8-13、P8-20 |
| beforeEach | （旧文件无全局 grant；保持） | 仍禁止全局 grant 所有书/班 | §14.1.6 |

---

## A. `book-visibility-guard.test.js`（18 条）

| 原标题 | 旧行为 | 新行为 | 授权理由 |
|---|---|---|---|
| 【攻击面 1.1/1.2】学生伪造 X-Workspace-Id 不能改变班级可见范围，且换头失败时不泄露书是否存在 | 无 grants 书对学生可见（全开）；只 grant 他班不可见；换头 403 同码同文案 | 无 grant 书不可见（原因：无 grant）；另造「显式 grant A」作可见正例；只 grant 他班仍不可见；换头 403 不变 | §14.1.1、§14.1.2、P8-08 |
| 【攻击面 1.3】孤儿学生（无任何 class_memberships）：无 grants 书可见，有 grants 书一律不可见 | 无 grants=可见 | 无 grant 不可见；grant 本班仍不可见（原因：无 class_memberships）。标题已改 | §14.1.1、§14.1.2、P8-08 |
| 【攻击面 1.4·现状记录】班级被停用后，该班 grants 与该班学生的实际可见性 | 校长列书 / GET visibility 200；organization 可清空 grants；GET /classes 不列停用班 | 学生不可见（原因：班级已停用）；校长不再列书；旧 visibility 404 且不得清 grant；校长仍能看到停用班（status=disabled）以便恢复。标题已改 | §14.1.2、§14.1.4、P8-07、P8-13、§14.2 班级生命周期 |
| 【攻击面 1.4·现状记录】学生本身就在停用班里时的待遇 | 无 grants=可见；`setBookVisibility` 写停用班 | 无 grant / 只 grant 他班都不可见；领域 `setBookVisibility` 期望废止。标题已改 | §14.1.1、§14.1.2、P8-08、P8-13 |
| 【攻击面 1.5/1.6】别名 role_code 均被识别为管理角色；被停用的教师授权 fail closed 降级为学生 | 校长/年级主任/grade_group 都是书库正例（列 draft、取草稿资产）；教师可看 draft | 完整教师三元组 + published 可绕过 grant，不得看 draft；platform 才是 draft 正例；校长/GM 200 但空列表；历史 `grade_group` 无动作表 → 403；停权账号只留学生身份（去掉残缺 `class_teacher` 行，避免 `GET /classes` teacherCount 500）。标题已改 | §14.1.4、P8-07、P8-19、P8-12 |
| 【攻击面 2.7/2.8/2.9】收窄后新增版本：未授权班仍读不到旧版本页/旧资产，被授权班不被误伤 | 先 visibility 收窄再断言版本 | SQL 显式 grant B 后同一断言；未授权班仍 404 | §14.1.1、P8-08 |
| 【攻击面 3.10/3.11】跨组织在全部入口互不可见；外组织 classId 与不存在 classId 同码同文案 | 单组织对照；旧 visibility 写外校 | 显式两组织两班各自 grant；书架外组织 vs 不存在同 404；教师 `GET /classes` 403。标题已改 | §14.1.5、P8-13、P8-17 |
| 【攻击面 4.12/4.13/4.14】授权范围逐层校验：class 不能跨班、grade 不能跨年级、school/platform 可覆盖本组织 | 年级/校长/平台 PUT visibility 200 覆盖本组织 | 书架只认当前 class workspace；教师跨班 403；GM 本届/跨届、校长、平台均 403；旧 organization 404。标题已改 | P8-07、P8-13、P8-20、§14.2 D-25 |
| 【攻击面 4.15】学生打管理接口时，存在的书与不存在的书必须同码同文案（不泄露存在性） | 学生 GET/PUT visibility 对不可见书 404 | 旧 visibility GET/PUT 全 404 同文案；书架写 403 同文案；publish 仍 403 | P8-13、§14.1.7 |
| 【攻击面 5.16】学生的 ?status 参数被静默锁死为 published；资产放宽只对管理角色生效 | 教师/校长/年级主任可取 draft 资产 | 学生锁 published 且需 grant；教师不得取 draft 资产；platform 正例。标题已改 | §14.1.3、§14.1.4、P8-19 |
| 【攻击面 5.17/5.18】幂等：缺键 400、同键同体重放、同键异体 409，grants 与审计行数都不变 | 旧 visibility 同键异体 409；审计 `book.visibility.updated` | 书架缺键 400、同键重放不增行/审计 `book.shelf.granted`；旧 visibility 同键异体 404 且不得改 grant。标题已改 | P8-13、§14.1.7 |
| 【攻击面 5.19】organization → classes → organization 反复切换后状态干净、无残留 grants | 全开 ↔ 班级 循环，终态全开 | 本班 PUT/DELETE 循环，终态默认全闭；organization 404。标题已改 | P8-08、P8-13 |
| 【攻击面 6.21】classIds 边界：重复值、空串、非字符串、超长数组、organization + classIds | 非法 classIds → 400 / 校验失败但仍可能写 | 旧 visibility 参数一律 404，零 grants；本班书架 PUT 仍 200。标题已改 | P8-13、§14.1.7 |
| 【攻击面 6.20/6.22】grants 指向已删除班级；draft + grants 组合下教师与学生的表现 | 悬空 grant 不锁死，organization 可清；教师看 draft | 悬空 grant 对学生不可见（原因：学生不在该班）；draft 门先 grant 仍不可见；教师 publish 403，platform publish 后 B 可见。标题已改 | §14.1.2、§14.1.3、P8-07、P8-09、P8-19 |
| 【现状记录·待裁决】阅读安排与阅读租约两个相邻入口未过班级可见范围 | 无 grant / draft lease **200**；安排仍投影 | D-22 无 grant 安排整项省略；D-23 无 grant / draft+grant / 外组织 lease **404**「书籍不存在或当前不可读取」；published+本班 grant 200；撤下不踢已有 lease。标题已改 | P8-08、P8-09、§14.4、§14.5（D-23 强制改 404） |
| 【F-1 已收口】class 范围教师既不能用 scope=organization 绕过班级授权范围，也不能撤销校长设置的别班授权 | organization / 撤他班 **403**（旧路由还在） | organization **404**；DELETE 他班 **403**；教师 unpublish **403**。标题已改 | P8-13、P8-07、§14.2 D-25 |
| GET /classes 权限矩阵：多种学生人格一律 403；platform_ops 缺 class.read 的实际表现 | 学生 403；教师未列入 | 学生 + **本班教师** 一律 403；platform 仍 403（缺 `class.directory.read`） | P8-17 |
| 【F-4 已收口】非 class 类型的 grants 行不再让「恢复全组织可见」失效，但 GET visibility 仍谎报 organization | organization 清空非 class 行后学生可见 | 非 class grant 不得当可见；organization 404 不清行；补 class grant 后可见。标题已改 | P8-08、P8-13、§14.1.1 |

---

## B. `book-visibility-revoke-guard.test.js`（7 条）

| 原标题 | 旧行为 | 新行为 | 授权理由 |
|---|---|---|---|
| F-1 需求 1/2/8：校长限定到 C 班后，A 班班主任的 organization 与 classes:[A 班] 都被 403，C 班 grants 行仍在 | 校长 visibility 写 C；教师 organization 403 | SQL grant C；旧 organization 404；DELETE 他班 403；C 行仍在。标题已改 | P8-13、P8-20 |
| F-1 需求 3/4：书无 grants 时班主任可限定到本班，且他本人随后可以撤销回全组织可见 | PUT visibility 本班后 organization 恢复全开 | PUT 本班 200；organization 404 不清；DELETE 本班后默认全闭。标题已改 | P8-08、P8-13 |
| F-1 需求 5：悬空 grants（班级已停用 / 已删除）不锁死可见范围，校长与班主任都能一键清除 | 悬空不锁死；organization 清除后全开 | 悬空 grant 对学生不可见（原因：学生不在该班）；organization 404 不清。标题已改 | P8-08、P8-13、§14.1.2 |
| F-1 需求 6：校长（school 范围）授权集合覆盖本组织全部班级，任意组合都能操作 | 校长任意 visibility 组合 200 | 校长旧 visibility 任意组合 404；校长书架 403。标题已改 | P8-07、P8-13 |
| F-1 收紧的边界：年级范围操作者仍可授权本年级班，但不能连带移除别年级的既有授权 | 年级主任本年级 visibility 200 | GM 本届/跨届书架都 403，不得改既有他班 grant。标题已改 | P8-07、P8-20、§14.2 权限矩阵 |
| F-4 需求 7：非 class 类型的 grants 行也会被 scope=organization 清除，书恢复对学生可见 | organization 清除后学生可见 | 非 class 不可见；organization 404 不得清除。标题已改 | P8-08、P8-13 |
| F-4 边界：scope=classes 只改班级维度，不牵连非 class 类型的 grants 行 | visibility classes 与 user grant 共存 | organization 404；shelf PUT 可与 user grant 共存且学生可见（显式 class grant） | §14.1.1、P8-13 |

---

## C. `book-visibility-http.test.js`（10 条）

| 原标题 | 旧行为 | 新行为 | 授权理由 |
|---|---|---|---|
| grants 到别班后，本班学生四个入口全部表现为书不存在（404，不是 403） | 只测他班 grant；无 grants 对照暗含全开 | 只 grant 他班 + **无 grant** 两本都 404；书架也不出现。标题已改 | §14.1.1、§14.1.2、P8-08 |
| grants 到本班后，本班学生四个入口全部可读；别班学生仍然 404 | PUT visibility 本班；organization 再全开 | 本班 shelf PUT 后 A 可见 B 不可见；organization 404；DELETE 后两边都不可见 | P8-08、P8-13 |
| 教师与管理角色不受 grants 与发布状态过滤；学生仍然只看已发布且被授权的书 | 教师/校长可列 draft | 教师绕过 grant 看 published，不列 draft；platform 列 draft；学生只看本班 grant。标题已改 | §14.1.4、P8-07、P8-19 |
| 教师可取任意发布状态书籍的资产，学生取草稿书资产仍然 404 | 教师 unpublish 200 后仍可取资产 | 教师 unpublish 403；platform 下架后教师/学生资产都 404。标题已改 | P8-07、P8-19、§14.2 D-25 |
| PUT 可见范围要求幂等键，同键重放不产生第二行 grants | 旧 visibility 缺键 400 | 书架缺键 400、同键重放不增行；旧 visibility 缺键 **404**。标题已改 | P8-13 |
| 班级校验：外校班级与超出授权范围的班级都被拒，学生无权写入 | 外校/他班 visibility 拒；年级可写本年级 | 外校书架 404、他班 403；GM/校长 403；学生旧 visibility 404 同文案。标题已改 | P8-07、P8-13、P8-20、§14.1.5 |
| grants 写入的 book_version_id 与过滤读取解析的当前版本同源，旧版本不能绕过 | visibility 写当前版本 | shelf PUT 写当前版本；B 不能用旧 versionId 绕过 | P8-13（写口变，断言口径不变） |
| GET /books/:bookId/visibility 返回当前范围与课堂锁书、阅读安排引用 | GET visibility 200 + 引用列表 | GET visibility 404；安排本身不级联删。标题已改 | P8-13 |
| GET /classes 按操作者授权范围列班级，空班也能列出，学生无权访问 | 教师 200 列本班 | 教师 `GET /classes` **403**，本班详情 200；S/G 仍列班 | P8-17 |
| PUT 可见范围拒绝无效 scope 与空班级列表，跨组织书籍按不存在处理 | 无效 scope / 空 classIds → 400 | 一律 404 同文案（旧路由已删） | P8-13、§14.1.7 |

---

## D. 未做的弱化（对照 §14.1.7）

- 没有删除攻击断言。
- 没有把资源 404 改成「任意 4xx」。
- 没有放宽 grants / 审计行数。
- 没有 beforeEach 给所有书 grant 所有班。
- `grade_group` 对 `GET /books` 的 403 是「无动作表」，不是把书不存在的 404 放宽。
