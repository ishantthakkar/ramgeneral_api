const User = require('../models/User');

const ALLOWED_ROLES = ['sales_person', 'contractor', 'project_manager'];

exports.createUser = async (req, res) => {
    try {
        const { id, fullName, company, email, mobileNumber, userRole, status } = req.body;

        if (!fullName || !company || !email || !mobileNumber || !userRole || !status) {
            return res.status(400).json({ message: 'All user fields are required.' });
        }

        if (id) {
            const existingUserWithEmail = await User.findOne({
                email: email.toLowerCase(),
                _id: { $ne: id },
            });

            if (existingUserWithEmail) {
                return res.status(400).json({ message: 'Another user with this email already exists.' });
            }

            const updatedUser = await User.findByIdAndUpdate(
                id,
                {
                    fullName,
                    company,
                    email: email.toLowerCase(),
                    mobileNumber,
                    userRole,
                    status,
                },
                { new: true, runValidators: true }
            );

            if (!updatedUser) {
                return res.status(404).json({ message: 'User not found.' });
            }

            return res.status(200).json({ user: updatedUser, message: 'User updated successfully.' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(200).json({ message: 'User with this email already exists.' });
        }

        const newUser = await User.create({
            fullName,
            company,
            email: email.toLowerCase(),
            mobileNumber,
            userRole,
            status,
        });

        return res.status(201).json({ user: newUser, message: 'User created successfully.' });
    } catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ message: 'Server error creating user.' });
    }
};

exports.getUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id).lean(); // use lean() for plain object

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        let roleMetrics = {};

        if (user.userRole === 'contractor') {
            roleMetrics = {
                assignedProjects: 0,
                completedInstallations: 0,
                pendingInstallations: 0
            };
        }

        if (user.userRole === 'sales_person') {
            roleMetrics = {
                activeLeads: 0,
                customers: 0,
                closedLeads: 0
            };
        }

        if (user.userRole === 'project_manager') {
            roleMetrics = {
                pendingInspections: 0,
                completedInspections: 0
            };
        }

        // Merge user + roleMetrics
        const response = {
            ...user,
            ...roleMetrics
        };

        return res.status(200).json(response);

    } catch (error) {
        console.error('Get user error:', error);
        return res.status(500).json({ message: 'Server error fetching user.' });
    }
};

exports.listUsers = async (req, res) => {
    try {
        const { userRole } = req.query;
        const filter = {};

        if (userRole) {
            if (!ALLOWED_ROLES.includes(userRole)) {
                return res.status(400).json({
                    message: `Invalid userRole. Allowed values: ${ALLOWED_ROLES.join(', ')}`,
                });
            }
            filter.userRole = userRole;
        }

        const users = await User.find(filter).sort({ createdAt: -1 }).lean();

        // Add role-based metrics to each user
        const usersWithMetrics = users.map(user => {
            let roleMetrics = {};

            if (user.userRole === 'contractor') {
                roleMetrics = {
                    assignedProjects: 0,
                    completedInstallations: 0,
                    pendingInstallations: 0
                };
            }

            if (user.userRole === 'sales_person') {
                roleMetrics = {
                    activeLeads: 0,
                    customers: 0,
                    closedLeads: 0
                };
            }

            if (user.userRole === 'project_manager') {
                roleMetrics = {
                    pendingInspections: 0,
                    completedInspections: 0
                };
            }

            return {
                ...user,
                ...roleMetrics
            };
        });

        const counts = {
            total_users: await User.countDocuments(),
            total_sales_persons: await User.countDocuments({ userRole: 'sales_person' }),
            total_contractors: await User.countDocuments({ userRole: 'contractor' }),
            total_project_managers: await User.countDocuments({ userRole: 'project_manager' }),
        };

        return res.status(200).json({ users: usersWithMetrics, counts });

    } catch (error) {
        console.error('List users error:', error);
        return res.status(500).json({ message: 'Server error listing users.' });
    }
};
