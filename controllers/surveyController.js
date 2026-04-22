const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Survey = require('../models/Survey');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Admin = require('../models/Admin');
const UPLOAD_DIR = path.join(__dirname, '../uploads/surveys');
const COMPRESS_THRESHOLD = 800 * 1024;

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
        const { customer_id, notes, status, surveyDate, area, heightInInches, existingFixtureType, otherFixtureType, existingBulbs, existingQuantity, proposedFixture, proposedQuantity, pricePerUnit, totalPrice, note } = req.body;
        if (!customer_id) {
            return res.status(400).json({ message: 'customer_id is required.' });
        }

        const customer = await Customer.findById(customer_id);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        const user = await User.findById(user_id);
        if (!user) {
            return res.status(401).json({ message: 'Invalid authenticated user.' });
        }

        const survey = await Survey.create({
            customer_id,
            user_id,
            area, // ✅ must come directly
            heightInInches,
            existingFixtureType,
            otherFixtureType,
            existingBulbs,
            existingQuantity,
            proposedFixture,
            proposedQuantity,
            pricePerUnit,
            totalPrice,
            note,
            images: await processUploadedImages(req.files),
            status: status || 'Draft',
            notes: notes || '',
        });

        // Add full image URLs to response
        const surveyResponse = survey.toObject();
        surveyResponse.images = surveyResponse.images.map(img => `https://ramgeneral-api.onrender.com/uploads/surveys/${img}`);

        return res.status(201).json({ survey: surveyResponse, message: 'Survey stored successfully.' });
    } catch (error) {
        console.error('Create survey error:', error);
        return res.status(500).json({ message: 'Server error storing survey.' });
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
        const surveysResponse = surveys.map(survey => {
            const surveyObj = survey.toObject();
            surveyObj.images = surveyObj.images.map(img => `https://ramgeneral-api.onrender.com/uploads/surveys/${img}`);
            return surveyObj;
        });
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
        if (user.userRole !== 'contractor' && user.userRole !== 'project_manager') {
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

        const surveysResponse = surveys.map(survey => {
            const surveyObj = survey.toObject();
            surveyObj.images = surveyObj.images.map(img => `https://ramgeneral-api.onrender.com/uploads/surveys/${img}`);
            return surveyObj;
        });

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
        const surveyResponse = survey.toObject();
        surveyResponse.images = surveyResponse.images.map(img => `https://ramgeneral-api.onrender.com/uploads/surveys/${img}`);
        return res.status(200).json({ survey: surveyResponse });
    } catch (error) {
        console.error('Get survey error:', error);
        return res.status(500).json({ message: 'Server error fetching survey.' });
    }
};

exports.updateSurvey = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, status, surveyDate, area, heightInInches, existingFixtureType, otherFixtureType, existingBulbs, existingQuantity, proposedFixture, proposedQuantity, pricePerUnit, totalPrice, note } = req.body;
        const updateData = {};

        if (notes !== undefined) updateData.notes = notes;
        if (status) updateData.status = status;
        if (surveyDate) updateData.surveyDate = new Date(surveyDate);
        if (area !== undefined) updateData.area = area;
        if (heightInInches !== undefined) updateData.heightInInches = heightInInches;
        if (existingFixtureType !== undefined) updateData.existingFixtureType = existingFixtureType;
        if (otherFixtureType !== undefined) updateData.otherFixtureType = otherFixtureType;
        if (existingBulbs !== undefined) updateData.existingBulbs = existingBulbs;
        if (existingQuantity !== undefined) updateData.existingQuantity = existingQuantity;
        if (proposedFixture !== undefined) updateData.proposedFixture = proposedFixture;
        if (proposedQuantity !== undefined) updateData.proposedQuantity = proposedQuantity;
        if (pricePerUnit !== undefined) updateData.pricePerUnit = pricePerUnit;
        if (totalPrice !== undefined) updateData.totalPrice = totalPrice;
        if (note !== undefined) updateData.note = note;

        const updatedSurvey = await Survey.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true,
        });

        if (!updatedSurvey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        const surveyResponse = updatedSurvey.toObject();
        surveyResponse.images = surveyResponse.images.map(img => `https://ramgeneral-api.onrender.com/uploads/surveys/${img}`);
        return res.status(200).json({ survey: surveyResponse, message: 'Survey updated successfully.' });
    } catch (error) {
        console.error('Update survey error:', error);
        return res.status(500).json({ message: 'Server error updating survey.' });
    }
};

exports.assignSurvey = async (req, res) => {
    try {
        const user_id = req.user.id;
        console.log(user_id);
        const user = await Admin.findById(user_id);
        if (!user) {
            return res.status(403).json({ message: 'Only admins can assign surveys.' });
        }

        const { id } = req.params;
        const { assignedTo } = req.body;

        if (!assignedTo) {
            return res.status(400).json({ message: 'assignedTo is required.' });
        }

        // Check if assigned user exists and has appropriate role
        const assignedUser = await User.findById(assignedTo);
        console.log(assignedUser);
        if (!assignedUser) {
            return res.status(404).json({ message: 'Assigned user not found.' });
        }

        if (assignedUser.userRole !== 'project_manager') {
            return res.status(400).json({ message: 'Assigned user must be a project manager.' });
        }

        const customer = await Customer.findByIdAndUpdate(
            id,
            { assignedTo: assignedTo },
            { new: true }
        );

        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        return res.status(200).json({ message: 'Survey assigned successfully.' });

    } catch (error) {
        console.error('Assign survey error:', error);
        return res.status(500).json({ message: 'Server error assigning survey.' });
    }
};
