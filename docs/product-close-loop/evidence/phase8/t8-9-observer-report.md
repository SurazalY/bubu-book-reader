# T8.9 独立观察报告（Gate 3 后半）

> Agent：Phase 8 T8.9 / Gate 3 独立观察（未参与预检，未参与停机迁移）
> 时间：2026-08-18
> 模型：cursor-grok-4.6-xhigh-fast
> 结论先行：**Gate 3 后半 通过**

只读核验 + 复打真实 5191 HTTP。未停/杀/换 5191，未写库，未恢复备份，未再造班级/学生/draft/shelf。密码与 token 未写入证据。

---

## 1. 改动文件

仅新建：

- `docs/product-close-loop/evidence/phase8/t8-9-observer-report.md`
- `docs/product-close-loop/evidence/phase8/t8-9-observer-summary.json`
- `docs/product-close-loop/evidence/phase8/t8-9-observer-http-output.txt`

过程脚本只在 `%TEMP%\t8-9-observer-20260818.mjs`，未入院仓库。

---

## 2. 实测命令 / 退出码 / 关键原文

| 步骤 | 命令或请求 | 退出码 / HTTP | 关键原文 |
|---|---|---|---|
| 分支 / HEAD | `git branch --show-current` / `git rev-parse HEAD` | 0 | `feat/product-close-loop` / `b3cd4b532cd4e7e44398bd465112e9ff84a9684e` |
| 5191 Listen | `Get-NetTCPConnection -LocalPort 5191` | 0 | `127.0.0.1:5191 Listen PID 10340`；Listen 计数 **1** |
| 进程 | `Win32_Process 10340` | 0 | `node  server/index.js` ← `cmd /c node server/index.js` ← `npm-cli.js run server` |
| HTTP 后 Listen | 同上 | 0 | 仍唯一 Listen PID **10340** |
| Vite 5190 | `Get-NetTCPConnection -LocalPort 5190` | 0 | 仍 Listen（未动） |
| health | `GET /api/v1/health` | 200 | `{"status":"ok","database":"sqlite","migrations":34}` |
| 只读真库 | `DatabaseSync(path,{readOnly:true})` | 0 | `quick_check=ok`；047–050 四行；checksum 与磁盘/迁移报告/T8.8 一致 |
| 正式备份哈希 | SHA-256 只读 | 0 | 文件仍在；`107028480` / `44d55384ba2b49c4468fd8d42693a3b97cd9ec67bd3d8cb1c48b38bfb050167b` |
| 旧登录体 | `POST /auth/login` `{username,password}` | 400 | `VALIDATION_FAILED`「schoolCode、loginName 与 password 均为必填项」 |
| 现有学生新体 | `POST /auth/login` `{schoolCode,loginName,password}` | 200 | `userId=internal-demo-student` `workspace=internal-demo-workspace` |
| 现有学生书目 | `GET /books` + `X-Workspace-Id: internal-demo-workspace` | 200 / 49 | 集合 = post/pre sets；added/removed 空 |
| 教师 publish/unpublish | `POST /books/book-001/publish` 与 `unpublish` | 403 / 403 | `PERMISSION_DENIED`「当前工作空间无权执行此操作」 |
| 新班学生登录 | 库内 `login_name`（长度 8） | 200 | `userId=bdb84ff0-fedf-4ffe-bebf-c158875e00be` `workspace=0e31e8b4-a4b9-4c67-a670-afe195a9754a` |
| 新班学生书目 | `GET /books` | 200 / 0 | `ids=[]` |
| 无 grant 租约 | `POST /reading/lease` `book-001-trusted-v1` | 404 | `RESOURCE_NOT_FOUND`「书籍不存在或当前不可读取」；`active_reading_leases` 未增 |
| E.3 现网 draft | 只读 `books.status='draft'` + platform `GET /books?status=draft` | 0 / 200·0 | 现网仍无 draft 可测 |

密码只用 `.env` `INTERNAL_DEMO_PASSWORD`（长度 20）。证据不写原文、不写 token / Cookie。

---

## 3. 实测 vs 推断

**实测**

- 现网 5191 唯一监听者仍是报告中的 PID **10340**，命令行是本仓库 `node server/index.js`，health `migrations:34`。HTTP 复测后 PID 未变。
- 真库只读：`schema_migrations` 含 047–050，checksum 与磁盘文件、`t8-9-migrate-report.md`、T8.8 演练相同；`applied_at` 均为 `2026-08-18T13:49:23.231Z`。
- `PRAGMA quick_check = ok`。grants 总数 **49**，全部 `grantee_type='class'`、`grantee_id=internal-demo-class`、id 前缀 `phase8-backfill-050:`、actor `phase8-migration-050`、`created_at` 等于 047–050 `applied_at`。新班 grants **0**。无 organization grant。
- active 班 **2**（`internal-demo-class` + `T89验收二班` `34b41110-8286-4a5d-84a3-ae72c90dd734`）。`grade_manager` **0**。无残缺教师/学生三元组。无跨组织关系。无学生多 active 班。
- 正式备份文件仍在且 SHA-256 等于报告值。未打开该文件当业务库。
- 检查点集合文件自洽：pre/post 均为 `book-001`…`book-049`，`visibility-set-diff` added/removed 全空。现有学生 HTTP 集合与二者相等。
- 亲自复打：旧登录体 400；现有学生 200/49；教师 403/403；新班学生 200/0；无 grant 租约 404 同文案。HTTP 前后 grants 与未释放租约计数均未增加。
- draft 书 0；platform `GET /books?status=draft` 200/0。

**推断（标清楚）**

- 5191 无热重载。PID 未变、health 34、旧登录体 400、教师 publish 403，判定现网仍是报告所称的新后端，不是预检时的旧进程（当时 PID 66104 / health 30 / 旧登录体 200）。
- grants 49 行全部是 050 回填形态，E.4 本班 shelf 幂等未另插行。未见手写 SQL / sqlite CLI 补洞痕迹，也未发现与迁移报告矛盾的集合改写。
- HTTP 前已有 1 条未释放 `active_reading_leases`（不是本观察写入）。复测 404 后计数仍为 1，故 E.2/本枪未写新租约。不据此推断该旧租约来源。
- E.3：现网无 draft 可测。这是**验收缺口**，不是 Gate 3 后半阻断。T8.7/T8.8 已在守卫和副本上测过 draft+grant→404；真 5191 仍缺这一枪。未造 draft、未 unpublish、未改 hash。

---

## 4. 契约逐项

| 项 | 判定 |
|---|---|
| 5191 唯一 Listen，PID=10340，本仓库 `node server/index.js` | **pass** |
| `GET /health` 200 且 `migrations=34` | **pass** |
| 047–050 在库且 checksum = 磁盘 = 迁移报告 = T8.8 | **pass** |
| `PRAGMA quick_check=ok` | **pass** |
| grants 总数 49；`internal-demo-class` class grant 49；新班 0 | **pass** |
| active 班 2；`grade_manager` 0 | **pass** |
| 无残缺三元组；无跨组织关系 | **pass** |
| 正式备份仍在且 SHA-256 仍等于报告值 | **pass** |
| 检查点 pre/post/diff 自洽且全空 | **pass** |
| 现有学生新体登录 200；`GET /books` 200/49，集合等于 post/pre | **pass** |
| 教师对 `book-001` publish/unpublish 403 | **pass** |
| 新班学生 `GET /books` 200/0 | **pass** |
| 新班学生对 `book-001-trusted-v1` acquireLease 404 同文案 | **pass** |
| 旧登录体不再当成功（实测 400） | **pass**（佐证新后端） |
| 未见手写 SQL 痕迹与报告矛盾 | **pass** |
| E.3 draft+grant 真 5191 | **fail / 未执行**（现网无 draft；缺口，不自动否决） |
| 回退资格 | **已变**（第二班 + 已批准学生仍在；观察方未覆盖真库） |

---

## 5. 遗留

1. **E.3**：真 5191 缺 draft+本班 grant 后再 `acquireLease` 的一枪。判定为缺口，不阻断 Gate 3 后半。
2. 真库已不是 11.1 停机基线：2 个 active 班、2 个 active student、1 个 grade workspace。这是授权窗口内的 E 负例写入，不是回退目标。
3. 浏览器验收仍由用户本人执行（T8.10）。
4. 旧备份仍在 TEMP 路径，但 **agent 无权用它覆盖真库**。

---

## 6. 停止条件

下列**未命中**：

- 现网已不是报告中的新后端，或 HTTP 仍是旧行为（§16.18 / §16.19）
- 047–050 checksum 与磁盘/报告不一致
- `quick_check` 非 ok
- 检查点集合被改、added/removed 非空
- 新班无 grant 仍看见书
- 教师全局 publish 成功
- 迁移报告造假 / 手写 SQL 痕迹与报告矛盾
- 观察方停机、换端口、写库或用备份覆盖

**已存在、须维持上报：** 正式切换后已有新业务写入，回退资格已变。观察方未执行回退。

---

## 7. 未触碰红线

- 未停 / 杀 / 重启 5191 或 Vite
- 未写真库、未手写 SQL、未 `openSqliteDatabase`、未跑迁移 / bootstrap
- 未改 `server/**` `src/**` `tests/**`、09、decisions、ledger
- 未用备份覆盖任何文件
- 未再造班级 / 学生 / draft / shelf；未 unpublish 已有书、未改 hash
- 未开浏览器、未 commit / push / reset
- 未改阅读摘要两表 / session-summaries schema / 指纹 / 90s TTL / renew

---

## 8. 证据路径

- `docs/product-close-loop/evidence/phase8/t8-9-observer-report.md`
- `docs/product-close-loop/evidence/phase8/t8-9-observer-summary.json`
- `docs/product-close-loop/evidence/phase8/t8-9-observer-http-output.txt`
- 对照：`t8-9-preflight-report.md`、`t8-9-migrate-report.md`、`t8-9-migrate-summary.json`、`t8-9-pre-visibility-sets.json`、`t8-9-post-visibility-sets.json`、`t8-9-visibility-set-diff.json`
- 正式备份（只读哈希）：`C:\Users\Yak\AppData\Local\Temp\t8-9-gate3-20260818T134900Z\readmate-046-official.sqlite`

---

## 9. Gate 3 后半

**通过。**
