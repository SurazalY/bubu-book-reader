import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { defaultMigrationDirectory } from '../../../server/domains/identity/index.js'
import { listWorkspacesForUser } from '../../../server/domains/identity/repository.js'

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-ws-order-'))
  return { directory, filename: join(directory, 'core.sqlite') }
}

function removeTemporaryDatabase(database) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const candidate = `${database.filename}${suffix}`
    if (existsSync(candidate)) {
      unlinkSync(candidate)
    }
  }
  rmSync(database.directory, { recursive: true, force: true })
}

test('listWorkspacesForUser 按班级 entry_year 与 class_number 自然排序，确保一班排在二班前', () => {
  const tmp = createTemporaryDatabase()
  const db = openSqliteDatabase(tmp.filename)
  runMigrations(db, defaultMigrationDirectory())

  const now = new Date().toISOString()
  const orgId = randomUUID()
  const teacherId = randomUUID()
  const class1Id = randomUUID()
  const class2Id = randomUUID()
  const ws1Id = randomUUID()
  const ws2Id = randomUUID()

  // 插入组织
  db.prepare("INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version) VALUES (?, ?, 'TEST01', 'active', ?, ?, 1)")
    .run(orgId, '测试学校', now, now)

  // 插入教师
  const teacherUsername = `teacher-${randomUUID()}`
  db.prepare("INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)")
    .run(teacherId, orgId, teacherUsername, '测试教师', now, now, 'teacher01', 'TEA001')

  // 插入班级：一班（中文名：公共领域素材联调班级）与二班（英文开头名：T89验收二班）
  // 按照 SQL 字符串排序，'T89验收二班' 会排在 '公共领域素材联调班级' 前面；但按照 class_number 排序，1 在 2 前面
  db.prepare(`
    INSERT INTO classes (id, organization_id, grade_id, name, stage, entry_year, class_number, status, created_at, updated_at, version)
    VALUES (?, ?, 'junior:2024', ?, 'junior', 2024, 1, 'active', ?, ?, 1)
  `).run(class1Id, orgId, '公共领域素材联调班级', now, now)

  db.prepare(`
    INSERT INTO classes (id, organization_id, grade_id, name, stage, entry_year, class_number, status, created_at, updated_at, version)
    VALUES (?, ?, 'junior:2024', ?, 'junior', 2024, 2, 'active', ?, ?, 1)
  `).run(class2Id, orgId, 'T89验收二班', now, now)

  // 插入工作空间
  db.prepare(`
    INSERT INTO workspaces (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
    VALUES (?, ?, 'class-teacher', '公共领域素材联调班级', 'class', ?, 'active', ?, ?, 1)
  `).run(ws1Id, orgId, class1Id, now, now)

  db.prepare(`
    INSERT INTO workspaces (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
    VALUES (?, ?, 'class-teacher', 'T89验收二班', 'class', ?, 'active', ?, ?, 1)
  `).run(ws2Id, orgId, class2Id, now, now)

  // 插入工作空间成员关系
  db.prepare(`
    INSERT INTO workspace_memberships (id, workspace_id, user_id, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)
  `).run(randomUUID(), ws1Id, teacherId, now, now)

  db.prepare(`
    INSERT INTO workspace_memberships (id, workspace_id, user_id, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)
  `).run(randomUUID(), ws2Id, teacherId, now, now)

  // 查询工作空间列表
  const workspaces = listWorkspacesForUser(db, teacherId)
  assert.equal(workspaces.length, 2)
  // 必须一班（class_number=1）排在第一位，二班（class_number=2）排在第二位
  assert.equal(workspaces[0].id, ws1Id)
  assert.equal(workspaces[0].name, '公共领域素材联调班级')
  assert.equal(workspaces[1].id, ws2Id)
  assert.equal(workspaces[1].name, 'T89验收二班')

  db.close()
  removeTemporaryDatabase(tmp)
})

test('/students 查询返回 classStage, classEntryYear, classNumber 并按班级结构化排序', () => {
  const tmp = createTemporaryDatabase()
  const db = openSqliteDatabase(tmp.filename)
  runMigrations(db, defaultMigrationDirectory())

  const now = new Date().toISOString()
  const orgId = randomUUID()
  const student1Id = randomUUID()
  const student2Id = randomUUID()
  const class1Id = randomUUID()
  const class2Id = randomUUID()

  db.prepare("INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version) VALUES (?, ?, 'TEST02', 'active', ?, ?, 1)")
    .run(orgId, '测试学校', now, now)

  db.prepare("INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)")
    .run(student1Id, orgId, `student-1-${randomUUID()}`, '张三', now, now, 'student01', 'STU001')
  db.prepare("INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)")
    .run(student2Id, orgId, `student-2-${randomUUID()}`, '李四', now, now, 'student02', 'STU002')

  db.prepare(`
    INSERT INTO classes (id, organization_id, grade_id, name, stage, entry_year, class_number, status, created_at, updated_at, version)
    VALUES (?, ?, 'junior:2024', ?, 'junior', 2024, 1, 'active', ?, ?, 1)
  `).run(class1Id, orgId, '公共领域素材联调班级', now, now)

  db.prepare(`
    INSERT INTO classes (id, organization_id, grade_id, name, stage, entry_year, class_number, status, created_at, updated_at, version)
    VALUES (?, ?, 'junior:2024', ?, 'junior', 2024, 2, 'active', ?, ?, 1)
  `).run(class2Id, orgId, 'T89验收二班', now, now)

  // 李四在二班，张三在一班
  db.prepare(`
    INSERT INTO class_memberships (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
  `).run(randomUUID(), class2Id, student2Id, now, now)

  db.prepare(`
    INSERT INTO class_memberships (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
  `).run(randomUUID(), class1Id, student1Id, now, now)

  const rows = db.prepare(`
    SELECT DISTINCT
      student.id,
      student.display_name AS displayName,
      class.id AS classId,
      class.name AS className,
      class.stage AS classStage,
      class.entry_year AS classEntryYear,
      class.class_number AS classNumber
    FROM users AS student
    JOIN class_memberships AS membership
      ON membership.user_id = student.id AND membership.membership_role = 'student' AND membership.status = 'active'
    JOIN classes AS class
      ON class.id = membership.class_id AND class.status = 'active'
    WHERE student.organization_id = ? AND student.status = 'active'
      AND class.organization_id = ? AND class.organization_id = ?
    ORDER BY class.entry_year, class.class_number, class.name, student.display_name, student.id
  `).all(orgId, orgId, orgId)

  assert.equal(rows.length, 2)
  // 一班的学生张三排在第一位，二班的学生李四排在第二位
  assert.equal(rows[0].id, student1Id)
  assert.equal(rows[0].classNumber, 1)
  assert.equal(rows[0].classEntryYear, 2024)
  assert.equal(rows[0].classStage, 'junior')

  assert.equal(rows[1].id, student2Id)
  assert.equal(rows[1].classNumber, 2)
  assert.equal(rows[1].classEntryYear, 2024)
  assert.equal(rows[1].classStage, 'junior')

  db.close()
  removeTemporaryDatabase(tmp)
})
