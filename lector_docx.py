"""Lector DOCX con biblioteca estándar y límites antes de expandir tablas y XML."""
import io
import zipfile
import xml.etree.ElementTree as ET

_W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
_DOCX_MAX_ENTRADAS = 2000
_DOCX_MAX_XML = 20 * 1024 * 1024
_DOCX_MAX_RATIO = 100


class DocxInvalido(ValueError):
    """Documento dañado o fuera de los límites del lector."""


class _ArbolAcotado(ET.TreeBuilder):
    def __init__(self):
        super().__init__()
        self.elementos = self.profundidad = 0

    def doctype(self, name, pubid, system):
        raise DocxInvalido("DTD no permitido")

    def start(self, tag, attrs):
        self.elementos += 1
        self.profundidad += 1
        if self.elementos > 100_000 or self.profundidad > 128:
            raise DocxInvalido("XML demasiado complejo")
        return super().start(tag, attrs)

    def end(self, tag):
        self.profundidad -= 1
        return super().end(tag)


def _w_run_text(r) -> str:
    """Texto de un ``w:r``: equivalente a ``CT_R.text`` de python-docx."""
    partes = []
    for e in r:
        tag = e.tag
        if tag == _W + 't':
            partes.append(e.text or '')
        elif tag == _W + 'tab':
            partes.append('\t')
        elif tag == _W + 'cr':
            partes.append('\n')
        elif tag == _W + 'br':
            # Solo el salto de línea (textWrapping, el defecto) da '\n';
            # page/column producen ''.
            partes.append('\n' if e.get(_W + 'type', 'textWrapping') == 'textWrapping' else '')
        elif tag == _W + 'noBreakHyphen':
            partes.append('-')
        elif tag == _W + 'ptab':
            partes.append('\t')
    return ''.join(partes)


def _w_p_text(p) -> str:
    """Texto de un ``w:p``: concat de ``w:r`` y ``w:hyperlink`` directos, en orden."""
    partes = []
    for e in p:
        if e.tag == _W + 'r':
            partes.append(_w_run_text(e))
        elif e.tag == _W + 'hyperlink':
            partes.append(''.join(_w_run_text(r) for r in e if r.tag == _W + 'r'))
    return ''.join(partes)


def _w_tc_text(tc) -> str:
    """Texto de un ``w:tc``: sus ``w:p`` directos unidos por '\\n' (``_Cell.text``)."""
    return '\n'.join(_w_p_text(p) for p in tc if p.tag == _W + 'p')


def _w_tc_pr(tc):
    for c in tc:
        if c.tag == _W + 'tcPr':
            return c
    return None


def _w_tr_pr(tr):
    for c in tr:
        if c.tag == _W + 'trPr':
            return c
    return None


def _w_hijo(pr, tag):
    if pr is None:
        return None
    for c in pr:
        if c.tag == tag:
            return c
    return None


def _w_int(el, default):
    if el is None:
        return default
    try:
        return int(el.get(_W + 'val', default))
    except (TypeError, ValueError):
        return default


def _w_grid_span(tc) -> int:
    span = _w_int(_w_hijo(_w_tc_pr(tc), _W + 'gridSpan'), 1)
    if not 1 <= span <= 128:
        raise DocxInvalido('gridSpan fuera de límite')
    return span


def _w_vmerge(tc):
    """``w:vMerge/@w:val``: None si no hay elemento; 'continue' si falta el val."""
    vm = _w_hijo(_w_tc_pr(tc), _W + 'vMerge')
    if vm is None:
        return None
    return vm.get(_W + 'val', 'continue')


def _w_grid_before(tr) -> int:
    return _w_int(_w_hijo(_w_tr_pr(tr), _W + 'gridBefore'), 0)


def _w_tcs(tr):
    return [c for c in tr if c.tag == _W + 'tc']


def _w_grid_offset(tc, tr, pasos) -> int:
    """Columna de inicio de *tc* en la tabla (grid_before + spans previos)."""
    offset = _w_grid_before(tr)
    for sib in tr:
        pasos[0] -= 1
        if pasos[0] < 0:
            raise DocxInvalido("tabla demasiado compleja")
        if sib is tc:
            break
        if sib.tag == _W + 'tc':
            offset += _w_grid_span(sib)
    return offset


def _w_tc_at_offset(tr, offset, pasos):
    """El ``w:tc`` de *tr* que empieza en la columna *offset* (``tc_at_grid_offset``)."""
    remaining = offset - _w_grid_before(tr)
    for tc in _w_tcs(tr):
        pasos[0] -= 1
        if pasos[0] < 0:
            raise DocxInvalido("tabla demasiado compleja")
        if remaining < 0:
            break
        if remaining == 0:
            return tc
        remaining -= _w_grid_span(tc)
    raise DocxInvalido


def _w_resolve_tc(tc, trs, tr_index, pasos):
    """Resuelve fusiones verticales sin recursión y con trabajo acotado."""
    while True:
        pasos[0] -= 1
        if pasos[0] < 0:
            raise DocxInvalido("tabla demasiado compleja")
        if _w_vmerge(tc) != 'continue':
            return [tc] * _w_grid_span(tc)
        if tr_index == 0:
            raise DocxInvalido("fusión vertical sin origen")
        tc = _w_tc_at_offset(trs[tr_index - 1],
                             _w_grid_offset(tc, trs[tr_index], pasos), pasos)
        tr_index -= 1


def leer(data: bytes, limite: int = 400_000) -> str:
    """Texto de un .docx con zipfile + ElementTree, equivalente a ``_read_docx``.

    Límites anti zip-bomb: ≤ 2000 entradas, ``word/document.xml`` declarado
    ≤ 20 MB y razón de compresión ≤ 100, lectura acotada (nunca se fía del
    tamaño declarado), y rechazo de ``<!DOCTYPE``/``<!ENTITY``. Cualquier fallo
    estructural o de lectura levanta DocxInvalido.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if len(zf.infolist()) > _DOCX_MAX_ENTRADAS:
                raise DocxInvalido
            try:
                info = zf.getinfo('word/document.xml')
            except KeyError:
                raise DocxInvalido
            if info.file_size > _DOCX_MAX_XML:
                raise DocxInvalido
            if info.file_size and info.compress_size and \
                    info.file_size / info.compress_size > _DOCX_MAX_RATIO:
                raise DocxInvalido
            with zf.open(info) as stream:
                crudo = stream.read(_DOCX_MAX_XML + 1)
            if len(crudo) > _DOCX_MAX_XML:
                raise DocxInvalido
        root = ET.fromstring(crudo, parser=ET.XMLParser(target=_ArbolAcotado()))
        body = next((el for el in root.iter() if el.tag == _W + 'body'), None)
        if body is None:
            raise DocxInvalido
        partes, usado = [], 0

        def agregar(texto):
            nonlocal usado
            usado += len(texto.encode('utf-8')) + bool(partes)
            if usado > limite:
                raise DocxInvalido("texto extraído demasiado grande")
            partes.append(texto)

        pasos = [20_000]
        for child in body:
            if child.tag == _W + 'p':
                t = _w_p_text(child)
                if t.strip():
                    agregar(t)
        for child in body:
            if child.tag == _W + 'tbl':
                trs = [c for c in child if c.tag == _W + 'tr']
                if len(trs) > 10_000:
                    raise DocxInvalido('demasiadas filas')
                for ti, tr in enumerate(trs):
                    textos, usado_fila = [], 0
                    for tc in _w_tcs(tr):
                        for resuelto in _w_resolve_tc(tc, trs, ti, pasos):
                            texto = _w_tc_text(resuelto).strip()
                            # Se comprueba antes de repetir o unir el texto de las celdas.
                            usado_fila += len(texto.encode('utf-8')) + (3 if textos else 0)
                            if usado + usado_fila > limite:
                                raise DocxInvalido("texto extraído demasiado grande")
                            textos.append(texto)
                    celdas = [t.strip() for t in textos if t.strip()]
                    if celdas:
                        agregar(' | '.join(celdas))
        return '\n'.join(partes)
    except DocxInvalido:
        raise
    except Exception:
        raise DocxInvalido('documento ilegible') from None
