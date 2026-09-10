FROM node:20-alpine AS vendor
WORKDIR /vendor
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src /source
RUN node -e "const fs=require('fs'),b=require('@babel/standalone');for(const n of fs.readdirSync('/source').filter(n=>n.endsWith('.jsx'))){b.transform(fs.readFileSync('/source/'+n,'utf8'),{presets:['react']});console.log('JSX OK',n)}"
FROM vendor AS dom-test
COPY frontend/tests ./tests
CMD ["node", "tests/dom.test.cjs"]
FROM python:3.11-slim AS page
WORKDIR /app
COPY build.py .
COPY src ./src
RUN python build.py
FROM nginx:1.27-alpine
COPY --from=page /app/dist/index.html /usr/share/nginx/html/index.html
COPY --from=vendor /vendor/node_modules/react/umd/react.production.min.js /usr/share/nginx/html/vendor/react.js
COPY --from=vendor /vendor/node_modules/react-dom/umd/react-dom.production.min.js /usr/share/nginx/html/vendor/react-dom.js
COPY --from=vendor /vendor/node_modules/@babel/standalone/babel.min.js /usr/share/nginx/html/vendor/babel.js
COPY --from=vendor /vendor/node_modules/@xterm/xterm/lib/xterm.js /usr/share/nginx/html/vendor/xterm.js
COPY --from=vendor /vendor/node_modules/@xterm/xterm/css/xterm.css /usr/share/nginx/html/vendor/xterm.css
COPY --from=vendor /vendor/node_modules/@xterm/addon-fit/lib/addon-fit.js /usr/share/nginx/html/vendor/xterm-fit.js
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
