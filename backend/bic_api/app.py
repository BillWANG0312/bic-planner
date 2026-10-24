"""Owner-scoped account and report API. Importing this module creates no database."""

import sqlite3
import time
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse

from .db import Database, StorageError
from .models import ArchiveRecord
from .security import AuthError, AuthService
from .settings import Settings
from .share_models import ShareContent
from .sharing import ShareService
from .comment_models import CommentText, RequestId
from .comments import CommentService


class StrictBody(BaseModel):
    model_config = ConfigDict(extra='forbid')


class LoginBody(StrictBody):
    username: Annotated[StrictStr, Field(min_length=3, max_length=64)]
    password: Annotated[StrictStr, Field(min_length=12, max_length=128)]


class CreateReportBody(StrictBody):
    record: ArchiveRecord


class UpdateReportBody(CreateReportBody):
    revision: Annotated[StrictInt, Field(ge=1)]


class CreateShareBody(StrictBody):
    revision: Annotated[StrictInt, Field(ge=1)]
    ttl_hours: Literal[24, 72, 168]
    content: ShareContent


class CreateParentAccessBody(CreateShareBody):
    recipient_username: Annotated[StrictStr, Field(min_length=3, max_length=64)]


class AddCommentBody(StrictBody):
    body: CommentText
    client_request_id: RequestId


class ApiBoundary:
    """Validate the browser boundary and cap bytes before JSON parsing."""

    def __init__(self, app, settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)

        async def secured_send(message):
            if message['type'] == 'http.response.start':
                headers = [(k, v) for k, v in message.get('headers', []) if k.lower() not in
                           (b'cache-control', b'x-content-type-options')]
                headers.extend([(b'cache-control', b'no-store'), (b'x-content-type-options', b'nosniff')])
                headers.extend([(b'referrer-policy', b'no-referrer'),
                                (b'x-robots-tag', b'noindex, nofollow, noarchive')])
                message = {**message, 'headers': headers}
            await send(message)

        async def reject(status, detail):
            await JSONResponse({'detail': detail}, status_code=status)(scope, receive, secured_send)

        headers = scope.get('headers', [])
        origins = [value.decode('latin-1') for key, value in headers if key.lower() == b'origin']
        unsafe = scope['method'] not in ('GET', 'HEAD', 'OPTIONS')
        if (len(origins) > 1 or (unsafe and not origins)
                or (origins and origins[0] != self.settings.public_origin)):
            return await reject(403, 'Origin is not allowed.')
        if scope['method'] in ('POST', 'PUT', 'PATCH'):
            content_types = [value.decode('latin-1').split(';', 1)[0].strip().lower()
                             for key, value in headers if key.lower() == b'content-type']
            if content_types != ['application/json']:
                return await reject(415, 'JSON content type is required.')
        lengths = [value for key, value in headers if key.lower() == b'content-length']
        if lengths:
            if len(lengths) != 1 or not lengths[0].isdigit():
                return await reject(400, 'Invalid content length.')
            meaningful_digits = lengths[0].lstrip(b'0')
            if len(meaningful_digits) > 7 or int(meaningful_digits or b'0') > self.settings.max_request_bytes:
                return await reject(413, 'Request body is too large.')

        # Count actual ASGI chunks: Content-Length alone cannot constrain streamed bodies.
        body = bytearray()
        while True:
            event = await receive()
            if event['type'] == 'http.disconnect':
                return
            chunk = event.get('body', b'')
            if len(body) + len(chunk) > self.settings.max_request_bytes:
                return await reject(413, 'Request body is too large.')
            body.extend(chunk)
            if not event.get('more_body', False):
                break
        buffered = bytes(body)
        del body
        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                # File responses listen for a real client disconnect while streaming.
                # Fabricating one here would cancel the response before its body is sent.
                return await receive()
            delivered = True
            return {'type': 'http.request', 'body': buffered, 'more_body': False}

        await self.app(scope, replay, secured_send)


def create_app(settings: Settings, *, clock=time.time):
    app = FastAPI(title='BIC private report API', version='2.0.0', docs_url=None,
                  redoc_url=None, openapi_url='/api/openapi.json' if settings.development else None)
    db = Database(settings.database_path, clock=clock)
    auth = AuthService(db, session_ttl=settings.session_ttl, clock=clock)
    app.state.db, app.state.auth, app.state.settings = db, auth, settings
    sharing = ShareService(db, clock=clock)
    app.state.sharing = sharing
    comments = CommentService(db, clock=clock)
    app.state.comments = comments
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[settings.hostname], www_redirect=False)
    app.add_middleware(ApiBoundary, settings=settings)

    @app.exception_handler(RequestValidationError)
    async def invalid_body(request, error):
        # Pydantic's default response includes rejected input, possibly a password or answers.
        return JSONResponse({'detail': 'Invalid request parameters or body.'}, status_code=422)

    @app.exception_handler(AuthError)
    async def auth_error(request, error):
        headers = {'Retry-After': str(error.retry_after)} if error.retry_after else None
        return JSONResponse({'detail': error.message}, status_code=error.status_code, headers=headers)

    @app.exception_handler(StorageError)
    async def storage_error(request, error):
        return JSONResponse({'detail': error.message, 'code': error.code}, status_code=error.status_code)

    @app.exception_handler(sqlite3.Error)
    async def unavailable_storage(request, error):
        return JSONResponse({'detail': 'Storage is temporarily unavailable.'}, status_code=503)

    def current_session(request: Request):
        session = auth.session(request.cookies.get('bic_session'))
        # A different tab can replace this browser's shared Cookie. Bound reads
        # must not return that new account's data under a stale page identity.
        supplied = request.headers.get('X-CSRF-Token')
        if supplied is not None and not auth.verify_csrf(session, supplied):
            raise HTTPException(403, 'The page session changed; reconnect before continuing.')
        return session

    def writable_session(request: Request, session=Depends(current_session)):
        if not auth.verify_csrf(session, request.headers.get('X-CSRF-Token')):
            raise HTTPException(403, 'A valid CSRF token is required.')
        return session

    def serialize_record(record):
        return record.model_dump(mode='json', exclude_unset=True)

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'api_version': '2'}

    @app.post('/api/auth/login')
    def login(body: LoginBody, request: Request, response: Response):
        session = auth.login(body.username, body.password, request.client.host if request.client else 'unknown')
        auth.logout(request.cookies.get('bic_session'))
        response.set_cookie('bic_session', session['token'], max_age=settings.session_ttl,
                            path=settings.cookie_path, secure=settings.public_origin.startswith('https://'),
                            httponly=True, samesite='lax')
        return {key: value for key, value in session.items() if key != 'token'}

    @app.get('/api/auth/session')
    def session_info(session=Depends(current_session)):
        return session

    @app.post('/api/auth/logout', status_code=204)
    def logout(request: Request, session=Depends(writable_session)):
        auth.logout(request.cookies.get('bic_session'))
        response = Response(status_code=204)
        response.delete_cookie('bic_session', path=settings.cookie_path,
                               secure=settings.public_origin.startswith('https://'), httponly=True, samesite='lax')
        return response

    @app.get('/api/reports')
    def reports(session=Depends(current_session), limit: int = Query(default=20, ge=1, le=100),
                offset: int = Query(default=0, ge=0, le=2 ** 63 - 1)):
        return db.list_reports(session['user']['id'], limit=limit, offset=offset)

    @app.post('/api/reports', status_code=201)
    def create_report(body: CreateReportBody, session=Depends(writable_session)):
        return db.create_report(session['user']['id'], serialize_record(body.record))

    @app.get('/api/reports/{report_id}')
    def get_report(report_id: str, session=Depends(current_session)):
        result = db.get_report(session['user']['id'], report_id)
        if result is None:
            raise HTTPException(404, 'Report not found.')
        return result

    @app.put('/api/reports/{report_id}')
    def update_report(report_id: str, body: UpdateReportBody, session=Depends(writable_session)):
        return db.update_report(session['user']['id'], report_id, serialize_record(body.record), body.revision)

    @app.delete('/api/reports/{report_id}', status_code=204)
    def delete_report(report_id: str, revision: int = Query(ge=1), session=Depends(writable_session)):
        db.delete_report(session['user']['id'], report_id, revision)
        return Response(status_code=204)

    @app.post('/api/reports/{report_id}/shares', status_code=201)
    def create_share(report_id: str, body: CreateShareBody, session=Depends(writable_session)):
        return sharing.create(session['user']['id'], report_id, body.revision, body.ttl_hours,
                              body.content.model_dump(mode='json'))

    @app.get('/api/reports/{report_id}/shares')
    def list_shares(report_id: str, session=Depends(current_session)):
        return sharing.list(session['user']['id'], report_id)

    @app.delete('/api/reports/{report_id}/shares/{share_id}', status_code=204)
    def revoke_share(report_id: str, share_id: str, session=Depends(writable_session)):
        sharing.revoke(session['user']['id'], report_id, share_id)
        return Response(status_code=204)

    @app.get('/api/public/share')
    def read_share(request: Request):
        return sharing.read(request.headers.get('X-BIC-Share'), request.client.host if request.client else 'unknown')

    @app.post('/api/reports/{report_id}/parent-access', status_code=201)
    def create_parent_access(report_id: str, body: CreateParentAccessBody, session=Depends(writable_session)):
        return comments.create_grant(session['user']['id'], report_id, body.revision,
                                     body.recipient_username, body.ttl_hours, body.content.model_dump(mode='json'))

    @app.get('/api/reports/{report_id}/parent-access')
    def report_parent_access(report_id: str, session=Depends(current_session)):
        return comments.list_for_report(session['user']['id'], report_id)

    @app.delete('/api/reports/{report_id}/parent-access/{grant_id}', status_code=204)
    def revoke_parent_access(report_id: str, grant_id: str, session=Depends(writable_session)):
        comments.revoke(session['user']['id'], report_id, grant_id)
        return Response(status_code=204)

    @app.get('/api/parent-access')
    def family_access(session=Depends(current_session)):
        return comments.list_for_user(session['user']['id'])

    @app.get('/api/parent-access/{grant_id}')
    def family_thread(grant_id: str, session=Depends(current_session)):
        return comments.thread(session['user']['id'], grant_id)

    @app.post('/api/parent-access/{grant_id}/comments', status_code=201)
    def add_family_comment(grant_id: str, body: AddCommentBody, session=Depends(writable_session)):
        return comments.add_comment(session['user']['id'], grant_id, body.body, body.client_request_id)

    return app


def app_from_env():
    return create_app(Settings.from_env())
