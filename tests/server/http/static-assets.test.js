import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createReadmateApplication } from '../../../server/app.js'

function temporaryRuntime() {
  const root = mkdtempSync(join(tmpdir(), 'readmate-static-assets-'))
  const distDirectory = join(root, 'dist')
  const publicAssetDirectory = join(root, 'public')
  const coverDirectory = join(publicAssetDirectory, 'books', 'public-domain-book')
  mkdirSync(distDirectory, { recursive: true })
  mkdirSync(coverDirectory, { recursive: true })
  writeFileSync(join(distDirectory, 'index.html'), '<!doctype html><title>readmate</title>')
  const coverBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
  writeFileSync(join(coverDirectory, 'cover_original.jpg'), coverBytes)
  return {
    root,
    databasePath: join(root, 'readmate.sqlite'),
    distDirectory,
    publicAssetDirectory,
    coverBytes,
  }
}

test('书籍资产不再由公开静态路径暴露，受保护端点要求会话', async (context) => {
  const runtime = temporaryRuntime()
  const application = createReadmateApplication({
    databasePath: runtime.databasePath,
    sessionSecret: 'static-assets-test-session-secret-0123456789',
    cookieSecure: false,
    distDirectory: runtime.distDirectory,
    publicAssetDirectory: runtime.publicAssetDirectory,
  })
  const server = application.app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    application.close()
    rmSync(runtime.root, { recursive: true, force: true })
  })

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const cover = await fetch(`${baseUrl}/books/public-domain-book/cover_original.jpg`)
  assert.equal(cover.status, 404)
  assert.notEqual(cover.headers.get('content-type'), 'text/html; charset=utf-8')

  const protectedAsset = await fetch(`${baseUrl}/api/v1/books/assets/asset-id`)
  assert.equal(protectedAsset.status, 401)

  const missing = await fetch(`${baseUrl}/books/public-domain-book/missing.jpg`)
  assert.equal(missing.status, 404)
  assert.notEqual(missing.headers.get('content-type'), 'text/html; charset=utf-8')
})
