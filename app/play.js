"use strict";
/* Mesa de pruebas de un mazo: mano de prueba (con mulligan de Londres), probabilidades (hipergeométrica) y una partida de
 * práctica contra un bot. Es una versión simplificada de Magic: el maná cuenta tierras sin mirar colores, las criaturas
 * combaten por fuerza y resistencia y de los hechizos solo se entienden los efectos más comunes (daño, destruir, robar,
 * ganar vidas). Sirve para ver cómo sale el mazo, no para jugar una partida de reglas completas.
 * Usa lo de app.js: openSheet, closeSheet, api, esc, $, toast, ico, store. */

// Rivales: de momento Uris; más adelante, otros personajes con su mazo y su forma de jugar.
const BOTS = [
  { id: "uris", name: "Uris", avatar: "🧙", blurb: "Tu primer rival. Juega un mazo del meta de tu formato y ataca cuando le sale a cuenta.", deck: "meta" },
];

const Play = (() => {
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const isLand = (c) => /\bland\b/i.test(c.type || "");
  const isCreature = (c) => /creature/i.test(c.type || "");
  let uid = 0;

  /** Las cartas del main con sus datos de juego (tipo, coste, texto; fuerza/resistencia de Scryfall si hay internet). */
  async function loadDeck(cards) {
    const main = cards.filter((c) => !c.side);
    const info = await api(`/api/cardinfo?names=${encodeURIComponent(main.map((c) => c.name).join("|"))}`);
    const by = new Map(info.map((x) => [x.name.toLowerCase(), x]));
    const pt = await powerToughness(main.map((c) => c.name));
    const out = [];
    for (const c of main) {
      const x = by.get(c.name.toLowerCase()) || { name: c.name, type: "", cmc: 0, text: "" };
      const [p, t] = pt.get(c.name.toLowerCase()) || [Math.max(1, Math.round(x.cmc)), Math.max(1, Math.round(x.cmc))];
      for (let i = 0; i < c.qty; i++) out.push({ ...x, name: c.name, image: c.image || x.image, power: p, toughness: t });
    }
    return out;
  }
  // Fuerza y resistencia: no van en el paquete diario; se piden a Scryfall (75 por petición) y se guardan en el móvil.
  async function powerToughness(names) {
    const out = new Map();
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem("ptCache") || "{}"); } catch { /* sin almacenamiento */ }
    const missing = [...new Set(names.map((n) => n.toLowerCase()))].filter((n) => !(n in cache));
    for (let i = 0; i < missing.length; i += 75) {
      try {
        const r = await fetch("https://api.scryfall.com/cards/collection", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ identifiers: missing.slice(i, i + 75).map((name) => ({ name })) }) });
        const j = await r.json();
        for (const c of j.data || []) {
          const f = c.power != null ? c : (c.card_faces || [])[0] || {};
          const v = f.power != null ? [parseInt(f.power, 10) || 0, parseInt(f.toughness, 10) || 1] : null;
          cache[c.name.toLowerCase()] = v;
          cache[c.name.split(" // ")[0].toLowerCase()] = v;
        }
      } catch { break; }  // sin internet: se estima por el coste
    }
    try { localStorage.setItem("ptCache", JSON.stringify(cache)); } catch { /* lleno */ }
    for (const n of names) { const v = cache[n.toLowerCase()]; if (v) out.set(n.toLowerCase(), v); }
    return out;
  }

  // ---------------------------------------------------------------- probabilidades (hipergeométrica)
  const lnF = [0];
  const lnFact = (n) => { for (let i = lnF.length; i <= n; i++) lnF[i] = lnF[i - 1] + Math.log(i); return lnF[n]; };
  const lnC = (n, k) => (k < 0 || k > n ? -Infinity : lnFact(n) - lnFact(k) - lnFact(n - k));
  /** P(al menos k de las K copias entre n cartas robadas de un mazo de N). */
  function atLeast(N, K, n, k) {
    n = Math.min(n, N);
    let p = 0;
    for (let i = 0; i < k; i++) p += Math.exp(lnC(K, i) + lnC(N - K, n - i) - lnC(N, n));
    return Math.max(0, Math.min(1, 1 - p));
  }
  const exactly = (N, K, n, k) => Math.exp(lnC(K, k) + lnC(N - Math.min(K, N), Math.min(n, N) - k) - lnC(N, Math.min(n, N)));
  const pc = (p) => `${(p * 100).toFixed(p > 0.995 || p < 0.005 ? 0 : 1).replace(".", ",")}%`;

  async function probSheet(d) {
    const body = openSheet(`<h3>Probabilidades · ${esc(d.archetype)}</h3>${skeleton(3)}`);
    const deck = await loadDeck(d.cards);
    const N = deck.length, lands = deck.filter(isLand).length;
    const groups = [...new Map(deck.map((c) => [c.name, c])).values()].map((c) => ({ c, K: deck.filter((x) => x.name === c.name).length }))
      .filter((g) => !isLand(g.c)).sort((a, b) => b.K - a.K || a.c.cmc - b.c.cmc);
    let onDraw = store("probDraw") === "1";
    const draw = () => {
      const seen = (turn) => 7 + turn - (onDraw ? 0 : 1);  // cartas vistas al empezar tu turno N
      body.innerHTML = `<h3>Probabilidades · ${esc(d.archetype)}</h3>
        <div class="hint">${N} cartas en el main, ${lands} tierras. Probabilidad de tener cada carta (al menos una copia) en la mano inicial y al llegar a cada turno, sin contar mulligans.</div>
        <div class="seg" id="pb-who"><button data-d="0" class="${onDraw ? "" : "on"}">Empiezo yo</button><button data-d="1" class="${onDraw ? "on" : ""}">Empieza el rival (robo)</button></div>
        <h2>Tierras</h2>
        <table class="ptable"><tr><th></th><th>%</th></tr>
          <tr><td>Mano inicial con 2-4 tierras</td><td>${pc([2, 3, 4].reduce((a, k) => a + exactly(N, lands, 7, k), 0))}</td></tr>
          <tr><td>Mano inicial con 0-1 tierras</td><td>${pc(exactly(N, lands, 7, 0) + exactly(N, lands, 7, 1))}</td></tr>
          <tr><td>Mano inicial con 5 o más</td><td>${pc(atLeast(N, lands, 7, 5))}</td></tr>
          ${[2, 3, 4, 5].map((t) => `<tr><td>${t} tierras en el turno ${t}</td><td>${pc(atLeast(N, lands, seen(t), t))}</td></tr>`).join("")}
        </table>
        <h2>Cada carta</h2>
        <table class="ptable"><tr><th>Carta</th><th>Mano</th><th>T2</th><th>T3</th><th>T4</th></tr>
          ${groups.map((g) => `<tr><td>${g.K}× ${esc(g.c.name)}</td>${[0, 2, 3, 4].map((t) => `<td>${pc(atLeast(N, g.K, t ? seen(t) : 7, 1))}</td>`).join("")}</tr>`).join("")}
        </table>
        <h2>Calcula tú</h2>
        <div class="field"><label>Carta</label><select class="search deck-select" id="pb-card">${[{ c: { name: "Tierras" }, K: lands }, ...groups].map((g, i) => `<option value="${i}">${g.K}× ${esc(g.c.name)}</option>`).join("")}</select></div>
        <div class="field" style="flex-direction:row;gap:8px;align-items:center;flex-wrap:wrap">Al menos <input class="search" id="pb-k" type="number" min="1" max="4" value="1" style="width:70px"> en el turno <input class="search" id="pb-t" type="number" min="0" max="20" value="3" style="width:70px"> <span class="sub">(0 = mano inicial)</span></div>
        <div class="stat" style="margin-top:8px"><b id="pb-out">—</b><span>Probabilidad</span></div>`;
      body.querySelectorAll("#pb-who button").forEach((b) => (b.onclick = () => { onDraw = b.dataset.d === "1"; store("probDraw", onDraw ? "1" : "0"); draw(); }));
      const all = [{ K: lands }, ...groups];
      const calc = () => {
        const g = all[+$("#pb-card", body).value], k = Math.max(1, +$("#pb-k", body).value || 1), t = Math.max(0, +$("#pb-t", body).value || 0);
        $("#pb-out", body).textContent = pc(atLeast(N, g.K, t ? seen(t) : 7, k));
      };
      body.querySelectorAll("#pb-card, #pb-k, #pb-t").forEach((el) => (el.oninput = calc));
      calc();
    };
    draw();
  }

  // ---------------------------------------------------------------- mano de prueba
  async function handSheet(d) {
    const body = openSheet(`<h3>Mano de prueba · ${esc(d.archetype)}</h3>${skeleton(2)}`);
    const deck = await loadDeck(d.cards);
    let lib, hand, mull, bottom;
    const fresh = (m = 0) => { lib = shuffle(deck.map((c) => ({ ...c, id: ++uid }))); hand = lib.splice(0, 7); mull = m; bottom = m; };
    fresh();
    const draw = () => {
      const lands = hand.filter(isLand).length;
      body.innerHTML = `<h3>Mano de prueba · ${esc(d.archetype)}</h3>
        <div class="hint">${bottom ? `Mulligan: toca ${bottom === 1 ? "1 carta" : `${bottom} cartas`} para ponerla${bottom === 1 ? "" : "s"} debajo de la biblioteca.` : `Mano de ${hand.length} · ${lands} ${lands === 1 ? "tierra" : "tierras"} · biblioteca ${lib.length}${mull ? ` · ${mull} mulligan${mull > 1 ? "s" : ""}` : ""}`}</div>
        <div class="grid">${hand.map((c) => `<button class="gcard" data-h="${c.id}"><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy"><div class="why">${esc(c.name)}</div></button>`).join("")}</div>
        <div class="row-btns"><button class="btn" id="th-mull" ${hand.length <= 1 ? "disabled" : ""}>Mulligan</button><button class="btn" id="th-draw" ${bottom || !lib.length ? "disabled" : ""}>Robar carta</button><button class="btn primary" id="th-new">Nueva mano</button></div>`;
      body.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => {
        if (!bottom) return;
        const i = hand.findIndex((c) => c.id === +b.dataset.h);
        lib.push(...hand.splice(i, 1)); bottom--; draw();
      }));
      $("#th-mull", body).onclick = () => { fresh(mull + 1); draw(); };
      $("#th-draw", body).onclick = () => { hand.push(lib.shift()); draw(); };
      $("#th-new", body).onclick = () => { fresh(); draw(); };
    };
    draw();
  }

  // ---------------------------------------------------------------- partida contra el bot
  const dmgRe = /deals? (\d+) damage to (any target|target creature or player|target player or planeswalker|target opponent|each opponent|target creature)/i;
  const killRe = /(destroy|exile) target (?:nonland |non-?black |non-?artifact |attacking |tapped )?creature/i;
  const drawRe = /draws? (a|one|two|three|\d+) cards?/i;
  const lifeRe = /you gain (\d+) life/i;
  const NUM = { a: 1, one: 1, two: 2, three: 3 };

  function newSide(name, deck) {
    const lib = shuffle(deck.map((c) => ({ ...c, id: ++uid })));
    return { name, life: 20, lib, hand: lib.splice(0, 7), field: [], grave: [], landPlayed: false, lost: false };
  }
  const untappedLands = (s) => s.field.filter((x) => isLand(x.c) && !x.tapped);
  function pay(s, cmc) {
    const lands = untappedLands(s);
    if (lands.length < cmc) return false;
    lands.slice(0, Math.ceil(cmc)).forEach((x) => (x.tapped = true));
    return true;
  }
  const verb = (s, tu, el) => (s.name === "Tú" ? tu : `${s.name} ${el}`);  // "Juegas X" / "Uris juega X"
  const toWho = (s) => (s.name === "Tú" ? "ti" : s.name);
  function drawCard(s, g) {
    if (!s.lib.length) { s.lost = true; g.log(`${verb(s, "No puedes robar: pierdes", "no puede robar: pierde")}.`); return; }
    s.hand.push(s.lib.shift());
  }

  async function gameSheet(d) {
    const body = openSheet(`<h3>Partida de prueba</h3>${skeleton(2)}`);
    const bot = BOTS[0];
    const fmt = d.format || "PAU";
    // Mazo del bot: uno del meta del mismo formato (el que más criaturas lleve de entre los 8 más jugados), o del de Pauper
    const metas = (await api("/api/decks")).filter((x) => x.format === fmt);
    const pickFrom = metas.length ? metas : (await api("/api/decks")).filter((x) => x.format === "PAU");
    const choice = pickFrom.sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, 8)[rnd(Math.min(8, pickFrom.length))];
    if (!choice) { body.innerHTML = `<div class="empty"><strong>No hay mazos para el rival</strong>Hacen falta los mazos del meta (se descargan con internet).</div>`; return; }
    const botList = await api(`/api/deck?id=${encodeURIComponent(choice.id)}`);
    const [mine, theirs] = await Promise.all([loadDeck(d.cards), loadDeck(botList.cards)]);
    const log = [];
    const g = { log: (s) => log.unshift(s), turn: 1, active: "you", phase: "main", attackers: new Set() };
    const you = newSide("Tú", mine), them = newSide(bot.name, theirs);
    const onPlay = rnd(2) === 0;
    g.active = onPlay ? "you" : "bot";
    g.log(`Partida contra ${bot.name} (${choice.archetype}). ${onPlay ? "Empiezas tú." : `Empieza ${bot.name}.`}`);
    const over = () => you.lost || them.lost || you.life <= 0 || them.life <= 0;
    const winner = () => (you.life <= 0 || you.lost ? bot.name : "Tú");

    // Efectos sencillos de un hechizo (o de una criatura al entrar): daño, destruir, robar, ganar vidas
    function resolve(src, me, foe, c, chooseTarget) {
      const t = c.text || "";
      let m = dmgRe.exec(t);
      if (m) {
        const n = +m[1], toCreature = /creature/i.test(m[2]) && !/player|any/i.test(m[2]);
        const target = chooseTarget(n, toCreature);
        if (target === "face") { foe.life -= n; g.log(`${c.name} hace ${n} de daño a ${toWho(foe)}.`); }
        else if (target) { target.dmg = (target.dmg || 0) + n; g.log(`${c.name} hace ${n} de daño a ${target.c.name}.`); }
      }
      m = killRe.exec(t);
      if (m) {
        const target = chooseTarget(99, true);
        if (target && target !== "face") { target.dmg = 99; g.log(`${c.name} quita ${target.c.name}.`); }
      }
      m = drawRe.exec(t);
      if (m && !/each player|target player draws/i.test(t)) { const n = NUM[m[1].toLowerCase()] || +m[1] || 1; for (let i = 0; i < n; i++) drawCard(me, g); g.log(`${verb(me, "Robas", "roba")} ${n}.`); }
      m = lifeRe.exec(t);
      if (m) { me.life += +m[1]; g.log(`${verb(me, "Ganas", "gana")} ${m[1]} vidas.`); }
      cleanup();
    }
    function cleanup() {
      for (const s of [you, them]) {
        for (const x of [...s.field]) if (isCreature(x.c) && (x.dmg || 0) >= x.c.toughness) { s.field.splice(s.field.indexOf(x), 1); s.grave.push(x.c); g.log(`${x.c.name} muere.`); }
      }
    }
    function cast(me, foe, card, chooseTarget) {
      if (isLand(card)) {
        if (me.landPlayed) return false;
        me.landPlayed = true;
        me.hand.splice(me.hand.indexOf(card), 1);
        me.field.push({ c: card, tapped: false, sick: false, id: card.id });
        return true;
      }
      if (!pay(me, card.cmc)) return false;
      me.hand.splice(me.hand.indexOf(card), 1);
      if (isCreature(card) || /artifact|enchantment|planeswalker|battle/i.test(card.type)) {
        me.field.push({ c: card, tapped: false, sick: true, id: card.id, dmg: 0 });
        g.log(`${verb(me, "Juegas", "juega")} ${card.name}.`);
        if (/enters|when .* enters the battlefield/i.test(card.text || "")) resolve(card, me, foe, card, chooseTarget);
      } else {
        g.log(`${verb(me, "Lanzas", "lanza")} ${card.name}.`);
        resolve(card, me, foe, card, chooseTarget);
        me.grave.push(card);
      }
      return true;
    }
    function startTurn(s, first) {
      s.landPlayed = false;
      for (const x of s.field) { x.tapped = false; x.sick = false; x.dmg = 0; }
      if (!first) drawCard(s, g);
    }
    function combat(att, def, attackers, blocks) {
      for (const a of attackers) {
        a.tapped = true;
        const b = blocks.get(a);
        if (b) {
          a.dmg = (a.dmg || 0) + b.c.power; b.dmg = (b.dmg || 0) + a.c.power;
          g.log(`${b.c.name} bloquea a ${a.c.name}.`);
          if (/trample/i.test(a.c.text || "")) { const over = a.c.power - Math.max(0, b.c.toughness - (b.dmg - a.c.power)); if (over > 0) { def.life -= over; } }
        } else {
          def.life -= a.c.power;
          if (/lifelink/i.test(a.c.text || "")) att.life += a.c.power;
        }
      }
      const total = attackers.filter((a) => !blocks.get(a)).reduce((t, a) => t + a.c.power, 0);
      if (total) g.log(`${verb(att, "Haces", "hace")} ${total} de daño a ${toWho(def)}.`);
      cleanup();
    }

    // ---- el bot: tierra, lo que pueda lanzar (de más caro a más barato), quitar tu mejor criatura, atacar si le compensa
    function botTurn(first) {
      startTurn(them, first);
      if (over()) return;
      const land = them.hand.find(isLand);
      if (land) cast(them, you, land);
      const botTarget = (n, creatureOnly) => {
        const kill = you.field.filter((x) => isCreature(x.c) && x.c.toughness - (x.dmg || 0) <= n).sort((a, b) => b.c.power - a.c.power)[0];
        if (kill && (creatureOnly || kill.c.power >= 3 || you.life > n * 4)) return kill;
        return creatureOnly ? null : "face";
      };
      for (let guard = 0; guard < 10; guard++) {
        const mana = untappedLands(them).length;
        const can = them.hand.filter((c) => !isLand(c) && c.cmc <= mana).sort((a, b) => b.cmc - a.cmc);
        const pick = can.find((c) => isCreature(c) || dmgRe.test(c.text || "") || killRe.test(c.text || "") || drawRe.test(c.text || "")) || can[0];
        if (!pick || !cast(them, you, pick, botTarget)) break;
        if (over()) return;
      }
      // Ataque: con las criaturas que no mueren contra tu mejor bloqueador, o con todo si es letal
      const ready = them.field.filter((x) => isCreature(x.c) && !x.sick && !x.tapped);
      const myBlockers = you.field.filter((x) => isCreature(x.c) && !x.tapped);
      const bestPower = Math.max(0, ...myBlockers.map((x) => x.c.power));
      const lethal = ready.reduce((t, x) => t + x.c.power, 0) >= you.life && myBlockers.length < ready.length;  // aunque bloquees alguna, te mata
      const attackers = lethal ? ready : ready.filter((x) => x.c.toughness > bestPower || !myBlockers.length);
      g.pendingAttack = attackers;
    }
    function endBotTurn() {
      g.turn++;
      g.active = "you";
      startTurn(you, false);
      g.attackers.clear();
    }

    const tapToCast = (card) => {
      if (g.active !== "you" || over()) return;
      const yourTarget = (n, creatureOnly) => {
        const opts = them.field.filter((x) => isCreature(x.c));
        const names = [...(creatureOnly ? [] : [`${bot.name} (jugador)`]), ...opts.map((x) => `${x.c.name} ${x.c.power}/${x.c.toughness}`)];
        if (!names.length) return null;
        const ans = prompt(`${window.t ? t("¿A quién?") : "¿A quién?"}\n${names.map((n2, i) => `${i + 1}. ${n2}`).join("\n")}`, "1");
        const i = (parseInt(ans, 10) || 1) - 1;
        if (!creatureOnly && i === 0) return "face";
        return opts[creatureOnly ? i : i - 1] || null;
      };
      if (!cast(you, them, card, yourTarget)) toast(isLand(card) ? "Ya has jugado una tierra este turno" : "No tienes tierras suficientes sin girar");
      paint();
    };

    function paint() {
      const fieldRow = (s, mine2) => {
        const cards = s.field.slice().sort((a, b) => isLand(a.c) - isLand(b.c));
        return `<div class="pf-row">${cards.map((x) => `<button class="pf-card ${x.tapped ? "tapped" : ""} ${g.attackers.has(x) ? "attacking" : ""} ${x.sick && isCreature(x.c) ? "sick" : ""}" ${mine2 ? `data-f="${x.id}"` : ""}>
          <img src="${esc(x.c.image)}" alt="${esc(x.c.name)}" loading="lazy">${isCreature(x.c) ? `<span class="pt">${x.c.power}/${x.c.toughness - (x.dmg || 0)}</span>` : ""}</button>`).join("") || `<span class="sub">—</span>`}</div>`;
      };
      const pend = g.pendingAttack;
      body.innerHTML = `<div class="pf-head"><span class="pf-bot">${bot.avatar} <b>${bot.name}</b> · ${esc(choice.archetype)}</span><b class="pf-life">${them.life}</b></div>
        <div class="sub">Mano ${them.hand.length} · Biblioteca ${them.lib.length} · Cementerio ${them.grave.length}</div>
        ${fieldRow(them, false)}
        <div class="pf-mid">Turno ${g.turn} · ${over() ? `🏆 Gana ${winner()}` : g.active === "you" ? "Te toca" : `Le toca a ${bot.name}`}</div>
        ${fieldRow(you, true)}
        <div class="pf-head"><span><b>Tú</b> · ${esc(d.archetype)}</span><b class="pf-life">${you.life}</b></div>
        <div class="sub">Biblioteca ${you.lib.length} · Cementerio ${you.grave.length} · Tierras sin girar ${untappedLands(you).length}</div>
        ${pend ? `<div class="warn">${bot.name} ataca con ${pend.map((x) => `${esc(x.c.name)} (${x.c.power}/${x.c.toughness})`).join(", ")}. Elige quién bloquea a quién y pulsa «Recibir el ataque».</div>
          ${pend.map((a, i) => `<div class="field"><label>${esc(a.c.name)}</label><select class="search deck-select" data-blk="${i}"><option value="">Sin bloquear</option>${you.field.filter((x) => isCreature(x.c) && !x.tapped).map((x) => `<option value="${x.id}">${esc(x.c.name)} ${x.c.power}/${x.c.toughness}</option>`).join("")}</select></div>`).join("")}
          <button class="btn block primary" id="pf-take">Recibir el ataque</button>` : ""}
        <h2>Tu mano</h2>
        <div class="pf-row hand">${you.hand.map((c) => `<button class="pf-card" data-hand="${c.id}"><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy"></button>`).join("")}</div>
        <div class="hint">Toca una carta de tu mano para jugarla (gira tierras solas). Toca tus criaturas para elegir con cuáles atacar.</div>
        <div class="row-btns">
          <button class="btn" id="pf-attack" ${g.active !== "you" || over() || pend ? "disabled" : ""}>⚔️ Atacar${g.attackers.size ? ` (${g.attackers.size})` : ""}</button>
          <button class="btn primary" id="pf-end" ${g.active !== "you" || over() || pend ? "disabled" : ""}>Fin del turno</button>
        </div>
        <button class="btn block" id="pf-again" style="margin-top:8px">Nueva partida</button>
        <h2>Lo que ha pasado</h2><div class="pf-log">${log.slice(0, 30).map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
      body.querySelectorAll("[data-hand]").forEach((b) => (b.onclick = () => tapToCast(you.hand.find((c) => c.id === +b.dataset.hand))));
      body.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => {
        const x = you.field.find((y) => y.id === +b.dataset.f);
        if (!x || !isCreature(x.c) || x.tapped || x.sick || g.active !== "you") return;
        g.attackers.has(x) ? g.attackers.delete(x) : g.attackers.add(x);
        paint();
      }));
      $("#pf-attack", body).onclick = () => {
        if (!g.attackers.size) return toast("Toca primero las criaturas que atacan");
        // El bot bloquea si su criatura mata a la tuya y sobrevive, o si no bloquear le mata
        const blocks = new Map(), free = them.field.filter((x) => isCreature(x.c) && !x.tapped);
        const incoming = [...g.attackers].reduce((t, a) => t + a.c.power, 0);
        for (const a of [...g.attackers].sort((p, q) => q.c.power - p.c.power)) {
          let b = free.find((x) => x.c.power >= a.c.toughness && x.c.toughness > a.c.power);
          if (!b && incoming >= them.life) b = free.sort((p, q) => p.c.power - q.c.power)[0];
          if (b) { blocks.set(a, b); free.splice(free.indexOf(b), 1); }
        }
        combat(you, them, [...g.attackers], blocks);
        g.attackers.clear();
        paint();
      };
      $("#pf-end", body).onclick = () => {
        g.active = "bot";
        botTurn(false);
        if (!g.pendingAttack?.length) { g.pendingAttack = null; if (!over()) endBotTurn(); }
        paint();
      };
      $("#pf-take", body)?.addEventListener("click", () => {
        const blocks = new Map();
        body.querySelectorAll("[data-blk]").forEach((sel) => {
          const b = you.field.find((x) => x.id === +sel.value);
          if (b && ![...blocks.values()].includes(b)) blocks.set(g.pendingAttack[+sel.dataset.blk], b);
        });
        combat(them, you, g.pendingAttack, blocks);
        g.pendingAttack = null;
        if (!over()) endBotTurn();
        paint();
      });
      $("#pf-again", body).onclick = () => gameSheet(d);
    }

    if (g.active === "bot") { botTurn(true); if (!g.pendingAttack?.length) { g.pendingAttack = null; endBotTurn(); } }
    else startTurn(you, true);
    paint();
  }

  return { handSheet, probSheet, gameSheet, atLeast };
})();
