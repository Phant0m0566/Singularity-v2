FROM node:22-alpine
WORKDIR /app
COPY fly-browser/package.json ./
RUN npm install --omit=dev
COPY fly-browser/server.mjs ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
