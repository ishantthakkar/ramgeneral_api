const PERMISSION_TABS = [
  { id: 'dashboard', name: 'Dashboard', allowed: ['view'] },
  { id: 'user', name: 'User', allowed: ['view', 'edit'] },
  { id: 'products', name: 'Products', allowed: ['view', 'edit'] },
  { id: 'leads', name: 'Leads', allowed: ['view', 'edit'] },
  { id: 'customers', name: 'Customers', allowed: ['view', 'edit'] },
  {
    id: 'workflow',
    name: 'Workflow',
    allowed: [],
    scopes: [
      { id: 'surveys', name: 'Surveys', allowed: ['view', 'edit'] },
      { id: 'quotations', name: 'Quotations', allowed: ['view', 'edit'] },
      { id: 'installation', name: 'Installation', allowed: ['view', 'edit'] },
      { id: 'inspection', name: 'Inspection', allowed: ['view', 'edit'] },
    ],
  },
  { id: 'services', name: 'Services', allowed: ['view', 'edit'] },
  {
    id: 'payables',
    name: 'Payables',
    allowed: [],
    scopes: [
      { id: 'sales_person', name: 'Sales Person', allowed: ['view', 'edit'] },
      { id: 'sales_manager', name: 'Sales Manager', allowed: ['view', 'edit'] },
      { id: 'contractor', name: 'Contractor', allowed: ['view', 'edit'] },
    ],
  },
  { id: 'invoices', name: 'Invoices', allowed: ['view', 'edit'] },
];

const PERMISSION_ACTIONS = ['view', 'edit'];

function emptyPermissionSet(allowed = PERMISSION_ACTIONS) {
  return allowed.reduce((acc, action) => {
    acc[action] = 0;
    return acc;
  }, {});
}

function toActionFlags(config = {}, allowed = PERMISSION_ACTIONS) {
  const flags = emptyPermissionSet(allowed);
  allowed.forEach((action) => {
    flags[action] = config[action] === 1 || (action === 'edit' && config.create === 1) ? 1 : 0;
  });
  return flags;
}

function buildFullPermissions() {
  const permissions = {};

  PERMISSION_TABS.forEach((tab) => {
    if (tab.scopes?.length) {
      permissions[tab.name] = {};
      tab.scopes.forEach((scope) => {
        permissions[tab.name][scope.name] = toActionFlags(
          { view: 1, edit: 1 },
          scope.allowed
        );
      });
      return;
    }

    permissions[tab.name] = toActionFlags({ view: 1, edit: 1 }, tab.allowed);
  });

  return permissions;
}

function buildPermissionsFromConfig(config) {
  const permissions = {};

  PERMISSION_TABS.forEach((tab) => {
    if (tab.scopes?.length) {
      const tabConfig = config[tab.name] || {};
      permissions[tab.name] = {};

      tab.scopes.forEach((scope) => {
        const scopeConfig =
          tabConfig[scope.name] ||
          config[scope.name] ||
          config[scope.id] ||
          {};
        permissions[tab.name][scope.name] = toActionFlags(scopeConfig, scope.allowed);
      });
      return;
    }

    const moduleConfig = config[tab.name] || config[tab.id] || {};
    permissions[tab.name] = toActionFlags(moduleConfig, tab.allowed);
  });

  return permissions;
}

/** @deprecated Use PERMISSION_TABS */
const ROLE_MODULES = PERMISSION_TABS;

module.exports = {
  PERMISSION_TABS,
  ROLE_MODULES,
  PERMISSION_ACTIONS,
  emptyPermissionSet,
  buildFullPermissions,
  buildPermissionsFromConfig,
};
