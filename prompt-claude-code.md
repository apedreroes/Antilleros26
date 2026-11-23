Lee CLAUDE.md completo antes de nada. Ahí están el contexto, las decisiones técnicas y los requisitos de la app. Quiero que construyas esa app.

Trabaja por fases y para al final de cada una para que yo la revise:

**Fase 0 · Plan y dudas**
Resúmeme en pocas líneas lo que vas a construir y hazme todas las preguntas que necesites sobre lo que no esté claro en CLAUDE.md. Ten en cuenta que cualquier familia puede añadir artículos, aunque las comidas solo las creo yo: revisa que el control antiduplicados que describe CLAUDE.md es suficiente y, si ves un hueco, dímelo. No escribas código hasta que te responda.

**Fase 1 · Base de datos (Supabase)**
- `supabase/schema.sql`:
  - tablas;
  - RLS: solo lectura para `anon`;
  - funciones RPC `apuntarse`, `desapuntarse`, `marcar_comprado`, `anadir_articulo`, `editar_articulo`, `borrar_articulo` y `posibles_duplicados`, con la comprobación del código de grupo, la actualización atómica y las reglas de propiedad (cada familia edita o borra solo lo que añadió);
  - activar las extensiones `unaccent` y `pg_trgm`;
  - alta de `articulos` en la publicación de Realtime.
- `supabase/seed.sql`: 5 familias de ejemplo, las comidas del viaje y una lista base PROPUESTA con cantidades para 16 adultos equivalentes, siguiendo los criterios de CLAUDE.md (sin sobredimensionar y con «Despensa y básicos» aparte).
- Explícame cómo comprobar en el SQL Editor que dos llamadas simultáneas a `apuntarse` sobre el mismo artículo no pueden asignarlo a dos familias.

**Fase 2 · Interfaz (HTML + JS sin build)**
- `index.html`, `styles.css`, `app.js`, `api.js` y `config.example.js`.
- Flujo de primera vez: elegir familia e introducir el código de grupo.
- Lista por comidas; filtros Falta, Lo mío y Todo; contador de pendientes; resumen por familia con coste estimado y número de artículos añadidos.
- Formulario para añadir un artículo en cada comida, con «Me lo llevo yo» marcado por defecto y el aviso de posibles duplicados antes de guardar («Apuntarme a ese», «Añadir igualmente» o «Cancelar»). Edición y borrado solo de lo que haya añadido mi familia.
- Tiempo real con Supabase Realtime, y modo solo lectura sin conexión usando la última copia guardada.
- Accesibilidad WCAG 2.2 AA tal como la detalla CLAUDE.md. Para mí es un requisito tan importante como que funcione.

**Fase 3 · Puesta en marcha y verificación**
- `README.md` con los pasos exactos:
  - crear el proyecto en Supabase y ejecutar los SQL;
  - rellenar `config.js`;
  - publicar en GitHub Pages;
  - cambiar los nombres de las familias y el código de grupo;
  - editar la lista desde el Table Editor.
- `.github/workflows/keepalive.yml` opcional: un ping cada 3 días, con instrucciones para desactivarlo.
- Una checklist de pruebas manuales:
  - dos móviles a la vez;
  - sin conexión;
  - solo teclado;
  - VoiceOver y TalkBack;
  - zoom al 200 %.
- Pasa axe o Lighthouse y dime qué queda pendiente.

No añadas frameworks, dependencias ni build sin preguntarme. Si ves un fallo en mi planteamiento, dímelo antes de implementarlo.
