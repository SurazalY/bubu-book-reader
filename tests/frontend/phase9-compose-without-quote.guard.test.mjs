/**
 * T1-1 守卫 G1-8：发帖前端不得再出现引文选择 UI / 「原文」字样，publishDraft 不得再校验 quote。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function readSource(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8')
}

function extractNamedCallback(source, name) {
  const needle = `${name} = useCallback`
  const start = source.indexOf(needle)
  assert.ok(start >= 0, `${name} 必须仍存在`)
  const open = source.indexOf('{', start)
  assert.ok(open >= 0, `${name} 必须有函数体`)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  assert.fail(`无法截取 ${name} 函数体`)
}

test('G1-8 Compose.jsx 不得再出现引文选择 UI 或「原文」字样', () => {
  const compose = readSource('src/student/pages/Compose.jsx')
  assert.equal(compose.includes('原文'), false, 'Compose.jsx 不得再出现「原文」字样')
  assert.equal(compose.includes('student-quote-pick'), false, 'Compose.jsx 不得再保留引文选择 UI（student-quote-pick）')
  assert.equal(compose.includes('选一条书中引文'), false, 'Compose.jsx 不得再把引文当作发布必填项')
  assert.equal(compose.includes('reader.highlights'), false, 'Compose.jsx 不得再从 highlights 列出引文候选')
  assert.equal(/quotes\.map\(/.test(compose), false, 'Compose.jsx 不得再渲染引文选择列表')
})

test('G1-8 useCommunity.js 的 publishDraft 不得再校验 quote', () => {
  const community = readSource('src/student/state/useCommunity.js')
  const publishDraft = extractNamedCallback(community, 'publishDraft')
  assert.equal(/draft\.quote/.test(publishDraft), false, 'publishDraft 不得再读取或校验 draft.quote')
  assert.equal(publishDraft.includes('请选择书中引文'), false, 'publishDraft 不得再因缺引文拦截发布')
  assert.equal(/quote\s*:/.test(publishDraft), false, 'publishDraft 提交体不得再携带 quote')
})
