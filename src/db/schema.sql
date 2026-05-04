CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id VARCHAR(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    google_api_key_ciphertext TEXT,
    google_api_key_iv TEXT,
    google_api_key_auth_tag TEXT,
    crawler_concurrency INTEGER NOT NULL DEFAULT 3,
    crawler_timeout INTEGER NOT NULL DEFAULT 10000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,
    external_id VARCHAR(255),
    name TEXT NOT NULL,
    address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    rating DOUBLE PRECISION,
    review_count INTEGER,
    category TEXT,
    business_status TEXT,
    website TEXT,
    phone TEXT,
    emails JSONB NOT NULL DEFAULT '[]'::jsonb,
    phones JSONB NOT NULL DEFAULT '[]'::jsonb,
    social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
    contact_page_url TEXT,
    crawled BOOLEAN NOT NULL DEFAULT FALSE,
    crawl_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    crawl_error TEXT,
    pages_scanned INTEGER NOT NULL DEFAULT 0,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_crawled TIMESTAMPTZ,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_user_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS leads_owner_idx ON leads(owner_user_id);
CREATE INDEX IF NOT EXISTS leads_category_idx ON leads(owner_user_id, category);
CREATE INDEX IF NOT EXISTS leads_discovered_idx ON leads(owner_user_id, discovered_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(64) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL,
    status VARCHAR(30) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs(owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_tokens (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS oauth_states (
    state VARCHAR(120) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at);
