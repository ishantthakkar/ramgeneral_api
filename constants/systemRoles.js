const { buildFullPermissions, buildPermissionsFromConfig } = require('./roleModules');

const SYSTEM_ROLE_NAMES = ['Admin', 'Sales Manager', 'Project Manager'];

const SYSTEM_ROLES = [
  {
    roleName: 'Admin',
    notes: 'System role with full access to all modules.',
    permissions: buildFullPermissions(),
    isSystemRole: true,
  },
  {
    roleName: 'Sales Manager',
    notes: 'System role for sales team leadership. Permissions are customizable.',
    permissions: buildPermissionsFromConfig({
      Dashboard: { view: 1 },
      User: { view: 1, create: 1, edit: 1 },
      Products: { view: 1 },
      Leads: { view: 1, create: 1, edit: 1 },
      Customers: { view: 1, edit: 1 },
      Surveys: { view: 1, create: 1, edit: 1 },
      Installation: { view: 1, edit: 1 },
      Inspection: { view: 1, edit: 1 },
      Services: { view: 1 },
      Payables: { view: 1, edit: 1 },
      Invoices: { view: 1 },
      Audit: { view: 1 },
    }),
    isSystemRole: true,
  },
  {
    roleName: 'Project Manager',
    notes: 'System role for project operations. Permissions are customizable.',
    permissions: buildPermissionsFromConfig({
      Dashboard: { view: 1 },
      User: { view: 1 },
      Products: { view: 1 },
      Leads: { view: 1 },
      Customers: { view: 1, edit: 1 },
      Surveys: { view: 1, create: 1, edit: 1 },
      Installation: { view: 1, create: 1, edit: 1 },
      Inspection: { view: 1, create: 1, edit: 1 },
      Services: { view: 1, edit: 1 },
      Payables: { view: 1 },
      Invoices: { view: 1 },
    }),
    isSystemRole: true,
  },
];

module.exports = {
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLES,
  buildFullPermissions,
};
