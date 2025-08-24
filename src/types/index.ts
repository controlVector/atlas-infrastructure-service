// Atlas Infrastructure Agent - Type Definitions

export interface Infrastructure {
  id: string
  name: string
  workspace_id: string
  user_id: string
  provider: CloudProvider
  region: string
  
  // Resource specifications
  resources: InfrastructureResource[]
  
  // Status and metadata
  status: InfrastructureStatus
  created_at: string
  updated_at: string
  deployed_at?: string
  destroyed_at?: string
  
  // Cost and monitoring
  estimated_monthly_cost: number
  actual_cost?: number
  tags: Record<string, string>
  
  // Configuration
  configuration: InfrastructureConfig
}

export interface InfrastructureResource {
  id: string
  type: ResourceType
  name: string
  provider_id?: string // ID from cloud provider
  
  // Specifications
  specifications: ResourceSpec
  
  // Status
  status: ResourceStatus
  created_at: string
  updated_at: string
  
  // Relationships
  dependencies: string[] // IDs of other resources
  dependents: string[] // Resources that depend on this one
  
  // Cost tracking
  hourly_cost: number
  monthly_cost: number
}

// Cloud Providers
export type CloudProvider = 'digitalocean' | 'aws' | 'gcp' | 'azure' | 'linode' | 'vultr'

// Resource Types
export type ResourceType = 
  | 'droplet'           // DigitalOcean droplets
  | 'volume'            // Block storage
  | 'database'          // Managed databases
  | 'load_balancer'     // Load balancers
  | 'firewall'          // Security groups
  | 'vpc'               // Virtual private clouds
  | 'domain'            // DNS domains
  | 'cdn'               // Content delivery networks
  | 'kubernetes'        // Kubernetes clusters
  | 'container_registry' // Container registries

// Infrastructure Status
export type InfrastructureStatus = 
  | 'pending'           // Being planned
  | 'provisioning'      // Currently being created
  | 'active'            // Running and healthy
  | 'updating'          // Being modified
  | 'error'             // Failed state
  | 'destroying'        // Being destroyed
  | 'destroyed'         // Successfully destroyed

// Resource Status
export type ResourceStatus =
  | 'pending'           // Waiting to be created
  | 'creating'          // Being provisioned
  | 'active'            // Running
  | 'updating'          // Being modified
  | 'error'             // Failed state
  | 'deleting'          // Being destroyed
  | 'deleted'           // Successfully destroyed

// Resource Specifications
export interface ResourceSpec {
  // Common fields
  region?: string
  tags?: Record<string, string>
  
  // Droplet-specific
  size?: string           // e.g., 's-1vcpu-1gb'
  image?: string          // e.g., 'ubuntu-22-04-x64'
  ssh_keys?: string[]     // SSH key fingerprints
  vpc_uuid?: string       // VPC to place in
  monitoring?: boolean
  backups?: boolean
  ipv6?: boolean
  
  // Volume-specific
  size_gigabytes?: number
  filesystem_type?: string
  
  // Database-specific
  engine?: string         // mysql, postgresql, redis
  version?: string
  num_nodes?: number
  
  // Load balancer-specific
  algorithm?: 'round_robin' | 'least_connections'
  health_check?: HealthCheck
  forwarding_rules?: ForwardingRule[]
  
  // Custom configuration
  [key: string]: any
}

export interface HealthCheck {
  protocol: 'http' | 'https' | 'tcp'
  port: number
  path?: string
  check_interval_seconds: number
  response_timeout_seconds: number
  healthy_threshold: number
  unhealthy_threshold: number
}

export interface ForwardingRule {
  entry_protocol: 'http' | 'https' | 'tcp' | 'udp'
  entry_port: number
  target_protocol: 'http' | 'https' | 'tcp' | 'udp'
  target_port: number
  certificate_id?: string
  tls_passthrough?: boolean
}

// Infrastructure Configuration
export interface InfrastructureConfig {
  // Deployment settings
  auto_scaling?: AutoScalingConfig
  backup_policy?: BackupPolicy
  security_settings?: SecuritySettings
  
  // Networking
  networking?: NetworkingConfig
  
  // Monitoring and alerts
  monitoring?: MonitoringConfig
  
  // Cost controls
  cost_controls?: CostControls
}

export interface AutoScalingConfig {
  enabled: boolean
  min_instances: number
  max_instances: number
  target_cpu_utilization: number
  scale_up_cooldown: number
  scale_down_cooldown: number
}

export interface BackupPolicy {
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  retention_days: number
  backup_window?: string // e.g., '03:00-04:00'
}

export interface SecuritySettings {
  firewall_enabled: boolean
  allowed_inbound_rules: FirewallRule[]
  allowed_outbound_rules: FirewallRule[]
  ssh_key_required: boolean
  automatic_security_updates: boolean
}

export interface FirewallRule {
  protocol: 'tcp' | 'udp' | 'icmp'
  ports: string // e.g., '22', '80-443', '8000-9000'
  sources: string[] // IP addresses or ranges
}

export interface NetworkingConfig {
  vpc_enabled: boolean
  private_networking: boolean
  floating_ip: boolean
  ipv6_enabled: boolean
  dns_settings?: DNSSettings
}

export interface DNSSettings {
  domain?: string
  subdomain?: string
  ttl: number
}

export interface MonitoringConfig {
  enabled: boolean
  metrics: string[] // e.g., ['cpu', 'memory', 'disk', 'network']
  alerts: AlertRule[]
}

export interface AlertRule {
  metric: string
  operator: 'greater_than' | 'less_than' | 'equals'
  threshold: number
  duration_minutes: number
  notification_channels: string[]
}

export interface CostControls {
  daily_limit: number
  monthly_limit: number
  auto_destroy_on_limit: boolean
  cost_alerts: CostAlert[]
}

export interface CostAlert {
  threshold_percentage: number // e.g., 80 for 80% of budget
  notification_channels: string[]
}

// Provider-specific types
export interface DigitalOceanDroplet {
  id: number
  name: string
  memory: number
  vcpus: number
  disk: number
  locked: boolean
  status: 'new' | 'active' | 'off' | 'archive'
  kernel?: any
  created_at: string
  features: string[]
  backup_ids: number[]
  snapshot_ids: number[]
  image: any
  volume_ids: string[]
  size: any
  size_slug: string
  networks: any
  region: any
  tags: string[]
  vpc_uuid?: string
}

// API Request/Response types
export interface CreateInfrastructureRequest {
  name: string
  provider: CloudProvider
  region: string
  resources: CreateResourceRequest[]
  configuration?: Partial<InfrastructureConfig>
  tags?: Record<string, string>
}

export interface CreateResourceRequest {
  type: ResourceType
  name: string
  specifications: ResourceSpec
}

export interface UpdateInfrastructureRequest {
  name?: string
  resources?: UpdateResourceRequest[]
  configuration?: Partial<InfrastructureConfig>
  tags?: Record<string, string>
}

export interface UpdateResourceRequest {
  id: string
  specifications?: Partial<ResourceSpec>
}

export interface DeploymentOperation {
  id: string
  infrastructure_id: string
  operation_type: 'create' | 'update' | 'destroy'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  started_at: string
  completed_at?: string
  error_message?: string
  
  // Progress tracking
  total_steps: number
  completed_steps: number
  current_step?: string
  
  // Results
  created_resources: string[]
  updated_resources: string[]
  deleted_resources: string[]
  
  // Cost impact
  cost_change: number
}

// Cost tracking
export interface CostReport {
  infrastructure_id: string
  period_start: string
  period_end: string
  
  // Costs by resource
  resource_costs: ResourceCost[]
  
  // Totals
  total_cost: number
  estimated_monthly_cost: number
  
  // Trends
  cost_trend: 'increasing' | 'decreasing' | 'stable'
  cost_change_percentage: number
}

export interface ResourceCost {
  resource_id: string
  resource_type: ResourceType
  resource_name: string
  
  // Costs
  hourly_cost: number
  daily_cost: number
  monthly_cost: number
  total_cost: number
  
  // Usage metrics
  uptime_hours: number
  usage_metrics?: Record<string, number>
}

// Monitoring and health
export interface InfrastructureHealth {
  infrastructure_id: string
  overall_status: 'healthy' | 'warning' | 'critical'
  last_check: string
  
  // Resource health
  resource_health: ResourceHealth[]
  
  // Metrics
  performance_metrics: PerformanceMetrics
  
  // Issues
  active_issues: InfrastructureIssue[]
}

export interface ResourceHealth {
  resource_id: string
  resource_type: ResourceType
  status: 'healthy' | 'warning' | 'critical' | 'unknown'
  last_check: string
  response_time_ms?: number
  uptime_percentage: number
  
  // Metrics
  cpu_usage?: number
  memory_usage?: number
  disk_usage?: number
  network_in?: number
  network_out?: number
}

export interface PerformanceMetrics {
  average_response_time: number
  requests_per_minute: number
  error_rate: number
  uptime_percentage: number
  
  // Resource utilization
  average_cpu_usage: number
  average_memory_usage: number
  average_disk_usage: number
}

export interface InfrastructureIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  affected_resources: string[]
  detected_at: string
  resolved_at?: string
  
  // Resolution
  auto_resolvable: boolean
  suggested_actions: string[]
}

// Provider interface for extensibility
export interface CloudProviderInterface {
  // Provider info
  name: CloudProvider
  regions: string[]
  resource_types: ResourceType[]
  
  // Authentication
  authenticate(credentials: Record<string, string>): Promise<boolean>
  
  // Resource management
  createResource(type: ResourceType, spec: ResourceSpec): Promise<InfrastructureResource>
  updateResource(id: string, spec: Partial<ResourceSpec>): Promise<InfrastructureResource>
  deleteResource(id: string): Promise<void>
  getResource(id: string): Promise<InfrastructureResource | null>
  listResources(filters?: Record<string, any>): Promise<InfrastructureResource[]>
  
  // Cost management
  getResourceCost(id: string): Promise<ResourceCost>
  estimateCost(spec: ResourceSpec): Promise<number>
  
  // Health monitoring
  checkResourceHealth(id: string): Promise<ResourceHealth>
  
  // Infrastructure discovery
  listDroplets?(): Promise<any[]>
  listDatabases?(): Promise<any[]>
  listLoadBalancers?(): Promise<any[]>
}

// Error types
export class AtlasError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message)
    this.name = 'AtlasError'
  }
}

export class ProviderError extends AtlasError {
  constructor(message: string, public provider: CloudProvider) {
    super(message, 'PROVIDER_ERROR', 502)
    this.name = 'ProviderError'
  }
}

export class ResourceNotFoundError extends AtlasError {
  constructor(resourceId: string) {
    super(`Resource not found: ${resourceId}`, 'RESOURCE_NOT_FOUND', 404)
    this.name = 'ResourceNotFoundError'
  }
}

export class InsufficientPermissionsError extends AtlasError {
  constructor(action: string) {
    super(`Insufficient permissions for action: ${action}`, 'INSUFFICIENT_PERMISSIONS', 403)
    this.name = 'InsufficientPermissionsError'
  }
}