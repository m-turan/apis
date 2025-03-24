const db = require('../config/db');

// Kullanıcının siparişlerini getir
exports.getUserOrders = async (req, res) => {
    try {
        console.log('getUserOrders çağrıldı, user:', req.user);
        
        // req.user.id yerine req.user.userId kullanın (authController'da token oluştururken userId kullanıldı)
        const userId = req.user.userId || req.user.id;
        
        console.log('Siparişler sorgulanıyor, userId:', userId);
        
        // Kullanıcının siparişlerini veritabanından çek
        const [orders] = await db.query(`
            SELECT o.*, 
                   a1.full_name as shipping_name, 
                   a1.address as shipping_address,
                   a1.city as shipping_city,
                   a1.district as shipping_district,
                   a2.full_name as billing_name,
                   a2.address as billing_address,
                   a2.city as billing_city,
                   a2.district as billing_district
            FROM orders o
            LEFT JOIN addresses a1 ON o.shipping_address_id = a1.id
            LEFT JOIN addresses a2 ON o.billing_address_id = a2.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `, [userId]);
        
        console.log('Bulunan sipariş sayısı:', orders.length);
        
        // Her sipariş için sipariş öğelerini çek
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            const [items] = await db.query(`
                SELECT oi.*, 
                       p.name, 
                       p.image1 as image,
                       oi.variant_name1,
                       oi.variant_value1,
                       oi.variant_name2,
                       oi.variant_value2
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            `, [order.id]);
            
            console.log(`Sipariş #${order.id} için bulunan ürün sayısı:`, items.length);
            
            // Varyant bilgilerini kontrol et
            items.forEach(item => {
                console.log(`Ürün #${item.product_id} varyant bilgileri:`, {
                    variant_name1: item.variant_name1,
                    variant_value1: item.variant_value1,
                    variant_name2: item.variant_name2,
                    variant_value2: item.variant_value2
                });
            });
            
            return {
                ...order,
                items
            };
        }));
        
        res.json({ orders: ordersWithItems });
    } catch (error) {
        console.error('Siparişleri getirme hatası:', error);
        res.status(500).json({ message: 'Siparişler yüklenirken bir hata oluştu' });
    }
};

// Sipariş detaylarını getir
exports.getOrderDetails = async (req, res) => {
    try {
        const orderId = req.params.id;
        const userId = req.user.id;
        
        // Siparişin kullanıcıya ait olduğunu doğrula
        const [orderCheck] = await db.query(
            'SELECT * FROM orders WHERE id = ? AND user_id = ?',
            [orderId, userId]
        );
        
        if (orderCheck.length === 0) {
            return res.status(404).json({ message: 'Sipariş bulunamadı' });
        }
        
        // Sipariş detaylarını getir
        const [order] = await db.query(`
            SELECT o.*, 
                   a1.full_name as shipping_name, 
                   a1.address as shipping_address,
                   a1.city as shipping_city,
                   a1.district as shipping_district,
                   a1.phone as shipping_phone,
                   a1.postal_code as shipping_postal_code,
                   a2.full_name as billing_name,
                   a2.address as billing_address,
                   a2.city as billing_city,
                   a2.district as billing_district,
                   a2.phone as billing_phone,
                   a2.postal_code as billing_postal_code
            FROM orders o
            LEFT JOIN addresses a1 ON o.shipping_address_id = a1.id
            LEFT JOIN addresses a2 ON o.billing_address_id = a2.id
            WHERE o.id = ?
        `, [orderId]);
        
        // Sipariş öğelerini getir - varyant bilgilerini de al
        const [items] = await db.query(`
            SELECT oi.*, 
                   p.name, 
                   p.image1 as image,
                   oi.variant_name1,
                   oi.variant_value1,
                   oi.variant_name2,
                   oi.variant_value2
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `, [orderId]);
        
        res.json({
            order: {
                ...order[0],
                items
            }
        });
    } catch (error) {
        console.error('Sipariş detayları getirme hatası:', error);
        res.status(500).json({ message: 'Sipariş detayları yüklenirken bir hata oluştu' });
    }
};

// Sipariş oluştur
exports.createOrder = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { shipping_address_id, billing_address_id, payment_method, items } = req.body;
        
        // Veri doğrulama
        if (!shipping_address_id || !billing_address_id || !payment_method || !items || !items.length) {
            return res.status(400).json({
                success: false,
                message: 'Eksik veya hatalı bilgi gönderildi'
            });
        }
        
        // Adreslerin kullanıcıya ait olup olmadığını kontrol et
        const [addresses] = await db.query(
            'SELECT id FROM addresses WHERE (id = ? OR id = ?) AND user_id = ?',
            [shipping_address_id, billing_address_id, userId]
        );
        
        if (addresses.length !== 2 && shipping_address_id !== billing_address_id) {
            return res.status(400).json({
                success: false,
                message: 'Geçersiz adres bilgisi'
            });
        }
        
        // Ürünleri kontrol et ve toplam tutarı hesapla
        let totalAmount = 0;
        const productIds = items.map(item => item.product_id);
        
        const [products] = await db.query(
            'SELECT id, price FROM products WHERE id IN (?)',
            [productIds]
        );
        
        if (products.length !== new Set(productIds).size) {
            return res.status(400).json({
                success: false,
                message: 'Bazı ürünler bulunamadı'
            });
        }
        
        // Sipariş numarası oluştur
        const orderNumber = generateOrderNumber();
        
        // Sipariş durumu ve ödeme durumu
        let status = 'pending';
        let paymentStatus = 'pending';
        
        if (payment_method === 'credit-card') {
            paymentStatus = 'paid';
            status = 'processing';
        }
        
        // Ürünlerin toplam tutarını hesapla
        for (const item of items) {
            const product = products.find(p => p.id === item.product_id);
            totalAmount += product.price * item.quantity;
        }
        
        // Kargo ücreti (1000 TL üzeri ücretsiz kargo)
        let shippingCost = 0;
        if (totalAmount < 1000) {
            shippingCost = 100;
        }
        
        // Kapıda ödeme ücreti
        const paymentFee = payment_method === 'cash-on-delivery' ? 10 : 0;
        
        // Toplam tutara kargo ve ödeme ücretlerini ekle
        totalAmount += shippingCost + paymentFee;
        
        // Siparişi veritabanına kaydet
        const [orderResult] = await db.query(
            `INSERT INTO orders (
                user_id, 
                order_number, 
                status, 
                total_amount, 
                shipping_address_id, 
                billing_address_id, 
                payment_method, 
                payment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                orderNumber,
                status,
                totalAmount,
                shipping_address_id,
                billing_address_id,
                payment_method,
                paymentStatus
            ]
        );
        
        const orderId = orderResult.insertId;
        
        // Sipariş öğelerini veritabanına kaydet
        for (const item of items) {
            try {
                const product = products.find(p => p.id === item.product_id);
                if (!product) {
                    console.error(`Ürün bulunamadı: ${item.product_id}`);
                    continue;
                }
                
                // Varyant bilgilerini detaylı logla
                console.log('İşlenen sipariş öğesi (tam):', JSON.stringify(item, null, 2));
                
                // Varyant ID'sini ve bilgilerini doğru şekilde al
                const variantId = item.variant_id !== undefined ? item.variant_id : null;
                
                // Varyant isim ve değerlerini al
                const variantName1 = item.variant_name1 || null;
                const variantValue1 = item.variant_value1 || null;
                const variantName2 = item.variant_name2 || null;
                const variantValue2 = item.variant_value2 || null;
                
                console.log(`Ürün ID: ${item.product_id}, Varyant ID: ${variantId}`);
                console.log(`Varyant Bilgileri: ${variantName1}: ${variantValue1}, ${variantName2}: ${variantValue2}`);
                
                // Sipariş öğesini ekle - varyant bilgilerini de kaydet
                await db.query(
                    `INSERT INTO order_items (
                        order_id, 
                        product_id, 
                        variant_id, 
                        quantity, 
                        price,
                        variant_name1,
                        variant_value1,
                        variant_name2,
                        variant_value2
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        orderId,
                        item.product_id,
                        variantId,
                        item.quantity,
                        product.price,
                        variantName1,
                        variantValue1,
                        variantName2,
                        variantValue2
                    ]
                );
                
                // Stok güncellemesi
                if (variantId) {
                    // Varyant stokunu güncelle
                    await db.query(
                        'UPDATE variants SET quantity = quantity - ? WHERE id = ?',
                        [item.quantity, variantId]
                    );
                } else {
                    // Ürün stokunu güncelle
                    await db.query(
                        'UPDATE products SET quantity = quantity - ? WHERE id = ?',
                        [item.quantity, item.product_id]
                    );
                }
            } catch (error) {
                console.error(`Sipariş öğesi eklenirken hata: ${error.message}`, item);
                // Hata durumunda diğer öğeleri işlemeye devam et
            }
        }
        
        // Oluşturulan siparişi getir
        const [orders] = await db.query(
            `SELECT * FROM orders WHERE id = ?`,
            [orderId]
        );
        
        res.status(201).json({
            success: true,
            message: 'Sipariş başarıyla oluşturuldu',
            order: orders[0]
        });
    } catch (error) {
        console.error('Sipariş oluşturma hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Sipariş oluşturulurken bir hata oluştu'
        });
    }
};

// Sipariş numarası oluştur
function generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    
    return `ORD-${year}${month}${day}-${random}`;
} 