// Модуль каталога сайтов
class CatalogModule {
    constructor() {
        this.currentFilters = {
            category: '',
            search: '',
            min_price: '',
            max_price: '',
            sort_by: 'upload_date',
            sort_order: 'desc',
            page: 1
        };
        this.categories = [];
        this.sites = [];
        this.isLoading = false;
    }

    async init() {
        await this.loadCategories();
        this.bindEvents();
        await this.loadSites();
        this.updateFiltersFromURL();
    }

    bindEvents() {
        // Фильтры
        const applyFiltersBtn = document.getElementById('apply-filters');
        if (applyFiltersBtn) {
            applyFiltersBtn.addEventListener('click', () => this.applyFilters());
        }

        const resetFiltersBtn = document.getElementById('reset-filters');
        if (resetFiltersBtn) {
            resetFiltersBtn.addEventListener('click', () => this.resetFilters());
        }

        // Поиск по Enter
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.applyFilters();
                }
            });
        }

        // Сортировка при изменении
        const sortSelect = document.getElementById('sort-by');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => this.applyFilters());
        }

        // Навигационные кнопки
        const backToCatalogBtn = document.getElementById('back-to-catalog');
        if (backToCatalogBtn) {
            backToCatalogBtn.addEventListener('click', () => this.showCatalog());
        }

        const backToCatalogFromCartBtn = document.getElementById('back-to-catalog-from-cart');
        if (backToCatalogFromCartBtn) {
            backToCatalogFromCartBtn.addEventListener('click', () => this.showCatalog());
        }

        // Навигационное меню
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => this.handleNavigation(e));
        });
    }

    async loadCategories() {
        try {
            const response = await api.getCategories();
            if (response.success) {
                this.categories = response.categories;
                this.renderCategoryFilter();
            }
        } catch (error) {
            console.error('Ошибка загрузки категорий:', error);
            UI.showError('Ошибка загрузки категорий');
        }
    }

    renderCategoryFilter() {
        const categoryFilter = document.getElementById('category-filter');
        if (!categoryFilter) return;

        categoryFilter.innerHTML = '<option value="">Все категории</option>';
        
        this.categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.name;
            option.textContent = `${category.name.toUpperCase()} (${category.available_count})`;
            categoryFilter.appendChild(option);
        });
    }

    async loadSites() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoadingState();

        try {
            const response = await api.getSites(this.currentFilters);
            if (response.success) {
                this.sites = response.sites;
                this.renderSites();
                this.renderPagination(response.pagination);
                this.updateStats(response.pagination);
            }
        } catch (error) {
            console.error('Ошибка загрузки сайтов:', error);
            UI.showError('Ошибка загрузки сайтов');
            this.renderEmptyState();
        } finally {
            this.isLoading = false;
            this.hideLoadingState();
        }
    }

    renderSites() {
        const sitesGrid = document.getElementById('sites-grid');
        if (!sitesGrid) return;

        if (this.sites.length === 0) {
            this.renderEmptyState();
            return;
        }

        sitesGrid.innerHTML = '';

        this.sites.forEach(site => {
            const siteCard = this.createSiteCard(site);
            sitesGrid.appendChild(siteCard);
        });
    }

    createSiteCard(site) {
        const card = document.createElement('div');
        card.className = 'site-card';
        card.addEventListener('click', () => this.showSiteDetails(site.id));

        const statusBadge = site.status !== 'available' ? 
            `<div class="status-badge status-${site.status}">${site.status}</div>` : '';

        const fixedPriceHtml = site.fixed_price ? 
            `<div class="fixed-price">${UI.formatPrice(site.fixed_price)}</div>` : '';

        const auctionHtml = site.highest_offer > 0 ? `
            <div class="auction-info">
                <div class="highest-offer">${UI.formatPrice(site.highest_offer)}</div>
                <div class="offers-count">${site.offers_count} предложений</div>
                ${site.auction_time_left > 0 ? 
                    `<div class="auction-timer">⏰ ${Math.round(site.auction_time_left)} мин</div>` : ''
                }
            </div>
        ` : '';

        card.innerHTML = `
            ${statusBadge}
            <div class="site-header">
                <div>
                    <div class="site-title">${UI.escapeHtml(site.title || 'Без названия')}</div>
                    <div class="site-url">${UI.escapeHtml(site.url)}</div>
                </div>
                <div class="site-category">${site.category_name}</div>
            </div>
            
            <div class="site-stats">
                <div class="stat-item">
                    <div class="stat-value">${site.visits || 0}</div>
                    <div class="stat-label">Визиты</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${site.country || 'N/A'}</div>
                    <div class="stat-label">Страна</div>
                </div>
            </div>

            <div class="site-pricing">
                ${fixedPriceHtml}
                ${auctionHtml}
            </div>

            <div class="site-actions">
                ${site.fixed_price ? 
                    '<button class="btn btn-success btn-sm" onclick="event.stopPropagation(); catalogModule.addToCart(' + site.id + ', \'fixed\')">Купить</button>' : ''
                }
                <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); catalogModule.showOfferModal(' + site.id + ')">Предложить цену</button>
            </div>
        `;

        return card;
    }

    async showSiteDetails(siteId) {
        UI.hide('dashboard-section');
        UI.show('site-details-section');

        try {
            const response = await api.getSiteDetails(siteId);
            if (response.success) {
                this.renderSiteDetails(response.site, response.offers, response.user_offer);
            }
        } catch (error) {
            console.error('Ошибка загрузки деталей сайта:', error);
            UI.showError('Ошибка загрузки информации о сайте');
            this.showCatalog();
        }
    }

    renderSiteDetails(site, offers, userOffer) {
        const siteDetails = document.getElementById('site-details');
        if (!siteDetails) return;

        const userOfferHtml = userOffer ? `
            <div class="user-offer-info">
                <h4>Ваше предложение</h4>
                <div class="offer-amount">${UI.formatPrice(userOffer.offered_price)}</div>
                <div class="offer-status">Статус: ${userOffer.status}</div>
                ${userOffer.expires_at ? 
                    `<div class="offer-expires">Истекает: ${UI.formatDate(userOffer.expires_at, true)}</div>` : ''
                }
            </div>
        ` : '';

        const offersHtml = offers.length > 0 ? `
            <div class="offers-section">
                <h4>Текущие предложения</h4>
                <div class="offers-list">
                    ${offers.map(offer => `
                        <div class="offer-item">
                            <span class="offer-price">${UI.formatPrice(offer.offered_price)}</span>
                            <span class="offer-time">${UI.formatDate(offer.created_at, true)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '<p>Предложений пока нет</p>';

        siteDetails.innerHTML = `
            <div class="site-detail-header">
                <h2>${UI.escapeHtml(site.title || 'Без названия')}</h2>
                <div class="site-category-badge">${site.category_name}</div>
            </div>

            <div class="site-detail-info">
                <div class="site-url"><strong>URL:</strong> <a href="${site.url}" target="_blank">${site.url}</a></div>
                <div class="site-visits"><strong>Посещаемость:</strong> ${site.visits || 'Не указана'}</div>
                <div class="site-country"><strong>Страна:</strong> ${site.country || 'Не указана'}</div>
                ${site.cms ? `<div class="site-cms"><strong>CMS:</strong> ${site.cms}</div>` : ''}
                ${site.description ? `<div class="site-description"><strong>Описание:</strong> ${UI.escapeHtml(site.description)}</div>` : ''}
            </div>

            <div class="site-pricing-detail">
                ${site.fixed_price ? `
                    <div class="fixed-price-section">
                        <h4>Фиксированная цена</h4>
                        <div class="price-amount">${UI.formatPrice(site.fixed_price)}</div>
                        <button class="btn btn-success" onclick="catalogModule.addToCart(${site.id}, 'fixed')">
                            Купить за фиксированную цену
                        </button>
                    </div>
                ` : ''}

                <div class="auction-section">
                    <h4>Аукцион</h4>
                    ${site.highest_offer > 0 ? 
                        `<div class="current-highest">Текущая максимальная ставка: ${UI.formatPrice(site.highest_offer)}</div>` :
                        '<div class="no-offers">Предложений пока нет</div>'
                    }
                    
                    ${userOfferHtml}
                    
                    <button class="btn btn-primary" onclick="catalogModule.showOfferModal(${site.id})">
                        ${userOffer ? 'Изменить предложение' : 'Сделать предложение'}
                    </button>
                </div>
            </div>

            ${offersHtml}
        `;
    }

    async addToCart(siteId, priceType, customPrice = null) {
        try {
            const data = {
                site_id: siteId,
                price_type: priceType
            };

            if (customPrice) {
                data.price = customPrice;
            }

            const response = await api.addToCart(siteId, priceType, customPrice);
            if (response.success) {
                UI.showSuccess('Товар добавлен в корзину');
                
                // Обновляем счетчик корзины
                if (window.cartModule) {
                    window.cartModule.updateCartBadge();
                }
            }
        } catch (error) {
            console.error('Ошибка добавления в корзину:', error);
            UI.showError(error.message);
        }
    }

    showOfferModal(siteId) {
        // Загружаем информацию о сайте для модального окна
        this.loadSiteForOffer(siteId);
        UI.showModal('offer-modal');
    }

    async loadSiteForOffer(siteId) {
        try {
            const response = await api.getSiteDetails(siteId);
            if (response.success) {
                this.renderOfferModal(response.site, response.offers, response.user_offer);
                
                // Сохраняем ID сайта для отправки предложения
                document.getElementById('offer-form').dataset.siteId = siteId;
            }
        } catch (error) {
            console.error('Ошибка загрузки информации для предложения:', error);
            UI.hideModal('offer-modal');
            UI.showError('Ошибка загрузки информации о сайте');
        }
    }

    renderOfferModal(site, offers, userOffer) {
        const offerInfo = document.getElementById('offer-info');
        if (!offerInfo) return;

        const currentHighest = offers.length > 0 ? Math.max(...offers.map(o => o.offered_price)) : 0;
        const minBid = Math.max(currentHighest + 1, site.fixed_price ? site.fixed_price * 0.1 : 100);

        offerInfo.innerHTML = `
            <div class="offer-site-info">
                <h4>${UI.escapeHtml(site.title || site.url)}</h4>
                <div class="site-stats-inline">
                    <span>Посещаемость: ${site.visits || 'N/A'}</span>
                    <span>Страна: ${site.country || 'N/A'}</span>
                </div>
            </div>

            <div class="current-offers">
                ${currentHighest > 0 ? 
                    `<div class="current-max">Текущий максимум: ${UI.formatPrice(currentHighest)}</div>` :
                    '<div class="no-offers">Предложений пока нет</div>'
                }
                ${offers.length > 0 ? `<div class="offers-count">${offers.length} предложений</div>` : ''}
            </div>

            ${userOffer ? `
                <div class="user-current-offer">
                    <strong>Ваше текущее предложение: ${UI.formatPrice(userOffer.offered_price)}</strong>
                </div>
            ` : ''}
        `;

        // Устанавливаем минимальную ставку
        const priceInput = document.getElementById('offer-price');
        if (priceInput) {
            priceInput.min = minBid;
            priceInput.placeholder = `Минимум: ${UI.formatPrice(minBid)}`;
        }
    }

    applyFilters() {
        // Собираем данные из фильтров
        this.currentFilters = {
            category: document.getElementById('category-filter')?.value || '',
            search: document.getElementById('search-input')?.value || '',
            min_price: document.getElementById('min-price')?.value || '',
            max_price: document.getElementById('max-price')?.value || '',
            sort_by: document.getElementById('sort-by')?.value || 'upload_date',
            page: 1 // Сбрасываем на первую страницу
        };

        // Определяем порядок сортировки
        const [sortField, sortOrder] = this.currentFilters.sort_by.split(':');
        this.currentFilters.sort_by = sortField;
        this.currentFilters.sort_order = sortOrder || 'desc';

        this.loadSites();
        this.updateURL();
    }

    resetFilters() {
        // Очищаем все фильтры
        const categoryFilter = document.getElementById('category-filter');
        const searchInput = document.getElementById('search-input');
        const minPriceInput = document.getElementById('min-price');
        const maxPriceInput = document.getElementById('max-price');
        const sortSelect = document.getElementById('sort-by');

        if (categoryFilter) categoryFilter.value = '';
        if (searchInput) searchInput.value = '';
        if (minPriceInput) minPriceInput.value = '';
        if (maxPriceInput) maxPriceInput.value = '';
        if (sortSelect) sortSelect.value = 'upload_date:desc';

        this.currentFilters = {
            category: '',
            search: '',
            min_price: '',
            max_price: '',
            sort_by: 'upload_date',
            sort_order: 'desc',
            page: 1
        };

        this.loadSites();
        this.updateURL();
    }

    renderPagination(pagination) {
        const paginationEl = document.getElementById('pagination');
        if (!paginationEl) return;

        if (pagination.total_pages <= 1) {
            paginationEl.innerHTML = '';
            return;
        }

        let paginationHtml = '';

        // Кнопка "Предыдущая"
        if (pagination.current_page > 1) {
            paginationHtml += `
                <button class="pagination-btn" onclick="catalogModule.goToPage(${pagination.current_page - 1})">
                    ← Назад
                </button>
            `;
        }

        // Номера страниц
        const startPage = Math.max(1, pagination.current_page - 2);
        const endPage = Math.min(pagination.total_pages, pagination.current_page + 2);

        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `
                <button class="pagination-btn ${i === pagination.current_page ? 'active' : ''}" 
                        onclick="catalogModule.goToPage(${i})">
                    ${i}
                </button>
            `;
        }

        // Кнопка "Следующая"
        if (pagination.current_page < pagination.total_pages) {
            paginationHtml += `
                <button class="pagination-btn" onclick="catalogModule.goToPage(${pagination.current_page + 1})">
                    Вперед →
                </button>
            `;
        }

        paginationEl.innerHTML = paginationHtml;
    }

    goToPage(page) {
        this.currentFilters.page = page;
        this.loadSites();
        this.updateURL();
    }

    updateStats(pagination) {
        const statsEl = document.getElementById('catalog-stats');
        if (statsEl) {
            statsEl.textContent = `Показано ${pagination.total_sites} сайтов`;
        }
    }

    showCatalog() {
        UI.hide('site-details-section');
        UI.hide('cart-section');
        UI.hide('profile-section');
        UI.show('dashboard-section');
    }

    handleNavigation(e) {
        e.preventDefault();
        const href = e.target.getAttribute('href');
        
        if (href === '#catalog') {
            this.showCatalog();
        } else if (href === '#cart') {
            if (window.cartModule) {
                window.cartModule.showCart();
            }
        } else if (href === '#profile') {
            if (window.profileModule) {
                window.profileModule.showProfile();
            }
        }
    }

    showLoadingState() {
        const sitesGrid = document.getElementById('sites-grid');
        if (sitesGrid) {
            sitesGrid.innerHTML = '<div class="loading-state">Загрузка сайтов...</div>';
        }
    }

    hideLoadingState() {
        // Состояние загрузки будет заменено результатами
    }

    renderEmptyState() {
        const sitesGrid = document.getElementById('sites-grid');
        if (sitesGrid) {
            sitesGrid.innerHTML = `
                <div class="empty-state">
                    <h3>Сайты не найдены</h3>
                    <p>Попробуйте изменить параметры поиска или фильтры</p>
                    <button class="btn btn-secondary" onclick="catalogModule.resetFilters()">
                        Сбросить фильтры
                    </button>
                </div>
            `;
        }
    }

    updateURL() {
        const params = new URLSearchParams();
        Object.keys(this.currentFilters).forEach(key => {
            if (this.currentFilters[key]) {
                params.set(key, this.currentFilters[key]);
            }
        });

        const newURL = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, '', newURL);
    }

    updateFiltersFromURL() {
        const params = new URLSearchParams(window.location.search);
        
        params.forEach((value, key) => {
            if (this.currentFilters.hasOwnProperty(key)) {
                this.currentFilters[key] = value;
                
                // Обновляем элементы формы
                const element = document.getElementById(key.replace('_', '-'));
                if (element) {
                    element.value = value;
                }
            }
        });
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    window.catalogModule = new CatalogModule();
});