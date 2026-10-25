"""Plain-text comments and normalized request IDs, without type coercion."""

import re
from typing import Annotated

from pydantic import AfterValidator, StrictStr

from .models import bounded_text


_UUID = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z', re.ASCII)


def _comment_text(value: str) -> str:
    bounded_text(1000, required=True)(value)
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise ValueError('comment must contain valid Unicode characters') from None
    return value


def _request_id(value: str) -> str:
    if not _UUID.fullmatch(value):
        raise ValueError('request identifier must be a canonical UUID string')
    return value.lower()


CommentText = Annotated[StrictStr, AfterValidator(_comment_text)]
RequestId = Annotated[StrictStr, AfterValidator(_request_id)]
