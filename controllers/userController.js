const User = require('../models/User');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const { generateAccessToken, generateRefreshToken } = require('../utils/token');

const ALLOWED_ROLES = ['sales_person', 'contractor', 'project_manager'];
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.loginUser = async (req, res) => {
    try {
        const { mobileNumber, email, otp } = req.body;

        if ((!mobileNumber && !email) || !otp) {
            return res.status(400).json({ message: 'mobileNumber or email and otp are required.' });
        }

        const filter = { otpCode: otp };
        if (mobileNumber) filter.mobileNumber = mobileNumber;
        if (email) filter.email = email.toLowerCase();

        const user = await User.findOne(filter).populate('roleId');
        if (!user) {
            return res.status(401).json({ message: 'Invalid OTP or user details.' });
        }

        if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
            return res.status(401).json({ message: 'OTP has expired.' });
        }

        user.otpVerified = true;
        user.otpCode = '';
        user.otpExpiresAt = null;

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        user.refreshTokens.push({ token: refreshToken });
        await user.save();

        const userData = user.toObject();
        delete userData.refreshTokens;
        delete userData.otpCode;
        delete userData.otpExpiresAt;

        return res.json({
            accessToken,
            refreshToken,
            verifyToken: refreshToken,
            user: {
                ...userData,
                permissions: user.roleId ? user.roleId.permissions : {}
            },
        });
    } catch (error) {
        console.error('User login error:', error);
        return res.status(500).json({ message: 'Server error during user login.' });
    }
};

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
        const usersWithMetrics = await Promise.all(users.map(async user => {
            let roleMetrics = {};

            if (user.userRole === 'contractor') {
                const Customer = require('../models/Customer');
                roleMetrics = {
                    assignedProjects: await Customer.countDocuments({ assignToContractor: user._id }),
                    completedInstallations: await Customer.countDocuments({ assignToContractor: user._id, contractorStatus: 'completed' }),
                    pendingInstallations: await Customer.countDocuments({ assignToContractor: user._id, contractorStatus: { $ne: 'completed' } })
                };
            }

            if (user.userRole === 'sales_person') {
                roleMetrics = {
                    activeLeads: await Lead.countDocuments({ salesPerson: user.fullName, status: { $in: ['New', 'In Progress'] } }),
                    customers: await Customer.countDocuments({ salesPerson: user.fullName }),
                    closedLeads: await Lead.countDocuments({ salesPerson: user.fullName, status: 'Lost Leads' })
                };
            }

            if (user.userRole === 'project_manager') {
                const Survey = require('../models/Survey');
                roleMetrics = {
                    pendingInspections: await Survey.countDocuments({ assignedTo: user._id, status: { $ne: 'completed' } }),
                    completedInspections: await Survey.countDocuments({ assignedTo: user._id, status: 'completed' })
                };
            }

            return {
                ...user,
                ...roleMetrics
            };
        }));

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

exports.sendUserOtp = async (req, res) => {
    try {
        const { mobileNumber } = req.body;

        if (!mobileNumber) {
            return res.status(400).json({ message: 'mobileNumber is required.' });
        }

        const user = await User.findOne(mobileNumber ? { mobileNumber } : {});
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({
                message: 'User is not active. OTP cannot be sent.'
            });
        }

        const otpCode = generateOtp();
        const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

        user.otpCode = otpCode;
        user.otpExpiresAt = otpExpiresAt;
        user.otpVerified = false;
        await user.save();

        return res.json({
            message: 'OTP sent successfully.',
            otp: otpCode
        });
    } catch (error) {
        console.error('Send user OTP error:', error);
        return res.status(500).json({ message: 'Server error sending OTP.' });
    }
};

exports.verifyUserOtp = async (req, res) => {
    try {
        const { mobileNumber, email, otp } = req.body;

        if ((!mobileNumber && !email) || !otp) {
            return res.status(400).json({ message: 'mobileNumber or email and otp are required.' });
        }

        const filter = { otpCode: otp };
        if (mobileNumber) filter.mobileNumber = mobileNumber;
        if (email) filter.email = email.toLowerCase();

        const user = await User.findOne(filter).populate('roleId');
        if (!user) {
            return res.status(401).json({ message: 'Invalid OTP or user details.' });
        }

        if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
            return res.status(401).json({ message: 'OTP has expired.' });
        }

        user.otpVerified = true;
        user.otpCode = '';
        user.otpExpiresAt = null;

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        user.refreshTokens.push({ token: refreshToken });
        await user.save();

        const userData = user.toObject();
        delete userData.refreshTokens;
        delete userData.otpCode;
        delete userData.otpExpiresAt;

        return res.json({
            accessToken,
            refreshToken,
            user: {
                ...userData,
                permissions: user.roleId ? user.roleId.permissions : {}
            },
        });
    } catch (error) {
        console.error('Verify user OTP error:', error);
        return res.status(500).json({ message: 'Server error verifying OTP.' });
    }
};
