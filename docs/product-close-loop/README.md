# 整书业务闭环：实施计划包（2026-08-17）

本目录是"把 49 本书（原版 PDF + OCR TXT）接入读伴产品，完成可运行业务闭环"的完整实施计划。执行本计划的 Agent（下称"执行者"）应按本 README 的顺序阅读和执行。

## 目标一句话

信任现有 OCR → 导入整套 49 本默认书单 → 补齐教师发布管理 → 学生端双模式阅读（PDF/文字）→ 共享物理页与进度 → 接入既有阅读计时 → 实际运行完成端到端验收。

## 文档索引（按阅读顺序）

| 文件 | 内容 | 何时读 |
|---|---|---|
| `README.md`（本文件） | 执行规则、环境、命令速查 | 开工前 |
| `01_现状与资产盘点.md` | 能力状态矩阵、关键文件路径、49 本书编目表 | 开工前通读 |
| `02_决策与契约边界.md` | 已拍板的 15 项决策、允许改什么、禁止改什么 | 开工前通读，执行中随时查 |
| `03_实施任务清单.md` | Phase 0–7 分阶段任务，每项含改动点与完成标准 | 执行主线 |
| `04_端到端验收清单.md` | 最终验收场景、五级状态分类、报告模板 | Phase 7 与最终报告 |

## 执行模式：主控只调度，子 agent 干活

本计划由"主控 Agent + 子 agent"协作执行，目的是防止主控上下文膨胀：

- **主控 Agent 只负责**：按 Phase 拆解与派发任务、跟进进度、审阅子 agent 的交付报告、做决策与裁决冲突、维护 Phase 检查点（commit）、汇总证据与撰写最终报告、与用户沟通。
- **主控 Agent 不直接做**：探索代码仓、编写业务代码、跑测试/构建、执行导入与批处理、浏览器实操验收——这些一律派给子 agent（grok 4.6 xhigh）。主控允许的直接操作仅限：读本计划包文档、git 提交检查点、对子 agent 结论做小范围抽查核验（读单个文件/跑单条命令级别）。
- **派发任务的要求**：子 agent 之间不共享上下文，每次派发必须给出自包含的任务简报（背景、目标文件路径、契约边界摘录、完成标准、要求返回的报告格式）。涉及 02 文档 B-2 禁止事项的任务，必须把相关禁令原文附在任务简报里。
- **交付验收**：子 agent 必须返回结构化报告（改了哪些文件、测试结果原文、遗留问题）；主控对关键交付做抽查（如再派一个子 agent 复核，或自己做最小核验），不盲信。
- **证据归档**：子 agent 产出的验收证据统一放 `docs/product-close-loop/evidence/`，主控在报告中索引。

## 最重要的三条执行规则

1. **信任现有 OCR。** `book-parser/work/ocr-antigravity-v1/jobs/<BOOK_ID>/pages` 下的 txt/blank 是可信输入。禁止重新 OCR、逐页视觉核对、调用模型审核 OCR、统计 exact/minor/major、或因个别错别字阻塞导入。导入只做程序运行必需的结构检查（文件可读、页号连续、PDF 存在、页数对得上）。
2. **沿用已有系统，不建平行系统。** 阅读计时（reading-monitor）、双模式 Reader、AI 引用、书目模型、权限体系都已存在（见 01 文档状态矩阵）。工作量的主体是"接入与补缺"，不是重写。特别是：**绝不新建第二套计时/进度/发布系统**。
3. **未经真实运行不得宣称验收通过。** 最终报告必须按 04 文档的五级分类如实标注：代码已实现 / 自动测试通过 / 实际运行通过 / 真实书目验证通过 / 因环境或凭据尚未验证。

## 环境与命令速查

- OS：Windows；Node >= 22.16（服务端用 Node 内置 `node:sqlite`，版本不够会直接失败）。
- 安装：`npm install` 且 `npm --prefix server install`。
- 启动：终端 A `npm run server`（API，127.0.0.1:5191）；终端 B `npm run dev`（Vite，127.0.0.1:5190，代理 /api）。
- 数据库：SQLite 文件默认 `server/data/readmate.sqlite`（可用环境变量 `DATABASE_PATH` 覆盖）；迁移在服务启动时自动执行。
- 演示环境：`npm run bootstrap:internal`（需环境变量 `INTERNAL_DEMO_PASSWORD`，≥12 位）。创建学校 `internal-demo-organization`、班级 `internal-demo-class`、学生林小竹、李/王老师、校长陈校长（school_admin）、平台运营。
- 书籍导入：`npm run import:book-package-v2 -- --database <db> --package <dir> --actor-id <id> --workspace-id <id> --public-root <public目录>`。调用者需要 `book.import` + `book.publish` 权限（用校长或平台运营账号）。`--public-root` 必须与运行时 `PUBLIC_ASSET_DIR`（默认仓库 `public/`）一致。
- 质量门（每个 Phase 收尾必跑）：`npm run test:server`、`npm run test:frontend`、`npm run build`。全绿才能进入下一 Phase。
- API 调用约定：前缀 `/api/v1`；Cookie 会话 + `X-Workspace-Id` 头；所有写请求必须带 `Idempotency-Key`。

## 数据源位置（Windows 实际路径）

| 数据 | 路径 |
|---|---|
| OCR 文本页（可信输入） | `D:\Project\整书8.15\book-parser\work\ocr-antigravity-v1\jobs\<BOOK_ID>\pages\`（`page-0001.txt`…；空白页为 `page-XXXX.blank` 空文件） |
| 每本书 OCR 溯源 | `D:\Project\整书8.15\device-migration-20260815\verification-extract\core-final\book-parser\work\text-ocr-v1\jobs\<BOOK_ID>\source.json` |
| 原版 PDF 根目录 | `D:\Project\整书8.15\device-migration-20260815\verification-extract\source\book-parser\input\` |

PDF 路径拼接规则：取 `source.json` 中的 PDF 路径字段（注意字段别名：`sourcePdf` / `sourcePath` / `source.path`，其中 book-005 用嵌套的 `source.path`），截取 `book-parser/input/` 之后的相对部分，拼到上面的 PDF 根目录。**文件名常有尾随空格（如 `儿童歌谣 .pdf`），必须按字面保留。**

## 磁盘与运行预算

- 49 本 PDF 共约 3.3 GB。打包产物（包内含 PDF 副本）+ 导入时复制到 `public/books/` 共需约 6.6–7 GB 额外空间，请先确认磁盘余量。包目录在全量验收通过前不要删除（导入器幂等校验需要原包）。
- `GET /books?limit=100` 足够容纳 49 本，无需分页改造。

## Git 约定

- 在新分支上工作（建议 `feat/product-close-loop`），每个 Phase 完成且质量门全绿后做一次 commit 作为检查点。
- 不要 push、不要建 PR，除非用户明确要求。
- 不得改动 `device-migration-20260815/` 下的任何归档内容；`book-parser/work/ocr-antigravity-v1/` 下的 OCR 文件是只读输入。

## 求助边界

以下情况停下来问用户，其余自行决策并在报告中记录：

1. Phase 7 需要真实 AI 凭据（`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 写入 `.env`）——届时向用户索取。
2. 发现本计划与代码现实存在重大冲突（例如契约文件与实际实现不符），且两种处理方式都有明显代价。
3. 任何会删除/覆盖既有阅读记录、归档数据的操作。
