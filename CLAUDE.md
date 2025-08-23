# Atlas Infrastructure Agent

## Purpose & Agent Assignment
- **Primary Agent**: Atlas (Infrastructure Deployment Specialist)
- **Service Role**: Multi-cloud infrastructure provisioning and lifecycle management
- **Key Capabilities**: 
  - Cloud resource provisioning (Droplets, Databases, Load Balancers)
  - Cost estimation and tracking
  - Multi-cloud provider abstraction
  - Infrastructure lifecycle management (create, update, destroy)
  - Integration with CV Context Manager for secure credential storage

## Technical Stack
- **Framework**: Node.js with TypeScript
- **Runtime**: Fastify for high-performance API serving
- **Providers**: 
  - DigitalOcean (fully implemented)
  - AWS, GCP, Azure (planned)
- **External Dependencies**:
  - @fastify/cors, @fastify/helmet for security
  - axios for cloud provider API calls
  - zod for request validation
  - uuid for resource identification

## Integration Points
- **APIs Provided**:
  - `POST /api/v1/infrastructure` - Create new infrastructure
  - `GET /api/v1/infrastructure` - List workspace infrastructure
  - `GET /api/v1/infrastructure/{id}` - Get specific infrastructure
  - `PUT /api/v1/infrastructure/{id}` - Update infrastructure
  - `DELETE /api/v1/infrastructure/{id}` - Destroy infrastructure
  - `GET /api/v1/operations/{id}` - Get deployment operation status
  - `POST /api/v1/estimate-cost` - Estimate infrastructure costs
  - `GET /api/v1/providers` - List available cloud providers
  - `GET /api/v1/stats` - Get workspace infrastructure statistics
  - `GET /api/v1/health` - Service health check

- **APIs Consumed**:
  - DigitalOcean API: Resource provisioning and management
  - CV Context Manager: Credential storage and retrieval (`http://localhost:3002`)

- **Event Publications**:
  - `infrastructure.created` - New infrastructure provisioned
  - `infrastructure.updated` - Infrastructure modified
  - `infrastructure.destroyed` - Infrastructure decommissioned
  - `deployment.started` - Deployment operation begun
  - `deployment.completed` - Deployment operation finished
  - `deployment.failed` - Deployment operation failed

## Development Setup

### Prerequisites
- Node.js 18+
- Running CV Context Manager (for credential storage)
- Cloud provider API tokens (optional for testing)

### Environment Configuration
```env
# Core Configuration
NODE_ENV=development
PORT=3003
HOST=0.0.0.0
LOG_LEVEL=info

# Cloud Provider Credentials (optional - can be stored in Context Manager)
DIGITALOCEAN_API_TOKEN=your_do_token
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret

# Context Manager Integration
CONTEXT_MANAGER_URL=http://localhost:3002
```

### Local Development Commands
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run comprehensive test suite
node test-atlas.js

# Build for production
npm run build
```

## Deployment

### Docker Configuration
- Multi-stage build optimized for production
- Non-root user execution
- Health checks via `/api/v1/health` endpoint
- Secure credential handling via Context Manager

### Environment Variables
- `PORT`: Server port (default: 3003)
- `DIGITALOCEAN_API_TOKEN`: DigitalOcean API token (or via Context Manager)
- `CONTEXT_MANAGER_URL`: Context Manager service URL
- `LOG_LEVEL`: Logging level (info, warn, error)

### Production Considerations
- Cloud provider credentials stored securely in Context Manager
- Comprehensive audit logging for all infrastructure operations
- High availability with horizontal scaling
- Cost monitoring and budget alerts
- Backup and disaster recovery for infrastructure state

## Architecture Context

### Role in Overall System
Atlas serves as the infrastructure backbone of ControlVector:

1. **Multi-Cloud Abstraction**:
   - Unified API across cloud providers (DigitalOcean, AWS, GCP, Azure)
   - Provider-agnostic resource specifications
   - Consistent cost modeling and estimation

2. **Infrastructure Lifecycle Management**:
   - Complete CRUD operations for cloud resources
   - Deployment operation tracking with real-time status
   - Automated cleanup and rollback capabilities

3. **Cost Management & Optimization**:
   - Real-time cost estimation before deployment
   - Usage tracking and cost monitoring
   - Budget controls and cost alerts

4. **Security & Compliance**:
   - Secure credential storage via Context Manager
   - Workspace-scoped resource isolation
   - Comprehensive audit logging

### Dependencies on Other Services
- **CV Context Manager**: Secure storage of cloud provider credentials and SSH keys
- **Cloud Provider APIs**: DigitalOcean, AWS, GCP, Azure for actual resource provisioning

### Data Flow Patterns
1. **Infrastructure Provisioning**: Request → Validation → Provider API → Resource Creation → Status Tracking
2. **Cost Estimation**: Specification → Provider Pricing → Cost Calculation → Estimate Response
3. **Operation Monitoring**: Async Operation → Status Updates → Completion Notification
4. **Credential Management**: Context Manager → Encrypted Storage → Secure Retrieval

### Resource Types Supported

#### DigitalOcean (Implemented)
- **Droplets**: Virtual machines with configurable CPU, memory, storage
- **Volumes**: Block storage volumes with customizable size
- **Databases**: Managed PostgreSQL, MySQL, Redis clusters
- **Load Balancers**: HTTP/HTTPS load balancing with health checks
- **Firewalls**: Security groups and network access control
- **VPCs**: Private networking and IP range management

#### Cost Model
```typescript
// Example pricing (per hour in USD)
const pricing = {
  droplet: {
    's-1vcpu-1gb': 0.00893,    // $6.43/month
    's-2vcpu-2gb': 0.01786,    // $12.86/month
    's-4vcpu-8gb': 0.05952     // $42.86/month
  },
  volume: 0.10,                // $0.10/GB/month
  database: 15.00,             // Starting at $15/month
  load_balancer: 12.00         // $12/month
}
```

### Integration with Agent Ecosystem
Atlas provides infrastructure services to other ControlVector agents:

- **Watson**: Orchestrates infrastructure deployments as part of larger workflows
- **Phoenix**: Uses Atlas for blue-green deployment infrastructure
- **Sherlock**: Monitors infrastructure security and compliance
- **All Agents**: Benefit from centralized infrastructure management

### API Usage Examples

#### Create Infrastructure
```bash
POST /api/v1/infrastructure
{
  "name": "web-application",
  "provider": "digitalocean",
  "region": "nyc3",
  "resources": [
    {
      "type": "droplet",
      "name": "web-server",
      "specifications": {
        "size": "s-2vcpu-4gb",
        "image": "ubuntu-22-04-x64",
        "ssh_keys": ["fingerprint1"],
        "monitoring": true,
        "backups": true
      }
    },
    {
      "type": "database",
      "name": "app-database",
      "specifications": {
        "engine": "postgresql",
        "version": "15",
        "size": "db-s-1vcpu-2gb",
        "num_nodes": 1
      }
    }
  ],
  "tags": {
    "environment": "production",
    "project": "web-app"
  }
}
```

#### Monitor Operation
```bash
GET /api/v1/operations/{operation-id}
{
  "operation": {
    "id": "op-123",
    "status": "in_progress",
    "total_steps": 2,
    "completed_steps": 1,
    "current_step": "Creating database: app-database",
    "created_resources": ["resource-456"],
    "cost_change": 47.86
  }
}
```

#### Cost Estimation
```bash
POST /api/v1/estimate-cost
{
  "name": "cost-estimate",
  "provider": "digitalocean",
  "region": "nyc3",
  "resources": [
    {
      "type": "droplet",
      "name": "server",
      "specifications": { "size": "s-1vcpu-1gb" }
    }
  ]
}

Response:
{
  "estimated_monthly_cost": 6.43,
  "currency": "USD",
  "breakdown": [
    {
      "resource_type": "droplet",
      "resource_name": "server",
      "estimated_cost": 6.43
    }
  ]
}
```

## Testing & Quality Assurance

### Test Coverage
- Unit tests for infrastructure service logic
- Integration tests for cloud provider APIs
- End-to-end tests for complete workflows
- Cost estimation accuracy tests

### Test Execution
```bash
# Run all tests
npm test

# Run comprehensive test suite (with running service)
node test-atlas.js

# Expected output: All endpoints working, cost estimation, validation
```

### Production Readiness
- Comprehensive error handling and retry logic
- Rate limiting and request throttling
- Monitoring and alerting integration
- Graceful degradation when providers unavailable

Atlas provides the foundation for reliable, cost-effective, multi-cloud infrastructure management within the ControlVector ecosystem. It abstracts cloud complexity while maintaining full control over resources, costs, and security.