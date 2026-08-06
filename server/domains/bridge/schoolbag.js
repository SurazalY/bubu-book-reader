import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { assertPositiveInteger, assertString, createDomainContext, isoNow, one, run, transaction } from '../reading/sql.js'

const requiredClaims = ['issuer', 'audience', 'subject', 'deviceId', 'bookId', 'returnUri', 'issuedAt', 'expiresAt', 'nonce']
const DEFAULT_MAX_TOKEN_TTL_MS = 5 * 60 * 1000
const MAX_CONFIGURABLE_TOKEN_TTL_MS = 15 * 60 * 1000
const DEFAULT_FUTURE_SKEW_MS = 30 * 1000

export function createSchoolbagBridge(dependencies) {
  const context = createDomainContext(dependencies)
  const verifier = dependencies.verifySignedToken || ((token) => verifyHmacToken(token, dependencies.signingKey))
  const returnUriAllowed = createReturnUriValidator(dependencies)
  const maxTokenTtlMs = dependencies.maxTokenTtlMs ?? DEFAULT_MAX_TOKEN_TTL_MS
  const maxFutureSkewMs = dependencies.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS
  if (!Number.isInteger(maxTokenTtlMs) || maxTokenTtlMs < 1000 || maxTokenTtlMs > MAX_CONFIGURABLE_TOKEN_TTL_MS) {
    throw new TypeError('maxTokenTtlMs 必须是 1 秒到 15 分钟内的整数')
  }
  if (!Number.isInteger(maxFutureSkewMs) || maxFutureSkewMs < 0 || maxFutureSkewMs > 60 * 1000) {
    throw new TypeError('maxFutureSkewMs 必须是 0 到 60 秒内的整数')
  }

  async function expectedDeviceId() {
    const value = typeof dependencies.expectedDeviceId === 'function'
      ? await dependencies.expectedDeviceId({ actor: context.actor, workspace: context.workspace })
      : dependencies.expectedDeviceId || dependencies.device?.id
    return assertString(value, 'expectedDeviceId')
  }

  async function expectedSubjectId() {
    const value = typeof dependencies.expectedSubjectId === 'function'
      ? await dependencies.expectedSubjectId({ actor: context.actor, workspace: context.workspace })
      : dependencies.expectedSubjectId || context.actor?.id
    return assertString(value, 'expectedSubjectId')
  }

  const actorId = () => assertString(context.actor?.id, 'actor.id')
  const workspaceId = () => assertString(context.workspace?.id, 'workspace.id')
  const organizationId = () => assertString(context.workspace?.organizationId, 'workspace.organizationId')

  async function authorize(action, resource) {
    const allowed = await context.authorize({ actor: context.actor, workspace: context.workspace, action, resource })
    if (!allowed) {
      const error = new Error('桥接目标权限不足')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  return {
    async verifyLaunchToken(token) {
      const normalizedToken = assertString(token, 'token')
      const claims = await verifier(normalizedToken)
      const runtimeDeviceId = await expectedDeviceId()
      const runtimeSubjectId = await expectedSubjectId()
      await validateClaims(claims, context.now(), {
        runtimeDeviceId, runtimeSubjectId, maxTokenTtlMs, maxFutureSkewMs, returnUriAllowed,
      })
      const client = one(context.db, `SELECT * FROM integration_clients
        WHERE issuer = :issuer AND audience = :audience AND active = 1`, { issuer: claims.issuer, audience: claims.audience })
      if (!client) {
        const error = new Error('未登记或已停用的桥接客户端')
        error.code = 'INTEGRATION_CLIENT_DENIED'
        throw error
      }
      await authorize('integration.launch', {
        subjectId: claims.subject, deviceId: claims.deviceId, bookId: claims.bookId,
        pageNo: claims.pageNo, classSessionId: claims.classSessionId,
      })
      const result = transaction(context.db, () => {
        const existing = one(context.db, `SELECT id FROM integration_launch_tokens
          WHERE client_id = :clientId AND nonce = :nonce`, { clientId: client.id, nonce: claims.nonce })
        if (existing) {
          const error = new Error('桥接令牌已被使用')
          error.code = 'TOKEN_REPLAYED'
          throw error
        }
        const now = isoNow(context)
        const launchId = context.idFactory()
        run(context.db, `INSERT INTO integration_launch_tokens (id, client_id, nonce, subject_id, device_id, expires_at, used_at, created_at, updated_at, version)
          VALUES (:id, :clientId, :nonce, :subjectId, :deviceId, :expiresAt, :now, :now, :now, 1)`, {
          id: context.idFactory(), clientId: client.id, nonce: claims.nonce, subjectId: claims.subject,
          deviceId: claims.deviceId, expiresAt: new Date(claims.expiresAt).toISOString(), now,
        })
        run(context.db, `INSERT INTO integration_launches (id, client_id, subject_id, device_id, book_id, page_no, class_session_id, return_uri, launched_at, created_at, updated_at, version)
          VALUES (:id, :clientId, :subjectId, :deviceId, :bookId, :pageNo, :classSessionId, :returnUri, :now, :now, :now, 1)`, {
          id: launchId, clientId: client.id, subjectId: claims.subject, deviceId: claims.deviceId,
          bookId: claims.bookId, pageNo: claims.pageNo || null,
          classSessionId: claims.classSessionId || null, returnUri: claims.returnUri, now,
        })
        run(context.db, `INSERT INTO integration_launch_scopes
            (launch_id, client_id, organization_id, workspace_id, actor_id, subject_student_id,
              class_session_id, book_id, device_id, token_nonce, token_fingerprint, created_at)
          VALUES (:launchId, :clientId, :organizationId, :workspaceId, :actorId, :subjectId,
            :classSessionId, :bookId, :deviceId, :nonce, :tokenFingerprint, :now)`, {
          launchId, clientId: client.id, organizationId: organizationId(), workspaceId: workspaceId(), actorId: actorId(),
          subjectId: claims.subject, classSessionId: claims.classSessionId || null, bookId: claims.bookId,
          deviceId: claims.deviceId, nonce: claims.nonce, tokenFingerprint: tokenFingerprint(normalizedToken), now,
        })
        return { launchId, context: launchContext(claims, launchId) }
      })
      await context.audit({ eventType: 'integration.schoolbag.token.verified', actorId: context.actor?.id, workspaceId: context.workspace?.id, resourceId: result.launchId })
      return result
    },

    async recordReturn(input) {
      const launchId = assertString(input.launchId, 'launchId')
      const normalizedToken = assertString(input.token, 'token')
      const claims = await verifier(normalizedToken)
      const runtimeDeviceId = await expectedDeviceId()
      const runtimeSubjectId = await expectedSubjectId()
      await validateClaims(claims, context.now(), {
        runtimeDeviceId, runtimeSubjectId, maxTokenTtlMs, maxFutureSkewMs, returnUriAllowed,
      })
      const client = one(context.db, `SELECT * FROM integration_clients
        WHERE issuer = :issuer AND audience = :audience AND active = 1`, { issuer: claims.issuer, audience: claims.audience })
      if (!client) {
        const error = new Error('未登记或已停用的桥接客户端')
        error.code = 'INTEGRATION_CLIENT_DENIED'
        throw error
      }
      const scope = {
        launchId,
        clientId: client.id,
        organizationId: organizationId(),
        workspaceId: workspaceId(),
        actorId: actorId(),
        subjectId: runtimeSubjectId,
        classSessionId: claims.classSessionId || null,
        bookId: claims.bookId,
        deviceId: claims.deviceId,
        nonce: claims.nonce,
        tokenFingerprint: tokenFingerprint(normalizedToken),
        returnUri: claims.returnUri,
      }
      const launch = getScopedLaunch(context.db, scope)
      if (!launch) throw scopedLaunchNotFound()
      if (launch.returned_at) {
        const error = new Error('桥接启动记录已经完成写回')
        error.code = 'RETURN_ALREADY_RECORDED'
        throw error
      }
      await authorize('integration.return', { subjectId: launch.subject_id, deviceId: launch.device_id, bookId: launch.book_id, launchId })
      const now = isoNow(context)
      const pageNo = input.pageNo === undefined || input.pageNo === null ? null : assertPositiveInteger(input.pageNo, 'pageNo')
      const eyeCareState = input.eyeCareState === undefined || input.eyeCareState === null
        ? null
        : assertString(input.eyeCareState, 'eyeCareState')
      const result = run(context.db, `UPDATE integration_launches SET returned_at = :now, return_payload_json = :payloadJson,
        updated_at = :now, version = version + 1
        WHERE id = :launchId AND client_id = :clientId AND subject_id = :subjectId
          AND device_id = :deviceId AND book_id = :bookId
          AND COALESCE(class_session_id, '') = COALESCE(:classSessionId, '')
          AND return_uri = :returnUri AND returned_at IS NULL
          AND EXISTS (
            SELECT 1 FROM integration_launch_scopes scope
            WHERE scope.launch_id = integration_launches.id AND scope.client_id = :clientId
              AND scope.organization_id = :organizationId AND scope.workspace_id = :workspaceId
              AND scope.actor_id = :actorId AND scope.subject_student_id = :subjectId
              AND COALESCE(scope.class_session_id, '') = COALESCE(:classSessionId, '')
              AND scope.book_id = :bookId AND scope.device_id = :deviceId
              AND scope.token_nonce = :nonce AND scope.token_fingerprint = :tokenFingerprint
          )`, {
        ...scope, now, payloadJson: JSON.stringify({ pageNo, eyeCareState }),
      })
      if (result.changes !== 1) throw scopedLaunchNotFound()
      await context.audit({ eventType: 'integration.schoolbag.return.recorded', actorId: context.actor?.id, workspaceId: context.workspace?.id, resourceId: launchId })
      return { returnUri: launch.return_uri, launchId }
    },
  }
}

export function createSchoolbagSimulator({ signingKey, now = () => new Date() }) {
  if (typeof signingKey !== 'string' || signingKey.length < 16) throw new TypeError('本地模拟器需要运行时注入至少 16 字符的 signingKey')
  return {
    issue(claims) {
      const issuedAt = claims.issuedAt || now().toISOString()
      const expiresAt = claims.expiresAt || new Date(new Date(issuedAt).getTime() + 5 * 60 * 1000).toISOString()
      return signHmacToken({ ...claims, issuedAt, expiresAt }, signingKey)
    },
  }
}

function launchContext(claims, launchId) {
  return {
    launchId,
    subject: claims.subject,
    deviceId: claims.deviceId,
    bookId: claims.bookId,
    pageNo: claims.pageNo || null,
    classSessionId: claims.classSessionId || null,
    returnUri: claims.returnUri,
  }
}

async function validateClaims(claims, now, options) {
  if (!claims || typeof claims !== 'object') throw new TypeError('桥接令牌载荷无效')
  for (const claim of requiredClaims) assertString(claims[claim], `token.${claim}`)
  if (claims.pageNo !== undefined && claims.pageNo !== null) assertPositiveInteger(claims.pageNo, 'token.pageNo')
  const issuedAt = new Date(claims.issuedAt)
  const expiresAt = new Date(claims.expiresAt)
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime()) || issuedAt >= expiresAt) throw new TypeError('桥接令牌时间范围无效')
  if (issuedAt.getTime() > now.getTime() + options.maxFutureSkewMs) {
    const error = new Error('桥接令牌签发时间明显晚于服务端时间')
    error.code = 'TOKEN_ISSUED_IN_FUTURE'
    throw error
  }
  if (expiresAt.getTime() - issuedAt.getTime() > options.maxTokenTtlMs) {
    const error = new Error('桥接令牌有效期超过短期上限')
    error.code = 'TOKEN_TTL_EXCEEDED'
    throw error
  }
  if (expiresAt <= now) {
    const error = new Error('桥接令牌已过期')
    error.code = 'TOKEN_EXPIRED'
    throw error
  }
  if (claims.deviceId !== options.runtimeDeviceId) {
    const error = new Error('桥接令牌绑定设备与当前设备不一致')
    error.code = 'TOKEN_DEVICE_MISMATCH'
    throw error
  }
  if (claims.subject !== options.runtimeSubjectId) {
    const error = new Error('桥接令牌 subject 与当前学生不一致')
    error.code = 'TOKEN_SUBJECT_MISMATCH'
    throw error
  }
  if (!(await options.returnUriAllowed(claims.returnUri, claims))) {
    const error = new Error('returnUri 不在当前运行环境允许范围内')
    error.code = 'RETURN_URI_DENIED'
    throw error
  }
}

function getScopedLaunch(db, scope) {
  return one(db, `SELECT launch.* FROM integration_launches launch
    JOIN integration_launch_scopes scope ON scope.launch_id = launch.id
    WHERE launch.id = :launchId AND launch.client_id = :clientId AND launch.subject_id = :subjectId
      AND launch.device_id = :deviceId AND launch.book_id = :bookId
      AND COALESCE(launch.class_session_id, '') = COALESCE(:classSessionId, '')
      AND launch.return_uri = :returnUri
      AND scope.client_id = :clientId AND scope.organization_id = :organizationId
      AND scope.workspace_id = :workspaceId AND scope.actor_id = :actorId
      AND scope.subject_student_id = :subjectId
      AND COALESCE(scope.class_session_id, '') = COALESCE(:classSessionId, '')
      AND scope.book_id = :bookId AND scope.device_id = :deviceId
      AND scope.token_nonce = :nonce AND scope.token_fingerprint = :tokenFingerprint`, scope)
}

function scopedLaunchNotFound() {
  const error = new Error('桥接启动记录不存在于当前不可变作用域')
  error.code = 'RESOURCE_NOT_FOUND'
  return error
}

function tokenFingerprint(token) {
  return createHash('sha256').update(token).digest('hex')
}

function createReturnUriValidator(dependencies) {
  if (typeof dependencies.isReturnUriAllowed === 'function') return dependencies.isReturnUriAllowed
  if (Array.isArray(dependencies.allowedReturnUris) && dependencies.allowedReturnUris.length > 0) {
    const allowed = new Set(dependencies.allowedReturnUris.map((value) => assertString(value, 'allowedReturnUri')))
    return (returnUri) => allowed.has(returnUri)
  }
  throw new TypeError('桥接必须由运行时注入 allowedReturnUris 或 isReturnUriAllowed')
}

function signHmacToken(claims, signingKey) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyHmacToken(token, signingKey) {
  if (typeof signingKey !== 'string' || signingKey.length < 16) throw new TypeError('生产桥接需要从运行时注入 signingKey 或 verifySignedToken')
  const [payload, signature, extra] = String(token).split('.')
  if (!payload || !signature || extra) throw new TypeError('桥接令牌格式无效')
  const expected = createHmac('sha256', signingKey).update(payload).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    const error = new Error('桥接令牌签名无效')
    error.code = 'TOKEN_SIGNATURE_INVALID'
    throw error
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}
