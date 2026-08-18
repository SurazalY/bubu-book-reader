# T8.10 前端热修报告

> 时间：2026-08-18
> Agent：Phase 8 T8.10 前端热修执行者
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。
> 未 commit。未开浏览器。未起 5191。未写真库。未改 server / 迁移 / package.json / 09 / decisions / ledger。

用户真人验收提了 5 条界面问题。凭据/入班/选班 API 已通；本包只补入口、文案和浮层。报告不复述任何用户截图中的注册码原文。

## 1. 改动文件

| 路径 | 动作 |
|---|---|
| `src/student/pages/Login.jsx` | 增加「凭据注册」→ `/student/register` |
| `src/console/pages/Login.jsx` | 同上，不新建 `/console/register` |
| `src/student/StudentApp.jsx` | 增加无 token 的 `path="register"`，保留 `register/:token` |
| `src/student/pages/Register.jsx` | 无 path token 先收注册码再 `getRegistration`；有 path token 只读预填；学生/教师仍由 token 决定 |
| `src/console/components/shell/TopBar.jsx` | 父菜单锁 `absolute top-full right-0`；子层 `right-full`；增加「管理任教班级」 |
| `src/console/pages/SelectClass.jsx` | `listWorkspaces` 判定已加入；已加入显示「已加入」+「退出」；`leaveTeacherClass` |
| `src/console/pages/accounts/OrgAccounts.jsx` | 去掉顶部裸 token / `/join/` 大盒；签发行一次展示注册码；历史行折叠内部编号 |
| `src/console/pages/accounts/identityUi.js` | 增加 joined / 签发揭示 helper；`registrationJoinPath` 保留给旧测 |
| `tests/frontend/phase8-t8-6a-identity-ui.test.mjs` | 扩展，未删旧断言 |
| `tests/frontend/phase8-t8-10-ui.test.mjs` | 新建源码与 helper 断言 |
| `docs/product-close-loop/evidence/phase8/t8-10-ui-hotfix-report.md` | 本报告 |

未改：`src/App.jsx`（`/join/:token` 已在）、`src/api/**`、`server/**`、导航 allow 矩阵、`nav.js`。

## 2. 实测命令 / 退出码 / 用例数

本 agent 亲自运行。cwd = 仓库根。未抄旧报告。

```
node --test tests/frontend/phase8-t8-6a-identity-ui.test.mjs
```

退出码 **0**。tests 7 / pass 7 / fail 0。

```
node --test tests/frontend/phase8-t8-10-ui.test.mjs
```

退出码 **0**。tests 6 / pass 6 / fail 0。

```
npm run test:frontend
```

退出码 **0**。tests 270 / pass 270 / fail 0。

未起 npm dev / 5191。未开浏览器。未连真库。

## 3. 实测 vs 推断

**实测**

- 上表三条命令的退出码与用例数。
- 两个 Login 源码含 `/student/register` 与「凭据注册」。
- StudentApp 同时有 `path="register"` 与 `path="register/:token"`。
- Register 在 `!activeToken` 时不调用 `getRegistration(token)` / `getRegistration(undefined)`。
- TopBar 不再使用会左移的 `flex items-start justify-end`；父层 `absolute top-full right-0`，子层 `right-full`。
- SelectClass 含 `leaveTeacherClass`、`listWorkspaces`、「已加入」「退出」。
- OrgAccounts 历史行不以 `item.id` 作主列可抄注册码；签发行有「注册码」与「内部编号，不是注册码」。
- `mergeIssuedCredentialRow` 不把 `rawToken` 写入列表行对象。

**推断**

- 胶囊 hover/click、子层是否贴着视口中央、复制按钮在具体浏览器里是否授权，需真人点。本包未开浏览器。
- `leaveTeacherClass` 的 200 / 幂等 200 / 残缺 500 走现有 API client：非 2xx 抛错后原样展示 `cause.message`。未打真 HTTP。
- `GET /workspaces` 的 `scopeType`/`scopeId` 以当前 identity DTO 为准；未改后端 directory。

## 4. 五条逐项

| 条 | 行为 | 结果 |
|---|---|---|
| 1+5 | 登录进注册；token 在表单里填，不再只靠地址栏；`/join/:token` 保留 | **pass** |
| 2 | 切换工作空间时父弹窗不位移 | **pass**（源码布局） |
| 3 | 已入班教师能再进选班并能退班；退光留本页 | **pass** |
| 4 | 校长凭据页：注册码与凭据编号分开；G10 不落历史列表 | **pass** |

## 5. 遗留

1. 未做浏览器真人验收。
2. 选班页仍在 ConsoleProvider 外；已加入集合来自 `listWorkspaces`，不改 allow 矩阵。
3. 校长若不是教师 V，点「管理任教班级」可能看到目录接口拒绝；这是既有 API 身份，不是本包能改的前端缺口。
4. 用户截图里已暴露的注册码应视为泄露，须由校长在凭据页撤销后重签。本报告不复述该原文。

## 6. 停止条件

未触发。五条都能只改前端完成。没有弱化 G10，没有把 token 写入历史列表或 localStorage。

## 7. 未触碰红线

未改 `server/**`、迁移、`package.json`、`09`、`decisions.md`、`execution-ledger.md`。未写真库、未重启 5191、未 bootstrap、未 commit / push / reset。未新建 `/console/register`。未全局 grant，未删旧用例。

## 8. 证据路径

`docs/product-close-loop/evidence/phase8/t8-10-ui-hotfix-report.md`
