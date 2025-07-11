const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

class DatabaseBackup {
    constructor() {
        this.config = {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME || 'site_marketplace',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
        };
    }

    async createBackup(outputPath = null) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(__dirname, '..', 'backups');
            const backupFile = outputPath || path.join(backupDir, `backup_${timestamp}.sql`);

            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            console.log(`Создание бэкапа базы данных: ${this.config.database}`);
            console.log(`Файл: ${backupFile}`);

            await this.pgDump(backupFile);
            
            const stats = fs.statSync(backupFile);
            console.log(`Бэкап создан успешно (размер: ${this.formatBytes(stats.size)})`);
            
            await this.cleanOldBackups(backupDir);
            
            return backupFile;

        } catch (error) {
            console.error('Ошибка создания бэкапа:', error.message);
            throw error;
        }
    }

    async pgDump(outputFile) {
        return new Promise((resolve, reject) => {
            const args = [
                '-h', this.config.host,
                '-p', this.config.port.toString(),
                '-U', this.config.user,
                '-d', this.config.database,
                '--no-password',
                '--clean',
                '--create',
                '--verbose',
                '-f', outputFile
            ];

            const env = { 
                ...process.env, 
                PGPASSWORD: this.config.password 
            };

            const pgDump = spawn('pg_dump', args, { env });

            let stderr = '';

            pgDump.stderr.on('data', (data) => {
                stderr += data.toString();
                if (data.toString().includes('pg_dump:')) {
                    process.stdout.write('.');
                }
            });

            pgDump.on('close', (code) => {
                if (code === 0) {
                    console.log('\n');
                    resolve();
                } else {
                    reject(new Error(`pg_dump завершился с кодом ${code}: ${stderr}`));
                }
            });

            pgDump.on('error', (error) => {
                reject(new Error(`Ошибка запуска pg_dump: ${error.message}`));
            });
        });
    }

    async restoreBackup(backupFile) {
        try {
            console.log(`Восстановление из бэкапа: ${backupFile}`);

            if (!fs.existsSync(backupFile)) {
                throw new Error('Файл бэкапа не найден');
            }

            await this.psqlRestore(backupFile);
            console.log('Восстановление завершено успешно');

        } catch (error) {
            console.error('Ошибка восстановления:', error.message);
            throw error;
        }
    }

    async psqlRestore(backupFile) {
        return new Promise((resolve, reject) => {
            const args = [
                '-h', this.config.host,
                '-p', this.config.port.toString(),
                '-U', this.config.user,
                '-d', 'postgres',
                '--no-password',
                '-f', backupFile
            ];

            const env = { 
                ...process.env, 
                PGPASSWORD: this.config.password 
            };

            const psql = spawn('psql', args, { env });

            let stderr = '';

            psql.stderr.on('data', (data) => {
                stderr += data.toString();
                process.stdout.write('.');
            });

            psql.on('close', (code) => {
                if (code === 0) {
                    console.log('\n');
                    resolve();
                } else {
                    reject(new Error(`psql завершился с кодом ${code}: ${stderr}`));
                }
            });

            psql.on('error', (error) => {
                reject(new Error(`Ошибка запуска psql: ${error.message}`));
            });
        });
    }

    async cleanOldBackups(backupDir, keepCount = 10) {
        try {
            const files = fs.readdirSync(backupDir)
                .filter(file => file.startsWith('backup_') && file.endsWith('.sql'))
                .map(file => ({
                    name: file,
                    path: path.join(backupDir, file),
                    stat: fs.statSync(path.join(backupDir, file))
                }))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            if (files.length > keepCount) {
                const filesToDelete = files.slice(keepCount);
                console.log(`Удаление старых бэкапов: ${filesToDelete.length}`);
                
                for (const file of filesToDelete) {
                    fs.unlinkSync(file.path);
                    console.log(`Удален: ${file.name}`);
                }
            }

        } catch (error) {
            console.warn('Ошибка очистки старых бэкапов:', error.message);
        }
    }

    async getBackupsList() {
        const backupDir = path.join(__dirname, '..', 'backups');
        
        if (!fs.existsSync(backupDir)) {
            return [];
        }

        return fs.readdirSync(backupDir)
            .filter(file => file.startsWith('backup_') && file.endsWith('.sql'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stat = fs.statSync(filePath);
                return {
                    name: file,
                    path: filePath,
                    size: this.formatBytes(stat.size),
                    created: stat.mtime.toISOString()
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async scheduleBackup(intervalHours = 24) {
        console.log(`Запуск автоматического бэкапа каждые ${intervalHours} часов`);
        
        const backup = async () => {
            try {
                await this.createBackup();
                console.log('Автоматический бэкап завершен');
            } catch (error) {
                console.error('Ошибка автоматического бэкапа:', error.message);
            }
        };

        await backup();
        setInterval(backup, intervalHours * 60 * 60 * 1000);
    }
}

if (require.main === module) {
    const backup = new DatabaseBackup();
    
    const command = process.argv[2];
    const arg = process.argv[3];

    switch (command) {
        case 'create':
            backup.createBackup(arg);
            break;
        case 'restore':
            if (!arg) {
                console.error('Укажите путь к файлу бэкапа');
                process.exit(1);
            }
            backup.restoreBackup(arg);
            break;
        case 'list':
            backup.getBackupsList().then(list => {
                console.log('Доступные бэкапы:');
                list.forEach(item => {
                    console.log(`${item.name} (${item.size}, ${item.created})`);
                });
            });
            break;
        case 'schedule':
            const hours = parseInt(arg) || 24;
            backup.scheduleBackup(hours);
            break;
        default:
            console.log('Использование:');
            console.log('  node backup-db.js create [путь]     - Создать бэкап');
            console.log('  node backup-db.js restore <путь>    - Восстановить из бэкапа');
            console.log('  node backup-db.js list              - Список бэкапов');
            console.log('  node backup-db.js schedule [часы]   - Автоматический бэкап');
            break;
    }
}

module.exports = DatabaseBackup;