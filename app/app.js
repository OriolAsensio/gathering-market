"use strict";

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (v) => (v == null ? "—" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
const pct = (v) => `${v > 0 ? "+" : ""}${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`;
// Iconos propios (app/icons/*.png, pintados con el color del tema).
// Iconos: los de línea del sprite de index.html (SVG) o las máscaras PNG de Flaticon (app/icons). Nada de emojis.
const SVG_ICONS = new Set(["crest", "camera", "cards", "tome", "swords", "scales", "horn", "heart", "clock", "file", "list", "select", "check", "close", "trash", "hammer", "scroll", "cart", "palette", "dice", "image", "link", "edit", "mask", "mug", "scale", "target", "globe", "sparkle", "bolt", "warn", "book", "save", "crown", "search", "calendar", "medal", "cloud", "bell", "lock", "eye", "export", "refresh", "skull", "sword", "gear", "reset", "shuffle", "sound", "mute", "coin", "cam", "torch", "fire", "undo", "plus2", "chart"]);
const ico = (name) => (SVG_ICONS.has(name) ? `<svg class="ico svg" aria-hidden="true"><use href="#i-${name}"/></svg>` : `<i class="ico ico-${name}" aria-hidden="true"></i>`);
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
  // Una sola carpeta: tu colección. Las carpetas antiguas (si las había) se pueden seguir abriendo o borrar.
  $("#top-label").textContent = s.collection_id === 1 ? "Valor de mis cartas" : s.collection;
  api("/api/collections").then((l) => $("#top-label").classList.toggle("multi", l.length > 1));
  $("#top-value").textContent = euro(s.value);
  let sub = `${plural(s.cards, "carta", "cartas")} · Cardmarket, ${new Date(s.day).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`;
  if (s.prev_value != null && s.value != null && s.cards) {
    const d = s.value - s.prev_value;
    sub = `<span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${euro(Math.abs(d))} desde ayer</span> · ${sub}`;
  }
  $("#top-sub").innerHTML = `${sub} · <span class="link">${ico("chart")}Ver evolución</span>`;
  return s;
}

// ---------- elegir colección (la mía, la de un amigo...) ----------
async function collectionsSheet() {
  const list = await api("/api/collections");
  const body = openSheet(`
    <h3>Carpetas antiguas</h3>
    <div class="hint">Ahora solo hay una carpeta: tu colección. Estas son de antes; puedes abrirlas o borrarlas.</div>
    <div class="list">${list.map((c) => `
      <div class="item ${c.id === cid ? "on" : ""}" data-cid="${c.id}">
        <div class="item-main"><div class="item-title">${c.id === cid ? ico("check") : ""}${esc(c.name)}</div>
          <div class="item-meta">${plural(c.cards, "carta", "cartas")}</div></div>
        ${c.id !== 1 ? `<button class="btn" data-del="${c.id}" aria-label="Borrar ${esc(c.name)}">${ico("trash")}</button>` : ""}
      </div>`).join("")}</div>`);
  const use = (id) => { cid = id; store("cid", String(id)); closeSheet(); refresh(); };
  body.querySelectorAll("[data-cid]").forEach((el) => (el.onclick = (e) => { if (!e.target.closest("[data-del]")) use(+el.dataset.cid); }));
  body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    const c = list.find((x) => x.id === +b.dataset.del);
    if (!confirm(t(`¿Borrar "${c.name}" y sus ${c.cards} cartas? No se puede deshacer.`))) return;
    await api("/api/collections", { delete: c.id });
    if (cid === c.id) use(1); else collectionsSheet();
  }));
}
// Tocar el valor: cómo ha cambiado el valor de tu colección día a día
$("#top-value").onclick = $("#top-sub").onclick = async () => {
  const body = openSheet(`<h3>Valor de tu colección</h3><div class="hint">Cuánto valen tus cartas cada día (precios de Cardmarket, sin proxies, según el idioma de cada carta).</div><div id="value-chart"></div>`);
  priceChart($("#value-chart", body), { data: await api("/api/valuehistory") });
};
$("#top-label").onclick = async () => { if ((await api("/api/collections")).length > 1) collectionsSheet(); };

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
    try { if (navigator.share) return await navigator.share({ title: "Gather in One", text: t("Precios, colecciones y mazos de Magic"), url }); }
    catch (e) { if (/abort|cancel/i.test(String(e?.name || e))) return; }
    copy(url, t("Enlace copiado: pásaselo a quien quieras"));
  };
}
$("#lang-btn").onclick = () => {
  const body = openSheet(`<h3>Idioma · Language · Idioma</h3><div class="list">${Object.entries(LANGS).map(([k, n]) => `
    <button class="item ${k === LANG ? "on" : ""}" data-lang="${k}"><div class="item-main"><div class="item-title">${k === LANG ? ico("check") : ""}${n}</div></div></button>`).join("")}</div>`);
  body.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => { store("lang", b.dataset.lang); location.reload(); }));
};

// ---------- importar (ManaBox, Moxfield, Deckbox, lista de texto) ----------
function importSheet() {
  const body = openSheet(`
    <h3>Importar cartas</h3>
    <div class="hint">Exporta tus cartas como <b>CSV</b> desde tu otra app (ManaBox, Moxfield, Deckbox, Dragon Shield, TCGplayer, Archidekt, MTGGoldfish, Delver Lens…) y elige el archivo aquí: se respetan la edición, el número y el foil. También vale una lista de texto tipo <code>4 Lightning Bolt</code>.</div>
    <label class="btn block" for="import-file">${ico("file")}Elegir archivo (.csv o .txt)</label>
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
    const buf = await f.arrayBuffer();
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("windows-1252").decode(buf); }
    $("#import-text", body).value = "";
    $("#import-text", body).placeholder = `${f.name} · ${text.split("\n").length - 1} líneas`;
  };
  $("#import-ok", body).onclick = async () => {
    const src = $("#import-text", body).value.trim() || text;
    if (!src) return toast("Elige un archivo o pega una lista");
    if (mode === "replace" && !confirm(t("Se borrarán las cartas que hay ahora en esta carpeta. ¿Seguir?"))) return;
    const btn = $("#import-ok", body);
    btn.disabled = true;
    btn.textContent = "Importando…";
    try {
      const r = await api("/api/import", { text: src, mode });
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
    ${c.qty ? `<span class="badge full">×${c.qty}</span>` : ""}<span class="check" aria-hidden="true">${ico("check")}</span>${extra}
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
  // Ruido filtrado (golpes, barajar, deslizar): para la mesa de juego y el contador de vidas
  const noise = (dur = 0.15, freq = 1200, vol = 0.18, q = 1) => {
    if (store("sounds") === "0") return;
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume?.();
      const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
      src.connect(f).connect(g).connect(ctx.destination); src.start();
    } catch { /* sin audio */ }
  };
  return {
    play, noise, arp,
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
    setTimeout(() => toast(`¡Colección completa: ${r.completed.join(", ")}!`), 50);
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

// ---------- compartir un mazo: imagen (las cartas con sus copias) o enlace (la web abre la lista para guardarla) ----------
const WEB_URL = "https://oriolasensio.github.io/gathering-market/";
async function deckLink(d, main, side) {
  const text = [d.archetype, ...main.map((c) => `${c.qty} ${c.name}`), ...(side.length ? ["Sideboard", ...side.map((c) => `${c.qty} ${c.name}`)] : [])].join("\n");
  let bytes = new TextEncoder().encode(text), z = "t";
  try {  // comprimido, para que el enlace sea corto
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); z = "z";
  } catch { /* navegador sin compresión: sin comprimir */ }
  let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `${WEB_URL}?deck=${z}${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
async function openDeckLink() {
  const q = new URLSearchParams(location.search).get("deck");
  if (!q) return false;
  history.replaceState(null, "", location.pathname + location.hash);
  try {
    const bin = atob(q.slice(1).replace(/-/g, "+").replace(/_/g, "/"));
    let bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    if (q[0] === "z") bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    const [name, ...lines] = new TextDecoder().decode(bytes).split("\n");
    importDeckSheet();
    $("#dk-name").value = name;
    $("#dk-text").value = lines.join("\n");
    toast("Te han pasado un mazo: guárdalo en Mis mazos");
    return true;
  } catch { toast("Ese enlace de mazo no se puede leer"); return false; }
}
async function shareDeckImage(d, main, side) {
  toast("Preparando la imagen…");
  const W = 146, H = 204, COLS = 6, PAD = 10, list = main.filter((c) => c.image);
  const rows = Math.ceil(list.length / COLS), cv = document.createElement("canvas");
  cv.width = COLS * (W + PAD) + PAD; cv.height = 70 + rows * (H + PAD) + 40;
  const g = cv.getContext("2d");
  g.fillStyle = "#16110c"; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#d6a84e"; g.font = "bold 28px Georgia, serif"; g.fillText(d.archetype, PAD, 42);
  g.font = "16px Georgia, serif"; g.fillStyle = "#bfae90";
  g.fillText(`${main.reduce((a, c) => a + c.qty, 0)} cartas${side.length ? ` · banquillo ${side.reduce((a, c) => a + c.qty, 0)}` : ""} · Gather in One`, PAD, 62);
  const load = (src) => new Promise((ok) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
  const imgs = await Promise.all(list.map((c) => load(c.image)));
  list.forEach((c, i) => {
    const x = PAD + (i % COLS) * (W + PAD), y = 70 + Math.floor(i / COLS) * (H + PAD);
    if (imgs[i]) g.drawImage(imgs[i], x, y, W, H); else { g.fillStyle = "#2a2118"; g.fillRect(x, y, W, H); }
    g.fillStyle = "rgba(0,0,0,.75)"; g.beginPath(); g.arc(x + 20, y + 22, 16, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.font = "bold 18px sans-serif"; g.textAlign = "center"; g.fillText(`${c.qty}`, x + 20, y + 28); g.textAlign = "left";
  });
  g.fillStyle = "#8a7a60"; g.font = "13px sans-serif"; g.fillText(WEB_URL, PAD, cv.height - 14);
  let blob;
  try { blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.88)); } catch { blob = null; }
  if (!blob) return toast("No he podido preparar la imagen");
  const name = `${d.archetype.replace(/[^\w\- ]+/g, "").trim() || "mazo"}.jpg`;
  const N = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
  try {
    if (N?.Filesystem && N?.Share) {
      const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
      const w = await N.Filesystem.writeFile({ path: name, data: b64, directory: "CACHE" });
      return await N.Share.share({ title: d.archetype, files: [w.uri], dialogTitle: d.archetype });
    }
    const file = new File([blob], name, { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: d.archetype });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    if (!/cancel|abort/i.test(String(e?.message || e?.name || e))) toast(e.message || String(e));
  }
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
  document.body.classList.toggle("immersive", tab === "life");  // sin la cabecera del valor de tus cartas
  if (tab !== "life") store("lastTab", tab);
  if (tab !== "life") document.querySelector(".lf-table")?.remove();  // al salir (botón atrás de Android): fuera la mesa
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
    <button class="btn block" id="col-added" style="margin-top:8px">${ico("clock")}Últimas añadidas</button>
    <div class="row-btns" style="margin-top:8px"><button class="btn" id="col-dups">${ico("list")}Repetidas</button><button class="btn" id="col-stats">${ico("calendar")}Por meses</button></div>
    <h2>Cartas</h2>
    <input class="search" id="col-filter" placeholder="Filtrar o buscar carta para añadir…" value="${esc(state.collectionFilter)}">
    <div class="seg" id="col-kind" style="margin-top:8px"><button data-k="all">Todas</button><button data-k="real">Sin proxies</button><button data-k="proxy">Proxies</button><button data-k="alter">${ico("alter")}Alteradas</button></div>
    ${sortSelect("col-sort", store("colSort") || "price", CARD_SORTS.filter(([k]) => k !== "set" && k !== "name"))}<div id="col-pips"></div>
    <div class="seg" id="col-view" style="margin-top:8px"><button data-v="grid">${ico("picture")}Imágenes</button><button data-v="list">${ico("list")}Lista</button><button data-v="select">${ico("select")}Seleccionar</button></div>
    <div id="col-list">${skeleton()}</div>`;
  document.body.insertAdjacentHTML("beforeend", `<div class="sel-bar floating" id="col-bar" hidden>
    <span class="sub" id="col-count"></span><button class="btn" id="col-cancel">Cancelar</button><button class="btn" id="col-del" aria-label="Quitar las elegidas">${ico("trash")}Quitar</button><button class="btn primary" id="col-go">${ico("hammer")}Crear mazo</button></div>`);
  $("#col-import").onclick = importSheet;
  $("#col-build").onclick = () => builderSheet();
  $("#col-added").onclick = addedSheet;
  $("#col-dups").onclick = duplicatesSheet;
  $("#col-stats").onclick = statsSheet;
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
    const by = store("colSort") === "name" ? "price" : store("colSort") || "price", pip = by === "color" ? store("colPip") : "";
    $("#col-pips").innerHTML = by === "color" ? colorPips("col-pip", pip) : "";
    v.querySelectorAll("#col-pip button").forEach((b) => (b.onclick = () => { store("colPip", pip === b.dataset.pip ? "" : b.dataset.pip); draw(); }));
    const page = sortCards(shown.filter((c) => pipOk(c, pip)), by).slice(0, limit);
    const list = mode === "grid" ? `<div class="grid">${page.map((c) => tile(c, (c.foil || c.alter || c.lang !== "en" ? `<span class="num-tag">${[c.lang !== "en" ? esc(c.lang.toUpperCase()) : "", c.foil ? "Foil" : "", c.alter ? ico("alter") : ""].filter(Boolean).join(" ")}</span>` : "")
      + (c.proxy ? `<span class="proxy-tag">PROXY${c.proxy < c.qty ? ` ×${c.proxy}` : ""}</span>` : ""))).join("")}</div>`
      : `<div class="list">${page.map((c) => `
      <button class="item" data-row="${esc(c.key)}">
        <img class="thumb" loading="lazy" src="${esc(c.image)}" alt="">
        <div class="item-main">
          <div class="item-title">${esc(c.name)}</div>
          <div class="item-meta"><i class="r r-${esc(c.rarity)}"></i>${esc(c.set.toUpperCase())} #${esc(c.number)}
            ${c.lang && c.lang !== "en" ? `<span class="chip">${esc(c.lang.toUpperCase())}</span>` : ""}${c.foil ? '<span class="chip foil">Foil</span>' : ""}${c.alter ? `<span class="chip gold">${ico("alter")}${esc(c.alter.name)}</span>` : ""}${c.proxy ? `<span class="chip">Proxy ×${c.proxy}</span>` : ""}
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
  $("#col-sort").onchange = (e) => { store("colSort", e.target.value); draw(); };
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
// Idiomas en los que puede estar una carta (el precio se ajusta un poco según el idioma)
const CARD_LANG_NAMES = { en: "Inglés", es: "Español", fr: "Francés", de: "Alemán", it: "Italiano", pt: "Portugués", ja: "Japonés", ko: "Coreano", ru: "Ruso", zhs: "Chino simplificado", zht: "Chino tradicional" };

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
    <div id="price-chart"></div>
    ${c.decks.length ? `<h2>La juegan en Pauper</h2><div class="item-meta">${c.decks.map((d) => `<span class="chip gold">${esc(d)}</span>`).join("")}</div>` : ""}
    ${/land/i.test(c.type || "") ? "" : `<button class="btn block" id="build-from" style="margin-top:12px">${ico("plus")}Crear un mazo con esta carta${/legendary.*creature/i.test(c.type || "") ? " (o de Commander)" : ""}</button>`}
    <button class="btn block" id="open-set" style="margin-top:8px">${ico("scroll")}Ver la colección ${esc(c.set_name)}</button>
    <button class="btn block" id="follow" style="margin-top:8px">${ico("follow")}Seguir su precio en Mercado</button>
    <button class="btn block" id="open-syn" style="margin-top:8px">${ico("synergy")}Cartas que combinan con esta</button>
    <a class="btn block" style="margin-top:8px;text-decoration:none" target="_blank" rel="noopener"
       href="${cardmarketUrl(c.name)}">${ico("cart")}Ver en Cardmarket</a>
    <h2>Tus versiones</h2><div class="list" id="versions">${skeleton(1)}</div>
    <button class="btn block primary" id="add-version" style="margin-top:10px">${ico("plus")}Añadir otro arte o foil</button>`);
  $("#build-from", body)?.addEventListener("click", () => pickSeed([c.name], /legendary.*creature/i.test(c.type || "") ? "commander" : null));
  $("#open-set", body).onclick = () => setSheet(c.set);
  priceChart($("#price-chart", body), { id: c.id });
  $("#open-syn", body).onclick = () => synergySheet(c.name);
  followButton(body, c.name);
  $("#add-version", body).onclick = () => addSheet([{ name: c.name }]);
  const drawVersions = async () => {
    const mine = (await api("/api/collection")).filter((x) => x.name === c.name);
    $("#versions", body).innerHTML = mine.map((x) => `<div class="item version">
        <img class="thumb" loading="lazy" src="${esc(x.image)}" alt="">
        <div class="item-main"><div class="item-title">${esc(x.set_name)} #${esc(x.number)}</div>
          <div class="item-meta">${x.foil ? '<span class="chip foil">Foil</span>' : ""}${euro(x.eur)}${x.lang !== "en" ? ` · ≈ ${euro(x.eur_lang)} en ${esc(x.lang_name.toLowerCase())}` : ""}</div>
          <div class="item-meta"><label class="sub" for="lang-${esc(x.id)}-${x.foil ? 1 : 0}">Idioma</label>
            <select class="lang-sel" id="lang-${esc(x.id)}-${x.foil ? 1 : 0}" data-lid="${esc(x.id)}" data-f="${x.foil ? 1 : 0}">${Object.entries(CARD_LANG_NAMES).map(([k, n]) => `<option value="${k}" ${k === x.lang ? "selected" : ""}>${n}</option>`).join("")}</select></div>
          <div class="item-meta proxy-row"><span class="sub">Proxies</span><button class="mini" data-px="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="-1" ${x.proxy ? "" : "disabled"}>−</button><b>${x.proxy || 0}</b><button class="mini" data-px="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="1" ${x.proxy < x.qty ? "" : "disabled"}>+</button>${x.proxy ? `<span class="sub">(no suman valor; solo para Casual${x.proxy_collect ? "" : "; no cuentan para la colección"})</span>` : ""}</div>
          ${x.alter ? `<div class="item-meta"><span class="chip gold">${ico("alter")}${esc(x.alter.name)} ×${x.alter.qty}</span> ~${euro(x.alter.estimate[0])}–${euro(x.alter.estimate[1])}${x.alter.note ? ` · ${esc(x.alter.note)}` : ""}</div>` : ""}
          <button class="btn alter-btn" data-alter="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-q="${x.qty}">${ico("alter")}${x.alter ? "Cambiar alteración" : "¿Firmada o con arte propio?"}</button></div>
        <div class="stepper"><button data-v="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="-1" aria-label="Quitar una">−</button><b class="num">${x.qty}</b>
          <button data-v="${esc(x.id)}" data-f="${x.foil ? 1 : 0}" data-d="1" aria-label="Añadir otra">+</button></div>
      </div>`).join("") || `<div class="hint">Ya no tienes ninguna.</div>`;
    body.querySelectorAll("#versions [data-px]").forEach((b) => (b.onclick = async () => {
      const row = mine.find((x) => x.id === b.dataset.px && x.foil === (b.dataset.f === "1"));
      const first = +b.dataset.d > 0 && !row?.proxy;  // al marcar el primer proxy, se pregunta si cuenta para la colección
      await api("/api/proxy", { card_id: b.dataset.px, foil: b.dataset.f === "1", delta: +b.dataset.d, ...(first ? { collect: confirm(t("¿Quieres que este proxy cuente para la colección? (completar colecciones y número de cartas). Aceptar = sí, Cancelar = no")) } : {}) });
      closeSheet.dirty = true; drawVersions(); loadSummary();
    }));
    body.querySelectorAll("#versions [data-lid]").forEach((s) => (s.onchange = async () => {
      await api("/api/lang", { card_id: s.dataset.lid, foil: s.dataset.f === "1", lang: s.value });
      toast("Idioma guardado");
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
    box.innerHTML = `<div class="seg" id="al-kind"><button data-k="firma">${ico("alter")}Firmada</button><button data-k="arte">${ico("palette")}Arte propio</button><button data-k="ambas">Las dos</button></div>
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
  let ci = 0, qty = 1, foil = false, proxy = false, lang = store("addLang") || "en";  // idioma: se recuerda el último
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
      <div class="field" style="flex-direction:row;align-items:center;gap:8px"><label for="add-lang">Idioma de la carta</label>
        <select class="lang-sel" id="add-lang">${Object.entries(CARD_LANG_NAMES).map(([k, n]) => `<option value="${k}" ${k === lang ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="stats"><div class="stat"><b>${euro(foil ? p.eur_foil : p.eur)}</b><span>Precio unidad</span></div>
        <div class="stat"><b>${euro((foil ? p.eur_foil : p.eur) * qty || null)}</b><span>Total</span></div>
        <div class="stat"><b>${p.pauper === "legal" ? "Sí" : p.pauper === "banned" ? "Ban" : "No"}</b><span>Legal Pauper</span></div></div>
      ${added.length ? `<div class="warn">${ico("check")}Añadidas: ${added.map(esc).join(" · ")}<br>Elige otro arte o foil y vuelve a pulsar Añadir, o pulsa Listo.</div>` : ""}
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
    $("#add-lang", body).onchange = (e) => { lang = e.target.value; store("addLang", lang); };
    body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { qty = Math.max(1, qty + +b.dataset.q); draw(); }));
    $("#add-ok", body).onclick = async () => {
      const r = await api("/api/collection", { card_id: p.id, foil, qty });
      await api("/api/lang", { card_id: p.id, foil, lang });
      if (proxy) await api("/api/proxy", { card_id: p.id, foil, delta: qty, collect: confirm(t("¿Quieres que este proxy cuente para la colección? (completar colecciones y número de cartas). Aceptar = sí, Cancelar = no")) });
      toast(`${qty}× ${c.name} añadida${proxy ? " (proxy)" : ""}`);
      if (!proxy) celebrate(r);
      loadSummary();
      if (opts.onDone) { opts.onDone(); refresh(); return; }
      added.push(`${qty}× ${p.set.toUpperCase()} #${p.number}${foil ? " foil" : ""}${lang !== "en" ? ` (${lang.toUpperCase()})` : ""}`);
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
    <div class="deck-head"><span class="deck-name">${esc(d.archetype)}</span>${d.share != null ? `<span class="share">${d.share}%</span>` : ""}${d.test ? `<span class="share">${d.games ? `${d.wins}/${d.games} ganadas` : "sin jugar"}</span>` : ""}</div>
    <div class="item-meta"><span class="chip">${esc(d.category)}</span>${euro(d.price)} el mazo
      ${d.result ? `· ${d.result === "1" ? `${ico("trophy")}Ganadora` : `${esc(d.result)}º`}${d.event ? ` en ${esc(d.event)}` : ""}` : ""}</div>
    <div class="thumbs">${d.thumbs.filter(Boolean).map((src) => `<img loading="lazy" src="${esc(src)}" alt="">`).join("")}</div>
    <div class="bar"><i style="width:${d.owned_pct}%"></i></div>
    <div class="deck-foot"><span>Tienes el ${d.owned_pct}%</span><span>${d.missing_cost ? `Te faltan ${euro(d.missing_cost)}` : "¡Lo puedes montar!"}</span></div>
  </button>`;

const META_FORMATS = { PAU: "Pauper", ST: "Estándar", MO: "Modern", PI: "Pioneer", LE: "Legacy", VI: "Vintage", PREM: "Premodern",
  PEA: "Peasant", DC: "Duel Commander", cEDH: "cEDH", HIGH: "Highlander", CHL: "Canadian Highlander", EXP: "Explorer", HI: "Historic",
  VV: "Value Vintage", DAN: "Dandân" };
// Formatos sin meta de torneo: mazos de ejemplo (y sus normas)
const EXAMPLE_FORMATS = {
  VV: "Value Vintage: cartas de Vintage, pero el mazo entero (con banquillo) cuesta como máximo 30 $. Formato de la comunidad (vvmtg.com), sin meta publicado: aquí tienes listas de ejemplo.",
  DAN: "Dandân (Forgetful Fish): los dos jugadores comparten un único mazo de 80 cartas, la biblioteca y el cementerio. Es más un juego de mesa dentro de Magic, para partidas rápidas: estos son los mazos que se usan.",
};
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
    <div class="field"><label for="deck-tab">Ver mazos</label><div class="deck-pick"><span id="deck-tab-ico"></span><select class="search deck-select" id="deck-tab"></select></div></div>
    <div id="deck-body">${skeleton(5)}</div>`;
  $("#deck-build").onclick = () => builderSheet();
  $("#deck-import").onclick = importDeckSheet;
  let [mine, decks] = await Promise.all([api("/api/mydecks"), api("/api/decks")]);
  const formats = Object.keys(META_FORMATS);
  let tab = store("deckTab") || "PAU";
  if (tab !== "mine" && tab !== "test" && !formats.includes(tab)) tab = "PAU";
  const tests = mine.filter((d) => d.test);
  mine = mine.filter((d) => !d.test);
  const count = (f) => decks.filter((d) => d.format === f).length;
  $("#deck-tab").innerHTML = `<option value="mine">Mis mazos (${mine.length})</option><option value="test">Mazos para probar (${tests.length})</option>
    ${formats.map((f) => `<option value="${f}">${EXAMPLE_FORMATS[f] ? "Ejemplos de" : "Meta de"} ${META_FORMATS[f]}${count(f) ? ` (${count(f)})` : ""}</option>`).join("")}`;
  const sorters = { meta: (a, b) => b.share - a.share, owned: (a, b) => b.owned_pct - a.owned_pct, cheap: (a, b) => a.price - b.price, missing: (a, b) => a.missing_cost - b.missing_cost };
  const bind = (root) => root.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => deckSheet(b.dataset.id)));
  const draw = () => {
    $("#deck-tab").value = tab;
    $("#deck-tab-ico").innerHTML = ico(tab === "mine" ? "folder" : tab === "test" ? "trophy" : "meta");
    if (tab === "test") {
      $("#deck-body").innerHTML = `<div class="hint">Mazos hechos con el constructor para Pauper, Estándar o Commander (sin proxies). Juégalos (p. ej. en Endstep) y apunta cuántas partidas ganas: el constructor aprende de los resultados y de tus opiniones.</div>
        ${tests.length ? `<div class="list">${tests.map(deckCard).join("")}</div>` : `<div class="empty"><strong>Aún no hay mazos para probar</strong>Crea uno con el constructor (formato Pauper, Estándar o Commander) y pulsa Guardar.</div>`}`;
      return bind($("#deck-body"));
    }
    const body = $("#deck-body");
    if (tab === "mine") {
      body.innerHTML = `<div class="hint">Tus mazos importados, guardados del meta o creados con el constructor. Ábrelo y toca las cartas que ya tienes.</div>
        ${mine.length ? `<div class="list">${mine.map(deckCard).join("")}</div>` : `<div class="empty"><strong>Aún no tienes mazos</strong>Importa tu lista arriba, crea uno con el constructor o guarda uno del meta.</div>`}`;
      return bind(body);
    }
    // Pauper: el meta o los ganadores de torneos (con el destacado, el Super Pauper de inGenio BCN)
    const metaView = tab === "PAU" ? store("pauView") || "meta" : "meta";
    const viewSeg = tab === "PAU" ? `<div class="seg" id="pau-view"><button data-v="meta" class="${metaView === "meta" ? "on" : ""}">${ico("meta")}Meta</button><button data-v="wins" class="${metaView === "wins" ? "on" : ""}">${ico("trophy")}Ganadores de torneos</button></div>` : "";
    const bindView = () => body.querySelectorAll("#pau-view button").forEach((b) => (b.onclick = () => { store("pauView", b.dataset.v); draw(); }));
    if (metaView === "wins") {
      body.innerHTML = `${viewSeg}<div id="wins">${skeleton(4)}</div>`;
      bindView();
      return winnersView($("#wins", body));
    }
    const list = decks.filter((d) => d.format === tab);
    body.innerHTML = `${viewSeg}<div class="hint">${EXAMPLE_FORMATS[tab] ? EXAMPLE_FORMATS[tab] : tab === "PAU"
      ? `De cada arquetipo, la lista mejor clasificada (la ganadora si la hay) de los últimos 2 meses en MTGTop8. "Weenie White" es el mono blanco (Convoke, Kor Skyfisher…).`
      : `Los arquetipos más jugados de ${META_FORMATS[tab]} en MTGTop8 y, de cada uno, la lista mejor clasificada (la ganadora si la hay).`}</div>
      <div class="seg" id="deck-sort">
        <button data-s="meta">Más jugados</button><button data-s="owned">Puedo montar</button><button data-s="cheap">Más baratos</button><button data-s="missing">Me falta menos €</button>
      </div>
      ${list.length ? `<div class="list">${[...list].sort(sorters[state.deckSort]).map(deckCard).join("")}</div>`
        : `<div class="empty"><strong>Aún no hay datos del meta</strong>Se descargan dos veces al día (los formatos nuevos pueden tardar una vuelta).</div>`}`;
    bindView();
    body.querySelectorAll("#deck-sort button").forEach((b) => {
      b.classList.toggle("on", b.dataset.s === state.deckSort);
      b.onclick = () => { state.deckSort = b.dataset.s; store("deckSort", b.dataset.s); draw(); };
    });
    bind(body);
  };
  $("#deck-tab").onchange = (e) => { tab = e.target.value; store("deckTab", tab); draw(); };
  draw();
};

/* Ganadores de torneos: primero el destacado (Super Pauper de inGenio BCN, top 8 con jugador y lista) y luego los últimos torneos. */
async function winnersView(box) {
  const tours = await api("/api/tournaments");
  if (!tours.length) { box.innerHTML = `<div class="empty"><strong>Aún no hay torneos</strong>Se descargan con el meta, dos veces al día.</div>`; return; }
  const fdate = (d) => (d ? new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "");
  const place = (r) => (r === "1" ? `${ico("trophy")}1º` : `${esc(r)}º`);
  const deckRow = (d) => `<button class="item tour-row" ${d.has_list ? `data-id="${esc(d.id)}"` : "disabled"}>
      <span class="tour-rank ${d.rank === "1" ? "win" : ""}">${place(d.rank)}</span>
      <div class="item-main"><div class="item-title">${esc(d.archetype)}</div><div class="item-meta">${esc(d.player)}${d.has_list ? ` · Tienes el ${d.owned_pct}%` : ""}</div></div>
      ${d.has_list ? `<div class="item-side"><div class="price">${euro(d.price)}</div></div>` : ""}</button>`;
  const recent = tours.filter((t) => !t.featured);
  const SERIES = [[1, "Torneo destacado: Super Pauper", "El Super Pauper de inGenio BCN Games (Barcelona), de MTGTop8. Toca un mazo para ver la lista y qué cartas tienes."],
    [2, "Torneo destacado: Paupergeddon", "El Paupergeddon de Lucca (Italia), el torneo de Pauper más grande del mundo. Toca un mazo para ver la lista."]];
  const tourCard = (t) => `<div class="tour-card featured"><div class="tour-head"><b>${esc(t.name)}</b><span class="sub">${fdate(t.date)}${t.players ? ` · ${t.players} jugadores` : ""}</span></div>
        <div class="list">${t.top.slice(0, 8).map(deckRow).join("")}</div></div>`;
  box.innerHTML = `${SERIES.map(([n, title, hint]) => {
      // La última edición, abierta; las anteriores, en una lista (cada una se abre con su top)
      const ts = tours.filter((t) => t.featured === n).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.id - a.id);
      return ts.length ? `<h2>${ico("trophy")}${title}</h2><div class="hint">${hint}</div>${tourCard(ts[0])}
        ${ts.length > 1 ? `<details class="guide"><summary>Ediciones anteriores (${ts.length - 1})</summary><div class="list">${ts.slice(1).map((t) => `<button class="item tour-open" data-t="${t.id}"><div class="item-main"><div class="item-title">${esc(t.name)}</div>
          <div class="item-meta">${fdate(t.date)}${t.players ? ` · ${t.players} jugadores` : ""}</div>${t.top[0] ? `<div class="item-meta"><span class="chip gold">${ico("trophy")}${esc(t.top[0].archetype)}</span>${esc(t.top[0].player)}</div>` : ""}</div></button>`).join("")}</div></details>` : ""}` : "";
    }).join("")}
    <h2>Últimos torneos</h2><div class="hint">El mazo ganador de los últimos torneos de Pauper en MTGTop8. Toca un torneo para ver su top.</div>
    <div class="list">${recent.map((t) => {
      const w = t.top[0];
      return `<button class="item tour-open" data-t="${t.id}"><div class="item-main"><div class="item-title">${esc(t.name)}</div>
        <div class="item-meta">${esc(t.place)} · ${fdate(t.date)}${t.players ? ` · ${t.players} jugadores` : ""}</div>
        ${w ? `<div class="item-meta"><span class="chip gold">${ico("trophy")}${esc(w.archetype)}</span>${esc(w.player)}</div>` : ""}</div></button>`;
    }).join("")}</div>`;
  box.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => deckSheet(b.dataset.id)));
  box.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => {
    const t = tours.find((x) => x.id === +b.dataset.t);
    const body = openSheet(`<h3>${esc(t.name)}</h3><div class="sub">${esc(t.place)} · ${fdate(t.date)}${t.players ? ` · ${t.players} jugadores` : ""}</div>
      <div class="hint">Del ganador está la lista completa; del resto, el arquetipo y el jugador.</div>
      <div class="list">${t.top.map(deckRow).join("")}</div>`);
    body.querySelectorAll("[data-id]").forEach((x) => (x.onclick = () => deckSheet(x.dataset.id)));
  }));
}

function importDeckSheet() {
  const body = openSheet(`<h3>Importar una lista</h3>
    <div class="hint">Pega la lista (de MTGTop8, Moxfield, Arena…): una carta por línea, <code>4 Lightning Bolt</code>. Lo que vaya tras "Sideboard" cuenta como banquillo.</div>
    <div class="field"><label>Nombre del mazo</label><input class="search" id="dk-name" placeholder="Ej.: Mi Mono White Convoke"></div>
    <div class="field"><label>Lista</label><textarea class="search" id="dk-text" rows="8" placeholder="4 Kor Skyfisher&#10;4 Battle Screech&#10;…&#10;Sideboard&#10;2 Prismatic Strands"></textarea></div>
    <label class="btn block" for="dk-file" style="margin-top:8px">${ico("file")}O elige un archivo .txt</label><input type="file" id="dk-file" accept=".txt,.dec,.dek,text/plain" hidden>
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

// Dónde se jugó una prueba. Endstep, torneo, MTGO y MTGA pesan más al aprender (rivales de verdad); lo casual, menos.
const PLAY_WHERE = ["Endstep", "En un torneo", "MTGO (Magic Online)", "MTGA (Magic Arena)", "En tu tienda (casual)", "Casual (casa de un amigo, feria…)"];

/* Tras enviar la reseña de un mazo de prueba: sale de "Mazos para probar" y eliges qué hacer con él.
 * Guardar → "Mis mazos". Rehacer → el constructor con sus cartas base y el nivel que elijas (más o menos potente); el viejo
 * se borra (sus reseñas se quedan para que el constructor aprenda). Borrar → fuera (también se quedan las reseñas). */
function afterReview(d, id) {
  const b = d.built || {}, lvl = +b.power || 3;
  const body = openSheet(`<h3>¿Qué hacemos con ${esc(d.archetype)}?</h3>
    <div class="hint">Tu reseña ya está guardada: el creador de mazos aprende de ella aunque borres el mazo.</div>
    <button class="btn block primary" id="ar-keep">${ico("folder")}Me gusta: guardarlo en Mis mazos</button>
    ${b.seeds?.length ? `<h2>Rehacer el mazo</h2><div class="hint">Con las mismas cartas base y lo aprendido de tu reseña.</div>
    <div class="row-btns" style="margin-top:0">${lvl > 1 ? `<button class="btn" data-lvl="${lvl - 1}">${ico("down")}Menos potente</button>` : ""}<button class="btn" data-lvl="${lvl}">Igual</button>${lvl < 6 ? `<button class="btn" data-lvl="${lvl + 1}">${ico("up")}Más potente</button>` : ""}</div>` : ""}
    <button class="btn block" id="ar-del" style="margin-top:12px">No me gusta: borrarlo</button>`);
  $("#ar-keep", body).onclick = async () => { await api("/api/mydecks", { keep: id }); store("deckTab", "mine"); toast("Guardado en Mis mazos"); closeSheet(); render(); };
  $("#ar-del", body).onclick = async () => { await api("/api/mydecks", { delete: id }); toast("Mazo borrado (la reseña se queda)"); closeSheet(); render(); };
  body.querySelectorAll("[data-lvl]").forEach((x) => (x.onclick = async () => {
    await api("/api/mydecks", { delete: id });
    store("buildPower", x.dataset.lvl);
    if (b.archetype && !b.style_auto) store("buildStyle", b.archetype);
    builderSheet(b.seeds, b.format || "pauper", { colors: b.colors || null });
  }));
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
    <h3>${esc(d.archetype)}</h3>${d.note ? `<div class="hint">${esc(d.note)}</div>` : ""}
    <div class="sub">${d.example ? `Mazo de ejemplo · ${esc(d.event)}` : d.mine ? esc(d.event) : `${esc(d.player)} · ${d.result === "1" ? `${ico("trophy")}Ganadora` : `${esc(d.result)}º`} en ${esc(d.event)} · ${esc(d.date)}`}</div>
    <div class="stats">
      <div class="stat"><b>${euro(d.price)}</b><span>Precio del mazo</span></div>
      <div class="stat"><b>${d.owned_pct}%</b><span>Lo tienes</span></div>
      <div class="stat"><b>${euro(d.missing_cost)}</b><span>Te falta</span></div>
    </div>
    <div class="seg" id="deck-view"><button data-v="img">Imágenes</button><button data-v="list">Lista</button></div>
    <button class="btn block" id="deck-all" ${missing.length ? "" : "disabled"}>${ico("check")}${missing.length ? "Ya tengo todo el mazo" : "Tienes todas las cartas"}</button>
    <div class="hint" id="deck-hint"></div>
    <div id="deck-cards"></div>
    <div class="row-btns">
      <button class="btn" id="copy-all">Copiar lista</button>
      <button class="btn primary" id="share-missing" ${missing.length ? "" : "disabled"}>Compartir lo que falta</button>
    </div>
    <button class="btn block" id="dk-cm" style="margin-top:8px" ${missing.length ? "" : "disabled"}>${ico("cart")}Comprar lo que falta en Cardmarket</button>
    <h2>Probar el mazo</h2>
    <div class="row-btns"><button class="btn" id="dk-hand">${ico("cards")}Mano de prueba</button><button class="btn" id="dk-prob">${ico("dice")}Probabilidades</button></div>
    <h2>Compartir el mazo</h2>
    <div class="row-btns"><button class="btn" id="dk-img">${ico("image")}Como imagen</button><button class="btn" id="dk-link">${ico("link")}Como enlace</button></div>
    ${d.test ? `<h2>${ico("trophy")}Resultados de las pruebas</h2>
      ${d.built?.level ? `<div class="item-meta">Creado con: <span class="chip gold">${esc(String(d.built.level).replace(/^[^\p{L}]+/u, ""))}</span><span class="chip">${esc(d.built.archetype || "")}</span>${d.built.combo ? '<span class="chip">combo</span>' : ""}</div>` : ""}
      <div class="hint">Juégalo 3 partidas como mínimo (las que quieras) y apunta cuántas has jugado, cuántas has ganado y una frase sobre cómo ha ido el gameplay. El creador de mazos aprende de estas reseñas.</div>
      <div class="field" style="flex-direction:row;gap:8px;align-items:center;flex-wrap:wrap"><span>Jugadas</span>
        <input class="search" type="number" id="tr-games" min="3" max="50" value="3" style="width:70px"><span>Ganadas</span>
        <input class="search" type="number" id="tr-wins" min="0" max="50" value="0" style="width:70px">
        <select class="lang-sel" id="tr-where">${PLAY_WHERE.map((w) => `<option>${w}</option>`).join("")}</select></div>
      <textarea class="search" id="tr-note" rows="6" maxlength="5000" placeholder="Cómo has visto el gameplay: qué funcionó, qué faltó (p. ej. pocas tierras, le falta robo…)"></textarea>
      <button class="btn block primary" id="tr-save" style="margin-top:6px">Guardar resultado</button>
      ${d.results.length ? `<div class="list" style="margin-top:8px">${d.results.map((r) => `<div class="item"><div class="item-main"><div class="item-title">${r.wins}/${r.games} ganadas${r.where ? ` · ${esc(r.where)}` : ""}</div>
        <div class="item-meta">${esc(r.day)}${r.note ? ` · ${esc(r.note)}` : ""}</div></div></div>`).join("")}</div>` : ""}` : ""}
    ${d.mine ? `<button class="btn block" id="deck-edit" style="margin-top:8px">${ico("edit")}Editar la lista</button>` : ""}
    <button class="btn block" id="deck-keep" style="margin-top:8px">${d.mine ? `${ico("trash")}Borrar de Mis mazos` : `${ico("star")}Guardar en Mis mazos`}</button>`;
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
  // Cardmarket: la lista de lo que falta, copiada, y su página de "Wants" para pegarla (Crear lista → Añadir lista de cartas)
  $("#dk-cm", body).onclick = async () => {
    await copy(missing.join("\n"), "Lista copiada: en Cardmarket, crea una lista de Wants y pégala");
    window.open("https://www.cardmarket.com/es/Magic/Wants", "_blank", "noopener");
  };
  $("#dk-hand", body).onclick = () => Play.handSheet(d);
  $("#dk-prob", body).onclick = () => Play.probSheet(d);
  $("#dk-img", body).onclick = () => shareDeckImage(d, main, side);
  $("#dk-link", body).onclick = async () => shareText(d.archetype, `${d.archetype}: ${await deckLink(d, main, side)}`);
  $("#deck-all", body).onclick = async () => {
    const add = [...need.entries()].filter(([, x]) => x.have < x.qty).map(([n, x]) => [n, x.qty - x.have]);
    if (!confirm(t(`¿Añadir a tu carpeta las ${add.reduce((a, [, q]) => a + q, 0)} cartas que faltan?`))) return;
    const r = await api("/api/owncards", { op: "add", cards: add });
    toast(`${plural(r.changed, "carta añadida", "cartas añadidas")}`);
    celebrate(r);
    redraw();
  };
  $("#tr-save", body)?.addEventListener("click", async () => {
    const games = +$("#tr-games", body).value, wins = +$("#tr-wins", body).value, note = $("#tr-note", body).value.trim();
    if (games < 3) return toast("Juega 3 partidas como mínimo");
    if (wins > games) return toast("No puedes ganar más partidas de las jugadas");
    if (note.length < 5) return toast("Escribe una frase sobre cómo ha ido el gameplay");
    await api("/api/mydecks", { result: { id, wins, games, where: $("#tr-where", body).value, note } });
    toast("Resultado guardado");
    afterReview(d, id);
  });
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
// Orden de las cartas (tu carpeta, colecciones que sigues o buscas). "Colección" = el orden en que vienen (número de la edición).
const CARD_SORTS = [["set", "Orden de colección"], ["price", "Precio"], ["name", "Alfabético"], ["type", "Tipo"], ["color", "Color"]];
const TYPE_ORDER = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land"];
const typeRank = (t = "") => { const i = TYPE_ORDER.findIndex((k) => t.includes(k)); return i < 0 ? 99 : i; };
const colorRank = (c = "") => (c.length > 1 ? 5 : c ? "WUBRG".indexOf(c) : 6);  // blanco, azul, negro, rojo, verde, multicolor, incolora
function sortCards(list, by) {
  const name = (a, b) => a.name.localeCompare(b.name);
  const cmp = { price: (a, b) => (b.eur || 0) - (a.eur || 0) || name(a, b), name,
    type: (a, b) => typeRank(a.type) - typeRank(b.type) || name(a, b),
    color: (a, b) => colorRank(a.colors) - colorRank(b.colors) || (a.colors || "").localeCompare(b.colors || "") || name(a, b) }[by];
  return cmp ? [...list].sort(cmp) : list;
}
// Al ordenar por color: los 6 símbolos de maná para quedarte con las cartas de un color (otra vez para quitarlo)
const colorPips = (id, on) => `<div class="seg mana-row" id="${id}" style="margin-top:8px">${COLORS.map(([k, n]) => `<button data-pip="${k}" class="mana ${on === k ? "on" : ""}" aria-label="${n}" title="${n}">${manaIcon(k, n)}</button>`).join("")}</div>`;
const pipOk = (c, k) => !k || (k === "C" ? !c.colors : (c.colors || "").includes(k));
const sortSelect = (id, by, opts = CARD_SORTS) => `<label class="sub" style="display:block;margin-top:8px">Ordenar por <select class="lang-sel" id="${id}">${opts.map(([k, n]) => `<option value="${k}" ${k === by ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
const RARITIES = [["common", "Común"], ["uncommon", "Infrecuente"], ["rare", "Rara"], ["mythic", "Mítica"]];
const year = (d) => (d ? d.slice(0, 4) : "");
const setIcon = (s, cls = "set-icon") => (s.icon ? `<img class="${cls}" src="${esc(s.icon)}" alt="">`
  : `<span class="${cls} set-emoji">${ico(s.code === "reserved" ? "reserved" : "precons")}</span>`);

function setRow(s, withProgress = true) {
  return `<button class="item set-row" data-code="${esc(s.code)}">
    ${setIcon(s)}
    <div class="item-main">
      <div class="item-title">${esc(s.name)}</div>
      ${s.via ? `<div class="item-meta"><span class="chip gold">${ico("cards")}${esc(s.via)}</span></div>` : ""}
      <div class="item-meta">${s.pinned ? `<span class="pin">${ico("pin")}Siguiendo</span>` : ""}<span>${s.code.startsWith("deck:") ? esc(s.type) : s.code === "reserved" ? "" : esc(s.code.toUpperCase())}${s.released ? ` · ${year(s.released)}` : ""} · ${s.total} cartas</span></div>
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
const STAPLE_FORMATS = { PAU: "Pauper", ST: "Estándar", MO: "Modern", PI: "Pioneer", LE: "Legacy", VI: "Vintage", EDH: "Commander",
  PREM: "Premodern", PEA: "Peasant", DC: "Duel Commander", cEDH: "cEDH", HIGH: "Highlander", CHL: "Canadian Highlander", EXP: "Explorer", HI: "Historic" };
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
// Repetidas: lo que te sobra (más de 4 copias, o más de las que usa tu mazo que más lleva) y lo que vale, para vender o cambiar
async function duplicatesSheet() {
  const body = openSheet(`<h3>Repetidas</h3>${skeleton(3)}`);
  const r = await api("/api/duplicates");
  const text = r.items.map((x) => `${x.extra} ${x.name}`).join("\n");
  body.innerHTML = `<h3>Repetidas</h3>
    <div class="hint">Copias de más: por encima de 4 (o de las que usa tu mazo que más lleva). Sin tierras básicas ni proxies. Para vender o cambiar.</div>
    <div class="stats"><div class="stat"><b>${r.copies}</b><span>Copias de más</span></div><div class="stat"><b>${euro(r.value)}</b><span>Valen</span></div></div>
    ${r.items.length ? `<div class="row-btns"><button class="btn" id="dp-copy">${ico("list")}Copiar lista</button><button class="btn primary" id="dp-share">${ico("share")}Compartir</button></div>
      <div class="list">${r.items.map((x) => `<button class="item" data-name="${esc(x.name)}"><img class="thumb" loading="lazy" src="${esc(x.image)}" alt="">
        <div class="item-main"><div class="item-title">${esc(x.name)}</div><div class="item-meta">Tienes ${x.qty}${x.used ? ` · tu mazo usa ${x.used}` : ""} · sobran ${x.extra}</div></div>
        <div class="item-side"><div class="price">${euro(x.value)}</div><div class="sub">${euro(x.eur)} c/u</div></div></button>`).join("")}</div>`
      : `<div class="empty"><strong>No te sobra nada</strong>Ninguna carta pasa de 4 copias (ni de lo que usan tus mazos).</div>`}`;
  $("#dp-copy", body)?.addEventListener("click", () => copy(text, "Lista copiada"));
  $("#dp-share", body)?.addEventListener("click", () => shareText("Mis cartas repetidas", text));
  body.querySelectorAll("[data-name]").forEach((b) => (b.onclick = () => synergySheet(b.dataset.name)));
}
// Por meses: cartas añadidas, lo que costaron y cómo ha ido el valor de tu colección
async function statsSheet() {
  const body = openSheet(`<h3>Por meses</h3>${skeleton(3)}`);
  const rows = await api("/api/monthstats");
  const name = (m) => new Date(`${m}-15T12:00`).toLocaleDateString(document.documentElement.lang || "es", { month: "long", year: "numeric" });
  body.innerHTML = `<h3>Por meses</h3>
    <div class="hint">Lo que has gastado es el precio de Cardmarket del día en que añadiste cada carta (las de antes del 27 de noviembre de 2026, al precio de hoy). El valor es el de toda tu colección.</div>
    ${rows.length ? rows.map((m) => `<div class="month-card"><div class="month-head"><b>${esc(name(m.month))}</b>${m.pct != null ? `<span class="${m.change >= 0 ? "up" : "down"}">${m.change >= 0 ? "+" : ""}${euro(m.change)} (${pct(m.pct)})</span>` : ""}</div>
      <div class="stats"><div class="stat"><b>${m.cards}</b><span>Cartas añadidas</span></div><div class="stat"><b>${m.guessed ? "≈ " : ""}${euro(m.spent)}</b><span>Gastado</span></div>
        <div class="stat"><b>${m.end != null ? euro(m.end) : "—"}</b><span>Valor al final</span></div></div></div>`).join("")
      : `<div class="empty"><strong>Aún no hay datos</strong>Añade cartas y vuelve en unos días.</div>`}`;
}

// Historial: las cartas que has añadido a la carpeta, por días
async function addedSheet() {
  const body = openSheet(`<h3>Últimas añadidas</h3>${skeleton(3)}`);
  const days = await api("/api/added");
  const fecha = (d) => new Date(`${d}T12:00`).toLocaleDateString(document.documentElement.lang || "es", { weekday: "long", day: "numeric", month: "long" });
  const hoy = new Date().toLocaleDateString("sv"), ayer = new Date(Date.now() - 864e5).toLocaleDateString("sv");
  body.innerHTML = `<h3>Últimas añadidas</h3>${days.length ? days.map((g) => `<h2>${g.day === hoy ? "Hoy" : g.day === ayer ? "Ayer" : esc(fecha(g.day))} · ${plural(g.count, "carta", "cartas")}</h2>
    <div class="added-sum">${ico("chart")}Valor añadido ese día: <b>${euro(g.value)}</b></div>
    <div class="grid">${g.cards.map((c) => tile(c, c.foil ? `<span class="num-tag">Foil</span>` : "")).join("")}</div>`).join("")
    : `<div class="empty"><strong>Aún no hay historial</strong>Las cartas que añadas a partir de ahora saldrán aquí, por días.</div>`}`;
  body.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => {
    const c = days.flatMap((g) => g.cards).find((x) => x.id === b.dataset.id);
    addSheet([{ name: c.name, best: c.id }], { onDone: addedSheet });
  }));
}

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
    $("#sel-toggle", body).innerHTML = s.on ? `${ico("check")}Seleccionando… (toca para salir)` : `${ico("select")}Seleccionar varias (o mantén pulsada una carta)`;
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
    const lacks = (c) => c.qty < (c.need || 1);  // en un mazo: te faltan copias
    const setBy = store("setSort") || "set", setPip = setBy === "color" ? store("setPip") : "";
    const cards = sortCards(d.cards, setBy).filter((c) => pipOk(c, setPip) && (rarity === "all" || c.rarity === rarity) && (show === "all" || (show === "missing" ? lacks(c) : !lacks(c)))
      && (!qn || c.name.toLowerCase().includes(qn) || String(c.number).toLowerCase() === qn));
    const missing = d.cards.filter((c) => lacks(c) && !c.basic);
    body.innerHTML = `
      <div class="set-head">${setIcon(d)}<div>
        <h3>${esc(d.name)}</h3><div class="sub">${d.special ? esc(d.type === "reserved" ? "No se reimprimen" : d.type) : esc(d.code.toUpperCase())}${d.released ? ` · ${esc(d.released)}` : ""}</div></div></div>
      <button class="btn block ${d.pinned ? "" : "primary"}" id="set-pin">${d.pinned ? "Dejar de seguir" : `${ico("pin")}${d.deck ? "Seguir mazo" : "Seguir esta colección"}`}</button>
      ${d.deck ? `<button class="btn block primary" id="set-own" style="margin-top:8px" ${d.owned >= d.total ? "disabled" : ""}>${ico("plus")}${d.owned >= d.total ? "Tienes todo el mazo" : "Tengo este mazo"}</button>` : ""}
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
      ${sortSelect("set-sort", setBy)}${setBy === "color" ? colorPips("set-pip", setPip) : ""}
      <button class="btn block" id="sel-toggle"></button>
      ${d.deck ? [[2, "Comandante"], [0, "Main deck"], [1, "Sideboard"]].map(([p, title]) => {
          const part = cards.filter((c) => (c.part || 0) === p);
          return part.length ? `<h2>${title} (${part.reduce((n, c) => n + c.need, 0)})</h2><div class="grid">${part.map((c) => tile(c, `<span class="num-tag ${lacks(c) ? "" : "full"}">${Math.min(c.qty, c.need)}/${c.need}</span>`)).join("")}</div>` : "";
        }).join("") || `<div class="hint">Ninguna carta con estos filtros.</div>`
      : `<div class="grid" style="margin-top:12px">${cards.map((c) => tile(c, `<span class="num-tag">#${esc(c.number)}</span>`)).join("") || `<div class="hint">Ninguna carta con estos filtros.</div>`}</div>`}
      <div class="row-btns">
        <button class="btn" id="set-copy" ${missing.length ? "" : "disabled"}>Copiar lo que falta</button>
        <button class="btn primary" id="set-share" ${missing.length ? "" : "disabled"}>Compartir lo que falta (${missing.length})</button>
      </div>
      <div class="sel-bar" id="sel-bar" hidden>
        <label class="toggle"><input type="checkbox" id="sel-foil" ${foil ? "checked" : ""}> Foil</label>
        <button class="btn" id="sel-all">Todas las visibles</button>
        <button class="btn" id="sel-del" disabled aria-label="Quitar las elegidas">${ico("trash")}</button>
        <button class="btn primary" id="sel-add" disabled>Toca las cartas que quieras</button>
      </div>`;
    body.querySelectorAll("#set-show button").forEach((b) => b.classList.toggle("on", b.dataset.s === show));
    body.querySelectorAll("#set-rarity button").forEach((b) => b.classList.toggle("on", b.dataset.r === rarity));
    body.querySelectorAll("#set-show button").forEach((b) => (b.onclick = () => { show = b.dataset.s; store("setShow", show); draw(); }));
    body.querySelectorAll("#set-rarity button").forEach((b) => (b.onclick = () => { rarity = b.dataset.r; draw(); }));
    $("#set-sort", body).onchange = (e) => { store("setSort", e.target.value); draw(); };
    body.querySelectorAll("#set-pip button").forEach((b) => (b.onclick = () => { store("setPip", setPip === b.dataset.pip ? "" : b.dataset.pip); draw(); }));
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
    // "Tengo este mazo": añade a tu colección las copias que te faltan, con la edición (arte) del mazo
    $("#set-own", body)?.addEventListener("click", async () => {
      if (!confirm(t(`¿Añadir a tu colección las ${d.total - d.owned} cartas que te faltan de ${d.name}?`))) return;
      const r = await api("/api/preconown", { code: d.code });
      toast(`${plural(r.changed, "carta añadida", "cartas añadidas")}`);
      celebrate(r);
      closeSheet.dirty = true;
      loadSummary();
      load(true);
    });
    const missingText = () => missing.map((c) => (d.deck ? `${c.need - Math.min(c.qty, c.need)} ${c.name}` : d.special ? `1 ${c.name}` : `1 ${c.name} (${d.code.toUpperCase()}) ${c.number}`)).join("\n");
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
const FORMAT_NAMES = { pauper: "Pauper", commander: "Commander", standard: "Estándar", casual: "Casual", pioneer: "Pioneer", modern: "Modern",
  legacy: "Legacy", vintage: "Vintage", premodern: "Premodern", peasant: "Peasant", valuevintage: "Value Vintage", oldschool: "Old School",
  penny: "Penny Dreadful", timeless: "Timeless", historic: "Historic", explorer: "Explorer", cedh: "cEDH", duel: "Duel Commander",
  paupercommander: "Pauper Commander", predh: "PreDH", brawl: "Brawl", standardbrawl: "Standard Brawl", oathbreaker: "Oathbreaker",
  highlander: "Highlander", canlander: "Canadian Highlander", gladiator: "Gladiator" };
const COMBO_FORMATS = { pauper: "Pauper", commander: "Commander", standard: "Estándar", casual: "Casual" };
// Formatos con comandante (la carta base es el comandante; en Oathbreaker, un planeswalker)
const CMD_FORMATS = new Set(["commander", "cedh", "duel", "paupercommander", "predh", "brawl", "standardbrawl", "oathbreaker"]);
const formatSelect = (id, on) => `<select class="search deck-select" id="${id}">${Object.entries(FORMAT_NAMES).map(([k, n]) => `<option value="${k}" ${k === on ? "selected" : ""}>${n}</option>`).join("")}</select>`;
const STYLE_NAMES = { auto: "Auto", aggro: "Agresivo", midrange: "Medio rango", control: "Control" };
const POWER_LABELS = { 1: "Meme", 2: "Muy casual", 3: "Equilibrado", 4: "Optimizado", 5: "Competitivo", 6: "World Champion" };
const POWER_ICONS = { 1: "mask", 2: "mug", 3: "scale", 4: "target", 5: "trophy", 6: "globe" };
const FOCUS_LABELS = { rampa: "Rampa y bichos grandes", grandes: "Bichos grandes", robo: "Robo de cartas", control: "Control", aggro: "Agresivo",
  tierras: "Landfall", fichas: "Fichas", sacrificio: "Sacrificio", cementerio: "Cementerio", descarte: "Descarte", hechizos: "Hechizos",
  vuelo: "Voladores", vida: "Ganar vida", contadores: "Contadores +1/+1", artefactos: "Artefactos", encantamientos: "Encantamientos",
  equipos: "Equipos y auras", parpadeo: "Parpadeo", "daño": "Daño directo" };
const BRACKET_LABELS = { 1: "1 · Exhibición", 2: "2 · Básico", 3: "3 · Mejorado", 4: "4 · Optimizado", 5: "5 · cEDH" };
const BRACKET_HINTS = { 1: "Temático y sin Game Changers, sin destruir tierras ni turnos extra.", 2: "Como un mazo preconstruido: sin Game Changers, sin destruir tierras ni turnos extra en cadena.",
  3: "Hasta 3 Game Changers; sin destruir todas las tierras ni encadenar turnos extra.", 4: "Sin límites: Game Changers, destruir tierras y turnos extra permitidos.", 5: "Competitivo (cEDH): lo más fuerte que tengas, sin límites." };
const manaIcon = (k, label = k) => `<img class="mana-icon" src="mana/${k}.svg" alt="${esc(label)}">`;

async function builderSheet(seeds, startFormat, opts = {}) {
  if (!seeds || !seeds.length) return pickSeed();
  seeds = [].concat(seeds);
  const body = openSheet(`<h3>Mazo con ${esc(seeds.join(", "))}</h3><div id="b-body">${skeleton(4)}</div>`);
  let colors = opts.colors || null, format = startFormat || store("buildFormat") || "pauper", style = store("buildStyle") || "auto";
  let power = store("buildPower") || "3", bracket = store("buildBracket") || "3", focus = "", p9 = false, combo = store("buildCombo") === "1",
    buy = store("buildBuy") === "1", sbbuy = store("buildSbBuy") === "1", spoil = store("buildSpoil") === "1", offmeta = store("buildOffmeta") === "1";
  const excluded = [];  // cartas que has quitado del mazo
  const run = async () => {
    $("h3", body).textContent = `Mazo con ${seeds.join(", ")}`;
    $("#b-body", body).innerHTML = `<div class="hint">Buscando cartas que encajen con el plan…</div>${skeleton(4)}`;
    let d;
    try {
      d = await api(`/api/build?seeds=${encodeURIComponent(seeds.join("|"))}&format=${format}&style=${style}&power=${power}&bracket=${bracket}&focus=${encodeURIComponent(focus)}&exclude=${encodeURIComponent(excluded.join("|"))}${p9 ? "&p9=1" : ""}${combo ? "&combo=1" : ""}${buy ? "&buy=1" : ""}${spoil ? "&spoilers=1" : ""}${offmeta ? "&offmeta=1" : ""}${sbbuy ? "&sbbuy=1" : ""}${colors ? `&colors=${colors}` : ""}`);
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
      <span class="badge full">${c.qty}</span>${c.reasons[0]?.startsWith("carta base") || c.role === "comandante" ? "" : `<button class="x-card" data-out="${esc(c.name)}" aria-label="Quitar del mazo">${ico("close")}</button>`}
      <div class="why">${esc(c.reasons.slice(0, 2).join(" · "))}</div></div>`;
    const group = (title, cards) => cards.length ? `<h2>${title} (${cards.reduce((n, c) => n + c.qty, 0)})</h2>
      <div class="grid">${cards.map(t).join("")}</div>` : "";
    const creatures = d.cards.filter((c) => c.role === "criatura"), spells = d.cards.filter((c) => c.role === "hechizo");
    const rows = [...(d.commander ? [d.commander] : []), ...d.cards, ...d.lands];
    const listText = rows.map((c) => `${c.qty} ${c.name}`).join("\n") + (d.sideboard?.length ? `\n\nSideboard\n${d.sideboard.map((c) => `${c.qty} ${c.name}`).join("\n")}` : "");
    $("#b-body", body).innerHTML = `
      ${formatSelect("b-format", format)}
      <div class="seg" id="b-style">${Object.entries(STYLE_NAMES).map(([k, n]) => `<button data-s="${k}" class="${style === k ? "on" : ""}">${k === "auto" && style === "auto" ? `Auto (${STYLE_NAMES[d.style].toLowerCase()})` : n}</button>`).join("")}</div>
      <div class="field"><label>Enfoque del mazo</label><div class="seg" id="b-focus"><button data-fo="" class="${focus ? "" : "on"}">${ico("sparkle")}Automático</button>${d.focus_options.map((o) => `<button data-fo="${esc(o.key)}" class="${focus === o.key ? "on" : ""}">${o.rec ? ico("star") : ""}${esc(FOCUS_LABELS[o.key] || o.key)} (${o.count})</button>`).join("")}</div>
        <div class="hint">${ico("star")}= lo que mejor hace este color. Entre paréntesis, cuántas cartas de ese tipo tienes que valgan.</div></div>
      <div class="field"><label>Nivel del mazo</label><div class="seg" id="b-power">${Object.entries(POWER_LABELS).map(([k, n]) => `<button data-p="${k}" class="${power === k ? "on" : ""}">${ico(POWER_ICONS[k])}${n}</button>`).join("")}</div></div>
      ${format === "commander" ? `<div class="field"><label>Bracket de Commander</label><div class="seg" id="b-bracket">${Object.entries(BRACKET_LABELS).map(([k, n]) => `<button data-b="${k}" class="${bracket === k ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="hint">${BRACKET_HINTS[bracket]}</div><div class="hint">Game Changers en el mazo: <b>${d.game_changers.length}</b></div>
        ${d.game_changers.length ? `<div class="item-meta">${d.game_changers.map((n) => `<span class="chip gold">${esc(n)}</span>`).join("")}</div>` : ""}</div>` : ""}
      <label class="toggle combo-toggle" style="margin:4px 0 6px"><input type="checkbox" id="b-combo" ${combo ? "checked" : ""}> ${ico("synergy")}<b>Combo</b>: el mazo va a combo infinito (se suma al estilo: control + combo, agresivo + combo…)</label>
      ${combo ? `<div class="combo-pick"><h2>${ico("synergy")}Combos para este mazo</h2>
        ${d.combo_options.length ? `<div class="hint">Combos infinitos de dos cartas que caben en tus colores. Toca uno para ver cómo funciona y meterlo en el mazo.</div>
        <div class="list">${d.combo_options.map((k, i) => `<button class="item combo-row" data-co="${i}">
          <div class="combo-imgs">${k.images.map((src, j) => `<img loading="lazy" src="${esc(src)}" alt="" class="${k.owned[j] ? "" : "missing"}">`).join("")}</div>
          <div class="item-main"><div class="item-title">${k.cards.map(esc).join(" + ")}</div>
            <div class="item-meta">${k.makes.slice(0, 2).map((m) => `<span class="chip gold">${esc(m)}</span>`).join("")}${k.extra_color ? `<span class="chip">+ ${esc(Object.fromEntries(COLORS)[k.extra_color] || k.extra_color)}</span>` : ""}</div>
            <div class="item-meta">${k.cards.map((n, j) => (k.in_deck[j] ? `${esc(n)}: ya en el mazo` : k.owned[j] ? `${esc(n)}: la tienes` : `${esc(n)}: no la tienes${k.eur[j] != null ? ` (${euro(k.eur[j])})` : ""}`)).join(" · ")}</div></div></button>`).join("")}</div>`
        : `<div class="hint">No encuentro combos infinitos de dos cartas en estos colores y formato con tus cartas. Prueba otro formato (Casual o Commander tienen muchos más) u otros colores.</div>`}</div>` : ""}
      <label class="toggle" style="margin:4px 0 6px"><input type="checkbox" id="b-buy" ${buy ? "checked" : ""}> Usar también cartas que no tengo (para comprar): las del meta o las que mejor encajan</label>
      <label class="toggle" style="margin:4px 0 6px"><input type="checkbox" id="b-offmeta" ${offmeta ? "checked" : ""}> Cartas fuera del meta: legales en el formato y con sinergia, aunque no las juegue ninguna lista (para sorprender en torneo)</label>
      ${d.template ? `<div class="warn"><span>Basado en la lista ganadora de ${esc(d.template.archetype)}${d.template.player ? ` de ${esc(d.template.player)}` : ""}${d.template.event ? ` (${d.template.result === "1" ? "ganó" : `${esc(d.template.result)}º en`} ${esc(d.template.event)})` : ""}: sus cartas, sus tierras y su banquillo, como haría un jugador de torneo.</span> <span>${power == 6 ? "En World Champion entra entera: lo que no tienes sale en gris para comprar." : "En Competitivo, solo lo que tienes; el resto lo completa el constructor."}</span></div>` : ""}
      <label class="toggle" style="margin:4px 0 6px"><input type="checkbox" id="b-spoil" ${spoil ? "checked" : ""}> Spoilers: usar cartas anunciadas que aún no han salido y ver con cuáles hace sinergia el mazo</label>
      ${spoil ? `<h2>Spoilers que encajan con este mazo</h2>${d.spoilers.length ? `<div class="hint">Cartas anunciadas que aún no se pueden comprar. En dorado, las que ya están en el mazo. Toca una para meterla o sacarla${format === "commander" ? "" : " (entran 4 copias)"}.</div>
        <div class="grid">${d.spoilers.map((c) => `<button class="gcard ${c.in_deck ? "" : "missing"}" data-spoil="${esc(c.name)}" data-in="${c.in_deck ? 1 : 0}"><img loading="lazy" src="${esc(c.image)}" alt="${esc(c.name)}"><span class="num-tag ${c.in_deck ? "full" : ""}">${c.in_deck ? ico("check") : ico("plus2")}</span><div class="why">Sale el ${esc(c.released)}${c.reasons.length ? ` · ${c.reasons.map(esc).join(", ")}` : ""}</div></button>`).join("")}</div>`
        : `<div class="hint">Ningún spoiler de los que hay ahora encaja con este mazo en estos colores.</div>`}` : ""}
      <label class="toggle" style="margin:4px 0 10px"><input type="checkbox" id="b-p9" ${p9 ? "checked" : ""}> ${ico("bolt")}Power 9 (Black Lotus, los Mox de tus colores y, si es azul, Ancestral Recall, Time Walk y Timetwister; aunque no los tengas. Solo Casual)</label>
      <div class="field"><label>Meter una carta concreta</label><input class="search" id="b-addq" placeholder="Escribe el nombre de una carta…"><div class="list" id="b-addres"></div></div>
      ${excluded.length ? `<div class="item-meta">Quitadas: ${excluded.map((n) => `<button class="chip" data-back="${esc(n)}">${ico("undo")}${esc(n)}</button>`).join("")}</div>` : ""}
      <button class="btn block" id="b-more" style="margin:4px 0 8px">${ico("plus")}Más cartas base (${seeds.length})</button>
      <div class="seg mana-row" id="b-colors">${COLORS.map(([k, n]) => `<button data-c="${k}" class="mana ${colors.includes(k) ? "on" : ""}" aria-label="${n}" title="${n}">${manaIcon(k, n)}</button>`).join("")}</div>
      ${d.warnings.map((w) => `<div class="warn">${ico("warn")}${esc(w)}</div>`).join("")}
      ${d.commander ? `<h2>Comandante</h2><div class="grid">${t(d.commander)}</div>` : ""}
      <div class="stats">
        <div class="stat"><b>${s.total}</b><span>Cartas</span></div>
        <div class="stat"><b>${s.lands}</b><span>Tierras</span></div>
        <div class="stat"><b>${euro(s.value)}</b><span>Valor</span></div>
      </div>
      ${d.themes.length ? `<div class="item-meta">Plan del mazo: ${d.themes.map((x) => `<span class="chip gold">${esc(x)}</span>`).join("")}</div>` : ""}
      <details class="guide" open><summary>${ico("book")}Cómo se juega este mazo</summary>
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
      ${d.sideboard ? `<h2>Banquillo contra el meta (${d.sideboard.reduce((n, c) => n + c.qty, 0)})</h2>
        <div class="hint">Lo que más llevan los banquillos de las listas del meta de ${esc(FORMAT_NAMES[format])}, en tus colores. Debajo, qué mazos lo usan.</div>
        <label class="toggle" style="margin:4px 0 8px"><input type="checkbox" id="b-sbbuy" ${sbbuy ? "checked" : ""}> Banquillo con cartas que no tengo (para comprar)</label>
        ${d.sideboard.length ? `<div class="grid">${d.sideboard.map(t).join("")}</div>` : `<div class="hint">Con tus cartas no sale banquillo en estos colores: marca la opción para incluir cartas que no tienes.</div>`}
        <div id="sb-plan"></div>` : ""}
      ${d.combos?.length ? `<h2>${ico("synergy")}Combos infinitos en este mazo</h2>${d.combos.map((k) => `<details class="guide"><summary>${k.cards.map(esc).join(" + ")} · ${esc(k.makes[0] || "")}</summary>
        ${k.pre || k.needs.length ? `<div class="hint">Necesitas: ${[...k.needs, k.pre].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
        <ol class="combo-steps">${k.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>`).join("")}` : ""}
      ${d.bench.length ? `<h2>${ico("plus")}Te recomiendo añadir (ya las tienes)</h2><div class="hint">Toca una para meterla en el mazo como carta base.</div>
        <div class="grid">${d.bench.map((c) => `<button class="gcard rec" data-add="${esc(c.name)}"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
          ${c.eur != null ? `<span class="badge full">${euro(c.eur)}</span>` : ""}<div class="why">${esc(c.reasons.join(" · "))}</div></button>`).join("")}</div>` : ""}
      ${d.meta_recs?.length ? `<h2>${ico("meta")}Lo que juega el meta</h2><div class="hint">Cartas habituales en las listas de torneo ${d.meta_recs[0].why === "con tus cartas base" ? "con tus cartas base" : "de tus colores"} que no están en tu mazo. Toca una para meterla (si no la tienes, entra igual, marcada para comprar).</div>
        <div class="grid">${d.meta_recs.map((c) => `<button class="gcard rec ${c.owned ? "" : "missing"}" data-add="${esc(c.name)}"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
          <span class="badge ${c.owned ? "full" : "none"}">${c.pct}%</span>
          <div class="why">${c.owned ? `La tienes ×${c.owned}` : euro(c.eur)}${c.replaces ? ` · en lugar de ${esc(c.replaces)}` : ""}</div></button>`).join("")}</div>` : ""}
      ${d.buy?.length ? `<h2>${ico("cart")}Te recomiendo comprar</h2><div class="hint">No las tienes y mejorarían el mazo. Toca una para verla en Cardmarket.</div>
        <div class="grid">${d.buy.map((c) => `<a class="gcard rec" target="_blank" rel="noopener" href="${cardmarketUrl(c.name)}"><img loading="lazy" draggable="false" src="${esc(c.image)}" alt="${esc(c.name)}">
          <span class="badge part">${euro(c.eur)}</span><div class="why">${esc(c.reasons.join(" · "))}</div></a>`).join("")}</div>` : ""}
      <div class="row-btns"><button class="btn" id="b-other">Otras cartas</button><button class="btn" id="b-copy">Copiar lista</button></div>
      <button class="btn block primary" id="b-save" style="margin-top:8px">${ico("save")}Guardar en Mis mazos</button>`;
    $("#b-format", body).onchange = (e) => { format = e.target.value; store("buildFormat", format); colors = null; run(); };
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
    // Plan de banquillo: contra cada mazo top del meta, qué meter y qué sacar
    if (d.sideboard?.length && $("#sb-plan", body)) {
      const enc = (l) => encodeURIComponent(l.map((c) => `${c.name}:${c.qty}`).join("|"));
      api(`/api/sbplan?format=${format}&main=${enc(d.cards)}&side=${enc(d.sideboard)}`).then((plan) => {
        const rows = plan.filter((p) => p.in.length);
        $("#sb-plan", body).innerHTML = rows.length ? `<h2>Plan de banquillo</h2><div class="hint">Contra cada mazo top del meta: qué cartas del banquillo meter y cuáles del mazo sacar (lo mismo que hacen los jugadores de torneo).</div>
          ${rows.map((p) => `<details class="guide"><summary>Contra ${esc(p.vs)}${p.share ? ` (${p.share}%)` : ""}</summary>
            ${p.traits.length ? `<div class="hint">El rival ${p.traits.map(esc).join(", ")}.</div>` : ""}
            <p><b>Mete:</b> ${p.in.map((c) => `${c.n} ${esc(c.name)} <span class="sub">(${esc(c.why)})</span>`).join(", ")}</p>
            <p><b>Saca:</b> ${p.out.length ? p.out.map((c) => `${c.n} ${esc(c.name)} <span class="sub">(${esc(c.why)})</span>`).join(", ") : "lo más flojo en este enfrentamiento"}</p></details>`).join("")}` : "";
      }).catch(() => {});
    }
    $("#b-offmeta", body).onchange = (e) => { offmeta = e.target.checked; store("buildOffmeta", offmeta ? "1" : "0"); run(); };
    $("#b-spoil", body).onchange = (e) => { spoil = e.target.checked; store("buildSpoil", spoil ? "1" : "0"); run(); };
    // Spoilers: tocar uno lo mete en el mazo como carta base (o lo saca)
    body.querySelectorAll("[data-spoil]").forEach((b) => (b.onclick = () => {
      const n = b.dataset.spoil, i = seeds.indexOf(n);
      if (b.dataset.in === "1") { if (i >= 0 && seeds.length > 1) seeds.splice(i, 1); excluded.push(n); toast(`${n}: fuera del mazo`); }
      else { if (i < 0) seeds.push(n); const j = excluded.indexOf(n); if (j >= 0) excluded.splice(j, 1); toast(`${n}: añadida como carta base`); }
      run();
    }));
    $("#b-buy", body).onchange = (e) => { buy = e.target.checked; store("buildBuy", buy ? "1" : "0"); run(); };
    $("#b-sbbuy", body)?.addEventListener("change", (e) => { sbbuy = e.target.checked; store("buildSbBuy", sbbuy ? "1" : "0"); run(); });
    $("#b-combo", body).onchange = (e) => { combo = e.target.checked; store("buildCombo", combo ? "1" : "0"); run(); };
    // Elegir un combo: se explica y, si quieres, sus dos cartas pasan a ser cartas base del mazo
    body.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => {
      const k = d.combo_options[+b.dataset.co];
      const box = openSheet(`<div class="title-back"><button class="btn back-btn" id="co-back" aria-label="Volver al mazo">←</button><h3>${k.cards.map(esc).join(" + ")}</h3></div>
        <div class="combo-big">${k.images.map((src, j) => `<figure><img src="${esc(src)}" alt="${esc(k.cards[j])}" class="${k.owned[j] ? "" : "missing"}"><figcaption>${k.in_deck[j] ? "Ya en el mazo" : k.owned[j] ? "La tienes" : `No la tienes${k.eur[j] != null ? ` · ${euro(k.eur[j])}` : ""}`}</figcaption></figure>`).join("")}</div>
        <h2>Qué consigues</h2><div class="item-meta">${k.makes.map((m) => `<span class="chip gold">${esc(m)}</span>`).join("")}</div>
        ${k.pre || k.needs.length || k.mana ? `<h2>Qué necesitas</h2><ul class="combo-pre">${k.needs.map((n) => `<li>${esc(n)}</li>`).join("")}${k.pre ? `<li>${esc(k.pre)}</li>` : ""}${k.mana ? `<li>Maná: ${esc(k.mana)}</li>` : ""}</ul>` : ""}
        <h2>Cómo funciona, paso a paso</h2><ol class="combo-steps">${k.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        <div class="hint">Los pasos vienen de Commander Spellbook (la base de combos que usa EDHREC), en inglés.</div>
        <button class="btn block primary" id="co-add" style="margin-top:10px">${ico("plus")}Meter este combo en el mazo</button>`);
      const back = () => builderSheet(seeds, format);
      $("#co-add", box).onclick = () => { for (const n of k.cards) if (!seeds.includes(n)) seeds.push(n); back(); };
      $("#co-back", box).onclick = back;
    }));
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
          <div class="item-side"><div class="sub">${ico("plus")}</div></div></button>`).join("") || `<div class="hint">No la encuentro.</div>`;
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
      // ¿Lo vas a probar? Sí → "Mazos para probar" con reseña (mín. 3 partidas y una frase). Se guarda cómo se creó (nivel, arquetipo…)
      const save = async (test) => {
        const r = await api("/api/mydecks", { save: { name: `${d.commander ? d.commander.name : d.seed} (${FORMAT_NAMES[format]})`, format: FORMAT_NAMES[format],
          cards: [...rows.map((c) => [c.name, c.qty, 0]), ...(d.sideboard || []).map((c) => [c.name, c.qty, 1])], test,
          built: { format, power: d.power, level: POWER_LABELS[d.power], archetype: d.style, style_auto: d.style_auto, focus: d.focus || "", combo: !!d.combo,
            bracket: d.bracket, colors: d.colors, lands: d.stats.lands, seeds: d.seeds } } });
        toast(test ? "Guardado en Mazos para probar" : "Guardado en Mis mazos");
        store("deckTab", test ? "test" : "mine");
        deckSheet(r.id);
      };
      const ask = openSheet(`<h3>Guardar el mazo</h3>
        <div class="warn">Si vas a probar este mazo en torneos, en Endstep o en físico, ¿quieres ayudar a mejorar el creador de mazos?</div>
        <div class="hint">Si dices que sí, se guarda en "Mazos para probar". Cuando lo juegues (3 partidas como mínimo, las que quieras), abre el mazo y apunta cuántas has jugado, cuántas has ganado y una frase sobre cómo ha ido el gameplay. El creador de mazos aprende de esas reseñas: qué nivel (${esc(POWER_LABELS[d.power] || "")}) y qué arquetipo funcionan, qué cartas ganan y qué le falta.</div>
        <div class="row-btns"><button class="btn" id="sv-no">No, solo guardarlo</button><button class="btn primary" id="sv-yes">Sí, quiero ayudar</button></div>`);
      $("#sv-yes", ask).onclick = () => save(true);
      $("#sv-no", ask).onclick = () => save(false);
    };
  };
  run();
}

// Elegir el formato y una o varias cartas base de la carpeta (con sugerencias de cartas que combinan).
// `already` = las que ya tiene el mazo (salen marcadas).
/* Combos infinitos de 2 cartas (no sinergias) que puedes hacer con tu colección, y los que te falta una carta para hacer.
   Al tocar uno: qué hace, qué necesita, los pasos y un botón para crear un mazo con el combo. */
async function combosSheet(format = "casual") {
  const body = openSheet(`<h3>${ico("synergy")}Combos infinitos</h3>${skeleton(3)}`);
  let fmt = format;
  const draw = async () => {
    body.innerHTML = `<h3>${ico("synergy")}Combos infinitos</h3>
      <div class="hint">Combos de dos cartas que crean algo infinito (vida, daño, maná, fichas…), de Commander Spellbook. No son sinergias: con las dos cartas en juego el combo se repite sin fin.</div>
      <div class="seg" id="cb-fmt">${Object.entries(COMBO_FORMATS).map(([k, n]) => `<button data-f="${k}" class="${k === fmt ? "on" : ""}">${n}</button>`).join("")}</div>
      <div id="cb-list">${skeleton(4)}</div>`;
    body.querySelectorAll("#cb-fmt button").forEach((b) => (b.onclick = () => { fmt = b.dataset.f; draw(); }));
    let r;
    try { r = await api(`/api/combos?format=${fmt}`); } catch (err) { $("#cb-list", body).innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    const row = (k, i, group) => `<button class="item combo-row" data-g="${group}" data-i="${i}">
        <div class="combo-imgs">${k.images.map((src, j) => `<img loading="lazy" src="${esc(src)}" alt="" class="${k.owned[j] ? "" : "missing"}">`).join("")}</div>
        <div class="item-main"><div class="item-title">${k.cards.map(esc).join(" + ")}</div>
          <div class="item-meta">${k.makes.slice(0, 2).map((m) => `<span class="chip gold">${esc(m)}</span>`).join("")}</div>
          ${group === "one" ? `<div class="item-meta">Te falta: ${k.cards.map((n, j) => (k.owned[j] ? "" : `${esc(n)}${k.eur[j] != null ? ` (${euro(k.eur[j])})` : ""}`)).join("")}</div>` : ""}</div></button>`;
    $("#cb-list", body).innerHTML = `<h2>Puedes montarlos (${r.have.length})</h2>
      ${r.have.length ? `<div class="list">${r.have.map((k, i) => row(k, i, "have")).join("")}</div>` : `<div class="hint">Con tus cartas no hay ningún combo de dos cartas en este formato.</div>`}
      <h2>Te falta una carta (${r.one.length})</h2>
      ${r.one.length ? `<div class="list">${r.one.map((k, i) => row(k, i, "one")).join("")}</div>` : `<div class="hint">Ninguno.</div>`}`;
    body.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => comboSheet(r[b.dataset.g][+b.dataset.i], fmt)));
  };
  draw();
}

function comboSheet(k, fmt) {
  const FMT = { pauper: "Pauper", standard: "Estándar", pioneer: "Pioneer", modern: "Modern", legacy: "Legacy", vintage: "Vintage", commander: "Commander" };
  const body = openSheet(`<h3>${k.cards.map(esc).join(" + ")}</h3>
    <div class="combo-big">${k.images.map((src, j) => `<figure><img src="${esc(src)}" alt="${esc(k.cards[j])}" class="${k.owned[j] ? "" : "missing"}"><figcaption>${k.owned[j] ? "La tienes" : `No la tienes${k.eur[j] != null ? ` · ${euro(k.eur[j])}` : ""}`}</figcaption></figure>`).join("")}</div>
    <h2>Qué consigues</h2><div class="item-meta">${k.makes.map((m) => `<span class="chip gold">${esc(m)}</span>`).join("")}</div>
    ${k.pre || k.needs.length || k.mana ? `<h2>Qué necesitas</h2><ul class="combo-pre">${k.needs.map((n) => `<li>${esc(n)}</li>`).join("")}${k.pre ? `<li>${esc(k.pre)}</li>` : ""}${k.mana ? `<li>Maná: ${esc(k.mana)}</li>` : ""}</ul>` : ""}
    <h2>Cómo funciona, paso a paso</h2><ol class="combo-steps">${k.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <div class="hint">Los pasos vienen de Commander Spellbook (en inglés). Legal en: ${k.legal.map((f) => FMT[f] || f).join(", ") || "ningún formato principal"}.</div>
    <button class="btn block primary" id="cb-build" style="margin-top:10px">${ico("plus")}Crear un mazo con este combo</button>`);
  $("#cb-build", body).onclick = () => builderSheet(k.cards, fmt);
}

async function pickSeed(already = [], keepFormat = null) {
  let format = keepFormat || store("buildFormat") || "pauper";
  const body = openSheet(`<h3>Crear un mazo</h3>
    <div class="field"><label>1. ¿Para qué formato?</label>
      ${formatSelect("seed-format", "pauper")}
      <div class="hint" id="seed-fhint"></div></div>
    <button class="btn block" id="seed-combos" style="margin-bottom:10px">${ico("synergy")}Combos infinitos con tus cartas</button>
    <div class="field"><label>2. Elige una o varias cartas</label>
      <div class="hint">Cuantas más cartas elijas que vayan juntas, más sólido sale el mazo. Al elegir una, te sugiero otras de tu carpeta que combinan con ella.</div></div>
    <div id="seed-sugg"></div>
    <input class="search" id="seed-q" placeholder="Buscar en tus cartas…">
    <div class="seg" style="margin-top:8px"><button id="seed-legend">${ico("crown")}Solo comandantes</button></div>
    <div id="seed-list">${skeleton(3)}</div>
    <div class="sel-bar" id="seed-bar"><span class="sub" id="seed-n">Ninguna elegida</span><button class="btn primary" id="seed-go" disabled>Crear mazo</button></div>`);
  $("#seed-combos", body).onclick = () => combosSheet(format);
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
    standard: "60 cartas de las colecciones recientes.", casual: "60 cartas, sin restricciones: para jugar con amigos.",
    pioneer: "60 cartas, desde Return to Ravnica (2012).", modern: "60 cartas, desde Octava Edición (2003).", legacy: "60 cartas, casi todo Magic (con su lista de prohibidas).",
    vintage: "60 cartas, todo Magic: las restringidas, una copia.", premodern: "60 cartas de Cuarta Edición a Azote (1995-2003).",
    peasant: "60 cartas, solo comunes e infrecuentes.", valuevintage: "60 cartas de Vintage y el mazo entero cuesta como máximo 30 $ (banquillo incluido).",
    oldschool: "60 cartas de las primeras colecciones (1993-1994).", penny: "60 cartas que cuestan 1 céntimo de tique en MTGO (cambia cada temporada).",
    timeless: "60 cartas de MTG Arena, todo lo de Arena.", historic: "60 cartas de MTG Arena (Historic).", explorer: "60 cartas de Arena legales en Pioneer.",
    cedh: "Commander competitivo: 100 cartas sin repetir, lo más potente.", duel: "Commander 1 contra 1: 100 cartas sin repetir, 20 vidas y su propia lista de prohibidas.",
    paupercommander: "100 cartas comunes sin repetir; el comandante, una criatura infrecuente.", predh: "Commander solo con cartas hasta 2011 (antes de los mazos de Commander).",
    brawl: "100 cartas sin repetir con comandante, cartas de Arena.", standardbrawl: "60 cartas sin repetir con comandante, legales en Estándar.",
    oathbreaker: "60 cartas sin repetir: un planeswalker (tu oathbreaker) y un hechizo insignia.", highlander: "100 cartas sin repetir y sin comandante (Highlander europeo, con puntos).",
    canlander: "100 cartas sin repetir y sin comandante, con su lista de puntos.", gladiator: "100 cartas de Arena sin repetir y sin comandante." };
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
      box.innerHTML = r.suggest.length ? `<h2>${ico("synergy")}Combinan con lo que has elegido</h2><div class="arts">${r.suggest.map((c) => `
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
    $("#seed-format", body).value = f;
    $("#seed-fhint", body).textContent = FHINT[f];
    onlyLegends = CMD_FORMATS.has(f) && f !== "oathbreaker" && ![...picked].some((n) => isLegend(cards.find((c) => c.name === n) || {}));
    $("#seed-legend", body).classList.toggle("on", onlyLegends);
    allowed = new Set((await api(`/api/seedhelp?format=${f}`)).allowed);
    draw();
    suggest();
  };
  $("#seed-format", body).onchange = (e) => setFormat(e.target.value);
  $("#seed-legend", body).onclick = (e) => { onlyLegends = !onlyLegends; e.target.classList.toggle("on", onlyLegends); draw(); };
  $("#seed-go", body).onclick = () => {
    let seeds = [...picked];
    const legend = CMD_FORMATS.has(format) && seeds.find((n) => isLegend(cards.find((c) => c.name === n) || {}));
    if (legend) seeds = [legend, ...seeds.filter((n) => n !== legend)];  // el comandante, primero
    builderSheet(seeds, format);
  };
  $("#seed-q", body).oninput = (e) => draw(e.target.value);
  update();
  await setFormat(format);
}


// Mercado: movimientos de precio, predicciones y sinergias (colecciones nuevas o cualquier carta)
const predRow = (c) => `<div class="item pred" data-name="${esc(c.name)}" ${c.with ? `data-with="${esc(c.with)}" data-wimg="${esc(c.with_image || "")}"` : ""}>
    ${c.with_image ? `<span class="pair-thumbs"><img class="thumb" loading="lazy" src="${esc(c.image)}" alt=""><img class="thumb" loading="lazy" src="${esc(c.with_image)}" alt="${esc(c.with)}"></span>` : `<img class="thumb" loading="lazy" src="${esc(c.image)}" alt="">`}
    <div class="item-main"><div class="item-title">${esc(c.name)}${c.owned ? ' <span class="chip gold">La tienes</span>' : ""}</div>
      <div class="item-meta">${esc(c.reason)}</div></div>
    <div class="item-side"><div class="price">${euro(c.eur)}</div>${c.pct != null ? `<div class="sub ${c.pct > 0 ? "up" : "down"}">${pct(c.pct)}</div>` : ""}</div>
  </div>`;
const bindPred = (root) => root.querySelectorAll(".pred[data-name]").forEach((el) => (el.onclick = () => synergySheet(el.dataset.name, null, el.dataset.with ? { name: el.dataset.with, image: el.dataset.wimg } : null)));

views.market = async () => {
  const v = $("#view");
  const section = store("marketTab") || "moves";
  v.innerHTML = `<h2>Mercado</h2>
    <div class="seg" id="m-tab"><button data-t="watch">${ico("follow")}Sigo</button><button data-t="hot">${ico("fire")}Hot</button><button data-t="moves">${ico("up")}Movimientos</button><button data-t="pred">${ico("predict")}Predicciones</button><button data-t="syn">${ico("synergy")}Sinergias</button></div>
    <div id="m-section"></div>`;
  v.querySelectorAll("#m-tab button").forEach((b) => {
    b.classList.toggle("on", b.dataset.t === section);
    b.onclick = () => { store("marketTab", b.dataset.t); views.market(); };
  });
  const box = $("#m-section");
  if (section === "pred") return predictionsView(box);
  if (section === "syn") return synergiesView(box);
  if (section === "watch") return watchView(box);
  if (section === "hot") return hotView(box);
  box.innerHTML = `
    <div class="seg" id="m-scope"><button data-s="pauper">Legales en Pauper</button><button data-s="collection">Mis cartas</button><button data-s="all">Todas</button></div>
    <div class="seg" id="m-days"><button data-d="1">1 día</button><button data-d="7">7 días</button><button data-d="30">30 días</button></div>
    <div id="m-body">${skeleton(5)}</div>`;
  const draw = async () => {
    box.querySelectorAll("#m-scope button").forEach((b) => b.classList.toggle("on", b.dataset.s === state.marketScope));
    box.querySelectorAll("#m-days button").forEach((b) => b.classList.toggle("on", +b.dataset.d === state.marketDays));
    $("#m-body").innerHTML = skeleton(5);
    const m = await api(`/api/movers?scope=${state.marketScope}&days=${state.marketDays}&min=${state.marketScope === "collection" ? 0 : 0.5}`);
    const row = (i) => `<div class="mover" data-follow="${esc(i.name)}" data-pid="${esc(i.id || "")}"><span class="pct ${i.pct > 0 ? "up" : "down"}">${pct(i.pct)}</span><span class="n">${esc(i.name)}${i.set ? ` <span class="chip">${esc(i.set.toUpperCase())}</span>` : ""}</span><span class="from">${euro(i.old)} → <b>${euro(i.new)}</b></span></div>`;
    if (m.base === m.latest) {
      $("#m-body").innerHTML = `<div class="empty"><strong>Acumulando historial</strong>Hay precios del ${esc(m.latest)}. Las subidas y bajadas aparecerán a partir de mañana, y la vista semanal en 7 días.</div>`;
      return;
    }
    $("#m-body").innerHTML = `<div class="hint">Del ${esc(m.base)} al ${esc(m.latest)} · solo cartas de 0,50 € o más</div>
      <h2>${ico("up")}Suben</h2><div class="list">${m.up.map(row).join("") || '<div class="hint">Nada.</div>'}</div>
      <h2>${ico("down")}Bajan</h2><div class="list">${m.down.map(row).join("") || '<div class="hint">Nada.</div>'}</div>`;
    $("#m-body").querySelectorAll("[data-follow]").forEach((el) => (el.onclick = () => synergySheet(el.dataset.follow, el.dataset.pid)));
  };
  box.querySelectorAll("#m-scope button").forEach((b) => (b.onclick = () => { state.marketScope = b.dataset.s; store("marketScope", b.dataset.s); draw(); }));
  box.querySelectorAll("#m-days button").forEach((b) => (b.onclick = () => { state.marketDays = +b.dataset.d; store("marketDays", b.dataset.d); draw(); }));
  draw();
};

// Cartas hot de la semana: suben y se juegan mucho (Cardmarket no publica las ventas: es la mejor pista de demanda).
async function hotView(box) {
  box.innerHTML = skeleton(4);
  const r = await api("/api/hot");
  box.innerHTML = `<h2>${ico("fire")}Cartas hot de la semana</h2>
    <div class="hint">Del ${esc(r.base)} al ${esc(r.latest)}. Cardmarket no publica cuántas copias se venden, así que aquí están las que más demanda tienen: suben esta semana (sin bajar ayer) y se juegan mucho en el meta de algún formato o en Commander.</div>
    ${r.items.length ? `<div class="list">${r.items.map((c, i) => `<div class="item hot" data-follow="${esc(c.name)}"><span class="hot-rank">${i + 1}</span><img class="thumb" loading="lazy" src="${esc(c.image || "")}" alt="">
      <div class="item-main"><div class="item-title">${esc(c.name)}${c.owned ? ` <span class="chip gold">La tienes ×${c.owned}</span>` : ""}</div><div class="item-meta">${c.why.map((w) => `<span class="chip">${esc(w)}</span>`).join("")}</div></div>
      <div class="item-side"><div class="price">${euro(c.eur)}</div><div class="up">${pct(c.pct)}</div></div></div>`).join("")}</div>`
      : `<div class="empty"><strong>Aún no hay cartas hot</strong>Hace falta una semana de precios para verlas.</div>`}`;
  box.querySelectorAll("[data-follow]").forEach((el) => (el.onclick = () => synergySheet(el.dataset.follow)));
}

// Cartas que sigues: precio de Cardmarket y cuánto ha subido o bajado en 1, 7 y 30 días.
async function watchView(box) {
  box.innerHTML = `<div class="hint">Sigue cartas concretas (tuyas o no) y mira cómo cambia su precio. Con ${ico("target")}pones un precio objetivo (lista de deseos): te aviso cuando baje de ahí. Toca una para verla; ${ico("close")}para dejar de seguirla.</div>
    <label class="sub" style="display:block;margin:4px 0 8px">Precios para cartas en <select class="lang-sel" id="w-lang">${Object.entries(CARD_LANG_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
    <input class="search" id="w-q" placeholder="Buscar una carta para seguirla…">
    <div class="list" id="w-search"></div>
    <button class="btn block" id="w-top" style="margin-top:8px">${ico("follow")}Seguir mis 20 cartas más valiosas</button>
    <div id="w-list">${skeleton(3)}</div>`;
  const chg = (v, label) => `<span class="chip ${v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : ""}">${label} ${v == null ? "—" : pct(v)}</span>`;
  const draw = async () => {
    const rows = await api("/api/watch");
    if (rows[0]?.lang && $("#w-lang", box)) $("#w-lang", box).value = rows[0].lang;
    $("#w-list", box).innerHTML = rows.length ? `<div class="list">${rows.map((c) => `
      <div class="item watch" data-name="${esc(c.name)}"><img class="thumb" loading="lazy" src="${esc(c.image)}" alt="">
        <div class="item-main"><div class="item-title">${esc(c.name)}${c.owned ? ` <span class="chip gold">La tienes ×${c.owned}</span>` : ""}</div>
          <div class="item-meta">${chg(c.d1, "1 d")}${chg(c.d7, "7 d")}${chg(c.d30, "30 d")}</div>
          <div class="item-meta"><button class="mini-chip ${c.reached ? "up" : ""}" data-target="${esc(c.name)}" data-v="${c.target ?? ""}">${ico("target")}${c.target != null ? `${c.reached ? "¡Ya está! " : ""}Objetivo ${euro(c.target)}` : "Precio objetivo"}</button></div></div>
        <div class="item-side"><div class="price">${euro(c.eur)}</div><button class="btn w-del" data-del="${esc(c.name)}" aria-label="Dejar de seguir">${ico("close")}</button></div></div>`).join("")}</div>`
      : `<div class="empty"><strong>Aún no sigues ninguna carta</strong>Búscala arriba, o pulsa «Seguir su precio» en la ficha de una carta.</div>`;
    box.querySelectorAll(".watch[data-name]").forEach((el) => (el.onclick = (e) => { if (!e.target.closest("[data-del],[data-target]")) synergySheet(el.dataset.name); }));
    box.querySelectorAll("[data-target]").forEach((b) => (b.onclick = async () => {
      const v = prompt(t(`¿Avisarte cuando ${b.dataset.target} baje de cuántos euros? (vacío = quitar el objetivo)`), b.dataset.v.replace(".", ","));
      if (v === null) return;
      await api("/api/watch", { target: b.dataset.target, price: v });
      toast(v.trim() ? `Te aviso cuando baje de ${v.trim()} €` : "Objetivo quitado");
      syncRunner?.();
      draw();
    }));
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
        <div class="item-side"><div class="price">${euro(r.eur)}</div><div class="sub">${ico("follow")}Seguir</div></div></button>`).join("") || `<div class="hint">No la encuentro.</div>`;
      out.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => {
        await api("/api/watch", { add: b.dataset.add });
        toast(`Sigues ${b.dataset.add}`);
        out.innerHTML = ""; $("#w-q", box).value = "";
        draw();
      }));
    }, 250);
  };
  $("#w-lang", box).onchange = async (e) => { await api("/api/watch", { lang: e.target.value }); syncRunner?.(); toast("Precios y avisos ajustados a ese idioma"); draw(); };
  $("#w-top", box).onclick = async () => { await api("/api/watch", { top: 20 }); toast("Siguiendo tus cartas más valiosas"); draw(); };
  draw();
}

// Botón ⭐ para seguir (o dejar de seguir) el precio de una carta desde su ficha.
async function followButton(root, name) {
  const btn = $("#follow", root);
  if (!btn) return;
  const paint = (on) => { btn.innerHTML = ico("follow") + (on ? "Siguiendo su precio (toca para dejarlo)" : "Seguir su precio en Mercado"); btn.classList.toggle("primary", !on); };
  let on = (await api("/api/watch")).some((c) => c.name === name);
  paint(on);
  btn.onclick = async () => { await api("/api/watch", on ? { remove: name } : { add: name }); on = !on; paint(on); toast(on ? `Sigues ${name}` : "Ya no la sigues"); };
}

async function predictionsView(box) {
  box.innerHTML = `<div class="hint">Señales para comprar antes de que suban (precios de Cardmarket). Son pistas, no garantías.</div>${skeleton(4)}`;
  const p = await api("/api/predictions");
  const group = (title, hint, rows, empty) => `<h2>${title}</h2><div class="hint">${hint}</div>
    ${rows.length ? `<div class="list">${rows.map(predRow).join("")}</div>` : `<div class="empty">${empty}</div>`}`;
  const wait = "Hace falta más historial de precios: se va guardando cada día y esta lista se llenará sola.";
  box.innerHTML = `<div class="hint">Señales para comprar antes de que suban (precios de Cardmarket). Son pistas, no garantías. Toca una carta para ver con qué combina.</div>
    ${group(`${ico("predict")}Baratas que pueden volver a subir`, "Bajaron mucho en 30 días, ya no bajan y se siguen jugando.", p.rebound, p.history.d30 ? "Ahora mismo ninguna cumple las condiciones." : wait)}
    ${group(`${ico("up")}Empiezan a subir`, "Estaban planas y esta semana suben un 15% o más.", p.rising, p.history.d7 ? "Esta semana ninguna." : wait)}
    ${group(`${ico("star")}Muy jugadas y baratas`, "Están en varios mazos del meta de Pauper y cuestan poco.", p.staples, "Sin datos del meta todavía.")}
    ${group(`${ico("reserved")}Lista Reservada más jugada`, "No se reimprimen nunca: con el tiempo suelen subir.", p.reserved, "—")}`;
  bindPred(box);
}

async function synergiesView(box) {
  box.innerHTML = `<div class="hint">Cuando sale una colección, algunas cartas antiguas suben porque combinan con las nuevas. Aquí las ves antes.</div>
    <h2>${ico("sparkle")}Colecciones nuevas</h2><div class="list" id="ns-list">${skeleton(2)}</div>
    <h2>${ico("search")}Con cualquier carta</h2><input class="search" id="syn-q" placeholder="Busca una carta (de cualquier colección)…"><div class="list" id="syn-res"></div>`;
  const sets = await api("/api/newsets");
  $("#ns-list").innerHTML = sets.map((s) => `<button class="item set-row" data-code="${esc(s.code)}">${setIcon(s)}
      <div class="item-main"><div class="item-title">${esc(s.name)}</div><div class="item-meta">${s.upcoming ? `${ico("calendar")}Sale el` : "Salió el"} ${esc(s.released)}</div></div></button>`).join("")
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

/* Gráfica del precio (Cardmarket) y tabla con lo importante: hoy, hace 7 y 30 días, máximo, mínimo y el mayor salto. */
async function priceChart(box, q) {
  if (!box) return;
  box.innerHTML = skeleton(1);
  const h = q.data || await api(`/api/history?${q.id ? `id=${encodeURIComponent(q.id)}` : `name=${encodeURIComponent(q.name)}`}`).catch(() => null);
  if (!h || h.eur.length < 2) { box.innerHTML = `<div class="hint">${q.data ? "Aún no hay historial del valor de tu colección: vuelve mañana." : "Aún no hay historial de precio de esta carta."}</div>`; return; }
  const W = 320, H = 130, n = h.eur.length, lo = Math.min(...h.eur), hi = Math.max(...h.eur), span = hi - lo || 1;
  const x = (i) => 4 + (i * (W - 8)) / (n - 1), y = (v) => 8 + (H - 22) * (1 - (v - lo) / span);
  const line = h.eur.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = h.eur[n - 1], first = h.eur[0];
  const change = (a) => pct(Math.round(((last - a) * 1000) / (a || 1)) / 10);
  const at = (days) => { const t = new Date(Date.parse(h.days[n - 1]) - days * 864e5).toISOString().slice(0, 10); let k = -1; h.days.forEach((d, i) => { if (d <= t) k = i; }); return k; };
  let jump = 0, jumpAt = 0;  // el mayor salto entre dos puntos seguidos (el "spike")
  for (let i = 1; i < n; i++) { const r = h.eur[i - 1] ? (h.eur[i] - h.eur[i - 1]) / h.eur[i - 1] : 0; if (Math.abs(r) > Math.abs(jump)) { jump = r; jumpAt = i; } }
  const iHi = h.eur.indexOf(hi), iLo = h.eur.indexOf(lo);
  const short = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
  const row = (label, k) => (k < 0 ? "" : `<tr><td>${label}</td><td>${short(h.days[k])}</td><td>${euro(h.eur[k])}</td><td class="${last >= h.eur[k] ? "up" : "down"}">${k === n - 1 ? "" : change(h.eur[k])}</td></tr>`);
  const spike = Math.abs(jump) >= 0.15;
  box.innerHTML = `<div class="pchart"><div class="pchart-head"><b>${euro(last)}</b><span class="${last >= first ? "up" : "down"}">${change(first)} desde el ${short(h.days[0])}</span><span class="sub">${esc(h.set)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Precio de ${esc(h.name)}">
      <polygon points="${x(0)},${H - 14} ${line} ${x(n - 1)},${H - 14}" fill="var(--gold)" opacity=".15"/>
      <polyline points="${line}" fill="none" stroke="var(--gold)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      ${spike ? `<circle cx="${x(jumpAt)}" cy="${y(h.eur[jumpAt])}" r="4" fill="${jump > 0 ? "#6bbf59" : "#e0675f"}"/>` : ""}
      <text x="4" y="${H - 2}" font-size="10" fill="currentColor" opacity=".6">${short(h.days[0])}</text><text x="${W - 4}" y="${H - 2}" font-size="10" fill="currentColor" opacity=".6" text-anchor="end">${short(h.days[n - 1])}</text>
    </svg>
    <table class="ptable"><tr><th></th><th>Día</th><th>Precio</th><th>Hasta hoy</th></tr>
      ${row("Hoy", n - 1)}${row("Hace 7 días", at(7))}${row("Hace 30 días", at(30))}${row("Máximo", iHi)}${row("Mínimo", iLo)}
      ${spike ? `<tr><td>${jump > 0 ? "Pico" : "Caída"}</td><td>${short(h.days[jumpAt])}</td><td>${euro(h.eur[jumpAt - 1])} → ${euro(h.eur[jumpAt])}</td><td class="${jump > 0 ? "up" : "down"}">${pct(Math.round(jump * 1000) / 10)}</td></tr>` : ""}
    </table></div>`;
}

async function synergySheet(name, id, partner) {
  const body = openSheet(`<h3>Combinan con ${esc(name)}</h3>${skeleton(4)}`);
  try {
    const d = await api(`/api/cardsynergy?name=${encodeURIComponent(name)}`);
    // Si viene de las sinergias de una colección nueva: las dos cartas juntas, para ver por qué combinan
    body.innerHTML = `<h3>Combinan con ${esc(d.name)}</h3>${partner ? `<div class="combo-big"><figure><img src="${esc(d.image)}" alt="${esc(d.name)}"><figcaption>${esc(d.name)}</figcaption></figure>
        <figure><img src="${esc(partner.image)}" alt="${esc(partner.name)}"><figcaption>Hace sinergia con ${esc(partner.name)} (nueva)</figcaption></figure></div>`
      : `<img class="card-big" src="${esc(d.image)}" alt="${esc(d.name)}">`}
      <div id="price-chart"></div>
      <button class="btn block" id="follow" style="margin:8px 0">${ico("follow")}Seguir su precio en Mercado</button>
      <h2>${ico("synergy")}Cartas que combinan</h2><div class="hint">Las cartas de todo Magic que mejor encajan con ella. "La tienes" = está en tu carpeta.</div>
      <div class="list">${d.cards.map(predRow).join("") || '<div class="hint">No he encontrado sinergias claras.</div>'}</div>
      <a class="btn block" style="margin-top:10px;text-decoration:none" target="_blank" rel="noopener" href="${cardmarketUrl(d.name)}">${ico("cart")}Ver ${esc(d.name)} en Cardmarket</a>`;
    bindPred(body);
    followButton(body, d.name);
    priceChart($("#price-chart", body), id ? { id } : { name: d.name });
  } catch (err) { body.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

// Avisos
views.alerts = async () => {
  const v = $("#view");
  v.innerHTML = `<h2>Avisos</h2>${skeleton(3)}`;
  const events = await api("/api/events");
  if (events[0]) store("lastSeenEvent", events[0].id);
  $("#alert-dot").hidden = true;
  // Dos pestañas: precios de cartas, y baneos y eventos (anuncios de baneos, torneos grandes, colecciones, meta)
  const tab = store("alertTab") || "price";
  const shown = events.filter((e) => (tab === "price") === (e.kind === "price" || e.kind === "wish"));  // los deseos, con los precios
  v.innerHTML = `<h2>Avisos</h2>
    <div class="seg" id="al-tab"><button data-t="price" class="${tab === "price" ? "on" : ""}">${ico("up")}Precios de cartas</button><button data-t="events" class="${tab === "events" ? "on" : ""}">${ico("trophy")}Baneos y eventos</button></div>
    <div class="hint">${tab === "price" ? "Cartas tuyas que suben o bajan un 10 % o más, y cartas de los mazos top de Pauper que se mueven." : "Baneos de todos los formatos y la fecha del próximo anuncio, ganadores de torneos grandes (Paupergeddon, Super Pauper, RCQ, Mundial), colecciones nuevas y cambios en el meta."} Se revisan dos veces al día; en Android te llegan al móvil aunque la app esté cerrada.</div>
    ${shown.length ? `<div class="list">${shown.map((e) => `<div class="event"><div class="t">${evTitle(e.title)}</div>${e.body ? `<div class="b">${esc(e.body).replace(/\n/g, "<br>")}</div>` : ""}<div class="d">${esc(e.day)}</div></div>`).join("")}</div>`
      : `<div class="empty"><strong>Sin avisos todavía</strong>Cuando haya un baneo, una colección nueva o una carta tuya se mueva más de un 10%, aparecerá aquí y en el móvil.</div>`}`;
  v.querySelectorAll("#al-tab button").forEach((b) => (b.onclick = () => { store("alertTab", b.dataset.t); views.alerts(); }));
};

// Título de un aviso con icono en vez de emoji (📈 sube, 📉 baja, 📊 meta, 🏆 ganador)
const EV_ICONS = { "📈": "up", "📉": "down", "📊": "meta", "🏆": "trophy", "🎯": "target", "📜": "scroll", "📅": "calendar", "⚠": "warn", "🚫": "warn", "🔨": "hammer" };
function evTitle(title) {
  const m = /^(\p{Extended_Pictographic})\uFE0F?\s*(.*)$/u.exec(title);
  return m ? `${ico(EV_ICONS[m[1]])}${esc(m[2])}` : esc(title);
}

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
        <button class="sheet-close" id="scan-close" aria-label="Cerrar escáner">${ico("close")}</button>
      </div>
      <div class="scan-status" id="scan-status">Abriendo la cámara…</div>
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
  Object.assign(S, { running: true, busy: false, paused: false, last: null, hits: 0, n: 0, noText: 0, triedCams: new Set() });
  document.documentElement.classList.add("lock");
  status("Preparando el lector…");
  Promise.all([getWorker(scanLang()[1], `title:${scanLang()[1]}`, 6), getWorker("eng", "bottom", 6)])
    .then(() => status(canFocus(S.stream) ? "Apunta a la carta (no hace falta encajarla en el marco) · toca para enfocar"
      : "Esta cámara no enfoca: prueba «Cámara» o «Foto» (usa el enfoque del móvil)")).catch((e) => status(e.message));
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
  const num = (d) => { const m = /camera2? ?(\d+)/i.exec(d.label); return m ? +m[1] : 50; };
  return (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === "videoinput" && !/front|user|frontal|delant|selfie/i.test(d.label))
    // la principal primero (en Android, "camera2 0"); las gran angular y teleobjetivo, al final
    .sort((a, b) => (/wide|ultra|gran|angular|tele/i.test(a.label) - /wide|ultra|gran|angular|tele/i.test(b.label)) || num(a) - num(b));
}
async function autoNextCamera() {
  const cams = await backCameras();
  S.triedCams ||= new Set();
  const cur = S.stream?.getVideoTracks()[0].getSettings().deviceId;
  S.triedCams.add(cur);
  const next = cams.find((d) => !S.triedCams.has(d.deviceId));
  if (!next) return;  // ya se han probado todas
  S.autoSwitching = true;
  try {
    stopStream(S.stream);
    S.stream = await navigator.mediaDevices.getUserMedia(camOpts(next.deviceId));
    store("scanCam", next.deviceId);
    const video = $("#scan-video");
    video.srcObject = S.stream;
    await video.play().catch(() => {});
    setupCameraControls(video);
    status("Probando otra cámara del móvil…");
  } catch { /* nada */ } finally { S.autoSwitching = false; }
}
async function openBestCamera() {
  const saved = store("scanCam");
  if (saved) {
    const st = await navigator.mediaDevices.getUserMedia(camOpts(saved)).catch(() => null);
    if (st) return st;
  }
  // Primero la cámara trasera principal (las gran angular de muchos Android no enfocan de cerca)
  const main = (await backCameras().catch(() => []))[0];
  if (main?.deviceId) { const sm = await navigator.mediaDevices.getUserMedia(camOpts(main.deviceId)).catch(() => null); if (sm) return sm; }
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
  bar.innerHTML = `<button class="btn" id="scan-photo">${ico("cam")}Foto</button><button class="btn" id="scan-cam">${ico("refresh")}Cámara</button>`;
  $("#scan-photo").onclick = () => { closeScanner(); photoScan(); };
  $("#scan-cam").onclick = switchCamera;
  if (caps.torch) {
    let on = false;
    bar.insertAdjacentHTML("beforeend", `<button class="btn" id="scan-torch">${ico("torch")}</button>`);
    $("#scan-torch").onclick = (e) => { on = !on; apply({ torch: on }); e.currentTarget.classList.toggle("primary", on); };
  }
  if (caps.focusDistance && modes.includes("manual")) {
    const fd = caps.focusDistance;
    bar.insertAdjacentHTML("beforeend", `<label class="scan-zoom">${ico("target")}<input type="range" id="scan-focus" min="${fd.min}" max="${fd.max}" step="${fd.step || (fd.max - fd.min) / 50}" value="${track.getSettings().focusDistance ?? fd.min}"></label>
      ${modes.includes("continuous") ? `<button class="btn" id="scan-af">AF</button>` : ""}`);
    $("#scan-focus").oninput = (e) => apply({ focusMode: "manual", focusDistance: +e.target.value });
    $("#scan-af")?.addEventListener("click", () => { apply({ focusMode: "continuous" }); toast("Enfoque automático"); });
  }
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    const z0 = Math.min(caps.zoom.max, Math.max(caps.zoom.min, +(store("scanZoom") || 1.6)));
    apply({ zoom: z0 });
    bar.insertAdjacentHTML("beforeend", `<label class="scan-zoom">${ico("search")}<input type="range" id="scan-zoomr" min="${caps.zoom.min}" max="${Math.min(caps.zoom.max, 5)}" step="${caps.zoom.step || 0.1}" value="${z0}"></label>`);
    $("#scan-zoomr").oninput = (e) => { apply({ zoom: +e.target.value }); store("scanZoom", e.target.value); };
  }
  if (!canFocus(S.stream)) status("Esta cámara no enfoca: prueba «Cámara» o «Foto» (usa el enfoque del móvil)");
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
    whole: toCanvas(v, 0, 0, v.videoWidth, v.videoHeight, 1100),
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
    if (S.n % 2 === 1) {
      // Uno de cada dos intentos: TODA la imagen, buscando texto suelto (psm 11). Así la carta no tiene que estar dentro del
      // marco: se lee esté donde esté de la pantalla, girada o pequeña.
      const wc = lang === "auto" || lang === "en" ? "eng" : code;
      const r = await (await getWorker(wc, `whole:${wc}`, 11)).recognize(strips.whole);
      lines = ocrLines(r.data, strips.whole);
    } else if (S.n % 6 === 0) {
      // La carta entera dentro del marco: sirve si no llena el marco o está torcida.
      const r = await (await getWorker("eng", "full")).recognize(strips.full);
      lines = ocrLines(r.data, strips.full);
    } else {
      // En AUTO, el título se lee con el lector latino y, uno de cada tres intentos, con el japonés.
      const titleCode = lang === "auto" ? (S.n % 3 === 2 ? "jpn" : "eng") : code;
      lines = await readStrips(await getWorker(titleCode, `title:${titleCode}`, 6), strips);
    }
    if (!S.running || S.paused) return;
    // Sin texto durante un rato: puede que esta cámara no enfoque de cerca → probar la siguiente trasera (y recordarla)
    S.noText = lines.some((l) => /[a-z]{3}/i.test(l.text)) ? 0 : (S.noText || 0) + 1;
    if (S.noText >= 18 && !S.autoSwitching) { S.noText = 0; autoNextCamera(); }
    const m = await api("/api/match", { lines, lang });
    const top = m[0];
    if (top && top.name === S.justAdded) {
      status("Añadida · Pon la siguiente carta");  // sigue la misma carta delante: no añadirla dos veces
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
      status(S.misses > 12 ? "¿Borrosa? Aleja el móvil un palmo y usa el zoom" : "Apunta a la carta, con luz y sin reflejos");
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
    status(added ? "Añadida · Pon la siguiente carta" : "Coloca la siguiente carta");
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
  const setIco = (x) => (x.icon ? `<img src="${esc(x.icon)}" alt="">` : ico("medal"));
  const got = m.ladder.filter((x) => x.done);
  body.innerHTML = `
    <div class="profile-head"><div class="avatar">${esc((p.name || "?").slice(0, 1).toUpperCase())}</div>
      <div><h3>${esc(p.name || "Tu perfil")}</h3><div class="sub">${plural(m.cards, "carta", "cartas")} · ${euro(m.value)} · ${esc(m.binder)}</div></div></div>
    <h2>Tu cuenta</h2>
    ${Cloud.user
      ? `<div class="hint">Conectado como ${esc(Cloud.user)}. Tus cartas, carpetas y mazos se guardan solos en la nube: entra con tu nombre y contraseña en otro móvil o en la web.</div>
         <label class="toggle" style="margin:6px 0"><input type="checkbox" id="pf-lock" ${p.lock ? "checked" : ""}> Pedir la contraseña al abrir la app</label>
         <div id="pf-lockpass" hidden><input class="search" id="pf-lockpw" type="password" autocomplete="current-password" placeholder="Tu contraseña, para activarlo">
           <button class="btn primary block" id="pf-lockok" style="margin-top:6px">Activar</button></div>
         <div class="row-btns"><button class="btn" id="cl-out">Cerrar sesión</button><button class="btn primary" id="cl-push">${ico("cloud")}Guardar ahora</button></div>`
      : accountForm()}
    <label class="toggle" style="margin-top:10px"><input type="checkbox" id="pf-sound" ${store("sounds") === "0" ? "" : "checked"}> ${ico("bell")}Sonidos al añadir cartas</label>

    <h2>${ico("trophy")}Medallas (${m.sets.length + m.precons.length + got.length})</h2>
    <div class="medals">${got.map((x) => medal(`<i>${ico("trophy")}</i>`, x.label)).join("")}</div>
    ${m.sets.length ? `<h2>Colecciones completas (${m.sets.length})</h2><div class="medals">${m.sets.map((x) => medal(setIco(x), x.name, `${x.total} cartas`)).join("")}</div>` : ""}
    ${m.precons.length ? `<h2>Mazos preconstruidos completos (${m.precons.length})</h2><div class="medals">${m.precons.map((x) => medal(setIco(x), x.name, x.type)).join("")}</div>` : ""}
    ${m.decks.length ? `<h2>Mazos del meta que puedes montar (${m.decks.length})</h2><div class="medals">${m.decks.map((x) => medal(`<i>${ico("meta")}</i>`, x)).join("")}</div>` : ""}
    ${m.near.length ? `<h2>A punto de conseguir</h2><div class="list">${m.near.map((x) => `<button class="item" data-set="${esc(x.code)}">
        <div class="item-main"><div class="item-title">${esc(x.name)}</div><div class="bar"><i style="width:${x.pct}%"></i></div>
        <div class="item-meta">${x.owned}/${x.total} · ${x.pct}%</div></div></button>`).join("")}</div>` : ""}
    ${!m.sets.length && !m.precons.length ? `<div class="hint">Completa una colección o un mazo preconstruido para ganar su medalla.</div>` : ""}
    <div class="medals">${m.ladder.filter((x) => !x.done).slice(0, 3).map((x) => `<div class="medal locked">${ico("lock")}<div><b>${esc(x.label)}</b></div></div>`).join("")}</div>

    <h2>Importar y copias de seguridad</h2>
    <button class="btn block" id="pf-import">${ico("import")}Importar cartas de otra app (CSV)</button>
    <div class="hint">El CSV lleva todas tus carpetas y se puede importar aquí, en ManaBox o en Moxfield. La copia completa guarda también tus mazos y el perfil.</div>
    <button class="btn block" id="pf-csv">${ico("export")}Exportar todas mis cartas (CSV)</button>
    <div class="row-btns"><button class="btn" id="pf-mox">${ico("export")}Para Moxfield</button><button class="btn" id="pf-mana">${ico("export")}Para ManaBox</button></div>
    <button class="btn block" id="pf-json" style="margin-top:8px">${ico("save")}Copia completa (para otro móvil)</button>
    <label class="btn block" for="pf-restore" style="margin-top:8px">${ico("refresh")}Restaurar una copia completa</label><input type="file" id="pf-restore" accept=".json,application/json" hidden>
    <button class="btn block" id="pf-credits" style="margin-top:14px">Créditos</button>`;
  body.querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => setSheet(b.dataset.set)));
  bindAccountForm(body, profileSheet);
  $("#pf-lock", body)?.addEventListener("change", async (e) => {
    if (!e.target.checked) { await api("/api/profile", { lock: false }); toast("La app se abrirá sin pedir la contraseña"); return; }
    if (p.hash) { await api("/api/profile", { lock: true }); toast("La app pedirá la contraseña al abrirla"); return; }
    $("#pf-lockpass", body).hidden = false; $("#pf-lockpw", body).focus();  // perfil sin contraseña guardada: se comprueba con la de la cuenta
  });
  $("#pf-lockok", body)?.addEventListener("click", async () => {
    const pw = $("#pf-lockpw", body).value;
    if (!(await Cloud.check(pw))) return toast("Contraseña incorrecta");
    const salt = newSalt();
    await api("/api/profile", { salt, hash: await hashPassword(pw, salt), lock: true });
    toast("La app pedirá la contraseña al abrirla"); profileSheet();
  });
  $("#cl-out", body)?.addEventListener("click", () => {
    if (!confirm(t("¿Cerrar sesión? Lo de este móvil se queda aquí; tu cuenta sigue guardada en la nube."))) return;
    Cloud.logout(); toast("Sesión cerrada"); profileSheet();
  });
  $("#cl-push", body)?.addEventListener("click", () => Cloud.push().then(() => toast("Guardado en la nube")).catch((e) => toast(e.message)));
  $("#pf-sound", body).onchange = (e) => { store("sounds", e.target.checked ? "1" : "0"); if (e.target.checked) Sfx.card(5); };
  const day = new Date().toISOString().slice(0, 10);
  $("#pf-import", body).onclick = importSheet;
  $("#pf-credits", body).onclick = creditsSheet;
  $("#pf-csv", body).onclick = async () => {
    const r = await api("/api/exportcsv");
    if (!r.rows) return toast("Aún no tienes cartas");
    saveFile(`gather-in-one-${day}.csv`, r.csv, "text/csv");
  };
  for (const [btn, fmt, how] of [["#pf-mox", "moxfield", "En Moxfield: Collection → Import → CSV."], ["#pf-mana", "manabox", "En ManaBox: Collection → Import → CSV."]]) {
    $(btn, body).onclick = async () => {
      const r = await api(`/api/exportcsv?fmt=${fmt}`);
      if (!r.rows) return toast("Aún no tienes cartas");
      saveFile(`gather-in-one-${fmt}-${day}.csv`, r.csv, "text/csv");
      toast(how);
    };
  }
  $("#pf-json", body).onclick = () => saveFile(`gather-in-one-copia-${day}.json`, Engine.exportUser(), "application/json");
  $("#pf-restore", body).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f || !confirm(t("¿Reemplazar todo lo de este móvil (cartas, carpetas, mazos y perfil) por la copia?"))) return;
    try { await Engine.importUser(await f.text()); toast("Copia restaurada"); closeSheet(); loadSummary(); render(); }
    catch (err) { toast(err.message); }
  };
}

// ---------- tu cuenta: nombre y contraseña; se crea directamente en la nube ----------
function accountForm() {
  return `<div class="hint">Con un nombre y una contraseña tus cartas, carpetas y mazos se guardan en la nube y los ves en cualquier móvil, también en iPhone desde la web. Sin correo.</div>
    <form id="acc-form" autocomplete="on">
      <input class="search" id="cl-user" name="username" autocomplete="username" autocapitalize="none" placeholder="Nombre de usuario">
      <input class="search" id="cl-pass" name="password" type="password" autocomplete="current-password" placeholder="Contraseña (mínimo 6)" style="margin-top:8px">
      <label class="toggle" style="margin:8px 0"><input type="checkbox" id="cl-lock"> Pedir la contraseña al abrir la app</label>
      <div class="row-btns"><button type="button" class="btn" id="cl-new">Crear cuenta</button><button type="submit" class="btn primary" id="cl-in">Entrar</button></div>
    </form>`;
}
function bindAccountForm(root, after) {
  const enter = async (create) => {
    try {
      const user = $("#cl-user", root).value, pass = $("#cl-pass", root).value;
      const row = await Cloud.login(user, pass, create);
      const local = (await api("/api/collections")).reduce((n, b) => n + b.cards, 0);
      if (row.data && (!local || confirm(t("Tu cuenta ya tiene datos guardados. ¿Cargarlos en este móvil? (Cancelar = subir a tu cuenta lo de este móvil)")))) {
        await Cloud.apply(row.data);
        cid = 1; store("cid", "1");
        toast("Datos de tu cuenta cargados");
      } else toast(create ? "Cuenta creada: tus datos ya están en la nube" : "Datos de este móvil subidos a tu cuenta");
      // La misma contraseña abre la app (si lo pides): se guarda una huella en este móvil
      const salt = newSalt();
      await api("/api/profile", { name: Cloud.user, salt, hash: await hashPassword(pass, salt), lock: $("#cl-lock", root).checked });
      await Cloud.push();
      store("accountAsked", "1");
      loadSummary(); render(); after?.();
    } catch (err) { toast(err.message); }
  };
  $("#acc-form", root)?.addEventListener("submit", (e) => { e.preventDefault(); enter(false); });
  $("#cl-new", root)?.addEventListener("click", () => enter(true));
}
// La primera vez (sin cuenta): crear cuenta o entrar, o "Ahora no"
function accountWelcome() {
  if (!Cloud.ready || Cloud.user || store("accountAsked")) return;
  const body = openSheet(`<h3>Tu cuenta</h3>${accountForm()}<button class="btn block" id="acc-later" style="margin-top:10px">Ahora no</button>`);
  bindAccountForm(body, closeSheet);
  $("#acc-later", body).onclick = () => { store("accountAsked", "1"); closeSheet(); };
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
    timer = setTimeout(() => push().catch((e) => toast(`No se ha podido guardar en la nube: ${e.message}`)), 3000);
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
    async check(pass) { return !!session && (await hashPassword(pass, `gathering-market:${session.user}`)) === session.key; },
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
  if (!p.lock) return;
  await new Promise((done) => {
    // Un <form>: Intro envía, y el navegador (y los gestores de contraseñas) lo tratan como un inicio de sesión normal.
    document.body.insertAdjacentHTML("beforeend", `<div class="lock-screen" id="lock">
      <svg class="crest" viewBox="0 0 64 64"><use href="#i-crest"/></svg>
      <h3>${esc(p.name ? `Hola, ${p.name}` : "Gather in One")}</h3>
      <form id="lock-form" class="lock-form" autocomplete="on">
        <input type="text" name="username" autocomplete="username" value="${esc(p.name || "")}" hidden>
        <div class="lock-row"><input class="search" id="lock-pass" name="password" type="password" autocomplete="current-password" placeholder="Contraseña" autofocus>
          <button type="button" class="btn" id="lock-eye" aria-label="Mostrar la contraseña">${ico("eye")}</button></div>
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
    // En Android, la tarea en segundo plano ya avisa de los precios: aquí solo lo demás (colecciones que salen hoy…)
    for (const a of r.alerts) if (!(Runner && (a.kind === "price" || a.kind === "wish"))) notifyLocal(a);  // en Android ya avisa la tarea en segundo plano
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
  if (await openDeckLink()) { /* abierto un mazo compartido */ }
  else if (!store("accountAsked") && !Cloud.user) accountWelcome(); else dailyReport();
  syncRunner();
  Cloud.sync().then((r) => { if (r === "pulled") { cid = 1; store("cid", "1"); loadSummary(); render(); toast("Datos actualizados desde tu cuenta"); } })
    .catch(() => toast("Sin conexión con la nube: se guardará cuando vuelva"));
}

// ---------- créditos: de dónde sale todo lo que usa la app ----------
function creditsSheet() {
  const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  const item = (title, text) => `<div class="item"><div class="item-main"><div class="item-title">${title}</div><div class="item-meta">${text}</div></div></div>`;
  openSheet(`<h3>Créditos</h3>
    <h2>Iconos</h2><div class="list">
      ${item(link("https://www.flaticon.com/", "Flaticon"), "Iconos de la app (seguir, sinergias, predicciones, colecciones, alteradas, trofeo, subidas y bajadas, meta, carpetas, imágenes…) de www.flaticon.com.")}
    </div>
    <h2>Datos</h2><div class="list">
      ${item(link("https://scryfall.com/", "Scryfall"), "Cartas, imágenes, legalidades y precios de Cardmarket de cada día.")}
      ${item(link("https://mtgjson.com/", "MTGJSON"), "Historial de precios de Cardmarket de los últimos 90 días.")}
      ${item(link("https://www.mtgtop8.com/", "MTGTop8"), "Meta de cada formato, listas de torneo y ganadores (también el Super Pauper de inGenio BCN Games).")}
      ${item(link("https://commanderspellbook.com/", "Commander Spellbook"), "Combos infinitos de dos cartas y sus pasos.")}
      ${item(link("https://magic.wizards.com/", "Wizards of the Coast"), "Fechas de los anuncios de baneos.")}
    </div>
    <h2>Herramientas</h2><div class="list">
      ${item(link("https://tesseract.projectnaptha.com/", "Tesseract.js"), "Lector de texto del escáner de cartas.")}
      ${item(link("https://capacitorjs.com/", "Capacitor"), "App de Android.")}
      ${item(link("https://supabase.com/", "Supabase"), "Cuentas en la nube.")}
      ${item(link("https://fonts.google.com/specimen/Cinzel", "Cinzel"), "y EB Garamond: tipografías.")}
    </div>
    <div class="hint" style="margin-top:12px">Gather in One es contenido no oficial permitido por la Fan Content Policy de Wizards of the Coast. No está aprobado ni respaldado por Wizards. Partes de los materiales usados son propiedad de Wizards of the Coast. ©Wizards of the Coast LLC.</div>`);
}

// ---------- resumen del día: al abrir la app (una vez por día de precios), qué cartas tuyas subieron y bajaron ----------
async function dailyReport() {
  try {
    const m = await Engine.call("/api/movers?scope=collection&days=1&min=0.5&c=1");
    if (!m.up.length && !m.down.length) return;
    if (store("dailyReport") === m.latest) return;
    store("dailyReport", m.latest);
    const real = (l) => l.filter((i) => Math.abs(i.pct) >= 2).slice(0, 12);
    const up = real(m.up), down = real(m.down);
    if (!up.length && !down.length) return;
    const tile = (i) => `<button class="day-card" data-follow="${esc(i.name)}" data-pid="${esc(i.id)}">
      <img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy"><span class="day-pct ${i.pct > 0 ? "up" : "down"}">${ico(i.pct > 0 ? "up" : "down")}${pct(i.pct)}</span>
      <span class="day-eur">${euro(i.old)} → <b>${euro(i.new)}</b></span></button>`;
    const body = openSheet(`<h3>Tus cartas desde ayer</h3><div class="hint">Del ${esc(m.base)} al ${esc(m.latest)} · cartas de 0,50 € o más. Toca una para ver su gráfica.</div>
      ${up.length ? `<h2>${ico("up")}Han subido</h2><div class="day-grid">${up.map(tile).join("")}</div>` : ""}
      ${down.length ? `<h2>${ico("down")}Han bajado</h2><div class="day-grid">${down.map(tile).join("")}</div>` : ""}`);
    body.querySelectorAll("[data-follow]").forEach((el) => (el.onclick = () => synergySheet(el.dataset.follow, el.dataset.pid)));
  } catch { /* sin precios de ayer todavía */ }
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
  Native.BackgroundRunner?.requestPermissions({ apis: ["notifications"] }).catch(() => {});
  Native.App?.addListener("pause", syncRunner);  // al salir de la app, la lista de cartas al día
}

// Tarea en segundo plano (mobile/runners/background.js): avisa de tus cartas aunque la app esté cerrada.
const Runner = Native?.BackgroundRunner || null;
async function syncRunner() {
  if (!Runner) return;
  try { await Runner.dispatchEvent({ label: "app.gatheringmarket.prices", event: "syncCollection", details: await Engine.call("/api/watchids") }); }
  catch { /* sin tarea en segundo plano (navegador o APK antiguo) */ }
}

// Notificación del sistema (en la app de Android); en el navegador no hace nada.
function notifyLocal(e) {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN) return;
  LN.schedule({ notifications: [{ id: Math.floor(Math.random() * 2 ** 31), title: String(e.title).replace(/^\p{Extended_Pictographic}️?\s*/u, ""), body: e.body || "" }] }).catch(() => {});  // sin emojis
}

boot();
