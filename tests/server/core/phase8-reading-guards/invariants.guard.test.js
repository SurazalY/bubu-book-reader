import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { READING_LEASE_TTL_MS } from '../../../../server/domains/reading/monitoring.js'
import {
  assertNotRealDatabasePath,
  CATALOG_SOURCE_PATH,
  createHarness,
  FROZEN_READING_TABLES,
  MONITORING_SOURCE_PATH,
  REAL_DATABASE_PATH,
  ROUTER_SOURCE_PATH,
} from './shared-harness.guard.test.js'

const FROZEN_SUMMARY_SESSION_COLUMNS = [
  'id',
  'organization_id_at_creation',
  'actor_id_at_creation',
  'workspace_id_at_creation',
  'class_id_at_creation',
  'device_id',
  'book_version_id',
  'lease_id_at_start',
  'stat_date',
  'started_at',
  'latest_revision',
  'latest_fingerprint',
  'revision_fingerprints_json',
  'cumulative_effective_ms',
  'had_skip',
  'had_reread',
  'last_page_no',
  'measured_through_at',
  'ended_at',
  'end_reason',
  'status',
  'created_at',
  'updated_at',
  'version',
]

const FROZEN_DAILY_SUMMARY_COLUMNS = [
  'id',
  'organization_id_at_creation',
  'actor_id_at_creation',
  'workspace_id_at_creation',
  'class_id_at_creation',
  'book_version_id',
  'stat_date',
  'effective_reading_ms',
  'had_skip',
  'had_reread',
  'last_read_at',
  'last_page_no',
  'created_at',
  'updated_at',
  'version',
]

const OLD_VISIBILITY_GUARDS = [
  'tests/server/http/book-visibility-guard.test.js',
  'tests/server/http/book-visibility-revoke-guard.test.js',
  'tests/server/http/book-visibility-http.test.js',
]

test('不变量：守卫测试不接触真实业务库', (t) => {
  const harness = createHarness(t)
  assertNotRealDatabasePath(harness.databasePath)
  assert.notEqual(harness.databasePath, REAL_DATABASE_PATH)
})

test('不变量：冻结阅读摘要表 schema 不得被本阶段改动', (t) => {
  const harness = createHarness(t)
  const sessionColumns = harness.db.prepare('PRAGMA table_info(reading_summary_sessions)').all().map((row) => row.name)
  const dailyColumns = harness.db.prepare('PRAGMA table_info(reading_daily_book_summaries)').all().map((row) => row.name)
  assert.deepEqual(sessionColumns, FROZEN_SUMMARY_SESSION_COLUMNS)
  assert.deepEqual(dailyColumns, FROZEN_DAILY_SUMMARY_COLUMNS)
  assert.deepEqual(FROZEN_READING_TABLES, ['reading_summary_sessions', 'reading_daily_book_summaries'])
})

test('不变量：不得修改 90s TTL 常量与 renew / session-summaries 路由', () => {
  const catalog = readFileSync(CATALOG_SOURCE_PATH, 'utf8')
  const monitoring = readFileSync(MONITORING_SOURCE_PATH, 'utf8')
  const router = readFileSync(ROUTER_SOURCE_PATH, 'utf8')
  assert.equal(READING_LEASE_TTL_MS, 90 * 1000)
  assert.match(catalog, /90 \* 1000/, 'catalog.acquireLease 仍须使用 90 秒 TTL，不得改常量')
  assert.match(monitoring, /const LEASE_TTL_MS = 90 \* 1000/, 'monitoring 不得改 LEASE_TTL_MS')
  assert.match(router, /router\.post\('\/reading\/lease\/:leaseId\/renew'/, '不得改 renew 路由')
  assert.match(router, /router\.post\('\/reading\/session-summaries'/, '不得改 session-summaries 路由')
})

test('不变量：三份 visibility 文件由 T8.7 拥有，不再要求对初始 HEAD 干净', () => {
  for (const relativePath of OLD_VISIBILITY_GUARDS) {
    const source = readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), 'utf8')
    assert.ok(source.length > 0, `${relativePath} 必须仍存在`)
    assert.match(
      source,
      /book_access_grants|grantCurrentBookToClass|putClassShelfBook|class-local/,
      `${relativePath} 属 T8.7：必须保留默认全闭 / class-local 夹具，不得回退无 grant 可见`,
    )
    assert.doesNotMatch(
      source,
      /无 grants 即可见|without grants.*visible/i,
      `${relativePath} 不得回退「无 grants 可见」`,
    )
  }
})
