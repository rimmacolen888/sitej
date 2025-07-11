const DatabaseService = require('./databaseService');
const TelegramService = require('./telegramService');

class SchedulerService {
    constructor() {
        this.intervals = new Map();
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) {
            console.log('Планировщик уже запущен');
            return;
        }

        console.log('Запуск планировщика задач...');
        this.isRunning = true;

        // Проверка просроченных предложений - каждую минуту
        this.intervals.set('expiredOffers', setInterval(() => {
            this.processExpiredOffers().catch(error => {
                console.error('Ошибка обработки просроченных предложений:', error);
            });
        }, 60 * 1000)); // 1 минута

        // Проверка просроченных резерваций - каждые 2 минуты
        this.intervals.set('expiredReservations', setInterval(() => {
            this.processExpiredReservations().catch(error => {
                console.error('Ошибка обработки просроченных резерваций:', error);
            });
        }, 2 * 60 * 1000)); // 2 минуты

        // Автоматическая разблокировка пользователей - каждые 5 минут
        this.intervals.set('unblockUsers', setInterval(() => {
            this.processUserUnblocking().catch(error => {
                console.error('Ошибка разблокировки пользователей:', error);
            });
        }, 5 * 60 * 1000)); // 5 минут

        // Проверка обязательных покупок - каждые 3 минуты
        this.intervals.set('mandatoryPurchases', setInterval(() => {
            this.processMandatoryPurchases().catch(error => {
                console.error('Ошибка обработки обязательных покупок:', error);
            });
        }, 3 * 60 * 1000)); // 3 минуты

        // Очистка старых логов - каждый день в 3:00
        this.intervals.set('cleanupLogs', setInterval(() => {
            const now = new Date();
            if (now.getHours() === 3 && now.getMinutes() === 0) {
                this.cleanupOldLogs().catch(error => {
                    console.error('Ошибка очистки логов:', error);
                });
            }
        }, 60 * 1000)); // Проверяем каждую минуту, но выполняем только в 3:00

        // Статистика - каждый день в 9:00
        this.intervals.set('dailyStats', setInterval(() => {
            const now = new Date();
            if (now.getHours() === 9 && now.getMinutes() === 0) {
                this.sendDailyStats().catch(error => {
                    console.error('Ошибка отправки статистики:', error);
                });
            }
        }, 60 * 1000));

        console.log('Планировщик задач запущен успешно');
    }

    stop() {
        if (!this.isRunning) {
            console.log('Планировщик не запущен');
            return;
        }

        console.log('Остановка планировщика задач...');
        
        this.intervals.forEach((interval, name) => {
            clearInterval(interval);
            console.log(`Остановлена задача: ${name}`);
        });

        this.intervals.clear();
        this.isRunning = false;
        console.log('Планировщик задач остановлен');
    }

    // Обработка просроченных предложений
    async processExpiredOffers() {
        try {
            console.log('Проверка просроченных предложений...');

            // Находим предложения, время которых истекло
            const expiredOffersResult = await DatabaseService.query(`
                SELECT po.*, s.title, s.url, u.username
                FROM price_offers po
                JOIN sites s ON po.site_id = s.id
                JOIN users u ON po.user_id = u.id
                WHERE po.status = 'active' AND po.expires_at < CURRENT_TIMESTAMP
                ORDER BY po.site_id, po.offered_price DESC
            `);

            const expiredOffers = expiredOffersResult.rows;
            
            if (expiredOffers.length === 0) {
                return;
            }

            console.log(`Найдено ${expiredOffers.length} просроченных предложений`);

            // Группируем предложения по сайтам
            const offersBySite = {};
            expiredOffers.forEach(offer => {
                if (!offersBySite[offer.site_id]) {
                    offersBySite[offer.site_id] = [];
                }
                offersBySite[offer.site_id].push(offer);
            });

            // Обрабатываем каждый сайт
            for (const [siteId, offers] of Object.entries(offersBySite)) {
                const winningOffer = offers[0]; // Самое высокое предложение

                // Проверяем, нет ли более новых активных предложений
                const newerOffersResult = await DatabaseService.query(`
                    SELECT COUNT(*) as count 
                    FROM price_offers 
                    WHERE site_id = $1 AND status = 'active' AND expires_at > CURRENT_TIMESTAMP
                `, [siteId]);

                if (newerOffersResult.rows[0].count > 0) {
                    // Есть более новые активные предложения, просто помечаем как истекшие
                    await DatabaseService.query(`
                        UPDATE price_offers 
                        SET status = 'expired' 
                        WHERE site_id = $1 AND status = 'active' AND expires_at < CURRENT_TIMESTAMP
                    `, [siteId]);
                    continue;
                }

                // Это победившее предложение
                const purchaseDeadline = new Date();
                purchaseDeadline.setMinutes(purchaseDeadline.getMinutes() + 15); // 15 минут на покупку

                await DatabaseService.query(`
                    UPDATE price_offers 
                    SET status = 'winning', purchase_deadline = $2 
                    WHERE id = $1
                `, [winningOffer.id, purchaseDeadline]);

                // Помечаем остальные предложения как истекшие
                const otherOfferIds = offers.slice(1).map(o => o.id);
                if (otherOfferIds.length > 0) {
                    await DatabaseService.query(`
                        UPDATE price_offers 
                        SET status = 'expired' 
                        WHERE id = ANY($1)
                    `, [otherOfferIds]);
                }

                // Автоматически добавляем в корзину
                await DatabaseService.addToCart(
                    winningOffer.user_id, 
                    winningOffer.site_id, 
                    'offer', 
                    winningOffer.offered_price
                );

                // Отправляем уведомление о выигрыше
                await TelegramService.notifyAuctionWin(
                    { id: siteId, title: winningOffer.title, url: winningOffer.url },
                    winningOffer,
                    { username: winningOffer.username }
                );

                console.log(`Предложение ${winningOffer.id} стало выигрышным для сайта ${siteId}`);
            }

        } catch (error) {
            console.error('Ошибка в processExpiredOffers:', error);
        }
    }

    // Обработка просроченных резерваций
    async processExpiredReservations() {
        try {
            console.log('Проверка просроченных резерваций...');

            const result = await DatabaseService.query(`
                UPDATE cart_items 
                SET reserved_at = NULL, reservation_expires_at = NULL
                WHERE reservation_expires_at < CURRENT_TIMESTAMP AND reserved_at IS NOT NULL
                RETURNING user_id, COUNT(*) as items_count
            `);

            if (result.rows.length > 0) {
                const affectedUsers = result.rows.reduce((sum, row) => sum + parseInt(row.items_count), 0);
                console.log(`Снята резервация с ${affectedUsers} товаров`);
            }

        } catch (error) {
            console.error('Ошибка в processExpiredReservations:', error);
        }
    }

    // Автоматическая разблокировка пользователей
    async processUserUnblocking() {
        try {
            console.log('Проверка автоматической разблокировки...');

            const result = await DatabaseService.query(`
                UPDATE users 
                SET is_blocked = false, blocked_until = NULL
                WHERE is_blocked = true AND blocked_until < CURRENT_TIMESTAMP
                RETURNING id, username
            `);

            if (result.rows.length > 0) {
                console.log(`Разблокировано пользователей: ${result.rows.length}`);
                
                // Логируем разблокировку
                for (const user of result.rows) {
                    await DatabaseService.query(
                        'INSERT INTO auth_logs (user_id, action) VALUES ($1, $2)',
                        [user.id, 'auto_unblocked']
                    );
                }
            }

        } catch (error) {
            console.error('Ошибка в processUserUnblocking:', error);
        }
    }

    // Обработка обязательных покупок (блокировка за просрочку)
    async processMandatoryPurchases() {
        try {
            console.log('Проверка обязательных покупок...');

            // Находим выигрышные предложения с истекшим сроком покупки
            const overdueOffersResult = await DatabaseService.query(`
                SELECT po.*, u.username, s.title, s.url
                FROM price_offers po
                JOIN users u ON po.user_id = u.id
                JOIN sites s ON po.site_id = s.id
                WHERE po.status = 'winning' 
                AND po.purchase_deadline < CURRENT_TIMESTAMP
                AND u.is_blocked = false
            `);

            const overdueOffers = overdueOffersResult.rows;

            for (const offer of overdueOffers) {
                // Блокируем пользователя на 4 часа
                await DatabaseService.blockUser(offer.user_id, 4);

                // Обновляем статус предложения
                await DatabaseService.query(`
                    UPDATE price_offers 
                    SET status = 'expired' 
                    WHERE id = $1
                `, [offer.id]);

                // Удаляем из корзины
                await DatabaseService.removeFromCart(offer.user_id, offer.site_id);

                // Отправляем уведомление
                await TelegramService.notifyUserBlocked(
                    { username: offer.username, blocked_until: new Date(Date.now() + 4 * 60 * 60 * 1000) },
                    `Не выкупил выигранный сайт: ${offer.title || offer.url}`
                );

                console.log(`Пользователь ${offer.username} заблокирован за просрочку покупки`);
            }

        } catch (error) {
            console.error('Ошибка в processMandatoryPurchases:', error);
        }
    }

    // Очистка старых логов
    async cleanupOldLogs() {
        try {
            console.log('Очистка старых логов...');

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30); // Храним логи 30 дней

            // Очищаем старые логи авторизации
            const authLogsResult = await DatabaseService.query(`
                DELETE FROM auth_logs 
                WHERE created_at < $1
            `, [cutoffDate]);

            // Очищаем старые логи админов
            const adminLogsResult = await DatabaseService.query(`
                DELETE FROM admin_logs 
                WHERE created_at < $1
            `, [cutoffDate]);

            console.log(`Удалено ${authLogsResult.rowCount} записей из auth_logs`);
            console.log(`Удалено ${adminLogsResult.rowCount} записей из admin_logs`);

        } catch (error) {
            console.error('Ошибка в cleanupOldLogs:', error);
        }
    }

    // Ежедневная статистика
    async sendDailyStats() {
        try {
            console.log('Отправка ежедневной статистики...');

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const statsResult = await DatabaseService.query(`
                SELECT 
                    (SELECT COUNT(*) FROM users WHERE created_at >= $1 AND created_at < $2) as new_users,
                    (SELECT COUNT(*) FROM orders WHERE created_at >= $1 AND created_at < $2 AND status = 'confirmed') as new_orders,
                    (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE created_at >= $1 AND created_at < $2 AND status = 'confirmed') as daily_revenue,
                    (SELECT COUNT(*) FROM sites WHERE upload_date >= $1 AND upload_date < $2) as new_sites,
                    (SELECT COUNT(*) FROM price_offers WHERE created_at >= $1 AND created_at < $2) as new_offers
            `, [yesterday, today]);

            const stats = statsResult.rows[0];

            const message = 
                `📊 <b>ЕЖЕДНЕВНАЯ СТАТИСТИКА</b>\n` +
                `📅 Дата: ${yesterd