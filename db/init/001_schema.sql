-- GeoEcon VM — esquema PostGIS (ERS v2.0, sección 5) más las columnas
-- que piden RF-02, RF-05, RF-07 y RF-09 y no estaban en el CREATE inicial.
-- Distancias en metros: geography sobre WGS84 (RNF-04). Villa María cabe
-- en un cálculo esférico de menos de 2 km; POSGAR 5346 queda como alternativa
-- explícita de la ERS, no como almacenamiento.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE scrape_grid (
    cell_id SERIAL PRIMARY KEY,
    bbox GEOMETRY(Polygon, 4326) NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    last_scanned_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    CONSTRAINT scrape_grid_status_chk CHECK (status IN ('PENDING', 'COMPLETED', 'ERROR'))
);

-- Reanudación por rubro (RNF-02). scrape_grid.status resume el barrido en curso;
-- scrape_jobs recuerda cada consulta para no pisar un rubro ya cerrado.
CREATE TABLE scrape_jobs (
    job_id SERIAL PRIMARY KEY,
    cell_id INTEGER NOT NULL REFERENCES scrape_grid(cell_id) ON DELETE CASCADE,
    source VARCHAR(32) NOT NULL,
    query VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    last_error TEXT,
    scanned_at TIMESTAMPTZ,
    CONSTRAINT scrape_jobs_status_chk CHECK (status IN ('PENDING', 'COMPLETED', 'ERROR')),
    CONSTRAINT scrape_jobs_unique UNIQUE (cell_id, source, query)
);

CREATE TABLE urban_zones (
    zone_id VARCHAR(64) PRIMARY KEY,
    neighborhood_name VARCHAR(100),
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
    population INTEGER NOT NULL DEFAULT 0,
    households INTEGER NOT NULL DEFAULT 0,
    population_density_ha NUMERIC(12,4),
    land_value_m2 NUMERIC(12,2),
    socioeconomic_index NUMERIC(5,2),
    source VARCHAR(32) NOT NULL DEFAULT 'indec'
);

CREATE TABLE category_params (
    category VARCHAR(100) PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    ticket_ars NUMERIC(12,2) NOT NULL,
    visits_per_review NUMERIC(8,2) NOT NULL DEFAULT 40,
    notes TEXT NOT NULL
);

CREATE TABLE tax_brackets (
    code VARCHAR(50) PRIMARY KEY,
    regime_group VARCHAR(32) NOT NULL,
    annual_cap_ars NUMERIC(15,2),
    notes TEXT NOT NULL
);

CREATE TABLE activity_tiers (
    tier SMALLINT PRIMARY KEY,
    min_monthly_ars NUMERIC(15,2) NOT NULL,
    label VARCHAR(80) NOT NULL
);

CREATE TABLE model_settings (
    key TEXT PRIMARY KEY,
    value NUMERIC NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id VARCHAR(128) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    subcategories TEXT[],
    address VARCHAR(255),
    neighborhood VARCHAR(100),
    phone VARCHAR(50),
    website TEXT,
    geom GEOMETRY(Point, 4326) NOT NULL,
    zone_id VARCHAR(64) REFERENCES urban_zones(zone_id),
    source VARCHAR(32) NOT NULL DEFAULT 'unknown',

    rating NUMERIC(2,1),
    reviews_total INTEGER NOT NULL DEFAULT 0,
    reviews_last_90d INTEGER NOT NULL DEFAULT 0,
    weekly_open_hours INTEGER,
    opening_hours TEXT,
    price_level SMALLINT,

    cuit VARCHAR(13),
    legal_name VARCHAR(255),
    tax_regime VARCHAR(50),
    activity_code_clae VARCHAR(20),
    activity_started_on DATE,
    bcra_entities TEXT[],
    bcra_worst_status SMALLINT,
    bcra_total_debt_ars NUMERIC(15,2) NOT NULL DEFAULT 0,
    bcra_debt_thousands NUMERIC(15,2),

    activity_tier SMALLINT NOT NULL DEFAULT 1,
    estimated_monthly_revenue_ars NUMERIC(15,2),
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT businesses_tier_chk CHECK (activity_tier BETWEEN 1 AND 5),
    CONSTRAINT businesses_rating_chk CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    CONSTRAINT businesses_bcra_chk CHECK (bcra_worst_status IS NULL OR bcra_worst_status BETWEEN 1 AND 5),
    CONSTRAINT businesses_source_chk CHECK (source IN ('google_maps', 'osm', 'manual', 'unknown'))
);

CREATE INDEX idx_scrape_grid_bbox ON scrape_grid USING GIST (bbox);
CREATE INDEX idx_scrape_grid_status ON scrape_grid (status);
CREATE INDEX idx_scrape_jobs_pending ON scrape_jobs (source, query, status, cell_id);
CREATE INDEX idx_urban_zones_geom ON urban_zones USING GIST (geom);
CREATE INDEX idx_urban_zones_geog ON urban_zones USING GIST ((geom::geography));
CREATE INDEX idx_businesses_geom ON businesses USING GIST (geom);
CREATE INDEX idx_businesses_geog ON businesses USING GIST ((geom::geography));
CREATE INDEX idx_businesses_category ON businesses (category);
CREATE INDEX idx_businesses_cuit ON businesses (cuit);
CREATE INDEX idx_businesses_name_trgm ON businesses USING GIN (name gin_trgm_ops);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER businesses_touch
BEFORE UPDATE ON businesses
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION urban_zones_fill_density()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    area_m2 DOUBLE PRECISION;
BEGIN
    area_m2 := ST_Area(NEW.geom::geography);
    IF area_m2 > 0 THEN
        NEW.population_density_ha := ROUND((NEW.population / (area_m2 / 10000.0))::numeric, 4);
    ELSE
        NEW.population_density_ha := 0;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER urban_zones_density
BEFORE INSERT OR UPDATE OF geom, population ON urban_zones
FOR EACH ROW EXECUTE FUNCTION urban_zones_fill_density();
