import axios, { AxiosInstance } from 'axios'

export interface ContextManagerCredentials {
  digitalocean_api_token?: string
  aws_access_key_id?: string
  aws_secret_access_key?: string
  gcp_service_account_key?: string
  azure_subscription_id?: string
  azure_client_id?: string
  azure_client_secret?: string
  azure_tenant_id?: string
}

export class ContextService {
  private client: AxiosInstance
  private contextManagerUrl: string

  constructor(contextManagerUrl: string = 'http://localhost:3002') {
    this.contextManagerUrl = contextManagerUrl
    this.client = axios.create({
      baseURL: contextManagerUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Info': 'atlas-infrastructure-agent'
      }
    })
  }

  /**
   * Get cloud provider credentials from Context Manager
   */
  async getProviderCredentials(
    workspaceId: string,
    userId: string,
    provider: string,
    jwtToken?: string
  ): Promise<ContextManagerCredentials> {
    try {
      const headers: any = {}
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      // Get individual credentials for this provider
      const credentials: ContextManagerCredentials = {}

      switch (provider) {
        case 'digitalocean':
          credentials.digitalocean_api_token = await this.getCredential(
            'digitalocean_api_token',
            headers
          )
          break
        
        case 'aws':
          credentials.aws_access_key_id = await this.getCredential(
            'aws_access_key_id',
            headers
          )
          credentials.aws_secret_access_key = await this.getCredential(
            'aws_secret_access_key',
            headers
          )
          break
          
        case 'gcp':
          credentials.gcp_service_account_key = await this.getCredential(
            'gcp_service_account_key',
            headers
          )
          break
          
        case 'azure':
          credentials.azure_subscription_id = await this.getCredential(
            'azure_subscription_id',
            headers
          )
          credentials.azure_client_id = await this.getCredential(
            'azure_client_id',
            headers
          )
          credentials.azure_client_secret = await this.getCredential(
            'azure_client_secret',
            headers
          )
          credentials.azure_tenant_id = await this.getCredential(
            'azure_tenant_id',
            headers
          )
          break
      }

      return credentials
    } catch (error) {
      console.error(`Failed to get credentials for ${provider}:`, error)
      
      // Fallback to environment variables
      return this.getFallbackCredentials(provider)
    }
  }

  /**
   * Store cloud provider credentials in Context Manager
   */
  async storeProviderCredentials(
    workspaceId: string,
    userId: string,
    provider: string,
    credentials: ContextManagerCredentials,
    jwtToken?: string
  ): Promise<boolean> {
    try {
      const headers: any = {}
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      // Store each credential separately using the correct endpoint
      const credentialEntries = this.flattenCredentials(provider, credentials)

      for (const [key, value] of credentialEntries) {
        await this.client.post(
          `/api/v1/context/secret/credential`,
          {
            key,
            value,
            credential_type: 'api_key',
            provider,
            expires_at: null // Cloud credentials typically don't expire
          },
          { headers }
        )
      }

      return true
    } catch (error) {
      console.error(`Failed to store credentials for ${provider}:`, error)
      return false
    }
  }

  /**
   * Get SSH keys for infrastructure provisioning
   */
  async getSSHKeys(
    workspaceId: string,
    userId: string,
    jwtToken?: string
  ): Promise<string[]> {
    try {
      const headers: any = {}
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      // Get list of SSH keys from Context Manager
      const response = await this.client.get(
        `/api/v1/context/secret/list`,
        { headers }
      )

      const secretList = response.data.secrets || []
      
      // Filter for SSH keys and extract fingerprints
      const sshKeys = secretList.filter((secret: any) => secret.type === 'ssh_key')
      return sshKeys.map((key: any) => key.fingerprint).filter(Boolean)
    } catch (error) {
      console.warn('Failed to get SSH keys from Context Manager:', error)
      return []
    }
  }

  /**
   * Store SSH key in Context Manager
   */
  async storeSSHKey(
    workspaceId: string,
    userId: string,
    keyName: string,
    privateKey: string,
    publicKey: string,
    keyType: 'rsa' | 'ed25519' | 'ecdsa' = 'rsa',
    jwtToken?: string
  ): Promise<boolean> {
    try {
      const headers: any = {}
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      await this.client.post(
        `/api/v1/context/secret/ssh-key`,
        {
          key_name: keyName,
          private_key: privateKey,
          public_key: publicKey,
          key_type: keyType,
          metadata: {
            description: `SSH key for infrastructure access - ${keyName}`,
            allowed_hosts: ['*'] // Allow all hosts initially
          }
        },
        { headers }
      )

      return true
    } catch (error) {
      console.error('Failed to store SSH key:', error)
      return false
    }
  }

  /**
   * Get user preferences for infrastructure defaults
   */
  async getUserPreferences(
    workspaceId: string,
    userId: string,
    jwtToken?: string
  ): Promise<any> {
    try {
      const headers: any = {}
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      const response = await this.client.get(
        `/api/v1/context/user`,
        { headers }
      )

      return response.data.preferences || {
        default_cloud_provider: 'digitalocean',
        preferred_regions: ['nyc3', 'sfo3'],
        cost_limits: {
          daily_limit: 50,
          monthly_limit: 500,
          alert_threshold: 80
        }
      }
    } catch (error) {
      console.warn('Failed to get user preferences:', error)
      return {
        default_cloud_provider: 'digitalocean',
        preferred_regions: ['nyc3'],
        cost_limits: {
          daily_limit: 100,
          monthly_limit: 1000,
          alert_threshold: 80
        }
      }
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    workspaceId: string,
    userId: string,
    preferences: any,
    jwtToken?: string
  ): Promise<boolean> {
    try {
      const headers: any = {}
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      await this.client.put(
        `/api/v1/context/user/preferences`,
        preferences,
        { headers }
      )

      return true
    } catch (error) {
      console.error('Failed to update user preferences:', error)
      return false
    }
  }

  /**
   * Log infrastructure events to user context
   */
  async logInfrastructureEvent(
    workspaceId: string,
    userId: string,
    event: {
      event_type: 'provision' | 'deploy' | 'scale' | 'update' | 'delete'
      status: 'success' | 'failed' | 'pending'
      provider: string
      resource_type: string
      configuration: any
      cost_impact: number
      duration_ms: number
      metadata?: any
    },
    jwtToken?: string
  ): Promise<boolean> {
    try {
      const headers: any = {}
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      await this.client.post(
        `/api/v1/context/user/infrastructure-event`,
        event,
        { headers }
      )

      return true
    } catch (error) {
      console.warn('Failed to log infrastructure event:', error)
      return false
    }
  }

  /**
   * Check if Context Manager is available
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.client.get('/health', { timeout: 5000 })
      return response.status === 200
    } catch (error) {
      return false
    }
  }

  // Private helper methods
  private async getCredential(key: string, headers: any): Promise<string | undefined> {
    try {
      // Debug JWT token
      console.log(`[ContextService] Requesting credential '${key}'`)
      if (headers.Authorization) {
        const token = headers.Authorization.replace('Bearer ', '')
        console.log(`[ContextService] Using JWT token: ${token.substring(0, 50)}...`)
        
        // Decode and check expiration
        try {
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
          const now = Math.floor(Date.now() / 1000)
          const expiresIn = payload.exp - now
          console.log(`[ContextService] JWT expires in: ${expiresIn} seconds (${Math.floor(expiresIn / 60)} minutes)`)
          if (expiresIn <= 0) {
            console.error(`[ContextService] JWT token is expired!`)
          }
        } catch (decodeError) {
          console.error(`[ContextService] Failed to decode JWT:`, decodeError)
        }
      } else {
        console.warn(`[ContextService] No Authorization header present`)
      }

      const response = await this.client.get(
        `/api/v1/context/secret/credential/${key}`,
        { headers }
      )
      
      console.log(`[ContextService] Context Manager response status: ${response.status}`)
      console.log(`[ContextService] Context Manager response data:`, JSON.stringify(response.data, null, 2))
      
      // Handle the actual Context Manager response format: {success: true, data: {value: "..."}}
      const credential = response.data.data || response.data.credential
      if (credential && credential.value) {
        console.log(`[ContextService] Successfully retrieved credential '${key}': ${credential.value.substring(0, 20)}...`)
        return credential.value
      } else if (response.data.value) {
        // Handle direct value format
        console.log(`[ContextService] Successfully retrieved credential '${key}': ${response.data.value.substring(0, 20)}...`)
        return response.data.value
      }
      
      console.log(`[ContextService] No credential value found for '${key}'`)
      return undefined
    } catch (error) {
      console.error(`[ContextService] Failed to get credential ${key}:`, (error as any).response?.status, (error as any).response?.data || (error as any).message)
      return undefined
    }
  }

  private getFallbackCredentials(provider: string): ContextManagerCredentials {
    const credentials: ContextManagerCredentials = {}

    switch (provider) {
      case 'digitalocean':
        credentials.digitalocean_api_token = process.env.DIGITALOCEAN_API_TOKEN
        break
      case 'aws':
        credentials.aws_access_key_id = process.env.AWS_ACCESS_KEY_ID
        credentials.aws_secret_access_key = process.env.AWS_SECRET_ACCESS_KEY
        break
      case 'gcp':
        credentials.gcp_service_account_key = process.env.GCP_SERVICE_ACCOUNT_KEY
        break
      case 'azure':
        credentials.azure_subscription_id = process.env.AZURE_SUBSCRIPTION_ID
        credentials.azure_client_id = process.env.AZURE_CLIENT_ID
        credentials.azure_client_secret = process.env.AZURE_CLIENT_SECRET
        credentials.azure_tenant_id = process.env.AZURE_TENANT_ID
        break
    }

    return credentials
  }

  private flattenCredentials(provider: string, credentials: ContextManagerCredentials): [string, string][] {
    const entries: [string, string][] = []

    for (const [key, value] of Object.entries(credentials)) {
      if (value) {
        entries.push([key, value])
      }
    }

    return entries
  }
}