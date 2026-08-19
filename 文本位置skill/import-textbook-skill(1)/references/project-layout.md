# 步步教材资产位置

- PDF 导入器：`白板端/bubu_whiteboard/scripts/import_textbook_pdfs.py`
- 白板逐页图片：`白板端/bubu_whiteboard/public/textbook_assets/textbook_pages`
- 白板 OCR 图层：`白板端/bubu_whiteboard/public/textbook_assets/text_layers`
- 白板资源清单：`白板端/bubu_whiteboard/public/textbook_assets/textbook_manifest.json`
- 共享教材清单：`学生端/bubu_student/assets/images/textbook_manifest.json`
- 白板书架模型：`白板端/bubu_whiteboard/src/data/whiteboardModel.js`
- 学生端文字层同步：`学生端/bubu_student/tool/sync_textbook_text_layers.py`
- 学生端完整性扫描：`学生端/bubu_student/tool/check_textbook_assets.py`

`bookId` 使用 `g<年级>-<up|down>-<学科拼音>`，例如 `g6-up-shuxue`。
