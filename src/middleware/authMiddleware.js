const jwt = require('jsonwebtoken');
const AppError = require('../lib/appError');

function extractBearerToken(req) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
        return header.slice(7).trim();
    }

    if (typeof req.query.token === 'string' && req.query.token.trim()) {
        return req.query.token.trim();
    }

    return '';
}

function buildAuthMiddleware({ config, userRepository }) {
    return async function authMiddleware(req, _res, next) {
        try {
            const token = extractBearerToken(req);
            if (!token) {
                throw new AppError(401, 'Authentication required.', 'AUTH_REQUIRED');
            }

            const payload = jwt.verify(token, config.auth.jwtSecret);
            const user = await userRepository.findById(payload.sub);
            if (!user || !user.is_active) {
                throw new AppError(401, 'User account is unavailable.', 'AUTH_INVALID_USER');
            }

            req.auth = {
                userId: user.id,
                role: user.role,
                email: user.email,
                token
            };

            next();
        } catch (error) {
            next(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError'
                ? new AppError(401, 'Invalid or expired token.', 'AUTH_INVALID_TOKEN')
                : error);
        }
    };
}

function adminMiddleware(req, _res, next) {
    if (!req.auth || req.auth.role !== 'admin') {
        return next(new AppError(403, 'Admin access required.', 'AUTH_FORBIDDEN'));
    }

    return next();
}

module.exports = {
    adminMiddleware,
    buildAuthMiddleware,
    extractBearerToken
};
