class API {
    constructor() {
        this.baseURL = '/api';
        this.token = localStorage.getItem('token');
    }

    setToken(token) {
        this.token = token;
        if (token) {
            localStorage.setItem('token', token);
        } else {
            localStorage.removeItem('token');
        }
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (this.token) {
            defaultOptions.headers['Authorization'] = `Bearer ${this.token}`;
        }

        const finalOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers,
            },
        };

        if (finalOptions.body && typeof finalOptions.body === 'object' && !(finalOptions.body instanceof FormData)) {
            finalOptions.body = JSON.stringify(finalOptions.body);
        }

        if (finalOptions.body instanceof FormData) {
            delete finalOptions.headers['Content-Type'];
        }

        try {
            const response = await fetch(url, finalOptions);
            
            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch {
                    errorData = { message: `HTTP ${response.status}: ${response.statusText}` };
                }
                throw new Error(errorData.message || 'Произошла ошибка');
            }

            const data = await response.json();
            return data;
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Ошибка сети. Проверьте подключение к интернету.');
            }
            throw error;
        }
    }

    async get(endpoint, params = {}) {
        const url = new URL(`${this.baseURL}${endpoint}`, window.location.origin);
        Object.keys(params).forEach(key => {
            if (params[key] !== null && params[key] !== undefined && params[key] !== '') {
                url.searchParams.append(key, params[key]);
            }
        });
        
        return this.request(url.pathname + url.search, {
            method: 'GET',
        });
    }

    async post(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: data,
        });
    }

    async put(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'PUT',
            body: data,
        });
    }

    async delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE',
        });
    }

    async checkInvite(code) {
        return this.post('/auth/check-invite', { code });
    }

    async register(username, password, inviteCode) {
        return this.post('/auth/register', {
            username,
            password,
            inviteCode
        });
    }

    async login(username, password) {
        return this.post('/auth/login', {
            username,
            password
        });
    }

    async adminLogin(username, password) {
        return this.post('/admin/auth/login', {
            username,
            password
        });
    }

    async getUserProfile() {
        return this.get('/user/profile');
    }

    async getProfile() {
        return this.getUserProfile();
    }

    async getCategories() {
        return this.get('/sites/categories');
    }

    async getSites(filters = {}) {
        return this.get('/sites', filters);
    }

    async getSiteDetails(siteId) {
        return this.get(`/sites/${siteId}`);
    }

    async makePriceOffer(siteId, price) {
        return this.post(`/sites/${siteId}/offer`, { price });
    }

    async updatePriceOffer(siteId, price) {
        return this.put(`/sites/${siteId}/offer`, { price });
    }

    async getSiteOffers(siteId) {
        return this.get(`/sites/${siteId}/offers`);
    }

    async getCart() {
        return this.get('/cart');
    }

    async addToCart(siteId, priceType, price = null) {
        const data = {
            site_id: siteId,
            price_type: priceType
        };
        
        if (price !== null) {
            data.price = price;
        }
        
        return this.post('/cart/add', data);
    }

    async removeFromCart(siteId) {
        return this.delete(`/cart/remove/${siteId}`);
    }

    async reserveCart() {
        return this.post('/cart/reserve');
    }

    async clearCart() {
        return this.delete('/cart/clear');
    }

    async checkCartAvailability() {
        return this.get('/cart/check-availability');
    }

    async createOrder(paymentMethod = null, notes = null) {
        const data = {};
        if (paymentMethod) data.payment_method = paymentMethod;
        if (notes) data.notes = notes;
        
        return this.post('/orders/create', data);
    }

    async getOrders(page = 1, limit = 10, status = null) {
        const params = { page, limit };
        if (status) params.status = status;
        
        return this.get('/orders', params);
    }

    async getOrder(orderId) {
        return this.get(`/orders/${orderId}`);
    }

    async getPurchaseHistory(page = 1, limit = 10) {
        return this.get('/user/purchase-history', { page, limit });
    }

    async getPurchaseHistoryByCategory(category) {
        return this.get(`/user/purchase-history/${category}`);
    }

    async getActiveOffers() {
        return this.get('/user/active-offers');
    }

    async getOrderStats() {
        return this.get('/orders/stats/summary');
    }

    async uploadFile(endpoint, file, additionalData = {}) {
        const formData = new FormData();
        formData.append('file', file);
        
        Object.keys(additionalData).forEach(key => {
            formData.append(key, additionalData[key]);
        });

        return this.request(endpoint, {
            method: 'POST',
            body: formData,
        });
    }

    async uploadSites(file, categoryId, autoApproveAntipublic = false) {
        return this.uploadFile('/import/sites', file, {
            category_id: categoryId,
            auto_approve_antipublic: autoApproveAntipublic
        });
    }

    async uploadAntipublic(file) {
        return this.uploadFile('/import/antipublic', file);
    }

    async getImportBatches(page = 1, limit = 20) {
        return this.get('/import/batches', { page, limit });
    }

    async getImportBatch(batchId) {
        return this.get(`/import/batches/${batchId}`);
    }

    async getAdminDashboard() {
        return this.get('/admin/dashboard');
    }

    async getAdminUsers(status = null, page = 1, limit = 20) {
        const params = { page, limit };
        if (status) params.status = status;
        
        return this.get('/admin/users', params);
    }

    async blockUser(userId, hours, reason) {
        return this.put(`/admin/users/${userId}/block`, { hours, reason });
    }

    async unblockUser(userId) {
        return this.put(`/admin/users/${userId}/unblock`);
    }

    async getAdminSites(category = null, status = null, page = 1, limit = 20) {
        const params = { page, limit };
        if (category) params.category = category;
        if (status) params.status = status;
        
        return this.get('/admin/sites', params);
    }

    async updateSite(siteId, data) {
        return this.put(`/admin/sites/${siteId}`, data);
    }

    async deleteSite(siteId) {
        return this.delete(`/admin/sites/${siteId}`);
    }

    async getAdminOrders(status = null, page = 1, limit = 20) {
        const params = { page, limit };
        if (status) params.status = status;
        
        return this.get('/admin/orders', params);
    }

    async updateOrderStatus(orderId, status) {
        return this.put(`/admin/orders/${orderId}/status`, { status });
    }

    async getInviteCodes(page = 1, limit = 20) {
        return this.get('/admin/invites', { page, limit });
    }

    async createInviteCode(code, expiresInDays, maxUses) {
        return this.post('/admin/invites', {
            code,
            expires_in_days: expiresInDays,
            max_uses: maxUses
        });
    }

    async deactivateInviteCode(inviteId) {
        return this.put(`/admin/invites/${inviteId}`);
    }
}

const api = new API();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
} else {
    window.api = api;
}