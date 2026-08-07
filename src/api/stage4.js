import { createApiClient } from './client.js'

const UNAVAILABLE_SURFACES = Object.freeze({
  eyeCare: {
    code: 'CONSOLE_EYECARE_API_UNAVAILABLE',
    message: '教师与学校范围护眼状态尚无真实 API，当前页面不可用。',
  },
  sessions: {
    code: 'CONSOLE_STUDENT_SESSIONS_API_UNAVAILABLE',
    message: '跨学生会话读取尚无真实 API，当前页面不可用。',
  },
  privacy: {
    code: 'CONSOLE_PRIVACY_ACCESS_API_UNAVAILABLE',
    message: '隐私申请与访问历史尚无真实 API，当前页面不可用。',
  },
})

const SURFACE_LOADERS = Object.freeze({
  safetyList: { method: 'listSafetyEvents', collection: true },
  studentList: { method: 'listStudents', collection: true },
  classList: { method: 'listClasses', collection: true },
  classDetail: { method: 'getClass', resource: true },
  studentDetail: { method: 'getStudent', resource: true },
  classOverview: { method: 'listClasses', collection: true },
  bookLibrary: { method: 'listBooks', collection: true },
  bookDetail: { method: 'getBook', resource: true },
})

function itemsOf(response) {
  return Array.isArray(response?.data?.items) ? response.data.items : []
}

function groupClasses(students) {
  const classes = new Map()
  for (const student of students) {
    if (!student?.classId) continue
    const current = classes.get(student.classId) || {
      id: student.classId,
      name: student.className || student.classId,
      studentCount: 0,
      students: [],
    }
    current.students.push(student)
    current.studentCount = current.students.length
    classes.set(student.classId, current)
  }
  return [...classes.values()]
    .map((entry) => ({
      ...entry,
      students: entry.students.sort((left, right) =>
        String(left.displayName || left.id).localeCompare(String(right.displayName || right.id), 'zh-CN')),
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id), 'en'))
}

function unavailable(reason) {
  return { status: 'unavailable', data: null, reason, meta: {} }
}

function requireResourceId(surface, resourceId) {
  if (resourceId) return
  throw new TypeError(`${surface} requires resourceId`)
}

export function createStage4ConsoleApi(client = createApiClient()) {
  const api = {
    listSafetyEvents: (options = {}) => client.get('/safety/events', {
      ...options,
      query: { limit: 100, ...(options.query || {}) },
    }),
    listStudents: (options = {}) => client.get('/students', options),
    getStudent: (studentId, options = {}) => client.get(`/users/${encodeURIComponent(studentId)}`, options),
    listBooks: (options = {}) => client.get('/books', {
      ...options,
      query: { limit: 100, ...(options.query || {}) },
    }),
    async listClasses(options = {}) {
      const response = await api.listStudents(options)
      return {
        data: { items: groupClasses(itemsOf(response)) },
        meta: response.meta || {},
      }
    },
    async getClass(classId, options = {}) {
      const response = await api.listClasses(options)
      return {
        data: itemsOf(response).find((entry) => entry.id === classId) || null,
        meta: response.meta || {},
      }
    },
    async getBook(bookId, options = {}) {
      const response = await api.listBooks(options)
      return {
        data: itemsOf(response).find((entry) => entry.id === bookId) || null,
        meta: response.meta || {},
      }
    },
    async loadSurface(surface, { workspaceId, resourceId, query, signal } = {}) {
      if (!workspaceId) {
        return unavailable({
          code: 'WORKSPACE_REQUIRED',
          message: '当前会话没有可用工作空间，无法请求真实 API。',
        })
      }
      if (UNAVAILABLE_SURFACES[surface]) return unavailable(UNAVAILABLE_SURFACES[surface])

      const loader = SURFACE_LOADERS[surface]
      if (!loader) {
        return unavailable({
          code: 'CONSOLE_SURFACE_UNAVAILABLE',
          message: '该控制台页面没有已冻结的真实 API 接线。',
        })
      }
      if (loader.resource) requireResourceId(surface, resourceId)

      const options = { workspaceId }
      if (query) options.query = query
      if (signal) options.signal = signal
      const response = loader.resource
        ? await api[loader.method](resourceId, options)
        : await api[loader.method](options)
      const data = response.data ?? null
      const empty = loader.collection ? itemsOf(response).length === 0 : data === null
      return {
        status: empty ? 'empty' : 'ready',
        data,
        reason: null,
        meta: response.meta || {},
      }
    },
  }

  return api
}
