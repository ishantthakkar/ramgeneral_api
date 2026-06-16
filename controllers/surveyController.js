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
    normalizeNotes,
    buildNoteEntry,
    attachUserIdToNotes,
    enrichNotesWithAuthors,
} = require('../utils/subdocumentHelpers');
const { coerceSurveyNotes, sanitizeSurveyDocumentNotes } = require('../utils/surveyNotes');
const {
    resolveProductCategory,
    getElectricCompanyForCustomer,
    toProductObjectId,
    validateAreaProducts,
    enrichAreasWithProducts,
} = require('../utils/surveyProductUtils');
const { buildFixtureTypeFilter } = require('../utils/productUtils');

const normalizeAssignRole = (value) =>
    (value || '').toString().trim().toLowerCase().replace(/_/g, ' ');
const UPLOAD_DIR = path.join(__dirname, '../uploads/surveys');
const COMPRESS_THRESHOLD = 800 * 1024;
const SURVEY_IMAGE_BASE = process.env.API_BASE_URL || 'https://ramgeneral-api.onrender.com';

const normalizeFormFieldValue = (value) => {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'string') return value;

    let trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        trimmed = trimmed.slice(1, -1);
    }

    return trimmed;
};

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

const parseFormJsonInput = (value) => {
    const normalized = normalizeFormFieldValue(value);
    if (normalized === undefined || normalized === null || normalized === '') return normalized;
    if (typeof normalized !== 'string') return normalized;

    let attempt = normalized.replace(/\\"/g, '"');
    let parsed = tryParseJson(attempt);
    if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
        return parsed;
    }

    if (
        (attempt.startsWith('"') && attempt.endsWith('"')) ||
        (attempt.startsWith("'") && attempt.endsWith("'"))
    ) {
        parsed = tryParseJson(attempt.slice(1, -1));
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
            return parsed;
        }
    }

    return parsed;
};

const toSurveyImageUrl = (filename) =>
    `${SURVEY_IMAGE_BASE}/uploads/surveys/${filename}`;

const mapSurveyImageUrls = (surveyObj) => {
    surveyObj.areas = (surveyObj.areas || []).map((area) => ({
        ...area,
        images: (area.images || []).map(toSurveyImageUrl),
        fixtures: (area.fixtures || []).map((fixture) => ({
            ...fixture,
            images: (fixture.images || []).map(toSurveyImageUrl),
            report: fixture.report
                ? {
                    ...fixture.report,
                    images: (fixture.report.images || []).map(toSurveyImageUrl),
                }
                : fixture.report,
        })),
    }));
    surveyObj.verifyImages = (surveyObj.verifyImages || []).map(toSurveyImageUrl);
    return surveyObj;
};

const formatSurveyResponse = async (surveyObj) => {
    mapSurveyImageUrls(surveyObj);
    surveyObj.areas = await enrichAreasWithProducts(surveyObj.areas || []);
    surveyObj.notes = await enrichNotesWithAuthors(coerceSurveyNotes(surveyObj.notes));
    return surveyObj;
};

const getSubdocId = (item) => {
    if (!item) return null;
    const id = item.id ?? item._id ?? item.areaId ?? item.fixtureId;
    if (!id) return null;
    const value = String(id).trim();
    return value || null;
};

const parseFixtureInput = (item) => {
    const subdocId = getSubdocId(item);
    return {
    ...(subdocId ? { _id: subdocId } : {}),
    product_id: toProductObjectId(item?.product_id ?? item?.productId),
    heightFt: (item?.heightFt ?? item?.height_ft ?? '').toString().trim(),
    heightIn: (item?.heightIn ?? item?.height_in ?? '').toString().trim(),
    existingBulbs: (item?.existingBulbs ?? item?.existing_bulbs ?? '').toString().trim(),
    existingFixtureType: (
        item?.existingFixtureType ?? item?.existing_fixture_type ?? ''
    )
        .toString()
        .trim(),
    note: (item?.note ?? '').toString().trim(),
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
};
};

const parseAreaInput = (item) => {
    const subdocId = getSubdocId(item);
    const areaName = (item?.areaName ?? item?.area_name ?? '').toString().trim();
    const areaNote = (item?.areaNote ?? item?.area_note ?? '').toString().trim();

    if (Array.isArray(item?.fixtures)) {
        return {
            ...(subdocId ? { _id: subdocId } : {}),
            areaName,
            note: areaNote,
            images: [],
            fixtures: item.fixtures.map(parseFixtureInput),
        };
    }

    const hasFixtureFields =
        item?.product_id ||
        item?.productId ||
        item?.existingFixtureType ||
        item?.existing_fixture_type ||
        item?.heightFt ||
        item?.height_ft;

    return {
        ...(subdocId ? { _id: subdocId } : {}),
        areaName,
        note: areaNote,
        images: [],
        fixtures: hasFixtureFields ? [parseFixtureInput(item)] : [],
    };
};

const parseAreasInput = (areas) => {
    if (areas === undefined || areas === null || areas === '') return [];
    const parsed = tryParseJson(areas);
    if (!Array.isArray(parsed)) return null;

    return parsed.map(parseAreaInput);
};

const validateAreasForCustomer = async (areas, customerId) => {
    if (!areas?.length || !customerId) return { valid: true };
    const electricCompany = await getElectricCompanyForCustomer(customerId);
    const category = resolveProductCategory(electricCompany);
    return validateAreaProducts(areas, category);
};

const parseSurveyUploadField = (fieldname) => {
    const field = String(fieldname || '').trim();

    const areaImagesMatch = field.match(/^area_images_(\d+)/i);
    if (areaImagesMatch) {
        return { type: 'area', areaIdx: Number(areaImagesMatch[1], 10) };
    }

    const areaFixtureMatch = field.match(/^area_(\d+)_fixture_(\d+)/i);
    if (areaFixtureMatch) {
        return {
            type: 'fixture',
            areaIdx: Number(areaFixtureMatch[1], 10),
            fixtureIdx: Number(areaFixtureMatch[2], 10),
        };
    }

    const legacyFixtureMatch = field.match(/^area_(\d+)_fixture_images_(\d+)/i);
    if (legacyFixtureMatch) {
        return {
            type: 'fixture',
            areaIdx: Number(legacyFixtureMatch[1], 10),
            fixtureIdx: Number(legacyFixtureMatch[2], 10),
        };
    }

    const simpleFixtureMatch = field.match(/^area_fixture_(\d+)/i);
    if (simpleFixtureMatch) {
        return {
            type: 'fixture',
            areaIdx: 0,
            fixtureIdx: Number(simpleFixtureMatch[1], 10),
        };
    }

    return null;
};

const buildAreasWithImages = async (areasInput, files) => {
    const areas = parseAreasInput(areasInput);
    if (areas === null) return null;

    const areaImagesByIdx = {};
    const fixtureImagesByKey = {};

    for (const file of files || []) {
        const parsed = parseSurveyUploadField(file.fieldname);
        if (!parsed) continue;

        if (parsed.type === 'area') {
            if (!areaImagesByIdx[parsed.areaIdx]) areaImagesByIdx[parsed.areaIdx] = [];
            areaImagesByIdx[parsed.areaIdx].push(file);
            continue;
        }

        const fixtureKey = `${parsed.areaIdx}_${parsed.fixtureIdx}`;
        if (!fixtureImagesByKey[fixtureKey]) fixtureImagesByKey[fixtureKey] = [];
        fixtureImagesByKey[fixtureKey].push(file);
    }

    for (let areaIdx = 0; areaIdx < areas.length; areaIdx++) {
        areas[areaIdx].images = await processUploadedImages(areaImagesByIdx[areaIdx] || []);

        for (let fixtureIdx = 0; fixtureIdx < (areas[areaIdx].fixtures || []).length; fixtureIdx++) {
            const fixtureKey = `${areaIdx}_${fixtureIdx}`;
            areas[areaIdx].fixtures[fixtureIdx].images = await processUploadedImages(
                fixtureImagesByKey[fixtureKey] || []
            );
        }
    }

    return areas;
};

const applyFixtureUpdates = (existingFixture, fixture) => {
    if (fixture.product_id !== undefined) existingFixture.product_id = fixture.product_id;
    if (fixture.heightFt !== undefined) existingFixture.heightFt = fixture.heightFt;
    if (fixture.heightIn !== undefined) existingFixture.heightIn = fixture.heightIn;
    if (fixture.existingBulbs !== undefined) existingFixture.existingBulbs = fixture.existingBulbs;
    if (fixture.existingFixtureType !== undefined) {
        existingFixture.existingFixtureType = fixture.existingFixtureType;
    }
    if (fixture.note !== undefined) existingFixture.note = fixture.note;
    if (fixture.existingQty !== undefined) existingFixture.existingQty = fixture.existingQty;
    if (fixture.proposedQty !== undefined) existingFixture.proposedQty = fixture.proposedQty;
    if (fixture.price !== undefined) existingFixture.price = fixture.price;
    if (fixture.images && fixture.images.length > 0) {
        existingFixture.images = [...(existingFixture.images || []), ...fixture.images];
    }
};

const stripSubdocId = (item) => {
    const copy = { ...item };
    delete copy._id;
    delete copy.id;
    delete copy.areaId;
    delete copy.fixtureId;
    return copy;
};

const upsertSurveyAreas = (survey, incomingAreas) => {
    for (const area of incomingAreas) {
        const areaId = getSubdocId(area);

        if (areaId) {
            const existingArea = survey.areas.id(areaId);
            if (!existingArea) {
                const error = new Error(`Area not found: ${areaId}`);
                error.code = 'AREA_NOT_FOUND';
                throw error;
            }

            if (area.areaName !== undefined) existingArea.areaName = area.areaName;
            if (area.note !== undefined) existingArea.note = area.note;
            if (area.images?.length) {
                existingArea.images = [...(existingArea.images || []), ...area.images];
            }

            for (const fixture of area.fixtures || []) {
                const fixtureId = getSubdocId(fixture);
                if (fixtureId) {
                    const existingFixture = existingArea.fixtures.id(fixtureId);
                    if (!existingFixture) {
                        const error = new Error(`Fixture not found: ${fixtureId}`);
                        error.code = 'FIXTURE_NOT_FOUND';
                        throw error;
                    }
                    applyFixtureUpdates(existingFixture, fixture);
                } else {
                    existingArea.fixtures.push(stripSubdocId(fixture));
                }
            }
            continue;
        }

        const newArea = stripSubdocId(area);
        newArea.fixtures = (area.fixtures || []).map(stripSubdocId);
        survey.areas.push(newArea);
    }

    survey.markModified('areas');
};

const parseAreaReportFixtureInput = (item) => {
    const subdocId = getSubdocId(item);
    const reportSource =
        item?.report && typeof item.report === 'object' && !Array.isArray(item.report)
            ? item.report
            : item;
    const result = {
        ...(subdocId ? { _id: subdocId } : {}),
        images: [],
    };

    if (reportSource?.installed_qty !== undefined || reportSource?.installedQty !== undefined) {
        result.installed_qty = Number(
            reportSource?.installed_qty ?? reportSource?.installedQty ?? 0
        );
    }
    if (reportSource?.heightFt !== undefined || reportSource?.height_ft !== undefined) {
        result.heightFt = (reportSource?.heightFt ?? reportSource?.height_ft ?? '')
            .toString()
            .trim();
    }
    if (reportSource?.heightIn !== undefined || reportSource?.height_in !== undefined) {
        result.heightIn = (reportSource?.heightIn ?? reportSource?.height_in ?? '')
            .toString()
            .trim();
    }
    if (reportSource?.note !== undefined || reportSource?.fixture_note !== undefined) {
        result.note = (reportSource?.note ?? reportSource?.fixture_note ?? '').toString().trim();
    }

    return result;
};

const parseIndexedReportFixturesFromBody = (body) => {
    const byIndex = {};

    for (const [key, value] of Object.entries(body || {})) {
        const fieldMatch = key.match(/^fixtures?_(\d+)_(.+)$/i);
        if (fieldMatch) {
            const [, idx, field] = fieldMatch;
            if (!byIndex[idx]) byIndex[idx] = {};
            byIndex[idx][field] = value;
            continue;
        }

        const blobMatch = key.match(/^fixtures?_(\d+)$/i);
        if (!blobMatch) continue;

        const idx = blobMatch[1];
        const parsed = tryParseJson(value);
        byIndex[idx] =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : { id: value };
    }

    const indices = Object.keys(byIndex).sort((a, b) => Number(a) - Number(b));
    if (!indices.length) return [];

    return indices.map((idx) => parseAreaReportFixtureInput(byIndex[idx]));
};

const parseAreaReportFixturesInput = (body) => {
    const { fixtures, installed_qty, installedQty, heightFt, height_ft, heightIn, height_in } = body;
    const parsed = parseFormJsonInput(fixtures);
    const fixtureId = body.fixture_id ?? body.fixtureId;

    if (Array.isArray(parsed) && parsed.length) {
        return parsed.map(parseAreaReportFixtureInput);
    }

    const indexedFixtures = parseIndexedReportFixturesFromBody(body);
    if (indexedFixtures.length) {
        return indexedFixtures;
    }

    const hasSingleFixtureFields =
        fixtureId ||
        body.id ||
        body._id ||
        installed_qty !== undefined ||
        installedQty !== undefined ||
        heightFt !== undefined ||
        height_ft !== undefined ||
        heightIn !== undefined ||
        height_in !== undefined ||
        body.fixture_note !== undefined;

    if (hasSingleFixtureFields) {
        return [
            parseAreaReportFixtureInput({
                ...body,
                id: fixtureId ?? body.id ?? body._id,
                note: body.fixture_note,
            }),
        ];
    }

    return [];
};

const parseReportUploadField = (fieldname) => {
    const field = String(fieldname || '').trim();
    const idMatch = field.match(/^(?:area_)?report_fixture_([a-f0-9]{24})$/i);
    if (idMatch) return { fixtureId: idMatch[1] };

    const idxMatch = field.match(/^(?:area_)?report_fixture_(\d+)$/i);
    if (idxMatch) return { fixtureIdx: Number(idxMatch[1], 10) };

    return null;
};

const attachReportFixtureImages = async (fixtures, files) => {
    const fixtureImagesByIdx = {};
    const fixtureImagesById = {};

    for (const file of files || []) {
        const parsed = parseReportUploadField(file.fieldname);
        if (!parsed) continue;

        if (parsed.fixtureId) {
            if (!fixtureImagesById[parsed.fixtureId]) fixtureImagesById[parsed.fixtureId] = [];
            fixtureImagesById[parsed.fixtureId].push(file);
            continue;
        }

        if (!fixtureImagesByIdx[parsed.fixtureIdx]) fixtureImagesByIdx[parsed.fixtureIdx] = [];
        fixtureImagesByIdx[parsed.fixtureIdx].push(file);
    }

    const result = [];
    for (let fixtureIdx = 0; fixtureIdx < fixtures.length; fixtureIdx++) {
        const fixture = fixtures[fixtureIdx];
        const fixtureId = getSubdocId(fixture);
        const filesForFixture = [
            ...(fixtureImagesByIdx[fixtureIdx] || []),
            ...(fixtureId ? fixtureImagesById[String(fixtureId)] || [] : []),
        ];
        const images = await processUploadedImages(filesForFixture);
        result.push({
            ...fixture,
            images: [...(fixture.images || []), ...images],
        });
    }

    return result;
};

const ensureFixtureReport = (fixture) => {
    if (!fixture.report) {
        fixture.report = {
            installed_qty: 0,
            heightFt: '',
            heightIn: '',
            note: '',
            images: [],
        };
    }
    if (!Array.isArray(fixture.report.images)) {
        fixture.report.images = [];
    }
};

const applyReportFixtureUpdates = (existingFixture, fixture) => {
    ensureFixtureReport(existingFixture);
    const report = existingFixture.report;

    if (fixture.installed_qty !== undefined) report.installed_qty = fixture.installed_qty;
    if (fixture.heightFt !== undefined) report.heightFt = fixture.heightFt;
    if (fixture.heightIn !== undefined) report.heightIn = fixture.heightIn;
    if (fixture.note !== undefined) report.note = fixture.note;
    if (fixture.images?.length) {
        report.images = [...(report.images || []), ...fixture.images];
    }
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

exports.createNewSurvey = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { customer_id, surveyName } = req.body;

        if (!customer_id) {
            return res.status(400).json({ message: 'customer_id is required.' });
        }

        const customer = await Customer.findById(customer_id);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        const survey = await Survey.create({
            customer_id,
            user_id,
            surveyName: surveyName || '',
            editApprovalStatus: 'none',
            status: 'in_progress',
            areas: []
        });

        await createLog('Survey Created', user_id, customer.name, 'Survey', survey._id);

        const surveyResponse = await formatSurveyResponse(survey.toObject());
        return res.status(201).json({ survey: surveyResponse, message: 'Survey created successfully.' });

    } catch (error) {
        console.error('Create new survey error:', error);
        return res.status(500).json({ message: 'Server error creating survey.' });
    }
};

exports.createSurvey = async (req, res) => {
    try {
        const user_id = req.user.id;
        const { survey_id, surveyName, areaName, note, notes, status, surveyDate, areas, markAsCompleted, MarkasCompleted } = req.body;
        const completionFlag = markAsCompleted !== undefined ? markAsCompleted : MarkasCompleted !== undefined ? MarkasCompleted : false;

        const user = await User.findById(user_id);
        if (!user) {
            return res.status(401).json({ message: 'Invalid authenticated user.' });
        }

        const processedAreas = areas !== undefined ? await buildAreasWithImages(areas, req.files) : null;
        if (processedAreas === null && areas !== undefined && areas !== '') {
            return res.status(400).json({
                message:
                    'Invalid areas. Send a JSON array of area objects with areaName, note, and a fixtures array (product_id, heightFt, heightIn, existingBulbs, existingFixtureType, note, etc.).',
            });
        }

        if (!survey_id) {
            return res.status(400).json({ message: 'survey_id is required.' });
        }

        let survey = await Survey.findById(survey_id);
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        if (processedAreas !== null) {
            const areaValidation = await validateAreasForCustomer(
                processedAreas,
                survey.customer_id
            );
            if (!areaValidation.valid) {
                return res.status(400).json({ message: areaValidation.message });
            }
        }

        survey.status = status || survey.status;
        if (surveyName !== undefined) survey.surveyName = surveyName;
        if (areaName !== undefined) survey.areaName = areaName;
        if (note !== undefined) survey.note = note;
        if (notes !== undefined) {
            const processedNotes = attachUserIdToNotes(
                normalizeNotes(notes).filter((item) => item.note),
                req.user.id
            );
            if (processedNotes.length) {
                survey.notes = [...coerceSurveyNotes(survey.notes), ...processedNotes];
                survey.markModified('notes');
            }
        }
        if (surveyDate) survey.surveyDate = new Date(surveyDate);
        survey.markAsCompleted = completionFlag;

        if (processedAreas !== null) {
            try {
                upsertSurveyAreas(survey, processedAreas);
            } catch (upsertError) {
                if (upsertError.code === 'AREA_NOT_FOUND' || upsertError.code === 'FIXTURE_NOT_FOUND') {
                    return res.status(404).json({ message: upsertError.message });
                }
                throw upsertError;
            }
        }

        await survey.save();

        const customer = await Customer.findById(survey.customer_id);
        await createLog('Survey Updated', user_id, customer?.name || 'Unknown', 'Survey', survey._id);

        const surveyResponse = await formatSurveyResponse(survey.toObject());

        return res.status(200).json({ survey: surveyResponse, message: 'Survey updated successfully.' });
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

        const products = await Product.find({
            category,
            ...buildFixtureTypeFilter('Proposed Fixture'),
        })
            .sort({ name: 1 })
            .lean();

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
        const { surveyName, areaName, note, notes, status, surveyDate, markAsCompleted, MarkasCompleted } = req.body;

        const survey = await Survey.findById(id);
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        if (surveyName !== undefined) survey.surveyName = surveyName;
        if (areaName !== undefined) survey.areaName = areaName;
        if (note !== undefined) survey.note = note;
        if (notes !== undefined) {
            const processedNotes = attachUserIdToNotes(
                normalizeNotes(notes).filter((item) => item.note),
                req.user.id
            );
            if (processedNotes.length) {
                survey.notes = [...coerceSurveyNotes(survey.notes), ...processedNotes];
                survey.markModified('notes');
            }
        }
        if (status) survey.status = status;
        if (surveyDate) survey.surveyDate = new Date(surveyDate);
        if (markAsCompleted !== undefined) survey.markAsCompleted = markAsCompleted;
        if (MarkasCompleted !== undefined) survey.markAsCompleted = MarkasCompleted;

        const updatedSurvey = await survey.save();

        const surveyResponse = await formatSurveyResponse(updatedSurvey.toObject());

        await createLog('Survey Updated', req.user.id, (await Customer.findById(updatedSurvey.customer_id))?.name || 'Unknown', 'Survey', updatedSurvey._id);

        return res.status(200).json({ survey: surveyResponse, message: 'Survey updated successfully.' });
    } catch (error) {
        console.error('Update survey error:', error);
        return res.status(500).json({ message: 'Server error updating survey.' });
    }
};

exports.updateSurveyName = async (req, res) => {
    try {
        const { survey_id, surveyName, survey_name } = req.body;
        const name = surveyName !== undefined ? surveyName : survey_name;

        if (!survey_id) {
            return res.status(400).json({ message: 'survey_id is required.' });
        }
        if (name === undefined || name === null || !String(name).trim()) {
            return res.status(400).json({ message: 'surveyName is required.' });
        }

        const survey = await Survey.findById(survey_id);
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        survey.surveyName = String(name).trim();
        await survey.save();

        const surveyResponse = await formatSurveyResponse(survey.toObject());

        await createLog(
            'Survey Name Updated',
            req.user.id,
            (await Customer.findById(survey.customer_id))?.name || 'Unknown',
            'Survey',
            survey._id
        );

        return res.status(200).json({
            survey: surveyResponse,
            message: 'Survey name updated successfully.',
        });
    } catch (error) {
        console.error('Update survey name error:', error);
        return res.status(500).json({ message: 'Server error updating survey name.' });
    }
};

exports.updateSurveyNotes = async (req, res) => {
    try {
        const { survey_id, title, note, notes } = req.body;

        if (!survey_id) {
            return res.status(400).json({ message: 'survey_id is required.' });
        }

        let processedNotes = [];
        if (note !== undefined && note !== null) {
            const noteText = String(note).trim();
            if (!noteText) {
                return res.status(400).json({ message: 'note is required.' });
            }
            processedNotes = [
                buildNoteEntry({
                    title,
                    note: noteText,
                    userId: req.user.id,
                }),
            ].filter(Boolean);
        } else if (notes !== undefined && notes !== null) {
            processedNotes = attachUserIdToNotes(
                normalizeNotes(notes).filter((item) => item.note),
                req.user.id
            );
            if (!processedNotes.length) {
                return res.status(400).json({ message: 'note is required.' });
            }
        } else {
            return res.status(400).json({ message: 'note is required.' });
        }

        const survey = await Survey.findById(survey_id);
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        survey.notes = [...coerceSurveyNotes(survey.notes), ...processedNotes];
        survey.markModified('notes');
        await survey.save();

        const surveyResponse = await formatSurveyResponse(survey.toObject());

        await createLog(
            'Survey Notes Updated',
            req.user.id,
            (await Customer.findById(survey.customer_id))?.name || 'Unknown',
            'Survey',
            survey._id
        );

        return res.status(200).json({
            survey: surveyResponse,
            message: 'Survey notes updated successfully.',
        });
    } catch (error) {
        console.error('Update survey notes error:', error);
        return res.status(500).json({ message: 'Server error updating survey notes.' });
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
            await Customer.findByIdAndUpdate(survey.customer_id, { inspectionStatus: 'reopen' });
        }

        const surveyResponse = await formatSurveyResponse(survey.toObject());

        await createLog('Survey Verified', user_id, (await Customer.findById(survey.customer_id))?.name || 'Unknown', 'Survey', survey._id);

        return res.status(200).json({ survey: surveyResponse, message: 'Survey verification updated successfully.' });
    } catch (error) {
        console.error('Verify survey error:', error);
        return res.status(500).json({ message: 'Server error verifying survey.' });
    }
};

exports.confirmVerifySurvey = async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user.id;

        const survey = await Survey.findById(id);
        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        if (survey.confirmDate) {
            return res.status(400).json({ message: 'Survey is already verified.' });
        }

        const verifiedAt = new Date();
        survey.confirmDate = verifiedAt;
        survey.status = 'completed';
        sanitizeSurveyDocumentNotes(survey);
        await survey.save();

        let customer = null;
        if (survey.customer_id) {
            customer = await Customer.findById(survey.customer_id);
            if (customer) {
                const { syncPayablesForCustomer } = require('../utils/payablesUtils');
                customer = await syncPayablesForCustomer(customer);
                await customer.save();
            }
        }

        const surveyResponse = await formatSurveyResponse(survey.toObject());

        await createLog(
            'Survey Confirmed',
            user_id,
            customer?.name || 'Unknown',
            'Survey',
            survey._id
        );

        return res.status(200).json({
            message: 'Survey verified successfully.',
            survey: surveyResponse,
            customer,
        });
    } catch (error) {
        console.error('Confirm verify survey error:', error);
        return res.status(500).json({ message: 'Server error verifying survey.', error: error.message });
    }
};

exports.assignSurvey = async (req, res) => {
    try {
        const user_id = req.user.id;
        const surveyId = req.body.survey_id ?? req.body.surveyId ?? req.params.id;
        const { assignedTo } = req.body;

        const admin = await Admin.findById(user_id);
        if (!admin) {
            return res.status(403).json({ message: 'Only admins can assign surveys.' });
        }

        if (!surveyId) {
            return res.status(400).json({ message: 'survey_id is required.' });
        }

        if (!assignedTo) {
            return res.status(400).json({ message: 'assignedTo is required.' });
        }

        const assignedUser = await User.findById(assignedTo);
        if (!assignedUser) {
            return res.status(404).json({ message: 'Assigned user not found.' });
        }

        if (!['contractor', 'project manager'].includes(normalizeAssignRole(assignedUser.userRole))) {
            return res.status(400).json({ message: 'Assigned user must be a contractor or project manager.' });
        }

        const survey = await Survey.findByIdAndUpdate(
            surveyId,
            { assignedTo },
            { new: true, runValidators: true }
        ).populate('assignedTo', 'fullName email userRole');

        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        const customer = survey.customer_id
            ? await Customer.findById(survey.customer_id).select('name')
            : null;

        await createLog(
            'Survey Assigned to PM/Contractor',
            user_id,
            customer?.name || survey.surveyName || 'Survey',
            'Assignment',
            survey._id
        );

        return res.status(200).json({ survey, message: 'Survey assigned successfully.' });
    } catch (error) {
        console.error('Assign survey error:', error);
        return res.status(500).json({ message: 'Server error assigning survey.' });
    }
};

exports.assignContractor = async (req, res) => {
    try {
        const user_id = req.user.id;
        const surveyId = req.body.survey_id ?? req.body.surveyId ?? req.params.id;
        const contractorId =
            req.body.contractor ?? req.body.contractorId ?? req.body.assignToContractor;

        const admin = await Admin.findById(user_id);
        let isAuthorized = !!admin;

        if (!isAuthorized) {
            const user = await User.findById(user_id);
            if (user && user.userRole === 'Project Manager') {
                isAuthorized = true;
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ message: 'Only admins or project managers can assign contractors.' });
        }

        if (!surveyId) {
            return res.status(400).json({ message: 'survey_id is required.' });
        }

        if (!contractorId) {
            return res.status(400).json({ message: 'contractor is required.' });
        }

        const contractorUser = await User.findById(contractorId);
        if (!contractorUser) {
            return res.status(404).json({ message: 'Contractor user not found.' });
        }

        const survey = await Survey.findByIdAndUpdate(
            surveyId,
            { assignToContractor: contractorId },
            { new: true, runValidators: true }
        ).populate('assignToContractor', 'fullName email userRole mobileNumber');

        if (!survey) {
            return res.status(404).json({ message: 'Survey not found.' });
        }

        const customer = survey.customer_id
            ? await Customer.findById(survey.customer_id).select('name')
            : null;

        await createLog(
            'Contractor Assigned to Survey',
            user_id,
            customer?.name || survey.surveyName || 'Survey',
            'Survey',
            survey._id
        );

        return res.status(200).json({
            message: 'Contractor assigned successfully.',
            survey,
        });
    } catch (error) {
        console.error('Assign contractor error:', error);
        return res.status(500).json({ message: 'Server error assigning contractor.' });
    }
};

exports.installation = async (req, res) => {
    try {
        const surveys = await Survey.find({ quotationStatus: 'approved' })
            .populate({
                path: 'customer_id',
                select: 'accountNumber name company mobileNumber phone email customerCode installationStatus',
                populate: { path: 'leadId', select: 'lead_id leadName dba' },
            })
            .populate('user_id', 'fullName email mobileNumber userRole')
            .populate('assignedTo', 'fullName email mobileNumber userRole')
            .sort({ quotationApprovedAt: -1, updatedAt: -1 });

        return res.status(200).json({
            message: 'Installations retrieved successfully.',
            total: surveys.length,
            surveys,
        });
    } catch (error) {
        console.error('List installations error:', error);
        return res.status(500).json({ message: 'Server error listing installations.' });
    }
};

exports.saveAreaReport = async (req, res) => {
    try {
        const user_id = req.user.id;
        const areaId = normalizeFormFieldValue(req.body.area_id ?? req.body.areaId);

        if (!areaId) {
            return res.status(400).json({ message: 'area_id is required.' });
        }

        const survey = await Survey.findOne({ 'areas._id': areaId });
        if (!survey) {
            return res.status(404).json({ message: 'Area not found.' });
        }

        const area = survey.areas.id(areaId);
        if (!area) {
            return res.status(404).json({ message: 'Area not found.' });
        }

        const rawReportNote = req.body.area_note ?? req.body.report_note ?? req.body.note;
        if (rawReportNote !== undefined) {
            area.report_note = normalizeFormFieldValue(rawReportNote).toString().trim();
        }
        if (area.report !== undefined) {
            area.set('report', undefined);
        }

        const parsedFixtures = parseAreaReportFixturesInput(req.body);
        const updatedFixtureIds = [];

        if (parsedFixtures.length) {
            const fixturesWithImages = await attachReportFixtureImages(parsedFixtures, req.files);

            for (const fixture of fixturesWithImages) {
                const fixtureId = getSubdocId(fixture);
                if (!fixtureId) {
                    return res.status(400).json({
                        message: 'fixture id is required for each fixture update.',
                    });
                }

                const existingFixture = area.fixtures.id(fixtureId);
                if (!existingFixture) {
                    return res.status(404).json({
                        message: `Fixture not found: ${fixtureId}`,
                    });
                }

                applyReportFixtureUpdates(existingFixture, fixture);
                updatedFixtureIds.push(fixtureId);
            }
        }

        survey.markModified('areas');
        await survey.save();

        const customer = survey.customer_id
            ? await Customer.findById(survey.customer_id).select('name')
            : null;

        await createLog(
            'Survey Area Report Saved',
            user_id,
            customer?.name || survey.surveyName || 'Survey',
            'Survey',
            survey._id
        );

        const surveyResponse = await formatSurveyResponse(survey.toObject());
        const updatedArea = (surveyResponse.areas || []).find(
            (item) => String(item._id) === String(areaId)
        );
        const updatedFixtures = (updatedArea?.fixtures || []).filter((fixture) =>
            updatedFixtureIds.includes(String(fixture._id))
        );

        return res.status(200).json({
            message: 'Area report saved successfully.',
            survey_id: survey._id,
            area_id: areaId,
            area: updatedArea,
            report_note: updatedArea?.report_note || '',
            ...(updatedFixtureIds.length ? { updated_fixtures: updatedFixtures } : {}),
        });
    } catch (error) {
        console.error('Save area report error:', error);
        return res.status(500).json({ message: 'Server error saving area report.' });
    }
};
