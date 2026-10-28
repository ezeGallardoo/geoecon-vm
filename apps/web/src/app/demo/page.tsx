import { GridDemo } from "@/components/grid-demo";

export default function DemoPage() {
  return (
    <main id="mesa" className="desk">
      <GridDemo />
      <p className="hint demo-note">
        380 celdas de 400 m. Sin comercios ni huecos de demanda.
      </p>
    </main>
  );
}
