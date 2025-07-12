const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const DatabaseService = require('../services/databaseService');

// POST /api/admin-auth/login - Авторизация администратора (БЕЗ middleware)
router.post('/login', async (req, res) => {
    try {
        console.log('Admin login request:', req.body);

        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Логин и пароль обязательны'
            });
        }

        // Находим администратора
        const adminResult = await DatabaseService.query(
            'SELECT * FROM admins WHERE username = $1 AND is_active = true',
            [username]
        );

        console.log('Found admins:', adminResult.rows.length);

        if (adminResult.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Неверные учетные данные'
            });
        }

        const admin = adminResult.rows[0];
        console.log('Admin found:', admin.username);

        // Проверяем пароль используя bcrypt
        const isValidPassword = await bcrypt.compare(password, admin.password_hash);
        console.log('Password valid:', isValidPassword);

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Неверные учетные данные'
            });
        }

        // Создаем токен
        const token = jwt.sign(
            { 
                adminId: admin.id, 
                username: admin.username,
                type: 'admin'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('Admin login successful:', admin.username);

        // Логируем вход админа
        try {
            await DatabaseService.query(
                'INSERT INTO admin_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
                [admin.id, 'login', JSON.stringify({ successful: true }), req.ip]
            );
        } catch (logError) {
            console.error('Error logging admin action:', logError);
            // Не прерываем авторизацию из-за ошибки логирования
        }

        res.json({
            success: true,
            token,
            admin: {
                id: admin.id,
                username: admin.username,
                permissions: admin.permissions
            }
        });

    } catch (error) {
        console.error('Ошибка входа админа:', error);
        res.status(500).json({
            success: false,
            message: 'Внутренняя ошибка сервера'
        });
    }
});

module.exports = router;