"""Portable school-account history, distinct from trusted server audit storage."""

import copy

import pytest
from pydantic import ValidationError

from backend.bic_api.models import ArchiveRecord
from backend.tests.test_models import record, history_entry


ACTOR = {'kind': 'school_advisor', 'user_id': '11111111-2222-4333-8444-555555555555',
         'username': 'advisor.' + 'a' * 56, 'grant_id': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
         'source_revision': 7, 'result_revision': 8}


def with_actor():
    value = record()
    value['advisor'] = {'sections': {'plan': '学校账号核对后的建议'},
                        'history': [{**history_entry(), 'author': '学校顾问', 'actor': copy.deepcopy(ACTOR)}]}
    return value


def test_school_account_actor_roundtrips_full_username_and_safe_revision_without_ai_source():
    value = with_actor()
    result = ArchiveRecord.model_validate(value).model_dump(mode='json', exclude_unset=True)
    assert result == value
    assert len(result['advisor']['history'][0]['actor']['username']) == 64
    assert 'origin' not in result['advisor']['history'][0]


def test_old_manual_history_remains_unchanged_without_an_actor():
    value = with_actor()
    del value['advisor']['history'][0]['actor']
    assert ArchiveRecord.model_validate(value).model_dump(mode='json', exclude_unset=True) == value


@pytest.mark.parametrize('actor', [
    None, {}, {**ACTOR, 'kind': 'advisor'}, {**ACTOR, 'username': 'Advisor.Name'},
    {**ACTOR, 'username': 'x'}, {**ACTOR, 'username': 'x' * 65},
    {**ACTOR, 'username': '学校老师'}, {**ACTOR, 'username': 'advisor.name\n'},
    {**ACTOR, 'user_id': 'owner'}, {**ACTOR, 'grant_id': ACTOR['grant_id'].upper()},
    {**ACTOR, 'user_id': ACTOR['user_id'] + '\n'},
    {**ACTOR, 'source_revision': True}, {**ACTOR, 'source_revision': 7.0},
    {**ACTOR, 'source_revision': 0}, {**ACTOR, 'result_revision': 7},
    {**ACTOR, 'result_revision': 9}, {**ACTOR, 'result_revision': True},
    {**ACTOR, 'source_revision': 9_007_199_254_740_991, 'result_revision': 9_007_199_254_740_992},
    {**ACTOR, 'extra': 'must not be silently dropped'},
])
def test_malformed_actor_refuses_the_entire_archive(actor):
    value = with_actor()
    value['advisor']['history'][0]['actor'] = actor
    with pytest.raises(ValidationError):
        ArchiveRecord.model_validate(value)


@pytest.mark.parametrize('action', ['reset', 'restore'])
def test_local_restore_or_reset_cannot_reuse_school_actor(action):
    value = with_actor()
    value['advisor']['history'][0]['action'] = action
    with pytest.raises(ValidationError):
        ArchiveRecord.model_validate(value)


def test_school_actor_cannot_also_claim_an_ai_draft_origin():
    value = with_actor()
    value['advisor']['history'][0]['origin'] = {
        'kind': 'local_mock', 'draft_id': '11111111-2222-4333-8444-555555555555',
        'generator': 'local-demo-v1', 'source_revision': 7}
    with pytest.raises(ValidationError):
        ArchiveRecord.model_validate(value)
