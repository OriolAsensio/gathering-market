"use strict";
/* Mesa de pruebas de un mazo: mano de prueba (con mulligan de Londres), probabilidades (hipergeométrica).
 * Usa los datos de juego de las cartas (tipo, coste, texto; fuerza y resistencia de Scryfall).
 * Usa lo de app.js: openSheet, closeSheet, api, esc, $, toast, ico, store. */

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
    try { cache = JSON.parse(localStorage.getItem("ptCache2") || "{}"); } catch { /* sin almacenamiento */ }
    const missing = [...new Set(names.map((n) => n.toLowerCase()))].filter((n) => !(n in cache));
    for (let i = 0; i < missing.length; i += 75) {
      try {
        const r = await fetch("https://api.scryfall.com/cards/collection", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ identifiers: missing.slice(i, i + 75).map((name) => ({ name })) }) });
        const j = await r.json();
        for (const c of j.data || []) {
          const f = c.power != null ? c : (c.card_faces || [])[0] || {};
          // "*" (Tarmogoyf, Nethergoyf…): sin número fijo → se estima por el coste, como las que no tienen datos
          const v = f.power != null && /^\d+$/.test(f.power) && /^\d+$/.test(f.toughness) ? [+f.power, +f.toughness] : null;
          cache[c.name.toLowerCase()] = v;
          cache[c.name.split(" // ")[0].toLowerCase()] = v;
        }
      } catch { break; }  // sin internet: se estima por el coste
    }
    try { localStorage.setItem("ptCache2", JSON.stringify(cache)); } catch { /* lleno */ }
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

  return { handSheet, probSheet, atLeast, loadDeck, shuffle, isLand, isCreature };
})();
