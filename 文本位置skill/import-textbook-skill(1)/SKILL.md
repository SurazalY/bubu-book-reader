---
name: import-bubu-textbook
description: 将用户提供且获准用于项目的教材 PDF 导入步步项目白板端，渲染高清逐页 WebP，建立封面和正文页码映射，使用离线 PaddleOCR 生成可框选的定位文字图层，更新学生端共享教材清单并执行完整性、OCR 与生产构建验证。适用于“把课本做进白板”“给扫描教材做 OCR 图层”“导入新的电子教材”“新增年级课本”等请求。
---

# 导入步步电子教材

仅处理用户明确提供或确认可用于本地项目的文件。不要从仅限在线浏览的平台批量抓取教材，也不要把用户提供文件标记为可公开再分发。

## 工作流

1. 定位 `bubu-prototype-design` 根目录；读取根目录 `AGENTS.md`。
2. 检查每个 PDF：文件存在、页数、是否含原生文字层，并渲染封面、前置页、首个正文页、中间页和末页进行视觉抽查。
3. 根据页脚确认 `bodyStartPageIndex`。它是正文第 1 页之前的资产页数量；不要凭旧教材清单猜测。
4. 先干跑技能脚本：

```powershell
python scripts/import_textbooks.py --repo "<repo>" --dry-run --book "<id>|<pdf>|<grade>|<subject>|<semester>|<edition>|<bodyStartPageIndex>"
```

5. 实际导入时去掉 `--dry-run`。脚本会调用仓库内权威导入器，更新共同 manifest 和来源哈希。
6. 在白板端逐本运行离线 OCR。先用 `--pages 1-3 --force` 试跑并检查置信度与图层 JSON，再跑完整页：

```powershell
npm run textbook:ocr -- --book <id> --force
```

7. 运行 `node scripts/generate_textbook_asset_inventory.mjs`，确认无缺页、额外页、孤儿 bookId 或缺封面。
8. 将白板端 `public/textbook_assets/text_layers` 同步到学生端；重建学生端完整性表与生成目录。
9. 按需更新 `src/data/whiteboardModel.js` 的书架项、页数、正文偏移与封面。不要把同一学科的新年级覆盖掉。
10. 验证：

```powershell
npm run test:textbook-text
npm run textbook:audit -- --book <id>
npm run build
```

学生端至少执行教材相关 `flutter analyze` 和测试。

## 验收标准

- PDF 页数等于生成的 WebP 数量。
- 封面是资产第 1 页；正文页码映射与纸面页脚一致。
- 每个资产页都有 JSON 图层；`image.sha256` 与实际 WebP 匹配。
- 图层块同时含像素和归一化坐标，可用于框选、检索与命中学科工具。
- OCR 输出标记为 `machine-draft/unverified`，除非人工逐页核验；不得虚称人工校对。
- 来源记录包含原文件名、SHA-256、页数、获得方式和再分发边界。
- 白板书架可打开新增教材，翻页、单/双页、文字层和批注层均正常。

