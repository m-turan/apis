const db = require('../config/db');
const axios = require('axios');
const xml2js = require('xml2js');

const xmlController = {
    // XML'den ürünleri güncelle
    async updateFromUrl(url, xmlId, progressCallback) {
        try {
            // Progress callback'i çağır
            if (progressCallback) {
                progressCallback({
                    progress: 0,
                    status: 'XML indiriliyor...',
                    currentCount: 0,
                    totalCount: 0
                });
            }

            // XML'i indir
            const response = await axios.get(url);
            
            if (progressCallback) {
                progressCallback({
                    progress: 20,
                    status: 'XML ayrıştırılıyor...',
                    currentCount: 0,
                    totalCount: 0
                });
            }

            // XML'i parse et
            const parser = new xml2js.Parser({ 
                explicitArray: false,
                trim: true,
                mergeAttrs: true,
                explicitRoot: true
            });
            
            const result = await parser.parseStringPromise(response.data);
            
            // Ürünleri işle - result yapısını kontrol edelim
            let products = [];
            if (result && result.products && result.products.product) {
                products = Array.isArray(result.products.product) ? 
                    result.products.product : [result.products.product];
            } else {
                console.log('XML Yapısı:', result); // Hata ayıklama için XML yapısını görelim
                throw new Error('XML yapısı beklenen formatta değil');
            }

            const totalProducts = products.length;

            // Mevcut ürünleri sil
            await db.query('DELETE FROM products WHERE xml_url_id = ?', [xmlId]);

            if (progressCallback) {
                progressCallback({
                    progress: 30,
                    status: 'Ürünler yükleniyor...',
                    currentCount: 0,
                    totalCount: totalProducts
                });
            }

            // Yeni ürünleri ekle
            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < products.length; i++) {
                try {
                    const product = products[i];
                    
                    // Varyantları düzenle
                    let variants = [];
                    if (product.variants && product.variants.variant) {
                        variants = Array.isArray(product.variants.variant) ? 
                            product.variants.variant : [product.variants.variant];
                    }

                    // Önce ürünü kaydet
                    const cleanProduct = {
                        id: parseInt(product.id) || null,
                        productCode: product.productCode || null,
                        barcode: product.barcode || null,
                        main_category: product.main_category || null,
                        top_category: product.top_category || null,
                        sub_category: product.sub_category || null,
                        categoryID: parseInt(product.categoryID) || null,
                        category: product.category || null,
                        active: product.active === 'true' || product.active === '1' ? 1 : 0,
                        brandID: parseInt(product.brandID) || null,
                        brand: product.brand || null,
                        name: product.name || '',
                        description: product.description || null,
                        image1: product.image1 || null,
                        image2: product.image2 || null,
                        image3: product.image3 || null,
                        image4: product.image4 || null,
                        image5: product.image5 || null,
                        image6: product.image6 || null,
                        image7: product.image7 || null,
                        image8: product.image8 || null,
                        image9: product.image9 || null,
                        listPrice: parseFloat(product.listPrice) || null,
                        price: parseFloat(product.price) || 0,
                        tax: parseFloat(product.tax) || null,
                        currency: product.currency || 'TRY',
                        desi: parseFloat(product.desi) || null,
                        quantity: parseInt(product.quantity) || 0,
                        domestic: product.domestic === 'true' || product.domestic === '1' ? 1 : 0,
                        show_home: product.show_home === 'true' || product.show_home === '1' ? 1 : 0,
                        in_discount: product.in_discount === 'true' || product.in_discount === '1' ? 1 : 0,
                        detail: product.detail || null,
                        xml_url_id: xmlId
                    };

                    // Ürünü ekle ve ID'sini al
                    const [result] = await db.query('INSERT INTO products SET ?', [cleanProduct]);
                    const productId = result.insertId || cleanProduct.id;

                    // Varyantları kaydet
                    for (const variant of variants) {
                        try {
                            const cleanVariant = {
                                product_id: productId,
                                name1: variant.name1 || null,
                                value1: variant.value1 || null,
                                name2: variant.name2 || null,
                                value2: variant.value2 || null,
                                quantity: parseInt(variant.quantity) || 0,
                                barcode: variant.barcode || null
                            };

                            await db.query('INSERT INTO variants SET ?', [cleanVariant]);
                        } catch (variantError) {
                            console.error('Varyant ekleme hatası:', variantError.message);
                            // Varyant eklenemese bile ürün eklemeye devam et
                        }
                    }

                    successCount++;

                    // Her 10 üründe bir progress güncelle
                    if (progressCallback && i % 10 === 0) {
                        const progress = Math.floor(30 + (i / totalProducts) * 70);
                        progressCallback({
                            progress,
                            status: 'Ürünler yükleniyor...',
                            currentCount: i,
                            totalCount: totalProducts
                        });
                    }

                } catch (error) {
                    errorCount++;
                    console.error('Ürün ekleme hatası:', error.message);
                    continue;
                }
            }

            // XML bilgilerini güncelle
            await db.query(`
                UPDATE xml_urls 
                SET 
                    product_count = ?,
                    last_update = NOW(),
                    next_update = DATE_ADD(NOW(), INTERVAL 12 HOUR)
                WHERE id = ?
            `, [successCount, xmlId]);

            if (progressCallback) {
                progressCallback({
                    progress: 100,
                    status: 'Tamamlandı',
                    currentCount: successCount,
                    totalCount: totalProducts
                });
            }

            return true;
        } catch (error) {
            console.error('XML güncelleme hatası:', error);
            throw error;
        }
    },

    // XML'e ait ürünleri sil
    async deleteProductsByXmlId(xmlId) {
        try {
            await db.query('DELETE FROM products WHERE xml_url_id = ?', [xmlId]);
            return true;
        } catch (error) {
            console.error('Ürün silme hatası:', error);
            throw error;
        }
    }
};

module.exports = xmlController;