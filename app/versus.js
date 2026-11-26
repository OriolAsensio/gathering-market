"use strict";
/* Versus: jugar tus mazos contra un bot (pestaña propia), con una mesa al estilo de Endstep: rival arriba, tú abajo,
 * barra de fases en el centro, mano abajo en abanico, cartas que vuelan, daño que salta, criaturas que se deshacen al morir
 * y sonidos sintetizados (sin archivos). Es Magic simplificado (lo explica play.js): maná por colores de las tierras,
 * combate con fuerza/resistencia y palabras clave básicas (vuela, alcance, prisa, vigilancia, toque mortal, vínculo vital,
 * arrollar, defensor), y de los hechizos solo daño, destruir/exiliar criatura, robar y ganar vidas.
 * Usa lo de app.js (api, $, esc, toast, store, openSheet, closeSheet, Sfx, views) y de play.js (Play.loadDeck…). */

// Rivales. Más adelante, más personajes con su mazo temático (p. ej. Cursed Guy con Cursed Land).
const BOTS = [
  { id: "uris", name: "Uris", avatar: "🧙", blurb: "Juega un mazo del meta de tu formato. Ataca cuando le sale a cuenta y quita tus mejores criaturas." },
  { id: "cursed", name: "Cursed Guy", avatar: "💀", blurb: "Su mazo de Cursed Land.", soon: true },
];
const VS_LEVELS = [["easy", "Fácil"], ["normal", "Normal"], ["hard", "Difícil"]];
const DECK_FMT = { Pauper: "PAU", "Estándar": "ST", Standard: "ST", Modern: "MO", Pioneer: "PI", Legacy: "LE", Vintage: "VI", Premodern: "PREM" };

const Versus = (() => {
  const { loadDeck, shuffle, isLand, isCreature } = Play;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const buzz = (ms) => navigator.vibrate?.(ms);
  let G = null, board = null, uid = 0;

  // ---- sonidos
  const S = {
    draw() { Sfx.noise(0.12, 3200, 0.06, 0.8); },
    land() { Sfx.play([[110, 0, 0.18, "sine", 0.18]]); Sfx.noise(0.08, 500, 0.08); },
    cast() { Sfx.play(Sfx.arp([523.3, 784, 1046.5], 0.05, 0.25)); },
    attack() { Sfx.noise(0.35, 900, 0.12, 0.6); Sfx.play([[180, 0, 0.25, "sawtooth", 0.04]]); },
    hit() { Sfx.noise(0.14, 260, 0.28, 0.8); Sfx.play([[90, 0, 0.22, "sine", 0.2]]); },
    die() { Sfx.play([[400, 0, 0.15, "triangle", 0.06], [300, 0.1, 0.2, "triangle", 0.05], [200, 0.22, 0.35, "triangle", 0.05]]); Sfx.noise(0.4, 700, 0.05, 0.5); },
    gain() { Sfx.play(Sfx.arp([659.3, 880, 1174.7], 0.06, 0.3)); },
    turn() { Sfx.play([[784, 0, 0.4, "sine", 0.06], [1174.7, 0.05, 0.5, "sine", 0.04]]); },
    click() { Sfx.play([[1200, 0, 0.03, "square", 0.02]]); },
    no() { Sfx.play([[180, 0, 0.12, "square", 0.04]]); },
    win() { Sfx.complete(); },
    lose() { Sfx.play([[392, 0, 0.4, "triangle", 0.08], [349.2, 0.35, 0.4, "triangle", 0.08], [311.1, 0.7, 0.4, "triangle", 0.08], [261.6, 1.05, 0.9, "sawtooth", 0.05]]); },
  };

  // ---- reglas sencillas
  const kw = (c, word) => (c.text || "").split("\n").some((l) => /^[A-Za-z ,'-]+$/.test(l.trim()) && new RegExp(`\\b${word}\\b`, "i").test(l));
  const BASIC_COL = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };
  function produces(c) {  // colores que da una tierra
    const out = new Set(), t = (c.type || "").toLowerCase();
    for (const [k, v] of Object.entries(BASIC_COL)) if (t.includes(k)) out.add(v);
    for (const m of (c.text || "").matchAll(/add \{([WUBRGC])\}(?: or \{([WUBRGC])\})?/gi)) { out.add(m[1].toUpperCase()); if (m[2]) out.add(m[2].toUpperCase()); }
    if (/add one mana of any color|mana of any color/i.test(c.text || "")) "WUBRG".split("").forEach((x) => out.add(x));
    if (!out.size) out.add("C");
    return out;
  }
  function costOf(c) {
    const pips = [], cost = c.cost || "";
    let generic = 0;
    for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
      const s = m[1];
      if (/^\d+$/.test(s)) generic += +s;
      else if (/^[WUBRG]$/.test(s)) pips.push(s);
      else if (/^[WUBRG]\/[WUBRGP]$/.test(s)) pips.push(s.split("/")[0] + s.split("/")[1]);  // híbrido: cualquiera de los dos
      else if (s === "C") pips.push("C");
    }
    if (!cost && !isLand(c)) generic = Math.round(c.cmc || 0);
    return { pips, generic };
  }
  const manaRock = (c) => /\{T\}(?:, [^:]*)?: Add/i.test(c.text || "");
  // Fuentes de maná sin girar: tierras, y criaturas/artefactos que dan maná (las criaturas, si no acaban de entrar)
  const untapped = (P) => P.bf.filter((x) => !x.tapped && !x.dying && (isLand(x.c) || (manaRock(x.c) && !(isCreature(x.c) && x.sick && !kw(x.c, "haste")))))
    .sort((a, b) => isLand(b.c) - isLand(a.c));  // primero las tierras: así las criaturas quedan para atacar
  /** Qué tierras girar para pagar (null si no llega). Primero los colores, con las tierras que dan menos colores. */
  function payPlan(P, c) {
    const { pips, generic } = costOf(c), pool = untapped(P).map((x) => ({ x, cols: produces(x.c) })), used = new Set();
    for (const p of pips) {
      const ok = pool.filter((l) => !used.has(l) && [...p].some((col) => l.cols.has(col))).sort((a, b) => a.cols.size - b.cols.size)[0];
      if (!ok) return null;
      used.add(ok);
    }
    const rest = pool.filter((l) => !used.has(l));
    if (rest.length < generic) return null;
    rest.slice(0, generic).forEach((l) => used.add(l));
    return [...used].map((l) => l.x);
  }
  const DMG = /deals? (\d+) damage to (any target|target creature or player|target player or planeswalker|target opponent|each opponent|target creature or planeswalker|target creature)/i;
  const KILL = /(destroy|exile) target (?:nonland |non-?black |non-?artifact |attacking |tapped |nonwhite )?creature/i;
  const DRAW = /draws? (a|one|two|three|\d+) cards?/i;
  const GAIN = /you gain (\d+) life/i;
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
  const SHRINK = /target creature (?:an opponent controls )?gets? [-−](\d+)\/[-−](\d+)/i;
  const BOUNCE = /return target (?:nonland permanent|creature|permanent)(?: an opponent controls)? to its owner'?s hand/i;
  const TOKENS = /create (a|an|one|two|three|four|\d+) (\d+)\/(\d+) ([^.]*?)creature tokens?/i;
  const needsTarget = (c) => {
    const t = c.text || "", d = DMG.exec(t);
    if (d && !/each opponent|target opponent/i.test(d[2])) return { kind: "dmg", n: +d[1], creatureOnly: /creature/i.test(d[2]) && !/player|any/i.test(d[2]) };
    if (KILL.test(t)) return { kind: "kill", creatureOnly: true };
    const s2 = SHRINK.exec(t); if (s2) return { kind: "dmg", n: +s2[2], creatureOnly: true, shrink: true };
    if (BOUNCE.test(t)) return { kind: "bounce", creatureOnly: true };
    return null;
  };
  // Contrahechizos: sin pila no hay nada que contrarrestar (salvo que también hagan otra cosa que sí se entiende)
  const counterOnly = (c) => /counter target/i.test(c.text || "") && !isCreature(c) && ![DMG, KILL, DRAW, GAIN].some((rx) => rx.test(c.text || ""));
  const etbText = (c) => (isCreature(c) && /when .{0,40} enters/i.test(c.text || "") ? c.text : "");
  const power = (x) => x.c.power, tough = (x) => x.c.toughness - (x.dmg || 0);
  const canAttack = (x) => isCreature(x.c) && !x.tapped && (!x.sick || kw(x.c, "haste")) && !kw(x.c, "defender");
  const canBlock = (b, a) => isCreature(b.c) && !b.tapped && (!kw(a.c, "flying") || kw(b.c, "flying") || kw(b.c, "reach"));

  // ---------------------------------------------------------------- vestíbulo: rival, nivel y mazos
  async function lobby() {
    const v = $("#view");
    v.innerHTML = `<div class="vs-hero"><h2>⚔️ Versus</h2></div>${skeleton(3)}`;
    const [mine, meta] = await Promise.all([api("/api/mydecks"), api("/api/decks")]);
    const own = mine.filter((d) => !d.test), tests = mine.filter((d) => d.test);
    const fmts = [...new Set(meta.map((d) => d.format))];
    let deckId = store("vsDeck") || own[0]?.id || meta.find((d) => d.format === "PAU")?.id;
    let bot = store("vsBot") || "uris", level = store("vsLevel") || "normal";
    const fmtOf = (id) => { const m = meta.find((d) => String(d.id) === String(id)); if (m) return m.format; const u = mine.find((d) => d.id === id); return DECK_FMT[u?.category] || "PAU"; };
    const draw = () => {
      const f = fmtOf(deckId), opp = meta.filter((d) => d.format === f && !d.example);
      v.innerHTML = `<div class="vs-hero"><div class="vs-hero-ico">⚔️</div><h2>Versus</h2><div class="sub">Practica tus mazos contra un bot, como en Endstep.</div></div>
        <h2>Rival</h2>
        <div class="vs-bots">${BOTS.map((b) => `<button class="vs-bot ${b.id === bot ? "on" : ""} ${b.soon ? "soon" : ""}" data-bot="${b.id}" ${b.soon ? "disabled" : ""}>
          <span class="vs-ava">${b.avatar}</span><b>${esc(b.name)}</b><span class="sub">${b.soon ? "Próximamente" : esc(b.blurb)}</span></button>`).join("")}</div>
        <div class="seg" id="vs-level">${VS_LEVELS.map(([k, n]) => `<button data-l="${k}" class="${k === level ? "on" : ""}">${n}</button>`).join("")}</div>
        <h2>Tu mazo</h2>
        <select class="search deck-select" id="vs-deck">
          ${own.length ? `<optgroup label="${esc(t("Mis mazos"))}">${own.map((d) => `<option value="${esc(d.id)}">${esc(d.archetype)}</option>`).join("")}</optgroup>` : ""}
          ${tests.length ? `<optgroup label="${esc(t("Mazos para probar"))}">${tests.map((d) => `<option value="${esc(d.id)}">${esc(d.archetype)}</option>`).join("")}</optgroup>` : ""}
          ${fmts.filter((x) => x !== "DAN").map((x) => `<optgroup label="${esc(t(`Meta de ${META_FORMATS[x] || x}`))}">${meta.filter((d) => d.format === x).map((d) => `<option value="${d.id}">${esc(d.archetype)}</option>`).join("")}</optgroup>`).join("")}
        </select>
        <h2>Mazo del rival</h2>
        <select class="search deck-select" id="vs-opp"><option value="auto">${esc(t("Al azar, del meta de tu formato"))}</option>${opp.map((d) => `<option value="${d.id}">${esc(d.archetype)}${d.share ? ` (${d.share}%)` : ""}</option>`).join("")}</select>
        <button class="btn block primary vs-go" id="vs-go">⚔️ Jugar</button>
        <div class="hint">Es Magic simplificado: el maná sale de los colores de tus tierras, el combate va por fuerza y resistencia (con vuela, alcance, prisa, vigilancia, toque mortal, vínculo vital, arrollar y defensor) y de los hechizos se entienden el daño, destruir o exiliar criaturas, robar y ganar vidas.</div>`;
      $("#vs-deck").value = String(deckId);
      $("#vs-opp").value = store("vsOpp") && opp.some((d) => String(d.id) === store("vsOpp")) ? store("vsOpp") : "auto";
      v.querySelectorAll("[data-bot]").forEach((b) => (b.onclick = () => { bot = b.dataset.bot; store("vsBot", bot); S.click(); draw(); }));
      v.querySelectorAll("#vs-level button").forEach((b) => (b.onclick = () => { level = b.dataset.l; store("vsLevel", level); S.click(); draw(); }));
      $("#vs-deck").onchange = (e) => { deckId = e.target.value; store("vsDeck", deckId); draw(); };
      $("#vs-opp").onchange = (e) => store("vsOpp", e.target.value);
      $("#vs-go").onclick = () => {
        const oppId = $("#vs-opp").value === "auto" ? (opp.length ? opp.sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 8)[rnd(Math.min(8, opp.length))].id : meta.find((d) => d.format === "PAU")?.id) : $("#vs-opp").value;
        start(deckId, oppId, BOTS.find((b) => b.id === bot), level);
      };
    };
    draw();
  }

  // ---------------------------------------------------------------- partida
  const side = (name, avatar, deck) => {
    const lib = shuffle(deck.map((c) => ({ ...c, uid: ++uid })));
    return { name, avatar, life: 20, lib, hand: [], bf: [], gy: [], landDrop: false, lost: false };
  };
  async function start(myId, oppId, bot, level) {
    document.querySelector(".vs-board")?.remove();
    board = document.createElement("div");
    board.className = "vs-board";
    board.innerHTML = `<div class="vs-loading"><div class="vs-spin">⚔️</div><div>Barajando…</div></div>`;
    document.body.appendChild(board);
    try {
      const [mineD, oppD] = await Promise.all([api(`/api/deck?id=${encodeURIComponent(myId)}`), api(`/api/deck?id=${encodeURIComponent(oppId)}`)]);
      const [myCards, oppCards] = await Promise.all([loadDeck(mineD.cards), loadDeck(oppD.cards)]);
      Sfx.noise(0.5, 2500, 0.05, 0.5);
      G = { me: side("Tú", "🙂", myCards), op: side(bot.name, bot.avatar, oppCards), bot, level, turn: 0, active: null, phase: "start",
        mode: null, sel: null, blocks: new Map(), attackers: new Set(), log: [], over: false, myDeck: mineD.archetype, oppDeck: oppD.archetype, ids: [myId, oppId], seen: new Set() };
      const meFirst = rnd(2) === 0;
      for (let i = 0; i < 7; i++) { G.me.hand.push(G.me.lib.shift()); G.op.hand.push(G.op.lib.shift()); }
      // El bot se hace un mulligan si su mano no tiene 2-5 tierras
      const lands = G.op.hand.filter(isLand).length;
      if (lands < 2 || lands > 5) { G.op.lib.push(...G.op.hand.splice(0)); shuffle(G.op.lib); for (let i = 0; i < 7; i++) G.op.hand.push(G.op.lib.shift()); G.op.lib.push(G.op.hand.pop()); log(`${bot.name} hace mulligan.`); }
      render();
      await banner(meFirst ? "Empiezas tú" : `Empieza ${bot.name}`, "🪙");
      await mulligan();
      if (meFirst) myTurn(true); else botTurn(true);
    } catch (e) {
      board.innerHTML = `<div class="vs-loading"><div>No he podido preparar la partida</div><div class="sub">${esc(e.message)}</div><button class="btn" id="vs-x">Volver</button></div>`;
      $("#vs-x", board).onclick = close;
    }
  }
  const log = (s) => { G.log.unshift(s); const l = $(".vs-log", board); if (l && !l.hidden) l.innerHTML = G.log.slice(0, 40).map((x) => `<div>${esc(t(x))}</div>`).join(""); };
  function close() { board?.remove(); board = null; G = null; lobby(); }

  // Mulligan de Londres: ves tu mano; si la cambias, robas 7 y pones debajo tantas como mulligans
  async function mulligan() {
    let mulls = 0;
    for (;;) {
      const keep = await new Promise((res) => {
        overlay(`<h3>Tu mano inicial</h3><div class="sub">${G.me.hand.filter(isLand).length} tierras${mulls ? ` · mulligan ${mulls}` : ""}</div>
          <div class="vs-mhand">${G.me.hand.map((c, i) => `<img src="${esc(c.image)}" alt="${esc(c.name)}" style="--i:${i}">`).join("")}</div>
          <div class="row-btns"><button class="btn" id="vs-mull" ${mulls >= 3 ? "disabled" : ""}>Mulligan</button><button class="btn primary" id="vs-keep">Me la quedo</button></div>`);
        $("#vs-keep", board).onclick = () => res(true);
        $("#vs-mull", board).onclick = () => res(false);
      });
      S.click();
      if (keep) break;
      mulls++;
      G.me.lib.push(...G.me.hand.splice(0)); shuffle(G.me.lib); Sfx.noise(0.4, 2500, 0.06, 0.5);
      for (let i = 0; i < 7; i++) G.me.hand.push(G.me.lib.shift());
    }
    if (mulls) {  // poner debajo
      await new Promise((res) => {
        let left = mulls;
        const paintB = () => {
          overlay(`<h3>Pon ${left === 1 ? "1 carta" : `${left} cartas`} debajo</h3><div class="sub">Toca las que quieres quitarte.</div>
            <div class="vs-mhand pick">${G.me.hand.map((c, i) => `<img src="${esc(c.image)}" alt="${esc(c.name)}" data-i="${i}" style="--i:${i}">`).join("")}</div>`);
          board.querySelectorAll(".vs-mhand [data-i]").forEach((im) => (im.onclick = () => {
            G.me.lib.push(...G.me.hand.splice(+im.dataset.i, 1)); S.click(); left--;
            if (left) paintB(); else res();
          }));
        };
        paintB();
      });
    }
    overlay(null);
  }
  function overlay(html) {
    let o = $(".vs-over", board);
    if (!html) { o?.remove(); return; }
    if (!o) { o = document.createElement("div"); o.className = "vs-over"; board.appendChild(o); }
    o.innerHTML = `<div class="vs-over-box">${html}</div>`;
  }
  async function banner(text, ico = "") {
    const b = document.createElement("div");
    b.className = "vs-banner";
    b.innerHTML = `<span>${ico} ${esc(t(text))}</span>`;
    board.appendChild(b);
    S.turn();
    await sleep(1100);
    b.remove();
  }
  async function showCast(P, c) {  // el bot enseña lo que lanza (como en Endstep: la carta pasa por el centro)
    const b = document.createElement("div");
    b.className = "vs-cast";
    b.innerHTML = `<img src="${esc(c.image)}" alt="${esc(c.name)}"><div>${esc(P.name)}</div>`;
    board.appendChild(b);
    S.cast();
    await sleep(G.level === "easy" ? 900 : 1100);
    b.remove();
  }
  function float(el, text, cls) {
    if (!el) return;
    const r = el.getBoundingClientRect(), f = document.createElement("div");
    f.className = `vs-float ${cls}`;
    f.textContent = text;
    f.style.left = `${r.left + r.width / 2}px`; f.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }
  const elOf = (u) => board?.querySelector(`[data-uid="${u}"]`);
  const plateOf = (P) => board?.querySelector(P === G.me ? ".vs-plate.me" : ".vs-plate.op");
  function hurt(P, n, src) {
    if (n <= 0) return;
    P.life -= n;
    const pl = plateOf(P);
    float($(".vs-life", pl), `-${n}`, "dmg");
    pl?.classList.remove("shake"); void pl?.offsetWidth; pl?.classList.add("shake");
    S.hit(); buzz(P === G.me ? 60 : 20);
    if (src) log(`${src} hace ${n} de daño a ${P === G.me ? "ti" : P.name}.`);
  }
  function heal(P, n) { P.life += n; float($(".vs-life", plateOf(P)), `+${n}`, "heal"); S.gain(); }

  // Robar (con animación: vuela desde la biblioteca)
  function draw(P) {
    if (!P.lib.length) { P.lost = true; log(P === G.me ? "No puedes robar: pierdes." : `${P.name} no puede robar: pierde.`); return; }
    const c = P.lib.shift(); c.fresh = true; P.hand.push(c);
    if (P === G.me) S.draw();
  }

  // ---- pintar la mesa
  function cardEl(x, P) {
    const c = x.c, mine = P === G.me, cls = [x.tapped ? "tapped" : "", isLand(c) ? "land" : "", x.sick && isCreature(c) && !kw(c, "haste") ? "sick" : "",
      G.attackers.has(x) ? "attacking" : "", G.sel === x ? "sel" : "", x.dying ? "dying" : "", G.seen.has(x.uid) ? "" : "enter",
      G.mode === "target" && G.target?.ok(x) ? "targetable" : "", G.mode === "attack" && mine && canAttack(x) ? "can" : "",
      G.mode === "block" && mine && isCreature(c) && !x.tapped ? "can" : "", [...G.blocks.values()].includes(x) ? "blocking" : "",
      G.blocks.has(x) ? "blocked" : ""].filter(Boolean).join(" ");
    G.seen.add(x.uid);
    return `<div class="vs-card ${cls} ${c.token ? "token" : ""}" data-uid="${x.uid}" data-side="${mine ? "me" : "op"}">${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" draggable="false">` : `<div class="vs-tok">${esc(c.name.replace(/ \d+\/\d+$/, ""))}</div>`}
      ${isCreature(c) ? `<span class="pt ${x.dmg ? "hurt" : ""}">${power(x)}/${tough(x)}</span>` : ""}</div>`;
  }
  function field(P) {
    const lands = P.bf.filter((x) => isLand(x.c)), rest = P.bf.filter((x) => !isLand(x.c));
    const row = (list, cls) => `<div class="vs-row ${cls}">${list.map((x) => cardEl(x, P)).join("")}</div>`;
    return P === G.me ? row(rest, "main") + row(lands, "lands") : row(lands, "lands") + row(rest, "main");
  }
  function plate(P, cls) {
    return `<div class="vs-plate ${cls} ${G.active === (P === G.me ? "me" : "op") ? "active" : ""} ${G.mode === "target" && G.target?.face && P === G.op ? "targetable" : ""}">
      <span class="vs-av">${P.avatar}</span><div class="vs-who"><b>${esc(P.name)}</b><span class="sub">🂠 ${P.lib.length} · ✋ ${P.hand.length} · 🪦 ${P.gy.length}</span></div>
      ${P === G.op ? `<div class="vs-opphand">${P.hand.map(() => `<i></i>`).join("")}</div>` : ""}
      <b class="vs-life">${P.life}</b></div>`;
  }
  const PHASES = [["draw", "Robo"], ["main", "Principal"], ["combat", "Combate"], ["end", "Final"]];
  function render() {
    if (!board || !G) return;
    const me = G.me, myTurn = G.active === "me", busy = G.active === "op" && G.mode !== "block";
    const playable = (c) => myTurn && !G.mode && !counterOnly(c) && (isLand(c) ? !me.landDrop : !!payPlan(me, c));
    let action = "";
    if (G.over) action = "";
    else if (G.mode === "block") action = `<button class="vs-btn primary" data-a="blocks">🛡️ ${G.blocks.size ? `Bloquear (${G.blocks.size})` : "Sin bloqueos"}</button>`;
    else if (G.mode === "attack") action = `<button class="vs-btn" data-a="cancel">Cancelar</button><button class="vs-btn primary" data-a="attack">⚔️ Atacar (${G.attackers.size})</button>`;
    else if (G.mode === "target") action = G.target.cancel ? `<button class="vs-btn" data-a="cancel">Cancelar</button>` : "";
    else if (myTurn) action = `${G.phase === "main" && me.bf.some(canAttack) ? `<button class="vs-btn" data-a="combat">⚔️ Combate</button>` : ""}<button class="vs-btn primary" data-a="end">Fin del turno ➜</button>`;
    else action = `<button class="vs-btn" disabled>${esc(G.op.name)} piensa…</button>`;
    board.innerHTML = `
      <div class="vs-top"><button class="vs-ico" data-a="exit" aria-label="Salir">✕</button><span class="sub">${esc(G.oppDeck)}</span><button class="vs-ico" data-a="log" aria-label="Lo que ha pasado">📜</button></div>
      ${plate(G.op, "op")}
      <div class="vs-field op">${field(G.op)}</div>
      <div class="vs-mid ${myTurn ? "me" : "op"}"><span class="vs-turn">T${G.turn}</span>${PHASES.map(([k, n]) => `<span class="vs-ph ${G.phase === k ? "on" : ""}">${n}</span>`).join("")}</div>
      <div class="vs-field me">${field(me)}</div>
      ${plate(me, "me")}
      <div class="vs-actions">${G.mode === "target" ? `<span class="vs-hintline">${esc(t(G.target.label))}</span>` : G.mode === "block" ? `<span class="vs-hintline">${esc(t("Toca tu criatura y luego la atacante para bloquearla"))}</span>` : G.mode === "attack" ? `<span class="vs-hintline">${esc(t("Toca las criaturas que atacan"))}</span>` : ""}${action}</div>
      <div class="vs-hand" style="--n:${me.hand.length}">${me.hand.map((c, i) => `<div class="vs-hcard ${playable(c) ? "can" : ""} ${c.fresh ? "drawn" : ""}" data-h="${c.uid}" style="--i:${i}"><img src="${esc(c.image)}" alt="${esc(c.name)}" draggable="false"></div>`).join("")}</div>
      <div class="vs-log" hidden></div>`;
    me.hand.forEach((c) => delete c.fresh);
    if (busy) board.classList.add("busy"); else board.classList.remove("busy");
    bind();
  }

  // ---- toques
  function bind() {
    board.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => act(b.dataset.a)));
    board.querySelectorAll(".vs-hcard").forEach((el) => press(el, () => playFromHand(+el.dataset.h), () => preview(G.me.hand.find((c) => c.uid === +el.dataset.h))));
    board.querySelectorAll(".vs-card").forEach((el) => {
      const P = el.dataset.side === "me" ? G.me : G.op, x = P.bf.find((y) => y.uid === +el.dataset.uid);
      press(el, () => tapCard(x, P), () => preview(x?.c));
    });
    const opPlate = $(".vs-plate.op", board);
    opPlate.onclick = () => { if (G.mode === "target" && G.target.face) { const tg = G.target; G.mode = null; G.target = null; tg.pick("face"); } };
  }
  function press(el, tap, hold) {  // tocar o mantener (ver la carta en grande)
    let t0 = null, held = false;
    el.onpointerdown = () => { held = false; t0 = setTimeout(() => { held = true; hold(); }, 450); };
    el.onpointerup = () => { clearTimeout(t0); if (!held) tap(); };
    el.onpointerleave = el.onpointercancel = () => clearTimeout(t0);
    el.oncontextmenu = (e) => e.preventDefault();
  }
  function preview(c) {
    if (!c || !c.image) return;
    const p = document.createElement("div");
    p.className = "vs-preview";
    p.innerHTML = `<img src="${esc(c.image)}" alt="${esc(c.name)}">`;
    p.onclick = () => p.remove();
    board.appendChild(p);
  }
  async function act(a) {
    S.click();
    if (a === "exit") { if (G.over || confirm(t("¿Abandonar la partida?"))) close(); return; }
    if (a === "log") { const l = $(".vs-log", board); l.hidden = !l.hidden; if (!l.hidden) l.innerHTML = G.log.slice(0, 40).map((x) => `<div>${esc(t(x))}</div>`).join(""); return; }
    if (a === "combat") { G.mode = "attack"; G.phase = "combat"; G.attackers.clear(); render(); return; }
    if (a === "cancel") { if (G.mode === "attack") { G.attackers.clear(); G.phase = "main"; } G.mode = null; G.target = null; render(); return; }
    if (a === "attack") {
      if (!G.attackers.size) { S.no(); return toast("Toca primero las criaturas que atacan"); }
      G.mode = null;
      const att = [...G.attackers];
      G.blocks = botBlocks(att);
      await combat(G.me, G.op, att);
      G.phase = "main2"; render(); checkEnd(); return;
    }
    if (a === "end") { G.phase = "end"; render(); await sleep(250); discardDown(G.me); botTurn(false); return; }
    if (a === "blocks") { G.mode = null; G.blockDone?.(); }
  }
  function tapCard(x, P) {
    if (!x || G.over) return;
    if (G.mode === "target") { if (G.target.ok(x)) { const tg = G.target; G.mode = null; G.target = null; tg.pick(x); } else S.no(); return; }
    if (G.mode === "attack" && P === G.me) { if (!canAttack(x)) { S.no(); return; } G.attackers.has(x) ? G.attackers.delete(x) : G.attackers.add(x); S.click(); render(); return; }
    if (G.mode === "block") {
      if (P === G.me && isCreature(x.c) && !x.tapped) { for (const [a, b] of G.blocks) if (b === x) G.blocks.delete(a); G.sel = G.sel === x ? null : x; S.click(); render(); return; }
      if (P === G.op && G.attackers.has(x) && G.sel) {
        if (!canBlock(G.sel, x)) { S.no(); return toast(kw(x.c, "flying") ? "Vuela: solo la bloquea una criatura que vuele o tenga alcance" : "No puede bloquear"); }
        G.blocks.set(x, G.sel); G.sel = null; S.click(); render(); return;
      }
    }
  }
  function playFromHand(id) {
    const me = G.me, c = me.hand.find((x) => x.uid === id);
    if (!c || G.over) return;
    if (G.active !== "me" || G.mode) { S.no(); return; }
    if (isLand(c)) {
      if (me.landDrop) { S.no(); return toast("Ya has jugado una tierra este turno"); }
      me.landDrop = true; me.hand.splice(me.hand.indexOf(c), 1); me.bf.push({ uid: c.uid, c, tapped: false, sick: false, dmg: 0 });
      S.land(); log(`Juegas ${c.name}.`); render(); return;
    }
    if (counterOnly(c)) { S.no(); return toast("Los contrahechizos no se usan en esta mesa: no hay pila (el rival lanza en su turno)"); }
    const plan = payPlan(me, c);
    if (!plan) { S.no(); return toast("Te falta maná (o del color que pide)"); }
    const cast = (target) => {
      plan.forEach((l) => (l.tapped = true));
      me.hand.splice(me.hand.indexOf(c), 1);
      S.cast(); log(`Lanzas ${c.name}.`);
      if (isCreature(c) || /artifact|enchantment|planeswalker|battle/i.test(c.type || "")) {
        const x = { uid: c.uid, c, tapped: false, sick: true, dmg: 0 };
        me.bf.push(x);
        render();
        if (etbText(c)) resolve(me, G.op, c, true);
      } else { resolve(me, G.op, c, false, target); me.gy.push(c); }
      render(); checkEnd();
    };
    const need = needsTarget(c);
    if (need && !isCreature(c)) askTarget(me, need, c, (tg) => cast(tg), true);
    else cast(null);
  }
  /** Elegir objetivo tocando la mesa (lo que vale, brilla). */
  function askTarget(P, need, c, done, cancel) {
    const foeCreatures = (P === G.me ? G.op : G.me).bf.filter((x) => isCreature(x.c) && !x.dying);
    if (need.creatureOnly && !foeCreatures.length) { if (cancel) { S.no(); return toast("No hay criaturas a las que apuntar"); } return done(null); }
    G.mode = "target";
    G.target = { face: !need.creatureOnly, cancel, ok: (x) => foeCreatures.includes(x), pick: (tg) => { render(); done(tg); },
      label: need.kind === "kill" ? `${c.name}: elige la criatura` : `${c.name}: elige el objetivo (${need.n} de daño)` };
    render();
  }

  // Efectos: daño, quitar criatura, robar, ganar vidas (al lanzar, o al entrar una criatura)
  function resolve(P, foe, c, etb, target) {
    const text = c.text || "", need = needsTarget(c);
    const apply = (tg) => {
      if (need?.kind === "dmg" && tg) {
        if (tg === "face") hurt(foe, need.n, c.name);
        else { tg.dmg = (tg.dmg || 0) + need.n; float(elOf(tg.uid), `-${need.n}`, "dmg"); S.hit(); log(`${c.name} hace ${need.n} de daño a ${tg.c.name}.`); }
      }
      if (need?.kind === "kill" && tg && tg !== "face") { tg.dmg = 99; log(`${c.name} quita ${tg.c.name}.`); }
      if (need?.kind === "bounce" && tg && tg !== "face") {
        const owner = G.me.bf.includes(tg) ? G.me : G.op;
        owner.bf.splice(owner.bf.indexOf(tg), 1);
        if (!tg.c.token) owner.hand.push(tg.c);
        Sfx.noise(0.25, 1800, 0.08, 0.7); log(`${c.name} devuelve ${tg.c.name} a la mano.`);
      }
      const tk = TOKENS.exec(text);
      if (tk) {  // fichas de criatura (Battle Screech, Kuldotha Rebirth…)
        const n = NUM[tk[1].toLowerCase()] || +tk[1] || 1, name = `${tk[4].trim().replace(/^(?:tapped |colorless )+/i, "") || "Ficha"} ${tk[2]}/${tk[3]}`.trim();
        const flying = /flying/i.test(tk[4] + text.slice(tk.index, tk.index + 120));
        for (let i = 0; i < n; i++) P.bf.push({ uid: ++uid, c: { name, type: "Token Creature", power: +tk[2], toughness: +tk[3], text: flying ? "Flying" : "", image: null, token: true, cmc: 0 }, tapped: false, sick: true, dmg: 0 });
        Sfx.play(Sfx.arp([784, 988, 1175], 0.05, 0.2)); log(P === G.me ? `Creas ${n} ${name}.` : `${P.name} crea ${n} ${name}.`);
      }
      const each = /each opponent/i.exec(text) && DMG.exec(text);
      if (each && /each opponent|target opponent/i.test(each[2])) hurt(foe, +each[1], c.name);
      const d = DRAW.exec(text);
      if (d && !/each player|target player draws/i.test(text)) { const n = NUM[d[1].toLowerCase()] || +d[1] || 1; for (let i = 0; i < n; i++) draw(P); log(P === G.me ? `Robas ${n}.` : `${P.name} roba ${n}.`); }
      const g = GAIN.exec(text);
      if (g) { heal(P, +g[1]); log(P === G.me ? `Ganas ${g[1]} vidas.` : `${P.name} gana ${g[1]} vidas.`); }
      cleanup();
    };
    if (!need || target !== undefined && target !== null) return apply(target);
    if (P === G.me) askTarget(P, need, c, apply, false);
    else apply(botTarget(need));
  }
  function cleanup() {
    let died = false;
    for (const P of [G.me, G.op]) for (const x of P.bf) if (isCreature(x.c) && !x.dying && (x.dmg || 0) >= x.c.toughness) { x.dying = true; died = true; log(`${x.c.name} muere.`); }
    if (died) {
      S.die(); render();
      setTimeout(() => { for (const P of [G.me, G.op]) { for (const x of P.bf.filter((y) => y.dying)) P.gy.push(x.c); P.bf = P.bf.filter((y) => !y.dying); } render(); }, 520);
    }
  }
  async function combat(att, def, attackers) {
    G.phase = "combat";
    for (const a of attackers) if (!kw(a.c, "vigilance")) a.tapped = true;
    S.attack(); render(); await sleep(650);
    let face = 0;
    for (const a of attackers) {
      const b = G.blocks.get(a);
      if (b && !b.dying) {
        const aDmg = power(a), bDmg = power(b);
        b.dmg = (b.dmg || 0) + (kw(a.c, "deathtouch") && aDmg > 0 ? 99 : aDmg);
        a.dmg = (a.dmg || 0) + (kw(b.c, "deathtouch") && bDmg > 0 ? 99 : bDmg);
        float(elOf(b.uid), `-${aDmg}`, "dmg"); float(elOf(a.uid), `-${bDmg}`, "dmg");
        log(`${b.c.name} bloquea a ${a.c.name}.`);
        if (kw(a.c, "trample")) { const over = aDmg - Math.max(0, b.c.toughness - ((b.dmg || 0) - aDmg)); if (over > 0) face += over; }
      } else face += power(a);
      if (kw(a.c, "lifelink") && power(a) > 0) heal(att, power(a));
    }
    if (face) hurt(def, face, null), log(att === G.me ? `Haces ${face} de daño a ${def.name}.` : `${att.name} te hace ${face} de daño.`);
    else S.hit();
    G.attackers.clear(); G.blocks = new Map();
    cleanup();
    await sleep(600);
  }
  function discardDown(P) {
    while (P.hand.length > 7) { const c = P.hand.sort((a, b) => b.cmc - a.cmc).shift(); P.gy.push(c); log(P === G.me ? `Descartas ${c.name}.` : `${P.name} descarta ${c.name}.`); }
  }
  function checkEnd() {
    if (G.over) return true;
    const meDead = G.me.life <= 0 || G.me.lost, opDead = G.op.life <= 0 || G.op.lost;
    if (!meDead && !opDead) return false;
    G.over = true; G.mode = null;
    const won = !meDead;
    setTimeout(() => {
      won ? S.win() : S.lose(); buzz(won ? [40, 60, 40, 60, 120] : 300);
      overlay(`<div class="vs-end ${won ? "won" : "lost"}">${won ? "🏆" : "💀"}</div><h3>${won ? "¡Victoria!" : "Derrota"}</h3>
        <div class="sub">${esc(G.myDeck)} contra ${esc(G.oppDeck)} · turno ${G.turn}</div>
        ${won ? `<div class="vs-confetti">${Array.from({ length: 40 }, (_, i) => `<i style="--x:${rnd(100)};--d:${rnd(900)}ms;--h:${rnd(360)}"></i>`).join("")}</div>` : ""}
        <div class="row-btns"><button class="btn" id="vs-lobby">Cambiar mazos</button><button class="btn primary" id="vs-again">Revancha</button></div>`);
      $("#vs-again", board).onclick = () => start(G.ids[0], G.ids[1], G.bot, G.level);
      $("#vs-lobby", board).onclick = close;
    }, 600);
    render();
    return true;
  }

  // ---- tu turno
  async function myTurn(first) {
    if (checkEnd()) return;
    G.turn++; G.active = "me"; G.phase = "draw"; G.mode = null; G.me.landDrop = false;
    for (const x of G.me.bf) { x.tapped = false; x.sick = false; x.dmg = 0; }
    for (const x of G.op.bf) x.dmg = 0;
    render();
    await banner("Tu turno", "✨");
    if (!first) draw(G.me);
    G.phase = "main"; render(); checkEnd();
  }

  // ---- el bot
  function botTarget(need) {
    const mine = G.me.bf.filter((x) => isCreature(x.c) && !x.dying);
    const lethalFace = !need.creatureOnly && need.kind === "dmg" && G.me.life <= need.n;
    if (lethalFace) return "face";
    const killable = mine.filter((x) => need.kind !== "dmg" || tough(x) <= need.n).sort((a, b) => power(b) - power(a) || b.c.cmc - a.c.cmc);
    if (G.level === "easy") return need.creatureOnly ? killable[rnd(killable.length)] || null : rnd(2) ? "face" : killable[0] || "face";
    if (killable[0] && (need.creatureOnly || power(killable[0]) >= 2 || G.level === "hard")) return killable[0];
    return need.creatureOnly ? null : "face";
  }
  function botBlocks(attackers) {
    const blocks = new Map(), free = G.op.bf.filter((x) => isCreature(x.c) && !x.tapped && !x.dying);
    const incoming = attackers.reduce((t, a) => t + power(a), 0);
    for (const a of [...attackers].sort((p, q) => power(q) - power(p))) {
      const ok = free.filter((b) => canBlock(b, a));
      let b = null;
      if (G.level === "easy") b = rnd(3) === 0 ? ok[0] : null;
      else {
        b = ok.find((x) => power(x) >= tough(a) && tough(x) > power(a)) || (G.level === "hard" ? ok.find((x) => tough(x) > power(a)) : null);  // mata y vive / aguanta
        if (!b && incoming >= G.op.life) b = ok.sort((p, q) => power(p) - power(q))[0];  // bloqueo de emergencia
      }
      if (b) { blocks.set(a, b); free.splice(free.indexOf(b), 1); }
    }
    return blocks;
  }
  async function botTurn(first) {
    if (checkEnd()) return;
    const op = G.op;
    G.turn++; G.active = "op"; G.phase = "draw"; G.mode = null; op.landDrop = false;
    for (const x of op.bf) { x.tapped = false; x.sick = false; x.dmg = 0; }
    for (const x of G.me.bf) x.dmg = 0;
    render();
    await banner(`Turno de ${op.name}`, op.avatar);
    if (!first) { draw(op); render(); await sleep(350); }
    if (checkEnd()) return;
    G.phase = "main"; render();
    // Tierra: la que más colores nuevos le da
    const lands = op.hand.filter(isLand);
    if (lands.length) {
      const have = new Set(op.bf.filter((x) => isLand(x.c)).flatMap((x) => [...produces(x.c)]));
      const land = lands.sort((a, b) => [...produces(b)].filter((c) => !have.has(c)).length - [...produces(a)].filter((c) => !have.has(c)).length)[0];
      op.hand.splice(op.hand.indexOf(land), 1); op.bf.push({ uid: land.uid, c: land, tapped: false, sick: false, dmg: 0 }); op.landDrop = true;
      S.land(); log(`${op.name} juega ${land.name}.`); render(); await sleep(500);
    }
    // Lanzar: de lo más caro a lo más barato (fácil: al azar), quitando antes tus amenazas
    for (let guard = 0; guard < 8 && !G.over; guard++) {
      let can = op.hand.filter((c) => !isLand(c) && payPlan(op, c));
      if (!can.length) break;
      const useful = (c) => isCreature(c) || /artifact|enchantment/i.test(c.type || "") || [DMG, KILL, DRAW, GAIN, SHRINK, BOUNCE, TOKENS].some((rx) => rx.test(c.text || ""));
      can = can.filter(useful);
      if (!can.length) break;
      const removalFirst = G.level !== "easy" && G.me.bf.some((x) => isCreature(x.c) && power(x) >= 3);
      const pick = G.level === "easy" ? can[rnd(can.length)] : can.sort((a, b) => (removalFirst ? (KILL.test(b.text || "") || DMG.test(b.text || "")) - (KILL.test(a.text || "") || DMG.test(a.text || "")) : 0) || b.cmc - a.cmc)[0];
      const need = needsTarget(pick);
      if (need && !isCreature(pick) && need.creatureOnly && botTarget(need) == null) { op.hand.splice(op.hand.indexOf(pick), 1); op.hand.push(pick); if (can.length === 1) break; continue; }
      payPlan(op, pick).forEach((l) => (l.tapped = true));
      op.hand.splice(op.hand.indexOf(pick), 1);
      await showCast(op, pick);
      log(`${op.name} lanza ${pick.name}.`);
      if (isCreature(pick) || /artifact|enchantment|planeswalker|battle/i.test(pick.type || "")) { op.bf.push({ uid: pick.uid, c: pick, tapped: false, sick: true, dmg: 0 }); render(); if (etbText(pick)) resolve(op, G.me, pick, true); }
      else { resolve(op, G.me, pick, false); op.gy.push(pick); }
      render(); await sleep(400);
      if (checkEnd()) return;
    }
    // Ataque
    const ready = op.bf.filter(canAttack), blockers = G.me.bf.filter((x) => isCreature(x.c) && !x.tapped);
    const best = Math.max(0, ...blockers.map(power));
    const total = ready.reduce((t, x) => t + power(x), 0);
    let attackers;
    if (G.level === "easy") attackers = ready.filter(() => rnd(10) < 7);
    else if (total >= G.me.life && blockers.length < ready.length) attackers = ready;  // letal aunque bloquees alguna
    else attackers = ready.filter((x) => power(x) > 0 && (tough(x) > best || !blockers.length || kw(x.c, "flying") && !blockers.some((b) => kw(b.c, "flying") || kw(b.c, "reach"))));
    if (attackers.length) {
      G.phase = "combat";
      attackers.forEach((x) => G.attackers.add(x));
      S.attack(); log(`${op.name} ataca con ${attackers.map((x) => x.c.name).join(", ")}.`);
      if (G.me.bf.some((x) => isCreature(x.c) && !x.tapped)) {
        G.mode = "block"; G.blocks = new Map(); G.sel = null; render();
        await new Promise((r) => (G.blockDone = r));
      }
      await combat(op, G.me, attackers);
      if (checkEnd()) return;
    }
    G.phase = "end"; discardDown(op); render(); await sleep(300);
    myTurn(false);
  }

  return { lobby };
})();

views.versus = () => Versus.lobby();
