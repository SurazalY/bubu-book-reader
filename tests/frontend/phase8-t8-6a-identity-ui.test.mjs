import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createIdentityConsoleApi } from '../../src/console/pages/accounts/identityApi.js'
import {
  accountCodeSuffix,
  applyWriteTeacherCount,
  buildCreateClassBody,
  canCreateClass,
  canIssueTeacherAccountSupport,
  GRADE_MANAGER_SCOPE_NOTE,
  registrationJoinPath,
  resolveLoginDestination,
  teacherJoinConfirmMessage,
  teacherJoinNeedsConfirm,
} from '../../src/console/pages/accounts/identityUi.js'

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

test('T8.6A 登录只接受服务端路径，空 defaultPath 不是失败', () => {
  assert.equal(resolveLoginDestination({ defaultPath: '/console/select-class' }), '/console/select-class')
  assert.equal(resolveLoginDestination({ defaultPath: '/student/onboarding' }), '/student/onboarding')
  assert.equal(resolveLoginDestination({ defaultPath: '   ' }), null)
  assert.equal(resolveLoginDestination({ defaultPath: '' }), null)
  assert.equal(resolveLoginDestination({ defaultPath: null }), null)
  assert.equal(resolveLoginDestination({}), null)
  assert.equal(resolveLoginDestination(undefined), null)
})

test('T8.6A 教师选班：teacherCount>0 才确认，取消不发 PUT', () => {
  assert.equal(teacherJoinNeedsConfirm(0), false)
  assert.equal(teacherJoinNeedsConfirm(1), true)
  assert.equal(teacherJoinNeedsConfirm(3), true)
  assert.match(teacherJoinConfirmMessage(2), /本班已有 2 位教师，加入后将共同管理/)
  const refreshed = applyWriteTeacherCount(
    [{ id: 'class-1', teacherCount: 1 }, { id: 'class-2', teacherCount: 0 }],
    'class-1',
    2,
  )
  assert.deepEqual(refreshed.map((item) => item.teacherCount), [2, 0])
})

test('T8.6A 建班 body 只有 name/stage/entryYear/classNumber', () => {
  assert.deepEqual(buildCreateClassBody({
    name: ' 四年级2班 ',
    stage: 'primary',
    entryYear: '2023',
    classNumber: '2',
    teacher: '不该提交',
  }), {
    name: '四年级2班',
    stage: 'primary',
    entryYear: 2023,
    classNumber: 2,
  })
  assert.equal(canCreateClass('school'), true)
  assert.equal(canCreateClass('grade'), true)
  assert.equal(canCreateClass('class'), false)
})

test('T8.6A 年级主任可做教师账号支持，文案禁止暗示跨届或书架', () => {
  assert.equal(canIssueTeacherAccountSupport('grade'), true)
  assert.equal(canIssueTeacherAccountSupport('class'), false)
  assert.match(GRADE_MANAGER_SCOPE_NOTE, /本届/)
  assert.match(GRADE_MANAGER_SCOPE_NOTE, /不表示可以跨届管班或管理书架/)
  assert.doesNotMatch(GRADE_MANAGER_SCOPE_NOTE, /投放|下架|书库/)
})

test('T8.6A 审批辨认用尾 4 位，rawToken 只拼一次加入路径', () => {
  assert.equal(accountCodeSuffix('UABCDEF123456'), '3456')
  assert.equal(accountCodeSuffix('UABCDEF123456', '8899'), '8899')
  assert.equal(registrationJoinPath('tok_abc'), '/join/tok_abc')
  assert.equal(registrationJoinPath(''), null)
})

test('T8.6A identityApi 打契约路径且写请求带幂等键', async () => {
  const calls = []
  const api = createIdentityConsoleApi({
    get(path, options) {
      calls.push({ method: 'GET', path, options })
      return Promise.resolve({ data: { items: [] }, meta: {} })
    },
    put(path, options) {
      calls.push({ method: 'PUT', path, options })
      return Promise.resolve({ data: { teacherCount: 2, workspaceId: 'ws-1' }, meta: {} })
    },
    post(path, options) {
      calls.push({ method: 'POST', path, options })
      return Promise.resolve({ data: { rawToken: 'once' }, meta: {} })
    },
    delete(path, options) {
      calls.push({ method: 'DELETE', path, options })
      return Promise.resolve({ data: {}, meta: {} })
    },
  })

  await api.getTeacherClassDirectory()
  await api.joinTeacherClass('class-1', { idempotencyKey: 'join-1' })
  await api.createClass({ name: '一班', stage: 'primary', entryYear: 2023, classNumber: 1 }, { workspaceId: 'ws-1', idempotencyKey: 'create-1' })
  await api.listEnrollmentRequests('class-1', { workspaceId: 'ws-1' })
  await api.approveEnrollmentRequest('enr-1', { version: 1 }, { workspaceId: 'ws-1', idempotencyKey: 'ok-1' })
  await api.issueRegistrationCredential({ expectedRole: 'student' }, { workspaceId: 'ws-1', idempotencyKey: 'issue-1' })
  await api.issuePasswordResetCredential('user-1', { workspaceId: 'ws-1', idempotencyKey: 'reset-1' })
  await api.leaveTeacherClass('class-1', { idempotencyKey: 'leave-1' })

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ['GET', '/teacher/class-directory'],
    ['PUT', '/teacher/classes/class-1'],
    ['POST', '/classes'],
    ['GET', '/classes/class-1/enrollment-requests'],
    ['POST', '/enrollment-requests/enr-1/approve'],
    ['POST', '/registration-credentials'],
    ['POST', '/users/user-1/password-reset-credentials'],
    ['DELETE', '/teacher/classes/class-1'],
  ])
  assert.equal(calls[1].options.idempotencyKey, 'join-1')
  assert.deepEqual(calls[2].options.body, { name: '一班', stage: 'primary', entryYear: 2023, classNumber: 1 })
  assert.equal(calls[3].options.query.status, 'pending')
  assert.equal(calls.at(-1).options.idempotencyKey, 'leave-1')
})

test('T8.6A 页面已去掉演示不写入文案，并挂上真路由', async () => {
  const files = await Promise.all([
    source('../../src/console/pages/accounts/ClassList.jsx'),
    source('../../src/console/pages/accounts/ClassDetail.jsx'),
    source('../../src/console/pages/accounts/OrgAccounts.jsx'),
    source('../../src/console/pages/Login.jsx'),
    source('../../src/student/pages/Login.jsx'),
    source('../../src/console/pages/SelectClass.jsx'),
    source('../../src/student/pages/Register.jsx'),
    source('../../src/student/pages/Onboarding.jsx'),
    source('../../src/console/ConsoleApp.jsx'),
    source('../../src/student/StudentApp.jsx'),
    source('../../src/App.jsx'),
  ])
  const [classList, classDetail, org, consoleLogin, studentLogin, selectClass, register, onboarding, consoleApp, studentApp, app] = files
  const accounts = `${classList}\n${classDetail}\n${org}`

  assert.doesNotMatch(accounts, /演示环境不写入|演示环境不会|演示环境不提供|演示环境不写入任何/)
  assert.match(classList, /createClass\(/)
  assert.match(classList, /name, stage, entryYear, classNumber|buildCreateClassBody/)
  assert.match(classDetail, /displayName/)
  assert.match(classDetail, /avatarSeed|seedAvatarTone/)
  assert.match(classDetail, /accountCodeSuffix/)
  assert.match(classDetail, /requestedAt/)
  assert.match(selectClass, /getTeacherClassDirectory/)
  assert.match(selectClass, /teacherJoinNeedsConfirm/)
  assert.match(selectClass, /joinTeacherClass/)
  assert.match(selectClass, /setPending\(null\)/)
  assert.match(org, /rawToken/)
  assert.match(org, /GRADE_MANAGER_SCOPE_NOTE/)
  assert.doesNotMatch(org, /投放|下架|书库管理/)

  assert.match(consoleLogin, /loginName, password/)
  assert.match(studentLogin, /loginName, password/)
  assert.doesNotMatch(consoleLogin, /schoolCode/)
  assert.doesNotMatch(studentLogin, /schoolCode/)
  assert.match(consoleLogin, /resolveLoginDestination/)
  assert.match(studentLogin, /resolveLoginDestination/)
  assert.doesNotMatch(consoleLogin, /没有可用的权限端入口/)
  assert.doesNotMatch(studentLogin, /没有可用的读伴入口/)

  assert.match(register, /getRegistration/)
  assert.match(register, /registerWithToken/)
  assert.match(onboarding, /getOnboardingMe/)
  assert.match(consoleApp, /path="select-class"/)
  assert.match(consoleApp, /path="accounts\/classes"/)
  assert.match(studentApp, /path="register\/:token"/)
  assert.match(studentApp, /path="register" element=\{<Register/)
  assert.match(studentApp, /path="onboarding"/)
  assert.match(app, /path="\/join\/:token"/)
  assert.match(consoleLogin, /\/student\/register/)
  assert.match(studentLogin, /\/student\/register/)
  assert.match(selectClass, /leaveTeacherClass/)
  assert.match(org, /内部编号，不是注册码/)
})
