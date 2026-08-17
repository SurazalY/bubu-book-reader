# Phase 0 质量门证据

日期：2026-08-17  
环境：Windows / Node v22.17.0 / npm 11.4.2 / 分支 `feat/product-close-loop`

## 汇总

| 命令 | 退出码 | 通过数 | 与基线对比 |
|---|---|---|---|
| `npm run test:server` | 0 | 175/175（`# tests 175` / `# pass 175` / `# fail 0`） | 基线 173/173，本轮多 2 |
| `npm run test:frontend` | 0 | 162/162（`# tests 162` / `# pass 162` / `# fail 0`） | 与基线 162/162 一致 |
| `npm run build` | 0 | Vite production build 成功（1739 modules） | 无数字基线；有 chunk >500kB 警告 |

三项全绿。未改业务代码。

## `npm run test:server` 输出尾部原文

```
# Subtest: root and server packages declare the node:sqlite runtime floor
ok 170 - root and server packages declare the node:sqlite runtime floor
  ---
  duration_ms: 4.002
  type: 'test'
  ...
1..170
# tests 175
# suites 0
# pass 175
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 6611.0027
```

说明：TAP 计数 `1..170` 是顶层子测试编号；汇总行 `# tests 175` / `# pass 175` 为实际用例数。

## `npm run test:frontend` 输出尾部原文

```
ok 162 - 服务端空响应规范化为六个真实空集合，旧足迹不能把空资源变<truncated-by-console>ready
  ---
  duration_ms: 0.5275
  type: 'test'
  ...
1..162
# tests 162
# suites 0
# pass 162
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 391.0929
```

## `npm run build` 输出原文（PowerShell 捕获；勾号在控制台有乱码）

```
> book-reader-app@0.1.0 build
> vite build

vite v5.4.21 building for production...
transforming...
1739 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                              0.95 kB
dist/assets/pdf.worker.min-CHFwMXne.mjs  1,262.40 kB
dist/assets/index-BTQWdyih.css             142.29 kB
dist/assets/Blog-Dw-5wAlo.js                10.59 kB
dist/assets/About-D0_zvyg-.js               10.67 kB
dist/assets/Resources-DoDr5QqC.js           14.35 kB
dist/assets/index-CFkIMAHn.js               28.27 kB
dist/assets/index.es-BByybGQ0.js            49.28 kB
dist/assets/vendor-react-CExCtMBe.js       165.74 kB
dist/assets/ConsoleApp-CKvM0WEc.js         294.92 kB
dist/assets/vendor-icons-DwfL3uyf.js       776.44 kB
dist/assets/StudentApp-ChBSR8yL.js         785.17 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
built in 7.42s
```

另有 `npm warn Unknown env config "devdir"`（环境噪音，非失败）。
