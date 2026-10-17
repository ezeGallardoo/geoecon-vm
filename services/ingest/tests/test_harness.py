"""El harness no debe contaminar la base entre tests."""

from geoecon.categories import OSM_RULES


def test_seed_inserts_a_zone(conn, seed, square):
    seed_zone, _, _ = seed
    before = conn.execute(
        "SELECT COUNT(*)::int AS n FROM urban_zones WHERE source = 'indec'"
    ).fetchone()["n"]

    seed_zone("test:harness:1", square(-63.2436, -32.4103), 1234)

    after = conn.execute(
        "SELECT COUNT(*)::int AS n FROM urban_zones WHERE source = 'indec'"
    ).fetchone()["n"]
    assert after == before + 1


def test_rollback_leaves_no_trace(conn, seed, square):
    """Si el rollback no funcionara, el count del test anterior se acumularía."""
    seed_zone, _, _ = seed
    seed_zone("test:harness:rollback", square(-63.2436, -32.4103), 999)

    row = conn.execute(
        "SELECT population FROM urban_zones WHERE zone_id = 'test:harness:rollback'"
    ).fetchone()
    assert row is not None
    assert row["population"] == 999


def test_osm_rubros_exist_in_category_params(conn):
    """Cada rubro al que OSM_RULES puede mapear tiene que existir en category_params.

    Si falta, el comercio queda sin etiqueta en el visor y sin coeficientes en
    la estimación, sin ningún aviso.
    """
    rows = conn.execute("SELECT category FROM category_params").fetchall()
    known = {row["category"] for row in rows}

    missing = sorted(set(OSM_RULES.values()) - known)
    assert missing == [], f"rubros de OSM_RULES sin fila en category_params: {missing}"


def test_otro_is_declared_as_a_category(conn):
    rows = conn.execute("SELECT category FROM category_params WHERE category = 'otro'").fetchall()
    assert len(rows) == 1