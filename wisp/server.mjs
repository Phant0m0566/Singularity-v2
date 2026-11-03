import http from "node:http";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const PORT = Number(process.env.PORT) || 8080;

logging.set_level(logging.WARN);
// don't let the proxy reach the box it runs on or the local network
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;

const server = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("wisp server is up\n");
});

server.on("upgrade", (req, socket, head) => {
	if (req.url.endsWith("/")) wisp.routeRequest(req, socket, head);
	else socket.end();
});

server.listen(PORT, () => console.log("wisp listening on :" + PORT));
