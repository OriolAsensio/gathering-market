"""Base de datos local (SQLite). Más adelante se puede migrar a Supabase/Postgres."""
import os
import sqlite3
import sys
from pathlib import Path

# La consola de Windows no usa UTF-8 por defecto (rompe las tildes).
if sys.stdout:
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("MTG_DB") or ROOT / "data" / "mtg.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS cards (
    id               TEXT PRIMARY KEY,   -- Scryfall id (una impresión concreta)
    oracle_id        TEXT,               -- misma carta en todas sus impresiones
    name             TEXT NOT NULL,
    set_code         TEXT NOT NULL,
    set_name         TEXT,
    collector_number TEXT,
    rarity           TEXT,
    type_line        TEXT,
    oracle_text      TEXT,
    mana_cost        TEXT,
    cmc              REAL,
    color_identity   TEXT,
    keywords         TEXT,
    released_at      TEXT,
    edhrec_rank      INTEGER,
    reprint          INTEGER,
    image_url        TEXT,
    pauper           TEXT,               -- legal / banned / not_legal
    front_name       TEXT,               -- "A // B" -> "A" (como aparece en las listas)
    variant          INTEGER,            -- 1 = versión especial (promo, sin borde, showcase...)
    reserved         INTEGER,            -- 1 = Lista Reservada (no se reimprime)
    commander        TEXT,               -- legalidad en Commander
    standard         TEXT,               -- legalidad en Estándar
    game_changer     INTEGER             -- 1 = Game Changer de Commander (limita los brackets 1-3)
);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_oracle ON cards(oracle_id);
CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_code);

-- Una fila por carta y día. Precios en céntimos para ocupar menos.
CREATE TABLE IF NOT EXISTS prices (
    card_id   TEXT NOT NULL,
    day       TEXT NOT NULL,             -- YYYY-MM-DD
    eur       INTEGER,                   -- Cardmarket (tendencia)
    eur_foil  INTEGER,
    usd       INTEGER,                   -- TCGplayer
    usd_foil  INTEGER,
    PRIMARY KEY (card_id, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_prices_day ON prices(day);

-- Registro de cada descarga, para no repetir el mismo día.
CREATE TABLE IF NOT EXISTS ingests (
    day         TEXT PRIMARY KEY,
    source_url  TEXT,
    cards       INTEGER,
    priced      INTEGER,
    finished_at TEXT
);

-- Colecciones de Magic (ediciones).
CREATE TABLE IF NOT EXISTS sets (
    code         TEXT PRIMARY KEY,
    name         TEXT,
    set_type     TEXT,
    released_at  TEXT,
    card_count   INTEGER,             -- todas las cartas, con versiones especiales
    icon_svg     TEXT,
    printed_size INTEGER,             -- tamaño de la colección base (sin variantes)
    digital      INTEGER
);

-- Carpetas de cartas (tabla "collections" por historia): la mía es la 1; se pueden añadir,
-- p. ej. la de un amigo. En la app se llaman "carpetas" para no confundirlas con las ediciones.
CREATE TABLE IF NOT EXISTS collections (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
INSERT OR IGNORE INTO collections (id, name) VALUES (1, 'Mis cartas');

-- Ediciones que sigo ("fijadas") en cada carpeta.
CREATE TABLE IF NOT EXISTS pinned_sets (
    collection_id INTEGER NOT NULL,
    set_code      TEXT NOT NULL,
    pinned_at     TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, set_code)
);

-- Cartas de cada carpeta: una fila por impresión y acabado.
CREATE TABLE IF NOT EXISTS collection (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL DEFAULT 1,
    card_id       TEXT NOT NULL,
    qty           INTEGER NOT NULL DEFAULT 1,
    foil          INTEGER NOT NULL DEFAULT 0,
    added_at      TEXT DEFAULT (datetime('now')),
    UNIQUE (collection_id, card_id, foil)
);

-- Metajuego (MTGTop8): cuota de cada arquetipo por día y formato (PAU, ST, MO…).
CREATE TABLE IF NOT EXISTS meta (
    day          TEXT,
    format       TEXT DEFAULT 'PAU',
    archetype_id INTEGER,
    archetype    TEXT,
    category     TEXT,
    share        REAL,
    deck_id      INTEGER,
    PRIMARY KEY (day, format, archetype_id)
);
-- Todas las listas de torneo que se miran de cada arquetipo (para los staples: qué juega el meta de verdad).
CREATE TABLE IF NOT EXISTS meta_lists (
    day          TEXT,
    format       TEXT,
    archetype_id INTEGER,
    deck_id      INTEGER,
    PRIMARY KEY (day, format, archetype_id, deck_id)
);
CREATE TABLE IF NOT EXISTS decks (
    id           INTEGER PRIMARY KEY,    -- id de MTGTop8
    archetype_id INTEGER,
    archetype    TEXT,
    name         TEXT,
    player       TEXT,
    event        TEXT,
    result       TEXT,
    date         TEXT
);
CREATE TABLE IF NOT EXISTS deck_cards (
    deck_id   INTEGER,
    name      TEXT,
    qty       INTEGER,
    sideboard INTEGER,
    PRIMARY KEY (deck_id, name, sideboard)
);

-- Avisos: baneos, colecciones nuevas, cambios de meta y de precio.
CREATE TABLE IF NOT EXISTS events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    day      TEXT,
    kind     TEXT,                       -- ban / unban / set / meta / price
    title    TEXT,
    body     TEXT,
    notified INTEGER DEFAULT 0,
    UNIQUE (day, kind, title)
);
"""


def _migrate(conn):
    """Adapta bases de datos creadas con versiones anteriores (antes de crear el esquema)."""
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "cards" in tables:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(cards)")}
        for col, kind in (("pauper", "TEXT"), ("front_name", "TEXT"), ("variant", "INTEGER"),
                          ("reserved", "INTEGER"), ("commander", "TEXT"), ("standard", "TEXT"), ("game_changer", "INTEGER")):
            if col not in cols:
                conn.execute(f"ALTER TABLE cards ADD COLUMN {col} {kind}")
    if "sets" in tables:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(sets)")}
        for col in ("printed_size", "digital"):
            if col not in cols:
                conn.execute(f"ALTER TABLE sets ADD COLUMN {col} INTEGER")
    if "collections" in tables:  # antes la carpeta principal se llamaba "Mi colección"
        conn.execute("UPDATE collections SET name = 'Mis cartas' WHERE id = 1 AND name = 'Mi colección'")
        conn.commit()
    if "meta" in tables and "format" not in {r[1] for r in conn.execute("PRAGMA table_info(meta)")}:
        with conn:  # antes solo había Pauper (cambia la clave primaria)
            conn.execute("ALTER TABLE meta RENAME TO meta_v1")
            conn.executescript(SCHEMA)
            conn.execute("INSERT INTO meta SELECT day, 'PAU', archetype_id, archetype, category, share, deck_id FROM meta_v1")
            conn.execute("DROP TABLE meta_v1")
    if "collection" in tables:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(collection)")}
        if "collection_id" not in cols:  # pasar a varias colecciones (cambia la clave única)
            with conn:
                conn.execute("ALTER TABLE collection RENAME TO collection_v1")
                conn.executescript(SCHEMA)
                conn.execute("INSERT INTO collection (collection_id, card_id, qty, foil, added_at) "
                             "SELECT 1, card_id, qty, foil, added_at FROM collection_v1")
                conn.execute("DROP TABLE collection_v1")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    _migrate(conn)
    conn.executescript(SCHEMA)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_cards_front ON cards(front_name)")
    return conn


def add_event(conn, day, kind, title, body=""):
    conn.execute(
        "INSERT OR IGNORE INTO events (day, kind, title, body) VALUES (?,?,?,?)",
        (day, kind, title, body))


def latest_day(conn):
    return conn.execute("SELECT max(day) FROM prices").fetchone()[0]


def norm(name: str) -> str:
    """'Troll of Khazad-dûm' y 'Troll of Khazad-dum' -> misma clave."""
    import unicodedata
    s = unicodedata.normalize("NFKD", name.split(" // ")[0])
    return "".join(ch for ch in s if not unicodedata.combining(ch)).lower().strip()


def cheapest_by_name(conn, day):
    """Precio (céntimos) de la impresión no foil más barata de cada carta, por nombre normalizado."""
    out = {}
    for name, eur in conn.execute(
            "SELECT c.front_name, min(p.eur) FROM cards c JOIN prices p ON p.card_id = c.id "
            "WHERE p.day = ? AND p.eur IS NOT NULL GROUP BY c.front_name", (day,)):
        k = norm(name)
        out[k] = min(out.get(k, eur), eur)
    return out
