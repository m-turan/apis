const db = require('../config/db');

const cartController = {
    async addToCart(req, res) {
        try {
            const { productId, variantId, quantity } = req.body;

            // Stok kontrolü
            if (variantId) {
                const [variant] = await db.query('SELECT quantity FROM variants WHERE id = ?', [variantId]);
                if (!variant.length || variant[0].quantity < quantity) {
                    return res.status(400).json({
                        success: false,
                        message: 'Yetersiz stok'
                    });
                }
            } else {
                const [product] = await db.query('SELECT quantity FROM products WHERE id = ?', [productId]);
                if (!product.length || product[0].quantity < quantity) {
                    return res.status(400).json({
                        success: false,
                        message: 'Yetersiz stok'
                    });
                }
            }

            res.json({
                success: true,
                message: 'Ürün sepete eklendi'
            });
        } catch (error) {
            console.error('Sepete ekleme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Ürün sepete eklenirken bir hata oluştu'
            });
        }
    }
};

module.exports = cartController; 