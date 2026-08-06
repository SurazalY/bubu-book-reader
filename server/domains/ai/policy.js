const DEFAULTS = Object.freeze({
  maxContextTurns: 6,
  maxEvidenceSources: 8,
  maxProviderAttempts: 3,
  maxSpoilerRetries: 1,
  maxQuestionCharacters: 2000,
  maxSelectedBlockIds: 12,
  maxSelectionCharacters: 4000,
  idempotencyLeaseMs: 120000,
})

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value
}

export function createAiPolicy(overrides = {}) {
  const resolved = {
    ...DEFAULTS,
    ...overrides,
  }

  positiveInteger(resolved.maxContextTurns, 'maxContextTurns')
  positiveInteger(resolved.maxEvidenceSources, 'maxEvidenceSources')
  positiveInteger(resolved.maxProviderAttempts, 'maxProviderAttempts')
  positiveInteger(resolved.maxQuestionCharacters, 'maxQuestionCharacters')
  positiveInteger(resolved.maxSelectedBlockIds, 'maxSelectedBlockIds')
  positiveInteger(resolved.maxSelectionCharacters, 'maxSelectionCharacters')
  positiveInteger(resolved.idempotencyLeaseMs, 'idempotencyLeaseMs')

  if (!Number.isInteger(resolved.maxSpoilerRetries) || resolved.maxSpoilerRetries < 0 || resolved.maxSpoilerRetries > 1) {
    throw new TypeError('maxSpoilerRetries must be 0 or 1')
  }

  return Object.freeze(resolved)
}

export function resolveAiPolicy(policy, context) {
  const candidate = typeof policy?.forRequest === 'function' ? policy.forRequest(context) : policy
  return createAiPolicy(candidate || {})
}

export const DEFAULT_AI_POLICY = createAiPolicy()
