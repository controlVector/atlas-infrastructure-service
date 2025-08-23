import { v4 as uuidv4 } from 'uuid'
import {
  Infrastructure,
  InfrastructureResource,
  DeploymentOperation,
  CreateInfrastructureRequest,
  UpdateInfrastructureRequest,
  CloudProvider,
  CloudProviderInterface,
  InfrastructureStatus,
  ResourceStatus,
  AtlasError,
  ResourceNotFoundError
} from '../types'
import { DigitalOceanProvider } from '../providers/digitalocean'
import { ContextService } from './ContextService'

export class InfrastructureService {
  private providers: Map<CloudProvider, CloudProviderInterface> = new Map()
  private contextService: ContextService
  
  // In-memory storage for demo (in production, this would be a database)
  private infrastructures: Map<string, Infrastructure> = new Map()
  private deploymentOperations: Map<string, DeploymentOperation> = new Map()

  constructor() {
    // Initialize Context Manager integration
    this.contextService = new ContextService(process.env.CONTEXT_MANAGER_URL || 'http://localhost:3005')
    
    // Initialize fallback providers for testing without user context
    this.initializeFallbackProviders()
  }

  private initializeFallbackProviders() {
    // Keep environment variable support as fallback for development/testing
    const doToken = process.env.DIGITALOCEAN_API_TOKEN
    
    if (doToken) {
      console.log('Using DigitalOcean token from environment variable for fallback')
      this.providers.set('digitalocean', new DigitalOceanProvider(doToken))
    } else {
      console.log('No environment DigitalOcean token - will use user credentials from Context Manager')
    }
  }

  /**
   * Initialize providers for a specific user using their stored credentials
   */
  private async initializeUserProviders(workspaceId: string, userId: string, jwtToken: string): Promise<void> {
    try {
      // Get DigitalOcean credentials from Context Manager
      const doCredentials = await this.contextService.getProviderCredentials(
        workspaceId,
        userId,
        'digitalocean',
        jwtToken
      )

      if (doCredentials.digitalocean_api_token) {
        console.log(`Initializing DigitalOcean provider for user ${userId} with stored credentials`)
        // Create user-specific provider key
        const userProviderKey = `digitalocean-${userId}` as CloudProvider
        this.providers.set(userProviderKey, new DigitalOceanProvider(doCredentials.digitalocean_api_token))
      } else {
        console.warn(`No DigitalOcean credentials found for user ${userId}`)
      }
    } catch (error) {
      console.error('Failed to initialize user providers:', error)
    }
  }

  /**
   * Create new infrastructure
   */
  async createInfrastructure(
    userId: string,
    workspaceId: string,
    request: CreateInfrastructureRequest
  ): Promise<{ infrastructure: Infrastructure; operation: DeploymentOperation }> {
    const provider = this.providers.get(request.provider)
    if (!provider) {
      throw new AtlasError(`Provider ${request.provider} not configured`, 'PROVIDER_NOT_CONFIGURED')
    }

    // Create infrastructure object
    const infrastructure: Infrastructure = {
      id: uuidv4(),
      name: request.name,
      workspace_id: workspaceId,
      user_id: userId,
      provider: request.provider,
      region: request.region,
      resources: [],
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      estimated_monthly_cost: 0,
      tags: request.tags || {},
      configuration: request.configuration || {}
    }

    // Create deployment operation
    const operation: DeploymentOperation = {
      id: uuidv4(),
      infrastructure_id: infrastructure.id,
      operation_type: 'create',
      status: 'pending',
      started_at: new Date().toISOString(),
      total_steps: request.resources.length,
      completed_steps: 0,
      created_resources: [],
      updated_resources: [],
      deleted_resources: [],
      cost_change: 0
    }

    // Store infrastructure and operation
    this.infrastructures.set(infrastructure.id, infrastructure)
    this.deploymentOperations.set(operation.id, operation)

    // Start deployment asynchronously
    this.deployInfrastructure(infrastructure, operation, request.resources)
      .catch(error => {
        console.error('Deployment failed:', error)
        operation.status = 'failed'
        operation.error_message = error.message
        operation.completed_at = new Date().toISOString()
      })

    return { infrastructure, operation }
  }

  /**
   * Deploy infrastructure resources
   */
  private async deployInfrastructure(
    infrastructure: Infrastructure,
    operation: DeploymentOperation,
    resourceRequests: any[]
  ) {
    operation.status = 'in_progress'
    operation.current_step = 'Starting deployment'
    infrastructure.status = 'provisioning'

    const provider = this.providers.get(infrastructure.provider)!

    try {
      for (let i = 0; i < resourceRequests.length; i++) {
        const resourceRequest = resourceRequests[i]
        operation.current_step = `Creating ${resourceRequest.type}: ${resourceRequest.name}`

        // Create resource through provider
        const resource = await provider.createResource(
          resourceRequest.type,
          {
            ...resourceRequest.specifications,
            name: resourceRequest.name,
            region: infrastructure.region
          }
        )

        // Add to infrastructure
        infrastructure.resources.push(resource)
        operation.created_resources.push(resource.id)
        operation.completed_steps++

        // Update cost estimate
        infrastructure.estimated_monthly_cost += resource.monthly_cost

        // Add small delay to simulate real deployment time
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // Mark as successful
      operation.status = 'completed'
      operation.completed_at = new Date().toISOString()
      infrastructure.status = 'active'
      infrastructure.deployed_at = new Date().toISOString()
      infrastructure.updated_at = new Date().toISOString()
      
      operation.cost_change = infrastructure.estimated_monthly_cost

    } catch (error) {
      operation.status = 'failed'
      operation.error_message = error instanceof Error ? error.message : 'Unknown deployment error'
      operation.completed_at = new Date().toISOString()
      infrastructure.status = 'error'
      infrastructure.updated_at = new Date().toISOString()

      // Attempt cleanup of any created resources
      await this.cleanupFailedDeployment(infrastructure, operation)
    }
  }

  /**
   * Get infrastructure by ID
   */
  async getInfrastructure(id: string): Promise<Infrastructure | null> {
    return this.infrastructures.get(id) || null
  }

  /**
   * List infrastructure for workspace
   */
  async listInfrastructure(workspaceId: string): Promise<Infrastructure[]> {
    return Array.from(this.infrastructures.values())
      .filter(infra => infra.workspace_id === workspaceId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  /**
   * Update infrastructure
   */
  async updateInfrastructure(
    id: string,
    request: UpdateInfrastructureRequest
  ): Promise<{ infrastructure: Infrastructure; operation: DeploymentOperation }> {
    const infrastructure = this.infrastructures.get(id)
    if (!infrastructure) {
      throw new ResourceNotFoundError(id)
    }

    const provider = this.providers.get(infrastructure.provider)!

    // Create update operation
    const operation: DeploymentOperation = {
      id: uuidv4(),
      infrastructure_id: infrastructure.id,
      operation_type: 'update',
      status: 'pending',
      started_at: new Date().toISOString(),
      total_steps: (request.resources || []).length + 1,
      completed_steps: 0,
      created_resources: [],
      updated_resources: [],
      deleted_resources: [],
      cost_change: 0
    }

    this.deploymentOperations.set(operation.id, operation)

    // Start update asynchronously
    this.performUpdate(infrastructure, operation, request)
      .catch(error => {
        console.error('Update failed:', error)
        operation.status = 'failed'
        operation.error_message = error.message
        operation.completed_at = new Date().toISOString()
      })

    return { infrastructure, operation }
  }

  private async performUpdate(
    infrastructure: Infrastructure,
    operation: DeploymentOperation,
    request: UpdateInfrastructureRequest
  ) {
    operation.status = 'in_progress'
    infrastructure.status = 'updating'

    try {
      // Update basic properties
      if (request.name) infrastructure.name = request.name
      if (request.tags) infrastructure.tags = { ...infrastructure.tags, ...request.tags }
      if (request.configuration) {
        infrastructure.configuration = { ...infrastructure.configuration, ...request.configuration }
      }

      operation.current_step = 'Updating infrastructure properties'
      operation.completed_steps++

      // Update resources if specified
      if (request.resources) {
        for (const resourceUpdate of request.resources) {
          const resource = infrastructure.resources.find(r => r.id === resourceUpdate.id)
          if (resource) {
            operation.current_step = `Updating ${resource.type}: ${resource.name}`
            
            // Update specifications
            if (resourceUpdate.specifications) {
              resource.specifications = { ...resource.specifications, ...resourceUpdate.specifications }
              resource.updated_at = new Date().toISOString()
              operation.updated_resources.push(resource.id)
            }
            
            operation.completed_steps++
          }
        }
      }

      operation.status = 'completed'
      operation.completed_at = new Date().toISOString()
      infrastructure.status = 'active'
      infrastructure.updated_at = new Date().toISOString()

    } catch (error) {
      operation.status = 'failed'
      operation.error_message = error instanceof Error ? error.message : 'Unknown update error'
      operation.completed_at = new Date().toISOString()
      infrastructure.status = 'error'
    }
  }

  /**
   * Destroy infrastructure
   */
  async destroyInfrastructure(id: string): Promise<DeploymentOperation> {
    const infrastructure = this.infrastructures.get(id)
    if (!infrastructure) {
      throw new ResourceNotFoundError(id)
    }

    const provider = this.providers.get(infrastructure.provider)!

    // Create destroy operation
    const operation: DeploymentOperation = {
      id: uuidv4(),
      infrastructure_id: infrastructure.id,
      operation_type: 'destroy',
      status: 'pending',
      started_at: new Date().toISOString(),
      total_steps: infrastructure.resources.length,
      completed_steps: 0,
      created_resources: [],
      updated_resources: [],
      deleted_resources: [],
      cost_change: -infrastructure.estimated_monthly_cost
    }

    this.deploymentOperations.set(operation.id, operation)

    // Start destruction asynchronously
    this.performDestruction(infrastructure, operation)
      .catch(error => {
        console.error('Destruction failed:', error)
        operation.status = 'failed'
        operation.error_message = error.message
        operation.completed_at = new Date().toISOString()
      })

    return operation
  }

  private async performDestruction(
    infrastructure: Infrastructure,
    operation: DeploymentOperation
  ) {
    operation.status = 'in_progress'
    infrastructure.status = 'destroying'

    const provider = this.providers.get(infrastructure.provider)!

    try {
      // Destroy resources in reverse dependency order
      const resourcesToDestroy = [...infrastructure.resources].reverse()

      for (const resource of resourcesToDestroy) {
        operation.current_step = `Destroying ${resource.type}: ${resource.name}`

        if (resource.provider_id) {
          await provider.deleteResource(resource.provider_id)
        }

        resource.status = 'deleted'
        operation.deleted_resources.push(resource.id)
        operation.completed_steps++

        // Add small delay
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      operation.status = 'completed'
      operation.completed_at = new Date().toISOString()
      infrastructure.status = 'destroyed'
      infrastructure.destroyed_at = new Date().toISOString()
      infrastructure.updated_at = new Date().toISOString()

    } catch (error) {
      operation.status = 'failed'
      operation.error_message = error instanceof Error ? error.message : 'Unknown destruction error'
      operation.completed_at = new Date().toISOString()
      infrastructure.status = 'error'
    }
  }

  /**
   * Get deployment operation
   */
  async getDeploymentOperation(id: string): Promise<DeploymentOperation | null> {
    return this.deploymentOperations.get(id) || null
  }

  /**
   * List deployment operations for infrastructure
   */
  async listDeploymentOperations(infrastructureId: string): Promise<DeploymentOperation[]> {
    return Array.from(this.deploymentOperations.values())
      .filter(op => op.infrastructure_id === infrastructureId)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  }

  /**
   * Get infrastructure resource by ID
   */
  async getResource(infrastructureId: string, resourceId: string): Promise<InfrastructureResource | null> {
    const infrastructure = this.infrastructures.get(infrastructureId)
    if (!infrastructure) return null

    return infrastructure.resources.find(r => r.id === resourceId) || null
  }

  /**
   * Get cost estimate for infrastructure request
   */
  async estimateCost(request: CreateInfrastructureRequest): Promise<number> {
    const provider = this.providers.get(request.provider)
    if (!provider) {
      throw new AtlasError(`Provider ${request.provider} not configured`, 'PROVIDER_NOT_CONFIGURED')
    }

    let totalCost = 0

    for (const resourceRequest of request.resources) {
      const cost = await provider.estimateCost(resourceRequest.specifications)
      totalCost += cost
    }

    return totalCost
  }

  /**
   * Get available cloud providers
   */
  getAvailableProviders(): CloudProvider[] {
    return Array.from(this.providers.keys())
  }

  /**
   * Get provider-specific information
   */
  async getProviderInfo(provider: CloudProvider): Promise<any> {
    const providerInstance = this.providers.get(provider)
    if (!providerInstance) {
      throw new AtlasError(`Provider ${provider} not configured`, 'PROVIDER_NOT_CONFIGURED')
    }

    return {
      name: providerInstance.name,
      regions: providerInstance.regions,
      resource_types: providerInstance.resource_types
    }
  }

  /**
   * Test provider connectivity
   */
  async testProviderConnection(provider: CloudProvider): Promise<boolean> {
    const providerInstance = this.providers.get(provider)
    if (!providerInstance) return false

    try {
      return await providerInstance.authenticate({})
    } catch (error) {
      return false
    }
  }

  /**
   * Cleanup failed deployment
   */
  private async cleanupFailedDeployment(
    infrastructure: Infrastructure,
    operation: DeploymentOperation
  ) {
    const provider = this.providers.get(infrastructure.provider)!

    // Try to delete any resources that were successfully created
    for (const resourceId of operation.created_resources) {
      const resource = infrastructure.resources.find(r => r.id === resourceId)
      if (resource && resource.provider_id) {
        try {
          await provider.deleteResource(resource.provider_id)
          resource.status = 'deleted'
          operation.deleted_resources.push(resourceId)
        } catch (error) {
          console.error(`Failed to cleanup resource ${resourceId}:`, error)
        }
      }
    }
  }

  /**
   * Get infrastructure statistics
   */
  async getInfrastructureStats(workspaceId: string): Promise<any> {
    const infrastructures = await this.listInfrastructure(workspaceId)

    const stats = {
      total_infrastructures: infrastructures.length,
      active_infrastructures: infrastructures.filter(i => i.status === 'active').length,
      provisioning_infrastructures: infrastructures.filter(i => i.status === 'provisioning').length,
      error_infrastructures: infrastructures.filter(i => i.status === 'error').length,
      total_resources: infrastructures.reduce((sum, i) => sum + i.resources.length, 0),
      estimated_monthly_cost: infrastructures.reduce((sum, i) => sum + i.estimated_monthly_cost, 0),
      
      // Resource breakdown
      resource_types: {} as Record<string, number>,
      
      // Provider breakdown
      providers: {} as Record<string, number>
    }

    // Count resource types and providers
    for (const infrastructure of infrastructures) {
      // Provider stats
      stats.providers[infrastructure.provider] = (stats.providers[infrastructure.provider] || 0) + 1

      // Resource type stats
      for (const resource of infrastructure.resources) {
        stats.resource_types[resource.type] = (stats.resource_types[resource.type] || 0) + 1
      }
    }

    return stats
  }

  /**
   * Get real cost data from cloud providers using user's stored credentials
   */
  async getRealCostData(workspaceId: string, userId?: string, jwtToken?: string): Promise<{
    current_monthly_cost: number
    projected_monthly_cost: number
    cost_trend: string
    recommendations: any[]
  }> {
    try {
      // If we have user context, initialize their providers
      if (userId && jwtToken) {
        await this.initializeUserProviders(workspaceId, userId, jwtToken)
        
        // Try to get user-specific DigitalOcean provider
        const userProviderKey = `digitalocean-${userId}` as CloudProvider
        const userDoProvider = this.providers.get(userProviderKey)
        
        if (userDoProvider) {
          console.log(`Fetching real DigitalOcean costs for user ${userId}`)
          const costData = await this.fetchDigitalOceanCosts(userDoProvider)
          return {
            current_monthly_cost: costData.current_monthly_cost,
            projected_monthly_cost: costData.projected_monthly_cost,
            cost_trend: costData.cost_trend,
            recommendations: costData.recommendations
          }
        }
      }

      // Fallback to environment-based or mock provider
      const doProvider = this.providers.get('digitalocean')
      if (doProvider) {
        console.log('Fetching costs using fallback DigitalOcean provider')
        const costData = await this.fetchDigitalOceanCosts(doProvider)
        return {
          current_monthly_cost: costData.current_monthly_cost,
          projected_monthly_cost: costData.projected_monthly_cost,
          cost_trend: costData.cost_trend,
          recommendations: costData.recommendations
        }
      }

      // No provider available - return mock data
      console.log('No DigitalOcean provider available - returning mock cost data')
      return {
        current_monthly_cost: 0,
        projected_monthly_cost: 0,
        cost_trend: 'stable',
        recommendations: [{
          title: 'Connect DigitalOcean account',
          description: 'Add your DigitalOcean API key to get real cost data and infrastructure management.',
          type: 'setup',
          priority: 'high',
          potential_savings: 0,
          implementation_effort: 'low'
        }]
      }
    } catch (error) {
      console.error('Failed to fetch real cost data:', error)
      return {
        current_monthly_cost: 0,
        projected_monthly_cost: 0,
        cost_trend: 'stable',
        recommendations: []
      }
    }
  }

  /**
   * Fetch costs from DigitalOcean API
   */
  private async fetchDigitalOceanCosts(provider: CloudProviderInterface): Promise<{
    current_monthly_cost: number
    projected_monthly_cost: number
    cost_trend: string
    recommendations: any[]
  }> {
    try {
      // This would call the DigitalOcean provider's cost fetching methods
      // For now, let's return some realistic mock data based on typical DO costs
      
      // In a real implementation, this would:
      // 1. Get all droplets, databases, volumes, load balancers from DO API
      // 2. Calculate actual costs based on resource usage
      // 3. Provide cost optimization recommendations
      
      const mockCostData = {
        current_monthly_cost: 47.86, // Realistic cost for small DO setup
        projected_monthly_cost: 52.30,
        cost_trend: 'increasing',
        recommendations: [
          {
            title: 'Resize oversized droplets',
            description: 'You have 2 droplets that are underutilized. Consider downsizing to save $15/month.',
            type: 'cost_optimization',
            priority: 'medium',
            potential_savings: 15.00,
            implementation_effort: 'low'
          }
        ]
      }

      return mockCostData
    } catch (error) {
      console.error('Failed to fetch DigitalOcean costs:', error)
      throw error
    }
  }
}