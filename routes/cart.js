const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const { AppError, catchAsync, validateId } = require('../middleware/errorHandler');
const { checkUserBlocked } = require('../middleware/auth');

// GET /api/cart - Получение содержимого корзины
router.get('/', catchAsync(async (req, res) => {
    const cartItems = await DatabaseService.getCartItems(req.user.id);

    // Вычисляем общую сумму
    const totalAmount = cartItems.reduce((sum, item) => {
        return sum + parseFloat(item.price || item.fixed_price || 0);
    }, 0);

    // Проверяем статус резервирования
    const hasReservation = cartItems.some(item => item.reserved_at !== null);
    let reservationExpires = null;

    if (hasReservation) {
        const reservationItem = cartItems.find(item => item.reservation_expires_at);
        if (reservationItem) {
            reservationExpires = reservationItem.reservation_expires_at;
            
            // Проверяем, не истекла ли резервация
            if (new Date() > new Date(reservationExpires)) {
                // Снимаем резервацию с истекших товаров
                await DatabaseService.query(
                    'UPDATE cart_items SET reserved_at = NULL, reservation_expires_at = NULL WHERE user_id = $1 AND reservation_expires_at < CURRENT_TIMESTAMP',
                    [req.user.id]
                );
                // Обновляем данные
                const updatedCartItems = await DatabaseService.getCartItems(req.user.id);
                return res.json({
                    success: true,
                    items: updatedCartItems,
                    total_amount: updatedCartItems.reduce((sum, item) => sum + parseFloat(item.price || item.fixed_price || 0), 0),
                    is_reserved: false,
                    reservation_expires: null,
                    can_reserve: updatedCartItems.length >= 2
                });
            }
        }
    }

    res.json({
        success: true,
        items: cartItems,
        total_amount: totalAmount,
        is_reserved: hasReservation,
        reservation_expires: reservationExpires,
        can_reserve: cartItems.length >= 2 && !hasReservation
    });
}));

// POST /api/cart/add - Добавление товара в корзину
router.post('/add',
    checkUserBlocked,
    [
        body('site_id')
            .isInt({ min: 1 })
            .withMessage('ID сайта должен быть положительным числом'),
        body('price_type')
            .isIn(['fixed', 'offer'])
            .withMessage('Тип цены должен быть fixed или offer'),
        body('price')
            .optional()
            .isFloat({ min: 0 })
            .withMessage('Цена должна быть неотрицательным числом')
    ],
    catchAsync(async (req, res) => {
        const { site_id, price_type, price } = req.body;

        // Проверяем существование сайта
        const site = await DatabaseService.getSiteById(site_id);
        
        if (!site) {
            throw new AppError('Сайт не найден', 404);
        }

        if (site.status !== 'available') {
            throw new AppError('Сайт недоступен для покупки', 403);
        }

        // Определяем цену в зависимости от типа
        let finalPrice;
        
        if (price_type === 'fixed') {
            if (!site.fixed_price) {
                throw new AppError('У сайта нет фиксированной цены', 400);
            }
            finalPrice = site.fixed_price;
        } else if (price_type === 'offer') {
            // Проверяем, что у пользователя есть выигрышное предложение
            const winningOfferResult = await DatabaseService.query(`
                SELECT * FROM price_offers
                WHERE site_id = $1 AND user_id = $2 AND status = 'winning'
            `, [site_id, req.user.id]);

            if (winningOfferResult.rows.length === 0) {
                throw new AppError('У вас нет выигрышного предложения для этого сайта', 403);
            }

            const winningOffer = winningOfferResult.rows[0];
            
            // Проверяем, не истек ли срок на покупку
            if (new Date() > winningOffer.purchase_deadline) {
                // Блокируем пользователя на 4 часа
                await DatabaseService.blockUser(req.user.id, 4);
                throw new AppError('Время на покупку истекло. Аккаунт заблокирован на 4 часа', 403);
            }

            finalPrice = winningOffer.offered_price;
        }

        // Проверяем, нет ли уже этого товара в корзине
        const existingItemResult = await DatabaseService.query(
            'SELECT * FROM cart_items WHERE user_id = $1 AND site_id = $2',
            [req.user.id, site_id]
        );

        if (existingItemResult.rows.length > 0) {
            throw new AppError('Этот товар уже в корзине', 400);
        }

        // Добавляем в корзину
        const cartItem = await DatabaseService.addToCart(req.user.id, site_id, price_type, finalPrice);

        res.status(201).json({
            success: true,
            message: 'Товар добавлен в корзину',
            item: cartItem
        });
    })
);

// DELETE /api/cart/remove/:siteId - Удаление товара из корзины
router.delete('/remove/:siteId', validateId, catchAsync(async (req, res) => {
    const { siteId } = req.params;

    // Проверяем, есть ли товар в корзине
    const existingItemResult = await DatabaseService.query(
        'SELECT * FROM cart_items WHERE user_id = $1 AND site_id = $2',
        [req.user.id, siteId]
    );

    if (existingItemResult.rows.length === 0) {
        throw new AppError('Товар не найден в корзине', 404);
    }

    const existingItem = existingItemResult.rows[0];

    // Проверяем, зарезервирован ли товар
    if (existingItem.reserved_at && new Date() < new Date(existingItem.reservation_expires_at)) {
        throw new AppError('Нельзя удалить зарезервированный товар', 403);
    }

    await DatabaseService.removeFromCart(req.user.id, siteId);

    res.json({
        success: true,
        message: 'Товар удален из корзины'
    });
}));

// POST /api/cart/reserve - Резервирование корзины
router.post('/reserve', checkUserBlocked, catchAsync(async (req, res) => {
    // Получаем текущее содержимое корзины
    const cartItems = await DatabaseService.getCartItems(req.user.id);

    if (cartItems.length < 2) {
        throw new AppError('Для резервирования нужно минимум 2 товара в корзине', 400);
    }

    // Проверяем, нет ли уже резервации
    const hasActiveReservation = cartItems.some(item => 
        item.reserved_at && new Date() < new Date(item.reservation_expires_at)
    );

    if (hasActiveReservation) {
        throw new AppError('Корзина уже зарезервирована', 400);
    }

    // Проверяем доступность всех товаров
    for (const item of cartItems) {
        const site = await DatabaseService.getSiteById(item.site_id);
        if (!site || site.status !== 'available') {
            throw new AppError(`Товар "${item.title || item.url}" больше недоступен`, 400);
        }
    }

    // Резервируем корзину
    await DatabaseService.reserveCart(req.user.id);

    const reservationExpires = new Date();
    reservationExpires.setMinutes(reservationExpires.getMinutes() + 15);

    res.json({
        success: true,
        message: 'Корзина зарезервирована на 15 минут',
        reservation_expires: reservationExpires,
        items_count: cartItems.length
    });
}));

// DELETE /api/cart/clear - Очистка корзины
router.delete('/clear', catchAsync(async (req, res) => {
    // Проверяем, нет ли зарезервированных товаров
    const reservedItemsResult = await DatabaseService.query(`
        SELECT COUNT(*) as count FROM cart_items 
        WHERE user_id = $1 AND reserved_at IS NOT NULL AND reservation_expires_at > CURRENT_TIMESTAMP
    `, [req.user.id]);

    const reservedCount = parseInt(reservedItemsResult.rows[0].count);

    if (reservedCount > 0) {
        throw new AppError('Нельзя очистить корзину с зарезервированными товарами', 403);
    }

    await DatabaseService.query(
        'DELETE FROM cart_items WHERE user_id = $1',
        [req.user.id]
    );

    res.json({
        success: true,
        message: 'Корзина очищена'
    });
}));

// GET /api/cart/check-availability - Проверка доступности товаров в корзине
router.get('/check-availability', catchAsync(async (req, res) => {
    const cartItems = await DatabaseService.getCartItems(req.user.id);
    
    const unavailableItems = [];
    const availableItems = [];

    for (const item of cartItems) {
        const site = await DatabaseService.getSiteById(item.site_id);
        
        if (!site || site.status !== 'available') {
            unavailableItems.push({
                site_id: item.site_id,
                title: item.title,
                reason: !site ? 'Сайт удален' : `Статус: ${site.status}`
            });
            
            // Удаляем недоступный товар из корзины
            await DatabaseService.removeFromCart(req.user.id, item.site_id);
        } else {
            availableItems.push(item);
        }
    }

    res.json({
        success: true,
        available_items: availableItems,
        unavailable_items: unavailableItems,
        removed_count: unavailableItems.length
    });
}));

module.exports = router;