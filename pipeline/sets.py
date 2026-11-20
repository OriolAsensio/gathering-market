"""Colecciones (ediciones) de Scryfall: las guarda/actualiza y avisa de las nuevas.

También avisa cuando una colección que sigues (fijada) sale a la venta.
"""
import json
import urllib.request
from datetime import date

from db import add_event, connect
from ingest_prices import HEADERS

# Tipos de colección que pueden traer cartas nuevas para Pauper.
RELEVANT = {"expansion", "core", "draft_innovation", "masters", "commander", "funny"}


def main():
    req = urllib.request.Request("https://api.scryfall.com/sets", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        sets = json.load(resp)["data"]

    conn = connect()
    known = {r[0] for r in conn.execute("SELECT code FROM sets")}
    today = date.today().isoformat()
    new = 0
    with conn:
        for s in sets:
            conn.execute(
                "INSERT OR REPLACE INTO sets (code, name, set_type, released_at, card_count, icon_svg, printed_size, digital) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (s["code"], s["name"], s["set_type"], s.get("released_at"), s.get("card_count"),
                 s.get("icon_svg_uri"), s.get("printed_size"), int(bool(s.get("digital")))))
            if known and s["code"] not in known and s["set_type"] in RELEVANT and not s.get("digital"):
                new += 1
                add_event(conn, today, "set", f"🆕 Nueva colección: {s['name']}",
                          f"Sale el {s.get('released_at', '?')}. Revisa qué cartas antiguas pueden subir.")
        for name, in conn.execute("SELECT s.name FROM pinned_sets p JOIN sets s ON s.code = p.set_code "
                                  "WHERE s.released_at = ? AND p.collection_id = 1", (today,)).fetchall():
            add_event(conn, today, "set", f"📜 Hoy sale {name}", "Es una colección que sigues.")
    print(f"Colecciones: {len(sets)} en Scryfall, {new} nuevas con aviso.")


if __name__ == "__main__":
    main()
