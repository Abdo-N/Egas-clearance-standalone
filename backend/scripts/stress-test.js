/**
 * Load/stress test against a running server (npm run dev + a reachable
 * MongoDB). NOT part of the smoke-test suite -- this is additive: it
 * registers throwaway accounts/requests (STRESS-<runId>-* / *.<runId>@
 * stresstest.local) and never touches existing data. Safe to re-run; safe to
 * just re-seed (`npm run seed:dev`) afterward to wipe it back out.
 *
 * Usage: node scripts/stress-test.js
 * Tunables (env): TOTAL_REQUESTS, REVIEWERS_PER_DEPT, FM_ACCOUNTS, CONCURRENCY, BASE_URL
 *
 * Besides raw throughput/latency, this specifically checks for lost updates:
 * request.routes.js signs by `findById` -> mutate one department/item
 * subdocument -> `save()`, with no optimistic-concurrency check. Tier-1
 * departments are documented as signing "in parallel", so this fires all of
 * a request's tier-1 signs concurrently (real fan-out, not just N parallel
 * *requests*) and re-reads the document afterward to confirm every signal
 * that returned 200 actually landed.
 */
const { PNG } = require("pngjs");
const { PDFDocument, rgb } = require("pdf-lib");
const { execSync } = require("child_process");

const BASE = process.env.BASE_URL || "http://localhost:4000/api";
const RUN_ID = Date.now();
const STRESS_PASSWORD = "Str3ssTest!Password";
const DEMO_PASSWORD = "DemoPassw0rd!";

const REVIEWERS_PER_DEPT = Number(process.env.REVIEWERS_PER_DEPT || 15);
const FM_ACCOUNTS = Number(process.env.FM_ACCOUNTS || 20);
const TOTAL_REQUESTS = Number(process.env.TOTAL_REQUESTS || 250);
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);

const NON_IT_TIER1_KEYS = [
  "illicit_gains", "library", "security", "legal", "medical",
  "healthcare_accounts", "hr_development", "public_relations", "warehouses", "transport",
];
const IT_ITEM_KEYS = ["mobile_data_lines", "phone", "pc_account_mailbox", "sap_service", "sap_account_removal"];
const TIER2_KEYS = ["wages", "finance"];
const SINGLE_MODE_KEYS = [...NON_IT_TIER1_KEYS, ...TIER2_KEYS];
const LEAVING_REASONS = [
  "death", "retirement", "early_retirement", "dismissal", "resignation", "secondment_end",
  "delegation_end", "assignment_end", "sister_company_transfer", "new_job",
  "driver_contract_end", "fixed_term_contract_end", "comprehensive_bonus_contract_end",
];
const JOB_TITLES = ["محاسب", "مهندس اتصالات", "فني صيانة", "أخصائي موارد بشرية", "مدير إداري", "سائق", "كاتب حسابات"];
const DEPT_NAMES_AR = ["الإدارة المالية", "إدارة المخازن", "الشئون الهندسية", "إدارة النقل", "الشئون القانونية"];

// ---------- stats ----------
const stats = {};
const errorsLog = [];
const raceMismatches = [];

function record(op, ms, status) {
  const s = (stats[op] ||= { count: 0, errors: {}, durations: [] });
  s.count++;
  s.durations.push(ms);
  if (!(status >= 200 && status < 300)) s.errors[status] = (s.errors[status] || 0) + 1;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function printReport() {
  console.log("\n=== STRESS TEST SUMMARY ===");
  const rows = Object.entries(stats).map(([op, s]) => {
    const sorted = [...s.durations].sort((a, b) => a - b);
    const errCount = Object.values(s.errors).reduce((a, b) => a + b, 0);
    return {
      op,
      count: s.count,
      errors: errCount,
      errorBreakdown: JSON.stringify(s.errors),
      minMs: sorted[0] || 0,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1] || 0,
      totalMs: s.durations.reduce((a, b) => a + b, 0),
    };
  });
  console.table(rows);

  console.log(`\nnon-HTTP-status errors / exceptions logged: ${errorsLog.length}`);
  for (const e of errorsLog.slice(0, 20)) console.log("  ", JSON.stringify(e));
  if (errorsLog.length > 20) console.log(`  ...and ${errorsLog.length - 20} more`);

  console.log(`\nlost-update (race) mismatches: ${raceMismatches.length}`);
  for (const m of raceMismatches.slice(0, 20)) console.log("  ", JSON.stringify(m));
  if (raceMismatches.length > 20) console.log(`  ...and ${raceMismatches.length - 20} more`);
}

// ---------- http helpers ----------
async function call(op, url, options = {}) {
  const start = Date.now();
  let status = 0, body = null;
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
    status = res.status;
    const ct = res.headers.get("content-type") || "";
    body = ct.includes("application/json") ? await res.json().catch(() => null) : null;
  } catch (err) {
    status = -1;
    body = { error: err.message };
  }
  const ms = Date.now() - start;
  record(op, ms, status);
  return { status, body, ms };
}

async function fetchPdf(op, url, token) {
  const start = Date.now();
  let status = 0, bytes = 0, contentType = "";
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    status = res.status;
    contentType = res.headers.get("content-type") || "";
    const buf = await res.arrayBuffer();
    bytes = buf.byteLength;
  } catch (err) {
    status = -1;
  }
  const ms = Date.now() - start;
  record(op, ms, status);
  return { status, bytes, contentType, ms };
}

async function register(op, { email, password, fullName, role, departmentKey, landlineNumber }) {
  const { status, body } = await call(op, `${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullName, role, departmentKey, landlineNumber }),
  });
  if (status !== 201) throw new Error(`register failed for ${email}: ${JSON.stringify(body)}`);
  return body.token;
}

async function login(op, email, password) {
  const { status, body } = await call(op, `${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(body)}`);
  return body.token;
}

function evidenceForm(password, buffer, mimeType, filename) {
  const form = new FormData();
  form.append("password", password);
  form.append("evidence", new Blob([buffer], { type: mimeType }), filename);
  return form;
}

async function signSingle(op, requestId, deptKey, token, password, buf, mime, name) {
  return call(op, `${BASE}/requests/${requestId}/departments/${deptKey}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: evidenceForm(password, buf, mime, name),
  });
}

async function signItem(op, requestId, deptKey, itemKey, token, password, buf, mime, name) {
  return call(op, `${BASE}/requests/${requestId}/departments/${deptKey}/items/${itemKey}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: evidenceForm(password, buf, mime, name),
  });
}

// ---------- misc helpers ----------
async function pool(items, worker, limit) {
  const results = new Array(items.length);
  let idx = 0;
  async function runner() {
    while (idx < items.length) {
      const current = idx++;
      try {
        results[current] = await worker(items[current], current);
      } catch (err) {
        results[current] = { error: err.message };
        errorsLog.push({ op: "pool-worker", message: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function futureIsoDate(daysFromNow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function getServerPid() {
  try {
    const out = execSync("ss -ltnp 2>/dev/null | grep ':4000'").toString();
    const m = out.match(/pid=(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function getRssKb(pid) {
  if (!pid) return null;
  try {
    return Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) || null;
  } catch {
    return null;
  }
}

// A white 220x90 canvas with a dark "signature-ish" stroke -- real enough to
// exercise cropToContent/stripNearWhiteBackground/embedPng for real, instead
// of failing fast at decode like plain garbage bytes would.
function makeRealPng() {
  const width = 220, height = 90;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const onStroke = x > 20 && x < 200 && Math.abs(y - 45 - 20 * Math.sin(x / 15)) < 3;
      const [r, g, b] = onStroke ? [20, 20, 40] : [255, 255, 255];
      png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

async function makeRealPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 120]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 120, color: rgb(1, 1, 1) });
  for (let i = 0; i < 6; i++) {
    page.drawLine({
      start: { x: 30 + i * 5, y: 20 },
      end: { x: 60 + i * 8, y: 90 },
      thickness: 2,
      color: rgb(0.1, 0.1, 0.3),
    });
  }
  return Buffer.from(await doc.save());
}

// ---------- main ----------
async function main() {
  const health = await call("health", `${BASE}/health`, {});
  if (health.status !== 200) throw new Error("server not reachable at " + BASE);

  const serverPid = getServerPid();
  console.log(`server pid: ${serverPid || "unknown (RSS sampling disabled)"}`);
  const rssBefore = getRssKb(serverPid);
  const rssSamples = [];
  const rssTimer = serverPid ? setInterval(() => {
    const v = getRssKb(serverPid);
    if (v) rssSamples.push(v);
  }, 3000) : null;

  const FAKE_BUF = Buffer.from("fake-signature-bytes-not-a-real-image");
  console.log("building realistic evidence fixtures (real PNG + real PDF)...");
  const REAL_PNG = makeRealPng();
  const REAL_PDF = await makeRealPdf();

  console.log(`\n--- phase 1: registering ${SINGLE_MODE_KEYS.length * REVIEWERS_PER_DEPT} reviewer + ${FM_ACCOUNTS} file-management accounts ---`);
  const t1 = Date.now();
  const reviewersByDept = {};
  for (const k of SINGLE_MODE_KEYS) reviewersByDept[k] = [];
  const fmTokens = [];

  const regJobs = [];
  for (const deptKey of SINGLE_MODE_KEYS) {
    for (let i = 0; i < REVIEWERS_PER_DEPT; i++) regJobs.push({ type: "reviewer", deptKey, i });
  }
  for (let i = 0; i < FM_ACCOUNTS; i++) regJobs.push({ type: "fm", i });

  let regDone = 0;
  await pool(regJobs, async (job) => {
    try {
      if (job.type === "reviewer") {
        const email = `${job.deptKey}.r${job.i}.${RUN_ID}@stresstest.local`;
        const token = await register("register:reviewer", {
          email, password: STRESS_PASSWORD, fullName: `Stress Reviewer ${job.deptKey} #${job.i}`,
          role: "reviewer", departmentKey: job.deptKey, landlineNumber: String(2000 + job.i),
        });
        reviewersByDept[job.deptKey].push(token);
      } else {
        const email = `fm.${job.i}.${RUN_ID}@stresstest.local`;
        const token = await register("register:fm", {
          email, password: STRESS_PASSWORD, fullName: `Stress FM #${job.i}`,
          role: "file_management", landlineNumber: String(9500 + job.i),
        });
        fmTokens.push(token);
      }
    } catch (err) {
      errorsLog.push({ op: "register", job, message: err.message });
    }
    regDone++;
    if (regDone % 50 === 0) console.log(`  registered ${regDone}/${regJobs.length}`);
  }, CONCURRENCY);

  const itTokensByItem = {};
  for (const itemKey of IT_ITEM_KEYS) {
    itTokensByItem[itemKey] = await login("login:it-demo", `it.${itemKey}@demo.local`, DEMO_PASSWORD);
  }

  for (const deptKey of SINGLE_MODE_KEYS) {
    if (reviewersByDept[deptKey].length === 0) throw new Error(`no reviewer accounts survived for ${deptKey}, aborting`);
  }
  if (fmTokens.length === 0) throw new Error("no file-management accounts survived, aborting");
  console.log(`phase 1 done in ${Date.now() - t1}ms`);

  console.log(`\n--- phase 2: creating ${TOTAL_REQUESTS} clearance requests ---`);
  const t2 = Date.now();

  function pickBucket() {
    const r = Math.random();
    if (r < 0.15) return "untouched";
    if (r < 0.50) return "partial";
    if (r < 0.75) return "fullSigned";
    return "completed";
  }

  let createDone = 0;
  const created = await pool(Array.from({ length: TOTAL_REQUESTS }, (_, i) => i), async (i) => {
    const fmToken = pick(fmTokens);
    const { status, body } = await call("createRequest", `${BASE}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${fmToken}` },
      body: JSON.stringify({
        employeeFullName: `Stress Employee ${i}`,
        employeeNumber: `STRESS-${RUN_ID}-${i}`,
        employeeJobTitle: pick(JOB_TITLES),
        employeeDepartment_ar: pick(DEPT_NAMES_AR),
        reason: pick(LEAVING_REASONS),
        lastWorkingDay: futureIsoDate(1 + Math.floor(Math.random() * 180)),
      }),
    });
    createDone++;
    if (createDone % 50 === 0) console.log(`  created ${createDone}/${TOTAL_REQUESTS}`);
    if (status !== 201) {
      errorsLog.push({ op: "createRequest", i, status, body });
      return null;
    }
    return { id: body._id, bucket: pickBucket(), completed: false };
  }, CONCURRENCY);

  const requests = created.filter(Boolean);
  console.log(`phase 2 done in ${Date.now() - t2}ms (${requests.length}/${TOTAL_REQUESTS} created)`);
  const bucketCounts = requests.reduce((acc, r) => ((acc[r.bucket] = (acc[r.bucket] || 0) + 1), acc), {});
  console.log("bucket distribution:", bucketCounts);

  console.log(`\n--- phase 3: signing lifecycles (concurrency=${CONCURRENCY}) ---`);
  const t3 = Date.now();
  let lifecycleDone = 0;

  async function runLifecycle(entry) {
    const { id, bucket } = entry;
    if (bucket === "untouched") return;

    const useRealEvidence = bucket === "fullSigned" || bucket === "completed";
    let toggle = 0;
    function evidenceBytes() {
      if (!useRealEvidence) return { buf: FAKE_BUF, mime: "image/png", name: "sig.png" };
      toggle++;
      return toggle % 2 === 0
        ? { buf: REAL_PDF, mime: "application/pdf", name: "sig.pdf" }
        : { buf: REAL_PNG, mime: "image/png", name: "sig.png" };
    }

    const tier1DeptKeys = bucket === "partial" ? NON_IT_TIER1_KEYS.filter(() => Math.random() < 0.5) : NON_IT_TIER1_KEYS;
    const tier1ItemKeys = bucket === "partial" ? IT_ITEM_KEYS.filter(() => Math.random() < 0.5) : IT_ITEM_KEYS;

    const deptOutcomes = await Promise.all(tier1DeptKeys.map(async (deptKey) => {
      const token = pick(reviewersByDept[deptKey]);
      const { buf, mime, name } = evidenceBytes();
      const r = await signSingle("sign:tier1", id, deptKey, token, STRESS_PASSWORD, buf, mime, name);
      return { deptKey, r };
    }));
    const itemOutcomes = await Promise.all(tier1ItemKeys.map(async (itemKey) => {
      const token = itTokensByItem[itemKey];
      const { buf, mime, name } = evidenceBytes();
      const r = await signItem("sign:itItem", id, "it", itemKey, token, DEMO_PASSWORD, buf, mime, name);
      return { itemKey, r };
    }));

    const oversightToken = pick(reviewersByDept.wages);
    const verify1 = await call("verify:afterTier1", `${BASE}/requests/${id}`, { headers: { Authorization: `Bearer ${oversightToken}` } });
    const depts1 = verify1.body?.departments || [];
    for (const { deptKey, r } of deptOutcomes) {
      if (r.status !== 200) { errorsLog.push({ op: "sign:tier1", id, deptKey, status: r.status, body: r.body }); continue; }
      const d = depts1.find((x) => x.departmentKey === deptKey);
      if (!d || d.status !== "completed") raceMismatches.push({ id, kind: "dept", key: deptKey, phase: "tier1" });
    }
    const itDept1 = depts1.find((x) => x.departmentKey === "it");
    for (const { itemKey, r } of itemOutcomes) {
      if (r.status !== 200) { errorsLog.push({ op: "sign:itItem", id, itemKey, status: r.status, body: r.body }); continue; }
      const it = itDept1?.items?.find((x) => x.key === itemKey);
      if (!it || it.status !== "completed") raceMismatches.push({ id, kind: "item", key: itemKey, phase: "tier1" });
    }

    if (bucket === "partial") return;

    const tier2Outcomes = await Promise.all(TIER2_KEYS.map(async (deptKey) => {
      const token = pick(reviewersByDept[deptKey]);
      const { buf, mime, name } = evidenceBytes();
      const r = await signSingle("sign:tier2", id, deptKey, token, STRESS_PASSWORD, buf, mime, name);
      return { deptKey, r };
    }));
    const verify2 = await call("verify:afterTier2", `${BASE}/requests/${id}`, { headers: { Authorization: `Bearer ${oversightToken}` } });
    const depts2 = verify2.body?.departments || [];
    for (const { deptKey, r } of tier2Outcomes) {
      if (r.status !== 200) { errorsLog.push({ op: "sign:tier2", id, deptKey, status: r.status, body: r.body }); continue; }
      const d = depts2.find((x) => x.departmentKey === deptKey);
      if (!d || d.status !== "completed") raceMismatches.push({ id, kind: "dept", key: deptKey, phase: "tier2" });
    }

    if (bucket === "fullSigned") return;

    const fmToken = pick(fmTokens);
    const approve = await call("approve", `${BASE}/requests/${id}/approve-clearance`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fmToken}` },
      body: JSON.stringify({ password: STRESS_PASSWORD }),
    });
    if (approve.status !== 200) { errorsLog.push({ op: "approve", id, status: approve.status, body: approve.body }); return; }

    const revoke = await call("revoke", `${BASE}/requests/${id}/revoke-access`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${itTokensByItem.phone}` },
      body: JSON.stringify({ password: DEMO_PASSWORD }),
    });
    if (revoke.status !== 200) { errorsLog.push({ op: "revoke", id, status: revoke.status, body: revoke.body }); return; }

    entry.completed = true;
  }

  await pool(requests, async (entry) => {
    await runLifecycle(entry);
    lifecycleDone++;
    if (lifecycleDone % 25 === 0) console.log(`  lifecycles finished ${lifecycleDone}/${requests.length}`);
  }, CONCURRENCY);
  console.log(`phase 3 done in ${Date.now() - t3}ms`);

  console.log("\n--- phase 4: list-endpoint load (FM / oversight / plain reviewer dashboards) ---");
  const t4 = Date.now();
  const listJobs = [
    ...fmTokens.slice(0, 5).map((token) => ({ op: "list:fm", token })),
    ...reviewersByDept.wages.slice(0, 5).map((token) => ({ op: "list:oversight", token })),
    ...NON_IT_TIER1_KEYS.slice(0, 5).map((k) => ({ op: "list:reviewer", token: pick(reviewersByDept[k]) })),
  ];
  await pool(listJobs, (job) => call(job.op, `${BASE}/requests`, { headers: { Authorization: `Bearer ${job.token}` } }), 5);
  for (let i = 0; i < 10; i++) await call("departments:public", `${BASE}/departments`, {});
  console.log(`phase 4 done in ${Date.now() - t4}ms`);

  console.log("\n--- phase 5: composited-PDF generation load ---");
  const t5 = Date.now();
  const completedIds = requests.filter((r) => r.completed).map((r) => r.id);
  const pdfTargets = completedIds.slice(0, 30);
  console.log(`fetching PDFs for ${pdfTargets.length} fully-completed requests (concurrency=8)`);
  await pool(pdfTargets, (id) => fetchPdf("pdf:generate", `${BASE}/requests/${id}/pdf`, fmTokens[0]), 8);
  console.log(`phase 5 done in ${Date.now() - t5}ms`);

  if (rssTimer) clearInterval(rssTimer);
  const rssAfter = getRssKb(serverPid);
  const rssPeak = rssSamples.length ? Math.max(...rssSamples) : null;

  printReport();

  console.log("\n=== RESOURCE USAGE ===");
  console.log(`server RSS before: ${rssBefore ? (rssBefore / 1024).toFixed(1) + " MB" : "n/a"}`);
  console.log(`server RSS peak:   ${rssPeak ? (rssPeak / 1024).toFixed(1) + " MB" : "n/a"}`);
  console.log(`server RSS after:  ${rssAfter ? (rssAfter / 1024).toFixed(1) + " MB" : "n/a"}`);

  console.log("\n=== RUN INFO ===");
  console.log(`runId: ${RUN_ID}`);
  console.log(`accounts created: ${Object.values(reviewersByDept).reduce((a, arr) => a + arr.length, 0)} reviewers + ${fmTokens.length} file-management`);
  console.log(`requests created: ${requests.length} (${completedIds.length} fully completed end-to-end)`);
}

main().catch((err) => {
  console.error("STRESS TEST FAILED:", err);
  process.exit(1);
});
