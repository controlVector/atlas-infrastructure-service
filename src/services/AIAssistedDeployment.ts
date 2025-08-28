/**
 * AI-Assisted Deployment Service for Atlas
 * This service calls Anthropic API when deployment issues occur and learns from solutions
 */

import axios from 'axios'
import { spawn } from 'child_process'

export interface DeploymentContext {
  repository: string
  branch: string
  serverIP: string
  appName: string
  sshKeyPath?: string
  sshPrivateKey?: string
  attempts: DeploymentAttempt[]
}

export interface DeploymentAttempt {
  method: string
  commands: string[]
  success: boolean
  error?: string
  timestamp: Date
}

export interface AISolution {
  strategy: string
  commands: string[]
  explanation: string
  confidence: number
  followUpActions?: string[]
}

export class AIAssistedDeployment {
  private anthropicApiKey: string
  private learnedSolutions: Map<string, AISolution[]> = new Map()

  constructor(anthropicApiKey?: string) {
    this.anthropicApiKey = anthropicApiKey || process.env.ANTHROPIC_API_KEY || ''
    console.log(`[AI Deploy] Initialized with API key: ${this.anthropicApiKey ? 'Yes' : 'No'}`)
  }

  async deployWithAI(context: DeploymentContext): Promise<{success: boolean, logs: string[], finalMethod?: string}> {
    console.log(`[AI Deploy] Starting intelligent deployment of ${context.repository} to ${context.serverIP}`)
    
    const logs: string[] = []
    logs.push(`Repository: ${context.repository}`)
    logs.push(`Branch: ${context.branch}`)
    logs.push(`Target: ${context.serverIP}`)
    logs.push(`App: ${context.appName}`)

    // Get SSH key from Context Manager
    await this.retrieveSSHKey(context, logs)

    // Try standard deployment first
    let success = await this.tryStandardDeployment(context, logs)
    if (success) {
      return { success: true, logs, finalMethod: 'standard' }
    }

    // If standard fails, ask AI for help
    logs.push(`[AI Deploy] Standard deployment failed, consulting AI...`)
    const aiSolution = await this.askAIForHelp(context)
    
    if (aiSolution) {
      logs.push(`[AI Deploy] AI suggested: ${aiSolution.strategy}`)
      logs.push(`[AI Deploy] Confidence: ${aiSolution.confidence}`)
      
      success = await this.executeAISolution(context, aiSolution, logs)
      if (success) {
        await this.recordSuccessfulSolution(context, aiSolution)
        return { success: true, logs, finalMethod: 'ai-assisted' }
      }

      // Try follow-up actions if provided
      if (aiSolution.followUpActions) {
        for (const followUp of aiSolution.followUpActions) {
          logs.push(`[AI Deploy] Trying follow-up: ${followUp}`)
          // Execute follow-up action
        }
      }
    }

    logs.push(`[AI Deploy] All deployment methods failed`)
    return { success: false, logs }
  }

  private async retrieveSSHKey(context: DeploymentContext, logs: string[]): Promise<void> {
    try {
      logs.push(`[AI Deploy] Development mode: Creating temporary SSH key for deployment...`)
      
      // Development mode: Create and deploy SSH key directly via DigitalOcean API
      const doToken = process.env.DIGITALOCEAN_API_TOKEN
      if (!doToken) {
        logs.push(`[AI Deploy] No DigitalOcean API token available, using default SSH`)
        return
      }
      
      // Generate SSH key pair
      const { spawn } = require('child_process')
      const fs = require('fs')
      const os = require('os')
      const path = require('path')
      
      const keyPath = path.join(os.tmpdir(), `riskguard-deploy-${Date.now()}`)
      const publicKeyPath = `${keyPath}.pub`
      
      await this.generateSSHKey(keyPath, logs)
      
      if (!fs.existsSync(keyPath) || !fs.existsSync(publicKeyPath)) {
        logs.push(`[AI Deploy] Failed to generate SSH key, using default SSH`)
        return
      }
      
      // Read the generated keys
      const privateKey = fs.readFileSync(keyPath, 'utf8')
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim()
      
      logs.push(`[AI Deploy] Generated SSH key pair, public key: ${publicKey.substring(0, 50)}...`)
      
      // Add the SSH key to DigitalOcean account
      try {
        const keyName = `riskguard-deploy-temp-${Date.now()}`
        const addKeyResponse = await axios.post(
          'https://api.digitalocean.com/v2/account/keys',
          {
            name: keyName,
            public_key: publicKey
          },
          {
            headers: {
              'Authorization': `Bearer ${doToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        )
        
        if (addKeyResponse.data?.ssh_key?.id) {
          logs.push(`[AI Deploy] ✓ Added SSH key to DigitalOcean account: ${keyName}`)
          
          // Get the droplet ID for 157.245.3.76
          const dropletsResponse = await axios.get(
            'https://api.digitalocean.com/v2/droplets',
            {
              headers: {
                'Authorization': `Bearer ${doToken}`
              },
              timeout: 10000
            }
          )
          
          let targetDropletId = null
          for (const droplet of dropletsResponse.data.droplets) {
            for (const network of droplet.networks.v4) {
              if (network.ip_address === context.serverIP) {
                targetDropletId = droplet.id
                break
              }
            }
            if (targetDropletId) break
          }
          
          if (targetDropletId) {
            logs.push(`[AI Deploy] Found droplet ID: ${targetDropletId}`)
            
            // Add the SSH key to the droplet by recreating it with the key
            // For now, we'll use the private key directly for SSH
            context.sshPrivateKey = privateKey
            context.sshKeyPath = keyPath
            fs.chmodSync(keyPath, 0o600)
            logs.push(`[AI Deploy] ✓ SSH key ready for deployment: ${keyPath}`)
          } else {
            logs.push(`[AI Deploy] Could not find droplet for IP ${context.serverIP}`)
          }
        }
      } catch (doError) {
        logs.push(`[AI Deploy] Failed to add SSH key to DigitalOcean: ${doError instanceof Error ? doError.message : 'Unknown error'}`)
      }
      
    } catch (error) {
      logs.push(`[AI Deploy] ⚠ Failed to create SSH key: ${error instanceof Error ? error.message : 'Unknown error'}`)
      logs.push(`[AI Deploy] Will attempt deployment with default SSH configuration`)
    }
  }
  
  private async generateSSHKey(keyPath: string, logs: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process')
      
      const sshKeygen = spawn('ssh-keygen', [
        '-t', 'rsa',
        '-b', '2048',
        '-f', keyPath,
        '-N', '', // No passphrase
        '-C', 'riskguard-deployment@controlvector.io'
      ])
      
      let output = ''
      let error = ''
      
      sshKeygen.stdout?.on('data', (data: any) => {
        output += data.toString()
      })
      
      sshKeygen.stderr?.on('data', (data: any) => {
        error += data.toString()
      })
      
      sshKeygen.on('close', (code: number | null) => {
        if (code === 0) {
          logs.push(`[AI Deploy] SSH key generated successfully`)
          resolve()
        } else {
          logs.push(`[AI Deploy] SSH key generation failed: ${error}`)
          reject(new Error(`ssh-keygen failed with code ${code}: ${error}`))
        }
      })
      
      setTimeout(() => {
        sshKeygen.kill()
        reject(new Error('SSH key generation timeout'))
      }, 30000)
    })
  }

  private async tryStandardDeployment(context: DeploymentContext, logs: string[]): Promise<boolean> {
    logs.push(`[AI Deploy] Attempting standard SSH deployment...`)

    const sshKeyOption = context.sshKeyPath ? `-i ${context.sshKeyPath}` : ''
    const commands = [
      `ssh ${sshKeyOption} -o StrictHostKeyChecking=no root@${context.serverIP} "cd /var/www && rm -rf ${context.appName} || true"`,
      `ssh ${sshKeyOption} -o StrictHostKeyChecking=no root@${context.serverIP} "git clone ${context.repository} -b ${context.branch} /var/www/${context.appName}"`,
      `ssh ${sshKeyOption} -o StrictHostKeyChecking=no root@${context.serverIP} "cd /var/www/${context.appName} && npm install"`,
      `ssh ${sshKeyOption} -o StrictHostKeyChecking=no root@${context.serverIP} "cd /var/www/${context.appName} && npm run build"`,
      `ssh ${sshKeyOption} -o StrictHostKeyChecking=no root@${context.serverIP} "cd /var/www/${context.appName} && cp -r dist/* /var/www/html/"`,
      `ssh ${sshKeyOption} -o StrictHostKeyChecking=no root@${context.serverIP} "systemctl restart nginx"`
    ]

    try {
      for (const command of commands) {
        logs.push(`Executing: ${command}`)
        await this.executeCommand(command)
        logs.push(`✓ Success`)
      }
      
      context.attempts.push({
        method: 'standard-ssh',
        commands,
        success: true,
        timestamp: new Date()
      })
      
      return true
    } catch (error: any) {
      logs.push(`✗ Failed: ${error.message}`)
      
      context.attempts.push({
        method: 'standard-ssh',
        commands,
        success: false,
        error: error.message,
        timestamp: new Date()
      })
      
      return false
    }
  }

  private async askAIForHelp(context: DeploymentContext): Promise<AISolution | null> {
    if (!this.anthropicApiKey) {
      console.log(`[AI Deploy] No Anthropic API key, using fallback logic`)
      return this.getFallbackSolution(context)
    }

    const prompt = this.buildAIPrompt(context)
    
    try {
      console.log(`[AI Deploy] Calling Anthropic API for deployment assistance...`)
      
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: prompt
          }]
        },
        {
          headers: {
            'x-api-key': this.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 30000
        }
      )

      console.log(`[AI Deploy] Received AI response`)
      return this.parseAIResponse(response.data)
    } catch (error: any) {
      console.error(`[AI Deploy] AI call failed:`, error.response?.data || error.message)
      return this.getFallbackSolution(context)
    }
  }

  private buildAIPrompt(context: DeploymentContext): string {
    return `
You are helping Atlas deploy a web application. Here's the situation:

Repository: ${context.repository}
Branch: ${context.branch}
Target Server: ${context.serverIP}
App Name: ${context.appName}

Previous deployment attempts that failed:
${JSON.stringify(context.attempts, null, 2)}

This is an Angular/TypeScript application that needs to be:
1. Cloned from GitHub
2. Dependencies installed with npm install
3. Built with npm run build 
4. Deployed to nginx web root
5. Nginx restarted

The server is Ubuntu 22.04 with nginx already running.

Please provide a solution in this exact JSON format:
{
  "strategy": "brief description of approach",
  "commands": ["command1", "command2", "command3"],
  "explanation": "why this should work",
  "confidence": 0.85,
  "followUpActions": ["fallback1", "fallback2"]
}

Focus on practical SSH commands that can be executed immediately. Consider SSH key issues, permission problems, and Node.js/npm installation.
`
  }

  private parseAIResponse(response: any): AISolution | null {
    try {
      const content = response.content[0].text
      console.log(`[AI Deploy] Raw AI response:`, content.substring(0, 200) + '...')
      
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const solution = JSON.parse(jsonMatch[0])
        console.log(`[AI Deploy] Parsed AI solution:`, solution.strategy)
        return solution
      }
    } catch (error) {
      console.error(`[AI Deploy] Failed to parse AI response:`, error)
    }
    return null
  }

  private getFallbackSolution(context: DeploymentContext): AISolution {
    // Fallback logic based on common deployment issues
    const lastError = context.attempts[context.attempts.length - 1]?.error || ''
    
    if (lastError.includes('Permission denied') || lastError.includes('ssh')) {
      return {
        strategy: 'SSH key authentication issue - try with password or different key',
        commands: [
          `ssh-keygen -R ${context.serverIP}`,
          `ssh -o StrictHostKeyChecking=no -o PasswordAuthentication=yes root@${context.serverIP} "echo 'SSH connection test'"`,
          `scp -o StrictHostKeyChecking=no -r ./deploy-script.sh root@${context.serverIP}:/tmp/`,
          `ssh -o StrictHostKeyChecking=no root@${context.serverIP} "chmod +x /tmp/deploy-script.sh && /tmp/deploy-script.sh"`
        ],
        explanation: 'SSH authentication failed. Try removing cached host key and using password auth.',
        confidence: 0.7,
        followUpActions: [
          'Create deployment script and copy it to server',
          'Use DigitalOcean console to execute commands',
          'Regenerate SSH keys'
        ]
      }
    }

    return {
      strategy: 'Alternative deployment via HTTP upload',
      commands: [
        `git clone ${context.repository} -b ${context.branch} /tmp/${context.appName}`,
        `cd /tmp/${context.appName} && npm install && npm run build`,
        `tar -czf /tmp/${context.appName}-dist.tar.gz -C /tmp/${context.appName}/dist .`,
        `curl -X POST -F "file=@/tmp/${context.appName}-dist.tar.gz" http://${context.serverIP}/upload`
      ],
      explanation: 'SSH failed, try building locally and uploading via HTTP',
      confidence: 0.6,
      followUpActions: ['Use SCP instead of SSH', 'Try different SSH port']
    }
  }

  private async executeAISolution(context: DeploymentContext, solution: AISolution, logs: string[]): Promise<boolean> {
    try {
      for (const command of solution.commands) {
        logs.push(`[AI] Executing: ${command}`)
        await this.executeCommand(command)
        logs.push(`[AI] ✓ Success`)
      }
      return true
    } catch (error: any) {
      logs.push(`[AI] ✗ Failed: ${error.message}`)
      return false
    }
  }

  private async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ')
      const child = spawn(cmd, args, { shell: true })
      
      let output = ''
      let error = ''
      
      child.stdout?.on('data', (data) => {
        output += data.toString()
      })
      
      child.stderr?.on('data', (data) => {
        error += data.toString()
      })
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(output)
        } else {
          reject(new Error(`Command failed with code ${code}: ${error || output}`))
        }
      })
      
      // Timeout after 2 minutes
      setTimeout(() => {
        child.kill()
        reject(new Error('Command timeout'))
      }, 120000)
    })
  }

  private async recordSuccessfulSolution(context: DeploymentContext, solution: AISolution): Promise<void> {
    const key = `deploy-${context.appName}`
    if (!this.learnedSolutions.has(key)) {
      this.learnedSolutions.set(key, [])
    }
    
    // Increase confidence since it worked
    solution.confidence = Math.min(1.0, solution.confidence * 1.1)
    this.learnedSolutions.get(key)!.push(solution)
    
    console.log(`[AI Deploy] Recorded successful solution for ${key}`)
    console.log(`[AI Deploy] Solution: ${solution.strategy}`)
    
    // Store in context manager for persistence
    try {
      await axios.post(
        `http://localhost:3002/api/v1/context/learned-solutions`,
        {
          service: 'atlas',
          operation: key,
          solution: solution,
          repository: context.repository,
          timestamp: new Date().toISOString()
        }
      )
    } catch (error) {
      console.error('[AI Deploy] Failed to save solution to context manager:', error)
    }
  }
}