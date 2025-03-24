const mysql = require('mysql2/promise');
require('dotenv').config();

// Veritabanı bağlantı bilgileri
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 60000
};

// Bağlantı havuzu oluştur
const pool = mysql.createPool(dbConfig);

// Bağlantı durumunu kontrol et
pool.on('connection', (connection) => {
  console.log('Yeni veritabanı bağlantısı oluşturuldu');
});

pool.on('error', (err) => {
  console.error('Veritabanı havuzu hatası:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    console.error('Veritabanı bağlantısı kayboldu.');
  }
});

// Uygulama başlangıcında bağlantıyı test et
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('Veritabanı bağlantısı başarılı!');
    conn.release();
  } catch (error) {
    console.error('Veritabanı bağlantı testi başarısız:', error);
  }
})();

// Sadece pool'u dışa aktar
module.exports = pool; 