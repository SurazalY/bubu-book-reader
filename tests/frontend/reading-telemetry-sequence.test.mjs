import assert from 'node:assert/strict'
import test from 'node:test'

import { initialOfflineSequence } from '../../src/student/state/useReadingTelemetry.js'

test('阅读器刷新后从服务端租约返回的下一离线序号继续写入', () => {
  assert.equal(initialOfflineSequence({ nextOfflineSequence: 1 }), 0)
  assert.equal(initialOfflineSequence({ data: { nextOfflineSequence: 4 } }), 3)
  assert.equal(initialOfflineSequence({ nextOfflineSequence: 7 }), 6)
  assert.throws(() => initialOfflineSequence({}), /下一离线序号/)
  assert.throws(() => initialOfflineSequence({ nextOfflineSequence: 0 }), /下一离线序号/)
})
