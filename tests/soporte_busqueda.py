"""Artículos sintéticos y escape del bundle para las pruebas de búsqueda."""
import hashlib

NORM_ID = 'https://dike.invalid/eli/cl/codigo/codigo-del-trabajo'


def _articulo_json(eid: str, label: str, texto: str) -> dict:
    sha = hashlib.sha256(texto.encode('utf-8')).hexdigest()
    return {
        '@type': 'Article',
        '@id': f'{NORM_ID}/art_{eid.removeprefix("art_")}',
        'isPartOf': NORM_ID,
        'eId': eid,
        'label': label,
        'text': texto,
        'textSha256': sha,
        'citation': {
            'status': 'CITABLE',
            'completenessVerified': True,
            'textSha256': sha,
            'verificationMethod': 'fixture sintético de tests',
        },
        'temporal': {'from': '2020-01-01'},
        'provenance': {'wasDerivedFrom': f'https://x.test/{eid}'},
    }



def _esbuild_ascii(texto: str) -> str:
    """La forma en que esbuild (charset ascii) escribe `texto` en el bundle.

    El runtime JS la decodifica de vuelta al string exacto; buscar el texto
    crudo fallaría porque el bundle escapa todo lo no-ASCII.
    """
    out = []
    for c in texto:
        cp = ord(c)
        if cp < 0x80:
            out.append(c)
        elif cp <= 0xFF:
            out.append('\\x%02X' % cp)
        elif cp <= 0xFFFF:
            out.append('\\u%04X' % cp)
        else:
            cp -= 0x10000
            out.append('\\u%04X\\u%04X'
                       % (0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)))
    return ''.join(out)
