const Role = require('../models/Role');
const { buildFullPermissions } = require('../constants/roleModules');
const { SYSTEM_ROLE_NAMES } = require('../constants/systemRoles');

exports.createRole = async (req, res) => {
  try {
    const { id, roleName, permissions, notes } = req.body;

    if (!roleName) {
      return res.status(400).json({ message: 'roleName is required.' });
    }

    if (id) {
      const existingRole = await Role.findById(id);
      if (!existingRole) {
        return res.status(404).json({ message: 'Role not found.' });
      }

      if (existingRole.isSystemRole) {
        const duplicateName = await Role.findOne({ roleName, _id: { $ne: id } });
        if (duplicateName) {
          return res.status(400).json({ message: 'Role name already exists.' });
        }

        const resolvedPermissions =
          existingRole.roleName === 'Admin' ? buildFullPermissions() : permissions;

        const role = await Role.findByIdAndUpdate(
          id,
          {
            roleName: existingRole.roleName,
            permissions: resolvedPermissions,
            notes,
          },
          { new: true, runValidators: true }
        );

        return res.status(200).json({ message: 'Role updated successfully.', role });
      }

      const duplicateName = await Role.findOne({ roleName, _id: { $ne: id } });
      if (duplicateName) {
        return res.status(400).json({ message: 'Role name already exists.' });
      }

      if (SYSTEM_ROLE_NAMES.some((name) => name.toLowerCase() === roleName.trim().toLowerCase())) {
        return res.status(400).json({ message: 'This role name is reserved for a system role.' });
      }

      const role = await Role.findByIdAndUpdate(
        id,
        { roleName, permissions, notes },
        { new: true, runValidators: true }
      );

      return res.status(200).json({ message: 'Role updated successfully.', role });
    }

    const existingRole = await Role.findOne({ roleName });
    if (existingRole) {
      return res.status(400).json({ message: 'Role name already exists.' });
    }

    if (SYSTEM_ROLE_NAMES.some((name) => name.toLowerCase() === roleName.trim().toLowerCase())) {
      return res.status(400).json({ message: 'This role name is reserved for a system role.' });
    }

    const role = await Role.create({ roleName, permissions, notes, isSystemRole: false });

    return res.status(201).json({
      message: 'Role created successfully.',
      role,
    });
  } catch (error) {
    console.error('Save role error:', error);
    return res.status(500).json({ message: 'Server error saving role.' });
  }
};

exports.listRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ isSystemRole: -1, createdAt: -1 });
    return res.status(200).json({ roles });
  } catch (error) {
    console.error('List roles error:', error);
    return res.status(500).json({ message: 'Server error listing roles.' });
  }
};

exports.getRole = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found.' });
    }
    return res.status(200).json({ role });
  } catch (error) {
    console.error('Get role error:', error);
    return res.status(500).json({ message: 'Server error fetching role.' });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found.' });
    }

    if (role.isSystemRole) {
      return res.status(400).json({ message: 'System roles cannot be deleted.' });
    }

    await Role.findByIdAndDelete(id);
    return res.status(200).json({ message: 'Role deleted successfully.' });
  } catch (error) {
    console.error('Delete role error:', error);
    return res.status(500).json({ message: 'Server error deleting role.' });
  }
};
