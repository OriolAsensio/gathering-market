// Prepara mobile/www (lo que va dentro del APK) a partir de la app de ../app:
//  - copia la interfaz y el motor
//  - mete una copia del paquete de datos (para que funcione sin internet la primera vez)
//  - mete el lector de texto del escáner (Tesseract) para no depender de internet
//  - escribe config.js con la dirección del paquete diario en internet (GM_PACK_URL)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, "..");
const app = join(mobile, "..", "app");
const www = join(mobile, "www");
const nm = join(mobile, "node_modules");

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
// el historial (gráficas) se baja de internet solo cuando hace falta: no va en el APK
cpSync(app, www, { recursive: true, filter: (src) => !src.endsWith("config.js") && !/[\\/]pack[\\/]history/.test(src) });
if (!existsSync(join(www, "pack", "cards.json"))) {
  throw new Error("Falta app/pack: ejecuta antes  python pipeline/export_pack.py app/pack");
}

const tess = join(www, "vendor", "tesseract");
mkdirSync(join(tess, "core"), { recursive: true });
mkdirSync(join(tess, "lang"), { recursive: true });
for (const f of ["tesseract.min.js", "worker.min.js"]) cpSync(join(nm, "tesseract.js", "dist", f), join(tess, f));
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm", "tesseract-core-simd-lstm.wasm"]) {
  cpSync(join(nm, "tesseract.js-core", f), join(tess, "core", f));
}
// Descomprimido: Android quita la extensión .gz de los archivos del APK y Tesseract no lo encontraría.
for (const lang of ["eng", "spa", "fra", "jpn"]) {  // inglés, español, francés, japonés
  writeFileSync(join(tess, "lang", `${lang}.traineddata`),
    gunzipSync(readFileSync(join(nm, "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`))));
}

const packUrl = process.env.GM_PACK_URL || "";
writeFileSync(join(www, "config.js"), `// Generado por mobile/scripts/build-web.mjs
window.GM_CONFIG = {
  packUrl: ${JSON.stringify(packUrl)},      // paquete diario en internet ("" = solo la copia del APK)
  bundledPackUrl: "pack/",                  // copia que va dentro del APK
  tesseractBase: "vendor/tesseract/",       // lector del escáner, sin internet
};
`);
// Tarea en segundo plano (notificaciones sin abrir la app), con la dirección del paquete diario.
mkdirSync(join(www, "runners"), { recursive: true });
writeFileSync(join(www, "runners", "background.js"),
  readFileSync(join(mobile, "runners", "background.js"), "utf8").replace("__PACK_URL__", packUrl ? packUrl.replace(/\/?$/, "/") : ""));
// Código nativo propio (mobile/android no está en git): lector de texto del escáner (ML Kit).
const javaDir = join(mobile, "android", "app", "src", "main", "java", "app", "gatheringmarket");
if (existsSync(javaDir)) {
  for (const f of ["OcrPlugin.java", "MainActivity.java"]) cpSync(join(mobile, "native", f), join(javaDir, f));
  const gradle = join(mobile, "android", "app", "build.gradle"), dep = 'implementation "com.google.mlkit:text-recognition:16.0.1"';
  const g = readFileSync(gradle, "utf8");
  if (!g.includes(dep)) writeFileSync(gradle, g.replace("implementation project(':capacitor-android')", `implementation project(':capacitor-android')
    ${dep}`));
}
console.log(`www listo. Paquete en internet: ${packUrl || "(ninguno todavía)"}`);
