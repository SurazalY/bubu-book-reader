from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch


PIPELINE = Path(__file__).resolve().parents[1] / "pipeline"
sys.path.insert(0, str(PIPELINE))

import record_ocr_attempt  # noqa: E402
from ocr_v2 import (  # noqa: E402
    CALIBRATION_PAGE_NOS,
    ContractError,
    ImmutableArtifactError,
    OCR_TASK_THREAD_ID,
    REVIEW_MODEL,
    build_review_envelope,
    build_agy_review_command,
    persist_deterministic_render,
    project_attempt,
    run_agy_review,
    scan_quality_signals,
    sha256_bytes,
    sha256_file,
    sha256_json,
    validate_attempt,
    validate_gemini_review_output,
    validate_page_work_unit,
    validate_review,
    validate_state_transition,
    write_immutable_json,
)


SOURCE_SHA = "5c419590e69f1d00d276acd16e157bdb0c8f3e2fc0d25183484cdf65faced6cd"
IMAGE_SHA = "1" * 64
ATTEMPT_SHA = "2" * 64


def work_unit(page_no: int = 1) -> dict:
    return {
        "schemaVersion": "page-work-unit/v1",
        "workUnitId": f"book-025-p{page_no:04d}-a01",
        "bookId": "book-025",
        "pageNo": page_no,
        "sourcePdfSha256": SOURCE_SHA,
        "imagePath": f"render/page-{page_no:04d}.png",
        "inputImageSha256": IMAGE_SHA,
        "render": {"dpi": 200, "width": 1312, "height": 1867, "rendererVersion": "test-renderer"},
    }


def attempt(unit: dict | None = None, paragraphs: list[dict] | None = None) -> dict:
    unit = unit or work_unit()
    paragraphs = paragraphs or [{"order": 1, "rawText": "第一段"}, {"order": 2, "rawText": "第二段"}]
    value = {
        "schemaVersion": "ocr-page-attempt/v2",
        "attemptId": f"{unit['workUnitId']}-attempt-0001",
        "workUnitId": unit["workUnitId"],
        "bookId": unit["bookId"],
        "pageNo": unit["pageNo"],
        "sourcePdfSha256": SOURCE_SHA,
        "inputImageSha256": unit["inputImageSha256"],
        "promptVersion": "luna-ocr-v2-calibration",
        "promptSha256": "3" * 64,
        "outputSha256": "",
        "status": "ok",
        "paragraphs": paragraphs,
        "executionTrace": {
            "system": "codex",
            "model": "gpt-5.6-luna",
            "reasoningEffort": "xhigh",
            "taskSourceThreadId": "01a004d4-9af6-7652-bdce-5bc955278230",
        },
        "createdAt": "2026-08-15T12:00:00+00:00",
    }
    value["outputSha256"] = sha256_json({"bookId": value["bookId"], "pageNo": value["pageNo"], "paragraphs": value["paragraphs"]})
    return value


class OcrV2ContractTests(unittest.TestCase):
    def test_work_unit_rejects_image_hash_mismatch_by_attempt_boundary(self) -> None:
        unit = work_unit()
        broken = attempt(unit)
        broken["inputImageSha256"] = "4" * 64
        with self.assertRaisesRegex(ContractError, "input image SHA-256"):
            validate_attempt(broken, unit)

    def test_work_unit_page_must_be_one_of_frozen_calibration_pages(self) -> None:
        unit = work_unit(2)
        with self.assertRaisesRegex(ContractError, "12 calibration"):
            validate_page_work_unit(unit)
        self.assertEqual(CALIBRATION_PAGE_NOS[0], 1)

    def test_attempt_rejects_self_reported_page_mismatch(self) -> None:
        unit = work_unit()
        broken = attempt(unit)
        broken["selfReportedPageNo"] = 5
        with self.assertRaisesRegex(ContractError, "self-reported page"):
            validate_attempt(broken, unit)

    def test_attempt_rejects_bbox_and_does_not_project_geometry(self) -> None:
        unit = work_unit()
        broken = attempt(unit)
        broken["paragraphs"][0]["bbox"] = {"x": 0}
        broken["outputSha256"] = sha256_json({"bookId": broken["bookId"], "pageNo": broken["pageNo"], "paragraphs": broken["paragraphs"]})
        with self.assertRaisesRegex(ContractError, "bbox"):
            validate_attempt(broken, unit)
        projection = project_attempt(attempt(unit), unit, ATTEMPT_SHA)
        self.assertNotIn("bbox", json.dumps(projection, ensure_ascii=False).lower())
        self.assertEqual(projection["blocks"][1]["rawCharStart"], len("第一段"))
        self.assertEqual(projection["blocks"][1]["rawCharEnd"], len("第一段第二段"))

    def test_attempt_sha_immutability_is_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "attempt.json"
            first_hash = write_immutable_json(target, {"value": 1})
            self.assertEqual(len(first_hash), 64)
            with self.assertRaises(ImmutableArtifactError):
                write_immutable_json(target, {"value": 2})
            self.assertEqual(target.read_text(encoding="utf-8"), '{"value":1}\n')

    def test_deterministic_render_compares_new_bytes_before_existing_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "page-0001.png"
            first_sha = persist_deterministic_render(target, b"render-v1")
            self.assertEqual(first_sha, persist_deterministic_render(target, b"render-v1"))
            with self.assertRaises(ImmutableArtifactError):
                persist_deterministic_render(target, b"render-v2")
            self.assertEqual(target.read_bytes(), b"render-v1")

    def test_review_attempt_hash_must_match_and_pass_requires_empty_findings(self) -> None:
        unit = work_unit()
        passed = {
            "schemaVersion": "ocr-page-review/v1",
            "reviewId": "book-025-p0001-review-0001",
            "bookId": "book-025",
            "pageNo": 1,
            "inputImageSha256": IMAGE_SHA,
            "ocrAttemptSha256": ATTEMPT_SHA,
            "verdict": "passed",
            "findings": [],
            "executionTrace": {"system": "agy", "model": REVIEW_MODEL, "mode": "plan", "sandbox": True},
            "createdAt": "2026-08-15T12:00:00+00:00",
        }
        self.assertEqual(validate_review(passed, unit, ATTEMPT_SHA)["verdict"], "passed")
        mismatch = copy.deepcopy(passed)
        mismatch["ocrAttemptSha256"] = "4" * 64
        with self.assertRaisesRegex(ContractError, "attempt SHA-256"):
            validate_review(mismatch, unit, ATTEMPT_SHA)
        bad_pass = copy.deepcopy(passed)
        bad_pass["findings"] = [{"type": "page-text-mismatch", "severity": "blocking", "detail": "x", "imageEvidence": "x", "ocrEvidence": "x"}]
        with self.assertRaisesRegex(ContractError, "passed review"):
            validate_review(bad_pass, unit, ATTEMPT_SHA)

    def test_gemini_output_is_narrow_and_local_runner_builds_trusted_envelope(self) -> None:
        narrow = {"verdict": "passed", "findings": []}
        self.assertEqual(validate_gemini_review_output(narrow), narrow)
        with self.assertRaisesRegex(ContractError, "unsupported fields"):
            validate_gemini_review_output({**narrow, "pageNo": 1})
        review = build_review_envelope(
            gemini_output=narrow,
            work_unit=work_unit(),
            attempt_sha256=ATTEMPT_SHA,
            review_number=1,
            created_at="2026-08-15T12:00:00+00:00",
            conversation_id="agy-conversation-1",
        )
        self.assertEqual(review["reviewId"], "book-025-p0001-a01-review-0001")
        self.assertEqual(review["bookId"], "book-025")
        self.assertEqual(review["pageNo"], 1)
        self.assertEqual(review["ocrAttemptSha256"], ATTEMPT_SHA)
        self.assertEqual(review["executionTrace"]["model"], REVIEW_MODEL)
        self.assertEqual(review["executionTrace"]["conversationId"], "agy-conversation-1")

    def test_agy_runner_accepts_only_narrow_model_output_and_persists_local_envelope(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image_path = root / "page-0001.png"
            image_path.write_bytes(b"correct-image")
            unit = work_unit()
            unit["inputImageSha256"] = sha256_file(image_path)
            attempt_path = root / "attempt.json"
            attempt_value = attempt(unit)
            attempt_path.write_bytes(json.dumps(attempt_value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n")
            attempt_sha = sha256_file(attempt_path)
            review_output_path = root / "review.json"
            with patch("ocr_v2.subprocess.run", return_value=Namespace(returncode=0, stdout='{"verdict":"passed","findings":[]}', stderr="")) as run:
                review = run_agy_review(
                    agy_executable="/mnt/c/Users/Yak/AppData/Local/agy/bin/agy.exe",
                    image_path=image_path,
                    ocr_attempt_path=attempt_path,
                    review_schema_path=root / "gemini-review-output-v1.schema.json",
                    work_unit=unit,
                    attempt_sha256=attempt_sha,
                    review_output_path=review_output_path,
                    review_number=1,
                )
            command = run.call_args.args[0]
            self.assertIn("gemini-3.7-flash-high", command)
            self.assertIn("high", command)
            self.assertNotIn("gemini-3.7-flash-medium", command)
            self.assertEqual(review["pageNo"], 1)
            self.assertEqual(review["ocrAttemptSha256"], attempt_sha)
            self.assertEqual(json.loads(review_output_path.read_text(encoding="utf-8"))["reviewId"], review["reviewId"])

    def test_agy_runner_rejects_wrong_image_before_call_or_review_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image_path = root / "wrong-page.png"
            image_path.write_bytes(b"wrong-image")
            unit = work_unit()
            unit["inputImageSha256"] = sha256_bytes(b"correct-image")
            attempt_path = root / "attempt.json"
            attempt_value = attempt(unit)
            attempt_path.write_bytes(json.dumps(attempt_value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n")
            attempt_sha = sha256_file(attempt_path)
            review_output_path = root / "review.json"
            with patch("ocr_v2.subprocess.run") as run:
                with self.assertRaisesRegex(ContractError, "input image SHA-256"):
                    run_agy_review(
                        agy_executable="/mnt/c/Users/Yak/AppData/Local/agy/bin/agy.exe",
                        image_path=image_path,
                        ocr_attempt_path=attempt_path,
                        review_schema_path=root / "gemini-review-output-v1.schema.json",
                        work_unit=unit,
                        attempt_sha256=attempt_sha,
                        review_output_path=review_output_path,
                        review_number=1,
                    )
            run.assert_not_called()
            self.assertFalse(review_output_path.exists())
            self.assertEqual(list(root.glob(".ocr-review-input-*.json")), [])

    def test_state_machine_rejects_implicit_acceptance(self) -> None:
        with self.assertRaisesRegex(ContractError, "invalid page state"):
            validate_state_transition("ocr_complete", "accepted")
        validate_state_transition("ocr_complete", "review_running")

    def test_quality_signals_do_not_modify_or_select_text(self) -> None:
        first = attempt(work_unit(1), [{"order": 1, "rawText": "重复正文"}])
        second = attempt(work_unit(5), [{"order": 1, "rawText": "重复正文"}])
        before = copy.deepcopy(first)
        signals = scan_quality_signals([first, second], [1, 5, 40])
        self.assertEqual(signals["missingPageNos"], [40])
        self.assertEqual(signals["exactDuplicateGroups"], [[1, 5]])
        self.assertFalse(signals["textSelectionPerformed"])
        self.assertEqual(first, before)

    def test_quality_signals_flag_short_or_duplicate_text_without_changing_it(self) -> None:
        short = attempt(work_unit(1), [{"order": 1, "rawText": "短"}])
        self.assertEqual(scan_quality_signals([short], [1])["emptyPageNos"], [])
        self.assertEqual(scan_quality_signals([short], [1])["textLengthByPage"], {"1": 1})
        self.assertEqual(short["paragraphs"][0]["rawText"], "短")

    def test_agy_command_is_explicit_and_has_no_model_fallback(self) -> None:
        command = build_agy_review_command(
            agy_executable="/mnt/c/Users/Yak/AppData/Local/agy/bin/agy.exe",
            image_path=Path("/job/render/page-0001.png"),
            ocr_review_input_path=Path("/job/review-input.json"),
            review_schema_path=Path("/schemas/gemini-review-output-v1.schema.json"),
        )
        self.assertEqual(command[0], "/mnt/c/Users/Yak/AppData/Local/agy/bin/agy.exe")
        self.assertIn("gemini-3.7-flash-high", command)
        self.assertIn("high", command)
        self.assertIn("plan", command)
        self.assertIn("--sandbox", command)
        self.assertNotIn("gemini-3.7-flash-medium", command)

    @staticmethod
    def _record_fixture(root: Path, *, state: str = "created") -> tuple[Path, Path, Namespace]:
        job_dir = root / "job"
        job_dir.mkdir()
        unit = work_unit()
        work_unit_path = root / "work-unit.json"
        work_unit_path.write_text(json.dumps(unit, ensure_ascii=False), encoding="utf-8")
        prompt_path = root / "prompt.md"
        prompt_path.write_text("prompt", encoding="utf-8")
        (job_dir / "progress.json").write_text(json.dumps({
            "schemaVersion": "ocr-v2-progress/v1",
            "jobId": "book-025",
            "pageStates": {"1": state},
            "attempts": {},
        }, ensure_ascii=False), encoding="utf-8")
        args = Namespace(
            job_dir=job_dir,
            work_unit=work_unit_path,
            prompt=prompt_path,
            attempt_number=1,
            task_source_thread_id="01a004d4-9af6-7652-bdce-5bc955278230",
            ocr_task_thread_id=OCR_TASK_THREAD_ID,
            created_at="2026-08-15T12:00:00+00:00",
            paragraph=["合成测试正文"],
        )
        return job_dir, work_unit_path, args

    @staticmethod
    def _snapshot_tree(root: Path) -> dict[str, bytes]:
        return {
            str(path.relative_to(root)): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file()
        }

    def test_record_rejects_disallowed_state_with_zero_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            job_dir, _, args = self._record_fixture(Path(directory), state="review_passed")
            before = self._snapshot_tree(job_dir)
            with self.assertRaisesRegex(ValueError, "not ready"):
                record_ocr_attempt.record(args)
            self.assertEqual(self._snapshot_tree(job_dir), before)

    def test_record_rejects_inconsistent_duplicate_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            job_dir, work_unit_path, args = self._record_fixture(Path(directory))
            unit = json.loads(work_unit_path.read_text(encoding="utf-8"))
            existing = attempt(unit, [{"order": 1, "rawText": "已存在的不同正文"}])
            attempt_path = job_dir / "attempts" / "page-0001" / "attempt-0001.json"
            projection_path = job_dir / "projections" / "page-0001.json"
            write_immutable_json(attempt_path, existing)
            write_immutable_json(projection_path, project_attempt(existing, unit, "4" * 64))
            before = self._snapshot_tree(job_dir)
            with self.assertRaises(ImmutableArtifactError):
                record_ocr_attempt.record(args)
            self.assertEqual(self._snapshot_tree(job_dir), before)

    def test_record_commit_is_idempotent_and_binds_actual_ocr_thread(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            job_dir, _, args = self._record_fixture(Path(directory))
            first = record_ocr_attempt.record(args)
            second = record_ocr_attempt.record(args)
            self.assertFalse(first["idempotent"])
            self.assertTrue(second["idempotent"])
            persisted = json.loads((job_dir / "attempts/page-0001/attempt-0001.json").read_text(encoding="utf-8"))
            self.assertEqual(persisted["executionTrace"]["threadId"], OCR_TASK_THREAD_ID)
            ledger = json.loads((job_dir / "attempt-ledger.jsonl").read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(ledger["threadId"], OCR_TASK_THREAD_ID)
            self.assertTrue((job_dir / "transactions" / persisted["attemptId"] / "commit.json").is_file())

    def test_record_does_not_treat_missing_commit_marker_as_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            job_dir, _, args = self._record_fixture(Path(directory))
            first = record_ocr_attempt.record(args)
            commit_path = job_dir / "transactions" / first["attemptId"] / "commit.json"
            commit_path.unlink()
            before = self._snapshot_tree(job_dir)
            with self.assertRaisesRegex(ImmutableArtifactError, "transaction marker"):
                record_ocr_attempt.record(args)
            self.assertEqual(self._snapshot_tree(job_dir), before)


if __name__ == "__main__":
    unittest.main()
