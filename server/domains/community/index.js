import { createHash } from 'node:crypto'

import { withTransaction } from '../../db/database.js'
import { DomainError, emit, json, makeId, nowIso, requirePermission, requireText, resolveContext } from '../delivery/primitives.js'
import { isBookVisibleToAudience, resolveBookAudience } from '../reading/visibility.js'

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const reactionTypes = new Set(['appreciate', 'insight', 'bookmark', 'clap', 'same', 'learn', 'warm'])
const postScopes = new Set(['class', 'school'])
const reviewDecisions = new Set(['approved', 'rejected', 'delisted'])

function imageAsset(input) {
  const mimeType = requireText(input?.mimeType, 'image.mimeType', 100).toLowerCase()
  const originalName = requireText(input?.originalName, 'image.originalName', 255)
  const sha256 = requireText(input?.sha256, 'image.sha256', 64).toLowerCase()
  const bytes = input?.bytes
  const computedSha256 = bytes instanceof Uint8Array ? createHash('sha256').update(bytes).digest('hex') : null
  const validSignature = bytes instanceof Uint8Array && (
    (mimeType === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mimeType === 'image/png' && bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) ||
    (mimeType === 'image/webp' && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
  )
  if (!imageTypes.has(mimeType) || !/^[a-f0-9]{64}$/.test(sha256) || computedSha256 !== sha256 || !Number.isInteger(input?.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > 10 * 1024 * 1024 || bytes?.length !== input.sizeBytes || !validSignature) {
    throw new DomainError('VALIDATION_FAILED', '图片基础安全校验未通过', { mimeType, sizeBytes: input?.sizeBytes })
  }
  return { mimeType, originalName, sha256, sizeBytes: input.sizeBytes }
}

function communityScope(value) {
  const scope = value === undefined ? 'class' : value
  if (!postScopes.has(scope)) throw new DomainError('VALIDATION_FAILED', '社区范围无效')
  return scope
}

function currentClassId(workspace) {
  return workspace.scopeType === 'class'
    ? workspace.scopeId
    : workspace.classId ?? workspace.snapshot?.classId ?? workspace.snapshot?.scopeId ?? workspace.id
}

function hasPermission(context, permission) {
  const { actor, workspace } = context
  return typeof actor.can === 'function'
    ? actor.can(permission, workspace) === true
    : Array.isArray(actor.permissions) && actor.permissions.includes(permission)
}

function requireAnyPermission(context, permissions) {
  if (!permissions.some((permission) => hasPermission(context, permission))) {
    throw new DomainError('PERMISSION_DENIED', '当前工作空间无权执行此操作', { permissions })
  }
}

function activeClassMember(db, actorId, organizationId, classId, allowedRoles) {
  const membership = db.prepare(`
    SELECT membership.membership_role
    FROM class_memberships AS membership
    JOIN classes AS classroom ON classroom.id = membership.class_id
    JOIN users AS user ON user.id = membership.user_id
    WHERE membership.user_id = ?
      AND membership.class_id = ?
      AND membership.status = 'active'
      AND classroom.organization_id = ?
      AND classroom.status = 'active'
      AND user.organization_id = ?
      AND user.status = 'active'
  `).get(actorId, classId, organizationId, organizationId)
  return Boolean(membership && allowedRoles.includes(membership.membership_role))
}

function requireClassMembership(db, current, allowedRoles) {
  const classId = currentClassId(current.workspace)
  if (!classId) throw new DomainError('PERMISSION_DENIED', '当前班级不可用')
  if (current.workspace.scopeType !== undefined) {
    if (current.workspace.scopeType !== 'class' || current.workspace.scopeId !== classId) {
      throw new DomainError('PERMISSION_DENIED', '当前工作空间不属于班级社区')
    }
    if (!activeClassMember(db, current.actor.id, current.workspace.organizationId, classId, allowedRoles)) {
      throw new DomainError('PERMISSION_DENIED', '当前账号不属于目标班级')
    }
  }
  return classId
}

function structuredQuote(db, input, organizationId, required) {
  if (input === undefined || input === null) {
    if (!required) return null
    throw new DomainError('VALIDATION_FAILED', '投稿必须关联一条书中引文')
  }
  const bookId = requireText(input.bookId, 'quote.bookId', 255)
  const page = Number(input.page)
  const text = requireText(input.text, 'quote.text', 2000)
  if (!Number.isSafeInteger(page) || page <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'quote.page 无效')
  }
  const source = db.prepare(`
    SELECT page.text_content
    FROM books AS book
    JOIN book_versions AS version
      ON version.book_id = book.id AND version.organization_id_at_creation = book.organization_id_at_creation
    JOIN book_pages AS page ON page.book_version_id = version.id
    WHERE book.id = ?
      AND book.organization_id_at_creation = ?
      AND book.status = 'published'
      AND page.page_no = ?
    ORDER BY version.created_at DESC, version.id DESC
    LIMIT 1
  `).get(bookId, organizationId, page)
  if (!source || !source.text_content.includes(text)) {
    throw new DomainError('VALIDATION_FAILED', '引文必须来自当前组织已发布书目的对应页面')
  }
  return { bookId, page, text }
}

function assertOrganization(post, workspace) {
  if (!post || post.organization_id_at_creation !== workspace.organizationId) {
    throw new DomainError('RESOURCE_NOT_FOUND', '资源不存在或不在当前组织')
  }
  return post
}

function requirePublishedOrganizationBook(db, bookId, organizationId) {
  const id = requireText(bookId, 'bookId', 255)
  const book = db.prepare(`
    SELECT id FROM books
    WHERE id = ?
      AND organization_id_at_creation = ?
      AND status = 'published'
  `).get(id, organizationId)
  if (!book) {
    throw new DomainError('VALIDATION_FAILED', '投稿必须关联当前组织已发布书目', { field: 'bookId' })
  }
  return id
}

function quoteIsReadable(db, current, bookId) {
  const organizationId = current.workspace.organizationId
  const hasRoleAssignments = Boolean(
    db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'role_assignments'`).get(),
  )
  const audience = hasRoleAssignments
    ? resolveBookAudience(db, {
        organizationId,
        userId: current.actor.id,
        workspaceId: current.workspace.id,
      })
    : { bypassClassGrants: false, allowUnpublished: false, classIds: [] }
  const book = bookId
    ? db.prepare(`
        SELECT id, status FROM books
        WHERE id = ? AND organization_id_at_creation = ?
      `).get(bookId, organizationId)
    : null
  const visible = isBookVisibleToAudience(db, {
    bookId,
    organizationId,
    audience,
  })
  if (!book) return false
  if (book.status !== 'published' && !audience.allowUnpublished) return false
  return visible
}

function projectPostBookId(post) {
  return post.book_id || post.quote_book_id || null
}

function projectPostQuote(db, current, post) {
  const boundBookId = projectPostBookId(post)
  const readable = quoteIsReadable(db, current, boundBookId)
  const quoteText = readable ? (post.quote_text ?? null) : null
  return {
    quote: post.quote_book_id
      ? {
          bookId: post.quote_book_id,
          page: post.quote_page,
          text: quoteText,
          availability: readable ? 'available' : 'unavailable',
        }
      : null,
    quoteText,
  }
}

function assertReadablePost(post, current) {
  assertOrganization(post, current.workspace)
  if (post.workspace_id_at_creation === current.workspace.id) return post
  if (post.scope === 'school' && post.status === 'approved') return post
  if (post.scope === 'school' && current.workspace.scopeType === 'school' && current.workspace.scopeId === current.workspace.organizationId) return post
  throw new DomainError('RESOURCE_NOT_FOUND', '资源不存在或不在当前工作空间')
}

function reviewPlan(db, post, current, decision) {
  assertOrganization(post, current.workspace)
  if (post.status === 'submitted') {
    const classId = requireClassMembership(db, current, ['teacher'])
    if (classId !== post.class_id_at_creation || current.workspace.id !== post.workspace_id_at_creation) {
      throw new DomainError('RESOURCE_NOT_FOUND', '资源不存在或不在当前班级工作空间')
    }
    requireAnyPermission(current, ['community.review.class', 'community.moderate'])
    return {
      stage: 'class',
      classId,
      nextStatus: decision,
    }
  }
  if (post.scope === 'school' && post.status === 'class_approved') {
    if (current.workspace.scopeType !== 'school' || current.workspace.scopeId !== current.workspace.organizationId) {
      throw new DomainError('PERMISSION_DENIED', '学校社区二审必须在当前学校工作空间完成')
    }
    requireAnyPermission(current, ['community.review.school', 'community.moderate'])
    return { stage: 'school', classId: post.class_id_at_creation, nextStatus: decision }
  }
  if (post.status === 'approved' && decision === 'delisted') {
    if (post.scope === 'school') {
      if (current.workspace.scopeType !== 'school' || current.workspace.scopeId !== current.workspace.organizationId) {
        throw new DomainError('PERMISSION_DENIED', '学校社区下架必须在当前学校工作空间完成')
      }
      requireAnyPermission(current, ['community.review.school', 'community.moderate'])
      return { stage: 'school', classId: post.class_id_at_creation, nextStatus: 'delisted' }
    }
    const classId = requireClassMembership(db, current, ['teacher'])
    if (classId !== post.class_id_at_creation || current.workspace.id !== post.workspace_id_at_creation) {
      throw new DomainError('RESOURCE_NOT_FOUND', '资源不存在或不在当前班级工作空间')
    }
    requireAnyPermission(current, ['community.review.class', 'community.moderate'])
    return { stage: 'class', classId, nextStatus: 'delisted' }
  }
  throw new DomainError('VERSION_CONFLICT', '投稿当前状态不可审核', { status: post.status })
}

export function createCommunityDomain({ db, actor, workspace, outbox, clock, idGenerator, transactionRunner } = {}) {
  if (!db?.prepare) throw new Error('createCommunityDomain requires db.prepare')
  const context = () => resolveContext({ actor, workspace })
  const id = () => makeId(idGenerator)
  const now = () => nowIso(clock)
  const runInTransaction = transactionRunner || ((operation) => withTransaction(db, operation))

  return {
    submitPost({ title, body, scope, bookId, images = [], aiAssisted = false }) {
      const current = context()
      requirePermission(current, 'community.submit')
      const classId = requireClassMembership(db, current, ['student'])
      const postScope = communityScope(scope)
      structuredQuote(db, null, current.workspace.organizationId, false)
      const safeBookId = requirePublishedOrganizationBook(db, bookId, current.workspace.organizationId)
      if (!Array.isArray(images) || images.length > 4) throw new DomainError('VALIDATION_FAILED', '图片数量无效')
      const safeImages = images.map(imageAsset)
      const postId = runInTransaction(() => {
        const nextPostId = id()
        const createdAt = now()
        db.prepare(`INSERT INTO community_posts (id, organization_id_at_creation, workspace_id_at_creation, class_id_at_creation, actor_id_at_creation, author_id, scope, title, body, quote_book_id, quote_page, quote_text, book_id, status, ai_assisted, organization_snapshot_json, workspace_snapshot_json, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 'submitted', ?, ?, ?, ?, ?, 1)`).run(nextPostId, current.workspace.organizationId, current.workspace.id, classId, current.actor.id, current.actor.id, postScope, requireText(title, 'title', 120), requireText(body, 'body', 5000), safeBookId, aiAssisted ? 1 : 0, json(current.workspace.organizationSnapshot || {}), json(current.workspace.snapshot || {}), createdAt, createdAt)
        const insertAsset = db.prepare(`INSERT INTO post_assets (id, post_id, mime_type, size_bytes, sha256, original_name, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        for (const asset of safeImages) insertAsset.run(id(), nextPostId, asset.mimeType, asset.sizeBytes, asset.sha256, asset.originalName, createdAt, createdAt)
        emit(db, outbox, 'community.post_submitted', { postId: nextPostId, scope: postScope, workspaceId: current.workspace.id, classId }, { aggregateType: 'community_post', aggregateId: nextPostId, dedupeKey: `community.post_submitted:${nextPostId}`, createdAt })
        return nextPostId
      })
      return this.getPost(postId)
    },

    getPost(postId) {
      const current = context()
      const post = assertReadablePost(db.prepare('SELECT * FROM community_posts WHERE id = ?').get(postId), current)
      const assets = db.prepare('SELECT id, mime_type AS mimeType, size_bytes AS sizeBytes, sha256, original_name AS originalName FROM post_assets WHERE post_id = ? ORDER BY created_at').all(postId)
      const reactions = db.prepare('SELECT reaction_type AS reactionType, COUNT(*) AS count FROM post_reactions WHERE post_id = ? GROUP BY reaction_type').all(postId)
      const reviews = db.prepare('SELECT reviewer_id AS reviewerId, workspace_id_at_review AS workspaceId, class_id_at_review AS classId, review_stage AS stage, decision, reason, created_at AS createdAt FROM post_reviews WHERE post_id = ? ORDER BY created_at, id').all(postId)
      const projected = projectPostQuote(db, current, post)
      return {
        ...post,
        bookId: projectPostBookId(post),
        quote_text: projected.quoteText,
        ai_assisted: Boolean(post.ai_assisted),
        quote: projected.quote,
        assets,
        reactions,
        reviews,
      }
    },

    reviewPost({ postId, decision, reason }) {
      const current = context()
      if (!reviewDecisions.has(decision)) throw new DomainError('VALIDATION_FAILED', '审核决定无效')
      const post = assertOrganization(db.prepare('SELECT * FROM community_posts WHERE id = ?').get(postId), current.workspace)
      const plan = reviewPlan(db, post, current, decision)
      runInTransaction(() => {
        const createdAt = now()
        db.prepare('UPDATE community_posts SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(plan.nextStatus, createdAt, postId)
        db.prepare(`INSERT INTO post_reviews (id, post_id, reviewer_id, workspace_id_at_review, organization_id_at_review, class_id_at_review, review_stage, decision, reason, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(id(), postId, current.actor.id, current.workspace.id, current.workspace.organizationId, plan.classId, plan.stage, decision, requireText(reason, 'reason', 500), createdAt, createdAt)
        emit(db, outbox, 'community.post_reviewed', { postId, decision, stage: plan.stage, workspaceId: current.workspace.id, classId: plan.classId }, { aggregateType: 'community_post', aggregateId: postId, dedupeKey: `community.post_reviewed:${postId}:${plan.stage}:${decision}`, createdAt })
      })
      return this.getPost(postId)
    },

    react({ postId, reactionType }) {
      const current = context()
      requirePermission(current, 'community.submit')
      if (!reactionTypes.has(reactionType)) throw new DomainError('VALIDATION_FAILED', '不支持的轻互动类型')
      const classId = requireClassMembership(db, current, ['student'])
      const post = assertReadablePost(db.prepare('SELECT * FROM community_posts WHERE id = ?').get(postId), current)
      if (post.status !== 'approved') throw new DomainError('VERSION_CONFLICT', '仅可对已审核投稿互动')
      const result = runInTransaction(() => {
        const createdAt = now()
        const write = db.prepare(`INSERT INTO post_reactions (id, post_id, actor_id, organization_id_at_reaction, workspace_id_at_reaction, class_id_at_reaction, reaction_type, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(post_id, actor_id, reaction_type) DO NOTHING`).run(id(), postId, current.actor.id, current.workspace.organizationId, current.workspace.id, classId, reactionType, createdAt, createdAt)
        if (write.changes === 1) {
          emit(db, outbox, 'community.post_reacted', { postId, reactionType, workspaceId: current.workspace.id, classId }, { aggregateType: 'community_post', aggregateId: postId, dedupeKey: `community.post_reacted:${postId}:${current.actor.id}:${reactionType}`, createdAt })
        }
        return write
      })
      return { created: result.changes === 1, post: this.getPost(postId) }
    },

    removeReaction({ postId, reactionType }) {
      const current = context()
      requirePermission(current, 'community.submit')
      if (!reactionTypes.has(reactionType)) throw new DomainError('VALIDATION_FAILED', '不支持的轻互动类型')
      requireClassMembership(db, current, ['student'])
      const post = assertReadablePost(db.prepare('SELECT * FROM community_posts WHERE id = ?').get(postId), current)
      if (post.status !== 'approved') throw new DomainError('VERSION_CONFLICT', '仅可移除已审核投稿的互动')
      const result = runInTransaction(() => {
        const createdAt = now()
        const write = db.prepare('DELETE FROM post_reactions WHERE post_id = ? AND actor_id = ? AND reaction_type = ?').run(postId, current.actor.id, reactionType)
        if (write.changes === 1) {
          emit(db, outbox, 'community.post_reaction_removed', { postId, reactionType, workspaceId: current.workspace.id }, { aggregateType: 'community_post', aggregateId: postId, dedupeKey: `community.post_reaction_removed:${postId}:${current.actor.id}:${reactionType}`, createdAt })
        }
        return write
      })
      return { removed: result.changes === 1 }
    },
  }
}
