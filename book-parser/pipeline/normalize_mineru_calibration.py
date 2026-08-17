#!/usr/bin/env python3
"""Freeze and verify the fixed 12-page MinerU calibration evidence."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import torch
import yaml


BOOK_ID = "book-025"
MINERU_VERSION = "3.4.4"
BACKEND = "pipeline"
METHOD = "ocr"
LANGUAGE = "ch_server"
TEXT_SEPARATOR = "\n\n"
PAGE_FILE_RE = re.compile(r"^page-(\d{4})_(content_list_v2|middle)\.json$")
EXPECTED_IMAGE_SHA256 = {
    1: "712f21c76b4cd33ae89d825d07a8d48c175528a2493b32e5d866b0e4922db70f",
    5: "482cc9f35ccc4d896efa680efd65cd4f24ffe94a9439d752da0023e94c0d4d4a",
    40: "18a4ec868b79077d0e7fb7c60b4c514f4730782a858ac2beb900b331b59ddc08",
    111: "f3833cd8fdd8444c50361dfbe875b2c38d7c5a6b5e4d4d657fa84ed96a17eaf1",
    112: "71c4bf9ba797699f33610a1b5f521cd846d678499bac43082127a111a691f955",
    113: "8c747b12219e5211a693d8ed897d63747e9c800f3e9863770b83f5990a911111",
    122: "502c5f045e1e5d98c4298c96da79cc5981af936f157bcb6f1b06273716bea2f7",
    123: "73652b1aef96bad5e498284f6c7b9cbf1d076ce47efcb1ba7cf74af44be067c7",
    124: "f29e4a7a671d9403b94bbcd0ba9c955e50299e3929843bbb8bea0db7ecd9daf0",
    150: "c8d5c6e7a506bead0ec292b132ce09bcc79dec92f5620ff4a3ceca225b266dd5",
    151: "ba6a91cdd4fb942cc0ed949f9c02a59ee2e5203fcb3a9b0340e123dd92e9731d",
    152: "0a89e4c8c359f85cf8bde99670cb2ca08faf465c178b780b8ce44825563ada50",
}
ALLOWED_PAGES = frozenset(EXPECTED_IMAGE_SHA256)

MODEL_SNAPSHOT = (
    "/mnt/d/project/.mineru-model-cache/3.4.4/huggingface/hub/"
    "models--opendatalab--PDF-Extract-Kit-1.0/snapshots/"
    "ed6b654c018d742e65a17671e379c5e6ecc87ec9"
)
MODEL_FILES = {
    "layout": {
        "relativePath": "models/Layout/PP-DocLayoutV2/model.safetensors",
        "sha256": "e60f3725aeedc88fd319416ef166bda79171a41516a301c27cab9132dc2739d2",
    },
    "ocrDetection": {
        "relativePath": "models/OCR/paddleocr_torch/ch_PP-OCRv6_small_det_infer.safetensors",
        "sha256": "89a96a8adc4e9cd0c994098edc76022e496d35844392562b4694c8fbc583f2da",
    },
    "ocrRecognition": {
        "relativePath": "models/OCR/paddleocr_torch/ch_PP-OCRv6_medium_rec_infer.safetensors",
        "sha256": "5f43c16f2a684b1d2284662178bdb604febd3d6bfdb5ca73828d08d0f7c0c3e9",
    },
}

RUNS = {
    "page-0040": {
        "pages": [40],
        "serverStartedAt": "2026-08-16T02:13:20.791+08:00",
        "submittedAt": "2026-08-16T02:13:57.894+08:00",
        "pipelineStartedAt": "2026-08-16T02:15:02.881+08:00",
        "completedAt": "2026-08-16T02:16:32.673+08:00",
        "serverToCompleteSeconds": 191.882,
        "pipelineToCompleteSeconds": 89.792,
        "modelInitSeconds": 34.97503042221069,
    },
    "batch-remaining-11": {
        "pages": [1, 5, 111, 112, 113, 122, 123, 124, 150, 151, 152],
        "serverStartedAt": "2026-08-16T02:18:54.637+08:00",
        "submittedAt": "2026-08-16T02:19:29.731+08:00",
        "pipelineStartedAt": "2026-08-16T02:20:32.049+08:00",
        "completedAt": "2026-08-16T02:21:29.180+08:00",
        "serverToCompleteSeconds": 154.543,
        "pipelineToCompleteSeconds": 57.131,
        "modelInitSeconds": 3.1651902198791504,
    },
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def relative_to(path: Path, root: Path) -> str:
    return Path(os.path.relpath(path.resolve(), root.resolve())).as_posix()


def discover_structured_files(raw_root: Path) -> dict[int, dict[str, Path]]:
    discovered: dict[int, dict[str, Path]] = {}
    for path in sorted(raw_root.rglob("page-*.json")):
        match = PAGE_FILE_RE.match(path.name)
        if not match:
            continue
        page_no = int(match.group(1))
        if page_no not in ALLOWED_PAGES:
            raise ValueError(f"raw structured output outside the 12-page set: {path}")
        kind = match.group(2)
        page_files = discovered.setdefault(page_no, {})
        if kind in page_files:
            raise ValueError(
                f"duplicate raw {kind} output for physical page {page_no}: "
                f"{page_files[kind]} and {path}"
            )
        page_files[kind] = path

    if set(discovered) != ALLOWED_PAGES:
        missing = sorted(ALLOWED_PAGES - set(discovered))
        extra = sorted(set(discovered) - ALLOWED_PAGES)
        raise ValueError(f"raw page set mismatch; missing={missing}, extra={extra}")
    for page_no, page_files in discovered.items():
        if set(page_files) != {"content_list_v2", "middle"}:
            raise ValueError(
                f"physical page {page_no} requires one V2 and one middle JSON, got {sorted(page_files)}"
            )
    return discovered


def spans_text(spans: Any, context: str) -> str:
    if not isinstance(spans, list) or not spans:
        raise ValueError(f"{context} must be a non-empty span array")
    parts: list[str] = []
    for index, span in enumerate(spans):
        if not isinstance(span, dict) or span.get("type") != "text":
            raise ValueError(f"{context}[{index}] must be one text span")
        value = span.get("content")
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{context}[{index}].content must be non-empty text")
        parts.append(value)
    return "".join(parts)


def extract_paragraphs(content_list: Any, page_no: int) -> list[str]:
    if not isinstance(content_list, list) or len(content_list) != 1:
        raise ValueError(f"physical page {page_no} V2 output must contain exactly one page")
    page_items = content_list[0]
    if not isinstance(page_items, list):
        raise ValueError(f"physical page {page_no} V2 page must be an array")

    paragraphs: list[str] = []
    auxiliary_types = {"page_header", "page_footer", "page_number"}
    for item_index, item in enumerate(page_items):
        if not isinstance(item, dict):
            raise ValueError(f"physical page {page_no} item {item_index} must be an object")
        item_type = item.get("type")
        content = item.get("content")
        if not isinstance(content, dict):
            raise ValueError(f"physical page {page_no} item {item_index} content must be an object")
        context = f"page {page_no} item {item_index} ({item_type})"

        if item_type == "paragraph":
            paragraphs.append(spans_text(content.get("paragraph_content"), context))
        elif item_type == "title":
            paragraphs.append(spans_text(content.get("title_content"), context))
        elif item_type == "index":
            list_items = content.get("list_items")
            if not isinstance(list_items, list) or not list_items:
                raise ValueError(f"{context}.list_items must be non-empty")
            for list_index, list_item in enumerate(list_items):
                if not isinstance(list_item, dict):
                    raise ValueError(f"{context}.list_items[{list_index}] must be an object")
                paragraphs.append(
                    spans_text(
                        list_item.get("item_content"),
                        f"{context}.list_items[{list_index}]",
                    )
                )
        elif item_type == "image":
            for field in ("image_caption", "image_footnote"):
                spans = content.get(field)
                if not isinstance(spans, list):
                    raise ValueError(f"{context}.{field} must be an array")
                if spans:
                    paragraphs.append(spans_text(spans, f"{context}.{field}"))
        elif item_type in auxiliary_types:
            continue
        else:
            raise ValueError(f"unsupported V2 content type at {context}")

    if not paragraphs or not TEXT_SEPARATOR.join(paragraphs).strip():
        raise ValueError(f"physical page {page_no} normalized OCR text is empty")
    return paragraphs


def validate_middle(path: Path, page_no: int) -> None:
    middle = load_json(path)
    if not isinstance(middle, dict):
        raise ValueError(f"physical page {page_no} middle JSON must be an object")
    if middle.get("_backend") != BACKEND or middle.get("_version_name") != MINERU_VERSION:
        raise ValueError(
            f"physical page {page_no} middle provenance mismatch: "
            f"backend={middle.get('_backend')}, version={middle.get('_version_name')}"
        )
    pdf_info = middle.get("pdf_info")
    if not isinstance(pdf_info, list) or len(pdf_info) != 1 or pdf_info[0].get("page_idx") != 0:
        raise ValueError(
            f"physical page {page_no} must contain one internal image page with page_idx=0"
        )


def run_for_page(page_no: int) -> tuple[str, dict[str, Any]]:
    for run_id, run in RUNS.items():
        if page_no in run["pages"]:
            duration = {
                "measurement": "shared-run-from-local-api-start-to-batch-complete",
                "runId": run_id,
                "seconds": run["serverToCompleteSeconds"],
                "batchPageCount": len(run["pages"]),
            }
            return run_id, duration
    raise ValueError(f"no measured run for physical page {page_no}")


def raw_files_for_page(v2_path: Path, work_root: Path) -> list[dict[str, Any]]:
    ocr_dir = v2_path.parent
    files = sorted(path for path in ocr_dir.rglob("*") if path.is_file())
    if not files:
        raise ValueError(f"raw OCR directory is empty: {ocr_dir}")
    return [
        {
            "path": relative_to(path, work_root),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in files
    ]


def validate_models(models_config_path: Path) -> dict[str, Any]:
    config = yaml.safe_load(models_config_path.read_text(encoding="utf-8"))
    language_config = config.get("lang", {}).get(LANGUAGE)
    expected_config = {
        "det": "ch_PP-OCRv6_small_det_infer.safetensors",
        "rec": "ch_PP-OCRv6_medium_rec_infer.safetensors",
        "dict": "ppocrv6_dict.txt",
    }
    if language_config != expected_config:
        raise ValueError(f"unexpected MinerU {LANGUAGE} model routing: {language_config}")

    snapshot_root = Path(MODEL_SNAPSHOT)
    models: dict[str, Any] = {}
    for name, identity in MODEL_FILES.items():
        path = snapshot_root / identity["relativePath"]
        if not path.is_file():
            raise FileNotFoundError(path)
        actual_sha256 = sha256_file(path)
        if actual_sha256 != identity["sha256"]:
            raise ValueError(
                f"model SHA-256 mismatch for {name}: expected {identity['sha256']}, got {actual_sha256}"
            )
        models[name] = {
            "path": str(path),
            "sha256": actual_sha256,
            "bytes": path.stat().st_size,
        }
    return {
        "source": "huggingface",
        "repository": "opendatalab/PDF-Extract-Kit-1.0",
        "snapshot": snapshot_root.name,
        "routingConfigPath": str(models_config_path),
        "routingConfigSha256": sha256_file(models_config_path),
        "languageRouting": language_config,
        "files": models,
    }


def build_evidence(work_root: Path) -> tuple[dict[int, dict[str, Any]], dict[str, Any], dict[str, Any]]:
    source_root = work_root.parents[1] / "ocr-calibration-simple" / BOOK_ID / "images"
    raw_root = work_root / "raw"
    structured = discover_structured_files(raw_root)

    source_names = {path.name for path in source_root.glob("page-*.png")}
    expected_names = {f"page-{page_no:04d}.png" for page_no in ALLOWED_PAGES}
    if source_names != expected_names:
        raise ValueError(
            f"source image page set mismatch; missing={sorted(expected_names - source_names)}, "
            f"extra={sorted(source_names - expected_names)}"
        )

    mineru_package = Path(importlib.util.find_spec("mineru").origin).resolve().parent
    models_config_path = (
        mineru_package
        / "model/utils/pytorchocr/utils/resources/models_config.yml"
    )
    if importlib.metadata.version("mineru") != MINERU_VERSION:
        raise ValueError(f"expected MinerU {MINERU_VERSION}")
    if not torch.cuda.is_available() or torch.cuda.get_device_name(0) != "NVIDIA GeForce RTX 5060 Laptop GPU":
        raise RuntimeError("the verified RTX 5060 CUDA device is not available")
    models = validate_models(models_config_path)

    results: dict[int, dict[str, Any]] = {}
    raw_manifest: dict[str, Any] = {
        "schemaVersion": "ocr-calibration-mineru-raw-manifest/v1",
        "bookId": BOOK_ID,
        "pages": [],
    }
    for page_no in sorted(ALLOWED_PAGES):
        image_path = source_root / f"page-{page_no:04d}.png"
        image_sha256 = sha256_file(image_path)
        if image_sha256 != EXPECTED_IMAGE_SHA256[page_no]:
            raise ValueError(
                f"source image SHA-256 mismatch for physical page {page_no}: "
                f"expected {EXPECTED_IMAGE_SHA256[page_no]}, got {image_sha256}"
            )

        v2_path = structured[page_no]["content_list_v2"]
        middle_path = structured[page_no]["middle"]
        if f"page-{page_no:04d}" not in v2_path.parts:
            raise ValueError(f"raw directory does not bind physical page {page_no}: {v2_path}")
        validate_middle(middle_path, page_no)
        paragraphs = extract_paragraphs(load_json(v2_path), page_no)
        text = TEXT_SEPARATOR.join(paragraphs)
        run_id, duration = run_for_page(page_no)
        raw_files = raw_files_for_page(v2_path, work_root)

        result = {
            "schemaVersion": "ocr-calibration-mineru-page/v1",
            "kind": "formal-mineru",
            "bookId": BOOK_ID,
            "pageNo": page_no,
            "imagePath": relative_to(image_path, work_root),
            "imageSha256": image_sha256,
            "paragraphs": paragraphs,
            "text": text,
            "textSha256": sha256_text(text),
            "mineruVersion": MINERU_VERSION,
            "backend": BACKEND,
            "method": METHOD,
            "language": LANGUAGE,
            "pythonVersion": sys.version.split()[0],
            "torchVersion": str(torch.__version__),
            "torchCudaBuild": torch.version.cuda,
            "requestedDevice": "cuda",
            "device": {
                "type": "cuda",
                "index": 0,
                "name": torch.cuda.get_device_name(0),
                "computeCapability": list(torch.cuda.get_device_capability(0)),
                "evidence": [
                    "MinerU log: GPU Memory: 8 GB, Batch Ratio: 4",
                    "MinerU log: OCR-det ch_server and OCR-rec Predict completed",
                    "nvidia-smi listed the local mineru-api PID as a compute app during inference",
                ],
            },
            "models": models,
            "duration": duration,
            "runId": run_id,
            "raw": {
                "contentListV2Path": relative_to(v2_path, work_root),
                "contentListV2Sha256": sha256_file(v2_path),
                "middlePath": relative_to(middle_path, work_root),
                "middleSha256": sha256_file(middle_path),
                "files": raw_files,
            },
        }
        results[page_no] = result
        raw_manifest["pages"].append(
            {
                "pageNo": page_no,
                "imageSha256": image_sha256,
                "textSha256": result["textSha256"],
                "files": raw_files,
            }
        )

    environment = {
        "schemaVersion": "ocr-calibration-mineru-environment/v1",
        "mineruVersion": MINERU_VERSION,
        "pythonVersion": sys.version.split()[0],
        "torchVersion": str(torch.__version__),
        "torchCudaBuild": torch.version.cuda,
        "torchvisionVersion": importlib.metadata.version("torchvision"),
        "sixVersion": importlib.metadata.version("six"),
        "device": results[1]["device"],
        "models": models,
        "runs": RUNS,
        "timingBoundary": (
            "Run seconds start when the local MinerU API reports started and end when its batch reports completed; "
            "they exclude CLI import/startup before that log line."
        ),
        "serverToCompleteSecondsTotal": sum(
            run["serverToCompleteSeconds"] for run in RUNS.values()
        ),
        "pagesPerMinuteWithinTimingBoundary": round(
            12 * 60 / sum(run["serverToCompleteSeconds"] for run in RUNS.values()), 3
        ),
        "installation": {
            "environmentPath": "/mnt/d/project/.mineru-runtime/3.4.4",
            "modelCachePath": "/mnt/d/project/.mineru-model-cache/3.4.4",
            "mineruInstall": "mineru[pipeline]==3.4.4",
            "mineruInstallSeconds": 1038,
            "dependencyRepair": "six==1.17.0",
            "dependencyRepairReason": "MinerU 3.4.4 pipeline imports six but did not install it.",
            "failedAttemptEvidence": "failed-attempts/page-0040-attempt-01/failure.json",
        },
    }
    return results, raw_manifest, environment


def write_json(path: Path, value: Any) -> None:
    if path.exists():
        raise FileExistsError(f"refusing to overwrite frozen evidence: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def freeze(work_root: Path) -> None:
    formal_root = work_root / "formal"
    if formal_root.exists() and any(formal_root.iterdir()):
        raise FileExistsError(f"formal evidence directory is not empty: {formal_root}")
    results, raw_manifest, environment = build_evidence(work_root)
    for page_no, result in results.items():
        write_json(formal_root / f"page-{page_no:04d}.json", result)
    write_json(work_root / "raw-manifest.json", raw_manifest)
    write_json(work_root / "environment.json", environment)


def verify(work_root: Path) -> None:
    results, raw_manifest, environment = build_evidence(work_root)
    formal_root = work_root / "formal"
    actual_names = {path.name for path in formal_root.glob("page-*.json")}
    expected_names = {f"page-{page_no:04d}.json" for page_no in ALLOWED_PAGES}
    if actual_names != expected_names:
        raise ValueError(
            f"formal page set mismatch; missing={sorted(expected_names - actual_names)}, "
            f"extra={sorted(actual_names - expected_names)}"
        )
    for page_no, result in results.items():
        path = formal_root / f"page-{page_no:04d}.json"
        if load_json(path) != result:
            raise ValueError(f"frozen formal evidence changed: {path}")
    if load_json(work_root / "raw-manifest.json") != raw_manifest:
        raise ValueError("raw manifest or raw files changed")
    if load_json(work_root / "environment.json") != environment:
        raise ValueError("environment evidence changed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--write", action="store_true", help="freeze evidence; default verifies it")
    args = parser.parse_args()
    if args.write:
        freeze(args.work_root)
        action = "frozen"
    else:
        verify(args.work_root)
        action = "verified"
    print(json.dumps({"action": action, "bookId": BOOK_ID, "pages": sorted(ALLOWED_PAGES)}))


if __name__ == "__main__":
    main()
