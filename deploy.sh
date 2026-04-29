#!/bin/bash

# Ligma Deployment Script for Digital Ocean
# This script helps you deploy Ligma to Digital Ocean

set -e

echo "🚀 Ligma Deployment Helper"
echo "=========================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ Created .env file. Please edit it with your actual values:"
        echo "   nano .env"
        echo ""
        echo "Press Enter when you're done editing .env..."
        read
    else
        echo "❌ .env.example not found. Please create .env manually."
        exit 1
    fi
fi

echo "📦 Building Docker image..."
docker-compose build

echo ""
echo "🚀 Starting application..."
docker-compose up -d

echo ""
echo "⏳ Waiting for application to start..."
sleep 10

echo ""
echo "🔍 Checking health..."
if curl -f http://localhost:10000/health > /dev/null 2>&1; then
    echo "✅ Application is running!"
    echo ""
    echo "📊 Application Info:"
    curl -s http://localhost:10000/health | python3 -m json.tool || curl -s http://localhost:10000/health
    echo ""
    echo ""
    echo "🎉 Deployment successful!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Your app is running at: http://localhost:10000"
    echo "   2. Health check: http://localhost:10000/health"
    echo "   3. WebSocket endpoint: ws://localhost:10000/ligma-sync"
    echo ""
    echo "📋 Useful commands:"
    echo "   View logs:    docker-compose logs -f"
    echo "   Stop app:     docker-compose down"
    echo "   Restart app:  docker-compose restart"
    echo "   Rebuild:      docker-compose up -d --build"
    echo ""
else
    echo "❌ Application failed to start. Checking logs..."
    docker-compose logs --tail=50
    exit 1
fi
