# T8.6 收口验证报告

> 时间：2026-08-18
> Agent：Phase 8 T8.6 收口验证（只验证、只报告；未参与 T8.6A / T8.6B）
> 分支：`feat/product-close-loop`
> HEAD：`b3cd4b5`（与 09 §11.1 / T8.6B 报告前缀一致）
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未改前端实现。未改守卫 / 旧测 / 09 / ledger / decisions。未 commit。未开浏览器。未打 5191。未写真库。

## 1. 本轮允许产出

| 路径 | 动作 |
|---|---|
| `docs/product-close-loop/evidence/phase8/t8-6-verify-report.md` | 新建。本报告 |

未改任何其它文件。可选 TAP 落盘因 Windows 重定向编码损坏已删除，不以坏文件当证据；下列退出码与用例数来自本 agent 亲自运行的控制台 TAP。

## 2. 亲自运行的测试

### 2.1 T8.6A

```
node --test tests/frontend/phase8-t8-6a-identity-ui.test.mjs
```

| 项 | 本轮实测 |
|---|---|
| 退出码 | `0` |
| tests | 7 |
| pass / fail / skipped | 7 / 0 / 0 |
| 时长 | `duration_ms 96.9246` |

与 T8.6A 实现报告「退出码 0；tests 7 / pass 7 / fail 0」一致。不是抄报告。

### 2.2 T8.6B

```
node --test tests/frontend/phase8-t8-6b-class-shelf.test.mjs
```

| 项 | 本轮实测 |
|---|---|
| 退出码 | `0` |
| tests | 10 |
| pass / fail / skipped | 10 / 0 / 0 |
| 时长 | `duration_ms 97.3685` |

与 T8.6B 实现报告「退出码 0；tests 10 / pass 10」一致。时长不同（实现方写的是 100.4578），可确认是本轮重跑。

### 2.3 旧测（只登记，不改）

```
node --test tests/frontend/book-publish-visibility.test.mjs tests/frontend/api-contract.test.mjs
```

| 项 | 本轮实测 |
|---|---|
| 退出码 | `1` |
| tests | 19 |
| pass / fail / skipped | 17 / 2 / 0 |

见第 5 节。未为绿改测试。

## 3. 文件所有权

对照 09 §15：T8.6A 拥有 `src/console/pages/accounts/**`、登录与新增注册/onboarding、相关新前端测试；T8.6B 拥有 `src/console/pages/teaching/**`、`useBookVisibility.js`、`useBookWriteActions.js`、相关新前端测试。两边可并行但不得互碰。

### 3.1 6A 未碰 teaching / visibility hooks

工作区 teaching 与两个 hook 的 diff 全是本班书架：删除 `publishBook` / `unpublishBook` / `getBookVisibility` / `setBookVisibility`，改为 `loadClassShelf` / `putClassShelfBook` / `deleteClassShelfBook`。

`src/console/pages/accounts/**`、两个 `Login.jsx`、`Register.jsx`、`Onboarding.jsx`、`SelectClass.jsx` **没有** `useBookVisibility` / `useBookWriteActions` / teaching 引用。

### 3.2 6B 未碰 accounts / 登录注册

`src/console/pages/teaching/**`、`useBookVisibility.js`、`useBookWriteActions.js` **没有** `identityApi` / `identityUi` / `SelectClass` / `Register` / `Onboarding` / accounts 路径。

Login / Register / Onboarding / `accounts/**` 的 diff 是身份字段、选班、建班、审批、凭据，不是书架。

### 3.3 共享壳只见 6A 身份接线

`ConsoleApp.jsx` / `StudentApp.jsx` / `App.jsx` / `navigation.js` / `consoleAccess.js` 只增加 `select-class`、`accounts/classes`、`accounts/org`、`register/:token`、`onboarding`、`/join/:token`。无 teaching 改动。6B 报告未列这些文件。

### 3.4 T8.5 API 文件仍 dirty，不是本包互踩

`src/api/auth.js` / `console.js` / `student.js` 仍有未提交 diff：login body 改为 `{schoolCode,loginName,password}`；visibility 换成 shelf 三方法；补 registration / onboarding。两边实现报告都写未改这些文件。内容与已 verified 的 T8.5 一致，不记为 6A/6B 越界。

**结论：6A/6B 所有权干净。**

## 4. 抽查（源码，未开浏览器）

### 4.1 演示不写入文案已删 — 通过

`ClassList.jsx` / `ClassDetail.jsx` / `OrgAccounts.jsx` 无「演示环境不写入 / 不会 / 不提供 / 不写入任何」。建班走 `identityApi.createClass`；审批走 approve/reject；凭据走签发/撤销。

`BookImport.jsx` 无「演示环境」与「已提交导入」。上传按钮 `disabled`。文案改为「学校端本期不提供书库导入」。`ConsoleApp.jsx` 未挂该页。

残余（不记 T8.6 失败）：`RoleConfig.jsx` 仍写「演示环境不保存」，且保存只关弹窗。这是平台权限模板样例，不在 T8.6A 完成条件（建班/选班/审批/凭据重置）里，导航也未挂。usage 页仍有「演示环境不写入」，属 Phase 8 范围外。

### 4.2 Login 空 defaultPath 不当失败 — 通过（P8-21）

两个 Login 都调用 `authApi.login({ schoolCode, loginName, password })`，再用 `resolveLoginDestination`。该函数对空串 / 空白 / null / 非绝对路径返回 `null`。页面只在 `destination` 为真时 `navigate`；`null` 只 `clearFeedback()`，不进 catch，不把空路径当登录失败。

### 4.3 选班确认在 PUT 前 — 通过

`SelectClass.requestJoin`：`teacherCount>0` 只 `setPending(klass)` 并 return，不调用 `putJoin`。`teacherCount===0` 才直接 PUT。`ConfirmModal` 取消走 `onClose` → `setPending(null)`，不走 `onConfirm`。确认才 `putJoin` → `identityApi.joinTeacherClass`（PUT `/teacher/classes/:classId`）。写后用响应 `teacherCount` 刷新列表。

### 4.4 空书架规定文案 — 通过

`CLASS_SHELF_EMPTY_MESSAGE === '暂无已投放图书，请联系任课教师'`。`BookLibrary` 在空 catalog 或空本班 shelf 渲染 `ClassShelfEmptyHint`；`BookVisibilityPanel` 空 items 也渲染同一句。不空白、不报错。

### 4.5 学校端无全局 publish / visibility 按钮 — 通过

`src/console` 已无 `publishBook` / `unpublishBook` / `setBookVisibility` / `getBookVisibility` / `loadBookVisibility` / 「全组织可见」。

`canManageClassShelf` 仅 `scopeType==='class'`。`BookLibrary` 投放/撤下按钮包在 `manageShelf &&`；`BookDetail` 只在 `manageShelf && published` 挂本班面板；`BookVisibilityPanel` 非 class 直接 `return null`。校长/年级打开书库无投放、无全局发布/下架。

`bookManagement.js` 仍留旧 visibility 纯函数（`visibilityWriteBody` / `previewVisibilityImpact` 等），UI 不再调用。6B 已说明为未删旧断言依赖。不构成学校端按钮。

## 5. 旧测红：产品改判登记

未改这两份旧测。

| 失败 | 是否产品改判 | 说明 |
|---|---|---|
| `api-contract.test.mjs`「登录适配器只提交账号密码…」 | **是** | 仍锁 `{username,password}` 位置参数。T8.5 / P8-21 / §10.4 已改为 `{schoolCode,loginName,password}`。属 T8.5 遗留，不是 T8.6 回归。 |
| `book-publish-visibility.test.mjs` 整文件 | **是** | `import { loadBookVisibility }` 已不存在。学校端全局发布/visibility 已废（P8-13）；书架禁止 `listAuthorizedClasses`（P8-20）。改判为本班 GET shelf + PUT/DELETE。6B 未删断言。 |

两条与两边实现报告的登记一致。

## 6. 与实现方对照 / 遗留

实现方完成项本轮抽查均成立：D-24 班级/账号三页已改真调用；教师免审选班且 `teacherCount>0` 先确认；学生 token 注册必选预制班；登录三字段与空路径行为符合 P8-21；凭据 `rawToken` 只在当次签发结果里渲染；学校端无全局发布/visibility；空书架规定文案在。

实现方已登记、本轮确认仍在、**不挡 T8.6 收口**的遗留：

1. T8.3 缺三条管理端 GET（入班申请列表、凭据列表、重置凭据列表）。前端 404 走错误态：`ClassDetail` 用 `queueError` 显示「审批队列读取失败」，不把空队列当成功；`OrgAccounts` 凭据列表失败显示「凭据列表读取失败」。属 T8.3 热修，不是前端假成功。
2. T8.5 `GET /classes/:id/shelf` DTO 可无 `teacherCount`。初载常驻条可为「本班有 — 位教师可管理」；写后若响应带数字再刷新。
3. `RoleConfig.jsx` 仍是演示壳。非本期最小 UI。
4. `BookImport.jsx` 仍在 `teaching/**`，未挂路由，上传已禁用。
5. `GET /classes/:classId` 无 `teacherCount` 时，详情页从目录或 `GET /classes` 补人数（S/G 走 `listAuthorizedClasses`，教师走 class-directory）。符合 §10.4 班级目录分流，不是书架 F-1 违规。

未复跑 `console-zero-fixture.test.mjs`（不在必须命令里）。6A 称已同步清单；6B 曾把其中 1 红记为并行 6A，不记本包改判。

## 7. 停止条件

未命中第十六节与本任务相关条目。未改业务实现。未改旧测消红。未开浏览器。未打 5191。未写真库。未 skip。所有权未互踩。

## 8. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`。未改 session-summaries schema / 指纹。未改 90s TTL / renew。未开浏览器。未写真库。未打 5191。未改前端实现、守卫、09、ledger、decisions。未 commit。

---

与实现方是否一致：是
所有权是否干净：是
T8.6：通过
建议：verified
