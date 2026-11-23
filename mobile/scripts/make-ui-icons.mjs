// Convierte iconos en blanco y negro (PNG) en máscaras transparentes para app/icons/:
// en la app se pintan con el color del tema (CSS mask), así se ven bien en oscuro y en pergamino.
// Uso: node scripts/make-ui-icons.mjs <carpeta> nombre=archivo.png ...
import sharp from "sharp";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [dir, ...pairs] = process.argv.slice(2);
for (const pair of pairs) {
  const [name, file] = pair.split("=");
  const { data, info } = await sharp(join(dir, file)).flatten({ background: "#ffffff" }).greyscale()
    .resize(128, 128, { fit: "contain", background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) rgba[i * 4 + 3] = 255 - data[i * info.channels];
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png()
    .toFile(fileURLToPath(new URL(`../../app/icons/${name}.png`, import.meta.url)));
  console.log(name);
}
