"""Explicit loopback preview for the static UI and private API on one origin.

Run with BIC_DEV=1 and an outside-the-site BIC_DATABASE_PATH. Production
continues to use the API-only entrypoint and its separately managed web host.
"""

import json
import os
from pathlib import Path

from fastapi.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles
import uvicorn

from .app import create_app
from .settings import Settings


_PUBLIC_ROOT = Path(__file__).resolve().parents[2]


def create_dev_app(settings: Settings):
    if not settings.development or settings.hostname not in ('127.0.0.1', 'localhost'):
        raise ValueError('The static preview requires explicit development mode and a loopback origin.')

    app = create_app(settings)

    @app.get('/', include_in_schema=False)
    @app.get('/index.html', include_in_schema=False)
    def index():
        return FileResponse(_PUBLIC_ROOT / 'index.html', media_type='text/html')

    @app.get('/share.html', include_in_schema=False)
    def parent_share():
        return FileResponse(_PUBLIC_ROOT / 'share.html', media_type='text/html',
                            headers={'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive'})

    @app.get('/family.html', include_in_schema=False)
    def family_portal():
        return FileResponse(_PUBLIC_ROOT / 'family.html', media_type='text/html',
                            headers={'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive'})

    @app.get('/teacher.html', include_in_schema=False)
    def teacher_portal():
        return FileResponse(_PUBLIC_ROOT / 'teacher.html', media_type='text/html')

    @app.get('/advisor-edit.html', include_in_schema=False)
    def advisor_editor():
        return FileResponse(_PUBLIC_ROOT / 'advisor-edit.html', media_type='text/html')

    @app.get('/teacher-summary.html', include_in_schema=False)
    def teacher_summary_portal():
        return FileResponse(_PUBLIC_ROOT / 'teacher-summary.html', media_type='text/html')

    @app.get('/account.html', include_in_schema=False)
    def account_security_portal():
        return FileResponse(_PUBLIC_ROOT / 'account.html', media_type='text/html')

    # This route precedes the /js mount. Only this explicit local preview turns
    # on the UI configuration; it does not edit the deployable static file.
    @app.get('/js/cloud-config.js', include_in_schema=False)
    def cloud_configuration():
        configuration = {'enabled': True, 'apiBase': '/api/'}
        return Response('window.BIC_CLOUD_CONFIG = ' + json.dumps(configuration) + ';\n',
                        media_type='application/javascript', headers={'Cache-Control': 'no-store'})

    # Do not mount the repository root: it contains backend source and other
    # non-public files. StaticFiles also rejects traversal and escaping symlinks.
    for directory in ('css', 'js', 'img', 'data'):
        app.mount('/' + directory, StaticFiles(directory=_PUBLIC_ROOT / directory, follow_symlink=False),
                  name='preview-' + directory)
    return app


def app_from_env():
    return create_dev_app(Settings.from_env())


if __name__ == '__main__':
    try:
        port = int(os.environ.get('BIC_PORT', '9001'))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit('BIC_PORT must be an integer between 1 and 65535.') from None
    uvicorn.run('backend.bic_api.dev:app_from_env', factory=True, host='127.0.0.1', port=port,
                proxy_headers=False, workers=1)
