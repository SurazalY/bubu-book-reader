import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { resolveRuntimeListenOptions } from '../../server/runtime-options.js'

test('server defaults to loopback and only changes host through an explicit override', () => {
  assert.deepEqual(resolveRuntimeListenOptions({}), { host: '127.0.0.1', port: 5191 })
  assert.deepEqual(resolveRuntimeListenOptions({ HOST: '0.0.0.0', PORT: '5291' }), { host: '0.0.0.0', port: 5291 })
  assert.deepEqual(resolveRuntimeListenOptions({ HOST: '   ', PORT: 'not-a-port' }), { host: '127.0.0.1', port: 5191 })
})

test('root and server packages declare the node:sqlite runtime floor', async () => {
  const [rootPackage, serverPackage] = await Promise.all([
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../../server/package.json', import.meta.url), 'utf8'),
  ])
  assert.equal(JSON.parse(rootPackage).engines.node, '>=22.16.0')
  assert.equal(JSON.parse(serverPackage).engines.node, '>=22.16.0')
})
