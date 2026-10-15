-- Funciones de grilla, deduplicación, estimación y radio.
-- El visor solo lee estas funciones (RNF-03).

-- BBox cerrado de la ERS: lat -32.45..-32.38, lng -63.28..-63.20.
-- Celda de 400 m en el paralelo -32.41.
CREATE OR REPLACE FUNCTION generate_vm_grid()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    south CONSTANT DOUBLE PRECISION := -32.45;
    north CONSTANT DOUBLE PRECISION := -32.38;
    west CONSTANT DOUBLE PRECISION := -63.28;
    east CONSTANT DOUBLE PRECISION := -63.20;
    lat0 CONSTANT DOUBLE PRECISION := -32.41;
    lat_step DOUBLE PRECISION := 400.0 / 110540.0;
    lng_step DOUBLE PRECISION := 400.0 / (111320.0 * cos(radians(lat0)));
    lat DOUBLE PRECISION;
    lng DOUBLE PRECISION;
    inserted INTEGER := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM businesses) THEN
        RAISE EXCEPTION 'generate_vm_grid rechazado: ya hay comercios. Truncá businesses antes de regenerar la grilla.';
    END IF;

    DELETE FROM scrape_jobs;
    DELETE FROM scrape_grid;

    lat := south;
    WHILE lat < north - 1e-12 LOOP
        lng := west;
        WHILE lng < east - 1e-12 LOOP
            INSERT INTO scrape_grid (bbox, center_lat, center_lng, status)
            VALUES (
                ST_MakeEnvelope(
                    lng,
                    lat,
                    LEAST(lng + lng_step, east),
                    LEAST(lat + lat_step, north),
                    4326
                ),
                lat + LEAST(lat_step, north - lat) / 2.0,
                lng + LEAST(lng_step, east - lng) / 2.0,
                'PENDING'
            );
            inserted := inserted + 1;
            lng := lng + lng_step;
        END LOOP;
        lat := lat + lat_step;
    END LOOP;

    RETURN inserted;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_scrape_jobs(p_source TEXT, p_query TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    inserted INTEGER;
BEGIN
    INSERT INTO scrape_jobs (cell_id, source, query, status)
    SELECT cell_id, p_source, p_query, 'PENDING'
    FROM scrape_grid
    ON CONFLICT (cell_id, source, query) DO NOTHING;

    GET DIAGNOSTICS inserted = ROW_COUNT;
    RETURN inserted;
END;
$$;

-- RF-04: mismo place_id, o mismo rubro a menos de 10 m con similitud de nombre > 85%.
CREATE OR REPLACE FUNCTION upsert_business(payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_place_id TEXT := btrim(payload->>'place_id');
    v_name TEXT := btrim(payload->>'name');
    v_category TEXT := btrim(payload->>'category');
    v_lng DOUBLE PRECISION := NULLIF(payload->>'lng', '')::DOUBLE PRECISION;
    v_lat DOUBLE PRECISION := NULLIF(payload->>'lat', '')::DOUBLE PRECISION;
    v_geom GEOMETRY(Point, 4326);
    v_existing UUID;
    v_zone VARCHAR(64);
    v_id UUID;
    v_subcategories TEXT[];
    v_entities TEXT[];
BEGIN
    IF v_place_id IS NULL OR v_name IS NULL OR v_category IS NULL OR v_lng IS NULL OR v_lat IS NULL THEN
        RAISE EXCEPTION 'upsert_business: faltan place_id, name, category, lng o lat';
    END IF;
    IF v_lat < -32.46 OR v_lat > -32.37 OR v_lng < -63.29 OR v_lng > -63.19 THEN
        RAISE EXCEPTION 'upsert_business: el punto queda fuera del bbox de Villa María';
    END IF;

    v_geom := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326);

    SELECT id INTO v_existing
    FROM businesses
    WHERE place_id = v_place_id;

    IF v_existing IS NULL THEN
        SELECT b.id INTO v_existing
        FROM businesses b
        WHERE b.category = v_category
          AND ST_DWithin(b.geom::geography, v_geom::geography, 10)
          AND similarity(b.name, v_name) > 0.85
        ORDER BY ST_Distance(b.geom::geography, v_geom::geography)
        LIMIT 1;
    END IF;

    SELECT z.zone_id INTO v_zone
    FROM urban_zones z
    WHERE ST_Intersects(z.geom, v_geom)
    ORDER BY ST_Area(z.geom::geography)
    LIMIT 1;

    IF payload ? 'subcategories' AND jsonb_typeof(payload->'subcategories') = 'array' THEN
        SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
        INTO v_subcategories
        FROM jsonb_array_elements_text(payload->'subcategories');
    END IF;

    IF payload ? 'bcra_entities' AND jsonb_typeof(payload->'bcra_entities') = 'array' THEN
        SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
        INTO v_entities
        FROM jsonb_array_elements_text(payload->'bcra_entities');
    END IF;

    IF v_existing IS NULL THEN
        INSERT INTO businesses (
            place_id, name, category, subcategories, address, neighborhood, phone, website,
            geom, zone_id, source, rating, reviews_total, reviews_last_90d, weekly_open_hours,
            opening_hours, price_level, cuit, legal_name, tax_regime, activity_code_clae,
            activity_started_on, bcra_entities, bcra_worst_status, bcra_total_debt_ars,
            bcra_debt_thousands, attributes
        ) VALUES (
            v_place_id,
            v_name,
            v_category,
            v_subcategories,
            NULLIF(payload->>'address', ''),
            NULLIF(payload->>'neighborhood', ''),
            NULLIF(payload->>'phone', ''),
            NULLIF(payload->>'website', ''),
            v_geom,
            v_zone,
            COALESCE(NULLIF(payload->>'source', ''), 'unknown'),
            NULLIF(payload->>'rating', '')::NUMERIC,
            COALESCE(NULLIF(payload->>'reviews_total', '')::INTEGER, 0),
            COALESCE(NULLIF(payload->>'reviews_last_90d', '')::INTEGER, 0),
            NULLIF(payload->>'weekly_open_hours', '')::INTEGER,
            NULLIF(payload->>'opening_hours', ''),
            NULLIF(payload->>'price_level', '')::SMALLINT,
            NULLIF(payload->>'cuit', ''),
            NULLIF(payload->>'legal_name', ''),
            NULLIF(payload->>'tax_regime', ''),
            NULLIF(payload->>'activity_code_clae', ''),
            NULLIF(payload->>'activity_started_on', '')::DATE,
            v_entities,
            NULLIF(payload->>'bcra_worst_status', '')::SMALLINT,
            COALESCE(NULLIF(payload->>'bcra_total_debt_ars', '')::NUMERIC, 0),
            NULLIF(payload->>'bcra_debt_thousands', '')::NUMERIC,
            COALESCE(payload->'attributes', '{}'::JSONB)
        )
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    UPDATE businesses SET
        name = v_name,
        category = v_category,
        subcategories = COALESCE(v_subcategories, subcategories),
        address = COALESCE(NULLIF(payload->>'address', ''), address),
        neighborhood = COALESCE(NULLIF(payload->>'neighborhood', ''), neighborhood),
        phone = COALESCE(NULLIF(payload->>'phone', ''), phone),
        website = COALESCE(NULLIF(payload->>'website', ''), website),
        geom = v_geom,
        zone_id = COALESCE(v_zone, zone_id),
        source = COALESCE(NULLIF(payload->>'source', ''), source),
        rating = COALESCE(NULLIF(payload->>'rating', '')::NUMERIC, rating),
        reviews_total = GREATEST(reviews_total, COALESCE(NULLIF(payload->>'reviews_total', '')::INTEGER, 0)),
        reviews_last_90d = GREATEST(reviews_last_90d, COALESCE(NULLIF(payload->>'reviews_last_90d', '')::INTEGER, 0)),
        weekly_open_hours = COALESCE(NULLIF(payload->>'weekly_open_hours', '')::INTEGER, weekly_open_hours),
        opening_hours = COALESCE(NULLIF(payload->>'opening_hours', ''), opening_hours),
        price_level = COALESCE(NULLIF(payload->>'price_level', '')::SMALLINT, price_level),
        cuit = COALESCE(NULLIF(payload->>'cuit', ''), cuit),
        legal_name = COALESCE(NULLIF(payload->>'legal_name', ''), legal_name),
        tax_regime = COALESCE(NULLIF(payload->>'tax_regime', ''), tax_regime),
        activity_code_clae = COALESCE(NULLIF(payload->>'activity_code_clae', ''), activity_code_clae),
        activity_started_on = COALESCE(NULLIF(payload->>'activity_started_on', '')::DATE, activity_started_on),
        bcra_entities = COALESCE(v_entities, bcra_entities),
        bcra_worst_status = COALESCE(NULLIF(payload->>'bcra_worst_status', '')::SMALLINT, bcra_worst_status),
        bcra_total_debt_ars = CASE
            WHEN payload ? 'bcra_total_debt_ars' THEN NULLIF(payload->>'bcra_total_debt_ars', '')::NUMERIC
            ELSE bcra_total_debt_ars
        END,
        bcra_debt_thousands = COALESCE(NULLIF(payload->>'bcra_debt_thousands', '')::NUMERIC, bcra_debt_thousands),
        attributes = attributes || COALESCE(payload->'attributes', '{}'::JSONB)
    WHERE id = v_existing
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- RF-09. Coeficientes editables. No son cifras oficiales de ARCA ni de INDEC.
-- Tráfico mensual ≈ (reseñas de 90 días / 13 semanas) × visitas por reseña × (horas / 48) × 4.345
-- Piso fiscal = tope anual de la categoría / 12 × utilización, si el tope está cargado.
-- Señal crediticia = deuda en pesos × factor, solo en situación 1.
-- Zona = valor m2 / mediana de Villa María, acotado.
CREATE OR REPLACE FUNCTION recalculate_estimates(p_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_hours NUMERIC;
    v_util NUMERIC;
    v_credit NUMERIC;
    v_zmin NUMERIC;
    v_zmax NUMERIC;
    v_median NUMERIC;
    updated INTEGER;
BEGIN
    SELECT value INTO v_hours FROM model_settings WHERE key = 'unknown_weekly_hours';
    SELECT value INTO v_util FROM model_settings WHERE key = 'monotributo_utilization';
    SELECT value INTO v_credit FROM model_settings WHERE key = 'credit_giro_factor';
    SELECT value INTO v_zmin FROM model_settings WHERE key = 'zone_coef_min';
    SELECT value INTO v_zmax FROM model_settings WHERE key = 'zone_coef_max';
    v_hours := COALESCE(v_hours, 48);
    v_util := COALESCE(v_util, 0.55);
    v_credit := COALESCE(v_credit, 0.15);
    v_zmin := COALESCE(v_zmin, 0.75);
    v_zmax := COALESCE(v_zmax, 1.45);

    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY land_value_m2)
    INTO v_median
    FROM urban_zones
    WHERE land_value_m2 IS NOT NULL AND land_value_m2 > 0;

    WITH computed AS (
        SELECT
            b.id,
            GREATEST(
                (
                    (b.reviews_last_90d::NUMERIC / 13.0)
                    * COALESCE(cp.visits_per_review, 40)
                    * (COALESCE(b.weekly_open_hours, v_hours) / 48.0)
                    * 4.345
                    * COALESCE(cp.ticket_ars, 1)
                ),
                COALESCE(tb.annual_cap_ars / 12.0 * v_util, 0),
                CASE
                    WHEN b.bcra_worst_status = 1 AND b.bcra_total_debt_ars > 0
                    THEN b.bcra_total_debt_ars * v_credit
                    ELSE 0
                END
            ) * CASE
                WHEN v_median IS NULL OR z.land_value_m2 IS NULL OR z.land_value_m2 <= 0 THEN 1
                ELSE LEAST(v_zmax, GREATEST(v_zmin, z.land_value_m2 / v_median))
            END AS revenue,
            (
                b.reviews_last_90d = 0
                AND tb.annual_cap_ars IS NULL
                AND NOT (b.bcra_worst_status = 1 AND COALESCE(b.bcra_total_debt_ars, 0) > 0)
            ) AS no_signal
        FROM businesses b
        LEFT JOIN category_params cp ON cp.category = b.category
        LEFT JOIN tax_brackets tb ON tb.code = b.tax_regime
        LEFT JOIN urban_zones z ON z.zone_id = b.zone_id
        WHERE p_id IS NULL OR b.id = p_id
    ),
    ranked AS (
        SELECT
            c.id,
            CASE WHEN c.no_signal THEN NULL ELSE ROUND(c.revenue, 2) END AS revenue,
            COALESCE(
                (
                    SELECT t.tier
                    FROM activity_tiers t
                    WHERE c.revenue >= t.min_monthly_ars
                    ORDER BY t.min_monthly_ars DESC
                    LIMIT 1
                ),
                1
            ) AS tier
        FROM computed c
    )
    UPDATE businesses b
    SET estimated_monthly_revenue_ars = r.revenue,
        activity_tier = r.tier
    FROM ranked r
    WHERE b.id = r.id;

    GET DIAGNOSTICS updated = ROW_COUNT;
    RETURN updated;
END;
$$;

-- RF-11. Una sola ida a PostGIS. Radio válido: 100 a 2000 m.
CREATE OR REPLACE FUNCTION radius_report(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_m DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_radius DOUBLE PRECISION;
    v_report JSONB;
BEGIN
    IF p_radius_m < 100 OR p_radius_m > 2000 THEN
        RAISE EXCEPTION 'radius_report: el radio debe estar entre 100 y 2000 metros';
    END IF;
    v_radius := p_radius_m;

    WITH target AS (
        SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS geog
    ),
    bounds AS (
        SELECT geog, ST_Buffer(geog, v_radius) AS buf
        FROM target
    ),
    hits AS (
        SELECT b.*
        FROM businesses b
        CROSS JOIN bounds
        WHERE ST_DWithin(b.geom::geography, bounds.geog, v_radius)
    ),
    pop AS (
        SELECT COALESCE(SUM(z.population), 0)::INTEGER AS population,
               COUNT(z.zone_id)::INTEGER AS zones
        FROM urban_zones z
        CROSS JOIN bounds
        WHERE ST_Intersects(z.geom::geography, bounds.buf)
    ),
    cats AS (
        SELECT
            h.category,
            COUNT(*)::INTEGER AS total,
            COALESCE(ROUND(AVG(h.reviews_total)), 0)::INTEGER AS avg_reviews,
            COALESCE(ROUND(SUM(h.estimated_monthly_revenue_ars), 2), 0) AS total_revenue,
            COALESCE(ROUND(AVG(h.estimated_monthly_revenue_ars), 2), 0) AS avg_revenue
        FROM hits h
        GROUP BY h.category
    )
    SELECT jsonb_build_object(
        'populationIntersected', (SELECT population FROM pop),
        'zonesIntersected', (SELECT zones FROM pop),
        'businessCount', (SELECT COUNT(*)::INTEGER FROM hits),
        'avgRevenueArs', (SELECT ROUND(AVG(estimated_monthly_revenue_ars), 2) FROM hits),
        'totalRevenueArs', (SELECT ROUND(SUM(estimated_monthly_revenue_ars), 2) FROM hits),
        'categories', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'category', c.category,
                    'total', c.total,
                    'avgReviews', c.avg_reviews,
                    'totalRevenueArs', c.total_revenue,
                    'avgRevenueArs', c.avg_revenue,
                    'inhabitantsPerBusiness', CASE
                        WHEN c.total > 0 AND (SELECT population FROM pop) > 0
                        THEN ROUND((SELECT population FROM pop)::NUMERIC / c.total)
                        ELSE NULL
                    END
                )
                ORDER BY c.total DESC, c.category
            )
            FROM cats c
        ), '[]'::JSONB)
    ) INTO v_report;

    RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION link_fiscal(payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
    v_place_id TEXT := NULLIF(payload->>'place_id', '');
    v_name TEXT := NULLIF(btrim(payload->>'name'), '');
BEGIN
    IF v_place_id IS NOT NULL THEN
        SELECT id INTO v_id FROM businesses WHERE place_id = v_place_id;
    END IF;

    IF v_id IS NULL AND v_name IS NOT NULL THEN
        SELECT b.id INTO v_id
        FROM businesses b
        WHERE similarity(b.name, v_name) > 0.85
        ORDER BY similarity(b.name, v_name) DESC
        LIMIT 1;
    END IF;

    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE businesses SET
        cuit = COALESCE(NULLIF(payload->>'cuit', ''), cuit),
        legal_name = COALESCE(NULLIF(payload->>'legal_name', ''), legal_name),
        tax_regime = COALESCE(NULLIF(payload->>'tax_regime', ''), tax_regime),
        activity_code_clae = COALESCE(NULLIF(payload->>'activity_code_clae', ''), activity_code_clae),
        activity_started_on = COALESCE(NULLIF(payload->>'activity_started_on', '')::DATE, activity_started_on)
    WHERE id = v_id;

    RETURN v_id;
END;
$$;
