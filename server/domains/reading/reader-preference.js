import { assertString, createDomainContext, isoNow, one, run } from './sql.js'

function domainError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requirePublishedBookVersion(db, organizationId, bookVersionId) {
  const book = one(db, `SELECT version.id AS book_version_id
    FROM book_versions AS version
    JOIN books AS book ON book.id = version.book_id
      AND book.organization_id_at_creation = version.organization_id_at_creation
    WHERE version.id = :bookVersionId
      AND version.organization_id_at_creation = :organizationId
      AND book.organization_id_at_creation = :organizationId
      AND book.status = 'published'`, { organizationId, bookVersionId })
  if (!book) throw domainError('RESOURCE_NOT_FOUND', '书籍不存在或不在当前组织')
  return book
}

export function createReaderPreferenceDomain(dependencies = {}) {
  const context = createDomainContext(dependencies)

  async function upsertPreference(input = {}) {
    const organizationId = assertString(context.workspace?.organizationId, 'workspace.organizationId')
    const userId = assertString(context.actor?.id, 'actor.id')
    const allowed = await context.authorize({
      actor: context.actor,
      workspace: context.workspace,
      action: 'reading.read_self',
      resource: { ownerId: userId },
    })
    if (!allowed) throw domainError('PERMISSION_DENIED', '当前工作空间无权写入阅读模式偏好')

    const bookVersionId = assertString(input.bookVersionId, 'bookVersionId')
    const mode = assertString(input.mode, 'mode')
    if (mode !== 'original' && mode !== 'text') {
      throw new TypeError('mode 只允许 original 或 text')
    }
    requirePublishedBookVersion(context.db, organizationId, bookVersionId)
    const updatedAt = isoNow(context)
    run(context.db, `INSERT INTO reader_mode_preferences (
        organization_id, user_id, book_version_id, mode, updated_at
      ) VALUES (:organizationId, :userId, :bookVersionId, :mode, :updatedAt)
      ON CONFLICT(user_id, book_version_id) DO UPDATE SET
        mode = excluded.mode,
        updated_at = excluded.updated_at`, {
      organizationId,
      userId,
      bookVersionId,
      mode,
      updatedAt,
    })
    return { userId, bookVersionId, mode, updatedAt }
  }

  return { upsertPreference }
}
