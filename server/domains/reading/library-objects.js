import { withTransaction } from '../../db/database.js'
import { all, assertPositiveInteger, assertString, createDomainContext, isoNow, one, run } from './sql.js'

const annotationColors = new Set(['violet', 'amber', 'green', 'blue', 'rose'])

const objectDefinitions = {
  bookmark: {
    table: 'student_bookmarks',
    resourceType: 'student_bookmark',
    eventPrefix: 'reading.bookmark',
    map: mapBookmark,
  },
  excerpt: {
    table: 'student_saved_excerpts',
    resourceType: 'student_saved_excerpt',
    eventPrefix: 'reading.excerpt',
    map: mapExcerpt,
  },
  annotation: {
    table: 'student_annotations',
    resourceType: 'student_annotation',
    eventPrefix: 'reading.annotation',
    map: mapAnnotation,
  },
}

function domainError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function nonNegativeInteger(value, name, defaultValue = 0) {
  const candidate = value === undefined ? defaultValue : value
  if (!Number.isInteger(candidate) || candidate < 0) throw new TypeError(`${name} 必须是非负整数`)
  return candidate
}

function boundedText(value, name, maximum, { required = false, defaultValue = '' } = {}) {
  const candidate = value === undefined || value === null ? defaultValue : value
  if (typeof candidate !== 'string') throw new TypeError(`${name} 必须是字符串`)
  const normalized = candidate.trim()
  if (required && !normalized) throw new TypeError(`${name} 不能为空`)
  if (normalized.length > maximum) throw new TypeError(`${name} 不能超过 ${maximum} 个字符`)
  return normalized
}

function optionalAnchor(input) {
  const blockId = input.blockId === undefined || input.blockId === null
    ? null
    : boundedText(input.blockId, 'blockId', 255, { required: true })
  const charStart = input.charStart === undefined || input.charStart === null
    ? null
    : nonNegativeInteger(input.charStart, 'charStart')
  const charEnd = input.charEnd === undefined || input.charEnd === null
    ? null
    : nonNegativeInteger(input.charEnd, 'charEnd')
  const hasAnyAnchor = blockId !== null || charStart !== null || charEnd !== null
  const hasCompleteAnchor = blockId !== null && charStart !== null && charEnd !== null
  if (hasAnyAnchor && !hasCompleteAnchor) throw new TypeError('blockId、charStart 与 charEnd 必须同时提供')
  if (charStart !== null && charEnd < charStart) throw new TypeError('charEnd 不能小于 charStart')
  return { blockId, charStart, charEnd }
}

function mapFavorite(row) {
  return {
    id: row.id,
    bookId: row.book_id ?? null,
    bookVersionId: row.book_version_id,
    title: row.title ?? null,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

function mapList(row, items = []) {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    items,
  }
}

function mapListItem(row) {
  return {
    id: row.id,
    listId: row.list_id,
    bookId: row.book_id ?? null,
    bookVersionId: row.book_version_id,
    title: row.title ?? null,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

function mapBookmark(row) {
  return {
    id: row.id,
    bookId: row.book_id ?? null,
    bookVersionId: row.book_version_id,
    title: row.title ?? null,
    pageNo: row.page_no,
    label: row.label,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

function mapExcerpt(row) {
  return {
    id: row.id,
    bookId: row.book_id ?? null,
    bookVersionId: row.book_version_id,
    title: row.title ?? null,
    pageNo: row.page_no,
    blockId: row.block_id,
    charStart: row.char_start,
    charEnd: row.char_end,
    quoteText: row.quote_text,
    note: row.note,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

function mapAnnotation(row) {
  return {
    id: row.id,
    bookId: row.book_id ?? null,
    bookVersionId: row.book_version_id,
    title: row.title ?? null,
    pageNo: row.page_no,
    blockId: row.block_id,
    charStart: row.char_start,
    charEnd: row.char_end,
    quoteText: row.quote_text,
    body: row.body,
    color: row.color,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

function scopeValues(context) {
  return {
    organizationId: assertString(context.workspace?.organizationId, 'workspace.organizationId'),
    workspaceId: assertString(context.workspace?.id, 'workspace.id'),
    actorId: assertString(context.actor?.id, 'actor.id'),
  }
}

function requireActiveScope(db, scope) {
  const active = one(db, `SELECT membership.id
    FROM workspace_memberships membership
    JOIN users actor ON actor.id = membership.user_id
      AND actor.organization_id = :organizationId AND actor.status = 'active'
    JOIN workspaces workspace ON workspace.id = membership.workspace_id
      AND workspace.organization_id = :organizationId AND workspace.status = 'active'
    WHERE membership.user_id = :actorId AND membership.workspace_id = :workspaceId
      AND membership.status = 'active'`, scope)
  if (!active) throw domainError('RESOURCE_NOT_FOUND', '当前学生阅读空间不存在或已停用')
}

function requireBookVersion(db, scope, bookVersionId) {
  const normalizedId = assertString(bookVersionId, 'bookVersionId')
  const book = one(db, `SELECT version.id AS book_version_id, book.id AS book_id, book.title
    FROM book_versions version
    JOIN books book ON book.id = version.book_id
      AND book.organization_id_at_creation = version.organization_id_at_creation
    WHERE version.id = :bookVersionId
      AND version.organization_id_at_creation = :organizationId
      AND book.organization_id_at_creation = :organizationId
      AND book.status = 'published'
      AND :workspaceId <> '' AND :actorId <> ''`, { ...scope, bookVersionId: normalizedId })
  if (!book) throw domainError('RESOURCE_NOT_FOUND', '书籍不存在或不在当前组织')
  return book
}

function requirePage(db, scope, bookVersionId, pageNo, quoteText = '', anchor = null) {
  const pageNumber = assertPositiveInteger(pageNo, 'pageNo')
  requireBookVersion(db, scope, bookVersionId)
  const page = one(db, `SELECT page.id, page.text_content
    FROM book_pages page
    JOIN book_versions version ON version.id = page.book_version_id
    JOIN books book ON book.id = version.book_id
    WHERE page.book_version_id = :bookVersionId AND page.page_no = :pageNo
      AND version.organization_id_at_creation = :organizationId
      AND book.organization_id_at_creation = :organizationId
      AND book.status = 'published' AND :workspaceId <> '' AND :actorId <> ''`, {
    ...scope, bookVersionId, pageNo: pageNumber,
  })
  if (!page) throw domainError('RESOURCE_NOT_FOUND', '书页不存在或不在当前组织')
  if (quoteText && !page.text_content.includes(quoteText)) {
    throw domainError('VALIDATION_FAILED', '摘录或批注引用必须来自当前书页正文')
  }
  if (anchor?.blockId !== null) {
    const block = one(db, `SELECT block.id, block.text_content
      FROM book_blocks block
      WHERE block.id = :blockId AND block.page_id = :pageId`, {
      blockId: anchor.blockId,
      pageId: page.id,
    })
    if (!block || block.text_content.slice(anchor.charStart, anchor.charEnd) !== quoteText) {
      throw domainError('VALIDATION_FAILED', '摘录或批注锚点必须精确匹配当前书页正文块')
    }
  }
  return page
}

function ownedRow(db, table, id, scope) {
  return one(db, `SELECT * FROM ${table}
    WHERE id = :id AND organization_id = :organizationId
      AND workspace_id = :workspaceId AND actor_id = :actorId`, { ...scope, id })
}

function assertOwnedVersion(db, table, id, expectedVersion, scope) {
  const version = assertPositiveInteger(expectedVersion, 'expectedVersion')
  const record = ownedRow(db, table, assertString(id, 'id'), scope)
  if (!record) throw domainError('RESOURCE_NOT_FOUND', '阅读对象不存在或不属于当前学生')
  if (record.version !== version) {
    throw domainError('VERSION_CONFLICT', '阅读对象已被更新，请刷新后重试', { currentVersion: record.version })
  }
  return record
}

function auditInTransaction(context, scope, event) {
  const result = context.audit({
    ...event,
    actorId: scope.actorId,
    actorUserId: scope.actorId,
    workspaceId: scope.workspaceId,
    scopeSnapshot: scope,
  })
  if (result && typeof result.then === 'function') {
    const error = new TypeError('学生阅读对象事务中的 audit 必须是同步数据库操作')
    error.code = 'ASYNC_TRANSACTION_CALLBACK'
    throw error
  }
}

function objectSelect(table) {
  return `SELECT object.*, version.book_id, book.title
    FROM ${table} object
    JOIN book_versions version ON version.id = object.book_version_id
      AND version.organization_id_at_creation = object.organization_id
    JOIN books book ON book.id = version.book_id
      AND book.organization_id_at_creation = object.organization_id
    WHERE object.organization_id = :organizationId
      AND object.workspace_id = :workspaceId AND object.actor_id = :actorId`
}

export function createStudentLibraryDomain(dependencies = {}) {
  const context = createDomainContext(dependencies)
  const runInTransaction = dependencies.transactionRunner || ((operation) => withTransaction(context.db, operation))

  async function authorizeScope(resource = {}) {
    const scope = scopeValues(context)
    const allowed = await context.authorize({
      actor: context.actor,
      workspace: context.workspace,
      action: 'reading.read_self',
      resource: { ownerId: scope.actorId, ...resource },
    })
    if (!allowed) throw domainError('PERMISSION_DENIED', '当前工作空间无权访问学生阅读对象')
    requireActiveScope(context.db, scope)
    return scope
  }

  function readFavorite(id, scope) {
    const row = one(context.db, `${objectSelect('student_book_favorites')} AND object.id = :id`, { ...scope, id })
    if (!row) throw domainError('RESOURCE_NOT_FOUND', '喜欢记录不存在或不属于当前学生')
    return mapFavorite(row)
  }

  function readList(id, scope) {
    const row = ownedRow(context.db, 'student_reading_lists', id, scope)
    if (!row) throw domainError('RESOURCE_NOT_FOUND', '书单不存在或不属于当前学生')
    const items = all(context.db, `${objectSelect('student_reading_list_items')}
      AND object.list_id = :id ORDER BY object.position, object.created_at, object.id`, { ...scope, id }).map(mapListItem)
    return mapList(row, items)
  }

  function readListItem(id, scope) {
    const row = one(context.db, `${objectSelect('student_reading_list_items')}
      AND object.id = :id AND EXISTS (
        SELECT 1 FROM student_reading_lists list
        WHERE list.id = object.list_id AND list.organization_id = :organizationId
          AND list.workspace_id = :workspaceId AND list.actor_id = :actorId
      )`, { ...scope, id })
    if (!row) throw domainError('RESOURCE_NOT_FOUND', '书单条目不存在或不属于当前学生')
    return mapListItem(row)
  }

  function readObject(kind, id, scope) {
    const definition = objectDefinitions[kind]
    const row = one(context.db, `${objectSelect(definition.table)} AND object.id = :id`, { ...scope, id })
    if (!row) throw domainError('RESOURCE_NOT_FOUND', '阅读对象不存在或不属于当前学生')
    return definition.map(row)
  }

  async function getSnapshot() {
    const scope = await authorizeScope()
    const shelf = all(context.db, `SELECT
        book.id AS book_id, book.title, version.id AS book_version_id, version.page_count,
        progress.last_page_no, progress.updated_from_event_at,
        favorite.id AS favorite_id, favorite.version AS favorite_version,
        (SELECT GROUP_CONCAT(assignment.id, char(31)) FROM reading_assignments assignment
          WHERE assignment.organization_id_at_creation = :organizationId
            AND assignment.workspace_id_at_creation = :workspaceId
            AND assignment.book_version_id = version.id) AS arrangement_ids,
        (SELECT asset.storage_key FROM book_assets asset
          WHERE asset.book_version_id = version.id AND asset.asset_type = 'cover'
          ORDER BY asset.created_at, asset.id LIMIT 1) AS cover_storage_key
      FROM workspace_memberships membership
      JOIN users actor ON actor.id = membership.user_id
        AND actor.organization_id = :organizationId AND actor.status = 'active'
      JOIN workspaces workspace ON workspace.id = membership.workspace_id
        AND workspace.organization_id = :organizationId AND workspace.status = 'active'
      JOIN books book ON book.organization_id_at_creation = :organizationId AND book.status = 'published'
      JOIN book_versions version ON version.id = (
        SELECT latest.id FROM book_versions latest
        WHERE latest.book_id = book.id AND latest.organization_id_at_creation = :organizationId
        ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
      )
      LEFT JOIN reading_progress progress ON progress.actor_id = :actorId
        AND progress.workspace_id = :workspaceId AND progress.book_version_id = version.id
      LEFT JOIN student_book_favorites favorite ON favorite.organization_id = :organizationId
        AND favorite.workspace_id = :workspaceId AND favorite.actor_id = :actorId
        AND favorite.book_version_id = version.id
      WHERE membership.user_id = :actorId AND membership.workspace_id = :workspaceId
        AND membership.status = 'active'
      ORDER BY COALESCE(favorite.position, 2147483647), book.created_at DESC, book.id`, scope).map((row) => ({
      bookId: row.book_id,
      bookVersionId: row.book_version_id,
      title: row.title,
      pageCount: row.page_count,
      coverStorageKey: row.cover_storage_key,
      favorite: row.favorite_id ? { id: row.favorite_id, version: row.favorite_version } : null,
      arrangementIds: row.arrangement_ids ? row.arrangement_ids.split(String.fromCharCode(31)) : [],
      progress: {
        lastPageNo: row.last_page_no ?? null,
        updatedFromEventAt: row.updated_from_event_at ?? null,
      },
    }))

    const favorites = all(context.db, `${objectSelect('student_book_favorites')}
      ORDER BY object.position, object.created_at, object.id`, scope).map(mapFavorite)
    const listRows = all(context.db, `SELECT * FROM student_reading_lists
      WHERE organization_id = :organizationId AND workspace_id = :workspaceId AND actor_id = :actorId
      ORDER BY position, created_at, id`, scope)
    const itemRows = all(context.db, `${objectSelect('student_reading_list_items')}
      AND EXISTS (SELECT 1 FROM student_reading_lists list
        WHERE list.id = object.list_id AND list.organization_id = :organizationId
          AND list.workspace_id = :workspaceId AND list.actor_id = :actorId)
      ORDER BY object.list_id, object.position, object.created_at, object.id`, scope).map(mapListItem)
    const itemsByList = new Map()
    for (const item of itemRows) {
      const items = itemsByList.get(item.listId) || []
      items.push(item)
      itemsByList.set(item.listId, items)
    }
    const lists = listRows.map((row) => mapList(row, itemsByList.get(row.id) || []))
    const bookmarks = all(context.db, `${objectSelect('student_bookmarks')}
      ORDER BY object.position, object.updated_at DESC, object.id`, scope).map(mapBookmark)
    const excerpts = all(context.db, `${objectSelect('student_saved_excerpts')}
      ORDER BY object.position, object.updated_at DESC, object.id`, scope).map(mapExcerpt)
    const annotations = all(context.db, `${objectSelect('student_annotations')}
      ORDER BY object.position, object.updated_at DESC, object.id`, scope).map(mapAnnotation)
    return { shelf, favorites, lists, bookmarks, excerpts, annotations }
  }

  async function createFavorite(input) {
    const scope = await authorizeScope({ bookVersionId: input.bookVersionId })
    requireBookVersion(context.db, scope, input.bookVersionId)
    const id = context.idFactory()
    const now = isoNow(context)
    runInTransaction(() => {
      const existing = one(context.db, `SELECT id FROM student_book_favorites
        WHERE organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND book_version_id = :bookVersionId`, { ...scope, bookVersionId: input.bookVersionId })
      if (existing) throw domainError('VERSION_CONFLICT', '这本书已经在喜欢列表中')
      run(context.db, `INSERT INTO student_book_favorites (
          id, organization_id, workspace_id, actor_id, book_version_id, position,
          created_at, updated_at, version
        ) VALUES (:id, :organizationId, :workspaceId, :actorId, :bookVersionId, :position, :now, :now, 1)`, {
        ...scope, id, bookVersionId: input.bookVersionId,
        position: nonNegativeInteger(input.position, 'position'), now,
      })
      auditInTransaction(context, scope, {
        eventType: 'reading.favorite.created', resourceType: 'student_book_favorite', resourceId: id, afterVersion: 1,
      })
    })
    return readFavorite(id, scope)
  }

  async function updateFavorite({ favoriteId, expectedVersion, position }) {
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, 'student_book_favorites', favoriteId, expectedVersion, scope)
    const now = isoNow(context)
    runInTransaction(() => {
      const result = run(context.db, `UPDATE student_book_favorites
        SET position = :position, updated_at = :now, version = version + 1
        WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND version = :expectedVersion`, {
        ...scope, id: favoriteId, expectedVersion, position: nonNegativeInteger(position, 'position'), now,
      })
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '喜欢记录已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: 'reading.favorite.updated', resourceType: 'student_book_favorite', resourceId: favoriteId,
        beforeVersion: previous.version, afterVersion: previous.version + 1,
      })
    })
    return readFavorite(favoriteId, scope)
  }

  async function deleteFavorite({ favoriteId, expectedVersion }) {
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, 'student_book_favorites', favoriteId, expectedVersion, scope)
    runInTransaction(() => {
      const result = run(context.db, `DELETE FROM student_book_favorites
        WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND version = :expectedVersion`, { ...scope, id: favoriteId, expectedVersion })
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '喜欢记录已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: 'reading.favorite.deleted', resourceType: 'student_book_favorite', resourceId: favoriteId,
        beforeVersion: previous.version,
      })
    })
    return { deleted: true, id: favoriteId }
  }

  async function createList({ name, position }) {
    const scope = await authorizeScope()
    const id = context.idFactory()
    const now = isoNow(context)
    runInTransaction(() => {
      run(context.db, `INSERT INTO student_reading_lists (
          id, organization_id, workspace_id, actor_id, name, position, created_at, updated_at, version
        ) VALUES (:id, :organizationId, :workspaceId, :actorId, :name, :position, :now, :now, 1)`, {
        ...scope, id, name: boundedText(name, 'name', 80, { required: true }),
        position: nonNegativeInteger(position, 'position'), now,
      })
      auditInTransaction(context, scope, {
        eventType: 'reading.list.created', resourceType: 'student_reading_list', resourceId: id, afterVersion: 1,
      })
    })
    return readList(id, scope)
  }

  async function updateList({ listId, expectedVersion, name, position }) {
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, 'student_reading_lists', listId, expectedVersion, scope)
    const nextName = name === undefined ? previous.name : boundedText(name, 'name', 80, { required: true })
    const nextPosition = position === undefined ? previous.position : nonNegativeInteger(position, 'position')
    const now = isoNow(context)
    runInTransaction(() => {
      const result = run(context.db, `UPDATE student_reading_lists SET
          name = :name, position = :position, updated_at = :now, version = version + 1
        WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND version = :expectedVersion`, {
        ...scope, id: listId, expectedVersion, name: nextName, position: nextPosition, now,
      })
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '书单已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: 'reading.list.updated', resourceType: 'student_reading_list', resourceId: listId,
        beforeVersion: previous.version, afterVersion: previous.version + 1,
      })
    })
    return readList(listId, scope)
  }

  async function deleteList({ listId, expectedVersion }) {
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, 'student_reading_lists', listId, expectedVersion, scope)
    runInTransaction(() => {
      const result = run(context.db, `DELETE FROM student_reading_lists
        WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND version = :expectedVersion`, { ...scope, id: listId, expectedVersion })
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '书单已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: 'reading.list.deleted', resourceType: 'student_reading_list', resourceId: listId,
        beforeVersion: previous.version,
      })
    })
    return { deleted: true, id: listId }
  }

  async function addListItem({ listId, bookVersionId, position }) {
    const scope = await authorizeScope({ bookVersionId })
    ownedRow(context.db, 'student_reading_lists', listId, scope) || (() => { throw domainError('RESOURCE_NOT_FOUND', '书单不存在或不属于当前学生') })()
    requireBookVersion(context.db, scope, bookVersionId)
    const id = context.idFactory()
    const now = isoNow(context)
    runInTransaction(() => {
      const existing = one(context.db, `SELECT id FROM student_reading_list_items
        WHERE list_id = :listId AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND book_version_id = :bookVersionId`, { ...scope, listId, bookVersionId })
      if (existing) throw domainError('VERSION_CONFLICT', '这本书已经在目标书单中')
      run(context.db, `INSERT INTO student_reading_list_items (
          id, list_id, organization_id, workspace_id, actor_id, book_version_id,
          position, created_at, updated_at, version
        ) VALUES (:id, :listId, :organizationId, :workspaceId, :actorId, :bookVersionId,
          :position, :now, :now, 1)`, {
        ...scope, id, listId, bookVersionId, position: nonNegativeInteger(position, 'position'), now,
      })
      auditInTransaction(context, scope, {
        eventType: 'reading.list_item.created', resourceType: 'student_reading_list_item', resourceId: id, afterVersion: 1,
      })
    })
    return readListItem(id, scope)
  }

  async function updateListItem({ itemId, expectedVersion, position }) {
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, 'student_reading_list_items', itemId, expectedVersion, scope)
    const now = isoNow(context)
    runInTransaction(() => {
      const result = run(context.db, `UPDATE student_reading_list_items
        SET position = :position, updated_at = :now, version = version + 1
        WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND version = :expectedVersion`, {
        ...scope, id: itemId, expectedVersion, position: nonNegativeInteger(position, 'position'), now,
      })
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '书单条目已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: 'reading.list_item.updated', resourceType: 'student_reading_list_item', resourceId: itemId,
        beforeVersion: previous.version, afterVersion: previous.version + 1,
      })
    })
    return readListItem(itemId, scope)
  }

  async function deleteListItem({ itemId, expectedVersion }) {
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, 'student_reading_list_items', itemId, expectedVersion, scope)
    runInTransaction(() => {
      const result = run(context.db, `DELETE FROM student_reading_list_items
        WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND version = :expectedVersion`, { ...scope, id: itemId, expectedVersion })
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '书单条目已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: 'reading.list_item.deleted', resourceType: 'student_reading_list_item', resourceId: itemId,
        beforeVersion: previous.version,
      })
    })
    return { deleted: true, id: itemId }
  }

  async function createBookmark(input) {
    return createPageObject('bookmark', input)
  }

  async function createExcerpt(input) {
    return createPageObject('excerpt', input)
  }

  async function createAnnotation(input) {
    return createPageObject('annotation', input)
  }

  async function createPageObject(kind, input) {
    const definition = objectDefinitions[kind]
    const scope = await authorizeScope({ bookVersionId: input.bookVersionId })
    const quoteText = kind === 'bookmark'
      ? ''
      : boundedText(input.quoteText, 'quoteText', 2000, { required: kind === 'excerpt' })
    const anchor = optionalAnchor(input)
    requirePage(context.db, scope, input.bookVersionId, input.pageNo, quoteText, anchor)
    const id = context.idFactory()
    const now = isoNow(context)
    const common = {
      ...scope,
      id,
      bookVersionId: input.bookVersionId,
      pageNo: assertPositiveInteger(input.pageNo, 'pageNo'),
      position: nonNegativeInteger(input.position, 'position'),
      now,
      ...anchor,
    }
    runInTransaction(() => {
      if (kind === 'bookmark') {
        run(context.db, `INSERT INTO student_bookmarks (
            id, organization_id, workspace_id, actor_id, book_version_id, page_no,
            label, position, created_at, updated_at, version
          ) VALUES (:id, :organizationId, :workspaceId, :actorId, :bookVersionId, :pageNo,
            :label, :position, :now, :now, 1)`, {
          id: common.id,
          organizationId: common.organizationId,
          workspaceId: common.workspaceId,
          actorId: common.actorId,
          bookVersionId: common.bookVersionId,
          pageNo: common.pageNo,
          label: boundedText(input.label, 'label', 160),
          position: common.position,
          now: common.now,
        })
      } else if (kind === 'excerpt') {
        run(context.db, `INSERT INTO student_saved_excerpts (
            id, organization_id, workspace_id, actor_id, book_version_id, page_no,
            block_id, char_start, char_end, quote_text, note, position,
            created_at, updated_at, version
          ) VALUES (:id, :organizationId, :workspaceId, :actorId, :bookVersionId, :pageNo,
            :blockId, :charStart, :charEnd, :quoteText, :note, :position, :now, :now, 1)`, {
          ...common, quoteText, note: boundedText(input.note, 'note', 2000),
        })
      } else {
        const color = input.color ?? 'violet'
        if (!annotationColors.has(color)) throw new TypeError('color 无效')
        run(context.db, `INSERT INTO student_annotations (
            id, organization_id, workspace_id, actor_id, book_version_id, page_no,
            block_id, char_start, char_end, quote_text, body, color, position,
            created_at, updated_at, version
          ) VALUES (:id, :organizationId, :workspaceId, :actorId, :bookVersionId, :pageNo,
            :blockId, :charStart, :charEnd, :quoteText, :body, :color, :position, :now, :now, 1)`, {
          ...common, quoteText, body: boundedText(input.body, 'body', 4000, { required: true }), color,
        })
      }
      auditInTransaction(context, scope, {
        eventType: `${definition.eventPrefix}.created`, resourceType: definition.resourceType, resourceId: id, afterVersion: 1,
      })
    })
    return readObject(kind, id, scope)
  }

  async function updatePageObject(kind, input) {
    const definition = objectDefinitions[kind]
    const id = assertString(input[`${kind}Id`], `${kind}Id`)
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, definition.table, id, input.expectedVersion, scope)
    const position = input.position === undefined ? previous.position : nonNegativeInteger(input.position, 'position')
    const now = isoNow(context)
    runInTransaction(() => {
      let result
      if (kind === 'bookmark') {
        result = run(context.db, `UPDATE student_bookmarks SET label = :label, position = :position,
          updated_at = :now, version = version + 1
          WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
            AND actor_id = :actorId AND version = :expectedVersion`, {
          ...scope, id, expectedVersion: input.expectedVersion,
          label: input.label === undefined ? previous.label : boundedText(input.label, 'label', 160), position, now,
        })
      } else if (kind === 'excerpt') {
        result = run(context.db, `UPDATE student_saved_excerpts SET note = :note, position = :position,
          updated_at = :now, version = version + 1
          WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
            AND actor_id = :actorId AND version = :expectedVersion`, {
          ...scope, id, expectedVersion: input.expectedVersion,
          note: input.note === undefined ? previous.note : boundedText(input.note, 'note', 2000), position, now,
        })
      } else {
        const color = input.color === undefined ? previous.color : input.color
        if (!annotationColors.has(color)) throw new TypeError('color 无效')
        result = run(context.db, `UPDATE student_annotations SET body = :body, color = :color,
          position = :position, updated_at = :now, version = version + 1
          WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
            AND actor_id = :actorId AND version = :expectedVersion`, {
          ...scope, id, expectedVersion: input.expectedVersion,
          body: input.body === undefined ? previous.body : boundedText(input.body, 'body', 4000, { required: true }),
          color, position, now,
        })
      }
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '阅读对象已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: `${definition.eventPrefix}.updated`, resourceType: definition.resourceType, resourceId: id,
        beforeVersion: previous.version, afterVersion: previous.version + 1,
      })
    })
    return readObject(kind, id, scope)
  }

  async function deletePageObject(kind, input) {
    const definition = objectDefinitions[kind]
    const id = assertString(input[`${kind}Id`], `${kind}Id`)
    const scope = await authorizeScope()
    const previous = assertOwnedVersion(context.db, definition.table, id, input.expectedVersion, scope)
    runInTransaction(() => {
      const result = run(context.db, `DELETE FROM ${definition.table}
        WHERE id = :id AND organization_id = :organizationId AND workspace_id = :workspaceId
          AND actor_id = :actorId AND version = :expectedVersion`, {
        ...scope, id, expectedVersion: input.expectedVersion,
      })
      if (result.changes !== 1) throw domainError('VERSION_CONFLICT', '阅读对象已被更新，请刷新后重试')
      auditInTransaction(context, scope, {
        eventType: `${definition.eventPrefix}.deleted`, resourceType: definition.resourceType, resourceId: id,
        beforeVersion: previous.version,
      })
    })
    return { deleted: true, id }
  }

  return {
    getSnapshot,
    createFavorite,
    updateFavorite,
    deleteFavorite,
    createList,
    updateList,
    deleteList,
    addListItem,
    updateListItem,
    deleteListItem,
    createBookmark,
    updateBookmark: (input) => updatePageObject('bookmark', input),
    deleteBookmark: (input) => deletePageObject('bookmark', input),
    createExcerpt,
    updateExcerpt: (input) => updatePageObject('excerpt', input),
    deleteExcerpt: (input) => deletePageObject('excerpt', input),
    createAnnotation,
    updateAnnotation: (input) => updatePageObject('annotation', input),
    deleteAnnotation: (input) => deletePageObject('annotation', input),
  }
}
