const SALES_PERSON_ROLE_VARIANTS = ['sales_person', 'Sales Person'];

const isSalesPersonRole = (userRole) => SALES_PERSON_ROLE_VARIANTS.includes(userRole);

module.exports = {
  SALES_PERSON_ROLE_VARIANTS,
  isSalesPersonRole,
};
