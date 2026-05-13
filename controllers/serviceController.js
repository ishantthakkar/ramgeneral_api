const Service = require('../models/Service');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const path = require('path');
const fs = require('fs');
const { createLog } = require('../utils/logger');

// Helper function to save base64 image
const saveBase64Image = (base64String, uploadDir) => {
  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,([\s\S]+)$/);
    if (!matches || matches.length !== 3) return null;

    const type = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const extension = type.split('/')[1].split('+')[0] || 'jpg';
    const fileName = `${Date.now()}-${Math.floor(Math.random() * 10000)}.${extension}`;
    const filePath = path.join(uploadDir, fileName);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(filePath, buffer);
    return fileName;
  } catch (error) {
    console.error('Error saving base64 image:', error);
    return null;
  }
};

// Create or Update a service ticket (Upsert)
exports.createService = async (req, res) => {
  try {
    const { material, customerId, ...rest } = req.body;
    const currentUserId = req.user.id; // Get ID of user making the request

    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer ID is required' });
    }

    const uploadDir = path.join(__dirname, '../uploads/materials');
    
    let processedMaterials = [];
    const itemsToProcess = material || rest.materials;
    
    if (itemsToProcess && Array.isArray(itemsToProcess)) {
      for (const item of itemsToProcess) {
        let savedFilename = '';
        if (item.image && item.image.startsWith('data:')) {
          savedFilename = saveBase64Image(item.image, uploadDir) || '';
        } else if (item.image) {
          savedFilename = item.image.split('/').pop();
        }

        processedMaterials.push({
          item_name: item.item_name || item.name || '',
          issued_qty: item.issued_qty || item.quantity || 0,
          image: savedFilename,
          issued_date: item.issued_date ? new Date(item.issued_date) : new Date()
        });
      }
    }

    // Step 1: Check if a service ticket already exists for this customer
    let service = await Service.findOne({ customerId });

    if (service) {
      // Step 2: If it exists, Update the service instead of creating a second one
      Object.assign(service, rest);
      
      // Only update material if provided in request
      if (itemsToProcess && Array.isArray(itemsToProcess)) {
        service.material = processedMaterials;
      }
      
      service.userId = currentUserId; // Update with the ID of the user who performed the edit
      
      if (rest.assignedTo) {
        service.status = 'Assigned';
      }

      await service.save();

      const customer = await Customer.findById(service.customerId);
      await createLog('Service Ticket Updated', currentUserId, customer?.name || 'Unknown', 'Service', service._id);

      // Return service with full image URLs
      const materialBaseUrl = `${req.protocol}://${req.get('host')}/uploads/materials/`;
      const serviceObj = service.toObject();
      if (serviceObj.material) {
        serviceObj.material = serviceObj.material.map(m => ({
          ...m,
          image: m.image ? `${materialBaseUrl}${m.image}` : ''
        }));
      }

      res.status(200).json({ 
        success: true, 
        data: serviceObj, 
        message: 'Service ticket updated successfully' 
      });
    } else {
      // Step 3: If no service exists, Create a new one with the current user ID
      service = new Service({
        ...rest,
        customerId,
        userId: currentUserId, // Assign the creator's ID
        material: processedMaterials
      });

      if (rest.assignedTo) {
        service.status = 'Assigned';
      }
      
      await service.save();

      const customer = await Customer.findById(service.customerId);
      await createLog('Service Ticket Created', currentUserId, customer?.name || 'Unknown', 'Service', service._id);

      // Return service with full image URLs
      const materialBaseUrl = `${req.protocol}://${req.get('host')}/uploads/materials/`;
      const serviceObj = service.toObject();
      if (serviceObj.material) {
        serviceObj.material = serviceObj.material.map(m => ({
          ...m,
          image: m.image ? `${materialBaseUrl}${m.image}` : ''
        }));
      }

      res.status(201).json({ 
        success: true, 
        data: serviceObj, 
        message: 'Service ticket created successfully' 
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all service tickets
exports.getAllServices = async (req, res) => {
  try {
    const services = await Service.find()
      .populate('customerId', 'name company email mobileNumber')
      .populate('userId', 'fullName')
      .populate('assignedTo', 'fullName')
      .sort({ createdAt: -1 });

    const materialBaseUrl = `${req.protocol}://${req.get('host')}/uploads/materials/`;

    const updatedServices = services.map(service => {
      const serviceObj = service.toObject();
      if (serviceObj.material) {
        serviceObj.material = serviceObj.material.map(m => ({
          ...m,
          image: m.image ? `${materialBaseUrl}${m.image}` : ''
        }));
      }
      return serviceObj;
    });

    res.status(200).json({ success: true, data: updatedServices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
// Get specific service ticket by ID
exports.getServiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await Service.findById(id)
      .populate('customerId', 'name company email mobileNumber')
      .populate('userId', 'fullName')
      .populate('assignedTo', 'fullName');

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service ticket not found' });
    }

    const materialBaseUrl = `${req.protocol}://${req.get('host')}/uploads/materials/`;
    const serviceObj = service.toObject();
    
    if (serviceObj.material) {
      serviceObj.material = serviceObj.material.map(m => ({
        _id: m._id,
        item_name: m.item_name,
        issued_qty: m.issued_qty,
        issued_date: m.issued_date,
        image: m.image ? `${materialBaseUrl}${m.image}` : ''
      }));
    }

    res.status(200).json({ success: true, data: serviceObj });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update a specific service ticket by ID
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { material, ...rest } = req.body;
    const currentUserId = req.user.id;

    const uploadDir = path.join(__dirname, '../uploads/materials');
    
    let processedMaterials = [];
    const itemsToProcess = material || rest.materials;

    if (itemsToProcess && Array.isArray(itemsToProcess)) {
      for (const item of itemsToProcess) {
        let savedFilename = '';
        if (item.image && item.image.startsWith('data:')) {
          savedFilename = saveBase64Image(item.image, uploadDir) || '';
        } else if (item.image) {
          savedFilename = item.image.split('/').pop();
        }

        processedMaterials.push({
          item_name: item.item_name || item.name || '',
          issued_qty: item.issued_qty || item.quantity || 0,
          image: savedFilename,
          issued_date: item.issued_date ? new Date(item.issued_date) : new Date()
        });
      }
    }

    const service = await Service.findById(id);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service ticket not found' });
    }

    // Update fields
    Object.assign(service, rest);
    if (itemsToProcess && Array.isArray(itemsToProcess)) {
      service.material = processedMaterials;
    }
    service.userId = currentUserId;

    if (rest.assignedTo) {
      service.status = 'Assigned';
    }

    await service.save();

    const customer = await Customer.findById(service.customerId);
    await createLog('Service Ticket Updated', currentUserId, customer?.name || 'Unknown', 'Service', service._id);

    // Return service with full image URLs
    const materialBaseUrl = `${req.protocol}://${req.get('host')}/uploads/materials/`;
    const serviceObj = service.toObject();
    if (serviceObj.material) {
      serviceObj.material = serviceObj.material.map(m => ({
        ...m,
        image: m.image ? `${materialBaseUrl}${m.image}` : ''
      }));
    }

    res.status(200).json({ success: true, data: serviceObj, message: 'Service ticket updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Add material to service ticket (Update endpoint)
exports.addServiceMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { materials, material, materialStatus } = req.body;
    const user_id = req.user.id;

    const service = await Service.findById(id);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service ticket not found' });
    }

    const uploadDir = path.join(__dirname, '../uploads/materials');
    const itemsToAdd = materials || material;

    if (itemsToAdd && Array.isArray(itemsToAdd)) {
      for (const item of itemsToAdd) {
        const itemName = item.item_name || item.name;
        const issuedQty = item.issued_qty !== undefined ? item.issued_qty : item.quantity;

        if (!itemName || issuedQty === undefined) {
          continue;
        }

        let savedFilename = '';
        if (item.image) {
          if (item.image.startsWith('data:')) {
            savedFilename = saveBase64Image(item.image, uploadDir) || '';
          } else {
            savedFilename = item.image.split('/').pop();
          }
        }

        service.material.push({
          item_name: itemName,
          issued_qty: issuedQty,
          issued_date: item.issued_date ? new Date(item.issued_date) : new Date(),
          image: savedFilename
        });
      }
    }

    if (materialStatus) {
      service.materialStatus = materialStatus;
    }

    await service.save();

    const customer = await Customer.findById(service.customerId);
    await createLog('Service Materials Updated', user_id, customer?.name || 'Unknown', 'Service', service._id);

    // Return service with full image URLs
    const materialBaseUrl = `${req.protocol}://${req.get('host')}/uploads/materials/`;
    const serviceObj = service.toObject();
    if (serviceObj.material) {
      serviceObj.material = serviceObj.material.map(m => ({
        ...m,
        image: m.image ? `${materialBaseUrl}${m.image}` : ''
      }));
    }

    res.status(200).json({ success: true, data: serviceObj, message: 'Materials updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Assign contractor to service ticket
exports.assignContractorToService = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    if (!assignedTo) {
      return res.status(400).json({ success: false, message: 'Contractor ID (assignedTo) is required' });
    }

    const service = await Service.findByIdAndUpdate(
      id,
      { assignedTo, status: 'Assigned' },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'fullName email');

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service ticket not found' });
    }

    const customer = await Customer.findById(service.customerId);
    await createLog('Contractor Assigned to Service', req.user.id, customer?.name || 'Unknown', 'Service', service._id);

    res.status(200).json({ success: true, data: service, message: 'Contractor assigned successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get eligible customers for service (Status: completed AND no existing service ticket)
exports.getEligibleCustomers = async (req, res) => {
  try {
    // 1. Find all customers with status 'completed'
    const completedCustomers = await Customer.find({ status: 'completed' })
      .select('name company email mobileNumber');

    // 2. Get IDs of all customers who already have a service ticket
    const existingServiceCustomerIds = await Service.find().distinct('customerId');
    const existingIdsString = existingServiceCustomerIds.map(id => id.toString());

    // 3. Filter out customers who already have a ticket
    const eligibleCustomers = completedCustomers.filter(
      customer => !existingIdsString.includes(customer._id.toString())
    );

    res.status(200).json({ success: true, data: eligibleCustomers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get full customer details and surveys for the add service form
exports.getCustomerDetailsForService = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id).populate('user_id', 'fullName');
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const surveys = await Survey.find({ customer_id: id });
    
    // Also find existing service if any
    const service = await Service.findOne({ customerId: id });
    const materialBaseUrl = `${req.protocol}://${req.get('host')}/uploads/materials/`;

    let processedService = null;
    if (service) {
      processedService = service.toObject();
      if (processedService.material) {
        processedService.material = processedService.material.map(m => ({
          _id: m._id,
          item_name: m.item_name,
          issued_qty: m.issued_qty,
          issued_date: m.issued_date,
          image: m.image ? `${materialBaseUrl}${m.image}` : ''
        }));
      }
    }
    
    res.status(200).json({ 
      success: true, 
      data: { customer, surveys, service: processedService } 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
