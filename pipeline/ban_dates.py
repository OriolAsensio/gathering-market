"""Fecha del próximo anuncio de baneos (Banned and Restricted) de Wizards, para avisar antes.

Cada anuncio oficial termina con "the next banned and restricted announcement will be on <fecha>".
Se guarda esa fecha; cuando llega, se lee el anuncio de ese día (su dirección sigue siempre el mismo
patrón) y de ahí sale la siguiente. Las cartas baneadas las detecta ingest_prices.py con Scryfall.
Avisos: al conocer la fecha, 3 días antes y el mismo día.
"""
import re
import urllib.request
from datetime import date, datetime, timedelta

from db import add_event, connect

URL = "https://magic.wizards.com/en/news/announcements/banned-and-restricted-{}"
SEED = "october-12-2026"  # último anuncio conocido al escribir esto
UA = {"User-Agent": "gathering-market-pipeline"}
NEXT = re.compile(r"next banned and restricted announcement will be (?:on )?(?:\w+day, )?([A-Z][a-z]+ \d{1,2}, \d{4})")
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def slug(d: date):
    return f"{d.strftime('%B').lower()}-{d.day}-{d.year}"


def next_date_from(page_slug):
    try:
        with urllib.request.urlopen(urllib.request.Request(URL.format(page_slug), headers=UA), timeout=30) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception:
        return None
    m = NEXT.search(html)
    return datetime.strptime(m.group(1), "%B %d, %Y").date() if m else None


def main():
    conn = connect()
    conn.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
    row = conn.execute("SELECT value FROM kv WHERE key = 'next_bans'").fetchone()
    nxt = date.fromisoformat(row[0]) if row else None
    today = date.today()
    if not nxt:
        nxt = next_date_from(SEED)
    elif nxt <= today:  # ya ha salido (o sale hoy): el anuncio de ese día dice el siguiente
        later = next_date_from(slug(nxt))
        if later and later > nxt:
            nxt = later
    if not nxt:
        print("Baneos: no he encontrado la fecha del próximo anuncio.")
        return
    when = f"{nxt.day} de {MESES[nxt.month - 1]} de {nxt.year}"
    with conn:
        conn.execute("INSERT OR REPLACE INTO kv VALUES ('next_bans', ?)", (nxt.isoformat(),))
        if nxt >= today and (not row or row[0] != nxt.isoformat()):  # fecha nueva: avisar una vez
            add_event(conn, today.isoformat(), "bans",
                      f"📅 Próximo anuncio de baneos: {when}", "Wizards anuncia ese día los baneos de todos los formatos (Estándar, Pioneer, Modern, Legacy, Vintage, Pauper y Commander).")
        if timedelta(0) <= nxt - today <= timedelta(days=3):
            add_event(conn, today.isoformat(), "bans",
                      "📅 Hoy hay anuncio de baneos" if nxt == today else f"📅 Anuncio de baneos el {when}",
                      "Las cartas baneadas aparecerán aquí en cuanto Scryfall las actualice.")
    print(f"Baneos: próximo anuncio el {nxt}.")


if __name__ == "__main__":
    main()
