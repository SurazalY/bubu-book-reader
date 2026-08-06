import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const keyLength = 64
export const MAX_PASSWORD_LENGTH = 1024
const scryptParameters = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  maxMemory: 64 * 1024 * 1024,
}

function deriveKey(password, salt) {
  return scryptSync(password, salt, keyLength, {
    N: scryptParameters.cost,
    r: scryptParameters.blockSize,
    p: scryptParameters.parallelization,
    maxmem: scryptParameters.maxMemory,
  })
}

export function isPasswordInputAllowed(password) {
  return typeof password === 'string' && password.length > 0 && password.length <= MAX_PASSWORD_LENGTH
}

export function hashPassword(password) {
  if (!isPasswordInputAllowed(password)) {
    throw new Error(`密码必须为 1 到 ${MAX_PASSWORD_LENGTH} 个字符`)
  }

  const salt = randomBytes(16)
  const derived = deriveKey(password, salt)
  return [
    'scrypt',
    scryptParameters.cost,
    scryptParameters.blockSize,
    scryptParameters.parallelization,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

export function verifyPassword(password, encodedHash) {
  if (!isPasswordInputAllowed(password) || typeof encodedHash !== 'string') {
    return false
  }

  const [scheme, cost, blockSize, parallelization, encodedSalt, encodedDerived] = encodedHash.split('$')
  if (
    scheme !== 'scrypt' ||
    Number(cost) !== scryptParameters.cost ||
    Number(blockSize) !== scryptParameters.blockSize ||
    Number(parallelization) !== scryptParameters.parallelization ||
    !encodedSalt ||
    !encodedDerived
  ) {
    return false
  }

  try {
    const expected = Buffer.from(encodedDerived, 'base64url')
    const actual = deriveKey(password, Buffer.from(encodedSalt, 'base64url'))
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
