"""Genera el "paquete de datos" que descarga la app del móvil.

La app lleva toda la lógica dentro y guarda tus cartas en el teléfono; solo necesita
estos ficheros, que se publican cada día en internet (GitHub Pages):

  version.json  día, versión de cartas y tamaños (la app lo mira primero; es pequeño)
  cards.json    cartas y sus impresiones (cambia solo cuando salen cartas nuevas)
  prices.json   precio de hoy y de hace 1, 7 y 30 días de cada impresión (cambia cada día)
  sets.json     ediciones
  meta.json     meta de Pauper y otros formatos: arquetipos, cuota y una lista de cada uno
  staples.json  staples de cada formato: % del meta que juega cada carta y copias de media
  events.json   avisos (baneos, colecciones nuevas, cambios de meta)
  tournaments.json  últimos torneos de Pauper (ganador) y el destacado (Super Pauper de inGenio BCN, top 8), con listas
  changes.json  impresiones que se han movido >= 10 % y >= 0,50 € desde el día anterior (para las notificaciones)
  history/XX.json  historial de precio de cada impresión (por las 2 primeras letras de su id), para la gráfica

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
    out = Path(out or ROOT / "app" / "pack")  # por defecto, la copia que usan el servidor local y el APK
    out.mkdir(parents=True, exist_ok=True)
    conn = connect()
    day = conn.execute("SELECT max(day) FROM prices").fetchone()[0]

    # --- Cartas: una entrada por nombre (o) y una por impresión (p) que apunta a su nombre.
    oracle, o_index, printings = [], {}, []
    rows = conn.execute(f"""
        SELECT id, name, front_name, set_code, collector_number, rarity, variant, type_line, mana_cost,
               cmc, color_identity, oracle_text, pauper, edhrec_rank, released_at, reserved, commander, standard,
               coalesce(game_changer, 0), coalesce(legal, '')
        FROM cards WHERE {NOT_TOKEN} ORDER BY front_name, released_at DESC""").fetchall()
    for (cid, name, front, set_code, number, rarity, variant, type_line, cost, cmc, ci, text,
         pauper, rank, released, reserved, commander, standard, game_changer, legal) in rows:
        if front not in o_index:
            o_index[front] = len(oracle)
            # [nombre, tipo, coste, cmc, identidad, texto, pauper, rank, reservada, commander, estándar, game changer, legalidades]
            oracle.append([name, type_line or "", cost or "", cmc or 0, ci or "", text or "",
                           PAUPER.get(pauper, 0), rank or 0, reserved or 0,
                           PAUPER.get(commander, 0), PAUPER.get(standard, 0), game_changer, legal])
        elif PAUPER.get(pauper, 0) and not oracle[o_index[front]][6]:
            oracle[o_index[front]][6] = PAUPER[pauper]  # legalidad por nombre (la más permisiva)
        if legal and front in o_index:  # legalidades: la más permisiva de todas sus impresiones (por formato)
            cur = oracle[o_index[front]][12] or "0" * len(legal)
            oracle[o_index[front]][12] = "".join(max(x, y, key=lambda c: {"1": 3, "3": 2, "2": 1}.get(c, 0)) for x, y in zip(cur.ljust(len(legal), "0"), legal))
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

    # --- Historial para la gráfica de cada carta: 256 ficheros pequeños (la app baja solo el de la carta que abres).
    #     Precio normal en céntimos alineado con "days"; solo impresiones que alguna vez valieron 0,10 € o más.
    hist = out / "history"
    hist.mkdir(exist_ok=True)
    all_days = [r[0] for r in conn.execute("SELECT DISTINCT day FROM prices ORDER BY day")]
    pos = {d: i for i, d in enumerate(all_days)}
    for a in "0123456789abcdef":
        for b in "0123456789abcdef":
            series = {}
            for cid, d, e in conn.execute("SELECT card_id, day, eur FROM prices WHERE card_id >= ? AND card_id < ? AND eur IS NOT NULL",
                                          (a + b, a + b + "~")):
                series.setdefault(cid, [None] * len(all_days))[pos[d]] = e
            dump(hist / f"{a}{b}.json", {"days": all_days, "c": {k: v for k, v in series.items() if max(x or 0 for x in v) >= 10}})

    # --- Cambios desde el día anterior (la tarea en segundo plano del móvil solo baja esto). Clave: id (normal) o id+"f" (foil).
    changes = {}
    for p in printings:
        n, o = now.get(p[0], (None, None)), back[1].get(p[0], (None, None))
        for i, suffix in ((0, ""), (1, "f")):
            a, b = o[i], n[i]
            # (céntimos que se multiplican por 10 de golpe suelen ser un error del precio medio de Cardmarket: no se avisa)
            if a and b and a >= 10 and not (b > a * 10 and a < 100) and abs(b - a) >= 50 and abs(b - a) / a >= 0.10:
                changes[p[0] + suffix] = [a, b]
    dump(out / "changes.json", {"day": day, "base": days[1], "c": changes})

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
        if not d:
            continue  # lista que no se pudo bajar
        cards = conn.execute("SELECT name, qty, sideboard FROM deck_cards WHERE deck_id = ? ORDER BY sideboard, name",
                             (deck_id,)).fetchall()
        meta.append(dict(id=deck_id, format=fmt, archetype=arch, category=cat, share=share, player=d[0], event=d[1],
                         result=d[2], date=d[3], cards=[list(c) for c in cards]))
    # Formatos sin meta de torneo (Dandân, Value Vintage…): mazos de ejemplo escritos a mano.
    examples = json.loads((ROOT / "pipeline" / "example_decks.json").read_text(encoding="utf-8"))
    for i, d in enumerate(examples):
        meta.append(dict(id=-1 - i, format=d["format"], archetype=d["name"], category=d.get("category", ""), share=None,
                         player=d.get("player", ""), event=d.get("source", ""), result="", date="", example=True,
                         note=d.get("note", ""), cards=[[n, q, s] for n, q, s in d["cards"]]))
    dump(out / "meta.json", meta)

    # --- Staples de cada formato (como en MTGDecks): de todas las listas que se miran de cada arquetipo,
    # qué parte del meta juega cada carta (cuota del arquetipo × proporción de sus listas que la llevan) y cuántas copias.
    staples = {}
    for (fmt,) in conn.execute("SELECT DISTINCT format FROM meta"):
        mday = conn.execute("SELECT max(day) FROM meta WHERE format = ?", (fmt,)).fetchone()[0]  # no pisar "day" (el de precios)
        archs = conn.execute("SELECT archetype_id, share, deck_id FROM meta WHERE format = ? AND day = ?", (fmt, mday)).fetchall()
        total = sum(s or 0 for _, s, _ in archs) or 1
        score, copies, lists_with, n_lists = {}, {}, {}, 0
        for arch_id, share, main_deck in archs:
            ids = [d for (d,) in conn.execute(
                "SELECT deck_id FROM meta_lists WHERE format = ? AND day = ? AND archetype_id = ?", (fmt, mday, arch_id))] or [main_deck]
            n_lists += len(ids)
            per = {}
            for d in ids:
                for name, qty in conn.execute("SELECT name, sum(qty) FROM deck_cards WHERE deck_id = ? GROUP BY name", (d,)):
                    per.setdefault(name, []).append(qty)
            for name, qs in per.items():
                score[name] = score.get(name, 0) + (share or 0) * len(qs) / len(ids)
                copies[name] = copies.get(name, 0) + sum(qs)
                lists_with[name] = lists_with.get(name, 0) + len(qs)
        BASIC = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"} | {f"Snow-Covered {b}" for b in ("Plains", "Island", "Swamp", "Mountain", "Forest")}
        rows = sorted(((n, round(100 * v / total, 1), round(copies[n] / lists_with[n], 1), lists_with[n])
                       for n, v in score.items() if n not in BASIC), key=lambda r: -r[1])[:150]
        staples[fmt] = {"lists": n_lists, "cards": [list(r) for r in rows]}
    dump(out / "staples.json", staples)

    # --- Torneos: los 12 más recientes y todas las ediciones del destacado.
    tours = []
    if "tournaments" in {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}:
        for eid, fmt, name, place, tday, featured, players in conn.execute(
                "SELECT * FROM tournaments WHERE featured > 0 OR id IN (SELECT id FROM tournaments ORDER BY date DESC, id DESC LIMIT 12) "
                "ORDER BY date DESC, id DESC"):
            top = []
            for rank, deck_id, arch, player in conn.execute(
                    "SELECT rank, deck_id, archetype, player FROM tournament_decks WHERE event_id = ? ORDER BY rowid LIMIT 16", (eid,)):
                cards = conn.execute("SELECT name, qty, sideboard FROM deck_cards WHERE deck_id = ? ORDER BY sideboard, name", (deck_id,)).fetchall()
                top.append(dict(rank=rank, id=deck_id, archetype=arch, player=player, cards=[list(c) for c in cards]))
            tours.append(dict(id=eid, format=fmt, name=name, place=place, date=tday, featured=featured, players=players, top=top))
    dump(out / "tournaments.json", tours)

    # --- Avisos generales (los de tus cartas los calcula el móvil).
    events = conn.execute("SELECT id, day, kind, title, body FROM events WHERE kind != 'price' OR title LIKE '%mazos top%' "
                          "ORDER BY id DESC LIMIT 100").fetchall()
    dump(out / "events.json", [dict(id=e[0], day=e[1], kind=e[2], title=e[3], body=e[4]) for e in events])

    # --- Mazos preconstruidos y nombres en otros idiomas (si ya se han descargado; ver precons.py
    #     y foreign_names.py). La app los descarga solo cuando hacen falta.
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "precons" in tables:
        dump(out / "precons.json", [[pid, name, kind, released, set_code,
                                     [[p_index[c[0]], c[1], c[2] if len(c) > 2 else 0] for c in json.loads(cards) if c[0] in p_index],
                                     [p_index[i] for i in json.loads(cmd) if i in p_index]]
                                    for pid, name, kind, released, set_code, cards, cmd in conn.execute(
                                        "SELECT * FROM precons ORDER BY released DESC")])
    if "combos" in tables:  # combos infinitos de 2 cartas (Commander Spellbook); la app lo baja al abrir los combos
        dump(out / "combos.json", [json.loads(d) for (d,) in conn.execute("SELECT data FROM combos ORDER BY id")])
    if "foreign_names" in tables:
        names = {}
        for lang, printed, name in conn.execute("SELECT lang, printed, name FROM foreign_names"):
            if name in o_index:
                names.setdefault(lang, {})[printed] = o_index[name]
        dump(out / "names.json", names)

    sizes = {f.name: f.stat().st_size for f in out.glob("*.json") if f.name != "version.json"}
    sizes["history"] = sum(f.stat().st_size for f in hist.glob("*.json"))
    # Huella del meta y los avisos: la segunda vuelta del día puede traer meta nuevo con el mismo "day".
    live = hashlib.sha1(b"".join((out / f).read_bytes() for f in ("meta.json", "events.json", "staples.json", "tournaments.json"))).hexdigest()[:12]
    dump(out / "version.json", {"day": day, "cards_version": cards_version, "live_version": live, "sizes": sizes,
                                "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "format": 1})
    print(f"Paquete {day} en {out}: " + ", ".join(f"{k} {v / 1e6:.1f} MB" for k, v in sizes.items()))
    print(f"{len(oracle)} cartas, {len(printings)} impresiones, {len(p_index)} ids")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
