// Главный файл приложения - координирует работу всех модулей
class App {
    constructor() {
        this.isInitialized = false;
        this.modules = {};
    }

    async init() {
        if (this.isInitialized) return;

        console.log('Инициализация Site Marketplace...');

        // Показываем прелоадер
        this.showPreloader();

        try {
            // Инициализируем модули
            await this.initModules();

            // Настраиваем глобальные обработчики
            this.setupGlobalHandlers();

            // Скрываем прелоадер
            this.hidePreloader();

            // Устанавливаем флаг инициализации
            this.isInitialized = true;

            console.log('Site Marketplace инициализирован успешно');

        } catch (error) {
            console.error('Ошибка инициализации приложения:', error);
            this.showError('Ошибка загрузки приложения. Попробуйте перезагрузить страницу.');
        }
    }

    async initModules() {
        // Инициализируем модули в правильном порядке
        if (window.authModule) {
            this.modules.auth = window.authModule;
            await this.modules.auth.init();
        }

        if (window.cartModule) {
            this.modules.cart = window.cartModule;
            await this.modules.cart.init();
        }

        if (window.profileModule) {
            this.modules.profile = window.profileModule;
            await this.modules.profile.init();
        }

        // Каталог инициализируется после авторизации
        if (window.catalogModule) {
            this.modules.catalog = window.catalogModule;
            // Не инициализируем сразу, только после успешной авторизации
        }
    }

    setupGlobalHandlers() {
        // Обработка модальных окон
        this.setupModalHandlers();

        // Обработка навигации
        this.setupNavigationHandlers();

        // Обработка ошибок
        this.setupErrorHandlers();

        // Обработка горячих клавиш
        this.setupKeyboardHandlers();

        // Автоматическое обновление данных
        this.setupAutoRefresh();

        // Обработка изменения размера окна
        this.setupResponsiveHandlers();
    }

    setupModalHandlers() {
        // Закрытие модальных окон по клику на фон
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                const modalId = e.target.id;
                UI.hideModal(modalId);
            }
        });

        // Закрытие модальных окон по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal.show');
                if (openModal) {
                    UI.hideModal(openModal.id);
                }
            }
        });

        // Обработчики кнопок закрытия
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-close') || e.target.hasAttribute('data-close')) {
                const modalId = e.target.getAttribute('data-close') || e.target.closest('.modal').id;
                if (modalId) {
                    UI.hideModal(modalId);
                }
            }
        });
    }

    setupNavigationHandlers() {
        // Мобильное меню
        const navToggle = document.getElementById('nav-toggle');
        const navMenu = document.getElementById('nav-menu');

        if (navToggle && navMenu) {
            navToggle.addEventListener('click', () => {
                navMenu.classList.toggle('show');
            });

            // Закрытие меню при клике на ссылку
            navMenu.addEventListener('click', (e) => {
                if (e.target.classList.contains('nav-link')) {
                    navMenu.classList.remove('show');
                }
            });
        }

        // Обработка истории браузера
        window.addEventListener('popstate', (e) => {
            this.handlePopState(e);
        });

        // Перехват внутренних ссылок
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href^="#"]');
            if (link) {
                e.preventDefault();
                this.handleInternalNavigation(link.getAttribute('href'));
            }
        });
    }

    setupErrorHandlers() {
        // Глобальный обработчик ошибок JavaScript
        window.addEventListener('error', (e) => {
            console.error('Глобальная ошибка:', e.error);
            
            // В продакшене не показываем технические детали
            if (process.env.NODE_ENV === 'production') {
                UI.showError('Произошла ошибка. Попробуйте перезагрузить страницу.');
            } else {
                UI.showError('Ошибка: ' + e.error.message);
            }
        });

        // Обработчик необработанных промисов
        window.addEventListener('unhandledrejection', (e) => {
            console.error('Необработанный промис:', e.reason);
            UI.showError('Ошибка сети или сервера');
            e.preventDefault(); // Предотвращаем вывод в консоль
        });

        // Обработчик ошибок сети
        window.addEventListener('offline', () => {
            UI.showWarning('Соединение с интернетом потеряно');
        });

        window.addEventListener('online', () => {
            UI.showSuccess('Соединение восстановлено');
        });
    }

    setupKeyboardHandlers() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K - фокус на поиск
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                    searchInput.focus();
                }
            }

            // Escape - закрытие модальных окон или возврат к каталогу
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal.show');
                if (!openModal) {
                    // Если нет открытых модальных окон, возвращаемся к каталогу
                    if (this.modules.catalog) {
                        this.modules.catalog.showCatalog();
                    }
                }
            }

            // F5 или Ctrl+R - перезагрузка данных вместо страницы
            if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
                if (!e.shiftKey) { // Если не Shift+F5 (принудительная перезагрузка)
                    e.preventDefault();
                    this.refreshCurrentData();
                }
            }
        });
    }

    setupAutoRefresh() {
        // Автоматическое обновление счетчика корзины каждые 30 секунд
        setInterval(() => {
            if (this.modules.cart && this.isUserAuthenticated()) {
                this.modules.cart.updateCartBadge();
            }
        }, 30000);

        // Проверка активных предложений каждые 60 секунд
        setInterval(() => {
            if (this.isUserAuthenticated() && this.isOnProfilePage()) {
                this.modules.profile?.loadActiveOffers();
            }
        }, 60000);

        // Проверка доступности товаров в корзине каждые 2 минуты
        setInterval(() => {
            if (this.modules.cart && this.isUserAuthenticated()) {
                this.modules.cart.checkAvailability();
            }
        }, 120000);
    }

    setupResponsiveHandlers() {
        // Обработка изменения ориентации на мобильных устройствах
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.adjustMobileLayout();
            }, 100);
        });

        // Обработка изменения размера окна
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleResize();
            }, 250);
        });
    }

    handleInternalNavigation(href) {
        const section = href.substring(1); // Убираем #
        
        switch (section) {
            case 'catalog':
                if (this.modules.catalog) {
                    this.modules.catalog.showCatalog();
                }
                break;
            case 'cart':
                if (this.modules.cart) {
                    this.modules.cart.showCart();
                }
                break;
            case 'profile':
                if (this.modules.profile) {
                    this.modules.profile.showProfile();
                }
                break;
        }
    }

    handlePopState(e) {
        // Обработка кнопок "Назад"/"Вперед" браузера
        const path = window.location.pathname;
        const hash = window.location.hash;

        if (hash) {
            this.handleInternalNavigation(hash);
        }
    }

    async refreshCurrentData() {
        // Определяем текущую активную секцию и обновляем её данные
        const activeSection = document.querySelector('section:not(.hidden)');
        if (!activeSection) return;

        const sectionId = activeSection.id;

        try {
            switch (sectionId) {
                case 'dashboard-section':
                    if (this.modules.catalog) {
                        await this.modules.catalog.loadSites();
                    }
                    break;
                case 'cart-section':
                    if (this.modules.cart) {
                        await this.modules.cart.loadCart();
                    }
                    break;
                case 'profile-section':
                    if (this.modules.profile) {
                        await this.modules.profile.loadProfileData();
                    }
                    break;
            }
            UI.showSuccess('Данные обновлены');
        } catch (error) {
            console.error('Ошибка обновления данных:', error);
            UI.showError('Ошибка обновления данных');
        }
    }

    adjustMobileLayout() {
        // Настройка мобильного макета после изменения ориентации
        const viewportHeight = window.innerHeight;
        document.documentElement.style.setProperty('--vh', `${viewportHeight * 0.01}px`);
    }

    handleResize() {
        // Обработка изменения размера окна
        this.adjustMobileLayout();

        // Закрытие мобильного меню при увеличении экрана
        if (window.innerWidth > 768) {
            const navMenu = document.getElementById('nav-menu');
            if (navMenu) {
                navMenu.classList.remove('show');
            }
        }
    }

    isUserAuthenticated() {
        return !!localStorage.getItem('token');
    }

    isOnProfilePage() {
        const profileSection = document.getElementById('profile-section');
        return profileSection && !profileSection.classList.contains('hidden');
    }

    showPreloader() {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            preloader.style.display = 'flex';
        }
    }

    hidePreloader() {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            setTimeout(() => {
                preloader.style.display = 'none';
            }, 500); // Небольшая задержка для плавности
        }
    }

    showError(message) {
        // Показываем ошибку в центре экрана
        const errorDiv = document.createElement('div');
        errorDiv.className = 'global-error';
        errorDiv.innerHTML = `
            <div class="error-content">
                <h3>Ошибка</h3>
                <p>${message}</p>
                <button class="btn btn-primary" onclick="window.location.reload()">
                    Перезагрузить
                </button>
            </div>
        `;
        
        document.body.appendChild(errorDiv);

        // Стили для глобальной ошибки
        if (!document.querySelector('#global-error-styles')) {
            const style = document.createElement('style');
            style.id = 'global-error-styles';
            style.textContent = `
                .global-error {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.8);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                }
                .error-content {
                    background: white;
                    padding: 2rem;
                    border-radius: 8px;
                    text-align: center;
                    max-width: 400px;
                }
            `;
            document.head.appendChild(style);
        }
    }

    // Метод для получения информации о состоянии приложения
    getAppState() {
        return {
            isInitialized: this.isInitialized,
            isAuthenticated: this.isUserAuthenticated(),
            modules: Object.keys(this.modules),
            currentSection: document.querySelector('section:not(.hidden)')?.id || null
        };
    }
}

// Инициализация приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', function() {
    window.app = new App();
    window.app.init();
});

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
}