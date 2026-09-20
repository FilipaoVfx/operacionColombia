# Contribuir a Operación Colombia

Gracias por mejorar el proyecto. Los cambios deben conservar dos propiedades: todo
dato mantiene su procedencia oficial y toda transformación puede reproducirse.

## Entorno local

Se necesita Node.js 22.5 o superior.

```bash
git clone https://github.com/FilipaoVfx/operacionColombia.git
cd operacionColombia
npm ci
npm ci --prefix apps/web-next
```

La API utiliza `node:sqlite` y no instala dependencias de runtime. Las dependencias
del `package.json` raíz son herramientas de desarrollo.

## Antes de enviar un cambio

```bash
npm test
npm run lint
npm run deadcode
npm run coverage
npm run typecheck --prefix apps/web-next
npm run build --prefix apps/web-next
shellcheck infra/deploy/*.sh
```

`npm run coverage` exige al menos 70 % de líneas, 70 % de funciones y 60 % de ramas.
Si el cambio altera comportamiento, debe incluir una prueba que falle antes del arreglo
y pase después.

## Pull requests

1. Explica el problema y la causa, no solo los archivos modificados.
2. Mantén el cambio acotado y actualiza documentación o variables de entorno afectadas.
3. No incluyas bases de datos, credenciales, tokens ni datos personales.
4. Conserva `fuente`, `fuente_url`, fechas y transformaciones en cada dato ingerido.
5. Espera que CI quede verde antes de solicitar revisión.

## Nuevas fuentes de datos

- Solo se aceptan fuentes públicas cuya licencia permita el uso propuesto.
- Documenta endpoint, entidad responsable, periodicidad y licencia en
  `CATALOGO-DATOS.md`.
- Usa las defensas SSRF existentes; no agregues dominios controlados por el usuario sin
  allowlist.
- Agrega fixtures pequeños. No versionar descargas completas ni bases SQLite.

## Seguridad

No publiques vulnerabilidades explotables en un issue. Sigue el proceso descrito en
[`SECURITY.md`](SECURITY.md).
