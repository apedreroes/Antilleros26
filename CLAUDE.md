# CLAUDE.md — App de reparto de comida «Casa rural Ávila 2026»

## Qué es este proyecto

Una web app móvil para que 5 familias se repartan, **antes del viaje**, qué compra y lleva cada una para las comidas que preparamos nosotros en una casa rural compartida. El objetivo es evitar lo que pasó el año pasado: cosas repetidas, comida sobrante y un grupo de WhatsApp lleno de mensajes.

**Principio de diseño:** el organizador (Alber) crea una lista cerrada de lo que hace falta, con cantidades. Las familias **no inventan** qué llevar: se apuntan a artículos de esa lista. WhatsApp solo sirve para compartir el enlace.

## Contexto del viaje (datos reales; no los cambies sin preguntar)

- **Fechas:** del viernes 4 de diciembre de 2026 por la noche al martes 8 de diciembre por la mañana. Es puente: el 8 es festivo.
- **Lugar:** casa rural en un pueblo de Ávila. Hace frío, así que algunas cosas pueden guardarse en la ventana. Hay neveras suficientes. No hace falta llevar congelador.
- **Personas:** 17 en total, de 5 familias.
  - 10 adultos, 1 niño de 10 años y 6 jóvenes de 12 a 17 años.
  - Para calcular cantidades, cuenta **unos 16 adultos equivalentes**, porque los adolescentes comen como adultos.
- **Comidas que preparamos nosotros (las que gestiona la app):**
  1. Cena del viernes 4. El año pasado llegó ya cocinada desde casa, y es una buena opción.
  2. Desayuno del sábado 5.
  3. Desayuno del domingo 6.
  4. Desayuno del lunes 7.
  5. Desayuno del martes 8.
  6. Cena del lunes 7.
  7. Aperitivos y picoteo para todo el fin de semana.
- **Comidas encargadas o fuera (no las gestiona la app, pero varias son «posiblemente»):**
  - Sábado: paella a mediodía y pizza para cenar.
  - Domingo: asado a mediodía y hamburguesería para cenar.
  - Lunes: comida fuera, probablemente en Segovia.
  - La app debe permitir **añadir una comida nueva** si alguna encargada se cae (plan B).
- **Logística:**
  - Todo llega en coche.
  - La familia más lejana tiene 8 h de viaje: debe llevar **productos no perecederos** (despensa, bebida, menaje), no frescos.
  - En el pueblo hay una tienda que probablemente abra esos días, pero es un colchón, no el plan.
- **Dinero:** cada familia paga lo que compra y «más o menos se compensa». La app **no gestiona pagos ni costes** (decisión de Alber, noviembre de 2026: sin coste estimado). El equilibrio se ve por número de artículos.
- **Alergias e intolerancias:** quien las tiene lleva su propia comida. Quedan **fuera del alcance** de la app.
- **Usuarios:** todos con móvil, dispuestos a usar la app si es sencilla. No hay usuarios con necesidades especiales conocidas, pero la app debe ser accesible de todos modos (ver más abajo).

## Decisiones técnicas tomadas

- **Frontend:** HTML, CSS y JavaScript sin framework ni build (módulos ES nativos). Se aloja en **GitHub Pages**. `supabase-js` se carga desde CDN como módulo ES.
- **Backend:** **Supabase**, con Postgres, Realtime y RPC. Plan gratuito.
  - El plan gratuito pausa el proyecto tras 7 días sin actividad. Se espera uso continuo hasta el viaje. Como red de seguridad opcional, incluir una GitHub Action que haga un ping de lectura cada 3 días, desactivable.
- **Sin login para las familias.** La primera vez, el usuario elige su familia en un selector y se guarda en `localStorage` (siempre dentro de `try/catch`, con estado en memoria si falla). Debe poder cambiarse de familia.
- **Sin código de grupo** (decisión de Alber): la URL se comparte solo por WhatsApp; quien la conozca puede escribir. Riesgo asumido, igual que la posible suplantación de familia. Aun así, las escrituras van **siempre por RPC** para garantizar la atomicidad y las reglas.
- **Gestión de la lista (decisión de Alber): cualquier familia puede añadir artículos.**
  - Las **comidas** solo las crea y edita el organizador (*Table Editor* y `seed.sql`).
  - Las familias pueden:
    - **añadir artículos** a cualquier comida. Al añadir, la opción «Me lo llevo yo» está marcada por defecto; si se desmarca, el artículo queda libre como «hace falta»;
    - **editar cualquier artículo** (nombre, cantidad, unidad, notas, perecedero), también los de la lista base y los que lleva otra familia, para corregir cantidades sin crear duplicados. Se guarda quién editó por última vez y se muestra «Editado por Familia X»;
    - **borrar solo los artículos que añadió su familia**, y nunca si los lleva otra familia;
    - apuntarse a un artículo libre;
    - desapuntarse de un artículo suyo;
    - marcar o desmarcar un artículo suyo como comprado.
  - El organizador puede editar o borrar cualquier artículo desde el *Table Editor*.
  - **Riesgo asumido:** permitir añadir reabre la puerta a los duplicados y a las sobras, que es justo el problema que se quiere resolver. Se mitiga con el control antiduplicados de la sección de funcionalidad, que es imprescindible.

## Modelo de datos (orientativo)

- `familias(id, nombre, color, orden)`
- `comidas(id, nombre, descripcion nullable, fecha nullable, momento, orden)`
  - `momento` puede ser desayuno, cena, picoteo o despensa («Despensa y básicos»).
  - `fecha` es `NULL` en las comidas de todo el fin de semana (picoteo y despensa).
- `articulos(id, comida_id, nombre, cantidad int, unidad, notas, perecedero bool, familia_id nullable, comprado bool default false, creado_por_familia_id nullable, editado_por_familia_id nullable, created_at, updated_at)`
  - `cantidad` es un entero mayor que 0.
  - `creado_por_familia_id` vale `NULL` cuando el artículo lo creó el organizador (lista base).

## Reglas de concurrencia y seguridad (imprescindibles)

- **RLS activado en todas las tablas.** La clave `anon` solo tiene `SELECT` sobre `familias`, `comidas` y `articulos`. **Ningún** `INSERT`, `UPDATE` o `DELETE` directo.
- Todas las escrituras de las familias pasan por funciones RPC `security definer` que comprueban que la familia existe y aplican las reglas:
  - `apuntarse(p_articulo, p_familia)` debe ser **atómica**: `UPDATE … SET familia_id = p_familia WHERE id = p_articulo AND familia_id IS NULL RETURNING …`. Si no actualiza ninguna fila, devuelve un error claro del tipo «Otra familia se te ha adelantado».
  - `desapuntarse(p_articulo, p_familia)`: solo si el artículo es de esa familia. Pone `comprado = false`.
  - `marcar_comprado(p_articulo, p_familia, p_valor)`: solo si el artículo es de esa familia.
  - `anadir_articulo(p_comida, p_familia, p_nombre, p_cantidad, p_unidad, p_notas, p_perecedero, p_me_lo_llevo)`:
    - valida los campos (nombre no vacío y con límite de longitud, cantidad entera mayor que 0);
    - guarda `creado_por_familia_id`;
    - si `p_me_lo_llevo` es verdadero, asigna `familia_id = p_familia`.
  - `editar_articulo(p_articulo, p_familia, p_nombre, p_cantidad, p_unidad, p_notas, p_perecedero)`: cualquier familia; guarda `editado_por_familia_id`. No cambia quién lo lleva.
  - `borrar_articulo(p_articulo, p_familia)`:
    - solo si `creado_por_familia_id = p_familia` (la lista base no la borran las familias);
    - borrar un artículo que ya tiene asignada **otra** familia está prohibido. En ese caso, error claro: «La Familia X ya se lo ha apuntado».
  - `posibles_duplicados(p_comida, p_nombre, p_excluir)`: devuelve los artículos de **todas** las comidas cuyo nombre se parezca. Compara sin tildes ni mayúsculas (`unaccent` + `lower`) y por similitud con `pg_trgm`. La interfaz lo usa antes de añadir **y antes de guardar una edición** (`p_excluir` es el propio artículo).
  - `pares_parecidos()`: devuelve las parejas de artículos parecidos para la etiqueta «¿Repetido?» (ver Funcionalidad).
- La interfaz **nunca** debe asumir que una acción ha funcionado: actualiza según la respuesta de la RPC o el evento de Realtime.
- **Nunca** subas al repo la clave `service_role`. `config.js` solo lleva la URL y la clave `anon`, que son públicas por diseño. Incluye un `config.example.js`.

## Funcionalidad

**Imprescindible:**
- Lista agrupada por comida, en orden cronológico. Cada artículo muestra:
  - nombre, cantidad y unidad, notas;
  - estado: Libre, De [familia] o Comprado.
- Botón grande «Me lo llevo» en los artículos libres. En los propios, «Ya no» y «Comprado».
- **Tiempo real:** suscripción a cambios en `articulos`, `comidas` y `familias` con Supabase Realtime. Los cambios de otras familias aparecen sin recargar.
- Filtros:
  - **Falta** (sin dueño), que es la vista por defecto;
  - **Lo mío** (mi lista de la compra);
  - **Todo**.
- Contador visible: «Quedan N artículos sin asignar».
- **Añadir artículo**, con un formulario corto dentro de cada comida: nombre, cantidad (entera), unidad y, de forma opcional, notas y perecedero. El mismo formulario sirve para editar. El formulario tiene etiquetas visibles y sus errores están asociados al campo correspondiente con `aria-describedby`.
- **Control antiduplicados (imprescindible):**
  - al escribir el nombre, o como mínimo antes de guardar, se consulta `posibles_duplicados`;
  - si hay coincidencias, se muestran **antes** de confirmar: «Ya existe: Pan de molde (2 paquetes) en Desayuno sábado, lo lleva Familia 3». Las opciones son «Apuntarme a ese», «Añadir igualmente» o «Cancelar»;
  - avisa, no bloquea;
  - el mismo aviso salta al guardar una edición que cambie el nombre;
  - **después de crear**, los artículos parecidos llevan la etiqueta «¿Repetido? Se parece a: …» (texto, no solo color). Solo se marca una pareja si al menos uno de los dos lo añadió una familia y, además, están en la misma comida o uno de ellos está en «Despensa y básicos». Así la lista base (pan cada día, etc.) no genera falsos avisos.
  - **Riesgo asumido:** los sinónimos («Refrescos» y «Coca-Cola») no se detectan.
- Cada artículo añadido por una familia muestra «Añadido por Familia X». En el resumen por familia aparece también cuántos artículos ha añadido cada una, para detectar si la lista está creciendo sin control.
- Resumen por familia: número de artículos que lleva (y cuántos comprados) y número de artículos que ha añadido.
- Pie de página con el aviso: las comidas encargadas o fuera (paella, pizza, asado, hamburguesería y comida en Segovia) no se gestionan en esta app.
- Sin conexión: muestra la última lista descargada (caché en `localStorage`) en modo solo lectura, con un aviso. Al recuperar la conexión, vuelve a sincronizar.

**Deseable:**
- Vista «Lo mío» exportable o compartible como texto (para la compra o para WhatsApp).
- Vista de administración protegida con Supabase Auth (enlace mágico solo para el email de Alber) para crear y editar comidas y cualquier artículo desde el móvil. **Es de v2, no de v1.**

**Fuera de alcance:** pagos, liquidaciones o costes, alergias, chat, notificaciones push, comidas encargadas, avisos por lejanía de las familias, código de grupo, y git o publicación (los gestiona Alber; el README lo explica).

## Accesibilidad (requisito, no adorno)

Alber investiga y divulga sobre accesibilidad digital. La app debe cumplir **WCAG 2.2 nivel AA** y servir de ejemplo.

- HTML semántico: `main`, `h1`–`h3` por comida, listas reales y `button` (nunca `div` clicable).
- El estado **nunca se indica solo por color**: va también en texto e icono. Contraste ≥ 4.5:1.
- Zonas táctiles de al menos 44×44 px (por encima del mínimo de 24×24 de la WCAG 2.2) y foco visible siempre.
- Las actualizaciones en tiempo real y los resultados de las acciones se anuncian en una región `aria-live="polite"`. Los errores, con `role="alert"`.
  - No anuncies cada cambio remoto suelto: agrúpalos («2 artículos actualizados por otras familias»).
- Los botones tienen nombre accesible completo: «Me lo llevo: Pan de molde, 2 paquetes».
- Respeta `prefers-reduced-motion`, `prefers-color-scheme` y el zoom al 200 % sin scroll horizontal.
- Idioma `lang="es"`. Textos breves, en lenguaje claro y sin jerga técnica.
- Pruébalo con teclado, con un lector de pantalla (VoiceOver o TalkBack) y con axe o Lighthouse.

## Estructura de ficheros esperada

```
/index.html
/styles.css
/app.js            (lógica de la interfaz y el estado)
/api.js            (cliente de Supabase, RPC y Realtime)
/config.example.js
/supabase/schema.sql   (tablas, RLS, funciones RPC, publicación Realtime)
/supabase/seed.sql     (familias, comidas y lista base PROPUESTA)
/.github/workflows/keepalive.yml   (opcional, desactivable)
/README.md         (puesta en marcha paso a paso)
```

## Lista base (seed)

`seed.sql` incluye una **propuesta** de artículos con cantidades para 16 adultos equivalentes en cada comida gestionada. Va claramente marcada como borrador: Alber la revisa antes de compartir el enlace.

- **Criterio:** que no falte lo básico **sin sobredimensionar**. Mejor quedarse algo corto y tirar de la tienda del pueblo que repetir el exceso del año pasado.
- Separa los **básicos compartidos de varios días** (aceite, sal, café, azúcar, leche, papel de cocina, bolsas de basura…) en una «comida» propia llamada «Despensa y básicos», para que no se dupliquen en cada desayuno.
- Los nombres de las familias van como marcadores de posición («Familia 1» … «Familia 5»). Alber los cambia.

## Forma de trabajar

- Idioma: español, en la interfaz, en los comentarios y en el README.
- Antes de escribir código, presenta un plan breve y espera confirmación.
- Si algo de este documento es ambiguo o contradictorio, **pregunta**; no lo supongas.
- Cambios pequeños y verificables. Después de cada fase, explica cómo probarla.
- No añadas dependencias, frameworks ni pasos de build sin preguntar.
