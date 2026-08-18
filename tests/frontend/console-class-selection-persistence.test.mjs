import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildReadingClassOptions,
  compareClassNames,
  createSafeStorage,
  createScopedReadingStatisticsController,
  getClassStorageKey,
  parseChineseNumberToken,
  tokenizeClassName,
} from '../../src/console/state/useReadingStatistics.js'

test('自然数解析函数正确解析中文数字与混合数字', () => {
  assert.equal(parseChineseNumberToken('一'), 1)
  assert.equal(parseChineseNumberToken('二'), 2)
  assert.equal(parseChineseNumberToken('三'), 3)
  assert.equal(parseChineseNumberToken('九'), 9)
  assert.equal(parseChineseNumberToken('十'), 10)
  assert.equal(parseChineseNumberToken('十一'), 11)
  assert.equal(parseChineseNumberToken('二十'), 20)
  assert.equal(parseChineseNumberToken('二十五'), 25)
  assert.equal(parseChineseNumberToken('九十九'), 99)
  assert.equal(parseChineseNumberToken('一百'), 100)
  assert.equal(parseChineseNumberToken('invalid'), null)
})

test('分词函数正确识别中文数字、阿拉伯数字与普通文本', () => {
  const tokens1 = tokenizeClassName('三年级(2)班')
  assert.deepEqual(tokens1, [
    { isNumber: true, value: 3, raw: '三' },
    { isNumber: false, value: '年级(', raw: '年级(' },
    { isNumber: true, value: 2, raw: '2' },
    { isNumber: false, value: ')班', raw: ')班' },
  ])

  const tokens2 = tokenizeClassName('初一(10)班')
  assert.deepEqual(tokens2, [
    { isNumber: false, value: '初', raw: '初' },
    { isNumber: true, value: 1, raw: '一' },
    { isNumber: false, value: '(', raw: '(' },
    { isNumber: true, value: 10, raw: '10' },
    { isNumber: false, value: ')班', raw: ')班' },
  ])
})

test('班级名称自然数比较器使“一班”排在“二班”之前，并正确处理多位数字', () => {
  // 1. 中文数字一班 vs 二班
  assert.ok(compareClassNames('一班', '二班') < 0)
  assert.ok(compareClassNames('二班', '一班') > 0)
  assert.equal(compareClassNames('一班', '一班'), 0)

  // 2. 中文数字跨十位数
  assert.ok(compareClassNames('一班', '十班') < 0)
  assert.ok(compareClassNames('二班', '十班') < 0)
  assert.ok(compareClassNames('九班', '十班') < 0)
  assert.ok(compareClassNames('十班', '十一班') < 0)
  assert.ok(compareClassNames('十一班', '二十班') < 0)

  // 3. 阿拉伯数字
  assert.ok(compareClassNames('1班', '2班') < 0)
  assert.ok(compareClassNames('2班', '10班') < 0)
  assert.ok(compareClassNames('Class 1', 'Class 2') < 0)
  assert.ok(compareClassNames('Class 2', 'Class 10') < 0)

  // 4. 年级+班级复合形式
  assert.ok(compareClassNames('一年级一班', '一年级二班') < 0)
  assert.ok(compareClassNames('一年级二班', '二年级一班') < 0)
  assert.ok(compareClassNames('高一(1)班', '高一(2)班') < 0)
  assert.ok(compareClassNames('高一(2)班', '高一(10)班') < 0)
})

test('buildReadingClassOptions 对班级列表按自然数字序排序，一班排在二班前', () => {
  const payload = {
    items: [
      { studentId: 's3', classId: 'c-3', className: '三班' },
      { studentId: 's10', classId: 'c-10', className: '十班' },
      { studentId: 's2', classId: 'c-2', className: '二班' },
      { studentId: 's1', classId: 'c-1', className: '一班' },
      { studentId: 's11', classId: 'c-11', className: '十一班' },
    ],
  }

  const options = buildReadingClassOptions(payload)
  const displayNames = options.map((item) => item.displayName)
  assert.deepEqual(displayNames, ['一班', '二班', '三班', '十班', '十一班'])
  assert.deepEqual(options.map((item) => item.classId), ['c-1', 'c-2', 'c-3', 'c-10', 'c-11'])
})

test('buildReadingClassOptions 优先按结构化 entryYear 与 classNumber 排序，确保英汉混合命名下 class 1 依然排在 class 2 前', () => {
  const payload = {
    items: [
      {
        id: 's2',
        displayName: '张三',
        classId: 'class-2',
        className: 'T89验收二班',
        classStage: 'junior',
        classEntryYear: 2024,
        classNumber: 2,
      },
      {
        id: 's1',
        displayName: '李四',
        classId: 'class-1',
        className: '公共领域素材联调班级',
        classStage: 'junior',
        classEntryYear: 2024,
        classNumber: 1,
      },
      {
        id: 's0',
        displayName: '王五',
        classId: 'class-0',
        className: '2023级实验班',
        classStage: 'junior',
        classEntryYear: 2023,
        classNumber: 1,
      },
    ],
  }

  const options = buildReadingClassOptions(payload)
  assert.deepEqual(options.map((item) => item.classId), ['class-0', 'class-1', 'class-2'])
  assert.deepEqual(options.map((item) => item.displayName), ['2023级实验班', '公共领域素材联调班级', 'T89验收二班'])
  assert.equal(options[1].entryYear, 2024)
  assert.equal(options[1].classNumber, 1)
  assert.equal(options[2].entryYear, 2024)
  assert.equal(options[2].classNumber, 2)
})

function createMockScopeApi({ students = [], scopeData = {} } = {}) {
  const calls = []
  return {
    calls,
    listStudents: async (options) => {
      calls.push({ type: 'listStudents', options })
      return { data: { items: students }, meta: {} }
    },
    getSummary: async (options) => {
      calls.push({ type: 'getSummary', options })
      return {
        data: {
          generatedAt: '2026-08-19T08:00:00.000Z',
          dataUpdatedAt: null,
          statDate: options.statDate,
          class: { classId: options.classId, displayName: '班级', activeStudentCount: 0 },
          summary: {
            checkedInStudentCount: 0,
            checkInRateBasisPoints: null,
            totalEffectiveReadingSeconds: 0,
            perCapitaEffectiveReadingSeconds: null,
            skipStudentCount: 0,
            rereadStudentCount: 0,
          },
          trend: [
            '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
            '2026-08-17', '2026-08-18', '2026-08-19',
          ].map((d) => ({
            statDate: d,
            checkedInStudentCount: 0,
            activeStudentCount: 0,
            checkInRateBasisPoints: null,
            perCapitaEffectiveReadingSeconds: null,
          })),
          students: [],
          ...scopeData,
        },
        meta: {},
      }
    },
  }
}

function createMemoryStorage(initialData = {}) {
  const store = new Map(Object.entries(initialData))
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    get store() { return store },
  }
}

test('控制器加载班级后恢复 localStorage 中的选班记忆，且切换班级同步更新持久化', async () => {
  const storage = createMemoryStorage({
    [getClassStorageKey('workspace-101')]: 'c-2',
  })

  const api = createMockScopeApi({
    students: [
      { studentId: 's1', classId: 'c-1', className: '一班' },
      { studentId: 's2', classId: 'c-2', className: '二班' },
    ],
  })

  const controller = createScopedReadingStatisticsController({
    api,
    workspaceId: 'workspace-101',
    initialStatDate: '2026-08-19',
    storage,
  })

  // 初始状态下从 localStorage 预读到了 c-2
  assert.equal(controller.getState().selectedClassId, 'c-2')

  controller.start()
  // 等待 loadClasses 与 refresh 完成
  await new Promise((r) => setTimeout(r, 10))

  // 验证恢复了选中的班级 c-2，而不是因为一班排在前面就重置回一班
  assert.equal(controller.getState().selectedClassId, 'c-2')
  assert.equal(storage.getItem(getClassStorageKey('workspace-101')), 'c-2')

  // 用户主动切换到一班
  controller.setClassId('c-1')
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(controller.getState().selectedClassId, 'c-1')
  // 验证 storage 已同步持久化写入 c-1
  assert.equal(storage.getItem(getClassStorageKey('workspace-101')), 'c-1')

  controller.stop()
})

test('localStorage 记录不存在或记录了无效班级时安全回退到首个自然序班级（一班）', async () => {
  const storage = createMemoryStorage({
    [getClassStorageKey('workspace-102')]: 'c-invalid-999',
  })

  const api = createMockScopeApi({
    students: [
      { studentId: 's2', classId: 'c-2', className: '二班' },
      { studentId: 's1', classId: 'c-1', className: '一班' },
    ],
  })

  const controller = createScopedReadingStatisticsController({
    api,
    workspaceId: 'workspace-102',
    initialStatDate: '2026-08-19',
    storage,
  })

  controller.start()
  await new Promise((r) => setTimeout(r, 10))

  // 无效班级回退到自然排序第一位的“一班”（c-1）
  assert.equal(controller.getState().selectedClassId, 'c-1')
  assert.equal(storage.getItem(getClassStorageKey('workspace-102')), 'c-1')

  controller.stop()
})

test('不同工作空间（workspaceId）的选班记忆完全隔离', async () => {
  const storage = createMemoryStorage({
    [getClassStorageKey('workspace-A')]: 'c-2',
    [getClassStorageKey('workspace-B')]: 'c-1',
  })

  const api = createMockScopeApi({
    students: [
      { studentId: 's1', classId: 'c-1', className: '一班' },
      { studentId: 's2', classId: 'c-2', className: '二班' },
    ],
  })

  const controllerA = createScopedReadingStatisticsController({
    api,
    workspaceId: 'workspace-A',
    initialStatDate: '2026-08-19',
    storage,
  })
  controllerA.start()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(controllerA.getState().selectedClassId, 'c-2')
  controllerA.stop()

  const controllerB = createScopedReadingStatisticsController({
    api,
    workspaceId: 'workspace-B',
    initialStatDate: '2026-08-19',
    storage,
  })
  controllerB.start()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(controllerB.getState().selectedClassId, 'c-1')
  controllerB.stop()
})

test('createSafeStorage 在非浏览器或无 localStorage 环境下安全静默降级', () => {
  const safe = createSafeStorage()
  assert.doesNotThrow(() => {
    safe.getItem('any-key')
    safe.setItem('any-key', 'value')
    safe.removeItem('any-key')
  })
})

test('ConsoleContext 声明正确的 WORKSPACE_STORAGE_KEY 并在 switchWorkspace 与加载时持久化工作空间记忆', async () => {
  const contextSource = await readFile(new URL('../../src/console/state/ConsoleContext.jsx', import.meta.url), 'utf8')
  assert.match(contextSource, /WORKSPACE_STORAGE_KEY\s*=\s*'readmate:console:last_workspace'/)
  assert.match(contextSource, /storage\.setItem\(\s*WORKSPACE_STORAGE_KEY,\s*workspaceId\s*\)/)
  assert.match(contextSource, /storage\.getItem\(\s*WORKSPACE_STORAGE_KEY\s*\)/)
  assert.match(contextSource, /createSafeStorage/)
})
