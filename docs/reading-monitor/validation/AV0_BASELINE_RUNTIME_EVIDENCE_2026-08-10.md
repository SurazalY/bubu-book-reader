# AV-0 基线运行与浏览器证据

> 验收范围：G0-04、G0-05，以及 G0-06 所需的运行态边界
>
> 执行日期：2026-08-10（Asia/Shanghai）
>
> 候选：`codex/reading-monitor-clean-baseline` / `d4ce07b44ee4daf48d2173d51e7329008e78abbe`
>
> 结论：`pass`（仅指 G0 运行与浏览器基线；AV-0 整体仍需主控完成 G1 冻结）

## 1. 环境与保护边界

- 仓库：`/Users/yak/Project/整书8.10`
- Node/npm：沿用主控已记录的 Node `v24.16.0`、npm `11.13.0`
- 数据库：一次性 SQLite `/tmp/readmate-av0.7KVI5A/readmate.sqlite`
- 公版资产：一次性目录 `/tmp/readmate-av0.7KVI5A/public`
- 服务端/生产静态站：`http://127.0.0.1:5191`
- Vite 开发前端：`http://127.0.0.1:5190`
- 浏览器：Codex 应用内 Chromium 浏览器；未复用个人登录态
- 本轮没有修改生产源码、测试、需求包或 `IMPLEMENTATION_CONTROL.md`
- 本轮启动的 5190/5191 服务已停止；结束检查均无监听进程
- 临时数据库和资产留在 `/tmp/readmate-av0.7KVI5A` 供主控复核，没有清理或删除用户文件

## 2. 实际命令

以下是成功路径的命令摘录。内部演示密码只用于一次性临时库，文档中脱敏，不写入仓库。

```bash
mktemp -d /tmp/readmate-av0.XXXXXX

INTERNAL_DEMO_PASSWORD='<一次性本地演示密码>' \
  npm run bootstrap:internal -- \
  --database /tmp/readmate-av0.7KVI5A/readmate.sqlite \
  --manifest '/Users/yak/Project/整书8.10/读伴一体化交接_2026-08-07_v3_最终版/materials/public-domain/delivery_manifest.json' \
  --public-root /tmp/readmate-av0.7KVI5A/public

DATABASE_PATH=/tmp/readmate-av0.7KVI5A/readmate.sqlite \
SESSION_TOKEN_SECRET='<一次性本地会话密钥>' \
INTERNAL_DEMO_MODE=1 \
PUBLIC_ASSET_DIR=/tmp/readmate-av0.7KVI5A/public \
PORT=5191 HOST=127.0.0.1 \
npm run server

npm run dev

curl -fsS -D /tmp/readmate-av0.7KVI5A/health.headers \
  http://127.0.0.1:5191/api/v1/health

curl -fsS -o /tmp/readmate-av0.7KVI5A/index.html \
  -w 'index status=%{http_code} content_type=%{content_type} bytes=%{size_download}\n' \
  http://127.0.0.1:5191/student/login

curl -fsS -o /tmp/readmate-av0.7KVI5A/cover.jpg \
  -w 'cover status=%{http_code} content_type=%{content_type} bytes=%{size_download}\n' \
  http://127.0.0.1:5191/books/alice_1907_public_domain_internal_test/cover_original.jpg

curl -fsS -D /tmp/readmate-av0.7KVI5A/vite-health.headers \
  http://127.0.0.1:5190/api/v1/health

curl -fsS -o /tmp/readmate-av0.7KVI5A/vite-client.js \
  -w 'vite client status=%{http_code} content_type=%{content_type} bytes=%{size_download}\n' \
  http://127.0.0.1:5190/@vite/client

curl -fsS -o /tmp/readmate-av0.7KVI5A/vite-main.js \
  -w 'vite main status=%{http_code} content_type=%{content_type} bytes=%{size_download}\n' \
  http://127.0.0.1:5190/src/main.jsx

sqlite3 -readonly /tmp/readmate-av0.7KVI5A/readmate.sqlite \
  "SELECT COUNT(*), MAX(id) FROM schema_migrations;"

sqlite3 -header -column -readonly /tmp/readmate-av0.7KVI5A/readmate.sqlite \
  "SELECT event_type, page_no, foreground, screen_on, offline_sequence,
          valid_reading_seconds, valid_eye_seconds, client_occurred_at, received_at
   FROM reading_events ORDER BY offline_sequence;"

lsof -nP -iTCP:5190 -sTCP:LISTEN
lsof -nP -iTCP:5191 -sTCP:LISTEN
```

服务由带 PTY 的终端会话启动；结束时分别发送 `Ctrl-C`。Vite 因 SIGINT 返回 1、Node 服务端返回 0，端口检查均确认停止。

## 3. G0-04 服务、数据库和静态资源

| 检查项 | 实际结果 | 结论 |
| --- | --- | --- |
| 临时数据库初始化 | `bootstrap:internal` 成功，生成 5 个演示账号、1 个班级工作空间和 2 本公版书 | 通过 |
| 迁移账本 | `/api/v1/health` 返回 `migrations: 26`；SQLite 为 `26|042_ai_conversation_management.sql` | 通过 |
| 基础数据 | `users=5`、`books=2`、`book_pages=8` | 通过 |
| 服务端健康 | `GET :5191/api/v1/health` → 200，`status=ok`、`database=sqlite`，包含请求 ID | 通过 |
| 生产深链静态回退 | `GET :5191/student/login` → 200、`text/html`、920 bytes | 通过 |
| 公版书籍静态资产 | 封面 → 200、`image/jpeg`、54065 bytes；下载 SHA-256 与清单均为 `d96dd7...dfb8` | 通过 |
| Vite 前端 | `npm run dev` 在 5190 启动，浏览器加载教师首页，无空白页/错误覆盖层/控制台错误 | 通过 |
| Vite API 代理 | `GET :5190/api/v1/health` → 200，同样返回 26 个迁移和请求 ID | 通过 |
| Vite 静态模块 | `/@vite/client` → 200、137795 bytes；`/src/main.jsx` → 200、2560 bytes | 通过 |
| 服务日志 | 验收期间 Node 和 Vite 会话没有额外错误输出 | 通过 |
| 进程回收 | 5190、5191 均无 LISTEN | 通过 |

备注：根 `README.md` 仍把工程描述为“纯静态、零后端”，与当前一体化源码和 `package.json` 不一致。这是文档漂移，不影响 G0 启动，但应由主控列入后续文档维护风险。

## 4. G0-05 浏览器冒烟

### 4.1 学生流程

使用一次性演示账号 `internal-student` 完成：

1. `GET /student/login`
   - 页面标题正确；账号、密码、登录按钮可访问；正文非空；无错误覆盖层；控制台 0 error。
2. 登录后到 `/student/home`
   - 显示“晚上好，小竹”；读取 2 本真实书；首页、书架、社区、个人页一级导航存在。
   - “我喜欢的书”“我的书单”显示真实空态，没有 fixture 补齐。
3. `/student/home/ranking`
   - 显示“还没有有效阅读记录”，属于真实空态。
4. `/student/shelf`
   - 显示 2 本来自 API 的公版书，搜索和筛选入口可访问。
5. `/student/books/book-cdf0dfa2df2718611c50cba4`
   - 书籍详情、4 页、开始阅读入口可用。
6. `/student/reader/book-cdf0dfa2df2718611c50cba4`
   - 正文和插图正常加载；双页阅读器、上/下一页、目录、阅读偏好和跳页控件存在。
   - 初始双页显示第 1–2 页；翻到第 3–4 页后 UI 显示第 4/4 页和 100%。
   - 全程无框架错误覆盖层，浏览器控制台 0 error。

### 4.2 教师流程

使用一次性演示账号 `internal-teacher-li` 完成：

1. `GET /console/login`
   - 账号、密码、登录按钮可访问；正文非空；无错误覆盖层；控制台 0 error。
2. 登录后到 `/console/home`
   - 工作空间为“公共领域素材联调班级”。
   - 首页真实读取参与班级、今日阅读、正在阅读学生等数据。
   - “暂无近期阅读安排”“无权查看安全提醒”分别覆盖真实空态和真实权限态。
3. 教学与管理 → `/console/teaching/arrangements`
   - 读取真实空安排；“创建安排”入口可访问。
4. 教学与管理 → `/console/teaching/books`
   - 读取 2 本真实书；教师阅读器、书目详情入口存在；控制台 0 error。
5. 班级与学生 → `/console/classes/overview`
   - 读取 1 名学生、1 本书和旧事件派生的有效阅读；明确显示“不生成竞争性学生排行”。
6. 班级与学生 → `/console/classes/eyecare`
   - 读取林小竹的真实护眼汇总；今日累计和最长连续均约 2 分钟；控制台 0 error。

### 4.3 错误/空态结论

至少以下真实状态已覆盖：

- 学生排行无有效阅读记录；
- 学生无收藏、无自建书单；
- 教师无阅读安排；
- 教师身份无权读取安全提醒；
- 教师护眼审计暂无记录。

因此 G0-05 的“至少一个真实错误/空态”要求已满足。

## 5. G0-06 运行态边界

### 5.1 90 秒租约

真实租约记录：

```text
acquired_at = 2026-08-10T12:57:09.272Z
expires_at  = 2026-08-10T12:58:39.272Z
TTL         = 90.0 秒
```

观察结论：

- 服务端 `acquireLease` 默认 TTL 是 90 秒，允许 15～300 秒。
- 同设备重复调用现有 `POST /api/v1/reading/lease` 可以延长租约历史，但客户端只在书籍/工作空间 effect 首次挂载时调用一次。
- 客户端没有续租定时器，也不消费 `expiresAt`；租约过期后阅读器仍显示“本次已读 1 分钟”，没有停表或显式提示。
- 服务端另有默认 5 分钟 `offlineLeaseGraceMs`。本次在租约过期约 9 秒后产生的 `page_turn` 仍被接受，说明“90 秒过期”并不立即阻断旧事件。
- 没有等待超过“90 秒 + 5 分钟宽限”做浏览器拒绝复现；该拒绝边界由源码确认，列为未覆盖项。

对 G1 的约束建议：冻结明确续租契约，客户端按 `expiresAt` 提前续租；续租失败后停止新增有效时长。不要把 5 分钟离线宽限当成续租替代品。

### 5.2 `screenOn` 的可信边界

运行生成的 4 条旧阅读事件全部持久化为：

```text
foreground = 1
screen_on  = 1
```

客户端 `useReadingTelemetry` 对 `page_stay`、`page_turn` 都直接写 `screenOn: true`；只使用 `document.visibilityState` 判断前台，没有读取可信屏幕点亮状态或 Wake Lock 状态。浏览器普通 Web API 也无法普遍可靠证明物理屏幕已点亮。

结论：当前 `screen_on=1` 是客户端声明而非真实可观测证据。G1 应明确：删除伪造字段或只把 `visibilityState` 作为可观测信号，并在指标定义中承认浏览器能力上限。

### 5.3 旧逐页事件链

本次真实写入：

| 序号 | 类型 | 页 | 有效阅读秒 | 有效用眼秒 | 说明 |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | `page_stay` | 2 | 59 | 59 | 60 秒定时 flush |
| 2 | `page_stay` | 2 | 39 | 39 | 翻页切段 |
| 3 | `page_turn` | 4 | 0 | 0 | 租约到期后约 9 秒，仍在 5 分钟宽限内 |
| 4 | `page_stay` | 4 | 20 | 20 | 下一次定时 flush |

最终派生：

```text
reading_progress.last_page_no            = 4
reading_progress.valid_reading_seconds   = 118
eye_care_states.continuous_eye_seconds   = 118
eye_care_usage(day/week)                 = 118 / 118
```

边界结论：

- 旧客户端每 60 秒、翻页、进入后台或卸载时上传 `page_stay/page_turn`。
- `page_stay` 单条最多 120 秒；事件少于 1 秒不上传。
- `page_turn` 自身时长为 0，但会更新 `last_page_no`。
- 阅读器页面没有消费 `useReadingTelemetry` 返回的 `error`，旧上传失败对学生不可见。
- 双页视图把最后可见页当成当前页；从 1–2 页翻到 3–4 页后，旧 UI 直接显示 100%。这证明完成度/最后页语义需要由 G1/G4 统一处理。

### 5.4 护眼与旧统计耦合

同一批 `reading_events` 同时生成 `valid_reading_seconds` 和 `valid_eye_seconds`，写入后同一事务/链路会：

1. 重算 `reading_progress`；
2. 重算 `eye_care_usage`；
3. 重算 `eye_care_states`；
4. 被旧 `/reading/statistics/self|scope` 查询读取；
5. 被 `/eyecare/status|students` 查询读取。

浏览器侧交叉证据：教师阅读统计显示约 2 分钟有效阅读；护眼管理对同一学生显示约 2 分钟今日累计/最长连续。这说明旧逐页事件既是旧统计真值，也是护眼输入。

对 G1 的约束建议：新会话累计摘要成为阅读统计唯一真值后，不能简单删除旧事件上传。需要先冻结“新统计贡献”和“护眼输入”的单点边界，避免双写真值，同时保护现有护眼。

## 6. 失败项与诊断噪音

产品检查无失败项。以下是工具/诊断过程中的非产品失败：

- `agent-browser` CLI 不在 PATH；按 Browser 技能改用应用内浏览器完成等价验证。
- 浏览器后端不支持 `networkidle` wait，改用 `load` + 短暂稳定等待后验证 DOM/控制台。
- 两次只读 SQLite 查询最初猜错账本/租约历史列名；读取 `.schema` 后按真实列重跑成功。没有写数据库。

这些失败不影响产品结论。

## 7. 未覆盖项

- 未等待超过租约 90 秒加 5 分钟离线宽限，未在浏览器中复现最终 `READING_LEASE_REQUIRED`。
- 未模拟真实物理屏幕熄灭；普通浏览器也没有可信通用接口可证明该状态。
- 未验证学校电子书包、受管平板、真实网络中断、后台超过数分钟或生产部署。
- 未调用真实外部 AI 服务；G0 阅读、统计和护眼流程不依赖外部 AI。
- 本轮是基线冒烟，不替代 AV-1 的摘要幂等、乱序、续租失败和组织隔离验收。
- 本轮没有运行前后端全量测试或构建；这些证据已由 G0-03 单独记录。

## 8. 结论与门禁建议

- G0-04：`pass`
- G0-05：`pass`
- G0-06 运行态材料：已具备，可由主控汇入风险和决议日志
- 是否建议 G0 通过：**是**

已知的 90 秒租约、5 分钟宽限、伪造 `screenOn=true`、旧事件兼顾统计与护眼、最后页 100% 等问题是新需求明确要处理的基线风险，不是“基线无法运行”的阻塞。它们必须在 G1 冻结边界，并进入后续实现与 AV-1 验收。
