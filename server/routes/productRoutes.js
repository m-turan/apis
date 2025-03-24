const express = require('express');
const router = express.Router();
const multer = require('multer');
const productController = require('../controllers/productController');
const db = require('../config/db');
const cartController = require('../controllers/cartController');
const authMiddleware = require('../middleware/authMiddleware');

// Multer yapılandırması
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
}).single('xmlFile');

// Bebek kategorileri route'u - Bu route'u diğer ürün route'larından önce tanımla
router.get('/baby-categories', async (req, res) => {
    try {
        const [categories] = await db.query(`
            SELECT DISTINCT 
                main_category as name,
                sub_category as subcategory_name
            FROM products
            WHERE main_category LIKE '%BEBEK%'
                OR top_category LIKE '%BEBEK%'
            ORDER BY name, subcategory_name
        `);

        // Kategorileri düzenle
        const formattedCategories = categories.reduce((acc, curr) => {
            const existingCategory = acc.find(cat => cat.name === curr.name);
            
            if (existingCategory) {
                if (curr.subcategory_name) {
                    existingCategory.subcategories.push(curr.subcategory_name);
                }
            } else {
                acc.push({
                    name: curr.name,
                    subcategories: curr.subcategory_name ? [curr.subcategory_name] : []
                });
            }
            
            return acc;
        }, []);

        res.json(formattedCategories);
    } catch (error) {
        console.error('Bebek kategorileri yüklenirken hata:', error);
        res.status(500).json({ error: 'Kategoriler yüklenirken bir hata oluştu' });
    }
});

// API endpoints
router.get('/women-products', productController.getWomenProducts);
router.get('/men-products', productController.getMenProducts);

// Bebek ürünleri route'u
router.get('/baby-products', productController.getBabyProducts);

// Bebek ürünleri ve kategorileri için endpoint'ler ekleyelim
router.get('/baby-products', productController.getBabyProducts);
router.get('/baby-categories', productController.getBabyCategories);

// Diğer route'lar
router.get('/product/:id', productController.getProductById);
router.get('/', productController.getProducts);

// XML yükleme rotaları
router.post('/upload-xml-url', productController.uploadXmlUrl);
router.post('/upload-xml-file', upload, productController.uploadXmlFile);

// Cart endpoint'lerini ekleyelim
router.post('/cart/add', authMiddleware, cartController.addToCart);

// Toplu ürün bilgilerini getir
router.get('/batch', productController.getBatchProducts);

// Ürün resimlerinin tam URL'ini oluşturmak için middleware
router.use((req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(body) {
    // Eğer JSON yanıtı varsa ve ürünler içeriyorsa
    if (body && typeof body === 'string') {
      try {
        const data = JSON.parse(body);
        
        // Ürün listesi varsa
        if (data.products && Array.isArray(data.products)) {
          data.products = data.products.map(product => {
            // Resim URL'lerini tam URL'e çevir
            for (let i = 1; i <= 9; i++) {
              const imageKey = `image${i}`;
              if (product[imageKey] && !product[imageKey].startsWith('http')) {
                product[imageKey] = `https://www.eterella.com${product[imageKey]}`;
              }
            }
            return product;
          });
          
          body = JSON.stringify(data);
        }
        
        // Tek ürün varsa
        if (data.product) {
          for (let i = 1; i <= 9; i++) {
            const imageKey = `image${i}`;
            if (data.product[imageKey] && !data.product[imageKey].startsWith('http')) {
              data.product[imageKey] = `https://www.eterella.com${data.product[imageKey]}`;
            }
          }
          
          body = JSON.stringify(data);
        }
      } catch (e) {
        // JSON parse hatası, body'yi olduğu gibi bırak
      }
    }
    
    originalSend.call(this, body);
  };
  
  next();
});

module.exports = router; 