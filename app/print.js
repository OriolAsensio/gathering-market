"use strict";
/* Imprimir proxies: PDF del mazo con las cartas a tamaño real (63 × 88 mm, 9 por hoja), sangrado opcional y líneas de corte
 * gruesas y negras (en la copistería se quejaban de que no se veían). Eliges el arte de cada carta entre todas sus ediciones
 * o subes una imagen tuya. El PDF se escribe aquí mismo (sin librerías): imágenes JPEG a 300 ppp y líneas.
 * Usa lo de app.js: $, esc, toast, api, openSheet, saveFile, ico, store. */

const Print = (() => {
  const PT = 72 / 25.4, DPI_MM = 300 / 25.4, CW = 63, CH = 88, LINE = 0.3;  // puntos por mm; píxeles por mm a 300 ppp; grosor de corte (mm)
  const PAPERS = { a4: [210, 297, "A4"], letter: [215.9, 279.4, "Carta (EE. UU.)"] };
  const arts = (() => { try { return JSON.parse(localStorage.getItem("printArts")) || {}; } catch { return {}; } })();
  const saveArts = () => { try { localStorage.setItem("printArts", JSON.stringify(arts)); } catch { /* sin espacio: se queda solo en esta sesión */ } };
  // La imagen grande de Scryfall (745 × 1040, PNG) para imprimir; la "normal" es pequeña para 300 ppp
  const hiRes = (url) => (/^https:\/\/cards\.scryfall\.io\/normal\//.test(url) ? url.replace("/normal/", "/png/").replace(/\.jpg(\?|$)/, ".png$1") : url);

  async function printSheet(d) {
    const opt = { paper: store("printPaper") || "a4", bleed: +(store("printBleed") ?? 1), lines: store("printLines") || "full", side: false, missing: false };
    const cards = [];  // { name, image, qty (del mazo), have, side, n (a imprimir) }
    for (const c of d.cards) {
      const x = cards.find((y) => y.name === c.name && y.side === !!c.side);
      if (x) x.qty += c.qty; else cards.push({ name: c.name, image: c.image, qty: c.qty, have: c.have || 0, side: !!c.side, basic: c.basic, n: c.basic ? 0 : c.qty });
    }
    const draw = () => {
      for (const c of cards) if (c.side && !opt.side) c.n = 0;
      const list = cards.filter((c) => opt.side || !c.side), total = list.reduce((s, c) => s + c.n, 0), [pw, ph, pname] = PAPERS[opt.paper];
      const seg = (k, items) => `<div class="seg" data-o="${k}">${items.map(([v, n]) => `<button data-v="${v}" class="${String(opt[k]) === String(v) ? "on" : ""}">${n}</button>`).join("")}</div>`;
      const body = openSheet(`<h3>Imprimir proxies</h3>
        <div class="hint">Cartas a tamaño real (63 × 88 mm), 9 por hoja, con líneas de corte gruesas. Toca una carta para elegir su arte o subir una imagen tuya; con − y + eliges cuántas copias.</div>
        <div class="field"><label>Papel</label>${seg("paper", Object.entries(PAPERS).map(([k, v]) => [k, v[2]]))}</div>
        <div class="field"><label>Sangrado</label>${seg("bleed", [[0, "Sin"], [1, "1 mm"], [2, "2 mm"]])}
          <div class="sub">Lo que sobresale alrededor de cada carta: así, si el corte se desvía un poco, no queda borde blanco. En la copistería suelen pedirlo.</div></div>
        <div class="field"><label>Líneas de corte</label>${seg("lines", [["full", "Por toda la hoja"], ["marks", "Solo en los márgenes"]])}</div>
        <div class="row-btns" style="margin-top:0"><button class="btn ${opt.missing ? "primary" : ""}" id="pr-missing">Solo lo que me falta</button>${cards.some((c) => c.side) ? `<button class="btn ${opt.side ? "primary" : ""}" id="pr-side">Con banquillo</button>` : ""}</div>
        <div class="grid pr-grid">${list.map((c) => `<div class="gcard ${c.n ? "" : "missing"}"><img loading="lazy" src="${esc(arts[c.name] || c.image)}" alt="${esc(c.name)}" data-art="${esc(c.name)}">
          ${arts[c.name] ? `<span class="badge full">${ico("image")}</span>` : ""}
          <div class="mini-step"><button data-pn="${esc(c.name)}" data-s="${c.side ? 1 : 0}" data-d="-1" ${c.n ? "" : "disabled"} aria-label="Una menos">−</button><b>${c.n}</b><button data-pn="${esc(c.name)}" data-s="${c.side ? 1 : 0}" data-d="1" aria-label="Una más">+</button></div></div>`).join("")}</div>
        <button class="btn block primary" id="pr-go" ${total ? "" : "disabled"} style="margin-top:12px">${ico("file")}Generar PDF (${total} cartas, ${Math.ceil(total / 9)} hojas ${esc(pname)})</button>
        <div class="hint">Al imprimir, elige «Tamaño real» o «100 %» (no «Ajustar a la página»), o las cartas saldrán más pequeñas.</div>`);
      body.querySelectorAll("[data-o]").forEach((s) => s.querySelectorAll("button").forEach((b) => (b.onclick = () => {
        const k = s.dataset.o;
        opt[k] = k === "bleed" ? +b.dataset.v : b.dataset.v;
        store({ paper: "printPaper", bleed: "printBleed", lines: "printLines" }[k], String(opt[k]));
        draw();
      })));
      $("#pr-missing", body).onclick = () => { opt.missing = !opt.missing; for (const c of cards) c.n = c.basic ? 0 : opt.missing ? Math.max(0, c.qty - c.have) : c.qty; draw(); };
      $("#pr-side", body)?.addEventListener("click", () => { opt.side = !opt.side; for (const c of cards) if (c.side) c.n = opt.side ? c.qty : 0; draw(); });
      body.querySelectorAll("[data-pn]").forEach((b) => (b.onclick = () => {
        const c = cards.find((x) => x.name === b.dataset.pn && x.side === (b.dataset.s === "1"));
        c.n = Math.max(0, c.n + +b.dataset.d); draw();
      }));
      body.querySelectorAll("[data-art]").forEach((im) => (im.onclick = () => artSheet(im.dataset.art, draw)));
      $("#pr-go", body).onclick = () => makePdf(d.archetype, list.flatMap((c) => Array(c.n).fill(arts[c.name] || c.image)), opt);
    };
    draw();
  }

  // Elegir el arte: todas las ediciones de la carta, o una imagen tuya (se recomienda 63 × 88 mm a 300 ppp: 745 × 1040 px)
  async function artSheet(name, back) {
    const body = openSheet(`<h3>Arte de ${esc(name)}</h3><div class="hint">Toca la edición que quieras imprimir, o sube tu propia imagen de la carta entera (mejor de 745 × 1040 px).</div>
      <label class="btn block" for="pr-up">${ico("image")}Subir mi imagen</label><input type="file" id="pr-up" accept="image/*" hidden>
      ${arts[name] ? `<button class="btn block" id="pr-reset" style="margin-top:8px">Volver al arte normal</button>` : ""}
      <div class="arts pr-arts" id="pr-arts">${skeleton(2)}</div>`);
    $("#pr-reset", body)?.addEventListener("click", () => { delete arts[name]; saveArts(); back(); });
    $("#pr-up", body).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const im = await loadImg(URL.createObjectURL(f)), s = Math.min(1, 1040 / im.height), c = document.createElement("canvas");
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      arts[name] = c.toDataURL("image/jpeg", 0.92); saveArts(); toast("Imagen puesta"); back();
    };
    const ps = (await api(`/api/printings?name=${encodeURIComponent(name)}`)).filter((p) => p.image);
    $("#pr-arts", body).innerHTML = ps.map((p) => `<button class="art ${arts[name] === p.image ? "on" : ""}" data-img="${esc(p.image)}"><img loading="lazy" src="${esc(p.image)}" alt=""><span>${esc(p.set.toUpperCase())} #${esc(p.number)}</span></button>`).join("")
      || `<div class="hint">No hay imágenes de esta carta.</div>`;
    body.querySelectorAll("[data-img]").forEach((b) => (b.onclick = () => { arts[name] = b.dataset.img; saveArts(); back(); }));
  }

  const loadImg = (src) => new Promise((ok, ko) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => ok(im);
    im.onerror = () => ko(new Error("No se ha podido bajar una imagen (¿sin internet?)"));
    im.src = src;
  });

  /** Una carta a 300 ppp con su sangrado: los bordes de la imagen se estiran hacia fuera (sin bordes blancos). */
  async function cardJpeg(src, bleed) {
    const im = await loadImg(hiRes(src)).catch(() => loadImg(src));
    const W = Math.round(CW * DPI_MM), H = Math.round(CH * DPI_MM), B = Math.round(bleed * DPI_MM), c = document.createElement("canvas");
    c.width = W + 2 * B; c.height = H + 2 * B;
    const g = c.getContext("2d"), sx = im.width / W, sy = im.height / H, r = Math.round(W * 0.06);  // r: esquinas redondeadas, no se estiran
    g.drawImage(im, 0, Math.round(im.height / 2), 1, 1, 0, 0, 1, 1);
    const [R, G, Bl] = g.getImageData(0, 0, 1, 1).data;  // color del borde (negro casi siempre)
    g.fillStyle = `rgb(${R},${G},${Bl})`; g.fillRect(0, 0, c.width, c.height);
    if (B) {
      g.drawImage(im, 0, r * sy, 1, (H - 2 * r) * sy, 0, B + r, B, H - 2 * r);
      g.drawImage(im, im.width - 1, r * sy, 1, (H - 2 * r) * sy, B + W, B + r, B, H - 2 * r);
      g.drawImage(im, r * sx, 0, (W - 2 * r) * sx, 1, B + r, 0, W - 2 * r, B);
      g.drawImage(im, r * sx, im.height - 1, (W - 2 * r) * sx, 1, B + r, B + H, W - 2 * r, B);
    }
    g.drawImage(im, B, B, W, H);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92));
    return { w: c.width, h: c.height, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }

  async function makePdf(title, srcs, opt) {
    const [PW, PH] = PAPERS[opt.paper], b = opt.bleed, cw = CW + 2 * b, ch = CH + 2 * b, x0 = (PW - 3 * cw) / 2, y0 = (PH - 3 * ch) / 2;
    const uniq = [...new Set(srcs)], images = [];
    try {
      for (const [i, s] of uniq.entries()) { toast(`Preparando las imágenes: ${i + 1} de ${uniq.length}`); images.push(await cardJpeg(s, b)); }
    } catch (e) { return toast(e.message); }
    const f = (n) => (n * PT).toFixed(2), pages = [];
    for (let p = 0; p < srcs.length; p += 9) {
      const chunk = srcs.slice(p, p + 9), rows = Math.ceil(chunk.length / 3);
      let s = "";
      chunk.forEach((src, k) => {
        const x = x0 + (k % 3) * cw, y = y0 + Math.floor(k / 3) * ch;
        s += `q ${f(cw)} 0 0 ${f(ch)} ${f(x)} ${f(PH - y - ch)} cm /Im${uniq.indexOf(src)} Do Q\n`;
      });
      // Líneas de corte: en cada borde de carta, de lado a lado de la hoja o solo en los márgenes
      const cols = Math.min(3, chunk.length), xs = [], ys = [];
      for (let c = 0; c < cols; c++) xs.push(x0 + c * cw + b, x0 + c * cw + b + CW);
      for (let r = 0; r < rows; r++) ys.push(y0 + r * ch + b, y0 + r * ch + b + CH);
      const gx0 = x0, gx1 = x0 + cols * cw, gy0 = y0, gy1 = y0 + rows * ch, seg = (ax, ay, bx, by) => `${f(ax)} ${f(PH - ay)} m ${f(bx)} ${f(PH - by)} l S\n`;
      s += `0 0 0 RG ${f(LINE)} w\n`;
      for (const x of [...new Set(xs.map((v) => v.toFixed(3)))].map(Number)) s += opt.lines === "full" ? seg(x, 0, x, PH) : seg(x, 0, x, gy0 - 1) + seg(x, gy1 + 1, x, PH);
      for (const y of [...new Set(ys.map((v) => v.toFixed(3)))].map(Number)) s += opt.lines === "full" ? seg(0, y, PW, y) : seg(0, y, gx0 - 1, y) + seg(gx1 + 1, y, PW, y);
      pages.push({ content: s, used: [...new Set(chunk.map((src) => uniq.indexOf(src)))] });
    }
    const name = `${String(title || "mazo").replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "mazo"} - proxies.pdf`;
    await saveFile(name, buildPdf(PW * PT, PH * PT, images, pages), "application/pdf");
    toast(`PDF listo: ${srcs.length} cartas en ${pages.length} hojas`);
  }

  /** PDF 1.4 mínimo: catálogo, páginas, imágenes JPEG (DCTDecode) y el dibujo de cada página. */
  function buildPdf(pw, ph, images, pages) {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const push = (x) => { const u = typeof x === "string" ? enc.encode(x) : x; parts.push(u); len += u.length; };
    const obj = (n, fill) => { offs[n] = len; push(`${n} 0 obj\n`); fill(); push("\nendobj\n"); };
    const imgId = (i) => 3 + i, pageId = (p) => 3 + images.length + 2 * p, n = 3 + images.length + 2 * pages.length;
    push("%PDF-1.4\n");
    obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
    obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, p) => `${pageId(p)} 0 R`).join(" ")}] >>`));
    images.forEach((im, i) => obj(imgId(i), () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
      push(im.bytes); push("\nendstream");
    }));
    pages.forEach((pg, p) => {
      obj(pageId(p), () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << ${pg.used.map((i) => `/Im${i} ${imgId(i)} 0 R`).join(" ")} >> >> /Contents ${pageId(p) + 1} 0 R >>`));
      const c = enc.encode(pg.content);
      obj(pageId(p) + 1, () => { push(`<< /Length ${c.length} >>\nstream\n`); push(c); push("\nendstream"); });
    });
    const xref = len;
    push(`xref\n0 ${n}\n0000000000 65535 f \n${offs.slice(1, n).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let at = 0;
    for (const u of parts) { out.set(u, at); at += u.length; }
    return out;
  }

  return { printSheet, buildPdf };
})();
