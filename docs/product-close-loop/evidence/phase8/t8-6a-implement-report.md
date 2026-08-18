# T8.6A 身份/班级前端实现报告

> 时间：2026-08-18
> Agent：Phase 8 T8.6A 身份/班级前端实现
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未开浏览器。未起 5191。未写真库。未改 server / 迁移 / 守卫 / 09 / ledger。

## 1. 改动文件

| 路径 | 动作 |
|---|---|
| `src/console/pages/accounts/identityUi.js` | 新建。登录导航、选班确认、建班 body、年级主任文案、尾号/头像种子 |
| `src/console/pages/accounts/identityApi.js` | 新建。身份写/读薄封装，调用既有 `createApiClient`，**未改** T8.5 的 `auth.js` / `console.js` / `student.js` |
| `src/console/pages/SelectClass.jsx` | 新建。零班教师选班；`teacherCount>0` 先确认；取消不 PUT；写后 `teacherCount` 刷新 |
| `src/console/pages/accounts/ClassList.jsx` | 重写。`GET /classes` 真列表；`POST /classes` 真建班 `{name,stage,entryYear,classNumber}` |
| `src/console/pages/accounts/ClassDetail.jsx` | 重写。班级详情 + 审批队列（displayName / avatarSeed / 尾 4 位 / 注册时间） |
| `src/console/pages/accounts/OrgAccounts.jsx` | 重写。凭据签发/撤销、密码重置签发；`rawToken` 只渲染一次 |
| `src/console/pages/Login.jsx` | `schoolCode+loginName+password`；空 `defaultPath` 不再当登录失败 |
| `src/student/pages/Login.jsx` | 同上 |
| `src/student/pages/Register.jsx` | 新建。公开 `GET/POST /registration/:token`；学生必选预制班 |
| `src/student/pages/Onboarding.jsx` | 新建。pending → 等待审批；只读 `GET /onboarding/me` |
| `src/console/ConsoleApp.jsx` | 挂 `select-class`（壳外）、`accounts/classes`、`accounts/org` |
| `src/student/StudentApp.jsx` | 挂 `register/:token`、`onboarding`（Provider 外，避免零 workspace 误伤） |
| `src/App.jsx` | `/join/:token` → `/student/register/:token` |
| `src/console/state/navigation.js` | 账号管理增加班级、凭据与重置 |
| `src/console/state/consoleAccess.js` | 挂载新路径 |
| `tests/frontend/phase8-t8-6a-identity-ui.test.mjs` | 新建 |
| `tests/frontend/console-zero-fixture.test.mjs` | 班级三页已去 fixture 且可达，同步清单 |
| `docs/product-close-loop/evidence/phase8/t8-6a-implement-report.md` | 本报告 |

未改：`src/api/auth.js`、`src/api/console.js`、`src/api/student.js`；`src/console/pages/teaching/**`；`useBookVisibility.js` / `useBookWriteActions.js`；server / 迁移 / 09 / ledger / 真库。

## 2. 实测命令 / 退出码

### 2.1 本包新增 + 被改动文件影响的旧测

```
node --test tests/frontend/phase8-t8-6a-identity-ui.test.mjs
```

本 agent 亲自运行。退出码 **0**。tests 7 / pass 7 / fail 0。

```
node --test ^
  tests/frontend/phase8-t8-6a-identity-ui.test.mjs ^
  tests/frontend/stage5-route-wiring.test.mjs ^
  tests/frontend/console-zero-fixture.test.mjs ^
  tests/frontend/console-active-navigation.test.mjs
```

退出码 **0**。tests 31 / pass 31 / fail 0。

### 2.2 全量 `tests/frontend/*.mjs`（报告用）

```
node --test tests/frontend/*.mjs
```

退出码 **1**。tests 241 / pass 238 / fail 3。

| 失败 | 归属 | 说明 |
|---|---|---|
| `登录适配器只提交账号密码…`（`api-contract.test.mjs`） | T8.5 遗留 | 仍锁 `{username,password}`；本包未改 `auth.js` |
| `book-publish-visibility.test.mjs` 整文件 | T8.6B / T8.5 遗留 | `loadBookVisibility` 导出已不在；本包未改 visibility hook |
| `学生和书目详情挂到真实权限端路由…` | **本包曾带红，已修** | `consoleAccess` 合并了 students 正则；已拆回原 `accounts\/students\/[^/]+` 写法后复跑绿 |

未起 npm / 5191。未开浏览器。

## 3. 实测 vs 推断

**实测**

- 上表 node --test 退出码与用例数。
- 账号三页源码已无「演示环境不写入 / 不会 / 不提供 / 不写入任何」。
- 两个 Login 调用 `authApi.login({ schoolCode, loginName, password })`，并用 `resolveLoginDestination`；空路径不 throw。
- `identityApi` 对 class-directory / join / create class / enrollment / credentials / password-reset 的路径与幂等键有单测。

**推断**

- 浏览器真人登录、选班确认弹窗、签发 rawToken 的一次性展示，需用户操作；本包未开浏览器。
- `GET /classes/:classId/enrollment-requests`、`GET /registration-credentials`、`GET /users/:userId/password-reset-credentials` 在 T8.3 identity router **没有对应 GET**。前端按 §12.2 调用；真 HTTP 会 404，页面展示服务端错误，不把空列表当成功。
- `GET /classes/:classId` 的 class DTO 不含 `teacherCount`。详情页改从 `GET /teacher/class-directory`（教师）或 `GET /classes`（S/G）补人数。
- 被拒学生「再选预制班」需要登录后的班级目录；现网只有公开 token 目录。Onboarding 只展示 rejected，不另造班级名单。

## 4. 完成项

| 项 | 结果 |
|---|---|
| 删除四处演示不写入文案并改真 API | **pass** |
| 教师零班 `/console/select-class`；目录 + teacherCount；>0 先确认；取消不 PUT；写后刷新 | **pass**（前端） |
| 学生 token 注册；选预制班；pending → `/student/onboarding` | **pass** |
| 审批队列展示 displayName / avatarSeed / 尾 4 位 / 注册时间 | **pass**（UI 已做；列表 GET 待 T8.3） |
| 登录 schoolCode+loginName+password；空 defaultPath 不当失败 | **pass** |
| 校长/年级主任真建班；凭据签发/撤销；重置签发；rawToken 只显示一次 | **pass**（签发 POST 已接；历史列表 GET 待 T8.3） |
| 年级主任两项 school 例外；UI 不暗示跨届管班或管书架 | **pass** |
| 不做书架 / 转班 / 家长 / 复杂协作 | **pass** |

## 5. 遗留

1. T8.5 未把身份写方法补进 `console.js`。本包未改该文件，在允许目录新建 `identityApi.js`。
2. T8.3 缺三条管理端 GET：入班申请列表、凭据列表、重置凭据列表。
3. 被拒后再选班缺少 session 班级目录。
4. 全量 frontend 仍有 2 条 T8.5/T8.6B 旧红，与本包无关。

## 6. 停止条件

未因本包实现命中第十六节。未改守卫才绿。未写真库。未开浏览器。未 skip。未把空列表当成功。T8.3 缺 GET 登记为遗留，不是用假数据填绿。

## 7. 红线声明

未改 `reading_summary_sessions` / `reading_daily_book_summaries`；未改 session-summaries schema / 指纹；未改 90s TTL / renew。未开浏览器。未写真库。未打 5191。未改 teaching / visibility hooks。

---

前端测试绿（本包 7/7；受影响旧测复跑 31/31。全量 238/241，剩余 2 红属 T8.5/T8.6B 旧账）
停止条件未命中
建议 T8.6A 收口验证
