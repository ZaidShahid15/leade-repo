const { v4: uuidv4 } = require('uuid');
const JsonStore = require('../lib/jsonStore');
const { classifyContactValue, splitContactValues } = require('../lib/contactSanitizer');

class LeadRepository {
    constructor() {
        this.legacyStore = new JsonStore('leads.json', []);
        this.stores = new Map();
    }

    getStore(userId) {
        if (!this.stores.has(userId)) {
            // Each user keeps lead data in their own JSON file.
            this.stores.set(userId, new JsonStore(`users/${userId}/leads.json`, []));
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

    async createOrUpdateForUser(userId, lead) {
        const store = this.getStore(userId);
        const rows = await this.readRows(userId);
        const externalId = lead.externalId || lead.id || null;
        const index = rows.findIndex((row) =>
            row.owner_user_id === userId
            && row.source === (lead.source || 'google_places')
            && row.external_id === externalId
        );

        const base = index >= 0 ? rows[index] : {
            id: uuidv4(),
            owner_user_id: userId,
            created_at: new Date().toISOString()
        };

        // Only keep contacts that validate as email or phone before storing.
        const incomingContacts = splitContactValues([
            ...(lead.emails || []),
            ...(lead.phones || []),
            lead.phone || ''
        ]);
        const primaryPhone = classifyContactValue(lead.phone)?.type === 'phone'
            ? classifyContactValue(lead.phone).value
            : (incomingContacts.phones[0] || null);

        const record = {
            ...base,
            source: lead.source || 'google_places',
            external_id: externalId,
            name: lead.name,
            address: lead.address || null,
            lat: lead.lat ?? null,
            lng: lead.lng ?? null,
            rating: lead.rating ?? null,
            review_count: lead.reviewCount ?? 0,
            category: lead.category || null,
            business_status: lead.businessStatus || null,
            website: lead.website || null,
            phone: primaryPhone,
            emails: incomingContacts.emails,
            phones: incomingContacts.phones,
            social_links: lead.socialLinks || {},
            contact_page_url: lead.contactPageUrl || null,
            crawled: Boolean(lead.crawled),
            crawl_status: lead.crawlStatus || 'pending',
            crawl_error: lead.crawlError || null,
            pages_scanned: lead.pagesScanned || 0,
            discovered_at: lead.discoveredAt || new Date().toISOString(),
            last_crawled: lead.lastCrawled || null,
            raw_payload: lead.rawPayload || {},
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

    async updateLeadForUser(userId, leadId, patch) {
        const store = this.getStore(userId);
        const rows = await this.readRows(userId);
        const index = rows.findIndex((row) => row.id === leadId && row.owner_user_id === userId);
        if (index === -1) {
            return null;
        }

        const current = rows[index];
        // Merge existing and incoming contacts, then store only valid email/phone values.
        const mergedContacts = splitContactValues([
            ...(current.emails || []),
            ...(current.phones || []),
            current.phone || '',
            ...(patch.emails || []),
            ...(patch.phones || []),
            patch.phone || ''
        ]);
        const nextPhone = patch.phone !== undefined
            ? (classifyContactValue(patch.phone)?.type === 'phone' ? classifyContactValue(patch.phone).value : null)
            : current.phone;

        rows[index] = {
            ...current,
            website: patch.website ?? current.website,
            phone: nextPhone || mergedContacts.phones[0] || null,
            emails: mergedContacts.emails,
            phones: mergedContacts.phones,
            social_links: { ...(current.social_links || {}), ...(patch.socialLinks || {}) },
            contact_page_url: patch.contactPageUrl ?? current.contact_page_url,
            crawled: patch.crawled ?? current.crawled,
            crawl_status: patch.crawlStatus ?? current.crawl_status,
            crawl_error: patch.crawlError ?? current.crawl_error,
            pages_scanned: patch.pagesScanned ?? current.pages_scanned,
            last_crawled: patch.lastCrawled ?? current.last_crawled,
            updated_at: new Date().toISOString()
        };

        await store.write(rows);
        return rows[index];
    }

    async findByIdForUser(leadId, userId) {
        const rows = await this.readRows(userId);
        return rows.find((row) => row.id === leadId && row.owner_user_id === userId) || null;
    }

    async listForUser(userId, filters = {}) {
        const keyword = String(filters.keyword || '').toLowerCase();
        const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
        const limit = Math.min(500, Math.max(1, Number.parseInt(filters.limit, 10) || 100));
        const sortBy = filters.sortBy || 'discovered_at';
        const sortDir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;

        let rows = await this.readRows(userId);

        if (keyword) {
            rows = rows.filter((row) =>
                String(row.name || '').toLowerCase().includes(keyword)
                || String(row.address || '').toLowerCase().includes(keyword)
                || String(row.category || '').toLowerCase().includes(keyword)
            );
        }

        if (filters.hasWebsite) rows = rows.filter((row) => Boolean(row.website));
        if (filters.hasEmail) rows = rows.filter((row) => Array.isArray(row.emails) && row.emails.length > 0);
        if (filters.hasPhone) rows = rows.filter((row) => (row.phones || []).length > 0 || Boolean(row.phone));
        if (filters.crawled !== undefined) rows = rows.filter((row) => row.crawled === Boolean(filters.crawled));
        if (filters.category) rows = rows.filter((row) => String(row.category || '').toLowerCase() === String(filters.category).toLowerCase());

        rows.sort((a, b) => {
            const left = a[sortBy] ?? '';
            const right = b[sortBy] ?? '';
            if (typeof left === 'number' && typeof right === 'number') {
                return (left - right) * sortDir;
            }
            return String(left).localeCompare(String(right)) * sortDir;
        });

        const total = rows.length;
        const offset = (page - 1) * limit;

        return {
            leads: rows.slice(offset, offset + limit),
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit))
        };
    }

    async deleteForUser(userId, leadId) {
        const store = this.getStore(userId);
        const rows = await this.readRows(userId);
        const filtered = rows.filter((row) => !(row.id === leadId && row.owner_user_id === userId));
        const changed = filtered.length !== rows.length;
        if (changed) {
            await store.write(filtered);
        }
        return changed;
    }

    async clearForUser(userId) {
        const store = this.getStore(userId);
        await store.write([]);
    }

    async getStatsForUser(userId) {
        const rows = await this.readRows(userId);
        const ratings = rows.map((row) => Number(row.rating)).filter((value) => Number.isFinite(value));

        return {
            total: rows.length,
            with_email: rows.filter((row) => (row.emails || []).length > 0).length,
            with_phone: rows.filter((row) => (row.phones || []).length > 0 || Boolean(row.phone)).length,
            with_website: rows.filter((row) => Boolean(row.website)).length,
            crawled: rows.filter((row) => row.crawled).length,
            with_social: rows.filter((row) => Object.keys(row.social_links || {}).length > 0).length,
            with_contact_page: rows.filter((row) => Boolean(row.contact_page_url)).length,
            avg_rating: ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : '0.0'
        };
    }

    async getUncrawledForUser(userId, limit = 1000) {
        const rows = (await this.readRows(userId))
            .filter((row) => !row.crawled && row.website)
            .sort((a, b) => String(b.discovered_at || '').localeCompare(String(a.discovered_at || '')));
        return rows.slice(0, limit);
    }
}

module.exports = LeadRepository;
