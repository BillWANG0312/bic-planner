"""Private advice previews: explicit opt-in, bounded work and human-approved writes.

There is deliberately no HTTP client, endpoint, key discovery or dynamic plugin
loader here. A later approved application factory may inject a provider object.
Timeouts bound caller latency; two daemon tasks bound uncooperative provider work.
A timed-out task retains its slot until it finishes, and never persists a result.
"""

from collections import OrderedDict
from concurrent.futures import Future, TimeoutError
import copy
from datetime import datetime, timezone
import math
import re
import threading
import time
import uuid

from pydantic import ValidationError

from .db import StorageError
from .draft_models import DraftContext, DraftResponse, DraftSections
from .models import ArchiveRecord, JS_WHITESPACE, bounded_text, legacy_record


_SECTIONS = ('summary', 'academic', 'plan', 'personality')
_GENERATOR = re.compile(r'[A-Za-z0-9._-]{1,80}\Z')
_IDENTIFIER = re.compile(r'[A-Za-z0-9_-]{1,128}\Z')
_TTL = 900
_OWNER_LIMIT = 5
_GLOBAL_LIMIT = 200
_TOMBSTONE_LIMIT = 1000


class AdviceDraftService:
    """Process-local previews; restart discards all previews and their text.

    Provider protocol: a safe ``generator`` identifier and synchronous
    ``propose(context_dict)`` returning exactly four plain-text sections. Only
    validated numeric/enum context reaches it, never IDs, names or prior advice.
    """

    def __init__(self, db, *, mode='disabled', provider=None, clock=time.time, timeout_seconds=5):
        if mode not in ('disabled', 'local_mock', 'provider'):
            raise ValueError('Unsupported draft mode.')
        if (type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds)
                or not 0 < timeout_seconds <= 60):
            raise ValueError('Draft timeout must be positive and at most 60 seconds.')
        self.db = db
        self.mode = mode
        self.provider = provider
        self.clock = clock
        self.timeout_seconds = timeout_seconds
        self._lock = threading.RLock()
        self._slots = threading.BoundedSemaphore(2)
        self._pending = {}
        self._reservations = {}
        self._tombstones = OrderedDict()

    @staticmethod
    def _invalid():
        return StorageError(422, 'The draft request is invalid.', 'VALIDATION')

    def _owned(self, owner_id, report_id, revision=None):
        with self.db._connection() as connection:
            row = connection.execute(
                'SELECT reports.* FROM reports JOIN users ON users.id = reports.owner_id '
                'WHERE reports.owner_id = ? AND reports.id = ? AND users.disabled = 0',
                (owner_id, report_id),
            ).fetchone()
        if row is None:
            raise StorageError(404, 'Report not found.', 'NOT_FOUND')
        if revision is not None and row['revision'] != revision:
            raise StorageError(409, 'The report changed; reload it before generating or applying advice.', 'REVISION')
        try:
            result = self.db._full_report(row)
            ArchiveRecord.model_validate(result['record'])
            return result
        except (ValidationError, TypeError, ValueError, KeyError):
            raise StorageError(503, 'The saved report is unavailable.') from None

    def _remember(self, identifier, owner_id, report_id, code, now):
        self._tombstones[identifier] = (owner_id, report_id, code, now + _TTL)
        while len(self._tombstones) > _TOMBSTONE_LIMIT:
            self._tombstones.popitem(last=False)

    def _prune(self, now):
        for identifier, (_, _, _, until) in list(self._tombstones.items()):
            if now >= until:
                del self._tombstones[identifier]
        for identifier, (owner_id, draft) in list(self._pending.items()):
            if now >= draft['expires_at']:
                del self._pending[identifier]
                self._remember(identifier, owner_id, draft['report_id'], 'DRAFT_EXPIRED', now)

    def _reserve(self, owner_id):
        with self._lock:
            self._prune(int(self.clock()))
            count = sum(saved_owner == owner_id for saved_owner, _ in self._pending.values())
            reserved = self._reservations.get(owner_id, 0)
            if (count + reserved >= _OWNER_LIMIT
                    or len(self._pending) + sum(self._reservations.values()) >= _GLOBAL_LIMIT):
                raise StorageError(413, 'The active draft limit is 5 per account and 200 per process.', 'LIMIT')
            self._reservations[owner_id] = reserved + 1

    def _release(self, owner_id):
        self._reservations[owner_id] -= 1
        if not self._reservations[owner_id]:
            del self._reservations[owner_id]

    @staticmethod
    def _local_proposal(context):
        # This is a deterministic local demonstration, not a model inference.
        completed = sum(subject['answered'] == subject['total'] for subject in context['subjects'])
        return {
            'summary': f'本地演示草稿：已完成 {completed} 科测评。请顾问结合学生实际情况核对后再采用。',
            'academic': '本地演示草稿：逐科核对已完成测评的表现；未完成部分先补测，再确定练习重点。',
            'plan': '本地演示草稿：先明确下一阶段学习目标，再安排可复查的周计划，并由顾问确认执行条件。',
            'personality': '本地演示草稿：人格偏好仅作沟通参考，请结合学生意愿与实际体验讨论方向。',
        }

    def _provider_proposal(self, context):
        if self.provider is None:
            return 'unavailable', None, None
        if not self._slots.acquire(blocking=False):
            return 'busy', None, None
        future = Future()

        def work():
            try:
                generator = getattr(self.provider, 'generator', None)
                if not isinstance(generator, str) or not _GENERATOR.fullmatch(generator):
                    future.set_result(('invalid', None, None))
                    return
                output = self.provider.propose(copy.deepcopy(context))
                try:
                    sections = DraftSections.model_validate(output).model_dump(mode='json')
                except (ValidationError, TypeError, ValueError):
                    future.set_result(('invalid', None, None))
                    return
                future.set_result(('generated', generator, sections))
            except BaseException:
                # Provider exceptions and their messages remain private.
                future.set_result(('failed', None, None))
            finally:
                self._slots.release()

        try:
            threading.Thread(target=work, name='bic-advice-provider', daemon=True).start()
        except RuntimeError:
            self._slots.release()
            return 'failed', None, None
        try:
            return future.result(timeout=self.timeout_seconds)
        except TimeoutError:
            return 'timeout', None, None

    def create(self, owner_id, report_id, revision, contextdict, fallbackdict):
        if (not isinstance(report_id, str) or not _IDENTIFIER.fullmatch(report_id)
                or type(revision) is not int or not 1 <= revision <= 9_007_199_254_740_991):
            raise self._invalid()
        saved = self._owned(owner_id, report_id, revision)
        try:
            context = DraftContext.model_validate(contextdict).model_dump(mode='json')
            before = DraftSections.model_validate(fallbackdict).model_dump(mode='json')
        except (ValidationError, TypeError, ValueError):
            raise self._invalid() from None
        # Browser-generated rule text is only a supplied fallback. Persisted
        # human edits, however, have an authoritative before value on the server.
        for section, text in saved['record'].get('advisor', {}).get('sections', {}).items():
            if before[section] != text:
                raise self._invalid()
        self._reserve(owner_id)
        try:
            kind, generator, reason, sections = 'rule', 'rules-v1', 'disabled', copy.deepcopy(before)
            if self.mode == 'local_mock':
                kind, generator, reason = 'local_mock', 'local-demo-v1', 'generated'
                sections = self._local_proposal(context)
            elif self.mode == 'provider':
                reason, proposed_generator, proposal = self._provider_proposal(context)
                if reason == 'generated':
                    kind, generator, sections = 'provider', proposed_generator, proposal
            with self._lock:
                self._owned(owner_id, report_id, revision)
                now = int(self.clock())
                self._prune(now)
                draft = DraftResponse.model_validate({
                    'id': str(uuid.uuid4()), 'report_id': report_id, 'source_revision': revision,
                    'created_at': now, 'expires_at': now + _TTL, 'kind': kind, 'generator': generator,
                    'reason': reason, 'before': before, 'sections': sections,
                }).model_dump(mode='json')
                self._pending[draft['id']] = (owner_id, copy.deepcopy(draft))
                return copy.deepcopy(draft)
        finally:
            with self._lock:
                self._release(owner_id)

    def apply(self, owner_id, report_id, draft_id, sections_list, reviewer):
        if (not isinstance(sections_list, list) or not 1 <= len(sections_list) <= len(_SECTIONS)
                or any(not isinstance(section, str) or section not in _SECTIONS for section in sections_list)
                or len(set(sections_list)) != len(sections_list) or not isinstance(reviewer, str)):
            raise self._invalid()
        try:
            reviewer.encode('utf-8')
            bounded_text(40, required=True)(reviewer)
        except (ValueError, UnicodeError):
            raise self._invalid() from None
        reviewer = reviewer.strip(JS_WHITESPACE)
        with self._lock:
            now = int(self.clock())
            self._prune(now)
            pending = self._pending.get(draft_id) if isinstance(draft_id, str) else None
            if pending is None or pending[0] != owner_id or pending[1]['report_id'] != report_id:
                tombstone = self._tombstones.get(draft_id) if isinstance(draft_id, str) else None
                if tombstone and tombstone[:2] == (owner_id, report_id):
                    # Recheck the account/report before exposing private lifecycle status.
                    self._owned(owner_id, report_id)
                    raise StorageError(409, 'The draft expired or was already applied; generate a new preview.', tombstone[2])
                raise StorageError(404, 'Draft not found.', 'NOT_FOUND')
            draft = pending[1]
            saved = self._owned(owner_id, report_id, draft['source_revision'])
            changes = [(section, draft['sections'][section].strip(JS_WHITESPACE))
                       for section in sections_list
                       if draft['sections'][section].strip(JS_WHITESPACE) != draft['before'][section].strip(JS_WHITESPACE)]
            if changes:
                record = copy.deepcopy(saved['record'])
                advisor = record.setdefault('advisor', {'sections': {}, 'history': []})
                if len(advisor['history']) + len(changes) > 200:
                    raise StorageError(413, 'The report audit limit is 200 entries; preserve its history before continuing.', 'LIMIT')
                at = datetime.fromtimestamp(now, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
                for section, text in changes:
                    advisor['sections'][section] = text
                    advisor['history'].append({
                        'id': str(uuid.uuid4()), 'at': at, 'author': reviewer,
                        'section': section, 'before': draft['before'][section], 'after': text,
                        'action': 'edit', 'reportId': record['reportMeta']['batchId'],
                        'origin': {'kind': draft['kind'], 'draft_id': draft['id'],
                                   'generator': draft['generator'], 'source_revision': draft['source_revision']},
                    })
                record['updatedAt'] = at
                # Validate without reserializing through model defaults: preserve all
                # original grade, state, metadata, version and optional field values.
                try:
                    # 当前形状的存档写回前重新换算成旧版兼容字段；旧版形状的存档（None）原样写回。
                    record = legacy_record(record) or record
                except ValidationError:
                    raise self._invalid() from None
                saved = self.db.update_report(owner_id, report_id, record, draft['source_revision'])
            del self._pending[draft_id]
            self._remember(draft_id, owner_id, report_id, 'DRAFT_APPLIED', now)
            return saved
