"""当前版本报告的写入边界：按请求里的版本标记换算成旧版兼容字段保存，读取时换回当前形状并补上标记。"""
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.bic_api.app import create_app
from backend.bic_api.settings import Settings
from backend.tests.test_api import Clock, ORIGIN, PASSWORD, record

from backend.bic_api.current_profile import CURRENT_PROFILE as CURRENT


@pytest.fixture
def accounts(tmp_path):
    app = create_app(Settings(database_path=tmp_path / 'accounts.sqlite3', public_origin=ORIGIN), clock=Clock())
    app.state.auth.create_user('alice', PASSWORD, 'student')
    app.state.auth.create_user('bob', PASSWORD, 'advisor')
    return app


def sign_in(client, username):
    session = client.post('/api/auth/login', json={'username': username, 'password': PASSWORD}, headers={'Origin': ORIGIN}).json()
    assert 'csrf_token' in session, session
    return {'Origin': ORIGIN, 'X-CSRF-Token': session['csrf_token']}


def current_record(suffix='cur'):
    value = record(suffix)
    value['state']['plan']['answers'] = {'grade': '8', 'preferredMajor': ['cs', 'biz']}
    value['state']['mbti']['answers'] = [{'value': 3, 'ms': 900}] * 30
    return value


def stored(app, report_id):
    with sqlite3.connect(app.state.db.path) as connection:
        row = connection.execute('SELECT record_json FROM reports WHERE id = ?', (report_id,)).fetchone()
    return json.loads(row[0])


def test_current_marker_is_stored_as_legacy_compatible_fields_and_reads_drop_it(accounts):
    with TestClient(accounts, base_url=ORIGIN) as client:
        headers = sign_in(client, 'alice')
        created = client.post('/api/reports', headers=headers, json={'record': current_record(), 'assessmentProfile': CURRENT})
        assert created.status_code == 201, created.text
        saved = created.json()
        # 读取统一返回当前形状并带上当前标记：页面据此用当前版本引擎打开。
        assert saved['record']['assessmentProfile'] == CURRENT
        # 读取返回当前版本形状：30 道特质题（缺省毫秒数置空，反向题分数已翻回同向），规划字段换回分格与搭档。
        answers = saved['record']['state']['mbti']['answers']
        assert len(answers) == 30
        assert answers[:2] == [{'value': 3, 'ms': None}, {'value': 1, 'ms': None}]
        assert answers[-1] is None
        plan = saved['record']['state']['plan']['answers']
        # 专业意向当前版本与旧版同键：存档里原样保存，读取时原样返回，不再由分格换算。
        assert plan['preferredMajor'] == ['cs', 'biz']
        assert not any(key in plan for key in ['groupSize', 'timeStyle'])
        # 数据库里保存的是旧版兼容存档：换算后的作答不带标记。
        assert 'assessmentProfile' not in stored(accounts, saved['id'])
        assert stored(accounts, saved['id'])['state']['plan']['answers']['preferredMajor'] == ['cs', 'biz']
        assert client.get('/api/reports/' + saved['id']).json() == saved
        # 读取到的当前形状原样写回（读-改-写）仍需按请求标记换算，结果与原来一致。
        updated = client.put('/api/reports/' + saved['id'], headers=headers,
                             json={'record': saved['record'], 'assessmentProfile': CURRENT, 'revision': saved['revision']})
        assert updated.status_code == 200, updated.text
        rewritten = updated.json()['record']['state']
        for key in ('info', 'academic', 'plan'):
            if key == 'plan':
                continue
            assert rewritten[key] == saved['record']['state'][key]
        assert rewritten['mbti']['answers'][-1] is None
        # 只有前 24 项有分数，后 6 道特质题没存进旧版字段：写回后仍读回 30 道，后 6 道为未作答。
        assert len(rewritten['mbti']['answers']) == 30
        assert rewritten['plan']['answers']['grade'] == '8'
        assert updated.json()['record']['assessmentProfile'] == CURRENT
        assert 'assessmentProfile' not in stored(accounts, saved['id'])


def test_absent_or_legacy_marker_is_stored_unchanged(accounts):
    with TestClient(accounts, base_url=ORIGIN) as client:
        # 同一账号不能重复保存同编号报告；缺省标记与旧版标记各用一份旧版存档。
        for client, username, suffix, profile in ((client, 'alice', 'old1', None), (TestClient(accounts, base_url=ORIGIN), 'bob', 'old2', 'legacy-2026.10')):
            expected = record(suffix)
            body = {'record': expected} if profile is None else {'record': expected, 'assessmentProfile': profile}
            response = client.post('/api/reports', headers=sign_in(client, username), json=body)
            assert response.status_code == 201, response.text
            # 旧版作答原样返回，不带当前标记（旧版标记不进存档）。
            assert {key: item for key, item in response.json()['record'].items() if key != 'state'} == {key: item for key, item in expected.items() if key != 'state'}
            # 旧版存档的作答原样返回，不会补成 30 道特质题。
            answers = response.json()['record']['state']['mbti']['answers']
            assert answers == expected['state']['mbti']['answers']
            saved = stored(accounts, response.json()['id'])
            assert saved['state']['mbti'] == {'answers': [None] * 24}
            # 版本标记只说明写入方，不进存档。
            assert 'assessmentProfile' not in saved


def test_current_progress_with_no_trait_answers_keeps_thirty_blank_slots(accounts):
    # 报告页按 30 道特质题整份补 null 占位：一项都没作答时也整份存 30 个空位，读取时补回当前标记。
    with TestClient(accounts, base_url=ORIGIN) as client:
        value = record('blank')
        value['state']['mbti']['answers'] = [None] * 30
        created = client.post('/api/reports', headers=sign_in(client, 'alice'), json={'record': value, 'assessmentProfile': CURRENT})
        assert created.status_code == 201, created.text
        assert created.json()['record']['state']['mbti']['answers'] == [None] * 30
        assert created.json()['record']['assessmentProfile'] == CURRENT
        # 30 个空位本身就是当前版本的证据（旧版存档只有 24 项以内），读取时由此补回当前标记。
        assert stored(accounts, created.json()['id'])['state']['mbti']['answers'] == [None] * 30


def test_legacy_archive_with_empty_traits_reads_back_unchanged(accounts):
    def legacy(key):
        value = {'id': key, 'createdAt': '2026-10-24T00:00:00.000Z', 'updatedAt': '2026-10-24T00:00:00.000Z',
                 'bankVersion': '2026.1', 'catalogVersion': None,
                 'state': {'info': {'name': '测试学生', 'grade': '10', 'year': '2027'}, 'academic': {'answers': {}},
                           'plan': {'answers': {}}, 'mbti': {'answers': []}},
                 'reportMeta': {'batchId': 'BIC-' + key, 'date': '2026-10-24'}}
        return value

    with TestClient(accounts, base_url=ORIGIN) as client:
        alice = sign_in(client, 'alice')
        for key, profile in (('empty', None), ('emptymarked', 'legacy-2026.10')):
            expected = legacy(key)
            body = {'record': expected} if profile is None else {'record': expected, 'assessmentProfile': profile}
            created = client.post('/api/reports', headers=alice, json=body)
            assert created.status_code == 201, created.text
            assert created.json()['record'] == expected
            assert client.get('/api/reports/' + created.json()['id']).json() == created.json()
            assert 'assessmentProfile' not in stored(accounts, created.json()['id'])


def test_marker_never_reaches_storage():
    from backend.bic_api.models import stored_record
    from backend.tests.test_api import record
    assert 'assessmentProfile' not in stored_record({**record('legacy'), 'assessmentProfile': 'legacy-2026.10'})


@pytest.mark.parametrize('change', [
    {'assessmentProfile': 'unsupported'}, {'assessmentProfile': CURRENT, 'profile': CURRENT}, {'revision': 1},
])
def test_report_body_rejects_unknown_or_misplaced_marker_without_mutating(accounts, change):
    with TestClient(accounts, base_url=ORIGIN) as client:
        headers = sign_in(client, 'alice')
        response = client.post('/api/reports', headers=headers, json={'record': record(), **change})
        assert response.status_code == 422
        assert response.json() == {'detail': 'Invalid request parameters or body.'}
        assert client.get('/api/reports').json()['total'] == 0
