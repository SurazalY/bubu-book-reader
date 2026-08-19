# W4 合并报告 · 年级维度并回主线

- 日期：2026-08-19
- 工作区：`D:\Project\整书8.15`
- 目标分支：`feat/optional-upgrade`
- 被合并分支：`feat/w4-grade-scope`（worktree `D:\Project\readmate-w4` 与该分支均未删除、未 push）
- 共同基线：`ef0df7f`
- merge commit：`f4cfefa`（完整 `f4cfefae354ba69d873bc5a19b10a63e32c1a34f`）
- 结论：**冲突按原则手工解决，四项静态核对通过，回归数量符合两边新增之和。可派 W3。**

---

## 一、冲突怎么解决

预期冲突面恰好两个文件。实际：

| 文件 | 结果 |
|---|---|
| `server/domains/identity/service.js` | **无冲突标记**，git 自动合并成功。人工核对后三处改动与锚点均在，未用任何一边整文件覆盖。 |
| `docs/product-close-loop/11_六项体验改造任务台账.md` | **有冲突**（第一节大表 T4 五行 +「当前进度」小节），按两边进度拼在一起。 |
| 其他文件 | **无冲突** |

### `service.js`

自动合并后逐项确认：

- W2 `changeOwnPassword`（约 `:1877`）保留
- W2 `updateOwnProfile`（约 `:1905`）保留
- W2 清除临时密码空实现锚点保留：`changeOwnPassword` 内注释 + 调用 `clearIssuedTempPasswordForUser`；`repository.js` 仍为空实现
- W4 `inspectRegistrationToken` 的 `classes[].currentGrade`（约 `:1019`，来自 `computeClassLifecycle`）保留

### 台账

- T2 / T1 四行（W1）、T6-1 / T6-2 / T6-3a / T6-3 四行（W2）：保持主分支「完成」，**未**用 W4 拷贝里过时的「待派」覆盖
- T4-1 / T4-2 / T4-3a / T4-3 / T4-4 五行：采用 W4「完成」
- T4-5：采用 W4「推迟（本波次不做）」
- T3 两行、T5-1、T7：待派；T5-0 仍为人工待办
- 「当前进度」改写为：W1 / W2 / W4 均已收口，当前可派 W3；W4 已合并回主分支，worktree 与分支暂不删除

---

## 二、四项静态核对

| 项 | 结果 |
|---|---|
| a. `service.js` 四处全在 | **通过**（见上一节） |
| b. `git diff ef0df7f -- server/domains/identity/permissions.js` | **空**，权限模型一行未动 |
| c. `git status --porcelain` | **空**。未带入 `.env`、`server/data/*.sqlite`、本地 vite 配置 |
| d. 迁移目录最大编号 | **052**（`051_login_name_global_unique.sql`、`052_community_post_book.sql`）。无 053。W2 与 W4 均未加迁移 |

---

## 三、回归数量对照

| 点位 | server | frontend |
|---|---|---|
| 基线 `ef0df7f` | 465 | （未单独记录；由两侧反推约 287） |
| W2 单独 | 479（+14） | 296 |
| W4 单独 | 478（+13） | 301 |
| **合并后** | **492 / 492 全绿** | **310 测，308 绿 / 2 红** |

server：465 + 14 + 13 = **492**，与实测一致。若停在 479 或 478 附近即表示一侧测试丢失——本次未发生。

frontend：310 明显多于 W2 的 296（约等于 W2 增量 + W4 增量叠在基线上）。2 条红是既有 D-19 CRLF 失败，文件为：

- `tests/frontend/reader-dual-mode-contract.test.mjs`
- `tests/frontend/reader-text-blank-and-scroll.test.mjs`

原因是正则写死 `,\n` 而本机 `src/index.css` 为 `,\r\n`，与本轮改造无关。本次**未**改这两条测试，也**未**改 `src/index.css`。无新增失败。

未启动浏览器、未做页面验收。

---

## 四、给 W3 的提醒

`server/domains/identity/service.js` 现在同时承载：

1. W2 自助改密 / 改名：`changeOwnPassword`、`updateOwnProfile`
2. W4 注册 token 年级字段：`inspectRegistrationToken` 返回的 `classes[].currentGrade`
3. T3 将要接上的临时密码签发与查询，以及把 `clearIssuedTempPasswordForUser` 从空实现换成对 `issued_temp_passwords` 的 DELETE（迁移 **053** 仍预留给 T3-2）

W3 改此文件时只动与临时密码相关的函数与锚点，不要误伤前两处。`permissions.js` 全局禁令仍然有效。

---

## 五、未做的处置（等产品负责人）

- 未 push
- 未删除 `feat/w4-grade-scope`
- 未删除 `D:\Project\readmate-w4` worktree
