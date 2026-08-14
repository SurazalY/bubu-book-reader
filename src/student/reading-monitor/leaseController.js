function leaseError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}

function unwrapLease(response) {
  const lease = response?.data ?? response
  const leaseId = lease?.leaseId ?? lease?.id
  const expiresAt = lease?.expiresAt
  const expiresAtMs = Date.parse(expiresAt)
  if (typeof leaseId !== 'string' || !leaseId || !Number.isFinite(expiresAtMs)) {
    throw leaseError('LEASE_RESPONSE_INVALID', '阅读租约响应缺少有效leaseId或expiresAt')
  }
  return Object.freeze({ ...lease, leaseId, expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs })
}

function defaultScheduler() {
  return {
    setTimeout(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs)
    },
    clearTimeout(timer) {
      globalThis.clearTimeout(timer)
    },
  }
}

export function createLeaseController({
  clock,
  port,
  scope,
  bookVersionId,
  idFactory,
  scheduler = defaultScheduler(),
  onLease,
  onInvalid,
  onError,
} = {}) {
  if (!clock?.wallNow) throw new TypeError('租约控制器需要可注入墙钟')
  if (typeof port?.acquireLease !== 'function' || typeof port?.renewLease !== 'function') {
    throw new TypeError('租约端口必须提供acquireLease和renewLease')
  }
  if (typeof idFactory !== 'function') throw new TypeError('租约控制器需要稳定幂等键生成器')

  let lease = null
  let timer = null
  let generation = 0
  let retryStage = 0
  let acquireKey = null
  let renewalKey = null
  let stopped = false
  let operation = Promise.resolve()
  const retryThresholdsMs = [30_000, 15_000, 5_000]

  function clearTimer() {
    if (timer != null) scheduler.clearTimeout(timer)
    timer = null
  }

  function invalidate(reason, error = null, invalidatedAtMs = clock.wallNow()) {
    if (!lease) return
    clearTimer()
    const previous = lease
    const explicitInvalidatedAtMs = Number(invalidatedAtMs)
    const authoritativeInvalidatedAtMs = Math.min(
      previous.expiresAtMs,
      Number.isFinite(explicitInvalidatedAtMs) ? explicitInvalidatedAtMs : clock.wallNow(),
    )
    lease = null
    generation += 1
    onInvalid?.({ reason, lease: previous, error, invalidatedAtMs: authoritativeInvalidatedAtMs })
  }

  function schedule() {
    clearTimer()
    if (stopped || !lease) return
    const remaining = lease.expiresAtMs - clock.wallNow()
    if (remaining <= 0) {
      invalidate('lease_ended', leaseError('LEASE_REQUIRED', '阅读租约已过期'), lease.expiresAtMs)
      return
    }
    const threshold = retryThresholdsMs[Math.min(retryStage, retryThresholdsMs.length - 1)]
    const delay = Math.max(0, remaining - threshold)
    const scheduledGeneration = generation
    timer = scheduler.setTimeout(() => {
      timer = null
      if (scheduledGeneration !== generation || stopped || !lease) return
      operation = operation.catch(() => undefined).then(renew)
    }, delay)
  }

  async function renew() {
    if (stopped || !lease) return null
    if (lease.expiresAtMs <= clock.wallNow()) {
      invalidate('lease_ended', leaseError('LEASE_REQUIRED', '阅读租约已过期'), lease.expiresAtMs)
      return null
    }
    const current = lease
    try {
      const response = await port.renewLease({
        schemaVersion: 1,
        leaseId: current.leaseId,
        bookVersionId,
        scope,
        idempotencyKey: renewalKey ||= idFactory(`reading-lease-renew:${current.leaseId}:${current.expiresAt}`),
      })
      if (lease?.leaseId !== current.leaseId || stopped) return lease
      lease = unwrapLease(response)
      retryStage = 0
      renewalKey = null
      generation += 1
      onLease?.(lease)
      schedule()
      return lease
    } catch (error) {
      if (lease?.leaseId !== current.leaseId || stopped) return null
      onError?.(error)
      if (error?.code === 'LEASE_CONFLICT') {
        invalidate('lease_taken_over', error, clock.wallNow())
        return null
      }
      if (error?.code === 'LEASE_REQUIRED') {
        invalidate('lease_ended', error, clock.wallNow())
        return null
      }
      retryStage += 1
      if (retryStage >= retryThresholdsMs.length) {
        const remaining = current.expiresAtMs - clock.wallNow()
        clearTimer()
        timer = scheduler.setTimeout(() => {
          timer = null
          if (lease?.leaseId === current.leaseId && lease.expiresAtMs <= clock.wallNow()) {
            invalidate('lease_ended', error, current.expiresAtMs)
          } else {
            schedule()
          }
        }, Math.max(0, remaining))
      } else {
        schedule()
      }
      return null
    }
  }

  async function start() {
    stopped = false
    acquireKey ||= idFactory(`reading-lease-acquire:${bookVersionId}`)
    const response = await port.acquireLease({
      schemaVersion: 1,
      bookVersionId,
      scope,
      idempotencyKey: acquireKey,
    })
    lease = unwrapLease(response)
    retryStage = 0
    renewalKey = null
    generation += 1
    onLease?.(lease)
    schedule()
    return lease
  }

  return Object.freeze({
    start,
    renewNow() {
      operation = operation.catch(() => undefined).then(renew)
      return operation
    },
    stop() {
      stopped = true
      clearTimer()
      generation += 1
      lease = null
    },
    current() {
      if (lease && lease.expiresAtMs <= clock.wallNow()) {
        invalidate('lease_ended', leaseError('LEASE_REQUIRED', '阅读租约已过期'), lease.expiresAtMs)
      }
      return lease
    },
    isValid() {
      return Boolean(lease && lease.expiresAtMs > clock.wallNow())
    },
  })
}
