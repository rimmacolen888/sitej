// Модуль авторизации
class AuthModule {
    constructor() {
        this.currentStep = 'invite'; // invite, register, login
        this.validatedInviteCode = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuthStatus();
    }

    bindEvents() {
        // Форма проверки инвайт-кода
        const inviteForm = document.getElementById('invite-form');
        if (inviteForm) {
            inviteForm.addEventListener('submit', (e) => this.handleInviteSubmit(e));
        }

        // Форма регистрации
        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => this.handleRegisterSubmit(e));
        }

        // Форма входа
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLoginSubmit(e));
        }

        // Кнопки переключения форм
        const backToInviteBtn = document.getElementById('back-to-invite');
        if (backToInviteBtn) {
            backToInviteBtn.addEventListener('click', () => this.showInviteForm());
        }

        const showRegisterBtn = document.getElementById('show-register');
        if (showRegisterBtn) {
            showRegisterBtn.addEventListener('click', () => this.showRegisterForm());
        }

        // Кнопка выхода
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
    }

    async checkAuthStatus() {
        const token = localStorage.getItem('token');
        if (!token) {
            this.showAuthSection();
            return;
        }

        try {
            const response = await api.getProfile();
            if (response.success) {
                this.showDashboard(response.user);
            } else {
                this.showAuthSection();
            }
        } catch (error) {
            console.error('Ошибка проверки авторизации:', error);
            this.showAuthSection();
        }
    }

    async handleInviteSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const inviteCode = formData.get('inviteCode');

        if (!inviteCode || inviteCode.length < 3) {
            this.showMessage('Введите корректный инвайт-код', 'error');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        UI.setLoading(submitBtn, true);

        try {
            const response = await api.checkInvite(inviteCode);
            
            if (response.success) {
                this.validatedInviteCode = inviteCode;
                this.showMessage('Инвайт-код действителен! Теперь можете зарегистрироваться.', 'success');
                
                // Проверяем, есть ли уже пользователь с таким кодом
                setTimeout(() => {
                    this.showRegisterForm();
                }, 1000);
            }
        } catch (error) {
            this.showMessage(error.message, 'error');
        } finally {
            UI.setLoading(submitBtn, false);
        }
    }

    async handleRegisterSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const username = formData.get('username');
        const password = formData.get('password');
        const passwordConfirm = formData.get('passwordConfirm');

        // Валидация
        if (!this.validateRegistrationData(username, password, passwordConfirm)) {
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        UI.setLoading(submitBtn, true);

        try {
            const response = await api.register(username, password, this.validatedInviteCode);
            
            if (response.success) {
                // Сохраняем токен
                api.setToken(response.token);
                
                this.showMessage('Регистрация успешна! Добро пожаловать!', 'success');
                
                setTimeout(() => {
                    this.showDashboard(response.user);
                }, 1000);
            }
        } catch (error) {
            this.showMessage(error.message, 'error');
        } finally {
            UI.setLoading(submitBtn, false);
        }
    }

    async handleLoginSubmit(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const username = formData.get('username');
        const password = formData.get('password');

        if (!username || !password) {
            this.showMessage('Заполните все поля', 'error');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        UI.setLoading(submitBtn, true);

        try {
            const response = await api.login(username, password);
            
            if (response.success) {
                // Сохраняем токен
                api.setToken(response.token);
                
                this.showMessage('Вход выполнен успешно!', 'success');
                
                setTimeout(() => {
                    this.showDashboard(response.user);
                }, 1000);
            }
        } catch (error) {
            this.showMessage(error.message, 'error');
            
            // Если нужна регистрация, показываем форму регистрации
            if (error.message.includes('не найден')) {
                setTimeout(() => {
                    this.showMessage('Пользователь не найден. Попробуйте зарегистрироваться.', 'info');
                    this.showRegisterForm();
                }, 2000);
            }
        } finally {
            UI.setLoading(submitBtn, false);
        }
    }

    validateRegistrationData(username, password, passwordConfirm) {
        if (!username || username.length < 3) {
            this.showMessage('Имя пользователя должно быть минимум 3 символа', 'error');
            return false;
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            this.showMessage('Имя пользователя может содержать только буквы, цифры, _ и -', 'error');
            return false;
        }

        if (!password || password.length < 6) {
            this.showMessage('Пароль должен быть минимум 6 символов', 'error');
            return false;
        }

        if (password !== passwordConfirm) {
            this.showMessage('Пароли не совпадают', 'error');
            return false;
        }

        return true;
    }

    showInviteForm() {
        this.currentStep = 'invite';
        this.hideAllForms();
        UI.show('invite-form');
        this.clearMessage();
    }

    showRegisterForm() {
        this.currentStep = 'register';
        this.hideAllForms();
        UI.show('register-form');
        this.clearMessage();
        
        // Показываем кнопку "У меня есть аккаунт"
        this.addLoginLink();
    }

    showLoginForm() {
        this.currentStep = 'login';
        this.hideAllForms();
        UI.show('login-form');
        this.clearMessage();
    }

    hideAllForms() {
        UI.hide('invite-form');
        UI.hide('register-form');
        UI.hide('login-form');
    }

    addLoginLink() {
        const registerForm = document.getElementById('register-form');
        let loginLink = registerForm.querySelector('.login-link');
        
        if (!loginLink) {
            loginLink = document.createElement('button');
            loginLink.className = 'btn btn-link login-link';
            loginLink.textContent = 'У меня уже есть аккаунт';
            loginLink.addEventListener('click', () => this.showLoginForm());
            registerForm.appendChild(loginLink);
        }
    }

    showAuthSection() {
        UI.hide('dashboard-section');
        UI.hide('site-details-section');
        UI.hide('cart-section');
        UI.hide('profile-section');
        UI.show('auth-section');
        
        // Скрываем навигацию
        const navbar = document.getElementById('navbar');
        if (navbar) {
            navbar.style.display = 'none';
        }
    }

    showDashboard(user) {
        UI.hide('auth-section');
        UI.show('dashboard-section');
        
        // Показываем навигацию
        const navbar = document.getElementById('navbar');
        if (navbar) {
            navbar.style.display = 'block';
        }

        // Обновляем интерфейс пользователя
        this.updateUserInterface(user);
        
        // Инициализируем каталог
        if (window.catalogModule) {
            window.catalogModule.init();
        }
        
        // Обновляем корзину
        if (window.cartModule) {
            window.cartModule.updateCartBadge();
        }
    }

    updateUserInterface(user) {
        // Можно добавить информацию о пользователе в интерфейс
        const userInfo = document.querySelector('.user-info');
        if (userInfo) {
            userInfo.textContent = `Добро пожаловать, ${user.username}!`;
        }

        // Проверяем статус блокировки
        this.checkUserStatus();
    }

    async checkUserStatus() {
        try {
            const response = await api.get('/user/blocked-status');
            if (response.is_blocked) {
                UI.showWarning(`Ваш аккаунт заблокирован до ${UI.formatDate(response.blocked_until, true)}`);
            }
        } catch (error) {
            console.error('Ошибка проверки статуса пользователя:', error);
        }
    }

    logout() {
        api.setToken(null);
        this.validatedInviteCode = null;
        this.currentStep = 'invite';
        
        // Очищаем все данные
        if (window.cartModule) {
            window.cartModule.clearCart();
        }
        
        this.showAuthSection();
        this.showInviteForm();
        
        UI.showSuccess('Вы успешно вышли из системы');
    }

    showMessage(message, type = 'info') {
        const messageEl = document.getElementById('auth-message');
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.className = `auth-message ${type}`;
            messageEl.style.display = 'block';
        }
    }

    clearMessage() {
        const messageEl = document.getElementById('auth-message');
        if (messageEl) {
            messageEl.style.display = 'none';
            messageEl.textContent = '';
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    window.authModule = new AuthModule();
});