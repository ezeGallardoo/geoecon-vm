"use client";

import { useState } from "react";
import {
  money,
  safeHttp,
  SOURCE_LABEL,
  telHref,
  TIER_LABEL,
  type BusinessDetail,
  type Overview,
  type RadiusReport,
} from "@/lib/domain";

interface InspectorProps {
  overview: Overview | null;
  report: RadiusReport | null;
  detail: BusinessDetail | null;
  radiusM: number;
  category: string;
  loading: boolean;
  booting: boolean;
  dbError: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function Inspector({
  overview,
  report,
  detail,
  radiusM,
  category,
  loading,
  booting,
  dbError,
  onClose,
  onRetry,
}: InspectorProps) {
  const [expanded, setExpanded] = useState(false);
  const labelOf = (value: string) => overview?.labels[value] ?? value;
  const rows = (report?.categories ?? [])
    .filter((item) => item.total > 0 && (!category || item.category === category))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, "es"));
  const visibleRows = category || expanded ? rows : rows.slice(0, 8);
  const headline = category ? (rows[0]?.total ?? 0) : (report?.businessCount ?? 0);
  const focus = category ? rows[0] : report?.categories[0];
  const phoneHref = detail ? telHref(detail.phone) : null;
  const websiteHref = detail ? safeHttp(detail.website) : null;

  return (
    <aside className="inspector" aria-label="Lectura del padrón">
      <p className="eyebrow">Villa María · Córdoba</p>
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
          <dd>{booting ? "…" : count(overview?.businessCount)}</dd>
        </div>
        <div>
          <dt>Celdas</dt>
          <dd>{booting ? "…" : count(overview?.cellCount)}</dd>
        </div>
        <div>
          <dt>Zonas</dt>
          <dd>{booting ? "…" : count(overview?.zoneCount)}</dd>
        </div>
      </dl>

      <section aria-live="polite" aria-busy={loading}>
        <header>
          <h2>Radio de {radiusM.toLocaleString("es-AR")} m</h2>
          {loading ? <span>Calculando…</span> : null}
        </header>
        {report ? (
          <>
            <p className="statline">
              {category
                ? `${headline.toLocaleString("es-AR")} de ${labelOf(category).toLowerCase()} en el círculo`
                : `${headline.toLocaleString("es-AR")} comercios`}
              {report.populationIntersected > 0
                ? ` · ${report.populationIntersected.toLocaleString("es-AR")} habitantes en los radios censales que toca el círculo`
                : " · sin población censal cargada"}
            </p>
            {focus && focus.total > 0 && report.populationIntersected > 0 ? (
              <p className="saturation">
                1 {labelOf(focus.category).toLowerCase()} cada{" "}
                {Math.round(report.populationIntersected / focus.total).toLocaleString("es-AR")} habitantes
              </p>
            ) : null}
            <p className="statline">
              Movimiento estimado de la zona:{" "}
              {report.avgRevenueArs == null
                ? "sin señal de tráfico todavía"
                : `${money(report.avgRevenueArs)} promedio`}
            </p>
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
                  {detail.landValueM2 != null
                    ? `${detail.landValueM2.toLocaleString("es-AR")} / m²`
                    : "sin VUT"}
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
