"""Tarea diaria: precios, colecciones, meta de Pauper, avisos, notificaciones y paquete de datos.

Se ejecuta cada día en GitHub Actions (.github/workflows/daily.yml), que publica el paquete
en GitHub Pages para la app. También puede lanzarse a mano en el PC:

    python pipeline/daily.py            (registro en data/daily.log)
    python pipeline/daily.py --stdout   (registro en pantalla; así lo usa GitHub)
"""
import json
import sys
import traceback
from datetime import datetime

from db import ROOT, connect

LOG = ROOT / "data" / "daily.log"
DAILY_DAYS = 35  # días con precio diario; lo anterior se queda en un precio por semana


def prune_prices():
    """Mantiene la base de datos pequeña: diario el último mes, semanal (lunes) lo anterior."""
    conn = connect()
    with conn:
        cur = conn.execute("DELETE FROM prices WHERE day < date('now', ?) AND strftime('%w', day) != '1'",
                           (f"-{DAILY_DAYS} days",))
    if cur.rowcount:
        conn.execute("VACUUM")
    print(f"Historial: {cur.rowcount} precios antiguos resumidos a semanales.")


def main():
    if "--stdout" not in sys.argv:
        LOG.parent.mkdir(exist_ok=True)
        sys.stdout = sys.stderr = open(LOG, "a", encoding="utf-8", buffering=1)
    print(f"\n=== {datetime.now():%Y-%m-%d %H:%M} ===")

    import alerts, backfill_prices, ban_dates, combos, tournaments, export_pack, foreign_names, ingest_prices, notify, pauper_meta, precons, sets
    out = sys.argv[sys.argv.index("--pack") + 1] if "--pack" in sys.argv else None
    conn = connect()
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    weekly = datetime.now().weekday() == 0  # lunes: lo que cambia poco (y pesa mucho)
    steps = [("precios", ingest_prices.main), ("historial MTGJSON", backfill_prices.main), ("colecciones", sets.main)]
    # (también si los mazos guardados son de antes de separar main y banquillo)
    old_precons = "precons" in tables and len((json.loads(conn.execute("SELECT cards FROM precons LIMIT 1").fetchone()[0] or "[[]]") or [[]])[0]) < 3
    if weekly or "precons" not in tables or old_precons:
        steps.append(("mazos preconstruidos", precons.main))
    steps.append(("combos", combos.main))  # en cada vuelta (~1 min): los combos nuevos llegan enseguida
    if weekly or "foreign_names" not in tables:
        steps.append(("nombres en otros idiomas", foreign_names.main))
    steps += [
             ("meta pauper", pauper_meta.main), ("torneos", tournaments.main), ("anuncios de baneos", ban_dates.main), ("avisos", alerts.main),
             ("notificaciones", notify.main), ("historial", prune_prices),
             ("paquete", lambda: export_pack.main(out))]
    failed = False
    for name, fn in steps:
        try:
            fn()
        except BaseException:  # sigue con el resto aunque falle un paso
            failed = True
            print(f"ERROR en {name}:\n{traceback.format_exc()}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
