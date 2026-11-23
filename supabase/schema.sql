-- =====================================================================
-- Casa rural Ávila 2026 · Esquema de base de datos (Supabase / Postgres)
-- =====================================================================
-- Cómo usarlo: Supabase → SQL Editor → New query → pega este fichero
-- completo → Run. Después ejecuta seed.sql.
--
-- Qué contiene:
--   1. Extensiones (unaccent y pg_trgm).
--   2. Tablas: familias, comidas y articulos.
--   3. Seguridad: RLS activado; la clave anónima solo puede LEER.
--   4. Funciones RPC: la ÚNICA forma de escribir desde la app.
--   5. Publicación de Realtime.
--
-- Se puede volver a ejecutar sin perder datos (usa "if not exists" y
-- "create or replace"). Si cambias la estructura de una tabla ya creada,
-- hazlo con ALTER TABLE: este fichero no modifica tablas existentes.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Extensiones
-- ---------------------------------------------------------------------
-- En Supabase las extensiones viven en el esquema "extensions".
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- Esquema privado para funciones auxiliares. No lo expone la API
-- (Supabase solo publica el esquema "public").
create schema if not exists interno;
revoke all on schema interno from public;
revoke all on schema interno from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------
create table if not exists public.familias (
  id     bigint generated always as identity primary key,
  nombre text   not null unique
         check (char_length(btrim(nombre)) between 1 and 40),
  -- Color decorativo (franja junto al nombre). Nunca es la única pista:
  -- el nombre de la familia siempre aparece como texto.
  color  text   not null default '#555555'
         check (color ~ '^#[0-9a-fA-F]{6}$'),
  orden  int    not null default 0
);

create table if not exists public.comidas (
  id          bigint generated always as identity primary key,
  nombre      text not null
              check (char_length(btrim(nombre)) between 1 and 60),
  descripcion text
              check (descripcion is null or char_length(descripcion) <= 300),
  -- NULL en las comidas de todo el fin de semana (picoteo y despensa).
  fecha       date,
  momento     text not null
              check (momento in ('desayuno', 'cena', 'picoteo', 'despensa')),
  orden       int  not null default 0
);

create table if not exists public.articulos (
  id                     bigint generated always as identity primary key,
  comida_id              bigint not null
                         references public.comidas (id) on delete cascade,
  nombre                 text   not null
                         check (char_length(nombre) between 1 and 60),
  cantidad               int    not null
                         check (cantidad between 1 and 999),
  unidad                 text   not null default ''
                         check (char_length(unidad) <= 30),
  notas                  text   not null default ''
                         check (char_length(notas) <= 200),
  perecedero             boolean not null default false,
  -- Familia que lo lleva. NULL = libre («hace falta»).
  familia_id             bigint references public.familias (id),
  comprado               boolean not null default false,
  -- NULL = lo creó el organizador (lista base).
  creado_por_familia_id  bigint references public.familias (id) on delete set null,
  -- Última familia que lo editó (NULL = nadie o el organizador).
  editado_por_familia_id bigint references public.familias (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint comprado_requiere_familia
    check (not comprado or familia_id is not null)
);

create index if not exists articulos_comida_idx  on public.articulos (comida_id);
create index if not exists articulos_familia_idx on public.articulos (familia_id);

-- updated_at se actualiza solo en cada UPDATE.
create or replace function interno.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists articulos_updated_at on public.articulos;
create trigger articulos_updated_at
  before update on public.articulos
  for each row execute function interno.tocar_updated_at();


-- ---------------------------------------------------------------------
-- 3. Seguridad: RLS y permisos
-- ---------------------------------------------------------------------
alter table public.familias  enable row level security;
alter table public.comidas   enable row level security;
alter table public.articulos enable row level security;

-- Solo lectura para todo el mundo.
drop policy if exists "Lectura para todos" on public.familias;
create policy "Lectura para todos" on public.familias
  for select to anon, authenticated using (true);

drop policy if exists "Lectura para todos" on public.comidas;
create policy "Lectura para todos" on public.comidas
  for select to anon, authenticated using (true);

drop policy if exists "Lectura para todos" on public.articulos;
create policy "Lectura para todos" on public.articulos
  for select to anon, authenticated using (true);

-- Doble cerrojo: aunque alguien añadiera una política por error, la
-- clave anónima no tiene permiso para escribir directamente.
revoke insert, update, delete, truncate, references, trigger
  on public.familias, public.comidas, public.articulos
  from anon, authenticated;
grant select on public.familias, public.comidas, public.articulos
  to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Funciones auxiliares (privadas)
-- ---------------------------------------------------------------------

-- Texto normalizado para comparar: sin tildes, en minúsculas y sin
-- espacios repetidos. «  Pan de MÓLDE » → «pan de molde».
create or replace function interno.normalizar(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
           lower(extensions.unaccent('extensions.unaccent'::regdictionary,
                                     coalesce(p_texto, ''))),
           '\s+', ' ', 'g'));
$$;

-- Umbral de similitud (0 a 1) para considerar dos nombres «parecidos».
-- 0,3 es el valor por defecto de pg_trgm: «Pan» y «Pan de molde» dan 0,33.
create or replace function interno.umbral_parecido()
returns real
language sql
immutable
set search_path = ''
as $$ select 0.3::real; $$;

-- Error con mensaje para la persona usuaria y una pista (hint) para la app.
-- Las pistas que empiezan por «campo:» indican qué campo del formulario
-- tiene el error, para asociarlo con aria-describedby.
create or replace function interno.error(p_mensaje text, p_pista text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = p_mensaje, errcode = 'P0001', hint = p_pista;
end;
$$;

create or replace function interno.comprobar_familia(p_familia bigint)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_familia is null
     or not exists (select 1 from public.familias where id = p_familia) then
    perform interno.error('Elige tu familia antes de continuar.', 'familia_invalida');
  end if;
end;
$$;

create or replace function interno.nombre_familia(p_familia bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select nombre from public.familias where id = p_familia),
                  'Otra familia');
$$;

-- Limpia un texto (recorta y quita espacios repetidos) y comprueba su
-- longitud. Devuelve el texto limpio o lanza un error asociado al campo.
create or replace function interno.limpiar(
  p_texto       text,
  p_max         int,
  p_campo       text,
  p_etiqueta    text,
  p_obligatorio boolean
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
begin
  if p_obligatorio and v = '' then
    perform interno.error(format('Escribe %s.', p_etiqueta), 'campo:' || p_campo);
  end if;
  if char_length(v) > p_max then
    perform interno.error(
      -- Primera letra en mayúscula: «el nombre» → «El nombre».
      format('%s puede tener como máximo %s caracteres.',
             upper(left(p_etiqueta, 1)) || substr(p_etiqueta, 2), p_max),
      'campo:' || p_campo);
  end if;
  return v;
end;
$$;

create or replace function interno.comprobar_cantidad(p_cantidad int)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 999 then
    perform interno.error(
      'La cantidad tiene que ser un número entero entre 1 y 999.',
      'campo:cantidad');
  end if;
end;
$$;

revoke all on all functions in schema interno from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Funciones RPC (lo único que la app puede llamar para escribir)
-- ---------------------------------------------------------------------
-- Todas son "security definer": se ejecutan con permisos del propietario
-- y por eso pueden escribir, pero solo hacen lo que su código permite.
-- "set search_path = ''" evita que nadie suplante tablas o funciones.

-- apuntarse: ATÓMICA. El UPDATE solo afecta a la fila si sigue libre.
-- Si dos familias pulsan a la vez, Postgres bloquea la fila: la segunda
-- espera, vuelve a evaluar "familia_id is null" (ya es falso) y no
-- actualiza nada. Nunca puede quedar asignado a dos familias.
create or replace function public.apuntarse(p_articulo bigint, p_familia bigint)
returns public.articulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.articulos;
begin
  perform interno.comprobar_familia(p_familia);

  update public.articulos
     set familia_id = p_familia,
         comprado   = false
   where id = p_articulo
     and familia_id is null
  returning * into v;

  if found then
    return v;
  end if;

  -- No se actualizó: averiguamos por qué para dar un mensaje claro.
  select * into v from public.articulos where id = p_articulo;
  if not found then
    perform interno.error('Este artículo ya no existe. Puede que lo hayan borrado.', 'no_existe');
  end if;
  if v.familia_id = p_familia then
    return v;  -- Ya era nuestro: no es un error.
  end if;
  perform interno.error(
    format('Otra familia se te ha adelantado: lo lleva %s.',
           interno.nombre_familia(v.familia_id)),
    'ya_asignado');
  return null;  -- No se llega aquí.
end;
$$;

-- desapuntarse: solo la familia que lo lleva. Vuelve a quedar libre y
-- deja de estar comprado.
create or replace function public.desapuntarse(p_articulo bigint, p_familia bigint)
returns public.articulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.articulos;
begin
  perform interno.comprobar_familia(p_familia);

  update public.articulos
     set familia_id = null,
         comprado   = false
   where id = p_articulo
     and familia_id = p_familia
  returning * into v;

  if found then
    return v;
  end if;

  select * into v from public.articulos where id = p_articulo;
  if not found then
    perform interno.error('Este artículo ya no existe. Puede que lo hayan borrado.', 'no_existe');
  end if;
  if v.familia_id is null then
    return v;  -- Ya estaba libre: no es un error.
  end if;
  perform interno.error(
    format('Solo puede soltarlo la familia que lo lleva: %s.',
           interno.nombre_familia(v.familia_id)),
    'no_es_tuyo');
  return null;
end;
$$;

-- marcar_comprado: solo la familia que lo lleva.
create or replace function public.marcar_comprado(
  p_articulo bigint,
  p_familia  bigint,
  p_valor    boolean
)
returns public.articulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.articulos;
begin
  perform interno.comprobar_familia(p_familia);

  update public.articulos
     set comprado = coalesce(p_valor, false)
   where id = p_articulo
     and familia_id = p_familia
  returning * into v;

  if found then
    return v;
  end if;

  select * into v from public.articulos where id = p_articulo;
  if not found then
    perform interno.error('Este artículo ya no existe. Puede que lo hayan borrado.', 'no_existe');
  end if;
  if v.familia_id is null then
    perform interno.error('Apúntate primero a este artículo para marcarlo como comprado.', 'no_es_tuyo');
  end if;
  perform interno.error(
    format('Solo puede marcarlo la familia que lo lleva: %s.',
           interno.nombre_familia(v.familia_id)),
    'no_es_tuyo');
  return null;
end;
$$;

-- anadir_articulo: cualquier familia, en cualquier comida.
-- Con p_me_lo_llevo = true (por defecto) el artículo queda asignado a
-- quien lo añade; con false queda libre («hace falta»).
create or replace function public.anadir_articulo(
  p_comida      bigint,
  p_familia     bigint,
  p_nombre      text,
  p_cantidad    int,
  p_unidad      text    default '',
  p_notas       text    default '',
  p_perecedero  boolean default false,
  p_me_lo_llevo boolean default true
)
returns public.articulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
  v_unidad text;
  v_notas  text;
  v        public.articulos;
begin
  perform interno.comprobar_familia(p_familia);

  if p_comida is null
     or not exists (select 1 from public.comidas where id = p_comida) then
    perform interno.error('Esa comida ya no existe. Recarga la página.', 'comida_invalida');
  end if;

  v_nombre := interno.limpiar(p_nombre, 60, 'nombre', 'el nombre', true);
  perform interno.comprobar_cantidad(p_cantidad);
  v_unidad := interno.limpiar(p_unidad, 30, 'unidad', 'la unidad', false);
  v_notas  := interno.limpiar(p_notas, 200, 'notas', 'las notas', false);

  -- Freno contra el crecimiento sin control (o contra un uso malicioso,
  -- ya que no hay código de grupo).
  if (select count(*) from public.articulos) >= 500 then
    perform interno.error(
      'La lista ha llegado al máximo de 500 artículos. Habla con el organizador.',
      'limite');
  end if;

  insert into public.articulos
    (comida_id, nombre, cantidad, unidad, notas, perecedero,
     familia_id, creado_por_familia_id)
  values
    (p_comida, v_nombre, p_cantidad, v_unidad, v_notas,
     coalesce(p_perecedero, false),
     case when coalesce(p_me_lo_llevo, true) then p_familia end,
     p_familia)
  returning * into v;

  return v;
end;
$$;

-- editar_articulo: CUALQUIER familia puede editar cualquier artículo
-- (también los de la lista base), para corregir cantidades sin crear
-- duplicados. No cambia quién lo lleva. Guarda quién editó.
create or replace function public.editar_articulo(
  p_articulo   bigint,
  p_familia    bigint,
  p_nombre     text,
  p_cantidad   int,
  p_unidad     text    default '',
  p_notas      text    default '',
  p_perecedero boolean default false
)
returns public.articulos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
  v_unidad text;
  v_notas  text;
  v        public.articulos;
begin
  perform interno.comprobar_familia(p_familia);

  v_nombre := interno.limpiar(p_nombre, 60, 'nombre', 'el nombre', true);
  perform interno.comprobar_cantidad(p_cantidad);
  v_unidad := interno.limpiar(p_unidad, 30, 'unidad', 'la unidad', false);
  v_notas  := interno.limpiar(p_notas, 200, 'notas', 'las notas', false);

  update public.articulos
     set nombre                 = v_nombre,
         cantidad               = p_cantidad,
         unidad                 = v_unidad,
         notas                  = v_notas,
         perecedero             = coalesce(p_perecedero, false),
         editado_por_familia_id = p_familia
   where id = p_articulo
  returning * into v;

  if not found then
    perform interno.error('Este artículo ya no existe. Puede que lo hayan borrado.', 'no_existe');
  end if;
  return v;
end;
$$;

-- borrar_articulo: solo la familia que lo AÑADIÓ, y nunca si lo lleva
-- otra familia. La lista base solo la borra el organizador.
-- Atómica: la condición se comprueba en el propio DELETE, así que no
-- hay hueco entre comprobar y borrar en el que otra familia se apunte.
create or replace function public.borrar_articulo(p_articulo bigint, p_familia bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v    public.articulos;
begin
  perform interno.comprobar_familia(p_familia);

  delete from public.articulos
   where id = p_articulo
     and creado_por_familia_id = p_familia
     and (familia_id is null or familia_id = p_familia)
  returning id into v_id;

  if found then
    return v_id;
  end if;

  select * into v from public.articulos where id = p_articulo;
  if not found then
    perform interno.error('Este artículo ya no existe. Puede que lo hayan borrado.', 'no_existe');
  end if;
  if v.creado_por_familia_id is null then
    perform interno.error(
      'Los artículos de la lista base solo los borra el organizador. Puedes cambiar la cantidad.',
      'lista_base');
  end if;
  if v.creado_por_familia_id <> p_familia then
    perform interno.error(
      format('Solo puede borrarlo la familia que lo añadió: %s.',
             interno.nombre_familia(v.creado_por_familia_id)),
      'no_es_tuyo');
  end if;
  perform interno.error(
    format('%s ya se lo ha apuntado. No se puede borrar.',
           interno.nombre_familia(v.familia_id)),
    'ya_asignado');
  return null;
end;
$$;

-- posibles_duplicados: artículos de TODAS las comidas con un nombre
-- parecido. Compara sin tildes ni mayúsculas y por similitud de
-- trigramas. Primero los de la misma comida y luego los más parecidos.
-- p_excluir: id del artículo que se está editando (para no compararlo
-- consigo mismo).
create or replace function public.posibles_duplicados(
  p_comida  bigint,
  p_nombre  text,
  p_excluir bigint default null
)
returns table (
  id             bigint,
  nombre         text,
  cantidad       int,
  unidad         text,
  comida_id      bigint,
  comida_nombre  text,
  familia_id     bigint,
  familia_nombre text,
  comprado       boolean,
  misma_comida   boolean,
  similitud      real
)
language sql
stable
security definer
set search_path = ''
as $$
  with buscado as (select interno.normalizar(p_nombre) as n)
  select a.id,
         a.nombre,
         a.cantidad,
         a.unidad,
         a.comida_id,
         c.nombre,
         a.familia_id,
         f.nombre,
         a.comprado,
         a.comida_id = p_comida,
         extensions.similarity(interno.normalizar(a.nombre), b.n)
    from public.articulos a
    join public.comidas c on c.id = a.comida_id
    left join public.familias f on f.id = a.familia_id
   cross join buscado b
   where char_length(b.n) >= 2
     and (p_excluir is null or a.id <> p_excluir)
     and (interno.normalizar(a.nombre) = b.n
          or extensions.similarity(interno.normalizar(a.nombre), b.n)
             >= interno.umbral_parecido())
   order by (a.comida_id = p_comida) desc,
            extensions.similarity(interno.normalizar(a.nombre), b.n) desc,
            a.nombre
   limit 8;
$$;

-- pares_parecidos: parejas de artículos ya creados que se parecen, para
-- la etiqueta «¿Repetido?». Solo se marca una pareja si:
--   · al menos uno de los dos lo añadió una familia (la lista base del
--     organizador no se marca a sí misma: el pan de cada día no es un
--     duplicado), y
--   · están en la misma comida, o uno de los dos está en la despensa.
-- Devuelve cada pareja en los dos sentidos para simplificar la app.
create or replace function public.pares_parecidos()
returns table (articulo_id bigint, parecido_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with n as (
    select a.id,
           a.comida_id,
           a.creado_por_familia_id,
           c.momento,
           interno.normalizar(a.nombre) as nn
      from public.articulos a
      join public.comidas c on c.id = a.comida_id
  )
  select x.id, y.id
    from n x
    join n y on x.id <> y.id
   where (x.creado_por_familia_id is not null
          or y.creado_por_familia_id is not null)
     and (x.comida_id = y.comida_id
          or x.momento = 'despensa'
          or y.momento = 'despensa')
     and (x.nn = y.nn
          or extensions.similarity(x.nn, y.nn) >= interno.umbral_parecido());
$$;

-- Permisos de ejecución: solo estas funciones son accesibles desde la app.
revoke all on function
  public.apuntarse(bigint, bigint),
  public.desapuntarse(bigint, bigint),
  public.marcar_comprado(bigint, bigint, boolean),
  public.anadir_articulo(bigint, bigint, text, int, text, text, boolean, boolean),
  public.editar_articulo(bigint, bigint, text, int, text, text, boolean),
  public.borrar_articulo(bigint, bigint),
  public.posibles_duplicados(bigint, text, bigint),
  public.pares_parecidos()
  from public;

grant execute on function
  public.apuntarse(bigint, bigint),
  public.desapuntarse(bigint, bigint),
  public.marcar_comprado(bigint, bigint, boolean),
  public.anadir_articulo(bigint, bigint, text, int, text, text, boolean, boolean),
  public.editar_articulo(bigint, bigint, text, int, text, text, boolean),
  public.borrar_articulo(bigint, bigint),
  public.posibles_duplicados(bigint, text, bigint),
  public.pares_parecidos()
  to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. Realtime: avisar de los cambios en las tres tablas
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['familias', 'comidas', 'articulos'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

commit;
