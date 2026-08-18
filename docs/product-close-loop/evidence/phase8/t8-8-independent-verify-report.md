# T8.8 / Gate 2 独立验证报告

> Agent：Phase 8 T8.8 / Gate 2 独立验证（未参与业务实现，未参与夹具对齐）  
> 时间：2026-08-18  
> 分支：`feat/product-close-loop` @ `b3cd4b532cd4e7e44398bd465112e9ff84a9684e`  
> cwd：`D:\Project\整书8.15`  
> 结论先行：**Gate 2 通过**。

未改 `server/**`、`src/**`、`tests/**`、`package.json`、迁移、`09`/`02`/`03`/`04`/`05`、`decisions.md`、`execution-ledger.md`、真库、5191。未 commit / push / reset / checkout。未开浏览器。未进 T8.9。发现红只报告——本次无红，无需停止修码。

---

## 1. 改动文件清单（本 agent 只写了这些）

新建：

- `docs/product-close-loop/evidence/phase8/t8-8-independent-verify-report.md`（本文件）
- `docs/product-close-loop/evidence/phase8/t8-8-verify-server-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-verify-frontend-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-verify-build-output.txt`

未覆盖夹具对齐 agent 的 `t8-8-server-test-output.txt` / `t8-8-frontend-test-output.txt` / `t8-8-build-output.txt`。

---

## 2. 实测命令 / 退出码 / 用例数 / 关键 TAP

cwd 均为仓库根。Windows 上守卫抽跑使用 `node --test <glob>`，未把目录当模块。

### 2.1 全量质量门（亲自跑）

| 门 | 命令 | 退出码 | TAP |
|---|---|---:|---|
| server | `npm run test:server` | 0 | `# tests 437` `# pass 437` `# fail 0` `# cancelled 0` `# skipped 0` `# todo 0` `# duration_ms 17538.0849` |
| frontend | `npm run test:frontend` | 0 | `# tests 264` `# pass 264` `# fail 0` `# cancelled 0` `# skipped 0` `# todo 0` `# duration_ms 559.2494` |
| build | `npm run build` | 0 | `vite v5.4.21`；`1757 modules transformed.`；`built in 8.07s` |

build 仅有 chunk >500kB 警告，不是失败。

全量 TAP 的中文标题在 PowerShell `Out-File` 下部分乱码；**计数与 EXIT 是 ASCII，以此为准**。可读的抽跑 TAP 见下。

### 2.2 Phase 8 守卫抽跑（亲自跑，追加写入 verify-*.txt）

| 命令 | 退出码 | TAP |
|---|---:|---|
| `node --test tests/server/db/phase8-047-050-migration.guard.test.js` | 0 | `# tests 26` `# pass 26` `# fail 0` |
| `node --test tests/server/core/phase8-identity-guards/**/*.test.js` | 0 | `# tests 71` `# pass 71` `# fail 0` |
| `node --test tests/server/core/phase8-reading-guards/**/*.test.js` | 0 | `# tests 41` `# pass 41` `# fail 0` |
| `node --test tests/server/http/phase8-http-guards/**/*.test.js` | 0 | `# tests 28` `# pass 28` `# fail 0` |
| `node --test tests/server/http/phase8-attack-t87-gaps.test.js` | 0 | `# tests 4` `# pass 4` `# fail 0` |
| `node --test tests/frontend/phase8-t8-6a-identity-ui.test.mjs` | 0 | `# tests 7` `# pass 7` `# fail 0` |
| `node --test tests/frontend/phase8-t8-6b-class-shelf.test.mjs` | 0 | `# tests 10` `# pass 10` `# fail 0` |

关键 TAP 原文（抽跑，均 `ok`，无 `not ok`）：

```
ok 15 - D-23 acquireLease：published + 无 grant → 404「书籍不存在或当前不可读取」，且不得写 lease
ok 16 - D-23 acquireLease：draft + 本班 grant → 404，失败只归因发布状态
ok 32 - 默认全闭：无 grants 时 isBookVisibleToAudience 必须为 false（删除「无任何 grants 即 true」）
ok 40 - 不变量：三份 visibility 文件由 T8.7 拥有，不再要求对初始 HEAD 干净
ok 22 - C. 教师全局 publish/unpublish 必须 403，且不得改 grants
ok 59 - B. POST /students 必须由标准不存在路由返回 404，且不能再物化已入班学生
```

全量门里对应编号（与夹具报告一致，计数侧实测）：server `ok 258` 平台运营发布/下架；frontend `ok 6` 登录三字段、`ok 49` 草稿不能投放、`ok 50` 缺 classId 空架。

---

## 3. 哪些是实测、哪些是推断

| 项 | 性质 |
|---|---|
| `git status --porcelain`、claimed/unclaimed `git diff --stat`、测试标题 `+/-test(` | **实测** |
| 三门退出码 / TAP 计数 / 守卫抽跑 | **实测** |
| 弱化：无 `test.skip` / `.todo`；无全表 `INSERT INTO book_access_grants`；`grantBookToClass` 必带 book+class | **实测（读 diff / 源码）** |
| `permissions.js` 中 teacher 无 `book.import` / `book.publish` | **实测（读源码）** |
| T8.7 三份 visibility 仍禁「无 grants 可见」、D-23 draft/无 grant 为 404 不是 200 | **实测（读源码 + 抽跑 TAP）** |
| T8.4A 不变量只改所有权、仍禁「无 grants 即可见」 | **实测（读 `invariants.guard.test.js`）** |
| 副本 046→050 VACUUM / 独立端口 HTTP | **未重跑**；核已有证据文件是否仍在且自洽 |
| 真库 SHA-256 | **未复算**：5191 锁文件，`Get-FileHash` 失败。体积与演练快照一致 |
| 夹具包未改已脏的 T8.2–T8.7 `server/**`/`src/**` | **推断（集合对照）**：脏文件集合与既有 Phase 8 实现范围一致，changelog 未声明的测试改动属 T8.3/T8.6/T8.7，不像本包新增 |
| changelog 把登录三字段写成 P8-17R、把默认全闭写成 P8-24 | **读文档**：P8-17R 是 leave_self；登录三字段是 P8-11；P8-24 是 Phase 8 先于 Phase 6 / T8.2 拥有 047–050。引用不准，不构成质量门红 |

---

## 4. 契约逐项 pass/fail

依据 09 §14、§15 T8.8、§16、§17 Gate 2；decisions P8-17R / P8-18R / P8-24。

| 契约 | 结果 | 依据 |
|---|---|---|
| 质量门 server 全绿 | **pass** | 亲自跑 437/437，EXIT 0 |
| 质量门 frontend 全绿 | **pass** | 亲自跑 264/264，EXIT 0 |
| 质量门 build 全绿 | **pass** | 亲自跑 EXIT 0 |
| 无断言弱化 | **pass** | 无删用例 / skip / 放宽 Phase 8 新守卫。旧夹具标题成对改名（登录三字段、平台发布、本班 shelf），属产品改判对齐，changelog 已声明。Phase 8 新守卫抽跑全绿 |
| 无全局 grant | **pass** | helper `grantBookToClass` 单行且必须 `bookId`+`classId`；旧夹具按班按书写 grant，未见无限定 `INSERT` 或循环给全部书 |
| 文件所有权 | **pass** | 夹具包 claimed = 20 个旧夹具 + 新建 `tests/server/helpers/phase8-old-fixture.js`（该目录仅此文件）+ `invariants.guard.test.js` + evidence。`server/**`/`src/**` 无「changelog 未声明却像本包新增」的实现改。未把 T8.2–T8.7 已脏业务误判为越权 |
| T8.7「无 grants 可见」未回退 | **pass** | `default-closed.guard.test.js` 仍断言 false；visibility 三文件仍测 404；不变量 `doesNotMatch(/无 grants 即可见/)` |
| T8.7「draft lease 200」未回退 | **pass** | D-23 守卫仍是 draft+本班 grant → 404；抽跑 `ok 16` |
| T8.4A 不变量只改所有权 | **pass** | 仅去掉「对初始 HEAD 干净」；三文件仍须存在且含 grant/class-local；仍禁「无 grants 即可见」 |
| 教师未被重新授予 `book.import`/`book.publish` | **pass** | `roleActions.teacher` 只有 `book.read` + shelf 三动作。旧 publish HTTP 正例改 platform；守卫仍 `ok 22` 教师 403 |
| P8-18R `POST /students` 标准 404 | **pass** | 联调夹具先 POST `/students` 断言 404，再走签发/注册/批准；identity 守卫 `ok 59` |
| 演练证据仍成立 | **pass** | 五份文件仍在且自洽，见 §4.1 |
| D-21～D-25 正反例符合 09 | **pass（核证据，未重跑 HTTP）** | 见 §4.1 |
| 5191 / 真库未写 | **pass** | 见 §4.2 |

### 4.1 副本演练证据（核文件，未重跑 VACUUM/5191 HTTP）

仍在：

- `t8-8-gate2-report.md`
- `t8-8-drill-summary.json`
- `pre-visibility-sets.json`
- `post-visibility-sets.json`
- `visibility-set-diff.json`

自洽点：

- pre `semantics=old-no-grants-open`，post `semantics=new-class-grant-closed`
- 键 `internal-demo-organization::internal-demo-student`，两侧均为 `book-001`…`book-049`（49）+ `activeClassIds=["internal-demo-class"]`
- `visibility-set-diff.json`：`added=[]` `removed=[]` `allEmpty=true`；summary `visibilityDiffAllEmpty=true`
- 升级前 grants=0 / published=49；升级后快照 `quick_check=ok`、`grants=49`；HTTP 后副本 grants=50（只发生在副本、且在集合快照之后）——与 gate2 报告一致，不自相矛盾
- HTTP：现有学生 200/49；新班学生 200/0；教师 publish/unpublish 403；D-23 无 grant 与 draft+grant 均为 404 同码同文案
- D-21：有 grant 学生见帖且 `quote.availability=available`、text 非空；新班 0 帖（帖是演示班 class scope，不是「见帖藏 quote」形态）。跨班藏 quote 以 T8.7 守卫为准，证据未改口
- D-22：有 grant 安排 1 条；新班 0 条
- D-25：教师全局 publish 403
- `neverUsed5191=true`；独立端口 62621 / 60171
- checksum 047–050 两次相同，与磁盘 checksum 一致

### 4.2 5191 / 真库（只读）

- `Get-NetTCPConnection -LocalPort 5191`：`127.0.0.1:5191 LISTENING` **PID 66104**（与 `t8-8-gate2-report.md` 演练前后相同）
- 真库体积与演练快照相同：sqlite `108261376`、wal `9723232`、shm `32768`
- `Get-FileHash` 因 5191 占用失败，**未打开 SQLite、未 VACUUM、未写**
- 本任务未向 5191 发业务 HTTP，未 restart

---

## 5. 遗留问题

1. changelog 把登录三字段误标为 P8-17R、把默认全闭误标为 P8-24。契约本身按 P8-11 / 09 §1 / P8-18R 落实，不影响 Gate 2。
2. `reading-teaching-bridge.test.js` 桩库把 `student-1`/`student-2` 写成 `teacher` `role_assignments` 以走 `bypassClassGrants`，避免全表 grant。changelog 已声明；不是 14.1 禁止的全局 grant。
3. `book-publish-visibility.test.mjs` 仍留 `visibilityWriteBody('organization')` 旧 helper 单测；全量绿，未当弱化。
4. 全量 verify-*.txt 中文 TAP 因 PowerShell 重定向编码有乱码；计数、EXIT、抽跑 TAP 可读。
5. 工作区仍有 T8.2–T8.7 未提交业务/守卫；本任务未动。未申请 T8.9。

---

## 6. 是否命中停止条件

未命中 09 §16。不必改实现才能绿。未删用例、未放宽 Phase 8 断言、未全局 grant、未碰真库/5191、未修红。

---

## 7. 未触碰红线声明

未改 reading 冻结表 / schema / 指纹 / 90s TTL / 续租路由。  
未 fallback。未为绿改任何业务或测试文件。  
未写真库，未重启/替换 5191，未开浏览器，未进 T8.9。

---

## 8. 原始证据路径

本任务：

- `docs/product-close-loop/evidence/phase8/t8-8-independent-verify-report.md`
- `docs/product-close-loop/evidence/phase8/t8-8-verify-server-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-verify-frontend-test-output.txt`
- `docs/product-close-loop/evidence/phase8/t8-8-verify-build-output.txt`

对照（只读，未覆盖）：

- `docs/product-close-loop/evidence/phase8/t8-8-fixture-align-report.md`
- `docs/product-close-loop/evidence/phase8/t8-8-fixture-changelog.md`
- `docs/product-close-loop/evidence/phase8/t8-8-gate2-report.md`
- `docs/product-close-loop/evidence/phase8/t8-8-drill-summary.json`
- `docs/product-close-loop/evidence/phase8/pre-visibility-sets.json`
- `docs/product-close-loop/evidence/phase8/post-visibility-sets.json`
- `docs/product-close-loop/evidence/phase8/visibility-set-diff.json`

---

## 9. Gate 2 判定

**Gate 2 通过。**

通过条件均满足：亲自跑的 server/frontend/build 全绿；无断言弱化/全局 grant；副本证据仍为 quick_check=ok、grants=49（快照点）、集合 diff 全空；D-21～D-25 正反例与 09 及既有演练报告一致；5191 PID 未变、真库本任务未写。
