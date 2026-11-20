"""Avisos de precio: compara el último día con el anterior.

- Cartas de mi colección que se mueven >= 10 % (y al menos 0,50 €).
- Cartas de los mazos top de Pauper que se mueven >= 15 % (y valen >= 1 €).
"""
from db import add_event, cheapest_by_name, connect, norm


def main():
    conn = connect()
    days = [r[0] for r in conn.execute("SELECT DISTINCT day FROM prices ORDER BY day DESC LIMIT 2")]
    if len(days) < 2:
        print("Avisos de precio: hace falta al menos un día anterior para comparar.")
        return
    new_day, old_day = days
    count = 0

    with conn:
        # Solo "Mi colección" (id 1); las de amigos no generan avisos.
        for name, set_code, foil, old, new in conn.execute(
            """SELECT c.name, c.set_code, col.foil,
                      CASE col.foil WHEN 1 THEN po.eur_foil ELSE po.eur END,
                      CASE col.foil WHEN 1 THEN pn.eur_foil ELSE pn.eur END
               FROM collection col JOIN cards c ON c.id = col.card_id
               JOIN prices po ON po.card_id = c.id AND po.day = ?
               JOIN prices pn ON pn.card_id = c.id AND pn.day = ?
               WHERE col.collection_id = 1""", (old_day, new_day)).fetchall():
            if old and new and abs(new - old) >= 50 and abs(new - old) / old >= 0.10:
                pct = (new - old) * 100 / old
                add_event(conn, new_day, "price",
                          f"{'📈' if pct > 0 else '📉'} {name} ({set_code.upper()}{' foil' if foil else ''}) {pct:+.0f}%",
                          f"Tu carta: {old / 100:.2f} € → {new / 100:.2f} €")
                count += 1

        old_p, new_p = cheapest_by_name(conn, old_day), cheapest_by_name(conn, new_day)
        meta_cards = {r[0] for r in conn.execute(
            "SELECT DISTINCT dc.name FROM deck_cards dc JOIN meta m ON m.deck_id = dc.deck_id "
            "WHERE m.day = (SELECT max(day) FROM meta)")}
        for name in meta_cards:
            old, new = old_p.get(norm(name)), new_p.get(norm(name))
            if old and new and max(old, new) >= 100 and abs(new - old) / old >= 0.15:
                pct = (new - old) * 100 / old
                add_event(conn, new_day, "price",
                          f"{'📈' if pct > 0 else '📉'} {name} {pct:+.0f}% (mazos top Pauper)",
                          f"Precio más barato: {old / 100:.2f} € → {new / 100:.2f} €")
                count += 1
    print(f"Avisos de precio: {count} nuevos ({old_day} → {new_day}).")


if __name__ == "__main__":
    main()
