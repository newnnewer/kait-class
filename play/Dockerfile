# KAIT-PLAY 게임 서버
# Node 22.13 이상: 게임 기록 저장에 내장 SQLite(node:sqlite)를 추가 설정 없이 쓴다
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# 부품 먼저 설치 (코드만 바뀌었을 때 다시 받지 않게)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY problems ./problems
COPY scripts ./scripts

RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "server/index.js"]
