'use strict';
// Test-only, real loopback HTTP response. Do not combine CDP fulfill with
// Electron webRequest filtering: that combination can expose status 0.
function createControlledProviderBoundary() {
  let handler = null;
  const errors = [];
  const middleware = (request, response, next) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!handler || !url.pathname.startsWith('/api/proxy/')) return next();
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    let size = 0; const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= 65536) chunks.push(chunk);
    });
    request.on('end', async () => {
      if (size > 65536) return send(413, { success: false, error: 'Owned fixture payload too large' });
      let payload;
      try { payload = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; }
      catch { return send(400, { success: false, error: 'Invalid owned fixture JSON' }); }
      try {
        const result = await handler({ method: request.method, pathname: url.pathname, query: url.searchParams, payload });
        if (!result) return send(403, { success: false, error: 'Unconfigured Provider boundary' });
        send(result.status, result.body);
      } catch (error) {
        errors.push(String(error.message).slice(0, 500));
        send(500, { success: false, error: 'Controlled Provider assertion failed' });
      }
    });
  };
  return { middleware, errors, setHandler(value) { handler = value; } };
}
module.exports = { createControlledProviderBoundary };
