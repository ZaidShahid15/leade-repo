const JsonStore = require('../lib/jsonStore');

class SettingsRepository {
    constructor() {
        this.legacyStore = new JsonStore('settings.json', []);
        this.stores = new Map();
    }

    getStore(userId) {
        if (!this.stores.has(userId)) {
            // Each user keeps settings in their own JSON file.
            this.stores.set(userId, new JsonStore(`users/${userId}/settings.json`, []));
        }

        return this.stores.get(userId);
    }

    async readRows(userId) {
        const store = this.getStore(userId);
        const rows = await store.read();
        if (rows.length > 0) {
            return rows;
        }

        const legacyRows = (await this.legacyStore.read()).filter((row) => row.user_id === userId);
        if (legacyRows.length > 0) {
            await store.write(legacyRows);
        }

        return legacyRows;
    }

    async getByUserId(userId) {
        const rows = await this.readRows(userId);
        return rows.find((row) => row.user_id === userId) || null;
    }

    async upsert(userId, payload) {
        const store = this.getStore(userId);
        const rows = await this.readRows(userId);
        const now = new Date().toISOString();
        const index = rows.findIndex((row) => row.user_id === userId);
        const base = index >= 0 ? rows[index] : {
            user_id: userId,
            google_api_key_ciphertext: null,
            google_api_key_iv: null,
            google_api_key_auth_tag: null,
            crawler_concurrency: 3,
            crawler_timeout: 10000,
            created_at: now,
            updated_at: now
        };

        const next = {
            ...base,
            ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)),
            updated_at: now
        };

        if (index >= 0) {
            rows[index] = next;
        } else {
            rows.push(next);
        }

        await store.write(rows);
        return next;
    }
}

module.exports = SettingsRepository;
