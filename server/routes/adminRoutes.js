const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const productController = require('../controllers/productController');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// Admin giriş route'u
router.post('/login', adminController.login);

// Admin yetki kontrolü middleware'i
const adminAuthMiddleware = async (req, res, next) => {
    try {
        // Token kontrolü
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Yetkisiz erişim'
            });
        }
        
        // Token'ı doğrula
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Admin kontrolü
        const [admins] = await db.query('SELECT * FROM admins WHERE id = ?', [decoded.userId]);
        
        if (admins.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Admin yetkisi gerekiyor'
            });
        }
        
        req.admin = admins[0];
        next();
    } catch (error) {
        console.error('Admin yetki kontrolü hatası:', error);
        res.status(401).json({
            success: false,
            message: 'Yetkisiz erişim'
        });
    }
};

// Admin rotalarını koruma
router.use(adminAuthMiddleware);

// Dashboard verileri route'u
router.get('/dashboard', adminController.getDashboardData);

// Ürünler route'ları
router.get('/products', productController.getProducts);
router.post('/products', adminController.addProduct);
router.put('/products/:id', adminController.updateProduct);
router.delete('/products/:id', adminController.deleteProduct);

// XML işlemleri
router.get('/xml-uploads', adminController.getXmlUploads);
router.post('/upload-xml-url', adminController.uploadXmlFromUrl);
router.put('/xml-uploads/:id/toggle-status', adminController.toggleXmlStatus);
router.delete('/xml-uploads/:id', adminController.deleteXml);

// Müşteri yönetimi rotaları
router.get('/customers', adminController.getCustomers);
router.put('/customers/:id/toggle-status', adminController.toggleCustomerStatus);
router.get('/customers/export', adminController.exportCustomers);

// Sipariş yönetimi rotaları
router.get('/orders', adminController.getOrders);
router.put('/orders/:id/status', adminController.updateOrderStatus);
router.get('/orders/export', adminController.exportOrders);

// XML yükleme ilerleme durumunu kontrol etmek için yeni endpoint
router.get('/upload-progress/:progressId', adminController.getUploadProgress);

module.exports = router; 