"use strict";

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (v) => (v == null ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
const pct = (v) => `${v > 0 ? "+" : ""}${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`;
// Iconos propios (app/icons/*.png, pintados con el color del tema).
const ico = (name) => `<i class="ico ico-${name}" aria-hidden="true"></i>`;
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
  if (closeSheet.dirty) { closeSheet.dirty = false; render(); }  // se añadieron/quitaron cartas con la ventana abierta
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
$("#profile-btn").innerHTML = ico("user");
$("#profile-btn").onclick = () => Engine.day && profileSheet();
// Compartir la web (solo en la versión web: en el APK no hay enlace que pasar).
if (window.Capacitor?.isNativePlatform?.()) $("#share-btn").hidden = true;
else {
  $("#share-btn").innerHTML = ico("share");
  $("#share-btn").onclick = async () => {
    const url = location.origin + location.pathname;
    try { if (navigator.share) return await navigator.share({ title: "Gathering Market", text: t("Precios, colecciones y mazos de Magic"), url }); }
    catch (e) { if (/abort|cancel/i.test(String(e?.name || e))) return; }
    copy(url, t("Enlace copiado: pásaselo a quien quieras"));
  };
}
$("#lang-btn").onclick = () => {
  const body = openSheet(`<h3>Idioma · Language · Idioma</h3><div class="list">${Object.entries(LANGS).map(([k, n]) => `
    <button class="item ${k === LANG ? "on" : ""}" data-lang="${k}"><div class="item-main"><div class="item-title">${k === LANG ? "✓ " : ""}${n}</div></div></button>`).join("")}</div>`);
  body.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => { store("lang", b.dataset.lang); location.reload(); }));
};

// ---------- importar (ManaBox, Moxfield, Deckbox, lista de texto) ----------
function importSheet() {
  const body = openSheet(`
    <h3>Importar cartas</h3>
    <div class="hint">Exporta tus cartas como <b>CSV</b> desde tu otra app (ManaBox, Moxfield, Deckbox, Dragon Shield, TCGplayer, Archidekt, MTGGoldfish, Delver Lens…) y elige el archivo aquí: se respetan la edición, el número y el foil. También vale una lista de texto tipo <code>4 Lightning Bolt</code>.</div>
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
    <div class="why">${esc(c.name)} · ${c.proxy && c.proxy >= c.qty ? "proxy" : euro(c.eur)}</div>
  </button>`;

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("No se ha podido copiar"); }
}
// Sonidos (sintetizados, sin archivos): más vistosos cuanto más vale la carta; fanfarria al completar una colección.
const Sfx = (() => {
  let ctx = null;
  const tone = (f, t0, d, type = "triangle", vol = 0.16) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + d + 0.05);
  };
  const play = (notes) => {
    if (store("sounds") === "0") return;
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume?.();
      const t = ctx.currentTime + 0.02;
      for (const [f, dt, d, type, vol] of notes) tone(f, t + dt, d, type, vol);
    } catch { /* sin audio */ }
  };
  const arp = (fs, step, last = 0.35) => fs.map((f, i) => [f, i * step, i === fs.length - 1 ? last : step * 1.6]);
  return {
    card(v) {
      v = v || 0;
      if (v < 1) play([[987.8, 0, 0.07], [1318.5, 0.06, 0.2]]);                       // moneda
      else if (v < 10) play(arp([784, 1046.5, 1318.5], 0.08, 0.3));                      // tintineo
      else if (v < 50) play(arp([523.3, 659.3, 784, 1046.5, 1318.5], 0.07, 0.45));       // arpegio
      else play([...arp([523.3, 659.3, 784, 1046.5, 1318.5, 1568], 0.07, 0.6),            // tesoro: arpegio y destellos
        ...[2093, 2637, 3136, 2637, 3520].map((f, i) => [f, 0.45 + i * 0.07, 0.25, "sine", 0.06])]);
    },
    complete() {
      play([[392, 0, 0.13], [392, 0.15, 0.13], [392, 0.3, 0.13], [523.3, 0.45, 0.5],
        [523.3, 0.95, 1.1, "sawtooth", 0.05], [659.3, 0.95, 1.1, "sawtooth", 0.04], [784, 0.95, 1.1, "sawtooth", 0.04],
        [1046.5, 0.95, 1.1], [1568, 1.1, 0.5, "sine", 0.05], [2093, 1.25, 0.6, "sine", 0.05]]);
    },
  };
})();
// Tras añadir cartas: sonido según el precio y, si completa una colección, fanfarria y aviso.
function celebrate(r) {
  if (r?.completed?.length) {
    Sfx.complete();
    navigator.vibrate?.([80, 60, 80, 60, 200]);
    setTimeout(() => toast(`🏆 ¡Colección completa: ${r.completed.join(", ")}!`), 50);
  } else Sfx.card(r?.eur);
}

// Guardar un archivo: en el móvil se escribe y se abre "Compartir" (Drive, Descargas, WhatsApp…); en el PC se descarga.
async function saveFile(name, text, mime) {
  const N = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
  try {
    if (N?.Filesystem && N?.Share) {
      const w = await N.Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
      return await N.Share.share({ title: name, files: [w.uri], dialogTitle: name });
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    if (!/cancel|abort/i.test(String(e?.message || e))) toast(e.message || String(e));
  }
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
  v.innerHTML = `<div class="row-btns" style="margin-top:4px"><button class="btn" id="col-import">${ico("import")}Importar</button><button class="btn" id="col-build">${ico("plus")}Crear mazo</button></div>
    <h2>Cartas</h2>
    <input class="search" id="col-filter" placeholder="Filtrar o buscar carta para añadir…" value="${esc(state.collectionFilter)}">
    <div class="seg" id="col-kind" style="margin-top:8px"><button data-k="all">Todas</button><button data-k="real">Sin proxies</button><button data-k="proxy">Proxies</button><button data-k="alter">✍️ Alteradas</button></div>
    <div class="seg" id="col-view" style="margin-top:8px"><button data-v="grid">🖼 Imágenes</button><button data-v="list">☰ Lista</button><button data-v="select">☑ Seleccionar</button></div>
    <div id="col-list">${skeleton()}</div>`;
  document.body.insertAdjacentHTML("beforeend", `<div class="sel-bar floating" id="col-bar" hidden>
    <span class="sub" id="col-count"></span><button class="btn" id="col-cancel">Cancelar</button><button class="btn" id="col-del" aria-label="Quitar las elegidas">🗑 Quitar</button><button class="btn primary" id="col-go">🔨 Crear mazo</button></div>`);
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
      $("#col-del").disabled = !s.ids.size;
      if (modeChanged) { if (s.on && mode !== "grid") { mode = "grid"; draw(); } paintSeg(); }
    },
  });
  const paintSeg = () => v.querySelectorAll("#col-view button").forEach((b) => b.classList.toggle("on", b.dataset.v === (sel.on ? "select" : mode)));
  const draw = () => {
    const f = state.collectionFilter.toLowerCase();
    const kind = store("colKind") || "all";
    v.querySelectorAll("#col-kind button").forEach((b) => b.classList.toggle("on", b.dataset.k === kind));
    const kindOk = (c) => kind === "all" || (kind === "proxy" ? c.proxy > 0 : kind === "real" ? c.proxy < c.qty : !!c.alter);
    const shown = items.filter((c) => kindOk(c) && (!f || c.name.toLowerCase().includes(f) || c.decks.some((d) => d.toLowerCase().includes(f))));
    const page = shown.slice(0, limit);
    const list = mode === "grid" ? `<div class="grid">${page.map((c) => tile(c, (c.foil || c.alter ? `<span class="num-tag">${[c.foil ? "Foil" : "", c.alter ? "✍️" : ""].filter(Boolean).join(" ")}</span>` : "")
      + (c.proxy ? `<span class="proxy-tag">PROXY${c.proxy < c.qty ? ` ×${c.proxy}` : ""}</span>` : ""))).join("")}</div>`
      : `<div class="list">${page.map((c) => `
      <button class="item" data-row="${esc(c.key)}">
        <img class="thumb" loading="lazy" src="${esc(c.image)}" alt="">
        <div class="item-main">
          <div class="item-title">${esc(c.name)}</div>
          <div class="item-meta"><i class="r r-${esc(c.rarity)}"></i>${esc(c.set.toUpperCase())} #${esc(c.number)}
            ${c.foil ? '<span class="chip foil">Foil</span>' : ""}${c.alter ? `<span class="chip gold">✍️ ${esc(c.alter.name)}</span>` : ""}${c.proxy ? `<span class="chip">Proxy ×${c.proxy}</span>` : ""}
            ${c.pauper === "banned" ? '<span class="chip ban">Baneada</span>' : ""}</div>
          ${c.decks.length ? `<div class="item-meta">${c.decks.slice(0, 3).map((d) => `<span class="chip gold">${esc(d)}</span>`).join("")}${c.decks.length > 3 ? `<span class="chip">+${c.decks.length - 3}</span>` : ""}</div>` : ""}
        </div>
        <div class="item-side"><div class="price">${c.proxy && c.proxy >= c.qty ? "Proxy" : euro(c.eur)}</div><div class="sub">×${c.qty}</div></div>
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
  v.querySelectorAll("#col-kind button").forEach((b) => (b.onclick = () => { store("colKind", b.dataset.k); draw(); }));
  v.querySelectorAll("#col-view button").forEach((b) => (b.onclick = () => {
    if (b.dataset.v === "select") return sel.set(!sel.on);
    sel.set(false);
    mode = b.dataset.v;
    store("colView", mode);
    draw();
  }));
  $("#col-cancel").onclick = () => sel.set(false);
  $("#col-del").onclick = async () => {
    const rows = [...sel.ids].map((k) => items.find((c) => c.key === k)).filter(Boolean);
    const n = rows.reduce((a, c) => a + c.qty, 0);
    if (!confirm(window.t(`¿Quitar ${plural(n, "carta", "cartas")} de la carpeta (vendidas, perdidas…)?`))) return;
    for (const c of rows) await api("/api/collection", { card_id: c.id, foil: c.foil, qty: -c.qty });
    toast(`${plural(n, "carta quitada", "cartas quitadas")}`);
    sel.set(false);
    loadSummary();
    render();
  };
  $("#col-go").onclick = () => {
    const names = [...new Set([...sel.ids].map((k) => items.find((c) => c.key === k)?.name).filter(Boolean))];
    sel.set(false);
    pickSeed(names);
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
      <div class="item-main"><div class="item-title">${esc(r.name)}</div>${r.alias ? `<div class="item-meta"><span class="chip">${esc(r.alias)}</span></div>` : ""}
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
    ${/land/i.test(c.type || "") ? "" : `<button class="btn block" id="build-from" style="margin-top:12px">${ico("plus")}Crear un mazo con esta carta${/legendary.*creature/i.test(c.type || "") ? " (o de Commander)" : ""}</button>`}
    <button class="btn block" id="open-set" style="margin-top:8px">📜 Ver la colección ${esc(c.set_name)}</button>
    <button class="btn block" id="follow" style="margin-top:8px">☆ Seguir su precio en Mercado</button>
    <button class="btn block" id="open-syn" style="margin-top:8px">🔮 Cartas que combinan con esta</button>
    <a class="btn block" style="margin-top:8px;text-decoration:none" target="_blank" rel="noopener"
       href="${cardmarketUrl(c.name)}">🛒 Ver en Cardmarket</a>
    <h2>Tus versiones</h2><div class="list" id="versions">${skeleton(1)}</div>
    <button class="btn block primary" id="add-version" style="margin-top:10px">➕ Añadir otro arte o foil</button>`);
  $("#build-from", body)?.addEventListener("click", () => pickSeed([c.name], /legendary.*creature/i.test(c.type || "") ? "commander" : null));
  $("#open-set", body).onclick = () => setSheet(c.set);
  $("#open-syn", body).onclick = () => synergySheet(c.name);
  followButton(body, c.name);
  $("#add-version", body).onclick = () => addSheet([{ name: c.name }]);
  const drawVersions = async () => {
    const mine = (await api("/api/collection")).filter((x) => x.name === c.name);
    $("#versions", body).innerHTML = mine.map((x) => `<div class="item version">
        <img class="thumb" loading="lazy" src="${esc(x.image)}" alt="">
        <div class="item-main"><div class="item-title">${esc(x.set_name)} #${esc(x.number)}</div>
          <div class="item-meta">${x.foil ? '<span class="chip foil">Foil</span>' : ""}${euro(x.eur)}</div>
          <div class="item-meta proxy-row"><span class="sub">Proxies</span><button class="mini" data-px="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="-1" ${x.proxy ? "" : "disabled"}>−</button><b>${x.proxy || 0}</b><button class="mini" data-px="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="1" ${x.proxy < x.qty ? "" : "disabled"}>+</button>${x.proxy ? `<span class="sub">(no suman valor; solo para Casual${x.proxy_collect ? "" : "; no cuentan para la colección"})</span>` : ""}</div>
          ${x.alter ? `<div class="item-meta"><span class="chip gold">✍️ ${esc(x.alter.name)} ×${x.alter.qty}</span> ~${euro(x.alter.estimate[0])}–${euro(x.alter.estimate[1])}${x.alter.note ? ` · ${esc(x.alter.note)}` : ""}</div>` : ""}
          <button class="btn alter-btn" data-alter="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-q="${x.qty}">✍️ ${x.alter ? "Cambiar alteración" : "¿Firmada o con arte propio?"}</button></div>
        <div class="stepper"><button data-v="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="-1" aria-label="Quitar una">−</button><b class="num">${x.qty}</b>
          <button data-v="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="1" aria-label="Añadir otra">+</button></div>
      </div>`).join("") || `<div class="hint">Ya no tienes ninguna.</div>`;
    body.querySelectorAll("#versions [data-px]").forEach((b) => (b.onclick = async () => {
      const row = mine.find((x) => x.id === b.dataset.px && x.foil === (b.dataset.f === "1"));
      const first = +b.dataset.d > 0 && !row?.proxy;  // al marcar el primer proxy, se pregunta si cuenta para la colección
      await api("/api/proxy", { card_id: b.dataset.px, foil: b.dataset.f === "1", delta: +b.dataset.d, ...(first ? { collect: confirm(t("¿Quieres que este proxy cuente para la colección? (completar colecciones y número de cartas). Aceptar = sí, Cancelar = no")) } : {}) });
      closeSheet.dirty = true; drawVersions(); loadSummary();
    }));
    body.querySelectorAll("#versions [data-alter]").forEach((b) => (b.onclick = () => alterBox(b, mine.find((x) => x.id === b.dataset.alter && x.foil === (b.dataset.f === "1")))));
    body.querySelectorAll("#versions [data-v]").forEach((b) => (b.onclick = async () => {
      const r = await api("/api/collection", { card_id: b.dataset.v, foil: b.dataset.f === "1", qty: +b.dataset.d });
      if (+b.dataset.d > 0) celebrate(r);
      closeSheet.dirty = true;
      drawVersions();
      loadSummary();
    }));
  };
  $("#versions", body).addEventListener("altered", drawVersions);
  drawVersions();
}

// Marcar una versión como alterada (firma del artista o arte pintado a mano) y ver cuánto podría valer.
function alterBox(btn, x) {
  const box = document.createElement("div");
  box.className = "alter-box";
  let kind = x.alter?.kind || "firma", qty = x.alter?.qty || 1;
  const draw = async () => {
    const est = await api(`/api/alterestimate?card_id=${encodeURIComponent(x.id)}&foil=${x.foil ? 1 : 0}&kind=${kind}`);
    box.innerHTML = `<div class="seg" id="al-kind"><button data-k="firma">✍️ Firmada</button><button data-k="arte">🎨 Arte propio</button><button data-k="ambas">Las dos</button></div>
      <div class="hint">Precio normal ${euro(x.eur)}. ${kind === "firma" ? "Con firma del artista" : kind === "arte" ? "Con arte pintado a mano (alter)" : "Firmada y con arte propio"} podría venderse por unos
        <b>${euro(est[0])}–${euro(est[1])}</b></div><div class="hint">Es orientativo: depende del artista, de la calidad y de quién la compre.</div>
      <div class="field" style="flex-direction:row;justify-content:space-between;align-items:center"><span class="sub">Copias alteradas</span>
        <div class="stepper"><button data-q="-1">−</button><b class="num">${qty}</b><button data-q="1">+</button></div></div>
      <input class="search" id="al-note" maxlength="80" placeholder="Nota (opcional): artista, firma en el arte…" value="${esc(x.alter?.note || "")}">
      <div class="row-btns">${x.alter ? `<button class="btn" id="al-del">Quitar alteración</button>` : ""}<button class="btn primary" id="al-ok">Guardar</button></div>`;
    box.querySelectorAll("#al-kind button").forEach((b) => { b.classList.toggle("on", b.dataset.k === kind); b.onclick = () => { kind = b.dataset.k; draw(); }; });
    box.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { qty = Math.min(x.qty, Math.max(1, qty + +b.dataset.q)); draw(); }));
    const save = async (k) => {
      await api("/api/alter", { card_id: x.id, foil: x.foil, kind: k, qty, note: $("#al-note", box).value });
      toast(k ? "Alteración guardada" : "Alteración quitada");
      closeSheet.dirty = true;
      box.remove();
      btn.dispatchEvent(new CustomEvent("altered", { bubbles: true }));
    };
    $("#al-ok", box).onclick = () => save(kind);
    $("#al-del", box)?.addEventListener("click", () => save(""));
  };
  const open = btn.parentElement.querySelector(".alter-box");
  if (open) return open.remove();
  btn.after(box);
  draw();
}

// Elegir carta, arte (con imágenes), foil y cantidad, y añadir.
async function addSheet(candidates, opts = {}) {
  const body = opts.into || openSheet(`<h3>Añadir carta</h3><div id="add-body">${skeleton(1)}</div>`);
  if (opts.into) body.innerHTML = `<div id="add-body">${skeleton(1)}</div>`;
  const cands = await Promise.all(candidates.map(async (c) => ({ ...c, printings: c.printings || (await api(`/api/printings?name=${encodeURIComponent(c.name)}`)) })));
  let ci = 0, qty = 1, foil = false, proxy = false;
  const added = [];  // lo añadido en esta ventana (varios artes / foil seguidos)
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
        <span><label class="toggle"><input type="checkbox" id="add-foil" ${foil ? "checked" : ""}> Foil</label>
        <label class="toggle"><input type="checkbox" id="add-proxy" ${proxy ? "checked" : ""}> Proxy</label></span>
        <div class="stepper"><button data-q="-1">−</button><b class="num">${qty}</b><button data-q="1">+</button></div>
      </div>
      <div class="stats"><div class="stat"><b>${euro(foil ? p.eur_foil : p.eur)}</b><span>Precio unidad</span></div>
        <div class="stat"><b>${euro((foil ? p.eur_foil : p.eur) * qty || null)}</b><span>Total</span></div>
        <div class="stat"><b>${p.pauper === "legal" ? "Sí" : p.pauper === "banned" ? "Ban" : "No"}</b><span>Legal Pauper</span></div></div>
      ${added.length ? `<div class="warn">✓ Añadidas: ${added.map(esc).join(" · ")}<br>Elige otro arte o foil y vuelve a pulsar Añadir, o pulsa Listo.</div>` : ""}
      <div class="row-btns">
        ${opts.onSkip ? `<button class="btn" id="add-skip">No es esta</button>` : ""}
        ${added.length && !opts.onDone ? `<button class="btn" id="add-done">Listo</button>` : ""}
        <button class="btn primary" id="add-ok">Añadir ${qty > 1 ? qty : ""}</button>
      </div>`;
    $(".art.on", body)?.scrollIntoView({ inline: "center", block: "nearest" });
    body.querySelectorAll("[data-ci]").forEach((b) => (b.onclick = () => { ci = +b.dataset.ci; pid = defaultPrint(cands[ci]); draw(); }));
    body.querySelectorAll("[data-pid]").forEach((b) => (b.onclick = () => { pid = b.dataset.pid; draw(); }));
    $("#add-foil", body).onchange = (e) => { foil = e.target.checked; draw(); };
    $("#add-proxy", body).onchange = (e) => { proxy = e.target.checked; };
    body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { qty = Math.max(1, qty + +b.dataset.q); draw(); }));
    $("#add-ok", body).onclick = async () => {
      const r = await api("/api/collection", { card_id: p.id, foil, qty });
      if (proxy) await api("/api/proxy", { card_id: p.id, foil, delta: qty, collect: confirm(t("¿Quieres que este proxy cuente para la colección? (completar colecciones y número de cartas). Aceptar = sí, Cancelar = no")) });
      toast(`${qty}× ${c.name} añadida${proxy ? " (proxy)" : ""}`);
      if (!proxy) celebrate(r);
      loadSummary();
      if (opts.onDone) { opts.onDone(); refresh(); return; }
      added.push(`${qty}× ${p.set.toUpperCase()} #${p.number}${foil ? " foil" : ""}`);
      closeSheet.dirty = true;
      qty = 1;
      draw();
    };
    $("#add-done", body)?.addEventListener("click", () => closeSheet());
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

const META_FORMATS = { PAU: "Pauper", ST: "Estándar", MO: "Modern", PI: "Pioneer", LE: "Legacy", VI: "Vintage" };
views.decks = async () => {
  const v = $("#view");
  v.innerHTML = `<button class="item builder-cta" id="deck-build">
      <span class="cta-icon">${ico("plus")}</span>
      <div class="item-main"><div class="item-title">Crear un mazo con tus cartas</div>
        <div class="item-meta">Pauper, Commander, Estándar o Casual: a partir de una o varias cartas, o de un comandante.</div></div>
    </button>
    <button class="item builder-cta" id="deck-import">
      <span class="cta-icon">${ico("import")}</span>
      <div class="item-main"><div class="item-title">Importar mi mazo</div>
        <div class="item-meta">Pega la lista (o un .txt) y marca qué cartas ya tienes.</div></div>
    </button>
    <div class="field"><label for="deck-tab">Ver mazos</label><select class="search deck-select" id="deck-tab"></select></div>
    <div id="deck-body">${skeleton(5)}</div>`;
  $("#deck-build").onclick = () => builderSheet();
  $("#deck-import").onclick = importDeckSheet;
  const [mine, decks] = await Promise.all([api("/api/mydecks"), api("/api/decks")]);
  const formats = Object.keys(META_FORMATS);
  let tab = store("deckTab") || "PAU";
  if (tab !== "mine" && !formats.includes(tab)) tab = "PAU";
  const count = (f) => decks.filter((d) => d.format === f).length;
  $("#deck-tab").innerHTML = `<option value="mine">📂 Mis mazos (${mine.length})</option>
    ${formats.map((f) => `<option value="${f}">⚔️ Meta de ${META_FORMATS[f]}${count(f) ? ` (${count(f)})` : ""}</option>`).join("")}`;
  const sorters = { meta: (a, b) => b.share - a.share, owned: (a, b) => b.owned_pct - a.owned_pct, cheap: (a, b) => a.price - b.price, missing: (a, b) => a.missing_cost - b.missing_cost };
  const bind = (root) => root.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => deckSheet(b.dataset.id)));
  const draw = () => {
    $("#deck-tab").value = tab;
    const body = $("#deck-body");
    if (tab === "mine") {
      body.innerHTML = `<div class="hint">Tus mazos importados, guardados del meta o creados con el constructor. Ábrelo y toca las cartas que ya tienes.</div>
        ${mine.length ? `<div class="list">${mine.map(deckCard).join("")}</div>` : `<div class="empty"><strong>Aún no tienes mazos</strong>Importa tu lista arriba, crea uno con el constructor o guarda uno del meta.</div>`}`;
      return bind(body);
    }
    const list = decks.filter((d) => d.format === tab);
    body.innerHTML = `<div class="hint">${tab === "PAU"
      ? `De cada arquetipo, la lista mejor clasificada (🏆 la ganadora si la hay) de los últimos 2 meses en MTGTop8. "Weenie White" es el mono blanco (Convoke, Kor Skyfisher…).`
      : `Los arquetipos más jugados de ${META_FORMATS[tab]} en MTGTop8 y, de cada uno, la lista mejor clasificada (🏆 la ganadora si la hay).`}</div>
      <div class="seg" id="deck-sort">
        <button data-s="meta">Más jugados</button><button data-s="owned">Puedo montar</button><button data-s="cheap">Más baratos</button><button data-s="missing">Me falta menos €</button>
      </div>
      ${list.length ? `<div class="list">${[...list].sort(sorters[state.deckSort]).map(deckCard).join("")}</div>`
        : `<div class="empty"><strong>Aún no hay datos del meta</strong>Se descargan cada día.</div>`}`;
    body.querySelectorAll("#deck-sort button").forEach((b) => {
      b.classList.toggle("on", b.dataset.s === state.deckSort);
      b.onclick = () => { state.deckSort = b.dataset.s; store("deckSort", b.dataset.s); draw(); };
    });
    bind(body);
  };
  $("#deck-tab").onchange = (e) => { tab = e.target.value; store("deckTab", tab); draw(); };
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
      store("deckTab", "mine");  // al volver, se ve en Mis mazos
      if (r.unknown.length) {
        $("#dk-result", body).innerHTML = `<div class="warn">No he reconocido estas líneas:<br>${r.unknown.slice(0, 15).map(esc).join("<br>")}</div>
          <button class="btn block" id="dk-open">Ver el mazo</button>`;
        $("#dk-open", body).onclick = () => deckSheet(r.id);
      } else deckSheet(r.id);
      if ((location.hash || "") === "#decks") views.decks();
    } catch (err) { toast(err.message); }
  };
}

async function deckSheet(id, keep = null) {
  const body = keep ? $("#sheet-body") : openSheet(skeleton(3));
  const d = await api(`/api/deck?id=${encodeURIComponent(id)}`);
  // − / + para sumar o quitar copias de tu carpeta, de una en una. Se puede pasar de lo que pide el mazo (4/3):
  // es la forma cómoda de registrar cartas sin escribir su nombre. El número es todas las copias que tienes.
  const stepper = (c) => (c.basic ? "" : `<div class="mini-step"><button data-step="-1" data-name="${esc(c.name)}" ${c.owned ? "" : "disabled"} aria-label="Quitar una">−</button>
    <b class="${c.owned > c.qty ? "over" : ""}">${c.owned}/${c.qty}</b><button data-step="1" data-name="${esc(c.name)}" aria-label="Añadir una">+</button></div>`);
  const line = (c) => {
    const cls = c.have >= c.qty ? "full" : c.have > 0 ? "part" : "none";
    return `<div class="deck-line"><span class="qty ${cls}">${c.basic ? c.qty : `${c.have}/${c.qty}`}</span><span class="n">${esc(c.name)}</span><span class="${c.basic ? "sub" : "price"}">${c.basic ? "básica" : euro(c.eur)}</span>${stepper(c)}</div>`;
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
    <button class="btn block" id="deck-all" ${missing.length ? "" : "disabled"}>${missing.length ? "✅ Ya tengo todo el mazo" : "✅ Tienes todas las cartas"}</button>
    <div class="hint" id="deck-hint"></div>
    <div id="deck-cards"></div>
    <div class="row-btns">
      <button class="btn" id="copy-all">Copiar lista</button>
      <button class="btn primary" id="share-missing" ${missing.length ? "" : "disabled"}>Compartir lo que falta</button>
    </div>
    ${d.mine ? `<button class="btn block" id="deck-edit" style="margin-top:8px">✏️ Editar la lista</button>` : ""}
    <button class="btn block" id="deck-keep" style="margin-top:8px">${d.mine ? "🗑 Borrar de Mis mazos" : "⭐ Guardar en Mis mazos"}</button>`;
  const tileD = (c) => {
    const missingN = c.basic ? 0 : c.qty - c.have;
    return `<div class="gcard ${missingN === c.qty ? "missing" : ""}">
      <img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
      <span class="badge ${missingN ? (c.have ? "part" : "none") : "full"}">${c.basic ? c.qty : `${c.have}/${c.qty}`}</span>
      <div class="why">${c.basic ? "básica" : euro(c.eur)}</div>${stepper(c)}</div>`;
  };
  const drawCards = () => {
    const mode = store("deckView") || "img";
    body.querySelectorAll("#deck-view button").forEach((b) => b.classList.toggle("on", b.dataset.v === mode));
    $("#deck-hint", body).textContent = mode === "img"
      ? "En gris, las cartas que no tienes. Con − y + sumas o quitas copias de tu carpeta (puedes pasar de las del mazo, p. ej. 4/3)."
      : "Precio con la edición más barata de cada carta (Cardmarket). Verde: la tienes; amarillo: te faltan copias. Con − y + sumas o quitas copias de tu carpeta.";
    const section = (cards) => (mode === "img" ? `<div class="grid">${cards.map(tileD).join("")}</div>` : cards.map(line).join(""));
    $("#deck-cards", body).innerHTML = `
      <h2>Main (${main.reduce((s, c) => s + c.qty, 0)})</h2>${section(main)}
      ${side.length ? `<h2>Sideboard (${side.reduce((s, c) => s + c.qty, 0)})</h2>${section(side)}` : ""}`;
    body.querySelectorAll("[data-step]").forEach((el) => (el.onclick = () => step(el.dataset.name, +el.dataset.step)));
  };
  const need = new Map();
  for (const c of d.cards) if (!c.basic) { const x = need.get(c.name) || { qty: 0, have: 0 }; x.qty += c.qty; x.have += c.have; need.set(c.name, x); }
  const redraw = async () => { const y = $("#sheet").scrollTop; await deckSheet(id, true); $("#sheet").scrollTop = y; loadSummary(); closeSheet.dirty = true; };
  const step = async (name, delta) => {
    const r = await api("/api/owncards", { op: delta > 0 ? "add" : "remove", cards: [[name, 1]] });
    if (delta > 0) celebrate(r);
    redraw();
  };
  body.querySelectorAll("#deck-view button").forEach((b) => (b.onclick = () => { store("deckView", b.dataset.v); drawCards(); }));
  drawCards();
  $("#copy-all", body).onclick = () => copy([...main.map((c) => `${c.qty} ${c.name}`), ...(side.length ? ["", "Sideboard", ...side.map((c) => `${c.qty} ${c.name}`)] : [])].join("\n"), "Lista copiada");
  $("#share-missing", body).onclick = () => shareText(`Me falta para ${d.archetype}`, missing.join("\n"));
  $("#deck-all", body).onclick = async () => {
    const add = [...need.entries()].filter(([, x]) => x.have < x.qty).map(([n, x]) => [n, x.qty - x.have]);
    if (!confirm(t(`¿Añadir a tu carpeta las ${add.reduce((a, [, q]) => a + q, 0)} cartas que faltan?`))) return;
    const r = await api("/api/owncards", { op: "add", cards: add });
    toast(`${plural(r.changed, "carta añadida", "cartas añadidas")}`);
    celebrate(r);
    redraw();
  };
  $("#deck-edit", body)?.addEventListener("click", () => {
    const listOf = (cs) => cs.map((c) => `${c.qty} ${c.name}`).join("\n");
    const b2 = openSheet(`<h3>Editar ${esc(d.archetype)}</h3>
      <div class="hint">Una carta por línea (<code>4 Lightning Bolt</code>). Borra las que no quieras, cambia cantidades o añade otras. Lo que vaya tras "Sideboard" es banquillo.</div>
      <div class="field"><label>Nombre</label><input class="search" id="ed-name" value="${esc(d.archetype)}"></div>
      <textarea class="search" id="ed-text" rows="16">${esc(listOf(main) + (side.length ? `\n\nSideboard\n${listOf(side)}` : ""))}</textarea>
      <div class="row-btns"><button class="btn" id="ed-cancel">Cancelar</button><button class="btn primary" id="ed-ok">Guardar cambios</button></div><div id="ed-res"></div>`);
    $("#ed-cancel", b2).onclick = () => deckSheet(id);
    $("#ed-ok", b2).onclick = async () => {
      try {
        const r = await api("/api/mydecks", { update: { id, name: $("#ed-name", b2).value.trim(), text: $("#ed-text", b2).value } });
        toast("Mazo actualizado");
        if (r.unknown.length) $("#ed-res", b2).innerHTML = `<div class="warn">No he reconocido:<br>${r.unknown.slice(0, 15).map(esc).join("<br>")}</div>`;
        else { deckSheet(id); if ((location.hash || "") === "#decks") views.decks(); }
      } catch (err) { toast(err.message); }
    };
  });
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
  : `<span class="${cls} set-emoji">${ico(s.code === "reserved" ? "reserved" : "precons")}</span>`);

function setRow(s, withProgress = true) {
  return `<button class="item set-row" data-code="${esc(s.code)}">
    ${setIcon(s)}
    <div class="item-main">
      <div class="item-title">${esc(s.name)}</div>
      ${s.via ? `<div class="item-meta"><span class="chip gold">🃏 ${esc(s.via)}</span></div>` : ""}
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
      <button class="item set-row" id="sp-reserved"><span class="set-icon set-emoji">${ico("reserved")}</span><div class="item-main"><div class="item-title">Lista Reservada</div>
        <div class="item-meta">Las cartas que Wizards se ha comprometido a no reimprimir nunca.</div></div></button>
      <button class="item set-row" id="sp-staples"><span class="set-icon set-emoji">${ico("star")}</span><div class="item-main"><div class="item-title">Staples de cada formato</div>
        <div class="item-meta">Las cartas más jugadas en Pauper, Estándar, Modern, Pioneer, Legacy, Vintage y Commander: ¿cuántas tienes?</div></div></button>
      <button class="item set-row" id="sp-precons"><span class="set-icon set-emoji">${ico("precons")}</span><div class="item-main"><div class="item-title">Mazos preconstruidos</div>
        <div class="item-meta">Todos los mazos oficiales de la historia: Commander, Theme Decks, Intro Packs, Duel Decks…</div></div></button>
    </div>
    <button class="btn block" id="set-import" style="margin-top:10px">${ico("import")}Importar tus cartas de otra app (CSV)</button>
    <input class="search" id="set-q" placeholder="Buscar colección o carta (en cualquier idioma)…" style="margin-top:14px">
    <div class="list" id="set-search"></div>
    <div id="set-list">${skeleton(4)}</div>`;
  $("#sp-reserved").onclick = () => setSheet("reserved");
  $("#sp-precons").onclick = preconSheet;
  $("#sp-staples").onclick = () => staplesSheet();
  $("#set-import").onclick = importSheet;
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
      box.innerHTML = found.length ? found.map((s) => setRow(s, false)).join("") : `<div class="hint">No encuentro ninguna colección ni carta con ese nombre.</div>`;
      box.querySelectorAll("[data-code]").forEach((b) => (b.onclick = () => setSheet(b.dataset.code)));
    }, 250);
  };
};

// Staples: las cartas más jugadas de cada formato y cuántas tienes.
const STAPLE_FORMATS = { PAU: "Pauper", ST: "Estándar", MO: "Modern", PI: "Pioneer", LE: "Legacy", VI: "Vintage", EDH: "Commander" };
async function staplesSheet(format = store("stapleFormat") || "PAU", keepScroll = 0) {
  const body = keepScroll ? $("#sheet-body") : openSheet(`<h3>Staples</h3>${skeleton(4)}`);
  const d = await api(`/api/staples?format=${format}`);
  const pctOwned = d.total ? Math.round((100 * d.have) / d.total) : 0;
  const tileS = (c) => `<button class="gcard ${c.owned ? "" : "missing"}" data-name="${esc(c.name)}">
      <img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
      <span class="badge ${c.owned >= c.want ? "full" : c.owned ? "part" : "none"}">${c.owned}/${c.want}</span>
      <div class="why">${c.pct != null ? `${String(c.pct).replace(".", ",")}% del meta · ${String(c.avg).replace(".", ",")} copias` : `Nº ${c.rank} en EDHREC`} · ${euro(c.eur)}</div></button>`;
  const missing = d.cards.filter((c) => c.owned < c.want);
  body.innerHTML = `<h3>Staples de ${esc(STAPLE_FORMATS[format])}</h3>
    <div class="seg" id="st-format">${Object.entries(STAPLE_FORMATS).map(([k, n]) => `<button data-f="${k}" class="${k === format ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="hint">${format === "EDH" ? "Las 100 cartas más jugadas en Commander según EDHREC. El número es copias tuyas / 1." : "Las 100 cartas más jugadas en las listas de torneo de MTGTop8: qué parte del meta las lleva y cuántas copias de media. El número es copias tuyas / un playset (4)."} Toca una para añadirla.</div>
    ${d.lists && format !== "EDH" ? `<div class="hint">Calculado con ${d.lists} listas de torneo.</div>` : ""}
    ${d.total ? `<div class="stats"><div class="stat"><b>${d.have}/${d.total}</b><span>Las tienes (${pctOwned}%)</span></div>
      <div class="stat"><b>${euro(d.missing_cost)}</b><span>Completarlas cuesta</span></div></div><div class="bar"><i style="width:${pctOwned}%"></i></div>
      <div class="grid" style="margin-top:12px">${d.cards.map(tileS).join("")}</div>
      <div class="row-btns"><button class="btn" id="st-copy" ${missing.length ? "" : "disabled"}>Copiar lo que falta</button>
        <button class="btn primary" id="st-share" ${missing.length ? "" : "disabled"}>Compartir lo que falta (${missing.length})</button></div>`
      : `<div class="empty"><strong>Aún no hay datos del meta de ${esc(STAPLE_FORMATS[format])}</strong>Se descargan dos veces al día.</div>`}`;
  if (keepScroll) $("#sheet").scrollTop = keepScroll;
  body.querySelectorAll("#st-format button").forEach((b) => (b.onclick = () => { store("stapleFormat", b.dataset.f); staplesSheet(b.dataset.f); }));
  body.querySelectorAll(".gcard[data-name]").forEach((b) => (b.onclick = () => {
    const y = $("#sheet").scrollTop;
    addSheet([{ name: b.dataset.name }], { onDone: () => staplesSheet(format, y || 1) });
  }));
  const text = () => missing.map((c) => `${c.want - c.owned} ${c.name}`).join("\n");
  $("#st-copy", body)?.addEventListener("click", () => copy(text(), "Lista de lo que falta copiada"));
  $("#st-share", body)?.addEventListener("click", () => shareText(`Staples de ${STAPLE_FORMATS[format]} que me faltan`, text()));
}

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
  let all = !!opts.all, rarity = opts.rarity || "all", show = opts.show || store("setShow") || "all", d, foil = false, q = opts.q || "";
  const updateBar = (s) => {
    const bar = $("#sel-bar", body);
    if (!bar) return;
    bar.hidden = !s.on;
    $("#sel-add", body).textContent = s.ids.size ? `Añadir 1 de cada (${s.ids.size})` : "Toca las cartas que quieras";
    $("#sel-add", body).disabled = !s.ids.size;
    $("#sel-del", body).disabled = !s.ids.size;
    $("#sel-toggle", body).textContent = s.on ? "✓ Seleccionando… (toca para salir)" : "☑ Seleccionar varias (o mantén pulsada una carta)";
    $("#sel-toggle", body).classList.toggle("primary", s.on);
  };
  const back = () => ({ all, rarity, show, q, scroll: sheet.scrollTop });
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
    const qn = q.trim().toLowerCase();
    const cards = d.cards.filter((c) => (rarity === "all" || c.rarity === rarity) && (show === "all" || (show === "missing" ? !c.qty : c.qty))
      && (!qn || c.name.toLowerCase().includes(qn) || String(c.number).toLowerCase() === qn));
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
      <input class="search" id="set-cq" placeholder="Buscar en esta colección (nombre o número)…" value="${esc(q)}">
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
        <button class="btn" id="sel-del" disabled aria-label="Quitar las elegidas">🗑</button>
        <button class="btn primary" id="sel-add" disabled>Toca las cartas que quieras</button>
      </div>`;
    body.querySelectorAll("#set-show button").forEach((b) => b.classList.toggle("on", b.dataset.s === show));
    body.querySelectorAll("#set-rarity button").forEach((b) => b.classList.toggle("on", b.dataset.r === rarity));
    body.querySelectorAll("#set-show button").forEach((b) => (b.onclick = () => { show = b.dataset.s; store("setShow", show); draw(); }));
    body.querySelectorAll("#set-rarity button").forEach((b) => (b.onclick = () => { rarity = b.dataset.r; draw(); }));
    $("#set-cq", body).oninput = (e) => {
      q = e.target.value;
      clearTimeout(draw.t);
      draw.t = setTimeout(() => { draw(); const i = $("#set-cq", body); i.focus(); i.setSelectionRange(q.length, q.length); }, 250);
    };
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
      const res = { completed: [], eur: 0 };
      for (const id of ids) {
        const r = await api("/api/collection", { card_id: id, foil, qty: 1 });
        res.completed.push(...r.completed);
        res.eur = Math.max(res.eur, r.eur || 0);
      }
      toast(`${plural(ids.length, "carta añadida", "cartas añadidas")}${foil ? " (foil)" : ""}`);
      celebrate(res);
      sel.ids.clear();
      loadSummary();
      await load(true);
    };
    $("#sel-del", body).onclick = async () => {
      const ids = [...sel.ids].filter((id) => d.cards.find((c) => c.id === id)?.qty);
      if (!ids.length) return toast("No tienes ninguna de las elegidas");
      if (!confirm(t(`¿Quitar 1 copia de ${plural(ids.length, "carta", "cartas")} (vendidas, perdidas…)?`))) return;
      const r = await api("/api/owncards", { op: "remove", cards: ids.map((id) => [id, 1]) });
      toast(`${plural(r.changed, "carta quitada", "cartas quitadas")}`);
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
const COLORS = [["W", "Blanco"], ["U", "Azul"], ["B", "Negro"], ["R", "Rojo"], ["G", "Verde"], ["C", "Incoloro"]];
const FORMAT_NAMES = { pauper: "Pauper", commander: "Commander", standard: "Estándar", casual: "Casual" };
const STYLE_NAMES = { auto: "Auto", aggro: "Agresivo", midrange: "Medio rango", control: "Control" };
const POWER_LABELS = { 1: "🤡 Meme", 2: "🍺 Muy casual", 3: "⚖️ Equilibrado", 4: "🎯 Optimizado", 5: "🏆 Competitivo", 6: "🌍 World Champion" };
const FOCUS_LABELS = { rampa: "Rampa y bichos grandes", grandes: "Bichos grandes", robo: "Robo de cartas", control: "Control", aggro: "Agresivo",
  tierras: "Landfall", fichas: "Fichas", sacrificio: "Sacrificio", cementerio: "Cementerio", descarte: "Descarte", hechizos: "Hechizos",
  vuelo: "Voladores", vida: "Ganar vida", contadores: "Contadores +1/+1", artefactos: "Artefactos", encantamientos: "Encantamientos",
  equipos: "Equipos y auras", parpadeo: "Parpadeo", "daño": "Daño directo" };
const BRACKET_LABELS = { 1: "1 · Exhibición", 2: "2 · Básico", 3: "3 · Mejorado", 4: "4 · Optimizado", 5: "5 · cEDH" };
const BRACKET_HINTS = { 1: "Temático y sin Game Changers, sin destruir tierras ni turnos extra.", 2: "Como un mazo preconstruido: sin Game Changers, sin destruir tierras ni turnos extra en cadena.",
  3: "Hasta 3 Game Changers; sin destruir todas las tierras ni encadenar turnos extra.", 4: "Sin límites: Game Changers, destruir tierras y turnos extra permitidos.", 5: "Competitivo (cEDH): lo más fuerte que tengas, sin límites." };
const manaIcon = (k, label = k) => `<img class="mana-icon" src="mana/${k}.svg" alt="${esc(label)}">`;

async function builderSheet(seeds, startFormat) {
  if (!seeds || !seeds.length) return pickSeed();
  seeds = [].concat(seeds);
  const body = openSheet(`<h3>Mazo con ${esc(seeds.join(", "))}</h3><div id="b-body">${skeleton(4)}</div>`);
  let colors = null, format = startFormat || store("buildFormat") || "pauper", style = store("buildStyle") || "auto";
  let power = store("buildPower") || "3", bracket = store("buildBracket") || "3", focus = "", p9 = false;
  const excluded = [];  // cartas que has quitado del mazo
  const run = async () => {
    $("h3", body).textContent = `Mazo con ${seeds.join(", ")}`;
    $("#b-body", body).innerHTML = `<div class="hint">Buscando cartas que encajen con el plan…</div>${skeleton(4)}`;
    let d;
    try {
      d = await api(`/api/build?seeds=${encodeURIComponent(seeds.join("|"))}&format=${format}&style=${style}&power=${power}&bracket=${bracket}&focus=${encodeURIComponent(focus)}&exclude=${encodeURIComponent(excluded.join("|"))}${p9 ? "&p9=1" : ""}${colors ? `&colors=${colors}` : ""}`);
    } catch (err) {
      $("#b-body", body).innerHTML = `<div class="empty"><strong>No he podido montarlo</strong>${esc(err.message)}</div>`;
      return;
    }
    colors = d.colors;
    format = d.format;  // puede cambiar solo (p. ej. a Casual si la carta no es legal en Pauper)
    const s = d.stats;
    const maxCurve = Math.max(1, ...Object.values(s.curve));
    // Cada carta: ✕ para quitarla (el mazo se rehace sin ella); las cartas base no se quitan aquí.
    const t = (c) => `<div class="gcard ${c.owned === 0 ? "missing" : ""}"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
      <span class="badge full">${c.qty}</span>${c.reasons[0]?.startsWith("carta base") || c.role === "comandante" ? "" : `<button class="x-card" data-out="${esc(c.name)}" aria-label="Quitar del mazo">✕</button>`}
      <div class="why">${esc(c.reasons.slice(0, 2).join(" · "))}</div></div>`;
    const group = (title, cards) => cards.length ? `<h2>${title} (${cards.reduce((n, c) => n + c.qty, 0)})</h2>
      <div class="grid">${cards.map(t).join("")}</div>` : "";
    const creatures = d.cards.filter((c) => c.role === "criatura"), spells = d.cards.filter((c) => c.role === "hechizo");
    const rows = [...(d.commander ? [d.commander] : []), ...d.cards, ...d.lands];
    const listText = rows.map((c) => `${c.qty} ${c.name}`).join("\n");
    $("#b-body", body).innerHTML = `
      <div class="seg" id="b-format">${Object.entries(FORMAT_NAMES).map(([k, n]) => `<button data-f="${k}">${n}</button>`).join("")}</div>
      <div class="seg" id="b-style">${Object.entries(STYLE_NAMES).map(([k, n]) => `<button data-s="${k}" class="${style === k ? "on" : ""}">${k === "auto" && style === "auto" ? `Auto (${STYLE_NAMES[d.style].toLowerCase()})` : n}</button>`).join("")}</div>
      <div class="field"><label>Enfoque del mazo</label><div class="seg" id="b-focus"><button data-fo="" class="${focus ? "" : "on"}">✨ Automático</button>${d.focus_options.map((o) => `<button data-fo="${esc(o.key)}" class="${focus === o.key ? "on" : ""}">${o.rec ? "★ " : ""}${esc(FOCUS_LABELS[o.key] || o.key)} (${o.count})</button>`).join("")}</div>
        <div class="hint">★ = lo que mejor hace este color. Entre paréntesis, cuántas cartas de ese tipo tienes que valgan.</div></div>
      <div class="field"><label>Nivel del mazo</label><div class="seg" id="b-power">${Object.entries(POWER_LABELS).map(([k, n]) => `<button data-p="${k}" class="${power === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
      ${format === "commander" ? `<div class="field"><label>Bracket de Commander</label><div class="seg" id="b-bracket">${Object.entries(BRACKET_LABELS).map(([k, n]) => `<button data-b="${k}" class="${bracket === k ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="hint">${BRACKET_HINTS[bracket]}</div><div class="hint">Game Changers en el mazo: <b>${d.game_changers.length}</b></div>
        ${d.game_changers.length ? `<div class="item-meta">${d.game_changers.map((n) => `<span class="chip gold">${esc(n)}</span>`).join("")}</div>` : ""}</div>` : ""}
      <label class="toggle" style="margin:4px 0 10px"><input type="checkbox" id="b-p9" ${p9 ? "checked" : ""}> ⚡ Power 9 (Black Lotus, los Mox de tus colores y, si es azul, Ancestral Recall, Time Walk y Timetwister; aunque no los tengas. Solo Casual)</label>
      <div class="field"><label>Meter una carta concreta</label><input class="search" id="b-addq" placeholder="Escribe el nombre de una carta…"><div class="list" id="b-addres"></div></div>
      ${excluded.length ? `<div class="item-meta">Quitadas: ${excluded.map((n) => `<button class="chip" data-back="${esc(n)}">↩ ${esc(n)}</button>`).join("")}</div>` : ""}
      <button class="btn block" id="b-more" style="margin:4px 0 8px">➕ Más cartas base (${seeds.length})</button>
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
      <div class="item-meta" style="margin-top:6px">Funciones: <span class="chip">${s.roles.removal} quitan amenazas</span><span class="chip">${s.roles.draw} roban</span>${format === "commander" ? `<span class="chip">${s.roles.ramp} aceleran maná</span><span class="chip">${s.roles.wipe} barridos</span><span class="chip">${s.roles.protect} protegen</span>` : ""}</div>
      <h2>Curva de maná · media ${s.avg_cmc}</h2>
      <div class="curve">${Object.entries(s.curve).map(([k, n]) => `<div><i style="height:${(n / maxCurve) * 100}%"></i><b>${n || ""}</b><span>${k === "6" ? "6+" : k}</span></div>`).join("")}</div>
      <div class="hint">${s.creatures} criaturas y ${s.spells - s.creatures} hechizos. Debajo de cada carta, por qué está.</div>
      ${group("Criaturas", creatures)}${group("Hechizos", spells)}${group("Tierras", d.lands)}
      ${d.bench.length ? `<h2>➕ Te recomiendo añadir (ya las tienes)</h2><div class="hint">Toca una para meterla en el mazo como carta base.</div>
        <div class="grid">${d.bench.map((c) => `<button class="gcard rec" data-add="${esc(c.name)}"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
          ${c.eur != null ? `<span class="badge full">${euro(c.eur)}</span>` : ""}<div class="why">${esc(c.reasons.join(" · "))}</div></button>`).join("")}</div>` : ""}
      ${d.meta_recs?.length ? `<h2>📊 Lo que juega el meta</h2><div class="hint">Cartas habituales en las listas de torneo ${d.meta_recs[0].why === "con tus cartas base" ? "con tus cartas base" : "de tus colores"} que no están en tu mazo. Toca una para meterla (si no la tienes, entra igual, marcada para comprar).</div>
        <div class="grid">${d.meta_recs.map((c) => `<button class="gcard rec ${c.owned ? "" : "missing"}" data-add="${esc(c.name)}"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
          <span class="badge ${c.owned ? "full" : "none"}">${c.pct}%</span>
          <div class="why">${c.owned ? `La tienes ×${c.owned}` : euro(c.eur)}${c.replaces ? ` · en lugar de ${esc(c.replaces)}` : ""}</div></button>`).join("")}</div>` : ""}
      ${d.buy?.length ? `<h2>🛒 Te recomiendo comprar</h2><div class="hint">No las tienes y mejorarían el mazo. Toca una para verla en Cardmarket.</div>
        <div class="grid">${d.buy.map((c) => `<a class="gcard rec" target="_blank" rel="noopener" href="${cardmarketUrl(c.name)}"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
          <span class="badge part">${euro(c.eur)}</span><div class="why">${esc(c.reasons.join(" · "))}</div></a>`).join("")}</div>` : ""}
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
    body.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
      if (!seeds.includes(b.dataset.add)) seeds.push(b.dataset.add);
      toast(`${b.dataset.add}: añadida como carta base`);
      run();
    }));
    $("#b-copy", body).onclick = () => copy(listText, "Lista copiada (se puede importar en Moxfield, MTGA…)");
    $("#b-other", body).onclick = () => pickSeed();
    $("#b-more", body).onclick = () => pickSeed(seeds, format);
    body.querySelectorAll("#b-style button").forEach((b) => (b.onclick = () => { style = b.dataset.s; store("buildStyle", style); run(); }));
    body.querySelectorAll("#b-power button").forEach((b) => (b.onclick = () => { power = b.dataset.p; store("buildPower", power); run(); }));
    $("#b-p9", body).onchange = (e) => { p9 = e.target.checked; run(); };
    body.querySelectorAll("#b-focus button").forEach((b) => (b.onclick = () => { focus = b.dataset.fo; run(); }));
    body.querySelectorAll("[data-out]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); excluded.push(b.dataset.out); toast(`${b.dataset.out}: fuera del mazo`); run(); }));
    body.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => { excluded.splice(excluded.indexOf(b.dataset.back), 1); run(); }));
    let tq;
    $("#b-addq", body).oninput = (e) => {
      clearTimeout(tq);
      tq = setTimeout(async () => {
        const q = e.target.value.trim(), box = $("#b-addres", body);
        if (q.length < 2) { box.innerHTML = ""; return; }
        const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
        box.innerHTML = res.slice(0, 6).map((r) => `<button class="item" data-put="${esc(r.name)}"><img class="thumb" loading="lazy" src="${esc(r.image)}" alt="">
          <div class="item-main"><div class="item-title">${esc(r.name)}</div>${r.alias ? `<div class="item-meta"><span class="chip">${esc(r.alias)}</span></div>` : ""}</div>
          <div class="item-side"><div class="sub">➕</div></div></button>`).join("") || `<div class="hint">No la encuentro.</div>`;
        box.querySelectorAll("[data-put]").forEach((b) => (b.onclick = () => {
          const n = b.dataset.put;
          if (!seeds.includes(n)) seeds.push(n);
          const i = excluded.indexOf(n); if (i >= 0) excluded.splice(i, 1);
          toast(`${n}: añadida como carta base`);
          run();
        }));
      }, 250);
    };
    body.querySelectorAll("#b-bracket button").forEach((b) => (b.onclick = () => { bracket = b.dataset.b; store("buildBracket", bracket); run(); }));
    $("#b-save", body).onclick = async () => {
      const r = await api("/api/mydecks", { save: { name: `${d.commander ? d.commander.name : d.seed} (${FORMAT_NAMES[format]})`, format: FORMAT_NAMES[format],
        cards: rows.map((c) => [c.name, c.qty, 0]) } });
      toast("Guardado en Mis mazos");
      deckSheet(r.id);
    };
  };
  run();
}

// Elegir el formato y una o varias cartas base de la carpeta (con sugerencias de cartas que combinan).
// `already` = las que ya tiene el mazo (salen marcadas).
async function pickSeed(already = [], keepFormat = null) {
  let format = keepFormat || store("buildFormat") || "pauper";
  const body = openSheet(`<h3>Crear un mazo</h3>
    <div class="field"><label>1. ¿Para qué formato?</label>
      <div class="seg" id="seed-format">${Object.entries(FORMAT_NAMES).map(([k, n]) => `<button data-f="${k}">${n}</button>`).join("")}</div>
      <div class="hint" id="seed-fhint"></div></div>
    <div class="field"><label>2. Elige una o varias cartas</label>
      <div class="hint">Cuantas más cartas elijas que vayan juntas, más sólido sale el mazo. Al elegir una, te sugiero otras de tu carpeta que combinan con ella.</div></div>
    <div id="seed-sugg"></div>
    <input class="search" id="seed-q" placeholder="Buscar en tus cartas…">
    <div class="seg" style="margin-top:8px"><button id="seed-legend">👑 Solo comandantes</button></div>
    <div id="seed-list">${skeleton(3)}</div>
    <div class="sel-bar" id="seed-bar"><span class="sub" id="seed-n">Ninguna elegida</span><button class="btn primary" id="seed-go" disabled>Crear mazo</button></div>`);
  const items = await api("/api/collection");
  const seen = new Set();
  const cards = items.filter((c) => !/land/i.test(c.type || "") && !seen.has(c.name) && seen.add(c.name));
  if (!cards.length) {
    $("#seed-list", body).innerHTML = `<div class="empty"><strong>No hay cartas en esta carpeta</strong>Importa un CSV o escanea cartas primero.</div>`;
    return;
  }
  const picked = new Set(already);
  let allowed = new Set(), onlyLegends = false, limit = 90;
  const isLegend = (c) => /legendary.*creature/i.test(c.type || "");
  const FHINT = { pauper: "60 cartas, solo comunes.", commander: "100 cartas sin repetir. Empieza por una criatura legendaria: será tu comandante.",
    standard: "60 cartas de las colecciones recientes.", casual: "60 cartas, sin restricciones: para jugar con amigos." };
  const update = () => {
    $("#seed-n", body).textContent = picked.size ? [...picked].join(", ") : "Ninguna elegida";
    $("#seed-go", body).disabled = !picked.size;
  };
  const toggle = (name) => { picked.has(name) ? picked.delete(name) : picked.add(name); update(); suggest(); };
  let sugTimer = 0;
  const suggest = () => {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(async () => {
      const box = $("#seed-sugg", body);
      if (!picked.size) { box.innerHTML = ""; return; }
      const r = await api(`/api/seedhelp?format=${format}&seeds=${encodeURIComponent([...picked].join("|"))}`);
      box.innerHTML = r.suggest.length ? `<h2>✨ Combinan con lo que has elegido</h2><div class="arts">${r.suggest.map((c) => `
        <button class="art sugg" data-name="${esc(c.name)}"><img loading="lazy" src="${esc(c.image)}" alt="${esc(c.name)}"><span>Sinergia: ${esc(c.why)}.</span></button>`).join("")}</div>` : "";
      box.querySelectorAll(".sugg").forEach((b) => (b.onclick = () => {
        toggle(b.dataset.name);
        body.querySelectorAll(`#seed-list [data-id]`).forEach((t) => t.classList.toggle("picked", picked.has(t.dataset.id)));
      }));
    }, 250);
  };
  const draw = (f = $("#seed-q", body).value) => {
    const all = cards.filter((c) => (allowed.has(c.name) || picked.has(c.name)) && c.name.toLowerCase().includes(f.toLowerCase()) && (!onlyLegends || isLegend(c)));
    $("#seed-list", body).innerHTML = all.length
      ? `<div class="grid">${all.slice(0, limit).map((c) => tile({ ...c, key: c.name })).join("")}</div>
         ${all.length > limit ? `<button class="btn block" id="seed-more" style="margin-top:10px">Ver más (${all.length - limit})</button>` : ""}`
      : `<div class="hint">No tienes cartas así que valgan en ${FORMAT_NAMES[format]}.</div>`;
    $("#seed-more", body)?.addEventListener("click", () => { limit += 150; draw(); });
    body.querySelectorAll("#seed-list [data-id]").forEach((b) => {
      b.classList.toggle("picked", picked.has(b.dataset.id));
      b.onclick = () => { toggle(b.dataset.id); b.classList.toggle("picked", picked.has(b.dataset.id)); };  // sin repintar: no salta la pantalla
    });
  };
  const setFormat = async (f) => {
    format = f;
    store("buildFormat", f);
    body.querySelectorAll("#seed-format button").forEach((b) => b.classList.toggle("on", b.dataset.f === f));
    $("#seed-fhint", body).textContent = FHINT[f];
    onlyLegends = f === "commander" && ![...picked].some((n) => isLegend(cards.find((c) => c.name === n) || {}));
    $("#seed-legend", body).classList.toggle("on", onlyLegends);
    allowed = new Set((await api(`/api/seedhelp?format=${f}`)).allowed);
    draw();
    suggest();
  };
  body.querySelectorAll("#seed-format button").forEach((b) => (b.onclick = () => setFormat(b.dataset.f)));
  $("#seed-legend", body).onclick = (e) => { onlyLegends = !onlyLegends; e.target.classList.toggle("on", onlyLegends); draw(); };
  $("#seed-go", body).onclick = () => {
    let seeds = [...picked];
    const legend = format === "commander" && seeds.find((n) => isLegend(cards.find((c) => c.name === n) || {}));
    if (legend) seeds = [legend, ...seeds.filter((n) => n !== legend)];  // el comandante, primero
    builderSheet(seeds, format);
  };
  $("#seed-q", body).oninput = (e) => draw(e.target.value);
  update();
  await setFormat(format);
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
    <div class="seg" id="m-tab"><button data-t="watch">⭐ Sigo</button><button data-t="moves">📈 Movimientos</button><button data-t="pred">🔮 Predicciones</button><button data-t="syn">🧩 Sinergias</button></div>
    <div id="m-section"></div>`;
  v.querySelectorAll("#m-tab button").forEach((b) => {
    b.classList.toggle("on", b.dataset.t === section);
    b.onclick = () => { store("marketTab", b.dataset.t); views.market(); };
  });
  const box = $("#m-section");
  if (section === "pred") return predictionsView(box);
  if (section === "syn") return synergiesView(box);
  if (section === "watch") return watchView(box);
  box.innerHTML = `
    <div class="seg" id="m-scope"><button data-s="pauper">Legales en Pauper</button><button data-s="collection">Mis cartas</button><button data-s="all">Todas</button></div>
    <div class="seg" id="m-days"><button data-d="1">1 día</button><button data-d="7">7 días</button><button data-d="30">30 días</button></div>
    <div id="m-body">${skeleton(5)}</div>`;
  const draw = async () => {
    box.querySelectorAll("#m-scope button").forEach((b) => b.classList.toggle("on", b.dataset.s === state.marketScope));
    box.querySelectorAll("#m-days button").forEach((b) => b.classList.toggle("on", +b.dataset.d === state.marketDays));
    $("#m-body").innerHTML = skeleton(5);
    const m = await api(`/api/movers?scope=${state.marketScope}&days=${state.marketDays}&min=${state.marketScope === "collection" ? 0 : 0.5}`);
    const row = (i) => `<div class="mover" data-follow="${esc(i.name)}"><span class="pct ${i.pct > 0 ? "up" : "down"}">${pct(i.pct)}</span><span class="n">${esc(i.name)}${i.set ? ` <span class="chip">${esc(i.set.toUpperCase())}</span>` : ""}</span><span class="from">${euro(i.old)} → <b>${euro(i.new)}</b></span></div>`;
    if (m.base === m.latest) {
      $("#m-body").innerHTML = `<div class="empty"><strong>Acumulando historial</strong>Hay precios del ${esc(m.latest)}. Las subidas y bajadas aparecerán a partir de mañana, y la vista semanal en 7 días.</div>`;
      return;
    }
    $("#m-body").innerHTML = `<div class="hint">Del ${esc(m.base)} al ${esc(m.latest)} · solo cartas de 0,50 € o más</div>
      <h2>📈 Suben</h2><div class="list">${m.up.map(row).join("") || '<div class="hint">Nada.</div>'}</div>
      <h2>📉 Bajan</h2><div class="list">${m.down.map(row).join("") || '<div class="hint">Nada.</div>'}</div>`;
    $("#m-body").querySelectorAll("[data-follow]").forEach((el) => (el.onclick = () => synergySheet(el.dataset.follow)));
  };
  box.querySelectorAll("#m-scope button").forEach((b) => (b.onclick = () => { state.marketScope = b.dataset.s; store("marketScope", b.dataset.s); draw(); }));
  box.querySelectorAll("#m-days button").forEach((b) => (b.onclick = () => { state.marketDays = +b.dataset.d; store("marketDays", b.dataset.d); draw(); }));
  draw();
};

// Cartas que sigues: precio de Cardmarket y cuánto ha subido o bajado en 1, 7 y 30 días.
async function watchView(box) {
  box.innerHTML = `<div class="hint">Sigue cartas concretas (tuyas o no) y mira cómo cambia su precio. Toca una para verla; ✕ para dejar de seguirla.</div>
    <input class="search" id="w-q" placeholder="Buscar una carta para seguirla…">
    <div class="list" id="w-search"></div>
    <button class="btn block" id="w-top" style="margin-top:8px">⭐ Seguir mis 20 cartas más valiosas</button>
    <div id="w-list">${skeleton(3)}</div>`;
  const chg = (v, label) => `<span class="chip ${v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : ""}">${label} ${v == null ? "—" : pct(v)}</span>`;
  const draw = async () => {
    const rows = await api("/api/watch");
    $("#w-list", box).innerHTML = rows.length ? `<div class="list">${rows.map((c) => `
      <div class="item watch" data-name="${esc(c.name)}"><img class="thumb" loading="lazy" src="${esc(c.image)}" alt="">
        <div class="item-main"><div class="item-title">${esc(c.name)}${c.owned ? ` <span class="chip gold">La tienes ×${c.owned}</span>` : ""}</div>
          <div class="item-meta">${chg(c.d1, "1 d")}${chg(c.d7, "7 d")}${chg(c.d30, "30 d")}</div></div>
        <div class="item-side"><div class="price">${euro(c.eur)}</div><button class="btn w-del" data-del="${esc(c.name)}" aria-label="Dejar de seguir">✕</button></div></div>`).join("")}</div>`
      : `<div class="empty"><strong>Aún no sigues ninguna carta</strong>Búscala arriba, o pulsa ⭐ en la ficha de una carta o en Movimientos.</div>`;
    box.querySelectorAll(".watch[data-name]").forEach((el) => (el.onclick = (e) => { if (!e.target.closest("[data-del]")) synergySheet(el.dataset.name); }));
    box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { await api("/api/watch", { remove: b.dataset.del }); draw(); }));
  };
  let t;
  $("#w-q", box).oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = e.target.value.trim(), out = $("#w-search", box);
      if (q.length < 2) { out.innerHTML = ""; return; }
      const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
      out.innerHTML = res.slice(0, 8).map((r) => `<button class="item" data-add="${esc(r.name)}"><img class="thumb" loading="lazy" src="${esc(r.image)}" alt="">
        <div class="item-main"><div class="item-title">${esc(r.name)}</div>${r.alias ? `<div class="item-meta"><span class="chip">${esc(r.alias)}</span></div>` : ""}</div>
        <div class="item-side"><div class="price">${euro(r.eur)}</div><div class="sub">⭐ Seguir</div></div></button>`).join("") || `<div class="hint">No la encuentro.</div>`;
      out.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => {
        await api("/api/watch", { add: b.dataset.add });
        toast(`⭐ Sigues ${b.dataset.add}`);
        out.innerHTML = ""; $("#w-q", box).value = "";
        draw();
      }));
    }, 250);
  };
  $("#w-top", box).onclick = async () => { await api("/api/watch", { top: 20 }); toast("Siguiendo tus cartas más valiosas"); draw(); };
  draw();
}

// Botón ⭐ para seguir (o dejar de seguir) el precio de una carta desde su ficha.
async function followButton(root, name) {
  const btn = $("#follow", root);
  if (!btn) return;
  const paint = (on) => { btn.textContent = on ? "⭐ Siguiendo su precio (toca para dejarlo)" : "☆ Seguir su precio en Mercado"; btn.classList.toggle("primary", !on); };
  let on = (await api("/api/watch")).some((c) => c.name === name);
  paint(on);
  btn.onclick = async () => { await api("/api/watch", on ? { remove: name } : { add: name }); on = !on; paint(on); toast(on ? `⭐ Sigues ${name}` : "Ya no la sigues"); };
}

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
    ${group(`${ico("reserved")}Lista Reservada más jugada`, "No se reimprimen nunca: con el tiempo suelen subir.", p.reserved, "—")}`;
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
        <div class="item-main"><div class="item-title">${esc(r.name)}</div>${r.alias ? `<div class="item-meta"><span class="chip">${esc(r.alias)}</span></div>` : ""}</div></button>`).join("") || `<div class="hint">No hay cartas con ese nombre.</div>`;
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
      <button class="btn block" id="follow" style="margin:8px 0">☆ Seguir su precio en Mercado</button>
      <div class="hint">Las cartas de todo Magic que mejor encajan con ella. "La tienes" = está en tu carpeta.</div>
      <div class="list">${d.cards.map(predRow).join("") || '<div class="hint">No he encontrado sinergias claras.</div>'}</div>
      <a class="btn block" style="margin-top:10px;text-decoration:none" target="_blank" rel="noopener" href="${cardmarketUrl(d.name)}">🛒 Ver ${esc(d.name)} en Cardmarket</a>`;
    bindPred(body);
    followButton(body, d.name);
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
      <div class="scan-tools" id="scan-tools"></div>
    </div>`);
  const paintLang = () => document.querySelectorAll("#scan-lang button").forEach((b) => b.classList.toggle("on", b.dataset.l === scanLang()[0]));
  paintLang();
  document.querySelectorAll("#scan-lang button").forEach((b) => (b.onclick = () => { store("scanLang", b.dataset.l); paintLang(); S.last = null; }));
  $("#scan-close").onclick = closeScanner;
  try {
    S.stream = await openBestCamera();
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
    .then(() => status(canFocus(S.stream) ? "Coloca la carta dentro del marco · toca para enfocar"
      : "Esta cámara no enfoca: prueba 🔄 Cámara o 📷 Foto (usa el enfoque del móvil)")).catch((e) => status(e.message));
  setupCameraControls(video);
  S.timer = setInterval(scanTick, 200);
}

// ---- Cámara: muchos Android abren por defecto la gran angular trasera, que NO enfoca de cerca.
// Se busca una cámara trasera que sí enfoque (y se recuerda); también se puede cambiar a mano.
const camOpts = (deviceId) => ({ audio: false, video: { width: { ideal: 1920 }, height: { ideal: 1080 },
  ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }) } });
const canFocus = (stream) => {
  const c = stream.getVideoTracks()[0].getCapabilities?.() || {};
  return (c.focusMode || []).some((m) => m !== "none" && m !== "fixed") || !!c.focusDistance;
};
const stopStream = (st) => st?.getTracks().forEach((t) => t.stop());
async function backCameras() {
  return (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === "videoinput" && !/front|user|frontal|delant|selfie/i.test(d.label));
}
async function openBestCamera() {
  const saved = store("scanCam");
  if (saved) {
    const st = await navigator.mediaDevices.getUserMedia(camOpts(saved)).catch(() => null);
    if (st) return st;
  }
  let st = await navigator.mediaDevices.getUserMedia(camOpts());
  if (canFocus(st)) return st;
  const first = st.getVideoTracks()[0].getSettings().deviceId;
  stopStream(st);  // Android no deja abrir dos cámaras a la vez
  for (const d of await backCameras()) {
    if (d.deviceId === first) continue;
    const s2 = await navigator.mediaDevices.getUserMedia(camOpts(d.deviceId)).catch(() => null);
    if (!s2) continue;
    if (canFocus(s2)) { store("scanCam", d.deviceId); return s2; }
    stopStream(s2);
  }
  return navigator.mediaDevices.getUserMedia(camOpts(first));
}
async function switchCamera() {
  const cams = await backCameras();
  if (cams.length < 2) return toast("Solo hay una cámara trasera");
  const cur = S.stream?.getVideoTracks()[0].getSettings().deviceId;
  const next = cams[(cams.findIndex((d) => d.deviceId === cur) + 1) % cams.length];
  stopStream(S.stream);
  S.stream = await navigator.mediaDevices.getUserMedia(camOpts(next.deviceId));
  store("scanCam", next.deviceId);
  const video = $("#scan-video");
  video.srcObject = S.stream;
  await video.play().catch(() => {});
  setupCameraControls(video);
  toast(`Cámara ${cams.indexOf(next) + 1} de ${cams.length}${canFocus(S.stream) ? "" : " (esta no enfoca)"}`);
}

// Enfoque (continuo, tocar para enfocar o manual), linterna y zoom, si el móvil lo permite.
function setupCameraControls(video) {
  const track = S.stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  const modes = caps.focusMode || [];
  const apply = (c) => track.applyConstraints({ advanced: [c] }).catch(() => {});
  // Reenfocar en un punto (por defecto, el centro del marco de la carta, no la mesa de detrás).
  const focusAt = (x = 0.5, y = 0.42) => {
    const c = { pointsOfInterest: [{ x, y }] };
    if (modes.includes("single-shot")) c.focusMode = "single-shot";
    else if (modes.includes("continuous")) c.focusMode = "continuous";
    return apply(c).then(() => modes.includes("continuous") && setTimeout(() => apply({ focusMode: "continuous" }), 1500));
  };
  S.refocus = () => modes.length && focusAt();
  if (modes.includes("continuous")) apply({ focusMode: "continuous", pointsOfInterest: [{ x: 0.5, y: 0.42 }] });
  video.onclick = (e) => {
    const r = video.getBoundingClientRect();
    const ring = Object.assign(document.createElement("span"), { className: "focus-ring" });
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    $("#scanner").appendChild(ring);
    setTimeout(() => ring.remove(), 700);
    focusAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const bar = $("#scan-tools");
  bar.innerHTML = `<button class="btn" id="scan-photo">📷 Foto</button><button class="btn" id="scan-cam">🔄 Cámara</button>`;
  $("#scan-photo").onclick = () => { closeScanner(); photoScan(); };
  $("#scan-cam").onclick = switchCamera;
  if (caps.torch) {
    let on = false;
    bar.insertAdjacentHTML("beforeend", `<button class="btn" id="scan-torch">🔦</button>`);
    $("#scan-torch").onclick = (e) => { on = !on; apply({ torch: on }); e.currentTarget.classList.toggle("primary", on); };
  }
  if (caps.focusDistance && modes.includes("manual")) {
    const fd = caps.focusDistance;
    bar.insertAdjacentHTML("beforeend", `<label class="scan-zoom">🎯<input type="range" id="scan-focus" min="${fd.min}" max="${fd.max}" step="${fd.step || (fd.max - fd.min) / 50}" value="${track.getSettings().focusDistance ?? fd.min}"></label>
      ${modes.includes("continuous") ? `<button class="btn" id="scan-af">AF</button>` : ""}`);
    $("#scan-focus").oninput = (e) => apply({ focusMode: "manual", focusDistance: +e.target.value });
    $("#scan-af")?.addEventListener("click", () => { apply({ focusMode: "continuous" }); toast("Enfoque automático"); });
  }
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    const z0 = Math.min(caps.zoom.max, Math.max(caps.zoom.min, +(store("scanZoom") || 1.6)));
    apply({ zoom: z0 });
    bar.insertAdjacentHTML("beforeend", `<label class="scan-zoom">🔍<input type="range" id="scan-zoomr" min="${caps.zoom.min}" max="${Math.min(caps.zoom.max, 5)}" step="${caps.zoom.step || 0.1}" value="${z0}"></label>`);
    $("#scan-zoomr").oninput = (e) => { apply({ zoom: +e.target.value }); store("scanZoom", e.target.value); };
  }
  if (!canFocus(S.stream)) status("Esta cámara no enfoca: prueba 🔄 Cámara o 📷 Foto (usa el enfoque del móvil)");
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
      S.misses = 0;
      S.hits = S.last === top.name ? S.hits + 1 : 1;
      S.last = top.name;
      status(`Leyendo… ${top.name}`);
      // Dos lecturas iguales seguidas, la edición exacta leída o un nombre leído sin dudas = reconocida.
      if (S.hits >= 2 || top.best || top.score >= 1.15) showScanResult(m);
    } else {
      S.justAdded = null;
      S.misses = (S.misses || 0) + 1;
      if (S.misses % 6 === 0) S.refocus?.();  // ~cada 2-3 s sin leer nada: forzar un reenfoque
      status(S.misses > 12 ? "¿Borrosa? Aleja el móvil un palmo y usa el zoom 🔍" : "Coloca la carta dentro del marco, con buena luz y sin reflejos");
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


// ---------- perfil: nombre, contraseña (bloqueo en este móvil), medallas y copias de seguridad ----------
async function hashPassword(pass, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 150000, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function profileSheet() {
  const body = openSheet(skeleton(3));
  const [p, m] = await Promise.all([api("/api/profile"), api("/api/medals")]);
  const medal = (icon, title, sub = "") => `<div class="medal">${icon}<div><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div></div>`;
  const setIco = (x) => (x.icon ? `<img src="${esc(x.icon)}" alt="">` : `<i>🏅</i>`);
  const got = m.ladder.filter((x) => x.done);
  body.innerHTML = `
    <div class="profile-head"><div class="avatar">${esc((p.name || "?").slice(0, 1).toUpperCase())}</div>
      <div><h3>${esc(p.name || "Tu perfil")}</h3><div class="sub">${plural(m.cards, "carta", "cartas")} · ${euro(m.value)} · ${esc(m.binder)}</div></div></div>
    <div class="field"><label>Nombre</label><input class="search" id="pf-name" maxlength="40" placeholder="Cómo te llamas" value="${esc(p.name)}"></div>
    <div class="field"><label>Contraseña ${p.hash ? "(puesta)" : ""}</label>
      <input class="search" id="pf-pass" type="password" autocomplete="new-password" placeholder="${p.hash ? "Nueva contraseña" : "Opcional: pide la contraseña al abrir la app"}"></div>
    <div class="hint">Todo se guarda solo en este móvil: sin correo ni cuentas. La contraseña bloquea la app en este móvil; no la podrás recuperar.</div>
    <div class="row-btns"><button class="btn primary" id="pf-save">Guardar</button>${p.hash ? `<button class="btn" id="pf-nopass">Quitar contraseña</button>` : ""}</div>
    <label class="toggle" style="margin-top:10px"><input type="checkbox" id="pf-sound" ${store("sounds") === "0" ? "" : "checked"}> 🔔 Sonidos al añadir cartas</label>
    ${Cloud.ready ? `<h2>☁️ Cuenta en la nube</h2>${Cloud.user
      ? `<div class="hint">Conectado como: <b>${esc(Cloud.user)}</b></div><div class="hint">Tus cartas, carpetas y mazos se guardan solos y los ves entrando con tu usuario en otro móvil o en la web.</div>
         <div class="row-btns"><button class="btn" id="cl-out">Cerrar sesión</button><button class="btn primary" id="cl-push">☁️ Guardar ahora</button></div>`
      : `<div class="hint">Crea una cuenta (solo nombre y contraseña) para guardar tus datos en internet y usarlos en cualquier móvil, también en iPhone desde la web.</div>
         <input class="search" id="cl-user" autocomplete="username" autocapitalize="none" placeholder="Nombre de usuario">
         <input class="search" id="cl-pass" type="password" autocomplete="current-password" placeholder="Contraseña (mínimo 6)" style="margin-top:8px">
         <div class="row-btns"><button class="btn" id="cl-new">Crear cuenta</button><button class="btn primary" id="cl-in">Entrar</button></div>`}` : ""}

    <h2>🏆 Medallas (${m.sets.length + m.precons.length + got.length})</h2>
    <div class="medals">${got.map((x) => medal("<i>⭐</i>", x.label)).join("")}</div>
    ${m.sets.length ? `<h2>Colecciones completas (${m.sets.length})</h2><div class="medals">${m.sets.map((x) => medal(setIco(x), x.name, `${x.total} cartas`)).join("")}</div>` : ""}
    ${m.precons.length ? `<h2>Mazos preconstruidos completos (${m.precons.length})</h2><div class="medals">${m.precons.map((x) => medal(setIco(x), x.name, x.type)).join("")}</div>` : ""}
    ${m.decks.length ? `<h2>Mazos del meta que puedes montar (${m.decks.length})</h2><div class="medals">${m.decks.map((x) => medal("<i>⚔️</i>", x)).join("")}</div>` : ""}
    ${m.near.length ? `<h2>A punto de conseguir</h2><div class="list">${m.near.map((x) => `<button class="item" data-set="${esc(x.code)}">
        <div class="item-main"><div class="item-title">${esc(x.name)}</div><div class="bar"><i style="width:${x.pct}%"></i></div>
        <div class="item-meta">${x.owned}/${x.total} · ${x.pct}%</div></div></button>`).join("")}</div>` : ""}
    ${!m.sets.length && !m.precons.length ? `<div class="hint">Completa una colección o un mazo preconstruido para ganar su medalla.</div>` : ""}
    <div class="medals">${m.ladder.filter((x) => !x.done).slice(0, 3).map((x) => `<div class="medal locked"><i>🔒</i><div><b>${esc(x.label)}</b></div></div>`).join("")}</div>

    <h2>Importar y copias de seguridad</h2>
    <button class="btn block" id="pf-import">${ico("import")}Importar cartas de otra app (CSV)</button>
    <div class="hint">El CSV lleva todas tus carpetas y se puede importar aquí, en ManaBox o en Moxfield. La copia completa guarda también tus mazos y el perfil.</div>
    <button class="btn block" id="pf-csv">📤 Exportar todas mis cartas (CSV)</button>
    <button class="btn block" id="pf-json" style="margin-top:8px">💾 Copia completa (para otro móvil)</button>
    <label class="btn block" for="pf-restore" style="margin-top:8px">♻️ Restaurar una copia completa</label><input type="file" id="pf-restore" accept=".json,application/json" hidden>`;
  body.querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => setSheet(b.dataset.set)));
  const enter = async (create) => {
    try {
      const row = await Cloud.login($("#cl-user", body).value, $("#cl-pass", body).value, create);
      const local = (await api("/api/collections")).reduce((n, b) => n + b.cards, 0);
      if (row.data && (!local || confirm(t("Tu cuenta ya tiene datos guardados. ¿Cargarlos en este móvil? (Cancelar = subir a tu cuenta lo de este móvil)")))) {
        await Cloud.apply(row.data);
        cid = 1; store("cid", "1");
        toast("Datos de tu cuenta cargados");
      } else {
        if (!(await api("/api/profile")).name) await api("/api/profile", { name: Cloud.user });
        await Cloud.push();
        toast(create ? "Cuenta creada: tus datos ya están en la nube" : "Datos de este móvil subidos a tu cuenta");
      }
      loadSummary(); render(); profileSheet();
    } catch (err) { toast(err.message); }
  };
  $("#cl-in", body)?.addEventListener("click", () => enter(false));
  $("#cl-new", body)?.addEventListener("click", () => enter(true));
  $("#cl-out", body)?.addEventListener("click", () => {
    if (!confirm(t("¿Cerrar sesión? Lo de este móvil se queda aquí; tu cuenta sigue guardada en la nube."))) return;
    Cloud.logout(); toast("Sesión cerrada"); profileSheet();
  });
  $("#cl-push", body)?.addEventListener("click", () => Cloud.push().then(() => toast("Guardado en la nube")).catch((e) => toast(e.message)));
  $("#pf-sound", body).onchange = (e) => { store("sounds", e.target.checked ? "1" : "0"); if (e.target.checked) Sfx.card(5); };
  $("#pf-save", body).onclick = async () => {
    const pass = $("#pf-pass", body).value;
    if (pass && pass.length < 4) return toast("La contraseña necesita al menos 4 caracteres");
    const upd = { name: $("#pf-name", body).value };
    if (pass) { upd.salt = newSalt(); upd.hash = await hashPassword(pass, upd.salt); }
    await api("/api/profile", upd);
    toast(pass ? "Perfil guardado · la app pedirá la contraseña al abrirla" : "Perfil guardado");
    profileSheet();
  };
  $("#pf-nopass", body)?.addEventListener("click", async () => {
    if (!confirm(t("¿Quitar la contraseña? La app se abrirá sin pedirla."))) return;
    await api("/api/profile", { clearPassword: true });
    toast("Contraseña quitada");
    profileSheet();
  });
  const day = new Date().toISOString().slice(0, 10);
  $("#pf-import", body).onclick = importSheet;
  $("#pf-csv", body).onclick = async () => {
    const r = await api("/api/exportcsv");
    if (!r.rows) return toast("Aún no tienes cartas");
    saveFile(`gathering-market-${day}.csv`, r.csv, "text/csv");
  };
  $("#pf-json", body).onclick = () => saveFile(`gathering-market-copia-${day}.json`, Engine.exportUser(), "application/json");
  $("#pf-restore", body).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || !confirm(t("¿Reemplazar todo lo de este móvil (cartas, carpetas, mazos y perfil) por la copia?"))) return;
    try { await Engine.importUser(await f.text()); toast("Copia restaurada"); closeSheet(); loadSummary(); render(); }
    catch (err) { toast(err.message); }
  };
}

// ---------- cuenta en la nube (Supabase): nombre + contraseña, tus datos en cualquier móvil o en la web ----------
// Ver supabase/cuentas.sql. La contraseña nunca sale del móvil: se envía una clave derivada (PBKDF2) que allí se guarda con bcrypt.
const CLOUD_ERR = { USER_TAKEN: "Ese nombre ya está cogido", BAD_LOGIN: "Nombre o contraseña incorrectos",
  TOO_BIG: "Tus datos son demasiado grandes para la nube (más de 5 MB)", BAD_PASSWORD: "Contraseña no válida" };
const Cloud = (() => {
  const cfg = window.GM_SUPABASE || {};
  const ready = !!(cfg.url && cfg.key);
  // armed: hasta sincronizar al abrir, los guardados internos del arranque (avisos del día…) no cuentan como cambios tuyos.
  let session = null, timer = 0, pulling = false, armed = false;
  try { session = JSON.parse(localStorage.getItem("cloud") || "null"); } catch { /* sin almacenamiento */ }
  const persist = () => { try { session ? localStorage.setItem("cloud", JSON.stringify(session)) : localStorage.removeItem("cloud"); } catch { /* */ } };
  const rpc = async (fn, body) => {
    const headers = { apikey: cfg.key, "Content-Type": "application/json" };
    if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`;  // clave "anon" antigua (JWT)
    const r = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) {
      let m = text;
      try { m = JSON.parse(text).message; } catch { /* texto plano */ }
      throw new Error(CLOUD_ERR[m] || m || `Error ${r.status}`);
    }
    return text ? JSON.parse(text) : null;
  };
  const load = () => rpc("gm_load", { p_user: session.user, p_pass: session.key }).then((rows) => rows?.[0] || null);
  const push = async () => {
    if (!session) return;
    clearTimeout(timer);
    session.synced = await rpc("gm_save", { p_user: session.user, p_pass: session.key, p_data: JSON.parse(Engine.exportUser()) });
    session.dirty = false;
    persist();
  };
  const apply = async (data) => { pulling = true; try { await Engine.importUser(JSON.stringify(data)); } finally { pulling = false; } };
  Engine.onSave = () => {
    if (!session || pulling || !armed) return;
    session.dirty = true;
    persist();
    clearTimeout(timer);
    timer = setTimeout(() => push().catch((e) => toast(`☁️ No se ha podido guardar en la nube: ${e.message}`)), 3000);
  };
  return {
    ready, push, apply,
    get user() { return session?.user || null; },
    async login(user, pass, create) {
      user = user.trim().toLowerCase();
      if (!/^[a-z0-9_.-]{3,30}$/.test(user)) throw new Error("El nombre: de 3 a 30 letras o números, sin espacios");
      if (pass.length < 6) throw new Error("La contraseña necesita al menos 6 caracteres");
      const key = await hashPassword(pass, `gathering-market:${user}`);
      if (create) await rpc("gm_signup", { p_user: user, p_pass: key });
      session = { user, key, synced: null, dirty: false };
      const row = await load().catch((e) => { session = null; throw e; });
      if (!row) { session = null; throw new Error(CLOUD_ERR.BAD_LOGIN); }
      session.synced = row.updated_at;
      persist();
      armed = true;
      return row;
    },
    logout() { clearTimeout(timer); session = null; persist(); },
    /** Al abrir la app: baja lo guardado desde otro móvil o sube lo que cambió aquí sin conexión. */
    async sync() {
      if (!ready || !session) { armed = true; return null; }
      const row = await load();
      armed = true;
      if (!row) { session = null; persist(); toast("Tu sesión en la nube ha caducado: vuelve a entrar desde el perfil"); return null; }
      const localCards = (await api("/api/collections")).reduce((n, b) => n + b.cards, 0);
      const remoteCards = Object.values(row.data?.cards || {}).reduce((n, b) => n + Object.values(b).reduce((a, q) => a + q, 0), 0);
      // Nunca se sube un móvil vacío por encima de una cuenta con cartas.
      const remoteNewer = row.data && (Date.parse(row.updated_at) > Date.parse(session.synced || 0) || (!localCards && remoteCards));
      if (remoteNewer && (!session.dirty || confirm(t("Has cambiado cosas en este móvil y en otro. ¿Quedarte con lo de la nube? (Cancelar = quedarte con lo de este móvil)")))) {
        await apply(row.data);
        session.synced = row.updated_at; session.dirty = false; persist();
        return "pulled";
      }
      if (session.dirty || !row.data || remoteNewer) await push();
      return "pushed";
    },
  };
})();

// Pantalla de bloqueo si el perfil tiene contraseña.
async function unlock() {
  const p = await api("/api/profile");
  if (!p.hash) return;
  await new Promise((done) => {
    // Un <form>: Intro envía, y el navegador (y los gestores de contraseñas) lo tratan como un inicio de sesión normal.
    document.body.insertAdjacentHTML("beforeend", `<div class="lock-screen" id="lock">
      <svg class="crest" viewBox="0 0 64 64"><use href="#i-crest"/></svg>
      <h3>${esc(p.name ? `Hola, ${p.name}` : "Gathering Market")}</h3>
      <form id="lock-form" class="lock-form" autocomplete="on">
        <input type="text" name="username" autocomplete="username" value="${esc(p.name || "")}" hidden>
        <div class="lock-row"><input class="search" id="lock-pass" name="password" type="password" autocomplete="current-password" placeholder="Contraseña" autofocus>
          <button type="button" class="btn" id="lock-eye" aria-label="Mostrar la contraseña">👁</button></div>
        <button type="submit" class="btn primary block" id="lock-ok">Entrar</button>
      </form>
      <div class="sub" id="lock-msg"></div>
      ${Cloud.ready ? `<button class="btn" id="lock-cloud" style="margin-top:6px">¿No puedes entrar? Usa tu cuenta de la nube</button>` : ""}</div>`);
    const input = $("#lock-pass");
    const focus = () => { if (document.activeElement !== input) input.focus({ preventScroll: true }); };
    // Tocar en cualquier parte de la pantalla devuelve el foco al campo (si el navegador no lo había puesto).
    $("#lock").addEventListener("pointerup", (e) => { if (!e.target.closest("button, input")) focus(); });
    setTimeout(focus, 50); setTimeout(focus, 400);
    $("#lock-eye").onclick = () => { input.type = input.type === "password" ? "text" : "password"; focus(); };
    $("#lock-form").onsubmit = async (e) => {
      e.preventDefault();
      if (!input.value) { $("#lock-msg").textContent = t("Escribe tu contraseña"); focus(); return; }
      if ((await hashPassword(input.value, p.salt)) === p.hash) { $("#lock").remove(); done(); }
      else { $("#lock-msg").textContent = t("Contraseña incorrecta"); input.select(); }
    };
    // Recuperar el acceso con la cuenta de la nube: si nombre y contraseña son correctos, se quita el bloqueo de este móvil.
    $("#lock-cloud")?.addEventListener("click", () => {
      $("#lock-form").innerHTML = `<input class="search" id="lc-user" autocomplete="username" autocapitalize="none" placeholder="Nombre de usuario">
        <input class="search" id="lc-pass" type="password" autocomplete="current-password" placeholder="Contraseña de la cuenta" style="margin-top:8px">
        <button type="submit" class="btn primary block" style="margin-top:8px">Entrar con la cuenta</button>`;
      $("#lock-cloud").remove();
      $("#lc-user").focus();
      $("#lock-form").onsubmit = async (e) => {
        e.preventDefault();
        try {
          await Cloud.login($("#lc-user").value, $("#lc-pass").value, false);
          await api("/api/profile", { clearPassword: true });
          toast("Bloqueo quitado: pon una contraseña nueva en tu perfil si quieres");
          $("#lock").remove(); done();
        } catch (err) { $("#lock-msg").textContent = err.message; }
      };
    });
  });
}

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
    await unlock();
  } catch (err) {
    v.innerHTML = `<div class="empty"><strong>No he podido abrir los datos</strong>${esc(err.message)}
      <div class="row-btns"><button class="btn primary" onclick="boot()">Reintentar</button></div></div>`;
    return;
  }
  loadSummary();
  render();
  checkAlertDot();
  Cloud.sync().then((r) => { if (r === "pulled") { cid = 1; store("cid", "1"); loadSummary(); render(); toast("☁️ Datos actualizados desde tu cuenta"); } })
    .catch(() => toast("☁️ Sin conexión con la nube: se guardará cuando vuelva"));
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
