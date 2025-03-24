const db = require('../config/db');
const axios = require('axios');
const xml2js = require('xml2js');
const xmlController = require('./xmlController');

// XML yükleme ilerleme durumunu tutan obje
const uploadProgress = new Map();

const adminController = {
    // Admin girişi
    async login(req, res) {
        try {
            const { username, password } = req.body;

            // Kullanıcı adı ve şifreyi kontrol et
            const [admins] = await db.query(
                'SELECT * FROM admins WHERE username = ? AND password = ?',
                [username, password]
            );

            if (admins.length > 0) {
                // Giriş başarılı
                res.json({
                    success: true,
                    message: 'Giriş başarılı'
                });
            } else {
                // Giriş başarısız
                res.status(401).json({
                    success: false,
                    message: 'Geçersiz kullanıcı adı veya şifre'
                });
            }
        } catch (error) {
            console.error('Admin giriş hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Giriş işlemi sırasında bir hata oluştu'
            });
        }
    },

    // Dashboard verilerini getir
    async getDashboardData(req, res) {
        try {
            // Toplam ürün sayısı
            const [productCount] = await db.query('SELECT COUNT(*) as total FROM products');
            
            // Toplam müşteri sayısı
            const [customerCount] = await db.query('SELECT COUNT(*) as total FROM users');
            
            // Son siparişler (son 5 sipariş) - daha detaylı bilgilerle
            const [recentOrders] = await db.query(`
                SELECT 
                    o.id,
                    o.order_number,
                    o.user_id,
                    CONCAT(u.first_name, ' ', u.last_name) as customer_name,
                    o.total_amount,
                    o.status,
                    o.created_at,
                    a.full_name as shipping_name,
                    a.address as shipping_address,
                    a.city as shipping_city,
                    a.district as shipping_district
                FROM orders o
                LEFT JOIN users u ON o.user_id = u.id
                LEFT JOIN addresses a ON o.shipping_address_id = a.id
                ORDER BY o.created_at DESC
                LIMIT 5
            `);
            
            // Her sipariş için sipariş öğelerini getir
            const ordersWithItems = await Promise.all(recentOrders.map(async (order) => {
                const [items] = await db.query(`
                    SELECT 
                        oi.*,
                        p.name as product_name,
                        p.image1 as product_image
                    FROM order_items oi
                    LEFT JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = ?
                `, [order.id]);
                
                return {
                    ...order,
                    items,
                    created_at: new Date(order.created_at).toLocaleString('tr-TR'),
                    total_amount: new Intl.NumberFormat('tr-TR', {
                        style: 'currency',
                        currency: 'TRY'
                    }).format(order.total_amount)
                };
            }));

            // Toplam gelir
            const [revenue] = await db.query(`
                SELECT COALESCE(SUM(total_amount), 0) as total 
                FROM orders 
                WHERE status = 'completed'
            `);

            res.json({
                success: true,
                data: {
                    totalProducts: productCount[0].total,
                    totalCustomers: customerCount[0].total,
                    totalRevenue: revenue[0].total,
                    recentOrders: ordersWithItems
                }
            });
        } catch (error) {
            console.error('Dashboard veri hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Dashboard verileri yüklenirken bir hata oluştu'
            });
        }
    },

    // URL'den XML yükleme
    async uploadXmlFromUrl(req, res) {
        try {
            const { url } = req.body;
            console.log('XML yüklenecek URL:', url); // URL'yi logla

            if (!url) {
                return res.status(400).json({
                    success: false,
                    message: 'URL gerekli'
                });
            }

            // URL'nin daha önce eklenip eklenmediğini kontrol et
            const [existing] = await db.query('SELECT id FROM xml_urls WHERE url = ?', [url]);
            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Bu XML URL\'si zaten eklenmiş'
                });
            }

            // XML URL'sini kaydet
            const [result] = await db.query(`
                INSERT INTO xml_urls (
                    url, 
                    status,
                    next_update
                ) VALUES (
                    ?, 
                    'active',
                    DATE_ADD(NOW(), INTERVAL 12 HOUR)
                )
            `, [url]);

            // Progress için benzersiz bir ID oluştur
            const progressId = Date.now().toString();
            uploadProgress.set(progressId, {
                progress: 0,
                status: 'Başlatılıyor...',
                currentCount: 0,
                totalCount: 0
            });

            // XML yükleme işlemini başlat
            xmlController.updateFromUrl(url, result.insertId, (progress) => {
                uploadProgress.set(progressId, progress);
            }).then(async () => {
                // Ürün sayısını güncelle
                const [count] = await db.query(
                    'SELECT COUNT(*) as count FROM products WHERE xml_url_id = ?', 
                    [result.insertId]
                );
                
                await db.query(
                    'UPDATE xml_urls SET product_count = ? WHERE id = ?', 
                    [count[0].count, result.insertId]
                );

                // Progress'i temizle
                setTimeout(() => {
                    uploadProgress.delete(progressId);
                }, 5000);
            });

            res.json({
                success: true,
                progressId,
                xmlId: result.insertId
            });
        } catch (error) {
            console.error('XML ekleme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'XML eklenirken bir hata oluştu: ' + error.message
            });
        }
    },

    // Progress durumunu kontrol etmek için endpoint
    async getUploadProgress(req, res) {
        const { progressId } = req.params;
        
        // SSE header'ları
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Progress'i kontrol eden interval
        const interval = setInterval(() => {
            const progress = uploadProgress.get(progressId);
            if (progress) {
                res.write(`data: ${JSON.stringify(progress)}\n\n`);
                
                if (progress.progress === 100) {
                    clearInterval(interval);
                    res.end();
                }
            }
        }, 1000);

        // Bağlantı kapandığında interval'i temizle
        req.on('close', () => {
            clearInterval(interval);
        });
    },

    // XML dosyasından yükleme
    async uploadXmlFile(req, res) {
        try {
            if (!req.files || !req.files.xmlFile) {
                return res.status(400).json({
                    success: false,
                    message: 'XML dosyası gerekli'
                });
            }

            const xmlData = req.files.xmlFile.data.toString();
            
            // XML'i parse et
            const parser = new xml2js.Parser({ 
                explicitArray: false,
                valueProcessors: [xml2js.processors.parseBooleans, xml2js.processors.parseNumbers]
            });
            
            const result = await parser.parseStringPromise(xmlData);
            
            if (!result || !result.products || !result.products.product) {
                throw new Error('Geçersiz XML formatı');
            }

            const products = Array.isArray(result.products.product) ? 
                           result.products.product : [result.products.product];

            let uploadedCount = 0;

            for (const product of products) {
                try {
                    // CDATA içeriğini temizle
                    const cleanProduct = {
                        id: product.id,
                        productCode: product.productCode,
                        barcode: product.barcode,
                        main_category: product.main_category?.['_'] || product.main_category,
                        top_category: product.top_category?.['_'] || product.top_category,
                        sub_category: product.sub_category?.['_'] || product.sub_category,
                        categoryID: product.categoryID,
                        category: product.category?.['_'] || product.category,
                        active: product.active,
                        brandID: product.brandID,
                        brand: product.brand?.['_'] || product.brand,
                        name: product.name?.['_'] || product.name,
                        description: product.description?.['_'] || product.description,
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
                        domestic: product.domestic,
                        show_home: product.show_home,
                        in_discount: product.in_discount,
                        detail: product.detail?.['_'] || product.detail
                    };

                    // Ürünü ekle
                    await db.query(`
                        INSERT INTO products SET ?
                        ON DUPLICATE KEY UPDATE
                        productCode = VALUES(productCode),
                        barcode = VALUES(barcode),
                        main_category = VALUES(main_category),
                        top_category = VALUES(top_category),
                        sub_category = VALUES(sub_category),
                        categoryID = VALUES(categoryID),
                        category = VALUES(category),
                        active = VALUES(active),
                        brandID = VALUES(brandID),
                        brand = VALUES(brand),
                        name = VALUES(name),
                        description = VALUES(description),
                        image1 = VALUES(image1),
                        image2 = VALUES(image2),
                        image3 = VALUES(image3),
                        image4 = VALUES(image4),
                        image5 = VALUES(image5),
                        image6 = VALUES(image6),
                        image7 = VALUES(image7),
                        image8 = VALUES(image8),
                        image9 = VALUES(image9),
                        listPrice = VALUES(listPrice),
                        price = VALUES(price),
                        tax = VALUES(tax),
                        currency = VALUES(currency),
                        desi = VALUES(desi),
                        quantity = VALUES(quantity),
                        domestic = VALUES(domestic),
                        show_home = VALUES(show_home),
                        in_discount = VALUES(in_discount),
                        detail = VALUES(detail)
                    `, cleanProduct);

                    // Varyantları ekle
                    if (product.variants && product.variants.variant) {
                        const variants = Array.isArray(product.variants.variant) ? 
                            product.variants.variant : [product.variants.variant];

                        // Önce bu ürüne ait eski varyantları sil
                        await db.query('DELETE FROM variants WHERE product_id = ?', [product.id]);

                        // Yeni varyantları ekle
                        for (const variant of variants) {
                            await db.query(`
                                INSERT INTO variants (
                                    product_id, name1, value1, name2, value2, quantity, barcode
                                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                            `, [
                                product.id,
                                variant.name1,
                                variant.value1,
                                variant.name2,
                                variant.value2,
                                variant.quantity,
                                variant.barcode
                            ]);
                        }
                    }

                    uploadedCount++;
                } catch (err) {
                    console.error('Ürün ekleme hatası:', err);
                }
            }

            res.json({
                success: true,
                message: `${uploadedCount} ürün başarıyla işlendi`,
                uploadedCount
            });

        } catch (error) {
            console.error('XML dosya yükleme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'XML yüklenirken bir hata oluştu: ' + error.message
            });
        }
    },

    // Ürünleri getir
    async getProducts(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';
            const category = req.query.category || '';
            const stock = req.query.stock || '';

            let query = 'SELECT * FROM products WHERE 1=1';
            let countQuery = 'SELECT COUNT(*) as total FROM products WHERE 1=1';
            const params = [];

            if (search) {
                query += ' AND (name LIKE ? OR description LIKE ?)';
                countQuery += ' AND (name LIKE ? OR description LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            if (category) {
                query += ' AND category = ?';
                countQuery += ' AND category = ?';
                params.push(category);
            }

            if (stock === 'inStock') {
                query += ' AND quantity > 0';
                countQuery += ' AND quantity > 0';
            } else if (stock === 'outOfStock') {
                query += ' AND quantity <= 0';
                countQuery += ' AND quantity <= 0';
            }

            query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const [products] = await db.query(query, params);
            const [countResult] = await db.query(countQuery, params.slice(0, -2));
            const total = countResult[0].total;

            res.json({
                products,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    total,
                    limit
                }
            });
        } catch (error) {
            console.error('Ürünler getirilirken hata:', error);
            res.status(500).json({
                success: false,
                message: 'Ürünler getirilirken bir hata oluştu'
            });
        }
    },

    // Ürün güncelle
    async updateProduct(req, res) {
        try {
            const { id } = req.params;
            const { name, price, category, quantity, active } = req.body;
            
            await db.query(
                'UPDATE products SET name = ?, price = ?, category = ?, quantity = ?, active = ? WHERE id = ?',
                [name, price, category, quantity, active, id]
            );
            
            res.json({ success: true, message: 'Ürün başarıyla güncellendi' });
        } catch (error) {
            console.error('Ürün güncelleme hatası:', error);
            res.status(500).json({ success: false, message: 'Ürün güncellenirken bir hata oluştu' });
        }
    },

    // Ürün sil
    async deleteProduct(req, res) {
        try {
            const { id } = req.params;
            await db.query('DELETE FROM products WHERE id = ?', [id]);
            res.json({ success: true, message: 'Ürün başarıyla silindi' });
        } catch (error) {
            console.error('Ürün silme hatası:', error);
            res.status(500).json({ success: false, message: 'Ürün silinirken bir hata oluştu' });
        }
    },

    // Yeni ürün ekleme
    async addProduct(req, res) {
        try {
            const { name, price, category, quantity, active } = req.body;
            
            const [result] = await db.query(
                'INSERT INTO products (name, price, category, quantity, active) VALUES (?, ?, ?, ?, ?)',
                [name, price, category, quantity, active]
            );
            
            res.json({ 
                success: true, 
                message: 'Ürün başarıyla eklendi',
                productId: result.insertId 
            });
        } catch (error) {
            console.error('Ürün ekleme hatası:', error);
            res.status(500).json({ success: false, message: 'Ürün eklenirken bir hata oluştu' });
        }
    },

    // Müşterileri getir
    async getCustomers(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';
            const status = req.query.status || '';
            
            let query = `
                SELECT 
                    id,
                    first_name,
                    last_name,
                    email,
                    phone,
                    birth_date,
                    created_at,
                    last_login,
                    status
                FROM users
                WHERE 1=1
            `;
            
            const params = [];
            
            if (search) {
                query += ` AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)`;
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }
            
            // Toplam kayıt sayısı
            const [countResult] = await db.query(
                `SELECT COUNT(*) as total FROM users WHERE 1=1 
                 ${search ? 'AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)' : ''}
                 ${status ? 'AND status = ?' : ''}`,
                params
            );
            
            // Sayfalama
            query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
            params.push(limit, offset);
            
            const [customers] = await db.query(query, params);
            
            res.json({
                customers: customers.map(customer => ({
                    ...customer,
                    created_at: customer.created_at ? new Date(customer.created_at).toLocaleString('tr-TR') : null,
                    last_login: customer.last_login ? new Date(customer.last_login).toLocaleString('tr-TR') : null,
                    birth_date: customer.birth_date ? new Date(customer.birth_date).toLocaleDateString('tr-TR') : null
                })),
                currentPage: page,
                totalPages: Math.ceil(countResult[0].total / limit),
                total: countResult[0].total
            });
        } catch (error) {
            console.error('Müşteriler getirilirken hata:', error);
            res.status(500).json({
                success: false,
                message: 'Müşteriler getirilirken bir hata oluştu'
            });
        }
    },

    // Müşteri durumunu değiştir
    async toggleCustomerStatus(req, res) {
        try {
            const customerId = req.params.id;
            
            // Mevcut durumu kontrol et
            const [customer] = await db.query('SELECT status FROM users WHERE id = ?', [customerId]);
            
            if (customer.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Müşteri bulunamadı'
                });
            }

            const newStatus = customer[0].status === 'active' ? 'inactive' : 'active';
            
            await db.query('UPDATE users SET status = ? WHERE id = ?', [newStatus, customerId]);

            res.json({
                success: true,
                message: 'Müşteri durumu güncellendi'
            });
        } catch (error) {
            console.error('Müşteri durumu güncellenirken hata:', error);
            res.status(500).json({
                success: false,
                message: 'Müşteri durumu güncellenirken bir hata oluştu'
            });
        }
    },

    // Müşterileri dışa aktar
    async exportCustomers(req, res) {
        try {
            const [customers] = await db.query(`
                SELECT 
                    id,
                    first_name,
                    last_name,
                    email,
                    phone,
                    created_at,
                    last_login,
                    status
                FROM users
                ORDER BY created_at DESC
            `);

            const csvHeader = 'ID,Ad,Soyad,E-posta,Telefon,Kayıt Tarihi,Son Giriş,Durum\n';
            const csvRows = customers.map(customer => {
                return `${customer.id},${customer.first_name},${customer.last_name},${customer.email},${customer.phone || ''},${customer.created_at},${customer.last_login || ''},${customer.status}`;
            }).join('\n');

            const csv = csvHeader + csvRows;

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=musteriler-${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csv);
        } catch (error) {
            console.error('Müşteriler dışa aktarılırken hata:', error);
            res.status(500).json({
                success: false,
                message: 'Müşteriler dışa aktarılırken bir hata oluştu'
            });
        }
    },

    // Yetki kontrolü
    async checkAuth(req, res) {
        try {
            // Burada gerçek yetki kontrolü yapılabilir
            res.json({ success: true });
        } catch (error) {
            res.status(401).json({
                success: false,
                message: 'Yetkisiz erişim'
            });
        }
    },

    // Tüm siparişleri getir
    async getOrders(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            
            // Toplam sipariş sayısını al
            const [countResult] = await db.query('SELECT COUNT(*) as total FROM orders');
            const totalOrders = countResult[0].total;
            
            // Siparişleri getir
            const [orders] = await db.query(`
                SELECT 
                    o.id,
                    o.order_number,
                    o.user_id,
                    CONCAT(u.first_name, ' ', u.last_name) as customer_name,
                    o.total_amount,
                    o.status,
                    o.payment_status,
                    o.created_at,
                    a.full_name as shipping_name,
                    a.address as shipping_address,
                    a.city as shipping_city,
                    a.district as shipping_district
                FROM orders o
                LEFT JOIN users u ON o.user_id = u.id
                LEFT JOIN addresses a ON o.shipping_address_id = a.id
                ORDER BY o.created_at DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);
            
            // Her sipariş için sipariş öğelerini getir
            const ordersWithItems = await Promise.all(orders.map(async (order) => {
                const [items] = await db.query(`
                    SELECT 
                        oi.*,
                        p.name as product_name,
                        p.image1 as product_image
                    FROM order_items oi
                    LEFT JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = ?
                `, [order.id]);
                
                return {
                    ...order,
                    items,
                    created_at: new Date(order.created_at).toLocaleString('tr-TR'),
                    total_amount: new Intl.NumberFormat('tr-TR', {
                        style: 'currency',
                        currency: 'TRY'
                    }).format(order.total_amount)
                };
            }));
            
            // Sayfalama bilgilerini hesapla
            const totalPages = Math.ceil(totalOrders / limit);
            
            res.json({
                success: true,
                orders: ordersWithItems,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalOrders,
                    itemsPerPage: limit
                }
            });
        } catch (error) {
            console.error('Siparişleri getirme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Siparişler yüklenirken bir hata oluştu'
            });
        }
    },

    // Sipariş durumunu güncelle
    async updateOrderStatus(req, res) {
        try {
            const { id } = req.params;
            const { status } = req.body;
            
            // Geçerli durumlar
            const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
            
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Geçersiz sipariş durumu'
                });
            }
            
            // Siparişi güncelle
            await db.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
            
            res.json({
                success: true,
                message: 'Sipariş durumu güncellendi'
            });
        } catch (error) {
            console.error('Sipariş durumu güncelleme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Sipariş durumu güncellenirken bir hata oluştu'
            });
        }
    },

    // Siparişleri dışa aktar
    async exportOrders(req, res) {
        try {
            const [orders] = await db.query(`
                SELECT 
                    o.order_number,
                    CONCAT(u.first_name, ' ', u.last_name) as customer_name,
                    u.email as customer_email,
                    o.total_amount,
                    o.status,
                    o.payment_status,
                    o.created_at
                FROM orders o
                LEFT JOIN users u ON o.user_id = u.id
                ORDER BY o.created_at DESC
            `);

            const csvHeader = 'Sipariş No,Müşteri,E-posta,Toplam Tutar,Durum,Ödeme Durumu,Tarih\n';
            const csvRows = orders.map(order => {
                return `${order.order_number},${order.customer_name},${order.customer_email},${order.total_amount},${order.status},${order.payment_status},${order.created_at}`;
            }).join('\n');

            const csv = csvHeader + csvRows;

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=siparisler-${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csv);
        } catch (error) {
            console.error('Siparişler dışa aktarılırken hata:', error);
            res.status(500).json({
                success: false,
                message: 'Siparişler dışa aktarılırken bir hata oluştu'
            });
        }
    },

    // XML listesini getir
    async getXmlUploads(req, res) {
        try {
            const [xmlUploads] = await db.query(`
                SELECT 
                    x.id,
                    x.url,
                    x.status,
                    x.product_count,
                    x.last_update,
                    x.next_update,
                    x.created_at,
                    COUNT(p.id) as current_product_count
                FROM xml_urls x
                LEFT JOIN products p ON x.id = p.xml_url_id
                GROUP BY x.id
                ORDER BY x.created_at DESC
            `);

            res.json({
                success: true,
                xmlUploads: xmlUploads.map(xml => ({
                    ...xml,
                    product_count: xml.current_product_count, // Gerçek ürün sayısını kullan
                    last_update: xml.last_update ? new Date(xml.last_update).toLocaleString('tr-TR') : '-',
                    next_update: xml.next_update ? new Date(xml.next_update).toLocaleString('tr-TR') : '-',
                    created_at: new Date(xml.created_at).toLocaleString('tr-TR')
                }))
            });
        } catch (error) {
            console.error('XML listesi getirme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'XML listesi alınırken bir hata oluştu'
            });
        }
    },

    // XML durumunu değiştir
    async toggleXmlStatus(req, res) {
        try {
            const { id } = req.params;

            // Mevcut durumu kontrol et
            const [current] = await db.query('SELECT status FROM xml_urls WHERE id = ?', [id]);
            if (!current.length) {
                return res.status(404).json({
                    success: false,
                    message: 'XML kaydı bulunamadı'
                });
            }

            // Durumu değiştir
            const newStatus = current[0].status === 'active' ? 'inactive' : 'active';
            await db.query('UPDATE xml_urls SET status = ? WHERE id = ?', [newStatus, id]);

            // Eğer pasif yapılıyorsa, ürünleri sil (trigger bunu otomatik yapacak)

            res.json({
                success: true,
                message: `XML ${newStatus === 'active' ? 'aktif' : 'pasif'} duruma getirildi`,
                status: newStatus
            });
        } catch (error) {
            console.error('XML durumu değiştirme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'XML durumu değiştirilirken bir hata oluştu'
            });
        }
    },

    // XML silme işlemi
    async deleteXml(req, res) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const xmlId = req.params.id;

            // Önce bu XML'e ait ürünleri sil
            await connection.query('DELETE FROM products WHERE xml_url_id = ?', [xmlId]);
            
            // Sonra XML kaydını sil
            await connection.query('DELETE FROM xml_urls WHERE id = ?', [xmlId]);

            await connection.commit();

            res.json({
                success: true,
                message: 'XML ve ilişkili ürünler başarıyla silindi'
            });
        } catch (error) {
            await connection.rollback();
            console.error('XML silme hatası:', error);
            res.status(500).json({
                success: false,
                message: 'XML silinirken bir hata oluştu'
            });
        } finally {
            connection.release();
        }
    }
};

module.exports = adminController; 