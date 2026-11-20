"use strict";
/* Motor local de Gathering Market.
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
  let O = [], P = [], PR = null, SETS = new Map(), META = [], PACK_EVENTS = [];
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
    if (version) await kvSet("version", version);
    VERSION = version || saved;

    const cards = JSON.parse(cardsText);
    O = cards.o;
    P = cards.p;
    PR = JSON.parse(pricesText);
    SETS = new Map(JSON.parse(setsText || "[]").map(([code, name, type, released, icon]) => [code, { code, name, type, released, icon }]));
    META = JSON.parse(metaText || "[]");
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
  function summary({ c }) {
    const id = binderOf(c);
    if (!id) return { day: PR.day, collection: null, collection_id: null };
    let value = 0, prev = 0, cards = 0, unique = 0;
    const hasPrev = PR.days && PR.days["1"] && PR.days["1"] !== PR.day;
    for (const [pi, foil, qty] of entries(id)) {
      value += qty * (priceOf(pi, foil) || 0);
      prev += qty * ((foil ? PR.eur_foil[pi] : PR.d1[pi] ?? PR.eur[pi]) || 0);
      cards += qty;
      unique++;
    }
    return { day: PR.day, value: eur(value), prev_value: hasPrev ? eur(prev) : null, cards, unique,
      collection: user.binders.find((b) => b.id === id).name, collection_id: id };
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
        rarity: r.rarity, image: r.image, qty, foil, eur: eur(priceOf(pi, foil)), pauper: r.pauper, type: o[1],
        decks: used.get(norm(o[0])) || [], alter: alterOf(id, `${r.id}|${foil ? 1 : 0}`, eur(priceOf(pi, foil)), qty) };
    });
    rows.sort((a, b) => (b.eur || 0) - (a.eur || 0) || a.name.localeCompare(b.name));
    return rows;
  }

  /** ¿Están todas las cartas de la edición `code` en la carpeta? (colecciones de 10 o más cartas) */
  function setComplete(id, code) {
    const total = setTotals(code);
    if (total < 10) return false;
    const have = new Set();
    for (const [pi] of entries(id)) if (P[pi][2] === code && !P[pi][5]) have.add(P[pi][1]);
    return have.size >= total;
  }
  /** Ejecuta `fn` y devuelve los nombres de las ediciones (de `pis`) que ha completado. */
  function completing(id, pis, fn) {
    const codes = [...new Set(pis.map((pi) => P[pi][2]))].filter((code) => !setComplete(id, code));
    fn();
    return codes.filter((code) => setComplete(id, code)).map((code) => SETS.get(code)?.name || code.toUpperCase());
  }
  // ---------------------------------------------------------------- cartas alteradas (firma del artista, arte propio)
  /* Estimación orientativa del mercado de segunda mano: una firma suele sumar entre un 25 y un 75 % (mínimo unos 3-10 €);
   * un "alter" pintado a mano añade sobre todo el trabajo del artista (unos 20-100 €) más una parte del valor de la carta. */
  const ALTER_NAMES = { firma: "Firmada", arte: "Arte propio", ambas: "Firmada y con arte propio" };
  function alterEstimate(base, kind) {
    const b = base || 0;
    const firma = [b + Math.max(3, b * 0.25), b + Math.max(10, b * 0.75)];
    const arte = [b * 1.1 + 20, b * 1.3 + 100];
    const r = kind === "firma" ? firma : kind === "arte" ? arte : [arte[0] + firma[0] - b, arte[1] + firma[1] - b];
    return r.map((x) => Math.round(x));
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
    else map[key] = { kind: body.kind, qty: Math.max(1, +body.qty || 1), note: String(body.note || "").slice(0, 80) };
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
    return { name: p.name || "", salt: p.salt || null, hash: p.hash || null, since: p.since || null };
  }
  function profilePost(body) {
    const p = (user.profile ||= { since: new Date().toISOString().slice(0, 10) });
    if (body.name != null) p.name = String(body.name).trim().slice(0, 40);
    if (body.hash) { p.salt = body.salt; p.hash = body.hash; }
    if (body.clearPassword) { delete p.salt; delete p.hash; }
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
  function exportCsv() {
    const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
    const rows = [["Binder Name", "Name", "Set code", "Set name", "Collector number", "Foil", "Quantity", "Scryfall ID", "Price EUR", "Altered"]];
    for (const b of user.binders) {
      for (const [pi, foil, qty] of entries(b.id)) {
        const [cid, oi, set, number] = P[pi];
        const a = alterOf(b.id, `${cid}|${foil ? 1 : 0}`, eur(priceOf(pi, foil)), qty);
        rows.push([b.name, front(O[oi][0]), set, SETS.get(set)?.name || "", number, foil ? "foil" : "normal", qty, cid, eur(priceOf(pi, foil)) ?? "",
          a ? `${a.name} x${a.qty}${a.note ? ` (${a.note})` : ""}` : ""]);
      }
    }
    return { csv: rows.map((r) => r.map(q).join(",")).join("\n"), rows: rows.length - 1 };
  }

  // ---------------------------------------------------------------- importar CSV / listas
  const COLUMNS = {
    scryfall: ["scryfall id", "scryfall_id", "scryfallid", "scryfall uuid"],
    name: ["name", "card name", "card", "nombre", "card_name"],
    set_name: ["set name", "edition name", "expansion name", "set_name"],
    set: ["set code", "edition code", "setcode", "set_code", "set", "edition", "expansion", "edición"],
    number: ["collector number", "card number", "collector_number", "number", "cn", "collector #"],
    qty: ["quantity", "count", "qty", "amount", "cantidad", "copies"],
    foil: ["foil", "printing", "finish", "foil/variant"],
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
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    if (/[,;\t]/.test(first) && /name|card|nombre/i.test(first)) {
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
        const qty = get("qty");
        return { name: get("name"), set: get("set"), set_name: get("set_name"), number: get("number"), scryfall: get("scryfall"),
          qty: /^\d+$/.test(qty) ? +qty : 1, foil: isFoil(get("foil")), raw: r.join(",").slice(0, 120) };
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
      if (hit) return P[hit[0]][0];
    }
    const oi = row.name ? oByNorm.get(norm(row.name)) : null;
    if (oi == null) return null;
    const setName = (row.set_name || (row.set.length > 6 ? row.set : "")).toLowerCase();
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
      if (cid) { const k = `${cid}|${row.foil ? 1 : 0}`; found.set(k, (found.get(k) || 0) + Math.max(row.qty, 0)); }
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
        const core = tokens.filter((t) => t.length > 2 || ["of", "the", "to", "a"].includes(t));
        for (const cand of new Set([tokens.join(" "), core.join(" ")])) {
          if (cand.length < 4) continue;
          for (const k of closeMatches(cand, nameKeys, 3, 0.75)) bump(k, ratio(cand, k) - y * 0.5);
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
  function deck({ c, id }) {
    const mine = String(id).startsWith("u");
    let d = mine ? (user.decks || []).find((x) => x.id === id) : META.find((x) => x.id === +id);
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
      return { name, qty, side: !!side, have, basic, eur: basic || oi == null ? null : eur(cheap[oi]), image: oi != null ? oImage(oi) : null };
    });
    return { id: d.id, archetype: d.archetype, player: d.player, event: d.event, result: d.result, date: d.date, mine, cards, ...deckInfo(d, owned) };
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
        if (o && n) items.push({ name: O[P[pi][1]][0], set: P[pi][2], image: img(P[pi][0]), old: eur(o), new: eur(n) });
      }
    } else {
      const now = cheapest().price, old = cheapest(col).price;
      for (let oi = 0; oi < O.length; oi++) {
        if (scope === "pauper" && O[oi][6] !== 1) continue;
        if (now[oi] && old[oi]) items.push({ name: front(O[oi][0]), set: null, image: null, old: eur(old[oi]), new: eur(now[oi]) });
      }
    }
    items = items.filter((i) => Math.max(i.old, i.new) >= +min && i.old > 0);
    items.forEach((i) => { i.pct = Math.round(((i.new - i.old) * 1000) / i.old) / 10; });
    items.sort((a, b) => a.pct - b.pct);
    return { base, latest: PR.day, up: items.filter((i) => i.pct > 0).reverse().slice(0, 25), down: items.filter((i) => i.pct < 0).slice(0, 25) };
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
  const ownedOracles = (id) => { const s = new Set(); for (const [pi] of entries(id)) s.add(P[pi][1]); return s; };
  async function setInfo(code, owned) {
    const sp = await special(code);
    if (sp) {
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
    for (const [pi] of entries(id)) {
      const set = P[pi][2];
      if (!owned.has(set)) owned.set(set, new Set());
      owned.get(set).add(P[pi][1]);
    }
    const pinned = new Set(user.pinned[id] || []);
    const anyOwned = ownedOracles(id);
    const out = [];
    for (const code of new Set([...owned.keys(), ...pinned])) {
      const s = await setInfo(code, anyOwned);
      const have = s.special ? s.have : Math.min(owned.get(code)?.size || 0, s.total || Infinity);
      out.push({ ...s, owned: have, pinned: pinned.has(code), pct: s.total ? Math.round((100 * have) / s.total) : 0 });
    }
    return out.filter((s) => s.total || s.pinned)  // fuera "colecciones" sin cartas normales (p. ej. The List)
      .sort((a, b) => (b.pinned - a.pinned) || b.pct - a.pct || a.name.localeCompare(b.name));
  }
  /** Mazos preconstruidos: búsqueda por nombre, tipo o edición; los empezados primero. */
  async function precons({ c, q }) {
    const all = await extra("precons.json");
    const owned = ownedOracles(binderOf(c) || 1);
    const text = (q || "").trim().toLowerCase();
    const rows = all.filter((d) => !text || `${d[1]} ${d[2]} ${d[4]} ${SETS.get(d[4])?.name || ""}`.toLowerCase().includes(text))
      .map((d) => {
        const ois = new Set(d[5].map(([pi]) => P[pi][1]));
        const have = [...ois].filter((oi) => owned.has(oi)).length;
        return { code: `deck:${d[0]}`, name: d[1], type: d[2], released: d[3], icon: SETS.get(d[4])?.icon || null,
          total: ois.size, owned: have, pct: Math.round((100 * have) / ois.size) };
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
    for (const [pi, , qty] of entries(id)) {
      qtyById.set(pi, (qtyById.get(pi) || 0) + qty);
      if (sp || P[pi][2] === code) qtyByName.set(P[pi][1], (qtyByName.get(P[pi][1]) || 0) + qty);
    }
    const num = (n) => { const d = String(n).replace(/\D/g, ""); return d ? +d : 1e6; };
    const cards = new Map();
    const pis = sp ? sp.pis.slice().sort((a, b) => front(O[P[a][1]][0]).localeCompare(front(O[P[b][1]][0])))
      : (bySet.get(code) || []).slice().sort((a, b) => num(P[a][3]) - num(P[b][3]));
    for (const pi of pis) {
      if (sp) {  // especial: una entrada por carta, con la edición de la lista
        const [cid, oi, set, number, r] = P[pi];
        if (!cards.has(oi)) cards.set(oi, { id: cid, name: front(O[oi][0]), number: `${set.toUpperCase()} ${number}`, rarity: RARITY[r], image: img(cid),
          eur: eur(cheapest().price[oi]), qty: qtyByName.get(oi) || 0, variant: false, basic: O[oi][1].startsWith("Basic"), order: cards.size });
        continue;
      }
      const [cid, oi, , number, r, variant] = P[pi];
      if (!showAll && variant) continue;
      const key = showAll ? pi : oi;
      const price = PR.eur[pi];
      const cur = cards.get(key);
      if (!cur || (!showAll && price != null && (cur.eur == null || price / 100 < cur.eur))) {
        cards.set(key, { id: cid, name: front(O[oi][0]), number, rarity: RARITY[r], image: img(cid), eur: eur(price),
          qty: showAll ? qtyById.get(pi) || 0 : qtyByName.get(oi) || 0, variant: !!variant, basic: O[oi][1].startsWith("Basic"),
          order: cur ? cur.order : num(number) });
      }
    }
    const list = [...cards.values()].sort((a, b) => a.order - b.order);
    list.forEach((x) => delete x.order);
    const rarity = {};
    for (const x of list) { const r = (rarity[x.rarity] ||= { owned: 0, total: 0 }); r.total++; if (x.qty) r.owned++; }
    return { ...s, cards: list, owned: list.filter((x) => x.qty).length, total: list.length,
      pinned: (user.pinned[id] || []).includes(code), all: showAll,
      missing_cost: Math.round(list.filter((x) => !x.qty && !x.basic).reduce((t, x) => t + (x.eur || 0), 0) * 100) / 100,
      value_owned: Math.round(list.filter((x) => x.qty).reduce((t, x) => t + (x.eur || 0), 0) * 100) / 100, rarity };
  }
  async function setsSearch({ q }) {
    const text = (q || "").trim().toLowerCase();
    if (text.length < 2) return [];
    const hits = [...SETS.values()].filter((s) => s.name.toLowerCase().includes(text) || s.code === text);
    return Promise.all(hits.sort((a, b) => (b.released || "").localeCompare(a.released || "")).slice(0, 15).map((s) => setInfo(s.code)));
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
  function myDecks({ c }) {
    const owned = ownedByName(binderOf(c) || 1);
    return (user.decks || []).map((d) => ({ id: d.id, archetype: d.name, category: d.format || "Mi mazo", share: null,
      thumbs: thumbsOf(d), mine: true, ...deckInfo(d, owned) }));
  }
  function myDecksPost(body) {
    user.decks ||= [];
    user.nextDeck ||= 1;
    if (body.import || body.save) {
      const src = body.import || body.save;
      const { cards, unknown } = body.import ? parseDeck(src.text) : { cards: src.cards, unknown: [] };
      if (!cards.length) throw new Error("No he reconocido ninguna carta en la lista");
      const id = `u${user.nextDeck++}`;
      user.decks.unshift({ id, name: (src.name || "Mi mazo").slice(0, 60), format: src.format || "", cards });
      saveUser();
      return { id, cards: cards.length, unknown };
    }
    if (body.delete) {
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
    ["artefactos", /\bartifacts?\b|\btreasures?\b|\bfood\b|\bclues?\b/, (t) => t.includes("artifact")],
    // Incoloro: cartas que premian lo incoloro (Forsaken Monument, Eldrazi…) y cartas que lo son (artefactos, Eldrazi, devoid).
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
    sacrificio: ["fichas", "efectos al entrar", "morir"], fichas: ["sacrificio", "criaturas"], morir: ["sacrificio", "fichas"], cementerio: ["molino", "descarte"],
    molino: ["cementerio"], descarte: ["cementerio", "robar cartas"], contadores: ["contadores +1/+1", "planeswalkers"],
    "contadores +1/+1": ["contadores"], parpadeo: ["efectos al entrar"], "efectos al entrar": ["parpadeo", "devolver a la mano"],
    "devolver a la mano": ["efectos al entrar"], hechizos: ["robar cartas"], equipos: ["criaturas"], auras: ["criaturas"],
    ninjutsu: ["evasión", "vuelo", "efectos al entrar", "devolver a la mano"], evasión: ["atacar"], ciclo: ["cementerio", "descarte"],
    incoloro: ["artefactos"], vehículos: ["criaturas"],
  };
  // Temas concretos que pesan más que los genéricos (lo que de verdad pide la carta).
  const THEME_W = { "criaturas incoloras": 2, ninjutsu: 1.5, veneno: 1.5, vehículos: 1.3 };
  const LAND_NOISE = new Set(["efectos al entrar", "sacrificio", "artefactos", "tierras", "ganar vida"]);
  const NEEDS_CREATURES = new Set(["equipos", "auras", "vehículos", "ninjutsu", "evasión", "atacar", "contadores +1/+1"]);
  const THEME_PRED = Object.fromEntries(THEMES.filter((t) => t[2]).map((t) => [t[0], t[2]]));
  const ROLES = {
    ramp: /\badd (\{|one mana|two mana|three mana|x mana|mana|an amount of)|search your library for (a|up to \w+) (basic )?(land|forest|plains|island|swamp|mountain)|put (a|up to \w+) land cards? .{0,30}onto the battlefield/,
    draw: /\bdraws? (two|three|four|x|a) cards?\b|\binvestigate\b|\bscry \d|\bsurveil \d/,
    removal: /destroy target (creature|artifact|enchantment|permanent|nonland)|exile target (creature|permanent|nonland|artifact|enchantment)|deals? \d+ damage to (any target|target creature)|target creature gets -\d+\/-\d+|counter target spell|fights? (another )?target creature/,
    wipe: /destroy all (creatures|nonland)|exile all (creatures|nonland)|deals? \d+ damage to each creature|all creatures get -\d+\/-\d+/,
  };
  const ROLE_NAMES = { ramp: "acelera el maná", draw: "roba cartas", removal: "quita amenazas del rival", wipe: "barre la mesa" };
  // Cuántas cartas de cada función quiere un mazo (60 cartas / Commander 100).
  const TARGETS = { 60: { removal: 6, draw: 3, ramp: 0, wipe: 0 }, 100: { removal: 8, draw: 10, ramp: 10, wipe: 2 } };
  const COLOR_NAMES = { W: "blanco", U: "azul", B: "negro", R: "rojo", G: "verde", C: "incoloro" };
  const BASIC_FOR = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest", C: "Wastes" };
  const FORMATS = { pauper: 6, standard: 10, commander: 9 };  // índice en la fila de la carta (legalidad)
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function analyse(c) {
    const text = (c.oracle_text || "").toLowerCase().split(c.name.toLowerCase()).join("this card")
      .replace(/\bthis (creature|enchantment|artifact|land|equipment|vehicle|aura|planeswalker|saga|spell|token|permanent|battle|siege|case|class|room|card)\b/g, "this card");
    const type = (c.type_line || "").toLowerCase();
    // Incolora: sin símbolos de color en el coste (híbridos y pirexianos cuentan como color) o con devoid.
    c.colorless = !type.includes("land") && (!/\{[^}]*[WUBRG][^}]*\}/.test(c.mana_cost || "") && !(c.colors && c.colors.size && !c.mana_cost) || /\bdevoid\b/.test(text));
    c.text_tags = new Set(THEMES.filter(([, rx]) => rx.test(text)).map(([n]) => n));
    c.type_tags = new Set(THEMES.filter(([, , pred]) => pred && pred(type, c)).map(([n]) => n));
    c.subtypes = new Set((c.type_line || "").includes("—") ? c.type_line.split("—")[1].replace(/\/\//g, " ").split(/\s+/).filter(Boolean) : []);
    c.roles = new Set(Object.keys(ROLES).filter((r) => ROLES[r].test(text)));
    if (type.split(" // ")[0].includes("land")) c.roles.delete("ramp");
    const front = type.split(" // ")[0];
    c.is_land = front.includes("land");
    c.is_creature = front.includes("creature");
    c.can_command = (type.includes("legendary") && type.includes("creature")) || text.includes("can be your commander");
    c.cmdr_only = /\bcommander/.test(text.replace("can be your commander", ""));  // "your commander's color identity"…
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
    for (const t of c.type_tags) bump(plan.wantsText, t, w * 0.5);  // lo que es la carta: le gustan quienes lo aprovechan
    for (const t of c.text_tags) if (NEEDS_CREATURES.has(t)) bump(plan.wantsType, "criaturas", w * 0.5);
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
      target: { 60: { removal: 4, draw: 1, ramp: 0, wipe: 0 }, 100: { removal: 7, draw: 9, ramp: 9, wipe: 0 } } },
    midrange: { caps: { 0: 4, 1: 10, 2: 14, 3: 12, 4: 9, 5: 6, 6: 4 }, land: 0, creature: 0.4, heavyAt: 6, heavy: 1.5, target: TARGETS },
    control: { caps: { 0: 4, 1: 8, 2: 12, 3: 12, 4: 9, 5: 6, 6: 4 }, land: 1, creature: -0.8, heavyAt: 7, heavy: 0.5,
      target: { 60: { removal: 9, draw: 5, ramp: 0, wipe: 1 }, 100: { removal: 10, draw: 12, ramp: 10, wipe: 4 } } },
  };
  /** Estilo que piden las cartas base (si el usuario elige "auto"). */
  function autoStyle(base, plan) {
    const avg = base.reduce((s, x) => s + x.cmc, 0) / base.length;
    const spells = base.filter((x) => !x.is_creature).length / base.length;
    const fast = ["atacar", "fichas", "daño directo", "veneno", "equipos", "auras"].some((t) => (plan.wantsText.get(t) || 0) >= 3);
    if (avg <= 2.5 && !base.some((x) => x.cmc >= 5) && (fast || base.every((x) => x.is_creature))) return "aggro";
    if (spells >= 0.6 && base.some((x) => x.roles.has("removal") || x.roles.has("draw") || x.text_tags.has("hechizos") || x.text_tags.has("planeswalkers"))) return "control";
    return "midrange";
  }

  function build({ c, seed, seeds, colors, format = "pauper", style: wanted = "auto" }) {
    const id = binderOf(c) || 1;
    let fmt = format;
    const cheap = cheapest().price;
    const warnings = [];
    const mk = (oi, owned) => {
      const [name, type_line, cost, cmc, ci, oracle_text, pauper, rank, , commander, standard] = O[oi];
      return analyse({ name: front(name), owned, type_line, oracle_text, mana_cost: cost || "", cmc: cmc || 0,
        colors: new Set(ci || ""), legal: { pauper, commander, standard }, rank, oi });
    };
    const pool = new Map();
    for (const [pi, , qty] of entries(id)) {
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

    // Formato y comandante.
    const commander = fmt === "commander" ? base.find((x) => x.can_command) : null;
    if (fmt === "commander" && !commander) {
      warnings.push(`Para Commander la carta base tiene que ser una criatura legendaria. He montado un mazo de 100 cartas con ${base[0].name} igualmente.`);
    }
    if (FORMATS[fmt] != null) {
      const bad = base.filter((x) => x.legal[fmt === "pauper" ? "pauper" : fmt] !== 1);
      if (bad.length && fmt !== "commander") {
        warnings.push(`${bad.map((x) => x.name).join(", ")} no ${bad.length > 1 ? "son legales" : "es legal"} en ${fmt === "pauper" ? "Pauper" : "Estándar"}; he montado el mazo en Casual.`);
        fmt = "casual";
      }
    }
    const size = fmt === "commander" ? 100 : 60;
    const maxCopies = size === 100 ? 1 : 4;
    const legal = (x) => !(size === 60 && x.cmdr_only) && (fmt === "casual" || x.legal[fmt] === 1);

    // "C" = incoloro: solo C → mazo incoloro; C con colores → esos colores premiando las cartas incoloras.
    const wantC = /c/i.test(colors || "");
    let deckColors = colors ? new Set(colors.toUpperCase().replace(/[^WUBRG]/g, "")) : new Set(commander ? commander.colors : base.flatMap((x) => [...x.colors]));
    if (commander) deckColors = new Set([...(colors ? deckColors : commander.colors)].filter((x) => commander.colors.has(x)));
    const plan = makePlan(base);
    if (wantC) plan.wantsType.set("incoloro", (plan.wantsType.get("incoloro") || 0) + 3);
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
    const style = STYLES[wanted] ? wanted : autoStyle(base, plan);
    const st = STYLES[style];

    const baseKeys = new Set(base.map((x) => norm(x.name)));
    const candidates = [...pool.entries()].filter(([k, x]) => !x.is_land && !baseKeys.has(k) && legal(x) && subset(x.colors, deckColors)).map(([, x]) => x);

    // 1) Cartas base.
    const chosen = [];   // [carta, copias, motivos]
    const curve = {};
    const roles = { ramp: 0, draw: 0, removal: 0, wipe: 0 };
    const take = (x, n, why, score = 99) => {
      chosen.push([x, n, why, score]);
      const b = Math.min(Math.floor(x.cmc), 6);
      curve[b] = (curve[b] || 0) + n;
      for (const r of x.roles) roles[r] += n;
      // Lo elegido refuerza el plan (coherencia), pero solo los temas que ya tenía: así no se desvía de la carta base.
      if (x === commander) addToPlan(plan, x, 3);
      else addToPlan(plan, x, 0.35, (m, k, v) => { if (m.has(k)) m.set(k, m.get(k) + v); });
    };
    for (const x of base) {
      if (x === commander || !legal(x) || !subset(x.colors, deckColors) || x.is_land) continue;
      take(x, x.owned ? Math.min(x.owned, maxCopies) : maxCopies,
        [x.owned ? "carta base del mazo" : "carta base del mazo (no la tienes)"]);
    }
    if (commander) addToPlan(plan, commander, 0);

    // 2) Tierras según la curva (se recalcula al final) y relleno greedy por encaje + funciones.
    const spellSlots = () => size - (commander ? 1 : 0) - landsFor();
    const landsFor = () => {
      const n = chosen.reduce((s, e) => s + e[1], 0);
      const avg = n ? chosen.reduce((s, [x, k]) => s + x.cmc * k, 0) / n : 2.5;
      // Como en los mazos reales: agresivo de curva 2 ≈ 17-18 tierras; control ≈ 23-24. Commander 33-38.
      return size === 100 ? Math.max(33, Math.min(38, Math.round(31 + 2 * avg + st.land))) : Math.max(16, Math.min(24, Math.round(13.5 + 2.4 * avg + st.land)));
    };
    // Cartas que aparecen junto a las base en listas de torneo (sinergia probada, no "lo que más se juega").
    const coPlay = new Map();
    {
      const baseNames = new Set(base.map((x) => norm(x.name)));
      const decksWith = META.filter((d) => d.cards.some(([n, , side]) => !side && baseNames.has(norm(n))));
      for (const d of decksWith) for (const k of new Set(d.cards.filter(([, , side]) => !side).map(([n]) => norm(n)))) if (!baseNames.has(k) && !BASICS.has(k)) coPlay.set(k, (coPlay.get(k) || 0) + 1);
      for (const [k, n] of coPlay) if (n / decksWith.length < 0.34) coPlay.delete(k);  // solo lo habitual en esas listas
    }
    const coBonus = (x) => Math.min(4, 1.5 * (coPlay.get(norm(x.name)) || 0));
    let minCreatures = size === 100 ? 22 : { aggro: 16, midrange: 13, control: 8 }[style] || 12;
    if ((plan.wantsText.get("hechizos") || 0) >= 3 && !(plan.wantsType.get("criaturas") > 0)) minCreatures = Math.round(minCreatures / 2);
    const colorlessFocus = colorlessOnly || wantC || (plan.wantsType.get("incoloro") || 0) > 0;
    const creaturesIn = () => chosen.reduce((n, [x, k]) => n + (x.is_creature ? k : 0), 0);
    const capScale = size / 60;
    const CURVE_CAP = st.caps;
    const target = st.target[size];
    const left = new Set(candidates);
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
        const [s, why] = fit(plan, x);
        let need = 0;
        const roleWhy = [];
        for (const r of x.roles) if (roles[r] < target[r]) { need += 4 * (1 - roles[r] / target[r]) + 1; roleWhy.push(ROLE_NAMES[r]); }
        const co = coBonus(x);
        const cr = creaturesIn();
        if (x.is_creature && cr < minCreatures) { need += 3 * (1 - cr / minCreatures) + 1; if (!roleWhy.length && cr < minCreatures / 2) roleWhy.push("faltan criaturas"); }
        const onColor = !colorlessFocus && x.colors.size ? 0.8 : 0;  // en un mazo de color, mejor cartas de ese color que relleno incoloro
        const score = s + need + co + onColor + (x.rank ? Math.max(0, 1 - x.rank / 20000) * 0.5 : 0) + (x.is_creature ? st.creature : 0)
          - (x.cmc >= st.heavyAt ? st.heavy : 0);
        if (score > bestScore) { bestScore = score; best = x; bestWhy = [...why.map((t) => (t.startsWith("tribal") ? t : `sinergia: ${t}`)), ...(co ? ["se juegan juntas en torneos"] : []), ...roleWhy]; }
      }
      if (!best || (bestScore <= 0.5 && used >= spellSlots() * 0.6)) break;  // sin nada que encaje: mejor menos cartas que relleno
      left.delete(best);
      const room = Math.ceil(CURVE_CAP[Math.min(Math.floor(best.cmc), 6)] * capScale - (curve[Math.min(Math.floor(best.cmc), 6)] || 0));
      const fillsRole = [...best.roles].some((r) => roles[r] < target[r]);
      const reservable = [...left].some((x) => x !== best && fits(x) && [...x.roles].some((r) => roles[r] < target[r]));
      const free = spellSlots() - used - (fillsRole || !reservable ? 0 : deficit);  // no comerse los huecos reservados
      take(best, Math.max(1, Math.min(best.owned, maxCopies, free, room)), bestWhy.length ? bestWhy : ["buena carta del color"], fit(plan, best)[0]);
    }
    const spellsTotal = chosen.reduce((s, e) => s + e[1], 0);
    const landsWanted = Math.min(landsFor(), size - (commander ? 1 : 0) - spellsTotal);

    // 3) Tierras: especiales de la carpeta (duales de los colores, o que encajan con el plan) + básicas.
    const lands = [];
    let room = Math.floor(landsWanted / 2);
    for (const x of [...pool.values()].filter((x) => x.is_land && !/basic/i.test(x.type_line || "") && legal(x))
      .map((x) => [x, producedColors(x), fit(plan, x, LAND_NOISE)[0]]).sort((a, b) => b[2] - a[2])) {
      const [land, makes, s] = x;
      const useful = [...makes].filter((col) => deckColors.has(col) || (colorlessOnly && col === "C"));
      const inIdentity = subset(land.colors, deckColors);  // nada de tierras (ni cartas dobles) de otros colores
      if (!inIdentity || !useful.length || room <= 0) continue;
      if (deckColors.size > 1 ? useful.length >= 2 || s >= 2 : s >= 2.5) {
        const n = Math.min(land.owned, maxCopies, room);
        lands.push([land, n, s > 0 ? ["encaja con el plan"] : [`da maná ${useful.map((m) => COLOR_NAMES[m]).join(" y ")}`]]);
        room -= n;
      }
    }
    const pips = {};
    for (const [x, n] of chosen) for (const m of (x.mana_cost || "").matchAll(/\{([WUBRG])(?:\/([WUBRG]))?\}/g)) {
      for (const sym of m[2] ? [m[1], m[2]] : [m[1]]) if (deckColors.has(sym)) pips[sym] = (pips[sym] || 0) + n / (m[2] ? 2 : 1);
    }
    const basicsN = landsWanted - lands.reduce((s, e) => s + e[1], 0);
    const totalPips = Object.values(pips).reduce((a, b) => a + b, 0);
    const cols = colorlessOnly ? ["C"] : [..."WUBRG"].filter((x) => deckColors.has(x));
    const exact = Object.fromEntries(cols.map((x) => [x, totalPips ? ((pips[x] || 0) / totalPips) * basicsN : basicsN / cols.length]));
    const rounded = Object.fromEntries(cols.map((x) => [x, Math.floor(exact[x])]));
    cols.slice().sort((a, b) => (exact[b] - rounded[b]) - (exact[a] - rounded[a])).slice(0, basicsN - Object.values(rounded).reduce((a, b) => a + b, 0)).forEach((x) => rounded[x]++);

    // 4) Avisos: lo que pide la carta base y no está; funciones sin cubrir.
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
    function buyList() {
      indexAll();
      const have = new Set([...pool.values()].map((x) => x.oi));
      base.forEach((x) => have.add(x.oi));
      const capCents = fmt === "pauper" ? 300 : fmt === "commander" ? 1500 : 1000;
      const ok = (oi) => { const x = ALL[oi]; return !x.is_land && legal(x) && subset(x.colors, deckColors) && (!colorlessOnly || !x.colors.size)
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
    const out = (x, n, role, why) => ({ name: x.name, qty: n, cmc: x.cmc, type: x.type_line, role, reasons: why || [],
      image: oImage(x.oi), eur: cheap[x.oi] ? eur(cheap[x.oi]) : null, owned: x.owned });
    const cardsOut = chosen.slice().sort((a, b) => a[0].cmc - b[0].cmc || a[0].name.localeCompare(b[0].name))
      .map(([x, n, why]) => out(x, n, x.is_creature ? "criatura" : "hechizo", why));
    const landRows = lands.map(([x, n, why]) => out(x, n, "tierra", why));
    for (const col of cols) {
      if (!rounded[col]) continue;
      const oi = oByNorm.get(norm(BASIC_FOR[col]));
      landRows.push({ name: BASIC_FOR[col], qty: rounded[col], role: "tierra", reasons: ["tierra básica"], image: oi != null ? oImage(oi) : null,
        eur: null, basic: true, cmc: 0, type: "Basic Land", owned: null });
    }
    const fullCurve = {};
    for (const [x, n] of chosen) { const b = Math.min(Math.floor(x.cmc), 6); fullCurve[b] = (fullCurve[b] || 0) + n; }
    const avg = spellsTotal ? chosen.reduce((s, [x, n]) => s + x.cmc * n, 0) / spellsTotal : 0;
    const all = [...cardsOut, ...landRows];
    const themes = [...plan.wantsText.entries()].filter(([, w]) => w >= 3).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 6);
    return {
      seed: base.map((x) => x.name).join(" + "), seeds: base.map((x) => x.name),
      colors: colorlessOnly ? "C" : cols.join("") + (wantC ? "C" : ""), format: fmt, buy: buyList(),
      commander: commander ? out(commander, 1, "comandante", ["comandante"]) : null,
      style, style_auto: wanted === "auto" || !STYLES[wanted],
      guide: deckGuide({ chosen, base, commander, plan, landsN: landRows.reduce((s, r) => s + r.qty, 0), style }),
      themes: [...themes, ...[...plan.tribes].map((t) => `tribu ${t}`)], cards: cardsOut, lands: landRows, warnings,
      stats: { total: all.reduce((s, r) => s + r.qty, 0) + (commander ? 1 : 0), spells: spellsTotal, lands: landRows.reduce((s, r) => s + r.qty, 0),
        creatures: chosen.filter(([x]) => x.is_creature).reduce((s, e) => s + e[1], 0), avg_cmc: Math.round(avg * 100) / 100,
        curve: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((k) => [String(k), fullCurve[k] || 0])), roles,
        value: Math.round((all.reduce((s, r) => s + (r.eur || 0) * r.qty, 0) + (commander ? cheap[commander.oi] / 100 || 0 : 0)) * 100) / 100 },
      bench: [...left].map((x) => [x, fit(plan, x)[0] + coBonus(x), fit(plan, x)[1], coBonus(x)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
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
      colors: new Set(o[4] || ""), legal: { pauper: o[6], commander: o[9], standard: o[10] }, rank: o[7], oi, owned: 0 }));
    BY_TAG = new Map(); BY_TYPE = new Map(); BY_SUB = new Map();
    const push = (m, k, oi) => { if (!m.has(k)) m.set(k, []); m.get(k).push(oi); };
    ALL.forEach((x, oi) => {
      x.text_tags.forEach((t) => push(BY_TAG, t, oi));
      x.type_tags.forEach((t) => push(BY_TYPE, t, oi));
      x.subtypes.forEach((t) => push(BY_SUB, t, oi));
    });
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
      .map(([old, [score, by, why]]) => card(old, { score: Math.round(score), with: front(O[by][0]),
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
    const ok = (x) => !x.is_land && !(format !== "commander" && x.cmdr_only) && (format === "casual" || x.legal[format] === 1);
    const allowed = [...pool.values()].filter((oi) => ok(ALL[oi])).map((oi) => front(O[oi][0]));
    const base = seeds.split("|").map((n) => oByNorm.get(norm(n))).filter((oi) => oi != null).map((oi) => ALL[oi]);
    if (!base.length) return { allowed, suggest: [] };
    const plan = makePlan(base);
    const cmd = format === "commander" ? base.find((x) => x.can_command) : null;
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
  const GET = { "/api/summary": summary, "/api/search": search, "/api/printings": printings, "/api/collection": collection,
    "/api/decks": decks, "/api/deck": deck, "/api/movers": movers, "/api/events": events, "/api/collections": collectionsList,
    "/api/build": build, "/api/sets": sets, "/api/set": set, "/api/sets/search": setsSearch, "/api/precons": precons,
    "/api/mydecks": myDecks, "/api/predictions": predictions, "/api/newsets": newSets, "/api/setsynergy": setSynergy,
    "/api/cardsynergy": cardSynergy, "/api/seedhelp": seedHelp,"/api/profile": profile, "/api/medals": medals, "/api/exportcsv": exportCsv, "/api/alterestimate": alterEstimateRoute };
  const POST = { "/api/match": match, "/api/collection": collectionAdd, "/api/import": importCards,
    "/api/collections": collectionsPost, "/api/sets": setsPin, "/api/mydecks": myDecksPost, "/api/owncards": ownCards, "/api/profile": profilePost, "/api/alter": alterPost };

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
    if (!u.binders || !u.cards) throw new Error("No es una copia de seguridad de Gathering Market");
    user = u;
    await saveUser();
  }

  return { load, call, exportUser, importUser, get day() { return loaded ? PR.day : null; }, set onSave(fn) { onSaved = fn; } };
})();
