const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const TelegramService = require('../services/telegramService');
const { 
    generateToken, 
    hashPassword, 
    comparePassword,
    validateInviteCode,
    validateUserData,
    logUserActivity
} = require('../middleware/auth');
const { AppError, catchAsync } = require('../middleware/errorHandler');

// Валидация входящих данных
const registerValidation = [
    body('username')
        .isLength({ min: 3, max: 50 })
        .withMessage('Имя пользователя должно быть от 3 до 50 символов')
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('Имя пользователя может содержать только буквы, цифры, _ и -'),
    body('password')
        .isLength({ min: 6, max: 100 })
        .withMessage('Пароль должен быть от 6 до 100 символов'),
    body('inviteCode')
        .isLength({ min: 3 })
        .withMessage('Инвайт-код обязателен')
];

const loginValidation = [
    body('username')
        .notEmpty()
        .withMessage('Имя пользователя обязательно'),
    body('password')
        .notEmpty()
        .withMessage('Пароль обязателен')
];

// POST /api/auth/check-invite - Проверка инвайт-кода
router.post('/check-invite', logUserActivity, catchAsync(async (req, res) => {
    const { inviteCode } = req.body;

    if (!inviteCode) {
        throw new AppError('Инвайт-код не предоставлен', 400);
    }

    const validation = await validateInviteCode(inviteCode);
    
    if (!validation.isValid) {
        // Логируем неудачную попытку
        await DatabaseService.query(
            'INSERT INTO auth_logs (invite_code, ip_address, country, action) VALUES ($1, $2, $3, $4)',
            [inviteCode, req.userIP, req.userCountry, 'invalid_invite']
        );
        
        throw new AppError(validation.message, 400);
    }

    res.json({
        success: true,
        message: 'Инвайт-код действителен',
        expiresAt: validation.inviteCode.expires_at
    });
}));

// POST /api/auth/register - Регистрация нового пользователя
router.post('/register', registerValidation, logUserActivity, catchAsync(async (req, res) => {
    const { username, password, inviteCode } = req.body;

    // Проверяем валидацию
    const validation = validateUserData(username, password);
    if (!validation.isValid) {
        throw new AppError(validation.errors.join(', '), 400);
    }

    // Проверяем инвайт-код
    const inviteValidation = await validateInviteCode(inviteCode);
    if (!inviteValidation.isValid) {
        throw new AppError(inviteValidation.message, 400);
    }

    // Проверяем, не существует ли уже пользователь с таким именем
    const existingUser = await DatabaseService.getUserByUsername(username);
    if (existingUser) {
        throw new AppError('Пользователь с таким именем уже существует', 400);
    }

    // Используем транзакцию для атомарности операции
    const result = await DatabaseService.transaction(async (client) => {
        // Хешируем пароль
        const passwordHash = await hashPassword(password);

        // Создаем пользователя
        const userResult = await client.query(
            `INSERT INTO users (username, password_hash, invite_code_used, access_expires_at)
             VALUES ($1, $2, $3, $4)
             RETURNING id, username, access_expires_at, created_at`,
            [
                username, 
                passwordHash, 
                inviteCode, 
                new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // 15 дней
            ]
        );

        const user = userResult.rows[0];

        // Увеличиваем счетчик использования инвайт-кода
        await client.query(
            'UPDATE invite_codes SET current_uses = current_uses + 1 WHERE code = $1',
            [inviteCode]
        );

        // Логируем регистрацию
        await client.query(
            'INSERT INTO auth_logs (user_id, invite_code, ip_address, country, action) VALUES ($1, $2, $3, $4, $5)',
            [user.id, inviteCode, req.userIP, req.userCountry, 'register']
        );

        return user;
    });

    // Генерируем JWT токен
    const token = generateToken({
        userId: result.id,
        username: result.username,
        role: 'user'
    });

    // Отправляем уведомление в Telegram
    await TelegramService.sendNotification(
        `🆕 Новая регистрация\n` +
        `👤 Пользователь: ${username}\n` +
        `🎫 Инвайт-код: ${inviteCode}\n` +
        `🌍 Страна: ${req.userCountry}\n` +
        `📍 IP: ${req.userIP}`
    );

    res.status(201).json({
        success: true,
        message: 'Регистрация успешна',
        user: {
            id: result.id,
            username: result.username,
            accessExpiresAt: result.access_expires_at,
            createdAt: result.created_at
        },
        token
    });
}));

// POST /api/auth/login - Вход в систему
router.post('/login', loginValidation, logUserActivity, catchAsync(async (req, res) => {
    const { username, password } = req.body;

    // Находим пользователя
    const user = await DatabaseService.getUserByUsername(username);
    
    if (!user) {
        // Логируем неудачную попытку
        await DatabaseService.query(
            'INSERT INTO auth_logs (ip_address, country, action) VALUES ($1, $2, $3)',
            [req.userIP, req.userCountry, 'failed_login']
        );
        
        throw new AppError('Неверное имя пользователя или пароль', 401);
    }

    // Проверяем пароль
    const isValidPassword = await comparePassword(password, user.password_hash);
    
    if (!isValidPassword) {
        await DatabaseService.query(
            'INSERT INTO auth_logs (user_id, ip_address, country, action) VALUES ($1, $2, $3, $4)',
            [user.id, req.userIP, req.userCountry, 'failed_login']
        );
        
        throw new AppError('Неверное имя пользователя или пароль', 401);
    }

    // Проверяем, не заблокирован ли пользователь
    if (user.is_blocked) {
        if (user.blocked_until && new Date() > user.blocked_until) {
            // Автоматически разблокируем
            await DatabaseService.unblockExpiredUsers();
            user.is_blocked = false;
            user.blocked_until = null;
        } else {
            throw new AppError(
                `Аккаунт заблокирован до ${user.blocked_until}`, 
                403
            );
        }
    }

    // Проверяем срок доступа
    if (new Date() > user.access_expires_at) {
        throw new AppError('Срок доступа истек. Нужен новый инвайт-код', 403);
    }

    // Обновляем время последнего входа
    await DatabaseService.updateUserLastLogin(user.id, req.userIP, req.userCountry);

    // Генерируем JWT токен
    const token = generateToken({
        userId: user.id,
        username: user.username,
        role: 'user'
    });

    res.json({
        success: true,
        message: 'Вход выполнен успешно',
        user: {
            id: user.id,
            username: user.username,
            accessExpiresAt: user.access_expires_at,
            lastLogin: new Date()
        },
        token
    });
}));

// POST /api/auth/admin-login - Вход для администраторов
router.post('/admin-login', logUserActivity, catchAsync(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        throw new AppError('Имя пользователя и пароль обязательны', 400);
    }

    // Находим администратора
    const adminResult = await DatabaseService.query(
        'SELECT * FROM admins WHERE username = $1 AND is_active = true',
        [username]
    );

    const admin = adminResult.rows[0];
    
    if (!admin) {
        await DatabaseService.query(
            'INSERT INTO admin_logs (action, details, ip_address) VALUES ($1, $2, $3)',
            ['failed_login', JSON.stringify({ username }), req.userIP]
        );
        
        throw new AppError('Неверные учетные данные', 401);
    }

    // Проверяем пароль (используем crypt из PostgreSQL)
    const passwordCheck = await DatabaseService.query(
        'SELECT crypt($1, password_hash) = password_hash as valid FROM admins WHERE id = $2',
        [password, admin.id]
    );

    if (!passwordCheck.rows[0]?.valid) {
        await DatabaseService.query(
            'INSERT INTO admin_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
            [admin.id, 'failed_login', JSON.stringify({ reason: 'wrong_password' }), req.userIP]
        );
        
        throw new AppError('Неверные учетные данные', 401);
    }

    // Логируем успешный вход
    await DatabaseService.query(
        'INSERT INTO admin_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
        [admin.id, 'login', JSON.stringify({ country: req.userCountry }), req.userIP]
    );

    // Генерируем JWT токен для админа
    const token = generateToken({
        adminId: admin.id,
        username: admin.username,
        role: 'admin',
        permissions: admin.permissions
    });

    // Отправляем уведомление в Telegram
    await TelegramService.sendNotification(
        `🔐 Вход администратора\n` +
        `👤 Админ: ${admin.username}\n` +
        `🌍 Страна: ${req.userCountry}\n` +
        `📍 IP: ${req.userIP}\n` +
        `⏰ Время: ${new Date().toLocaleString('ru-RU')}`
    );

    res.json({
        success: true,
        message: 'Вход администратора выполнен успешно',
        admin: {
            id: admin.id,
            username: admin.username,
            permissions: admin.permissions
        },
        token
    });
}));

// GET /api/auth/me - Получение информации о текущем пользователе
router.get('/me', logUserActivity, catchAsync(async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        throw new AppError('Токен не предоставлен', 401);
    }

    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        let userData;
        if (decoded.role === 'admin') {
            const adminResult = await DatabaseService.query(
                'SELECT id, username, permissions, created_at FROM admins WHERE id = $1 AND is_active = true',
                [decoded.adminId]
            );
            userData = adminResult.rows[0];
        } else {
            userData = await DatabaseService.getUserById(decoded.userId);
            delete userData.password_hash; // Удаляем хеш пароля из ответа
        }

        if (!userData) {
            throw new AppError('Пользователь не найден', 401);
        }

        res.json({
            success: true,
            user: userData,
            role: decoded.role
        });
    } catch (error) {
        throw new AppError('Недействительный токен', 401);
    }
}));

module.exports = router;