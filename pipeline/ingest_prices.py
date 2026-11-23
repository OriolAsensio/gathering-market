"""Descarga diaria de cartas y precios desde Scryfall y los guarda en SQLite.

Uso:  python pipeline/ingest_prices.py          (salta si el día ya está guardado)
      python pipeline/ingest_prices.py --force  (vuelve a descargar el día)

Scryfall actualiza sus ficheros masivos una vez al día; ejecutar esto más de
una vez al día no aporta nada. También detecta baneos/desbaneos en Pauper.
"""
import gzip
import json
import sys
import urllib.request
from datetime import datetime, timezone

from db import add_event, connect

HEADERS = {"User-Agent": "MTGPriceTracker/0.1", "Accept": "application/json"}
BULK_INDEX = "https://api.scryfall.com/bulk-data"


def fetch_json(url: str):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def cents(value):
    return round(float(value) * 100) if value else None


def card_row(c: dict):
    faces = c.get("card_faces") or []
    oracle_text = c.get("oracle_text")
    if oracle_text is None and faces:
        oracle_text = "\n//\n".join(f.get("oracle_text", "") for f in faces)
    images = c.get("image_uris") or (faces[0].get("image_uris") if faces else None) or {}
    return (
        c["id"], c.get("oracle_id"), c["name"], c["set"], c.get("set_name"),
        c.get("collector_number"), c.get("rarity"), c.get("type_line"), oracle_text,
        c.get("mana_cost") or (faces[0].get("mana_cost") if faces else None), c.get("cmc"),
        "".join(c.get("color_identity", [])), ",".join(c.get("keywords", [])),
        c.get("released_at"), c.get("edhrec_rank"), int(bool(c.get("reprint"))),
        images.get("normal"), c.get("legalities", {}).get("pauper"),
        c["name"].split(" // ")[0], int(is_variant(c)),
        int(bool(c.get("reserved"))), c.get("legalities", {}).get("commander"),
        c.get("legalities", {}).get("standard"), int(bool(c.get("game_changer"))),
    )


VARIANT_FRAMES = {"showcase", "extendedart", "inverted", "etched", "shatteredglass"}


def is_variant(c: dict) -> bool:
    """Versión especial (promo, sin borde, showcase...) y no la carta normal de la colección."""
    basic = (c.get("type_line") or "").startswith("Basic")
    return bool(
        c.get("promo") or c.get("border_color") == "borderless"
        or VARIANT_FRAMES & set(c.get("frame_effects") or [])
        or (c.get("full_art") and not basic)
        or not str(c.get("collector_number", "")).isdigit())


def pauper_status(conn):
    return dict(conn.execute(
        "SELECT name, pauper FROM cards WHERE pauper IN ('legal','banned') GROUP BY oracle_id"))


def main(force: bool = False):
    bulk = next(b for b in fetch_json(BULK_INDEX)["data"] if b["type"] == "default_cards")
    day = bulk["updated_at"][:10]
    url = bulk["jsonl_download_uri"]

    conn = connect()
    if not force and conn.execute("SELECT 1 FROM ingests WHERE day = ?", (day,)).fetchone():
        print(f"El día {day} ya está guardado. Usa --force para repetirlo.")
        return

    before = pauper_status(conn)
    print(f"Descargando {url} ({bulk['compressed_size'] // 1_000_000} MB comprimido)...")
    cards = priced = 0
    card_batch, price_batch = [], []

    def flush():
        conn.executemany(
            "INSERT OR REPLACE INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", card_batch)
        conn.executemany(
            "INSERT OR REPLACE INTO prices VALUES (?,?,?,?,?,?)", price_batch)
        card_batch.clear()
        price_batch.clear()

    req = urllib.request.Request(url, headers=HEADERS)
    with conn, urllib.request.urlopen(req, timeout=120) as resp, gzip.GzipFile(fileobj=resp) as gz:
        for line in gz:
            line = line.strip().rstrip(b",")
            if not line or line in (b"[", b"]"):
                continue
            c = json.loads(line)
            if c.get("digital") and not c.get("prices", {}).get("eur"):
                continue  # cartas solo de Arena/MTGO sin precio en papel
            cards += 1
            card_batch.append(card_row(c))
            p = c.get("prices", {})
            row = (c["id"], day, cents(p.get("eur")), cents(p.get("eur_foil")),
                   cents(p.get("usd")), cents(p.get("usd_foil")))
            if any(v is not None for v in row[2:]):
                priced += 1
                price_batch.append(row)
            if len(card_batch) >= 5000:
                flush()
        flush()

        # Baneos / desbaneos en Pauper (solo si ya teníamos el estado anterior).
        if before:
            for name, status in pauper_status(conn).items():
                old = before.get(name)
                if old == "legal" and status == "banned":
                    add_event(conn, day, "ban", f"🚫 Baneada en Pauper: {name}")
                elif old == "banned" and status == "legal":
                    add_event(conn, day, "unban", f"✅ Desbaneada en Pauper: {name}")

        conn.execute(
            "INSERT OR REPLACE INTO ingests VALUES (?,?,?,?,?)",
            (day, url, cards, priced, datetime.now(timezone.utc).isoformat(timespec="seconds")))

    print(f"Listo: {cards} cartas, {priced} con precio, día {day}.")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
