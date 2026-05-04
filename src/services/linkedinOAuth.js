const axios = require('axios');
const crypto = require('crypto');

class LinkedInOAuthService {
    constructor({ config, encryptionService, oauthRepository }) {
        this.config = config;
        this.encryptionService = encryptionService;
        this.oauthRepository = oauthRepository;
        this.provider = 'linkedin';
    }

    isConfigured() {
        if (!this.config.linkedin.clientId) {
            return false;
        }

        if (this.getAuthMode() === 'native-pkce') {
            return true;
        }

        return Boolean(this.config.linkedin.clientSecret);
    }

    getAuthMode() {
        return this.config.linkedin.authMode;
    }

    getScopes() {
        const configured = this.config.linkedin.scopes || (this.getAuthMode() === 'native-pkce' ? 'w_member_social' : 'openid profile email');
        if (this.getAuthMode() !== 'native-pkce') {
            return configured;
        }

        const scopes = configured
            .split(/\s+/)
            .filter(Boolean)
            .filter((scope) => !['openid', 'profile', 'email'].includes(scope));

        return scopes.length ? scopes.join(' ') : 'w_member_social';
    }

    generateState() {
        return crypto.randomBytes(24).toString('hex');
    }

    generateCodeVerifier() {
        return this.base64UrlEncode(crypto.randomBytes(64));
    }

    generateCodeChallenge(codeVerifier) {
        return this.base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
    }

    async createAuthorizationRequest(userId) {
        const state = this.generateState();
        const codeVerifier = this.getAuthMode() === 'native-pkce' ? this.generateCodeVerifier() : null;
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.config.linkedin.clientId,
            redirect_uri: this.config.linkedin.redirectUri,
            state,
            scope: this.getScopes()
        });

        let authorizationUrl = 'https://www.linkedin.com/oauth/v2/authorization';
        if (this.getAuthMode() === 'native-pkce') {
            authorizationUrl = 'https://www.linkedin.com/oauth/native-pkce/authorization';
            params.set('code_challenge', this.generateCodeChallenge(codeVerifier));
            params.set('code_challenge_method', 'S256');
        }

        await this.oauthRepository.saveState({
            state,
            userId,
            provider: this.provider,
            payload: { codeVerifier },
            expiresAt: new Date(Date.now() + (15 * 60 * 1000)).toISOString()
        });

        return {
            authorizationUrl: `${authorizationUrl}?${params.toString()}`,
            state
        };
    }

    async handleCallback({ code, state }) {
        const savedState = await this.oauthRepository.consumeState(state, this.provider);
        if (!savedState) {
            return null;
        }

        const tokenData = await this.exchangeCodeForToken(code, savedState.payload?.codeVerifier || null);
        const encrypted = this.encryptionService.encrypt(tokenData);
        const expiresAt = tokenData.expires_in
            ? new Date(Date.now() + (Number.parseInt(tokenData.expires_in, 10) * 1000)).toISOString()
            : null;

        await this.oauthRepository.saveToken({
            userId: savedState.user_id,
            provider: this.provider,
            encrypted,
            expiresAt
        });

        return {
            userId: savedState.user_id,
            expiresAt
        };
    }

    async exchangeCodeForToken(code, codeVerifier = null) {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: this.config.linkedin.clientId,
            redirect_uri: this.config.linkedin.redirectUri
        });

        if (this.getAuthMode() === 'native-pkce') {
            body.set('code_verifier', codeVerifier || '');
        } else {
            body.set('client_secret', this.config.linkedin.clientSecret);
        }

        const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: this.config.linkedin.providerTimeoutMs
        });

        return response.data;
    }

    async getAccessTokenForUser(userId) {
        const record = await this.oauthRepository.getToken(userId, this.provider);
        if (!record) {
            return null;
        }

        const decrypted = this.encryptionService.decrypt({
            algorithm: 'aes-256-gcm',
            ciphertext: record.ciphertext,
            iv: record.iv,
            authTag: record.auth_tag
        });

        return {
            ...decrypted,
            expiresAt: record.expires_at
        };
    }

    async getPublicStatus(userId) {
        const token = userId ? await this.getAccessTokenForUser(userId) : null;
        return {
            configured: this.isConfigured(),
            connected: Boolean(token?.access_token),
            redirectUri: this.config.linkedin.redirectUri,
            scopes: this.getScopes(),
            authMode: this.getAuthMode(),
            savedAt: token?.savedAt || null,
            expiresAt: token?.expiresAt || null
        };
    }

    base64UrlEncode(buffer) {
        return Buffer.from(buffer)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    }
}

module.exports = LinkedInOAuthService;
