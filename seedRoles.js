require('dotenv').config();
const connectDB = require('./config/db');
const mongoose = require('mongoose');
const { seedSystemRoles } = require('./utils/seedRoles');

async function run() {
  await connectDB();
  await seedSystemRoles();
  console.log('System roles seeded successfully.');
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((error) => {
  console.error('Seed roles error:', error);
  process.exit(1);
});
