# G5 S1 最终补修独立重验证据（V-R）

> 日期：2026-08-11（Asia/Shanghai）
>
> 范围：仅重验上一轮仍 OPEN 的 S1 内部报告与公开摘要净化；S2/C1/C2 已 CLOSED，本轮未重跑；未启动浏览器，未修改生产代码或测试
>
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`

## 1. 结论

**FAIL。** 对象型报告及其嵌套数组/对象已修复，但公开 JSON 对“顶层数组型 `report.content`”仍绕过净化。P0=0，P1=1，owner：I-S（`server/http/public-summary-page.js`）。

因此：

- S1 **仍 OPEN**；不能声明此前四项 P1 全部 CLOSED。
- S2/C1/C2 保持上一轮 **CLOSED**，本轮按窄范围要求未重验。
- G5-08 **FAIL**。
- G5-09 初审仍不能交最终 V 作通过性复核。
- 当前 `npm run test:server` 为 166/166 PASS，但全绿测试没有覆盖本反例。
- 本报告不是 AV-2 结论，也不自称 AV-2 PASS。

契约依据是 `G1_FROZEN_CONTRACT.md:359-371`：`last_page_no` 不能推导百分比或完成度，且必须统一清理 `server/domains/reports/index.js` 和 `server/http/public-summary-page.js` 等生产读侧；上一轮最小重验又明确要求内部报告和公开 JSON/HTML 拒绝 `percent/percentage/阅读完成比例` 及旧 payload。

## 2. 候选与稳定性

本轮指定的四个候选文件在开始与结束时 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `server/domains/reports/index.js` | `60133ddf7cb4d5be28f5c08958391c6f00eb4141c5e3adfe2cf3c8a1cfa3d44e` |
| `server/http/public-summary-page.js` | `b345eeb7b27d68e6c5b2a84e65e570542b6c7d0930795a29315e74af7e6d2290` |
| `tests/server/community-reports/community-reports.test.js` | `4aed6b38089fc653874706ed3f2538a3804a17c38242af1efb4c75c2a282a700` |
| `tests/server/http/public-summary-page.test.js` | `1d9366f14280cca4c8b17b410309141a2cca7293c7f23969675f416355f08556` |

四文件清单 SHA-256：`b2c9d2b946c909df6023fb331c61d5e1369bf8f4ff57551249cffea5ad2de0b9`。`git diff --check` 空输出，日志 SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

## 3. 已通过的修复面

独立脚本使用正式迁移、真实临时 SQLite 和 `createReportsDomain`，原始对象 payload 同时包含：

- 顶层 `percent`、`percentage`、`阅读完成比例`、`startedBookCount`；
- 对象内数组及更深对象中的 `percent`、`percentage`、`阅读完成比例`、`readingProgressPercent`、`booksFinished`；
- 合法的 `eyeCare.restCompliancePercentage`、`classSummary.attendancePercentage` 和普通文字。

下列 12 项均为真：

1. `generateReport()` 返回已净化；
2. 本次 `report_versions.content_json` 写入已净化；
3. 新写入报告的 `listReports()` 已净化；
4. 新写入报告的 `getReport()` 已净化；
5. 手工回填原始历史 `content_json` 后，list 读侧已净化；
6. 同一历史行的 get 读侧已净化；
7. 历史原始行没有被读侧偷偷改写；
8. 对象型公开 JSON 已净化；
9. 对象型公开 HTML 不含禁指标标签/JSON 键；
10. HTML 保留 `restCompliancePercentage`；
11. HTML 保留 `attendancePercentage`；
12. HTML 保留普通文字。

这证明上一轮报告内部对象型 `percent/percentage/阅读完成比例` 缺陷已被当前候选修复；失败只来自下节的顶层数组形状。

独立矩阵日志：`/tmp/g5-vr-s1-independent.log`，SHA-256 `cb07c283024426a9578f50eb80b5a52fb943e8e737c162d5248d4c213e8d0894`。该脚本最终以退出码 1 结束，是因为第 13 项“公开顶层数组已净化”按预期捕获失败，不是前 12 项失败。

## 4. P1 — 公开 JSON 的顶层数组绕过净化

### 4.1 精确代码与反例

`server/http/public-summary-page.js:66-71` 的 `sanitizePublicContent()` 明明支持数组递归；但 `sanitizePublicSummary()` 在 `server/http/public-summary-page.js:90-95` 只对“对象且不是数组”调用它：

```js
const content = report.content && typeof report.content === 'object' && !Array.isArray(report.content)
  ? sanitizePublicContent(report.content)
  : report.content
```

独立输入：

```json
[
  {
    "percent": 64,
    "percentage": 63,
    "阅读完成比例": "62%",
    "note": "顶层数组历史普通文字",
    "eyeCare": { "restCompliancePercentage": 61 }
  }
]
```

期望公开 JSON：

```json
[
  {
    "note": "顶层数组历史普通文字",
    "eyeCare": { "restCompliancePercentage": 61 }
  }
]
```

实际公开 JSON 与原始输入完全相同，三个禁字段全部保留。

### 4.2 生产可达性

这不是只调用 helper 的不可达形状：

- `server/domains/reports/index.js:66-67` 的内部 sanitizer 接受顶层数组，说明报告内容契约并未把数组排除；
- `server/db/migrations/030_community_reports_delivery.sql:73` 仅要求 `content_json TEXT NOT NULL`，没有对象形状约束，历史行可合法保存 JSON 数组；
- `server/domains/delivery/index.js:100-152` 的 `openPublicSummaryLink()` 从真实 `report_versions.content_json` 直接 `JSON.parse`；
- `server/http/integration-router.js:330-343` 的公开路由随后调用 `sanitizePublicSummary()` 并通过 `sendData` 返回 JSON。

独立生产链脚本实际完成报告生成、人工审核、summary-link 排队和发送，再把历史版本回填为上述顶层数组，调用 `openPublicSummaryLink()` 后进入路由同款 sanitizer。`openedContent` 和 `projectedContent` 均仍包含三个禁字段，`forbiddenStillPresent=true`。

生产链日志：`/tmp/g5-vr-s1-route-reachability.log`，SHA-256 `ff1faec6cb1386db26c794eda07d5c9517e5c1af6b0b215b951c7f422bf6e024`。

影响：历史顶层数组报告的公开 JSON 可继续暴露阅读完成度同义真值。HTML 当前把顶层数组折叠为普通字符串，因此该具体形状没有渲染出字段名；但公开 JSON 已违反 S1 的 JSON+HTML 双通道净化要求，不能据此判 S1 PASS。

Owner：**I-S**，精确文件：`server/http/public-summary-page.js:90-95`；对应测试缺口：`tests/server/http/public-summary-page.test.js:42-74` 只覆盖对象型顶层 content。

## 5. 正式命令结果

| 命令/证据 | 结果 | 日志 SHA-256 |
| --- | --- | --- |
| `node --test tests/server/community-reports/community-reports.test.js tests/server/http/public-summary-page.test.js` | 17/17 PASS；fail/skipped/todo 0 | `5658e532f0af3bedfb4d1c64b187d52cb93cce9f8f5a67b0b1a2191b4293099b` |
| 独立对象/嵌套/历史/公开 JSON+HTML 矩阵 | 前 12 项 PASS；顶层数组项 FAIL，脚本退出 1 | `cb07c283024426a9578f50eb80b5a52fb943e8e737c162d5248d4c213e8d0894` |
| 独立真实 summary-link 生产可达反例 | 成功复现 `forbiddenStillPresent=true`，证明脚本退出 0 | `ff1faec6cb1386db26c794eda07d5c9517e5c1af6b0b215b951c7f422bf6e024` |
| `npm run test:server` | 166/166 PASS；fail/skipped/todo 0；3.692s | `6c0f17a094ede853fc628acf8faff4934f8df77a073d756a874a77bb82aa4ff5` |
| 四候选文件 S1 反向扫描 | 见下节分类 | `3055d0c40e91f26dd3d1e3a6fa16a18d9c14fa21488044710ca52a15fe219250` |
| `git diff --check` | PASS，空输出 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

本轮没有重跑 frontend/build/runtime/storage，也没有重跑 S2/C1/C2；这是父任务明确要求的窄范围。上一轮相应证据不被本报告伪装成新运行。

## 6. 反向扫描分类

- 生产文件中 `startedBook*`、`percent/percentage`、`阅读完成比例` 等文本命中只位于 reports/public 的 denylist 与 key classifier，未发现新的主动生成点。
- 测试文件命中均是负例 payload、净化后断言或合法比例字段。
- `restCompliancePercentage` 与 `attendancePercentage` 由独立结果证明保留，属于合法护眼/出勤指标，不是阅读完成度。
- 纯文本按值不做过滤，普通说明文字仍保留。
- 这次失败不是 denylist 漏词，而是顶层类型分支绕过 classifier；单纯词法反向扫描无法发现，必须保留数组反例测试。

## 7. 最小重验清单

1. 给 `sanitizePublicSummary()` 输入顶层数组 `report.content`，数组元素同时含 `percent/percentage/阅读完成比例`、嵌套对象/数组、`restCompliancePercentage`、`attendancePercentage` 和普通文字；断言只删除禁键。
2. 通过真实临时 SQLite 的历史 `report_versions.content_json`、人工审核和 summary-link 路径，断言公开路由 JSON 与 helper 结果一致净化。
3. 断言对象型与顶层数组型 HTML 均不展示禁指标，同时保留合法护眼/出勤比例与普通文字。
4. 重跑两份 reports/public targeted，随后运行 `npm run test:server`；确认总数、失败数、候选四文件 hash 和 `git diff --check`。

最终状态：**S1 FAIL / OPEN；S2/C1/C2 维持 CLOSED；G5-08 FAIL；G5-09 初审不可交最终 V。**
