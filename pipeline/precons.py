"""Mazos preconstruidos oficiales de toda la historia (MTGJSON → tabla precons).

Descarga AllDeckFiles.zip (~260 MB) y guarda solo qué cartas lleva cada mazo. No hace falta
repetirlo cada día: daily.py lo lanza si la tabla está vacía o una vez por semana.
"""
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from db import connect

URL = "https://mtgjson.com/api/v5/AllDeckFiles.zip"
# Mazos que se vendieron como tales (fuera Secret Lair, medios mazos de Jumpstart, MTGO…).
TYPES = {"Commander Deck", "Theme Deck", "Intro Pack", "Planeswalker Deck", "Duel Deck", "Event Deck",
         "Challenger Deck", "Starter Deck", "Welcome Deck", "Game Night Deck", "Guild Kit", "Clash Pack",
         "World Championship Deck", "Premium Deck", "Advanced Deck", "Enhanced Deck", "Starter Kit",
         "Brawl Deck", "Archenemy Deck", "Planechase Deck", "Modern Event Deck", "Spellslinger Starter Kit"}

SCHEMA = """CREATE TABLE IF NOT EXISTS precons (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, released TEXT, set_code TEXT,
    cards TEXT,          -- JSON [[scryfall_id, copias], ...]
    commanders TEXT      -- JSON [scryfall_id, ...]
)"""


def main():
    conn = connect()
    conn.execute(SCHEMA)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "decks.zip"
        req = urllib.request.Request(URL, headers={"User-Agent": "MTGPriceTracker/0.1"})
        with urllib.request.urlopen(req, timeout=600) as resp, open(path, "wb") as out:
            while chunk := resp.read(1 << 20):
                out.write(chunk)
        rows = []
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                if not info.filename.endswith(".json"):
                    continue
                d = json.loads(z.read(info)).get("data", {})
                if d.get("type") not in TYPES:
                    continue
                def ids(board):
                    return [[c["identifiers"]["scryfallId"], c.get("count", 1)]
                            for c in d.get(board) or [] if c.get("identifiers", {}).get("scryfallId")]
                cards = ids("commander") + ids("mainBoard") + ids("sideBoard")
                if cards:
                    rows.append((Path(info.filename).stem, d.get("name"), d.get("type"), d.get("releaseDate"),
                                 (d.get("code") or "").lower(), json.dumps(cards),
                                 json.dumps([c[0] for c in ids("commander")])))
    with conn:
        conn.execute("DELETE FROM precons")
        conn.executemany("INSERT INTO precons VALUES (?,?,?,?,?,?,?)", rows)
    print(f"Mazos preconstruidos: {len(rows)} guardados.")


if __name__ == "__main__":
    main()
