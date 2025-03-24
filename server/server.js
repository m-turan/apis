require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const productRoutes = require('./routes/productRoutes');
const adminRoutes = require('./routes/adminRoutes');
const fileUpload = require('express-fileupload');
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const userRoutes = require('./routes/userRoutes');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// CORS ve JSON ayarları
app.use(cors({
  origin: ['https://www.eterella.com', 'https://eterella.com', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload middleware
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
}));

// Güvenlik başlıkları
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https://*.eterella.com", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'", "https://*.eterella.com"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // IP başına 15 dakikada maksimum 100 istek
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Çok fazla istek gönderdiniz, lütfen daha sonra tekrar deneyin'
  }
});

// API rotalarına rate limiting uygula
app.use('/api/', apiLimiter);

// API routes - önce API rotalarını tanımla
app.use('/api/admin', adminRoutes);
app.use('/api/products', productRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/', orderRoutes);

// Statik dosya sunumu
app.use(express.static(path.join(__dirname, '../public')));

// HTML routes - en sonda tanımla
app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/profile.html'));
});

app.get('/men', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/men.html'));
});

app.get('/women', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/women.html'));
});

app.get('/baby', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/baby.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/checkout.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Test URL: http://localhost:${PORT}/api/products/men`);
}); 