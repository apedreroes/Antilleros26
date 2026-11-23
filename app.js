// app.js · Interfaz y estado de «Comida del puente».
//
// Principios:
//  · Nunca se da una acción por hecha: el estado se actualiza con la fila
//    que devuelve la función RPC o con el evento de tiempo real.
//  · La lista se actualiza sin destruir lo que no ha cambiado, para no
//    perder el foco del teclado ni lo que se está escribiendo.
//  · Los resultados se anuncian en una región aria-live; los errores, con
//    role="alert".

// ---------------------------------------------------------------------
// Almacenamiento local (siempre con try/catch y copia en memoria)
// ---------------------------------------------------------------------
const CLAVE_FAMILIA = 'comida-puente:familia';
const CLAVE_FILTRO = 'comida-puente:filtro';
const CLAVE_CACHE = 'comida-puente:cache';

const memoria = new Map();
const almacen = {
  leer(clave) {
    try {
      const valor = window.localStorage.getItem(clave);
      if (valor !== null) return valor;
    } catch { /* localStorage no disponible: usamos la memoria */ }
    return memoria.has(clave) ? memoria.get(clave) : null;
  },
  guardar(clave, valor) {
    memoria.set(clave, valor);
    try { window.localStorage.setItem(clave, valor); } catch { /* sin espacio o bloqueado */ }
  },
};

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------
const estado = {
  familias: [],
  comidas: [],
  articulos: new Map(),     // id → fila
  parecidos: new Map(),     // id → Set de ids parecidos
  miFamilia: null,
  filtro: 'falta',
  conexion: 'cargando',     // 'cargando' | 'en-linea' | 'sin-conexion'
  ultimaSync: null,         // ISO de la última descarga correcta
  fatal: null,              // mensaje si la app no puede arrancar
  eligiendoFamilia: false,
  ocupado: new Set(),       // artículos con una acción en curso
  errorArticulo: new Map(), // id → mensaje de error visible en la tarjeta
  mensajeComida: new Map(), // comidaId → confirmación visible
  formAnadir: new Map(),    // comidaId → <form> abierto
  editando: new Map(),      // articuloId → <form> abierto
  recientes: new Map(),     // id → instante de nuestra última acción
};

let api = null;

const FILTROS = {
  falta: { etiqueta: 'Falta', prueba: (a) => a.familia_id == null },
  mio: { etiqueta: 'Lo mío', prueba: (a) => a.familia_id === estado.miFamilia },
  todo: { etiqueta: 'Todo', prueba: () => true },
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

// Crea un elemento. Los textos se insertan siempre como texto, nunca
// como HTML, para que ningún nombre pueda inyectar código.
function h(etiqueta, props = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor == null || valor === false) continue;
    if (clave === 'class') el.className = valor;
    else if (clave.startsWith('on') && typeof valor === 'function') {
      el.addEventListener(clave.slice(2), valor);
    } else if (valor === true) el.setAttribute(clave, '');
    else el.setAttribute(clave, String(valor));
  }
  for (const hijo of hijos.flat()) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return el;
}

const ICONOS = {
  libre: '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="4 3"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 8h14l-1.2 12.5H6.2z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  comprado: '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="var(--superficie)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  casilla: '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  casillaMarcada: '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/><path d="M8 12.5l2.7 2.7L16.5 9" fill="none" stroke="var(--superficie)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  aviso: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3.5 2.5 20.5h19z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.8" r="1.2" fill="currentColor"/></svg>',
  error: '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.2" fill="currentColor"/></svg>',
  ok: '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mas: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};

function icono(nombre) {
  const span = h('span', { class: 'icono', 'aria-hidden': 'true' });
  span.innerHTML = ICONOS[nombre]; // SVG fijo del propio código, no datos.
  return span;
}

const soloLectores = (texto) => h('span', { class: 'solo-lectores' }, texto);

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const familiaPorId = (id) => estado.familias.find((f) => f.id === id) ?? null;
const comidaPorId = (id) => estado.comidas.find((c) => c.id === id) ?? null;
const nombreFamilia = (id) => familiaPorId(id)?.nombre ?? 'otra familia';
const nombreFamiliaConTu = (id) =>
  id === estado.miFamilia ? `${nombreFamilia(id)} (tu familia)` : nombreFamilia(id);

const textoCantidad = (a) => `${a.cantidad} ${a.unidad ?? ''}`.trim();
const descripcion = (a) => `${a.nombre}, ${textoCantidad(a)}`;

const puedeEscribir = () => estado.conexion === 'en-linea' && api !== null;

const libres = () => [...estado.articulos.values()].filter((a) => a.familia_id == null).length;

function textoQuedan(n = libres()) {
  if (n === 0) return 'No queda nada sin asignar. ¡Todo repartido!';
  if (n === 1) return 'Queda 1 artículo sin asignar.';
  return `Quedan ${n} artículos sin asignar.`;
}

function marcarReciente(id) {
  estado.recientes.set(id, Date.now());
}
const esReciente = (id) => Date.now() - (estado.recientes.get(id) ?? 0) < 6000;

function formatearHora(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------
// Anuncios para lectores de pantalla
// ---------------------------------------------------------------------
let tAviso;
let tError;
function anunciar(texto) {
  const region = $('avisos');
  clearTimeout(tAviso);
  region.textContent = '';
  tAviso = setTimeout(() => { region.textContent = texto; }, 120);
}
function anunciarError(texto) {
  const region = $('errores');
  clearTimeout(tError);
  region.textContent = '';
  tError = setTimeout(() => {
    region.textContent = texto;
    tError = setTimeout(() => { region.textContent = ''; }, 10000);
  }, 120);
}

// Cambios de otras familias: se agrupan en un único anuncio.
let remotosPendientes = 0;
let tRemotos;
function contarCambioRemoto(id) {
  if (esReciente(id)) return; // Es el eco de una acción nuestra.
  remotosPendientes += 1;
  clearTimeout(tRemotos);
  tRemotos = setTimeout(() => {
    const n = remotosPendientes;
    remotosPendientes = 0;
    anunciar(n === 1
      ? '1 artículo actualizado por otra familia.'
      : `${n} artículos actualizados por otras familias.`);
  }, 2500);
}

// ---------------------------------------------------------------------
// Foco
// ---------------------------------------------------------------------
// Los elementos que pueden recibir foco llevan data-foco con una clave
// estable. Si al redibujar se pierde el foco, se recupera por la clave.
function claveFocoActual() {
  const activo = document.activeElement;
  return activo?.closest?.('[data-foco]')?.dataset.foco ?? null;
}

function enfocar(clave) {
  if (!clave) return false;
  const el = document.querySelector(`[data-foco="${CSS.escape(clave)}"]`);
  if (el && !el.closest('[hidden]')) {
    el.focus();
    return true;
  }
  return false;
}

function focoPerdido() {
  const activo = document.activeElement;
  return !activo || activo === document.body || !activo.isConnected;
}

// ---------------------------------------------------------------------
// Datos y caché
// ---------------------------------------------------------------------
function aplicarDatos({ familias, comidas, articulos, pares }) {
  estado.familias = [...familias].sort((a, b) => a.orden - b.orden || a.id - b.id);
  estado.comidas = [...comidas].sort((a, b) => a.orden - b.orden || a.id - b.id);
  estado.articulos = new Map(articulos.map((a) => [a.id, a]));
  aplicarPares(pares ?? []);
  if (estado.miFamilia && !familiaPorId(estado.miFamilia)) {
    estado.miFamilia = null; // La familia guardada ya no existe.
  }
}

function aplicarPares(pares) {
  const mapa = new Map();
  for (const p of pares) {
    const a = p.articulo_id ?? p[0];
    const b = p.parecido_id ?? p[1];
    if (!mapa.has(a)) mapa.set(a, new Set());
    mapa.get(a).add(b);
  }
  estado.parecidos = mapa;
}

function guardarCache() {
  const pares = [];
  for (const [a, conjunto] of estado.parecidos) for (const b of conjunto) pares.push([a, b]);
  almacen.guardar(CLAVE_CACHE, JSON.stringify({
    familias: estado.familias,
    comidas: estado.comidas,
    articulos: [...estado.articulos.values()],
    pares,
    guardado: estado.ultimaSync,
  }));
}

function leerCache() {
  try {
    const datos = JSON.parse(almacen.leer(CLAVE_CACHE));
    if (datos && Array.isArray(datos.familias) && Array.isArray(datos.articulos)) return datos;
  } catch { /* caché dañada: se ignora */ }
  return null;
}

function aplicarFila(fila) {
  if (!fila || fila.id == null) return;
  estado.articulos.set(fila.id, fila);
  guardarCache();
  programarParecidos();
}

// ---------------------------------------------------------------------
// Sincronización
// ---------------------------------------------------------------------
let sincronizando = false;
let suscrito = false;
let suscritoAntes = false;
let tReintento;

async function sincronizar() {
  if (!api) {
    estado.conexion = 'sin-conexion';
    render();
    return;
  }
  if (sincronizando) return;
  sincronizando = true;
  const antes = estado.conexion;
  try {
    const datos = await api.cargarTodo();
    aplicarDatos(datos);
    estado.conexion = 'en-linea';
    estado.ultimaSync = new Date().toISOString();
    guardarCache();
    if (!suscrito) {
      api.suscribir(alCambioRemoto, alEstadoCanal);
      suscrito = true;
    }
    if (antes === 'sin-conexion') anunciar('Conexión recuperada. La lista está al día.');
  } catch (e) {
    estado.conexion = 'sin-conexion';
    if (antes !== 'sin-conexion') {
      anunciar('Sin conexión. Puedes ver la lista, pero no hacer cambios.');
    }
    clearTimeout(tReintento);
    tReintento = setTimeout(sincronizar, 20000);
  } finally {
    sincronizando = false;
    render();
  }
}

function pasarASinConexion() {
  if (estado.conexion === 'sin-conexion') return;
  estado.conexion = 'sin-conexion';
  anunciar('Sin conexión. Puedes ver la lista, pero no hacer cambios.');
  clearTimeout(tReintento);
  tReintento = setTimeout(sincronizar, 20000);
  render();
}

let tRecarga;
function programarRecarga() {
  clearTimeout(tRecarga);
  tRecarga = setTimeout(sincronizar, 600);
}

let tPares;
function programarParecidos() {
  if (!api) return;
  clearTimeout(tPares);
  tPares = setTimeout(async () => {
    try {
      aplicarPares(await api.paresParecidos());
      guardarCache();
      render();
    } catch { /* no es grave: se recalcula en la próxima carga */ }
  }, 800);
}

const camposArticulo = ['nombre', 'cantidad', 'unidad', 'notas', 'perecedero', 'familia_id', 'comprado'];
const mismaFila = (a, b) => camposArticulo.every((c) => a?.[c] === b?.[c]);

function alCambioRemoto(tabla, carga) {
  if (tabla !== 'articulos') {
    // Cambios del organizador en comidas o familias: recargamos todo.
    programarRecarga();
    return;
  }
  if (carga.eventType === 'DELETE') {
    const id = carga.old?.id;
    const anterior = estado.articulos.get(id);
    if (!anterior) return;
    estado.articulos.delete(id);
    if (estado.editando.has(id)) {
      estado.editando.delete(id);
      anunciar(`Otra familia ha borrado «${anterior.nombre}» mientras lo editabas.`);
    } else {
      contarCambioRemoto(id);
    }
  } else {
    const nueva = carga.new;
    if (!nueva || nueva.id == null) return;
    if (mismaFila(estado.articulos.get(nueva.id), nueva)) {
      estado.articulos.set(nueva.id, nueva);
      return; // Nada visible ha cambiado (suele ser el eco de nuestra acción).
    }
    estado.articulos.set(nueva.id, nueva);
    contarCambioRemoto(nueva.id);
  }
  guardarCache();
  programarParecidos();
  render();
}

function alEstadoCanal(estadoCanal) {
  if (estadoCanal === 'SUBSCRIBED') {
    // Al reconectar, puede que nos hayamos perdido cambios: recargamos.
    if (suscritoAntes) programarRecarga();
    suscritoAntes = true;
  }
}

// ---------------------------------------------------------------------
// Pintado general
// ---------------------------------------------------------------------
function render() {
  const clave = claveFocoActual();
  const hayDatos = estado.familias.length > 0;

  $('cargando').hidden = hayDatos || estado.conexion !== 'cargando' || estado.fatal !== null;
  renderConexion(hayDatos);
  renderIdentidad();

  const elegir = hayDatos && estado.fatal === null && (!estado.miFamilia || estado.eligiendoFamilia);
  const seccionElegir = $('elegir-familia');
  if (elegir && !seccionElegir.firstChild) renderElegirFamilia();
  if (!elegir) seccionElegir.replaceChildren();
  seccionElegir.hidden = !elegir;

  const app = $('app');
  app.hidden = !(hayDatos && !elegir && estado.fatal === null);
  if (!app.hidden) renderApp();

  if (clave && focoPerdido()) enfocar(clave);
}

let firmaConexion = '';
function renderConexion(hayDatos) {
  const cont = $('aviso-conexion');
  let firma = 'ok';
  if (estado.fatal) firma = `fatal|${estado.fatal}`;
  else if (estado.conexion === 'sin-conexion') firma = `sin|${hayDatos}|${estado.ultimaSync}`;
  if (firma === firmaConexion) return;
  firmaConexion = firma;

  if (estado.fatal) {
    cont.replaceChildren(h('div', { class: 'aviso aviso-error' }, icono('error'), h('p', {}, estado.fatal)));
    return;
  }
  if (estado.conexion !== 'sin-conexion') {
    cont.replaceChildren();
    return;
  }
  const reintentar = h('button', {
    type: 'button', class: 'boton', 'data-foco': 'reintentar', onclick: () => sincronizar(),
  }, 'Reintentar');
  const texto = hayDatos
    ? h('p', {},
      h('strong', {}, 'Sin conexión. '),
      estado.ultimaSync
        ? `Estás viendo la lista guardada el ${formatearHora(estado.ultimaSync)}. `
        : 'Estás viendo la última lista guardada. ',
      'No se pueden hacer cambios hasta que vuelva la conexión.')
    : h('p', {}, h('strong', {}, 'No se ha podido cargar la lista. '), 'Comprueba la conexión e inténtalo de nuevo.');
  cont.replaceChildren(h('div', { class: hayDatos ? 'aviso' : 'aviso aviso-error' },
    icono('aviso'), h('div', {}, texto, h('div', { class: 'acciones' }, reintentar))));
}

function renderIdentidad() {
  const cont = $('identidad');
  if (!estado.miFamilia || estado.eligiendoFamilia || estado.fatal) {
    cont.replaceChildren();
    return;
  }
  const nombre = nombreFamilia(estado.miFamilia);
  if (cont.dataset.nombre === nombre) return;
  cont.dataset.nombre = nombre;
  cont.replaceChildren(
    h('p', {}, 'Eres de ', h('strong', {}, nombre)),
    h('button', {
      type: 'button', class: 'boton-enlace', 'data-foco': 'cambiar-familia', onclick: empezarCambioFamilia,
    }, 'Cambiar de familia'),
  );
}

// ---------------------------------------------------------------------
// Elegir familia
// ---------------------------------------------------------------------
function empezarCambioFamilia() {
  estado.eligiendoFamilia = true;
  $('identidad').dataset.nombre = '';
  $('elegir-familia').replaceChildren();
  render();
  $('elegir-titulo')?.focus();
}

function renderElegirFamilia() {
  const actual = estado.miFamilia;
  const idError = 'elegir-error';
  const opciones = estado.familias.map((f) => h('label', {
    class: 'opcion-familia', style: `--color-familia: ${f.color}`,
  },
  h('input', {
    type: 'radio', name: 'familia', value: f.id, checked: f.id === actual,
  }),
  h('span', { class: 'muestra-color', 'aria-hidden': 'true' }),
  f.nombre));

  const error = h('p', { class: 'error-campo', id: idError });

  const form = h('form', { novalidate: true },
    h('h2', { id: 'elegir-titulo', tabindex: '-1', 'data-foco': 'elegir-titulo' },
      actual ? 'Cambiar de familia' : '¡Hola! ¿De qué familia eres?'),
    h('p', { class: 'subtitulo' },
      'Así sabremos qué te llevas tú. Se guarda en este móvil y puedes cambiarlo cuando quieras.'),
    h('fieldset', {}, h('legend', {}, 'Elige tu familia'), opciones, error),
    h('div', { class: 'acciones' },
      h('button', { type: 'submit', class: 'boton boton-primario boton-grande' }, 'Entrar'),
      actual ? h('button', {
        type: 'button', class: 'boton boton-grande', onclick: () => terminarCambioFamilia(null),
      }, 'Cancelar') : null));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const marcada = form.querySelector('input[name="familia"]:checked');
    const radios = form.querySelectorAll('input[name="familia"]');
    if (!marcada) {
      error.replaceChildren(icono('error'), 'Elige una familia para continuar.');
      radios.forEach((r) => {
        r.setAttribute('aria-invalid', 'true');
        r.setAttribute('aria-describedby', idError);
      });
      radios[0]?.focus();
      return;
    }
    terminarCambioFamilia(Number(marcada.value));
  });

  $('elegir-familia').replaceChildren(form);
}

function terminarCambioFamilia(id) {
  if (id != null) {
    estado.miFamilia = id;
    almacen.guardar(CLAVE_FAMILIA, String(id));
    estado.editando.clear();
    estado.formAnadir.clear();
    estado.errorArticulo.clear();
    estado.mensajeComida.clear();
    anunciar(`Ahora eres de ${nombreFamilia(id)}. ${textoQuedan()}`);
  }
  estado.eligiendoFamilia = false;
  $('identidad').dataset.nombre = '';
  render();
  $('contador').focus();
}

// ---------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------
function renderApp() {
  const lista = [...estado.articulos.values()];
  $('contador').textContent = textoQuedan();

  for (const boton of document.querySelectorAll('.boton-filtro')) {
    const clave = boton.dataset.filtro;
    const n = lista.filter(FILTROS[clave].prueba).length;
    boton.setAttribute('aria-pressed', String(clave === estado.filtro));
    const texto = `${FILTROS[clave].etiqueta} (${n})`;
    if (boton.textContent !== texto) boton.textContent = texto;
  }

  renderCompartir(lista);
  renderResumen(lista);
  renderLista();
}

function cambiarFiltro(clave) {
  if (!FILTROS[clave]) return;
  estado.filtro = clave;
  almacen.guardar(CLAVE_FILTRO, clave);
  estado.errorArticulo.clear();
  estado.mensajeComida.clear();
  $('compartir').dataset.firma = '';
  render();
  const n = [...estado.articulos.values()].filter(FILTROS[clave].prueba).length;
  anunciar(`Mostrando «${FILTROS[clave].etiqueta}»: ${n === 1 ? '1 artículo' : `${n} artículos`}.`);
}

// --- Resumen por familia --------------------------------------------
function renderResumen(lista) {
  const filas = estado.familias.map((f) => {
    const lleva = lista.filter((a) => a.familia_id === f.id);
    return {
      f,
      lleva: lleva.length,
      comprados: lleva.filter((a) => a.comprado).length,
      anadidos: lista.filter((a) => a.creado_por_familia_id === f.id).length,
    };
  });
  const firma = JSON.stringify([filas.map((x) => [x.f.nombre, x.lleva, x.comprados, x.anadidos]), libres(), estado.miFamilia]);
  const cont = $('resumen-contenido');
  if (cont.dataset.firma === firma) return;
  cont.dataset.firma = firma;

  const tabla = h('table', { class: 'tabla-resumen' },
    h('caption', {}, 'Artículos por familia'),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Familia'),
      h('th', { scope: 'col' }, 'Lleva'),
      h('th', { scope: 'col' }, 'Comprados'),
      h('th', { scope: 'col' }, 'Ha añadido'))),
    h('tbody', {}, filas.map((x) => h('tr', {},
      h('th', { scope: 'row' }, x.f.id === estado.miFamilia ? `${x.f.nombre} (tú)` : x.f.nombre),
      h('td', {}, x.lleva),
      h('td', {}, x.comprados),
      h('td', {}, x.anadidos)))),
    h('tfoot', {}, h('tr', {},
      h('th', { scope: 'row' }, 'Sin asignar'),
      h('td', {}, libres()),
      h('td', {}, '—'),
      h('td', {}, '—'))));

  cont.replaceChildren(tabla, h('p', { class: 'nota-resumen' },
    '«Ha añadido» cuenta los artículos que cada familia ha sumado a la lista base. ',
    'Si crece mucho, puede que estemos repitiendo cosas.'));
}

// --- Compartir «Lo mío» ---------------------------------------------
function textoMiLista() {
  const mios = [...estado.articulos.values()].filter((a) => a.familia_id === estado.miFamilia);
  const lineas = [`Lo que lleva ${nombreFamilia(estado.miFamilia)} a la casa rural (4-8 dic):`];
  for (const c of estado.comidas) {
    const deComida = mios.filter((a) => a.comida_id === c.id);
    if (!deComida.length) continue;
    lineas.push('', c.nombre);
    for (const a of deComida) {
      lineas.push(`${a.comprado ? '✓' : '·'} ${a.nombre}: ${textoCantidad(a)}${a.comprado ? ' (comprado)' : ''}`);
    }
  }
  return lineas.join('\n');
}

function renderCompartir(lista) {
  const cont = $('compartir');
  const n = lista.filter((a) => a.familia_id === estado.miFamilia).length;
  const mostrar = estado.filtro === 'mio' && n > 0;
  cont.hidden = !mostrar;
  if (!mostrar) {
    cont.dataset.firma = '';
    return;
  }
  if (cont.dataset.firma === 'boton') return;
  cont.dataset.firma = 'boton';
  cont.replaceChildren(h('button', {
    type: 'button', class: 'boton', 'data-foco': 'compartir', onclick: compartirMiLista,
  }, 'Copiar o compartir mi lista'));
}

async function compartirMiLista() {
  const texto = textoMiLista();
  const cont = $('compartir');
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Mi lista para la casa rural', text: texto });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(texto);
    cont.dataset.firma = 'copiado';
    cont.replaceChildren(
      h('button', {
        type: 'button', class: 'boton', 'data-foco': 'compartir', onclick: compartirMiLista,
      }, 'Copiar o compartir mi lista'),
      h('p', { class: 'comida-mensaje' }, icono('ok'), 'Lista copiada. Ya puedes pegarla en WhatsApp.'),
    );
    enfocar('compartir');
    anunciar('Lista copiada. Ya puedes pegarla en WhatsApp.');
  } catch {
    // Sin portapapeles: mostramos el texto para copiarlo a mano.
    cont.dataset.firma = 'texto';
    const area = h('textarea', { id: 'texto-mi-lista', readonly: true, 'data-foco': 'texto-mi-lista' });
    area.value = texto;
    cont.replaceChildren(h('div', { class: 'campo' },
      h('label', { for: 'texto-mi-lista' }, 'Tu lista. Selecciónala y cópiala:'), area));
    area.focus();
    area.select();
  }
}

// --- Lista de comidas -----------------------------------------------
const nodosComida = new Map();   // comidaId → { seccion, … }
const nodosArticulo = new Map(); // articuloId → { li, firma }

function renderLista() {
  const lista = $('lista');
  const filtro = FILTROS[estado.filtro];

  // Coloca las secciones en orden, reutilizando las que ya existen.
  const deseadas = [];
  for (const c of estado.comidas) {
    let nodos = nodosComida.get(c.id);
    if (!nodos) {
      nodos = crearSeccionComida(c.id);
      nodosComida.set(c.id, nodos);
    }
    actualizarSeccionComida(c, nodos, filtro);
    deseadas.push(nodos.seccion);
  }
  reconciliar(lista, deseadas);

  // Limpia las comidas que ya no existen.
  const vigentes = new Set(estado.comidas.map((c) => c.id));
  for (const id of nodosComida.keys()) {
    if (!vigentes.has(id)) {
      nodosComida.delete(id);
      estado.formAnadir.delete(id);
    }
  }
  for (const id of nodosArticulo.keys()) {
    if (!estado.articulos.has(id)) nodosArticulo.delete(id);
  }
  for (const id of estado.editando.keys()) {
    if (!estado.articulos.has(id)) estado.editando.delete(id);
  }
}

// Ordena los hijos de «padre» como «deseados» moviendo lo mínimo, para
// que el elemento con el foco no se saque del documento.
function reconciliar(padre, deseados) {
  let ref = padre.firstChild;
  for (const nodo of deseados) {
    if (nodo === ref) ref = ref.nextSibling;
    else padre.insertBefore(nodo, ref);
  }
  while (ref) {
    const siguiente = ref.nextSibling;
    ref.remove();
    ref = siguiente;
  }
}

function crearSeccionComida(id) {
  const tituloId = `c${id}-t`;
  const titulo = h('h2', { class: 'comida-titulo', id: tituloId, tabindex: '-1', 'data-foco': tituloId });
  const desc = h('p', { class: 'comida-descripcion' });
  const ul = h('ul', { class: 'articulos', role: 'list' });
  const vacio = h('p', { class: 'comida-vacia' });
  const mensaje = h('p', { class: 'comida-mensaje', hidden: true });
  const zonaForm = h('div');
  const botonAnadir = h('button', {
    type: 'button', class: 'boton boton-anadir', 'data-foco': `c${id}-anadir`,
    onclick: () => abrirFormAnadir(id),
  });
  const seccion = h('section', { class: 'comida', 'aria-labelledby': tituloId },
    titulo, desc, vacio, ul, mensaje, botonAnadir, zonaForm);
  return { seccion, titulo, desc, ul, vacio, mensaje, zonaForm, botonAnadir };
}

function actualizarSeccionComida(c, nodos, filtro) {
  if (nodos.titulo.textContent !== c.nombre) nodos.titulo.textContent = c.nombre;
  const descripcionTexto = c.descripcion ?? '';
  nodos.desc.textContent = descripcionTexto;
  nodos.desc.hidden = descripcionTexto === '';

  const articulos = [...estado.articulos.values()]
    .filter((a) => a.comida_id === c.id)
    .filter((a) => filtro.prueba(a) || estado.editando.has(a.id) || estado.errorArticulo.has(a.id))
    .sort((a, b) => a.id - b.id);

  const lis = articulos.map((a) => nodoArticulo(a));
  reconciliar(nodos.ul, lis);
  nodos.ul.hidden = lis.length === 0;

  nodos.vacio.hidden = lis.length > 0;
  nodos.vacio.textContent = {
    falta: 'Nada pendiente en esta comida.',
    mio: 'No llevas nada de esta comida.',
    todo: 'Todavía no hay artículos.',
  }[estado.filtro];

  const mensaje = estado.mensajeComida.get(c.id);
  nodos.mensaje.hidden = !mensaje;
  if (mensaje && nodos.mensaje.dataset.texto !== mensaje) {
    nodos.mensaje.dataset.texto = mensaje;
    nodos.mensaje.replaceChildren(icono('ok'), h('span', {}, mensaje));
  }

  const form = estado.formAnadir.get(c.id);
  nodos.botonAnadir.hidden = !puedeEscribir() || Boolean(form);
  if (!nodos.botonAnadir.firstChild) {
    nodos.botonAnadir.append(icono('mas'), 'Añadir artículo', soloLectores(` a ${c.nombre}`));
  } else {
    nodos.botonAnadir.lastChild.textContent = ` a ${c.nombre}`;
  }
  if (form && !puedeEscribir()) {
    // Si se va la conexión con el formulario abierto, lo dejamos: el
    // guardado dará un error claro y no se pierde lo escrito.
  }
  if (form) {
    if (form.parentNode !== nodos.zonaForm) nodos.zonaForm.replaceChildren(form);
  } else if (nodos.zonaForm.firstChild) {
    nodos.zonaForm.replaceChildren();
  }
}

// --- Tarjeta de artículo --------------------------------------------
function firmaArticulo(a) {
  const parecidos = [...(estado.parecidos.get(a.id) ?? [])]
    .map((id) => estado.articulos.get(id))
    .filter(Boolean)
    .map((p) => `${p.nombre}|${p.comida_id}`);
  return JSON.stringify([
    a.nombre, a.cantidad, a.unidad, a.notas, a.perecedero, a.familia_id, a.comprado,
    a.creado_por_familia_id, a.editado_por_familia_id,
    nombreFamilia(a.familia_id), nombreFamilia(a.creado_por_familia_id), nombreFamilia(a.editado_por_familia_id),
    familiaPorId(a.familia_id)?.color,
    estado.miFamilia, puedeEscribir(), parecidos,
    estado.errorArticulo.get(a.id) ?? null, estado.ocupado.has(a.id),
    estado.comidas.map((c) => c.nombre).join('|'),
  ]);
}

function nodoArticulo(a) {
  const existente = nodosArticulo.get(a.id);
  if (estado.editando.has(a.id)) {
    // Mientras se edita, la tarjeta solo contiene el formulario.
    const form = estado.editando.get(a.id);
    if (existente && existente.li.firstChild === form) return existente.li;
    const li = existente?.li ?? h('li', { class: 'articulo' });
    li.replaceChildren(form);
    nodosArticulo.set(a.id, { li, firma: 'editando' });
    return li;
  }
  const firma = firmaArticulo(a);
  if (existente && existente.firma === firma) return existente.li;

  const li = crearTarjeta(a);
  nodosArticulo.set(a.id, { li, firma });
  // Si la tarjeta antigua tenía el foco, lo pasamos al mismo control de la nueva.
  if (existente && existente.li.contains(document.activeElement)) {
    const clave = claveFocoActual();
    existente.li.replaceWith(li);
    if (!enfocar(clave)) li.querySelector('h3')?.focus();
  }
  return li;
}

function crearTarjeta(a) {
  const libre = a.familia_id == null;
  const mio = !libre && a.familia_id === estado.miFamilia;
  const familia = familiaPorId(a.familia_id);
  const desc = descripcion(a);
  const ocupado = estado.ocupado.has(a.id);

  // Estado: icono + texto (nunca solo color).
  let claseEstado; let iconoEstado; let textoEstado;
  if (libre) {
    claseEstado = 'estado-libre'; iconoEstado = 'libre'; textoEstado = 'Libre';
  } else if (a.comprado) {
    claseEstado = 'estado-comprado'; iconoEstado = 'comprado';
    textoEstado = mio ? 'Comprado por tu familia' : `Comprado por ${familia?.nombre ?? 'otra familia'}`;
  } else {
    claseEstado = mio ? 'estado-mio' : 'estado-otro'; iconoEstado = 'bolsa';
    textoEstado = mio ? `De tu familia (${familia?.nombre ?? ''})` : `De ${familia?.nombre ?? 'otra familia'}`;
  }

  const meta = [];
  if (a.creado_por_familia_id != null) meta.push(`Añadido por ${nombreFamiliaConTu(a.creado_por_familia_id)}`);
  if (a.editado_por_familia_id != null) meta.push(`Editado por ${nombreFamiliaConTu(a.editado_por_familia_id)}`);
  if (a.perecedero) meta.push('Perecedero');

  const parecidos = [...(estado.parecidos.get(a.id) ?? [])]
    .map((id) => estado.articulos.get(id))
    .filter(Boolean)
    .map((p) => `${p.nombre} (${comidaPorId(p.comida_id)?.nombre ?? 'otra comida'})`);

  const error = estado.errorArticulo.get(a.id);

  const boton = (texto, clase, foco, alPulsar, extra = {}) => h('button', {
    type: 'button',
    class: `boton ${clase}`,
    'data-foco': foco,
    'aria-disabled': ocupado ? 'true' : null,
    onclick: () => { if (!ocupado) alPulsar(); },
    ...extra,
  }, ...(Array.isArray(texto) ? texto : [texto]), soloLectores(`: ${desc}`));

  const acciones = [];
  if (puedeEscribir()) {
    if (libre) {
      acciones.push(boton('Me lo llevo', 'boton-primario boton-grande', `a${a.id}-llevo`, () => accion(a, 'llevo')));
    }
    if (mio) {
      acciones.push(boton('Ya no', '', `a${a.id}-yano`, () => accion(a, 'yano')));
      acciones.push(boton(
        [icono(a.comprado ? 'casillaMarcada' : 'casilla'), 'Comprado'],
        'boton-comprado', `a${a.id}-comprado`, () => accion(a, 'comprado'),
        { 'aria-pressed': String(a.comprado) },
      ));
    }
    acciones.push(boton('Editar', '', `a${a.id}-editar`, () => abrirEdicion(a.id)));
    const puedeBorrar = a.creado_por_familia_id === estado.miFamilia && (libre || mio);
    if (puedeBorrar) {
      acciones.push(boton('Borrar', 'boton-peligro', `a${a.id}-borrar`, () => accion(a, 'borrar')));
    }
  }

  return h('li', {
    class: 'articulo',
    style: familia ? `--color-familia: ${familia.color}` : null,
  },
  h('div', { class: 'articulo-cabecera' },
    h('h3', { class: 'articulo-nombre', tabindex: '-1', 'data-foco': `a${a.id}-t` }, a.nombre),
    h('p', { class: 'articulo-cantidad' }, textoCantidad(a))),
  h('p', { class: `estado ${claseEstado}` }, icono(iconoEstado), h('span', {}, textoEstado)),
  a.notas ? h('p', { class: 'articulo-notas' }, a.notas) : null,
  meta.length ? h('p', { class: 'articulo-meta' }, meta.join(' · ')) : null,
  parecidos.length ? h('p', { class: 'repetido' }, icono('aviso'),
    h('span', {}, h('strong', {}, '¿Repetido? '), `Se parece a: ${parecidos.join('; ')}.`)) : null,
  error ? h('p', { class: 'error-articulo' }, icono('error'), h('span', {}, error)) : null,
  acciones.length ? h('div', { class: 'acciones' }, acciones) : null);
}

// ---------------------------------------------------------------------
// Acciones sobre un artículo
// ---------------------------------------------------------------------
// Si el artículo deja de verse (p. ej., en «Falta» al apuntarse), el foco
// pasa al siguiente artículo visible de la misma comida o a su título.
function focoAlternativo(a, idsAntes) {
  const posicion = idsAntes.indexOf(a.id);
  const siguientes = [...idsAntes.slice(posicion + 1), ...idsAntes.slice(0, posicion).reverse()];
  for (const id of siguientes) if (enfocar(`a${id}-t`)) return;
  enfocar(`c${a.comida_id}-t`);
}

function idsVisiblesEn(comidaId) {
  return [...estado.articulos.values()]
    .filter((x) => x.comida_id === comidaId && FILTROS[estado.filtro].prueba(x))
    .sort((x, y) => x.id - y.id)
    .map((x) => x.id);
}

async function accion(a, tipo) {
  if (!puedeEscribir() || estado.ocupado.has(a.id)) return;
  const fam = estado.miFamilia;
  const desc = descripcion(a);

  if (tipo === 'borrar' && !window.confirm(`¿Borrar «${desc}»? No se puede deshacer.`)) return;

  const idsAntes = idsVisiblesEn(a.comida_id);
  estado.errorArticulo.delete(a.id);
  estado.mensajeComida.delete(a.comida_id);
  estado.ocupado.add(a.id);
  marcarReciente(a.id);
  render();

  let foco = null;
  try {
    if (tipo === 'llevo') {
      aplicarFila(await api.apuntarse(a.id, fam));
      anunciar(`Te llevas ${desc}. ${textoQuedan()}`);
      foco = `a${a.id}-comprado`;
    } else if (tipo === 'yano') {
      aplicarFila(await api.desapuntarse(a.id, fam));
      anunciar(`Ya no te llevas ${desc}. Queda libre. ${textoQuedan()}`);
      foco = `a${a.id}-llevo`;
    } else if (tipo === 'comprado') {
      const fila = await api.marcarComprado(a.id, fam, !a.comprado);
      aplicarFila(fila);
      anunciar(fila.comprado ? `${desc}: marcado como comprado.` : `${desc}: desmarcado, sin comprar.`);
      foco = `a${a.id}-comprado`;
    } else if (tipo === 'borrar') {
      await api.borrarArticulo(a.id, fam);
      estado.articulos.delete(a.id);
      guardarCache();
      programarParecidos();
      anunciar(`Borrado: ${desc}.`);
    }
  } catch (e) {
    estado.errorArticulo.set(a.id, e.message);
    anunciarError(e.message);
    foco = `a${a.id}-t`;
    if (e.red) pasarASinConexion();
    else if (e.pista === 'ya_asignado' || e.pista === 'no_existe') programarRecarga();
  } finally {
    estado.ocupado.delete(a.id);
    marcarReciente(a.id);
    render();
    if (!enfocar(foco)) focoAlternativo(a, idsAntes);
  }
}

// ---------------------------------------------------------------------
// Formularios de añadir y editar
// ---------------------------------------------------------------------
function campoTexto({ id, etiqueta, ayuda, valor = '', max, multilinea = false, extra = {} }) {
  const idAyuda = ayuda ? `${id}-ayuda` : null;
  const idError = `${id}-error`;
  const control = h(multilinea ? 'textarea' : 'input', {
    id,
    type: multilinea ? null : 'text',
    maxlength: max,
    rows: multilinea ? 2 : null,
    'aria-describedby': idAyuda,
    'data-foco': id,
    ...extra,
  });
  control.value = valor ?? '';
  const error = h('p', { class: 'error-campo', id: idError });
  const nodo = h('div', { class: 'campo' },
    h('label', { for: id }, etiqueta),
    idAyuda ? h('span', { class: 'ayuda', id: idAyuda }, ayuda) : null,
    control,
    error);
  return { nodo, control, error, idAyuda, idError };
}

function campoCasilla({ id, etiqueta, ayuda, marcado }) {
  const idAyuda = ayuda ? `${id}-ayuda` : null;
  const control = h('input', {
    type: 'checkbox', id, checked: marcado, 'aria-describedby': idAyuda, 'data-foco': id,
  });
  const nodo = h('div', { class: 'campo-casilla' },
    control,
    h('label', { for: id }, etiqueta,
      idAyuda ? h('span', { class: 'ayuda', id: idAyuda }, ayuda) : null));
  return { nodo, control };
}

function mostrarErrorCampo(campo, mensaje) {
  campo.error.replaceChildren(icono('error'), h('span', {}, mensaje));
  campo.control.setAttribute('aria-invalid', 'true');
  campo.control.setAttribute('aria-describedby', [campo.idError, campo.idAyuda].filter(Boolean).join(' '));
}

function limpiarErrorCampo(campo) {
  campo.error.replaceChildren();
  campo.control.removeAttribute('aria-invalid');
  if (campo.idAyuda) campo.control.setAttribute('aria-describedby', campo.idAyuda);
  else campo.control.removeAttribute('aria-describedby');
}

function crearFormulario({ modo, comidaId, articulo = null }) {
  const anadir = modo === 'anadir';
  const comida = comidaPorId(comidaId);
  const pre = anadir ? `f-c${comidaId}` : `f-a${articulo.id}`;
  const tituloId = `${pre}-t`;

  const campos = {
    nombre: campoTexto({
      id: `${pre}-nombre`, etiqueta: 'Nombre', ayuda: 'Por ejemplo: Pan de molde.',
      valor: articulo?.nombre, max: 60, extra: { required: true, autocomplete: 'off' },
    }),
    cantidad: campoTexto({
      id: `${pre}-cantidad`, etiqueta: 'Cantidad', ayuda: 'Un número entero, sin decimales.',
      valor: articulo ? String(articulo.cantidad) : '1', max: 3,
      extra: { required: true, inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' },
    }),
    unidad: campoTexto({
      id: `${pre}-unidad`, etiqueta: 'Unidad (opcional)', ayuda: 'Por ejemplo: barras, kg, paquetes de 500 g.',
      valor: articulo?.unidad, max: 30, extra: { autocomplete: 'off' },
    }),
    notas: campoTexto({
      id: `${pre}-notas`, etiqueta: 'Notas (opcional)', valor: articulo?.notas, max: 200, multilinea: true,
    }),
  };
  const perecedero = campoCasilla({
    id: `${pre}-perecedero`, etiqueta: 'Es perecedero', ayuda: 'Necesita nevera o caduca pronto.',
    marcado: Boolean(articulo?.perecedero),
  });
  const meLoLlevo = anadir ? campoCasilla({
    id: `${pre}-llevo`, etiqueta: 'Me lo llevo yo',
    ayuda: 'Si lo desmarcas, quedará libre para que se lo apunte otra familia.', marcado: true,
  }) : null;

  const errorGeneral = h('div', { class: 'aviso aviso-error error-formulario', hidden: true });
  const zonaDuplicados = h('div');
  const botonGuardar = h('button', { type: 'submit', class: 'boton boton-primario', 'data-foco': `${pre}-guardar` }, 'Guardar');
  const botonCancelar = h('button', { type: 'button', class: 'boton', 'data-foco': `${pre}-cancelar`, onclick: cerrar }, 'Cancelar');
  const botones = h('div', { class: 'acciones' }, botonGuardar, botonCancelar);

  const form = h('form', { class: 'formulario', novalidate: true, 'aria-labelledby': tituloId },
    h('h3', { id: tituloId, tabindex: '-1', 'data-foco': tituloId },
      anadir ? `Nuevo artículo en ${comida?.nombre ?? 'esta comida'}` : `Editar: ${articulo.nombre}`),
    campos.nombre.nodo, campos.cantidad.nodo, campos.unidad.nodo, campos.notas.nodo,
    perecedero.nodo, meLoLlevo?.nodo,
    errorGeneral, zonaDuplicados, botones);

  let enviando = false;
  let confirmado = null; // nombre normalizado ya avisado y aceptado

  function cerrar() {
    if (anadir) {
      estado.formAnadir.delete(comidaId);
      render();
      enfocar(`c${comidaId}-anadir`);
    } else {
      estado.editando.delete(articulo.id);
      nodosArticulo.delete(articulo.id);
      render();
      if (!enfocar(`a${articulo.id}-editar`)) enfocar(`a${articulo.id}-t`);
    }
  }

  function ocupar(si) {
    enviando = si;
    form.setAttribute('aria-busy', String(si));
    botonGuardar.textContent = si ? 'Guardando…' : 'Guardar';
  }

  function leerDatos() {
    return {
      nombre: campos.nombre.control.value.replace(/\s+/g, ' ').trim(),
      cantidadTexto: campos.cantidad.control.value.trim(),
      unidad: campos.unidad.control.value.replace(/\s+/g, ' ').trim(),
      notas: campos.notas.control.value.replace(/\s+/g, ' ').trim(),
      perecedero: perecedero.control.checked,
      meLoLlevo: meLoLlevo ? meLoLlevo.control.checked : false,
    };
  }

  function validar(datos) {
    const errores = [];
    if (!datos.nombre) errores.push(['nombre', 'Escribe el nombre.']);
    else if (datos.nombre.length > 60) errores.push(['nombre', 'El nombre puede tener como máximo 60 caracteres.']);
    if (!/^\d+$/.test(datos.cantidadTexto) || Number(datos.cantidadTexto) < 1 || Number(datos.cantidadTexto) > 999) {
      errores.push(['cantidad', 'La cantidad tiene que ser un número entero entre 1 y 999.']);
    }
    if (datos.unidad.length > 30) errores.push(['unidad', 'La unidad puede tener como máximo 30 caracteres.']);
    if (datos.notas.length > 200) errores.push(['notas', 'Las notas pueden tener como máximo 200 caracteres.']);
    return errores;
  }

  function mostrarErrorGeneral(mensaje) {
    errorGeneral.hidden = !mensaje;
    errorGeneral.replaceChildren(...(mensaje ? [icono('error'), h('p', {}, mensaje)] : []));
  }

  function quitarDuplicados() {
    zonaDuplicados.replaceChildren();
    botones.hidden = false;
  }

  function mostrarDuplicados(duplicados, nombreNormalizado, datos) {
    const titulo = h('h4', { id: `${pre}-dup-t`, tabindex: '-1', 'data-foco': `${pre}-dup-t` },
      icono('aviso'), 'Ya existe algo parecido');
    const items = duplicados.map((d) => {
      const cantidad = `${d.cantidad} ${d.unidad ?? ''}`.trim();
      let quien;
      if (d.familia_id == null) quien = 'está libre';
      else if (d.familia_id === estado.miFamilia) quien = d.comprado ? 'ya lo has comprado tú' : 'ya lo llevas tú';
      else quien = d.comprado ? `ya lo ha comprado ${d.familia_nombre}` : `lo lleva ${d.familia_nombre}`;
      const texto = `${d.nombre} (${cantidad}) en ${d.comida_nombre}: ${quien}.`;
      const apuntarme = anadir && d.familia_id == null
        ? h('button', {
          type: 'button', class: 'boton boton-primario', 'data-foco': `${pre}-dup-${d.id}`,
          onclick: () => apuntarmeAEse(d),
        }, 'Apuntarme a ese', soloLectores(`: ${d.nombre}, ${cantidad}, en ${d.comida_nombre}`))
        : null;
      return h('li', {}, h('p', {}, texto), apuntarme);
    });
    const panel = h('div', { class: 'duplicados', role: 'group', 'aria-labelledby': `${pre}-dup-t` },
      titulo,
      h('ul', { role: 'list' }, items),
      h('p', { class: 'pregunta' }, anadir ? '¿Qué quieres hacer?' : '¿Guardar el cambio de todas formas?'),
      h('div', { class: 'acciones' },
        h('button', {
          type: 'button', class: 'boton', 'data-foco': `${pre}-igualmente`,
          onclick: () => { confirmado = nombreNormalizado; quitarDuplicados(); guardar(datos); },
        }, anadir ? 'Añadir igualmente' : 'Guardar igualmente'),
        h('button', { type: 'button', class: 'boton', 'data-foco': `${pre}-dup-cancelar`, onclick: cerrar }, 'Cancelar')));
    zonaDuplicados.replaceChildren(panel);
    botones.hidden = true;
    titulo.focus();
    anunciar(`Aviso: ya existe algo parecido. ${duplicados.length === 1 ? 'Hay 1 coincidencia.' : `Hay ${duplicados.length} coincidencias.`}`);
  }

  async function apuntarmeAEse(d) {
    if (enviando) return;
    ocupar(true);
    try {
      marcarReciente(d.id);
      aplicarFila(await api.apuntarse(d.id, estado.miFamilia));
      const msg = `No se ha añadido nada nuevo: te llevas ${d.nombre} (${d.comida_nombre}).`;
      estado.mensajeComida.set(comidaId, msg);
      anunciar(`${msg} ${textoQuedan()}`);
      cerrar();
    } catch (e) {
      mostrarErrorGeneral(e.message);
      anunciarError(e.message);
      if (e.red) pasarASinConexion();
      // Recalcula la lista de parecidos con el estado nuevo.
      quitarDuplicados();
      confirmado = null;
    } finally {
      ocupar(false);
    }
  }

  async function guardar(datos) {
    ocupar(true);
    mostrarErrorGeneral(null);
    const valores = {
      comidaId,
      nombre: datos.nombre,
      cantidad: Number(datos.cantidadTexto),
      unidad: datos.unidad,
      notas: datos.notas,
      perecedero: datos.perecedero,
      meLoLlevo: datos.meLoLlevo,
    };
    try {
      if (anadir) {
        const fila = await api.anadirArticulo(estado.miFamilia, valores);
        marcarReciente(fila.id);
        aplicarFila(fila);
        const donde = fila.familia_id != null
          ? 'Lo llevas tú: lo verás en «Lo mío».'
          : 'Queda libre: lo verás en «Falta».';
        const msg = `Añadido: ${descripcion(fila)}. ${donde}`;
        estado.mensajeComida.set(comidaId, msg);
        anunciar(msg);
      } else {
        marcarReciente(articulo.id);
        const fila = await api.editarArticulo(articulo.id, estado.miFamilia, valores);
        aplicarFila(fila);
        anunciar(`Guardado: ${descripcion(fila)}.`);
      }
      cerrar();
    } catch (e) {
      const campo = e.campo && campos[e.campo];
      if (campo) {
        mostrarErrorCampo(campo, e.message);
        campo.control.focus();
      } else {
        mostrarErrorGeneral(e.message);
        anunciarError(e.message);
      }
      if (e.red) pasarASinConexion();
    } finally {
      ocupar(false);
    }
  }

  // Si cambia el nombre, el aviso de duplicados deja de valer.
  campos.nombre.control.addEventListener('input', () => {
    if (zonaDuplicados.firstChild) quitarDuplicados();
    confirmado = null;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (enviando) return;
    Object.values(campos).forEach(limpiarErrorCampo);
    mostrarErrorGeneral(null);

    const datos = leerDatos();
    const errores = validar(datos);
    if (errores.length) {
      for (const [campo, mensaje] of errores) mostrarErrorCampo(campos[campo], mensaje);
      campos[errores[0][0]].control.focus();
      return;
    }

    // Control antiduplicados: avisa antes de guardar, no bloquea.
    const nombreNormalizado = normalizar(datos.nombre);
    const hayQueComprobar = anadir || nombreNormalizado !== normalizar(articulo.nombre);
    if (hayQueComprobar && confirmado !== nombreNormalizado) {
      ocupar(true);
      let duplicados = [];
      try {
        duplicados = await api.posiblesDuplicados(comidaId, datos.nombre, articulo?.id ?? null);
      } catch (err) {
        if (err.red) {
          ocupar(false);
          mostrarErrorGeneral(err.message);
          anunciarError(err.message);
          pasarASinConexion();
          return;
        }
        // Si falla solo la comprobación, se sigue: el aviso no bloquea.
      }
      ocupar(false);
      if (duplicados.length) {
        mostrarDuplicados(duplicados, nombreNormalizado, datos);
        return;
      }
    }
    await guardar(datos);
  });

  return { form, enfocarInicio: () => campos.nombre.control.focus() };
}

function abrirFormAnadir(comidaId) {
  if (!puedeEscribir()) return;
  estado.mensajeComida.delete(comidaId);
  const { form, enfocarInicio } = crearFormulario({ modo: 'anadir', comidaId });
  estado.formAnadir.set(comidaId, form);
  render();
  enfocarInicio();
}

function abrirEdicion(articuloId) {
  const articulo = estado.articulos.get(articuloId);
  if (!articulo || !puedeEscribir()) return;
  estado.errorArticulo.delete(articuloId);
  const { form, enfocarInicio } = crearFormulario({ modo: 'editar', comidaId: articulo.comida_id, articulo });
  estado.editando.set(articuloId, form);
  render();
  enfocarInicio();
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function arrancar() {
  const familiaGuardada = Number(almacen.leer(CLAVE_FAMILIA));
  estado.miFamilia = Number.isInteger(familiaGuardada) && familiaGuardada > 0 ? familiaGuardada : null;
  const filtroGuardado = almacen.leer(CLAVE_FILTRO);
  if (FILTROS[filtroGuardado]) estado.filtro = filtroGuardado;

  for (const boton of document.querySelectorAll('.boton-filtro')) {
    boton.addEventListener('click', () => cambiarFiltro(boton.dataset.filtro));
  }

  // Primero, la última copia guardada (por si no hay conexión).
  const cache = leerCache();
  if (cache) {
    aplicarDatos(cache);
    estado.ultimaSync = cache.guardado ?? null;
  }
  estado.conexion = navigator.onLine ? 'cargando' : 'sin-conexion';

  // La configuración y el cliente de Supabase se cargan aparte: si fallan
  // (sin conexión o sin config.js), la app sigue mostrando la copia.
  let config = null;
  try {
    config = await import('./config.js');
  } catch {
    if (navigator.onLine) {
      estado.fatal = 'Falta el fichero de configuración (config.js). Consulta el README para crearlo.';
    }
  }
  if (config) {
    try {
      api = await import('./api.js');
      api.iniciar(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    } catch {
      api = null;
    }
  }

  window.addEventListener('online', () => sincronizar());
  window.addEventListener('offline', pasarASinConexion);
  document.addEventListener('visibilitychange', () => {
    // Los móviles duermen las pestañas: al volver, nos ponemos al día.
    if (document.visibilityState === 'visible' && api) sincronizar();
  });

  render();
  if (!estado.fatal) await sincronizar();
}

arrancar();
