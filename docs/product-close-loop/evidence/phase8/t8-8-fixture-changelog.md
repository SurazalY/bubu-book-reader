# T8.8 旧测试夹具对齐 changelog

> 只改 `tests/**` 旧夹具与一处所有权不变量。不改业务实现。不删用例。不全局 grant。不回退 T8.7。

## 共享

| 文件 | 改了什么 | 为什么是产品改判不是弱化 |
|---|---|---|
| `tests/server/helpers/phase8-old-fixture.js`（新建） | `loginBody` → `{schoolCode, loginName, password}`；`grantBookToClass` 只给指定班插一行 `book_access_grants` | P8-17R 登录三字段；P8-24 默认全闭，禁止全表 grant |

## A. 组织必须有非空 `school_code`

旧 raw `INSERT INTO organizations` 补 `school_code`（通常用 org id）；用户补 `login_name`/`account_code`。047 触发器要求非空，不是放宽校验。

- `tests/server/reading/statistics.test.js`
- `tests/server/reading/reading-monitoring.test.js`
- `tests/server/reading/student-library-objects.test.js`
- `tests/server/reading/reading-monitor-cleanup-command.test.js`
- `tests/server/db/reading-monitor-migration.test.js`
- `tests/server/ai-safety/conversation-management.test.js`
- `tests/server/privacy/eyecare-privacy.test.js`
- `tests/server/reading/p1-release-blockers.test.js`（`createFixture` 改走全量迁移 + `seedIdentity`）

**未改** `phase8-047-050-migration.guard.test.js` 里故意不写 `school_code` 的负例。

`tests/server/core/idempotency-fencing.test.js` 的 `insertLegacyIdentityData` **撤回**对 `school_code`/`login_name` 的写入：该用例只跑到 003，表还没有 047 列。这是对齐旧迁移夹具 schema，不是绕过 047。

## B. 登录体 `{schoolCode, loginName, password}`

HTTP 夹具加 `schoolCode`，login helper 改用 `loginBody`。

- `tests/server/http/integration-runtime.test.js`（含 internal-demo `schoolCode: 'internal-demo'`）
- `tests/server/http/reading-monitor-http.test.js`
- `tests/server/http/book-asset-cache.test.js`
- `tests/server/http/reader-preference-http.test.js`
- `tests/server/http/books-projection-snapshot-guard.test.js`
- `tests/server/http/book-publish-http.test.js`

## C. 全局书库只平台

import/publish 改用 `internal-ops-admin` + `internal-demo-platform-workspace`，或 HTTP 发布链路改 platform actor。不给教师加回 `book.import`/`book.publish`。

- `tests/server/db/book-package-v2-trusted-import.test.js`
- `tests/server/db/public-domain-assets.test.js`
- `tests/server/http/book-publish-http.test.js`（标题改为「平台运营经真实 HTTP 发布和下架」；学生 403 保留）

## D. 最大迁移号 050

- `tests/server/db/reading-monitor-migration.test.js`：`applied.at(-1)` 从 `046_reader_mode_preferences.sql` 改为 `050_book_access_grant_backfill.sql`

`reader-preference-http.test.js` 仍断言 046 **存在**（不是最大号），未改。

## E. T8.4A 所有权不变量

- `tests/server/core/phase8-reading-guards/invariants.guard.test.js`

不再 `git status --porcelain` 要求三份 visibility 文件对初始 HEAD 干净。改为：文件仍在；源码含 `book_access_grants|grantCurrentBookToClass|putClassShelfBook|class-local`；禁止「无 grants 即可见」。承认 T8.7 所有权，**未回退**那三份文件。

## F. 默认全闭：只给该班需要的书写 grant

无 grant 应 0/404。禁止 `INSERT` 全表 grant。

- statistics / reading-monitoring / student-library-objects：按班按书写 grant
- reading-monitoring 转班用例：给 `class-new` 再写一行 grant（否则新班 acquire 404，这是产品默认全闭）
- HTTP `createPublishedBook` / startHarness：publish 后只 grant 到夹具自己的 `classId`
- book-package 学生投影：import 后只给 `internal-demo-class` 写 grant
- p1：publish 后 grant 到对应班；跨 org 用 `student-org-2` + org-2 grant
- teaching-bridge：桩库补身份行；课堂/租约用例用 teacher 角色（`bypassClassGrants`），不插全表 grant
- statistics：师生共用 `student-workspace-a`，避免 `uq_workspaces_active_organization_scope`

## G. frontend

- `tests/frontend/api-contract.test.mjs`：`login({schoolCode, loginName, password}, {idempotencyKey})`
- `tests/frontend/book-publish-visibility.test.mjs`：`loadClassShelf` 替代 `loadBookVisibility`；写操作改本班 shelf PUT/DELETE；草稿用例改为「不能投放到班级书架、详情禁用教师阅读器」，不再要求已删除的 `TeacherReaderButton` / 详情页 `DRAFT_BOOK_READER_HINT`

## 产品改判后的联调场景（未恢复 POST /students）

`tests/server/http/integration-runtime.test.js`「管理员创建班级和学生」：

1. 建班 `{name, stage, entryYear, classNumber}`
2. 教师 POST `/students` 断言 **404**
3. 校长签发凭据 → 注册 → 校长从 school workspace 批准
4. 班级 DTO 已不含 `organizationId`/`workspaceId`：从库查 class workspace
5. `loginName` 改为 3–32 合法标识（`ns` + 16 hex），对齐 `parseLoginName`
6. 只给新班 grant 已有书
7. 审计改为 `identity.class.created` + `identity.enrollment.approved`

## 未改

- `server/**`、`src/**`、`package.json`、`server/db/migrations/**`
- `09` / `02`/`03`/`04`/`05`、`decisions.md`、`execution-ledger.md`
- 真库、5191
- T8.7 三份 visibility 测试（未回退）
- Phase 8 新守卫断言（除上述所有权不变量）
