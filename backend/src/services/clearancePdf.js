const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const jpeg = require("jpeg-js");
const { createCanvas } = require("@napi-rs/canvas");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const TEMPLATE_PATH = path.resolve(__dirname, "../../assets/clearance-form-template.pdf");
// Standard PDF fonts (Helvetica, used for the "الاسم" column below) have no
// Arabic glyphs at all -- this is a real TTF (decompressed once from
// frontend/public/fonts/cairo-var-arabic.woff2 via the `wawoff2` package,
// since pdf-lib/fontkit failed to parse the woff2 container directly, even
// though fontkit can read it fine for other purposes -- see git history if
// that font is ever replaced) purely so the fixed "خالي الطرف" text below has
// a font that can render it. fontkit (registered below) shapes Arabic
// contextual letterforms automatically when drawing through a custom
// embedded font like this one -- pdf-lib's standard-font path doesn't do
// that, but this path does.
const ARABIC_FONT_PATH = path.resolve(__dirname, "../../assets/cairo-arabic.ttf");
// cairo-arabic.ttf was subset down to exactly what the fixed "خالي الطرف"
// stamp needed -- Arabic letters, Arabic-Indic digits, a space -- and
// nothing else: no Western digits, no Latin letters, no ASCII punctuation
// (not even a period or comma). That's too narrow for the free-text
// department notes below (see drawNotesBox), which can contain any of
// those. This is the sibling Latin subset from the same font family
// (decompressed the same way, from frontend/public/fonts/cairo-var-latin.woff2)
// -- drawNotesBox splits note text into runs and picks whichever of the two
// fonts actually covers each run (see splitIntoFontRuns).
const LATIN_FONT_PATH = path.resolve(__dirname, "../../assets/cairo-latin.ttf");
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

// The reviewer who signed off goes in the left ("الاسم") column on every
// signed row (this is a signer's-name column on the real paper form, not a
// repeat of whose clearance it is), the evidence photo goes in the middle
// ("التوقيع") column, and the right ("البيان") column gets a fixed "خالي
// الطرف" stamp (2026-08-11) so the row reads as a complete, filled-out
// clearance line rather than leaving that cell blank next to a signature.
// statement.x/width derived the same way as the other two -- see the
// coordinate-derivation comment above (render at 300 DPI, find the vertical
// grid lines flanking it).
const COLUMNS = {
  name: { x: 90.24, width: 186.6 - 90.24 },
  signature: { x: 186.6, width: 283.56 - 186.6 },
  statement: { x: 283.56, width: 351.24 - 283.56 },
};

const STATEMENT_TEXT = "خالي الطرف";

/**
 * Wages/Finance's optional per-department remark (see requestDepartmentSchema
 * `notes`) renders in the blank strip below the table, between the
 * pre-printed "يعتمد," line and the pre-printed name near the page's bottom
 * corner -- both fixed parts of the template itself, not something this file
 * draws. Derived the same way as ROWS/COLUMNS above (render at 300 DPI, find
 * text bounding boxes): "يعتمد," bottoms out around y=152pt and the bottom
 * name starts around y=45pt, leaving roughly a 100pt-tall strip. Keyed by
 * `order` rather than department key, same reasoning as ROWS -- this is a
 * position on the paper form, not a fact about which department it is; it
 * only happens to have entries for 12/13 today because those are the only
 * two hasOversightDashboard departments in the current form.
 *
 * The box is right-anchored (NOTES_BOX_RIGHT_X, matching the table's own
 * right border) and grows LEFTWARD as a note gets longer -- see
 * chooseNotesLayout below -- rather than shrinking its font size right away:
 * NOTES_BOX_DEFAULT_WIDTH matches the table's rightmost two columns (today's
 * fixed size, for a short note), and it can widen up to NOTES_BOX_MAX_WIDTH,
 * which reaches COLUMNS.name.x -- the table's own left inner edge -- so an
 * expanded box still reads as sitting "under" the table, never past it into
 * the page's own margin.
 */
const NOTES_BOX_RIGHT_X = 538.56;
const NOTES_BOX_DEFAULT_WIDTH = 538.56 - 283.56;
const NOTES_BOX_MAX_WIDTH = 538.56 - COLUMNS.name.x;
const NOTES_BOX_BY_ORDER = {
  12: { yTop: 147, yBottom: 102 },
  13: { yTop: 94, yBottom: 49 },
};
const NOTES_BOX_PADDING = 5;
const NOTES_LABEL_SIZE = 7.5;
const NOTES_TEXT_MAX_SIZE = 8;
const NOTES_TEXT_MIN_SIZE = 6;
const NOTES_LINE_HEIGHT_RATIO = 1.2;
// How coarsely chooseNotesLayout searches for a fitting width -- small
// enough that the box doesn't visibly jump in size, large enough that the
// search stays cheap for a ≤NOTES_MAX_LENGTH-character note.
const NOTES_BOX_WIDTH_STEP = 8;

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

// Cheap, synchronous, and independent of any particular PDFDocument (unlike
// pdf-lib's own embedFont, which is async and per-document) -- just a glyph
// coverage lookup, so it's built once per process rather than once per PDF.
let notesFontCoverage = null;
function getNotesFontCoverage() {
  if (!notesFontCoverage) {
    notesFontCoverage = {
      arabic: fontkit.create(fs.readFileSync(ARABIC_FONT_PATH)),
      latin: fontkit.create(fs.readFileSync(LATIN_FONT_PATH)),
    };
  }
  return notesFontCoverage;
}

function fontFor(name, arabicFont, latinFont) {
  return name === "latin" ? latinFont : arabicFont;
}

// Splits one whitespace-free token into runs of consecutive characters
// coverable by the same one of the two embedded fonts -- e.g. a note like
// "بقيمة 1500 جنيه" needs the Arabic font for the words and the Latin subset
// font for "1500" (see the LATIN_FONT_PATH comment above for why). Runs stay
// in their original typed order; drawNotesBox below draws each word's runs
// left-to-right within the word but places words themselves right-to-left,
// which reproduces correct bidi placement for the common case (Arabic text
// with embedded numbers/Latin words) without needing a full bidi
// implementation. A character neither font covers (rare -- e.g. an emoji)
// falls back to the Arabic font, same as if this splitting didn't exist.
function splitIntoFontRuns(token, coverage) {
  const runs = [];
  let current = "";
  let currentFont = null;
  for (const ch of token) {
    const codePoint = ch.codePointAt(0);
    let font;
    // Latin checked first, deliberately: cairo-arabic.ttf's subsetting left
    // in a handful of stray Latin-range glyphs it never needed for its one
    // original use ("خالي الطرف") -- 'A'/'Á'/'Ă'/NBSP among them -- so
    // checking Arabic coverage first would misroute an ordinary English word
    // starting with "A" (e.g. "Approved") onto the Arabic font for its first
    // character alone, splitting it into two runs and, worse, making
    // groupWordsIntoBlocks below treat the whole word as Arabic-primary and
    // reorder it along with actual Arabic words.
    if (codePoint === 0x20) font = currentFont;
    else if (coverage.latin.hasGlyphForCodePoint(codePoint)) font = "latin";
    else if (coverage.arabic.hasGlyphForCodePoint(codePoint)) font = "arabic";
    else font = currentFont || "arabic";

    if (currentFont === null) currentFont = font;
    if (font !== currentFont) {
      runs.push({ text: current, font: currentFont });
      current = "";
      currentFont = font;
    }
    current += ch;
  }
  if (current) runs.push({ text: current, font: currentFont || "arabic" });
  return runs;
}

function measureRuns(runs, size, arabicFont, latinFont) {
  return runs.reduce((sum, run) => sum + fontFor(run.font, arabicFont, latinFont).widthOfTextAtSize(run.text, size), 0);
}

// A single whitespace-free token (already split into per-font runs) normally
// becomes one "word" -- but a token with no whitespace to break on (a long
// reference number, a phone number typed without spaces, a URL) can still be
// wider than the box on its own, and wrapNotesText's word-boundary-only
// wrapping has nowhere to break it. As a last resort, force-split it
// character by character wherever it stops fitting `maxWidth`, so it's
// clipped to as many lines as it needs instead of being drawn straight
// through the box's border. Every chunk after the first is marked
// `glued: true` -- they're fragments of one token, not separate words, so
// nothing (wrapNotesText's line-width accounting, groupWordsIntoBlocks,
// drawNotesBox) should ever put a space before them.
function chunkWord(runs, maxWidth, size, arabicFont, latinFont) {
  const width = measureRuns(runs, size, arabicFont, latinFont);
  if (width <= maxWidth) return [{ runs, width, glued: false }];

  const chunks = [];
  let currentRuns = [];
  let currentWidth = 0;
  function flush() {
    if (currentRuns.length === 0) return;
    chunks.push({ runs: currentRuns, width: currentWidth, glued: chunks.length > 0 });
    currentRuns = [];
    currentWidth = 0;
  }
  for (const run of runs) {
    const font = fontFor(run.font, arabicFont, latinFont);
    for (const ch of run.text) {
      const chWidth = font.widthOfTextAtSize(ch, size);
      if (currentRuns.length > 0 && currentWidth + chWidth > maxWidth) flush();
      const lastRun = currentRuns[currentRuns.length - 1];
      if (lastRun && lastRun.font === run.font) lastRun.text += ch;
      else currentRuns.push({ text: ch, font: run.font });
      currentWidth += chWidth;
    }
  }
  flush();
  return chunks;
}

// Greedy word-wrap (whitespace only, no mid-word breaks under normal
// circumstances -- same approach as drawCellText above), except each "word"
// is measured as a sequence of per-font runs (see splitIntoFontRuns) rather
// than a single string in one font, and a token too wide to ever fit on its
// own gets force-split by chunkWord above.
function wrapNotesText(text, size, maxWidth, arabicFont, latinFont, coverage) {
  const words = text
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap((token) => chunkWord(splitIntoFontRuns(token, coverage), maxWidth, size, arabicFont, latinFont));
  const spaceWidth = arabicFont.widthOfTextAtSize(" ", size);

  const lines = [];
  let current = [];
  let currentWidth = 0;
  for (const word of words) {
    const gap = word.glued ? 0 : spaceWidth;
    const candidateWidth = current.length ? currentWidth + gap + word.width : word.width;
    if (current.length && candidateWidth > maxWidth) {
      lines.push(current);
      current = [word];
      currentWidth = word.width;
    } else {
      current.push(word);
      currentWidth = candidateWidth;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

// Unlike drawCellText's fixed short strings (a signer's first two name parts,
// or the constant "خالي الطرف"), a note is free text of unpredictable length
// -- this wraps to as many lines as it takes, shrinking the font until it
// fits within `maxHeight`, and only truncates (with an ellipsis) if it's
// still too long at the smallest readable size. NOTES_MAX_LENGTH in
// request.routes.js keeps this from being reached in practice; chunkWord
// above keeps a single unbroken token from overflowing `maxWidth` even so.
function fitNotesText(text, maxWidth, maxHeight, arabicFont, latinFont) {
  const coverage = getNotesFontCoverage();
  let size = NOTES_TEXT_MAX_SIZE;
  let lines = wrapNotesText(text, size, maxWidth, arabicFont, latinFont, coverage);
  while (size > NOTES_TEXT_MIN_SIZE && lines.length * size * NOTES_LINE_HEIGHT_RATIO > maxHeight) {
    size -= 0.5;
    lines = wrapNotesText(text, size, maxWidth, arabicFont, latinFont, coverage);
  }

  const lineHeight = size * NOTES_LINE_HEIGHT_RATIO;
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    // Ellipsis replaces the last run's trailing character (rather than being
    // appended as its own token) so it stays part of the last word instead
    // of becoming an orphaned always-Arabic-font run.
    const lastWord = lines[maxLines - 1].at(-1);
    const lastRun = lastWord.runs.at(-1);
    lastRun.text = lastRun.text.length > 1 ? `${lastRun.text.slice(0, -1)}…` : "…";
  }
  return { lines, size, lineHeight };
}

// Picks how wide the notes box should render, given its content: tries
// NOTES_BOX_DEFAULT_WIDTH first at the preferred font size, then widens
// leftward in NOTES_BOX_WIDTH_STEP increments (the box is right-anchored, so
// "wider" only ever moves its left edge) looking for the narrowest width
// that still fits the note at that size, up to NOTES_BOX_MAX_WIDTH. Only
// once even the max width isn't enough does fitNotesText's own font-shrink
// (and, as an ultimate fallback, truncation) take over -- growing the box
// keeps a longer note readable for far longer than shrinking its font would.
function chooseNotesLayout(text, maxHeight, arabicFont, latinFont) {
  const coverage = getNotesFontCoverage();
  const maxLinesAtPreferredSize = Math.max(1, Math.floor(maxHeight / (NOTES_TEXT_MAX_SIZE * NOTES_LINE_HEIGHT_RATIO)));
  const innerPadding = NOTES_BOX_PADDING * 2;

  function fitsAtPreferredSize(width) {
    const lines = wrapNotesText(text, NOTES_TEXT_MAX_SIZE, width - innerPadding, arabicFont, latinFont, coverage);
    return lines.length <= maxLinesAtPreferredSize;
  }

  let width = NOTES_BOX_DEFAULT_WIDTH;
  while (width < NOTES_BOX_MAX_WIDTH && !fitsAtPreferredSize(width)) {
    width = Math.min(NOTES_BOX_MAX_WIDTH, width + NOTES_BOX_WIDTH_STEP);
  }

  const fitted = fitNotesText(text, width - innerPadding, maxHeight, arabicFont, latinFont);
  return { width, ...fitted };
}

// A lone word placed by which of its own runs happens to come first --
// good enough to tell "بقيمة" from "1500" from "Approved". Used only to
// group adjacent words for groupWordsIntoBlocks below.
function primaryFont(word) {
  return word.runs[0] ? word.runs[0].font : "arabic";
}

// Groups a wrapped line's words into maximal runs of matching primaryFont --
// e.g. "تمت المراجعة - Approved by Finance on 2026-08-11" (Arabic words, an
// English sentence, and a date) becomes an Arabic block and one Latin block,
// not six independently-reversed words. Needed because a line is drawn
// right-to-left block by block (first-typed block rightmost, matching how
// Arabic text and a lone embedded number already read), but an entire
// multi-word LATIN block must keep its OWN words in normal left-to-right
// order internally -- without this grouping, "Approved by Finance" would
// draw as "Finance by Approved" (each word individually treated as an
// RTL-ordered unit, which is only correct for Arabic words). A `glued` word
// (a chunkWord fragment) always joins the previous block regardless of font,
// since it's part of the same unbroken token, not a new word.
function groupWordsIntoBlocks(line, spaceWidth) {
  const blocks = [];
  for (const word of line) {
    const font = primaryFont(word);
    const last = blocks[blocks.length - 1];
    if (last && (last.font === font || word.glued)) {
      last.words.push(word);
      last.width += (word.glued ? 0 : spaceWidth) + word.width;
    } else {
      blocks.push({ font, words: [word], width: word.width });
    }
  }
  return blocks;
}

// Draws one bordered notes box -- a small right-aligned department label
// above the wrapped note text. Only called for a department that actually
// has a note (see the empty-notes skip in generateClearancePdf) -- "no
// notes" means this never runs at all, not an empty box. Width is chosen by
// chooseNotesLayout (grows leftward from box.rightX for a longer note); only
// the vertical extent is fixed, from NOTES_BOX_BY_ORDER.
function drawNotesBox(page, arabicFont, latinFont, box, label, notes) {
  const { yTop, yBottom } = box;
  const color = rgb(0.12, 0.18, 0.16);
  const labelWidth = arabicFont.widthOfTextAtSize(label, NOTES_LABEL_SIZE);
  const labelY = yTop - NOTES_BOX_PADDING - NOTES_LABEL_SIZE;
  const textTop = labelY - 3;
  const textMaxHeight = textTop - yBottom - NOTES_BOX_PADDING;

  const { width, lines, size, lineHeight } = chooseNotesLayout(notes, textMaxHeight, arabicFont, latinFont);
  const x = NOTES_BOX_RIGHT_X - width;

  page.drawRectangle({ x, y: yBottom, width, height: yTop - yBottom, borderColor: color, borderWidth: 0.75 });

  const innerX = x + NOTES_BOX_PADDING;
  const innerWidth = width - NOTES_BOX_PADDING * 2;
  page.drawText(label, { x: innerX + innerWidth - labelWidth, y: labelY, size: NOTES_LABEL_SIZE, font: arabicFont, color });

  const spaceWidth = arabicFont.widthOfTextAtSize(" ", size);

  function drawRun(run, runX, y) {
    const runFont = fontFor(run.font, arabicFont, latinFont);
    page.drawText(run.text, { x: runX, y, size, font: runFont, color });
    return runFont.widthOfTextAtSize(run.text, size);
  }

  lines.forEach((line, lineIndex) => {
    const y = textTop - (lineIndex + 1) * lineHeight;
    const blocks = groupWordsIntoBlocks(line, spaceWidth);
    let cursor = innerX + innerWidth; // right edge -- first-typed block goes here
    blocks.forEach((block) => {
      if (block.font === "latin") {
        // An embedded LTR run (English phrase, a run of digits) reads
        // left-to-right internally even though it sits inside an RTL
        // paragraph -- draw its words left-to-right from the block's own
        // left edge, same as normal English text. Glued words (chunkWord
        // fragments) get no gap before them -- they're one token split for
        // width, not separate words.
        let wordX = cursor - block.width;
        block.words.forEach((word, i) => {
          let runX = wordX;
          word.runs.forEach((run) => {
            runX += drawRun(run, runX, y);
          });
          const next = block.words[i + 1];
          wordX += word.width + (next && !next.glued ? spaceWidth : 0);
        });
      } else {
        // Arabic block: words (and their internal runs) flow right-to-left,
        // first-typed word rightmost -- matches how "يعتمد" and the "الاسم"
        // column already render via drawCellText above.
        let wordRight = cursor;
        block.words.forEach((word, i) => {
          let runX = wordRight - word.width;
          word.runs.forEach((run) => {
            runX += drawRun(run, runX, y);
          });
          const next = block.words[i + 1];
          wordRight -= word.width + (next && !next.glued ? spaceWidth : 0);
        });
      }
      cursor -= block.width + spaceWidth;
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
  pdfDoc.registerFontkit(fontkit);
  const page = pdfDoc.getPages()[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const arabicFont = await pdfDoc.embedFont(fs.readFileSync(ARABIC_FONT_PATH));
  const latinFont = await pdfDoc.embedFont(fs.readFileSync(LATIN_FONT_PATH));

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
    // Every signed row gets the same fixed "خالي الطرف" stamp -- this column
    // isn't per-department commentary, just a completed/blank marker, so
    // there's nothing to vary row to row.
    drawCellText(page, arabicFont, STATEMENT_TEXT, COLUMNS.statement, row);

    // Wages/Finance's optional remark (see requestDepartmentSchema `notes`)
    // -- reached only for a completed row (single-mode's `continue` above
    // already skipped anything still pending), so reopening a department
    // makes its note disappear along with the rest of its row, same as
    // evidence does, until it's re-signed.
    if (dept.hasOversightDashboard && dept.notes) {
      const notesBox = NOTES_BOX_BY_ORDER[dept.order];
      if (notesBox) drawNotesBox(page, arabicFont, latinFont, notesBox, `ملاحظات ${dept.name_ar}`, dept.notes);
    }
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateClearancePdf, signerNameForPdf };
