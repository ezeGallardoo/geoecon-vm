"use client";

import { useState } from "react";
import type { FeatureCollection, Polygon } from "geojson";
import {
  money,
  safeHttp,
  SOURCE_LABEL,
  telHref,
  TIER_LABEL,
  type BusinessDetail,
  type CategoryStat,
  type GapCell,
  type Overview,
  type RadiusReport,
} from "@/lib/domain";
import { formatLandUsd } from "@/lib/land";

type GapCollection = FeatureCollection<Polygon, GapCell>;

interface InspectorProps {
  overview: Overview | null;
  report: RadiusReport | null;
  gaps: GapCollection;
  detail: BusinessDetail | null;
  radiusM: number;
  category: string;
  loading: boolean;
  booting: boolean;
  dbError: string | null;
  cityName: string;
  cityBusinessCount: number;
  censusPopulation: number;
  onClose: () => void;
  onRetry: () => void;
  onFocusCell: (cell: GapCell) => void;
}

export function Inspector({
  overview,
  report,
  gaps,
  detail,
  radiusM,
  category,
  loading,
  booting,
  dbError,
  cityName,
  cityBusinessCount,
  censusPopulation,
  onClose,
  onRetry,
  onFocusCell,
}: InspectorProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAllGaps, setShowAllGaps] = useState(false);
  const labelOf = (value: string) => overview?.labels[value] ?? value;
  const rows = (report?.categories ?? [])
    .filter((item) => item.total > 0 && (!category || item.category === category))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, "es"));
  const visibleRows = category || expanded ? rows : rows.slice(0, 8);
  const headline = category ? (rows[0]?.total ?? 0) : (report?.businessCount ?? 0);
  const selected = category
    ? report?.categories.find((item) => item.category === category)
    : null;
  const scarcest = category
    ? null
    : [...(report?.categories ?? [])]
        .filter((item) => item.total > 0 && item.coverage != null)
        .sort((a, b) => (a.coverage ?? 99) - (b.coverage ?? 99))[0];
  const phoneHref = detail ? telHref(detail.phone) : null;
  const websiteHref = detail ? safeHttp(detail.website) : null;

  return (
    <aside className="inspector" aria-label="Lectura del padrón">
      <p className="eyebrow">Villa María y Villa Nueva · Córdoba</p>
      <h1>Mesa de catastro comercial</h1>
      <p className="lede">
        El mapa lee el padrón ya cargado. El cálculo del radio corre en <span translate="no">PostGIS</span>,
        no en el navegador.
      </p>

      {dbError ? (
        <p className="alert" role="alert">
          {dbError}
          <button type="button" onClick={onRetry}>
            Reintentá
          </button>
        </p>
      ) : null}

      <dl className="meters">
        <div>
          <dt>Comercios</dt>
          <dd>
            {booting ? "…" : count(cityBusinessCount)}
            <small>{cityName}</small>
          </dd>
        </div>
        <div>
          <dt>Celdas</dt>
          <dd>{booting ? "…" : count(overview?.cellCount)}</dd>
        </div>
        <div>
          <dt>Habitantes</dt>
          <dd>
            {booting ? "…" : count(censusPopulation)}
            <small>censo 2022</small>
          </dd>
        </div>
      </dl>

      <section aria-live="polite" aria-busy={loading}>
        <header>
          <h2>Radio de {radiusM.toLocaleString("es-AR")} m</h2>
          {loading ? <span>Calculando…</span> : null}
        </header>
        {report ? (
          <>
            <dl className="cross">
              <div>
                <dt>En el círculo</dt>
                <dd>
                  {headline.toLocaleString("es-AR")}
                  <small>{category ? labelOf(category).toLowerCase() : "comercios"}</small>
                </dd>
              </div>
              <div>
                <dt>Habitantes</dt>
                <dd>
                  {report.populationIntersected > 0
                    ? report.populationIntersected.toLocaleString("es-AR")
                    : "sin censo"}
                </dd>
              </div>
              <div>
                <dt>Suelo</dt>
                <dd>
                  {report.landValueM2 != null ? formatLandUsd(report.landValueM2) : "sin VUT"}
                  {report.landCoef != null ? <small>{soilWord(report.landCoef)}</small> : null}
                </dd>
              </div>
              <div>
                <dt>Cobertura</dt>
                <dd>
                  {selected?.coverage != null ? selected.coverage.toLocaleString("es-AR") : "—"}
                  {selected?.cityInhabitantsPerBusiness != null ? (
                    <small>ciudad, 1 cada {selected.cityInhabitantsPerBusiness.toLocaleString("es-AR")}</small>
                  ) : null}
                </dd>
              </div>
            </dl>
            {selected ? (
              <p className="saturation">{huecoSentence(labelOf(selected.category), selected, report.cityName || cityName)}</p>
            ) : scarcest?.gap === "hueco" ? (
              <p className="saturation">
                El rubro más descubierto en este círculo es {labelOf(scarcest.category).toLowerCase()}.
              </p>
            ) : null}
            <p className="statline">
              Movimiento estimado:{" "}
              {report.avgRevenueArs == null
                ? "sin señal de tráfico todavía"
                : `${money(report.avgRevenueArs)} promedio`}
            </p>
            {selected && (selected.potentialConsumptionArs ?? 0) > 0 ? (
              <p className="potential">
                <span>Consumo potencial</span>
                <strong>{money(selected.potentialConsumptionArs)}</strong>
                <small>por mes, con el ticket supuesto del rubro</small>
              </p>
            ) : null}
            {category && gaps.features.length > 0 ? (
              <div className="where">
                <h3>Dónde mirar</h3>
                <ol>
                  {(showAllGaps ? gaps.features : gaps.features.slice(0, 5)).map((feature, index) => (
                    <li key={feature.properties.cellId}>
                      <button type="button" onClick={() => onFocusCell(feature.properties)}>
                        <b>{index + 1}</b>
                        <span>
                          {feature.properties.population.toLocaleString("es-AR")} hab. ·{" "}
                          {feature.properties.businessCount.toLocaleString("es-AR")}{" "}
                          {labelOf(category).toLowerCase()}
                        </span>
                        <small>
                          {soilWord(feature.properties.landCoef)} · {gapWord(feature.properties.gap)}
                        </small>
                      </button>
                    </li>
                  ))}
                </ol>
                {gaps.features.length > 5 ? (
                  <button
                    type="button"
                    className="text-button"
                    aria-expanded={showAllGaps}
                    onClick={() => setShowAllGaps((value) => !value)}
                  >
                    {showAllGaps ? "Ver menos" : `Ver las ${gaps.features.length.toLocaleString("es-AR")} celdas`}
                  </button>
                ) : null}
              </div>
            ) : null}
            <ul className="bars">
              {visibleRows.map((item) => {
                const max = rows[0]?.total || 1;
                const label = labelOf(item.category);
                return (
                  <li key={item.category}>
                    <span title={label}>{label}</span>
                    <span className="track" aria-hidden="true">
                      <span style={{ width: `${(item.total / max) * 100}%` }} />
                    </span>
                    <b>{item.total.toLocaleString("es-AR")}</b>
                  </li>
                );
              })}
              {rows.length === 0 ? (
                <li className="empty">
                  {category
                    ? `No hay ${labelOf(category).toLowerCase()} en este círculo.`
                    : "No hay comercios en este círculo."}
                </li>
              ) : null}
            </ul>
            {!category && rows.length > 8 ? (
              <button
                type="button"
                className="text-button"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Ver menos" : `Ver los ${rows.length.toLocaleString("es-AR")} rubros`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="empty">{booting || loading ? "Cargando el padrón…" : "No se pudo calcular el radio."}</p>
        )}
      </section>

      <section>
        <header>
          <h2>Ficha</h2>
          {detail ? (
            <button type="button" className="text-button" onClick={onClose}>
              Cerrar ficha
            </button>
          ) : null}
        </header>
        {detail ? (
          <div className="ficha">
            <h3>{detail.name}</h3>
            <p className="rubro">{detail.label}</p>
            {detail.address ? <p>{detail.address}</p> : null}
            <dl>
              <div>
                <dt>Origen</dt>
                <dd translate="no">{SOURCE_LABEL[detail.source] ?? detail.source}</dd>
              </div>
              <div>
                <dt>Teléfono</dt>
                <dd>
                  {phoneHref ? <a href={phoneHref}>{detail.phone}</a> : (detail.phone ?? "sin dato")}
                </dd>
              </div>
              <div>
                <dt>Sitio</dt>
                <dd>
                  {websiteHref ? (
                    <a href={websiteHref} target="_blank" rel="noopener noreferrer">
                      {detail.website}
                    </a>
                  ) : (
                    "sin dato"
                  )}
                </dd>
              </div>
              <div>
                <dt>Tier</dt>
                <dd>
                  {detail.tier} · {TIER_LABEL[detail.tier]}
                </dd>
              </div>
              <div>
                <dt>Estimado mensual</dt>
                <dd>{money(detail.revenue)}</dd>
              </div>
              <div>
                <dt>Promedio del rubro</dt>
                <dd>{money(detail.categoryAvgRevenue)}</dd>
              </div>
              <div>
                <dt>Reseñas</dt>
                <dd>
                  {detail.reviewsTotal}
                  {detail.rating ? ` · ${detail.rating.toFixed(1)}` : ""}
                  {detail.reviewsLast90d ? ` · ${detail.reviewsLast90d} en 90 días` : ""}
                </dd>
              </div>
              <div>
                <dt>Horario</dt>
                <dd>{detail.openingHours ?? (detail.weeklyOpenHours ? `${detail.weeklyOpenHours} h/semana` : "—")}</dd>
              </div>
              <div>
                <dt translate="no">CUIT</dt>
                <dd>{detail.cuit ?? "sin vincular"}</dd>
              </div>
              <div>
                <dt>Razón social</dt>
                <dd>{detail.legalName ?? "—"}</dd>
              </div>
              <div>
                <dt>Régimen</dt>
                <dd>{detail.taxRegime ?? "—"}</dd>
              </div>
              <div>
                <dt translate="no">CLAE</dt>
                <dd>{detail.clae ?? "—"}</dd>
              </div>
              <div>
                <dt>Inicio</dt>
                <dd>{detail.activityStartedOn ?? "—"}</dd>
              </div>
              <div>
                <dt translate="no">BCRA</dt>
                <dd>
                  {detail.bcraWorstStatus
                    ? `Situación ${detail.bcraWorstStatus} · deuda ${money(detail.bcraDebtArs)}`
                    : "sin consulta"}
                </dd>
              </div>
              <div>
                <dt>Entidades</dt>
                <dd>{detail.bcraEntities?.length ? detail.bcraEntities.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt>Suelo</dt>
                <dd>
                  {detail.landValueM2 != null ? formatLandUsd(detail.landValueM2) : "sin VUT"}
                  {detail.zoneName ? ` · ${detail.zoneName}` : ""}
                </dd>
              </div>
            </dl>
            <p className="note">
              El estimado combina reseñas, ticket del rubro, piso fiscal si hay tope cargado y el valor de
              la cuadra. No es una declaración jurada.
            </p>
          </div>
        ) : (
          <p className="empty">Tocá un punto, o buscá un nombre, para ver la ficha.</p>
        )}
      </section>
    </aside>
  );
}

function count(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("es-AR");
}

function gapWord(gap: CategoryStat["gap"]): string {
  if (gap === "hueco") return "descubierta";
  if (gap === "saturado") return "llena";
  if (gap === "pareja") return "pareja";
  return "sin comparar";
}

function huecoSentence(label: string, stat: CategoryStat, cityName: string): string {
  const name = label.toLowerCase();
  if (stat.total === 0) return `No hay ${name} en este círculo. La zona está descubierta.`;
  const local = stat.inhabitantsPerBusiness;
  const estado =
    stat.gap === "hueco" ? "descubierta" : stat.gap === "saturado" ? "llena" : `como el resto de ${cityName}`;
  if (local == null) return `Hay ${stat.total.toLocaleString("es-AR")} de ${name} en el círculo.`;
  return `1 ${name} cada ${local.toLocaleString("es-AR")} habitantes. La zona está ${estado}.`;
}

function soilWord(coef: number | null): string {
  if (coef == null) return "sin suelo";
  if (coef >= 1.15) return "suelo caro";
  if (coef <= 0.9) return "suelo barato";
  return "suelo medio";
}
