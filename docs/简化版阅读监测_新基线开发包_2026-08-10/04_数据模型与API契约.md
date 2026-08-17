# 数据模型与 API 契约

> 文档版本：`clean-baseline-data-api-v1.0`
>
> 说明：本文件固定逻辑结构和接口语义。实际 SQL 类型、路由注册方式、认证头和响应 envelope 应遵循干净基线现有正式约定。

## 1. 数据真值

新功能只增加两类持久真值：

1. 阅读会话累计摘要；
2. 学生每日书籍汇总。

上周平均、连续天数、学生七日、班级今日和班级七日均为查询派生，不建立独立持久表。

现有 `reading_progress`继续使用，但语义改为上次停留位置，不能作为完成度。

## 2. 迁移策略

- 检查新基线迁移账本后使用下一个未占用编号。
- 如果新基线最高为 `042`，建议新增 `043_reading_session_summaries.sql`。
- 不引入旧工作区的 `016_reading_behavior_facts.sql`。
- 不修改已经执行的迁移。
- 新迁移必须有数据库结构、前向执行、重复启动和约束测试。

## 3. 阅读会话累计摘要

建议逻辑表名：`reading_summary_sessions`。

| 字段 | 语义 | 约束 |
| --- | --- | --- |
| `id` | 客户端生成的稳定会话 ID | 主键 |
| `organization_id_at_creation` | 发生时组织 | 必填、不可变 |
| `actor_id_at_creation` | 学生 | 必填、不可变 |
| `workspace_id_at_creation` | 发生时工作空间 | 必填、不可变 |
| `class_id_at_creation` | 发生时班级 | 必填、不可变 |
| `device_id` | 可信设备 | 必填、不可变 |
| `book_version_id` | 书籍版本 | 必填、不可变 |
| `lease_id_at_start` | 会话开始租约 | 必填、不可变 |
| `stat_date` | 统计日 | `YYYY-MM-DD`、不可变 |
| `started_at` | 会话开始时间 | UTC ISO、不可变 |
| `latest_revision` | 最新接受修订 | 正整数、单调递增 |
| `latest_fingerprint` | 最新修订规范指纹 | 必填 |
| `cumulative_effective_ms` | 会话累计有效时长 | 非负安全整数、单调不减 |
| `had_skip` | 是否跳读 | 0/1，只能 0→1 |
| `had_reread` | 是否回读 | 0/1，只能 0→1 |
| `last_page_no` | 上次停留页码 | 正整数 |
| `measured_through_at` | 累计测量截止 | 不早于开始时间 |
| `ended_at` | 会话结束 | 可空，不早于开始时间 |
| `end_reason` | 结束原因 | 受控枚举 |
| `status` | 会话状态 | `open/closed/blocked/deleted` |
| `created_at/updated_at/version` | 基础审计和乐观版本 | 遵循现有项目约定 |

建议唯一性：会话 ID 与完整组织、学生、工作空间、设备、书籍版本范围一致；任何范围变化都必须新建会话。

建议结束原因：

- `reader_close`
- `identity_change`
- `workspace_change`
- `book_change`
- `stat_date_change`
- `lease_ended`
- `lease_taken_over`
- `account_deleted`

不建立页面访问、页面分配和行为证据子表。

## 4. 学生每日书籍汇总

建议逻辑表名：`reading_daily_book_summaries`。

| 字段 | 语义 | 约束 |
| --- | --- | --- |
| `id` | 服务端稳定 ID | 主键 |
| `organization_id_at_creation` | 组织 | 必填 |
| `actor_id_at_creation` | 学生 | 必填 |
| `workspace_id_at_creation` | 工作空间 | 必填 |
| `class_id_at_creation` | 发生时班级 | 必填 |
| `book_version_id` | 书籍版本 | 必填 |
| `stat_date` | 统计日 | `YYYY-MM-DD` |
| `effective_reading_ms` | 当日该书累计有效时长 | 非负安全整数 |
| `had_skip` | 当日该书是否跳读 | 0/1，逻辑或合并 |
| `had_reread` | 当日该书是否回读 | 0/1，逻辑或合并 |
| `last_read_at` | 当日最近阅读时间 | 可空 |
| `last_page_no` | 当日最后停留位置 | 正整数 |
| `created_at/updated_at/version` | 基础审计和乐观版本 | 遵循现有项目约定 |

唯一键：

```text
organization + actor + workspace + class-at-creation + book-version + stat-date
```

必要索引：

- 学生 + 统计日；
- 班级 + 统计日；
- 学生 + 书籍版本 + 统计日；
- 组织 + 统计日。

每次接受新会话修订时，在同一个数据库事务内：

- 增加 `deltaEffectiveMs`；
- `had_skip = old OR incoming`；
- `had_reread = old OR incoming`；
- 使用更新的 `measuredThroughAt`更新最后阅读时间和页码；
- 同步更新现有 `reading_progress`的上次停留位置。

## 5. 查询派生

### 5.1 学生今日

对同一学生、工作空间和统计日的所有书籍汇总：

```text
todayEffectiveMs = SUM(effective_reading_ms)
checkedIn = todayEffectiveMs >= 300000
hadSkip = OR(had_skip)
hadReread = OR(had_reread)
```

### 5.2 上周自然日日均

- 找到当前统计日之前最近一个完整周一至周日；
- 补齐 7 个日期；
- 学生每天跨书汇总，缺失日为 0；
- `lastWeekDailyAverageMs = lastWeekTotalMs / 7`；
- 上周总值为 0 时比较状态为 `no_baseline`。

建议状态：

- `more`
- `close`
- `growth_space`
- `no_baseline`

边界按正负 10% 和 `03`执行。

比较时使用未提前取整的毫秒总值和整数交叉乘法；对外展示的上周日均毫秒四舍五入到最近整数，整秒字段向下取整。

### 5.3 连续打卡

- 每个统计日跨书总时长达到 300,000 ms 即达标；
- 今日达标时从今日向前计数；
- 今日未达标时，如果昨天达标，从昨天向前计数；
- 昨天未达标则为 0；
- 结果只在查询时计算。

### 5.4 班级今日

分母为当前查询班级的有效学生数。

```text
checkInRate = checkedInStudentCount / activeStudentCount
perCapitaEffectiveMs = classTotalEffectiveMs / activeStudentCount
```

零时长学生进入分母。不统计“打开过但不足 5 分钟”。

当前班级没有有效学生时，打卡率和人均时长返回 `null`并由教师页面展示空班级状态，不能用 0%伪装成存在学生但无人打卡。

本期不把转班作为七日趋势的专门产品能力。今日分母采用当前有效班级名单；历史事实按 `class_id_at_creation`查询。若新基线已有可靠成员关系历史，可在不改变上述展示口径的前提下用于历史分母；若没有，不得伪造历史名单，须在实现记录中明确当前名单口径。

## 6. 租约与写入 API

### 6.1 租约

- 继续使用干净基线现有租约获取、释放和接管语义。
- 如果现有租约不能续期，增加明确的续期操作；建议沿用现有 `/reading/lease`资源而不是建立平行身份体系。
- 续期请求必须绑定当前组织、学生、工作空间、可信设备、书籍版本和租约 ID。
- 服务端返回权威 `expiresAt`，客户端在到期前续期。
- 续期失败必须显式失败，不得自动延长本地过期时间。
- 会话摘要接收时必须验证其测量范围处于合法租约范围；本期不建立离线授权窗口。

### 6.2 写入路由

建议：

```text
POST /reading/session-summaries
```

继续使用现有工作空间、身份会话、可信设备和幂等头约定。

### 6.3 请求

```json
{
  "schemaVersion": 1,
  "sessionId": "read-session-uuid",
  "revision": 3,
  "bookVersionId": "book-version-id",
  "statDate": "2026-08-10",
  "startedAt": "2026-08-10T08:00:00.000Z",
  "measuredThroughAt": "2026-08-10T08:15:00.000Z",
  "cumulativeEffectiveMs": 720000,
  "hadSkip": true,
  "hadReread": false,
  "lastPageNo": 86,
  "endedAt": null,
  "endReason": null,
  "fingerprint": "64-lowercase-hex"
}
```

服务端从可信请求上下文取得组织、学生、工作空间、设备、班级和租约，不接受客户端任意覆盖这些范围。

### 6.4 成功响应

```json
{
  "data": {
    "sessionId": "read-session-uuid",
    "revision": 3,
    "result": "accepted",
    "cumulativeEffectiveMs": 720000,
    "dailySummaryUpdatedAt": "2026-08-10T08:15:01.000Z"
  },
  "meta": {
    "requestId": "request-id"
  }
}
```

`result`允许：

- `accepted`：新修订已提交；
- `replayed`：同一修订同一指纹已确认；
- `superseded`：低于最新修订且不会再次计时。

相同修订不同指纹、修订跳号、累计倒退、布尔倒退、范围变化必须返回明确冲突，不能返回成功。

### 6.5 主要错误

- `VALIDATION_FAILED`
- `PERMISSION_DENIED`
- `RESOURCE_NOT_FOUND`
- `LEASE_REQUIRED`
- `LEASE_CONFLICT`
- `REVISION_GAP`
- `REVISION_CONFLICT`
- `SUMMARY_REGRESSION`
- `STAT_DATE_MISMATCH`
- `FUTURE_TIME_REJECTED`

错误遵循现有 envelope，必须包含请求 ID。

## 7. 学生本人 API

### 7.1 路由

优先扩展现有：

```text
GET /reading/statistics/self
```

### 7.2 响应

```json
{
  "data": {
    "generatedAt": "2026-08-10T09:00:00.000Z",
    "dataUpdatedAt": "2026-08-10T08:58:10.000Z",
    "statDate": "2026-08-10",
    "todayEffectiveReadingSeconds": 720,
    "checkIn": {
      "checked": true,
      "thresholdSeconds": 300,
      "remainingSeconds": 0
    },
    "streakDays": 6,
    "comparisonState": "more",
    "lastReading": {
      "bookId": "book-id",
      "bookVersionId": "book-version-id",
      "title": "书名",
      "lastPageNo": 86,
      "totalPages": 300,
      "lastReadAt": "2026-08-10T08:58:10.000Z"
    }
  },
  "meta": {
    "requestId": "request-id"
  }
}
```

`lastReading`在没有任何真实阅读记录时为 `null`；`dataUpdatedAt`在没有每日汇总时可以为 `null`。前端必须按显式空值展示，不得补演示书籍或当前时间。

不得返回：

- 上周总时长；
- 上周日均；
- 与上周的具体差值；
- 同学或班级数据；
- 跳读和回读信息。

## 8. 教师班级 API

### 8.1 路由

优先扩展现有：

```text
GET /reading/statistics/scope?classId=...&statDate=YYYY-MM-DD
```

一期 50 人不分页，一次返回班级汇总、七日趋势和学生详情数据。搜索和筛选在前端执行，避免为四个简单状态增加多套服务端查询。

### 8.2 响应结构

```json
{
  "data": {
    "generatedAt": "2026-08-10T09:00:00.000Z",
    "dataUpdatedAt": "2026-08-10T08:58:10.000Z",
    "statDate": "2026-08-10",
    "class": {
      "classId": "class-id",
      "displayName": "五年级一班",
      "activeStudentCount": 50
    },
    "summary": {
      "checkedInStudentCount": 37,
      "checkInRateBasisPoints": 7400,
      "totalEffectiveReadingSeconds": 54000,
      "perCapitaEffectiveReadingSeconds": 1080,
      "skipStudentCount": 4,
      "rereadStudentCount": 8
    },
    "trend": [
      {
        "statDate": "2026-08-04",
        "checkedInStudentCount": 35,
        "activeStudentCount": 50,
        "checkInRateBasisPoints": 7000,
        "perCapitaEffectiveReadingSeconds": 960
      }
    ],
    "students": [
      {
        "studentId": "student-id",
        "displayName": "学生姓名",
        "todayEffectiveReadingSeconds": 720,
        "checkedIn": true,
        "streakDays": 6,
        "hadSkip": false,
        "hadReread": true,
        "lastReadAt": "2026-08-10T08:58:10.000Z",
        "lastWeek": {
          "totalEffectiveReadingSeconds": 5400,
          "dailyAverageEffectiveReadingSeconds": 771,
          "todayDeltaSeconds": -51,
          "comparisonState": "close"
        },
        "recentDays": [
          {
            "statDate": "2026-08-04",
            "effectiveReadingSeconds": 600,
            "checkedIn": true
          }
        ],
        "lastReading": {
          "bookId": "book-id",
          "bookVersionId": "book-version-id",
          "title": "书名",
          "lastPageNo": 86,
          "totalPages": 300
        }
      }
    ]
  },
  "meta": {
    "requestId": "request-id"
  }
}
```

`trend`和每名学生的 `recentDays`必须补齐 7 个统计日，零值日期不能省略。

无有效学生时 `checkInRateBasisPoints`和`perCapitaEffectiveReadingSeconds`为 `null`。某名学生上周总时长为 0 时，`lastWeek.todayDeltaSeconds`为 `null`、`comparisonState`为 `no_baseline`；教师端不得把它显示成持平。

## 9. 权限和删除

- `/self`只能返回当前学生本人。
- `/scope`只允许同一学校组织内的教师和管理员。
- 服务端必须验证 classId 属于当前组织。
- 学生账号删除时，在单个受控作业或事务中删除会话摘要和每日书籍汇总，并按现有业务更新阅读位置。
- 不能误删其他组织、学生、工作空间或书籍数据。
- 本期不保存独立匿名班级快照；个人事实删除后，查询派生的历史班级结果自然变化。

## 10. 数据时效

- 写入 API 接受修订后立即更新每日汇总。
- `dataUpdatedAt`表示所返回范围内最近一次每日汇总更新时间。
- 教师页面每 5 分钟重新调用 `/scope`，也支持手动刷新。
- 服务端没有每 5 分钟后台重算任务。
- 没有新上传时，数据和 `dataUpdatedAt`不得无故变化。

## 11. 契约错误原则

- 缺字段、非法枚举、非法时间和非法整数明确失败。
- 不用 0、空数组或缓存数据冒充权限失败或服务器错误。
- 不接受未知字段来猜测旧客户端意图；兼容需求必须通过明确版本契约。
- 前端不得根据字段缺失自行补出“未打卡”“无行为”或“暂无历史”。
