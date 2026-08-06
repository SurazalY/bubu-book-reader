import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { HttpError } from '../../../server/db/errors.js'
import { runMigrations } from '../../../server/db/migrate.js'
import {
  createIdempotencyRequestHash,
  executeIdempotentAsync,
  reconcileIdempotency,
} from '../../../server/db/reliability.js'
import { defaultMigrationDirectory } from '../../../server/domains/identity/index.js'

function createTemporaryDatabase(prefix = 'readmate-fencing-') {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  return { directory, filename: join(directory, 'core.sqlite') }
}

function removeTemporaryDatabase(database) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const candidate = `${database.filename}${suffix}`
    if (existsSync(candidate)) {
      unlinkSync(candidate)
    }
  }
  rmSync(database.directory, { recursive: true, force: true })
}

function createClock(initial = '2026-08-06T00:00:00.000Z') {
  let timestamp = new Date(initial).getTime()
  return {
    now: () => new Date(timestamp).toISOString(),
    advance: (milliseconds) => {
      timestamp += milliseconds
      return new Date(timestamp).toISOString()
    },
  }
}

function leaseLost(error) {
  return error?.code === 'IDEMPOTENCY_LEASE_LOST'
}

function insertLegacyIdentityData(database) {
  const now = '2026-08-06T00:00:00.000Z'
  const organizationAId = randomUUID()
  const organizationBId = randomUUID()
  const userAId = randomUUID()
  const workspaceAId = randomUUID()
  const workspaceBId = randomUUID()
  const missingWorkspaceId = randomUUID()
  const missingOrganizationId = randomUUID()
  const missingOrganizationUserId = randomUUID()
  const missingOrganizationWorkspaceId = randomUUID()
  const unscopedWorkspaceId = randomUUID()
  database
    .prepare('INSERT INTO organizations (id, name, status, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)')
    .run(organizationAId, 'migration-school-a', 'active', now, now)
  database
    .prepare('INSERT INTO organizations (id, name, status, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)')
    .run(organizationBId, 'migration-school-b', 'active', now, now)
  database
    .prepare(`
      INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1)
    `)
    .run(userAId, organizationAId, `migration-user-${randomUUID()}`, 'migration-user', now, now)
  const insertWorkspace = database.prepare(`
    INSERT INTO workspaces (
      id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version
    ) VALUES (?, ?, 'school-admin', ?, 'school', ?, 'active', ?, ?, 1)
  `)
  insertWorkspace.run(workspaceAId, organizationAId, 'migration-workspace-a', organizationAId, now, now)
  insertWorkspace.run(workspaceBId, organizationBId, 'migration-workspace-b', organizationBId, now, now)

  const insertAssignment = database.prepare(`
    INSERT INTO role_assignments (
      id, user_id, workspace_id, role_code, scope_type, scope_id, status, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'school_admin', 'school', ?, 'active', ?, ?, 1)
  `)
  insertAssignment.run(randomUUID(), userAId, workspaceAId, organizationAId, now, now)
  insertAssignment.run(randomUUID(), userAId, workspaceBId, organizationBId, now, now)
  insertAssignment.run(randomUUID(), userAId, workspaceAId, organizationBId, now, now)
  database.exec('PRAGMA foreign_keys = OFF;')
  insertAssignment.run(randomUUID(), randomUUID(), workspaceAId, organizationAId, now, now)
  insertAssignment.run(randomUUID(), userAId, missingWorkspaceId, organizationAId, now, now)
  database
    .prepare(`
      INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'missing-organization-user', 'active', ?, ?, 1)
    `)
    .run(missingOrganizationUserId, missingOrganizationId, `missing-org-user-${randomUUID()}`, now, now)
  insertWorkspace.run(
    missingOrganizationWorkspaceId,
    missingOrganizationId,
    'missing-organization-workspace',
    missingOrganizationId,
    now,
    now,
  )
  insertAssignment.run(
    randomUUID(),
    missingOrganizationUserId,
    missingOrganizationWorkspaceId,
    missingOrganizationId,
    now,
    now,
  )
  database
    .prepare(`
      INSERT INTO workspaces (
        id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version
      ) VALUES (?, NULL, 'platform-ops', 'unscoped-workspace', 'platform', 'platform', 'active', ?, ?, 1)
    `)
    .run(unscopedWorkspaceId, now, now)
  database
    .prepare(`
      INSERT INTO role_assignments (
        id, user_id, workspace_id, role_code, scope_type, scope_id, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, 'platform_ops', 'platform', 'platform', 'active', ?, ?, 1)
    `)
    .run(randomUUID(), userAId, unscopedWorkspaceId, now, now)
  database.exec('PRAGMA foreign_keys = ON;')

  return { organizationAId, userAId, workspaceAId }
}

function insertLegacyProcessing(database, key, operation, now = '2026-08-06T00:00:00.000Z') {
  database
    .prepare(`
      INSERT INTO idempotency_records (
        id, scope_key, idempotency_key, request_hash, status_code, response_json, session_id,
        created_at, updated_at, version, state, lease_token, lease_expires_at, attempt_count
      ) VALUES (?, 'test.legacy', ?, ?, 202, ?, NULL, ?, ?, 1, 'processing', ?, ?, 1)
    `)
    .run(
      randomUUID(),
      key,
      createIdempotencyRequestHash({ operation }),
      JSON.stringify({ data: { status: 'processing' } }),
      now,
      now,
      `legacy-owner-${randomUUID()}`,
      '2026-08-06T00:05:00.000Z',
    )
}

test('005 quarantines invalid role assignments and makes legacy processing reconciliation-only', async () => {
  const temporary = createTemporaryDatabase('readmate-migration-005-')
  const migrationDirectory = join(temporary.directory, 'migrations')
  const sourceDirectory = defaultMigrationDirectory()
  mkdirSync(migrationDirectory)
  for (const filename of readdirSync(sourceDirectory).filter((filename) => /^00[0-3]_/.test(filename))) {
    copyFileSync(join(sourceDirectory, filename), join(migrationDirectory, filename))
  }
  const database = openSqliteDatabase(temporary.filename)
  try {
    runMigrations(database, migrationDirectory)
    const identity = insertLegacyIdentityData(database)
    insertLegacyProcessing(database, 'legacy-not-started', 'legacy-not-started')
    insertLegacyProcessing(database, 'legacy-completed-externally', 'legacy-completed-externally')

    for (const filename of [
      '004_idempotency_lifecycle_and_scope_integrity.sql',
      '005_organization_roles_and_idempotency_fencing.sql',
    ]) {
      copyFileSync(join(sourceDirectory, filename), join(migrationDirectory, filename))
    }
    const upgraded = runMigrations(database, migrationDirectory)
    assert.deepEqual(upgraded.applied, [
      '004_idempotency_lifecycle_and_scope_integrity.sql',
      '005_organization_roles_and_idempotency_fencing.sql',
    ])

    const validAssignments = database
      .prepare('SELECT organization_id, user_id, workspace_id, scope_id FROM role_assignments')
      .all()
    assert.equal(validAssignments.length, 1)
    assert.equal(validAssignments[0].organization_id, identity.organizationAId)
    assert.equal(validAssignments[0].user_id, identity.userAId)
    assert.equal(validAssignments[0].workspace_id, identity.workspaceAId)
    assert.equal(validAssignments[0].scope_id, identity.organizationAId)
    const quarantineReasons = database
      .prepare('SELECT reason FROM role_assignment_quarantine ORDER BY reason')
      .all()
      .map((record) => record.reason)
    assert.deepEqual(quarantineReasons, [
      'actor_missing',
      'organization_mismatch',
      'organization_missing',
      'scope_mismatch',
      'workspace_missing',
      'workspace_unscoped',
    ])

    const legacyRecords = database
      .prepare(`
        SELECT idempotency_key, state, reconciliation_required, retryable, lease_owner, provider_reference
        FROM idempotency_records
        WHERE scope_key = 'test.legacy'
        ORDER BY idempotency_key
      `)
      .all()
      .map((record) => ({ ...record }))
    assert.deepEqual(legacyRecords, [
      {
        idempotency_key: 'legacy-completed-externally',
        state: 'unknown',
        reconciliation_required: 1,
        retryable: 0,
        lease_owner: null,
        provider_reference: null,
      },
      {
        idempotency_key: 'legacy-not-started',
        state: 'unknown',
        reconciliation_required: 1,
        retryable: 0,
        lease_owner: null,
        provider_reference: null,
      },
    ])

    let ordinaryWorkerExecutions = 0
    const blocked = await executeIdempotentAsync(database, {
      key: 'legacy-not-started',
      scope: 'test.legacy',
      request: { operation: 'legacy-not-started' },
      operation: async () => {
        ordinaryWorkerExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRun: true } } }
      },
    })
    assert.equal(blocked.state, 'unknown')
    assert.equal(ordinaryWorkerExecutions, 0)

    assert.throws(
      () =>
        reconcileIdempotency(database, {
          key: 'legacy-not-started',
          scope: 'test.legacy',
          request: { operation: 'legacy-not-started' },
          resolution: {
            state: 'failed',
            statusCode: 503,
            code: 'LEGACY_CONFIRMED_NOT_STARTED',
            message: '已确认旧操作未产生外部副作用',
            retryable: true,
          },
        }),
      /sideEffectStatus/,
    )
    assert.throws(
      () =>
        reconcileIdempotency(database, {
          key: 'legacy-not-started',
          scope: 'test.legacy',
          request: { operation: 'legacy-not-started' },
          resolution: {
            state: 'failed',
            statusCode: 503,
            code: 'LEGACY_CONFIRMED_NOT_STARTED',
            message: '已确认旧操作未产生外部副作用',
            retryable: true,
            sideEffectStatus: 'not_started',
          },
        }),
      /evidenceReference/,
    )
    const noSideEffectEvidence = `reconciliation-${randomUUID()}`
    reconcileIdempotency(database, {
      key: 'legacy-not-started',
      scope: 'test.legacy',
      request: { operation: 'legacy-not-started' },
      resolution: {
        state: 'failed',
        statusCode: 503,
        code: 'LEGACY_CONFIRMED_NOT_STARTED',
        message: '已确认旧操作未产生外部副作用',
        retryable: true,
        sideEffectStatus: 'not_started',
        evidenceReference: noSideEffectEvidence,
      },
    })
    assert.equal(
      database.prepare("SELECT provider_reference FROM idempotency_records WHERE idempotency_key = 'legacy-not-started'").get()
        .provider_reference,
      noSideEffectEvidence,
    )
    const retried = await executeIdempotentAsync(database, {
      key: 'legacy-not-started',
      scope: 'test.legacy',
      request: { operation: 'legacy-not-started' },
      operation: async () => {
        ordinaryWorkerExecutions += 1
        return { statusCode: 200, payload: { data: { retried: true } } }
      },
    })
    assert.equal(retried.state, 'succeeded')
    assert.equal(ordinaryWorkerExecutions, 1)

    assert.throws(
      () =>
        reconcileIdempotency(database, {
          key: 'legacy-completed-externally',
          scope: 'test.legacy',
          request: { operation: 'legacy-completed-externally' },
          resolution: {
            state: 'succeeded',
            sideEffectStatus: 'completed',
            outcome: { statusCode: 200, payload: { data: { completed: true } } },
          },
        }),
      /providerReference/,
    )
    const providerReference = `provider-${randomUUID()}`
    const reconciled = reconcileIdempotency(database, {
      key: 'legacy-completed-externally',
      scope: 'test.legacy',
      request: { operation: 'legacy-completed-externally' },
      resolution: {
        state: 'succeeded',
        sideEffectStatus: 'completed',
        providerReference,
        outcome: { statusCode: 200, payload: { data: { completed: true } } },
      },
    })
    assert.equal(reconciled.state, 'succeeded')
    assert.equal(
      database
        .prepare("SELECT provider_reference FROM idempotency_records WHERE idempotency_key = 'legacy-completed-externally'")
        .get().provider_reference,
      providerReference,
    )
  } finally {
    database.close()
    removeTemporaryDatabase(temporary)
  }
})

test('fencing epochs reject stale and expired workers while allowing pre-effect renewal', async () => {
  const temporary = createTemporaryDatabase()
  const database = openSqliteDatabase(temporary.filename)
  try {
    runMigrations(database, defaultMigrationDirectory())
    const columns = database.prepare('PRAGMA table_info(idempotency_records)').all().map((record) => record.name)
    assert.ok(columns.includes('lease_owner'))
    assert.ok(columns.includes('lease_epoch'))
    assert.ok(columns.includes('lease_until'))

    const reclaimClock = createClock()
    let releaseOldComplete
    const oldCompleteRelease = new Promise((resolve) => {
      releaseOldComplete = resolve
    })
    let signalOldComplete
    const oldCompleteStarted = new Promise((resolve) => {
      signalOldComplete = resolve
    })
    let oldCompleteContext
    const oldComplete = executeIdempotentAsync(database, {
      key: 'fencing-stale-complete',
      scope: 'test.fencing',
      request: { operation: 'stale-complete' },
      leaseMs: 1_000,
      now: reclaimClock.now,
      operation: async (context) => {
        oldCompleteContext = context
        signalOldComplete()
        await oldCompleteRelease
        return { statusCode: 200, payload: { data: { worker: 'old' } } }
      },
    })
    await oldCompleteStarted
    reclaimClock.advance(1_001)
    let newCompleteContext
    const newComplete = await executeIdempotentAsync(database, {
      key: 'fencing-stale-complete',
      scope: 'test.fencing',
      request: { operation: 'stale-complete' },
      leaseMs: 1_000,
      now: reclaimClock.now,
      operation: async (context) => {
        newCompleteContext = context
        return { statusCode: 200, payload: { data: { worker: 'new' } } }
      },
    })
    assert.equal(newComplete.state, 'succeeded')
    assert.equal(newCompleteContext.leaseEpoch, oldCompleteContext.leaseEpoch + 1)
    assert.notEqual(newCompleteContext.leaseOwner, oldCompleteContext.leaseOwner)
    releaseOldComplete()
    await assert.rejects(oldComplete, leaseLost)

    const staleMarkClock = createClock('2026-08-06T01:00:00.000Z')
    let releaseOldMark
    const oldMarkRelease = new Promise((resolve) => {
      releaseOldMark = resolve
    })
    let signalOldMark
    const oldMarkStarted = new Promise((resolve) => {
      signalOldMark = resolve
    })
    const oldMark = executeIdempotentAsync(database, {
      key: 'fencing-stale-mark',
      scope: 'test.fencing',
      request: { operation: 'stale-mark' },
      leaseMs: 1_000,
      now: staleMarkClock.now,
      operation: async ({ markExternalSideEffectStarted }) => {
        signalOldMark()
        await oldMarkRelease
        markExternalSideEffectStarted()
        return { statusCode: 200, payload: { data: { worker: 'old' } } }
      },
    })
    await oldMarkStarted
    staleMarkClock.advance(1_001)
    await executeIdempotentAsync(database, {
      key: 'fencing-stale-mark',
      scope: 'test.fencing',
      request: { operation: 'stale-mark' },
      leaseMs: 1_000,
      now: staleMarkClock.now,
      operation: async () => ({ statusCode: 200, payload: { data: { worker: 'new' } } }),
    })
    releaseOldMark()
    await assert.rejects(oldMark, leaseLost)

    async function assertStaleFailureAfterReclaim(key, createFailure) {
      const clock = createClock(`2026-08-06T0${key.length % 8}:30:00.000Z`)
      let releaseOldWorker
      const oldWorkerRelease = new Promise((resolve) => {
        releaseOldWorker = resolve
      })
      let signalOldWorker
      const oldWorkerStarted = new Promise((resolve) => {
        signalOldWorker = resolve
      })
      let oldContext
      const oldWorker = executeIdempotentAsync(database, {
        key,
        scope: 'test.fencing.stale-failure',
        request: { operation: key },
        leaseMs: 1_000,
        now: clock.now,
        operation: async (context) => {
          oldContext = context
          signalOldWorker()
          await oldWorkerRelease
          throw createFailure()
        },
      })
      await oldWorkerStarted
      clock.advance(1_001)
      let newContext
      await executeIdempotentAsync(database, {
        key,
        scope: 'test.fencing.stale-failure',
        request: { operation: key },
        leaseMs: 1_000,
        now: clock.now,
        operation: async (context) => {
          newContext = context
          return { statusCode: 200, payload: { data: { worker: 'new' } } }
        },
      })
      assert.equal(newContext.leaseEpoch, oldContext.leaseEpoch + 1)
      releaseOldWorker()
      await assert.rejects(oldWorker, leaseLost)
    }

    await assertStaleFailureAfterReclaim(
      'fencing-stale-fail',
      () => new HttpError(503, 'UPSTREAM_NOT_STARTED', '上游确认未开始', { retryable: true }),
    )
    await assertStaleFailureAfterReclaim('fencing-stale-unknown', () => new Error('unclassified stale worker failure'))

    async function assertExpiredMutation(key, operation) {
      const clock = createClock(`2026-08-06T0${key.length % 8}:00:00.000Z`)
      await assert.rejects(
        executeIdempotentAsync(database, {
          key,
          scope: 'test.fencing.expired',
          request: { operation: key },
          leaseMs: 1_000,
          now: clock.now,
          operation: (context) => operation(context, clock),
        }),
        leaseLost,
      )
      return { clock }
    }

    await assertExpiredMutation('expired-mark', ({ markExternalSideEffectStarted }, clock) => {
      clock.advance(1_001)
      markExternalSideEffectStarted()
      return { statusCode: 200, payload: { data: {} } }
    })
    await assertExpiredMutation('expired-complete', (context, clock) => {
      clock.advance(1_001)
      return { statusCode: 200, payload: { data: {} } }
    })
    await assertExpiredMutation('expired-fail', (context, clock) => {
      clock.advance(1_001)
      throw new HttpError(503, 'UPSTREAM_NOT_STARTED', '上游确认未开始', { retryable: true })
    })
    const unknownClock = createClock('2026-08-06T10:00:00.000Z')
    await assert.rejects(
      executeIdempotentAsync(database, {
        key: 'expired-unknown',
        scope: 'test.fencing.expired',
        request: { operation: 'expired-unknown' },
        leaseMs: 1_000,
        now: unknownClock.now,
        operation: async ({ markExternalSideEffectStarted }) => {
          markExternalSideEffectStarted()
          unknownClock.advance(1_001)
          throw new Error('outcome unknown after lease expiry')
        },
      }),
      leaseLost,
    )
    let expiredUnknownRetryExecutions = 0
    const blockedExpiredUnknown = await executeIdempotentAsync(database, {
      key: 'expired-unknown',
      scope: 'test.fencing.expired',
      request: { operation: 'expired-unknown' },
      leaseMs: 1_000,
      now: unknownClock.now,
      operation: async () => {
        expiredUnknownRetryExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRun: true } } }
      },
    })
    assert.equal(blockedExpiredUnknown.state, 'unknown')
    assert.equal(blockedExpiredUnknown.reconciliationRequired, true)
    assert.equal(expiredUnknownRetryExecutions, 0)

    const renewalClock = createClock('2026-08-06T11:00:00.000Z')
    const renewed = await executeIdempotentAsync(database, {
      key: 'fencing-renew-before-effect',
      scope: 'test.fencing',
      request: { operation: 'renew-before-effect' },
      leaseMs: 1_000,
      now: renewalClock.now,
      operation: async ({ leaseEpoch, leaseUntil, renewLease, markExternalSideEffectStarted }) => {
        renewalClock.advance(500)
        const renewedLease = renewLease(2_000)
        assert.equal(renewedLease.leaseEpoch, leaseEpoch)
        assert.ok(renewedLease.leaseUntil > leaseUntil)
        markExternalSideEffectStarted()
        assert.throws(() => renewLease(2_000), (error) => error?.code === 'IDEMPOTENCY_LEASE_RENEWAL_FORBIDDEN')
        return { statusCode: 200, payload: { data: { renewed: true } } }
      },
    })
    assert.equal(renewed.state, 'succeeded')
  } finally {
    database.close()
    removeTemporaryDatabase(temporary)
  }
})
