import { findUserScope, listActiveRoleAssignments } from '../identity/repository.js'
import { all, one } from './sql.js'

const PLATFORM_LIBRARY_ROLES = new Set(['platform_ops', 'platform_operator'])
const TEACHER_LIBRARY_ROLES = new Set(['teacher', 'class_teacher'])

// T4.3 唯一的“当前版本”口径。listBooks 的 JOIN、可见范围读写、引用检查都由这里生成 SQL，
// 保证 grants 写入的 book_version_id 与过滤读取解析出的版本永远同源。
export function currentBookVersionSubquery(bookIdExpression) {
  return `SELECT latest.id FROM book_versions AS latest
      WHERE latest.book_id = ${bookIdExpression} AND latest.organization_id_at_creation = :organizationId
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1`
}

export function resolveCurrentBookVersionId(database, { bookId, organizationId }) {
  return one(database, `SELECT (${currentBookVersionSubquery(':bookId')}) AS id`, { bookId, organizationId })?.id ?? null
}

// 陷阱一：不使用 context.authorize（默认 fail-open），直接用 role_assignments 做正向角色判定。
// 陷阱二：学生班级来自 class_memberships，不是请求头里的工作空间 scopeId。
// D-25：校长 / 年级主任不得因 BOOK_LIBRARY_MANAGEMENT_ROLES 进入书库 audience。
// 只正向识别 platform / teacher；其余一律 closed（含 school_admin、grade_manager、学生）。
function resolveLibraryAudienceKind(database, { organizationId, userId, workspaceId }) {
  if (!organizationId || !userId || !workspaceId) return 'closed'
  const roles = new Set(
    listActiveRoleAssignments(database, userId, workspaceId, organizationId)
      .map((assignment) => assignment.roleCode),
  )
  if ([...roles].some((roleCode) => PLATFORM_LIBRARY_ROLES.has(roleCode))) return 'platform'
  if ([...roles].some((roleCode) => TEACHER_LIBRARY_ROLES.has(roleCode))) return 'teacher'
  return 'closed'
}

export function resolveBookAudience(database, { organizationId, userId, workspaceId }) {
  const kind = resolveLibraryAudienceKind(database, { organizationId, userId, workspaceId })
  if (kind === 'platform') {
    return { bypassClassGrants: true, allowUnpublished: true, classIds: [] }
  }
  if (kind === 'teacher') {
    const scope = userId ? findUserScope(database, userId) : null
    return {
      bypassClassGrants: true,
      allowUnpublished: false,
      classIds: scope && scope.organizationId === organizationId ? scope.classIds : [],
    }
  }
  const scope = organizationId && userId ? findUserScope(database, userId) : null
  if (!scope || scope.organizationId !== organizationId) {
    return { bypassClassGrants: false, allowUnpublished: false, classIds: [] }
  }
  return { bypassClassGrants: false, allowUnpublished: false, classIds: scope.classIds }
}

const BOOK_GRANTED_TO_CLASS_SQL = `SELECT 1 FROM book_access_grants AS grant_row
  JOIN book_versions AS version ON version.id = grant_row.book_version_id
  WHERE version.book_id = :bookId AND version.organization_id_at_creation = :organizationId
    AND grant_row.organization_id_at_creation = :organizationId
    AND grant_row.grantee_type = 'class'
    AND grant_row.grantee_id IN (SELECT value FROM json_each(:classIdsJson))
  LIMIT 1`

// 四个入口共用的唯一可见性谓词：只回答 class grant。
// bypassClassGrants 只绕过班级 grant，不表示可以看 draft。
// classIds 为空即 false；仅匹配 grantee_type='class' 的 grant 才 true。
// 未知 grantee_type 不得视为可见，也不得因「无 class grant」退回全开。
export function isBookVisibleToAudience(database, { bookId, organizationId, audience }) {
  if (audience?.bypassClassGrants) return true
  if (!bookId || !organizationId) return false
  const classIds = audience?.classIds ?? []
  if (classIds.length === 0) return false
  return Boolean(one(database, BOOK_GRANTED_TO_CLASS_SQL, {
    bookId,
    organizationId,
    classIdsJson: JSON.stringify(classIds),
  }))
}

// F-1 删除侧校验的数据源：本书全部版本上 grantee_type='class' 的授权目标。
// activeInOrganization 标出该班此刻是否仍是本组织的 active 班级——listAuthorizedClasses 只认
// active 且属于本组织的班，所以指向已停用/已删除班级的悬空 grants 不在任何人（含校长）的授权
// 集合里；这些行必须豁免删除侧校验，否则这本书会变成谁都改不了可见范围的永久死锁。
export function listBookClassGrantTargets(database, { bookId, organizationId }) {
  return all(database, `SELECT DISTINCT grant_row.grantee_id AS classId,
      CASE WHEN class.id IS NULL THEN 0 ELSE 1 END AS activeInOrganization
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    LEFT JOIN classes AS class ON class.id = grant_row.grantee_id
      AND class.organization_id = :organizationId AND class.status = 'active'
    WHERE version.book_id = :bookId AND version.organization_id_at_creation = :organizationId
      AND grant_row.grantee_type = 'class'
    ORDER BY grant_row.grantee_id`, { bookId, organizationId }).map((row) => ({
    classId: row.classId,
    activeInOrganization: Number(row.activeInOrganization) === 1,
  }))
}

export function listBookClassGrants(database, { bookId, organizationId }) {
  return all(database, `SELECT grant_row.grantee_id AS classId, class.name AS className, class.grade_id AS gradeId
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    LEFT JOIN classes AS class ON class.id = grant_row.grantee_id AND class.organization_id = :organizationId
    WHERE version.book_id = :bookId AND version.organization_id_at_creation = :organizationId
      AND grant_row.grantee_type = 'class'
    ORDER BY grant_row.grantee_id`, { bookId, organizationId }).map((row) => ({
    classId: row.classId,
    name: row.className ?? null,
    gradeId: row.gradeId ?? null,
  }))
}

// 3.5 引用检查：阅读安排 = reading_assignments + assignment_classes；课堂锁书 = class_sessions.locked_book_version_id。
export function listBookReferences(database, { bookId, organizationId }) {
  const assignmentRows = all(database, `SELECT assignment.id AS assignmentId, assignment.title,
      assignment.book_version_id AS bookVersionId, assignment.starts_at AS startsAt, assignment.ends_at AS endsAt,
      assignment_class.class_id AS classId, class.name AS className
    FROM reading_assignments AS assignment
    JOIN book_versions AS version ON version.id = assignment.book_version_id
    LEFT JOIN assignment_classes AS assignment_class ON assignment_class.assignment_id = assignment.id
    LEFT JOIN classes AS class ON class.id = assignment_class.class_id AND class.organization_id = :organizationId
    WHERE version.book_id = :bookId AND version.organization_id_at_creation = :organizationId
      AND assignment.organization_id_at_creation = :organizationId
    ORDER BY assignment.created_at, assignment.id, assignment_class.class_id`, { bookId, organizationId })
  const sessionRows = all(database, `SELECT session.id AS sessionId, session.assignment_id AS assignmentId,
      session.status, session.locked_book_version_id AS bookVersionId,
      assignment_class.class_id AS classId, class.name AS className
    FROM class_sessions AS session
    JOIN book_versions AS version ON version.id = session.locked_book_version_id
    LEFT JOIN assignment_classes AS assignment_class ON assignment_class.assignment_id = session.assignment_id
    LEFT JOIN classes AS class ON class.id = assignment_class.class_id AND class.organization_id = :organizationId
    WHERE version.book_id = :bookId AND version.organization_id_at_creation = :organizationId
      AND session.organization_id_at_creation = :organizationId
      AND session.status = 'active'
    ORDER BY session.created_at, session.id, assignment_class.class_id`, { bookId, organizationId })
  return {
    arrangements: groupReferences(assignmentRows, 'assignmentId', (row) => ({
      assignmentId: row.assignmentId,
      title: row.title,
      bookVersionId: row.bookVersionId,
      startsAt: row.startsAt ?? null,
      endsAt: row.endsAt ?? null,
    })),
    classroomSessions: groupReferences(sessionRows, 'sessionId', (row) => ({
      sessionId: row.sessionId,
      assignmentId: row.assignmentId,
      bookVersionId: row.bookVersionId,
      status: row.status,
    })),
  }
}

function groupReferences(rows, keyField, project) {
  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row[keyField])) grouped.set(row[keyField], { ...project(row), classes: [] })
    if (row.classId) {
      const entry = grouped.get(row[keyField])
      if (!entry.classes.some((item) => item.id === row.classId)) {
        entry.classes.push({ id: row.classId, name: row.className ?? null })
      }
    }
  }
  return [...grouped.values()]
}

// 收窄可见范围后会失去访问权的引用（不做级联清理，只回报给前端提示）。
export function summarizeVisibilityImpact(references, { scope, classIds }) {
  const losing = new Map()
  if (scope === 'organization') {
    return {
      affectedArrangementCount: 0,
      affectedClassroomSessionCount: 0,
      losingClasses: [],
      arrangements: [],
      classroomSessions: [],
    }
  }
  const allowed = new Set(classIds)
  const affected = (entries) => entries
    .map((entry) => ({ entry, blocked: entry.classes.filter((item) => !allowed.has(item.id)) }))
    .filter(({ blocked }) => blocked.length > 0)
    .map(({ entry, blocked }) => {
      for (const item of blocked) losing.set(item.id, item)
      return { ...entry, blockedClasses: blocked }
    })
  const arrangements = affected(references.arrangements)
  const classroomSessions = affected(references.classroomSessions)
  return {
    affectedArrangementCount: arrangements.length,
    affectedClassroomSessionCount: classroomSessions.length,
    losingClasses: [...losing.values()],
    arrangements,
    classroomSessions,
  }
}
