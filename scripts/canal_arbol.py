"""Canal Árbol — clasificación de consultas por materia y acotado de búsqueda.

El mapa conceptual (arbol_derecho_anclas.json) define qué materias existen y
qué artículos ancla las representan. Este módulo le da a Diké una forma de
"entender el mapa":

1. Perfil de cada nodo-materia: nombre + anclas (términos del corpus con IDF).
2. clasificar(query): puntúa cada nodo contra la query por cobertura léxica
   ponderada por IDF (un término raro como "finiquito" pesa más que "laboral").
3. territorio(nodo): anclas + códigos del corpus que la materia abarca.

El resultado es auditable: cada decisión declara qué términos activaron cada
nodo, para mostrar al humano por qué se eligió esa materia. NO reordena la
búsqueda: es explicación, no priorización (medido: el boost del árbol no
mejora el ranking — ver claims y docs).

Vendorizado desde `indexo-retriever-prod/canal_arbol.py` (commit 32a0d86) con
estas adaptaciones mínimas:

- `from _vendor.dike_id import …` → `from dike_id import …` (el paquete ya
  vendorizado en `motor/dike_id`, byte a byte idéntico al de IndexO).
- `ARBOL_PATH`/`LEXICON_PATH`: rutas fijas dentro del plugin
  (`data/arbol/…`), sin variables de entorno ni rutas absolutas de máquina.
  `CanalArbol` acepta `arbol_path`/`lexicon_path` opcionales para tests.
- Quitados `buscar()` (el boost, que no entra: no reordena) y
  `_MATERIA_A_NODO`/`materia_a_nodo` (helper del goldset de IndexO).
  Quedan `codigo_umj`, `NODO_CODIGOS`, `CanalArbol` con `_cargar_lexicon`,
  `_cargar`, `_descendientes`, `clasificar` y `territorio`. Sin otros
  cambios de lógica ni de constantes.
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter, defaultdict
from functools import cache
from pathlib import Path

from lexo_cli.starter.retrieval import terminos, familia

# dike-id vendorizado en motor/dike_id (idéntico al _vendor de IndexO):
# lectura dual de GID, runtime y v2.
from dike_id import ErrorGID, leer_etiqueta_legada, parse as parse_gid_v2
from dike_id.registros import alias_umj

_V2 = "cl.v2.norma."
_RUNTIME = re.compile(r"cl\.norma\.([a-z0-9_-]+):art:([a-z0-9_-]+)")
_PALABRAS = re.compile(r"[a-z]+(?:_[a-z]+)*")


def _token_runtime(etiqueta: str) -> bool:
    """Lector estricto (punto 5): la etiqueta es exactamente la que el runtime escribe.

    Misma regla que `lexo_cli/gid.py`; rechaza `art:0000`, `0007qua`, `0007bis`, `11`.
    """
    if _PALABRAS.fullmatch(etiqueta):
        return True
    leido, _ = leer_etiqueta_legada(etiqueta)
    if leido is None or leido[3] != "runtime":
        return False
    n, suf, trans, _ = leido
    return ("t_" if trans else "") + f"{n:04d}" + "".join(f"_{t}" for t in suf) == etiqueta


@cache
def _umj_de_slug() -> dict[str, str]:
    return {slug: umj for umj, slug in alias_umj().items()}


def codigo_umj(gid: str) -> str:
    """Código UMJ de un GID runtime (`cl.norma.cc:…`) o v2 (`cl.v2.norma.codigo_civil:…`).

    Devuelve "" si no se puede saber sin inventar: GID runtime que no es identidad de artículo (`art:0000`,
    etiqueta truncada o sin relleno, raíz, subunidad), GID v2 mal formado, o slug sin código UMJ en el
    registro de dike-id (las normas bloqueadas no entran).
    """
    if gid.startswith("cl.norma."):
        m = _RUNTIME.fullmatch(gid)
        return m.group(1) if m and _token_runtime(m.group(2)) else ""
    if gid.startswith(_V2):
        try:
            return _umj_de_slug().get(parse_gid_v2(gid)["slug"], "")
        except ErrorGID:
            return ""
    return ""

# Datos del árbol — empaquetados en el plugin (data/arbol/), sin red ni
# variables de entorno. El constructor permite inyectar otras rutas (tests).
_ARBOL_DIR = Path(__file__).resolve().parent.parent / "data" / "arbol"
ARBOL_PATH = _ARBOL_DIR / "arbol_derecho_anclas.json"
LEXICON_PATH = _ARBOL_DIR / "arbol_lexicon.json"

# Peso del lexicón frente a anclas/nombre: el lexicón es señal conceptual fuerte
_PESO_LEXICON = 3.0

# Peso del perfil (nombre + anclas) frente al lexicón: los anclas arrastran
# vocabulario del código completo (ej. ley 18.046 repite "sociedad"/"acciones"
# en 10 anclas) y dominan por cantidad. Se deja como señal secundaria.
_PESO_PERFIL = 0.8

# Tope del peso de un término del perfil de anclas: la repetición en muchas
# anclas NO debe hacer que un término genérico ("contrato") domine sobre la
# señal específica de otra materia ("compraventa").
_PESO_PERFIL_MAX = 2.5

# IDF mínimo para que un término del perfil de anclas/nombre participe.
# Términos como "caso", "acción" o "plazo" aparecen en todo el corpus y
# contaminan la clasificación: el lexicón ya aporta el vocabulario de materia.
_IDF_PISO_PERFIL = 2.5

# Mapa explícito de códigos por nodo del árbol. Es EL territorio de cada
# materia en el corpus: lo que "Indexo debe saber" para acotar dónde buscar.
# Si un nodo no está en el mapa, se deriva de sus anclas (o de sus hijos).
NODO_CODIGOS = {
    # ── Civil ──
    "civil": ["cc"], "persona": ["cc"], "familia": ["cc", "ley_19968", "ley_20066"],
    "filiacion": ["cc"], "bienes": ["cc"], "acto": ["cc"], "obligaciones": ["cc"],
    "contratos-g": ["cc"], "contratos-e": ["cc"], "resp": ["cc"], "sucesorio": ["cc"],
    # ── Comercial ──
    "comercial": ["ccom", "cc"],
    "sociedades": ["ccom", "cc", "ley_18046"],
    "nmt54oatsmhw6": ["ley_18046"], "nmt54vz8qe6ei": ["ccom", "cc"],
    "nmt54oay8v1vp": ["ccom"], "nmt54rb8b2to8": ["cc", "ccom"],
    "nmt54xoo7fkfw": ["ccom", "cc"], "nmt54oaoxrw30": ["ccom"],
    "titulos-credito": ["ley_18092", "ccom"],
    "insolvencia": ["ley_20720"], "nmt541j87bl7r": ["ley_20720"],
    "bancario": ["ccom"], "seguros": ["ccom"],
    "consumidor": ["ley_19496"], "consumidor-sancionatorio": ["ley_19496"],
    # ── Público ──
    "publico": ["cpr", "dfl_1122"], "constitucional": ["cpr"],
    "administrativo": ["dfl_1122", "cpr"], "penal": ["cp", "ley_18216", "ley_20000"],
    "penal-general": ["cp"], "penal-especial": ["cp", "ley_18216", "ley_20000"],
    "procesal-penal": ["cpp", "cot"], "tributario": ["ctrib"],
    "tributario-procedimiento": ["ctrib"], "tributario-sanciones": ["ctrib"],
    "laboral": ["ct", "ley_16744", "ley_19728"], "laboral-individual": ["ct"],
    "laboral-colectivo": ["ct"], "seguridad-social": ["dl_3500", "ley_19728", "ley_16744"],
    "ambiental": ["cpr"], "minero": ["cc"], "aguas": ["cc"], "agrario": ["cc"],
    "propiedad-int": ["cc"], "datos": ["ley_19628"],
    "derechos-humanos": ["cpr"], "migratorio": ["cpr"], "electoral": ["cpr"],
    "urbanistico": ["dfl_1122"], "libre-competencia": ["cpr"],
    # ── Procesal ──
    "procesal": ["cpc", "cot"],
    "jordinario": ["cpc"], "jejecutivo": ["cpc", "ley_17322"],
    "incidentes": ["cpc"], "recursos": ["cpc", "cpp", "ct", "cot"],
    "prueba": ["cpc"], "dispcomunes": ["cpc"], "organico": ["cot"],
    "tribunales": ["cot"], "jurisdiccion": ["cot", "cpc"],
    "cautelares": ["cpc", "cpp"], "nulidad-procesal": ["cpc"],
    "cosa-juzgada": ["cpc"], "prejudiciales": ["cpc"],
    "juicio-sumario": ["cpc"], "juicios-especiales": ["cpc"],
    "arbitraje": ["cpc"], "procedimiento-laboral": ["ct"],
    "procedimiento-familia": ["ley_19968"],
}


class CanalArbol:
    def __init__(self, retriever, *, arbol_path=None, lexicon_path=None):
        self.retriever = retriever
        # Capture the sources used by this instance, not a server fallback.
        self.arbol_path = Path(arbol_path) if arbol_path else ARBOL_PATH
        self.lexicon_path = Path(lexicon_path) if lexicon_path else LEXICON_PATH
        self.arbol = None
        self.nodos: list[dict] = []
        self.by_id: dict[str, dict] = {}
        self.perfiles: dict[str, Counter] = {}   # nodo_id -> {term: peso}
        self.nodo_codigos: dict[str, set] = {}   # nodo_id -> {codigo}
        self.nodo_anclas: dict[str, list] = {}   # nodo_id -> [gid]
        self.lexicon: dict[str, list[str]] = {}  # nodo_id -> [términos]
        self._cargar_lexicon()
        self._cargar()

    def _cargar_lexicon(self):
        if self.lexicon_path.exists():
            try:
                with open(self.lexicon_path, encoding="utf-8") as f:
                    self.lexicon = json.load(f)
            except Exception as e:
                logging.warning("lexicón inválido: %s", e)
                self.lexicon = {}

    # -- carga ----------------------------------------------------------

    def _cargar(self):
        if not self.arbol_path.exists():
            logging.warning("árbol no encontrado en %s", self.arbol_path)
            return
        with open(self.arbol_path, encoding="utf-8") as f:
            self.arbol = json.load(f)
        self.nodos = self.arbol.get("nodos", [])
        self.by_id = {n["id"]: n for n in self.nodos}

        # Anclas por nodo
        for n in self.nodos:
            an = list(n.get("anclas", []) or [])
            self.nodo_anclas[n["id"]] = an

        # Códigos por nodo: prioridad al mapa explícito NODO_CODIGOS (el
        # territorio que define la materia en el corpus), fallback a anclas.
        for n in self.nodos:
            cods = set(NODO_CODIGOS.get(n["id"], []))
            if not cods:
                for gid in n.get("anclas", []) or []:
                    if cod := codigo_umj(gid):
                        cods.add(cod)
            self.nodo_codigos[n["id"]] = cods

        # Heredar códigos de descendientes (nodo padre sin anclas propias)
        for n in self.nodos:
            if self.nodo_codigos[n["id"]]:
                continue
            for d in self._descendientes(n["id"]):
                self.nodo_codigos[n["id"]].update(self.nodo_codigos.get(d, set()))

        # Perfil léxico de cada nodo — solo términos CENTRALES de las anclas
        # (aparecen en ≥2 anclas del nodo) y discriminativos (IDF alto).
        # "Caso" apareciendo en un solo artículo de la ley de S.A. no define
        # la materia: contamina. Un término que se repite en varias anclas sí.
        for n in self.nodos:
            if n.get("tipo") not in ("materia", "rama"):
                continue
            anclas = n.get("anclas", []) or []
            nombre = n.get("nombre", "") or ""
            perfil: Counter = Counter()
            for t in terminos(nombre):
                perfil[t] += 2.0
            # conteo por ancla: cuántos artículos distintos mencionan el término
            por_ancla: dict[str, int] = defaultdict(int)
            for gid in anclas:
                ev = getattr(self.retriever.resolver, "_by_gid", {}).get(gid)
                if ev and ev.text:
                    vistos = set()
                    for t in terminos(ev.text):
                        if t not in vistos:
                            vistos.add(t)
                            por_ancla[t] += 1
            for t, n_anclas in por_ancla.items():
                if n_anclas >= 2:  # central: aparece en al menos 2 anclas
                    idf = self.retriever._idf.get(t, 0.0)
                    if idf >= _IDF_PISO_PERFIL:
                        # Peso satura en 2.5: un término en 20 anclas no debe
                        # pesar 10x que uno en 2 anclas. "contrato" repetido
                        # en 15 anclas de laboral aplastaba "compraventa".
                        perfil[t] = min(1.0 + 0.5 * (n_anclas - 2), _PESO_PERFIL_MAX)
            self.perfiles[n["id"]] = perfil

    def _descendientes(self, nid: str) -> list[str]:
        out = []
        for n in self.nodos:
            if n.get("padre") == nid:
                out.append(n["id"])
                out.extend(self._descendientes(n["id"]))
        return out

    # -- clasificación ---------------------------------------------------

    def clasificar(self, query: str, top: int = 3) -> list[dict]:
        """Puntúa los nodos del árbol contra la query.

        Devuelve [{nodo, nombre, score, términos, cobertura, rama}].
        Señales combinadas:
        - perfil del nodo (nombre + anclas), ponderado por IDF del corpus
        - lexicón conceptual de la materia (peso fijo, no depende del corpus)
        """
        self.retriever._indexar()
        q_terms = terminos(query)
        if not q_terms:
            return []
        q_fams = set(familia(t) for t in q_terms)
        q_str = " ".join(q_terms)

        resultados: list[dict] = []
        for nid, perfil in self.perfiles.items():
            score = 0.0
            activos: list[str] = []
            # 1. Señal de anclas/nombre (IDF del corpus) — peso secundario
            for t, peso in perfil.items():
                if t in q_terms:
                    idf = self.retriever._idf.get(t, 0.0)
                    score += idf * peso * _PESO_PERFIL
                    activos.append(t)
            # 2. Señal del lexicón conceptual — matcheo por tokens de la frase:
            # "caso fortuito" debe activar si la query dice "caso" o "fortuito".
            # La frase nombra un concepto; cualquiera de sus términos lo evoca.
            for t in self.lexicon.get(nid, []):
                tokens = terminos(t)
                if not tokens:
                    continue
                if any(familia(tok) in q_fams for tok in tokens):
                    score += _PESO_LEXICON
                    activos.append(t)
            if score <= 0:
                continue
            # Cobertura: cuántas familias distintas de la query toca
            activos_fam = set(familia(t) for t in activos)
            cubiertos = len(activos_fam & q_fams)
            cobertura = cubiertos / len(q_fams) if q_fams else 0.0
            score_final = score * (0.5 + 0.5 * cobertura)
            n = self.by_id.get(nid, {})
            resultados.append({
                "nodo": nid,
                "nombre": n.get("nombre", nid),
                "rama": n.get("rama", ""),
                "score": round(score_final, 4),
                "terminos": activos[:8],
                "cobertura": round(cobertura, 2),
                "n_anclas": len(self.nodo_anclas.get(nid, [])),
            })

        resultados.sort(key=lambda p: -p["score"])
        return resultados[:top]

    # -- acotado ---------------------------------------------------------

    def territorio(self, nodo_id: str) -> dict:
        """Anclas + códigos que el nodo abarca (para UI/debug)."""
        return {
            "nodo": nodo_id,
            "nombre": self.by_id.get(nodo_id, {}).get("nombre", nodo_id),
            "anclas": self.nodo_anclas.get(nodo_id, []),
            "codigos": sorted(self.nodo_codigos.get(nodo_id, set())),
        }
