/**
 * Proven Droplet Creation Handler
 * Based on successful test patterns from RiskGuard deployment
 */

import axios from 'axios'
import { 
  generateUserDataScript, 
  DropletCreationOutput, 
  DropletRebuildOutput 
} from './droplet-templates'

export class ProvenDropletHandler {
  private digitalOceanToken: string

  constructor(digitalOceanToken: string) {
    this.digitalOceanToken = digitalOceanToken
  }

  private get doHeaders() {
    return {
      'Authorization': `Bearer ${this.digitalOceanToken}`,
      'Content-Type': 'application/json'
    }
  }

  /**
   * Create droplet with application deployment using proven patterns
   */
  async createDropletWithApp(args: any): Promise<DropletCreationOutput> {
    const startTime = Date.now()
    
    try {
      console.log(`[ATLAS] Creating droplet with application: ${args.application.name}`)
      
      // Step 1: Get all SSH keys if include_all_account_keys is true
      let sshKeys = args.ssh_keys
      
      if (args.include_all_account_keys) {
        const keysResponse = await axios.get(
          'https://api.digitalocean.com/v2/account/keys',
          { headers: this.doHeaders }
        )
        
        const accountKeys = keysResponse.data.ssh_keys.map((key: any) => key.id.toString())
        sshKeys = [...new Set([...sshKeys, ...accountKeys])] // Merge and deduplicate
        
        console.log(`[ATLAS] Using ${sshKeys.length} SSH keys (${accountKeys.length} from account)`)
      }

      // Step 2: Generate proven user_data script
      const userDataScript = generateUserDataScript({
        applicationName: args.application.name,
        repositoryUrl: args.application.repository_url,
        branch: args.application.branch,
        applicationPort: args.application.port,
        domain: args.application.domain,
        nodejsVersion: args.system.nodejs_version,
        buildCommand: args.application.build_command,
        startCommand: args.application.start_command
      })

      // Step 3: Create droplet with proven configuration
      const dropletRequest = {
        name: args.name,
        region: args.region,
        size: args.size,
        image: args.image,
        ssh_keys: sshKeys,
        backups: false,
        ipv6: true,
        monitoring: args.system.enable_monitoring,
        tags: [...args.tags, args.application.name.toLowerCase()],
        user_data: userDataScript
      }

      console.log(`[ATLAS] Creating droplet: ${dropletRequest.name}`)
      
      const createResponse = await axios.post(
        'https://api.digitalocean.com/v2/droplets',
        dropletRequest,
        { headers: this.doHeaders }
      )

      const droplet = createResponse.data.droplet
      console.log(`[ATLAS] Droplet created: ${droplet.id} (${droplet.name})`)

      // Calculate expected completion time (based on observed deployment times)
      const estimatedCompletion = new Date(Date.now() + 5 * 60 * 1000).toISOString()

      return {
        success: true,
        droplet: {
          id: droplet.id,
          name: droplet.name,
          status: droplet.status,
          ip_address: droplet.networks.v4[0]?.ip_address || 'pending',
          ssh_keys: sshKeys,
          created_at: droplet.created_at
        },
        deployment: {
          application_name: args.application.name,
          expected_url: droplet.networks.v4[0]?.ip_address ? 
            `http://${droplet.networks.v4[0].ip_address}:${args.application.port}` : 
            'pending',
          deployment_log_path: `/var/log/${args.application.name.toLowerCase()}-deployment.log`,
          estimated_completion: estimatedCompletion
        },
        tool_name: 'atlas_create_droplet_with_app',
        execution_time: `${Date.now() - startTime}ms`
      }

    } catch (error: any) {
      console.error('[ATLAS] Droplet creation failed:', error.message)
      
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        tool_name: 'atlas_create_droplet_with_app',
        execution_time: `${Date.now() - startTime}ms`
      }
    }
  }

  /**
   * Rebuild droplet with SSH access using proven patterns
   */
  async rebuildDropletWithSSH(args: any): Promise<DropletRebuildOutput> {
    const startTime = Date.now()
    
    try {
      console.log(`[ATLAS] Rebuilding droplet: ${args.droplet_id}`)

      // Step 1: Create backup snapshot if requested
      let snapshotInfo
      if (args.backup_first) {
        const snapshotRequest = {
          name: `backup-before-rebuild-${Date.now()}`,
          type: 'snapshot'
        }

        const snapshotResponse = await axios.post(
          `https://api.digitalocean.com/v2/droplets/${args.droplet_id}/actions`,
          snapshotRequest,
          { headers: this.doHeaders }
        )

        snapshotInfo = {
          snapshot_id: snapshotResponse.data.action.id.toString(),
          snapshot_name: snapshotRequest.name
        }

        console.log(`[ATLAS] Backup snapshot initiated: ${snapshotInfo.snapshot_id}`)
      }

      // Step 2: Get SSH keys (use all account keys if not specified)
      let sshKeys = args.ssh_keys
      if (!sshKeys) {
        const keysResponse = await axios.get(
          'https://api.digitalocean.com/v2/account/keys',
          { headers: this.doHeaders }
        )
        sshKeys = keysResponse.data.ssh_keys.map((key: any) => key.id.toString())
        console.log(`[ATLAS] Using all account SSH keys: ${sshKeys.length} keys`)
      }

      // Step 3: Generate user_data for application deployment (if specified)
      let userDataScript = `#!/bin/bash
echo "🔧 Droplet rebuilt with SSH access on $(date)"
apt-get update && apt-get upgrade -y
ufw --force enable
ufw allow ssh
ufw allow http
ufw allow https
echo "✅ Basic setup completed"
`

      if (args.application) {
        userDataScript = generateUserDataScript({
          applicationName: args.application.name,
          repositoryUrl: args.application.repository_url,
          branch: args.application.branch,
          applicationPort: args.application.port,
          domain: args.application.domain,
          nodejsVersion: '20', // Default proven version
          buildCommand: args.application.build_command,
          startCommand: args.application.start_command
        })
      }

      // Step 4: Rebuild droplet
      const rebuildRequest = {
        image: 'ubuntu-24-04-x64',
        ssh_keys: sshKeys,
        user_data: userDataScript
      }

      const rebuildResponse = await axios.post(
        `https://api.digitalocean.com/v2/droplets/${args.droplet_id}/actions`,
        {
          type: 'rebuild',
          ...rebuildRequest
        },
        { headers: this.doHeaders }
      )

      const action = rebuildResponse.data.action
      console.log(`[ATLAS] Rebuild initiated: action ${action.id}`)

      // Calculate expected completion (rebuild typically takes 3-5 minutes)
      const estimatedCompletion = new Date(Date.now() + 5 * 60 * 1000).toISOString()

      return {
        success: true,
        action: {
          id: action.id,
          status: action.status,
          started_at: action.started_at
        },
        backup: snapshotInfo,
        estimated_completion: estimatedCompletion,
        tool_name: 'atlas_rebuild_droplet_with_ssh',
        execution_time: `${Date.now() - startTime}ms`
      }

    } catch (error: any) {
      console.error('[ATLAS] Droplet rebuild failed:', error.message)
      
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        tool_name: 'atlas_rebuild_droplet_with_ssh',
        execution_time: `${Date.now() - startTime}ms`
      }
    }
  }

  /**
   * Monitor droplet action status (utility method)
   */
  async getActionStatus(dropletId: string, actionId: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://api.digitalocean.com/v2/droplets/${dropletId}/actions/${actionId}`,
        { headers: this.doHeaders }
      )
      return response.data.action
    } catch (error: any) {
      console.error('[ATLAS] Failed to get action status:', error.message)
      throw error
    }
  }

  /**
   * Get droplet details with SSH key information
   */
  async getDropletDetails(dropletId: string): Promise<any> {
    try {
      const response = await axios.get(
        `https://api.digitalocean.com/v2/droplets/${dropletId}`,
        { headers: this.doHeaders }
      )
      
      const droplet = response.data.droplet
      return {
        id: droplet.id,
        name: droplet.name,
        status: droplet.status,
        ip_address: droplet.networks.v4[0]?.ip_address,
        ssh_keys: droplet.ssh_keys?.map((key: any) => key.id) || [],
        created_at: droplet.created_at,
        tags: droplet.tags
      }
    } catch (error: any) {
      console.error('[ATLAS] Failed to get droplet details:', error.message)
      throw error
    }
  }
}