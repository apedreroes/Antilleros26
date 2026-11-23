-- =====================================================================
-- Casa rural Ávila 2026 · Datos iniciales
-- =====================================================================
-- ⚠️  BORRADOR. La lista de artículos es una PROPUESTA para unos
--     16 adultos equivalentes. Revísala (cantidades, nombres, notas)
--     antes de compartir el enlace. Criterio: que no falte lo básico
--     SIN sobredimensionar; si algo se queda corto, hay tienda en el
--     pueblo.
--
-- Cómo usarlo: ejecuta antes schema.sql. Luego, en el SQL Editor, pega
-- este fichero completo → Run. Solo funciona sobre una base VACÍA: si ya
-- hay familias o comidas, se detiene sin tocar nada.
--
-- Después puedes cambiarlo todo desde el Table Editor:
--   · familias.nombre  → los nombres reales («Familia 1» … «Familia 5»).
--   · comidas.orden    → el orden en que aparecen en la app.
--   · articulos        → cantidades y notas de la lista base.
-- =====================================================================

begin;

do $$
begin
  if exists (select 1 from public.familias)
     or exists (select 1 from public.comidas)
     or exists (select 1 from public.articulos) then
    raise exception 'La base de datos ya tiene datos. Este fichero solo se ejecuta una vez, sobre una base vacía.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Familias (nombres provisionales: cámbialos en el Table Editor)
-- Los colores son decorativos y tienen un contraste de al menos 3:1
-- sobre blanco. El nombre siempre aparece también como texto.
-- ---------------------------------------------------------------------
insert into public.familias (nombre, color, orden) values
  ('Familia 1', '#1f6fb2', 1),
  ('Familia 2', '#b3261e', 2),
  ('Familia 3', '#2e7d32', 3),
  ('Familia 4', '#7b3fa0', 4),
  ('Familia 5', '#a35200', 5);

-- ---------------------------------------------------------------------
-- Comidas que preparamos nosotros
-- Primero lo que sirve para todo el puente; luego, en orden cronológico.
-- ---------------------------------------------------------------------
insert into public.comidas (nombre, descripcion, fecha, momento, orden) values
  ('Despensa y básicos',
   'Lo que se usa varios días. Está aquí para que no se repita en cada desayuno.',
   null, 'despensa', 10),
  ('Picoteo del fin de semana',
   'Aperitivos y bebida para todo el puente.',
   null, 'picoteo', 20),
  ('Cena del viernes 4',
   'Llegamos por la noche. Mejor traerla ya cocinada de casa.',
   '2026-12-04', 'cena', 30),
  ('Desayuno del sábado 5',  null, '2026-12-05', 'desayuno', 40),
  ('Desayuno del domingo 6', null, '2026-12-06', 'desayuno', 50),
  ('Desayuno del lunes 7',   null, '2026-12-07', 'desayuno', 60),
  ('Cena del lunes 7',
   'La preparamos en la casa.',
   '2026-12-07', 'cena', 70),
  ('Desayuno del martes 8',
   'Día de vuelta: desayuno ligero y aprovechar lo que sobre.',
   '2026-12-08', 'desayuno', 80);

-- ---------------------------------------------------------------------
-- Lista base PROPUESTA (creado_por_familia_id = NULL → la creó el
-- organizador). Formato: comida, nombre, cantidad, unidad, notas,
-- perecedero.
-- ---------------------------------------------------------------------
insert into public.articulos
  (comida_id, nombre, cantidad, unidad, notas, perecedero)
select c.id, v.nombre, v.cantidad, v.unidad, v.notas, v.perecedero
  from (select *, row_number() over () as n from (values
    -- Despensa y básicos: casi todo es no perecedero.
    ('Despensa y básicos', 'Leche', 12, 'litros', 'En bricks. Para los cuatro desayunos.', false),
    ('Despensa y básicos', 'Café molido', 2, 'paquetes de 250 g', 'Comprobad antes qué cafetera tiene la casa.', false),
    ('Despensa y básicos', 'Cacao soluble', 1, 'bote grande', '', false),
    ('Despensa y básicos', 'Infusiones variadas', 1, 'caja', '', false),
    ('Despensa y básicos', 'Azúcar', 1, 'kg', '', false),
    ('Despensa y básicos', 'Aceite de oliva virgen extra', 2, 'litros', 'Para tostadas y para cocinar.', false),
    ('Despensa y básicos', 'Sal', 1, 'paquete', '', false),
    ('Despensa y básicos', 'Mantequilla', 2, 'tarrinas de 250 g', '', true),
    ('Despensa y básicos', 'Mermelada', 2, 'tarros', 'Mejor de sabores distintos.', false),
    ('Despensa y básicos', 'Tomate triturado para tostadas', 2, 'tarros', '', false),
    ('Despensa y básicos', 'Zumo', 6, 'bricks de 1 litro', '', false),
    ('Despensa y básicos', 'Agua embotellada', 3, 'garrafas de 5 litros', 'Solo si el agua del grifo no es buena. Preguntad en la casa.', false),
    ('Despensa y básicos', 'Papel de cocina', 4, 'rollos', '', false),
    ('Despensa y básicos', 'Servilletas', 1, 'paquete de 200', '', false),
    ('Despensa y básicos', 'Bolsas de basura', 2, 'rollos', 'Uno de bolsas grandes y otro para reciclar.', false),
    ('Despensa y básicos', 'Pastillas de lavavajillas', 1, 'caja', 'Solo si la casa tiene lavavajillas.', false),
    ('Despensa y básicos', 'Jabón de fregar', 1, 'botella', '', false),
    ('Despensa y básicos', 'Estropajos', 1, 'paquete', '', false),
    ('Despensa y básicos', 'Papel de aluminio', 1, 'rollo', '', false),
    ('Despensa y básicos', 'Film transparente', 1, 'rollo', '', false),

    -- Picoteo del fin de semana
    ('Picoteo del fin de semana', 'Patatas fritas', 4, 'bolsas grandes', '', false),
    ('Picoteo del fin de semana', 'Aceitunas', 3, 'botes', '', false),
    ('Picoteo del fin de semana', 'Frutos secos', 2, 'bolsas de 500 g', '', false),
    ('Picoteo del fin de semana', 'Chorizo o salchichón curado', 2, 'piezas', '', false),
    ('Picoteo del fin de semana', 'Queso curado', 1, 'cuña', 'De 1 kg, más o menos.', false),
    ('Picoteo del fin de semana', 'Turrón', 3, 'tabletas', '', false),
    ('Picoteo del fin de semana', 'Polvorones y mantecados', 1, 'caja', '', false),
    ('Picoteo del fin de semana', 'Cerveza', 2, 'packs de 24 latas', 'Si falta, hay tienda en el pueblo.', false),
    ('Picoteo del fin de semana', 'Vino tinto', 6, 'botellas', '', false),
    ('Picoteo del fin de semana', 'Refrescos', 6, 'botellas de 2 litros', '', false),

    -- Cena del viernes 4: llega cocinada de casa.
    ('Cena del viernes 4', 'Tortilla de patatas', 4, 'tortillas grandes', 'Hecha en casa. Una grande da para unas 4 personas.', true),
    ('Cena del viernes 4', 'Empanada', 2, 'empanadas grandes', 'Hecha en casa o de panadería.', true),
    ('Cena del viernes 4', 'Ensalada en bolsa', 3, 'bolsas', '', true),
    ('Cena del viernes 4', 'Tomates para ensalada', 1, 'kg', '', true),
    ('Cena del viernes 4', 'Pan', 3, 'barras', '', true),
    ('Cena del viernes 4', 'Mandarinas', 2, 'kg', 'De postre.', true),

    -- Desayuno del sábado 5
    ('Desayuno del sábado 5', 'Pan', 5, 'barras', 'Para tostadas.', true),
    ('Desayuno del sábado 5', 'Cruasanes', 2, 'paquetes de 8', '', true),
    ('Desayuno del sábado 5', 'Plátanos', 12, 'unidades', '', true),

    -- Desayuno del domingo 6
    ('Desayuno del domingo 6', 'Pan', 5, 'barras', 'Para tostadas. Se puede comprar en la tienda del pueblo.', true),
    ('Desayuno del domingo 6', 'Magdalenas', 2, 'paquetes de 12', '', false),
    ('Desayuno del domingo 6', 'Jamón serrano loncheado', 3, 'sobres de 100 g', '', true),
    ('Desayuno del domingo 6', 'Queso de untar', 2, 'tarrinas', '', true),

    -- Desayuno del lunes 7
    ('Desayuno del lunes 7', 'Pan de molde', 2, 'paquetes', '', false),
    ('Desayuno del lunes 7', 'Galletas', 2, 'paquetes', '', false),
    ('Desayuno del lunes 7', 'Yogures', 16, 'unidades', '', true),
    ('Desayuno del lunes 7', 'Naranjas', 2, 'kg', '', true),

    -- Cena del lunes 7: macarrones con chorizo y ensalada.
    ('Cena del lunes 7', 'Macarrones', 3, 'paquetes de 500 g', '', false),
    ('Cena del lunes 7', 'Tomate frito', 4, 'bricks de 400 g', '', false),
    ('Cena del lunes 7', 'Chorizo para guisar', 3, 'sartas', 'Para los macarrones. Aguanta bien hasta el lunes.', false),
    ('Cena del lunes 7', 'Cebollas', 1, 'kg', '', false),
    ('Cena del lunes 7', 'Queso rallado', 2, 'bolsas', '', true),
    ('Cena del lunes 7', 'Lechugas', 2, 'unidades', '', true),
    ('Cena del lunes 7', 'Pan', 3, 'barras', 'Mejor comprarlo el lunes en la tienda del pueblo.', true),
    ('Cena del lunes 7', 'Fruta variada', 2, 'kg', 'De postre.', true),

    -- Desayuno del martes 8: ligero, se aprovecha lo que sobre.
    ('Desayuno del martes 8', 'Pan', 4, 'barras', 'Aprovechad lo que sobre de los otros días.', true)
  ) as l (comida, nombre, cantidad, unidad, notas, perecedero)) as v
  join public.comidas c on c.nombre = v.comida
 -- Inserta en el mismo orden de esta lista: la app ordena por id.
 order by v.n;

-- Comprobación: si algún nombre de comida no coincidiera, faltarían
-- artículos. Se detiene si no se han insertado los 56 previstos.
do $$
declare
  n int;
begin
  select count(*) into n from public.articulos;
  if n <> 56 then
    raise exception 'Se esperaban 56 artículos y se han insertado %. Revisa los nombres de las comidas.', n;
  end if;
end;
$$;

commit;
