#!/usr/bin/env python3
"""Mide la búsqueda por contenido del panel contra un qrels congelado.

    python scripts/medir_busqueda.py --qrels PATH --corpus <dir current>

Para cada consulta del qrels corre ``panel.buscar`` — el mismo BM25
determinista que sirve ``POST /grafo/buscar`` — y contrasta los gids
devueltos, en orden y top 10, con los gids esperados. Métricas: recall@5 y
recall@10 promediados por consulta (crédito parcial cuando la consulta
espera varios gids) y MRR@10 (recíproco del rango del primer gid esperado).

Imprime un JSON con ``n``, las métricas, el sha256 del archivo qrels, el
pack y dos campos del árbol de materias (Fase 2, solo explicación):
``materia_top1_cubre_esperado`` cuenta en cuántas consultas el código UMJ
de algún gid esperado cae en los ``codigos`` de la materia top 1, y
``clara`` en cuántas la clasificación fue inequívoca (ratio ≥ 1.6). Ninguno
toca el ranking: son ``"k/n"`` y ``"m/n"``.

Ni el qrels ni el corpus se copian al repo: ambos se pasan por ruta.

Referencia de desarrollo (no es una promesa del producto): sobre el pack
instalado y ``normas_qrels_v1`` da recall@5 0.823, recall@10 0.952,
mrr@10 0.636 — medición dentro de la muestra, porque los qrels se congelaron
con este mismo recuperador y sus constantes se fijaron mirando el goldset
de origen.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

_PANEL = Path(__file__).resolve().parent / "panel.py"


def _cargar_panel():
    spec = importlib.util.spec_from_file_location("dike_panel_medicion", _PANEL)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _metricas(consultas: list[dict], rankings: list[list[str]]) -> dict:
    """Recall@5/@10 por consulta (crédito parcial) y MRR@10, promediados."""
    n = len(consultas)
    r5 = r10 = mrr = 0.0
    for consulta, gids in zip(consultas, rankings):
        esperados = set(consulta.get("expected_gids") or [])
        if not esperados:
            continue
        top5, top10 = set(gids[:5]), set(gids[:10])
        r5 += len(esperados & top5) / len(esperados)
        r10 += len(esperados & top10) / len(esperados)
        for i, gid in enumerate(gids[:10]):
            if gid in esperados:
                mrr += 1.0 / (i + 1)
                break
    return {
        "n": n,
        "recall@5": round(r5 / n, 3),
        "recall@10": round(r10 / n, 3),
        "mrr@10": round(mrr / n, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--qrels", required=True, type=Path,
                        help="JSON de consultas con query y expected_gids.")
    parser.add_argument("--corpus", required=True, type=Path,
                        help="Directorio `current` del corpus a medir.")
    args = parser.parse_args()

    qrels_bytes = args.qrels.read_bytes()
    qrels = json.loads(qrels_bytes.decode("utf-8"))
    consultas = qrels.get("queries") or []
    if not consultas:
        print("qrels sin consultas", file=sys.stderr)
        return 2

    panel = _cargar_panel()
    import canal_arbol  # panel ya dejó motor/ y scripts/ en sys.path

    corpus = [args.corpus]
    rankings: list[list[str]] = []
    arboles: list[dict] = []
    pack = ""
    for consulta in consultas:
        respuesta = panel.buscar(consulta["query"], limite=10, corpus_dirs=corpus)
        if not pack:
            pack = (respuesta.get("metodo") or {}).get("pack") or ""
        rankings.append([r["gid"] for r in respuesta.get("resultados") or []])
        arboles.append(respuesta.get("arbol") or {})

    salida = _metricas(consultas, rankings)

    n = len(consultas)
    cubre = claras = 0
    for consulta, arbol in zip(consultas, arboles):
        if arbol.get("clara"):
            claras += 1
        clasificacion = arbol.get("clasificacion") or []
        if not clasificacion:
            continue
        codigos = set(clasificacion[0].get("codigos") or [])
        esperados = consulta.get("expected_gids") or []
        if any(canal_arbol.codigo_umj(g) in codigos for g in esperados):
            cubre += 1
    salida["materia_top1_cubre_esperado"] = f"{cubre}/{n}"
    salida["clara"] = f"{claras}/{n}"

    salida["qrels_sha256"] = hashlib.sha256(qrels_bytes).hexdigest()
    salida["pack"] = pack
    print(json.dumps(salida, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
