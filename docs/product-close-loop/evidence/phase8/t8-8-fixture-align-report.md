# T8.8 质量门夹具对齐报告

> Agent：Phase 8 T8.8 夹具对齐执行者  
> 时间：2026-08-18  
> 模型：cursor-grok-4.6-xhigh-fast  
> 结论先行：**三门全绿**。只改旧测试夹具与一处所有权不变量。未改业务实现。未进入 T8.9。

---

## 1. 改动文件

详见 `t8-8-fixture-changelog.md`。本任务触及：

**新建**

- `tests/server/helpers/phase8-old-fixture.js`
- `docs/product-close-loop/evidence/phase8/t8-8-fixture-changelog.md`
- `docs/product-close-loop/evidence/phase8/t8-8-fixture-align-report.md`

**旧夹具（A/B/C/D/F/G）**

- `tests/server/ai-safety/conversation-management.test.js`
- `tests/server/core/idempotency-fencing.test.js`
- `tests/server/db/book-package-v2-trusted-import.test.js`
- `tests/server/db/public-domain-assets.test.js`
- `tests/server/db/reading-monitor-migration.test.js`
- `tests/server/http/book-asset-cache.test.js`
- `tests/server/http/book-publish-http.test.js`
- `tests/server/http/books-projection-snapshot-guard.test.js`
- `tests/server/http/integration-runtime.test.js`
- `tests/server/http/reader-preference-http.test.js`
- `tests/server/http/reading-monitor-http.test.js`
- `tests/server/privacy/eyecare-privacy.test.js`
- `tests/server/reading/p1-release-blockers.test.js`
- `tests/server/reading/reading-monitor-cleanup-command.test.js`
- `tests/server/reading/reading-monitoring.test.js`
- `tests/server/reading/reading-teaching-bridge.test.js`
- `tests/server/reading/statistics.test.js`
- `tests/server/reading/student-library-objects.test.js`
- `tests/frontend/api-contract.test.mjs`
- `tests/frontend/book-publish-visibility.test.mjs`

**允许的所有权不变量（E）**

- `tests/server/core/phase8-reading-guards/invariants.guard.test.js`  
  三份 visibility 文件改由 T8.7 拥有，不再要求对初始 HEAD 干净；仍禁止「无 grants 可见」。

**覆盖写的证据**

- `docs/product-close-loop/evidence/phase8/t8-8-server-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-frontend-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-build-output.txt`

工作区另有 T8.2–T8.7 已改文件（含三份 visibility 测试、`identity-core` 等），本任务未回退、未弱化其契约断言。

---

## 2. 实测命令 / 退出码 / 用例数 / 关键 TAP

cwd 均为仓库根 `D:\Project\整书8.15`。以下为**亲自跑**的结果，不是推断。

### 2.1 全量质量门

| 门 | 命令 | 退出码 | TAP |
|---|---|---:|---|
| server | `npm run test:server` → `node --test tests/server/**/*.test.js` | 0 | `# tests 437` `# pass 437` `# fail 0` `# duration_ms 24271.9669` |
| frontend | `npm run test:frontend` → `node --test tests/frontend/*.mjs` | 0 | `# tests 264` `# pass 264` `# fail 0` `# duration_ms 1086.7518` |
| build | `npm run build` → `vite build` | 0 | `✓ 1757 modules transformed.` `✓ built in 9.75s` |

Gate 2 基线是 server 339/428（89 fail）、frontend 239/241（2 fail）。本次 server 总用例 437、frontend 264：旧夹具不再在模块加载期炸掉，原先没跑到的用例现在计入；frontend 的 `book-publish-visibility.test.mjs` 不再因 `loadBookVisibility` 缺导出整文件失败。

关键 TAP 原文（均 `ok`，无 `not ok`）：

```
# Subtest: 不变量：三份 visibility 文件由 T8.7 拥有，不再要求对初始 HEAD 干净
ok 197 - 不变量：三份 visibility 文件由 T8.7 拥有，不再要求对初始 HEAD 干净

# Subtest: 平台运营经真实 HTTP 发布和下架，并写入审计
ok 258 - 平台运营经真实 HTTP 发布和下架，并写入审计

# Subtest: 登录适配器只提交 schoolCode+loginName+password 并使用真实幂等写请求
ok 6 - 登录适配器只提交 schoolCode+loginName+password 并使用真实幂等写请求

# Subtest: 草稿书不能投放到班级书架，详情页禁用教师阅读器
ok 49 - 草稿书不能投放到班级书架，详情页禁用教师阅读器

# Subtest: 缺 classId 时 loadClassShelf 返回空架；getClassShelf 失败则整次加载失败
ok 50 - 缺 classId 时 loadClassShelf 返回空架；getClassShelf 失败则整次加载失败
```

build 仅有 chunk >500kB 警告，不是失败。

### 2.2 Phase 8 新守卫抽跑

Windows 上 `node --test <目录>` 会把目录当模块、0 用例失败。改为 glob 后亲自跑：

| 命令 | 退出码 | TAP |
|---|---:|---|
| `node --test tests/server/db/phase8-047-050-migration.guard.test.js` | 0 | `# tests 26` `# pass 26` `# fail 0` |
| `node --test tests/server/core/phase8-identity-guards/**/*.test.js` | 0 | `# tests 71` `# pass 71` `# fail 0` |
| `node --test tests/server/core/phase8-reading-guards/**/*.test.js` | 0 | `# tests 41` `# pass 41` `# fail 0` |
| `node --test tests/server/http/phase8-http-guards/**/*.test.js` | 0 | `# tests 28` `# pass 28` `# fail 0` |
| `node --test tests/server/http/phase8-attack-t87-gaps.test.js tests/frontend/phase8-t8-6a-identity-ui.test.mjs tests/frontend/phase8-t8-6b-class-shelf.test.mjs` | 0 | `# tests 21` `# pass 21` `# fail 0` |

上述守卫已包含在 `test:server` / `test:frontend` 全量绿里。抽跑用于确认没有靠改守卫消红。

---

## 3. 实测 vs 推断

| 项 | 性质 |
|---|---|
| 三门退出码、TAP 计数、守卫抽跑 | **实测** |
| Gate 2 的 89/2 失败归类（A–G） | 沿用 `t8-8-gate2-report.md`，本任务按该类改夹具后复测变绿 |
| 班级 DTO 不含 `organizationId`/`workspaceId` | 读 `classDto` 源码后改夹具，再实测 201 + 库查 workspace |
| `loginName` 须 3–32 且 `IDENTIFIER_PATTERN` | 读 `parseLoginName` 后改夹具，再实测注册 201 |
| internal-demo 登录须 `schoolCode: 'internal-demo'` | 读 bootstrap 常量后改夹具，再实测 200 |

---

## 4. 契约 pass/fail

| 契约 | 结果 |
|---|---|
| 登录体 `{schoolCode, loginName, password}` | pass |
| 组织非空 `school_code` | pass |
| 全局书库 import/publish 只用 platform | pass（教师不再被夹具授予这些权限） |
| 学生可见只靠该班 grant；无 grant → 0/404 | pass；未做全表 grant |
| 最大迁移号按目录前 3 位 = 050 | pass |
| POST `/students` 保持标准 404（P8-18R） | pass；联调用签发/注册/批准替代 |
| T8.7 三份 visibility：不回退「无 grants 可见」或「draft lease 200」 | pass |
| Phase 8 新守卫断言未弱化 | pass（仅改 T8.4A 所有权声明） |

---

## 5. 遗留

无质量门红。未 commit / 未 push。未进入 T8.9。

工作区仍有 T8.2–T8.7 业务与守卫的未提交改动；本任务范围外。

---

## 6. 停止条件

未触发：

- 必须改业务代码才能绿 → 未发生
- 只能靠删用例 / 放宽 Phase 8 断言 / 全局 grant 才能绿 → 未发生
- 真库或 5191 被碰 → 未发生
- 改完后仍有红 → 未发生（不谎称；TAP `# fail 0`）

---

## 7. 未触碰红线

未改 `server/**`、`src/**`、`package.json`、`server/db/migrations/**`。  
未改 `09` / `02`/`03`/`04`/`05`、`decisions.md`、`execution-ledger.md`。  
未写 `server/data/readmate.sqlite`。未重启、未占用 5191。  
未改 `reading_summary_sessions` / `reading_daily_book_summaries` / session-summaries schema / 指纹 / 90s TTL / 续租路由。  
未 fallback、未删用例、未放宽 Phase 8 契约断言。

---

## 8. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-8-fixture-changelog.md`
- `docs/product-close-loop/evidence/phase8/t8-8-fixture-align-report.md`（本文件）
- `docs/product-close-loop/evidence/phase8/t8-8-server-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-frontend-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-build-output.txt`
- 对照基线：`docs/product-close-loop/evidence/phase8/t8-8-gate2-report.md`
