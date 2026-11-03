import { connect } from "cloudflare:sockets";

// wisp v1 server on top of workers tcp sockets
// https://github.com/MercuryWorkshop/wisp-protocol

const CONNECT = 0x01;
const DATA = 0x02;
const CONTINUE = 0x03;
const CLOSE = 0x04;

const TCP = 0x01;

const CLOSE_VOLUNTARY = 0x02;
const CLOSE_NETWORK = 0x03;
const CLOSE_INVALID = 0x41;
const CLOSE_UNREACHABLE = 0x42;
const CLOSE_BLOCKED = 0x48;

const BUFFER = 128;

const PRIVATE_HOST =
	/^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]*:.*)$/i;

function packet(type, id, payload) {
	const out = new Uint8Array(5 + (payload ? payload.byteLength : 0));
	const view = new DataView(out.buffer);
	view.setUint8(0, type);
	view.setUint32(1, id, true);
	if (payload) out.set(payload, 5);
	return out;
}

function u32(n) {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n, true);
	return b;
}

export function handleWisp(request) {
	if (request.headers.get("Upgrade") !== "websocket") {
		return new Response("wisp server is up", { status: 200 });
	}

	const [client, ws] = Object.values(new WebSocketPair());
	ws.accept();

	const streams = new Map();
	let closed = false;

	const send = (data) => {
		if (closed) return;
		try {
			ws.send(data);
		} catch {
			closed = true;
		}
	};

	const closeStream = (id, reason, notify) => {
		const s = streams.get(id);
		if (!s) return;
		streams.delete(id);
		try {
			s.writer.releaseLock();
		} catch {}
		try {
			s.socket.close();
		} catch {}
		if (notify) send(packet(CLOSE, id, Uint8Array.of(reason)));
	};

	const open = (id, payload) => {
		if (payload.byteLength < 3) return send(packet(CLOSE, id, Uint8Array.of(CLOSE_INVALID)));
		const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
		const kind = view.getUint8(0);
		const port = view.getUint16(1, true);
		const host = new TextDecoder().decode(payload.subarray(3)).trim();

		// workers can't do udp, smtp is blocked by cloudflare anyway
		if (kind !== TCP || !host || port === 0 || port === 25) {
			return send(packet(CLOSE, id, Uint8Array.of(CLOSE_INVALID)));
		}
		if (PRIVATE_HOST.test(host)) return send(packet(CLOSE, id, Uint8Array.of(CLOSE_BLOCKED)));

		let socket;
		try {
			socket = connect({ hostname: host, port });
		} catch {
			return send(packet(CLOSE, id, Uint8Array.of(CLOSE_UNREACHABLE)));
		}

		const stream = { socket, writer: socket.writable.getWriter(), received: 0, queue: Promise.resolve() };
		streams.set(id, stream);

		socket.closed
			.then(() => streams.has(id) && closeStream(id, CLOSE_VOLUNTARY, true))
			.catch(() => streams.has(id) && closeStream(id, CLOSE_NETWORK, true));

		(async () => {
			const reader = socket.readable.getReader();
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					if (!streams.has(id)) break;
					send(packet(DATA, id, value));
				}
			} catch {}
			if (streams.has(id)) closeStream(id, CLOSE_VOLUNTARY, true);
		})();
	};

	const write = (id, payload) => {
		const s = streams.get(id);
		if (!s) return;
		const chunk = payload.slice();
		s.queue = s.queue
			.then(() => s.writer.write(chunk))
			.then(() => {
				s.received++;
				// hand the client its buffer back once half of it has been flushed
				if (s.received >= BUFFER / 2) {
					s.received = 0;
					send(packet(CONTINUE, id, u32(BUFFER)));
				}
			})
			.catch(() => closeStream(id, CLOSE_NETWORK, true));
	};

	const handle = (data) => {
		if (data.byteLength < 5) return;
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const type = view.getUint8(0);
		const id = view.getUint32(1, true);
		const payload = data.subarray(5);

		if (type === CONNECT) open(id, payload);
		else if (type === DATA) write(id, payload);
		else if (type === CLOSE) closeStream(id, CLOSE_VOLUNTARY, false);
	};

	// binary frames can show up as a Blob, which has to be read async, so keep
	// packets in order with a queue
	let inbox = Promise.resolve();
	ws.addEventListener("message", (event) => {
		const raw = event.data;
		if (typeof raw === "string") return;
		inbox = inbox
			.then(async () => handle(new Uint8Array(raw instanceof ArrayBuffer ? raw : await raw.arrayBuffer())))
			.catch(() => {});
	});

	const shutdown = () => {
		closed = true;
		for (const id of [...streams.keys()]) closeStream(id, CLOSE_VOLUNTARY, false);
	};
	ws.addEventListener("close", shutdown);
	ws.addEventListener("error", shutdown);

	// stream 0 continue = "this is a wisp v1 server, here's your buffer"
	send(packet(CONTINUE, 0, u32(BUFFER)));

	return new Response(null, { status: 101, webSocket: client });
}
