const cron = require('node-cron');
const DatabaseService = require('./databaseService');
const TelegramService = require('./telegramService');

class SchedulerService {
    constructor() {
        this.jobs = new Map();
        this.isRunning = false;
        this.startDelay = 10000; // 10 секунд задержки перед началом
    }

    start() {
        if (this.isRunning) return;
        
        console.log('Запуск планировщика задач...');
        
        // Добавляем задержку перед запуском планировщика
        setTimeout(() => {
            this.scheduleOfferExpiration();
            this.scheduleUserUnblock();
            this.scheduleCartCleanup();
            this.scheduleDailyStats();
            this.scheduleWinningOfferNotifications();
            
            this.isRunning = true;
            console.log('Планировщик задач запущен');
        }, this.startDelay);
    }

    stop() {
        if (!this.isRunning) return;
        
        console.log('Остановка планировщика задач...');
        
        this.jobs.forEach((job, name) => {
            job.destroy();
            console.log(`Остановлена задача: ${name}`);
        });
        
        this.jobs.clear();
        this.isRunning = false;
        console.log('Планировщик задач остановлен');
    }

    scheduleOfferExpiration() {
        const job = cron.schedule('*/5 * * * *', async () => {
            try {
                await this.processExpiredOffers();
            } catch (error) {
                console.error('Ошибка обработки истекших предложений:', error.message);
            }
        }, {
            scheduled: false // Не запускаем сразу
        });

        job.start();
        this.jobs.set('offerExpiration', job);
        console.log('Запланирована задача: проверка истекших предложений (каждые 5 минут)');
    }

    scheduleUserUnblock() {
        const job = cron.schedule('*/10 * * * *', async () => {
            try {
                await this.processUserUnblock();
            } catch (error) {
                console.error('Ошибка разблокировки пользователей:', error.message);
            }
        }, {
            scheduled: false
        });

        job.start();
        this.jobs.set('userUnblock', job);
        console.log('Запланирована задача: разблокировка пользователей (каждые 10 минут)');
    }

    scheduleCartCleanup() {
        const job = cron.schedule('0 2 * * *', async () => {
            try {
                await this.cleanupExpiredCarts();
            } catch (error) {
                console.error('Ошибка очистки корзин:', error.message);
            }
        }, {
            scheduled: false
        });

        job.start();
        this.jobs.set('cartCleanup', job);
        console.log('Запланирована задача: очистка корзин (ежедневно в 02:00)');
    }

    scheduleDailyStats() {
        const job = cron.schedule('0 9 * * *', async () => {
            try {
                await this.sendDailyStats();
            } catch (error) {
                console.error('Ошибка отправки ежедневной статистики:', error.message);
            }
        }, {
            scheduled: false
        });

        job.start();
        this.jobs.set('dailyStats', job);
        console.log('Запланирована задача: ежедневная статистика (каждый день в 09:00)');
    }

    scheduleWinningOfferNotifications() {
        const job = cron.schedule('*/2 * * * *', async () => {
            try {
                await this.processWinningOffers();
            } catch (error) {
                console.error('Ошибка обработки выигрышных предложений:', error.message);
            }
        }, {
            scheduled: false
        });

        job.start();
        this.jobs.set('winningOffers', job);
        console.log('Запланирована задача: уведомления о выигрышных предложениях (каждые 2 минуты)');
    }

    async processExpiredOffers() {
        try {
            const expiredOffers = await DatabaseService.query(`
                SELECT po.*, s.title, s.url, u.username, u.id as user_id
                FROM price_offers po
                JOIN sites s ON po.site_id = s.id
                JOIN users u ON po.user_id = u.id
                WHERE po.status = 'active' AND po.expires_at < CURRENT_TIMESTAMP
            `);

            if (expiredOffers.rows.length === 0) return;

            console.log(`Обработка ${expiredOffers.rows.length} истекших предложений`);

            for (const offer of expiredOffers.rows) {
                await DatabaseService.query(`
                    UPDATE price_offers 
                    SET status = 'expired' 
                    WHERE id = $1
                `, [offer.id]);

                const remainingOffers = await DatabaseService.query(`
                    SELECT * FROM price_offers 
                    WHERE site_id = $1 AND status = 'active' 
                    ORDER BY offered_price DESC
                    LIMIT 1
                `, [offer.site_id]);

                if (remainingOffers.rows.length > 0) {
                    const winningOffer = remainingOffers.rows[0];
                    
                    await DatabaseService.query(`
                        UPDATE price_offers 
                        SET status = 'winning', purchase_deadline = CURRENT_TIMESTAMP + INTERVAL '15 minutes'
                        WHERE id = $1
                    `, [winningOffer.id]);

                    const winnerUser = await DatabaseService.getUserById(winningOffer.user_id);
                    if (winnerUser) {
                        await TelegramService.notifyWinningOffer(
                            { title: offer.title, url: offer.url },
                            winningOffer,
                            winnerUser
                        );
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка в processExpiredOffers:', error);
            throw error;
        }
    }

    async processUserUnblock() {
        try {
            const result = await DatabaseService.query(`
                UPDATE users 
                SET is_blocked = false, blocked_until = NULL 
                WHERE is_blocked = true AND blocked_until < CURRENT_TIMESTAMP
                RETURNING username
            `);

            if (result.rows.length > 0) {
                console.log(`Разблокировано пользователей: ${result.rows.length}`);
                
                for (const user of result.rows) {
                    await TelegramService.notifyUserUnblocked(user);
                }
            }
        } catch (error) {
            console.error('Ошибка в processUserUnblock:', error);
            throw error;
        }
    }

    async cleanupExpiredCarts() {
        try {
            const result = await DatabaseService.query(`
                DELETE FROM cart_items 
                WHERE reservation_expires_at < CURRENT_TIMESTAMP
                RETURNING *
            `);

            const deletedCount = result.rows.length;
            if (deletedCount > 0) {
                console.log(`Очищено истекших резерваций корзин: ${deletedCount}`);
            }

            const oldCartItems = await DatabaseService.query(`
                DELETE FROM cart_items 
                WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
                RETURNING *
            `);

            const oldDeletedCount = oldCartItems.rows.length;
            if (oldDeletedCount > 0) {
                console.log(`Удалено старых товаров из корзин: ${oldDeletedCount}`);
            }
        } catch (error) {
            console.error('Ошибка в cleanupExpiredCarts:', error);
            throw error;
        }
    }

    async sendDailyStats() {
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            
            const statsResult = await DatabaseService.query(`
                SELECT 
                    COUNT(CASE WHEN u.created_at::date = $1 THEN 1 END) as new_users,
                    COUNT(CASE WHEN o.created_at::date = $1 AND o.status = 'confirmed' THEN 1 END) as confirmed_orders,
                    COALESCE(SUM(CASE WHEN o.created_at::date = $1 AND o.status = 'confirmed' THEN o.total_amount END), 0) as daily_revenue,
                    COUNT(CASE WHEN po.created_at::date = $1 THEN 1 END) as new_offers,
                    COUNT(CASE WHEN s.upload_date::date = $1 THEN 1 END) as new_sites
                FROM users u
                FULL OUTER JOIN orders o ON 1=1
                FULL OUTER JOIN price_offers po ON 1=1
                FULL OUTER JOIN sites s ON 1=1
            `, [yesterday.toISOString().split('T')[0]]);

            const stats = statsResult.rows[0];
            
            const message = `📊 Ежедневная статистика
📅 Дата: ${yesterday.toLocaleDateString('ru-RU')}

👥 Новых пользователей: ${stats.new_users}
🛒 Подтвержденных заказов: ${stats.confirmed_orders}
💰 Выручка: ${stats.daily_revenue}₽
💡 Новых предложений: ${stats.new_offers}
🌐 Новых сайтов: ${stats.new_sites}`;

            await TelegramService.sendNotification(message);
        } catch (error) {
            console.error('Ошибка в sendDailyStats:', error);
            throw error;
        }
    }

    async processWinningOffers() {
        try {
            // Обрабатываем истекших победителей
            const expiredWinners = await DatabaseService.query(`
                SELECT po.*, s.title, s.url, u.username, u.id as user_id
                FROM price_offers po
                JOIN sites s ON po.site_id = s.id
                JOIN users u ON po.user_id = u.id
                WHERE po.status = 'winning' AND po.purchase_deadline < CURRENT_TIMESTAMP
            `);

            for (const offer of expiredWinners.rows) {
                await DatabaseService.query(`
                    UPDATE price_offers 
                    SET status = 'expired_winner' 
                    WHERE id = $1
                `, [offer.id]);

                await DatabaseService.blockUser(offer.user_id, 4);

                await TelegramService.notifyExpiredWinner(
                    { title: offer.title, url: offer.url },
                    offer,
                    { username: offer.username, id: offer.user_id }
                );
            }

            // Уведомляем о скором истечении времени
            const almostExpiredWinners = await DatabaseService.query(`
                SELECT po.*, s.title, s.url, u.username
                FROM price_offers po
                JOIN sites s ON po.site_id = s.id
                JOIN users u ON po.user_id = u.id
                WHERE po.status = 'winning' 
                AND po.purchase_deadline > CURRENT_TIMESTAMP
                AND po.purchase_deadline < CURRENT_TIMESTAMP + INTERVAL '5 minutes'
                AND po.last_reminder_sent IS NULL
            `);

            for (const offer of almostExpiredWinners.rows) {
                await TelegramService.notifyLastChance(
                    { title: offer.title, url: offer.url },
                    offer,
                    { username: offer.username }
                );

                await DatabaseService.query(`
                    UPDATE price_offers 
                    SET last_reminder_sent = CURRENT_TIMESTAMP 
                    WHERE id = $1
                `, [offer.id]);
            }
        } catch (error) {
            console.error('Ошибка в processWinningOffers:', error);
            throw error;
        }
    }
}

module.exports = new SchedulerService();