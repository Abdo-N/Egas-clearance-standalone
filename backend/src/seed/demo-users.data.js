const DEMO_PASSWORD = "DemoPassw0rd!";

const nonItReviewers = [
  ["illicit_gains", "Illicit Gains", "الكسب غير مشروع"],
  ["library", "Library", "المكتبة"],
  ["security", "Security", "الأمن"],
  ["legal", "Legal Affairs", "الشئون القانونية"],
  ["medical", "Medical & Treatment Affairs", "الشئون الطبية والعلاجية"],
  ["healthcare_accounts", "Healthcare Accounts", "حسابات الرعاية الصحية"],
  ["hr_development", "HR Development", "تنمية الموارد البشرية"],
  ["public_relations", "Public Relations & Social Services", "العلاقات العامة والخدمات الاجتماعية"],
  ["warehouses", "Warehouses", "المخازن"],
  ["transport", "Transportation Services", "خدمات النقل"],
  ["wages", "Wages & Entitlements", "الأجور والاستحقاقات"],
  ["finance", "Financial Affairs", "الشئون المالية"],
].map(([departmentKey, departmentName, departmentName_ar], index) => ({
  userID: `${departmentKey}@demo.local`,
  password: DEMO_PASSWORD,
  fullName: `${departmentName} Demo Reviewer`,
  fullName_ar: `مراجع تجريبي — ${departmentName_ar}`,
  role: "reviewer",
  departmentKey,
  assignedItemKey: null,
  landlineNumber: `10${String(index + 1).padStart(2, "0")}`,
}));

// IT is the only itemized department. The application requires a distinct
// account for each checklist item so every seeded signature has a real owner
// who could sign/reopen that item through the UI.
const itReviewers = [
  ["mobile_data_lines", "Mobile & Data Lines", "خط المحمول والداتا"],
  ["phone", "Phone", "الهاتف"],
  ["pc_account_mailbox", "PC, Account & Mailbox", "الكمبيوتر والحساب والبريد"],
  ["sap_service", "SAP Services", "خدمات SAP"],
  ["sap_account_removal", "SAP Account Removal", "إزالة حساب SAP"],
].map(([assignedItemKey, itemName, itemName_ar], index) => ({
  userID: `it.${assignedItemKey}@demo.local`,
  password: DEMO_PASSWORD,
  fullName: `IT Demo Reviewer — ${itemName}`,
  fullName_ar: `مراجع تكنولوجيا المعلومات التجريبي — ${itemName_ar}`,
  role: "reviewer",
  departmentKey: "it",
  assignedItemKey,
  landlineNumber: `11${String(index + 1).padStart(2, "0")}`,
}));

const demoUsers = [
  {
    userID: "superadmin@demo.local",
    password: DEMO_PASSWORD,
    fullName: "Super Admin Demo Account",
    fullName_ar: "حساب المسؤول الرئيسي التجريبي",
    role: "super_admin",
    departmentKey: null,
    assignedItemKey: null,
    landlineNumber: "2",
  },
  {
    userID: "admin@demo.local",
    password: DEMO_PASSWORD,
    fullName: "Admin Demo Account",
    fullName_ar: "حساب المسؤول التجريبي",
    role: "admin",
    departmentKey: null,
    assignedItemKey: null,
    landlineNumber: "1",
  },
  {
    userID: "file.management@demo.local",
    password: DEMO_PASSWORD,
    fullName: "Document and Records Management Demo",
    fullName_ar: "مسؤول إدارة الوثائق و السجلات التجريبي",
    role: "file_management",
    departmentKey: null,
    assignedItemKey: null,
    landlineNumber: "1000",
  },
  ...nonItReviewers,
  ...itReviewers,
];

module.exports = { DEMO_PASSWORD, demoUsers };
