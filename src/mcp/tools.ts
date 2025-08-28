/**
 * MCP (Model Context Protocol) Tool Definitions for Atlas Infrastructure Agent
 * 
 * These are the tool primitives that can be called by inference loop agents
 * following the MCP specification for standardized function descriptions.
 */

import { z } from 'zod'
import { ATLAS_DROPLET_TEMPLATES, CreateDropletWithSSHSchema, RebuildDropletWithSSHSchema } from './droplet-templates'

export interface MCPTool {
  name: string
  description: string
  inputSchema: z.ZodSchema
}

export interface MCPToolResult {
  content: Array<{
    type: 'text'
    text: string
  }>
  isError?: boolean
}

// Tool Schemas
// EXECUTABLE DEPLOYMENT TOOLS (Real Infrastructure Actions)

export const CreateDropletSchema = z.object({
  name: z.string().describe("Droplet name (e.g., 'riskguard-prod')"),
  size: z.string().default('s-1vcpu-1gb').describe("Droplet size slug"),
  region: z.string().default('nyc3').describe("Region (nyc3, sfo3, etc)"),
  image: z.string().default('ubuntu-22-04-x64').describe("OS image slug"),
  ssh_keys: z.array(z.string()).optional().describe("SSH key fingerprints"),
  domain: z.string().optional().describe("Domain to configure (e.g., 'riskguard.controlvector.io')"),
  workspace_id: z.string().describe("Workspace identifier"),
  user_id: z.string().describe("User identifier"),
  jwt_token: z.string().describe("JWT token for credential access")
})

export const CheckDropletStatusSchema = z.object({
  droplet_id: z.string().describe("DigitalOcean droplet ID or name"),
  workspace_id: z.string().describe("Workspace identifier"),
  jwt_token: z.string().describe("JWT token for credential access")
})

export const ProvisionInfrastructureSchema = z.object({
  name: z.string().describe("Human-readable name for the infrastructure"),
  provider: z.enum(['digitalocean', 'aws', 'gcp', 'azure']).describe("Cloud provider to use"),
  region: z.string().describe("Region to deploy in (e.g., 'nyc3', 'us-east-1')"),
  resources: z.array(z.object({
    type: z.enum(['droplet', 'volume', 'database', 'load_balancer', 'vpc']).describe("Type of resource to create"),
    name: z.string().describe("Name for this resource"),
    specifications: z.record(z.any()).describe("Resource-specific configuration")
  })).describe("List of resources to provision"),
  workspace_id: z.string().describe("Workspace identifier"),
  user_id: z.string().describe("User identifier"),
  jwt_token: z.string().optional().describe("JWT token for credential access")
})

export const GetInfrastructureOverviewSchema = z.object({
  workspace_id: z.string().describe("Workspace identifier"),
  user_id: z.string().optional().describe("User identifier"), 
  jwt_token: z.string().optional().describe("JWT token for credential access")
})

export const GetInfrastructureCostsSchema = z.object({
  workspace_id: z.string().describe("Workspace identifier"),
  user_id: z.string().describe("User identifier"),
  jwt_token: z.string().optional().describe("JWT token for credential access")
})

export const EstimateCostSchema = z.object({
  provider: z.enum(['digitalocean', 'aws', 'gcp', 'azure']).describe("Cloud provider"),
  region: z.string().describe("Target region"),
  resources: z.array(z.object({
    type: z.enum(['droplet', 'volume', 'database', 'load_balancer', 'vpc']),
    specifications: z.record(z.any())
  })).describe("Resources to estimate costs for")
})

export const ScaleResourceSchema = z.object({
  infrastructure_id: z.string().describe("Infrastructure ID to scale"),
  resource_id: z.string().describe("Specific resource ID to scale"),
  scaling_action: z.enum(['up', 'down', 'auto']).describe("Scaling direction or auto-scaling"),
  target_specifications: z.record(z.any()).describe("Target specifications after scaling")
})

export const GetProviderStatusSchema = z.object({
  provider: z.enum(['digitalocean', 'aws', 'gcp', 'azure']).optional().describe("Specific provider to check, or all if not specified")
})

export const DestroyInfrastructureSchema = z.object({
  infrastructure_id: z.string().describe("Infrastructure ID to destroy"),
  confirm: z.boolean().describe("Confirmation that destruction is intended")
})

// MCP Tool Definitions
export const ATLAS_MCP_TOOLS: MCPTool[] = [
  // PROVEN PATTERN TOOLS - Based on successful test script patterns
  ...ATLAS_DROPLET_TEMPLATES.map(template => ({
    name: template.name,
    description: template.description,
    inputSchema: template.inputSchema
  })),
  
  // EXISTING TOOLS
  // EXECUTABLE INFRASTRUCTURE TOOLS
  {
    name: 'create_droplet',
    description: 'EXECUTE: Create a new DigitalOcean droplet with specified configuration. Returns droplet ID, IP address, and status.',
    inputSchema: CreateDropletSchema
  },
  {
    name: 'check_droplet_status',
    description: 'EXECUTE: Check the current status of a droplet (active, off, new, etc). Returns detailed status and IP information.',
    inputSchema: CheckDropletStatusSchema
  },
  
  // OVERVIEW AND PLANNING TOOLS
  {
    name: 'get_infrastructure_overview',
    description: 'Get overview of all infrastructure resources in a workspace including droplets, databases, and other cloud resources',
    inputSchema: GetInfrastructureOverviewSchema
  },
  {
    name: 'provision_infrastructure',
    description: 'Provision new cloud infrastructure resources including droplets, databases, load balancers, and networking',
    inputSchema: ProvisionInfrastructureSchema
  },
  {
    name: 'get_infrastructure_costs',
    description: 'Get current infrastructure costs and usage metrics from cloud providers',
    inputSchema: GetInfrastructureCostsSchema
  },
  {
    name: 'estimate_infrastructure_cost',
    description: 'Estimate the monthly cost of proposed infrastructure before provisioning',
    inputSchema: EstimateCostSchema
  },
  {
    name: 'scale_infrastructure_resource',
    description: 'Scale existing infrastructure resources up, down, or enable auto-scaling',
    inputSchema: ScaleResourceSchema
  },
  {
    name: 'get_provider_status',
    description: 'Check the status and availability of cloud providers and their services',
    inputSchema: GetProviderStatusSchema
  },
  {
    name: 'destroy_infrastructure',
    description: 'Safely destroy infrastructure resources with confirmation',
    inputSchema: DestroyInfrastructureSchema
  }
]

// Helper function to validate MCP tool input
export function validateMCPToolInput<T>(tool: MCPTool, input: unknown): T {
  try {
    return tool.inputSchema.parse(input) as T
  } catch (error) {
    throw new Error(`Invalid input for tool '${tool.name}': ${error instanceof Error ? error.message : 'Unknown validation error'}`)
  }
}

// Helper function to create MCP tool result
export function createMCPResult(content: string, isError: boolean = false): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: content
      }
    ],
    isError
  }
}