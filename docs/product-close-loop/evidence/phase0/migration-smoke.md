# Phase 0 迁移与 health 冒烟

## 步骤

1. 临时库：`C:\Users\Yak\AppData\Local\Temp\readmate-phase0.sqlite`（不在仓库内）。
2. 首次 `npm run server` **失败**：仓库无 `.env`，缺少 `SESSION_TOKEN_SECRET`。错误原文：
   `SESSION_TOKEN_SECRET 必须至少包含 32 个字节，且只能由运行时环境注入`
3. 仅在进程环境注入一次性会话密钥后重启成功。未写入任何会提交的文件。
4. 启动日志：
   ```
   (node:32628) ExperimentalWarning: SQLite is an experimental feature and might change at any time
   [readmate] listening on http://127.0.0.1:5191
   ```
   启动日志本身不打印 000–044 文件名；以 `schema_migrations` 表为准。

## 迁移记录

`SELECT id FROM schema_migrations ORDER BY id`：

- 行数：28（仓库 `server/db/migrations/` 现有 28 个 `.sql`，编号有空隙）
- 最大编号：`044_reader_dual_mode_pilot.sql`
- 完整 id 列表：
  - 000_identity.sql
  - 001_sessions.sql
  - 002_reliability.sql
  - 003_identity_hardening.sql
  - 004_idempotency_lifecycle_and_scope_integrity.sql
  - 005_organization_roles_and_idempotency_fencing.sql
  - 010_reading_catalog.sql
  - 011_reading_activity.sql
  - 012_teaching_bridge.sql
  - 013_reading_security_scopes.sql
  - 014_book_catalog_metadata.sql
  - 015_classroom_participation.sql
  - 020_ai_safety.sql
  - 021_ai_safety_hardening.sql
  - 022_ai_safety_sqlite_adapter.sql
  - 023_ai_safety_tenant_scope.sql
  - 024_ai_safety_review_generation_and_idempotency_scope.sql
  - 025_safety_notification_delivery.sql
  - 026_safety_event_resolution.sql
  - 030_community_reports_delivery.sql
  - 031_summary_link_revocations.sql
  - 032_contact_workspace_delivery_claims.sql
  - 033_community_multistage_review.sql
  - 040_student_library_objects.sql
  - 041_eyecare_privacy.sql
  - 042_ai_conversation_management.sql
  - 043_reading_session_summaries.sql
  - 044_reader_dual_mode_pilot.sql

结论：000–044 范围内全部已有迁移文件均已自动应用，最大编号为 044。

## Health

`GET http://127.0.0.1:5191/api/v1/health`

- HTTP 状态码：200
- 响应原文：
  ```json
  {"data":{"status":"ok","database":"sqlite","migrations":28},"meta":{"requestId":"4bf3cc06-d92f-44c6-939d-a95edaf8a263","serverTime":"2026-08-17T04:37:13.526Z"}}
  ```

`data.migrations` 为已应用迁移条数 28，与上表一致。

## 清理

冒烟进程已结束；临时 sqlite / wal / shm 已删除。`GET /api/v1/health` 随后连接失败（PORT_DOWN）。
