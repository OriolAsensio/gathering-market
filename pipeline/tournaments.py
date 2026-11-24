"""Mazos ganadores de los últimos torneos de Pauper (MTGTop8) y los torneos destacados, con su top 8 completo
(jugador y lista): el Super Pauper de inGenio BCN Games (Barcelona) y el Paupergeddon (Lucca, Italia).

De cada torneo nuevo se guardan los puestos y nombres; las listas se bajan solo de lo que se enseña
(el ganador de cada torneo y el top 8 del destacado). MTGTop8 pide 5 s entre peticiones: se reutiliza
pauper_meta.get. Los torneos ya guardados no se vuelven a pedir.
"""
import re
import urllib.parse

from db import connect
from pauper_meta import get, parse_list

# Torneos destacados: número que se guarda en "featured", cómo se reconocen (nombre @ tienda) y qué buscar en MTGTop8
# (el buscador devuelve pocos resultados por búsqueda: "Paupergeddon" solo da los clasificatorios, "Main Event" da el principal).
FEATURED = [
    (1, lambda name, place: bool(re.search(r"super", name, re.I) and re.search(r"ingenio|bcn", name + " " + place, re.I)), ["Edición Super"]),
    (2, lambda name, place: bool(re.search(r"paupergeddon", name, re.I) and re.search(r"main event", name, re.I)), ["Main Event", "Paupergeddon"]),
]
RECENT = 12          # torneos recientes que se miran
FEATURED_TOP = 8     # listas que se bajan de cada destacado
SCHEMA = """
CREATE TABLE IF NOT EXISTS tournaments (id INTEGER PRIMARY KEY, format TEXT, name TEXT, place TEXT, date TEXT, featured INTEGER, players INTEGER);
CREATE TABLE IF NOT EXISTS tournament_decks (event_id INTEGER, rank TEXT, deck_id INTEGER, archetype TEXT, player TEXT, PRIMARY KEY (event_id, deck_id));
"""
EVENT_RE = re.compile(r"<a href=event\?e=(\d+)&f=(\w+)>([^<]+)</a> @ <a class=und [^>]*>([^<]+)</a>.*?class=S12>(\d\d)/(\d\d)/(\d\d)<", re.S)
ROW_RE = re.compile(r"<div[^>]*>\s*<div[^>]*class=S\d+[^>]*>([^<]{1,8})</div>.{0,400}?href=\?e=(\d+)&d=(\d+)&f=\w+>([^<]+)</a>"
                    r".{0,400}?player[^>]*>([^<]+)</a>", re.S)
PLAYERS_RE = re.compile(r"(\d+) players")


def is_featured(name, place):
    """0 si no es destacado; si lo es, su número (1 Super Pauper, 2 Paupergeddon)."""
    return next((n for n, match, _ in FEATURED if match(name, place)), 0)


def save_list(conn, deck_id, archetype, player, event, rank, day):
    if conn.execute("SELECT 1 FROM deck_cards WHERE deck_id = ? LIMIT 1", (deck_id,)).fetchone():
        return
    cards = parse_list(get(f"mtgo?d={deck_id}"))
    with conn:
        conn.execute("INSERT OR IGNORE INTO decks VALUES (?,?,?,?,?,?,?,?)", (deck_id, None, archetype, archetype, player, event, rank, day))
        conn.executemany("INSERT OR REPLACE INTO deck_cards VALUES (?,?,?,?)", [(deck_id, n, q, s) for n, q, s in cards])


def main(fmt="PAU"):
    conn = connect()
    conn.executescript(SCHEMA)
    html = get(f"format?f={fmt}")
    seen, events = set(), []
    for m in EVENT_RE.finditer(html):
        eid = int(m.group(1))
        if m.group(2) == fmt and eid not in seen:
            seen.add(eid)
            events.append((eid, m.group(3).strip(), m.group(4).strip(), f"20{m.group(7)}-{m.group(6)}-{m.group(5)}"))
    # Ediciones del destacado (también las que ya no salen en la portada)
    found = set()
    for _, _, searches in FEATURED:
        for q in searches:
            found |= set(re.findall(r"<a href=event\?e=(\d+)[^>]*>([^<]*@[^<]*)</a>",
                                    get(f"search?format={fmt}&event_titre=" + urllib.parse.quote(q.encode("cp1252")))))
    for eid, title in sorted(found):
        name, _, place = title.partition(" @ ")
        if int(eid) not in seen and is_featured(name, place):
            seen.add(int(eid))
            events.append((int(eid), name.strip(), place.strip(), None))
    new = 0
    for eid, name, place, day in events[:RECENT] + [e for e in events[RECENT:] if is_featured(e[1], e[2])]:
        featured = is_featured(name, place)
        if not conn.execute("SELECT 1 FROM tournaments WHERE id = ?", (eid,)).fetchone():
            page = get(f"event?e={eid}&f={fmt}")
            rows = [(r.group(1).strip(), int(r.group(3)), r.group(4).strip(), r.group(5).strip())
                    for r in ROW_RE.finditer(page) if int(r.group(2)) == eid]
            players = PLAYERS_RE.search(page)
            if not day:  # del buscador no sale la fecha: la primera de la página del torneo
                d = re.search(r"(\d\d)/(\d\d)/(\d\d)", page)
                day = f"20{d.group(3)}-{d.group(2)}-{d.group(1)}" if d else None
            with conn:
                conn.execute("INSERT INTO tournaments VALUES (?,?,?,?,?,?,?)",
                             (eid, fmt, name, place, day, featured, int(players.group(1)) if players else None))
                conn.executemany("INSERT OR IGNORE INTO tournament_decks VALUES (?,?,?,?,?)", [(eid, *r) for r in rows])
            new += 1
        day = day or conn.execute("SELECT date FROM tournaments WHERE id = ?", (eid,)).fetchone()[0]
        rows = conn.execute("SELECT rank, deck_id, archetype, player FROM tournament_decks WHERE event_id = ? ORDER BY rowid",
                            (eid,)).fetchall()
        for rank, deck_id, arch, player in rows[:FEATURED_TOP if featured else 1]:
            save_list(conn, deck_id, arch, player, f"{name} @ {place}", rank, day)
    print(f"Torneos {fmt}: {new} nuevos ({len(events)} en la lista de MTGTop8).")


if __name__ == "__main__":
    main()
