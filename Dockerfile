# Build stage
FROM golang:alpine AS be-build

WORKDIR /app

COPY be .

RUN go get ./...

RUN go build ./...

FROM node:16 AS fe-build

# setup fallback self-signed tls
COPY setup.sh .
RUN ./setup.sh

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY fe/package*.json ./

# Install dependencies
RUN npm ci

# Copy all files
COPY fe .

# Build the app
RUN npm run build

# Production stage
FROM nginx:stable-alpine

RUN apk add openssl

# Copy built assets from build stage
COPY --from=be-build /app/anjuna-planning-poker /backend
COPY --from=fe-build /app/build /usr/share/nginx/html
COPY --from=fe-build /opt/sstls /opt/sstls

# Add your custom nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /entrypoint.sh

# Expose port 80
EXPOSE 80

# Start Nginx server
CMD ["/entrypoint.sh"]