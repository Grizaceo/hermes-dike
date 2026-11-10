#!/usr/bin/env python3
"""CLI del framework de ordenamientos jurídicos (solo stdlib, sin red).

Uso:
  python scripts/ordenamiento.py plantilla --jur xx --dir CARPETA
  python scripts/ordenamiento.py validar-perfil PERFIL.json
  python scripts/ordenamiento.py construir --perfil P.json --config C.json --salida DIR [--force] [--obtenido ISO]
  python scripts/ordenamiento.py validar-pack --perfil P.json --pack DIR [--texto]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

_RAIZ = Path(__file__).resolve().parents[1]


def _paquete():
    """Carga ``ordenamiento/`` por ruta como paquete ``dike_ordenamiento``."""
    if "dike_ordenamiento" in sys.modules:
        return sys.modules["dike_ordenamiento"]
    spec = importlib.util.spec_from_file_location(
        "dike_ordenamiento",
        _RAIZ / "ordenamiento" / "__init__.py",
        submodule_search_locations=[str(_RAIZ / "ordenamiento")])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["dike_ordenamiento"] = mod
    spec.loader.exec_module(mod)
    return mod


def _canon(v) -> bytes:
    return json.dumps(v, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _salida_json(valor) -> None:
    sys.stdout.write(json.dumps(valor, ensure_ascii=False, indent=2) + "\n")


def _cmd_plantilla(args) -> int:
    mod = _paquete()
    destino = Path(args.dir)
    destino.mkdir(parents=True, exist_ok=True)
    perfil_path = destino / f"perfil-{args.jur}.json"
    paquete_path = destino / "paquete.json"
    perfil_path.write_bytes(_canon(mod.plantilla_perfil(args.jur)))
    paquete_path.write_bytes(_canon(mod.plantilla_paquete()))
    _salida_json({"ok": True, "perfil": str(perfil_path), "paquete": str(paquete_path),
                  "nota": "completa los campos «COMPLETAR» antes de validar y construir"})
    return 0


def _cmd_validar_perfil(args) -> int:
    mod = _paquete()
    perfil = mod.cargar_perfil(args.perfil)
    errores = mod.validar_perfil(perfil)
    _salida_json({"ok": not errores, "perfil": args.perfil, "errores": errores})
    return 0 if not errores else 1


def _cmd_construir(args) -> int:
    mod = _paquete()
    try:
        resultado = mod.construir(args.perfil, args.config, args.salida,
                                  obtenido=args.obtenido, force=args.force)
    except (ValueError, FileNotFoundError, KeyError) as exc:
        _salida_json({"ok": False, "error": str(exc)})
        return 1
    _salida_json(resultado)
    return 0


def _resumen_texto(informe: dict) -> str:
    lineas = [
        f"pack: {informe['pack']}",
        f"perfil: {informe['perfil']['id']}@{informe['perfil']['version']}",
        f"nivel alcanzado: {informe['nivelAlcanzado']}",
    ]
    for nivel in ("C0", "C1", "C2", "C3"):
        datos = informe["niveles"][nivel]
        if datos.get("estado") == "no_evaluado" or "estado" in datos and "ok" not in datos:
            lineas.append(f"{nivel}: no_evaluado — {datos.get('nota', '')}")
            continue
        estado = "ok" if datos.get("ok") else "con errores"
        lineas.append(f"{nivel}: {estado} — {len(datos.get('errores', []))} errores listados "
                      f"({datos.get('truncados', 0)} truncados)")
        conteos = datos.get("conteos") or {}
        if conteos.get("porTipo"):
            partes = ", ".join(f"{k}={v}" for k, v in sorted(conteos["porTipo"].items()))
            lineas.append(f"  nodos: {conteos.get('nodos', '?')} ({partes})")
        elif conteos:
            partes = ", ".join(f"{k}={v}" for k, v in sorted(conteos.items()))
            lineas.append(f"  conteos: {partes}")
        reac = (datos.get("conteos", {}) or {}).get("idsReacuniados") or {}
        if reac.get("total") is not None:
            lineas.append(f"  ids re-acuñados: {reac['ok']}/{reac['total']}")
        for err in datos.get("errores", [])[:10]:
            lineas.append(f"  [{err['codigo']}] {err['ruta']}: {err['explicacion']}")
    if informe.get("excepcionesAplicadas"):
        lineas.append("excepciones aplicadas: " + ", ".join(
            str(e.get("idLocal")) for e in informe["excepcionesAplicadas"]))
    if informe.get("advertencias"):
        lineas.append("advertencias:")
        for adv in informe["advertencias"]:
            lineas.append(f"  [{adv['codigo']}] {adv['explicacion']}")
    lineas.append(f"gid: {informe['gid']}")
    return "\n".join(lineas)


def _cmd_validar_pack(args) -> int:
    mod = _paquete()
    informe = mod.validar_pack(args.pack, args.perfil)
    if args.texto:
        sys.stdout.write(_resumen_texto(informe) + "\n")
    else:
        _salida_json(informe)
    return 0 if informe["nivelAlcanzado"] == "C1" else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plantilla", help="escribe perfil-<jur>.json y paquete.json de ejemplo")
    p.add_argument("--jur", required=True)
    p.add_argument("--dir", required=True)
    p.set_defaults(fn=_cmd_plantilla)

    p = sub.add_parser("validar-perfil", help="valida un perfil de ordenamiento")
    p.add_argument("perfil")
    p.set_defaults(fn=_cmd_validar_perfil)

    p = sub.add_parser("construir", help="construye un pack dike-ordenamiento-pack-v1")
    p.add_argument("--perfil", required=True)
    p.add_argument("--config", required=True)
    p.add_argument("--salida", required=True)
    p.add_argument("--force", action="store_true")
    p.add_argument("--obtenido", default=None, help="timestamp ISO fijo para corridas reproducibles")
    p.set_defaults(fn=_cmd_construir)

    p = sub.add_parser("validar-pack", help="informe de compatibilidad C0–C3 de un pack")
    p.add_argument("--perfil", required=True)
    p.add_argument("--pack", required=True)
    p.add_argument("--texto", action="store_true", help="resumen legible en vez de JSON")
    p.set_defaults(fn=_cmd_validar_pack)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
