const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const DatabaseService = require('../services/databaseService');

// Генерация JWT токена
const generateToken = (payload) => {
    return jwt.sign(payload, process.env.JWT_SECRET || 'fallback_secret', {
        expiresIn: '15d' // Токен действует 15 дней
    });
};

// Хеширование пароля
const hashPassword = async (password) => {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    return await bcrypt.hash(password, rounds);
};

// Проверка пароля
const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

// Middleware для аутентификации пользователей
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({ 
                error: 'Токен не предоставлен',
                message: 'Необходима авторизация'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
        
        // Получаем актуальные данные пользователя
        const user = await DatabaseService.getUserById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ 
                error: 'Пользователь не найден',
                message: 'Токен недействителен'
            });
        }

        // Проверяем, не заблокирован ли пользователь
        if (user.is_blocked) {
            if (user.blocked_until && new Date() > user.blocked_until) {
                // Разблокируем автоматически
                await DatabaseService.unblockExpiredUsers();
            } else {
                return res.status(403).json({ 
                    error: 'Аккаунт заблокирован',
                    message: `Доступ ограничен до ${user.blocked_until}`,
                    blocked_until: user.blocked_until
                });
            }
        }

        // Проверяем срок доступа
        if (new Date() > user.access_expires_at) {
            return res.status(403).json({ 
                error: 'Срок доступа истек',
                message: 'Необходим новый инвайт-код'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Токен истек',
                message: 'Необходима повторная авторизация'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                error: 'Недействительный токен',
                message: 'Токен поврежден или неверный'
            });
        }

        console.error('Ошибка аутентификации:', error);
        return res.status(500).json({ 
            error: 'Ошибка сервера',
            message: 'Не удалось проверить токен'
        });
    }
};

// Middleware для аутентификации админов
const authenticateAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                error: 'Токен не предоставлен',
                message: 'Необходима авторизация администратора'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
        
        if (decoded.role !== 'admin') {
            return res.status(403).json({ 
                error: 'Недостаточно прав',
                message: 'Доступ только для администраторов'
            });
        }

        // Получаем данные админа
        const admin = await DatabaseService.query(
            'SELECT * FROM admins WHERE id = $1 AND is_active = true',
            [decoded.adminId]
        );

        if (!admin.rows[0]) {
            return res.status(401).json({ 
                error: 'Администратор не найден',
                message: 'Токен недействителен'
            });
        }

        req.admin = admin.rows[0];
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Токен истек',
                message: 'Необходима повторная авторизация'
            });
        }
        
        console.error('Ошибка аутентификации админа:', error);
        return res.status(500).json({ 
            error: 'Ошибка сервера',
            message: 'Не удалось проверить токен'
        });
    }
};

// Middleware для проверки доступа к определенным действиям
const checkPermission = (permission) => {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(403).json({ 
                error: 'Недостаточно прав',
                message: 'Доступ запрещен'
            });
        }

        const permissions = req.admin.permissions || {};
        if (!permissions[permission]) {
            return res.status(403).json({ 
                error: 'Недостаточно прав',
                message: `Нет доступа к действию: ${permission}`
            });
        }

        next();
    };
};

// Middleware для логирования IP и геолокации
const geoip = require('geoip-lite');

const logUserActivity = async (req, res, next) => {
    try {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
        const geo = geoip.lookup(ip);
        const country = geo ? geo.country : 'Unknown';

        req.userIP = ip;
        req.userCountry = country;
        
        next();
    } catch (error) {
        console.error('Ошибка определения геолокации:', error);
        req.userIP = 'Unknown';
        req.userCountry = 'Unknown';
        next();
    }
};

// Валидация инвайт-кода
const validateInviteCode = async (code) => {
    if (!code || code.length < 3) {
        return { isValid: false, message: 'Инвайт-код слишком короткий' };
    }

    const inviteCode = await DatabaseService.validateInviteCode(code);
    
    if (!inviteCode) {
        return { 
            isValid: false, 
            message: 'Инвайт-код недействителен, истек или исчерпан' 
        };
    }

    return { isValid: true, inviteCode };
};

// Валидация данных пользователя
const validateUserData = (username, password) => {
    const errors = [];

    // Проверка имени пользователя
    if (!username || username.length < 3) {
        errors.push('Имя пользователя должно быть минимум 3 символа');
    }

    if (username.length > 50) {
        errors.push('Имя пользователя должно быть максимум 50 символов');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        errors.push('Имя пользователя может содержать только буквы, цифры, _ и -');
    }

    // Проверка пароля
    if (!password || password.length < 6) {
        errors.push('Пароль должен быть минимум 6 символов');
    }

    if (password.length > 100) {
        errors.push('Пароль слишком длинный');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
};

// Middleware для ограничения действий заблокированных пользователей
const checkUserBlocked = async (req, res, next) => {
    try {
        if (req.user && req.user.is_blocked) {
            // Проверяем, не истекла ли блокировка
            if (req.user.blocked_until && new Date() > req.user.blocked_until) {
                await DatabaseService.unblockExpiredUsers();
                // Перезагружаем данные пользователя
                req.user = await DatabaseService.getUserById(req.user.id);
            }

            if (req.user.is_blocked) {
                return res.status(403).json({
                    error: 'Действие заблокировано',
                    message: `Покупки заблокированы до ${req.user.blocked_until}`,
                    blocked_until: req.user.blocked_until
                });
            }
        }
        next();
    } catch (error) {
        console.error('Ошибка проверки блокировки:', error);
        next(error);
    }
};

module.exports = {
    generateToken,
    hashPassword,
    comparePassword,
    authenticateToken,
    authenticateAdmin,
    checkPermission,
    logUserActivity,
    validateInviteCode,
    validateUserData,
    checkUserBlocked
};