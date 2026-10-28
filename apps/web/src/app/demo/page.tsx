import { GridDemo } from "@/components/grid-demo";

export default function DemoPage() {
  return (
    <main id="mesa" className="desk">
      <GridDemo />
      <p className="hint demo-note">
        Grilla de 400 m de Villa María y Villa Nueva, la misma que arma
        generate_vm_grid(). No muestra comercios ni huecos de demanda.
      </p>
    </main>
  );
}
