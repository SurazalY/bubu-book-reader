#!/usr/bin/env python3
"""Calibrate Luna line text to foreground-supported per-character geometry.

This module never recognizes text.  Luna's existing block strings are immutable
sequence constraints; only their locations are inferred from pixels in the
coarse block ROI.  A block is failed when the foreground cannot honestly
support one ordered group per source character.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import statistics
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Iterable

import fitz


SCHEMA_VERSION = "char-geometry/v1"
CALIBRATION_METHOD = "foreground-projection-sequence-alignment-v1"
CHAR_METHOD = "foreground-aligned"
PDF_MINIMUM_CHAR_BBOX_IOU = 0.95
BOUNDARY_CORRECTION_KIND = "adjacent-line-boundary-shift"
GEOMETRY_TEXT_POLICY = "raw-text-preserved-effective-text-only-for-proven-adjacent-boundary-shifts"
FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode MS.ttf",
    "C:/Windows/Fonts/msyh.ttc",
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_box(value: object) -> dict[str, int]:
    if isinstance(value, dict):
        keys = ("x", "y", "width", "height")
        if not all(key in value for key in keys):
            raise ValueError(f"bbox object missing one of {keys}: {value}")
        return {key: int(round(float(value[key]))) for key in keys}
    if isinstance(value, list) and len(value) == 4:
        x0, y0, x1, y1 = (float(item) for item in value)
        return {
            "x": round(x0),
            "y": round(y0),
            "width": round(x1 - x0),
            "height": round(y1 - y0),
        }
    raise ValueError(f"unsupported bbox: {value}")


def _box_edges(box: dict[str, int]) -> tuple[int, int, int, int]:
    return box["x"], box["y"], box["x"] + box["width"], box["y"] + box["height"]


def _box_intersects(left: dict[str, int], right: dict[str, int], margin: int = 0) -> bool:
    lx0, ly0, lx1, ly1 = _box_edges(left)
    rx0, ry0, rx1, ry1 = _box_edges(right)
    return lx1 > rx0 - margin and rx1 > lx0 - margin and ly1 > ry0 - margin and ry1 > ly0 - margin


class GrayImage:
    """Small immutable adapter around an 8-bit grayscale raster."""

    def __init__(self, width: int, height: int, samples: bytes, stride: int | None = None):
        self.width = int(width)
        self.height = int(height)
        self.stride = int(stride if stride is not None else width)
        self.samples = samples
        if self.width <= 0 or self.height <= 0:
            raise ValueError("image dimensions must be positive")
        if len(samples) < self.stride * self.height:
            raise ValueError("grayscale sample buffer is shorter than image dimensions")

    @classmethod
    def from_path(cls, path: Path) -> "GrayImage":
        source = fitz.Pixmap(str(path))
        gray = source if source.n == 1 else fitz.Pixmap(fitz.csGRAY, source)
        return cls(gray.width, gray.height, gray.samples, gray.stride)

    def pixel(self, x: int, y: int) -> int:
        return self.samples[y * self.stride + x]


def _otsu_threshold(image: GrayImage, roi: tuple[int, int, int, int]) -> int:
    x0, y0, x1, y1 = roi
    histogram = [0] * 256
    for y in range(y0, y1):
        start = y * image.stride + x0
        for value in image.samples[start : start + (x1 - x0)]:
            histogram[value] += 1
    total = sum(histogram)
    weighted_total = sum(index * count for index, count in enumerate(histogram))
    background_weight = 0
    background_sum = 0
    maximum_variance = -1.0
    selected = 180
    for threshold, count in enumerate(histogram):
        background_weight += count
        if background_weight == 0:
            continue
        foreground_weight = total - background_weight
        if foreground_weight == 0:
            break
        background_sum += threshold * count
        background_mean = background_sum / background_weight
        foreground_mean = (weighted_total - background_sum) / foreground_weight
        variance = background_weight * foreground_weight * (background_mean - foreground_mean) ** 2
        if variance > maximum_variance:
            maximum_variance = variance
            selected = threshold
    # The lower clamp keeps anti-aliased black and cyan print, while the upper
    # clamp rejects the near-white paper.  Otsu remains the local-image input.
    return max(180, min(230, selected + 20))


def _runs(values: Iterable[bool]) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    start: int | None = None
    for index, active in enumerate(values):
        if active and start is None:
            start = index
        elif not active and start is not None:
            result.append((start, index - 1))
            start = None
    if start is not None:
        result.append((start, index))
    return result


def _projection_band(
    image: GrayImage,
    roi: tuple[int, int, int, int],
    threshold: int,
) -> tuple[tuple[int, int], tuple[int, int] | None, dict[str, object]] | None:
    x0, y0, x1, y1 = roi
    row_counts = [
        sum(image.pixel(x, y) <= threshold for x in range(x0, x1))
        for y in range(y0, y1)
    ]
    row_minimum = max(2, round((x1 - x0) * 0.0015))
    candidates = []
    for start, end in _runs(count >= row_minimum for count in row_counts):
        ink = sum(row_counts[start : end + 1])
        if end - start + 1 >= 3 and ink >= 10:
            candidates.append((start, end, ink))
    if not candidates:
        return None

    roi_height = y1 - y0
    main = max(
        candidates,
        key=lambda run: run[2]
        * math.sqrt(run[1] - run[0] + 1)
        * (0.7 + ((run[0] + run[1]) / 2) / max(1, roi_height)),
    )
    main_start = max(0, main[0] - 1)
    main_end = min(roi_height - 1, main[1] + 1)

    upper = [run for run in candidates if run[1] < main_start]
    pinyin_band: tuple[int, int] | None = None
    if upper:
        pinyin_band = (y0 + min(run[0] for run in upper), y0 + max(run[1] for run in upper) + 1)

    metrics = {
        "rowProjectionRuns": [
            {"y": y0 + start, "height": end - start + 1, "foregroundPixels": ink}
            for start, end, ink in candidates
        ],
        "pinyinExcludedForegroundPixels": sum(run[2] for run in upper),
    }
    return (y0 + main_start, y0 + main_end + 1), pinyin_band, metrics


def _group_metrics(
    image: GrayImage,
    x0: int,
    x1: int,
    y0: int,
    y1: int,
    threshold: int,
) -> dict[str, int]:
    ink = 0
    min_y = y1
    max_y = y0 - 1
    for y in range(y0, y1):
        for x in range(x0, x1):
            if image.pixel(x, y) <= threshold:
                ink += 1
                min_y = min(min_y, y)
                max_y = max(max_y, y)
    return {"x0": x0, "x1": x1, "y0": min_y, "y1": max_y + 1, "ink": ink}


def _merge_groups(left: dict[str, int], right: dict[str, int]) -> dict[str, int]:
    return {
        "x0": left["x0"],
        "x1": right["x1"],
        "y0": min(left["y0"], right["y0"]),
        "y1": max(left["y1"], right["y1"]),
        "ink": left["ink"] + right["ink"],
    }


def _initial_groups(
    image: GrayImage,
    roi_x: tuple[int, int],
    band: tuple[int, int],
    threshold: int,
) -> tuple[list[dict[str, int]], list[int]]:
    x0, x1 = roi_x
    y0, y1 = band
    columns = [
        sum(image.pixel(x, y) <= threshold for y in range(y0, y1))
        for x in range(x0, x1)
    ]
    atomic = _runs(value > 0 for value in columns)
    groups: list[dict[str, int]] = []
    # Keep this below the observed Hanzi-to-punctuation gap.  A wider merge can
    # hide a Luna line-wrap mismatch by combining two printed character slots
    # until their count happens to equal the source string length.
    internal_gap = max(2, int((y1 - y0) * 0.30))
    for start, end in atomic:
        group = _group_metrics(image, x0 + start, x0 + end + 1, y0, y1, threshold)
        if group["ink"] < 2:
            continue
        if groups and group["x0"] - groups[-1]["x1"] <= internal_gap:
            groups[-1] = _merge_groups(groups[-1], group)
        else:
            groups.append(group)
    return groups, columns


def _split_group(
    image: GrayImage,
    group: dict[str, int],
    band: tuple[int, int],
    threshold: int,
    typical_width: float,
) -> tuple[dict[str, int], dict[str, int]] | None:
    width = group["x1"] - group["x0"]
    band_height = band[1] - band[0]
    if width < max(typical_width * 1.65, band_height * 1.45):
        return None
    columns = [
        sum(image.pixel(x, y) <= threshold for y in range(band[0], band[1]))
        for x in range(group["x0"], group["x1"])
    ]
    minimum_side = max(3, round(band_height * 0.22))
    candidates = []
    total = sum(columns)
    for offset in range(minimum_side, width - minimum_side):
        left_ink = sum(columns[:offset])
        right_ink = total - left_ink
        if left_ink < total * 0.15 or right_ink < total * 0.15:
            continue
        left_peak = max(columns[:offset], default=0)
        right_peak = max(columns[offset:], default=0)
        valley = columns[offset]
        if valley > max(1, min(left_peak, right_peak) * 0.45):
            continue
        balance = abs(left_ink - right_ink) / max(1, total)
        center_distance = abs(offset - width / 2) / max(1, width)
        candidates.append((valley, balance + center_distance * 0.35, offset))
    if not candidates:
        return None
    _, _, offset = min(candidates)
    boundary = group["x0"] + offset
    left = _group_metrics(image, group["x0"], boundary, band[0], band[1], threshold)
    right = _group_metrics(image, boundary, group["x1"], band[0], band[1], threshold)
    if left["ink"] < 2 or right["ink"] < 2:
        return None
    return left, right


def _adjust_group_count(
    image: GrayImage,
    groups: list[dict[str, int]],
    expected: int,
    band: tuple[int, int],
    threshold: int,
) -> tuple[list[dict[str, int]], list[dict[str, object]]]:
    adjusted = list(groups)
    changes: list[dict[str, object]] = []
    band_height = band[1] - band[0]

    while len(adjusted) > expected and len(adjusted) >= 2:
        widths = [group["x1"] - group["x0"] for group in adjusted]
        typical_width = statistics.median(widths)
        options = []
        for index in range(len(adjusted) - 1):
            left, right = adjusted[index], adjusted[index + 1]
            gap = right["x0"] - left["x1"]
            combined_width = right["x1"] - left["x0"]
            maximum_width = max(typical_width * 1.25, band_height * 1.1)
            if gap <= round(band_height * 0.45) and combined_width <= maximum_width:
                options.append((gap, abs(combined_width - typical_width), index))
        if not options:
            break
        _, _, index = min(options)
        left, right = adjusted[index], adjusted[index + 1]
        changes.append({"action": "merge-split-components", "x": [left["x0"], right["x1"]]})
        adjusted[index : index + 2] = [_merge_groups(left, right)]

    while len(adjusted) < expected and adjusted:
        widths = [group["x1"] - group["x0"] for group in adjusted]
        typical_width = min(statistics.median(widths), band_height * 0.95)
        options = sorted(
            enumerate(adjusted),
            key=lambda item: (item[1]["x1"] - item[1]["x0"], -item[0]),
            reverse=True,
        )
        split = None
        for index, group in options:
            result = _split_group(image, group, band, threshold, typical_width)
            if result:
                split = (index, result)
                break
        if split is None:
            break
        index, (left, right) = split
        changes.append({"action": "split-merged-component", "x": [left["x0"], right["x1"]]})
        adjusted[index : index + 1] = [left, right]

    return adjusted, changes


def _compact_group_flags(groups: list[dict[str, int]], band_height: int) -> list[bool]:
    """Identify small punctuation-like groups without treating full-width 一 as punctuation."""

    if not groups:
        return []
    widths = [group["x1"] - group["x0"] for group in groups]
    heights = [group["y1"] - group["y0"] for group in groups]
    inks = [group["ink"] for group in groups]
    typical_width = statistics.median(widths)
    typical_height = min(float(band_height), statistics.median(heights))
    typical_ink = statistics.median(inks)
    return [
        group["x1"] - group["x0"] <= typical_width * 0.48
        and group["y1"] - group["y0"] <= max(4.0, typical_height * 0.68)
        and group["ink"] <= max(8.0, typical_ink * 0.4)
        for group in groups
    ]


def _shape_mismatch_cost(text: str, groups: list[dict[str, int]], band_height: int) -> int:
    if len(text) != len(groups):
        raise ValueError("shape cost requires one group per character")
    compact = _compact_group_flags(groups, band_height)
    return sum(
        unicodedata.category(character).startswith("P") != is_compact
        for character, is_compact in zip(text, compact)
    )


def _one_count_sequence_diagnostics(
    text: str,
    groups: list[dict[str, int]],
    band_height: int,
) -> dict[str, object] | None:
    """Report where a one-group mismatch could occur; never invent a bbox."""

    if len(groups) + 1 == len(text):
        scored = [
            (_shape_mismatch_cost(text[:index] + text[index + 1 :], groups, band_height), index)
            for index in range(len(text))
        ]
        minimum = min(cost for cost, _ in scored)
        candidates = [index for cost, index in scored if cost == minimum]
        return {
            "kind": "one-missing-foreground-group",
            "minimumShapeMismatchCost": minimum,
            "candidateRawCharacterIndices": candidates,
            "unique": len(candidates) == 1,
        }
    if len(groups) == len(text) + 1:
        leading_cost = _shape_mismatch_cost(text, groups[1:], band_height)
        trailing_cost = _shape_mismatch_cost(text, groups[:-1], band_height)
        return {
            "kind": "one-surplus-foreground-group",
            "leadingSurplusShapeMismatchCost": leading_cost,
            "trailingSurplusShapeMismatchCost": trailing_cost,
            "uniqueBoundaryEdge": (
                "leading"
                if leading_cost + 2 <= trailing_cost
                else "trailing"
                if trailing_cost + 2 <= leading_cost
                else None
            ),
        }
    return None


def _component_count(
    image: GrayImage,
    roi_x: tuple[int, int],
    band: tuple[int, int],
    threshold: int,
) -> int:
    x0, x1 = roi_x
    y0, y1 = band
    width = x1 - x0
    height = y1 - y0
    mask = bytearray(width * height)
    for local_y, y in enumerate(range(y0, y1)):
        for local_x, x in enumerate(range(x0, x1)):
            if image.pixel(x, y) <= threshold:
                mask[local_y * width + local_x] = 1
    count = 0
    for origin in range(len(mask)):
        if not mask[origin]:
            continue
        count += 1
        mask[origin] = 0
        stack = [origin]
        while stack:
            current = stack.pop()
            cy, cx = divmod(current, width)
            for dy in (-1, 0, 1):
                ny = cy + dy
                if ny < 0 or ny >= height:
                    continue
                for dx in (-1, 0, 1):
                    nx = cx + dx
                    if nx < 0 or nx >= width or (dx == 0 and dy == 0):
                        continue
                    neighbor = ny * width + nx
                    if mask[neighbor]:
                        mask[neighbor] = 0
                        stack.append(neighbor)
    return count


def _failed(reason: str, metrics: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "chars": [],
        "geometryStatus": "failed",
        "geometryConfidence": 0.0,
        "geometryMethod": CALIBRATION_METHOD,
        "geometryFailureReason": reason,
        "geometryMetrics": metrics or {},
    }


def _probability(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number")
    normalized = float(value)
    if not math.isfinite(normalized) or normalized < 0.0 or normalized > 1.0:
        raise ValueError(f"{field} must be finite and between 0 and 1")
    return normalized


def calibrate_block(
    image: GrayImage,
    text: str,
    bbox: object,
    *,
    page_width: int | None = None,
    page_height: int | None = None,
) -> dict[str, object]:
    """Return geometry fields for one immutable source string and coarse bbox."""

    width = image.width if page_width is None else page_width
    height = image.height if page_height is None else page_height
    try:
        box = normalize_box(bbox)
    except (TypeError, ValueError) as exc:
        return _failed(f"invalid-coarse-bbox: {exc}")
    x0, y0, x1, y1 = _box_edges(box)
    if x0 < 0 or y0 < 0 or x1 > width or y1 > height or x1 <= x0 or y1 <= y0:
        return _failed("invalid-coarse-bbox: outside-page-or-empty")
    if not text:
        return _failed("empty-text")
    if any(character.isspace() for character in text):
        return _failed("unsupported-whitespace-character")
    if box["height"] > box["width"] * 1.2:
        return _failed("unsupported-writing-direction: expected-horizontal-line")

    margin = max(2, min(5, round(box["height"] * 0.05)))
    roi = (
        max(0, x0 - margin),
        max(0, y0 - margin),
        min(width, x1 + margin),
        min(height, y1 + margin),
    )
    threshold = _otsu_threshold(image, roi)
    band_result = _projection_band(image, roi, threshold)
    if band_result is None:
        return _failed("insufficient-foreground-evidence: no-row-band", {"threshold": threshold})
    band, pinyin_band, band_metrics = band_result
    if band[1] - band[0] < 4:
        return _failed("insufficient-foreground-evidence: hanzi-band-too-short", {"threshold": threshold})

    groups, columns = _initial_groups(image, (roi[0], roi[2]), band, threshold)
    main_ink = sum(columns)
    metrics: dict[str, object] = {
        "threshold": threshold,
        "coarseRoi": {"x": roi[0], "y": roi[1], "width": roi[2] - roi[0], "height": roi[3] - roi[1]},
        "hanziBandBbox": {"x": roi[0], "y": band[0], "width": roi[2] - roi[0], "height": band[1] - band[0]},
        "pinyinBandBbox": (
            {"x": roi[0], "y": pinyin_band[0], "width": roi[2] - roi[0], "height": pinyin_band[1] - pinyin_band[0]}
            if pinyin_band
            else None
        ),
        "foregroundPixelCount": main_ink,
        "initialGroupCount": len(groups),
        **band_metrics,
    }
    if main_ink < max(12, len(text) * 3) or not groups:
        return _failed("insufficient-foreground-evidence: too-few-hanzi-pixels", metrics)

    adjusted, changes = _adjust_group_count(image, groups, len(text), band, threshold)
    metrics["topologyAdjustments"] = changes
    metrics["alignedGroupCount"] = len(adjusted)
    metrics["connectedComponentCount"] = _component_count(image, (roi[0], roi[2]), band, threshold)
    if len(adjusted) != len(text):
        metrics["expectedCharacterCount"] = len(text)
        metrics["unmatchedForegroundGroups"] = [dict(group) for group in adjusted]
        diagnostics = _one_count_sequence_diagnostics(text, adjusted, band[1] - band[0])
        if diagnostics is not None:
            metrics["sequenceAlignmentDiagnostics"] = diagnostics
        return _failed(
            f"sequence-evidence-mismatch: expected-{len(text)}-groups-found-{len(adjusted)}",
            metrics,
        )

    centers = [(group["x0"] + group["x1"] - 1) / 2 for group in adjusted]
    gaps = [right - left for left, right in zip(centers, centers[1:])]
    median_pitch = statistics.median(gaps) if gaps else float(adjusted[0]["x1"] - adjusted[0]["x0"])
    spacing_deviation = (
        statistics.median(abs(gap - median_pitch) for gap in gaps) / max(1.0, median_pitch)
        if gaps
        else 0.0
    )
    if gaps and (min(gaps) < median_pitch * 0.25 or max(gaps) > median_pitch * 2.2):
        metrics.update({"medianPitch": round(median_pitch, 3), "spacingDeviation": round(spacing_deviation, 4)})
        return _failed("sequence-alignment-cost-too-high: implausible-character-spacing", metrics)

    foreground_coverage = sum(group["ink"] for group in adjusted) / max(1, main_ink)
    separation_score = 1.0 if pinyin_band else 0.78
    spacing_score = max(0.0, 1.0 - spacing_deviation / 0.35)
    block_confidence = 0.55 + foreground_coverage * 0.2 + spacing_score * 0.15 + separation_score * 0.1
    block_confidence -= min(0.16, len(changes) * 0.06)
    block_confidence = round(max(0.0, min(0.99, block_confidence)), 3)

    median_ink = statistics.median(group["ink"] for group in adjusted)
    chars = []
    for index, (character, group) in enumerate(zip(text, adjusted)):
        char_box = {
            "x": group["x0"],
            "y": group["y0"],
            "width": group["x1"] - group["x0"],
            "height": group["y1"] - group["y0"],
        }
        punctuation_factor = 0.12 if unicodedata.category(character).startswith("P") else 0.35
        evidence_ratio = min(1.0, group["ink"] / max(2.0, median_ink * punctuation_factor))
        confidence = round(max(0.0, min(0.99, block_confidence * (0.78 + evidence_ratio * 0.22))), 3)
        chars.append(
            {
                "text": character,
                "charIndex": index,
                "bbox": char_box,
                "confidence": confidence,
                "method": CHAR_METHOD,
                "status": "ok",
                "foregroundPixels": group["ink"],
            }
        )

    metrics.update(
        {
            "medianPitch": round(median_pitch, 3),
            "spacingDeviation": round(spacing_deviation, 4),
            "foregroundCoverage": round(foreground_coverage, 4),
            "characterHorizontalSpan": chars[-1]["bbox"]["x"] + chars[-1]["bbox"]["width"] - chars[0]["bbox"]["x"],
        }
    )
    return {
        "chars": chars,
        "geometryStatus": "ok",
        "geometryConfidence": block_confidence,
        "geometryMethod": CALIBRATION_METHOD,
        "geometryFailureReason": None,
        "geometryMetrics": metrics,
    }


def _compatible_adjacent_lines(left: dict, right: dict) -> bool:
    try:
        left_box = normalize_box(left["bbox"])
        right_box = normalize_box(right["bbox"])
    except (KeyError, TypeError, ValueError):
        return False
    if left_box["height"] > left_box["width"] * 1.2 or right_box["height"] > right_box["width"] * 1.2:
        return False
    vertical_gap = right_box["y"] - (left_box["y"] + left_box["height"])
    tolerance = max(left_box["height"], right_box["height"])
    return (
        0 <= vertical_gap <= tolerance * 0.6
        and abs(left_box["x"] - right_box["x"]) <= tolerance * 0.25
        and abs(left_box["width"] - right_box["width"]) <= tolerance * 0.25
    )


def _apply_adjacent_boundary_corrections(
    image: GrayImage,
    blocks: list[dict],
    page_width: int,
    page_height: int,
) -> None:
    """Correct a provable OCR line-boundary shift while leaving raw text immutable."""

    for index in range(len(blocks) - 1):
        source = blocks[index]
        target = blocks[index + 1]
        if source.get("geometryStatus") != "failed" or target.get("geometryStatus") != "failed":
            continue
        if not _compatible_adjacent_lines(source, target):
            continue
        source_text = source.get("text")
        target_text = target.get("text")
        if not isinstance(source_text, str) or not isinstance(target_text, str) or not source_text or not target_text:
            continue
        source_metrics = source.get("geometryMetrics", {})
        target_metrics = target.get("geometryMetrics", {})
        source_groups = source_metrics.get("unmatchedForegroundGroups")
        target_groups = target_metrics.get("unmatchedForegroundGroups")
        if not isinstance(source_groups, list) or not isinstance(target_groups, list):
            continue
        if len(source_groups) != len(source_text) - 1 or len(target_groups) != len(target_text) + 1:
            continue
        source_diagnostics = source_metrics.get("sequenceAlignmentDiagnostics", {})
        target_diagnostics = target_metrics.get("sequenceAlignmentDiagnostics", {})
        if (
            not isinstance(source_diagnostics, dict)
            or len(source_text) - 1 not in source_diagnostics.get("candidateRawCharacterIndices", [])
            or not isinstance(target_diagnostics, dict)
            or target_diagnostics.get("uniqueBoundaryEdge") != "leading"
        ):
            continue

        transferred = source_text[-1]
        source_effective = source_text[:-1]
        target_effective = transferred + target_text
        if source_effective + target_effective != source_text + target_text:
            continue
        source_geometry = calibrate_block(
            image,
            source_effective,
            source["bbox"],
            page_width=page_width,
            page_height=page_height,
        )
        target_geometry = calibrate_block(
            image,
            target_effective,
            target["bbox"],
            page_width=page_width,
            page_height=page_height,
        )
        if source_geometry["geometryStatus"] != "ok" or target_geometry["geometryStatus"] != "ok":
            continue

        correction_id = f"{source['id']}--{target['id']}"
        evidence = {
            "sourceExpectedCharacterCount": len(source_text),
            "sourceObservedGroupCount": len(source_groups),
            "sourceBoundaryCandidateIndex": len(source_text) - 1,
            "targetExpectedCharacterCount": len(target_text),
            "targetObservedGroupCount": len(target_groups),
            "targetUniqueSurplusEdge": "leading",
        }
        for block, geometry, effective_text, role, peer_id in (
            (source, source_geometry, source_effective, "source", target["id"]),
            (target, target_geometry, target_effective, "target", source["id"]),
        ):
            geometry["geometryConfidence"] = round(max(0.0, geometry["geometryConfidence"] - 0.08), 3)
            for character in geometry["chars"]:
                character["confidence"] = min(character["confidence"], geometry["geometryConfidence"])
            geometry["geometryMetrics"]["adjacentBoundaryCorrectionId"] = correction_id
            block.update(geometry)
            block["geometryEffectiveText"] = effective_text
            block["geometryCorrection"] = {
                "id": correction_id,
                "kind": BOUNDARY_CORRECTION_KIND,
                "role": role,
                "peerBlockId": peer_id,
                "transferredText": transferred,
                "evidence": evidence,
            }


def calibrate_page(image: GrayImage, source_page: dict, image_name: str) -> dict:
    page = copy.deepcopy(source_page)
    page_no = int(page["pageNo"])
    width = int(page.get("width", image.width))
    height = int(page.get("height", image.height))
    if (width, height) != (image.width, image.height):
        raise ValueError(f"page {page_no}: response dimensions do not match image")
    page["width"] = width
    page["height"] = height
    page["image"] = image_name
    blocks = page.get("blocks", [])
    if not isinstance(blocks, list):
        raise ValueError(f"page {page_no}: blocks must be an array")
    for index, block in enumerate(blocks, start=1):
        if not isinstance(block, dict):
            raise ValueError(f"page {page_no} block {index}: expected object")
        block.setdefault("id", f"p{page_no:04d}-b{index:03d}")
    for block in blocks:
        text = block.get("text", block.get("hanzi", ""))
        if not isinstance(text, str):
            geometry = _failed("invalid-source-text: expected-string")
        else:
            geometry = calibrate_block(image, text, block.get("bbox"), page_width=width, page_height=height)
        block.update(geometry)
    _apply_adjacent_boundary_corrections(image, blocks, width, height)
    page["geometryQuality"] = _page_quality_from_blocks(page)
    errors = validate_calibrated_page(page)
    if errors:
        raise ValueError(f"page {page_no} calibration contract failed: {'; '.join(errors)}")
    return page


def validate_char_geometry_fields(
    raw: dict,
    block_text: str,
    page_width: int,
    page_height: int,
    block_box: dict[str, int],
) -> dict[str, object]:
    """Normalize optional calibrated fields for package-builder compatibility."""

    if "geometryStatus" not in raw and "chars" not in raw:
        return {}
    required_geometry_fields = {
        "chars",
        "geometryStatus",
        "geometryConfidence",
        "geometryMethod",
        "geometryFailureReason",
        "geometryMetrics",
    }
    missing_geometry_fields = sorted(required_geometry_fields.difference(raw))
    if missing_geometry_fields:
        raise ValueError(f"calibrated block missing fields: {', '.join(missing_geometry_fields)}")
    status = raw["geometryStatus"]
    if status not in {"ok", "failed"}:
        raise ValueError(f"unsupported geometryStatus {status}")
    geometry_confidence = _probability(raw["geometryConfidence"], "geometryConfidence")
    if raw["geometryMethod"] != CALIBRATION_METHOD:
        raise ValueError(f"unsupported geometryMethod {raw['geometryMethod']}")
    geometry_metrics = raw["geometryMetrics"]
    if not isinstance(geometry_metrics, dict):
        raise ValueError("geometryMetrics must be an object")
    failure_reason = raw["geometryFailureReason"]
    chars = raw["chars"]
    if not isinstance(chars, list):
        raise ValueError("chars must be an array")
    effective_text = raw.get("geometryEffectiveText", block_text)
    correction = raw.get("geometryCorrection")
    if ("geometryEffectiveText" in raw) != (correction is not None):
        raise ValueError("geometryEffectiveText and geometryCorrection must appear together")
    if (
        not isinstance(effective_text, str)
        or not effective_text
        or any(character.isspace() for character in effective_text)
    ):
        raise ValueError("geometryEffectiveText must be a non-empty string without whitespace")
    if correction is not None:
        if status != "ok" or effective_text == block_text:
            raise ValueError("geometry correction requires successful geometry and changed effective text")
        if not isinstance(correction, dict):
            raise ValueError("geometryCorrection must be an object")
        required_correction_fields = {"id", "kind", "role", "peerBlockId", "transferredText", "evidence"}
        if set(correction) != required_correction_fields:
            raise ValueError("geometryCorrection fields do not match the adjacent-boundary contract")
        if not isinstance(correction["id"], str) or not correction["id"]:
            raise ValueError("geometryCorrection id must be a non-empty string")
        if correction["kind"] != BOUNDARY_CORRECTION_KIND:
            raise ValueError("unsupported geometryCorrection kind")
        if correction["role"] not in {"source", "target"}:
            raise ValueError("geometryCorrection role must be source or target")
        if not isinstance(correction["peerBlockId"], str) or not correction["peerBlockId"]:
            raise ValueError("geometryCorrection peerBlockId must be a non-empty string")
        if not isinstance(correction["transferredText"], str) or len(correction["transferredText"]) != 1:
            raise ValueError("geometryCorrection transferredText must be one character")
        if not isinstance(correction["evidence"], dict):
            raise ValueError("geometryCorrection evidence must be an object")
    normalized = []
    previous_x = -1
    for index, item in enumerate(chars):
        if not isinstance(item, dict):
            raise ValueError(f"char {index}: expected object")
        required_character_fields = {
            "text",
            "charIndex",
            "bbox",
            "confidence",
            "method",
            "status",
            "foregroundPixels",
        }
        missing_character_fields = sorted(required_character_fields.difference(item))
        if missing_character_fields:
            raise ValueError(f"char {index}: missing fields: {', '.join(missing_character_fields)}")
        character = item["text"]
        if not isinstance(character, str) or len(character) != 1:
            raise ValueError(f"char {index}: text must be one Python character")
        char_index = item["charIndex"]
        if isinstance(char_index, bool) or not isinstance(char_index, int):
            raise ValueError(f"char {index}: charIndex must be an integer")
        confidence = _probability(item["confidence"], f"char {index}: confidence")
        if item["method"] != CHAR_METHOD or item["status"] != "ok":
            raise ValueError(f"char {index}: successful chars require ok foreground-aligned evidence")
        foreground_pixels = item["foregroundPixels"]
        if isinstance(foreground_pixels, bool) or not isinstance(foreground_pixels, int) or foreground_pixels < 2:
            raise ValueError(f"char {index}: foregroundPixels must be an integer of at least 2")
        char_box = normalize_box(item["bbox"])
        cx0, cy0, cx1, cy1 = _box_edges(char_box)
        if cx0 < 0 or cy0 < 0 or cx1 > page_width or cy1 > page_height or cx1 <= cx0 or cy1 <= cy0:
            raise ValueError(f"char {index}: bbox outside page or empty")
        if not _box_intersects(char_box, block_box, margin=6):
            raise ValueError(f"char {index}: bbox does not intersect coarse block")
        if char_box["x"] < previous_x:
            raise ValueError("char bboxes are not monotonic")
        previous_x = char_box["x"]
        normalized.append(
            {
                **item,
                "text": character,
                "charIndex": char_index,
                "bbox": char_box,
                "confidence": confidence,
                "method": item["method"],
                "status": item["status"],
                "foregroundPixels": foreground_pixels,
            }
        )
    if status == "ok":
        if not block_text or not normalized:
            raise ValueError("successful geometry requires non-empty source text and chars")
        if len(normalized) != len(effective_text) or "".join(item["text"] for item in normalized) != effective_text:
            raise ValueError("successful chars do not exactly reproduce effective geometry text")
        if any(item["charIndex"] != index for index, item in enumerate(normalized)):
            raise ValueError("charIndex values are not contiguous")
        if failure_reason is not None:
            raise ValueError("successful geometryFailureReason must be null")
    elif normalized:
        raise ValueError("failed geometry must not contain chars")
    elif not isinstance(failure_reason, str) or not failure_reason:
        raise ValueError("failed geometry requires a non-empty failure reason")
    elif geometry_confidence != 0.0:
        raise ValueError("failed geometryConfidence must be 0")
    result = {
        "chars": normalized,
        "geometryStatus": status,
        "geometryConfidence": geometry_confidence,
        "geometryMethod": raw["geometryMethod"],
        "geometryFailureReason": failure_reason,
        "geometryMetrics": geometry_metrics,
    }
    if correction is not None:
        result["geometryEffectiveText"] = effective_text
        result["geometryCorrection"] = copy.deepcopy(correction)
    return result


def validate_page_geometry_corrections(blocks: list[dict]) -> list[str]:
    errors: list[str] = []
    corrected = [block for block in blocks if isinstance(block, dict) and "geometryCorrection" in block]
    if not corrected:
        return errors
    raw_stream = "".join(block.get("text", "") for block in blocks if isinstance(block, dict))
    effective_stream = "".join(
        block.get("geometryEffectiveText", block.get("text", ""))
        for block in blocks
        if isinstance(block, dict)
    )
    if raw_stream != effective_stream:
        errors.append("corrected effective page character stream differs from raw OCR stream")

    positions = {block.get("id"): index for index, block in enumerate(blocks) if isinstance(block, dict)}
    corrections: dict[str, list[dict]] = {}
    for block in corrected:
        record = block.get("geometryCorrection", {})
        correction_id = record.get("id") if isinstance(record, dict) else None
        corrections.setdefault(str(correction_id), []).append(block)
    for correction_id, pair in corrections.items():
        if len(pair) != 2:
            errors.append(f"geometry correction {correction_id} must occur on exactly two blocks")
            continue
        by_role = {block["geometryCorrection"].get("role"): block for block in pair}
        if set(by_role) != {"source", "target"}:
            errors.append(f"geometry correction {correction_id} requires source and target roles")
            continue
        source = by_role["source"]
        target = by_role["target"]
        source_record = source["geometryCorrection"]
        target_record = target["geometryCorrection"]
        source_id = source.get("id")
        target_id = target.get("id")
        if positions.get(target_id) != positions.get(source_id, -2) + 1:
            errors.append(f"geometry correction {correction_id} blocks are not adjacent and ordered")
        if source_record.get("peerBlockId") != target_id or target_record.get("peerBlockId") != source_id:
            errors.append(f"geometry correction {correction_id} peerBlockId values are not reciprocal")
        if source_record.get("transferredText") != target_record.get("transferredText"):
            errors.append(f"geometry correction {correction_id} transferred text differs across pair")
            continue
        transferred = source_record.get("transferredText", "")
        source_raw = source.get("text", "")
        target_raw = target.get("text", "")
        source_effective = source.get("geometryEffectiveText")
        target_effective = target.get("geometryEffectiveText")
        if not source_raw.endswith(transferred) or source_effective != source_raw[: -len(transferred)]:
            errors.append(f"geometry correction {correction_id} source effective text is not a trailing transfer")
        if target_effective != transferred + target_raw:
            errors.append(f"geometry correction {correction_id} target effective text is not a leading transfer")
        if source_record.get("evidence") != target_record.get("evidence"):
            errors.append(f"geometry correction {correction_id} evidence differs across pair")
            continue
        evidence = source_record.get("evidence", {})
        expected_evidence = {
            "sourceExpectedCharacterCount": len(source_raw),
            "sourceObservedGroupCount": len(source.get("chars", [])),
            "sourceBoundaryCandidateIndex": len(source_raw) - 1,
            "targetExpectedCharacterCount": len(target_raw),
            "targetObservedGroupCount": len(target.get("chars", [])),
            "targetUniqueSurplusEdge": "leading",
        }
        if evidence != expected_evidence:
            errors.append(f"geometry correction {correction_id} evidence does not match corrected blocks")
    return errors


def _page_quality_from_blocks(page: dict) -> dict[str, object]:
    raw_blocks = page.get("blocks", [])
    blocks = raw_blocks if isinstance(raw_blocks, list) else []
    successful = sum(
        isinstance(block, dict) and block.get("geometryStatus") == "ok"
        for block in blocks
    )
    positioned = sum(
        len(block.get("chars", []))
        for block in blocks
        if isinstance(block, dict) and block.get("geometryStatus") == "ok" and isinstance(block.get("chars"), list)
    )
    reasons = Counter(
        block.get("geometryFailureReason")
        for block in blocks
        if isinstance(block, dict)
        and block.get("geometryStatus") == "failed"
        and block.get("geometryFailureReason")
    )
    corrected_blocks = sum(
        isinstance(block, dict)
        and block.get("geometryStatus") == "ok"
        and isinstance(block.get("geometryCorrection"), dict)
        for block in blocks
    )
    correction_ids = {
        block["geometryCorrection"]["id"]
        for block in blocks
        if isinstance(block, dict)
        and block.get("geometryStatus") == "ok"
        and isinstance(block.get("geometryCorrection"), dict)
        and isinstance(block["geometryCorrection"].get("id"), str)
    }
    result = {
        "blockCount": len(blocks),
        "successfulBlocks": successful,
        "failedBlocks": len(blocks) - successful,
        "positionedCharacters": positioned,
        "failureReasons": dict(sorted(reasons.items())),
    }
    if corrected_blocks:
        result.update(
            {
                "directSuccessfulBlocks": successful - corrected_blocks,
                "correctedSuccessfulBlocks": corrected_blocks,
                "boundaryCorrectionCount": len(correction_ids),
            }
        )
    return result


def validate_calibrated_page(page: dict) -> list[str]:
    errors: list[str] = []
    width = page.get("width")
    height = page.get("height")
    if isinstance(width, bool) or not isinstance(width, int) or isinstance(height, bool) or not isinstance(height, int):
        errors.append("page dimensions must be integers")
        return errors
    if width <= 0 or height <= 0:
        errors.append("page dimensions must be positive")
    blocks = page.get("blocks")
    if not isinstance(blocks, list):
        errors.append("blocks must be an array")
        return errors
    for block_index, block in enumerate(blocks, start=1):
        if not isinstance(block, dict):
            errors.append(f"block {block_index}: expected object")
            continue
        block_id = block.get("id", block_index)
        text = block.get("text")
        if not isinstance(text, str):
            errors.append(f"block {block_id}: text must be a string")
            continue
        try:
            block_box = normalize_box(block.get("bbox"))
            bx0, by0, bx1, by1 = _box_edges(block_box)
            if bx0 < 0 or by0 < 0 or bx1 > width or by1 > height or bx1 <= bx0 or by1 <= by0:
                raise ValueError("coarse bbox outside page or empty")
            normalized = validate_char_geometry_fields(block, text, width, height, block_box)
        except (TypeError, ValueError) as exc:
            errors.append(f"block {block_id}: {exc}")
            continue
        if not normalized:
            errors.append(f"block {block_id}: missing character geometry")
    errors.extend(validate_page_geometry_corrections(blocks))
    expected_quality = _page_quality_from_blocks(page)
    actual_quality = page.get("geometryQuality")
    if not isinstance(actual_quality, dict):
        errors.append("geometryQuality must be an object")
    else:
        for key, expected in expected_quality.items():
            if actual_quality.get(key) != expected:
                errors.append(f"geometryQuality {key} does not match block data")
    return errors


def validate_calibrated_document(document: dict) -> list[str]:
    """Validate the executable invariants JSON Schema cannot express alone."""

    errors: list[str] = []
    if document.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("schemaVersion mismatch")
    if document.get("method") != CALIBRATION_METHOD:
        errors.append("calibration method mismatch")
    source = document.get("source")
    if not isinstance(source, dict):
        errors.append("source must be an object")
    else:
        for field in ("renderManifest", "lunaResponse"):
            if not isinstance(source.get(field), str) or not source[field]:
                errors.append(f"source {field} must be a non-empty string")
        for field in ("renderManifestSha256", "lunaResponseSha256"):
            checksum = source.get(field)
            if (
                not isinstance(checksum, str)
                or len(checksum) != 64
                or any(character not in "0123456789abcdef" for character in checksum)
            ):
                errors.append(f"source {field} must be a lowercase SHA-256")
        if source.get("textPolicy") != "preserved-from-luna-no-re-ocr-no-normalization":
            errors.append("source textPolicy mismatch")
        if source.get("geometryTextPolicy") not in {None, GEOMETRY_TEXT_POLICY}:
            errors.append("source geometryTextPolicy mismatch")
    render = document.get("render", {})
    if not isinstance(render, dict):
        errors.append("render must be an object")
        render = {}
    if isinstance(render.get("dpi"), bool) or not isinstance(render.get("dpi"), int) or render.get("dpi", 0) <= 0:
        errors.append("render dpi must be a positive integer")
    if render.get("coordinateSystem") != "pixel, origin=top-left":
        errors.append("coordinate system mismatch")
    pages = document.get("pages")
    if not isinstance(pages, list) or not pages:
        errors.append("pages must be a non-empty array")
        return errors
    seen_pages = set()
    valid_pages = []
    for index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            errors.append(f"page item {index} must be an object")
            continue
        valid_pages.append(page)
        page_no = page.get("pageNo")
        if isinstance(page_no, bool) or not isinstance(page_no, int) or page_no <= 0:
            errors.append(f"invalid page number {page_no}")
        else:
            if page_no in seen_pages:
                errors.append(f"duplicate page {page_no}")
            seen_pages.add(page_no)
        errors.extend(f"page {page_no}: {error}" for error in validate_calibrated_page(page))
    has_corrections = any(
        isinstance(block, dict) and isinstance(block.get("geometryCorrection"), dict)
        for page in valid_pages
        if isinstance(page.get("blocks"), list)
        for block in page["blocks"]
    )
    if has_corrections and (
        not isinstance(source, dict) or source.get("geometryTextPolicy") != GEOMETRY_TEXT_POLICY
    ):
        errors.append("source geometryTextPolicy is required for corrected effective text")
    calculated = summarize_quality(valid_pages)
    quality = document.get("quality", {})
    if not isinstance(quality, dict):
        errors.append("quality must be an object")
        quality = {}
    for key in (
        "pageCount",
        "blockCount",
        "successfulBlocks",
        "failedBlocks",
        "directSuccessfulBlocks",
        "correctedSuccessfulBlocks",
        "boundaryCorrectionCount",
        "successfulBlockRate",
        "positionedCharacters",
        "failureReasons",
        "failedBlockRecords",
        "pages",
    ):
        if quality.get(key) != calculated.get(key):
            errors.append(f"quality {key} does not match page data")
    if quality.get("successfulBlocks", 0) + quality.get("failedBlocks", 0) != quality.get("blockCount", -1):
        errors.append("failed blocks must be excluded from successfulBlocks")
    pdf_validation = quality.get("pdfValidation")
    if pdf_validation is not None:
        if not isinstance(pdf_validation, dict):
            errors.append("quality pdfValidation must be an object")
        else:
            pdf_pages = pdf_validation.get("pages")
            if pdf_validation.get("pageCount") != len(valid_pages) or not isinstance(pdf_pages, list) or len(pdf_pages) != len(valid_pages):
                errors.append("PDF validation page count mismatch")
            else:
                for page, report in zip(valid_pages, pdf_pages):
                    if not isinstance(report, dict):
                        errors.append(f"page {page.get('pageNo')}: PDF validation report must be an object")
                        continue
                    expected_count = _page_quality_from_blocks(page)["positionedCharacters"]
                    if report.get("pageNo") != page.get("pageNo"):
                        errors.append(f"page {page.get('pageNo')}: PDF validation page order mismatch")
                    if report.get("expectedCharacterCount") != expected_count:
                        errors.append(f"page {page.get('pageNo')}: PDF expected character count mismatch")
                    if report.get("extractedCharacterCount") != expected_count:
                        errors.append(f"page {page.get('pageNo')}: PDF extracted character count mismatch")
                    if report.get("textMatchesInsertionOrder") is not True:
                        errors.append(f"page {page.get('pageNo')}: PDF text order mismatch")
                    minimum_iou = report.get("minimumCharacterBboxIoU")
                    if expected_count and (
                        isinstance(minimum_iou, bool)
                        or not isinstance(minimum_iou, (int, float))
                        or not math.isfinite(float(minimum_iou))
                        or minimum_iou < PDF_MINIMUM_CHAR_BBOX_IOU
                    ):
                        errors.append(f"page {page.get('pageNo')}: PDF character bbox IoU below threshold")
    return errors


def summarize_quality(pages: list[dict]) -> dict[str, object]:
    page_quality = [_page_quality_from_blocks(page) for page in pages]
    block_count = sum(item["blockCount"] for item in page_quality)
    successful = sum(item["successfulBlocks"] for item in page_quality)
    direct_successful = sum(item.get("directSuccessfulBlocks", item["successfulBlocks"]) for item in page_quality)
    corrected_successful = sum(item.get("correctedSuccessfulBlocks", 0) for item in page_quality)
    boundary_corrections = sum(item.get("boundaryCorrectionCount", 0) for item in page_quality)
    positioned = sum(item["positionedCharacters"] for item in page_quality)
    reasons = Counter()
    failed_records = []
    for page, calculated_page_quality in zip(pages, page_quality):
        reasons.update(calculated_page_quality["failureReasons"])
        for block in page.get("blocks", []):
            if not isinstance(block, dict):
                continue
            if block.get("geometryStatus") != "failed":
                continue
            metrics = block.get("geometryMetrics", {})
            failed_records.append(
                {
                    "pageNo": page["pageNo"],
                    "blockId": block.get("id"),
                    "text": block.get("text", block.get("hanzi", "")),
                    "bbox": block.get("bbox"),
                    "reason": block.get("geometryFailureReason"),
                    "expectedCharacterCount": len(block.get("text", block.get("hanzi", ""))),
                    "observedGroupCount": metrics.get("alignedGroupCount"),
                }
            )
    result = {
        "pageCount": len(pages),
        "blockCount": block_count,
        "successfulBlocks": successful,
        "failedBlocks": block_count - successful,
        "successfulBlockRate": round(successful / block_count, 4) if block_count else 0.0,
        "positionedCharacters": positioned,
        "failureReasons": dict(sorted(reasons.items())),
        "failedBlockRecords": failed_records,
        "pages": [
            {"pageNo": page["pageNo"], **calculated_page_quality}
            for page, calculated_page_quality in zip(pages, page_quality)
        ],
    }
    if corrected_successful:
        result.update(
            {
                "directSuccessfulBlocks": direct_successful,
                "correctedSuccessfulBlocks": corrected_successful,
                "boundaryCorrectionCount": boundary_corrections,
            }
        )
    return result


def calibrated_document(
    render_manifest_path: Path,
    response_path: Path,
    requested_pages: list[int],
) -> tuple[dict, dict[int, Path]]:
    render_manifest = read_json(render_manifest_path)
    response = read_json(response_path)
    response_pages = {int(page["pageNo"]): page for page in response.get("pages", [])}
    render_pages = {int(page["pageNo"]): page for page in render_manifest.get("pages", [])}
    image_paths: dict[int, Path] = {}
    pages = []
    for page_no in requested_pages:
        if page_no not in render_pages:
            raise ValueError(f"page {page_no}: absent from render manifest")
        if page_no not in response_pages:
            raise ValueError(f"page {page_no}: absent from Luna response")
        render_info = render_pages[page_no]
        image_path = render_manifest_path.parent / render_info["image"]
        if not image_path.is_file():
            raise ValueError(f"page {page_no}: missing rendered image {image_path}")
        image = GrayImage.from_path(image_path)
        if (image.width, image.height) != (int(render_info["width"]), int(render_info["height"])):
            raise ValueError(f"page {page_no}: render-manifest dimensions do not match image")
        pages.append(calibrate_page(image, response_pages[page_no], render_info["image"]))
        image_paths[page_no] = image_path
    pages.sort(key=lambda item: item["pageNo"])
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "source": {
            "renderManifest": str(render_manifest_path),
            "renderManifestSha256": sha256(render_manifest_path),
            "lunaResponse": str(response_path),
            "lunaResponseSha256": sha256(response_path),
            "textPolicy": "preserved-from-luna-no-re-ocr-no-normalization",
            "geometryTextPolicy": GEOMETRY_TEXT_POLICY,
        },
        "render": {
            "dpi": int(render_manifest["dpi"]),
            "coordinateSystem": "pixel, origin=top-left",
        },
        "method": CALIBRATION_METHOD,
        "pages": pages,
        "quality": summarize_quality(pages),
    }
    errors = validate_calibrated_document(result)
    if errors:
        raise ValueError(f"calibrated document contract failed: {'; '.join(errors)}")
    return result, image_paths


def draw_overlay(image_path: Path, page: dict, output: Path) -> None:
    document = fitz.open()
    canvas = document.new_page(width=page["width"], height=page["height"])
    canvas.insert_image(canvas.rect, filename=str(image_path))
    for block_index, block in enumerate(page.get("blocks", []), start=1):
        block_box = normalize_box(block["bbox"])
        if block.get("geometryStatus") != "ok":
            rect = fitz.Rect(*_box_edges(block_box))
            canvas.draw_rect(rect, color=(0.9, 0.08, 0.08), width=3, overlay=True)
            canvas.insert_text(
                (rect.x0 + 3, max(10, rect.y0 - 3)),
                f"B{block_index} FAILED",
                fontsize=9,
                color=(0.9, 0.08, 0.08),
                overlay=True,
            )
            continue
        pinyin_box = block.get("geometryMetrics", {}).get("pinyinBandBbox")
        correction = block.get("geometryCorrection")
        if isinstance(correction, dict):
            correction_rect = fitz.Rect(*_box_edges(block_box))
            canvas.draw_rect(correction_rect, color=(0.95, 0.48, 0.05), width=2.2, overlay=True)
            canvas.insert_text(
                (correction_rect.x0 + 3, max(10, correction_rect.y0 - 3)),
                f"B{block_index} CORRECTED {str(correction.get('role', '')).upper()}",
                fontsize=9,
                color=(0.85, 0.33, 0.02),
                overlay=True,
            )
        if pinyin_box:
            pinyin_rect = fitz.Rect(*_box_edges(pinyin_box))
            canvas.draw_rect(pinyin_rect, color=(0.1, 0.55, 0.95), width=0.8, overlay=True)
        for char in block["chars"]:
            rect = fitz.Rect(*_box_edges(char["bbox"]))
            color = (0.05, 0.65, 0.2)
            canvas.draw_rect(
                rect,
                color=color,
                fill=(0.1, 0.85, 0.25),
                fill_opacity=0.09,
                width=1.5,
                overlay=True,
            )
            canvas.insert_text(
                (rect.x0, max(8, rect.y0 - 2)),
                f"{block_index}.{char['charIndex'] + 1}",
                fontsize=6.5,
                color=(0.75, 0.08, 0.08),
                overlay=True,
            )
    pixmap = canvas.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
    if (pixmap.width, pixmap.height) != (page["width"], page["height"]):
        document.close()
        raise ValueError(f"page {page['pageNo']}: overlay dimensions changed")
    pixmap.save(str(output))
    document.close()


def _font_path() -> Path | None:
    return next((Path(candidate) for candidate in FONT_CANDIDATES if Path(candidate).is_file()), None)


def insert_positioned_character(
    page: fitz.Page,
    character: str,
    bbox: dict[str, int],
    dpi: int,
    *,
    fontfile: Path | None = None,
) -> None:
    """Insert one invisible glyph whose extracted bbox matches the pixel bbox."""

    fontfile = _font_path() if fontfile is None else fontfile
    if fontfile is None:
        raise RuntimeError("a CJK-capable local font is required for positioned text")
    scale = 72 / dpi
    x0, y0, x1, y1 = (value * scale for value in _box_edges(bbox))
    font = fitz.Font(fontfile=str(fontfile))
    font_height = font.ascender - font.descender
    font_size = (y1 - y0) / max(0.01, font_height)
    baseline = y0 + font.ascender * font_size
    text_width = font.text_length(character, fontsize=font_size)
    if text_width <= 0:
        raise ValueError(f"cannot measure PDF glyph {character!r}")
    horizontal_scale = (x1 - x0) / text_width
    origin = fitz.Point(x0, baseline)
    page.insert_text(
        origin,
        character,
        fontname="ArialUnicode",
        fontfile=str(fontfile),
        fontsize=font_size,
        render_mode=3,
        morph=(origin, fitz.Matrix(horizontal_scale, 1)),
        overlay=True,
    )


def create_positioned_pdf(
    pages: list[dict],
    image_paths: dict[int, Path],
    output: Path,
    dpi: int,
) -> dict[str, object]:
    fontfile = _font_path()
    if fontfile is None:
        raise RuntimeError("Arial Unicode is unavailable; cannot build searchable validation PDF")
    document = fitz.open()
    expected_by_page: list[list[dict]] = []
    expected_blocks_by_page: list[list[tuple[dict, int, int]]] = []
    for calibrated_page in pages:
        target = document.new_page(
            width=calibrated_page["width"] * 72 / dpi,
            height=calibrated_page["height"] * 72 / dpi,
        )
        target.insert_image(target.rect, filename=str(image_paths[calibrated_page["pageNo"]]))
        expected = []
        expected_blocks = []
        for block in calibrated_page.get("blocks", []):
            if block.get("geometryStatus") != "ok":
                continue
            start = len(expected)
            for char in block["chars"]:
                insert_positioned_character(target, char["text"], char["bbox"], dpi, fontfile=fontfile)
                expected.append(char)
            expected_blocks.append((block, start, len(expected)))
        expected_by_page.append(expected)
        expected_blocks_by_page.append(expected_blocks)
    document.save(output, garbage=4, deflate=True)
    document.close()

    validation_pages = []
    pdf = fitz.open(output)
    for page_index, pdf_page in enumerate(pdf):
        extracted = []
        raw = pdf_page.get_text("rawdict")
        for block in raw.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    for char in span.get("chars", []):
                        extracted.append({"text": char["c"], "bbox": char["bbox"]})
        expected = expected_by_page[page_index]
        ious = []
        for target_char, pdf_char in zip(expected, extracted):
            tx0, ty0, tx1, ty1 = (value * 72 / dpi for value in _box_edges(target_char["bbox"]))
            px0, py0, px1, py1 = pdf_char["bbox"]
            intersection = max(0.0, min(tx1, px1) - max(tx0, px0)) * max(0.0, min(ty1, py1) - max(ty0, py0))
            union = (tx1 - tx0) * (ty1 - ty0) + (px1 - px0) * (py1 - py0) - intersection
            ious.append(intersection / union if union else 0.0)
        blocks_report = []
        for block, start, end in expected_blocks_by_page[page_index]:
            target_chars = expected[start:end]
            pdf_chars = extracted[start:end]
            target_x0 = min(char["bbox"]["x"] for char in target_chars)
            target_x1 = max(char["bbox"]["x"] + char["bbox"]["width"] for char in target_chars)
            if pdf_chars:
                pdf_x0 = min(char["bbox"][0] for char in pdf_chars) * dpi / 72
                pdf_x1 = max(char["bbox"][2] for char in pdf_chars) * dpi / 72
            else:
                pdf_x0 = pdf_x1 = 0.0
            coarse = normalize_box(block["bbox"])
            blocks_report.append(
                {
                    "blockId": block["id"],
                    "characterCount": len(target_chars),
                    "targetHorizontalSpanPixels": round(target_x1 - target_x0, 3),
                    "pdfHorizontalSpanPixels": round(pdf_x1 - pdf_x0, 3),
                    "coarseLineWidthPixels": coarse["width"],
                    "pdfSpanToCoarseLineRatio": round((pdf_x1 - pdf_x0) / coarse["width"], 4),
                }
            )
        validation_pages.append(
            {
                "pageNo": pages[page_index]["pageNo"],
                "expectedCharacterCount": len(expected),
                "extractedCharacterCount": len(extracted),
                "textMatchesInsertionOrder": "".join(item["text"] for item in extracted)
                == "".join(item["text"] for item in expected),
                "minimumCharacterBboxIoU": round(min(ious), 4) if ious else None,
                "blocks": blocks_report,
            }
        )
        page_report = validation_pages[-1]
        if page_report["extractedCharacterCount"] != page_report["expectedCharacterCount"]:
            pdf.close()
            raise ValueError(
                f"page {page_report['pageNo']}: positioned PDF extracted "
                f"{page_report['extractedCharacterCount']} of {page_report['expectedCharacterCount']} characters"
            )
        if not page_report["textMatchesInsertionOrder"]:
            pdf.close()
            raise ValueError(f"page {page_report['pageNo']}: positioned PDF text order mismatch")
        if ious and min(ious) < PDF_MINIMUM_CHAR_BBOX_IOU:
            pdf.close()
            raise ValueError(
                f"page {page_report['pageNo']}: positioned PDF minimum character bbox IoU "
                f"{min(ious):.4f} is below {PDF_MINIMUM_CHAR_BBOX_IOU:.2f}"
            )
    pdf.close()
    return {
        "path": str(output),
        "pageCount": len(validation_pages),
        "font": fontfile.name,
        "pages": validation_pages,
    }


def _quality_markdown(document: dict) -> str:
    quality = document["quality"]
    lines = [
        "# OCR Character Geometry Validation",
        "",
        f"- Method: `{document['method']}`",
        f"- Pages: {quality['pageCount']}",
        f"- Successful blocks: {quality['successfulBlocks']}",
        f"- Failed blocks: {quality['failedBlocks']} (excluded from the success rate)",
        f"- Direct successful blocks: {quality['directSuccessfulBlocks']}",
        f"- Boundary-corrected successful blocks: {quality['correctedSuccessfulBlocks']} "
        f"across {quality['boundaryCorrectionCount']} correction pair(s)",
        f"- Positioned characters: {quality['positionedCharacters']}",
        f"- Successful block rate: {quality['successfulBlockRate']:.2%}",
        "",
        "## Failure reasons",
        "",
    ]
    if quality["failureReasons"]:
        lines.extend(f"- `{reason}`: {count}" for reason, count in quality["failureReasons"].items())
    else:
        lines.append("- None")
    lines.extend(["", "## Boundary corrections", ""])
    corrections = []
    for page in document["pages"]:
        for block in page.get("blocks", []):
            correction = block.get("geometryCorrection")
            if isinstance(correction, dict) and correction.get("role") == "source":
                corrections.append((page["pageNo"], block, correction))
    if corrections:
        for page_no, block, correction in corrections:
            lines.append(
                f"- Page {page_no} `{correction['id']}` moved `{correction['transferredText']}` from the raw trailing "
                f"boundary of `{block['id']}` to the effective leading boundary of `{correction['peerBlockId']}`; "
                "the page character stream is unchanged."
            )
    else:
        lines.append("- None")
    lines.extend(["", "## Failed blocks", ""])
    if quality["failedBlockRecords"]:
        for failure in quality["failedBlockRecords"]:
            observed = failure["observedGroupCount"] if failure["observedGroupCount"] is not None else "n/a"
            lines.append(
                f"- Page {failure['pageNo']} `{failure['blockId']}` `{failure['text']}`: `{failure['reason']}` "
                f"(expected {failure['expectedCharacterCount']}, observed {observed})."
            )
    else:
        lines.append("- None")
    lines.extend(["", "## PDF geometry", ""])
    for page in quality.get("pdfValidation", {}).get("pages", []):
        lines.append(
            f"- Page {page['pageNo']}: {page['extractedCharacterCount']}/{page['expectedCharacterCount']} positioned characters extracted; "
            f"minimum bbox IoU `{page['minimumCharacterBboxIoU']}`."
        )
        for block in page["blocks"][:1]:
            lines.append(
                f"  First reliable block `{block['blockId']}`: PDF span `{block['pdfHorizontalSpanPixels']}` px / "
                f"coarse width `{block['coarseLineWidthPixels']}` px = `{block['pdfSpanToCoarseLineRatio']}`."
            )
    lines.extend(
        [
            "",
            "Blue outlines mark the excluded pinyin band. Green numbered boxes are foreground-supported Hanzi/punctuation. Red boxes are failed blocks.",
            "",
        ]
    )
    return "\n".join(lines)


def _parse_pages(value: str) -> list[int]:
    pages = []
    for part in value.split(","):
        page_no = int(part.strip())
        if page_no <= 0:
            raise argparse.ArgumentTypeError("page numbers must be positive")
        if page_no not in pages:
            pages.append(page_no)
    if not pages:
        raise argparse.ArgumentTypeError("at least one page is required")
    return pages


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-manifest", type=Path, required=True)
    parser.add_argument("--response", type=Path, required=True)
    parser.add_argument("--pages", type=_parse_pages, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    document, image_paths = calibrated_document(args.render_manifest, args.response, args.pages)
    args.output.mkdir(parents=True, exist_ok=True)
    for page in document["pages"]:
        page_no = page["pageNo"]
        write_json(args.output / f"page-{page_no:04d}.calibrated.json", {"schemaVersion": SCHEMA_VERSION, "page": page})
        draw_overlay(image_paths[page_no], page, args.output / f"page-{page_no:04d}.overlay.png")
    pdf_report = create_positioned_pdf(
        document["pages"],
        image_paths,
        args.output / "geometry-validation.searchable.pdf",
        document["render"]["dpi"],
    )
    document["quality"]["pdfValidation"] = pdf_report
    errors = validate_calibrated_document(document)
    if errors:
        raise ValueError(f"calibrated document contract failed after PDF generation: {'; '.join(errors)}")
    write_json(args.output / "calibrated-pages.json", document)
    write_json(args.output / "quality-report.json", document["quality"])
    (args.output / "QUALITY-REPORT.md").write_text(_quality_markdown(document), encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "pages": args.pages,
                "successfulBlocks": document["quality"]["successfulBlocks"],
                "failedBlocks": document["quality"]["failedBlocks"],
                "positionedCharacters": document["quality"]["positionedCharacters"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
