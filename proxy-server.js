// filepath: proxy-server.js (Place this outside your React app, e.g., in a separate 'proxy' folder)
const express = require('express');
const fetch = require('node-fetch'); // Use node-fetch v2 for CommonJS require
const cors = require('cors');
const puppeteer = require('puppeteer'); // <-- Add Puppeteer

const app = express();
// Use Render's PORT environment variable, default to 3001 locally
const port = process.env.PORT || 3001;

// Use an environment variable for CORS origin, default to * for local dev (change later!)
const allowedOrigin = process.env.CORS_ORIGIN || '*';
console.log(`Allowing CORS origin: ${allowedOrigin}`);
app.use(cors({ origin: allowedOrigin }));

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('Missing target URL parameter');
  }

  try {
    console.log(`Proxying request for: ${targetUrl}`);
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': req.headers['user-agent'],
        // Forward Accept-Encoding to let the target server know we can handle compression
        'Accept-Encoding': req.headers['accept-encoding'] || 'gzip, deflate, br',
        // Forward Accept to indicate preferred content types
        'Accept': req.headers['accept'] || '*/*',
        // Forward Accept-Language
        'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
        // Add Referer header - using the target URL itself as a plausible referer
        'Referer': targetUrl,
        // Avoid forwarding cookies by default unless specifically needed and handled
        // 'Cookie': req.headers['cookie'] // Be very careful with this
      },
      redirect: 'manual',
      compress: true, // Let node-fetch handle decompression
    });

    // Handle redirects manually if necessary (example)
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
        const redirectUrl = response.headers.get('location');
        console.log(`Redirecting to: ${redirectUrl}`);
        res.redirect(`/proxy?url=${encodeURIComponent(redirectUrl)}`); // Simplest approach: redirect client
        return;
    }

    if (!response.ok) {
      console.error(`Proxy failed for ${targetUrl}: ${response.status} ${response.statusText}`);
      // Forward the status and body from the target server on error
      const body = await response.text();
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('Content-Encoding'); // Ensure removed on error too
      res.removeHeader('Content-Length');
      return res.status(response.status).send(body);
    }

    // Read the entire body first to allow modification
    const body = await response.text();

    // Attempt to rewrite absolute Reddit URLs to go through the proxy
    // This is a basic replacement and might not catch everything or could break things.
    let modifiedBody = body;
    try {
        const proxyBaseUrl = `${req.protocol}://${req.get('host')}`;
        const targetUri = new URL(targetUrl);
        const targetBase = `${targetUri.protocol}//${targetUri.host}`;

        // Replace base URLs in the body
        // Use regex with caution, might need more specific patterns
        modifiedBody = modifiedBody.replace(new RegExp(targetBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `${proxyBaseUrl}/proxy?url=${encodeURIComponent(targetBase)}`);
        // Specifically target www.reddit.com if needed, be careful not to double-proxy
        modifiedBody = modifiedBody.replace(/https?:\/\/www\.reddit\.com/g, `${proxyBaseUrl}/proxy?url=https://www.reddit.com`);
        // Add replacements for other potential subdomains if identified (e.g., *.reddit.com, *.redd.it)

    } catch(e) {
        console.error("Error during URL rewriting:", e);
        // If rewriting fails, proceed with the original body but still fix headers
        modifiedBody = body;
    }

    // Process and forward headers, modifying security headers
    const responseHeaders = {};
    Object.entries(response.headers.raw()).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();

        // Skip headers that can cause issues or are irrelevant after modification
        if (lowerKey === 'content-encoding' ||
            lowerKey === 'transfer-encoding' ||
            lowerKey === 'connection' ||
            lowerKey === 'content-length') { // Remove Content-Length as we modified the body
            return;
        }

        if (lowerKey === 'x-frame-options') {
            return; // Remove
        }
        if (lowerKey === 'content-security-policy') {
            // Modify CSP: remove frame-ancestors
            const cspDirectives = value[0].split(';').map(d => d.trim());
            const filteredCsp = cspDirectives.filter(d => !d.toLowerCase().startsWith('frame-ancestors')).join('; ');
            if (filteredCsp) {
                 // Further modify CSP if needed, e.g., allow connections back to the proxy
                 // responseHeaders[key] = filteredCsp + "; connect-src 'self' " + proxyBaseUrl;
                 responseHeaders[key] = filteredCsp;
            }
            return;
        }
        // Handle Location header for redirects (if manual redirect handling wasn't sufficient)
        if (lowerKey === 'location') {
            try {
                const redirectedUrl = new URL(value[0], targetUrl).toString();
                responseHeaders[key] = `/proxy?url=${encodeURIComponent(redirectedUrl)}`;
            } catch (e) {
                console.error("Error processing Location header:", e);
                responseHeaders[key] = value; // Keep original if parsing fails
            }
            return;
        }

        // Keep other headers
        responseHeaders[key] = value;
    });

    // Set the processed headers on the response to the client
    res.writeHead(response.status, response.statusText, responseHeaders);

    // Send the modified body back to the client
    res.end(modifiedBody);

  } catch (error) { // Outer catch
    console.error(`Proxy error for ${targetUrl}:`, error);
    if (!res.headersSent) {
        res.status(500).send(`Proxy error: ${error.message}`);
    } else {
        console.error("Headers already sent, cannot send 500 status.");
        res.end();
    }
  }
});

// --- /proxy-headless route using Puppeteer ---
app.get('/proxy-headless', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('Missing target URL parameter');
  }

  let browser = null;
  let page = null;

  try {
    console.log(`Headless proxying request for: ${targetUrl}`);

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
    console.log(`Attempting to launch Puppeteer with executable: ${executablePath || 'default'}`);

    browser = await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--disable-features=site-per-process',
            '--disable-features=TranslateUI',
            '--disable-features=Translate',
            '--disable-breakpad',
            '--disable-crash-reporter',
            '--js-flags="--max-old-space-size=460"' // Limit JS memory
        ],
        executablePath: executablePath,
        protocolTimeout: 60000, // Increase protocol timeout to 60 seconds
        timeout: 60000, // Increase launch timeout to 60 seconds
        ignoreHTTPSErrors: true, // Ignore HTTPS errors
        headless: 'new' // Use new headless mode
    });
    console.log('Puppeteer browser launched.');

    page = await browser.newPage();
    console.log('New page created.');

    // Set viewport to a smaller size to reduce memory
    await page.setViewport({
        width: 1024,
        height: 768,
        deviceScaleFactor: 1
    });

    // Optimize page settings
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const resourceType = req.resourceType();
        // Block unnecessary resources
        if (resourceType === 'image' || 
            resourceType === 'stylesheet' || 
            resourceType === 'font' ||
            resourceType === 'media') {
            req.abort();
        } else {
            req.continue();
        }
    });

    // Set a realistic user agent
    await page.setUserAgent(req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36');
    console.log('User agent and page settings configured.');

    // Configure page timeouts and other settings
    await page.setDefaultNavigationTimeout(60000); // 60 seconds
    await page.setDefaultTimeout(60000);

    console.log(`Navigating to ${targetUrl}...`);
    const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded', // Changed from networkidle0 to domcontentloaded for faster loading
        timeout: 60000 // 60 seconds
    });
    console.log(`Navigation response status: ${response?.status()}`);

    if (!response || !response.ok()) {
        console.error(`Headless proxy failed during navigation for ${targetUrl}: Status ${response?.status()}`);
        if (browser) await browser.close();
        return res.status(response?.status() || 500).send(`Failed to load page: Status ${response?.status()}`);
    }

    // Wait a bit for dynamic content using proper timeout method
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Getting page content...');
    const content = await page.content();
    console.log('Page content retrieved.');

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Length');
    res.send(content);
    console.log(`Successfully proxied ${targetUrl}`);

  } catch (error) {
    console.error(`Headless proxy error for ${targetUrl}:`, error);
    if (page) {
        try {
            console.error("Page URL at time of error:", await page.url());
            console.error("Page metrics:", await page.metrics());
        } catch (metricsError) {
            console.error("Could not get page metrics:", metricsError);
        }
    }
    if (!res.headersSent) {
        res.status(500).send(`Headless proxy error: ${error.message}`);
    }
  } finally {
    if (browser) {
        console.log('Closing browser...');
        try {
            await browser.close();
            console.log('Browser closed.');
        } catch (closeError) {
            console.error('Error closing browser:', closeError);
        }
    }
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`CORS Proxy server listening at http://0.0.0.0:${port}`);
});