import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  INTERNAL_CREDENTIAL_ID_NOTE,
  joinedClassIdsFromWorkspaces,
  mergeIssuedCredentialRow,
  REGISTRATION_PAGE_PATH,
  registrationRoleLabel,
  revealedRegistrationToken,
} from '../../src/console/pages/accounts/identityUi.js'

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

test('T8.10 两个 Login 都指向 /student/register，StudentApp 有无 token 注册路由', async () => {
  const [consoleLogin, studentLogin, studentApp, app] = await Promise.all([
    source('../../src/console/pages/Login.jsx'),
    source('../../src/student/pages/Login.jsx'),
    source('../../src/student/StudentApp.jsx'),
    source('../../src/App.jsx'),
  ])
  assert.match(consoleLogin, /\/student\/register/)
  assert.match(studentLogin, /\/student\/register/)
  assert.match(consoleLogin, /凭据注册/)
  assert.match(studentLogin, /凭据注册/)
  assert.doesNotMatch(consoleLogin, /\/console\/register/)
  assert.match(studentApp, /path="register" element=\{<Register/)
  assert.match(studentApp, /path="register\/:token" element=\{<Register/)
  assert.match(app, /path="\/join\/:token"/)
})

test('T8.10 Register 无 token 时先收注册码，不立刻 getRegistration(undefined)', async () => {
  const register = await source('../../src/student/pages/Register.jsx')
  assert.match(register, /aria-label="注册码"/)
  assert.match(register, /校长签发的注册码/)
  assert.match(register, /不要把凭据编号当注册码/)
  assert.match(register, /学生登录页和教师登录页都可以来这里/)
  assert.match(register, /if \(!activeToken\)/)
  assert.match(register, /getRegistration\(activeToken\)/)
  assert.doesNotMatch(register, /getRegistration\(\s*token\s*\)/)
  assert.doesNotMatch(register, /getRegistration\(\s*undefined\s*\)/)
  assert.match(register, /registerWithToken\(activeToken/)
})

test('T8.10 TopBar 父菜单不因 subOpen 左移，并有选班入口', async () => {
  const topBar = await source('../../src/console/components/shell/TopBar.jsx')
  assert.doesNotMatch(topBar, /flex items-start justify-end/)
  assert.doesNotMatch(topBar, /整体左移/)
  assert.match(topBar, /absolute top-full right-0/)
  assert.match(topBar, /right-full/)
  assert.match(topBar, /管理任教班级/)
  assert.match(topBar, /\/console\/select-class/)
})

test('T8.10 SelectClass 已加入可退出，joined 来自 listWorkspaces', async () => {
  const selectClass = await source('../../src/console/pages/SelectClass.jsx')
  assert.match(selectClass, /leaveTeacherClass/)
  assert.match(selectClass, /已加入/)
  assert.match(selectClass, /退出/)
  assert.match(selectClass, /listWorkspaces/)
  assert.match(selectClass, /joinedClassIdsFromWorkspaces/)
  assert.match(selectClass, /teacherJoinNeedsConfirm/)
  assert.doesNotMatch(selectClass, /navigate\('\/console\/login'/)
})

test('T8.10 工作空间 class scope 视为已加入，签发行不把 rawToken 写入列表行', () => {
  assert.deepEqual(joinedClassIdsFromWorkspaces({
    items: [
      { scopeType: 'class', scopeId: 'class-1' },
      { scopeType: 'school', scopeId: 'org-1' },
      { scopeType: 'class', scopeId: '  ' },
      { scopeType: 'class', scopeId: 'class-2' },
    ],
  }), ['class-1', 'class-2'])
  assert.equal(registrationRoleLabel('student'), '学生')
  assert.equal(registrationRoleLabel('teacher'), '教师')
  assert.equal(REGISTRATION_PAGE_PATH, '/student/register')
  assert.equal(INTERNAL_CREDENTIAL_ID_NOTE, '内部编号，不是注册码')

  const issued = { id: 'cred-1', rawToken: 'raw-once', expectedRole: 'student', maxUses: 3 }
  const rows = mergeIssuedCredentialRow([], issued, 'student')
  assert.equal(rows[0].id, 'cred-1')
  assert.equal(rows[0].expectedRole, 'student')
  assert.equal(rows[0].rawToken, undefined)
  assert.equal(revealedRegistrationToken(issued, 'cred-1'), 'raw-once')
  assert.equal(revealedRegistrationToken(issued, 'other'), null)
  assert.deepEqual(mergeIssuedCredentialRow([{ id: 'cred-1', expectedRole: 'student' }], issued, 'student'), [
    { id: 'cred-1', expectedRole: 'student' },
  ])
  assert.deepEqual(
    mergeIssuedCredentialRow([{ id: 'stu-1', expectedRole: 'student' }], { id: 'tea-1', expectedRole: 'teacher', rawToken: 'hidden' }, 'student'),
    [{ id: 'stu-1', expectedRole: 'student' }],
  )
})

test('T8.10 OrgAccounts 历史行不以 item.id 当注册码，签发行区分注册码与内部编号', async () => {
  const org = await source('../../src/console/pages/accounts/OrgAccounts.jsx')
  assert.match(org, /注册码/)
  assert.match(org, /内部编号，不是注册码/)
  assert.match(org, /复制注册码/)
  assert.match(org, /复制注册页链接/)
  assert.match(org, /复制编号/)
  assert.match(org, /\/student\/register/)
  assert.match(org, /revealedRegistrationToken/)
  assert.match(org, /mergeIssuedCredentialRow\(credentials\.data, issued, expectedRole\)/)
  assert.doesNotMatch(org, /registrationJoinPath/)
  assert.doesNotMatch(org, /localStorage/)
  assert.doesNotMatch(org, /<th[^>]*>凭据<\/th>/)
  assert.doesNotMatch(org, /<td[^>]*>\{item\.id\}<\/td>/)
})
