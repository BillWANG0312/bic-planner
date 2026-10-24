"""Strict saved-response records; grades and recommendations are computed in the client.

The small assessment schema is generated from the browser scripts with Node's VM.
It contains answer shapes and option identifiers, never prompts or answer keys.
"""

from __future__ import annotations

from datetime import datetime
import json
import math
from pathlib import Path
import re
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictStr, field_validator, model_validator


ASSESSMENT_SCHEMA = json.loads(
    (Path(__file__).resolve().parents[1] / "assessment-schema.json").read_text(encoding="utf-8")
)
ACADEMIC_QUESTIONS = {question["id"]: question for question in ASSESSMENT_SCHEMA["academic"]}
PLAN_QUESTIONS = {question["key"]: question for question in ASSESSMENT_SCHEMA["plan"]}
MAX_RECORD_CHARS = 2_000_000

# ECMAScript WhiteSpace and LineTerminator differ slightly from Python's strip().
JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
DECIMAL_NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
RADIX_NUMBERS = (
    (re.compile(r"0[xX][0-9a-fA-F]+\Z"), 16),
    (re.compile(r"0[bB][01]+\Z"), 2),
    (re.compile(r"0[oO][0-7]+\Z"), 8),
)
TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])\Z")


def utf16_length(value: str) -> int:
    """JavaScript String.length, including supplementary characters and lone surrogates."""
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def bounded_text(maximum: int, *, required: bool = False):
    def validate(value: str) -> str:
        if utf16_length(value) > maximum:
            raise ValueError(f"text must be at most {maximum} UTF-16 units")
        if required and not value.strip(JS_WHITESPACE):
            raise ValueError("text must not be blank")
        return value
    return validate


def timestamp(value: str) -> str:
    bounded_text(40, required=True)(value)
    if not TIMESTAMP.fullmatch(value):
        raise ValueError("timestamp must be an ISO date-time with a timezone")
    try:
        parsed = datetime.fromisoformat(value.upper().replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("timestamp must be a valid date-time") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp must include a timezone")
    return value


def finite_number(value: Any) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(float(value))
    except (ValueError, OverflowError):
        return False


def scale_integer(value: Any, allowed: list[int]) -> int:
    if not finite_number(value) or value != int(value) or value not in allowed:
        raise ValueError("answer must be an integer on the supported scale")
    return int(value)


def numeric_answer(value: Any) -> bool:
    if finite_number(value):
        return True
    if not isinstance(value, str) or utf16_length(value) > 100:
        return False
    trimmed = value.strip(JS_WHITESPACE)
    if DECIMAL_NUMBER.fullmatch(trimmed):
        return math.isfinite(float(trimmed))
    for pattern, base in RADIX_NUMBERS:
        if pattern.fullmatch(trimmed):
            return math.isfinite(float(int(trimmed[2:], base)))
    return False


def _json_string_length(value: str) -> int:
    # JSON.stringify escapes controls, quotation marks, backslashes and lone
    # surrogates. Ordinary non-ASCII characters remain literal UTF-16 units.
    length = 2
    index = 0
    while index < len(value):
        code = ord(value[index])
        if code in (8, 9, 10, 12, 13, 34, 92):
            length += 2
        elif code < 32:
            length += 6
        elif 0xD800 <= code <= 0xDBFF and index + 1 < len(value) and 0xDC00 <= ord(value[index + 1]) <= 0xDFFF:
            length += 2
            index += 1
        elif 0xD800 <= code <= 0xDFFF:
            length += 6
        else:
            length += 2 if code > 0xFFFF else 1
        index += 1
    return length


def _js_number_text(value: int | float) -> str:
    """Use the ECMAScript fixed/exponent cutoffs for bounded numeric answers."""
    number = float(value)
    if number == 0:
        return "0"
    representation = repr(number).lower()
    if "e" not in representation:
        return representation.removesuffix(".0")
    mantissa, exponent_text = representation.split("e")
    exponent = int(exponent_text)
    if 1e-6 <= abs(number) < 1e21:
        sign = "-" if mantissa.startswith("-") else ""
        digits = mantissa.lstrip("-").replace(".", "")
        position = 1 + exponent
        if position <= 0:
            return sign + "0." + "0" * -position + digits
        if position >= len(digits):
            return sign + digits + "0" * (position - len(digits))
        return sign + digits[:position] + "." + digits[position:]
    return mantissa.removesuffix(".0") + "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent))


def _json_utf16_length(value: Any) -> int:
    if isinstance(value, str):
        return _json_string_length(value)
    if value is None:
        return 4
    if isinstance(value, bool):
        return 4 if value else 5
    if isinstance(value, (int, float)):
        return len(_js_number_text(value))
    if isinstance(value, list):
        return 2 + max(len(value) - 1, 0) + sum(_json_utf16_length(item) for item in value)
    if isinstance(value, dict):
        return 2 + max(len(value) - 1, 0) + sum(
            _json_string_length(key) + 1 + _json_utf16_length(item) for key, item in value.items()
        )
    raise ValueError("record must contain only JSON values")


NameText = Annotated[StrictStr, AfterValidator(bounded_text(24, required=True))]
YearText = Annotated[StrictStr, AfterValidator(bounded_text(40))]
Required100 = Annotated[StrictStr, AfterValidator(bounded_text(100, required=True))]
Required80 = Annotated[StrictStr, AfterValidator(bounded_text(80, required=True))]
AuthorText = Annotated[StrictStr, AfterValidator(bounded_text(40, required=True))]
LastAuthorText = Annotated[StrictStr, AfterValidator(bounded_text(40))]
SectionText = Annotated[StrictStr, AfterValidator(bounded_text(4000, required=True))]
BeforeText = Annotated[StrictStr, AfterValidator(bounded_text(4000))]
TimestampText = Annotated[StrictStr, AfterValidator(timestamp)]
Section = Literal["summary", "academic", "plan", "personality"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class StudentInfo(StrictModel):
    name: NameText
    grade: StrictStr
    year: YearText

    @field_validator("grade")
    @classmethod
    def valid_grade(cls, value: str) -> str:
        if value and value not in ASSESSMENT_SCHEMA["grades"]:
            raise ValueError("grade is not supported")
        return value


class AcademicState(StrictModel):
    answers: dict[str, Any]

    @field_validator("answers", mode="before")
    @classmethod
    def valid_answers(cls, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("academic answers must be an object")
        result = {}
        for key, answer in value.items():
            if key not in ACADEMIC_QUESTIONS:
                raise ValueError("unknown academic question")
            if answer is None:
                continue  # ReportStore treats a cleared numeric input as unanswered.
            question = ACADEMIC_QUESTIONS[key]
            if question["type"] == "choice":
                result[key] = scale_integer(answer, list(range(question["optionCount"])))
            elif numeric_answer(answer):
                result[key] = answer
            else:
                raise ValueError(f"invalid academic answer for {key}")
        return result


class PlanAnswers(StrictModel):
    # Omitted questions stay omitted when model_dump(exclude_unset=True) is used.
    # A present null fails validation, as it does in ReportStore.
    grade: StrictStr = None
    interests: list[StrictStr] = None
    schoolSubjects: list[StrictStr] = None
    weakSubjects: list[StrictStr] = None
    clubs: list[StrictStr] = None
    groupSize: StrictStr = None
    timeStyle: StrictStr = None
    selfImage: list[StrictStr] = None
    preferredMajor: list[StrictStr] = None
    freeTime: list[StrictStr] = None
    career: list[StrictStr] = None
    countries: list[StrictStr] = None
    subjectPerf: StrictStr = None
    preferredLength: StrictStr = None

    @model_validator(mode="before")
    @classmethod
    def valid_answers(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("planning answers must be an object")
        for key, answer in value.items():
            question = PLAN_QUESTIONS.get(key)
            if question is None:
                raise ValueError("unknown planning question")
            if question["type"] == "single":
                if not isinstance(answer, str) or answer not in question["options"]:
                    raise ValueError(f"invalid planning option for {key}")
            else:
                if not isinstance(answer, list) or len(answer) > question["max"]:
                    raise ValueError(f"too many or invalid planning answers for {key}")
                seen = set()
                for item in answer:
                    if not isinstance(item, str):
                        raise ValueError(f"planning option for {key} must be text")
                    bounded_text(80, required=True)(item)
                    if item in seen or not question["multiFree"] and item not in question["options"]:
                        raise ValueError(f"duplicate or unsupported planning option for {key}")
                    seen.add(item)
        return value


class PlanState(StrictModel):
    answers: PlanAnswers


class MbtiState(StrictModel):
    answers: list[int | None] = Field(max_length=ASSESSMENT_SCHEMA["mbtiCount"])

    @field_validator("answers", mode="before")
    @classmethod
    def valid_answers(cls, value: Any) -> list[int | None]:
        if not isinstance(value, list):
            raise ValueError("personality answers must be an array")
        if len(value) > ASSESSMENT_SCHEMA["mbtiCount"]:
            raise ValueError("too many personality answers")
        return [None if answer is None else scale_integer(answer, ASSESSMENT_SCHEMA["mbtiScale"]) for answer in value]


class AssessmentState(StrictModel):
    info: StudentInfo
    academic: AcademicState
    plan: PlanState
    mbti: MbtiState

    @model_validator(mode="after")
    def consistent_grade(self) -> AssessmentState:
        if self.info.grade and self.plan.answers.grade and self.info.grade != self.plan.answers.grade:
            raise ValueError("student and planning grades do not agree")
        return self


class ReportMeta(StrictModel):
    batchId: Required100
    date: Required80


class AdvisorSections(StrictModel):
    summary: SectionText = None
    academic: SectionText = None
    plan: SectionText = None
    personality: SectionText = None


class AdvisorHistoryEntry(StrictModel):
    id: Required100
    at: TimestampText
    author: AuthorText
    section: Section
    before: BeforeText
    after: SectionText
    action: Literal["edit", "reset", "restore"]
    reportId: Required100


class AdvisorEditing(StrictModel):
    sections: AdvisorSections
    history: list[AdvisorHistoryEntry] = Field(max_length=200)
    lastAuthor: LastAuthorText = None
    carriedFrom: Required100 = None

    @field_validator("history")
    @classmethod
    def unique_history_ids(cls, value: list[AdvisorHistoryEntry]) -> list[AdvisorHistoryEntry]:
        if len({entry.id for entry in value}) != len(value):
            raise ValueError("advisor history identifiers must be unique")
        return value


class ArchiveRecord(StrictModel):
    id: Required100
    createdAt: TimestampText
    updatedAt: TimestampText
    bankVersion: Required100
    catalogVersion: Required100 | None = None
    state: AssessmentState
    reportMeta: ReportMeta
    advisor: AdvisorEditing = None

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError("archive identifier has an invalid format")
        return value

    @model_validator(mode="after")
    def bounded_record(self) -> ArchiveRecord:
        if _json_utf16_length(self.model_dump(mode="json", exclude_unset=True)) > MAX_RECORD_CHARS:
            raise ValueError(f"record exceeds {MAX_RECORD_CHARS} serialized UTF-16 units")
        return self
