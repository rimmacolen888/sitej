const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const { hashPassword, comparePassword, generateToken } = require('../middleware/auth');

router.post('/check-invite', async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({
                success: false,
                message: 'Инвайт-код обязателен'
            });
        }

        const inviteResult = await DatabaseService.query(
            'SELECT * FROM invite_codes WHERE code = $1 AND is_active = true AND expires_at > CURRENT_TIMESTAMP',
            [code]
        );

        if (inviteResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Инвайт-код не найден или истек'
            });
        }

        const invite = inviteResult.rows[0];

        if (invite.current_uses >= invite.max_uses) {
            return res.status(400).json({
                success: false,
                message: 'Инвайт-код исчерпан'
            });
        }

        res.json({
            success: true,
            message: 'Инвайт-код действителен'
        });

    } catch (error) {
        console.error('Ошибка проверки инвайт-кода:', error);
        res.status(500).json({
            success: false,
            message: 'Внутренняя ошибка сервера'
        });
    }
});

router.post('/register', async (req, res) => {
    try {
        const { username, password, inviteCode } = req.body;

        if (!username || !password || !inviteCode) {
            return res.status(400).json({
                success: false,
                message: 'Все поля обязательны'
            });
        }

        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Имя пользователя должно быть минимум 3 символа'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Пароль должен быть минимум 6 символов'
            });
        }

        // Проверяем инвайт-код
        const inviteResult = await DatabaseService.query(
            'SELECT * FROM invite_codes WHERE code = $1 AND is_active = true AND expires_at > CURRENT_TIMESTAMP',
            [inviteCode]
        );

        if (inviteResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Неверный или истекший инвайт-код'
            });
        }

        const invite = inviteResult.rows[0];

        if (invite.current_uses >= invite.max_uses) {
            return res.status(400).json({
                success: false,
                message: 'Инвайт-код исчерпан'
            });
        }

        // Проверяем, не существует ли пользователь
        const existingUser = await DatabaseService.query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Пользователь с таким именем уже существует'
            });
        }

        // Хешируем пароль
        const passwordHash = await hashPassword(password);

        // Создаем пользователя
        const accessExpiresAt = new Date();
        accessExpiresAt.setDate(accessExpiresAt.getDate() + 15);

        const userResult = await DatabaseService.query(`
            INSERT INTO users (username, password_hash, invite_code_used, access_expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id, username, created_at
        `, [username, passwordHash, inviteCode, accessExpiresAt]);

        const user = userResult.rows[0];

        // Обновляем счетчик инвайт-кода
        await DatabaseService.query(
            'UPDATE invite_codes SET current_uses = current_uses + 1 WHERE code = $1',
            [inviteCode]
        );

        // Создаем токен
        const token = generateToken({
            userId: user.id,
            username: user.username,
            type: 'user'
        });

        res.status(201).json({
            success: true,
            message: 'Регистрация успешна',
            token,
            user: {
                id: user.id,
                username: user.username,
                access_expires_at: accessExpiresAt
            }
        });

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            message: 'Внутренняя ошибка сервера'
        });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Логин и пароль обязательны'
            });
        }

        // Находим пользователя
        const userResult = await DatabaseService.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Неверные учетные данные'
            });
        }

        const user = userResult.rows[0];

        // Проверяем пароль
        const isValidPassword = await comparePassword(password, user.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Неверные учетные данные'
            });
        }

        // Создаем токен
        const token = generateToken({
            userId: user.id,
            username: user.username,
            type: 'user'
        });

        res.json({
            success: true,
            message: 'Вход выполнен успешно',
            token,
            user: {
                id: user.id,
                username: user.username,
                access_expires_at: user.access_expires_at
            }
        });

    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({
            success: false,
            message: 'Внутренняя ошибка сервера'
        });
    }
});

module.exports = router;