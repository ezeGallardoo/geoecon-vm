-- Coeficientes del modelo (RF-09). Son supuestos editables, no datos oficiales.
-- ticket_ars está en pesos de referencia para ordenar rubros entre sí.
-- Los topes de monotributo quedan vacíos a propósito: cambian por resolución
-- de ARCA y no se inventan acá. Cuando se cargan, el piso fiscal entra solo.

INSERT INTO category_params (category, label, ticket_ars, visits_per_review, notes) VALUES
    ('kiosco', 'Kiosco', 2500, 90, 'Ticket bajo, muchas visitas por cada reseña'),
    ('despensa', 'Despensa', 6000, 70, 'Compra de reposición'),
    ('almacen', 'Almacén', 7000, 60, 'Compra de cercanía'),
    ('supermercado', 'Supermercado', 18000, 220, 'Ticket alto y mucho tráfico por reseña'),
    ('farmacia', 'Farmacia', 9000, 50, 'Ticket medio'),
    ('ferreteria', 'Ferretería', 15000, 25, 'Visitas menos frecuentes'),
    ('corralon', 'Corralón', 45000, 12, 'Ticket de obra'),
    ('panaderia', 'Panadería', 4000, 80, 'Compra diaria'),
    ('carniceria', 'Carnicería', 12000, 40, 'Compra frecuente'),
    ('verduleria', 'Verdulería', 5000, 55, 'Compra frecuente'),
    ('restaurante', 'Restaurante', 14000, 18, 'La reseña representa pocas visitas'),
    ('cafeteria', 'Cafetería', 6000, 30, 'Consumo en local'),
    ('heladeria', 'Heladería', 5000, 35, 'Consumo estacional'),
    ('indumentaria', 'Indumentaria', 22000, 15, 'Ticket de prenda'),
    ('calzado', 'Calzado', 28000, 12, 'Ticket de par'),
    ('estacion_servicio', 'Estación de servicio', 20000, 40, 'Combustible y tienda'),
    ('gomeria', 'Gomería', 25000, 8, 'Servicio esporádico'),
    ('taller_mecanico', 'Taller mecánico', 35000, 8, 'Servicio esporádico'),
    ('peluqueria', 'Peluquería', 8000, 20, 'Turno'),
    ('gimnasio', 'Gimnasio', 15000, 10, 'Cuota, no visita suelta'),
    ('veterinaria', 'Veterinaria', 16000, 12, 'Consulta'),
    ('libreria', 'Librería', 8000, 15, 'Ticket medio'),
    ('casa_de_repuestos', 'Casa de repuestos', 30000, 10, 'Ticket de repuesto'),
    ('distribuidora', 'Distribuidora', 40000, 8, 'Venta mayorista de cercanía'),
    ('industria', 'Industria', 1, 1, 'Sin proxy de reseñas confiable'),
    ('galpon', 'Galpón', 1, 1, 'Sin proxy de reseñas confiable'),
    ('institucion', 'Institución', 1, 1, 'No se estima facturación comercial'),
    ('otro', 'Otro', 8000, 20, 'Coeficiente genérico')
ON CONFLICT (category) DO NOTHING;

INSERT INTO tax_brackets (code, regime_group, annual_cap_ars, notes) VALUES
    ('MONOTRIBUTO_A', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_B', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_C', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_D', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_E', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_F', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_G', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_H', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_I', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_J', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('MONOTRIBUTO_K', 'monotributo', NULL, 'Cargar el tope anual vigente de ARCA'),
    ('RESP_INSCRIPTO', 'responsable_inscripto', NULL, 'Sin tope. La señal sale del crédito en situación 1'),
    ('SOCIEDAD', 'sociedad', NULL, 'S.R.L., S.A. o S.A.S.')
ON CONFLICT (code) DO NOTHING;

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
