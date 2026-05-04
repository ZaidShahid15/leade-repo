const JsonStore = require('../lib/jsonStore');

class OutreachRepository {
    constructor() {
        this.legacyStore = new JsonStore('outreach-campaigns.json', []);
        this.stores = new Map();
    }

    getStore(userId) {
        if (!this.stores.has(userId)) {
            // Each user keeps outreach campaigns in their own JSON file.
            this.stores.set(userId, new JsonStore(`users/${userId}/outreach-campaigns.json`, []));
        }

        return this.stores.get(userId);
    }

    async readRows(userId) {
        const store = this.getStore(userId);
        const rows = await store.read();
        if (rows.length > 0) {
            return rows;
        }

        const legacyRows = (await this.legacyStore.read()).filter((row) => row.owner_user_id === userId);
        if (legacyRows.length > 0) {
            await store.write(legacyRows);
        }

        return legacyRows;
    }

    async create(campaign) {
        const store = this.getStore(campaign.owner_user_id);
        const rows = await this.readRows(campaign.owner_user_id);
        rows.push(campaign);
        await store.write(rows);
        return campaign;
    }

    async listForUser(userId) {
        const rows = await this.readRows(userId);
        return rows
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }

    async findByIdForUser(campaignId, userId) {
        const rows = await this.readRows(userId);
        return rows.find((row) => row.id === campaignId && row.owner_user_id === userId) || null;
    }

    async replaceForUser(userId, campaignId, nextCampaign) {
        const store = this.getStore(userId);
        const rows = await this.readRows(userId);
        const index = rows.findIndex((row) => row.id === campaignId && row.owner_user_id === userId);
        if (index === -1) {
            return null;
        }

        rows[index] = nextCampaign;
        await store.write(rows);
        return rows[index];
    }
}

module.exports = OutreachRepository;
