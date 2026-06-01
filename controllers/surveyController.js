const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Survey = require('../models/Survey');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Product = require('../models/Product');
const { createLog } = require('../utils/logger');
const {
    resolveProductCategory,
    getElectricCompanyForCustomer,
    toProductObjectId,
    validateAreaProducts,
    enrichAreasWithProducts,
} = require('../utils/surveyProductUtils');
const UPLOAD_DIR = path.join(__dirname, '../uploads/surveys');
const COMPRESS_THRESHOLD = 800 * 1024;
const SURVEY_IMAGE_BASE = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

const tryParseJson = (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
};

const toSurveyImageUrl = (filename) =>
    `${SURVEY_IMAGE_BASE}/uploads/surveys/${filename}`;

const mapSurveyImageUrls = (surveyObj) => {
    surveyObj.areas = (surveyObj.areas || []).map((area) => ({
        ...area,
        images: (area.images || []).map(toSurveyImageUrl),
    }));
    surveyObj.verifyImages = (surveyObj.verifyImages || []).map(toSurveyImageUrl);
    return surveyObj;
};

const formatSurveyResponse = async (surveyObj) => {
    mapSurveyImageUrls(surveyObj);
    surveyObj.areas = await enrichAreasWithProducts(surveyObj.areas || []);
    return surveyObj;
};

const parseAreasInput = (areas) => {
    if (areas === undefined || areas === null || areas === '') return [];
    const parsed = tryParseJson(areas);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item) => ({
        product_id: toProductObjectId(item?.product_id ?? item?.productId),
        heightFt: (item?.heightFt ?? item?.height_ft ?? '').toString().trim(),
        heightIn: (item?.heightIn ?? item?.height_in ?? '').toString().trim(),
        existingBulbs: (item?.existingBulbs ?? item?.existing_bulbs ?? '').toString().trim(),
        existingQty: (
            item?.existingQty ??
            item?.existing_qty ??
            item?.existingQuantity ??
            item?.qty ??
            ''
        )
            .toString()
            .trim(),
        proposedQty: (item?.proposedQty ?? item?.proposed_qty ?? item?.proposedQuantity ?? '')
            .toString()
            .trim(),
        price: item?.price !== undefined && item?.price !== null ? String(item.price).trim() : '',
        images: [],
    }));
};

const validateAreasForCustomer = async (areas, customerId) => {
    if (!areas?.length || !customerId) return { valid: true };
    const electricCompany = await getElectricCompanyForCustomer(customerId);
    const category = resolveProductCategory(electricCompany);
    return validateAreaProducts(areas, category);
};

const buildAreasWithImages = async (areasInput, files) => {
    const areas = parseAreasInput(areasInput);
    if (areas === null) return null;

    const filesByField = {};
    for (const file of files || []) {
        if (/^area_images_\d+$/.test(file.fieldname)) {
            if (!filesByField[file.fieldname]) filesByField[file.fieldname] = [];
            filesByField[file.fieldname].push(file);
        }
    }

    for (let i = 0; i < areas.length; i++) {
        const fieldFiles = filesByField[`area_images_${i}`] || [];
        areas[i].images = await processUploadedImages(fieldFiles);
    }

    return areas;
};

const ensureUploadDir = async () => {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
};

const compressImage = async (filePath, mimetype) => {
    const ext = path.extname(filePath).toLowerCase();
    const format = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg';
    const image = sharp(filePath).resize({ width: 1920, withoutEnlargement: true });

    if (format === 'png') {
        await image.png({ compressionLevel: 8 }).toFile(filePath + '.tmp');
    } else if (format === 'webp') {
        await image.webp({ quality: 80 }).toFile(filePath + '.tmp');
    } else {
        await image.jpeg({ quality: 80 }).toFile(filePath + '.tmp');
    }

    await fs.promises.rename(filePath + '.tmp', filePath);
};

const processUploadedImages = async (files) => {
    if (!files || !Array.isArray(files)) return [];
    await ensureUploadDir();

    const imageNames = [];
    for (const file of files) {
        const saveName = path.basename(file.path);
        if (file.size > COMPRESS_THRESHOLD) {
            try {
                await compressImage(file.path, file.mimetype);
            } catch (error) {
                console.error('Image compression failed:', error);
            }
        }
        imageNames.push(saveName);
    }

    return imageNames;
};

exports.createSurvey = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { id, customer_id, areaName, note, notes, status, surveyDate, areas, markAsCompleted, MarkasCompleted } = req.body;
        const completionFlag = markAsCompleted !== undefined ? markAsCompleted : MarkasCompleted !== undefined ? MarkasCompleted : false;

        const user = await User.findById(user_id);
        if (!user) {
            return res.status(401).json({ message: 'Invalid authenticated user.' });
        }

        const processedAreas = areas !== undefined ? await buildAreasWithImages(areas, req.files) : null;
        if (processedAreas === null && areas !== undefined && areas !== '') {
            return res.status(400).json({
                message: 'Invalid areas. Send a JSON array with product_id, heightFt, heightIn, existingBulbs, etc.',
            });
        }

        if (id) {
            // Update existing record
            let survey = await Survey.findById(id);
            if (!survey) {
                return res.status(404).json({ message: 'Survey not found.' });
            }

            if (processedAreas !== null) {
                const areaValidation = await validateAreasForCustomer(
                    processedAreas,
                    customer_id || survey.customer_id
                );
                if (!areaValidation.valid) {
                    return res.status(400).json({ message: areaValidation.message });
                }
            }

            const updateData = {
                status: status || survey.status,
                areaName: areaName !== undefined ? areaName : survey.areaName,
                note: note !== undefined ? note : survey.note,
                notes: notes !== undefined ? notes : survey.notes,
                surveyDate: surveyDate ? new Date(surveyDate) : survey.surveyDate,
                markAsCompleted: completionFlag,
            };

            if (customer_id) updateData.customer_id = customer_id;

            if (processedAreas !== null) {
                updateData.areas = processedAreas;
            }

            survey = await Survey.findByIdAndUpdate(id, updateData, { new: true });

            const customer = await Customer.findById(survey.customer_id);
            await createLog('Survey Updated', user_id, customer?.name || 'Unknown', 'Survey', survey._id);

            const surveyResponse = await formatSurveyResponse(survey.toObject());

            return res.status(200).json({ survey: surveyResponse, message: 'Survey updated successfully.' });
        } else {
            // Create new record
            if (!customer_id) {
                return res.status(400).json({ message: 'customer_id is required.' });
            }

            const customer = await Customer.findById(customer_id);
            if (!customer) {
                return res.status(404).json({ message: 'Customer not found.' });
            }

            if (processedAreas !== null) {
                const areaValidation = await validateAreasForCustomer(processedAreas, customer_id);
                if (!areaValidation.valid) {
                    return res.status(400).json({ message: areaValidation.message });
                }
            }

            const survey = await Survey.create({
                customer_id,
                user_id,
                areaName: areaName || '',
                note: note || '',
                areas: processedAreas !== null ? processedAreas : [],
                status: status || 'Draft',
                notes: notes || '',
                surveyDate: surveyDate ? new Date(surveyDate) : undefined,
                markAsCompleted: completionFlag,
            });

            await createLog('Survey Created', user_id, customer.name, 'Survey', survey._id);

            const surveyResponse = await formatSurveyResponse(survey.toObject());

            return res.status(201).json({ survey: surveyResponse, message: 'Survey stored successfully.' });
        }
    } catch (error) {
        console.error('Process survey error:', error);
        return res.status(500).json({ message: 'Server error processing survey.' });
    }
};

exports.getSurveyProducts = async (req, res) => {
    try {
        const { customer_id } = req.query;

        if (!customer_id) {
            return res.status(400).json({ message: 'customer_id is required.' });
        }

        const customer = await Customer.findById(customer_id);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        const electricCompany = await getElectricCompanyForCustomer(customer_id);
        const category = resolveProductCategory(electricCompany);

        if (!category) {
            return res.status(200).json({
                electricCompany: electricCompany || '',
                category: null,
                products: [],
                message:
                    'Lead electric company does not match a product category. Use one of: PSE&G, JCP&L, ATLANTIC CITY ENERGY.',
            });
        }

        const products = await Product.find({ category }).sort({ name: 1 }).lean();

        return res.status(200).json({
            electricCompany,
            category,
            products,
        });
    } catch (error) {
        console.error('Get survey products error:', error);
        return res.status(500).json({ message: 'Server error fetching survey products.' });
    }
};

exports.listSurveys = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { customer_id, status } = req.query;
        const filter = {};

        if (customer_id) filter.customer_id = customer_id;
        if (status) filter.status = status;

        // Get user to check role
        const user = await User.findById(user_id);
        if (!user) {
            return res.status(401).json({ message: 'Invalid authenticated user.' });
        }

        // If contractor or project manager, include assigned surveys
        if (user.userRole === 'contractor' || user.userRole === 'project manager') {
            filter.$or = [
                { user_id: user_id }, // surveys created by user
                { assignedTo: user_id } // surveys assigned to user
            ];
        } else {
            // For other roles, only show surveys created by them
            filter.user_id = user_id;
        }

        const surveys = await Survey.find(filter).sort({ createdAt: -1 }).populate('assignedTo', 'fullName email');
        const surveysResponse = await Promise.all(
            surveys.map((survey) => formatSurveyResponse(survey.toObject()))
        );
        return res.status(200).json({ surveys: surveysResponse });
    } catch (error) {
        console.error('List surveys error:', error);
        return res.status(500).json({ message: 'Server error listing surveys.' });
    }
};

exports.listAssignedSurveys = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { customer_id, status } = req.query;

        // Get user to check role
        const user = await User.findById(user_id);
        if (!user) {
            return res.status(401).json({ message: 'Invalid authenticated user.' });
        }

        // Only allow contractors and project managers to access this endpoint
        if (user.userRole !== 'contractor' && user.userRole !== 'Project Manager') {
            return res.status(403).json({ message: 'Access denied. Only contractors and project managers can view assigned surveys.' });
        }

        const filter = { assignedTo: user_id };

        if (customer_id) filter.customer_id = customer_id;
        if (status) filter.status = status;

        const surveys = await Survey.find(filter)
            .sort({ createdAt: -1 })
            .populate('customer_id', 'name company mobileNumber email')
            .populate('user_id', 'fullName email')
            .populate('assignedTo', 'fullName email');

        const surveysResponse = await Promise.all(
            surveys.map((survey) => formatSurveyResponse(survey.toObject()))
        );

        return res.status(200).json({
            message: 'Assigned surveys retrieved successfully.',
            total: surveysResponse.length,
            surveys: surveysResponse
        });
    } catch (error) {
        console.error('List assigned surveys error:', error);
        return res.status(500).json({ message: 'Server error listing assigned surveys.' });
    }
};

exports.getSurvey = async (req, res) => {
    try {
        const { id } = req.params;
        const survey = await Survey.findById(id);
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }
        const surveyResponse = await formatSurveyResponse(survey.toObject());
        return res.status(200).json({ survey: surveyResponse });
    } catch (error) {
        console.error('Get survey error:', error);
        return res.status(500).json({ message: 'Server error fetching survey.' });
    }
};

exports.updateSurvey = async (req, res) => {
    try {
        const { id } = req.params;
        const { areaName, note, notes, status, surveyDate, markAsCompleted, MarkasCompleted } = req.body;
        const updateData = {};

        if (areaName !== undefined) updateData.areaName = areaName;
        if (note !== undefined) updateData.note = note;
        if (notes !== undefined) updateData.notes = notes;
        if (status) updateData.status = status;
        if (surveyDate) updateData.surveyDate = new Date(surveyDate);
        if (markAsCompleted !== undefined) updateData.markAsCompleted = markAsCompleted;
        if (MarkasCompleted !== undefined) updateData.markAsCompleted = MarkasCompleted;

        const updatedSurvey = await Survey.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true,
        });

        if (!updatedSurvey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        const surveyResponse = await formatSurveyResponse(updatedSurvey.toObject());

        await createLog('Survey Updated', req.user.id, (await Customer.findById(updatedSurvey.customer_id))?.name || 'Unknown', 'Survey', updatedSurvey._id);

        return res.status(200).json({ survey: surveyResponse, message: 'Survey updated successfully.' });
    } catch (error) {
        console.error('Update survey error:', error);
        return res.status(500).json({ message: 'Server error updating survey.' });
    }
};

exports.markSurveyCompleted = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { customer_id, survey_id, markAsCompleted, MarkasCompleted } = req.body;
        const completionFlag = markAsCompleted !== undefined ? markAsCompleted : MarkasCompleted !== undefined ? MarkasCompleted : false;

        if (!customer_id) {
            return res.status(400).json({ message: 'customer_id is required.' });
        }
        if (!survey_id) {
            return res.status(400).json({ message: 'survey_id is required.' });
        }

        const survey = await Survey.findOne({ _id: survey_id, customer_id });
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found for the provided customer.' });
        }

        survey.markAsCompleted = completionFlag;
        await survey.save();

        const surveyResponse = await formatSurveyResponse(survey.toObject());

        await createLog('Survey Marked Completed', user_id, (await Customer.findById(customer_id))?.name || 'Unknown', 'Survey', survey._id);

        return res.status(200).json({ survey: surveyResponse, message: 'Survey completion status updated successfully.' });
    } catch (error) {
        console.error('Mark survey completed error:', error);
        return res.status(500).json({ message: 'Server error updating survey completion status.' });
    }
};

exports.verifySurvey = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { survey_id, verifyQty, issueFound, comments } = req.body;

        if (!survey_id) {
            return res.status(400).json({ message: 'survey_id is required.' });
        }

        const survey = await Survey.findById(survey_id);
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        const verifyImageFiles = (req.files || []).filter((file) => file.fieldname === 'images');
        const newImages = await processUploadedImages(verifyImageFiles);
        if (newImages.length > 0) {
            survey.verifyImages = [...(survey.verifyImages || []), ...newImages];
        }

        survey.verifyQty = verifyQty !== undefined ? Number(verifyQty) : survey.verifyQty;
        survey.issueFound = issueFound === 'yes' ? 'yes' : 'no';
        survey.verificationComments = comments !== undefined ? comments : survey.verificationComments;

        await survey.save();

        if (survey.issueFound === 'yes' && survey.customer_id) {
            await Customer.findByIdAndUpdate(survey.customer_id, { installationStatus: 'reopen' });
        }

        const surveyResponse = await formatSurveyResponse(survey.toObject());

        await createLog('Survey Verified', user_id, (await Customer.findById(survey.customer_id))?.name || 'Unknown', 'Survey', survey._id);

        return res.status(200).json({ survey: surveyResponse, message: 'Survey verification updated successfully.' });
    } catch (error) {
        console.error('Verify survey error:', error);
        return res.status(500).json({ message: 'Server error verifying survey.' });
    }
};

exports.assignSurvey = async (req, res) => {
    try {
        const user_id = req.user.id;
        console.log(user_id);
        const admin = await Admin.findById(user_id);
        if (!admin) {
            return res.status(403).json({ message: 'Only admins can assign surveys.' });
        }

        const { id } = req.params;
        const { assignedTo } = req.body;

        if (!assignedTo) {
            return res.status(400).json({ message: 'assignedTo is required.' });
        }

        // Check if assigned user exists and has appropriate role
        const assignedUser = await User.findById(assignedTo);
        if (!assignedUser) {
            return res.status(404).json({ message: 'Assigned user not found.' });
        }

        if (assignedUser.userRole !== 'Project Manager') {
            return res.status(400).json({ message: 'Assigned user must be a project manager.' });
        }

        const customer = await Customer.findByIdAndUpdate(
            id,
            {
                assignedTo: assignedTo,
                projectManagerStatus: 'to-do'
            },
            { new: true }
        ).populate('assignedTo', 'fullName email mobileNumber');

        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        await createLog('Survey Assigned to PM', user_id, customer.name, 'Assignment', customer._id);

        return res.status(200).json({ message: 'Survey assigned successfully.' });

    } catch (error) {
        console.error('Assign survey error:', error);
        return res.status(500).json({ message: 'Server error assigning survey.' });
    }
};

exports.assignContractor = async (req, res) => {
    try {
        const user_id = req.user.id;

        // Check if user is Admin
        const admin = await Admin.findById(user_id);
        let isAuthorized = !!admin;

        if (!isAuthorized) {
            // Check if user is Project Manager
            const user = await User.findById(user_id);
            if (user && user.userRole === 'Project Manager') {
                isAuthorized = true;
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ message: 'Only admins or project managers can assign contractors.' });
        }

        const { id } = req.params; // Customer ID
        const { contractorId } = req.body;

        if (!contractorId) {
            return res.status(400).json({ message: 'contractorId is required.' });
        }

        const contractorUser = await User.findById(contractorId);
        if (!contractorUser) {
            return res.status(404).json({ message: 'Contractor user not found.' });
        }

        const customer = await Customer.findByIdAndUpdate(
            id,
            {
                assignToContractor: contractorId,
                contractorStatus: 'New'
            },
            { new: true }
        ).populate('assignToContractor', 'fullName email userRole mobileNumber');

        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        await createLog('Contractor Assigned', user_id, customer.name, 'Assignment', customer._id);

        return res.status(200).json({
            message: 'Contractor assigned successfully.',
            customer
        });
    } catch (error) {
        console.error('Assign contractor error:', error);
        return res.status(500).json({ message: 'Server error assigning contractor.' });
    }
};

exports.installation = async (req, res) => {
    try {
        const filter = { verifyStatus: 'verified' };

        const customers = await Customer.find(filter)
            .sort({ updatedAt: -1 })
            .populate('assignToContractor', 'fullName email userRole mobileNumber')
            .populate('user_id', 'fullName email')
            .populate('assignedTo', 'fullName email userRole');

        const customerSummaries = customers.map((customer) => ({
            id: customer._id,
            accountNumber: customer.accountNumber,
            name: customer.name,
            company: customer.company,
            mobileNumber: customer.mobileNumber,
            status: customer.status,
            lastActivity: customer.lastActivity,
            assignToContractor: customer.assignToContractor,
            assignedTo: customer.assignedTo,
            salesPersonName: customer.user_id?.fullName || customer.user_id?.name || '',
            contractorName: customer.assignToContractor?.fullName || '',
            installationStatus: customer.installationStatus,
        }));

        return res.status(200).json({
            message: 'Installations retrieved successfully.',
            total: customerSummaries.length,
            installations: customerSummaries,
        });
    } catch (error) {
        console.error('List installations error:', error);
        return res.status(500).json({ message: 'Server error listing installations.' });
    }
};
