const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Role = require('../models/Role');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const CustomerActivity = require('../models/CustomerActivity');
const { generateAccessToken, generateRefreshToken } = require('../utils/token');

const PROFILE_UPLOAD_DIR = path.join(__dirname, '../uploads/profiles');
const PROFILE_IMAGE_BASE = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

const toProfileImageUrl = (filename) => {
    if (!filename) return '';
    const value = String(filename).trim();
    if (!value) return '';
    if (value.startsWith('http')) return value;
    return `${PROFILE_IMAGE_BASE}/uploads/profiles/${value.replace(/^\//, '')}`;
};

const { SALES_PERSON_ROLE_VARIANTS, isSalesPersonRole: isSalesPersonRoleFromConstants } = require('../constants/userRoles');

const ROLE_VARIANTS = {
  contractor: ['contractor', 'Contractor'],
  sales_person: ['sales_person', 'Sales Person'],
  sales_manager: ['sales_manager', 'Sales Manager'],
  project_manager: ['project_manager', 'Project Manager'],
  admin: ['admin', 'Admin'],
};

const ALLOWED_ROLES = Object.values(ROLE_VARIANTS).flat();

const normalizeRoleName = (value) =>
  (value || '').toString().trim().toLowerCase().replace(/_/g, ' ');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function normalizeDayName(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isWorkingDayMatch(workingDayValue, targetDate) {
  if (workingDayValue === undefined || workingDayValue === null) return false;

  // Accept numeric day index: 0-6 (Sun-Sat)
  const dayIndexText = workingDayValue.toString().trim();
  if (/^\d$/.test(dayIndexText)) {
    const idx = Number(dayIndexText);
    return idx >= 0 && idx <= 6 && idx === targetDate.getDay();
  }

  const targetFull = normalizeDayName(DAY_NAMES[targetDate.getDay()]);
  const targetShort = targetFull.slice(0, 3); // sun, mon, tue...

  const normalized = normalizeDayName(workingDayValue);
  if (!normalized) return false;

  const normalizedShort = normalized.slice(0, 3);
  return normalized === targetFull || normalizedShort === targetShort;
}

function parseDateOnly(value) {
  if (value === undefined || value === null) return null;
  const text = value.toString().trim();
  if (!text) return null;

  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoDateMatch) {
    const y = Number(isoDateMatch[1]);
    const m = Number(isoDateMatch[2]);
    const d = Number(isoDateMatch[3]);
    const dt = new Date(y, m - 1, d);
    if (
      Number.isNaN(dt.getTime()) ||
      dt.getFullYear() !== y ||
      dt.getMonth() !== m - 1 ||
      dt.getDate() !== d
    ) {
      return null;
    }
    return dt;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveRequestedDate(dateParam) {
  if (dateParam === undefined || dateParam === null || String(dateParam).trim() === '') {
    return { date: new Date(), error: null };
  }

  const parsed = parseDateOnly(dateParam);
  if (!parsed) {
    return {
      date: null,
      error: 'Invalid date. Use YYYY-MM-DD format (e.g. 2026-06-15).',
    };
  }

  return { date: parsed, error: null };
}

function parseTimeToMinutes(value) {
  const text = (value || '').toString().trim();
  if (!text) return null;

  // Accept: "HH:mm"
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (h24) {
    const hh = Number(h24[1]);
    const mm = Number(h24[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  // Accept: "h:mm AM" or "h:mmPM"
  const h12 = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(text);
  if (h12) {
    let hh = Number(h12[1]);
    const mm = Number(h12[2]);
    const ampm = h12[3].toLowerCase();
    if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
    if (ampm === 'pm' && hh !== 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
    return hh * 60 + mm;
  }

  return null;
}

function formatMinutesToRange(startMinutes, endMinutes) {
  function toLabel(mins) {
    const hh24 = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    const ampm = hh24 >= 12 ? 'PM' : 'AM';
    let hh12 = hh24 % 12;
    if (hh12 === 0) hh12 = 12;
    const mmStr = String(mm).padStart(2, '0');
    return `${hh12}:${mmStr} ${ampm}`;
  }
  return `${toLabel(startMinutes)} - ${toLabel(endMinutes)}`;
}

const getCanonicalRole = (value) => {
  if (!value || typeof value !== 'string') return null;
  const normalized = normalizeRoleName(value);
  return (
    Object.keys(ROLE_VARIANTS).find((key) =>
      ROLE_VARIANTS[key].some((variant) => normalizeRoleName(variant) === normalized)
    ) || null
  );
};

const isContractorRole = (value) =>
  ROLE_VARIANTS.contractor.some((v) => normalizeRoleName(v) === normalizeRoleName(value));
const isSalesPersonRole = (value) =>
  ROLE_VARIANTS.sales_person.some((v) => normalizeRoleName(v) === normalizeRoleName(value));
const isSalesManagerRole = (value) =>
  ROLE_VARIANTS.sales_manager.some((v) => normalizeRoleName(v) === normalizeRoleName(value));
const isProjectManagerRole = (value) =>
  ROLE_VARIANTS.project_manager.some((v) => normalizeRoleName(v) === normalizeRoleName(value));
const isAdminRole = (value) =>
  ROLE_VARIANTS.admin.some((v) => normalizeRoleName(v) === normalizeRoleName(value));

const resolveRoleNameFromInput = async (userRole) => {
  if (mongoose.Types.ObjectId.isValid(userRole)) {
    const roleDoc = await Role.findById(userRole);
    if (roleDoc) {
      return { roleId: userRole, userRole: roleDoc.roleName };
    }
    return { roleId: userRole, userRole: String(userRole) };
  }
  return { roleId: null, userRole: String(userRole) };
};

const validateAndResolveReportsTo = async (userRoleName, reportsToId, userId = null) => {
  const role = normalizeRoleName(userRoleName);

  if (role === 'sales person') {
    if (!reportsToId || !mongoose.Types.ObjectId.isValid(reportsToId)) {
      return { error: 'Sales manager is required for sales person.' };
    }
    if (userId && reportsToId.toString() === userId.toString()) {
      return { error: 'A user cannot report to themselves.' };
    }
    const manager = await User.findById(reportsToId);
    if (!manager || !isSalesManagerRole(manager.userRole)) {
      return { error: 'Selected supervisor must be a sales manager.' };
    }
    return { reportsTo: manager._id };
  }

  if (role === 'sales manager' || role === 'project manager') {
    if (!reportsToId || !mongoose.Types.ObjectId.isValid(reportsToId)) {
      return { error: 'Admin is required for sales manager and project manager.' };
    }
    if (userId && reportsToId.toString() === userId.toString()) {
      return { error: 'A user cannot report to themselves.' };
    }
    const manager = await User.findById(reportsToId);
    if (!manager || !isAdminRole(manager.userRole)) {
      return { error: 'Selected supervisor must be an admin.' };
    }
    return { reportsTo: manager._id };
  }

  return { reportsTo: null };
};

function parseWorkingScheduleInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeWorkingScheduleEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const day = (entry.day || '').toString().trim();
  const from = (entry.from || '').toString().trim();
  const to = (entry.to || '').toString().trim();

  if (!day || !from || !to) return null;
  if (parseTimeToMinutes(from) === null || parseTimeToMinutes(to) === null) return null;

  return { day, from, to };
}

function resolveWorkingHoursForDate(user, targetDate) {
  const schedule = Array.isArray(user.workingSchedule) ? user.workingSchedule : [];

  if (schedule.length > 0) {
    const entry = schedule.find((item) => isWorkingDayMatch(item.day, targetDate));
    return {
      isWorkingDay: Boolean(entry),
      workingFrom: entry?.from || '',
      workingTo: entry?.to || '',
    };
  }

  const isWorkingDay = (user.workingDays || []).some((d) => isWorkingDayMatch(d, targetDate));
  return {
    isWorkingDay,
    workingFrom: user.workingFrom || '',
    workingTo: user.workingTo || '',
  };
}

const pickWorkingHoursFields = (body) => {
  const { workingDays, workingFrom, workingTo, workingSchedule } = body;
  const fields = {};
  const parsedSchedule = parseWorkingScheduleInput(workingSchedule);

  if (parsedSchedule) {
    const normalizedSchedule = parsedSchedule
      .map((entry) => normalizeWorkingScheduleEntry(entry))
      .filter(Boolean);

    fields.workingSchedule = normalizedSchedule;
    fields.workingDays = normalizedSchedule.map((entry) => entry.day);
    fields.workingFrom = normalizedSchedule[0]?.from || '';
    fields.workingTo = normalizedSchedule[0]?.to || '';
    return fields;
  }

  if (Array.isArray(workingDays)) {
    fields.workingDays = workingDays;
  } else if (typeof workingDays === 'string' && workingDays.trim()) {
    try {
      const parsed = JSON.parse(workingDays);
      fields.workingDays = Array.isArray(parsed) ? parsed : [workingDays];
    } catch {
      fields.workingDays = workingDays.split(',').map((d) => d.trim()).filter(Boolean);
    }
  }

  if (typeof workingFrom === 'string') fields.workingFrom = workingFrom.trim();
  if (typeof workingTo === 'string') fields.workingTo = workingTo.trim();

  return fields;
};

const formatReportsTo = (reportsTo) => {
  if (!reportsTo) return null;
  if (typeof reportsTo === 'object' && reportsTo._id) {
    return {
      _id: reportsTo._id,
      fullName: reportsTo.fullName,
      userRole: reportsTo.userRole,
      company: reportsTo.company,
      email: reportsTo.email,
      mobileNumber: reportsTo.mobileNumber,
    };
  }
  return reportsTo;
};

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

exports.getUserWorkingHours = async (req, res) => {
  try {
    const id = req.user?.id;
    const dateParam = req.query?.date ?? req.body?.date;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(401).json({ message: 'Invalid authenticated user.' });
    }

    const { date: requestedDate, error: dateError } = resolveRequestedDate(dateParam);
    if (dateError) {
      return res.status(400).json({ message: dateError });
    }

    const user = await User.findById(id)
      .select('workingDays workingFrom workingTo workingSchedule fullName')
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const dayName = DAY_NAMES[requestedDate.getDay()];
    const resolvedHours = resolveWorkingHoursForDate(user, requestedDate);
    const isWorkingDay = resolvedHours.isWorkingDay;

    const fromMinutes = parseTimeToMinutes(resolvedHours.workingFrom);
    const toMinutes = parseTimeToMinutes(resolvedHours.workingTo);

    const slot = [];
    for (let start = 0; start < 24 * 60; start += 60) {
      const end = Math.min(start + 60, 24 * 60);
      const hasWorkingWindow =
        fromMinutes !== null && toMinutes !== null && toMinutes > fromMinutes;
      const isWithinWorkingHours = hasWorkingWindow
        ? start >= fromMinutes && end <= toMinutes
        : false;

      slot.push({
        time: formatMinutesToRange(start, end),
        available: Boolean(isWorkingDay && isWithinWorkingHours),
      });
    }

    const today = formatLocalDate(new Date());

    return res.status(200).json({
      user_id: id,
      fullName: user.fullName,
      date: formatLocalDate(requestedDate),
      day: dayName,
      isWorkingDay,
      isToday: formatLocalDate(requestedDate) === today,
      workingFrom: resolvedHours.workingFrom,
      workingTo: resolvedHours.workingTo,
      workingDays: user.workingDays || [],
      workingSchedule: user.workingSchedule || [],
      slot,
    });
  } catch (error) {
    console.error('Get user working hours error:', error);
    return res.status(500).json({ message: 'Server error fetching user working hours.' });
  }
};

exports.createUser = async (req, res) => {
    try {
        const {
            id,
            fullName,
            company,
            email,
            mobileNumber,
            userRole,
            status,
            password,
            reportsToId,
        } = req.body;

        if (!fullName || !company || !mobileNumber || !userRole || !status) {
            return res.status(400).json({ message: 'All user fields are required.' });
        }

        const roleResolved = await resolveRoleNameFromInput(userRole);
        const reportsToResult = await validateAndResolveReportsTo(
            roleResolved.userRole,
            reportsToId,
            id || null
        );
        if (reportsToResult.error) {
            return res.status(400).json({ message: reportsToResult.error });
        }

        if (id) {
            if (email) {
                const existingUserWithEmail = await User.findOne({
                    email: email.toLowerCase(),
                    _id: { $ne: id },
                });

                if (existingUserWithEmail) {
                    return res.status(400).json({ message: 'Another user with this email already exists.' });
                }
            }

            const existingUserWithMobile = await User.findOne({
                mobileNumber,
                _id: { $ne: id },
            });

            if (existingUserWithMobile) {
                return res.status(400).json({ message: 'Another user with this mobile number already exists.' });
            }

            const updateData = {
                fullName,
                company,
                ...(email && { email: email.toLowerCase() }),
                mobileNumber,
                status,
                roleId: roleResolved.roleId,
                userRole: roleResolved.userRole,
                reportsTo: reportsToResult.reportsTo,
                ...pickWorkingHoursFields(req.body),
            };

            if (password) {
                const salt = await bcrypt.genSalt(10);
                updateData.password = await bcrypt.hash(password, salt);
            }

            const updatedUser = await User.findByIdAndUpdate(id, updateData, {
                new: true,
                runValidators: true,
            })
                .populate('reportsTo', 'fullName userRole company email mobileNumber')
                .select('-password -refreshTokens -otpCode -otpExpiresAt');

            if (!updatedUser) {
                return res.status(404).json({ message: 'User not found.' });
            }

            const userObj = updatedUser.toObject();
            userObj.reportsTo = formatReportsTo(userObj.reportsTo);

            return res.status(200).json({ user: userObj, message: 'User updated successfully.' });
        }

        if (email) {
            const existingUser = await User.findOne({ email: email.toLowerCase() });
            if (existingUser) {
                return res.status(400).json({ message: 'User with this email already exists.' });
            }
        }

        const existingUserMobile = await User.findOne({ mobileNumber });
        if (existingUserMobile) {
            return res.status(400).json({ message: 'User with this mobile number already exists.' });
        }

        const userData = {
            fullName,
            company,
            ...(email && { email: email.toLowerCase() }),
            mobileNumber,
            status,
            roleId: roleResolved.roleId,
            userRole: roleResolved.userRole,
            reportsTo: reportsToResult.reportsTo,
            ...pickWorkingHoursFields(req.body),
        };

        if (password) {
            const salt = await bcrypt.genSalt(10);
            userData.password = await bcrypt.hash(password, salt);
        }

        const newUser = await User.create(userData);
        const populated = await User.findById(newUser._id)
            .populate('reportsTo', 'fullName userRole company email mobileNumber')
            .select('-password -refreshTokens -otpCode -otpExpiresAt')
            .lean();

        populated.reportsTo = formatReportsTo(populated.reportsTo);

        return res.status(201).json({ user: populated, message: 'User created successfully.' });
    } catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ message: 'Server error creating user.' });
    }
};

exports.getUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id)
            .populate('reportsTo', 'fullName userRole company email mobileNumber')
            .lean();

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        delete user.password;
        delete user.refreshTokens;
        delete user.otpCode;
        delete user.otpExpiresAt;

        let roleMetrics = {};

        if (isContractorRole(user.userRole)) {
            roleMetrics = {
                assignedProjects: await Customer.countDocuments({ assignToContractor: user._id }),
                completedInstallations: await Customer.countDocuments({
                    assignToContractor: user._id,
                    installationStatus: 'completed',
                }),
                pendingInstallations: await Customer.countDocuments({
                    assignToContractor: user._id,
                    installationStatus: { $ne: 'completed' },
                }),
            };
        } else if (isSalesPersonRole(user.userRole)) {
            roleMetrics = {
                activeLeads: await Lead.countDocuments({
                    user_id: user._id,
                    status: { $in: ['New', 'In Progress'] },
                }),
                customers: await Customer.countDocuments({ user_id: user._id }),
                closedLeads: await Lead.countDocuments({ user_id: user._id, status: 'Lost Leads' }),
            };
        } else if (isProjectManagerRole(user.userRole)) {
            const Survey = require('../models/Survey');
            roleMetrics = {
                pendingInspections: await Survey.countDocuments({
                    assignedTo: user._id,
                    status: { $ne: 'completed' },
                }),
                completedInspections: await Survey.countDocuments({
                    assignedTo: user._id,
                    status: 'completed',
                }),
            };
        }

        const directReports = await User.find({ reportsTo: user._id })
            .select('fullName company email mobileNumber userRole status workingDays workingFrom workingTo workingSchedule')
            .sort({ fullName: 1 })
            .lean();

        const userPayload = {
            ...user,
            ...roleMetrics,
            reportsTo: formatReportsTo(user.reportsTo),
        };

        return res.status(200).json({
            user: userPayload,
            directReports,
        });
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
            const requestedRoleKey = getCanonicalRole(userRole);
            if (!requestedRoleKey) {
                return res.status(400).json({
                    message: `Invalid userRole. Allowed values: ${ALLOWED_ROLES.join(', ')}`,
                });
            }
            filter.userRole = { $in: ROLE_VARIANTS[requestedRoleKey] };
        }

        const users = await User.find(filter)
            .populate('reportsTo', 'fullName userRole company email mobileNumber')
            .sort({ createdAt: -1 })
            .lean();

        // Add role-based metrics to each user
        const usersWithMetrics = await Promise.all(users.map(async user => {
            let roleMetrics = {};

            if (isContractorRole(user.userRole)) {
                const Customer = require('../models/Customer');
                roleMetrics = {
                    assignedProjects: await Customer.countDocuments({ assignToContractor: user._id }),
                    completedInstallations: await Customer.countDocuments({ assignToContractor: user._id, installationStatus: 'completed' }),
                    pendingInstallations: await Customer.countDocuments({ assignToContractor: user._id, installationStatus: { $ne: 'completed' } })
                };
            } else if (isSalesPersonRole(user.userRole)) {
                const Customer = require('../models/Customer');
                roleMetrics = {
                    activeLeads: await Lead.countDocuments({
                      user_id: user._id,
                      status: { $in: ['New', 'Assigned', 'In Progress'] },
                    }),
                    customers: await Customer.countDocuments({ user_id: user._id }),
                    closedLeads: await Lead.countDocuments({ user_id: user._id, status: 'Lost Leads' })
                };
            } else if (isProjectManagerRole(user.userRole)) {
                const Survey = require('../models/Survey');
                roleMetrics = {
                    pendingInspections: await Survey.countDocuments({ assignedTo: user._id, status: { $ne: 'completed' } }),
                    completedInspections: await Survey.countDocuments({ assignedTo: user._id, status: 'completed' })
                };
            }

            return {
                ...user,
                reportsTo: formatReportsTo(user.reportsTo),
                ...roleMetrics,
            };
        }));

        const counts = {
            total_users: await User.countDocuments(),
            total_sales_persons: await User.countDocuments({ userRole: { $in: ROLE_VARIANTS.sales_person } }),
            total_contractors: await User.countDocuments({ userRole: { $in: ROLE_VARIANTS.contractor } }),
            total_project_managers: await User.countDocuments({ userRole: { $in: ROLE_VARIANTS.project_manager } }),
            total_sales_managers: await User.countDocuments({ userRole: { $in: ROLE_VARIANTS.sales_manager } }),
            total_admins: await User.countDocuments({ userRole: { $in: ROLE_VARIANTS.admin } }),
        };

        return res.status(200).json({ users: usersWithMetrics, counts });

    } catch (error) {
        console.error('List users error:', error);
        return res.status(500).json({ message: 'Server error listing users.' });
    }
};

exports.listContractors = async (req, res) => {
    try {
        const users = await User.find({ userRole: { $in: ROLE_VARIANTS.contractor } }).sort({ createdAt: -1 }).lean();

        // Add contractor-specific metrics to each user
        const usersWithMetrics = await Promise.all(users.map(async user => {
            const Customer = require('../models/Customer');
            const roleMetrics = {
                assignedProjects: await Customer.countDocuments({ assignToContractor: user._id }),
                completedInstallations: await Customer.countDocuments({ assignToContractor: user._id, installationStatus: 'completed' }),
                pendingInstallations: await Customer.countDocuments({ assignToContractor: user._id, installationStatus: { $ne: 'completed' } })
            };

            return {
                ...user,
                ...roleMetrics
            };
        }));

        return res.status(200).json({ users: usersWithMetrics });

    } catch (error) {
        console.error('List contractors error:', error);
        return res.status(500).json({ message: 'Server error listing contractors.' });
    }
};

exports.listSalesPersons = async (req, res) => {
    try {
        // Prefer roleId linkage but also match userRole string
        const role = await Role.findOne({ roleName: 'Sales Person' });

        const orClauses = [{ userRole: 'Sales Person' }];
        if (role) orClauses.push({ roleId: role._id });

        const users = await User.find({ $or: orClauses })
            .select('fullName email mobileNumber company status userRole')
            .sort({ fullName: 1 })
            .lean();

        const mapped = users.map((u) => ({
            id: u._id,
            fullName: u.fullName,
            email: u.email || '',
            mobileNumber: u.mobileNumber || '',
            company: u.company || '',
            status: u.status || '',
            userRole: u.userRole,
        }));
        return res.status(200).json({ salesPersons: mapped, users: mapped, count: mapped.length });
    } catch (error) {
        console.error('List sales persons error:', error);
        return res.status(500).json({ message: 'Server error listing sales persons.' });
    }
};

exports.uploadProfileImage = async (req, res) => {
    try {
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ message: 'Profile image file is required.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const previousImage = user.profileImage;
        const savedFilename = path.basename(req.file.path);

        user.profileImage = savedFilename;
        await user.save();

        if (previousImage && previousImage !== savedFilename) {
            const previousPath = path.join(PROFILE_UPLOAD_DIR, path.basename(previousImage));
            fs.promises.unlink(previousPath).catch(() => {});
        }

        return res.status(200).json({
            message: 'Profile image uploaded successfully.',
            profileImage: toProfileImageUrl(savedFilename),
            user: {
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                profileImage: toProfileImageUrl(savedFilename),
            },
        });
    } catch (error) {
        console.error('Upload profile image error:', error);
        return res.status(500).json({ message: 'Server error uploading profile image.' });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const id = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid user ID.' });
        }

        const user = await User.findById(id).populate('roleId').lean();

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Strip sensitive fields
        delete user.password;
        delete user.otpCode;
        delete user.otpExpiresAt;
        delete user.otpVerified;
        delete user.refreshTokens;

        let roleMetrics = {};

        if (isContractorRole(user.userRole)) {
            roleMetrics = {
                assignedProjects: await Customer.countDocuments({ assignToContractor: user._id }),
                completedInstallations: await Customer.countDocuments({ assignToContractor: user._id, installationStatus: 'completed' }),
                pendingInstallations: await Customer.countDocuments({ assignToContractor: user._id, installationStatus: { $ne: 'completed' } }),
            };
        } else if (isSalesPersonRole(user.userRole)) {
            roleMetrics = {
                allLeads: await Lead.countDocuments({ user_id: user._id }),
                activeLeads: await Lead.countDocuments({ user_id: user._id, status: { $in: ['New', 'In Progress'] } }),
                convertedCustomers: await Customer.countDocuments({ user_id: user._id }),
                lostLeads: await Lead.countDocuments({ user_id: user._id, status: 'Lost Leads' }),
            };
        } else if (isProjectManagerRole(user.userRole)) {
            const Survey = require('../models/Survey');
            roleMetrics = {
                pendingInspections: await Survey.countDocuments({ assignedTo: user._id, status: { $ne: 'completed' } }),
                completedInspections: await Survey.countDocuments({ assignedTo: user._id, status: 'completed' }),
                totalSurveys: await Survey.countDocuments({ assignedTo: user._id }),
            };
        }

        const recentActivitiesList = await CustomerActivity.find({ user_id: user._id })
            .populate('customer_id', 'fullName email mobileNumber')
            .sort({ date: -1 })
            .limit(10)
            .lean();

        const recentActivities = {};
        recentActivitiesList.forEach(activity => {
            const dateVal = activity.date || activity.createdAt;
            if (!dateVal) return;

            const d = new Date(dateVal);
            const day = d.getDate();
            const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
            const month = months[d.getMonth()];
            const dateKey = `${day} ${month}`;

            if (!recentActivities[dateKey]) {
                recentActivities[dateKey] = [];
            }
            recentActivities[dateKey].push(activity);
        });

        return res.status(200).json({
            user: {
                ...user,
                profileImage: toProfileImageUrl(user.profileImage),
                permissions: user.roleId ? user.roleId.permissions : {},
                ...roleMetrics,
            },
            recentActivities,
        });
    } catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({ message: 'Server error fetching profile.' });
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

        // const otpCode = generateOtp();
        const otpCode = '123456';
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
