// debug-admin-login.js
require('dotenv').config();

async function testAdminLogin() {
    const loginData = {
        username: 'admin',
        password: 'admin123'
    };

    try {
        console.log('Тестирование админского логина...');
        console.log('URL:', 'http://localhost:3000/api/admin/auth/login');
        console.log('Данные:', loginData);

        const response = await fetch('http://localhost:3000/api/admin/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(loginData)
        });

        console.log('Статус ответа:', response.status);
        console.log('Заголовки ответа:', Object.fromEntries(response.headers.entries()));

        const responseText = await response.text();
        console.log('Тело ответа:', responseText);

        if (response.ok) {
            const data = JSON.parse(responseText);
            console.log('✅ Логин успешен!');
            console.log('Токен получен:', data.token ? 'Да' : 'Нет');
        } else {
            console.log('❌ Ошибка логина');
            try {
                const errorData = JSON.parse(responseText);
                console.log('Ошибка:', errorData.message);
            } catch (e) {
                console.log('Не удалось распарсить ошибку');
            }
        }

    } catch (error) {
        console.error('Ошибка запроса:', error.message);
    }
}

testAdminLogin();