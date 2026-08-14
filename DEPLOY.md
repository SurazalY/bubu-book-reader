# 整书阅读 · 部署说明

「真 AI + 页面感知」的儿童整本书阅读演示站。前端构建为静态文件，由 Node/Express 后端统一 serve，并代理 LLM 提供 AI 陪读 / 找书。

## 架构
- **前端**：React 18 + Vite 5 + Tailwind（HashRouter），`npm run build` → `dist/`
- **后端**：Node + Express（`server/`），同时 ① serve `dist/` 静态站 ② 提供 `POST /api/chat`（页面感知 AI）+ `GET /api/health`
- **生产同源**：后端 serve dist，前端相对 `/api` 直达，无需跨域 / 代理

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

# 3. 构建前端
npm run build            # 生成 dist/

# 4. 启动（默认 5191，serve dist + /api）
npm run server
#    浏览器访问 http://<服务器IP>:5191
```

> 已 build 的部署包可跳过第 3 步；仍需安装服务端依赖、配置环境变量并执行 `npm run server`。

## 三、环境变量（项目根目录 `.env`）
| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 服务端口 | `5191` |
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
- 书架页：AI 找书向导；阅读页：**按住 Ctrl 拖选**正文 → 浮层「解释 / 问 AI / 标注」+ 右侧 AI 学伴结合当前页陪读

## 五、开发模式（本地改代码）
```bash
# 终端 A：后端
cd server && npm run dev         # 5191（--watch 热重启）

# 终端 B：前端（热更，vite 自动 proxy /api → 5191）
npm run dev                      # 5190
```
访问 http://127.0.0.1:5190

## 备注
- `.env` 含密钥，已 gitignore，**切勿提交**；每个部署各自维护运行环境变量
- 前端 js 单包约 1 MB（含 3D 翻页引擎），演示足够；如需优化可做 code-split
