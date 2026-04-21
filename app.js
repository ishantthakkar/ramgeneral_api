const express = require('express');
require('dotenv').config();
const connectDB = require('./config/db');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const leadRoutes = require('./routes/leadRoutes');
const customerRoutes = require('./routes/customerRoutes');
const surveyRoutes = require('./routes/surveyRoutes');

const app = express();

// Connect to MongoDB
connectDB();

// Body parser
app.use(express.json());

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/admin', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api', leadRoutes);
app.use('/api/admin', customerRoutes);
app.use('/api', surveyRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Ramageneral API is running' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
