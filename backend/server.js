import express from 'express';
import dns from 'dns';
import cors from 'cors';
import multer from 'multer';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3007;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('excel') || file.mimetype.includes('spreadsheet') || 
        file.originalname.match(/\.(xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed!'), false);
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Ensure directories exist
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'));
}

/**
 * Lookup DNS records for a domain
 * @param {string} domain 
 * @returns {Promise<Object>}
 */
async function lookupAllRecords(domain) {
  const recordTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'];
  const results = {};

  // Create promises for all record types
  const lookups = recordTypes.map(type => {
    return new Promise((resolve) => {
      dns.resolve(domain, type, (err, addresses) => {
        if (err) {
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

  // Wait for all lookups
  const allResults = await Promise.all(lookups);

  // Organize results
  allResults.forEach(({ type, records }) => {
    results[type] = records;
  });

  // Additional IP lookup
  const ipLookup = new Promise((resolve) => {
    dns.lookup(domain, { all: true }, (err, addresses) => {
      if (err) {
        console.error('IP lookup error:', err);
        resolve({ IPs: [] });
      } else {
        resolve({ IPs: addresses });
      }
    });
  });

  const ipResult = await ipLookup;
  results.IPs = ipResult.IPs;

  return results;
}

// Process Excel file endpoint
app.post('/api/process-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read the uploaded file
    const workbook = xlsx.readFile(req.file.path);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    // Process each row
    const results = [];
    for (const row of data) {
      // Find domain column (case insensitive)
      const domainKey = Object.keys(row).find(key => 
        key.toLowerCase() === 'domain' && row[key]
      );

      if (domainKey) {
        const domain = row[domainKey].toString().trim();
        try {
          // Clean domain (remove http/https/www if present)
          const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
          
          // Get all DNS records
          const records = await lookupAllRecords(cleanDomain);
          
          // Format records for Excel output
          const formattedRecords = {
            ...row, // Include all original row data
            'Domain_Checked': cleanDomain,
            'A_Records': records.A.length > 0 ? records.A.join(', ') : 'No A records',
            'AAAA_Records': records.AAAA.length > 0 ? records.AAAA.join(', ') : 'No AAAA records',
            'MX_Records': records.MX.length > 0 ? 
              records.MX.map(mx => `${mx.priority} ${mx.exchange}`).join(', ') : 'No MX records',
            'TXT_Records': records.TXT.length > 0 ? 
              records.TXT.map(txt => txt.join(' ')).join(' | ') : 'No TXT records',
            'NS_Records': records.NS.length > 0 ? records.NS.join(', ') : 'No NS records',
            'CNAME_Records': records.CNAME.length > 0 ? records.CNAME.join(', ') : 'No CNAME records',
            'IP_Addresses': records.IPs.length > 0 ? 
              records.IPs.map(ip => `${ip.address} (IPv${ip.family})`).join(', ') : 'No IP addresses',
            'SOA_Record': records.SOA ? 
              `Primary NS: ${records.SOA.nsname}, Hostmaster: ${records.SOA.hostmaster}` : 'No SOA record'
          };

          results.push(formattedRecords);
        } catch (error) {
          results.push({
            ...row,
            'Domain_Checked': domain,
            'Error': 'Failed to fetch DNS records'
          });
        }
      }
    }

    // Create output workbook
    const newWorkbook = xlsx.utils.book_new();
    const newWorksheet = xlsx.utils.json_to_sheet(results);
    xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'DNS Results');

    // Save output file
    const outputFilename = `dns-results-${Date.now()}.xlsx`;
    const outputPath = path.join(__dirname, 'public', outputFilename);
    xlsx.writeFile(newWorkbook, outputPath);

    // Cleanup
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      downloadUrl: `/public/${outputFilename}`,
      filename: outputFilename
    });

  } catch (error) {
    console.error('Error processing file:', error);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Error processing file' });
  }
});

// DNS Lookup endpoint (unchanged)
app.get('/api/dns-lookup', async (req, res) => {
  const { domain } = req.query;

  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  try {
    const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '');
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