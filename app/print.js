"use strict";
/* Imprimir (pestaña propia, como MTG Print): pegas una lista, buscas cartas o traes un mazo de la app; eliges el arte de
 * cada carta (todas las ediciones, por tipo de arte y por idioma) o subes tu imagen; ves cómo quedan las hojas y luego
 * descargas el PDF. Cartas a 63 × 88 mm, 9 por hoja, con líneas de corte negras de lado a lado de la hoja para la guillotina.
 * El PDF se escribe aquí mismo (sin librerías): imágenes JPEG a 300 ppp y líneas.
 * Usa lo de app.js: $, esc, toast, api, openSheet, closeSheet, ico, skeleton, defaultPrint, plural, saveFile, views. */

const Print = (() => {
  const PT = 72 / 25.4, DPI_MM = 300 / 25.4, CW = 63, CH = 88;  // puntos por mm; píxeles por mm a 300 ppp; carta en mm
  const PAPERS = { a4: [210, 297, "A4"], letter: [215.9, 279.4, "Carta (EE. UU.)"] };
  const WEIGHTS = { thick: [0.5, "Gruesas"], normal: [0.25, "Finas"] };  // grosor de las líneas de corte (mm)
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  let list = load("printList", []);  // [{ name, n, img, pid }]; img: URL de Scryfall o "custom:<clave>"
  const customs = load("printCustom", {});  // imágenes subidas (data URL)
  const opt = { paper: "a4", lines: "full", weight: "thick", bleed: 0, back: "none", ...load("printOpt", {}) };
  let backCustom = load("printBack", "");  // dorso subido (data URL)
  // Dorso propio de la app (no el oficial de Magic: con ese, un proxy no se distingue de una carta de verdad)
  let appBackUrl = "";
  function appBack() {
    if (appBackUrl) return appBackUrl;
    const W = 745, H = 1040, c = document.createElement("canvas"), g = c.getContext("2d"), font = getComputedStyle(document.body).getPropertyValue("--display") || "serif";
    c.width = W; c.height = H;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    g.fillStyle = "#0b0704"; g.fillRect(0, 0, W, H);
    const grd = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 620);
    grd.addColorStop(0, "#4a3018"); grd.addColorStop(1, "#140c06");
    g.fillStyle = grd; rr(34, 34, W - 68, H - 68, 26); g.fill();
    g.strokeStyle = "#d6a84e"; g.lineWidth = 6; rr(46, 46, W - 92, H - 92, 22); g.stroke();
    g.lineWidth = 2; rr(62, 62, W - 124, H - 124, 18); g.stroke();
    g.save(); g.translate(W / 2, 430); g.rotate(Math.PI / 4); g.lineWidth = 9; g.strokeRect(-115, -115, 230, 230); g.lineWidth = 3; g.strokeRect(-84, -84, 168, 168);
    g.fillStyle = "rgba(214,168,78,.18)"; g.fillRect(-84, -84, 168, 168); g.restore();
    g.fillStyle = "#e7c477"; g.textAlign = "center";
    g.font = `700 70px ${font}`; g.fillText("GATHER", W / 2, 720); g.fillText("IN ONE", W / 2, 800);
    g.font = `600 34px ${font}`; g.fillStyle = "#b8862b"; g.fillText("PROXY", W / 2, 900);
    return (appBackUrl = c.toDataURL("image/jpeg", 0.95));
  }
  const backSrc = () => (opt.back === "app" ? appBack() : opt.back === "custom" ? backCustom : "");
  const persist = () => { keep("printList", list); keep("printOpt", opt); };
  const srcOf = (x) => (String(x.img || "").startsWith("custom:") ? customs[x.img.slice(7)] : x.img) || "";
  // La imagen grande de Scryfall (745 × 1040, PNG) para imprimir; la "normal" es pequeña para 300 ppp
  const hiRes = (url) => (/^https:\/\/cards\.scryfall\.io\/(normal|large)\//.test(url) ? url.replace(/\/(normal|large)\//, "/png/").replace(/\.jpg(\?|$)/, ".png$1") : url);
  const total = () => list.reduce((s, x) => s + x.n, 0);

  async function addCards(rows) {  // rows: [[nombre, copias]]
    for (const [name, n] of rows) {
      const ex = list.find((x) => x.name === name);
      if (ex) { ex.n += n; continue; }
      const ps = await api(`/api/printings?name=${encodeURIComponent(name)}`).catch(() => []);
      const id = ps.length ? defaultPrint({ printings: ps }) : null, p = ps.find((x) => x.id === id);
      list.push({ name, n, img: p?.image || "", pid: id });
    }
    persist();
  }

  /** Desde la ficha de un mazo: todo el mazo o solo lo que te falta. Lleva a la pestaña Imprimir. */
  async function fromDeck(d, onlyMissing) {
    if (list.length && !confirm(t("Ya tienes cartas en Imprimir. ¿Cambiarlas por las de este mazo?"))) { location.hash = "#print"; return; }
    list = [];
    const rows = new Map();
    for (const c of d.cards) rows.set(c.name, (rows.get(c.name) || 0) + (onlyMissing ? (c.basic ? 0 : Math.max(0, c.qty - c.have)) : c.qty));
    await addCards([...rows].map(([n, q]) => [n, q]));
    list.sort((a, b) => (b.n > 0) - (a.n > 0));
    opt.title = d.archetype; persist();
    closeSheet();
    if (location.hash === "#print") view(); else location.hash = "#print";
    toast(onlyMissing ? "Lo que te falta, listo para imprimir" : "Mazo listo para imprimir");
  }

  function view() {
    const v = $("#view"), n = total(), pages = Math.ceil(n / 9), holes = n ? (9 - (n % 9)) % 9 : 0;
    const seg = (k, items) => `<div class="seg" data-o="${k}">${items.map(([val, label]) => `<button data-v="${val}" class="${String(opt[k]) === String(val) ? "on" : ""}">${label}</button>`).join("")}</div>`;
    v.innerHTML = `<h2 style="margin-top:6px">${ico("print")}Imprimir proxies</h2>
      <div class="hint">Pega una lista, busca cartas o trae un mazo desde Mazos. Toca una carta para elegir su arte (edición, tipo de arte, idioma) o subir tu imagen. Antes de descargar ves cómo quedan las hojas.</div>
      <div class="row-btns" style="margin-top:4px"><button class="btn" id="pr-paste">${ico("list")}Pegar lista</button><button class="btn" id="pr-deck">${ico("swords")}De un mazo</button>${list.length ? `<button class="btn" id="pr-clear">${ico("trash")}Vaciar</button>` : ""}</div>
      <input class="search" id="pr-q" placeholder="Buscar una carta para añadir…" autocomplete="off"><div class="list" id="pr-res"></div>
      ${list.length ? `<div class="grid pr-grid">${list.map((x, i) => `<div class="gcard ${x.n ? "" : "missing"}">
          ${srcOf(x) ? `<img loading="lazy" src="${esc(srcOf(x))}" alt="${esc(x.name)}" data-art="${i}">` : `<button class="pr-noimg" data-art="${i}">${esc(x.name)}</button>`}
          <div class="mini-step"><button data-pn="${i}" data-d="-1" ${x.n ? "" : "disabled"} aria-label="Una menos">−</button><b>${x.n}</b><button data-pn="${i}" data-d="1" aria-label="Una más">+</button></div></div>`).join("")}</div>
        ${holes ? `<div class="hint">${ico("warn")}En la última hoja quedan ${plural(holes, "hueco", "huecos")}: busca cartas arriba para aprovecharla.</div>` : ""}
        <div class="field"><label>Papel</label>${seg("paper", Object.entries(PAPERS).map(([k, p]) => [k, p[2]]))}</div>
        <div class="field"><label>Líneas de corte</label>${seg("lines", [["full", "De lado a lado de la hoja"], ["marks", "Solo en los márgenes"]])}${seg("weight", Object.entries(WEIGHTS).map(([k, w]) => [k, w[1]]))}
          <div class="sub">Negras, rectas y entre cada carta, para que la guillotina corte recto.</div></div>
        <div class="field"><label>Dorso (parte de atrás)</label>${seg("back", [["none", "Sin dorso"], ["app", "Dorso de la app"], ["custom", "El mío"]])}
          ${opt.back !== "none" ? `<div class="pr-back-row">${backSrc() ? `<img src="${esc(backSrc())}" alt="Dorso">` : ""}${opt.back === "custom" ? `<label class="btn" for="pr-backup">${ico("image")}${backCustom ? "Cambiar mi dorso" : "Subir mi dorso"}</label><input type="file" id="pr-backup" accept="image/*" hidden>` : ""}</div>
          <div class="sub">Detrás de cada hoja va otra con los dorsos, colocados para imprimir a doble cara girando por el borde largo. Haz primero una hoja de prueba: algunas impresoras mueven un poco la cara de atrás.</div>` : ""}</div>
        <details class="guide"><summary>Más opciones</summary><div class="field"><label>Sangrado</label>${seg("bleed", [[0, "Sin"], [1, "1 mm"], [2, "2 mm"]])}
          <div class="sub">Imagen de más alrededor de cada carta (los bordes se alargan), por si el corte se desvía. Casi nunca hace falta.</div></div></details>
        <button class="btn block primary" id="pr-go" ${n ? "" : "disabled"} style="margin-top:12px">${ico("eye")}Ver cómo queda (${plural(n, "carta", "cartas")}, ${plural(pages, "hoja", "hojas")})</button>`
      : `<div class="empty"><strong>Aún no hay cartas para imprimir</strong>Pega una lista, busca cartas o, en Mazos, abre uno y pulsa «Imprimir».</div>`}`;
    v.querySelectorAll("[data-o]").forEach((s) => s.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      opt[s.dataset.o] = s.dataset.o === "bleed" ? +b.dataset.v : b.dataset.v; persist(); view();
    })));
    $("#pr-backup", v)?.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const im = await loadImg(URL.createObjectURL(f)), s = Math.min(1, 1040 / im.height), c = document.createElement("canvas");
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      backCustom = c.toDataURL("image/jpeg", 0.92);
      if (!keep("printBack", backCustom)) toast("No cabe para guardarlo: se usará solo esta vez");
      view();
    });
    v.querySelectorAll("[data-pn]").forEach((b) => (b.onclick = () => { const x = list[+b.dataset.pn]; x.n = Math.max(0, x.n + +b.dataset.d); persist(); view(); }));
    v.querySelectorAll("[data-art]").forEach((b) => (b.onclick = () => artSheet(+b.dataset.art)));
    $("#pr-clear", v)?.addEventListener("click", () => { if (confirm(t("¿Quitar todas las cartas de Imprimir?"))) { list = []; delete opt.title; persist(); view(); } });
    $("#pr-paste", v).onclick = pasteSheet;
    $("#pr-deck", v).onclick = deckPick;
    $("#pr-go", v)?.addEventListener("click", preview);
    let tq;
    $("#pr-q", v).oninput = (e) => {
      clearTimeout(tq);
      tq = setTimeout(async () => {
        const q = e.target.value.trim(), box = $("#pr-res", v);
        if (q.length < 2) { box.innerHTML = ""; return; }
        const res = (await api(`/api/search?q=${encodeURIComponent(q)}`)).slice(0, 6);
        box.innerHTML = res.map((r) => `<button class="item" data-add="${esc(r.name)}"><img class="thumb" src="${esc(r.image || "")}" alt=""><div class="item-main"><div class="item-title">${esc(r.name)}</div></div><div class="item-side">${ico("plus")}</div></button>`).join("")
          || `<div class="hint">No la encuentro.</div>`;
        box.querySelectorAll("[data-add]").forEach((b) => (b.onclick = async () => { await addCards([[b.dataset.add, 1]]); toast(`${b.dataset.add} añadida`); view(); }));
      }, 250);
    };
  }

  function pasteSheet() {
    const body = openSheet(`<h3>Pegar una lista</h3><div class="hint">Una carta por línea: <code>4 Lightning Bolt</code> (como en Moxfield, MTGTop8 o Arena). Se suman a las que ya hay.</div>
      <textarea class="search" id="pr-text" rows="10" placeholder="4 Lightning Bolt&#10;20 Mountain"></textarea>
      <div class="row-btns"><button class="btn" id="pr-cancel">Volver</button><button class="btn primary" id="pr-ok">Añadir</button></div><div id="pr-bad"></div>`);
    $("#pr-cancel", body).onclick = closeSheet;
    $("#pr-ok", body).onclick = async () => {
      const r = await api("/api/parselist", { text: $("#pr-text", body).value });
      const rows = new Map();
      for (const [name, q] of r.cards) rows.set(name, (rows.get(name) || 0) + q);
      await addCards([...rows]);
      if (r.unknown.length) { $("#pr-bad", body).innerHTML = `<div class="warn">No he reconocido:<br>${r.unknown.slice(0, 15).map(esc).join("<br>")}</div>`; view(); return; }
      closeSheet(); view(); toast(`${plural([...rows].reduce((s, [, q]) => s + q, 0), "carta añadida", "cartas añadidas")}`);
    };
  }

  async function deckPick() {
    const mine = await api("/api/mydecks");
    const body = openSheet(`<h3>De un mazo</h3><div class="hint">Elige uno de tus mazos. Los del meta: ábrelos en Mazos y pulsa «Imprimir».</div>
      ${mine.length ? `<div class="list">${mine.map((d) => `<div class="item"><div class="item-main"><div class="item-title">${esc(d.archetype)}</div></div>
        <div class="item-side row-btns" style="margin:0"><button class="btn" data-dk="${esc(d.id)}" data-m="0">Todo</button><button class="btn" data-dk="${esc(d.id)}" data-m="1">Lo que falta</button></div></div>`).join("")}</div>`
        : `<div class="empty"><strong>No tienes mazos guardados</strong>Ve a Mazos, abre uno y pulsa «Imprimir».</div>`}
      <button class="btn block" id="pr-back" style="margin-top:8px">Volver</button>`);
    $("#pr-back", body).onclick = closeSheet;
    body.querySelectorAll("[data-dk]").forEach((b) => (b.onclick = async () => fromDeck(await api(`/api/deck?id=${encodeURIComponent(b.dataset.dk)}`), b.dataset.m === "1")));
  }

  // ---- Elegir el arte: ediciones de Scryfall filtradas por tipo de arte e idioma, o una imagen tuya
  const KINDS = [["", "Todas"], ["-is:borderless -is:full -is:showcase -is:extendedart", "Normales"], ["is:borderless", "Sin borde"], ["is:full", "Arte completo"],
    ["is:showcase", "Showcase"], ["is:extendedart", "Arte extendido"], ["(frame:1993 or frame:1997)", "Marco antiguo"]];
  const LANGS = [["en", "Inglés"], ["es", "Español"], ["fr", "Francés"], ["de", "Alemán"], ["it", "Italiano"], ["pt", "Portugués"], ["ja", "Japonés"], ["ko", "Coreano"], ["ru", "Ruso"], ["zhs", "Chino simpl."], ["zht", "Chino trad."]];
  const artPick = { kind: "", lang: load("printLang", "en") };
  const big = (url) => String(url || "").replace("/normal/", "/large/");  // 672 × 936: se lee el texto
  const imgOf = (c) => (c.image_uris || c.card_faces?.[0]?.image_uris)?.normal;
  async function artSheet(i) {
    const x = list[i];
    const body = openSheet(`<button class="btn" id="pr-back">${ico("back")}Volver</button>
      <h3 style="margin-top:8px">Arte de ${esc(x.name)}</h3>
      <div class="pr-big"><img id="pr-bigimg" src="${esc(big(srcOf(x)))}" alt="${esc(x.name)}"><div class="pr-big-side"><div class="sub" id="pr-biglabel">El arte que tienes ahora. Toca otro abajo para verlo en grande.</div>
        <button class="btn primary" id="pr-use" hidden>${ico("check")}Usar este arte</button></div></div>
      <div class="field"><label>Tipo de arte</label><div class="seg wrap" id="pr-kind">${KINDS.map(([k, n]) => `<button data-k="${esc(k)}" class="${artPick.kind === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <div class="field"><label>Idioma de la carta</label><select class="lang-sel" id="pr-lang">${LANGS.map(([k, n]) => `<option value="${k}" ${artPick.lang === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="row-btns" style="margin-top:0"><label class="btn" for="pr-up">${ico("image")}Subir mi imagen</label>${x.img?.startsWith("custom:") ? `<button class="btn" id="pr-reset">Quitar mi imagen</button>` : ""}</div>
      <input type="file" id="pr-up" accept="image/*" hidden>
      <div class="sub">Tu imagen: la carta entera, mejor de 745 × 1040 px (63 × 88 mm a 300 ppp).</div>
      <div class="arts pr-arts wrap" id="pr-arts">${skeleton(2)}</div>`);
    $("#pr-back", body).onclick = closeSheet;
    $("#pr-bigimg", body).onclick = (e) => e.currentTarget.classList.toggle("zoom");
    const pick = (img, pid) => { x.img = img; if (pid) x.pid = pid; persist(); closeSheet(); view(); };
    $("#pr-reset", body)?.addEventListener("click", async () => {
      delete customs[x.img.slice(7)]; keep("printCustom", customs);
      const ps = await api(`/api/printings?name=${encodeURIComponent(x.name)}`), id = ps.length ? defaultPrint({ printings: ps }) : null;
      pick(ps.find((p) => p.id === id)?.image || "", id);
    });
    $("#pr-up", body).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const im = await loadImg(URL.createObjectURL(f)), s = Math.min(1, 1040 / im.height), c = document.createElement("canvas");
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      const key = `${Date.now()}`;
      customs[key] = c.toDataURL("image/jpeg", 0.92);
      if (!keep("printCustom", customs)) toast("No cabe para guardarla: se usará solo esta vez");
      pick(`custom:${key}`, null); toast("Imagen puesta");
    };
    const draw = async () => {
      const box = $("#pr-arts", body);
      box.innerHTML = skeleton(2);
      let cards = [];
      try {
        const q = `!"${x.name}" ${artPick.kind} lang:${artPick.lang}`.trim();
        const r = await fetch(`https://api.scryfall.com/cards/search?unique=prints&order=released&q=${encodeURIComponent(q)}`);
        cards = r.ok ? (await r.json()).data.filter((c) => imgOf(c) && c.name.split(" // ")[0] === x.name.split(" // ")[0]).map((c) => ({ id: c.id, img: imgOf(c), label: `${c.set.toUpperCase()} #${c.collector_number}` })) : [];
      } catch {  // sin internet: las ediciones que conoce la app (en inglés)
        if (!artPick.kind && artPick.lang === "en") cards = (await api(`/api/printings?name=${encodeURIComponent(x.name)}`)).filter((p) => p.image).map((p) => ({ id: p.id, img: p.image, label: `${p.set.toUpperCase()} #${p.number}` }));
      }
      box.innerHTML = cards.map((c) => `<button class="art ${x.img === c.img ? "on" : ""}" data-img="${esc(c.img)}" data-id="${esc(c.id)}"><img loading="lazy" src="${esc(c.img)}" alt=""><span>${esc(c.label)}</span></button>`).join("")
        || `<div class="hint">No hay ${artPick.kind ? "artes de ese tipo" : "imágenes"} de esta carta en ${esc(LANGS.find((l) => l[0] === artPick.lang)[1].toLowerCase())}.</div>`;
      // Tocar: se ve en grande arriba (para leer el texto y ver la calidad); «Usar este arte» lo elige
      box.querySelectorAll("[data-img]").forEach((b) => (b.onclick = () => {
        $("#pr-bigimg", body).src = big(b.dataset.img);
        $("#pr-biglabel", body).textContent = b.querySelector("span").textContent;
        const use = $("#pr-use", body);
        use.hidden = false; use.onclick = () => pick(b.dataset.img, b.dataset.id);
        box.querySelectorAll(".art").forEach((y) => y.classList.toggle("on", y === b));
        $("#pr-bigimg", body).scrollIntoView({ behavior: "smooth", block: "nearest" });
      }));
    };
    body.querySelectorAll("#pr-kind button").forEach((b) => (b.onclick = () => { artPick.kind = b.dataset.k; body.querySelectorAll("#pr-kind button").forEach((y) => y.classList.toggle("on", y === b)); draw(); }));
    $("#pr-lang", body).onchange = (e) => { artPick.lang = e.target.value; keep("printLang", artPick.lang); draw(); };
    draw();
  }

  const loadImg = (src) => new Promise((ok, ko) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => ok(im);
    im.onerror = () => ko(new Error("No se ha podido bajar una imagen (¿sin internet?)"));
    im.src = src;
  });

  /** Una carta a 300 ppp con su sangrado: los bordes de la imagen se estiran hacia fuera (sin bordes blancos). */
  const jpegCache = new Map();
  async function cardJpeg(src, bleed) {
    const k = `${bleed}|${src}`;
    if (jpegCache.has(k)) return jpegCache.get(k);
    const im = await loadImg(hiRes(src)).catch(() => loadImg(src));
    const W = Math.round(CW * DPI_MM), H = Math.round(CH * DPI_MM), B = Math.round(bleed * DPI_MM), c = document.createElement("canvas");
    c.width = W + 2 * B; c.height = H + 2 * B;
    const g = c.getContext("2d"), sx = im.width / W, sy = im.height / H, r = Math.round(W * 0.06);  // r: esquinas redondeadas, no se estiran
    g.drawImage(im, 0, Math.round(im.height / 2), 1, 1, 0, 0, 1, 1);
    const [R, G, Bl] = g.getImageData(0, 0, 1, 1).data;  // color del borde (negro casi siempre)
    g.fillStyle = `rgb(${R},${G},${Bl})`; g.fillRect(0, 0, c.width, c.height);
    if (B) {
      g.drawImage(im, 0, r * sy, 1, (H - 2 * r) * sy, 0, B + r, B, H - 2 * r);
      g.drawImage(im, im.width - 1, r * sy, 1, (H - 2 * r) * sy, B + W, B + r, B, H - 2 * r);
      g.drawImage(im, r * sx, 0, (W - 2 * r) * sx, 1, B + r, 0, W - 2 * r, B);
      g.drawImage(im, r * sx, im.height - 1, (W - 2 * r) * sx, 1, B + r, B + H, W - 2 * r, B);
    }
    g.drawImage(im, B, B, W, H);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92));
    const out = { w: c.width, h: c.height, bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
    jpegCache.set(k, out);
    return out;
  }

  /** Dónde va cada carta y cada línea de corte, en mm desde arriba a la izquierda (lo usan la vista previa y el PDF). */
  function layout(n) {
    const [PW, PH] = PAPERS[opt.paper], b = opt.bleed, cw = CW + 2 * b, ch = CH + 2 * b, x0 = (PW - 3 * cw) / 2, y0 = (PH - 3 * ch) / 2;
    const pages = [];
    for (let p = 0; p < n; p += 9) {
      const k = Math.min(9, n - p), rows = Math.ceil(k / 3), cols = Math.min(3, k), cells = [], lines = [];
      for (let i = 0; i < k; i++) cells.push([x0 + (i % 3) * cw, y0 + Math.floor(i / 3) * ch, cw, ch]);
      const xs = new Set(), ys = new Set();
      for (let c = 0; c < cols; c++) { xs.add(+(x0 + c * cw + b).toFixed(3)); xs.add(+(x0 + c * cw + b + CW).toFixed(3)); }
      for (let r = 0; r < rows; r++) { ys.add(+(y0 + r * ch + b).toFixed(3)); ys.add(+(y0 + r * ch + b + CH).toFixed(3)); }
      const gx1 = x0 + cols * cw, gy1 = y0 + rows * ch;
      for (const x of xs) lines.push(...(opt.lines === "full" ? [[x, 0, x, PH]] : [[x, 0, x, y0 - 1], [x, gy1 + 1, x, PH]]));
      for (const y of ys) lines.push(...(opt.lines === "full" ? [[0, y, PW, y]] : [[0, y, x0 - 1, y], [gx1 + 1, y, PW, y]]));
      pages.push({ cells, lines, from: p });
    }
    return { PW, PH, pages };
  }

  async function preview() {
    const srcs = list.flatMap((x) => Array(x.n).fill(srcOf(x))).filter(Boolean);
    if (srcs.length < total()) return toast("Hay cartas sin imagen: tócalas y elige un arte");
    const body = openSheet(`<h3>Cómo quedará</h3><div class="hint" id="pv-msg">Preparando las imágenes…</div><div id="pv-pages"></div>`);
    const uniq = [...new Set(srcs)], imgs = new Map(), back = backSrc();
    if (opt.back === "custom" && !back) { closeSheet(); return toast("Sube primero tu dorso (o elige otro)"); }
    try {
      for (const [i, s] of uniq.entries()) { $("#pv-msg", body).textContent = t(`Preparando las imágenes: ${i + 1} de ${uniq.length}`); imgs.set(s, await cardJpeg(s, opt.bleed)); }
      if (back) imgs.set("back", await cardJpeg(back, opt.bleed));
    } catch (e) { $("#pv-msg", body).textContent = e.message; return; }
    const mirror = (cells) => cells.map(([x, y, w, h]) => [L.PW - x - w, y, w, h]);  // doble cara (borde largo): las columnas se invierten
    const L = layout(srcs.length), S = 3, lw = WEIGHTS[opt.weight][0];  // vista previa: 3 px por mm
    const pageImgs = [];
    for (const pg of L.pages) {
      const c = document.createElement("canvas"), g = c.getContext("2d");
      c.width = L.PW * S; c.height = L.PH * S;
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      for (const [k, [x, y, w, h]] of pg.cells.entries()) g.drawImage(await loadImg(imgs.get(srcs[pg.from + k]).url), x * S, y * S, w * S, h * S);
      g.strokeStyle = "#000"; g.lineWidth = Math.max(1, lw * S);
      for (const [ax, ay, bx, by] of pg.lines) { g.beginPath(); g.moveTo(ax * S, ay * S); g.lineTo(bx * S, by * S); g.stroke(); }
      pageImgs.push([c.toDataURL("image/jpeg", 0.8), `Hoja ${pageImgs.filter((p) => !p[2]).length + 1}`, false]);
      if (back) {
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        const bim = await loadImg(imgs.get("back").url);
        for (const [x, y, w, h] of mirror(pg.cells)) g.drawImage(bim, x * S, y * S, w * S, h * S);
        pageImgs.push([c.toDataURL("image/jpeg", 0.8), `${pageImgs[pageImgs.length - 1][1]} (detrás)`, true]);
      }
    }
    const holes = (9 - (srcs.length % 9)) % 9;
    $("#pv-msg", body).innerHTML = `${plural(srcs.length, "carta", "cartas")} en ${plural(L.pages.length, "hoja", "hojas")} ${esc(PAPERS[opt.paper][2])}${holes ? ` · quedan ${plural(holes, "hueco", "huecos")} en la última` : ""}. Al imprimir, elige «Tamaño real» o «100 %» (no «Ajustar a la página»).`;
    $("#pv-pages", body).innerHTML = `${pageImgs.map(([u, label, isBack]) => `<div class="pv-page ${isBack ? "back" : ""}"><img src="${u}" alt="${esc(label)}"><span>${esc(label)}</span></div>`).join("")}
      <div class="row-btns"><button class="btn" id="pv-back">Volver y cambiar</button><button class="btn primary" id="pv-dl">${ico("export")}Descargar PDF</button></div>`;
    $("#pv-back", body).onclick = closeSheet;
    $("#pv-dl", body).onclick = async () => {
      const images = [...uniq.map((s) => imgs.get(s)), ...(back ? [imgs.get("back")] : [])], f = (n) => (n * PT).toFixed(2), lwPt = (lw * PT).toFixed(2);
      const pages = L.pages.map((pg) => {
        let s = "";
        pg.cells.forEach(([x, y, w, h], k) => { s += `q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(L.PH - y - h)} cm /Im${uniq.indexOf(srcs[pg.from + k])} Do Q\n`; });
        s += `0 0 0 RG ${lwPt} w 0 J\n`;  // negro puro
        for (const [ax, ay, bx, by] of pg.lines) s += `${f(ax)} ${f(L.PH - ay)} m ${f(bx)} ${f(L.PH - by)} l S\n`;
        const front = { content: s, used: [...new Set(pg.cells.map((_, k) => uniq.indexOf(srcs[pg.from + k])))] };
        if (!back) return [front];
        const bi = uniq.length;
        return [front, { content: mirror(pg.cells).map(([x, y, w, h]) => `q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(L.PH - y - h)} cm /Im${bi} Do Q\n`).join(""), used: [bi] }];
      }).flat();
      const title = String(opt.title || "").replace(/[^\p{L}\p{N} _-]+/gu, "").trim(), name = title ? `${title} - proxies.pdf` : "proxies.pdf";
      const where = await savePdf(name, buildPdf(L.PW * PT, L.PH * PT, images, pages));
      if (where) afterDownload(where, name);
    };
  }

  // Guardar: en el móvil, en Documentos/Gather in One (y se dice dónde); en el navegador, se descarga
  async function savePdf(name, bytes) {
    const N = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
    if (N?.Filesystem) {
      let b64 = "";
      for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      try {
        const w = await N.Filesystem.writeFile({ path: `Gather in One/${name}`, data: btoa(b64), directory: "DOCUMENTS", recursive: true });
        return { label: `Documentos › Gather in One › ${name}`, uri: w.uri };
      } catch {
        await saveFile(name, bytes, "application/pdf");  // si Android no deja escribir en Documentos: «Compartir» para guardarlo donde quieras
        return { label: "donde lo hayas guardado desde «Compartir»" };
      }
    }
    await saveFile(name, bytes, "application/pdf");
    return { label: "tu carpeta de Descargas" };
  }

  function afterDownload(where, name) {
    const body = openSheet(`<h3>PDF guardado</h3><div class="hint">Está en <b>${esc(where.label)}</b>.</div>
      ${where.uri ? `<div class="row-btns" style="margin-top:0">${window.Capacitor?.Plugins?.FileOpener ? `<button class="btn" id="pd-open">${ico("eye")}Abrir el PDF</button>` : ""}
        ${window.Capacitor?.Plugins?.Share ? `<button class="btn primary" id="pd-share">${ico("export")}Enviar (correo, WhatsApp, Drive…)</button>` : ""}</div>` : ""}
      <h2>¿Añadir estas cartas a tu colección como proxies?</h2>
      <div class="hint">Así cuentan para montar tus mazos, pero no suman al valor de tu colección.</div>
      <div class="row-btns"><button class="btn" id="pd-no">No</button><button class="btn primary" id="pd-yes">Sí, como proxies</button></div>`);
    $("#pd-share", body)?.addEventListener("click", () => window.Capacitor.Plugins.Share.share({ title: name, files: [where.uri], dialogTitle: "Enviar el PDF" }).catch(() => {}));
    $("#pd-open", body)?.addEventListener("click", () => window.Capacitor.Plugins.FileOpener.open({ filePath: where.uri, contentType: "application/pdf", openWithDefault: true })
      .catch(() => toast("No hay ninguna app para abrir PDF: usa «Enviar» o ábrelo desde Archivos")));
    $("#pd-no", body).onclick = closeSheet;
    $("#pd-yes", body).onclick = async () => {
      let n = 0;
      for (const x of list.filter((y) => y.n)) {
        try {
          let id = x.pid;
          const ps = await api(`/api/printings?name=${encodeURIComponent(x.name)}`);
          if (!ps.some((p) => p.id === id)) id = ps.length ? defaultPrint({ printings: ps }) : null;  // arte en otro idioma: la edición normal
          if (!id) continue;
          await api("/api/collection", { c: 1, card_id: id, foil: false, qty: x.n });
          await api("/api/proxy", { c: 1, card_id: id, foil: false, delta: x.n });
          n += x.n;
        } catch { /* carta que la app no conoce */ }
      }
      closeSheet(); loadSummary(); toast(`${plural(n, "proxy añadido", "proxies añadidos")} a tu colección`);
    };
  }

  /** PDF 1.4 mínimo: catálogo, páginas, imágenes JPEG (DCTDecode) y el dibujo de cada página. */
  function buildPdf(pw, ph, images, pages) {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const push = (x) => { const u = typeof x === "string" ? enc.encode(x) : x; parts.push(u); len += u.length; };
    const obj = (n, fill) => { offs[n] = len; push(`${n} 0 obj\n`); fill(); push("\nendobj\n"); };
    const imgId = (i) => 3 + i, pageId = (p) => 3 + images.length + 2 * p, n = 3 + images.length + 2 * pages.length;
    push("%PDF-1.4\n");
    obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, p) => `${pageId(p)} 0 R`).join(" ")}] >>`));
    images.forEach((im, i) => obj(imgId(i), () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
      push(im.bytes); push("\nendstream");
    }));
    pages.forEach((pg, p) => {
      obj(pageId(p), () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << ${pg.used.map((i) => `/Im${i} ${imgId(i)} 0 R`).join(" ")} >> >> /Contents ${pageId(p) + 1} 0 R >>`));
      const c = enc.encode(pg.content);
      obj(pageId(p) + 1, () => { push(`<< /Length ${c.length} >>\nstream\n`); push(c); push("\nendstream"); });
    });
    const xref = len;
    push(`xref\n0 ${n}\n0000000000 65535 f \n${offs.slice(1, n).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let at = 0;
    for (const u of parts) { out.set(u, at); at += u.length; }
    return out;
  }

  return { view, fromDeck, buildPdf, layout };
})();

views.print = () => Print.view();
