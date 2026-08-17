# Phase 2A 资产根目录决策

## 代码实际解析逻辑

`server/index.js` 启动时加载 `dotenv/config`，随后调用 `createReadmateApplication()`，无额外覆盖。

`server/app.js` 第 21–25 行：

```js
const distDirectory = path.resolve(serverDirectory, options.distDirectory ?? process.env.DIST_DIR ?? '../dist')
const publicAssetDirectory = path.resolve(
  serverDirectory,
  options.publicAssetDirectory ?? process.env.PUBLIC_ASSET_DIR ?? distDirectory,
)
```

**结论**：未设置 `PUBLIC_ASSET_DIR` 时，运行时资产根 **不是** `public/`，而是 **`dist/`**（相对 `server/` 的 `../dist`）。

## 采用方案

在仓库根 `.env` **新增一行**（不改动既有 `SESSION_TOKEN_SECRET` / `INTERNAL_DEMO_PASSWORD`）：

```
PUBLIC_ASSET_DIR=../public
```

导入命令使用 `--public-root public`。注意两者写法不同却指向同一目录，原因见下节。

## 两个基准不同（本阶段踩过的坑）

同一个"相对路径"在两条链路上的解析基准**不一样**：

| 链路 | 解析基准 | 写 `public` 得到 | 写 `../public` 得到 |
|---|---|---|---|
| 服务端 `PUBLIC_ASSET_DIR`（`path.resolve(serverDirectory, ...)`） | `server/` 目录 | `D:\Project\整书8.15\server\public`（不存在） | `D:\Project\整书8.15\public` ✅ |
| 导入器 `--public-root`（相对进程 CWD） | 仓库根（在根目录执行时） | `D:\Project\整书8.15\public` ✅ | 错误目录 |

所以正确组合是 **服务端 `../public` + 导入器 `public`**。

本文件初版曾断言 `PUBLIC_ASSET_DIR=public` 会解析到仓库根 `public/`，**该结论是错的**：它只比对了两个值的字符串形式，未发真实 HTTP 请求验证。Phase 2B 以真实请求复现了后果——受保护封面/PDF 接口全部返回 404，因为运行时在不存在的 `server/public/books/...` 下找文件。改为 `../public` 后封面 200、PDF 200、Range 206 均通过（原文见 `asset-endpoint-verification.md`）。

**教训**：资产根这类路径配置，必须以一次真实资源请求（返回 200 + 正确 Content-Length）作为验证手段，不能靠推演路径字符串。

## 一致性证明

| 项 | 绝对路径 |
|---|---|
| 运行时资产根（`PUBLIC_ASSET_DIR=../public`） | `D:\Project\整书8.15\public` |
| 导入 `--public-root public` 解析结果 | `D:\Project\整书8.15\public` |

首次导入 JSON 输出确认：

```json
{"imported":true,"unchanged":false,"bookId":"book-001","versionId":"book-001-trusted-v1","releaseSha256":"05941212b7f9cf33b6d7d52042c41cfb9bfad523e97c676fe96e502a902842d6","publicRoot":"D:\\Project\\整书8.15\\public"}
```

磁盘核对脚本以同一根目录拼出资产路径，PDF/封面均存在且哈希一致。

## 当前运行中服务

Phase 2B 已按修正后的 `.env`（`PUBLIC_ASSET_DIR=../public`）干净重启：后端 :5191、前端 :5190，资产接口验通。

## 附带发现：`public/` 同时是 Vite 的 publicDir

`vite.config.js` 未覆盖 `publicDir`，默认即仓库 `public/`。因此把书籍资产放在 `public/books/`（决策 D13）会产生两个副作用：

1. **dev 侧公开可达**：Vite 把 publicDir 挂在站点根，`http://127.0.0.1:5190/books/...` 返回 200，绕过了 Express 侧的 `/books/*` 拦截。
2. **build 会全量复制进 `dist/`**：实测导入 book-001 后 `dist/books` 已有 2 个文件 / 110.2 MB。

生产侧契约未被破坏：`tests/server/http/static-assets.test.js` 断言的场景正是"文件确实存在于资产目录，`/books/...` 依然返回 404"，说明 Express 有显式路由拦截而非依赖文件缺失；Phase 2B 实测后端 404 亦印证。泄露仅存在于 Vite dev。

**Phase 3 成本预估**：49 本约 3.3 GB，则每次 `npm run build` 额外复制约 3.3 GB（按 110 MB≈2 s 外推，约 +1 min/次，而质量门每个 Phase 都跑 build），磁盘另需多占约 3.3 GB。当前磁盘余量 232 GB，不构成阻塞。
