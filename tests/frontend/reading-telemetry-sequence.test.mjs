import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { initialOfflineSequence, legacyPageTurnPayload } from '../../src/student/state/useReadingTelemetry.js'

test('阅读器刷新后从服务端租约返回的下一离线序号继续写入', () => {
  assert.equal(initialOfflineSequence({ nextOfflineSequence: 1 }), 0)
  assert.equal(initialOfflineSequence({ data: { nextOfflineSequence: 4 } }), 3)
  assert.equal(initialOfflineSequence({ nextOfflineSequence: 7 }), 6)
  assert.throws(() => initialOfflineSequence({}), /下一离线序号/)
  assert.throws(() => initialOfflineSequence({ nextOfflineSequence: 0 }), /下一离线序号/)
})

test('新monitor的movement source不得泄漏到旧page_turn payload', async () => {
  assert.deepEqual(
    legacyPageTurnPayload({ fromPageNo: 1, toPageNo: 2, source: 'student_adjacent', unknown: true }),
    { fromPageNo: 1, direction: 'next' },
  )
  assert.deepEqual(legacyPageTurnPayload({ fromPageNo: 4, toPageNo: 3 }), { fromPageNo: 4, direction: 'previous' })
  assert.throws(() => legacyPageTurnPayload({ fromPageNo: 0, toPageNo: 1 }), /起止页码/)
  const source = await readFile(new URL('../../src/student/state/useReadingTelemetry.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /payload:\s*\{[^}]*\bsource\b[^}]*\}/s)
  assert.match(source, /coordinator\?\.move\(stableView,\s*movementEvent\.source\)/)
})
