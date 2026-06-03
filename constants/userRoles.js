const SALES_PERSON_ROLE_VARIANTS = ['sales_person', 'Sales Person'];
const SALES_MANAGER_ROLE_VARIANTS = ['sales_manager', 'Sales Manager'];

const normalizeRole = (userRole) =>
  (userRole || '').toString().trim().toLowerCase().replace(/_/g, ' ');

const isSalesPersonRole = (userRole) =>
  SALES_PERSON_ROLE_VARIANTS.some((v) => normalizeRole(v) === normalizeRole(userRole));

const isSalesManagerRole = (userRole) =>
  SALES_MANAGER_ROLE_VARIANTS.some((v) => normalizeRole(v) === normalizeRole(userRole));

module.exports = {
  SALES_PERSON_ROLE_VARIANTS,
  SALES_MANAGER_ROLE_VARIANTS,
  isSalesPersonRole,
  isSalesManagerRole,
};
