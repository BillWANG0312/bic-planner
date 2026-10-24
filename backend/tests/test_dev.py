"""Explicit loopback-only preview keeps private API/source paths out of static mounts."""

import importlib
import json
from pathlib import Path
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from backend.bic_api.settings import Settings


ORIGIN = 'http://127.0.0.1:9001'
PASSWORD = 'dev-preview-test-password'
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def dev_module():
    try:
        return importlib.import_module('backend.bic_api.dev')
    except ModuleNotFoundError:
        pytest.fail('Explicit loopback development server has not been implemented.')


@pytest.fixture
def dev_app(dev_module, tmp_path):
    return dev_module.create_dev_app(Settings(database_path=tmp_path / 'private.sqlite3',
                                             public_origin=ORIGIN, development=True))


@pytest.mark.parametrize('origin,development', [
    ('https://planner.test', False), ('https://planner.test', True),
    ('https://localhost', False), ('https://127.0.0.1', False),
])
def test_dev_entrypoint_requires_explicit_development_and_loopback(dev_module, tmp_path, origin, development):
    settings = Settings(database_path=tmp_path / 'private.sqlite3', public_origin=origin, development=development)
    with pytest.raises(ValueError, match='development|loopback'):
        dev_module.create_dev_app(settings)
    assert not settings.database_path.exists()


def test_static_preview_and_api_share_one_origin(dev_app):
    with TestClient(dev_app, base_url=ORIGIN) as client:
        homepage = client.get('/')
        assert homepage.status_code == 200 and '<title>BIC ' in homepage.text
        assert client.get('/index.html').content == homepage.content
        for asset, marker in [('/css/style.css', 'body'), ('/js/bank.js', 'QUESTION_BANK'),
                              ('/data/universities.js', 'UNIVERSITY_CATALOG')]:
            response = client.get(asset)
            assert response.status_code == 200 and marker in response.text
            assert response.headers['cache-control'] == 'no-store'
            assert response.headers['x-content-type-options'] == 'nosniff'
        image = client.get('/img/favicon-128.png')
        assert image.status_code == 200 and image.headers['content-type'] == 'image/png'
        assert client.get('/api/health').json() == {'status': 'ok', 'api_version': '2'}
        assert client.get('/api/reports').status_code == 401


def test_only_dev_preview_explicitly_enables_same_origin_cloud_config(dev_app):
    with TestClient(dev_app, base_url=ORIGIN) as client:
        response = client.get('/js/cloud-config.js')
        assert response.status_code == 200
        prefix = 'window.BIC_CLOUD_CONFIG = '
        assert response.text.startswith(prefix)
        config = json.loads(response.text.removeprefix(prefix).strip().removesuffix(';'))
        assert config == {'enabled': True, 'apiBase': '/api/'}
        assert 'javascript' in response.headers['content-type']
        assert response.headers['cache-control'] == 'no-store'
        assert 'set-cookie' not in response.headers
        assert 'password' not in response.text and 'token' not in response.text


@pytest.mark.parametrize('target', [
    '/backend/bic_api/security.py', '/backend/assessment-schema.json', '/docs/backend.md',
    '/.git/config', '/.env', '/README.md', '/private.sqlite3',
    '/js/%2e%2e/%2e%2e/backend/bic_api/security.py',
    '/css/..%2f..%2fbackend/bic_api/security.py',
    '/data/..%5c..%5cbackend%5cbic_api%5csecurity.py',
    '/js/C%3a/Windows/win.ini',
])
def test_preview_does_not_serve_private_or_traversed_files(dev_app, target):
    with TestClient(dev_app, base_url=ORIGIN) as client:
        response = client.get(target, follow_redirects=False)
        assert response.status_code == 404
        assert 'PasswordHash' not in response.text and 'Argon2 credentials' not in response.text


def test_preview_keeps_host_origin_and_csrf_protection(dev_app):
    dev_app.state.auth.create_user('preview.student', PASSWORD)
    with TestClient(dev_app, base_url=ORIGIN) as client:
        assert client.get('/', headers={'Host': 'attacker.test'}).status_code == 400
        credentials = {'username': 'preview.student', 'password': PASSWORD}
        assert client.post('/api/auth/login', json=credentials).status_code == 403
        assert client.post('/api/auth/login', json=credentials,
                           headers={'Origin': 'http://attacker.test'}).status_code == 403
        result = client.post('/api/auth/login', json=credentials, headers={'Origin': ORIGIN})
        assert result.status_code == 200
        assert client.post('/api/auth/logout', json={}, headers={'Origin': ORIGIN}).status_code == 403
        assert client.post('/api/auth/logout', json={}, headers={'Origin': ORIGIN,
                           'X-CSRF-Token': result.json()['csrf_token']}).status_code == 204


def test_preview_has_no_directory_listing(dev_app):
    with TestClient(dev_app, base_url=ORIGIN) as client:
        for path in ['/js/', '/css/', '/img/', '/data/']:
            assert client.get(path).status_code == 404


def test_public_asset_symlink_cannot_escape_its_mount(dev_module, tmp_path, monkeypatch):
    public = tmp_path / 'public'
    for directory in ('css', 'js', 'img', 'data'):
        (public / directory).mkdir(parents=True)
    (public / 'index.html').write_text('<title>Preview</title>', encoding='utf-8')
    private = tmp_path / 'private-data.txt'
    private.write_text('private-content-must-stay-private', encoding='utf-8')
    try:
        (public / 'js' / 'leak.js').symlink_to(private)
    except OSError:
        pytest.skip('Creating a symlink requires OS permission for this filesystem test.')
    monkeypatch.setattr(dev_module, '_PUBLIC_ROOT', public)
    app = dev_module.create_dev_app(Settings(database_path=tmp_path / 'private.sqlite3',
                                            public_origin=ORIGIN, development=True))
    with TestClient(app, base_url=ORIGIN) as client:
        response = client.get('/js/leak.js')
        assert response.status_code == 404
        assert private.read_text(encoding='utf-8') not in response.text


def test_localhost_is_also_an_explicit_loopback_origin(dev_module, tmp_path):
    settings = Settings(database_path=tmp_path / 'localhost.sqlite3',
                        public_origin='http://localhost:9001', development=True)
    with TestClient(dev_module.create_dev_app(settings), base_url=settings.public_origin) as client:
        assert client.get('/').status_code == 200


def test_invalid_port_cli_exits_without_starting_server(dev_module):
    import os
    result = subprocess.run([sys.executable, '-m', 'backend.bic_api.dev'], cwd=ROOT,
                            env={**os.environ, 'BIC_PORT': '0'}, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'BIC_PORT' in result.stderr
