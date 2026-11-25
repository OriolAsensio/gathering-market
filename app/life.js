"use strict";
/* Contador de vidas (pestaña "Vidas"), al estilo de LifeTap: perfiles con nombre, color y foto, partidas de 2 a 6 jugadores,
 * veneno, daño de comandante, dados y moneda. Los perfiles (con sus fotos) se guardan SOLO en este móvil (localStorage):
 * no van a la nube, para no gastar el espacio gratis de Supabase. Usa lo de app.js: views, $, esc, toast, store, openSheet. */

const Life = (() => {
  const COLORS = ["#b8862b", "#2f6fb0", "#3c8c4a", "#a8322d", "#6b4aa0", "#2a2a2a", "#c25b8e", "#1f8a8a"];
  const PRESETS = [["Estándar / Modern / Pauper", 20], ["Commander", 40], ["Duel Commander", 20], ["Brawl", 25], ["Two-Headed Giant", 30], ["Oathbreaker", 20]];
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast("No hay espacio en el móvil para guardar esto"); return false; } };
  const profiles = () => load("lifeProfiles", []);
  let game = load("lifeGame", null);
  let wake = null;

  /** Foto del perfil: se reduce a 320 px (JPEG) para que ocupe poco. */
  const shrink = (file) => new Promise((ok, ko) => {
    const im = new Image();
    im.onload = () => {
      const s = 320 / Math.max(im.width, im.height), c = document.createElement("canvas");
      c.width = Math.round(im.width * Math.min(1, s)); c.height = Math.round(im.height * Math.min(1, s));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      ok(c.toDataURL("image/jpeg", 0.8));
      URL.revokeObjectURL(im.src);
    };
    im.onerror = ko;
    im.src = URL.createObjectURL(file);
  });

  function view() {
    const v = $("#view"), ps = profiles();
    v.innerHTML = `<h2>❤️ Contador de vidas</h2>
      ${game ? `<button class="btn block primary" id="lf-resume">▶️ Seguir la partida (${game.players.length} jugadores)</button>` : ""}
      <h2>Nueva partida</h2>
      <div class="field"><label>Jugadores</label><div class="seg" id="lf-n">${[2, 3, 4, 5, 6].map((n) => `<button data-n="${n}" class="${n === (+store("lifeN") || 2) ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <div class="field"><label>Vidas iniciales</label><div class="seg" id="lf-life">${PRESETS.map(([n, l], i) => `<button data-p="${i}" class="${i === (+store("lifePreset") || 0) ? "on" : ""}">${l} <span class="sub">${esc(n)}</span></button>`).join("")}</div></div>
      <div class="field"><label>Quién juega</label><div id="lf-seats"></div></div>
      <button class="btn block primary" id="lf-start">⚔️ Empezar</button>
      <h2>Perfiles</h2>
      <div class="hint">Tu nombre, tu color y tu foto (o la de tus amigos) para la mesa. Se guardan solo en este móvil.</div>
      <div class="list">${ps.map((p) => `<button class="item" data-edit="${p.id}"><span class="lf-avatar" style="background:${p.color}${p.img ? `;background-image:url(${p.img})` : ""}"></span>
        <div class="item-main"><div class="item-title">${esc(p.name)}</div><div class="item-meta">${p.wins || 0} victorias · ${p.games || 0} partidas</div></div></button>`).join("")}</div>
      <button class="btn block" id="lf-new">➕ Nuevo perfil</button>
      <h2>Herramientas</h2>
      <div class="row-btns"><button class="btn" id="lf-d6">🎲 Dado de 6</button><button class="btn" id="lf-d20">🎲 Dado de 20</button><button class="btn" id="lf-coin">🪙 Moneda</button></div>
      <div class="pf-mid" id="lf-roll"></div>`;
    const n = () => +store("lifeN") || 2;
    const seats = () => {
      const sel = load("lifeSeats", []);
      $("#lf-seats").innerHTML = Array.from({ length: n() }, (_, i) => `<select class="search deck-select" data-seat="${i}" style="margin-bottom:6px">
        <option value="">Jugador ${i + 1}</option>${ps.map((p) => `<option value="${p.id}" ${sel[i] === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`).join("");
      v.querySelectorAll("[data-seat]").forEach((s) => (s.onchange = () => { const a = load("lifeSeats", []); a[+s.dataset.seat] = s.value; save("lifeSeats", a); }));
    };
    seats();
    v.querySelectorAll("#lf-n button").forEach((b) => (b.onclick = () => { store("lifeN", b.dataset.n); view(); }));
    v.querySelectorAll("#lf-life button").forEach((b) => (b.onclick = () => { store("lifePreset", b.dataset.p); view(); }));
    $("#lf-resume")?.addEventListener("click", table);
    $("#lf-start").onclick = () => {
      const sel = load("lifeSeats", []), start = PRESETS[+store("lifePreset") || 0][1];
      game = { start, players: Array.from({ length: n() }, (_, i) => {
        const p = ps.find((x) => x.id === sel[i]);
        return { pid: p?.id || null, name: p?.name || `Jugador ${i + 1}`, color: p?.color || COLORS[i % COLORS.length], life: start, poison: 0, cmd: {}, delta: 0 };
      }) };
      save("lifeGame", game);
      table();
    };
    $("#lf-new").onclick = () => editProfile(null);
    v.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editProfile(b.dataset.edit)));
    const roll = (txt) => { $("#lf-roll").textContent = txt; navigator.vibrate?.(30); };
    $("#lf-d6").onclick = () => roll(`🎲 ${1 + rnd(6)}`);
    $("#lf-d20").onclick = () => roll(`🎲 ${1 + rnd(20)}`);
    $("#lf-coin").onclick = () => roll(rnd(2) ? "🪙 Cara" : "🪙 Cruz");
  }
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };

  function editProfile(id) {
    const ps = profiles(), p = ps.find((x) => x.id === id) || { id: `p${Date.now()}`, name: "", color: COLORS[ps.length % COLORS.length], img: null };
    const body = openSheet(`<h3>${id ? "Editar perfil" : "Nuevo perfil"}</h3>
      <div class="lf-preview" id="lf-pv"></div>
      <div class="field"><label>Nombre</label><input class="search" id="lf-name" maxlength="20" value="${esc(p.name)}" placeholder="Tu nombre de jugador"></div>
      <div class="field"><label>Color</label><div class="seg">${COLORS.map((c) => `<button class="lf-swatch" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div></div>
      <label class="btn block" for="lf-img">📷 Elegir foto</label><input type="file" id="lf-img" accept="image/*" hidden>
      ${p.img ? `<button class="btn block" id="lf-noimg" style="margin-top:8px">Quitar la foto</button>` : ""}
      <div class="row-btns"><button class="btn primary" id="lf-save">Guardar</button>${id ? `<button class="btn" id="lf-del">Borrar</button>` : ""}</div>`);
    const paint = () => { $("#lf-pv", body).style.cssText = `background:${p.color};${p.img ? `background-image:url(${p.img})` : ""}`; $("#lf-pv", body).textContent = p.name || ""; };
    paint();
    $("#lf-name", body).oninput = (e) => { p.name = e.target.value; paint(); };
    body.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { p.color = b.dataset.c; paint(); }));
    $("#lf-img", body).onchange = async (e) => { const f = e.target.files[0]; if (f) { p.img = await shrink(f); paint(); } };
    $("#lf-noimg", body)?.addEventListener("click", () => { p.img = null; paint(); });
    $("#lf-save", body).onclick = () => {
      p.name = p.name.trim() || "Jugador";
      const all = profiles().filter((x) => x.id !== p.id);
      if (save("lifeProfiles", [...all, p])) { closeSheet(); view(); }
    };
    $("#lf-del", body)?.addEventListener("click", () => {
      if (!confirm(t(`¿Borrar el perfil de ${p.name}?`))) return;
      save("lifeProfiles", profiles().filter((x) => x.id !== p.id)); closeSheet(); view();
    });
  }

  // ---- la mesa: pantalla completa, un panel por jugador (los de enfrente, girados)
  function table() {
    document.querySelector(".lf-table")?.remove();
    const ps = profiles(), n = game.players.length;
    const el = document.createElement("div");
    el.className = `lf-table n${n}`;
    document.body.appendChild(el);
    navigator.wakeLock?.request("screen").then((w) => (wake = w)).catch(() => {});
    const timers = new Map();
    const paint = () => {
      el.innerHTML = `${game.players.map((pl, i) => {
        const prof = ps.find((x) => x.id === pl.pid), img = prof?.img;
        const flip = n === 2 ? i === 0 : n >= 3 && i < Math.ceil(n / 2);
        const dead = pl.life <= 0 || pl.poison >= 10 || Object.values(pl.cmd).some((v) => v >= 21);
        return `<div class="lf-seat ${flip ? "flip" : ""} ${dead ? "dead" : ""}" style="background-color:${pl.color};${img ? `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)),url(${img})` : ""}">
          <button class="lf-tap up" data-i="${i}" data-d="1" aria-label="Más una vida">+</button>
          <button class="lf-tap down" data-i="${i}" data-d="-1" aria-label="Menos una vida">−</button>
          <div class="lf-name">${esc(pl.name)}</div>
          <div class="lf-life">${pl.life}</div>
          ${pl.delta ? `<div class="lf-delta">${pl.delta > 0 ? "+" : ""}${pl.delta}</div>` : ""}
          <div class="lf-extra">${pl.poison ? `☠️ ${pl.poison}` : ""} ${Object.entries(pl.cmd).filter(([, v]) => v).map(([k, v]) => `⚔️${esc(game.players[+k]?.name.slice(0, 6) || "")} ${v}`).join(" ")}</div>
          <button class="lf-more" data-more="${i}" aria-label="Más contadores">⋯</button>
        </div>`;
      }).join("")}
      <div class="lf-bar"><button data-act="exit" aria-label="Salir">✕</button><button data-act="d20" aria-label="Dado">🎲</button><button data-act="first" aria-label="Quién empieza">👆</button><button data-act="reset" aria-label="Reiniciar">↺</button></div>`;
      el.querySelectorAll(".lf-tap").forEach((b) => (b.onclick = () => change(+b.dataset.i, +b.dataset.d)));
      el.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => counters(+b.dataset.more)));
      el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => act(b.dataset.act)));
    };
    const change = (i, d) => {
      const pl = game.players[i];
      pl.life += d; pl.delta += d;
      clearTimeout(timers.get(i));
      timers.set(i, setTimeout(() => { pl.delta = 0; save("lifeGame", game); paint(); }, 1800));  // el "-3" se junta y desaparece
      navigator.vibrate?.(8);
      save("lifeGame", game); paint();
    };
    const act = (a) => {
      if (a === "exit") { el.remove(); wake?.release?.().catch(() => {}); wake = null; view(); return; }
      if (a === "d20") return toast(`🎲 ${1 + rnd(20)}`);
      if (a === "first") return toast(`Empieza ${game.players[rnd(game.players.length)].name}`);
      if (a === "reset") {
        const alive = game.players.filter((p) => p.life > 0 && p.poison < 10);
        if (!confirm(t("¿Empezar otra partida con los mismos jugadores?"))) return;
        // Se apunta quién ha ganado (si solo queda uno) en su perfil
        if (alive.length === 1 && alive[0].pid) { const all = profiles(); const w = all.find((x) => x.id === alive[0].pid); if (w) w.wins = (w.wins || 0) + 1; save("lifeProfiles", all); }
        const all = profiles();
        for (const p of game.players) { const x = all.find((y) => y.id === p.pid); if (x) x.games = (x.games || 0) + 1; }
        save("lifeProfiles", all);
        for (const p of game.players) Object.assign(p, { life: game.start, poison: 0, cmd: {}, delta: 0 });
        save("lifeGame", game); paint();
      }
    };
    const counters = (i) => {
      const pl = game.players[i];
      const body = openSheet(`<h3>${esc(pl.name)}</h3>
        <div class="field"><label>☠️ Veneno (10 = pierde)</label><div class="lf-step"><button data-k="poison" data-d="-1">−</button><b>${pl.poison}</b><button data-k="poison" data-d="1">+</button></div></div>
        ${game.players.map((o, j) => (j === i ? "" : `<div class="field"><label>⚔️ Daño de comandante de ${esc(o.name)} (21 = pierde)</label><div class="lf-step"><button data-k="cmd" data-j="${j}" data-d="-1">−</button><b>${pl.cmd[j] || 0}</b><button data-k="cmd" data-j="${j}" data-d="1">+</button></div></div>`)).join("")}
        <div class="field"><label>Vidas</label><div class="lf-step"><button data-k="life" data-d="-5">−5</button><b>${pl.life}</b><button data-k="life" data-d="5">+5</button></div></div>`);
      body.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
        const d = +b.dataset.d;
        if (b.dataset.k === "poison") pl.poison = Math.max(0, pl.poison + d);
        else if (b.dataset.k === "cmd") { const j = b.dataset.j; pl.cmd[j] = Math.max(0, (pl.cmd[j] || 0) + d); pl.life -= d; }  // el daño de comandante también quita vidas
        else pl.life += d;
        save("lifeGame", game); paint(); counters(i);
      }));
    };
    paint();
  }

  return { view };
})();

views.life = () => Life.view();
