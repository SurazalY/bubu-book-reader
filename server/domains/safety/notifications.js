function nowIso(clock) {
  const value = clock()
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

export function dispatchSafetyNotificationOutbox(database, { eventId = null, clock = () => new Date() } = {}) {
  if (typeof database?.prepare !== 'function' || typeof database?.exec !== 'function') {
    throw new TypeError('database must be a node:sqlite DatabaseSync-compatible connection')
  }

  let dispatched = 0
  while (true) {
    database.exec('BEGIN IMMEDIATE')
    try {
      const outbox = database.prepare(`
        SELECT outbox.id, outbox.aggregate_id, recipient.id AS recipient_id
        FROM outbox_events AS outbox
        JOIN safety_notification_recipients AS recipient ON recipient.outbox_event_id = outbox.id
        WHERE outbox.topic = 'safety.notification.dispatch'
          AND outbox.status = 'pending'
          AND recipient.status = 'planned'
          AND (? IS NULL OR outbox.aggregate_id = ?)
        ORDER BY outbox.available_at, outbox.created_at, outbox.id
        LIMIT 1
      `).get(eventId, eventId)
      if (!outbox) {
        database.exec('COMMIT')
        return { dispatched }
      }

      const processedAt = nowIso(clock)
      const claim = database.prepare(`
        UPDATE outbox_events
        SET status = 'processing', locked_at = ?, attempt_count = attempt_count + 1,
            updated_at = ?, version = version + 1
        WHERE id = ? AND status = 'pending'
      `).run(processedAt, processedAt, outbox.id)
      if (Number(claim.changes ?? 0) !== 1) throw new Error('safety notification outbox claim failed')

      const recipient = database.prepare(`
        UPDATE safety_notification_recipients
        SET status = 'dispatched', dispatched_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND status = 'planned' AND outbox_event_id = ?
      `).run(processedAt, processedAt, outbox.recipient_id, outbox.id)
      if (Number(recipient.changes ?? 0) !== 1) throw new Error('safety notification recipient dispatch failed')

      const completion = database.prepare(`
        UPDATE outbox_events
        SET status = 'delivered', processed_at = ?, last_error = NULL,
            updated_at = ?, version = version + 1
        WHERE id = ? AND status = 'processing'
      `).run(processedAt, processedAt, outbox.id)
      if (Number(completion.changes ?? 0) !== 1) throw new Error('safety notification outbox completion failed')

      database.exec('COMMIT')
      dispatched += 1
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
