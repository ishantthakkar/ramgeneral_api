const ROLE_MODULES = [
  { id: 'dashboard', name: 'Dashboard', allowed: ['view'] },
  { id: 'users', name: 'User', allowed: ['view', 'create', 'edit'] },
  { id: 'products', name: 'Products', allowed: ['view', 'create', 'edit'] },
  { id: 'leads', name: 'Leads', allowed: ['view', 'create', 'edit'] },
  { id: 'customers', name: 'Customers', allowed: ['view', 'create', 'edit'] },
  { id: 'surveys', name: 'Surveys', allowed: ['view', 'create', 'edit'] },
  { id: 'installation', name: 'Installation', allowed: ['view', 'create', 'edit'] },
  { id: 'inspection', name: 'Inspection', allowed: ['view', 'create', 'edit'] },
  { id: 'services', name: 'Services', allowed: ['view', 'create', 'edit'] },
  { id: 'payables', name: 'Payables', allowed: ['view', 'create', 'edit'] },
  { id: 'invoices', name: 'Invoices', allowed: ['view', 'create', 'edit'] },
  { id: 'audit', name: 'Audit', allowed: ['view'] },
];

const PERMISSION_ACTIONS = ['view', 'create', 'edit'];

function emptyPermissionSet() {
  return PERMISSION_ACTIONS.reduce((acc, action) => {
    acc[action] = 0;
    return acc;
  }, {});
}

function buildFullPermissions() {
  const permissions = {};
  ROLE_MODULES.forEach((module) => {
    permissions[module.name] = {};
    PERMISSION_ACTIONS.forEach((action) => {
      permissions[module.name][action] = module.allowed.includes(action) ? 1 : 0;
    });
  });
  return permissions;
}

function buildPermissionsFromConfig(config) {
  const permissions = {};
  ROLE_MODULES.forEach((module) => {
    const moduleConfig = config[module.name] || config[module.id] || {};
    permissions[module.name] = {};
    PERMISSION_ACTIONS.forEach((action) => {
      const allowed = module.allowed.includes(action);
      permissions[module.name][action] = allowed
        ? (moduleConfig[action] === 1 ? 1 : 0)
        : 0;
    });
  });
  return permissions;
}

module.exports = {
  ROLE_MODULES,
  PERMISSION_ACTIONS,
  emptyPermissionSet,
  buildFullPermissions,
  buildPermissionsFromConfig,
};
