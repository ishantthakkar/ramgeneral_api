const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('./models/Admin');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';

const seedAdmin = async () => {
  try {
    await mongoose.connect(MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const email = process.argv[2] || 'admin@ramgeneral.com';
    const password = process.argv[3] || 'Password123!';

    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.log('Admin already exists:', existing.email);
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = new Admin({ email: email.toLowerCase(), password: hashedPassword });
    await admin.save();

    console.log('Admin seeded successfully:');
    console.log('  Email:', admin.email);
    console.log('  Password:', password);
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

seedAdmin();
