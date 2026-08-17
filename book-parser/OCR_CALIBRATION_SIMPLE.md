# book-025 OCR calibration thin pipeline

This book-specific CLI binds one allowed physical page image to one OCR result. It is deliberately limited to pages `1, 5, 40, 111, 112, 113, 122, 123, 124, 150, 151, 152` and verifies the frozen PDF SHA-256 and 162-page count before rendering.

The default work root is `work/ocr-calibration-simple/book-025/`. Page images are stored in `images/`; Sol pipeline checks use `self-test/`; Luna calibration results use `formal/`. A result file is never overwritten.

Before using the `.venv/bin/python` commands below, install the pinned project dependencies into that environment with `uv pip install --python .venv/bin/python -r requirements.txt`. PyMuPDF from `requirements.txt` is required; this CLI has no alternate renderer or dependency fallback.

Export exactly one page:

```bash
.venv/bin/python pipeline/ocr_calibration_simple.py export-page \
  --source-pdf /absolute/path/to/frozen-book-025.pdf \
  --page-no 112
```

Prepare a UTF-8 JSON file containing exactly one array of non-empty logical paragraphs, then save one result using the image hash printed by `export-page`:

```bash
.venv/bin/python pipeline/ocr_calibration_simple.py save-result \
  --page-no 112 \
  --expected-image-sha256 <sha256> \
  --paragraphs-json /absolute/path/to/paragraphs.json \
  --model gpt-5.6-luna \
  --task-id <codex-task-id> \
  --kind formal-luna
```

`textSha256` is SHA-256 over the UTF-8 bytes of the paragraphs joined in order with exactly two LF characters (`"\n\n"`). `pipeline-self-test` and `formal-luna` are separate kinds and separate directories; a self-test is never a formal Luna result.

`pipeline-self-test` requires model `gpt-5.6-sol`; `formal-luna` requires model `gpt-5.6-luna`. On every export, the selected PDF page is rendered to PNG bytes in memory. If the target image already exists, those bytes must match exactly or the command fails without overwriting it.

The CLI has no status machine, transaction/commit layer, ledger, correction system, similarity scan, OCR engine, review engine, or recovery fallback.
