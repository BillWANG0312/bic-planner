"""Strict append-only comment values and the shared public-snapshot boundary."""

from copy import deepcopy
import importlib
import json

import pytest
from pydantic import TypeAdapter, ValidationError

from backend.tests.test_share_models import content
from backend.tests.test_sharing import record


@pytest.fixture
def values():
    try:
        return importlib.import_module('backend.bic_api.comment_models')
    except ModuleNotFoundError:
        pytest.fail('Strict comment text and request identifiers must be implemented.')


@pytest.mark.parametrize('value', [
    '请问如何安排衔接学习？', '  保留前后空白和\n换行。  ', '<img src=x onerror=alert(1)>',
    'x' * 1000, '😀' * 500, '\x85',
], ids=['chinese', 'preserved_whitespace', 'plain_html_shape', 'ascii_boundary', 'utf16_boundary', 'js_nonwhitespace'])
def test_comment_text_keeps_valid_plain_text_exactly(values, value):
    assert TypeAdapter(values.CommentText).validate_python(value) == value


@pytest.mark.parametrize('value', [
    '', ' ', '\t\n\r', '\ufeff', '\u00a0\u2028', 'x' * 1001, '😀' * 501,
    '\ud800', 'valid prefix\udfff', True, False, 1, 1.0, None, [], {},
], ids=['empty', 'space', 'ascii_blank', 'bom_blank', 'unicode_blank', 'ascii_long', 'utf16_long',
        'high_surrogate', 'low_surrogate', 'true', 'false', 'int', 'float', 'null', 'array', 'object'])
def test_comment_text_rejects_blank_oversized_invalid_unicode_and_coercion(values, value):
    with pytest.raises(ValidationError):
        TypeAdapter(values.CommentText).validate_python(value)


def test_request_identifier_accepts_canonical_uuid_and_normalizes_only_its_case(values):
    canonical = '8ce7a849-9c19-451e-b76d-a51b5f04cc12'
    adapter = TypeAdapter(values.RequestId)
    assert adapter.validate_python(canonical) == canonical
    assert adapter.validate_python(canonical.upper()) == canonical


@pytest.mark.parametrize('value', [
    '8ce7a8499c19451eb76da51b5f04cc12', '{8ce7a849-9c19-451e-b76d-a51b5f04cc12}',
    'urn:uuid:8ce7a849-9c19-451e-b76d-a51b5f04cc12',
    ' 8ce7a849-9c19-451e-b76d-a51b5f04cc12', '8ce7a849-9c19-451e-b76d-a51b5f04cc12\n',
    'gce7a849-9c19-451e-b76d-a51b5f04cc12', '8ce7a849-9c19-451e-b76da-51b5f04cc12',
    '', True, 1, None,
], ids=['compressed', 'braces', 'urn', 'leading_space', 'trailing_newline', 'nonhex', 'wrong_groups',
        'empty', 'bool', 'int', 'null'])
def test_request_identifier_rejects_noncanonical_shapes_and_nonstrings(values, value):
    with pytest.raises(ValidationError):
        TypeAdapter(values.RequestId).validate_python(value)


def snapshot_builder():
    models = importlib.import_module('backend.bic_api.share_models')
    assert hasattr(models, 'build_parent_snapshot'), 'Public share and invited discussion must reuse the same canonical snapshot builder.'
    return models.build_parent_snapshot


def test_snapshot_builder_uses_canonical_record_metadata_and_excludes_private_fields():
    source = record()
    source['owner_id'] = 'private-owner'
    source['revision'] = 999  # DB revision must be supplied separately, never copied from record input.
    supplied = content()
    before = deepcopy(source)
    result = snapshot_builder()(source, 7, 1_800_000_000, 1_800_003_600, supplied)
    assert result == {
        'format': 'bic-parent-summary', 'version': 1, 'shared_at': 1_800_000_000,
        'expires_at': 1_800_003_600,
        'report': {'name': source['state']['info']['name'], 'grade': '8', 'year': '2027 年秋季',
                   'batchId': 'AP-one', 'date': '2026年10月24日', 'bankVersion': '2026.10',
                   'catalogVersion': '2026.10.24', 'revision': 7},
        'content': supplied,
    }
    serialized = json.dumps(result)
    for private in ['private-owner', 'private-raw-answer', 'private-audit-author', 'history', 'owner_id', 'answers']:
        assert private not in serialized
    result['content']['sections']['summary'] = 'Changed output only.'
    assert supplied['sections']['summary'] != result['content']['sections']['summary']
    assert source == before


def test_snapshot_builder_keeps_the_existing_public_schema_and_optional_catalog():
    source = record()
    source.pop('catalogVersion')
    result = snapshot_builder()(source, 1, 1_800_000_000, 1_800_003_600, content())
    models = importlib.import_module('backend.bic_api.share_models')
    assert result['report']['catalogVersion'] is None
    assert models.ParentSnapshot.model_validate(result).model_dump(mode='json') == result
    assert set(result) == {'format', 'version', 'shared_at', 'expires_at', 'report', 'content'}


@pytest.mark.parametrize('field,value', [('revision', True), ('created', '1800000000'), ('expires', 1_800_000_000)])
def test_snapshot_builder_rejects_invalid_envelope_values(field, value):
    args = {'revision': 1, 'created': 1_800_000_000, 'expires': 1_800_003_600}
    args[field] = value
    with pytest.raises((ValidationError, ValueError)):
        snapshot_builder()(record(), args['revision'], args['created'], args['expires'], content())


def test_snapshot_builder_does_not_silently_drop_private_content_or_accept_missing_metadata():
    builder = snapshot_builder()
    invalid = {**content(), 'comments': ['private discussion']}
    with pytest.raises(ValidationError):
        builder(record(), 1, 1_800_000_000, 1_800_003_600, invalid)
    for source in [None, {}, {'state': {}}]:
        with pytest.raises(ValueError):
            builder(source, 1, 1_800_000_000, 1_800_003_600, content())
