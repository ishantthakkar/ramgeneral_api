const mongoose = require('mongoose');
require('dotenv').config();
const Service = require('./models/Service');
const Customer = require('./models/Customer');
const Survey = require('./models/Survey');
const User = require('./models/User');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

const seedServices = async () => {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    let customers = await Customer.find({ status: 'completed' });
    if (customers.length === 0) {
      console.log('No completed customers found, using any available customers...');
      customers = await Customer.find().limit(5);
    }

    if (customers.length === 0) {
      console.log('No customers found in the database. Cannot create services.');
      process.exit(1);
    }

    let users = await User.find().limit(3);
    if (users.length === 0) {
      console.log('No users found in the database. Creating a dummy user for testing...');
      const dummyUser = new User({
        fullName: 'Demo Contractor',
        company: 'Demo Corp',
        email: 'contractor@demo.com',
        mobileNumber: '1234567890',
        userRole: 'Contractor',
        status: 'Active'
      });
      await dummyUser.save();
      users = [dummyUser];
    }

    await Service.deleteMany({});
    console.log('Cleared existing services.');

    let count = 0;
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      const surveys = await Survey.find({ customer_id: customer._id });

      const toFixItems = [];
      if (surveys && surveys.length > 0) {
        surveys.forEach(survey => {
          toFixItems.push({
            surveyId: survey._id,
            area: survey.area || 'General Area',
            fixtureType: survey.proposedFixture || 'Standard LED',
            proposedQty: survey.proposedQuantity ? parseInt(survey.proposedQuantity) : 10,
            toFix: 2,
            issueNote: 'Flickering or not turning on'
          });
        });
      } else {
        toFixItems.push({
          area: 'Main Lobby',
          fixtureType: 'Recessed LED',
          proposedQty: 5,
          toFix: 1,
          issueNote: 'Broken lens'
        });
      }

      const assignedUser = users[i % users.length];

      // Note: we can't use insertMany immediately if we want pre-save hooks to fire properly 
      // but insertMany doesn't trigger `pre('save')` hooks in Mongoose for `ticketId` generation.
      // So we will use .save() inside the loop.
      const service = new Service({
        customerId: customer._id,
        assignedTo: assignedUser._id,
        notes: `Demo service follow-up for ${customer.name || customer.company}.`,
        status: ['Assigned', 'In Progress', 'Completed'][i % 3],
        materialDelivered: i % 2 === 0,
        toFixItems: toFixItems
      });

      await service.save();
      count++;
      console.log(`Created service ticket ${service.ticketId} for customer ${customer.name || customer.company}`);
    }

    console.log(`Successfully seeded ${count} service tickets.`);
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

seedServices();
