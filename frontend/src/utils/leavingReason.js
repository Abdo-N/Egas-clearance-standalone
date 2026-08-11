// Maps the ClearanceRequest.reason enum (see
// backend/src/models/ClearanceRequest.js) to its i18n key under "employee.*".
// Order matches the list HR provided (2026-08-11), with "new_job" kept in
// its existing spot next to the conceptually related sister-company transfer.
export const REASONS = [
  "death",
  "retirement",
  "early_retirement",
  "dismissal",
  "resignation",
  "secondment_end",
  "delegation_end",
  "assignment_end",
  "sister_company_transfer",
  "new_job",
  "driver_contract_end",
  "fixed_term_contract_end",
  "comprehensive_bonus_contract_end",
];

const I18N_KEYS = {
  death: "reasonDeath",
  retirement: "reasonRetirement",
  early_retirement: "reasonEarlyRetirement",
  dismissal: "reasonDismissal",
  resignation: "reasonResignation",
  secondment_end: "reasonSecondmentEnd",
  delegation_end: "reasonDelegationEnd",
  assignment_end: "reasonAssignmentEnd",
  sister_company_transfer: "reasonSisterCompanyTransfer",
  new_job: "reasonNewJob",
  driver_contract_end: "reasonDriverContractEnd",
  fixed_term_contract_end: "reasonFixedTermContractEnd",
  comprehensive_bonus_contract_end: "reasonComprehensiveBonusContractEnd",
};

export function reasonI18nKey(reason) {
  return I18N_KEYS[reason] || "reasonResignation";
}
