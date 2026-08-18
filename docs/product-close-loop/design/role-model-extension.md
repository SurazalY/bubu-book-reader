> 状态：**设计分析 · 未裁决 · 不属于 Phase 4 落地范围**
> 日期：2026-08-17
> 触发：产品负责人提出"校长权限应扩散到年级主任/学科组组长"
> 本文件不含任何已实施的改动，是供决策用的分析。

> **Phase 8 使用限制（2026-08-18）：** 本文是历史只读分析，不是现行权限设计。年级主任、教师信任、注册凭据、密码重置和书库分权的已裁决口径见 `../09_Phase8班级管理系统设计与交接.md` 与 `../evidence/phase8/decisions.md`；执行者不得从本文“开放问题”自行选择方向。学科组仍不在 Phase 8 范围。

# 角色模型扩展：年级主任 / 学科组组长

本文回答：现有 RBAC + scope 模型能不能表达「校长权限扩散到年级主任 / 学科组组长」；若不能，增量演进的候选方向与代价是什么。工作量主体应是接入与补缺，不新造第二套权限系统。

**一句话结论：** 年级主任（`grade_manager`）已经在模型里，缺的是动作补齐、演示账号、以及若干接口把资源 scope 写死成 `school`；学科组组长是正交维度，现有五选一 `scope_type` 装不下，书目也没有学科字段。Phase 4（T4.1–T4.7）不要做这件事。

---

## 0. 给产品负责人的结论先行

1. **「年级主任」不是新角色。** 后端角色键 `grade_manager` 就是它；别名 `grade_admin` / `grade_group` 也指向它。要让年级主任「更像校长」，首先是动作表补差，不是加一张角色表。
2. **「学科组组长」是新维度。** 现有 scope 只有 `own / class / grade / school / platform`。语文组横跨多个年级、只覆盖一科，无法用这五个值表达。
3. **「只管本学科的书」现在没有落地依据。** `book_catalog_metadata` 有 `grade`，没有学科列；49 本编目 JSON 也没有学科。学生端书架上的「学科」是前端演示库按体裁映射出来的，不是后端真值。
4. **一人多职时，当前实现不是「全账号并集」。** 一次请求只看当前 `X-Workspace-Id` 对应工作空间上的授权。班主任兼语文组长，需要两个工作空间，切换后权限才变。
5. **本设计不属于 Phase 4。** Phase 4 只做 T4.1–T4.7（教师发布管理与班级可见范围）。年级主任若只需「本年级班级的可见范围」，Phase 4 的 P4-10 口径已经覆盖，不必等本文裁决。

---

## 1. 现状精确测绘

以下片段均来自源码与迁移文件。未打开业务库，未跑测试。

### 1.1 `roleActions` 五个角色的完整动作表

文件：`server/domains/identity/permissions.js` 第 1–125 行。动作名不带 scope。

```1:125:server/domains/identity/permissions.js
const roleActions = {
  student: [
    'identity.read_self',
    'workspace.read',
    'book.read',
    'assignment.read',
    'classroom.read',
    'integration.launch',
    'integration.return',
    'reading.read_self',
    'eyecare.read_self',
    'ai.conversation.create',
    'ai.conversation.read_self',
    'ai.conversation.rename_self',
    'ai.conversation.privacy_self',
    'ai.conversation.context_self',
    'ai.conversation.delete_self',
    'ai.conversation.restore_self',
    'community.submit',
    'privacy.request',
    'privacy.requests.read_self',
    'privacy.request.resolve_self',
    'privacy.history.read_self',
  ],
  teacher: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.manage',
    'book.read',
    'assignment.read',
    'assignment.manage',
    'classroom.read',
    'classroom.control',
    'reading.read_scope',
    'conversation.read',
    'eyecare.read_scoped',
    'eyecare.release_false_positive',
    'ai.conversation.read_scoped',
    'ai.conversation.search_scoped',
    'privacy.request',
    'privacy.requests.read_scoped',
    'privacy.conversation.view',
    'privacy.history.read_scoped',
    'community.moderate',
    'community.review.class',
    'report.generate',
    'report.review',
    'report.send',
  ],
  grade_manager: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.manage',
    'book.read',
    'assignment.read',
    'book.import',
    'assignment.manage',
    'classroom.read',
    'reading.read_scope',
    'conversation.read',
    'eyecare.read_scoped',
    'eyecare.release_false_positive',
    'ai.conversation.read_scoped',
    'ai.conversation.search_scoped',
    'privacy.request',
    'privacy.requests.read_scoped',
    'privacy.conversation.view',
    'privacy.history.read_scoped',
    'community.moderate',
    'community.review.class',
    'report.generate',
    'report.review',
    'report.send',
  ],
  school_admin: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.manage',
    'book.read',
    'assignment.read',
    'book.import',
    'book.publish',
    'book.archive',
    'assignment.manage',
    'classroom.read',
    'classroom.control',
    'reading.read_scope',
    'conversation.read',
    'eyecare.read_scoped',
    'eyecare.release_false_positive',
    'ai.conversation.read_scoped',
    'ai.conversation.search_scoped',
    'privacy.request',
    'privacy.requests.read_scoped',
    'privacy.conversation.view',
    'privacy.history.read_scoped',
    'safety.review',
    'safety.accept',
    'safety.transfer',
    'safety.close',
    'community.moderate',
    'community.review.school',
    'report.generate',
    'report.review',
    'report.send',
  ],
  platform_ops: [
    'workspace.read',
    'account.read',
    'account.manage',
    'book.read',
    'book.import',
    'book.publish',
    'book.archive',
    'policy.manage',
    'model.manage',
    'audit.read_platform',
  ],
}
```

同文件还有别名表（第 127–132 行）。`roleActions` 的键只有五个；下列字符串若出现在 `role_assignments.role_code`，会先被映射再查动作：

```127:132:server/domains/identity/permissions.js
const roleAliases = {
  class_teacher: 'teacher',
  grade_group: 'grade_manager',
  grade_admin: 'grade_manager',
  platform_operator: 'platform_ops',
}
```

含义：

| 角色键 | 产品含义（按命名与契约文档） | 动作数量 |
|---|---|---|
| `student` | 学生 | 21 |
| `teacher` | 教师（别名 `class_teacher`） | 25 |
| `grade_manager` | 年级主任（别名 `grade_admin`、`grade_group`） | 25 |
| `school_admin` | 校长 / 校级管理 | 32 |
| `platform_ops` | 平台运维（别名 `platform_operator`） | 10 |

`docs/integration/一体化领域与接口契约.md` 第 86 行写：工作空间代码沿用前端壳 `class-teacher` / `grade-group` / `grade-admin` / `school-admin` / `platform-ops`，是同一账号的授权视图。后端 `workspaces.code` 的 CHECK 与这五个值对齐（见 §1.3），但 **角色键与工作空间 code 不是同一列**。

### 1.2 `scopeAllows` 全文与判定顺序

```153:184:server/domains/identity/permissions.js
function scopeAllows(grant, resourceScope, actorUserId, authContext) {
  if (
    !resourceScope ||
    !authContext ||
    grant.workspaceId !== authContext.workspaceId ||
    grant.organizationId !== authContext.organizationId
  ) {
    return false
  }
  if (grant.scopeType === 'platform') {
    return true
  }
  if (resourceScope.type === 'platform' || resourceScope.scopeType === 'platform') {
    return false
  }
  if (resourceScope.organizationId !== grant.organizationId) {
    return false
  }
  if (grant.scopeType === 'own') {
    return resourceScope.ownerId === actorUserId && grant.scopeId === actorUserId
  }
  if (grant.scopeType === 'school') {
    return resourceScope.organizationId === grant.scopeId || (resourceScope.type === 'school' && resourceScope.id === grant.scopeId)
  }
  if (grant.scopeType === 'grade') {
    return collectScopeIds(resourceScope, 'gradeIds', 'gradeId').has(grant.scopeId)
  }
  if (grant.scopeType === 'class') {
    return collectScopeIds(resourceScope, 'classIds', 'classId').has(grant.scopeId)
  }
  return false
}
```

`collectScopeIds`（第 139–151 行）从 `resourceScope` 收集复数数组、单数字段，以及 `type`/`scopeType` 与 `id`/`scopeId` 配对。

**判定顺序与语义：**

1. **上下文门闩。** `resourceScope` 或 `authContext` 缺失 → 拒绝。授权行的 `workspaceId` / `organizationId` 必须与当前请求上下文完全相等 → 否则拒绝。
2. **`grant.scopeType === 'platform'`。** 过了门闩就放行。不再看资源落在哪个班、哪个年级。
3. **资源本身是 platform。** 非 platform 授权不能碰 platform 资源。
4. **组织不一致。** `resourceScope.organizationId !== grant.organizationId` → 拒绝。
5. **`own`。** 资源主人是当前行动者，且授权的 `scopeId` 也是该行动者。
6. **`school`。** 资源的 `organizationId` 等于授权 `scopeId`，或资源声明自己是 `type='school'` 且 `id` 等于授权 `scopeId`。**不检查年级、班级。** 只要调用方把 `organizationId` 填进 `resourceScope`（绝大多数接口都会），校级授权就能覆盖该组织下的资源。
7. **`grade`。** 资源上的 `gradeId` / `gradeIds`（或 `type/scopeType === 'gradeId'` 的写法）必须包含授权 `scopeId`。资源上没带年级标识 → 拒绝。
8. **`class`。** 同上，看 `classId` / `classIds`。
9. **其他 `scopeType`。** 直接 `return false`。没有 `subject` 分支。

**对「包含链」的校正：** 产品口头模型常说 `own ⊂ class ⊂ grade ⊂ school ⊂ platform`。`scopeAllows` **并没有**实现一条自动向下包含的格子。校级能「看见」班级，是因为调用方几乎总是带上 `organizationId`，校级分支只比组织 ID；年级授权则严格要求资源带年级 ID。调用方若把资源写成「纯 school 形」（只有 `type:'school'` + `organizationId`，没有 `gradeId`），年级授权会失败。这不是文档推断，见 §2.2 的 `POST /classes`。

### 1.3 `role_assignments` 与 `workspaces` 建表语句

#### 当前有效的 `role_assignments`（005 重建后）

更早版本在 `server/db/migrations/000_identity.sql` 第 45–57 行（无 `organization_id`，UNIQUE 也更窄）。005 把它整表重建。当前约束以 005 为准：

```71:86:server/db/migrations/005_organization_roles_and_idempotency_fencing.sql
CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role_code TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('own', 'class', 'grade', 'school', 'platform')),
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (organization_id, user_id, workspace_id, role_code, scope_type, scope_id),
  FOREIGN KEY (user_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)
);
```

写入触发器还要求：**授权行的 `scope_type` / `scope_id` 必须与所挂工作空间完全一致**（同文件第 121–137 行）：

```121:137:server/db/migrations/005_organization_roles_and_idempotency_fencing.sql
CREATE TRIGGER role_assignments_require_same_organization_insert
BEFORE INSERT ON role_assignments
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM users AS actors
  JOIN organizations ON organizations.id = NEW.organization_id
  JOIN workspaces
    ON workspaces.id = NEW.workspace_id
    AND workspaces.organization_id = NEW.organization_id
  WHERE actors.id = NEW.user_id
    AND actors.organization_id = NEW.organization_id
    AND workspaces.scope_type = NEW.scope_type
    AND workspaces.scope_id = NEW.scope_id
)
BEGIN
  SELECT RAISE(ABORT, 'role assignment requires actor, workspace, and scope in the same organization');
END;
```

#### 当前有效的 `workspaces`（000 建表，之后没有重建）

```21:32:server/db/migrations/000_identity.sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  code TEXT NOT NULL CHECK (code IN ('class-teacher', 'grade-group', 'grade-admin', 'school-admin', 'platform-ops')),
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('own', 'class', 'grade', 'school', 'platform')),
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);
```

`organization_id` 可空（给 platform 工作空间留口）。005 起有复合唯一索引 `uq_workspaces_id_organization_id`。`code` 只有五个字面量，**没有** `subject-group` 一类值。

#### 两张表 `scope_type` 的关系

它们不是两套独立枚举，而是被三道门拴在一起：

| 门闩 | 位置 | 效果 |
|---|---|---|
| 列 CHECK | 两表各自的 `scope_type` | 都只能是那五个值 |
| INSERT/UPDATE 触发器 | 005 第 121–157 行 | 授权行的 scope 必须等于所挂 workspace 的 scope |
| 读授权 JOIN | `listActiveRoleAssignments` 第 322–327 行 | 再比一次 `workspaces.scope_type = assignments.scope_type` 且 `scope_id` 相等 |

因此：**不能**在一个 `scope_type='class'` 的工作空间上挂一条 `scope_type='grade'` 的授权。年级主任必须有一个年级工作空间；学科组若要走同一套模型，就必须有一个学科工作空间——而现在既没有这种 `scope_type`，也没有这种 `code`。

#### `grant.workspaceId !== authContext.workspaceId` 意味着什么

`authContext` 来自当前请求的工作空间：

```170:181:server/domains/identity/service.js
  function authorize({ actor, workspace, action, resourceScope }) {
    const assignments = listActiveRoleAssignments(database, actor.id, workspace.id, workspace.organizationId)
    return evaluatePermission({
      assignments,
      action,
      resourceScope,
      actorUserId: actor.id,
      authContext: {
        workspaceId: workspace.id,
        organizationId: workspace.organizationId,
      },
    })
  }
```

工作空间本身来自请求头 `X-Workspace-Id`（`server/middleware/request-context.js` 第 56–63 行）。`listActiveRoleAssignments` 的 WHERE 已经限定 `assignments.workspace_id = ?`（当前工作空间）。

**一个用户在 workspace A 里操作时，他在 workspace B 上的授权不生效。** 即便查询漏出 B 的行，`scopeAllows` 第一道门闩也会因 `workspaceId` 不一致拒绝。跨工作空间不是并集，是「切换视图」。

### 1.4 `book_catalog_metadata` 完整列清单

建表：`server/db/migrations/014_book_catalog_metadata.sql`。045 用「建新表 → 回填 → 改名」加了 `grade`，并放宽 `author` / `source_page` 等为可空。之后没有再改这张表。

045 重建后的列（第 53–64 行）：

| 列 | 类型 / 约束 | 能否表达学科 |
|---|---|---|
| `book_id` | TEXT PK，引用 `books(id)` | 否 |
| `author` | TEXT，可空 | 否 |
| `illustrator` | TEXT，可空 | 否 |
| `source_page` | TEXT，可空 | 否 |
| `usage_label` | TEXT，可空 | 否 |
| `rights_json` | TEXT，可空 | 否 |
| `grade` | INTEGER，`NULL` 或 1–6 | 年级，不是学科 |
| `created_at` | TEXT NOT NULL | 否 |
| `updated_at` | TEXT NOT NULL | 否 |
| `version` | INTEGER NOT NULL DEFAULT 1 | 否 |

`books` 表（`010_reading_catalog.sql` 第 1–10 行）列是：`id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version`。也没有学科。

`listBooks` 投影只 select 了 `metadata.author / illustrator / source_page / usage_label / rights_json / grade`（`server/domains/reading/catalog.js` 第 143–146 行），没有学科列可投影。

`book-parser/catalog-default-49.json` 每本书有 `bookId, title, grade, versionId, pageCount, sourcePdf...`，**没有** `subject`。

**结论：后端书目没有可用于「学科」的字段。**

### 1.5 全仓检索：学科 / subject / discipline / 教研组 / 学科组

检索在仓库根目录进行（只读）。业务代码里的命中如下。

#### 「学科组」

产品代码 **零命中**。唯一出现处是 Phase 4 开工裁决记录 `docs/product-close-loop/evidence/phase4/decisions.md`（P4-9，记录的就是本诉求，不是已有功能）。

#### 「教研组」

全部在**控制台前端壳的虚构演示数据**里，不是后端身份模型：

| 文件 | 含义 |
|---|---|
| `src/console/data/workspaces.js` 49–68 行 | 工作空间 id=`grade-group`，名称「六年级语文教研组」，`classScope: 'grade'`，allow 比年级管理更窄（无建班、无导入、无安全事件） |
| `src/console/pages/safety/SafetyList.jsx` 87 行 | 文案：教研组没有安全事件权限 |
| `src/console/pages/accounts/ClassDetail.jsx` 37、83 行 | 注释：教研组可看班级详情，但没有护眼/家长发送 |
| `src/console/data/fixtures/*.js` | 按 `grade-group` 切演示数据范围 |
| `src/console/components/shell/SecondaryRail.jsx` 31 行 | 长名称排版注释 |

`workspaces.js` 文件头写明：「全部虚构演示数据」。控制台壳的「教研组」**没有**接到 `role_assignments`。

#### 「学科」

| 位置 | 是不是后端学科概念 |
|---|---|
| `src/student/data/library.js` 第 13–20、191、303–310 行 | 否。前端演示书库用 `SUBJECT_BY_GENRE` 把体裁映射成「语文 / 科学 / 道德与法治」，供书架筛选 |
| `src/student/pages/Shelf.jsx`、`ListDetail.jsx`、`BookDetail.jsx` | 否。消费上面的演示字段；`BookDetail.jsx` 第 29 行在真实书目缺字段时回退为「整本书阅读」 |
| `src/console/data/fixtures/classes.js` | 否。虚构班级带 `subject: '语文'` |
| `src/console/pages/accounts/ClassList.jsx` 第 308–344 行 | 否。创建班级弹窗有「学科」输入，但文案写「演示环境不会真正写入数据」 |
| `server/db/migrations/` | **无** `subject` 列（桥接令牌里的 `subject_id` 是「学生主体」，见下） |

#### `subject` / `discipline`（易混项）

- `server/domains/bridge/schoolbag.js`、`012_teaching_bridge.sql`、`013_reading_security_scopes.sql` 里的 `subject` / `subject_id` / `subject_student_id` 是 **JWT 学生主体**，不是课程学科。
- `server/domains/` 下 **`discipline` 零命中**。
- `tailwind.config.js` 有 `subject: { math, chinese, ... }` 色板，只是样式 token。

**校正主控背景里「不存在学科组或学科的任何概念」：** 后端身份与书目层确实没有。前端壳已经用「教研组」和「学科筛选」做过产品演示，而且演示里的教研组是 **「六年级 × 语文」**（年级 ∩ 学科），不是全校语文组。后端把 `grade-group` 与 `grade-admin` 都折叠成 `grade_manager`，演示里的两种人格在运行时是同一个角色。

### 1.6 一个用户能否同时持有多个角色

**能。** UNIQUE 约束是：

```
UNIQUE (organization_id, user_id, workspace_id, role_code, scope_type, scope_id)
```

禁止的是「同一组织、同一用户、同一工作空间、同一角色、同一 scope」重复一行。换 `role_code` 或换 `workspace_id` 都可以再插一行。

但触发器要求授权 scope = 工作空间 scope，所以：

- 同一工作空间里可以挂多个 **不同** `role_code`，它们的 `scope_type/scope_id` 必须相同（都等于该工作空间）。
- **不能**在班级工作空间上再挂一条年级授权。班主任兼年级主任，必须再有一个年级工作空间 + 一行年级授权 + 一条 `workspace_memberships`。

`listActiveRoleAssignments` 按当前工作空间取多行：

```305:345:server/domains/identity/repository.js
export function listActiveRoleAssignments(database, userId, workspaceId, organizationId) {
  return database
    .prepare(`
      SELECT
        assignments.organization_id,
        assignments.workspace_id,
        assignments.role_code,
        assignments.scope_type,
        assignments.scope_id
      FROM role_assignments AS assignments
      ...
      WHERE assignments.user_id = ?
        AND assignments.workspace_id = ?
        AND assignments.organization_id = ?
        AND assignments.status = 'active'
    `)
    ...
}
```

`evaluatePermission` 对多行取 **或（`.some`）**：任一授权「有该动作 ∧ scope 允许」即通过。

```192:197:server/domains/identity/permissions.js
  return ({ assignments, action, resourceScope, actorUserId, authContext }) =>
    assignments.some(
      (assignment) =>
        hasAction(policy, assignment.roleCode, action) &&
        scopeAllows(assignment, resourceScope, actorUserId, authContext),
    )
```

**同一工作空间内 = 并集。跨工作空间 = 不并，看当前头。** 这是读源码得到的行为，不是产品已裁决的规则。

### 1.7 与本诉求绑在一起的既有缺口（测绘，不是方案）

这些不是新发现的「要重写权限」，而是接入时会踩到的洞。

**（1）运行时不能把已有教师指派到已有班级。**

`class_memberships` 允许 `membership_role IN ('student', 'teacher', 'assistant')`（`000_identity.sql` 第 74 行）。演示脚本绑教师时会同时写三张表（`server/db/bootstrap-internal-demo.js` 第 225–247 行：`workspace_memberships` + `class_memberships` + `role_assignments`）。

产品运行时写入 `class_memberships` 的领域函数只有 `createStudentAccount`，且角色写死为 `'student'`：

```188:208:server/domains/identity/repository.js
  database
    .prepare(`
      INSERT INTO class_memberships (
        id, class_id, user_id, membership_role, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
    `)
    .run(record.classMembershipId, record.classId, record.userId, record.now, record.now)
  ...
      INSERT INTO role_assignments (
        ...
      ) VALUES (?, ?, ?, ?, 'student', 'class', ?, 'active', ?, ?, 1)
```

对应 HTTP 是 `POST /students`。种子导入（`server/db/seed.js`）也能写这三张表，但那是引导/测试入口，不是产品接口。Phase 4 裁决已把此事记为 D-20，不在本期修。

**（2）演示数据里没有年级主任。**

`bootstrap-internal-demo.js` 第 179–256 行只准备了：学生、两位 `teacher`（class 范围）、`school_admin`、`platform_ops`。没有 `grade` 工作空间，没有 `grade_manager` 账号。`workspaces.code` 虽允许 `grade-admin` / `grade-group`，引导脚本没用。

**（3）建班接口把资源 scope 写成 school。**

```157:165:server/domains/identity/index.js
  const requireSchoolClassManage = createRequirePermissionMiddleware(
    service,
    'class.manage',
    (req) => ({
      type: 'school',
      id: req.workspace.organizationId,
      organizationId: req.workspace.organizationId,
    }),
  )
```

`grade_manager` 动作表里有 `class.manage`，但这条中间件不带 `gradeId`。按 §1.2 第 7 步，年级授权会失败。年级主任即便补齐校长动作，**现状也建不了班**。

**（4）书目授权看的是工作空间，不是书的年级。**

`catalog.js` 的 `authorize('book.publish', { bookId })` 会与工作空间 scope 合并（`server/integration/context.js` 第 46–58 行）。年级工作空间会带上 `gradeId = workspace.scopeId`，因此年级主任一旦有 `book.publish`，在自己的年级工作空间里可以通过 scope 检查——**不管这本书的 `metadata.grade` 是不是这个年级**。现有判定不能表达「只管本年级的书」。

**（5）`book_access_grants` 已建表、业务 JS 零引用。**

```76:87:server/db/migrations/010_reading_catalog.sql
CREATE TABLE IF NOT EXISTS book_access_grants (
  id TEXT PRIMARY KEY,
  book_version_id TEXT NOT NULL,
  grantee_type TEXT NOT NULL,
  grantee_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(book_version_id, grantee_type, grantee_id)
);
```

`grantee_type` 没有 CHECK。Phase 4 计划用 `grantee_type='class'` 做**学生可见范围**，与「谁有权管理这门学科」不是同一件事。方向 B 可以借鉴「显式授权表」思路，但不应把角色范围塞进这张即将承担班级可见性的表。

---

## 2. 诉求拆解

产品原话拆成可判定条目。

### 2.1 年级主任应享有校长的哪些权限？动作表差集是什么？

**现有模型能表达「年级主任」这个角色，不能自动等于「校长的全部权限」。** 差集要产品点头，不能从代码反推业务意愿。

`school_admin` 有、`grade_manager` 没有：

| 动作 | 粗分业务 |
|---|---|
| `book.publish` | 发布 |
| `book.archive` | 下架/归档 |
| `classroom.control` | 课堂控制（教师反而有，年级主任没有） |
| `safety.review` | 安全事件查看 |
| `safety.accept` | 安全事件接手 |
| `safety.transfer` | 安全事件转交 |
| `safety.close` | 安全事件关闭 |
| `community.review.school` | 校级社区审核 |

`grade_manager` 有、`school_admin` 没有：

| 动作 | 说明 |
|---|---|
| `community.review.class` | 班级社区审核。校长用的是 `community.review.school`，不是更大的同一个动作 |

相对教师：年级主任多 `book.import`，少 `classroom.control`。

Phase 4 开工裁决 P4-1（`docs/product-close-loop/evidence/phase4/decisions.md`）打算给 `teacher` 与 `grade_manager` 都加上 `book.publish`。那是 Phase 4 的书目发布补缺，**不是**「校长权限全面扩散」，也尚未在本文写作时当成已落地事实。

前端壳里「年级管理」(`grade-admin`) 的 allow 接近校长但无角色管理、无平台运营；「教研组」(`grade-group`) 更窄。后端把两者都映射成 `grade_manager`，所以**壳上的两种人格目前无法在运行时分开**。

### 2.2 年级主任在 grade 范围内做这些事，`scopeAllows` 能不能支持？

分三层看，不能只看动作表。

| 想做的事 | 动作层 | scope 层 | 调用方有没有把年级填进 resourceScope |
|---|---|---|---|
| 在年级工作空间里读/管账号、班级（资源本身带 `gradeId`/`classId`） | `account.*` / `class.*` 已有 | `grade` 分支能比 `gradeId` | `getClassScope` / `findUserScope` 会带 `gradeId` / `gradeIds`（`repository.js` 第 135–143、271–276 行）→ **能** |
| 发布/导入书 | 现状无 `book.publish`；有 `book.import` | 年级工作空间会带 `gradeId` | 不看 `metadata.grade` → **动作补上就能过门闩，但管的是「人在年级空间里」，不是「书属于这个年级」** |
| `POST /classes` 建班 | 有 `class.manage` | 中间件写成纯 school 形，无 `gradeId` | **不能**，卡在 `scopeAllows` 第 177–178 行（`collectScopeIds(...).has(grant.scopeId)` 为空） |
| 安全事件四动作 | 动作表没有 | 尚未轮到 scope | **不能**，卡在 `hasAction`（`permissions.js` 第 134–137 行） |
| 校级社区审核 | 有的是 `community.review.class` | 另有动作名 | **不能**用校长那条动作；要产品决定年级主任审班还是审校 |

所以：**scope 机制能支持「人在年级工作空间里、资源带着年级 ID」这类判定；不支持「资源被调用方写成 school 形」；也不支持「按书的年级属性裁剪」。** 卡点分别在第 177–178 行（缺 `gradeId`）和第 184 行（未知 scope 直接拒绝，与本题无关）。

### 2.3 学科组组长用现有 `scope_type` 五选一能不能表达？

**不能。**

原因不是「少一个角色键」——角色键可以在 `roleActions` 里加一行，不必改 CHECK。不能的是 **范围**：

- 五选一是组织层级：自己 / 班 / 年级 / 校 / 平台。
- 学科组是横切：同一学科跨多个年级，且不覆盖其他学科。
- `scope_id` 只能指向一个层级实体。填年级 ID 就变成年级主任；填学校 ID 就变成校长（再靠动作表限制），无法表示「全校语文」。
- 第 184 行对未列出的 `scopeType` 一律 false。即便有人把 `scope_type='subject'` 写进库，CHECK 会挡在写入；若绕过 CHECK，判定也会拒绝。
- 触发器还要求存在一个 `workspaces.scope_type` 相同的工作空间。`workspaces` 的 CHECK 同样没有 `subject`。

前端壳的「六年级语文教研组」用 `classScope: 'grade'` 近似，本质仍是年级范围，只是名称里写了「语文」。它表达不了「一到六年级语文组」。

### 2.4 没有书目学科字段，「只管本学科的书」有没有落地依据？

**没有。**

- 库列没有学科（§1.4）。
- 编目 JSON 没有学科。
- 学生端「学科」是体裁映射，且真实书目路径会回退成「整本书阅读」/「未分类」。
- 班级「学科」只存在于控制台夹具和不会落库的演示表单。

在补上受控词表 + 书目列 + 回填之前，任何「本学科」过滤都只能是展示层猜测，不能当授权依据。

---

## 3. 候选方案（增量演进，不重写权限系统）

共同约束：继续走 `roleActions` + `role_assignments` + `scopeAllows` + 当前工作空间。新能力用加动作、加一列、加一张显式授权表、或加一个 scope 值来接，不另起一套鉴权服务。

### 方向 A：增加 `scope_type='subject'`，并给书目加学科字段

**做法概述**

把学科收进现有两段式的第二段。新增学科实体（或组织内学科代码表）；`workspaces` / `role_assignments` 的 CHECK 增加 `'subject'`；新建 `code`（例如 `subject-group`）；`scopeAllows` 在第 184 行之前增加 `subject` 分支，用 `collectScopeIds(resourceScope, 'subjectIds', 'subjectId')`；`book_catalog_metadata` 增加学科列；调用书目接口时把书的学科填进 `resourceScope`。

学科组组长可以是新角色键 `subject_lead`（只加 `roleActions` 一行），也可以复用 `grade_manager` 但挂在 subject 工作空间上——后者会让「年级主任」和「学科组长」在动作表上无法区分，不建议。

**要改的表（迁移动作）**

SQLite 不能就地放宽 CHECK，005 已经示范过「改名旧表 → 建新表 → 回填 → 触发器重建」：

1. 新建 `subjects`（建议：`id, organization_id, code, name, status, ...`），`code` 用受控词（语文 / 数学 / …）。
2. 重建 `workspaces`：`scope_type` CHECK 加入 `'subject'`；`code` CHECK 加入新字面量。
3. 重建 `role_assignments`：同样扩大 CHECK；**原有五行 scope 的行原样迁回**。
4. 重建两条 organization/scope 对齐触发器（005 原文逻辑 + 允许 subject 工作空间）。
5. `book_catalog_metadata` 增加 `subject_code TEXT`（或 `subject_id` FK），可空，随后回填。
6. 可选：`classes` 或教师任教表增加学科，否则「管本学科的人」仍然没有依据。

**要改的代码（接入，不是新系统）**

- `server/domains/identity/permissions.js`：`scopeAllows` 新分支；可选新角色键。
- `server/domains/identity/service.js` 与 `server/integration/context.js`：`workspaceResourceScope` 为 subject 工作空间填 `subjectId`。
- `server/domains/reading/catalog.js`：发布/列表/归档把书的学科并入 `resourceScope`（否则会出现与今天年级主任管书一样的漏洞：人在学科空间里就能管全库）。
- `server/db/seed.js` / `bootstrap-internal-demo.js`：演示学科工作空间与账号。
- 控制台：把壳上的 `grade-group` 从夹具接到真实 workspace；学生书架学科筛选改读编目列。

**对 `scopeAllows` 的回归风险**

- **若只在 `return false` 前增加 `subject` 分支，且不改 `own/class/grade/school/platform` 的条件，这五个值的行为应保持不变。**
- 风险在重建表与触发器时写错回填，或有人把 `subject` 误做成「介于 grade 与 school 之间的一环」。学科不是包含链上的一层，校级授权不应自动变成「只配一个学科」，学科授权也不应靠 `organizationId` 放行全校所有书。
- `listActiveRoleAssignments` 的 JOIN 条件不必改语义（仍然要求 assignment.scope = workspace.scope）。
- Phase 4 将启用的 `book_access_grants`（班级可见性）与 subject scope **正交**，不要混在一次判定里改口径。

**迁移与回填**

- 现有 `role_assignments` 行全部是五个旧值，回填是恒等映射，不改 `role_code`。
- 现有工作空间同理。演示库没有年级工作空间，更没有学科工作空间，身份数据回填压力小。
- 书目 49 本的 `subject` 是空的，必须人工或规则回填，否则学科组长会对零本书有权，或因调用方漏带 `subjectId` 而对全库有权——两种都不可用。
- 前端演示映射（体裁→学科）**不能**直接当回填真值，只能当建议。

**优点 / 缺点 / 适用条件**

- 优点：学科组长与年级主任、校长在同一套「角色 + scope + 工作空间」里；一人多职沿用「多个工作空间」；与契约文档「工作空间是授权视图」一致。
- 缺点：SQLite 重建两张核心身份表，触碰面大；必须同时做书目学科与调用方填 scope，否则授权是空的或过宽；「六年级语文组」要变成 grade∩subject 时，单一 `scope_type` 仍不够，还得叠加（见方向 D）或接受「全校语文」/「某年级全部学科」两种简化。
- 适用：产品明确学科组是**全校单科**（或每个学科一个工作空间），并且接受先做编目学科回填。

### 方向 B：不动 scope 维度，用「角色 + 独立授权范围表」

**做法概述**

`scope_type` 五选一不动。`scopeAllows` 不动。新增一张正交授权表（思路类似已存在但未启用的 `book_access_grants`：显式行，而不是把新维度塞进包含链）。

示例形状（名称可再定，这里只说明增量）：

```text
subject_leadership_grants (
  id,
  organization_id,
  user_id,
  subject_code,          -- 或 subject_id
  status,                -- active / disabled
  created_at, updated_at, version,
  UNIQUE (organization_id, user_id, subject_code)
)
```

角色仍用现有键或新增 `subject_lead`。该角色的 `role_assignments` 挂在 **school** 工作空间上（校级容器），动作表只给「学科组长该有的动作」。真正的「哪一科」由这张表裁剪。书目接口在 `evaluatePermission` 通过之后（或在领域层）再查：这本书的学科是否落在该用户的 grants 里。

**不要**复用 `book_access_grants`。那张表的语义是「书版本 → 班级学生可见」，Phase 4 马上要启用；`grantee_type` 虽无 CHECK，混用会让「谁能管」和「学生能看见」无法归因。

**要改的表**

1. 新建 `subjects` 或先用受控 code 而不建表（短期能跑，长期难校验）。
2. 新建 `subject_leadership_grants`（上表）。
3. `book_catalog_metadata` 加学科列并回填——**这条省不掉**，否则「只管本学科的书」仍然没有依据。
4. **不改** `role_assignments` / `workspaces` 的 CHECK。

**要改的代码**

- `permissions.js`：只加角色键与动作，**不改** `scopeAllows` 五个分支。
- `catalog.js`（以及将来若要「管本学科的人」的账号接口）：在现有 `authorize` 之后加学科裁剪。这是接入，不是第二套 RBAC。
- 引导脚本：给学科组长一个 school 工作空间成员身份 + 一行 school 范围的 `subject_lead` + grants 行。
- 控制台：学科组长的导航用动作表控制，不要再靠夹具 id `grade-group`。

**对 `scopeAllows` 的回归风险**

- **五个旧 scope 的判定原文可以不动，回归面最小。**
- 风险改在领域层：若有人把学科裁剪写成「失败则回退为全校」，会比校长还宽；若漏接一个书目入口（list / get / publish / asset / AI），会出现「列表看不见、直链能改」或相反。Phase 4 对 `book_access_grants` 已经要求四入口口径一致，学科裁剪必须抄同一纪律。
- 学年主任、教师的现有授权路径不经过新表，行为应与现在相同。

**迁移与回填**

- 现有 `role_assignments` **一行都不用改**。
- 新表初始为空：没有学科组长，直到产品指定谁、哪一科。
- 书目学科仍要回填，与方向 A 相同。
- 若有人已经用 `grade-group` 当角色码写入（统计模块把 `grade_group` 列为合法码，见 `server/domains/reading/statistics.js` 第 8–15 行），不要自动理解成学科组长。那些行在现网语义里仍是年级主任别名。

**优点 / 缺点 / 适用条件**

- 优点：身份核心表与 `scopeAllows` 不动；学科可以和年级叠加（同一人可以是三年级主任 + 语文组长，一行 grade 授权 + 一行 subject grant）；与即将落地的 grants 风格一致。
- 缺点：授权来源变成「角色表 + 范围表」，调用方要记得两道检查；学科组长挂在 school 工作空间上，导航/文案要避免显示成校长；「只看本学科的人」还要教师任教学科，那是第三张关系。
- 适用：产品要的是正交维度，且希望 Phase 4 之后改权限判定的回归面尽量小。

### 方向 C：不引入新角色，用现有 `grade_manager` + 更细动作近似

**做法概述**

不承认「学科组」为系统维度。产品上把「学科组组长」解释成「某年级的教研协作者」，对应前端壳已经存在的 `grade-group` 人格：范围仍是年级，名称可以带学科，但不做学科过滤。

可做的增量（都不必改 schema）：

1. 按产品点名的差集，给 `grade_manager` 加动作（例如只要 `book.publish` / `book.archive`，不要 `safety.*`）。
2. **取消别名折叠**（仍是 `roleActions` 增量）：让 `grade_admin` 与 `grade_group` 成为两个键，教研组少动作、年级主任多动作。现有 `grade_group → grade_manager` 的别名要改成查自己的表，并清点 `statistics.js` 那种按原始 `role_code` 判断的集合。
3. 引导脚本补一个年级工作空间 + 年级主任账号，否则连演示都走不到。
4. 若年级主任需要建本年级的班：改 `requireSchoolClassManage`，按当前工作空间填 `gradeId`，不要写死 school 形。这是调用方补缺，不是新模型。

**要改的表**

无。零迁移。

**要改的代码**

- `permissions.js`（动作 / 可选取消别名）。
- 可选：`identity/index.js` 建班中间件的 resourceScope。
- `bootstrap-internal-demo.js`（演示账号）。
- 控制台仍可用夹具「六年级语文教研组」，但运行时范围是整个六年级、所有学科。

**对 `scopeAllows` 的回归风险**

- **不改函数则五个 scope 行为不变。**
- 取消别名时：库里若已有 `role_code='grade_group'` 的行，今天靠别名吃到 `grade_manager` 的动作；取消后若忘记给 `grade_group` 配动作表，这些账号会突然无权。演示库目前看不到这种行，但仍要在迁移说明里写清「先查 `role_code` 再改别名」。
- 给 `grade_manager` 加上 `safety.*` 或 `community.review.school` 会扩大现网该角色的能力；演示库没有该角色，扩大暂时看不见，一旦有人导入年级主任就会生效。

**迁移与回填**

- 无 schema 回填。
- 业务上要接受：语文组长在系统里等于「该年级的年级向管理者（或更弱的教研协作）」，能看见数学书、数学班。

**优点 / 缺点 / 适用条件**

- 优点：最快；与 Phase 4 P4-1 / P4-10 同向；符合「不新造系统、先接入」。
- 缺点：**覆盖不了真正的学科组**（跨年级、单学科）。「只管本学科的书」仍然没有依据。前端「六年级语文教研组」会继续名不副实。
- 适用：产品确认短期要的是年级主任，学科组只是口头类比；或学科组实际按年级教研组运作（每个年级一个语文组，而不是全校一个语文组）。

**够不够用：**

| 诉求 | 方向 C 够不够 |
|---|---|
| 年级主任发布书、按本年级选可见班级 | 够（动作补齐 + P4-10），但管书不按书的年级裁 |
| 年级主任建本年级的班 | 够，但要改建班中间件，单改动作表不够 |
| 年级主任处理安全事件 | 够，加四个 `safety.*` 即可；前端壳今天没给教研组这个入口，给年级管理给了 |
| 全校语文组长只碰语文书 | **不够** |
| 一人既是班主任又是语文组长，按并集/交集精细控制 | 只剩「两个工作空间切换」，做不到学科裁剪 |

### 方向 D（补充）：scope 仍走包含链，授权行加可选学科属性

**做法概述**

不新增 `scope_type`。给 `role_assignments` 增加可空 `subject_code`（或旁表一行一科，避免 SQLite 改 CHECK）。`scopeAllows` 五个分支不改；通过之后若 `subject_code` 非空，再要求 `resourceScope.subjectId` 匹配。年级主任：`scope_type='grade'` 且 `subject_code` 为空。六年级语文组长：`scope_type='grade'` 且 `subject_code='chinese'`。全校语文组长：`scope_type='school'` 且 `subject_code='chinese'`。

这能表达前端壳那种「六年级 × 语文」，也能表达全校单科，而不把学科塞进包含链。

**要改的表**

1. `role_assignments` 加可空列（SQLite `ADD COLUMN` 即可，**不必**重建 CHECK）。UNIQUE 若要「同一人同一空间同一角色不同学科」，需重建唯一约束（这会碰到 SQLite 重建表，但 CHECK 五个值可保持不动）。
2. 书目加学科列并回填（与 A/B 相同）。
3. 触发器今天比的是 workspace.scope = assignment.scope；学科是第三属性，**不要**要求 workspace 也有 subject，否则又要改 `workspaces` CHECK。学科只活在授权行上。

**回归风险**

- `scopeAllows` 五个分支可保持原文。新增的是后置谓词。漏写后置谓词 = 学科列被忽略，授权退化成纯年级/纯校级（过宽，而不是过窄）。
- 现有行 `subject_code` 为 NULL，后置谓词应视为「不限制学科」，旧数据行为不变。

**优点 / 缺点 / 适用条件**

- 优点：一种增量同时覆盖「年级主任 / 年级教研组 / 全校学科组」；旧 scope 行为可保持。
- 缺点：工作空间不再是「授权范围的完整故事」，UI 不能只展示 workspace 名称；UNIQUE 与演示数据要重新设计；仍要书目学科。
- 适用：产品既要年级主任，又要「六年级语文」和「全校语文」两种学科组，且不愿把 `subject` 做成第六种包含层。

---

## 4. 分期建议

**本设计不属于当前 Phase 4 范围。** Phase 4 只做 T4.1–T4.7：发布/下架 HTTP、教师（及已裁决的年级主任）`book.publish`、启用 `book_access_grants` 班级可见范围、可见范围 HTTP、教师端 UI、学生书架年级筛选、测试。不要在 Phase 4 改 `scope_type` CHECK、不要加学科列、不要做学科组角色。

P4-9 已记录：年级主任若只需「跨本年级设可见范围」，用现有 `grade_manager` + P4-10 即可，不必等本文。学科组另立项。

### 4.1 不动 schema 也能先兑现的

| 项 | 做法 | 兑现到哪 |
|---|---|---|
| 年级主任发布书 | `roleActions.grade_manager` 增加 `book.publish`（P4-1 已按 Phase 4 裁决，仍属 T4.2，不是本设计落地） | 人在年级工作空间里能发布；**不**按书的年级过滤 |
| 年级主任设本年级可见范围 | P4-10：可见班级按操作者 scope 取 | 不扩角色模型 |
| 年级主任要校长的其他动作 | 只改动作表 | 安全/归档/课堂控制等，需产品点名 |
| 演示出年级主任 | `bootstrap-internal-demo.js` 加 grade 工作空间 + `grade_manager` 行 | 现在连演示账号都没有 |
| 教研组与年级主任分成两种人格 | 取消 `grade_group` 别名，给它更短的动作表 | 仍是年级范围，不是学科范围 |
| 年级主任建本年级的班 | 改 `POST /classes` 的 resourceScope，不要写死 school | 无 schema；要回归校长建班 |
| D-20 教师指派到班级 | 新 HTTP，写已有三张表 | 无 schema；不在 Phase 4；与学科组无关但一人多职会用到 |

### 4.2 必须等 schema（或至少等书目学科）的

| 项 | 为什么 |
|---|---|
| 学科组组长只管理本学科的书 | 没有学科列就没有判定依据 |
| `scope_type='subject'`（方向 A） | 两张表的 CHECK + 触发器 + workspace code |
| 正交授权表（方向 B）或授权行学科列（方向 D） | 新表或新列；外加书目回填 |
| 学科组管「本学科教师 / 本学科班级」 | 班级与教师任教在后端都没有学科 |
| 学生书架按真学科筛选 | 今日筛选读的是前端演示映射 |

### 4.3 建议的立项顺序（供裁决，不是排期承诺）

1. **Phase 4 按原范围做完**（含 P4-1 / P4-10）。年级主任的「书目发布 + 本年级可见班级」先借现有角色落地。
2. **产品先回答 §5。** 若学科组 = 年级教研组，走方向 C，可以不开迁移。
3. **若学科组是真正交维度：** 先做书目学科列 + 受控词表 + 49 本回填（没有这一步，A/B/D 都空转），再在 B 与 D 里选回归更小的一条。方向 A 只在明确「学科也是一种工作空间」时再上。
4. **D-20 单独做。** 它是身份补缺，和学科模型解耦；同期又改鉴权边界又改指派，故障无法归因。

---

## 5. 开放问题（请产品负责人拍板）

1. **学科组组长到底管什么？** 管书（发布/下架/可见范围）、管人（本学科教师、备课组成员）、管班、管教研内容（共读安排、社区），还是管安全事件？四类权限在现有动作表里不是同一组。
2. **学科组的空间形状是哪一种？**  
   - 全校语文组（跨年级、单学科）  
   - 六年级语文组（年级 ∩ 学科，前端壳现状）  
   - 每个年级每个学科一个组  
   三种对 A/B/C/D 的适用条件不同。
3. **「校长权限扩散」的清单是什么？** 是差集里全部八个动作，还是只扩散书目（`book.publish` / `book.archive`）？安全事件给年级主任、不给教研组——前端壳已经这么画了，是否仍有效？
4. **一人多职时，一次请求的权限怎么算？** 当前实现：只看 `X-Workspace-Id`，工作空间内并集，跨空间不并。产品要的是「班主任 ∪ 语文组长」自动并，还是「进哪个工作台用哪套权」？
5. **年级主任能不能建班、能不能管别的年级的书？** 现状：建班被 school 形 resourceScope 挡住；管书不看 `metadata.grade`。要「只能建本年级的班 / 只能动本年级的书」，调用方必须开始填真实年级，不能只加动作。
6. **学科受控词表是什么？** 语文 / 数学 / 英语 / 科学 / 道德与法治 / 音乐……？谁维护？与班级「学科」、课程表是否同一套？
7. **49 本现有书的学科谁来标？** 不标就无法授权。用体裁映射当默认值，是否接受误标？
8. **前端壳的「教研组」是否就是本诉求的「学科组组长」？** 若是，方向 C 可能够用；若不是，不要把 `grade-group` 工作空间直接改名为学科组。
9. **与 Phase 4 班级可见范围如何叠加？** 学科组长把书限定到某些班，是仍走 `book_access_grants`（class），还是还要 `grantee_type='subject'`？后者会干扰 T4.3 语义，不建议在 Phase 4 窗口讨论实现。
10. **`grade_group` / `grade_admin` 还要不要继续当 `grade_manager` 的别名？** 分开才能做出壳上已经画出来的两种人格；合并则年级主任与教研组永远同一动作表。

---

## 6. 实测 vs 推断

本文是设计分析，不是验收报告。没有跑测试、没有连业务库、没有在运行实例上点过按钮。

### 6.1 读源码确认的

- `roleActions` 五个键与完整动作列表、`roleAliases` 四条别名（`permissions.js`）。
- `scopeAllows` 全文与分支顺序（同文件 153–184 行）。
- `evaluatePermission` 对多条授权用 `.some`（同文件 192–197 行）。
- `role_assignments` 当前建表、UNIQUE、触发器（`005_...sql` 71 行起）。
- `workspaces` 当前建表与 `code` / `scope_type` CHECK（`000_identity.sql` 21–32 行）；后续迁移没有重建这张表。
- `listActiveRoleAssignments` 按当前 `workspace_id` 过滤，并 JOIN 要求 assignment.scope = workspace.scope。
- `authorize` 把 `authContext.workspaceId` 设为当前工作空间；受保护请求必须带 `X-Workspace-Id`。
- `book_catalog_metadata` 列清单（014 + 045）；无学科列；`listBooks` 不投影学科。
- 49 本编目 JSON 无 `subject` 字段。
- `book_access_grants` 已建表；`grantee_type` 无 CHECK；业务 JS 未见引用（与 Phase 4 交接记载一致，本文未再跑全仓测试来「证明零引用」）。
- 运行时写入 `class_memberships` 的领域函数是 `createStudentAccount`，`membership_role` 为 `'student'`。
- 演示引导没有 `grade_manager`、没有 grade 工作空间。
- `POST /classes` 的 resourceScope 写死为 school 形。
- 书目 `authorize` 与工作空间 scope 合并，不读取 `metadata.grade`。
- 前端壳存在「六年级语文教研组」夹具；学生演示库存在体裁→学科映射。
- 控制台创建班级表单的学科字段不落库。

### 6.2 推断、未在运行时核对的

- 现网业务库里 `role_assignments.role_code` 的实际取值分布（未打开 `server/data/readmate.sqlite`）。推断演示库与引导脚本一致：无 `grade_manager` / `grade_group` 行。
- 「包含链」作为产品口头模型成立，但 `scopeAllows` 并非格子自动包含——这是对代码控制流的解读。
- 方向 A 重建两张表时的停机与触发器回归工作量，是按 005 先例做的工程估计。
- 前端壳「教研组」是否仍代表产品要的学科组——只能从夹具命名推断，不能当成已裁决需求。
- 给 `grade_manager` 补齐校长差集之后，各领域调用方是否还有第二处写死 school 形的 resourceScope：本文只确认了 `POST /classes`；`updateUser` 的 school 形对象是审计快照（`service.js` 382–386 行），不是授权输入。其他领域未逐条跟完。
- `statistics.js` 把 `grade_group` / `class_teacher` 当作原始角色码：若库中从未写入这些码，取消别名的运行时影响为零——这一点取决于未打开的库内容。

### 6.3 运行过的检索（只读）

在仓库内用内容检索（等价于对下列模式做全仓搜索），**未**执行测试或构建：

- `学科组`：产品代码零命中；仅 Phase 4 裁决文档 P4-9。
- `教研组`：仅 `src/console/**` 夹具与文案（见 §1.5 表）。
- `学科`：学生演示库、控制台夹具/表单、以及 P4-9 文档。
- `subject`：前端演示字段 + 桥接 JWT 学生主体 + 测试里的 token subject；`server/db/migrations/` 无课程学科列。
- `discipline`：`server/domains/` 零命中。
- `book_access_grants`：建表在 `010_reading_catalog.sql`；其余命中为计划/交接文档。
- `CREATE TABLE workspaces` / `role_assignments` / `book_catalog_metadata` / `book_access_grants`：分别在 000、000+005、014+045、010。
- `INSERT INTO class_memberships`：运行时领域层仅 `repository.js` 的 `createStudentAccount`；另有种子导入与测试夹具。
- `grade_manager` / `grade-group` / `grade_group`：后端角色与别名、workspace code、前端夹具、统计模块的角色码集合。

---

## 附录：与 Phase 4 文档的交叉引用

- Phase 4 任务：`docs/product-close-loop/03_实施任务清单.md` T4.1–T4.7。
- 本诉求的处置记录：`docs/product-close-loop/evidence/phase4/decisions.md` P4-9、P4-10。P4-9 把年级主任的可见范围交给 Phase 4，把学科组交给本文；**本文不改变 P4-9，也不授权任何实现。**
- 硬契约「不新建第二套系统」：`docs/product-close-loop/02_决策与契约边界.md` B-2，以及既有身份契约 `docs/integration/一体化领域与接口契约.md` 第 5 节。
