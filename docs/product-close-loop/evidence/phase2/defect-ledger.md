# Phase 2 缺陷台账（book-001 单书纵向验证）

本台账是 Phase 2 缺陷的权威底账，最终验收报告按此逐条标注 L 级。

验证方式说明：
- **机器实测**：由 agent 通过 HTTP 请求、数据库查询、代码检索取证
- **真人实测**：由用户本人在浏览器操作观察（首轮 2026-08-17 15:50；后续轮次同日，见第七节「真人复验」）

真人复验环境：前端 `127.0.0.1:5190`、后端 `127.0.0.1:5191`，学生账号 `internal-student`，book-001。

## 一、缺陷清单

| 编号 | 缺陷 | 严重度 | 状态 | 复现条件 / 证据 |
|---|---|---|---|---|
| D-01 | 原版 PDF 无法加载 | 阻塞 | **已修** `eae6612` | pdfjs-dist 6.2.108 现代构建调用 `Map.prototype.getOrInsertComputed`，该 TC39 提案方法在 Chrome 144 仍未实现；改用自带 polyfill 的 legacy 构建。真人复验确认原版模式可渲染书页，未再出现该报错 |
| D-02 | 首页/书架卡片封面显示「封面资源不可用」 | 应修 | **已修** `eae6612` | 受保护资产接口要求 `X-Workspace-Id` 头，裸 `<img src>` 无法携带，请求被 400；改为带凭证与工作空间头 fetch 后转 blob URL。真人复验确认书架卡片显示真实插画封面 |
| D-03 | 三维翻页下第二次翻页与跳页回弹 | 应修 | **已处置（隐藏）** `8e25247` | 勾选「减少动态效果」或翻页效果选「平移」时，下一页与跳页均正常、画面与底栏页码同步；关闭减少动态效果并选「三维翻页」时，只能成功承载一次翻页，第二次翻页或跳页会播出动效后卡回原页。根因：`react-pageflip@2.0.3` 在 620ms 动效期间因 `props.children` 变化触发 `updateFromHtml()` 按旧索引重绘而中止动画，`startPage` 非受控属性。**处置为隐藏而非修复**（用户裁决）：默认值改 `slide`、`STUDENT_CURL_FLIP_ENABLED=false` 使 curl 分支不可达、UI 去掉「翻页效果」偏好项；`HTMLFlipBook` 源码保留以免动到两个源码扫描的冻结测试。永久记录见 `docs/tech-debt.md` TD-001 |
| D-04 | 阅读器左上角「返回详情」无法回到详情页 | 应修 | **已解除** `f5f99a8` + `a2c1ed3`；**无超时死键由 D-17 结构性关闭** | **2026-08-17 后续轮次真人实测：返回详情正常。** 与 D-05、D-11、D-15 同根因（租约拿不到 → 监测会话建不起来 → `closeAndWait` 等不到终态 → `navigate` 不执行）。历史症状：真人实测点击无效。机制：`Reader.jsx` 788–791 先 `await telemetry.closeAndWait('reader_close')` 再 `navigate`。D-17 起 `closeAndWait` 带 4s 有界超时，队列堵塞不再能把返回键做成死键。次可能（顶栏 `pointer-events`、三维叠层）已随 D-03 隐藏消失。详见第七节「真人复验」与第十四节 D-17 |
| D-05 | 阅读进度不记录最后页码 | 阻塞 | **已修** `f5f99a8` + `a2c1ed3`（真人实测通过） | **与 D-11 同一根因**，随其修复。**2026-08-17 后续轮次：页码统计正常。** 见第七节专项 |
| D-11 | **阅读时长与页码均停止汇总（项目核心目标受损）** | **阻塞** | **已修** `f5f99a8` + `a2c1ed3`（真人实测通过） | **2026-08-17 后续轮次：时间计算正常，真人主观判断按分钟级别基本准确**（非精确验证）。详见第七节专项 |
| D-06 | 文字模式长页文本被截断，**被截内容完全不可达** | **应修**（已定性） | 未修 | 文字页为固定 468×636 设计画布，窗口变化只做 `transform: scale`、**禁止重排**（`src/student/components/BookPage.jsx` 第 6–14 行）。裁切发生在多层且均无 `overflow-y: auto`：`.student-page-frame` 的 `overflow: hidden`（`src/index.css` 1228–1230）、`.student-page-body` 的 `min-height:0; overflow: hidden`（同文件 1308–1314）。页内不能滚、不能展开、翻页是换到另一张物理页。**结论：文字模式下用户读不到被裁掉的文字，属功能性内容丢失**，非初见截断。切回原版 PDF 可见全文，但那是换模式，不构成文字模式的阅读能力 |
| D-07 | 阅读偏好「纸张颜色」无反馈 | **不记**（已定性） | — | 属实现预期。`paperTone` 确实传给了两种模式（`Reader.jsx` 717–747），文字模式经 `student-page--${tone}` 真实套用底色（`BookPage.jsx` 132–134 + `src/index.css` 1234–1245）；原版模式同一节点被后写的 `.student-pdf-page-frame { background: #fff }` 锁白，且 canvas 铺满整页，故视觉上不吃。**附带建议**：偏好面板未标注「仅文字模式」，宜补文案 |
| D-08 | 验收清单文案与实际 UI 不符 | 文档修订 | 待修 | **原判断需更正**：`04` 与 `03` 正文**都没有**「开始阅读」这一表述，该四字来自 `BookDetail.jsx` 第 50 行注释，不在验收清单。真实不符项是 `04` 多处写「文字模式」，而实际切换按钮文案为「**OCR 文字**」（`Reader.jsx` 795），涉及 `04` 第 40、43、45、46、64 行 |
| D-09 | 书籍详情页封面在冷请求下取不到 | 应修 | **已修（工作区未提交，待真人复验）** | 详情页用的是 `src/components/ui.jsx` 的裸 `<img>`（`BookDetail.jsx` 第 3 行导入，第 411 行渲染），`src = book.coverUrl \|\| book.cover?.url \|\| ${BASE_URL}covers/${book.id}.jpg`。对已导入书 `coverUrl` 即受保护 URL，而裸 `<img>` 无法携带 `X-Workspace-Id`，冷请求必然 400 → `onError` → 渐变文字封。**真人复验判「通过」系被 HTTP 缓存误导**（详见 D-10），非真实通过。契约测试 `tests/frontend/book-cover-protected-asset.test.mjs` 只锁了首页与书架，故意未锁详情页 |
| D-12 | 跨设备真冲突时整段会话的阅读时长静默丢失 | **应修**（主控上调，复核原判「建议」） | 未修（已知风险，**不阻塞 Phase 6**，见第十三节裁决） | `f5f99a8` 让 `pendingQueue` 丢弃 `LEASE_CONFLICT` 队头，但 `persistSnapshot` 仍执行了 `revisions.commit`（`coordinator.js` 277–278、`pendingQueue.js` 52–54）。于是本地 revision 已推进而服务端从未收下前一个 revision，下一次提交即 `REVISION_GAP`，**该会话此后写不进去**。修 D-11 后本机重挂已不再触发此路，剩下的触发条件是"另一台设备持有活租约"这类真冲突（学校平板 / 家里设备）。**上调理由**：后果是学生这一整段阅读时长静默消失、无任何界面提示，而"阅读被记录"正是本产品的核心承诺；虽触发条件不常见，但一旦发生不可察觉、不可追回。不挡 Phase 3（批量导入不涉此路）；**2026-08-17 主控裁决**：`04` 验收项无跨设备项，Phase 6 按单设备单标签验收，本项延后处置（详见第十三节） |
| D-14 | 资产接口未按班级可见范围过滤 | **应修（Phase 4 核心前置）** | 未修 | `getBookAsset` 目前只经 `requireSession` + `requireWorkspace`，**没有任何发布状态与班级可见范围的过滤**。即同一工作空间内任何登录用户都能取到任意书的封面与源 PDF，绕过教师的发布管理。这一条与取图路线选择无关，任何路线下都必须在 `getBookAsset` 显式实现，且口径要与 `listBooks` / `getPage` 一致。**意义**：Phase 4「教师发布管理与班级可见范围」的实际起点比 `03` 任务清单描述的更靠前——不只是补前端管理界面，服务端的资产授权本身尚未建立。发现于受保护资产方案设计（`docs/product-close-loop/design/protected-asset-consumption.md`） |
| D-13 | 同一学生多条残留 open 会话只能关掉一条 | 建议 | 未修 | `monitoring.js` 740–758 的 `otherOpen` 用 `.get()` 取单行且未过滤 `workspace_id`，若同一学生存在多条残留 open，一次只处理一条，理论上可留下多余 open 行。属防御深度不足，非越权（关闭目标仍限于该学生自己的行） |
| D-10 | 受保护资产响应可缓存且未按工作空间区分 | 应修（**Phase 4 前处置**） | **已修（工作区未提交，待真人复验）** | 资产响应带 `Cache-Control: private, max-age=3600`，**且无 `Vary: X-Workspace-Id`**。两重后果：① 一次带头 fetch 会为同一 URL 预热缓存，使随后不带头的裸 `<img>`/CSS `url()` 也能显示，**掩盖鉴权失败**（D-09 即因此被误判为通过）；② 授权结果被缓存长达 1 小时，教师取消发布或调整班级可见范围后，学生浏览器仍可从缓存读到封面乃至源 PDF。第 ② 点直接冲击 Phase 4「教师发布管理与班级可见范围」的有效性，须在进 Phase 4 前定方案 |
| D-15 | **僵尸标签页续租锁死租约，阅读计时与页码全链路无法记录** | **阻塞** | **已修** `a2c1ed3`；**无会话续期漏洞由 D-17 关闭** | 详见第十节专项。`a2c1ed3` 只在「查得到会话」时拒续期；无会话租约仍可无限续。第三次复发见 D-17 |
| D-16 | **阅读器返回详情后页码与有效阅读时长不刷新** | 应修 | **已修** `fcdccfe`，**待真人复验** | **2026-08-17 后续轮次实测发现**（`fcdccfe` 部署前）：须手动刷新浏览器才更新；返回主页「今日有效阅读」正常。代码已修，修复后行为尚未经真人复验。详见第十一节专项 |
| D-17 | **无会话僵尸租约无限续期，再次锁死阅读计时与返回详情** | **阻塞** | **已修** `c0dfdaf`，**真人复验通过** | 第三次复发。症状与 D-11/D-15 相同：返回详情死键、时长与页码不记录。现场租约 `ced73a99` 被 Cursor 内嵌阅读器续了 58 次、从未建会话。结构性根治见第十四节 |
| D-18 | 原版模式误用封面页框当全书尺子，导致部分书被放大、其余书（含 book-001）显得糊 | 应修 | **已修** `fb206c5` | `useProtectedPdfDocument` 只 `getPage(1)`，把封面 MediaBox（约 1940×2733 pt）写入全书 `width/height`；`Reader.jsx` 用其作 `pageDesign`，scale 夹在 0.4–2。8 本封面被 0.4 地板托大，其余书按窗口缩小显得糊。内页实际约 466–472×672。**本轮只改学生阅读器选尺**（抽样第 1/2/中间/末页，宽高分别取下中位数）；**不重导 book-001、不重渲染 PDF**。文字模式仍走 `PAGE_DESIGN` 468×636。设计见 `docs/product-close-loop/design/pdf-page-design.md`。另提高 canvas outputScale，CSS 尺寸不变 |
| D-19 | 原版模式尺寸统一后全书正文发糊，且提高 canvas backing 无效 | 应修 | **已解除** `fb206c5` | **2026-08-17 深夜真人复验通过，用户结论「清晰度基本没问题了」**（抽样观感，未逐本点验 49 本）。D-18 的另一半。**根因不是渲染管线，是字太小**：这批扫描件正文汉字字身仅 8.7–9.9 pt，而按窗口高度铺满时 `scale ≈ 1.26`，汉字只有约 11 设备像素，低于汉字可读的 12–14 下沿。实测恒等式 `汉字设备像素 = 字身pt × 舞台物理像素高 ÷ 页高pt`，dpr 被约掉，所以 backing 倍率、dpr、对开/单页、浏览器缩放全都改不动它——这解释了第二轮为何无效。1080p 屏上「整页可见」与「字清晰」数学上不可兼得。修法：把原版模式的「大」字号档从空转改成真正放大到 1.6 倍 + 纵向滚动；顶栏底栏收起时真正退出 flex 流；canvas CSS 尺寸取整。详见第十五节专项 |
| D-20 | 班级建好之后无法再把已有教师加进去 | 应修（**挡 Phase 4 验收剧本，不挡 Phase 4 代码**） | 未修 | 发现于 Phase 4 真人验收步骤设计。现有运行时接口**没有「把一个已存在的教师加入某个已建班级」的能力**：`POST /classes` 只在建班当时关联，`role_assignments` 又绑定在特定工作空间上，建班之后没有补充路径。**后果**：验收原计划让校长新建 B 班、把某位已有教师放进去、再由该教师管理 B 班的可见范围——这条链在「放进去」这一步断掉。**已据此改写验收剧本**：校长当天只做两件事（新建空班 B、把 book-005 的可见范围限定到 B 班），可见范围的教师侧操作改由已在班的教师账号执行。本条不影响 T4.3/T4.4 的代码正确性，但属真实的运营能力缺口——现实中转岗、代课、新教师入职都会撞上 |
| D-21 | 社区引文绕过班级可见范围泄露书页原文 | 应修 | 未修 | 发现于 Phase 4 主控对 T4.3 遗留问题的独立核查。`server/domains/community/index.js` 的 `getPost` 返回 `quote: { bookId, page, text }`，`quote_text` 最长 2000 字、且投稿时经 `structuredQuote` 校验确为该书页原文，但**读取时没有任何班级可见范围过滤**。泄露链：B 班学生引用一本限定给 B 班的书投稿 → 帖子过审且范围为校级 → **A 班学生在社区里读到该书原文片段**，同时拿到 `bookId` 与页码。**这是内容泄露，不只是存在性泄露**，与 D-14 同类但路径不同。**本期不修**（主控决策 P4-20）：触发需人工审核放行、社区不在 B-4 点名的四入口内、且正确修法要先定产品语义（投稿时拦 / 读取时过滤 / 已过审旧帖是否追溯），属产品裁决。**注意**：T4.3 已封死 page/asset/AI 三条内容路径，本条是目前已知的唯一残余内容泄露路径 |
| D-22 | `GET /assignments` 未过可见范围，向未授权班学生泄露书名与版本 id | 应修 | 未修 | 发现于 Phase 4 独立验证方的对抗式守卫测试（F-2，真实 HTTP 实测）。利用链：A 班班主任给 A 班布置某书 → 校长把该书收窄到 B 班（`impact.affectedArrangementCount: 1`，系统**明确知道** A 班将失去访问权，且按 B-4 有意不做级联清理）→ A 班学生的五个契约入口全部正确 404 / 不出现，但 `GET /api/v1/assignments` **仍返回该安排**，含 `book.title` 与 `book.id`（实为 bookVersionId）。根因：`projectAssignments` 只按 `organization_id_at_creation` + `workspace_id_at_creation` 过滤，既不过 grants，也不按学生班级裁剪。**只泄露书名与版本 id，不泄露正文**，量级与 D-21 同级。**不在 Phase 4 豁免清单内**（P4-19 豁免的是学生自有对象的写路径与已有书签/摘录，阅读安排是教师创建的对象），故按新口子登记。**注意它同时是 D-23 的前置**：学生正是从这里拿到 `bookVersionId` 的 |
| D-23 | `POST /reading/lease` 既不过可见范围也不过发布状态 | 应修 | 未修 | 发现于 Phase 4 独立验证方（F-3，真实 HTTP 实测）。学生用 D-22 拿到的 `bookVersionId`，对**不可见书**请求阅读租约 → **200**；对**草稿书**版本请求 → **200**。根因：`acquireLease` 只调 `requireScopedBookVersion(db, versionId, orgId)`，`publishedOnly` 用的是默认值 `false`。**不泄露任何正文**（读页仍要过 `getPage`），最多是存在性预言机；但学生可以对一本自己打不开的书累计阅读时长，**污染阅读统计**——而"阅读被记录"正是本产品的核心承诺。**本期不修的理由**：租约 TTL 与续租路由属项目冻结契约（D-11/D-15/D-17 三次复发的重灾区），在验收前夜动它风险过高。修它应当与 D-22 一并规划 |
| D-24 | 控制台「组织账号／班级管理」整块是不落库的演示壳，浏览器里根本无法建班、加学生、加教师 | 应修（**挡 Phase 4 验收剧本，也挡用户设想的目标权限模型**） | 未修 | 发现于 Phase 4 验收剧本编写（主控核查前端调用点）。**D-20 的范围远比原先登记的大**：不只是「建班后无法补加教师」，而是**整个班级与账号管理在前端不写任何数据**。`src/console/pages/accounts/ClassList.jsx:13` 自述「演示壳不落库：创建、编辑、删除、恢复都只弹确认并给出『演示环境不写入』的说明」；`ClassDetail.jsx:325` 的「添加学生」「删除班级」「恢复班级」三个按钮 `onConfirm={() => setConfirm(null)}`，**只关弹窗、不发请求**；`OrgAccounts.jsx:133`、`RoleConfig.jsx:122` 同样是假动作，文案明写「演示环境不写入任何账号数据」。前端 API 层只有 `listStudents` 与 `listAuthorizedClasses` 两个读接口，**全仓库没有任何一处调用 `POST /classes` 或 `POST /students`**。服务端接口本身是可用的（L3 用真实 HTTP 实测 `POST /classes`、`POST /students` 均 201），缺的是前端接线；而「把已有教师加入已建班级」连服务端接口都没有（即原 D-20）。**对验收的后果**：Phase 4 完成标准要求「用 `POST /classes` 建第二个班验证」——这一步**无法在浏览器里完成**，必须走 HTTP 直连业务库，需用户单独授权。**对目标权限模型的后果**：用户设想的「年级主任+校长控制一个班有哪些学生和老师」在前端等于零起点，这是新建能力而非返工 |
| D-25 | `book.publish` 把全局书库发布与班级书架写入耦合在同一权限动作 | 应修（**阻塞 Phase 8 权限定稿**） | 纳入 Phase 8 | Phase 4 按当时裁决把 `book.publish` 授予 `teacher`、`grade_manager`，并让 `PUT /books/:bookId/visibility` 复用同一动作；同一动作也保护全局 `publishBook` / `unpublishBook`。Phase 8 产品裁决已改变：全局书库只由技术团队在受控后端处理，教师只管理本人任教班级的书架，校长和年级主任也无全局书库权。若仅翻转读取谓词而继续复用当前动作和 `scope=organization` 写语义，教师仍可能改变全局状态，且“清空 grants”会从“全组织可见”变成“无人可见”。处置要求：复用既有全局生命周期领域逻辑、幂等与审计，但拆分全局生命周期动作与班级书架动作；教师端改为本人班级的幂等 grant 增删，保留 `class-scope.js` 与 F-1 对称范围校验。现行裁决见 `evidence/phase8/decisions.md` P8-07 |

## 二、明确不记为缺陷

| 项 | 说明 |
|---|---|
| ~~详情页封面为假封面~~ | **该条已撤销，改记为缺陷 D-09。** 真人实测虽看到真实插画封面，但已查明系书架/首页的带头 `fetch` 预热了 HTTP 缓存所致；详情页自身的裸 `<img>` 在冷请求下取不到封面。此为**验收方法被缓存污染**的典型案例：验收路径经过书架再进详情页，就无法暴露详情页的鉴权失败 |
| 文字模式错字 / 缺字 / 排版怪异 | OCR 为可信输入，按 B-2 不做任何形式的 OCR 质量评价 |
| 第 2、3 页文字模式空白 | 基线事实：98 物理页中仅 88 页有 OCR 文本，10 页无文本。空白属预期 |
| 作者显示「服务端未返回作者」 | 符合决策 D6（作者字段留空） |
| 阅读器顶栏「本次已读 X 分钟」刷新后归零 | **属预期，且是复验时最容易误判为失败的一项。** 该数字是 `Reader.jsx` 本地 `setInterval` 每 60 秒加一，语义是"本次"，刷新必然从零开始。它与书籍详情页的「有效阅读时间」是两个不同的东西：后者走 `reading_daily_book_summaries` 的 `SUM(effective_reading_ms)`，跨会话跨日汇总，刷新不受影响 |

## 三、待定性观察

| 观察 | 说明 |
|---|---|
| 原版模式右页整页橙色 | 真人观察，疑为第 2 页印刷底色（该页无 OCR 文本）或渲染未完成，尚未定性。后续复验时确认 |

## 四、已通过项（真人实测）

- 首页/书架封面显示真实插画封面，书名「和大人一起读·儿童歌谣」正确
- 详情页封面为真实插画封面
- 原版 PDF 模式可渲染书页；顶栏「原版 PDF · 覆盖第 1-98 页」，底栏「第 1 页 / 共 98 页」
- 「减少动态效果」或「平移」翻页效果下，翻页与跳页正常，画面与页码同步
- 双模式页码对应未见错位
- 学生端未出现「已读 X%」或「完成度」推算指标
- **2026-08-17 后续轮次**：返回详情正常（D-04 已解除）；页码统计正常（D-05）；时间计算正常，真人主观判断按分钟级别基本准确（D-11，非精确验证）
- **同轮发现、待复验**：详情页返回后页码/时长须手刷（D-16，`fcdccfe` 已修待真人复验）

## 五、测试抖动（**已闭环**；历史：Phase 3 前必须定性）

`tests/frontend/reading-monitor-client-coordinator.test.mjs` 现已确认**至少三条**用例抖动：

| 用例 | 观测 | 备注 |
|---|---|---|
| 「真实生命周期事件在后台、freeze和网络恢复时额外提交」 | 修 D-11 前 20 跑 1 败、修后 20 跑 2 败；失败形态恒为"断言应有额外提交、实际没提交" | 最早发现的一条 |
| 「首页刷新协调在accepted终态前不解锁」 | 加跑时撞到（`store.records.length` 期望 1 实际 0） | 第二条 |
| 「tickDirect抛错后定时链仍会进行下一次尝试」 | 首跑失败、重跑即过 | **这是 `f5f99a8` 为 D-11 新加的回归守卫本身在抖** |

第三条最值得警惕：**为核心修复所加的守卫如果自身不可靠，它既可能在修复被破坏时仍然通过，也可能在一切正常时报红**，等于这条守卫暂时不能作为 D-11 不回归的凭据。**（历史：`6b61aa7` 确定化后守卫已可信，见第五节「闭环结论」。）**

### 定性结论：测试侧竞态（独立复核已确认前两条）

复核 agent 的实测把"随机抖动"变成了确定规律：

| 跑法 | 「真实生命周期…额外提交」 | 「首页刷新…不解锁」 |
|---|---|---|
| **只跑这两条 × 20** | **20/20 失败** | 20/20 通过 |
| 整文件 × 10 | 9 过 / 1 败 | 10/10 通过 |

**冷启动必败、混在整文件里跑才偶败**——前面的用例预热了 `crypto.subtle` 之后概率才下降。根因是测试第 32–34 行 `settle()` 的固定 8 次 `setImmediate` 等不到 `persistSnapshot`（内含 `crypto.subtle.digest` 与入队）完成，断言开火时异步提交还在飞。

产品侧 `visibilitychange` / `freeze` / `online` 均走串行 `run()` → `persistSnapshot()`，**没有"超时就丢"的分支**。故为测试窗口过窄，**不是生产丢摘要**。

第三条（D-11 新守卫）复核未覆盖——因派发简报写于发现它之前，只点名了前两条。其定性仍开放，且必须查清是同源的测试侧竞态还是**产品侧续期逻辑本身有竞态**；若为后者，意味着 D-11 只修了一半。**（历史：第三条已于 `6b61aa7` 一并确定化，见下文「闭环结论」。）**

**修法约束**：不得把 8 拍改成更多拍（只是把窗口挪远），应改为轮询等待条件成立（`waitUntil(predicate, timeout)`）或等 coordinator 空闲；不得放宽或删除断言换取通过。

**为何必须在 Phase 3 前定性（历史）**：这些用例覆盖的正是「学生切后台 / 页面被冻结 / 网络恢复时补交阅读时长」路径。若抖动源自 coordinator 侧真实竞态而非测试写法，意味着真实场景下学生阅读记录仍会偶发丢失——那 D-11 只修了一半。而即便确为测试侧，按当前复发率，Phase 3–7 每次质量门都可能撞上假红，届时最危险的不是浪费时间，而是**把真回归当成"已知抖动"放过去**（本次已发生一次：三条失败中有一条其实是新守卫，若不细看极易归入既有噪音）。**该 urgency 已随下文闭环而解除。**

### 闭环结论（检查点 `6b61aa7`、`22164d2`）

**定性：测试侧竞态，不是产品侧缺陷。** 根因是用例里 `advance()` / `settle()` 等固定次数的 `setImmediate` **没有等到**异步操作（`crypto.subtle.digest`、入队）完成就断言。产品侧 `visibilitychange` / `freeze` / `online` 均走串行 `run()` → `persistSnapshot()`，**没有「超时就丢」的分支**。

| 检查点 | 范围 | 结果 |
|---|---|---|
| `6b61aa7` | 最初三条抖动用例 | 引入 `waitUntil()` / `waitIdle()`，等待条件成立后再断言；**全部确定化** |
| `22164d2` | 同类竞态扫尾 | `reading-monitor-client-coordinator.test.mjs` 14 条中有 **8 条**属同一模式，**已全部确定化**；同目录 **12 个兄弟文件**经检查无同类问题；确定化后单文件连跑 **20/20**、全套连跑 **5/5** |

**效力**：D-11（`f5f99a8`）修复逻辑成立；coordinator 回归守卫**现可信**，不再因测试窗口过窄产生假红。第九节条件①据此关闭。

## 六、处置建议

| 缺陷 | 建议时点 | 理由 |
|---|---|---|
| **D-11（含 D-05）** | **已关闭（真人实测通过）** | 阻塞级。`f5f99a8` + `a2c1ed3` 修复后，2026-08-17 后续轮次真人确认页码与时长均正常（时长为分钟级主观口径）。历史：待真人复验 |
| 测试抖动定性（三条，含新守卫） | **已闭环** `6b61aa7` + `22164d2` | 定性为**测试侧竞态，非产品缺陷**（`waitUntil`/`waitIdle` 替代固定 `setImmediate`）。coordinator 14 条中 8 条同模式已全部确定化；单文件 20/20、全套 5/5。历史：进 Phase 3 前定性 |
| D-04 返回详情失效 | **已解除；死键结构由 D-17 关闭** | 与 D-11/D-15 同根因，随 `f5f99a8` + `a2c1ed3` 修复。D-17 给 `closeAndWait` 加上 4s 有界超时，队列再堵也不会永久卡住导航 |
| **D-17 无会话僵尸租约** | **已修 `c0dfdaf`，真人复验通过**（证据归档于 `c40765a`） | 第三次复发。B1 无会话也走同一停滞阈值、B2 活跃在位者不可被抢、B3 导航有界超时。真实库已观测到 `ced73a99` version 冻结在 58、续期 409 `LEASE_REQUIRED` |
| D-03 三维翻页回弹 | **已按裁决隐藏 `8e25247`** | 用户裁决为隐藏而非删除或修复：默认改平移、curl 分支不可达、UI 去掉偏好项，代码保留。永久债记 `docs/tech-debt.md` TD-001 |
| D-09 详情页封面、D-10 资产缓存 | **已于 Phase 4 开工时先行修复**（工作区未提交，待真人复验） | 两者同源，都指向"受保护资产如何被 `<img>`/CSS 消费"这一决策。Phase 4 教师端书库与详情页用 CSS `background-image: url(...)` 取图，处境与 D-09 完全相同；D-10 的缓存问题更会直接削弱 Phase 4 的可见范围管控 |
| D-06 文字模式内容丢失 | Phase 5 Reader 补缺 | 已定性为应修，但修法涉及设计取舍（页内滚动 / 自动缩小字号以适配 / 增加展开），需先定方案。规模上会影响全部 49 本中所有文本较多的页面 |
| D-07 | 不记，附带补一句面板文案 | 属实现预期 |
| D-08 | 随最终报告一并修订 | 纯文档 |
| D-12 跨设备时长丢失 | **不阻塞 Phase 6**（2026-08-17 主控裁决） | 严重度仍为应修，但 `04` 验收清单无跨设备项，Phase 6 按单设备单标签口径执行；本项延后至 Phase 6 之后或最终报告前处置。详见第十三节 |
| D-16 详情页进度 stale | **已修 `fcdccfe`，待真人复验** | 同轮实测发现症状；五处页面挂载后台刷新，修复后尚未经真人复验。遗留见第十一节 |

## 七、D-11 专项：事件持续流入，汇总环节冻结

**严重度：阻塞。** 本项目核心目标之一是"接通既有阅读计时系统"，若阅读行为不被汇总，该目标未达成，Phase 6 的计时联动验收整个失去基础。

### 症状（真人报告）

首页显示的"3 分钟"来源不明；用户随后继续阅读，**时长完全不增加**，阅读位置也始终停在第 1 页。用户怀疑"数据库链路整个坏了"。

### 实测数据（主控只读查询，2026-08-17 16:05）

**事件链路正常且仍在持续：** `reading_events` 65 行，全为 `page_stay`，**每分钟一条，从 `06:57:16Z` 连续写到 `08:02:55Z` 无中断**，`offline_sequence` 单调递增到 65，最后 3 条的 `page_no` 均为 3，`foreground=1`、`screen_on=1`。

**汇总链路冻结在首次：**

| 表 | 行数 | 关键值 |
|---|---|---|
| `reading_summary_sessions` | 1 | `latest_revision: 1`、`cumulative_effective_ms: 194544`、`last_page_no: 1`、`measured_through_at: 07:01:16.924Z`、`status: open`、`ended_at: null` |
| `reading_progress` | 1 | `last_page_no: 1`、`valid_reading_seconds: 0`、`updated_from_event_at: 07:01:16.924Z` |
| `reading_page_coverage` | 2 | 仅 `page_no` 1 与 2；两行 `effective_text_ms` **都是 194544**；`effective_original_ms` 均为 0 |

### 计时的两条独立路径（走读确认，理解本缺陷的前提）

```
【主路径，权威时长与页码的唯一写入者】
commitLeaf (Reader.jsx:316-321) → visiblePageNos → createStableView (view.js:8-21)
  → coordinator.move() (coordinator.js:426-431) → activity.tracker.move() → cut() (activity.js:75-99)
  → 【触发点】5 分钟 tick / 关阅读器 / 切后台
  → persistSnapshot() (coordinator.js:233-258, 318-325)
  → createSummaryRevision() (summary.js:42-106，指纹字段冻结)
  → POST /reading/session-summaries → writePageCoverage() (monitoring.js:515-578)

【旧事件路径，只喂护眼统计，对汇总零贡献】
useReadingTelemetry.js:113-149 → page_stay / page_turn → submitReadingEvents
```

**关键认识**：`reading_events` 属旧事件路径，它持续流入**不代表**计时健康。权威时长与页码只由摘要写入。

### 根因（已定位，文件+行号）

**两个缺陷互相放大，形成自锁：**

1. **定时链一次失败即永久停摆**（主因）。`coordinator.js` 第 168–174 行：5 分钟定时里 `tickDirect()` 一旦抛错，后续的 `scheduleSummary()` 就不再执行，**定时链从此永久停止**，之后既不会重试也不会自愈。
2. **换页会拆掉监测会话，并制造必然的提交冲突**（触发器）。`Reader.jsx` 第 79 行的组件 `key` 会因 URL `?pageNo=` 变化而重建组件，从而拆掉 coordinator 并换新 `sessionId`；但旧会话在服务端仍是 `open`，新摘要提交会被 `monitoring.js` 第 731–738 行以 **`LEASE_CONFLICT`** 拒绝——该错误又正好触发第 1 条的停表。

**缺陷间的因果链（重要）**：D-01 原版 PDF 加载失败 → 翻页按钮表现为无效（D-03）→ 验证者只能改 URL `?pageNo=` 跳页 → 触发会话重建与 `LEASE_CONFLICT` → 定时链停摆 → D-11 时长与页码双双不再落库 → 表现为 D-05。**这是一条由前序缺陷诱发的连锁失效，不是独立故障。**

### 已排除

- **排除可能 B（指纹重放冻结 revision）**：指纹重放只会返回 200 `replayed`，不会把 revision 冻在 1。
- **排除鉴权缺头**、**排除数据库不可写**、**排除页码追踪失败**（旧事件 `page_no` 已达 3，与主路径同源于 `commitLeaf`，说明 `leaf` 确实推进到第 3 页）。
- 因此 **D-05 与 D-11 同根因**，且不是 D-03 的下游（虽然 D-03 是其触发条件之一）。

时间线印证用户观察：
- 06:56–07:05Z（北京 14:56–15:05）浏览器 agent 会话 → 唯一一次成功提交，产生 revision 1 与 194544 ms，即 UI 上那"3 分钟"（确认为服务端投影，非本地种子）
- 07:20–07:50Z（北京 15:20–15:50）真人会话 → 事件全收到，汇总零推进

### 数据卫生

调查过程**未向库中写入 revision 2**，以免污染这 3 分钟基线。

### 三个疑点的定论（其中两个是我方误判，已撤销）

| 此前疑点 | 定论 |
|---|---|
| 事件 `valid_reading_seconds` 恒为 0 | **设计如此，不是缺陷**（`catalog.js` 868–871）。护眼用 `valid_eye_seconds`，有效阅读时长不从事件累加。若误当根因去改有效时长计算，将触犯 B-2 冻结的计时算法 |
| 第 1、2 页各记满额 194544 ms | **设计如此，不是缺陷**（`activity.js` 85–96）。双页展开时两页同时可见，同一段有效毫秒记给视图内所有页，该字段非"该页独占时长"，故逐页之和本就不应等于会话总时长 |
| `effective_original_ms` 全为 0 | **属当时情形，非路径缺失。** 原版模式的时长归因路径存在，但要求 PDF 处于 `ready`（`Reader.jsx` 214–216）。当时 PDF 加载失败（D-01），故全程记在文字模式。D-01 已修，该路径应可工作，但**尚未经真实运行验证**，仍是 Phase 6 的待验项 |

### 修复方向（agent 建议）

优先让**定时失败后仍能续期**（不因一次异常永久停摆），并**避免换页拆掉监测会话**。**不得触碰摘要 schema 与指纹算法。**

真人验证只需一项：连续阅读满 6 分钟以上，在浏览器 Network 面板确认出现**第二条** `session-summaries` 请求。

### 历史记录：曾待区分的两种可能（已由上文定论取代）

| | 可能 A：客户端摘要提交停止 | 可能 B：服务端拒绝 revision ≥ 2 |
|---|---|---|
| 机制 | 事件与摘要是两条提交路径，事件通、摘要只成功过一次 | 摘要到达但被幂等/指纹去重判为重放而丢弃，或汇总任务不再被触发 |
| 支持线索 | `latest_revision` 恒为 1；`reading-monitor-client-coordinator.test.mjs` 的「后台/freeze/网络恢复额外提交」实测 **10 跑 1 败**，失败形态正是"应有额外提交、实际没提交" | 表中存在 `latest_fingerprint` 与 `revision_fingerprints_json` 幂等结构；若指纹输入在多次提交间不变，后续提交会被判重复 |

### 计时的两条独立路径（走读确认，决定性）

```
【主路径，逐页覆盖真值】
commitLeaf (Reader.jsx:316-321) → visiblePageNos → createStableView (view.js:8-21)
  → coordinator.move() (coordinator.js:426-431) → activity.tracker.move() → cut() (activity.js:75-99)
  → 【触发点】5 分钟 tick / 关阅读器 / 切后台
  → persistSnapshot() (coordinator.js:233-258, 318-325)
  → createSummaryRevision() (summary.js:42-106，指纹字段冻结)
  → ports.submitSummary() (apiPorts.js:34-38) → POST /reading/session-summaries
  → writePageCoverage() (monitoring.js:515-578) → 写 reading_page_coverage（只加 delta）

【旧事件路径，只喂护眼统计，有效秒恒 0】
useReadingTelemetry.js:113-149 → page_stay / page_turn → enqueueLegacy → submitReadingEvents
```

**这条走读修正了此前的两处误判：**

| 此前被列为疑点 | 实际结论 |
|---|---|
| 事件 `valid_reading_seconds` 恒为 0 | **设计如此，不是缺陷。** 旧事件路径只服务护眼统计（`valid_eye_seconds`），对摘要汇总无贡献。若误当根因去改有效时长计算，将触犯 B-2 冻结的计时算法 |
| 第 1、2 页各记满额 194544 ms | **设计如此，不是缺陷。** `stableView.pageNos` 是视图内**可见页集合**，双页展开时两页同时可见，`cut()` 把同一段有效毫秒记给视图内所有页，故逐页之和本就不应等于会话总时长 |
| "事件持续流入即客户端提交正常" | **推断过宽。** 该结论只对旧事件路径成立；主路径的摘要提交是独立 HTTP 请求（`POST /reading/session-summaries`），完全可能已停止。因此"可能 A"并未被排除，反而最可疑 |

**已可排除**：页码追踪失败。旧事件的 `page_no` 已达 3，而旧事件与主路径同源于 `commitLeaf` → `stableView`，说明 `leaf` 确实推进到第 3 页。**页码是好的，坏的是提交。** 故 D-05 与 D-11 同根因，且**不是** D-03 三维翻页回弹的下游。

### 收窄后的调查方向

摘要提交触发点明确为三个：**5 分钟 tick、关闭阅读器、切后台**。真人连续阅读约 30 分钟理应触发约 6 次 tick，但 revision 恒为 1。核心问题变为：**`persistSnapshot()` 在首次之后为何再未成功推进？** 取证点：定时器是否还在跳 → `persistSnapshot()` 是否提前 return → revision 2 是否生成 → HTTP 是否发出 → 服务端是否判为重放。`pendingStore.js`（存的正是摘要重试队列）的实际内容是区分"没生成/没发出"与"发了但被拒"的最快判据。

### 仍开放的疑点（历史）

**`effective_original_ms` 全为 0**，时长全归文字模式。当时原版 PDF 处于加载失败状态，可能确实全程在文字模式；但需从代码确认原版模式的时长归因路径真的可用，否则 Phase 6 的"双模式×计时联动"验收会直接失败。

**2026-08-17 更新（第十二节）**：此疑点已消解为「非路径缺失，待 Phase 6 实操验证双模式分别累计」，**不再作为开放调查项**。

### 与既有抖动的关联

第五节记录的 `reading-monitor-client-coordinator.test.mjs` 抖动（10 跑 1 败，「应有额外提交、实际没提交」）与本缺陷症状同形。若 coordinator 的提交调度存在竞态，则测试里 10% 复现、真实环境可能常态失败。**此前把该抖动判为"既有噪音"是过于乐观的判断**，现应作为 D-11 的重要线索对待。

**2026-08-17 更新（第五节闭环，`6b61aa7` + `22164d2`）**：抖动已确定化为**测试侧竞态**，**不是** coordinator 产品侧竞态；D-11 修复逻辑成立，回归守卫现可信。

### 真人复验（2026-08-17 后续轮次）

同轮浏览器实测覆盖 D-04、D-05、D-11（及 D-15 所阻塞的端到端路径）；环境同文首（`127.0.0.1:5190` / `5191`，`internal-student`，book-001）。

| 编号 | 真人结论 | 备注 |
|---|---|---|
| D-04 | **通过** — 返回详情正常 | 与 D-11/D-15 同根因，随 `f5f99a8` + `a2c1ed3` 解除；历史状态为「待真人定性」 |
| D-05 | **通过** — 页码统计正常 | 与 D-11 同根因 |
| D-11 | **通过** — 时间计算正常 | 真人主观判断「按分钟级别基本准确」；**非秒级或 DB 精确对照验证** |
| D-16 | **发现、待复验** | 同轮唯一不足：详情页须手刷；`fcdccfe` 已合入，修复后真人尚未复验 |

## 八、受保护资产鉴权矩阵（Phase 4 决策依据）

`GET /api/v1/books/assets/:assetId` 挂在 integration router 的 `requireSession` + `requireWorkspace` 之后（`server/http/integration-router.js` 387–388），资产路由无例外；`requireWorkspace` 强制读取 `X-Workspace-Id` 头，不会用会话的 `activeWorkspaceId` 兜底（`server/middleware/request-context.js` 53–61）。

| 请求形态 | 会话 Cookie | `X-Workspace-Id` | 结果 |
|---|---|---|---|
| `fetch` 带凭证与工作空间头（学生首页/书架已改成这样） | 有 | 有 | **200**，再转 blob URL |
| 裸 `<img src>` / CSS `background-image: url()` 冷请求 | 有（浏览器自动带） | **无**（浏览器不允许加自定义头） | **400** |
| 完全未登录 | 无 | 无 | **401** |
| 同一 URL 曾在 1 小时内被带头请求过且缓存有效 | — | — | 裸 `<img>` **可能**显示（命中缓存）。**不可当作接口契约**，D-09 即因此被误判 |

**结论：浏览器不可能给 `<img>` 或 CSS `url()` 添加自定义请求头，因此这条路走不通。** 修法只有两条：

1. **前端逐个改造**：所有消费方都改成带头 `fetch` + `URL.createObjectURL`（当前仅学生首页与书架完成）。待改造清单：学生详情页（`src/components/ui.jsx` 的 `BookCover`）、教师端书库与详情页（`src/console/pages/teaching/BookLibrary.jsx`、`BookDetail.jsx` 51–52 行、`ArrangeList.jsx`，均用 CSS `url()`）、社区帖图（`PostCard.jsx`、`PostDetail.jsx`，读公开 `covers/${book.id}.jpg`，导入书天然无此文件）。
2. **服务端放宽**：为 `GET /books/assets/:assetId` 增加"缺头时以会话 `activeWorkspaceId` 推断工作空间"的回退，并同步收紧缓存（见 D-10）。

方案 2 改一处即可覆盖全部消费方，方案 1 需逐个改造且每新增一个展示位就要重复一次。但方案 2 触及鉴权中间件，需谨慎评估越权风险与既有测试（`identity-core.test.js` 578–582 断言"有 Cookie 无头 → 400"，放宽后该断言需重新界定适用范围）。**该决策留给 Phase 4 前处置，不在 Phase 2 内擅自变更鉴权。**

## 九、`f5f99a8` 契约边界独立复核（只读，审查范围 `937ce0b..f5f99a8`）

D-11 的修复动到了 `server/domains/reading/monitoring.js` 与 `catalog.js`，改的是**新会话何时可以接管未关闭旧会话**的租约语义。该语义虽不属 B-2 明文冻结项，但紧邻冻结区且改变了数据何时可写，故未照单接收，另派只读复核。

**结论：已通过**（历史表述为「有条件通过」）。条件为①三条抖动测试确定化②真人 6 分钟复验；**两项均已满足**。

**2026-08-17 更新**：
- 条件②：第七节「真人复验」（时长分钟级主观通过；未做 Network 第二条 `session-summaries` 专项对照）。
- 条件①：**已闭环** `6b61aa7` + `22164d2`——定性为**测试侧竞态，非产品缺陷**；最初三条及同文件 8 条同模式用例已全部确定化；单文件 20/20、全套 5/5。详见第五节「闭环结论」。历史：条件①曾标「仍开放」。

### 契约边界：通过

- `summary.js` **不在该提交的 11 个文件内**，`createSummaryRevision()` 与 `FINGERPRINT_FIELDS` 原样未动；服务端 `SUMMARY_FIELDS`（14–31）与 `normalizeSummary()`（202–269）未改
- 未新建第二套系统：复用既有 `closeReadingSummarySessionsForLease` → `closeOpenSummaryRows`；新增的 `expireStaleLeasesForActor`（340–345）只是既有 `expireActiveLease` 的按 actor 清扫；租约 TTL 仍为 90 秒
- 写入语义未变：同会话 `delta = 新累计 − 旧累计`，新会话首份累计作第一笔 delta

### 越权风险：无

接管条件确为「同一学生 +（同一租约 或 租约已死）」（`monitoring.js` 740–758）：

| 场景 | 结论 |
|---|---|
| 另一名学生 | `findLeaseHistory`（374–389）要求 org / actor / workspace / device / bookVersion 全等，对不上即拒 |
| 另一台设备、租约仍活 | `sameLease` 假且 `otherLeaseDead` 假 → 仍抛 `LEASE_CONFLICT`，只能走既有显式接管 |
| 另一台设备、租约已过期 | 关闭的是同一学生的残留；`acquireLease` 本就会清过期租约 |
| 另一工作空间 | `findLeaseHistory` 要求 `workspace_id` 一致 |

`closeOpenSummaryRows`（325–331）另带 `lease_id_at_start = :leaseId AND status = 'open' AND measured_through_at <= :endedAt`，不会全表扫。

### 跨会话汇总：无清零回归

详情页「有效阅读时间」是跨会话跨日汇总，刷新不会抹掉已入账时长。链路：`reading_daily_book_summaries.effective_reading_ms` → `projectBooks()`（`projections.js` 22–38、81–87）按 actor + workspace + bookVersion 做 `SUM`，`effectiveMinutes = Math.floor(ms / 60000)` → `adapters/student.js` 136 `minutes` → `BookDetail.jsx` 189–191。194544 ms → `floor(3.24)` = 3，与现状吻合。

多会话不重复计墙钟：旧会话累计已入日汇总，新会话从 0 起只把自己的累计当 delta。

### 不重复计时：独立验证成立；并查出一条丢失路径

`REVISION_CONFLICT`（704–707）真实存在且拒绝写入：同 revision 指纹不同即抛错 return，不 `updateSession`、不写日汇总；指纹相同则 `replayed`/`superseded`，也不加 delta。

重复方向全部安全。**但丢失方向查出一条**，已记为 **D-12**（见缺陷清单）。

### 关闭残留不丢数据：确认

`closeOpenSummaryRows` 只更新 `status / ended_at / end_reason / updated_at / version+1`，不碰 `cumulative_effective_ms`、`latest_revision`、`latest_fingerprint`、`revision_fingerprints_json`。单调触发器（`043_reading_session_summaries.sql` 168–194）禁止累计回退、禁止已关闭行改 `ended_at`，允许 open → closed。服务端新测例（`reading-monitoring.test.js` 568–575）断言关闭后仍为 194544、revision 仍为 1。**「3 分钟」基线不会被清零或重算。**

## 十、D-15 专项：僵尸标签页续租锁死租约

**严重度：阻塞。** 与 D-11 症状同形（阅读时长与页码均不推进），但根因不同：D-11 是客户端定时链停摆 + `LEASE_CONFLICT`；本条是**活租约被脱管标签页无限续期**，其他设备/会话被 `READING_LEASE_HELD` 拒于门外。D-05、D-11 在 `f5f99a8` 的修复未能覆盖本路径；**连续三轮真人复验均失败**，直至 `a2c1ed3` 在真实环境观测到续期被拒、租约自然过期后才可关闭。

### 症状（真人报告）

真人打开学生端阅读器，顶栏显示 `READING_LEASE_HELD`；`POST /reading/lease` 返回 409，监测会话建立不起来，阅读时长与页码完全不记录。

### 触发源

一个脱管的浏览器标签页——**跑在 Cursor 内嵌浏览器里，是 2026-08-17 当天下午某个子 agent 做浏览器验证时留下的页面**，不是用户自己的 Chrome。

### 定位方法（留档）

1. **`Get-NetTCPConnection`**：观察到 5190 与 5191 的客户端端口连号成对（56674/56675、61923/61924、51986/51987），说明同一客户端先请前端再请后端。
2. **进程归属**：该客户端 socket 归属 Cursor 的 `NetworkService` 进程（pid 44972），其父进程是标题为「Cursor Agents」的 Cursor 窗口。
3. **MCP 盲区**：当前会话的浏览器 MCP `browser_tabs list` 返回空——该标签页已脱离 MCP 管理，工具查不到。

### 与既有诊断的更正

| 此前判断 | 定论 |
|---|---|
| 用户 Chrome 后台残留进程持有续期 | **已证伪。** 用户按判断彻底关闭 Chrome 三次均无效；主控在征得用户同意后杀掉全部 29 个 `chrome.exe` 进程后，续期依然每 60 秒继续，才排除 Chrome。真凶是 Cursor 内嵌浏览器里 agent 遗留的标签页 |
| D-11 `f5f99a8` 已修，真人复验应通过 | **本路径未覆盖。** D-11 修的是 coordinator 定时链与 `LEASE_CONFLICT` 接管语义；本条是租约续期无停滞检查导致的 `READING_LEASE_HELD`，真人三轮复验均因此失败 |

**过程建议**：凡涉及「客户端仍在活动」的判断，应先用连接归属证据定位宿主进程，再要求真人操作；勿在未定位前让用户白等（本次用户被要求关 Chrome 三次、白等约 40 分钟）。

### 根因（机制）

```
【客户端】leaseController 每 60 秒无条件续租（TTL 90 秒、提前 30 秒续期）
         ↓ 该页摘要提交链早已停摆
【服务端】renewLease 原先无条件延长租约，从不检查关联会话是否仍在推进
         ↓ 租约永不过期
【阻塞】 catalog.js 296–299 行对任何其他设备抛 READING_LEASE_HELD
         ↓ 新会话一条摘要都发不出去
```

实测：该租约自 `06:56:16Z` 起被连续续期近三小时，`active_reading_leases.version` 达 187；而关联会话自 `07:01:16Z` 起 `latest_revision` 恒为 1、`cumulative_effective_ms = 194544` 未变。

### 修复（`a2c1ed3`）

`server/domains/reading/monitoring.js` 的 `renewLease` 按该租约上最新一条摘要会话的 `measured_through_at` 判定停滞，超过 `STALE_SESSION_RENEW_THRESHOLD_MS = 420` 秒即拒绝续期（抛既有 `LEASE_REQUIRED`），租约 90 秒内自然过期后交既有清理链路接管。

**约束**：不新增接管策略、不改 TTL 数值、不碰摘要 schema 与指纹。阈值依据：5 分钟摘要 tick + 90 秒 TTL + 约 30 秒调度余量。

### 附带修复

`server/http/integration-router.js` 中 `readmate_device` 从会话 Cookie 改为 365 天持久 Cookie，并抽取 `ensureDeviceCookie` 提前到 `executeIdempotentAsync` 之前写入；课堂路由（`POST /classroom/sessions/:sessionId/control`）复用同一实现。原先是会话 Cookie，浏览器完全退出即丢失，导致同一台机器重启浏览器后被判为新设备。

### 检查点

`a2c1ed3`。质量门 server 200/200、frontend 171/171、build 退出码 0。

### 真实环境实测证据

修复后重启后端（`10:03:22.825Z` 起 pid 37708）：

| 观测项 | 值 |
|---|---|
| 首次续期被拒 | `10:03:40.307Z`；幂等记录 `state=failed` / `status_code=409` / `failure_code=LEASE_REQUIRED` / `failure_reason=阅读租约关联会话已停滞，不能续期` |
| `active_reading_leases.version` | 冻结在 187（末次成功 `10:02:40.280Z`） |
| 租约过期 | `10:04:10.279Z` |
| 僵尸页后续行为 | 既未再续期也未重新抢占租约 |
| 残留会话数据 | `cumulative_effective_ms = 194544` 与 `latest_revision = 1` 未被改动 |

### 过程教训：首版修复「单元测试全绿但线上完全不生效」

本条与缺陷本体同等重要，是本项目的过程教训。

**首版问题**：首版修复的停滞判定 SQL 带了 `status = 'open'` 过滤条件。而僵尸页在服务端重启后会触发同设备 `acquireLease`；`server/domains/reading/catalog.js` 第 311–316 行会以 `lease_taken_over` 关闭该租约的 open 会话。于是判定的会话查询返回空行，`UPDATE active_reading_leases` 照常执行，续期继续成功。

**发现方式**：主控在真实环境只读观测 150 秒，看到 `version` 仍在 176→177→178 递增、审计 `outcome=succeeded`，才发现修复根本没生效。

**测试缺口**：

| 问题 | 说明 |
|---|---|
| 首版 4 条领域回归 | 全部让会话保持 `open` 状态，**没有一条覆盖「同设备 re-acquire 把会话标成 closed 之后仍能续期」这条真实生产路径** |
| 报告中声称的 2 条 HTTP 用例 | **实际不存在** |

**已补回归（4 条）**：领域层 2 条（closed 会话停滞超阈值拒续、同设备 re-acquire 关闭 open 会话后停滞拒续）；HTTP 层 2 条（同两个场景走 HTTP 断言 `LEASE_REQUIRED`）。

**验收纪律建议**：服务端改动光有「重启后端 + 单元测试全绿」不足以判定生效，**必须在真实环境用真实数据观测到预期行为**（本例是观测续期是否真的被拒、租约是否真的过期）才能宣称修复完成。

## 十一、D-16 专项：阅读器返回详情后进度不刷新

**严重度：应修。** 后端落库正常，缺陷纯在前端 runtime 缓存 stale；与 D-11/D-15（汇总链路冻结）症状不同，但同样会让用户误判「阅读未被记录」。

### 症状（真人报告）

学生端从阅读器点「返回详情」回到书籍详情页后，**页码与有效阅读时长仍是进入阅读器之前的旧值**，必须手动刷新浏览器才更新。对照组：返回主页时「今日有效阅读」能正常显示最新值（无需刷新）。

### 根因（机制）

阅读进度数据（`progress.currentPage` / `effectiveMinutes`）挂在 Provider 级 `runtime.data.books` 上（`src/student/state/useStudentRuntime.js` → `src/api/useApiResource.js`），**只在 Provider 首次挂载或显式 `reload()` 时重拉**。

`StudentProvider`（`src/student/StudentApp.jsx` 第 40–41 行）跨「详情页 ↔ 阅读器 ↔ 主页」导航均不卸载；详情页组件虽 remount，但**不触发 runtime 重拉**。

主页「今日有效阅读」走页面级 hook `useReadingStatistics`（`src/student/state/useReadingStatistics.js` 第 192–195 行），每次进页 `refresh()`，故正常。

**后端落库已只读确认无问题**：新会话、逐页时长、`reading_progress.last_page_no` 均已更新。

### 修复（`fcdccfe`）

1. **`useApiResource` 新增 `refreshInBackground()`**：复用同一 loader 保证字段一致，但**不把状态切到 loading**——旧数据先展示、后台完成后静默替换，避免书架与主页闪骨架屏（这是未直接用 `reload()` 的原因）；竞态由独立的 `backgroundRequestVersion` 取消。
2. **新增 `src/student/state/useRefreshStudentRuntimeOnMount.js`**：用 ref + 空依赖只在挂载时触发一次，不把 `runtime` 放进 effect 依赖以避免自触发循环。
3. **五处一并接入**：详情页、书架、书单、书单详情、排行，避免「详情页修了、书架还旧」的不一致。

**未引入**：轮询；阅读器关闭路径上的人为 `setTimeout` 等待（`closeAndWait` 已有终态等待）。

**未触碰**：摘要 schema 与指纹算法；`coordinator.js` / `leaseController.js` / `pendingQueue.js`。

### 回归测试

`tests/frontend/student-runtime-refresh-on-mount.test.mjs`（6 条）。核心用例按「阅读器关闭已落库 → 详情页挂载后台刷新 → 页码与时长更新」这条真实路径建模，而非只测纯函数——针对 D-15 过程教训（单元测试全绿但路径未覆盖）的直接回应。

### 检查点与质量门

检查点 `fcdccfe`。质量门：server 200/200、frontend **177/177**（基线 171 + 新增 6）、build 退出码 0。

### 真人复验状态

**待复验。** 2026-08-17 后续轮次在 `fcdccfe` 部署前发现症状（返回详情后须手动刷新浏览器）；同轮 D-04/D-05/D-11 已通过。代码已修，**修复后行为尚未经真人复验**——不得写为已验证通过。

### 遗留

| 项 | 说明 |
|---|---|
| 主页书架区块仍读 `runtime.data.books` | 若将来出现「从阅读器直接回主页而不经详情/书架」的路径，进度可能仍 stale。当前阅读器只 navigate 到详情页，不在本缺陷路径内 |
| 后台刷新仍拉 3 个接口 | 比单拉 progress 略重 |
| 刷新失败时 stale-ready 语义 | 保留旧数据并附 error，数值可能仍旧 |

## 十二、计时归因语义只读核查（2026-08-17，供 Phase 6 与最终报告引用）

来源：代码走读 + 业务库只读查询。**明确区分「已证实」与「推断」。**

### 已证实

1. **双页对开成对记账是设计如此，不是缺陷。** 同一稳定视图内的停留毫秒同时记给 `view.pageNos` 里的每一页，语义是「该页在对开视图内共同可见时的累计时长」，不是独占时长。计算源头在客户端 `src/student/reading-monitor/activity.js` 第 85–96 行（`for (const pageNo of state.view?.pageNos)` 同一 delta 写入各页）；服务端 `server/domains/reading/monitoring.js` 第 524–600 行只做透传与 delta 累加，不拆半页。契约文档亦明确「不得改双页可见覆盖记满额语义」。

2. **当前没有任何地方对逐页字段跨页求和当总时长，因此不存在翻倍。** 实测佐证（book-001 当日）：`reading_page_coverage` 的 `effective_original_ms + effective_text_ms` 合计 **725092 ms**，而 `reading_daily_book_summaries.effective_reading_ms` 为 **362546 ms**，比值约 2.0——**若有人误用逐页 SUM 就会翻倍，但现行展示链路一律走日汇总或 session 累计。** 此为警示，防止后续开发误用。

3. **`valid_reading_seconds` 恒为 0 是旧路径遗留，不是缺陷。** `reading_events.valid_reading_seconds` 在 `catalog.js` 第 874–877 行硬编码 0（护眼数据走 `valid_eye_seconds`）；`reading_progress.valid_reading_seconds` 在 `monitoring.js` 第 497–508 行固定写 0、只更新 `last_page_no`。`src/` 下对 `valid_reading_seconds` / `validReadingSeconds` **零引用**，无任何展示或报表依赖它。

4. **两处时长展示口径不同，不可互相对照：** 详情页「有效阅读时间」走 `server/integration/projections.js` 第 23–37 行，对 `reading_daily_book_summaries.effective_reading_ms` 按书 SUM、**不按 stat_date 过滤**，是**全书累计**；主页「今日有效阅读」走 `server/domains/reading/statistics.js` 第 254–338 行，按 `stat_date` 汇总，是**当日**秒数。

5. **同一天多会话汇总不重不漏：** `processSummary` 对新 session 写 `delta = cumulativeEffectiveMs`、对已存在 session 写 `delta = new − old`，`writeDailySummary` 累加。实测当日新设备 6 条会话之和 168002 ms，含坏数据 7 条之和 362546 ms，与 `reading_daily_book_summaries` 记录的 362546 ms 完全一致。会话墙钟紧邻或重叠不会重复计入（按各 session 的 effective delta 累加，不按墙钟区间合并）。

6. **D-15 那条僵尸坏会话的时长会被计入当日汇总：** 会话 `5ef8e32c`（194544 ms ≈ 3.24 分钟，`end_reason=lease_taken_over`）已通过 `writeDailySummary` 写入当日，**无按 end_reason 或设备过滤的机制**。362546 − 168002 = 194544，精确相减。因此真人在主页看到的「今日有效阅读」含约 **3.24 分钟虚高**。

### 推断（未完全证实，需 Phase 6 实操验证）

7. 会话 `f7246f26` 墙钟约 228 秒但只计入 19184 ms（约 19 秒）。有效时长计入条件是 `ready && visible && foreground && leaseValid && storageAvailable && view`（`activity.js` 第 64–66 行 `eligible()`），`document.visibilityState` 变 hidden 会立即切段（`coordinator.js` 第 374–398 行），且**没有**空闲阈值。缺口可被「页面不可见/不满足计时条件时自动暂停」解释，符合验收项 E5 的设计意图，但**无法仅从数据库区分是切后台还是 PDF 未 ready**。验证方法：前台连读 1 分钟 vs 切走 2 分钟再回来，对比 session 累计与墙钟。

### 与既有疑点的消解（不删历史，在此标注）

| 历史记录位置 | 原疑点 | 本次结论 |
|---|---|---|
| 第七节 D-11「三个疑点的定论」、`effective_original_ms` 全为 0 | 属当时情形，非路径缺失；Phase 6 待验 | **已消解。** 当时全为 0 系 D-15 租约锁死时期（PDF 亦可能未 ready）的坏数据/观测窗口所致，非原版模式归因路径缺失。D-01 已修后路径存在，Phase 6 仍须实操验证双模式分别累计 |
| 第七节「仍开放的疑点」`effective_original_ms` 全为 0 | 需确认原版模式时长归因路径可用 | **同上，疑点已消解为「待 Phase 6 实操验证」**，不再视为路径缺失 |
| 第七节「第 1、2 页各记满额 194544 ms」 | 设计如此 | **第十二节第 1、2 条以库内数据复核确认**，与 D-11 当时定论一致，并补充了 725092 vs 362546 的翻倍警示 |

## 十三、Phase 6 主控裁决与已知偏差清单（2026-08-17）

### 裁决一：D-12 不阻塞 Phase 6

**依据**：`docs/product-close-loop/04_端到端验收清单.md` 第 82–85 行验收项里**没有跨设备/多设备项**；唯一相关 F3 是「刷新 Reader 后会话/租约行为正常（不产生幽灵计时）」，属单设备刷新场景。

**决定**：D-12（跨设备真冲突时 `LEASE_CONFLICT` 丢弃队头、本地 revision 已 commit、后续变 `REVISION_GAP` 导致整段时长静默丢失）记为**已知风险，延后处置**；Phase 6 按**单设备单标签**验收，与清单本来口径一致。

**效力**：覆盖缺陷清单 D-12 行原先「须在 Phase 6 计时联动验收前处置」的表述（见第一节与第九节历史记录，不删改原文，以此节为准）。

### 裁决二：不清理库中坏数据，Phase 6 改用增量口径验收

**依据**：清坏数据需向业务库写入，风险不划算；当日汇总已被 D-15 僵尸会话污染约 3.24 分钟（第十二节第 6 条）。

**决定**：Phase 6 计时相关验收（E1、E2、E5、E9、E11 等）**不比绝对总数**，而比**增量**——读 X 分钟后看总时长是否增加约 X 分钟。增量对该污染免疫，也更贴近真实验收语义。

**操作指引**：验收前记录 baseline（如 `GET /reading/statistics/self` 今日秒数或详情页 `effectiveMinutes`），阅读后再读，断言增量而非与历史绝对值对照。完整操作说明见 `04_端到端验收清单.md` E 节前置说明。

### Phase 6 必须如实记录的已知偏差

验收人与最终报告须知晓以下项，**不得当作缺陷漏报，也不得当作已通过而隐瞒**：

| # | 已知偏差 | 性质 | 证据/引用 |
|---|---|---|---|
| K-01 | 双页对开成对记账：逐页 `effective_*_ms` 之和 ≠ 会话/日汇总 | 设计如此 | 第十二节第 1、2 条 |
| K-02 | 当日汇总含 D-15 僵尸会话约 3.24 分钟虚高 | 数据污染（不清理） | 第十二节第 6 条；会话 `5ef8e32c` |
| K-03 | `valid_reading_seconds` 恒为 0 | 旧路径遗留，无展示依赖 | 第十二节第 3 条 |
| K-04 | 详情页「有效阅读时间」= 全书累计；主页「今日有效阅读」= 当日 | 口径不同，不可对照 | 第十二节第 4 条 |
| K-05 | D-12 跨设备 `REVISION_GAP` 静默丢时长 | 已知未修风险 | 第一节 D-12；本节裁决一 |
| K-06 | D-16 修复后：从阅读器直回主页（若将来存在）书架进度可能仍 stale | 遗留 | 第十一节遗留表 |

## 十四、D-17 专项：无会话僵尸租约无限续期（第三次复发）

**严重度：阻塞。** 2026-08-17 19:13 真人反馈与 D-11、D-15 完全同形：学生端「返回详情」死键，阅读时长与页码不被记录。这是同一结构第三次冒出来，前两轮（D-11 `f5f99a8`、D-15 `a2c1ed3`）都只堵住了当时的触发路径。

### 为什么前两轮没兜住

| 轮次 | 修了什么 | 没修什么 |
|---|---|---|
| D-11 `f5f99a8` | coordinator 定时链一次失败不再停摆；同设备/死租约可接管残留 open 会话 | 续期完全不看会话是否在推进；导航仍无限等待提交队列 |
| D-15 `a2c1ed3` | `renewLease` 按该租约最新会话 `measured_through_at` 拒停滞续期 | **判定以「存在会话」为前提**。`if (leaseSession) { ... }`，查不到行就整段跳过，无会话租约可无限续。接管仍是「谁最后申请谁赢」 |

D-15 过程教训（首版 SQL 带 `status = 'open'`，同设备 re-acquire 把会话标成 closed 后判定永远不触发）已经补了「closed 会话」路径，但**没有补「从来没有会话」这条生产路径**。本次现场租约 `ced73a99` 就是这条漏网：续了 58 次、约 58 分钟，`reading_summary_sessions` 里 `lease_id_at_start` 对不上任何一行。

### 现场（2026-08-17，机器实测）

- **续期方**：Cursor `NetworkService` pid 44972（`--utility-sub-type=network.mojom.NetworkService`），父进程 Cursor.exe 53052。5190 上 3 条 Established 连接全部归属 44972。与 D-15 同一宿主：Cursor 内嵌浏览器里脱管的阅读器标签页。**未杀 Cursor 进程。**
- **5191 后端**：只有 1 个 `node server/index.js`。终端 762843（pid 55692）在 11:12:26Z 被标 aborted，但子进程树 `5152 (npm) → 51540 (cmd) → 37708 (node)` 成为孤儿并继续服务；37708 启动于 10:03:23Z，跑的是 `a2c1ed3` 磁盘代码（`monitoring.js` mtime 18:00:19）。D-17 重启后替换为 pid 23804（11:29:22Z）。
- **循环 A（:33）**：`workspace.used` + `reading.lease.renewed`，租约 `ced73a99` 的 60 秒续期。
- **循环 B（:56）**：`workspace.used` + `reading.events.ingested`，同一僵尸页的旧护眼 `page_stay`（`useReadingTelemetry` 里 `setInterval(flushLegacyStay, 60_000)`）。**不是第二条租约，也不是第二个后端。**
- **10:31:32 的「抢回」**：`5d055d7e` 的 `end_reason = lease_ended`，`expires_at = 10:24:41.331Z`，`released_at = 10:31:32.076Z`。这是过期租约在新 `acquireLease` 里被清掉，不是活租约被 takeover。时间上对齐 Vite HMR `18:31:31` 重挂 Cursor 内嵌阅读器。之后新租约从未建会话，只续期。

### 证据 3 假设：**成立**

`a2c1ed3` 的停滞判定被包在 `if (leaseSession) { ... }` 里。无会话时 `leaseSession` 为空，续期无条件成功。健康对照仍是拿租约后 28–51 ms 建会话；「有租约无会话」不是时序宽容，是绝对异常。

### 结构性改动（选择根治，接受比「只堵续期」更大的改动面）

三层一起改，缺一层就会再复发：

1. **B1 续期必须真在干活**：停滞基准统一为「该租约最新会话 `measured_through_at`；若无会话则用租约 `acquired_at`」。同一函数、同一 `420s` 阈值。阈值依据不变：5 分钟摘要 tick + 90s TTL + ~30s 调度余量。健康客户端 30–51 ms 建会话，420s 对无会话极度宽松，不另设短阈值，以免误伤尚未打到首个 5 分钟 tick 的慢启动客户端。
2. **B2 租约仲裁看谁在活跃**：在位者有会话且 `measured_through_at` 未超阈值 → 即使 `takeover: true` 也返回 `READING_LEASE_HELD`。在位者停滞或无会话已超阈值 → 普通 `acquire` 即可接管（生产客户端从不传 takeover）。新鲜无会话（刚拿到租约、尚未证明在干活）仍要求显式 takeover，保住既有「另一台设备立即 acquire → 409」契约，也保住「旧设备已停读后换设备」：旧设备关闭后最多 90s TTL 过期，或 420s 后被判定停滞即可被新设备拿走。
3. **B3 导航永不阻塞**：`closeAndWait` 把 `waitTimeoutMs: CLOSE_WAIT_TIMEOUT_MS`（4s）传给 `coordinator.close`。超时后仍返回；`Reader.jsx` 用 `try/finally` 保证无论等待成功、超时还是抛错都执行 `navigate`。已确认写入留在服务端，未确认记录留在 pending store，不删。即使将来再出现任何租约异常，返回详情也不会再死键。

未触碰 `summary.js` 的 `FINGERPRINT_FIELDS` / `createSummaryRevision()`；未新建第二套计时系统；未写业务库阅读数据。改动前 `VACUUM INTO server/data/readmate.sqlite.pre-d17-backup`。

### 真实环境观测（重启新代码 pid 23804 之后）

| 时刻 | version | updated_at | expires_at |
|---|---|---|---|
| T0 11:29:05Z 重启前 | 58 | 11:28:33.879Z | 11:30:03.879Z |
| T1 11:29:29Z 重启后 | 58 | 11:28:33.879Z | 11:30:03.879Z |
| T2 11:30:55Z | 58 | 11:28:33.879Z | 11:30:03.879Z |
| T3 11:31:41Z（已过 expires_at） | 58 | 11:28:33.879Z | 11:30:03.879Z |

末次成功续期 11:28:33Z（旧进程）。新进程上 11:29:33Z 的续期幂等记录：`status_code=409` / `LEASE_REQUIRED` / `阅读租约关联会话已停滞，不能续期`。此后 version 不再递增，`expires_at` 不再推进。

### 既有阅读数据（改动前后一致）

| 表 | 行数 / 关键值 |
|---|---|
| `reading_summary_sessions` | 7 |
| `reading_progress` | 1，`last_page_no=21` |
| `reading_daily_book_summaries` | 1，`effective_reading_ms=362546`，`last_page_no=21` |
| `reading_page_coverage` | 22 |

### 质量门

server **207/207**（基线 200 + 7）、frontend **179/179**（基线 177 + 2）、`npm run build` 退出码 0。未 commit。

### 遗留

- ~~Cursor 内嵌阅读器标签页仍在，仍发旧 `page_stay`。请用户手动关掉该内嵌标签。~~ **此条作废，见下文主控收尾：该标签对用户不可见，此动作不可执行。**
- 观测 `ced73a99` 冻结并过期之后，本 agent 为 B3 补了 `Reader.jsx` 的 `try/finally`，Vite HMR 重挂了该僵尸页。2026-08-17T11:32:45.708Z 设备 `714f0cc7` 取得新租约 `315e6e31`（`ced73a99` 同时 `released_at` 被既有过期清理写上）。新租约无会话，B1 将在 `acquired_at + 420s` 后拒续期；在此之前真人若打开阅读器会拿到 `READING_LEASE_HELD`，或等阈值后普通 acquire 即可接管。这是「标签还活着」的剩余窗口，不是无限锁死。
- D-12 跨设备 `REVISION_GAP` 仍未修。

### 主控收尾（2026-08-17 19:35–19:51）

**检查点 `c0dfdaf`**（修复本体）、**`a4d15ea`**（教训更正与证据归档）。

**B1 在第二个租约上自行开火，构成独立的第二次生效证据。** 与上表 `ced73a99` 那次不同，这次全程无人工干预：

| 租约 | acquired_at | 末次续期 | version 冻结值 | 判定 |
|---|---|---|---|---|
| `315e6e31` | 11:32:45.708Z | 11:38:45.782Z | 7 | 下一次续期（约 11:39:45Z，即 `acquired_at + 420s`）被 B1 拒绝，此后不再递增并自然过期 |

主控在 11:42:50Z 与 11:44:25Z 两次只读采样，version 均为 7、`updated_at` 均为 11:38:45.782Z，确认续期已停止。

**「请用户手动关掉该内嵌标签」这条遗留作废，因为它不可执行。** 用户明确反馈该标签在其 Cursor 界面中**完全不可见**（原话「这个根本就没有啊，至少对我是透明的」）；主控在自己会话里调 `browser_tabs list` 返回空，说明它属于另一个 agent 会话的浏览器上下文，已彻底脱管。**结论：任何缺陷的收尾都不得依赖「让用户去关那个页面」。** 详见 `05_主控交接说明.md` 第 9 节教训 3 的更正。

**替代手段（实测有效，已收录为可复用应急开关）**：轮换 `.env` 的 `SESSION_TOKEN_SECRET` 并重启后端，使所有既有会话签名失效，脱管页面从此无法认证，既不能续租也不能重新获取。代价仅是所有人重新登录一次（演示密码不变）。**完全不触碰业务数据**——11:48:07Z 复核四张事实表：会话 7 行且时长逐条一致（194544 / 97821 / 24888 / 20651 / 19184 / 3978 / 1480）、`last_page_no=21`、日汇总 362546 ms、逐页覆盖 22 行。

副作用提示：学生端目前**没有退出/登录入口**（Phase 5 的 T5.4 未做），所以密钥轮换后用户会看到满屏 `AUTH_REQUIRED: 需要有效登录会话`、极易误判为数据丢失，且**无法从 UI 找到重新登录的路径**。今后使用该开关必须同时告知直达地址 `/student/login`。

### 真人复验：通过（2026-08-17 19:51 / 19:55）

用户重新登录后确认恢复正常。三层修复中，**B3（返回详情不再死键）已由真人实测确认**，这是本轮最关键的用户可见保证；B1 有两次真实环境证据（一次人工重启后观测、一次完全自动开火）。**B2（活跃阅读不得被抢）仅有测试覆盖，未经真实双设备实测**，如实标注为 L2。

**D-16 同批复验通过（19:55）**：用户确认「不需要刷新了，现在时长和页面的同步是实时的」。检查点 `fcdccfe` 生效，详情页从阅读器返回后无需手动刷新即更新页码与时长。**D-16 关闭。**

**D-12 决策（用户 19:55 明确表态）**：「暂时没有出现跨设备的需求所以也无从验证」。故 D-12（跨设备真冲突时 `LEASE_CONFLICT` 丢队头导致下次 `REVISION_GAP`、整段时长静默丢失）**继续挂起，不阻塞任何 Phase**，并明确记录其风险边界：单设备单标签使用不会触发；一旦将来引入多设备场景，D-12 必须先修，否则会静默丢时长（静默是最危险的部分——不报错、不可见）。

### 残余风险（已接受，非缺陷）

活着的脱管客户端仍可反复占用 **≤420 秒**的租约窗口。**不能靠缩短阈值消除**：会话行只在首次摘要提交时落库，而首次提交在第 5 分钟 tick——实测对照租约 `0ffaca49` acquired 06:56:16.870Z、其会话行 `created_at` 07:01:16.934Z，正好差 300 秒。因此 300 秒内「正当但尚无会话」与「僵尸」在服务端不可区分，阈值必须大于 300 秒。

彻底消除需让「无会话」状态不可能存在（取得租约时即建会话行），但那贴近禁改的摘要修订与指纹链（B-2 硬契约），属高风险设计，暂不立项。**有 B3 兜底后，同类问题的最坏表现已从「界面卡死」降级为「几分钟内计时不全」。**

---

## 十五、D-19 专项：原版模式正文发糊（D-18 未解决的另一半）

### 症状（真人报告）

D-18 把 49 本的演示尺寸统一之后，用户复验的结论是「尺寸统一了，但**全部变糊**，包括原来清晰的那 8 本大书」。随后一轮把 canvas backing 提到 `max(1, dpr) × 2`，用户复验**仍然很糊**。用户对尺寸的要求是明确的：「尺寸不动，只加清晰」，超大尺寸「根本没法读」。

### 决定性的一条恒等式（实测反推，误差 0.2%）

阅读器的整页缩放是 `Reader.jsx` 的 `k = Math.min(box.h / pageDesign.height, perPage / pageDesign.width)`。这批书内页宽高比 472:672 = 0.702，而宽屏舞台宽高比约 1.7，**所以 `min` 里永远是高度那一项胜出，宽度项从不生效**。把它代进字高：

```
汉字设备像素高 = 字身pt × scale × dpr
              = 字身pt × (box.h_css × dpr) ÷ 页高pt
              = 字身pt × 舞台物理像素高 ÷ 页高pt
```

**dpr 被约掉了。** 这条恒等式直接判掉了此前两轮的全部尝试：canvas backing 倍率、dpr、对开还是单页、浏览器 Ctrl+加号缩放，**都不在等式里**，所以都不可能改变清晰度。第二轮把 backing 加到 4 倍无效，原因就在这里，不是实现有 bug。

验证：book-049 离线量得字身 8.69 pt（2211 个字块中位数）；真人 F11 截图实测 `scale = 849/672 = 1.263`，代入预测汉字 8.69 × 1.263 = **10.98 设备像素**，截图里实测行墨迹高 **11.0**。误差 0.2%。

### 实测原始数字

来源：PyMuPDF 只读产品里的 `source.pdf`（未重渲染、未重导），加真人两张截图。

| 场景 | 页框（设备像素） | scale | 汉字字身（设备像素） | W×D 对 1141 |
|---|---|---|---|---|
| 窗口模式 | 436 × 620 | 0.923 | ≈ 8（行墨迹高 8.0，行距 18.0） | 38% |
| F11 全屏 | 597 × 849 | 1.263 | 10.0（332 个字块，p25=9 p75=11） | 52% |

页尺寸与信息量上限（`getViewport({scale:1})` 的 pt 值即 CSS px）：

| 书 | 内页 viewport | 内嵌扫描图 | 等效 DPI | `pickPdfPageDesign` 结果 |
|---|---|---|---|---|
| book-001 | 467.6 × 671.2 | 1130 × 1622 | 174 | 463.45 × 671.17 |
| book-048 | 472.1 × 672.0 | 1141 × 1624 | 174 | 467.59 × 672.00 |
| book-049 | 472.1 × 672.0 | 1141 × 1624 | 174 | 472.14 × 672.00 |
| book-005 | 465.9 × 674.9 | 1126 × 1631 | 174 | 465.93 × 674.90 |

正文汉字字身（行投影切行 + 列投影切字，只统计宽高比 0.7–1.4 的方块）：book-048 = 9.10 pt（1366 样本）、book-049 = 8.69 pt（2211）、book-045 = 8.69 pt（2125）、book-031 = 9.93 pt（1033）。book-001 / book-005 是一年级带拼音书，分布双峰，低峰是拼音，汉字在 p75 ≈ 8.69 pt。

**新事实（此前未记录）**：那 8 本封面 MediaBox 大的书，**封面本身的像素也真的多**（4696–4706 × 6604，同样 174 DPI，原稿是 27 英寸幅面）。但它们的内页仍然只有 1141 px，与其余书完全相同。

### 根因

**不是渲染管线，是字太小。** 两条判据同时成立：

1. **解析度有余量，不可能是「画稀了」**：W×D ≈ 436–597 物理像素，而内页扫描图有 1141 px，只用到 38–52%。按 `pdfCanvasOutputScale` 现值，canvas backing 已达 1194 像素（略超源 1141），信息已被用尽。
2. **字号在可读下沿以下**：汉字只有 8–11 设备像素，低于汉字约 12–14 设备像素的可读门槛。这一档无论多少 DPI 都会发糊。

要 12 设备像素需要页高 928 物理像素，要 14 需要 1082。F11 只给到 849。**1080p 屏即使把整块屏都给页面、UI 全部去掉，上限也只有 8.69 × 1080/672 = 13.97 设备像素。** 所以在「整页可见 + 对开 + 铺满窗口」这三条同时成立的前提下，**技术上做不到明显更清**，这不是实现缺陷而是像素预算约束。

同时确认了 D-18 的一个猜测：**那 8 本「大而清」确实只是「大所以看得清」**。旧代码把封面（1947 pt）当全书尺子，`clamp(k, 0.4, 2)` 的 0.4 下限把内页托到 `cssScale = (1947 × 0.4) / 472 = 1.65`，汉字 8.69 × 1.65 = 14.3 设备像素，正好越过可读门槛。同一张 1141 px 的图摊在更大面积上单位锐度只会更低，**不存在一个「更锐」的历史状态**。

### 被证伪的头号嫌疑

交接简报把「`.student-reader-stage` 的 `student-book-open` 动画建立 3D 渲染上下文、把子树按 0.945 倍栅格化成低分纹理」列为一级嫌疑。**证伪，两条独立证据：**

1. **零改动判别实验（真人执行）**：开启「减少动态效果」（`index.css` 把 `.reduce-motion .student-reader-stage` 与 `.student-slide-page` 的动画换成不含任何 transform 的纯 `fade-in`），用户实测**「完全没区别，一样糊」**。
2. **离线复现**：用 PyMuPDF 在同样的 505 / 597 设备像素输出下渲染同一段正文，**完全没有浏览器、没有合成层、没有 canvas**，结果一样糊。糊的主体量不需要合成层来解释。

补充：该动画 `animation-fill-mode: both` 的终态是 `transform: none`（`index.css:1186–1188`），只在挂载时播 0.42 秒，结束后填充为 none，本来也解释不了**持续**发糊。

另按简报要求确认：`STUDENT_CURL_FLIP_ENABLED` 锁死为 false，`HTMLFlipBook` 运行时不可达，未在此路径上耗时。

### 排查中发现的两个附带实现缺陷（均已修）

1. **「字号=大」在宽屏上完全空转。** `Reader.jsx` 的 `spread = prefs.fontScale !== 'lg'`，注释写「大字号 = 单页铺满（每个字都更大）」，但因高度项恒胜，单页时 `perPage` 从 912 变成 1884 根本不影响 `min` 的结果。**选「大」只是把另一页拿掉、左右留两片空白，字一点没变大。**
2. **「轻点正文收起上下栏」不腾地方。** `.student-reader-bar--off` / `.student-reader-foot--off` 只设了 `opacity: 0` 与 `translateY`，而 `.student-reader` 是 `display:flex; flex-direction:column`，两条栏仍占着列高度。**收起后舞台一点不变高，书页一点不变大——白收。**

### 修复

| 文件 | 改动 | 理由 |
|---|---|---|
| `src/student/pdf-page-design.js` | 新增 `PDF_ZOOM_SCALE = 1.6` 与 `applyPdfZoom(fitScale, widthLimitScale)` | 1.6 是反算出来的：8.69 × 1.6 = 13.9 设备像素刚到可读下沿，且 472 × 1.6 = 755 pt 仍在 1141 px 余量内，是真放大不是插值。`applyPdfZoom` 保证放大不小于铺满、不超出舞台宽度 |
| `src/student/pages/Reader.jsx` | `pdfZoomed = readerMode === 'original' && !spread`；放大档走 `applyPdfZoom`；翻页时把滚动视口 `scrollTop` 归零 | 把空转的「大」档变成真正的放大档。**文字模式不进这条分支**——矢量字没有清晰度问题，且不牵动折行契约 |
| `src/index.css` | `--off` 改为 `position: absolute` 脱离 flex 流；新增 `.student-stage-viewport--zoom` 滚动视口 | 收起上下栏能把约 116 px 还给舞台（约 +14%）。滚动视口用 `absolute + inset:0` 而非 `max-height:100%`：舞台是 grid，隐式行按内容定高，百分比上限永远不咬人，会变成整页溢出而不是滚动 |
| `src/student/components/PdfBookPage.jsx` | canvas CSS 尺寸改为整数（`Math.round`），高度按本页自身宽高比推 | 原先 `style.width` 是 505.19 这种小数，grid 居中会把 canvas 摆在半像素上，合成器要带亚像素相位重采样整张纹理。**收益很小，不是清晰度主因**。高度不用 `designHeight` 推，否则那 8 本大封面（宽高比与内页差 1.4%）会被拉变形 |

**默认档（字号=中）的页框尺寸一个像素都没动**：`pdfZoomed` 只在 `fontScale === 'lg'` 时为真；滚动视口的基类刻意不写任何 CSS 规则，未放大时它就是个普通 div，既不裁书页投影也不改居中方式。

对翻页与阅读计时的影响：滚动视口只改 `scrollTop`，不进 `leaf` / `pageNo` / 租约 / 摘要任何链路；`useReaderGesture` 没有 wheel 监听，滚轮不会误触翻页；切换字号本来就会走既有的 `commitLeaf(aligned, 'layout_change')`，不是新增路径。三处地雷（`ReaderView` 的 key 不含页码、返回详情的 `try/finally`、pdfjs legacy 构建）均未触碰，并已补上守卫测试锁死。

### 质量门

`npm run test:frontend` = 194/194，`npm run test:server` = 207/207，`npm run build` 退出码 0（8.71 s，`dist/books/pilot` 49 本齐全）。新增用例：`pdf-page-design.test.mjs` 3 条（放大倍率区间、`applyPdfZoom` 边界、非法输入），`reader-dual-mode-contract.test.mjs` 4 条（canvas 整数尺寸、放大档作用域、上下栏必须脱流、三处地雷守卫）。

### 状态：已解除（2026-08-17 深夜真人复验通过）

**用户在真实浏览器复验后的结论原话：「清晰度基本没问题了」。** 本条按第九节教训 2 的要求，一直等到真人确认才关闭——交付当时 194/194 + 207/207 全绿，但「测试全绿」不构成关闭依据。

**复验的边界（如实记录，别把它读成比实际更强的结论）**：复验确认的是修复后的整体观感达标。未逐本点验 49 本；也未单独确认三处改动各自的贡献——放大档 1.6 倍、上下栏脱流释放的约 116 px、canvas 尺寸取整是一起交付、一起复验的，**无法归因到单项**。按第八节的验证等级记为「真人实测（L4）」，但仅覆盖抽样观感，不覆盖全量。

若后续仍有人报同一症状：**不要再加 `outputScale` 倍数**——那条路已被上面的恒等式判死，第二轮已经在这上面白花过一轮。还成立的产品选项只有继续加大放大倍率或引入连续缩放。

---

## 十六、Phase 5 主控追加（2026-08-18）

台账只追加，不改第一节表里的旧状态原文。

### D-09 / D-10

Phase 4 代码已修并随 `547164d` 提交（第一节「工作区未提交」过时）。2026-08-18 上午下架往返真人验收覆盖了学生书架渲染与打开阅读，因此这两条的修复路径被**顺带走过**。**没有专门探测**：冷缓存下详情页封面是否仍取得到；取消发布后旧 HTTP 缓存是否仍能读到源 PDF。口径：**主链路已验、专项场景未单独探测**。不得改成「真人复验通过」。

### D-06

本阶段已按「页内纵向滚动」落地，与 T5.2 合并。用户 2026-08-18 验收：空白页占位通过；长页可滚完。**已知偏差**：鼠标上下拖不能滚；平板触摸因环境未验。不改修法。详见 `evidence/phase5/decisions.md` P5-02。

### D-14

第一节仍写「未修」。Phase 4 实际已修（资产入口过发布状态与班级可见范围，独立守卫锁着）。本条只作索引，细节以 `evidence/phase4/decisions.md` 为准。
