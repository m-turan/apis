const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// Kullanıcı profili
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);
router.put('/password', authMiddleware, userController.updatePassword);

// Adres yönetimi
router.get('/addresses', authMiddleware, userController.getAddresses);
router.post('/addresses', authMiddleware, userController.addAddress);
router.get('/addresses/:id', authMiddleware, userController.getAddressById);
router.put('/addresses/:id', authMiddleware, userController.updateAddress);
router.delete('/addresses/:id', authMiddleware, userController.deleteAddress);
router.put('/addresses/:id/default', authMiddleware, userController.setDefaultAddress);

module.exports = router; 