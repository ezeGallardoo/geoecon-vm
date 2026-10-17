-- Coeficientes del modelo (RF-09). Son supuestos editables, no datos oficiales.
-- ticket_ars está en pesos de referencia para ordenar rubros entre sí.
-- Los topes de monotributo quedan vacíos a propósito: cambian por resolución
-- de ARCA y no se inventan acá. Cuando se cargan, el piso fiscal entra solo.

-- purchases_per_capita_month es un supuesto de compras mensuales por habitante.
-- Sirve para el consumo potencial. No es facturación observada.
INSERT INTO category_params (category, label, ticket_ars, visits_per_review, purchases_per_capita_month, notes) VALUES
    ('kiosco', 'Kiosco', 2500, 90, 4, 'Ticket bajo, muchas visitas por cada reseña'),
    ('despensa', 'Despensa', 6000, 70, 3, 'Compra de reposición'),
    ('almacen', 'Almacén', 7000, 60, 2, 'Compra de cercanía'),
    ('supermercado', 'Supermercado', 18000, 220, 4, 'Ticket alto y mucho tráfico por reseña'),
    ('farmacia', 'Farmacia', 9000, 50, 0.4, 'Ticket medio'),
    ('ferreteria', 'Ferretería', 15000, 25, 0.15, 'Visitas menos frecuentes'),
    ('corralon', 'Corralón', 45000, 12, 0.05, 'Ticket de obra'),
    ('panaderia', 'Panadería', 4000, 80, 4, 'Compra diaria'),
    ('carniceria', 'Carnicería', 12000, 40, 3, 'Compra frecuente'),
    ('verduleria', 'Verdulería', 5000, 55, 4, 'Compra frecuente'),
    ('restaurante', 'Restaurante', 14000, 18, 2, 'La reseña representa pocas visitas'),
    ('cafeteria', 'Cafetería', 6000, 30, 2, 'Consumo en local'),
    ('heladeria', 'Heladería', 5000, 35, 1, 'Consumo estacional'),
    ('indumentaria', 'Indumentaria', 22000, 15, 0.2, 'Ticket de prenda'),
    ('calzado', 'Calzado', 28000, 12, 0.08, 'Ticket de par'),
    ('estacion_servicio', 'Estación de servicio', 20000, 40, 2, 'Combustible y tienda'),
    ('gomeria', 'Gomería', 25000, 8, 0.04, 'Servicio esporádico'),
    ('taller_mecanico', 'Taller mecánico', 35000, 8, 0.08, 'Servicio esporádico'),
    ('peluqueria', 'Peluquería', 8000, 20, 0.3, 'Turno'),
    ('gimnasio', 'Gimnasio', 15000, 10, 0.04, 'Cuota, no visita suelta'),
    ('veterinaria', 'Veterinaria', 16000, 12, 0.05, 'Consulta'),
    ('libreria', 'Librería', 8000, 15, 0.1, 'Ticket medio'),
    ('casa_de_repuestos', 'Casa de repuestos', 30000, 10, 0.05, 'Ticket de repuesto'),
    ('distribuidora', 'Distribuidora', 40000, 8, 0.02, 'Venta mayorista de cercanía'),
    ('agro', 'Agro', 25000, 6, 0.02, 'Insumo rural, poca compra por habitante urbano'),
    ('concesionaria', 'Concesionaria', 80000, 4, 0.01, 'Compra muy esporádica'),
    ('electronica', 'Electrónica', 40000, 8, 0.08, 'Equipo o celular'),
    ('muebleria', 'Mueblería', 50000, 5, 0.02, 'Compra de equipamiento'),
    ('inmobiliaria', 'Inmobiliaria', 1, 6, 0.01, 'No vende un ticket de mostrador'),
    ('perfumeria', 'Perfumería', 8000, 15, 0.15, 'Cuidado personal'),
    ('optica', 'Óptica', 20000, 8, 0.03, 'Compra esporádica'),
    ('mascotas', 'Mascotas', 9000, 12, 0.08, 'Alimento y accesorios'),
    ('industria', 'Industria', 1, 1, 0, 'Sin proxy de reseñas confiable'),
    ('galpon', 'Galpón', 1, 1, 0, 'Sin proxy de reseñas confiable'),
    ('institucion', 'Institución', 1, 1, 0, 'No se estima facturación comercial'),
    ('otro', 'Otro', 8000, 20, 0.2, 'Coeficiente genérico')
ON CONFLICT (category) DO NOTHING;

-- Topes de ingresos brutos del monotributo. Valores de aplicación desde el
-- 01/08/2026, fuente oficial afip.gob.ar/monotributo/categorias.asp.
--
-- ES UN SNAPSHOT Y SE QUEDA VIEJO: ARCA los actualiza por resolución dos veces
-- al año. Antes de confiar en el piso fiscal hay que revisarlos contra la
-- resolución vigente y corregir esta tabla.
--
-- OJO: cargar esto no alcanza por sí solo. El piso fiscal se activa por el join
-- `tax_brackets.code = businesses.tax_regime`, y tax_regime viene del padrón de
-- CUIT (comando arca-csv). Con tax_regime en NULL la función ignora estos topes.
INSERT INTO tax_brackets (code, regime_group, annual_cap_ars, notes) VALUES
    ('MONOTRIBUTO_A', 'monotributo', 12009410.45, 'Tope anual de ingresos brutos, categoría A. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_B', 'monotributo', 17595182.74, 'Categoría B. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_C', 'monotributo', 24670494.31, 'Categoría C. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_D', 'monotributo', 30628651.43, 'Categoría D. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_E', 'monotributo', 36028231.33, 'Categoría E. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_F', 'monotributo', 45151659.41, 'Categoría F. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_G', 'monotributo', 53995798.87, 'Categoría G. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_H', 'monotributo', 81924660.37, 'Categoría H. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_I', 'monotributo', 91699761.90, 'Categoría I. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_J', 'monotributo', 105012519.20, 'Categoría J. Vigente desde 01/08/2026'),
    ('MONOTRIBUTO_K', 'monotributo', 126610838.75, 'Categoría K. Vigente desde 01/08/2026'),
    ('RESP_INSCRIPTO', 'responsable_inscripto', NULL, 'Sin tope. La señal sale del crédito en situación 1'),
    ('SOCIEDAD', 'sociedad', NULL, 'S.R.L., S.A. o S.A.S. Sin tope')
ON CONFLICT (code) DO UPDATE
    SET annual_cap_ars = EXCLUDED.annual_cap_ars,
        notes = EXCLUDED.notes;

INSERT INTO activity_tiers (tier, min_monthly_ars, label) VALUES
    (1, 0, 'Micro'),
    (2, 1500000, 'Chico'),
    (3, 6000000, 'Medio'),
    (4, 25000000, 'Grande'),
    (5, 80000000, 'Mayor')
ON CONFLICT (tier) DO NOTHING;

INSERT INTO model_settings (key, value, description) VALUES
    ('unknown_weekly_hours', 48, 'Horas semanales si el comercio no publica horario'),
    ('monotributo_utilization', 0.55, 'Fracción del tope anual que se toma como piso mensual'),
    ('credit_giro_factor', 0.15, 'Deuda en pesos × factor, solo con situación BCRA 1'),
    ('zone_coef_min', 0.75, 'Piso del coeficiente IDECOR'),
    ('zone_coef_max', 1.45, 'Techo del coeficiente IDECOR')
ON CONFLICT (key) DO NOTHING;

SELECT generate_vm_grid();
