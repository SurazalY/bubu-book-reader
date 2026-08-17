# Phase 2B 任务 0：资产链路端到端验通

执行时间：2026-08-17（Phase 2B 子 agent）

## 1. 重启前后进程处理

### 重启前（任务开始时占用端口）

```
LocalPort OwningProcess State
     5191         44164 Listen
     5190         49744 Listen
```

已执行 `Stop-Process -Id 44164,49744 -Force`。

### 首次重启后（`.env` 仍为 `PUBLIC_ASSET_DIR=public`）

- 后端：`npm run server`，npm PID 56044 → node PID 49440，监听 5191
- 前端：`npm run dev`，npm PID 40868 → 因 5190 仍被旧进程 41296 占用，Vite 退避到 **5192**（node PID 53180）

### 配置修正

发现 `PUBLIC_ASSET_DIR=public` 经 `server/app.js` 解析为 `D:\Project\整书8.15\server\public`（不存在），而非仓库根 `public/`。已将 `.env` 改为：

```
PUBLIC_ASSET_DIR=../public
```

### 最终干净重启

结束全部相关进程（含 41296、54840、53180 等）后重新启动：

- 终端 A：`npm run server`（npm PID 54344 → node PID **36256**，5191）
- 终端 B：`npm run dev`（npm PID 27688 → node PID **40496**，5190）

```
TCP    127.0.0.1:5190    LISTENING    40496
TCP    127.0.0.1:5191    LISTENING    36256
```

## 2. 后端实际生效的资产根

```
D:\Project\整书8.15\public
```

验证方式：`path.resolve(serverDirectory, process.env.PUBLIC_ASSET_DIR)`，其中 `PUBLIC_ASSET_DIR=../public`。

磁盘文件存在且大小与 DB 登记一致：

| 文件 | 大小（字节） |
|---|---:|
| `public/books/pilot/book-001/book-001-trusted-v1/cover.jpg` | 128977 |
| `public/books/pilot/book-001/book-001-trusted-v1/source.pdf` | 115394634 |

## 3. Health 检查

```
GET http://127.0.0.1:5191/api/v1/health
Status: 200
{"data":{"status":"ok","database":"sqlite","migrations":29},"meta":{"requestId":"28a5e239-9d52-479c-82d3-b97492d6e6ac","serverTime":"2026-08-17T06:38:12.062Z"}}
```

## 4. 登录（学生，密码 `<REDACTED>`）

```
POST http://127.0.0.1:5191/api/v1/auth/login
Headers: Idempotency-Key: <uuid>, Content-Type: application/json
Body: {"username":"internal-student","password":"<REDACTED>"}
Status: 200
```

## 5. 受保护封面资产

```
GET http://127.0.0.1:5191/api/v1/books/assets/book-001-trusted-v1%3Aasset%3Acover
Headers: Cookie: <session>, X-Workspace-Id: internal-demo-workspace
Status: 200
Content-Type: image/jpeg
Content-Length: 128977
```

## 6. 受保护源 PDF（HEAD，未下载正文）

```
HEAD http://127.0.0.1:5191/api/v1/books/assets/book-001-trusted-v1%3Aasset%3Asource-pdf
Headers: Cookie: <session>, X-Workspace-Id: internal-demo-workspace
Status: 200
Content-Type: application/pdf
Content-Length: 115394634
```

## 7. Range 分片（pdfjs 依赖）

```
GET http://127.0.0.1:5191/api/v1/books/assets/book-001-trusted-v1%3Aasset%3Asource-pdf
Headers: Cookie: <session>, X-Workspace-Id: internal-demo-workspace, Range: bytes=0-1023
Status: 206
Content-Type: application/pdf
Content-Length: 1024
Content-Range: bytes 0-1023/115394634
```

## 8. 公开路径 404 验证（硬契约）

### 后端 Express（预期 404）

```
GET http://127.0.0.1:5191/books/pilot/book-001/book-001-trusted-v1/source.pdf
Status: 404
```

### 前端 Vite dev（契约要求非 200，实际 **200**）

```
GET http://127.0.0.1:5190/books/pilot/book-001/book-001-trusted-v1/source.pdf
Status: 200
Content-Length: 115394634
Content-Type: application/pdf
```

> 说明：Vite 开发服务器默认将仓库 `public/` 目录映射到站点根路径，导致 PDF 在未鉴权情况下可直接访问。此行为与产品硬契约不符，已记入 Phase 2B 问题清单（不在本任务范围内修复）。

## 9. 修正前失败对照（`PUBLIC_ASSET_DIR=public` 时）

```
GET .../books/assets/book-001-trusted-v1%3Aasset%3Acover
Status: 404
{"error":{"code":"RESOURCE_NOT_FOUND","message":"书籍资产文件不存在",...}}
```

原因：运行时查找 `server/public/books/...`（目录不存在）。
