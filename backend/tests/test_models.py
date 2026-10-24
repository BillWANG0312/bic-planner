"""Archive validation stays compatible with records produced by ReportStore."""

from copy import deepcopy
import importlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "backend/bic_api/models.py"


def record():
    return {
        "id": "local-test_1",
        "createdAt": "2026-10-24T06:00:00.000Z",
        "updatedAt": "2026-10-24T14:00:00+08:00",
        "bankVersion": "2026.10",
        "catalogVersion": None,
        "state": {
            "info": {"name": "测试同学", "grade": "8", "year": "2027 年秋季"},
            "academic": {"answers": {}},
            "plan": {"answers": {"grade": "8"}},
            "mbti": {"answers": []},
        },
        "reportMeta": {"batchId": "AP-TEST", "date": "2026/10/24"},
    }


def history_entry():
    return {
        "id": "edit-1", "at": "2026-10-24T06:00:00Z", "author": "王老师",
        "section": "plan", "before": "", "after": "建议参加体验课程。",
        "action": "edit", "reportId": "AP-TEST",
    }


def set_path(value, path, replacement):
    for part in path[:-1]:
        value = value[part]
    value[path[-1]] = replacement


class ArchiveRecordTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if MODEL_PATH.exists():
            cls.model = importlib.import_module("backend.bic_api.models").ArchiveRecord
        else:
            cls.model = None

    def validate(self, value):
        self.assertIsNotNone(self.model, "ArchiveRecord validation has not been implemented")
        return self.model.model_validate(value).model_dump(mode="json", exclude_unset=True)

    def assert_rejected(self, value):
        from pydantic import ValidationError
        self.assertIsNotNone(self.model, "ArchiveRecord validation has not been implemented")
        with self.assertRaises(ValidationError):
            self.model.model_validate(value)

    def test_accepts_saved_record_without_inventing_optional_fields(self):
        saved = self.validate(record())
        self.assertEqual(saved, record())
        self.assertNotIn("advisor", saved)

    def test_rejects_unknown_fields_at_every_nested_boundary(self):
        paths = [(), ("state",), ("state", "info"), ("state", "academic"),
                 ("state", "plan"), ("state", "mbti"), ("reportMeta",),
                 ("advisor",), ("advisor", "sections"), ("advisor", "history", 0)]
        for path in paths:
            with self.subTest(path=path):
                value = record()
                value["advisor"] = {"sections": {}, "history": [history_entry()]}
                target = value
                for part in path:
                    target = target[part]
                target["computedScore"] = 100
                self.assert_rejected(value)

    def test_requires_all_browser_required_fields_and_rejects_wrong_shapes(self):
        for path in [("state", "info", "name"), ("state", "academic", "answers"),
                     ("state", "plan", "answers"), ("state", "mbti", "answers"),
                     ("reportMeta", "date"), ("createdAt",), ("bankVersion",)]:
            with self.subTest(path=path):
                value = record()
                target = value
                for part in path[:-1]:
                    target = target[part]
                del target[path[-1]]
                self.assert_rejected(value)
        for path, invalid in [(('state',), []), (('state', 'info', 'name'), 4),
                              (('state', 'academic', 'answers'), []),
                              (('state', 'plan', 'answers'), []),
                              (('state', 'mbti', 'answers'), {}), (('advisor',), None)]:
            with self.subTest(path=path, invalid=invalid):
                value = record()
                set_path(value, path, invalid)
                self.assert_rejected(value)

    def test_text_limits_use_javascript_utf16_units(self):
        for field, limit in [("name", 24), ("year", 40)]:
            value = record()
            value["state"]["info"][field] = "😀" * (limit // 2)
            self.validate(value)
            value["state"]["info"][field] += "a"
            self.assert_rejected(value)
        for whitespace in [" ", "\t\n", "\ufeff"]:
            value = record()
            value["state"]["info"]["name"] = whitespace
            self.assert_rejected(value)
        value = record()
        value["state"]["info"]["name"] = "\u0085"  # JavaScript does not trim this.
        self.validate(value)

    def test_validates_grade_consistency_without_requiring_completed_assessment(self):
        for grade in ["8", "9", "10", "11", ""]:
            value = record()
            value["state"]["info"]["grade"] = grade
            value["state"]["plan"]["answers"] = {}
            self.validate(value)
        for grade in ["7", "12", 8, None]:
            value = record()
            value["state"]["info"]["grade"] = grade
            self.assert_rejected(value)
        value = record()
        value["state"]["plan"]["answers"]["grade"] = "9"
        self.assert_rejected(value)

    def test_academic_answers_match_question_types_and_javascript_numbers(self):
        schema = json.loads((ROOT / "backend/assessment-schema.json").read_text(encoding="utf-8"))
        choice = next(q["id"] for q in schema["academic"] if q["type"] == "choice")
        numeric = next(q["id"] for q in schema["academic"] if q["type"] == "numeric")
        for answer in [0, 3, 1.0, None]:
            value = record()
            value["state"]["academic"]["answers"] = {choice: answer}
            self.validate(value)
        for answer in [True, False, "1", -1, 4, 1.5, [], {}, math.inf, math.nan]:
            with self.subTest(choice=answer):
                value = record()
                value["state"]["academic"]["answers"] = {choice: answer}
                self.assert_rejected(value)
        for answer in [0, -1.5, " -1.2e3 ", ".5", "0x10", "0b10", "0o10", "\ufeff2\ufeff", None]:
            with self.subTest(numeric=answer):
                value = record()
                value["state"]["academic"]["answers"] = {numeric: answer}
                self.validate(value)
        for answer in [True, "", " ", "nan", "Infinity", "1e999", "+0x10", "1_000", "１２", "1" * 101, math.inf, [], {}]:
            with self.subTest(numeric=answer):
                value = record()
                value["state"]["academic"]["answers"] = {numeric: answer}
                self.assert_rejected(value)
        value = record()
        value["state"]["academic"]["answers"] = {"unknown": 0}
        self.assert_rejected(value)

    def test_plan_uses_actual_options_limits_and_free_text_rules(self):
        valid = {"grade": "8", "interests": ["math"], "schoolSubjects": ["数学", "custom"],
                 "weakSubjects": [], "clubs": ["coding"], "groupSize": "small", "timeStyle": "deep",
                 "selfImage": ["rational"], "preferredMajor": ["tech"], "freeTime": ["make"],
                 "career": [], "countries": ["uk"], "subjectPerf": "0", "preferredLength": "short"}
        value = record()
        value["state"]["plan"]["answers"] = valid
        self.validate(value)
        invalid_answers = [{"unknown": []}, {"grade": 8}, {"grade": ""}, {"groupSize": "other"},
                           {"interests": ["math"] * 2}, {"interests": ["bad"]}, {"clubs": ["custom"]},
                           {"schoolSubjects": ["x" * 81]}, {"schoolSubjects": ["😀" * 41]},
                           {"schoolSubjects": [" "]}, {"schoolSubjects": [False]},
                           {"schoolSubjects": [str(i) for i in range(31)]},
                           {"interests": ["math", "coding", "puzzles", "logic"]}, {"clubs": None}]
        for answers in invalid_answers:
            with self.subTest(answers=answers):
                value = record()
                value["state"]["plan"]["answers"] = answers
                self.assert_rejected(value)

    def test_mbti_is_a_bounded_list_of_scale_numbers_or_null(self):
        for answers in [[], [0, 1, 2, 3, 4, None], [2.0] * 24]:
            value = record()
            value["state"]["mbti"]["answers"] = answers
            self.validate(value)
        for answers in [[0] * 25, [True], ["2"], [1.5], [-1], [5], [math.inf]]:
            value = record()
            value["state"]["mbti"]["answers"] = answers
            self.assert_rejected(value)

    def test_ids_versions_and_timezone_timestamps_are_bounded_and_valid(self):
        for field, invalid in [("id", "bad/id"), ("id", ""), ("id", "a" * 101),
                               ("bankVersion", " "), ("catalogVersion", ""),
                               ("createdAt", "2026-10-24"), ("createdAt", "2026-10-24T01:00:00"),
                               ("createdAt", "2026-02-30T01:00:00Z"),
                               ("createdAt", "2026-10-24T00:00:00+00:60"),
                               ("updatedAt", "2026-10-24T00:00:00+01:99"),
                               ("updatedAt", "2026-10-24T01:00:00+25:00"), ("updatedAt", 1)]:
            with self.subTest(field=field, invalid=invalid):
                value = record()
                value[field] = invalid
                self.assert_rejected(value)

    def test_advisor_validates_fields_history_identity_and_limits(self):
        value = record()
        value["advisor"] = {"sections": {"plan": "建议"}, "history": [history_entry()],
                            "lastAuthor": "", "carriedFrom": "AP-BEFORE"}
        self.assertEqual(self.validate(value)["advisor"], value["advisor"])
        invalid_cases = [(('sections', 'plan'), " "), (('sections', 'plan'), "😀" * 2001),
                         (('lastAuthor',), "😀" * 21), (('carriedFrom',), " "),
                         (('history', 0, 'id'), ""), (('history', 0, 'author'), " "),
                         (('history', 0, 'section'), "other"), (('history', 0, 'action'), "delete"),
                         (('history', 0, 'before'), "x" * 4001), (('history', 0, 'after'), ""),
                         (('history', 0, 'reportId'), ""), (('history', 0, 'at'), "invalid")]
        invalid_cases.append((('history', 0, 'at'), "2026-10-24T00:00:00-00:60"))
        for path, invalid in invalid_cases:
            with self.subTest(path=path):
                changed = deepcopy(value)
                set_path(changed["advisor"], path, invalid)
                self.assert_rejected(changed)
        value["advisor"]["history"] *= 2
        self.assert_rejected(value)
        value["advisor"]["history"] = [dict(history_entry(), id=f"edit-{i}") for i in range(200)]
        self.validate(value)
        value["advisor"]["history"].append(dict(history_entry(), id="edit-200"))
        self.assert_rejected(value)

    def test_record_size_checks_normalized_json_including_control_character_escaping(self):
        value = record()
        value["advisor"] = {"sections": {}, "history": [
            dict(history_entry(), id=f"edit-{i}", before="\x01" * 4000, after="\x01" * 4000)
            for i in range(50)
        ]}
        self.assert_rejected(value)

    @unittest.skipUnless(shutil.which("node"), "Node.js is needed for browser contract comparison")
    def test_source_metadata_and_real_reportstore_records_match_server(self):
        script = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const {loadReportScripts, state} = require('./tests/helpers/report.cjs');
const w = loadReportScripts();
vm.runInNewContext(fs.readFileSync('js/report-store.js', 'utf8'), {window: w, Date});
let raw = null;
const store = w.ReportStore.create({getItem: () => raw, setItem: (_, value) => {raw = value;}});
const records = [];
for (const complete of [false, true]) {
  const value = state(w, complete);
  value.plan.answers.preferredMajor = ['tech'];
  value.report = w.generateReport(value);
  value.report.meta.batchId = 'AP-CONTRACT-' + complete;
  w.reportEditing.applyEdit(value.report, 'plan', '体验课程后复核。', '王老师');
  records.push(store.save(value).record);
}
const metadata = {
  bankVersion: w.QUESTION_BANK_META.version,
  academic: w.QUESTION_BANK.map(q => ({id: q.id, type: q.type, ...(q.type === 'choice' ? {optionCount: q.options.length} : {})})),
  plan: w.PLAN_QUESTIONS.map(q => { const ids = (q.type === 'single' ? q.options() : q.source()).map(o => o.id);
    return {key: q.key, type: q.type, options: ids, ...(q.type !== 'single' ? {max: q.max || (q.multiFree ? 30 : ids.length), multiFree: !!q.multiFree} : {})}; }),
  grades: w.PLAN_CONFIG.grade.map(o => o.id), mbtiCount: w.MBTI_QUESTIONS.length,
  mbtiScale: w.MBTI_SCALE.map(o => o.value)
};
process.stdout.write(JSON.stringify({records, metadata}));
"""
        output = subprocess.run([shutil.which("node"), "-e", script], cwd=ROOT, check=True,
                                capture_output=True, encoding="utf-8")
        browser = json.loads(output.stdout)
        schema = json.loads((ROOT / "backend/assessment-schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema, browser["metadata"], "Regenerate schema when frontend assessment options change")
        for saved in browser["records"]:
            self.assertEqual(self.validate(saved), saved)


if __name__ == "__main__":
    unittest.main()
