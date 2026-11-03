# What is Singularity?

# Singularity Is an Unblocked Games Website Made By Yours Truly Singularity! 

**We Have Music,Chat,Games,Browser, And So Much More!**

## Browser (Scramjet)

The Browser tab runs Scramjet with the libcurl transport. It needs a wisp server to send traffic through, and Vercel can't host websockets, so run `wisp/` somewhere that can (Render, Railway, Fly, a VPS, a Pi):

```bash
cd wisp
npm install
npm start
```

Then point the site at it with `VITE_WISP_URL=wss://your-wisp-host/` when building. Without it the site tries `wss://<same host>/wisp/`. You can also override it per browser by setting `localStorage.singularity_wisp`.
