# Use a specific node version for stability
FROM node:20-slim

# Install openssl as it's required by Prisma
RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

# Copy only package files first to leverage Docker cache
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies needed for build)
RUN npm install

# Copy the rest of the app
COPY . .

# Generate Prisma Client explicitly for the Linux environment
RUN npx prisma generate

# Set production environment variables for the build
ENV NODE_ENV=production

# Run the build
RUN npm run build

# Final command
CMD ["npm", "run", "docker-start"]