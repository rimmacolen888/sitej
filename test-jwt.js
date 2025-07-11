require('dotenv').config();
const jwt = require('jsonwebtoken');

console.log('JWT_SECRET из .env:', process.env.JWT_SECRET);
console.log('Длина секрета:', process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 'НЕТ');

// Тестируем создание и проверку токена
const testPayload = { adminId: 1, username: 'admin', type: 'admin' };

try {
    const token = jwt.sign(testPayload, process.env.JWT_SECRET, { expiresIn: '24h' });
    console.log('Токен создан:', token.substring(0, 50) + '...');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Токен проверен успешно:', decoded);
} catch (error) {
    console.error('Ошибка JWT:', error.message);
}