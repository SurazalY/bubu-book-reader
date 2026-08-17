# Phase 0 演示账号与关键 id

密码在本文件中一律写作 `<REDACTED>`。

## 默认库备份

- 已存在：`server/data/readmate.sqlite`（4096 字节，各关键表行数均为 0）
- 备份：`server/data/readmate.sqlite.phase0-backup`
- `.gitignore` **未**覆盖 `*.sqlite` 或 `*.phase0-backup`。该备份不得提交。

备份前行数：

| 表 | 行数 |
|---|---|
| users | 0 |
| organizations | 0 |
| classes | 0 |
| books | 0 |
| reading_summary_sessions | 0 |
| reading_progress | 0 |

## bootstrap 调用说明

`package.json` 的 `bootstrap:internal` 指向 `server/db/bootstrap-internal-demo.js`，CLI **必须**提供 `--database` 与 `--manifest`。

本仓库没有 `delivery_manifest.json`。在系统临时目录写入空清单（`label=PUBLIC DOMAIN / INTERNAL TEST MATERIAL`，`books=[]`，`files=[]`），不入 Git。

`npm run bootstrap:internal -- --database ...` 在 npm 11.4.2 下把 `--database` 吃成 npm 自己的 cli config，脚本收不到参数。改为直接执行同一入口：

```
$env:INTERNAL_DEMO_PASSWORD='<REDACTED>'
node server/db/bootstrap-internal-demo.js --database server/data/readmate.sqlite --manifest <TEMP>/delivery_manifest.json --public-root public
```

退出码：0

## bootstrap 输出（密码已脱敏；displayName 以数据库为准）

```json
{
  "users": [
    {"username":"internal-student","displayName":"林小竹"},
    {"username":"internal-teacher-li","displayName":"李老师"},
    {"username":"internal-teacher-wang","displayName":"王老师"},
    {"username":"internal-principal","displayName":"陈校长"},
    {"username":"internal-ops-admin","displayName":"内部联调运营管理员"}
  ],
  "workspaceId":"internal-demo-workspace",
  "schoolWorkspaceId":"internal-demo-school-workspace",
  "platformWorkspaceId":"internal-demo-platform-workspace",
  "credentialsRotated":false,
  "catalog":{"imported":[],"unchanged":[],"publicRoot":"D:\\Project\\整书8.15\\public"}
}
```

catalog 为空是因为使用了空清单，仅初始化身份，未导入公版书。

## 登录端点（代码确认）

- 路径：`POST /api/v1/auth/login`（identity router 挂在 `/api/v1`）
- 请求体：`{"username":"<string>","password":"<string>"}`
- 必填头：`Idempotency-Key`、`Content-Type: application/json`
- Cookie 会话：成功后 Set-Cookie

## 三类账号登录结果

| 账号 | username | HTTP | user.id | activeWorkspaceId | navigation.defaultPath |
|---|---|---|---|---|---|
| 校长 | internal-principal | 200 | internal-principal | internal-demo-school-workspace | /console/home |
| 教师（李老师） | internal-teacher-li | 200 | internal-teacher-li | internal-demo-workspace | /console/home |
| 学生（林小竹） | internal-student | 200 | internal-demo-student | internal-demo-workspace | /student/home |

第二次直调（UTF-8 采集）requestId：

- 校长 `4dd54b22-796d-4985-89c9-1f5fecc56644`
- 教师 `31cd5806-c024-4abf-8071-f17b5bafc125`
- 学生 `a6e8fde5-f119-47f4-a8bf-70428845f3c8`

## 关键 id 对照表（来自 SQLite，非臆造）

| 账号名 | 角色 | user-id | org-id | class-id | workspace-id |
|---|---|---|---|---|---|
| internal-principal / 陈校长 | school_admin | internal-principal | internal-demo-organization | （校长不绑班级成员） | internal-demo-school-workspace |
| internal-teacher-li / 李老师 | teacher | internal-teacher-li | internal-demo-organization | internal-demo-class | internal-demo-workspace |
| internal-teacher-wang / 王老师 | teacher | internal-teacher-wang | internal-demo-organization | internal-demo-class | internal-demo-workspace |
| internal-student / 林小竹 | student | internal-demo-student | internal-demo-organization | internal-demo-class | internal-demo-workspace |
| internal-ops-admin | platform_ops | internal-ops-admin | internal-demo-organization | — | internal-demo-platform-workspace |

导入 Phase 1–3 建议使用：

- actor-id：`internal-principal`（`school_admin` 含 `book.import` + `book.publish`）
- workspace-id（校长登录后的工作空间）：`internal-demo-school-workspace`
- 组织 id：`internal-demo-organization`
- 班级 id：`internal-demo-class`

注意：任务简报把 workspace-id 括注为「组织 id」。代码里二者不同。导入器 `--workspace-id` 应传工作空间 id，不是组织 id。

## 进程状态（写本文件时）

- API：`npm run server` 仍在跑，`127.0.0.1:5191`（默认库 + 运行时注入的 `SESSION_TOKEN_SECRET`，无仓库 `.env`）
- 前端：`npm run dev` 仍在跑，Vite `http://127.0.0.1:5190/`
