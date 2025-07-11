const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class DatabaseInitializer {
    constructor() {
        this.pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'site_marketplace',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
        });
    }

    async init() {
        try {
            console.log('Инициализация базы данных...');
            
            const schemaPath = path.join(__dirname, '..', 'database_schema.sql');
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            await this.pool.query(schema);
            console.log('База данных инициализирована успешно');
            
            await this.createDefaultData();
            console.log('Тестовые данные созданы');
            
        } catch (error) {
            console.error('Ошибка инициализации:', error);
            process.exit(1);
        } finally {
            await this.pool.end();
        }
    }

    async createDefaultData() {
        await this.pool.query(`
            INSERT INTO admins (username, password_hash) 
            VALUES ('admin', crypt('admin123', gen_salt('bf')))
            ON CONFLICT (username) DO NOTHING
        `);

        await this.pool.query(`
            INSERT INTO invite_codes (code, expires_at, max_uses) 
            VALUES ('TEST2024', CURRENT_TIMESTAMP + INTERVAL '30 days', 10)
            ON CONFLICT (code) DO NOTHING
        `);

        await this.pool.query(`
            INSERT INTO sites (category_id, url, visits, country, fixed_price, title, description) VALUES 
            (1, 'http://test-shop.com', 1000, 'Russia', 5000, 'Тестовый интернет-магазин', 'Магазин электроники'),
            (2, 'http://admin-panel.com', 500, 'Ukraine', 3000, 'Админ-панель сайта', 'Готовая админ-панель'),
            (3, 'http://author-blog.com', 2000, 'Belarus', 7000, 'Авторский блог', 'Популярный блог о технологиях'),
            (4, 'http://seo-domain.com', 800, 'Russia', 4000, 'SEO-оптимизированный домен', 'Домен с хорошими SEO-показателями')
            ON CONFLICT DO NOTHING
        `);
    }
}

if (require.main === module) {
    const initializer = new DatabaseInitializer();
    initializer.init();
}

module.exports = DatabaseInitializer;