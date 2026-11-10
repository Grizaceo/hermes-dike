# Arnés de desarrollo del Desktop

Página Diké offline en el navegador: `npm run dev:build && npm run dev:serve`
→ http://127.0.0.1:4173/. Sin red ni backend: `dev/sdk-stub.js` simula el SDK
de Hermes y `dev/mock-api.js` la API del plugin (fixtures en `fixtures.js`).

- Barra superior: tema claro/oscuro, idioma EN/ES, red lenta (1,5 s).
- URL: `?theme=dark&lang=es&tab=grafo&slow=1` fija el mismo estado.
- `DIKE_DEV_NODE_MODULES` apunta a otro node_modules con react/react-dom
  (por defecto la instalación de hermes-agent; no se copia nada al repo).

No muestra: el tema real del host (usa tokens `--ui-*` copiados de
apps/desktop), WebGL si el navegador no lo tiene, ni persistencia real
(storage = localStorage namespaced).
