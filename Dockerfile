FROM node:22-slim

# espeak-ng: offline text-to-speech narration engine
# fonts-noto-cjk: Japanese/CJK glyphs for burned-in subtitles
RUN apt-get update \
    && apt-get install -y --no-install-recommends espeak-ng fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
