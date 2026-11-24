"""Combos infinitos de dos cartas, de Commander Spellbook (base de datos pública de combos de Magic).

Solo combos de exactamente 2 cartas cuyo resultado es infinito (no sinergias). De cada uno se guardan
las dos cartas, qué produce, los requisitos, los pasos y en qué formatos es legal. La app busca cuáles
puedes montar con tu colección y te explica cómo funcionan. Es la misma base de combos que usa EDHREC
(edhrec.com/combos). Se descarga en cada vuelta de la tarea diaria, así los combos nuevos llegan enseguida.

Uso:  python pipeline/combos.py
"""
import json
import time
import urllib.request

from db import connect

URL = "https://backend.commanderspellbook.com/variants/?limit=100&q=cards%3D2%20result%3Ainfinite"
UA = {"User-Agent": "gathering-market-pipeline", "Accept": "application/json"}
FORMATS = {"pauper": "Pauper", "standard": "Estándar", "pioneer": "Pioneer", "modern": "Modern", "legacy": "Legacy",
           "vintage": "Vintage", "commander": "Commander"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def main():
    conn = connect()
    conn.execute("CREATE TABLE IF NOT EXISTS combos (id TEXT PRIMARY KEY, data TEXT)")
    url, rows = URL, []
    while url:
        page = fetch(url)
        for v in page["results"]:
            if len(v["uses"]) != 2 or v.get("status") != "OK" or v.get("spoiler"):
                continue
            needs = [r["template"]["name"] for r in v.get("requires") or [] if r.get("template")]
            pre = " ".join(x for x in (v.get("easyPrerequisites"), v.get("notablePrerequisites")) if x).strip()
            rows.append((v["id"], json.dumps({
                "cards": [u["card"]["name"] for u in v["uses"]],
                "zones": [u.get("zoneLocations") or [] for u in v["uses"]],
                "makes": [p["feature"]["name"] for p in v["produces"]][:4],
                "pre": pre, "needs": needs, "mana": v.get("manaNeeded") or "",
                "steps": [s.strip() for s in (v.get("description") or "").split("\n") if s.strip()],
                "legal": [f for f in FORMATS if (v.get("legalities") or {}).get(f)],
                "pop": v.get("popularity") or 0,
            }, ensure_ascii=False)))
        url = page.get("next")
        time.sleep(1)  # amable con su servidor
    if len(rows) < 500:  # algo ha ido mal: mejor quedarse con lo que había
        print(f"Combos: solo {len(rows)}, no se guardan.")
        return
    with conn:
        conn.execute("DELETE FROM combos")
        conn.executemany("INSERT OR REPLACE INTO combos VALUES (?,?)", rows)
    print(f"Combos: {len(rows)} combos infinitos de 2 cartas.")


if __name__ == "__main__":
    main()
