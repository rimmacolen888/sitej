const TelegramBot = require('node-telegram-bot-api');
const DatabaseService = require('./databaseService');

class TelegramService {
    constructor() {
        this.bot = null;
        this.chatId = null;
        this.isInitialized = false;
    }

    async init() {
        try {
            const token = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;

            if (!token || !chatId) {
                console.log('Telegram бот не настроен (отсутствуют TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID)');
                return;
            }

            this.bot = new TelegramBot(token, { polling: false });
            this.chatId = chatId;
            this.isInitialized = true;

            // Проверяем соединение
            await this.bot.getMe();
            console.log('Telegram бот инициализирован успешно');

            // Настраиваем команды бота
            this.setupBotCommands();

        } catch (error) {
            console.error('Ошибка инициализации Telegram бота:', error.message);
            this.isInitialized = false;
        }
    }

    setupBotCommands() {
        if (!this.bot) return;

        // Команда /start
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            await this.bot.sendMessage(chatId, 
                '🤖 Бот Site Marketplace запущен!\n\n' +
                'Доступные команды:\n' +
                '/stats - Статистика платформы\n' +
                '/orders - Последние заказы\n' +
                '/users - Активные пользователи\n' +
                '/sites - Статистика по сайтам'
            );
        });

        // Команда /stats - общая статистика
        this.bot.onText(/\/stats/, async (msg) => {
            try {
                const stats = await this.getStats();
                await this.bot.sendMessage(msg.chat.id, stats);
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, '❌ Ошибка получения статистики');
            }
        });

        // Команда /orders - последние заказы
        this.bot.onText(/\/orders/, async (msg) => {
            try {
                const orders = await this.getRecentOrders();
                await this.bot.sendMessage(msg.chat.id, orders);
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, '❌ Ошибка получения заказов');
            }
        });

        // Команда /users - активные пользователи
        this.bot.onText(/\/users/, async (msg) => {
            try {
                const users = await this.getActiveUsers();
                await this.bot.sendMessage(msg.chat.id, users);
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, '❌ Ошибка получения пользователей');
            }
        });

        // Команда /sites - статистика по сайтам
        this.bot.onText(/\/sites/, async (msg) => {
            try {
                const sites = await this.getSitesStats();
                await this.bot.sendMessage(msg.chat.id, sites);
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, '❌ Ошибка получения статистики сайтов');
            }
        });
    }

    async sendNotification(message, options = {}) {
        if (!this.isInitialized) {
            console.log('Telegram уведомление (бот не настроен):', message);
            return;
        }

        try {
            const defaultOptions = {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            };

            await this.bot.sendMessage(
                this.chatId, 
                message, 
                { ...defaultOptions, ...options }
            );
        } catch (error) {
            console.error('Ошибка отправки Telegram уведомления:', error.message);
        }
    }

    // Уведомления о новых заказах
    async notifyNewOrder(order, items, user) {
        const totalItems = items.length;
        const itemsList = items.map(item => 
            `• ${item.title || item.url} - ${item.price}₽`
        ).join('\n');

        const message = 
            `🛒 <b>НОВЫЙ ЗАКАЗ #${order.id}</b>\n\n` +
            `👤 Пользователь: ${user.username}\n` +
            `💰 Сумма: ${order.total_amount}₽\n` +
            `📦 Товаров: ${totalItems}\n\n` +
            `<b>Состав заказа:</b>\n${itemsList}\n\n` +
            `⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

        await this.sendNotification(message);
    }

    // Уведомления о предложениях цен
    async notifyPriceOffer(site, offer, user) {
        const message = 
            `💰 <b>НОВОЕ ПРЕДЛОЖЕНИЕ ЦЕНЫ</b>\n\n` +
            `🌐 Сайт: ${site.title || site.url}\n` +
            `👤 Пользователь: ${user.username}\n` +
            `💵 Предложенная цена: ${offer.offered_price}₽\n` +
            `💲 Фиксированная цена: ${site.fixed_price || 'Не указана'}₽\n\n` +
            `⏰ Истекает: ${new Date(offer.expires_at).toLocaleString('ru-RU')}`;

        await this.sendNotification(message);
    }

    // Уведомления о загрузке новых материалов
    async notifyNewImport(categoryName, stats) {
        const message = 
            `📂 <b>ЗАГРУЖЕНЫ НОВЫЕ ${categoryName.toUpperCase()}</b>\n\n` +
            `📊 Всего записей: ${stats.total_records}\n` +
            `✅ Успешно: ${stats.successful_records}\n` +
            `❌ Ошибок: ${stats.failed_records}\n` +
            `🔍 Найдено в антипаблик: ${stats.antipublic_found || 0}\n\n` +
            `⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

        await this.sendNotification(message);
    }

    // Уведомления о блокировке пользователей
    async notifyUserBlocked(user, reason) {
        const message = 
            `🚫 <b>ПОЛЬЗОВАТЕЛЬ ЗАБЛОКИРОВАН</b>\n\n` +
            `👤 Пользователь: ${user.username}\n` +
            `📝 Причина: ${reason}\n` +
            `🕐 До: ${new Date(user.blocked_until).toLocaleString('ru-RU')}\n\n` +
            `⏰ Время блокировки: ${new Date().toLocaleString('ru-RU')}`;

        await this.sendNotification(message);
    }

    // Уведомления о выигрыше аукциона
    async notifyAuctionWin(site, offer, user) {
        const message = 
            `🏆 <b>АУКЦИОН ЗАВЕРШЕН</b>\n\n` +
            `🌐 Сайт: ${site.title || site.url}\n` +
            `👤 Победитель: ${user.username}\n` +
            `💰 Выигрышная цена: ${offer.offered_price}₽\n\n` +
            `⚠️ У пользователя есть 15 минут на покупку\n` +
            `⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

        await this.sendNotification(message);
    }

    // Получение статистики для команд бота
    async getStats() {
        try {
            const result = await DatabaseService.query(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as total_users,
                    (SELECT COUNT(*) FROM users WHERE access_expires_at > CURRENT_TIMESTAMP) as active_users,
                    (SELECT COUNT(*) FROM sites WHERE status = 'available') as available_sites,
                    (SELECT COUNT(*) FROM sites WHERE status = 'sold') as sold_sites,
                    (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') as total_orders,
                    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'confirmed') as total_revenue,
                    (SELECT COUNT(*) FROM price_offers WHERE status = 'active') as active_offers
            `);

            const stats = result.rows[0];

            return `📊 <b>СТАТИСТИКА ПЛАТФОРМЫ</b>\n\n` +
                   `👥 Всего пользователей: ${stats.total_users}\n` +
                   `✅ Активных: ${stats.active_users}\n\n` +
                   `🌐 Доступных сайтов: ${stats.available_sites}\n` +
                   `💰 Продано: ${stats.sold_sites}\n\n` +
                   `🛒 Заказов: ${stats.total_orders}\n` +
                   `💵 Общая выручка: ${stats.total_revenue}₽\n\n` +
                   `🎯 Активных ставок: ${stats.active_offers}`;

        } catch (error) {
            return '❌ Ошибка получения статистики';
        }
    }

    async getRecentOrders() {
        try {
            const result = await DatabaseService.query(`
                SELECT o.id, o.total_amount, o.created_at, u.username,
                       COUNT(oi.id) as items_count
                FROM orders o
                JOIN users u ON o.user_id = u.id
                LEFT JOIN order_items oi ON o.id = oi.order_id
                WHERE o.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
                GROUP BY o.id, o.total_amount, o.created_at, u.username
                ORDER BY o.created_at DESC
                LIMIT 10
            `);

            if (result.rows.length === 0) {
                return '📦 Нет заказов за последние 24 часа';
            }

            let message = '📦 <b>ПОСЛЕДНИЕ ЗАКАЗЫ (24ч)</b>\n\n';
            
            result.rows.forEach(order => {
                message += `#${order.id} - ${order.username}\n` +
                          `💰 ${order.total_amount}₽ (${order.items_count} товаров)\n` +
                          `⏰ ${new Date(order.created_at).toLocaleString('ru-RU')}\n\n`;
            });

            return message;

        } catch (error) {
            return '❌ Ошибка получения заказов';
        }
    }

    async getActiveUsers() {
        try {
            const result = await DatabaseService.query(`
                SELECT username, last_login, access_expires_at,
                       (SELECT COUNT(*) FROM orders WHERE user_id = users.id) as orders_count
                FROM users 
                WHERE access_expires_at > CURRENT_TIMESTAMP
                ORDER BY last_login DESC NULLS LAST
                LIMIT 10
            `);

            if (result.rows.length === 0) {
                return '👥 Нет активных пользователей';
            }

            let message = '👥 <b>АКТИВНЫЕ ПОЛЬЗОВАТЕЛИ</b>\n\n';
            
            result.rows.forEach(user => {
                const lastLogin = user.last_login ? 
                    new Date(user.last_login).toLocaleString('ru-RU') : 
                    'Никогда';
                    
                message += `${user.username}\n` +
                          `📈 Заказов: ${user.orders_count}\n` +
                          `🕐 Последний вход: ${lastLogin}\n` +
                          `⏳ Доступ до: ${new Date(user.access_expires_at).toLocaleDateString('ru-RU')}\n\n`;
            });

            return message;

        } catch (error) {
            return '❌ Ошибка получения пользователей';
        }
    }

    async getSitesStats() {
        try {
            const result = await DatabaseService.query(`
                SELECT 
                    c.name as category_name,
                    COUNT(CASE WHEN s.status = 'available' THEN 1 END) as available,
                    COUNT(CASE WHEN s.status = 'sold' THEN 1 END) as sold,
                    COUNT(CASE WHEN s.status = 'reserved' THEN 1 END) as reserved,
                    AVG(CASE WHEN s.fixed_price IS NOT NULL THEN s.fixed_price END) as avg_price
                FROM categories c
                LEFT JOIN sites s ON c.id = s.category_id
                GROUP BY c.id, c.name
                ORDER BY c.name
            `);

            let message = '🌐 <b>СТАТИСТИКА ПО КАТЕГОРИЯМ</b>\n\n';
            
            result.rows.forEach(cat => {
                const avgPrice = cat.avg_price ? Math.round(cat.avg_price) : 0;
                message += `📂 <b>${cat.category_name.toUpperCase()}</b>\n` +
                          `✅ Доступно: ${cat.available || 0}\n` +
                          `💰 Продано: ${cat.sold || 0}\n` +
                          `⏳ В резерве: ${cat.reserved || 0}\n` +
                          `💵 Средняя цена: ${avgPrice}₽\n\n`;
            });

            return message;

        } catch (error) {
            return '❌ Ошибка получения статистики сайтов';
        }
    }
}

module.exports = new TelegramService();