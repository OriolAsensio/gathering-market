"""Nombres impresos de las cartas en español, francés, alemán, italiano, portugués, japonés, coreano, ruso y chino (escáner).

Lee el fichero "all_cards" de Scryfall (todas las cartas en todos los idiomas, ~400 MB
comprimido) y guarda solo nombre impreso → nombre en inglés. Como precons.py, no hace
falta cada día: daily.py lo lanza si la tabla está vacía o una vez por semana.
"""
import gzip
import json
import urllib.request

from db import connect
from ingest_prices import BULK_INDEX, HEADERS, fetch_json

LANGS = {"es", "fr", "de", "it", "pt", "ja", "ko", "ru", "zhs", "zht"}


def main():
    url = next(b for b in fetch_json(BULK_INDEX)["data"] if b["type"] == "all_cards")["jsonl_download_uri"]
    names = set()
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=600) as resp, gzip.GzipFile(fileobj=resp) as gz:
        for line in gz:
            line = line.strip().rstrip(b",")
            if not line or line in (b"[", b"]"):
                continue
            c = json.loads(line)
            if c.get("lang") not in LANGS:
                continue
            faces = c.get("card_faces") or [c]
            printed = faces[0].get("printed_name") or c.get("printed_name")
            if printed:
                names.add((c["lang"], printed, c["name"].split(" // ")[0]))
    conn = connect()
    with conn:
        conn.execute("CREATE TABLE IF NOT EXISTS foreign_names (lang TEXT, printed TEXT, name TEXT, "
                     "PRIMARY KEY (lang, printed))")
        conn.execute("DELETE FROM foreign_names")
        conn.executemany("INSERT OR IGNORE INTO foreign_names VALUES (?,?,?)", sorted(names))
    print(f"Nombres en otros idiomas: {len(names)} guardados.")


if __name__ == "__main__":
    main()
