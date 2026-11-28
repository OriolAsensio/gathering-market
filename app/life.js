"use strict";
/* Vidas: contador de vidas a pantalla completa, al estilo de LifeTap. Al entrar: "¿Iniciar una nueva partida?".
 * En la mesa, una barra pequeña en el centro: ajustes (jugadores, vidas, cómo se reparte la mesa), dados, quién empieza,
 * reiniciar y salir. Tocar el nombre de un jugador: su perfil (nombre, color e imagen: el arte de una carta de Magic, una foto
 * hecha al momento o de la galería) y sus contadores (veneno, daño de comandante, energía, experiencia).
 * Perfiles y partida se guardan SOLO en este móvil (localStorage), no en la nube: así no se gasta el espacio gratis de Supabase.
 * Usa lo de app.js: $, esc, toast, store, api, openSheet, closeSheet, Sfx, views. */

const Life = (() => {
  const COLORS = ["#b8862b", "#2f6fb0", "#3c8c4a", "#a8322d", "#6b4aa0", "#3a3a3a", "#c25b8e", "#1f8a8a"];
  const LIVES = [20, 25, 30, 40];
  const LAYOUTS = [["face", "Enfrentados"], ["side", "Alrededor"], ["same", "Todos hacia mí"]];
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast("No hay espacio en el móvil para guardar esto"); return false; } };
  const profiles = () => load("lifeProfiles", []);
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const settings = () => ({ n: 2, start: 20, layout: "face", ...load("lifeSettings", {}) });
  let game = load("lifeGame", null), wake = null, el = null;

  // ---- sonidos y vibración (cortos: se pulsan mucho)
  const sfx = {
    up() { Sfx.play([[880, 0, 0.05, "sine", 0.05]]); },
    down() { Sfx.play([[440, 0, 0.06, "triangle", 0.06]]); Sfx.noise(0.04, 2400, 0.03); },
    big(d) { Sfx.play(d > 0 ? [[660, 0, 0.08, "sine", 0.07], [990, 0.06, 0.12, "sine", 0.07]] : [[300, 0, 0.12, "sawtooth", 0.05], [200, 0.05, 0.18, "triangle", 0.06]]); },
    dead() { Sfx.play([[220, 0, 0.3, "sawtooth", 0.06], [165, 0.2, 0.5, "sawtooth", 0.05], [110, 0.45, 0.8, "triangle", 0.07]]); },
    dice() { for (let i = 0; i < 6; i++) setTimeout(() => Sfx.noise(0.05, 1800 + rnd(1500), 0.08, 3), i * 70); },
    pick() { Sfx.play(Sfx.arp([523.3, 659.3, 784, 1046.5], 0.08, 0.4)); },
  };
  const buzz = (ms) => navigator.vibrate?.(ms);

  /** Imagen de perfil: foto reducida a 360 px (JPEG) para que ocupe poco en el móvil. */
  const shrink = (file) => new Promise((ok, ko) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, 360 / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      ok(c.toDataURL("image/jpeg", 0.8)); URL.revokeObjectURL(im.src);
    };
    im.onerror = ko; im.src = URL.createObjectURL(file);
  });
  // Arte de una carta (Scryfall "art_crop": solo la ilustración)
  const artOf = (img) => String(img || "").replace("/normal/", "/art_crop/").replace("/large/", "/art_crop/");

  function newGame(keepSeats = true) {
    const s = settings(), ps = profiles(), old = game?.players || [];
    // monarch / initiative: índice del jugador que lo tiene (o null); day: "day" | "night" | null; turn: número de turno
    game = { start: s.start, layout: s.layout, started: Date.now(), turn: 1, monarch: null, initiative: null, day: null, players: Array.from({ length: s.n }, (_, i) => {
      const prev = keepSeats ? old[i] : null, p = ps.find((x) => x.id === prev?.pid);
      return { pid: p?.id || null, name: p?.name || prev?.name || `Jugador ${i + 1}`, color: p?.color || prev?.color || COLORS[i % COLORS.length], img: p?.img || prev?.img || null,
        life: s.start, poison: 0, energy: 0, exp: 0, rad: 0, cmd: {}, delta: 0 };
    }) };
    save("lifeGame", game);
  }

  // ---- al entrar en la pestaña
  function view() {
    $("#view").innerHTML = `<div class="lf-splash">${ico("heart")}</div>`;
    if (!game) { newGame(); return table(); }
    const body = openSheet(`<div class="lf-ask"><div class="lf-ask-ico">${ico("heart")}</div><h3>¿Iniciar una nueva partida?</h3>
      <div class="sub">${game.players.length} jugadores · ${game.start} vidas</div>
      <div class="row-btns"><button class="btn" id="lf-no">No, seguir la de antes</button><button class="btn primary" id="lf-yes">Sí, nueva partida</button></div></div>`);
    // Cerrar la pregunta sin contestar (X, tocar fuera, atrás) = seguir la partida de antes (antes se quedaba la pantalla vacía)
    closeSheet.after = () => { if (location.hash === "#life" && !document.querySelector(".lf-table")) table(); };
    $("#lf-yes", body).onclick = () => { closeSheet.after = null; closeSheet(); newGame(); table(); sfx.pick(); };
    $("#lf-no", body).onclick = () => { closeSheet(); };
  }

  // ---- la mesa
  // Giro de cada asiento según la mesa: enfrentados (los de arriba, del revés; los del medio, de lado), alrededor (columnas de lado)
  function rotations(n, layout) {
    const cols = n === 2 && layout !== "side" ? 1 : 2, rows = Math.ceil(n / cols), odd = n % 2 === 1 && cols === 2;
    return Array.from({ length: n }, (_, i) => {
      if (layout === "same") return 0;
      if (layout === "side") { if (odd && i === n - 1) return 0; return i % 2 === 0 ? 90 : 270; }
      if (cols === 1) return i === 0 ? 180 : 0;
      const row = odd ? (i === 0 ? 0 : 1 + Math.floor((i - 1) / 2)) : Math.floor(i / 2);
      if (row === 0) return 180;
      if (row === rows - 1) return 0;
      return (odd ? i - 1 : i) % 2 === 0 ? 90 : 270;
    });
  }
  function table() {
    document.querySelector(".lf-table")?.remove();
    el = document.createElement("div");
    document.body.appendChild(el);
    navigator.wakeLock?.request("screen").then((w) => (wake = w)).catch(() => {});
    paint();
    addEventListener("resize", fit);
  }
  function fit() {  // los asientos de lado: el contenido gira 90° y se ajusta al hueco
    el?.querySelectorAll(".lf-seat").forEach((seat) => {
      const inner = seat.firstElementChild, r = +seat.dataset.rot, side = r === 90 || r === 270;
      inner.style.width = `${side ? seat.clientHeight : seat.clientWidth}px`;
      inner.style.height = `${side ? seat.clientWidth : seat.clientHeight}px`;
      inner.style.transform = `translate(-50%, -50%) rotate(${r}deg)`;
    });
  }
  function paint() {
    const n = game.players.length, rot = rotations(n, game.layout), odd = n % 2 === 1 && n > 2;
    el.className = `lf-table n${n} ${game.layout} ${odd ? "odd" : ""}`;
    el.innerHTML = `${game.players.map((pl, i) => {
      const dead = pl.life <= 0 || pl.poison >= 10 || Object.values(pl.cmd).some((v) => v >= 21);
      const bg = pl.img ? `background-image:linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.45)),url('${pl.img}')` : "";
      const span = odd && ((game.layout === "face" && i === 0) || (game.layout !== "face" && i === n - 1));
      return `<div class="lf-seat ${dead ? "dead" : ""} ${span ? "span" : ""}" data-rot="${rot[i]}" style="--c:${pl.color}">
        <div class="lf-in" style="background-color:${pl.color};${bg}">
          <button class="lf-tap up" data-i="${i}" data-d="1" aria-label="Más una vida"><span>+</span></button>
          <button class="lf-tap down" data-i="${i}" data-d="-1" aria-label="Menos una vida"><span>−</span></button>
          <div class="lf-tokens">${game.monarch === i ? `<span class="tok monarch">${ico("crown")}Monarca</span>` : ""}${game.initiative === i ? `<span class="tok init">${ico("sword")}Iniciativa</span>` : ""}</div>
          <button class="lf-name" data-who="${i}">${esc(pl.name)}</button>
          <div class="lf-life" id="lf-life-${i}">${pl.life}</div>
          <div class="lf-delta ${pl.delta > 0 ? "up" : "down"}" id="lf-delta-${i}" ${pl.delta ? "" : "hidden"}>${pl.delta > 0 ? "+" : ""}${pl.delta}</div>
          <div class="lf-extra">${chips(pl, i)}<button class="lf-ctr add" data-who="${i}" aria-label="Contadores">${ico("plus2")}</button></div>
          ${dead ? `<div class="lf-skull">${ico("skull")}</div>` : ""}
          <div class="lf-flash"></div>
        </div></div>`;
    }).join("")}
    <div class="lf-bar">
      <button data-act="exit" aria-label="Salir">${ico("close")}</button><button data-act="set" aria-label="Ajustes">${ico("gear")}</button>
      <button data-act="dice" aria-label="Dados">${ico("dice")}</button><button data-act="first" aria-label="Quién empieza">${ico("shuffle")}</button>
      <button data-act="tok" aria-label="Monarca, iniciativa, día y noche" class="${game.day || ""}">${ico(game.day === "night" ? "moon" : game.day === "day" ? "sun" : "crown")}</button>
      <button data-act="turn" class="lf-turn" aria-label="Turno">T${game.turn || 1}</button><button data-act="reset" aria-label="Reiniciar">${ico("reset")}</button>
    </div>
    <div class="lf-panel" id="lf-panel" hidden></div>`;
    el.querySelectorAll(".lf-tap").forEach(bindTap);
    el.querySelectorAll("[data-ck]").forEach(bindCounter);
    el.querySelectorAll("[data-who]").forEach((b) => (b.onclick = () => seatSheet(+b.dataset.who)));
    el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => act(b.dataset.act)));
    fit();
  }

  // ---- contadores debajo de las vidas: tocar = +1; mantener = se abre con − y + (para cartas que quitan contadores)
  const CTRS = [["poison", "skull"], ["energy", "bolt"], ["exp", "sparkle"], ["rad", "warn"]];
  let openCtr = null, openTimer = null;  // "asiento:contador" abierto con − y +
  function chips(pl, i) {
    const list = [...CTRS.filter(([k]) => pl[k] || pl.pin?.[k]).map(([k, ic]) => ({ k, ic, v: pl[k] || 0, cls: k === "poison" && pl.poison >= 7 ? "hot" : "" })),
      ...Object.keys(pl.cmd).filter((j) => pl.cmd[j] || pl.pin?.[`cmd${j}`]).map((j) => ({ k: `cmd${j}`, ic: "sword", v: pl.cmd[j] || 0, cls: "cmd", c: game.players[+j]?.color }))];
    return list.map(({ k, ic, v, cls, c }) => (openCtr === `${i}:${k}`
      ? `<span class="lf-ctr open ${cls}" style="${c ? `--c:${c}` : ""}"><button data-ck="${k}" data-ci="${i}" data-cd="-1" aria-label="Quitar uno">−</button>${ico(ic)}<b>${v}</b><button data-ck="${k}" data-ci="${i}" data-cd="1" aria-label="Sumar uno">+</button></span>`
      : `<button class="lf-ctr ${cls}" style="${c ? `--c:${c}` : ""}" data-ck="${k}" data-ci="${i}">${ico(ic)}${v}</button>`)).join("");
  }
  function bumpCounter(i, k, d) {
    const pl = game.players[i];
    (pl.pin ||= {})[k] = true;  // ya usado en esta partida: se queda debajo de las vidas aunque vuelva a 0
    if (k.startsWith("cmd")) { const j = k.slice(3), old = pl.cmd[j] || 0, nv = Math.max(0, old + d); pl.life -= nv - old; pl.cmd[j] = nv; }
    else pl[k] = Math.max(0, (pl[k] || 0) + d);
    d > 0 ? sfx.up() : sfx.down(); buzz(8);
    save("lifeGame", game);
  }
  function bindCounter(b) {
    const i = +b.dataset.ci, k = b.dataset.ck, d = b.dataset.cd;
    const keepOpen = () => { clearTimeout(openTimer); openTimer = setTimeout(() => { openCtr = null; if (el) paint(); }, 4000); };
    if (d) { b.onclick = (e) => { e.stopPropagation(); bumpCounter(i, k, +d); keepOpen(); paint(); }; return; }
    let hold = null;
    b.onpointerdown = (e) => { e.stopPropagation(); hold = setTimeout(() => { hold = null; openCtr = `${i}:${k}`; buzz(25); keepOpen(); paint(); }, 450); };
    b.onpointerup = (e) => { e.stopPropagation(); if (hold) { clearTimeout(hold); hold = null; bumpCounter(i, k, 1); paint(); } };
    b.onpointerleave = b.onpointercancel = () => { clearTimeout(hold); hold = null; };
    b.oncontextmenu = (e) => e.preventDefault();
  }

  // Tocar: ±1. Mantener: ±10 y sigue sumando mientras no sueltes (como LifeTap).
  const timers = new Map();
  function bindTap(b) {
    const i = +b.dataset.i, d = +b.dataset.d;
    let hold = null, held = false;
    const stop = () => { clearTimeout(hold); clearInterval(hold); hold = null; };
    b.onpointerdown = (e) => {
      e.preventDefault(); held = false; stop();
      hold = setTimeout(() => { held = true; change(i, d * 10); hold = setInterval(() => change(i, d * 10), 450); }, 420);
    };
    b.onpointerup = () => { if (hold && !held) change(i, d); stop(); };
    b.onpointerleave = b.onpointercancel = stop;
    b.oncontextmenu = (e) => e.preventDefault();
  }
  function change(i, d) {
    const pl = game.players[i], was = pl.life;
    pl.life += d; pl.delta += d;
    const lifeEl = $(`#lf-life-${i}`, el), deltaEl = $(`#lf-delta-${i}`, el), seat = lifeEl.closest(".lf-in");
    lifeEl.textContent = pl.life;
    lifeEl.classList.remove("bump"); void lifeEl.offsetWidth; lifeEl.classList.add("bump");
    deltaEl.hidden = false; deltaEl.textContent = `${pl.delta > 0 ? "+" : ""}${pl.delta}`; deltaEl.className = `lf-delta ${pl.delta > 0 ? "up" : "down"}`;
    const flash = $(".lf-flash", seat); flash.className = `lf-flash ${d > 0 ? "up" : "down"}`; void flash.offsetWidth; flash.classList.add("go");
    Math.abs(d) >= 5 ? sfx.big(d) : d > 0 ? sfx.up() : sfx.down();
    buzz(Math.abs(d) >= 5 ? 25 : 8);
    if (was > 0 && pl.life <= 0) { sfx.dead(); buzz([60, 40, 120]); setTimeout(paint, 300); }
    if (was <= 0 && pl.life > 0) setTimeout(paint, 50);
    clearTimeout(timers.get(i));
    timers.set(i, setTimeout(() => { pl.delta = 0; deltaEl.hidden = true; save("lifeGame", game); }, 2000));  // el "-3" se junta y luego se va
    save("lifeGame", game);
  }

  // ---- dados y moneda a pantalla completa: el dado (con su forma) rueda, cae con un golpe y un destello.
  // Tocar fuera cierra; «Otra vez» vuelve a tirar el mismo.
  function roll(d) {
    const coin = d === "coin", faces = coin ? 2 : +d;
    el.querySelector(".lf-dice")?.remove();
    $("#lf-panel", el).hidden = true;  // que no se vea detrás
    const ov = document.createElement("div");
    ov.className = `lf-dice ${coin ? "coin" : `d${faces}`}`;
    ov.innerHTML = `<div class="lf-die-wrap rolling"><div class="lf-die"><b>${coin ? ico("coin") : "?"}</b></div></div>
      <div class="lf-dice-label">${coin ? "Moneda" : `d${faces}`}</div>
      <div class="lf-dice-btns"><button data-again="1">${ico("dice")}Otra vez</button><button data-close="1">Cerrar</button></div>`;
    el.appendChild(ov);
    const wrap = $(".lf-die-wrap", ov), out = $(".lf-die b", ov);
    sfx.dice();
    let k = 0;
    const spin = setInterval(() => { out.textContent = coin ? (k++ % 2 ? "Cara" : "Cruz") : 1 + rnd(faces); }, 60);
    setTimeout(() => {
      clearInterval(spin);
      if (!ov.isConnected) return;
      const r = rnd(faces);
      out.textContent = coin ? (r ? "Cara" : "Cruz") : `${1 + r}`;
      wrap.classList.remove("rolling");
      wrap.classList.add("land", ...(faces === 20 && r === 19 ? ["crit"] : faces === 20 && r === 0 ? ["fail"] : []));
      if (faces === 20 && (r === 19 || r === 0)) $(".lf-dice-label", ov).textContent = r ? "¡Crítico!" : "Pifia";
      buzz(r === 19 && faces === 20 ? [40, 40, 80] : 40); sfx.pick();
    }, 900);
    $("[data-again]", ov).onclick = (e) => { e.stopPropagation(); roll(d); };
    ov.onclick = () => ov.remove();
  }
  function bigResult(icon, text, color) {
    el.querySelector(".lf-dice")?.remove();
    const ov = document.createElement("div");
    ov.className = "lf-dice first";
    ov.innerHTML = `<div class="lf-die-wrap land"><div class="lf-die" style="--c:${color}"><b>${ico(icon)}</b></div></div><div class="lf-dice-label">${esc(text)}</div>`;
    el.appendChild(ov);
    ov.onclick = () => ov.remove();
    setTimeout(() => ov.remove(), 3500);
  }

  // ---- la barra del centro
  function act(a) {
    const panel = $("#lf-panel", el);
    if (a === "exit") { el.remove(); el = null; wake?.release?.().catch(() => {}); wake = null; location.hash = store("lastTab") || "collection"; return; }
    if (a === "turn") { game.turn = (game.turn || 1) + 1; save("lifeGame", game); sfx.up(); buzz(15); paint(); return; }
    if (!panel.hidden && panel.dataset.k === a) { panel.hidden = true; return; }
    panel.dataset.k = a; panel.hidden = false;
    if (a === "set") {
      const s = settings();
      panel.innerHTML = `<div class="lf-row"><span>Jugadores</span>${[2, 3, 4, 5, 6].map((n) => `<button data-n="${n}" class="${n === game.players.length ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="lf-row"><span>Vidas</span>${LIVES.map((l) => `<button data-l="${l}" class="${l === game.start ? "on" : ""}">${l}</button>`).join("")}<input type="number" id="lf-custom" min="1" max="999" placeholder="…" value="${LIVES.includes(game.start) ? "" : game.start}"></div>
        <div class="lf-row"><span>Mesa</span>${LAYOUTS.map(([k, n]) => `<button data-lay="${k}" class="${k === game.layout ? "on" : ""}">${n}</button>`).join("")}</div>
        <div class="lf-row"><button data-shuffle="1">${ico("shuffle")}Sortear asientos</button><button data-sound="1">${store("sounds") === "0" ? `${ico("mute")}Sonido` : `${ico("sound")}Sonido`}</button></div>`;
      const apply = (patch) => { save("lifeSettings", { ...s, n: game.players.length, start: game.start, layout: game.layout, ...patch }); newGame(); paint(); act("set"); };
      panel.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => apply({ n: +b.dataset.n })));
      panel.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => apply({ start: +b.dataset.l })));
      $("#lf-custom", panel).onchange = (e) => { const v = Math.max(1, Math.min(999, +e.target.value || 20)); apply({ start: v }); };
      // volver a tocar la mesa elegida la quita (vuelve a enfrentados)
      panel.querySelectorAll("[data-lay]").forEach((b) => (b.onclick = () => { game.layout = b.dataset.lay === game.layout ? "face" : b.dataset.lay; save("lifeSettings", { ...s, layout: game.layout }); save("lifeGame", game); paint(); act("set"); }));
      $("[data-shuffle]", panel).onclick = () => { for (let i = game.players.length - 1; i > 0; i--) { const j = rnd(i + 1); [game.players[i], game.players[j]] = [game.players[j], game.players[i]]; } game.monarch = game.initiative = null; save("lifeGame", game); sfx.dice(); paint(); };
      $("[data-sound]", panel).onclick = () => { store("sounds", store("sounds") === "0" ? "1" : "0"); panel.hidden = true; act("set"); };
    } else if (a === "dice") {
      panel.innerHTML = `<div class="lf-row lf-dice-row">${[4, 6, 8, 10, 12, 20].map((d) => `<button data-d="${d}">d${d}</button>`).join("")}<button data-d="coin">${ico("coin")}Moneda</button></div>`;
      panel.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => roll(b.dataset.d)));
    } else if (a === "tok") {
      const who = (k) => `<button data-${k}="-1" class="${game[k] == null ? "on" : ""}">Nadie</button>${game.players.map((p, i) => `<button data-${k}="${i}" class="${game[k] === i ? "on" : ""}" style="--c:${p.color}"><i class="lf-dot" style="background:${p.color}"></i>${esc(p.name)}</button>`).join("")}`;
      panel.innerHTML = `<div class="lf-row"><span>${ico("crown")}Monarca</span>${who("monarch")}</div>
        <div class="lf-row"><span>${ico("sword")}Iniciativa</span>${who("initiative")}</div>
        <div class="lf-row"><span>Día / noche</span><button data-day="" class="${game.day ? "" : "on"}">No</button><button data-day="day" class="${game.day === "day" ? "on" : ""}">${ico("sun")}Día</button><button data-day="night" class="${game.day === "night" ? "on" : ""}">${ico("moon")}Noche</button></div>
        <div class="lf-row"><span>Turno</span><button data-turn="-1">−</button><b class="lf-turn-n">${game.turn || 1}</b><button data-turn="1">+</button></div>`;
      const give = (k, i) => {
        game[k] = i < 0 ? null : i;
        save("lifeGame", game); paint(); act("tok");
        if (i >= 0) bigResult(k === "monarch" ? "crown" : "sword", k === "monarch" ? `${game.players[i].name} es el monarca` : `${game.players[i].name} tiene la iniciativa`, game.players[i].color);
        sfx.pick(); buzz(30);
      };
      panel.querySelectorAll("[data-monarch]").forEach((b) => (b.onclick = () => give("monarch", +b.dataset.monarch)));
      panel.querySelectorAll("[data-initiative]").forEach((b) => (b.onclick = () => give("initiative", +b.dataset.initiative)));
      panel.querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => { game.day = b.dataset.day || null; save("lifeGame", game); paint(); act("tok"); sfx.up(); }));
      panel.querySelectorAll("[data-turn]").forEach((b) => (b.onclick = () => { game.turn = Math.max(1, (game.turn || 1) + +b.dataset.turn); save("lifeGame", game); paint(); act("tok"); }));
    } else if (a === "first") {
      // Ruleta: el brillo pasa de asiento en asiento, cada vez más despacio, y se para en uno al azar
      panel.hidden = true;
      const seats = [...el.querySelectorAll(".lf-seat")], n = seats.length, win = rnd(n), steps = n * 3 + win;
      let k = 0;
      const tick = () => {
        seats.forEach((s, i) => s.classList.toggle("pick", i === k % n));
        Sfx.play([[600 + (k % n) * 80, 0, 0.05, "square", 0.03]]);
        if (k < steps) { k++; setTimeout(tick, 70 + k * 14); }
        else { sfx.pick(); buzz(40); bigResult("crown", `Empieza ${game.players[win].name}`, game.players[win].color); setTimeout(() => seats.forEach((s) => s.classList.remove("pick")), 2400); }
      };
      tick();
    } else if (a === "reset") {
      panel.innerHTML = `<div class="lf-row"><span>¿Empezar otra partida?</span><button data-ok="1" class="on">Sí</button><button data-no="1">No</button></div>`;
      $("[data-ok]", panel).onclick = () => {
        // Estadísticas de los perfiles: partidas y quién ha ganado (si solo queda uno vivo)
        const all = profiles(), alive = game.players.filter((p) => p.life > 0 && p.poison < 10);
        for (const p of game.players) { const x = all.find((y) => y.id === p.pid); if (x) x.games = (x.games || 0) + 1; }
        if (alive.length === 1) { const w = all.find((x) => x.id === alive[0].pid); if (w) w.wins = (w.wins || 0) + 1; }
        save("lifeProfiles", all); newGame(); paint(); sfx.pick();
      };
      $("[data-no]", panel).onclick = () => (panel.hidden = true);
    }
  }

  // ---- un asiento: perfil y contadores
  function seatSheet(i) {
    const pl = game.players[i], ps = profiles();
    const body = openSheet(`<h3>${esc(pl.name)}</h3>
      <h2>Perfil</h2>
      <div class="lf-profiles">${ps.map((p) => `<button class="lf-prof ${p.id === pl.pid ? "on" : ""}" data-pid="${p.id}"><span class="lf-avatar" style="background-color:${p.color}${p.img ? `;background-image:url('${p.img}')` : ""}"></span><span>${esc(p.name)}</span></button>`).join("")}
        <button class="lf-prof" data-pid="new"><span class="lf-avatar add">＋</span><span>Nuevo</span></button></div>
      ${pl.pid ? `<button class="btn block" id="lf-edit">${ico("edit")}Editar este perfil</button>` : ""}
      <h2>Contadores</h2>
      <div class="lf-counters">
        ${[["poison", "skull", "Veneno"], ["energy", "bolt", "Energía"], ["exp", "sparkle", "Experiencia"], ["rad", "warn", "Radiación"]].map(([k, ic, n]) => `<div class="lf-step"><span>${ico(ic)}${n}</span><button data-k="${k}" data-d="-1">−</button><b>${pl[k] || 0}</b><button data-k="${k}" data-d="1">+</button></div>`).join("")}
      </div>
      <div class="hint">Los contadores que uses salen debajo de las vidas: tócalo para sumar 1; mantenlo para restar. Con 10 de veneno, pierde. Monarca, iniciativa, día/noche y turno: botón de la corona en la barra del centro.</div>
      ${game.players.length > 1 ? `<h2>Daño de comandante recibido</h2><div class="lf-counters">${game.players.map((o, j) => (j === i ? "" : `<div class="lf-step"><span><i class="lf-dot" style="background:${o.color}"></i>${esc(o.name)}</span><button data-k="cmd" data-j="${j}" data-d="-1">−</button><b>${pl.cmd[j] || 0}</b><button data-k="cmd" data-j="${j}" data-d="1">+</button></div>`)).join("")}</div>
        <div class="hint">El daño de comandante también quita vidas. Con 21 de un mismo comandante, pierde.</div>` : ""}`);
    body.querySelectorAll("[data-pid]").forEach((b) => (b.onclick = () => {
      if (b.dataset.pid === "new") return editProfile(null, i);
      const p = ps.find((x) => x.id === b.dataset.pid);
      Object.assign(pl, { pid: p.id, name: p.name, color: p.color, img: p.img });
      save("lifeGame", game); paint(); seatSheet(i); sfx.up();
    }));
    $("#lf-edit", body)?.addEventListener("click", () => editProfile(pl.pid, i));
    body.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
      const d = +b.dataset.d;
      if (b.dataset.k === "cmd") { const j = b.dataset.j, old = pl.cmd[j] || 0, nv = Math.max(0, old + d); pl.life -= nv - old; pl.cmd[j] = nv; }
      else pl[b.dataset.k] = Math.max(0, (pl[b.dataset.k] || 0) + d);
      (pl.pin ||= {})[b.dataset.k === "cmd" ? `cmd${b.dataset.j}` : b.dataset.k] = true;
      d > 0 ? sfx.up() : sfx.down();
      save("lifeGame", game); paint(); seatSheet(i);
    }));
  }

  function editProfile(id, seat) {
    const p = profiles().find((x) => x.id === id) || { id: `p${Date.now()}`, name: "", color: COLORS[profiles().length % COLORS.length], img: null, wins: 0, games: 0 };
    const body = openSheet(`<h3>${id ? "Editar perfil" : "Nuevo perfil"}</h3>
      <div class="lf-preview" id="lf-pv"><b></b><span class="sub"></span></div>
      <div class="field"><label>Nombre</label><input class="search" id="lf-name" maxlength="20" value="${esc(p.name)}" placeholder="Tu nombre de jugador"></div>
      <div class="field"><label>Color</label><div class="lf-swatches">${COLORS.map((c) => `<button class="lf-swatch" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div></div>
      <div class="field"><label>Imagen</label><div class="row-btns" style="margin-top:0">
        <button class="btn" id="lf-card">${ico("cards")}Carta de Magic</button>
        <label class="btn" for="lf-cam">${ico("cam")}Hacer foto</label><label class="btn" for="lf-gal">${ico("image")}Galería</label></div>
        <input type="file" id="lf-cam" accept="image/*" capture="user" hidden><input type="file" id="lf-gal" accept="image/*" hidden></div>
      <div id="lf-cardpick" hidden><input class="search" id="lf-cq" placeholder="Busca una carta por su nombre…"><div class="lf-arts" id="lf-arts"></div></div>
      ${p.img ? `<button class="btn block" id="lf-noimg">Quitar la imagen</button>` : ""}
      <div class="row-btns"><button class="btn primary" id="lf-save">Guardar</button>${id ? `<button class="btn" id="lf-del">Borrar</button>` : ""}</div>`);
    const paintPv = () => {
      const pv = $("#lf-pv", body);
      pv.style.cssText = `background-color:${p.color};${p.img ? `background-image:linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.45)),url('${p.img}')` : ""}`;
      $("b", pv).textContent = p.name || "…"; $(".sub", pv).textContent = id ? `${p.wins || 0} victorias · ${p.games || 0} partidas` : "";
      body.querySelectorAll("[data-c]").forEach((b) => b.classList.toggle("on", b.dataset.c === p.color));
    };
    paintPv();
    $("#lf-name", body).oninput = (e) => { p.name = e.target.value; paintPv(); };
    body.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { p.color = b.dataset.c; paintPv(); }));
    for (const inp of ["#lf-cam", "#lf-gal"]) $(inp, body).onchange = async (e) => { const f = e.target.files[0]; if (f) { p.img = await shrink(f); paintPv(); } };
    $("#lf-card", body).onclick = () => { $("#lf-cardpick", body).hidden = false; $("#lf-cq", body).focus(); };
    let tq;
    $("#lf-cq", body).oninput = (e) => {
      clearTimeout(tq);
      tq = setTimeout(async () => {
        const q = e.target.value.trim(), box = $("#lf-arts", body);
        if (q.length < 2) { box.innerHTML = ""; return; }
        const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
        box.innerHTML = res.slice(0, 9).filter((r) => r.image).map((r) => `<button class="lf-art" data-img="${esc(artOf(r.image))}"><img src="${esc(artOf(r.image))}" alt="${esc(r.name)}" loading="lazy"><span>${esc(r.name)}</span></button>`).join("") || `<div class="hint">No la encuentro.</div>`;
        box.querySelectorAll("[data-img]").forEach((b) => (b.onclick = () => { p.img = b.dataset.img; paintPv(); sfx.up(); }));
      }, 250);
    };
    $("#lf-noimg", body)?.addEventListener("click", () => { p.img = null; paintPv(); });
    $("#lf-save", body).onclick = () => {
      p.name = p.name.trim() || "Jugador";
      if (!save("lifeProfiles", [...profiles().filter((x) => x.id !== p.id), p])) return;
      if (seat != null) Object.assign(game.players[seat], { pid: p.id, name: p.name, color: p.color, img: p.img });
      for (const pl of game.players) if (pl.pid === p.id) Object.assign(pl, { name: p.name, color: p.color, img: p.img });
      save("lifeGame", game); paint(); sfx.pick();
      seat != null ? seatSheet(seat) : closeSheet();
    };
    $("#lf-del", body)?.addEventListener("click", () => {
      if (!confirm(t(`¿Borrar el perfil de ${p.name}?`))) return;
      save("lifeProfiles", profiles().filter((x) => x.id !== p.id));
      for (const pl of game.players) if (pl.pid === p.id) pl.pid = null;
      save("lifeGame", game); closeSheet(); paint();
    });
  }

  return { view };
})();

views.life = () => Life.view();
