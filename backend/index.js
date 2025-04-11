import express from 'express';
import dns from 'dns';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3007;

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to lookup multiple DNS record types
async function lookupAllRecords(domain) {
    const recordTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'];
    const results = {};

    // Create an array of promises for all record types
    const lookups = recordTypes.map(type => {
        return new Promise((resolve) => {
            dns.resolve(domain, type, (err, addresses) => {
                if (err) {
                    // If the error is that the record type doesn't exist, we'll just skip it
                    if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
                        resolve({ type, records: [] });
                    } else {
                        console.error(`Error looking up ${type} records:`, err);
                        resolve({ type, records: [], error: err.message });
                    }
                } else {
                    resolve({ type, records: addresses });
                }
            });
        });
    });

    // Wait for all lookups to complete
    const allResults = await Promise.all(lookups);

    // Organize results by record type
    allResults.forEach(({ type, records, error }) => {
        results[type] = records;
        if (error) results[`${type}_error`] = error;
    });

    // Additional lookup for IP addresses (A records)
    const ipLookup = new Promise((resolve) => {
        dns.lookup(domain, { all: true }, (err, addresses) => {
            if (err) {
                console.error('IP lookup error:', err);
                resolve({ IPs: [], error: err.message });
            } else {
                resolve({ IPs: addresses });
            }
        });
    });

    const ipResult = await ipLookup;
    results.IPs = ipResult.IPs;
    if (ipResult.error) results.IP_error = ipResult.error;

    return results;
}

// DNS Lookup Endpoint
app.get('/api/dns-lookup', async (req, res) => {
    const { domain } = req.query;

    if (!domain) {
        return res.status(400).json({ error: 'Domain is required' });
    }

    try {
        // Remove protocol and www if present
        const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '');

        // Perform DNS lookups for different record types
        const records = await lookupAllRecords(cleanDomain);

        res.json({
            domain: cleanDomain,
            ...records
        });
    } catch (error) {
        console.error('DNS lookup error:', error);
        res.status(500).json({ error: 'Failed to perform DNS lookup' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`DNS Lookup API running on http://localhost:${PORT}`);
});

export default app;