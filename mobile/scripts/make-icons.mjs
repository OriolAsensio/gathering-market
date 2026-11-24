// Genera las imágenes de partida para el icono y la pantalla de carga de Android
// (mobile/assets/*.png); después `npx capacitor-assets generate --android` crea todos los tamaños.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(out, { recursive: true });
const BG = "#140e09", GOLD = "#d6a84e", FILL = "#3a1f14";

// Logo: una carta al final de una gráfica que sube (el mismo que en la app), en un lienzo de 64x64.
const shield = `<g fill="none" stroke="${GOLD}" stroke-linecap="round" stroke-linejoin="round"><path d="M11 9v43h44" stroke-width="4.2"/><path d="M14 49 27 33l9 8 11-14" stroke-width="4.2"/></g><g transform="rotate(14 49 16)"><rect x="42" y="6" width="14" height="20" rx="2" fill="${FILL}" stroke="${GOLD}" stroke-width="2.4"/><rect x="44.6" y="8.6" width="8.8" height="14.8" rx=".8" fill="none" stroke="${GOLD}" stroke-width=".8" opacity=".55"/><path d="M49 11.5l2.6 4.5-2.6 4.5-2.6-4.5z" fill="${GOLD}"/></g>`;

const svg = (size, inner, { bg = BG, scale = 1 } = {}) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
     ${bg ? `<rect width="64" height="64" fill="${bg}"/>` : ""}
     <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${inner}</g>
   </svg>`);

await sharp(svg(1024, shield, { scale: 0.92 })).png().toFile(join(out, "icon-only.png"));
await sharp(svg(1024, shield, { bg: null, scale: 0.62 })).png().toFile(join(out, "icon-foreground.png"));
await sharp(svg(1024, "", {})).png().toFile(join(out, "icon-background.png"));
for (const name of ["splash.png", "splash-dark.png"]) {
  await sharp(svg(2732, shield, { scale: 0.28 })).png().toFile(join(out, name));
}
// Icono pequeño de las notificaciones de Android (silueta blanca: Android la pinta del color del sistema)
const res = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "app", "src", "main", "res");
const white = shield.replaceAll(GOLD, "#ffffff").replaceAll(FILL, "none");
for (const [dpi, px] of [["mdpi", 24], ["hdpi", 36], ["xhdpi", 48], ["xxhdpi", 72], ["xxxhdpi", 96]]) {
  mkdirSync(join(res, `drawable-${dpi}`), { recursive: true });
  await sharp(svg(px, white, { bg: null, scale: 1.08 })).png().toFile(join(res, `drawable-${dpi}`, "ic_stat_gm.png"));
}

// Iconos de la web (PWA y pantalla de inicio de iPhone, que redondea las esquinas sola)
const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
await sharp(svg(512, shield, { scale: 0.92 })).png().toFile(join(web, "icon-512.png"));
await sharp(svg(180, shield, { scale: 0.92 })).png().toFile(join(web, "apple-touch-icon.png"));
console.log("Imágenes de icono y pantalla de carga creadas en", out);
