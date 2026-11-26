"""Metajuego desde MTGTop8 (Pauper y otros formatos): arquetipos, cuota y la mejor lista de cada uno.

MTGTop8 pide 5 s entre peticiones (robots.txt), así que tarda unos minutos por formato.
"""
import re
import sys
import time
import urllib.request
from datetime import date

from db import add_event, connect

BASE = "https://www.mtgtop8.com/"
HEADERS = {"User-Agent": "MTGPriceTracker/0.1"}
TOP_N = 60          # arquetipos que seguimos (en la práctica, todos)
META = 145          # periodo de MTGTop8: últimos 2 meses (más arquetipos que "2 semanas")
DELAY = 5           # segundos entre peticiones
# Otros formatos: código de MTGTop8, nombre y cuántos arquetipos (los más jugados, en su periodo por defecto).
OTHER = [("ST", "Estándar", 30), ("MO", "Modern", 30), ("PI", "Pioneer", 25), ("LE", "Legacy", 25), ("VI", "Vintage", 18),
         ("PREM", "Premodern", 20), ("PEA", "Peasant", 15), ("EDH", "Duel Commander", 20, "DC"), ("cEDH", "cEDH", 20),
         ("HIGH", "Highlander", 12), ("CHL", "Canadian Highlander", 12), ("EXP", "Explorer", 15), ("HI", "Historic", 15)]
# Listas extra por arquetipo (las más recientes) para calcular los staples, y tope de listas nuevas por ejecución
# (cada una son 5 s; lo que no quepa hoy se baja en las siguientes vueltas: las ya guardadas no se repiten).
EXTRA = {"PAU": 4}
EXTRA_DEFAULT = 3
NEW_LISTS_PER_RUN = 150
_new_lists = 0

_last = 0.0


def get(path: str) -> str:
    global _last
    wait = DELAY - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    _last = time.time()
    try:
        return data.decode("utf-8")  # las listas (mtgo?d=) vienen en UTF-8
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")  # las páginas, en cp1252


def arch_re(f):
    return re.compile(rf"archetype\?a=(\d+)&meta=(\d+)&f={f}>([^<]+)</a>.*?class=S14>([\d.]+) %", re.S)  # "4 %" o "0.1 %"


def deck_re(f):
    return re.compile(
        rf"event\?e=\d+&d=(\d+)&f={f}>([^<]+)</a></td>\s*"
        r"<td><a class=player[^>]*>([^<]*)</a></td>\s*"
        r"<td><a [^>]*>([^<]*)</a></td>.*?<td>([^<]*)</td>\s*<td>([^<]*)</td>", re.S)


CAT_RE = re.compile(r"class=meta_arch[^>]*>([A-Z]+) \d+%")


def parse_archetypes(html: str, f: str = "PAU"):
    cats = [(m.start(), m.group(1).title()) for m in CAT_RE.finditer(html)]
    out = []
    for m in arch_re(f).finditer(html):
        cat = next((c for pos, c in reversed(cats) if pos < m.start()), "")
        out.append(dict(id=int(m.group(1)), meta=m.group(2), name=m.group(3).strip(),
                        share=float(m.group(4)), category=cat))
    return out


def parse_list(text: str):
    cards, side = [], 0
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower().startswith("sideboard"):
            side = 1
            continue
        qty, _, name = line.partition(" ")
        if qty.isdigit():
            cards.append((name.strip(), int(qty), side))
    return cards


def save_deck(conn, deck_id, a, m, force=False):
    """Baja y guarda una lista si aún no la tenemos. Devuelve False si hoy ya no caben más descargas."""
    global _new_lists
    if conn.execute("SELECT 1 FROM decks WHERE id = ?", (deck_id,)).fetchone():
        return True
    if _new_lists >= NEW_LISTS_PER_RUN and not force:  # la lista principal se baja siempre
        return False
    cards = parse_list(get(f"mtgo?d={deck_id}"))
    _new_lists += 1
    with conn:
        conn.execute("INSERT INTO decks VALUES (?,?,?,?,?,?,?,?)",
                     (deck_id, a["id"], a["name"], m.group(2).strip(), m.group(3).strip(),
                      m.group(4).strip(), m.group(5).strip(), m.group(6).strip()))
        conn.executemany("INSERT OR REPLACE INTO deck_cards VALUES (?,?,?,?)",
                         [(deck_id, n, q, s) for n, q, s in cards])
    return True


def scrape(conn, today, f, archetypes, code=None):
    """Guarda la foto del día de un formato: cuota de cada arquetipo, su mejor lista y unas cuantas más (staples)."""
    saved = 0
    code = code or f  # código con el que se guarda (Duel Commander: "DC", que "EDH" en la app es Commander)
    for a in archetypes:
        html = get(f"archetype?a={a['id']}&meta={a['meta']}&f={f}")
        # La lista con mejor puesto ("1" gana a "3-4"); a igualdad, la más reciente (la primera).
        rows = list(deck_re(f).finditer(html))
        m = min(rows, key=lambda r: int(re.match(r"\d+", r.group(5)).group() if re.match(r"\d+", r.group(5)) else 999),
                default=None)
        if not m:
            print(f"  sin listas: {a['name']}")
            continue
        deck_id = int(m.group(1))
        save_deck(conn, deck_id, a, m, force=True)
        lists = [deck_id]
        for r in rows:  # las más recientes primero
            if len(lists) > EXTRA.get(f, EXTRA_DEFAULT):
                break
            rid = int(r.group(1))
            if rid not in lists and save_deck(conn, rid, a, r):
                lists.append(rid)
        with conn:
            conn.execute("INSERT OR REPLACE INTO meta VALUES (?,?,?,?,?,?,?)",
                         (today, code, a["id"], a["name"], a["category"], a["share"], deck_id))
            conn.executemany("INSERT OR REPLACE INTO meta_lists VALUES (?,?,?,?)",
                             [(today, code, a["id"], d) for d in lists
                              if conn.execute("SELECT 1 FROM decks WHERE id = ?", (d,)).fetchone()])
        saved += 1
        print(f"  {code} {a['share']:4.0f}%  {a['name']}")
    return saved


# Formatos de Commander (Duel Commander, cEDH): MTGTop8 no da arquetipos, solo torneos. El "meta" sale de los tops de los
# últimos torneos: cada comandante es un arquetipo, su cuota es cuántas veces sale en los tops y su lista, la mejor clasificada.
EVENTS_META = {"EDH", "cEDH"}
EVENTS_N = 16


def scrape_events(conn, today, f, top, code):
    import zlib
    from tournaments import EVENT_RE, ROW_RE
    events = []
    for m in EVENT_RE.finditer(get(f"format?f={f}")):
        if m.group(2) == f and m.group(1) not in [e[0] for e in events]:
            events.append((m.group(1), m.group(3).strip(), f"{m.group(5)}/{m.group(6)}/{m.group(7)}"))
    rows = []
    for eid, name, day in events[:EVENTS_N]:
        page = get(f"event?e={eid}&f={f}")
        rows += [(r.group(1).strip(), int(r.group(3)), r.group(4).strip(), r.group(5).strip(), name, day)
                 for r in ROW_RE.finditer(page) if r.group(2) == eid]
    if not rows:
        return 0
    rank = lambda r: int(re.match(r"\d+", r[0]).group()) if re.match(r"\d+", r[0]) else 99
    by = {}
    for r in rows:
        by.setdefault(r[2], []).append(r)
    saved = 0
    for arch, rs in sorted(by.items(), key=lambda kv: (-len(kv[1]), min(map(rank, kv[1]))))[:top]:
        best = min(rs, key=rank)
        result, deck_id, _, player, event, day = best
        a = dict(id=zlib.crc32(arch.encode()) & 0x7FFFFFFF, name=arch)
        if not conn.execute("SELECT 1 FROM decks WHERE id = ?", (deck_id,)).fetchone():
            cards = parse_list(get(f"mtgo?d={deck_id}"))
            with conn:
                conn.execute("INSERT INTO decks VALUES (?,?,?,?,?,?,?,?)", (deck_id, a["id"], arch, arch, player, event, result, day))
                conn.executemany("INSERT OR REPLACE INTO deck_cards VALUES (?,?,?,?)", [(deck_id, n, q, s) for n, q, s in cards])
        with conn:
            conn.execute("INSERT OR REPLACE INTO meta VALUES (?,?,?,?,?,?,?)",
                         (today, code, a["id"], arch, "Commander", round(100 * len(rs) / len(rows), 1), deck_id))
            conn.execute("INSERT OR REPLACE INTO meta_lists VALUES (?,?,?,?)", (today, code, a["id"], deck_id))
        saved += 1
    return saved


def main():
    conn = connect()
    today = date.today().isoformat()
    # "2 meses" da cuotas más estables pero oculta arquetipos pequeños que sí salen en "2 semanas":
    # se unen ambos (cuota de 2 meses si existe) y las listas se buscan siempre en 2 meses.
    found = {}
    for meta in ("299", str(META)):
        for a in parse_archetypes(get(f"format?f=PAU&meta={meta}")):
            if not a["name"].startswith("Other"):
                found[a["id"]] = dict(a, meta=str(META))
    archetypes = sorted(found.values(), key=lambda a: a["share"], reverse=True)
    archetypes = archetypes[:TOP_N]
    if not archetypes:
        sys.exit("No se ha podido leer el metajuego (¿ha cambiado la web de MTGTop8?)")

    prev_day = conn.execute("SELECT max(day) FROM meta WHERE day < ? AND format = 'PAU'", (today,)).fetchone()[0]
    prev = {r[0]: r[1] for r in conn.execute(
        "SELECT archetype, share FROM meta WHERE day = ? AND format = 'PAU'", (prev_day,))} if prev_day else {}
    scrape(conn, today, "PAU", archetypes)

    # Avisos de cambios en el meta respecto a la última foto.
    if prev:
        with conn:
            for a in archetypes[:10]:
                old = prev.get(a["name"])
                if old is None:
                    add_event(conn, today, "meta", f"📊 Nuevo en el top de Pauper: {a['name']}",
                              f"Ahora tiene un {a['share']:.0f}% del meta.")
                elif abs(a["share"] - old) >= 3:
                    arrow = "sube" if a["share"] > old else "baja"
                    add_event(conn, today, "meta", f"📊 {a['name']} {arrow} en el meta",
                              f"Del {old:.0f}% al {a['share']:.0f}%.")
    print(f"Meta Pauper: {len(archetypes)} arquetipos guardados.")

    # Otros formatos (sin avisos: la app se centra en Pauper). Un fallo en uno no para los demás.
    for f, label, top, *code in OTHER:
        try:
            if f in EVENTS_META:
                print(f"Meta {label}: {scrape_events(conn, today, f, top, (code or [f])[0])} comandantes guardados.")
                continue
            arch = [a for a in parse_archetypes(get(f"format?f={f}"), f) if not a["name"].startswith("Other")]
            arch = sorted(arch, key=lambda a: a["share"], reverse=True)[:top]
            print(f"Meta {label}: {scrape(conn, today, f, arch, *code)} arquetipos guardados.")
        except Exception as e:  # noqa: BLE001
            print(f"Meta {label}: no se ha podido leer ({e})")


if __name__ == "__main__":
    main()
