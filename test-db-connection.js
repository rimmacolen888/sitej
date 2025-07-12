// test-db-connection.js
require('dotenv').config();
const { Pool } = require('pg');

async function testConnection() {
    console.log('Тестирование подключения к PostgreSQL...');
    console.log('Настройки из .env:');
    console.log(`DB_HOST: ${process.env.DB_HOST}`);
    console.log(`DB_PORT: ${process.env.DB_PORT}`);
    console.log(`DB_NAME: ${process.env.DB_NAME}`);
    console.log(`DB_USER: ${process.env.DB_USER}`);
    console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD ? '***СКРЫТ***' : 'НЕ ЗАДАН'}`);

    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'site_marketplace',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
    });

    try {
        // Пробуем подключиться
        const client = await pool.connect();
        console.log('✅ Подключение к PostgreSQL успешно!');
        
        // Проверяем версию
        const result = await client.query('SELECT version()');
        console.log('Версия PostgreSQL:', result.rows[0].version);
        
        // Проверяем существование базы данных
        const dbCheck = await client.query('SELECT current_database()');
        console.log('Текущая база данных:', dbCheck.rows[0].current_database);
        
        client.release();
        
        // Проверяем существование таблиц
        console.log('\nПроверка таблиц...');
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        if (tableCheck.rows.length > 0) {
            console.log('Найденные таблицы:');
            tableCheck.rows.forEach(row => {
                console.log(`- ${row.table_name}`);
            });
        } else {
            console.log('⚠️ Таблицы не найдены. Нужно запустить инициализацию базы данных.');
            console.log('Выполните: npm run init-db');
        }
        
    } catch (error) {
        console.error('❌ Ошибка подключения к PostgreSQL:');
        console.error('Код ошибки:', error.code);
        console.error('Сообщение:', error.message);
        
        if (error.code === '28P01') {
            console.log('\n🔧 Возможные решения:');
            console.log('1. Проверьте пароль в файле .env');
            console.log('2. Сбросьте пароль PostgreSQL:');
            console.log('   - Откройте psql: psql -U postgres');
            console.log('   - Выполните: ALTER USER postgres PASSWORD \'postgres\';');
            console.log('3. Проверьте, что служба PostgreSQL запущена');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('\n🔧 Возможные решения:');
            console.log('1. Убедитесь, что PostgreSQL запущен');
            console.log('2. Проверьте порт (по умолчанию 5432)');
            console.log('3. Проверьте настройки брандмауэра');
        } else if (error.code === '3D000') {
            console.log('\n🔧 База данных не существует. Создайте её:');
            console.log('1. Подключитесь к PostgreSQL: psql -U postgres');
            console.log('2. Создайте базу: CREATE DATABASE site_marketplace;');
        }
    } finally {
        await pool.end();
    }
}

// Запуск теста
testConnection();