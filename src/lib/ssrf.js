const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const AppError = require('./appError');

const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0']);

function isPrivateIPv4(ip) {
    if (!net.isIPv4(ip)) {
        return false;
    }

    const octets = ip.split('.').map(Number);
    const [a, b] = octets;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;

    return false;
}

function isPrivateIPv6(ip) {
    if (!net.isIPv6(ip)) {
        return false;
    }

    const normalized = ip.toLowerCase();
    return normalized === '::1'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80');
}

async function resolvePublicHostname(hostname) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) {
        throw new AppError(400, 'DNS lookup returned no public IPs.', 'SSRF_DNS_EMPTY');
    }

    for (const record of records) {
        const address = record.address;
        if (isPrivateIPv4(address) || isPrivateIPv6(address)) {
            throw new AppError(400, `Blocked private network target: ${hostname}`, 'SSRF_BLOCKED_TARGET');
        }
    }
}

async function assertSafePublicUrl(input) {
    let parsed;

    try {
        parsed = new URL(input);
    } catch (error) {
        throw new AppError(400, 'Invalid URL.', 'INVALID_URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new AppError(400, 'Only http and https URLs are allowed.', 'INVALID_URL_PROTOCOL');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(hostname)) {
        throw new AppError(400, `Blocked local target: ${hostname}`, 'SSRF_BLOCKED_TARGET');
    }

    if (net.isIP(hostname)) {
        if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
            throw new AppError(400, `Blocked private IP target: ${hostname}`, 'SSRF_BLOCKED_TARGET');
        }
        return parsed.toString();
    }

    await resolvePublicHostname(hostname);
    return parsed.toString();
}

module.exports = {
    assertSafePublicUrl
};
