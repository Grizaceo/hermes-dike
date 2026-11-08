# Procedencia de los fixtures de privacidad

- `goldset_sintetico.jsonl` — subconjunto de `chilean_pii_goldset_v0.3.0.jsonl`
  de dpp-ai-compliance-lab @0d1e386 (MIT), SOLO documentos con
  `source ∈ {synthetic, synthetic-augmented}` (456 docs; excluye los 44
  `semi-synthetic`). Datos sintéticos.
- `piimask_goldset.py` — port a Python de `piiMask.goldset.ts` de
  lexo-case-writer @7c13a89 (MIT). RUTs regenerados con DV módulo 11 sobre
  cuerpos inventados. Datos sintéticos.
