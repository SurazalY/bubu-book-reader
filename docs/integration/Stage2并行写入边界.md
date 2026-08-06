# Stage 2 五路并行写入边界

## Service tier 策略

第一批并行采用以下策略：A 整合与前端适配、B 数据权限底座显式使用 `priority`，因为它们位于所有后续联调的关键路径；D AI 与安全链同样使用 `priority`，原因是结构化输出、RAG、幂等重试和安全复核耦合度最高。C 阅读教学链与 E 社区报告家长使用普通档，避免在非首要瓶颈上扩大额度消耗。视觉专项复核使用高视觉模型，最终集中代码审查使用独立 `gpt-5.5-xhigh`。

任何子代理不得修改三棵来源 worktree，只能在主代理分配的独立分支/worktree 中提交；不得创建新的用户侧任务。

## 共享文件所有权

以下文件只由主整合负责人修改：`package.json`、`package-lock.json`、`server/package.json`、`server/package-lock.json`、`server/index.js`、`src/App.jsx`、`src/index.css`、`plans/index.md`、`CLAUDE_SCOPE.md`、共享 API 信封/错误码/权限常量。子线如需新增依赖或共享契约，提交文字需求，不直接改共享文件。

迁移运行器按文件名顺序扫描 `server/db/migrations/*.sql`，各线只写自己的编号段；领域路由与服务按目录隔离，集中合并时由主负责人注册。

## 五条施工线

| 线 | 可写范围 | 主要交付 | 禁止越界 |
|---|---|---|---|
| A 整合与前端适配 | `src/student/**`、`src/console/**`、`src/api/**`、`src/adapters/**`、A 自有测试与截图 | 双壳人工合并补丁、fixture/localStorage 替换适配层、加载/空/错/权限拒绝状态、视觉对照 | 不写数据库/领域服务，不重做背景布局色调卡片动效 |
| B 数据与权限底座 | `server/db/**` 中 `000～009`、`server/auth/**`、`server/middleware/**`、`server/domains/identity/**`、B 自有测试 | SQLite 迁移运行器、组织账号会话、工作空间、RBAC+scope、审计/idempotency/outbox | 不写业务页面，不写 C/D/E 领域实现 |
| C 书籍阅读教学 | `server/db/migrations/010～019*`、`server/domains/reading/**`、`server/domains/teaching/**`、`server/domains/bridge/**`、C 自有测试 | 书籍/版本/页段落、有效阅读与护眼、安排、课堂控制、广播、电子书包桥接契约与模拟器 | 不写 AI 安全、社区、报告、家长；不复制电子书包主项目代码 |
| D AI 与安全 | `server/db/migrations/020～029*`、`server/domains/ai/**`、`server/domains/safety/**`、D 自有测试 | 证据块+记忆卡 RAG、引用/防剧透、用量幂等、重试 fallback、隐私危险复核与回避候选 | 密钥不落盘，不直接决定通知人，不绕过二次复核 |
| E 社区报告家长 | `server/db/migrations/030～039*`、`server/domains/community/**`、`server/domains/reports/**`、`server/domains/delivery/**`、E 自有测试 | 投稿审核、报告版本、家长联系人、发送/重试/回执适配器 | 不绑定正式短信/小程序账号，不伪造成功/打开/已读 |

## 依赖与合并顺序

1. B 先提交可运行的数据库、会话、权限、审计和测试 seed 接口。
2. C/D/E 只依赖冻结契约编写各自迁移和领域模块，可与 B 并行；合并时先 B，再 C/D/E。
3. A 可先完成双壳人工合并与 API 适配边界，待 B/C/D/E 返回真实接口后逐域替换 fixtures。
4. 主负责人统一注册领域路由、更新依赖和锁文件，解决共享文件冲突并执行集中构建/迁移/联调。

## 每线回包要求

- 提交哈希、修改文件绝对路径和改动意图。
- 实际运行的测试命令、环境、通过/失败摘要和关键输出。
- 未检查范围、已知风险、需要主负责人处理的共享文件变更。
- 数据库迁移需附向前执行、幂等复跑和回滚/清理证据；接口需附成功、权限拒绝、校验失败与幂等重试证据。
- A 线需附同路由同视口截图与哈希；任何视觉骨架变化必须先暂停并上报主线。

## 冲突与止损

- 发现共享文件需求时先记录补丁说明，不抢写；主负责人集中处理。
- 连续尝试未产生新证据、原生依赖安装失败或浏览器链路阻塞时，保留现场并切换隔离实现/备用工具，不重复并发重试。
- 时间压力只能停止装饰探索、非关键图表和广泛兼容测试，不能削减持久化、权限、安全复核、回滚和真实链路验证。
