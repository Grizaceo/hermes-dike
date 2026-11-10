#!/usr/bin/env python3
"""Servidor del motor: verifica el corpus una vez y atiende muchas consultas.

El motor revalida el corpus sellado entero en cada proceso (recorre y hashea
sus ~68.000 archivos: unos 10 s), y el plugin lanzaba un proceso por llamada.
Este servidor paga esa verificación una vez, la deja en la memoria del
proceso —donde el propio motor la cachea— y después bifurca (``fork``) un
hijo por pedido. El hijo hereda el corpus ya verificado, corre el comando
real (``lexo_cli`` o ``scripts/panel.py``) con su ``argv`` de siempre y
termina: ningún pedido ve el estado de otro, y lo que devuelve es lo mismo
que devolvería el proceso de un solo uso.

Lo lanza ``aislamiento.consultar`` con el mismo sandbox y el mismo entorno
que el proceso de un solo uso, y solo para pedidos de lectura sobre la
generación sellada. El motor vendorizado queda intacto: este archivo es
código del plugin.

Protocolo, una línea JSON por mensaje:

    ← {"listo": true}                                   al arrancar
    → {"cmd": "motor"|"panel", "argv": [...], "as_of": "AAAA-MM-DD", "stdin": "..."}
    ← {"rc": 0, "out": "...", "err": "..."}

El servidor termina solo cuando se cierra su entrada (murió quien lo lanzó)
o tras ``OCIOSO`` segundos sin pedidos: la siguiente llamada lanza otro y el
motor vuelve a verificar el corpus.
"""
from __future__ import annotations

import io
import json
import os
import select
import sys
import tempfile
import traceback
from datetime import date
from pathlib import Path

_AQUI = Path(__file__).resolve().parent
for _ruta in (str(_AQUI.parent / "motor"), str(_AQUI)):
    if _ruta not in sys.path:
        sys.path.insert(0, _ruta)

OCIOSO = 600


def _calentar(pedido: dict, hecho: set) -> None:
    """Carga en este proceso lo que el pedido va a necesitar, una vez.

    Nunca falla: si el corpus no carga, el hijo corre el comando real y es él
    quien informa el error, igual que el proceso de un solo uso.
    """
    clave = (pedido.get("cmd"), pedido.get("as_of"))
    if clave in hecho:
        return
    try:
        if pedido.get("cmd") == "panel":
            import panel
            panel.precalentar()
        else:
            from lexo_cli.config import load_config
            from lexo_cli.nif_studio.execution import canonical_resolver_for
            dia = pedido.get("as_of")
            canonical_resolver_for(
                load_config(), as_of=date.fromisoformat(dia) if dia else None)
        hecho.add(clave)
    except Exception:
        pass


def _correr(pedido: dict) -> int:
    """El comando real, en el hijo. Devuelve su código de salida."""
    argv = [str(a) for a in pedido["argv"]]
    if pedido["cmd"] == "panel":
        import panel
        sys.argv = ["panel.py", *argv]
        sys.stdin = io.StringIO(pedido.get("stdin") or "")
        return panel.main() or 0
    from lexo_cli.main import main
    sys.argv = ["dike", *argv]
    main()
    return 0


def _atender(pedido: dict) -> dict:
    """Bifurca un hijo para el pedido y devuelve su salida y su código."""
    sys.stdout.flush()
    sys.stderr.flush()
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        pid = os.fork()
        if pid == 0:
            codigo = 1
            try:
                os.dup2(out.fileno(), 1)
                os.dup2(err.fileno(), 2)
                codigo = _correr(pedido)
            except SystemExit as salida:
                # Como el intérprete: un código entero sale tal cual; None es 0;
                # otro valor se imprime en stderr y sale 1.
                if isinstance(salida.code, int):
                    codigo = salida.code
                elif salida.code is None:
                    codigo = 0
                else:
                    print(salida.code, file=sys.stderr)
            except BaseException:
                traceback.print_exc()
            finally:
                try:
                    sys.stdout.flush()
                    sys.stderr.flush()
                finally:
                    os._exit(codigo)
        _, estado = os.waitpid(pid, 0)
        out.seek(0)
        err.seek(0)
        return {"rc": os.waitstatus_to_exitcode(estado),
                "out": out.read().decode("utf-8", "replace"),
                "err": err.read().decode("utf-8", "replace")}


def main() -> int:
    # El protocolo usa copias de stdin/stdout; los descriptores 0 y 1 quedan
    # en /dev/null para que nada que imprima el motor al cargar lo ensucie.
    entrada = os.fdopen(os.dup(0), "rb")
    salida = os.fdopen(os.dup(1), "w", encoding="utf-8")
    nulo = os.open(os.devnull, os.O_RDWR)
    os.dup2(nulo, 0)
    os.dup2(nulo, 1)
    os.close(nulo)

    def responder(mensaje: dict) -> None:
        salida.write(json.dumps(mensaje) + "\n")
        salida.flush()

    hecho: set = set()
    responder({"listo": True})
    while select.select([entrada], [], [], OCIOSO)[0]:
        linea = entrada.readline()
        if not linea:
            break
        try:
            pedido = json.loads(linea)
            if (not isinstance(pedido, dict) or pedido.get("cmd") not in ("motor", "panel")
                    or not isinstance(pedido.get("argv"), list)):
                raise ValueError("pedido inválido")
        except ValueError:
            responder({"rc": 2, "out": "", "err": "pedido inválido"})
            continue
        _calentar(pedido, hecho)
        responder(_atender(pedido))
    return 0


if __name__ == "__main__":
    sys.exit(main())
