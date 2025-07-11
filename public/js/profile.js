// Модуль профиля пользователя
class ProfileModule {
    constructor() {
        this.currentTab = 'profile-info';
        this.userData = null;
        this.purchaseHistory = [];
        this.activeOffers = [];
    }

    async init() {
        this.bindEvents();
    }

    bindEvents() {
        // Табы профиля
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.target.getAttribute('data-tab');
                this.showTab(tabId);
            });
        });

        // Навигация к профилю
        const profileLink = document.querySelector('a[href="#profile"]');
        if (profileLink) {
            profileLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showProfile();
            });
        }
    }

    async showProfile() {
        UI.hide('dashboard-section');
        UI.hide('site-details-section');
        UI.hide('cart-section');
        UI.show('profile-section');

        await this.loadProfileData();
        this.showTab(this.currentTab);
    }

    async loadProfileData() {
        try {
            const response = await api.getUserProfile();
            if (response.success) {
                this.userData = response.user;
                this.renderProfileInfo();
            }
        } catch (error) {
            console.error('Ошибка загрузки профиля:', error);
            UI.showError('Ошибка загрузки профиля');
        }
    }

    showTab(tabId) {
        // Убираем активный класс со всех табов
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        // Активируем нужный таб
        const activeBtn = document.querySelector(`[data-tab="${tabId}"]`);
        const activeContent = document.getElementById(tabId);

        if (activeBtn) activeBtn.classList.add('active');
        if (activeContent) activeContent.classList.add('active');

        this.currentTab = tabId;

        // Загружаем данные для соответствующего таба
        switch (tabId) {
            case 'profile-info':
                this.renderProfileInfo();
                break;
            case 'purchase-history':
                this.loadPurchaseHistory();
                break;
            case 'active-offers':
                this.loadActiveOffers();
                break;
            case 'purchase-categories':
                this.loadPurchaseCategories();
                break;
        }
    }

    renderProfileInfo() {
        const profileInfoTab = document.getElementById('profile-info');
        if (!profileInfoTab || !this.userData) return;

        const stats = this.userData.stats || {
            total_orders: 0,
            total_spent: 0,
            active_offers: 0,
            cart_items: 0
        };

        // Определяем статус доступа
        const accessExpires = new Date(this.userData.access_expires_at);
        const now = new Date();
        const daysLeft = Math.ceil((accessExpires - now) / (1000 * 60 * 60 * 24));
        
        let accessStatus = '';
        if (this.userData.is_blocked) {
            accessStatus = `<div class="status-blocked">🚫 Заблокирован до ${UI.formatDate(this.userData.blocked_until, true)}</div>`;
        } else if (daysLeft <= 0) {
            accessStatus = '<div class="status-expired">⏰ Доступ истек</div>';
        } else if (daysLeft <= 3) {
            accessStatus = `<div class="status-warning">⚠️ Доступ истекает через ${daysLeft} дн.</div>`;
        } else {
            accessStatus = `<div class="status-active">✅ Доступ активен (${daysLeft} дн.)</div>`;
        }

        profileInfoTab.innerHTML = `
            <div class="profile-info">
                <h3>Информация о профиле</h3>
                
                <div class="profile-details">
                    <div class="profile-item">
                        <strong>Имя пользователя:</strong> ${this.userData.username}
                    </div>
                    <div class="profile-item">
                        <strong>Дата регистрации:</strong> ${UI.formatDate(this.userData.created_at)}
                    </div>
                    <div class="profile-item">
                        <strong>Последний вход:</strong> ${this.userData.last_login ? UI.formatDate(this.userData.last_login, true) : 'Никогда'}
                    </div>
                    <div class="profile-item">
                        <strong>Инвайт-код:</strong> ${this.userData.invite_code_used}
                    </div>
                    <div class="profile-item">
                        <strong>Статус доступа:</strong> ${accessStatus}
                    </div>
                </div>
            </div>

            <div class="profile-stats">
                <div class="stat-card">
                    <div class="stat-card-value">${stats.total_orders}</div>
                    <div class="stat-card-label">Заказов</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-value">${UI.formatPrice(stats.total_spent).replace('₽', '')}</div>
                    <div class="stat-card-label">Потрачено ₽</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-value">${stats.active_offers}</div>
                    <div class="stat-card-label">Активных предложений</div>
                </div>
                <div class="stat-card">
                    <div class="stat-card-value">${stats.cart_items}</div>
                    <div class="stat-card-label">В корзине</div>
                </div>
            </div>
        `;
    }

    async loadPurchaseHistory(page = 1) {
        try {
            const response = await api.getPurchaseHistory(page, 10);
            if (response.success) {
                this.purchaseHistory = response.orders;
                this.renderPurchaseHistory(response.pagination);
            }
        } catch (error) {
            console.error('Ошибка загрузки истории покупок:', error);
            UI.showError('Ошибка загрузки истории покупок');
        }
    }

    renderPurchaseHistory(pagination) {
        const historyTab = document.getElementById('purchase-history');
        if (!historyTab) return;

        if (this.purchaseHistory.length === 0) {
            historyTab.innerHTML = `
                <div class="empty-state">
                    <h3>История покупок пуста</h3>
                    <p>Вы еще не совершали покупок</p>
                    <button class="btn btn-primary" onclick="catalogModule.showCatalog()">
                        Перейти к каталогу
                    </button>
                </div>
            `;
            return;
        }

        let historyHtml = '<div class="purchase-history">';
        
        this.purchaseHistory.forEach(order => {
            const statusClass = order.status === 'confirmed' ? 'success' : 
                               order.status === 'cancelled' ? 'danger' : 'warning';
            
            historyHtml += `
                <div class="order-card">
                    <div class="order-header">
                        <div class="order-info">
                            <h4>Заказ #${order.id}</h4>
                            <div class="order-date">${UI.formatDate(order.created_at, true)}</div>
                        </div>
                        <div class="order-status">
                            <span class="status-badge status-${statusClass}">${this.getStatusText(order.status)}</span>
                            <div class="order-amount">${UI.formatPrice(order.total_amount)}</div>
                        </div>
                    </div>
                    
                    <div class="order-items">
                        ${order.items.map(item => `
                            <div class="order-item">
                                <div class="item-info">
                                    <div class="item-title">${UI.escapeHtml(item.title || 'Без названия')}</div>
                                    <div class="item-url">${UI.escapeHtml(item.url)}</div>
                                    <div class="item-category">${item.category} • ${item.price_type === 'offer' ? 'По предложению' : 'Фиксированная цена'}</div>
                                </div>
                                <div class="item-price">${UI.formatPrice(item.price)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        historyHtml += '</div>';

        // Добавляем пагинацию если нужно
        if (pagination && pagination.total_pages > 1) {
            historyHtml += this.renderHistoryPagination(pagination);
        }

        historyTab.innerHTML = historyHtml;
    }

    renderHistoryPagination(pagination) {
        let paginationHtml = '<div class="history-pagination">';

        if (pagination.current_page > 1) {
            paginationHtml += `
                <button class="btn btn-secondary btn-sm" onclick="profileModule.loadPurchaseHistory(${pagination.current_page - 1})">
                    ← Назад
                </button>
            `;
        }

        paginationHtml += `<span>Страница ${pagination.current_page} из ${pagination.total_pages}</span>`;

        if (pagination.current_page < pagination.total_pages) {
            paginationHtml += `
                <button class="btn btn-secondary btn-sm" onclick="profileModule.loadPurchaseHistory(${pagination.current_page + 1})">
                    Вперед →
                </button>
            `;
        }

        paginationHtml += '</div>';
        return paginationHtml;
    }

    async loadActiveOffers() {
        try {
            const response = await api.getActiveOffers();
            if (response.success) {
                this.activeOffers = response.offers;
                this.renderActiveOffers();
            }
        } catch (error) {
            console.error('Ошибка загрузки активных предложений:', error);
            UI.showError('Ошибка загрузки активных предложений');
        }
    }

    renderActiveOffers() {
        const offersTab = document.getElementById('active-offers');
        if (!offersTab) return;

        if (this.activeOffers.length === 0) {
            offersTab.innerHTML = `
                <div class="empty-state">
                    <h3>Нет активных предложений</h3>
                    <p>У вас нет активных предложений цен</p>
                    <button class="btn btn-primary" onclick="catalogModule.showCatalog()">
                        Найти сайты для предложения
                    </button>
                </div>
            `;
            return;
        }

        let offersHtml = '<div class="active-offers">';
        
        this.activeOffers.forEach(offer => {
            const timeLeft = offer.expires_at ? UI.formatTimeLeft(offer.expires_at) : '';
            const isWinning = offer.status === 'winning';
            const isHighest = offer.offered_price >= offer.highest_offer;

            offersHtml += `
                <div class="offer-card ${isWinning ? 'winning' : ''}">
                    <div class="offer-header">
                        <div class="offer-site">
                            <h4>${UI.escapeHtml(offer.title || 'Без названия')}</h4>
                            <div class="offer-url">${UI.escapeHtml(offer.url)}</div>
                            <div class="offer-category">${offer.category_name}</div>
                        </div>
                        <div class="offer-status">
                            ${isWinning ? 
                                '<span class="status-badge status-success">🏆 Выигрываете</span>' :
                                isHighest ? 
                                    '<span class="status-badge status-warning">📈 Лидируете</span>' :
                                    '<span class="status-badge status-info">📊 Участвуете</span>'
                            }
                        </div>
                    </div>
                    
                    <div class="offer-details">
                        <div class="offer-prices">
                            <div class="your-offer">
                                <span class="label">Ваше предложение:</span>
                                <span class="price">${UI.formatPrice(offer.offered_price)}</span>
                            </div>
                            <div class="current-max">
                                <span class="label">Текущий максимум:</span>
                                <span class="price">${UI.formatPrice(offer.highest_offer)}</span>
                            </div>
                            ${offer.fixed_price ? `
                                <div class="fixed-price">
                                    <span class="label">Фиксированная цена:</span>
                                    <span class="price">${UI.formatPrice(offer.fixed_price)}</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="offer-timing">
                            ${timeLeft && !isWinning ? 
                                `<div class="time-left">⏰ ${timeLeft}</div>` : ''
                            }
                            ${isWinning ? 
                                '<div class="winning-notice">🎉 У вас есть 15 минут на покупку!</div>' : ''
                            }
                        </div>
                    </div>
                    
                    <div class="offer-actions">
                        <button class="btn btn-primary btn-sm" onclick="catalogModule.showSiteDetails(${offer.site_id})">
                            Посмотреть сайт
                        </button>
                        ${!isWinning ? 
                            `<button class="btn btn-secondary btn-sm" onclick="catalogModule.showOfferModal(${offer.site_id})">
                                Повысить ставку
                            </button>` : ''
                        }
                    </div>
                </div>
            `;
        });

        offersHtml += '</div>';
        offersTab.innerHTML = offersHtml;
    }

    async loadPurchaseCategories() {
        const categoriesTab = document.getElementById('purchase-categories');
        if (!categoriesTab) return;

        categoriesTab.innerHTML = `
            <div class="category-purchases">
                <div class="category-section">
                    <h4>Интернет-магазины</h4>
                    <button class="btn btn-secondary" onclick="profileModule.loadCategoryHistory('shop')">
                        Показать историю SHOP
                    </button>
                </div>
                
                <div class="category-section">
                    <h4>Админ-панели</h4>
                    <button class="btn btn-secondary" onclick="profileModule.loadCategoryHistory('adminki')">
                        Показать историю ADMINKI
                    </button>
                </div>
                
                <div class="category-section">
                    <h4>Авторские сайты</h4>
                    <button class="btn btn-secondary" onclick="profileModule.loadCategoryHistory('autors')">
                        Показать историю AUTORS
                    </button>
                </div>
                
                <div class="category-section">
                    <h4>SEO домены</h4>
                    <button class="btn btn-secondary" onclick="profileModule.loadCategoryHistory('ceo')">
                        Показать историю CEO
                    </button>
                </div>
                
                <div class="category-section">
                    <h4>Купленные по предложенной цене</h4>
                    <button class="btn btn-secondary" onclick="profileModule.loadCategoryHistory('offer')">
                        Показать историю предложений
                    </button>
                </div>
            </div>
            
            <div id="category-history-content"></div>
        `;
    }

    async loadCategoryHistory(category) {
        try {
            const response = await api.getPurchaseHistoryByCategory(category);
            if (response.success) {
                this.renderCategoryHistory(response.orders, category);
            }
        } catch (error) {
            console.error('Ошибка загрузки истории категории:', error);
            UI.showError('Ошибка загрузки истории категории');
        }
    }

    renderCategoryHistory(orders, category) {
        const contentEl = document.getElementById('category-history-content');
        if (!contentEl) return;

        const categoryNames = {
            shop: 'Интернет-магазины',
            adminki: 'Админ-панели', 
            autors: 'Авторские сайты',
            ceo: 'SEO домены',
            offer: 'По предложенной цене'
        };

        if (orders.length === 0) {
            contentEl.innerHTML = `
                <div class="empty-state">
                    <h3>Нет покупок в категории "${categoryNames[category]}"</h3>
                </div>
            `;
            return;
        }

        let historyHtml = `<h3>История покупок: ${categoryNames[category]}</h3>`;
        historyHtml += '<div class="category-history">';

        orders.forEach(order => {
            historyHtml += `
                <div class="order-card">
                    <div class="order-header">
                        <div>Заказ #${order.id}</div>
                        <div>${UI.formatDate(order.created_at, true)}</div>
                        <div>${UI.formatPrice(order.total_amount)}</div>
                    </div>
                    <div class="order-items">
                        ${order.items.map(item => `
                            <div class="order-item">
                                <div>${UI.escapeHtml(item.title || item.url)}</div>
                                <div>${UI.formatPrice(item.price)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        historyHtml += '</div>';
        contentEl.innerHTML = historyHtml;
    }

    getStatusText(status) {
        const statusTexts = {
            'pending': 'Ожидает',
            'confirmed': 'Подтвержден',
            'cancelled': 'Отменен'
        };
        return statusTexts[status] || status;
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    window.profileModule = new ProfileModule();
});