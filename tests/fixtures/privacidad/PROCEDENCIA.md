# Procedencia de los fixtures de privacidad

- `goldset_sintetico.jsonl` — subconjunto de `chilean_pii_goldset_v0.3.0.jsonl`
  del ÁRBOL DE TRABAJO de dpp-ai-compliance-lab sobre 0d1e386 (MIT declarada
  en pyproject.toml; el archivo del goldset está sin trackear en el repo
  origen, sha256 fead3cf42aaade1a9f48cc7d5526494bb051f95ba4eb46d83d5b87585800180d),
  SOLO documentos con `source ∈ {synthetic, synthetic-augmented}` (456 docs;
  excluye los 44 `semi-synthetic`). Datos sintéticos.
- `piimask_goldset.py` — port a Python de `piiMask.goldset.ts` de
  lexo-case-writer @7c13a89 (MIT). RUTs regenerados con DV módulo 11 sobre
  cuerpos inventados. Datos sintéticos.
- `sondas.py` — sondas de comportamiento escritas en este repo (sintéticas;
  RUT con DV módulo 11 sobre cuerpos inventados, como en `piimask_goldset.py`).
- `nombres_pila.py` — port verbatim del set `NOMBRES_PILA` de
  `src/lib/nombresPila.ts` de lexo-case-writer @7c13a89 (MIT; sha256
  ec1dc6bc3b648db05896db6b25aebda420c15b9d0c015a2df2a26179acb461bd): 344
  nombres de pila chilenos, sin tilde y en minúsculas.
