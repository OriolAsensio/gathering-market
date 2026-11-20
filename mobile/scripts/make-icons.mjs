// Genera las imágenes de partida para el icono y la pantalla de carga de Android
// (mobile/assets/*.png); después `npx capacitor-assets generate --android` crea todos los tamaños.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(out, { recursive: true });
const BG = "#140e09", GOLD = "#d6a84e", FILL = "#3a1f14";

// Escudo con moneda (el mismo blasón que en la app), en un lienzo de 64x64.
const shield = `
  <path d="M32 6 11 13v16c0 13 9 22 21 27 12-5 21-14 21-27V13z" fill="${FILL}" stroke="${GOLD}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M32 11 16 16.5v12c0 10 6.5 17 16 21 9.5-4 16-11 16-21v-12z" fill="none" stroke="${GOLD}" stroke-width="1" opacity=".5"/>
  <circle cx="32" cy="28" r="9" fill="${GOLD}"/>
  <path d="M32 22l2.6 6-2.6 6-2.6-6z" fill="${FILL}"/>`;

const svg = (size, inner, { bg = BG, scale = 1 } = {}) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
     ${bg ? `<rect width="64" height="64" fill="${bg}"/>` : ""}
     <g transform="translate(32 31) scale(${scale}) translate(-32 -31)">${inner}</g>
   </svg>`);

await sharp(svg(1024, shield, { scale: 1.05 })).png().toFile(join(out, "icon-only.png"));
await sharp(svg(1024, shield, { bg: null, scale: 0.62 })).png().toFile(join(out, "icon-foreground.png"));
await sharp(svg(1024, "", {})).png().toFile(join(out, "icon-background.png"));
for (const name of ["splash.png", "splash-dark.png"]) {
  await sharp(svg(2732, shield, { scale: 0.28 })).png().toFile(join(out, name));
}
console.log("Imágenes de icono y pantalla de carga creadas en", out);
