/* Visor de Mortalidad por Cáncer — Región de Ñuble.
 *
 * Trabaja EXCLUSIVAMENTE con data/datos_cancer.json (agregados). Una celda es [n, tasa].
 * La interfaz solo interpreta el resultado: nunca suma, resta ni deduce valores. No consulta ninguna otra fuente.
 */
'use strict';

(function (global) {
  const RUTA_DATOS = 'data/datos_cancer.json';
  const NOMBRE_SEXO = { ambos: 'Ambos sexos', hombres: 'Hombres', mujeres: 'Mujeres' };
  const NOMBRE_SUBTIPO = {
    in_situ: 'In situ (D00-D09)',
    benigno: 'Benignas (D10-D36)',
    incierto: 'Comportamiento incierto o desconocido (D37-D48)',
  };
  const POBLACION_REFERENCIA = { F: 'población femenina', M: 'población masculina' };
  const ORDEN_ESPERADO = ['periodos', 'territorios', 'sexos', 'selecciones', 'edades'];
  const ORDEN_AJUSTADOS = ['periodos', 'territorios', 'selecciones'];
  const ORDEN_SEXOS_AJUSTADOS = ['periodos', 'selecciones'];

  // =====================================================================================  modelo (sin DOM)
  function interpretar(c) {
    if (!Array.isArray(c) || c.length !== 2) throw new Error('Celda con formato inesperado en los datos.');
    if (typeof c[0] !== 'number' || typeof c[1] !== 'number') throw new Error('Celda con un valor no numérico en los datos.');
    return { n: c[0], tasa: c[1] };
  }

  function crearModelo(datos) {
    if (!datos || !datos.dimensiones || !datos.valores || !datos.metadatos) throw new Error('Archivo de datos incompleto.');
    if (JSON.stringify(datos.orden_valores) !== JSON.stringify(ORDEN_ESPERADO)) {
      throw new Error('El orden de las dimensiones del archivo de datos no es el esperado.');
    }
    const dim = datos.dimensiones;
    const ids = {};
    const indice = {};
    for (const nombre of ORDEN_ESPERADO) {
      ids[nombre] = dim[nombre].map((x) => (typeof x === 'object' ? x.id : x));
      indice[nombre] = new Map(ids[nombre].map((id, i) => [id, i]));
    }
    const territorio = new Map(dim.territorios.map((t) => [t.id, t]));
    const seleccion = new Map(dim.selecciones.map((s) => [s.id, s]));
    function pos(nombre, id) {
      const i = indice[nombre].get(id);
      if (i === undefined) throw new Error(`Valor desconocido en ${nombre}: ${id}`);
      return i;
    }
    function celda(per, ter, sexo, sel, edad) {
      const c = datos.valores[pos('periodos', per)][pos('territorios', ter)][pos('sexos', sexo)][pos('selecciones', sel)][pos('edades', edad || 'total')];
      return interpretar(c);
    }
    // Tasa ajustada por edad: ya calculada en el archivo (solo «todas las edades»; sin dimensión de sexo). Se lee tal cual.
    const hayAjustadas = Array.isArray(datos.valores_ajustados) && Array.isArray(datos.sexos_ajustados);
    if (hayAjustadas && (JSON.stringify(datos.metadatos.orden_valores_ajustados) !== JSON.stringify(ORDEN_AJUSTADOS)
      || JSON.stringify(datos.metadatos.orden_sexos_ajustados) !== JSON.stringify(ORDEN_SEXOS_AJUSTADOS))) {
      throw new Error('El orden de las tasas ajustadas del archivo de datos no es el esperado.');
    }
    /** { tasa, sexos } de la selección en el período y territorio, o null si el archivo no trae tasas ajustadas.
     *  sexos ∈ ambos | mujeres | hombres: el conjunto con que se calculó (clasificación fija de la selección). */
    function ajustada(per, ter, sel) {
      if (!hayAjustadas) return null;
      const tasa = datos.valores_ajustados[pos('periodos', per)][pos('territorios', ter)][pos('selecciones', sel)];
      const sexos = datos.sexos_ajustados[pos('periodos', per)][pos('selecciones', sel)];
      if (typeof tasa !== 'number' || !Object.prototype.hasOwnProperty.call(NOMBRE_SEXO, sexos)) {
        throw new Error('Tasa ajustada con formato inesperado en los datos.');
      }
      return { tasa, sexos };
    }
    return { meta: datos.metadatos, dim, ids, territorio, seleccion, celda, hayAjustadas, ajustada };
  }

  /** La tasa ajustada solo se muestra con el filtro de sexo para el que se calculó (ambos sexos, o el sexo del sitio).
   *  Con otro filtro no existe: devuelve null y no se inventa una tasa por sexo. */
  function ajustadaVisible(aj, sexoFiltro) { return aj !== null && aj.sexos === sexoFiltro ? aj.tasa : null; }
  function textoTasaAjustada(v) { return v === null ? '—' : fmtTasa.format(v); }

  const fmtEntero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
  const fmtTasa = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function textoN(c) { return fmtEntero.format(c.n); }
  function textoTasa(c) { return fmtTasa.format(c.tasa); }
  function valorMetrica(c, metrica) { return metrica === 'tasa' ? c.tasa : c.n; }
  function textoMetrica(c, metrica) { return metrica === 'tasa' ? textoTasa(c) : textoN(c); }

  function esPreliminar(meta, periodo) {
    return (meta.anios_preliminares || []).some((a) => String(a) === String(periodo));
  }
  function contienePreliminar(meta, periodo) {
    if (periodo !== meta.periodo_completo) return esPreliminar(meta, periodo);
    return (meta.anios_preliminares || []).length > 0;
  }
  function etiquetaPeriodo(meta, periodo) {
    const base = String(periodo).replace('-', '–');
    if (periodo === meta.periodo_completo) {
      const pre = (meta.anios_preliminares || []).join(' y ');
      return pre ? `${base} (incluye ${pre} preliminares)` : base;
    }
    return esPreliminar(meta, periodo) ? `${base} (preliminar)` : base;
  }

  /** Período con asterisco si incluye años preliminares: «2019–2025*», «2024*», «2023». */
  function periodoConMarca(meta, periodo) {
    return `${String(periodo).replace('-', '–')}${contienePreliminar(meta, periodo) ? '*' : ''}`;
  }

  /** Nombre corto de la selección para el título: «(C50) MAMA» → «Mama (C50)»; los tipos quedan como vienen. */
  function nombreCorto(sel) {
    if (sel.nivel === 'tipo') return sel.id === 'C00-D48' ? `Todas las neoplasias (${sel.id})` : sel.etiqueta;
    const m = /^\(([^)]+)\)\s*(.+)$/.exec(sel.etiqueta);
    if (!m) return sel.etiqueta;
    const minus = m[2].toLocaleLowerCase('es-CL').replace(/\bhodgkin\b/g, 'Hodgkin');
    return `${minus.charAt(0).toLocaleUpperCase('es-CL')}${minus.slice(1)} (${m[1]})`;
  }

  /** Título del resultado: «Mama (C50) · Mujeres · Región de Ñuble · 2019–2025*». */
  function tituloResultado(meta, sel, nombreTerritorio, sexo, periodo) {
    return [nombreCorto(sel), NOMBRE_SEXO[sexo], nombreTerritorio, periodoConMarca(meta, periodo)].join(' · ');
  }

  /** Marca de las patologías de un solo sexo (su tasa usa la población femenina o masculina). */
  const MARCA_SEXO = { F: '♀', M: '♂' };
  function marcaSexoIndicador(sel) { return MARCA_SEXO[sel.sexo_indicador] || ''; }

  /** Orden: valores de mayor a menor (empates en el orden original). */
  function ordenarPorMetrica(items, metrica) {
    return items.map((it, i) => ({ it, i }))
      .sort((a, b) => valorMetrica(b.it.celda, metrica) - valorMetrica(a.it.celda, metrica) || a.i - b.i)
      .map((x) => x.it);
  }

  /** Opciones del filtro «Tipo de neoplasia», desde las selecciones del archivo (no se inventan categorías). */
  function opcionesTipo(dim) {
    const tipos = dim.selecciones.filter((s) => s.nivel === 'tipo');
    tipos.sort((a, b) => (a.id === 'C00-D48' ? -1 : b.id === 'C00-D48' ? 1 : 0));
    const opciones = tipos.map((s) => ({ valor: s.id, etiqueta: s.id === 'C00-D48' ? `Todas las neoplasias (${s.id})` : s.etiqueta }));
    for (const s of dim.selecciones.filter((x) => x.nivel === 'patologia' && x.subtipo)) {
      opciones.push({ valor: `sub:${s.id}`, etiqueta: `— ${NOMBRE_SUBTIPO[s.subtipo] || s.etiqueta}`, subtipo: true });
    }
    return opciones;
  }

  function patologiasDelTipo(dim, tipoValor) {
    const patologias = dim.selecciones.filter((s) => s.nivel === 'patologia');
    if (tipoValor.startsWith('sub:')) return patologias.filter((s) => s.tipo === 'no_maligno');
    const tipo = dim.selecciones.find((s) => s.id === tipoValor);
    if (!tipo || !['maligno', 'no_maligno'].includes(tipo.tipo)) return patologias;
    return patologias.filter((s) => s.tipo === tipo.tipo);
  }

  /** Opciones del filtro «Patología»: «Todas» (= total del tipo) y las patologías del tipo, con su etiqueta pública. */
  function opcionesPatologia(dim, tipoValor) {
    if (tipoValor.startsWith('sub:')) {
      const s = dim.selecciones.find((x) => x.id === tipoValor.slice(4));
      return [{ valor: s.id, etiqueta: s.etiqueta }];
    }
    return [{ valor: 'todas', etiqueta: 'Todas' }].concat(patologiasDelTipo(dim, tipoValor).map((s) => ({ valor: s.id, etiqueta: s.etiqueta })));
  }

  function seleccionEfectiva(tipoValor, patologiaValor) {
    if (tipoValor.startsWith('sub:')) return tipoValor.slice(4);
    return patologiaValor && patologiaValor !== 'todas' ? patologiaValor : tipoValor;
  }

  /** Comunas que se comparan en la vista territorial: las de la región, de la provincia o de la provincia de la comuna. */
  function comunasDeVista(dim, terId) {
    const t = dim.territorios.find((x) => x.id === terId);
    const comunas = dim.territorios.filter((x) => x.nivel === 'comuna');
    if (!t || t.nivel === 'region') return comunas;
    const provincia = t.nivel === 'provincia' ? t.id : t.padre;
    return comunas.filter((c) => c.padre === provincia);
  }

  const Modelo = {
    interpretar, crearModelo, textoN, textoTasa, textoMetrica, valorMetrica, etiquetaPeriodo, esPreliminar,
    contienePreliminar, ordenarPorMetrica, opcionesTipo, opcionesPatologia, patologiasDelTipo, seleccionEfectiva,
    comunasDeVista, periodoConMarca, nombreCorto, tituloResultado, marcaSexoIndicador, NOMBRE_SEXO,
    ajustadaVisible, textoTasaAjustada,
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Modelo; return; }

  // =====================================================================================  interfaz
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  let M = null;
  const estado = {
    tipo: 'C00-C97', patologia: 'todas', periodo: null, nivel: 'region', territorio: '16', sexo: 'ambos', desglose: 'anio',
    metricas: { evolucion: 'n', territorio: 'tasa', sexo: 'n', edad: 'n', patologias: 'n' },
  };

  function el(tag, attrs, texto) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    }
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function svgEl(tag, attrs, texto) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function llenarSelect(select, opciones, valor) {
    select.replaceChildren(...opciones.map((o) => el('option', { value: o.valor }, o.etiqueta)));
    select.value = opciones.some((o) => o.valor === valor) ? valor : opciones[0].valor;
    return select.value;
  }
  function recortar(texto, max) { return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto; }

  // ---------- filtros
  function configurarFiltros() {
    const dim = M.dim;
    llenarSelect($('f-tipo'), opcionesTipo(dim), estado.tipo);
    estado.tipo = $('f-tipo').value;
    llenarSelect($('f-periodo'), dim.periodos.map((p) => ({
      valor: p, etiqueta: p === M.meta.periodo_completo ? `${p.replace('-', '–')} (incluye preliminares)` : etiquetaPeriodo(M.meta, p),
    })), estado.periodo);
    sincronizarControles();

    $('f-tipo').addEventListener('change', () => { estado.tipo = $('f-tipo').value; estado.patologia = 'todas'; actualizarOpcionesDependientes(); actualizar(); });
    $('f-patologia').addEventListener('change', () => { estado.patologia = $('f-patologia').value; actualizar(); });
    $('f-periodo').addEventListener('change', () => { estado.periodo = $('f-periodo').value; actualizar(); });
    $('f-nivel').addEventListener('change', () => { estado.nivel = $('f-nivel').value; estado.territorio = null; actualizarOpcionesDependientes(); actualizar(); });
    $('f-territorio').addEventListener('change', () => { estado.territorio = $('f-territorio').value; actualizar(); });
    for (const r of document.querySelectorAll('input[name="sexo"]')) {
      r.addEventListener('change', () => { if (r.checked) { estado.sexo = r.value; actualizar(); } });
    }
    $('f-desglose').addEventListener('change', () => { estado.desglose = $('f-desglose').value; dibujarTablaDetalle(); guardarEnUrl(); });
    $('b-descargar').addEventListener('click', descargarCsv);
    for (const grupo of document.querySelectorAll('.metrica')) {
      const vista = grupo.dataset.vista;
      for (const [valor, texto] of [['n', 'Defunciones'], ['tasa', 'Tasa bruta']]) {
        const b = el('button', { type: 'button', 'aria-pressed': String(estado.metricas[vista] === valor), 'data-valor': valor }, texto);
        b.addEventListener('click', () => {
          estado.metricas[vista] = valor;
          for (const x of grupo.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.valor === valor));
          dibujarVistas();
        });
        grupo.append(b);
      }
    }
    // Teléfono: los filtros parten contraídos en un resumen; en pantallas anchas el botón no se muestra (CSS).
    $('b-filtros').addEventListener('click', () => {
      const abrir = !document.body.classList.contains('filtros-abiertos');
      document.body.classList.toggle('filtros-abiertos', abrir);
      $('b-filtros').setAttribute('aria-expanded', String(abrir));
      $('b-filtros').textContent = abrir ? 'Ocultar filtros' : 'Cambiar filtros';
    });
  }

  /** Lleva los controles al estado actual (al iniciar y cuando cambia la dirección). */
  function sincronizarControles() {
    $('f-tipo').value = estado.tipo;
    estado.tipo = $('f-tipo').value;
    $('f-periodo').value = estado.periodo;
    estado.periodo = $('f-periodo').value;
    $('f-nivel').value = estado.nivel;
    actualizarOpcionesDependientes();
    for (const r of document.querySelectorAll('input[name="sexo"]')) r.checked = r.value === estado.sexo;
    $('f-desglose').value = estado.desglose;
  }

  function actualizarOpcionesDependientes() {
    const pat = $('f-patologia');
    estado.patologia = llenarSelect(pat, opcionesPatologia(M.dim, estado.tipo), estado.patologia);
    pat.disabled = estado.tipo.startsWith('sub:');
    const territorios = M.dim.territorios.filter((t) => t.nivel === estado.nivel)
      .map((t) => ({ valor: t.id, etiqueta: t.nombre }));
    estado.territorio = llenarSelect($('f-territorio'), territorios, estado.territorio);
    $('f-territorio').disabled = territorios.length === 1;
  }

  function seleccionActual() { return seleccionEfectiva(estado.tipo, estado.patologia); }
  function nombreTerritorio(id) { return M.territorio.get(id).nombre; }

  // ---------- estado en la URL (para compartir o recargar la misma consulta)
  function guardarEnUrl() {
    const p = new URLSearchParams({ tipo: estado.tipo, patologia: estado.patologia, periodo: estado.periodo,
      nivel: estado.nivel, territorio: estado.territorio, sexo: estado.sexo, desglose: estado.desglose });
    history.replaceState(null, '', `#${p.toString()}`);
  }
  const ESTADO_INICIAL = { tipo: estado.tipo, patologia: estado.patologia, nivel: estado.nivel, territorio: estado.territorio,
    sexo: estado.sexo, desglose: estado.desglose };
  /** Parte de los valores iniciales y aplica solo los parámetros válidos de la dirección. */
  function leerDeUrl() {
    Object.assign(estado, ESTADO_INICIAL, { periodo: M.meta.periodo_completo });
    const p = new URLSearchParams(location.hash.slice(1));
    const tipos = opcionesTipo(M.dim).map((o) => o.valor);
    if (tipos.includes(p.get('tipo'))) estado.tipo = p.get('tipo');
    if (p.get('patologia') && (p.get('patologia') === 'todas' || M.seleccion.has(p.get('patologia')))) estado.patologia = p.get('patologia');
    if (M.dim.periodos.includes(p.get('periodo'))) estado.periodo = p.get('periodo');
    if (['region', 'provincia', 'comuna'].includes(p.get('nivel'))) estado.nivel = p.get('nivel');
    if (M.territorio.has(p.get('territorio')) && M.territorio.get(p.get('territorio')).nivel === estado.nivel) estado.territorio = p.get('territorio');
    if (M.dim.sexos.includes(p.get('sexo'))) estado.sexo = p.get('sexo');
    if (['anio', 'territorio', 'sexo', 'edad', 'patologia'].includes(p.get('desglose'))) estado.desglose = p.get('desglose');
  }

  // ---------- indicadores
  function actualizar() {
    const sel = M.seleccion.get(seleccionActual());
    const c = M.celda(estado.periodo, estado.territorio, estado.sexo, sel.id);
    const titulo = tituloResultado(M.meta, sel, nombreTerritorio(estado.territorio), estado.sexo, estado.periodo);
    $('i-titulo').textContent = titulo;
    $('i-preliminar').hidden = !contienePreliminar(M.meta, estado.periodo);
    $('filtros-resumen-texto').textContent = titulo;
    const vN = $('i-n');
    vN.textContent = textoN(c);
    const vT = $('i-tasa');
    vT.textContent = textoTasa(c);
    $('i-tasa-nota').textContent = sel.sexo_indicador ? `Calculada sobre la ${POBLACION_REFERENCIA[sel.sexo_indicador]}.` : '';
    const aj = M.ajustada(estado.periodo, estado.territorio, sel.id);
    const vAj = ajustadaVisible(aj, estado.sexo);
    $('i-tasa-ajustada').textContent = textoTasaAjustada(vAj);
    $('i-tasa-ajustada-nota').textContent = notaAjustada(aj, vAj);
    dibujarVistas();
    guardarEnUrl();
    const est = $('estado');
    est.classList.add('solo-lectores');
    est.textContent = `Mostrando ${titulo.replace(/\*$/, '')}`
      + `${contienePreliminar(M.meta, estado.periodo) ? ' (incluye información preliminar)' : ''}. Defunciones: ${textoN(c)}.`
      + ` Tasa bruta por 100.000 habitantes: ${textoTasa(c)}.`
      + ` Tasa ajustada por edad por 100.000 habitantes: ${vAj === null ? `no disponible. ${notaAjustada(aj, vAj)}` : textoTasaAjustada(vAj)}.`;
  }

  const FILTRO_SEXO = { ambos: 'Ambos', hombres: 'Hombres', mujeres: 'Mujeres' };
  function notaAjustada(aj, valor) {
    if (aj === null) return 'No disponible en este archivo de datos.';
    if (valor === null) return `Disponible solo con el filtro de sexo «${FILTRO_SEXO[aj.sexos]}», para el que se calcula.`;
    if (aj.sexos === 'ambos') return 'Estandarización directa, ambos sexos.';
    return `Solo ${aj.sexos}: población y ponderadores ${aj.sexos === 'mujeres' ? 'femeninos' : 'masculinos'}.`;
  }

  function etiquetaSeleccion(sel) {
    if (sel.nivel === 'tipo') return sel.id === 'C00-D48' ? `Todas las neoplasias (${sel.id})` : sel.etiqueta;
    return sel.etiqueta;
  }

  // ---------- gráficos SVG (escala calculada solo con valores publicados)
  function defsPreliminar(svg) {
    const defs = svgEl('defs');
    const pat = svgEl('pattern', { id: 'rayado-preliminar', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.append(svgEl('rect', { width: 6, height: 6, fill: '#9cc0e6' }), svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#2b6cb0', 'stroke-width': 2.4 }));
    defs.append(pat);
    svg.append(defs);
  }

  function barrasHorizontales(items, metrica, opciones) {
    const op = opciones || {};
    const ancho = op.ancho || 760;
    const alto = 28;
    const largoEtq = Math.max(...items.map((x) => x.etiqueta.length));
    const xBarra = Math.round(Math.min(ancho * 0.45, 330, Math.max(90, largoEtq * 7 + 16)));
    const maxCaracteres = Math.max(8, Math.floor((xBarra - 14) / 6.9));
    const anchoValor = 84;
    const anchoBarra = ancho - xBarra - anchoValor;
    const valores = items.map((x) => valorMetrica(x.celda, metrica));
    if (op.referencia) valores.push(op.referencia.valor);
    const max = Math.max(...valores, 0) || 1;
    const altoTotal = items.length * alto + (op.referencia ? 24 : 6);
    const svg = svgEl('svg', { viewBox: `0 0 ${ancho} ${altoTotal}`, role: 'img', 'aria-label': op.descripcion || '' });
    defsPreliminar(svg);
    const y0 = op.referencia ? 22 : 2;
    items.forEach((it, i) => {
      const y = y0 + i * alto;
      const etq = svgEl('text', { x: xBarra - 8, y: y + 18, 'text-anchor': 'end', class: `etiqueta${it.destacado ? ' destacada' : ''}` }, recortar(it.etiqueta, maxCaracteres));
      etq.append(svgEl('title', {}, it.etiqueta));
      svg.append(etq);
      const v = valorMetrica(it.celda, metrica);
      let xTexto = xBarra + 6;
      if (v > 0) {
        const w = Math.max(2, (v / max) * anchoBarra);
        svg.append(svgEl('rect', { x: xBarra, y: y + 5, width: w, height: alto - 10, rx: 2, class: `barra${it.destacado ? ' destacada' : ''}${it.preliminar ? ' preliminar' : ''}` }));
        xTexto = xBarra + w + 6;
      }
      svg.append(svgEl('text', { x: xTexto, y: y + 18, class: 'valor' }, textoMetrica(it.celda, metrica)));
    });
    svg.append(svgEl('line', { x1: xBarra, y1: y0, x2: xBarra, y2: y0 + items.length * alto, class: 'eje' }));
    if (op.referencia) {
      const x = xBarra + (op.referencia.valor / max) * anchoBarra;
      svg.append(svgEl('line', { x1: x, y1: 14, x2: x, y2: y0 + items.length * alto, class: 'referencia' }));
      svg.append(svgEl('text', { x: Math.min(x, ancho - 4), y: 11, 'text-anchor': x > ancho - 110 ? 'end' : 'middle', class: 'referencia-texto' }, op.referencia.texto));
    }
    return svg;
  }

  function barrasVerticales(items, metrica, opciones) {
    const op = opciones || {};
    const ancho = op.ancho || 760;
    const alto = 300;
    const arriba = 24;
    const abajo = items.some((x) => x.preliminar) ? 52 : 36;
    const izq = 8;
    const altoBarras = alto - arriba - abajo;
    const paso = (ancho - izq * 2) / items.length;
    const anchoB = Math.min(64, paso * 0.68);
    const valores = items.map((x) => valorMetrica(x.celda, metrica));
    const max = Math.max(...valores, 0) || 1;
    const svg = svgEl('svg', { viewBox: `0 0 ${ancho} ${alto}`, role: 'img', 'aria-label': op.descripcion || '' });
    defsPreliminar(svg);
    const base = arriba + altoBarras;
    const compacto = items.length > 10;
    items.forEach((it, i) => {
      const cx = izq + paso * i + paso / 2;
      const v = valorMetrica(it.celda, metrica);
      if (v > 0) {
        const h = Math.max(2, (v / max) * altoBarras);
        svg.append(svgEl('rect', { x: cx - anchoB / 2, y: base - h, width: anchoB, height: h, rx: 2, class: `barra${it.destacado ? ' destacada' : ''}${it.preliminar ? ' preliminar' : ''}` }));
        svg.append(svgEl('text', { x: cx, y: base - h - 6, 'text-anchor': 'middle', class: 'valor', 'font-size': compacto ? 10.5 : 12.5 }, textoMetrica(it.celda, metrica)));
      } else {
        svg.append(svgEl('text', { x: cx, y: base - 6, 'text-anchor': 'middle', class: 'valor', 'font-size': compacto ? 10.5 : 12.5 }, textoMetrica(it.celda, metrica)));
      }
      svg.append(svgEl('text', { x: cx, y: base + 18, 'text-anchor': 'middle', class: `etiqueta${it.destacado ? ' destacada' : ''}`, 'font-size': compacto ? 11 : 13 }, it.etiqueta));
      if (it.preliminar) svg.append(svgEl('text', { x: cx, y: base + 34, 'text-anchor': 'middle', class: 'valor', fill: '#8a5a00', 'font-size': 11 }, paso >= 76 ? '(preliminar)' : '(prel.)'));
    });
    svg.append(svgEl('line', { x1: izq, y1: base, x2: ancho - izq, y2: base, class: 'eje' }));
    return svg;
  }

  /** Con idDescripcion, la tabla se rotula con ese texto ya visible encima (aria-labelledby) y no repite el título en un
   *  caption; sin él, el título va en el caption. */
  function tablaDatos(items, caption, encabezadoCategoria, idDescripcion) {
    const t = el('table', { 'aria-labelledby': idDescripcion || null });
    if (!idDescripcion) t.append(el('caption', {}, caption));
    const thead = el('thead');
    const trh = el('tr');
    trh.append(el('th', { scope: 'col' }, encabezadoCategoria), el('th', { scope: 'col', class: 'num' }, 'Defunciones'),
      el('th', { scope: 'col', class: 'num' }, 'Tasa bruta por 100.000'));
    thead.append(trh);
    const tbody = el('tbody');
    for (const it of items) {
      const tr = el('tr', { class: it.destacado ? 'destacada' : null });
      const th = el('th', { scope: 'row' });
      th.append(document.createTextNode(it.etiqueta));
      if (it.preliminar) th.append(' ', el('span', { class: 'marca-preliminar' }, '(preliminar)'));
      tr.append(th, el('td', { class: 'num' }, textoN(it.celda)),
        el('td', { class: 'num' }, textoTasa(it.celda)));
      tbody.append(tr);
    }
    t.append(thead, tbody);
    return t;
  }

  function nombreMetrica(m) { return m === 'tasa' ? 'tasa bruta por 100.000 habitantes' : 'número de defunciones'; }

  function dibujar(idVista, items, tipoGrafico, descripcion, categoria, opciones) {
    const metrica = estado.metricas[idVista];
    $(`d-${idVista}`).textContent = descripcion;
    const cont = $(`g-${idVista}`);
    const desc = `${descripcion} Indicador: ${nombreMetrica(metrica)}.`;
    const ancho = Math.max(280, Math.floor(cont.clientWidth || 760));
    // Con poco espacio por barra, las verticales pasan a horizontales para que las etiquetas sigan legibles.
    const vertical = tipoGrafico === 'vertical' && (ancho - 16) / items.length >= 34;
    cont.replaceChildren(vertical
      ? barrasVerticales(items, metrica, { descripcion: desc, ancho })
      : barrasHorizontales(items, metrica, Object.assign({ descripcion: desc, ancho }, opciones || {})));
    $(`tb-${idVista}`).replaceChildren(tablaDatos(items, descripcion, categoria));
  }

  function contexto(sinPeriodo, sinTerritorio, sinSexo) {
    const sel = M.seleccion.get(seleccionActual());
    const partes = [etiquetaSeleccion(sel)];
    if (!sinPeriodo) partes.push(etiquetaPeriodo(M.meta, estado.periodo));
    if (!sinTerritorio) partes.push(nombreTerritorio(estado.territorio));
    if (!sinSexo) partes.push(NOMBRE_SEXO[estado.sexo]);
    return `${partes.join(' · ')}.`;
  }

  function itemsAnio() {
    const sel = seleccionActual();
    return M.dim.periodos.filter((p) => p !== M.meta.periodo_completo).map((p) => ({
      etiqueta: p, celda: M.celda(p, estado.territorio, estado.sexo, sel), preliminar: esPreliminar(M.meta, p), destacado: p === estado.periodo,
    }));
  }
  function itemsTerritorioVista() {
    const sel = seleccionActual();
    return comunasDeVista(M.dim, estado.territorio).map((t) => ({
      etiqueta: t.nombre, celda: M.celda(estado.periodo, t.id, estado.sexo, sel), destacado: t.id === estado.territorio,
    }));
  }
  function itemsSexo() {
    const sel = seleccionActual();
    return M.dim.sexos.map((s) => ({ etiqueta: NOMBRE_SEXO[s], celda: M.celda(estado.periodo, estado.territorio, s, sel), destacado: s === estado.sexo }));
  }
  function itemsEdad() {
    const sel = seleccionActual();
    return M.dim.edades.filter((e) => e !== 'total').map((e) => ({
      etiqueta: e.replace('-', '–'), celda: M.celda(estado.periodo, estado.territorio, estado.sexo, sel, e),
    }));
  }
  /** Con «marcar», las patologías de un solo sexo llevan ♀ o ♂ (su tasa usa la población de ese sexo). Solo cambia el
   *  rótulo: la celda es la misma del archivo. */
  function itemsPatologia(marcar) {
    const sel = seleccionActual();
    return patologiasDelTipo(M.dim, estado.tipo).map((s) => ({
      etiqueta: marcar && marcaSexoIndicador(s) ? `${s.etiqueta} ${marcaSexoIndicador(s)}` : s.etiqueta,
      celda: M.celda(estado.periodo, estado.territorio, estado.sexo, s.id), destacado: s.id === sel,
    }));
  }

  function dibujarVistas() {
    dibujar('evolucion', itemsAnio(), 'vertical', `Por año, ${contexto(true)}`, 'Año');
    const terr = ordenarPorMetrica(itemsTerritorioVista(), estado.metricas.territorio);
    const t = M.territorio.get(estado.territorio);
    const ambito = t.nivel === 'region' ? 'Comunas de la Región de Ñuble' : `Comunas de la ${M.territorio.get(t.nivel === 'provincia' ? t.id : t.padre).nombre}`;
    const nuble = M.celda(estado.periodo, '16', estado.sexo, seleccionActual());
    const referencia = estado.metricas.territorio === 'tasa'
      ? { valor: valorMetrica(nuble, 'tasa'), texto: `Ñuble: ${textoTasa(nuble)}` } : null;
    dibujar('territorio', terr, 'horizontal', `${ambito}, ${contexto(false, true)} Ordenadas de mayor a menor.`, 'Comuna', { referencia });
    dibujar('sexo', itemsSexo(), 'horizontal', `Comparación por sexo, ${contexto(false, false, true)}`, 'Sexo');
    dibujar('edad', itemsEdad(), 'vertical', `Por grupo de edad, ${contexto()} La tasa es específica del grupo de edad.`, 'Grupo de edad');
    const enTasa = estado.metricas.patologias === 'tasa';
    const pats = ordenarPorMetrica(itemsPatologia(true), estado.metricas.patologias);
    const haySexoUnico = patologiasDelTipo(M.dim, estado.tipo).some((s) => s.sexo_indicador);
    // Con «Tasa bruta» y patologías de un solo sexo, la advertencia de denominadores se muestra aparte, sobre el gráfico.
    $('a-patologias').hidden = !(enTasa && haySexoUnico);
    dibujar('patologias', pats, 'horizontal', `Patologías del tipo seleccionado, ${contexto(false, false, false).replace(/^[^·]*· /, '')} `
      + `Ordenadas por ${enTasa ? 'tasa bruta' : 'número de defunciones'}.${haySexoUnico ? ' ♀ y ♂: patologías de un solo sexo.' : ''}`, 'Patología');
    dibujarTablaDetalle();
  }

  // ---------- tabla detallada y descarga
  function filasDetalle() {
    const sel = seleccionActual();
    switch (estado.desglose) {
      case 'anio':
        return M.dim.periodos.map((p) => ({ etiqueta: etiquetaPeriodo(M.meta, p).replace(' (preliminar)', ''), preliminar: esPreliminar(M.meta, p),
          celda: M.celda(p, estado.territorio, estado.sexo, sel), destacado: p === estado.periodo }));
      case 'territorio':
        return M.dim.territorios.map((t) => ({ etiqueta: t.nivel === 'comuna' ? `  ${t.nombre}` : t.nombre,
          celda: M.celda(estado.periodo, t.id, estado.sexo, sel), destacado: t.id === estado.territorio }));
      case 'sexo': return itemsSexo();
      case 'edad': return [{ etiqueta: 'Todas las edades', celda: M.celda(estado.periodo, estado.territorio, estado.sexo, sel) }].concat(itemsEdad());
      default: {
        const tipoId = estado.tipo.startsWith('sub:') ? 'D00-D48' : estado.tipo;
        const total = M.seleccion.get(tipoId);
        return [{ etiqueta: etiquetaSeleccion(total), celda: M.celda(estado.periodo, estado.territorio, estado.sexo, tipoId), destacado: tipoId === sel }]
          .concat(itemsPatologia());
      }
    }
  }
  const NOMBRE_DESGLOSE = { anio: 'Año', territorio: 'Territorio', sexo: 'Sexo', edad: 'Grupo de edad', patologia: 'Patología' };
  function contextoDetalle() {
    const sel = M.seleccion.get(seleccionActual());
    const partes = { anio: [etiquetaSeleccion(sel), nombreTerritorio(estado.territorio), NOMBRE_SEXO[estado.sexo]],
      territorio: [etiquetaSeleccion(sel), etiquetaPeriodo(M.meta, estado.periodo), NOMBRE_SEXO[estado.sexo]],
      sexo: [etiquetaSeleccion(sel), etiquetaPeriodo(M.meta, estado.periodo), nombreTerritorio(estado.territorio)],
      edad: [etiquetaSeleccion(sel), etiquetaPeriodo(M.meta, estado.periodo), nombreTerritorio(estado.territorio), NOMBRE_SEXO[estado.sexo]],
      patologia: [etiquetaPeriodo(M.meta, estado.periodo), nombreTerritorio(estado.territorio), NOMBRE_SEXO[estado.sexo]] }[estado.desglose];
    return `Desglose por ${NOMBRE_DESGLOSE[estado.desglose].toLowerCase()}: ${partes.join(' · ')}.`;
  }
  function dibujarTablaDetalle() {
    const d = contextoDetalle();
    $('d-tabla').textContent = d;
    $('tb-detalle').replaceChildren(tablaDatos(filasDetalle(), d, NOMBRE_DESGLOSE[estado.desglose], 'd-tabla'));
  }

  function csvCampo(v) {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function descargarCsv() {
    const sel = M.seleccion.get(seleccionActual());
    const aj = M.ajustada(estado.periodo, estado.territorio, sel.id);
    const vAj = ajustadaVisible(aj, estado.sexo);
    const lineas = [
      ['Visor de Mortalidad por Cáncer — Región de Ñuble'],
      ['Selección', etiquetaSeleccion(sel)],
      ['Período', etiquetaPeriodo(M.meta, estado.periodo)],
      ['Territorio', nombreTerritorio(estado.territorio)],
      ['Sexo', NOMBRE_SEXO[estado.sexo]],
      ['Desglose', NOMBRE_DESGLOSE[estado.desglose]],
      ['Tasa', 'Tasa bruta por 100.000 habitantes.'],
      ['Tasa ajustada por edad por 100.000 habitantes (selección, período, territorio y sexo indicados; todas las edades)',
        vAj === null ? `No disponible. ${notaAjustada(aj, vAj)}` : textoTasaAjustada(vAj)],
      ['Preliminar', M.meta.nota_preliminar],
      ['Fuente', `Defunciones: ${M.meta.fuente_defunciones}. Población: ${M.meta.fuente_poblacion}.`],
      ['Datos generados', M.meta.generado],
      [],
      [NOMBRE_DESGLOSE[estado.desglose], 'Defunciones', 'Tasa bruta por 100.000', 'Observación'],
    ];
    for (const f of filasDetalle()) {
      lineas.push([f.etiqueta.trim(), f.celda.n, textoTasa(f.celda), f.preliminar ? 'Preliminar' : '']);
    }
    const csv = '﻿' + lineas.map((l) => l.map(csvCampo).join(';')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: `mortalidad_cancer_nuble_${estado.desglose}_${seleccionActual()}_${estado.periodo}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('estado').textContent = 'Se descargó la tabla detallada (solo datos agregados ya publicados).';
  }

  // ---------- inicio
  async function iniciar() {
    try {
      const r = await fetch(RUTA_DATOS, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`No se pudo leer ${RUTA_DATOS} (HTTP ${r.status}).`);
      M = crearModelo(await r.json());
    } catch (e) {
      const est = $('estado');
      est.classList.add('error');
      est.textContent = `No se pudieron cargar los datos del visor. ${e.message} `
        + 'Si abrió el archivo directamente, ábralo mediante un servidor web local (ver README).';
      document.body.dataset.estado = 'error';
      return;
    }
    leerDeUrl();
    configurarFiltros();
    const [a, m, d] = String(M.meta.generado).slice(0, 10).split('-');
    $('c-actualizacion').textContent = `Datos actualizados al ${d}-${m}-${a}`;
    $('p-denominador').replaceChildren(el('strong', {}, 'Patologías de un solo sexo: '), M.meta.nota_denominador);
    // Con tasas ajustadas en el archivo se describe su método; el texto «tasa_ajustada» de los metadatos es anterior.
    $('p-ajustada').replaceChildren(el('strong', {}, 'Tasa ajustada por edad: '), M.hayAjustadas
      ? `${M.meta.tasa_ajustada_metodo} El origen de la población estándar de los ponderadores está en revisión documental.`
      : M.meta.tasa_ajustada);
    $('p-generado').textContent = `Datos generados el ${new Date(M.meta.generado).toLocaleString('es-CL')}.`;
    $('resultados').hidden = false;
    $('vistas').hidden = false;
    actualizar();
    document.body.dataset.estado = 'listo';
  }

  // Cambio manual de la dirección (#...): se vuelven a leer y validar los filtros y se actualiza toda la vista.
  // guardarEnUrl usa history.replaceState, que no dispara este evento.
  global.addEventListener('hashchange', () => {
    if (!M) return;
    leerDeUrl();
    sincronizarControles();
    actualizar();
  });

  let temporizador = null;
  global.addEventListener('resize', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { if (M) dibujarVistas(); }, 150);
  });
  global.addEventListener('error', (ev) => {
    document.body.dataset.errorJs = ev.message;
    const est = $('estado');
    if (est) { est.classList.remove('solo-lectores'); est.classList.add('error'); est.textContent = `Error en la interfaz: ${ev.message}`; }
  });
  document.addEventListener('DOMContentLoaded', iniciar);
}(typeof window !== 'undefined' ? window : globalThis));
