const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middleware/authMiddleware');

// Kullanıcının siparişlerini getir
router.get('/api/orders', authMiddleware, orderController.getUserOrders);

// Sipariş detaylarını getir
router.get('/api/orders/:id', authMiddleware, orderController.getOrderDetails);

// Sipariş oluştur
router.post('/api/orders', authMiddleware, orderController.createOrder);

module.exports = router; 