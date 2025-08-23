# Atlas - ControlVector Infrastructure Agent

Atlas is the infrastructure deployment and management agent for the ControlVector platform. It provides cloud-agnostic infrastructure provisioning, cost tracking, and lifecycle management across multiple cloud providers.

## 🏗️ Overview

Atlas serves as the bridge between infrastructure requests and cloud providers, handling:

- **Multi-cloud Provisioning**: Deploy resources across DigitalOcean, AWS, GCP, Azure
- **Cost Management**: Real-time cost estimation and tracking  
- **Lifecycle Management**: Create, update, scale, and destroy infrastructure
- **Security Integration**: Secure credential management via CV Context Manager
- **Operation Tracking**: Monitor deployment progress and health

## 🚀 Quick Start

### 1. Installation

```bash
npm install
```

### 2. Environment Configuration

```bash
# Core Configuration
PORT=3003
NODE_ENV=development
LOG_LEVEL=info

# Cloud Provider Credentials (optional - can be managed via Context Manager)
DIGITALOCEAN_API_TOKEN=your_do_token
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
```

### 3. Start Development Server

```bash
npm run dev
```

Atlas will be available at `http://localhost:3003`

### 4. Run Tests

```bash
npm test
```

## 🌐 API Endpoints

### Infrastructure Management

```bash
# Create infrastructure
POST /api/v1/infrastructure
{
  "name": "my-web-app",
  "provider": "digitalocean",
  "region": "nyc3",
  "resources": [
    {
      "type": "droplet",
      "name": "web-server",
      "specifications": {
        "size": "s-1vcpu-1gb",
        "image": "ubuntu-22-04-x64"
      }
    }
  ]
}

# Get infrastructure
GET /api/v1/infrastructure/{id}

# List workspace infrastructure  
GET /api/v1/infrastructure

# Update infrastructure
PUT /api/v1/infrastructure/{id}

# Destroy infrastructure
DELETE /api/v1/infrastructure/{id}
```

### Operations & Monitoring

```bash
# Get deployment operation status
GET /api/v1/operations/{id}

# List operations for infrastructure
GET /api/v1/infrastructure/{id}/operations

# Estimate costs
POST /api/v1/estimate-cost
{
  "name": "cost-estimate",
  "provider": "digitalocean",
  "region": "nyc3",
  "resources": [...]
}

# Get workspace statistics
GET /api/v1/stats
```

### Provider Information

```bash
# List available providers
GET /api/v1/providers

# Get provider details
GET /api/v1/providers/digitalocean

# Health check
GET /api/v1/health
```

## 🔧 Architecture

### Core Components

1. **InfrastructureService**: Main business logic for infrastructure management
2. **DigitalOceanProvider**: Cloud provider implementation for DigitalOcean  
3. **ContextService**: Integration with CV Context Manager for credentials
4. **InfrastructureController**: REST API endpoints
5. **Type System**: Comprehensive TypeScript definitions

### Provider Interface

Atlas uses a plugin architecture for cloud providers:

```typescript
interface CloudProviderInterface {
  name: CloudProvider
  regions: string[]
  resource_types: ResourceType[]
  
  createResource(type: ResourceType, spec: ResourceSpec): Promise<InfrastructureResource>
  updateResource(id: string, spec: Partial<ResourceSpec>): Promise<InfrastructureResource>
  deleteResource(id: string): Promise<void>
  getResource(id: string): Promise<InfrastructureResource | null>
  estimateCost(spec: ResourceSpec): Promise<number>
}
```

## 🏢 Supported Providers & Resources

### DigitalOcean ✅

- **Droplets**: Virtual machines with various sizes
- **Volumes**: Block storage volumes
- **Databases**: Managed PostgreSQL, MySQL, Redis
- **Load Balancers**: HTTP/HTTPS load balancing
- **Firewalls**: Security group management
- **VPCs**: Private networking
- **Domains**: DNS management
- **CDN**: Content delivery networks

### Coming Soon

- **AWS**: EC2, EBS, RDS, ELB, VPC
- **Google Cloud**: Compute Engine, Cloud SQL, Load Balancing
- **Azure**: Virtual Machines, Storage, SQL Database

## 💰 Cost Management

Atlas provides comprehensive cost tracking:

- **Real-time Estimation**: Get costs before deployment
- **Usage Tracking**: Monitor actual costs vs estimates  
- **Budget Controls**: Set limits and alerts
- **Resource Optimization**: Recommendations for cost savings

### Cost Example

```typescript
// Estimate costs before deployment
const estimate = await atlas.estimateCost({
  provider: 'digitalocean',
  resources: [
    { type: 'droplet', specifications: { size: 's-1vcpu-1gb' } },
    { type: 'volume', specifications: { size_gigabytes: 100 } }
  ]
})

console.log(`Estimated monthly cost: $${estimate}`)
// Output: Estimated monthly cost: $16.40
```

## 🔒 Security & Integration

### Context Manager Integration

Atlas integrates with the CV Context Manager for secure credential storage:

```typescript
// Credentials are automatically retrieved from Context Manager
const credentials = await contextService.getProviderCredentials(
  workspaceId,
  userId,
  'digitalocean',
  jwtToken
)

// SSH keys are managed centrally
const sshKeys = await contextService.getSSHKeys(workspaceId, userId)
```

### Security Features

- **Encrypted Credentials**: All cloud provider credentials encrypted at rest
- **Workspace Isolation**: Resources scoped to workspaces
- **Audit Logging**: All operations tracked for compliance
- **JWT Authentication**: Secure API access
- **RBAC**: Role-based access control (via Context Manager)

## 📊 Monitoring & Operations

### Deployment Tracking

Every infrastructure operation is tracked:

```typescript
interface DeploymentOperation {
  id: string
  operation_type: 'create' | 'update' | 'destroy'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  total_steps: number
  completed_steps: number
  current_step?: string
  created_resources: string[]
  cost_change: number
}
```

### Health Monitoring

- **Service Health**: `/api/v1/health` endpoint
- **Provider Connectivity**: Test cloud provider connections
- **Resource Health**: Monitor infrastructure health
- **Performance Metrics**: Track operation success rates

## 🧪 Testing

Atlas includes comprehensive test coverage:

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Infrastructure Example

```typescript
const result = await infrastructureService.createInfrastructure(
  'test-user',
  'test-workspace',
  {
    name: 'test-app',
    provider: 'digitalocean',
    region: 'nyc3',
    resources: [
      {
        type: 'droplet',
        name: 'web-server',
        specifications: {
          size: 's-1vcpu-1gb',
          image: 'ubuntu-22-04-x64'
        }
      }
    ]
  }
)
```

## 🔗 Integration with ControlVector

Atlas works seamlessly with other ControlVector services:

- **CV Context Manager**: Secure credential and context storage
- **Watson**: Orchestration and multi-agent coordination  
- **Phoenix**: Advanced deployment patterns and CI/CD
- **Sherlock**: Security monitoring and compliance

## 📈 Roadmap

- [ ] **AWS Provider**: Full EC2, RDS, ELB support
- [ ] **GCP Provider**: Compute Engine, Cloud SQL integration
- [ ] **Azure Provider**: Virtual Machines, Storage accounts
- [ ] **Kubernetes**: Native K8s cluster management
- [ ] **Terraform Integration**: Import existing infrastructure
- [ ] **Auto-scaling**: Dynamic resource scaling
- [ ] **Blue/Green Deployments**: Zero-downtime deployments
- [ ] **Multi-region**: Cross-region deployments
- [ ] **Cost Optimization**: AI-powered resource recommendations

## 🤝 Contributing

Atlas is part of the ControlVector platform. See the main repository for contribution guidelines.

## 📄 License

MIT License - see LICENSE file for details.

---

**Atlas** - *Deploy cloud infrastructure with confidence* 🚀