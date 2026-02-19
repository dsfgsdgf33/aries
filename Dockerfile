FROM node:20-slim

LABEL maintainer="Aries Team"
LABEL description="ARIES — Personal AI Command Center"

# Create app directory
WORKDIR /app

# Copy application files (no npm install needed — zero dependencies!)
COPY . .

# Create data directory
RUN mkdir -p data backups logs

# Expose ports
# 3333 = Web Dashboard
# 18800 = AI Gateway (OpenAI-compatible API)
EXPOSE 3333 18800

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s \
  CMD node -e "const h=require('http');h.get('http://localhost:3333/api/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Persist data
VOLUME ["/app/data", "/app/backups"]

# Start Aries
CMD ["node", "launcher.js"]
