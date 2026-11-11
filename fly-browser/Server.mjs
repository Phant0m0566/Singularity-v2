import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

logging.set_level(logging.WARN);

wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
wisp.options.allow_udp_streams = false;
wisp.options.port_whitelist = [80, 443];
wisp.options.stream_limit_per_conn = 50;
wisp.options.stream_limit_total = 2000;
wisp.options.parse_real_ip = true;

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json",
	".wasm": "application/wasm",
	".ico": "image/x-icon",
	".png": "image/png",
	".css": "text/css; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".json", ".wasm", ".css"]);
const gzipCache = new Map();

function cacheControl(pathname) {
	if (pathname === "/sw.js" || pathname === "/index.html") return "no-cache";
	if (pathname.startsWith("/scram/") || pathname.startsWith("/libcurl/")) {
		return "public, max-age=86400, stale-while-revalidate=604800";
	}
	return "public, max-age=3600";
}

function serve(req, res) {
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
	} catch {
		res.writeHead(400);
		return res.end("Bad request");
	}
	if (pathname.endsWith("/")) pathname += "index.html";

	const file = path.normalize(path.join(ROOT, pathname));
	if (!file.startsWith(ROOT + path.sep)) {
		res.writeHead(403);
		return res.end("Forbidden");
	}

	fs.stat(file, (err, st) => {
		if (err || !st.isFile()) {
			res.writeHead(404, { "Content-Type": "text/plain" });
			return res.end("Not found");
		}
		const ext = path.extname(file).toLowerCase();
		const headers = {
			"Content-Type": TYPES[ext] || "application/octet-stream",
			"Cache-Control": cacheControl(pathname),
			Vary: "Accept-Encoding",
		};
		const wantsGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");

		if (!wantsGzip) {
			headers["Content-Length"] = st.size;
			res.writeHead(200, headers);
			return req.method === "HEAD" ? res.end() : fs.createReadStream(file).pipe(res);
		}

		const key = file + ":" + st.mtimeMs;
		let buf = gzipCache.get(key);
		if (!buf) {
			buf = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
			gzipCache.set(key, buf);
		}
		headers["Content-Encoding"] = "gzip";
		headers["Content-Length"] = buf.length;
		res.writeHead(200, headers);
		res.end(req.method === "HEAD" ? undefined : buf);
	});
}

const server = http.createServer(serve);

server.on("upgrade", (req, socket, head) => {
	const origin = req.headers.origin;
	let originOk = false;
	try {
		originOk = !!origin && (new URL(origin).host === req.headers.host || EXTRA_ORIGINS.includes(origin));
	} catch {}

	if (req.url === "/wisp/" && originOk) wisp.routeRequest(req, socket, head);
	else socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => console.log("browser + wisp listening on :" + PORT));
