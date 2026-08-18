import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createStudentApi } from '../../src/api/student.js'
import { toStudentRuntimeDto } from '../../src/adapters/student.js'

const readerUrl = new URL('../../src/student/pages/Reader.jsx', import.meta.url)
const adapterUrl = new URL('../../src/adapters/student.js', import.meta.url)
const apiUrl = new URL('../../src/api/student.js', import.meta.url)

function recordingClient() {
  const calls = []
  return {
    calls,
    client: {
      put(path, options) {
        calls.push({ method: 'PUT', path, options })
        return Promise.resolve({ data: { mode: options.body?.mode }, meta: {} })
      },
    },
  }
}

test('toBook 映射 preferredReaderMode，非法值回落 null，且不写进 progress', () => {
  const runtime = toStudentRuntimeDto({
    session: { user: { id: 'student-1', displayName: '偏好学生' }, activeWorkspaceId: 'workspace-1' },
    books: {
      items: [
        {
          id: 'book-text',
          versionId: 'version-text',
          title: '有偏好',
          assets: [{ kind: 'source_pdf', url: '/api/v1/books/assets/pdf-1' }],
          progress: { currentPage: 2, totalPages: 10, bookmarks: [] },
          access: { readable: true },
          lists: [],
          classReading: null,
          preferredReaderMode: 'text',
        },
        {
          id: 'book-empty',
          versionId: 'version-empty',
          title: '无偏好',
          assets: [{ kind: 'source_pdf', url: '/api/v1/books/assets/pdf-2' }],
          progress: { currentPage: 1, totalPages: 8, bookmarks: [] },
          access: { readable: true },
          lists: [],
          classReading: null,
        },
        {
          id: 'book-invalid',
          versionId: 'version-invalid',
          title: '非法偏好',
          preferredReaderMode: 'pdf',
          readerMode: 'text',
          progress: { currentPage: 1, totalPages: 3, bookmarks: [] },
        },
      ],
    },
    progress: { items: [] },
    eyeCare: {},
  })

  assert.equal(runtime.books[0].preferredReaderMode, 'text')
  assert.equal(runtime.books[1].preferredReaderMode, null)
  assert.equal(runtime.books[2].preferredReaderMode, null)
  assert.equal(Object.hasOwn(runtime.books[0].progress, 'preferredReaderMode'), false)
  assert.equal(Object.hasOwn(runtime.books[0].progress, 'mode'), false)
})

test('学生 API PUT /reading/reader-preference 带幂等键，且不转发他人 userId', async () => {
  const recorder = recordingClient()
  const api = createStudentApi(recorder.client)
  await api.putReaderPreference(
    {
      bookVersionId: 'version-1',
      mode: 'text',
      userId: 'other-student',
    },
    { workspaceId: 'workspace-1', idempotencyKey: 'reader-preference:test-1' },
  )
  assert.deepEqual(recorder.calls, [{
    method: 'PUT',
    path: '/reading/reader-preference',
    options: {
      workspaceId: 'workspace-1',
      idempotencyKey: 'reader-preference:test-1',
      body: { bookVersionId: 'version-1', mode: 'text' },
    },
  }])
})

test('Reader 打开时服务端偏好覆盖默认，切换时 fire-and-forget，且不落本地存储', async () => {
  const [reader, adapter, api] = await Promise.all([
    readFile(readerUrl, 'utf8'),
    readFile(adapterUrl, 'utf8'),
    readFile(apiUrl, 'utf8'),
  ])

  assert.match(reader, /const \[readerMode, setReaderMode\] = useState\(sourcePdf \? 'original' : 'text'\)/)
  assert.match(reader, /book\.preferredReaderMode/)
  assert.match(reader, /putReaderPreference/)
  assert.match(reader, /\.catch\(\(\) => undefined\)/)
  assert.doesNotMatch(reader, /await\s+studentApi\.putReaderPreference/)
  assert.doesNotMatch(reader, /localStorage|sessionStorage|indexedDB|IndexedDB/)
  assert.doesNotMatch(reader, /book_change/)

  assert.match(adapter, /preferredReaderMode/)
  assert.match(api, /client\.put\('\/reading\/reader-preference'/)
  assert.match(api, /idempotencyKey: options\.idempotencyKey \|\| writeIdempotencyKey\('reader-preference'\)/)
})
