const { v4: uuidv4 } = require('uuid');
const JsonStore = require('../lib/jsonStore');

class UserRepository {
    constructor() {
        this.store = new JsonStore('users.json', []);
    }

    async countAdmins() {
        const users = await this.store.read();
        return users.filter((user) => user.role === 'admin').length;
    }

    async createUser({ name, email, passwordHash, role = 'user' }) {
        const users = await this.store.read();
        const user = {
            id: uuidv4(),
            name,
            email: String(email).toLowerCase(),
            password_hash: passwordHash,
            role,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        users.push(user);
        await this.store.write(users);
        return this.toPublicUser(user);
    }

    async findByEmail(email) {
        const users = await this.store.read();
        return users.find((user) => user.email === String(email).toLowerCase()) || null;
    }

    async findById(id) {
        const users = await this.store.read();
        const user = users.find((entry) => entry.id === id);
        return user ? this.toPublicUser(user) : null;
    }

    toPublicUser(user) {
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_active: user.is_active,
            created_at: user.created_at,
            updated_at: user.updated_at
        };
    }
}

module.exports = UserRepository;
