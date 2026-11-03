# What is Singularity?

# Singularity Is an Unblocked Games Website Made By Yours Truly Singularity! 

**We Have Music,Chat,Games,Browser, And So Much More!**

## Browser (Scramjet)

The Browser tab runs Scramjet with the libcurl transport. Traffic goes through a wisp server, and the Cloudflare worker (`worker/`) has one built in at `/wisp/`, so it works with no extra setup once the worker is deployed.

Limits of the built-in one: Cloudflare doesn't let workers open TCP connections to Cloudflare IPs, so sites behind Cloudflare won't load through it, and each session only gets a handful of sockets at once. For full coverage run `wisp/` on any host with websockets:

```bash
cd wisp
npm install
npm start
```

Then build with `VITE_WISP_URL=wss://your-wisp-host/`, or override it per browser with `localStorage.singularity_wisp`.
