const TERMINAL_RESULTS = new Set(['accepted', 'replayed', 'superseded'])

function resultValue(response) {
  return response?.data?.result ?? response?.result ?? null
}

function queueError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}

export function createPendingQueue({ store, port, scope, onError, onPressure, onTerminal } = {}) {
  if (!store?.putBeforeRequest || !store?.list || !store?.remove) throw new TypeError('串行队列需要待确认存储端口')
  if (typeof port?.submitSummary !== 'function') throw new TypeError('串行队列需要submitSummary端口')
  let tail = Promise.resolve()
  let lastError = null
  const waiters = new Map()

  function notifyTerminal(key, response) {
    const pending = waiters.get(key) || []
    waiters.delete(key)
    pending.forEach((resolve) => resolve(response))
    onTerminal?.({ key, response })
  }

  async function drainDirect() {
    const records = await store.list(scope)
    let confirmed = 0
    for (const record of records) {
      try {
        const response = await port.submitSummary({
          summary: record.summary,
          idempotencyKey: record.idempotencyKey,
          scope,
        })
        const result = resultValue(response)
        if (!TERMINAL_RESULTS.has(result)) {
          const error = queueError('SUMMARY_CONFIRMATION_INVALID', '服务端未返回可确认的摘要终态')
          error.response = response
          lastError = error
          onError?.(error, record)
          return { confirmed, retained: records.length - confirmed, error }
        }
        await store.remove(record.key)
        confirmed += 1
        lastError = null
        notifyTerminal(record.key, response)
      } catch (error) {
        lastError = error
        onError?.(error, record)
        if (error?.code === 'LEASE_CONFLICT') {
          await store.remove(record.key)
          return { confirmed, retained: records.length - confirmed - 1, error }
        }
        return { confirmed, retained: records.length - confirmed, error }
      }
    }
    return { confirmed, retained: 0, error: null }
  }

  function exclusive(operation) {
    const task = tail.catch(() => undefined).then(operation)
    tail = task.catch(() => undefined)
    return task
  }

  async function persistAndDrainDirect(summary, idempotencyKey, createdAt) {
    let usage = await store.usage(scope)
    if (usage.pressure) {
      onPressure?.(usage)
      await drainDirect()
    }
    let persisted
    try {
      persisted = await store.putBeforeRequest({ scope, summary, idempotencyKey, createdAt })
    } catch (error) {
      if (error?.code !== 'PENDING_STORE_FULL') throw error
      onPressure?.(error.usage || usage)
      await drainDirect()
      persisted = await store.putBeforeRequest({ scope, summary, idempotencyKey, createdAt })
    }
    usage = persisted.usage
    if (usage.pressure) onPressure?.(usage)
    const drain = await drainDirect()
    const [present, usageAfterDrain] = await Promise.all([
      store.has(persisted.record.key),
      store.usage(scope),
    ])
    const confirmed = !drain.error && !present
    return { ...persisted, drain, confirmed, usageAfterDrain }
  }

  return Object.freeze({
    enqueue(summary, { idempotencyKey, createdAt } = {}) {
      if (typeof idempotencyKey !== 'string' || !idempotencyKey) {
        return Promise.reject(queueError('IDEMPOTENCY_KEY_REQUIRED', '阅读摘要必须使用稳定幂等键'))
      }
      return exclusive(() => persistAndDrainDirect(summary, idempotencyKey, createdAt))
    },
    drain() {
      return exclusive(drainDirect)
    },
    async waitForTerminal(key) {
      await tail.catch(() => undefined)
      if (!(await store.has(key))) return { result: 'already_confirmed' }
      return new Promise((resolve) => {
        const pending = waiters.get(key) || []
        pending.push(resolve)
        waiters.set(key, pending)
      })
    },
    getLastError() {
      return lastError
    },
    usage() {
      return store.usage(scope)
    },
  })
}

export { TERMINAL_RESULTS }
