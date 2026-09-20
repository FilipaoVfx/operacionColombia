# Política de seguridad

## Versiones soportadas

| Versión | Soporte |
|---|---|
| Rama `main` / 2.x | Sí |
| Piloto SIVU legado | Solo correcciones críticas |
| Versiones anteriores | No |

## Reportar una vulnerabilidad

No abras un issue público con credenciales, datos sensibles, pasos de explotación o
una prueba de concepto activa.

1. Usa un reporte privado desde la pestaña **Security** del repositorio o crea un
   borrador privado de aviso de seguridad para el mantenedor.
2. Incluye componente afectado, impacto, pasos mínimos de reproducción y una propuesta
   de mitigación si la tienes.
3. El mantenedor confirmará recepción, evaluará severidad y coordinará la publicación
   después de disponer de una corrección.

Si GitHub no ofrece el canal privado, contacta primero al mantenedor desde su perfil de
GitHub sin revelar los detalles técnicos en público.

## Alcance sensible

Son especialmente relevantes:

- evasión del token de administración;
- SSRF en exploradores o conectores;
- inyección SQL o de rutas;
- exposición de secretos o datos personales;
- abuso del endpoint de IA o de las fuentes oficiales;
- pérdida de procedencia o alteración silenciosa de datos.

Las credenciales reales deben vivir fuera del repositorio, en
`/etc/operacion-colombia.env`, con permisos restringidos.
