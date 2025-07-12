// fix-admin-password.js
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function fixAdminPassword() {
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'site_marketplace',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
    });

    try {
        console.log('Проверка и исправление пароля администратора...');

        // Проверяем существующего админа
        const existingAdmin = await pool.query('SELECT * FROM admins WHERE username = $1', ['admin']);
        
        if (existingAdmin.rows.length === 0) {
            console.log('Администратор не найден. Создаем нового...');
            
            // Создаем нового админа
            const passwordHash = await bcrypt.hash('admin123', 12);
            await pool.query(`
                INSERT INTO admins (username, password_hash, is_active, permissions) 
                VALUES ($1, $2, true, $3)
            `, [
                'admin', 
                passwordHash, 
                JSON.stringify({
                    manage_users: true,
                    manage_sites: true,
                    manage_invites: true,
                    manage_orders: true,
                    import_data: true
                })
            ]);
            
            console.log('✅ Администратор создан успешно');
        } else {
            console.log('Администратор найден. Обновляем пароль...');
            
            // Проверяем текущий пароль
            const admin = existingAdmin.rows[0];
            const isValidPassword = await bcrypt.compare('admin123', admin.password_hash);
            
            if (!isValidPassword) {
                console.log('Пароль неверный, обновляем...');
                
                // Обновляем пароль
                const newPasswordHash = await bcrypt.hash('admin123', 12);
                await pool.query(
                    'UPDATE admins SET password_hash = $2, is_active = true WHERE username = $1',
                    ['admin', newPasswordHash]
                );
                
                console.log('✅ Пароль администратора обновлен');
            } else {
                console.log('✅ Пароль администратора корректный');
                
                // Убеждаемся что админ активен
                await pool.query(
                    'UPDATE admins SET is_active = true WHERE username = $1',
                    ['admin']
                );
            }
        }

        // Проверяем логин
        console.log('\nТестирование логина...');
        const testAdmin = await pool.query('SELECT * FROM admins WHERE username = $1', ['admin']);
        const testPasswordValid = await bcrypt.compare('admin123', testAdmin.rows[0].password_hash);
        
        console.log('Имя пользователя: admin');
        console.log('Пароль валиден:', testPasswordValid);
        console.log('Администратор активен:', testAdmin.rows[0].is_active);
        
        if (testPasswordValid && testAdmin.rows[0].is_active) {
            console.log('\n🎉 Все готово! Попробуйте войти в админ-панель:');
            console.log('URL: http://localhost:3000/admin.html');
            console.log('Логин: admin');
            console.log('Пароль: admin123');
        } else {
            console.log('\n❌ Что-то пошло не так. Проверьте настройки.');
        }

    } catch (error) {
        console.error('Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

fixAdminPassword();