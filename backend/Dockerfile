FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --production=false
COPY src ./src
RUN npm run build
CMD ["node", "dist/index.js"]
