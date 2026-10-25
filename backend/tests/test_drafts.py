"""Private, bounded previews and human-approved CAS writes; no remote model."""

from concurrent.futures import ThreadPoolExecutor
import copy
import importlib
import json
import threading
import uuid

import pytest

from backend.bic_api.db import Database, StorageError
from backend.bic_api.settings import Settings


KEYS = ['summary', 'academic', 'plan', 'personality']


class Clock:
    def __init__(self):
        self.now = 1_800_000_000

    def __call__(self):
        return self.now


def record(index='one', history=0, size=1):
    value = {
        'id': 'local-' + index, 'createdAt': '2026-10-24T00:00:00.000Z',
        'updatedAt': '2026-10-24T00:00:00.000Z', 'bankVersion': '2026.10', 'catalogVersion': '2026.10.24',
        'state': {'info': {'name': 'private-student', 'grade': '8', 'year': '2027'},
                  'academic': {'answers': {'ph3': 3}}, 'plan': {'answers': {'grade': '8'}},
                  'mbti': {'answers': [None] * 24}},
        'reportMeta': {'batchId': 'AP-' + index, 'date': '2026年10月24日'},
    }
    if history:
        value['advisor'] = {'sections': {}, 'history': [
            {'id': str(uuid.uuid4()), 'at': '2026-10-24T00:00:00.000Z', 'author': '历史老师',
             'section': 'summary', 'before': 'x' * size, 'after': 'y' * size,
             'action': 'edit', 'reportId': 'AP-' + index}
            for _ in range(history)
        ]}
    return value


def context():
    return {'status': 'draft', 'direction_id': 'cs', 'personality_complete': False,
            'personality_code': None, 'subjects': [
                {'key': key, 'answered': 0, 'total': 15, 'pct': None}
                for key in ['english', 'maths', 'physics', 'chemistry']]}


def fallback():
    return {key: '当前已核对建议：' + key for key in KEYS}


class Provider:
    generator = 'approved-test-v1'

    def __init__(self, callback=None):
        self.contexts = []
        self.callback = callback

    def propose(self, value):
        self.contexts.append(copy.deepcopy(value))
        if self.callback:
            return self.callback(value)
        return {key: '待人工核对的文字：' + key for key in KEYS}


@pytest.fixture
def services(tmp_path):
    try:
        cls = importlib.import_module('backend.bic_api.drafts').AdviceDraftService
    except ModuleNotFoundError:
        pytest.fail('Bounded optional advice draft service has not been implemented.')
    clock = Clock()
    db = Database(tmp_path / 'private.sqlite3', clock=clock)
    owner = db.create_user('owner', 'not-a-login-hash', 'advisor')['id']
    other = db.create_user('other', 'not-a-login-hash', 'student')['id']
    saved = db.create_report(owner, record())
    return cls, db, owner, other, saved, clock


def create(service, owner, saved, **changes):
    return service.create(owner, saved['id'], changes.get('revision', saved['revision']),
                          changes.get('contextdict', context()), changes.get('fallbackdict', fallback()))


def test_default_disabled_never_calls_provider_and_rule_fallback_is_exact_and_private(services):
    cls, db, owner, _, saved, clock = services
    provider = Provider(lambda _: pytest.fail('Disabled mode called a provider'))
    service = cls(db, provider=provider, clock=clock)
    before = fallback()
    before['summary'] = 'private-student current confidential advisor text'
    draft = create(service, owner, saved, fallbackdict=before)
    assert draft['kind'] == 'rule' and draft['reason'] == 'disabled'
    assert draft['before'] == draft['sections'] == before
    assert draft['expires_at'] - draft['created_at'] == 900
    assert provider.contexts == []
    assert db.get_report(owner, saved['id']) == saved
    draft['sections']['summary'] = 'client tampering'
    unchanged = service.apply(owner, saved['id'], draft['id'], ['summary'], '审核老师')
    assert unchanged == saved
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '审核老师')
    assert error.value.status_code == 409 and error.value.code == 'DRAFT_APPLIED'


def test_provider_context_never_contains_name_free_notes_answers_or_report_identifiers(services):
    cls, db, owner, _, saved, clock = services
    provider = Provider()
    service = cls(db, mode='provider', provider=provider, clock=clock)
    before = fallback()
    before['summary'] = 'private-student private-student-notes AP-one'
    source_context = context()
    draft = create(service, owner, saved, contextdict=source_context, fallbackdict=before)
    assert provider.contexts == [source_context]
    serialized = json.dumps(provider.contexts)
    for forbidden in ['private-student', 'notes', 'AP-one', saved['id'], owner, 'answers', 'fallback']:
        assert forbidden not in serialized
    assert draft['kind'] == 'provider' and draft['reason'] == 'generated'
    assert draft['generator'] == provider.generator
    assert draft['before'] == before


def test_local_mock_is_explicit_and_apply_changes_selected_text_only_with_provenance(services):
    cls, db, owner, _, saved, clock = services
    provider = Provider(lambda _: pytest.fail('Local mock called external provider'))
    service = cls(db, mode='local_mock', provider=provider, clock=clock)
    draft = create(service, owner, saved)
    assert draft['kind'] == 'local_mock' and draft['reason'] == 'generated'
    assert 'local' in draft['generator']
    assert provider.contexts == []
    updated = service.apply(owner, saved['id'], draft['id'], ['summary', 'plan'], '审核老师')
    assert updated['revision'] == 2
    assert updated['record']['state'] == saved['record']['state']
    assert updated['record']['reportMeta'] == saved['record']['reportMeta']
    assert updated['record']['bankVersion'] == saved['record']['bankVersion']
    assert set(updated['record']['advisor']['sections']) == {'summary', 'plan'}
    history = updated['record']['advisor']['history']
    assert len(history) == 2
    for entry in history:
        assert entry['author'] == '审核老师' and entry['action'] == 'edit'
        assert entry['before'] == fallback()[entry['section']]
        assert entry['after'] == draft['sections'][entry['section']].strip()
        assert entry['origin'] == {'kind': 'local_mock', 'draft_id': draft['id'],
                                   'generator': draft['generator'], 'source_revision': 1}


@pytest.mark.parametrize('bad', [None, {}, {'summary': 'only one'},
                                 {**fallback(), 'secret': 'private-token'},
                                 {**fallback(), 'plan': True}, {**fallback(), 'plan': 'x' * 4001}])
def test_invalid_provider_output_returns_original_rules_without_echoing_values(services, bad):
    cls, db, owner, _, saved, clock = services
    provider = Provider(lambda _: bad)
    draft = create(cls(db, mode='provider', provider=provider, clock=clock), owner, saved)
    assert draft['kind'] == 'rule' and draft['reason'] == 'invalid'
    assert draft['sections'] == fallback()
    assert 'private-token' not in json.dumps(draft)


def test_missing_or_failing_provider_falls_back_without_returning_exception_secrets(services):
    cls, db, owner, _, saved, clock = services
    missing = create(cls(db, mode='provider', clock=clock), owner, saved)
    assert missing['reason'] == 'unavailable' and missing['sections'] == fallback()

    def fail(_):
        raise RuntimeError('private-provider-key')

    failed = create(cls(db, mode='provider', provider=Provider(fail), clock=clock), owner, saved)
    assert failed['kind'] == 'rule' and failed['reason'] == 'failed'
    assert 'private-provider-key' not in json.dumps(failed)


def test_hung_provider_tasks_are_bounded_and_recover_without_blocking_application_exit(services):
    cls, db, owner, _, saved, clock = services
    gate = threading.Event()
    calls = []

    def wait(_):
        calls.append(threading.current_thread())
        gate.wait(timeout=5)
        return {key: 'bounded task result ' + key for key in KEYS}

    service = cls(db, mode='provider', provider=Provider(wait), clock=clock, timeout_seconds=.02)
    try:
        first, second = create(service, owner, saved), create(service, owner, saved)
        third = create(service, owner, saved)
        assert first['reason'] == second['reason'] == 'timeout'
        assert third['reason'] == 'busy'
        assert len(calls) == 2 and all(worker.daemon for worker in calls)
        assert all(value['sections'] == fallback() for value in [first, second, third])
    finally:
        gate.set()
        for worker in calls:
            worker.join(timeout=1)
    recovered = create(service, owner, saved)
    assert recovered['kind'] == 'provider' and recovered['reason'] == 'generated'


def test_provider_cannot_mutate_callers_context_or_rule_fallback(services):
    cls, db, owner, _, saved, clock = services
    value, before = context(), fallback()

    def mutate(ctx):
        ctx['subjects'][0]['answered'] = 15
        ctx['injected'] = 'do not retain'
        return {key: 'new ' + key for key in KEYS}

    create(cls(db, mode='provider', provider=Provider(mutate), clock=clock), owner, saved,
           contextdict=value, fallbackdict=before)
    assert value == context() and before == fallback()


def test_foreign_unknown_disabled_and_deleted_sources_never_create_or_apply_drafts(services):
    cls, db, owner, other, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    with pytest.raises(StorageError) as error:
        create(service, other, saved)
    assert error.value.status_code == 404
    draft = create(service, owner, saved)
    with pytest.raises(StorageError) as error:
        service.apply(other, saved['id'], draft['id'], ['summary'], '他人')
    assert error.value.status_code == 404
    db.disable_user('owner')
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 404


def test_source_revision_is_checked_before_and_after_provider_generation(services):
    cls, db, owner, _, saved, clock = services
    provider = Provider()
    service = cls(db, mode='provider', provider=provider, clock=clock)
    with pytest.raises(StorageError) as error:
        create(service, owner, saved, revision=2)
    assert error.value.status_code == 409 and provider.contexts == []
    changed = False

    def update_source(_):
        nonlocal changed
        if not changed:
            changed = True
            db.update_report(owner, saved['id'], saved['record'], 1)
        return {key: 'new ' + key for key in KEYS}

    service = cls(db, mode='provider', provider=Provider(update_source), clock=clock)
    with pytest.raises(StorageError) as error:
        create(service, owner, saved)
    assert error.value.code == 'REVISION'
    current = db.get_report(owner, saved['id'])
    for _ in range(5):
        create(service, owner, current)


def test_apply_rejects_stale_revision_without_overwriting_record(services):
    cls, db, owner, _, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    updated = copy.deepcopy(saved['record'])
    updated['state']['info']['name'] = 'other-device-update'
    current = db.update_report(owner, saved['id'], updated, 1)
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 409 and error.value.code == 'REVISION'
    assert db.get_report(owner, saved['id']) == current


def test_expiry_and_applied_tombstones_are_private_and_contain_no_text(services):
    cls, db, owner, other, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    clock.now += 900
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 409 and error.value.code == 'DRAFT_EXPIRED'
    with pytest.raises(StorageError) as error:
        service.apply(other, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 404
    assert db.get_report(owner, saved['id']) == saved
    clock.now += 901
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 404


@pytest.mark.parametrize('sections,reviewer', [([], '老师'), (['summary', 'summary'], '老师'),
                                              (['other'], '老师'), ('summary', '老师'),
                                              (['summary'], ''), (['summary'], '😀' * 21),
                                              (['summary'], 'bad-\ud800')])
def test_explicit_section_selection_and_valid_reviewer_are_required(services, sections, reviewer):
    cls, db, owner, _, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], sections, reviewer)
    assert error.value.status_code == 422
    assert db.get_report(owner, saved['id']) == saved


def test_history_limit_is_atomic_and_never_discards_old_audit(services):
    cls, db, owner, _, _, clock = services
    saved = db.create_report(owner, record('history', history=200))
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 413
    assert db.get_report(owner, saved['id']) == saved


def test_storage_quota_failure_preserves_source_and_unconsumed_draft(services):
    cls, db, owner, _, saved, clock = services
    large = record('large', history=200, size=4000)
    filler = record('filler', history=200, size=1)
    db.create_report(owner, large)

    def units(value):
        return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-16-le')) // 2

    available = 2_000_000 - units(saved['record']) - units(large)
    lower, upper = 1, 4000
    while lower < upper:
        middle = (lower + upper + 1) // 2
        for entry in filler['advisor']['history']:
            entry['before'] = 'x' * middle
            entry['after'] = 'y' * middle
        if units(filler) <= available:
            lower = middle
        else:
            upper = middle - 1
    for entry in filler['advisor']['history']:
        entry['before'] = 'x' * lower
        entry['after'] = 'y' * lower
    added = db.create_report(owner, filler)
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], KEYS, '老师')
    assert error.value.status_code == 413
    assert db.get_report(owner, saved['id']) == saved
    db.delete_report(owner, added['id'], 1)
    assert service.apply(owner, saved['id'], draft['id'], KEYS, '老师')['revision'] == 2


def test_owner_quota_rejects_sixth_without_evicting_existing_active_draft(services):
    cls, db, owner, _, saved, clock = services
    service = cls(db, clock=clock)
    drafts = [create(service, owner, saved) for _ in range(5)]
    with pytest.raises(StorageError) as error:
        create(service, owner, saved)
    assert error.value.status_code == 413
    assert service.apply(owner, saved['id'], drafts[0]['id'], ['summary'], '老师') == saved
    assert create(service, owner, saved)['id'] not in {value['id'] for value in drafts}


def test_global_quota_rejects_201st_without_evicting_other_accounts(services):
    cls, db, owner, _, saved, clock = services
    service = cls(db, clock=clock)
    first = create(service, owner, saved)
    for index in range(40):
        account = db.create_user('quota-' + str(index), 'not-a-login-hash', 'student')['id']
        stored = db.create_report(account, record('quota-' + str(index)))
        for _ in range(4 if index == 39 else 5):
            create(service, account, stored)
    with pytest.raises(StorageError) as error:
        create(service, owner, saved)
    assert error.value.status_code == 413 and error.value.code == 'LIMIT'
    assert service.apply(owner, saved['id'], first['id'], ['summary'], '老师') == saved
    create(service, owner, saved)


def test_inflight_generations_reserve_capacity_before_provider_returns(services):
    cls, db, owner, _, saved, clock = services
    entered, gate = threading.Event(), threading.Event()
    counter_lock = threading.Lock()
    count = 0

    def blocked(_):
        nonlocal count
        with counter_lock:
            count += 1
            if count == 2:
                entered.set()
        gate.wait(timeout=5)
        return {key: 'review this ' + key for key in KEYS}

    service = cls(db, mode='provider', provider=Provider(blocked), clock=clock, timeout_seconds=2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(create, service, owner, saved) for _ in range(2)]
        try:
            assert entered.wait(timeout=1)
            for _ in range(3):
                assert create(service, owner, saved)['reason'] == 'busy'
            with pytest.raises(StorageError) as error:
                create(service, owner, saved)
            assert error.value.status_code == 413
        finally:
            gate.set()
        assert all(future.result()['kind'] == 'provider' for future in pending)


@pytest.mark.parametrize('generator', ['unsafe/provider', 'x' * 81, '私有服务', True, None, 'line\n'])
def test_unsafe_provider_identifiers_never_enter_responses_or_audit(services, generator):
    cls, db, owner, _, saved, clock = services
    provider = Provider()
    provider.generator = generator
    draft = create(cls(db, mode='provider', provider=provider, clock=clock), owner, saved)
    assert draft['kind'] == 'rule' and draft['reason'] == 'invalid'
    assert draft['generator'] == 'rules-v1' and draft['sections'] == fallback()
    assert provider.contexts == []


@pytest.mark.parametrize('changes', [{'name': 'private-student'}, {'direction_id': 'free-text'},
                                     {'personality_complete': 'yes'}, {'status': 'complete'}])
def test_invalid_context_is_rejected_before_provider_calls_or_capacity_reservation(services, changes):
    cls, db, owner, _, saved, clock = services
    provider = Provider()
    service = cls(db, mode='provider', provider=provider, clock=clock)
    for _ in range(6):
        with pytest.raises(StorageError) as error:
            create(service, owner, saved, contextdict={**context(), **changes})
        assert error.value.status_code == 422
    assert provider.contexts == []
    assert create(service, owner, saved)['kind'] == 'provider'


def test_deleted_and_corrupt_sources_are_rejected_without_leaking_saved_text(services):
    cls, db, owner, _, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    db.delete_report(owner, saved['id'], 1)
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 404
    corrupt = db.create_report(owner, record('corrupt'))
    with db._transaction() as connection:
        connection.execute('UPDATE reports SET record_json = ? WHERE id = ?',
                           ('{"private-student-secret":', corrupt['id']))
    with pytest.raises(StorageError) as error:
        create(service, owner, corrupt)
    assert error.value.status_code == 503 and 'private-student-secret' not in str(error.value)


def test_source_is_rechecked_before_applying_even_when_database_cas_loses(services, monkeypatch):
    cls, db, owner, _, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    update_report = db.update_report

    def racing_update(owner_id, identifier, proposal, revision):
        changed = copy.deepcopy(saved['record'])
        changed['state']['info']['name'] = 'external-race-winner'
        update_report(owner_id, identifier, changed, revision)
        return update_report(owner_id, identifier, proposal, revision)

    monkeypatch.setattr(db, 'update_report', racing_update)
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 409 and error.value.code == 'REVISION'
    current = db.get_report(owner, saved['id'])
    assert current['record']['state']['info']['name'] == 'external-race-winner'
    assert 'advisor' not in current['record']


def test_account_disabled_between_ownership_read_and_cas_cannot_receive_an_advice_write(services, monkeypatch):
    cls, db, owner, _, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)
    update_report = db.update_report

    def disabled_before_cas(owner_id, identifier, proposal, revision):
        db.disable_user('owner')
        return update_report(owner_id, identifier, proposal, revision)

    monkeypatch.setattr(db, 'update_report', disabled_before_cas)
    with pytest.raises(StorageError) as error:
        service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert error.value.status_code == 404
    assert db.get_report(owner, saved['id']) == saved


def test_saved_advisor_text_must_match_before_preview_and_becomes_server_audit_before(services):
    cls, db, owner, _, saved, clock = services
    original = copy.deepcopy(saved['record'])
    original['advisor'] = {'sections': {'summary': '服务器保存的人工建议'}, 'history': []}
    saved = db.update_report(owner, saved['id'], original, 1)
    provider = Provider()
    service = cls(db, mode='provider', provider=provider, clock=clock)
    for _ in range(6):
        with pytest.raises(StorageError) as error:
            create(service, owner, saved)
        assert error.value.status_code == 422
    assert provider.contexts == []
    before = {**fallback(), 'summary': original['advisor']['sections']['summary']}
    draft = create(service, owner, saved, fallbackdict=before)
    updated = service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert updated['record']['advisor']['history'][0]['before'] == original['advisor']['sections']['summary']


def test_only_whitespace_changes_and_exact_rule_fallback_are_noops(services):
    cls, db, owner, _, saved, clock = services
    original = copy.deepcopy(saved['record'])
    original['advisor'] = {'sections': {'summary': '  顾问建议  '}, 'history': []}
    saved = db.update_report(owner, saved['id'], original, 1)
    before = {**fallback(), 'summary': original['advisor']['sections']['summary']}
    disabled = cls(db, clock=clock)
    draft = create(disabled, owner, saved, fallbackdict=before)
    assert disabled.apply(owner, saved['id'], draft['id'], ['summary'], '老师') == saved
    provider = Provider(lambda _: {**fallback(), 'summary': '顾问建议'})
    service = cls(db, mode='provider', provider=provider, clock=clock)
    draft = create(service, owner, saved, fallbackdict=before)
    updated = service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
    assert updated == saved


def test_concurrent_applications_write_once_and_keep_revision_cas(services):
    cls, db, owner, _, saved, clock = services
    service = cls(db, mode='local_mock', clock=clock)
    draft = create(service, owner, saved)

    def apply():
        try:
            return service.apply(owner, saved['id'], draft['id'], ['summary'], '老师')
        except StorageError as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: apply(), range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 409 in results
    stored = db.get_report(owner, saved['id'])
    assert stored['revision'] == 2 and len(stored['record']['advisor']['history']) == 1


@pytest.mark.parametrize('origin,development', [('https://school.test', True), ('https://localhost', False),
                                               ('https://school.test', False)])
def test_local_mock_configuration_requires_explicit_loopback_development(tmp_path, origin, development):
    with pytest.raises(ValueError):
        Settings(database_path=tmp_path / 'private.sqlite3', public_origin=origin,
                 development=development, draft_mode='local_mock')


def test_modes_default_disabled_and_environment_does_not_load_provider_or_keys(tmp_path, monkeypatch):
    default = Settings(database_path=tmp_path / 'private.sqlite3', public_origin='https://school.test')
    assert default.draft_mode == 'disabled'
    monkeypatch.setenv('BIC_DEV', '1')
    monkeypatch.setenv('BIC_DATABASE_PATH', str(tmp_path / 'private.sqlite3'))
    monkeypatch.setenv('BIC_DRAFT_MODE', 'local_mock')
    monkeypatch.delenv('BIC_PUBLIC_ORIGIN', raising=False)
    assert Settings.from_env().draft_mode == 'local_mock'
    monkeypatch.setenv('BIC_DRAFT_MODE', 'provider')
    assert Settings.from_env().draft_mode == 'provider'
    monkeypatch.setenv('BIC_DRAFT_MODE', 'http://unapproved-model')
    with pytest.raises(ValueError):
        Settings.from_env()
