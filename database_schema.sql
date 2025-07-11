CREATE DATABASE site_marketplace;

\c site_marketplace;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO categories (name, description) VALUES 
('shop', 'Интернет-магазины'),
('adminki', 'Админ-панели'),
('autors', 'Авторские сайты'),
('ceo', 'Домены под SEO');

CREATE TABLE invite_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT true,
    max_uses INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    invite_code_used VARCHAR(50) REFERENCES invite_codes(code),
    access_expires_at TIMESTAMP NOT NULL,
    is_blocked BOOLEAN DEFAULT false,
    blocked_until TIMESTAMP NULL,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    invite_code VARCHAR(50),
    ip_address INET,
    country VARCHAR(100),
    user_agent TEXT,
    action VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sites (
    id SERIAL PRIMARY KEY,
    category_id INTEGER REFERENCES categories(id),
    url VARCHAR(500) NOT NULL,
    visits INTEGER,
    country VARCHAR(100),
    fixed_price DECIMAL(10,2),
    title VARCHAR(255),
    description TEXT,
    cms VARCHAR(100),
    domain VARCHAR(255),
    tags TEXT[],
    status VARCHAR(20) DEFAULT 'available',
    antipublic_status VARCHAR(20) DEFAULT 'clean',
    antipublic_details TEXT,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sold_at TIMESTAMP,
    sold_to INTEGER REFERENCES users(id),
    import_batch_id UUID,
    additional_fields JSONB
);

CREATE TABLE price_offers (
    id SERIAL PRIMARY KEY,
    site_id INTEGER REFERENCES sites(id),
    user_id INTEGER REFERENCES users(id),
    offered_price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    expires_at TIMESTAMP,
    purchase_deadline TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cart_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    site_id INTEGER REFERENCES sites(id),
    price_type VARCHAR(20) NOT NULL,
    price DECIMAL(10,2),
    reserved_at TIMESTAMP,
    reservation_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, site_id)
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    payment_method VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    site_id INTEGER REFERENCES sites(id),
    price DECIMAL(10,2) NOT NULL,
    price_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    telegram_id BIGINT UNIQUE,
    is_active BOOLEAN DEFAULT true,
    permissions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admins(id),
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id INTEGER REFERENCES categories(id),
    filename VARCHAR(255),
    total_records INTEGER,
    processed_records INTEGER DEFAULT 0,
    successful_records INTEGER DEFAULT 0,
    failed_records INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'processing',
    admin_id INTEGER REFERENCES admins(id),
    antipublic_check_results JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE antipublic_database (
    id SERIAL PRIMARY KEY,
    content_hash VARCHAR(255) NOT NULL UNIQUE,
    full_content TEXT NOT NULL,
    source_info TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE telegram_settings (
    id SERIAL PRIMARY KEY,
    bot_token VARCHAR(255),
    chat_id BIGINT,
    notifications_enabled BOOLEAN DEFAULT true,
    notification_types JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_invite_code ON users(invite_code_used);
CREATE INDEX idx_users_access_expires ON users(access_expires_at);
CREATE INDEX idx_sites_status ON sites(status);
CREATE INDEX idx_sites_category ON sites(category_id);
CREATE INDEX idx_sites_upload_date ON sites(upload_date);
CREATE INDEX idx_price_offers_site_user ON price_offers(site_id, user_id);
CREATE INDEX idx_price_offers_expires ON price_offers(expires_at);
CREATE INDEX idx_cart_user ON cart_items(user_id);
CREATE INDEX idx_cart_reservation ON cart_items(reservation_expires_at);
CREATE INDEX idx_auth_logs_user ON auth_logs(user_id);
CREATE INDEX idx_auth_logs_date ON auth_logs(created_at);
CREATE INDEX idx_antipublic_hash ON antipublic_database(content_hash);

INSERT INTO admins (username, password_hash, telegram_id) 
VALUES ('admin', crypt('admin123', gen_salt('bf')), NULL);

INSERT INTO invite_codes (code, expires_at, max_uses) 
VALUES ('TEST2024', CURRENT_TIMESTAMP + INTERVAL '30 days', 10);