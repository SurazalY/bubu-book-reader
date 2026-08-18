# T8.5C HTTP/API 独立验证报告

> 时间：2026-08-18
> Agent：Phase 8 T8.5C 独立验证（只验证、只报告；未参与 T8.5A / T8.5B）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b532cd4e7e44398bd465112e9ff84a9684e`（前缀 `b3cd4b5`）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未改实现或守卫。未 commit。未开浏览器。未写真库。未请求 5191。

## 1. 本轮允许产出

| 路径 | 动作 |
|---|---|
| `docs/product-close-loop/evidence/phase8/t8-5c-verify-report.md` | 新建。本报告 |
| `docs/product-close-loop/evidence/phase8/t8-5c-verify-test-output.txt` | 新建。本轮 TAP（UTF-8） |

未改任何其它文件。

## 2. 实测命令 / 退出码 / 27 条

本轮亲自运行（不是抄 T8.5B）：

```
node --test tests/server/http/phase8-http-guards/visibility-deleted.guard.test.js tests/server/http/phase8-http-guards/class-shelf-http.guard.test.js tests/server/http/phase8-http-guards/publish-school-forbidden.guard.test.js tests/server/http/phase8-http-guards/d21-community-list.guard.test.js tests/server/http/phase8-http-guards/d22-assignments-list.guard.test.js tests/server/http/phase8-http-guards/api-client.guard.test.js tests/server/http/phase8-http-guards/invariants.guard.test.js
```

| 项 | 本轮实测（落盘 TAP） |
|---|---|
| 退出码 | `0` |
| tests | 27 |
| pass | 27 |
| fail | 0 |
| skipped | 0 |
| todo | 0 |
| cancelled | 0 |
| 时长 | `duration_ms 1790.5115` |
| 真库 | 未打开写。`server/data/readmate.sqlite` 的 LastWriteTime 仍是 `2026-08-18 12:50:22`，早于 T8.5A/B |
| 5191 | 本轮未请求。守卫用 `listen(0)`；G 条断言端口 ≠ 5191 且绿 |

同命令先跑过一轮（控制台直出，未重定向）：退出码 `0`，同样 `tests 27 / pass 27 / fail 0 / skipped 0`，`duration_ms 1968.093`。两轮数字独立，时长不同，不是抄 T8.5B 的 `1884.8675`。

分组（按本轮 TAP 顺序，全部 `ok`）：

| 组 | TAP 编号 | 条数 | 结果 |
|---|---|---|---|
| F API client | 1–3 | 3 | 全绿 |
| B 书架 HTTP | 4–9 | 6 | 全绿 |
| D D-21 列表 | 10–14 | 5 | 全绿 |
| E D-22 列表 | 15–18 | 4 | 全绿 |
| G 真库/端口/挂载 | 19–21 | 3 | 全绿 |
| C publish 403 | 22–24 | 3 | 全绿 |
| A 删除旧 visibility | 25–27 | 3 | 全绿 |

`shared-harness.guard.test.js` 无 `test()`，只导出夹具。7 个有用例文件合计 27 条 `test()`。

## 3. 守卫 27 条是否仍在 / 是否弱化

**仍在。未弱化。**

源码 `test(` 计数：A 3 + B 6 + C 3 + D 5 + E 4 + F 3 + G 3 = 27。目录内无 `test.skip` / `describe.skip` / `it.skip` / `todo(`。

27 条标题与 T8.5A 报告列出的契约名一致，关键断言仍在：

- A：源码删除 GET/PUT visibility、无 `scope=organization` 兼容；HTTP 要求 `requireIntegrationReachable`（先 GET `/books` 200）再标准 JSON 404；PUT organization/classes 均 404 且不得清空他班 grant
- B：必须注册三条 shelf 路由；书架块禁 `listAuthorizedClasses`；本班 200 幂等一行；他班/无 C 为 403 或标准 404；跨组织与不存在同码同文案；并发一行；撤下隔离
- C：教师/校长/年级主任 publish 403 且 `PERMISSION_DENIED`；platform 200 且 grants 计数不变
- D：`projectCommunityPosts` 函数体内调用 `isBookVisibleToAudience`；列表测 `GET /community/posts`，不可见保留帖子、`quote.text=null`、`availability=unavailable`
- E：`projectAssignments` 函数体内调用同一谓词；不可见整项省略，禁止泄露 title/bookId/versionId
- F：console 必须有 shelf 三函数、删除 visibility 写；login body 为 `{schoolCode, loginName, password}`；student 有 registration/onboarding/enrollment 读
- G：临时库 ≠ 真库、端口 ≠ 5191；GET `/books` 必须 200；书架块禁 `listAuthorizedClasses`

`git diff -- tests/server/http/phase8-http-guards/` 为空（目录对 HEAD 仍是 `??`）。守卫文件 LastWriteTime 为 19:22–19:25，T8.5A 报告 19:27，T8.5B 实现 19:38–19:39。没有实现后改守卫的时间证据。

## 4. 实现只读核对（对照 §15 T8.5 / §14.3 / §14.4 / P8-13 / P8-20 / P8-22）

### 4.1 旧 visibility 路由已删（P8-13）

`git diff -- server/http/integration-router.js`：原 `GET/PUT /books/:bookId/visibility` 整段删除，换成 class-local shelf。全文件无 `visibility`、`getBookVisibility`、`setBookVisibility`、`scope=organization`。无兼容 handler。

### 4.2 书架不用 `listAuthorizedClasses`（P8-20 / §10.4 F-1）

`integration-router.js` 全文无 `listAuthorizedClasses`。三条 shelf 路由鉴权 `book.shelf.read/grant/revoke`，先 `requireClassInCurrentOrganization`（跨组织/不存在同文案 404「班级不存在或当前不可读取」），再 `requireShelfClassWorkspace`（`scopeType==='class'` 且 `scopeId===classId`，否则 403）。PUT/DELETE 调 T8.4 `grantClassLocalShelf` / `revokeClassLocalShelf`。

`src/api/console.js` 仍有名为 `listAuthorizedClasses` 的 client，打的是 `GET /classes`，不是 shelf HTTP。这不是 P8-20 禁止的服务端并集。F 守卫不禁这个函数名。

### 4.3 两处投影接到同一谓词（P8-22 / §14.3 / §14.4）

`projections.js` 的 git diff 只动 import 与这两个函数，未改其它投影。

- `projectCommunityPosts`：`resolveBookAudience` + `isBookVisibleToAudience`；不可见保留帖子，`quote.text=null`、`availability='unavailable'`。`GET /community/posts` 仍走该投影。
- `projectAssignments`：增加 `actorId`；`GET /assignments` 传入 `req.identitySession.user.id`。学生路径（`!bypassClassGrants`）对 draft/不可见 `return []` 整项省略。教师管理视图按 §14.4 跳过 class grant 过滤，SQL 仍限本组织。

### 4.4 API client（T8.5 写入范围）

- `auth.js`：`login({ schoolCode, loginName, password })`，不再发 `{ username, password }`
- `console.js`：`getClassShelf` / `putClassShelfBook` / `deleteClassShelfBook`；无 `getBookVisibility` / `setBookVisibility`
- `student.js`：`getRegistration`、`registerWithToken`、`getOnboardingMe`、`getMyEnrollment`

### 4.5 未改 T8.5A 守卫、未改 25 条旧 visibility

| 检查 | 结果 |
|---|---|
| `phase8-http-guards/` | `??`，对 HEAD 无 diff；mtime 早于 T8.5B |
| `book-visibility-guard.test.js` | porcelain 空；18 条 `test()` |
| `book-visibility-revoke-guard.test.js` | porcelain 空；7 条 `test()` |
| `book-visibility-http.test.js` | porcelain 空（T8.7，不在 25 条守卫内） |

18 + 7 = 25。本轮未跑这 25 条。

identity / reading / community / 迁移对 HEAD 仍脏，属于 T8.2–T8.4 既有工作区，不是本包验证对象。T8.5B 自称未改那些文件；本轮未把那些 diff 算进 T8.5。

## 5. 契约 A–G

| 组 | 本轮 |
|---|---|
| A 删除旧 visibility HTTP | **pass** 3/3 |
| B 书架 HTTP | **pass** 6/6 |
| C 学校角色 publish 403；platform 不写 grants | **pass** 3/3 |
| D D-21 列表投影 | **pass** 5/5 |
| E D-22 安排投影 | **pass** 4/4 |
| F API client | **pass** 3/3 |
| G 真库/端口/挂载链 | **pass** 3/3 |

未做（范围外，不记失败）：T8.6 前端仍引用旧 login/visibility；25 条旧 visibility 与 `book-visibility-http.test.js`（T8.7）；server 全量 / 5191 真人实例。

## 6. 实测 vs 推断

**实测**

- 上表命令、退出码 0、27/27/0 skip，见 `t8-5c-verify-test-output.txt`。
- 守卫 27 个 `test()` 仍在；无 skip；mtime 与 git 说明 T8.5B 未改守卫。
- 旧 visibility 路由源码已删；shelf 块无 `listAuthorizedClasses`；两处投影函数体内调用 `isBookVisibleToAudience`。
- 25 条旧 visibility 守卫 porcelain 空。
- 未写 `server/data/readmate.sqlite`；未请求 5191。

**推断**

- T8.5A 当初 26 红里大量是 identity catch-all 404。本轮 G 的 GET `/books` 200，说明挂载热修后 integration 链可达；A 的 404 是应用链末端标准 JSON 404，不是 identity 兜底假绿。
- 教师 `GET /assignments` 管理列表本包守卫未覆盖；实现用 `bypassClassGrants` 跳过 class grant，符合 §14.4，外组织仍被 SQL 挡住。
- 旧 25 条在删除 visibility HTTP 后预期会红，由 T8.7 收口。
- 本机 `Get-NetTCPConnection -LocalPort 5191` 看到 `127.0.0.1:5191 Listen`（pid 66104）。这是环境既有进程，不是本轮打开，也不是本轮请求。不据此改判定。

## 7. 停止条件

未命中。未改实现或守卫；未弱化断言；未 skip；未碰冻结计时契约；未写真库；未请求 5191。一次修复对应可观测行为：T8.5A 26 红变为本轮 27 绿，源码与 HTTP 同时对上契约。

## 8. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`。未改 session-summaries schema / 指纹。未改 90s TTL / renew 路由。未开浏览器。未写真库。未请求 5191。未改 T8.5A 守卫与 25 条旧 visibility 守卫。未 fallback。未 commit。

## 9. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-5c-verify-report.md`
- `docs/product-close-loop/evidence/phase8/t8-5c-verify-test-output.txt`

---

与 T8.5B 是否一致：是（独立复跑同为退出码 0、27/27/0 skip；时长不同）
守卫是否弱化：否
T8.5 通过/不通过：通过
建议：标 T8.5 verified
