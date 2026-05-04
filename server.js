require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const pinoHttp = require('pino-http');

const { loadConfig } = require('./src/config/env');
const logger = require('./src/lib/logger');
const AppError = require('./src/lib/appError');
const EncryptionService = require('./src/lib/encryption');
const UserRepository = require('./src/repositories/userRepository');
const LeadRepository = require('./src/repositories/leadRepository');
const JobRepository = require('./src/repositories/jobRepository');
const SettingsRepository = require('./src/repositories/settingsRepository');
const OAuthRepository = require('./src/repositories/oauthRepository');
const OutreachRepository = require('./src/repositories/outreachRepository');
const AuthService = require('./src/services/authService');
const DataRetentionService = require('./src/services/dataRetentionService');
const LinkedInOAuthService = require('./src/services/linkedinOAuth');
const OutreachService = require('./src/services/outreachService');
const buildAuthRouter = require('./src/routes/auth');
const buildApiRouter = require('./src/routes/api');
const buildOutreachRouter = require('./src/routes/outreach');
const { buildAuthMiddleware } = require('./src/middleware/authMiddleware');
const { errorMiddleware, notFoundMiddleware } = require('./src/middleware/errorMiddleware');
const jwt = require('jsonwebtoken');

async function bootstrap() {
    const config = loadConfig();
    const encryptionService = new EncryptionService(config.security.appEncryptionKey);

    const userRepository = new UserRepository();
    const leadRepository = new LeadRepository();
    const jobRepository = new JobRepository();
    const settingsRepository = new SettingsRepository();
    const oauthRepository = new OAuthRepository();
    const outreachRepository = new OutreachRepository();
    const dataRetentionService = new DataRetentionService({
        logger,
        ttlMs: config.storage.userDataTtlHours * 60 * 60 * 1000,
        sweepIntervalMs: config.storage.userDataSweepMinutes * 60 * 1000
    });
    const authService = new AuthService({ config, userRepository });
    const linkedinOAuthService = new LinkedInOAuthService({
        config,
        encryptionService,
        oauthRepository
    });
    const authMiddleware = buildAuthMiddleware({ config, userRepository });

    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: {
            origin(origin, callback) {
                if (!origin || config.security.allowedOrigins.includes(origin)) {
                    return callback(null, true);
                }

                return callback(new Error('Socket origin not allowed by policy.'));
            }
        },
        pingTimeout: 120000,
        pingInterval: 25000
    });
    const outreachService = new OutreachService({
        config,
        encryptionService,
        settingsRepository,
        outreachRepository,
        io
    });

    io.use(async (socket, next) => {
        try {
            const raw = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
            if (!raw) {
                throw new AppError(401, 'Socket authentication required.', 'AUTH_REQUIRED');
            }

            const payload = jwt.verify(raw, config.auth.jwtSecret);
            socket.data.user = {
                id: payload.sub,
                role: payload.role,
                email: payload.email
            };
            next();
        } catch (_error) {
            next(new Error('Socket authentication failed.'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.data.user?.id;
        if (userId) {
            socket.join(`user:${userId}`);
        }

        socket.on('disconnect', () => {
            logger.info({ socketId: socket.id, userId }, 'Socket disconnected');
        });
    });

    const corsOptions = {
        origin(origin, callback) {
            if (!origin || config.security.allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new AppError(403, `Origin not allowed: ${origin}`, 'CORS_ORIGIN_DENIED'));
        },
        credentials: true
    };

    app.set('io', io);
    app.use(pinoHttp({ logger }));
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                fontSrc: ["'self'", 'https:', 'data:'],
                formAction: ["'self'"],
                frameAncestors: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https://*.basemaps.cartocdn.com'],
                objectSrc: ["'none'"],
                scriptSrc: ["'self'", 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://cdn.socket.io'],
                scriptSrcAttr: ["'none'"],
                styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
                upgradeInsecureRequests: []
            }
        }
    }));
    app.use(cors(corsOptions));
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: false }));
    app.use(rateLimit({
        windowMs: config.security.rateLimitWindowMs,
        max: config.security.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: 'RATE_LIMITED',
            message: 'Too many requests. Please slow down.'
        }
    }));

    app.use('/api/auth', buildAuthRouter({ authService, authMiddleware, config, userRepository }));
    app.use('/api/outreach', buildOutreachRouter({
        authMiddleware,
        outreachService
    }));
    app.use('/api', buildApiRouter({
        config,
        encryptionService,
        io,
        authMiddleware,
        leadRepository,
        jobRepository,
        settingsRepository,
        linkedinOAuthService
    }));

    app.get('/auth/linkedin/connect', authMiddleware, async (req, res, next) => {
        try {
            if (!linkedinOAuthService.isConfigured()) {
                throw new AppError(500, 'LinkedIn is not configured.', 'LINKEDIN_NOT_CONFIGURED');
            }

            const authRequest = await linkedinOAuthService.createAuthorizationRequest(req.auth.userId);
            return res.redirect(authRequest.authorizationUrl);
        } catch (error) {
            return next(error);
        }
    });

    app.get('/auth/linkedin/callback', async (req, res, next) => {
        try {
            const { code, state, error, error_description: errorDescription } = req.query;
            if (error) {
                throw new AppError(400, `${error}: ${errorDescription || 'Authorization was denied.'}`, 'LINKEDIN_AUTH_FAILED');
            }

            if (!code || !state) {
                throw new AppError(400, 'The callback is missing a valid code/state pair.', 'LINKEDIN_INVALID_CALLBACK');
            }

            const saved = await linkedinOAuthService.handleCallback({
                code: String(code),
                state: String(state)
            });

            if (!saved) {
                throw new AppError(400, 'The callback state is invalid or expired. Start the LinkedIn connect flow again.', 'LINKEDIN_INVALID_STATE');
            }

            return res.send(renderLinkedinMessagePage(
                'LinkedIn connected',
                `Encrypted access token saved successfully. Expires at: ${saved.expiresAt || 'unknown'}.`
            ));
        } catch (error) {
            return next(error);
        }
    });

    app.use(express.static(path.join(__dirname, 'public')));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
            return next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
        }

        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.use(notFoundMiddleware);
    app.use(errorMiddleware);

    dataRetentionService.start();

    server.listen(config.app.port, () => {
        logger.info({
            port: config.app.port,
            env: config.app.env,
            allowedOrigins: config.security.allowedOrigins,
            userDataTtlHours: config.storage.userDataTtlHours,
            userDataSweepMinutes: config.storage.userDataSweepMinutes
        }, `${config.app.name} is running`);
    });
}

function renderLinkedinMessagePage(title, message) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#eef4fb;color:#123;display:grid;place-items:center;min-height:100vh}
    .card{max-width:720px;padding:32px;border-radius:20px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,.08)}
    h1{margin:0 0 12px;font-size:32px}
    p{line-height:1.6;color:#456}
    a{display:inline-block;margin-top:18px;color:#0a66c2;text-decoration:none;font-weight:700}
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">Return to LeadGen Pro</a>
  </div>
</body>
</html>`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

bootstrap().catch((error) => {
    logger.error({ err: error }, 'Failed to bootstrap server');
    process.exit(1);
});
