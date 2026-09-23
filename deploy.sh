#!/bin/bash
# 8Token Deploy Script for VPS (Ubuntu 22.04)
# Usage: bash deploy.sh

set -e

echo "🚀 8Token Deployment Script"
echo "=========================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}❌ Não execute como root. Use um usuário com sudo.${NC}"
    exit 1
fi

# Step 1: System update
echo -e "\n${YELLOW}[1/7] Atualizando sistema...${NC}"
sudo apt update && sudo apt upgrade -y

# Step 2: Install Node.js 20 LTS
echo -e "\n${YELLOW}[2/7] Instalando Node.js 20 LTS...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    echo -e "${GREEN}✅ Node.js $(node --version) instalado${NC}"
else
    echo -e "${GREEN}✅ Node.js já instalado: $(node --version)${NC}"
fi

# Step 3: Install PM2
echo -e "\n${YELLOW}[3/7] Instalando PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✅ PM2 instalado${NC}"
else
    echo -e "${GREEN}✅ PM2 já instalado${NC}"
fi

# Step 4: Install Nginx
echo -e "\n${YELLOW}[4/7] Instalando Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    sudo apt install -y nginx
    echo -e "${GREEN}✅ Nginx instalado${NC}"
else
    echo -e "${GREEN}✅ Nginx já instalado${NC}"
fi

# Step 5: Install Certbot (SSL)
echo -e "\n${YELLOW}[5/7] Instalando Certbot (SSL)...${NC}"
if ! command -v certbot &> /dev/null; then
    sudo apt install -y certbot python3-certbot-nginx
    echo -e "${GREEN}✅ Certbot instalado${NC}"
else
    echo -e "${GREEN}✅ Certbot já instalado${NC}"
fi

# Step 6: Setup project directory
echo -e "\n${YELLOW}[6/7] Configurando diretório do projeto...${NC}"
PROJECT_DIR="/opt/8token"
if [ ! -d "$PROJECT_DIR" ]; then
    sudo mkdir -p "$PROJECT_DIR"
    sudo chown $USER:$USER "$PROJECT_DIR"
    echo -e "${GREEN}✅ Diretório $PROJECT_DIR criado${NC}"
else
    echo -e "${GREEN}✅ Diretório $PROJECT_DIR já existe${NC}"
fi

# Step 7: Install dependencies and setup
echo -e "\n${YELLOW}[7/7] Instalando dependências do projeto...${NC}"
cd "$PROJECT_DIR"

if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json não encontrado em $PROJECT_DIR${NC}"
    echo -e "${YELLOW}Copie os arquivos do projeto para $PROJECT_DIR primeiro:${NC}"
    echo -e "  scp -r \"F:/agentes ia/8Token/\"* $USER@$(hostname -I | awk '{print $1}'):$PROJECT_DIR/"
    exit 1
fi

npm install --production

# Check .env file
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  Arquivo .env não encontrado. Copie do .env.example:${NC}"
    echo -e "  cp .env.example .env"
    echo -e "  nano .env  # Edite com seus valores reais"
    exit 1
fi

# Setup Nginx config
echo -e "\n${YELLOW}Configurando Nginx...${NC}"
if [ -f "nginx.conf" ]; then
    sudo cp nginx.conf /etc/nginx/sites-available/8token.tech
    sudo ln -sf /etc/nginx/sites-available/8token.tech /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    echo -e "${GREEN}✅ Nginx configurado${NC}"
else
    echo -e "${YELLOW}⚠️  nginx.conf não encontrado. Configure manualmente.${NC}"
fi

# Start/Restart PM2
echo -e "\n${YELLOW}Iniciando aplicação com PM2...${NC}"
if pm2 list | grep -q "8token"; then
    pm2 restart 8token
    echo -e "${GREEN}✅ PM2 reiniciado${NC}"
else
    pm2 start server.js --name 8token
    echo -e "${GREEN}✅ PM2 iniciado${NC}"
fi

pm2 save
pm2 startup systemd -u $USER --hp /home/$USER 2>/dev/null || true

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deploy concluído com sucesso!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nPróximos passos:"
echo -e "  1. Configure o DNS na Hostinger:"
echo -e "     - A record: @ → $(hostname -I | awk '{print $1}')"
echo -e "     - A record: www → $(hostname -I | awk '{print $1}')"
echo -e "\n  2. Após propagar o DNS (5-10 min), gere o SSL:"
echo -e "     sudo certbot --nginx -d 8token.tech -d www.8token.tech"
echo -e "\n  3. Verifique os logs:"
echo -e "     pm2 logs 8token"
echo -e "\n  4. Monitore o status:"
echo -e "     pm2 status"
echo -e "     pm2 monit"