/**
 * Manual end-to-end smoke test for the revamped clearance flow.
 *
 * Requires a running local MongoDB and the server already started
 * (npm run seed:dev && npm run dev in another terminal), then:
 *   node scripts/smoke-test.js
 *
 * Exercises the real rules:
 *   - File Management (not the employee) files the request.
 *   - Tier-1 departments (1-11, incl. IT) sign in parallel, no gating.
 *   - Tier-2 departments (wages, finance) are locked until every tier-1
 *     department has signed.
 *   - Non-IT departments: single signature, any reviewer in that department.
 *   - IT: 5 itemized signatures, each only signable by its assigned reviewer.
 *   - "Revoke access" only works once all 13 have signed AND
 *     File Management has explicitly approved (approve-clearance), and
 *     only for IT. General rule: signing alone never marks a request
 *     "completed" -- only revoke-access does, even after all 13 sign.
 *   - File Management can reopen a signed department/item (evidence turned
 *     out unclear) -- resets it to unsigned and revokes any prior approval.
 *   - A department can ALSO undo its own signature itself (any of its
 *     reviewers, not just whoever originally signed -- or for IT, only the
 *     one reviewer that item is permanently assigned to), without needing
 *     File Management to do it for them. Same effect as File Management's
 *     reopen, different caller.
 *   - File Management can view a department's evidence as soon as that
 *     department signs, same as oversight (wages/finance) -- this is what
 *     lets them actually spot an unclear signature and reopen it BEFORE
 *     giving the revoke-access OK, not only after approving. File Management
 *     also sees signer identity + contact (name, sign date, email, landline)
 *     per department/item, same as oversight (2026-08-11).
 *   - A plain reviewer's request list/detail is redacted to their own
 *     department only.
 */
const BASE = process.env.BASE_URL || "http://localhost:4000/api";

const NON_IT_TIER1_KEYS = [
  "illicit_gains", "library", "security", "legal", "medical",
  "healthcare_accounts", "hr_development", "public_relations", "warehouses", "transport",
];
const IT_ITEM_KEYS = ["mobile_data_lines", "phone", "pc_account_mailbox", "sap_service", "sap_account_removal"];

// Each run creates a fresh File Management account and one extra same-dept
// reviewer for the cross-reviewer undo check. All canonical department/IT
// reviewers come from the deterministic demo seed; in particular, IT items
// enforce exactly one owning account, so registering replacement IT owners
// would correctly fail.
const RUN_ID = Date.now();
const PASSWORD = "Sm0keTest!Password";
const DEMO_PASSWORD = "DemoPassw0rd!";

function futureIsoDate(daysFromNow = 90) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

async function register({ slug, fullName, role, departmentKey, assignedItemKey }) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${slug}.${RUN_ID}@smoketest.local`,
      password: PASSWORD,
      fullName,
      landlineNumber: "1234",
      role,
      departmentKey,
      assignedItemKey,
    }),
  });
  const json = await res.json();
  if (res.status !== 201) throw new Error(`register failed for ${slug}: ${JSON.stringify(json)}`);
  return json.token;
}

async function login(email, password = DEMO_PASSWORD) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(json)}`);
  return json.token;
}

async function registerAllAccounts() {
  const tokens = {};
  tokens.fileManagement = await register({ slug: "file-management", fullName: "File Management", role: "file_management" });
  tokens.sharedFileManagement = await login("file.management@demo.local");

  for (const deptKey of [...NON_IT_TIER1_KEYS, "wages", "finance"]) {
    tokens[`${deptKey}1`] = await login(`${deptKey}@demo.local`);
  }
  tokens.illicit_gains2 = await register({
    slug: "illicit-gains-alternate",
    fullName: "Illicit Gains Alternate Reviewer",
    role: "reviewer",
    departmentKey: "illicit_gains",
  });

  for (const itemKey of IT_ITEM_KEYS) {
    tokens[`it_${itemKey}`] = await login(`it.${itemKey}@demo.local`);
  }

  return tokens;
}

function fakeEvidence() {
  const form = new FormData();
  // Every signSingle/signItem call site signs with a demo-seeded reviewer's
  // token (DEMO_PASSWORD), never the fresh smoke-test-registered accounts
  // (PASSWORD) -- this was sending the wrong one and failing signature calls
  // with "Incorrect password" as soon as a department actually unlocked.
  form.append("password", DEMO_PASSWORD);
  form.append("evidence", new Blob([Buffer.from("fake-signature-bytes")], { type: "image/png" }), "signature.png");
  return form;
}

async function signSingle(requestId, deptKey, token) {
  return fetch(`${BASE}/requests/${requestId}/departments/${deptKey}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fakeEvidence(),
  });
}

async function signItem(requestId, deptKey, itemKey, token) {
  return fetch(`${BASE}/requests/${requestId}/departments/${deptKey}/items/${itemKey}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fakeEvidence(),
  });
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  console.log("--- health check ---");
  console.log(await (await fetch(`${BASE}/health`)).json());

  console.log("--- logging in seeded reviewers + registering two fresh smoke-test accounts ---");
  const tokens = await registerAllAccounts();
  const fileMgmtToken = tokens.fileManagement;
  console.log("done");

  console.log("--- File Management: file a new clearance request (employee data entered manually) ---");
  const reqRes = await fetch(`${BASE}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fileMgmtToken}` },
    body: JSON.stringify({
      employeeFullName: "Test Employee",
      employeeNumber: `SMOKE-${RUN_ID}`,
      employeeJobTitle: "Analyst",
      employeeDepartment_ar: "قسم تجريبي",
      employeeDepartment_en: "Test Department",
      reason: "resignation",
      lastWorkingDay: futureIsoDate(),
    }),
  });
  const request = await reqRes.json();
  if (reqRes.status !== 201) throw new Error(JSON.stringify(request));
  const requestId = request._id;
  console.log(`created request ${requestId} for employee #${request.employeeNumber}`);
  assert(request.departments.length === 13, "expected 13 snapshotted departments");

  console.log("--- a different File Management account sees the new request in the shared queue ---");
  const sharedFileMgmtToken = tokens.sharedFileManagement;
  const sharedQueueRes = await fetch(`${BASE}/requests`, {
    headers: { Authorization: `Bearer ${sharedFileMgmtToken}` },
  });
  const sharedQueue = await sharedQueueRes.json();
  assert(sharedQueueRes.status === 200, "expected the shared File Management queue to load");
  assert(
    sharedQueue.some((entry) => entry._id === requestId),
    "expected a request filed by another File Management account in the shared queue"
  );

  console.log("--- tier 2 (wages) is locked before tier 1 has finished (409) ---");
  const wagesToken = tokens.wages1;
  const tooEarly = await signSingle(requestId, "wages", wagesToken);
  console.log(tooEarly.status, await tooEarly.json());
  assert(tooEarly.status === 409, "expected wages to be locked behind tier 1");

  console.log("--- signing every non-IT tier-1 department (any one of its 2 reviewers) ---");
  for (const deptKey of NON_IT_TIER1_KEYS) {
    const res = await signSingle(requestId, deptKey, tokens[`${deptKey}1`]);
    if (res.status !== 200) throw new Error(`failed to sign ${deptKey}: ${JSON.stringify(await res.json())}`);
  }
  console.log("done");

  console.log("--- a department can undo its OWN signature (not just File Management) -- e.g. wrong file uploaded ---");
  const illicitGains2Token = tokens.illicit_gains2;
  const selfUndo = await fetch(`${BASE}/requests/${requestId}/departments/illicit_gains/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${illicitGains2Token}` },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const selfUndoJson = await selfUndo.json();
  if (selfUndo.status !== 200) throw new Error(`self-undo failed: ${JSON.stringify(selfUndoJson)}`);
  assert(
    selfUndoJson.departments[0].status === "pending",
    "expected illicit_gains back to 'pending' after a DIFFERENT reviewer of the same department undid it themselves"
  );

  console.log("--- a reviewer from a DIFFERENT department cannot undo illicit_gains's signature (403) ---");
  const libraryToken = tokens.library1;
  const wrongDeptUndo = await fetch(`${BASE}/requests/${requestId}/departments/illicit_gains/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${libraryToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  assert(wrongDeptUndo.status === 403, "expected 403 undoing another department's signature");

  console.log("--- illicit_gains re-signs after self-undo ---");
  const illicitGains1Token = tokens.illicit_gains1;
  const reSignIllicitGains = await signSingle(requestId, "illicit_gains", illicitGains1Token);
  if (reSignIllicitGains.status !== 200) throw new Error(`failed to re-sign illicit_gains: ${JSON.stringify(await reSignIllicitGains.json())}`);

  console.log("--- IT: wrong reviewer signing someone else's item is rejected (403) ---");
  const phoneToken = tokens.it_phone;
  const wrongItem = await signItem(requestId, "it", "sap_service", phoneToken);
  console.log(wrongItem.status, await wrongItem.json());
  assert(wrongItem.status === 403, "expected 403 for signing another reviewer's assigned item");

  console.log("--- IT: each of the 5 reviewers signs their own item ---");
  for (const itemKey of IT_ITEM_KEYS) {
    const res = await signItem(requestId, "it", itemKey, tokens[`it_${itemKey}`]);
    if (res.status !== 200) throw new Error(`failed to sign IT item ${itemKey}: ${JSON.stringify(await res.json())}`);
  }
  console.log("done");

  console.log("--- the reviewer an IT item is assigned to can undo their OWN item ---");
  const phoneSelfUndo = await fetch(`${BASE}/requests/${requestId}/departments/it/items/phone/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${phoneToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  const phoneSelfUndoJson = await phoneSelfUndo.json();
  if (phoneSelfUndo.status !== 200) throw new Error(`IT self-undo failed: ${JSON.stringify(phoneSelfUndoJson)}`);
  assert(
    phoneSelfUndoJson.departments[0].items.find((i) => i.key === "phone").status === "pending",
    "expected the phone item back to 'pending' after its own reviewer undid it"
  );
  assert(
    phoneSelfUndoJson.departments[0].status === "pending",
    "expected IT's department status to revert to 'pending' now that one item is unsigned again"
  );

  console.log("--- a DIFFERENT IT reviewer cannot undo someone else's item (403) ---");
  const mobileDataToken = tokens.it_mobile_data_lines;
  const wrongItemUndo = await fetch(`${BASE}/requests/${requestId}/departments/it/items/phone/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mobileDataToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  assert(wrongItemUndo.status === 403, "expected 403 undoing another reviewer's assigned item");

  console.log("--- phone re-signs their own item after self-undo ---");
  const reSignPhone = await signItem(requestId, "it", "phone", phoneToken);
  if (reSignPhone.status !== 200) throw new Error(`failed to re-sign phone item: ${JSON.stringify(await reSignPhone.json())}`);

  console.log("--- tier 2 (wages, finance) now unlocked ---");
  const wagesSign = await signSingle(requestId, "wages", wagesToken);
  if (wagesSign.status !== 200) throw new Error(`failed to sign wages: ${JSON.stringify(await wagesSign.json())}`);
  const financeToken = tokens.finance1;
  const financeSign = await signSingle(requestId, "finance", financeToken);
  const financeJson = await financeSign.json();
  if (financeSign.status !== 200) throw new Error(`failed to sign finance: ${JSON.stringify(financeJson)}`);

  console.log("--- all 13 signed, but NOT yet 'completed' -- revoking access is the real final step ---");
  const finalGet = await fetch(`${BASE}/requests/${requestId}`, { headers: { Authorization: `Bearer ${sharedFileMgmtToken}` } });
  const finalRequest = await finalGet.json();
  assert(finalRequest.status === "in_progress", `expected 'in_progress' until access is revoked, got '${finalRequest.status}'`);
  assert(
    finalRequest.departments.find((d) => d.departmentKey === "wages").signedByUserID === "wages@demo.local",
    "expected File Management's view to include signer identity + contact (2026-08-11 rule change)"
  );
  assert(
    finalRequest.departments.find((d) => d.departmentKey === "wages").evidence?.mimeType === "image/png",
    "expected File Management to already see a signed department's evidence, even before approving the request"
  );

  console.log("--- IT sees awaitingFileManagementApproval=true, NOT readyForAccessRevocation (all signed, but not yet approved) ---");
  const itPreApprovalGet = await fetch(`${BASE}/requests/${requestId}`, { headers: { Authorization: `Bearer ${phoneToken}` } });
  const itPreApprovalJson = await itPreApprovalGet.json();
  assert(itPreApprovalJson.readyForAccessRevocation === false, "expected readyForAccessRevocation=false before File Management approves");
  assert(itPreApprovalJson.awaitingFileManagementApproval === true, "expected awaitingFileManagementApproval=true once all 13 have signed");
  assert(itPreApprovalJson.departments.length === 1, "IT should still only see its own department");

  console.log("--- File Management CAN preview the PDF now -- every department signed, nothing partial left to leak ---");
  const pdfBeforeApproval = await fetch(`${BASE}/requests/${requestId}/pdf`, { headers: { Authorization: `Bearer ${sharedFileMgmtToken}` } });
  assert(pdfBeforeApproval.status === 200, "expected 200 previewing the PDF once every department has signed");

  console.log("--- File Management CAN view a signed department's evidence directly, before approving (how they'd catch an unclear signature) ---");
  const evidenceBeforeApproval = await fetch(`${BASE}/requests/${requestId}/evidence/wages`, {
    headers: { Authorization: `Bearer ${sharedFileMgmtToken}` },
  });
  assert(evidenceBeforeApproval.status === 200, "expected 200 viewing a signed department's evidence as File Management before approval");

  console.log("--- IT cannot revoke access before File Management approves (400) ---");
  const archiveBeforeApproval = await fetch(`${BASE}/requests/${requestId}/revoke-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${phoneToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  assert(archiveBeforeApproval.status === 400, "expected 400 for revoke-access before File Management approval");

  console.log("--- File Management reopens security's signature (e.g. it turned out unclear) ---");
  const securityToken = tokens.security1;
  const reopenRes = await fetch(`${BASE}/requests/${requestId}/departments/security/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sharedFileMgmtToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  const reopenJson = await reopenRes.json();
  if (reopenRes.status !== 200) throw new Error(`reopen failed: ${JSON.stringify(reopenJson)}`);
  assert(
    reopenJson.departments.find((d) => d.departmentKey === "security").status === "pending",
    "expected security to be back to 'pending' after reopen"
  );
  assert(reopenJson.awaitingFileManagementApproval === false, "expected awaitingFileManagementApproval=false once a department is reopened");

  console.log("--- security re-signs after reopen ---");
  const resignSecurity = await signSingle(requestId, "security", securityToken);
  if (resignSecurity.status !== 200) throw new Error(`failed to re-sign security: ${JSON.stringify(await resignSecurity.json())}`);

  console.log("--- File Management approves now that all 13 have signed again ---");
  const approveRes = await fetch(`${BASE}/requests/${requestId}/approve-clearance`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sharedFileMgmtToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  const approveJson = await approveRes.json();
  if (approveRes.status !== 200) throw new Error(`approve-clearance failed: ${JSON.stringify(approveJson)}`);
  assert(approveJson.readyForAccessRevocation === true, "expected readyForAccessRevocation=true once File Management approves");
  assert(approveJson.awaitingFileManagementApproval === false, "expected awaitingFileManagementApproval=false once approved");
  assert(
    approveJson.departments.find((d) => d.departmentKey === "wages").evidence?.mimeType === "image/png",
    "expected File Management's own view to still include evidence after approving"
  );

  console.log("--- File Management can still view evidence after approving too ---");
  const evidenceAfterApproval = await fetch(`${BASE}/requests/${requestId}/evidence/wages`, {
    headers: { Authorization: `Bearer ${sharedFileMgmtToken}` },
  });
  assert(evidenceAfterApproval.status === 200, "expected 200 viewing evidence as File Management after approval");

  console.log("--- approving twice is rejected (409) ---");
  const approveAgain = await fetch(`${BASE}/requests/${requestId}/approve-clearance`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fileMgmtToken}` },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert(approveAgain.status === 409, "expected 409 for double approval");

  console.log("--- a non-IT reviewer cannot revoke access (403) ---");
  const nonItArchive = await fetch(`${BASE}/requests/${requestId}/revoke-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${financeToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  assert(nonItArchive.status === 403, "expected 403 for non-IT revoke-access");

  console.log("--- IT revokes the employee's access ---");
  const itArchiveToken = phoneToken;
  const archiveRes = await fetch(`${BASE}/requests/${requestId}/revoke-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${itArchiveToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  const archiveJson = await archiveRes.json();
  if (archiveRes.status !== 200) throw new Error(`revoke-access failed: ${JSON.stringify(archiveJson)}`);
  assert(archiveJson.accessRevoked === true, "expected accessRevoked to be true");
  assert(archiveJson.status === "completed", `expected 'completed' now that access was revoked, got '${archiveJson.status}'`);

  console.log("--- revoking access twice is rejected (409) ---");
  const archiveAgain = await fetch(`${BASE}/requests/${requestId}/revoke-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${itArchiveToken}` },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  });
  assert(archiveAgain.status === 409, "expected 409 for double revoke-access");

  console.log("--- a plain reviewer's list/detail is redacted to their own department only ---");
  const securityDetail = await fetch(`${BASE}/requests/${requestId}`, { headers: { Authorization: `Bearer ${securityToken}` } });
  const securityJson = await securityDetail.json();
  assert(securityJson.departments.length === 1, "expected exactly one department in a plain reviewer's view");
  assert(securityJson.departments[0].departmentKey === "security", "expected only the reviewer's own department");

  console.log("--- oversight reviewer (finance) can fetch the composited PDF ---");
  const pdfAsOversight = await fetch(`${BASE}/requests/${requestId}/pdf`, { headers: { Authorization: `Bearer ${financeToken}` } });
  assert(pdfAsOversight.status === 200, "expected 200 fetching PDF as oversight reviewer");
  assert(pdfAsOversight.headers.get("content-type") === "application/pdf", "expected application/pdf content type");

  console.log("--- any File Management account can fetch a completed request's PDF ---");
  const pdfAsFileMgmt = await fetch(`${BASE}/requests/${requestId}/pdf`, { headers: { Authorization: `Bearer ${fileMgmtToken}` } });
  assert(pdfAsFileMgmt.status === 200, "expected 200 fetching a completed PDF as File Management");

  console.log("--- a plain (non-oversight) reviewer cannot fetch the PDF (403) ---");
  const pdfAsPlain = await fetch(`${BASE}/requests/${requestId}/pdf`, { headers: { Authorization: `Bearer ${securityToken}` } });
  assert(pdfAsPlain.status === 403, "expected 403 fetching PDF as a plain reviewer");

  console.log("--- password reset: IT issues a one-time password to a forgetful account ---");
  await register({
    slug: "reset-target",
    fullName: "Reset Target Reviewer",
    role: "reviewer",
    departmentKey: "illicit_gains",
  });
  const resetTargetEmail = `reset-target.${RUN_ID}@smoketest.local`;

  console.log("--- a non-IT reviewer cannot reset anyone's password (403) ---");
  const nonItReset = await fetch(`${BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${illicitGains1Token}` },
    body: JSON.stringify({ userID: resetTargetEmail, password: DEMO_PASSWORD }),
  });
  assert(nonItReset.status === 403, "expected 403 for a non-IT reviewer calling reset-password");

  console.log("--- IT re-authenticating with the WRONG own password is rejected (401) ---");
  const wrongOwnPasswordReset = await fetch(`${BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${phoneToken}` },
    body: JSON.stringify({ userID: resetTargetEmail, password: "TotallyWrong!123" }),
  });
  assert(wrongOwnPasswordReset.status === 401, "expected 401 for IT re-authenticating with the wrong password");

  console.log("--- resetting a nonexistent account is rejected (404) ---");
  const missingAccountReset = await fetch(`${BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${phoneToken}` },
    body: JSON.stringify({ userID: `nobody.${RUN_ID}@smoketest.local`, password: DEMO_PASSWORD }),
  });
  assert(missingAccountReset.status === 404, "expected 404 resetting a nonexistent account");

  // Same route/logic regardless of the target's role or department -- IT
  // resetting another IT reviewer isn't exercised separately since it's the
  // identical code path, and every IT item is already permanently owned by a
  // demo account (no spare item to register a throwaway IT account against).
  console.log("--- IT issues the reset target a one-time password ---");
  const resetRes = await fetch(`${BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${phoneToken}` },
    body: JSON.stringify({ userID: resetTargetEmail, password: DEMO_PASSWORD }),
  });
  const resetJson = await resetRes.json();
  if (resetRes.status !== 200) throw new Error(`reset-password failed: ${JSON.stringify(resetJson)}`);
  assert(
    typeof resetJson.oneTimePassword === "string" && resetJson.oneTimePassword.length >= 12,
    "expected a one-time password string back"
  );

  console.log("--- the account's original password no longer works ---");
  const oldPasswordLogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: resetTargetEmail, password: PASSWORD }),
  });
  assert(oldPasswordLogin.status === 401, "expected the account's original password to stop working after a reset");

  console.log("--- logging in with the one-time password succeeds, flagged mustResetPassword ---");
  const otpLoginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: resetTargetEmail, password: resetJson.oneTimePassword }),
  });
  const otpLoginJson = await otpLoginRes.json();
  if (otpLoginRes.status !== 200) throw new Error(`one-time-password login failed: ${JSON.stringify(otpLoginJson)}`);
  assert(otpLoginJson.user.mustResetPassword === true, "expected mustResetPassword=true right after a one-time-password login");
  const otpToken = otpLoginJson.token;

  console.log("--- a mustResetPassword token can't reach any other route (403) ---");
  const blockedRoute = await fetch(`${BASE}/requests`, { headers: { Authorization: `Bearer ${otpToken}` } });
  const blockedJson = await blockedRoute.json();
  assert(blockedRoute.status === 403, "expected 403 hitting a protected route with a mustResetPassword token");
  assert(blockedJson.code === "PASSWORD_RESET_REQUIRED", "expected the PASSWORD_RESET_REQUIRED error code");

  console.log("--- set-new-password with the WRONG one-time password is rejected (401) ---");
  const wrongOtp = await fetch(`${BASE}/auth/set-new-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${otpToken}` },
    body: JSON.stringify({ currentPassword: "NotTheRealOtp!123", newPassword: "AnotherStr0ngPassword!" }),
  });
  assert(wrongOtp.status === 401, "expected 401 setting a new password with the wrong one-time password");

  console.log("--- set-new-password rejects a weak new password (400) ---");
  const weakNewPassword = await fetch(`${BASE}/auth/set-new-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${otpToken}` },
    body: JSON.stringify({ currentPassword: resetJson.oneTimePassword, newPassword: "short" }),
  });
  assert(weakNewPassword.status === 400, "expected 400 setting a weak new password");

  console.log("--- set-new-password succeeds and clears mustResetPassword ---");
  const newPassword = "Br4ndNewPassword!";
  const setNewPasswordRes = await fetch(`${BASE}/auth/set-new-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${otpToken}` },
    body: JSON.stringify({ currentPassword: resetJson.oneTimePassword, newPassword }),
  });
  const setNewPasswordJson = await setNewPasswordRes.json();
  if (setNewPasswordRes.status !== 200) throw new Error(`set-new-password failed: ${JSON.stringify(setNewPasswordJson)}`);
  assert(setNewPasswordJson.user.mustResetPassword === false, "expected mustResetPassword=false after setting a new password");

  console.log("--- the fresh post-reset token works normally, and the new password logs in going forward ---");
  const unblockedRoute = await fetch(`${BASE}/requests`, { headers: { Authorization: `Bearer ${setNewPasswordJson.token}` } });
  assert(unblockedRoute.status === 200, "expected 200 hitting a protected route with the fresh post-reset token");
  const relogin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: resetTargetEmail, password: newPassword }),
  });
  assert(relogin.status === 200, "expected the newly-set password to work for a fresh login");

  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err.message);
  process.exit(1);
});
