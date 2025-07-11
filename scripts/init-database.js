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
            
            // Проверяем существование файла схемы
            if (!fs.existsSync(schemaPath)) {
                console.log('Файл database_schema.sql не найден, создаем схему программно...');
                await this.createSchema();
            } else {
                console.log('Загружаем схему из файла...');
                const schema = fs.readFileSync(schemaPath, 'utf8');
                
                // Разделяем SQL на отдельные команды по точке с запятой
                const commands = schema
                    .split(';')
                    .map(cmd => cmd.trim())
                    .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));
                
                console.log(`Найдено ${commands.length} SQL команд для выполнения`);
                
                // Выполняем команды по одной
                for (let i = 0; i < commands.length; i++) {
                    const command = commands[i].trim();
                    if (command) {
                        console.log(`Выполняем команду ${i + 1}/${commands.length}...`);
                        try {
                            await this.pool.query(command);
                        } catch (cmdError) {
                            console.error(`Ошибка в команде ${i + 1}:`, cmdError.message);
                            console.error('Команда:', command.substring(0, 100) + '...');
                            // Продолжаем выполнение остальных команд
                        }
                    }
                }
            }
            
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

    async createSchema() {
        // Создаем схему программно, если файл не найден
        const schemaCommands = [
            `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
            
            `CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS invite_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(255) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                max_uses INTEGER DEFAULT 1,
                current_uses INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS sites (
                id SERIAL PRIMARY KEY,
                category_id INTEGER REFERENCES categories(id),
                url VARCHAR(500) NOT NULL,
                visits INTEGER DEFAULT 0,
                country VARCHAR(100),
                fixed_price DECIMAL(10,2),
                title VARCHAR(500),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `INSERT INTO categories (name) VALUES 
                ('Интернет-магазины'),
                ('Админ-панели'),
                ('Блоги'),
                ('SEO домены'),
                ('Социальные сети'),
                ('Новостные сайты')
                ON CONFLICT (name) DO NOTHING`
        ];

        for (const command of schemaCommands) {
            try {
                await this.pool.query(command);
            } catch (error) {
                console.error('Ошибка создания схемы:', error.message);
                console.error('Команда:', command.substring(0, 100) + '...');
            }
        }
    }

    async createDefaultData() {
        try {
            // Создаем админа
            await this.pool.query(`
                INSERT INTO admins (username, password_hash) 
                VALUES ('admin', crypt('admin123', gen_salt('bf')))
                ON CONFLICT (username) DO NOTHING
            `);

            // Создаем инвайт-код
            await this.pool.query(`
                INSERT INTO invite_codes (code, expires_at, max_uses) 
                VALUES ('TEST2024', CURRENT_TIMESTAMP + INTERVAL '30 days', 10)
                ON CONFLICT (code) DO NOTHING
            `);

            // Создаем тестовые сайты
            await this.pool.query(`
                INSERT INTO sites (category_id, url, visits, country, fixed_price, title, description) VALUES 
                (1, 'http://test-shop.com', 1000, 'Russia', 5000, 'Тестовый интернет-магазин', 'Магазин электроники'),
                (2, 'http://admin-panel.com', 500, 'Ukraine', 3000, 'Админ-панель сайта', 'Готовая админ-панель'),
                (3, 'http://author-blog.com', 2000, 'Belarus', 7000, 'Авторский блог', 'Популярный блог о технологиях'),
                (4, 'http://seo-domain.com', 800, 'Russia', 4000, 'SEO-оптимизированный домен', 'Домен с хорошими SEO-показателями')
                ON CONFLICT DO NOTHING
            `);
            
        } catch (error) {
            console.error('Ошибка создания тестовых данных:', error.message);
            throw error;
        }
    }

    // Метод для проверки подключения
    async testConnection() {
        try {
            const result = await this.pool.query('SELECT NOW()');
            console.log('Подключение к базе данных успешно:', result.rows[0]);
            return true;
        } catch (error) {
            console.error('Ошибка подключения к базе данных:', error.message);
            return false;
        }
    }
}

if (require.main === module) {
    const initializer = new DatabaseInitializer();
    
    // Сначала проверяем подключение
    initializer.testConnection().then(connected => {
        if (connected) {
            initializer.init();
        } else {
            console.error('Не удалось подключиться к базе данных. Проверьте настройки в .env файле.');
            process.exit(1);
        }
    });
}

module.exports = DatabaseInitializer;