const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../lib/asyncHandler');
const AppError = require('../lib/appError');
const { authLoginSchema, authRegisterSchema } = require('../lib/validators');
const { adminMiddleware } = require('../middleware/authMiddleware');

function parse(schema, input) {
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new AppError(400, 'Invalid request payload.', 'VALIDATION_ERROR', result.error.flatten());
    }

    return result.data;
}

function buildAuthRouter({ authService, authMiddleware, config, userRepository }) {
    const router = express.Router();
    const authLimiter = rateLimit({
        windowMs: config.security.rateLimitWindowMs,
        max: config.security.authRateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: 'RATE_LIMITED',
            message: 'Too many authentication attempts. Please try again later.'
        }
    });

    router.post('/bootstrap-admin', authLimiter, asyncHandler(async (req, res) => {
        if (!config.auth.bootstrapToken || req.headers['x-bootstrap-token'] !== config.auth.bootstrapToken) {
            throw new AppError(403, 'Invalid bootstrap token.', 'AUTH_FORBIDDEN');
        }

        const adminCount = await userRepository.countAdmins();
        if (adminCount > 0) {
            throw new AppError(409, 'An admin user already exists.', 'AUTH_ADMIN_EXISTS');
        }

        const payload = parse(authRegisterSchema, req.body);
        const result = await authService.register({ ...payload, role: 'admin' });
        res.status(201).json({ success: true, ...result });
    }));

    router.post('/register', authLimiter, asyncHandler(async (req, res) => {
        if (!config.auth.allowSelfSignup) {
            throw new AppError(403, 'Self-signup is disabled.', 'AUTH_SIGNUP_DISABLED');
        }

        const payload = parse(authRegisterSchema, req.body);
        const result = await authService.register(payload);
        res.status(201).json({ success: true, ...result });
    }));

    router.post('/users', authMiddleware, adminMiddleware, authLimiter, asyncHandler(async (req, res) => {
        const payload = parse(authRegisterSchema, req.body);
        const role = ['admin', 'user'].includes(req.body?.role) ? req.body.role : 'user';
        const result = await authService.register({ ...payload, role });
        res.status(201).json({ success: true, ...result });
    }));

    router.post('/login', authLimiter, asyncHandler(async (req, res) => {
        const payload = parse(authLoginSchema, req.body);
        const result = await authService.login(payload);
        res.json({ success: true, ...result });
    }));

    router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
        const user = await userRepository.findById(req.auth.userId);
        res.json({ success: true, user });
    }));

    return router;
}

module.exports = buildAuthRouter;
