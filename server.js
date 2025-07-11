const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Импорт маршрутов
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const siteRoutes = require('./routes/sites');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const importRoutes = require('./routes/import');

// Импорт middleware
const { authenticateToken, authenticateAdmin } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/errorHandler');

// Импорт сервисов
const TelegramService = require('./services/telegramService');
const DatabaseService = require('./services/databaseService');
const SchedulerService = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация сервисов
DatabaseService.init();
TelegramService.init();
SchedulerService.start();

// Middleware безопасности
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

app.use(compression());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов на IP
    message: 'Слишком много запросов с этого IP, попробуйте позже.'
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // для авторизации только 5 попыток
    message: 'Слишком много попыток авторизации, попробуйте позже.'
});

app.use(limiter);
app.use('/api/auth', strictLimiter);

// Парсинг данных
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Логирование
app.use(requestLogger);

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// API маршруты
app.use('/api/auth', authRoutes);
app.use('/api/user', authenticateToken, userRoutes);
app.use('/api/admin', authenticateAdmin, adminRoutes);
app.use('/api/sites', authenticateToken, siteRoutes);
app.use('/api/cart', authenticateToken, cartRoutes);
app.use('/api/orders', authenticateToken, orderRoutes);
app.use('/api/import', authenticateAdmin, importRoutes);

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Админ панель
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 404 обработчик
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Страница не найдена',
        message: 'Запрашиваемый ресурс не существует'
    });
});

// Обработчик ошибок
app.use(errorHandler);

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Веб-интерфейс: http://localhost:${PORT}`);
    console.log(`Админ-панель: http://localhost:${PORT}/admin`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Получен сигнал SIGTERM, завершение работы...');
    SchedulerService.stop();
    DatabaseService.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Получен сигнал SIGINT, завершение работы...');
    SchedulerService.stop();
    DatabaseService.close();
    process.exit(0);
});

module.exports = app;