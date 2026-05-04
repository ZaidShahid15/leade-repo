const JsonStore = require('../lib/jsonStore');

class OAuthRepository {
    constructor() {
        this.stateStore = new JsonStore('linkedin-oauth-states.json', []);
        this.legacyTokenStore = new JsonStore('oauth-tokens.json', []);
        this.tokenStores = new Map();
    }

    getTokenStore(userId) {
        if (!this.tokenStores.has(userId)) {
            // Each user keeps OAuth tokens in their own JSON file.
            this.tokenStores.set(userId, new JsonStore(`users/${userId}/oauth-tokens.json`, []));
        }

        return this.tokenStores.get(userId);
    }

    async readTokenRows(userId) {
        const store = this.getTokenStore(userId);
        const rows = await store.read();
        if (rows.length > 0) {
            return rows;
        }

        const legacyRows = (await this.legacyTokenStore.read()).filter((row) => row.user_id === userId);
        if (legacyRows.length > 0) {
            await store.write(legacyRows);
        }

        return legacyRows;
    }

    async saveState({ state, userId, provider, payload, expiresAt }) {
        const rows = await this.stateStore.read();
        const filtered = rows.filter((row) => row.state !== state);
        filtered.push({
            state,
            user_id: userId,
            provider,
            payload: payload || {},
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        });
        await this.stateStore.write(filtered);
    }

    async consumeState(state, provider) {
        const rows = await this.stateStore.read();
        const now = Date.now();
        const validRows = rows.filter((row) => new Date(row.expires_at).getTime() > now);
        const match = validRows.find((row) => row.state === state && row.provider === provider) || null;
        await this.stateStore.write(validRows.filter((row) => !(row.state === state && row.provider === provider)));
        return match;
    }

    async saveToken({ userId, provider, encrypted, expiresAt }) {
        const store = this.getTokenStore(userId);
        const rows = await this.readTokenRows(userId);
        const index = rows.findIndex((row) => row.user_id === userId && row.provider === provider);
        const record = {
            id: `${provider}_${userId}`,
            user_id: userId,
            provider,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            auth_tag: encrypted.authTag,
            expires_at: expiresAt || null,
            created_at: index >= 0 ? rows[index].created_at : new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (index >= 0) {
            rows[index] = record;
        } else {
            rows.push(record);
        }

        await store.write(rows);
        return record;
    }

    async getToken(userId, provider) {
        const rows = await this.readTokenRows(userId);
        return rows.find((row) => row.user_id === userId && row.provider === provider) || null;
    }
}

module.exports = OAuthRepository;
