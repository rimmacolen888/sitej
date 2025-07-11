class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

const catchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};

const validateId = (req, res, next) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Неверный ID'
        });
    }
    next();
};

const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
        
        const logData = {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            user: req.user?.username || req.admin?.username || 'anonymous',
            service: 'site-marketplace'
        };

        console.log(`${logLevel}: HTTP Request`, JSON.stringify(logData));
    });
    
    next();
};

const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // Логируем ошибку
    console.error('Error Handler:', err);

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = 'Ресурс не найден';
        error = new AppError(message, 404);
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const message = 'Дублирующиеся данные';
        error = new AppError(message, 400);
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map(val => val.message).join(', ');
        error = new AppError(message, 400);
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        const message = 'Недействительный токен';
        error = new AppError(message, 401);
    }

    if (err.name === 'TokenExpiredError') {
        const message = 'Токен истек';
        error = new AppError(message, 401);
    }

    // PostgreSQL errors
    if (err.code === '23505') { // unique violation
        const message = 'Запись с такими данными уже существует';
        error = new AppError(message, 400);
    }

    if (err.code === '23503') { // foreign key violation
        const message = 'Связанная запись не найдена';
        error = new AppError(message, 400);
    }

    if (err.code === '23502') { // not null violation
        const message = 'Обязательное поле не заполнено';
        error = new AppError(message, 400);
    }

    res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Внутренняя ошибка сервера',
        ...(process.env.NODE_ENV === 'development' && { 
            stack: err.stack,
            error: err 
        })
    });
};

module.exports = {
    AppError,
    catchAsync,
    validateId,
    requestLogger,
    errorHandler
};