const jwt = require('jsonwebtoken');

const authMiddleware = async (req, res, next) => {
    try {
        console.log('Auth middleware çalıştı');
        
        // Token'ı header'dan veya cookie'den al
        const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
        console.log('Token:', token ? 'Token alındı' : 'Token bulunamadı');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Giriş yapmanız gerekiyor'
            });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('Token doğrulandı:', decoded);
            req.user = decoded;
            next();
        } catch (jwtError) {
            console.error('JWT doğrulama hatası:', jwtError);
            return res.status(401).json({
                success: false,
                message: 'Geçersiz veya süresi dolmuş token'
            });
        }
    } catch (error) {
        console.error('Auth hatası:', error);
        res.status(401).json({
            success: false,
            message: 'Geçersiz veya süresi dolmuş token'
        });
    }
};

module.exports = authMiddleware; 