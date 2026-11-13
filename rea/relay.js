// Local no-auth CONNECT relay for Chromium: Chromium -> 127.0.0.1:18080
// -> egress proxy (from $https_proxy, with Basic auth) -> target:443.
// Chromium's own CONNECT to the egress proxy fails with
// ERR_TUNNEL_CONNECTION_FAILED while curl succeeds with identical
// credentials, so this relay reproduces curl's exact CONNECT handshake.
// Usage: node relay.js  (runs in foreground; set RELAY_PORT)
const net = require('net');
const raw = process.env.https_proxy || process.env.HTTPS_PROXY || '';
if (!raw) { console.log('[relay] no https_proxy set — nothing to relay, exiting'); process.exit(0); }
const u = new URL(raw);
const EGRESS_HOST = u.hostname, EGRESS_PORT = Number(u.port) || 3128;
const AUTH = 'Basic ' + Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password)).toString('base64');
const PORT = Number(process.env.RELAY_PORT || 18080);
const server = net.createServer(client => {
  let buf = Buffer.alloc(0);
  const onData = chunk => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end === -1) return;
    client.removeListener('data', onData);
    const head = buf.slice(0, end).toString();
    const first = head.split('\r\n')[0];
    const m = first.match(/^CONNECT\s+(\S+)\s+HTTP\/1\.1/i);
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const target = m[1];
    const upstream = net.connect(EGRESS_PORT, EGRESS_HOST, () => {
      upstream.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${AUTH}\r\nProxy-Connection: Keep-Alive\r\n\r\n`);
    });
    let upBuf = Buffer.alloc(0);
    upstream.on('data', chunk => {
      if (client.destroyed) return;
      if (!upstream._tunneled) {
        upBuf = Buffer.concat([upBuf, chunk]);
        const e2 = upBuf.indexOf('\r\n\r\n');
        if (e2 === -1) return;
        const status = upBuf.slice(0, e2).toString().split('\r\n')[0];
        if (!/ 200 /.test(status)) { console.log('[relay] egress refused', target, status); client.end(); upstream.end(); return; }
        upstream._tunneled = true;
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const rest = upBuf.slice(e2 + 4); if (rest.length) client.write(rest);
        upstream.pipe(client); client.pipe(upstream);
      }
    });
    upstream.on('error', e => { console.log('[relay] upstream error', target, e.message); client.end(); });
    client.on('error', () => upstream.end());
  };
  client.on('data', onData);
  client.on('error', () => {});
});
server.listen(PORT, '127.0.0.1', () => console.log(`[relay] listening 127.0.0.1:${PORT} -> ${EGRESS_HOST}:${EGRESS_PORT}`));
