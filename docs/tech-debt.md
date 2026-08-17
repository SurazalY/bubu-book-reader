# 技术债

本文件记录需要长期留存的技术债。条目不放进 `docs/product-close-loop/`：那个目录会随任务归档，这里要让半年后接手的人仍能独立判断。

## 条目模板

后续追加请复制下面这一块，编号递增。

```md
## TD-NNN 短标题

| 字段 | 内容 |
|---|---|
| 状态 | open / hidden / fixed / wontfix |
| 严重度 | blocker / should-fix / later |
| 发现时间 | YYYY-MM-DD |
| 影响面 | 哪个端、哪条路径 |
| 根因 | 一两句，含关键库与触发条件 |
| 当前处置 | 做了什么、故意没做什么 |
| 恢复 / 彻底修复代价 | 工时、复验方式、自动化锁不住什么 |
```

正文再写：现象与精确复现、根因展开、若要恢复或删除各要做什么。

---

## TD-001 学生端三维翻页第二次翻页回弹（D-03）

| 字段 | 内容 |
|---|---|
| 状态 | hidden |
| 严重度 | should-fix |
| 发现时间 | 2026-08-17 |
| 影响面 | 学生端阅读器 `src/student/pages/Reader.jsx` 的 `flipStyle: 'curl'` 路径 |
| 根因 | `react-pageflip@2.0.3`（包装 `page-flip@2.0.7`）在 620ms 动效期间被正文重渲染打断；`startPage` 不是受控属性 |
| 当前处置 | **隐藏而非删除**。默认改平移、curl 分支运行时不可达、UI 去掉「翻页效果」；`HTMLFlipBook` 等源码保留 |
| 恢复 / 彻底修复代价 | 恢复：打开开关并恢复 UI，约 0.5 小时 + 真人复验。彻底修复：2–4 小时 + 至少 1–2 轮真人浏览器复验；jsdom 锁不住 620ms 回弹 |

### 现象与精确复现

- **会坏的组合**：关闭「减少动态效果」，且翻页效果为「三维翻页」（`flipStyle: 'curl'`）。
- **第一次翻页**可以成功落到下一页。
- **第二次翻页或跳页**：会播出三维动效，然后**卡回原页**；底栏页码与画面一起回弹。
- **不会坏的组合**：翻页效果选「平移」，或勾选「减少动态效果」（这两条本来就走平移壳，不走 `api.flip()`）。

偏好没有持久化，只活在 `StudentProvider` 的 `useState` 里，刷新即回默认。因此**只藏 UI 选项是无效的**：旧默认值本身就是 `'curl'`，藏掉选项后所有人反而一直走坏路径。

### 根因

`react-pageflip@2.0.3` 包装 `page-flip@2.0.7`。学生端 `goTo` 在 curl 模式调用 `api.flip(t)` 后 `return`，真正改页依赖 `onFlip` → `commitLeaf`。

动效时长 `flippingTime={620}`。这 620ms 内，换页请求会触发 `loading` / `ready` 两轮 render，`HTMLFlipBook` 的 `props.children` 被换成新正文。库随即 `updateFromHtml()`，按**旧索引**重绘，动画被中止并弹回原页。

`startPage` **不是受控属性**。React 侧改 `leaf` 不会把库拉回同步；下一次再 `flip()` 仍从库内部的旧页出发，于是第二次必回弹。

### 当前处置（2026-08-17）

隐藏，不是删除：

1. `visualPreferenceDefaults.flipStyle` 改为 `'slide'`（`src/student/state/StudentContext.jsx`）。
2. `STUDENT_CURL_FLIP_ENABLED = false`，`const curl = STUDENT_CURL_FLIP_ENABLED && …`。即使某处仍传入 `'curl'`（旧状态、代码遗留、将来误传），`api.flip()` 与 `HTMLFlipBook` 渲染分支也不可达，一律走平移。
3. 阅读器 `PrefPane` 与设置页 `Settings.jsx` 去掉整个「翻页效果」偏好项；保留「减少动态效果」。
4. **源码保留** `HTMLFlipBook`、`student-flip-shell`、`startPage`、`onInit`、`reconcileFlipBootstrap`。`tests/frontend/student-frozen-structure.test.mjs` 与 `tests/frontend/reading-monitor-client-reader-initial-page.test.mjs` 是源码扫描测试，删这些标识会红。守卫测试：`tests/frontend/student-curl-flip-hidden.test.mjs`。

### 若要恢复或彻底修复

**只恢复入口（把隐藏改回去）**

1. 把 `STUDENT_CURL_FLIP_ENABLED` 改为 `true`。
2. 默认值是否改回 `'curl'` 要单独裁决；不建议在修复回弹之前改回去。
3. 把 `PrefPane` / `Settings.jsx` 的「翻页效果」选项加回。
4. 至少 1 轮真人复验：关「减少动态效果」+ 三维翻页，连续翻两次并跳页。

**彻底修复回弹**

1. 动效期间冻结 `HTMLFlipBook` 的 `children`（或把正文更新推迟到 `onFlip` 之后），避免 620ms 内 `updateFromHtml()`。
2. 或换掉对不受控 `startPage` 的依赖：翻页中不要让 React 重挂/换子树；失败时用 `turnToPage` 强制对齐。
3. 代价约 **2–4 小时**，外加 **至少 1–2 轮真人浏览器复验**。jsdom 跑不了 620ms 翻页动画，自动化测试**锁不住回弹**，只能锁「开关别被改回去」（现有守卫测试）。

**不要为了减小构建体积而删除**

`react-pageflip` 仍被教师端 `src/console/components/BookFlip.jsx`（`TeacherReader.jsx` / `BookImport.jsx`）以及旧壳 `src/pages/Reader.jsx` 使用。按决策 D10（`docs/product-close-loop/02_决策与契约边界.md`）本期不动教师端。删掉学生端引用不会把该依赖从 bundle 里拿掉。
