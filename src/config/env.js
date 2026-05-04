const crypto = require('crypto');

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOrigins(value) {
    return String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

function loadConfig() {
    const jwtSecret = requireEnv('JWT_SECRET');
    const appEncryptionKey = requireEnv('APP_ENCRYPTION_KEY');
    const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000');

    if (allowedOrigins.includes('*')) {
        throw new Error('ALLOWED_ORIGINS cannot contain wildcard origins.');
    }

    return {
        app: {
            name: process.env.APP_NAME || 'LeadGen Platform',
            env: process.env.NODE_ENV || 'development',
            port: parseInteger(process.env.PORT, 3000),
            demoMode: parseBoolean(process.env.DEMO_MODE, false)
        },
        auth: {
            jwtSecret,
            jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
            bootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN || '',
            allowSelfSignup: parseBoolean(process.env.ALLOW_SELF_SIGNUP, false)
        },
        security: {
            allowedOrigins,
            appEncryptionKey,
            rateLimitWindowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
            rateLimitMax: parseInteger(process.env.RATE_LIMIT_MAX, 200),
            authRateLimitMax: parseInteger(process.env.AUTH_RATE_LIMIT_MAX, 20)
        },
        crawler: {
            concurrency: Math.max(1, parseInteger(process.env.CRAWLER_CONCURRENCY, 3)),
            timeout: Math.max(1000, parseInteger(process.env.CRAWLER_TIMEOUT, 10000)),
            delayMs: Math.max(0, parseInteger(process.env.CRAWLER_DELAY_MS, 500)),
            maxPages: Math.max(1, parseInteger(process.env.CRAWLER_MAX_PAGES, 12))
        },
        googlePlaces: {
            apiKey: process.env.GOOGLE_PLACES_API_KEY || ''
        },
        linkedin: {
            clientId: process.env.LINKEDIN_CLIENT_ID || '',
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
            authMode: process.env.LINKEDIN_AUTH_MODE || 'native-pkce',
            providerUrl: process.env.LINKEDIN_PROVIDER_URL || '',
            providerTimeoutMs: parseInteger(process.env.LINKEDIN_PROVIDER_TIMEOUT, 30000),
            redirectUri: process.env.LINKEDIN_REDIRECT_URI || `http://127.0.0.1:${parseInteger(process.env.PORT, 3000)}/auth/linkedin/callback`,
            scopes: String(process.env.LINKEDIN_SCOPES || '').trim()
        },
        openai: {
            apiBaseUrl: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
            model: process.env.OPENAI_MODEL || 'gpt-5-mini'
        },
        storage: {
            userDataTtlHours: Math.max(1, parseInteger(process.env.USER_DATA_TTL_HOURS, 24)),
            userDataSweepMinutes: Math.max(5, parseInteger(process.env.USER_DATA_SWEEP_MINUTES, 60))
        }
    };
}

function createEncryptionKey(secret) {
    return crypto.scryptSync(secret, 'leadgen-platform', 32);
}

module.exports = {
    loadConfig,
    createEncryptionKey
};
