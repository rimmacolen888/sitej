const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const TelegramService = require('../services/telegramService');
const { AppError, catchAsync, validateId } = require('../middleware/errorHandler');
const { checkUserBlocked } = require('../middleware/auth');

// POST /api/orders/create - Создание заказа из корзины
router.post('/create',
    checkUserBlocked,
    [
        body('payment_method')
            .optional()
            .isString()
            .withMessage('Способ оплаты должен быть строкой'),
        body('notes')
            .optional()
            .isString()
            .isLength({ max: 500 })
            .withMessage('Примечания не должны превышать 500 символов')
    ],
    catchAsync(async (req, res) => {
        const { payment_method, notes } = req.body;

        // Получаем содержимое корзины
        const cartItems = await DatabaseService.getCartItems(req.user.id);

        if (cartItems.length === 0) {
            throw new AppError('Корзина пуста', 400);
        }

        // Проверяем резервацию (для 2+ товаров)
        if (cartItems.length >= 2) {
            const hasValidReservation = cartItems.some(item => 
                item.reserved_at && 
                item.reservation_expires_at && 
                new Date() < new Date(item.reservation_expires_at)
            );

            if (!hasValidReservation) {
                throw new AppError('Для заказа от 2 товаров требуется резервация', 400);
            }
        }

        // Проверяем доступность всех товаров
        for (const item of cartItems) {
            const site = await DatabaseService.getSiteById(item.site_id);
            if (!site || site.status !== 'available') {
                throw new AppError(`Товар "${item.title || item.url}" больше недоступен`, 400);
            }

            // Для товаров по предложенной цене проверяем срок покупки
            if (item.price_type === 'offer') {
                const offerResult = await DatabaseService.query(`
                    SELECT * FROM price_offers
                    WHERE site_id = $1 AND user_id = $2 AND status = 'winning'
                `, [item.site_id, req.user.id]);

                if (offerResult.rows.length === 0) {
                    throw new AppError(`Нет выигрышного предложения для "${item.title || item.url}"`, 400);
                }

                const offer = offerResult.rows[0];
                if (new Date() > offer.purchase_deadline) {
                    // Блокируем пользователя
                    await DatabaseService.blockUser(req.user.id, 4);
                    throw new AppError('Время на покупку истекло. Аккаунт заблокирован на 4 часа', 403);
                }
            }
        }

        // Вычисляем общую сумму
        const totalAmount = cartItems.reduce((sum, item) => {
            return sum + parseFloat(item.price || item.fixed_price || 0);
        }, 0);

        // Создаем заказ в транзакции
        const order = await DatabaseService.transaction(async (client) => {
            // Создаем заказ
            const orderResult = await client.query(`
                INSERT INTO orders (user_id, total_amount, payment_method, notes)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `, [req.user.id, totalAmount, payment_method, notes]);

            const createdOrder = orderResult.rows[0];

            // Добавляем позиции заказа и обновляем статусы сайтов
            for (const item of cartItems) {
                // Добавляем позицию заказа
                await client.query(`
                    INSERT INTO order_items (order_id, site_id, price, price_type)
                    VALUES ($1, $2, $3, $4)
                `, [createdOrder.id, item.site_id, item.price || item.fixed_price, item.price_type]);

                // Обновляем статус сайта на "sold"
                await client.query(`
                    UPDATE sites SET status = 'sold', sold_to = $2, sold_at = CURRENT_TIMESTAMP
                    WHERE id = $1
                `, [item.site_id, req.user.id]);

                // Если это товар по предложенной цене, обновляем статус предложения
                if (item.price_type === 'offer') {
                    await client.query(`
                        UPDATE price_offers 
                        SET status = 'purchased' 
                        WHERE site_id = $1 AND user_id = $2 AND status = 'winning'
                    `, [item.site_id, req.user.id]);
                }
            }

            // Очищаем корзину
            await client.query(
                'DELETE FROM cart_items WHERE user_id = $1',
                [req.user.id]
            );

            return createdOrder;
        });

        // Отправляем уведомление в Telegram
        await TelegramService.notifyNewOrder(order, cartItems, req.user);

        res.status(201).json({
            success: true,
            message: 'Заказ успешно создан',
            order: {
                id: order.id,
                total_amount: order.total_amount,
                status: order.status,
                created_at: order.created_at
            },
            items_count: cartItems.length
        });
    })
);

// GET /api/orders - Получение списка заказов пользователя
router.get('/', catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = `
        SELECT 
            o.id, o.total_amount, o.status, o.payment_method, o.notes,
            o.created_at, o.confirmed_at,
            COUNT(oi.id) as items_count
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE o.user_id = $1
    `;
    const params = [req.user.id];

    if (status) {
        query += ` AND o.status = $${params.length + 1}`;
        params.push(status);
    }

    query += `
        GROUP BY o.id, o.total_amount, o.status, o.payment_method, o.notes, o.created_at, o.confirmed_at
        ORDER BY o.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const ordersResult = await DatabaseService.query(query, params);

    // Получаем общее количество заказов
    let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE user_id = $1';
    const countParams = [req.user.id];

    if (status) {
        countQuery += ' AND status = $2';
        countParams.push(status);
    }

    const countResult = await DatabaseService.query(countQuery, countParams);
    const totalOrders = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalOrders / limit);

    res.json({
        success: true,
        orders: ordersResult.rows,
        pagination: {
            current_page: page,
            total_pages: totalPages,
            total_orders: totalOrders,
            per_page: limit
        }
    });
}));

// GET /api/orders/:id - Получение детальной информации о заказе
router.get('/:id', validateId, catchAsync(async (req, res) => {
    const { id } = req.params;

    // Получаем заказ с проверкой принадлежности пользователю
    const orderResult = await DatabaseService.query(`
        SELECT * FROM orders WHERE id = $1 AND user_id = $2
    `, [id, req.user.id]);

    if (orderResult.rows.length === 0) {
        throw new AppError('Заказ не найден', 404);
    }

    const order = orderResult.rows[0];

    // Получаем позиции заказа
    const itemsResult = await DatabaseService.query(`
        SELECT 
            oi.price, oi.price_type, oi.created_at,
            s.id as site_id, s.title, s.url, s.description,
            c.name as category_name
        FROM order_items oi
        JOIN sites s ON oi.site_id = s.id
        JOIN categories c ON s.category_id = c.id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at
    `, [id]);

    res.json({
        success: true,
        order: {
            ...order,
            items: itemsResult.rows
        }
    });
}));

// GET /api/orders/stats - Статистика заказов пользователя
router.get('/stats/summary', catchAsync(async (req, res) => {
    const statsResult = await DatabaseService.query(`
        SELECT 
            COUNT(*) as total_orders,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
            COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_orders,
            COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
            COALESCE(SUM(CASE WHEN status = 'confirmed' THEN total_amount END), 0) as total_spent,
            COALESCE(AVG(CASE WHEN status = 'confirmed' THEN total_amount END), 0) as avg_order_value
        FROM orders 
        WHERE user_id = $1
    `, [req.user.id]);

    const categoryStatsResult = await DatabaseService.query(`
        SELECT 
            c.name as category_name,
            COUNT(oi.id) as items_purchased,
            COALESCE(SUM(oi.price), 0) as category_spent
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN sites s ON oi.site_id = s.id
        JOIN categories c ON s.category_id = c.id
        WHERE o.user_id = $1 AND o.status = 'confirmed'
        GROUP BY c.id, c.name
        ORDER BY category_spent DESC
    `, [req.user.id]);

    const stats = statsResult.rows[0];

    res.json({
        success: true,
        stats: {
            ...stats,
            total_spent: parseFloat(stats.total_spent),
            avg_order_value: parseFloat(stats.avg_order_value)
        },
        categories: categoryStatsResult.rows.map(cat => ({
            ...cat,
            category_spent: parseFloat(cat.category_spent)
        }))
    });
}));

module.exports = router;