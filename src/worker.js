import { connect } from "cloudflare:sockets";

const CONNECT = 0x01, DATA = 0x02, CONTINUE = 0x03, CLOSE = 0x04;

const VOLUNTARY = 0x02, NETWORK_ERROR = 0x03, INVALID = 0x41,
      UNREACHABLE = 0x42, BLOCKED = 0x48, THROTTLED = 0x49;

const MAX_STREAMS_PER_CONN = 50;
const BUFFER = 128;            
const CHUNK = 16 * 1024;           
const ALLOWED_PORTS = new Set([80, 443]);

function packet(type, id, payload) {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, id, true);
  out.set(payload, 5);
  return out;
}
function continuePkt(id, n) {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setUint32(0, n, true);
  return packet(CONTINUE, id, p);
}
const closePkt = (id, reason) => packet(CLOSE, id, Uint8Array.of(reason));

function isBlockedHost(host) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return true; 
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
           (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
           (a === 100 && b >= 64 && b <= 127);
  }
  return false;
}

function handleWisp(ws) {
  ws.binaryType = "arraybuffer";
  const streams = new Map(); 
  const send = (bytes) => { try { ws.send(bytes); } catch {} };

  function closeStream(id, notify, reason = VOLUNTARY) {
    const s = streams.get(id);
    if (!s) return;
    streams.delete(id);
    s.reader.cancel().catch(() => {});
    s.writer.abort().catch(() => {});
    s.socket.close().catch(() => {});
    if (notify) send(closePkt(id, reason));
  }

  async function pump(id, s) {
    try {
      while (true) {
        const { value, done } = await s.reader.read();
        if (done) break;
        for (let i = 0; i < value.length; i += CHUNK) {
          send(packet(DATA, id, value.subarray(i, i + CHUNK)));
        }
      }
      closeStream(id, true, VOLUNTARY);
    } catch {
      closeStream(id, true, NETWORK_ERROR);
    }
  }

  function openStream(id, payload) {
    if (id === 0 || streams.has(id)) return;
    if (streams.size >= MAX_STREAMS_PER_CONN) return send(closePkt(id, THROTTLED));
    if (payload.length < 4) return send(closePkt(id, INVALID));

    const streamType = payload[0];
    const port = new DataView(payload.buffer, payload.byteOffset).getUint16(1, true);
    const hostname = new TextDecoder().decode(payload.subarray(3));

    if (streamType !== 0x01) return send(closePkt(id, BLOCKED)); 
    if (!ALLOWED_PORTS.has(port) || isBlockedHost(hostname)) return send(closePkt(id, BLOCKED));

    let socket;
    try { socket = connect({ hostname, port }); }
    catch { return send(closePkt(id, UNREACHABLE)); }

    const s = {
      socket,
      reader: socket.readable.getReader(),
      writer: socket.writable.getWriter(),
      queue: Promise.resolve(),
      pending: 0,
      processed: 0,
    };
    streams.set(id, s);
    socket.opened.catch(() => closeStream(id, true, UNREACHABLE));
    pump(id, s);
  }

  function writeStream(id, payload) {
    const s = streams.get(id);
    if (!s) return;
    const chunk = payload.slice(); 
    s.pending++;
    s.queue = s.queue
      .then(() => s.writer.write(chunk))
      .then(() => {
        s.pending--;
        s.processed++;
        if (s.processed % (BUFFER / 2) === 0) send(continuePkt(id, BUFFER - s.pending));
      })
      .catch(() => closeStream(id, true, NETWORK_ERROR));
  }

  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") return;
    const data = new Uint8Array(event.data);
    if (data.length < 5) return;
    const type = data[0];
    const id = new DataView(data.buffer, data.byteOffset).getUint32(1, true);
    const payload = data.subarray(5);
    if (type === CONNECT) openStream(id, payload);
    else if (type === DATA) writeStream(id, payload);
    else if (type === CLOSE) closeStream(id, false);
  });

  const closeAll = () => { for (const id of [...streams.keys()]) closeStream(id, false); };
  ws.addEventListener("close", closeAll);
  ws.addEventListener("error", closeAll);

  send(continuePkt(0, BUFFER)); 
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/wisp/") return new Response("wisp server is up\n");
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const allowed = (env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
    const origin = request.headers.get("Origin");
    if (allowed.length && !allowed.includes(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    handleWisp(server);
    return new Response(null, { status: 101, webSocket: client });
  },
};
