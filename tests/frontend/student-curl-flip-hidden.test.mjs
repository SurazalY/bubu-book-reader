import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('学生端默认翻页效果不是 curl，且 curl 分支运行时不可达', async () => {
  const [context, reader, settings] = await Promise.all([
    source('../../src/student/state/StudentContext.jsx'),
    source('../../src/student/pages/Reader.jsx'),
    source('../../src/student/pages/settings/AccountSettings.jsx'),
  ])

  assert.match(context, /flipStyle:\s*'slide'/)
  assert.doesNotMatch(context, /flipStyle:\s*'curl'/)

  assert.match(reader, /const STUDENT_CURL_FLIP_ENABLED = false/)
  assert.match(
    reader,
    /const curl = STUDENT_CURL_FLIP_ENABLED && prefs\.flipStyle === 'curl' && !prefs\.reduceMotion/,
  )
  assert.match(reader, /if \(curl && api\) \{[\s\S]*api\.flip\(t\)/)

  assert.doesNotMatch(reader, /key:\s*'flipStyle'/)
  assert.doesNotMatch(reader, /\{\s*k:\s*'curl',\s*t:\s*'三维翻页'\s*\}/)
  assert.doesNotMatch(settings, /FLIP_STYLES/)
  assert.doesNotMatch(settings, /label="翻页效果"/)
  assert.doesNotMatch(settings, /\{\s*k:\s*'curl',\s*t:\s*'三维翻页'\s*\}/)

  assert.match(reader, /<HTMLFlipBook\b/)
  assert.match(reader, /student-flip-shell/)
  assert.match(reader, /startPage=\{leaf\}/)
  assert.match(reader, /onInit=/)
  assert.match(reader, /reconcileFlipBootstrap/)
})
