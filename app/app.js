"use strict";

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (v) => (v == null ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
const pct = (v) => `${v > 0 ? "+" : ""}${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Todos los precios son de Cardmarket (en euros), vía Scryfall.
const cardmarketUrl = (name) => `https://www.cardmarket.com/es/Magic/Products/Search?searchString=${encodeURIComponent(String(name).split(" // ")[0])}`;

// Carpeta abierta (la mía es la 1). Se manda en todas las llamadas.
let cid = +(store("cid") || 1);

// Todo se calcula en el propio móvil (engine.js); ya no hay servidor.
async function api(path, body) {
  const url = path + (path.includes("?") ? "&" : "?") + `c=${cid}`;
  return Engine.call(url, body ? { c: cid, ...body } : undefined);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch { return null; }
}

// ---------- hoja inferior ----------
// Con una ventana abierta, el fondo no se mueve (si no, según dónde tocas, se desliza la página de detrás).
function openSheet(html) {
  $("#sheet-body").innerHTML = html;
  $("#sheet").hidden = false;
  $("#sheet-backdrop").hidden = false;
  $("#sheet").scrollTop = 0;
  document.documentElement.classList.add("lock");
  return $("#sheet-body");
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheet-backdrop").hidden = true;
  document.documentElement.classList.remove("lock");
}
$("#sheet-close").onclick = closeSheet;
$("#sheet-backdrop").onclick = closeSheet;

// ---------- cabecera ----------
async function loadSummary() {
  const s = await api("/api/summary");
  if (s.collection_id !== cid) { cid = 1; store("cid", "1"); render(); return loadSummary(); }  // colección borrada
  $("#top-label").textContent = s.collection;
  $("#top-value").textContent = euro(s.value);
  let sub = `${plural(s.cards, "carta", "cartas")} · Cardmarket, ${new Date(s.day).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`;
  if (s.prev_value != null && s.value != null && s.cards) {
    const d = s.value - s.prev_value;
    sub = `<span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${euro(Math.abs(d))} desde ayer</span> · ${sub}`;
  }
  $("#top-sub").innerHTML = sub;
  return s;
}

// ---------- elegir colección (la mía, la de un amigo...) ----------
async function collectionsSheet() {
  const list = await api("/api/collections");
  const body = openSheet(`
    <h3>Carpetas</h3>
    <div class="hint">Cada carpeta es un montón de cartas: las tuyas y, por ejemplo, las de un amigo para montarle mazos. Solo "Mis cartas" envía avisos de precio.</div>
    <div class="list">${list.map((c) => `
      <div class="item ${c.id === cid ? "on" : ""}" data-cid="${c.id}">
        <div class="item-main"><div class="item-title">${c.id === cid ? "✓ " : ""}${esc(c.name)}</div>
          <div class="item-meta">${plural(c.cards, "carta", "cartas")}</div></div>
        ${c.id !== 1 ? `<button class="btn" data-del="${c.id}" aria-label="Borrar ${esc(c.name)}">🗑</button>` : ""}
      </div>`).join("")}</div>
    <div class="field"><label>Nueva carpeta</label>
      <div style="display:flex;gap:8px"><input class="search" id="new-col" placeholder="Ej.: Cartas de Marc"><button class="btn primary" id="new-col-ok">Crear</button></div></div>`);
  const use = (id) => { cid = id; store("cid", String(id)); closeSheet(); refresh(); };
  body.querySelectorAll("[data-cid]").forEach((el) => (el.onclick = (e) => { if (!e.target.closest("[data-del]")) use(+el.dataset.cid); }));
  body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const c = list.find((x) => x.id === +b.dataset.del);
    if (!confirm(t(`¿Borrar "${c.name}" y sus ${c.cards} cartas? No se puede deshacer.`))) return;
    await api("/api/collections", { delete: c.id });
    if (cid === c.id) use(1); else collectionsSheet();
  }));
  $("#new-col-ok", body).onclick = async () => {
    const name = $("#new-col", body).value.trim();
    if (!name) return;
    try { const r = await api("/api/collections", { create: name }); use(r.id); toast(`Carpeta "${name}" creada`); }
    catch (err) { toast(err.message.includes("UNIQUE") ? "Ya existe una con ese nombre" : err.message); }
  };
}
$("#top-label").onclick = collectionsSheet;

// Idioma de la app (ver i18n.js): al cambiarlo se recarga para traducir todo de nuevo.
$("#lang-btn").textContent = LANG.toUpperCase();
$("#lang-btn").onclick = () => {
  const body = openSheet(`<h3>Idioma · Language · Idioma</h3><div class="list">${Object.entries(LANGS).map(([k, n]) => `
    <button class="item ${k === LANG ? "on" : ""}" data-lang="${k}"><div class="item-main"><div class="item-title">${k === LANG ? "✓ " : ""}${n}</div></div></button>`).join("")}</div>`);
  body.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => { store("lang", b.dataset.lang); location.reload(); }));
};

// ---------- importar (ManaBox, Moxfield, Deckbox, lista de texto) ----------
function importSheet() {
  const body = openSheet(`
    <h3>Importar cartas</h3>
    <div class="hint">Exporta tus cartas como <b>CSV</b> desde ManaBox (opción de exportar), Moxfield, Deckbox o Dragon Shield, y elige el archivo aquí. También vale una lista de texto tipo <code>4 Lightning Bolt</code>.</div>
    <label class="btn block" for="import-file">📄 Elegir archivo (.csv o .txt)</label>
    <input type="file" id="import-file" accept=".csv,.txt,text/csv,text/plain" hidden>
    <div class="field"><label>O pega aquí la lista</label><textarea class="search" id="import-text" rows="4" placeholder="4 Lightning Bolt&#10;2 Counterspell (MH2) 267"></textarea></div>
    <div class="seg" id="import-mode" style="margin-top:12px"><button data-m="add" class="on">Sumar a lo que hay</button><button data-m="replace">Reemplazar la carpeta</button></div>
    <div class="row-btns"><button class="btn primary" id="import-ok">Importar</button></div>
    <div id="import-result"></div>`);
  let mode = "add", text = "";
  body.querySelectorAll("#import-mode button").forEach((b) => (b.onclick = () => {
    mode = b.dataset.m;
    body.querySelectorAll("#import-mode button").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $("#import-file", body).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    text = await f.text();
    $("#import-text", body).value = "";
    $("#import-text", body).placeholder = `${f.name} · ${text.split("\n").length - 1} líneas`;
  };
  $("#import-ok", body).onclick = async () => {
    const t = $("#import-text", body).value.trim() || text;
    if (!t) return toast("Elige un archivo o pega una lista");
    if (mode === "replace" && !confirm(t("Se borrarán las cartas que hay ahora en esta carpeta. ¿Seguir?"))) return;
    const btn = $("#import-ok", body);
    btn.disabled = true;
    btn.textContent = "Importando…";
    try {
      const r = await api("/api/import", { text: t, mode });
      $("#import-result", body).innerHTML = `
        <div class="stats"><div class="stat"><b>${r.imported}</b><span>Cartas importadas</span></div>
          <div class="stat"><b>${r.unique}</b><span>Distintas</span></div>
          <div class="stat"><b class="${r.missing ? "down" : ""}">${r.missing}</b><span>No encontradas</span></div></div>
        ${r.missing ? `<div class="hint">No he encontrado:<br>${r.missing_examples.map(esc).join("<br>")}</div>` : ""}`;
      toast(`${r.imported} cartas importadas`);
      loadSummary();
      render();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Importar";
    }
  };
}


// ---------- piezas comunes de las rejillas de cartas ----------
// Mantener pulsada una carta (≈0,45 s) hace lo mismo que el botón "Seleccionar".
function longPress(el, fn) {
  let t = null, fired = false, x0 = 0, y0 = 0;
  const clear = () => { clearTimeout(t); t = null; };
  el.addEventListener("pointerdown", (e) => {
    fired = false; x0 = e.clientX; y0 = e.clientY; clear();
    t = setTimeout(() => { fired = true; navigator.vibrate?.(25); fn(); }, 450);
  });
  el.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 12) clear(); });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => el.addEventListener(ev, clear));
  el.addEventListener("click", (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/** Selección múltiple en una rejilla: tocar abre la carta; con la selección activa, la marca. */
function gridSelect(root, { onTap, onChange }) {
  const sel = { on: false, ids: new Set() };
  const toggle = (b) => {
    const id = b.dataset.id;
    sel.ids.has(id) ? sel.ids.delete(id) : sel.ids.add(id);
    b.classList.toggle("picked", sel.ids.has(id));
    onChange(sel, false);
  };
  sel.bind = () => root.querySelectorAll(".grid [data-id]").forEach((b) => {
    b.classList.toggle("picked", sel.ids.has(b.dataset.id));
    b.onclick = () => (sel.on ? toggle(b) : onTap(b.dataset.id));
    longPress(b, () => { if (!sel.on) { sel.on = true; onChange(sel, true); } if (!sel.ids.has(b.dataset.id)) toggle(b); });
  });
  sel.set = (on) => { sel.on = on; if (!on) sel.ids.clear(); onChange(sel, true); };
  return sel;
}

const tile = (c, extra = "") => `<button class="gcard ${c.qty ? "" : "missing"}" data-id="${esc(c.key || c.id)}">
    <img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
    ${c.qty ? `<span class="badge full">×${c.qty}</span>` : ""}<span class="check" aria-hidden="true">✓</span>${extra}
    <div class="why">${esc(c.name)} · ${euro(c.eur)}</div>
  </button>`;

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("No se ha podido copiar"); }
}
// Compartir (WhatsApp, notas, correo…) en el móvil; si no se puede, se copia.
async function shareText(title, text) {
  const S = window.Capacitor?.Plugins?.Share;
  try {
    if (S) return await S.share({ title, text, dialogTitle: title });
    if (navigator.share) return await navigator.share({ title, text });
  } catch (e) {
    if (/cancel|abort/i.test(String(e?.message || e?.name || e))) return;
  }
  return copy(text, "Lista copiada");
}

// Selector visual de edición/arte: tira de imágenes de todas las impresiones.
const artStrip = (printings, pid) => `<div class="arts" id="arts">${printings.map((x) => `
    <button class="art ${x.id === pid ? "on" : ""}" data-pid="${x.id}">
      <img loading="lazy" draggable="false" src="${esc(x.image)}" alt="${esc(x.set_name)}">
      <span>${esc(x.set.toUpperCase())} #${esc(x.number)}<br><b>${euro(x.eur)}</b></span>
    </button>`).join("")}</div>`;

// ---------- vistas ----------
const views = {};
let state = { collectionFilter: "", deckSort: store("deckSort") || "meta", marketScope: store("marketScope") || "pauper", marketDays: +(store("marketDays") || 7) };

function render() {
  const tab = (location.hash || "#collection").slice(1);
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  $("#col-bar")?.remove();
  (views[tab] || views.collection)();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => { if (!Engine.day) return; closeSheet(); loadSummary(); render(); });
document.addEventListener("keydown", (e) => e.key === "Escape" && (closeScanner() || closeSheet()));

const skeleton = (n = 4) => `<div class="list">${'<div class="skeleton"></div>'.repeat(n)}</div>`;

// Cartas: rejilla con imágenes (o lista) y selección para crear un mazo con varias.
views.collection = async () => {
  const v = $("#view");
  let mode = store("colView") || "grid";
  v.innerHTML = `<div class="row-btns" style="margin-top:4px"><button class="btn" id="col-import">📥 Importar</button><button class="btn" id="col-build">🔨 Crear mazo</button></div>
    <h2>Cartas</h2>
    <input class="search" id="col-filter" placeholder="Filtrar o buscar carta para añadir…" value="${esc(state.collectionFilter)}">
    <div class="seg" id="col-view" style="margin-top:8px"><button data-v="grid">🖼 Imágenes</button><button data-v="list">☰ Lista</button><button data-v="select">☑ Seleccionar</button></div>
    <div id="col-list">${skeleton()}</div>`;
  document.body.insertAdjacentHTML("beforeend", `<div class="sel-bar floating" id="col-bar" hidden>
    <span class="sub" id="col-count"></span><button class="btn" id="col-cancel">Cancelar</button><button class="btn primary" id="col-go">🔨 Crear mazo</button></div>`);
  $("#col-import").onclick = importSheet;
  $("#col-build").onclick = () => builderSheet();
  const items = await api("/api/collection");
  items.forEach((c) => (c.key = c.row_id));
  const box = $("#col-list");
  let limit = 200;  // con colecciones grandes, pintar de 200 en 200
  const sel = gridSelect(box, {
    onTap: (key) => cardSheet(items.find((c) => c.key === key)),
    onChange: (s, modeChanged) => {
      $("#col-bar").hidden = !s.on;
      $("#col-count").textContent = `${s.ids.size} elegidas`;
      $("#col-go").disabled = !s.ids.size;
      if (modeChanged) { if (s.on && mode !== "grid") { mode = "grid"; draw(); } paintSeg(); }
    },
  });
  const paintSeg = () => v.querySelectorAll("#col-view button").forEach((b) => b.classList.toggle("on", b.dataset.v === (sel.on ? "select" : mode)));
  const draw = () => {
    const f = state.collectionFilter.toLowerCase();
    const shown = items.filter((c) => !f || c.name.toLowerCase().includes(f) || c.decks.some((d) => d.toLowerCase().includes(f)));
    const page = shown.slice(0, limit);
    const list = mode === "grid" ? `<div class="grid">${page.map((c) => tile(c, c.foil ? '<span class="num-tag">Foil</span>' : "")).join("")}</div>`
      : `<div class="list">${page.map((c) => `
      <button class="item" data-row="${esc(c.key)}">
        <img class="thumb" loading="lazy" src="${esc(c.image)}" alt="">
        <div class="item-main">
          <div class="item-title">${esc(c.name)}</div>
          <div class="item-meta"><i class="r r-${esc(c.rarity)}"></i>${esc(c.set.toUpperCase())} #${esc(c.number)}
            ${c.foil ? '<span class="chip foil">Foil</span>' : ""}
            ${c.pauper === "banned" ? '<span class="chip ban">Baneada</span>' : ""}</div>
          ${c.decks.length ? `<div class="item-meta">${c.decks.slice(0, 3).map((d) => `<span class="chip gold">${esc(d)}</span>`).join("")}${c.decks.length > 3 ? `<span class="chip">+${c.decks.length - 3}</span>` : ""}</div>` : ""}
        </div>
        <div class="item-side"><div class="price">${euro(c.eur)}</div><div class="sub">×${c.qty}</div></div>
      </button>`).join("")}</div>`;
    box.innerHTML = items.length === 0
      ? f ? "" : `<div class="empty"><strong>Esta carpeta está vacía</strong>Pulsa el sello rojo para escanear cartas, escribe su nombre arriba o importa un CSV de ManaBox.</div>`
      : `${mode === "grid" ? `<div class="hint">Mantén pulsada una carta para elegir varias y crear un mazo con ellas.</div>` : ""}${list}
        ${shown.length > limit ? `<button class="btn block" id="col-more" style="margin-top:10px">Ver más (${shown.length - limit})</button>` : ""}`;
    $("#col-more", box)?.addEventListener("click", () => { limit += 300; draw(); });
    if (f.length >= 2) {
      box.insertAdjacentHTML("beforeend", `<h2>Añadir a la carpeta</h2><div class="list" id="col-search"></div>`);
      searchInto($("#col-search"), state.collectionFilter);
    }
    box.querySelectorAll("[data-row]").forEach((b) => (b.onclick = () => cardSheet(items.find((c) => c.key === b.dataset.row))));
    sel.bind();
    paintSeg();
  };
  v.querySelectorAll("#col-view button").forEach((b) => (b.onclick = () => {
    if (b.dataset.v === "select") return sel.set(!sel.on);
    sel.set(false);
    mode = b.dataset.v;
    store("colView", mode);
    draw();
  }));
  $("#col-cancel").onclick = () => sel.set(false);
  $("#col-go").onclick = () => {
    const names = [...new Set([...sel.ids].map((k) => items.find((c) => c.key === k)?.name).filter(Boolean))];
    sel.set(false);
    builderSheet(names);
  };
  draw();
  let t;
  $("#col-filter").oninput = (e) => {
    state.collectionFilter = e.target.value;
    clearTimeout(t);
    t = setTimeout(draw, 200);
  };
};

async function searchInto(box, text) {
  const results = await api(`/api/search?q=${encodeURIComponent(text)}`);
  box.innerHTML = results.length ? results.map((r) => `
    <button class="item" data-name="${esc(r.name)}">
      <img class="thumb" loading="lazy" src="${esc(r.image)}" alt="">
      <div class="item-main"><div class="item-title">${esc(r.name)}</div>
        <div class="item-meta">${r.pauper === "legal" ? '<span class="chip gold">Pauper</span>' : r.pauper === "banned" ? '<span class="chip ban">Baneada en Pauper</span>' : ""}</div></div>
      <div class="item-side"><div class="sub">desde</div><div class="price">${euro(r.eur)}</div></div>
    </button>`).join("") : `<div class="hint">No hay cartas con ese nombre.</div>`;
  box.querySelectorAll("[data-name]").forEach((b) => (b.onclick = () => addSheet([{ name: b.dataset.name }])));
}

// Ficha de una carta de la carpeta
function cardSheet(c) {
  const body = openSheet(`
    <h3>${esc(c.name)}</h3>
    <div class="sub">${esc(c.set_name)} · #${esc(c.number)} ${c.foil ? "· Foil" : ""}</div>
    <img class="card-big" src="${esc(c.image)}" alt="${esc(c.name)}">
    <div class="stats">
      <div class="stat"><b>${euro(c.eur)}</b><span>Precio unidad</span></div>
      <div class="stat"><b>${c.qty}</b><span>Copias</span></div>
      <div class="stat"><b>${euro((c.eur || 0) * c.qty)}</b><span>Total</span></div>
    </div>
    ${c.decks.length ? `<h2>La juegan en Pauper</h2><div class="item-meta">${c.decks.map((d) => `<span class="chip gold">${esc(d)}</span>`).join("")}</div>` : ""}
    ${/land/i.test(c.type || "") ? "" : `<button class="btn block" id="build-from" style="margin-top:12px">🔨 Crear un mazo con esta carta${/legendary.*creature/i.test(c.type || "") ? " (o de Commander)" : ""}</button>`}
    <button class="btn block" id="open-set" style="margin-top:8px">📜 Ver la colección ${esc(c.set_name)}</button>
    <button class="btn block" id="open-syn" style="margin-top:8px">🔮 Cartas que combinan con esta</button>
    <a class="btn block" style="margin-top:8px;text-decoration:none" target="_blank" rel="noopener"
       href="${cardmarketUrl(c.name)}">🛒 Ver en Cardmarket</a>
    <div class="row-btns">
      <button class="btn" data-d="-1">Quitar una</button>
      <button class="btn primary" data-d="1">Añadir otra</button>
    </div>`);
  $("#build-from", body)?.addEventListener("click", () => builderSheet([c.name], /legendary.*creature/i.test(c.type || "") ? "commander" : null));
  $("#open-set", body).onclick = () => setSheet(c.set);
  $("#open-syn", body).onclick = () => synergySheet(c.name);
  body.querySelectorAll("[data-d]").forEach((b) => (b.onclick = async () => {
    await api("/api/collection", { card_id: c.id, foil: c.foil, qty: +b.dataset.d });
    closeSheet();
    toast(+b.dataset.d > 0 ? "Añadida" : "Quitada");
    refresh();
  }));
}

// Elegir carta, arte (con imágenes), foil y cantidad, y añadir.
async function addSheet(candidates, opts = {}) {
  const body = opts.into || openSheet(`<h3>Añadir carta</h3><div id="add-body">${skeleton(1)}</div>`);
  if (opts.into) body.innerHTML = `<div id="add-body">${skeleton(1)}</div>`;
  const cands = await Promise.all(candidates.map(async (c) => ({ ...c, printings: c.printings || (await api(`/api/printings?name=${encodeURIComponent(c.name)}`)) })));
  let ci = 0, qty = 1, foil = false;
  // Sin edición detectada, propone la normal más barata (la más común en colecciones).
  const defaultPrint = (c) => c.best || [...c.printings].filter((p) => p.eur != null)
    .sort((a, b) => a.variant - b.variant || a.eur - b.eur)[0]?.id || c.printings[0]?.id;
  let pid = defaultPrint(cands[0]);
  const draw = () => {
    const c = cands[ci];
    const p = c.printings.find((x) => x.id === pid) || c.printings[0];
    $("#add-body", body).innerHTML = `
      ${cands.length > 1 ? `<div class="hint">¿Cuál es? Toca la correcta:</div><div class="candidates">${cands.map((x, i) => `
        <button class="cand ${i === ci ? "on" : ""}" data-ci="${i}"><img src="${esc(x.printings[0]?.image)}" alt=""><span>${esc(x.name)}</span></button>`).join("")}</div>` : ""}
      ${opts.compact ? "" : `<img class="card-big" src="${esc(p.image)}" alt="${esc(c.name)}">`}
      <div class="field"><label>Arte y edición: ${esc(p.set_name)} #${esc(p.number)} (${c.printings.length} versiones)</label>${artStrip(c.printings, p.id)}</div>
      <div class="field" style="flex-direction:row;justify-content:space-between;align-items:center">
        <label class="toggle"><input type="checkbox" id="add-foil" ${foil ? "checked" : ""}> Foil</label>
        <div class="stepper"><button data-q="-1">−</button><b class="num">${qty}</b><button data-q="1">+</button></div>
      </div>
      <div class="stats"><div class="stat"><b>${euro(foil ? p.eur_foil : p.eur)}</b><span>Precio unidad</span></div>
        <div class="stat"><b>${euro((foil ? p.eur_foil : p.eur) * qty || null)}</b><span>Total</span></div>
        <div class="stat"><b>${p.pauper === "legal" ? "Sí" : p.pauper === "banned" ? "Ban" : "No"}</b><span>Legal Pauper</span></div></div>
      <div class="row-btns">
        ${opts.onSkip ? `<button class="btn" id="add-skip">No es esta</button>` : ""}
        <button class="btn primary" id="add-ok">Añadir ${qty > 1 ? qty : ""}</button>
      </div>`;
    $(".art.on", body)?.scrollIntoView({ inline: "center", block: "nearest" });
    body.querySelectorAll("[data-ci]").forEach((b) => (b.onclick = () => { ci = +b.dataset.ci; pid = defaultPrint(cands[ci]); draw(); }));
    body.querySelectorAll("[data-pid]").forEach((b) => (b.onclick = () => { pid = b.dataset.pid; draw(); }));
    $("#add-foil", body).onchange = (e) => { foil = e.target.checked; draw(); };
    body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { qty = Math.max(1, qty + +b.dataset.q); draw(); }));
    $("#add-ok", body).onclick = async () => {
      await api("/api/collection", { card_id: p.id, foil, qty });
      toast(`${qty}× ${c.name} añadida`);
      if (opts.onDone) opts.onDone(); else closeSheet();
      refresh();
    };
    if (opts.onSkip) $("#add-skip", body).onclick = opts.onSkip;
  };
  draw();
}

// ---------- Mazos: los míos y el meta de Pauper ----------
const deckCard = (d) => `
  <button class="item deck" data-id="${esc(d.id)}">
    <div class="deck-head"><span class="deck-name">${esc(d.archetype)}</span>${d.share != null ? `<span class="share">${d.share}%</span>` : ""}</div>
    <div class="item-meta"><span class="chip">${esc(d.category)}</span>${euro(d.price)} el mazo
      ${d.result ? `· ${d.result === "1" ? "🏆 Ganadora" : `${esc(d.result)}º`}${d.event ? ` en ${esc(d.event)}` : ""}` : ""}</div>
    <div class="thumbs">${d.thumbs.filter(Boolean).map((src) => `<img loading="lazy" src="${esc(src)}" alt="">`).join("")}</div>
    <div class="bar"><i style="width:${d.owned_pct}%"></i></div>
    <div class="deck-foot"><span>Tienes el ${d.owned_pct}%</span><span>${d.missing_cost ? `Te faltan ${euro(d.missing_cost)}` : "¡Lo puedes montar!"}</span></div>
  </button>`;

views.decks = async () => {
  const v = $("#view");
  v.innerHTML = `<button class="item builder-cta" id="deck-build">
      <span class="cta-icon">🔨</span>
      <div class="item-main"><div class="item-title">Crear un mazo con tus cartas</div>
        <div class="item-meta">Pauper, Commander, Estándar o Casual: a partir de una o varias cartas, o de un comandante.</div></div>
    </button>
    <h2>Mis mazos</h2>
    <div class="hint">Importa una lista o guarda un mazo (del meta o del constructor) para ver qué cartas te faltan.</div>
    <button class="btn block" id="deck-import">📥 Importar una lista</button>
    <div id="my-decks"></div>
    <h2>Meta de Pauper</h2><div class="hint">De cada arquetipo, la lista mejor clasificada (🏆 la ganadora si la hay) de los últimos 2 meses en MTGTop8. "Weenie White" es el mono blanco (Convoke, Kor Skyfisher…).</div>
    <div class="seg" id="deck-sort">
      <button data-s="meta">Más jugados</button><button data-s="owned">Puedo montar</button><button data-s="cheap">Más baratos</button><button data-s="missing">Me falta menos €</button>
    </div><div id="deck-list">${skeleton(5)}</div>`;
  $("#deck-build").onclick = () => builderSheet();
  $("#deck-import").onclick = importDeckSheet;
  const [mine, decks] = await Promise.all([api("/api/mydecks"), api("/api/decks")]);
  $("#my-decks").innerHTML = mine.length ? `<div class="list">${mine.map(deckCard).join("")}</div>` : "";
  $("#my-decks").querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => deckSheet(b.dataset.id)));
  const sorters = { meta: (a, b) => b.share - a.share, owned: (a, b) => b.owned_pct - a.owned_pct, cheap: (a, b) => a.price - b.price, missing: (a, b) => a.missing_cost - b.missing_cost };
  const draw = () => {
    v.querySelectorAll("#deck-sort button").forEach((b) => b.classList.toggle("on", b.dataset.s === state.deckSort));
    const box = $("#deck-list");
    if (!decks.length) { box.innerHTML = `<div class="empty"><strong>Aún no hay datos del meta</strong>Se descargan cada día.</div>`; return; }
    box.innerHTML = `<div class="list">${[...decks].sort(sorters[state.deckSort]).map(deckCard).join("")}</div>`;
    box.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => deckSheet(b.dataset.id)));
  };
  v.querySelectorAll("#deck-sort button").forEach((b) => (b.onclick = () => { state.deckSort = b.dataset.s; store("deckSort", b.dataset.s); draw(); }));
  draw();
};

function importDeckSheet() {
  const body = openSheet(`<h3>Importar una lista</h3>
    <div class="hint">Pega la lista (de MTGTop8, Moxfield, Arena…): una carta por línea, <code>4 Lightning Bolt</code>. Lo que vaya tras "Sideboard" cuenta como banquillo.</div>
    <div class="field"><label>Nombre del mazo</label><input class="search" id="dk-name" placeholder="Ej.: Mi Mono White Convoke"></div>
    <div class="field"><label>Lista</label><textarea class="search" id="dk-text" rows="8" placeholder="4 Kor Skyfisher&#10;4 Battle Screech&#10;…&#10;Sideboard&#10;2 Prismatic Strands"></textarea></div>
    <label class="btn block" for="dk-file" style="margin-top:8px">📄 O elige un archivo .txt</label><input type="file" id="dk-file" accept=".txt,.dec,.dek,text/plain" hidden>
    <div class="row-btns"><button class="btn primary" id="dk-ok">Guardar en Mis mazos</button></div><div id="dk-result"></div>`);
  $("#dk-file", body).onchange = async (e) => { const f = e.target.files[0]; if (f) { $("#dk-text", body).value = await f.text(); $("#dk-name", body).value ||= f.name.replace(/\.\w+$/, ""); } };
  $("#dk-ok", body).onclick = async () => {
    try {
      const r = await api("/api/mydecks", { import: { name: $("#dk-name", body).value.trim() || "Mi mazo", text: $("#dk-text", body).value } });
      toast(`Mazo guardado (${r.cards} cartas distintas)`);
      if (r.unknown.length) {
        $("#dk-result", body).innerHTML = `<div class="warn">No he reconocido estas líneas:<br>${r.unknown.slice(0, 15).map(esc).join("<br>")}</div>
          <button class="btn block" id="dk-open">Ver el mazo</button>`;
        $("#dk-open", body).onclick = () => deckSheet(r.id);
      } else deckSheet(r.id);
      if ((location.hash || "") === "#decks") views.decks();
    } catch (err) { toast(err.message); }
  };
}

async function deckSheet(id) {
  const body = openSheet(skeleton(3));
  const d = await api(`/api/deck?id=${encodeURIComponent(id)}`);
  const line = (c) => {
    const cls = c.have >= c.qty ? "full" : c.have > 0 ? "part" : "none";
    return `<div class="deck-line"><span class="qty ${cls}">${c.basic ? c.qty : `${c.have}/${c.qty}`}</span><span class="n">${esc(c.name)}</span><span class="${c.basic ? "sub" : "price"}">${c.basic ? "básica" : euro(c.eur)}</span></div>`;
  };
  const main = d.cards.filter((c) => !c.side), side = d.cards.filter((c) => c.side);
  const missing = d.cards.filter((c) => !c.basic && c.have < c.qty).map((c) => `${c.qty - c.have} ${c.name}`);
  body.innerHTML = `
    <h3>${esc(d.archetype)}</h3>
    <div class="sub">${d.mine ? esc(d.event) : `${esc(d.player)} · ${d.result === "1" ? "🏆 Ganadora" : `${esc(d.result)}º`} en ${esc(d.event)} · ${esc(d.date)}`}</div>
    <div class="stats">
      <div class="stat"><b>${euro(d.price)}</b><span>Precio del mazo</span></div>
      <div class="stat"><b>${d.owned_pct}%</b><span>Lo tienes</span></div>
      <div class="stat"><b>${euro(d.missing_cost)}</b><span>Te falta</span></div>
    </div>
    <div class="seg" id="deck-view"><button data-v="img">Imágenes</button><button data-v="list">Lista</button></div>
    <div class="hint" id="deck-hint"></div>
    <div id="deck-cards"></div>
    <div class="row-btns">
      <button class="btn" id="copy-all">Copiar lista</button>
      <button class="btn primary" id="share-missing" ${missing.length ? "" : "disabled"}>Compartir lo que falta</button>
    </div>
    <button class="btn block" id="deck-keep" style="margin-top:8px">${d.mine ? "🗑 Borrar de Mis mazos" : "⭐ Guardar en Mis mazos"}</button>`;
  const tileD = (c) => {
    const missingN = c.basic ? 0 : c.qty - c.have;
    return `<div class="gcard ${missingN === c.qty ? "missing" : ""}">
      <img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
      <span class="badge ${missingN ? (c.have ? "part" : "none") : "full"}">${c.basic ? c.qty : `${c.have}/${c.qty}`}</span>
      <div class="why">${c.basic ? "básica" : euro(c.eur)}</div></div>`;
  };
  const drawCards = () => {
    const mode = store("deckView") || "img";
    body.querySelectorAll("#deck-view button").forEach((b) => b.classList.toggle("on", b.dataset.v === mode));
    $("#deck-hint", body).textContent = mode === "img"
      ? "En gris, las cartas que no tienes. El número es copias tuyas / copias del mazo."
      : "Precio con la edición más barata de cada carta (Cardmarket). Verde: la tienes; amarillo: te faltan copias.";
    const section = (cards) => (mode === "img" ? `<div class="grid">${cards.map(tileD).join("")}</div>` : cards.map(line).join(""));
    $("#deck-cards", body).innerHTML = `
      <h2>Main (${main.reduce((s, c) => s + c.qty, 0)})</h2>${section(main)}
      ${side.length ? `<h2>Sideboard (${side.reduce((s, c) => s + c.qty, 0)})</h2>${section(side)}` : ""}`;
  };
  body.querySelectorAll("#deck-view button").forEach((b) => (b.onclick = () => { store("deckView", b.dataset.v); drawCards(); }));
  drawCards();
  $("#copy-all", body).onclick = () => copy([...main.map((c) => `${c.qty} ${c.name}`), ...(side.length ? ["", "Sideboard", ...side.map((c) => `${c.qty} ${c.name}`)] : [])].join("\n"), "Lista copiada");
  $("#share-missing", body).onclick = () => shareText(`Me falta para ${d.archetype}`, missing.join("\n"));
  $("#deck-keep", body).onclick = async () => {
    if (d.mine) {
      if (!confirm(t(`¿Borrar "${d.archetype}" de Mis mazos?`))) return;
      await api("/api/mydecks", { delete: d.id });
      closeSheet();
      toast("Mazo borrado");
    } else {
      const r = await api("/api/mydecks", { save: { name: d.archetype, format: "Pauper", cards: d.cards.map((c) => [c.name, c.qty, c.side ? 1 : 0]) } });
      toast("Guardado en Mis mazos");
      deckSheet(r.id);
    }
    if ((location.hash || "") === "#decks") views.decks();
  };
}

// ---------- Colecciones: ediciones, Lista Reservada y mazos preconstruidos ----------
const RARITIES = [["common", "Común"], ["uncommon", "Infrecuente"], ["rare", "Rara"], ["mythic", "Mítica"]];
const year = (d) => (d ? d.slice(0, 4) : "");
const setIcon = (s, cls = "set-icon") => (s.icon ? `<img class="${cls}" src="${esc(s.icon)}" alt="">`
  : `<span class="${cls} set-emoji">${s.code === "reserved" ? "📜" : "🎁"}</span>`);

function setRow(s, withProgress = true) {
  return `<button class="item set-row" data-code="${esc(s.code)}">
    ${setIcon(s)}
    <div class="item-main">
      <div class="item-title">${esc(s.name)}</div>
      <div class="item-meta">${s.pinned ? '<span class="pin">📌 Siguiendo</span>' : ""}<span>${s.code.startsWith("deck:") ? esc(s.type) : s.code === "reserved" ? "" : esc(s.code.toUpperCase())}${s.released ? ` · ${year(s.released)}` : ""} · ${s.total} cartas</span></div>
      ${withProgress ? `<div class="bar"><i style="width:${s.pct}%"></i></div>
        <div class="deck-foot"><span>Tienes ${s.owned} de ${s.total}</span><span>${s.pct}%</span></div>` : ""}
    </div></button>`;
}

views.sets = async () => {
  const v = $("#view");
  v.innerHTML = `<h2>Colecciones</h2>
    <div class="hint">Cada vez que registras una carta, su colección aparece aquí. Fija las que quieras completar para seguirlas y ver qué te falta.</div>
    <div class="list">
      <button class="item set-row" id="sp-reserved"><span class="set-icon set-emoji">📜</span><div class="item-main"><div class="item-title">Lista Reservada</div>
        <div class="item-meta">Las cartas que Wizards se ha comprometido a no reimprimir nunca.</div></div></button>
      <button class="item set-row" id="sp-precons"><span class="set-icon set-emoji">🎁</span><div class="item-main"><div class="item-title">Mazos preconstruidos</div>
        <div class="item-meta">Todos los mazos oficiales de la historia: Commander, Theme Decks, Intro Packs, Duel Decks…</div></div></button>
    </div>
    <input class="search" id="set-q" placeholder="Buscar una colección para seguirla…" style="margin-top:14px">
    <div class="list" id="set-search"></div>
    <div id="set-list">${skeleton(4)}</div>`;
  $("#sp-reserved").onclick = () => setSheet("reserved");
  $("#sp-precons").onclick = preconSheet;
  const sets = await api("/api/sets");
  const pinned = sets.filter((s) => s.pinned), started = sets.filter((s) => !s.pinned);
  $("#set-list").innerHTML = (pinned.length ? `<h2>Siguiendo</h2><div class="list">${pinned.map((s) => setRow(s)).join("")}</div>` : "")
    + (started.length ? `<h2>Empezadas</h2><div class="list">${started.map((s) => setRow(s)).join("")}</div>`
      : pinned.length ? "" : `<div class="empty"><strong>Aún no has empezado ninguna</strong>Escanea o importa cartas y sus colecciones aparecerán aquí. También puedes buscar una arriba y seguirla.</div>`);
  v.querySelectorAll("#set-list [data-code]").forEach((b) => (b.onclick = () => setSheet(b.dataset.code)));
  let t;
  $("#set-q").oninput = (e) => {
    clearTimeout(t);
    const text = e.target.value.trim();
    t = setTimeout(async () => {
      const box = $("#set-search");
      if (text.length < 2) { box.innerHTML = ""; return; }
      const found = await api(`/api/sets/search?q=${encodeURIComponent(text)}`);
      box.innerHTML = found.length ? found.map((s) => setRow(s, false)).join("") : `<div class="hint">No encuentro ninguna colección con ese nombre.</div>`;
      box.querySelectorAll("[data-code]").forEach((b) => (b.onclick = () => setSheet(b.dataset.code)));
    }, 250);
  };
};

async function preconSheet() {
  const body = openSheet(`<h3>Mazos preconstruidos</h3>
    <div class="hint">Busca por nombre, tipo (Commander, Theme Deck…) o colección. Arriba, los que ya tienes empezados.</div>
    <input class="search" id="pc-q" placeholder="Ej.: Commander 2016, Elves, Duel Decks…"><div class="list" id="pc-list">${skeleton(4)}</div>`);
  const draw = async (q = "") => {
    try {
      const rows = await api(`/api/precons?q=${encodeURIComponent(q)}`);
      $("#pc-list", body).innerHTML = rows.map((s) => setRow(s)).join("") || `<div class="hint">No encuentro ningún mazo así.</div>`;
      body.querySelectorAll("[data-code]").forEach((b) => (b.onclick = () => setSheet(b.dataset.code)));
    } catch (err) { $("#pc-list", body).innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };
  let t;
  $("#pc-q", body).oninput = (e) => { clearTimeout(t); t = setTimeout(() => draw(e.target.value), 250); };
  draw();
}

// opts: filtros y posición a recuperar al volver (para no saltar arriba después de añadir).
async function setSheet(code, opts = {}) {
  const body = openSheet(skeleton(3));
  const sheet = $("#sheet");
  let all = !!opts.all, rarity = opts.rarity || "all", show = opts.show || store("setShow") || "all", d, foil = false;
  const updateBar = (s) => {
    const bar = $("#sel-bar", body);
    if (!bar) return;
    bar.hidden = !s.on;
    $("#sel-add", body).textContent = s.ids.size ? `Añadir 1 de cada (${s.ids.size})` : "Toca las cartas que quieras";
    $("#sel-add", body).disabled = !s.ids.size;
    $("#sel-toggle", body).textContent = s.on ? "✓ Seleccionando… (toca para salir)" : "☑ Seleccionar varias (o mantén pulsada una carta)";
    $("#sel-toggle", body).classList.toggle("primary", s.on);
  };
  const back = () => ({ all, rarity, show, scroll: sheet.scrollTop });
  const sel = gridSelect(body, {
    onTap: (id) => { const c = d.cards.find((x) => x.id === id); const b = back(); addSheet([{ name: c.name, best: c.id }], { onDone: () => setSheet(code, b) }); },
    onChange: updateBar,
  });
  const load = async (keepScroll) => {
    const y = keepScroll ? sheet.scrollTop : 0;
    d = await api(`/api/set?code=${encodeURIComponent(code)}&all=${all ? 1 : 0}`);
    draw();
    sheet.scrollTop = y;
  };
  const draw = () => {
    const y = sheet.scrollTop;
    const pct = d.total ? Math.round((100 * d.owned) / d.total) : 0;
    const cards = d.cards.filter((c) => (rarity === "all" || c.rarity === rarity) && (show === "all" || (show === "missing" ? !c.qty : c.qty)));
    const missing = d.cards.filter((c) => !c.qty && !c.basic);
    body.innerHTML = `
      <div class="set-head">${setIcon(d)}<div>
        <h3>${esc(d.name)}</h3><div class="sub">${d.special ? esc(d.type === "reserved" ? "No se reimprimen" : d.type) : esc(d.code.toUpperCase())}${d.released ? ` · ${esc(d.released)}` : ""}</div></div></div>
      <button class="btn block ${d.pinned ? "" : "primary"}" id="set-pin">${d.pinned ? "Dejar de seguir" : "📌 Seguir esta colección"}</button>
      <div class="stats">
        <div class="stat"><b>${d.owned}/${d.total}</b><span>Tienes (${pct}%)</span></div>
        <div class="stat"><b>${euro(d.value_owned)}</b><span>Lo que tienes vale</span></div>
        <div class="stat"><b>${euro(d.missing_cost)}</b><span>Completarla cuesta</span></div>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="rarity-row">${RARITIES.filter(([k]) => d.rarity[k]).map(([k, n]) => `<div><b>${d.rarity[k].owned}/${d.rarity[k].total}</b><i class="r r-${k}"></i> ${n}</div>`).join("")}</div>
      ${d.special ? "" : `<div class="seg" id="set-all"><button data-a="0" class="${all ? "" : "on"}">Colección base</button><button data-a="1" class="${all ? "on" : ""}">Todas las versiones</button></div>`}
      <div class="seg" id="set-show"><button data-s="all">Todas</button><button data-s="missing">Me faltan (${missing.length})</button><button data-s="have">Las tengo</button></div>
      <div class="seg" id="set-rarity"><button data-r="all">Cualquier rareza</button>${RARITIES.map(([k, n]) => `<button data-r="${k}">${n}</button>`).join("")}</div>
      <div class="hint">${d.special ? "Vale cualquier edición de cada carta." : all ? "Incluye promos, versiones sin borde, showcase…" : "Cartas normales de la colección; vale cualquier versión de la misma edición."}
        Toca una carta para añadirla.</div>
      <button class="btn block" id="sel-toggle"></button>
      <div class="grid" style="margin-top:12px">${cards.map((c) => tile(c, `<span class="num-tag">#${esc(c.number)}</span>`)).join("") || `<div class="hint">Ninguna carta con estos filtros.</div>`}</div>
      <div class="row-btns">
        <button class="btn" id="set-copy" ${missing.length ? "" : "disabled"}>Copiar lo que falta</button>
        <button class="btn primary" id="set-share" ${missing.length ? "" : "disabled"}>Compartir lo que falta (${missing.length})</button>
      </div>
      <div class="sel-bar" id="sel-bar" hidden>
        <label class="toggle"><input type="checkbox" id="sel-foil" ${foil ? "checked" : ""}> Foil</label>
        <button class="btn" id="sel-all">Todas las visibles</button>
        <button class="btn primary" id="sel-add" disabled>Toca las cartas que quieras</button>
      </div>`;
    body.querySelectorAll("#set-show button").forEach((b) => b.classList.toggle("on", b.dataset.s === show));
    body.querySelectorAll("#set-rarity button").forEach((b) => b.classList.toggle("on", b.dataset.r === rarity));
    body.querySelectorAll("#set-show button").forEach((b) => (b.onclick = () => { show = b.dataset.s; store("setShow", show); draw(); }));
    body.querySelectorAll("#set-rarity button").forEach((b) => (b.onclick = () => { rarity = b.dataset.r; draw(); }));
    body.querySelectorAll("#set-all button").forEach((b) => (b.onclick = () => { all = b.dataset.a === "1"; load(); }));
    $("#set-pin", body).onclick = async () => {
      await api("/api/sets", d.pinned ? { unpin: d.code } : { pin: d.code });
      toast(d.pinned ? "Ya no la sigues" : `Siguiendo ${d.name}`);
      d.pinned = !d.pinned;
      draw();
      if ((location.hash || "#collection") === "#sets") views.sets();
    };
    const missingText = () => missing.map((c) => (d.special ? `1 ${c.name}` : `1 ${c.name} (${d.code.toUpperCase()}) ${c.number}`)).join("\n");
    $("#set-copy", body).onclick = () => copy(missingText(), "Lista de lo que falta copiada");
    $("#set-share", body).onclick = () => shareText(`Me falta de ${d.name}`, missingText());
    $("#sel-toggle", body).onclick = () => sel.set(!sel.on);
    $("#sel-foil", body).onchange = (e) => { foil = e.target.checked; };
    $("#sel-all", body).onclick = () => {
      body.querySelectorAll(".grid [data-id]").forEach((b) => { sel.ids.add(b.dataset.id); b.classList.add("picked"); });
      updateBar(sel);
    };
    $("#sel-add", body).onclick = async () => {
      const ids = [...sel.ids];
      for (const id of ids) await api("/api/collection", { card_id: id, foil, qty: 1 });
      toast(`${plural(ids.length, "carta añadida", "cartas añadidas")}${foil ? " (foil)" : ""}`);
      sel.ids.clear();
      loadSummary();
      await load(true);
    };
    sel.bind();
    updateBar(sel);
    sheet.scrollTop = y;
  };
  if (opts.scroll) {
    await load();
    sheet.scrollTop = opts.scroll;
  } else load();
}

// ---------- constructor de mazos ----------
const COLORS = [["W", "Blanco"], ["U", "Azul"], ["B", "Negro"], ["R", "Rojo"], ["G", "Verde"]];
const FORMAT_NAMES = { pauper: "Pauper", commander: "Commander", standard: "Estándar", casual: "Casual" };
const manaIcon = (k, label = k) => `<img class="mana-icon" src="mana/${k}.svg" alt="${esc(label)}">`;

async function builderSheet(seeds, startFormat) {
  if (!seeds || !seeds.length) return pickSeed();
  seeds = [].concat(seeds);
  const body = openSheet(`<h3>Mazo con ${esc(seeds.join(", "))}</h3><div id="b-body">${skeleton(4)}</div>`);
  let colors = null, format = startFormat || store("buildFormat") || "pauper";
  const run = async () => {
    $("#b-body", body).innerHTML = `<div class="hint">Buscando cartas que encajen con el plan…</div>${skeleton(4)}`;
    let d;
    try {
      d = await api(`/api/build?seeds=${encodeURIComponent(seeds.join("|"))}&format=${format}${colors ? `&colors=${colors}` : ""}`);
    } catch (err) {
      $("#b-body", body).innerHTML = `<div class="empty"><strong>No he podido montarlo</strong>${esc(err.message)}</div>`;
      return;
    }
    colors = d.colors;
    format = d.format;  // puede cambiar solo (p. ej. a Casual si la carta no es legal en Pauper)
    const s = d.stats;
    const maxCurve = Math.max(1, ...Object.values(s.curve));
    const t = (c) => `<div class="gcard"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
      <span class="badge full">${c.qty}</span><div class="why">${esc(c.reasons.slice(0, 2).join(" · "))}</div></div>`;
    const group = (title, cards) => cards.length ? `<h2>${title} (${cards.reduce((n, c) => n + c.qty, 0)})</h2>
      <div class="grid">${cards.map(t).join("")}</div>` : "";
    const creatures = d.cards.filter((c) => c.role === "criatura"), spells = d.cards.filter((c) => c.role === "hechizo");
    const rows = [...(d.commander ? [d.commander] : []), ...d.cards, ...d.lands];
    const listText = rows.map((c) => `${c.qty} ${c.name}`).join("\n");
    $("#b-body", body).innerHTML = `
      <div class="seg" id="b-format">${Object.entries(FORMAT_NAMES).map(([k, n]) => `<button data-f="${k}">${n}</button>`).join("")}</div>
      <div class="seg mana-row" id="b-colors">${COLORS.map(([k, n]) => `<button data-c="${k}" class="mana ${colors.includes(k) ? "on" : ""}" aria-label="${n}" title="${n}">${manaIcon(k, n)}</button>`).join("")}</div>
      ${d.warnings.map((w) => `<div class="warn">⚠️ ${esc(w)}</div>`).join("")}
      ${d.commander ? `<h2>Comandante</h2><div class="grid">${t(d.commander)}</div>` : ""}
      <div class="stats">
        <div class="stat"><b>${s.total}</b><span>Cartas</span></div>
        <div class="stat"><b>${s.lands}</b><span>Tierras</span></div>
        <div class="stat"><b>${euro(s.value)}</b><span>Valor</span></div>
      </div>
      ${d.themes.length ? `<div class="item-meta">Plan del mazo: ${d.themes.map((x) => `<span class="chip gold">${esc(x)}</span>`).join("")}</div>` : ""}
      <details class="guide" open><summary>📖 Cómo se juega este mazo</summary>
        <p class="guide-style">${esc(d.guide.style_text)}</p>
        <p><b>Cartas clave:</b> ${esc(d.guide.core.join(", "))}.</p>
        ${d.guide.plan.length ? `<p><b>El plan:</b></p><ul>${d.guide.plan.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${d.guide.combos.length ? `<p><b>Combos que funcionan juntos:</b></p><ul>${d.guide.combos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${d.guide.turns.length ? `<p><b>Turno a turno:</b></p><ul>${d.guide.turns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <p><b>Mulligan:</b> ${esc(d.guide.mulligan)}</p>
      </details>
      <div class="item-meta" style="margin-top:6px">Funciones: <span class="chip">${s.roles.removal} quitan amenazas</span><span class="chip">${s.roles.draw} roban</span>${format === "commander" ? `<span class="chip">${s.roles.ramp} aceleran maná</span><span class="chip">${s.roles.wipe} barridos</span>` : ""}</div>
      <h2>Curva de maná · media ${s.avg_cmc}</h2>
      <div class="curve">${Object.entries(s.curve).map(([k, n]) => `<div><i style="height:${(n / maxCurve) * 100}%"></i><b>${n || ""}</b><span>${k === "6" ? "6+" : k}</span></div>`).join("")}</div>
      <div class="hint">${s.creatures} criaturas y ${s.spells - s.creatures} hechizos. Debajo de cada carta, por qué está.</div>
      ${group("Criaturas", creatures)}${group("Hechizos", spells)}${group("Tierras", d.lands)}
      ${d.bench.length ? `<h2>También encajarían</h2><div class="list">${d.bench.map((c) => `
        <div class="item"><img class="thumb" loading="lazy" src="${esc(c.image)}" alt=""><div class="item-main"><div class="item-title">${esc(c.name)}</div>
        <div class="item-meta">${esc(c.reasons.join(" · "))}</div></div></div>`).join("")}</div>` : ""}
      <div class="row-btns"><button class="btn" id="b-other">Otras cartas</button><button class="btn" id="b-copy">Copiar lista</button></div>
      <button class="btn block primary" id="b-save" style="margin-top:8px">💾 Guardar en Mis mazos</button>`;
    body.querySelectorAll("#b-format button").forEach((b) => {
      b.classList.toggle("on", b.dataset.f === format);
      b.onclick = () => { format = b.dataset.f; store("buildFormat", format); colors = null; run(); };
    });
    body.querySelectorAll("#b-colors button").forEach((b) => (b.onclick = () => {
      const set = new Set(colors.split(""));
      set.has(b.dataset.c) ? set.delete(b.dataset.c) : set.add(b.dataset.c);
      if (!set.size) return toast("El mazo necesita al menos un color");
      colors = COLORS.map(([k]) => k).filter((k) => set.has(k)).join("");
      run();
    }));
    $("#b-copy", body).onclick = () => copy(listText, "Lista copiada (se puede importar en Moxfield, MTGA…)");
    $("#b-other", body).onclick = pickSeed;
    $("#b-save", body).onclick = async () => {
      const r = await api("/api/mydecks", { save: { name: `${d.commander ? d.commander.name : d.seed} (${FORMAT_NAMES[format]})`, format: FORMAT_NAMES[format],
        cards: rows.map((c) => [c.name, c.qty, 0]) } });
      toast("Guardado en Mis mazos");
      deckSheet(r.id);
    };
  };
  run();
}

// Elegir una o varias cartas base (o un comandante) de la carpeta.
async function pickSeed() {
  const body = openSheet(`<h3>¿Con qué cartas empezamos?</h3>
    <div class="hint">Toca una o varias cartas que te gusten: la app buscará otras que hagan combo con ellas. Para Commander, elige una criatura legendaria.</div>
    <input class="search" id="seed-q" placeholder="Buscar en tus cartas…">
    <div class="seg" style="margin-top:8px"><button id="seed-legend">👑 Solo comandantes</button></div>
    <div id="seed-list">${skeleton(3)}</div>
    <div class="sel-bar" id="seed-bar"><span class="sub" id="seed-n">Ninguna elegida</span><button class="btn" id="seed-cmd" disabled>👑 Commander</button><button class="btn primary" id="seed-go" disabled>Crear mazo</button></div>`);
  const items = await api("/api/collection");
  const seen = new Set();
  const cards = items.filter((c) => !/land/i.test(c.type || "") && !seen.has(c.name) && seen.add(c.name));
  if (!cards.length) {
    $("#seed-list", body).innerHTML = `<div class="empty"><strong>No hay cartas en esta carpeta</strong>Importa un CSV o escanea cartas primero.</div>`;
    return;
  }
  const picked = new Set();
  let onlyLegends = false;
  const isLegend = (c) => /legendary.*creature/i.test(c.type || "");
  const update = () => {
    $("#seed-n", body).textContent = picked.size ? `${picked.size} elegida${picked.size > 1 ? "s" : ""}` : "Ninguna elegida";
    $("#seed-go", body).disabled = !picked.size;
    $("#seed-cmd", body).disabled = ![...picked].some((n) => isLegend(cards.find((c) => c.name === n)));
  };
  let limit = 90;
  const draw = (f = $("#seed-q", body).value) => {
    const all = cards.filter((c) => c.name.toLowerCase().includes(f.toLowerCase()) && (!onlyLegends || isLegend(c)));
    $("#seed-list", body).innerHTML = all.length
      ? `<div class="grid">${all.slice(0, limit).map((c) => tile({ ...c, key: c.name })).join("")}</div>
         ${all.length > limit ? `<button class="btn block" id="seed-more" style="margin-top:10px">Ver más (${all.length - limit})</button>` : ""}`
      : `<div class="hint">No hay ninguna carta así.</div>`;
    $("#seed-more", body)?.addEventListener("click", () => { limit += 150; draw(); });
    body.querySelectorAll("#seed-list [data-id]").forEach((b) => {
      b.classList.toggle("picked", picked.has(b.dataset.id));
      b.onclick = () => {  // sin repintar, para que no salte la pantalla
        picked.has(b.dataset.id) ? picked.delete(b.dataset.id) : picked.add(b.dataset.id);
        b.classList.toggle("picked", picked.has(b.dataset.id));
        update();
      };
    });
  };
  $("#seed-legend", body).onclick = (e) => { onlyLegends = !onlyLegends; e.target.classList.toggle("on", onlyLegends); draw(); };
  $("#seed-go", body).onclick = () => builderSheet([...picked]);
  $("#seed-cmd", body).onclick = () => {
    const legend = [...picked].find((n) => isLegend(cards.find((c) => c.name === n)));
    builderSheet([legend, ...[...picked].filter((n) => n !== legend)], "commander");
  };
  draw("");
  update();
  $("#seed-q", body).oninput = (e) => draw(e.target.value);
}


// Mercado: movimientos de precio, predicciones y sinergias (colecciones nuevas o cualquier carta)
const predRow = (c) => `<div class="item pred" data-name="${esc(c.name)}">
    <img class="thumb" loading="lazy" src="${esc(c.image)}" alt="">
    <div class="item-main"><div class="item-title">${esc(c.name)}${c.owned ? ' <span class="chip gold">La tienes</span>' : ""}</div>
      <div class="item-meta">${esc(c.reason)}</div></div>
    <div class="item-side"><div class="price">${euro(c.eur)}</div>${c.pct != null ? `<div class="sub ${c.pct > 0 ? "up" : "down"}">${pct(c.pct)}</div>` : ""}</div>
  </div>`;
const bindPred = (root) => root.querySelectorAll(".pred[data-name]").forEach((el) => (el.onclick = () => synergySheet(el.dataset.name)));

views.market = async () => {
  const v = $("#view");
  const section = store("marketTab") || "moves";
  v.innerHTML = `<h2>Mercado</h2>
    <div class="seg" id="m-tab"><button data-t="moves">📈 Movimientos</button><button data-t="pred">🔮 Predicciones</button><button data-t="syn">🧩 Sinergias</button></div>
    <div id="m-section"></div>`;
  v.querySelectorAll("#m-tab button").forEach((b) => {
    b.classList.toggle("on", b.dataset.t === section);
    b.onclick = () => { store("marketTab", b.dataset.t); views.market(); };
  });
  const box = $("#m-section");
  if (section === "pred") return predictionsView(box);
  if (section === "syn") return synergiesView(box);
  box.innerHTML = `
    <div class="seg" id="m-scope"><button data-s="pauper">Legales en Pauper</button><button data-s="collection">Mis cartas</button><button data-s="all">Todas</button></div>
    <div class="seg" id="m-days"><button data-d="1">1 día</button><button data-d="7">7 días</button><button data-d="30">30 días</button></div>
    <div id="m-body">${skeleton(5)}</div>`;
  const draw = async () => {
    box.querySelectorAll("#m-scope button").forEach((b) => b.classList.toggle("on", b.dataset.s === state.marketScope));
    box.querySelectorAll("#m-days button").forEach((b) => b.classList.toggle("on", +b.dataset.d === state.marketDays));
    $("#m-body").innerHTML = skeleton(5);
    const m = await api(`/api/movers?scope=${state.marketScope}&days=${state.marketDays}&min=${state.marketScope === "collection" ? 0 : 0.5}`);
    const row = (i) => `<div class="mover"><span class="pct ${i.pct > 0 ? "up" : "down"}">${pct(i.pct)}</span><span class="n">${esc(i.name)}${i.set ? ` <span class="chip">${esc(i.set.toUpperCase())}</span>` : ""}</span><span class="from">${euro(i.old)} → <b>${euro(i.new)}</b></span></div>`;
    if (m.base === m.latest) {
      $("#m-body").innerHTML = `<div class="empty"><strong>Acumulando historial</strong>Hay precios del ${esc(m.latest)}. Las subidas y bajadas aparecerán a partir de mañana, y la vista semanal en 7 días.</div>`;
      return;
    }
    $("#m-body").innerHTML = `<div class="hint">Del ${esc(m.base)} al ${esc(m.latest)} · solo cartas de 0,50 € o más</div>
      <h2>📈 Suben</h2><div class="list">${m.up.map(row).join("") || '<div class="hint">Nada.</div>'}</div>
      <h2>📉 Bajan</h2><div class="list">${m.down.map(row).join("") || '<div class="hint">Nada.</div>'}</div>`;
  };
  box.querySelectorAll("#m-scope button").forEach((b) => (b.onclick = () => { state.marketScope = b.dataset.s; store("marketScope", b.dataset.s); draw(); }));
  box.querySelectorAll("#m-days button").forEach((b) => (b.onclick = () => { state.marketDays = +b.dataset.d; store("marketDays", b.dataset.d); draw(); }));
  draw();
};

async function predictionsView(box) {
  box.innerHTML = `<div class="hint">Señales para comprar antes de que suban (precios de Cardmarket). Son pistas, no garantías.</div>${skeleton(4)}`;
  const p = await api("/api/predictions");
  const group = (title, hint, rows, empty) => `<h2>${title}</h2><div class="hint">${hint}</div>
    ${rows.length ? `<div class="list">${rows.map(predRow).join("")}</div>` : `<div class="empty">${empty}</div>`}`;
  const wait = "Hace falta más historial de precios: se va guardando cada día y esta lista se llenará sola.";
  box.innerHTML = `<div class="hint">Señales para comprar antes de que suban (precios de Cardmarket). Son pistas, no garantías. Toca una carta para ver con qué combina.</div>
    ${group("💎 Baratas que pueden volver a subir", "Bajaron mucho en 30 días, ya no bajan y se siguen jugando.", p.rebound, p.history.d30 ? "Ahora mismo ninguna cumple las condiciones." : wait)}
    ${group("🚀 Empiezan a subir", "Estaban planas y esta semana suben un 15% o más.", p.rising, p.history.d7 ? "Esta semana ninguna." : wait)}
    ${group("🔥 Muy jugadas y baratas", "Están en varios mazos del meta de Pauper y cuestan poco.", p.staples, "Sin datos del meta todavía.")}
    ${group("📜 Lista Reservada más jugada", "No se reimprimen nunca: con el tiempo suelen subir.", p.reserved, "—")}`;
  bindPred(box);
}

async function synergiesView(box) {
  box.innerHTML = `<div class="hint">Cuando sale una colección, algunas cartas antiguas suben porque combinan con las nuevas. Aquí las ves antes.</div>
    <h2>🆕 Colecciones nuevas</h2><div class="list" id="ns-list">${skeleton(2)}</div>
    <h2>🔍 Con cualquier carta</h2><input class="search" id="syn-q" placeholder="Busca una carta (de cualquier colección)…"><div class="list" id="syn-res"></div>`;
  const sets = await api("/api/newsets");
  $("#ns-list").innerHTML = sets.map((s) => `<button class="item set-row" data-code="${esc(s.code)}">${setIcon(s)}
      <div class="item-main"><div class="item-title">${esc(s.name)}</div><div class="item-meta">${s.upcoming ? "📅 Sale el" : "Salió el"} ${esc(s.released)}</div></div></button>`).join("")
    || `<div class="hint">No hay colecciones recientes.</div>`;
  box.querySelectorAll("#ns-list [data-code]").forEach((b) => (b.onclick = () => setSynergySheet(b.dataset.code)));
  let t;
  $("#syn-q").oninput = (e) => {
    clearTimeout(t);
    const text = e.target.value.trim();
    t = setTimeout(async () => {
      if (text.length < 2) { $("#syn-res").innerHTML = ""; return; }
      const res = await api(`/api/search?q=${encodeURIComponent(text)}`);
      $("#syn-res").innerHTML = res.map((r) => `<button class="item" data-name="${esc(r.name)}"><img class="thumb" loading="lazy" src="${esc(r.image)}" alt="">
        <div class="item-main"><div class="item-title">${esc(r.name)}</div></div></button>`).join("") || `<div class="hint">No hay cartas con ese nombre.</div>`;
      box.querySelectorAll("#syn-res [data-name]").forEach((b) => (b.onclick = () => synergySheet(b.dataset.name)));
    }, 250);
  };
}

async function setSynergySheet(code) {
  const body = openSheet(`<h3>Sinergias de la colección</h3><div class="hint">Analizando las cartas nuevas (la primera vez tarda unos segundos)…</div>${skeleton(4)}`);
  try {
    const d = await api(`/api/setsynergy?code=${encodeURIComponent(code)}`);
    body.innerHTML = `<div class="set-head">${setIcon(d.set)}<div><h3>${esc(d.set.name)}</h3><div class="sub">${d.fresh} cartas nuevas · ${esc(d.set.released)}</div></div></div>
      <div class="hint">Cartas antiguas y baratas que combinan con las nuevas: suelen subir cuando la colección sale. Toca una para ver más.</div>
      <div class="list">${d.cards.map(predRow).join("") || '<div class="hint">No he encontrado sinergias claras.</div>'}</div>`;
    bindPred(body);
  } catch (err) { body.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

async function synergySheet(name) {
  const body = openSheet(`<h3>Combinan con ${esc(name)}</h3>${skeleton(4)}`);
  try {
    const d = await api(`/api/cardsynergy?name=${encodeURIComponent(name)}`);
    body.innerHTML = `<h3>Combinan con ${esc(d.name)}</h3><img class="card-big" src="${esc(d.image)}" alt="${esc(d.name)}">
      <div class="hint">Las cartas de todo Magic que mejor encajan con ella. "La tienes" = está en tu carpeta.</div>
      <div class="list">${d.cards.map(predRow).join("") || '<div class="hint">No he encontrado sinergias claras.</div>'}</div>
      <a class="btn block" style="margin-top:10px;text-decoration:none" target="_blank" rel="noopener" href="${cardmarketUrl(d.name)}">🛒 Ver ${esc(d.name)} en Cardmarket</a>`;
    bindPred(body);
  } catch (err) { body.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

// Avisos
views.alerts = async () => {
  const v = $("#view");
  v.innerHTML = `<h2>Avisos</h2>${skeleton(3)}`;
  const events = await api("/api/events");
  if (events[0]) store("lastSeenEvent", events[0].id);
  $("#alert-dot").hidden = true;
  v.innerHTML = `<h2>Avisos</h2>
    <div class="hint">Baneos en Pauper, colecciones nuevas, cambios en el meta y movimientos de precio de tus cartas. Se revisan cada día a las 9:00.</div>
    ${events.length ? `<div class="list">${events.map((e) => `<div class="event"><div class="t">${esc(e.title)}</div>${e.body ? `<div class="b">${esc(e.body).replace(/\n/g, "<br>")}</div>` : ""}<div class="d">${esc(e.day)}</div></div>`).join("")}</div>`
      : `<div class="empty"><strong>Sin avisos todavía</strong>Cuando haya un baneo, una colección nueva o una carta tuya se mueva más de un 10%, aparecerá aquí y en el móvil.</div>`}`;
};

async function checkAlertDot() {
  const events = await api("/api/events");
  $("#alert-dot").hidden = !events.length || events[0].id == store("lastSeenEvent");
}

function refresh() {
  loadSummary();
  render();
}

// ---------- escáner en vivo (cámara + OCR en el móvil con Tesseract.js) ----------
const TESS = window.GM_CONFIG?.tesseractBase;
// AUTO: nombre en inglés, español, francés, alemán, italiano, portugués o japonés, sin elegir.
const SCAN_LANGS = [["auto", "eng", "AUTO"], ["en", "eng", "EN"], ["es", "spa", "ES"], ["fr", "fra", "FR"], ["ja", "jpn", "JA"]];
const ocrWorkers = {};  // el título en el idioma de la carta, la línea inferior siempre en inglés
async function getWorker(lang = "eng", slot = lang, psm = 0) {
  if (!window.Tesseract) {
    await new Promise((ok, fail) => {
      const s = document.createElement("script");
      // En la app de Android el lector va dentro (sin internet); en el navegador, desde el CDN.
      s.src = TESS ? `${TESS}tesseract.min.js` : "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = ok;
      s.onerror = () => fail(new Error("No se ha podido cargar el lector de texto (¿sin internet?)"));
      document.head.appendChild(s);
    });
  }
  // slot: un lector por uso (título / línea inferior / foto) para poder leer a la vez.
  // psm 7 = una sola línea (mucho más rápido); 6 = un bloque corto de texto.
  ocrWorkers[slot] ||= Tesseract.createWorker(lang, 1,
    TESS ? { workerPath: `${TESS}worker.min.js`, corePath: `${TESS}core`, langPath: `${TESS}lang`, gzip: false } : {})
    .then(async (w) => { if (psm) await w.setParameters({ tessedit_pageseg_mode: String(psm) }); return w; });
  return ocrWorkers[slot];
}

// Pasa a gris y sube el contraste: el OCR lee mucho mejor. upscale: ampliar trozos pequeños (títulos).
function toCanvas(src, sx, sy, sw, sh, maxW = 900, upscale = false) {
  const scale = upscale ? Math.min(3, maxW / sw) : Math.min(1, maxW / sw);
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
function prepareImage(file) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(toCanvas(img, 0, 0, img.width, img.height, 1400));
    img.onerror = () => fail(new Error("No se ha podido abrir la foto"));
    img.src = URL.createObjectURL(file);
  });
}

// Líneas leídas con su altura relativa dentro del texto encontrado (0 = arriba).
function ocrLines(data, canvas) {
  const lines = (data.lines || []).filter((l) => l.text.trim());
  if (!lines.length) return data.text.split("\n").filter((t) => t.trim()).map((t, i, a) => ({ text: t.trim(), y: i / a.length }));
  const top = Math.min(...lines.map((l) => l.bbox.y0)), bottom = Math.max(...lines.map((l) => l.bbox.y1));
  const span = Math.max(1, bottom - top) || canvas.height;
  return lines.map((l) => ({ text: l.text.trim(), y: (l.bbox.y0 - top) / span }));
}

const S = { running: false, busy: false, paused: false, stream: null, last: null, hits: 0, timer: null };
const scanLang = () => SCAN_LANGS.find((l) => l[0] === (store("scanLang") || "auto")) || SCAN_LANGS[0];

async function startScan() {
  closeSheet();
  if (!navigator.mediaDevices?.getUserMedia) return photoScan();
  document.body.insertAdjacentHTML("beforeend", `<div class="scanner" id="scanner">
      <video id="scan-video" playsinline muted autoplay></video>
      <div class="scan-frame" id="scan-frame"><i></i><i></i><i></i><i></i></div>
      <div class="scan-top">
        <div class="seg" id="scan-lang">${SCAN_LANGS.map(([k, , n]) => `<button data-l="${k}">${n}</button>`).join("")}</div>
        <button class="sheet-close" id="scan-close" aria-label="Cerrar escáner">✕</button>
      </div>
      <div class="scan-status" id="scan-status">Abriendo la cámara…</div>
      <div class="scan-read" id="scan-read"></div>
      <div class="scan-result" id="scan-result" hidden></div>
      <div class="scan-tools" id="scan-tools"><button class="btn" id="scan-photo">📷 Foto</button></div>
    </div>`);
  const paintLang = () => document.querySelectorAll("#scan-lang button").forEach((b) => b.classList.toggle("on", b.dataset.l === scanLang()[0]));
  paintLang();
  document.querySelectorAll("#scan-lang button").forEach((b) => (b.onclick = () => { store("scanLang", b.dataset.l); paintLang(); S.last = null; }));
  $("#scan-close").onclick = closeScanner;
  $("#scan-photo").onclick = () => { closeScanner(); photoScan(); };
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (err) {
    closeScanner();
    toast("No se puede usar la cámara en directo; usa una foto");
    return photoScan();
  }
  const video = $("#scan-video");
  video.srcObject = S.stream;
  await video.play().catch(() => {});
  Object.assign(S, { running: true, busy: false, paused: false, last: null, hits: 0, n: 0 });
  document.documentElement.classList.add("lock");
  status("Preparando el lector…");
  Promise.all([getWorker(scanLang()[1], `title:${scanLang()[1]}`, 6), getWorker("eng", "bottom", 6)])
    .then(() => status("Coloca la carta dentro del marco · toca para enfocar")).catch((e) => status(e.message));
  setupCameraControls(video);
  S.timer = setInterval(scanTick, 200);
}

// Enfoque (continuo + tocar para enfocar), linterna y zoom, si el móvil lo permite.
function setupCameraControls(video) {
  const track = S.stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  const apply = (c) => track.applyConstraints({ advanced: [c] }).catch(() => {});
  if (caps.focusMode?.includes("continuous")) apply({ focusMode: "continuous" });
  video.onclick = (e) => {
    const r = video.getBoundingClientRect();
    const ring = Object.assign(document.createElement("span"), { className: "focus-ring" });
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    $("#scanner").appendChild(ring);
    setTimeout(() => ring.remove(), 700);
    const c = { pointsOfInterest: [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }] };
    if (caps.focusMode?.includes("single-shot")) c.focusMode = "single-shot";
    else if (caps.focusMode?.includes("continuous")) c.focusMode = "continuous";
    apply(c).then(() => caps.focusMode?.includes("continuous") && setTimeout(() => apply({ focusMode: "continuous" }), 1500));
  };
  const bar = $("#scan-tools");
  if (caps.torch) {
    let on = false;
    bar.insertAdjacentHTML("beforeend", `<button class="btn" id="scan-torch">🔦 Linterna</button>`);
    $("#scan-torch").onclick = (e) => { on = !on; apply({ torch: on }); e.currentTarget.classList.toggle("primary", on); };
  }
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    bar.insertAdjacentHTML("beforeend", `<label class="scan-zoom">🔍<input type="range" id="scan-zoomr" min="${caps.zoom.min}" max="${Math.min(caps.zoom.max, 5)}" step="${caps.zoom.step || 0.1}" value="${caps.zoom.min}"></label>`);
    $("#scan-zoomr").oninput = (e) => apply({ zoom: +e.target.value });
  }
}

function closeScanner() {
  if (!$("#scanner")) return false;
  clearInterval(S.timer);
  S.running = false;
  S.stream?.getTracks().forEach((t) => t.stop());
  $("#scanner").remove();
  if ($("#sheet").hidden) document.documentElement.classList.remove("lock");
  return true;
}
const status = (msg) => { const el = $("#scan-status"); if (el) el.textContent = msg; };

// Del vídeo (que se ve con object-fit: cover) recorta lo que hay dentro del marco: dos franjas
// ampliadas (título arriba; edición y número abajo) y, para cuando la carta no encaja bien, la carta entera.
function grabFrame() {
  const v = $("#scan-video"), f = $("#scan-frame");
  if (!v?.videoWidth) return null;
  const vr = v.getBoundingClientRect(), fr = f.getBoundingClientRect();
  const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
  const ox = (vr.width - v.videoWidth * scale) / 2, oy = (vr.height - v.videoHeight * scale) / 2;
  const x = Math.max(0, (fr.left - vr.left - ox) / scale), y = Math.max(0, (fr.top - vr.top - oy) / scale);
  const w = Math.min(v.videoWidth - x, fr.width / scale), h = Math.min(v.videoHeight - y, fr.height / scale);
  return {
    title: toCanvas(v, x + w * 0.02, y + h * 0.01, w * 0.9, h * 0.14, 700, true),
    bottom: toCanvas(v, x, y + h * 0.84, w * 0.72, h * 0.16, 560, true),
    full: toCanvas(v, x, y, w, h, 820),
  };
}
const textLines = (r, y) => r.data.text.split("\n").filter((t) => t.trim()).map((t) => ({ text: t.trim(), y }));
async function readStrips(w, strips) {
  // A la vez: el título con el lector del idioma y "WAR • JA 227" (letras latinas en todos los
  // idiomas) con el lector inglés.
  const [top, bottom] = await Promise.all([w.recognize(strips.title),
    getWorker("eng", "bottom", 6).then((b) => b.recognize(strips.bottom))]);
  return [...textLines(top, 0), ...textLines(bottom, 0.95)];
}

async function scanTick() {
  if (!S.running || S.busy || S.paused) return;
  const strips = grabFrame();
  if (!strips) return;
  S.busy = true;
  S.n = (S.n || 0) + 1;
  try {
    const [lang, code] = scanLang();
    let lines;
    if (S.n % 4 === 0) {
      // Cada 4 intentos, la carta entera: sirve si la carta no llena el marco o está torcida.
      const r = await (await getWorker("eng", "full")).recognize(strips.full);
      lines = ocrLines(r.data, strips.full);
    } else {
      // En AUTO, el título se lee con el lector latino y, uno de cada tres intentos, con el japonés.
      const titleCode = lang === "auto" ? (S.n % 3 === 2 ? "jpn" : "eng") : code;
      lines = await readStrips(await getWorker(titleCode, `title:${titleCode}`, 6), strips);
    }
    if (!S.running || S.paused) return;
    const seen = lines.map((l) => l.text).join(" · ").slice(0, 70);
    const read = $("#scan-read");
    if (read) read.textContent = seen ? `Leo: «${seen}»` : "No veo texto: acerca la carta o dale más luz";
    const m = await api("/api/match", { lines, lang });
    const top = m[0];
    if (top && top.name === S.justAdded) {
      status("Añadida ✓ · Pon la siguiente carta");  // sigue la misma carta delante: no añadirla dos veces
    } else if (top && top.score >= 0.85) {
      S.justAdded = null;
      S.hits = S.last === top.name ? S.hits + 1 : 1;
      S.last = top.name;
      status(`Leyendo… ${top.name}`);
      // Dos lecturas iguales seguidas, la edición exacta leída o un nombre leído sin dudas = reconocida.
      if (S.hits >= 2 || top.best || top.score >= 1.15) showScanResult(m);
    } else {
      S.justAdded = null;
      status("Coloca la carta dentro del marco, con buena luz y sin reflejos");
    }
  } catch (err) {
    status(err.message);
  } finally {
    S.busy = false;
  }
}

function showScanResult(matches) {
  S.paused = true;
  navigator.vibrate?.(60);
  const box = $("#scan-result");
  box.hidden = false;
  const resume = (added) => {
    box.hidden = true; box.innerHTML = ""; S.last = null; S.hits = 0; S.paused = false;
    S.justAdded = added ? matches[0].name : null;
    status(added ? "Añadida ✓ · Pon la siguiente carta" : "Coloca la siguiente carta");
  };
  addSheet(matches, { into: box, compact: true, onDone: () => resume(true), onSkip: () => resume(false) });
}

// Plan B: hacer una foto (si no hay cámara en directo).
function photoScan() {
  $("#scan-input").value = "";
  $("#scan-input").click();
}
$("#scan-btn").onclick = startScan;

$("#scan-input").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = URL.createObjectURL(file);
  const body = openSheet(`<h3>Leyendo la carta…</h3><img class="scan-preview" src="${preview}" alt="">
    <div class="hint">Preparando el lector (la primera vez tarda un poco)…</div>`);
  try {
    const [lang, code] = scanLang();
    const worker = await getWorker(code);
    const canvas = await prepareImage(file);
    const { data } = await worker.recognize(canvas);
    const matches = await api("/api/match", { lines: ocrLines(data, canvas), lang });
    if (!matches.length) throw new Error("No he reconocido el nombre");
    addSheet(matches);
  } catch (err) {
    body.innerHTML = `<h3>No he podido leerla</h3><img class="scan-preview" src="${preview}" alt="">
      <div class="hint">${esc(err.message)}. Consejo: de frente, con buena luz y que el nombre se vea nítido. También puedes buscarla por nombre:</div>
      <input class="search" id="scan-manual" placeholder="Nombre de la carta…"><div class="list" id="scan-results"></div>
      <div class="row-btns"><button class="btn primary" id="scan-retry">Volver a escanear</button></div>`;
    $("#scan-retry", body).onclick = startScan;
    let t;
    $("#scan-manual", body).oninput = (ev) => {
      clearTimeout(t);
      t = setTimeout(() => ev.target.value.length >= 2 && searchInto($("#scan-results", body), ev.target.value), 250);
    };
  }
};


// ---------- arranque ----------
// Primero los datos (de la copia guardada en el móvil o, si hay novedades, de internet).
async function boot() {
  const v = $("#view");
  v.innerHTML = `<div class="splash"><svg class="crest" viewBox="0 0 64 64"><use href="#i-crest"/></svg>
    <div class="splash-msg" id="boot-msg">Abriendo el códice…</div><div class="progress"><i id="boot-bar"></i></div></div>`;
  try {
    const r = await Engine.load((msg, p) => {
      $("#boot-msg") && ($("#boot-msg").textContent = msg);
      $("#boot-bar") && ($("#boot-bar").style.width = `${Math.round((p || 0) * 100)}%`);
    });
    for (const a of r.alerts) notifyLocal(a);
    if (r.offline) toast("Sin conexión: usando los últimos precios guardados");
  } catch (err) {
    v.innerHTML = `<div class="empty"><strong>No he podido abrir los datos</strong>${esc(err.message)}
      <div class="row-btns"><button class="btn primary" onclick="boot()">Reintentar</button></div></div>`;
    return;
  }
  loadSummary();
  render();
  checkAlertDot();
}

// ---------- app de Android (Capacitor): botón atrás y permiso de notificaciones ----------
const Native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
if (Native) {
  Native.App?.addListener("backButton", () => {
    if (closeScanner()) return;
    if (!$("#sheet").hidden) closeSheet();
    else if ((location.hash || "#collection") !== "#collection") location.hash = "#collection";
    else Native.App.exitApp();
  });
  Native.LocalNotifications?.requestPermissions().catch(() => {});
}

// Notificación del sistema (en la app de Android); en el navegador no hace nada.
function notifyLocal(e) {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN) return;
  LN.schedule({ notifications: [{ id: Math.floor(Math.random() * 2 ** 31), title: e.title, body: e.body || "" }] }).catch(() => {});
}

boot();
