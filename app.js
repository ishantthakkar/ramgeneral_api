const express = require('express');
require('dotenv').config();
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// Connect to MongoDB
connectDB();

// Body parser
app.use(express.json());

// Routes
app.use('/api/admin', authRoutes);
app.use('/api/admin', userRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Ramageneral API is running' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
