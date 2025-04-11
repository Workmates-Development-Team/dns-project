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

    // Process each URL
    const results = [];
    for (const row of data) {
      const urlKey = Object.keys(row).find(key => 
        typeof row[key] === 'string' && 
        (row[key].includes('http://') || row[key].includes('https://') || row[key].includes('.'))
      );

      if (urlKey && row[urlKey]) {
        const url = row[urlKey].trim();
        try {
          const domain = url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
          const mxRecords = await lookupMXRecords(domain);
          
          const mxString = mxRecords.length > 0 
            ? mxRecords.map(mx => `${mx.priority} ${mx.exchange}`).join(', ')
            : 'No MX records found';

          results.push({
            URL: url,
            Domain: domain,
            MX_Records: mxString
          });
        } catch (error) {
          results.push({
            URL: url,
            Domain: 'Error processing',
            MX_Records: 'Error fetching MX records'
          });
        }
      }
    }

    // Create output workbook
    const newWorkbook = xlsx.utils.book_new();
    const newWorksheet = xlsx.utils.json_to_sheet(results);
    xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, 'MX Results');

    // Save output file
    const outputFilename = `mx-results-${Date.now()}.xlsx`;
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

// DNS Lookup endpoint
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

// Helper function for MX records only
async function lookupMXRecords(domain) {
  return new Promise((resolve) => {
    dns.resolve(domain, 'MX', (err, addresses) => {
      if (err) {
        if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
          resolve([]);
        } else {
          console.error(`Error looking up MX records:`, err);
          resolve([]);
        }
      } else {
        resolve(addresses);
      }
    });
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`DNS Lookup API running on http://localhost:${PORT}`);
});

export default app;