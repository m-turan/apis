const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Kullanıcı profili bilgilerini getir
exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        
        const [users] = await db.query(
            'SELECT id, first_name, last_name, email, phone, birth_date, created_at FROM users WHERE id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Kullanıcı bulunamadı'
            });
        }
        
        const user = users[0];
        
        // Kullanıcı bilgilerini döndür (hassas bilgileri hariç tut)
        res.json({
            success: true,
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                phone: user.phone,
                birthDate: user.birth_date,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        console.error('Profil bilgileri getirme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Profil bilgileri yüklenirken bir hata oluştu'
        });
    }
};

// Kullanıcı profili bilgilerini güncelle
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { firstName, lastName, phone, birthDate } = req.body;
        
        // Veri doğrulama
        if (!firstName || !lastName) {
            return res.status(400).json({
                success: false,
                message: 'Ad ve soyad alanları zorunludur'
            });
        }
        
        await db.query(
            'UPDATE users SET first_name = ?, last_name = ?, phone = ?, birth_date = ? WHERE id = ?',
            [firstName, lastName, phone, birthDate, userId]
        );
        
        res.json({
            success: true,
            message: 'Profil bilgileriniz başarıyla güncellendi'
        });
    } catch (error) {
        console.error('Profil güncelleme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Profil bilgileriniz güncellenirken bir hata oluştu'
        });
    }
};

// Kullanıcı şifresini güncelle
exports.updatePassword = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { currentPassword, newPassword } = req.body;
        
        // Veri doğrulama
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Mevcut şifre ve yeni şifre alanları zorunludur'
            });
        }
        
        // Mevcut şifreyi kontrol et
        const [users] = await db.query('SELECT password FROM users WHERE id = ?', [userId]);
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Kullanıcı bulunamadı'
            });
        }
        
        const isValidPassword = await bcrypt.compare(currentPassword, users[0].password);
        
        if (!isValidPassword) {
            return res.status(400).json({
                success: false,
                message: 'Mevcut şifreniz hatalı'
            });
        }
        
        // Yeni şifreyi hashle
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Şifreyi güncelle
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
        
        res.json({
            success: true,
            message: 'Şifreniz başarıyla güncellendi'
        });
    } catch (error) {
        console.error('Şifre güncelleme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Şifreniz güncellenirken bir hata oluştu'
        });
    }
};

// Kullanıcının adreslerini getir
exports.getAddresses = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        
        const [addresses] = await db.query(
            'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC',
            [userId]
        );
        
        res.json({
            success: true,
            addresses
        });
    } catch (error) {
        console.error('Adres getirme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Adresleriniz yüklenirken bir hata oluştu'
        });
    }
};

// Yeni adres ekle
exports.addAddress = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { title, full_name, phone, city, district, address, postal_code, is_default } = req.body;
        
        // Veri doğrulama
        if (!title || !full_name || !phone || !city || !district || !address) {
            return res.status(400).json({
                success: false,
                message: 'Lütfen tüm zorunlu alanları doldurun'
            });
        }
        
        // Eğer varsayılan adres olarak işaretlendiyse, diğer adreslerin varsayılan durumunu kaldır
        if (is_default) {
            await db.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
        }
        
        // Yeni adresi ekle
        const [result] = await db.query(
            'INSERT INTO addresses (user_id, title, full_name, phone, city, district, address, postal_code, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [userId, title, full_name, phone, city, district, address, postal_code, is_default ? 1 : 0]
        );
        
        res.status(201).json({
            success: true,
            message: 'Adres başarıyla eklendi',
            addressId: result.insertId
        });
    } catch (error) {
        console.error('Adres ekleme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Adres eklenirken bir hata oluştu'
        });
    }
};

// Adres detaylarını getir
exports.getAddressById = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const addressId = req.params.id;
        
        const [addresses] = await db.query(
            'SELECT * FROM addresses WHERE id = ? AND user_id = ?',
            [addressId, userId]
        );
        
        if (addresses.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Adres bulunamadı'
            });
        }
        
        res.json({
            success: true,
            address: addresses[0]
        });
    } catch (error) {
        console.error('Adres detayı getirme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Adres detayları yüklenirken bir hata oluştu'
        });
    }
};

// Adres güncelle
exports.updateAddress = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const addressId = req.params.id;
        const { title, full_name, phone, city, district, address, postal_code, is_default } = req.body;
        
        // Veri doğrulama
        if (!title || !full_name || !phone || !city || !district || !address) {
            return res.status(400).json({
                success: false,
                message: 'Lütfen tüm zorunlu alanları doldurun'
            });
        }
        
        // Adresin kullanıcıya ait olup olmadığını kontrol et
        const [addresses] = await db.query(
            'SELECT * FROM addresses WHERE id = ? AND user_id = ?',
            [addressId, userId]
        );
        
        if (addresses.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Adres bulunamadı'
            });
        }
        
        // Eğer varsayılan adres olarak işaretlendiyse, diğer adreslerin varsayılan durumunu kaldır
        if (is_default) {
            await db.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
        }
        
        // Adresi güncelle
        await db.query(
            'UPDATE addresses SET title = ?, full_name = ?, phone = ?, city = ?, district = ?, address = ?, postal_code = ?, is_default = ? WHERE id = ? AND user_id = ?',
            [title, full_name, phone, city, district, address, postal_code, is_default ? 1 : 0, addressId, userId]
        );
        
        res.json({
            success: true,
            message: 'Adres başarıyla güncellendi'
        });
    } catch (error) {
        console.error('Adres güncelleme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Adres güncellenirken bir hata oluştu'
        });
    }
};

// Adres sil
exports.deleteAddress = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const addressId = req.params.id;
        
        // Adresin kullanıcıya ait olup olmadığını kontrol et
        const [addresses] = await db.query(
            'SELECT * FROM addresses WHERE id = ? AND user_id = ?',
            [addressId, userId]
        );
        
        if (addresses.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Adres bulunamadı'
            });
        }
        
        // Adresi sil
        await db.query('DELETE FROM addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
        
        // Eğer silinen adres varsayılan adres ise ve başka adresler varsa, en son eklenen adresi varsayılan yap
        if (addresses[0].is_default) {
            const [remainingAddresses] = await db.query(
                'SELECT id FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1',
                [userId]
            );
            
            if (remainingAddresses.length > 0) {
                await db.query(
                    'UPDATE addresses SET is_default = 1 WHERE id = ?',
                    [remainingAddresses[0].id]
                );
            }
        }
        
        res.json({
            success: true,
            message: 'Adres başarıyla silindi'
        });
    } catch (error) {
        console.error('Adres silme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Adres silinirken bir hata oluştu'
        });
    }
};

// Varsayılan adresi ayarla
exports.setDefaultAddress = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const addressId = req.params.id;
        
        // Adresin kullanıcıya ait olup olmadığını kontrol et
        const [addresses] = await db.query(
            'SELECT * FROM addresses WHERE id = ? AND user_id = ?',
            [addressId, userId]
        );
        
        if (addresses.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Adres bulunamadı'
            });
        }
        
        // Tüm adreslerin varsayılan durumunu kaldır
        await db.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);
        
        // Seçilen adresi varsayılan yap
        await db.query('UPDATE addresses SET is_default = 1 WHERE id = ?', [addressId]);
        
        res.json({
            success: true,
            message: 'Varsayılan adres başarıyla güncellendi'
        });
    } catch (error) {
        console.error('Varsayılan adres güncelleme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Varsayılan adres güncellenirken bir hata oluştu'
        });
    }
}; 