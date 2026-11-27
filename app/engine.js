"use strict";
/* Motor local de Gather in One.
 *
 * La app no depende de ningún servidor propio: descarga cada día un "paquete de datos"
 * (cartas, precios, ediciones, meta de Pauper, avisos) publicado en internet y hace aquí
 * todos los cálculos. Tus cartas, carpetas y colecciones seguidas se guardan en el
 * propio teléfono (IndexedDB).
 *
 * Expone Engine.call(path, params) con las mismas rutas y respuestas que tenía el
 * antiguo servidor Python (/api/summary, /api/decks...), para que la interfaz no cambie.
 */
const Engine = (() => {
  const CFG = window.GM_CONFIG || {};
  const slash = (u) => u.replace(/\/?$/, "/");
  // Fuentes del paquete: la de internet y, en la app de Android, una copia que va dentro del APK
  // (así funciona la primera vez aunque no haya conexión).
  const SOURCES = [CFG.packUrl, CFG.bundledPackUrl].filter(Boolean).map(slash);
  let PACK = SOURCES[0] || "pack/";
  const RARITY = { c: "common", u: "uncommon", r: "rare", m: "mythic", s: "special", b: "bonus" };
  const PAUPER = ["not_legal", "legal", "banned"];
  const BASICS = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes",
    "snow-covered plains", "snow-covered island", "snow-covered swamp", "snow-covered mountain", "snow-covered forest"]);

  // ---------------------------------------------------------------- almacenamiento (IndexedDB)
  let dbp;
  function idb() {
    dbp ||= new Promise((ok, fail) => {
      const r = indexedDB.open("gathering-market", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    return dbp;
  }
  async function kvGet(key) {
    const db = await idb();
    return new Promise((ok, fail) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  }
  async function kvSet(key, value) {
    const db = await idb();
    return new Promise((ok, fail) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => ok();
      tx.onerror = () => fail(tx.error);
    });
  }

  // ---------------------------------------------------------------- utilidades
  const norm = (name) => String(name).split(" // ")[0].normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const front = (name) => String(name).split(" // ")[0];
  const eur = (c) => (c == null ? null : Math.round(c) / 100);
  const img = (id) => `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------------------------------------------------------------- datos del paquete
  let O = [], P = [], PR = null, SETS = new Map(), META = [], PACK_EVENTS = [], STAPLES = {}, TOURS = [];
  let byId, oByNorm, printsOf, bySetNum, bySet, cheapCache = new Map(), decksByCardCache = null;
  let user = null;
  let loaded = false;
  let VERSION = null;

  // Ficheros grandes que solo hacen falta a veces (preconstruidos, nombres en otros idiomas):
  // se descargan la primera vez que se usan y se guardan en el móvil.
  const extras = {};
  async function extra(file) {
    if (extras[file]) return extras[file];
    const key = "x:" + file;
    let rec = await kvGet(key);
    if (!rec || (VERSION?.day && rec.day !== VERSION.day)) {
      try {
        rec = { day: VERSION?.day, text: await fetchText(file) };
        await kvSet(key, rec);
      } catch (e) {
        if (!rec) throw new Error(`Hace falta internet para descargar ${file}`);
      }
    }
    return (extras[file] = JSON.parse(rec.text));
  }

  async function fetchText(file, onProgress) {
    const res = await fetch(PACK + file + (file === "version.json" ? `?t=${Date.now()}` : ""), { cache: "no-store" });
    if (!res.ok) throw new Error(`No se ha podido descargar ${file} (${res.status})`);
    if (!onProgress || !res.body || !res.headers.get("content-length")) return res.text();
    const total = +res.headers.get("content-length");
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  }

  /** Carga los datos: usa la copia guardada y descarga solo lo que haya cambiado. */
  async function load(onProgress = () => {}) {
    let version = null;
    const saved = (await kvGet("version")) || {};
    for (const src of SOURCES) {
      PACK = src;
      try { version = JSON.parse(await fetchText("version.json")); } catch { continue; }
      // La copia del APK solo sirve si no tenemos nada guardado o es más nueva que lo guardado.
      if (src === SOURCES[0] || !saved.day || version.day > saved.day) break;
      version = null;
    }
    const fresh = async (key, file, changed, progress) => {
      let text = await kvGet(key);
      if (version && (changed || !text)) {
        text = await fetchText(file, progress);
        await kvSet(key, text);
      }
      return text;
    };
    const newCards = version && version.cards_version !== saved.cards_version;
    const newDay = version && version.day !== saved.day;
    onProgress("Abriendo el códice de cartas…", 0);
    const cardsText = await fresh("cards", "cards.json", newCards, (p) => onProgress("Descargando el códice de cartas…", p));
    if (!cardsText) throw new Error("Hace falta conexión a internet la primera vez para descargar las cartas.");
    onProgress("Consultando a los mercaderes…", 0);
    const pricesText = await fresh("prices", "prices.json", newDay || newCards, (p) => onProgress("Consultando a los mercaderes…", p));
    const setsText = await fresh("sets", "sets.json", newDay);
    const newLive = newDay || (version && version.live_version !== saved.live_version);  // meta actualizado el mismo día
    const metaText = await fresh("meta", "meta.json", newLive);
    const eventsText = await fresh("events", "events.json", newLive);
    let staplesText = null;
    try { staplesText = await fresh("staples", "staples.json", newLive); } catch { /* paquete antiguo sin staples */ }
    let toursText = null;
    try { toursText = await fresh("tournaments", "tournaments.json", newLive); } catch { /* paquete antiguo sin torneos */ }
    if (version) await kvSet("version", version);
    VERSION = version || saved;

    const cards = JSON.parse(cardsText);
    O = cards.o;
    P = cards.p;
    PR = JSON.parse(pricesText);
    SETS = new Map(JSON.parse(setsText || "[]").map(([code, name, type, released, icon]) => [code, { code, name, type, released, icon }]));
    META = JSON.parse(metaText || "[]");
    try { STAPLES = JSON.parse(staplesText || "{}"); } catch { STAPLES = {}; }
    try { TOURS = JSON.parse(toursText || "[]"); } catch { TOURS = []; }
    for (const d of META) d.format ||= "PAU";  // paquetes antiguos: solo Pauper
    PACK_EVENTS = JSON.parse(eventsText || "[]");
    byId = new Map();
    oByNorm = new Map();
    printsOf = O.map(() => []);
    bySetNum = new Map();
    bySet = new Map();
    P.forEach((p, i) => {
      byId.set(p[0], i);
      printsOf[p[1]].push(i);
      const k = `${p[2]}|${String(p[3]).replace(/^0+/, "")}`;
      if (!bySetNum.has(k)) bySetNum.set(k, []);
      bySetNum.get(k).push(i);
      if (!bySet.has(p[2])) bySet.set(p[2], []);
      bySet.get(p[2]).push(i);
    });
    O.forEach((o, i) => { if (!oByNorm.has(norm(o[0]))) oByNorm.set(norm(o[0]), i); });
    cheapCache = new Map();
    decksByCardCache = null;
    user = await loadUser();
    loaded = true;
    const alerts = checkLocalAlerts();
    return { day: PR.day, alerts, offline: !version };
  }

  // Precio más barato (no foil) de cada carta para una columna de precios (eur, d1, d7, d30).
  function cheapest(col = "eur") {
    if (cheapCache.has(col)) return cheapCache.get(col);
    const arr = PR[col] || [];
    const out = new Array(O.length).fill(null);   // precio mínimo (cualquier impresión)
    const pick = new Array(O.length).fill(-1);    // impresión "normal" más barata: imagen y edición por defecto
    const rank = (i) => (P[i][5] ? 2 : 0) + (arr[i] == null ? 1 : 0);  // mejor: no variante y con precio
    const second = new Array(O.length).fill(null);
    for (let i = 0; i < P.length; i++) {
      const v = arr[i];
      const o = P[i][1];
      if (v != null) {
        if (out[o] == null || v < out[o]) { second[o] = out[o]; out[o] = v; }
        else if (second[o] == null || v < second[o]) second[o] = v;
      }
      const cur = pick[o];
      if (cur < 0 || rank(i) < rank(cur) || (rank(i) === rank(cur) && v != null && v < arr[cur])) pick[o] = i;
    }
    // Precios absurdos de Cardmarket (p. ej. un Badlands "Summer Magic" a 0,02 €): si el más barato
    // vale menos de 1/5 del siguiente, no es real y se usa el siguiente.
    for (let o = 0; o < O.length; o++) if (second[o] != null && out[o] < second[o] * 0.2) out[o] = second[o];
    const res = { price: out, pick };
    cheapCache.set(col, res);
    return res;
  }
  /** Subidas y bajadas de una carta comparando LA MISMA impresión en los dos días (la más barata de las que tienen precio
   *  los dos días). Antes se comparaba la más barata de hoy con la más barata de entonces: si la barata dejaba de tener precio,
   *  salía un +5.200 % que no existía (Nog, Ambitious Cadet). */
  const pairedCache = new Map();
  function paired(col) {
    if (pairedCache.day !== PR.day) { pairedCache.clear(); pairedCache.day = PR.day; }  // precios nuevos: se recalcula
    if (pairedCache.has(col)) return pairedCache.get(col);
    const now = new Array(O.length).fill(null), old = new Array(O.length).fill(null), alt = new Array(O.length).fill(null);
    for (let i = 0; i < P.length; i++) {
      const a = PR.eur[i], b = PR[col]?.[i], o = P[i][1];
      if (a == null || b == null || P[i][5]) continue;  // sin las variantes (promos, sin borde…): muy pocas ventas
      if (now[o] == null || a < now[o]) { alt[o] = now[o] != null ? [now[o], old[o]] : alt[o]; now[o] = a; old[o] = b; }
    }
    // el absurdo de Cardmarket (una impresión a céntimos que no es real): si la más barata vale menos de 1/5 de la siguiente, la siguiente
    for (let o = 0; o < O.length; o++) if (alt[o] && now[o] < alt[o][0] * 0.2) { now[o] = alt[o][0]; old[o] = alt[o][1]; }
    const res = { now, old };
    pairedCache.set(col, res);
    return res;
  }
  /** ¿Es creíble el cambio? Céntimos que se multiplican por 10 de golpe suelen ser un error del precio medio. */
  const believable = (old, now) => old >= 10 && !(now > old * 10 && old < 100);
  const oImage = (oi) => { const p = cheapest().pick[oi]; return p >= 0 ? img(P[p][0]) : null; };
  const priceOf = (pi, foil) => (foil ? PR.eur_foil[pi] : PR.eur[pi]);

  function decksByCard() {
    if (decksByCardCache) return decksByCardCache;
    const out = new Map();
    for (const d of META) {
      if (d.format !== "PAU") continue;
      for (const [name] of d.cards) {
        const k = norm(name);
        if (!out.has(k)) out.set(k, []);
        if (!out.get(k).includes(d.archetype)) out.get(k).push(d.archetype);
      }
    }
    decksByCardCache = out;
    return out;
  }

  // ---------------------------------------------------------------- tus datos (en el móvil)
  async function loadUser() {
    const raw = await kvGet("user");
    const u = raw ? JSON.parse(raw) : null;
    return u || { binders: [{ id: 1, name: "Mis cartas" }], nextId: 2, cards: { 1: {} }, pinned: { 1: [] },
      events: [], nextEvent: 1, lastPriceDay: null };
  }
  let onSaved = null;  // la cuenta en la nube se entera de cada cambio para subirlo
  const saveUser = () => { const p = kvSet("user", JSON.stringify(user)); onSaved?.(); return p; };
  const binderOf = (c) => { const id = +c || 1; return user.binders.find((b) => b.id === id) ? id : null; };
  const cardsOf = (c) => user.cards[c] || (user.cards[c] = {});
  /** [[índice de impresión, foil, cantidad]] de una carpeta (ignora cartas que ya no existan). */
  function entries(c) {
    const out = [];
    for (const [key, qty] of Object.entries(cardsOf(c))) {
      const [id, foil] = key.split("|");
      const pi = byId.get(id);
      if (pi != null && qty > 0) out.push([pi, foil === "1", qty]);
    }
    return out;
  }
  /** Como entries(), pero sin los proxies que has marcado como "no cuentan para la colección". */
  function entriesForSets(c) {
    const out = [];
    for (const [pi, foil, qty] of entries(c)) {
      const key = `${P[pi][0]}|${foil ? 1 : 0}`;
      const q = user.proxyNoSet?.[c]?.[key] ? qty - Math.min(user.proxies?.[c]?.[key] || 0, qty) : qty;
      if (q > 0) out.push([pi, foil, q]);
    }
    return out;
  }
  function ownedByName(c) {
    const out = new Map();
    for (const [pi, , qty] of entries(c)) {
      const k = norm(O[P[pi][1]][0]);
      out.set(k, (out.get(k) || 0) + qty);
    }
    return out;
  }
  function addCard(c, id, foil, delta) {
    const cards = cardsOf(c);
    const key = `${id}|${foil ? 1 : 0}`;
    const qty = (cards[key] || 0) + delta;
    if (qty > 0) cards[key] = qty; else delete cards[key];
    if (delta > 0) logAdded(c, id, foil, delta);
  }
  /** Historial de cartas añadidas: [día local, carpeta, carta, foil, copias], lo más nuevo primero. */
  function logAdded(c, id, foil, n) {
    const day = new Date().toLocaleDateString("sv"), log = (user.added ||= []), f = foil ? 1 : 0;
    let e = null;
    for (const x of log) { if (x[0] !== day) break; if (x[1] === c && x[2] === id && x[3] === f) { e = x; break; } }
    const pi = byId.get(id), cents = pi == null ? null : priceOf(pi, foil);  // precio de ese momento (para las estadísticas)
    if (e) e[4] += n; else log.unshift([day, c, id, f, n, cents]);
    if (log.length > 3000) log.length = 3000;  // shortcut: guarda las 3.000 últimas; si se queda corto, subir el límite
  }
  function added({ c }) {
    const id = binderOf(c);
    if (!id) return [];
    const days = new Map();
    for (const [day, b, cid, foil, n] of user.added || []) {
      const pi = byId.get(cid);
      if (b !== id || pi == null) continue;
      if (!days.has(day)) days.set(day, []);
      const r = printingRow(pi);
      days.get(day).push({ id: cid, name: front(r.name), image: r.image, set: r.set, number: r.number, qty: n, foil: !!foil, eur: eur(priceOf(pi, !!foil)) });
    }
    return [...days].map(([day, cards]) => ({ day, cards, count: cards.reduce((a, x) => a + x.qty, 0),
      value: Math.round(cards.reduce((a, x) => a + (x.eur || 0) * x.qty, 0) * 100) / 100 }));  // lo que vale hoy lo que añadiste ese día
  }
  function addEvent(day, kind, title, body = "") {
    if (user.events.some((e) => e.day === day && e.kind === kind && e.title === title)) return null;
    const e = { id: `L${user.nextEvent++}`, day, kind, title, body };
    user.events.unshift(e);
    user.events = user.events.slice(0, 200);
    return e;
  }

  /** Avisos que dependen de tus cartas: se calculan en el móvil al llegar precios nuevos. */
  function checkLocalAlerts() {
    if (!PR || user.lastPriceDay === PR.day) return [];
    const created = [];
    const first = user.lastPriceDay == null;
    user.lastPriceDay = PR.day;
    for (const b of user.binders) {
      const log = ((user.valueLog ||= {})[b.id] ||= {});
      log[PR.day] = Math.round((summary({ c: b.id }).value || 0) * 100);
      for (const d of Object.keys(log).sort().slice(0, -400)) delete log[d];  // como mucho, algo más de un año
    }
    if (!first && PR.days && PR.days["1"]) {
      for (const [pi, foil] of entries(1)) {
        if (foil) continue;
        const old = PR.d1[pi], now = PR.eur[pi];
        if (old && now && Math.abs(now - old) >= 50 && Math.abs(now - old) / old >= 0.1) {
          const pct = ((now - old) * 100) / old;
          const o = O[P[pi][1]];
          const e = addEvent(PR.day, "price", `${pct > 0 ? "📈" : "📉"} ${front(o[0])} (${P[pi][2].toUpperCase()}) ${pct > 0 ? "+" : ""}${Math.round(pct)}%`,
            `Tu carta: ${(old / 100).toFixed(2)} € → ${(now / 100).toFixed(2)} €`);
          if (e) created.push(e);
        }
      }
    }
    // Lista de deseos: la carta ha bajado de tu precio objetivo (se avisa una vez; si vuelve a subir, se rearma)
    const cheapNow = cheapest().price, hit = (user.targetHit ||= {});
    for (const [n, cents] of Object.entries(user.targets || {})) {
      const oi = oByNorm.get(norm(n)), now = oi == null || cheapNow[oi] == null ? null : cheapNow[oi] * wishFactor();
      if (!now) continue;
      if (now <= cents && !hit[n]) {
        const e = addEvent(PR.day, "wish", `🎯 ${n} a ${(now / 100).toFixed(2)} €`, `Ha bajado de tu precio objetivo (${(cents / 100).toFixed(2)} €). Es la edición más barata en Cardmarket.`);
        if (e) created.push(e);
        hit[n] = PR.day;
      } else if (now > cents) delete hit[n];
    }
    for (const code of user.pinned[1] || []) {
      const s = SETS.get(code);
      if (s && s.released === today()) {
        const e = addEvent(today(), "set", `📜 Hoy sale ${s.name}`, "Es una colección que sigues.");
        if (e) created.push(e);
      }
    }
    saveUser();
    return created;
  }

  // ---------------------------------------------------------------- carpetas y cartas
  // Proxies: copias que tienes para jugar (y para el constructor en Casual) pero que no valen dinero.
  const proxyOf = (id, key, qty = Infinity) => Math.min(user.proxies?.[id]?.[key] || 0, qty);
  function proxyPost(body) {
    const id = binderOf(body.c);
    if (!id || !byId.has(body.card_id)) throw new Error("No conozco esa carta");
    const key = `${body.card_id}|${body.foil ? 1 : 0}`;
    const have = cardsOf(id)[key] || 0;
    const map = ((user.proxies ||= {})[id] ||= {});
    const n = Math.max(0, Math.min(have, body.set != null ? +body.set : (map[key] || 0) + (+body.delta || 0)));
    if (n) map[key] = n; else delete map[key];
    const noSet = ((user.proxyNoSet ||= {})[id] ||= {});
    if (body.collect === false) noSet[key] = true;
    else if (body.collect === true || !n) delete noSet[key];
    saveUser();
    return { proxy: n, collect: !noSet[key] };
  }
  function summary({ c }) {
    const id = binderOf(c);
    if (!id) return { day: PR.day, collection: null, collection_id: null };
    let value = 0, prev = 0, cards = 0, unique = 0;
    const hasPrev = PR.days && PR.days["1"] && PR.days["1"] !== PR.day;
    for (const [pi, foil, qty] of entries(id)) {
      const key = `${P[pi][0]}|${foil ? 1 : 0}`, px = proxyOf(id, key, qty);
      const real = qty - px;  // los proxies no suman valor
      value += real * (langPrice(id, key, priceOf(pi, foil)) || 0);  // según el idioma de cada carta
      prev += real * (langPrice(id, key, foil ? PR.eur_foil[pi] : PR.d1[pi] ?? PR.eur[pi]) || 0);
      cards += user.proxyNoSet?.[id]?.[key] ? real : qty;  // ni cuentan como cartas si has dicho que no
      unique++;
    }
    return { day: PR.day, value: eur(value), prev_value: hasPrev ? eur(prev) : null, cards, unique,
      collection: user.binders.find((b) => b.id === id).name, collection_id: id };
  }

  /** Valor de tu colección día a día. Con el historial de cada carta (history/XX.json) si son pocos ficheros; si no, los
   *  4 puntos de prices.json (hace 30 y 7 días, ayer, hoy). Más la foto diaria que guarda la app (user.valueLog). */
  async function valueHistory({ c }) {
    const id = binderOf(c) || 1;
    const rows = entries(id).map(([pi, foil, qty]) => {
      const key = `${P[pi][0]}|${foil ? 1 : 0}`;
      return [pi, foil, (qty - proxyOf(id, key, qty)) * (LANG_FACTOR[langOf(id, key)] || 1)];
    }).filter((r) => r[2] > 0);
    const byDay = new Map();
    // Las cartas que más valen primero: con su historial completo (hasta 64 ficheros, ~4 MB) se cubre casi todo el valor;
    // el resto se estima con la misma evolución. Antes, con colecciones grandes, solo salían 4 puntos.
    const nowOf = ([pi, foil, n]) => n * ((foil ? PR.eur_foil[pi] : PR.eur[pi]) || 0);
    const sorted = rows.slice().sort((x, y) => nowOf(y) - nowOf(x)), shards = new Set(), top = [];
    for (const r of sorted) { const sh = P[r[0]][0].slice(0, 2); if (!shards.has(sh) && shards.size >= 64) continue; shards.add(sh); top.push(r); }
    const topSet = new Set(top), restNow = sorted.filter((r) => !topSet.has(r)).reduce((t, r) => t + nowOf(r), 0), topNow = top.reduce((t, r) => t + nowOf(r), 0);
    if (top.length) {
      for (const sh of shards) if (!historyShards.has(sh)) historyShards.set(sh, fetchText(`history/${sh}.json?d=${PR.day}`).then(JSON.parse).catch(() => null));
      const files = new Map(await Promise.all([...shards].map(async (sh) => [sh, await historyShards.get(sh)])));
      const days = [...new Set([...files.values()].flatMap((h) => h?.days || []))].sort();
      for (const d of days) {
        let total = 0;
        for (const [pi, foil, n] of top) {
          const h = files.get(P[pi][0].slice(0, 2)), vals = h?.c?.[P[pi][0]];
          let v = null;
          if (vals) { const k = h.days.indexOf(d); for (let i = k; i >= 0 && v == null; i--) v = vals[i]; }  // el último precio conocido
          total += n * (v ?? (foil ? PR.eur_foil[pi] : PR.eur[pi]) ?? 0);
        }
        byDay.set(d, total + (topNow ? (restNow * total) / topNow : restNow));  // el resto, con la misma evolución
      }
    } else {
      for (const [k, col] of [["30", "d30"], ["7", "d7"], ["1", "d1"]]) {
        if (!PR.days?.[k] || PR.days[k] === PR.day) continue;
        byDay.set(PR.days[k], rows.reduce((t, [pi, , n]) => t + n * (PR[col][pi] ?? PR.eur[pi] ?? 0), 0));
      }
    }
    for (const [d, v] of Object.entries(user.valueLog?.[id] || {})) byDay.set(d, v);
    byDay.set(PR.day, (summary({ c: id }).value || 0) * 100);
    const days = [...byDay.keys()].sort();
    return { name: "Tu colección", set: "", days, eur: days.map((d) => eur(byDay.get(d))) };
  }

  /** Datos de juego de unas cartas (mano de prueba y probabilidades). */
  function cardInfo({ names = "" }) {
    return String(names).split("|").filter(Boolean).map((n) => {
      const oi = oByNorm.get(norm(n));
      if (oi == null) return { name: n, type: "", cost: "", cmc: 0, text: "", image: null };
      const o = O[oi];
      return { name: front(o[0]), type: o[1], cost: o[2], cmc: o[3] || 0, text: o[5] || "", colors: o[4] || "", image: oImage(oi) };
    });
  }

  /** Repetidas: copias de más de cada carta (más de 4, o más de las que usa tu mazo que más lleva), sin básicas ni proxies.
   *  Para vender o cambiar: cuánto valen las que sobran (la edición más barata que tienes). */
  function duplicates({ c }) {
    const id = binderOf(c) || 1, have = new Map();
    for (const [pi, foil, qty] of entries(id)) {
      const real = qty - proxyOf(id, `${P[pi][0]}|${foil ? 1 : 0}`, qty);
      if (real <= 0) continue;
      const oi = P[pi][1], k = norm(O[oi][0]), price = priceOf(pi, foil);
      const r = have.get(k) || { oi, qty: 0, eur: null, pi };
      r.qty += real;
      if (price != null && (r.eur == null || price < r.eur)) { r.eur = price; r.pi = pi; }
      have.set(k, r);
    }
    const used = new Map();
    for (const d of user.decks || []) {
      const per = new Map();
      for (const [n, q] of d.cards || []) per.set(norm(n), (per.get(norm(n)) || 0) + q);
      for (const [k, q] of per) used.set(k, Math.max(used.get(k) || 0, q));
    }
    const items = [], reserved = [], res = user.reserved || {};
    for (const [k, r] of have) {
      if (BASICS.has(k) || /^basic/i.test(O[r.oi][1])) continue;
      // Copias en mazos que no están en la app (Commander, otros de 60…): las marca el usuario y no sobran
      const rv = res[k]?.n || 0, keep = Math.max(4, used.get(k) || 0) + rv, extra = r.qty - keep;
      const row = { name: front(O[r.oi][0]), image: img(P[r.pi][0]), set: P[r.pi][2].toUpperCase(), number: P[r.pi][3], qty: r.qty, used: used.get(k) || 0,
        reserved: rv, note: res[k]?.note || "", keep, extra, eur: eur(r.eur), value: r.eur && extra > 0 ? Math.round(extra * r.eur) / 100 : 0 };
      if (rv) reserved.push(row);
      if (extra > 0) items.push(row);
    }
    items.sort((a, b) => b.value - a.value || b.extra - a.extra);
    reserved.sort((a, b) => a.name.localeCompare(b.name));
    return { items, reserved, copies: items.reduce((a, x) => a + x.extra, 0), value: Math.round(items.reduce((a, x) => a + x.value, 0) * 100) / 100 };
  }
  /** Copias de una carta que están en mazos fuera de la app (no cuentan como repetidas). */
  function reservePost({ name, n, note }) {
    const k = norm(name);
    if (!oByNorm.has(k)) throw new Error("No conozco esa carta");
    const map = (user.reserved ||= {});
    const v = Math.max(0, Math.min(999, Math.round(+n) || 0));
    if (!v) delete map[k]; else map[k] = { n: v, note: String(note ?? map[k]?.note ?? "").slice(0, 60) };
    saveUser();
    return { ok: true };
  }
  /** Estadísticas por mes: cartas añadidas, lo que te costaron (precio del día en que las añadiste; las de antes de guardarlo,
   *  al precio de hoy) y cómo ha ido el valor de tu colección ese mes. */
  async function monthStats({ c }) {
    const id = binderOf(c) || 1, months = new Map();
    const mo = (d) => d.slice(0, 7), get = (m) => months.get(m) || months.set(m, { month: m, cards: 0, spent: 0, guessed: false }).get(m);
    for (const [day, b, cid, foil, n, cents] of user.added || []) {
      if (b !== id) continue;
      const pi = byId.get(cid), m = get(mo(day));
      m.cards += n;
      const unit = cents ?? (pi == null ? 0 : priceOf(pi, !!foil) || 0);
      if (cents == null) m.guessed = true;
      m.spent += n * unit;
    }
    const h = await valueHistory({ c: id });
    h.days.forEach((d, i) => { const m = get(mo(d)); if (m.start == null) m.start = h.eur[i]; m.end = h.eur[i]; });
    return [...months.values()].sort((a, b) => b.month.localeCompare(a.month)).map((m) => ({ ...m, spent: Math.round(m.spent) / 100,
      change: m.start != null && m.end != null ? Math.round((m.end - m.start) * 100) / 100 : null, pct: m.start ? Math.round(((m.end - m.start) * 1000) / m.start) / 10 : null }));
  }

  function collectionsList() {
    return user.binders.map((b) => ({ id: b.id, name: b.name, cards: entries(b.id).reduce((s, e) => s + e[2], 0) }));
  }

  function collectionsPost(body) {
    if (body.create) {
      const name = body.create.trim().slice(0, 60);
      if (!name) throw new Error("Pon un nombre");
      if (user.binders.some((b) => b.name === name)) throw new Error("UNIQUE: ya existe");
      const id = user.nextId++;
      user.binders.push({ id, name });
      user.cards[id] = {};
      user.pinned[id] = [];
      saveUser();
      return { id };
    }
    if (body.rename) {
      const b = user.binders.find((x) => x.id === +body.rename);
      if (b) b.name = body.name.trim().slice(0, 60);
      saveUser();
      return { ok: true };
    }
    if (body.delete) {
      const id = +body.delete;
      if (id === 1) throw new Error("Tu carpeta principal no se puede borrar");
      user.binders = user.binders.filter((b) => b.id !== id);
      delete user.cards[id];
      delete user.pinned[id];
      saveUser();
      return { ok: true };
    }
    throw new Error("Acción desconocida");
  }

  // Busca por nombre en inglés y también por el nombre impreso en español, francés, alemán,
  // italiano, portugués o japonés ("Relámpago" -> Lightning Bolt).
  async function search({ q }) {
    const text = (q || "").trim().toLowerCase();
    if (text.length < 2) return [];
    const hits = new Map();  // oi -> [orden, largo, nombre en otro idioma]
    for (let oi = 0; oi < O.length; oi++) {
      const name = front(O[oi][0]);
      const at = name.toLowerCase().indexOf(text);
      if (at >= 0) hits.set(oi, [at === 0 ? 0 : 1, name.length, null]);
    }
    const qc = compact(text);
    if (qc.length >= 2) {
      try {
        for (const lang of Object.keys(await extra("names.json"))) {
          const f = await foreignIndex(lang);
          for (const [k, oi] of f.map) {
            const at = k.indexOf(qc);
            if (at < 0 || (hits.has(oi) && hits.get(oi)[0] <= (at === 0 ? 0 : 1))) continue;
            hits.set(oi, [at === 0 ? 0 : 1, k.length, `${f.printed.get(k)} (${lang.toUpperCase()})`]);
          }
        }
      } catch { /* sin los nombres en otros idiomas (sin conexión la primera vez): solo inglés */ }
    }
    const cheap = cheapest().price;
    return [...hits.entries()].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]).slice(0, 20)
      .map(([oi, [, , alias]]) => ({ name: front(O[oi][0]), alias, pauper: PAUPER[O[oi][6]], image: oImage(oi), eur: eur(cheap[oi]) }));
  }

  function printingRow(pi) {
    const [id, oi, set, number, r, variant] = P[pi];
    const s = SETS.get(set);
    return { id, name: O[oi][0], set, set_name: s ? s.name : set.toUpperCase(), number, rarity: RARITY[r], image: img(id), variant: !!variant,
      released: s ? s.released : null, eur: eur(PR.eur[pi]), eur_foil: eur(PR.eur_foil[pi]), pauper: PAUPER[O[oi][6]] };
  }
  function printings({ name }) {
    const oi = oByNorm.get(norm(name || ""));
    return oi == null ? [] : printsOf[oi].map(printingRow);
  }

  function collection({ c }) {
    const id = binderOf(c);
    if (!id) return [];
    const used = decksByCard();
    const rows = entries(id).map(([pi, foil, qty]) => {
      const r = printingRow(pi);
      const o = O[P[pi][1]];
      return { row_id: `${r.id}|${foil ? 1 : 0}`, id: r.id, name: r.name, set: r.set, set_name: r.set_name, number: r.number,
        rarity: r.rarity, image: r.image, qty, foil, eur: eur(priceOf(pi, foil)), pauper: r.pauper, type: o[1], colors: o[4] || "",
        decks: used.get(norm(o[0])) || [], alter: alterOf(id, `${r.id}|${foil ? 1 : 0}`, eur(priceOf(pi, foil)), qty),
        proxy: proxyOf(id, `${r.id}|${foil ? 1 : 0}`, qty), proxy_collect: !user.proxyNoSet?.[id]?.[`${r.id}|${foil ? 1 : 0}`],
        lang: langOf(id, `${r.id}|${foil ? 1 : 0}`), lang_name: CARD_LANGS[langOf(id, `${r.id}|${foil ? 1 : 0}`)],
        eur_lang: eur(langPrice(id, `${r.id}|${foil ? 1 : 0}`, priceOf(pi, foil))) };
    });
    rows.sort((a, b) => (b.eur || 0) - (a.eur || 0) || a.name.localeCompare(b.name));
    return rows;
  }

  /** ¿Están todas las cartas de la edición `code` en la carpeta? (colecciones de 10 o más cartas) */
  function setComplete(id, code) {
    const total = setTotals(code);
    if (total < 10) return false;
    const have = new Set();
    for (const [pi] of entriesForSets(id)) if (P[pi][2] === code && !P[pi][5]) have.add(P[pi][1]);
    return have.size >= total;
  }
  /** Ejecuta `fn` y devuelve los nombres de las ediciones (de `pis`) que ha completado. */
  function completing(id, pis, fn) {
    const codes = [...new Set(pis.map((pi) => P[pi][2]))].filter((code) => !setComplete(id, code));
    fn();
    return codes.filter((code) => setComplete(id, code)).map((code) => SETS.get(code)?.name || code.toUpperCase());
  }
  // ---------------------------------------------------------------- idioma de cada versión
  /* Cardmarket (vía Scryfall) da un precio para todos los idiomas, pero no valen lo mismo: en inglés se pagan más
   * y las de otros idiomas europeos suelen ir algo por debajo; las japonesas, a menudo por encima.
   * Factor orientativo sobre el precio de Cardmarket (precios de venta habituales, sin garantía). */
  const CARD_LANGS = { en: "Inglés", es: "Español", fr: "Francés", de: "Alemán", it: "Italiano", pt: "Portugués",
    ja: "Japonés", ko: "Coreano", ru: "Ruso", zhs: "Chino simplificado", zht: "Chino tradicional" };
  const LANG_FACTOR = { en: 1, es: 0.85, fr: 0.85, de: 0.9, it: 0.85, pt: 0.8, ja: 1.1, ko: 0.9, ru: 0.85, zhs: 0.8, zht: 0.8 };
  const langOf = (id, key) => user.langs?.[id]?.[key] || "en";
  const langPrice = (id, key, cents) => (cents == null ? cents : cents * (LANG_FACTOR[langOf(id, key)] || 1));
  const LANG_ALIASES = { english: "en", inglés: "en", spanish: "es", español: "es", french: "fr", francés: "fr", german: "de", alemán: "de",
    italian: "it", italiano: "it", portuguese: "pt", portugués: "pt", japanese: "ja", japonés: "ja", korean: "ko", coreano: "ko",
    russian: "ru", ruso: "ru", "chinese simplified": "zhs", "simplified chinese": "zhs", "chinese traditional": "zht", "traditional chinese": "zht" };
  const toLang = (v) => { const s = String(v || "").trim().toLowerCase(); return CARD_LANGS[s] ? s : LANG_ALIASES[s] || (s === "jp" ? "ja" : s === "sp" ? "es" : ""); };
  function langPost(body) {
    const id = binderOf(body.c);
    if (!id) throw new Error("Esa carpeta ya no existe");
    if (!byId.has(body.card_id)) throw new Error("No conozco esa carta");
    const key = `${body.card_id}|${body.foil ? 1 : 0}`, lang = toLang(body.lang) || "en";
    const map = ((user.langs ||= {})[id] ||= {});
    if (lang === "en") delete map[key]; else map[key] = lang;
    saveUser();
    return { ok: true, lang };
  }

  // ---------------------------------------------------------------- cartas alteradas (firma del artista, arte propio)
  /* Rango [bajo, alto] según quién compre (investigado 2026-11-27: MTGPrice, StarCityGames, Commander's Herald, normas de Cardmarket,
   * tarifas de artistas y alteristas). Bajo = tienda o jugador competitivo: firma o alter cuentan como carta tocada (≈ SP/HP).
   * Alto = fan de Commander o coleccionista que busca esa firma o ese alter. Firmar cuesta 3-15 € al artista; un alter, 25-500 €. */
  const ALTER_NAMES = { firma: "Firmada", arte: "Arte propio", ambas: "Firmada y con arte propio" };
  function alterEstimate(base, kind) {
    const b = base || 0;
    const r = kind === "firma" ? (b < 1 ? [b * 0.5, 3] : b < 10 ? [b * 0.8, b * 1.2 + 2] : b < 50 ? [b * 0.7, b * 1.2] : [b * 0.6, b * 1.1])
      : kind === "arte" ? (b < 1 ? [2, 30] : b < 10 ? [b * 0.7, b + 30] : b < 50 ? [b * 0.6, b + 40] : [b * 0.5, b + 50])
      : [Math.max(b, 3), b * 2 + 80];  // firmada y alterada (sobre todo si es del artista original)
    return r.map((x) => Math.round(x * 100) / 100);
  }
  function alterOf(id, key, base, qty) {
    const a = user.alters?.[id]?.[key];
    if (!a) return null;
    const n = Math.min(a.qty || 1, qty);
    return { kind: a.kind, name: ALTER_NAMES[a.kind], qty: n, note: a.note || "", estimate: alterEstimate(base, a.kind) };
  }
  function alterPost(body) {
    const id = binderOf(body.c);
    if (!id) throw new Error("Esa carpeta ya no existe");
    if (!byId.has(body.card_id)) throw new Error("No conozco esa carta");
    const key = `${body.card_id}|${body.foil ? 1 : 0}`;
    const map = ((user.alters ||= {})[id] ||= {});
    if (!ALTER_NAMES[body.kind]) delete map[key];
    else map[key] = { kind: body.kind, qty: Math.max(1, (body.add ? map[key]?.qty || 0 : 0) + (+body.qty || 1)),  // add: al añadir copias nuevas, suma
      note: String(body.note ?? map[key]?.note ?? "").slice(0, 80) };
    saveUser();
    return { ok: true, estimate: ALTER_NAMES[body.kind] ? alterEstimate(eur(priceOf(byId.get(body.card_id), !!body.foil)), body.kind) : null };
  }
  const alterEstimateRoute = ({ card_id, foil, kind }) => (byId.has(card_id) ? alterEstimate(eur(priceOf(byId.get(card_id), String(foil) === "true" || foil === "1")), kind) : null);

  function collectionAdd(body) {
    const id = binderOf(body.c);
    if (!id) throw new Error("Esa carpeta ya no existe");
    if (!byId.has(body.card_id)) throw new Error("No conozco esa carta");
    const qty = +body.qty || 1;
    const pi = byId.get(body.card_id);
    const completed = qty > 0 ? completing(id, [pi], () => addCard(id, body.card_id, !!body.foil, qty)) : (addCard(id, body.card_id, !!body.foil, qty), []);
    saveUser();
    return { ok: true, completed, eur: eur(priceOf(pi, !!body.foil)) };
  }
  /** Marcar cartas como tenidas o quitarlas (vendidas, perdidas…). cards: [[id de impresión o nombre, copias]].
   * Al añadir por nombre se usa la edición más barata; al quitar, primero esa impresión, luego las normales y al final las foil. */
  function ownCards(body) {
    const id = binderOf(body.c);
    if (!id) throw new Error("Esa carpeta ya no existe");
    const cards = cardsOf(id);
    let changed = 0, top = 0;
    const adds = [];
    for (const [ref, n] of body.cards || []) {
      let qty = Math.max(1, +n || 1);
      const exact = byId.has(ref) ? ref : null;
      const oi = exact ? P[byId.get(ref)][1] : oByNorm.get(norm(ref));
      if (oi == null || BASICS.has(norm(O[oi][0]))) continue;
      if (body.op === "remove") {
        const keys = Object.keys(cards).filter((k) => { const pi = byId.get(k.split("|")[0]); return pi != null && P[pi][1] === oi; })
          .sort((a, b) => (b.startsWith(`${exact}|`) - a.startsWith(`${exact}|`)) || (a.endsWith("|1") - b.endsWith("|1")));
        for (const k of keys) {
          const take = Math.min(qty, cards[k]);
          cards[k] -= take; qty -= take; changed += take;
          if (cards[k] <= 0) delete cards[k];
        }
      } else {
        const pi = exact ? byId.get(exact) : cheapest().pick[oi];
        if (pi == null || pi < 0) continue;
        adds.push([P[pi][0], qty, pi]);
        top = Math.max(top, PR.eur[pi] || 0);
      }
    }
    const completed = completing(id, adds.map((a) => a[2]), () => { for (const [cid, qty] of adds) { addCard(id, cid, false, qty); changed += qty; } });
    saveUser();
    return { changed, completed, eur: eur(top) };
  }

  // ---------------------------------------------------------------- perfil, medallas y copia en CSV
  function profile() {
    const p = user.profile || {};
    // lock: pedir la contraseña al abrir (los perfiles antiguos con contraseña la siguen pidiendo)
    return { name: p.name || "", salt: p.salt || null, hash: p.hash || null, since: p.since || null, lock: !!p.hash && p.lock !== false };
  }
  function profilePost(body) {
    const p = (user.profile ||= { since: new Date().toISOString().slice(0, 10) });
    if (body.name != null) p.name = String(body.name).trim().slice(0, 40);
    if (body.hash) { p.salt = body.salt; p.hash = body.hash; }
    if (body.clearPassword) { delete p.salt; delete p.hash; }
    if (body.lock != null) p.lock = !!body.lock;
    saveUser();
    return profile();
  }
  async function medals({ c }) {
    const id = binderOf(c) || 1;
    const sum = summary({ c: id });
    const setsList = await sets({ c: id });
    const done = setsList.filter((x) => !x.special && x.total >= 10 && x.owned >= x.total);
    const near = setsList.filter((x) => !x.special && x.total >= 10 && x.owned < x.total && x.pct >= 50).slice(0, 5);
    const pre = (await precons({ c: id })).filter((x) => x.pct === 100);
    const owned = ownedByName(id);
    const metaDone = META.filter((d) => deckInfo(d, owned).owned_pct === 100).map((d) => `${d.archetype} (${d.format === "PAU" ? "Pauper" : d.format})`);
    const STEPS = [[1, "Primera carta"], [100, "Aprendiz: 100 cartas"], [500, "Coleccionista: 500 cartas"], [1000, "Archivero: 1.000 cartas"],
      [5000, "Guardián del códice: 5.000 cartas"], [10000, "Gran biblioteca: 10.000 cartas"]];
    const VALUE = [[10, "Bolsa de cobre: 10 €"], [100, "Bolsa de plata: 100 €"], [500, "Cofre de oro: 500 €"], [1000, "Tesoro real: 1.000 €"], [5000, "Tesoro de dragón: 5.000 €"]];
    const ladder = (steps, v) => steps.map(([n, label]) => ({ label, done: v >= n }));
    return { binder: sum.collection, cards: sum.cards, value: sum.value,
      sets: done.map((x) => ({ code: x.code, name: x.name, icon: x.icon, total: x.total })),
      near: near.map((x) => ({ code: x.code, name: x.name, icon: x.icon, pct: x.pct, owned: x.owned, total: x.total })),
      precons: pre.map((x) => ({ code: x.code, name: x.name, icon: x.icon, type: x.type })),
      decks: metaDone, ladder: [...ladder(STEPS, sum.cards), ...ladder(VALUE, sum.value || 0)] };
  }
  /** Todas las carpetas en CSV (columnas como ManaBox: se puede volver a importar aquí o en otras apps). */
  const LANG_EN = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ja: "Japanese",
    ko: "Korean", ru: "Russian", zhs: "Chinese Simplified", zht: "Chinese Traditional" };
  /** CSV para otras apps: "moxfield" (Collection → Import) o "manabox" (Import → CSV). Sin proxies: no son cartas de verdad. */
  function exportFor(fmt) {
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
    const rows = fmt === "moxfield"
      ? [["Count", "Tradelist Count", "Name", "Edition", "Condition", "Language", "Foil", "Tags", "Last Modified", "Collector Number", "Alter", "Proxy", "Purchase Price"]]
      : [["Name", "Set code", "Set name", "Collector number", "Foil", "Rarity", "Quantity", "Scryfall ID", "Purchase price", "Misprint", "Altered", "Condition", "Language", "Purchase price currency"]];
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    for (const b of user.binders) {
      for (const [pi, foil, qty0] of entries(b.id)) {
        const [cid, oi, set, number, r] = P[pi], k = `${cid}|${foil ? 1 : 0}`;
        const qty = qty0 - (proxyOf(b.id, k, qty0) || 0);
        if (qty <= 0) continue;
        const name = front(O[oi][0]), lang = langOf(b.id, k), price = eur(priceOf(pi, foil)) ?? "";
        rows.push(fmt === "moxfield"
          ? [qty, 0, O[oi][0], set, "Near Mint", LANG_EN[lang] || "English", foil ? "foil" : "", "", now, number, "False", "False", price]
          : [name, set.toUpperCase(), SETS.get(set)?.name || "", number, foil ? "foil" : "normal", RARITY[r] || "", qty, cid, price, "false", alterOf(b.id, k, price, qty) ? "true" : "false", "near_mint", lang, "EUR"]);
      }
    }
    return { csv: rows.map((x) => x.map(q).join(",")).join("\n"), rows: rows.length - 1 };
  }
  function exportCsv({ fmt } = {}) {
    if (fmt === "moxfield" || fmt === "manabox") return exportFor(fmt);
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
    const rows = [["Binder Name", "Name", "Set code", "Set name", "Collector number", "Foil", "Quantity", "Scryfall ID", "Price EUR", "Altered", "Proxy", "Language"]];
    for (const b of user.binders) {
      for (const [pi, foil, qty] of entries(b.id)) {
        const [cid, oi, set, number] = P[pi];
        const a = alterOf(b.id, `${cid}|${foil ? 1 : 0}`, eur(priceOf(pi, foil)), qty);
        rows.push([b.name, front(O[oi][0]), set, SETS.get(set)?.name || "", number, foil ? "foil" : "normal", qty, cid, eur(priceOf(pi, foil)) ?? "",
          a ? `${a.name} x${a.qty}${a.note ? ` (${a.note})` : ""}` : "", proxyOf(b.id, `${cid}|${foil ? 1 : 0}`, qty) || "", langOf(b.id, `${cid}|${foil ? 1 : 0}`)]);
      }
    }
    return { csv: rows.map((r) => r.map(q).join(",")).join("\n"), rows: rows.length - 1 };
  }

  // ---------------------------------------------------------------- importar CSV / listas
  const COLUMNS = {
    scryfall: ["scryfall id", "scryfall_id", "scryfallid", "scryfall uuid", "scryfall card id", "scryfallid (en)"],
    name: ["name", "card name", "card", "nombre", "card_name", "cardname", "english name", "localized name", "product name", "nombre de la carta"],
    set_name: ["set name", "edition name", "expansion name", "set_name", "expansion", "edition", "set"],
    set: ["set code", "edition code", "setcode", "set_code", "set id", "expansion code", "set", "edition", "edición", "código de edición"],
    number: ["collector number", "card number", "collector_number", "number", "cn", "collector #", "collectornumber", "nº", "número", "numero"],
    qty: ["quantity", "count", "qty", "amount", "cantidad", "copies", "total qty", "total quantity", "have", "number of copies"],
    foil: ["foil", "printing", "finish", "foil/variant", "is foil", "isfoil", "variant"],
    lang: ["language", "lang", "idioma", "card language"],
  };
  const TEXT_LINE = /^\s*(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\w\-★]+))?)?(?:\s+\*[FE]\*)?\s*$/;
  const SKIP_LINES = new Set(["deck", "sideboard", "commander", "companion", "maybeboard"]);
  const isFoil = (v) => !["", "normal", "false", "no", "0", "nonfoil", "non-foil", "regular"].includes(String(v || "").trim().toLowerCase());

  function parseCsv(text) {
    const first = text.split(/\r?\n/, 1)[0];
    const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseImport(text) {
    text = text.replace(/^﻿/, "").replace(/^sep=.\r?\n/i, "");  // Dragon Shield empieza con "sep=,"
    // La cabecera puede no ser la primera línea (títulos, líneas en blanco): se busca entre las 5 primeras
    const lines = text.split(/\r?\n/);
    const hi = lines.slice(0, 5).findIndex((l) => /[,;\t]/.test(l) && /name|card|nombre|scryfall/i.test(l));
    if (hi > 0) text = lines.slice(hi).join("\n");
    const first = hi >= 0 ? lines[hi] : lines[0] || "";
    if (hi >= 0) {
      const [header, ...rows] = parseCsv(text);
      const h = header.map((x) => x.trim().toLowerCase());
      const col = {};
      for (const [key, aliases] of Object.entries(COLUMNS)) {
        for (const a of aliases) {
          const i = h.indexOf(a);
          if (i >= 0 && !Object.values(col).includes(i)) { col[key] = i; break; }
        }
      }
      if (col.name == null && col.scryfall == null) throw new Error("El CSV no tiene columna de nombre ni de Scryfall ID");
      return rows.filter((r) => r.some((v) => v.trim())).map((r) => {
        const get = (k) => (col[k] != null && col[k] < r.length ? r[col[k]].trim() : "");
        const qty = parseInt(get("qty").replace(/[^\d]/g, ""), 10);  // "2", "2x", "2.0"
        // Columna de edición con el nombre entero ("Dominaria") en vez del código: se trata como nombre
        let set = get("set"), setName = get("set_name");
        if (set && !/^[a-z0-9]{2,6}$/i.test(set)) { setName = setName || set; set = ""; }
        if (!set && /^[a-z0-9]{2,6}$/i.test(setName)) set = setName;  // "Edition" de Moxfield es el código; la de Deckbox, el nombre: se prueban los dos
        const name = get("name").replace(/\s*\(foil\)$/i, "");
        return { name, set, set_name: setName, number: get("number"), scryfall: get("scryfall"),
          qty: get("qty") === "" ? 1 : Number.isFinite(qty) ? qty : 1, foil: isFoil(get("foil")) || /\(foil\)$/i.test(get("name")),
          lang: toLang(get("lang")), raw: r.join(",").slice(0, 120) };
      });
    }
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("//") || SKIP_LINES.has(s.toLowerCase().replace(/:$/, ""))) continue;
      const m = TEXT_LINE.exec(s);
      if (m) out.push({ name: m[2].trim(), set: m[3] || "", set_name: "", number: m[4] || "", scryfall: "", qty: +m[1], foil: s.includes("*F*"), raw: s });
      else out.push({ name: s, set: "", set_name: "", number: "", scryfall: "", qty: 1, foil: false, raw: s });
    }
    return out;
  }

  function resolveRow(row) {
    if (row.scryfall && byId.has(row.scryfall.toLowerCase())) return row.scryfall.toLowerCase();
    const set = row.set.toLowerCase();
    if (set && row.number) {
      const hit = bySetNum.get(`${set}|${row.number.replace(/^0+/, "")}`);
      // Si el CSV trae nombre, tiene que cuadrar con el número (si no, manda el nombre).
      if (hit && (!row.name || norm(front(O[P[hit[0]][1]][0])) === norm(row.name) || norm(O[P[hit[0]][1]][0]) === norm(row.name))) return P[hit[0]][0];
    }
    let oi = row.name ? oByNorm.get(norm(row.name)) : null;
    if (oi == null && row.name.includes("/")) oi = oByNorm.get(norm(row.name.split(/\s*\/\/?\s*/)[0]));  // "Fire / Ice", "A//B"
    if (oi == null) return null;
    const setName = (row.set_name || (row.set.length > 6 ? row.set : "")).toLowerCase().trim();
    if (set || setName) {
      const pi = printsOf[oi].find((i) => P[i][2] === set || (SETS.get(P[i][2])?.name || "").toLowerCase() === setName);
      if (pi != null) return P[pi][0];
    }
    const pick = cheapest().pick[oi];
    return pick >= 0 ? P[pick][0] : null;
  }

  function importCards(body) {
    const id = binderOf(body.c);
    if (!id) throw new Error("Esa carpeta ya no existe");
    const rows = parseImport(body.text || "");
    if (!rows.length) throw new Error("El archivo está vacío o no lo entiendo");
    const found = new Map();
    const missing = [];
    for (const row of rows) {
      const cid = resolveRow(row);
      if (cid) {
        const k = `${cid}|${row.foil ? 1 : 0}`; found.set(k, (found.get(k) || 0) + Math.max(row.qty, 0));
        if (row.lang && row.lang !== "en") ((user.langs ||= {})[id] ||= {})[k] = row.lang;
      }
      else missing.push(row.raw);
    }
    if (body.mode === "replace") user.cards[id] = {};
    for (const [k, qty] of found) { const [cid, f] = k.split("|"); addCard(id, cid, f === "1", qty); }
    saveUser();
    return { rows: rows.length, imported: [...found.values()].reduce((a, b) => a + b, 0), unique: found.size,
      missing: missing.length, missing_examples: missing.slice(0, 20) };
  }

  // ---------------------------------------------------------------- escáner: emparejar el texto leído
  // Ratcliff/Obershelp, el mismo algoritmo que difflib.SequenceMatcher.ratio() de Python.
  function ratio(a, b) {
    if (!a.length && !b.length) return 1;
    let matches = 0;
    const stack = [[0, a.length, 0, b.length]];
    while (stack.length) {
      const [alo, ahi, blo, bhi] = stack.pop();
      let bi = alo, bj = blo, bk = 0;
      let prev = new Uint16Array(bhi - blo + 1);
      for (let i = alo; i < ahi; i++) {
        const cur = new Uint16Array(bhi - blo + 1);
        for (let j = blo; j < bhi; j++) {
          if (a[i] === b[j]) {
            const k = (cur[j - blo + 1] = prev[j - blo] + 1);
            if (k > bk) { bi = i - k + 1; bj = j - k + 1; bk = k; }
          }
        }
        prev = cur;
      }
      if (bk) { matches += bk; stack.push([alo, bi, blo, bj], [bi + bk, ahi, bj + bk, bhi]); }
    }
    return (2 * matches) / (a.length + b.length);
  }
  function closeMatches(word, keys, n, cutoff) {
    const counts = new Map();
    for (const ch of word) counts.set(ch, (counts.get(ch) || 0) + 1);
    const out = [];
    for (const k of keys) {
      const la = word.length, lb = k.length;
      if ((2 * Math.min(la, lb)) / (la + lb) < cutoff) continue;  // real_quick_ratio
      const avail = new Map(counts);
      let inter = 0;
      for (const ch of k) { const v = avail.get(ch); if (v > 0) { avail.set(ch, v - 1); inter++; } }
      if ((2 * inter) / (la + lb) < cutoff) continue;            // quick_ratio
      const r = ratio(word, k);
      if (r >= cutoff) out.push([r, k]);
    }
    return out.sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]);
  }
  const NUM_RES = [/\b[a-z]{1,2}\s+(\d{3,4})\b/gi, /\b(\d{1,4})\s*\/\s*\d{2,4}\b/g];
  // Línea inferior: "DSK • EN", "DSK • ES", "DSK • JA"... (el idioma da igual: edición + número bastan).
  const SET_CODE_RE = /\b([A-Z0-9]{3,5})\s*[^\w\s]{0,2}\s*(EN|ES|SP|FR|DE|IT|PT|JA|JP|KO|RU|ZHS|ZHT|CS|CT|PH)\b/gi;
  // Solo letras (sin tildes, espacios ni números: el lector cuela "3%" del coste de maná, etc.).
  const compact = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC").toLowerCase().replace(/[^\p{L}]/gu, "");
  const foreign = {};  // idioma -> Map(nombre impreso compactado -> índice de carta)
  async function foreignIndex(lang) {
    if (foreign[lang]) return foreign[lang];
    const names = await extra("names.json");
    const m = new Map(), printedOf = new Map();
    for (const [printed, oi] of Object.entries(names[lang] || {})) { const k = compact(printed); m.set(k, oi); printedOf.set(k, printed); }
    foreign[lang] = { map: m, keys: [...m.keys()], printed: printedOf };
    return foreign[lang];
  }
  const FOOTER_RE = /wizards|coast|illus|©|™/i;
  const TITLE_ZONE = 0.25;
  let nameKeys = null;
  const setCodes = (text) => new Set([...text.matchAll(SET_CODE_RE)].map((m) => m[1].toUpperCase()).filter((c) => !/^\d+$/.test(c)));
  const cleanTokens = (text) => text.replace(/[^a-zA-ZÀ-ÿ',\- ]/g, " ").split(/\s+/).filter((t) => t.replace(/[,'-]/g, "")).map(norm);

  async function match(body) {
    const raw = body.lines || [];
    const lines = raw.map((l, i) => (typeof l === "string" ? { text: l, y: i / Math.max(raw.length, 1) } : l));
    nameKeys ||= [...oByNorm.keys()];
    const scores = new Map();
    const bump = (k, s) => scores.set(k, Math.max(scores.get(k) || 0, s));
    // Cartas en otros idiomas: se busca el nombre impreso y se traduce a la carta.
    // lang "auto" = en todos los idiomas que haya (español, francés, alemán, italiano, portugués, japonés).
    const langs = !body.lang || body.lang === "en" ? [] : body.lang === "auto" ? Object.keys(await extra("names.json")) : [body.lang];
    const indexes = await Promise.all(langs.map(foreignIndex));
    const toKey = (oi) => norm(O[oi][0]);
    for (const line of lines.slice(0, 40)) {
      const y = line.y || 0;
      if (FOOTER_RE.test(line.text)) continue;
      if (indexes.length && y < TITLE_ZONE + 0.15) {
        const flat = compact(line.text);
        let exactHit = false;
        for (const lang of indexes) {
          for (let i = 0; i < flat.length; i++) {
            for (let j = i + 2; j <= Math.min(flat.length, i + 40); j++) {
              const oi = lang.map.get(flat.slice(i, j));
              if (oi != null && j - i >= 3) {
                bump(toKey(oi), 1 + Math.min(j - i, 20) / 100 - y * 0.5);
                if (j - i >= Math.max(6, flat.length * 0.6)) exactHit = true;  // un trozo corto no descarta el resto
              }
            }
          }
        }
        // Parecido aproximado (errores del lector), solo si no hay coincidencia exacta: es lo que cuesta.
        if (!exactHit && flat.length >= 3 && y < TITLE_ZONE) {
          for (const lang of indexes) for (const k of closeMatches(flat, lang.keys, 2, 0.72)) bump(toKey(lang.map.get(k)), ratio(flat, k) - y * 0.5);
        }
      }
      const tokens = cleanTokens(line.text);
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j <= Math.min(i + 7, tokens.length); j++) {
          const span = tokens.slice(i, j).join(" ");
          if (oByNorm.has(span) && (j - i >= 2 || y < TITLE_ZONE) && span.length >= 4) bump(span, 1 + 0.05 * Math.min(j - i, 4) - y * 0.5);
        }
      }
      if (y < TITLE_ZONE) {
        // Primero la línea entera; sin las palabras cortas (ruido del lector) solo si así no sale nada claro:
        // "Lightning Bo It" sin "bo" e "it" se queda en "lightning", que se parece más a Blightning que a Lightning Bolt.
        const core = tokens.filter((t) => t.length > 2 || ["of", "the", "to", "a"].includes(t));
        let bestFull = 0;
        for (const cand of [tokens.join(" "), core.join(" ")]) {
          if (cand.length < 4 || bestFull >= 0.85) continue;
          for (const k of closeMatches(cand, nameKeys, 3, 0.75)) { const r = ratio(cand, k); bestFull = Math.max(bestFull, r); bump(k, r - y * 0.5); }
        }
      }
    }
    const text = lines.map((l) => l.text).join("\n");
    const codes = setCodes(text);
    const nums = new Set(NUM_RES.flatMap((re) => [...text.matchAll(re)].map((m) => m[1].replace(/^0+/, ""))));
    const found = [];
    for (const code of codes) for (const num of nums) for (const pi of bySetNum.get(`${code.toLowerCase()}|${num}`) || []) found.push(pi);
    const strong = Math.max(0, ...scores.values()) >= 0.95;
    const exact = new Map();
    for (const pi of found) {
      const k = norm(O[P[pi][1]][0]);
      if (scores.has(k)) { exact.set(k, P[pi][0]); bump(k, 2); }
      else if (found.length === 1 && !strong) { exact.set(k, P[pi][0]); bump(k, 0.9); }
    }
    let ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length) { const top = Math.min(ranked[0][1], 1); ranked = ranked.filter(([, s]) => s >= top - 0.25).slice(0, 4); }
    return ranked.map(([k, score]) => {
      const oi = oByNorm.get(k);
      const prints = printsOf[oi].map(printingRow);
      let best = exact.get(k) || null;
      if (!best && codes.size) { const inSet = prints.filter((p) => codes.has(p.set.toUpperCase())); if (inSet.length === 1) best = inSet[0].id; }
      return { name: front(O[oi][0]), score: Math.round(score * 100) / 100, printings: prints, best };
    });
  }

  // ---------------------------------------------------------------- mazos del meta
  function deckInfo(d, owned) {
    const cheap = cheapest().price;
    const need = new Map();
    for (const [name, qty] of d.cards) need.set(norm(name), (need.get(norm(name)) || 0) + qty);
    let total = 0, missing = 0, have = 0, all = 0;
    for (const [k, qty] of need) {
      if (BASICS.has(k)) continue;
      const oi = oByNorm.get(k);
      const price = oi != null ? cheap[oi] || 0 : 0;
      const h = Math.min(owned.get(k) || 0, qty);
      total += price * qty;
      missing += price * (qty - h);
      have += h;
      all += qty;
    }
    return { price: eur(total), missing_cost: eur(missing), owned_pct: all ? Math.round((100 * have) / all) : 0 };
  }
  // Miniaturas: las cartas más caras del main (suelen ser las que definen el mazo).
  function thumbsOf(d) {
    const cheap = cheapest().price;
    return [...new Set(d.cards.filter(([n, , side]) => !side && !BASICS.has(norm(n))).map(([n]) => n))]
      .sort((a, b) => (cheap[oByNorm.get(norm(b))] || 0) - (cheap[oByNorm.get(norm(a))] || 0)).slice(0, 4)
      .map((n) => { const oi = oByNorm.get(norm(n)); return oi != null ? oImage(oi) : null; });
  }
  function decks({ c }) {
    const owned = ownedByName(binderOf(c) || 1);
    return META.map((d) => ({ id: d.id, format: d.format, archetype: d.archetype, category: d.category, share: d.share, player: d.player, event: d.event,
      result: d.result, date: d.date, thumbs: thumbsOf(d), ...deckInfo(d, owned) }));
  }
  /** Torneos: el destacado (Super Pauper de inGenio BCN) y los últimos de Pauper, con el top y las listas que hay. */
  function tournaments({ c }) {
    const owned = ownedByName(binderOf(c) || 1);
    return TOURS.map((t) => ({ ...t, top: t.top.map((d) => {
      if (!d.cards.length) return { ...d, cards: undefined };
      const full = { ...d, format: t.format, event: t.name };
      return { ...d, cards: undefined, has_list: true, thumbs: thumbsOf(full), ...deckInfo(full, owned) };
    }) }));
  }
  function tourDeck(id) {
    for (const t of TOURS) for (const d of t.top) if (d.id === +id && d.cards.length) {
      return { id: d.id, format: t.format, archetype: d.archetype, category: "", player: d.player, event: `${t.name} @ ${t.place}`, result: d.rank, date: t.date, cards: d.cards };
    }
    return null;
  }
  function deck({ c, id }) {
    const mine = String(id).startsWith("u");
    let d = mine ? (user.decks || []).find((x) => x.id === id) : META.find((x) => x.id === +id) || tourDeck(id);
    if (!d) throw new Error(mine ? "Ese mazo ya no existe" : "Ese mazo ya no está en el meta");
    if (mine) d = { ...d, archetype: d.name, player: "", event: d.format || "Mi mazo", result: "", date: "" };
    const owned = ownedByName(binderOf(c) || 1);
    const cheap = cheapest().price;
    const left = new Map(owned);
    const cards = d.cards.map(([name, qty, side]) => {
      const k = norm(name);
      const basic = BASICS.has(k);
      const have = basic ? qty : Math.min(left.get(k) || 0, qty);
      if (!basic) left.set(k, (left.get(k) || 0) - have);
      const oi = oByNorm.get(k);
      return { name, qty, side: !!side, have, owned: basic ? qty : owned.get(k) || 0, basic, eur: basic || oi == null ? null : eur(cheap[oi]), image: oi != null ? oImage(oi) : null };
    });
    return { id: d.id, archetype: d.archetype, format: mine ? null : d.format, player: d.player, event: d.event, result: d.result, date: d.date, mine, cards, example: !!d.example, note: d.note || "", ...deckInfo(d, owned),
      test: mine && !!d.test, results: mine ? d.results || [] : [], built: mine ? d.built || null : null };
  }

  // ---------------------------------------------------------------- staples de cada formato
  /* Como en MTGDecks: qué parte del meta juega cada carta (sumando la cuota de cada arquetipo que la lleva) y cuántas
   * copias de media. Sale de las listas de torneo de MTGTop8 (una por arquetipo). Commander: las más jugadas en EDHREC. */
  function staples({ c, format = "PAU" }) {
    const owned = ownedByName(binderOf(c) || 1);
    const cheap = cheapest().price;
    const rows = new Map();
    if (format === "EDH") {
      O.map((o, oi) => oi).filter((oi) => O[oi][7] && O[oi][9] === 1 && !O[oi][1].startsWith("Basic"))
        .sort((a, b) => O[a][7] - O[b][7]).slice(0, 100)
        .forEach((oi, i) => rows.set(norm(O[oi][0]), { oi, pct: null, avg: 1, rank: i + 1 }));
    } else if (STAPLES[format]?.cards?.length) {  // calculados con varias listas por arquetipo (paquete diario)
      for (const [name, pct, avg] of STAPLES[format].cards) {
        const k = norm(name), oi = oByNorm.get(k);
        if (oi == null || (format === "PAU" && O[oi][6] !== 1) || (format === "ST" && O[oi][10] !== 1)) continue;
        rows.set(k, { oi, pct, avg });
      }
    } else {
      const decks = META.filter((d) => d.format === format);
      const total = decks.reduce((s, d) => s + (d.share || 0), 0) || 1;
      for (const d of decks) {
        const qty = new Map();
        for (const [name, q] of d.cards) { const k = norm(name); if (!BASICS.has(k)) qty.set(k, (qty.get(k) || 0) + q); }
        for (const [k, q] of qty) {
          const oi = oByNorm.get(k);
          if (oi == null || (format === "PAU" && O[oi][6] !== 1) || (format === "ST" && O[oi][10] !== 1)) continue;  // solo lo legal hoy
          const r = rows.get(k) || { oi, share: 0, decks: 0, copies: 0 };
          r.share += d.share || 0; r.decks++; r.copies += q;
          rows.set(k, r);
        }
      }
      for (const r of rows.values()) { r.pct = Math.round((1000 * r.share) / total) / 10; r.avg = Math.round((10 * r.copies) / r.decks) / 10; }
    }
    const list = [...rows.entries()].sort((a, b) => (b[1].pct ?? 0) - (a[1].pct ?? 0) || (a[1].rank || 0) - (b[1].rank || 0)).slice(0, 100)
      .map(([k, r]) => ({ name: front(O[r.oi][0]), image: oImage(r.oi), eur: eur(cheap[r.oi]), pct: r.pct, avg: r.avg, rank: r.rank || null,
        owned: owned.get(k) || 0, want: ["EDH", "DC", "cEDH", "HIGH", "CHL"].includes(format) ? 1 : 4 }));  // formatos de una copia  // un playset: el meta cambia y es más cómodo tener las 4
    const have = list.filter((x) => x.owned >= x.want).length;
    const missingCost = Math.round(list.reduce((s, x) => s + Math.max(0, x.want - x.owned) * (x.eur || 0), 0) * 100) / 100;
    return { format, cards: list, have, total: list.length, missing_cost: missingCost, lists: STAPLES[format]?.lists || META.filter((d) => d.format === format).length };
  }

  // ---------------------------------------------------------------- cartas que sigues (precio y cambios a 1, 7 y 30 días)
  // Idioma en que buscas las cartas (Mercado → Sigo): los precios y los avisos de la lista de deseos se ajustan
  // con el mismo factor que el valor de tu colección (una carta en español suele valer ~85 % de la inglesa).
  const wishLang = () => user.prefs?.collectLang || "en";
  const wishFactor = () => LANG_FACTOR[wishLang()] || 1;
  function watchList({ c }) {
    const owned = ownedByName(binderOf(c) || 1);
    const now = cheapest().price;
    const past = { 1: cheapest("d1").price, 7: cheapest("d7").price, 30: cheapest("d30").price };
    const has = (k) => PR.days && PR.days[k] && PR.days[k] !== PR.day;
    const change = (oi, k) => { const p = paired(`d${k}`), a = p.old[oi], b = p.now[oi]; return has(k) && a && b && believable(a, b) ? Math.round(((b - a) * 1000) / a) / 10 : null; };
    return (user.watch || []).map((name) => {
      const oi = oByNorm.get(norm(name));
      if (oi == null) return null;
      const target = user.targets?.[front(O[oi][0])], f = wishFactor();
      return { name: front(O[oi][0]), image: oImage(oi), eur: eur(now[oi] == null ? null : now[oi] * f), lang: wishLang(), d1: change(oi, 1), d7: change(oi, 7), d30: change(oi, 30),
        owned: owned.get(norm(name)) || 0, target: target ? eur(target) : null, reached: !!(target && now[oi] && now[oi] * f <= target) };
    }).filter(Boolean);
  }
  function watchPost({ c, add, remove, top, target, price, lang }) {
    const list = (user.watch ||= []);
    if (lang && CARD_LANGS[lang]) { (user.prefs ||= {}).collectLang = lang; saveUser(); return { lang }; }
    if (target) {  // lista de deseos: avisar cuando la edición más barata baje de este precio (0 o vacío = quitar)
      const oi = oByNorm.get(norm(target));
      if (oi == null) throw new Error("No conozco esa carta");
      const n = front(O[oi][0]), cents = Math.round(parseFloat(String(price || "").replace(",", ".")) * 100);
      user.targets ||= {};
      if (cents > 0) { user.targets[n] = cents; if (!list.some((x) => norm(x) === norm(n))) list.unshift(n); } else delete user.targets[n];
      delete (user.targetHit ||= {})[n];
    }
    const has = (n) => list.some((x) => norm(x) === norm(n));
    if (add) { const oi = oByNorm.get(norm(add)); if (oi == null) throw new Error("No conozco esa carta"); if (!has(add)) list.unshift(front(O[oi][0])); }
    if (remove) { user.watch = list.filter((x) => norm(x) !== norm(remove)); if (user.targets) delete user.targets[front(remove)]; }
    if (top) {  // tus cartas más valiosas
      const cheap = cheapest().price;
      const names = [...ownedByName(binderOf(c) || 1).keys()].map((k) => oByNorm.get(k)).filter((oi) => oi != null)
        .sort((a, b) => (cheap[b] || 0) - (cheap[a] || 0)).slice(0, +top).map((oi) => front(O[oi][0]));
      for (const n of names) if (!has(n)) list.push(n);
    }
    saveUser();
    return { watch: user.watch };
  }

  // ---------------------------------------------------------------- mercado
  function movers({ c, days = 7, scope = "pauper", min = 0.5 }) {
    const col = { 1: "d1", 7: "d7", 30: "d30" }[+days] || "d7";
    const base = PR.days ? PR.days[String(+days)] : null;
    if (!base || base === PR.day) return { base: PR.day, latest: PR.day, up: [], down: [] };
    let items = [];
    if (scope === "collection") {
      for (const [pi] of entries(binderOf(c) || 1)) {
        const o = PR[col][pi], n = PR.eur[pi];
        if (o && n && believable(o, n)) items.push({ id: P[pi][0], name: O[P[pi][1]][0], set: P[pi][2], image: img(P[pi][0]), old: eur(o), new: eur(n) });
      }
    } else {
      const { now, old } = paired(col);
      for (let oi = 0; oi < O.length; oi++) {
        if (scope === "pauper" && O[oi][6] !== 1) continue;
        if (now[oi] && old[oi] && believable(old[oi], now[oi])) items.push({ name: front(O[oi][0]), set: null, image: null, old: eur(old[oi]), new: eur(now[oi]) });
      }
    }
    items = items.filter((i) => Math.max(i.old, i.new) >= +min && i.old > 0);
    items.forEach((i) => { i.pct = Math.round(((i.new - i.old) * 1000) / i.old) / 10; });
    items.sort((a, b) => a.pct - b.pct);
    return { base, latest: PR.day, up: items.filter((i) => i.pct > 0).reverse().slice(0, 25), down: items.filter((i) => i.pct < 0).slice(0, 25) };
  }

  /** Historial de precio de una impresión (id) o de la impresión normal más barata de una carta (name), para la gráfica.
   *  El paquete trae history/XX.json (XX = 2 primeras letras del id); se baja solo el que hace falta. */
  const historyShards = new Map();
  async function history({ id, name }) {
    let pi = id ? byId.get(id) : null;
    if (pi == null && name) { const oi = oByNorm.get(norm(name)); if (oi != null) pi = cheapest().pick[oi]; }
    if (pi == null || pi < 0) return { days: [], eur: [] };
    const sid = P[pi][0], shard = sid.slice(0, 2);
    if (!historyShards.has(shard)) historyShards.set(shard, fetchText(`history/${shard}.json?d=${PR.day}`).then(JSON.parse).catch(() => null));
    const h = await historyShards.get(shard);
    let days = [], vals = [];
    if (h?.c?.[sid]) { days = h.days; vals = h.c[sid]; }
    else {  // sin fichero (paquete antiguo o sin internet): los 4 puntos que trae prices.json
      for (const [k, col] of [["30", "d30"], ["7", "d7"], ["1", "d1"]]) if (PR.days?.[k]) { days.push(PR.days[k]); vals.push(PR[col][pi]); }
      days.push(PR.day); vals.push(PR.eur[pi]);
    }
    const pts = days.map((d, i) => [d, vals[i]]).filter(([, v]) => v != null);
    if (pts.length && pts[pts.length - 1][0] !== PR.day && PR.eur[pi] != null) pts.push([PR.day, PR.eur[pi]]);
    return { name: front(O[P[pi][1]][0]), set: P[pi][2].toUpperCase(), days: pts.map((x) => x[0]), eur: pts.map((x) => eur(x[1])) };
  }

  /** Para la tarea en segundo plano de Android: tus cartas (id o id+"f" si es foil) con su nombre. */
  // Cuándo avisar de una carta tuya (también la tarea en segundo plano): se aleja este % y estos céntimos de su precio de referencia.
  const alertPrefs = () => ({ pct: user.prefs?.alertPct ?? 10, min: user.prefs?.alertMin ?? 50 });
  function alertPrefsPost({ pct, min }) {
    const p = (user.prefs ||= {});
    if (pct != null) p.alertPct = Math.max(1, Math.min(100, +pct || 10));
    if (min != null) p.alertMin = Math.max(0, Math.min(10000, Math.round(+min) || 0));
    saveUser();
    return alertPrefs();
  }
  function watchIds() {
    const ids = [], names = {}, own = [];
    for (const [pi, foil] of entries(1)) {
      const k = P[pi][0] + (foil ? "f" : "");
      if (names[k]) continue;
      ids.push(k); own.push([k, pi, foil ? 1 : 0]); names[k] = `${front(O[P[pi][1]][0])} (${P[pi][2].toUpperCase()}${foil ? " foil" : ""})`;
    }
    const wishes = Object.entries(user.targets || {}).map(([n, cents]) => {
      const oi = oByNorm.get(norm(n));
      return oi == null ? null : { name: n, target: Math.round(cents / wishFactor()), pis: printsOf[oi].filter((pi) => !P[pi][5]) };  // la tarea compara precios en inglés
    }).filter(Boolean);
    return { ids, names, own, alert: alertPrefs(), wishes, cardsVersion: PR.cards_version, day: PR.day, lastEvent: Math.max(0, ...PACK_EVENTS.map((e) => +e.id || 0)) };
  }

  /** Combos infinitos de 2 cartas (Commander Spellbook) que puedes montar con tu colección, o a los que te falta una.
   *  format: pauper / commander / standard filtran por legalidad; casual (o vacío), todos. */
  const COMBO_FMT = { pauper: "pauper", commander: "commander", standard: "standard", pioneer: "pioneer", modern: "modern", legacy: "legacy",
    vintage: "vintage", cedh: "commander", duel: "commander", predh: "commander", highlander: "vintage", canlander: "vintage",
    valuevintage: "vintage", explorer: "pioneer", peasant: "pauper", paupercommander: "pauper" };
  async function combosFor({ c, format = "" }) {
    const list = await extra("combos.json");
    const owned = ownedByName(binderOf(c) || 1);
    const cheap = cheapest().price;
    const fmt = COMBO_FMT[format] || "";
    const have = [], one = [];
    for (const k of list) {
      if (fmt && !k.legal.includes(fmt)) continue;
      const ois = k.cards.map((n) => oByNorm.get(norm(n)));
      if (ois.some((oi) => oi == null)) continue;  // cartas que aún no están en el paquete
      const got = ois.map((oi) => (owned.get(norm(O[oi][0])) || 0) > 0);
      const n = got.filter(Boolean).length;
      if (!n) continue;
      const item = { ...k, owned: got, images: ois.map(oImage), eur: ois.map((oi) => eur(cheap[oi])) };
      (n === 2 ? have : one).push(item);
    }
    const byPop = (a, b) => b.pop - a.pop;
    return { have: have.sort(byPop).slice(0, 150), one: one.sort(byPop).slice(0, 150), total: list.length };
  }

  /* Plan de banquillo por enfrentamiento (lo que hacen los jugadores de torneo, p. ej. Mengu's Workshop): contra cada mazo top
   * del meta, qué cartas del banquillo meter y cuáles del main sacar. Se mira qué es el rival (azul, rojo, artefactos, cementerio,
   * ancho, agresivo, maná grande/combo, nieblas) y qué hace cada carta del banquillo. */
  const SB_KINDS = [
    ["vsBlue", /if it'?s blue|target blue|blue (spell|permanent)s?\b/i, "es azul"],
    ["vsRed", /if it'?s red|target red|red (spell|permanent)s?\b/i, "es rojo"],
    ["vsArtifacts", /(destroy|exile) (up to )?(two )?(target|all|each) (noncreature )?artifacts?|artifacts? (your opponents control )?(can't|each)|destroy target artifact|counter target artifact|sacrifice an? artifact.*destroy/i, "juega muchos artefactos"],
    ["vsGraveyard", /exile (all cards from |each |target player's |all )?(graveyards?|.{0,20}from (a|target player's|all) graveyards?)|exile target card from a graveyard/i, "usa el cementerio"],
    ["vsWide", /damage to each (creature|other creature)|each creature (gets|deals)|all creatures get -|creatures your opponents control get -/i, "juega muchas criaturas pequeñas"],
    ["vsAggro", /gain \d+ life|prevent all combat damage|lifelink|prevent all damage that (red|black|green|white|blue)? ?sources/i, "es agresivo"],
    ["vsBig", /counter target (noncreature|artifact|activated|spell)(?! if it'?s)|reveals? (his|her|their) hand.*discards?|target (player|opponent) discards|destroy target nonbasic land/i, "busca maná grande o combo"],
    ["vsFog", /deals? \d+ damage to (each|target) (player|opponent)|can't be prevented|whenever .* (cast|tap).{0,40}deals? 1 damage/i, "juega nieblas"],
  ];
  function sbPlan({ format = "pauper", main = "", side = "" }) {
    const code = FORMAT_META[format];
    if (!code) return [];
    const parse = (s) => String(s).split("|").filter(Boolean).map((x) => { const i = x.lastIndexOf(":"); return [x.slice(0, i), +x.slice(i + 1) || 1]; });
    const mine = parse(main), sb = parse(side);
    const row = (n) => { const oi = oByNorm.get(norm(n)); return oi == null ? null : O[oi]; };
    const kindsOf = (n) => { const o = row(n); return o ? SB_KINDS.filter(([, rx]) => rx.test(o[5] || "")).map(([k]) => k) : []; };
    const decks = META.filter((d) => d.format === code).sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 8);
    return decks.map((d) => {
      const spells = d.cards.filter(([n, , s]) => !s && !/land/i.test(row(n)?.[1] || "")), q = (f) => spells.reduce((a, [n, k]) => a + (f(row(n), n) ? k : 0), 0);
      const total = spells.reduce((a, [, k]) => a + k, 0) || 1;
      const lands = d.cards.filter(([n, , s]) => !s && /land/i.test(row(n)?.[1] || ""));
      const traits = new Set();
      if (q((o) => o && /U/.test(o[4] || "")) / total >= 0.5) traits.add("vsBlue");
      if (q((o) => o && /R/.test(o[4] || "")) / total >= 0.5) traits.add("vsRed");
      if (d.cards.filter(([n, , s]) => !s && /artifact/i.test(row(n)?.[1] || "")).reduce((a, [, k]) => a + k, 0) >= 14) traits.add("vsArtifacts");
      if (q((o) => o && /flashback|delve|dredge|madness|escape|from your graveyard|cards? in your graveyard|instant and sorcery cards in your graveyard/i.test(o[5] || "")) >= 6) traits.add("vsGraveyard");
      if (q((o) => o && /creature/i.test(o[1])) >= 18 || q((o) => o && /create .{0,20}1\/1/i.test(o[5] || "")) >= 6) traits.add("vsWide");
      if (/aggro/i.test(d.category || "")) traits.add("vsAggro");
      if (lands.filter(([n]) => /^urza's/i.test(n)).length >= 3 || /combo/i.test(d.category || "")) traits.add("vsBig");
      if (q((o) => o && /prevent all combat damage/i.test(o[5] || "")) >= 4) traits.add("vsFog");
      // Del banquillo: lo que pega contra lo que es el rival
      const bring = [];
      for (const [n, k] of sb) {
        const hits = kindsOf(n).filter((x) => traits.has(x));
        if (hits.length) bring.push({ name: n, n: k, why: SB_KINDS.find(([x]) => x === hits[0])[2] });
      }
      let inN = Math.min(8, bring.reduce((a, b) => a + b.n, 0));
      // Del main: lo que menos sirve en este enfrentamiento
      const oppCreatures = q((o) => o && /creature/i.test(o[1]));
      const weak = mine.map(([n, k]) => {
        const o = row(n); if (!o || /land/i.test(o[1])) return null;
        let bad = 0, why = "";
        if (traits.has("vsAggro") && (o[3] || 0) >= 5) { bad = 3; why = "lenta contra un mazo agresivo"; }
        else if (oppCreatures < 10 && /(destroy|exile) target creature|damage to target creature/i.test(o[5] || "") && !/any target|player/i.test(o[5] || "")) { bad = 2; why = "quita criaturas y el rival casi no juega"; }
        else if (traits.has("vsAggro") && /draw (two|three) cards/i.test(o[5] || "") && (o[3] || 0) >= 3) { bad = 1; why = "robo lento contra un mazo agresivo"; }
        return bad ? { name: n, n: k, why, bad } : null;
      }).filter(Boolean).sort((a, b) => b.bad - a.bad);
      // Si no hay cartas claramente malas aquí, salen las flexibles: las de 1-2 copias (las de 4 son el núcleo), primero las caras
      const flex = mine.filter(([n, k]) => { const o = row(n); return o && !/land/i.test(o[1]) && k <= 2 && !weak.some((w) => w.name === n) && !bring.some((b) => b.name === n); })
        .sort((a, b) => (row(b[0])[3] || 0) - (row(a[0])[3] || 0)).map(([n, k]) => ({ name: n, n: k, why: "flexible: es lo menos importante aquí" }));
      const out = []; let left = inN;
      for (const w of [...weak, ...flex]) { if (left <= 0) break; const k = Math.min(w.n, left); out.push({ name: w.name, n: k, why: w.why }); left -= k; }
      if (left > 0) inN -= left;  // si no hay qué sacar, se mete menos
      const takeIn = []; let room = inN;
      for (const b of bring) { if (room <= 0) break; const k = Math.min(b.n, room); takeIn.push({ ...b, n: k }); room -= k; }
      return { vs: d.archetype, share: d.share, traits: [...traits].map((x) => SB_KINDS.find(([k]) => k === x)?.[2]).filter(Boolean), in: takeIn, out };
    });
  }

  function events() {
    return [...user.events, ...PACK_EVENTS].sort((a, b) => (b.day || "").localeCompare(a.day || "")).slice(0, 100);
  }

  // ---------------------------------------------------------------- colecciones (ediciones)
  // (el paquete ya viene sin fichas ni emblemas)
  function setTotals(code) {
    const names = new Set();
    for (const pi of bySet.get(code) || []) if (!P[pi][5]) names.add(P[pi][1]);
    return names.size;
  }
  // Colecciones especiales que no son una edición: la Lista Reservada ("reserved") y los
  // mazos preconstruidos ("deck:<id>"). Cuenta como tenida cualquier edición de la carta.
  async function special(code) {
    if (code === "reserved") {
      const pis = O.map((o, oi) => (o[8] ? cheapest().pick[oi] : -1)).filter((pi) => pi >= 0);
      return { name: "Lista Reservada", type: "reserved", released: null, icon: null, pis };
    }
    if (code.startsWith("deck:")) {
      const d = (await extra("precons.json")).find((x) => x[0] === code.slice(5));
      if (!d) throw new Error("No encuentro ese mazo preconstruido");
      return { name: d[1], type: d[2], released: d[3], icon: SETS.get(d[4])?.icon || null, pis: d[5].map(([pi]) => pi), counts: d[5] };
    }
    return null;
  }
  const ownedOracles = (id) => { const s = new Set(); for (const [pi] of entriesForSets(id)) s.add(P[pi][1]); return s; };
  const ownedQtyByOracle = (id) => { const m = new Map(); for (const [pi, , q] of entriesForSets(id)) m.set(P[pi][1], (m.get(P[pi][1]) || 0) + q); return m; };
  /** Copias que pide un mazo preconstruido por carta (cualquier edición vale) y cuántas de ellas tienes. */
  function deckNeed(counts) { const m = new Map(); for (const [pi, n] of counts) m.set(P[pi][1], (m.get(P[pi][1]) || 0) + n); return m; }
  function deckProgress(counts, qty) {
    let have = 0, total = 0;
    for (const [oi, n] of deckNeed(counts)) { total += n; have += Math.min(n, qty?.get(oi) || 0); }
    return { have, total };
  }
  async function setInfo(code, owned) {
    const sp = await special(code);
    if (sp) {
      if (sp.counts) {  // mazo: por copias
        const pr = deckProgress(sp.counts, owned instanceof Map ? owned : null);
        return { code, name: sp.name, type: sp.type, released: sp.released, icon: sp.icon, total: pr.total, special: true, deck: true, have: pr.have };
      }
      const ois = new Set(sp.pis.map((pi) => P[pi][1]));
      const have = owned ? [...ois].filter((oi) => owned.has(oi)).length : 0;
      return { code, name: sp.name, type: sp.type, released: sp.released, icon: sp.icon, total: ois.size, special: true, have };
    }
    const s = SETS.get(code) || { code, name: code.toUpperCase(), type: "", released: null, icon: null };
    return { code, name: s.name, type: s.type, released: s.released, icon: s.icon, total: setTotals(code) };
  }
  async function sets({ c }) {
    const id = binderOf(c) || 1;
    const owned = new Map();
    for (const [pi] of entriesForSets(id)) {
      const set = P[pi][2];
      if (!owned.has(set)) owned.set(set, new Set());
      owned.get(set).add(P[pi][1]);
    }
    const pinned = new Set(user.pinned[id] || []);
    const anyOwned = ownedOracles(id), qtyOwned = ownedQtyByOracle(id);
    const out = [];
    for (const code of new Set([...owned.keys(), ...pinned])) {
      const s = await setInfo(code, code.startsWith("deck:") ? qtyOwned : anyOwned);
      const have = s.special ? s.have : Math.min(owned.get(code)?.size || 0, s.total || Infinity);
      out.push({ ...s, owned: have, pinned: pinned.has(code), pct: s.total ? Math.round((100 * have) / s.total) : 0 });
    }
    return out.filter((s) => s.total || s.pinned)  // fuera "colecciones" sin cartas normales (p. ej. The List)
      .sort((a, b) => (b.pinned - a.pinned) || b.pct - a.pct || a.name.localeCompare(b.name));
  }
  /** Mazos preconstruidos: búsqueda por nombre, tipo o edición; los empezados primero. */
  async function precons({ c, q }) {
    const all = await extra("precons.json");
    const owned = ownedQtyByOracle(binderOf(c) || 1);
    const text = (q || "").trim().toLowerCase();
    const rows = all.filter((d) => !text || `${d[1]} ${d[2]} ${d[4]} ${SETS.get(d[4])?.name || ""}`.toLowerCase().includes(text))
      .map((d) => {
        const { have, total } = deckProgress(d[5], owned);
        return { code: `deck:${d[0]}`, name: d[1], type: d[2], released: d[3], icon: SETS.get(d[4])?.icon || null,
          total, owned: have, pct: Math.round((100 * have) / (total || 1)) };
      });
    return rows.sort((a, b) => b.pct - a.pct || (b.released || "").localeCompare(a.released || "")).slice(0, 60);
  }
  async function set({ c, code, all }) {
    const id = binderOf(c) || 1;
    code = String(code);
    if (!code.startsWith("deck:")) code = code.toLowerCase();
    const showAll = String(all) === "1";
    const s = await setInfo(code);
    const sp = s.special ? await special(code) : null;
    const qtyById = new Map(), qtyByName = new Map();
    for (const [pi, , qty] of entriesForSets(id)) {
      qtyById.set(pi, (qtyById.get(pi) || 0) + qty);
      if (sp || P[pi][2] === code) qtyByName.set(P[pi][1], (qtyByName.get(P[pi][1]) || 0) + qty);
    }
    const num = (n) => { const d = String(n).replace(/\D/g, ""); return d ? +d : 1e6; };
    const need = sp?.counts ? deckNeed(sp.counts) : null;  // mazo preconstruido: copias de cada carta
    const needPart = new Map();  // copias por carta y parte del mazo (0 main, 1 banquillo, 2 comandante)
    for (const [pi, n, part = 0] of sp?.counts || []) { const k = `${P[pi][1]}|${part}`; needPart.set(k, (needPart.get(k) || 0) + n); }
    // En un mazo se recorre cada entrada (la misma impresión puede estar en el main y en el banquillo)
    const entriesList = sp?.counts ? sp.counts.map(([pi, , part = 0]) => [pi, part]).sort((a, b) => front(O[P[a[0]][1]][0]).localeCompare(front(O[P[b[0]][1]][0]))) : null;
    const cards = new Map();
    const pis = sp ? sp.pis.slice().sort((a, b) => front(O[P[a][1]][0]).localeCompare(front(O[P[b][1]][0])))
      : (bySet.get(code) || []).slice().sort((a, b) => num(P[a][3]) - num(P[b][3]));
    for (const [pi, part0] of entriesList || pis.map((pi) => [pi, 0])) {
      if (sp) {  // especial: una entrada por carta (y parte del mazo), con la edición de la lista: su arte
        const [cid, oi, set, number, r] = P[pi];
        const part = part0, key2 = need ? `${oi}|${part}` : oi;
        if (!cards.has(key2)) cards.set(key2, { part, id: cid, name: front(O[oi][0]), number: `${set.toUpperCase()} ${number}`, rarity: RARITY[r], image: img(cid), type: O[oi][1], colors: O[oi][4] || "",
          eur: eur(cheapest().price[oi]), qty: qtyByName.get(oi) || 0, need: need ? needPart.get(key2) : 1, variant: false, basic: O[oi][1].startsWith("Basic"), order: cards.size });
        continue;
      }
      const [cid, oi, , number, r, variant] = P[pi];
      if (!showAll && variant) continue;
      const key = showAll ? pi : oi;
      const price = PR.eur[pi];
      const cur = cards.get(key);
      if (!cur || (!showAll && price != null && (cur.eur == null || price / 100 < cur.eur))) {
        cards.set(key, { id: cid, name: front(O[oi][0]), number, rarity: RARITY[r], image: img(cid), eur: eur(price), type: O[oi][1], colors: O[oi][4] || "",
          qty: showAll ? qtyById.get(pi) || 0 : qtyByName.get(oi) || 0, variant: !!variant, basic: O[oi][1].startsWith("Basic"),
          order: cur ? cur.order : num(number) });
      }
    }
    const list = [...cards.values()].sort((a, b) => a.order - b.order);
    list.forEach((x) => delete x.order);
    const rarity = {};
    for (const x of list) { const r = (rarity[x.rarity] ||= { owned: 0, total: 0 }); r.total++; if (x.qty) r.owned++; }
    if (need) {  // mazo: progreso, valor y lo que falta por copias
      const left = new Map();
      for (const x of list.slice().sort((a, b) => ((a.part + 1) % 3) - ((b.part + 1) % 3))) {  // comandante, main, banquillo
        const oi = oByNorm.get(norm(x.name)), have = left.has(oi) ? left.get(oi) : x.qty;
        x.qty = Math.min(have, x.need); left.set(oi, have - x.qty);
      }
      const got = (x) => Math.min(x.qty, x.need);
      return { ...s, cards: list, owned: list.reduce((t, x) => t + got(x), 0), total: list.reduce((t, x) => t + x.need, 0),
        pinned: (user.pinned[id] || []).includes(code), all: false, deck: true,
        missing_cost: Math.round(list.filter((x) => !x.basic).reduce((t, x) => t + (x.eur || 0) * (x.need - got(x)), 0) * 100) / 100,
        value_owned: Math.round(list.reduce((t, x) => t + (x.eur || 0) * got(x), 0) * 100) / 100, rarity };
    }
    return { ...s, cards: list, owned: list.filter((x) => x.qty).length, total: list.length,
      pinned: (user.pinned[id] || []).includes(code), all: showAll,
      missing_cost: Math.round(list.filter((x) => !x.qty && !x.basic).reduce((t, x) => t + (x.eur || 0), 0) * 100) / 100,
      value_owned: Math.round(list.filter((x) => x.qty).reduce((t, x) => t + (x.eur || 0), 0) * 100) / 100, rarity };
  }
  // Para buscar colecciones sin importar acentos ni grafías: "pirexia" encuentra Phyrexia, "teros" Theros.
  const simple = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ph/g, "p").replace(/th/g, "t").replace(/y/g, "i").replace(/k/g, "c").replace(/[^a-z0-9]/g, "");
  async function setsSearch({ q }) {
    const text = (q || "").trim().toLowerCase();
    if (text.length < 2) return [];
    const st = simple(text);
    const hits = [...SETS.values()].filter((s) => s.code === text || (st.length >= 2 && simple(s.name).includes(st)));
    const out = await Promise.all(hits.sort((a, b) => (b.released || "").localeCompare(a.released || "")).slice(0, 15).map((s) => setInfo(s.code)));
    // También por carta (en cualquier idioma): en qué colecciones sale.
    // (solo si es justo el nombre de una carta, o si no hay ninguna colección con ese nombre)
    const cards = await search({ q });
    const card = cards.find((c) => c.name.toLowerCase() === text) || (!out.length ? cards[0] : null);
    if (card && out.length < 15) {
      const seen = new Set(out.map((s) => s.code));
      const oi = oByNorm.get(norm(card.name));
      const codes = [...new Set((printsOf[oi] || []).map((pi) => P[pi][2]))].filter((code) => !seen.has(code) && SETS.has(code));
      const sets = codes.map((code) => SETS.get(code)).sort((a, b) => (b.released || "").localeCompare(a.released || "")).slice(0, 15 - out.length);
      for (const s of sets) out.push({ ...(await setInfo(s.code)), via: card.name });
    }
    return out;
  }
  async function preconOwn(body) {
    const id = binderOf(body.c);
    if (!id) throw new Error("Esa carpeta ya no existe");
    const sp = await special(String(body.code || ""));
    if (!sp?.counts) throw new Error("No encuentro ese mazo preconstruido");
    const qty = ownedQtyByOracle(id), adds = [];  // tus copias se van gastando entrada a entrada (la misma carta puede venir en dos ediciones)
    for (const [pi, n] of sp.counts) {
      const oi = P[pi][1], use = Math.min(n, qty.get(oi) || 0), missing = n - use;
      qty.set(oi, (qty.get(oi) || 0) - use);
      if (missing) adds.push([P[pi][0], missing, pi]);
    }
    let changed = 0;
    const completed = completing(id, adds.map((a) => a[2]), () => { for (const [cid, n] of adds) { addCard(id, cid, false, n); changed += n; } });
    saveUser();
    return { changed, completed };
  }
  function setsPin(body) {
    const id = binderOf(body.c) || 1;
    const list = (user.pinned[id] ||= []);
    const key = (x) => (x.startsWith("deck:") ? x : x.toLowerCase());
    if (body.pin && !list.includes(key(body.pin))) list.push(key(body.pin));
    if (body.unpin) user.pinned[id] = list.filter((x) => x !== key(body.unpin));
    saveUser();
    return { ok: true };
  }

  // ---------------------------------------------------------------- mis mazos (seguimiento)
  const DECK_LINE = /^\s*(?:SB:\s*)?(\d+)\s*x?\s+(.+?)(?:\s+\([A-Za-z0-9]{2,6}\)(?:\s+[\w\-★]+)?)?(?:\s+\*[FE]\*)?\s*$/;
  /** "4 Lightning Bolt" por línea; lo que va tras "Sideboard" (o "SB:") es banquillo. */
  function parseDeck(text) {
    const cards = [], unknown = [];
    let side = 0;
    for (const line of String(text).split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("//")) continue;
      if (/^(sideboard|banquillo)\b/i.test(s)) { side = 1; continue; }
      if (/^(deck|mazo|main(board)?|commander|comandante)\b:?$/i.test(s)) continue;
      const m = DECK_LINE.exec(s);
      if (!m) { unknown.push(s); continue; }
      const oi = oByNorm.get(norm(m[2]));
      if (oi == null) { unknown.push(s); continue; }
      cards.push([front(O[oi][0]), +m[1], side || /^SB:/i.test(s) ? 1 : 0]);
    }
    return { cards, unknown };
  }
  /** Por carta: partidas y victorias en tus "Mazos para probar" (cada carta cuenta los resultados de los mazos que la llevan). */
  function testedCardStats() {
    const m = new Map();
    for (const d of [...(user.decks || []), ...(user.reviewArchive || [])]) {
      if (!d.results?.length) continue;
      // Endstep, torneos, MTGO y MTGA cuentan entero; en tienda (casual) un poco menos y lo casual, la mitad o menos
      const weight = (r) => (/tienda/i.test(r.where || "") ? 0.6 : /casual/i.test(r.where || "") ? 0.4 : 1);
      const games = d.results.reduce((n, r) => n + (r.games || 3) * weight(r), 0), wins = d.results.reduce((n, r) => n + (r.wins || 0) * weight(r), 0);
      for (const k of new Set(d.cards.filter(([, , side]) => !side).map(([n]) => norm(n)))) {
        const s = m.get(k) || { games: 0, wins: 0 }; s.games += games; s.wins += wins; m.set(k, s);
      }
    }
    return m;
  }
  function myDecks({ c }) {
    const owned = ownedByName(binderOf(c) || 1);
    return (user.decks || []).map((d) => {
      const games = (d.results || []).reduce((n, r) => n + (r.games || 3), 0), wins = (d.results || []).reduce((n, r) => n + (r.wins || 0), 0);
      return { id: d.id, archetype: d.name, category: d.format || "Mi mazo", share: null, test: !!d.test, games, wins,
        thumbs: thumbsOf(d), mine: true, ...deckInfo(d, owned) };
    });
  }
  function myDecksPost(body) {
    user.decks ||= [];
    user.nextDeck ||= 1;
    if (body.import || body.save) {
      const src = body.import || body.save;
      const { cards, unknown } = body.import ? parseDeck(src.text) : { cards: src.cards, unknown: [] };
      if (!cards.length) throw new Error("No he reconocido ninguna carta en la lista");
      const id = `u${user.nextDeck++}`;
      user.decks.unshift({ id, name: (src.name || "Mi mazo").slice(0, 60), format: src.format || "", cards, ...(src.test ? { test: true, results: [], built: src.built || null } : {}) });
      saveUser();
      return { id, cards: cards.length, unknown };
    }
    if (body.update) {  // editar la lista (o el nombre) de uno de tus mazos
      const d = user.decks.find((x) => x.id === body.update.id);
      if (!d) throw new Error("Ese mazo ya no existe");
      const { cards, unknown } = parseDeck(body.update.text || "");
      if (!cards.length) throw new Error("No he reconocido ninguna carta en la lista");
      d.cards = cards;
      if (body.update.name) d.name = String(body.update.name).slice(0, 60);
      saveUser();
      return { id: d.id, cards: cards.length, unknown };
    }
    if (body.result) {  // "Mazos para probar": resultado de una tanda (p. ej. 2 de 3 ganadas) y tu opinión
      const d = user.decks.find((x) => x.id === body.result.id);
      if (!d) throw new Error("Ese mazo ya no existe");
      const games = Math.max(3, Math.min(50, +body.result.games || 3)), wins = Math.max(0, Math.min(games, +body.result.wins || 0));
      (d.results ||= []).unshift({ day: today(), games, wins, where: String(body.result.where || "").slice(0, 60), note: String(body.result.note || "").slice(0, 5000) });
      d.test = true;
      saveUser();
      return { ok: true };
    }
    if (body.keep) {  // tras probarlo, te gusta: pasa a "Mis mazos" (con sus resultados)
      const d = user.decks.find((x) => x.id === body.keep);
      if (!d) throw new Error("Ese mazo ya no existe");
      d.test = false; d.reviewed = true;
      saveUser();
      return { ok: true };
    }
    if (body.delete) {
      // Si tenía reseñas, se guardan aparte: el constructor sigue aprendiendo de ellas aunque borres el mazo
      const gone = user.decks.find((d) => d.id === body.delete);
      if (gone?.results?.length) { (user.reviewArchive ||= []).unshift({ name: gone.name, cards: gone.cards, results: gone.results, built: gone.built || null }); user.reviewArchive = user.reviewArchive.slice(0, 150); }
      user.decks = user.decks.filter((d) => d.id !== body.delete);
      saveUser();
      return { ok: true };
    }
    throw new Error("Acción desconocida");
  }

  // ---------------------------------------------------------------- constructor de mazos
  /* Cómo construye (lo que haría un jugador con experiencia):
   * 1. Plan: de las cartas base (o del comandante) saca qué temas busca (fichas, sacrificio...),
   *    qué tipos de carta pide ("tus planeswalkers...") y su tribu.
   * 2. Coherencia: cada carta elegida refuerza el plan, así que las siguientes se eligen por
   *    encajar con TODO el mazo, no solo con la primera carta.
   * 3. Funciones: un mazo jugable necesita quitar amenazas, robar y (en Commander) acelerar maná;
   *    hay cuotas por formato y se cubren con las cartas que además encajan con el plan.
   * 4. Curva de maná y tierras según el coste medio; en Commander, 1 copia y la identidad de color.
   * No se premia que una carta sea "meta": solo la sinergia con el plan.
   */
  const THEMES = [
    ["planeswalkers", /\bplaneswalkers?\b/, (t) => t.includes("planeswalker")],
    ["contadores", /\bproliferate\b|\bcounters? on\b|\b(loyalty|oil|charge|poison|lore|shield|stun|time|level|\+1\/\+1|-1\/-1) counters?\b/,
      (t) => t.includes("planeswalker") || t.includes("saga")],
    ["legendarios", /\blegendary\b/, (t) => t.includes("legendary")],
    ["vehículos", /\bvehicles?\b|\bcrew\b/, (t) => t.includes("vehicle")],
    // Comida (Food): quien la crea y quien la usa (Cauldron Familiar, Gilded Goose…). Reseña 2026-11-25: faltaba comida para el Familiar.
    ["comida", /\bfood\b/, (t) => t.includes("food")],
    ["artefactos", /\bartifacts?\b|\btreasures?\b|\bfood\b|\bclues?\b/, (t) => t.includes("artifact")],
    // Incoloro: cartas que premian lo incoloro (Forsaken Monument, Eldrazi…) y cartas que lo son (artefactos, Eldrazi, devoid).
    // Rampa (acelerar maná con tierras o maná extra) y bichos grandes (lo que la rampa quiere bajar).
    ["rampa", /search your library for (a|an|up to \w+) (basic )?(land|forest|plains|island|swamp|mountain)|put (a|up to \w+) land cards? .{0,40}onto the battlefield|play (an|two) additional lands?|add (\{[wubrgc]\}){2,}|creatures? with power 4 or greater .{0,30}(cost|mana)/,
      (t, c) => !t.split(" // ")[0].includes("land") && /\badd (\{|one mana|two mana|mana of)|search your library for (a|an|up to \w+) (basic )?(land|forest|plains|island|swamp|mountain)|land cards? .{0,40}onto the battlefield/.test(c?.text || "")],
    ["bichos grandes", /power (4|5|6|7) or greater|greatest power|\bferocious\b|\bformidable\b|creatures? with power \d+ or greater/, (t, c) => t.split(" // ")[0].includes("creature") && (c?.cmc || 0) >= 5],
    ["criaturas incoloras", /\bcolorless creatures?\b/, (t, c) => !!c?.colorless && t.includes("creature")],
    ["incoloro", /\bcolorless (creature|spell|permanent|card|eldrazi|artifact|source|object)s?\b|\bdevoid\b/, (t, c) => !!c?.colorless],
    ["fichas", /creature tokens?|\bpopulate\b|\bamass\b|\bincubate\b|\btokens? you control\b|for each token|\bfor each creature token/],
    ["morir", /\bdies\b|put into (a|your) graveyard from the battlefield/],
    ["contadores +1/+1", /\+1\/\+1 counters?|\bevolve\b|\badapt \d|\boutlast\b|\bmodular\b|\bmentor\b|\btraining\b|\bbolster\b|\bbackup \d/],
    ["sacrificio", /\bsacrific|\bexploit\b|\bcasualty\b|\bemerge\b/],
    ["cementerio", /\bgraveyards?\b|\bflashback\b|\bescape\b|\bunearth\b|\bdelve\b|\bdredge\b|\bembalm\b|\beternalize\b|\bdisturb\b|\bretrace\b|\bjump-start\b|\bsurveil\b/],
    ["hechizos", /\b(instant|sorcery|noncreature) spells?\b|\bprowess\b|\bmagecraft\b|instant or sorcery|\bstorm\b|copy target (instant|sorcery)/, (t) => t.includes("instant") || t.includes("sorcery")],
    ["ninjutsu", /\bninjutsu\b/],
    ["evasión", /can't be blocked|\bmenace\b|\bshadow\b|\bskulk\b|\bintimidate\b|\bfear\b|\bhorsemanship\b/],
    ["ciclo", /\bcycling\b|\bwhenever you cycle\b|\bcycle or discard\b/],
    ["energía", /\{e\}|\benergy counters?\b/],
    ["ganar vida", /\bgains? (\d+|x|that much) life\b|\blifelink\b|whenever you gain life/],
    ["vuelo", /\bflying\b/],
    ["auras", /\bauras?\b|\benchanted creature\b/, (t) => t.includes("aura")],
    ["encantamientos", /\benchantments?\b|\bconstellation\b/, (t) => t.includes("enchantment")],
    ["equipos", /\bequip(ment|ped)?\b/, (t) => t.includes("equipment")],
    ["robar cartas", /whenever you draw|draws? (your|their) (first|second|third)|for each card you('ve)? drawn|cards? you('ve)? drawn this turn/],
    ["descarte", /\bdiscards?\b|\bmadness\b/],
    ["molino", /\bmills?\b/],
    ["tierras", /\blandfall\b|\ba land enters\b|additional land|lands? you control/, (t) => t.includes("land")],
    ["entran criaturas", /whenever (a|another|one or more) (other )?(nontoken )?creatures? (you control )?enters?\b|whenever a creature enters the battlefield under your control/],
    ["efectos al entrar", /when (this \w+|it) enters|whenever (a|another) (creature|permanent) .{0,20}enters|\bevoke\b/],
    ["parpadeo", /\bexile .{0,50}\breturn (it|that card|them) to the battlefield/],
    ["devolver a la mano", /return (target|a|another) .{0,40} to (its|their) owner'?s hands?/],
    ["daño directo", /deals? \d+ damage to (any target|each opponent|target player|target opponent|each player)/],
    ["veneno", /\binfect\b|\bpoison\b|\btoxic\b/],
    ["atacar", /\bhaste\b|whenever .{0,30}\battacks\b|\bbattalion\b|\braid\b|\bdash\b|\bmyriad\b|\bexalted\b/],
    // "Criaturas que controlas" genérico; "criaturas incoloras/artefacto/rojas que controlas" es otro tema, no "cualquier criatura".
    ["criaturas", /(?<!(colorless|artifact|white|blue|black|red|green|multicolored|monocolored|legendary|nontoken|token|attacking|blocking|tapped|untapped|nonartifact) )creatures? you control\b|\bother creatures?\b/, (t) => t.includes("creature")],
  ];
  // Temas que se complementan aunque no se llamen igual (quien sacrifica quiere fichas, etc.).
  const RELATED = {
    "entran criaturas": ["fichas", "efectos al entrar", "parpadeo"], comida: ["sacrificio", "artefactos", "ganar vida"], sacrificio: ["fichas", "efectos al entrar", "morir", "comida"], fichas: ["sacrificio", "criaturas"], morir: ["sacrificio", "fichas"], cementerio: ["molino", "descarte"],
    molino: ["cementerio"], descarte: ["cementerio", "robar cartas"], contadores: ["contadores +1/+1", "planeswalkers"],
    "contadores +1/+1": ["contadores"], parpadeo: ["efectos al entrar"], "efectos al entrar": ["parpadeo", "devolver a la mano"],
    "devolver a la mano": ["efectos al entrar"], hechizos: ["robar cartas"], equipos: ["criaturas"], auras: ["criaturas"],
    ninjutsu: ["evasión", "vuelo", "efectos al entrar", "devolver a la mano"], evasión: ["atacar"], ciclo: ["cementerio", "descarte"],
    incoloro: ["artefactos"], vehículos: ["criaturas"],
  };
  // Temas concretos que pesan más que los genéricos (lo que de verdad pide la carta).
  // "criaturas" pesa poco: ser una criatura no es sinergia (si no, cualquier criatura entra por encima de las cartas buenas).
  const THEME_W = { "criaturas incoloras": 2, ninjutsu: 1.5, veneno: 1.5, vehículos: 1.3, criaturas: 0.5, "entran criaturas": 1.5 };
  const LAND_NOISE = new Set(["efectos al entrar", "sacrificio", "artefactos", "tierras", "ganar vida"]);
  const NEEDS_CREATURES = new Set(["equipos", "auras", "vehículos", "ninjutsu", "evasión", "atacar", "contadores +1/+1", "entran criaturas"]);
  // Temas que piden MUCHAS criaturas (cuantas más entren, mejor): pesan como un tipo de carta.
  const WANTS_MANY_CREATURES = new Set(["entran criaturas"]);
  /* Cada habilidad y acción de palabra clave de las Reglas Completas (19-jun-2026, secciones 701 y 702) apunta al tema
   * con el que hace sinergia. Así se reconocen mecánicas aunque el texto no diga "graveyard" o "token". */
  const KEYWORD_THEMES = {
    cementerio: ["flashback", "dredge", "delve", "unearth", "escape", "embalm", "eternalize", "disturb", "retrace", "jump-start", "aftermath",
      "scavenge", "recover", "encore", "harmonize", "forage", "collect evidence", "surveil", "mayhem", "threshold", "delirium", "undergrowth", "descend"],
    molino: ["mill"],
    descarte: ["madness", "connive", "hellbent"],
    ciclo: ["cycling"],
    sacrificio: ["exploit", "casualty", "emerge", "devour", "offering", "bargain", "blitz", "decayed"],
    morir: ["afterlife", "persist", "undying", "morbid", "revolt"],
    fichas: ["populate", "amass", "incubate", "fabricate", "mobilize", "myriad", "squad", "offspring", "living weapon"],  // (Tesoros y Pistas son artefactos, no fichas de criatura)
    "contadores +1/+1": ["evolve", "adapt", "outlast", "modular", "bolster", "support", "training", "mentor", "backup", "renown", "monstrosity",
      "graft", "riot", "ravenous", "unleash", "tribute", "bloodthirst", "increment"],
    contadores: ["proliferate", "level up", "fading", "vanishing", "suspend", "time travel"],
    veneno: ["infect", "toxic", "poisonous", "wither", "for mirrodin!"],
    hechizos: ["prowess", "storm", "magecraft", "rebound", "splice", "replicate", "cipher", "foretell", "spree", "epic", "gravestorm"],
    atacar: ["dash", "battle cry", "exalted", "melee", "raid", "annihilator", "enlist", "freerunning", "boast", "firebending", "max speed", "start your engines!", "battalion", "bushido", "flanking", "rampage", "afflict"],
    evasión: ["shadow", "horsemanship", "intimidate", "fear", "menace", "skulk", "landwalk", "swampwalk", "islandwalk", "forestwalk", "mountainwalk", "plainswalk"],
    "efectos al entrar": ["evoke", "ingest", "disguise", "morph", "manifest", "cloak", "explore", "discover", "cascade"],
    parpadeo: ["phasing"],
    artefactos: ["affinity", "improvise", "metalcraft", "living metal", "craft", "prototype", "assemble", "fortify"],
    vehículos: ["crew", "saddle", "station"],
    encantamientos: ["constellation", "bestow", "umbra armor", "eerie"],
    equipos: ["equip", "reconfigure"],
    auras: ["enchant creature", "aura swap"],
    tierras: ["landfall", "awaken", "domain", "earthbend"],
    "ganar vida": ["lifelink", "extort"],
    vuelo: ["flying"],
  };
  const KW_RX = Object.entries(KEYWORD_THEMES).map(([t, kws]) => [t, new RegExp(`(^|[\\n(,;.] ?|\\b)(${kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`)]);
  /* Facilitadores y recompensas (setup / payoff, EDHREC y StarCityGames): un plan necesita muchas cartas que HACEN la cosa
   * por cada carta que la PREMIA; si no, las recompensas se quedan en la mano. Recompensa = "cada vez que…", "por cada…". */
  const PAYOFF = {
    fichas: /whenever (a|one or more) (creature )?tokens?|for each (creature|token)|creatures? you control get \+|tokens you control/,
    sacrificio: /whenever you sacrifice|sacrifice (a|another) (creature|permanent|artifact|token)[^:]{0,20}:/,
    morir: /whenever (a|another) (nontoken )?creature (you control )?dies/,
    cementerio: /from your graveyard|for each card in your graveyard|\bflashback\b|\bescape\b|\bdelve\b|\bthreshold\b|\bdelirium\b/,
    hechizos: /whenever you cast (an|a) (instant|sorcery|noncreature)|\bprowess\b|\bmagecraft\b|instant (and|or) sorcery cards? in your graveyard/,
    artefactos: /for each artifact|\baffinity for artifacts\b|\bmetalcraft\b|whenever (an|another) artifact|\bimprovise\b/,
    "ganar vida": /whenever you gain life/,
    tierras: /\blandfall\b|whenever a land (you control )?enters/,
    "contadores +1/+1": /with a \+1\/\+1 counter|for each \+1\/\+1 counter|whenever one or more \+1\/\+1 counters|\bproliferate\b/,
    "entran criaturas": /whenever (a|another|one or more) (other )?(nontoken )?creatures? (you control )?enters?/,
    encantamientos: /\bconstellation\b|whenever (an|another) enchantment|for each enchantment/,
    descarte: /whenever you discard|\bmadness\b/,
  };
  const ENABLER = {
    fichas: /create .{0,40}tokens?|\bpopulate\b|\bamass\b|\bmyriad\b/,
    sacrificio: /create .{0,40}tokens?|when (this card|it) dies|\bafterlife\b|\bpersist\b|\bundying\b/,
    morir: /create .{0,40}tokens?|sacrifice (a|another) creature/,
    cementerio: /\bmills?\b|\bsurveil\b|\bdiscard\b|\bdredge\b|\bcycling\b|\bthis card\b[^.]{0,30}into your graveyard/,
    "ganar vida": /\bgains? (\d+|x|that much) life\b|\blifelink\b/,
    tierras: /search your library for (a|an|up to \w+) (basic )?land|put (a|up to \w+) land cards? .{0,40}onto the battlefield|additional land|return (a|target) land/,
    "contadores +1/+1": /put (a|two|three|x|that many) \+1\/\+1 counters?|\bevolve\b|\badapt\b|\boutlast\b|\btraining\b|\bmentor\b|\bbolster\b/,
    descarte: /\bdiscards? (a|two|that|your hand)|\bcycling\b|\bconnive\b|\bfaithless looting\b/,
    encantamientos: /./,  // cualquier encantamiento lo es (se mira por tipo)
  };
  const THEME_PRED = Object.fromEntries(THEMES.filter((t) => t[2]).map((t) => [t[0], t[2]]));
  const ROLES = {
    ramp: /\badd (\{|one mana|two mana|three mana|x mana|mana|an amount of)|search your library for (a|up to \w+) (basic )?(land|forest|plains|island|swamp|mountain)|put (a|up to \w+) land cards? .{0,30}onto the battlefield/,
    draw: /\bdraws? (two|three|four|x|a) cards?\b|\binvestigate\b|\bscry \d|\bsurveil \d/,
    removal: /destroy target (creature|artifact|enchantment|permanent|nonland)|exile target (creature|permanent|nonland|artifact|enchantment)|deals? \d+ damage to (any target|target creature)|target creature gets -\d+\/-\d+|counter target spell|fights? (another )?target creature/,
    wipe: /destroy all (creatures|nonland)|exile all (creatures|nonland)|deals? \d+ damage to each creature|all creatures get -\d+\/-\d+/,
    protect: /(you control|equipped creature|enchanted creature) (gains?|has|have) [^.]{0,40}(hexproof|indestructible|shroud|protection from)|\bphases? out\b|prevent all combat damage|return (target|all) [^.]{0,40}from your graveyard to the battlefield/,
  };
  const ROLE_NAMES = { ramp: "acelera el maná", draw: "roba cartas", removal: "quita amenazas del rival", wipe: "barre la mesa", protect: "protege tu plan" };
  // Cuántas cartas de cada función quiere un mazo (60 cartas / Commander 100).
  const TARGETS = { 60: { removal: 6, draw: 3, ramp: 0, wipe: 0, protect: 0 }, 100: { removal: 10, draw: 10, ramp: 10, wipe: 2, protect: 4 } };
  // Nivel de optimización (1 meme … 5 competitivo): cuánto pesan la potencia de la carta (popularidad en EDHREC),
  // la sinergia, las funciones básicas, las listas de torneo y las cartas caras.
  const POWER = {
    1: { rank: -3, syn: 1.4, cap: Infinity, roles: 0.4, co: 0, heavy: -0.5, gc: 0 },
    2: { rank: 0, syn: 1.2, cap: Infinity, roles: 0.75, co: 0.5, heavy: 0, gc: 0 },
    3: { rank: 2, syn: 1, cap: Infinity, roles: 1, co: 1, heavy: 0, gc: 0 },
    4: { rank: 3, syn: 1, cap: Infinity, roles: 1.15, co: 1.5, heavy: 0.8, gc: 2, staples: 6 },
    5: { rank: 4, syn: 1, cap: Infinity, roles: 1.3, co: 2, heavy: 1.6, gc: 4, staples: 12 },
    // World Champion: como en un Mundial o un RCQ. Lo que juegan las listas ganadoras, curva muy afinada y turnos potentes.
    6: { rank: 6, syn: 1, cap: Infinity, roles: 1.35, co: 3, heavy: 2.5, gc: 6, staples: 16, swaps: 16, swapGap: 1 },
  };
  const rankScore = (x) => (x.rank ? Math.max(0, 1 - Math.log10(x.rank) / Math.log10(30000)) : 0);
  const POWER_NAMES = { 1: "meme", 2: "muy casual", 3: "equilibrado", 4: "optimizado", 5: "competitivo", 6: "World Champion" };
  // Enfoques que puede elegir el jugador: temas que pesan más y funciones que se piden más.
  const FOCUS = {
    rampa: { themes: { rampa: 4, "bichos grandes": 4 }, roles: { ramp: 6 } },
    grandes: { themes: { "bichos grandes": 5 }, roles: { ramp: 3 } },
    robo: { themes: { "robar cartas": 3 }, roles: { draw: 6 } },
    control: { themes: {}, roles: { removal: 5, draw: 3, wipe: 1 }, style: "control" },
    aggro: { themes: { atacar: 3, evasión: 2 }, style: "aggro" },
    tierras: { themes: { tierras: 5, rampa: 2 } },
    fichas: { themes: { fichas: 5, "entran criaturas": 2 } },
    sacrificio: { themes: { sacrificio: 4, morir: 3, fichas: 2 } },
    cementerio: { themes: { cementerio: 5, molino: 2 } },
    descarte: { themes: { descarte: 5 } },
    hechizos: { themes: { hechizos: 5 } },
    vuelo: { themes: { vuelo: 5, evasión: 2 } },
    vida: { themes: { "ganar vida": 5 } },
    contadores: { themes: { "contadores +1/+1": 5, contadores: 2 } },
    artefactos: { themes: { artefactos: 5 } },
    encantamientos: { themes: { encantamientos: 5, auras: 2 } },
    equipos: { themes: { equipos: 4, auras: 4 } },
    parpadeo: { themes: { parpadeo: 4, "efectos al entrar": 4 } },
    "daño": { themes: { "daño directo": 5 } },
  };
  // Lo que hace cada color en Magic (los arquetipos de siempre): se recomiendan esos enfoques y, si las cartas base
  // no marcan un plan claro, empujan un poco hacia ellos. El verde no hace control; el rojo no rampea.
  const COLOR_ARCH = { W: ["fichas", "vida", "vuelo", "equipos", "parpadeo", "aggro"], U: ["robo", "control", "vuelo", "hechizos", "artefactos"],
    B: ["sacrificio", "cementerio", "descarte", "control", "vida"], R: ["aggro", "daño", "hechizos", "artefactos", "fichas"],
    G: ["rampa", "grandes", "tierras", "contadores", "fichas"] };
  // Brackets de Commander: cuántos Game Changers, y nada de destruir todas las tierras ni turnos extra en cadena.
  const BRACKETS = { 1: { gc: 0, mld: false, turns: 0 }, 2: { gc: 0, mld: false, turns: 0 }, 3: { gc: 3, mld: false, turns: 1 },
    4: { gc: Infinity, mld: true, turns: Infinity }, 5: { gc: Infinity, mld: true, turns: Infinity } };
  const COLOR_NAMES = { W: "blanco", U: "azul", B: "negro", R: "rojo", G: "verde", C: "incoloro" };
  const BASIC_FOR = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest", C: "Wastes" };
  const FORMATS = { pauper: 6, standard: 10, commander: 9 };  // índice en la fila de la carta (legalidad)
  // Legalidad del resto de formatos: un carácter por formato en O[oi][12] (0 no, 1 legal, 2 baneada, 3 restringida).
  // Mismo orden que LEGAL_FMTS en pipeline/ingest_prices.py.
  const LEGAL_FMTS = ["pioneer", "modern", "legacy", "vintage", "premodern", "oldschool", "penny", "duel", "paupercommander",
    "predh", "oathbreaker", "brawl", "standardbrawl", "gladiator", "timeless", "historic"];
  function legalOf(o) {
    const l = { pauper: o[6], commander: o[9], standard: o[10] }, str = o[12] || "";
    LEGAL_FMTS.forEach((f, i) => { l[f] = +(str[i] || 0); });
    return l;
  }
  /* Normas de cada formato del creador de mazos. size: cartas del mazo; cmd: lleva comandante ("pw" = un planeswalker, como
   * en Oathbreaker; "pdh" = criatura infrecuente, como en Pauper Commander); single: una copia de cada (salvo básicas);
   * key: con qué legalidad se mira; meta: código de MTGTop8 (o de los mazos de ejemplo); budget/perCard: topes en céntimos. */
  const FORMAT_DEFS = {
    pauper: { size: 60, meta: "PAU" }, standard: { size: 60, meta: "ST" }, pioneer: { size: 60, meta: "PI" },
    modern: { size: 60, meta: "MO" }, legacy: { size: 60, meta: "LE" }, vintage: { size: 60, meta: "VI" },
    premodern: { size: 60, meta: "PREM" }, oldschool: { size: 60 }, penny: { size: 60 }, timeless: { size: 60 },
    historic: { size: 60, meta: "HI" }, explorer: { size: 60, key: "pioneer", meta: "EXP" },
    peasant: { size: 60, meta: "PEA", peasant: true },  // solo cartas impresas como común o infrecuente
    valuevintage: { size: 60, key: "vintage", meta: "VV", budget: 2800, perCard: 50, ban: ["nadu, winged wisdom"] },  // 30 $ el mazo entero
    commander: { size: 100, cmd: true, single: true }, cedh: { size: 100, cmd: true, single: true, key: "commander", meta: "cEDH" },
    duel: { size: 100, cmd: true, single: true, meta: "DC" }, paupercommander: { size: 100, cmd: "pdh", single: true },
    predh: { size: 100, cmd: true, single: true }, brawl: { size: 100, cmd: true, single: true },
    standardbrawl: { size: 60, cmd: true, single: true }, oathbreaker: { size: 60, cmd: "pw", single: true },
    highlander: { size: 100, single: true, key: "vintage", meta: "HIGH" }, canlander: { size: 100, single: true, key: "vintage", meta: "CHL", maxPoints: 10 },
    gladiator: { size: 100, single: true }, casual: { size: 60 },
  };
  // Canadian Highlander: puntos de las cartas más potentes; el mazo no puede pasar de 10 (canadianhighlander.ca, marzo de 2026).
  const CHL_POINTS = { "ancestral recall": 8, "ancient tomb": 1, "balance": 1, "black lotus": 7, "demonic tutor": 3, "dig through time": 1, "enlightened tutor": 1, "flash": 7, "forth eorlingas!": 1, "gifts ungiven": 1, "imperial seal": 1, "intuition": 1, "mana crypt": 5, "mana drain": 1, "mana vault": 1, "merchant scroll": 1, "mox emerald": 3, "mox jet": 3, "mox pearl": 3, "mox ruby": 3, "mox sapphire": 3, "mystical tutor": 2, "nadu, winged wisdom": 1, "natural order": 1, "psychic frog": 1, "reanimate": 1, "sol ring": 3, "spellseeker": 1, "strip mine": 1, "tainted pact": 1, "tamiyo, inquisitive student": 1, "thassa's oracle": 5, "the fantasticar": 1, "the one ring": 1, "time vault": 7, "time walk": 5, "tinker": 3, "tolarian academy": 2, "treasure cruise": 1, "true-name nemesis": 1, "underworld breach": 3, "urza's saga": 1, "vampiric tutor": 2, "white plume adventurer": 1, "wishclaw talisman": 1, "wrenn and six": 1 };
  const pointsOf = (name) => CHL_POINTS[norm(name)] || 0;
  const FMT_LABEL = { pauper: "Pauper", standard: "Estándar", pioneer: "Pioneer", modern: "Modern", legacy: "Legacy", vintage: "Vintage",
    premodern: "Premodern", oldschool: "Old School", penny: "Penny Dreadful", timeless: "Timeless", historic: "Historic", explorer: "Explorer",
    peasant: "Peasant", valuevintage: "Value Vintage", commander: "Commander", cedh: "cEDH", duel: "Duel Commander",
    paupercommander: "Pauper Commander", predh: "PreDH", brawl: "Brawl", standardbrawl: "Standard Brawl", oathbreaker: "Oathbreaker",
    highlander: "Highlander", canlander: "Canadian Highlander", gladiator: "Gladiator", casual: "Casual" };
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function analyse(c) {
    const text = (c.oracle_text || "").toLowerCase().split(c.name.toLowerCase()).join("this card")
      .replace(/\bthis (creature|enchantment|artifact|land|equipment|vehicle|aura|planeswalker|saga|spell|token|permanent|battle|siege|case|class|room|card)\b/g, "this card");
    const type = (c.type_line || "").toLowerCase();
    // Incolora: sin símbolos de color en el coste (híbridos y pirexianos cuentan como color) o con devoid.
    c.colorless = !type.includes("land") && (!/\{[^}]*[WUBRG][^}]*\}/.test(c.mana_cost || "") && !(c.colors && c.colors.size && !c.mana_cost) || /\bdevoid\b/.test(text));
    c.text = text;
    c.text_tags = new Set(THEMES.filter(([, rx]) => rx.test(text)).map(([n]) => n));
    for (const [t, rx] of KW_RX) if (rx.test(text)) c.text_tags.add(t);
    c.type_tags = new Set(THEMES.filter(([, , pred]) => pred && pred(type, c)).map(([n]) => n));
    c.payoff = new Set(Object.keys(PAYOFF).filter((t) => PAYOFF[t].test(text)));
    c.enabler = new Set(Object.keys(ENABLER).filter((t) => (t === "encantamientos" ? type.includes("enchantment")
      : t === "hechizos" ? false : ENABLER[t].test(text)) && !c.payoff.has(t)));
    if ((type.includes("instant") || type.includes("sorcery")) && !c.payoff.has("hechizos")) c.enabler.add("hechizos");
    if (type.split(" // ")[0].includes("artifact") && !c.payoff.has("artefactos")) c.enabler.add("artefactos");
    c.subtypes = new Set((c.type_line || "").includes("—") ? c.type_line.split("—")[1].replace(/\/\//g, " ").split(/\s+/).filter(Boolean) : []);
    c.roles = new Set(Object.keys(ROLES).filter((r) => ROLES[r].test(text)));
    if (type.split(" // ")[0].includes("land")) c.roles.delete("ramp");
    const front = type.split(" // ")[0];
    c.is_land = front.includes("land");
    c.is_creature = front.includes("creature");
    c.can_command = (type.includes("legendary") && type.includes("creature")) || text.includes("can be your commander");
    c.cmdr_only = /\bcommander/.test(text.replace("can be your commander", ""));  // "your commander's color identity"…
    c.mld = /destroy all (nonbasic )?lands|(each player|each opponent) sacrifices [^.]{0,20}lands|exile all lands|destroy all permanents/.test(text);
    c.extra_turn = /extra turn/.test(text);
    c.one_sided = /(your opponents control|you don't control|each opponent)/.test(text);
    c.text = text;
    return c;
  }
  function mentions(subtype, text) {
    const t = subtype.toLowerCase();
    const forms = [t, t + "s", ...(t.endsWith("f") ? [t.slice(0, -1) + "ves"] : [])];
    return new RegExp(`\\b(${forms.map(reEsc).join("|")})\\b`).test(text);
  }
  function producedColors(c) {
    const text = c.oracle_text || "";
    if (text.includes("any color") || text.includes("one mana of any")) return new Set("WUBRG");
    const out = new Set();
    for (const m of text.matchAll(/[Aa]dd ([^.]*)/g)) for (const s of m[1].matchAll(/\{([WUBRGC])\}/g)) out.add(s[1]);
    return out;
  }

  /** El "plan" del mazo: pesos de temas (lo que piden las cartas) y de tipos, y las tribus. */
  function makePlan(seeds) {
    const plan = { wantsText: new Map(), wantsType: new Map(), tribes: new Set() };
    const bump = (m, k, w) => m.set(k, (m.get(k) || 0) + w);
    for (const s of seeds) addToPlan(plan, s, 3, bump);
    return plan;
  }
  function addToPlan(plan, c, w, bump = (m, k, x) => m.set(k, (m.get(k) || 0) + x)) {
    for (const t of c.text_tags) {
      const tw = w * (THEME_W[t] || 1);
      bump(plan.wantsText, t, tw);                    // la carta habla de esto: quiere más cartas que lo hagan
      if (THEME_PRED[t]) bump(plan.wantsType, t, tw); // y si es un tipo de carta, quiere cartas de ese tipo
      for (const r of RELATED[t] || []) bump(plan.wantsText, r, w * 0.4);
    }
    for (const t of c.type_tags) bump(plan.wantsText, t, w * 0.5 * (THEME_W[t] || 1));  // lo que es la carta: le gustan quienes lo aprovechan
    for (const t of c.text_tags) if (NEEDS_CREATURES.has(t)) bump(plan.wantsType, "criaturas", w * (WANTS_MANY_CREATURES.has(t) ? 1 : 0.25));
    for (const t of c.subtypes) if (w >= 3 && mentions(t, c.text)) plan.tribes.add(t);
  }
  function fit(plan, c, skip = null) {
    let score = 0;
    const why = new Map();
    const add = (k, v) => { if (v > 0 && !skip?.has(k)) { score += v; why.set(k, (why.get(k) || 0) + v); } };
    for (const t of c.text_tags) add(t, plan.wantsText.get(t) || 0);
    for (const t of c.type_tags) add(t, 1.5 * (plan.wantsType.get(t) || 0));
    for (const t of plan.tribes) if (c.subtypes.has(t) || mentions(t, c.text)) add(`tribal: ${t}`, 7);
    const top = [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    return [score, top];
  }

  // ---- Guía del mazo: cómo se juega (para quien empieza) ----
  const THEME_TIPS = {
    comida: "Crea comida (Food) y úsala: sacrifícala para ganar vidas o para devolver criaturas como Cauldron Familiar una y otra vez.",
    fichas: "Llena la mesa de fichas y aprovéchalas: ataca en grupo, sacrifícalas o potencia a todas a la vez.",
    sacrificio: "Sacrifica las criaturas que ya han cumplido (fichas, o las que hacen algo al entrar o al morir) para sacar valor extra.",
    cementerio: "Tu cementerio es un recurso: llénalo pronto y recupera o lanza cartas desde él.",
    hechizos: "Lanza muchos hechizos baratos: cada instantáneo o conjuro activa a las cartas que los premian.",
    artefactos: "Juega muchos artefactos baratos: hacen más fuertes a las cartas que cuentan artefactos.",
    contadores: "Pon contadores pronto y multiplícalos (proliferar) para que tus amenazas crezcan turno a turno.",
    "contadores +1/+1": "Pon contadores +1/+1 desde el principio: tus criaturas crecen y algunas cartas los premian.",
    "ganar vida": "Encadena efectos de ganar vida: cada vez que ganas vida, tus cartas te dan algo a cambio.",
    vuelo: "Gana por el aire: tus voladores pasan por encima de las defensas del rival.",
    auras: "Pon las auras en una criatura difícil de quitar y ataca con ella; no lo apuestes todo a una criatura frágil.",
    equipos: "Equipa a criaturas baratas y ataca; si una muere, el equipo se queda para la siguiente.",
    encantamientos: "Juega encantamientos de forma constante: muchas de tus cartas crecen con cada uno que entra.",
    "robar cartas": "Roba mucho para encontrar tus piezas clave y no quedarte nunca sin cartas.",
    descarte: "Descarta cartas que te conviene tener en el cementerio, o deja al rival sin mano.",
    molino: "Muele cartas para llenar cementerios y, si es tu plan, para dejar al rival sin biblioteca.",
    tierras: "Juega una tierra cada turno (o más): cada tierra que entra activa tus efectos de aterrizaje.",
    "efectos al entrar": "Aprovecha lo que hacen tus criaturas al entrar: haz que salgan y vuelvan a entrar para repetirlo.",
    parpadeo: "Exilia y devuelve tus propias criaturas (parpadeo) para repetir sus efectos al entrar.",
    "devolver a la mano": "Devuelve tus criaturas a la mano y vuelve a jugarlas para repetir sus efectos; úsalo también para quitar bloqueadores.",
    "daño directo": "Usa el daño directo para quitar bloqueadores al principio y rematar al rival al final.",
    veneno: "Con 10 contadores de veneno el rival pierde: ataca con tus criaturas infectadas y protégelas.",
    atacar: "Ataca cada turno: muchas de tus cartas se activan al atacar o tienen prisa.",
    planeswalkers: "Protege a tus planeswalkers con criaturas y quitando amenazas: cada turno que sobreviven te dan ventaja.",
    legendarios: "Prioriza tus cartas legendarias: el mazo las premia.",
    vehículos: "Ten criaturas pequeñas para tripular tus vehículos.",
    criaturas: "Llena la mesa de criaturas: tus cartas premian tener muchas a la vez.",
    "entran criaturas": "Baja muchas criaturas baratas y fichas: cada una que entra activa tus cartas clave (daño, vida, robo…).",
    morir: "Tus criaturas valen más muertas: cada vez que una muere (o la sacrificas) sacas algo a cambio.",
    "criaturas incoloras": "Baja criaturas incoloras (artefacto o Eldrazi): son las que tus cartas clave potencian.",
    incoloro: "Juega cartas incoloras (artefactos, Eldrazi): tus cartas clave solo potencian o premian lo incoloro.",
    ninjutsu: "Ataca con criaturas baratas y difíciles de bloquear; si no las bloquean, cámbialas por tus ninjas y vuelve a jugarlas.",
    evasión: "Tus criaturas son difíciles de bloquear: ataca cada turno y protégelas para que el daño siga entrando.",
    ciclo: "Cicla las cartas que no te sirven ahora: robas otra y activas las cartas que premian ciclar o descartar.",
    energía: "Acumula energía con tus cartas y gástala en el momento justo para sacar efectos más grandes.",
  };
  const STYLE_TEXT = {
    aggro: "Agresivo: baja criaturas baratas desde el turno 1 y ataca cada turno, para ganar antes de que el rival se organice.",
    midrange: "Medio rango: amenazas sólidas y buenas respuestas. Aguanta el principio y gana a medio plazo con cartas más potentes.",
    control: "Control: responde a lo que haga el rival (quitar amenazas, robar cartas) y gana al final con pocas amenazas grandes.",
  };
  // El estilo lo decide el constructor (elegido o deducido de las cartas base).
  function deckGuide({ chosen, base, commander, plan, landsN, style }) {
    const names = (list) => list.map(([x]) => x.name).join(", ");
    const byScore = chosen.slice().sort((a, b) => (b[3] || 0) - (a[3] || 0));
    const core = [...base.filter((x) => x !== commander), ...byScore.map(([x]) => x).filter((x) => !base.includes(x))].slice(0, 6);
    const themes = [...plan.wantsText.entries()].filter(([t, w]) => w >= 3 && THEME_TIPS[t]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
    const tips = themes.map((t) => {
      const users = chosen.filter(([x]) => x.text_tags.has(t) || x.type_tags.has(t)).slice(0, 3);
      return `${THEME_TIPS[t]}${users.length ? ` Cartas: ${names(users)}.` : ""}`;
    });
    for (const tribe of plan.tribes) tips.unshift(`Juega muchos ${tribe}: se potencian entre ellos, así que cuantos más tengas en mesa, mejor.`);
    // Combos: una carta clave que "pide" algo y otra del mazo que lo da.
    // Combos: una carta clave que "pide" algo y otra del mazo que lo da (uno por tema, sin repetir cartas).
    const combos = [], usedThemes = new Set(), usedCards = new Set();
    for (const a of core) {
      for (const [b] of chosen) {
        if (a === b || combos.length >= 4 || usedCards.has(b.name) || usedCards.has(`${b.name}+${a.name}`)) continue;
        const direct = [...a.text_tags].find((t) => !usedThemes.has(t) && b.type_tags.has(t));
        const rel = [...a.text_tags].find((t) => !usedThemes.has(t) && (RELATED[t] || []).some((r) => b.text_tags.has(r)));
        const t = direct || rel;
        if (!t) continue;
        const gives = direct ? t : (RELATED[t] || []).find((r) => b.text_tags.has(r));
        combos.push(`${a.name} + ${b.name}: ${b.name} aporta ${gives} y ${a.name} lo aprovecha (${t}).`);
        usedThemes.add(t);
        usedCards.add(b.name);
        usedCards.add(`${a.name}+${b.name}`);
      }
    }
    const phase = (lo, hi) => byScore.filter(([x]) => x.cmc >= lo && x.cmc <= hi).slice(0, 3);
    const early = phase(0, 2), mid = phase(3, 4), late = phase(5, 99);
    const turns = [
      early.length ? `Turnos 1-2: ${names(early)}.` : null,
      mid.length ? `Turnos 3-4: ${names(mid)}${style === "control" ? ", y guarda maná para responder" : ""}.` : null,
      commander ? `Cuando tengas el maná, ${commander.name}; si te lo quitan, vuelve a jugarlo desde la zona de mando.` : null,
      late.length ? `Del turno 5 en adelante: ${names(late)} para cerrar la partida.` : null,
    ].filter(Boolean);
    const mulligan = style === "aggro"
      ? `Quédate manos con 2-3 tierras (el mazo lleva ${landsN}) y al menos dos cartas de coste 1-2. Con 0-1 o 5+ tierras, mulligan.`
      : style === "control"
        ? `Quédate manos con 3-4 tierras (el mazo lleva ${landsN}) y algo para responder. Con 1 tierra o con 6+, mulligan.`
        : `Quédate manos con 2-4 tierras (el mazo lleva ${landsN}) y alguna jugada para los turnos 2-3. Con 0-1 o 5+ tierras, mulligan.`;
    return { style, style_text: STYLE_TEXT[style], core: core.map((x) => x.name), plan: tips, combos, turns, mulligan };
  }

  // Estilos: cambian la curva, las tierras, cuántas criaturas y cuántas respuestas lleva el mazo.
  const STYLES = {
    aggro: { caps: { 0: 4, 1: 12, 2: 16, 3: 10, 4: 5, 5: 2, 6: 1 }, land: -1.5, creature: 1.2, heavyAt: 4, heavy: 2.5,
      target: { 60: { removal: 4, draw: 1, ramp: 0, wipe: 0, protect: 0 }, 100: { removal: 8, draw: 10, ramp: 9, wipe: 1, protect: 5 } } },
    midrange: { caps: { 0: 4, 1: 12, 2: 14, 3: 12, 4: 9, 5: 6, 6: 4 }, land: 0, creature: 0.4, heavyAt: 6, heavy: 1.5, target: TARGETS },
    // control: en Pauper, Brainstorm, Preordain, Faerie Seer… son de coste 1
    control: { caps: { 0: 4, 1: 12, 2: 12, 3: 12, 4: 9, 5: 6, 6: 4 }, land: 1, creature: -0.8, heavyAt: 7, heavy: 0.5,
      target: { 60: { removal: 9, draw: 5, ramp: 0, wipe: 1, protect: 0 }, 100: { removal: 12, draw: 12, ramp: 10, wipe: 4, protect: 3 } } },
  };
  /** Estilo que piden las cartas base (si el usuario elige "auto"). */
  function autoStyle(base, plan) {
    const avg = base.reduce((s, x) => s + x.cmc, 0) / base.length;
    const spells = base.filter((x) => !x.is_creature).length / base.length;
    const fast = ["atacar", "fichas", "daño directo", "veneno", "equipos", "auras", "entran criaturas", "ninjutsu"].some((t) => (plan.wantsText.get(t) || 0) >= 3);
    if (base.some((x) => x.text_tags.has("entran criaturas"))) return "aggro";
    if (base.every((x) => !x.is_creature) && base.some((x) => /counter target/.test(x.text))) return "control";
    if (avg <= 2.5 && !base.some((x) => x.cmc >= 5) && (fast || base.every((x) => x.is_creature))) return "aggro";
    if (spells >= 0.6 && base.some((x) => x.roles.has("removal") || x.roles.has("draw") || x.text_tags.has("hechizos") || x.text_tags.has("planeswalkers"))) return "control";
    return "midrange";
  }

  const FORMAT_META = Object.fromEntries(Object.entries(FORMAT_DEFS).filter(([, f]) => f.meta).map(([k, f]) => [k, f.meta]));
  /** Cuánto se juega cada carta en el main de las listas de torneo del formato (0-1, ponderado por la cuota de cada arquetipo). */
  function metaPlay(code) {
    const out = new Map();
    const decks = META.filter((d) => d.format === code);
    const total = decks.reduce((s, d) => s + (d.share || 0), 0) || 1;
    for (const d of decks) for (const k of new Set(d.cards.filter(([, , side]) => !side).map(([n]) => norm(n)))) out.set(k, (out.get(k) || 0) + (d.share || 0) / total);
    return out;
  }
  // Power 9: las nueve cartas más potentes de Magic. Con la opción activa entran (aunque no las tengas) las que van con el mazo:
  // Black Lotus siempre, el Mox de cada color del mazo, y las azules (Ancestral Recall, Time Walk, Timetwister) si es azul.
  const POWER9 = { "Black Lotus": "", "Mox Pearl": "W", "Mox Sapphire": "U", "Mox Jet": "B", "Mox Ruby": "R", "Mox Emerald": "G",
    "Ancestral Recall": "U", "Time Walk": "U", "Timetwister": "U" };
  /** Cuándo sale la primera impresión de una carta ("9999" si no se sabe): las que aún no han salido son spoilers. */
  const firstOutOf = (oi) => printsOf[oi].reduce((m, pi) => { const r = SETS.get(P[pi][2])?.released || "9999"; return r < m ? r : m; }, "9999");
  async function build({ c, seed, seeds, colors, format = "pauper", style: wanted = "auto", power: pw = 3, bracket: br = 3, focus = "", exclude = "", p9 = "", combo = "", buy = "", sbbuy = "", spoilers = "", offmeta = "" }) {
    const withOffmeta = String(offmeta) === "1";  // cartas legales con sinergia que no juega el meta
    const withSpoilers = String(spoilers) === "1";  // cartas anunciadas que aún no han salido
    const withBuy = String(buy) === "1", sbBuy = String(sbbuy) === "1";  // usar cartas que no tienes (para comprar) en el main / banquillo
    const withP9 = String(p9) === "1";
    const withCombo = String(combo) === "1";  // "Combo": se suma al estilo (control + combo, agresivo + combo…)
    if (withP9 && format !== "casual") format = "casual";  // solo son legales en Vintage (y prohibidas en Commander): el mazo va a Casual
    const power = POWER[+pw] ? +pw : 3, PW = POWER[power];
    const excluded = new Set(String(exclude || "").split("|").map((n) => norm(n.trim())).filter(Boolean));  // cartas que has quitado
    // Mazos oficiales (preconstruidos) con tus cartas base: las cartas que van con ellas son sinergia probada.
    let precons = [];
    try { precons = await extra("precons.json"); } catch { /* sin conexión: sin esta pista */ }
    // Combos infinitos de 2 cartas (Commander Spellbook): si una carta completa un combo con otra del mazo, entra antes.
    let comboList = [];
    try { comboList = await extra("combos.json"); } catch { /* sin conexión: sin combos */ }
    const comboFmt = COMBO_FMT[String(p9) === "1" ? "casual" : format] || "";
    const partners = new Map();  // carta → [[pareja, combo]]
    for (const k of comboList) {
      if (comboFmt && !k.legal.includes(comboFmt)) continue;
      const [a, b] = k.cards.map(norm);
      if (!partners.has(a)) partners.set(a, []); if (!partners.has(b)) partners.set(b, []);
      partners.get(a).push([b, k]); partners.get(b).push([a, k]);
    }
    const bracket = BRACKETS[+br] ? +br : 3;
    const id = binderOf(c) || 1;
    let fmt = format;
    const cheap = cheapest().price;
    const warnings = [];
    const mk = (oi, owned) => {
      const [name, type_line, cost, cmc, ci, oracle_text, pauper, rank, , commander, standard, gc] = O[oi];
      return analyse({ name: front(name), owned, type_line, oracle_text, mana_cost: cost || "", cmc: cmc || 0,
        colors: new Set(ci || ""), legal: legalOf(O[oi]), rank, oi, gc: gc === 1 });
    };
    const pool = new Map();
    for (const [pi, foil, qty0] of entries(id)) {
      // Los proxies solo cuentan en Casual (en Pauper, Estándar, Commander… no se pueden jugar en torneo).
      const qty = format === "casual" ? qty0 : qty0 - proxyOf(id, `${P[pi][0]}|${foil ? 1 : 0}`, qty0);
      if (qty <= 0) continue;
      const k = norm(O[P[pi][1]][0]);
      if (pool.has(k)) pool.get(k).owned += qty; else pool.set(k, mk(P[pi][1], qty));
    }
    const names = (seeds || seed || "").split("|").map((s) => s.trim()).filter(Boolean);
    if (!names.length) throw new Error("Elige al menos una carta");
    const base = names.map((n) => {
      const k = norm(n);
      if (pool.has(k)) return pool.get(k);
      const oi = oByNorm.get(k);
      if (oi == null) throw new Error(`No conozco la carta ${n}`);
      warnings.push(`No tienes ${front(O[oi][0])} en esta carpeta; el mazo está montado a su alrededor igualmente.`);
      return mk(oi, 0);
    });

    // Formato y comandante (normas en FORMAT_DEFS).
    if (!FORMAT_DEFS[fmt]) fmt = "casual";
    let F = FORMAT_DEFS[fmt];
    const printedAs = (x, rs) => printsOf[x.oi].some((pi) => rs.includes(P[pi][4]));
    const canLead = (x) => (F.cmd === "pw" ? /planeswalker/i.test(x.type_line || "")
      : F.cmd === "pdh" ? /creature/i.test(x.type_line || "") && printedAs(x, "u") : x.can_command);
    const commander = F.cmd ? base.find(canLead) || null : null;
    if (F.cmd && !commander) {
      warnings.push(F.cmd === "pw" ? `En Oathbreaker la carta base tiene que ser un planeswalker. He montado el mazo con ${base[0].name} igualmente.`
        : F.cmd === "pdh" ? `En Pauper Commander el comandante es una criatura impresa como infrecuente. He montado el mazo con ${base[0].name} igualmente.`
        : `Para ${FMT_LABEL[fmt]} la carta base tiene que ser una criatura legendaria. He montado un mazo de ${F.size} cartas con ${base[0].name} igualmente.`);
    }
    // Legalidad en el formato (las restringidas valen, con una copia)
    const legalIn = (x) => {
      if (fmt === "casual") return true;
      if (F.ban?.includes(norm(x.name))) return false;
      if (F.peasant) return printedAs(x, "cu") && [1, 3].includes(x.legal.vintage);
      return [1, 3].includes(x.legal[F.key || fmt]);
    };
    if (fmt !== "casual") {
      const bad = base.filter((x) => x !== commander && !legalIn(x) && !(withSpoilers && firstOutOf(x.oi) > today()));
      if (bad.length && !F.cmd) {
        warnings.push(`${bad.map((x) => x.name).join(", ")} no ${bad.length > 1 ? "son legales" : "es legal"} en ${FMT_LABEL[fmt]}; he montado el mazo en Casual.`);
        fmt = "casual"; F = FORMAT_DEFS.casual;
      }
    }
    const size = F.size;
    const maxCopies = F.single ? 1 : 4;
    const capOf = (x) => (fmt !== "casual" && x.legal[F.key || fmt] === 3 ? 1 : maxCopies);  // restringida: una copia
    const BR = fmt === "commander" ? BRACKETS[bracket] : BRACKETS[5];
    const baseSet = new Set(base);
    const legal = (x) => !(!F.cmd && x.cmdr_only) && legalIn(x) && (BR.mld || !x.mld)
      && (!F.perCard || baseSet.has(x) || (cheap[x.oi] || 0) <= F.perCard);  // Value Vintage: nada caro
    if (F.cmd === "pw") warnings.push("Oathbreaker: elige tú el hechizo insignia (un instantáneo o conjuro de los colores de tu planeswalker).");

    // "C" = incoloro: solo C → mazo incoloro; C con colores → esos colores premiando las cartas incoloras.
    const wantC = /c/i.test(colors || "");
    let deckColors = colors ? new Set(colors.toUpperCase().replace(/[^WUBRG]/g, "")) : new Set(commander ? commander.colors : base.flatMap((x) => [...x.colors]));
    if (commander) deckColors = new Set([...(colors ? deckColors : commander.colors)].filter((x) => commander.colors.has(x)));
    const plan = makePlan(base);
    if (wantC) plan.wantsType.set("incoloro", (plan.wantsType.get("incoloro") || 0) + 3);
    // Enfoque elegido por el jugador: sus temas pesan mucho.
    const FO = FOCUS[focus] || null;
    if (FO) for (const [t, w] of Object.entries(FO.themes)) {
      plan.wantsText.set(t, (plan.wantsText.get(t) || 0) + w);
      if (THEME_PRED[t]) plan.wantsType.set(t, (plan.wantsType.get(t) || 0) + w);
    }
    const subset = (a, b) => [...a].every((x) => b.has(x));
    let colorlessOnly = !!commander && !deckColors.size;
    if (!deckColors.size && !commander) {
      // Cartas base incoloras: si piden lo incoloro y hay bastantes cartas incoloras que encajan, mazo incoloro;
      // si no, el color con más sinergia en la carpeta.
      const colorlessFits = [...pool.values()].filter((x) => !x.is_land && x.colors.size === 0 && legal(x) && fit(plan, x)[0] > 0).length;
      if (wantC || ((plan.wantsType.get("incoloro") || 0) >= 3 && colorlessFits >= 14)) colorlessOnly = true;
      else {
        const by = new Map();
        for (const x of pool.values()) if (x.colors.size === 1 && !x.is_land && legal(x)) { const col = [...x.colors][0]; by.set(col, (by.get(col) || 0) + fit(plan, x)[0]); }
        deckColors = new Set([[...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "R"]);
      }
    }
    // Estilo: si las cartas base salen en listas del meta, el que tienen esos mazos (Aggro/Control/Combo); si no, lo que piden.
    const metaCode = FORMAT_META[fmt] || null;
    /* Copias de cada carta: si se juega en el meta, las que llevan de media las listas de torneo; si no, 4 solo las clave,
     * 2-3 las de apoyo y 2 las caras o legendarias (antes ponía tantas como tuvieras y faltaban cartas distintas). */
    const avgCopies = new Map((STAPLES[metaCode]?.cards || []).map(([n, , avg]) => [norm(n), avg]));
    const idealCopies = (x, sc) => {
      if (maxCopies === 1) return 1;
      const a = avgCopies.get(norm(x.name));
      if (a) return Math.max(1, Math.min(4, Math.round(a)));
      if (/legendary/i.test(O[x.oi][1]) || x.cmc >= 5) return 2;
      return sc >= 8 ? 4 : sc >= 5 ? 3 : 2;
    };
    const metaStyle = (() => {
      if (!metaCode) return null;
      const keys = new Set(base.map((x) => norm(x.name)));
      const votes = {};
      for (const d of META.filter((d) => d.format === metaCode && d.cards.some(([n, , side]) => !side && keys.has(norm(n))))) {
        const st = { aggro: "aggro", control: "control", combo: "midrange" }[(d.category || "").toLowerCase()];
        if (st) votes[st] = (votes[st] || 0) + (d.share || 1);
      }
      return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    })();
    // Si las cartas base apenas marcan un plan, el de siempre de sus colores (verde: rampa y bichos; azul: robo…).
    if (!FO && [...plan.wantsText.values()].reduce((a, b) => a + b, 0) < 5) {
      for (const col of deckColors) for (const f of (COLOR_ARCH[col] || []).slice(0, 2)) for (const [t, w] of Object.entries(FOCUS[f].themes)) {
        plan.wantsText.set(t, (plan.wantsText.get(t) || 0) + w * 0.4);
        if (THEME_PRED[t]) plan.wantsType.set(t, (plan.wantsType.get(t) || 0) + w * 0.4);
      }
    }
    let style = STYLES[wanted] ? wanted : FO?.style || metaStyle || autoStyle(base, plan);
    if (!STYLES[wanted] && style === "control" && deckColors.size && [...deckColors].every((col) => col === "G")) style = "midrange";  // el verde no hace control
    const st = STYLES[style];

    /* Competitivo y World Champion (Pauper, Estándar): como hace un jugador de torneo, se parte de la lista del meta que lleva
     * tus cartas base y con la que más cartas compartes (Mengu: "copiar lo que funciona y ajustar"). Sus copias, sus tierras
     * y su banquillo. En World Champion entra entera (lo que no tienes, para comprar); en Competitivo, lo que tienes. */
    let template = null;
    if (power >= 5 && FORMAT_META[fmt] && size === 60 && !commander) {
      const keys = new Set(base.map((x) => norm(x.name)));
      const ownedQ = (k) => pool.get(k)?.owned || 0;
      const rate = (d) => {
        const main = d.cards.filter(([, , side]) => !side);
        const hits = main.filter(([n]) => keys.has(norm(n))).length;
        if (colors) {
          const spells = main.map(([n, q]) => [oByNorm.get(norm(n)), q]).filter(([oi]) => oi != null && !/land/i.test(O[oi][1]));
          const fitQ = spells.filter(([oi]) => [...(O[oi][4] || "")].every((col) => deckColors.has(col))).reduce((a, [, q]) => a + q, 0);
          if (fitQ < 0.75 * spells.reduce((a, [, q]) => a + q, 0)) return -1;  // reseña: "no tiene consistencia, hechizos que no tienen nada que ver"
        }
        return hits ? hits * 100 + main.reduce((a, [n, q]) => a + Math.min(q, ownedQ(norm(n))), 0) + (d.share || 0) : -1;
      };
      template = META.filter((d) => d.format === FORMAT_META[fmt]).map((d) => [d, rate(d)]).filter(([, r]) => r >= 0).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      if (template && !colors) {  // los colores de la lista (p. ej. el splash de Galvanic Blast en Affinity)
        // (en Competitivo, solo los colores de las cartas de la lista que tienes: si no, básicas de colores que no se usan)
        for (const [n, , side] of template.cards) { const oi = oByNorm.get(norm(n)); if (!side && oi != null && !/land/i.test(O[oi][1]) && (power === 6 || withBuy || ownedQ(norm(n)))) for (const col of O[oi][4] || "") deckColors.add(col); }
      }
    }
    const baseKeys = new Set(base.map((x) => norm(x.name)));
    const candidates = [...pool.entries()].filter(([k, x]) => !x.is_land && !baseKeys.has(k) && !excluded.has(k) && legal(x) && subset(x.colors, deckColors)).map(([, x]) => x);
    if (withBuy) {  // también cartas que no tienes: las que juega el meta del formato o, si no hay meta, las que mejor encajan
      const have = new Set([...candidates, ...base].map((x) => x.oi));
      const mcode = FORMAT_META[fmt];
      const extraOis = mcode ? [...metaPlay(mcode).entries()].filter(([, v]) => v >= 0.04).map(([k]) => oByNorm.get(k))
        : (indexAll(), synergyCandidates(makePlan(base), have).slice(0, 150).map(([oi]) => oi));
      for (const oi of extraOis) {
        if (oi == null || have.has(oi)) continue;
        const x = mk(oi, maxCopies);
        x.buy = true;
        if (!x.is_land && legal(x) && subset(x.colors, deckColors) && !excluded.has(norm(x.name)) && cheap[oi] && cheap[oi] <= (fmt === "pauper" ? 500 : 3000)) { candidates.push(x); have.add(oi); }
      }
    }
    // Spoilers: cartas cuya primera impresión aún no ha salido. Aún no tienen legalidad: en Pauper valen si son comunes.
    const spoilerPool = [];
    if (withSpoilers) {
      const td = today(), first = new Map();
      for (let pi = 0; pi < P.length; pi++) { const r = SETS.get(P[pi][2])?.released || "9999", oi = P[pi][1]; if (!first.has(oi) || r < first.get(oi)) first.set(oi, r); }
      const have = new Set([...candidates, ...base].map((x) => x.oi));
      for (const [oi, r] of first) {
        if (r <= td || r === "9999" || have.has(oi)) continue;
        const x = mk(oi, maxCopies);
        x.buy = true; x.spoiler = r;
        const ok = fmt !== "pauper" || printsOf[oi].some((pi) => P[pi][4] === "c");
        if (!x.is_land && ok && !(!F.cmd && x.cmdr_only) && subset(x.colors, deckColors) && !excluded.has(norm(x.name))) { candidates.push(x); spoilerPool.push(x); have.add(oi); }
      }
    }
    // "Cartas fuera del meta": legales con sinergia que ninguna lista del meta juega (para mazos con sorpresa); las que no tienes, para comprar.
    if (withOffmeta) {
      indexAll();
      const playedMeta = FORMAT_META[fmt] ? metaPlay(FORMAT_META[fmt]) : new Map();
      const have = new Set([...candidates, ...base].map((x) => x.oi));
      for (const [oi] of synergyCandidates(makePlan(base), have).slice(0, 250)) {
        const k = norm(O[oi][0]);
        if (have.has(oi) || playedMeta.get(k) || excluded.has(k)) continue;
        const x = mk(oi, maxCopies);
        x.buy = true; x.offmeta = true;
        if (!x.is_land && legal(x) && subset(x.colors, deckColors) && cheap[oi] && cheap[oi] <= (fmt === "pauper" ? 500 : 3000)) { candidates.push(x); have.add(oi); }
      }
      for (const x of candidates) if (!playedMeta.get(norm(x.name))) x.offmeta = true;  // también las tuyas que no son meta
    }
    // Lo aprendido de tus "Mazos para probar": las cartas de mazos que ganan suben un poco; las de mazos que pierden, bajan.
    const learned = testedCardStats();
    const learnBonus = (x) => { const s = learned.get(norm(x.name)); return s && s.games >= 3 ? Math.max(-2, Math.min(2, (s.wins / s.games - 0.5) * 6)) : 0; };

    // 1) Cartas base.
    const chosen = [];   // [carta, copias, motivos]
    const curve = {};
    const roles = { ramp: 0, draw: 0, removal: 0, wipe: 0, protect: 0 };
    let pointsUsed = 0;
    const take = (x, n, why, score = 99) => {
      if (F.maxPoints && pointsOf(x.name)) {
        if (pointsUsed + pointsOf(x.name) > F.maxPoints) return false;
        pointsUsed += pointsOf(x.name);
      }
      n = Math.min(n, capOf(x));
      chosen.push([x, n, why, score]);
      const b = Math.min(Math.floor(x.cmc), 6);
      curve[b] = (curve[b] || 0) + n;
      for (const r of x.roles) roles[r] += n;
      // Lo elegido refuerza el plan (coherencia), pero solo los temas que ya tenía: así no se desvía de la carta base.
      if (x === commander) addToPlan(plan, x, 3);
      else addToPlan(plan, x, 0.35, (m, k, v) => { if (m.has(k)) m.set(k, m.get(k) + v); });
    };
    // Spoilers elegidos como carta base: aún no tienen legalidad, valen (en Pauper, si salen como común)
    for (const x of base) {
      const out = firstOutOf(x.oi);
      if (withSpoilers && out > today() && out !== "9999" && (fmt !== "pauper" || printsOf[x.oi].some((pi) => P[pi][4] === "c"))) { x.spoiler = out; x.buy = !x.owned; x.legalSpoiler = true; }
    }
    for (const x of base) {
      if (x === commander || !(legal(x) || x.legalSpoiler) || !subset(x.colors, deckColors) || x.is_land) continue;
      if (F.maxPoints && pointsUsed + pointsOf(x.name) > F.maxPoints) { warnings.push(`${x.name} vale ${pointsOf(x.name)} puntos y no cabe en los ${F.maxPoints} de Canadian Highlander: la he dejado fuera.`); continue; }
      take(x, x.owned ? Math.min(x.owned, capOf(x)) : capOf(x),
        [x.owned ? "carta base del mazo" : "carta base del mazo (no la tienes)"]);
    }
    if (commander) addToPlan(plan, commander, 0);

    const templateLands = [];
    if (template) {
      const why = `de la lista ganadora: ${template.archetype}${template.player ? ` (${template.player})` : ""}`;
      for (const [n, q, side] of template.cards) {
        const k = norm(n), oi = oByNorm.get(k);
        if (side || oi == null || excluded.has(k) || chosen.some(([y]) => norm(y.name) === k)) continue;
        const x = pool.get(k) || mk(oi, 0);
        if (!subset(x.colors, deckColors)) continue;  // de un color que no va en el mazo (p. ej. lo has quitado)
        if (x.is_land) { if (!BASICS.has(k)) templateLands.push([x, q]); continue; }
        const own = x.owned || 0, n2 = power === 6 || withBuy ? q : Math.min(q, own);
        if (n2 <= 0 || !legal(x)) continue;
        if (!own) x.buy = true;
        take(x, n2, [own >= n2 ? why : own ? `${why}; te faltan ${n2 - own}` : `${why} — no la tienes`]);
        for (const y of [...candidates]) if (norm(y.name) === k) candidates.splice(candidates.indexOf(y), 1);
      }
    }
    if (withP9) {
      const p9cards = Object.entries(POWER9).filter(([, col]) => !col || deckColors.has(col) || colorlessOnly && false).map(([n]) => n);
      for (const n of p9cards) {
        const oi = oByNorm.get(norm(n));
        if (oi == null || excluded.has(norm(n)) || chosen.some(([x]) => x.oi === oi)) continue;
        const x = pool.get(norm(n)) || mk(oi, 0);
        take(x, 1, [x.owned ? "Power 9" : "Power 9 (no la tienes)"]);  // restringidas: 1 copia
        const k = norm(n); for (const y of candidates) if (norm(y.name) === k) candidates.splice(candidates.indexOf(y), 1);
      }
    }
    // 2) Tierras según la curva (se recalcula al final) y relleno greedy por encaje + funciones.
    const spellSlots = () => size - (commander ? 1 : 0) - landsFor();
    const tplLandCount = template ? template.cards.filter(([n, , side]) => !side && /land/i.test(O[oByNorm.get(norm(n))]?.[1] || "")).reduce((a, [, q]) => a + q, 0) : 0;
    const landsFor = () => {
      if (tplLandCount >= 14) return tplLandCount;  // las de la lista ganadora
      const n = chosen.reduce((s, e) => s + e[1], 0);
      const avg = n ? chosen.reduce((s, [x, k]) => s + x.cmc * k, 0) / n : 2.5;
      // Como en los mazos reales: agresivo de curva 2 ≈ 17-18 tierras; control ≈ 23-24. Commander 33-38.
      // Commander: 38 tierras como mínimo (menos solo en competitivo, con curva muy baja y mucha aceleración).
      return size === 100 ? (power === 5 ? Math.max(33, Math.min(37, Math.round(29 + 2 * avg + st.land))) : Math.max(38, Math.min(40, Math.round(32 + 2 * avg + st.land))))
        : Math.max(16, Math.min(24, Math.round(13.5 + 2.4 * avg + st.land)));
    };
    // Cartas que aparecen junto a las base en listas de torneo (sinergia probada, no "lo que más se juega").
    const coPlay = new Map();
    const played = metaCode ? metaPlay(metaCode) : new Map();  // cuánto se juega cada carta en el formato
    const metaScore = (x) => Math.min(1, (played.get(norm(x.name)) || 0) * 2);  // 50 % del meta o más = 1
    {
      const baseNames = new Set(base.map((x) => norm(x.name)));
      const decksWith = META.filter((d) => (!metaCode || d.format === metaCode) && d.cards.some(([n, , side]) => !side && baseNames.has(norm(n))));
      for (const d of decksWith) for (const k of new Set(d.cards.filter(([, , side]) => !side).map(([n]) => norm(n)))) if (!baseNames.has(k) && !BASICS.has(k)) coPlay.set(k, (coPlay.get(k) || 0) + 1);
      for (const [k, n] of coPlay) { const r = n / decksWith.length; if (r < 0.34) coPlay.delete(k); else coPlay.set(k, r); }  // solo lo habitual en esas listas
    }
    // Lo que juegan las listas de torneo con tus cartas base: en competitivo pesa mucho (es lo que haría un jugador: copiar lo que funciona).
    const preco = new Map();  // y lo que va con ellas en los mazos oficiales (sobre todo para Casual y Commander)
    {
      const baseOi = new Set(base.map((x) => x.oi));
      const withBase = precons.filter((d) => d[5].some(([pi]) => baseOi.has(P[pi]?.[1])));
      if (withBase.length) {
        for (const d of withBase) for (const oi of new Set(d[5].map(([pi]) => P[pi]?.[1]).filter((oi) => oi != null && !baseOi.has(oi)))) preco.set(oi, (preco.get(oi) || 0) + 1);
        for (const [oi, n] of preco) { const r = n / withBase.length; if (n < 2 || r < 0.3 || BASICS.has(norm(O[oi][0]))) preco.delete(oi); else preco.set(oi, r); }
      }
    }
    const coBonus = (x) => 4 * (coPlay.get(norm(x.name)) || 0) * PW.co + 3 * (preco.get(x.oi) || 0) * (size === 100 || fmt === "casual" ? 1 : 0.5);
    let minCreatures = size === 100 ? 22 : { aggro: 16, midrange: 13, control: 8 }[style] || 12;
    if ((plan.wantsText.get("hechizos") || 0) >= 3 && !(plan.wantsType.get("criaturas") > 0)) minCreatures = Math.round(minCreatures / 2);
    const colorlessFocus = colorlessOnly || wantC || (plan.wantsType.get("incoloro") || 0) > 0;
    const creaturesIn = () => chosen.reduce((n, [x, k]) => n + (x.is_creature ? k : 0), 0);
    const capScale = size / 60;
    const CURVE_CAP = st.caps;
    const target = Object.fromEntries(Object.entries(st.target[size]).map(([k, v]) => [k, Math.round(v * PW.roles)]));
    // Sin "piloto automático": si el comandante ya acelera, hace falta menos rampa; si cuesta 3 o menos, nada de rampa de 3+ (Cultivate…).
    if (commander?.roles.has("ramp")) target.ramp = Math.round(target.ramp / 2);
    if (FO?.roles) for (const [r, v] of Object.entries(FO.roles)) target[r] = (target[r] || 0) + Math.round(v * (size === 100 ? 1.5 : 1));
    const voltron = !!commander && ["equipos", "auras"].some((t) => (plan.wantsText.get(t) || 0) >= 3);
    let gcCount = chosen.filter(([x]) => x.gc).length + (commander?.gc ? 1 : 0), turnsCount = chosen.filter(([x]) => x.extra_turn).length;
    const left = new Set(candidates);
    // Optimizado/competitivo: primero los mejores básicos de la carpeta (las cartas más jugadas que aceleran, roban,
    // quitan amenazas o protegen, y los Game Changers que permita el bracket); el resto del mazo, sinergia.
    if (PW.staples) {
      const fitsCurve = (x) => (curve[Math.min(Math.floor(x.cmc), 6)] || 0) < CURVE_CAP[Math.min(Math.floor(x.cmc), 6)] * capScale;
      // Commander: lo más jugado según EDHREC. Formatos de 60: lo más jugado en el meta del formato que encaja (Thought Vessel
      // es un básico de Commander, pero en Pauper no lo juega nadie).
      const staples = size === 100
        ? [...left].filter((x) => x.rank && x.rank <= 400 && (x.roles.size || x.gc) && !x.extra_turn && !(voltron && x.roles.has("wipe") && !x.one_sided))
          .sort((a, b) => (b.gc - a.gc) * (BR.gc > 0 ? 1 : 0) || a.rank - b.rank)
        : [...left].filter((x) => metaScore(x) >= 0.1 && (x.roles.has("removal") || x.roles.has("draw") || coPlay.has(norm(x.name))))
          .sort((a, b) => metaScore(b) - metaScore(a));  // interacción y robo del meta, o lo que se juega con tus cartas base
      let n = 0;
      for (const x of staples) {
        if (n >= PW.staples * (size === 100 ? 1 : 0.5)) break;
        if ((x.gc && gcCount >= BR.gc) || !fitsCurve(x)) continue;
        left.delete(x);
        take(x, Math.min(x.owned, capOf(x)), [`básico del formato (${POWER_NAMES[power]})`, ...[...x.roles].map((r) => ROLE_NAMES[r])]);
        if (x.gc) gcCount++;
        n++;
      }
    }
    while (left.size) {
      const used = chosen.reduce((s, e) => s + e[1], 0);
      if (used >= spellSlots()) break;
      // Si quedan justo los huecos para las funciones que faltan (robar, quitar amenazas…), se reservan.
      const deficit = Object.keys(target).reduce((s, r) => s + Math.max(0, target[r] - roles[r]), 0);
      const fits = (x) => (curve[Math.min(Math.floor(x.cmc), 6)] || 0) < CURVE_CAP[Math.min(Math.floor(x.cmc), 6)] * capScale;
      const mustRole = deficit > 0 && spellSlots() - used <= deficit
        && [...left].some((x) => fits(x) && [...x.roles].some((r) => roles[r] < target[r]));
      let best = null, bestScore = -Infinity, bestWhy = null;
      for (const x of left) {
        if (!fits(x)) continue;
        if (mustRole && ![...x.roles].some((r) => roles[r] < target[r])) continue;
        if (x.gc && gcCount >= BR.gc) continue;                       // bracket: tope de Game Changers
        if (x.extra_turn && turnsCount >= BR.turns) continue;         // bracket: turnos extra
        if (voltron && x.roles.has("wipe") && !x.one_sided) continue; // Voltron: un barrido simétrico mata a tu comandante
        const [s0, why] = fit(plan, x);
        // En optimizado/competitivo la sinergia tiene techo (rendimientos decrecientes) para que entren las cartas potentes.
        const s = PW.cap === Infinity ? s0 * PW.syn : PW.cap * (1 - Math.exp(-(s0 * PW.syn) / PW.cap));
        let need = 0;
        const roleWhy = [];
        for (const r of x.roles) if (roles[r] < target[r]) { need += 4 * (1 - roles[r] / target[r]) + 1; roleWhy.push(ROLE_NAMES[r]); }
        const co = coBonus(x);
        const cr = creaturesIn();
        if (x.is_creature && cr < minCreatures) { need += 3 * (1 - cr / minCreatures) + 1; if (!roleWhy.length && cr < minCreatures / 2) roleWhy.push("faltan criaturas"); }
        const onColor = !colorlessFocus && x.colors.size ? 0.8 : 0;  // en un mazo de color, mejor cartas de ese color que relleno incoloro
        const autopilot = commander && commander.cmc <= 3 && x.roles.has("ramp") && !x.is_creature && x.cmc >= 3 ? 2 : 0;
        // Potencia: en Commander, popularidad en EDHREC; en formatos con meta, lo que se juega en torneos; en Casual, un poco de EDHREC.
        // (un staple que no pinta nada en tu plan —p. ej. Myr Enforcer sin artefactos— cuenta poco)
        const power_ = size === 100 ? rankScore(x) : metaCode ? metaScore(x) * 1.5 * (s0 > 0 || x.roles.size || co ? 1 : 0.25) : rankScore(x) * 0.4;
        const cheapBody = x.is_creature && x.cmc <= 2 && (plan.wantsText.get("entran criaturas") || 0) >= 3 ? 2 : 0;  // muchas y baratas
        let balance = 0;
        for (const th of new Set([...x.payoff, ...x.enabler])) {
          if ((plan.wantsText.get(th) || 0) < 3) continue;
          const pay = chosen.reduce((n, [y, k]) => n + (y.payoff.has(th) ? k : 0), 0), en = chosen.reduce((n, [y, k]) => n + (y.enabler.has(th) ? k : 0), 0);
          if (x.enabler.has(th) && en < 2 * pay + 4) balance += 2;      // faltan cartas que hagan la cosa
          if (x.payoff.has(th) && pay * 2 > en + 4) balance -= 2;       // demasiadas recompensas para lo que hay
        }
        // Combo infinito con una carta que ya está en el mazo (en Commander, solo desde el bracket 4: en los bajos se pactan sin combos)
        const comboMate = withCombo || ((bracket >= 4 || size !== 100) && power >= 2) ? (partners.get(norm(x.name)) || []).find(([p]) => chosen.some(([y]) => norm(y.name) === p)) : null;
        const comboBonus = comboMate ? (withCombo ? 14 : 8) : 0;
        const score = s + need + co + onColor + power_ * PW.rank + cheapBody + balance + comboBonus + learnBonus(x) - (x.buy && !x.spoiler ? 0.5 : 0) + (x.offmeta ? 1.5 : 0) + (x.is_creature ? st.creature : 0)
          - (x.cmc >= st.heavyAt ? st.heavy : 0) - (x.cmc >= 5 ? PW.heavy : 0) - autopilot + (x.gc ? PW.gc : 0);
        if (score > bestScore) { bestScore = score; best = x; bestWhy = [...why.map((t) => (t.startsWith("tribal") ? t : `sinergia: ${t}`)),
          ...(comboMate ? [`combo infinito con ${comboMate[1].cards.find((n) => norm(n) !== norm(x.name))}`] : []),
          ...(coPlay.has(norm(x.name)) ? ["se juegan juntas en torneos"] : preco.has(x.oi) ? ["van juntas en mazos oficiales"] : []), ...roleWhy]; }
      }
      if (!best || (bestScore <= 0.5 && used >= spellSlots() * 0.6)) break;  // sin nada que encaje: mejor menos cartas que relleno
      left.delete(best);
      const room = Math.ceil(CURVE_CAP[Math.min(Math.floor(best.cmc), 6)] * capScale - (curve[Math.min(Math.floor(best.cmc), 6)] || 0));
      const fillsRole = [...best.roles].some((r) => roles[r] < target[r]);
      const reservable = [...left].some((x) => x !== best && fits(x) && [...x.roles].some((r) => roles[r] < target[r]));
      const free = spellSlots() - used - (fillsRole || !reservable ? 0 : deficit);  // no comerse los huecos reservados
      take(best, Math.max(1, Math.min(best.owned, capOf(best), free, room, idealCopies(best, bestScore))), bestWhy.length ? bestWhy : ["buena carta del color"], fit(plan, best)[0]);
      if (best.gc) gcCount++;
      if (best.extra_turn) turnsCount++;
    }
    if (fmt === "commander") {
      const gcBase = base.filter((x) => x.gc).map((x) => x.name);
      if (gcBase.length > BR.gc) warnings.push(`${gcBase.join(", ")} ${gcBase.length > 1 ? "son Game Changers" : "es Game Changer"}: con bracket ${bracket} no debería${gcBase.length > 1 ? "n" : ""} ir. Sube el bracket o quítala${gcBase.length > 1 ? "s" : ""}.`);
    }
    // Repaso final: con el mazo ya hecho (el plan reforzado), cambiar las cartas más flojas por otras de la carpeta que
    // valgan claramente más, sin tocar las cartas base, sin dejar funciones por debajo de lo necesario y en una curva parecida.
    const valueOf = (x) => fit(plan, x)[0] * PW.syn + coBonus(x) + (size === 100 ? rankScore(x) : metaCode ? metaScore(x) * 1.5 : rankScore(x) * 0.4) * PW.rank
      + (!colorlessFocus && x.colors.size ? 0.8 : 0) + (x.is_creature ? st.creature : 0);
    const swaps = [];
    for (let round = 0; round < (PW.swaps || 8); round++) {
      const weak = chosen.filter(([x, , why]) => !why[0]?.startsWith("carta base") && !why[0]?.startsWith("básico") && !why[0]?.startsWith("Power 9") && !why[0]?.startsWith("de la lista")
        && ![...x.roles].some((r) => roles[r] <= target[r]) && !(x.is_creature && creaturesIn() <= minCreatures))
        .map((e) => [e, valueOf(e[0])]).sort((a, b) => a[1] - b[1])[0];
      if (!weak) break;
      const [[wx, wn, wwhy], wv] = weak;
      const wb = Math.min(Math.floor(wx.cmc), 6);
      const better = [...left].filter((x) => Math.abs(Math.min(Math.floor(x.cmc), 6) - wb) <= 1 && x.owned >= Math.min(wn, capOf(x))
        && !(x.gc && gcCount >= BR.gc) && !(x.extra_turn && turnsCount >= BR.turns) && !(voltron && x.roles.has("wipe") && !x.one_sided))
        .map((x) => [x, valueOf(x)]).sort((a, b) => b[1] - a[1])[0];
      if (!better || better[1] < wv + (PW.swapGap ?? 2)) break;
      const [bx] = better;
      const i = chosen.findIndex((e) => e[0] === wx);
      chosen.splice(i, 1);
      curve[wb] -= wn; for (const r of wx.roles) roles[r] -= wn;
      left.delete(bx); left.add(wx);
      take(bx, Math.min(wn, bx.owned, capOf(bx)), [...fit(plan, bx)[1].map((t) => (t.startsWith("tribal") ? t : `sinergia: ${t}`)).slice(0, 2), `mejor que ${wx.name}`], valueOf(bx));
      if (bx.gc) gcCount++;
      swaps.push([wx.name, bx.name]);
    }
    // Mazos que roban mucho (o con motor de robo tipo Rhystic Study): 1-2 cartas que devuelven el cementerio a la biblioteca
    // (Campfire, Ghostly Flicker no; Kozilek's Return no…) para no perder por quedarte sin cartas. Sustituyen a las más flojas.
    if (size === 60) {
      const RECUR = /shuffle[^.]{0,80}graveyard[^.]{0,40}into (its owner's|their owners'?|your) librar|from your graveyard (on top of|on the bottom of|into) your library|your graveyard into your library/i;
      const drawN = chosen.reduce((n, [x, k]) => n + (x.roles.has("draw") ? k : 0), 0);
      const engine = chosen.some(([x]) => /whenever an opponent casts .{0,60}draw|draw an additional card|at the beginning of your upkeep, draw/i.test(O[x.oi][5] || ""));
      let need = (drawN >= 14 || engine ? 2 : drawN >= 10 ? 1 : 0) - chosen.reduce((n, [x, k]) => n + (RECUR.test(O[x.oi][5] || "") ? k : 0), 0);
      if (need > 0) {
        const own = [...left].filter((x) => !x.is_land && legal(x) && subset(x.colors, deckColors) && RECUR.test(O[x.oi][5] || ""));
        const pick = own.sort((a, b) => valueOf(b) - valueOf(a))[0]
          || (() => {  // la mejor que no tienes: primero las que barajan TODO el cementerio (Campfire…), luego las más jugadas
            const WHOLE = /shuffle[^.]{0,80}graveyard[^.]{0,40}into/i, found = [];
            for (let oi = 0; oi < O.length; oi++) {
              if (!RECUR.test(O[oi][5] || "")) continue;
              const x = mk(oi, 0);
              if (!x.is_land && legal(x) && subset(x.colors, deckColors) && cheap[oi] && cheap[oi] <= 300 && !excluded.has(norm(x.name)))
                found.push([x, (WHOLE.test(O[oi][5]) ? 100 : 0) + metaScore(x) * 50 + rankScore(x)]);
            }
            return found.sort((a, b) => b[1] - a[1])[0]?.[0] || null;
          })();
        if (pick) {
          const n = Math.min(need, pick.owned || need);
          for (let i = 0; i < n; i++) {  // quitar una copia de la carta más floja (nunca las base)
            const weakest = chosen.filter(([x, , w]) => !w[0]?.startsWith("carta base") && !w[0]?.startsWith("Power 9") && !w[0]?.startsWith("de la lista")).map((e) => [e, valueOf(e[0])]).sort((a, b) => a[1] - b[1])[0]?.[0];
            if (!weakest) break;
            weakest[1]--; curve[Math.min(Math.floor(weakest[0].cmc), 6)]--; for (const r of weakest[0].roles) roles[r]--;
            if (!weakest[1]) { chosen.splice(chosen.indexOf(weakest), 1); left.add(weakest[0]); }
          }
          left.delete(pick);
          take(pick, n, [pick.owned ? "robas mucho: devuelve el cementerio a la biblioteca para no quedarte sin cartas" : "robas mucho: devuelve el cementerio a la biblioteca (no la tienes)"]);
        }
      }
    }
    // Si la carpeta no llega: primero lo que quede de tu carpeta (incoloras incluidas), luego cartas para comprar o usar como
    // proxy que encajan con el plan, y al final tierras básicas. Así el mazo siempre tiene sus 60 (o 100) cartas.
    let short = spellSlots() - chosen.reduce((s, e) => s + e[1], 0);
    let filledOwned = 0, filledBuy = 0;
    if (short > 0) {
      for (const [x] of [...left].map((x) => [x, valueOf(x) + (x.colors.size ? 0 : 0.5)]).sort((a, b) => b[1] - a[1])) {
        if (short <= 0) break;
        const n = Math.min(x.owned, capOf(x), short);
        if (n <= 0) continue;
        left.delete(x);
        if (take(x, n, [x.colors.size ? "para completar el mazo" : "incolora, para completar el mazo"]) === false) continue;
        short -= n; filledOwned += n;
      }
    }
    if (short > 0 && template) {  // primero lo que falta de la lista ganadora (para comprar), antes que cartas al azar
      for (const [n, q, side] of template.cards) {
        if (short <= 0) break;
        const k = norm(n), oi = oByNorm.get(k);
        if (side || oi == null || excluded.has(k) || chosen.some(([y]) => norm(y.name) === k)) continue;
        const x = mk(oi, 0);
        if (x.is_land || !legal(x) || !subset(x.colors, deckColors)) continue;
        x.buy = true;
        const n2 = Math.min(q, short);
        if (take(x, n2, [`de la lista ganadora: ${template.archetype} — no la tienes`]) === false) continue;
        short -= n2; filledBuy += n2;
      }
    }
    if (short > 0) {
      indexAll();
      const have = new Set([...chosen.map(([x]) => x.oi), ...pool.values()].map((x) => (typeof x === "number" ? x : x.oi)));
      let fillers = synergyCandidates(plan, have).slice(0, 300);
      // En optimizado o más, primero lo que se juega en el meta del formato (en vez de cartas con sinergia pero flojas)
      if (metaCode && power >= 4) {
        const metaFirst = [...played.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => oByNorm.get(k)).filter((oi) => oi != null && !have.has(oi)).map((oi) => [oi]);
        fillers = [...metaFirst, ...fillers];
      }
      for (const [oi] of fillers) {
        if (short <= 0) break;
        const x = mk(oi, 0);
        if (x.is_land || excluded.has(norm(x.name)) || !legal(x) || !subset(x.colors, deckColors) || !cheap[oi] || cheap[oi] > (F.perCard || (fmt === "pauper" ? 200 : 500))) continue;
        const n = Math.min(capOf(x), short);
        if (take(x, n, ["para completar (no la tienes: cómprala o usa un proxy)"]) === false) continue;
        short -= n; filledBuy += n;
      }
    }
    if (filledOwned || filledBuy) warnings.push(`Tu carpeta no llegaba para un mazo completo: he añadido ${filledOwned ? `${filledOwned} cartas más de tu carpeta` : ""}${filledOwned && filledBuy ? " y " : ""}${filledBuy ? `${filledBuy} que no tienes (para comprar o usar como proxy)` : ""}.`);
    {
      const minLands = Math.max(size === 100 ? 33 : 16, landsFor() - (power >= 5 ? 1 : 0));
      let extra = chosen.reduce((s, e) => s + e[1], 0) - (size - (commander ? 1 : 0) - minLands);
      while (extra > 0) {
        // Por tandas: primero lo normal; si no basta, lo menos útil de la lista ganadora; y si aún sobra, copias de más de
        // las cartas base (se dejan 2). Antes no se cortaba nada protegido y el mazo se quedaba SIN TIERRAS (reseña 2026-11-25).
        const tiers = [([, , w]) => !w[0]?.startsWith("carta base") && !w[0]?.startsWith("Power 9") && !w[0]?.startsWith("de la lista"),
          ([, , w]) => w[0]?.startsWith("de la lista"), ([, q, w]) => w[0]?.startsWith("carta base") && q > 2];
        let cut = null, floor = 0;
        for (const [i, ok] of tiers.entries()) {
          cut = chosen.filter(ok).map((e) => [e, valueOf(e[0])]).sort((a, b) => a[1] - b[1])[0];
          if (cut) { floor = i === 2 ? 2 : 0; break; }
        }
        if (!cut) break;
        const e = cut[0];
        const n = Math.min(e[1] - floor, extra);
        e[1] -= n; extra -= n;
        curve[Math.min(Math.floor(e[0].cmc), 6)] -= n; for (const r of e[0].roles) roles[r] -= n;
        if (!e[1]) chosen.splice(chosen.indexOf(e), 1);
      }
    }
    const spellsTotal = chosen.reduce((s, e) => s + e[1], 0);
    const landsWanted = size - (commander ? 1 : 0) - spellsTotal;  // lo que falte, tierras

    // 3) Tierras: especiales de la carpeta (duales de los colores, o que encajan con el plan) + básicas.
    const lands = [];
    let room = Math.floor(landsWanted / 2);
    for (const [x, q] of templateLands) {  // primero las tierras especiales de la lista ganadora
      const n = Math.min(q, power === 6 || withBuy ? q : x.owned || 0, landsWanted - lands.reduce((s, e) => s + e[1], 0));
      if (n <= 0) continue;
      if (!x.owned) x.buy = true;
      lands.push([x, n, [x.owned >= n ? "de la lista ganadora" : "de la lista ganadora — no la tienes (o te faltan)"]]);
      pool.delete(norm(x.name));  // que no se repita abajo
    }
    room = Math.max(0, room - lands.reduce((s, e) => s + e[1], 0));
    const gateDeck = chosen.some(([x]) => /\bgates?\b/i.test(x.oracle_text || "") && !/\bgate\b/i.test(x.type_line || ""));
    for (const x of [...pool.values()].filter((x) => x.is_land && !/basic/i.test(x.type_line || "") && legal(x) && (gateDeck || !/\bgate\b/i.test(x.type_line || "")))
      .map((x) => [x, producedColors(x), fit(plan, x, LAND_NOISE)[0]]).sort((a, b) => b[2] - a[2])) {
      const [land, makes, s] = x;
      const useful = [...makes].filter((col) => deckColors.has(col) || (colorlessOnly && col === "C"));
      const inIdentity = subset(land.colors, deckColors);  // nada de tierras (ni cartas dobles) de otros colores
      if (!inIdentity || !useful.length || room <= 0) continue;
      // En Pauper/Estándar: una tierra que no se juega en el meta solo entra si es dual de tus colores (o encaja muchísimo).
      const playedLand = !metaCode || metaScore(land) >= 0.04 || (deckColors.size > 1 && useful.length >= 2) || s >= 6;
      if (!playedLand) continue;
      // Si entra girada en un mazo de un color, mejor una básica.
      if (deckColors.size === 1 && /enters (the battlefield )?tapped/.test(land.text) && metaScore(land) < 0.04) continue;
      if (deckColors.size > 1 ? useful.length >= 2 || s >= 2 : s >= 2.5) {
        const n = Math.min(land.owned, capOf(land), room);
        lands.push([land, n, s > 0 ? ["encaja con el plan"] : [`da maná ${useful.map((m) => COLOR_NAMES[m]).join(" y ")}`]]);
        room -= n;
      }
    }
    // Nieve: si alguna carta lo pide (Skred, Ice-Fang Coatl, Moon-Eating Dog…), las básicas son nevadas
    const snowDeck = chosen.some(([x]) => /\bsnow\b/i.test(x.oracle_text || "") && !/^snow/i.test(x.type_line || ""));
    if (snowDeck) warnings.push("Hay cartas que piden nieve: las tierras básicas son nevadas (Snow-Covered).");
    const pips = {};
    for (const [x, n] of chosen) for (const m of (x.mana_cost || "").matchAll(/\{([WUBRG])(?:\/([WUBRG]))?\}/g)) {
      for (const sym of m[2] ? [m[1], m[2]] : [m[1]]) if (deckColors.has(sym)) pips[sym] = (pips[sym] || 0) + n / (m[2] ? 2 : 1);
    }
    const basicsN = landsWanted - lands.reduce((s, e) => s + e[1], 0);
    const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
    const cols = colorlessOnly ? ["C"] : [..."WUBRG"].filter((x) => deckColors.has(x));
    /* Fuentes de color que hacen falta (Frank Karsten, ~90 % de lanzarla a tiempo; 60 cartas): 1 símbolo en el turno 1: 14,
     * turno 2: 13, turno 3: 12…; 2 símbolos en el turno 2: 21, turno 3: 18…; 3 símbolos en el turno 3: 23. Commander: ×1,4.
     * Cada color pide lo de su carta más exigente; las básicas se reparten según lo que le falte a cada uno. */
    const KARSTEN = { 1: [14, 14, 13, 12, 11, 10, 10], 2: [21, 21, 21, 18, 16, 15, 14], 3: [23, 23, 23, 23, 21, 19, 18] };
    const needSrc = {};
    for (const [x] of chosen) for (const col of cols) {
      const k = ((x.mana_cost || "").match(new RegExp(`\\{${col}(\\/[WUBRG])?\\}`, "g")) || []).length;
      if (!k) continue;
      const turn = Math.max(1, Math.min(6, Math.round(x.cmc)));
      needSrc[col] = Math.max(needSrc[col] || 0, KARSTEN[Math.min(k, 3)][turn] * (size === 100 ? 1.4 : 1));
    }
    const srcFrom = (col) => lands.reduce((n, [l, k]) => n + (producedColors(l).has(col) ? k : 0), 0);
    const deficit = Object.fromEntries(cols.map((col) => [col, Math.max(1, (needSrc[col] || 0) - srcFrom(col))]));
    const totalDef = Object.values(deficit).reduce((a, b) => a + b, 0);
    // mitad según lo que pide Karsten, mitad según los símbolos de todo el mazo (lo que se lanza más a menudo)
    const exact = Object.fromEntries(cols.map((x) => [x, basicsN * (0.5 * deficit[x] / totalDef + 0.5 * (totalPips ? (pips[x] || 0) / totalPips : 1 / cols.length))]));
    const rounded = Object.fromEntries(cols.map((x) => [x, Math.floor(exact[x])]));
    cols.slice().sort((a, b) => (exact[b] - rounded[b]) - (exact[a] - rounded[a])).slice(0, basicsN - Object.values(rounded).reduce((a, b) => a + b, 0)).forEach((x) => rounded[x]++);
    // Fuentes mínimas (≈75 % de Karsten) para los colores con cartas: si caben, se garantizan; si no caben todas (p. ej. Exhume
    // {1}{B} con Counterspell {U}{U} y 16 básicas), se reparten en proporción a lo que pide cada color (reseña: Exhume con 4 Swamps).
    if (cols.length > 1 && basicsN > 0) {
      const minOf = Object.fromEntries(cols.map((c) => [c, Math.max(0, Math.ceil((needSrc[c] || 0) * 0.75) - srcFrom(c))]));
      const sumMin = Object.values(minOf).reduce((x, y) => x + y, 0);
      if (sumMin > basicsN) {
        let left = basicsN;
        cols.forEach((c, k) => { const n = k === cols.length - 1 ? left : Math.round((basicsN * minOf[c]) / sumMin); rounded[c] = Math.max(0, Math.min(left, n)); left -= rounded[c]; });
      } else {
        for (const c of cols) while ((rounded[c] || 0) < minOf[c]) {
          const donor = cols.filter((d) => d !== c && rounded[d] > minOf[d]).sort((x, y) => rounded[y] - minOf[y] - (rounded[x] - minOf[x]))[0];
          if (!donor) break;
          rounded[donor]--; rounded[c] = (rounded[c] || 0) + 1;
        }
      }
    }
    // Las básicas de la lista ganadora se respetan como mínimo (p. ej. el Forest para lanzar el banquillo verde)
    if (template) {
      const BASIC_COLOR = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };
      for (const [n, q, side] of template.cards) {
        const col = BASIC_COLOR[norm(n).replace(/^snow-covered /, "")];
        if (side || !col || !cols.includes(col) || (rounded[col] || 0) >= q) continue;
        const donor = cols.filter((c) => c !== col).sort((a, b) => rounded[b] - rounded[a])[0];
        const k = Math.min(q - (rounded[col] || 0), Math.max(0, (rounded[donor] || 0) - 6));
        if (k > 0) { rounded[col] = (rounded[col] || 0) + k; rounded[donor] -= k; }
      }
    }
    // Color elegido a mano sin ninguna carta de ese color: avisar (mejor que meter tierras que no lanzan nada)
    if (colors) for (const col of cols) if (!chosen.some(([x]) => x.colors.has(col)) && !lands.some(([l]) => producedColors(l).has(col)) && !rounded[col]) {
      warnings.push(`Has elegido ${COLOR_NAMES[col]} pero ninguna carta del mazo lo usa: quítalo de los colores o añade cartas base de ese color.`);
    }

    // 4) Avisos: lo que pide la carta base y no está; funciones sin cubrir.
    if (F.maxPoints) warnings.push(`Puntos de Canadian Highlander: ${pointsUsed} de ${F.maxPoints} (las cartas más potentes cuentan puntos).`);
    if (F.budget) {  // Value Vintage: el mazo entero no puede pasar de 30 $ (aquí, en euros de Cardmarket, aproximado)
      const cents = [...chosen, ...lands].reduce((t, [x, n]) => t + (BASICS.has(norm(x.name)) ? 0 : (cheap[x.oi] || 0) * n), 0);
      warnings.push(cents > F.budget ? `El mazo cuesta unos ${(cents / 100).toFixed(2)} € y en Value Vintage el tope es de 30 $ (unos ${(F.budget / 100).toFixed(0)} €), banquillo incluido: cambia las cartas más caras.`
        : `Presupuesto de Value Vintage: el mazo cuesta unos ${(cents / 100).toFixed(2)} € de ${(F.budget / 100).toFixed(0)} € (30 $), sin contar el banquillo.`);
    }
    for (const [theme, w] of plan.wantsType) {
      if (w < 3 || base.some((x) => x.type_tags.has(theme))) continue;
      const inDeck = chosen.filter(([x, , why]) => !why[0].startsWith("carta base del mazo") && x.type_tags.has(theme)).reduce((s, [, n]) => s + n, 0);
      if (inDeck >= (size === 100 ? 10 : 6)) continue;
      const elsewhere = new Set();
      for (const x of pool.values()) if (x.type_tags.has(theme) && legal(x) && !subset(x.colors, deckColors)) for (const col of x.colors) if (!deckColors.has(col)) elsewhere.add(col);
      const list = [...elsewhere].map((x) => COLOR_NAMES[x]);
      const hint = list.length && !commander ? ` Tienes más cartas de ${theme} en ${list.join(", ")}: añade ${list.length > 1 ? "esos colores" : "ese color"} arriba.` : "";
      warnings.push(`El plan pide ${theme} y ${inDeck ? `solo hay ${inDeck}` : "no hay ninguna"} en la carpeta${fmt === "pauper" ? " (legales en Pauper)" : ""}.${hint}`);
    }
    for (const r of Object.keys(target)) {
      if (target[r] && roles[r] < target[r] / 2) warnings.push(`Pocas cartas que ${ROLE_NAMES[r]} (${roles[r]} de ~${target[r]} recomendadas). Si consigues alguna, el mazo mejorará.`);
    }
    if (spellsTotal < spellSlots()) warnings.push(`Solo hay ${spellsTotal} cartas que encajen (harían falta ${spellSlots()}). Prueba otro color o Casual, o añade cartas a la carpeta.`);

    // Cartas que no tienes y mejorarían el mazo: por sinergia con el plan y por jugarse con las base en torneos.
    // Tercera opinión, el meta: lo que juegan las listas de torneo del formato con tus cartas base (o, si no hay, las de tus colores).
    function metaRecs() {
      if (!metaCode) return [];
      const keys = new Set(base.map((x) => norm(x.name)));
      const decks = META.filter((d) => d.format === metaCode);
      const colorsOf = (d) => new Set(d.cards.filter(([, , side]) => !side).flatMap(([n]) => { const oi = oByNorm.get(norm(n)); return oi != null ? [...(O[oi][4] || "")] : []; }));
      let similar = decks.filter((d) => d.cards.some(([n, , side]) => !side && keys.has(norm(n))));
      let why = "con tus cartas base";
      if (!similar.length) {  // listas cuyo main es (casi todo) de tus colores
        similar = decks.filter((d) => {
          const ois = d.cards.filter(([, , side]) => !side).map(([n]) => oByNorm.get(norm(n))).filter((oi) => oi != null && !O[oi][1].includes("Land"));
          return ois.length && ois.filter((oi) => [...(O[oi][4] || "")].every((col) => deckColors.has(col))).length / ois.length >= 0.8;
        });
        why = "de tus colores";
      }
      if (!similar.length) return [];
      const inDeck = new Set(chosen.map(([x]) => norm(x.name)));
      const count = new Map();
      for (const d of similar) for (const k of new Set(d.cards.filter(([, , side]) => !side).map(([n]) => norm(n)))) count.set(k, (count.get(k) || 0) + 1);
      // carta del mazo que sacarías: la de menos valor que no sea base ni cubra una función justa
      const weakest = (kind) => chosen.filter(([x, , w]) => !w[0]?.startsWith("carta base") && (kind == null || x.is_creature === kind))
        .map(([x]) => [x, valueOf(x)]).sort((a, b) => a[1] - b[1])[0]?.[0]?.name || null;
      return [...count.entries()].filter(([k]) => !inDeck.has(k) && !BASICS.has(k) && !excluded.has(k))
        .map(([k, n]) => [oByNorm.get(k), n]).filter(([oi]) => oi != null)
        .map(([oi, n]) => [oi, n, mk(oi, pool.get(norm(O[oi][0]))?.owned || 0)])
        .filter(([, , x]) => legal(x) && !x.is_land && subset(x.colors, deckColors))
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([oi, n, x]) => ({ name: x.name, image: oImage(oi), eur: cheap[oi] ? eur(cheap[oi]) : null, owned: x.owned,
          pct: Math.round((100 * n) / similar.length), lists: similar.length, why, replaces: weakest(x.is_creature) || weakest(null) }));
    }
    function buyList() {
      indexAll();
      const have = new Set([...pool.values()].map((x) => x.oi));
      base.forEach((x) => have.add(x.oi));
      const capCents = F.perCard || (fmt === "pauper" ? 300 : F.cmd ? 1500 : 1000);
      const ok = (oi) => { const x = ALL[oi]; return !x.is_land && legal(x) && subset(x.colors, deckColors) && (!colorlessOnly || !x.colors.size)
        && !(x.gc && gcCount >= BR.gc) && !(voltron && x.roles.has("wipe") && !x.one_sided)
        && cheap[oi] && cheap[oi] <= capCents && !BASICS.has(norm(O[oi][0])); };
      const scored = new Map();
      for (const [oi, sc, why] of synergyCandidates(plan, have).slice(0, 400)) if (ok(oi)) scored.set(oi, [sc, why.map((t) => (t.startsWith("tribal") ? t : `sinergia: ${t}`))]);
      for (const [k, n] of coPlay) {
        const oi = oByNorm.get(k);
        if (oi == null || have.has(oi) || !ok(oi)) continue;
        const cur = scored.get(oi) || [0, []];
        scored.set(oi, [cur[0] + 2 + n, ["se juega con tus cartas base en torneos", ...cur[1]]]);
      }
      return [...scored.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 10)
        .map(([oi, [, why]]) => ({ name: front(O[oi][0]), image: oImage(oi), eur: eur(cheap[oi]), reasons: why.slice(0, 2) }));
    }
    const out = (x, n, role, why) => ({ name: x.name, qty: n, cmc: x.cmc, type: x.type_line, role, reasons: x.spoiler ? [`spoiler: sale el ${x.spoiler}`, ...(why || [])] : why || [], spoiler: x.spoiler || null,
      image: oImage(x.oi), eur: cheap[x.oi] ? eur(cheap[x.oi]) : null, owned: x.buy ? 0 : x.owned, buy: !!x.buy });
    const cardsOut = chosen.slice().sort((a, b) => a[0].cmc - b[0].cmc || a[0].name.localeCompare(b[0].name))
      .map(([x, n, why]) => out(x, n, x.is_creature ? "criatura" : "hechizo", why));
    const landRows = lands.map(([x, n, why]) => out(x, n, "tierra", why));
    for (const col of cols) {
      if (!rounded[col]) continue;
      const basicName = snowDeck ? `Snow-Covered ${BASIC_FOR[col]}` : BASIC_FOR[col];
      const oi = oByNorm.get(norm(basicName));
      landRows.push({ name: basicName, qty: rounded[col], role: "tierra", reasons: ["tierra básica"], image: oi != null ? oImage(oi) : null,
        eur: null, basic: true, cmc: 0, type: "Basic Land", owned: null });
    }
    const fullCurve = {};
    for (const [x, n] of chosen) { const b = Math.min(Math.floor(x.cmc), 6); fullCurve[b] = (fullCurve[b] || 0) + n; }
    const avg = spellsTotal ? chosen.reduce((s, [x, n]) => s + x.cmc * n, 0) / spellsTotal : 0;
    const all = [...cardsOut, ...landRows];
    const themes = [...plan.wantsText.entries()].filter(([, w]) => w >= 3).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 6);
    return {
      seed: base.map((x) => x.name).join(" + "), seeds: base.map((x) => x.name),
      colors: colorlessOnly ? "C" : cols.join("") + (wantC ? "C" : ""), format: fmt, buy: buyList(), meta_recs: metaRecs(), swaps,
      focus: FO ? focus : "", excluded: [...excluded], p9: withP9,
      combo: withCombo, buy: withBuy, sbbuy: sbBuy, with_spoilers: withSpoilers, offmeta: withOffmeta,
      template: template ? { archetype: template.archetype, player: template.player, event: template.event, result: template.result, date: template.date } : null,
      // Spoilers que encajan con el plan del mazo (estén o no dentro), con el porqué
      spoilers: spoilerPool.map((x) => [x, fit(plan, x)]).filter(([, [sc]]) => sc > 0).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12)
        .map(([x, [, why]]) => ({ name: x.name, image: oImage(x.oi), released: x.spoiler, in_deck: chosen.some(([y]) => y === x), reasons: why.slice(0, 2).map((t) => (t.startsWith("tribal") ? t : `sinergia: ${t}`)) })),
      // Banquillo contra el meta (Pauper, Estándar): lo que más llevan los banquillos de las listas del meta, en tus colores
      sideboard: FORMAT_META[fmt] && size === 60 ? (() => {
        const inMain = new Set(chosen.map(([x]) => norm(x.name)));
        const sc = new Map();
        for (const d of META.filter((d) => d.format === FORMAT_META[fmt])) for (const [n, q, side] of d.cards) {
          if (!side) continue;
          const k = norm(n), r = sc.get(k) || [0, 0, 0, []];
          r[0] += d.share || 1; r[1] += q; r[2]++; if (r[3].length < 3 && !r[3].includes(d.archetype)) r[3].push(d.archetype);
          sc.set(k, r);
        }
        const out = []; let total = 0;
        if (template) for (const [n, q, side] of template.cards) {  // primero el banquillo de la lista ganadora
          const k = norm(n), oi = oByNorm.get(k), owned = pool.get(k)?.owned || 0;
          if (!side || oi == null || total >= 15) continue;
          const qq = Math.min(q, 15 - total, sbBuy || power === 6 ? q : owned);
          if (qq <= 0) continue;
          out.push({ name: front(O[oi][0]), qty: qq, image: oImage(oi), eur: cheap[oi] ? eur(cheap[oi]) : null, owned: Math.min(owned, qq), reasons: [`banquillo de la lista ganadora (${template.archetype})`] });
          total += qq; sc.delete(k);
        }
        /* Contra agresivos: si los mazos rápidos (rojos, burn, madness, affinity…) son buena parte del meta, el banquillo lleva
         * al menos ~4 cartas para ellos (ganar vidas, prevenir daño, barridos). Reseña 2026-11-25: "el banquillo no me servía
         * contra Mono R Madness". Primero las que ya llevan los banquillos del meta; si no, cualquier carta legal y barata. */
        const fastShare = META.filter((d) => d.format === FORMAT_META[fmt] && (/aggro/i.test(d.category || "") || /red|burn|madness|kuldotha|stompy|affinity|boros|gruul/i.test(d.archetype)))
          .reduce((a, d) => a + (d.share || 0), 0);
        const antiAggro = (o) => SB_KINDS.some(([k, rx]) => (k === "vsAggro" || k === "vsWide") && rx.test(o[5] || ""));
        let antiN = out.filter((c) => { const oi = oByNorm.get(norm(c.name)); return oi != null && antiAggro(O[oi]); }).reduce((a, c) => a + c.qty, 0);
        if (fastShare >= 15 && antiN < 4) {
          const ranked = [...[...sc].sort((a, b) => b[1][0] - a[1][0]).map(([k]) => oByNorm.get(k)), ...O.map((_, i) => i).filter((i) => O[i][7]).sort((a, b) => O[a][7] - O[b][7])];
          const seenA = new Set(out.map((c) => norm(c.name)));
          for (const oi of ranked) {
            if (antiN >= 4 || total >= 15) break;
            if (oi == null || seenA.has(norm(O[oi][0])) || !antiAggro(O[oi])) continue;
            const k = norm(O[oi][0]), x = pool.get(k) || mk(oi, 0), owned = pool.get(k)?.owned || 0;
            seenA.add(k);
            if (x.is_land || inMain.has(k) || excluded.has(k) || !legal(x) || !subset(x.colors, deckColors) || (!sbBuy && !owned) || (cheap[oi] || 0) > 300) continue;
            const q = Math.min(sbBuy ? 3 : owned, 4 - antiN, 15 - total);
            if (q <= 0) continue;
            out.push({ name: x.name, qty: q, image: oImage(oi), eur: cheap[oi] ? eur(cheap[oi]) : null, owned: Math.min(owned, q), reasons: [`contra mazos agresivos (${Math.round(fastShare)} % del meta)`] });
            total += q; antiN += q; sc.delete(k);
          }
        }
        for (const [k, [, copies, n, archs]] of [...sc].sort((a, b) => b[1][0] - a[1][0])) {
          if (total >= 15) break;
          const oi = oByNorm.get(k);
          if (oi == null || inMain.has(k) || excluded.has(k)) continue;
          const x = pool.get(k) || mk(oi, 0), owned = pool.get(k)?.owned || 0;
          if (x.is_land || !legal(x) || !subset(x.colors, deckColors) || (!sbBuy && !owned)) continue;
          let q = Math.max(1, Math.min(4, Math.round(copies / n), 15 - total));
          if (!sbBuy) q = Math.min(q, owned);
          out.push({ name: x.name, qty: q, image: oImage(oi), eur: cheap[oi] ? eur(cheap[oi]) : null, owned: Math.min(owned, q), reasons: [`en el banquillo de ${archs.join(", ")}`] });
          total += q;
        }
        return out;
      })() : [],
      // Con "Combo" activado: combos infinitos para elegir (los que ya tienen una carta en el mazo, luego los que tienes enteros…)
      combo_options: withCombo ? (() => {
        const inDeck = new Set(chosen.map(([x]) => norm(x.name)));
        const has = (k) => (pool.get(k)?.owned || 0) > 0;
        const out = [], seen = new Set();
        for (const [a, list] of partners) for (const [b, k] of list) {
          const key = [a, b].sort().join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          const ois = k.cards.map((n) => oByNorm.get(norm(n)));
          if (ois.some((oi) => oi == null) || k.cards.some((n) => excluded.has(norm(n)))) continue;
          if (fmt !== "casual" && ois.some((oi) => !legalIn({ name: front(O[oi][0]), legal: legalOf(O[oi]), oi }))) continue;  // las dos cartas, legales en el formato
          const ci = new Set(ois.flatMap((oi) => [...(O[oi][4] || "")]));
          // Que quepa en los colores del mazo; fuera de Commander se admite un color más (se avisa y, al elegirlo, el mazo lo suma)
          const extra = [...ci].filter((col) => !deckColors.has(col));
          if (extra.length > (commander || size === 100 || colors ? 0 : 1)) continue;  // si eliges los colores, ninguno de fuera
          const deck = k.cards.map((n) => inDeck.has(norm(n))), own = k.cards.map((n) => has(norm(n)) || inDeck.has(norm(n)));
          if (deck[0] && deck[1]) continue;  // ya está en el mazo (sale abajo)
          const score = (deck[0] || deck[1] ? 100 : 0) + own.filter(Boolean).length * 40 + Math.min(20, (k.pop || 0) / 500) - extra.length * 15;  // lo que ya tienes, primero
          if (!own[0] && !own[1] && !deck[0] && !deck[1]) continue;  // al menos una carta tuya
          out.push({ cards: k.cards, makes: k.makes, steps: k.steps, pre: k.pre, needs: k.needs, mana: k.mana, in_deck: deck, owned: own,
            images: ois.map(oImage), eur: ois.map((oi) => eur(cheap[oi])), extra_color: extra[0] || "", score });
        }
        return out.sort((x, y) => y.score - x.score).slice(0, 12);
      })() : [],
      combos: (() => {  // combos infinitos que lleva el mazo final, con sus pasos
        const inDeck = new Set(chosen.map(([x]) => norm(x.name)));
        const seen = new Set(), out = [];
        for (const n of inDeck) for (const [p, k] of partners.get(n) || []) {
          const key = [n, p].sort().join("|");
          if (inDeck.has(p) && !seen.has(key)) { seen.add(key); out.push({ cards: k.cards, makes: k.makes, steps: k.steps, pre: k.pre, needs: k.needs, mana: k.mana }); }
        }
        return out;
      })(),
      focus_options: Object.entries(FOCUS).map(([key, f]) => {
        const ts = Object.keys(f.themes), rs = Object.keys(f.roles || {});
        const count = [...pool.values()].filter((x) => !x.is_land && legal(x) && subset(x.colors, deckColors)
          && (ts.some((t) => x.text_tags.has(t) || x.type_tags.has(t)) || rs.some((r) => x.roles.has(r)) || (key === "control" && x.roles.has("removal")) || (key === "aggro" && x.is_creature && x.cmc <= 2))).length;
        return { key, count, rec: [...deckColors].some((col) => (COLOR_ARCH[col] || []).includes(key)) };
      }).filter((o) => o.count >= (size === 100 ? 8 : 5) || o.key === focus).sort((a, b) => b.rec - a.rec || b.count - a.count),
      commander: commander ? out(commander, 1, "comandante", ["comandante"]) : null,
      style, style_auto: wanted === "auto" || !STYLES[wanted], power, bracket: fmt === "commander" ? bracket : null,
      game_changers: chosen.filter(([x]) => x.gc).map(([x]) => x.name).concat(commander?.gc ? [commander.name] : []),
      guide: deckGuide({ chosen, base, commander, plan, landsN: landRows.reduce((s, r) => s + r.qty, 0), style }),
      themes: [...themes, ...[...plan.tribes].map((t) => `tribu ${t}`)], cards: cardsOut, lands: landRows, warnings,
      stats: { total: all.reduce((s, r) => s + r.qty, 0) + (commander ? 1 : 0), spells: spellsTotal, lands: landRows.reduce((s, r) => s + r.qty, 0),
        creatures: chosen.filter(([x]) => x.is_creature).reduce((s, e) => s + e[1], 0), avg_cmc: Math.round(avg * 100) / 100,
        curve: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((k) => [String(k), fullCurve[k] || 0])), roles,
        value: Math.round((all.reduce((s, r) => s + (r.eur || 0) * r.qty, 0) + (commander ? cheap[commander.oi] / 100 || 0 : 0)) * 100) / 100 },
      bench: [...left].filter((x) => !excluded.has(norm(x.name))).map((x) => [x, fit(plan, x)[0] + coBonus(x), fit(plan, x)[1], coBonus(x)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([x, , why, co]) => ({ name: x.name, reasons: [...why.map((t) => `sinergia: ${t}`), ...(co ? ["se juegan juntas en torneos"] : [])].slice(0, 2), image: oImage(x.oi), eur: cheap[x.oi] ? eur(cheap[x.oi]) : null })),
    };
  }

  // ---------------------------------------------------------------- predicciones y sinergias
  /* Señales, no garantías. Con historial (7-30 días): cartas que bajaron y se han estabilizado
   * ("rebote") y cartas que empiezan a subir. Sin historial: lo que se juega mucho y es barato, y
   * la Lista Reservada (no se reimprime). Sinergias: cartas antiguas que combinan con las de una
   * colección nueva (o con cualquier carta) y que, por eso, pueden subir. */
  let ALL = null, BY_TAG = null, BY_TYPE = null, BY_SUB = null;
  function indexAll() {
    if (ALL) return;
    ALL = O.map((o, oi) => analyse({ name: front(o[0]), type_line: o[1], oracle_text: o[5], mana_cost: o[2] || "", cmc: o[3] || 0,
      colors: new Set(o[4] || ""), legal: legalOf(o), rank: o[7], oi, owned: 0, gc: o[11] === 1 }));
    BY_TAG = new Map(); BY_TYPE = new Map(); BY_SUB = new Map();
    const push = (m, k, oi) => { if (!m.has(k)) m.set(k, []); m.get(k).push(oi); };
    ALL.forEach((x, oi) => {
      x.text_tags.forEach((t) => push(BY_TAG, t, oi));
      x.type_tags.forEach((t) => push(BY_TYPE, t, oi));
      x.subtypes.forEach((t) => push(BY_SUB, t, oi));
    });
  }
  /** Cartas hot de la semana: Cardmarket no publica cuántas copias se venden, así que "hot" = suben esta semana (y no
   *  bajaron ayer) y además se juegan mucho (en mazos del meta de cualquier formato y en EDHREC): las que más demanda tienen. */
  function hotCards({ c }) {
    const w = paired("d7"), y = paired("d1"), owned = ownedByName(binderOf(c) || 1);
    if (!PR.days?.["7"] || PR.days["7"] === PR.day) return { items: [], base: PR.day, latest: PR.day };
    const plays = new Map(), fmts = new Map();
    for (const d of META) for (const [n] of d.cards) { const k = norm(n); plays.set(k, (plays.get(k) || 0) + 1); (fmts.get(k) || fmts.set(k, new Set()).get(k)).add(d.format); }
    const items = [];
    for (let oi = 0; oi < O.length; oi++) {
      const now = w.now[oi], old = w.old[oi];
      if (!now || !old || now < 50 || !believable(old, now) || BASICS.has(norm(O[oi][0]))) continue;
      const pct = ((now - old) * 100) / old;
      if (pct < 8) continue;
      if (y.old[oi] && y.now[oi] && y.now[oi] < y.old[oi] * 0.97) continue;  // ayer ya bajaba: no está caliente
      const k = norm(O[oi][0]), meta = plays.get(k) || 0, rank = O[oi][7] || 0;
      const pop = meta * 0.6 + (rank && rank < 1000 ? 3 : rank && rank < 3000 ? 2 : rank && rank < 10000 ? 1 : 0);
      if (pop < 1) continue;  // que se juegue: si no, una subida no es demanda
      const why = [];
      if (meta) why.push(`en ${meta} mazo${meta > 1 ? "s" : ""} del meta (${[...fmts.get(k)].slice(0, 3).join(", ")})`);
      if (rank && rank < 3000) why.push("muy jugada en Commander");
      items.push({ name: front(O[oi][0]), image: oImage(oi), eur: eur(now), pct: Math.round(pct * 10) / 10, score: pct * (1 + pop), why, owned: owned.get(k) || 0 });
    }
    items.sort((a, b) => b.score - a.score);
    return { items: items.slice(0, 24), base: PR.days["7"], latest: PR.day };
  }
  const metaCount = () => { const m = new Map(); for (const d of META) if (d.format === "PAU") for (const [n] of d.cards) m.set(norm(n), (m.get(norm(n)) || 0) + 1); return m; };
  const card = (oi, extra) => ({ name: front(O[oi][0]), image: oImage(oi), eur: eur(cheapest().price[oi]), ...extra });

  /** Cartas (de todo Magic) que mejor encajan con el plan; las de `skip` no cuentan. */
  function synergyCandidates(plan, skip = new Set()) {
    indexAll();
    // Los temas raros (contadores, veneno…) dicen más que los comunes (criaturas, robar): se pesan por rareza.
    const idf = (m, t) => Math.max(0.2, Math.log(O.length / ((m.get(t) || []).length + 1)) / 4);
    plan = { tribes: plan.tribes,
      wantsText: new Map([...plan.wantsText].map(([t, w]) => [t, w * idf(BY_TAG, t)])),
      wantsType: new Map([...plan.wantsType].map(([t, w]) => [t, w * idf(BY_TYPE, t)])) };
    const ids = new Set();
    for (const t of plan.wantsText.keys()) (BY_TAG.get(t) || []).forEach((oi) => ids.add(oi));
    for (const t of plan.wantsType.keys()) (BY_TYPE.get(t) || []).forEach((oi) => ids.add(oi));
    for (const t of plan.tribes) (BY_SUB.get(t) || []).forEach((oi) => ids.add(oi));
    const out = [];
    for (const oi of ids) {
      if (skip.has(oi) || ALL[oi].is_land || O[oi][1].startsWith("Basic")) continue;
      const [s, why] = fit(plan, ALL[oi]);
      if (s > 0) out.push([oi, s, why]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  }

  function predictions({ c }) {
    indexAll();
    const now = cheapest().price, d7 = cheapest("d7").price, d30 = cheapest("d30").price;
    const has7 = PR.days?.["7"] && PR.days["7"] !== PR.day, has30 = PR.days?.["30"] && PR.days["30"] !== PR.day && PR.days["30"] !== PR.days["7"];
    const played = metaCount();
    const owned = ownedOracles(binderOf(c) || 1);
    const demand = (oi) => (played.get(norm(O[oi][0])) || 0) * 2 + (O[oi][7] && O[oi][7] < 3000 ? 2 : O[oi][7] && O[oi][7] < 10000 ? 1 : 0) + (O[oi][8] ? 2 : 0);
    const rebound = [], rising = [];
    for (let oi = 0; oi < O.length; oi++) {
      const p = now[oi];
      if (!p || p < 50) continue;
      if (has30 && d30[oi] && p <= d30[oi] * 0.75 && (!has7 || !d7[oi] || p >= d7[oi] * 0.97) && demand(oi) >= 2) {
        rebound.push(card(oi, { old: eur(d30[oi]), pct: Math.round(((p - d30[oi]) * 100) / d30[oi]), score: demand(oi),
          reason: `Ha bajado ${Math.round(((d30[oi] - p) * 100) / d30[oi])}% en 30 días y ya no baja; se sigue jugando, así que puede volver a subir.` }));
      }
      if (has7 && d7[oi] && p >= d7[oi] * 1.15 && (!has30 || !d30[oi] || d7[oi] <= d30[oi] * 1.05)) {
        rising.push(card(oi, { old: eur(d7[oi]), pct: Math.round(((p - d7[oi]) * 100) / d7[oi]), score: demand(oi),
          reason: "Estaba plana y ha empezado a subir esta semana: si sigue la tendencia, mejor comprarla ya." }));
      }
    }
    const staples = [...played.entries()].map(([k, n]) => [oByNorm.get(k), n]).filter(([oi, n]) => oi != null && n >= 2 && now[oi] && now[oi] <= 300 && !BASICS.has(norm(O[oi][0])))
      .sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([oi, n]) => card(oi, { owned: owned.has(oi), reason: `Se juega en ${n} mazos del meta de Pauper y aún es barata: si sube la demanda, sube el precio.` }));
    const reserved = O.map((o, oi) => oi).filter((oi) => O[oi][8] && now[oi] && now[oi] <= 3000)
      .sort((a, b) => (O[a][7] || 1e9) - (O[b][7] || 1e9)).slice(0, 25)
      .map((oi) => card(oi, { owned: owned.has(oi), reason: "Lista Reservada: nunca se reimprime y se juega mucho; a la larga suele subir." }));
    const top = (l) => l.sort((a, b) => b.score - a.score || a.pct - b.pct).slice(0, 25);
    return { history: { d7: !!has7, d30: !!has30, since: PR.days?.["30"] || PR.day }, rebound: top(rebound), rising: top(rising), staples, reserved };
  }

  const SYN_TYPES = new Set(["expansion", "core", "draft_innovation", "masters", "commander", "funny"]);
  function newSets() {
    const day = today(), lo = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10), hi = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
    return [...SETS.values()].filter((s) => SYN_TYPES.has(s.type) && s.released && s.released >= lo && s.released <= hi && bySet.has(s.code))
      .sort((a, b) => b.released.localeCompare(a.released)).slice(0, 10)
      .map((s) => ({ code: s.code, name: s.name, released: s.released, icon: s.icon, upcoming: s.released > day }));
  }
  /** Cartas antiguas (y baratas) que combinan con las cartas NUEVAS de una colección. */
  function setSynergy({ code }) {
    const s = SETS.get(code);
    if (!s) throw new Error("No conozco esa colección");
    indexAll();
    // Nueva = ninguna impresión anterior a esta colección (las reimpresiones no cuentan).
    const firstSeen = new Map();
    for (let pi = 0; pi < P.length; pi++) {
      const r = SETS.get(P[pi][2])?.released || "9999";
      const oi = P[pi][1];
      if (!firstSeen.has(oi) || r < firstSeen.get(oi)) firstSeen.set(oi, r);
    }
    const fresh = [...new Set((bySet.get(code) || []).map((pi) => P[pi][1]))].filter((oi) => firstSeen.get(oi) >= s.released && !ALL[oi].is_land);
    const now = cheapest().price;
    const best = new Map();  // carta antigua -> [puntos, carta nueva, temas]
    const freshSet = new Set(fresh);
    for (const oi of fresh.sort((a, b) => (O[a][7] || 1e9) - (O[b][7] || 1e9)).slice(0, 80)) {
      for (const [old, score, why] of synergyCandidates(makePlan([ALL[oi]]), freshSet).slice(0, 60)) {
        if (!now[old] || now[old] < 25 || now[old] > 2000 || score < 3) continue;
        const cur = best.get(old);
        best.set(old, [(cur?.[0] || 0) + score, cur?.[1] || oi, cur?.[2] || why]);
      }
    }
    const rows = [...best.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40)
      .map(([old, [score, by, why]]) => card(old, { score: Math.round(score), with: front(O[by][0]), with_image: oImage(by),
        reason: `Combina con ${front(O[by][0])} (nueva): ${why.slice(0, 2).join(", ")}.` }));
    return { set: { code, name: s.name, released: s.released, icon: s.icon }, fresh: fresh.length, cards: rows };
  }
  /** Cartas que combinan con una carta cualquiera (de todo Magic, marcando las que ya tienes). */
  function cardSynergy({ c, name }) {
    const oi = oByNorm.get(norm(name || ""));
    if (oi == null) throw new Error(`No conozco la carta ${name}`);
    indexAll();
    const owned = ownedOracles(binderOf(c) || 1);
    const rows = synergyCandidates(makePlan([ALL[oi]]), new Set([oi])).slice(0, 40)
      .map(([o, score, why]) => card(o, { owned: owned.has(o), score: Math.round(score), reason: `Sinergia: ${why.slice(0, 3).join(", ")}.` }));
    return { name: front(O[oi][0]), image: oImage(oi), cards: rows };
  }

  function seedHelp({ c, format = "pauper", seeds = "" }) {
    indexAll();
    const pool = new Map();
    for (const [pi] of entries(binderOf(c) || 1)) { const oi = P[pi][1]; pool.set(norm(O[oi][0]), oi); }
    const F = FORMAT_DEFS[format] || FORMAT_DEFS.casual, key = F.peasant ? "vintage" : F.key || format;
    const ok = (x) => !x.is_land && !(!F.cmd && x.cmdr_only) && (!FORMAT_DEFS[format] || format === "casual" || [1, 3].includes(x.legal[key])
      || (F.cmd && (x.can_command || (F.cmd === "pw" && /planeswalker/i.test(x.type_line || "")))));
    const allowed = [...pool.values()].filter((oi) => ok(ALL[oi])).map((oi) => front(O[oi][0]));
    const base = seeds.split("|").map((n) => oByNorm.get(norm(n))).filter((oi) => oi != null).map((oi) => ALL[oi]);
    if (!base.length) return { allowed, suggest: [] };
    const plan = makePlan(base);
    const cmd = F.cmd ? base.find((x) => (F.cmd === "pw" ? /planeswalker/i.test(x.type_line || "") : x.can_command)) : null;
    const cols = new Set(cmd ? cmd.colors : base.flatMap((x) => [...x.colors]));
    const taken = new Set(base.map((x) => norm(x.name)));
    const inCols = (x) => [...x.colors].every((col) => cols.has(col));
    const suggest = [...pool.entries()].filter(([k, oi]) => !taken.has(k) && ok(ALL[oi]) && (!cmd || inCols(ALL[oi])))
      .map(([, oi]) => { const [sc, why] = fit(plan, ALL[oi]); return [oi, sc + (inCols(ALL[oi]) ? 0.5 : 0), why]; })
      .filter(([, sc, why]) => sc > 1 && why.length).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([oi, , why]) => ({ name: front(O[oi][0]), image: oImage(oi), why: why.slice(0, 2).join(", ") }));
    return { allowed, suggest };
  }

  // ---------------------------------------------------------------- rutas
  const GET = { "/api/summary": summary, "/api/search": search, "/api/printings": printings, "/api/collection": collection, "/api/duplicates": duplicates, "/api/monthstats": monthStats, "/api/cardinfo": cardInfo, "/api/valuehistory": valueHistory, "/api/added": added,
    "/api/decks": decks, "/api/deck": deck, "/api/movers": movers, "/api/hot": hotCards, "/api/history": history, "/api/sbplan": sbPlan, "/api/combos": combosFor, "/api/tournaments": tournaments, "/api/watchids": watchIds, "/api/alertprefs": alertPrefs, "/api/events": events, "/api/collections": collectionsList,
    "/api/build": build, "/api/sets": sets, "/api/set": set, "/api/sets/search": setsSearch, "/api/precons": precons,
    "/api/mydecks": myDecks, "/api/predictions": predictions, "/api/newsets": newSets, "/api/setsynergy": setSynergy,
    "/api/cardsynergy": cardSynergy, "/api/seedhelp": seedHelp,"/api/profile": profile, "/api/medals": medals, "/api/exportcsv": exportCsv, "/api/alterestimate": alterEstimateRoute, "/api/watch": watchList, "/api/staples": staples };
  const POST = { "/api/match": match, "/api/collection": collectionAdd, "/api/import": importCards,
    "/api/collections": collectionsPost, "/api/sets": setsPin, "/api/mydecks": myDecksPost, "/api/owncards": ownCards, "/api/proxy": proxyPost, "/api/profile": profilePost, "/api/alter": alterPost, "/api/preconown": preconOwn, "/api/lang": langPost, "/api/watch": watchPost, "/api/alertprefs": alertPrefsPost, "/api/reserve": reservePost };

  async function call(path, body) {
    if (!loaded) throw new Error("Los datos aún no están cargados");
    const url = new URL(path, "http://x");
    const fn = (body ? POST : GET)[url.pathname];
    if (!fn) throw new Error(`Ruta desconocida: ${url.pathname}`);
    const params = body || Object.fromEntries(url.searchParams);
    return JSON.parse(JSON.stringify(await fn(params)));  // copia: la interfaz no puede tocar los datos internos
  }

  /** Copia de seguridad de tus cartas (para pasarla a otro móvil). */
  const exportUser = () => JSON.stringify(user);
  async function importUser(text) {
    const u = JSON.parse(text);
    if (!u.binders || !u.cards) throw new Error("No es una copia de seguridad de Gather in One");
    user = u;
    await saveUser();
  }

  return { load, call, exportUser, importUser, get day() { return loaded ? PR.day : null; }, set onSave(fn) { onSaved = fn; } };
})();
