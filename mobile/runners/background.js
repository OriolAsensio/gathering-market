// Tarea en segundo plano de la app de Android (@capacitor/background-runner).
// Cada ~30 min (cuando Android lo permite) mira si hay paquete nuevo y, si lo hay, avisa SIN abrir la app:
//  - de tus cartas que suben o bajan (>= 10 % y >= 0,50 €, la misma regla que los avisos de la app), y
//  - de los avisos generales nuevos (baneos, próximos anuncios de baneos, colecciones…).
// La app le pasa la lista de tus cartas con el evento "syncCollection" (aquí no hay acceso a IndexedDB).
// build-web.mjs cambia __PACK_URL__ por la dirección del paquete diario.
const PACK = "__PACK_URL__";
const ICON = "ic_stat_gm";

const kv = (k) => { try { return CapacitorKV.get(k)?.value || ""; } catch { return ""; } };
const euro = (c) => (c / 100).toFixed(2).replace(".", ",") + " €";
let nextId = Date.now() % 1e6;
const notify = (title, body) => CapacitorNotifications.schedule([{ id: nextId++, title, body, scheduleAt: new Date(Date.now() + 1000), smallIcon: ICON }]);

addEventListener("syncCollection", (resolve, reject, args) => {
  try {
    CapacitorKV.set("ids", JSON.stringify(args?.ids || []));   // ["<id>" normal, "<id>f" foil]
    CapacitorKV.set("names", JSON.stringify(args?.names || {}));
    CapacitorKV.set("wishes", JSON.stringify(args?.wishes || []));  // [{name, target, pis}] (pis: posiciones en prices.json)
    CapacitorKV.set("cardsVersion", args?.cardsVersion || "");
    if (args?.day && !kv("lastDay")) CapacitorKV.set("lastDay", args.day);  // no avisar de lo que ya se ve al abrir
    if (args?.lastEvent != null && !kv("lastEvent")) CapacitorKV.set("lastEvent", String(args.lastEvent));
    resolve();
  } catch (e) { reject(e); }
});

addEventListener("checkPrices", async (resolve, reject) => {
  try {
    if (!PACK) return resolve();
    const version = await (await fetch(PACK + "version.json?t=" + Date.now())).json();
    // 1) Avisos generales nuevos (pueden llegar en la segunda vuelta del día, con el mismo "day")
    if (version.live_version && version.live_version !== kv("lastLive")) {
      const events = await (await fetch(PACK + "events.json?v=" + version.live_version)).json();
      const last = +kv("lastEvent") || 0;
      const fresh = events.filter((e) => e.id > last && e.kind !== "price").slice(0, 5);
      if (last) for (const e of fresh.reverse()) notify(e.title, e.body || "");
      if (events.length) CapacitorKV.set("lastEvent", String(Math.max(last, ...events.map((e) => e.id))));
      CapacitorKV.set("lastLive", version.live_version);
    }
    // 2) Tus cartas, una vez por día de precios
    if (version.day && version.day !== kv("lastDay")) {
      const ids = JSON.parse(kv("ids") || "[]"), names = JSON.parse(kv("names") || "{}");
      if (ids.length) {
        const ch = (await (await fetch(PACK + "changes.json?d=" + version.day)).json()).c || {};
        const hits = ids.filter((k) => ch[k]).map((k) => {
          const [old, now] = ch[k];
          return { name: names[k] || "Una carta tuya", old, now, pct: Math.round(((now - old) * 100) / old) };
        }).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
        const line = (h) => `${h.name} ${h.pct > 0 ? "+" : ""}${h.pct}% (${euro(h.old)} → ${euro(h.now)})`;
        if (hits.length && hits.length <= 3) {
          for (const h of hits) notify(`${h.pct > 0 ? "📈 Sube" : "📉 Baja"} ${h.name}`, line(h));
        } else if (hits.length) {
          const up = hits.filter((h) => h.pct > 0).length, down = hits.length - up;
          notify(`${up ? `📈 ${up} suben` : ""}${up && down ? " · " : ""}${down ? `📉 ${down} bajan` : ""} en tu colección`,
            hits.slice(0, 5).map(line).join("\n"));
        }
      }
      // Lista de deseos: la edición más barata ya está por debajo de tu precio objetivo
      const wishes = JSON.parse(kv("wishes") || "[]"), hit = JSON.parse(kv("wishHit") || "{}");
      if (wishes.length && version.cards_version === kv("cardsVersion")) {  // si cambian las cartas, las posiciones ya no valen
        const pr = await (await fetch(PACK + "prices.json?d=" + version.day)).json();
        for (const w of wishes) {
          const now = Math.min(...w.pis.map((i) => pr.eur[i]).filter((v) => v != null));
          if (!Number.isFinite(now)) continue;
          if (now <= w.target && !hit[w.name]) { notify(`🎯 ${w.name} a ${euro(now)}`, `Ha bajado de tu precio objetivo (${euro(w.target)}).`); hit[w.name] = version.day; }
          else if (now > w.target) delete hit[w.name];
        }
        CapacitorKV.set("wishHit", JSON.stringify(hit));
      }
      CapacitorKV.set("lastDay", version.day);
    }
    resolve();
  } catch (e) {
    reject(e);
  }
});
