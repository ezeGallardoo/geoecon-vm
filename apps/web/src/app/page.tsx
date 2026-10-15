"use client";

import dynamic from "next/dynamic";

const Visor = dynamic(() => import("@/components/visor").then((mod) => mod.Visor), {
  ssr: false,
  loading: () => <div className="boot">Abriendo el ejido…</div>,
});

export default function Home() {
  return <Visor />;
}
