const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const TelegramService = require('../services/telegramService');
const { AppError, catchAsync, validateId } = require('../middleware/errorHandler');
const { hashPassword } = require('../middleware/auth');

// GET /api/admin/dashboard - Главная панель с статистикой
router.get('/dashboard', catchAsync(async (req, res) => {
    const statsResult = await DatabaseService.query(`
        SELECT 
            (SELECT COUNT(*) FROM users) as total_users,
            (SELECT COUNT(*) FROM users WHERE access_expires_at > CURRENT_TIMESTAMP) as active_users,
            (SELECT COUNT(*) FROM users WHERE is_blocked = true) as blocked_users,
            (SELECT COUNT(*) FROM sites) as total_sites,
            (SELECT COUNT(*) FROM sites WHERE status = 'available') as available_sites,
            (SELECT COUNT(*) FROM sites WHERE status = 'sold') as sold_sites,
            (SELECT COUNT(*) FROM orders WHERE status = 'confirmed') as confirmed_orders,
            (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE status = 'confirmed') as total_revenue,
            (SELECT COUNT(*) FROM price_offers WHERE status = 'active') as active_offers,
            (SELECT COUNT(*) FROM invite_codes WHERE is_active = true) as active_invites
    `);

    const recentActivityResult = await DatabaseService.query(`
        (SELECT 'login' as type, created_at, 
                json_build_object('username', (SELECT username FROM users WHERE id = user_id), 'country', country) as details
         FROM auth_logs WHERE action = 'login' ORDER BY created_at DESC LIMIT 5)
        UNION ALL
        (SELECT 'order' as type, created_at,
                json_build_object('order_id', id, 'amount', total_amount, 'username', (SELECT username FROM users WHERE id = user_id)) as details
         FROM orders ORDER BY created_at DESC LIMIT 5)
        ORDER BY created_at DESC
        LIMIT 10
    `);

    const categoriesStatsResult = await DatabaseService.query(`
        SELECT 
            c.name as category_name,
            COUNT(s.id) as total_sites,
            COUNT(CASE WHEN s.status = 'available' THEN 1 END) as available,
            COUNT(CASE WHEN s.status = 'sold' THEN 1 END) as sold,
            COALESCE(AVG(s.fixed_price), 0) as avg_price
        FROM categories c
        LEFT JOIN sites s ON c.id = s.category_id
        GROUP BY c.id, c.name
        ORDER BY c.name
    `);

    res.json({
        success: true,
        stats: statsResult.rows[0],
        recent_activity: recentActivityResult.rows,
        categories: categoriesStatsResult.rows.map(cat => ({
            ...cat,
            avg_price: parseFloat(cat.avg_price)
        }))
    });
}));

// УПРАВЛЕНИЕ ИНВАЙТ-КОДАМИ

// GET /api/admin/invites - Список инвайт-кодов
router.get('/invites', catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const invitesResult = await DatabaseService.query(`
        SELECT 
            ic.*,
            (SELECT username FROM admins WHERE id = ic.created_by) as created_by_username,
            (SELECT COUNT(*) FROM users WHERE invite_code_used = ic.code) as users_count
        FROM invite_codes ic
        ORDER BY ic.created_at DESC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countResult = await DatabaseService.query('SELECT COUNT(*) as total FROM invite_codes');
    const totalInvites = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalInvites / limit);

    res.json({
        success: true,
        invites: invitesResult.rows,
        pagination: {
            current_page: page,
            total_pages: totalPages,
            total_invites: totalInvites,
            per_page: limit
        }
    });
}));

// POST /api/admin/invites - Создание нового инвайт-кода
router.post('/invites',
    [
        body('code')
            .isLength({ min: 3, max: 50 })
            .withMessage('Код должен быть от 3 до 50 символов')
            .matches(/^[a-zA-Z0-9_-]+$/)
            .withMessage('Код может содержать только буквы, цифры, _ и -'),
        body('expires_in_days')
            .isInt({ min: 1, max: 365 })
            .withMessage('Срок действия от 1 до 365 дней'),
        body('max_uses')
            .isInt({ min: 1, max: 1000 })
            .withMessage('Максимальное использование от 1 до 1000')
    ],
    catchAsync(async (req, res) => {
        const { code, expires_in_days, max_uses } = req.body;

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expires_in_days);

        const invite = await DatabaseService.createInviteCode(code, expiresAt, max_uses, req.admin.id);

        await DatabaseService.query(
            'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [req.admin.id, 'create_invite', JSON.stringify({ code, expires_in_days, max_uses })]
        );

        res.status(201).json({
            success: true,
            message: 'Инвайт-код создан',
            invite
        });
    })
);

// PUT /api/admin/invites/:id - Деактивация инвайт-кода
router.put('/invites/:id', validateId, catchAsync(async (req, res) => {
    const { id } = req.params;

    const result = await DatabaseService.query(
        'UPDATE invite_codes SET is_active = false WHERE id = $1 RETURNING *',
        [id]
    );

    if (result.rows.length === 0) {
        throw new AppError('Инвайт-код не найден', 404);
    }

    await DatabaseService.query(
        'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
        [req.admin.id, 'deactivate_invite', JSON.stringify({ invite_id: id, code: result.rows[0].code })]
    );

    res.json({
        success: true,
        message: 'Инвайт-код деактивирован',
        invite: result.rows[0]
    });
}));

// УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ

// GET /api/admin/users - Список пользователей
router.get('/users', catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status; // 'active', 'blocked', 'expired'
    const offset = (page - 1) * limit;

    let query = `
        SELECT 
            u.id, u.username, u.invite_code_used, u.access_expires_at, 
            u.is_blocked, u.blocked_until, u.last_login, u.created_at,
            (SELECT COUNT(*) FROM orders WHERE user_id = u.id AND status = 'confirmed') as orders_count,
            (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE user_id = u.id AND status = 'confirmed') as total_spent
        FROM users u
        WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (status === 'active') {
        query += ` AND u.access_expires_at > CURRENT_TIMESTAMP AND u.is_blocked = false`;
    } else if (status === 'blocked') {
        query += ` AND u.is_blocked = true`;
    } else if (status === 'expired') {
        query += ` AND u.access_expires_at <= CURRENT_TIMESTAMP`;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const usersResult = await DatabaseService.query(query, params);

    res.json({
        success: true,
        users: usersResult.rows.map(user => ({
            ...user,
            total_spent: parseFloat(user.total_spent)
        })),
        pagination: {
            current_page: page,
            per_page: limit
        }
    });
}));

// PUT /api/admin/users/:id/block - Блокировка пользователя
router.put('/users/:id/block',
    validateId,
    [
        body('hours')
            .isInt({ min: 1, max: 168 })
            .withMessage('Время блокировки от 1 до 168 часов'),
        body('reason')
            .isString()
            .isLength({ min: 3, max: 200 })
            .withMessage('Причина блокировки обязательна (3-200 символов)')
    ],
    catchAsync(async (req, res) => {
        const { id } = req.params;
        const { hours, reason } = req.body;

        const user = await DatabaseService.getUserById(id);
        if (!user) {
            throw new AppError('Пользователь не найден', 404);
        }

        await DatabaseService.blockUser(id, hours);

        await DatabaseService.query(
            'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [req.admin.id, 'block_user', JSON.stringify({ user_id: id, username: user.username, hours, reason })]
        );

        await TelegramService.notifyUserBlocked(user, reason);

        res.json({
            success: true,
            message: `Пользователь ${user.username} заблокирован на ${hours} часов`,
            reason
        });
    })
);

// PUT /api/admin/users/:id/unblock - Разблокировка пользователя
router.put('/users/:id/unblock', validateId, catchAsync(async (req, res) => {
    const { id } = req.params;

    const user = await DatabaseService.getUserById(id);
    if (!user) {
        throw new AppError('Пользователь не найден', 404);
    }

    await DatabaseService.query(
        'UPDATE users SET is_blocked = false, blocked_until = NULL WHERE id = $1',
        [id]
    );

    await DatabaseService.query(
        'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
        [req.admin.id, 'unblock_user', JSON.stringify({ user_id: id, username: user.username })]
    );

    res.json({
        success: true,
        message: `Пользователь ${user.username} разблокирован`
    });
}));

// УПРАВЛЕНИЕ САЙТАМИ

// GET /api/admin/sites - Список сайтов для админа
router.get('/sites', catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const category = req.query.category;
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = `
        SELECT 
            s.*, c.name as category_name,
            (SELECT username FROM users WHERE id = s.sold_to) as sold_to_username,
            COALESCE(po.max_offer, 0) as highest_offer,
            COALESCE(po.offers_count, 0) as offers_count
        FROM sites s
        JOIN categories c ON s.category_id = c.id
        LEFT JOIN (
            SELECT site_id, MAX(offered_price) as max_offer, COUNT(*) as offers_count
            FROM price_offers WHERE status = 'active'
            GROUP BY site_id
        ) po ON s.id = po.site_id
        WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (category) {
        query += ` AND c.name = $${paramIndex}`;
        params.push(category);
        paramIndex++;
    }

    if (status) {
        query += ` AND s.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
    }

    query += ` ORDER BY s.upload_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const sitesResult = await DatabaseService.query(query, params);

    res.json({
        success: true,
        sites: sitesResult.rows,
        pagination: {
            current_page: page,
            per_page: limit
        }
    });
}));

// PUT /api/admin/sites/:id - Редактирование сайта
router.put('/sites/:id',
    validateId,
    [
        body('title').optional().isString().isLength({ max: 255 }),
        body('description').optional().isString().isLength({ max: 2000 }),
        body('fixed_price').optional().isFloat({ min: 0 }),
        body('status').optional().isIn(['available', 'sold', 'reserved', 'hidden']),
        body('tags').optional().isArray()
    ],
    catchAsync(async (req, res) => {
        const { id } = req.params;
        const { title, description, fixed_price, status, tags } = req.body;

        const site = await DatabaseService.getSiteById(id);
        if (!site) {
            throw new AppError('Сайт не найден', 404);
        }

        const updates = [];
        const params = [id];
        let paramIndex = 2;

        if (title !== undefined) {
            updates.push(`title = $${paramIndex}`);
            params.push(title);
            paramIndex++;
        }

        if (description !== undefined) {
            updates.push(`description = $${paramIndex}`);
            params.push(description);
            paramIndex++;
        }

        if (fixed_price !== undefined) {
            updates.push(`fixed_price = $${paramIndex}`);
            params.push(fixed_price);
            paramIndex++;
        }

        if (status !== undefined) {
            updates.push(`status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        if (tags !== undefined) {
            updates.push(`tags = $${paramIndex}`);
            params.push(tags);
            paramIndex++;
        }

        if (updates.length === 0) {
            throw new AppError('Нет данных для обновления', 400);
        }

        const query = `UPDATE sites SET ${updates.join(', ')} WHERE id = $1 RETURNING *`;
        const result = await DatabaseService.query(query, params);

        await DatabaseService.query(
            'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [req.admin.id, 'update_site', JSON.stringify({ site_id: id, changes: req.body })]
        );

        res.json({
            success: true,
            message: 'Сайт обновлен',
            site: result.rows[0]
        });
    })
);

// DELETE /api/admin/sites/:id - Удаление сайта
router.delete('/sites/:id', validateId, catchAsync(async (req, res) => {
    const { id } = req.params;

    const site = await DatabaseService.getSiteById(id);
    if (!site) {
        throw new AppError('Сайт не найден', 404);
    }

    if (site.status === 'sold') {
        throw new AppError('Нельзя удалить проданный сайт', 400);
    }

    await DatabaseService.query('DELETE FROM sites WHERE id = $1', [id]);

    await DatabaseService.query(
        'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
        [req.admin.id, 'delete_site', JSON.stringify({ site_id: id, url: site.url })]
    );

    res.json({
        success: true,
        message: 'Сайт удален'
    });
}));

// УПРАВЛЕНИЕ ЗАКАЗАМИ

// GET /api/admin/orders - Список заказов
router.get('/orders', catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = `
        SELECT 
            o.*, u.username,
            COUNT(oi.id) as items_count
        FROM orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (status) {
        query += ` AND o.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
    }

    query += ` GROUP BY o.id, u.username ORDER BY o.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const ordersResult = await DatabaseService.query(query, params);

    res.json({
        success: true,
        orders: ordersResult.rows,
        pagination: {
            current_page: page,
            per_page: limit
        }
    });
}));

// PUT /api/admin/orders/:id/status - Изменение статуса заказа
router.put('/orders/:id/status',
    validateId,
    [
        body('status')
            .isIn(['pending', 'confirmed', 'cancelled'])
            .withMessage('Неверный статус заказа')
    ],
    catchAsync(async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        const orderResult = await DatabaseService.query(
            'UPDATE orders SET status = $2, confirmed_at = CASE WHEN $2 = \'confirmed\' THEN CURRENT_TIMESTAMP ELSE confirmed_at END WHERE id = $1 RETURNING *',
            [id, status]
        );

        if (orderResult.rows.length === 0) {
            throw new AppError('Заказ не найден', 404);
        }

        await DatabaseService.query(
            'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
            [req.admin.id, 'change_order_status', JSON.stringify({ order_id: id, new_status: status })]
        );

        res.json({
            success: true,
            message: `Статус заказа изменен на ${status}`,
            order: orderResult.rows[0]
        });
    })
);

module.exports = router;