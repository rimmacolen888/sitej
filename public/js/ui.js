class UI {
    static showSuccess(message) {
        this.showNotification(message, 'success');
    }

    static showError(message) {
        this.showNotification(message, 'error');
    }

    static showWarning(message) {
        this.showNotification(message, 'warning');
    }

    static showInfo(message) {
        this.showNotification(message, 'info');
    }

    static showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        if (!notification) {
            const notif = document.createElement('div');
            notif.id = 'notification';
            notif.className = 'notification';
            document.body.appendChild(notif);
        }

        const notif = document.getElementById('notification');
        notif.textContent = message;
        notif.className = `notification ${type} show`;

        setTimeout(() => {
            notif.classList.remove('show');
        }, 5000);
    }

    static show(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.remove('hidden');
        }
    }

    static hide(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.add('hidden');
        }
    }

    static setLoading(button, isLoading) {
        if (!button) return;
        
        if (isLoading) {
            button.disabled = true;
            button.dataset.originalText = button.textContent;
            button.textContent = 'Загрузка...';
        } else {
            button.disabled = false;
            button.textContent = button.dataset.originalText || button.textContent;
        }
    }

    static showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
        }
    }

    static hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
        }
    }

    static async confirm(message) {
        return new Promise((resolve) => {
            const result = window.confirm(message);
            resolve(result);
        });
    }

    static formatPrice(price) {
        if (!price) return '0₽';
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 0
        }).format(price);
    }

    static formatDate(dateString, includeTime = false) {
        if (!dateString) return '';
        
        const date = new Date(dateString);
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };

        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }

        return date.toLocaleDateString('ru-RU', options);
    }

    static formatTimeLeft(expiresAt) {
        const now = new Date();
        const expiry = new Date(expiresAt);
        const diff = expiry - now;

        if (diff <= 0) return 'Истекло';

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}ч ${minutes}м`;
        } else {
            return `${minutes}м`;
        }
    }

    static escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UI;
} else {
    window.UI = UI;
}