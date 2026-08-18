# T8.6B 教师书架前端实现报告

> 时间：2026-08-18
> Agent：Phase 8 T8.6B 教师书架前端实现（删除学校端全局发布/visibility UI，改本班投放/撤下 + teacherCount 轻量提示）
> 分支：`feat/product-close-loop`
> HEAD 前缀：`b3cd4b5`
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未改 T8.6A / API client / server / 守卫 / 09 / ledger。未连真库。未打 5191。未开浏览器。

## 1. 改动文件清单

| 路径 | 动作 |
|---|---|
| `src/console/state/useBookVisibility.js` | 删除 `getBookVisibility` + `listAuthorizedClasses`。改为 `loadClassShelf` → 只调用 `getClassShelf(classId)`；无 classId 不发请求。 |
| `src/console/state/useBookWriteActions.js` | 删除 `publishBook` / `unpublishBook` / `setBookVisibility`。改为本班 `putClassShelfBook` / `deleteClassShelfBook`；写后读取并记住 `teacherCount`。 |
| `src/console/pages/teaching/bookManagement.js` | 新增 class-shelf 纯函数：`canManageClassShelf`、`readTeacherCount`、`formatClassTeacherCount`、空书架文案、缺方法停手。保留旧 visibility 纯函数，未删旧断言依赖。 |
| `src/console/pages/teaching/BookVisibilityPanel.jsx` | 重写为本班书架面板：常驻 teacherCount、投放/撤下、空书架说明。非 class workspace 直接 `return null`。 |
| `src/console/pages/teaching/BookLibrary.jsx` | 删除下架/重新发布。教师本班：投放 PUT、撤下 DELETE。校长/年级（school/grade）无投放按钮。空态显示规定文案。 |
| `src/console/pages/teaching/BookDetail.jsx` | 删除全局发布/下架按钮与 ConfirmModal。仅 class + published 挂本班书架面板。 |
| `src/console/pages/teaching/BookImport.jsx` | 删除「演示环境不写入」与假成功「已提交导入」。上传按钮禁用。 |
| `src/console/pages/teaching/TeacherReader.jsx` | 不可读提示改为发布/本班投放，不再叫学校端重新发布。 |
| `src/console/pages/teaching/ArrangeList.jsx` | 选书说明改为已发布/未发布，去掉已上架/已下架。 |
| `tests/frontend/phase8-t8-6b-class-shelf.test.mjs` | 新建。10 条：API 方法、scope 门、空态、GET/PUT/DELETE 形、幂等键、错误文案、源码扫描。 |
| `docs/product-close-loop/evidence/phase8/t8-6b-implement-report.md` | 本报告 |

未改：`src/api/console.js`（T8.5，只调用）、`src/console/pages/accounts/**`、登录/注册/onboarding、T8.6A、`server/**`、迁移、守卫、09、`decisions.md`、`execution-ledger.md`、真库、5191。未引入教师审批状态。

`console.js` 已有 `getClassShelf` / `putClassShelfBook` / `deleteClassShelfBook`，未缺方法，未停手。

## 2. 实测命令 / 退出码 / 用例数 / 关键原文

### 2.1 新建前端测试（完成必要条件）

```
node --test tests/frontend/phase8-t8-6b-class-shelf.test.mjs
```

本 agent 亲自运行。退出码 **0**。

| 项 | 实测 |
|---|---|
| 退出码 | `0` |
| tests | 10 |
| pass / fail / skipped | 10 / 0 / 0 |
| 时长 | `duration_ms 100.4578` |
| 真库 / 5191 / 浏览器 | 未打开写、未请求、未开 |

关键输出原文：

```
1..10
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 100.4578
```

### 2.2 受影响旧前端测试（未为绿删断言）

```
node --test tests/frontend/book-publish-visibility.test.mjs tests/frontend/stage5-route-wiring.test.mjs tests/frontend/book-cover-protected-asset.test.mjs tests/frontend/console-zero-fixture.test.mjs tests/frontend/reading-monitor-completion-semantics.test.mjs tests/frontend/phase8-t8-5b-api-envelope.test.mjs
```

合计 36 条：pass 34 / fail 2。未改这些旧文件。

| 文件 | 结果 | 说明 |
|---|---|---|
| `phase8-t8-6b-class-shelf.test.mjs` | 绿 10/10 | 本包 |
| `phase8-t8-5b-api-envelope.test.mjs` | 绿 3/3 | 未改 API client |
| `book-cover-protected-asset.test.mjs` | 绿 | 封面仍走受保护资产 |
| `stage5-route-wiring.test.mjs` | 绿 | BookLibrary/BookDetail 无演示文案 |
| `reading-monitor-completion-semantics.test.mjs` | 绿 | 未引入完成度字段 |
| `book-publish-visibility.test.mjs` | **整文件红** | 见第 5 节产品改判。未删断言 |
| `console-zero-fixture.test.mjs` | 1 红 | `classList`/`classDetail` fixture 清单变化。**非本包**：未改 `accounts/**`，属并行 T8.6A / 既有工作区 |

`book-publish-visibility.test.mjs` 关键原文：

```
SyntaxError: The requested module '../../src/console/state/useBookVisibility.js' does not provide an export named 'loadBookVisibility'
```

## 3. 实测 vs 推断

**实测**

- 上表新建 10/10 exit 0。
- `createConsoleApi()` 具备三方法，无 `getBookVisibility` / `setBookVisibility`。
- `loadClassShelf` 只打 `getClassShelf`；无 classId 时 0 次网络。
- PUT `/classes/:classId/shelf/:bookId`、DELETE 同路径；body 不含 `classIds` 全量集合。
- `canManageClassShelf`：class 真，school/grade/platform 假。
- 空书架常量：`暂无已投放图书，请联系任课教师`。
- teaching 源码已无 `publishBook`/`unpublishBook`/`getBookVisibility`/`setBookVisibility`/`listAuthorizedClasses`/`全组织可见`/`演示环境`。
- 封面保护与 stage5 接线旧测仍绿。

**推断**

- GET `/classes/:classId/shelf` 的 T8.5 DTO 只有 `items`，不含 `teacherCount`。初载常驻条显示「本班有 — 位教师可管理」；若写响应带 `teacherCount` 则刷新为数字。`GET /teacher/class-directory` 有人数但 `console.js` 无该方法（T8.6A 选班侧），本包按「只调用、不改 API client」未自造。
- 校长/年级打开书库时 `listBooks` 因默认全闭可能为空；页面走规定空文案，不报错、不给投放/发布按钮。未起 5191，未用浏览器点过。
- 教师 `GET /classes` 为 403，本包不调用 `listAuthorizedClasses`。

## 4. 契约对照

| 项 | 本轮 |
|---|---|
| 删除学校端全局发布/下架按钮与旧 visibility UI/调用 | 绿。hooks 与 BookLibrary/BookDetail/Panel 已无 publish/unpublish/visibility |
| 教师本班上架 PUT、下架 DELETE，只影响本班 | 绿。只打 class-local shelf；确认文案写明其他班不受影响 |
| 班级页常驻「本班有 N 位教师可管理」 | 绿。`formatClassTeacherCount` + `ClassTeacherCountBanner`。写后 `applyTeacherCount` |
| 加入已有教师确认留给 T8.6A；不引入审批 | 绿。无 pending/approved/`teacher.affiliation.approve` |
| 空书架规定文案 | 绿。空 catalog / 空本班 shelf 至少显示该句，不空白、不报错 |
| 校长/年级主任无本班投放/全局发布入口 | 绿。`scopeType!=='class'` 不渲染投放；无全局发布按钮 |
| 删除 teaching 范围内「演示环境不写入」 | 绿。BookImport 已清，上传禁用，无假成功 |

## 5. 遗留与产品改判登记

**遗留**

- 初载 `teacherCount` 依赖 shelf GET 或写响应。T8.5 GET shelf 现网不带该字段；目录读方法不在本包 API client。收口验证可看写后刷新与常驻条，不必本包改 `console.js`。
- BookImport 仍在 `teaching/**` 且用 fixture 样例，但未挂 `ConsoleApp` 路由；上传已禁用。
- 旧 `book-publish-visibility.test.mjs` 整文件因产品改判变红，留给收口验证对照，**未删断言**。

**产品改判（旧测，未为绿而改测试）**

`tests/frontend/book-publish-visibility.test.mjs` 整文件未能实例化。逐条：

1. 「发布、下架、设置可见范围三个写操作都带 Idempotency-Key」——学校端不再调 `publishBook`/`unpublishBook`/`setBookVisibility`。改判：本班 PUT/DELETE + 自带幂等键。
2. 「可见范围班级选择器走 GET /classes」——教师调 `GET /classes` 403；书架禁止 `listAuthorizedClasses`（P8-20）。改判：只 `GET /classes/:id/shelf`。
3. 「收窄可见范围基于 references」——全量 visibility 废止（P8-13）。纯函数 `previewVisibilityImpact` 仍留在 `bookManagement.js`，UI 不再用。
4. 「可见范围编辑页保存前确认」——`BookVisibilityPanel` 已改本班投放/撤下，不再有「全组织可见 / 保存前确认影响」。
5. 「封面裸 img」——Panel 已无封面；Library/Detail 仍绿（`book-cover-protected-asset`）。
6. 幂等键袋 / `HUMAN_REVIEW_REQUIRED` / `visibilityWriteBody` / 年级筛选 / stage4 published+draft 合并——未改这些纯函数与 stage4；若文件能 import 应仍绿，本次因第 1 条 import 未跑到。
7. 「教师端发布管理页面…`<BookVisibilityPanel>` / 草稿阅读器」——详情仍挂 Panel，但不再是 visibility 编辑；书库不再展示草稿/重新发布（教师只列 published）。
8. 「GET /visibility 失败则整次加载失败」——`loadBookVisibility` 已删除，改为 `loadClassShelf`。

`console-zero-fixture` 的 classList/classDetail fixture 差与本包无关，不登记为本包改判。

## 6. 停止条件

未命中。分支 `feat/product-close-loop`，基线 HEAD `b3cd4b5`。允许文件开工时无重叠改动。shelf 三方法已在 T8.5 client，未缺方法。未改禁止文件。未连真库。未打 5191。未开浏览器。无 skip。无吞错/假成功。未为绿删旧断言。

## 7. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`。未改 session-summaries schema / 指纹。未改 90s TTL / renew。未开浏览器。未写真库。未打 5191。未 skip。未 commit。未改 T8.5 API client、T8.6A、accounts、登录注册、server、迁移、守卫、09、ledger。未引入教师审批状态。

## 8. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-6b-implement-report.md`
- `tests/frontend/phase8-t8-6b-class-shelf.test.mjs`

---

前端测试绿 10 / 红 0（新建）；旧测 book-publish-visibility 整文件红（产品改判，未删断言）；console-zero-fixture 1 红非本包
停止条件未命中
建议 T8.6B 收口验证
