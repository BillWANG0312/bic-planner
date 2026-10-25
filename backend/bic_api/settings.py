"""Explicit configuration for an optional, private backend process."""

from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_path: Path
    public_origin: str
    development: bool = False
    session_ttl: int = 28_800
    max_request_bytes: int = 6_100_000
    cookie_path: str = '/api'
    draft_mode: str = 'disabled'

    def __post_init__(self):
        candidate = Path(self.database_path)
        root = Path(__file__).resolve().parents[2]
        if not candidate.is_absolute() or candidate.resolve().is_relative_to(root):
            raise ValueError('Database must use an absolute private path outside the static website.')
        object.__setattr__(self, 'database_path', candidate.resolve())
        try:
            origin = urlsplit(self.public_origin)
            port = origin.port
            hostname = origin.hostname
        except (ValueError, TypeError):
            raise ValueError('A valid public origin is required.') from None
        if (not hostname or origin.username is not None or origin.password is not None
                or origin.path not in ('', '/') or origin.query or origin.fragment
                or origin.scheme not in ('https', 'http') or '*' in hostname or ':' in hostname or port == 0
                or not hostname.isascii() or any(c.isspace() for c in self.public_origin)):
            raise ValueError('Public origin must contain only an HTTP(S) scheme, hostname and optional port.')
        if origin.scheme != 'https' and not (self.development and hostname in ('127.0.0.1', 'localhost')):
            raise ValueError('HTTPS is required; development HTTP is limited to loopback.')
        host = hostname
        suffix = ':' + str(port) if port and port != {'http': 80, 'https': 443}[origin.scheme] else ''
        object.__setattr__(self, 'public_origin', origin.scheme + '://' + host + suffix)
        if self.draft_mode not in ('disabled', 'local_mock', 'provider'):
            raise ValueError('Draft mode must be disabled, local_mock or provider.')
        if self.draft_mode == 'local_mock' and not (self.development and hostname in ('127.0.0.1', 'localhost')):
            raise ValueError('Local draft demonstrations require explicit loopback development mode.')
        if type(self.session_ttl) is not int or not 300 <= self.session_ttl <= 86_400:
            raise ValueError('Session lifetime must be between 300 and 86400 seconds.')
        if type(self.max_request_bytes) is not int or not 1_024 <= self.max_request_bytes <= 6_100_000:
            raise ValueError('Request limit must be between 1024 and 6100000 bytes.')
        if (not isinstance(self.cookie_path, str) or not self.cookie_path.startswith('/')
                or any(c in self.cookie_path for c in ';,?#\\')
                or not self.cookie_path.isascii() or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in self.cookie_path)):
            raise ValueError('Cookie path must be an absolute URL path.')

    @property
    def hostname(self):
        return urlsplit(self.public_origin).hostname

    @classmethod
    def from_env(cls):
        development = os.environ.get('BIC_DEV') == '1'
        database = os.environ.get('BIC_DATABASE_PATH')
        origin = os.environ.get('BIC_PUBLIC_ORIGIN')
        if not database or (not origin and not development):
            raise ValueError('BIC_DATABASE_PATH and BIC_PUBLIC_ORIGIN must be explicitly configured.')
        return cls(database_path=Path(database), public_origin=origin or 'http://127.0.0.1:9001',
                   development=development, cookie_path=os.environ.get('BIC_COOKIE_PATH', '/api'),
                   draft_mode=os.environ.get('BIC_DRAFT_MODE', 'disabled'))
