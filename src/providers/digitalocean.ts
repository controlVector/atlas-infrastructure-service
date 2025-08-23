import axios, { AxiosInstance } from 'axios'
import { v4 as uuidv4 } from 'uuid'
import {
  CloudProviderInterface,
  CloudProvider,
  ResourceType,
  InfrastructureResource,
  ResourceSpec,
  ResourceCost,
  ResourceHealth,
  ProviderError,
  ResourceNotFoundError,
  DigitalOceanDroplet
} from '../types'

export class DigitalOceanProvider implements CloudProviderInterface {
  name: CloudProvider = 'digitalocean'
  private client: AxiosInstance
  private apiToken: string

  // DigitalOcean regions
  regions = [
    'nyc1', 'nyc3', 'ams2', 'ams3', 'sfo1', 'sfo2', 'sfo3',
    'sgp1', 'lon1', 'fra1', 'tor1', 'blr1', 'syd1'
  ]

  // Supported resource types
  resource_types: ResourceType[] = [
    'droplet',
    'volume', 
    'database',
    'load_balancer',
    'firewall',
    'vpc',
    'domain',
    'cdn',
    'kubernetes',
    'container_registry'
  ]

  // Pricing information (per hour in USD)
  private static readonly PRICING = {
    // Droplet sizes (per hour)
    droplet: {
      's-1vcpu-512mb-10gb': 0.00744,
      's-1vcpu-1gb': 0.00893,
      's-1vcpu-2gb': 0.01488,
      's-2vcpu-2gb': 0.01786,
      's-2vcpu-4gb': 0.02976,
      's-4vcpu-8gb': 0.05952,
      's-8vcpu-16gb': 0.11905,
      'c-2': 0.02679,
      'c-4': 0.05357,
      'c-8': 0.10714,
      'm-2vcpu-16gb': 0.08929,
      'm-4vcpu-32gb': 0.17857,
      'm-8vcpu-64gb': 0.35714,
    },
    // Volume storage (per GB per month)
    volume: 0.10,
    // Managed databases (starting prices per month)
    database: {
      'db-s-1vcpu-1gb': 15.00,
      'db-s-1vcpu-2gb': 30.00,
      'db-s-2vcpu-4gb': 60.00,
      'db-s-4vcpu-8gb': 120.00,
    },
    // Load balancers (per month)
    load_balancer: 12.00,
    // Kubernetes clusters (per month)
    kubernetes: 12.00,
  }

  constructor(apiToken: string) {
    this.apiToken = apiToken
    this.client = axios.create({
      baseURL: 'https://api.digitalocean.com/v2',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    })

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        if (error.response) {
          const { status, data } = error.response
          throw new ProviderError(
            `DigitalOcean API Error: ${data.message || error.message}`,
            'digitalocean'
          )
        }
        throw new ProviderError(error.message, 'digitalocean')
      }
    )
  }

  async authenticate(credentials: Record<string, string>): Promise<boolean> {
    try {
      const response = await this.client.get('/account')
      return response.status === 200
    } catch (error) {
      return false
    }
  }

  async createResource(type: ResourceType, spec: ResourceSpec): Promise<InfrastructureResource> {
    switch (type) {
      case 'droplet':
        return await this.createDroplet(spec)
      case 'volume':
        return await this.createVolume(spec)
      case 'database':
        return await this.createDatabase(spec)
      case 'load_balancer':
        return await this.createLoadBalancer(spec)
      case 'firewall':
        return await this.createFirewall(spec)
      case 'vpc':
        return await this.createVPC(spec)
      default:
        throw new ProviderError(`Resource type ${type} not supported`, 'digitalocean')
    }
  }

  private async createDroplet(spec: ResourceSpec): Promise<InfrastructureResource> {
    const dropletSpec = {
      name: spec.name || `droplet-${Date.now()}`,
      region: spec.region || 'nyc3',
      size: spec.size || 's-1vcpu-1gb',
      image: spec.image || 'ubuntu-22-04-x64',
      ssh_keys: spec.ssh_keys || [],
      backups: spec.backups || false,
      ipv6: spec.ipv6 || false,
      monitoring: spec.monitoring || true,
      vpc_uuid: spec.vpc_uuid,
      tags: Object.keys(spec.tags || {}).map(key => `${key}:${spec.tags![key]}`),
    }

    try {
      const response = await this.client.post('/droplets', dropletSpec)
      const droplet: DigitalOceanDroplet = response.data.droplet

      // Calculate costs
      const hourlyCost = this.calculateDropletCost(dropletSpec.size)
      const monthlyCost = hourlyCost * 24 * 30

      return {
        id: uuidv4(),
        type: 'droplet',
        name: droplet.name,
        provider_id: droplet.id.toString(),
        specifications: spec,
        status: 'creating',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        dependents: [],
        hourly_cost: hourlyCost,
        monthly_cost: monthlyCost
      }
    } catch (error) {
      throw new ProviderError(`Failed to create droplet: ${error}`, 'digitalocean')
    }
  }

  private async createVolume(spec: ResourceSpec): Promise<InfrastructureResource> {
    const volumeSpec = {
      type: 'gp1', // General purpose SSD
      name: spec.name || `volume-${Date.now()}`,
      size_gigabytes: spec.size_gigabytes || 10,
      region: spec.region || 'nyc3',
      filesystem_type: spec.filesystem_type || 'ext4',
      tags: Object.keys(spec.tags || {}).map(key => `${key}:${spec.tags![key]}`)
    }

    try {
      const response = await this.client.post('/volumes', volumeSpec)
      const volume = response.data.volume

      // Calculate costs ($0.10 per GB per month)
      const monthlyCost = volumeSpec.size_gigabytes * 0.10
      const hourlyCost = monthlyCost / (24 * 30)

      return {
        id: uuidv4(),
        type: 'volume',
        name: volume.name,
        provider_id: volume.id,
        specifications: spec,
        status: 'creating',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        dependents: [],
        hourly_cost: hourlyCost,
        monthly_cost: monthlyCost
      }
    } catch (error) {
      throw new ProviderError(`Failed to create volume: ${error}`, 'digitalocean')
    }
  }

  private async createDatabase(spec: ResourceSpec): Promise<InfrastructureResource> {
    const dbSpec = {
      name: spec.name || `db-${Date.now()}`,
      engine: spec.engine || 'postgresql',
      version: spec.version || '15',
      region: spec.region || 'nyc3',
      size: spec.size || 'db-s-1vcpu-1gb',
      num_nodes: spec.num_nodes || 1,
      tags: Object.keys(spec.tags || {}).map(key => `${key}:${spec.tags![key]}`)
    }

    try {
      const response = await this.client.post('/databases', dbSpec)
      const database = response.data.database

      // Calculate costs
      const monthlyCost = DigitalOceanProvider.PRICING.database[dbSpec.size as keyof typeof DigitalOceanProvider.PRICING.database] || 15.00
      const hourlyCost = monthlyCost / (24 * 30)

      return {
        id: uuidv4(),
        type: 'database',
        name: database.name,
        provider_id: database.id,
        specifications: spec,
        status: 'creating',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        dependents: [],
        hourly_cost: hourlyCost,
        monthly_cost: monthlyCost
      }
    } catch (error) {
      throw new ProviderError(`Failed to create database: ${error}`, 'digitalocean')
    }
  }

  private async createLoadBalancer(spec: ResourceSpec): Promise<InfrastructureResource> {
    const lbSpec = {
      name: spec.name || `lb-${Date.now()}`,
      algorithm: spec.algorithm || 'round_robin',
      status: 'new',
      created_at: new Date().toISOString(),
      ip: '',
      id: '',
      region: {
        name: spec.region || 'New York 3',
        slug: spec.region || 'nyc3'
      },
      forwarding_rules: spec.forwarding_rules || [{
        entry_protocol: 'http',
        entry_port: 80,
        target_protocol: 'http',
        target_port: 80,
        certificate_id: '',
        tls_passthrough: false
      }],
      health_check: spec.health_check || {
        protocol: 'http',
        port: 80,
        path: '/',
        check_interval_seconds: 10,
        response_timeout_seconds: 5,
        healthy_threshold: 3,
        unhealthy_threshold: 3
      },
      sticky_sessions: {
        type: null,
        cookie_name: null,
        cookie_ttl_seconds: null
      },
      droplet_ids: [],
      redirect_http_to_https: false,
      enable_proxy_protocol: false,
      enable_backend_keepalive: false,
      http_idle_timeout_seconds: 60,
      project_id: '',
      size_unit: 1,
      size: 'lb-small',
      tags: Object.keys(spec.tags || {})
    }

    try {
      const response = await this.client.post('/load_balancers', lbSpec)
      const loadBalancer = response.data.load_balancer

      // Load balancer costs $12/month
      const monthlyCost = 12.00
      const hourlyCost = monthlyCost / (24 * 30)

      return {
        id: uuidv4(),
        type: 'load_balancer',
        name: loadBalancer.name,
        provider_id: loadBalancer.id,
        specifications: spec,
        status: 'creating',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        dependents: [],
        hourly_cost: hourlyCost,
        monthly_cost: monthlyCost
      }
    } catch (error) {
      throw new ProviderError(`Failed to create load balancer: ${error}`, 'digitalocean')
    }
  }

  private async createFirewall(spec: ResourceSpec): Promise<InfrastructureResource> {
    const firewallSpec = {
      name: spec.name || `firewall-${Date.now()}`,
      inbound_rules: [
        {
          protocol: 'tcp',
          ports: '22',
          sources: {
            addresses: ['0.0.0.0/0', '::/0']
          }
        },
        {
          protocol: 'tcp',
          ports: '80',
          sources: {
            addresses: ['0.0.0.0/0', '::/0']
          }
        },
        {
          protocol: 'tcp',
          ports: '443',
          sources: {
            addresses: ['0.0.0.0/0', '::/0']
          }
        }
      ],
      outbound_rules: [
        {
          protocol: 'tcp',
          ports: '1-65535',
          destinations: {
            addresses: ['0.0.0.0/0', '::/0']
          }
        },
        {
          protocol: 'udp',
          ports: '1-65535', 
          destinations: {
            addresses: ['0.0.0.0/0', '::/0']
          }
        }
      ],
      droplet_ids: [],
      tags: Object.keys(spec.tags || {})
    }

    try {
      const response = await this.client.post('/firewalls', firewallSpec)
      const firewall = response.data.firewall

      return {
        id: uuidv4(),
        type: 'firewall',
        name: firewall.name,
        provider_id: firewall.id,
        specifications: spec,
        status: 'active', // Firewalls are typically active immediately
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        dependents: [],
        hourly_cost: 0, // Firewalls are free
        monthly_cost: 0
      }
    } catch (error) {
      throw new ProviderError(`Failed to create firewall: ${error}`, 'digitalocean')
    }
  }

  private async createVPC(spec: ResourceSpec): Promise<InfrastructureResource> {
    const vpcSpec = {
      name: spec.name || `vpc-${Date.now()}`,
      region: spec.region || 'nyc3',
      ip_range: spec.ip_range || '10.0.0.0/16'
    }

    try {
      const response = await this.client.post('/vpcs', vpcSpec)
      const vpc = response.data.vpc

      return {
        id: uuidv4(),
        type: 'vpc',
        name: vpc.name,
        provider_id: vpc.id,
        specifications: spec,
        status: 'active', // VPCs are typically active immediately
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        dependents: [],
        hourly_cost: 0, // VPCs are free
        monthly_cost: 0
      }
    } catch (error) {
      throw new ProviderError(`Failed to create VPC: ${error}`, 'digitalocean')
    }
  }

  async updateResource(id: string, spec: Partial<ResourceSpec>): Promise<InfrastructureResource> {
    // Implementation would depend on resource type
    // For now, return a placeholder
    throw new Error('Update resource not yet implemented')
  }

  async deleteResource(providerId: string): Promise<void> {
    try {
      // Try droplet first (most common)
      await this.client.delete(`/droplets/${providerId}`)
    } catch (error) {
      // If not a droplet, try other resource types
      try {
        await this.client.delete(`/volumes/${providerId}`)
      } catch (error2) {
        try {
          await this.client.delete(`/databases/${providerId}`)
        } catch (error3) {
          throw new ProviderError(`Failed to delete resource ${providerId}`, 'digitalocean')
        }
      }
    }
  }

  async getResource(providerId: string): Promise<InfrastructureResource | null> {
    try {
      // Try to get droplet
      const response = await this.client.get(`/droplets/${providerId}`)
      const droplet: DigitalOceanDroplet = response.data.droplet

      const hourlyCost = this.calculateDropletCost(droplet.size_slug)
      const monthlyCost = hourlyCost * 24 * 30

      return {
        id: uuidv4(),
        type: 'droplet',
        name: droplet.name,
        provider_id: droplet.id.toString(),
        specifications: {},
        status: this.mapDropletStatus(droplet.status),
        created_at: droplet.created_at,
        updated_at: new Date().toISOString(),
        dependencies: [],
        dependents: [],
        hourly_cost: hourlyCost,
        monthly_cost: monthlyCost
      }
    } catch (error) {
      return null
    }
  }

  async listResources(filters?: Record<string, any>): Promise<InfrastructureResource[]> {
    const resources: InfrastructureResource[] = []

    try {
      // Get droplets
      const dropletsResponse = await this.client.get('/droplets')
      const droplets: DigitalOceanDroplet[] = dropletsResponse.data.droplets

      for (const droplet of droplets) {
        const hourlyCost = this.calculateDropletCost(droplet.size_slug)
        const monthlyCost = hourlyCost * 24 * 30

        resources.push({
          id: uuidv4(),
          type: 'droplet',
          name: droplet.name,
          provider_id: droplet.id.toString(),
          specifications: {},
          status: this.mapDropletStatus(droplet.status),
          created_at: droplet.created_at,
          updated_at: new Date().toISOString(),
          dependencies: [],
          dependents: [],
          hourly_cost: hourlyCost,
          monthly_cost: monthlyCost
        })
      }

      // Get volumes
      const volumesResponse = await this.client.get('/volumes')
      const volumes = volumesResponse.data.volumes || []

      for (const volume of volumes) {
        const monthlyCost = volume.size_gigabytes * 0.10
        const hourlyCost = monthlyCost / (24 * 30)

        resources.push({
          id: uuidv4(),
          type: 'volume',
          name: volume.name,
          provider_id: volume.id,
          specifications: {},
          status: 'active', // Assume active if not specified
          created_at: volume.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          dependencies: [],
          dependents: [],
          hourly_cost: hourlyCost,
          monthly_cost: monthlyCost
        })
      }

    } catch (error) {
      console.error('Error listing resources:', error)
    }

    return resources
  }

  async getResourceCost(providerId: string): Promise<ResourceCost> {
    const resource = await this.getResource(providerId)
    if (!resource) {
      throw new ResourceNotFoundError(providerId)
    }

    // Calculate uptime (assume 24/7 for now)
    const createdAt = new Date(resource.created_at)
    const now = new Date()
    const uptimeHours = Math.max(1, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60))

    return {
      resource_id: resource.id,
      resource_type: resource.type,
      resource_name: resource.name,
      hourly_cost: resource.hourly_cost,
      daily_cost: resource.hourly_cost * 24,
      monthly_cost: resource.monthly_cost,
      total_cost: resource.hourly_cost * uptimeHours,
      uptime_hours: uptimeHours
    }
  }

  async estimateCost(spec: ResourceSpec): Promise<number> {
    // Estimate monthly cost based on resource specifications
    if (spec.size) {
      return this.calculateDropletCost(spec.size) * 24 * 30
    }

    if (spec.size_gigabytes) {
      return spec.size_gigabytes * 0.10 // Volume pricing
    }

    return 15.00 // Default estimate
  }

  async checkResourceHealth(providerId: string): Promise<ResourceHealth> {
    const resource = await this.getResource(providerId)
    if (!resource) {
      throw new ResourceNotFoundError(providerId)
    }

    // For DigitalOcean, we can check droplet status
    try {
      const response = await this.client.get(`/droplets/${providerId}`)
      const droplet: DigitalOceanDroplet = response.data.droplet

      const health: ResourceHealth = {
        resource_id: resource.id,
        resource_type: resource.type,
        status: droplet.status === 'active' ? 'healthy' : 'warning',
        last_check: new Date().toISOString(),
        uptime_percentage: droplet.status === 'active' ? 100 : 0
      }

      // Get additional metrics if monitoring is enabled
      if (droplet.features.includes('monitoring')) {
        // In a real implementation, you would fetch monitoring data
        health.cpu_usage = Math.random() * 100
        health.memory_usage = Math.random() * 100
        health.network_in = Math.random() * 1000
        health.network_out = Math.random() * 1000
      }

      return health
    } catch (error) {
      return {
        resource_id: resource.id,
        resource_type: resource.type,
        status: 'unknown',
        last_check: new Date().toISOString(),
        uptime_percentage: 0
      }
    }
  }

  private calculateDropletCost(sizeSlug: string): number {
    return DigitalOceanProvider.PRICING.droplet[sizeSlug as keyof typeof DigitalOceanProvider.PRICING.droplet] || 0.00893
  }

  private mapDropletStatus(doStatus: string): any {
    switch (doStatus) {
      case 'new': return 'creating'
      case 'active': return 'active'
      case 'off': return 'active' // Consider stopped droplets as active but off
      case 'archive': return 'deleted'
      default: return 'active'
    }
  }

  // Utility methods for getting available options
  async getAvailableSizes(): Promise<any[]> {
    try {
      const response = await this.client.get('/sizes')
      return response.data.sizes
    } catch (error) {
      return []
    }
  }

  async getAvailableImages(): Promise<any[]> {
    try {
      const response = await this.client.get('/images?type=distribution')
      return response.data.images
    } catch (error) {
      return []
    }
  }

  async getAvailableRegions(): Promise<any[]> {
    try {
      const response = await this.client.get('/regions')
      return response.data.regions
    } catch (error) {
      return []
    }
  }
}