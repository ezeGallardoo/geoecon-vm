import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Newsreader } from "next/font/google";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "GeoEcon VM",
  description: "Inteligencia geoespacial y estimación económica del ejido de Villa María.",
};

export const viewport: Viewport = {
  themeColor: "#101612",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${atkinson.variable} ${newsreader.variable}`}>
        <a className="skip" href="#mesa">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
