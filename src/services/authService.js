const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const AppError = require('../lib/appError');

class AuthService {
    constructor({ config, userRepository }) {
        this.config = config;
        this.userRepository = userRepository;
    }

    async register({ name, email, password, role = 'user' }) {
        const existing = await this.userRepository.findByEmail(email);
        if (existing) {
            throw new AppError(409, 'Email is already registered.', 'AUTH_EMAIL_EXISTS');
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await this.userRepository.createUser({
            name,
            email,
            passwordHash,
            role
        });

        return {
            user,
            token: this.issueToken(user)
        };
    }

    async login({ email, password }) {
        const user = await this.userRepository.findByEmail(email);
        if (!user || !user.is_active) {
            throw new AppError(401, 'Invalid email or password.', 'AUTH_INVALID_CREDENTIALS');
        }

        const matches = await bcrypt.compare(password, user.password_hash);
        if (!matches) {
            throw new AppError(401, 'Invalid email or password.', 'AUTH_INVALID_CREDENTIALS');
        }

        return {
            user: this.userRepository.toPublicUser ? this.userRepository.toPublicUser(user) : {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                is_active: user.is_active,
                created_at: user.created_at,
                updated_at: user.updated_at
            },
            token: this.issueToken(user)
        };
    }

    issueToken(user) {
        return jwt.sign(
            {
                sub: user.id,
                email: user.email,
                role: user.role
            },
            this.config.auth.jwtSecret,
            { expiresIn: this.config.auth.jwtExpiresIn }
        );
    }
}

module.exports = AuthService;
