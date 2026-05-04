/**
 * LeadGen Pro - Frontend Application
 * SaaS Dashboard for Local Business Lead Generation
 */

class LeadGenApp {
    constructor() {
        this.socket = null;
        this.map = null;
        this.drawControl = null;
        this.drawnItems = null;
        this.markers = [];
        this.markerGroup = null;
        this.currentBounds = null;
        this.currentPolygon = null;
        this.currentView = 'dashboard';
        this.leads = [];
        this.currentPage = 1;
        this.totalPages = 1;
        this.currentFilter = 'all';
        this.filterKeyword = '';
        this.sortBy = null;
        this.sortDir = 'desc';
        this.activityLog = [];
        this.siteUploadRows = [];
        this.siteCrawlResults = [];
        this.activeSiteCrawlJobId = null;
        this.singleCrawlResults = [];
        this.linkedinResults = [];
        this.linkedinAuthStatus = null;
        this.outreachUploadRows = [];
        this.outreachUploadMeta = {
            totalCount: 0,
            validCount: 0,
            duplicateCount: 0,
            invalidCount: 0,
            suspiciousCount: 0
        };
        this.outreachRejectedEmails = [];
        this.outreachCampaigns = [];
        this.outreachConfig = null;
        this.activeOutreachCampaignId = null;
        this.currentManualCampaign = null;
        this.currentManualRecipient = null;
        this.demoSequences = this.buildDemoSequences();
        this.activeDemo = null;
        this.activeDemoStepIndex = 0;
        this.demoHighlightEl = null;
        this.authToken = localStorage.getItem('leadgen_auth_token') || '';
        this.currentUser = this._readStoredUser();
        this.authReady = false;
        this.bootstrapInFlight = false;
        this.statsRefreshTimer = null;

        this.init();
    }

    async init() {
        this.bindEvents();
        this.initAuthUi();

        if (this.isAuthenticated()) {
            await this.startAuthenticatedApp();
        } else {
            this.lockApp();
        }

        lucide.createIcons();
    }

    async startAuthenticatedApp() {
        this.unlockApp();
        this.connectSocket();

        if (!this.map) {
            this.initMap();
        }

        await Promise.all([
            this.loadStats(),
            this.loadLeads(),
            this.loadLinkedinAuthStatus()
        ]);
    }

    bindEvents() {
        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                if (!this.ensureAuthenticated()) return;
                this.switchView(item.dataset.view);
            });
        });

        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        document.getElementById('btn-new-search').addEventListener('click', () => {
            if (!this.ensureAuthenticated()) return;
            this.switchView('discover');
        });

        document.getElementById('search-keyword').addEventListener('input', () => this.validateSearchForm());
        document.getElementById('btn-start-search').addEventListener('click', () => this.startSearch());

        document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!this.ensureAuthenticated()) return;
                this.setFilter(btn.dataset.filter);
            });
        });

        document.getElementById('leads-filter-input').addEventListener('input', (e) => {
            if (!this.ensureAuthenticated()) return;
            this.filterKeyword = e.target.value;
            this.currentPage = 1;
            this.loadLeads();
        });

        document.getElementById('global-search').addEventListener('input', (e) => {
            if (!this.ensureAuthenticated()) return;
            if (this.currentView !== 'leads') this.switchView('leads');
            document.getElementById('leads-filter-input').value = e.target.value;
            this.filterKeyword = e.target.value;
            this.currentPage = 1;
            this.loadLeads();
        });

        document.querySelectorAll('.sortable').forEach(th => {
            th.addEventListener('click', () => {
                if (!this.ensureAuthenticated()) return;
                const field = th.dataset.sort;
                if (this.sortBy === field) {
                    this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortBy = field;
                    this.sortDir = 'desc';
                }
                this.loadLeads();
            });
        });

        document.getElementById('btn-prev-page').addEventListener('click', () => {
            if (!this.ensureAuthenticated()) return;
            if (this.currentPage > 1) {
                this.currentPage--;
                this.loadLeads();
            }
        });

        document.getElementById('btn-next-page').addEventListener('click', () => {
            if (!this.ensureAuthenticated()) return;
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.loadLeads();
            }
        });

        document.getElementById('btn-export-json').addEventListener('click', () => this.exportLeads('json'));
        document.getElementById('btn-export-csv').addEventListener('click', () => this.exportLeads('csv'));
        document.getElementById('btn-clear-leads').addEventListener('click', () => this.clearLeads());
        document.getElementById('btn-clear-all-data').addEventListener('click', () => this.clearLeads());
        document.getElementById('btn-crawl-all').addEventListener('click', () => this.startCrawl());
        document.getElementById('btn-start-crawl').addEventListener('click', () => this.startCrawl());
        document.getElementById('btn-single-crawl').addEventListener('click', () => this.crawlSingleUrlTable());
        document.getElementById('sites-csv-file').addEventListener('change', (e) => this.onSitesFileSelected(e));
        document.getElementById('btn-start-site-upload').addEventListener('click', () => this.startSiteUploadCrawl());
        document.getElementById('btn-download-site-results').addEventListener('click', () => this.downloadSiteCrawlResults());
        document.getElementById('btn-start-linkedin-search').addEventListener('click', () => this.startLinkedinSearch());
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('btn-demo-crawl').addEventListener('click', () => this.startDemo('crawl'));
        document.getElementById('btn-demo-outreach').addEventListener('click', () => this.startDemo('outreach'));
        document.getElementById('btn-toggle-key').addEventListener('click', () => {
            const input = document.getElementById('settings-api-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });
        document.getElementById('outreach-csv-file').addEventListener('change', (e) => this.onOutreachFileSelected(e));
        document.getElementById('btn-save-outreach-config').addEventListener('click', () => this.saveOutreachConfig());
        document.getElementById('btn-create-outreach-campaign').addEventListener('click', () => this.createOutreachCampaign());
        document.getElementById('btn-clean-outreach-emails').addEventListener('click', () => this.cleanOutreachEmails());
        document.getElementById('btn-start-ai-campaign').addEventListener('click', () => this.startSelectedAiCampaign());
        document.getElementById('btn-send-manual-email').addEventListener('click', () => this.sendManualEmail());

        const closeBtn = document.getElementById('close-search-panel');
        if (closeBtn) closeBtn.addEventListener('click', () => {
            document.getElementById('search-panel').style.display = 'none';
        });

        document.getElementById('select-all').addEventListener('change', (e) => {
            document.querySelectorAll('.lead-checkbox').forEach(cb => {
                cb.checked = e.target.checked;
            });
        });

        document.getElementById('auth-login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        document.getElementById('auth-register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register();
        });

        document.getElementById('btn-auth-show-register').addEventListener('click', () => this.setAuthMode('register'));
        document.getElementById('btn-auth-show-login').addEventListener('click', () => this.setAuthMode('login'));
        document.getElementById('btn-logout').addEventListener('click', () => this.logout());
        document.getElementById('btn-demo-close').addEventListener('click', () => this.closeDemo());
        document.getElementById('btn-demo-skip').addEventListener('click', () => this.closeDemo());
        document.getElementById('btn-demo-prev').addEventListener('click', () => this.prevDemoStep());
        document.getElementById('btn-demo-next').addEventListener('click', () => this.nextDemoStep());
        document.getElementById('demo-modal').addEventListener('click', (e) => {
            if (e.target.id === 'demo-modal') {
                this.closeDemo();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeDemo) {
                this.closeDemo();
            }
        });
    }

    initAuthUi() {
        this.setAuthMode('login');
        this.renderAuthState();
    }

    setAuthMode(mode) {
        const isRegister = mode === 'register';
        document.getElementById('auth-login-panel').style.display = isRegister ? 'none' : 'block';
        document.getElementById('auth-register-panel').style.display = isRegister ? 'block' : 'none';
        document.getElementById('auth-title').textContent = isRegister ? 'Create account' : 'Sign in';
        document.getElementById('auth-subtitle').textContent = isRegister
            ? 'Register to access your lead generation workspace.'
            : 'Sign in with your account to access your workspace.';
        this.clearAuthStatus();
    }

    renderAuthState() {
        const shell = document.getElementById('auth-shell');
        const userMeta = document.getElementById('topbar-user-meta');
        const logoutButton = document.getElementById('btn-logout');
        const username = document.getElementById('topbar-username');
        const userRole = document.getElementById('topbar-role');
        const connectButton = document.getElementById('btn-linkedin-connect');

        if (this.isAuthenticated()) {
            shell.style.display = 'none';
            username.textContent = this.currentUser?.name || this.currentUser?.email || 'Authenticated user';
            userRole.textContent = this.currentUser?.role || 'user';
            userMeta.style.display = 'flex';
            logoutButton.style.display = 'inline-flex';
            connectButton.href = `/auth/linkedin/connect?token=${encodeURIComponent(this.authToken)}`;
        } else {
            shell.style.display = 'grid';
            userMeta.style.display = 'none';
            logoutButton.style.display = 'none';
            connectButton.href = '#';
        }
    }

    lockApp() {
        document.body.classList.add('auth-locked');
        this.renderAuthState();
        this.updateConnectionStatus(false, 'Authentication required');
    }

    unlockApp() {
        document.body.classList.remove('auth-locked');
        this.renderAuthState();
    }

    isAuthenticated() {
        return Boolean(this.authToken);
    }

    ensureAuthenticated() {
        if (this.isAuthenticated()) {
            return true;
        }

        this.lockApp();
        this.showToast('info', 'Sign in to continue.');
        return false;
    }

    async login() {
        const email = document.getElementById('auth-login-email').value.trim();
        const password = document.getElementById('auth-login-password').value;

        try {
            this.setAuthStatus('loading', 'Signing in...');
            const data = await this.apiJsonFetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            }, { requiresAuth: false });

            this.setSession(data.token, data.user);
            this.clearAuthForms();
            this.clearAuthStatus();
            await this.startAuthenticatedApp();
            this.showToast('success', 'Signed in successfully.');
        } catch (error) {
            this.setAuthStatus('error', error.userMessage || error.message || 'Sign in failed.');
        }
    }

    async register() {
        const name = document.getElementById('auth-register-name').value.trim();
        const email = document.getElementById('auth-register-email').value.trim();
        const password = document.getElementById('auth-register-password').value;

        try {
            this.setAuthStatus('loading', 'Creating account...');
            const data = await this.apiJsonFetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            }, { requiresAuth: false });

            this.setSession(data.token, data.user);
            this.clearAuthForms();
            this.clearAuthStatus();
            await this.startAuthenticatedApp();
            this.showToast('success', 'Account created successfully.');
        } catch (error) {
            this.setAuthStatus('error', error.userMessage || error.message || 'Registration failed.');
        }
    }

    logout() {
        this.closeDemo();
        this.clearSession();
        this.destroySocket();
        this.leads = [];
        this.linkedinResults = [];
        this.siteCrawlResults = [];
        this.singleCrawlResults = [];
        this.clearMapMarkers();
        this.renderEmptyState();
        this.lockApp();
        this.setAuthMode('login');
        this.showToast('info', 'Signed out.');
    }

    setSession(token, user) {
        this.authToken = token || '';
        this.currentUser = user || null;

        localStorage.setItem('leadgen_auth_token', this.authToken);
        localStorage.setItem('leadgen_auth_user', JSON.stringify(this.currentUser || {}));

        this.renderAuthState();
        this.reconnectSocket();
    }

    clearSession() {
        this.authToken = '';
        this.currentUser = null;
        localStorage.removeItem('leadgen_auth_token');
        localStorage.removeItem('leadgen_auth_user');
        this.renderAuthState();
    }

    _readStoredUser() {
        try {
            const raw = localStorage.getItem('leadgen_auth_user');
            return raw ? JSON.parse(raw) : null;
        } catch (_error) {
            return null;
        }
    }

    clearAuthForms() {
        document.getElementById('auth-login-form').reset();
        document.getElementById('auth-register-form').reset();
    }

    clearAuthStatus() {
        const el = document.getElementById('auth-status');
        el.style.display = 'none';
        el.className = 'auth-status';
        el.textContent = '';
    }

    setAuthStatus(type, message) {
        const el = document.getElementById('auth-status');
        el.style.display = 'block';
        el.className = `auth-status ${type}`;
        el.textContent = message;
    }

    async apiFetch(url, options = {}, config = {}) {
        const requiresAuth = config.requiresAuth !== false;
        const headers = new Headers(options.headers || {});

        if (requiresAuth) {
            if (!this.isAuthenticated()) {
                this.lockApp();
                const error = new Error('Authentication required.');
                error.userMessage = 'Please sign in to continue.';
                throw error;
            }

            headers.set('Authorization', `Bearer ${this.authToken}`);
        }

        let response;
        try {
            response = await fetch(url, {
                ...options,
                headers
            });
        } catch (error) {
            const fetchError = new Error(error.message || 'Unable to reach the server.');
            fetchError.userMessage = `Cannot reach the server at ${window.location.origin}. Make sure LeadGen Platform is running, then try again.`;
            throw fetchError;
        }

        if (response.status === 401) {
            this.clearSession();
            this.destroySocket();
            this.lockApp();
            const error = new Error('Your session expired.');
            error.userMessage = 'Your session expired. Please sign in again.';
            throw error;
        }

        if (response.status === 403) {
            const error = new Error('You do not have permission to perform this action.');
            error.userMessage = 'You do not have permission to perform this action.';
            throw error;
        }

        return response;
    }

    async apiJsonFetch(url, options = {}, config = {}) {
        const response = await this.apiFetch(url, options, config);
        const contentType = response.headers.get('content-type') || '';

        if (!contentType.includes('application/json')) {
            const fallbackError = new Error('The server returned an unexpected response.');
            fallbackError.userMessage = response.status >= 400
                ? 'The server returned an unexpected error response.'
                : 'The server returned an unexpected non-JSON response.';
            throw fallbackError;
        }

        const payload = await response.json();
        if (!response.ok) {
            const error = new Error(payload?.message || payload?.error || 'Request failed.');
            error.userMessage = payload?.message || payload?.error || 'Request failed.';
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    connectSocket() {
        if (!this.isAuthenticated()) {
            return;
        }

        this.destroySocket();
        this.socket = io({
            auth: {
                token: this.authToken
            }
        });

        this.socket.on('connect', () => {
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus(false);
        });

        this.socket.on('connect_error', () => {
            this.updateConnectionStatus(false, 'Socket auth failed');
        });

        this.socket.on('search:progress', (data) => this.onSearchProgress(data));
        this.socket.on('search:complete', (data) => this.onSearchComplete(data));
        this.socket.on('search:error', (data) => this.onSearchError(data));
        this.socket.on('lead:new', (lead) => this.onNewLead(lead));
        this.socket.on('lead:updated', (lead) => this.onLeadUpdated(lead));
        this.socket.on('lead:deleted', (data) => this.onLeadDeleted(data));
        this.socket.on('leads:cleared', () => this.onLeadsCleared());
        this.socket.on('crawl:start', (data) => this.onCrawlStart(data));
        this.socket.on('crawl:progress', (data) => this.onCrawlProgress(data));
        this.socket.on('crawl:complete', (data) => this.onCrawlComplete(data));
        this.socket.on('sitecrawl:start', (data) => this.onSiteCrawlStart(data));
        this.socket.on('sitecrawl:progress', (data) => this.onSiteCrawlProgress(data));
        this.socket.on('sitecrawl:complete', (data) => this.onSiteCrawlComplete(data));
        this.socket.on('outreach:manual-ready', (data) => this.onOutreachManualReady(data));
        this.socket.on('outreach:progress', (data) => this.onOutreachProgress(data));
        this.socket.on('outreach:complete', (data) => this.onOutreachComplete(data));
    }

    reconnectSocket() {
        if (!this.isAuthenticated()) {
            this.destroySocket();
            return;
        }

        this.connectSocket();
    }

    destroySocket() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
    }

    initMap() {
        this.map = L.map('map', {
            center: [39.8283, -98.5795],
            zoom: 4,
            zoomControl: true,
            attributionControl: true
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19
        }).addTo(this.map);

        this.drawnItems = new L.FeatureGroup();
        this.map.addLayer(this.drawnItems);

        this.markerGroup = L.featureGroup();
        this.map.addLayer(this.markerGroup);

        this.drawControl = new L.Control.Draw({
            position: 'topright',
            draw: {
                polygon: {
                    allowIntersection: false,
                    shapeOptions: {
                        color: '#7c6cf0',
                        weight: 2,
                        fillOpacity: 0.1,
                        fillColor: '#7c6cf0'
                    }
                },
                rectangle: {
                    shapeOptions: {
                        color: '#7c6cf0',
                        weight: 2,
                        fillOpacity: 0.1,
                        fillColor: '#7c6cf0'
                    }
                },
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false
            },
            edit: {
                featureGroup: this.drawnItems,
                remove: true
            }
        });
        this.map.addControl(this.drawControl);

        this.map.on(L.Draw.Event.CREATED, (e) => {
            this.drawnItems.clearLayers();
            this.drawnItems.addLayer(e.layer);
            this.onAreaDrawn(e.layer);
        });

        this.map.on(L.Draw.Event.DELETED, () => {
            this.currentBounds = null;
            this.currentPolygon = null;
            this.updateAreaStatus(false);
            this.validateSearchForm();
        });

        this.map.on(L.Draw.Event.EDITED, (e) => {
            e.layers.eachLayer((layer) => {
                this.onAreaDrawn(layer);
            });
        });
    }

    onAreaDrawn(layer) {
        if (layer instanceof L.Rectangle) {
            const bounds = layer.getBounds();
            this.currentBounds = [
                [bounds.getSouth(), bounds.getWest()],
                [bounds.getNorth(), bounds.getEast()]
            ];
            this.currentPolygon = null;
        } else if (layer instanceof L.Polygon) {
            const latlngs = layer.getLatLngs()[0];
            this.currentPolygon = latlngs.map(ll => [ll.lat, ll.lng]);
            const bounds = layer.getBounds();
            this.currentBounds = [
                [bounds.getSouth(), bounds.getWest()],
                [bounds.getNorth(), bounds.getEast()]
            ];
        }

        this.updateAreaStatus(true);
        this.validateSearchForm();
    }

    updateAreaStatus(ready) {
        const el = document.getElementById('area-status');
        if (ready) {
            el.className = 'area-status ready';
            el.innerHTML = '<i data-lucide="check-circle"></i><span>Search area selected</span>';
        } else {
            el.className = 'area-status';
            el.innerHTML = '<i data-lucide="alert-circle"></i><span>No area selected</span>';
        }
        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    validateSearchForm() {
        const keyword = document.getElementById('search-keyword').value.trim();
        const hasArea = !!this.currentBounds;
        const btn = document.getElementById('btn-start-search');
        btn.disabled = !(keyword && hasArea);
    }

    addMarkerToMap(lead) {
        if (!lead.lat || !lead.lng) return;

        const marker = L.circleMarker([lead.lat, lead.lng], {
            radius: 6,
            fillColor: lead.emails && lead.emails.length > 0 ? '#00d4aa' : '#7c6cf0',
            color: '#1a1d2e',
            weight: 2,
            fillOpacity: 0.9
        });

        const hasEmail = lead.emails && lead.emails.length > 0;
        const hasPhone = lead.phone || (lead.phones && lead.phones.length > 0);

        marker.bindPopup(`
            <div class="map-popup-title">${this.escapeHtml(lead.name)}</div>
            <div class="map-popup-category">${this.escapeHtml(lead.category || '')}</div>
            <div class="map-popup-info">
                ${lead.address ? `Address: ${this.escapeHtml(lead.address)}<br>` : ''}
                ${hasEmail ? `Email: ${this.escapeHtml(lead.emails[0])}<br>` : ''}
                ${hasPhone ? `Phone: ${this.escapeHtml(lead.phone || lead.phones[0])}<br>` : ''}
                ${lead.rating ? `Rating: ${lead.rating} (${lead.reviewCount || 0} reviews)` : ''}
            </div>
        `);

        this.markerGroup.addLayer(marker);
        this.markers.push(marker);
    }

    clearMapMarkers() {
        if (!this.markerGroup) return;
        this.markerGroup.clearLayers();
        this.markers = [];
    }

    async startSearch() {
        if (!this.ensureAuthenticated()) return;

        const keyword = document.getElementById('search-keyword').value.trim();
        const type = document.getElementById('search-type').value;
        const autoCrawl = document.getElementById('auto-crawl').checked;

        if (!keyword || !this.currentBounds) return;

        document.getElementById('search-progress').style.display = 'block';
        document.getElementById('btn-start-search').disabled = true;
        document.getElementById('progress-label').textContent = 'Initializing search...';
        document.getElementById('progress-count').textContent = '0';
        document.getElementById('progress-bar').style.width = '10%';

        const badge = document.getElementById('discover-badge');
        if (badge) badge.style.display = '';

        this.addActivity('search', `Started search for "<strong>${this.escapeHtml(keyword)}</strong>"`);

        try {
            const data = await this.apiJsonFetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keyword,
                    bounds: this.currentBounds,
                    polygon: this.currentPolygon,
                    type: type || undefined,
                    autoCrawl
                })
            });

            this.showToast('info', `Search started (Job: ${data.jobId})`);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to start search');
            document.getElementById('search-progress').style.display = 'none';
            document.getElementById('btn-start-search').disabled = false;
        }
    }

    onSearchProgress(data) {
        const { phase, lead, total, message } = data;

        document.getElementById('progress-count').textContent = total || '0';

        if (phase === 'grid') {
            document.getElementById('progress-label').textContent = 'Setting up search grid...';
            document.getElementById('progress-message').textContent = message || '';
            document.getElementById('progress-bar').style.width = '15%';
        } else if (phase === 'searching') {
            document.getElementById('progress-label').textContent = 'Scanning area...';
            document.getElementById('progress-message').textContent = message || '';
        } else if (phase === 'found' && lead) {
            document.getElementById('progress-label').textContent = `Found: ${lead.name}`;
            const progress = Math.min(90, 15 + (total / 5));
            document.getElementById('progress-bar').style.width = `${progress}%`;
        }
    }

    onSearchComplete(data) {
        document.getElementById('progress-bar').style.width = '100%';
        document.getElementById('progress-label').textContent = 'Search complete!';
        document.getElementById('progress-message').textContent =
            `Found ${data.totalFound} businesses.`;

        setTimeout(() => {
            document.getElementById('search-progress').style.display = 'none';
            document.getElementById('btn-start-search').disabled = false;
        }, 2000);

        const badge = document.getElementById('discover-badge');
        if (badge) badge.style.display = 'none';

        this.showToast('success', `Search complete! Found ${data.totalFound} businesses.`);
        this.addActivity('search', `Search complete - <strong>${data.totalFound}</strong> businesses found`);
        this.loadStats();
        this.loadLeads();
    }

    onSearchError(data) {
        document.getElementById('search-progress').style.display = 'none';
        document.getElementById('btn-start-search').disabled = false;

        const badge = document.getElementById('discover-badge');
        if (badge) badge.style.display = 'none';

        this.showToast('error', `Search error: ${data.error}`);
        this.addActivity('error', `Search error: ${data.error}`);
    }

    onNewLead(lead) {
        this.upsertLeadInMemory(lead, { prepend: true });
        this.addMarkerToMap(lead);
        document.getElementById('leads-count').textContent = this.leads.length;
        this.renderRecentLeads();

        if (this.currentView === 'leads') {
            this.renderLeadsTable();
        }

        const prefix = lead.emails && lead.emails.length > 0 ? 'Email' : 'Lead';
        this.addActivity('lead', `${prefix}: <strong>${this.escapeHtml(lead.name)}</strong>`);
        this.scheduleStatsRefresh();
    }

    onLeadUpdated(lead) {
        this.upsertLeadInMemory(lead);

        if (this.currentView === 'leads') {
            this.renderLeadsTable();
        }
        this.renderRecentLeads();

        if (lead.crawled) {
            const contactSummary = this.buildContactSummary(lead);
            if (contactSummary) {
                this.addActivity('email', `${contactSummary} on <strong>${this.escapeHtml(lead.name)}</strong>`);
            }
        }

        this.scheduleStatsRefresh();
    }

    onLeadDeleted(data) {
        this.leads = this.leads.filter(l => l.id !== data.id && l._id !== data.id);
        this.renderLeadsTable();
        this.loadStats();
    }

    onLeadsCleared() {
        this.leads = [];
        this.renderLeadsTable();
        this.clearMapMarkers();
        this.loadStats();
    }

    onCrawlStart(data) {
        document.getElementById('crawl-progress-wrapper').style.display = 'block';
        document.getElementById('crawl-progress-count').textContent = '0%';
        document.getElementById('crawl-progress-bar').style.width = '0%';
        document.getElementById('crawl-meta').textContent = `0 of ${data.total} sites processed`;
        this.addActivity('crawl', `Started crawl job ${data.jobId}`);
    }

    onCrawlProgress(data) {
        document.getElementById('crawl-progress-count').textContent = `${data.percent}%`;
        document.getElementById('crawl-progress-bar').style.width = `${data.percent}%`;
        const liveSummary = data.lead ? this.buildContactSummary(data.lead) : '';
        document.getElementById('crawl-meta').textContent = liveSummary
            ? `${data.completed} of ${data.total} sites processed - ${this.escapeTextContent(data.lead.name || data.lead.website || 'Current site')}: ${liveSummary}`
            : `${data.completed} of ${data.total} sites processed`;

        if (data.lead) {
            this.onLeadUpdated(data.lead);
        }
    }

    onCrawlComplete(data) {
        document.getElementById('crawl-progress-count').textContent = '100%';
        document.getElementById('crawl-progress-bar').style.width = '100%';
        document.getElementById('crawl-meta').textContent = `${data.completed} of ${data.total} sites processed`;
        this.addActivity('crawl', `Completed crawl job ${data.jobId}`);
        this.loadLeads();
        this.loadStats();
    }

    onSiteCrawlStart(data) {
        this.siteCrawlResults = [];
        this.renderSiteCrawlResults();
        document.getElementById('btn-download-site-results').disabled = true;
        document.getElementById('site-crawl-progress-wrapper').style.display = 'block';
        document.getElementById('site-crawl-progress-count').textContent = '0%';
        document.getElementById('site-crawl-progress-bar').style.width = '0%';
        document.getElementById('site-crawl-meta').textContent = `0 of ${data.total} sites processed`;
        this.addActivity('crawl', `Started uploaded site crawl for ${data.total} site(s)`);
    }

    onSiteCrawlProgress(data) {
        if (data.result) {
            this.upsertSiteCrawlResult(data.result);
            this.renderSiteCrawlResults();
        }

        document.getElementById('site-crawl-progress-count').textContent = `${data.percent}%`;
        document.getElementById('site-crawl-progress-bar').style.width = `${data.percent}%`;
        const liveSummary = data.result ? this.buildContactSummary(data.result) : '';
        document.getElementById('site-crawl-meta').textContent = liveSummary
            ? `${data.completed} of ${data.total} sites processed - ${this.escapeTextContent(data.result.normalizedUrl || data.result.site || 'Current site')}: ${liveSummary}`
            : `${data.completed} of ${data.total} sites processed`;

        if (data.result && liveSummary) {
            this.addActivity('crawl', `${this.escapeHtml(data.result.normalizedUrl || data.result.site || 'Site')} yielded ${liveSummary}`);
        }
    }

    onSiteCrawlComplete(data) {
        this.mergeSiteCrawlResults(data.results || []);
        this.activeSiteCrawlJobId = data.jobId;
        document.getElementById('site-crawl-progress-count').textContent = '100%';
        document.getElementById('site-crawl-progress-bar').style.width = '100%';
        document.getElementById('site-crawl-meta').textContent = `${data.completed} of ${data.total} sites processed`;
        document.getElementById('btn-download-site-results').disabled = !this.activeSiteCrawlJobId;
        this.renderSiteCrawlResults();
        this.addActivity('crawl', `Completed uploaded site crawl for ${data.completed} site(s)`);
    }

    async startCrawl() {
        if (!this.ensureAuthenticated()) return;

        try {
            const data = await this.apiJsonFetch('/api/crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            this.showToast('info', `Crawl started (Job: ${data.jobId})`);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to start crawl');
        }
    }

    async crawlSingleUrlTable() {
        if (!this.ensureAuthenticated()) return;

        const input = document.getElementById('single-crawl-url');
        const url = input.value.trim();
        if (!url) return;

        try {
            this.renderSingleCrawlStatus('loading', `Crawling ${this.escapeHtml(url)}...`);
            const response = await this.apiJsonFetch('/api/crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const result = response.result || response;
            this.singleCrawlResults.unshift({
                site: url,
                normalizedUrl: result.url,
                emails: result.emails || [],
                phones: result.phones || [],
                pagesScanned: result.pagesScanned || 0,
                status: result.error ? 'error' : 'completed',
                error: result.error || ''
            });

            this.renderSingleCrawlResults();
            this.renderSingleCrawlStatus(
                result.error ? 'error' : 'success',
                result.error
                    ? `Crawl finished with an error: ${this.escapeHtml(result.error)}`
                    : `Live result: ${this.buildContactSummary(result) || 'no public email or phone found yet'}`
            );
            this.showToast('success', 'Single site crawl complete.');
        } catch (err) {
            this.renderSingleCrawlStatus('error', this.escapeHtml(err.userMessage || 'Single site crawl failed'));
            this.showToast('error', err.userMessage || 'Single site crawl failed');
        }
    }

    async onSitesFileSelected(event) {
        const file = event.target.files?.[0];
        const summary = document.getElementById('site-upload-summary');

        if (!file) {
            this.siteUploadRows = [];
            summary.innerHTML = `
                <div class="empty-state-mini">
                    <i data-lucide="files"></i>
                    <p>Select a CSV file to preview how many sites are ready.</p>
                </div>
            `;
            lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
            return;
        }

        const text = await file.text();
        const rows = text
            .split(/\r?\n/)
            .map((row) => row.trim())
            .filter(Boolean);

        if (!rows.length) {
            this.siteUploadRows = [];
            summary.innerHTML = '<p class="site-upload-note error">The selected CSV file is empty.</p>';
            return;
        }

        const header = rows[0].split(',').map((item) => item.trim().toLowerCase());
        const siteIndex = header.indexOf('sites');
        if (siteIndex === -1) {
            this.siteUploadRows = [];
            summary.innerHTML = '<p class="site-upload-note error">Required column "sites" was not found in the CSV file.</p>';
            return;
        }

        this.siteUploadRows = rows.slice(1)
            .map((row) => row.split(',')[siteIndex]?.trim())
            .filter(Boolean);

        summary.innerHTML = `
            <p class="site-upload-note"><strong>${this.siteUploadRows.length}</strong> sites are ready to crawl.</p>
            <div class="site-pill-list">
                ${this.siteUploadRows.slice(0, 12).map((site) => `<span class="site-pill">${this.escapeHtml(site)}</span>`).join('')}
            </div>
        `;
    }

    async startSiteUploadCrawl() {
        if (!this.ensureAuthenticated()) return;

        if (!this.siteUploadRows.length) {
            this.showToast('error', 'Upload a CSV file with a sites column first.');
            return;
        }

        try {
            const data = await this.apiJsonFetch('/api/site-crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sites: this.siteUploadRows })
            });

            this.siteCrawlResults = [];
            this.renderSiteCrawlResults();
            this.activeSiteCrawlJobId = data.jobId;
            document.getElementById('site-crawl-progress-wrapper').style.display = 'block';
            document.getElementById('site-crawl-progress-count').textContent = '0%';
            document.getElementById('site-crawl-progress-bar').style.width = '0%';
            document.getElementById('site-crawl-meta').textContent = `Starting crawl for ${data.total} sites...`;
            document.getElementById('btn-download-site-results').disabled = true;
            this.showToast('info', `Site crawl started (Job: ${data.jobId})`);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to start site crawl');
        }
    }

    async downloadSiteCrawlResults() {
        if (!this.ensureAuthenticated()) return;
        if (!this.activeSiteCrawlJobId) return;

        try {
            const response = await this.apiFetch(`/api/site-crawl/export/${this.activeSiteCrawlJobId}?format=csv`);
            const blob = await response.blob();
            this.downloadBlob(blob, `${this.activeSiteCrawlJobId}.csv`);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Download failed');
        }
    }

    async startLinkedinSearch() {
        if (!this.ensureAuthenticated()) return;

        const keyword = document.getElementById('linkedin-keyword').value;
        const category = document.getElementById('linkedin-category').value;
        const limit = Number.parseInt(document.getElementById('linkedin-limit').value, 10) || 50;

        try {
            const data = await this.apiJsonFetch('/api/linkedin/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword, category, limit })
            });

            this.linkedinResults = data.results || [];
            this.renderLinkedinResults();
            this.showToast('success', `LinkedIn search returned ${this.linkedinResults.length} result(s).`);
        } catch (err) {
            this.showToast('error', err.userMessage || 'LinkedIn search failed');
        }
    }

    async loadLinkedinAuthStatus() {
        if (!this.isAuthenticated()) return;

        try {
            const data = await this.apiJsonFetch('/api/linkedin/auth/status');
            this.linkedinAuthStatus = data.status || data;
            this.renderLinkedinStatus(this.linkedinAuthStatus);
        } catch (err) {
            this.renderLinkedinStatus({
                configured: false,
                connected: false,
                error: err.userMessage || err.message
            });
        }
    }

    renderLinkedinStatus(data) {
        const statusEl = document.getElementById('linkedin-status');
        if (!statusEl) return;

        if (!this.isAuthenticated()) {
            statusEl.innerHTML = `
                <div class="empty-state-mini">
                    <i data-lucide="lock"></i>
                    <p>Sign in to configure LinkedIn connectivity.</p>
                </div>
            `;
            lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
            return;
        }

        if (data.error) {
            statusEl.innerHTML = `<p class="linkedin-status-note error">${this.escapeHtml(data.error)}</p>`;
            return;
        }

        if (!data.configured) {
            statusEl.innerHTML = `<p class="linkedin-status-note error">LinkedIn OAuth is not configured yet on the server.</p>`;
            return;
        }

        if (data.connected) {
            statusEl.innerHTML = `
                <p class="linkedin-status-note">
                    LinkedIn is connected.<br>
                    Token expires: <strong>${this.escapeHtml(data.expiresAt || 'unknown')}</strong><br>
                    Authorized scopes: <strong>${this.escapeHtml(data.scopes || '')}</strong>
                </p>
            `;
            return;
        }

        statusEl.innerHTML = `
            <p class="linkedin-status-note">
                LinkedIn OAuth is configured but not connected yet.<br>
                Use <strong>Connect LinkedIn</strong> to authorize this app.
            </p>
        `;
    }

    async loadStats() {
        if (!this.isAuthenticated()) return;

        try {
            const data = await this.apiJsonFetch('/api/stats');
            const stats = data.stats || data;

            document.getElementById('stat-total').textContent = this.formatNumber(stats.total || 0);
            document.getElementById('stat-emails').textContent = this.formatNumber(stats.with_email || stats.withEmail || 0);
            document.getElementById('stat-phones').textContent = this.formatNumber(stats.with_phone || stats.withPhone || 0);
            document.getElementById('stat-websites').textContent = this.formatNumber(stats.with_website || stats.withWebsite || 0);
            document.getElementById('stat-crawled').textContent = this.formatNumber(stats.crawled || 0);
            document.getElementById('stat-rating').textContent = stats.avg_rating || stats.avgRating || '-';
            document.getElementById('leads-count').textContent = this.formatNumber(stats.total || 0);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to load stats');
        }
    }

    async loadLeads() {
        if (!this.isAuthenticated()) return;

        const params = new URLSearchParams({
            page: String(this.currentPage),
            limit: '100'
        });

        if (this.filterKeyword) params.set('keyword', this.filterKeyword);
        if (this.sortBy) params.set('sortBy', this.sortBy);
        if (this.sortDir) params.set('sortDir', this.sortDir);

        if (this.currentFilter === 'emails') params.set('hasEmail', 'true');
        if (this.currentFilter === 'phones') params.set('hasPhone', 'true');
        if (this.currentFilter === 'websites') params.set('hasWebsite', 'true');
        if (this.currentFilter === 'crawled') params.set('crawled', 'true');

        try {
            const data = await this.apiJsonFetch(`/api/leads?${params.toString()}`);
            this.leads = data.leads || [];
            this.totalPages = data.totalPages || 1;
            this.renderLeadsTable();
            this.renderRecentLeads();
            this.updatePagination(data);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to load leads');
        }
    }

    renderRecentLeads() {
        const container = document.getElementById('recent-leads-table');
        const recent = this.leads.slice(0, 8);

        if (!recent.length) {
            container.innerHTML = `
                <div class="empty-state-mini">
                    <i data-lucide="inbox"></i>
                    <p>No leads yet. Start a search to discover businesses.</p>
                </div>
            `;
            lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Contact</th>
                    </tr>
                </thead>
                <tbody>
                    ${recent.map((lead) => `
                        <tr>
                            <td>${this.escapeHtml(lead.name || '')}</td>
                            <td>${this.escapeHtml(lead.category || 'N/A')}</td>
                            <td>${this.escapeHtml((lead.emails && lead.emails[0]) || lead.phone || (lead.phones && lead.phones[0]) || 'N/A')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    renderLeadsTable() {
        const tbody = document.getElementById('leads-tbody');
        const empty = document.getElementById('leads-empty');

        if (!tbody || !empty) return;

        if (!this.leads.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            document.getElementById('leads-total-display').textContent = '0 leads';
            lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
            return;
        }

        empty.style.display = 'none';
        document.getElementById('leads-total-display').textContent = `${this.leads.length} leads`;

        tbody.innerHTML = this.leads.map(lead => {
            const hasEmails = lead.emails && lead.emails.length > 0;
            const hasPhones = (lead.phones && lead.phones.length > 0) || lead.phone;
            const leadId = lead.id || lead._id;

            return `
                <tr class="lead-row" data-id="${leadId}">
                    <td class="th-check">
                        <input type="checkbox" class="lead-checkbox" data-id="${leadId}">
                    </td>
                    <td>
                        <div class="lead-name-cell">
                            <span class="lead-name" style="cursor:pointer" onclick="app.showLeadDetail('${leadId}')">${this.escapeHtml(lead.name)}</span>
                            <span class="lead-address">${this.escapeHtml(lead.address || '')}</span>
                        </div>
                    </td>
                    <td>
                        <span class="category-badge">${this.escapeHtml(lead.category || 'N/A')}</span>
                    </td>
                    <td>
                        <div class="contact-cell">
                            ${hasEmails
                                ? lead.emails.slice(0, 2).map(e =>
                                    `<span class="contact-item email"><i data-lucide="mail"></i> ${this.escapeHtml(e)}</span>`
                                ).join('')
                                : '<span class="contact-item no-data"><i data-lucide="mail-x"></i> No email</span>'
                            }
                            ${hasPhones
                                ? `<span class="contact-item phone"><i data-lucide="phone"></i> ${this.escapeHtml(lead.phone || lead.phones[0])}</span>`
                                : ''
                            }
                        </div>
                    </td>
                    <td>
                        ${lead.website
                            ? `<a href="${this.escapeHtml(lead.website)}" target="_blank" class="website-link"><i data-lucide="external-link"></i> ${this.truncateUrl(lead.website)}</a>`
                            : '<span style="color:var(--text-muted)">-</span>'
                        }
                    </td>
                    <td>
                        ${lead.rating
                            ? `<div class="rating-cell"><i data-lucide="star" class="rating-star"></i> ${lead.rating} <span class="rating-reviews">(${lead.reviewCount || 0})</span></div>`
                            : '<span style="color:var(--text-muted)">-</span>'
                        }
                    </td>
                    <td>
                        ${lead.crawled
                            ? (lead.crawlStatus === 'error'
                                ? '<span class="status-badge status-error"><i data-lucide="alert-circle"></i> Error</span>'
                                : '<span class="status-badge status-crawled"><i data-lucide="check-circle"></i> Crawled</span>')
                            : '<span class="status-badge status-pending"><i data-lucide="clock"></i> Pending</span>'
                        }
                    </td>
                    <td>
                        <div class="table-actions">
                            <button class="btn-icon" onclick="app.showLeadDetail('${leadId}')" title="View details">
                                <i data-lucide="eye"></i>
                            </button>
                            ${lead.website && !lead.crawled
                                ? `<button class="btn-icon" onclick="app.crawlLead('${leadId}')" title="Crawl website"><i data-lucide="scan"></i></button>`
                                : ''
                            }
                            <button class="btn-icon" onclick="app.deleteLead('${leadId}')" title="Delete">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    renderSiteCrawlResults() {
        const tbody = document.getElementById('site-results-tbody');
        const empty = document.getElementById('site-results-empty');

        if (!this.siteCrawlResults.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        tbody.innerHTML = this.siteCrawlResults.map((result) => `
            <tr>
                <td>${this.escapeHtml(result.normalizedUrl || result.site || '')}</td>
                <td>${(result.emails || []).map((item) => this.escapeHtml(item)).join('<br>') || '-'}</td>
                <td>${(result.phones || []).map((item) => this.escapeHtml(item)).join('<br>') || '-'}</td>
                <td>${result.pagesScanned || 0}</td>
                <td>${this.renderStatusBadge(result.status || '-', result.error)}</td>
            </tr>
        `).join('');
        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    renderSingleCrawlResults() {
        const tbody = document.getElementById('single-crawl-results-tbody');
        const empty = document.getElementById('single-crawl-results-empty');

        if (!this.singleCrawlResults.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        tbody.innerHTML = this.singleCrawlResults.map((result) => `
            <tr>
                <td>${this.escapeHtml(result.normalizedUrl || result.site || '')}</td>
                <td>${(result.emails || []).map((item) => this.escapeHtml(item)).join('<br>') || '-'}</td>
                <td>${(result.phones || []).map((item) => this.escapeHtml(item)).join('<br>') || '-'}</td>
                <td>${result.pagesScanned || 0}</td>
                <td>${this.renderStatusBadge(result.status || '-', result.error)}</td>
            </tr>
        `).join('');
        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    renderLinkedinResults() {
        const tbody = document.getElementById('linkedin-results-tbody');
        const empty = document.getElementById('linkedin-results-empty');

        if (!this.linkedinResults.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        tbody.innerHTML = this.linkedinResults.map((result) => `
            <tr>
                <td>${this.escapeHtml(result.name || '')}</td>
                <td>${this.escapeHtml(result.title || '')}</td>
                <td>${this.escapeHtml(result.category || '')}</td>
                <td>${this.escapeHtml(result.company || '')}</td>
                <td>${this.escapeHtml(result.contact || result.email || '')}</td>
                <td>${this.escapeHtml(result.source || '')}</td>
            </tr>
        `).join('');
    }

    async loadOutreachOverview() {
        await Promise.all([
            this.loadOutreachConfig(),
            this.loadOutreachCampaigns()
        ]);
    }

    async loadOutreachConfig() {
        if (!this.isAuthenticated()) return;

        try {
            const data = await this.apiJsonFetch('/api/outreach/config');
            this.outreachConfig = data.config || {};
            this.populateOutreachConfigForm();
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to load outreach config');
        }
    }

    populateOutreachConfigForm() {
        const config = this.outreachConfig || {};
        document.getElementById('outreach-smtp-host').value = config.smtpHost || '';
        document.getElementById('outreach-smtp-port').value = config.smtpPort || 587;
        document.getElementById('outreach-smtp-secure').checked = Boolean(config.smtpSecure);
        document.getElementById('outreach-smtp-user').value = config.smtpUser || '';
        document.getElementById('outreach-smtp-pass').value = '';
        document.getElementById('outreach-from-email').value = config.fromEmail || '';
        document.getElementById('outreach-from-name').value = config.fromName || '';
        document.getElementById('outreach-openai-key').value = '';
        document.getElementById('outreach-openai-model').value = config.openAiModel || 'gpt-5-mini';
        document.getElementById('outreach-ai-prompt').value = config.aiPrompt || '';
    }

    async saveOutreachConfig() {
        if (!this.ensureAuthenticated()) return;

        const payload = {
            smtpHost: document.getElementById('outreach-smtp-host').value.trim(),
            smtpPort: Number(document.getElementById('outreach-smtp-port').value || 587),
            smtpSecure: document.getElementById('outreach-smtp-secure').checked,
            smtpUser: document.getElementById('outreach-smtp-user').value.trim(),
            smtpPass: document.getElementById('outreach-smtp-pass').value,
            fromEmail: document.getElementById('outreach-from-email').value.trim(),
            fromName: document.getElementById('outreach-from-name').value.trim(),
            openAiApiKey: document.getElementById('outreach-openai-key').value.trim(),
            openAiModel: document.getElementById('outreach-openai-model').value.trim(),
            aiPrompt: document.getElementById('outreach-ai-prompt').value.trim()
        };

        Object.keys(payload).forEach((key) => {
            if (payload[key] === '' || payload[key] === null) {
                delete payload[key];
            }
        });

        try {
            const data = await this.apiJsonFetch('/api/outreach/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            this.outreachConfig = data.config || {};
            const status = document.getElementById('outreach-config-status');
            status.style.display = 'block';
            status.className = 'settings-status success';
            status.textContent = 'Mail configuration saved successfully.';
            this.populateOutreachConfigForm();
            this.showToast('success', 'Outreach configuration saved');
        } catch (err) {
            const status = document.getElementById('outreach-config-status');
            status.style.display = 'block';
            status.className = 'settings-status error';
            status.textContent = err.userMessage || 'Failed to save mail configuration';
            this.showToast('error', err.userMessage || 'Failed to save mail configuration');
        }
    }

    async onOutreachFileSelected(event) {
        const file = event.target.files?.[0];
        if (!file) {
            this.outreachUploadRows = [];
            this.outreachRejectedEmails = [];
            this.outreachUploadMeta = {
                totalCount: 0,
                validCount: 0,
                duplicateCount: 0,
                invalidCount: 0,
                suspiciousCount: 0
            };
            this.renderOutreachUploadSummary();
            return;
        }

        try {
            const text = await file.text();
            const columnKey = document.getElementById('outreach-email-column').value.trim() || 'email';
            const parsed = this.parseRecipientCsv(text, columnKey);
            this.outreachUploadRows = parsed.rows;
            this.outreachUploadMeta = parsed.meta;
            this.outreachRejectedEmails = parsed.rejectedEmails || [];
            this.renderOutreachUploadSummary();
            const invalidFoundCount = (parsed.meta.invalidCount || 0) + (parsed.meta.suspiciousCount || 0);
            const summaryMessage = invalidFoundCount
                ? `${parsed.meta.validCount} valid recipient emails loaded, ${invalidFoundCount} invalid emails found`
                : `${parsed.meta.validCount} recipient emails loaded`;
            this.showToast('success', summaryMessage);
        } catch (err) {
            this.outreachUploadRows = [];
            this.outreachUploadMeta = {
                totalCount: 0,
                validCount: 0,
                duplicateCount: 0,
                invalidCount: 0,
                suspiciousCount: 0
            };
            this.outreachRejectedEmails = [];
            this.renderOutreachUploadSummary(err.message || 'Failed to parse CSV');
            this.showToast('error', err.message || 'Failed to parse CSV');
        }
    }

    parseRecipientCsv(text, columnKey) {
        const lines = String(text || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (lines.length < 2) {
            throw new Error('CSV must include a header row and at least one email row.');
        }

        const headers = this.parseCsvLine(lines[0]).map((item) => item.trim().toLowerCase());
        const key = String(columnKey || 'email').trim().toLowerCase();
        const emailIndex = headers.indexOf(key);
        if (emailIndex === -1) {
            throw new Error(`CSV column "${columnKey}" was not found.`);
        }

        const seen = new Set();
        const draftRows = [];
        const rejectedEmails = [];
        let invalidCount = 0;
        let duplicateCount = 0;

        for (let index = 1; index < lines.length; index += 1) {
            const row = this.parseCsvLine(lines[index]);
            const rawEmail = String(row[emailIndex] || '').trim().toLowerCase();
            const email = this.normalizeRecipientEmail(rawEmail);
            if (!rawEmail) {
                invalidCount += 1;
                continue;
            }

            if (!email) {
                invalidCount += 1;
                rejectedEmails.push(rawEmail);
                draftRows.push({
                    email: rawEmail,
                    originalEmail: rawEmail,
                    normalizedEmail: '',
                    isValid: false,
                    reason: 'invalid-format'
                });
                continue;
            }

            if (seen.has(email)) {
                duplicateCount += 1;
                continue;
            }

            seen.add(email);
            draftRows.push({
                email,
                originalEmail: rawEmail,
                normalizedEmail: email,
                isValid: true,
                reason: ''
            });
        }

        const filtered = this.flagSuspiciousRecipientEmails(draftRows);
        const validCount = filtered.rows.filter((item) => item.isValid).length;

        if (!validCount) {
            throw new Error('No valid email addresses were found in the CSV.');
        }

        return {
            rows: filtered.rows,
            meta: {
                totalCount: filtered.rows.length,
                validCount,
                duplicateCount,
                invalidCount,
                suspiciousCount: filtered.suspiciousCount
            },
            rejectedEmails: [...new Set([...(rejectedEmails || []), ...(filtered.rejectedEmails || [])])]
        };
    }

    normalizeRecipientEmail(value) {
        const email = this.decodeRecipientValue(value)
            .trim()
            .toLowerCase()
            .replace(/^[<("'`\s]+|[>)"'`.,;:\s]+$/g, '');

        if (!email || email.length > 255 || email.includes(' ')) {
            return '';
        }

        if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}$/i.test(email)) {
            return '';
        }

        const parts = email.split('@');
        if (parts.length !== 2) {
            return '';
        }

        const local = parts[0];
        const domain = parts[1];
        if (!local || local.length > 64) {
            return '';
        }

        if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
            return '';
        }

        if (domain.includes('..')) {
            return '';
        }

        const labels = domain.split('.');
        if (labels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))) {
            return '';
        }

        return email;
    }

    decodeRecipientValue(value) {
        const raw = String(value || '');
        try {
            return decodeURIComponent(raw);
        } catch (_error) {
            return raw;
        }
    }

    flagSuspiciousRecipientEmails(rows) {
        const domains = new Set(rows.map((item) => this.getRecipientDomain(item.email)).filter(Boolean));
        const filteredRows = [];
        const rejectedEmails = [];
        let suspiciousCount = 0;

        for (const row of rows) {
            if (!row.isValid) {
                filteredRows.push(row);
                continue;
            }

            if (this.isSuspiciousRecipientEmail(row.normalizedEmail || row.email, domains)) {
                suspiciousCount += 1;
                rejectedEmails.push(row.email);
                filteredRows.push({
                    ...row,
                    isValid: false,
                    reason: 'suspicious'
                });
                continue;
            }

            filteredRows.push(row);
        }

        return {
            rows: filteredRows,
            suspiciousCount,
            rejectedEmails
        };
    }

    getRecipientDomain(email) {
        const parts = String(email || '').split('@');
        return parts.length === 2 ? parts[1] : '';
    }

    isSuspiciousRecipientEmail(email, domains) {
        const domain = this.getRecipientDomain(email);
        if (!domain) {
            return true;
        }

        const suspiciousBases = ['.com', '.co', '.net', '.org', '.io', '.ae', '.ai', '.app', '.dev'];
        return suspiciousBases.some((suffix) => {
            if (!domain.includes(suffix)) {
                return false;
            }

            const markerIndex = domain.indexOf(suffix);
            if (markerIndex === -1) {
                return false;
            }

            const exactDomain = domain.slice(0, markerIndex + suffix.length);
            const trailing = domain.slice(markerIndex + suffix.length);

            if (!trailing || !/^[a-z]{1,24}$/.test(trailing)) {
                return false;
            }

            return domains.has(exactDomain);
        });
    }

    cleanOutreachEmails() {
        if (!this.ensureAuthenticated()) return;

        if (!this.outreachUploadRows.length) {
            this.showToast('info', 'Upload recipient emails first.');
            return;
        }

        const invalidRows = this.getOutreachInvalidRows();
        const removedCount = invalidRows.length;

        if (!removedCount) {
            this.showToast('info', 'No invalid emails were found in the current list.');
            return;
        }

        this.outreachRejectedEmails = [
            ...new Set([
                ...(this.outreachRejectedEmails || []),
                ...invalidRows.map((item) => item.email).filter(Boolean)
            ])
        ];
        this.outreachUploadRows = this.getOutreachValidRows();
        this.outreachUploadMeta = {
            totalCount: this.outreachUploadRows.length,
            validCount: this.outreachUploadRows.length,
            duplicateCount: this.outreachUploadMeta?.duplicateCount || 0,
            invalidCount: 0,
            suspiciousCount: 0
        };
        this.renderOutreachUploadSummary();

        this.showToast('success', `${removedCount} invalid emails removed. You can create the campaign now.`);
    }

    parseCsvLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let index = 0; index < line.length; index += 1) {
            const char = line[index];
            const next = line[index + 1];

            if (char === '"' && inQuotes && next === '"') {
                current += '"';
                index += 1;
                continue;
            }

            if (char === '"') {
                inQuotes = !inQuotes;
                continue;
            }

            if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
                continue;
            }

            current += char;
        }

        values.push(current);
        return values;
    }

    renderOutreachUploadSummary(errorMessage = '') {
        const summary = document.getElementById('outreach-upload-summary');

        if (errorMessage) {
            summary.innerHTML = `<p class="site-upload-note error">${this.escapeHtml(errorMessage)}</p>`;
            return;
        }

        if (!this.outreachUploadRows.length) {
            summary.innerHTML = `
                <div class="empty-state-mini">
                    <i data-lucide="files"></i>
                    <p>Upload a CSV to preview how many recipient emails are ready.</p>
                </div>
            `;
            lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
            return;
        }

        const meta = this.outreachUploadMeta || {};
        const validRows = this.getOutreachValidRows();
        const invalidRows = this.getOutreachInvalidRows();
        const currentInvalidCount = invalidRows.length;
        const rejectedMarkup = currentInvalidCount
            ? `
                <div class="site-upload-rejected">
                    <p class="site-upload-note"><strong>Invalid emails found (${currentInvalidCount})</strong></p>
                    <div class="site-pill-list">
                        ${invalidRows.slice(0, 30).map((row) => `<span class="site-pill site-pill-rejected">${this.escapeHtml(row.email)}</span>`).join('')}
                    </div>
                </div>
            `
            : this.outreachRejectedEmails.length
                ? `
                    <div class="site-upload-rejected">
                        <p class="site-upload-note"><strong>Removed invalid emails (${this.outreachRejectedEmails.length})</strong></p>
                        <div class="site-pill-list">
                            ${this.outreachRejectedEmails.slice(0, 30).map((email) => `<span class="site-pill site-pill-rejected">${this.escapeHtml(email)}</span>`).join('')}
                        </div>
                    </div>
                `
                : '';
        summary.innerHTML = `
            <p class="site-upload-note"><strong>${meta.totalCount || this.outreachUploadRows.length}</strong> unique emails loaded from CSV.</p>
            <p class="site-upload-note"><strong>${validRows.length}</strong> emails are valid and ready for outreach.</p>
            ${currentInvalidCount
                ? `<p class="site-upload-note">${currentInvalidCount} invalid or suspicious emails are still in the draft. Click <strong>Remove Invalid Emails</strong> to clean them in one click.</p>`
                : '<p class="site-upload-note">All emails in the current draft are clean and ready for campaign creation.</p>'
            }
            ${(meta.duplicateCount || 0)
                ? `<p class="site-upload-note">${meta.duplicateCount} duplicate emails were skipped while reading the CSV.</p>`
                : ''
            }
            <div class="site-pill-list">
                ${validRows.slice(0, 12).map((row) => `<span class="site-pill">${this.escapeHtml(row.email)}</span>`).join('')}
            </div>
            ${rejectedMarkup}
        `;
        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    async createOutreachCampaign() {
        if (!this.ensureAuthenticated()) return;

        if (!this.outreachUploadRows.length) {
            this.showToast('error', 'Upload a CSV with an email column first.');
            return;
        }

        const payload = {
            name: document.getElementById('outreach-campaign-name').value.trim() || `Campaign ${new Date().toLocaleDateString()}`,
            mode: document.getElementById('outreach-mode').value,
            niche: document.getElementById('outreach-niche').value.trim(),
            subjectTemplate: document.getElementById('outreach-subject-template').value.trim(),
            messageTemplate: document.getElementById('outreach-message-template').value.trim(),
            uploadedEmails: this.outreachUploadRows.map((item) => item.originalEmail || item.email),
            invalidEmails: this.getOutreachInvalidRows().map((item) => item.email),
            recipients: this.getOutreachValidRows().map((item) => ({ email: item.normalizedEmail || item.email }))
        };

        if (!payload.name) {
            this.showToast('error', 'Campaign Name is required.');
            return;
        }

        if (!['manual', 'ai'].includes(payload.mode)) {
            this.showToast('error', 'Choose a valid Sending Mode.');
            return;
        }

        if (!payload.niche) {
            this.showToast('error', 'Niche / Context is required.');
            return;
        }

        if (!payload.recipients.length) {
            this.showToast('error', 'No valid recipient emails are ready for outreach.');
            return;
        }

        if (!payload.subjectTemplate) {
            delete payload.subjectTemplate;
        }

        if (!payload.messageTemplate) {
            delete payload.messageTemplate;
        }

        try {
            const data = await this.apiJsonFetch('/api/outreach/campaigns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            this.upsertOutreachCampaign(data.campaign);
            this.activeOutreachCampaignId = data.campaign.id;
            this.renderOutreachCampaigns();

            if (data.campaign.mode === 'manual') {
                this.currentManualCampaign = data.campaign;
                this.currentManualRecipient = data.nextRecipient;
                this.renderManualOutreachState();
                document.getElementById('btn-start-ai-campaign').disabled = true;
            } else {
                this.currentManualCampaign = null;
                this.currentManualRecipient = null;
                this.renderManualOutreachState();
                document.getElementById('btn-start-ai-campaign').disabled = false;
            }

            const invalidCount = payload.invalidEmails.length;
            this.showToast('success', invalidCount
                ? `Outreach campaign created with ${payload.recipients.length} valid emails. ${invalidCount} invalid emails were saved in campaign JSON.`
                : 'Outreach campaign created');
        } catch (err) {
            const fieldError = err.payload?.details?.fieldErrors
                ? Object.entries(err.payload.details.fieldErrors)
                    .flatMap(([field, messages]) => (messages || []).map((message) => `${field}: ${message}`))
                    .join(' | ')
                : '';
            this.showToast('error', err.userMessage || fieldError || 'Failed to create outreach campaign');
        }
    }

    async loadOutreachCampaigns() {
        if (!this.isAuthenticated()) return;

        try {
            const data = await this.apiJsonFetch('/api/outreach/campaigns');
            this.outreachCampaigns = data.campaigns || [];
            this.renderOutreachCampaigns();

            const active = this.activeOutreachCampaignId
                ? this.outreachCampaigns.find((item) => item.id === this.activeOutreachCampaignId)
                : null;
            if (active && active.mode === 'manual') {
                this.currentManualCampaign = active;
                this.currentManualRecipient = active.recipients.find((entry) => entry.id === active.currentRecipientId)
                    || active.recipients.find((entry) => entry.status !== 'sent')
                    || null;
                this.renderManualOutreachState();
            }
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to load outreach campaigns');
        }
    }

    renderOutreachCampaigns() {
        const tbody = document.getElementById('outreach-campaigns-tbody');
        const empty = document.getElementById('outreach-campaigns-empty');

        if (!this.outreachCampaigns.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'block';
        empty.style.display = 'none';
        tbody.innerHTML = this.outreachCampaigns.map((campaign) => `
            <tr>
                <td>${this.escapeHtml(campaign.name || '')}</td>
                <td>${this.escapeHtml(campaign.mode || '')}</td>
                <td>${this.renderStatusBadge(campaign.status || '-')}</td>
                <td>${campaign.sentCount || 0}</td>
                <td>${campaign.failedCount || 0}</td>
                <td>${campaign.totalCount || 0}${campaign.invalidCount ? `<div class="lead-address">${campaign.invalidCount} invalid saved</div>` : ''}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn-icon" onclick="app.openOutreachCampaign('${campaign.id}')" title="Open campaign">
                            <i data-lucide="eye"></i>
                        </button>
                        ${campaign.mode === 'ai' && campaign.status !== 'running' && campaign.status !== 'completed'
                            ? `<button class="btn-icon" onclick="app.startAiCampaignById('${campaign.id}')" title="Start AI sending"><i data-lucide="rocket"></i></button>`
                            : ''
                        }
                    </div>
                </td>
            </tr>
        `).join('');
        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    getOutreachValidRows() {
        return (this.outreachUploadRows || []).filter((item) => item && item.isValid);
    }

    getOutreachInvalidRows() {
        return (this.outreachUploadRows || []).filter((item) => item && !item.isValid);
    }

    async openOutreachCampaign(campaignId) {
        if (!this.ensureAuthenticated()) return;

        try {
            const data = await this.apiJsonFetch(`/api/outreach/campaigns/${campaignId}`);
            const campaign = data.campaign;
            this.activeOutreachCampaignId = campaign.id;
            this.upsertOutreachCampaign(campaign);
            this.renderOutreachCampaigns();

            if (campaign.mode === 'manual') {
                this.currentManualCampaign = campaign;
                this.currentManualRecipient = campaign.recipients.find((entry) => entry.id === campaign.currentRecipientId)
                    || campaign.recipients.find((entry) => entry.status !== 'sent')
                    || null;
                this.renderManualOutreachState();
            }

            document.getElementById('btn-start-ai-campaign').disabled = campaign.mode !== 'ai';
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to open outreach campaign');
        }
    }

    async startSelectedAiCampaign() {
        if (!this.activeOutreachCampaignId) {
            this.showToast('error', 'Create or open an AI campaign first.');
            return;
        }

        return this.startAiCampaignById(this.activeOutreachCampaignId);
    }

    async startAiCampaignById(campaignId) {
        if (!this.ensureAuthenticated()) return;

        try {
            const data = await this.apiJsonFetch(`/api/outreach/campaigns/${campaignId}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            this.activeOutreachCampaignId = campaignId;
            this.upsertOutreachCampaign(data.campaign);
            this.renderOutreachCampaigns();
            this.renderOutreachLiveStatus(data.message || 'AI campaign started.', 'loading');
            this.showToast('success', 'AI outreach started');
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to start AI outreach');
        }
    }

    renderManualOutreachState() {
        const campaignLabel = document.getElementById('manual-campaign-name');
        const recipientLabel = document.getElementById('manual-recipient-email');
        const sendButton = document.getElementById('btn-send-manual-email');
        const subjectInput = document.getElementById('manual-email-subject');
        const messageInput = document.getElementById('manual-email-message');

        if (!this.currentManualCampaign || !this.currentManualRecipient) {
            campaignLabel.textContent = 'No active manual campaign';
            recipientLabel.textContent = 'Waiting for recipient';
            subjectInput.value = '';
            messageInput.value = '';
            sendButton.disabled = true;
            this.renderOutreachLiveStatus('Manual mode will show the next recipient here when ready.', 'loading');
            return;
        }

        campaignLabel.textContent = this.currentManualCampaign.name || 'Manual campaign';
        recipientLabel.textContent = this.currentManualRecipient.email || 'Unknown recipient';
        subjectInput.value = this.currentManualRecipient.subject || this.currentManualCampaign.subjectTemplate || '';
        messageInput.value = this.currentManualRecipient.message || this.currentManualCampaign.messageTemplate || '';
        sendButton.disabled = false;
        this.renderOutreachLiveStatus(`Now set subject and message for ${this.currentManualRecipient.email}, then send to move to the next email.`, 'success');
    }

    async sendManualEmail() {
        if (!this.ensureAuthenticated()) return;
        if (!this.currentManualCampaign || !this.currentManualRecipient) {
            this.showToast('error', 'No manual recipient is ready right now.');
            return;
        }

        const subject = document.getElementById('manual-email-subject').value.trim();
        const message = document.getElementById('manual-email-message').value.trim();
        if (!subject || !message) {
            this.showToast('error', 'Please set both subject and message for the current recipient.');
            return;
        }

        try {
            const data = await this.apiJsonFetch(`/api/outreach/campaigns/${this.currentManualCampaign.id}/manual-send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipientId: this.currentManualRecipient.id,
                    subject,
                    message
                })
            });

            this.currentManualCampaign = data.campaign;
            this.currentManualRecipient = data.nextRecipient;
            this.upsertOutreachCampaign(data.campaign);
            this.renderOutreachCampaigns();
            this.renderManualOutreachState();
            this.showToast('success', `Email processed for ${data.sentRecipient?.email || 'recipient'}`);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to send manual email');
        }
    }

    onOutreachManualReady(data) {
        const campaign = this.outreachCampaigns.find((item) => item.id === data.campaignId) || this.currentManualCampaign;
        this.activeOutreachCampaignId = data.campaignId;
        this.currentManualCampaign = campaign || this.currentManualCampaign;
        this.currentManualRecipient = data.recipient || null;
        this.renderManualOutreachState();
        if (campaign) {
            this.upsertOutreachCampaign({
                ...campaign,
                currentRecipientId: data.recipient?.id || null
            });
            this.renderOutreachCampaigns();
        }
    }

    onOutreachProgress(data) {
        this.renderOutreachLiveStatus(data.message || 'Outreach in progress...', data.status === 'completed' ? 'success' : 'loading');
        const idx = this.outreachCampaigns.findIndex((item) => item.id === data.campaignId);
        if (idx !== -1) {
            this.outreachCampaigns[idx] = {
                ...this.outreachCampaigns[idx],
                status: data.status,
                sentCount: data.sentCount,
                failedCount: data.failedCount,
                totalCount: data.totalCount,
                currentRecipientId: data.recipient?.id || this.outreachCampaigns[idx].currentRecipientId
            };
            this.renderOutreachCampaigns();
        }

        this.addActivity('email', data.message || 'Outreach update');
    }

    onOutreachComplete(data) {
        this.renderOutreachLiveStatus(data.message || 'Outreach campaign completed.', 'success');
        this.loadOutreachCampaigns();
        this.addActivity('email', data.message || 'Outreach campaign completed');
    }

    renderOutreachLiveStatus(message, type = 'loading') {
        const box = document.getElementById('outreach-live-status');
        box.className = `single-crawl-result ${type}`;
        box.innerHTML = `<p>${this.escapeHtml(message)}</p>`;
    }

    upsertOutreachCampaign(campaign) {
        if (!campaign) {
            return;
        }

        const idx = this.outreachCampaigns.findIndex((item) => item.id === campaign.id);
        if (idx !== -1) {
            this.outreachCampaigns[idx] = campaign;
            return;
        }

        this.outreachCampaigns.unshift(campaign);
    }

    updatePagination(data) {
        document.getElementById('page-info').textContent = `Page ${data.page} of ${data.totalPages || 1}`;
        document.getElementById('btn-prev-page').disabled = data.page <= 1;
        document.getElementById('btn-next-page').disabled = data.page >= data.totalPages;
    }

    switchView(viewName) {
        if (!this.ensureAuthenticated()) return;

        this.currentView = viewName;

        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `view-${viewName}`);
        });

        const titles = {
            dashboard: 'Dashboard',
            discover: 'Discover Businesses',
            leads: 'Lead Database',
            crawl: 'Website Crawler',
            'site-upload': 'Upload Sites CSV',
            linkedin: 'LinkedIn Crawler',
            outreach: 'Email Outreach',
            export: 'Export Data',
            settings: 'Settings'
        };
        document.getElementById('page-title').textContent = titles[viewName] || viewName;

        if (viewName === 'discover' && this.map) {
            setTimeout(() => this.map.invalidateSize(), 100);
        }

        if (viewName === 'leads') this.loadLeads();
        if (viewName === 'dashboard') {
            this.loadStats();
            this.loadLeads();
        }
        if (viewName === 'crawl') this.loadStats();
        if (viewName === 'linkedin') this.loadLinkedinAuthStatus();
        if (viewName === 'outreach') this.loadOutreachOverview();

        document.getElementById('sidebar').classList.remove('open');
    }

    setFilter(filter) {
        this.currentFilter = filter;
        this.currentPage = 1;

        document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });

        this.loadLeads();
    }

    async showLeadDetail(id) {
        const lead = this.leads.find(l => l.id === id || l._id === id);
        if (!lead) return;

        document.getElementById('modal-lead-name').textContent = lead.name;

        const hasEmails = lead.emails && lead.emails.length > 0;
        const hasPhones = (lead.phones && lead.phones.length > 0) || lead.phone;
        const hasSocial = lead.socialLinks && Object.keys(lead.socialLinks).length > 0;

        document.getElementById('modal-lead-body').innerHTML = `
            <div class="modal-field">
                <div class="modal-field-label">Address</div>
                <div class="modal-field-value">${this.escapeHtml(lead.address || 'N/A')}</div>
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Category</div>
                <div class="modal-field-value"><span class="category-badge">${this.escapeHtml(lead.category || 'N/A')}</span></div>
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Emails</div>
                <div class="modal-field-value">
                    ${hasEmails
                        ? lead.emails.map(e => `<div style="color:var(--accent-secondary)">Email: ${this.escapeHtml(e)}</div>`).join('')
                        : '<span style="color:var(--text-muted)">No emails found</span>'
                    }
                </div>
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Phone Numbers</div>
                <div class="modal-field-value">
                    ${hasPhones
                        ? [...(lead.phones || []), ...(lead.phone ? [lead.phone] : [])].map(p =>
                            `<div style="color:#60a5fa">Phone: ${this.escapeHtml(p)}</div>`
                        ).join('')
                        : '<span style="color:var(--text-muted)">No phone numbers found</span>'
                    }
                </div>
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Website</div>
                <div class="modal-field-value">
                    ${lead.website
                        ? `<a href="${this.escapeHtml(lead.website)}" target="_blank">${this.escapeHtml(lead.website)}</a>`
                        : '<span style="color:var(--text-muted)">N/A</span>'
                    }
                </div>
            </div>
            ${lead.contactPageUrl ? `
                <div class="modal-field">
                    <div class="modal-field-label">Contact Page</div>
                    <div class="modal-field-value">
                        <a href="${this.escapeHtml(lead.contactPageUrl)}" target="_blank">${this.escapeHtml(lead.contactPageUrl)}</a>
                    </div>
                </div>
            ` : ''}
            ${hasSocial ? `
                <div class="modal-field">
                    <div class="modal-field-label">Social Media</div>
                    <div class="modal-field-value">
                        ${Object.entries(lead.socialLinks).map(([platform, url]) =>
                            `<div><a href="${this.escapeHtml(url)}" target="_blank">${platform.charAt(0).toUpperCase() + platform.slice(1)}</a></div>`
                        ).join('')}
                    </div>
                </div>
            ` : ''}
            <div class="modal-field">
                <div class="modal-field-label">Rating</div>
                <div class="modal-field-value">
                    ${lead.rating ? `Rating: ${lead.rating} / 5 (${lead.reviewCount || 0} reviews)` : 'N/A'}
                </div>
            </div>
            ${lead.types && lead.types.length > 0 ? `
                <div class="modal-field">
                    <div class="modal-field-label">Types</div>
                    <div class="modal-tags">
                        ${lead.types.map(t => `<span class="modal-tag">${t.replace(/_/g, ' ')}</span>`).join('')}
                    </div>
                </div>
            ` : ''}
            <div class="modal-field">
                <div class="modal-field-label">Discovered</div>
                <div class="modal-field-value">${lead.discoveredAt ? new Date(lead.discoveredAt).toLocaleString() : 'N/A'}</div>
            </div>
            <div class="modal-field">
                <div class="modal-field-label">Crawl Status</div>
                <div class="modal-field-value">
                    ${lead.crawled
                        ? `<span class="status-badge ${lead.crawlStatus === 'error' ? 'status-error' : 'status-crawled'}">${lead.crawlStatus || 'completed'}</span>
                           ${lead.pagesScanned ? ` (${lead.pagesScanned} pages scanned)` : ''}`
                        : '<span class="status-badge status-pending">Not crawled</span>'
                    }
                </div>
            </div>
        `;

        document.getElementById('lead-modal').style.display = 'flex';
        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    closeModal() {
        document.getElementById('lead-modal').style.display = 'none';
    }

    buildDemoSequences() {
        return {
            crawl: {
                kicker: 'Crawler Walkthrough',
                steps: [
                    {
                        view: 'crawl',
                        selector: '#btn-start-crawl',
                        title: 'Start the bulk crawler',
                        description: 'This starts a batch crawl across all saved leads that already have websites. Use it when you want the system to visit each site and collect valid emails and phone numbers automatically.',
                        note: 'Highlighted here: the main bulk crawl trigger.'
                    },
                    {
                        view: 'crawl',
                        selector: '#crawl-progress-wrapper',
                        title: 'Watch crawl progress live',
                        description: 'As the crawler runs, this progress panel shows percent complete, how many sites have finished, and the current crawl status. It gives a quick live read on the batch.',
                        note: 'This area updates while the bulk crawl is running.'
                    },
                    {
                        view: 'crawl',
                        selector: '#single-crawl-url',
                        title: 'Test one website first',
                        description: 'Use single-site crawl when you want to validate one domain before running a larger batch. Paste one URL here and click Crawl to preview the contact extraction quality.',
                        note: 'Paste a site here for one-off testing.'
                    },
                    {
                        view: 'crawl',
                        selector: '#single-crawl-results-tbody',
                        title: 'Review single-site results',
                        description: 'The result table stores the websites you tested, along with valid emails, phone numbers, scanned pages, and completion status. This is useful before you trust a bigger run.',
                        note: 'Each row shows the cleaned crawl output for one website.'
                    },
                    {
                        view: 'site-upload',
                        selector: '#btn-start-site-upload',
                        title: 'Run a CSV site crawl',
                        description: 'If you already have a list of domains, switch to this upload workflow. Add a CSV with a sites column, start the crawl, and the app will process each domain in sequence.',
                        note: 'This is the batch option for uploaded site lists.'
                    },
                    {
                        view: 'site-upload',
                        selector: '#btn-download-site-results',
                        title: 'Download the cleaned contacts',
                        description: 'After the uploaded crawl finishes, download the CSV result file here. Only validated contacts are included, so the export stays cleaner and more usable.',
                        note: 'Use this after a completed site-upload crawl.'
                    }
                ]
            },
            outreach: {
                kicker: 'Outreach Walkthrough',
                steps: [
                    {
                        view: 'outreach',
                        selector: '#outreach-smtp-host',
                        title: 'Configure mail sending first',
                        description: 'Start by entering SMTP host, port, username, password, sender email, and sender name. This powers the real mail delivery before any campaign begins.',
                        note: 'These fields define the sender account.'
                    },
                    {
                        view: 'outreach',
                        selector: '#btn-save-outreach-config',
                        title: 'Save the mail setup',
                        description: 'Save your mail settings before moving on. If you want AI-assisted drafts, keep the OpenAI fields filled too, but the save step is the important foundation.',
                        note: 'Save mail setup here before campaign creation.'
                    },
                    {
                        view: 'outreach',
                        selector: '#outreach-csv-file',
                        title: 'Upload recipient emails',
                        description: 'Upload a CSV that includes an email column. This becomes the recipient list the system will use for manual or AI-driven sending.',
                        note: 'Choose the recipient CSV in this field.'
                    },
                    {
                        view: 'outreach',
                        selector: '#btn-create-outreach-campaign',
                        title: 'Create the campaign',
                        description: 'Once the list and campaign details are ready, create the campaign here. The app will prepare the sequence and make it available in the live campaign table.',
                        note: 'This turns the uploaded recipients into a sendable campaign.'
                    },
                    {
                        view: 'outreach',
                        selector: '#manual-outreach-panel',
                        title: 'Send one email at a time',
                        description: 'In manual mode, the app loads one recipient into this panel. You review or edit the message, send it, and the system moves to the next recipient one by one.',
                        note: 'This panel is the heart of one-by-one sending.'
                    },
                    {
                        view: 'outreach',
                        selector: '#btn-send-manual-email',
                        title: 'Move to the next recipient',
                        description: 'Click Send Email after reviewing the draft. The current email is processed, the live status updates, and the next recipient is loaded automatically for the next step.',
                        note: 'This button advances the one-by-one mail flow.'
                    },
                    {
                        view: 'outreach',
                        selector: '#outreach-live-status',
                        title: 'Track campaign activity',
                        description: 'This live status panel shows what the campaign is doing right now, while the campaign table below keeps the totals for sent, failed, and pending recipients.',
                        note: 'Watch this area while the campaign is running.'
                    }
                ]
            }
        };
    }

    startDemo(type) {
        if (!this.ensureAuthenticated()) return;

        const demo = this.demoSequences[type];
        if (!demo) {
            return;
        }

        this.activeDemo = demo;
        this.activeDemoStepIndex = 0;
        document.getElementById('demo-modal').style.display = 'flex';
        this.renderDemoStep();
    }

    renderDemoStep() {
        if (!this.activeDemo) {
            return;
        }

        const steps = this.activeDemo.steps || [];
        const step = steps[this.activeDemoStepIndex];
        if (!step) {
            this.closeDemo();
            return;
        }

        if (step.view && this.currentView !== step.view) {
            this.switchView(step.view);
        }

        document.getElementById('demo-kicker').textContent = this.activeDemo.kicker || 'Guided Demo';
        document.getElementById('demo-title').textContent = step.title;
        document.getElementById('demo-description').textContent = step.description;
        document.getElementById('demo-step-counter').textContent = `Step ${this.activeDemoStepIndex + 1} of ${steps.length}`;
        document.getElementById('demo-progress-bar').style.width = `${((this.activeDemoStepIndex + 1) / steps.length) * 100}%`;
        document.getElementById('btn-demo-prev').disabled = this.activeDemoStepIndex === 0;

        const nextLabel = this.activeDemoStepIndex === steps.length - 1 ? 'Finish' : 'Next';
        document.querySelector('#btn-demo-next span').textContent = nextLabel;

        setTimeout(() => this.focusDemoTarget(step), 120);
    }

    focusDemoTarget(step) {
        this.clearDemoHighlight();

        const target = step.selector ? document.querySelector(step.selector) : null;
        const note = document.getElementById('demo-target-note');

        if (!target) {
            note.textContent = step.note || 'This step explains the workflow without a specific target.';
            return;
        }

        this.demoHighlightEl = target;
        this.demoHighlightEl.classList.add('demo-highlight');
        this.demoHighlightEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        note.textContent = step.note || 'Follow the highlighted area for this step.';
    }

    nextDemoStep() {
        if (!this.activeDemo) {
            return;
        }

        if (this.activeDemoStepIndex >= this.activeDemo.steps.length - 1) {
            this.closeDemo();
            this.showToast('success', 'Demo completed');
            return;
        }

        this.activeDemoStepIndex += 1;
        this.renderDemoStep();
    }

    prevDemoStep() {
        if (!this.activeDemo || this.activeDemoStepIndex === 0) {
            return;
        }

        this.activeDemoStepIndex -= 1;
        this.renderDemoStep();
    }

    clearDemoHighlight() {
        if (this.demoHighlightEl) {
            this.demoHighlightEl.classList.remove('demo-highlight');
            this.demoHighlightEl = null;
        }
    }

    closeDemo() {
        this.clearDemoHighlight();
        this.activeDemo = null;
        this.activeDemoStepIndex = 0;
        document.getElementById('demo-modal').style.display = 'none';
    }

    async crawlLead(id) {
        if (!this.ensureAuthenticated()) return;

        try {
            this.showToast('info', 'Crawling website...');
            const data = await this.apiJsonFetch(`/api/crawl/${id}`, { method: 'POST' });
            const lead = data.lead || data;

            if (lead.emails) {
                this.showToast('success', `Found ${lead.emails.length} emails, ${(lead.phones || []).length} phones`);
            }

            this.loadLeads();
            this.loadStats();
        } catch (err) {
            this.showToast('error', err.userMessage || 'Crawl failed');
        }
    }

    async deleteLead(id) {
        if (!this.ensureAuthenticated()) return;
        if (!confirm('Delete this lead?')) return;

        try {
            await this.apiJsonFetch(`/api/leads/${id}`, { method: 'DELETE' });
            this.showToast('success', 'Lead deleted');
            this.loadLeads();
            this.loadStats();
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to delete lead');
        }
    }

    async clearLeads() {
        if (!this.ensureAuthenticated()) return;
        if (!confirm('Are you sure you want to delete ALL leads? This cannot be undone.')) return;

        try {
            await this.apiJsonFetch('/api/leads', { method: 'DELETE' });
            this.showToast('success', 'All leads cleared');
            this.clearMapMarkers();
            this.loadLeads();
            this.loadStats();
        } catch (err) {
            this.showToast('error', err.userMessage || 'Failed to clear leads');
        }
    }

    async exportLeads(format) {
        if (!this.ensureAuthenticated()) return;

        try {
            const response = await this.apiFetch(`/api/leads/export?format=${format}`);
            const blob = await response.blob();
            this.downloadBlob(blob, `leads_export_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'json'}`);
            this.showToast('success', `Leads exported as ${format.toUpperCase()}`);
        } catch (err) {
            this.showToast('error', err.userMessage || 'Export failed');
        }
    }

    async saveSettings() {
        if (!this.ensureAuthenticated()) return;

        const apiKey = document.getElementById('settings-api-key').value.trim();
        const statusEl = document.getElementById('settings-status');

        try {
            await this.apiJsonFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ googleApiKey: apiKey })
            });

            statusEl.style.display = 'block';
            statusEl.className = 'settings-status success';
            statusEl.textContent = 'Settings saved successfully.';
            this.showToast('success', 'Settings saved');
        } catch (err) {
            statusEl.style.display = 'block';
            statusEl.className = 'settings-status error';
            statusEl.textContent = err.userMessage || 'Failed to save settings';
        }
    }

    addActivity(type, message) {
        const feed = document.getElementById('activity-feed');
        const emptyState = feed.querySelector('.empty-state-mini');
        if (emptyState) emptyState.remove();

        const iconMap = {
            search: 'search',
            lead: 'lead',
            crawl: 'crawl',
            email: 'email',
            error: 'error'
        };

        const lucideIconMap = {
            search: 'search',
            lead: 'user-plus',
            crawl: 'globe',
            email: 'mail',
            error: 'alert-triangle'
        };

        const item = document.createElement('div');
        item.className = 'feed-item';
        item.innerHTML = `
            <div class="feed-icon ${iconMap[type] || 'lead'}">
                <i data-lucide="${lucideIconMap[type] || 'circle'}"></i>
            </div>
            <div class="feed-content">
                <div class="feed-message">${message}</div>
                <div class="feed-time">${new Date().toLocaleTimeString()}</div>
            </div>
        `;

        feed.insertBefore(item, feed.firstChild);

        while (feed.children.length > 50) {
            feed.removeChild(feed.lastChild);
        }

        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });
    }

    updateConnectionStatus(connected, label = '') {
        const el = document.getElementById('connection-status');
        const dot = el.querySelector('.status-dot');
        const text = el.querySelector('span:last-child');

        if (connected) {
            dot.className = 'status-dot connected';
            text.textContent = label || 'Connected';
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = label || 'Disconnected';
        }
    }

    showToast(type, message) {
        const container = document.getElementById('toast-container');
        const iconMap = {
            success: 'check-circle',
            error: 'alert-circle',
            info: 'info'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i data-lucide="${iconMap[type] || 'info'}"></i>
            <span>${message}</span>
        `;
        container.appendChild(toast);
        lucide.createIcons({ attrs: { class: '' }, nameAttr: 'data-lucide' });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(12px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    renderEmptyState() {
        this.renderLeadsTable();
        this.renderRecentLeads();
        this.renderLinkedinResults();
        this.renderSiteCrawlResults();
        this.renderSingleCrawlResults();
    }

    upsertLeadInMemory(lead, options = {}) {
        if (!lead) {
            return;
        }

        const idx = this.leads.findIndex((item) => (item.id === lead.id) || (item._id === lead._id));
        if (idx !== -1) {
            this.leads[idx] = lead;
            return;
        }

        if (options.prepend) {
            this.leads.unshift(lead);
        } else {
            this.leads.push(lead);
        }
    }

    upsertSiteCrawlResult(result) {
        if (!result) {
            return;
        }

        const key = result.normalizedUrl || result.site;
        const idx = this.siteCrawlResults.findIndex((item) => (item.normalizedUrl || item.site) === key);
        if (idx !== -1) {
            this.siteCrawlResults[idx] = result;
            return;
        }

        this.siteCrawlResults.unshift(result);
    }

    mergeSiteCrawlResults(results) {
        for (const result of results || []) {
            this.upsertSiteCrawlResult(result);
        }
    }

    buildContactSummary(result) {
        const emailCount = Array.isArray(result?.emails) ? result.emails.length : 0;
        const phoneCount = Array.isArray(result?.phones) ? result.phones.length : 0;
        const parts = [];

        if (emailCount) {
            parts.push(`${emailCount} email${emailCount === 1 ? '' : 's'}`);
        }

        if (phoneCount) {
            parts.push(`${phoneCount} phone${phoneCount === 1 ? '' : 's'}`);
        }

        return parts.join(', ');
    }

    renderStatusBadge(status, error = '') {
        if (status === 'completed') {
            return '<span class="status-badge status-crawled"><i data-lucide="check-circle"></i> Completed</span>';
        }

        if (status === 'error') {
            return '<span class="status-badge status-error"><i data-lucide="alert-circle"></i> Error</span>';
        }

        return `<span class="status-badge status-pending">${this.escapeHtml(status || '-')}</span>`;
    }

    renderSingleCrawlStatus(type, message) {
        const box = document.getElementById('single-crawl-result');
        box.style.display = 'block';
        box.className = `single-crawl-result ${type}`;
        box.innerHTML = `<p>${message}</p>`;
    }

    scheduleStatsRefresh() {
        if (this.statsRefreshTimer) {
            clearTimeout(this.statsRefreshTimer);
        }

        this.statsRefreshTimer = setTimeout(() => {
            this.statsRefreshTimer = null;
            this.loadStats();
        }, 300);
    }

    escapeTextContent(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
        }, 500);
    }

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    truncateUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.hostname.replace('www.', '');
        } catch {
            return url.length > 25 ? `${url.substring(0, 25)}...` : url;
        }
    }

    formatNumber(num) {
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return String(num || 0);
    }
}

const app = new LeadGenApp();
