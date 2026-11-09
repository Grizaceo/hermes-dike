"""Chequeo estático de expansión JSON-LD 1.1 (sin dependencias).

``claves_no_definidas`` recorre primer nivel y objetos anidados y devuelve las
rutas de las claves que el contexto no define: ni término, ni CURIE con prefijo
declarado, ni IRI absoluto. Es la misma lógica que ``f0_factibilidad.py:jsonld``.
"""
from __future__ import annotations


def _como_contexto(contexto) -> dict:
    if isinstance(contexto, dict) and "@context" in contexto:
        return contexto["@context"]
    return contexto if isinstance(contexto, dict) else {}


def claves_no_definidas(nodo: dict, contexto) -> list[str]:
    """Rutas (``eli.date_entry_in_force``) de claves que el contexto no expande."""
    ctx = _como_contexto(contexto)
    terminos = {k for k in ctx if not k.startswith("@")}
    prefijos = {k for k, v in ctx.items()
                if isinstance(v, str) and v.endswith(("#", "/"))}

    def expande(clave: str) -> bool:
        if clave.startswith("@") or clave in terminos:
            return True
        if ":" in clave:
            prefijo = clave.split(":", 1)[0]
            return prefijo in prefijos or clave.startswith(("http://", "https://"))
        return "@vocab" in ctx

    perdidas: list[str] = []

    def caminar(valor, ruta: str) -> None:
        if isinstance(valor, dict):
            for clave, sub in valor.items():
                subruta = f"{ruta}.{clave}" if ruta else clave
                if not expande(clave):
                    perdidas.append(subruta)
                caminar(sub, subruta)
        elif isinstance(valor, list):
            for elemento in valor:
                caminar(elemento, ruta)

    caminar(nodo, "")
    return sorted(set(perdidas))
