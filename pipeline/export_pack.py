"""Genera el "paquete de datos" que descarga la app del móvil.

La app lleva toda la lógica dentro y guarda tus cartas en el teléfono; solo necesita
estos ficheros, que se publican cada día en internet (GitHub Pages):

  version.json  día, versión de cartas y tamaños (la app lo mira primero; es pequeño)
  cards.json    cartas y sus impresiones (cambia solo cuando salen cartas nuevas)
  prices.json   precio de hoy y de hace 1, 7 y 30 días de cada impresión (cambia cada día)
  sets.json     ediciones
  meta.json     meta de Pauper y otros formatos: arquetipos, cuota y una lista de cada uno
  events.json   avisos (baneos, colecciones nuevas, cambios de meta)

Uso:  python pipeline/export_pack.py [carpeta_salida]   (por defecto: pack/)
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from db import ROOT, connect

RARITY = {"common": "c", "uncommon": "u", "rare": "r", "mythic": "m", "special": "s", "bonus": "b"}
PAUPER = {"legal": 1, "banned": 2}
NOT_TOKEN = ("type_line NOT LIKE '%Token%' AND type_line NOT LIKE '%Emblem%' "
             "AND type_line NOT LIKE 'Card%' AND type_line NOT LIKE '%Dungeon%'")


def dump(path, data):
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return text


def main(out=None):
    out = Path(out or ROOT / "pack")
    out.mkdir(parents=True, exist_ok=True)
    conn = connect()
    day = conn.execute("SELECT max(day) FROM prices").fetchone()[0]

    # --- Cartas: una entrada por nombre (o) y una por impresión (p) que apunta a su nombre.
    oracle, o_index, printings = [], {}, []
    rows = conn.execute(f"""
        SELECT id, name, front_name, set_code, collector_number, rarity, variant, type_line, mana_cost,
               cmc, color_identity, oracle_text, pauper, edhrec_rank, released_at, reserved, commander, standard
        FROM cards WHERE {NOT_TOKEN} ORDER BY front_name, released_at DESC""").fetchall()
    for (cid, name, front, set_code, number, rarity, variant, type_line, cost, cmc, ci, text,
         pauper, rank, released, reserved, commander, standard) in rows:
        if front not in o_index:
            o_index[front] = len(oracle)
            # [nombre, tipo, coste, cmc, identidad, texto, pauper, rank, reservada, commander, estándar]
            oracle.append([name, type_line or "", cost or "", cmc or 0, ci or "", text or "",
                           PAUPER.get(pauper, 0), rank or 0, reserved or 0,
                           PAUPER.get(commander, 0), PAUPER.get(standard, 0)])
        elif PAUPER.get(pauper, 0) and not oracle[o_index[front]][6]:
            oracle[o_index[front]][6] = PAUPER[pauper]  # legalidad por nombre (la más permisiva)
        printings.append([cid, o_index[front], set_code, number, RARITY.get(rarity, "c"), variant or 0])
    p_index = {p[0]: i for i, p in enumerate(printings)}
    cards_text = dump(out / "cards.json", {"o": oracle, "p": printings})
    cards_version = hashlib.sha1(cards_text.encode()).hexdigest()[:12]

    # --- Precios alineados con "p": [eur, eur_foil] de hoy y eur de hace 1, 7 y 30 días (céntimos).
    def prices_at(d):
        return dict(((r[0], (r[1], r[2])) for r in conn.execute(
            "SELECT card_id, eur, eur_foil FROM prices WHERE day = ?", (d,)))) if d else {}

    def day_before(n):
        return conn.execute("SELECT max(day) FROM prices WHERE day <= date(?, ?)", (day, f"-{n} days")).fetchone()[0]

    now = prices_at(day)
    back = {n: prices_at(day_before(n)) for n in (1, 7, 30)}
    days = {n: day_before(n) for n in (1, 7, 30)}
    cols = [[], [], [], [], []]  # eur, eur_foil, eur_1d, eur_7d, eur_30d
    for p in printings:
        e, ef = now.get(p[0], (None, None))
        cols[0].append(e)
        cols[1].append(ef)
        for i, n in enumerate((1, 7, 30)):
            cols[2 + i].append(back[n].get(p[0], (None, None))[0])
    dump(out / "prices.json", {"day": day, "cards_version": cards_version, "days": days,
                               "eur": cols[0], "eur_foil": cols[1], "d1": cols[2], "d7": cols[3], "d30": cols[4]})

    # --- Ediciones.
    sets = conn.execute("""SELECT code, name, set_type, released_at, icon_svg FROM sets
                           WHERE coalesce(digital, 0) = 0
                           AND set_type NOT IN ('token', 'memorabilia', 'minigame', 'treasure_chest')""").fetchall()
    dump(out / "sets.json", [list(s) for s in sets])

    # --- Meta (última foto de cada formato).
    meta = []
    for fmt, arch_id, arch, cat, share, deck_id in conn.execute(
            "SELECT format, archetype_id, archetype, category, share, deck_id FROM meta m "
            "WHERE day = (SELECT max(day) FROM meta WHERE format = m.format) ORDER BY format, share DESC"):
        d = conn.execute("SELECT player, event, result, date FROM decks WHERE id = ?", (deck_id,)).fetchone()
        cards = conn.execute("SELECT name, qty, sideboard FROM deck_cards WHERE deck_id = ? ORDER BY sideboard, name",
                             (deck_id,)).fetchall()
        meta.append(dict(id=deck_id, format=fmt, archetype=arch, category=cat, share=share, player=d[0], event=d[1],
                         result=d[2], date=d[3], cards=[list(c) for c in cards]))
    dump(out / "meta.json", meta)

    # --- Avisos generales (los de tus cartas los calcula el móvil).
    events = conn.execute("SELECT id, day, kind, title, body FROM events WHERE kind != 'price' OR title LIKE '%mazos top%' "
                          "ORDER BY id DESC LIMIT 100").fetchall()
    dump(out / "events.json", [dict(id=e[0], day=e[1], kind=e[2], title=e[3], body=e[4]) for e in events])

    # --- Mazos preconstruidos y nombres en otros idiomas (si ya se han descargado; ver precons.py
    #     y foreign_names.py). La app los descarga solo cuando hacen falta.
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "precons" in tables:
        dump(out / "precons.json", [[pid, name, kind, released, set_code,
                                     [[p_index[i], n] for i, n in json.loads(cards) if i in p_index],
                                     [p_index[i] for i in json.loads(cmd) if i in p_index]]
                                    for pid, name, kind, released, set_code, cards, cmd in conn.execute(
                                        "SELECT * FROM precons ORDER BY released DESC")])
    if "foreign_names" in tables:
        names = {}
        for lang, printed, name in conn.execute("SELECT lang, printed, name FROM foreign_names"):
            if name in o_index:
                names.setdefault(lang, {})[printed] = o_index[name]
        dump(out / "names.json", names)

    sizes = {f.name: f.stat().st_size for f in out.glob("*.json") if f.name != "version.json"}
    # Huella del meta y los avisos: la segunda vuelta del día puede traer meta nuevo con el mismo "day".
    live = hashlib.sha1(b"".join((out / f).read_bytes() for f in ("meta.json", "events.json"))).hexdigest()[:12]
    dump(out / "version.json", {"day": day, "cards_version": cards_version, "live_version": live, "sizes": sizes,
                                "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "format": 1})
    print(f"Paquete {day} en {out}: " + ", ".join(f"{k} {v / 1e6:.1f} MB" for k, v in sizes.items()))
    print(f"{len(oracle)} cartas, {len(printings)} impresiones, {len(p_index)} ids")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
