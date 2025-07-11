const express = require('express');
const { body, query } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const TelegramService = require('../services/telegramService');
const { AppError, catchAsync, validateId } = require('../middleware/errorHandler');
const { checkUserBlocked } = require('../middleware/auth');

// GET /api/sites - Получение списка сайтов
router.get('/', catchAsync(async (req, res) => {
    const {
        category,
        page = 1,
        limit = 20,
        search,
        min_price,
        max_price,
        sort_by = 'upload_date',
        sort_order = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let query = `
        SELECT s.*, c.name as category_name,
               COALESCE(po.max_offer, 0) as highest_offer,
               COALESCE(po.offers_count, 0) as offers_count,
               COALESCE(po.time_left, 0) as auction_time_left
        FROM sites s
        JOIN categories c ON s.category_id = c.id
        LEFT JOIN (
            SELECT site_id, 
                   MAX(offered_price) as max_offer, 
                   COUNT(*) as offers_count,
                   EXTRACT(EPOCH FROM (MAX(expires_at) - CURRENT_TIMESTAMP))/60 as time_left
            FROM price_offers 
            WHERE status = 'active'
            GROUP BY site_id
        ) po ON s.id = po.site_id
        WHERE s.status = 'available'
    `;
    
    const params = [];
    let paramIndex = 1;

    // Фильтр по категории
    if (category) {
        query += ` AND c.name = $${paramIndex}`;
        params.push(category);
        paramIndex++;
    }

    // Поиск по названию или URL
    if (search) {
        query += ` AND (s.title ILIKE $${paramIndex} OR s.url ILIKE $${paramIndex} OR s.description ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
    }

    // Фильтр по цене
    if (min_price) {
        query += ` AND (s.fixed_price >= $${paramIndex} OR po.max_offer >= $${paramIndex})`;
        params.push(parseFloat(min_price));
        paramIndex++;
    }

    if (max_price) {
        query += ` AND (s.fixed_price <= $${paramIndex} OR po.max_offer <= $${paramIndex})`;
        params.push(parseFloat(max_price));
        paramIndex++;
    }

    // Сортировка
    const validSortFields = ['upload_date', 'fixed_price', 'visits', 'highest_offer'];
    const validSortOrder = ['asc', 'desc'];
    
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'upload_date';
    const sortOrderValue = validSortOrder.includes(sort_order) ? sort_order : 'desc';

    if (sortField === 'highest_offer') {
        query += ` ORDER BY po.max_offer ${sortOrderValue} NULLS LAST`;
    } else {
        query += ` ORDER BY s.${sortField} ${sortOrderValue} NULLS LAST`;
    }

    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    const sitesResult = await DatabaseService.query(query, params);

    // Получаем общее количество для пагинации
    let countQuery = `
        SELECT COUNT(DISTINCT s.id) as total
        FROM sites s
        JOIN categories c ON s.category_id = c.id
        WHERE s.status = 'available'
    `;
    
    const countParams = [];
    let countParamIndex = 1;

    if (category) {
        countQuery += ` AND c.name = $${countParamIndex}`;
        countParams.push(category);
        countParamIndex++;
    }

    if (search) {
        countQuery += ` AND (s.title ILIKE $${countParamIndex} OR s.url ILIKE $${countParamIndex} OR s.description ILIKE $${countParamIndex})`;
        countParams.push(`%${search}%`);
        countParamIndex++;
    }

    if (min_price) {
        countQuery += ` AND s.fixed_price >= $${countParamIndex}`;
        countParams.push(parseFloat(min_price));
        countParamIndex++;
    }

    if (max_price) {
        countQuery += ` AND s.fixed_price <= $${countParamIndex}`;
        countParams.push(parseFloat(max_price));
        countParamIndex++;
    }

    const countResult = await DatabaseService.query(countQuery, countParams);
    const totalSites = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalSites / parseInt(limit));

    res.json({
        success: true,
        sites: sitesResult.rows,
        pagination: {
            current_page: parseInt(page),
            total_pages: totalPages,
            total_sites: totalSites,
            per_page: parseInt(limit)
        },
        filters: {
            category,
            search,
            min_price,
            max_price,
            sort_by: sortField,
            sort_order: sortOrderValue
        }
    });
}));

// GET /api/sites/categories - Получение списка категорий
router.get('/categories', catchAsync(async (req, res) => {
    const categoriesResult = await DatabaseService.query(`
        SELECT c.*, 
               COUNT(s.id) as sites_count,
               COUNT(CASE WHEN s.status = 'available' THEN 1 END) as available_count
        FROM categories c
        LEFT JOIN sites s ON c.id = s.category_id
        GROUP BY c.id, c.name, c.description
        ORDER BY c.name
    `);

    res.json({
        success: true,
        categories: categoriesResult.rows
    });
}));

// GET /api/sites/:id - Получение детальной информации о сайте
router.get('/:id', validateId, catchAsync(async (req, res) => {
    const { id } = req.params;

    const site = await DatabaseService.getSiteById(id);
    
    if (!site) {
        throw new AppError('Сайт не найден', 404);
    }

    if (site.status !== 'available') {
        throw new AppError('Сайт недоступен для просмотра', 403);
    }

    // Получаем активные предложения для этого сайта (без имен пользователей)
    const offersResult = await DatabaseService.query(`
        SELECT offered_price, expires_at, created_at
        FROM price_offers
        WHERE site_id = $1 AND status = 'active'
        ORDER BY offered_price DESC, created_at ASC
    `, [id]);

    // Проверяем, есть ли предложение от текущего пользователя
    const userOfferResult = await DatabaseService.query(`
        SELECT * FROM price_offers
        WHERE site_id = $1 AND user_id = $2 AND status IN ('active', 'winning')
        ORDER BY created_at DESC
        LIMIT 1
    `, [id, req.user.id]);

    res.json({
        success: true,
        site,
        offers: offersResult.rows,
        user_offer: userOfferResult.rows[0] || null,
        can_make_offer: !userOfferResult.rows[0] || userOfferResult.rows[0].status !== 'active'
    });
}));

// POST /api/sites/:id/offer - Сделать предложение цены
router.post('/:id/offer', 
    validateId,
    checkUserBlocked,
    [
        body('price')
            .isFloat({ min: 1 })
            .withMessage('Цена должна быть больше 0')
    ],
    catchAsync(async (req, res) => {
        const { id } = req.params;
        const { price } = req.body;

        // Проверяем существование сайта
        const site = await DatabaseService.getSiteById(id);
        
        if (!site) {
            throw new AppError('Сайт не найден', 404);
        }

        if (site.status !== 'available') {
            throw new AppError('Сайт недоступен для покупки', 403);
        }

        // Проверяем, что цена выше текущих предложений
        const currentHighestResult = await DatabaseService.query(`
            SELECT MAX(offered_price) as highest FROM price_offers
            WHERE site_id = $1 AND status = 'active'
        `, [id]);

        const currentHighest = currentHighestResult.rows[0]?.highest || 0;

        if (price <= currentHighest) {
            throw new AppError(`Предложение должно быть больше текущего максимума: ${currentHighest}₽`, 400);
        }

        // Проверяем, нет ли активного предложения от этого пользователя
        const existingOfferResult = await DatabaseService.query(`
            SELECT * FROM price_offers
            WHERE site_id = $1 AND user_id = $2 AND status = 'active'
        `, [id, req.user.id]);

        if (existingOfferResult.rows.length > 0) {
            throw new AppError('У вас уже есть активное предложение для этого сайта', 400);
        }

        // Создаем новое предложение
        const offer = await DatabaseService.createPriceOffer(id, req.user.id, price);

        // Отправляем уведомление в Telegram
        await TelegramService.notifyPriceOffer(site, offer, req.user);

        res.status(201).json({
            success: true,
            message: 'Предложение цены создано',
            offer,
            expires_at: offer.expires_at
        });
    })
);

// PUT /api/sites/:id/offer - Повышение предложения цены
router.put('/:id/offer',
    validateId,
    checkUserBlocked,
    [
        body('price')
            .isFloat({ min: 1 })
            .withMessage('Цена должна быть больше 0')
    ],
    catchAsync(async (req, res) => {
        const { id } = req.params;
        const { price } = req.body;

        // Проверяем существование сайта
        const site = await DatabaseService.getSiteById(id);
        
        if (!site) {
            throw new AppError('Сайт не найден', 404);
        }

        if (site.status !== 'available') {
            throw new AppError('Сайт недоступен для покупки', 403);
        }

        // Находим текущее предложение пользователя
        const currentOfferResult = await DatabaseService.query(`
            SELECT * FROM price_offers
            WHERE site_id = $1 AND user_id = $2 AND status = 'active'
            ORDER BY created_at DESC
            LIMIT 1
        `, [id, req.user.id]);

        if (currentOfferResult.rows.length === 0) {
            throw new AppError('У вас нет активного предложения для этого сайта', 400);
        }

        const currentOffer = currentOfferResult.rows[0];

        if (price <= currentOffer.offered_price) {
            throw new AppError(`Новое предложение должно быть больше текущего: ${currentOffer.offered_price}₽`, 400);
        }

        // Проверяем, что цена выше других предложений
        const otherHighestResult = await DatabaseService.query(`
            SELECT MAX(offered_price) as highest FROM price_offers
            WHERE site_id = $1 AND status = 'active' AND user_id != $2
        `, [id, req.user.id]);

        const otherHighest = otherHighestResult.rows[0]?.highest || 0;

        if (price <= otherHighest) {
            throw new AppError(`Предложение должно быть больше максимума других участников: ${otherHighest}₽`, 400);
        }

        // Обновляем предложение (создаем новое и деактивируем старое)
        const newOffer = await DatabaseService.createPriceOffer(id, req.user.id, price);

        // Отправляем уведомление в Telegram
        await TelegramService.notifyPriceOffer(site, newOffer, req.user);

        res.json({
            success: true,
            message: 'Предложение цены обновлено',
            offer: newOffer,
            previous_price: currentOffer.offered_price
        });
    })
);

// GET /api/sites/:id/offers - Получение предложений по сайту (только цены)
router.get('/:id/offers', validateId, catchAsync(async (req, res) => {
    const { id } = req.params;

    const site = await DatabaseService.getSiteById(id);
    
    if (!site) {
        throw new AppError('Сайт не найден', 404);
    }

    const offersResult = await DatabaseService.query(`
        SELECT offered_price, expires_at, created_at,
               EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP))/60 as minutes_left
        FROM price_offers
        WHERE site_id = $1 AND status = 'active'
        ORDER BY offered_price DESC, created_at ASC
    `, [id]);

    res.json({
        success: true,
        site_id: id,
        site_title: site.title,
        fixed_price: site.fixed_price,
        offers: offersResult.rows,
        total_offers: offersResult.rows.length
    });
}));

module.exports = router;