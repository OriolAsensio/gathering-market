"""Metajuego de Pauper desde MTGTop8: arquetipos, cuota y una lista reciente de cada uno.

MTGTop8 pide 5 s entre peticiones (robots.txt), así que tarda un par de minutos.
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
    return data.decode("cp1252", errors="replace")


ARCH_RE = re.compile(
    r"archetype\?a=(\d+)&meta=(\d+)&f=PAU>([^<]+)</a>.*?class=S14>([\d.]+) %", re.S)  # "4 %" o "0.1 %"
CAT_RE = re.compile(r"class=meta_arch[^>]*>([A-Z]+) \d+%")
DECK_RE = re.compile(
    r"event\?e=\d+&d=(\d+)&f=PAU>([^<]+)</a></td>\s*"
    r"<td><a class=player[^>]*>([^<]*)</a></td>\s*"
    r"<td><a [^>]*>([^<]*)</a></td>.*?<td>([^<]*)</td>\s*<td>([^<]*)</td>", re.S)


def parse_archetypes(html: str):
    cats = [(m.start(), m.group(1).title()) for m in CAT_RE.finditer(html)]
    out = []
    for m in ARCH_RE.finditer(html):
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

    prev_day = conn.execute("SELECT max(day) FROM meta WHERE day < ?", (today,)).fetchone()[0]
    prev = {r[0]: r[1] for r in conn.execute(
        "SELECT archetype, share FROM meta WHERE day = ?", (prev_day,))} if prev_day else {}

    for a in archetypes:
        html = get(f"archetype?a={a['id']}&meta={a['meta']}&f=PAU")
        # La lista con mejor puesto ("1" gana a "3-4"); a igualdad, la más reciente (la primera).
        rows = list(DECK_RE.finditer(html))
        m = min(rows, key=lambda r: int(re.match(r"\d+", r.group(5)).group() if re.match(r"\d+", r.group(5)) else 999),
                default=None)
        if not m:
            print(f"  sin listas: {a['name']}")
            continue
        deck_id = int(m.group(1))
        with conn:
            if not conn.execute("SELECT 1 FROM decks WHERE id = ?", (deck_id,)).fetchone():
                cards = parse_list(get(f"mtgo?d={deck_id}"))
                conn.execute("INSERT INTO decks VALUES (?,?,?,?,?,?,?,?)",
                             (deck_id, a["id"], a["name"], m.group(2).strip(), m.group(3).strip(),
                              m.group(4).strip(), m.group(5).strip(), m.group(6).strip()))
                conn.executemany("INSERT OR REPLACE INTO deck_cards VALUES (?,?,?,?)",
                                 [(deck_id, n, q, s) for n, q, s in cards])
            conn.execute("INSERT OR REPLACE INTO meta VALUES (?,?,?,?,?,?)",
                         (today, a["id"], a["name"], a["category"], a["share"], deck_id))
        print(f"  {a['share']:4.0f}%  {a['name']}")

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


if __name__ == "__main__":
    main()
