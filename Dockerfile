# API SIG - Deploy Fly.io
FROM node:20-alpine

WORKDIR /app

# Copiar dependências
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copiar código e frontend
COPY . .

# Criar pastas de upload (o volume do Fly monta em /app/uploads)
RUN mkdir -p uploads/transformado

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
