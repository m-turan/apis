const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const authController = {
    // Kullanıcı kaydı
    async register(req, res) {
        try {
            console.log('Register request received:', req.body); // Debug için log

            const { firstName, lastName, email, phone, birthDate, password } = req.body;

            // Veri doğrulama
            if (!firstName || !lastName || !email || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Tüm zorunlu alanları doldurun'
                });
            }

            // E-posta formatı kontrolü
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Geçerli bir e-posta adresi girin'
                });
            }

            // E-posta kontrolü
            const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
            if (existingUser.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Bu e-posta adresi zaten kullanımda'
                });
            }

            // Şifreyi hashle
            const hashedPassword = await bcrypt.hash(password, 10);

            // Kullanıcıyı kaydet
            const [result] = await db.query(
                'INSERT INTO users (first_name, last_name, email, phone, birth_date, password) VALUES (?, ?, ?, ?, ?, ?)',
                [firstName, lastName, email, phone, birthDate, hashedPassword]
            );

            console.log('User registered successfully:', result); // Debug için log

            res.status(201).json({
                success: true,
                message: 'Kayıt başarılı',
                userId: result.insertId
            });
        } catch (error) {
            console.error('Kayıt hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Kayıt sırasında bir hata oluştu',
                error: error.message
            });
        }
    },

    // Kullanıcı girişi
    async login(req, res) {
        try {
            const { email, password } = req.body;

            // Kullanıcıyı bul
            const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
            if (users.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: 'E-posta veya şifre hatalı'
                });
            }

            const user = users[0];

            // Şifreyi kontrol et
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (!isValidPassword) {
                return res.status(401).json({
                    success: false,
                    message: 'E-posta veya şifre hatalı'
                });
            }

            // JWT token oluştur
            const token = jwt.sign(
                { userId: user.id, email: user.email },
                process.env.JWT_SECRET || 'eterella_super_secret_key_2023',
                { expiresIn: '7d' }
            );

            // Son giriş zamanını güncelle
            await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

            // Oturum kaydı
            await db.query(
                'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))',
                [user.id, token]
            );

            res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    email: user.email
                }
            });
        } catch (error) {
            console.error('Giriş hatası:', error);
            res.status(500).json({
                success: false,
                message: 'Giriş sırasında bir hata oluştu'
            });
        }
    }
};

module.exports = authController; 