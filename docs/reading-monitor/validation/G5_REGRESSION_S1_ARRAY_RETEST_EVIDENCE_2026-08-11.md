# G5 S1 顶层数组旁路独立重验证据（V-R）

> 日期：2026-08-11（Asia/Shanghai）
>
> 范围：仅重验 `G5_REGRESSION_S1_FINAL_RETEST_EVIDENCE_2026-08-11.md` 中仍 OPEN 的公开报告顶层数组旁路；只验不修，未启动浏览器
>
> 基线 HEAD：`d4ce07b44ee4daf48d2173d51e7329008e78abbe`

## 1. 结论

**PASS。** 上轮顶层数组旁路反例已关闭：顶层数组及其更深数组/对象中的 `percent`、`percentage`、`阅读完成比例`、`readingProgressPercent` 均从 helper、真实公开 JSON 与真实公开 HTML 递归消失；合法 `note`、`restCompliancePercentage`、`attendancePercentage` 保留，primitive/null 原语义不回归。

最终状态：

- S1 **CLOSED**；
- 此前 S1/S2/C1/C2 四项 P1 **全部 CLOSED**；
- G5-08 **PASS**；
- G5-09 独立初审 **PASS，可交最终 V 复核**；
- 本报告不构成 AV-2 结论，也不自称 AV-2 PASS。

## 2. 候选审查与稳定性

`server/http/public-summary-page.js:90-95` 已移除 `!Array.isArray(report.content)` 旁路：所有非空 object（包括数组）都进入 `sanitizePublicContent()`；该递归函数在 `:66-71` 先处理数组再处理对象。`displayValue()` 在 `:83-87` 对数组内对象使用 `JSON.stringify`，使净化后的合法嵌套字段能在 HTML 中展示，而不是退化为 `[object Object]`。

开始与结束时三个指定候选文件 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `server/http/public-summary-page.js` | `d0e17cd25676bcdd87697db2c76cf6d8bdd520e7b8a605f544c2aefad7d5d230` |
| `tests/server/http/public-summary-page.test.js` | `5a683d06c568947f3bd3621b10ab0acb388b91fb5fc97a2c64cd08ec1a19300f` |
| `tests/server/http/integration-runtime.test.js` | `bcdd4a609c1ac5307e9931ed18378f003c3516def8981883f59488f530831362` |

三文件清单 SHA-256：`2dfe5a5ea738d40d103e11d3bc3ae7fe73a6968fba3afb817aa94752ac1657a2`。候选在重验期间未漂移。

## 3. 独立 helper 与真实 HTTP 链

独立输入使用历史顶层数组 `report.content`：

```json
[
  {
    "percent": 64,
    "percentage": 63,
    "阅读完成比例": "62%",
    "note": "顶层数组历史普通文字",
    "eyeCare": { "restCompliancePercentage": 61 },
    "nested": [
      { "readingProgressPercent": 60, "note": "深层普通文字" }
    ]
  },
  {
    "children": [
      { "percentage": 59, "classSummary": { "attendancePercentage": 98 } }
    ]
  }
]
```

helper 与真实公开 JSON 的实际结果均精确为：

```json
[
  {
    "note": "顶层数组历史普通文字",
    "eyeCare": { "restCompliancePercentage": 61 },
    "nested": [
      { "note": "深层普通文字" }
    ]
  },
  {
    "children": [
      { "classSummary": { "attendancePercentage": 98 } }
    ]
  }
]
```

独立脚本使用正式应用与迁移、真实临时 SQLite、真实 reports/delivery domain：生成并人工审核报告，为同一历史版本创建并发送两条 one-time summary link，再把 `report_versions.content_json` 回填为上述历史数组。

- 第一条链接通过真实 `GET /api/v1/public/summary-links/:deliveryId` 获取 JSON，响应 200，content 与期望逐字段相等。
- 第二条链接带 `Accept: text/html` 获取 HTML，响应 200 且 content-type 为 HTML；metric 区域没有禁键，保留两个 note 和两个合法比例字段。
- 两条 delivery 均产生打开 receipt，证明请求确实执行了 `openPublicSummaryLink()`，而不是只调用渲染 helper。
- helper 的 JSON 与 HTML 同样通过相同递归断言。

独立日志：`/tmp/g5-vr-s1-array-independent-http.log`，SHA-256 `4b70c341f460ca33d641c5ad83fb440c2e2ec801b91490d934cece78c91b8a07`。

## 4. primitive/null 不回归

`sanitizePublicSummary()` 分别输入 `null`、字符串、`0`、正数、`false`、`true`，输出均由 `Object.is` 证明与原值相同。HTML 另确认：普通字符串仍展示，`null` 仍进入“本期报告暂无可展示内容”空态。

这与修复分支相符：仅非空 object 进入递归 sanitizer，primitive 和 null 继续原样返回。

## 5. 最小命令矩阵

| 命令/范围 | 结果 | 日志 SHA-256 |
| --- | --- | --- |
| `node --test tests/server/http/public-summary-page.test.js` | 3/3 PASS；fail/skipped/todo 0 | `67ef31a59704911b98080346d0021b7a17f68ae9759ea87f25cbcad5c532b102` |
| `node --test --test-name-pattern='真实 HTTP 家长触达确定失败后重试成功并保存安全链接回执' tests/server/http/integration-runtime.test.js` | 1/1 PASS；fail/skipped/todo 0 | `7f982b1e9f621dd17cad6751925fbe5eddf895d9d820c73acf965ebcd573ca68` |
| 独立 helper + 真实 SQLite/open/router JSON/HTML + primitive/null | 全部 8 组检查 PASS；2 条真实打开 receipt | `4b70c341f460ca33d641c5ad83fb440c2e2ec801b91490d934cece78c91b8a07` |
| `git diff --check` | PASS，空输出 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

父任务已说明候选全量为 167/167 PASS；本轮按最小重验要求没有重新运行该全量，也不把它记作本轮独立命令。

## 6. 残余风险与交接边界

本轮未发现新的 P0/P1/P2。数组 HTML 仍作为“教师寄语”单个 metric 显示，这是既有非对象顶层展示语义；当前输出已净化且完整保留合法字段，不构成本轮完成度语义缺陷。

最终结论：**S1 CLOSED；四项 P1 全部 CLOSED；G5-08 PASS；G5-09 初审 PASS，可交最终 V。**
