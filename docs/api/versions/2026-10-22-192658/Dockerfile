FROM node:22-slim

WORKDIR /app

# 先装依赖(含 devDependencies:运行时需要 tsx,构建需要 vite/tsc)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 构建前端到 dist/,server 在 --production 模式下托管该目录
RUN npm run build

# 创空间要求监听 0.0.0.0:7860
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860

EXPOSE 7860

CMD ["npm", "run", "start"]
