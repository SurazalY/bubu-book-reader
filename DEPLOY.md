# 整书阅读 · 部署说明

「真 AI + 页面感知」的儿童整本书阅读演示站。前端构建为静态文件，由 Node/Express 后端统一 serve，并代理 LLM 提供 AI 陪读 / 找书。

## 架构
- **前端**：React 18 + Vite 5 + Tailwind（BrowserRouter），`npm run build` → `dist/`。页面地址是真实路径，例如 `/student/login`、`/console/login`，不是 `#/student/login` 这种 hash 路径。
- **后端**：Node + Express（`server/`），同时 ① serve `dist/` 静态站 ② 提供 `POST /api/chat`（页面感知 AI）+ `GET /api/health`
- **生产同源**：后端 serve dist，前端相对 `/api` 直达，无需跨域 / 代理
- **前端路由回退**：BrowserRouter 下刷新或直达深链时，服务端必须把未命中静态文件的前端路径回退到 `index.html`，否则会 404。本仓库 Express 在默认开启静态托管时已经这样做：先托管 `dist/` 静态文件，再把其余 `GET` 回退到 `dist/index.html`（`/books` 固定 404，不回退）。因此用下文的 `npm run server` 同源部署时，刷新 `http://127.0.0.1:5191/student/login` 即可打开登录页。若前面另挂 Nginx 自己托管静态文件、不把未知路径转给 Express，必须配置 `try_files $uri $uri/ /index.html;`，不能按 HashRouter 省略这条规则。

## 一、环境要求
- Node.js ≥ 22.16（与仓库 `engines` 和内置 SQLite 运行方式一致）
- 一个 OpenAI 兼容的 LLM 端点 + key

## 二、部署步骤
```bash
# 1. 装依赖（前端 + 后端各一次）
npm install
npm --prefix server install

# 2. 配置运行环境（复制模板并只在部署环境填写密钥）
cp .env.example .env
#    编辑 .env：填写 OPENAI_BASE_URL / OPENAI_API_KEY / MODEL_ID
#    以及 SESSION_TOKEN_SECRET 等。外部机器要访问时还必须设置 HOST=0.0.0.0
#    （dotenv 读的是进程工作目录下的 .env：仓库根执行 npm run server 时用这一份）

# 3. 构建前端
npm run build            # 生成 dist/

# 4. 启动（默认只监听 127.0.0.1:5191，serve dist + /api）
npm run server
#    本机访问：http://127.0.0.1:5191/student/login
#              http://127.0.0.1:5191/console/login
#    HOST 为 127.0.0.1（含未设置）时外部机器连不上；不要指望打开 http://<服务器IP>:5191 就能通
```

> 已 build 的部署包可跳过第 3 步；仍需安装服务端依赖、配置环境变量并执行 `npm run server`。

## 三、环境变量（项目根目录 `.env`）

`server/index.js` 使用 `import 'dotenv/config'`，dotenv 读取的是**进程当前工作目录**下的 `.env`，没有写死路径。在仓库根执行 `npm run server` 时加载根目录 `.env`（对应根目录 `.env.example`）；在 `server/` 目录执行 `npm run start` / `npm run dev` 时加载 `server/.env`（对应 `server/.env.example`）。两份模板的变量集合已对齐，按实际启动工作目录复制其中一份即可。

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 服务端口 | `5191` |
| `HOST` | 监听地址 | `127.0.0.1`（只接受本机连接。外部机器要访问须显式设为 `0.0.0.0` 或具体网卡地址；绑 `0.0.0.0` 会把服务暴露到所有网卡，应放在反向代理后面并启用 HTTPS，不要把开发配置直接用于生产） |
| `OPENAI_BASE_URL` | 正式 OpenAI 兼容端点（带 `/v1`） | — |
| `OPENAI_API_KEY` | 只保存在部署环境的 API key | — |
| `MODEL_ID` | 问答与二次复核共用的模型 | — |
| `OPENAI_TIMEOUT_MS` | 单请求超时(ms) | `30000` |
| `OPENAI_PARSE_RETRIES` | 结构化响应解析重试次数 | `1` |
| `DIST_DIR` | 前端产物目录（相对 `server/`） | `../dist` |
| `PUBLIC_ASSET_DIR` | 运行时书籍素材目录 | `../public` |

> 正式问答和安全二次复核复用同一个外部 provider；未配置时会明确标为确定性降级，不能把降级结果当成外部 AI。

## 四、验证
- `GET /api/health` → `{ok:true, ai:{...}}` 即后端 + AI 配置就绪
- 学生登录：`/student/login`；控制台登录：`/console/login`（刷新这两个地址应仍返回页面，而不是 404）
- 书架页：AI 找书向导；阅读页：**按住 Ctrl 拖选**正文 → 浮层「解释 / 问 AI / 标注」+ 右侧 AI 学伴结合当前页陪读

## 五、开发模式（本地改代码）
```bash
# 终端 A：后端
cd server && npm run dev         # 5191（--watch 热重启）

# 终端 B：前端（热更，vite 自动 proxy /api → 5191）
npm run dev                      # 5190
```
访问 http://127.0.0.1:5190/student/login 或 http://127.0.0.1:5190/console/login

## 备注
- `.env` 含密钥，已 gitignore，**切勿提交**；每个部署各自维护运行环境变量
- **监听地址**：未设置 `HOST` 时默认绑定 `127.0.0.1`，外部机器连不上。对外部署须显式设置 `HOST=0.0.0.0`（或具体网卡地址）。绑定 `0.0.0.0` 意味着服务对外暴露，应配合反向代理与 HTTPS，不要把开发配置直接用于生产。
- 前端 js 单包约 1 MB（含 3D 翻页引擎），演示足够；如需优化可做 code-split
