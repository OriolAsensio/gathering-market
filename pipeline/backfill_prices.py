"""Rellena el historial de precios de Cardmarket con los últimos 90 días de MTGJSON.

Scryfall solo da el precio de hoy, así que sin esto las predicciones y las gráficas tardan semanas
en tener datos. MTGJSON (gratis, licencia MIT) publica 90 días de Cardmarket de cada impresión.
Solo se descarga cuando falta historial (los primeros días o si la base de datos se pierde) y
nunca pisa los precios que ya hay (INSERT OR IGNORE). Respeta el mismo resumen que prune_prices:
diario el último mes y un precio por semana (lunes) lo anterior.

Uso:  python pipeline/backfill_prices.py [--force]
"""
import csv
import io
import json
import lzma
import sys
import urllib.request
from datetime import date, timedelta

from db import connect

BASE = "https://mtgjson.com/api/v5/"
DAILY_DAYS = 35  # el mismo que daily.prune_prices
UA = {"User-Agent": "gathering-market-pipeline"}


def fetch(name):
    with urllib.request.urlopen(urllib.request.Request(BASE + name, headers=UA), timeout=300) as r:
        return r.read()


def keep_cardmarket(pairs):
    """Al leer el JSON, de cada carta solo se guarda Cardmarket (el fichero entero ocupa ~6 GB en memoria)."""
    d = dict(pairs)
    if "paper" in d:
        return (d["paper"].get("cardmarket") or {}).get("retail") or {}
    return d


def needed(conn):
    first = conn.execute("SELECT min(day) FROM prices").fetchone()[0]
    return not first or first > (date.today() - timedelta(days=28)).isoformat()


def main(force=False):
    conn = connect()
    if not force and not needed(conn):
        print("Historial: ya hay más de 4 semanas, no hace falta MTGJSON.")
        return
    ids = {}
    with lzma.open(io.BytesIO(fetch("csv/cardIdentifiers.csv.xz")), "rt", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["scryfallId"]:
                ids[row["uuid"]] = row["scryfallId"]
    with lzma.open(io.BytesIO(fetch("AllPrices.json.xz")), "rt", encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=keep_cardmarket)["data"]
    known = {r[0] for r in conn.execute("SELECT id FROM cards")}
    cutoff = (date.today() - timedelta(days=DAILY_DAYS)).isoformat()
    keep_day = lambda d: d >= cutoff or date.fromisoformat(d).weekday() == 0
    cents = lambda v: round(v * 100) if v else None
    merged = {}  # (scryfall id, día) -> [eur, eur_foil]; una impresión puede tener dos uuid (normal y foil)
    for uuid, retail in data.items():
        sid = ids.get(uuid)
        if sid not in known or not retail:
            continue
        for col, kind in ((0, "normal"), (1, "foil")):
            for d, v in (retail.get(kind) or {}).items():
                if keep_day(d):
                    merged.setdefault((sid, d), [None, None])[col] = cents(v)
    with conn:
        before = conn.total_changes
        conn.executemany("INSERT OR IGNORE INTO prices (card_id, day, eur, eur_foil) VALUES (?, ?, ?, ?)",
                         ((sid, d, e, f) for (sid, d), (e, f) in merged.items()))
        added = conn.total_changes - before
    days = sorted({d for _, d in merged})
    print(f"Historial de MTGJSON: {added} precios nuevos ({days[0] if days else '-'} a {days[-1] if days else '-'}).")


if __name__ == "__main__":
    main("--force" in sys.argv)
