const cron = require('node-cron');
const db = require('../config/db');
const xmlController = require('../controllers/xmlController');

// Her 12 saatte bir çalışacak cron job
cron.schedule('0 */12 * * *', async () => {
    console.log('XML güncelleme işlemi başlatıldı:', new Date());
    
    try {
        // Aktif XML'leri getir
        const [xmls] = await db.query('SELECT * FROM xml_urls WHERE status = "active"');
        
        for (const xml of xmls) {
            try {
                console.log(`XML güncelleniyor (ID: ${xml.id}, URL: ${xml.url})`);
                
                // XML'den ürünleri güncelle
                await xmlController.updateFromUrl(xml.url, xml.id);
                
                // Ürün sayısını güncelle
                const [count] = await db.query(
                    'SELECT COUNT(*) as count FROM products WHERE xml_url_id = ?', 
                    [xml.id]
                );
                
                // Son güncelleme bilgilerini kaydet
                await db.query(`
                    UPDATE xml_urls 
                    SET 
                        last_update = NOW(), 
                        next_update = DATE_ADD(NOW(), INTERVAL 12 HOUR),
                        product_count = ?
                    WHERE id = ?
                `, [count[0].count, xml.id]);

                console.log(`XML güncelleme başarılı (ID: ${xml.id}, Ürün sayısı: ${count[0].count})`);
            } catch (error) {
                console.error(`XML güncelleme hatası (ID: ${xml.id}):`, error);
            }
        }

        // Pasif XML'lerin ürünlerini sil
        const [inactiveXmls] = await db.query('SELECT * FROM xml_urls WHERE status = "inactive"');
        for (const xml of inactiveXmls) {
            try {
                await xmlController.deleteProductsByXmlId(xml.id);
            } catch (error) {
                console.error(`Pasif XML ürünleri silme hatası (ID: ${xml.id}):`, error);
            }
        }
    } catch (error) {
        console.error('XML güncelleme cron job hatası:', error);
    }
}); 