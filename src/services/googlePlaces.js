const axios = require('axios');
const AppError = require('../lib/appError');

class GooglePlacesService {
    constructor({ apiKey }) {
        this.apiKey = apiKey;
        this.baseURL = 'https://maps.googleapis.com/maps/api/place';
        this.allResults = [];
        this.seenPlaceIds = new Set();
    }

    async search({ keyword, bounds, polygon, type, onProgress }) {
        this.allResults = [];
        this.seenPlaceIds = new Set();

        if (!this.apiKey) {
            throw new AppError(503, 'Google Places provider unavailable.', 'GOOGLE_PROVIDER_UNAVAILABLE');
        }

        const gridCells = this._createGrid(bounds, polygon);
        if (onProgress) {
            onProgress({
                phase: 'grid',
                message: `Created ${gridCells.length} search cells.`,
                total: 0
            });
        }

        for (let index = 0; index < gridCells.length; index += 1) {
            if (onProgress) {
                onProgress({
                    phase: 'searching',
                    message: `Searching grid cell ${index + 1} of ${gridCells.length}.`,
                    total: this.allResults.length
                });
            }

            await this._searchCell(gridCells[index], keyword, type, onProgress);
            if (index < gridCells.length - 1) {
                await this._delay(200);
            }
        }

        return this.allResults;
    }

    async _searchCell(cell, keyword, type, onProgress) {
        const params = {
            location: `${cell.lat},${cell.lng}`,
            radius: Math.min(cell.radius, 50000),
            keyword,
            key: this.apiKey
        };

        if (type) {
            params.type = type;
        }

        let pageToken = null;
        let page = 0;

        do {
            const reqParams = { ...params };
            if (pageToken) {
                reqParams.pagetoken = pageToken;
                await this._delay(2000);
            }

            const { data } = await axios.get(`${this.baseURL}/nearbysearch/json`, {
                params: reqParams,
                timeout: 15000
            });

            if (!['OK', 'ZERO_RESULTS'].includes(data.status)) {
                throw new AppError(502, data.error_message || `Google Places error: ${data.status}`, 'GOOGLE_PROVIDER_ERROR');
            }

            const freshPlaces = [];
            for (const place of data.results || []) {
                if (!place.place_id || this.seenPlaceIds.has(place.place_id)) {
                    continue;
                }

                this.seenPlaceIds.add(place.place_id);
                freshPlaces.push(place);
            }

            await this._enrichPlaces(freshPlaces, onProgress);

            pageToken = data.next_page_token || null;
            page += 1;
        } while (pageToken && page < 3);
    }

    async _enrichPlaces(places, onProgress) {
        const concurrency = 4;

        for (let index = 0; index < places.length; index += concurrency) {
            const batch = places.slice(index, index + concurrency);
            const details = await Promise.all(batch.map(async (place) => {
                const detail = await this.getPlaceDetails(place.place_id);
                return this._mapToLead(place, detail);
            }));

            for (const lead of details) {
                this.allResults.push(lead);
                if (onProgress) {
                    onProgress({
                        phase: 'found',
                        lead,
                        total: this.allResults.length
                    });
                }
            }
        }
    }

    async getPlaceDetails(placeId) {
        const { data } = await axios.get(`${this.baseURL}/details/json`, {
            params: {
                place_id: placeId,
                fields: 'formatted_phone_number,international_phone_number,website,url,formatted_address,name,types,rating,user_ratings_total',
                key: this.apiKey
            },
            timeout: 10000
        });

        if (data.status !== 'OK' || !data.result) {
            return null;
        }

        return data.result;
    }

    _createGrid(bounds, polygon) {
        const [[south, west], [north, east]] = bounds;
        const latRange = north - south;
        const lngRange = east - west;
        const latKm = latRange * 111;
        const lngKm = lngRange * 111 * Math.cos((south + north) / 2 * Math.PI / 180);
        const areaKm2 = latKm * lngKm;

        let gridSize = 3;
        if (areaKm2 > 10000) gridSize = 10;
        else if (areaKm2 > 2500) gridSize = 8;
        else if (areaKm2 > 500) gridSize = 6;
        else if (areaKm2 > 100) gridSize = 5;
        else if (areaKm2 > 25) gridSize = 4;

        const latStep = latRange / gridSize;
        const lngStep = lngRange / gridSize;
        const cells = [];

        for (let i = 0; i < gridSize; i += 1) {
            for (let j = 0; j < gridSize; j += 1) {
                const lat = south + latStep * (i + 0.5);
                const lng = west + lngStep * (j + 0.5);

                if (polygon?.length >= 3 && !this._pointInPolygon([lat, lng], polygon)) {
                    continue;
                }

                const cellLatKm = latStep * 111;
                const cellLngKm = lngStep * 111 * Math.cos(lat * Math.PI / 180);
                const radius = Math.ceil((Math.sqrt(cellLatKm ** 2 + cellLngKm ** 2) / 2) * 1000);
                cells.push({ lat, lng, radius });
            }
        }

        return cells;
    }

    _pointInPolygon(point, polygon) {
        const [px, py] = point;
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];
            const intersect = ((yi > py) !== (yj > py))
                && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    }

    _mapToLead(place, details) {
        return {
            externalId: place.place_id,
            name: place.name || details?.name || 'Unknown',
            address: details?.formatted_address || place.vicinity || place.formatted_address || '',
            lat: place.geometry?.location?.lat || 0,
            lng: place.geometry?.location?.lng || 0,
            rating: place.rating || details?.rating || null,
            reviewCount: place.user_ratings_total || details?.user_ratings_total || 0,
            category: this._getReadableCategory(place.types || details?.types || []),
            businessStatus: place.business_status || 'OPERATIONAL',
            website: details?.website || null,
            phone: details?.formatted_phone_number || details?.international_phone_number || null,
            emails: [],
            phones: details?.formatted_phone_number ? [details.formatted_phone_number] : [],
            socialLinks: {},
            contactPageUrl: null,
            crawled: false,
            crawlStatus: 'pending',
            discoveredAt: new Date().toISOString(),
            source: 'google_places',
            rawPayload: {
                place,
                details: details || null
            }
        };
    }

    _getReadableCategory(types) {
        if (!types?.length) return 'Business';
        return String(types[0]).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = GooglePlacesService;
