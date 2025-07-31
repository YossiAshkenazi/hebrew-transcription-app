FROM node:18-alpine

# Install ffmpeg for audio processing
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create upload directories
RUN mkdir -p uploads temp

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
