const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const jpeg = require("jpeg-js");
const { createCanvas } = require("@napi-rs/canvas");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const TEMPLATE_PATH = path.resolve(__dirname, "../../assets/clearance-form-template.pdf");
const UPLOAD_ROOT = path.resolve(__dirname, "../../uploads");

// pdfjs-dist ships ESM-only (no CommonJS build) as of v6 -- loaded via a
// cached dynamic import so every call site can just `await` this instead of
// re-importing. Only needed for PDF evidence (see rasterizePdfPage below).
let pdfjsLibPromise = null;
function getPdfjsLib() {
  if (!pdfjsLibPromise) pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsLibPromise;
}

// Without this, pdfjs falls back to generic glyph metrics for the 14
// standard PDF fonts (Helvetica, etc.) whenever a PDF references one by name
// instead of embedding it -- common for text-based signature exports (e.g.
// a typed name from an e-signature tool) -- and letters render with visibly
// wrong spacing/kerning. Ships inside the package itself, no extra download.
const STANDARD_FONT_DATA_URL = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;

// A signature uploaded as a PDF (a scanned/exported signature page, not a
// photo) -- this is actually the common case in practice, more so than a
// phone photo. Rasterizes the first page to RGBA pixels so it can go through
// exactly the same white-background-stripping treatment as a photo (see
// stripNearWhiteBackground below) instead of embedding it as an opaque
// vector block -- a scanned page's background isn't always perfectly pure
// white, and treating every evidence type the same way is simpler than
// maintaining two different compositing paths. Scale 3 (~216 "dpi"
// equivalent, since PDF units are 72/inch) keeps ink crisp after the
// eventual scale-down into the small signature cell without rendering at
// print resolution for something that ends up a couple centimeters tall.
const PDF_RASTER_SCALE = 3;

async function rasterizePdfPage(bytes) {
  const pdfjsLib = await getPdfjsLib();
  // .destroy() lives on the loading task, not the PDFDocumentProxy .promise
  // resolves to -- keep the task itself so it can be cleaned up below.
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: PDF_RASTER_SCALE });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // pdfjs paints the page's own white background as part of rendering (a
    // PDF page has no inherent background otherwise), so the result comes out
    // already opaque white behind the ink -- same starting point as a decoded
    // photo, which is what lets this feed straight into
    // stripNearWhiteBackground below.
    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data } = ctx.getImageData(0, 0, width, height);
    return { width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
  } finally {
    // Without this, each rasterized PDF's decoded fonts/streams stay
    // resident for the life of the process -- generateClearancePdf can call
    // this once per signed department per request, so a long-running server
    // handling many PDF downloads would otherwise grow unbounded.
    await loadingTask.destroy();
  }
}

/**
 * Hand-calibrated against backend/assets/clearance-form-template.pdf (the
 * "إخلاء طرف" paper form, single page, A4 595.32x841.92pt -- this is a native
 * Word-exported PDF, not a scan, so the grid lines are real vector strokes
 * rather than pixels to eyeball). Row keys match
 * `ClearanceRequest.departments[].order` (1-13, same as the paper's row
 * numbers top-to-bottom). Derived from the table's outer top edge (row 1's
 * top, 526.2pt) and a single row height (26.465pt) rather than 13
 * independently-measured row boundaries -- same reasoning as before
 * (see git history for the previous scanned template): one deliberately
 * shorter row (#7, "تنمية الموارد البشرية", ~23.5pt instead of ~26.5pt in
 * the source document) would otherwise throw off a per-row lookup, and a
 * uniform height keeps every row close rather than compounding drift.
 * Re-derive both numbers if a different template ever replaces this one:
 * render at high DPI (`pdftoppm -r 300 -png`), binarize, and find rows/
 * columns whose pixels are dark across most of the table width/height
 * (grid lines are solid across a whole row/column; text is not) -- then
 * convert the topmost row-divider's pixel position to PDF points (pt =
 * px * 72 / dpi) and subtract from the page height, since pdf-lib draws
 * bottom-up while image rows count top-down.
 */
const TABLE_TOP = 526.2;
const ROW_HEIGHT = 26.465;
const ROWS = {};
for (let i = 1; i <= 13; i++) {
  const yTop = TABLE_TOP - (i - 1) * ROW_HEIGHT;
  ROWS[i] = { yTop, yBottom: yTop - ROW_HEIGHT };
}

// Only the name and signature columns are used -- the reviewer who signed
// off goes in the left ("الاسم") column on every signed row (this is a
// signer's-name column on the real paper form, not a repeat of whose
// clearance it is), the evidence photo goes in the middle ("التوقيع")
// column, and the right ("البيان") column is deliberately left blank.
const COLUMNS = {
  name: { x: 90.24, width: 186.6 - 90.24 },
  signature: { x: 186.6, width: 283.56 - 186.6 },
};

const CELL_PADDING = 6;
const IMAGE_PADDING = 2;

const WHITE = 235; // pixels this light or lighter count as "background", not ink
const INK = 180; // pixels this dark or darker stay fully opaque when stripping the background

// The paper form's signer-name cell is intentionally narrow. Keep the full
// account name on the request for audit purposes, but render only its first
// two whitespace-separated parts in the PDF so the name remains readable.
function signerNameForPdf(fullName) {
  if (!fullName) return null;
  return String(fullName).trim().split(/\s+/u).slice(0, 2).join(" ");
}

// Trims the RGBA buffer down to the bounding box of non-near-white content,
// plus a small margin. Evidence that's a whole scanned/exported page --
// common for a PDF upload, where the actual ink might occupy only a small
// portion of an A4 sheet -- would otherwise scale down to an illegible
// sliver just because the page's own empty margin has to shrink along with
// it to fit the signature cell. Uses the same WHITE threshold as
// stripNearWhiteBackground below so "what counts as content" is consistent
// between the two. Falls back to the untrimmed image if nothing dark enough
// is found (a blank or corrupt page) rather than producing a zero-size crop.
function cropToContent({ width, height, data }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < WHITE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { width, height, data };

  const margin = Math.max(3, Math.round(Math.max(width, height) * 0.015));
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(width - 1, maxX + margin);
  maxY = Math.min(height - 1, maxY + margin);

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const cropped = Buffer.alloc(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    const srcStart = ((minY + y) * width + minX) * 4;
    data.copy(cropped, y * cropWidth * 4, srcStart, srcStart + cropWidth * 4);
  }
  return { width: cropWidth, height: cropHeight, data: cropped };
}

// A real evidence photo is a signature photographed/scanned on plain paper --
// it has a white/off-white background, not transparency, so embedding it
// as-is would stamp an opaque rectangle over the printed form instead of
// looking like an actual signature on the page. This decodes to raw RGBA,
// makes near-white pixels transparent (with a soft-edged band around the
// threshold so ink strokes don't get a hard jagged cutout), and re-encodes
// as PNG so pdf-lib can embed it with transparency regardless of the
// original upload format.
function stripNearWhiteBackground({ width, height, data }) {
  for (let i = 0; i < data.length; i += 4) {
    const minChannel = Math.min(data[i], data[i + 1], data[i + 2]);
    let alpha;
    if (minChannel >= WHITE) alpha = 0;
    else if (minChannel <= INK) alpha = 255;
    else alpha = Math.round((255 * (WHITE - minChannel)) / (WHITE - INK));
    data[i + 3] = Math.min(data[i + 3], alpha);
  }
  const png = new PNG({ width, height });
  data.copy(png.data);
  return PNG.sync.write(png);
}

// Decodes whatever evidence format was uploaded to raw RGBA pixels so it can
// all go through the same stripNearWhiteBackground -> embedPng pipeline
// below, regardless of source format. Only jpg/png/pdf are accepted on
// upload (see the multer fileFilter in request.routes.js), so those are the
// only formats this needs to handle.
async function decodeEvidenceToRgba(bytes, mimeType) {
  if (/^application\/pdf$/i.test(mimeType)) return rasterizePdfPage(bytes);
  if (/png/i.test(mimeType)) {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: png.data };
  }
  const decoded = jpeg.decode(bytes, { useTArray: true });
  return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
}

// Scales an embedded pdf-lib PDFImage to fit inside the signature cell,
// aspect-ratio preserved and centered, then draws it. No upscale cap -- fill
// as much of the cell as the aspect ratio allows. Evidence is typically much
// higher-resolution than the cell needs anyway (phone camera photo, or a
// rasterized PDF page, vs. an ~26pt-tall box), but small synthetic test
// images should still grow to fill the space rather than sit tiny in a
// corner.
function drawScaledIntoSignatureCell(page, image, row) {
  const cell = COLUMNS.signature;
  const maxWidth = cell.width - IMAGE_PADDING * 2;
  const maxHeight = row.yTop - row.yBottom - IMAGE_PADDING * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  page.drawImage(image, {
    x: cell.x + (cell.width - width) / 2,
    y: row.yBottom + (row.yTop - row.yBottom - height) / 2,
    width,
    height,
  });
}

async function drawEvidenceImage(pdfDoc, page, evidence, row) {
  const absolutePath = path.join(UPLOAD_ROOT, evidence.fileUrl);
  if (!fs.existsSync(absolutePath)) return;

  if (!/^(image\/(jpe?g|png)|application\/pdf)$/i.test(evidence.mimeType)) return;

  const bytes = fs.readFileSync(absolutePath);
  let image;
  try {
    const rgba = await decodeEvidenceToRgba(bytes, evidence.mimeType);
    const transparentPng = stripNearWhiteBackground(cropToContent(rgba));
    image = await pdfDoc.embedPng(transparentPng);
  } catch (err) {
    // A corrupt/truncated/password-protected upload shouldn't take down PDF
    // generation for the whole request -- just skip embedding this row.
    console.error(`[clearancePdf] failed to embed evidence at ${absolutePath}:`, err.message);
    return;
  }

  drawScaledIntoSignatureCell(page, image, row);
}

// Keep signer names visually consistent instead of making short names huge
// and long names tiny. Prefer two balanced lines when the full name does not
// fit, then shrink only as a last resort. Every baseline is calculated from
// the cell height, so neither line can cross a table border.
function drawCellText(page, font, text, column, row, { size = 11 } = {}) {
  if (!text) return;
  const maxWidth = column.width - CELL_PADDING * 2;
  const maxHeight = row.yTop - row.yBottom - CELL_PADDING;
  const words = text.trim().split(/\s+/u);
  let lines = [text];

  if (font.widthOfTextAtSize(text, size) > maxWidth && words.length > 1) {
    let bestSplit = 1;
    let bestWidth = Infinity;
    for (let i = 1; i < words.length; i++) {
      const firstWidth = font.widthOfTextAtSize(words.slice(0, i).join(" "), size);
      const secondWidth = font.widthOfTextAtSize(words.slice(i).join(" "), size);
      const widestLine = Math.max(firstWidth, secondWidth);
      if (widestLine < bestWidth) {
        bestWidth = widestLine;
        bestSplit = i;
      }
    }
    lines = [words.slice(0, bestSplit).join(" "), words.slice(bestSplit).join(" ")];
  }

  let fitSize = size;
  const lineHeightRatio = 1.08;
  while (
    fitSize > 7 &&
    (lines.some((line) => font.widthOfTextAtSize(line, fitSize) > maxWidth) ||
      lines.length * fitSize * lineHeightRatio > maxHeight)
  ) {
    fitSize -= 0.5;
  }

  const lineHeight = fitSize * lineHeightRatio;
  const blockHeight = lines.length * lineHeight;
  const firstBaseline = row.yBottom + (row.yTop - row.yBottom + blockHeight) / 2 - fitSize;

  lines.forEach((line, index) => {
    const lineWidth = font.widthOfTextAtSize(line, fitSize);
    page.drawText(line, {
      x: column.x + (column.width - lineWidth) / 2,
      y: firstBaseline - index * lineHeight,
      size: fitSize,
      font,
      color: rgb(0.12, 0.18, 0.16),
    });
  });
}

/**
 * Composites whatever signature evidence a request has collected so far
 * onto the master paper-form template. Safe to call on a partially-signed
 * request (unsigned rows are simply left blank) -- the same function
 * produces the final version once every department is complete.
 */
async function generateClearancePdf(request) {
  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const dept of request.departments) {
    const row = ROWS[dept.order];
    if (!row) continue;

    let evidence = null;
    let signerName = null;
    if (dept.signatureMode === "single") {
      if (dept.status !== "completed") continue;
      // Evidence can be missing on an otherwise-completed department (e.g.
      // an older seeded request marked "completed" without attaching a real
      // upload) -- still show the row as signed, just skip the image itself
      // rather than dropping the whole row.
      evidence = dept.evidence;
      signerName = dept.signedByFullName;
    } else {
      // Itemized (IT): only composite once every item is signed, using the
      // most recent signature as the row's representative evidence -- the
      // row-per-department paper form only has room for one image, so this
      // is the closest analog to "IT signed off."
      const allSigned = dept.items.length > 0 && dept.items.every((i) => i.status === "completed");
      if (!allSigned) continue;
      const latest = [...dept.items].sort((a, b) => new Date(b.signedAt) - new Date(a.signedAt))[0];
      evidence = latest?.evidence;
      signerName = latest?.signedByFullName;
    }

    if (evidence) await drawEvidenceImage(pdfDoc, page, evidence, row);
    // Left column identifies who signed off, not whose clearance this is --
    // the paper's own top-of-form employee fields aren't filled in by this
    // generator, but the "الاسم" column next to each department's row is a
    // signer-name column on the real form.
    drawCellText(page, font, signerNameForPdf(signerName), COLUMNS.name, row);
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateClearancePdf, signerNameForPdf };
