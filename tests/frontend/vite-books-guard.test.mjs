import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const configUrl = new URL('../../vite.config.js', import.meta.url)

test('Vite dev 只拦截 /books/*，不拦 logo 与其它公开静态资源', async () => {
  const config = await readFile(configUrl, 'utf8')

  assert.match(config, /configureServer/)
  assert.match(config, /block-public-books-in-dev/)
  assert.match(config, /path === '\/books' \|\| path\.startsWith\('\/books\/'\)/)
  assert.doesNotMatch(config, /startsWith\('\/covers\/'\)/)
  assert.doesNotMatch(config, /publicDir:\s*false/)
})
