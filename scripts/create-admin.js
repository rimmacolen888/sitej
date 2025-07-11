const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const readline = require('readline');
require('dotenv').config();

class AdminCreator {
    constructor() {
        this.pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'site_marketplace',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
        });

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async create() {
        try {
            console.log('Создание нового администратора\n');
            
            const username = await this.question('Имя пользователя: ');
            const password = await this.question('Пароль: ', true);
            const telegramId = await this.question('Telegram ID (опционально): ');

            if (!username || !password) {
                throw new Error('Имя пользователя и пароль обязательны');
            }

            const existingAdmin = await this.pool.query(
                'SELECT id FROM admins WHERE username = $1',
                [username]
            );

            if (existingAdmin.rows.length > 0) {
                throw new Error('Администратор с таким именем уже существует');
            }

            const passwordHash = await bcrypt.hash(password, 12);
            
            const result = await this.pool.query(`
                INSERT INTO admins (username, password_hash, telegram_id, permissions) 
                VALUES ($1, $2, $3, $4) 
                RETURNING id, username, created_at
            `, [
                username, 
                passwordHash, 
                telegramId || null, 
                JSON.stringify({
                    manage_users: true,
                    manage_sites: true,
                    manage_invites: true,
                    manage_orders: true,
                    import_data: true
                })
            ]);

            console.log('\nАдминистратор создан успешно:');
            console.log(`ID: ${result.rows[0].id}`);
            console.log(`Имя: ${result.rows[0].username}`);
            console.log(`Создан: ${result.rows[0].created_at}`);

        } catch (error) {
            console.error('Ошибка создания администратора:', error.message);
        } finally {
            this.rl.close();
            await this.pool.end();
        }
    }

    async question(query, isPassword = false) {
        return new Promise((resolve) => {
            if (isPassword) {
                const stdin = process.stdin;
                stdin.setRawMode(true);
                stdin.resume();
                stdin.setEncoding('utf8');
                
                process.stdout.write(query);
                let password = '';
                
                stdin.on('data', function(char) {
                    char = char + '';
                    
                    switch (char) {
                        case '\n':
                        case '\r':
                        case '\u0004':
                            stdin.setRawMode(false);
                            stdin.pause();
                            process.stdout.write('\n');
                            resolve(password);
                            break;
                        case '\u0003':
                            process.exit();
                            break;
                        case '\u007f':
                            if (password.length > 0) {
                                password = password.slice(0, -1);
                                process.stdout.write('\b \b');
                            }
                            break;
                        default:
                            password += char;
                            process.stdout.write('*');
                            break;
                    }
                });
            } else {
                this.rl.question(query, resolve);
            }
        });
    }
}

if (require.main === module) {
    const creator = new AdminCreator();
    creator.create();
}

module.exports = AdminCreator;