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

# Start Xvfb in the background (DISPLAY :99) then exec node — avoids xvfb-run's
# display-lock negotiation, which hung the container on Railway before node ran.
# Invoked via `bash` so it works regardless of the file's executable bit.
CMD ["bash", "start.sh"]
