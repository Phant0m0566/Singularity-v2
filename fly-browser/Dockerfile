FROM node:22-alpine
WORKDIR /app
COPY fly-browser/package.json ./
RUN npm install --omit=dev
COPY fly-browser/server.mjs ./
COPY fly-browser/public ./public
COPY public/scram ./public/scram
COPY public/libcurl ./public/libcurl
COPY public/sw.js ./public/sw.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
