# 读伴书籍解析工作区

这个目录只负责离线书籍解析、质量验证与交付包生成，不直接改动读伴应用，也不提供运行时热导入功能。

## 目录约定

```text
读伴书籍解析器/
├── input/       # 原始 PDF / EPUB，只读，不覆盖源文件
├── pipeline/    # 可复用的解析、校准、校验与打包代码
├── prompts/     # Luna OCR 等模型提示词及版本记录
├── schemas/     # 书籍包、页面、文字块等数据结构定义
├── work/        # 渲染图、模型响应、重试记录等中间产物
└── releases/    # 抽样验收通过的不可变书籍包
```

## 当前状态

- `input/` 已收纳“快乐读书吧”1—6 年级新版资料，共 49 个 PDF。
- `work/initial-validation/` 保存此前一年级带拼音样书的 Luna OCR 技术验证产物。
- 三书试点的冻结目录在 `pilot-books.json`；`pipeline/build_book_package_v2.py` 消费 `text-ocr-v1` 的带几何 JSON 页。
- 默认 49 本走 trusted 路径：编目 `catalog-default-49.json`（由 `pipeline/generate_trusted_catalog.py` 生成），打包 `pipeline/build_trusted_package_v2.py`（消费 `work/ocr-antigravity-v1` 的纯文本页），契约见 `docs/product-close-loop/interface-package-v2-trusted.md`。
- `book-package/v1` 仅保留为历史技术验证，不能导入当前应用。

## 工作原则

1. `input/` 中的源文件只读，任何处理都从副本或渲染页开始。
2. 可复用逻辑进入 `pipeline/`；临时脚本和运行产物进入 `work/`。
3. 模型提示词和数据结构均需有版本号，输出记录来源文件、页码、模型与处理版本。
4. 只有通过结构校验和抽样验收的结果才进入 `releases/`。
5. 应用工程只消费已经发布的书籍包；解析流程与应用发布保持解耦。

## book-package/v2

先安装固定版本依赖，再构建候选包并校验：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python pipeline/build_book_package_v2.py --book-id book-025 --output work/package-v2-candidates/book-025
.venv/bin/python pipeline/validate_book_package_v2.py work/package-v2-candidates/book-025
```

候选包只有在传入人工抽检账本且状态为 `passed` 后才可进入 `releases/`；应用导入器还会再次要求这一状态。源 PDF 是原版模式资产；OCR 的 `lineBBox` 仅保留为审计证据，运行时不得依赖其精度。校订账本每条必须包含 `rawSha256`；发布包只保存 allowlist 后的 OCR provenance，以原始记录哈希追溯，不携带本机绝对路径。

人工抽检证据由 `pipeline/generate_qc_sample_v2.py` 生成。命令必须显式提供 Poppler 的 `pdftoppm` 与可显示中文的字体路径；工具不会静默寻找备用程序或字体。

## book-package/v2 trusted 路径（默认 49 本）

`work/ocr-antigravity-v1/jobs/<bookId>/pages` 下的 `.txt`/`.blank` 是**可信只读输入**：不重新 OCR、不做逐页质检。打包器只做结构检查（页号 1..N 连续、每页恰好一个文件、PDF 存在、PDF 物理页数与 OCR 页数相等、PDF SHA-256 与归档记录一致），产出 `quality.status='trusted-baseline'` 的包。Windows 环境下用 `.venv-win`（POSIX 布局的 `.venv` 是 WSL 环境）：

```powershell
python -m venv .venv-win
.venv-win\Scripts\pip install -r requirements.txt
.venv-win\Scripts\python pipeline\generate_trusted_catalog.py                       # 生成并核对 catalog-default-49.json
.venv-win\Scripts\python pipeline\build_trusted_package_v2.py --book-id book-001     # 输出 work/package-v2-trusted/book-001
.venv-win\Scripts\python pipeline\validate_book_package_v2.py work\package-v2-trusted\book-001
.venv-win\Scripts\python -m unittest discover -s tests                              # 打包器单测
```

包与下游导入器的完整契约（manifest 键路径、偏移语义、封面与 provenance 结构、导入器需要放宽的项）见 `docs/product-close-loop/interface-package-v2-trusted.md`。

通过闸门后，应用导入必须显式指向与服务端 `PUBLIC_ASSET_DIR` 相同的资产目录：

```bash
npm run import:book-package-v2 -- \
  --database /absolute/path/reader.sqlite \
  --package book-parser/releases/book-025 \
  --actor-id <authorized-user-id> \
  --workspace-id <authorized-workspace-id> \
  --public-root /absolute/path/protected-assets
```

导入命令不接受未过人工闸门的候选包，也不会自动选择资产目录。

## 上传边界

这个工作区当前只在本地使用。原始书籍、页面图片、模型原始响应和发布包均不提交到读伴应用仓库；以后如需单独版本化，只提交脚本、提示词、结构定义和小型测试样例。
