"""Strict saved-response records; browser rules generate reports and recommendations.

Optional academic summary v2 uses a separate generated backend scoring snapshot;
this archive schema remains an input/shape boundary, not certified school marks.

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

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictInt, StrictStr, ValidationError, field_validator, model_validator

from . import current_profile


ASSESSMENT_SCHEMA = json.loads(
    (Path(__file__).resolve().parents[1] / "assessment-schema.json").read_text(encoding="utf-8")
)
ACADEMIC_QUESTIONS = {question["id"]: question for question in ASSESSMENT_SCHEMA["academic"]}
PLAN_QUESTIONS = {question["key"]: question for question in ASSESSMENT_SCHEMA["plan"]}
MAX_RECORD_CHARS = 2_000_000
# 旧版冻结问卷的版本号；旧版标记只说明来源版本，不触发换算。
LEGACY_PROFILE = "legacy-2026.10"

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


def stored_record(value: Any) -> dict[str, Any]:
    """校验一份报告并返回要保存的存档（旧版兼容形状）。

    当前标记的请求、以及带当前版本独有形状（{value, ms} 特质题、分格 / 搭档）的请求先按 _to_legacy 换算，
    换算结果保存为旧版兼容形状；读取时 map_to_current 再换回当前形状并补上标记。旧版标记只说明写入方，
    去掉后按旧版存档保存；不带标记的记录同样先看作答形状（读取接口回显的当前形状记录按同样的方式换算）。
    性格作答按旧版 24 题整数数组校验，并在模型校验前给出原有的错误措辞，其余字段由归档模型负责。
    """
    if value.get("assessmentProfile") == current_profile.LEGACY_PROFILE:
        value = {key: item for key, item in value.items() if key != "assessmentProfile"}
    value = _to_legacy(value)
    state = value.get("state") if isinstance(value, dict) else None
    # 只要不是当前形状（整数数组）的作答已在校验前被拒绝；换算后的整数数组再按旧版长度检查一次。
    if isinstance(state, dict) and isinstance(state.get("mbti"), dict) \
            and all(item is None or type(item) in (int, float) for item in state["mbti"].get("answers") or []):
        current_profile.unanswered(state["mbti"].get("answers"))
    try:
        record = ArchiveRecord.model_validate(value)
    except ValidationError as error:
        # 模型错误里带着请求内容，这里只保留字段路径，沿用旧版拒绝措辞。
        fields = ", ".join(".".join(str(part) for part in item["loc"]) for item in error.errors())
        raise current_profile.AnswerError(f"invalid record: {fields}") from None
    # 版本标记只说明写入方，不进存档；旧版兼容形状的存档读取时由 map_to_current 判断要不要补当前标记。
    return {key: item for key, item in record.model_dump(mode="json", exclude_unset=True).items()
            if key != "assessmentProfile"}


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


# 当前版本的规划作答：报告素材字段随后被换算成旧版兼容字段保存（见 current_profile.py）。
# 当前版本的规划素材：分格、搭档与专业意向由兴趣生成，不逐项对照旧版选项。
CURRENT_PLAN_ANSWERS = {
    "subjectBoard": lambda answer: current_profile.lanes(answer, "campus"),
    "majorBoard": lambda answer: current_profile.lanes(answer, "planet"),
    "team": current_profile.race,
    "career": current_profile.career,
    "preferredMajor": current_profile.derived_majors,
}


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
    # 当前版本读取返回的规划素材；读取到的形状原样写回时一并接受。
    subjectBoard: Any = None
    majorBoard: Any = None
    team: Any = None

    @model_validator(mode="before")
    @classmethod
    def valid_answers(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("planning answers must be an object")
        for key, answer in value.items():
            if key in CURRENT_PLAN_ANSWERS:
                CURRENT_PLAN_ANSWERS[key](answer)
                continue
            question = PLAN_QUESTIONS.get(key)
            if question is None:
                raise ValueError("unknown planning question")
            # 当前版本的团队搭档写进 groupSize（partner:<搭档>），不按旧版单选选项校验；旧版规模照旧。
            if key == "groupSize" and current_profile.partner_value(answer):
                continue
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
    # 旧版 24 题整数与当前版本 30 道特质题 {value, ms} 共用；长度上限由 valid_answers 分别检查。
    answers: list[float | None | dict[str, Any]]

    @field_validator("answers", mode="before")
    @classmethod
    def valid_answers(cls, value: Any) -> list[Any]:
        # 旧版存档是整数数组，原样保留（只剩 null 的旧版存档不能补成 30 项）；当前版本的
        # 30 道特质题 {value, ms} 在这里一并接受，换算成前 24 题分数保存，读取时再还原。
        if isinstance(value, list) and all(answer is None or isinstance(answer, dict) for answer in value):
            if any(isinstance(answer, dict) for answer in value):
                return current_profile.archival_answer(value)
            return list(value)
        return current_profile.unanswered(value)


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


DraftKind = Literal["rule", "local_mock", "provider"]
PositiveSafeInteger = Annotated[StrictInt, Field(ge=1, le=9_007_199_254_740_991)]


def canonical_draft_id(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value):
        raise ValueError("draft identifier must be a canonical UUID")
    return value


def safe_generator(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", value):
        raise ValueError("generator must be a safe ASCII identifier")
    return value


DraftIdText = Annotated[StrictStr, AfterValidator(canonical_draft_id)]
DraftGeneratorText = Annotated[StrictStr, AfterValidator(safe_generator)]


class DraftOrigin(StrictModel):
    """Source of one human-reviewed edit, separate from the human author's identity."""

    kind: DraftKind
    draft_id: DraftIdText
    generator: DraftGeneratorText
    source_revision: PositiveSafeInteger


def canonical_actor_username(value: str) -> str:
    if not re.fullmatch(r"[a-z0-9._@+\-]{3,64}", value, re.ASCII):
        raise ValueError("school actor username must be canonical")
    return value


class SchoolAdvisorActor(StrictModel):
    """Portable attribution; trusted write evidence lives in server audit rows."""

    kind: Literal["school_advisor"]
    user_id: DraftIdText
    username: Annotated[StrictStr, AfterValidator(canonical_actor_username)]
    grant_id: DraftIdText
    source_revision: PositiveSafeInteger
    result_revision: PositiveSafeInteger

    @model_validator(mode="after")
    def one_revision_write(self) -> SchoolAdvisorActor:
        if self.result_revision != self.source_revision + 1:
            raise ValueError("school edit must advance exactly one revision")
        return self


class AdvisorHistoryEntry(StrictModel):
    id: Required100
    at: TimestampText
    author: AuthorText
    section: Section
    before: BeforeText
    after: SectionText
    action: Literal["edit", "reset", "restore"]
    reportId: Required100
    origin: DraftOrigin = None
    actor: SchoolAdvisorActor = None

    @model_validator(mode="after")
    def school_actor_is_an_edit(self) -> AdvisorHistoryEntry:
        if self.actor is not None and (self.action != 'edit' or self.origin is not None):
            raise ValueError("school actor records a manual server edit without draft provenance")
        return self


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
    # 客户端按报告自身版本在顶层带上标记；读取时一律摘掉。由当前版本换算而来的旧版兼容存档
    # 也带当前标记，读取时换回当前形状；旧版标记只是说明写成时的版本，原样保存。
    assessmentProfile: Literal[LEGACY_PROFILE, current_profile.CURRENT_PROFILE] | None = None

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


def _legacy_plan(answers: dict[str, Any]) -> dict[str, Any]:
    """规划作答 → 旧版兼容键：团队竞速写成 timeStyle / groupSize，其余原样保存。

    当前版本提交时带 team；读取接口回显的记录只有 timeStyle / groupSize，先按旧法换回团队竞速。
    写回时沿用记录自己的竞速作答：只改一项时（页面里按未作答显示）整题去掉旧版键，
    不留下另一份作答；一项都没作答时才用旧法换回的作答。
    """
    answers = dict(answers)
    stored = current_profile.plan_for_current(answers).get("team") if "team" not in answers else None
    came_from_legacy = "team" not in answers and bool(stored)
    team = answers.pop("team", {})
    if isinstance(team, dict) and (team.get("pace") or team.get("partner")):
        race = team
    else:
        race = stored or team
    # 当前版本的团队题不进存档：旧版引擎不认 team，读取时由 timeStyle / groupSize 换回当前形状。
    answers.pop("timeStyle", None)
    answers.pop("groupSize", None)
    if not isinstance(race, dict) or not race.get("pace") or not race.get("partner"):
        # 节奏与搭档都选了才算作答（与页面 isAnswered 一致）；只选一项的整题按未作答保存。
        return answers
    answers["timeStyle"] = race["pace"]
    answers["groupSize"] = "partner:" + race["partner"]
    if came_from_legacy:
        # 旧法只在节奏属于当前版本时才认得这份作答；认不出时不能拿另一份作答替换。
        restored = current_profile.plan_for_current(answers).get("team") or {}
        if restored.get("pace") != race["pace"] or restored.get("partner") != race["partner"]:
            answers.pop("timeStyle", None)
            answers.pop("groupSize", None)
    current_profile.race(race)
    return answers


def _to_legacy(value: dict[str, Any]) -> dict[str, Any]:
    """当前版本的作答换算成旧版兼容存档：30 道特质题写成旧版 24 题整数，团队竞速写成
    timeStyle / groupSize；规划题（分格、靶环、兴趣、专业意向）当前版本与旧版同键，原样保存。
    规格外多出的字段与版本标记都先去掉。旧版作答原样返回（只去掉标记）。
    """
    return to_legacy_record(value)[0]


def to_legacy_record(value: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """换算成旧版兼容存档，并说明这份记录是否按当前版本写出（读取时要换回当前形状并补标记）。

    请求带着当前标记、或作答带当前版本独有的形状（分格 / 靶环 / 搭档、特质题 {value, ms}、
    按题目顺序排列的兴趣与专业意向）时按当前版本换算；其余旧版作答原样返回、不算当前版本。
    """
    current = value.get("assessmentProfile") == current_profile.CURRENT_PROFILE
    state = value.get("state")
    if isinstance(state, dict):
        # 没带标记的请求按作答形状判断：带当前版本独有的规划形状或 {value, ms} 特质题。
        mbti = state.get("mbti")
        answers = mbti.get("answers") if isinstance(mbti, dict) else None
        current = current or _current_plan_shape(state) \
            or isinstance(answers, list) and any(isinstance(item, dict) for item in answers)
    # 当前版本换算出的整数特质题是原始分值：不带标记的请求也按同向分数保存（见下方说明）。
    converted = value.get("assessmentProfile") != current_profile.CURRENT_PROFILE
    if not current:
        return {key: item for key, item in value.items() if key != "assessmentProfile"}, False
    result = {key: item for key, item in value.items() if key != "assessmentProfile"}
    # 账号接口只收作答与资料：报告、界面位置和记录里重复的标记都是浏览器报告引擎带来的，不写入存档。
    state = {key: item for key, item in (value.get("state") or {}).items()
             if key not in DERIVED_STATE_KEYS}
    plan = state.get("plan")
    if isinstance(plan, dict) and isinstance(plan.get("answers"), dict):
        answers = _legacy_plan(plan["answers"])
        # 旧版存档契约里的规划字段都是旧版题目 id；不是旧版题目的值原样保留，旧版引擎按未作答处理。
        state["plan"] = {**plan, "answers": answers}
    mbti = state.get("mbti")
    if isinstance(mbti, dict) and isinstance(mbti.get("answers"), list) \
            and all(item is None or isinstance(item, dict) for item in mbti["answers"]):
        # 当前版本的 30 道特质题 {value, ms} 存成旧版 24 题整数；未作答的位置存 null。
        # 整数是旧版形状的作答；当前版本提交的整数仍是原始分值，按特性题换算（反向题翻转）
        # 成旧版同向分数。读取接口回显的整数也走同一换算：回显的分数由这份换算算出，
        # 再换算一次得到同样的整数。
        traits = mbti["answers"]
        answers = traits if not converted and traits \
            and all(type(item) in (int, float) for item in traits if item is not None) \
            else current_profile.traits_from_answers([None if type(item) in (int, float) else item for item in traits])
        state["mbti"] = {**mbti, "answers": answers}
    result["state"] = state
    # 换算后的作答是旧版兼容形状（不带标记），读取时由 map_to_current 换回当前形状并补上标记。
    return result, True


# 由测验生成、不进账号存档的状态字段：报告、界面位置与作答里重复的版本标记。
DERIVED_STATE_KEYS = ("report", "ui", "assessmentProfile")


def map_to_current(value: dict[str, Any]) -> dict[str, Any]:
    """读取存档：旧版 24 题整数换回 30 道特质题、旧版团队作答换回团队竞速，并带上当前标记。

    规划题当前版本与旧版同键，原样读回；旧版存档原样返回、不带标记，由旧版引擎接手。
    """
    before = value.get("state") or {}
    result = {key: item for key, item in value.items() if key != "assessmentProfile"}
    state = dict(before)
    plan = state.get("plan")
    answers = plan.get("answers") if isinstance(plan, dict) else None
    mapped = current_profile.plan_for_current(answers) if isinstance(answers, dict) else None
    if mapped is not None:
        state["plan"] = {**plan, "answers": mapped}
    mbti = state.get("mbti")
    traits = mbti.get("answers") if isinstance(mbti, dict) else None
    # 有分数的整数数组是当前版本换算保存的存档（旧版引擎保存的是 {value, ms}）：换回特质题并带上当前标记。
    # 一项都没作答时当前版本整份存 30 个空位、旧版存 24 项以内：按存档里的空位数认出版本（与页面一致）。
    current = isinstance(traits, list) and not any(isinstance(item, dict) for item in traits) \
        and (any(item is not None for item in traits) or len(traits) > 24)
    plan_changed = "plan" in state and state["plan"] != before.get("plan")
    if current:
        state["mbti"] = {**mbti, "answers": current_profile.stored_traits(traits)}
    elif plan_changed and _current_plan_shape(before):
        # 旧版规划作答换回成另一份旧版作答时不带标记（读-改-写会改掉它的规划作答）；
        # 只有分格 / 靶环 / 搭档这类当前版本独有形状才整份按当前版本读出（特质题一并补成 30 道）。
        current = True
        if isinstance(traits, list) and not any(isinstance(item, dict) for item in traits):
            # 存档里的特质题仍是整数（例如还没存过分数）：按 30 道特质题补全。
            state["mbti"] = {**mbti, "answers": current_profile.stored_traits(traits)}
    # 规划作答没有换算时，只有整份都当作当前版本写出的存档才补标记（待作答的整数数组在旧版里也可能出现）。
    if not current:
        return result
    result["state"] = state
    result["assessmentProfile"] = current_profile.CURRENT_PROFILE
    return result


# 当前版本独有的规划键：存档里出现这些键只可能由当前版本写出。
CURRENT_PLAN_KEYS = ("subjectBoard", "majorBoard", "team")


def _current_plan_shape(state: dict[str, Any]) -> bool:
    """规划作答是否带当前版本独有的形状（与页面 identify 的当前版本证据一致）。

    旧版只有 interests / preferredMajor / schoolSubjects / weakSubjects / career / countries 等题；
    分格、靶环、搭档，以及按题目顺序排列或带当前版本专业编号的专业意向都是当前版本写出的。
    """
    plan = state.get("plan")
    answers = plan.get("answers") if isinstance(plan, dict) else None
    if not isinstance(answers, dict):
        return False
    if any(key in answers for key in CURRENT_PLAN_KEYS):
        return True
    for key in ("interests", "preferredMajor"):
        value = answers.get(key)
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            continue
        options = list(PLAN_QUESTIONS[key]["options"])
        # 按题目顺序排列（不重复）的作答只出自当前版本的界面；旧版多选不保证顺序，按旧版读回。
        if value and not any(item not in options for item in value) and value == sorted(value, key=options.index):
            return True
    return False


def legacy_record(record: dict[str, Any]) -> dict[str, Any] | None:
    """读取到的存档 → 要写回的旧版兼容存档；旧版形状的存档返回 None。

    旧版兼容形状的存档原样写回（返回 None 表示无需换算）；读取接口换回的当前形状（规划题里带着分格 /
    团队竞速、特质题是 {value, ms}）按当前标记重新换算。
    """
    try:
        ArchiveRecord.model_validate(record)
        return None
    except ValidationError:
        pass
    try:
        # 读取接口回显的当前形状记录的规划作答按当前形状校验过：换算后重读必须还是当前形状，
        # 否则说明改动写进了旧版独有的键（例如把 team 拆成 timeStyle / groupSize），写回会读出另一份作答。
        converted = stored_record({**record, "assessmentProfile": current_profile.CURRENT_PROFILE})
    except current_profile.AnswerError:
        # 也不是旧版能接受的作答：交给存档层按原来的方式校验并报错（例如旧版形状里不合规格的字段）。
        return None
    if map_to_current(converted).get("assessmentProfile") != current_profile.CURRENT_PROFILE:
        raise ValueError("record changed plan answers when stored")
    return converted
