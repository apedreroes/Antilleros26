# Comida del puente · Casa rural Ávila 2026

Web app para que las 5 familias se repartan, antes del viaje, qué compra y
lleva cada una para las comidas que hacemos en la casa. El organizador
prepara la lista; las familias se apuntan, añaden lo que falte y marcan lo
que ya han comprado. Todo se ve al momento en todos los móviles.

- **Frontend:** HTML, CSS y JavaScript sin framework ni build. GitHub Pages.
- **Backend:** Supabase (Postgres, Realtime y funciones RPC), plan gratuito.
- **Sin login:** cada persona elige su familia la primera vez. No hay código
  de grupo: quien tenga el enlace puede usar la app, así que compártelo solo
  por el WhatsApp del grupo.

---

## 1. Crear el proyecto en Supabase

1. Entra en <https://supabase.com> y crea una cuenta (o inicia sesión).
2. **New project**:
   - *Name*: el que quieras, por ejemplo `comida-puente`.
   - *Database password*: genera una y guárdala (no la necesitará la app).
   - *Region*: una de Europa (por ejemplo, *West EU*).
3. Espera a que el proyecto termine de crearse (1-2 minutos).

## 2. Crear la base de datos

1. En el menú lateral, abre **SQL Editor** → **New query**.
2. Copia **todo** el contenido de [`supabase/schema.sql`](supabase/schema.sql),
   pégalo y pulsa **Run**. Debe terminar con «Success. No rows returned».
3. Abre otra consulta nueva, pega **todo** [`supabase/seed.sql`](supabase/seed.sql)
   y pulsa **Run**.
   - Crea 5 familias, 8 comidas y 56 artículos.
   - ⚠️ La lista es un **borrador**: revísala antes de compartir el enlace
     (ver el apartado 6).
   - Solo funciona sobre una base vacía. Si ya hay datos, se detiene sin
     tocar nada.

### Comprobación rápida (opcional)

En el SQL Editor:

```sql
-- La clave pública puede leer, pero no escribir directamente:
set role anon;
select count(*) from public.articulos;                    -- 56
update public.articulos set familia_id = 2 where id = 1;  -- permission denied
reset role;
```

**Dos familias pulsando a la vez «Me lo llevo»** (hacen falta dos pestañas del
SQL Editor). Los ids no tienen por qué empezar en 1, así que se buscan por
nombre:

- Pestaña A:
  ```sql
  begin;
  select id, familia_id from public.apuntarse(
    (select id from public.articulos where nombre = 'Leche'),
    (select id from public.familias  where nombre = 'Familia 1'));
  select pg_sleep(20);
  commit;
  ```
- Pestaña B, antes de 20 segundos:
  ```sql
  select id, familia_id from public.apuntarse(
    (select id from public.articulos where nombre = 'Leche'),
    (select id from public.familias  where nombre = 'Familia 2'));
  ```

La pestaña B espera y termina con el error «Otra familia se te ha
adelantado: lo lleva Familia 1». Para dejarlo como estaba:

```sql
update public.articulos set familia_id = null, comprado = false
 where nombre = 'Leche';
```

## 3. Rellenar `config.js`

1. En Supabase, abre **Project Settings**:
   - **Data API** → copia la *Project URL* (`https://xxxx.supabase.co`).
   - **API Keys** → copia la clave **publishable** (`sb_publishable_…`). En
     proyectos antiguos, la *anon public* de *Legacy API Keys* también sirve.
2. En la carpeta del proyecto, copia `config.example.js` como `config.js` y
   pega los dos valores:

   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'sb_publishable_xxxxxxxx';
   ```

> **Nunca** pongas en `config.js` la clave *secret* ni la *service_role*.
> La publishable/anon es pública por diseño: con ella solo se puede leer y
> llamar a las funciones de la app, que comprueban todas las reglas.

### Probar en tu ordenador

Los módulos de JavaScript no funcionan abriendo `index.html` con doble clic.
Sirve la carpeta con un servidor local:

```bash
python3 -m http.server 8000
```

Y abre <http://localhost:8000>. Para ver el tiempo real, ábrela en dos
navegadores con familias distintas.

## 4. Publicar en GitHub Pages

1. Crea un repositorio en GitHub. Con una cuenta gratuita, GitHub Pages
   exige que sea **público** (no contiene nada secreto: la clave de
   `config.js` es pública y no hay código de grupo).
2. Sube **todos** los ficheros de esta carpeta, **incluido `config.js`**
   (sin él la app publicada no puede conectarse):
   - `index.html`, `styles.css`, `app.js`, `api.js`, `config.js`,
     `config.example.js`, `README.md`, `supabase/` y `.github/`.
   - `CLAUDE.md` y `prompt-claude-code.md` son opcionales.
3. En el repositorio: **Settings** → **Pages** → *Build and deployment*:
   - *Source*: **Deploy from a branch**.
   - *Branch*: `main` y carpeta `/ (root)` → **Save**.
4. En uno o dos minutos la app estará en
   `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.
5. Comparte ese enlace en el WhatsApp del grupo. La página lleva
   `noindex` para que los buscadores no la muestren.

## 5. Cambiar los nombres de las familias

En Supabase → **Table Editor** → tabla `familias`:

- `nombre`: cambia «Familia 1» … «Familia 5» por los nombres reales.
- `color`: color de la franja (formato `#rrggbb`). Es decorativo: el nombre
  siempre aparece como texto. Usa colores oscuros o medios (contraste de al
  menos 3:1 sobre blanco).
- `orden`: orden en el selector y en el resumen.

Los cambios aparecen en todos los móviles sin recargar.

**Código de grupo:** no hay (decisión tomada). Si algún día se quisiera,
habría que volver a añadirlo en las funciones RPC.

## 6. Editar la lista desde el Table Editor

### Artículos (`articulos`)

- Cambia `nombre`, `cantidad` (entero), `unidad`, `notas` o `perecedero`
  directamente en la tabla.
- Para **añadir** un artículo de la lista base, inserta una fila con
  `comida_id` (elige la comida), `nombre`, `cantidad` y, si quieres,
  `unidad` y `notas`. Deja `creado_por_familia_id` vacío: así cuenta como
  lista base y ninguna familia puede borrarlo.
- Para **borrar** cualquier artículo, selecciónalo y bórralo.
- `familia_id` es quién lo lleva (vacío = libre) y `comprado` si ya está
  comprado. Puedes corregirlos a mano si alguien se equivoca.

Las familias, desde la app, pueden añadir artículos, editar cualquiera
(para corregir cantidades) y borrar solo los que añadieron ellas y nadie más
lleva.

### Comidas (`comidas`) y plan B

Si una comida encargada se cae (por ejemplo, la pizza del sábado), añade una
fila en `comidas`:

| Campo         | Ejemplo                                   |
| ------------- | ----------------------------------------- |
| `nombre`      | `Cena del sábado 5`                        |
| `descripcion` | `Plan B: la pizzería está cerrada.`        |
| `fecha`       | `2026-12-05`                               |
| `momento`     | `cena` (o `desayuno`, `picoteo`, `despensa`) |
| `orden`       | `45` (entre el desayuno del sábado, 40, y el del domingo, 50) |

Aparecerá en la app al momento y las familias podrán añadirle artículos.

> ⚠️ Borrar una comida **borra también todos sus artículos**.

### Empezar de cero con las asignaciones

Si quieres liberar todo (por ejemplo, tras una prueba):

```sql
update public.articulos set familia_id = null, comprado = false;
```

## 7. Mantener Supabase despierto (opcional)

El plan gratuito pausa el proyecto tras **7 días sin actividad**. Si la app
se usa a menudo no pasará, pero como red de seguridad está el flujo
[`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml): cada 3
días hace una lectura mínima. Lee la URL y la clave de `config.js`, así que
no hay que configurar nada más.

- **Probarlo:** GitHub → pestaña **Actions** → «Mantener Supabase despierto»
  → **Run workflow**. Debe terminar en verde.
- **Desactivarlo:** en esa misma pantalla, menú **…** → **Disable workflow**
  (se puede volver a activar). O borra el fichero.
- Si el proyecto llegara a pausarse, se reactiva desde el panel de Supabase
  con **Restore project**.

## Cómo funciona por dentro

```
index.html            estructura de la página
styles.css            estilos (modo claro y oscuro)
app.js                interfaz, estado, formularios y caché
api.js                cliente de Supabase: lectura, RPC y tiempo real
config.example.js     plantilla de config.js
supabase/schema.sql   tablas, seguridad, funciones RPC y Realtime
supabase/seed.sql     familias, comidas y lista base (borrador)
.github/workflows/keepalive.yml   ping opcional cada 3 días
```

- **Seguridad:** RLS activado. La clave pública solo puede **leer**. Todas
  las escrituras pasan por funciones RPC que aplican las reglas.
- **Sin dobles asignaciones:** `apuntarse` asigna el artículo con un único
  `UPDATE … WHERE familia_id IS NULL`. Si dos familias pulsan a la vez, solo
  una lo consigue; la otra recibe «Otra familia se te ha adelantado».
- **Duplicados:** antes de añadir (y al cambiar el nombre al editar), la app
  busca nombres parecidos en todas las comidas (sin tildes ni mayúsculas,
  con `pg_trgm`) y pregunta: «Apuntarme a ese», «Añadir igualmente» o
  «Cancelar». Después, los artículos añadidos por familias que se parecen a
  otro de la misma comida o de la despensa llevan la etiqueta «¿Repetido?».
  Los sinónimos («Refrescos» y «Coca-Cola») no se detectan.
- **Sin conexión:** la app guarda la última lista en el móvil. Si se va la
  cobertura, la muestra en modo solo lectura y se pone al día al volver.
- **Límite:** la lista admite como máximo 500 artículos, como freno a un uso
  indebido del enlace.

## Accesibilidad

Objetivo: **WCAG 2.2 nivel AA**.

Revisado:

- axe-core 4.10: 0 errores en modo claro y en modo oscuro.
- 320 px de ancho (equivale al zoom del 200 %): sin scroll horizontal.
- Navegación por teclado y gestión del foco al apuntarse, editar, borrar y
  añadir.
- Anuncios para lectores de pantalla (`aria-live` para resultados y cambios
  agrupados de otras familias; `role="alert"` para errores).

Pendiente:

- Probar con VoiceOver (iPhone) y TalkBack (Android) en móviles reales.
- **Recargar la página sin conexión:** el modo sin conexión funciona si la
  app ya estaba abierta. Si alguien recarga sin cobertura, el navegador
  puede no mostrarla, porque no hay *service worker*.
