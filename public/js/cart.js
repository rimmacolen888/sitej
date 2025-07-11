// Модуль корзины
class CartModule {
    constructor() {
        this.cartItems = [];
        this.isReserved = false;
        this.reservationExpires = null;
        this.totalAmount = 0;
    }

    async init() {
        this.bindEvents();
        await this.updateCartBadge();
    }

    bindEvents() {
        // Форма предложения цены
        const offerForm = document.getElementById('offer-form');
        if (offerForm) {
            offerForm.addEventListener('submit', (e) => this.handleOfferSubmit(e));
        }

        // Закрытие модальных окон
        document.addEventListener('click', (e) => {
            if (e.target.hasAttribute('data-close')) {
                const modalId = e.target.getAttribute('data-close');
                UI.hideModal(modalId);
            }
        });

        // Навигация к корзине
        const cartLink = document.querySelector('.cart-link');
        if (cartLink) {
            cartLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.showCart();
            });
        }
    }

    async showCart() {
        UI.hide('dashboard-section');
        UI.hide('site-details-section');
        UI.hide('profile-section');
        UI.show('cart-section');

        await this.loadCart();
    }

    async loadCart() {
        try {
            const response = await api.getCart();
            if (response.success) {
                this.cartItems = response.items;
                this.isReserved = response.is_reserved;
                this.reservationExpires = response.reservation_expires;
                this.totalAmount = response.total_amount;
                
                this.renderCart();
                this.updateCartBadge();
            }
        } catch (error) {
            console.error('Ошибка загрузки корзины:', error);
            UI.showError('Ошибка загрузки корзины');
        }
    }

    renderCart() {
        const cartContent = document.getElementById('cart-content');
        if (!cartContent) return;

        if (this.cartItems.length === 0) {
            this.renderEmptyCart();
            return;
        }

        let cartHtml = '<div class="cart-items">';

        this.cartItems.forEach(item => {
            cartHtml += this.createCartItemHtml(item);
        });

        cartHtml += '</div>';

        // Информация о резервации
        if (this.isReserved && this.reservationExpires) {
            const timeLeft = this.getTimeLeft(this.reservationExpires);
            cartHtml += `
                <div class="reservation-info">
                    ⏰ Корзина зарезервирована на ${timeLeft}
                </div>
            `;
        }

        // Итоговая информация
        cartHtml += `
            <div class="cart-summary">
                <div class="cart-total">
                    <span>Итого:</span>
                    <span>${UI.formatPrice(this.totalAmount)}</span>
                </div>
                
                <div class="cart-actions">
                    ${this.cartItems.length >= 2 && !this.isReserved ? 
                        '<button class="btn btn-warning" onclick="cartModule.reserveCart()">Зарезервировать товары</button>' 
                        : ''
                    }
                    
                    ${this.isReserved || this.cartItems.length === 1 ? 
                        '<button class="btn btn-success" onclick="cartModule.createOrder()">Оформить заказ</button>' 
                        : '<p class="reservation-note">Для заказа от 2 товаров требуется резервация</p>'
                    }
                    
                    <button class="btn btn-secondary" onclick="cartModule.clearCart()">Очистить корзину</button>
                </div>
            </div>
        `;

        cartContent.innerHTML = cartHtml;

        // Запускаем таймер обновления если есть резервация
        if (this.isReserved && this.reservationExpires) {
            this.startReservationTimer();
        }
    }

    createCartItemHtml(item) {
        const priceDisplay = item.price || item.fixed_price;
        const priceType = item.price_type === 'offer' ? 'По предложению' : 'Фиксированная цена';

        return `
            <div class="cart-item" data-site-id="${item.site_id}">
                <div class="cart-item-info">
                    <div class="cart-item-title">${UI.escapeHtml(item.title || 'Без названия')}</div>
                    <div class="cart-item-url">${UI.escapeHtml(item.url)}</div>
                    <div class="cart-item-category">${item.category_name}</div>
                    <div class="cart-item-type">${priceType}</div>
                    ${item.reserved_at ? '<div class="cart-item-reserved">🔒 Зарезервировано</div>' : ''}
                </div>
                
                <div class="cart-item-actions">
                    <div class="cart-item-price">${UI.formatPrice(priceDisplay)}</div>
                    ${!item.reserved_at ? 
                        `<button class="btn btn-danger btn-sm" onclick="cartModule.removeFromCart(${item.site_id})">
                            Удалить
                        </button>` 
                        : '<span class="reserved-text">Зарезервировано</span>'
                    }
                </div>
            </div>
        `;
    }

    renderEmptyCart() {
        const cartContent = document.getElementById('cart-content');
        if (cartContent) {
            cartContent.innerHTML = `
                <div class="empty-cart">
                    <h3>Корзина пуста</h3>
                    <p>Добавьте товары из каталога для оформления заказа</p>
                    <button class="btn btn-primary" onclick="catalogModule.showCatalog()">
                        Перейти к каталогу
                    </button>
                </div>
            `;
        }
    }

    async addToCart(siteId, priceType, price = null) {
        try {
            const response = await api.addToCart(siteId, priceType, price);
            if (response.success) {
                UI.showSuccess('Товар добавлен в корзину');
                await this.updateCartBadge();
                
                // Если мы находимся на странице корзины, обновляем её
                const cartSection = document.getElementById('cart-section');
                if (cartSection && !cartSection.classList.contains('hidden')) {
                    await this.loadCart();
                }
            }
        } catch (error) {
            console.error('Ошибка добавления в корзину:', error);
            UI.showError(error.message);
        }
    }

    async removeFromCart(siteId) {
        const confirmed = await UI.confirm('Удалить товар из корзины?');
        if (!confirmed) return;

        try {
            await api.removeFromCart(siteId);
            UI.showSuccess('Товар удален из корзины');
            await this.loadCart();
        } catch (error) {
            console.error('Ошибка удаления из корзины:', error);
            UI.showError(error.message);
        }
    }

    async reserveCart() {
        try {
            const response = await api.reserveCart();
            if (response.success) {
                UI.showSuccess('Корзина зарезервирована на 15 минут');
                await this.loadCart();
            }
        } catch (error) {
            console.error('Ошибка резервации корзины:', error);
            UI.showError(error.message);
        }
    }

    async clearCart() {
        const confirmed = await UI.confirm('Очистить всю корзину?');
        if (!confirmed) return;

        try {
            await api.clearCart();
            UI.showSuccess('Корзина очищена');
            await this.loadCart();
        } catch (error) {
            console.error('Ошибка очистки корзины:', error);
            UI.showError(error.message);
        }
    }

    async createOrder() {
        const confirmed = await UI.confirm('Оформить заказ на сумму ' + UI.formatPrice(this.totalAmount) + '?');
        if (!confirmed) return;

        try {
            const response = await api.createOrder();
            if (response.success) {
                UI.showSuccess(`Заказ #${response.order.id} успешно создан!`);
                
                // Очищаем корзину локально
                this.cartItems = [];
                this.totalAmount = 0;
                this.isReserved = false;
                
                await this.updateCartBadge();
                this.renderCart();
                
                // Показываем детали заказа
                setTimeout(() => {
                    if (window.profileModule) {
                        window.profileModule.showProfile();
                        window.profileModule.showTab('purchase-history');
                    }
                }, 2000);
            }
        } catch (error) {
            console.error('Ошибка создания заказа:', error);
            UI.showError(error.message);
            
            // Если пользователь заблокирован, обновляем статус
            if (error.message.includes('заблокирован')) {
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            }
        }
    }

    async updateCartBadge() {
        try {
            const response = await api.getCart();
            if (response.success) {
                const badge = document.getElementById('cart-badge');
                if (badge) {
                    badge.textContent = response.items.length;
                    badge.style.display = response.items.length > 0 ? 'flex' : 'none';
                }
            }
        } catch (error) {
            console.error('Ошибка обновления счетчика корзины:', error);
        }
    }

    async handleOfferSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const price = parseFloat(formData.get('price'));
        const siteId = parseInt(e.target.dataset.siteId);

        if (!price || price <= 0) {
            UI.showError('Введите корректную цену');
            return;
        }

        if (!siteId) {
            UI.showError('Ошибка: не указан сайт');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        UI.setLoading(submitBtn, true);

        try {
            let response;
            
            // Проверяем, есть ли уже предложение от пользователя
            const siteDetails = await api.getSiteDetails(siteId);
            
            if (siteDetails.user_offer && siteDetails.user_offer.status === 'active') {
                // Обновляем существующее предложение
                response = await api.updatePriceOffer(siteId, price);
            } else {
                // Создаем новое предложение
                response = await api.makePriceOffer(siteId, price);
            }

            if (response.success) {
                UI.showSuccess('Предложение цены отправлено!');
                UI.hideModal('offer-modal');
                
                // Обновляем информацию о сайте если мы на странице деталей
                const siteDetailsSection = document.getElementById('site-details-section');
                if (siteDetailsSection && !siteDetailsSection.classList.contains('hidden')) {
                    setTimeout(() => {
                        if (window.catalogModule) {
                            window.catalogModule.showSiteDetails(siteId);
                        }
                    }, 1000);
                }
                
                // Очищаем форму
                e.target.reset();
            }
        } catch (error) {
            console.error('Ошибка отправки предложения:', error);
            UI.showError(error.message);
        } finally {
            UI.setLoading(submitBtn, false);
        }
    }

    getTimeLeft(expiresAt) {
        const now = new Date();
        const expiry = new Date(expiresAt);
        const diff = expiry - now;

        if (diff <= 0) return 'Истекло';

        const minutes = Math.floor(diff / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    startReservationTimer() {
        // Очищаем предыдущий таймер
        if (this.reservationTimer) {
            clearInterval(this.reservationTimer);
        }

        this.reservationTimer = setInterval(() => {
            const timeLeft = this.getTimeLeft(this.reservationExpires);
            
            const reservationInfo = document.querySelector('.reservation-info');
            if (reservationInfo) {
                if (timeLeft === 'Истекло') {
                    clearInterval(this.reservationTimer);
                    UI.showWarning('Резервация истекла');
                    this.loadCart(); // Перезагружаем корзину
                } else {
                    reservationInfo.innerHTML = `⏰ Корзина зарезервирована на ${timeLeft}`;
                }
            }
        }, 1000);
    }

    async checkAvailability() {
        try {
            const response = await api.checkCartAvailability();
            if (response.success && response.removed_count > 0) {
                UI.showWarning(`${response.removed_count} товаров стали недоступны и удалены из корзины`);
                await this.loadCart();
            }
        } catch (error) {
            console.error('Ошибка проверки доступности:', error);
        }
    }

    // Очистка при выходе
    clearCart() {
        this.cartItems = [];
        this.totalAmount = 0;
        this.isReserved = false;
        this.reservationExpires = null;
        
        if (this.reservationTimer) {
            clearInterval(this.reservationTimer);
            this.reservationTimer = null;
        }
        
        this.updateCartBadge();
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    window.cartModule = new CartModule();
});