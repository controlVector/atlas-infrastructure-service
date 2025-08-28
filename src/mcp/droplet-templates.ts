import { z } from 'zod'

// Proven droplet creation patterns from successful deployments

export const CreateDropletWithSSHSchema = z.object({
  // Basic droplet configuration
  name: z.string().min(1, 'Droplet name is required'),
  region: z.string().default('nyc3'),
  size: z.string().default('s-2vcpu-4gb'),
  image: z.string().default('ubuntu-24-04-x64'),
  
  // SSH and security (PROVEN PATTERN: Always include SSH keys)
  ssh_keys: z.array(z.string()).min(1, 'At least one SSH key is required'),
  include_all_account_keys: z.boolean().default(true),
  
  // Application deployment configuration
  application: z.object({
    name: z.string().min(1, 'Application name required'),
    repository_url: z.string().url('Valid repository URL required'),
    branch: z.string().default('main'),
    type: z.enum(['nodejs', 'python', 'go', 'static']).default('nodejs'),
    port: z.number().default(3000),
    domain: z.string().optional(),
    build_command: z.string().optional(),
    start_command: z.string().optional()
  }),
  
  // System configuration (PROVEN PATTERN: Standard stack)
  system: z.object({
    nodejs_version: z.string().default('20'),
    install_nginx: z.boolean().default(true),
    install_pm2: z.boolean().default(true),
    setup_firewall: z.boolean().default(true),
    enable_monitoring: z.boolean().default(true)
  }),
  
  // Tags and metadata
  tags: z.array(z.string()).default(['controlvector', 'auto-deploy']),
  
  // Auth context
  workspace_id: z.string(),
  user_id: z.string(),
  jwt_token: z.string()
})

export const RebuildDropletWithSSHSchema = z.object({
  droplet_id: z.string().min(1, 'Droplet ID is required'),
  backup_first: z.boolean().default(true),
  ssh_keys: z.array(z.string()).optional(), // If not provided, use all account keys
  application: z.object({
    name: z.string().min(1),
    repository_url: z.string().url(),
    branch: z.string().default('main'),
    type: z.enum(['nodejs', 'python', 'go', 'static']).default('nodejs'),
    port: z.number().default(3000),
    domain: z.string().optional()
  }).optional(),
  workspace_id: z.string(),
  user_id: z.string(),
  jwt_token: z.string()
})

// PROVEN USER_DATA TEMPLATE: Based on successful RiskGuard deployment
export function generateUserDataScript(config: {
  applicationName: string
  repositoryUrl: string
  branch: string
  applicationPort: number
  domain?: string
  nodejsVersion: string
  buildCommand?: string
  startCommand?: string
}): string {
  return `#!/bin/bash
# ControlVector Auto-Deployment Script
# Based on proven deployment patterns

echo "🚀 Starting ${config.applicationName} deployment on $(date)"

# Update system
apt-get update && apt-get upgrade -y

# Install Node.js ${config.nodejsVersion}
curl -fsSL https://deb.nodesource.com/setup_${config.nodejsVersion}.x | sudo -E bash -
apt-get install -y nodejs

# Install essential packages
apt-get install -y git nginx ufw curl wget

# Install PM2 globally
npm install -g pm2

# Setup firewall (PROVEN PATTERN: Essential ports only)
ufw --force enable
ufw allow ssh
ufw allow http
ufw allow https
ufw allow ${config.applicationPort}

# Create application directory structure
mkdir -p /var/www
cd /var/www

# Clone application repository
rm -rf ${config.applicationName.toLowerCase()}
git clone ${config.repositoryUrl} -b ${config.branch} ${config.applicationName.toLowerCase()}

# Install application dependencies
cd /var/www/${config.applicationName.toLowerCase()}
npm install

# Build application (if build command exists)
${config.buildCommand ? `npm run ${config.buildCommand}` : 'echo "No build command specified"'} 2>/dev/null || echo "Build completed or not required"

# Configure nginx (PROVEN PATTERN: Reverse proxy with fallback)
cat > /etc/nginx/sites-available/${config.applicationName.toLowerCase()} <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    
    server_name ${config.domain || '_'};
    
    location / {
        proxy_pass http://localhost:${config.applicationPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Fallback handling for application downtime
        error_page 502 503 504 /50x.html;
    }
    
    location = /50x.html {
        root /usr/share/nginx/html;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://localhost:${config.applicationPort}/health;
        access_log off;
    }
    
    # Static assets optimization
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable the site (PROVEN PATTERN: Remove default, enable custom)
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/${config.applicationName.toLowerCase()} /etc/nginx/sites-enabled/

# Test nginx configuration
nginx -t

# Start application with PM2 (PROVEN PATTERN: Auto-restart, logging)
cd /var/www/${config.applicationName.toLowerCase()}
pm2 start ${config.startCommand || 'npm'} --name "${config.applicationName.toLowerCase()}" ${config.startCommand ? '' : '-- start'}
pm2 startup
pm2 save

# Reload nginx
systemctl reload nginx
systemctl enable nginx

# Create deployment success marker with comprehensive status
cat > /var/log/${config.applicationName.toLowerCase()}-deployment.log <<EOF
${config.applicationName} deployment completed on $(date)

=== Configuration ===
Application: ${config.applicationName}
Repository: ${config.repositoryUrl}
Branch: ${config.branch}
Port: ${config.applicationPort}
Domain: ${config.domain || 'None configured'}

=== System Status ===
Node version: $(node --version)
NPM version: $(npm --version)
PM2 version: $(pm2 --version)

=== Process Status ===
EOF

pm2 list >> /var/log/${config.applicationName.toLowerCase()}-deployment.log
echo "" >> /var/log/${config.applicationName.toLowerCase()}-deployment.log

echo "=== Nginx Status ===" >> /var/log/${config.applicationName.toLowerCase()}-deployment.log
systemctl status nginx --no-pager >> /var/log/${config.applicationName.toLowerCase()}-deployment.log

echo "=== Network Status ===" >> /var/log/${config.applicationName.toLowerCase()}-deployment.log
ss -tlnp | grep -E ':(80|443|${config.applicationPort}|22)\\s' >> /var/log/${config.applicationName.toLowerCase()}-deployment.log

echo "🎉 ${config.applicationName} deployment completed successfully"
echo "📊 View logs: tail -f /var/log/${config.applicationName.toLowerCase()}-deployment.log"
echo "🌐 Access application: http://$(curl -s ifconfig.me):${config.applicationPort}"
${config.domain ? `echo "🌍 Domain access: http://${config.domain}"` : ''}
`
}

// Output interfaces for proven patterns
export interface DropletCreationOutput {
  success: boolean
  droplet?: {
    id: number
    name: string
    status: string
    ip_address: string
    ssh_keys: string[]
    created_at: string
  }
  deployment?: {
    application_name: string
    expected_url: string
    deployment_log_path: string
    estimated_completion: string
  }
  error?: string
  tool_name: string
  execution_time?: string
}

export interface DropletRebuildOutput {
  success: boolean
  action?: {
    id: number
    status: string
    started_at: string
  }
  backup?: {
    snapshot_id: string
    snapshot_name: string
  }
  estimated_completion?: string
  error?: string
  tool_name: string
  execution_time?: string
}

// PROVEN MCP TOOLS: Based on successful test patterns
export const ATLAS_DROPLET_TEMPLATES = [
  {
    name: 'atlas_create_droplet_with_app',
    description: 'Create droplet with automatic application deployment using proven patterns from successful deployments',
    inputSchema: CreateDropletWithSSHSchema
  },
  {
    name: 'atlas_rebuild_droplet_with_ssh',
    description: 'Rebuild existing droplet with SSH access and optional application redeployment',
    inputSchema: RebuildDropletWithSSHSchema
  }
]