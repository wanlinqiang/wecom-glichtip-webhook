FROM node:20-bullseye-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY app.js ./

EXPOSE 3123

CMD ["node", "app.js"]
