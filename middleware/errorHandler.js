const winston = require('winston');
const path = require('path');

// Настройка логгера
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'site-marketplace' },
    transports: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/combined.log') 
        }),
    ],
});

// В режиме разработки также выводим в консоль
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Класс для пользовательских ошибок
class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

        Error.captureStackTrace(this, this.constructor);
    }
}

// Обработчик ошибок валидации базы данных
const handleValidationError = (error) => {
    if (error.code === '23505') { // Уникальное ограничение
        const field = error.detail.match(/Key \((.+?)\)/)?.[1] || 'поле';
        return new AppError(`${field} уже существует`, 400);
    }
    
    if (error.code === '23503') { // Внешний ключ
        return new AppError('Связанная запись не найдена', 400);
    }
    
    if (error.code === '23502') { // NOT NULL
        const field = error.column || 'поле';
        return new AppError(`${field} является обязательным`, 400);
    }

    return new AppError('Ошибка базы данных', 500);
};

// Обработчик JWT ошибок
const handleJWTError = () => {
    return new AppError('Недействительный токен', 401);
};

const handleJWTExpiredError = () => {
    return new AppError('Токен истек', 401);
};

// Основной обработчик ошибок
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // Логируем ошибку
    logger.error({
        error: err,
        request: {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: req.body,
            user: req.user?.id || req.admin?.id || 'anonymous'
        }
    });

    // PostgreSQL ошибки
    if (err.code) {
        error = handleValidationError(err);
    }

    // JWT ошибки
    if (err.name === 'JsonWebTokenError') {
        error = handleJWTError();
    }
    if (err.name === 'TokenExpiredError') {
        error = handleJWTExpiredError();
    }

    // Multer ошибки (загрузка файлов)
    if (err.code === 'LIMIT_FILE_SIZE') {
        error = new AppError('Файл слишком большой', 400);
    }

    // Ошибки валидации express-validator
    if (err.array && typeof err.array === 'function') {
        const messages = err.array().map(error => error.msg);
        error = new AppError(messages.join(', '), 400);
    }

    // В продакшене не показываем технические детали
    if (process.env.NODE_ENV === 'production' && !error.isOperational) {
        error = new AppError('Что-то пошло не так', 500);
    }

    res.status(error.statusCode || 500).json({
        status: error.status || 'error',
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
};

// Middleware для логирования запросов
const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            user: req.user?.id || req.admin?.id || 'anonymous'
        };

        if (res.statusCode >= 400) {
            logger.warn('HTTP Request', logData);
        } else {
            logger.info('HTTP Request', logData);
        }
    });

    next();
};

// Middleware для обработки 404
const notFoundHandler = (req, res, next) => {
    const error = new AppError(`Маршрут ${req.originalUrl} не найден`, 404);
    next(error);
};

// Функция для безопасного выполнения асинхронных операций
const catchAsync = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

// Валидация ID параметров
const validateId = (req, res, next) => {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
        return next(new AppError('Некорректный ID', 400));
    }
    
    next();
};

// Middleware для очистки входящих данных
const sanitizeInput = (req, res, next) => {
    // Удаляем потенциально опасные символы из строковых полей
    const sanitize = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                // Удаляем HTML теги и специальные символы
                obj[key] = obj[key]
                    .trim()
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/<[^>]*>/g, '')
                    .replace(/[<>]/g, '');
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitize(obj[key]);
            }
        }
    };

    if (req.body) sanitize(req.body);
    if (req.query) sanitize(req.query);
    if (req.params) sanitize(req.params);

    next();
};

module.exports = {
    AppError,
    errorHandler,
    requestLogger,
    notFoundHandler,
    catchAsync,
    validateId,
    sanitizeInput,
    logger
};