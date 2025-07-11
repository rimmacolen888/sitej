const { Pool } = require('pg');
require('dotenv').config();

class DatabaseService {
    constructor() {
        this.pool = null;
    }

    init() {
        this.pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'site_marketplace',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        this.pool.on('error', (err) => {
            console.error('Ошибка PostgreSQL пула:', err);
        });

        console.log('База данных PostgreSQL подключена');
    }

    async query(text, params) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result;
        } finally {
            client.release();
        }
    }

    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // Методы для работы с пользователями
    async createUser(username, passwordHash, inviteCode) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 15); // 15 дней доступа

        const query = `
            INSERT INTO users (username, password_hash, invite_code_used, access_expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id, username, access_expires_at, created_at
        `;
        const result = await this.query(query, [username, passwordHash, inviteCode, expiresAt]);
        return result.rows[0];
    }

    async getUserByUsername(username) {
        const query = 'SELECT * FROM users WHERE username = $1';
        const result = await this.query(query, [username]);
        return result.rows[0];
    }

    async getUserById(id) {
        const query = 'SELECT * FROM users WHERE id = $1';
        const result = await this.query(query, [id]);
        return result.rows[0];
    }

    async updateUserLastLogin(userId, ipAddress, country) {
        const query = `
            UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1;
            INSERT INTO auth_logs (user_id, ip_address, country, action)
            VALUES ($1, $2, $3, 'login');
        `;
        await this.query(query, [userId, ipAddress, country]);
    }

    async blockUser(userId, hours = 4) {
        const blockedUntil = new Date();
        blockedUntil.setHours(blockedUntil.getHours() + hours);

        const query = `
            UPDATE users SET is_blocked = true, blocked_until = $2 WHERE id = $1;
            INSERT INTO auth_logs (user_id, action) VALUES ($1, 'blocked');
        `;
        await this.query(query, [userId, blockedUntil]);
    }

    async unblockExpiredUsers() {
        const query = `
            UPDATE users SET is_blocked = false, blocked_until = NULL 
            WHERE is_blocked = true AND blocked_until < CURRENT_TIMESTAMP
        `;
        await this.query(query);
    }

    // Методы для работы с инвайт-кодами
    async validateInviteCode(code) {
        const query = `
            SELECT * FROM invite_codes 
            WHERE code = $1 AND is_active = true AND expires_at > CURRENT_TIMESTAMP
            AND current_uses < max_uses
        `;
        const result = await this.query(query, [code]);
        return result.rows[0];
    }

    async useInviteCode(code) {
        const query = `
            UPDATE invite_codes SET current_uses = current_uses + 1 
            WHERE code = $1
            RETURNING *
        `;
        const result = await this.query(query, [code]);
        return result.rows[0];
    }

    async createInviteCode(code, expiresAt, maxUses = 1, adminId) {
        const query = `
            INSERT INTO invite_codes (code, expires_at, max_uses, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const result = await this.query(query, [code, expiresAt, maxUses, adminId]);
        return result.rows[0];
    }

    // Методы для работы с сайтами
    async getSites(categoryId = null, status = 'available', limit = 50, offset = 0) {
        let query = `
            SELECT s.*, c.name as category_name,
                   COALESCE(po.max_offer, 0) as highest_offer,
                   COALESCE(po.offers_count, 0) as offers_count
            FROM sites s
            JOIN categories c ON s.category_id = c.id
            LEFT JOIN (
                SELECT site_id, MAX(offered_price) as max_offer, COUNT(*) as offers_count
                FROM price_offers WHERE status = 'active'
                GROUP BY site_id
            ) po ON s.id = po.site_id
            WHERE s.status = $1
        `;
        const params = [status];

        if (categoryId) {
            query += ` AND s.category_id = $${params.length + 1}`;
            params.push(categoryId);
        }

        query += ` ORDER BY s.upload_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await this.query(query, params);
        return result.rows;
    }

    async getSiteById(id) {
        const query = `
            SELECT s.*, c.name as category_name,
                   COALESCE(po.max_offer, 0) as highest_offer,
                   COALESCE(po.offers_count, 0) as offers_count
            FROM sites s
            JOIN categories c ON s.category_id = c.id
            LEFT JOIN (
                SELECT site_id, MAX(offered_price) as max_offer, COUNT(*) as offers_count
                FROM price_offers WHERE status = 'active'
                GROUP BY site_id
            ) po ON s.id = po.site_id
            WHERE s.id = $1
        `;
        const result = await this.query(query, [id]);
        return result.rows[0];
    }

    async createSite(siteData) {
        const {
            categoryId, url, visits, country, fixedPrice, title,
            description, cms, domain, tags, additionalFields, importBatchId
        } = siteData;

        const query = `
            INSERT INTO sites (
                category_id, url, visits, country, fixed_price, title,
                description, cms, domain, tags, additional_fields, import_batch_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `;
        const params = [
            categoryId, url, visits, country, fixedPrice, title,
            description, cms, domain, tags, JSON.stringify(additionalFields), importBatchId
        ];

        const result = await this.query(query, params);
        return result.rows[0];
    }

    async updateSiteStatus(siteId, status, userId = null) {
        const query = `
            UPDATE sites SET status = $2, sold_to = $3, sold_at = 
            CASE WHEN $2 = 'sold' THEN CURRENT_TIMESTAMP ELSE sold_at END
            WHERE id = $1
            RETURNING *
        `;
        const result = await this.query(query, [siteId, status, userId]);
        return result.rows[0];
    }

    // Методы для работы с предложениями цен
    async createPriceOffer(siteId, userId, offeredPrice) {
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 30); // 30 минут на аукцион

        // Сначала деактивируем старые предложения этого пользователя для этого сайта
        await this.query(
            'UPDATE price_offers SET status = \'expired\' WHERE site_id = $1 AND user_id = $2 AND status = \'active\'',
            [siteId, userId]
        );

        const query = `
            INSERT INTO price_offers (site_id, user_id, offered_price, expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const result = await this.query(query, [siteId, userId, offeredPrice, expiresAt]);
        return result.rows[0];
    }

    async getActiveOffers(siteId) {
        const query = `
            SELECT po.*, u.username 
            FROM price_offers po
            JOIN users u ON po.user_id = u.id
            WHERE po.site_id = $1 AND po.status = 'active'
            ORDER BY po.offered_price DESC, po.created_at ASC
        `;
        const result = await this.query(query, [siteId]);
        return result.rows;
    }

    async getWinningOffer(siteId) {
        const query = `
            SELECT po.*, u.username 
            FROM price_offers po
            JOIN users u ON po.user_id = u.id
            WHERE po.site_id = $1 AND po.status = 'winning'
        `;
        const result = await this.query(query, [siteId]);
        return result.rows[0];
    }

    async processExpiredOffers() {
        // Находим предложения, время которых истекло
        const expiredQuery = `
            SELECT site_id, user_id, offered_price, id
            FROM price_offers 
            WHERE status = 'active' AND expires_at < CURRENT_TIMESTAMP
            ORDER BY site_id, offered_price DESC
        `;
        const expiredOffers = await this.query(expiredQuery);

        for (const offer of expiredOffers.rows) {
            // Проверяем, есть ли более высокие предложения
            const higherOfferQuery = `
                SELECT COUNT(*) as count FROM price_offers 
                WHERE site_id = $1 AND offered_price > $2 AND status = 'active'
            `;
            const higherResult = await this.query(higherOfferQuery, [offer.site_id, offer.offered_price]);

            if (higherResult.rows[0].count === 0) {
                // Это победившее предложение
                const purchaseDeadline = new Date();
                purchaseDeadline.setMinutes(purchaseDeadline.getMinutes() + 15); // 15 минут на покупку

                await this.query(
                    'UPDATE price_offers SET status = \'winning\', purchase_deadline = $2 WHERE id = $1',
                    [offer.id, purchaseDeadline]
                );

                // Добавляем в корзину автоматически
                await this.addToCart(offer.user_id, offer.site_id, 'offer', offer.offered_price);
            } else {
                // Проигравшее предложение
                await this.query(
                    'UPDATE price_offers SET status = \'expired\' WHERE id = $1',
                    [offer.id]
                );
            }
        }
    }

    // Методы для работы с корзиной
    async addToCart(userId, siteId, priceType, price) {
        const query = `
            INSERT INTO cart_items (user_id, site_id, price_type, price)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, site_id) DO UPDATE SET
                price_type = $3, price = $4, created_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        const result = await this.query(query, [userId, siteId, priceType, price]);
        return result.rows[0];
    }

    async getCartItems(userId) {
        const query = `
            SELECT ci.*, s.title, s.url, s.fixed_price, c.name as category_name
            FROM cart_items ci
            JOIN sites s ON ci.site_id = s.id
            JOIN categories c ON s.category_id = c.id
            WHERE ci.user_id = $1 AND s.status = 'available'
            ORDER BY ci.created_at DESC
        `;
        const result = await this.query(query, [userId]);
        return result.rows;
    }

    async removeFromCart(userId, siteId) {
        const query = 'DELETE FROM cart_items WHERE user_id = $1 AND site_id = $2';
        await this.query(query, [userId, siteId]);
    }

    async reserveCart(userId) {
        const cartCount = await this.query(
            'SELECT COUNT(*) as count FROM cart_items WHERE user_id = $1',
            [userId]
        );

        if (cartCount.rows[0].count < 2) {
            throw new Error('Для резервирования нужно минимум 2 товара в корзине');
        }

        const reservationExpires = new Date();
        reservationExpires.setMinutes(reservationExpires.getMinutes() + 15); // 15 минут резерва

        const query = `
            UPDATE cart_items 
            SET reserved_at = CURRENT_TIMESTAMP, reservation_expires_at = $2
            WHERE user_id = $1
        `;
        await this.query(query, [userId, reservationExpires]);
    }

    // Методы для антипаблик проверки
    async checkAntipublic(content) {
        const query = 'SELECT * FROM antipublic_database WHERE full_content = $1';
        const result = await this.query(query, [content]);
        return result.rows[0];
    }

    async addToAntipublic(contentHash, fullContent, sourceInfo) {
        const query = `
            INSERT INTO antipublic_database (content_hash, full_content, source_info)
            VALUES ($1, $2, $3)
            ON CONFLICT (content_hash) DO NOTHING
            RETURNING *
        `;
        const result = await this.query(query, [contentHash, fullContent, sourceInfo]);
        return result.rows[0];
    }

    // Методы для категорий
    async getCategories() {
        const query = 'SELECT * FROM categories ORDER BY name';
        const result = await this.query(query);
        return result.rows;
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('Соединение с базой данных закрыто');
        }
    }
}

module.exports = new DatabaseService();