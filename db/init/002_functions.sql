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
    -- Regenerar la grilla es idempotente: solo borra y vuelve a crear
    -- analysis_cells, no toca businesses. Antes pedía truncar el padrón porque
    -- la grilla llevaba el estado del barrido; ese vínculo ya no existe.
    DELETE FROM analysis_cells;

    lat := south;
    WHILE lat < north - 1e-12 LOOP
        lng := west;
        WHILE lng < east - 1e-12 LOOP
            INSERT INTO analysis_cells (bbox, center_lat, center_lng)
            VALUES (
                ST_MakeEnvelope(
                    lng,
                    lat,
                    LEAST(lng + lng_step, east),
                    LEAST(lat + lat_step, north),
                    4326
                ),
                lat + LEAST(lat_step, north - lat) / 2.0,
                lng + LEAST(lng_step, east - lng) / 2.0
            );
            inserted := inserted + 1;
            lng := lng + lng_step;
        END LOOP;
        lat := lat + lat_step;
    END LOOP;

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
    -- Población prorrateada por área de intersección. ST_Intersects es
    -- booleano: sin el prorrateo, un círculo que solo roza un radio censal
    -- reportaba su población entera. Mismo criterio que cell_gaps más abajo.
    pop AS (
        SELECT COALESCE(ROUND(SUM(
            z.population::NUMERIC
            * ST_Area(ST_Intersection(z.geom, bounds.buf::geometry))
            / NULLIF(ST_Area(z.geom), 0)
        )), 0)::INTEGER AS population,
               COUNT(z.zone_id)::INTEGER AS zones
        FROM urban_zones z
        CROSS JOIN bounds
        WHERE z.source = 'indec'
          AND ST_Intersects(z.geom::geography, bounds.buf)
    ),
    -- VUT ponderado por área de intersección. Con AVG plano un barrio que el
    -- círculo solo roza pesaba igual que uno cubierto entero. El FILTER va en
    -- el denominador: si no, se divide por el área de barrios sin VUT y el
    -- promedio se corre a la baja.
    land AS (
        SELECT ROUND((
            SUM(n.land_value_m2 * ST_Area(ST_Intersection(n.geom, bounds.buf::geometry)))
            / NULLIF(
                SUM(ST_Area(ST_Intersection(n.geom, bounds.buf::geometry)))
                    FILTER (WHERE n.land_value_m2 > 0),
                0
            )
        )::NUMERIC, 2) AS land_value
        FROM neighborhoods n
        CROSS JOIN bounds
        WHERE ST_Intersects(n.geom::geography, bounds.buf)
    ),
    -- `here` puede devolver NULL: el punto está fuera de todo barrio cargado.
    -- Antes caía al sentinel 'departamento', que hacía que city_cats comparara
    -- contra todos los comercios de la base, Villa María y Villa Nueva juntas.
    -- "Fuera de la ciudad" no es lo mismo que "sin barrio".
    here AS (
        SELECT (
            SELECT n.source
            FROM neighborhoods n
            WHERE ST_Covers(n.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
            ORDER BY CASE n.source WHEN 'idecor-vn' THEN 0 ELSE 1 END
            LIMIT 1
        ) AS source
    ),
    city_land AS (
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY land_value_m2) AS median
        FROM neighborhoods
        WHERE land_value_m2 IS NOT NULL AND land_value_m2 > 0
          AND (
            (SELECT source FROM here) = 'departamento'
            OR source = (SELECT source FROM here)
          )
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
    ),
    city AS (
        SELECT CASE
            WHEN (SELECT source FROM here) = 'departamento' THEN (
                SELECT COALESCE(SUM(population), 0)::NUMERIC
                FROM urban_zones
                WHERE source = 'indec'
            )
            ELSE (
                SELECT COALESCE(SUM(population), 0)::NUMERIC
                FROM neighborhoods
                WHERE source = (SELECT source FROM here)
            )
        END AS population
    ),
    city_cats AS (
        SELECT b.category, COUNT(*)::NUMERIC AS total
        FROM businesses b
        WHERE (SELECT source FROM here) = 'departamento'
           OR EXISTS (
                SELECT 1
                FROM neighborhoods n
                WHERE n.source = (SELECT source FROM here)
                  AND ST_Covers(n.geom, b.geom)
           )
        GROUP BY b.category
    )
    SELECT jsonb_build_object(
        'populationIntersected', (SELECT population FROM pop),
        'zonesIntersected', (SELECT zones FROM pop),
        'cityName', CASE
            WHEN (SELECT source FROM here) IS NULL THEN NULL
            WHEN (SELECT source FROM here) = 'idecor-vn' THEN 'Villa Nueva'
            WHEN (SELECT source FROM here) = 'municipio' THEN 'Villa María'
            ELSE 'General San Martín'
        END,
        'landValueM2', (SELECT land_value FROM land),
        'landCoef', (
            SELECT CASE
                WHEN land.land_value IS NULL OR city_land.median IS NULL OR city_land.median <= 0 THEN NULL
                ELSE ROUND(LEAST(
                    (SELECT value FROM model_settings WHERE key = 'zone_coef_max'),
                    GREATEST(
                        (SELECT value FROM model_settings WHERE key = 'zone_coef_min'),
                        land.land_value / city_land.median
                    )
                )::NUMERIC, 2)
            END
            FROM land, city_land
        ),
        'businessCount', (SELECT COUNT(*)::INTEGER FROM hits),
        'avgRevenueArs', (SELECT ROUND(AVG(estimated_monthly_revenue_ars), 2) FROM hits),
        'totalRevenueArs', (SELECT ROUND(SUM(estimated_monthly_revenue_ars), 2) FROM hits),
        'categories', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'category', cp.category,
                    'total', COALESCE(c.total, 0),
                    'avgReviews', COALESCE(c.avg_reviews, 0),
                    'totalRevenueArs', COALESCE(c.total_revenue, 0),
                    'avgRevenueArs', COALESCE(c.avg_revenue, 0),
                    'inhabitantsPerBusiness', CASE
                        WHEN COALESCE(c.total, 0) > 0 AND (SELECT population FROM pop) > 0
                        THEN ROUND((SELECT population FROM pop)::NUMERIC / c.total)
                        ELSE NULL
                    END,
                    'cityInhabitantsPerBusiness', CASE
                        WHEN cc.total > 0 AND (SELECT population FROM city) > 0
                        THEN ROUND((SELECT population FROM city) / cc.total)
                        ELSE NULL
                    END,
                    'coverage', CASE
                        WHEN (SELECT population FROM pop) <= 0
                          OR cc.total IS NULL OR cc.total <= 0
                          OR (SELECT population FROM city) <= 0
                        THEN NULL
                        ELSE ROUND(
                            (COALESCE(c.total, 0)::NUMERIC * (SELECT population FROM city))
                            / ((SELECT population FROM pop) * cc.total),
                            3
                        )
                    END,
                    'gap', CASE
                        WHEN (SELECT population FROM pop) <= 0
                          OR cc.total IS NULL OR cc.total <= 0
                          OR (SELECT population FROM city) <= 0
                        THEN NULL
                        WHEN (
                            (COALESCE(c.total, 0)::NUMERIC * (SELECT population FROM city))
                            / ((SELECT population FROM pop) * cc.total)
                        ) < 0.7 THEN 'hueco'
                        WHEN (
                            (COALESCE(c.total, 0)::NUMERIC * (SELECT population FROM city))
                            / ((SELECT population FROM pop) * cc.total)
                        ) > 1.4 THEN 'saturado'
                        ELSE 'pareja'
                    END,
                    'potentialConsumptionArs', ROUND(
                        (SELECT population FROM pop)::NUMERIC
                        * COALESCE(cp.ticket_ars, 0)
                        * COALESCE(cp.purchases_per_capita_month, 0),
                        2
                    )
                )
                ORDER BY COALESCE(c.total, 0) DESC, cp.category
            )
            FROM category_params cp
            LEFT JOIN cats c ON c.category = cp.category
            LEFT JOIN city_cats cc ON cc.category = cp.category
        ), '[]'::JSONB)
    ) INTO v_report;

    RETURN v_report;
END;
$$;

-- Barrio que contiene cada comercio, materializado. El visor lo lee como
-- columna en vez de resolverlo por punto en el navegador. Gana el polígono de
-- menor área que contiene al punto, igual que la ficha individual.
-- El área es planar a propósito: ST_Area(geography) reproyecta a esferoide y
-- cuesta ~750 ms sobre el padrón entero, para un criterio que dentro de una
-- ciudad da el mismo resultado.
CREATE OR REPLACE FUNCTION assign_business_neighborhoods()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    assigned INTEGER;
BEGIN
    UPDATE businesses b
    SET neighborhood_id = picked.neighborhood_id
    FROM (
        SELECT DISTINCT ON (b2.id)
            b2.id AS business_id,
            n.neighborhood_id AS neighborhood_id
        FROM businesses b2
        JOIN neighborhoods n
          ON ST_Intersects(n.geom, b2.geom)
        ORDER BY b2.id, ST_Area(n.geom)
    ) AS picked
    WHERE b.id = picked.business_id;
    GET DIAGNOSTICS assigned = ROW_COUNT;

    -- Un comercio puede haber salido del polígono que lo contenía, por ejemplo
    -- si se recargaron los barrios. Sin esto quedaría apuntando al barrio viejo.
    UPDATE businesses b
    SET neighborhood_id = NULL
    WHERE b.neighborhood_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM neighborhoods n
          WHERE n.neighborhood_id = b.neighborhood_id
            AND ST_Intersects(n.geom, b.geom)
      );

    RETURN assigned;
END;
$$;

-- Población capturada por cada comercio según el modelo de gravedad de Huff.
--
-- NO ES FACTURACIÓN. Es la población que el modelo le asigna a cada local según
-- distancia y competencia, multiplicada por el ticket del rubro. Sirve para
-- ordenar y comparar locales entre sí, no para declarar ingresos: no hay un
-- dato de ventas con el cual validarlo.
--
-- Huff (1964): P(i compra en j) = (A_j / d_ij^a) / SUM_k (A_k / d_ik^a).
-- Con A_j = 1 para todos porque no tenemos superficie del local. El cociente
-- SUM_k w_ik reparte cada habitante entre todos los comercios que compiten por
-- él: eso es lo que distingue a Huff de sumar la población de un radio entero.
--
-- d_min evita que un comercio situado en el centroide del radio capture el 100%
-- de sus habitantes solo por estar a tres metros.
CREATE OR REPLACE FUNCTION assign_business_catchment()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_alpha NUMERIC;
    v_max_m DOUBLE PRECISION;
    v_min_m DOUBLE PRECISION;
    updated INTEGER := 0;
BEGIN
    SELECT COALESCE((SELECT value FROM model_settings WHERE key = 'huff_alpha'), 2.0)
        INTO v_alpha;
    SELECT COALESCE((SELECT value FROM model_settings WHERE key = 'huff_max_distance_m'), 2000)
        INTO v_max_m;
    SELECT COALESCE((SELECT value FROM model_settings WHERE key = 'huff_min_distance_m'), 150)
        INTO v_min_m;

    -- Se limpian solo los que ya tenían valor: un local sin catchment tiene que
    -- dar 0, no conservar el resultado de la corrida anterior.
    UPDATE businesses
    SET catchment_pop = NULL, captured_potential_ars = NULL
    WHERE catchment_pop IS NOT NULL OR captured_potential_ars IS NOT NULL;

    WITH zone_centers AS MATERIALIZED (
        -- El centroide se calcula una sola vez. Además, medir desde el centroide
        -- del radio es lo correcto para Huff: nadie va a Walkear hasta el borde
        -- de su manzana para comprar el kiosco.
        SELECT
            zone_id,
            population,
            ST_Centroid(geom)::geography AS g
        FROM urban_zones
        WHERE source = 'indec' AND population > 0
    ),
    pairs AS (
        SELECT
            b.id AS business_id,
            b.category,
            zc.zone_id,
            zc.population,
            GREATEST(
                ST_Distance(b.geom::geography, zc.g),
                v_min_m
            ) AS d
        FROM businesses b
        JOIN zone_centers zc
          ON ST_DWithin(b.geom::geography, zc.g, v_max_m)
    ),
    weights AS (
        SELECT
            pairs.business_id,
            pairs.category,
            pairs.zone_id,
            pairs.population,
            1.0::NUMERIC / POWER(pairs.d, v_alpha::DOUBLE PRECISION)::NUMERIC AS w,
            -- El reparto es DENTRO del rubro: un supermercado compite con otros
            -- supermercados, no con el kiosco de la esquina. Con el reparto
            -- global, cada local se pelea contra los 1246 y a todos les queda
            -- una fracción minúscula de su catchment.
            -- LIMITACIÓN: despensa, almacen y supermercado son sustitutos y acá
            -- compiten solo consigo mismos. Eso subestima el solapamiento real.
            SUM(1.0::NUMERIC / POWER(pairs.d, v_alpha::DOUBLE PRECISION)::NUMERIC)
                OVER (PARTITION BY pairs.zone_id, pairs.category) AS w_total
        FROM pairs
    ),
    catchment AS (
        SELECT
            weights.business_id,
            -- NULL si el rubro no está en category_params: no lo sabemos.
            cp.purchases_per_capita_month * cp.ticket_ars AS unit_potential,
            SUM(weights.population::NUMERIC * weights.w / NULLIF(weights.w_total, 0))
                AS population
        FROM weights
        JOIN businesses target ON target.id = weights.business_id
        LEFT JOIN category_params cp ON cp.category = target.category
        GROUP BY
            weights.business_id,
            cp.purchases_per_capita_month,
            cp.ticket_ars
    )
    UPDATE businesses b
    SET catchment_pop = ROUND(c.population)::BIGINT,
        captured_potential_ars = CASE
            WHEN c.unit_potential IS NULL THEN NULL
            ELSE ROUND(c.unit_potential * c.population, 2)
        END,
        -- Mismos umbrales que activity_tiers. Si aparece una señal de reseñas y
        -- recalculate_estimates calcula facturación real, el API prioriza esa.
        capture_tier = CASE
            WHEN c.unit_potential IS NULL THEN NULL
            ELSE COALESCE((
                SELECT t.tier
                FROM activity_tiers t
                WHERE c.unit_potential * c.population >= t.min_monthly_ars
                ORDER BY t.min_monthly_ars DESC
                LIMIT 1
            ), 1)
        END
    FROM catchment c
    WHERE b.id = c.business_id;

    GET DIAGNOSTICS updated = ROW_COUNT;

    -- Un local sin población alcanzable tiene catchment 0, no NULL: cero
    -- clientes es un dato, "no calculado" es otra cosa.
    -- El potencial en cambio queda NULL si el rubro no está en category_params:
    -- decir 0 ahí afirmaría que no consume, cuando en realidad no lo sabemos.
    UPDATE businesses b
    SET catchment_pop = 0,
        captured_potential_ars = CASE
            WHEN EXISTS (
                SELECT 1 FROM category_params cp WHERE cp.category = b.category
            ) THEN 0
            ELSE NULL
        END,
        capture_tier = CASE
            WHEN EXISTS (
                SELECT 1 FROM category_params cp WHERE cp.category = b.category
            ) THEN 1
            ELSE NULL
        END
    WHERE catchment_pop IS NULL;

    RETURN updated;
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

-- Las 15 celdas de 400 m más descubiertas del rubro.
-- La población se reparte por el área de intersección con el radio censal.
-- El suelo solo inclina el ranking: no fabrica consumo.
CREATE OR REPLACE FUNCTION cell_gaps(p_category TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    WITH params AS (
        SELECT
            COALESCE((SELECT value FROM model_settings WHERE key = 'zone_coef_min'), 0.75) AS coef_min,
            COALESCE((SELECT value FROM model_settings WHERE key = 'zone_coef_max'), 1.45) AS coef_max
    ),
    city AS (
        SELECT COALESCE(SUM(population), 0)::NUMERIC AS population
        FROM urban_zones
        WHERE source = 'indec'
    ),
    city_cat AS (
        SELECT COUNT(*)::NUMERIC AS total
        FROM businesses
        WHERE category = p_category
    ),
    ticket AS (
        SELECT ticket_ars, purchases_per_capita_month
        FROM category_params
        WHERE category = p_category
    ),
    median AS (
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY land_value_m2) AS value
        FROM urban_zones
        WHERE source = 'indec' AND land_value_m2 IS NOT NULL AND land_value_m2 > 0
    ),
    cells AS (
        SELECT
            g.cell_id,
            g.center_lat,
            g.center_lng,
            g.bbox,
            COALESCE(SUM(
                z.population::NUMERIC
                * ST_Area(ST_Intersection(g.bbox, z.geom))
                / NULLIF(ST_Area(z.geom), 0)
            ), 0) AS population,
            AVG(z.land_value_m2) FILTER (WHERE z.land_value_m2 > 0) AS land_value
        FROM analysis_cells g
        LEFT JOIN urban_zones z
            ON z.source = 'indec' AND ST_Intersects(g.bbox, z.geom)
        GROUP BY g.cell_id, g.center_lat, g.center_lng, g.bbox
    ),
    counted AS (
        SELECT
            c.*,
            (
                SELECT COUNT(*)::INTEGER
                FROM businesses b
                WHERE b.category = p_category
                  AND ST_Contains(c.bbox, b.geom)
            ) AS shops
        FROM cells c
    ),
    scored AS (
        SELECT
            counted.*,
            CASE
                WHEN population <= 0
                  OR (SELECT total FROM city_cat) <= 0
                  OR (SELECT population FROM city) <= 0
                THEN NULL
                ELSE (shops::NUMERIC * (SELECT population FROM city))
                     / (population * (SELECT total FROM city_cat))
            END AS coverage,
            CASE
                WHEN (SELECT value FROM median) IS NULL OR land_value IS NULL OR land_value <= 0 THEN 1
                ELSE LEAST(
                    (SELECT coef_max FROM params),
                    GREATEST(
                        (SELECT coef_min FROM params),
                        land_value / (SELECT value FROM median)
                    )
                )
            END AS land_coef
        FROM counted
    ),
    ranked AS (
        SELECT
            scored.*,
            CASE
                WHEN coverage IS NULL THEN NULL
                ELSE GREATEST(0, 1 - coverage) * land_coef
            END AS opportunity
        FROM scored
        WHERE population > 0
    )
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE((
            SELECT jsonb_agg(feature ORDER BY opportunity DESC NULLS LAST, cell_id)
            FROM (
                SELECT
                    jsonb_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(bbox)::JSONB,
                        'properties', jsonb_build_object(
                            'cellId', cell_id,
                            'lat', center_lat,
                            'lng', center_lng,
                            'population', ROUND(population),
                            'businessCount', shops,
                            'coverage', ROUND(coverage::NUMERIC, 3),
                            'gap', CASE
                                WHEN coverage IS NULL THEN NULL
                                WHEN coverage < 0.7 THEN 'hueco'
                                WHEN coverage > 1.4 THEN 'saturado'
                                ELSE 'pareja'
                            END,
                            'opportunity', ROUND(opportunity::NUMERIC, 3),
                            'landCoef', ROUND(land_coef::NUMERIC, 3),
                            'potentialConsumptionArs', ROUND((
                                population
                                * COALESCE((SELECT ticket_ars FROM ticket), 0)
                                * COALESCE((SELECT purchases_per_capita_month FROM ticket), 0)
                            )::NUMERIC, 2)
                        )
                    ) AS feature,
                    opportunity,
                    cell_id
                FROM ranked
                ORDER BY opportunity DESC NULLS LAST, cell_id
                LIMIT 15
            ) top
        ), '[]'::JSONB)
    );
$$;
