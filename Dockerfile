# Headed Chromium under xvfb — headless is blocked by nadlan's reCAPTCHA v3
# (PH1 spike: headless 0/3 token-verify, headed 5/5). The Playwright base image
# bundles Chromium + all OS deps + xvfb-run, and ships a compatible Node (>=20).
# The tag MUST match the playwright version in package.json (1.61.0).
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

ENV NODE_ENV=production
WORKDIR /app

# Browsers are already in the base image — skip Playwright's browser download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 8080

# xvfb-run gives the HEADED browser a virtual display inside the container.
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x1024x24", "npx", "tsx", "src/index.ts"]
