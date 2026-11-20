"""Cartas que más han subido y bajado (precio Cardmarket, EUR).

Uso:  python pipeline/movers.py                 (últimos 7 días, cartas de >= 1 €)
      python pipeline/movers.py --days 30 --min 5 --top 20
"""
import argparse

from db import connect


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="ventana en días")
    ap.add_argument("--min", type=float, default=1.0, help="precio mínimo en € (filtra ruido)")
    ap.add_argument("--top", type=int, default=15)
    args = ap.parse_args()

    conn = connect()
    latest = conn.execute("SELECT max(day) FROM prices").fetchone()[0]
    # El día guardado más cercano a `latest - days` sin pasarse.
    base = conn.execute(
        "SELECT max(day) FROM prices WHERE day <= date(?, ?)", (latest, f"-{args.days} days")
    ).fetchone()[0]
    if not base:
        first = conn.execute("SELECT min(day) FROM prices").fetchone()[0]
        print(f"Aún no hay historial suficiente: hay datos desde {first} hasta {latest}. "
              f"Hacen falta {args.days} días.")
        return

    rows = conn.execute(
        """
        SELECT c.name, c.set_code, c.rarity, old.eur / 100.0, new.eur / 100.0,
               (new.eur - old.eur) * 100.0 / old.eur AS pct
        FROM prices new
        JOIN prices old ON old.card_id = new.card_id AND old.day = ?
        JOIN cards c ON c.id = new.card_id
        WHERE new.day = ? AND old.eur IS NOT NULL AND new.eur IS NOT NULL
          AND max(old.eur, new.eur) >= ?
        """,
        (base, latest, round(args.min * 100)),
    ).fetchall()

    def show(title, items):
        print(f"\n{title}")
        for name, set_code, rarity, old, new, pct in items:
            print(f"  {pct:+7.1f}%  {old:8.2f} € → {new:8.2f} €  {name} ({set_code.upper()}, {rarity})")

    print(f"Comparando {base} → {latest} ({len(rows)} cartas de >= {args.min:g} €)")
    show("📈 Más suben", sorted(rows, key=lambda r: r[5], reverse=True)[: args.top])
    show("📉 Más bajan", sorted(rows, key=lambda r: r[5])[: args.top])


if __name__ == "__main__":
    main()
