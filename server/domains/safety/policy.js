const DEFAULTS = Object.freeze({
  confidenceThreshold: 0.8,
  requiredQualifiedMessages: 3,
  minimumQualifiedMessages: 3,
  maximumQualifiedMessages: 5,
  reviewLeaseMs: 120000,
})

function validConfidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function createSafetyPolicy(overrides = {}) {
  const resolved = {
    ...DEFAULTS,
    ...overrides,
  }

  if (!validConfidence(resolved.confidenceThreshold)) {
    throw new TypeError('confidenceThreshold must be between 0 and 1')
  }
  if (!Number.isInteger(resolved.minimumQualifiedMessages) || !Number.isInteger(resolved.maximumQualifiedMessages)) {
    throw new TypeError('qualified message bounds must be integers')
  }
  if (resolved.minimumQualifiedMessages < 3 || resolved.maximumQualifiedMessages > 5 || resolved.minimumQualifiedMessages > resolved.maximumQualifiedMessages) {
    throw new TypeError('qualified message bounds must stay within 3 through 5')
  }
  if (!Number.isInteger(resolved.requiredQualifiedMessages) || resolved.requiredQualifiedMessages < resolved.minimumQualifiedMessages || resolved.requiredQualifiedMessages > resolved.maximumQualifiedMessages) {
    throw new TypeError('requiredQualifiedMessages must stay within the configured bounds')
  }
  if (!Number.isInteger(resolved.reviewLeaseMs) || resolved.reviewLeaseMs < 1) {
    throw new TypeError('reviewLeaseMs must be a positive integer')
  }

  return Object.freeze(resolved)
}

export function resolveSafetyPolicy(policy, context) {
  const candidate = typeof policy?.forOrganization === 'function' ? policy.forOrganization(context) : policy
  return createSafetyPolicy(candidate || {})
}

export function usesImmediateSafetyBypass(danger) {
  return Boolean(
    danger?.detected &&
      (danger.explicitSelfHarmPlan || danger.explicitSelfHarmTime || danger.explicitSelfHarmMeans || danger.extremeRisk || danger.urgency === 'critical'),
  )
}

export const DEFAULT_SAFETY_POLICY = createSafetyPolicy()
