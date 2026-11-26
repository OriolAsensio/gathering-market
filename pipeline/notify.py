"""Envía al móvil los avisos pendientes usando ntfy (app gratuita, Android e iOS).

Configuración en data/config.json:   {"ntfy_topic": "nombre-secreto-largo"}
En el móvil: instala la app ntfy y suscríbete a ese mismo nombre.
Sin configuración, los avisos solo se ven en la pestaña "Avisos" de la app.
"""
import json
import os
import sys
import urllib.request

from db import ROOT, connect

CONFIG = ROOT / "data" / "config.json"
TAGS = {"ban": "no_entry", "unban": "white_check_mark", "set": "new",
        "meta": "bar_chart", "price": "moneybag"}


def load_config():
    """data/config.json en el PC; en GitHub, el secreto NTFY_TOPIC."""
    try:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    except FileNotFoundError:
        cfg = {}
    if os.environ.get("NTFY_TOPIC"):
        cfg["ntfy_topic"] = os.environ["NTFY_TOPIC"]
    return cfg


def send(topic, title, message, tag=None, server="https://ntfy.sh"):
    body = {"topic": topic, "title": title, "message": message or title}
    if tag:
        body["tags"] = [tag]
    req = urllib.request.Request(server, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def main(dry_run=False):
    cfg = load_config()
    topic = cfg.get("ntfy_topic")
    if "--test" in sys.argv:
        if not topic:
            sys.exit(f"Falta ntfy_topic en {CONFIG}")
        send(topic, "✅ Gather in One conectado", "Las notificaciones de tu app de Magic funcionan.",
             "white_check_mark", cfg.get("ntfy_server", "https://ntfy.sh"))
        print("Notificación de prueba enviada.")
        return
    conn = connect()
    pending = conn.execute(
        "SELECT id, kind, title, body FROM events WHERE notified = 0 ORDER BY id").fetchall()
    if not pending:
        print("Notificaciones: nada pendiente.")
        return
    if not topic and not dry_run:
        print(f"Notificaciones: {len(pending)} pendientes, pero no hay ntfy_topic en {CONFIG}.")
        return

    # Baneos y colecciones van sueltos; los de precio y meta se agrupan en uno.
    single = [e for e in pending if e[1] in ("ban", "unban", "set")]
    grouped = [e for e in pending if e[1] not in ("ban", "unban", "set")]
    messages = [(t, b, TAGS[k]) for _, k, t, b in single]
    if grouped:
        lines = [t for _, _, t, _ in grouped[:15]]
        if len(grouped) > 15:
            lines.append(f"… y {len(grouped) - 15} más en la app")
        messages.append((f"MTG: {len(grouped)} cambios de precio/meta", "\n".join(lines), "moneybag"))

    for title, body, tag in messages:
        if dry_run:
            print(f"[simulado] {title}\n    {body}")
        else:
            send(topic, title, body, tag, cfg.get("ntfy_server", "https://ntfy.sh"))
    if not dry_run:
        with conn:
            conn.executemany("UPDATE events SET notified = 1 WHERE id = ?", [(e[0],) for e in pending])
    print(f"Notificaciones: {len(messages)} enviadas ({len(pending)} avisos).")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
