# 读伴 · 整书阅读平台

面向学生、教师与学校管理角色的一体化整书阅读应用。仓库包含 React 前端、Node/Express 服务端、SQLite 数据模型、自动化测试和部署文档。

## 工程结构

```text
.
├── src/           React 应用：主站、学生端、教师/管理控制台
├── server/        API、领域服务、数据库迁移与运行时集成
├── tests/         前端契约测试与服务端领域/HTTP测试
├── public/        随应用发布的静态资源；运行时书籍资源不纳入Git
├── docs/          架构、契约和验收记录
├── screenshots/   脱敏后的产品效果图
├── DEPLOY.md      部署说明
└── package.json   前端开发、构建与仓库级测试命令
```

详细边界见 [`docs/WORKSPACE.md`](docs/WORKSPACE.md)。原始PDF、EPUB、交付压缩包和OCR中间文件必须保存在应用仓库之外。

## 环境要求

- Node.js >= 22.16
- npm
- 可选：OpenAI兼容模型端点，用于真实AI能力

## 本地开发

```bash
npm install
npm --prefix server install

# 终端A：API服务，默认 http://127.0.0.1:5191
npm run server

# 终端B：Vite开发服务，默认 http://127.0.0.1:5190
npm run dev
```

Vite会把 `/api` 代理到本地API服务。生产环境由Express统一提供构建产物、书籍静态资源和API。

## 验证

```bash
npm run build
npm run test:frontend
npm run test:server
```

## 数据边界

- 书籍目录、版本、页面、文字块和资源索引保存在SQLite中。
- 页面图片和原始书籍通过 `storage_key` 指向运行时资源目录；`public/books/` 不提交Git。
- 用户、阅读记录、AI会话和统计数据属于运行时数据，不得打入源码或书籍解析产物。
- 书籍解析在独立工作区离线完成；应用仓库只消费已经验收的固定书籍版本。

## 产品效果

学生端、教师端与运营端的脱敏效果图见 [`screenshots/`](screenshots/)。
