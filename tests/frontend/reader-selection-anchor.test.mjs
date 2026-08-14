import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const gestureSource = fs.readFileSync(path.join(repoRoot, 'src/student/hooks/useReaderGesture.js'), 'utf8')
const footprintSource = fs.readFileSync(path.join(repoRoot, 'src/student/pages/Footprint.jsx'), 'utf8')

test('reader quote text and offsets share the same raw DOM source', () => {
  assert.match(gestureSource, /prefix\.cloneContents\(\)\.textContent/)
  assert.match(gestureSource, /const selectedSource = blockText\.slice\(rawStartOffset, rawEndOffset\)/)
  assert.match(gestureSource, /const endOffset = startOffset \+ text\.length/)
  assert.doesNotMatch(gestureSource, /before(?:Start|End)\.toString\(\)\.length/)
})

test('reading footprint renders the strict streak day unit instead of an undefined DTO field', () => {
  assert.match(footprintSource, /`\$\{data\.streakDays\} 天`/)
  assert.doesNotMatch(footprintSource, /data\.unit/)
})
