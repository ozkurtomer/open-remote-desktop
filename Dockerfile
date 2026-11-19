FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY viewer ./viewer
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
VOLUME /data
CMD ["node", "server/server.js"]
