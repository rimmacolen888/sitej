const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const geoip = require('geoip-lite');

// Генерация JWT токена
function generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
}

// Хеширование пароля
async function hashPassword(password) {
    return await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
}

// Проверка пароля
async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

// Middleware для аутентификации пользователей
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Токен доступа отсутствует'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({
                success: false,
                message: 'Недействительный токен'
            });
        }

        req.user = decoded;
        next();
    });
};

// Middleware для аутентификации администраторов
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Токен доступа отсутствует'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({
                success: false,
                message: 'Недействительный токен'
            });
        }

        if (decoded.type !== 'admin' && decoded.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Доступ запрещен'
            });
        }

        req.admin = decoded;
        next();
    });
};

// Middleware для проверки блокировки пользователя
const checkUserBlocked = async (req, res, next) => {
    try {
        const DatabaseService = require('../services/databaseService');
        const user = await DatabaseService.getUserById(req.user.userId);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Пользователь не найден'
            });
        }

        if (user.is_blocked) {
            if (user.blocked_until && new Date() > user.blocked_until) {
                // Автоматически разблокируем
                await DatabaseService.unblockExpiredUsers();
                next();
            } else {
                return res.status(403).json({
                    success: false,
                    message: `Аккаунт заблокирован до ${user.blocked_until}`,
                    blocked_until: user.blocked_until
                });
            }
        } else {
            next();
        }
    } catch (error) {
        console.error('Ошибка проверки блокировки:', error);
        next();
    }
};

// Middleware для логирования активности пользователей
const logUserActivity = (req, res, next) => {
    // Получаем IP адрес
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               '127.0.0.1';

    // Получаем информацию о стране
    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : 'Unknown';

    // Добавляем информацию в объект запроса
    req.userIP = ip;
    req.userCountry = country;
    req.userAgent = req.headers['user-agent'];

    next();
};

// Валидация инвайт-кода
async function validateInviteCode(code) {
    try {
        const DatabaseService = require('../services/databaseService');
        const invite = await DatabaseService.validateInviteCode(code);
        
        if (!invite) {
            return {
                isValid: false,
                message: 'Инвайт-код не найден или истек'
            };
        }

        if (invite.current_uses >= invite.max_uses) {
            return {
                isValid: false,
                message: 'Инвайт-код исчерпан'
            };
        }

        return {
            isValid: true,
            inviteCode: invite
        };
    } catch (error) {
        console.error('Ошибка валидации инвайт-кода:', error);
        return {
            isValid: false,
            message: 'Ошибка проверки инвайт-кода'
        };
    }
}

// Валидация данных пользователя
function validateUserData(username, password) {
    const errors = [];

    if (!username || username.length < 3) {
        errors.push('Имя пользователя должно быть минимум 3 символа');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        errors.push('Имя пользователя может содержать только буквы, цифры, _ и -');
    }

    if (!password || password.length < 6) {
        errors.push('Пароль должен быть минимум 6 символов');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

module.exports = {
    generateToken,
    hashPassword,
    comparePassword,
    authenticateToken,
    authenticateAdmin,
    checkUserBlocked,
    logUserActivity,
    validateInviteCode,
    validateUserData
};