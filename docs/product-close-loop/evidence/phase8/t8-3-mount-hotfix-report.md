# T8.3 挂载热修报告

> 时间：2026-08-18
> Agent：Phase 8 T8.3 挂载热修（T8.3 已 verified；修 T8.5A 发现的 identity catch-all 吞掉后续 `/api/v1` router）
> 分支：`feat/product-close-loop`
> HEAD 前缀：`b3cd4b5`
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未改 T8.3A / T8.4A / T8.5A 守卫。未改 integration-router、projections、`src/api/**`。未改 09 / decisions / ledger。未连真库。未打 5191。

这不是产品改判。09「删除 POST /students 后由标准不存在路由返回 404」指**全部 API router 之后**的 JSON 404，不是 identity 在自己末尾把后续路由吞掉。

## 1. 改动文件清单

| 路径 | 动作 |
|---|---|
| `server/domains/identity/index.js` | 删除 identity router 末尾 catch-all `router.use(route(() => throw notFound(...)))`。未匹配请求落到 `next()`。保留 4 参 error handler（`isHttpError` → `sendFailure`）。抽出 `sendApiNotFound`：与现网 `notFound(RESOURCE_NOT_FOUND_MESSAGE)` 同码同文案。`createIdentityTestApp` 在 `app.use('/api/v1', module.router)` **之后**挂这一层，只挂 identity 的守卫里 POST /students / 缺失路由仍是标准 JSON 404，不是 Express HTML |
| `server/app.js` | `createReadmateApplication` 在 `identity.router` 与 `integration.router` **两者之后**、静态/SPA 之前挂同一层 `/api/v1` JSON 404，避免未知 API 掉进 `index.html` |
| `docs/product-close-loop/evidence/phase8/t8-3-mount-hotfix-report.md` | 本报告 |
| `docs/product-close-loop/evidence/phase8/t8-3-mount-hotfix-guard-test-output.txt` | T8.3A 守卫 UTF-8 TAP |
| `docs/product-close-loop/evidence/phase8/t8-3-mount-hotfix-identity-core-output.txt` | 旧 identity 测试 UTF-8 TAP |
| `docs/product-close-loop/evidence/phase8/t8-3-mount-hotfix-probe-output.txt` | `createReadmateApplication` 临时库 `listen(0)` 探测原文 |

未改：T8.3A / T8.4A / T8.5A 守卫、`integration-router.js`、`projections.js`、`src/api/**`、reading/community、迁移、permissions、09、`decisions.md`、`execution-ledger.md`、真库、5191。未实现 shelf，未删 visibility，未改投影，未改 API client。

过程脚本 `_t8-3-mount-hotfix-probe.mjs` 只用于本轮探测，写完证据后删除，不落地。

## 2. 最小改动说明

**之前：** identity router 末尾 `router.use(route(() => throw notFound('资源不存在')))` 吃掉所有未匹配请求。`app.js` 虽先挂 identity 再挂 integration，`/books`、`/community`、`/assignments`、shelf 永远到不了 integration。

**之后：**

1. identity 未匹配 → `next()` → 下一个 `app.use('/api/v1', …)`。
2. identity 内部 error handler 不动：路由内抛出的 `HttpError` 仍 `sendFailure`。
3. 只挂 identity 的测试应用：router 之后补 `sendApiNotFound`，POST /students 仍是 `404 RESOURCE_NOT_FOUND`「资源不存在」。
4. 现网应用：identity + integration 都挂完后、静态/SPA 前补同一层。未知 API 不再掉进 SPA。

`sendApiNotFound` 直接 `sendFailure`，不 throw，避免已经离开 identity router 后无人收错误。

## 3. 实测命令、退出码、用例数

全部由本 agent 亲自运行。未抄 T8.3C / T8.5A 输出。

### 3.1 T8.3A 守卫

```
node --test tests/server/core/phase8-identity-guards/**/*.guard.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests（含无 `test()` 的 harness 文件级条目） | 71 |
| pass / fail / skipped | 71 / 0 / 0 |
| 其中真实 `test()` | 70 绿 / 0 红 |
| 时长 | `duration_ms 3318.3862`（证据文件） |
| 真库 / 5191 | 未打开写、未请求 |

关键输出原文：

```
1..71
# tests 71
# suites 0
# pass 71
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3318.3862
```

与本热修直接相关的守卫仍绿：

- `ok 49 - J. 缺失路由不得 fallback 成 200；POST /students 也不得再 200`
- `ok 58 - B. identity router 不得再注册 POST /students（无兼容 handler / 假 404 分支）`
- `ok 59 - B. POST /students 必须由标准不存在路由返回 404，且不能再物化已入班学生`

未改守卫。未靠改测试消红。

### 3.2 旧 identity 契约测试

```
node --test tests/server/core/identity-core.test.js tests/server/core/identity-role-boundary.test.js
```

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests | 11 |
| pass / fail / skipped | 11 / 0 / 0 |
| 时长 | `duration_ms 2724.5056` |

### 3.3 createReadmateApplication 越过 identity 到达 integration

自写一次性探针：`createReadmateApplication({ databasePath: 临时库, serveStatic: false })` + `listen(0)`。路径 `C:\Users\Yak\AppData\Local\Temp\readmate-t83-hotfix-JEbsNG\probe.sqlite`。端口 **53523**，不是 5191。种子只写进该临时库。探测完关库并删除临时目录。

选现网已有、不依赖 T8.5 新路由的 `GET /api/v1/books`（integration-router 书目录，不是 shelf / visibility 新契约）。

| 请求 | 状态码 | 码 / 说明 |
|---|---|---|
| `GET /api/v1/health` | **200** | identity 仍处理 `/health` |
| `GET /api/v1/books` 无会话 | **401** | `AUTH_REQUIRED`「需要有效登录会话」——已打到 integration 的 `requireSession`。旧 catch-all 会是 404「资源不存在」 |
| `POST /api/v1/auth/login` | **200** | schoolCode + loginName |
| `GET /api/v1/books` 登录后 + `X-Workspace-Id` | **200** | `data.items` 长度 0（空书库仍是书目录 200）。这就是 T8.5A `requireIntegrationReachable` 要的信号 |
| `GET /api/v1/__t83-hotfix-missing-*` 无会话 | **401** | integration 全局 `requireSession` 先于应用级 404；JSON，不是 `index.html` |
| `GET /api/v1/__t83-hotfix-missing-*` 登录后 | **404** | `RESOURCE_NOT_FOUND`「资源不存在」——全部 router 之后的标准 JSON 404 |
| `POST /api/v1/students` 登录后 | **404** | 同码同文案。09 / P8-18R 仍成立 |

结论：**integration 可达。** 登录后 `GET /books` = **200**。

## 4. 未做 / 边界

- 未实现 shelf，未删 visibility HTTP，未改投影，未改 API client。
- 未改 integration-router 的全局 `requireSession`。因此**无会话**的未知 `/api/v1` 仍是 integration 的 401，不是应用级 404。有会话后才落到 `sendApiNotFound`。这与「未知 API 不得掉进 SPA」一致，也不是本热修范围。
- 未跑 T8.5A（禁止改那套守卫；本任务也不复验 T8.5 契约红）。修好挂载后，T8.5A 的 `requireIntegrationReachable` 应变绿，其余 A–G 应回到契约本身（旧 visibility 仍在、投影/API 未改）。
- 未跑 server 全量，未重启 5191。

## 5. 建议

T8.3A 仍绿，integration 书目录已可达。挂载缺陷已消除，**建议主控继续派 T8.5B**。不要停手在本挂载问题上。
