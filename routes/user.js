const express = require('express');
const { body, query } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const { AppError, catchAsync, validateId } = require('../middleware/errorHandler');
const { checkUserBlocked } = require('../middleware/auth');

// GET /api/user/profile - Получение профиля пользователя
router.get('/profile', catchAsync(async (req, res) => {
    const user = await DatabaseService.getUserById(req.user.id);
    
    if (!user) {
        throw new AppError('Пользователь не найден', 404);
    }

    // Получаем статистику пользователя
    const statsResult = await DatabaseService.query(`
        SELECT 
            COUNT(CASE WHEN o.status = 'confirmed' THEN 1 END) as total_orders,
            COALESCE(SUM(CASE WHEN o.status = 'confirmed' THEN o.total_amount END), 0) as total_spent,
            COUNT(CASE WHEN po.status = 'active' THEN 1 END) as active_offers,
            COUNT(ci.id) as cart_items
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        LEFT JOIN price_offers po ON u.id = po.user_id
        LEFT JOIN cart_items ci ON u.id = ci.user_id
        WHERE u.id = $1
        GROUP BY u.id
    `, [req.user.id]);

    const stats = statsResult.rows[0] || {
        total_orders: 0,
        total_spent: 0,
        active_offers: 0,
        cart_items: 0
    };

    // Удаляем чувствительные данные
    delete user.password_hash;

    res.json({
        success: true,
        user: {
            ...user,
            stats
        }
    });
}));

// GET /api/user/purchase-history - История покупок
router.get('/purchase-history', catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const ordersResult = await DatabaseService.query(`
        SELECT 
            o.id, o.total_amount, o.status, o.created_at, o.confirmed_at,
            json_agg(
                json_build_object(
                    'site_id', oi.site_id,
                    'title', s.title,
                    'url', s.url,
                    'category', c.name,
                    'price', oi.price,
                    'price_type', oi.price_type
                )
            ) as items
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN sites s ON oi.site_id = s.id
        JOIN categories c ON s.category_id = c.id
        WHERE o.user_id = $1
        GROUP BY o.id, o.total_amount, o.status, o.created_at, o.confirmed_at
        ORDER BY o.created_at DESC
        LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    // Получаем общее количество заказов
    const countResult = await DatabaseService.query(
        'SELECT COUNT(*) as total FROM orders WHERE user_id = $1',
        [req.user.id]
    );

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

// GET /api/user/purchase-history/:category - История покупок по категориям
router.get('/purchase-history/:category', catchAsync(async (req, res) => {
    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const validCategories = ['shop', 'adminki', 'autors', 'ceo', 'offer'];
    
    if (!validCategories.includes(category)) {
        throw new AppError('Неверная категория', 400);
    }

    let query, params;

    if (category === 'offer') {
        // Сайты купленные по предложенной цене
        query = `
            SELECT 
                o.id, o.total_amount, o.status, o.created_at, o.confirmed_at,
                json_agg(
                    json_build_object(
                        'site_id', oi.site_id,
                        'title', s.title,
                        'url', s.url,
                        'category', c.name,
                        'price', oi.price,
                        'price_type', oi.price_type
                    )
                ) as items
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN sites s ON oi.site_id = s.id
            JOIN categories c ON s.category_id = c.id
            WHERE o.user_id = $1 AND oi.price_type = 'offer'
            GROUP BY o.id, o.total_amount, o.status, o.created_at, o.confirmed_at
            ORDER BY o.created_at DESC
            LIMIT $2 OFFSET $3
        `;
        params = [req.user.id, limit, offset];
    } else {
        // Сайты по конкретной категории
        query = `
            SELECT 
                o.id, o.total_amount, o.status, o.created_at, o.confirmed_at,
                json_agg(
                    json_build_object(
                        'site_id', oi.site_id,
                        'title', s.title,
                        'url', s.url,
                        'category', c.name,
                        'price', oi.price,
                        'price_type', oi.price_type
                    )
                ) as items
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN sites s ON oi.site_id = s.id
            JOIN categories c ON s.category_id = c.id
            WHERE o.user_id = $1 AND c.name = $2
            GROUP BY o.id, o.total_amount, o.status, o.created_at, o.confirmed_at
            ORDER BY o.created_at DESC
            LIMIT $3 OFFSET $4
        `;
        params = [req.user.id, category, limit, offset];
    }

    const ordersResult = await DatabaseService.query(query, params);

    res.json({
        success: true,
        category,
        orders: ordersResult.rows,
        pagination: {
            current_page: page,
            per_page: limit
        }
    });
}));

// GET /api/user/active-offers - Активные предложения пользователя
router.get('/active-offers', catchAsync(async (req, res) => {
    const offersResult = await DatabaseService.query(`
        SELECT 
            po.id, po.offered_price, po.status, po.expires_at, po.created_at,
            s.id as site_id, s.title, s.url, s.fixed_price,
            c.name as category_name,
            (SELECT MAX(offered_price) FROM price_offers WHERE site_id = s.id AND status = 'active') as highest_offer
        FROM price_offers po
        JOIN sites s ON po.site_id = s.id
        JOIN categories c ON s.category_id = c.id
        WHERE po.user_id = $1 AND po.status IN ('active', 'winning')
        ORDER BY po.created_at DESC
    `, [req.user.id]);

    res.json({
        success: true,
        offers: offersResult.rows
    });
}));

// GET /api/user/blocked-status - Проверка статуса блокировки
router.get('/blocked-status', catchAsync(async (req, res) => {
    const user = await DatabaseService.getUserById(req.user.id);
    
    let isBlocked = user.is_blocked;
    let blockedUntil = user.blocked_until;

    // Проверяем, не истекла ли блокировка
    if (isBlocked && blockedUntil && new Date() > blockedUntil) {
        await DatabaseService.unblockExpiredUsers();
        isBlocked = false;
        blockedUntil = null;
    }

    res.json({
        success: true,
        is_blocked: isBlocked,
        blocked_until: blockedUntil,
        can_purchase: !isBlocked && new Date() < user.access_expires_at
    });
}));

module.exports = router;