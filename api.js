// api.js · Cliente de Supabase: lectura, funciones RPC y tiempo real.
// Toda escritura pasa por las funciones RPC definidas en schema.sql.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';

let cliente = null;

export function iniciar(url, claveAnon) {
  cliente = createClient(url, claveAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Error con un mensaje listo para mostrar a la persona usuaria.
//   pista: código que devuelve la base de datos (p. ej. «ya_asignado»).
//   campo: si el error es de un campo del formulario («nombre», «cantidad»…).
//   red:   true si el fallo es por falta de conexión.
export class ErrorApp extends Error {
  constructor(mensaje, { pista = null, red = false } = {}) {
    super(mensaje);
    this.pista = pista;
    this.red = red;
    this.campo = pista && pista.startsWith('campo:') ? pista.slice(6) : null;
  }
}

function traducir(error) {
  const mensaje = String(error?.message ?? '');
  // Errores que lanzamos nosotros en las funciones RPC: el mensaje ya
  // está pensado para la persona usuaria.
  if (error?.code === 'P0001') {
    return new ErrorApp(mensaje, { pista: error.hint ?? null });
  }
  if (!navigator.onLine || /fetch|network|load failed|conex/i.test(mensaje)) {
    return new ErrorApp(
      'No hay conexión. Inténtalo de nuevo cuando vuelvas a tener cobertura.',
      { red: true },
    );
  }
  console.error(error);
  return new ErrorApp('Algo ha fallado. Recarga la página e inténtalo de nuevo.');
}

async function consulta(promesa) {
  let respuesta;
  try {
    respuesta = await promesa;
  } catch (e) {
    throw traducir(e);
  }
  if (respuesta.error) throw traducir(respuesta.error);
  return respuesta.data;
}

function rpc(nombre, argumentos) {
  return consulta(cliente.rpc(nombre, argumentos));
}

// ---------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------
export async function cargarTodo() {
  const [familias, comidas, articulos, pares] = await Promise.all([
    consulta(cliente.from('familias').select('*').order('orden').order('id')),
    consulta(cliente.from('comidas').select('*').order('orden').order('id')),
    consulta(cliente.from('articulos').select('*').order('id')),
    consulta(cliente.rpc('pares_parecidos')),
  ]);
  return { familias, comidas, articulos, pares };
}

export function paresParecidos() {
  return rpc('pares_parecidos');
}

export function posiblesDuplicados(comidaId, nombre, excluirId = null) {
  return rpc('posibles_duplicados', {
    p_comida: comidaId,
    p_nombre: nombre,
    p_excluir: excluirId,
  });
}

// ---------------------------------------------------------------------
// Escritura (todas devuelven la fila actualizada desde la base de datos)
// ---------------------------------------------------------------------
export function apuntarse(articuloId, familiaId) {
  return rpc('apuntarse', { p_articulo: articuloId, p_familia: familiaId });
}

export function desapuntarse(articuloId, familiaId) {
  return rpc('desapuntarse', { p_articulo: articuloId, p_familia: familiaId });
}

export function marcarComprado(articuloId, familiaId, valor) {
  return rpc('marcar_comprado', {
    p_articulo: articuloId,
    p_familia: familiaId,
    p_valor: valor,
  });
}

export function anadirArticulo(familiaId, datos) {
  return rpc('anadir_articulo', {
    p_comida: datos.comidaId,
    p_familia: familiaId,
    p_nombre: datos.nombre,
    p_cantidad: datos.cantidad,
    p_unidad: datos.unidad,
    p_notas: datos.notas,
    p_perecedero: datos.perecedero,
    p_me_lo_llevo: datos.meLoLlevo,
  });
}

export function editarArticulo(articuloId, familiaId, datos) {
  return rpc('editar_articulo', {
    p_articulo: articuloId,
    p_familia: familiaId,
    p_nombre: datos.nombre,
    p_cantidad: datos.cantidad,
    p_unidad: datos.unidad,
    p_notas: datos.notas,
    p_perecedero: datos.perecedero,
  });
}

// Devuelve el id del artículo borrado.
export function borrarArticulo(articuloId, familiaId) {
  return rpc('borrar_articulo', { p_articulo: articuloId, p_familia: familiaId });
}

// ---------------------------------------------------------------------
// Tiempo real
// ---------------------------------------------------------------------
// alCambiar(tabla, carga): carga = { eventType, new, old }.
// alEstado(estado): 'SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT' o 'CLOSED'.
export function suscribir(alCambiar, alEstado) {
  const canal = cliente.channel('cambios-lista');
  for (const tabla of ['articulos', 'comidas', 'familias']) {
    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tabla },
      (carga) => alCambiar(tabla, carga),
    );
  }
  canal.subscribe((estado) => alEstado(estado));
  return () => cliente.removeChannel(canal);
}
