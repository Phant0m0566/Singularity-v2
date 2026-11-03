import api from "../api/worker.js";
import { handleWisp } from "./wisp.js";

export default {
	async fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);

		if (pathname === "/wisp" || pathname.startsWith("/wisp/")) return handleWisp(request);
		if (pathname === "/api/worker" || pathname.startsWith("/api/worker/")) return api.fetch(request, env, ctx);

		return env.ASSETS.fetch(request);
	},
};
