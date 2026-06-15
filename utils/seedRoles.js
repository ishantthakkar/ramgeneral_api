const Role = require('../models/Role');
const { SYSTEM_ROLES } = require('../constants/systemRoles');
const { buildFullPermissions } = require('../constants/roleModules');

async function seedSystemRoles() {
  for (const roleConfig of SYSTEM_ROLES) {
    const permissions =
      roleConfig.roleName === 'Admin'
        ? buildFullPermissions()
        : roleConfig.permissions;

    await Role.findOneAndUpdate(
      { roleName: roleConfig.roleName },
      {
        roleName: roleConfig.roleName,
        notes: roleConfig.notes,
        permissions,
        isSystemRole: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

module.exports = { seedSystemRoles };
