@echo off
REM Ligma Deployment Script for Digital Ocean (Windows)

echo.
echo 🚀 Ligma Deployment Helper
echo ==========================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not installed. Please install Docker Desktop first.
    echo    Visit: https://docs.docker.com/desktop/install/windows-install/
    pause
    exit /b 1
)

REM Check if docker-compose is installed
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker Compose is not installed. Please install Docker Desktop first.
    echo    Visit: https://docs.docker.com/desktop/install/windows-install/
    pause
    exit /b 1
)

echo ✅ Docker and Docker Compose are installed
echo.

REM Check if .env file exists
if not exist ".env" (
    echo ⚠️  .env file not found. Creating from .env.example...
    if exist ".env.example" (
        copy .env.example .env
        echo ✅ Created .env file. Please edit it with your actual values.
        echo    Opening .env in notepad...
        notepad .env
        echo.
        echo Press any key when you're done editing .env...
        pause >nul
    ) else (
        echo ❌ .env.example not found. Please create .env manually.
        pause
        exit /b 1
    )
)

echo 📦 Building Docker image...
docker-compose build

echo.
echo 🚀 Starting application...
docker-compose up -d

echo.
echo ⏳ Waiting for application to start...
timeout /t 10 /nobreak >nul

echo.
echo 🔍 Checking health...
curl -f http://localhost:10000/health >nul 2>&1
if errorlevel 1 (
    echo ❌ Application failed to start. Checking logs...
    docker-compose logs --tail=50
    pause
    exit /b 1
)

echo ✅ Application is running!
echo.
echo 📊 Application Info:
curl -s http://localhost:10000/health
echo.
echo.
echo 🎉 Deployment successful!
echo.
echo 📝 Next steps:
echo    1. Your app is running at: http://localhost:10000
echo    2. Health check: http://localhost:10000/health
echo    3. WebSocket endpoint: ws://localhost:10000/ligma-sync
echo.
echo 📋 Useful commands:
echo    View logs:    docker-compose logs -f
echo    Stop app:     docker-compose down
echo    Restart app:  docker-compose restart
echo    Rebuild:      docker-compose up -d --build
echo.
pause
