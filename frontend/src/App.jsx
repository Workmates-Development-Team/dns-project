import React, { useState } from 'react';
import axios from 'axios';
import './App.css';
import logo from './assets/logo1.png';

const App = () => {
  const [domain, setDomain] = useState('');
  const [dnsData, setDnsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [downloadLink, setDownloadLink] = useState(null);
  const [mode, setMode] = useState('single'); // 'single' or 'batch'

  const handleSearch = async () => {
    if (mode === 'single' && !domain.trim()) {
      setError('Please enter a URL first');
      return;
    }

    if (mode === 'batch' && !file) {
      setError('Please select an Excel file first');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      if (mode === 'single') {
        // Single domain lookup
        let searchDomain = domain;
        try {
          const urlObj = new URL(domain);
          searchDomain = urlObj.hostname;
        } catch (e) {
          // Not a full URL, use as is
        }

        const response = await axios.get(`http://localhost:3007/api/dns-lookup?domain=${searchDomain}`);
        setDnsData(response.data);
      } else {
        // Batch processing
        const formData = new FormData();
        formData.append('file', file);

        const response = await axios.post('http://localhost:3007/api/process-excel', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });

        setDownloadLink(`http://localhost:3007${response.data.downloadUrl}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch DNS data. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const toggleMode = () => {
    setMode(mode === 'single' ? 'batch' : 'single');
    setDnsData(null);
    setDownloadLink(null);
    setError(null);
  };

  const renderRecord = (record, index) => {
    if (typeof record === 'string') {
      return <div key={index}>{record}</div>;
    }
    if (record.exchange) {
      return (
        <div key={index}>
          {record.priority} {record.exchange}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-logo" style={{ backgroundColor: 'white', padding: '10px', borderRadius: '8px' }}>
          <img src={logo} alt="logo" height={100} width={80} />
        </div>
      </nav>

      <div className="container">
        <h1>DNS Check Tool</h1>
        
        <div className="mode-toggle">
          <button onClick={toggleMode}>
            Switch to {mode === 'single' ? 'Batch Mode' : 'Single Mode'}
          </button>
        </div>

        {mode === 'single' ? (
          <div className="search-box">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Enter domain or URL (e.g., example.com or https://example.com)"
            />
            <button onClick={handleSearch} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        ) : (
          <div className="file-upload">
            <input
              type="file"
              id="file-upload"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
            />
            <label htmlFor="file-upload" className="file-upload-label">
              {file ? file.name : 'Choose Excel File'}
            </label>
            <button onClick={handleSearch} disabled={loading || !file}>
              {loading ? 'Processing...' : 'Generate Report'}
            </button>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        {loading && (
          <div className="loader-container">
            <div className="loader"></div>
          </div>
        )}

        {mode === 'single' && dnsData && (
          <div className="results-table">
            <h2>DNS Records for {dnsData.domain}</h2>
            
            <table>
              <tbody>
                <tr>
                  <th>A Records (IPv4)</th>
                  <td>
                    {dnsData.A.length > 0 ? (
                      dnsData.A.map((ip, i) => <div key={i}>{ip}</div>)
                    ) : (
                      <em>No A records found</em>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>AAAA Records (IPv6)</th>
                  <td>
                    {dnsData.AAAA.length > 0 ? (
                      dnsData.AAAA.map((ip, i) => <div key={i}>{ip}</div>)
                    ) : (
                      <em>No AAAA records found</em>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>MX Records</th>
                  <td>
                    {dnsData.MX.length > 0 ? (
                      dnsData.MX.map((mx, i) => (
                        <div key={i}>
                          Priority: {mx.priority} - {mx.exchange}
                        </div>
                      ))
                    ) : (
                      <em>No MX records found</em>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>TXT Records</th>
                  <td>
                    {dnsData.TXT.length > 0 ? (
                      dnsData.TXT.map((txt, i) => (
                        <div key={i} className="txt-record">
                          {txt[0]}
                        </div>
                      ))
                    ) : (
                      <em>No TXT records found</em>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>NS Records</th>
                  <td>
                    {dnsData.NS.length > 0 ? (
                      dnsData.NS.map((ns, i) => <div key={i}>{ns}</div>)
                    ) : (
                      <em>No NS records found</em>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>CNAME Records</th>
                  <td>
                    {dnsData.CNAME.length > 0 ? (
                      dnsData.CNAME.map((cname, i) => <div key={i}>{cname}</div>)
                    ) : (
                      <em>No CNAME records found</em>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>SOA Record</th>
                  <td>
                    {dnsData.SOA ? (
                      <div>
                        <div>Primary NS: {dnsData.SOA.nsname}</div>
                        <div>Hostmaster: {dnsData.SOA.hostmaster}</div>
                        <div>Serial: {dnsData.SOA.serial}</div>
                        <div>Refresh: {dnsData.SOA.refresh}</div>
                        <div>Retry: {dnsData.SOA.retry}</div>
                        <div>Expire: {dnsData.SOA.expire}</div>
                        <div>Minimum TTL: {dnsData.SOA.minttl}</div>
                      </div>
                    ) : (
                      <em>No SOA record found</em>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>IP Addresses</th>
                  <td>
                    {dnsData.IPs.length > 0 ? (
                      dnsData.IPs.map((ip, i) => (
                        <div key={i}>
                          {ip.address} (IPv{ip.family})
                        </div>
                      ))
                    ) : (
                      <em>No IP addresses found</em>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {mode === 'batch' && downloadLink && (
          <div className="download-section">
            <h3>Report Generated Successfully!</h3>
            <a href={downloadLink} download className="download-button">
              Download Excel Report
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;