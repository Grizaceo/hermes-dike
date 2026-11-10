#!/usr/bin/env python3
"""Verifica que desktop/plugin.js es un plugin runtime aceptable para la app.

El cargador de plugins de Hermes Desktop (apps/desktop/src/contrib/
runtime-loader.ts) evalúa el archivo como ESM y solo permite imports a
``@hermes/plugin-sdk`` y ``react*``. Este script replica EXACTAMENTE su lógica:

- ``codeRanges`` (estados code/single/double/template/line-comment/
  block-comment, con literales regex y `${…}` de templates como código);
- ``importSpecifierRe``: ``from '…'``, ``import '…'`` e ``import('…')`` solo
  cuentan cuando caen dentro de un rango de código;
- la lista blanca: @hermes/plugin-sdk, react, react/jsx-runtime,
  react/jsx-dev-runtime.

Además rechaza, también solo en código: ``import(`` dinámico (aunque el
especificador no sea literal), ``eval(`` y ``new Function``.

Uso: python3 scripts/check_desktop_bundle.py [ruta-a-plugin.js]
Sale 0 si el bundle pasa, 1 con los hallazgos en stderr.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ALLOWED = {
    "@hermes/plugin-sdk",
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
}

IMPORT_SPECIFIER_RE = re.compile(r"(from\s*|import\s*\(\s*|import\s+)(['\"])([^'\"]+)\2")
DYNAMIC_IMPORT_RE = re.compile(r"\bimport\s*\(")
EVAL_RE = re.compile(r"\beval\s*\(")
NEW_FUNCTION_RE = re.compile(r"\bnew\s+Function\b")

REGEX_KEYWORD_RE = re.compile(
    r"^(?:await|case|delete|do|else|in|instanceof|new|of|return|throw|typeof|void|yield)$")


def _is_regex_start(source: str, slash: int) -> bool:
    """La ``/`` en ``slash`` abre un literal regex (no ``//`` ni ``/*``)."""
    j = slash - 1
    while j >= 0 and source[j].isspace():
        j -= 1
    if j < 0:
        return True
    prev = source[j]
    if prev in "+-":
        return j - 1 < 0 or source[j - 1] != prev
    if prev in ")]'\"" or prev == "`":
        return False
    if prev == "}":
        return True
    if re.match(r"[A-Za-z0-9_$]", prev):
        k = j
        while k >= 0 and re.match(r"[A-Za-z0-9_$]", source[k]):
            k -= 1
        if source[k] == ".":
            return False
        return bool(REGEX_KEYWORD_RE.match(source[k + 1:j + 1]))
    return True


def _regex_end(source: str, slash: int) -> int:
    """Fin (exclusivo) del literal regex abierto en ``slash``; -1 si no cierra."""
    j = slash + 1
    in_class = False
    while j < len(source):
        c = source[j]
        if c == "\\":
            j += 2
        elif c == "\n":
            return -1
        elif c == "[":
            in_class = True
            j += 1
        elif c == "]":
            in_class = False
            j += 1
        elif c == "/" and not in_class:
            j += 1
            while j < len(source) and source[j].isalpha():
                j += 1
            return j
        else:
            j += 1
    return -1


def code_ranges(source: str) -> list[tuple[int, int]]:
    """Rangos de caracteres que son CÓDIGO (strings, templates y comentarios
    fuera; interpolaciones ${…} de templates dentro). Port de codeRanges()."""
    ranges: list[tuple[int, int]] = []
    stack: list[str] = []
    state = "code"
    code_start = 0
    i = 0
    n = len(source)

    def close(end: int) -> None:
        if end > code_start:
            ranges.append((code_start, end))

    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""

        if state == "code":
            if ch == "/" and nxt == "/":
                close(i)
                state = "line-comment"
                i += 2
            elif ch == "/" and nxt == "*":
                close(i)
                state = "block-comment"
                i += 2
            elif ch == "'":
                close(i)
                state = "single"
                i += 1
            elif ch == '"':
                close(i)
                state = "double"
                i += 1
            elif ch == "`":
                close(i)
                stack.append("template")
                state = "template"
                i += 1
            elif ch == "/":
                end = _regex_end(source, i) if _is_regex_start(source, i) else -1
                if end > 0:
                    close(i)
                    i = end
                    code_start = i
                else:
                    i += 1
            elif ch == "}" and stack and stack[-1] == "expr":
                close(i)
                stack.pop()
                state = "template"
                i += 1
            else:
                i += 1
            continue

        if state == "line-comment":
            if ch == "\n":
                state = "code"
                code_start = i
            i += 1
            continue

        if state == "block-comment":
            if ch == "*" and nxt == "/":
                i += 2
                state = "code"
                code_start = i
            else:
                i += 1
            continue

        if state in ("single", "double"):
            if ch == "\\":
                i += 2
            elif ch == ("'" if state == "single" else '"'):
                i += 1
                state = "code"
                code_start = i
            elif ch == "\n":
                i += 1
                state = "code"
                code_start = i
            else:
                i += 1
            continue

        # Texto de template literal.
        if ch == "\\":
            i += 2
        elif ch == "$" and nxt == "{":
            stack.append("expr")
            state = "code"
            i += 2
            code_start = i
        elif ch == "`":
            stack.pop()
            state = "code"
            i += 1
            code_start = i
        else:
            i += 1

    close(n)
    return ranges


def _in_code(ranges: list[tuple[int, int]], at: int) -> bool:
    for start, end in ranges:
        if at < start:
            return False
        if at < end:
            return True
    return False


def check(source: str) -> list[str]:
    """Lista de hallazgos; vacía si el bundle es aceptable."""
    findings: list[str] = []
    ranges = code_ranges(source)

    for m in IMPORT_SPECIFIER_RE.finditer(source):
        if not _in_code(ranges, m.start()):
            continue
        spec = m.group(3)
        if spec not in ALLOWED:
            findings.append(f"import no permitido: {spec!r} (offset {m.start()})")

    for pattern, nombre in (
        (DYNAMIC_IMPORT_RE, "import() dinámico"),
        (EVAL_RE, "eval()"),
        (NEW_FUNCTION_RE, "new Function"),
    ):
        for m in pattern.finditer(source):
            if _in_code(ranges, m.start()):
                findings.append(f"{nombre} en código (offset {m.start()})")

    return findings


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path(__file__).resolve().parent.parent / "desktop" / "plugin.js")
    if not path.is_file():
        print(f"no existe {path}: corre `npm run build` en desktop/", file=sys.stderr)
        return 1
    findings = check(path.read_text(encoding="utf-8"))
    if findings:
        for f in findings:
            print(f"check_desktop_bundle: {f}", file=sys.stderr)
        return 1
    print(f"check_desktop_bundle: OK ({path.name}, {path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
