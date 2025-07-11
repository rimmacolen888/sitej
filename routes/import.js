const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { body } = require('express-validator');
const router = express.Router();

const DatabaseService = require('../services/databaseService');
const TelegramService = require('../services/telegramService');
const { AppError, catchAsync } = require('../middleware/errorHandler');

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB по умолчанию
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/plain' || path.extname(file.originalname).toLowerCase() === '.txt') {
            cb(null, true);
        } else {
            cb(new AppError('Можно загружать только TXT файлы', 400));
        }
    }
});

// Сервис для обработки импорта
class ImportService {
    static async parseFile(filePath, categoryId) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            if (lines.length === 0) {
                throw new AppError('Файл пуст', 400);
            }

            // Определяем структуру файла по первой строке
            const firstLine = lines[0].trim();
            const delimiter = this.detectDelimiter(firstLine);
            const headers = firstLine.split(delimiter).map(h => h.trim());
            
            // Проверяем обязательные поля
            const requiredFields = ['url'];
            const missingFields = requiredFields.filter(field => 
                !headers.some(h => h.toLowerCase().includes(field.toLowerCase()))
            );
            
            if (missingFields.length > 0) {
                throw new AppError(`Отсутствуют обязательные поля: ${missingFields.join(', ')}`, 400);
            }

            const records = [];
            
            // Обрабатываем каждую строку начиная со второй (первая - заголовки)
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const values = line.split(delimiter).map(v => v.trim());
                
                if (values.length !== headers.length) {
                    console.warn(`Строка ${i + 1}: несоответствие количества полей`);
                    continue;
                }

                const record = { categoryId };
                const additionalFields = {};
                
                // Сопоставляем значения с заголовками
                headers.forEach((header, index) => {
                    const value = values[index];
                    const lowerHeader = header.toLowerCase();
                    
                    if (lowerHeader.includes('url')) {
                        record.url = this.cleanUrl(value);
                    } else if (lowerHeader.includes('visit') || lowerHeader.includes('traffic')) {
                        record.visits = parseInt(value) || 0;
                    } else if (lowerHeader.includes('country') || lowerHeader.includes('страна')) {
                        record.country = value;
                    } else if (lowerHeader.includes('price') || lowerHeader.includes('цена')) {
                        record.fixedPrice = parseFloat(value) || null;
                    } else if (lowerHeader.includes('title') || lowerHeader.includes('название')) {
                        record.title = value;
                    } else if (lowerHeader.includes('cms')) {
                        record.cms = value;
                    } else if (lowerHeader.includes('domain') || lowerHeader.includes('домен')) {
                        record.domain = value;
                    } else {
                        // Все остальные поля сохраняем в additional_fields
                        additionalFields[header] = value;
                    }
                });

                if (Object.keys(additionalFields).length > 0) {
                    record.additionalFields = additionalFields;
                }

                if (record.url) {
                    records.push(record);
                }
            }

            return {
                headers,
                records,
                totalRecords: records.length
            };

        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(`Ошибка парсинга файла: ${error.message}`, 400);
        }
    }

    static detectDelimiter(line) {
        const delimiters = [':', '\t', '|', ';', ','];
        const counts = delimiters.map(del => ({
            delimiter: del,
            count: (line.match(new RegExp(`\\${del}`, 'g')) || []).length
        }));
        
        const maxCount = Math.max(...counts.map(c => c.count));
        const bestDelimiter = counts.find(c => c.count === maxCount);
        
        return bestDelimiter ? bestDelimiter.delimiter : ':';
    }

    static cleanUrl(url) {
        if (!url) return url;
        
        // Убираем лишние пробелы и символы
        url = url.trim();
        
        // Добавляем http:// если нет протокола
        if (!/^https?:\/\//i.test(url)) {
            url = 'http://' + url;
        }
        
        return url;
    }

    static async checkAntipublic(records) {
        const results = {
            clean: [],
            found: [],
            errors: []
        };

        for (const record of records) {
            try {
                // Создаем хеш содержимого для быстрого поиска
                const contentForHash = JSON.stringify({
                    url: record.url,
                    visits: record.visits,
                    country: record.country
                });
                
                const contentHash = crypto.createHash('md5').update(contentForHash).digest('hex');
                
                // Проверяем в базе антипаблик
                const existingRecord = await DatabaseService.checkAntipublic(contentForHash);
                
                if (existingRecord) {
                    results.found.push({
                        ...record,
                        antipublic_details: existingRecord.source_info,
                        found_at: existingRecord.added_at
                    });
                } else {
                    results.clean.push(record);
                }
                
            } catch (error) {
                console.error('Ошибка проверки антипаблик:', error);
                results.errors.push({
                    ...record,
                    error: error.message
                });
            }
        }

        return results;
    }
}

// POST /api/import/sites - Импорт сайтов из TXT файла
router.post('/sites',
    upload.single('file'),
    [
        body('category_id')
            .isInt({ min: 1 })
            .withMessage('ID категории обязателен'),
        body('auto_approve_antipublic')
            .optional()
            .isBoolean()
            .withMessage('auto_approve_antipublic должен быть boolean')
    ],
    catchAsync(async (req, res) => {
        if (!req.file) {
            throw new AppError('Файл не загружен', 400);
        }

        const { category_id, auto_approve_antipublic = false } = req.body;

        // Проверяем существование категории
        const categoryResult = await DatabaseService.query(
            'SELECT * FROM categories WHERE id = $1',
            [category_id]
        );

        if (categoryResult.rows.length === 0) {
            throw new AppError('Категория не найдена', 404);
        }

        const category = categoryResult.rows[0];

        try {
            // Создаем запись о батче импорта
            const batchResult = await DatabaseService.query(`
                INSERT INTO import_batches (category_id, filename, admin_id, status)
                VALUES ($1, $2, $3, 'processing')
                RETURNING *
            `, [category_id, req.file.originalname, req.admin.id]);

            const batch = batchResult.rows[0];

            // Парсим файл
            const parseResult = await ImportService.parseFile(req.file.path, category_id);
            
            // Обновляем количество записей в батче
            await DatabaseService.query(
                'UPDATE import_batches SET total_records = $2 WHERE id = $1',
                [batch.id, parseResult.totalRecords]
            );

            // Проверяем антипаблик
            const antipublicResult = await ImportService.checkAntipublic(parseResult.records);

            let processedRecords = 0;
            let successfulRecords = 0;
            let failedRecords = 0;

            // Обрабатываем чистые записи
            for (const record of antipublicResult.clean) {
                try {
                    await DatabaseService.createSite({
                        ...record,
                        importBatchId: batch.id
                    });
                    successfulRecords++;
                } catch (error) {
                    console.error('Ошибка создания сайта:', error);
                    failedRecords++;
                }
                processedRecords++;
            }

            // Обрабатываем найденные в антипаблик записи
            const antipublicDecisions = [];
            
            for (const record of antipublicResult.found) {
                if (auto_approve_antipublic) {
                    try {
                        await DatabaseService.createSite({
                            ...record,
                            antipublic_status: 'found',
                            importBatchId: batch.id
                        });
                        successfulRecords++;
                        antipublicDecisions.push({ ...record, decision: 'approved' });
                    } catch (error) {
                        console.error('Ошибка создания сайта с антипаблик:', error);
                        failedRecords++;
                        antipublicDecisions.push({ ...record, decision: 'error', error: error.message });
                    }
                } else {
                    // Сохраняем для ручного решения
                    antipublicDecisions.push({ ...record, decision: 'pending' });
                }
                processedRecords++;
            }

            // Обновляем статистику батча
            await DatabaseService.query(`
                UPDATE import_batches 
                SET processed_records = $2, successful_records = $3, failed_records = $4, 
                    status = 'completed', completed_at = CURRENT_TIMESTAMP,
                    antipublic_check_results = $5
                WHERE id = $1
            `, [
                batch.id, 
                processedRecords, 
                successfulRecords, 
                failedRecords,
                JSON.stringify({
                    total_found: antipublicResult.found.length,
                    auto_approved: auto_approve_antipublic ? antipublicResult.found.length : 0,
                    pending_decisions: auto_approve_antipublic ? 0 : antipublicResult.found.length,
                    decisions: antipublicDecisions
                })
            ]);

            // Удаляем загруженный файл
            try {
                await fs.unlink(req.file.path);
            } catch (error) {
                console.warn('Не удалось удалить временный файл:', error.message);
            }

            // Логируем действие
            await DatabaseService.query(
                'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
                [req.admin.id, 'import_sites', JSON.stringify({
                    batch_id: batch.id,
                    category: category.name,
                    filename: req.file.originalname,
                    total_records: parseResult.totalRecords,
                    successful: successfulRecords,
                    failed: failedRecords,
                    antipublic_found: antipublicResult.found.length
                })]
            );

            // Отправляем уведомление в Telegram
            await TelegramService.notifyNewImport(category.name, {
                total_records: parseResult.totalRecords,
                successful_records: successfulRecords,
                failed_records: failedRecords,
                antipublic_found: antipublicResult.found.length
            });

            res.status(201).json({
                success: true,
                message: 'Импорт завершен',
                batch_id: batch.id,
                stats: {
                    total_records: parseResult.totalRecords,
                    processed_records: processedRecords,
                    successful_records: successfulRecords,
                    failed_records: failedRecords,
                    clean_records: antipublicResult.clean.length,
                    antipublic_found: antipublicResult.found.length,
                    pending_decisions: auto_approve_antipublic ? 0 : antipublicResult.found.length
                },
                antipublic_decisions: auto_approve_antipublic ? null : antipublicDecisions
            });

        } catch (error) {
            // Обновляем статус батча как неудачный
            if (batch) {
                await DatabaseService.query(
                    'UPDATE import_batches SET status = \'failed\', completed_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [batch.id]
                );
            }

            // Удаляем временный файл
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.warn('Не удалось удалить временный файл:', unlinkError.message);
            }

            throw error;
        }
    })
);

// POST /api/import/antipublic - Загрузка антипаблик базы
router.post('/antipublic',
    upload.single('file'),
    catchAsync(async (req, res) => {
        if (!req.file) {
            throw new AppError('Файл не загружен', 400);
        }

        try {
            const content = await fs.readFile(req.file.path, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());

            let addedCount = 0;
            let skippedCount = 0;

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                try {
                    const contentHash = crypto.createHash('md5').update(trimmedLine).digest('hex');
                    
                    const result = await DatabaseService.addToAntipublic(
                        contentHash,
                        trimmedLine,
                        `Imported from ${req.file.originalname} at ${new Date().toISOString()}`
                    );

                    if (result) {
                        addedCount++;
                    } else {
                        skippedCount++; // Дубликат
                    }
                } catch (error) {
                    console.error('Ошибка добавления в антипаблик:', error);
                    skippedCount++;
                }
            }

            // Удаляем временный файл
            await fs.unlink(req.file.path);

            // Логируем действие
            await DatabaseService.query(
                'INSERT INTO admin_logs (admin_id, action, details) VALUES ($1, $2, $3)',
                [req.admin.id, 'import_antipublic', JSON.stringify({
                    filename: req.file.originalname,
                    total_lines: lines.length,
                    added: addedCount,
                    skipped: skippedCount
                })]
            );

            res.json({
                success: true,
                message: 'Антипаблик база обновлена',
                stats: {
                    total_lines: lines.length,
                    added: addedCount,
                    skipped: skippedCount
                }
            });

        } catch (error) {
            // Удаляем временный файл при ошибке
            try {
                await fs.unlink(req.file.path);
            } catch (unlinkError) {
                console.warn('Не удалось удалить временный файл:', unlinkError.message);
            }

            throw new AppError(`Ошибка обработки антипаблик файла: ${error.message}`, 400);
        }
    })
);

// GET /api/import/batches - История импортов
router.get('/batches', catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const batchesResult = await DatabaseService.query(`
        SELECT 
            ib.*,
            c.name as category_name,
            a.username as admin_username
        FROM import_batches ib
        JOIN categories c ON ib.category_id = c.id
        JOIN admins a ON ib.admin_id = a.id
        ORDER BY ib.created_at DESC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
        success: true,
        batches: batchesResult.rows,
        pagination: {
            current_page: page,
            per_page: limit
        }
    });
}));

// GET /api/import/batches/:id - Детали импорта
router.get('/batches/:id', catchAsync(async (req, res) => {
    const { id } = req.params;

    const batchResult = await DatabaseService.query(`
        SELECT 
            ib.*,
            c.name as category_name,
            a.username as admin_username
        FROM import_batches ib
        JOIN categories c ON ib.category_id = c.id
        JOIN admins a ON ib.admin_id = a.id
        WHERE ib.id = $1
    `, [id]);

    if (batchResult.rows.length === 0) {
        throw new AppError('Батч импорта не найден', 404);
    }

    const batch = batchResult.rows[0];

    // Получаем сайты из этого батча
    const sitesResult = await DatabaseService.query(`
        SELECT id, url, title, status, antipublic_status, upload_date
        FROM sites 
        WHERE import_batch_id = $1
        ORDER BY upload_date DESC
        LIMIT 100
    `, [id]);

    res.json({
        success: true,
        batch,
        sites: sitesResult.rows
    });
}));

module.exports = router;