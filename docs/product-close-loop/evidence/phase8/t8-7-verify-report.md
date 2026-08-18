# T8.7 独立对抗与夹具重做报告

> 时间：2026-08-18  
> Agent：Phase 8 T8.7 独立验证（未参与 T8.2～T8.6 业务实现；只拥有测试）  
> 分支：`feat/product-close-loop`  
> HEAD：`b3cd4b5`  
> 模型：grok 4.6 / xhigh / fast。无换模型、无降档、无 fallback。  
> 未改 `server/**`、`src/**`、09、ledger、T8.2～T8.6 守卫。未 commit。未开浏览器。未打 5191。未写真库。

## 1. 本轮允许产出

| 路径 | 动作 |
|---|---|
| `tests/server/http/book-visibility-guard.test.js` | 按 §14.1 重做 18 条夹具/断言 |
| `tests/server/http/book-visibility-revoke-guard.test.js` | 按 §14.1 重做 7 条夹具/断言 |
| `tests/server/http/book-visibility-http.test.js` | 按 §14.1 重做约 10 条 HTTP 用例 |
| `tests/server/http/phase8-attack-t87-gaps.test.js` | **只新增**；补 14.2 缺口，已锁项只引用 |
| `docs/product-close-loop/evidence/phase8/t8-7-fixture-changelog.md` | 逐条登记旧断言变更 |
| `docs/product-close-loop/evidence/phase8/t8-7-verify-report.md` | 本报告 |

## 2. 亲自运行的测试

临时库均在 `mkdtempSync(tmpdir())`，`listen(0)`，断言端口 ≠ 5191。登录一律 `schoolCode + loginName`。

### 2.1 25 条 visibility + HTTP（三份旧文件一次跑）

```
node --test tests/server/http/book-visibility-guard.test.js tests/server/http/book-visibility-revoke-guard.test.js tests/server/http/book-visibility-http.test.js
```

| 项 | 本轮实测 |
|---|---|
| 退出码 | `0` |
| tests | 35（18 + 7 + 10） |
| pass / fail / skipped | 35 / 0 / 0 |
| 时长 | `duration_ms 12837.7474` |

### 2.2 新增攻击文件

```
node --test tests/server/http/phase8-attack-t87-gaps.test.js
```

| 项 | 本轮实测 |
|---|---|
| 退出码 | `0` |
| tests | 4 |
| pass / fail / skipped | 4 / 0 / 0 |
| 时长 | `duration_ms 1174.801` |

| 用例 | 结果 |
|---|---|
| 已锁攻击只引用 T8.3A/T8.5A，不在本文件复制弱化版 | pass |
| 教师未加入班不得操作本班书架（零 workspace 教师） | pass（无 ws → 400；伪造 A 班 ws → 403，grant 仍 0） |
| 教师未加入班不得审批该班成员 | pass（无 ws → 400；伪造 ws → 403） |
| 年级主任 school 例外不扩散到本届/跨届书架 | pass（本届 PUT / 跨届 PUT / 本届 GET 均 403，grant 仍 0） |

已锁项（注册 body 注入 role/org、token 不进日志/库、行政纠错教师 403 与残缺 500、教师全局 publish 403、旧 visibility 路由删除）只读源码标题引用，不写弱化 HTTP 副本。出处：

- `tests/server/core/phase8-identity-guards/registration.guard.test.js`
- `tests/server/core/phase8-identity-guards/password-reset.guard.test.js`
- `tests/server/core/phase8-identity-guards/teacher-affiliation.guard.test.js`
- `tests/server/http/phase8-http-guards/publish-school-forbidden.guard.test.js`
- `tests/server/http/phase8-http-guards/visibility-deleted.guard.test.js`

## 3. §14.1 七条落实

1. 学生可见必须显式 grant 当前版本 → 该生 active class。createBook / 无 grants 不再暗含可见。
2. 不可见用例标题写明一种原因：无 grant / 只 grant 他班 / 跨组织 / draft / 无 class_memberships / 班级已停用 / 学生不在该班。
3. draft 门先 grant；grant 门书 published。
4. teacher 正例：完整教师三元组 + published；`bypassClassGrants` 不看 draft。platform 才是 draft 正例。校长/年级主任/`grade_group` 不是书库正例。
5. 跨组织显式两组织、两班、各自 grant；外组织 classId 与不存在 classId 同码同文案。
6. 无全局 beforeEach / bootstrap 给所有书 grant 所有班。helper 由单测显式调用。
7. 未删攻击断言；未把资源 404 改任意 4xx；未放宽行数/审计。变更见 changelog。

D-23：原「不可见/draft lease 为 200」已改为 404「书籍不存在或当前不可读取」。D-22：无 grant 安排整项省略。

## 4. 实现缺陷

无。本轮红过的 5 条都是夹具自伤（停权账号残留残缺 `class_teacher` 导致 `GET /classes` 的 `teacherCount` 500；`grade_group` 误期望 200；revoke 夹具引用不存在的 `teacherB`），已在测试侧修好，**未改实现**。重跑后 35+4 全绿。

可观测行为与新断言一致：无 grant 不可见、旧 visibility 404、教师 publish 403、GM/校长无书架、D-23 lease 404。不是「实现没改、测试却绿」。

## 5. 停止条件检查

| 条件 | 状态 |
|---|---|
| 只能靠删用例/放宽/全局 grant 变绿 | 未发生，已停此路径 |
| 独立验证 agent 改了业务实现 | **否** |
| 实现未改可观测行为、测试却绿 | 未发生 |

## 6. 建议

T8.7 完成。建议主控进入 **T8.8**（全量质量门、独立端口与迁移演练）。无需打回 T8.2～T8.6 实现，无需上报缺陷。

---

25+HTTP 绿（退出码 0；35/35）  
新攻击文件 `tests/server/http/phase8-attack-t87-gaps.test.js` 绿（退出码 0；4/4）  
是否改了业务代码：否  
建议：T8.8
