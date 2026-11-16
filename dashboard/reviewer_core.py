"""Private passage review, protocol dike-reviewer/1. No Hermes/runtime imports.

Offsets are Unicode code points, half-open, over EXACT decoded UTF-8. Source
authorization is the adapter's responsibility on EVERY call, including exports.
SQLite extends profile data: source documents, notes and NIF remain untouched.
"""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import unicodedata
import uuid
from datetime import datetime, timezone

from .reviewer_vendor.models import AnnotationDocument, AnnotationLabel, SpanAnnotation, CASE_PREP_LABEL_CONFIG
from .reviewer_vendor.io_evidence import build_evidence_span

PROTOCOL = 'dike-reviewer/1'
MAX_BYTES = 2 * 1024 * 1024
LABELS = tuple(CASE_PREP_LABEL_CONFIG['case_prep_lexo'])
# Identificadores opacos por fuente: el del vault lo asigna el inventario; el de
# un documento local es el SHA-256 de su texto (los primeros 32 hex).
DOC_ID = {'vault': re.compile(r'v:[A-Za-z0-9_-]{1,100}'), 'local': re.compile(r'l:[0-9a-f]{32}')}
MAX_LOCAL_DOCUMENTS = 500
WARNING = 'Integridad del pasaje comprobada; no acredita vigencia ni validez jurídica.'


class ReviewerError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def check_case(cid):
    if not isinstance(cid, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', cid):
        raise ReviewerError('INVALID_CASE')
    return cid


def to_utf16(text, offset):
    if type(offset) is not int or not 0 <= offset <= len(text):
        raise ReviewerError('INVALID_RANGE')
    return len(text[:offset].encode('utf-16-le')) // 2


def from_utf16(text, offset):
    if type(offset) is not int or not 0 <= offset <= len(text) * 2:
        raise ReviewerError('INVALID_RANGE')
    try:
        raw = text.encode('utf-16-le')
        if offset * 2 > len(raw): raise ValueError
        return len(raw[:offset * 2].decode('utf-16-le'))
    except (UnicodeError, ValueError):
        raise ReviewerError('INVALID_RANGE') from None


def document(source, ident, text):
    if source not in DOC_ID or not isinstance(ident, str) or not DOC_ID[source].fullmatch(ident):
        raise ReviewerError('INVALID_DOCUMENT')
    if not isinstance(text, str): raise ReviewerError('INVALID_TEXT')
    try: raw = text.encode('utf-8')
    except UnicodeError: raise ReviewerError('INVALID_TEXT') from None
    if len(raw) > MAX_BYTES: raise ReviewerError('TOO_LARGE')
    return dict(protocol=PROTOCOL, source=source, doc_id=ident, text=text,
                sha256=hashlib.sha256(raw).hexdigest(), offset_unit='unicode_code_point')


def validate(doc, body):
    allowed = {'annotation_id','version','start_offset','end_offset','text','author','labels'}
    if not isinstance(body, dict) or set(body) - allowed: raise ReviewerError('INVALID_INPUT')
    start, end = body.get('start_offset'), body.get('end_offset')
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(doc['text']):
        raise ReviewerError('INVALID_RANGE')
    if doc['text'][start:end] != body.get('text'): raise ReviewerError('SNIPPET_MISMATCH')
    if end - start > 16000: raise ReviewerError('TOO_LARGE')
    author, labels = body.get('author'), body.get('labels')
    if not isinstance(author, str) or not author.strip() or len(author) > 120: raise ReviewerError('INVALID_AUTHOR')
    if not isinstance(labels, list) or not 1 <= len(labels) <= 10 or any(x not in LABELS for x in labels):
        raise ReviewerError('INVALID_LABELS')
    if type(body.get('version')) is not int or body['version'] < 0: raise ReviewerError('INVALID_VERSION')
    ann = SpanAnnotation(doc_id=doc['doc_id'], annotator=author, text=body['text'],
                         start_offset=start, end_offset=end,
                         labels=[AnnotationLabel(category='case_prep_lexo',value=x) for x in labels], status='approved')
    return ann


class LocalDocuments:
    """Documentos que la persona agregó desde su equipo, guardados como texto exacto.

    El archivo original no se toca ni se recuerda su ruta: se guarda el texto ya
    extraído, su SHA-256 y el nombre que traía. El identificador sale del texto,
    así que agregar dos veces el mismo contenido da el mismo documento.
    """

    def __init__(self, data: Path):
        self.dir = Path(data) / 'reviewer' / 'documentos'

    def _path(self, ident):
        if not isinstance(ident, str) or not DOC_ID['local'].fullmatch(ident):
            raise ReviewerError('INVALID_DOCUMENT')
        return self.dir / (ident[2:] + '.json')

    @staticmethod
    def _name(name):
        if not isinstance(name, str): raise ReviewerError('INVALID_INPUT')
        # Solo el nombre: una ruta que venga del cliente se descarta.
        name = name.replace('\\', '/').rsplit('/', 1)[-1].strip()
        if not name or len(name) > 200 or any(unicodedata.category(c).startswith('C') for c in name):
            raise ReviewerError('INVALID_INPUT')
        return name

    def _load(self, path):
        try:
            item = json.loads(path.read_text(encoding='utf-8'))
            text, sha = item['text'], item['sha256']
            if (not isinstance(text, str) or not isinstance(item['name'], str)
                    or hashlib.sha256(text.encode('utf-8')).hexdigest() != sha
                    or path.name != sha[:32] + '.json'):
                raise ValueError
            return item
        except FileNotFoundError:
            raise
        except (OSError, ValueError, KeyError, TypeError, UnicodeError):
            raise ReviewerError('STORE_CORRUPT') from None

    @staticmethod
    def _meta(item):
        return {'id': 'l:' + item['sha256'][:32], 'label': item['name'], 'sha256': item['sha256'],
                'bytes': len(item['text'].encode('utf-8')), 'added_at': item.get('added_at')}

    def add(self, name, text):
        name = self._name(name)
        if not isinstance(text, str) or not text.strip(): raise ReviewerError('INVALID_TEXT')
        try: raw = text.encode('utf-8')
        except UnicodeError: raise ReviewerError('INVALID_TEXT') from None
        if len(raw) > MAX_BYTES: raise ReviewerError('TOO_LARGE')
        sha = hashlib.sha256(raw).hexdigest()
        path = self._path('l:' + sha[:32])
        try:
            self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(self.dir.parent, 0o700); os.chmod(self.dir, 0o700)
            if path.is_file():
                return self._meta(self._load(path))
            if sum(1 for _ in self.dir.glob('*.json')) >= MAX_LOCAL_DOCUMENTS:
                raise ReviewerError('CASE_LIMIT')
            item = {'protocol': PROTOCOL, 'name': name, 'sha256': sha, 'text': text,
                    'added_at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
            fd, temp = tempfile.mkstemp(prefix='.doc-', dir=self.dir)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8') as handle:
                    json.dump(item, handle, ensure_ascii=False); handle.flush(); os.fsync(handle.fileno())
                os.chmod(temp, 0o600)
                os.replace(temp, path)
            finally:
                if os.path.exists(temp): os.unlink(temp)
        except OSError:
            raise ReviewerError('STORE_UNAVAILABLE') from None
        return self._meta(item)

    def list(self):
        documents, unreadable = [], 0
        if self.dir.is_dir():
            for path in sorted(self.dir.glob('*.json')):
                try: documents.append(self._meta(self._load(path)))
                except (ReviewerError, FileNotFoundError): unreadable += 1
        documents.sort(key=lambda d: (d['added_at'] or '', d['id']), reverse=True)
        return {'documents': documents, 'unreadable': unreadable}

    def read(self, ident):
        """Texto exacto; FileNotFoundError si no existe, STORE_CORRUPT si no coincide con su hash."""
        return self._load(self._path(ident))['text']

    def remove(self, ident):
        path = self._path(ident)
        try: path.unlink()
        except FileNotFoundError: raise ReviewerError('NOT_FOUND') from None
        except OSError: raise ReviewerError('STORE_UNAVAILABLE') from None


class Store:
    def __init__(self, data: Path):
        self.path = Path(data) / 'reviewer' / 'passages.sqlite3'

    @contextmanager
    def connection(self):
        db = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(self.path.parent, 0o700)
            fd = os.open(self.path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            os.close(fd)
            os.chmod(self.path, 0o600)
            db = sqlite3.connect(self.path, timeout=5)
            db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE IF NOT EXISTS annotations (case_id TEXT NOT NULL, source TEXT NOT NULL, doc_id TEXT NOT NULL, id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS ann_scope ON annotations(case_id,source,doc_id)')
            with db: yield db
        except (sqlite3.Error, OSError):
            raise ReviewerError('STORE_UNAVAILABLE') from None
        finally:
            if db is not None: db.close()

    def list(self, cid, doc):
        check_case(cid)
        with self.connection() as db:
            rows = db.execute('SELECT data FROM annotations WHERE case_id=? AND source=? AND doc_id=? ORDER BY id',(cid, doc['source'], doc['doc_id'])).fetchall()
        result = []
        for row in rows:
            try:
                a = json.loads(row[0])
                if not isinstance(a, dict) or a.get('protocol') != PROTOCOL or a.get('case_id') != cid or a.get('doc_id') != doc['doc_id'] or a.get('source') != doc['source']:
                    raise ValueError
                required = ('source_sha256','state','annotation_id','version','start_offset','end_offset','text','author','labels','locator')
                if any(k not in a for k in required): raise ValueError
            except (ValueError, TypeError): raise ReviewerError('STORE_CORRUPT') from None
            if a['source_sha256'] != doc['sha256']: a['state'] = 'obsolete'
            result.append(a)
        return result

    def save(self, cid, doc, body):
        check_case(cid)
        ann = validate(doc, body)
        ident = body.get('annotation_id') or ann.annotation_id
        if not isinstance(ident,str) or not re.fullmatch(r'ann-[0-9a-f-]{36}', ident): raise ReviewerError('INVALID_ANNOTATION')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT version,data FROM annotations WHERE id=? AND case_id=? AND source=? AND doc_id=?',(ident,cid,doc['source'],doc['doc_id'])).fetchone()
            version = row[0] if row else 0
            if version != body['version'] or (body.get('annotation_id') and row is None): raise ReviewerError('CONFLICT')
            if row and json.loads(row[1])['source_sha256'] != doc['sha256']: raise ReviewerError('STALE_SOURCE')
            if not row and db.execute('SELECT COUNT(*) FROM annotations WHERE case_id=?',(cid,)).fetchone()[0] >= 1000:
                raise ReviewerError('CASE_LIMIT')
            a = dict(protocol=PROTOCOL, annotation_id=ident, case_id=cid, source=doc['source'],
                     doc_id=doc['doc_id'], source_sha256=doc['sha256'], locator=f"{doc['source']}:{doc['doc_id']}#cp={ann.start_offset}:{ann.end_offset}",
                     start_offset=ann.start_offset,end_offset=ann.end_offset,text=ann.text,
                     labels=body['labels'],author=ann.annotator,review_context='private_case_preparation',
                     state='reviewed', version=version+1, updated_at=ann.created_at, offset_unit=doc['offset_unit'])
            if row:
                db.execute('UPDATE annotations SET version=?,data=? WHERE id=?',(a['version'],json.dumps(a,ensure_ascii=False),ident))
            else:
                db.execute('INSERT INTO annotations VALUES (?,?,?,?,?,?)',(cid,doc['source'],doc['doc_id'],ident,a['version'],json.dumps(a,ensure_ascii=False)))
        return a

    def delete_document(self, source, doc_id):
        """Borra los pasajes de un documento en todos los casos; devuelve cuántos."""
        if source not in DOC_ID or not isinstance(doc_id, str) or not DOC_ID[source].fullmatch(doc_id):
            raise ReviewerError('INVALID_DOCUMENT')
        with self.connection() as db:
            return db.execute('DELETE FROM annotations WHERE source=? AND doc_id=?', (source, doc_id)).rowcount

    def export(self, cid, doc, ident):
        a = next((a for a in self.list(cid, doc) if a['annotation_id']==ident),None)
        if a is None: raise ReviewerError('NOT_FOUND')
        if a['state'] == 'obsolete': raise ReviewerError('STALE_SOURCE')
        body = {k:a[k] for k in ('start_offset','end_offset','text','author','labels','version','annotation_id')}
        ann = validate(doc, body)
        result = build_evidence_span(ann, AnnotationDocument(doc_id=doc['doc_id'],full_text=doc['text'],source_file=a['locator']))
        if result is None: raise ReviewerError('SNIPPET_MISMATCH')
        # Upstream's numeric manual confidence is NOT a legal confidence measure.
        result['annotation_id'] = a['annotation_id']
        result['evidence']['confidence'] = None
        result['evidence']['validated_by_human'] = True  # passage review only
        result['evidence']['validation_scope'] = 'human_selected_passage_not_legal_validity'
        result.update(protocol=PROTOCOL,annotation=a,warning=WARNING,
                      evidence_ref={'source_id':doc['doc_id'],'locator':a['locator'],'hash':doc['sha256']},
                      cita=f"«{a['text']}» — {a['locator']} · SHA256 {doc['sha256']} · {WARNING}")
        return result

    def proposal(self, cid, doc, ident):
        item = self.export(cid, doc, ident)
        a = item['annotation']
        return dict(protocol=PROTOCOL, status='PENDING_EXTERNAL_HITL_5', applied=False,
                    boundary='Desktop has no custody-signed HITL-5 submission adapter. Export only; never call /nif/edit.',
                    case_id=cid, evidence=item, patch={'operation':'append','field_path':'hypotheses',
                    'value':{'id':'reviewer-'+ident,'claim':a['text'],'type':'doctrinal','status':'needs_more_evidence',
                             'evidence_for':[item['evidence_ref']]},
                    'reason':'Pasaje seleccionado para preparación privada; requiere revisión de pertinencia y custodia.'})
