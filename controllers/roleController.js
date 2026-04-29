const Role = require('../models/Role');

exports.createRole = async (req, res) => {
  try {
    const { roleName, permissions, notes } = req.body;

    if (!roleName) {
      return res.status(400).json({ message: 'roleName is required.' });
    }

    const role = await Role.findOneAndUpdate(
      { roleName },
      { roleName, permissions, notes },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      message: 'Role saved successfully.',
      role
    });
  } catch (error) {
    console.error('Save role error:', error);
    return res.status(500).json({ message: 'Server error saving role.' });
  }
};

exports.listRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ createdAt: -1 });
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

exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { roleName, permissions, notes } = req.body;

    const role = await Role.findByIdAndUpdate(
      id,
      { roleName, permissions, notes },
      { new: true, runValidators: true }
    );

    if (!role) {
      return res.status(404).json({ message: 'Role not found.' });
    }

    return res.status(200).json({ message: 'Role updated successfully.', role });
  } catch (error) {
    console.error('Update role error:', error);
    return res.status(500).json({ message: 'Server error updating role.' });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findByIdAndDelete(id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found.' });
    }
    return res.status(200).json({ message: 'Role deleted successfully.' });
  } catch (error) {
    console.error('Delete role error:', error);
    return res.status(500).json({ message: 'Server error deleting role.' });
  }
};
