---
name: dike-ordenamiento
description: "Guía al abogado experto por los 4 pasos del framework de ordenamientos jurídicos de Diké: plantilla, validar perfil, construir pack y validar pack (niveles C0–C3), con la CLI scripts/ordenamiento.py. Solo stdlib, offline, sin red."
version: 1.0.0
metadata:
  hermes:
    tags: [dike, ordenamiento, juridico, cli, perfiles]
---

# Ordenamientos jurídicos (dike-ordenamiento)

El plugin Diké modela grafos de normas por **ordenamiento jurídico** mediante un
perfil declarativo (`dike-perfil-ordenamiento-v1`) y un núcleo común v1. Chile
es el perfil de referencia; el país ficticio `xx` sirve de ejemplo.

Todo se hace con la CLI `scripts/ordenamiento.py` (solo stdlib, sin red, sin
instalar nada). Los comandos se corren desde la raíz del plugin.

## Los 4 pasos

### 1. Plantilla

```bash
python scripts/ordenamiento.py plantilla --jur xx --dir ./mi-pais
```

Escribe `perfil-xx.json` (con campos `COMPLETAR`) y `paquete.json` (config del
constructor). `--jur` es el código del ordenamiento (2 letras minúscula; admite
subdivisión tipo `mx-cmx`).

### 2. Validar el perfil

```bash
python scripts/ordenamiento.py validar-perfil ordenamiento/perfiles/cl.json
```

Salida JSON con la lista de errores `{codigo, ruta, explicacion}` (ruta tipo
`$.normas.tipos[2].nivel`). Exit 0 si no hay errores, 1 si los hay. La plantilla
falla hasta completar los `COMPLETAR`.

### 3. Construir el pack

```bash
python scripts/ordenamiento.py construir \
  --perfil ./mi-pais/perfil-xx.json \
  --config ./mi-pais/paquete.json \
  --salida ./mi-pack --obtenido 2026-11-09T00:00:00Z
```

`paquete.json` lista las normas con `idFuente`, `tipo`, `numero`, `anio`,
`titulo`, URIs de la fuente, `vigenteDesde` y `articulosArchivo` (ruta `.txt`
relativa al propio `paquete.json`, dentro de su directorio). `--obtenido` fija el
timestamp para corridas reproducibles; `--force` permite reconstruir sobre un
directorio no vacío. El constructor divide el texto con `patronArticulo` del
perfil, rechaza artículos duplicados, no positivos, cero artículos o texto
truncado, y pasa cada texto por el detector de privacidad del plugin: un
identificador personal crítico hace fallar la construcción.

### 4. Validar el pack

```bash
python scripts/ordenamiento.py validar-pack \
  --perfil ./mi-pais/perfil-xx.json --pack ./mi-pack --texto
```

Devuelve el informe `dike-informe-compatibilidad-v1` por niveles:

- **C0 formato y manifiesto**: MANIFEST con sha256 por archivo, hashes y bytes
  recomputados, sin rutas inseguras, sin symlinks, JSON canónico byte a byte.
- **C1 núcleo**: `pack.json` con `format` reconocido y perfil declarado
  coincidente en packs `dike-ordenamiento-pack-v1`; cada nodo es una clase del
  núcleo; las claves son términos del núcleo o extensiones declaradas; `@id`
  re-acuñados por plantilla; regla de año con excepciones declaradas.
- **C2 vigencia/procedencia y C3 extensiones mapeadas**: `no_evaluado` hoy.

Exit 0 solo si `nivelAlcanzado` es `C1`. El campo `gid` del informe declara que
los packs no `cl` aún no se verifican con la gramática dike-id (solo acepta `cl`).

## Qué prueba el perfil `cl`

`ordenamiento/perfiles/cl.json` reproduce el pack público sellado
`corpus/chile-base-*.tar.gz`: C0 y C1 en verde, 25 normas, 8.544 artículos,
8.569 ventanas de vigencia y 17.068 aristas re-acuñadas, con 3 excepciones de
año declaradas (1058072, 207436, 172986). El test que lo demuestra es
`tests/test_ordenamiento.py::test_chile_base_c1`.

## Límites explícitos

- Los packs de otro país **no se verifican todavía con `/dike-verificar`**: la
  gramática dike-id 2.0.0 solo acepta el prefijo `cl`.
- **C2 y C3 no se evalúan** (fase posterior; ver docs/legal-systems.md).
- **No hay constructor de sentencias** ni de actos administrativos.
- **Nada se descarga**: los textos los obtiene el usuario de la fuente oficial
  bajo sus condiciones de uso.

## Reglas para el agente

- **No inventar el texto de una norma**: cada artículo sale de un archivo de
  entrada; si falta texto, se consigue de la fuente oficial, no se redacta.
- **No mapear a ojo para pasar un nivel**: si un término no tiene equivalente
  en el núcleo, se declara como extensión con su relación; forzar un `mapeaA`
  es inventar derecho.
- **No editar `motor/`**: el motor está vendorizado y lo vigila
  `scripts/vendor_engine.py --check`; el framework vive en `ordenamiento/`.
- Los datos de personas no entran en packs de normas: el constructor rechaza
  identificadores personales críticos.
