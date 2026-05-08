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
    if (material && Array.isArray(material)) {
      for (const item of material) {
        let savedFilename = '';
        if (item.image && item.image.startsWith('data:')) {
          savedFilename = saveBase64Image(item.image, uploadDir) || '';
        } else if (item.image) {
          savedFilename = item.image.split('/').pop();
        }

        processedMaterials.push({
          ...item,
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
      service.material = processedMaterials;
      service.userId = currentUserId; // Update with the ID of the user who performed the edit
      
      if (rest.assignedTo) {
        service.status = 'Assigned';
      }

      await service.save();

      const customer = await Customer.findById(service.customerId);
      await createLog('Service Ticket Updated', currentUserId, customer?.name || 'Unknown', 'Service', service._id);

      res.status(200).json({ 
        success: true, 
        data: service, 
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

      res.status(201).json({ 
        success: true, 
        data: service, 
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
      .populate('assignedTo', 'fullName')
      .sort({ createdAt: -1 });

    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

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

// Add material to service ticket (Update endpoint)
exports.addServiceMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { materials, materialStatus } = req.body;
    const user_id = req.user.id;

    const service = await Service.findById(id);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service ticket not found' });
    }

    const uploadDir = path.join(__dirname, '../uploads/materials');

    if (materials && Array.isArray(materials)) {
      for (const item of materials) {
        if (!item.item_name || item.issued_qty === undefined) {
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
          item_name: item.item_name,
          issued_qty: item.issued_qty,
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

    res.status(200).json({ success: true, data: service, message: 'Materials updated successfully' });
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

// Get eligible customers for service (Status: completed)
exports.getEligibleCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({ status: 'completed' })
      .select('name company email mobileNumber');
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get full customer details and surveys for the add service form
exports.getCustomerDetailsForService = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const surveys = await Survey.find({ customer_id: id });
    
    // Also find existing service if any
    const service = await Service.findOne({ customerId: id });
    const materialBaseUrl = "https://ramgeneral-api.onrender.com/uploads/materials/";

    let processedService = null;
    if (service) {
      processedService = service.toObject();
      if (processedService.material) {
        processedService.material = processedService.material.map(m => ({
          ...m,
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
