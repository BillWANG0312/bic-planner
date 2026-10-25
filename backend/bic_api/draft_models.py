"""Strict contracts for de-identified advice drafts and their review metadata."""

import re
from typing import Annotated, Literal

from pydantic import AfterValidator, Field, StrictBool, StrictInt, StrictStr, model_validator

from .models import DraftGeneratorText, DraftIdText, DraftKind, DraftOrigin, PositiveSafeInteger, StrictModel
from .share_models import ShareSections


DraftSections = ShareSections
SubjectKey = Literal['english', 'maths', 'physics', 'chemistry']
DirectionId = Literal['cs', 'math', 'phys', 'eng', 'chem', 'med', 'bio', 'econ', 'biz', 'law', 'psych', 'design', 'media', 'intl']


def personality_code(value: str) -> str:
    if not re.fullmatch(r'[EI][SN][TF][JP]', value):
        raise ValueError('personality code is not supported')
    return value


def report_id(value: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('report identifier must be a safe ASCII identifier')
    return value


class DraftSubject(StrictModel):
    key: SubjectKey
    answered: Annotated[StrictInt, Field(ge=0, le=15)]
    total: Annotated[StrictInt, Field(ge=15, le=15)]
    pct: Annotated[StrictInt, Field(ge=0, le=100)] | None

    @model_validator(mode='after')
    def measured_percentage(self):
        if (self.answered < self.total and self.pct is not None
                or self.answered == self.total and self.pct is None):
            raise ValueError('only completed subjects have a measured percentage')
        return self


class DraftContext(StrictModel):
    status: Literal['draft', 'complete']
    direction_id: DirectionId
    personality_complete: StrictBool
    personality_code: Annotated[StrictStr, AfterValidator(personality_code)] | None
    subjects: Annotated[list[DraftSubject], Field(min_length=4, max_length=4)]

    @model_validator(mode='after')
    def consistent_context(self):
        if len({subject.key for subject in self.subjects}) != 4:
            raise ValueError('the four subjects must be unique')
        if self.status == 'complete' and any(subject.answered < subject.total for subject in self.subjects):
            raise ValueError('complete reports must have completed academic subjects')
        if self.status == 'complete' and not self.personality_complete:
            raise ValueError('complete reports must have completed personality profiles')
        if not self.personality_complete and self.personality_code is not None:
            raise ValueError('incomplete personality profiles cannot have a code')
        return self


class DraftResponse(StrictModel):
    id: DraftIdText
    report_id: Annotated[StrictStr, AfterValidator(report_id)]
    source_revision: PositiveSafeInteger
    created_at: PositiveSafeInteger
    expires_at: PositiveSafeInteger
    kind: DraftKind
    generator: DraftGeneratorText
    reason: Literal['generated', 'disabled', 'unavailable', 'timeout', 'invalid', 'busy', 'failed']
    before: DraftSections
    sections: DraftSections

    @model_validator(mode='after')
    def expiry_follows_creation(self):
        if self.expires_at <= self.created_at:
            raise ValueError('expiry must follow draft creation')
        return self
