const xml2js = require('xml2js');
const https = require('https');
const db = require('../config/db');
// const Product = require('../models/product');
// const Category = require('../models/category');

const productController = {
    // XML dosyasından ürün yükleme
    async uploadXmlFile(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const xmlData = req.file.buffer.toString();
            const result = await parseAndSaveProducts(xmlData);
            
            res.json({ message: 'Products uploaded successfully', count: result });
        } catch (error) {
            console.error('Error uploading file:', error);
            res.status(500).json({ 
                message: 'Error processing XML file',
                error: error.message 
            });
        }
    },

    // URL'den XML yükleme
    async uploadXmlUrl(req, res) {
        try {
            const { url } = req.body;
            if (!url) {
                return res.status(400).json({ message: 'URL is required' });
            }

            console.log('Fetching XML from URL:', url);
            const xmlData = await fetchXmlFromUrl(url);
            console.log('XML data received, length:', xmlData.length);

            const result = await parseAndSaveProducts(xmlData);
            res.json({ message: 'Products uploaded successfully', count: result });
        } catch (error) {
            console.error('Detailed error:', error);
            res.status(500).json({ 
                message: 'Error processing XML from URL',
                error: error.message
            });
        }
    },

    // Tüm ürünleri getir
    async getProducts(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            
            // Ana sorgu
            let query = `
                SELECT 
                    p.*,
                    GROUP_CONCAT(
                        JSON_OBJECT(
                            'name1', v.name1,
                            'value1', v.value1,
                            'name2', v.name2,
                            'value2', v.value2,
                            'quantity', v.quantity,
                            'barcode', v.barcode
                        )
                    ) as variants
                FROM products p
                LEFT JOIN variants v ON p.id = v.product_id
            `;
            
            // Filtreler
            const whereConditions = [];
            const params = [];
            
            if (req.query.search) {
                whereConditions.push('(p.name LIKE ? OR p.productCode LIKE ?)');
                params.push(`%${req.query.search}%`, `%${req.query.search}%`);
            }
            
            if (req.query.category) {
                whereConditions.push('p.category = ?');
                params.push(req.query.category);
            }
            
            if (req.query.stock === 'inStock') {
                whereConditions.push('p.quantity > 0');
            } else if (req.query.stock === 'outOfStock') {
                whereConditions.push('p.quantity = 0');
            }
            
            if (whereConditions.length > 0) {
                query += ' WHERE ' + whereConditions.join(' AND ');
            }
            
            // Gruplama ve sıralama
            query += ' GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            
            // Toplam ürün sayısı için sorgu
            let countQuery = 'SELECT COUNT(DISTINCT p.id) as total FROM products p';
            if (whereConditions.length > 0) {
                countQuery += ' WHERE ' + whereConditions.join(' AND ');
            }
            
            const [products] = await db.query(query, params);
            const [countResult] = await db.query(countQuery, params.slice(0, -2));
            
            // Variants'ları parse et
            const productsWithParsedVariants = products.map(product => ({
                ...product,
                variants: product.variants ? JSON.parse(`[${product.variants}]`) : []
            }));
            
            res.json({
                products: productsWithParsedVariants,
                currentPage: page,
                totalPages: Math.ceil(countResult[0].total / limit),
                total: countResult[0].total
            });
        } catch (error) {
            console.error('Ürünler yüklenirken hata:', error);
            res.status(500).json({ 
                error: 'Veritabanından ürünler alınırken bir hata oluştu',
                details: error.message
            });
        }
    },

    // ID'ye göre ürün getir
    async getProductById(req, res) {
        try {
            const [products] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
            
            if (products.length === 0) {
                return res.status(404).json({ message: 'Product not found' });
            }

            const product = products[0];
            
            const [variants] = await db.query('SELECT * FROM variants WHERE product_id = ?', [req.params.id]);
            product.variants = variants;

            // Varyantları parse et
            if (product.variants) {
                product.variants = variants.map(variant => ({
                    ...variant,
                    name1: variant.name1 || null,
                    value1: variant.value1 || null,
                    name2: variant.name2 || null,
                    value2: variant.value2 || null,
                    quantity: variant.quantity || 0,
                    price: variant.price || product.price
                }));
            }

            res.json(product);
        } catch (error) {
            console.error('Error fetching product:', error);
            res.status(500).json({ 
                message: 'Error fetching product',
                error: error.message 
            });
        }
    },

    // Bebek ürünlerini getir
    async getBabyProducts(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 12;
            const offset = (page - 1) * limit;
            const category = req.query.category;
            const subcategory = req.query.subcategory;
            const search = req.query.search;
            
            // Temel WHERE koşulu
            let whereClause = `
                WHERE (top_category LIKE '%BEBEK%' 
                   OR top_category LIKE '%Bebek%'
                   OR main_category LIKE '%BEBEK%'
                   OR main_category LIKE '%Bebek%')
            `;
            let queryParams = [];

            // Arama filtresi ekle
            if (search) {
                whereClause += ` AND (
                    name LIKE ? 
                    OR description LIKE ? 
                    OR productCode LIKE ?
                )`;
                queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            
            // Kategori filtresi ekle
            if (category) {
                whereClause += ' AND main_category = ?';
                queryParams.push(category);
            }
            
            // Alt kategori filtresi ekle
            if (subcategory) {
                whereClause += ' AND sub_category = ?';
                queryParams.push(subcategory);
            }
            
            // Limit ve offset parametrelerini ekle
            queryParams.push(limit, offset);
            
            // MySQL sorgusu ile bebek ürünlerini alalım
            const [products] = await db.query(`
                SELECT * FROM products 
                ${whereClause}
                ORDER BY id DESC
                LIMIT ? OFFSET ?
            `, queryParams);
            
            // Toplam ürün sayısını alalım
            const countParams = queryParams.slice(0, -2); // limit ve offset parametrelerini çıkar
            const [countResult] = await db.query(`
                SELECT COUNT(*) as total FROM products 
                ${whereClause}
            `, countParams);
            
            const total = countResult[0].total;
            
            // Her ürün için varyantları alalım
            for (const product of products) {
                const [variants] = await db.query(`
                    SELECT id, name1, value1, name2, value2, quantity, barcode
                    FROM variants 
                    WHERE product_id = ?
                `, [product.id]);
                
                // Varyantları ürüne ekleyelim
                product.variants = variants || [];
            }
            
            res.json({
                products,
                pagination: {
                    page: page,
                    totalPages: Math.ceil(total / limit),
                    total: total,
                    limit: limit
                }
            });
        } catch (error) {
            console.error('Bebek ürünleri getirme hatası:', error);
            res.status(500).json({ 
                error: 'Bebek ürünleri getirilirken bir hata oluştu',
                details: error.message 
            });
        }
    },

    // Bebek kategorilerini getir
    async getBabyCategories(req, res) {
        try {
            // MySQL sorgusu - 'type' sütunu yerine top_category ve main_category kullanıyoruz
            const [categories] = await db.query(`
                SELECT DISTINCT 
                    main_category as name,
                    sub_category as subcategory_name
                FROM products 
                WHERE top_category LIKE '%BEBEK%' 
                   OR top_category LIKE '%Bebek%'
                   OR main_category LIKE '%BEBEK%'
                   OR main_category LIKE '%Bebek%'
                ORDER BY main_category, sub_category
            `);
            
            // Kategorileri düzenleyelim
            const formattedCategories = categories.reduce((acc, curr) => {
                const existingCategory = acc.find(cat => cat.name === curr.name);
                if (existingCategory) {
                    if (curr.subcategory_name && !existingCategory.subcategories.includes(curr.subcategory_name)) {
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
            console.error('Bebek kategorileri getirme hatası:', error);
            res.status(500).json({ error: 'Bebek kategorileri getirilirken bir hata oluştu' });
        }
    },

    // Kadın ürünlerini getir
    async getWomenProducts(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 32;
            const offset = (page - 1) * limit;
            const category = req.query.category;
            const subcategory = req.query.subcategory;
            const search = req.query.search;

            // Temel WHERE koşulu
            let whereClause = `WHERE (p.main_category = 'KADIN'
                OR p.main_category = 'women'
                OR p.top_category LIKE '%KADIN%'
                OR p.top_category LIKE '%Kadın%')`;
            let queryParams = [];

            // Arama filtresi ekle
            if (search) {
                whereClause += ' AND (p.name LIKE ? OR p.description LIKE ?)';
                queryParams.push(`%${search}%`, `%${search}%`);
            }

            // Kategori filtresi ekle
            if (category) {
                whereClause += ' AND p.top_category = ?';
                queryParams.push(category);
            }

            // Alt kategori filtresi ekle
            if (subcategory) {
                whereClause += ' AND p.sub_category = ?';
                queryParams.push(subcategory);
            }

            // Limit ve offset parametrelerini ekle
            queryParams.push(limit, offset);

            // Ürünleri ve varyantları getir
            const [products] = await db.query(`
                SELECT 
                    p.*,
                    GROUP_CONCAT(
                        JSON_OBJECT(
                            'name1', v.name1,
                            'value1', v.value1,
                            'name2', v.name2,
                            'value2', v.value2,
                            'quantity', v.quantity,
                            'barcode', v.barcode
                        ) SEPARATOR ','
                    ) as variants
                FROM products p
                LEFT JOIN variants v ON p.id = v.product_id
                ${whereClause}
                GROUP BY p.id
                ORDER BY p.id DESC
                LIMIT ? OFFSET ?
            `, queryParams);

            // Toplam sayı için WHERE koşulunu kullan
            const [total] = await db.query(`
                SELECT COUNT(DISTINCT p.id) as total
                FROM products p
                ${whereClause}
            `, queryParams.slice(0, -2));

            // Kategorileri getir
            const [categories] = await db.query(`
                SELECT DISTINCT 
                    top_category AS name,
                    sub_category
                FROM products
                WHERE (main_category = 'KADIN' 
                    OR main_category = 'women'
                    OR top_category LIKE '%KADIN%'
                    OR top_category LIKE '%Kadın%')
                    AND sub_category IS NOT NULL
                    AND sub_category != ''
                ORDER BY top_category, sub_category
            `);

            // Kategorileri düzenle
            const categoryMap = new Map();
            categories.forEach(cat => {
                if (!categoryMap.has(cat.name)) {
                    categoryMap.set(cat.name, {
                        name: cat.name,
                        items: []
                    });
                }
                if (cat.sub_category) {
                    categoryMap.get(cat.name).items.push(cat.sub_category);
                }
            });

            const formattedCategories = Array.from(categoryMap.values());

            res.json({
                products: products.map(p => ({
                    ...p,
                    variants: parseVariants(p.variants)
                })),
                categories: formattedCategories,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total[0].total / limit),
                    totalItems: total[0].total
                }
            });
        } catch (error) {
            console.error('Kadın ürünleri getirme hatası:', error);
            res.status(500).json({ error: 'Ürünler yüklenirken bir hata oluştu' });
        }
    },

    // Erkek ürünlerini getir
    async getMenProducts(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 32;
            const offset = (page - 1) * limit;
            const category = req.query.category;
            const subcategory = req.query.subcategory;
            const search = req.query.search;

            // Temel WHERE koşulu - Erkek ürünleri için daha kapsamlı kontrol
            let whereClause = `
                WHERE (
                    p.main_category = 'ERKEK' 
                    OR p.main_category = 'men'
                    OR p.top_category LIKE '%ERKEK%'
                    OR p.top_category LIKE '%Erkek%'
                )
                AND p.top_category NOT LIKE '%BEBEK%'
                AND p.top_category NOT LIKE '%ÇOCUK%'
                AND p.top_category NOT LIKE '%COCUK%'
            `;
            let queryParams = [];

            // Arama filtresi ekle
            if (search) {
                console.log('Arama yapılıyor:', {
                    search,
                    whereClause,
                    queryParams
                });
                whereClause += ` AND (
                    p.name LIKE ? 
                    OR p.description LIKE ? 
                    OR p.productCode LIKE ?
                )`;
                queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            // Kategori filtresi ekle
            if (category) {
                whereClause += ' AND p.top_category = ?';
                queryParams.push(category);
            }

            // Alt kategori filtresi ekle
            if (subcategory) {
                whereClause += ' AND p.sub_category = ?';
                queryParams.push(subcategory);
            }

            // Limit ve offset ekle
            queryParams.push(limit, offset);

            // Ürünleri getir
            const [products] = await db.query(`
                SELECT 
                    p.*,
                    GROUP_CONCAT(
                        JSON_OBJECT(
                            'name1', v.name1,
                            'value1', v.value1,
                            'name2', v.name2,
                            'value2', v.value2,
                            'quantity', v.quantity,
                            'barcode', v.barcode
                        ) SEPARATOR ','
                    ) as variants
                FROM products p
                LEFT JOIN variants v ON p.id = v.product_id
                ${whereClause}
                GROUP BY p.id
                ORDER BY p.id DESC
                LIMIT ? OFFSET ?
            `, queryParams);

            // Toplam sayı için WHERE koşulunu kullan
            const [total] = await db.query(`
                SELECT COUNT(DISTINCT p.id) as total
                FROM products p
                ${whereClause}
            `, queryParams.slice(0, -2));

            // Kategorileri getir
            const [categories] = await db.query(`
                SELECT DISTINCT 
                    top_category,
                    sub_category
                FROM products
                WHERE top_category LIKE '%ERKEK%'
                AND top_category NOT LIKE '%BEBEK%'
                AND top_category NOT LIKE '%ÇOCUK%'
                AND top_category NOT LIKE '%COCUK%'
                AND sub_category IS NOT NULL
                AND sub_category != ''
                ORDER BY top_category, sub_category
            `);

            // Kategorileri düzenle
            const categoryMap = new Map();
            categories.forEach(cat => {
                if (!categoryMap.has(cat.top_category)) {
                    categoryMap.set(cat.top_category, new Set());
                }
                if (cat.sub_category) {
                    categoryMap.get(cat.top_category).add(cat.sub_category);
                }
            });

            const formattedCategories = Array.from(categoryMap.entries()).map(([name, items]) => ({
                name,
                items: Array.from(items).sort()
            }));

            // Sonuçları logla
            console.log('Bulunan ürün sayısı:', products.length);

            res.json({
                products: products.map(p => ({
                    ...p,
                    variants: parseVariants(p.variants)
                })),
                categories: formattedCategories,
                pagination: {
                    page: page,
                    totalPages: Math.ceil(total[0].total / limit),
                    total: total[0].total,
                    limit: limit
                }
            });
        } catch (error) {
            console.error('Erkek ürünleri getirme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Ürünler alınırken bir hata oluştu'
            });
        }
    },

    // Toplu ürün bilgilerini getir
    async getBatchProducts(req, res) {
        try {
            const ids = req.query.ids;
            
            if (!ids) {
                return res.status(400).json({
                    success: false,
                    message: 'Ürün ID\'leri belirtilmedi'
                });
            }
            
            console.log('Gelen ürün ID\'leri:', ids);
            
            // Virgülle ayrılmış ID'leri diziye çevir ve sayıya dönüştür
            const productIds = ids.split(',')
                .map(id => {
                    const parsedId = parseInt(id.trim());
                    if (isNaN(parsedId)) {
                        console.warn('Geçersiz ürün ID\'si:', id);
                    }
                    return parsedId;
                })
                .filter(id => !isNaN(id)); // Geçersiz ID'leri filtrele
            
            console.log('İşlenmiş ürün ID\'leri:', productIds);
            
            if (productIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Geçerli ürün ID\'leri bulunamadı'
                });
            }
            
            // Ürünleri getir
            const [products] = await db.query(
                'SELECT * FROM products WHERE id IN (?)',
                [productIds]
            );
            
            console.log(`${products.length} ürün bulundu`);
            
            // Her ürün için varyantları getir
            const productsWithVariants = await Promise.all(products.map(async (product) => {
                const [variants] = await db.query(
                    'SELECT * FROM variants WHERE product_id = ?',
                    [product.id]
                );
                
                return {
                    ...product,
                    variants
                };
            }));
            
            res.json({
                success: true,
                products: productsWithVariants
            });
        } catch (error) {
            console.error('Toplu ürün bilgileri getirme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Ürün bilgileri yüklenirken bir hata oluştu',
                error: error.message
            });
        }
    }
};

// Yardımcı fonksiyonlar
async function parseAndSaveProducts(xmlData) {
    try {
        const parser = new xml2js.Parser({ 
            explicitArray: false,
            trim: true,
            explicitRoot: true,
            mergeAttrs: true
        });

        console.log('Parsing XML data...');
        const result = await parser.parseStringPromise(xmlData);
        console.log('XML successfully parsed');

        if (!result || !result.products || !result.products.product) {
            throw new Error('Invalid XML structure: missing products or product elements');
        }

        const products = Array.isArray(result.products.product) ? 
            result.products.product : [result.products.product];

        console.log(`Found ${products.length} products to process`);

        for (const product of products) {
            await saveProduct(product);
        }

        return products.length;
    } catch (error) {
        console.error('Error parsing XML:', error);
        throw error;
    }
}

async function saveProduct(product) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Ana ürün bilgilerini kaydet
        await connection.query(
            `INSERT INTO products SET ? ON DUPLICATE KEY UPDATE ?`,
            [
                {
                    id: product.id,
                    productCode: product.productCode,
                    barcode: product.barcode,
                    main_category: product.main_category,
                    top_category: product.top_category,
                    sub_category: product.sub_category,
                    categoryID: product.categoryID,
                    category: product.category,
                    active: product.active === '1',
                    brandID: product.brandID,
                    brand: product.brand,
                    name: product.name,
                    description: product.description,
                    image1: product.image1,
                    image2: product.image2,
                    image3: product.image3,
                    image4: product.image4,
                    image5: product.image5,
                    image6: product.image6,
                    image7: product.image7,
                    image8: product.image8,
                    image9: product.image9,
                    listPrice: product.listPrice,
                    price: product.price,
                    tax: product.tax,
                    currency: product.currency,
                    desi: product.desi,
                    quantity: product.quantity,
                    domestic: product.domestic === '1',
                    show_home: product.show_home === '1',
                    in_discount: product.in_discount === '1',
                    detail: product.detail
                },
                {
                    id: product.id,
                    productCode: product.productCode,
                    barcode: product.barcode,
                    main_category: product.main_category,
                    top_category: product.top_category,
                    sub_category: product.sub_category,
                    categoryID: product.categoryID,
                    category: product.category,
                    active: product.active === '1',
                    brandID: product.brandID,
                    brand: product.brand,
                    name: product.name,
                    description: product.description,
                    image1: product.image1,
                    image2: product.image2,
                    image3: product.image3,
                    image4: product.image4,
                    image5: product.image5,
                    image6: product.image6,
                    image7: product.image7,
                    image8: product.image8,
                    image9: product.image9,
                    listPrice: product.listPrice,
                    price: product.price,
                    tax: product.tax,
                    currency: product.currency,
                    desi: product.desi,
                    quantity: product.quantity,
                    domestic: product.domestic === '1',
                    show_home: product.show_home === '1',
                    in_discount: product.in_discount === '1',
                    detail: product.detail
                }
            ]
        );

        // Varyantları kaydet
        if (product.variants && product.variants.variant) {
            // Önce bu ürüne ait eski varyantları sil
            await connection.query('DELETE FROM variants WHERE product_id = ?', [product.id]);

            // Varyantları diziye çevir
            const variants = Array.isArray(product.variants.variant) ? 
                product.variants.variant : [product.variants.variant];

            // Her varyant için
            for (const variant of variants) {
                // CDATA içeriğini temizle
                const cleanVariant = {
                    product_id: product.id,
                    name1: variant.name1?.['_'] || variant.name1 || null,
                    value1: variant.value1?.['_'] || variant.value1 || null,
                    name2: variant.name2?.['_'] || variant.name2 || null,
                    value2: variant.value2?.['_'] || variant.value2 || null,
                    quantity: parseInt(variant.quantity) || 0,
                    barcode: variant.barcode || null
                };

                // Varyantı ekle
                await connection.query(
                    'INSERT INTO variants SET ?',
                    cleanVariant
                );
            }
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function fetchXmlFromUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? require('https') : require('http');
        
        const request = client.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to load XML, status code: ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => { 
                data += chunk; 
            });
            
            res.on('end', () => {
                if (!data) {
                    reject(new Error('No data received from URL'));
                    return;
                }
                resolve(data);
            });
        });

        request.on('error', (err) => {
            reject(new Error(`Request failed: ${err.message}`));
        });

        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Request timeout after 30 seconds'));
        });
    });
}

// Variants'ları parse etme fonksiyonu
function parseVariants(variants) {
    if (!variants) return [];
    try {
        if (typeof variants === 'string') {
            // GROUP_CONCAT ile gelen string'i düzelt
            const cleanedJson = variants.replace(/\}\{/g, '},{');
            return JSON.parse(`[${cleanedJson}]`);
        }
        return variants;
    } catch (error) {
        console.error('Varyant parse hatası:', error);
        return [];
    }
}

module.exports = productController; 